(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const PROFILE_KEY = "kaarya.glucose.profile.v2";
  const READINGS_KEY = "kaarya.glucose.readings.v2";
  const PENDING_REGISTRATION_KEY = "kaarya.auth.pending-email.v1";

  const navigation = {
    patient: [
      { id: "overview", label: "Overview", icon: "layout-dashboard" },
      { id: "profile", label: "My profile", icon: "contact-round" },
      { id: "log", label: "Record glucose", icon: "droplets" },
      { id: "heatmap", label: "Glucose heat map", icon: "calendar-check-2" },
      { id: "insights", label: "Trends & insights", icon: "chart-no-axes-combined" },
    ],
    doctor: [{ id: "doctor-overview", label: "Patient monitoring", icon: "users-round" }],
  };

  const screenMeta = {
    "patient-overview": ["Patient portal", "Overview"],
    "patient-profile": ["Patient portal", "My profile"],
    "patient-log": ["Patient portal", "Record glucose"],
    "patient-heatmap": ["Patient portal", "Glucose heat map"],
    "patient-insights": ["Patient portal", "Trends & insights"],
    "doctor-overview": ["Doctor portal", "Patient monitoring"],
    "doctor-patient": ["Doctor portal", "Patient glucose profile"],
  };

  const contextLabels = {
    fasting: "Fasting",
    "before-breakfast": "Before breakfast",
    "after-breakfast": "2 hrs after breakfast",
    "before-lunch": "Before lunch",
    "after-lunch": "2 hrs after lunch",
    "before-dinner": "Before dinner",
    "after-dinner": "2 hrs after dinner",
    bedtime: "Bedtime",
    random: "Random",
  };

  const heatmapContexts = [
    "fasting",
    "before-breakfast",
    "after-breakfast",
    "before-lunch",
    "after-lunch",
    "before-dinner",
    "after-dinner",
    "bedtime",
    "random",
  ];

  const state = {
    authRole: "patient",
    authViewMode: "signin",
    currentRole: null,
    authMode: "demo",
    awsSession: null,
    pendingRegistration: null,
    pendingChallenge: null,
    profile: null,
    readings: [],
    doctorPatients: [],
    selectedPatient: null,
    rangeDays: 7,
    heatmapDays: 14,
    doctorHeatmapDays: 14,
    patientFilter: "all",
  };

  function localDate(daysAgo = 0) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - daysAgo);
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function localTime() {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  }

  function readingAt(daysAgo, time, value, context, notes = "") {
    const recordedAt = new Date(`${localDate(daysAgo)}T${time}:00`).toISOString();
    return { readingId: `demo-${daysAgo}-${time.replace(":", "")}`, recordedAt, value, context, notes };
  }

  function generateReadings(base, pattern, days = 34, lastOffset = 0) {
    const readings = [];
    for (let day = lastOffset; day < days; day += 1) {
      const drift = pattern[day % pattern.length];
      readings.push(readingAt(day, "07:10", Math.max(48, base + drift), "fasting"));
      if (day % 3 === 0) readings.push(readingAt(day, "07:45", Math.max(50, base + 5 + drift), "before-breakfast"));
      if (day % 2 === 0) readings.push(readingAt(day, "10:05", Math.max(55, base + 38 + pattern[(day + 2) % pattern.length]), "after-breakfast"));
      if (day % 3 !== 1) readings.push(readingAt(day, "12:40", Math.max(50, base + 12 + pattern[(day + 1) % pattern.length]), "before-lunch"));
      if (day % 3 === 1) readings.push(readingAt(day, "15:20", Math.max(55, base + 31 + pattern[(day + 4) % pattern.length]), "after-lunch"));
      if (day % 2 === 1) readings.push(readingAt(day, "19:15", Math.max(50, base + 9 + pattern[(day + 5) % pattern.length]), "before-dinner"));
      readings.push(readingAt(day, "21:20", Math.max(55, base + 34 + pattern[(day + 3) % pattern.length]), "after-dinner"));
      if (day % 3 === 0) readings.push(readingAt(day, "23:00", Math.max(50, base + 18 + pattern[(day + 6) % pattern.length]), "bedtime"));
      if (day % 7 === 4) readings.push(readingAt(day, "17:10", Math.max(50, base + 22 + drift), "random"));
    }
    return readings.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  }

  const demoProfile = {
    patientId: "KWC-1028",
    name: "Ananya Sharma",
    dateOfBirth: "1994-04-12",
    gender: "Female",
    email: "ananya.sharma@example.com",
    phone: "+91 98102 21034",
    city: "Sector 81, Greater Faridabad",
    diabetesType: "Type 2",
    diagnosisYear: "2023",
    fastingTargetMin: 70,
    fastingTargetMax: 130,
    nonFastingTargetMin: 70,
    nonFastingTargetMax: 180,
    targetMin: 70,
    targetMax: 180,
    emergencyName: "Aarav Sharma",
    emergencyPhone: "+91 98711 24018",
    sharingConsent: true,
  };

  const demoPatientSeed = [
    { profile: demoProfile, base: 108, pattern: [18, 4, 9, -7, 12, 1, 6, -5], lastOffset: 0, color: "" },
    { profile: { ...demoProfile, patientId: "KWC-1044", name: "Rajiv Verma", dateOfBirth: "1962-08-18", gender: "Male", email: "rajiv.verma@example.com", phone: "+91 99102 48611", diabetesType: "Type 2", diagnosisYear: "2018", fastingTargetMin: 80, fastingTargetMax: 140, nonFastingTargetMin: 80, nonFastingTargetMax: 180, targetMin: 80, targetMax: 180, city: "Sector 85, Faridabad" }, base: 162, pattern: [42, 18, 51, 9, 29, 63, 15], lastOffset: 0, color: "red" },
    { profile: { ...demoProfile, patientId: "KWC-1036", name: "Rohan Mehta", dateOfBirth: "1988-11-02", gender: "Male", email: "rohan.mehta@example.com", phone: "+91 97182 67202", diabetesType: "Type 1", diagnosisYear: "2014", fastingTargetMin: 70, fastingTargetMax: 130, nonFastingTargetMin: 70, nonFastingTargetMax: 180, targetMin: 70, targetMax: 180, city: "Greater Faridabad" }, base: 105, pattern: [13, -2, 8, 21, -8, 10, 4], lastOffset: 0, color: "blue" },
    { profile: { ...demoProfile, patientId: "KWC-1009", name: "Sunita Kapoor", dateOfBirth: "1978-02-22", gender: "Female", email: "sunita.kapoor@example.com", phone: "+91 98116 84509", diabetesType: "Prediabetes", diagnosisYear: "2025", fastingTargetMin: 70, fastingTargetMax: 120, nonFastingTargetMin: 70, nonFastingTargetMax: 160, targetMin: 70, targetMax: 160, city: "Sector 79, Faridabad" }, base: 96, pattern: [7, 10, -3, 4, 13, 1, 8], lastOffset: 1, color: "orange" },
    { profile: { ...demoProfile, patientId: "KWC-1051", name: "Vikram Taneja", dateOfBirth: "1971-06-09", gender: "Male", email: "vikram.taneja@example.com", phone: "+91 98991 17388", diabetesType: "Type 2", diagnosisYear: "2020", fastingTargetMin: 70, fastingTargetMax: 130, nonFastingTargetMin: 70, nonFastingTargetMax: 180, targetMin: 70, targetMax: 180, city: "Sector 82, Faridabad" }, base: 118, pattern: [12, -4, 16, 5, 8, -6, 13], lastOffset: 4, color: "" },
  ];

  function buildDemoPatients() {
    let storedProfile = null;
    let storedReadings = null;
    try {
      storedProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      storedReadings = JSON.parse(localStorage.getItem(READINGS_KEY) || "null");
    } catch {
      storedProfile = null;
      storedReadings = null;
    }
    return demoPatientSeed.map((seed, index) => ({
      profile: index === 0 && storedProfile ? normalizeProfile(storedProfile) : { ...seed.profile },
      readings: index === 0 && Array.isArray(storedReadings) ? storedReadings.map(normalizeReading) : generateReadings(seed.base, seed.pattern, 34, seed.lastOffset),
      color: seed.color,
    }));
  }

  function refreshIcons() {
    window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function savePendingRegistration(registration) {
    localStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify({
      username: registration.username,
      email: registration.email,
      name: registration.name || "",
      fastingTargetMin: Number(registration.fastingTargetMin),
      fastingTargetMax: Number(registration.fastingTargetMax),
      nonFastingTargetMin: Number(registration.nonFastingTargetMin),
      nonFastingTargetMax: Number(registration.nonFastingTargetMax),
    }));
  }

  function loadPendingRegistration() {
    try { return JSON.parse(localStorage.getItem(PENDING_REGISTRATION_KEY) || sessionStorage.getItem(PENDING_REGISTRATION_KEY) || "null"); } catch { return null; }
  }

  function clearPendingRegistration() {
    localStorage.removeItem(PENDING_REGISTRATION_KEY);
    sessionStorage.removeItem(PENDING_REGISTRATION_KEY);
  }

  function initials(name = "Patient") {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "PT";
  }

  function firstName(name = "Patient") {
    return name.trim().split(/\s+/)[0] || "Patient";
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }

  function todayLabel() {
    return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  }

  function sameLocalDay(dateValue, compare = new Date()) {
    const date = new Date(dateValue);
    return date.getFullYear() === compare.getFullYear() && date.getMonth() === compare.getMonth() && date.getDate() === compare.getDate();
  }

  function formatDate(dateValue, includeYear = false) {
    const date = new Date(dateValue);
    if (sameLocalDay(date)) return "Today";
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (sameLocalDay(date, yesterday)) return "Yesterday";
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(includeYear ? { year: "numeric" } : {}) }).format(date);
  }

  function formatTime(dateValue) {
    return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(dateValue));
  }

  function ageFromDate(dateValue) {
    if (!dateValue) return "—";
    const birth = new Date(`${dateValue}T12:00:00`);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
    return Math.max(0, age);
  }

  function normalizeProfile(profile = {}) {
    const legacyMinimum = Number(profile.targetMin);
    const legacyMaximum = Number(profile.targetMax);
    const fallbackMinimum = Number.isFinite(legacyMinimum) && legacyMinimum > 0 ? legacyMinimum : 70;
    const fallbackFastingMaximum = Number.isFinite(legacyMaximum) && legacyMaximum > 0 ? legacyMaximum : 130;
    const fallbackNonFastingMaximum = Number.isFinite(legacyMaximum) && legacyMaximum > 0 ? legacyMaximum : 180;
    const fastingTargetMin = Number(profile.fastingTargetMin) || fallbackMinimum;
    const fastingTargetMax = Number(profile.fastingTargetMax) || fallbackFastingMaximum;
    const nonFastingTargetMin = Number(profile.nonFastingTargetMin) || fallbackMinimum;
    const nonFastingTargetMax = Number(profile.nonFastingTargetMax) || fallbackNonFastingMaximum;
    return {
      patientId: profile.patientId || profile.ownerSub || "KWC-NEW",
      name: profile.name || state.awsSession?.name || "New Patient",
      dateOfBirth: profile.dateOfBirth || "",
      gender: profile.gender || "",
      email: profile.email || state.awsSession?.email || "",
      phone: profile.phone || state.awsSession?.phone || "",
      city: profile.city || "",
      diabetesType: profile.diabetesType || "Type 2",
      diagnosisYear: profile.diagnosisYear || "",
      fastingTargetMin,
      fastingTargetMax,
      nonFastingTargetMin,
      nonFastingTargetMax,
      targetMin: nonFastingTargetMin,
      targetMax: nonFastingTargetMax,
      emergencyName: profile.emergencyName || "",
      emergencyPhone: profile.emergencyPhone || "",
      sharingConsent: profile.sharingConsent === true || profile.sharingConsent === "true",
    };
  }

  function targetRangeFor(profile, context = "random") {
    const normalized = normalizeProfile(profile || {});
    if (context === "fasting") {
      return { minimum: normalized.fastingTargetMin, maximum: normalized.fastingTargetMax, type: "Fasting" };
    }
    return { minimum: normalized.nonFastingTargetMin, maximum: normalized.nonFastingTargetMax, type: "Non-fasting" };
  }

  function targetRangeSummary(profile) {
    const normalized = normalizeProfile(profile || {});
    return `Fasting ${normalized.fastingTargetMin}–${normalized.fastingTargetMax} · Non-fasting ${normalized.nonFastingTargetMin}–${normalized.nonFastingTargetMax} mg/dL`;
  }

  function validateTargetRanges(profile) {
    const pairs = [
      [Number(profile.fastingTargetMin), Number(profile.fastingTargetMax), "fasting"],
      [Number(profile.nonFastingTargetMin), Number(profile.nonFastingTargetMax), "non-fasting"],
    ];
    for (const [minimum, maximum, label] of pairs) {
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 40 || maximum > 400 || minimum >= maximum) {
        return `Enter a valid ${label} range between 40 and 400 mg/dL, with the minimum below the maximum.`;
      }
    }
    return "";
  }

  function normalizePhone(value = "") {
    return String(value).replace(/[\s()-]/g, "");
  }

  function isInternationalPhone(value) {
    return /^\+[1-9]\d{7,14}$/.test(normalizePhone(value));
  }

  function normalizeReading(reading = {}) {
    return {
      readingId: reading.readingId || reading.id || crypto.randomUUID?.() || String(Date.now()),
      patientId: reading.patientId,
      recordedAt: reading.recordedAt || new Date().toISOString(),
      value: Number(reading.value),
      context: reading.context || "random",
      notes: reading.notes || "",
    };
  }

  function sortedReadings(readings = state.readings) {
    return readings.map(normalizeReading).filter((reading) => Number.isFinite(reading.value)).sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  }

  function statusFor(value, profile = state.profile, context = "random") {
    const { minimum, maximum } = targetRangeFor(profile, context);
    if (value < minimum) return { key: "low", label: "Below range" };
    if (value > maximum) return { key: "high", label: "Above range" };
    return { key: "good", label: "In range" };
  }

  function metricsFor(readings, profile, days = 7) {
    const cutoff = Date.now() - days * 86400000;
    const period = sortedReadings(readings).filter((reading) => new Date(reading.recordedAt).getTime() >= cutoff);
    const latest = sortedReadings(readings)[0] || null;
    const average = period.length ? Math.round(period.reduce((total, reading) => total + reading.value, 0) / period.length) : 0;
    const inRange = period.filter((reading) => statusFor(reading.value, profile, reading.context).key === "good").length;
    const inRangePercent = period.length ? Math.round((inRange / period.length) * 100) : 0;
    const highest = period.length ? period.reduce((result, reading) => reading.value > result.value ? reading : result) : null;
    const lowest = period.length ? period.reduce((result, reading) => reading.value < result.value ? reading : result) : null;
    return { period, latest, average, inRange, inRangePercent, highest, lowest };
  }

  function loggingStreak(readings) {
    const daySet = new Set(sortedReadings(readings).map((reading) => localDateKey(reading.recordedAt)));
    let streak = 0;
    for (let offset = 0; offset < 120; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (daySet.has(key)) streak += 1;
      else if (offset > 0 || daySet.size) break;
    }
    return streak;
  }

  function localDateKey(dateValue) {
    const date = new Date(dateValue);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function toast(message, type = "success") {
    const item = document.createElement("div");
    item.className = `toast ${type === "error" ? "error" : ""}`;
    item.innerHTML = `<i data-lucide="${type === "error" ? "circle-alert" : "circle-check"}"></i><span>${escapeHtml(message)}</span>`;
    $("#toastRegion").append(item);
    refreshIcons();
    window.setTimeout(() => item.remove(), 4200);
  }

  function renderNavigation(role) {
    const container = $("#navigation");
    container.replaceChildren();
    navigation[role].forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-button";
      button.dataset.nav = item.id;
      button.innerHTML = `<i data-lucide="${item.icon}"></i><span>${item.label}</span>`;
      container.append(button);
    });
    refreshIcons();
  }

  function navToScreen(navId) {
    if (navId === "doctor-overview") return "doctor-overview";
    return `patient-${navId}`;
  }

  function showScreen(screenName) {
    $$("[data-screen]").forEach((screen) => screen.classList.toggle("is-hidden", screen.dataset.screen !== screenName));
    const meta = screenMeta[screenName] || ["Kaarya Wellness", "Portal"];
    $("#headerContext").textContent = meta[0];
    $("#headerScreenTitle").textContent = meta[1];
    $$(".nav-button").forEach((button) => button.classList.toggle("is-active", navToScreen(button.dataset.nav) === screenName));
    $("#sidebar").classList.remove("is-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (screenName === "patient-overview") renderPatientOverview();
    if (screenName === "patient-profile") populateProfileForm();
    if (screenName === "patient-log") renderTodayTimeline();
    if (screenName === "patient-heatmap") renderGlucoseHeatmap();
    if (screenName === "patient-insights") renderPatientInsights();
    if (screenName === "doctor-overview") renderDoctorOverview();
    refreshIcons();
  }

  function showPortal(role) {
    state.currentRole = role;
    $("#authView").classList.add("is-hidden");
    $("#portalShell").classList.remove("is-hidden");
    renderNavigation(role);
    const displayName = role === "doctor" ? "Dr. Prashant Bhatia" : state.profile?.name || state.awsSession?.name || "Patient";
    $("#userName").textContent = displayName;
    $("#userInitials").textContent = role === "doctor" ? "PB" : initials(displayName);
    $("#userRole").textContent = role === "doctor" ? "Doctor" : "Patient";
    $("#environmentChip").classList.toggle("live", state.authMode === "aws");
    $("#environmentChip").innerHTML = `<b></b> ${state.authMode === "aws" ? "Live AWS" : "Demo data"}`;
    showScreen(role === "doctor" ? "doctor-overview" : "patient-overview");
  }

  function setAuthRole(role) {
    state.authRole = role;
    $$("[data-auth-role]").forEach((button) => {
      const active = button.dataset.authRole === role;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (role === "doctor") {
      $("#authTitle").textContent = "See every patient’s glucose story.";
      $("#authSubtitle").textContent = "A consolidated view for Dr. Prashant Bhatia to review readings, trends and exceptions.";
      $("#identityAction").textContent = "Sign in to doctor portal";
      $("#registrationLine").classList.add("is-hidden");
      $("#doctorAccessNote").classList.remove("is-hidden");
    } else {
      $("#authTitle").textContent = "Track your glucose. Understand the pattern.";
      $("#authSubtitle").textContent = "Record daily readings and share a clear trend with Dr. Prashant Bhatia.";
      $("#identityAction").textContent = "Sign in securely";
      $("#registrationLine").classList.remove("is-hidden");
      $("#doctorAccessNote").classList.add("is-hidden");
    }
  }

  function showAuthStep(mode = "signin") {
    state.authViewMode = mode;
    const panels = {
      signin: $("#signInPanel"),
      register: $("#registerPanel"),
      confirmation: $("#confirmationPanel"),
      "new-password": $("#newPasswordPanel"),
    };
    Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle("is-hidden", key !== mode));
    const onSignIn = mode === "signin";
    $("#roleTabs").classList.toggle("is-hidden", !onSignIn);
    $(".demo-access")?.classList.toggle("is-hidden", !onSignIn);

    if (mode === "signin") {
      setAuthRole(state.authRole);
    } else if (mode === "register") {
      state.authRole = "patient";
      $("#authTitle").textContent = "Create your patient account.";
      $("#authSubtitle").textContent = "Register with your email address and verify it without leaving Kaarya Wellness.";
    } else if (mode === "confirmation") {
      $("#authTitle").textContent = "One quick verification step.";
      $("#authSubtitle").textContent = "Enter the code sent to your email address to activate the account.";
    } else if (mode === "new-password") {
      $("#authTitle").textContent = "Secure your clinic-issued account.";
      $("#authSubtitle").textContent = "Create a permanent password to continue to the authorised doctor portal.";
    }

    const focusTarget = panels[mode]?.querySelector("input");
    if (focusTarget) window.requestAnimationFrame(() => focusTarget.focus());
    refreshIcons();
  }

  function loadLocalPatient(blank = false) {
    if (blank) {
      state.profile = normalizeProfile({ name: "New Patient", email: $("#identityInput").value.trim() });
      state.readings = [];
      return;
    }
    let storedProfile = null;
    let storedReadings = null;
    try {
      storedProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
      storedReadings = JSON.parse(localStorage.getItem(READINGS_KEY) || "null");
    } catch {
      storedProfile = null;
      storedReadings = null;
    }
    state.profile = normalizeProfile(storedProfile || demoProfile);
    state.readings = Array.isArray(storedReadings) ? storedReadings.map(normalizeReading) : generateReadings(108, [18, 4, 9, -7, 12, 1, 6, -5], 34, 0);
  }

  async function enterPatient({ blank = false, live = false } = {}) {
    state.authMode = live ? "aws" : "demo";
    if (live) {
      try {
        const [profileResult, readingsResult] = await Promise.all([window.KaaryaAWS.getProfile(), window.KaaryaAWS.getGlucose({ days: 120 })]);
        const registrationDefaults = state.pendingRegistration || loadPendingRegistration() || {};
        state.profile = normalizeProfile(profileResult.profile || registrationDefaults);
        state.readings = (readingsResult.readings || []).map(normalizeReading);
        if (profileResult.profile) clearPendingRegistration();
        showPortal("patient");
        if (!profileResult.profile) showScreen("patient-profile");
      } catch (error) {
        toast(error.message || "Could not load the patient record.", "error");
      }
      return;
    }
    loadLocalPatient(blank);
    showPortal("patient");
    if (blank) showScreen("patient-profile");
  }

  async function enterDoctor({ live = false } = {}) {
    state.authMode = live ? "aws" : "demo";
    if (live) {
      try {
        const result = await window.KaaryaAWS.listPatients();
        state.doctorPatients = (result.patients || []).map((item) => ({ profile: normalizeProfile(item.profile || item), readings: [], summary: item.summary || item, color: "" }));
      } catch (error) {
        toast(error.message || "Could not load patient monitoring data.", "error");
        return;
      }
    } else {
      state.doctorPatients = buildDemoPatients();
    }
    showPortal("doctor");
  }

  function renderLineChart(svg, readings, profile, days, gradientKey) {
    if (!svg) return;
    const width = svg.viewBox.baseVal.width || 760;
    const height = svg.viewBox.baseVal.height || 300;
    const pad = { left: 50, right: 20, top: 25, bottom: 38 };
    const cutoff = Date.now() - days * 86400000;
    const data = sortedReadings(readings).filter((reading) => new Date(reading.recordedAt).getTime() >= cutoff).reverse();
    if (!data.length) {
      svg.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-axis-label">No readings in this period</text>`;
      return;
    }
    const values = data.map((reading) => reading.value);
    const fastingTarget = targetRangeFor(profile, "fasting");
    const nonFastingTarget = targetRangeFor(profile, "random");
    const yMin = Math.max(20, Math.floor((Math.min(...values, fastingTarget.minimum, nonFastingTarget.minimum) - 25) / 20) * 20);
    const yMax = Math.min(600, Math.ceil((Math.max(...values, fastingTarget.maximum, nonFastingTarget.maximum) + 25) / 20) * 20);
    const xMin = new Date(data[0].recordedAt).getTime();
    const xMax = new Date(data[data.length - 1].recordedAt).getTime();
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const xAt = (dateValue, index) => xMax === xMin ? pad.left + plotWidth / 2 : pad.left + ((new Date(dateValue).getTime() - xMin) / (xMax - xMin)) * plotWidth;
    const yAt = (value) => pad.top + ((yMax - value) / (yMax - yMin || 1)) * plotHeight;
    const points = data.map((reading, index) => ({ x: xAt(reading.recordedAt, index), y: yAt(reading.value), reading }));
    const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)} ${(height - pad.bottom).toFixed(1)} L${points[0].x.toFixed(1)} ${(height - pad.bottom).toFixed(1)} Z`;
    const targetBands = [
      { range: nonFastingTarget, className: "non-fasting" },
      { range: fastingTarget, className: "fasting" },
    ].map(({ range, className }) => {
      const top = yAt(range.maximum);
      const bottom = yAt(range.minimum);
      return `<rect x="${pad.left}" y="${top}" width="${plotWidth}" height="${Math.max(0, bottom - top)}" rx="12" class="chart-target ${className}"><title>${range.type} target ${range.minimum}–${range.maximum} mg/dL</title></rect>`;
    }).join("");
    const yTicks = 4;
    const grid = Array.from({ length: yTicks + 1 }, (_, index) => {
      const value = Math.round(yMax - ((yMax - yMin) / yTicks) * index);
      const y = pad.top + (plotHeight / yTicks) * index;
      return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="chart-grid-line"/><text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${value}</text>`;
    }).join("");
    const labelsToShow = Math.min(6, data.length);
    const xLabels = Array.from({ length: labelsToShow }, (_, index) => {
      const dataIndex = labelsToShow === 1 ? 0 : Math.round((data.length - 1) * (index / (labelsToShow - 1)));
      const point = points[dataIndex];
      const label = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(point.reading.recordedAt));
      return `<text x="${point.x}" y="${height - 11}" text-anchor="middle" class="chart-axis-label">${label}</text>`;
    }).join("");
    const circles = points.map((point) => {
      const status = statusFor(point.reading.value, profile, point.reading.context).key;
      return `<circle cx="${point.x}" cy="${point.y}" r="4.5" class="chart-point ${status === "good" ? "" : status}"><title>${point.reading.value} mg/dL · ${contextLabels[point.reading.context] || point.reading.context} · ${formatDate(point.reading.recordedAt, true)} ${formatTime(point.reading.recordedAt)}</title></circle>`;
    }).join("");
    svg.innerHTML = `<defs><linearGradient id="chartGradient-${gradientKey}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#17a673" stop-opacity=".24"/><stop offset="100%" stop-color="#17a673" stop-opacity="0"/></linearGradient></defs>${grid}${targetBands}<path d="${areaPath}" fill="url(#chartGradient-${gradientKey})"/><path d="${linePath}" class="chart-path"/>${circles}${xLabels}`;
  }

  function renderPatientOverview() {
    if (!state.profile) return;
    const metrics = metricsFor(state.readings, state.profile, 7);
    const latestStatus = metrics.latest ? statusFor(metrics.latest.value, state.profile, metrics.latest.context) : { key: "missing", label: "No reading" };
    $("#patientToday").textContent = todayLabel();
    $("#patientGreeting").textContent = `${greeting()}, ${firstName(state.profile.name)}`;
    $("#userName").textContent = state.profile.name;
    $("#userInitials").textContent = initials(state.profile.name);
    $("#latestReading").innerHTML = metrics.latest ? `${metrics.latest.value} <em>mg/dL</em>` : `— <em>mg/dL</em>`;
    $("#latestReadingMeta").textContent = metrics.latest ? `${formatDate(metrics.latest.recordedAt)} · ${formatTime(metrics.latest.recordedAt)} · ${contextLabels[metrics.latest.context] || "Reading"}` : "Record your first reading";
    $("#latestStatus").textContent = latestStatus.label;
    $("#latestStatus").className = `status-badge ${latestStatus.key}`;
    $("#averageReading").innerHTML = `${metrics.average || "—"} <em>mg/dL</em>`;
    $("#rangeReading").innerHTML = `${metrics.inRangePercent}<em>%</em>`;
    $("#targetRangeCopy").textContent = targetRangeSummary(state.profile);
    $("#streakReading").innerHTML = `${loggingStreak(state.readings)} <em>days</em>`;
    const now = new Date();
    $("#dateTile").innerHTML = `<b>${now.getDate()}</b><small>${new Intl.DateTimeFormat("en-IN", { month: "short" }).format(now).toUpperCase()}</small>`;
    const todayReadings = sortedReadings(state.readings).filter((reading) => sameLocalDay(reading.recordedAt));
    $("#todayStatus").innerHTML = todayReadings.length
      ? `<span class="today-status-icon"><i data-lucide="check"></i></span><div><strong>${todayReadings.length} reading${todayReadings.length === 1 ? "" : "s"} recorded today</strong><span>Latest: ${todayReadings[0].value} mg/dL at ${formatTime(todayReadings[0].recordedAt)}</span></div>`
      : `<span class="today-status-icon"><i data-lucide="clock-3"></i></span><div><strong>No reading recorded today</strong><span>Add a value when you are ready.</span></div>`;
    const insight = overviewInsight(metrics);
    $("#overviewInsight").innerHTML = `<i data-lucide="sparkles"></i><p><strong>${escapeHtml(insight.title)}</strong><span>${escapeHtml(insight.copy)}</span></p>`;
    renderLineChart($("#overviewChart"), state.readings, state.profile, 7, "overview");
    renderOverviewReadings();
    refreshIcons();
  }

  function overviewInsight(metrics) {
    if (!metrics.period.length) return { title: "Start with one reading.", copy: "A few entries will reveal your first trend." };
    if (metrics.inRangePercent >= 80) return { title: "Your weekly pattern is mostly steady.", copy: `${metrics.inRangePercent}% of readings are inside your configured range.` };
    const out = metrics.period.length - metrics.inRange;
    return { title: `${out} reading${out === 1 ? " is" : "s are"} outside your range.`, copy: "Review the timing and meal context with your clinician." };
  }

  function renderOverviewReadings() {
    const container = $("#overviewReadingList");
    const recent = sortedReadings(state.readings).slice(0, 4);
    if (!recent.length) {
      container.innerHTML = `<div class="empty-state"><span><i data-lucide="droplets"></i></span><h3>No glucose readings yet</h3><p>Record your first value to begin the diary.</p></div>`;
      return;
    }
    container.innerHTML = recent.map((reading) => {
      const status = statusFor(reading.value, state.profile, reading.context);
      return `<div class="reading-row"><span class="reading-time-icon"><i data-lucide="clock-3"></i></span><div><strong>${escapeHtml(contextLabels[reading.context] || reading.context)}</strong><span>${formatDate(reading.recordedAt, true)} · ${formatTime(reading.recordedAt)}</span></div><div><strong>${escapeHtml(reading.notes || "No note")}</strong><span>Patient entry</span></div><span class="reading-value">${reading.value} <em>mg/dL</em></span><b class="status-badge ${status.key}">${status.label}</b></div>`;
    }).join("");
  }

  function populateProfileForm() {
    if (!state.profile) return;
    const form = $("#profileForm");
    Object.entries(state.profile).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value ?? "";
    });
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const profile = normalizeProfile({
      ...state.profile,
      ...values,
      sharingConsent: form.elements.sharingConsent.checked,
      fastingTargetMin: Number(values.fastingTargetMin),
      fastingTargetMax: Number(values.fastingTargetMax),
      nonFastingTargetMin: Number(values.nonFastingTargetMin),
      nonFastingTargetMax: Number(values.nonFastingTargetMax),
      targetMin: Number(values.nonFastingTargetMin),
      targetMax: Number(values.nonFastingTargetMax),
    });
    profile.phone = normalizePhone(profile.phone);
    if (!profile.email && !profile.phone) {
      toast("Add at least one contact method: email address or mobile number.", "error");
      return;
    }
    if (profile.phone && !isInternationalPhone(profile.phone)) {
      toast("Enter the mobile number in international format, for example +919810232197.", "error");
      return;
    }
    const targetError = validateTargetRanges(profile);
    if (targetError) {
      toast(targetError, "error");
      return;
    }
    const button = $("button[type='submit']", form);
    button.disabled = true;
    try {
      if (state.authMode === "aws") {
        const result = await window.KaaryaAWS.saveProfile(profile);
        state.profile = normalizeProfile(result.profile || profile);
      } else {
        state.profile = profile;
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      }
      $("#profileSaveStatus").textContent = "Profile saved";
      $("#userName").textContent = state.profile.name;
      $("#userInitials").textContent = initials(state.profile.name);
      clearPendingRegistration();
      toast("Your profile has been saved.");
      window.setTimeout(() => { $("#profileSaveStatus").textContent = ""; }, 2600);
    } catch (error) {
      toast(error.message || "Profile could not be saved.", "error");
    } finally {
      button.disabled = false;
    }
  }

  function renderTodayTimeline() {
    const readings = sortedReadings(state.readings).filter((reading) => sameLocalDay(reading.recordedAt));
    const timeline = $("#todayTimeline");
    $("#todayCount").textContent = `${readings.length} ${readings.length === 1 ? "entry" : "entries"}`;
    $("#todayEmpty").classList.toggle("is-hidden", readings.length > 0);
    timeline.classList.toggle("is-hidden", readings.length === 0);
    timeline.innerHTML = readings.map((reading) => `<div class="timeline-item"><div><strong>${escapeHtml(contextLabels[reading.context] || reading.context)}</strong><span>${formatTime(reading.recordedAt)}${reading.notes ? ` · ${escapeHtml(reading.notes)}` : ""}</span></div><b>${reading.value} <em>mg/dL</em></b></div>`).join("");
  }

  async function saveGlucose(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const recordedAt = new Date(`${values.date}T${values.time}:00`).toISOString();
    const reading = normalizeReading({ recordedAt, value: Number(values.value), context: values.context, notes: String(values.notes || "").trim() });
    const button = $("button[type='submit']", form);
    button.disabled = true;
    try {
      const saved = state.authMode === "aws" ? (await window.KaaryaAWS.addGlucose(reading)).reading : reading;
      state.readings = [normalizeReading(saved || reading), ...state.readings.filter((item) => item.readingId !== reading.readingId)];
      if (state.authMode !== "aws") localStorage.setItem(READINGS_KEY, JSON.stringify(state.readings));
      form.elements.value.value = "";
      form.elements.notes.value = "";
      setGlucoseDateTime();
      renderTodayTimeline();
      toast(`${reading.value} mg/dL saved with date and time.`);
    } catch (error) {
      toast(error.message || "The glucose reading could not be saved.", "error");
    } finally {
      button.disabled = false;
    }
  }

  function setGlucoseDateTime() {
    const form = $("#glucoseForm");
    form.elements.date.value = localDate(0);
    form.elements.time.value = localTime();
  }

  function renderHeatmap({ readings, profile, days, elements }) {
    const dates = Array.from({ length: days }, (_, index) => localDate(index));
    const dateSet = new Set(dates);
    const grouped = new Map();

    sortedReadings(readings).forEach((reading) => {
      const dateKey = localDateKey(reading.recordedAt);
      if (!dateSet.has(dateKey) || !heatmapContexts.includes(reading.context)) return;
      const key = `${dateKey}|${reading.context}`;
      const entries = grouped.get(key) || [];
      entries.push(reading);
      grouped.set(key, entries);
    });

    elements.head.innerHTML = `<tr><th class="heatmap-date-heading" scope="col">Day</th>${heatmapContexts.map((context) => `<th scope="col"><span>${escapeHtml(contextLabels[context])}</span></th>`).join("")}</tr>`;

    let recordedSlots = 0;
    let inRangeSlots = 0;
    let bestDay = null;
    const rows = dates.map((dateKey) => {
      const parts = dateKey.split("-").map(Number);
      const date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
      let daySlots = 0;
      const cells = heatmapContexts.map((context) => {
        const entries = grouped.get(`${dateKey}|${context}`) || [];
        if (!entries.length) {
          return `<td class="heatmap-data-cell"><span class="heatmap-cell empty" aria-label="No ${escapeHtml(contextLabels[context])} reading on ${escapeHtml(formatDate(date, true))}">—</span></td>`;
        }
        const reading = entries[0];
        const status = statusFor(reading.value, profile, reading.context);
        daySlots += 1;
        recordedSlots += 1;
        if (status.key === "good") inRangeSlots += 1;
        const detail = `${contextLabels[context]} · ${reading.value} mg/dL · ${formatDate(reading.recordedAt, true)} at ${formatTime(reading.recordedAt)} · ${status.label}`;
        const more = entries.length > 1 ? `<b class="heatmap-multiple">+${entries.length - 1}</b>` : "";
        return `<td class="heatmap-data-cell"><span class="heatmap-cell ${status.key}" title="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}"><strong>${reading.value}</strong><small>mg/dL · ${escapeHtml(formatTime(reading.recordedAt))}</small>${more}</span></td>`;
      }).join("");
      if (!bestDay || daySlots > bestDay.count) bestDay = { date, count: daySlots };
      const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date);
      return `<tr><th class="heatmap-date-cell" scope="row"><strong>${escapeHtml(formatDate(date, true))}</strong><small>${escapeHtml(weekday)}</small></th>${cells}</tr>`;
    }).join("");

    const totalSlots = dates.length * heatmapContexts.length;
    const inRangePercent = recordedSlots ? Math.round((inRangeSlots / recordedSlots) * 100) : 0;
    elements.body.innerHTML = rows;
    elements.periodTitle.textContent = `Last ${days} days`;
    elements.targetCopy.textContent = targetRangeSummary(profile);
    elements.empty.classList.toggle("is-hidden", recordedSlots > 0);
    if (elements.recordedSlots) elements.recordedSlots.textContent = recordedSlots;
    if (elements.recordedMeta) elements.recordedMeta.textContent = `${recordedSlots} of ${totalSlots} grid cells contain data`;
    if (elements.inRangePercent) elements.inRangePercent.textContent = `${inRangePercent}%`;
    if (elements.inRangeMeta) elements.inRangeMeta.textContent = recordedSlots ? `${inRangeSlots} of ${recordedSlots} recorded slots` : "No readings in this period";
    if (elements.bestDay) elements.bestDay.textContent = bestDay?.count ? formatDate(bestDay.date, true) : "—";
    if (elements.bestDayMeta) elements.bestDayMeta.textContent = bestDay?.count ? `${bestDay.count} of ${heatmapContexts.length} time slots recorded` : "Record glucose to build the map";
  }

  function renderGlucoseHeatmap() {
    if (!state.profile) return;
    renderHeatmap({
      readings: state.readings,
      profile: state.profile,
      days: state.heatmapDays,
      elements: {
        head: $("#heatmapHead"), body: $("#heatmapBody"), periodTitle: $("#heatmapPeriodTitle"), targetCopy: $("#heatmapTargetCopy"), empty: $("#heatmapEmpty"),
        recordedSlots: $("#heatmapRecordedSlots"), recordedMeta: $("#heatmapRecordedMeta"), inRangePercent: $("#heatmapInRangePercent"), inRangeMeta: $("#heatmapInRangeMeta"), bestDay: $("#heatmapBestDay"), bestDayMeta: $("#heatmapBestDayMeta"),
      },
    });
  }

  function renderDoctorGlucoseHeatmap(patient = state.selectedPatient) {
    if (!patient) return;
    renderHeatmap({
      readings: patient.readings,
      profile: patient.profile,
      days: state.doctorHeatmapDays,
      elements: {
        head: $("#doctorHeatmapHead"), body: $("#doctorHeatmapBody"), periodTitle: $("#doctorHeatmapPeriodTitle"), targetCopy: $("#doctorHeatmapTargetCopy"), empty: $("#doctorHeatmapEmpty"),
      },
    });
  }

  function renderPatientInsights() {
    const metrics = metricsFor(state.readings, state.profile, state.rangeDays);
    $("#chartPeriodTitle").textContent = `Last ${state.rangeDays} days`;
    $("#insightAverage").innerHTML = `${metrics.average || "—"} <em>mg/dL</em>`;
    $("#insightRange").innerHTML = `${metrics.inRangePercent}<em>%</em>`;
    $("#insightRangeCount").textContent = `${metrics.inRange} of ${metrics.period.length} readings`;
    $("#insightHigh").innerHTML = `${metrics.highest?.value || "—"} <em>mg/dL</em>`;
    $("#insightHighMeta").textContent = metrics.highest ? contextLabels[metrics.highest.context] || metrics.highest.context : "No readings";
    $("#insightLow").innerHTML = `${metrics.lowest?.value || "—"} <em>mg/dL</em>`;
    $("#insightLowMeta").textContent = metrics.lowest ? contextLabels[metrics.lowest.context] || metrics.lowest.context : "No readings";
    renderLineChart($("#insightsChart"), state.readings, state.profile, state.rangeDays, "insights");
    renderInsightList(metrics);
    renderHistory($("#patientHistoryBody"), metrics.period.slice(0, 10), state.profile);
    refreshIcons();
  }

  function renderInsightList(metrics) {
    const container = $("#insightList");
    if (!metrics.period.length) {
      container.innerHTML = `<div class="insight-item"><span><i data-lucide="info"></i></span><div><strong>More data is needed</strong><small>Record glucose consistently to unlock pattern observations.</small></div></div>`;
      return;
    }
    const fasting = metrics.period.filter((reading) => reading.context === "fasting");
    const afterMeal = metrics.period.filter((reading) => reading.context.startsWith("after-"));
    const fastingAverage = fasting.length ? Math.round(fasting.reduce((sum, reading) => sum + reading.value, 0) / fasting.length) : null;
    const afterMealAverage = afterMeal.length ? Math.round(afterMeal.reduce((sum, reading) => sum + reading.value, 0) / afterMeal.length) : null;
    const fastingRange = targetRangeFor(state.profile, "fasting");
    const nonFastingRange = targetRangeFor(state.profile, "after-breakfast");
    const outCount = metrics.period.length - metrics.inRange;
    const items = [
      { icon: "target", title: `${metrics.inRangePercent}% of readings are within target`, copy: targetRangeSummary(state.profile), warning: metrics.inRangePercent < 70 },
      fastingAverage ? { icon: "sunrise", title: `Average fasting value: ${fastingAverage} mg/dL`, copy: `${fasting.length} reading${fasting.length === 1 ? "" : "s"} · Target ${fastingRange.minimum}–${fastingRange.maximum} mg/dL.`, warning: fastingAverage < fastingRange.minimum || fastingAverage > fastingRange.maximum } : null,
      afterMealAverage ? { icon: "utensils", title: `Average after-meal value: ${afterMealAverage} mg/dL`, copy: `${afterMeal.length} reading${afterMeal.length === 1 ? "" : "s"} · Target ${nonFastingRange.minimum}–${nonFastingRange.maximum} mg/dL.`, warning: afterMealAverage < nonFastingRange.minimum || afterMealAverage > nonFastingRange.maximum } : null,
      { icon: outCount ? "triangle-alert" : "circle-check-big", title: outCount ? `${outCount} reading${outCount === 1 ? "" : "s"} need review` : "No out-of-range readings in this period", copy: outCount ? "Check the meal, activity and medicine context with your clinician." : "Continue recording values consistently.", warning: outCount > 0 },
    ].filter(Boolean);
    container.innerHTML = items.map((item) => `<div class="insight-item ${item.warning ? "warning" : ""}"><span><i data-lucide="${item.icon}"></i></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.copy)}</small></div></div>`).join("");
  }

  function renderHistory(body, readings, profile) {
    if (!readings.length) {
      body.innerHTML = `<tr><td colspan="4">No readings available.</td></tr>`;
      return;
    }
    body.innerHTML = readings.map((reading) => {
      const status = statusFor(reading.value, profile, reading.context);
      return `<tr><td><strong>${formatDate(reading.recordedAt, true)}</strong><br><small>${formatTime(reading.recordedAt)}</small></td><td>${escapeHtml(contextLabels[reading.context] || reading.context)}</td><td class="value-cell">${reading.value} <small>mg/dL</small></td><td><span class="status-badge ${status.key}">${status.label}</span></td></tr>`;
    }).join("");
  }

  function patientSummary(patient) {
    if (patient.summary?.latestReading !== undefined || patient.summary?.latest) {
      const summary = patient.summary;
      const latest = summary.latest || (summary.latestReading ? normalizeReading(summary.latestReading) : null);
      return {
        latest,
        average: Number(summary.average7d ?? summary.average) || 0,
        inRangePercent: Number(summary.inRangePercent) || 0,
        missing: !latest || Date.now() - new Date(latest.recordedAt).getTime() > 3 * 86400000,
      };
    }
    const metrics = metricsFor(patient.readings, patient.profile, 7);
    return { latest: metrics.latest, average: metrics.average, inRangePercent: metrics.inRangePercent, missing: !metrics.latest || Date.now() - new Date(metrics.latest.recordedAt).getTime() > 3 * 86400000 };
  }

  function patientCategory(patient) {
    const summary = patientSummary(patient);
    if (summary.missing) return "missing";
    return statusFor(summary.latest.value, patient.profile, summary.latest.context).key === "good" ? "stable" : "attention";
  }

  function renderDoctorOverview() {
    $("#doctorToday").textContent = todayLabel();
    $("#doctorGreeting").textContent = `${greeting()}, Dr. Prashant`;
    const categories = state.doctorPatients.map(patientCategory);
    $("#doctorPatientCount").textContent = state.doctorPatients.length;
    $("#doctorAttentionCount").textContent = categories.filter((category) => category === "attention").length;
    $("#doctorRangeCount").textContent = categories.filter((category) => category === "stable").length;
    $("#doctorMissingCount").textContent = categories.filter((category) => category === "missing").length;
    renderDoctorTable();
  }

  function renderDoctorTable() {
    const query = $("#patientSearch").value.trim().toLowerCase();
    const patients = state.doctorPatients.filter((patient) => {
      const matchesSearch = !query || patient.profile.name.toLowerCase().includes(query) || patient.profile.patientId.toLowerCase().includes(query);
      const category = patientCategory(patient);
      const matchesFilter = state.patientFilter === "all" || state.patientFilter === category || (state.patientFilter === "attention" && category === "missing");
      return matchesSearch && matchesFilter;
    });
    const body = $("#doctorPatientBody");
    $("#doctorEmpty").classList.toggle("is-hidden", patients.length > 0);
    $(".patient-table-wrap").classList.toggle("is-hidden", patients.length === 0);
    body.innerHTML = patients.map((patient) => {
      const summary = patientSummary(patient);
      const category = patientCategory(patient);
      const status = category === "missing" ? { key: "missing", label: "No recent entry" } : statusFor(summary.latest.value, patient.profile, summary.latest.context);
      const fillClass = `fill-${Math.round(Math.max(0, Math.min(100, summary.inRangePercent)) / 10) * 10}`;
      return `<tr><td><div class="patient-cell"><span class="patient-avatar ${patient.color || ""}">${escapeHtml(initials(patient.profile.name))}</span><div><strong>${escapeHtml(patient.profile.name)}</strong><span>${escapeHtml(patient.profile.patientId)} · ${escapeHtml(patient.profile.diabetesType)}</span></div></div></td><td><div class="patient-value"><strong>${summary.latest ? `${summary.latest.value} mg/dL` : "—"}</strong><span>${summary.latest ? escapeHtml(contextLabels[summary.latest.context] || summary.latest.context) : "No reading"}</span></div></td><td class="value-cell">${summary.average || "—"} <small>mg/dL</small></td><td><div class="range-meter"><small>${summary.inRangePercent}%</small><span><b class="${fillClass}"></b></span></div></td><td>${summary.latest ? `${formatDate(summary.latest.recordedAt)}<br><small>${formatTime(summary.latest.recordedAt)}</small>` : "—"}</td><td><span class="status-badge ${status.key}">${status.label}</span></td><td><button type="button" class="row-action" data-patient-id="${escapeHtml(patient.profile.patientId)}" aria-label="Open ${escapeHtml(patient.profile.name)}"><i data-lucide="chevron-right"></i></button></td></tr>`;
    }).join("");
    refreshIcons();
  }

  async function openDoctorPatient(patientId) {
    const patient = state.doctorPatients.find((item) => item.profile.patientId === patientId);
    if (!patient) return;
    if (state.authMode === "aws" && !patient.readings.length) {
      try {
        const result = await window.KaaryaAWS.getPatientGlucose(patientId, { days: 120 });
        patient.readings = (result.readings || []).map(normalizeReading);
        if (result.profile) patient.profile = normalizeProfile(result.profile);
      } catch (error) {
        toast(error.message || "Could not load this patient’s readings.", "error");
        return;
      }
    }
    state.selectedPatient = patient;
    renderDoctorPatient(patient);
    showScreen("doctor-patient");
  }

  function renderDoctorPatient(patient) {
    const metrics = metricsFor(patient.readings, patient.profile, 7);
    const latest = metrics.latest;
    const status = latest ? statusFor(latest.value, patient.profile, latest.context) : { key: "missing", label: "No recent entry" };
    $("#detailInitials").textContent = initials(patient.profile.name);
    $("#detailPatientId").textContent = patient.profile.patientId;
    $("#detailName").textContent = patient.profile.name;
    $("#detailMeta").textContent = `${ageFromDate(patient.profile.dateOfBirth)} years · ${patient.profile.gender || "Not specified"} · ${patient.profile.diabetesType}`;
    $("#detailStatus").textContent = status.label;
    $("#detailStatus").className = `status-badge ${status.key}`;
    $("#detailLatest").innerHTML = `${latest?.value || "—"} <em>mg/dL</em>`;
    $("#detailLatestMeta").textContent = latest ? `${contextLabels[latest.context] || latest.context} · ${formatDate(latest.recordedAt)}, ${formatTime(latest.recordedAt)}` : "No reading available";
    $("#detailAverage").innerHTML = `${metrics.average || "—"} <em>mg/dL</em>`;
    $("#detailRange").innerHTML = `${metrics.inRangePercent}<em>%</em>`;
    $("#detailTarget").textContent = targetRangeSummary(patient.profile);
    $("#detailLastSeen").textContent = latest ? formatDate(latest.recordedAt) : "No data";
    $("#detailLastSeenTime").textContent = latest ? formatTime(latest.recordedAt) : "—";
    $("#detailProfile").innerHTML = [
      ["Mobile", patient.profile.phone || "—"], ["Email", patient.profile.email || "—"], ["Location", patient.profile.city || "—"], ["Diabetes", patient.profile.diabetesType], ["Diagnosed", patient.profile.diagnosisYear || "—"], ["Fasting target", `${patient.profile.fastingTargetMin}–${patient.profile.fastingTargetMax} mg/dL`], ["Non-fasting target", `${patient.profile.nonFastingTargetMin}–${patient.profile.nonFastingTargetMax} mg/dL`], ["Emergency contact", patient.profile.emergencyName ? `${patient.profile.emergencyName} · ${patient.profile.emergencyPhone || ""}` : "—"],
    ].map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
    renderLineChart($("#doctorPatientChart"), patient.readings, patient.profile, 30, "doctor");
    renderDoctorGlucoseHeatmap(patient);
    renderHistory($("#doctorHistoryBody"), sortedReadings(patient.readings).slice(0, 10), patient.profile);
    refreshIcons();
  }

  async function routeAuthenticatedSession(session, intendedRole = "patient") {
    if (!session) return false;
    if (intendedRole === "doctor" && session.role !== "doctor") {
      window.KaaryaAWS.clearSession();
      state.awsSession = null;
      showAuthStep("signin");
      toast("This account is not authorised for the doctor portal. Ask the clinic administrator to add it to the DOCTOR group.", "error");
      return false;
    }
    state.awsSession = session;
    if (session.role === "doctor") await enterDoctor({ live: true });
    else await enterPatient({ live: true });
    return true;
  }

  async function handleIdentitySubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const identity = $("#identityInput").value.trim().toLowerCase();
    const password = $("#passwordInput").value;
    if (!window.KaaryaAWS?.isConfigured()) {
      toast("The secure service configuration is unavailable. Please contact Kaarya Wellness.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) {
      toast("Enter the email address registered with Kaarya Wellness.", "error");
      return;
    }
    const button = $("button[type='submit']", form);
    button.disabled = true;
    try {
      const result = await window.KaaryaAWS.passwordSignIn({ identifier: identity, password, intendedRole: state.authRole });
      if (result.session) {
        await routeAuthenticatedSession(result.session, state.authRole);
      } else if (result.challenge === "NEW_PASSWORD_REQUIRED") {
        state.pendingChallenge = result;
        showAuthStep("new-password");
      } else {
        throw new Error(`This account requires an unsupported Cognito challenge (${result.challenge || "unknown"}).`);
      }
    } catch (error) {
      const pending = loadPendingRegistration();
      const canResumeVerification = state.authRole === "patient"
        && pending?.email === identity
        && ["UserNotConfirmedException", "UserNotFoundException"].includes(error.code);
      if (canResumeVerification) {
        state.pendingRegistration = { ...pending, password };
        $("#confirmationCopy").textContent = `Enter the verification code sent to ${identity}, or request a new one.`;
        showAuthStep("confirmation");
        toast("Verify the patient email before signing in.", "error");
        return;
      }
      toast(error.message || "Sign-in could not be completed.", "error");
    } finally {
      button.disabled = false;    }
  }

  async function handleRegistrationSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const email = String(values.email || "").trim().toLowerCase();
    const password = String(values.password || "");
    const registrationProfile = {
      fastingTargetMin: Number(values.fastingTargetMin),
      fastingTargetMax: Number(values.fastingTargetMax),
      nonFastingTargetMin: Number(values.nonFastingTargetMin),
      nonFastingTargetMax: Number(values.nonFastingTargetMax),
    };
    if (!window.KaaryaAWS?.isConfigured()) {
      toast("The secure service configuration is unavailable. Please contact Kaarya Wellness.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("Enter a valid email address for verification.", "error");
      return;
    }
    const targetError = validateTargetRanges(registrationProfile);
    if (targetError) {
      toast(targetError, "error");
      return;
    }
    if (password !== String(values.confirmPassword || "")) {
      toast("The two passwords do not match.", "error");
      return;
    }
    if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      toast("Use at least 10 characters with uppercase, lowercase, number and symbol.", "error");
      return;
    }

    const button = $("button[type='submit']", form);
    button.disabled = true;
    try {
      const result = await window.KaaryaAWS.registerPatient({ password, name: String(values.name || "").trim(), email });
      state.pendingRegistration = { username: result.InternalUsername, password, name: String(values.name || "").trim(), email, ...registrationProfile };
      savePendingRegistration(state.pendingRegistration);
      if (result.UserConfirmed) {
        const signIn = await window.KaaryaAWS.passwordSignIn({ identifier: email, password, intendedRole: "patient" });
        const routed = await routeAuthenticatedSession(signIn.session, "patient");
        if (routed) {
          state.pendingRegistration = null;
        }
        return;
      }
      const delivery = result.CodeDeliveryDetails || {};
      $("#confirmationCopy").textContent = delivery.Destination
        ? `Enter the verification code sent to ${delivery.Destination}.`
        : `Enter the verification code sent to ${email}.`;
      showAuthStep("confirmation");
      toast("Account created. Enter the verification code to continue.");
    } catch (error) {
      toast(error.message || "The patient account could not be created.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function handleConfirmationSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!state.pendingRegistration) {
      showAuthStep("signin");
      toast("Start registration again so the account can be verified.", "error");
      return;
    }
    const button = $("button[type='submit']", form);
    button.disabled = true;
    try {
      await window.KaaryaAWS.confirmRegistration({ username: state.pendingRegistration.username, code: form.elements.code.value });
      const signIn = await window.KaaryaAWS.passwordSignIn({ identifier: state.pendingRegistration.email, password: state.pendingRegistration.password, intendedRole: "patient" });
      form.reset();
      const routed = await routeAuthenticatedSession(signIn.session, "patient");
      if (routed) {
        state.pendingRegistration = null;
      }
    } catch (error) {
      toast(error.message || "The verification code could not be confirmed.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function handleResendCode() {
    if (!state.pendingRegistration) {
      showAuthStep("register");
      toast("Enter the registration details again to request a new code.", "error");
      return;
    }
    const button = $("#resendCodeButton");
    button.disabled = true;
    try {
      const result = await window.KaaryaAWS.resendConfirmationCode(state.pendingRegistration.username);
      const delivery = result.CodeDeliveryDetails || {};
      if (delivery.Destination) $("#confirmationCopy").textContent = `A new code was sent to ${delivery.Destination}.`;
      toast("A new verification code has been sent.");
    } catch (error) {
      toast(error.message || "A new verification code could not be sent.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function handleNewPasswordSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!state.pendingChallenge) {
      showAuthStep("signin");
      toast("Sign in again to set the permanent password.", "error");
      return;
    }
    const password = form.elements.password.value;
    if (password !== form.elements.confirmPassword.value) {
      toast("The two passwords do not match.", "error");
      return;
    }
    if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      toast("Use at least 10 characters with uppercase, lowercase, number and symbol.", "error");
      return;
    }
    const button = $("button[type='submit']", form);
    button.disabled = true;
    try {
      const challenge = state.pendingChallenge;
      const session = await window.KaaryaAWS.completeNewPassword({
        username: challenge.username,
        newPassword: password,
        challengeSession: challenge.challengeSession,
        intendedRole: challenge.intendedRole,
      });
      state.pendingChallenge = null;
      form.reset();
      await routeAuthenticatedSession(session, challenge.intendedRole);
    } catch (error) {
      toast(error.message || "The permanent password could not be set.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function signOut() {
    const live = state.authMode === "aws";
    state.currentRole = null;
    state.profile = null;
    state.readings = [];
    state.doctorPatients = [];
    state.awsSession = null;
    state.pendingChallenge = null;
    $("#portalShell").classList.add("is-hidden");
    $("#authView").classList.remove("is-hidden");
    showAuthStep("signin");
    window.scrollTo({ top: 0 });
    if (live) await window.KaaryaAWS.signOut();
  }

  async function initializeAwsSession() {
    if (!window.KaaryaAWS?.isConfigured()) return;
    try {
      const session = window.KaaryaAWS.getSession();
      if (!session) return;
      await routeAuthenticatedSession(session, session.intendedRole || "patient");
    } catch (error) {
      toast(error.message || "AWS sign-in could not be completed.", "error");
    }
  }

  function bindEvents() {
    $$("[data-auth-role]").forEach((button) => button.addEventListener("click", () => setAuthRole(button.dataset.authRole)));
    $("#identityForm").addEventListener("submit", handleIdentitySubmit);
    $("#registerButton").addEventListener("click", () => showAuthStep("register"));
    $("#registrationForm").addEventListener("submit", handleRegistrationSubmit);
    $("#confirmationForm").addEventListener("submit", handleConfirmationSubmit);
    $("#newPasswordForm").addEventListener("submit", handleNewPasswordSubmit);
    $("#resendCodeButton").addEventListener("click", handleResendCode);
    $$("[data-auth-back]").forEach((button) => button.addEventListener("click", () => {
      state.pendingChallenge = null;
      showAuthStep("signin");
    }));
    $$("[data-demo-role]").forEach((button) => button.addEventListener("click", () => button.dataset.demoRole === "doctor" ? enterDoctor() : enterPatient()));
    document.addEventListener("click", (event) => {
      const navButton = event.target.closest("[data-nav]");
      if (navButton) showScreen(navToScreen(navButton.dataset.nav));
      const patientButton = event.target.closest("[data-patient-id]");
      if (patientButton) openDoctorPatient(patientButton.dataset.patientId);
      if (event.target.closest("[data-signout]")) signOut();
    });
    $("#profileForm").addEventListener("submit", saveProfile);
    $("#glucoseForm").addEventListener("submit", saveGlucose);
    $$("[data-range]").forEach((button) => button.addEventListener("click", () => {
      state.rangeDays = Number(button.dataset.range);
      $$("[data-range]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderPatientInsights();
    }));
    $$("[data-heatmap-range]").forEach((button) => button.addEventListener("click", () => {
      state.heatmapDays = Number(button.dataset.heatmapRange);
      $$("[data-heatmap-range]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderGlucoseHeatmap();
    }));
    $$("[data-doctor-heatmap-range]").forEach((button) => button.addEventListener("click", () => {
      state.doctorHeatmapDays = Number(button.dataset.doctorHeatmapRange);
      $$("[data-doctor-heatmap-range]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderDoctorGlucoseHeatmap();
    }));
    $$("[data-patient-filter]").forEach((button) => button.addEventListener("click", () => {
      state.patientFilter = button.dataset.patientFilter;
      $$("[data-patient-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderDoctorTable();
    }));
    $("#patientSearch").addEventListener("input", renderDoctorTable);
    $("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("is-open"));
  }

  async function init() {
    bindEvents();
    showAuthStep("signin");
    setGlucoseDateTime();
    refreshIcons();
    await initializeAwsSession();
  }

  init();
})();