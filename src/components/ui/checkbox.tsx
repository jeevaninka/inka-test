"use client";

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Check, Minus } from 'lucide-react';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onClick'> {
  checked?: boolean;
  /** Renders the mixed state (e.g. a group where only some rows are selected). */
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, indeterminate = false, onCheckedChange, onClick, ...props }, ref) => {
    const { 'aria-label': ariaLabel, ...rest } = props as React.InputHTMLAttributes<HTMLInputElement>;
    return (
      <button
        type="button"
        role="checkbox"
        aria-label={ariaLabel}
        aria-checked={indeterminate ? 'mixed' : checked}
        className={cn(
          'peer h-[18px] w-[18px] shrink-0 rounded-[5px] border transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 active:scale-90 flex items-center justify-center cursor-pointer',
          checked || indeterminate
            ? 'border-primary bg-primary text-primary-foreground shadow-sm'
            : 'border-primary/50 bg-background hover:border-primary hover:bg-primary/[0.05] hover:shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]',
          className
        )}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) onCheckedChange?.(indeterminate ? true : !checked);
        }}
      >
        {indeterminate ? (
          <Minus className="h-3 w-3 stroke-[3] animate-in zoom-in-75 duration-150 ease-out" />
        ) : (
          checked && <Check className="h-3 w-3 stroke-[3] animate-in zoom-in-75 duration-150 ease-out" />
        )}
        <input
          type="checkbox"
          ref={ref}
          className="sr-only"
          checked={checked}
          onChange={() => onCheckedChange?.(!checked)}
          {...rest}
        />
      </button>
    );
  }
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };