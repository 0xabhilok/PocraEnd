// The brain of PocraEnd. Decides when to intervene and how.

const sm = require('./session-manager');
const { checkRules, extractDomain } = require('./allowlist');
const { classifyDistraction, generateMotivation } = require('./llm-router');
const { logDriftEvent, incrementSessionCounter, addToSessionWhitelist, getSettings } = require('./db');
const { showInterventionPopup, closeInterventionPopup } = require('./popup-window');

const DRIFT_DELAY_MS = 5000; // 5 seconds before popup
let lastClassifiedKey = null; // dedupe: don't re-classify same URL repeatedly
let mainWindowGetter = () => null;

function setMainWindowGetter(fn) {
  mainWindowGetter = fn;
}

// Called when the user's active tab or app changes.
// data = { url, title, tabId, appName, windowTitle, source: 'browser' | 'desktop' }
async function handleActivityChange(data) {
  if (!sm.isActive()) return;
  if (sm.getState().inSnoozeWindow) return;

  // If we had a drift in progress and the user moved away from it -> cancel
  const currentDriftUrl = sm.getState().currentDrift.url;
  const currentDriftApp = sm.getState().currentDrift.appName;
  const newKey = data.url || data.appName;
  const oldKey = currentDriftUrl || currentDriftApp;

  if (oldKey && newKey !== oldKey) {
    sm.cancelDriftTimer();
    // If a popup was already up for the old drift, dismiss it — the user moved on.
    if (sm.getState().currentDrift.popupShown) {
      closeInterventionPopup();
    }
    sm.resetDrift();
  }

  // Dedupe: if the same target was just classified, ignore
  if (newKey === lastClassifiedKey) return;
  lastClassifiedKey = newKey;

  // Rules layer first (skip LLM if hardcoded)
  if (data.url) {
    const domain = extractDomain(data.url);
    if (sm.isWhitelisted({ url: data.url, domain })) return;

    const verdict = checkRules({ url: data.url, workType: sm.getState().workType });
    if (verdict === 'allow') return;
    if (verdict === 'block') {
      startDriftTimer({ ...data, classification: { verdict: 'DISTRACTION', confidence: 1, source: 'rules' } });
      return;
    }
  }

  // LLM classification
  const context = {
    topic: sm.getState().topic,
    workType: sm.getState().workType,
    title: data.title,
    url: data.url,
    appName: data.appName,
    windowTitle: data.windowTitle
  };

  let classification;
  try {
    classification = await classifyDistraction(context);
  } catch (err) {
    console.error('[intervention] Classification failed:', err.message);
    return;
  }

  if (classification.verdict === 'DISTRACTION') {
    startDriftTimer({ ...data, classification });
  }
}

function startDriftTimer(data) {
  sm.cancelDriftTimer();

  const drift = {
    url: data.url || null,
    title: data.title || null,
    appName: data.appName || null,
    windowTitle: data.windowTitle || null,
    tabId: data.tabId ?? null,
    detectedAt: Date.now(),
    classification: data.classification,
    popupShown: false
  };

  drift.timerHandle = setTimeout(() => {
    fireIntervention(drift);
  }, DRIFT_DELAY_MS);

  sm.getState().currentDrift = drift;
}

async function fireIntervention(drift) {
  if (!sm.isActive()) return;

  const settings = getSettings();
  const distractionName = drift.title || drift.appName || drift.url || 'something';
  const secondsElapsed = Math.round((Date.now() - drift.detectedAt) / 1000);

  // Log the drift event
  logDriftEvent({
    session_id: sm.getState().sessionId,
    distraction_url: drift.url,
    distraction_title: drift.title || drift.windowTitle,
    classification_source: drift.classification.source,
    confidence: drift.classification.confidence,
    user_action: 'pending'
  });
  incrementSessionCounter(sm.getState().sessionId, 'drifts_count');

  // Tell the main window UI to update drift counter
  const mw = mainWindowGetter();
  if (mw && !mw.isDestroyed()) {
    mw.webContents.send('drift:detected', { distraction: distractionName });
  }

  // Generate motivation message
  let message;
  try {
    message = await generateMotivation({
      personality: settings.personality,
      topic: sm.getState().topic,
      distraction: distractionName,
      secondsOnDistraction: secondsElapsed
    });
  } catch (err) {
    message = "You drifted. Come back.";
  }

  // Show the popup
  showInterventionPopup({
    topic: sm.getState().topic,
    distraction: distractionName,
    message,
    snoozesLeft: sm.snoozesLeft()
  });

  drift.popupShown = true;
}

// Called from popup-window when user clicks a button
function handlePopupAction(action) {
  const drift = sm.getState().currentDrift;
  const sessionId = sm.getState().sessionId;

  if (action === 'grind') {
    incrementSessionCounter(sessionId, 'grinds_count');
    const mw = mainWindowGetter();
    if (mw && !mw.isDestroyed()) mw.webContents.send('grind:clicked');
    // Try to close the offending Chrome tab via the extension
    const wsServer = require('./ws-server');
    if (drift.url) {
      wsServer.broadcastToExtension({ command: 'close_tab', tabId: drift.tabId, url: drift.url });
    }
    sm.resetDrift();
    closeInterventionPopup();
    lastClassifiedKey = null;
  } else if (action === 'snooze') {
    if (sm.snoozesLeft() <= 0) return;
    incrementSessionCounter(sessionId, 'snoozes_count');
    sm.startSnooze();
    sm.resetDrift();
    closeInterventionPopup();
    lastClassifiedKey = null;
  } else if (action === 'wrong_guess') {
    const domain = drift.url ? extractDomain(drift.url) : null;
    sm.addWhitelist({ url: drift.url, domain });
    if (sessionId) {
      addToSessionWhitelist(sessionId, { url: drift.url, domain });
    }
    sm.resetDrift();
    closeInterventionPopup();
    lastClassifiedKey = null;
  }
}

function onSessionStopped() {
  sm.cancelDriftTimer();
  sm.resetDrift();
  lastClassifiedKey = null;
  closeInterventionPopup();
}

module.exports = {
  handleActivityChange,
  handlePopupAction,
  onSessionStopped,
  setMainWindowGetter
};
