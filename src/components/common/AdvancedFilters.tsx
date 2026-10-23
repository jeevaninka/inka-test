"use client";

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterField {
  id: string;
  label: string;
  type: 'select' | 'text' | 'date' | 'date-range' | 'custom';
  options?: { label: string; value: string }[];
  value?: string | [string, string];
  onChange?: (value: any) => void;
  /** Control rendered for `type: 'custom'`. */
  custom?: ReactNode;
  /** Hide the field label (useful when the custom control is self-labelled). */
  hideLabel?: boolean;
}

interface AdvancedFiltersProps {
  fields: FilterField[];
  onClear: () => void;
  activeCount: number;
}

export function AdvancedFilters({ fields, onClear, activeCount }: AdvancedFiltersProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" className="relative" onClick={() => setOpen(!open)}>
        <Filter className="h-3.5 w-3.5 mr-1.5" />
        Filters
        {activeCount > 0 && (
          <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {activeCount}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 max-h-[60vh] overflow-y-auto rounded-lg border bg-popover p-4 shadow-lg space-y-3">
          {fields.map((f) => (
            <div key={f.id} className="space-y-1.5">
              {!f.hideLabel && (
                <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
              )}
              {f.type === 'custom' && f.custom}
              {f.type === 'select' && (
                <select
                  className="w-full h-8 rounded-md border bg-background px-2 text-sm"
                  value={f.value as string}
                  onChange={(e) => f.onChange?.(e.target.value || undefined)}
                >
                  <option value="">Any</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
              {f.type === 'text' && (
                <Input
                  placeholder={`Filter by ${f.label.toLowerCase()}...`}
                  value={f.value as string}
                  onChange={(e) => f.onChange?.(e.target.value || undefined)}
                  className="h-8 text-sm"
                />
              )}
              {f.type === 'date' && (
                <Input
                  type="date"
                  value={f.value as string}
                  onChange={(e) => f.onChange?.(e.target.value || undefined)}
                  className="h-8 text-sm"
                />
              )}
              {f.type === 'date-range' && (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={(f.value as [string, string])[0] || ''}
                    onChange={(e) => f.onChange?.([e.target.value, (f.value as [string, string])[1]])}
                    className="h-8 text-sm flex-1"
                    placeholder="From"
                  />
                  <span className="text-xs text-muted-foreground">—</span>
                  <Input
                    type="date"
                    value={(f.value as [string, string])[1] || ''}
                    onChange={(e) => f.onChange?.([(f.value as [string, string])[0], e.target.value])}
                    className="h-8 text-sm flex-1"
                    placeholder="To"
                  />
                </div>
              )}
            </div>
          ))}
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={onClear}>
              <X className="h-3 w-3 mr-1" /> Clear all filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
