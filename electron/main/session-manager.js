// Tracks the current active focus session in memory.
// Persisted state lives in db.js; this is the runtime state.

const sessionState = {
  active: false,
  sessionId: null,
  topic: null,
  workType: null,
  startTime: null,
  plannedEndTime: null,

  // The current "drift in progress" — tab user is on that was classified as distraction
  currentDrift: {
    url: null,
    title: null,
    appName: null,
    windowTitle: null,
    tabId: null,
    detectedAt: null,
    timerHandle: null,
    classification: null,
    popupShown: false
  },

  // Session-scoped whitelist (URLs / domains / apps the user clicked "wrong guess" on)
  whitelistedUrls: new Set(),
  whitelistedDomains: new Set(),
  whitelistedApps: new Set(),

  // Snooze tracking
  snoozesUsed: 0,
  maxSnoozes: 2,
  inSnoozeWindow: false,
  snoozeEndTime: null,
  snoozeTimerHandle: null
};

function startSession({ sessionId, topic, workType, durationMin }) {
  sessionState.active = true;
  sessionState.sessionId = sessionId;
  sessionState.topic = topic;
  sessionState.workType = workType;
  sessionState.startTime = Date.now();
  sessionState.plannedEndTime = Date.now() + durationMin * 60 * 1000;
  sessionState.whitelistedUrls = new Set();
  sessionState.whitelistedDomains = new Set();
  sessionState.whitelistedApps = new Set();
  sessionState.snoozesUsed = 0;
  cancelSnooze();
  resetDrift();
}

function stopSession() {
  resetDrift();
  cancelSnooze();
  sessionState.active = false;
  sessionState.sessionId = null;
  sessionState.topic = null;
  sessionState.workType = null;
  sessionState.startTime = null;
  sessionState.plannedEndTime = null;
}

function isActive() {
  return sessionState.active;
}

function getState() {
  return sessionState;
}

function resetDrift() {
  if (sessionState.currentDrift.timerHandle) {
    clearTimeout(sessionState.currentDrift.timerHandle);
  }
  sessionState.currentDrift = {
    url: null,
    title: null,
    appName: null,
    windowTitle: null,
    tabId: null,
    detectedAt: null,
    timerHandle: null,
    classification: null,
    popupShown: false
  };
}

function cancelDriftTimer() {
  if (sessionState.currentDrift.timerHandle) {
    clearTimeout(sessionState.currentDrift.timerHandle);
    sessionState.currentDrift.timerHandle = null;
  }
}

function cancelSnooze() {
  if (sessionState.snoozeTimerHandle) {
    clearTimeout(sessionState.snoozeTimerHandle);
    sessionState.snoozeTimerHandle = null;
  }
  sessionState.inSnoozeWindow = false;
  sessionState.snoozeEndTime = null;
}

function addWhitelist({ url, domain, appName }) {
  if (url) sessionState.whitelistedUrls.add(url);
  if (domain) sessionState.whitelistedDomains.add(domain);
  if (appName) sessionState.whitelistedApps.add(appName);
}

function isWhitelisted({ url, domain, appName }) {
  return (
    (url && sessionState.whitelistedUrls.has(url)) ||
    (domain && sessionState.whitelistedDomains.has(domain)) ||
    (appName && sessionState.whitelistedApps.has(appName))
  );
}

function startSnooze(durationMs = 5 * 60 * 1000) {
  if (sessionState.snoozeTimerHandle) clearTimeout(sessionState.snoozeTimerHandle);
  sessionState.snoozesUsed += 1;
  sessionState.inSnoozeWindow = true;
  sessionState.snoozeEndTime = Date.now() + durationMs;
  sessionState.snoozeTimerHandle = setTimeout(() => {
    sessionState.inSnoozeWindow = false;
    sessionState.snoozeEndTime = null;
    sessionState.snoozeTimerHandle = null;
  }, durationMs);
}

function snoozesLeft() {
  return Math.max(0, sessionState.maxSnoozes - sessionState.snoozesUsed);
}

module.exports = {
  startSession,
  stopSession,
  isActive,
  getState,
  resetDrift,
  cancelDriftTimer,
  addWhitelist,
  isWhitelisted,
  startSnooze,
  snoozesLeft
};
