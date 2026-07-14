import { useState, useEffect } from 'react';
import InstallExtensionModal from './InstallExtensionModal.jsx';

export default function ExtensionStatus({ compact = false }) {
  const [status, setStatus] = useState({ connected: false, count: 0 });
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    const poll = () => {
      window.electronAPI.getExtensionStatus()
        .then(s => { if (s) setStatus(s); })
        .catch(() => {});
    };

    poll();
    const interval = setInterval(poll, 2000);

    const off = window.electronAPI.onExtensionStatusChange((_e, data) => {
      setStatus(data);
    });

    return () => {
      clearInterval(interval);
      off && off();
    };
  }, []);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            status.connected ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className="text-xs text-muted">
          {status.connected ? 'Extension connected' : 'Extension not connected'}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`border rounded-lg p-3 ${
        status.connected
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-red-500/30 bg-red-500/5'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              status.connected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="font-medium text-sm">
            {status.connected
              ? `Browser extension connected${status.count > 1 ? ` (${status.count})` : ''}`
              : 'Browser extension not connected'}
          </span>
        </div>
        {!status.connected && (
          <button
            onClick={() => setShowInstall(true)}
            className="text-xs bg-accent text-white px-3 py-1 rounded-lg font-medium hover:opacity-90 shrink-0"
          >
            Install
          </button>
        )}
      </div>
      {!status.connected && (
        <p className="text-xs text-muted">
          PocraEnd can't watch your browser tabs without it — install takes under a minute.
        </p>
      )}
      <InstallExtensionModal
        open={showInstall}
        onClose={() => setShowInstall(false)}
        connected={status.connected}
      />
    </div>
  );
}
