import { useState, useEffect } from 'react';
import { MODELS, recommendedModel } from '../modelCatalog.js';

export default function ModelManager() {
  const [active, setActive] = useState(null);
  const [installed, setInstalled] = useState([]);
  const [ram, setRam] = useState(null);
  const [working, setWorking] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const refresh = async () => {
    const [settings, models] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.getInstalledModels()
    ]);
    setActive(settings && settings.ai_model);
    setInstalled(models || []);
  };

  useEffect(() => {
    window.electronAPI.getSystemInfo().then((i) => setRam(i && i.totalRamGB));
    refresh();
    const off = window.electronAPI.onOllamaProgress((data) => {
      if (data.phase === 'error') setError(data.message);
      else setProgress(data);
    });
    return () => off && off();
  }, []);

  const isInstalled = (id) => installed.some((n) => n.startsWith(id));

  const install = async (id) => {
    setError(null);
    setWorking(id);
    setProgress({ message: 'Starting…', percent: null });
    const result = await window.electronAPI.installOllama(id);
    setWorking(null);
    setProgress(null);
    if (result.ok) await refresh();
    else setError(result.error || 'Install failed.');
  };

  const switchTo = async (id) => {
    setError(null);
    await window.electronAPI.setActiveModel(id);
    await refresh();
  };

  const remove = async (id) => {
    setError(null);
    const result = await window.electronAPI.deleteModel(id);
    if (result.ok) await refresh();
    else setError(result.error || 'Delete failed.');
  };

  const recommended = recommendedModel(ram);

  return (
    <div>
      <p className="text-xs text-muted mb-3">
        The AI model decides what counts as a distraction. Bigger models are more
        accurate but use more disk and RAM
        {ram != null ? ` — your PC has ${ram} GB` : ''}.
      </p>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      <div className="space-y-2">
        {MODELS.map((m) => {
          const inst = isInstalled(m.id);
          const isActive = active === m.id;
          const busyThis = working === m.id;
          return (
            <div key={m.id} className="bg-bg border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{m.name}</span>
                {isActive && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                    Active
                  </span>
                )}
                {inst && !isActive && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-500">
                    Installed
                  </span>
                )}
                {m.id === recommended && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-border text-muted">
                    Recommended
                  </span>
                )}
              </div>
              <div className="text-xs text-muted mt-1">
                {m.disk} · needs {m.ramGB} GB RAM · {m.accuracy} accuracy
              </div>
              <div className="text-xs text-muted mt-1 mb-2">{m.blurb}</div>

              {busyThis && progress ? (
                <div>
                  <p className="text-xs text-muted mb-1">{progress.message}</p>
                  {progress.percent != null && (
                    <div className="w-full bg-surface border border-border rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-accent h-full transition-all"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap items-center">
                  {!inst && (
                    <button
                      onClick={() => install(m.id)}
                      disabled={!!working}
                      className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-40"
                    >
                      Install
                    </button>
                  )}
                  {inst && !isActive && (
                    <button
                      onClick={() => switchTo(m.id)}
                      disabled={!!working}
                      className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-40"
                    >
                      Use this model
                    </button>
                  )}
                  {inst && !isActive && (
                    <button
                      onClick={() => remove(m.id)}
                      disabled={!!working}
                      className="px-3 py-1.5 border border-border rounded-lg text-sm text-muted hover:text-red-400 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  )}
                  {isActive && (
                    <span className="text-xs text-muted">
                      In use — switch to another model before deleting this one.
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
