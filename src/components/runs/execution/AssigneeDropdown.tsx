"use client";

import React, { useMemo } from 'react';
import { Check, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatar, formatUserDisplayName } from '@/components/common/UserAvatar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export interface AssigneeDropdownProps {
  resultId: string;
  assignedTo: number | null;
  /** Server-resolved assignee name — works even if they left the project. */
  assignedToName?: string | null;
  /** Server-resolved assignee avatar URL. */
  assignedToAvatar?: string | null;
  iterationResults?: any[];
  runStatus: string;
  members: any[];
  currentUserId?: number | string | null;
  onAssign: (resultId: string, assigneeId: number | null) => Promise<void>;
  onAssignIteration?: (resultId: string, iterIdx: number, assigneeId: number | null) => Promise<void>;
}

export function AssigneeDropdown({
  resultId,
  assignedTo,
  assignedToName,
  assignedToAvatar,
  iterationResults,
  runStatus,
  members,
  currentUserId,
  onAssign,
  onAssignIteration,
}: AssigneeDropdownProps) {
  const uniqueAssigneeIds = useMemo(() => {
    const ids: number[] = [];
    if (assignedTo && !ids.includes(assignedTo)) ids.push(assignedTo);
    if (Array.isArray(iterationResults)) {
      iterationResults.forEach((ir: any) => {
        if (ir.assigned_to && !ids.includes(ir.assigned_to)) {
          ids.push(ir.assigned_to);
        }
      });
    }

    const curIdNum = typeof currentUserId === 'string' ? parseInt(currentUserId, 10) : currentUserId;

    return ids.sort((a, b) => {
      // If current user is one of them, current user comes FIRST!
      if (curIdNum && a === curIdNum) return -1;
      if (curIdNum && b === curIdNum) return 1;
      const nameA = members.find((m: any) => m.userId === a || m.user?.id === a)?.user?.name || '';
      const nameB = members.find((m: any) => m.userId === b || m.user?.id === b)?.user?.name || '';
      return nameA.localeCompare(nameB);
    });
  }, [assignedTo, iterationResults, currentUserId, members]);

  const hasIterations = Array.isArray(iterationResults) && iterationResults.length > 1;

  const getUser = (uid: number) => {
    const member = members.find((m: any) => m.userId === uid || m.user?.id === uid);
    if (member?.user) return member.user;
    // The result payload carries the assignee name/avatar. Use it when the
    // user is no longer a project member (left, removed, or deactivated).
    if (uid === assignedTo && (assignedToName || assignedToAvatar)) {
      return {
        id: uid,
        name: assignedToName || undefined,
        fullName: undefined,
        email: undefined,
        avatarUrl: assignedToAvatar || undefined,
        image: undefined,
      };
    }
    return undefined;
  };

  /** Never invent a person: an unresolvable assignee is shown as unknown. */
  const getDisplayName = (uid: number) => {
    const user = getUser(uid);
    if (!user || (!user.name && !user.email)) return 'Unknown user';
    return formatUserDisplayName(user.name, user.email);
  };

  const isUnknownAssignee = (uid: number) => {
    const user = getUser(uid);
    return !user || (!user.name && !user.email);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={runStatus === 'aborted'}
          className={cn(
            "h-7 px-1 rounded-md text-xs flex items-center gap-1.5 transition-colors duration-150 cursor-pointer select-none max-w-full outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            uniqueAssigneeIds.length === 0
              ? "text-muted-foreground hover:text-foreground"
              : "text-foreground/90",
            runStatus === 'aborted' && "opacity-50 cursor-not-allowed pointer-events-none"
          )}
          title={
            uniqueAssigneeIds.length === 0
              ? 'Unassigned'
              : uniqueAssigneeIds.map((id) => getDisplayName(id)).join(', ')
          }
        >
          {uniqueAssigneeIds.length === 0 ? (
            <>
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/50">
                <UserRound className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-medium whitespace-nowrap text-muted-foreground hidden lg:inline">Unassigned</span>
            </>
          ) : uniqueAssigneeIds.length === 1 ? (
            <>
              <UserAvatar
                userId={uniqueAssigneeIds[0]}
                name={getUser(uniqueAssigneeIds[0])?.name}
                fullName={getUser(uniqueAssigneeIds[0])?.fullName}
                email={getUser(uniqueAssigneeIds[0])?.email}
                imageUrl={getUser(uniqueAssigneeIds[0])?.avatarUrl || getUser(uniqueAssigneeIds[0])?.image}
                initials={isUnknownAssignee(uniqueAssigneeIds[0]) ? '?' : undefined}
                size="sm"
                className="h-6 w-6 text-[10px]"
              />
              <span
                className={cn(
                  'truncate max-w-[120px] text-xs hidden lg:inline',
                  isUnknownAssignee(uniqueAssigneeIds[0])
                    ? 'text-muted-foreground font-normal italic'
                    : 'text-foreground/90 font-medium'
                )}
              >
                {getDisplayName(uniqueAssigneeIds[0])}
              </span>
            </>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="flex items-center -space-x-1.5 shrink-0">
                {uniqueAssigneeIds.slice(0, 3).map((id, index) => (
                  <UserAvatar
                    key={id}
                    userId={id}
                    name={getUser(id)?.name}
                    fullName={getUser(id)?.fullName}
                    email={getUser(id)?.email}
                    imageUrl={getUser(id)?.avatarUrl || getUser(id)?.image}
                    size="sm"
                    className={cn(
                      "h-6 w-6 text-[10px] ring-2 ring-background",
                      index === 0 ? "z-30" : index === 1 ? "z-20" : "z-10"
                    )}
                  />
                ))}
                {uniqueAssigneeIds.length > 3 && (
                  <div className="h-6 w-6 rounded-full bg-muted border-2 border-background text-[10px] font-mono font-bold flex items-center justify-center text-foreground z-0">
                    +{uniqueAssigneeIds.length - 3}
                  </div>
                )}
              </div>
              <span className="truncate max-w-[120px] text-xs text-foreground/90 font-medium hidden lg:inline">
                {uniqueAssigneeIds.length} assignees
              </span>
            </div>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className={cn(
          "p-2 text-xs",
          hasIterations ? "w-84 space-y-2" : "w-60 space-y-1"
        )}
      >
        {/* Header */}
        <div className="px-3 pb-1.5 border-b border-border/50 flex items-center justify-between">
          <span className="font-semibold text-[10.5px] text-muted-foreground uppercase tracking-wider font-mono">
            {hasIterations ? `Assign Case & Iterations` : `Assign Test Case`}
          </span>
          {hasIterations && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {(iterationResults || []).length} itrs
            </span>
          )}
        </div>

        {hasIterations ? (
          <>
            {/* 1. Case Default Assignee */}
            <div className="px-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-foreground">Case Default</span>
                <span className="text-[10px] text-muted-foreground">(Inherited by all itrs)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={assignedTo || ''}
                  onChange={async (e) => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : null;
                    await onAssign(resultId, val);
                  }}
                  className="flex-1 bg-background/80 border border-white/15 rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Unassigned</option>
                  {members.map((m: any) => {
                    const u = m.user || m;
                    return (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    );
                  })}
                </select>
                {assignedTo && (
                  <button
                    type="button"
                    onClick={async () => await onAssign(resultId, null)}
                    className="text-[10px] text-muted-foreground hover:text-red-400 px-1 py-0.5 rounded transition-colors"
                    title="Clear default"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* 2. Iteration Individual Assignees */}
            <div className="border-t border-border/40 pt-2 px-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-foreground">Iteration Assignees</span>
                <span className="text-[10px] text-muted-foreground">Override per iteration</span>
              </div>
              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                {iterationResults.map((ir: any, idx: number) => {
                  const iterAssigneeId = ir.assigned_to;

                  return (
                    <div
                      key={ir.id || idx}
                      className="flex items-center justify-between gap-1.5 py-1 px-1.5 rounded-lg bg-white/[0.02] border border-white/5 text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="font-mono text-[10px] font-bold text-muted-foreground">
                          #{idx + 1}
                        </span>
                        <select
                          value={iterAssigneeId || ''}
                          onChange={async (e) => {
                            if (onAssignIteration) {
                              const val = e.target.value ? parseInt(e.target.value, 10) : null;
                              await onAssignIteration(resultId, idx, val);
                            }
                          }}
                          className="flex-1 bg-transparent border-none text-[11px] text-foreground focus:outline-none p-0 cursor-pointer"
                        >
                          <option value="" className="bg-[#141824] text-muted-foreground">
                            {assignedTo ? `Inherit (${getUser(assignedTo)?.name?.split(' ')[0]})` : 'Unassigned'}
                          </option>
                          {members.map((m: any) => {
                            const u = m.user || m;
                            return (
                              <option key={u.id} value={u.id} className="bg-[#141824] text-foreground">
                                {u.name}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      {iterAssigneeId && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (onAssignIteration) {
                              await onAssignIteration(resultId, idx, null);
                            }
                          }}
                          className="text-[9px] text-muted-foreground hover:text-red-400 p-0.5 rounded transition-colors"
                          title="Reset to inherit default"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          /* Standard Single Test Case Assignee List */
          <div className="space-y-0.5 max-h-60 overflow-y-auto">
            {/* Quick Unassign Option */}
            <button
              type="button"
              onClick={async () => {
                await onAssign(resultId, null);
              }}
              className={cn(
                "w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between hover:bg-white/5 cursor-pointer transition-colors",
                !assignedTo && "font-semibold text-primary"
              )}
            >
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center text-[10px] text-muted-foreground">
                  ✕
                </div>
                <span>Unassigned</span>
              </div>
              {!assignedTo && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>

            <div className="h-px bg-white/5 my-1" />

            {/* Members List */}
            {members.map((m: any) => {
              const u = m.user || m;
              const isCurrent = assignedTo === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={async () => {
                    await onAssign(resultId, u.id);
                  }}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between hover:bg-white/5 cursor-pointer transition-colors",
                    isCurrent && "font-semibold text-primary"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <UserAvatar
                      userId={u?.id}
                      name={u?.name}
                      fullName={u?.fullName}
                      email={u?.email}
                      imageUrl={u?.avatarUrl || u?.image}
                      size="sm"
                      className="h-5 w-5 text-[9px]"
                    />
                    <span className="truncate">{formatUserDisplayName(u?.name, u?.email)}</span>
                  </div>
                  {isCurrent && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
