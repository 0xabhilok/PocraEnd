import { useState, useEffect, useRef } from 'react';
import ExtensionStatus from '../components/ExtensionStatus.jsx';
import OllamaSetup from '../components/OllamaSetup.jsx';

export default function Dashboard({ navigate }) {
  const [data, setData] = useState(null);
  const [extConnected, setExtConnected] = useState(false);
  const [topic, setTopic] = useState('');
  const [topicError, setTopicError] = useState(false);
  const [workType, setWorkType] = useState('coding');
  const [duration, setDuration] = useState(25);
  const [ollamaReady, setOllamaReady] = useState(true);
  const topicRef = useRef(null);

  useEffect(() => {
    window.electronAPI.getDashboardData().then(setData);
    window.electronAPI.getExtensionStatus().then((s) => setExtConnected(s.connected));
    window.electronAPI.getOllamaStatus().then((s) => setOllamaReady(s.ready));
    window.electronAPI.getSettings().then((s) => {
      if (s && s.default_duration_min) setDuration(s.default_duration_min);
    });
    const off = window.electronAPI.onExtensionStatusChange((_e, s) =>
      setExtConnected(s.connected)
    );
    return () => off && off();
  }, []);

  const startSession = async () => {
    if (!topic.trim()) {
      setTopicError(true);
      topicRef.current?.focus();
      return;
    }
    if (!extConnected) {
      const proceed = confirm(
        "Browser extension isn't connected. PocraEnd won't catch browser distractions. Start anyway?"
      );
      if (!proceed) return;
    }
    const session = await window.electronAPI.startSession({
      topic: topic.trim(),
      workType,
      durationMin: duration
    });
    navigate('session', session);
  };

  return (
    <div className="min-h-screen p-8 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">PocraEnd</h1>
        <button
          onClick={() => navigate('settings')}
          className="text-muted hover:text-text text-sm"
        >
          Settings
        </button>
      </div>

      <div className="mb-6">
        <ExtensionStatus />
      </div>

      {!ollamaReady && (
        <div className="bg-surface border border-yellow-500/40 rounded-2xl p-5 mb-6">
          <h3 className="font-bold mb-1">Local AI not ready</h3>
          <p className="text-sm text-muted mb-4">
            PocraEnd needs Ollama to catch distractions. Set it up now:
          </p>
          <OllamaSetup onReady={() => setOllamaReady(true)} />
        </div>
      )}

      {data && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Stat label="Current streak" value={`${data.streak} day${data.streak === 1 ? '' : 's'}`} />
          <Stat label="This week" value={`${data.weekMinutes} min`} />
          <Stat label="Sessions" value={data.totalSessions} />
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl p-6">
        <h2 className="text-xl font-bold mb-4">Start a focus session</h2>

        <label className="block mb-4">
          <span className="text-sm text-muted block mb-1">What are you working on?</span>
          <input
            ref={topicRef}
            type="text"
            placeholder="e.g., React assignment, DBMS revision"
            value={topic}
            onChange={(e) => { setTopic(e.target.value); setTopicError(false); }}
            className={`w-full bg-bg border rounded-lg p-3 text-text ${topicError ? 'border-red-500' : 'border-border'}`}
          />
          {topicError && (
            <span className="text-xs text-red-500 mt-1 block">Type what you're working on first.</span>
          )}
        </label>

        <label className="block mb-4">
          <span className="text-sm text-muted block mb-1">Work type</span>
          <select
            value={workType}
            onChange={(e) => setWorkType(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg p-3 text-text"
          >
            <option value="coding">Coding</option>
            <option value="studying">Studying</option>
            <option value="writing">Writing</option>
            <option value="research">Research</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="block mb-6">
          <span className="text-sm text-muted block mb-1">Duration</span>
          <div className="flex gap-2">
            {[25, 45, 60, 90].map((d) => (
              <button
                key={d}
                onClick={() => {
                  setDuration(d);
                  window.electronAPI.updateSettings({ default_duration_min: d });
                }}
                className={`flex-1 py-2 rounded-lg border ${
                  duration === d ? 'border-accent bg-accent/10' : 'border-border'
                }`}
              >
                {d} min
              </button>
            ))}
          </div>
        </label>

        <button
          onClick={startSession}
          className="w-full bg-accent text-white py-3 rounded-lg font-medium hover:opacity-90"
        >
          Start session
        </button>
      </div>

      {data?.lastSession && (
        <div className="mt-6 text-sm text-muted">
          Last session: {data.lastSession.topic} — {data.lastSession.actual_duration_min} min,{' '}
          {data.lastSession.drifts_count} drift{data.lastSession.drifts_count === 1 ? '' : 's'} caught
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-4">
      <div className="text-xs text-muted uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
