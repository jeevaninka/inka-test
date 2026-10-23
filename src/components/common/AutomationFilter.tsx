"use client";

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getAutomationSourceOptions,
  EXTERNAL_SOURCE_LABEL,
  type AutomationFilterCounts,
} from '@/lib/cases/automation-source';

export type AutomationModeValue = '' | 'manual' | 'auto';
/** A registry source id (`postman`, `datadog`, ...) or `external` / `''`. */
export type AutomationSourceValue = string;

export interface AutomationFilterValue {
  mode: AutomationModeValue;
  source: AutomationSourceValue;
}

interface AutomationFilterProps {
  /** `''` (all) | `manual` | `auto` */
  mode: string;
  /** `''` (all automated) | `postman` | `datadog` | `external` */
  source: string;
  onChange: (next: AutomationFilterValue) => void;
  /** Optional per-bucket counts rendered next to each pill. */
  counts?: Partial<AutomationFilterCounts>;
  /** Label for the "automated, not integrated" bucket. */
  externalLabel?: string;
  className?: string;
  /** Use in tight toolbars (run pickers, dialogs). */
  compact?: boolean;
  /** Render the "automated, not integrated" bucket (default true). */
  showExternal?: boolean;
  /** Hide the mode pills and evaluate as automated; use when the parent owns mode. */
  lockMode?: boolean;
  /** Restrict which modes are available to select. */
  allowedModes?: AutomationModeValue[];
  disabled?: boolean;
}

const MODE_OPTIONS: { value: AutomationModeValue; label: string; countKey: keyof AutomationFilterCounts }[] = [
  { value: '', label: 'All', countKey: 'all' },
  { value: 'manual', label: 'Manual', countKey: 'manual' },
  { value: 'auto', label: 'Automated', countKey: 'auto' },
];

/**
 * One interconnected filter for case execution mode + automation source.
 *
 * Mode is the parent: Postman / Datadog / None are execution subtypes of
 * Automated, so the source pills only exist while Automated is active.
 * Selecting Manual or All always resets the source, which makes conflicting
 * states (e.g. Manual + Postman) impossible.
 */
export function AutomationFilter({
  mode,
  source,
  onChange,
  counts,
  externalLabel = EXTERNAL_SOURCE_LABEL,
  className,
  compact = false,
  showExternal = true,
  lockMode = false,
  allowedModes,
  disabled = false,
}: AutomationFilterProps) {
  const normalizedMode: AutomationModeValue = lockMode
    ? 'auto'
    : mode === 'manual' || mode === 'auto' || mode === 'automated'
      ? mode === 'automated'
        ? 'auto'
        : (mode as AutomationModeValue)
      : '';

  const normalizedSource: AutomationSourceValue =
    normalizedMode === 'auto' && source ? source : '';

  const showSources = normalizedMode === 'auto';

  const sourceOptions: { value: AutomationSourceValue; label: string; countKey: keyof AutomationFilterCounts }[] = [
    { value: '', label: lockMode ? 'All' : 'All Automated', countKey: 'auto' },
    ...getAutomationSourceOptions().map((option) => ({
      value: option.value,
      label: option.label,
      countKey: option.value as keyof AutomationFilterCounts,
    })),
    ...(showExternal
      ? [{ value: 'external' as AutomationSourceValue, label: externalLabel, countKey: 'external' as keyof AutomationFilterCounts }]
      : []),
  ];

  const handleMode = (next: AutomationModeValue) => {
    if (disabled) return;
    if (next === normalizedMode) {
      if (next !== 'auto') onChange({ mode: '', source: '' });
      return;
    }
    onChange({ mode: next, source: next === 'auto' ? normalizedSource : '' });
  };

  const handleSource = (next: AutomationSourceValue) => {
    if (disabled) return;
    // Tapping the active sub-pill returns to "All Automated".
    if (next === normalizedSource && next !== '') {
      onChange({ mode: 'auto', source: '' });
      return;
    }
    onChange({ mode: 'auto', source: next });
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {!lockMode && (
        <div
          role="group"
          aria-label="Mode"
          className={cn(
            'inline-flex w-fit max-w-full items-center gap-0.5 rounded-lg border border-border/50 bg-muted/30 p-0.5',
            disabled && 'opacity-60'
          )}
        >
          {MODE_OPTIONS.filter(o => !allowedModes || allowedModes.includes(o.value)).map((option) => {
            const active = normalizedMode === option.value;
            const count = counts?.[option.countKey];
            return (
              <button
                key={option.value || 'all'}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => handleMode(option.value)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md font-semibold transition-all cursor-pointer disabled:cursor-not-allowed',
                  compact ? 'px-2 py-0.5 text-[10.5px]' : 'px-2.5 py-1 text-[11px]',
                  active
                    ? 'bg-primary/15 text-primary shadow-2xs font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                <span>{option.label}</span>
                {typeof count === 'number' && count > 0 && (
                  <span className={cn('tabular-nums font-mono', active ? 'opacity-70' : 'opacity-50')}>{count}</span>
                )}
                {option.value === 'auto' && (
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 transition-transform duration-150',
                      showSources && 'rotate-180',
                      active ? 'opacity-70' : 'opacity-50'
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {showSources && (
        <div
          role="group"
          aria-label="Integration"
          className="flex flex-wrap items-center gap-1 animate-in fade-in-0 slide-in-from-top-1 duration-150"
        >
          {sourceOptions.map((option) => {
            const active = normalizedSource === option.value;
            const count = counts?.[option.countKey];
            return (
              <button
                key={option.value || 'all-auto'}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => handleSource(option.value)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border font-medium transition-colors cursor-pointer disabled:cursor-not-allowed',
                  compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[10.5px]',
                  active
                    ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                    : 'border-border/40 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                <span>{option.label}</span>
                {typeof count === 'number' && count > 0 && (
                  <span className="tabular-nums font-mono opacity-60">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
