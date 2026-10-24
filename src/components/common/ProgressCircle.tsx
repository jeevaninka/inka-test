"use client";

import React, { useState, useEffect, useId } from 'react';
import { cn } from '@/lib/utils';

export interface ProgressSegments {
  pass?: number;
  fail?: number;
  blocked?: number;
  invalid?: number;
  error?: number;
  /** Provider result never arrived before the monitoring-expiry policy. */
  unavailable?: number;
  skip?: number;
  total?: number;
}

export interface ProgressCircleProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  segments?: ProgressSegments;
  size?: number;
  strokeWidth?: number;
  animate?: boolean;
  showDot?: boolean;
  label?: React.ReactNode;
  subtitle?: React.ReactNode;
  showPercentage?: boolean;
  variant?: 'brand' | 'emerald' | 'rose' | 'amber';
  /** Render actual SVG segments instead of a blended gradient. */
  segmented?: boolean;
  /** Content to display in the center (overrides percentage). */
  centerContent?: React.ReactNode;
}

export function ProgressCircle({
  value = 0,
  segments,
  size = 64,
  strokeWidth = 6,
  animate = true,
  showDot = false,
  label,
  subtitle,
  showPercentage = false,
  variant = 'brand',
  segmented = false,
  centerContent,
  className,
  ...props
}: ProgressCircleProps) {
  const segCompleted = segments
    ? (segments.pass || 0) + (segments.fail || 0) + (segments.blocked || 0) + (segments.invalid || 0) + (segments.error || 0) + (segments.unavailable || 0) + (segments.skip || 0)
    : 0;
  const effectiveValue = segments
    ? (segments.total && segments.total > 0 ? Math.round((segCompleted / segments.total) * 100) : 0)
    : value;

  const clampedValue = Math.min(100, Math.max(0, effectiveValue));
  const [currentValue, setCurrentValue] = useState(animate ? 0 : clampedValue);

  useEffect(() => {
    if (!animate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentValue(clampedValue);
      return;
    }
    const timer = setTimeout(() => {
      setCurrentValue(clampedValue);
    }, 40);
    return () => clearTimeout(timer);
  }, [clampedValue, animate]);

  const radius = (size - strokeWidth) / 2;

  // Compute tip dot coordinates along the arc (circle starts from top -90deg)
  const angleDeg = (currentValue / 100) * 360 - 90;
  const angleRad = (angleDeg * Math.PI) / 180;
  const center = size / 2;
  const dotX = center + radius * Math.cos(angleRad);
  const dotY = center + radius * Math.sin(angleRad);

  const gradientId = useId();

  const getGradientStops = () => {
    // If multi-verdict segments are provided, generate a smooth blended transition between verdicts
    if (segments && segCompleted > 0) {
      const activeCategories: { color: string; count: number }[] = [];
      if (segments.pass && segments.pass > 0) activeCategories.push({ color: '#10b981', count: segments.pass });
      if (segments.fail && segments.fail > 0) activeCategories.push({ color: '#f43f5e', count: segments.fail });
      if (segments.blocked && segments.blocked > 0) activeCategories.push({ color: '#f59e0b', count: segments.blocked });
      if (segments.invalid && segments.invalid > 0) activeCategories.push({ color: '#8b5cf6', count: segments.invalid });
      if (segments.error && segments.error > 0) activeCategories.push({ color: '#a78bfa', count: segments.error });
      if (segments.unavailable && segments.unavailable > 0) activeCategories.push({ color: '#f97316', count: segments.unavailable });
      if (segments.skip && segments.skip > 0) activeCategories.push({ color: '#94a3b8', count: segments.skip });

      if (activeCategories.length === 1) {
        const c = activeCategories[0].color;
        const tint =
          c === '#10b981' ? '#34d399' :
          c === '#f43f5e' ? '#fb7185' :
          c === '#f59e0b' ? '#fbbf24' :
          c === '#8b5cf6' ? '#a78bfa' :
          c === '#f97316' ? '#fb923c' : '#cbd5e1';
        return (
          <>
            <stop offset="0%" stopColor={c} />
            <stop offset="100%" stopColor={tint} />
          </>
        );
      }

      if (activeCategories.length > 1) {
        let accumulated = 0;
        return (
          <>
            {activeCategories.map((cat, idx) => {
              const fraction = cat.count / segCompleted;
              const startPct = Math.round(accumulated * 100);
              accumulated += fraction;
              const endPct = Math.round(accumulated * 100);
              return (
                <React.Fragment key={idx}>
                  <stop offset={`${startPct}%`} stopColor={cat.color} />
                  <stop offset={`${endPct}%`} stopColor={cat.color} />
                </React.Fragment>
              );
            })}
          </>
        );
      }
    }

    if (variant === 'emerald' || clampedValue === 100) {
      return (
        <>
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#5fd0b8" />
        </>
      );
    }
    if (variant === 'rose') {
      return (
        <>
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="100%" stopColor="#fb7185" />
        </>
      );
    }
    if (variant === 'amber') {
      return (
        <>
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#fbbf24" />
        </>
      );
    }
    // Default signature brand gradient (matching login vignette & homepage)
    return (
      <>
        <stop offset="0%" stopColor="#5fd0b8" />
        <stop offset="100%" stopColor="#4aa8ff" />
      </>
    );
  };

  const getDotColor = () => {
    if (variant === 'emerald' || clampedValue === 100) return '#10b981';
    if (variant === 'rose') return '#f43f5e';
    if (variant === 'amber') return '#f59e0b';
    return '#4aa8ff';
  };

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)} {...props}>
      <div className="relative shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
        <svg
          className="transform -rotate-90 overflow-visible"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              {getGradientStops()}
            </linearGradient>
          </defs>

          {/* Theme-Adaptive Background Track */}
          {(segments?.total === undefined || segCompleted < segments.total) && (
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="currentColor"
              className="text-muted/40 dark:text-white/[0.08]"
              strokeWidth={strokeWidth}
              pathLength="100"
              strokeDasharray={
                segments?.total && segCompleted > 0
                  ? `${((segments.total - segCompleted) / segments.total) * 100} 100`
                  : '100 100'
              }
              strokeDashoffset={
                segments?.total && segCompleted > 0
                  ? `-${(segCompleted / segments.total) * 100}`
                  : '0'
              }
            />
          )}

          {segmented && segments && segCompleted > 0 ? (() => {
            const activeCategories: { color: string; count: number }[] = [];
            if (segments.pass && segments.pass > 0) activeCategories.push({ color: '#10b981', count: segments.pass });
            if (segments.fail && segments.fail > 0) activeCategories.push({ color: '#f43f5e', count: segments.fail });
            if (segments.blocked && segments.blocked > 0) activeCategories.push({ color: '#f59e0b', count: segments.blocked });
            if (segments.invalid && segments.invalid > 0) activeCategories.push({ color: '#8b5cf6', count: segments.invalid });
            if (segments.error && segments.error > 0) activeCategories.push({ color: '#a78bfa', count: segments.error });
            if (segments.unavailable && segments.unavailable > 0) activeCategories.push({ color: '#f97316', count: segments.unavailable });
            if (segments.skip && segments.skip > 0) activeCategories.push({ color: '#94a3b8', count: segments.skip });

            let accumulated = 0;

            const scale = clampedValue > 0 ? currentValue / clampedValue : 0;
            return activeCategories.map((cat, idx) => {
              const fraction = cat.count / segments!.total!;
              const length = fraction * 100 * scale;
              const displayLength = length;
              
              const dashOffset = -accumulated * scale;
              accumulated += fraction * 100;

              return (
                <circle
                  key={idx}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={cat.color}
                  strokeWidth={strokeWidth}
                  pathLength="100"
                  strokeDasharray={`${displayLength} 100`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="butt"
                  style={{
                    transition: animate ? 'stroke-dasharray 1.2s cubic-bezier(0.16, 1, 0.3, 1), stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
                  }}
                />
              );
            });
          })() : (
            /* Animated Gradient Fill */
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={strokeWidth}
              pathLength="100"
              strokeDasharray="100 100"
              strokeDashoffset={100 - currentValue}
              strokeLinecap="round"
              style={{
                transition: animate ? 'stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
              }}
            />
          )}

          {/* Glowing Head Dot (Matching InkaTest Vignette Design) */}
          {showDot && currentValue > 0 && currentValue < 100 && (
            <circle
              cx={dotX}
              cy={dotY}
              r={Math.max(1.6, strokeWidth * 0.75)}
              fill={getDotColor()}
              className="animate-pulse"
              style={{
                filter: `drop-shadow(0 0 4px ${getDotColor()})`,
              }}
            />
          )}
        </svg>

        {centerContent ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center font-bold text-foreground">
            {centerContent}
          </div>
        ) : showPercentage && size >= 40 ? (
          <span className="absolute inset-0 flex items-center justify-center font-mono font-bold text-xs text-foreground">
            {clampedValue}%
          </span>
        ) : null}
      </div>

      {(label || subtitle) && (
        <div className="flex flex-col min-w-0">
          {label && (
            <span className="font-bold text-foreground text-sm tracking-tight leading-snug truncate">
              {label}
            </span>
          )}
          {subtitle && (
            <span className="text-xs text-muted-foreground truncate leading-snug">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
