import { useState, useEffect } from 'react';
import ExtensionStatus from '../components/ExtensionStatus.jsx';

export default function Session({ navigate, config }) {
  const [timeLeft, setTimeLeft] = useState(config.durationMin * 60);
  const [drifts, setDrifts] = useState(0);
  const [grinds, setGrinds] = useState(0);

  useEffect(() => {
    // Tick timer down
    const tick = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(tick);
          handleEnd(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    // Listen for drift events from main
    const offDrift = window.electronAPI.onDriftDetected((_e, data) => {
      setDrifts((d) => d + 1);
    });

    const offGrind = window.electronAPI.onGrindClicked((_e) => {
      setGrinds((g) => g + 1);
    });

    return () => {
      clearInterval(tick);
      offDrift && offDrift();
      offGrind && offGrind();
    };
  }, []);

  const handleEnd = async (completed) => {
    const summary = await window.electronAPI.endSession({ completed });
    navigate('summary', summary);
  };

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="text-sm text-muted mb-2">Working on</div>
      <div className="text-2xl font-bold mb-8">{config.topic}</div>

      <div className="text-8xl font-bold tabular-nums mb-2">
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </div>
      <div className="mb-12">
        <ExtensionStatus compact />
      </div>

      <div className="flex gap-8 mb-12">
        <div className="text-center">
          <div className="text-3xl font-bold">{drifts}</div>
          <div className="text-xs text-muted uppercase tracking-wider">Drifts caught</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold">{grinds}</div>
          <div className="text-xs text-muted uppercase tracking-wider">Times you grinded</div>
        </div>
      </div>

      <button
        onClick={() => handleEnd(false)}
        className="text-muted hover:text-text text-sm border border-border rounded-lg px-4 py-2"
      >
        End session early
      </button>
    </div>
  );
}
