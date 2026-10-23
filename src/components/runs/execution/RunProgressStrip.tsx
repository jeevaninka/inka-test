"use client";

import React from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface RunProgressStripProps {
  results: any[];
  getCase: (id: string) => any;
  activeResultId: string;
  onSelectResult: (id: string) => void;
}

export function RunProgressStrip({
  results,
  getCase,
  activeResultId,
  onSelectResult,
}: RunProgressStripProps) {
  const statusColors: Record<string, string> = {
    pass: 'bg-green-500',
    fail: 'bg-red-500',
    blocked: 'bg-orange-500',
    skip: 'bg-zinc-400',
    invalid: 'bg-purple-500',
    pending: 'bg-muted-foreground/30',
  };

  return (
    <div className="w-full flex items-center gap-0.5 h-3 bg-muted/40 p-0.5 rounded-full border border-border/50 overflow-hidden">
      {results.map((r, idx) => {
        const c = getCase(r.testCaseId);
        const isActive = r.id === activeResultId;
        const color = statusColors[r.status?.toLowerCase() || 'pending'];

        return (
          <Tooltip
            key={r.id}
            content={`${idx + 1}. ${c?.displayId || ''}: ${c?.title || 'Case'} (${r.status || 'Not Run'})`}
          >
            <button
              onClick={() => onSelectResult(r.id)}
              className={cn(
                "h-full flex-1 rounded-sm transition-all hover:scale-y-125 focus:outline-none",
                color,
                isActive ? "ring-2 ring-primary ring-offset-1 z-10" : "opacity-80 hover:opacity-100"
              )}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}
