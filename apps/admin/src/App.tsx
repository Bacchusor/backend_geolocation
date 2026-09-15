import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { LoginPage } from './pages/LoginPage';
import { PlacesPage } from './pages/PlacesPage';
import { RulesPage } from './pages/RulesPage';
import { RecipientsPage } from './pages/RecipientsPage';
import { NotionPage } from './pages/NotionPage';
import { EventsPage } from './pages/EventsPage';
import { ThemeToggle, useTheme } from './components/theme';

export function App() {
  const qc = useQueryClient();
  const [loggedOut, setLoggedOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me, retry: false });

  useEffect(() => {
    const onUnauthorized = () => setLoggedOut(true);
    window.addEventListener('gr:unauthorized', onUnauthorized);
    return () => window.removeEventListener('gr:unauthorized', onUnauthorized);
  }, []);

  if (me.isLoading) return <div className="center muted">Loading…</div>;
  const authed = me.isSuccess && !loggedOut;
  if (!authed) {
    return (
      <LoginPage
        onLoggedIn={() => {
          setLoggedOut(false);
          void qc.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    );
  }

  const logout = async () => {
    await api.auth.logout();
    qc.clear();
    setLoggedOut(true);
  };

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">📍 GeoReminder</div>
        <nav>
          <NavLink to="/places">Map & Places</NavLink>
          <NavLink to="/rules">Rules</NavLink>
          <NavLink to="/recipients">Recipients & Channels</NavLink>
          <NavLink to="/notion">Notion</NavLink>
          <NavLink to="/events">Event log</NavLink>
        </nav>
        <div className="spacer" />
        <a className="muted" href="/api/docs" target="_blank" rel="noreferrer">
          API docs
        </a>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <button className="btn ghost" onClick={() => void logout()}>
          Log out
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/places" replace />} />
          <Route path="/places" element={<PlacesPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/recipients" element={<RecipientsPage />} />
          <Route path="/notion" element={<NotionPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="*" element={<Navigate to="/places" replace />} />
        </Routes>
      </main>
    </div>
  );
}
