import { useEffect, useState } from 'react';

export default function InstallExtensionModal({ open, onClose, connected }) {
  const [folderPath, setFolderPath] = useState('');
  const [copied, setCopied] = useState(false);
  const [justConnected, setJustConnected] = useState(false);

  useEffect(() => {
    if (open) window.electronAPI.getExtensionFolderPath().then(setFolderPath);
  }, [open]);

  // Auto-close a beat after the extension actually connects, so the user
  // gets a clear "it worked" moment instead of the modal just vanishing.
  useEffect(() => {
    if (!open || !connected) return;
    setJustConnected(true);
    const t = setTimeout(onClose, 1600);
    return () => clearTimeout(t);
  }, [open, connected, onClose]);

  useEffect(() => {
    if (!open) setJustConnected(false);
  }, [open]);

  if (!open) return null;

  const copyPath = () => {
    navigator.clipboard.writeText(folderPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-xl font-bold">Connect the browser extension</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-text text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-sm text-muted mb-6">
          Chrome won't let apps auto-install unpacked extensions — it's a security thing, not a PocraEnd thing. Four clicks and you're done.
        </p>

        <div className="space-y-5 mb-6">
          <Step n={1} title="Open Chrome's extensions page">
            <button
              onClick={() => window.electronAPI.openChromeExtensionsPage()}
              className="mt-2 text-sm bg-accent text-white px-3 py-1.5 rounded-lg font-medium hover:opacity-90"
            >
              Open chrome://extensions
            </button>
          </Step>

          <Step n={2} title="Turn on Developer mode">
            Flip the toggle in the top-right corner of that page.
          </Step>

          <Step n={3} title='Click "Load unpacked"'>
            It appears once Developer mode is on.
          </Step>

          <Step n={4} title="Select the extension folder">
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => window.electronAPI.openExtensionFolder()}
                className="text-sm bg-bg border border-border px-3 py-1.5 rounded-lg font-medium hover:border-accent"
              >
                Open folder
              </button>
              <button
                onClick={copyPath}
                className="text-sm text-muted hover:text-text px-2 py-1.5"
              >
                {copied ? 'Copied!' : 'Copy path'}
              </button>
            </div>
            {folderPath && (
              <div className="mt-2 text-xs text-muted bg-bg border border-border rounded-lg px-2 py-1.5 font-mono break-all">
                {folderPath}
              </div>
            )}
          </Step>
        </div>

        <div
          className={`flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
            justConnected ? 'border-green-500/40 bg-green-500/10' : 'border-border bg-bg'
          }`}
        >
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${
              justConnected ? 'bg-green-500' : 'bg-accent animate-pulse'
            }`}
          />
          <span>
            {justConnected
              ? "Connected — you're all set."
              : 'Waiting for the extension to connect…'}
          </span>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 shrink-0 rounded-full bg-accent/15 text-accent border border-accent/30 flex items-center justify-center text-sm font-bold">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{title}</div>
        <div className="text-xs text-muted mt-0.5">{children}</div>
      </div>
    </div>
  );
}
