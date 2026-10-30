"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ProgressCircle } from '@/components/common/ProgressCircle';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn, formatDuration } from '@/lib/utils';
import { subscribeRunEvents } from '@/lib/runs/run-events-bus';
import type { TeamProgressRow } from '@/lib/runs/team-progress';

interface TeamProgressModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  runId: string;
  run: { name: string };
  /** Manual leaf cases; empty for fully automated runs. */
  teamRows: TeamProgressRow[];
  hasManualCases: boolean;
  onSelectAssignee: (id: string) => void;
  onGroupByAssignee: () => void;
  /** Refetch run + results; called for every live event while open. */
  onRefresh: () => Promise<void> | void;
}

function shortDateNoYear(iso?: string | null): string {
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
  return shortDateNoYear(iso);
}

function TeamRing({ row }: { row: TeamProgressRow }) {
  const executed = row.passed + row.failed + row.blocked;
  const pct = row.total > 0 ? Math.round((executed / row.total) * 100) : 0;
  return (
    <div className="flex items-center justify-center gap-1.5 shrink-0">
      <ProgressCircle
        size={26}
        strokeWidth={3}
        segmented
        animate={false}
        segments={{
          pass: row.passed,
          fail: row.failed,
          blocked: row.blocked,
          total: row.total,
        }}
        centerContent={
          <span className="text-[7px] font-bold font-mono text-foreground leading-none">
            {pct}%
          </span>
        }
      />
      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
        {executed}/{row.total}
      </span>
    </div>
  );
}

function TeamRow({
  row,
  isUnassigned,
  narrow,
  onSelect,
}: {
  row: TeamProgressRow;
  isUnassigned: boolean;
  narrow: boolean;
  onSelect: () => void;
}) {
  const timeSpent = row.executedSeconds > 0 ? formatDuration(row.executedSeconds) : '—';
  const average =
    row.executed > 0 && row.executedSeconds > 0
      ? formatDuration(Math.round(row.executedSeconds / row.executed))
      : '—';

  return (
    <tr
      onClick={onSelect}
      className={cn(
        'h-[40px] cursor-pointer border-b border-border/40 transition-colors hover:bg-muted/50 text-xs',
        isUnassigned && 'bg-amber-500/5 dark:bg-amber-500/10 hover:bg-amber-500/10'
      )}
    >
      {/* 1. Tester */}
      <td className="px-3 py-2 pl-4 w-[160px]">
        <div className="flex items-center gap-2 min-w-0">
          {isUnassigned ? (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
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
          <span className="block truncate font-medium text-foreground">{row.name}</span>
        </div>
      </td>

      <td className="px-2 py-2 w-[120px]">
        <TeamRing row={row} />
      </td>

      {/* 3. Passed */}
      <td className="px-2 py-2 text-center font-mono tabular-nums w-[56px]">
        <span className={row.passed > 0 ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
          {row.passed}
        </span>
      </td>

      {/* 4. Failed */}
      <td className="px-2 py-2 text-center font-mono tabular-nums w-[56px]">
        <span className={row.failed > 0 ? 'text-rose-500 font-semibold' : 'text-muted-foreground'}>
          {row.failed}
        </span>
      </td>

      {/* 5. Blocked */}
      <td className="px-2 py-2 text-center font-mono tabular-nums w-[60px]">
        <span className={row.blocked > 0 ? 'text-amber-500 font-semibold' : 'text-muted-foreground'}>
          {row.blocked}
        </span>
      </td>

      {/* 6. Pending */}
      <td className="px-2 py-2 text-center font-mono tabular-nums text-muted-foreground w-[60px]">
        {row.pending}
      </td>

      {/* 7. Duration */}
      <td className="px-2 py-2 text-center font-mono tabular-nums text-muted-foreground w-[70px]">
        {timeSpent}
      </td>

      {/* 8. Avg/case (hidden < 900px) */}
      {!narrow && (
        <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground w-[66px]">
          {average}
        </td>
      )}

      {/* 9. Active (hidden < 900px) */}
      {!narrow && (
        <td className="px-3 py-2 pr-4 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap w-[72px]">
          {relativeTime(row.lastActivity)}
        </td>
      )}
    </tr>
  );
}

export function TeamProgressModal({
  open,
  onOpenChange,
  slug,
  runId,
  run,
  teamRows,
  hasManualCases,
  onSelectAssignee,
  onGroupByAssignee,
  onRefresh,
}: TeamProgressModalProps) {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setNarrow(window.innerWidth < 900);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const people = useMemo(() => teamRows.filter((row) => row.id !== 'unassigned'), [teamRows]);
  const unassigned = useMemo(
    () => teamRows.find((row) => row.id === 'unassigned') || null,
    [teamRows]
  );

  const totals = useMemo(() => {
    return teamRows.reduce(
      (acc, row) => ({
        passed: acc.passed + row.passed,
        failed: acc.failed + row.failed,
        blocked: acc.blocked + row.blocked,
        pending: acc.pending + row.pending,
        total: acc.total + row.total,
        executedSeconds: acc.executedSeconds + row.executedSeconds,
      }),
      { passed: 0, failed: 0, blocked: 0, pending: 0, total: 0, executedSeconds: 0 }
    );
  }, [teamRows]);

  const anyTimeSpent = teamRows.some((row) => row.executedSeconds > 0);

  const selectAssignee = useCallback(
    (id: string) => {
      onSelectAssignee(id);
      onOpenChange(false);
    },
    [onSelectAssignee, onOpenChange]
  );

  // Live updates while open, through the shared per-run events bus so the modal
  // never opens a second EventSource alongside the run page.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Desktop (>= 900px): Centered modal width
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-[950px] max-h-[85vh] translate-x-[-50%] translate-y-[-50%] bg-background border border-border/80 shadow-2xl rounded-2xl overflow-hidden will-change-[transform,opacity]',
          // Mobile (< 900px): Fullscreen sheet
          'max-[899px]:inset-0 max-[899px]:left-auto max-[899px]:top-auto max-[899px]:translate-none max-[899px]:w-full max-[899px]:h-screen max-[899px]:max-h-none max-[899px]:rounded-none max-[899px]:border-0',
          // Animations
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]'
        )}
        aria-labelledby="team-progress-title"
      >
        {/* Header */}
        <header className="shrink-0 flex items-center justify-between gap-3 border-b border-border/60 bg-background px-4 py-3">
          <div className="min-w-0 flex items-center gap-3">
            <DialogTitle id="team-progress-title" className="text-base font-semibold text-foreground truncate">
              Team progress
            </DialogTitle>
            <p className="text-xs text-muted-foreground truncate" title={run.name}>
              {run.name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors cursor-pointer"
            aria-label="Close team progress"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Scrollable Body Content */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-background p-4">
          <div className="overflow-x-auto border border-border/60 rounded-lg">
            <table className="w-full text-left border-collapse" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <th className="px-3 py-2.5 text-left w-[160px] pl-4">Tester</th>
                  <th className="px-2 py-2.5 text-center w-[120px]">Progress</th>
                  <th className="px-2 py-2.5 text-center w-[56px]">Passed</th>
                  <th className="px-2 py-2.5 text-center w-[56px]">Failed</th>
                  <th className="px-2 py-2.5 text-center w-[60px]">Blocked</th>
                  <th className="px-2 py-2.5 text-center w-[60px]">Pending</th>
                  <th className="px-2 py-2.5 text-center w-[70px]">Duration</th>
                  {!narrow && (
                    <th className="px-2 py-2.5 text-center w-[66px]">Avg/case</th>
                  )}
                  {!narrow && (
                    <th className="px-3 py-2.5 text-center w-[72px] pr-4">Active</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {people.map((row) => (
                  <TeamRow
                    key={row.id}
                    row={row}
                    isUnassigned={false}
                    narrow={narrow}
                    onSelect={() => selectAssignee(row.id)}
                  />
                ))}
                {unassigned ? (
                  <TeamRow
                    key="unassigned"
                    row={unassigned}
                    isUnassigned={true}
                    narrow={narrow}
                    onSelect={() => selectAssignee('unassigned')}
                  />
                ) : null}
                {teamRows.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-center text-xs text-muted-foreground" colSpan={narrow ? 7 : 9}>
                      {hasManualCases ? 'No manual cases in this run' : 'No team data'}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/60 bg-muted/20 font-semibold text-xs [&_td]:text-[10px] [&_td]:uppercase [&_td]:tracking-wider [&_td]:text-muted-foreground">
                  <td className="px-3 py-2.5 pl-4 w-[160px]">TOTAL</td>
                  <td className="px-2 py-2.5 w-[120px]">
                    <TeamRing
                      row={{
                        id: 'totals',
                        name: 'Totals',
                        email: null,
                        avatarUrl: null,
                        total: totals.total,
                        passed: totals.passed,
                        failed: totals.failed,
                        blocked: totals.blocked,
                        pending: totals.pending,
                        executed: totals.passed + totals.failed + totals.blocked,
                        executedSeconds: totals.executedSeconds,
                        lastActivity: null,
                        counts: {},
                      }}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-center font-mono tabular-nums text-foreground w-[56px]">
                    {totals.passed}
                  </td>
                  <td className={cn('px-2 py-2.5 text-center font-mono tabular-nums w-[56px]', totals.failed === 0 ? 'text-muted-foreground' : 'text-rose-500 font-semibold')}>
                    {totals.failed}
                  </td>
                  <td className={cn('px-2 py-2.5 text-center font-mono tabular-nums w-[60px]', totals.blocked === 0 ? 'text-muted-foreground' : 'text-amber-500 font-semibold')}>
                    {totals.blocked}
                  </td>
                  <td className="px-2 py-2.5 text-center font-mono tabular-nums text-muted-foreground w-[60px]">
                    {totals.pending}
                  </td>
                  <td className="px-2 py-2.5 text-center font-mono tabular-nums text-muted-foreground w-[70px]">
                    {anyTimeSpent ? formatDuration(totals.executedSeconds) : '—'}
                  </td>
                  {!narrow && <td className="px-2 py-2.5 text-center font-mono tabular-nums text-muted-foreground w-[66px]">—</td>}
                  {!narrow && <td className="px-3 py-2.5 pr-4 text-center font-mono tabular-nums text-muted-foreground w-[72px]">—</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
