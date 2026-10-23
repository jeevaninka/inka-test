"use client";

import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Session } from 'next-auth';

interface AppProviderProps {
  children: ReactNode;
  session?: Session | null;
}

export function AppProvider({ children, session }: AppProviderProps) {
  useEffect(() => {
    try {
      const t =
        localStorage.getItem('inkatest-theme') ||
        localStorage.getItem('inkatest-accent') ||
        localStorage.getItem('inkaqa-theme');
      const root = document.documentElement;
      if (t === 'white' || t === 'light') {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'white');
        root.style.colorScheme = 'light';
      } else if (t === 'graphite' || t === 'obsidian' || t === 'black') {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'graphite');
        root.style.colorScheme = 'dark';
      } else {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'cyber-teal');
        root.style.colorScheme = 'dark';
      }
      root.removeAttribute('data-accent');
    } catch {
      // ignore storage errors
    }
  }, []);

  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <MotionConfig reducedMotion="user">
        {children}
      </MotionConfig>
    </SessionProvider>
  );
}
