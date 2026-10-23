"use client";

import { cn } from '@/lib/utils';
import type { CaseStatus } from '@/lib/types';

interface StatusBadgeProps {
  status: CaseStatus;
  reviewStatus?: string | null;
  className?: string;
}

const statusStyles: Record<CaseStatus, { bg: string; text: string; dot: string }> = {
  active: {
    bg: 'bg-emerald-500/12 dark:bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-400 border-emerald-500/35 dark:border-emerald-500/20 font-semibold',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
  },
  draft: {
    bg: 'bg-muted/70 dark:bg-muted/40',
    text: 'text-foreground/85 border-border font-medium',
    dot: 'bg-muted-foreground',
  },
  deprecated: {
    bg: 'bg-muted/50 dark:bg-muted/20',
    text: 'text-muted-foreground border-border/60 line-through font-medium',
    dot: 'bg-muted-foreground/60',
  },
};

export function StatusBadge({ status, reviewStatus, className }: StatusBadgeProps) {
  const normReview = (reviewStatus || '').toLowerCase();

  if (normReview === 'pending') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold bg-indigo-500/12 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/35 dark:border-indigo-500/20 whitespace-nowrap',
          className
        )}
        title="In Review — pending peer review approval"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 shrink-0" />
        In Review
      </span>
    );
  }

  if (normReview === 'changes_requested') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold bg-amber-500/12 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/35 dark:border-amber-500/20 whitespace-nowrap',
          className
        )}
        title="Changes Requested — waiting for author revisions"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-400 shrink-0" />
        Changes Req.
      </span>
    );
  }

  const styles = statusStyles[status] || statusStyles.draft;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs border whitespace-nowrap',
        styles.bg,
        styles.text,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", styles.dot)} />
      <span className="capitalize">{status}</span>
    </span>
  );
}
