"use client";

import { useState, useEffect, useCallback } from 'react';

export type Theme = 'cyber-teal' | 'graphite' | 'white';
export type Accent = Theme;

const THEME_KEY = 'inkatest-theme';
const LEGACY_THEME_KEY = 'inkaqa-theme';
const LEGACY_ACCENT_KEY = 'inkatest-accent';

// Normalize any legacy or stored values to our 3 themes
function normalizeTheme(value: string | null): Theme {
  if (!value) return 'cyber-teal';
  if (value === 'cyber-teal' || value === 'graphite' || value === 'white') {
    return value;
  }
  if (value === 'teal') return 'cyber-teal';
  if (value === 'obsidian' || value === 'black') return 'graphite';
  if (value === 'light') return 'white';
  if (value === 'dark') return 'cyber-teal';
  return 'cyber-teal';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('cyber-teal');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const storedTheme =
      localStorage.getItem(THEME_KEY) ||
      localStorage.getItem(LEGACY_ACCENT_KEY) ||
      localStorage.getItem(LEGACY_THEME_KEY);

    setThemeState(normalizeTheme(storedTheme));
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;

    if (theme === 'white') {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
      root.setAttribute('data-theme', 'white');
    } else if (theme === 'graphite') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
      root.setAttribute('data-theme', 'graphite');
    } else {
      // cyber-teal
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
      root.setAttribute('data-theme', 'cyber-teal');
    }

    root.removeAttribute('data-accent');
    localStorage.setItem(THEME_KEY, theme);

    window.dispatchEvent(
      new CustomEvent('inka-theme-change', { detail: { theme } })
    );
  }, [theme, mounted]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      if (prev === 'cyber-teal') return 'graphite';
      if (prev === 'graphite') return 'white';
      return 'cyber-teal';
    });
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  const setAccent = useCallback((newAccent: Accent) => {
    setThemeState(normalizeTheme(newAccent));
  }, []);

  return {
    theme,
    toggleTheme,
    setTheme,
    accent: theme,
    setAccent,
    mounted,
  };
}
