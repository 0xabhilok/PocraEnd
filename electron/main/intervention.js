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
//   This is the single mechanism that prevents:
//     - late-arriving LLM results triggering popups for tabs the user already left
//     - multiple in-flight LLM calls racing and each starting a drift timer
//     - drift timers firing for context that no longer exists
//
// * The popup itself has its own state machine (see popup-window.js) so two
//   simultaneous show requests cannot create two windows.

const sm = require('./session-manager');
const { checkRules, checkAppRules, extractDomain } = require('./allowlist');
const { classifyDistraction, generateMotivation } = require('./llm-router');
const { logDriftEvent, incrementSessionCounter, addToSessionWhitelist, getSettings } = require('./db');
const { showInterventionPopup, closeInterventionPopup } = require('./popup-window');

const DRIFT_DELAY_MS = 5000; // 5 seconds before popup

// --- Cancellation token ---
// Monotonic counter. Incremented on every context change. Captured at the
// start of any async chain; checked before any side effect.
let contextVersion = 0;

// --- Dedup state ---
// Last (normalized) context key we ran through the full pipeline. Used to
// suppress duplicate events from rapid-fire Chrome events / keepalives / etc.
let lastClassifiedKey = null;

let mainWindowGetter = () => null;

function setMainWindowGetter(fn) {
  mainWindowGetter = fn;
}

// ---------------------------------------------------------------------------
// Logging — structured, single-line, includes version + timestamp.
// Grep [intervention] in the terminal to trace a full decision.
// ---------------------------------------------------------------------------
function log(event, details = {}) {
  const ts = new Date().toISOString().slice(11, 23);
  const detailStr = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join(' ');
  console.log(`[intervention] ${ts} v${contextVersion} ${event}${detailStr ? ' ' + detailStr : ''}`);
}

// ---------------------------------------------------------------------------
// Key normalization — used for dedup and for "did context change" checks.
//
// For browser tabs we strip the query string and hash. HLS video players,
// SPAs, YouTube etc. change ?t=, ?sid= etc. constantly during playback;
// these are not real context changes and must not trigger reclassification.
// ---------------------------------------------------------------------------
function normalizeKey(data) {
  if (data.url) {
    try {
      const u = new URL(data.url);
      return `browser::${u.hostname}${u.pathname}`;
    } catch {
      return `browser::${data.url}`;
    }
  }
  if (data.appName) return `desktop::${data.appName.toLowerCase()}`;
  return null;
}

// ---------------------------------------------------------------------------
// Context change — increments the cancellation token and tears down any
// state that belongs to the previous context. Call this EXACTLY when the
// user has moved to something genuinely new.
// ---------------------------------------------------------------------------
function onContextChanged(reason) {
  const old = contextVersion;
  contextVersion += 1;
  sm.cancelDriftTimer();
  if (sm.getState().currentDrift.popupShown) {
    closeInterventionPopup();
  }
  sm.resetDrift();
  lastClassifiedKey = null;
  log('context-changed', { from: `v${old}`, to: `v${contextVersion}`, reason });
}

// ---------------------------------------------------------------------------
// Main entry — fires for every browser tab / desktop window change.
// data = { url, title, tabId, appName, windowTitle, source: 'browser'|'desktop' }
// ---------------------------------------------------------------------------
async function handleActivityChange(data) {
  const newKey = normalizeKey(data);
  const target = data.url || data.appName || '(unknown)';
  const titleSnippet = (data.title || data.windowTitle || '').slice(0, 80);

  log('activity-in', { source: data.source, target, title: titleSnippet, key: newKey });

  if (!sm.isActive()) {
    log('skip', { reason: 'no-active-session' });
    return;
  }
  if (sm.getState().inSnoozeWindow) {
    log('skip', { reason: 'in-snooze-window' });
    return;
  }

  // --- Detect context change ---
  // The current "drift in progress" is the source of truth for "what context
  // are we currently classifying / waiting on". If the key changed, increment
  // the version (which invalidates every in-flight LLM call and timer).
  const liveDrift = sm.getState().currentDrift;
  const oldDriftKey = liveDrift.url
    ? normalizeKey({ url: liveDrift.url })
    : liveDrift.appName
      ? normalizeKey({ appName: liveDrift.appName })
      : null;

  if (oldDriftKey && newKey !== oldDriftKey) {
    onContextChanged(`drift-tab-switched-away from ${oldDriftKey}`);
  } else if (lastClassifiedKey && newKey !== lastClassifiedKey && !oldDriftKey) {
    // No drift was in progress, but the last thing we *classified* was
    // different. Still a context change — invalidate any pending work.
    onContextChanged(`classified-tab-switched-away from ${lastClassifiedKey}`);
  }

  // Capture the version that this invocation owns. Every async hop below
  // checks it. If it's stale by the time we get there, we drop the result.
  const myVersion = contextVersion;

  // --- Dedup: same normalized key as the last fully-classified event? ---
  // Don't pollute lastClassifiedKey until we've actually classified — that way
  // a noisy keepalive for an allowed URL doesn't block a later genuine LLM call.
  if (newKey && newKey === lastClassifiedKey) {
    log('skip', { reason: 'dedup-same-key', key: newKey });
    return;
  }

  // --- Session-scoped whitelist ("wrong guess") ---
  if (data.url) {
    const domain = extractDomain(data.url);
    if (sm.isWhitelisted({ url: data.url, domain })) {
      log('skip', { reason: 'whitelisted-url', domain });
      lastClassifiedKey = newKey; // remember to dedup keepalives
      return;
    }
  } else if (data.appName && sm.isWhitelisted({ appName: data.appName })) {
    log('skip', { reason: 'whitelisted-app', app: data.appName });
    lastClassifiedKey = newKey;
    return;
  }

  // --- Rules layer ---
  // Hardcoded allow/neutral/block for known sites and apps. Avoids the LLM.
  if (data.url) {
    const verdict = checkRules({ url: data.url, workType: sm.getState().workType });
    log('rules-verdict', { domain: extractDomain(data.url), verdict });

    if (verdict === 'allow' || verdict === 'neutral') {
      lastClassifiedKey = newKey;
      return;
    }
    if (verdict === 'block') {
      lastClassifiedKey = newKey;
      startDriftTimer(
        { ...data, classification: { verdict: 'DISTRACTION', confidence: 1, source: 'rules' } },
        myVersion
      );
      return;
    }
  } else if (data.appName) {
    const appVerdict = checkAppRules({ appName: data.appName });
    log('rules-verdict', { app: data.appName, verdict: appVerdict });

    if (appVerdict === 'allow' || appVerdict === 'neutral') {
      lastClassifiedKey = newKey;
      return;
    }
  }

  // --- LLM classification ---
  // The await here can take 2-5 seconds. During that window the user can
  // change tabs many times. We check myVersion === contextVersion before
  // doing anything with the result.
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

  // Stale-check #1: the LLM finished but the user has since moved on.
  // Drop the result entirely — do NOT call startDriftTimer with stale data,
  // which is what was causing zombie popups for tabs the user already left.
  if (myVersion !== contextVersion) {
    log('discard-stale-llm', { capturedVersion: myVersion, currentVersion: contextVersion, key: newKey });
    return;
  }

  log('llm-verdict', {
    verdict: classification.verdict,
    confidence: classification.confidence,
    source: classification.source,
    reason: classification.reason
  });

  // Browser tabs can't be NEUTRAL — the rules layer already filtered out the
  // genuine utility domains. A NEUTRAL verdict here is the model dodging.
  if (classification.verdict === 'NEUTRAL' && data.url) {
    log('reclassify-browser-neutral-to-distraction');
    classification = {
      ...classification,
      verdict: 'DISTRACTION',
      reason: `${classification.reason || 'neutral'} (reclassified: browser tabs cannot be utilities)`
    };
  }

  lastClassifiedKey = newKey;

  if (classification.verdict === 'DISTRACTION') {
    startDriftTimer({ ...data, classification }, myVersion);
  } else {
    log('no-popup', { reason: `verdict-${classification.verdict}` });
  }
}

// ---------------------------------------------------------------------------
// startDriftTimer — schedules the 5-second grace period before fireIntervention.
// Re-checks the version because there's a microtask gap between LLM return
// and this call where another event could have arrived.
// ---------------------------------------------------------------------------
function startDriftTimer(data, capturedVersion) {
  if (capturedVersion !== contextVersion) {
    log('discard-stale-drift-timer', { capturedVersion, currentVersion: contextVersion });
    return;
  }

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
    popupShown: false
  };

  drift.timerHandle = setTimeout(() => {
    fireIntervention(drift);
  }, DRIFT_DELAY_MS);

  sm.getState().currentDrift = drift;
  log('drift-timer-start', { delayMs: DRIFT_DELAY_MS, key: normalizeKey(data) });
}

// ---------------------------------------------------------------------------
// fireIntervention — runs after the grace period. Has TWO version checks
// (before generateMotivation and after) because generateMotivation can take
// 2+ seconds, plenty of time for context to change again.
// ---------------------------------------------------------------------------
async function fireIntervention(drift) {
  if (!sm.isActive()) return;

  // Stale-check #2: even though our timer wasn't cancelled (we got here),
  // a context change between the timer being scheduled and now would have
  // bumped the version. Drop.
  if (drift.contextVersion !== contextVersion) {
    log('discard-stale-fire', { driftVersion: drift.contextVersion, currentVersion: contextVersion });
    return;
  }

  const settings = getSettings();
  const distractionName = drift.title || drift.appName || drift.url || 'something';
  const secondsElapsed = Math.round((Date.now() - drift.detectedAt) / 1000);

  log('fire-intervention', { target: distractionName });

  // Log the drift event before the await so a slow LLM doesn't lose the data.
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

  // Generate motivation message — can take 2+ seconds on a slow local model.
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

  // Stale-check #3: motivation generation took time; context may have changed.
  if (!sm.isActive()) {
    log('discard-stale-popup', { reason: 'session-ended-during-motivation' });
    return;
  }
  if (drift.contextVersion !== contextVersion) {
    log('discard-stale-popup', { reason: 'context-changed-during-motivation', driftVersion: drift.contextVersion, currentVersion: contextVersion });
    return;
  }

  // Show the popup. popup-window.js has its own state machine to prevent
  // double-windows from racing show() calls.
  log('popup-show', { distraction: distractionName });
  showInterventionPopup({
    topic: sm.getState().topic,
    distraction: distractionName,
    message,
    snoozesLeft: sm.snoozesLeft()
  });

  drift.popupShown = true;
}

// ---------------------------------------------------------------------------
// Popup button handler. After any action the context is effectively reset
// (the user acknowledged the drift), so increment the version to invalidate
// any zombie in-flight work.
// ---------------------------------------------------------------------------
function handlePopupAction(action) {
  const drift = sm.getState().currentDrift;
  const sessionId = sm.getState().sessionId;

  log('popup-action', { action });

  if (action === 'grind') {
    incrementSessionCounter(sessionId, 'grinds_count');
    const mw = mainWindowGetter();
    if (mw && !mw.isDestroyed()) mw.webContents.send('grind:clicked');
    const wsServer = require('./ws-server');
    if (drift.url) {
      wsServer.broadcastToExtension({ command: 'close_tab', tabId: drift.tabId, url: drift.url });
    }
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
    sm.resetDrift();
    closeInterventionPopup();
    onContextChanged('wrong-guess-clicked');
  }
}

function onSessionStopped() {
  log('session-stopped');
  onContextChanged('session-stopped');
}

function onSessionStarted() {
  log('session-started');
  // Fresh session — bump the version so any leftover state from the previous
  // session can't accidentally apply here.
  onContextChanged('session-started');
}

module.exports = {
  handleActivityChange,
  handlePopupAction,
  onSessionStopped,
  onSessionStarted,
  setMainWindowGetter
};
