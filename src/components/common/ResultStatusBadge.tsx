"use client";

import { cn } from '@/lib/utils';
import { Check, X, Ban, SkipForward, Circle, AlertTriangle, Clock } from 'lucide-react';
import type { ResultStatus } from '@/lib/types';
import { StatusPill, type StatusPillTone } from './StatusPill';

interface ResultStatusBadgeProps {
  status: ResultStatus;
  className?: string;
  showIcon?: boolean;
  attemptNumber?: number;
  timeSpentSeconds?: number;
  isManualOverride?: boolean;
  /**
   * `pill` keeps the filled badge used on detail screens. `plain` renders the
   * outcome as colored text + a subtle icon, for dense tables. `subtle` renders
   * a small, softly curved chip for the same dense tables.
   */
  variant?: 'pill' | 'plain' | 'subtle';
}

const resultConfig: Record<
  ResultStatus,
  { bg: string; text: string; icon: React.ElementType }
> = {
  pass: {
    bg: 'bg-emerald-600 text-white shadow-xs',
    text: 'text-white',
    icon: Check,
  },
  fail: {
    bg: 'bg-red-600 text-white shadow-xs',
    text: 'text-white',
    icon: X,
  },
  error: {
    bg: 'bg-violet-600 text-white shadow-xs',
    text: 'text-white',
    icon: AlertTriangle,
  },
  blocked: {
    bg: 'bg-amber-600 text-white shadow-xs',
    text: 'text-white',
    icon: Ban,
  },
  skip: {
    bg: 'bg-zinc-600 text-white shadow-xs',
    text: 'text-white',
    icon: SkipForward,
  },
  pending: {
    bg: 'bg-transparent text-muted-foreground/80 border border-transparent group-hover/row:border-border/50 hover:border-border hover:bg-muted/40 hover:text-foreground transition-colors',
    text: 'text-muted-foreground/80',
    icon: Circle,
  },
  invalid: {
    bg: 'bg-violet-600 text-white shadow-xs',
    text: 'text-white',
    icon: AlertTriangle,
  },
  // Finished, but the provider never returned a terminal result before the
  // monitoring-expiry policy was reached. Explicitly NOT a test failure.
  unavailable: {
    bg: 'bg-amber-500/15 text-amber-600 border border-amber-500/30',
    text: 'text-amber-600',
    icon: Clock,
  },
  // The case never produced a verdict: it was cancelled when the run stopped.
  cancelled: {
    bg: 'bg-zinc-500/15 text-zinc-500 border border-zinc-500/30',
    text: 'text-zinc-500',
    icon: Ban,
  },
};

const plainConfig: Record<ResultStatus, { text: string; icon: React.ElementType }> = {
  pass: { text: 'text-emerald-400', icon: Check },
  fail: { text: 'text-red-400', icon: X },
  error: { text: 'text-violet-400', icon: AlertTriangle },
  blocked: { text: 'text-amber-400', icon: Ban },
  skip: { text: 'text-zinc-400', icon: SkipForward },
  pending: { text: 'text-muted-foreground', icon: Circle },
  invalid: { text: 'text-violet-400', icon: AlertTriangle },
  unavailable: { text: 'text-amber-400', icon: Clock },
  cancelled: { text: 'text-zinc-400', icon: Ban },
};

const subtleTones: Record<ResultStatus, StatusPillTone> = {
  pass: 'pass',
  fail: 'fail',
  error: 'error',
  blocked: 'blocked',
  skip: 'skip',
  invalid: 'invalid',
  pending: 'pending',
  unavailable: 'blocked',
  cancelled: 'cancelled',
};

export function ResultStatusBadge({
  status,
  className,
  showIcon = false,
  attemptNumber,
  timeSpentSeconds,
  variant = 'pill',
}: ResultStatusBadgeProps) {
  const isStarted = status === 'pending' && typeof timeSpentSeconds === 'number' && timeSpentSeconds > 0;
  const config = isStarted
    ? { bg: 'bg-[#4aa8ff]/15 text-[#4aa8ff] border border-[#4aa8ff]/30', text: 'text-[#4aa8ff]', icon: Clock }
    : resultConfig[status] || resultConfig.pending;
  const Icon = config.icon;
  const hasAttempt = typeof attemptNumber === 'number' && attemptNumber > 1;

  const primaryLabel = isStarted
    ? 'Running'
    : status === 'pending'
    ? 'Not Run'
    : status.charAt(0).toUpperCase() + status.slice(1);

  const fullTitle = `${primaryLabel}${hasAttempt ? ` (Attempt #${attemptNumber})` : ''}${isStarted ? ' · Timer running' : ''}`;

  if (variant === 'subtle') {
    const plain = plainConfig[status] || plainConfig.pending;
    const PlainIcon = plain.icon;
    return (
      <div className="inline-flex items-center gap-1.5 select-none shrink-0">
        <StatusPill
          tone={isStarted ? 'running' : subtleTones[status] || 'pending'}
          title={fullTitle}
          className={className}
          icon={
            isStarted ? (
              <i className="running-dot shrink-0" />
            ) : (
              <PlainIcon className="h-3 w-3 shrink-0" />
            )
          }
        >
          {primaryLabel}
        </StatusPill>
        {hasAttempt && (
          <span
            title={`Execution Attempt #${attemptNumber}`}
            className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0"
          >
            Att #{attemptNumber}
          </span>
        )}
      </div>
    );
  }

  if (variant === 'plain') {
    const plain = plainConfig[status] || plainConfig.pending;
    const PlainIcon = plain.icon;
    return (
      <div className="inline-flex items-center gap-1.5 select-none shrink-0">
        <span
          title={fullTitle}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap',
            isStarted ? 'text-[#4aa8ff]' : plain.text,
            className
          )}
        >
          {isStarted ? (
            <i className="running-dot shrink-0" />
          ) : (
            <PlainIcon className="h-3 w-3 shrink-0" />
          )}
          <span>{primaryLabel}</span>
        </span>
        {hasAttempt && (
          <span
            title={`Execution Attempt #${attemptNumber}`}
            className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0"
          >
            Att #{attemptNumber}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 select-none shrink-0">
      <span
        title={fullTitle}
        className={cn(
          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
          config.bg,
          config.text,
          className
        )}
      >
        {isStarted ? (
          <i className="running-dot mr-0.5" />
        ) : status === 'pending' ? (
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0 mr-0.5" />
        ) : showIcon && (
          <Icon className="h-3 w-3 text-current" />
        )}
        <span>{primaryLabel}</span>
      </span>

      {/* Option 3: Explicit Attempt Tag OUTSIDE the status pill */}
      {hasAttempt && (
        <span
          title={`Execution Attempt #${attemptNumber}`}
          className="font-mono text-[10.5px] text-muted-foreground/80 bg-muted/40 border border-border/40 px-1.5 py-0.2 rounded font-medium shrink-0"
        >
          Att #{attemptNumber}
        </span>
      )}
    </div>
  );
}