import { useState, useEffect, useRef } from 'react';

export default function OllamaSetup({ onReady }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const applyStatus = (s) => {
    setStatus(s);
    if (s && s.ready && onReadyRef.current) onReadyRef.current(s);
  };

  const refresh = async () => {
    const s = await window.electronAPI.getOllamaStatus();
    applyStatus(s);
  };

  useEffect(() => {
    refresh();
    const off = window.electronAPI.onOllamaProgress((data) => {
      if (data.phase === 'error') setError(data.message);
      else setProgress(data);
    });
    return () => off && off();
  }, []);

  const install = async () => {
    setError(null);
    setBusy(true);
    setProgress({ phase: 'starting', message: 'Starting setup…', percent: null });
    const result = await window.electronAPI.installOllama();
    setBusy(false);
    setProgress(null);
    if (result.ok) applyStatus(result.status);
    else setError(result.error || 'Setup failed. Please try again.');
  };

  if (!status) {
    return <p className="text-muted text-sm">Checking Ollama…</p>;
  }

  return (
    <div>
      <div className="space-y-2 mb-4">
        <Check ok={status.installed} label="Ollama installed" />
        <Check ok={status.running} label="Ollama running" />
        <Check ok={status.modelReady} label="AI model (qwen2.5:3b)" />
      </div>

      {status.ready && !busy && (
        <p className="text-sm text-green-500">Local AI is ready to go.</p>
      )}

      {busy && progress && (
        <div className="mb-1">
          <p className="text-sm text-muted mb-2">{progress.message}</p>
          {progress.percent != null && (
            <div className="w-full bg-bg border border-border rounded-full h-2 overflow-hidden">
              <div
                className="bg-accent h-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {!status.ready && !busy && (
        <>
          <button
            onClick={install}
            className="w-full bg-accent text-white py-2.5 rounded-lg font-medium hover:opacity-90"
          >
            Set up Ollama automatically
          </button>
          <button
            onClick={refresh}
            className="w-full text-muted text-sm mt-2 hover:text-text"
          >
            Re-check
          </button>
        </>
      )}
    </div>
  );
}

function Check({ ok, label }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
          ok
            ? 'bg-green-500/20 text-green-500'
            : 'bg-bg border border-border text-muted'
        }`}
      >
        {ok ? '✓' : '–'}
      </span>
      <span className={ok ? 'text-text' : 'text-muted'}>{label}</span>
    </div>
  );
}
