"use client";

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
  delay?: number;
  interactive?: boolean;
  /** Only show the tooltip if the wrapped content is visibly clipped (scrollWidth > clientWidth). */
  onlyOnOverflow?: boolean;
  /** Extra classes for the trigger wrapper (e.g. `w-full` for block triggers). */
  wrapperClassName?: string;
}

const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
  delay = 150,
  interactive = false,
  onlyOnOverflow = false,
  wrapperClassName,
}: TooltipProps) {
  const [shouldRender, setShouldRender] = React.useState(false);
  const [isActive, setIsActive] = React.useState(false);
  const mounted = React.useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);
  const [coords, setCoords] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [actualSide, setActualSide] = React.useState(side);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const exitTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    };
  }, []);

  const updateCoords = React.useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    let top = 0;
    let left = 0;
    let effectiveSide = side;

    // Boundary flip: if not enough space on top, flip to bottom
    if (side === 'top' && rect.top < 45) {
      effectiveSide = 'bottom';
    } else if (side === 'bottom' && typeof window !== 'undefined' && rect.bottom > window.innerHeight - 45) {
      effectiveSide = 'top';
    }
    setActualSide(effectiveSide);

    if (effectiveSide === 'top') {
      top = rect.top - 6;
      if (align === 'start') left = rect.left;
      else if (align === 'end') left = rect.right;
      else left = rect.left + rect.width / 2;
    } else if (effectiveSide === 'bottom') {
      top = rect.bottom + 6;
      if (align === 'start') left = rect.left;
      else if (align === 'end') left = rect.right;
      else left = rect.left + rect.width / 2;
    } else if (effectiveSide === 'left') {
      left = rect.left - 6;
      if (align === 'start') top = rect.top;
      else if (align === 'end') top = rect.bottom;
      else top = rect.top + rect.height / 2;
    } else if (effectiveSide === 'right') {
      left = rect.right + 6;
      if (align === 'start') top = rect.top;
      else if (align === 'end') top = rect.bottom;
      else top = rect.top + rect.height / 2;
    }

    setCoords({ top, left });
  }, [side, align]);

  const handleMouseEnter = () => {
    if (onlyOnOverflow && triggerRef.current) {
      const target = triggerRef.current.querySelector('.truncate') || triggerRef.current;
      if (target.scrollWidth <= target.clientWidth) {
        return;
      }
    }
    if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    updateCoords();
    timeoutRef.current = setTimeout(() => {
      updateCoords();
      setShouldRender(true);
      requestAnimationFrame(() => {
        setIsActive(true);
      });
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    exitTimeoutRef.current = setTimeout(() => {
      setIsActive(false);
      setTimeout(() => setShouldRender(false), 150);
    }, interactive ? 250 : 150);
  };

  React.useEffect(() => {
    if (!shouldRender) return;
    const handleScroll = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setIsActive(false);
      setShouldRender(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [shouldRender]);

  const getTransformClass = () => {
    if (actualSide === 'top') {
      if (align === 'start') return 'translate-y-[-100%]';
      if (align === 'end') return 'translate-y-[-100%] translate-x-[-100%]';
      return 'translate-y-[-100%] translate-x-[-50%]';
    }
    if (actualSide === 'bottom') {
      if (align === 'start') return '';
      if (align === 'end') return 'translate-x-[-100%]';
      return 'translate-x-[-50%]';
    }
    if (actualSide === 'left') {
      if (align === 'start') return 'translate-x-[-100%]';
      if (align === 'end') return 'translate-x-[-100%] translate-y-[-100%]';
      return 'translate-x-[-100%] translate-y-[-50%]';
    }
    if (actualSide === 'right') {
      if (align === 'start') return '';
      if (align === 'end') return 'translate-y-[-100%]';
      return 'translate-y-[-50%]';
    }
    return '';
  };

  return (
    <div
      ref={triggerRef}
      className={cn('relative inline-flex items-center cursor-pointer', wrapperClassName)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}
      {mounted && shouldRender && content && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
          }}
          onMouseEnter={() => {
            if (interactive && exitTimeoutRef.current) {
              clearTimeout(exitTimeoutRef.current);
              setIsActive(true);
            }
          }}
          onMouseLeave={() => {
            if (interactive) {
              handleMouseLeave();
            }
          }}
          className={cn(
            'z-[99999] px-2.5 py-1 text-[11px] font-medium leading-snug text-popover-foreground bg-popover/80 border border-border/60 shadow-[0_10px_32px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/5 rounded-lg backdrop-blur-xl',
            interactive ? 'pointer-events-auto select-auto max-w-xs' : 'pointer-events-none select-none max-w-none whitespace-nowrap',
            'transition-all duration-150 ease-out',
            isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
            getTransformClass(),
            className
          )}
        >
          {content}
        </div>,
        document.body
      )}
    </div>
  );
}
