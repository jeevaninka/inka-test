"use client";

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * Outcome tones used by the run deck / console. Kept as data so every surface
 * renders the same subtle treatment for the same outcome.
 */
export type StatusPillTone =
  | 'pass'
  | 'fail'
  | 'error'
  | 'blocked'
  | 'skip'
  | 'invalid'
  | 'pending'
  | 'running'
  | 'queued'
  | 'cancelled';

/**
 * Low-contrast fills: a tinted background, a hairline border and a readable
 * text colour. Deliberately soft so a table of 40 rows does not look like a
 * wall of saturated badges.
 */
export const STATUS_PILL_TONES: Record<StatusPillTone, string> = {
  pass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  fail: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  error: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  blocked: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  skip: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20',
  invalid: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  pending: 'bg-muted/40 text-muted-foreground border-border/60',
  running: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  queued: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  cancelled: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20',
};

interface StatusPillProps {
  tone: StatusPillTone;
  children: ReactNode;
  className?: string;
  title?: string;
  /** Leading glyph (dot, icon, …). */
  icon?: ReactNode;
}

/**
 * A small, softly curved status chip. Used instead of heavy filled badges so
 * dense tables stay calm.
 */
export function StatusPill({ tone, children, className, title, icon }: StatusPillProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-md border px-2 py-[1px] text-[11px] font-medium leading-4 whitespace-nowrap min-w-[72px] text-center shrink-0 select-none',
        STATUS_PILL_TONES[tone],
        className
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}
