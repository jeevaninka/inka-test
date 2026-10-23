"use client";

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Display helper for variable names: the {{ }} wrapper is execution syntax,
 * not part of the name. UIs show the bare key; inputs/templates keep braces.
 */
export function formatVariableName(name?: string | null): string {
  return String(name ?? '')
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '$1')
    .trim();
}

/**
 * Formats seconds into human-readable duration (e.g. 45s, 1m 24s, 1h 12m)
 */
export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '0s';
  const s = Math.floor(seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const remainingSecs = s % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return remainingSecs > 0 ? `${minutes}m ${remainingSecs}s` : `${minutes}m`;
  }
  return `${remainingSecs}s`;
}

/**
 * Automatically masks sensitive values (passwords, tokens, secrets, api keys) in test data
 */
export function maskSensitiveData(text?: string | null): string {
  if (!text) return '';
  return text.replace(
    /(password|passwd|pwd|secret|token|api[_-]?key|bearer|auth[_-]?token)(\s*[:=]\s*)(['"]?)([^'",\s]+)(['"]?)/gi,
    (match, key, sep, openQuote, val, closeQuote) => {
      return `${key}${sep}${openQuote}••••••••${closeQuote}`;
    }
  );
}