import { useEffect, useState } from 'react';

export default function Settings({ navigate }) {
  const [settings, setSettings] = useState(null);
  const [motivations, setMotivations] = useState([]);
  const [newText, setNewText] = useState('');
  const [geminiKey, setGeminiKey] = useState('');

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings);
    window.electronAPI.getMotivations().then(setMotivations);
  }, []);

  if (!settings) return <div className="p-8 text-muted">Loading…</div>;

  const save = async (patch) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await window.electronAPI.updateSettings(updated);
  };

  const saveGeminiKey = async () => {
    const key = geminiKey.trim();
    if (!key) return;
    await save({ gemini_api_key: key });
    setGeminiKey('');
  };

  const addMotivation = async () => {
    const text = newText.trim();
    if (!text) return;
    const added = await window.electronAPI.addMotivation(text);
    setMotivations((prev) => [...prev, { id: added.id, text }]);
    setNewText('');
  };

  const deleteMotivation = async (id) => {
    await window.electronAPI.deleteMotivation(id);
    setMotivations((prev) => prev.filter((m) => m.id !== id));
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') addMotivation();
  };

  return (
    <div className="min-h-screen p-8 max-w-2xl mx-auto">
      <button
        onClick={() => navigate('dashboard')}
        className="text-muted hover:text-text text-sm mb-6"
      >
        ← Back
      </button>

      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <Section title="Coach personality">
        <div className="space-y-2">
          {[
            { id: 'dark_humor', name: 'Dark Humor' },
            { id: 'drill', name: 'Drill Sergeant' },
            { id: 'supportive', name: 'Supportive Friend' }
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => save({ personality: p.id })}
              className={`w-full text-left p-3 rounded-lg border ${
                settings.personality === p.id
                  ? 'border-accent bg-accent/10'
                  : 'border-border'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Custom motivations">
        <p className="text-xs text-muted mb-3">
          When you drift, PocraEnd picks one of these randomly. If none are set, the AI generates one instead.
        </p>

        <div className="space-y-2 mb-3">
          {motivations.length === 0 && (
            <p className="text-xs text-muted py-2">
              No custom motivations yet — AI will generate them on drift.
            </p>
          )}
          {motivations.map((m) => (
            <div
              key={m.id}
              className="flex items-start gap-2 bg-bg border border-border rounded-lg px-3 py-2"
            >
              <span className="flex-1 text-sm leading-relaxed">{m.text}</span>
              <button
                onClick={() => deleteMotivation(m.id)}
                className="text-muted hover:text-red-400 text-lg leading-none mt-0.5 shrink-0"
                title="Delete"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder='e.g., "Stop scrolling. You have 20 min left. Go."'
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={handleKey}
            className="flex-1 bg-bg border border-border rounded-lg p-3 text-sm"
          />
          <button
            onClick={addMotivation}
            disabled={!newText.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </Section>

      <Section title="Gemini API key (optional)">
        <div className="flex gap-2">
          <input
            type="password"
            placeholder={settings.gemini_api_key ? '•••••••••• (key saved)' : 'Not set'}
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            className="flex-1 bg-bg border border-border rounded-lg p-3"
          />
          <button
            onClick={saveGeminiKey}
            disabled={!geminiKey.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-40"
          >
            Save
          </button>
        </div>
        <p className="text-xs text-muted mt-2">
          Used as fallback when local model is unsure. Stored locally.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-3">{title}</h2>
      {children}
    </div>
  );
}
