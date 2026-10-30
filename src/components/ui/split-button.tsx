"use client";

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SplitButtonItem {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export interface SplitButtonProps {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  items: SplitButtonItem[];
  className?: string;
  size?: 'sm' | 'default';
  align?: 'left' | 'right';
  menuPlacement?: 'bottom' | 'top';
  variant?: 'primary' | 'primary-gradient';
}

export function SplitButton({
  label,
  icon,
  onClick,
  disabled = false,
  title,
  items,
  className,
  size = 'sm',
  menuPlacement = 'bottom',
  variant = 'primary',
}: SplitButtonProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const leaveTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  // Close on Escape
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const heightClass = size === 'sm' ? 'h-8 text-xs' : 'h-10 text-sm';
  const isGradient = variant === 'primary-gradient';
  const gradientClasses = isGradient
    ? 'inline-flex items-center overflow-hidden gradient-btn text-white h-9 rounded-xl shadow-lg shadow-black/15 dark:shadow-black/50 hover:shadow-black/25 dark:hover:shadow-black/60 transition-all duration-150'
    : 'inline-flex items-center overflow-hidden bg-primary rounded-xl shadow-lg shadow-black/15 dark:shadow-black/50 hover:shadow-black/25 dark:hover:shadow-black/60 transition-all duration-150';
  // The chevron must not repaint the gradient: it sits on the parent's
  // gradient surface so the split button reads as one continuous control.
  const chevronClasses = isGradient
    ? 'bg-transparent hover:bg-black/10 text-white transition-colors cursor-pointer pl-1 pr-2.5'
    : 'bg-primary hover:bg-primary/90 text-primary-foreground transition-colors cursor-pointer pl-1 pr-2.5';
  const itemHoverClasses = 'hover:bg-primary/10 hover:text-primary';

  const hasValidItems = items && items.length > 0;
  const allItemsDisabled = hasValidItems && items.every((i) => i.disabled);
  const chevronDisabled = disabled && allItemsDisabled;

  const handleMouseEnter = () => {
    if (chevronDisabled || !hasValidItems) return;
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 200);
  };

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn('relative inline-flex flex-col shadow-xs z-30', className)}
    >
      {/* Top Split Button Row */}
      <div className={gradientClasses}>
        {/* Primary Action Button */}
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          title={title}
          className={cn(
            'inline-flex items-center justify-start font-sans font-semibold text-xs tracking-normal leading-none overflow-hidden transition-colors cursor-pointer select-none',
            heightClass,
            hasValidItems ? 'pl-3.5 pr-1.5' : 'px-3.5',
            disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
          )}
        >
          {icon && (
            <span className="w-3.5 h-3.5 flex items-center justify-center mr-1.5 shrink-0">
              {isGradient ? <>{icon}</> : <span className="text-primary-foreground">{icon}</span>}
            </span>
          )}
          <span className="font-sans font-semibold text-xs tracking-normal leading-none">{label}</span>
        </button>

        {/* Dropdown Chevron Trigger — Seamless, no dividing border */}
        {hasValidItems && (
          <button
            type="button"
            onClick={() => !chevronDisabled && setIsOpen(!isOpen)}
            disabled={chevronDisabled}
            aria-expanded={isOpen}
            className={cn(
              chevronClasses,
              heightClass,
              chevronDisabled && 'opacity-50 cursor-not-allowed pointer-events-none'
            )}
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', isOpen && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* Standalone Dialed-In Floating Dropdown Panel */}
      {isOpen && (
        <div
          className={cn(
            'absolute right-0 min-w-[205px] z-50 bg-popover/95 dark:bg-[#0a1217]/95 backdrop-blur-xl border border-teal-700/20 dark:border-teal-400/25 rounded-xl shadow-xl shadow-black/15 dark:shadow-black/50 p-1 flex flex-col gap-0.5 animate-in fade-in-0 zoom-in-95 duration-100',
            menuPlacement === 'top' ? 'bottom-full mb-[6px]' : 'top-full mt-[6px]'
          )}
        >
          {items.map((item, idx) => (
            <button
              key={idx}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                setIsOpen(false);
                item.onClick();
              }}
              className={cn(
                'w-full inline-flex items-center justify-start px-2.5 py-2 font-medium text-xs text-foreground transition-colors cursor-pointer select-none whitespace-nowrap rounded-lg group',
                itemHoverClasses,
                item.disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
              )}
            >
              {item.icon && <span className="w-3.5 h-3.5 flex items-center justify-center mr-2 shrink-0 text-muted-foreground group-hover:text-primary transition-colors">{item.icon}</span>}
              <span className="font-sans font-medium text-xs tracking-normal leading-none">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
