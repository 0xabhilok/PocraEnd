// Tracks the current active focus session in memory.
// Persisted state lives in db.js; this is the runtime state.
//
// New in the drift-accuracy rework:
//   - distractionAccumulator  : per-key cumulative time spent on a distraction
//                               across the session, with idle decay. Used by
//                               intervention.js to fire popups based on
//                               cumulative (not continuous) exposure.
//   - chatTimeMs              : per-key cumulative time spent on chat apps.
//                               Soft budget; a single popup fires once exceeded.
//   - onSnoozeEndCallback     : invoked when the snooze window expires so the
//                               pipeline can re-evaluate the current activity
//                               instead of staying silent forever.

// Tunable: after this many ms of NOT being on a distraction key, the
// accumulator entry resets to 0 on re-entry. Long enough that bathroom
// breaks don't reset progress; short enough that "I left this 3 minutes ago
// and just came back" feels like a fresh visit.
const IDLE_DECAY_MS = 120_000;

const sessionState = {
  active: false,
  sessionId: null,
  topic: null,
  workType: null,
  startTime: null,
  plannedEndTime: null,

  // The popup attempt currently being scheduled. One at a time.
  currentDrift: {
    url: null,
    title: null,
    appName: null,
    windowTitle: null,
    tabId: null,
    detectedAt: null,
    timerHandle: null,
    classification: null,
    popupShown: false,
    key: null
  },

  // key -> { cumulativeMs, lastSeenAt }
  // Survives context switches; reset on session start/stop and on popup fire.
  distractionAccumulator: new Map(),

  // key -> cumulativeMs (no decay across the session — chat budget is per-session)
  chatTimeMs: new Map(),

  whitelistedUrls: new Set(),
  whitelistedDomains: new Set(),
  whitelistedApps: new Set(),

  snoozesUsed: 0,
  maxSnoozes: 2,
  inSnoozeWindow: false,
  snoozeEndTime: null,
  snoozeTimerHandle: null,

  // Set by intervention.js so we can re-evaluate the current tab when snooze ends.
  onSnoozeEndCallback: null
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
  sessionState.distractionAccumulator = new Map();
  sessionState.chatTimeMs = new Map();
  sessionState.snoozesUsed = 0;
  cancelSnooze();
  resetDrift();
}

function stopSession() {
  resetDrift();
  cancelSnooze();
  sessionState.distractionAccumulator.clear();
  sessionState.chatTimeMs.clear();
  sessionState.active = false;
  sessionState.sessionId = null;
  sessionState.topic = null;
  sessionState.workType = null;
  sessionState.startTime = null;
  sessionState.plannedEndTime = null;
}

function isActive() { return sessionState.active; }
function getState() { return sessionState; }

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
    popupShown: false,
    key: null
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

// ---------------------------------------------------------------------------
// Whitelist — apex-aware so "wrong guess" on www.reddit.com also covers
// m.reddit.com and old.reddit.com within the session.
// ---------------------------------------------------------------------------
function addWhitelist({ url, domain, appName }) {
  if (url) sessionState.whitelistedUrls.add(url);
  if (domain) {
    sessionState.whitelistedDomains.add(domain);
    const parts = domain.split('.');
    if (parts.length >= 2) {
      sessionState.whitelistedDomains.add(parts.slice(-2).join('.'));
    }
  }
  if (appName) sessionState.whitelistedApps.add(appName);
}

function isWhitelisted({ url, domain, appName }) {
  if (url && sessionState.whitelistedUrls.has(url)) return true;
  if (domain) {
    if (sessionState.whitelistedDomains.has(domain)) return true;
    const parts = domain.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      if (sessionState.whitelistedDomains.has(parts.slice(i).join('.'))) return true;
    }
  }
  if (appName && sessionState.whitelistedApps.has(appName)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Snooze — fires onSnoozeEndCallback so the pipeline can re-check the
// current activity instead of leaving the user invisibly on a distraction.
// ---------------------------------------------------------------------------
function setOnSnoozeEnd(cb) {
  sessionState.onSnoozeEndCallback = cb;
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
    if (typeof sessionState.onSnoozeEndCallback === 'function') {
      try { sessionState.onSnoozeEndCallback(); } catch { /* swallow */ }
    }
  }, durationMs);
}

function snoozesLeft() {
  return Math.max(0, sessionState.maxSnoozes - sessionState.snoozesUsed);
}

// ---------------------------------------------------------------------------
// Distraction accumulator — cumulative per-key timing with idle decay.
// ---------------------------------------------------------------------------
function getDistractionEntry(key) {
  if (!key) return null;
  return sessionState.distractionAccumulator.get(key) || null;
}

// Read-or-create. Applies idle decay in place: if we last saw this key more
// than IDLE_DECAY_MS ago, the cumulative is treated as a fresh visit.
function ensureFreshAccumulatorEntry(key) {
  if (!key) return { cumulativeMs: 0, lastSeenAt: 0 };
  let e = sessionState.distractionAccumulator.get(key);
  if (!e) {
    e = { cumulativeMs: 0, lastSeenAt: 0 };
    sessionState.distractionAccumulator.set(key, e);
    return e;
  }
  if (e.lastSeenAt && Date.now() - e.lastSeenAt > IDLE_DECAY_MS) {
    e.cumulativeMs = 0;
  }
  return e;
}

function addDistractionTime(key, deltaMs) {
  if (!key || deltaMs <= 0) return;
  const e = ensureFreshAccumulatorEntry(key);
  e.cumulativeMs += deltaMs;
  e.lastSeenAt = Date.now();
  sessionState.distractionAccumulator.set(key, e);
}

function resetDistractionAccumulator(key) {
  if (!key) return;
  sessionState.distractionAccumulator.delete(key);
}

// ---------------------------------------------------------------------------
// Chat-time accumulator — same shape, simpler semantics (no decay).
// ---------------------------------------------------------------------------
function getChatTime(key) {
  if (!key) return 0;
  return sessionState.chatTimeMs.get(key) || 0;
}

function addChatTime(key, deltaMs) {
  if (!key || deltaMs <= 0) return;
  sessionState.chatTimeMs.set(key, (sessionState.chatTimeMs.get(key) || 0) + deltaMs);
}

function resetChatTime(key) {
  if (!key) return;
  sessionState.chatTimeMs.delete(key);
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
  snoozesLeft,
  setOnSnoozeEnd,
  // accumulator
  getDistractionEntry,
  ensureFreshAccumulatorEntry,
  addDistractionTime,
  resetDistractionAccumulator,
  // chat
  getChatTime,
  addChatTime,
  resetChatTime,
  // constants
  IDLE_DECAY_MS
};
