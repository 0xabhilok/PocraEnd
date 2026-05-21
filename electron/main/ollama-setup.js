const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');

const OLLAMA_API = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'qwen2.5:3b';
const INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ollamaExePath() {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
}

async function fetchWithTimeout(url, ms, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function isRunning() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_API}/api/version`, 2500);
    return res.ok;
  } catch {
    return false;
  }
}

async function hasModel() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_API}/api/tags`, 4000);
    if (!res.ok) return false;
    const data = await res.json();
    return (data.models || []).some((m) =>
      String(m.name || '').startsWith(OLLAMA_MODEL)
    );
  } catch {
    return false;
  }
}

async function getStatus() {
  const running = await isRunning();
  const installed = running || fs.existsSync(ollamaExePath());
  const modelReady = running ? await hasModel() : false;
  return { installed, running, modelReady, ready: running && modelReady };
}

async function downloadFile(url, dest, onProgress) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (HTTP ${res.status})`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const file = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!file.write(Buffer.from(value))) {
        await new Promise((resolve) => file.once('drain', resolve));
      }
      if (total) onProgress(Math.round((received / total) * 100));
    }
  } finally {
    await new Promise((resolve, reject) =>
      file.end((err) => (err ? reject(err) : resolve()))
    );
  }
  return dest;
}

async function waitForOllama(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isRunning()) return true;
    await sleep(2000);
  }
  return false;
}

function startOllama() {
  const exe = ollamaExePath();
  if (!fs.existsSync(exe)) return false;
  const child = spawn(exe, ['serve'], { detached: true, stdio: 'ignore' });
  child.unref();
  return true;
}

async function pullModel(onProgress) {
  const res = await fetch(`${OLLAMA_API}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: OLLAMA_MODEL, stream: true })
  });
  if (!res.ok || !res.body) {
    throw new Error(`Model download failed (HTTP ${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (evt.error) throw new Error(evt.error);
      if (evt.total && evt.completed != null) {
        onProgress(Math.round((evt.completed / evt.total) * 100), evt.status);
      } else if (evt.status) {
        onProgress(null, evt.status);
      }
    }
  }
}

// Orchestrates the full setup. `emit` receives { phase, percent, message }.
async function runSetup(emit) {
  let status = await getStatus();

  if (!status.installed) {
    const dest = path.join(os.tmpdir(), 'OllamaSetup.exe');
    emit({ phase: 'downloading', percent: 0, message: 'Downloading Ollama installer…' });
    await downloadFile(INSTALLER_URL, dest, (percent) =>
      emit({
        phase: 'downloading',
        percent,
        message: `Downloading Ollama installer… ${percent}%`
      })
    );
    emit({
      phase: 'installing',
      percent: null,
      message: 'Complete the Ollama installer window that just opened…'
    });
    const openError = await shell.openPath(dest);
    if (openError) throw new Error(`Could not open the installer: ${openError}`);
    const up = await waitForOllama(300000);
    if (!up) {
      throw new Error('Ollama did not start. Finish the installer, then try again.');
    }
  } else if (!status.running) {
    emit({ phase: 'starting', percent: null, message: 'Starting Ollama…' });
    startOllama();
    const up = await waitForOllama(30000);
    if (!up) throw new Error('Could not start Ollama. Please open it manually.');
  }

  status = await getStatus();
  if (!status.modelReady) {
    emit({ phase: 'pulling-model', percent: 0, message: 'Downloading AI model…' });
    await pullModel((percent, st) =>
      emit({
        phase: 'pulling-model',
        percent,
        message:
          percent != null
            ? `Downloading AI model… ${percent}%`
            : st || 'Downloading AI model…'
      })
    );
  }

  status = await getStatus();
  emit({ phase: 'done', percent: 100, message: 'Ollama is ready.' });
  return status;
}

module.exports = { getStatus, runSetup };
