# PocraEnd

An AI-powered focus guardian. Tell it what you're working on, and it catches you drifting in real time using a local LLM. Privacy-first — everything runs on your machine.

## Stack

- Electron (Node.js + Chromium) — desktop app
- React + Tailwind CSS — UI
- SQLite (better-sqlite3) — local storage
- Ollama + Qwen 2.5 0.5B — local LLM classifier
- Gemini 1.5 Flash — optional cloud fallback (BYOK)
- Chrome Extension (Manifest V3) — tab detection
- active-win — desktop app detection

## Prerequisites

1. **Node.js 18+** — [nodejs.org](https://nodejs.org)
2. **Ollama** — [ollama.com](https://ollama.com)
3. **Windows** — primary target. macOS / Linux are not supported in v0.1.

After installing Ollama, pull the model:

```bash
ollama pull qwen2.5:0.5b
```

Make sure Ollama is running (it auto-starts on Windows, or run `ollama serve`).

## Install

```bash
git clone <your-repo-url> pocraend
cd pocraend
npm install
```

Note: `better-sqlite3` and `active-win` include native code that compiles during install. On Windows you may need:

- Visual Studio Build Tools with the "Desktop development with C++" workload
- Python 3.x in PATH

If install fails, run `npm install --build-from-source`.

## Run in dev mode

```bash
npm run dev
```

This starts:
- Vite dev server (React) on port 5173
- Electron app pointing at the Vite server
- WebSocket server on 127.0.0.1:7842 for the extension
- Window watcher (1.5s polling)

## Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `chrome-extension/` folder in this repo
5. The extension should connect to PocraEnd automatically when the app is running

## Build for production

```bash
npm run build
```

This builds the React app and packages Electron with electron-builder (creates an NSIS installer in `dist/`).

## How it works

1. Start a focus session → tell PocraEnd what you're working on (e.g. "React assignment")
2. PocraEnd watches your browser tabs (via extension) and active app (via active-win)
3. When you switch to something new, it asks the local LLM: "Is this relevant to React assignment?"
4. If DISTRACTION → starts a 5-second timer (silent)
5. If you stay there 5+ seconds → popup appears with 3 buttons:
   - **Let's grind** — closes the distraction, +score
   - **Waste 5 more minutes** — snooze (max 2 per session)
   - **Wrong guess** — whitelists this URL for the session

## Privacy

- All session data is stored in SQLite on your machine (`%APPDATA%/PocraEnd/pocraend.db`)
- Tab titles and URLs are sent only to your local Ollama instance by default
- The Gemini API key is optional. If you set it, low-confidence classifications are sent to Google
- No telemetry, no analytics, no accounts

## Project structure

```
pocraend/
├── electron/
│   ├── main/              Main process (Node.js)
│   │   ├── index.js              Entry — creates window, wires modules
│   │   ├── db.js                 SQLite wrapper + schema
│   │   ├── session-manager.js    In-memory session state
│   │   ├── allowlist.js          Hardcoded productive/distraction rules
│   │   ├── prompts.js            LLM prompt templates
│   │   ├── llm-router.js         Ollama + Gemini calls
│   │   ├── intervention.js       Core brain — detection, timer, popup trigger
│   │   ├── popup-window.js       Manages the intervention popup window
│   │   ├── ws-server.js          WebSocket server for Chrome extension
│   │   ├── window-watcher.js     Polls active desktop window
│   │   └── ipc-handlers.js       Bridge: React → main process
│   └── preload/
│       ├── preload.js            Main window IPC bridge
│       └── popup-preload.js      Popup window IPC bridge
├── renderer/
│   ├── index.html                React entry
│   ├── popup.html                Popup window markup
│   └── src/
│       ├── main.jsx              React root
│       ├── App.jsx               Page router
│       ├── index.css             Tailwind globals
│       └── pages/
│           ├── Onboarding.jsx
│           ├── Dashboard.jsx
│           ├── Session.jsx
│           ├── Summary.jsx
│           └── Settings.jsx
├── chrome-extension/
│   ├── manifest.json
│   └── background.js
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Known limitations (v0.1)

- Windows only
- Chrome only (browser extension)
- Single motivation personality at a time (no per-session switching)
- No streak forgiveness (1 day missed = streak resets)
- No analytics dashboard beyond basic stats
- Qwen 0.5B is small — accuracy is ~75-85% in practice. Use Gemini key for better accuracy on hard cases.
- No "stillness detection" / daydream catching (planned v0.2)
- No prompt-to-task AI todo (planned v0.2)
