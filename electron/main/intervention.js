// The brain of PocraEnd. Decides when to intervene and how.
//
// Architecture notes (read before editing):
//
// * Activity events arrive from two sources: the Chrome extension (browser
//   tabs) and active-win (desktop apps). Both call handleActivityChange().
//
// * Every context change increments `contextVersion`. This is a cancellation
//   token that flows through the entire async pipeline. Any async work
//   (LLM call, drift timer, popup show) checks the version before producing
//   a side effect. If the version is stale, the result is silently dropped.
//
// * Three "current key" trackers cooperate to detect context changes:
//     - lastClassifiedKey : last key we *completed* a classification for
//     - inFlightKey       : last key we *started* a classification for
//     - currentDrift.key  : key of the popup currently being scheduled
//   Earlier versions only checked the first two; that missed the race where
//   a tab switch arrives BEFORE the first LLM responds and so version
//   never bumped. inFlightKey closes that window.
//
// * Drift detection is now CUMULATIVE, not continuous. Every distraction
//   key has an entry in sm.distractionAccumulator that survives context
//   switches. When the same key re-enters and cumulative ≥ DRIFT_THRESHOLD_MS,
//   a popup fires. Idle decay (sm.IDLE_DECAY_MS) wipes the cumulative if
//   the user has been away from the key long enough for it to count as a
//   fresh visit. This kills the alt-tab gaming vector: hopping to a safe
//   tab every 4 seconds no longer resets the clock.
//
// * Soft-neutral activity (chat apps) has its own cumulative budget.
//   Silent up to CHAT_BUDGET_MS, then a single popup, then the budget
//   resets for the next window.
//
// * Fallback classifications (Ollama down, Gemini missing) NEVER produce
//   popups. Low-confidence LLM verdicts also never produce popups. This
//   is the "prefer silence over wrong popup" policy.
//
// * Auto-closed popups schedule a single re-check after
//   POPUP_IGNORE_RECHECK_MS, so ignoring one popup doesn't grant a free
//   pass for the rest of the session.

const sm = require('./session-manager');
const { checkRules, checkAppRules, extractDomain } = require('./allowlist');
const { classifyDistraction, generateMotivation } = require('./llm-router');
const {
  logDriftEvent,
  incrementSessionCounter,
  addToSessionWhitelist,
  getSettings
} = require('./db');
const {
  showInterventionPopup,
  closeInterventionPopup,
  setOnIgnoredCallback
} = require('./popup-window');

// ---- Tunables ---------------------------------------------------------------
const DRIFT_THRESHOLD_MS = 5000;        // cumulative ms on a distraction key → popup
const MIN_DRIFT_DELAY_MS = 1000;        // never fire faster than this after enter
const CHAT_BUDGET_MS = 10 * 60 * 1000;  // cumulative chat-app time per budget window
const POPUP_IGNORE_RECHECK_MS = 60_000; // gap before re-checking after auto-close
const LOW_CONF_DISTRACTION_THRESHOLD = 0.6;

// ---- Cancellation token -----------------------------------------------------
let contextVersion = 0;

// ---- Dedup / in-flight state -----------------------------------------------
let lastClassifiedKey = null;
let inFlightKey = null;

// ---- Live-distraction tracking ---------------------------------------------
// liveDistractionKey is the key we are currently accruing time on (if any).
// liveDistractionStartedAt is when we started accruing. commitLiveDistractionTime
// flushes the delta into sm.distractionAccumulator and clears these two.
let liveDistractionKey = null;
let liveDistractionStartedAt = null;

// Same for chat apps (separate budget).
let liveChatKey = null;
let liveChatStartedAt = null;

// Popup ignore re-check timer (single-flight).
let popupIgnoreTimer = null;

let mainWindowGetter = () => null;

function setMainWindowGetter(fn) {
  mainWindowGetter = fn;
}

// ---- Logging ---------------------------------------------------------------
function log(event, details = {}) {
  const ts = new Date().toISOString().slice(11, 23);
  const detailStr = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join(' ');
  console.log(`[intervention] ${ts} v${contextVersion} ${event}${detailStr ? ' ' + detailStr : ''}`);
}

// ---- Key normalization -----------------------------------------------------
// For browser tabs, the key is `browser::<canonical-host><pathname>` so the
// same logical resource accumulates under one key regardless of www/m/mobile
// redirects or query-string changes (HLS players, SPAs).
function normalizeKey(data) {
  if (data.url) {
    try {
      const u = new URL(data.url);
      const host = u.hostname.replace(/^(www|m|mobile|mbasic|web)\./, '');
      const verdict = checkRules({ url: data.url, workType: sm.getState().workType });
      if (verdict === 'block' || verdict === 'soft-neutral') {
        return `browser::${host}`;
      }
      return `browser::${host}${u.pathname}`;
    } catch {
      return `browser::${data.url}`;
    }
  }
  if (data.appName) return `desktop::${data.appName.toLowerCase()}`;
  return null;
}

// ---- Live tracker helpers --------------------------------------------------
function commitLiveDistractionTime() {
  if (liveDistractionKey && liveDistractionStartedAt) {
    const delta = Date.now() - liveDistractionStartedAt;
    sm.addDistractionTime(liveDistractionKey, delta);
    log('accrue-distraction', {
      key: liveDistractionKey,
      deltaMs: delta,
      totalMs: sm.getDistractionEntry(liveDistractionKey)?.cumulativeMs
    });
  }
  liveDistractionKey = null;
  liveDistractionStartedAt = null;
}

function commitLiveChatTime() {
  if (liveChatKey && liveChatStartedAt) {
    const delta = Date.now() - liveChatStartedAt;
    sm.addChatTime(liveChatKey, delta);
    log('accrue-chat', {
      key: liveChatKey,
      deltaMs: delta,
      totalMs: sm.getChatTime(liveChatKey)
    });
  }
  liveChatKey = null;
  liveChatStartedAt = null;
}

function clearPopupIgnoreTimer() {
  if (popupIgnoreTimer) {
    clearTimeout(popupIgnoreTimer);
    popupIgnoreTimer = null;
  }
}

// ---- Context change --------------------------------------------------------
// Increments the cancellation token and tears down state that belongs to the
// previous context. Commits any in-progress distraction/chat time first so the
// accumulator survives the reset.
function onContextChanged(reason) {
  const old = contextVersion;
  contextVersion += 1;
  commitLiveDistractionTime();
  commitLiveChatTime();
  sm.cancelDriftTimer();
  if (sm.getState().currentDrift.popupShown) {
    closeInterventionPopup();
  }
  sm.resetDrift();
  lastClassifiedKey = null;
  inFlightKey = null;
  clearPopupIgnoreTimer();
  log('context-changed', { from: `v${old}`, to: `v${contextVersion}`, reason });
}

// ---- Main entry ------------------------------------------------------------
async function handleActivityChange(data) {
  const newKey = normalizeKey(data);
  const target = data.url || data.appName || '(unknown)';
  const titleSnippet = (data.title || data.windowTitle || '').slice(0, 80);

  log('activity-in', { source: data.source, target, title: titleSnippet, key: newKey });

  if (!sm.isActive()) {
    return log('skip', { reason: 'no-active-session' });
  }
  if (sm.getState().inSnoozeWindow) {
    return log('skip', { reason: 'in-snooze-window' });
  }

  // --- Detect context change ---
  // FIX (race C4 from audit): also bump version when we have an inFlightKey
  // that differs from newKey. The earlier code only triggered onContextChanged
  // off currentDrift.key or lastClassifiedKey — both null in the window
  // before the first LLM responds — letting a stale drift timer fire for
  // a tab the user already left.
  const liveDriftKey = sm.getState().currentDrift.key;
  if (liveDriftKey && newKey !== liveDriftKey) {
    onContextChanged(`drift-tab-switched-away from ${liveDriftKey}`);
  } else if (inFlightKey && newKey !== inFlightKey) {
    onContextChanged(`inflight-tab-switched-away from ${inFlightKey}`);
  } else if (lastClassifiedKey && newKey !== lastClassifiedKey && !liveDriftKey) {
    onContextChanged(`classified-tab-switched-away from ${lastClassifiedKey}`);
  }

  const myVersion = contextVersion;

  // --- Dedup ---
  if (newKey && newKey === lastClassifiedKey) {
    return log('skip', { reason: 'dedup-same-key', key: newKey });
  }

  // --- Session-scoped whitelist ---
  if (data.url) {
    const domain = extractDomain(data.url);
    if (sm.isWhitelisted({ url: data.url, domain })) {
      log('skip', { reason: 'whitelisted-url', domain });
      lastClassifiedKey = newKey;
      commitLiveDistractionTime();
      commitLiveChatTime();
      return;
    }
  } else if (data.appName && sm.isWhitelisted({ appName: data.appName })) {
    log('skip', { reason: 'whitelisted-app', app: data.appName });
    lastClassifiedKey = newKey;
    commitLiveDistractionTime();
    commitLiveChatTime();
    return;
  }

  // Mark this key as the latest in-flight target — closes the race window.
  inFlightKey = newKey;

  // --- Rules layer ---
  if (data.url) {
    const verdict = checkRules({ url: data.url, workType: sm.getState().workType });
    log('rules-verdict', { domain: extractDomain(data.url), verdict });

    if (verdict === 'allow' || verdict === 'neutral') {
      lastClassifiedKey = newKey;
      commitLiveDistractionTime();
      commitLiveChatTime();
      return;
    }
    if (verdict === 'soft-neutral') {
      lastClassifiedKey = newKey;
      handleSoftNeutral(newKey, data, myVersion);
      return;
    }
    if (verdict === 'block') {
      lastClassifiedKey = newKey;
      commitLiveChatTime();
      enterDistraction(newKey, {
        ...data,
        classification: { verdict: 'DISTRACTION', confidence: 1, source: 'rules', reason: 'known-distraction' }
      }, myVersion);
      return;
    }
  } else if (data.appName) {
    const appVerdict = checkAppRules({ appName: data.appName });
    log('rules-verdict', { app: data.appName, verdict: appVerdict });

    if (appVerdict === 'allow' || appVerdict === 'neutral') {
      lastClassifiedKey = newKey;
      commitLiveDistractionTime();
      commitLiveChatTime();
      return;
    }
    if (appVerdict === 'soft-neutral') {
      lastClassifiedKey = newKey;
      handleSoftNeutral(newKey, data, myVersion);
      return;
    }
    // unknown — fall through to LLM (rare for desktop apps)
  }

  // --- LLM classification ---
  const context = {
    topic: sm.getState().topic,
    workType: sm.getState().workType,
    title: data.title,
    url: data.url,
    appName: data.appName,
    windowTitle: data.windowTitle
  };

  log('llm-call-start', { key: newKey });
  let classification;
  try {
    classification = await classifyDistraction(context);
  } catch (err) {
    log('llm-error', { error: err.message });
    return;
  }

  // Stale-check: user moved on while we were waiting on the LLM.
  if (myVersion !== contextVersion) {
    return log('discard-stale-llm', {
      capturedVersion: myVersion, currentVersion: contextVersion, key: newKey
    });
  }

  log('llm-verdict', {
    verdict: classification.verdict,
    confidence: classification.confidence,
    source: classification.source,
    reason: classification.reason
  });

  // FIX 1 (decisive form): the previous reclassify rule that upgraded NEUTRAL
  // on a browser tab to DISTRACTION has been removed. With UNIVERSAL_UTILITIES
  // and the music neutral list, a NEUTRAL verdict from a real classifier is
  // overwhelmingly correct — overriding it produced false positives for any
  // utility we hadn't allowlisted. NEUTRAL stays NEUTRAL; silence wins.

  lastClassifiedKey = newKey;

  if (classification.verdict === 'DISTRACTION') {
    // FIX 1 extension: low-confidence LLM DISTRACTION → silent. Rules-layer
    // blocks (source='rules', confidence=1) bypass this gate.
    if (
      classification.source !== 'rules' &&
      classification.confidence < LOW_CONF_DISTRACTION_THRESHOLD
    ) {
      log('skip-low-confidence-distraction', { conf: classification.confidence });
      commitLiveDistractionTime();
      return;
    }
    commitLiveChatTime();
    enterDistraction(newKey, { ...data, classification }, myVersion);
  } else {
    commitLiveDistractionTime();
    commitLiveChatTime();
    log('no-popup', { reason: `verdict-${classification.verdict}` });
  }
}

// ---- Soft-neutral (chat apps) ----------------------------------------------
// Skip the LLM (it can't see chat content anyway). Track cumulative time
// against CHAT_BUDGET_MS; when exceeded, fire one popup and reset the
// budget for the next window.
function handleSoftNeutral(key, data, capturedVersion) {
  commitLiveDistractionTime();
  if (liveChatKey !== key) {
    commitLiveChatTime();
    liveChatKey = key;
    liveChatStartedAt = Date.now();
  } else {
    // Same key — accrue interim time so the budget reflects actual presence
    // even without external context-change events.
    const delta = Date.now() - liveChatStartedAt;
    if (delta > 0) {
      sm.addChatTime(key, delta);
      liveChatStartedAt = Date.now();
    }
  }

  const cumulative = sm.getChatTime(key);
  if (cumulative >= CHAT_BUDGET_MS) {
    log('chat-budget-exceeded', { key, cumulativeMs: cumulative });
    sm.resetChatTime(key);                // reset to grant a fresh budget window
    commitLiveChatTime();
    enterDistraction(key, {
      ...data,
      classification: {
        verdict: 'DISTRACTION',
        confidence: 1,
        source: 'chat-budget',
        reason: 'extended communication-app use'
      }
    }, capturedVersion);
  } else {
    log('chat-tracked', { key, cumulativeMs: cumulative, budgetMs: CHAT_BUDGET_MS });
  }
}

// ---- enterDistraction ------------------------------------------------------
// Compute how much cumulative time is already on this key (with decay
// applied), then schedule the fire at `threshold - accrued` ms from now,
// clamped to MIN_DRIFT_DELAY_MS so a re-entry past threshold still gives
// a brief grace before popping up.
function enterDistraction(key, data, capturedVersion) {
  if (capturedVersion !== contextVersion) {
    return log('discard-stale-enter', { capturedVersion, currentVersion: contextVersion });
  }

  if (liveDistractionKey === key && liveDistractionStartedAt) {
    // Same key re-entering (e.g. after popup-ignore re-check) — commit the
    // interim time so accrued reflects reality.
    const delta = Date.now() - liveDistractionStartedAt;
    if (delta > 0) sm.addDistractionTime(key, delta);
    liveDistractionStartedAt = Date.now();
  } else {
    commitLiveDistractionTime();
    sm.ensureFreshAccumulatorEntry(key); // applies decay
    liveDistractionKey = key;
    liveDistractionStartedAt = Date.now();
  }

  const accrued = sm.getDistractionEntry(key)?.cumulativeMs || 0;
  const needed = Math.max(MIN_DRIFT_DELAY_MS, DRIFT_THRESHOLD_MS - accrued);

  sm.cancelDriftTimer();

  const drift = {
    url: data.url || null,
    title: data.title || null,
    appName: data.appName || null,
    windowTitle: data.windowTitle || null,
    tabId: data.tabId ?? null,
    detectedAt: Date.now(),
    classification: data.classification,
    contextVersion: capturedVersion,
    popupShown: false,
    key,
    accruedAtSchedule: accrued
  };

  drift.timerHandle = setTimeout(() => fireIntervention(drift), needed);
  sm.getState().currentDrift = drift;
  log('drift-timer-start', { key, neededMs: needed, accruedMs: accrued });
}

// ---- fireIntervention ------------------------------------------------------
async function fireIntervention(drift) {
  if (!sm.isActive()) return;
  if (drift.contextVersion !== contextVersion) {
    return log('discard-stale-fire', {
      driftVersion: drift.contextVersion, currentVersion: contextVersion
    });
  }

  // Final commit before the popup — accrue the time since enterDistraction.
  commitLiveDistractionTime();

  const settings = getSettings();
  const distractionName = drift.title || drift.appName || drift.url || 'something';
  const secondsElapsed = Math.round((Date.now() - drift.detectedAt) / 1000);

  log('fire-intervention', { target: distractionName });

  logDriftEvent({
    session_id: sm.getState().sessionId,
    distraction_url: drift.url,
    distraction_title: drift.title || drift.windowTitle,
    classification_source: drift.classification.source,
    confidence: drift.classification.confidence,
    user_action: 'pending'
  });
  incrementSessionCounter(sm.getState().sessionId, 'drifts_count');

  const mw = mainWindowGetter();
  if (mw && !mw.isDestroyed()) {
    mw.webContents.send('drift:detected', { distraction: distractionName });
  }

  let message;
  try {
    message = await generateMotivation({
      personality: settings.personality,
      topic: sm.getState().topic,
      distraction: distractionName,
      secondsOnDistraction: secondsElapsed
    });
  } catch (err) {
    message = 'You drifted. Come back.';
  }

  if (!sm.isActive()) {
    return log('discard-stale-popup', { reason: 'session-ended-during-motivation' });
  }
  if (drift.contextVersion !== contextVersion) {
    return log('discard-stale-popup', {
      reason: 'context-changed-during-motivation',
      driftVersion: drift.contextVersion, currentVersion: contextVersion
    });
  }

  log('popup-show', { distraction: distractionName });
  showInterventionPopup({
    topic: sm.getState().topic,
    distraction: distractionName,
    message,
    snoozesLeft: sm.snoozesLeft()
  });
  drift.popupShown = true;

  // Reset cumulative for this key — give the user a fresh window before the
  // next popup. Re-establish live tracking from now: if they stay, the
  // ignore re-check will catch them again in ~60 seconds.
  sm.resetDistractionAccumulator(drift.key);
  liveDistractionKey = drift.key;
  liveDistractionStartedAt = Date.now();
}

// ---- Popup action handler --------------------------------------------------
function handlePopupAction(action) {
  const drift = sm.getState().currentDrift;
  const sessionId = sm.getState().sessionId;
  log('popup-action', { action });

  clearPopupIgnoreTimer();

  if (action === 'grind') {
    incrementSessionCounter(sessionId, 'grinds_count');
    const mw = mainWindowGetter();
    if (mw && !mw.isDestroyed()) mw.webContents.send('grind:clicked');
    const wsServer = require('./ws-server');
    if (drift.url) {
      wsServer.broadcastToExtension({ command: 'close_tab', tabId: drift.tabId, url: drift.url });
    }
    sm.resetDistractionAccumulator(drift.key);
    sm.resetDrift();
    closeInterventionPopup();
    onContextChanged('grind-clicked');
  } else if (action === 'snooze') {
    if (sm.snoozesLeft() <= 0) return;
    incrementSessionCounter(sessionId, 'snoozes_count');
    sm.startSnooze();
    sm.resetDrift();
    closeInterventionPopup();
    onContextChanged('snooze-clicked');
  } else if (action === 'wrong_guess') {
    if (drift.url) {
      const domain = extractDomain(drift.url);
      sm.addWhitelist({ url: drift.url, domain });
      if (sessionId) addToSessionWhitelist(sessionId, { url: drift.url, domain });
    } else if (drift.appName) {
      sm.addWhitelist({ appName: drift.appName });
    }
    sm.resetDistractionAccumulator(drift.key);
    sm.resetDrift();
    closeInterventionPopup();
    onContextChanged('wrong-guess-clicked');
  }
}

// ---- Popup ignored (auto-closed without user action) -----------------------
// Schedule a single re-check; if the user is still on the same distraction
// in POPUP_IGNORE_RECHECK_MS, bust dedup and ask the extension to re-report
// so the pipeline re-evaluates. Respects snooze.
function onPopupIgnored() {
  log('popup-ignored');
  clearPopupIgnoreTimer();
  const driftKey = sm.getState().currentDrift.key;
  if (!driftKey) return;

  popupIgnoreTimer = setTimeout(() => {
    popupIgnoreTimer = null;
    if (!sm.isActive()) return;
    if (sm.getState().inSnoozeWindow) {
      return log('popup-ignored-recheck-skipped', { reason: 'in-snooze' });
    }
    if (sm.getState().currentDrift.key !== driftKey) {
      return log('popup-ignored-recheck-skipped', { reason: 'moved-on' });
    }
    log('popup-ignored-recheck-firing', { key: driftKey });
    // Bust main-side dedup so the next event re-evaluates.
    lastClassifiedKey = null;
    // Extension will force-send the current tab (bypasses extension dedup).
    const wsServer = require('./ws-server');
    wsServer.broadcastToExtension({ command: 'report_current_tab' });
  }, POPUP_IGNORE_RECHECK_MS);
}

// ---- Snooze end → re-evaluate current activity -----------------------------
function onSnoozeEnded() {
  log('snooze-ended');
  lastClassifiedKey = null;
  inFlightKey = null;
  const wsServer = require('./ws-server');
  wsServer.broadcastToExtension({ command: 'report_current_tab' });
}

// ---- Session lifecycle -----------------------------------------------------
function onSessionStopped() {
  log('session-stopped');
  commitLiveDistractionTime();
  commitLiveChatTime();
  clearPopupIgnoreTimer();
  onContextChanged('session-stopped');
}

function onSessionStarted() {
  log('session-started');
  sm.setOnSnoozeEnd(onSnoozeEnded);
  onContextChanged('session-started');
}

// ---- Wire popup-ignored callback once at module load -----------------------
setOnIgnoredCallback(onPopupIgnored);

module.exports = {
  handleActivityChange,
  handlePopupAction,
  onPopupIgnored,
  onSnoozeEnded,
  onSessionStopped,
  onSessionStarted,
  setMainWindowGetter,
  // exposed for tests
  _internals: () => ({
    contextVersion,
    lastClassifiedKey,
    inFlightKey,
    liveDistractionKey,
    liveDistractionStartedAt,
    liveChatKey
  }),
  _constants: {
    DRIFT_THRESHOLD_MS,
    MIN_DRIFT_DELAY_MS,
    CHAT_BUDGET_MS,
    POPUP_IGNORE_RECHECK_MS,
    LOW_CONF_DISTRACTION_THRESHOLD
  }
};
