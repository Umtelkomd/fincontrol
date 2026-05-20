import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'fincontrol.theme';

const readStored = () => {
  if (typeof window === 'undefined') return 'light';
  return localStorage.getItem(STORAGE_KEY) || 'light';
};

export function useTheme() {
  const [theme, setTheme] = useState(readStored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('nx-dark');
    else root.classList.remove('nx-dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle, setTheme };
}
