"use client";

import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ENVIRONMENT_DETAIL_LABELS,
  type RunEnvironmentDetails,
} from '@/lib/runs/environment';

const TEXT_KEYS = ['platform', 'os', 'browser', 'device'] as const;

interface EnvironmentDetailsFieldsProps {
  value: RunEnvironmentDetails;
  onChange: (next: RunEnvironmentDetails) => void;
  /** Render the "Environment details / Optional" heading above the fields. */
  showHeading?: boolean;
  className?: string;
}

/**
 * Shared editor for the run environment details (C8): platform, OS, browser,
 * device plus arbitrary label/value rows. Blank rows are kept while editing and
 * dropped by `normalizeRunEnvironmentDetails` on save.
 */
export function EnvironmentDetailsFields({
  value,
  onChange,
  showHeading = true,
  className,
}: EnvironmentDetailsFieldsProps) {
  const custom = value.custom || [];

  return (
    <div className={cn('space-y-2', className)}>
      {showHeading && (
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium">Environment details</label>
          <span className="text-[11px] text-muted-foreground">Optional</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {TEXT_KEYS.map((key) => (
          <input
            key={key}
            className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            value={value[key] || ''}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            placeholder={ENVIRONMENT_DETAIL_LABELS[key]}
            aria-label={ENVIRONMENT_DETAIL_LABELS[key]}
          />
        ))}
      </div>

      {custom.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            className="w-1/3 h-9 rounded-md border bg-background px-3 text-sm"
            value={row.label}
            onChange={(e) => {
              const next = [...custom];
              next[idx] = { ...next[idx], label: e.target.value };
              onChange({ ...value, custom: next });
            }}
            placeholder="Label"
            aria-label={`Detail ${idx + 1} label`}
          />
          <input
            className="flex-1 h-9 rounded-md border bg-background px-3 text-sm"
            value={row.value}
            onChange={(e) => {
              const next = [...custom];
              next[idx] = { ...next[idx], value: e.target.value };
              onChange({ ...value, custom: next });
            }}
            placeholder="Value"
            aria-label={`Detail ${idx + 1} value`}
          />
          <button
            type="button"
            className="h-9 w-9 shrink-0 rounded-md border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center cursor-pointer"
            aria-label={`Remove detail ${idx + 1}`}
            onClick={() => onChange({ ...value, custom: custom.filter((_, i) => i !== idx) })}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs gap-1.5 cursor-pointer"
        onClick={() => onChange({ ...value, custom: [...custom, { label: '', value: '' }] })}
      >
        <Plus className="h-3.5 w-3.5" />
        Add detail
      </Button>
    </div>
  );
}
