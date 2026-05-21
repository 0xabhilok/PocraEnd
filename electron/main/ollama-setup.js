const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');

const OLLAMA_API = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'phi3.5';
const KNOWN_MODELS = ['qwen2.5:0.5b', 'qwen2.5:1.5b', 'phi3.5', 'llama3.2:3b'];
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

// Names of every model currently pulled into Ollama.
async function listInstalledModels() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_API}/api/tags`, 4000);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => String(m.name || ''));
  } catch {
    return [];
  }
}

async function hasModel(model) {
  const installed = await listInstalledModels();
  return installed.some((name) => name.startsWith(model));
}

async function getStatus(model = DEFAULT_MODEL) {
  const running = await isRunning();
  const installed = running || fs.existsSync(ollamaExePath());
  const modelReady = running ? await hasModel(model) : false;
  return { installed, running, model, modelReady, ready: running && modelReady };
}

function getDeviceInfo() {
  return { totalRamGB: Math.round(os.totalmem() / 1024 / 1024 / 1024) };
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

async function pullModel(model, onProgress) {
  const res = await fetch(`${OLLAMA_API}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true })
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

async function deleteModel(model) {
  if (!KNOWN_MODELS.includes(model)) {
    throw new Error(`Unknown model: ${model}`);
  }
  const res = await fetch(`${OLLAMA_API}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model })
  });
  if (!res.ok) {
    throw new Error(`Could not delete the model (HTTP ${res.status})`);
  }
}

// Installs Ollama if needed, then makes sure `model` is downloaded.
// `emit` receives { phase, percent, message }.
async function runSetup(model, emit) {
  const target = KNOWN_MODELS.includes(model) ? model : DEFAULT_MODEL;
  let status = await getStatus(target);

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

  status = await getStatus(target);
  if (!status.modelReady) {
    emit({ phase: 'pulling-model', percent: 0, message: 'Downloading AI model…' });
    await pullModel(target, (percent, st) =>
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

  status = await getStatus(target);
  emit({ phase: 'done', percent: 100, message: 'Model is ready.' });
  return status;
}

module.exports = {
  getStatus,
  runSetup,
  listInstalledModels,
  deleteModel,
  getDeviceInfo,
  KNOWN_MODELS
};
