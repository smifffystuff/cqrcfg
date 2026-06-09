import { useState, useEffect } from 'react';

const THEME_KEY = 'cqrcfg_theme';
const envName = window.__CQRCFG_ENV__ || '';

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getThemeFilename(mode) {
  const effectiveMode = mode === 'system' ? getSystemTheme() : mode;
  if (envName) {
    return `${envName}-${effectiveMode}`;
  }
  return effectiveMode;
}

function applyTheme(mode) {
  const filename = getThemeFilename(mode);
  const link = document.getElementById('theme-stylesheet');
  if (link) {
    link.href = `./themes/${filename}.css`;
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem(THEME_KEY) || 'system';
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  const cycleTheme = () => {
    const themes = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const icon = theme === 'light' ? '\u2600' : theme === 'dark' ? '\u263E' : '\u2699';
  const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'Auto';

  return (
    <button
      className="theme-toggle"
      onClick={cycleTheme}
      title={`Theme: ${label} (click to change)`}
    >
      <span className="theme-icon">{icon}</span>
      <span className="theme-label">{label}</span>
    </button>
  );
}
