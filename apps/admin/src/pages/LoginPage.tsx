import { useState } from 'react';
import { api } from '../api';
import { Alert, errorMessage } from '../components/ui';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth.login(username, password);
      onLoggedIn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login panel">
      <h2 style={{ marginTop: 0 }}>📍 GeoReminder admin</h2>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          <span>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <Alert kind="err">{error}</Alert>}
        <button className="btn primary" disabled={busy}>
          Log in
        </button>
      </form>
    </div>
  );
}
