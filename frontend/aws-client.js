(() => {
  "use strict";

  const SESSION_KEY = "kaarya.aws.session.v3";

  function parseJson(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function inferRegion(source) {
    const combined = `${source.apiBaseUrl || ""} ${source.cognitoDomain || ""}`;
    return combined.match(/(?:execute-api\.|\.auth\.)([a-z]{2}-[a-z]+-\d)/)?.[1] || "";
  }

  function normalizeConfig(value) {
    const source = typeof value === "string" ? parseJson(value) : value;
    if (!source || typeof source !== "object") throw new Error("The Kaarya AWS configuration is missing.");
    const config = {
      region: String(source.region || inferRegion(source)).trim(),
      clientId: String(source.clientId || "").trim(),
      apiBaseUrl: String(source.apiBaseUrl || "").replace(/\/$/, ""),
    };
    if (!/^[a-z]{2}-[a-z]+-\d$/.test(config.region)) throw new Error("The AWS region is missing or invalid.");
    if (!/^[a-zA-Z0-9]+$/.test(config.clientId)) throw new Error("The Cognito client ID is not valid.");
    if (!/^https:\/\//.test(config.apiBaseUrl)) throw new Error("The API URL must start with https://");
    return config;
  }

  function getConfig() {
    try { return normalizeConfig(window.KAARYA_AWS_CONFIG); } catch { return null; }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function base64Url(bytes) {
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomValue(length = 32) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  function decodeJwt(token) {
    if (!token) return {};
    const payload = token.split(".")[1];
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)))); } catch { return {}; }
  }

  function sessionFromTokens(tokens, metadata = {}) {
    const accessToken = tokens.access_token || tokens.AccessToken;
    const idToken = tokens.id_token || tokens.IdToken;
    const refreshToken = tokens.refresh_token || tokens.RefreshToken || "";
    const expiresIn = tokens.expires_in || tokens.ExpiresIn || 3600;
    const accessPayload = decodeJwt(accessToken);
    const idPayload = decodeJwt(idToken);
    const rawGroups = accessPayload["cognito:groups"] || idPayload["cognito:groups"] || [];
    const groups = Array.isArray(rawGroups) ? rawGroups : String(rawGroups).replace(/[\[\]"]/g, "").split(",").map((value) => value.trim()).filter(Boolean);
    return {
      accessToken,
      idToken,
      refreshToken,
      expiresAt: Date.now() + Math.max(60, Number(expiresIn) || 3600) * 1000,
      subject: idPayload.sub || accessPayload.sub || "",
      username: idPayload["cognito:username"] || accessPayload.username || metadata.username || "",
      email: idPayload.email || "",
      phone: idPayload.phone_number || "",
      name: idPayload.name || idPayload.email || idPayload.phone_number || metadata.username || "Kaarya user",
      groups,
      role: groups.includes("DOCTOR") ? "doctor" : "patient",
      authMethod: metadata.authMethod || "password",
      intendedRole: metadata.intendedRole || "patient",
    };
  }

  function getSession() {
    const session = parseJson(sessionStorage.getItem(SESSION_KEY));
    if (!session) return null;
    if (Number(session.expiresAt) <= Date.now() + 15000) {
      clearSession();
      return null;
    }
    return session;
  }

  function storeSession(tokens, metadata) {
    const session = sessionFromTokens(tokens, metadata);
    if (!session.accessToken || !session.idToken) throw new Error("Cognito did not return a complete session.");
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function isConfigured() {
    return Boolean(getConfig());
  }

  function friendlyCognitoError(type, message) {
    const name = String(type || "").split(":")[0].split("#").pop();
    const friendly = {
      UsernameExistsException: "An account with that email address is already registered.",
      InvalidPasswordException: "The password does not meet the required strength rules.",
      AliasExistsException: "That email address is already linked to another account. Sign in or reset its password instead.",
      UserNotConfirmedException: "This account still needs verification.",
      NotAuthorizedException: "The email address or password is incorrect.",
      UserNotFoundException: "No account was found with those details.",
      CodeMismatchException: "The verification code is incorrect.",
      ExpiredCodeException: "The verification code has expired. Request a new code.",
      LimitExceededException: "Too many attempts were made. Please wait before trying again.",
      CodeDeliveryFailureException: "AWS could not deliver the verification email. Check the email address and Cognito email configuration.",
      InvalidParameterException: "One or more registration details are invalid.",
      PasswordResetRequiredException: "A password reset is required for this account.",
    };
    const error = new Error(friendly[name] || message || name || "Amazon Cognito could not complete the request.");
    error.name = name || "CognitoError";
    error.code = name || "CognitoError";
    return error;
  }

  async function cognitoRequest(action, payload) {
    const config = getConfig();
    if (!config) throw new Error("The Kaarya secure-service configuration is unavailable.");
    const response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw friendlyCognitoError(result.__type || response.headers.get("x-amzn-errortype"), result.message);
    return result;
  }

  async function registerPatient({ password, name, email }) {
    const config = getConfig();
    if (!config) throw new Error("The Kaarya secure-service configuration is unavailable.");
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) throw new Error("Enter an email address to create the account.");
    const username = `kw_${randomValue(18)}`;
    const result = await cognitoRequest("SignUp", {
      ClientId: config.clientId,
      Username: username,
      Password: password,
      UserAttributes: [
        { Name: "name", Value: name.trim() },
        { Name: "email", Value: normalizedEmail },
      ],
    });
    return { ...result, InternalUsername: username };
  }

  function confirmRegistration({ username, code }) {
    const config = getConfig();
    return cognitoRequest("ConfirmSignUp", { ClientId: config.clientId, Username: username.trim(), ConfirmationCode: code.trim() });
  }

  function resendConfirmationCode(username) {
    const config = getConfig();
    return cognitoRequest("ResendConfirmationCode", { ClientId: config.clientId, Username: username.trim() });
  }

  async function passwordSignIn({ identifier, password, intendedRole = "patient" }) {
    const config = getConfig();
    const result = await cognitoRequest("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: config.clientId,
      AuthParameters: { USERNAME: identifier.trim(), PASSWORD: password },
    });
    if (result.AuthenticationResult) return { session: storeSession(result.AuthenticationResult, { username: identifier.trim(), authMethod: "password", intendedRole }) };
    return {
      challenge: result.ChallengeName,
      challengeSession: result.Session,
      challengeParameters: result.ChallengeParameters || {},
      username: result.ChallengeParameters?.USER_ID_FOR_SRP || identifier.trim(),
      intendedRole,
    };
  }

  async function completeNewPassword({ username, newPassword, challengeSession, intendedRole = "doctor" }) {
    const config = getConfig();
    const result = await cognitoRequest("RespondToAuthChallenge", {
      ClientId: config.clientId,
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: challengeSession,
      ChallengeResponses: { USERNAME: username, NEW_PASSWORD: newPassword },
    });
    if (!result.AuthenticationResult) throw new Error("Cognito returned another authentication challenge that this demonstration does not support.");
    return storeSession(result.AuthenticationResult, { username, authMethod: "password", intendedRole });
  }

  async function apiRequest(path, options = {}) {
    const config = getConfig();
    const session = getSession();
    if (!config || !session) throw new Error("Your secure session has expired. Sign in again.");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${config.apiBaseUrl}${path}`, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) clearSession();
    if (!response.ok) throw new Error(result.message || `Request failed (${response.status}).`);
    return result;
  }

  const getProfile = () => apiRequest("/profile");
  const saveProfile = (profile) => apiRequest("/profile", { method: "PUT", body: JSON.stringify(profile) });
  const addGlucose = (reading) => apiRequest("/glucose", { method: "POST", body: JSON.stringify(reading) });
  const getGlucose = ({ days = 120 } = {}) => apiRequest(`/glucose?days=${encodeURIComponent(days)}`);
  const listPatients = () => apiRequest("/patients");
  const getPatientGlucose = (patientId, { days = 120 } = {}) => apiRequest(`/patients/${encodeURIComponent(patientId)}/glucose?days=${encodeURIComponent(days)}`);

  async function signOut() {
    clearSession();
  }

  window.KaaryaAWS = {
    addGlucose,
    clearSession,
    completeNewPassword,
    confirmRegistration,
    getConfig,
    getGlucose,
    getPatientGlucose,
    getProfile,
    getSession,
    isConfigured,
    listPatients,
    passwordSignIn,
    registerPatient,
    resendConfirmationCode,
    saveProfile,
    signOut,
  };
})();
