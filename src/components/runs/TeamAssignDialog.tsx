"use client";

import React, { useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn } from '@/lib/utils';
import { distributeEvenly, type TeamProgressLeaf } from '@/lib/runs/team-progress';

export interface TeamAssignMember {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  /** Pending leaf cases currently owned by this member. */
  pending: number;
}

interface TeamAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Unassigned leaf cases being distributed. */
  targets: TeamProgressLeaf[];
  members: TeamAssignMember[];
  onSubmit: (memberIds: string[]) => Promise<void> | void;
}

/** Name first, email once underneath — never the same string twice. */
export function memberIdentity(member: { name?: string | null; email?: string | null }) {
  const email = member.email?.trim() || null;
  const primary = member.name?.trim() || email || 'Member';
  const secondary = email && email !== primary ? email : null;
  return { primary, secondary };
}

/**
 * Team-progress assignment: pick one member for every unassigned leaf, or
 * several to split them round-robin.
 */
export function TeamAssignDialog({
  open,
  onOpenChange,
  targets,
  members,
  onSubmit,
}: TeamAssignDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelected(new Set());
      setError(null);
    }
    onOpenChange(next);
  };

  const selectedIds = useMemo(() => [...selected], [selected]);

  const preview = useMemo(() => {
    if (selectedIds.length < 2) return null;
    const buckets = distributeEvenly(targets, selectedIds);
    return buckets
      .map((bucket) => {
        const member = members.find((candidate) => candidate.id === bucket.memberId);
        const { primary } = member
          ? memberIdentity(member)
          : { primary: `User #${bucket.memberId}` };
        return `${primary} ${bucket.items.length}`;
      })
      .join(' · ');
  }, [members, selectedIds, targets]);

  const toggle = (id: string) => {
    if (submitting) return;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selectedIds.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(selectedIds);
      handleOpenChange(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Failed to assign cases'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const count = targets.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Assign {count} unassigned {count === 1 ? 'case' : 'cases'}
          </DialogTitle>
          <DialogDescription>
            Choose a teammate, or several to split them evenly.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[320px] space-y-1 overflow-y-auto py-1">
          {members.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No project members available.
            </p>
          )}
          {members.map((member) => {
            const { primary, secondary } = memberIdentity(member);
            const checked = selected.has(member.id);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => toggle(member.id)}
                aria-pressed={checked}
                disabled={submitting}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  checked ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted'
                )}
              >
                <span
                  className={cn(
                    'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                    checked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-primary/50 bg-background'
                  )}
                >
                  {checked && <Check className="h-3 w-3 stroke-[3]" />}
                </span>
                <UserAvatar
                  userId={member.id}
                  name={primary}
                  email={member.email}
                  imageUrl={member.avatarUrl}
                  size="sm"
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {primary}
                  </span>
                  {secondary && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {secondary}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tabular-nums',
                    member.pending > 0
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'border-border/60 text-muted-foreground'
                  )}
                >
                  {member.pending} pending
                </span>
              </button>
            );
          })}
        </div>

        {preview && (
          <p className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            Split: {preview}
          </p>
        )}
        {error && <p className="text-[11px] text-rose-500">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={selectedIds.length === 0 || submitting || count === 0}
            className="gradient-btn text-white"
          >
            {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
