"use client";

import { cn } from '@/lib/utils';
import type { Priority } from '@/lib/types';
import { ChevronsUp, ChevronUp, ChevronDown, Equal } from 'lucide-react';

interface PriorityBadgeProps {
  priority: Priority;
  className?: string;
  showIcon?: boolean;
}

/**
 * Priority is shown as a coloured icon plus a plain `P0…P3` label in the
 * normal theme text colour. No pill, no background box — the colour lives on
 * the icon only, so the label stays legible in every theme and matches the
 * surrounding table text.
 */
const priorityStyles: Record<Priority, { text: string; bg: string; icon: string }> = {
  P0: { text: 'text-red-600 dark:text-red-400 font-bold', bg: 'bg-red-500/10 border-red-500/25', icon: 'text-red-500 dark:text-red-400' },
  P1: { text: 'text-amber-600 dark:text-amber-400 font-bold', bg: 'bg-amber-500/10 border-amber-500/25', icon: 'text-amber-500 dark:text-amber-400' },
  P2: { text: 'text-blue-600 dark:text-blue-400 font-bold', bg: 'bg-blue-500/10 border-blue-500/25', icon: 'text-blue-500 dark:text-blue-400' },
  P3: { text: 'text-zinc-500 dark:text-zinc-400 font-semibold', bg: 'bg-zinc-500/10 border-zinc-500/25', icon: 'text-zinc-400' },
};

export function PriorityBadge({ priority, className, showIcon = true }: PriorityBadgeProps) {
  const normPriority = (['P0', 'P1', 'P2', 'P3'].includes(String(priority || '').toUpperCase())
    ? String(priority).toUpperCase()
    : 'P2') as Priority;

  const style = priorityStyles[normPriority] || priorityStyles.P2;

  const renderIcon = () => {
    switch (normPriority) {
      case 'P0':
        return <ChevronsUp className={cn(style.icon, 'h-3 w-3 stroke-[2.2] shrink-0')} />;
      case 'P1':
        return <ChevronUp className={cn(style.icon, 'h-3 w-3 stroke-[2.2] shrink-0')} />;
      case 'P2':
        return <Equal className={cn(style.icon, 'h-3 w-3 stroke-[2.2] shrink-0')} />;
      case 'P3':
        return <ChevronDown className={cn(style.icon, 'h-3 w-3 stroke-[2.2] shrink-0')} />;
      default:
        return null;
    }
  };

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-mono border leading-none shrink-0 select-none',
        style.bg,
        style.text,
        className
      )}
    >
      {showIcon && renderIcon()}
      <span>{normPriority}</span>
    </span>
  );
}
