import { useState, useEffect } from 'react';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Session from './pages/Session.jsx';
import Summary from './pages/Summary.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const [page, setPage] = useState('loading');
  const [pageData, setPageData] = useState(null);

  useEffect(() => {
    // On boot, ask main process whether onboarding is done
    window.electronAPI.getSettings().then((settings) => {
      if (!settings || !settings.onboarding_completed) {
        setPage('onboarding');
      } else {
        setPage('dashboard');
      }
    });
  }, []);

  const navigate = (newPage, data = null) => {
    setPageData(data);
    setPage(newPage);
  };

  if (page === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {page === 'onboarding' && <Onboarding onDone={() => navigate('dashboard')} />}
      {page === 'dashboard' && <Dashboard navigate={navigate} />}
      {page === 'session' && <Session navigate={navigate} config={pageData} />}
      {page === 'summary' && <Summary navigate={navigate} summary={pageData} />}
      {page === 'settings' && <Settings navigate={navigate} />}
    </div>
  );
}
