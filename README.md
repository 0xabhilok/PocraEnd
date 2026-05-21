<div align="center">

# PocraEnd

**An AI-powered focus guardian that catches you drifting — in real time.**

Tell PocraEnd what you're working on. It watches your tabs and apps, and the moment
you wander off, a local AI calls you out. Everything runs on your machine.
No accounts, no telemetry, no data leaves your computer.

[Getting Started](#getting-started) ·
[How It Works](#how-it-works) ·
[Configuration](#configuration) ·
[Roadmap](#roadmap)

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-0.1.0-orange)

</div>

---

## The Problem

You sit down to work. Twenty minutes later you're three tabs deep in YouTube and
you don't even remember opening it. Willpower fails quietly — by the time you
*notice* you've drifted, the time is already gone.

**PocraEnd is the friend who taps you on the shoulder.** It knows what you're
supposed to be doing, notices the second you stray, and pulls you back before five
minutes becomes fifty.

## Features

- **Real-time drift detection** — Watches your active browser tab and desktop app, and asks a local LLM whether each one is relevant to your stated task.
- **Smart interventions** — Distractions trigger a silent 5-second grace timer. Stay too long and a popup appears with three choices: get back to work, snooze, or mark a wrong guess.
- **100% local AI** — Classification runs on [Ollama](https://ollama.com) with Qwen 2.5 0.5B. Your tab titles and URLs never leave your machine.
- **Optional cloud fallback** — Bring your own Gemini API key for higher accuracy on ambiguous cases. Entirely opt-in.
- **Three coach personalities** — Pick how PocraEnd talks to you: *Dark Humor* (roasts you with love), *Drill Sergeant* (no nonsense), or *Supportive Friend* (gentle).
- **Custom motivations** — Write your own callout lines, or let the AI generate them on the fly.
- **Session history & stats** — Every focus session is saved locally in SQLite. Review what derailed you.
- **Privacy by design** — No accounts, no analytics, no telemetry. Ever.

## How It Works

```
  ┌─────────────┐     tab/app change     ┌──────────────┐
  │   You start │ ─────────────────────► │  PocraEnd    │
  │  a session  │                        │  watches     │
  └─────────────┘                        └──────┬───────┘
                                                │
                              "Is this relevant to my task?"
                                                │
                                                ▼
                                       ┌─────────────────┐
                                       │  Local LLM       │
                                       │  (Ollama / Qwen) │
                                       └────────┬─────────┘
                                                │
                            ┌───────────────────┴───────────────────┐
                            ▼                                       ▼
                       RELEVANT                              DISTRACTION
                     (do nothing)                       5s silent timer ⏳
                                                                │
                                                   still there after 5s?
                                                                │
                                                                ▼
                                                    ┌────────────────────┐
                                                    │  Intervention popup │
                                                    └────────────────────┘
```

When the popup appears, you get three buttons:

| Button | What it does |
|---|---|
| **Let's grind** | Closes the distraction and bumps your focus score. |
| **Waste 5 more minutes** | Snoozes the warning (max 2 snoozes per session). |
| **Wrong guess** | Whitelists this URL for the rest of the session — the AI got it wrong. |

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 33 (Node.js + Chromium) |
| UI | React 18 + Tailwind CSS + Vite |
| Local storage | SQLite via `better-sqlite3` |
| Local AI | Ollama + Qwen 2.5 0.5B |
| Cloud AI (optional) | Gemini 1.5 Flash (BYOK) |
| Browser detection | Chrome Extension (Manifest V3) |
| Desktop app detection | `active-win` |
| App ↔ Extension link | WebSocket server on `127.0.0.1:7842` |

## Getting Started

### Prerequisites

1. **[Node.js](https://nodejs.org) 18 or newer**
2. **[Ollama](https://ollama.com)** — for the local AI model
3. **Windows 10/11** — the only supported platform in v0.1
4. **Google Chrome** — for the browser-tab extension

> **Windows native modules:** `better-sqlite3` and `active-win` compile native code
> during install. If `npm install` fails, install
> **Visual Studio Build Tools** with the *"Desktop development with C++"* workload,
> make sure **Python 3.x** is in your `PATH`, then retry with
> `npm install --build-from-source`.

### 1. Install the AI model

```bash
ollama pull qwen2.5:0.5b
```

Make sure Ollama is running — it auto-starts on Windows, or run `ollama serve`.

### 2. Install PocraEnd

```bash
git clone https://github.com/0xabhilok/PocraEnd.git
cd PocraEnd
npm install
```

### 3. Run in development mode

```bash
npm run dev
```

This starts the Vite dev server, the Electron app, the WebSocket server, and the
window watcher together.

### 4. Load the Chrome extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder from this repo
5. The extension connects automatically whenever the PocraEnd app is running

## Building for Production

```bash
npm run build
```

This builds the React renderer and packages the app with `electron-builder`,
producing an NSIS installer in `dist/`.

## Configuration

All settings live in the in-app **Settings** screen (and the first-run onboarding):

- **Coach personality** — Dark Humor, Drill Sergeant, or Supportive Friend.
- **Custom motivations** — Add your own callout lines; PocraEnd picks one at random on drift, or lets the AI generate one if you've added none.
- **Gemini API key** — Optional. Used only as a fallback when the local model is unsure. Stored locally, never synced.

## Project Structure

```
pocraend/
├── electron/
│   ├── main/                   Main process (Node.js)
│   │   ├── index.js            Entry — creates window, wires modules
│   │   ├── db.js               SQLite wrapper + schema
│   │   ├── session-manager.js  In-memory session state
│   │   ├── allowlist.js        Hardcoded productive/distraction rules
│   │   ├── prompts.js          LLM prompt templates
│   │   ├── llm-router.js       Ollama + Gemini calls
│   │   ├── intervention.js     Core brain — detection, timer, popup trigger
│   │   ├── popup-window.js     Manages the intervention popup window
│   │   ├── ws-server.js        WebSocket server for the Chrome extension
│   │   ├── window-watcher.js   Polls the active desktop window
│   │   └── ipc-handlers.js     Bridge: React → main process
│   └── preload/
│       ├── preload.js          Main window IPC bridge
│       └── popup-preload.js    Popup window IPC bridge
├── renderer/
│   ├── index.html              React entry
│   ├── popup.html              Popup window markup
│   └── src/
│       ├── main.jsx            React root
│       ├── App.jsx             Page router
│       ├── index.css           Tailwind globals
│       └── pages/              Onboarding, Dashboard, Session, Summary, Settings
├── chrome-extension/           Manifest V3 extension (tab detection)
├── assets/                     App icons
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Privacy

PocraEnd is built privacy-first:

- All session data is stored locally in SQLite at `%APPDATA%/PocraEnd/pocraend.db`.
- Tab titles and URLs are sent **only to your local Ollama instance** by default.
- The Gemini API key is **optional**. If you set it, low-confidence classifications
  (and only those) are sent to Google for a second opinion.
- **No telemetry, no analytics, no accounts.**

## Roadmap

**Known limitations in v0.1**

- Windows only
- Chrome only for browser detection
- One coach personality at a time (no per-session switching)
- No streak forgiveness — one missed day resets the streak
- Qwen 0.5B is small; expect ~75–85% accuracy. Add a Gemini key for hard cases.

**Planned for v0.2**

- Stillness / daydream detection
- Prompt-to-task AI to-do generation
- macOS support

## Contributing

Issues and pull requests are welcome. If you're planning a larger change, please
open an issue first to discuss it.

## License

[MIT](LICENSE) © 2026
