import datetime as dt
import json
import os
import time
import uuid
import zlib
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
profiles = dynamodb.Table(os.environ["PROFILES_TABLE"])
readings = dynamodb.Table(os.environ["READINGS_TABLE"])
retention_days = int(os.environ.get("RETENTION_DAYS", "120"))

PROFILE_FIELDS = {
    "name", "dateOfBirth", "gender", "email", "phone", "city",
    "diabetesType", "diagnosisYear", "fastingTargetMin", "fastingTargetMax",
    "nonFastingTargetMin", "nonFastingTargetMax", "targetMin", "targetMax",
    "emergencyName", "emergencyPhone", "sharingConsent"
}
CONTEXTS = {
    "fasting", "before-breakfast", "after-breakfast", "before-lunch",
    "after-lunch", "before-dinner", "after-dinner", "bedtime", "random"
}

def json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    raise TypeError

def response(status, payload):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(payload, default=json_default)
    }

def body_json(event):
    try:
        value = json.loads(event.get("body") or "{}")
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}

def claims(event):
    return event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})

def subject(event):
    return claims(event).get("sub", "")

def is_doctor(event):
    groups = claims(event).get("cognito:groups", "")
    if isinstance(groups, list):
        return "DOCTOR" in groups
    text = str(groups or "").strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return "DOCTOR" in parsed
    except (json.JSONDecodeError, TypeError):
        pass
    return any(group.strip().strip("'\"") == "DOCTOR" for group in text.strip("[]").split(","))

def patient_code(owner_sub):
    return f"KWC-{(zlib.crc32(owner_sub.encode('utf-8')) % 90000) + 10000}"

def clean_text(value, maximum=160):
    return str(value or "").strip()[:maximum]

def public_profile(item):
    if not item:
        return None
    return {key: value for key, value in item.items() if key not in {"ownerSub"}}

def get_profile(owner_sub):
    return profiles.get_item(Key={"ownerSub": owner_sub}).get("Item")

def resolve_patient(patient_id):
    result = profiles.query(
        IndexName="patientId-index",
        KeyConditionExpression=Key("patientId").eq(patient_id),
        Limit=1
    )
    items = result.get("Items", [])
    return items[0] if items else None

def parse_recorded_at(value):
    text = clean_text(value, 40)
    parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc), parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def query_readings(owner_sub, days):
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    result = readings.query(
        KeyConditionExpression=Key("patientId").eq(owner_sub) & Key("recordedAt").gte(cutoff.isoformat().replace("+00:00", "Z")),
        ScanIndexForward=False,
        Limit=1500
    )
    return result.get("Items", [])

def target_range(profile, reading_context):
    legacy_minimum = int(profile.get("targetMin", 70))
    legacy_maximum = int(profile.get("targetMax", 180))
    if reading_context == "fasting":
        return (
            int(profile.get("fastingTargetMin", legacy_minimum)),
            int(profile.get("fastingTargetMax", legacy_maximum))
        )
    return (
        int(profile.get("nonFastingTargetMin", legacy_minimum)),
        int(profile.get("nonFastingTargetMax", legacy_maximum))
    )

def summary_for(profile, owner_sub):
    recent = query_readings(owner_sub, 7)
    latest_result = readings.query(
        KeyConditionExpression=Key("patientId").eq(owner_sub),
        ScanIndexForward=False,
        Limit=1
    )
    latest_items = latest_result.get("Items", [])
    latest = latest_items[0] if latest_items else None
    values = [int(item.get("value", 0)) for item in recent]
    in_range = 0
    for item in recent:
        minimum, maximum = target_range(profile, item.get("context", "random"))
        if minimum <= int(item.get("value", 0)) <= maximum:
            in_range += 1
    return {
        "latest": latest,
        "average7d": round(sum(values) / len(values)) if values else 0,
        "inRangePercent": round(in_range * 100 / len(values)) if values else 0,
        "readingCount7d": len(values)
    }

def handler(event, context):
    route = event.get("routeKey", "")
    owner_sub = subject(event)
    if not owner_sub:
        return response(401, {"message": "Authenticated user identity is missing."})

    try:
        if route == "GET /me":
            return response(200, {"subject": owner_sub, "role": "doctor" if is_doctor(event) else "patient"})

        if route == "GET /profile":
            return response(200, {"profile": public_profile(get_profile(owner_sub))})

        if route == "PUT /profile":
            if is_doctor(event):
                return response(403, {"message": "Doctor accounts cannot create patient profiles."})
            payload = body_json(event)
            name = clean_text(payload.get("name"), 100)
            if len(name) < 2:
                return response(400, {"message": "Enter the patient's full name."})
            legacy_minimum = int(payload.get("targetMin", 70))
            legacy_maximum = int(payload.get("targetMax", 180))
            fasting_minimum = int(payload.get("fastingTargetMin", legacy_minimum))
            fasting_maximum = int(payload.get("fastingTargetMax", legacy_maximum))
            non_fasting_minimum = int(payload.get("nonFastingTargetMin", legacy_minimum))
            non_fasting_maximum = int(payload.get("nonFastingTargetMax", legacy_maximum))
            ranges = {
                "fastingTargetMin": fasting_minimum,
                "fastingTargetMax": fasting_maximum,
                "nonFastingTargetMin": non_fasting_minimum,
                "nonFastingTargetMax": non_fasting_maximum,
                "targetMin": non_fasting_minimum,
                "targetMax": non_fasting_maximum
            }
            if any(minimum < 40 or maximum > 400 or minimum >= maximum for minimum, maximum in [
                (fasting_minimum, fasting_maximum),
                (non_fasting_minimum, non_fasting_maximum)
            ]):
                return response(400, {"message": "Enter valid fasting and non-fasting glucose target ranges."})
            existing = get_profile(owner_sub) or {}
            now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
            item = {
                "ownerSub": owner_sub,
                "patientId": existing.get("patientId") or patient_code(owner_sub),
                "createdAt": existing.get("createdAt") or now,
                "updatedAt": now
            }
            for field in PROFILE_FIELDS:
                value = payload.get(field)
                if field in ranges:
                    item[field] = ranges[field]
                elif field == "sharingConsent":
                    item[field] = bool(value)
                else:
                    item[field] = clean_text(value, 240)
            profiles.put_item(Item=item)
            return response(200, {"profile": public_profile(item)})

        if route == "POST /glucose":
            if is_doctor(event):
                return response(403, {"message": "Doctor accounts cannot add patient readings."})
            if not get_profile(owner_sub):
                return response(409, {"message": "Complete the patient profile before recording glucose."})
            payload = body_json(event)
            value = int(payload.get("value", 0))
            if value < 20 or value > 600:
                return response(400, {"message": "Glucose value must be between 20 and 600 mg/dL."})
            reading_context = clean_text(payload.get("context"), 40)
            if reading_context not in CONTEXTS:
                return response(400, {"message": "Select a valid reading context."})
            recorded, recorded_text = parse_recorded_at(payload.get("recordedAt"))
            now = dt.datetime.now(dt.timezone.utc)
            if recorded > now + dt.timedelta(minutes=10) or recorded < now - dt.timedelta(days=730):
                return response(400, {"message": "Reading date is outside the allowed demonstration range."})
            item = {
                "patientId": owner_sub,
                "recordedAt": recorded_text,
                "readingId": str(uuid.uuid4()),
                "value": value,
                "context": reading_context,
                "notes": clean_text(payload.get("notes"), 240),
                "createdAt": now.isoformat().replace("+00:00", "Z"),
                "expiresAt": int(time.time()) + retention_days * 86400
            }
            readings.put_item(Item=item)
            public_item = {key: val for key, val in item.items() if key not in {"patientId", "expiresAt"}}
            return response(201, {"reading": public_item})

        if route == "GET /glucose":
            days = max(1, min(365, int((event.get("queryStringParameters") or {}).get("days", 120))))
            items = query_readings(owner_sub, days)
            public_items = [{key: val for key, val in item.items() if key not in {"patientId", "expiresAt"}} for item in items]
            return response(200, {"readings": public_items})

        if route == "GET /patients":
            if not is_doctor(event):
                return response(403, {"message": "Doctor access is required."})
            items = profiles.scan(Limit=1000).get("Items", [])
            patients = [{"profile": public_profile(item), "summary": summary_for(item, item["ownerSub"])} for item in items if item.get("sharingConsent")]
            patients.sort(key=lambda patient: patient["profile"].get("name", ""))
            return response(200, {"patients": patients})

        if route == "GET /patients/{patientId}/glucose":
            if not is_doctor(event):
                return response(403, {"message": "Doctor access is required."})
            patient_id = clean_text((event.get("pathParameters") or {}).get("patientId"), 40)
            profile = resolve_patient(patient_id)
            if not profile or not profile.get("sharingConsent"):
                return response(404, {"message": "Patient record was not found or is not shared."})
            days = max(1, min(365, int((event.get("queryStringParameters") or {}).get("days", 120))))
            items = query_readings(profile["ownerSub"], days)
            public_items = [{key: val for key, val in item.items() if key not in {"patientId", "expiresAt"}} for item in items]
            return response(200, {"profile": public_profile(profile), "readings": public_items})

        return response(404, {"message": "Route not found."})
    except (ValueError, TypeError):
        return response(400, {"message": "One or more values are invalid."})
    except Exception as error:
        print(json.dumps({"error": str(error), "route": route}))
        return response(500, {"message": "The service could not complete this request."})
