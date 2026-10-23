'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Check, X, SkipForward, AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseDatadogStepMeta, type DatadogStepMeta } from '@/lib/integrations/datadog-steps';

export interface DatadogTableStep {
  id?: string;
  order: number;
  step: string;
  expectedResult?: string | null;
  expected_result?: string | null;
  meta?: string | null;
}

export interface UnmatchedProviderResult {
  stepId?: string;
  name: string;
  status?: 'pass' | 'fail' | 'skip' | string;
  failureMessage?: string;
}

/** Render `{{ VAR }}` as a chip with the braces stripped; everything else as text. */
export function VariableChipsText({ text, className }: { text?: string | null; className?: string }) {
  const parts = useMemo(() => {
    const source = String(text || '');
    if (!source) return [] as Array<{ type: 'text' | 'var'; value: string }>;
    const out: Array<{ type: 'text' | 'var'; value: string }> = [];
    const regex = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      if (match.index > last) out.push({ type: 'text', value: source.slice(last, match.index) });
      out.push({ type: 'var', value: match[1] });
      last = regex.lastIndex;
    }
    if (last < source.length) out.push({ type: 'text', value: source.slice(last) });
    return out;
  }, [text]);

  return (
    <span className={cn('break-words', className)}>
      {parts.map((part, index) =>
        part.type === 'var' ? (
          <span
            key={index}
            className="inline-flex items-center mx-0.5 px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-mono text-[11px] font-semibold align-baseline"
            title={`Datadog variable ${part.value}`}
          >
            {part.value}
          </span>
        ) : (
          <React.Fragment key={index}>{part.value}</React.Fragment>
        )
      )}
    </span>
  );
}

const BADGE_STYLES: Record<string, string> = {
  Optional: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  'Non-critical': 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/25',
  'Always runs': 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25',
  'Ends test if passed': 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25',
};

export function DatadogStepBadges({ badges }: { badges?: string[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badges.map((badge) => (
        <span
          key={badge}
          className={cn(
            'text-[9.5px] px-1.5 py-0.5 rounded border font-medium leading-none',
            BADGE_STYLES[badge] || 'bg-muted text-muted-foreground border-border/60'
          )}
        >
          {badge}
        </span>
      ))}
    </span>
  );
}

export function parseStepMeta(step: DatadogTableStep): DatadogStepMeta | null {
  return parseDatadogStepMeta(step.meta);
}

export function stepExpected(step: DatadogTableStep): string {
  return String(step.expectedResult ?? step.expected_result ?? '').trim();
}

export function DatadogStatusIcon({ status }: { status?: string }) {
  if (!status) return <span className="text-muted-foreground/50 text-[11px]">—</span>;
  if (status === 'pass') return <Check className="h-3.5 w-3.5 text-emerald-500" aria-label="Passed" />;
  if (status === 'fail') return <X className="h-3.5 w-3.5 text-red-500" aria-label="Failed" />;
  return <SkipForward className="h-3.5 w-3.5 text-muted-foreground" aria-label="Skipped" />;
}

interface DatadogStepsTableProps {
  steps: DatadogTableStep[];
  /** Show the Status column (case/run contexts). */
  showStatus?: boolean;
  statusForStep?: (step: DatadogTableStep, meta: DatadogStepMeta | null) => string | undefined;
  /** Collapse subtest groups on first render (import preview default: true). */
  collapsedByDefault?: boolean;
  className?: string;
  emptyLabel?: string;
}

export function DatadogStepsTable({
  steps,
  showStatus = false,
  statusForStep,
  collapsedByDefault = false,
  className,
  emptyLabel = 'No Datadog steps.',
}: DatadogStepsTableProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    if (!collapsedByDefault) return {};
    const initial: Record<string, boolean> = {};
    for (const step of steps) {
      const group = parseStepMeta(step)?.subtestGroup;
      if (group) initial[group] = true;
    }
    return initial;
  });

  if (!steps || steps.length === 0) {
    return <div className="px-3 py-3 text-xs text-muted-foreground italic">{emptyLabel}</div>;
  }

  const columns = showStatus
    ? 'grid-cols-[44px_minmax(0,1.25fr)_minmax(0,1fr)_54px]'
    : 'grid-cols-[44px_minmax(0,1.25fr)_minmax(0,1fr)]';

  let lastGroup: string | undefined;

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border/50', className)}>
      <div
        className={cn(
          'grid items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground',
          columns
        )}
      >
        <div>#</div>
        <div>Action</div>
        <div>Expected Result</div>
        {showStatus && <div className="text-center">Status</div>}
      </div>

      {steps.map((step) => {
        const meta = parseStepMeta(step);
        const group = meta?.subtestGroup;
        const startsGroup = Boolean(group) && group !== lastGroup;
        lastGroup = group;
        const isCollapsed = Boolean(group && collapsed[group]);
        const expected = stepExpected(step);
        const status = statusForStep?.(step, meta);

        return (
          <React.Fragment key={`${step.id || step.order}-${step.order}`}>
            {startsGroup && group && (
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }))}
                className="w-full flex items-center gap-2 px-3 py-2 bg-primary/[0.04] border-y border-border/40 text-left hover:bg-primary/[0.07] transition-colors cursor-pointer"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-xs font-semibold text-foreground truncate">{group}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono shrink-0">
                  subtest
                </span>
              </button>
            )}

            {!isCollapsed && (
              <div
                className={cn(
                  'grid items-start gap-2 px-3 py-2 border-b border-border/25 last:border-b-0 text-xs',
                  columns,
                  group && 'bg-muted/[0.03]'
                )}
              >
                <div className={cn('font-mono text-[11px] text-muted-foreground pt-0.5', group && 'pl-3')}>
                  {step.order}
                </div>
                <div className="min-w-0 space-y-1">
                  <VariableChipsText text={step.step} className="text-[12.5px] leading-5 text-foreground" />
                  {meta?.badges && meta.badges.length > 0 && <DatadogStepBadges badges={meta.badges} />}
                </div>
                <div className="min-w-0 pt-0.5">
                  {expected ? (
                    <VariableChipsText text={expected} className="text-[12px] leading-5 text-muted-foreground" />
                  ) : (
                    <span className="text-[11px] italic text-muted-foreground/50">Completes without error</span>
                  )}
                </div>
                {showStatus && (
                  <div className="flex items-center justify-center pt-0.5">
                    <DatadogStatusIcon status={status} />
                  </div>
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function UnmatchedProviderResults({
  results,
  onResync,
  resyncing,
}: {
  results: UnmatchedProviderResult[];
  onResync?: () => void;
  resyncing?: boolean;
}) {
  if (!results || results.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Unmatched results ({results.length})
        </span>
        {onResync && (
          <button
            type="button"
            onClick={onResync}
            disabled={resyncing}
            className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={cn('h-3 w-3', resyncing && 'animate-spin')} />
            Re-sync steps
          </button>
        )}
      </div>
      <p className="text-[10.5px] text-muted-foreground leading-snug">
        These Datadog results have no matching imported step. The test may have changed after import — re-sync
        the case to refresh its steps. Results are not guessed by name or position.
      </p>
      <div className="space-y-1">
        {results.map((result, index) => (
          <div key={`${result.stepId || result.name}-${index}`} className="flex items-start gap-1.5 text-[11px]">
            <DatadogStatusIcon status={result.status} />
            <span className="min-w-0 break-words">
              {result.name}
              {result.stepId ? (
                <span className="ml-1 font-mono text-[10px] text-muted-foreground/70">{result.stepId}</span>
              ) : null}
              {result.failureMessage ? ` — ${result.failureMessage}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
