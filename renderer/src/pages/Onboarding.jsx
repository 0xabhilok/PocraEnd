import { useState } from 'react';
import OllamaSetup from '../components/OllamaSetup.jsx';

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [personality, setPersonality] = useState('dark_humor');
  const [saving, setSaving] = useState(false);
  const [ollamaReady, setOllamaReady] = useState(false);

  const next = () => setStep((s) => s + 1);

  const finish = async () => {
    setSaving(true);
    try {
      await window.electronAPI.updateSettings({
        personality,
        gemini_api_key: apiKey || null,
        onboarding_completed: 1
      });
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-surface border border-border rounded-2xl p-8">
        {step === 0 && (
          <div>
            <h1 className="text-3xl font-bold mb-3">PocraEnd</h1>
            <p className="text-muted mb-6">
              An AI focus guardian that catches you drifting and helps you grind.
              Everything runs on your machine. Nothing leaves it.
            </p>
            <button
              onClick={next}
              className="w-full bg-accent text-white py-3 rounded-lg font-medium hover:opacity-90"
            >
              Get started
            </button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="text-2xl font-bold mb-3">Local AI</h2>
            <p className="text-muted mb-4">
              PocraEnd uses a small local model (Qwen 2.5 0.5B) via Ollama — it
              runs entirely on your machine. PocraEnd can set it up for you.
            </p>
            <div className="bg-bg border border-border rounded-lg p-4 mb-6">
              <OllamaSetup onReady={() => setOllamaReady(true)} />
            </div>
            {ollamaReady ? (
              <button
                onClick={next}
                className="w-full bg-accent text-white py-3 rounded-lg font-medium"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={next}
                className="w-full text-muted text-sm py-2 hover:text-text"
              >
                Skip for now — I'll set this up later
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-2xl font-bold mb-3">Cloud fallback (optional)</h2>
            <p className="text-muted mb-4">
              If you want better accuracy on hard cases, paste a Gemini API key.
              It's stored locally on your machine. Leave blank to use only local AI.
            </p>
            <input
              type="password"
              placeholder="AIza…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg p-3 mb-6 text-text"
            />
            <button
              onClick={next}
              className="w-full bg-accent text-white py-3 rounded-lg font-medium"
            >
              Continue
            </button>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-2xl font-bold mb-3">Pick your coach</h2>
            <p className="text-muted mb-4">How should PocraEnd talk to you?</p>
            <div className="space-y-2 mb-6">
              {[
                { id: 'dark_humor', name: 'Dark Humor', desc: 'Roasts you with love' },
                { id: 'drill', name: 'Drill Sergeant', desc: 'No nonsense, just orders' },
                { id: 'supportive', name: 'Supportive Friend', desc: 'Gentle and kind' }
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPersonality(p.id)}
                  className={`w-full text-left p-3 rounded-lg border ${
                    personality === p.id
                      ? 'border-accent bg-accent/10'
                      : 'border-border'
                  }`}
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-sm text-muted">{p.desc}</div>
                </button>
              ))}
            </div>
            <button
              onClick={finish}
              disabled={saving}
              className="w-full bg-accent text-white py-3 rounded-lg font-medium disabled:opacity-50"
            >
              {saving ? 'Setting up…' : 'Start using PocraEnd'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
