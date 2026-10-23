"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ConnectionStatus = 'connected' | 'not_connected' | 'not_configured' | 'error';
export type InheritanceState = 'inherited' | 'overridden' | null;

export interface IntegrationCardProps {
  icon: React.ReactNode;
  iconBgClass?: string;
  name: string;
  category?: string;
  description: string;
  status: ConnectionStatus;
  /** null/undefined at workspace level — there is nothing to inherit at the root. */
  inheritance?: InheritanceState;
  meta?: string;
  statusSignal?: { text: string; isOk: boolean };
  onAction: () => void;
  disabled?: boolean;
}

/**
 * Compact Integration Card
 * Standardized vocabulary:
 *   not_connected / not_configured -> badge "Not connected", button "Connect"
 *   connected                     -> badge "Connected",     button "Configure"
 */
export function IntegrationCard({
  icon,
  iconBgClass,
  name,
  category,
  description,
  status,
  inheritance = null,
  meta,
  statusSignal,
  onAction,
  disabled = false,
}: IntegrationCardProps) {
  const isConnected = status === 'connected';
  const isError = status === 'error';

  return (
    <div className="rounded-xl border border-border/80 bg-card p-3.5 flex flex-col justify-between hover:border-primary/40 transition-all shadow-card h-full min-h-[146px]">
      <div className="space-y-2.5">
        {/* Top: Icon + Title + Status Badges */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={cn(
                "w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 shadow-2xs",
                iconBgClass || "bg-primary/10 border-primary/20 text-primary"
              )}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <h4 className="font-semibold text-xs sm:text-sm text-foreground truncate">{name}</h4>
              {category && (
                <span className="text-[10px] font-mono text-muted-foreground block truncate">
                  {category}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
            {/* Status Pill Badge - Only show when Connected or Error */}
            {isConnected ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                Connected
              </span>
            ) : isError ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 dark:bg-red-400" />
                Error
              </span>
            ) : null}

            {/* Inheritance Badge */}
            {inheritance === 'inherited' && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25">
                Inherited
              </span>
            )}
            {inheritance === 'overridden' && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25">
                Overridden
              </span>
            )}
          </div>
        </div>

        {/* Middle: Description & Meta */}
        <div>
          <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
            {description}
          </p>

          {(statusSignal || meta) && (
            <div className="mt-1.5 text-[10.5px] font-mono text-muted-foreground flex items-center gap-1.5 truncate">
              {statusSignal ? (
                <>
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full shrink-0',
                      statusSignal.isOk ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-red-500 dark:bg-red-400'
                    )}
                  />
                  <span className="truncate">{statusSignal.text}</span>
                </>
              ) : (
                <span className="truncate">{meta}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Compact Action Button */}
      <div className="pt-2.5 border-t border-border/40 mt-2.5">
        <Button
          onClick={onAction}
          disabled={disabled}
          className={cn(
            "w-full h-8 rounded-lg text-xs font-semibold cursor-pointer transition-all",
            isConnected
              ? "bg-muted/70 hover:bg-muted text-foreground border border-border/70 shadow-2xs"
              : "bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xs"
          )}
        >
          {isConnected ? 'Configure' : 'Connect'}
        </Button>
      </div>
    </div>
  );
}

/** Responsive grid for compact integration boxes */
export function IntegrationCardGrid({
  children,
  columns = 4,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
}) {
  const colClass =
    columns === 2
      ? 'grid grid-cols-1 md:grid-cols-2 gap-3.5'
      : columns === 4
      ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5'
      : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5';

  return <div className={colClass}>{children}</div>;
}

/** Section with header + card grid */
export function IntegrationCardSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
