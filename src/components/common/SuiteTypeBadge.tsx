"use client";

import { cn } from '@/lib/utils';
import type { SuiteType } from '@/lib/types';

interface SuiteTypeBadgeProps {
  type: SuiteType | string;
  className?: string;
}

export function SuiteTypeBadge({ type, className }: SuiteTypeBadgeProps) {
  return (
    <span
      className={cn(
        'text-xs font-medium capitalize text-muted-foreground',
        className
      )}
    >
      {type || 'custom'}
    </span>
  );
}