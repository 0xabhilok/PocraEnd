import { useState, useEffect, useRef } from 'react';
import { MODELS, recommendedModel, getModel } from '../modelCatalog.js';

export default function OllamaSetup({ onReady }) {
  const [status, setStatus] = useState(null);
  const [ram, setRam] = useState(null);
  const [installed, setInstalled] = useState([]);
  const [selected, setSelected] = useState('phi3.5');
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
    const [s, models] = await Promise.all([
      window.electronAPI.getOllamaStatus(),
      window.electronAPI.getInstalledModels()
    ]);
    setInstalled(models || []);
    applyStatus(s);
  };

  useEffect(() => {
    window.electronAPI.getSystemInfo().then((info) => {
      const gb = info && info.totalRamGB;
      setRam(gb);
      setSelected(recommendedModel(gb));
    });
    refresh();
    const off = window.electronAPI.onOllamaProgress((data) => {
      if (data.phase === 'error') setError(data.message);
      else setProgress(data);
    });
    return () => off && off();
  }, []);

  const isInstalled = (id) => installed.some((n) => n.startsWith(id));

  const install = async () => {
    setError(null);
    setBusy(true);
    setProgress({ message: 'Starting setup…', percent: null });
    const result = await window.electronAPI.installOllama(selected);
    if (result.ok) {
      await window.electronAPI.setActiveModel(selected);
      await refresh();
    } else {
      setError(result.error || 'Setup failed. Please try again.');
    }
    setBusy(false);
    setProgress(null);
  };

  if (!status) {
    return <p className="text-muted text-sm">Checking Ollama…</p>;
  }

  if (status.ready) {
    return (
      <p className="text-sm text-green-500">
        Local AI is ready — using{' '}
        <span className="font-medium">
          {getModel(status.model)?.name || status.model}
        </span>
        .
      </p>
    );
  }

  const recommended = recommendedModel(ram);

  return (
    <div>
      <p className="text-sm text-muted mb-1">Choose a local AI model.</p>
      {ram != null && (
        <p className="text-xs text-muted mb-3">Your PC has {ram} GB of RAM.</p>
      )}

      <div className="space-y-2 mb-4">
        {MODELS.map((m) => {
          const sel = selected === m.id;
          const tooBig = ram != null && ram < m.ramGB;
          return (
            <button
              key={m.id}
              type="button"
              disabled={busy}
              onClick={() => setSelected(m.id)}
              className={`w-full text-left p-3 rounded-lg border ${
                sel ? 'border-accent bg-accent/10' : 'border-border'
              } disabled:opacity-60`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{m.name}</span>
                {m.id === recommended && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                    Recommended for your PC
                  </span>
                )}
                {isInstalled(m.id) && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-500">
                    Installed
                  </span>
                )}
                {m.weak && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-500">
                    Weak
                  </span>
                )}
              </div>
              <div className="text-xs text-muted mt-1">
                {m.disk} download · needs {m.ramGB} GB RAM · {m.accuracy} accuracy
              </div>
              <div className="text-xs text-muted mt-1">{m.blurb}</div>
              {tooBig && (
                <div className="text-xs text-yellow-500 mt-1">
                  May run slowly — your PC has less RAM than this model wants.
                </div>
              )}
            </button>
          );
        })}
      </div>

      {busy && progress && (
        <div className="mb-3">
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

      {!busy && (
        <button
          onClick={install}
          className="w-full bg-accent text-white py-2.5 rounded-lg font-medium hover:opacity-90"
        >
          Set up {getModel(selected)?.name || selected}
        </button>
      )}
    </div>
  );
}
