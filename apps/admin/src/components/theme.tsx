import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'gr_theme';

function readStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export type SetTheme = (theme: Theme, opts?: { persist?: boolean }) => void;

/**
 * Applies `data-theme` on <html>. Priority: choice made on this device (persisted) > profile
 * preference (applied by the app after login, not persisted) > OS preference.
 */
export function useTheme(): [Theme, () => void, SetTheme] {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (readStoredTheme()) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setThemeState(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback<SetTheme>((next, opts) => {
    if (opts?.persist === false) {
      if (!readStoredTheme()) setThemeState(next);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: keep it for this session only */
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );
  return [theme, toggle, setTheme];
}

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="btn ghost theme-toggle"
      onClick={onToggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}
