"use client";

import { cn } from '@/lib/utils';
import type { RunStatus } from '@/lib/types';

interface RunStatusBadgeProps {
  status: RunStatus;
  className?: string;
}

const runStatusStyles: Record<RunStatus, { bg: string; text: string; border: string }> = {
  in_progress: {
    bg: 'bg-blue-500/12 dark:bg-blue-500/15',
    text: 'text-blue-700 dark:text-blue-400',
    border: 'border-blue-500/30 dark:border-blue-500/25',
  },
  completed: {
    bg: 'bg-emerald-500/12 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-400',
    border: 'border-emerald-500/30 dark:border-emerald-500/25',
  },
  failed: {
    bg: 'bg-rose-500/12 dark:bg-rose-500/15',
    text: 'text-rose-700 dark:text-rose-400',
    border: 'border-rose-500/30 dark:border-rose-500/25',
  },
  aborted: {
    bg: 'bg-zinc-500/12 dark:bg-zinc-500/15',
    text: 'text-zinc-700 dark:text-zinc-400',
    border: 'border-zinc-500/30 dark:border-zinc-500/25',
  },
};

const statusLabels: Record<RunStatus, string> = {
  in_progress: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  aborted: 'Aborted',
};

export function RunStatusBadge({ status, className }: RunStatusBadgeProps) {
  const styles = runStatusStyles[status] || runStatusStyles.in_progress;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        styles.bg,
        styles.text,
        styles.border,
        className
      )}
    >
      {statusLabels[status] || status}
    </span>
  );
}