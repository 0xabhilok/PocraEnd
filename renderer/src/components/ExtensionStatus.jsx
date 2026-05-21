import { useState, useEffect } from 'react';

export default function ExtensionStatus({ compact = false }) {
  const [status, setStatus] = useState({ connected: false, count: 0 });

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
      <div className="flex items-center gap-2 mb-1">
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
        <p className="text-xs text-muted">
          PocraEnd can't watch your browser tabs. Install the Chrome extension from the{' '}
          <code className="bg-bg px-1 py-0.5 rounded">chrome-extension/</code> folder via
          chrome://extensions → Load unpacked.
        </p>
      )}
    </div>
  );
}
