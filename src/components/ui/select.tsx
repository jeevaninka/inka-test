"use client";

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'defaultValue'> {
  options: { value: string; label: string }[];
  value?: string | number;
  defaultValue?: string | number;
  placeholder?: string;
  onValueChange?: (value: string) => void;
  onChange?: (e: { target: { value: string } } & any) => void;
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ className, options = [], value, defaultValue, placeholder, onValueChange, onChange, disabled, ...props }, ref) => {
    const [open, setOpen] = React.useState(false);
    const [internalValue, setInternalValue] = React.useState<string>(
      defaultValue !== undefined ? String(defaultValue) : ''
    );

    const isControlled = value !== undefined;
    const currentValue = isControlled ? String(value) : internalValue;

    const selectedOption =
      options.find((opt) => String(opt.value) === currentValue) ||
      ( !placeholder && options.length > 0 && currentValue === '' ? options[0] : undefined );

    const displayLabel = selectedOption
      ? selectedOption.label
      : placeholder || (options[0]?.label ?? 'Select...');

    const handleSelect = (val: string) => {
      if (!isControlled) {
        setInternalValue(val);
      }
      if (onValueChange) {
        onValueChange(val);
      }
      if (onChange) {
        onChange({ target: { value: val } });
      }
      setOpen(false);
    };

    return (
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            ref={ref}
            disabled={disabled}
            className={cn(
              'flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background/80 text-foreground px-3 py-0 text-xs font-medium shadow-xs ring-offset-background transition-colors hover:bg-primary/10 hover:text-primary hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-ring focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer text-left',
              className
            )}
            {...props}
          >
            <span className={cn('truncate', !selectedOption && placeholder && 'text-muted-foreground')}>
              {displayLabel}
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
                open && 'rotate-180'
              )}
            />
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            onWheel={(e) => e.stopPropagation()}
            style={{ minWidth: 'var(--radix-popover-trigger-width)' }}
            className={cn(
              'z-[100] max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-2xl outline-none',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]'
            )}
          >
            {options.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-muted-foreground italic">No options</div>
            ) : (
              options.map((option) => {
                const isSelected = selectedOption
                  ? String(option.value) === String(selectedOption.value)
                  : String(option.value) === currentValue;
                return (
                  <button
                    key={`${option.value}-${option.label}`}
                    type="button"
                    onClick={() => handleSelect(String(option.value))}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer select-none',
                      isSelected
                        ? 'bg-primary/15 text-primary font-semibold'
                        : 'text-popover-foreground hover:bg-muted/70'
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                );
              })
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  }
);
Select.displayName = 'Select';

export { Select };