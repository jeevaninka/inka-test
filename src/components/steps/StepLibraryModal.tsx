'use client';

import { useState, useCallback } from 'react';
import { Search, Link2, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ReusableStep {
  id: string;
  title: string;
  step: string;
  expected_result: string | null;
  data: string | null;
  steps: any[];
  _count?: { test_case_steps: number };
}

interface StepLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steps: ReusableStep[];
  loading?: boolean;
  onSelect: (step: ReusableStep) => void;
}

export function StepLibraryModal({ open, onOpenChange, steps, loading, onSelect }: StepLibraryModalProps) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'single' | 'group'>('all');

  const filtered = steps.filter((s) => {
    const q = search.toLowerCase();
    const groupSteps = Array.isArray(s.steps) && s.steps.length > 0 ? s.steps : null;
    const matchesFilter =
      filterType === 'all'
        ? true
        : filterType === 'single'
        ? !groupSteps
        : !!groupSteps;

    if (!matchesFilter) return false;

    return (
      s.title.toLowerCase().includes(q) ||
      s.step.toLowerCase().includes(q) ||
      (s.data || '').toLowerCase().includes(q) ||
      (s.expected_result || '').toLowerCase().includes(q) ||
      (groupSteps && groupSteps.some((gs: any) =>
        (gs.step || '').toLowerCase().includes(q) ||
        (gs.expectedResult || gs.expected_result || '').toLowerCase().includes(q) ||
        (gs.data || '').toLowerCase().includes(q)
      ))
    );
  });

  const handleSelect = useCallback(
    (step: ReusableStep) => {
      onSelect(step);
      onOpenChange(false);
      setSearch('');
    },
    [onSelect, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col bg-card text-card-foreground border border-border/80 shadow-2xl">
        <DialogHeader className="relative">
          <DialogTitle className="text-base font-semibold">Insert from Step Library</DialogTitle>
          <button 
            onClick={() => onOpenChange(false)} 
            className="absolute right-0 top-0 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none p-1"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </DialogHeader>

        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search reusable steps..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>

          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/40 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={cn(
                "flex-1 py-1 rounded-lg font-medium transition-colors text-center",
                filterType === 'all'
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              All ({steps.length})
            </button>
            <button
              onClick={() => setFilterType('single')}
              className={cn(
                "flex-1 py-1 rounded-lg font-medium transition-colors text-center",
                filterType === 'single'
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Single ({steps.filter((s) => !Array.isArray(s.steps) || s.steps.length === 0).length})
            </button>
            <button
              onClick={() => setFilterType('group')}
              className={cn(
                "flex-1 py-1 rounded-lg font-medium transition-colors text-center",
                filterType === 'group'
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Groups ({steps.filter((s) => Array.isArray(s.steps) && s.steps.length > 0).length})
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 mt-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {steps.length === 0
                ? 'No reusable steps in this project. Create one in Settings → Step Library.'
                : 'No steps match your search.'}
            </p>
          ) : null}
          {filtered.map((step) => {
            const groupSteps = Array.isArray(step.steps) && step.steps.length > 0 ? step.steps : null;
            return (
              <button
                key={step.id}
                onClick={() => handleSelect(step)}
                className="w-full text-left p-3 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-muted/50 transition-all group"
              >
                <div className="flex items-start gap-2">
                  <Link2 className={cn("h-4 w-4 mt-0.5 shrink-0", groupSteps ? 'text-violet-500' : 'text-blue-500')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">{step.title}</span>
                      {groupSteps && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-600 dark:text-violet-400 font-mono">
                          {groupSteps.length} steps
                        </span>
                      )}
                      {step._count && step._count.test_case_steps > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          Used {step._count.test_case_steps}x
                        </span>
                      )}
                    </div>
                    {groupSteps ? (
                      <div className="mt-1 space-y-1">
                        {step.step && step.step !== step.title && (
                          <p className="text-xs text-foreground/80 font-medium">{step.step}</p>
                        )}
                        <div className="space-y-0.5">
                          {groupSteps.slice(0, 3).map((gs: any, i: number) => (
                            <p key={i} className="text-xs text-muted-foreground truncate pl-2 border-l-2 border-violet-500/30">
                              {gs.step || '(empty)'}
                            </p>
                          ))}
                          {groupSteps.length > 3 && (
                            <p className="text-xs text-muted-foreground pl-2">+{groupSteps.length - 3} more</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground truncate mt-0.5">{step.step}</p>
                        {step.expected_result && (
                          <p className="text-xs text-green-600 dark:text-green-400 truncate mt-0.5">
                            Expected: {step.expected_result}
                          </p>
                        )}
                        {step.data && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 truncate mt-0.5">
                            Data: {step.data}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
