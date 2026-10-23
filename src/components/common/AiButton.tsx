"use client";

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

interface AiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  loading?: boolean;
  variant?: 'default' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function AiButton({
  children,
  loading,
  variant = 'default',
  size = 'default',
  className,
  disabled,
  ...props
}: AiButtonProps) {
  const baseClasses =
    variant === 'ghost'
      ? 'bg-transparent text-violet-600 border border-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-500 dark:hover:bg-violet-950'
      : variant === 'destructive'
        ? 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800'
        : 'bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-700';

  return (
    <Button
      size={size}
      className={cn(
        'gap-2 font-medium',
        baseClasses,
        loading && 'ai-button-loading',
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
      {children}
    </Button>
  );
}