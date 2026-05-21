const sm = require('./session-manager');
const { handleActivityChange } = require('./intervention');

const POLL_INTERVAL_MS = 1500;
let lastWindowId = null;
let activeWinFn = null;
let wasActive = false;

async function loadActiveWin() {
  if (activeWinFn) return activeWinFn;
  try {
    // active-win v8+ is ESM-only; use dynamic import.
    const mod = await import('active-win');
    activeWinFn = mod.activeWindow || mod.default;
    return activeWinFn;
  } catch (err) {
    console.error('[window-watcher] Failed to load active-win:', err.message);
    return null;
  }
}

function startWindowWatcher() {
  setInterval(async () => {
    if (!sm.isActive()) {
      wasActive = false;
      return;
    }

    // Session just started — clear the cached window id so the window the
    // user is already on gets evaluated instead of being skipped.
    if (!wasActive) {
      wasActive = true;
      lastWindowId = null;
    }

    const fn = await loadActiveWin();
    if (!fn) return;

    try {
      const win = await fn();
      if (!win) return;

      if (win.id !== lastWindowId) {
        lastWindowId = win.id;

        // Skip browsers — the extension reports those with better fidelity
        const appName = (win.owner && win.owner.name) || '';
        const isBrowser = /chrome|edge|brave|firefox|opera|vivaldi/i.test(appName);
        if (isBrowser) return;

        // Skip PocraEnd itself
        if (/pocraend|electron/i.test(appName)) return;

        await handleActivityChange({
          appName,
          windowTitle: win.title || '',
          source: 'desktop'
        });
      }
    } catch (err) {
      // active-win can throw on some windows (e.g. permission popups). Ignore.
    }
  }, POLL_INTERVAL_MS);

  console.log('[window-watcher] Started, polling every', POLL_INTERVAL_MS, 'ms');
}

module.exports = { startWindowWatcher };
