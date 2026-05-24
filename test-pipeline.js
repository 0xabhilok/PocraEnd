'use strict';

// Pipeline-level regression tests for the drift-detection rework.
// Run:  node test-pipeline.js
//
// These tests stub db / popup-window / ws-server / llm-router via the
// require.cache so intervention.js sees test-controllable doubles. No
// Electron, no Ollama, no SQLite required.
//
// Total runtime ~ 35s because we exercise real setTimeouts in the cumulative
// drift flow (it's the cheapest way to prove the timing is correct).

const path = require('path');

// --- Install stubs BEFORE loading intervention.js -------------------------
function stubModule(relPath, exports) {
  const abs = require.resolve(path.join(__dirname, relPath));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

const dbCalls = { drifts: [], increments: [], whitelists: [] };
stubModule('electron/main/db.js', {
  logDriftEvent: (e) => dbCalls.drifts.push(e),
  incrementSessionCounter: (id, k) => dbCalls.increments.push({ id, k }),
  addToSessionWhitelist: (id, e) => dbCalls.whitelists.push({ id, e }),
  getSettings: () => ({ personality: 'supportive', ai_model: 'qwen2.5:3b' }),
  getMotivations: () => []
});

const popupCalls = { shows: [], closes: 0 };
let onIgnoredCb = null;
stubModule('electron/main/popup-window.js', {
  showInterventionPopup: (d) => popupCalls.shows.push(d),
  closeInterventionPopup: () => { popupCalls.closes++; },
  setOnIgnoredCallback: (cb) => { onIgnoredCb = cb; },
  markUserActionTaken: () => { /* no-op in tests */ }
});

const wsBroadcasts = [];
stubModule('electron/main/ws-server.js', {
  broadcastToExtension: (m) => wsBroadcasts.push(m)
});

const llmController = { nextResult: null, nextDelay: 0, error: null };
stubModule('electron/main/llm-router.js', {
  classifyDistraction: async () => {
    if (llmController.nextDelay > 0) {
      await new Promise((r) => setTimeout(r, llmController.nextDelay));
    }
    if (llmController.error) throw llmController.error;
    return llmController.nextResult;
  },
  generateMotivation: async () => 'test message'
});

// --- Now load intervention with stubs visible -----------------------------
const intervention = require('./electron/main/intervention');
const sm = require('./electron/main/session-manager');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`OK    ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? '  -- ' + detail : ''}`);
    console.log(`FAIL  ${name}${detail ? '  -- ' + detail : ''}`);
  }
}

function reset() {
  if (sm.isActive()) {
    intervention.onSessionStopped();
    sm.stopSession();
  }
  dbCalls.drifts.length = 0;
  dbCalls.increments.length = 0;
  dbCalls.whitelists.length = 0;
  popupCalls.shows.length = 0;
  popupCalls.closes = 0;
  wsBroadcasts.length = 0;
  llmController.nextResult = null;
  llmController.nextDelay = 0;
  llmController.error = null;
}

function startSession(workType = 'coding', topic = 'React assignment') {
  sm.startSession({ sessionId: 1, topic, workType, durationMin: 25 });
  intervention.onSessionStarted();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Test suite ----------------------------------------------------------
async function run() {
  const T = intervention._constants.DRIFT_THRESHOLD_MS;

  // 1. Fallback NEUTRAL (Ollama down, no Gemini) must NOT pop up.
  reset(); startSession();
  llmController.nextResult = {
    verdict: 'NEUTRAL', confidence: 0, reason: 'classifier unavailable', source: 'fallback'
  };
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://random-tool.example/', title: 'Random Tool', tabId: 1
  });
  await sleep(T + 1500);
  check('FIX1: fallback NEUTRAL is silent', popupCalls.shows.length === 0);

  // 2. Low-confidence LLM DISTRACTION must NOT pop up.
  reset(); startSession();
  llmController.nextResult = {
    verdict: 'DISTRACTION', confidence: 0.4, reason: 'guess', source: 'local'
  };
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://unclear.example/', title: 'Unclear', tabId: 1
  });
  await sleep(T + 1500);
  check('FIX1+: low-conf DISTRACTION is silent', popupCalls.shows.length === 0);

  // 3. High-confidence LLM DISTRACTION DOES pop up.
  reset(); startSession();
  llmController.nextResult = {
    verdict: 'DISTRACTION', confidence: 0.9, reason: 'movie', source: 'local'
  };
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://movieflix.example/watch', title: 'Avengers Full Movie', tabId: 1
  });
  await sleep(T + 1500);
  check('high-conf DISTRACTION fires popup', popupCalls.shows.length === 1);

  // 4. High-confidence NEUTRAL on browser STAYS NEUTRAL — no reclassify.
  reset(); startSession();
  llmController.nextResult = {
    verdict: 'NEUTRAL', confidence: 0.85, reason: 'utility', source: 'local'
  };
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://uncertain-tool.example/', title: 'Some Tool', tabId: 1
  });
  await sleep(T + 1500);
  check('NEUTRAL stays NEUTRAL (no reclassify)', popupCalls.shows.length === 0);

  // 5. FIX 3 — cumulative drift across tab switching.
  // Netflix 3s → ChatGPT (allow) 1s → Netflix 2.5s → popup (5s total).
  // MIN_DRIFT_DELAY_MS clamps re-entry to >=1s, so total wall time = 3 + 1 + 2.5
  // We arrange so accrued (3000) + 2000 needed = ~5s threshold.
  reset(); startSession();
  // Netflix is in KNOWN_DISTRACTIONS → rules-block (no LLM call needed).
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://netflix.com/watch/x', title: 'Show', tabId: 1
  });
  await sleep(3000);
  // Switch to allowlisted tab — onContextChanged commits 3s into accumulator.
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://chatgpt.com/', title: 'ChatGPT', tabId: 2
  });
  await sleep(1000);
  // Back to Netflix — accrued ~3000ms, needed = max(1000, 5000-3000) = 2000ms.
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://netflix.com/watch/x', title: 'Show', tabId: 1
  });
  await sleep(2500);
  check(
    'FIX3: cumulative drift fires after 5s total across switches',
    popupCalls.shows.length === 1,
    `popup count = ${popupCalls.shows.length}`
  );

  // 6. C4 race fix — rapid tab switches before LLM responds, stale result
  // for the first tab must NOT pop up after the user has moved on.
  reset(); startSession();
  llmController.nextResult = {
    verdict: 'DISTRACTION', confidence: 0.9, source: 'local'
  };
  llmController.nextDelay = 800;
  const p1 = intervention.handleActivityChange({
    source: 'browser', url: 'https://slow-classify.example/a', title: 'A', tabId: 1
  });
  await sleep(100);
  // Switch tabs while the first classification is still pending. inFlightKey
  // bumps the version → first call's result is discarded as stale.
  llmController.nextResult = { verdict: 'RELEVANT', confidence: 0.9, source: 'local' };
  llmController.nextDelay = 0;
  const p2 = intervention.handleActivityChange({
    source: 'browser', url: 'https://github.com/', title: 'GitHub', tabId: 2
  });
  await Promise.all([p1, p2]);
  await sleep(T + 1500);
  check(
    'C4: stale LLM result for left-tab does NOT pop up',
    popupCalls.shows.length === 0,
    `popup count = ${popupCalls.shows.length}`
  );

  // 7. FIX 4 — snooze end re-broadcasts report_current_tab.
  reset(); startSession();
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://netflix.com/watch/x', title: 'X', tabId: 1
  });
  await sleep(T + 1500);
  // Simulate snooze (use a short duration for the test).
  sm.startSnooze(200);
  await sleep(400);
  check(
    'FIX4: snooze end broadcasts report_current_tab',
    wsBroadcasts.some((b) => b.command === 'report_current_tab')
  );

  // 8. FIX 8 — auto-closed popup schedules a re-check (clears lastClassifiedKey
  // and broadcasts report_current_tab after POPUP_IGNORE_RECHECK_MS).
  // We can't wait 60s in tests, so we just verify the ignore callback was wired
  // and that it schedules SOMETHING (no immediate broadcast).
  reset(); startSession();
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://netflix.com/watch/y', title: 'Y', tabId: 1
  });
  await sleep(T + 1500);
  check('FIX8: precondition popup fired', popupCalls.shows.length === 1);
  check('FIX8: onIgnoredCallback was wired by intervention', typeof onIgnoredCb === 'function');
  wsBroadcasts.length = 0;
  if (onIgnoredCb) onIgnoredCb();
  await sleep(100);
  check(
    'FIX8: ignore re-check is delayed, not immediate',
    !wsBroadcasts.some((b) => b.command === 'report_current_tab')
  );

  // 9. FIX 6 — universal utilities are silent (no LLM call, no popup).
  reset(); startSession();
  llmController.nextResult = {
    verdict: 'DISTRACTION', confidence: 0.99, source: 'local' // would fire IF LLM were consulted
  };
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://www.notion.so/my-page', title: 'Notion', tabId: 1
  });
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://linear.app/team', title: 'Linear', tabId: 2
  });
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://www.figma.com/file/123', title: 'Figma', tabId: 3
  });
  await sleep(T + 1500);
  check('FIX6: universal utilities (Notion/Linear/Figma) silent', popupCalls.shows.length === 0);

  // 10. FIX 5 — music sites silent.
  reset(); startSession();
  llmController.nextResult = {
    verdict: 'DISTRACTION', confidence: 0.99, source: 'local'
  };
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://open.spotify.com/playlist/x', title: 'Lofi', tabId: 1
  });
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://music.youtube.com/watch?v=x', title: 'Background', tabId: 2
  });
  await sleep(T + 1500);
  check('FIX5: music sites (Spotify/YouTube Music) silent', popupCalls.shows.length === 0);

  // 11. FIX 7 — chat app short use is silent.
  reset(); startSession();
  await intervention.handleActivityChange({
    source: 'desktop', appName: 'Discord', windowTitle: 'general'
  });
  await sleep(T + 1500);
  check('FIX7: Discord short use silent', popupCalls.shows.length === 0);

  // 12. FIX 9 — mobile subdomain hits the rules-block.
  reset(); startSession();
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://m.instagram.com/explore/', title: 'IG', tabId: 1
  });
  await sleep(T + 1500);
  check(
    'FIX9: m.instagram.com is rules-blocked (popup fires, no LLM needed)',
    popupCalls.shows.length === 1
  );

  // 13. FIX 9 — whitelist apex matches different subdomains within the session.
  reset(); startSession();
  sm.addWhitelist({ domain: 'reddit.com' });
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://m.reddit.com/r/x', title: 'r/x', tabId: 1
  });
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://old.reddit.com/r/y', title: 'r/y', tabId: 2
  });
  await sleep(T + 1500);
  check('FIX9: whitelist apex (reddit.com) matches m./old. subdomains',
    popupCalls.shows.length === 0);

  // 14. FIX 2 — classifier throws (timeout-simulator) → no popup.
  reset(); startSession();
  llmController.error = new Error('Ollama timeout (simulated)');
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://random.example/', title: 'Random', tabId: 1
  });
  await sleep(T + 1500);
  check('FIX2: classifier error/timeout is silent', popupCalls.shows.length === 0);

  // 15. Rules-layer block bypasses low-conf gate (always fires).
  reset(); startSession();
  await intervention.handleActivityChange({
    source: 'browser', url: 'https://tiktok.com/', title: 'TikTok', tabId: 1
  });
  await sleep(T + 1500);
  check('rules-block always fires regardless of LLM', popupCalls.shows.length === 1);

  // 16. Cleanup
  reset();

  console.log('');
  console.log('='.repeat(60));
  console.log(`pipeline: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('failed tests:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('test crashed', e);
  process.exit(2);
});
