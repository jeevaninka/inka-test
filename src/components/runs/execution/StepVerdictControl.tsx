"use client";

import React from 'react';
import { Check, X, MoreVertical, Ban, SkipForward, AlertTriangle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import {
  HoverDropdownMenu,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export interface StepVerdictControlProps {
  order: number;
  activeStatus?: string;
  onSelectStatus: (status: string) => void;
  disabled?: boolean;
  totalSteps?: number;
}

export function StepVerdictControl({
  order,
  activeStatus,
  onSelectStatus,
  disabled = false,
  totalSteps = 1,
}: StepVerdictControlProps) {
  const isPass = activeStatus === 'pass';
  const isFail = activeStatus === 'fail';
  const isRare = activeStatus === 'blocked' || activeStatus === 'skip' || activeStatus === 'invalid';
  const hasSelection = Boolean(activeStatus && activeStatus !== 'pending');

  const rareStatuses = [
    { key: 'blocked', label: 'Blocked', icon: Ban, color: 'text-amber-400', activeClass: 'bg-amber-600 text-white border-amber-500' },
    { key: 'skip', label: 'Skip', icon: SkipForward, color: 'text-zinc-300', activeClass: 'bg-zinc-600 text-white border-zinc-500' },
    { key: 'invalid', label: 'Invalid', icon: AlertTriangle, color: 'text-violet-400', activeClass: 'bg-violet-600 text-white border-violet-500' },
  ];

  const currentRare = rareStatuses.find((s) => s.key === activeStatus);

  // When one is selected, disable the others
  const isPassDisabled = disabled || (hasSelection && !isPass);
  const isFailDisabled = disabled || (hasSelection && !isFail);
  const isMoreDisabled = disabled || (hasSelection && !isRare);

  return (
    <div className={cn("inline-flex items-center gap-1 shrink-0", disabled && "opacity-50 pointer-events-none")}>
      {/* 1. Pass Button (1-Click) */}
      <Tooltip
        content={
          disabled
            ? "Step locked"
            : isPass
            ? "Pass (Click to undo)"
            : hasSelection
            ? "Deselect other status first"
            : "Mark Pass"
        }
        side="top"
        align="center"
      >
        <button
          type="button"
          disabled={isPassDisabled}
          onClick={(e) => {
            e.stopPropagation();
            onSelectStatus(isPass ? 'pending' : 'pass');
          }}
          className={cn(
            "h-6.5 min-w-[50px] px-2 rounded-md border flex items-center justify-center gap-1 transition-all select-none text-xs font-semibold",
            isPass
              ? "bg-emerald-600 border-emerald-500 text-white shadow-xs font-bold cursor-pointer"
              : isPassDisabled
              ? "border-white/10 bg-white/[0.02] text-muted-foreground/60 opacity-60 cursor-not-allowed"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 cursor-pointer"
          )}
        >
          <Check className="h-3 w-3 stroke-[2.5]" />
          <span>Pass</span>
        </button>
      </Tooltip>

      {/* 2. Fail Button (1-Click) */}
      <Tooltip
        content={
          disabled
            ? "Step locked"
            : isFail
            ? "Fail (Click to undo)"
            : hasSelection
            ? "Deselect other status first"
            : "Mark Fail"
        }
        side="top"
        align="center"
      >
        <button
          type="button"
          disabled={isFailDisabled}
          onClick={(e) => {
            e.stopPropagation();
            onSelectStatus(isFail ? 'pending' : 'fail');
          }}
          className={cn(
            "h-6.5 min-w-[48px] px-2 rounded-md border flex items-center justify-center gap-1 transition-all select-none text-xs font-semibold",
            isFail
              ? "bg-red-600 border-red-500 text-white shadow-xs font-bold cursor-pointer"
              : isFailDisabled
              ? "border-white/10 bg-white/[0.02] text-muted-foreground/60 opacity-60 cursor-not-allowed"
              : "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/50 cursor-pointer"
          )}
        >
          <X className="h-3 w-3 stroke-[2.5]" />
          <span>Fail</span>
        </button>
      </Tooltip>

      {/* 3. More Outcomes Dropdown (Blocked, Skip, Invalid, Reset) */}
      <HoverDropdownMenu>
        <Tooltip
          content={
            disabled
              ? "Step locked"
              : isRare && currentRare
              ? `${currentRare.label} (Click to change/undo)`
              : hasSelection
              ? "Deselect other status first"
              : "More outcomes"
          }
          side="top"
          align="end"
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={isMoreDisabled}
              className={cn(
                "h-6.5 min-w-[46px] px-1.5 rounded-md border flex items-center justify-center gap-1 transition-[color,background-color,border-color,box-shadow,transform] duration-150 select-none text-xs font-semibold outline-none",
                isRare && currentRare
                  ? cn("font-semibold shadow-xs cursor-pointer", currentRare.activeClass)
                  : isMoreDisabled
                  ? "border-white/10 bg-white/[0.02] text-muted-foreground/60 opacity-60 cursor-not-allowed"
                  : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/10 hover:border-white/20 cursor-pointer"
              )}
            >
              {isRare && currentRare ? (
                <>
                  <currentRare.icon className="h-3 w-3 shrink-0" />
                  <span className="capitalize truncate max-w-[40px]">{currentRare.label}</span>
                </>
              ) : (
                <>
                  <MoreVertical className="h-3 w-3" />
                  <span>More</span>
                </>
              )}
            </button>
          </DropdownMenuTrigger>
        </Tooltip>

        <DropdownMenuContent align="end" side={order >= totalSteps ? 'top' : 'bottom'} className="w-40 p-1">
          {rareStatuses.map(({ key, label, icon: Icon, color }) => {
            const isItemActive = activeStatus === key;
            return (
              <DropdownMenuItem
                key={key}
                onClick={() => onSelectStatus(key)}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                  isItemActive && "bg-white/10 font-semibold"
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", color)} />
                <span>{label}</span>
              </DropdownMenuItem>
            );
          })}

          {activeStatus && activeStatus !== 'pending' && (
            <>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                onClick={() => onSelectStatus('pending')}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <RotateCcw className="h-3 w-3 text-muted-foreground" />
                <span>Reset to Not Run</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </HoverDropdownMenu>
  </div>
);
}
