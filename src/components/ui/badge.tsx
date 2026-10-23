"use client";

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all duration-300',
  {
    variants: {
      variant: {
        default:
          'bg-primary/10 text-primary hover:bg-primary/20',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20',
        outline: 'border border-border/50 text-foreground hover:border-border',
        success:
          'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20',
        warning:
          'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20',
        info:
          'bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };