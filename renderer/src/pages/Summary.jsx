export default function Summary({ navigate, summary }) {
  if (!summary) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <button
          onClick={() => navigate('dashboard')}
          className="text-accent"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  const focusScore =
    summary.actual_duration_min > 0
      ? Math.max(0, Math.round(100 - (summary.drifts_count * 100) / summary.actual_duration_min))
      : 0;

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-surface border border-border rounded-2xl p-8">
        <h1 className="text-2xl font-bold mb-1">Session complete</h1>
        <p className="text-muted mb-6">{summary.topic}</p>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <Stat label="Focused" value={`${summary.actual_duration_min}m`} />
          <Stat label="Focus score" value={`${focusScore}%`} />
          <Stat label="Drifts caught" value={summary.drifts_count} />
          <Stat label="Times grinded" value={summary.grinds_count} />
        </div>

        <button
          onClick={() => navigate('dashboard')}
          className="w-full bg-accent text-white py-3 rounded-lg font-medium"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-bg border border-border rounded-lg p-4">
      <div className="text-xs text-muted uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
