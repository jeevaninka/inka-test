"use client";

import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

interface AiBadgeProps {
  className?: string;
  iconOnly?: boolean;
}

export function AiBadge({ className, iconOnly = false }: AiBadgeProps) {
  if (iconOnly) {
    return (
      <span
        title="AI Generated"
        className={cn(
          'inline-flex items-center justify-center text-violet-400/90 hover:text-violet-300 cursor-pointer shrink-0',
          className
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-400',
        className
      )}
    >
      <Sparkles className="h-3 w-3" />
      AI
    </span>
  );
}