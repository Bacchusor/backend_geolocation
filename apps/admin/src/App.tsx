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
import { ProfilesPage } from './pages/ProfilesPage';
import { MyProfilePage } from './pages/MyProfilePage';
import { ThemeToggle, useTheme } from './components/theme';

export function App() {
  const qc = useQueryClient();
  const [loggedOut, setLoggedOut] = useState(false);
  const [theme, toggleTheme, setTheme] = useTheme();
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me, retry: false });

  useEffect(() => {
    const onUnauthorized = () => setLoggedOut(true);
    window.addEventListener('gr:unauthorized', onUnauthorized);
    return () => window.removeEventListener('gr:unauthorized', onUnauthorized);
  }, []);

  // Apply the profile's theme preference (unless the user picked one on this device).
  const prefTheme = me.data?.user?.preferences.theme;
  useEffect(() => {
    if (prefTheme && prefTheme !== 'system') setTheme(prefTheme, { persist: false });
  }, [prefTheme, setTheme]);

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

  const isAdmin = me.data.role === 'admin';
  const user = me.data.user;
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
          {isAdmin && <NavLink to="/recipients">Recipients & Channels</NavLink>}
          {isAdmin && <NavLink to="/notion">Notion</NavLink>}
          <NavLink to="/events">Event log</NavLink>
          {isAdmin && <NavLink to="/profiles">Profiles</NavLink>}
        </nav>
        <div className="spacer" />
        <a className="muted" href="/api/docs" target="_blank" rel="noreferrer">
          API docs
        </a>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <NavLink to="/me" className="btn ghost user-chip" title="My profile">
          👤 {user?.display_name ?? 'API'}{' '}
          <span className={`badge ${isAdmin ? 'info' : ''}`}>{me.data.role}</span>
        </NavLink>
        <button className="btn ghost" onClick={() => void logout()}>
          Log out
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/places" replace />} />
          <Route path="/places" element={<PlacesPage readOnly={!isAdmin} />} />
          <Route path="/rules" element={<RulesPage readOnly={!isAdmin} />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/me" element={<MyProfilePage />} />
          {isAdmin && <Route path="/recipients" element={<RecipientsPage />} />}
          {isAdmin && <Route path="/notion" element={<NotionPage />} />}
          {isAdmin && <Route path="/profiles" element={<ProfilesPage />} />}
          <Route path="*" element={<Navigate to="/places" replace />} />
        </Routes>
      </main>
    </div>
  );
}
