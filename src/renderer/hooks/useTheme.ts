import { useState, useEffect, useCallback } from 'react';
import { ThemeMode } from '../types';

export function useTheme() {
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');

  useEffect(() => {
    window.api.getTheme().then((t) => {
      setThemeState(t as 'light' | 'dark');
      document.documentElement.setAttribute('data-theme', t);
    });
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    if (mode === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const t = prefersDark ? 'dark' : 'light';
      setThemeState(t);
      window.api.setTheme(t);
      document.documentElement.setAttribute('data-theme', t);
    } else {
      setThemeState(mode);
      window.api.setTheme(mode);
      document.documentElement.setAttribute('data-theme', mode);
    }
  }, []);

  useEffect(() => {
    if (themeMode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        const t = e.matches ? 'dark' : 'light';
        setThemeState(t);
        window.api.setTheme(t);
        document.documentElement.setAttribute('data-theme', t);
      };
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [themeMode]);

  return { theme, themeMode, setTheme };
}
