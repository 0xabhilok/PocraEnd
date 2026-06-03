// Polls the foreground desktop window every 1.5s. Sends events to
// intervention.handleActivityChange ONLY for non-browser apps — the Chrome
// extension reports browser tabs with better fidelity than active-win can.

const sm = require('./session-manager');
const { handleActivityChange } = require('./intervention');

const POLL_INTERVAL_MS = 1500;
let lastKey = null; // app::windowTitle — changes when either changes
let activeWinFn = null;
let wasActive = false;

async function loadActiveWin() {
  if (activeWinFn) return activeWinFn;
  try {
    const mod = await import('active-win');
    activeWinFn = mod.activeWindow || mod.default;
    return activeWinFn;
  } catch (err) {
    console.error('[window-watcher] Failed to load active-win:', err.message);
    activeWinFn = async () => null; // Prevent repeated loading attempts and console spam
    return activeWinFn;
  }
}

function startWindowWatcher() {
  setInterval(async () => {
    if (!sm.isActive()) {
      wasActive = false;
      lastKey = null;
      return;
    }

    // Session just started — reset cache so the foreground gets re-evaluated.
    if (!wasActive) {
      wasActive = true;
      lastKey = null;
    }

    const fn = await loadActiveWin();
    if (!fn) return;

    let win;
    try {
      win = await fn();
    } catch {
      // active-win can throw on UAC dialogs, permission popups etc. Ignore.
      return;
    }
    if (!win) return;

    const appName = (win.owner && win.owner.name) || '';
    const windowTitle = win.title || '';

    // Skip categories that the extension or the user-facing rules handle better.
    if (/chrome|edge|brave|firefox|opera|vivaldi/i.test(appName)) return;
    if (/pocraend|electron/i.test(appName)) return;
    if (/^explorer$|windows explorer|program manager/i.test(appName)) return;

    // Use app name + window title as the cache key. This catches "same app,
    // different document" — e.g. switching files inside VS Code or moving
    // between Word documents triggers a re-classification.
    const key = `${appName}::${windowTitle}`;
    if (key === lastKey) return;
    lastKey = key;

    await handleActivityChange({
      appName,
      windowTitle,
      source: 'desktop'
    });
  }, POLL_INTERVAL_MS);

  console.log('[window-watcher] Started, polling every', POLL_INTERVAL_MS, 'ms');
}

module.exports = { startWindowWatcher };
