"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bug, ChevronRight, Clock, Copy, Layers } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { ProgressCircle } from '@/components/common/ProgressCircle';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn, formatDuration } from '@/lib/utils';
import { subscribeRunEvents } from '@/lib/runs/run-events-bus';
import { toast } from 'sonner';
import { getRunDefectsAction, type ProjectDefectItem } from '@/app/actions/defects';
import type { TeamProgressRow } from '@/lib/runs/team-progress';

export interface RunOverviewCounts {
  passed: number;
  failed: number;
  blocked: number;
  pending: number;
  total: number;
}

export interface RunOverviewRun {
  name: string;
  status?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  dueDate?: string | null;
}

interface RunOverviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  runId: string;
  run: RunOverviewRun;
  overview: RunOverviewCounts;
  /** Manual leaf cases; empty for fully automated runs. */
  teamRows: TeamProgressRow[];
  hasManualCases: boolean;
  automated?: { executed: number; total: number } | null;
  /** Scroll the drawer to the team section when opened from the header link. */
  focusSection?: 'team' | null;
  onSelectAssignee: (id: string) => void;
  onAssignUnassigned: () => void;
  onGroupByAssignee: () => void;
  /** Refetch run + results; called for every live event while open. */
  onRefresh: () => Promise<void> | void;
}

const BUG_SEVERITY_CLASS: Record<string, string> = {
  urgent: 'border-rose-500/30 bg-rose-500/10 text-rose-500',
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-500',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'border-slate-400/30 bg-slate-400/10 text-slate-500',
};

function shortDate(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatElapsed(start?: string | null, end?: string | null): string {
  if (!start) return '—';
  const startMs = new Date(start).getTime();
  if (!Number.isFinite(startMs)) return '—';
  const endMs = end ? new Date(end).getTime() : Date.now();
  const minutes = Math.max(0, Math.floor((endMs - startMs) / 60_000));
  if (minutes < 1) return '<1m';
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return shortDate(iso);
}

function isDefectDone(defect: ProjectDefectItem): boolean {
  const status = (defect.ticketStatus || defect.localStatus || '').toLowerCase();
  return (
    status.includes('released') ||
    status.includes('done') ||
    status.includes('resolved') ||
    status.includes('closed')
  );
}

function Bucket({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={cn('h-2 w-2 rounded-full', dot)} />
      <span>{label}</span>
      <span className="font-mono font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  );
}

function TeamBar({ row }: { row: TeamProgressRow }) {
  const segments = [
    { count: row.passed, className: 'bg-emerald-500' },
    { count: row.failed, className: 'bg-rose-500' },
    { count: row.blocked, className: 'bg-amber-500' },
    { count: row.pending, className: 'bg-muted-foreground/25' },
  ];
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      title={`Passed ${row.passed} · Failed ${row.failed} · Blocked ${row.blocked} · Pending ${row.pending}`}
    >
      {segments.map((segment, index) =>
        segment.count > 0 ? (
          <span
            key={index}
            className={cn('h-full', segment.className)}
            style={{ width: `${(segment.count / Math.max(1, row.total)) * 100}%` }}
          />
        ) : null
      )}
    </div>
  );
}

function TeamRow({
  row,
  onSelect,
  onAssign,
}: {
  row: TeamProgressRow;
  onSelect: () => void;
  onAssign?: () => void;
}) {
  const timeSpent = row.executedSeconds > 0 ? formatDuration(row.executedSeconds) : '—';
  const average =
    row.executed > 0 && row.executedSeconds > 0
      ? formatDuration(Math.round(row.executedSeconds / row.executed))
      : '—';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group cursor-pointer border-b border-border/40 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        row.id === 'unassigned' && 'bg-amber-500/5'
      )}
      aria-label={`Filter cases assigned to ${row.name}`}
    >
      <div className="flex items-center gap-2.5">
        {row.id === 'unassigned' ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-amber-500/50 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            ?
          </span>
        ) : (
          <UserAvatar
            userId={row.id}
            name={row.name}
            email={row.email}
            imageUrl={row.avatarUrl}
            size="sm"
            className="h-6 w-6 shrink-0 text-[9px]"
          />
        )}

        <Tooltip content={row.email || row.name} wrapperClassName="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-foreground">
            {row.name}
          </span>
        </Tooltip>

        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
          {row.executed}/{row.total} executed
        </span>

        {onAssign ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAssign();
            }}
            className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 dark:text-amber-300"
          >
            Assign…
          </button>
        ) : null}
      </div>

      <div className="mt-1.5 flex items-center gap-3 pl-[34px]">
        <span className="min-w-0 flex-1">
          <TeamBar row={row} />
        </span>
        <span className="flex shrink-0 items-center gap-2.5 font-mono text-[10px] tabular-nums text-muted-foreground">
          <span title="Time spent on this person's cases">
            <Clock className="mr-1 inline h-2.5 w-2.5" />
            {timeSpent}
          </span>
          <span title="Average per executed case">avg {average}</span>
          <span title={row.lastActivity ? new Date(row.lastActivity).toLocaleString() : undefined}>
            last {relativeTime(row.lastActivity)}
          </span>
        </span>
      </div>
    </div>
  );
}

export function RunOverviewDrawer({
  open,
  onOpenChange,
  slug,
  runId,
  run,
  overview,
  teamRows,
  hasManualCases,
  automated,
  focusSection,
  onSelectAssignee,
  onAssignUnassigned,
  onGroupByAssignee,
  onRefresh,
}: RunOverviewDrawerProps) {
  const teamRef = useRef<HTMLElement>(null);
  const [defects, setDefects] = useState<ProjectDefectItem[]>([]);
  const [loadingDefects, setLoadingDefects] = useState(false);

  const people = useMemo(() => teamRows.filter((row) => row.id !== 'unassigned'), [teamRows]);
  const unassigned = useMemo(
    () => teamRows.find((row) => row.id === 'unassigned') || null,
    [teamRows]
  );
  const openBugs = defects.filter((defect) => !isDefectDone(defect)).length;
  const completedPct =
    overview.total > 0
      ? Math.round(
          ((overview.passed + overview.failed + overview.blocked) / overview.total) * 100
        )
      : 0;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingDefects(true);
    void getRunDefectsAction(runId)
      .then((rows) => {
        if (!cancelled) setDefects(rows || []);
      })
      .catch(() => {
        if (!cancelled) setDefects([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDefects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, runId]);

  // Live updates through the shared per-run events bus (one connection per run
  // per tab, shared with the run page when both are mounted).
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!open || !runId) return;
    const unsubscribe = subscribeRunEvents(
      runId,
      () => {
        void onRefreshRef.current();
      },
      { poll: true }
    );
    return unsubscribe;
  }, [open, runId]);

  useEffect(() => {
    if (!open || focusSection !== 'team') return;
    const frame = requestAnimationFrame(() => {
      teamRef.current?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focusSection]);

  const copySummary = async () => {
    const teamLines = teamRows.map(
      (row) =>
        `- ${row.name}: ${row.executed}/${row.total} executed · ${
          row.executedSeconds > 0 ? formatDuration(row.executedSeconds) : '—'
        }`
    );
    const bugLines = defects
      .slice(0, 3)
      .map((defect) => `- ${defect.testCaseDisplayId || 'CASE'} · ${defect.title} (${defect.severity})`);
    const summary = [
      `Run: ${run.name}`,
      `${overview.passed + overview.failed + overview.blocked}/${overview.total} completed · Passed ${overview.passed} · Failed ${overview.failed} · Blocked ${overview.blocked} · Pending ${overview.pending}`,
      `Started ${shortDate(run.startedAt)} · Elapsed ${formatElapsed(run.startedAt, run.completedAt)} · Due ${shortDate(run.dueDate)}`,
      '',
      hasManualCases ? 'Team' : 'Automated',
      hasManualCases
        ? teamLines.join('\n') || '- No manual cases'
        : automated
          ? `- ${automated.executed}/${automated.total} automated executed`
          : '- No cases',
      '',
      `Bugs: ${openBugs} open`,
      ...(bugLines.length > 0 ? bugLines : ['- None logged']),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      toast.success('Run summary copied');
    } catch {
      toast.error('Could not copy the run summary');
    }
  };

  const selectAssignee = (id: string) => {
    onSelectAssignee(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          'fixed left-auto right-0 top-0 z-50 flex h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l border-border bg-background p-0 shadow-2xl sm:w-[520px]',
          'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right'
        )}
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-border/60 bg-background/95 px-4 py-3 pr-12 backdrop-blur">
          <div className="min-w-0">
            <DialogTitle className="text-sm font-semibold text-foreground">
              Run overview
            </DialogTitle>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={run.name}>
              {run.name}
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* a) Overall */}
          <section className="border-b border-border/60 px-4 py-4">
            <div className="flex items-center gap-4">
              <ProgressCircle
                size={78}
                strokeWidth={5}
                segmented
                animate={false}
                segments={{
                  pass: overview.passed,
                  fail: overview.failed,
                  blocked: overview.blocked,
                  total: overview.total,
                }}
                centerContent={
                  <span className="font-mono text-sm font-bold tracking-tight text-foreground">
                    {completedPct}%
                  </span>
                }
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">
                  {overview.passed + overview.failed + overview.blocked} of {overview.total}{' '}
                  completed
                </p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <Bucket label="Passed" value={overview.passed} dot="bg-emerald-500" />
                  <Bucket label="Failed" value={overview.failed} dot="bg-rose-500" />
                  <Bucket label="Blocked" value={overview.blocked} dot="bg-amber-500" />
                  <Bucket label="Pending" value={overview.pending} dot="bg-muted-foreground/30" />
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Started {shortDate(run.startedAt)} · {formatElapsed(run.startedAt, run.completedAt)} ·
              Due {shortDate(run.dueDate)}
            </p>
          </section>

          {/* b) Team */}
          <section ref={teamRef} className="scroll-mt-2 border-b border-border/60">
            <div className="flex items-center justify-between px-4 pb-1.5 pt-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Team
              </h3>
              {hasManualCases && people.length > 0 ? (
                <span className="text-[10px] text-muted-foreground">
                  {people.length} {people.length === 1 ? 'assignee' : 'assignees'}
                </span>
              ) : null}
            </div>

            {hasManualCases ? (
              <>
                {people.map((row) => (
                  <TeamRow key={row.id} row={row} onSelect={() => selectAssignee(row.id)} />
                ))}
                {unassigned ? (
                  <TeamRow
                    row={unassigned}
                    onSelect={() => selectAssignee('unassigned')}
                    onAssign={onAssignUnassigned}
                  />
                ) : null}
                {teamRows.length === 0 ? (
                  <p className="px-4 py-4 text-center text-[11.5px] text-muted-foreground">
                    No manual cases in this run
                  </p>
                ) : null}
              </>
            ) : (
              <div className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                Automated: {automated ? `${automated.executed}/${automated.total}` : '0/0'} executed
              </div>
            )}

            {hasManualCases ? (
              <p className="px-4 pb-3 pt-1 text-[10px] text-muted-foreground">
                Manual cases only. Time comes from the case timer.
              </p>
            ) : (
              <div className="pb-3" />
            )}
          </section>

          {/* c) Bugs */}
          <section className="border-b border-border/60 px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Bug className="h-3 w-3" />
                Bugs
              </h3>
              <Link
                href={`/p/${slug}/defects?run=${encodeURIComponent(runId)}`}
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
              >
                View all
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>

            <p className="mt-1.5 text-[11px] text-muted-foreground">
              <span className="font-mono text-sm font-semibold text-foreground">{openBugs}</span>{' '}
              open
            </p>

            <div className="mt-2 space-y-1.5">
              {loadingDefects && defects.length === 0 ? (
                <p className="py-2 text-[11px] text-muted-foreground">Loading bugs…</p>
              ) : defects.length === 0 ? (
                <p className="py-2 text-[11px] text-muted-foreground">
                  No bugs logged for this run
                </p>
              ) : (
                defects.slice(0, 3).map((defect) => (
                  <div
                    key={defect.id}
                    className="flex items-start gap-2 rounded-lg border border-border/50 px-2.5 py-1.5"
                  >
                    <span className="shrink-0 font-mono text-[10px] font-semibold text-muted-foreground">
                      {defect.testCaseDisplayId || 'CASE'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground" title={defect.title}>
                      {defect.title}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                        BUG_SEVERITY_CLASS[defect.severity] ||
                          'border-border/60 bg-muted/40 text-muted-foreground'
                      )}
                    >
                      {defect.severity}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* d) Footer */}
          <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onGroupByAssignee();
                onOpenChange(false);
              }}
              className="h-7 cursor-pointer gap-1.5 px-2 text-[11px]"
            >
              <Layers className="h-3 w-3" />
              Group by assignee
            </Button>
            <Button
              size="sm"
              onClick={() => void copySummary()}
              className="h-7 cursor-pointer gap-1.5 px-2 text-[11px]"
            >
              <Copy className="h-3 w-3" />
              Copy summary
            </Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
