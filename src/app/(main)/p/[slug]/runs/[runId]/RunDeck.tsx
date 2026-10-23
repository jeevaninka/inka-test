"use client";

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover';
import {
  HoverDropdownMenu,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn, formatDuration } from '@/lib/utils';
import { toast } from 'sonner';
import { apiClient } from '@/lib/apiClient';
import {
  ArrowLeft, CheckCircle, XCircle, Ban, SkipForward, AlertTriangle,
  ChevronDown, ChevronRight, Search, UserPlus, UserMinus,
  Copy, RotateCcw, ExternalLink, MoreVertical, MoreHorizontal, Trash2, Plus,
  X, User, Download, Share2, Clock, ArrowUpDown, ArrowUp, ArrowDown, Play,
  Check, Sparkles, ListChecks, Layers, Edit, RefreshCw, Loader2, Pause, Filter
} from 'lucide-react';
import {
  finishRunAction,
  assignRunResultAction, unassignRunResultAction, updateRunResultAction,
  deleteRunResultAction, bulkUpdateRunResultStatusAction,
  bulkSetRunResultStatusAction, bulkRerunRunResultsAction, bulkDeleteRunResultsAction,
  cloneTestRunAction, abortRunAction, updateTestRunAction, addCasesToRunAction,
  resetSingleResultAction, archiveTestRunAction
} from '@/app/actions/runs';
import { startExternalRunCasesAction, stopRunExecutionAction, rerunRunCasesAction, resumeExternalRunCasesAction } from '@/app/actions/integrations';
import { Tooltip } from '@/components/ui/tooltip';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/common/UserAvatar';
import { AiBadge } from '@/components/common/AiBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { ResultStatusBadge } from '@/components/common/ResultStatusBadge';
import { StatusPill, type StatusPillTone } from '@/components/common/StatusPill';
import { ProgressCircle } from '@/components/common/ProgressCircle';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { CaseSourceIcon } from '@/components/common/CaseSourceIcon';
import { getCaseAutomationSource, isAutomatedCase } from '@/lib/cases/automation-source';
import {
  loadRunViewFilters,
  patchRunViewFilters,
  type RunCaseTypeFilter,
  type RunGroupBy,
  type RunViewFilters,
} from '@/lib/runs/run-view-filters';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { AssigneeDropdown } from './ExecutionConsole';

function parseCaseDisplayId(displayId?: string | null): { prefix: string; num: number } {
  if (!displayId) return { prefix: '', num: 0 };
  const match = String(displayId).match(/^([A-Za-z]+)-?(\d+)$/);
  if (match) {
    return { prefix: match[1].toUpperCase(), num: parseInt(match[2], 10) };
  }
  return { prefix: String(displayId).toUpperCase(), num: 0 };
}

function compareCaseAsc(a: any, b: any, query?: string): number {
  const q = query ? query.toLowerCase().trim() : '';
  if (q) {
    const aId = (a.displayId || '').toLowerCase();
    const bId = (b.displayId || '').toLowerCase();
    const aExact = aId === q;
    const bExact = bId === q;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    const aStarts = aId.startsWith(q);
    const bStarts = bId.startsWith(q);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
  }

  const pA = parseCaseDisplayId(a.displayId);
  const pB = parseCaseDisplayId(b.displayId);
  if (pA.prefix !== pB.prefix) {
    return pA.prefix.localeCompare(pB.prefix);
  }
  if (pA.num !== pB.num) {
    return pA.num - pB.num;
  }
  return (a.title || '').localeCompare(b.title || '');
}

export type CaseRunState =
  | 'NOT_RUN'
  | 'QUEUED'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'ERROR'
  | 'CANCELLED';

export type DerivedRunState =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PARTIALLY_RUN'
  | 'COMPLETED'
  | 'STOPPED';

const CASE_STATE_META: Record<CaseRunState, { label: string; className: string }> = {
  NOT_RUN: { label: 'Not run', className: 'text-muted-foreground' },
  QUEUED: { label: 'Queued', className: 'text-amber-400' },
  RUNNING: { label: 'Running', className: 'text-sky-400' },
  PASSED: { label: 'Passed', className: 'text-emerald-400' },
  FAILED: { label: 'Failed', className: 'text-red-400' },
  ERROR: { label: 'Error', className: 'text-purple-400' },
  CANCELLED: { label: 'Cancelled', className: 'text-zinc-400' },
};

const CASE_STATE_TONE: Record<CaseRunState, StatusPillTone> = {
  NOT_RUN: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  PASSED: 'pass',
  FAILED: 'fail',
  ERROR: 'error',
  CANCELLED: 'cancelled',
};

function getCaseRunState(result: any): CaseRunState {
  const status = String(result?.status || '').toLowerCase();
  if (status === 'pass') return 'PASSED';
  if (status === 'fail') return 'FAILED';
  if (status === 'error' || status === 'invalid' || status === 'unavailable') return 'ERROR';
  if (status === 'skip' || status === 'blocked' || status === 'cancelled') return 'CANCELLED';

  if (status === 'pending') {
    const marker = String(result?.caseState || '').toUpperCase();
    if (marker === 'RUNNING') return 'RUNNING';
    if (marker === 'QUEUED') return 'QUEUED';
    return 'NOT_RUN';
  }

  return 'NOT_RUN';
}

function deriveRunState(run: any, results: any[]): DerivedRunState {
  if (String(run?.status || '').toLowerCase() === 'aborted') return 'STOPPED';
  if (
    results.some((r) =>
      String(r?.notes || '').toLowerCase().includes('stopped on first failure')
    )
  ) {
    return 'STOPPED';
  }

  const states = results.map(getCaseRunState);
  if (states.some((s) => s === 'RUNNING' || s === 'QUEUED')) return 'IN_PROGRESS';
  if (states.length === 0) return 'NOT_STARTED';

  const hasFinished = states.some(
    (s) => s === 'PASSED' || s === 'FAILED' || s === 'ERROR' || s === 'CANCELLED'
  );
  const hasNotRun = states.some((s) => s === 'NOT_RUN');

  if (hasNotRun) return hasFinished ? 'PARTIALLY_RUN' : 'NOT_STARTED';
  return 'COMPLETED';
}

function CaseStateBadge({
  state,
  queuePosition,
}: {
  state: CaseRunState;
  queuePosition?: number | null;
}) {
  const meta = CASE_STATE_META[state];
  return (
    <StatusPill
      tone={CASE_STATE_TONE[state]}
      title={queuePosition ? `Queue position ${queuePosition}` : undefined}
      icon={
        state === 'RUNNING' ? (
          <i className="running-dot" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
        )
      }
    >
      {state === 'QUEUED' && queuePosition ? `Queued #${queuePosition}` : meta.label}
    </StatusPill>
  );
}

const FRUITION_DONE = new Set([
  'pass',
  'fail',
  'error',
  'blocked',
  'skip',
  'invalid',
  'unavailable',
  'cancelled',
]);

/**
 * Single source of truth for the case table columns. The sticky header and
 * every row share this template, so cells stay aligned at every breakpoint.
 * Columns: index/checkbox · case (flexes) · status · time · assignee · row menu.
 */
const CASE_TABLE_GRID =
  'grid items-center grid-cols-[24px_minmax(0,1fr)_44px_76px_28px] gap-x-1.5 ' +
  'sm:grid-cols-[24px_minmax(120px,1fr)_60px_92px_76px_44px_28px] ' +
  'lg:grid-cols-[24px_minmax(140px,1fr)_64px_104px_84px_128px_28px] lg:gap-x-4 ' +
  'xl:grid-cols-[24px_minmax(200px,1fr)_68px_112px_92px_144px_28px] xl:gap-x-5';

/** Priority is communicated by color only in the table (no icon, no pill). */
const PRIORITY_TEXT: Record<string, string> = {
  P0: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/25 font-bold',
  P1: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25 font-bold',
  P2: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/25 font-bold',
  P3: 'text-zinc-500 dark:text-zinc-400 bg-zinc-500/10 border-zinc-500/25 font-semibold',
};

const PRIORITY_CAPTION: Record<string, string> = {
  P0: 'Critical',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
};

/** Status options for the filter menu, attention-first. */
const RUN_STATUS_FILTER_OPTIONS: { value: string; label: string; dot: string; always?: boolean }[] = [
  { value: 'fail', label: 'Failed', dot: 'bg-rose-400', always: true },
  { value: 'blocked', label: 'Blocked', dot: 'bg-amber-400' },
  { value: 'invalid', label: 'Invalid', dot: 'bg-violet-400' },
  { value: 'error', label: 'Script error', dot: 'bg-orange-400' },
  { value: 'skip', label: 'Skipped', dot: 'bg-zinc-400' },
  { value: 'pending', label: 'Not run', dot: 'bg-muted-foreground/40' },
  { value: 'pass', label: 'Passed', dot: 'bg-emerald-400', always: true },
];

function FilterSection({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-2.5 py-1.5 transition-colors hover:bg-muted/40 cursor-pointer"
      >
        <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-foreground">
          {label}
          {count > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-bold text-primary">{count}</span>
          )}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="max-h-56 space-y-0.5 overflow-y-auto border-t border-border/40 p-1.5">{children}</div>}
    </div>
  );
}

function FilterOption({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px] transition-colors cursor-pointer',
        selected
          ? 'bg-primary/10 font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      )}
    >
      <span
        className={cn(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
        )}
      >
        {selected && <Check className="h-2.5 w-2.5" />}
      </span>
      {children}
    </button>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="text-primary/70 transition-colors hover:text-primary cursor-pointer"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * Flat / Module switch. The moving pill is positioned from the measured
 * active button, so it glides between tabs instead of re-mounting and jumping.
 */
function GroupingTabs({
  value,
  onChange,
}: {
  value: RunGroupBy;
  onChange: (mode: 'flat' | 'module') => void;
}) {
  const modes = ['flat', 'module'] as const;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const buttonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = React.useState({ left: 0, width: 0, ready: false });

  const measure = React.useCallback(() => {
    const activeKey = value === 'suite' ? 'flat' : value;
    const el = buttonRefs.current[activeKey];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
  }, [value]);

  React.useLayoutEffect(() => {
    measure();
  }, [measure]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-8 items-center rounded-xl border border-border bg-background/50 p-0.5"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0.5 top-0.5 rounded-lg gradient-btn shadow-xs transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: indicator.width,
          opacity: indicator.ready ? 1 : 0,
        }}
      />
      {modes.map((mode) => {
        const isActive = value === mode || (mode === 'flat' && value === 'suite');
        return (
          <button
            key={mode}
            ref={(el) => {
              buttonRefs.current[mode] = el;
            }}
            type="button"
            onClick={() => onChange(mode)}
            className={cn(
              'relative z-10 flex h-full min-w-[68px] px-3.5 items-center justify-center rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer select-none',
              isActive ? 'text-white font-semibold' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {mode}
          </button>
        );
      })}
    </div>
  );
}


const QUICK_STATUS_OPTIONS: {
  label: string;
  value: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP' | 'INVALID';
  icon: React.ElementType;
  className: string;
}[] = [
  { label: 'Pass', value: 'PASS', icon: Check, className: 'text-emerald-400 hover:bg-emerald-500/15' },
  { label: 'Fail', value: 'FAIL', icon: X, className: 'text-rose-400 hover:bg-rose-500/15' },
  { label: 'Blocked', value: 'BLOCKED', icon: Ban, className: 'text-amber-400 hover:bg-amber-500/15' },
  { label: 'Skip', value: 'SKIP', icon: SkipForward, className: 'text-zinc-300 hover:bg-zinc-500/15' },
  { label: 'Invalid', value: 'INVALID', icon: AlertTriangle, className: 'text-violet-400 hover:bg-violet-500/15' },
];

export interface RunDeckProps {
  slug: string;
  runId: string;
  run: any;
  results: any[];
  onResultsChange: (r: any[]) => void;
  refetchResults: () => Promise<void>;
  getCase: (id: string) => any;
  progress: Record<string, number>;
  currentUser: any;
  members: any[];
  suites: any[];
  cases: any[];
  modules: any[];
  runs: any[];
  /** Refresh the run header after mutations (name/environment/status). */
  onRunUpdated?: () => void | Promise<void>;
}

export function RunDeck(props: RunDeckProps) {
  const {
    slug, runId, run, results, refetchResults,
    getCase, progress, currentUser, members, suites, cases, modules, runs,
    onRunUpdated
  } = props;

  const router = useRouter();
  const { setRuns } = useProjectData();

  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [actionCase, setActionCase] = useState<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const moreActionsRef = useRef<HTMLDivElement>(null);
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<RunGroupBy>(
    () => (String(run?.source || 'manual') === 'manual' ? 'module' : 'flat') as RunGroupBy
  );
  const [caseType, setCaseType] = useState<RunCaseTypeFilter>('all');
  const [assigneeFilters, setAssigneeFilters] = useState<string[]>([]);
  const [priorityFilters, setPriorityFilters] = useState<string[]>([]);
  const [prioritySort, setPrioritySort] = useState<'asc' | 'desc' | null>(null);
  const runDefaultGroupBy = (String(run?.source || 'manual') === 'manual'
    ? 'module'
    : 'flat') as RunGroupBy;

  // Restore the tester's last view for this run (kept until they clear it).
  useEffect(() => {
    const saved = loadRunViewFilters(runId, runDefaultGroupBy);
    // Restoring the persisted view is a one-time sync from sessionStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCaseType(saved.caseType);
    setAssigneeFilters(saved.assignees);
    setPriorityFilters(saved.priorities);
    setStatusFilters(saved.statuses);
    setGroupBy(saved.groupBy);
    // The run identity is the only restore trigger; user edits must not be reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
  const [viewingIterationsResult, setViewingIterationsResult] = useState<any | null>(null);
  const [expandedIters, setExpandedIters] = useState<Set<string>>(new Set());
  const [expandAllIters, setExpandAllIters] = useState(false);
  const [editingModalAssigneeIter, setEditingModalAssigneeIter] = useState<number | null>(null);
  const [selectedIterIndices, setSelectedIterIndices] = useState<Set<number>>(new Set());
  const [assignItersResult, setAssignItersResult] = useState<any | null>(null);

  const toggleModuleCollapse = (moduleName: string) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleName)) next.delete(moduleName);
      else next.add(moduleName);
      return next;
    });
  };

  const [openGroupActionsId, setOpenGroupActionsId] = useState<string | null>(null);
  const [openRowMenuId, setOpenRowMenuId] = useState<string | null>(null);
  const [startingRun, setStartingRun] = useState(false);
  const [startingCaseIds, setStartingCaseIds] = useState<Set<string>>(new Set());

  const isExternalRun = run?.source === 'postman' || run?.source === 'datadog';
  const isAutomatedFlowRun =
    isExternalRun || run?.source === 'mixed' || run?.source === 'automated';
  const hasAutomatedCasesInRun = useMemo(
    () =>
      results.some((r) => {
        const tc = getCase(r.testCaseId);
        return tc ? isAutomatedCase(tc) : false;
      }),
    [results, getCase]
  );
  const pendingAutomatedCount = useMemo(
    () =>
      results.filter((r) => {
        if (String(r.status).toLowerCase() !== 'pending') return false;
        const tc = getCase(r.testCaseId);
        if (!tc) return false;
        const source = getCaseAutomationSource(tc);
        return source === 'postman' || source === 'datadog';
      }).length,
    [results, getCase]
  );
  const hasPendingAutomatedCases = useMemo(
    () =>
      results.some((r) => {
        if (String(r.status).toLowerCase() !== 'pending') return false;
        const tc = getCase(r.testCaseId);
        if (!tc || !isAutomatedCase(tc)) return false;
        const source = getCaseAutomationSource(tc);
        return source === 'postman' || source === 'datadog';
      }),
    [results, getCase]
  );
  // Cases that a stop cancelled. They can be continued as new attempts.
  const cancelledAutomatedCount = useMemo(
    () =>
      results.filter((r) => {
        if (String(r.status).toLowerCase() !== 'cancelled') return false;
        const tc = getCase(r.testCaseId);
        if (!tc) return false;
        const source = getCaseAutomationSource(tc);
        return source === 'postman' || source === 'datadog';
      }).length,
    [results, getCase]
  );
  const derivedRunState = useMemo(() => deriveRunState(run, results), [run, results]);
  const hasRunningCase = results.some(
    (r) => String(r.status).toLowerCase() === 'pending' && getCaseRunState(r) === 'RUNNING'
  );
  const hasQueuedCase = results.some(
    (r) => String(r.status).toLowerCase() === 'pending' && getCaseRunState(r) === 'QUEUED'
  );
  // A run stays in the working header until it is explicitly finished. All
  // cases settling makes Finish Run the primary action; it only switches to
  // View Report after the persisted status is completed/aborted.
  const showInProgressHeader = isAutomatedFlowRun
    ? run.status !== 'completed' && run.status !== 'aborted'
    : run.status === 'in_progress';

  const failedCaseCount = results.filter((r) =>
    ['fail', 'error', 'blocked', 'invalid', 'unavailable'].includes(
      String(r.status || '').toLowerCase()
    )
  ).length;

  const handleRerunFailed = async () => {
    if (!isAutomatedFlowRun || startingRun) return;
    setStartingRun(true);
    try {
      const res = await rerunRunCasesAction(runId, 'rerun-failed');
      await refetchResults();
      await onRunUpdated?.();
      toast.success(
        res?.queued
          ? `${res.queued} failed case${res.queued === 1 ? '' : 's'} queued as new attempts`
          : 'No failed cases to rerun'
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to rerun failed cases');
    } finally {
      setStartingRun(false);
    }
  };

  const handleResumeRun = async () => {
    if (!isAutomatedFlowRun || startingRun) return;
    setStartingRun(true);
    try {
      const res = await resumeExternalRunCasesAction(runId);
      await refetchResults();
      await onRunUpdated?.();
      toast.success(
        res?.queued
          ? `${res.queued} cancelled case${res.queued === 1 ? '' : 's'} queued as new attempts`
          : 'Nothing to resume'
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to resume run');
    } finally {
      setStartingRun(false);
    }
  };

  const handleStartRun = async () => {
    if (!isAutomatedFlowRun || startingRun) return;
    setStartingRun(true);
    try {
      const res = await startExternalRunCasesAction(runId);
      await refetchResults();
      await onRunUpdated?.();
      toast.success(
        res?.queued
          ? `${res.queued} case${res.queued === 1 ? '' : 's'} queued`
          : 'No cases left to start'
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to start run');
    } finally {
      setStartingRun(false);
    }
  };

  const handleStartCase = async (result: any, mode: 'start' | 'rerun') => {
    if (!isAutomatedFlowRun) return;
    setStartingCaseIds((prev) => new Set(prev).add(result.id));
    try {
      // Re-running a finished/cancelled case creates a fresh attempt, exactly
      // like the existing single-case reset, then queues only that attempt.
      let targetId = result.id;
      if (mode === 'rerun' || getCaseRunState(result) === 'CANCELLED') {
        const reset = await resetSingleResultAction(result.id);
        targetId = reset.newResultId;
      }

      await startExternalRunCasesAction(runId, [targetId]);
      await refetchResults();
      await onRunUpdated?.();
      toast.success(mode === 'rerun' ? 'Case queued for rerun' : 'Case queued');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to start case');
    } finally {
      setStartingCaseIds((prev) => {
        const next = new Set(prev);
        next.delete(result.id);
        return next;
      });
    }
  };

  const handleSetQuickStatus = async (resultId: string, status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP' | 'INVALID') => {
    try {
      const target = results.find((r) => r.id === resultId);
      if (target && target.status !== 'pending') {
        toast.info('Test case has already been executed. Use Re-run from the ••• menu to test again.');
        return;
      }

      await updateRunResultAction(resultId, {
        status,
        executedBy: currentUser?.id || 1,
        assignedTo: target?.assignedTo || currentUser?.id,
        timeSpentSeconds: target?.timeSpentSeconds ?? 0,
        source: 'list',
      });
      apiClient.invalidate(`/api/v1/runs/${encodeURIComponent(runId)}/results`);
      await refetchResults();
      toast.success(`Marked as ${status}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status');
    }
  };

  const [hoverStatusId, setHoverStatusId] = useState<string | null>(null);
  const [openFilterGroup, setOpenFilterGroup] = useState<'status' | 'priority' | 'assignee' | null>('status');
  const [assigneeSearch, setAssigneeSearch] = useState('');

  const updateViewFilters = (patch: Partial<RunViewFilters>) => {
    if (patch.caseType !== undefined) setCaseType(patch.caseType);
    if (patch.assignees !== undefined) setAssigneeFilters(patch.assignees);
    if (patch.priorities !== undefined) setPriorityFilters(patch.priorities);
    if (patch.statuses !== undefined) setStatusFilters(patch.statuses);
    if (patch.groupBy !== undefined) setGroupBy(patch.groupBy);
    patchRunViewFilters(runId, patch, runDefaultGroupBy);
  };

  const toggleFromList = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const activeFilterCount =
    statusFilters.length +
    priorityFilters.length +
    assigneeFilters.length +
    (caseType !== 'all' ? 1 : 0);

  const hasActiveFilters = activeFilterCount > 0;

  const clearFilters = () =>
    updateViewFilters({
      caseType: 'all',
      assignedToMe: false,
      assignee: '',
      priority: '',
      status: '',
      assignees: [],
      priorities: [],
      statuses: [],
    });

  /** Everyone who can be assigned work in this project, for the filter menu. */
  const assigneeOptions = useMemo(
    () =>
      members
        .map((m: any) => {
          const user = m.user || m;
          const id = String(m.userId ?? user?.id ?? '');
          return { value: id, label: user?.name || user?.email || `User #${id}` };
        })
        .filter((o: { value: string }) => Boolean(o.value))
        .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)),
    [members]
  );

  // Manual vs automated counts for the segmented filter (link metadata wins,
  // matching how the execution lanes classify cases).
  const caseTypeCounts = useMemo(() => {
    let manual = 0;
    let automated = 0;
    for (const r of results) {
      const tc = getCase(r.testCaseId);
      if (!tc) continue;
      if (isAutomatedCase(tc)) automated += 1;
      else manual += 1;
    }
    return { all: manual + automated, manual, automated };
  }, [results, getCase]);


  // Group results by module, suite, status, or flat
  const resultsByGroup = useMemo(() => {
    if (groupBy === 'flat') {
      return [{ moduleName: 'All Test Cases', moduleId: 'all', results }];
    }

    if (groupBy === 'status') {
      const buckets: Array<{
        id: string;
        name: string;
        matches: (status: string) => boolean;
      }> = [
        { id: 'failed', name: 'Failed', matches: (s) => s === 'fail' },
        { id: 'error', name: 'Script error', matches: (s) => s === 'error' },
        {
          id: 'blocked',
          name: "Couldn't run",
          matches: (s) => s === 'blocked' || s === 'invalid' || s === 'unavailable',
        },
        { id: 'not-run', name: 'Not run', matches: (s) => s === 'pending' },
        { id: 'passed', name: 'Passed', matches: (s) => s === 'pass' || s === 'skip' },
      ];
      return buckets
        .map((bucket) => ({
          moduleName: bucket.name,
          moduleId: bucket.id,
          results: results.filter((r) => bucket.matches(String(r.status || '').toLowerCase())),
        }))
        .filter((group) => group.results.length > 0);
    }

    if (groupBy === 'priority') {
      return ['P0', 'P1', 'P2', 'P3']
        .map((p) => ({
          moduleName: `Priority ${p}`,
          moduleId: `priority-${p}`,
          results: results.filter((r) => getCase(r.testCaseId)?.priority === p),
        }))
        .filter((group) => group.results.length > 0);
    }

    if (groupBy === 'suite') {
      const groups: { moduleName: string; moduleId: string | null; results: any[] }[] = [];
      const suiteMap = new Map<string | null, any[]>();

      for (const result of results) {
        const tc = getCase(result.testCaseId);
        if (!tc) continue;
        const matchedSuite = suites.find((s: any) =>
          s.suite_cases?.some((sc: any) => sc.test_case_id === tc.id || sc.test_case?.id === tc.id)
        );
        const key = matchedSuite?.id || null;
        if (!suiteMap.has(key)) suiteMap.set(key, []);
        suiteMap.get(key)!.push(result);
      }

      for (const [suiteId, rs] of suiteMap) {
        if (suiteId) {
          const sObj = suites.find((s: any) => s.id === suiteId);
          groups.push({ moduleName: sObj?.name || 'Suite', moduleId: suiteId, results: rs });
        } else {
          groups.push({ moduleName: 'No Suite', moduleId: null, results: rs });
        }
      }

      groups.sort((a, b) => {
        if (a.moduleId === null) return 1;
        if (b.moduleId === null) return -1;
        return a.moduleName.localeCompare(b.moduleName);
      });
      return groups;
    }

    // Default: Group by module
    const groups: { moduleName: string; moduleId: string | null; results: any[] }[] = [];
    const moduleMap = new Map<string | null, any[]>();

    for (const result of results) {
      const tc = getCase(result.testCaseId);
      if (!tc) continue;

      const key = tc.moduleId || null;
      if (!moduleMap.has(key)) moduleMap.set(key, []);
      moduleMap.get(key)!.push(result);
    }

    for (const [moduleId, rs] of moduleMap) {
      if (moduleId) {
        const mod = modules.find((m: any) => m.id === moduleId);
        groups.push({ moduleName: mod?.name || 'Unknown', moduleId, results: rs });
      } else {
        groups.push({ moduleName: 'Unassigned', moduleId: null, results: rs });
      }
    }

    // Sort groups alphabetically, but keep Unassigned at the bottom
    groups.sort((a, b) => {
      if (a.moduleId === null) return 1;
      if (b.moduleId === null) return -1;
      return a.moduleName.localeCompare(b.moduleName);
    });

    return groups;
  }, [results, getCase, modules, suites, groupBy]);

  // Filtered results
  const filteredResultsByModule = useMemo(() => {
    const priorityWeight: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const q = search.toLowerCase();

    return resultsByGroup.map((group) => {
      let filtered = group.results.filter((r) => {
        const tc = getCase(r.testCaseId);
        if (!tc) return false;
        const matchesSearch =
          !q || tc.title?.toLowerCase().includes(q) || tc.displayId?.toLowerCase().includes(q);

        const isRerun = r.status === 'pending' && r.attemptNumber && r.attemptNumber > 1;
        const isStarted =
          r.status === 'pending' &&
          (String(r.caseState || '').toUpperCase() === 'RUNNING' ||
            (r.timeSpentSeconds && r.timeSpentSeconds > 0));
        const isPending = r.status === 'pending' && !isStarted;
        const matchesStatus =
          statusFilters.length === 0 ||
          statusFilters.some((f) => {
            if (f === 'rerun') return !!isRerun;
            if (f === 'started') return !!isStarted;
            if (f === 'pending') return !!isPending;
            if (f === 'unavailable') return r.status === 'unavailable';
            return r.status === f;
          });

        const matchesAssignee =
          assigneeFilters.length === 0 ||
          assigneeFilters.some((f) =>
            f === 'unassigned' ? r.assignedTo == null : String(r.assignedTo) === f
          );
        const matchesPriority =
          priorityFilters.length === 0 ||
          priorityFilters.includes(String(tc.priority || '').toUpperCase());
        const isAutomated = isAutomatedCase(tc);
        const matchesCaseType =
          caseType === 'all' || (caseType === 'manual' ? !isAutomated : isAutomated);
        return (
          matchesSearch &&
          matchesStatus &&
          matchesAssignee &&
          matchesPriority &&
          matchesCaseType
        );
      });

      if (prioritySort) {
        filtered.sort((a, b) => {
          const tc_a = getCase(a.testCaseId);
          const tc_b = getCase(b.testCaseId);
          const pA = tc_a?.priority || 'Z';
          const pB = tc_b?.priority || 'Z';
          if (pA === pB) return 0;
          return prioritySort === 'asc' ? pA.localeCompare(pB) : pB.localeCompare(pA);
        });
      }

      return {
        ...group,
        results: filtered,
      };
    }).filter((g) => g.results.length > 0);
  }, [resultsByGroup, search, statusFilters, assigneeFilters, priorityFilters, caseType, prioritySort, getCase]);

  const total = results.length;
  const completedCount = (progress.pass || 0) + (progress.fail || 0) + (progress.error || 0) + (progress.blocked || 0) + (progress.skip || 0) + (progress.invalid || 0);
  const pendingCount = (progress.pending || 0) + (progress.started || 0) + (progress.rerun || 0);
  const completedPct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const passRate = total > 0 ? Math.round(((progress.pass || 0) / total) * 100) : 0;
  const allCasesHaveFinalResult = total > 0 && completedCount === total;

  // Header line 2: one plain sentence, not a metadata row.
  const headerCreator = useMemo(() => {
    const uid = Number(run?.createdBy || 0);
    if (!uid) return null;
    const member = members.find(
      (m: any) => Number(m.userId ?? m.user?.id) === uid
    );
    return member?.user || member || null;
  }, [run?.createdBy, members]);

  const { automatedTotal, automatedDone, manualTotal, manualPending } = useMemo(() => {
    let automatedTotal = 0;
    let automatedDone = 0;
    let manualTotal = 0;
    let manualPending = 0;
    for (const r of results) {
      const tc = getCase(r.testCaseId);
      if (!tc) continue;
      const isManual = getCaseAutomationSource(tc) === 'manual';
      const state = String(r.status || '').toLowerCase();
      if (isManual) {
        manualTotal++;
        if (state === 'pending') manualPending++;
      } else {
        automatedTotal++;
        if (FRUITION_DONE.has(state)) automatedDone++;
      }
    }
    return { automatedTotal, automatedDone, manualTotal, manualPending };
  }, [results, getCase]);

  const runStatusChip = useMemo<{ label: string; tone: StatusPillTone } | null>(() => {
    if (derivedRunState === 'IN_PROGRESS')
      return hasRunningCase
        ? { label: 'Running', tone: 'running' }
        : { label: 'In progress', tone: 'running' };
    if (derivedRunState === 'STOPPED') return { label: 'Stopped', tone: 'blocked' };
    if (derivedRunState === 'PARTIALLY_RUN') return { label: 'In progress', tone: 'running' };
    if (derivedRunState === 'NOT_STARTED') return { label: 'Not started', tone: 'pending' };
    if (run?.status === 'aborted') return { label: 'Aborted', tone: 'cancelled' };
    return null;
  }, [derivedRunState, run?.status, hasRunningCase]);


  // Map each result.id to its 1-based sequential run index across all modules
  const resultIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let count = 1;
    for (const group of filteredResultsByModule) {
      for (const r of group.results) {
        map.set(r.id, count++);
      }
    }
    return map;
  }, [filteredResultsByModule]);

  const priorityCounts = useMemo(() => {
    const counts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
    results.forEach((r) => {
      const p = String(getCase(r.testCaseId)?.priority || '').toUpperCase();
      if (p in counts) counts[p] += 1;
    });
    return counts;
  }, [results, getCase]);

  const assigneeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    results.forEach((r) => {
      if (r.assignedTo == null) return;
      const key = String(r.assignedTo);
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [results]);

  const unassignedCount = useMemo(
    () => results.filter((r) => r.assignedTo == null).length,
    [results]
  );

  // Iterations are optional; the bulk toggle only makes sense when at least
  // one case in this run resolved a multi-row dataset.
  const hasAnyIterationsInRun = useMemo(
    () =>
      results.some((r) => {
        const snap = (run as any)?.resolved_datasets?.[r.testCaseId];
        const tc: any = getCase(r.testCaseId);
        const ds = snap || tc?.dataset || tc?.local_dataset || tc?.localDataset;
        return Boolean(ds && Array.isArray(ds.rows) && ds.rows.length > 1);
      }),
    [results, run, getCase]
  );


  // Selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInGroup = (ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  // Actions
  const handleAssign = async (userId: number) => {
    const ids = actionCase ? [actionCase.id] : Array.from(selectedIds);
    for (const id of ids) {
      await assignRunResultAction(id, userId);
    }
    await refetchResults();
    setSelectedIds(new Set());
    setShowAssignDialog(false);
    setActionCase(null);
    toast.success('Assigned');
  };

  const handleUnassign = async (ids?: string[]) => {
    const target = ids || (actionCase ? [actionCase.id] : Array.from(selectedIds));
    for (const id of target) {
      await unassignRunResultAction(id);
    }
    await refetchResults();
    setSelectedIds(new Set());
    setActionCase(null);
    toast.success('Unassigned');
  };

  const [bulkBusy, setBulkBusy] = useState(false);

  /** Apply one manual verdict to every selected case. */
  const handleBulkStatus = async (status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP' | 'INVALID') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await bulkSetRunResultStatusAction(ids, {
        status,
        executedBy: currentUser?.id || 1,
        // 'list' marks the verdict as a manual override, exactly like the
        // single-case quick status action.
        source: 'list',
      });
      await refetchResults();
      setSelectedIds(new Set());
      if (res.updated === 0) {
        toast.info('No selected case could take a manual verdict (already executed or running).');
      } else {
        toast.success(
          res.skipped > 0
            ? `${res.updated} marked ${status} · ${res.skipped} skipped (already executed or running)`
            : `${res.updated} marked ${status}`
        );
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update status');
    } finally {
      setBulkBusy(false);
    }
  };

  /** Create a fresh attempt for every selected case and queue the automated ones. */
  const handleBulkRerun = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await bulkRerunRunResultsAction(runId, ids);
      await refetchResults();
      setSelectedIds(new Set());
      toast.success(
        res.created === 0
          ? 'No selected case could be re-run (they are still running).'
          : `${res.created} queued as new attempt${res.created === 1 ? '' : 's'}` +
            (res.queued > 0 ? ` · ${res.queued} started` : '')
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to re-run cases');
    } finally {
      setBulkBusy(false);
    }
  };

  /** Remove every selected case from the run (after confirmation). */
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await bulkDeleteRunResultsAction(ids);
      await refetchResults();
      setSelectedIds(new Set());
      toast.success(`${res.cases} removed from run`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove cases from run');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteRunResultAction(id);
    refetchResults();
    setShowDeleteConfirm(null);
    toast.success('Removed from run');
  };

  const handleSkipPending = async () => {
    if (!currentUser) return;
    const totalPending = pendingCount;
    if (totalPending === 0) {
      toast.info('No remaining cases to skip');
      return;
    }
    setConfirmConfig({
      open: true,
      title: 'Skip Remaining Cases',
      description: `Are you sure you want to skip all ${totalPending} remaining test case${totalPending > 1 ? 's' : ''}?`,
      confirmLabel: 'Skip Remaining',
      onConfirm: async () => {
        await bulkUpdateRunResultStatusAction(runId, {
          status: 'SKIP',
          executedBy: currentUser.id,
          source: 'manual',
        });
        await refetchResults();
        toast.success(`${totalPending} remaining cases skipped`);
      },
    });
  };

  const handleFinishRun = async () => {
    const totalPending = pendingCount;
    if (totalPending > 0) {
      setConfirmConfig({
        open: true,
        title: 'Finish Test Run?',
        description: `There ${totalPending === 1 ? 'is' : 'are'} ${totalPending} uncompleted test case${totalPending > 1 ? 's' : ''} remaining. Finishing the run will automatically mark all remaining cases as Skipped and complete the run.`,
        confirmLabel: 'Skip Remaining & Finish',
        variant: 'default',
        onConfirm: async () => {
          try {
            await bulkUpdateRunResultStatusAction(runId, {
              status: 'SKIP',
              executedBy: currentUser?.id || 1,
              source: 'manual',
            });
            await finishRunAction(runId);
            toast.success('Run finished with remaining cases skipped');
            router.push(`/p/${slug}/runs/${runId}/report`);
          } catch (e: any) {
            toast.error(e.message || 'Failed to finish run');
          }
        },
      });
      return;
    }

    try {
      await finishRunAction(runId);
      toast.success('Run completed');
      router.push(`/p/${slug}/runs/${runId}/report`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to finish run');
    }
  };

  const [confirmConfig, setConfirmConfig] = useState<{ open: boolean; title: string; description: string; confirmLabel?: string; variant?: 'default' | 'destructive'; requireTypedConfirmation?: string; onConfirm: () => void } | null>(null);

  /**
   * Rerun every case as a *new attempt*. Previous attempts stay in the history;
   * nothing is reset in place.
   */
  const handleRerun = async () => {
    if (startingRun) return;
    setStartingRun(true);
    try {
      const res = await rerunRunCasesAction(runId, 'rerun-all');
      await refetchResults();
      await onRunUpdated?.();
      toast.success(
        res?.queued
          ? `${res.queued} case${res.queued === 1 ? '' : 's'} queued as new attempts`
          : 'Nothing to rerun'
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to rerun cases');
    } finally {
      setStartingRun(false);
    }
  };

  const handleClone = async () => {
    if (!currentUser) { toast.error('Not authenticated'); return; }
    setCloneForm({ name: `${run.name} (Copy)`, environment: run.environment, assignee: run.assignedTo || '', cloneAssignments: false });
    setShowCloneDialog(true);
  };

  const confirmClone = async () => {
    if (!currentUser) return;
    setCloneBusy(true);
    try {
      const cloned = await cloneTestRunAction(runId, currentUser.id, {
        name: cloneForm.name,
        environment: cloneForm.environment,
        assignee: cloneForm.assignee ? Number(cloneForm.assignee) : undefined,
        cloneCaseAssignments: cloneForm.cloneAssignments,
      });
      toast.success(`Cloned as "${cloned.name}"`);
      setShowCloneDialog(false);
      router.push(`/p/${slug}/runs/${cloned.id}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to clone run');
    } finally {
      setCloneBusy(false);
    }
  };

  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneForm, setCloneForm] = useState({ name: '', environment: '', assignee: '', cloneAssignments: false });
  const [cloneBusy, setCloneBusy] = useState(false);

  const [showAbortConfirm, setShowAbortConfirm] = useState(false);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState<{ name: string; environment: string; buildVersion: string; assignedTo: number | null }>({
    name: '',
    environment: '',
    buildVersion: '',
    assignedTo: null,
  });
  const [editBusy, setEditBusy] = useState(false);

  const [showAddCasesDialog, setShowAddCasesDialog] = useState(false);
  const [addCasesSearch, setAddCasesSearch] = useState('');
  const [addCasesModuleFilter, setAddCasesModuleFilter] = useState('');
  const [addCasesSuiteFilter, setAddCasesSuiteFilter] = useState('');
  const [addCasesPriorityFilter, setAddCasesPriorityFilter] = useState('');
  const [addCasesSelected, setAddCasesSelected] = useState<Set<string>>(new Set());
  const [addCasesBusy, setAddCasesBusy] = useState(false);
  const lastClickedAddCaseIndexRef = useRef<number | null>(null);

  const handleDeleteRun = () => {
    setConfirmConfig({
      open: true,
      title: 'Delete Test Run?',
      description: `Are you sure you want to delete "${run.name}"? It will be removed from your active runs. Its execution history is preserved.`,
      confirmLabel: 'Delete Run',
      variant: 'destructive',
      requireTypedConfirmation: 'DELETE',
      onConfirm: async () => {
        try {
          await archiveTestRunAction(runId);
          setRuns(runs.filter((r: any) => r.id !== runId));
          toast.success('Run deleted');
          router.push(`/p/${slug}/runs`);
        } catch (e: any) {
          toast.error(e.message || 'Failed to delete run');
        }
      },
    });
  };

  const handleAbort = async () => {
    try {
      await abortRunAction(runId);
      toast.success('Run aborted');
      setShowAbortConfirm(false);
      refetchResults();
    } catch (e: any) {
      toast.error(e.message || 'Failed to abort run');
    }
  };

  const handleEditRun = async () => {
    setEditBusy(true);
    try {
      await updateTestRunAction(runId, {
        name: editForm.name,
        environment: editForm.environment,
        buildVersion: editForm.buildVersion || undefined,
        assignedTo: editForm.assignedTo,
      });
      toast.success('Run updated');
      setShowEditDialog(false);
      await onRunUpdated?.();
      refetchResults();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update run');
    } finally {
      setEditBusy(false);
    }
  };

  const handleAddCases = async () => {
    if (addCasesSelected.size === 0) { toast.error('Select cases to add'); return; }
    setAddCasesBusy(true);
    try {
      const result = await addCasesToRunAction(runId, Array.from(addCasesSelected));
      toast.success(`Added ${result.added} case(s)`);
      setShowAddCasesDialog(false);
      setAddCasesSelected(new Set());
      setAddCasesSearch('');
      setAddCasesModuleFilter('');
      setAddCasesSuiteFilter('');
      setAddCasesPriorityFilter('');
      refetchResults();
    } catch (e: any) {
      toast.error(e.message || 'Failed to add cases');
    } finally {
      setAddCasesBusy(false);
    }
  };

  const handleRerunCase = async (resultId: string) => {
    setStartingCaseIds((prev) => new Set(prev).add(resultId));
    try {
      await resetSingleResultAction(resultId);
      toast.success('Case re-run queued');
      refetchResults();
    } catch (e: any) {
      toast.error(e.message || 'Failed to re-run case');
    } finally {
      setStartingCaseIds((prev) => {
        const next = new Set(prev);
        next.delete(resultId);
        return next;
      });
    }
  };

  const openCaseDetail = (testCase: { displayId?: string | null; id: string }) => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('run_deck_scroll_y', String(window.scrollY));
    }
    router.push(`/p/${slug}/runs/${runId}/${testCase.displayId || testCase.id}`);
  };

  const getMemberForCase = (userId: number | null) => {
    if (!userId) return null;
    return members.find((m: any) => m.userId === userId || m.user?.id === userId)?.user || null;
  };

  const runSuite = useMemo(() => {
    if (!run) return null;
    return suites.find((s: any) => s.id === run.suiteId || s.id === run.suite_id) || null;
  }, [run, suites]);

  const headerActions = (
    <div className="flex items-center gap-2 shrink-0">
      {run.status !== 'completed' ? (
        <>
          {hasRunningCase || hasQueuedCase ? (
            <Button size="sm" onClick={async () => { try { await stopRunExecutionAction(runId, false); await refetchResults(); await onRunUpdated?.(); toast.success('Run stopped'); } catch(e:any) { toast.error(e.message || 'Failed'); } }} className="gradient-btn text-white h-8 text-xs px-3 shadow-sm gap-1.5 cursor-pointer"><Pause className="h-3.5 w-3.5" /> Stop</Button>
          ) : isAutomatedFlowRun && hasPendingAutomatedCases && (derivedRunState === 'NOT_STARTED' || derivedRunState === 'PARTIALLY_RUN' || derivedRunState === 'STOPPED') ? (
            <Button size="sm" onClick={handleStartRun} disabled={startingRun} className="gradient-btn text-white h-8 text-xs px-3 shadow-sm gap-1.5 disabled:opacity-60 cursor-pointer">{startingRun ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start auto</Button>
          ) : isAutomatedFlowRun && cancelledAutomatedCount > 0 ? (
            <Button size="sm" onClick={handleResumeRun} disabled={startingRun} className="gradient-btn text-white h-8 text-xs px-3 shadow-sm gap-1.5 disabled:opacity-60 cursor-pointer">{startingRun ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Resume</Button>
          ) : (
            <Button size="sm" onClick={handleFinishRun} className="gradient-btn text-white h-8 text-xs px-3.5 font-semibold shadow-sm cursor-pointer">Finish Run</Button>
          )}
        </>
      ) : (
        <Button size="sm" onClick={() => router.push(`/p/${slug}/runs/${run.id}/report`)} className="gradient-btn text-white h-8 text-xs px-3.5 font-semibold shadow-sm cursor-pointer">View Report</Button>
      )}

      {isAutomatedFlowRun && failedCaseCount > 0 && (
        <Button variant="outline" size="sm" disabled={startingRun} onClick={() => void handleRerunFailed()} className="h-8 text-xs px-2.5 text-rose-500 border-rose-500/30 hover:bg-rose-500/10 cursor-pointer shadow-sm gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Rerun Failed</Button>
      )}

      {/* More Options */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 text-muted-foreground bg-background/50 cursor-pointer shadow-sm">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setShowAddCasesDialog(true)} disabled={run.status !== 'in_progress'} className="gap-2 text-xs cursor-pointer"><Plus className="h-3.5 w-3.5" /> Add Cases</DropdownMenuItem>
          {hasAnyIterationsInRun && (
            <DropdownMenuItem onSelect={() => { setExpandAllIters((p) => !p); }} className="gap-2 text-xs cursor-pointer"><Layers className="h-3.5 w-3.5" /> {expandAllIters ? 'Collapse all iterations' : 'Expand all iterations'}</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { setEditForm({ name: run.name, environment: run.environment, buildVersion: run.buildVersion || '', assignedTo: run.assignedTo || null }); setShowEditDialog(true); }} className="gap-2 text-xs cursor-pointer"><Edit className="h-3.5 w-3.5" /> Edit Run</DropdownMenuItem>
          <DropdownMenuItem onSelect={handleClone} className="gap-2 text-xs cursor-pointer"><Copy className="h-3.5 w-3.5" /> Clone Run</DropdownMenuItem>
          <DropdownMenuItem onSelect={handleRerun} className="gap-2 text-xs cursor-pointer"><RotateCcw className="h-3.5 w-3.5" /> Rerun All Cases</DropdownMenuItem>
          <DropdownMenuItem disabled={pendingCount === 0} onSelect={handleSkipPending} className="gap-2 text-xs cursor-pointer"><SkipForward className="h-3.5 w-3.5" /> Skip Remaining</DropdownMenuItem>
          {isAutomatedFlowRun && <DropdownMenuItem onSelect={() => void refetchResults()} className="gap-2 text-xs cursor-pointer"><RefreshCw className="h-3.5 w-3.5" /> Refresh Status</DropdownMenuItem>}
          {!allCasesHaveFinalResult && <DropdownMenuItem onSelect={handleFinishRun} className="gap-2 text-xs cursor-pointer"><CheckCircle className="h-3.5 w-3.5" /> Finish Run</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { setShowAbortConfirm(true); }} className="gap-2 text-xs text-amber-500 focus:text-amber-500 cursor-pointer"><Ban className="h-3.5 w-3.5" /> Abort Run</DropdownMenuItem>
          <DropdownMenuItem onSelect={handleDeleteRun} className="gap-2 text-xs text-rose-500 focus:text-rose-500 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /> Delete Run</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="shrink-0 px-4 md:px-6 py-3.5 border-b bg-background w-full">
        <div className="flex flex-row items-stretch justify-between gap-3 w-full">
          {/* Left Column: Title -> Metadata -> Toolbar */}
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            {/* Title */}
            <div className="flex items-center gap-2.5 min-w-0">
              <Button variant="ghost" size="sm" onClick={() => router.push(`/p/${slug}/runs`)} className="-ml-2 px-2 text-muted-foreground hover:text-foreground shrink-0">
                <ArrowLeft className="h-4 w-4 lg:mr-1" />
                <span className="hidden lg:inline">Runs</span>
              </Button>
              <div className="hidden lg:block h-4 w-px bg-border shrink-0" />
              <Tooltip
                content={run.name}
                onlyOnOverflow
                wrapperClassName="min-w-0 max-w-[14rem] sm:max-w-md lg:max-w-2xl"
              >
                <h1 className="block w-full truncate text-xl leading-8 font-bold text-foreground tracking-tight">
                  {run.name}
                </h1>
              </Tooltip>
            </div>

            {/* Subtitle */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap min-w-0">
              <span className="flex items-center gap-1">
                Started{headerCreator ? ' by' : ''}
                {headerCreator && (
                  <>
                    <UserAvatar
                      userId={headerCreator.id}
                      name={headerCreator.name}
                      email={headerCreator.email}
                      imageUrl={headerCreator.avatarUrl || headerCreator.image}
                      size="sm"
                      className="h-4 w-4 text-[8px] ml-0.5"
                    />
                    <span className="font-medium text-foreground/80">{headerCreator.name?.split(' ')[0] || 'User'}</span>
                  </>
                )}
              </span>
              {run.startedAt && (
                <span>
                  {'· '}
                  {new Date(run.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {run.environment && (
                <>
                  <span className="mx-0.5 opacity-40">·</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-border/60 bg-muted/40 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                    {run.environment}
                  </span>
                </>
              )}
              {runStatusChip && (
                <>
                  <span className="mx-0.5 opacity-40">·</span>
                  <StatusPill tone={runStatusChip.tone}>{runStatusChip.label}</StatusPill>
                </>
              )}
              {(run.runContext?.adhoc || run.run_context?.adhoc) && (
                <>
                  <span className="mx-0.5 opacity-40">·</span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-border/60 bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0" title="Ad-hoc single-case run; excluded from quality trends">
                    Ad-hoc
                  </span>
                </>
              )}
              {runSuite && (
                <>
                  <span className="mx-0.5 opacity-40">·</span>
                  <Link
                    href={`/p/${slug}/suites/${runSuite.id}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/25 hover:border-indigo-500/50 hover:bg-indigo-500/15 transition-all shadow-2xs"
                    title={`Linked Suite: ${runSuite.name}`}
                  >
                    <Layers className="h-3 w-3 text-indigo-400 shrink-0" />
                    <span className="truncate max-w-[220px]">{runSuite.name}</span>
                  </Link>
                </>
              )}
              {isAutomatedFlowRun && manualTotal > 0 && automatedTotal > 0 && (
                <>
                  <span className="mx-1 opacity-40">|</span>
                  <span>Automated {automatedDone}/{automatedTotal}</span>
                  <span>·</span>
                  <span>Manual {manualPending} pending</span>
                </>
              )}
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-2 flex-wrap min-w-0 w-full pt-1.5">
              <div className="relative flex-1 min-w-[160px] max-w-[220px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search cases..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 text-xs bg-background/50" />
              </div>

              <GroupingTabs
                value={groupBy}
                onChange={(mode) => updateViewFilters({ groupBy: mode })}
              />

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 text-xs font-medium px-2.5 h-8 rounded-lg border transition-all cursor-pointer",
                      hasActiveFilters
                        ? "border-primary/50 text-primary bg-primary/10"
                        : "border-border text-muted-foreground bg-background/50 hover:bg-muted"
                    )}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    <span>{hasActiveFilters ? `Filter · ${activeFilterCount}` : 'Filter'}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" sideOffset={6} collisionPadding={12} className="flex max-h-[min(60vh,480px)] w-[320px] flex-col overflow-hidden p-0">
                  <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Filters</span>
                    <button
                      type="button"
                      onClick={clearFilters}
                      disabled={!hasActiveFilters}
                      className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
                    >
                      Clear all
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                    <FilterSection
                      label="Status"
                      count={statusFilters.length}
                      open={openFilterGroup === 'status'}
                      onToggle={() => setOpenFilterGroup(openFilterGroup === 'status' ? null : 'status')}
                    >
                      {RUN_STATUS_FILTER_OPTIONS.filter(
                        (o) => o.value !== 'pending' || pendingCount > 0
                      )
                        .filter((o) => o.always || (progress[o.value] || 0) > 0)
                        .map((o) => (
                          <FilterOption
                            key={o.value}
                            selected={statusFilters.includes(o.value)}
                            onClick={() =>
                              updateViewFilters({ statuses: toggleFromList(statusFilters, o.value) })
                            }
                          >
                            <span className="flex items-center gap-1.5">
                              <span className={cn('h-1.5 w-1.5 rounded-full', o.dot)} />
                              <span>{o.label}</span>
                            </span>
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                              {o.value === 'pending' ? pendingCount : progress[o.value] || 0}
                            </span>
                          </FilterOption>
                        ))}
                    </FilterSection>

                    <FilterSection
                      label="Priority"
                      count={priorityFilters.length}
                      open={openFilterGroup === 'priority'}
                      onToggle={() => setOpenFilterGroup(openFilterGroup === 'priority' ? null : 'priority')}
                    >
                      {(['P0', 'P1', 'P2', 'P3'] as const).map((p) => (
                        <FilterOption
                          key={p}
                          selected={priorityFilters.includes(p)}
                          onClick={() => updateViewFilters({ priorities: toggleFromList(priorityFilters, p) })}
                        >
                          <span className="flex items-center gap-1.5">
                            <PriorityBadge priority={p} showIcon={false} className="bg-transparent border-0 px-0" />
                            <span className="text-[11.5px] text-muted-foreground">{PRIORITY_CAPTION[p]}</span>
                          </span>
                          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                            {priorityCounts[p] || 0}
                          </span>
                        </FilterOption>
                      ))}
                    </FilterSection>

                    <FilterSection
                      label="Assignee"
                      count={assigneeFilters.length}
                      open={openFilterGroup === 'assignee'}
                      onToggle={() => setOpenFilterGroup(openFilterGroup === 'assignee' ? null : 'assignee')}
                    >
                      {assigneeOptions.length > 5 && (
                        <div className="pb-1.5">
                          <Input
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            placeholder="Search people..."
                            className="h-7 text-[11.5px]"
                          />
                        </div>
                      )}
                      <FilterOption
                        selected={assigneeFilters.includes('unassigned')}
                        onClick={() =>
                          updateViewFilters({ assignees: toggleFromList(assigneeFilters, 'unassigned') })
                        }
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-[9px] text-muted-foreground">
                            ?
                          </span>
                          <span>Unassigned</span>
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{unassignedCount}</span>
                      </FilterOption>
                      {assigneeOptions
                        .filter((o) =>
                          assigneeSearch.trim()
                            ? o.label.toLowerCase().includes(assigneeSearch.trim().toLowerCase())
                            : true
                        )
                        .map((o) => (
                          <FilterOption
                            key={o.value}
                            selected={assigneeFilters.includes(o.value)}
                            onClick={() =>
                              updateViewFilters({ assignees: toggleFromList(assigneeFilters, o.value) })
                            }
                          >
                            <span className="flex items-center gap-1.5">
                              <UserAvatar name={o.label} size="sm" className="h-4 w-4 text-[8px]" />
                              <span className="truncate">{o.label}</span>
                            </span>
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                              {assigneeCounts[o.value] || 0}
                            </span>
                          </FilterOption>
                        ))}
                    </FilterSection>

                    {isAutomatedFlowRun && manualTotal > 0 && automatedTotal > 0 && (
                      <div className="flex items-center justify-between rounded-lg border border-border/50 px-2.5 py-1.5">
                        <span className="text-[11.5px] font-semibold text-foreground">Type</span>
                        <div className="flex items-center gap-1">
                          {(['all', 'manual', 'automated'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => updateViewFilters({ caseType: t })}
                              className={cn(
                                'rounded-md px-2 py-0.5 text-[10.5px] font-medium capitalize transition-colors cursor-pointer',
                                caseType === t
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                              )}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
                    <span className="text-[10.5px] font-medium text-muted-foreground">
                      Showing {filteredResultsByModule.reduce((acc, m) => acc + m.results.length, 0)} of {total}
                    </span>
                    <PopoverClose asChild>
                      <Button size="sm" variant="ghost" className="h-7 px-3 text-xs font-semibold cursor-pointer">Done</Button>
                    </PopoverClose>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Active filter chips */}
              {hasActiveFilters && (
                <div className="flex items-center gap-1.5 flex-wrap ml-1">
                  {statusFilters.map((v) => (
                    <FilterChip
                      key={`status-${v}`}
                      label={RUN_STATUS_FILTER_OPTIONS.find((o) => o.value === v)?.label || v}
                      onRemove={() => updateViewFilters({ statuses: statusFilters.filter((x) => x !== v) })}
                    />
                  ))}
                  {priorityFilters.map((v) => (
                    <FilterChip
                      key={`priority-${v}`}
                      label={v}
                      onRemove={() => updateViewFilters({ priorities: priorityFilters.filter((x) => x !== v) })}
                    />
                  ))}
                  {assigneeFilters.map((v) => (
                    <FilterChip
                      key={`assignee-${v}`}
                      label={
                        v === 'unassigned'
                          ? 'Unassigned'
                          : assigneeOptions.find((o) => o.value === v)?.label || 'User'
                      }
                      onRemove={() => updateViewFilters({ assignees: assigneeFilters.filter((x) => x !== v) })}
                    />
                  ))}
                  {caseType !== 'all' && (
                    <FilterChip
                      label={caseType === 'manual' ? 'Manual' : 'Automated'}
                      onRemove={() => updateViewFilters({ caseType: 'all' })}
                    />
                  )}
                </div>
              )}

              {/* Bulk Actions */}
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-1.5 animate-in fade-in-0 duration-150 flex-wrap bg-primary/5 p-1 rounded-lg border border-primary/20">
                  <span className="text-[11px] text-primary font-bold px-2 whitespace-nowrap">
                    {selectedIds.size} selected
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" disabled={bulkBusy} className="h-6 text-[10.5px] px-2.5 cursor-pointer gap-1.5 bg-background shadow-xs">
                        <Check className="h-3 w-3" /> Mark
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-36">
                      <DropdownMenuItem onSelect={() => handleBulkStatus('PASS')} className="gap-2 text-xs cursor-pointer"><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Pass</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleBulkStatus('FAIL')} className="gap-2 text-xs cursor-pointer"><XCircle className="h-3.5 w-3.5 text-red-500" /> Fail</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleBulkStatus('BLOCKED')} className="gap-2 text-xs cursor-pointer"><Ban className="h-3.5 w-3.5 text-amber-500" /> Blocked</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleBulkStatus('SKIP')} className="gap-2 text-xs cursor-pointer"><SkipForward className="h-3.5 w-3.5 text-zinc-400" /> Skip</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleBulkStatus('INVALID')} className="gap-2 text-xs cursor-pointer"><AlertTriangle className="h-3.5 w-3.5 text-violet-500" /> Invalid</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => void handleBulkRerun()} className="h-6 text-[10.5px] px-2.5 cursor-pointer gap-1.5 bg-background shadow-xs" title="Re-run selected"><RotateCcw className="h-3 w-3" /> Re-run</Button>
                  <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => { setActionCase(null); setShowAssignDialog(true); }} className="h-6 text-[10.5px] px-2.5 cursor-pointer gap-1.5 bg-background shadow-xs"><UserPlus className="h-3 w-3" /> Assign</Button>
                  <Button variant="ghost" size="sm" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())} className="h-6 w-6 p-0 cursor-pointer" title="Clear selection"><X className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Actions (title line) -> Ring with stats below */}
          <div className="flex items-start justify-end gap-3 shrink-0">
            {headerActions}
            <div className="flex flex-col items-end gap-1">
              <Tooltip
              content={
                <div className="p-2 space-y-2 min-w-[210px] text-left">
                  <div className="flex items-center justify-between border-b border-border/60 pb-1.5 gap-4">
                    <span className="text-xs font-bold text-foreground">Execution Breakdown</span>
                    <span className="font-mono text-[11px] font-semibold text-foreground">{completedCount} of {total}</span>
                  </div>
                  <div className="space-y-1">
                    {(['pass', 'fail', 'blocked', 'invalid', 'skip', 'error', 'pending'] as const).map((s) => {
                      const count = s === 'pending' ? pendingCount : (progress[s] || 0);
                      if (!count) return null;
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={s} className="flex items-center justify-between text-xs py-0.5 gap-3">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'h-2 w-2 rounded-full shrink-0',
                                s === 'pass' && 'bg-emerald-400',
                                s === 'fail' && 'bg-rose-400',
                                s === 'blocked' && 'bg-amber-400',
                                s === 'invalid' && 'bg-violet-400',
                                s === 'error' && 'bg-orange-400',
                                s === 'skip' && 'bg-zinc-300',
                                s === 'pending' && 'bg-muted-foreground/30'
                              )}
                            />
                            <span className="capitalize text-foreground/90">{s === 'pending' ? 'Not run' : s}</span>
                          </span>
                          <div className="flex items-center gap-1.5 font-mono text-[11px]">
                            <span className="font-semibold text-foreground">{count}</span>
                            <span className="text-muted-foreground text-[10px]">({pct}%)</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              }
              side="bottom"
              align="end"
            >
                <div className="transition-transform group-hover/ring:scale-105 shrink-0">
                  <ProgressCircle
                    size={92}
                    strokeWidth={5}
                    segmented
                    segments={{ pass: progress.pass, fail: progress.fail, blocked: progress.blocked, invalid: progress.invalid, skip: progress.skip, unavailable: progress.unavailable, total: total }}
                    centerContent={
                      <span className="text-base font-bold font-mono tracking-tight text-foreground">
                        {run.status === 'completed' ? passRate : completedPct}%
                      </span>
                    }
                  />
                </div>
            </Tooltip>
              <div className="flex flex-col items-end text-right cursor-pointer group/ring">
                  <span className="text-[11.5px] font-semibold text-foreground group-hover/ring:text-primary transition-colors">
                    {run.status === 'completed'
                      ? `Pass rate · ${passRate}%`
                      : `${completedCount} of ${total} completed`}
                  </span>
                  {/* Inline status breakdown text: hidden on smaller viewports (< 2xl) to prevent congestion */}
                  <div className="mt-0.5 hidden 2xl:flex max-w-[200px] flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    {(['fail', 'blocked', 'invalid', 'skip', 'pending', 'pass'] as const).map((s) => {
                      const count = s === 'pending' ? pendingCount : (progress[s] || 0);
                      if (!count) return null;
                      const active = statusFilters.includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateViewFilters({ statuses: toggleFromList(statusFilters, s) });
                          }}
                          className={cn(
                            'flex items-center gap-1 transition-colors cursor-pointer outline-none hover:text-foreground',
                            active && 'font-bold text-foreground'
                          )}
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              s === 'pass' && 'bg-emerald-400',
                              s === 'fail' && 'bg-rose-400',
                              s === 'blocked' && 'bg-amber-400',
                              s === 'invalid' && 'bg-violet-400',
                              s === 'skip' && 'bg-zinc-300',
                              s === 'pending' && 'bg-muted-foreground/30'
                            )}
                          />
                          <span>{count} {s === 'pending' ? 'not run' : s}</span>
                        </button>
                      );
                    })}
                  </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fallback Stacked Bar for small screens */}
      <div className="md:hidden w-full h-1.5 flex" role="progressbar" aria-valuenow={completedCount} aria-valuemax={total}>
        {total > 0 ? (
          <>
            {progress.pass > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(progress.pass / total) * 100}%` }} />}
            {progress.fail > 0 && <div className="h-full bg-red-500" style={{ width: `${(progress.fail / total) * 100}%` }} />}
            {progress.blocked > 0 && <div className="h-full bg-amber-500" style={{ width: `${(progress.blocked / total) * 100}%` }} />}
            {progress.invalid > 0 && <div className="h-full bg-violet-500" style={{ width: `${(progress.invalid / total) * 100}%` }} />}
            {progress.unavailable > 0 && <div className="h-full bg-orange-500" style={{ width: `${(progress.unavailable / total) * 100}%` }} />}
            {progress.skip > 0 && <div className="h-full bg-zinc-400" style={{ width: `${(progress.skip / total) * 100}%` }} />}
            {(total - completedCount) > 0 && <div className="h-full bg-muted" style={{ width: `${((total - completedCount) / total) * 100}%` }} />}
          </>
        ) : (
          <div className="h-full w-full bg-muted" />
        )}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-y-auto group/table">
        {filteredResultsByModule.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
            No results match your filters
          </div>
        ) : (
          <>
          {filteredResultsByModule.map((group) => {
            const allSelected = group.results.length > 0 && group.results.every((r) => selectedIds.has(r.id));
            const suiteCompleted = group.results.filter((r) => r.status && r.status !== 'pending').length;
            const suitePct = Math.round((suiteCompleted / group.results.length) * 100);
            const groupTotalTime = group.results.reduce(
              (acc: number, r: any) => acc + (r.totalTimeSpentSeconds ?? r.timeSpentSeconds ?? 0),
              0
            );

            const groupSelectedCount = group.results.filter((r) => selectedIds.has(r.id)).length;
            const groupPartiallySelected = groupSelectedCount > 0 && groupSelectedCount < group.results.length;

            let gPass = 0, gFail = 0, gBlocked = 0, gSkip = 0, gInvalid = 0, gUnavailable = 0;
            group.results.forEach((r) => {
              const s = r.status?.toLowerCase();
              if (s === 'pass') gPass++;
              else if (s === 'fail') gFail++;
              else if (s === 'blocked') gBlocked++;
              else if (s === 'skip') gSkip++;
              else if (s === 'invalid' || s === 'error') gInvalid++;
              else if (s === 'unavailable') gUnavailable++;
            });

            return (
              <div key={group.moduleName} className="border-b last:border-b-0">
                {/* Collapsible Module Header */}
                <div
                  onClick={() => toggleModuleCollapse(group.moduleName)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 text-left text-xs font-bold uppercase tracking-wider border-b border-border/40 cursor-pointer transition-colors select-none group/mod"
                >
                  <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover/mod:text-foreground", !collapsedModules.has(group.moduleName) && "rotate-90")} />
                  <span className="flex-1 text-left font-bold tracking-wider flex items-center gap-2">
                    <span onClick={(e) => e.stopPropagation()} className="flex items-center">
                      <Checkbox
                        checked={allSelected}
                        indeterminate={groupPartiallySelected}
                        onCheckedChange={(checked) =>
                          selectAllInGroup(group.results.map((r: any) => r.id), checked)
                        }
                        aria-label={`Select all cases in ${group.moduleName}`}
                        className="shrink-0"
                      />
                    </span>
                    {group.moduleName}
                  </span>
                  <div className="flex items-center gap-2.5 text-xs text-muted-foreground font-normal normal-case">
                    {groupTotalTime > 0 && (
                      <span className="font-mono inline-flex items-center gap-1 text-foreground/80 font-medium">
                        <Clock className="h-3 w-3 text-primary/70" />
                        {formatDuration(groupTotalTime)} total
                      </span>
                    )}
                    {groupTotalTime > 0 && <span className="opacity-40">·</span>}
                    <div className="flex items-center gap-1.5">
                      <Tooltip
                        content={
                          <div className="flex flex-col gap-1 text-[10px] font-sans">
                            {gPass > 0 && <div><span className="text-emerald-400 font-bold">Passed:</span> {gPass}</div>}
                            {gFail > 0 && <div><span className="text-red-400 font-bold">Failed:</span> {gFail}</div>}
                            {gBlocked > 0 && <div><span className="text-amber-400 font-bold">Blocked:</span> {gBlocked}</div>}
                            {gSkip > 0 && <div><span className="text-zinc-400 font-bold">Skipped:</span> {gSkip}</div>}
                            {gInvalid > 0 && <div><span className="text-violet-400 font-bold">Invalid:</span> {gInvalid}</div>}
                            {gUnavailable > 0 && <div><span className="text-orange-400 font-bold">Unavailable:</span> {gUnavailable}</div>}
                            {group.results.length - suiteCompleted > 0 && <div><span className="text-muted-foreground font-bold">Pending:</span> {group.results.length - suiteCompleted}</div>}
                            <div className="border-t border-border/50 pt-1 mt-1"><span className="text-foreground font-bold">Total:</span> {group.results.length}</div>
                          </div>
                        }
                      >
                        <div className="cursor-default">
                          <ProgressCircle
                            size={16}
                            strokeWidth={2}
                            segmented
                            segments={{ pass: gPass, fail: gFail, blocked: gBlocked, skip: gSkip, invalid: gInvalid, unavailable: gUnavailable, total: group.results.length }}
                          />
                        </div>
                      </Tooltip>
                      <span className="font-medium text-foreground/80">
                        {suiteCompleted}/{group.results.length}
                      </span>
                    </div>

                    {/* Group Bulk Actions */}
                    <div className="relative ml-1 opacity-0 group-hover/mod:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenGroupActionsId((prev) => prev === group.moduleName ? null : group.moduleName);
                        }}
                        className={cn(
                          "h-5 px-1.5 rounded bg-muted/70 hover:bg-muted text-[10px] font-semibold flex items-center gap-1 border border-border/50 text-foreground cursor-pointer transition-colors",
                          openGroupActionsId === group.moduleName && "bg-muted border-primary/40 text-primary"
                        )}
                      >
                        <span>Actions</span>
                        <ChevronDown className={cn("h-2.5 w-2.5 text-muted-foreground transition-transform", openGroupActionsId === group.moduleName && "rotate-180")} />
                      </button>
                      {openGroupActionsId === group.moduleName && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setOpenGroupActionsId(null)} />
                          <div className="absolute right-0 top-full pt-1 z-50 w-48 pointer-events-auto animate-in fade-in-0 zoom-in-95 duration-100">
                            <div className="rounded-xl bg-popover border border-border/80 p-1 shadow-2xl text-xs space-y-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenGroupActionsId(null);
                                  const groupIds = group.results.map((r: any) => r.id);
                                  selectAllInGroup(groupIds, true);
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted text-xs transition-colors flex items-center gap-2 cursor-pointer"
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span>Select all in group</span>
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  setOpenGroupActionsId(null);
                                  const groupIds = group.results.map((r: any) => r.id);
                                  await Promise.all(groupIds.map((resId: string) => updateRunResultAction(resId, { status: 'PASS', executedBy: currentUser?.id || 1, source: 'manual' })));
                                  await refetchResults();
                                  toast.success(`Passed all in ${group.moduleName}`);
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-emerald-500/10 text-emerald-400 text-xs transition-colors flex items-center gap-2 cursor-pointer"
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                                <span>Pass all in group</span>
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {!collapsedModules.has(group.moduleName) && (
                  <>
                    <div
                      className={cn(
                        CASE_TABLE_GRID,
                        'border-b px-2 py-2 text-[11px] text-muted-foreground font-semibold uppercase tracking-wider select-none bg-muted/20'
                      )}
                    >
                      <span aria-hidden="true" />
                      <span className="min-w-0 text-left pl-1">Case</span>
                      <span className="text-center">
                        <button
                          type="button"
                          onClick={() => {
                            if (!prioritySort) setPrioritySort('asc');
                            else if (prioritySort === 'asc') setPrioritySort('desc');
                            else setPrioritySort(null);
                          }}
                          className={cn("inline-flex items-center gap-1 transition-colors cursor-pointer outline-none hover:text-foreground justify-center", prioritySort && "text-primary")}
                          title="Sort by priority"
                        >
                          Priority
                          {prioritySort === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : prioritySort === 'desc' ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-60" />
                          )}
                        </button>
                      </span>
                      <span className="text-left">Status</span>
                      <span className="hidden sm:block text-left">Time</span>
                      <span className="hidden sm:block text-left">Assignee</span>
                      <span aria-hidden="true" />
                    </div>
                    {/* Rows */}
                    {group.results.map((result) => {
                      const testCase = getCase(result.testCaseId);
                      if (!testCase) return null;
                      const caseRunState = getCaseRunState(result);
                      const caseUsesAutomated =
                        isExternalRun ||
                        ((run.source === 'mixed' || run.source === 'automated') &&
                          isAutomatedCase(testCase));
                      const caseAutomationSource = getCaseAutomationSource(testCase);
                      const caseHasLinkedRunner =
                        caseAutomationSource === 'postman' || caseAutomationSource === 'datadog';
                      const caseBusy = startingCaseIds.has(result.id);
                      const canStartCase =
                        caseUsesAutomated &&
                        caseHasLinkedRunner &&
                        !hasRunningCase &&
                        (caseRunState === 'NOT_RUN' || caseRunState === 'CANCELLED');
                      // A settled automated case can be re-run from the ••• menu.
                      const canRerunCase =
                        caseUsesAutomated &&
                        (caseRunState === 'FAILED' ||
                          caseRunState === 'ERROR' ||
                          caseRunState === 'PASSED');
                      const isSelected = selectedIds.has(result.id);
                      const isManualOverride = result.source === 'list' || Boolean(result.stepResults?._override);
                      const snap = run?.resolved_datasets?.[result.testCaseId];
                      const caseDs = snap || testCase?.dataset || testCase?.local_dataset || (testCase as any)?.localDataset;
                      const hasIterations = Boolean(caseDs && Array.isArray(caseDs.rows) && caseDs.rows.length > 1);
                      const statusBadge = caseUsesAutomated ? (
                        <CaseStateBadge state={caseRunState} queuePosition={(result as any).queuePosition} />
                      ) : (
                        <ResultStatusBadge
                          status={result.status}
                          attemptNumber={result.attemptNumber}
                          timeSpentSeconds={result.timeSpentSeconds}
                          isManualOverride={isManualOverride}
                          variant="subtle"
                        />
                      );
                      const canQuickStatus =
                        !caseUsesAutomated && result.status === 'pending' && run.status !== 'aborted';

                      return (
                        <div key={result.id} className="border-b last:border-b-0">
                          <div
                            className={cn(
                              CASE_TABLE_GRID,
                              'px-2 py-1.5 hover:bg-primary/[0.06] dark:hover:bg-white/[0.05] transition-colors group/row relative'
                            )}
                          >
                            <div className="relative flex items-center justify-center h-full w-full">
                              <span className={cn(
                                "absolute inset-0 flex items-center justify-center select-none font-mono text-[10px] leading-none text-muted-foreground/50 tabular-nums transition-opacity duration-150",
                                isSelected ? "opacity-0" : "group-hover/row:opacity-0"
                              )}>
                                {resultIndexMap.get(result.id)}
                              </span>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelect(result.id)}
                                className={cn(
                                  "absolute z-10 shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity",
                                  isSelected && "opacity-100"
                                )}
                              />
                            </div>
                            <div className="min-w-0 flex flex-col justify-center">
                              <Tooltip
                                content={<span className="block">{testCase.title}</span>}
                                wrapperClassName="w-full min-w-0"
                                className="whitespace-normal text-left leading-snug max-w-md"
                              >
                                <div className="flex w-full min-w-0 items-start gap-2 text-left select-none">
                                  {hasIterations && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (expandAllIters) setExpandAllIters(false);
                                        setExpandedIters((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(result.id)) next.delete(result.id);
                                          else next.add(result.id);
                                          return next;
                                        });
                                      }}
                                      className="h-4 w-4 shrink-0 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/60 mt-0.5"
                                    >
                                      <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-200", (expandAllIters || expandedIters.has(result.id)) && "rotate-90")} />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openCaseDetail(testCase)}
                                    className="flex w-full min-w-0 items-center gap-2 rounded-md outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                  >
                                    <span className="flex shrink-0 items-center gap-1.5">
                                      <span className="font-mono text-[11.5px] font-semibold text-primary whitespace-nowrap shrink-0">
                                        {testCase.displayId}
                                      </span>
                                      {testCase.aiGenerated && <AiBadge iconOnly />}
                                    </span>
                                    <span className="flex min-w-0 items-center gap-1.5">
                                      <span className="truncate text-sm font-medium text-foreground/90 group-hover/row:text-primary transition-colors">
                                        {testCase.title}
                                      </span>
                                      {((result.attemptNumber && result.attemptNumber > 1) || (result.totalAttempts && result.totalAttempts > 1)) && (
                                        <span className="font-mono text-[10.5px] font-semibold text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded border border-border/50 shrink-0">
                                          Att #{result.attemptNumber || 1}
                                        </span>
                                      )}
                                      <CaseSourceIcon testCase={testCase} className="shrink-0" />
                                    </span>
                                  </button>
                                </div>
                              </Tooltip>

                              {hasIterations && caseDs?.rows?.length > 1 && (() => {
                                const totalIters = caseDs.rows.length;
                                const iterList = ((result.iterationResults || result.iteration_results || []) as any[]);
                                let pass = 0;
                                let fail = 0;
                                let blocked = 0;
                                let skip = 0;
                                let invalid = 0;

                                iterList.forEach((it: any) => {
                                  const s = it.status?.toLowerCase();
                                  if (s === 'pass') pass++;
                                  else if (s === 'fail') fail++;
                                  else if (s === 'blocked') blocked++;
                                  else if (s === 'skip') skip++;
                                  else if (s === 'invalid') invalid++;
                                  else if (s === 'error') invalid++;
                                });

                                const completedIters = pass + fail + blocked + skip + invalid;
                                const iterPct = Math.round((completedIters / totalIters) * 100);

                                return (
                                  <div
                                    className="mt-1 flex items-center justify-between gap-3 max-w-sm group/itrbar select-none"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <ProgressCircle
                                        segments={{
                                          pass,
                                          fail,
                                          blocked,
                                          invalid,
                                          skip,
                                          total: totalIters,
                                        }}
                                        size={20}
                                        strokeWidth={2}
                                        segmented
                                      />
                                      <span className="font-mono text-[10.5px] font-semibold text-muted-foreground transition-colors inline-flex items-center gap-1">
                                        <span>{completedIters}/{totalIters} iterations</span>
                                        {totalIters > 10 && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setViewingIterationsResult(result);
                                            }}
                                            className="ml-1 text-primary hover:underline hover:text-primary cursor-pointer transition-colors"
                                          >
                                            View all {totalIters} iterations
                                          </button>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>

                            <div className="flex items-center justify-center min-w-0 text-center">
                              {testCase.priority && (
                                <PriorityBadge
                                  priority={testCase.priority}
                                  showIcon={false}
                                  className={cn(
                                    'text-[10px] uppercase bg-transparent text-center',
                                    PRIORITY_TEXT[String(testCase.priority).toUpperCase()] || 'text-muted-foreground'
                                  )}
                                />
                              )}
                            </div>

                            <div className="relative flex min-w-0 items-center justify-start gap-1.5 text-left">
                              {canQuickStatus ? (
                                <Popover
                                  open={hoverStatusId === result.id}
                                  onOpenChange={(open) => setHoverStatusId(open ? result.id : null)}
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label={`Change status for ${testCase.displayId}`}
                                      className="flex min-w-0 items-center justify-start rounded text-left outline-none cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-primary/60"
                                    >
                                      {statusBadge}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    side="bottom"
                                    align="start"
                                    sideOffset={6}
                                    collisionPadding={12}
                                    className="w-36 space-y-0.5 p-1 text-xs"
                                  >
                                    <div className="px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">
                                      Select
                                    </div>
                                    {QUICK_STATUS_OPTIONS.map((option) => (
                                      <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => {
                                          setHoverStatusId(null);
                                          handleSetQuickStatus(result.id, option.value);
                                        }}
                                        className={cn(
                                          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs font-medium transition-colors cursor-pointer',
                                          option.className
                                        )}
                                      >
                                        <option.icon className="h-3.5 w-3.5" />
                                        <span>{option.label}</span>
                                      </button>
                                    ))}
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                <div className="flex min-w-0 items-center justify-start select-none">
                                  {statusBadge}
                                </div>
                              )}

                              {/* Start a not-yet-run case. Re-running a settled
                                  case lives in the ••• menu. */}
                              {caseUsesAutomated &&
                                caseHasLinkedRunner &&
                                !hasRunningCase &&
                                !hasQueuedCase &&
                                canStartCase && (
                                  <Tooltip content="Run test case">
                                    <button
                                      type="button"
                                      aria-label="Run test case"
                                      onClick={() => handleStartCase(result, 'start')}
                                      disabled={caseBusy || startingRun}
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary cursor-pointer disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                                    >
                                      {caseBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                                    </button>
                                  </Tooltip>
                                )}
                              {caseUsesAutomated && !caseHasLinkedRunner && (
                                <Tooltip content="Automated elsewhere, but not linked to a Postman or Datadog runner">
                                  <span
                                    aria-label="No runner"
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-amber-600 dark:text-amber-400"
                                  >
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  </span>
                                </Tooltip>
                              )}
                            </div>

                            <div className="hidden sm:flex flex-col min-w-0 text-left font-mono text-[11px] text-muted-foreground truncate justify-center items-start">
                              {result.timeSpentSeconds > 0 || (result.totalTimeSpentSeconds && result.totalTimeSpentSeconds > 0) ? (
                                (result.attemptNumber && result.attemptNumber > 1) || (result.totalAttempts && result.totalAttempts > 1) ? (
                                  <Tooltip
                                    side="top"
                                    align="start"
                                    className="p-0 border border-border bg-popover text-popover-foreground rounded-xl shadow-2xl overflow-hidden max-w-none text-xs select-none whitespace-normal min-w-[220px]"
                                    content={
                                      <div className="flex flex-col text-xs font-sans">
                                        <div className="px-3 py-2 border-b border-border/50 bg-muted/40 flex items-center justify-between gap-3">
                                          <div className="flex items-center gap-1.5 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">
                                            <Clock className="h-3 w-3 text-primary" />
                                            <span>Attempt Breakdown</span>
                                          </div>
                                          <span className="text-[10px] font-mono text-muted-foreground font-semibold">
                                            {result.totalAttempts || result.attemptNumber || 2} attempts
                                          </span>
                                        </div>

                                        <div className="p-2 space-y-1 font-mono text-xs">
                                          {(result.attempts && result.attempts.length > 0
                                            ? result.attempts
                                            : [
                                                { attemptNumber: result.attemptNumber || 2, timeSpentSeconds: result.timeSpentSeconds, status: result.status },
                                                { attemptNumber: (result.attemptNumber || 2) - 1, timeSpentSeconds: Math.max(0, (result.totalTimeSpentSeconds || result.timeSpentSeconds) - result.timeSpentSeconds), status: 'prior' }
                                              ]
                                          ).map((att: any) => {
                                            const isCurrent = att.attemptNumber === (result.attemptNumber || 1);
                                            return (
                                              <div
                                                key={att.attemptNumber}
                                                className={cn(
                                                  "flex items-center justify-between gap-4 px-2 py-1 rounded-lg text-xs transition-colors",
                                                  isCurrent ? "bg-primary/10 text-foreground font-semibold" : "text-muted-foreground hover:bg-white/[0.02]"
                                                )}
                                              >
                                                <div className="flex items-center gap-1.5 font-sans">
                                                  <span className={cn(
                                                    "h-1.5 w-1.5 rounded-full shrink-0",
                                                    isCurrent ? "bg-primary" : "bg-muted-foreground/40"
                                                  )} />
                                                  <span>Attempt #{att.attemptNumber}</span>
                                                  {isCurrent && (
                                                    <span className="text-[9px] px-1 py-0.2 rounded bg-primary/20 text-primary uppercase font-bold tracking-wider">
                                                      Current
                                                    </span>
                                                  )}
                                                </div>
                                                <span className={cn("font-mono text-xs", isCurrent ? "text-primary font-bold" : "text-foreground/80")}>
                                                  {formatDuration(att.timeSpentSeconds || 0)}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>

                                        <div className="px-3 py-2 border-t border-border bg-white/[0.02] flex items-center justify-between gap-4 font-semibold text-xs">
                                          <span className="text-muted-foreground font-sans text-xs">Cumulative Effort</span>
                                          <span className="text-foreground font-mono font-bold text-xs">
                                            {formatDuration(result.totalTimeSpentSeconds || result.timeSpentSeconds)}
                                          </span>
                                        </div>
                                      </div>
                                    }
                                  >
                                    <div className="flex flex-col cursor-pointer hover:text-foreground transition-colors group/dur">
                                      <span className="text-foreground/90 font-medium whitespace-nowrap tabular-nums">
                                        {formatDuration(result.timeSpentSeconds)}
                                      </span>
                                      <span className="text-[9.5px] text-muted-foreground/60 group-hover/dur:text-muted-foreground transition-colors whitespace-nowrap tabular-nums">
                                        Σ {formatDuration(result.totalTimeSpentSeconds || result.timeSpentSeconds)}
                                      </span>
                                    </div>
                                  </Tooltip>
                                ) : (
                                  <span className="text-foreground/80 font-medium whitespace-nowrap tabular-nums">
                                    {formatDuration(result.timeSpentSeconds)}
                                  </span>
                                )
                              ) : (
                                <span className="text-muted-foreground/30">—</span>
                              )}
                            </div>

                            <div className="hidden sm:flex min-w-0 items-center justify-start">
                              <AssigneeDropdown
                                resultId={result.id}
                                assignedTo={result.assignedTo}
                                assignedToName={result.assignedToName}
                                assignedToAvatar={result.assignedToAvatar}
                                iterationResults={result.iterationResults || result.iteration_results}
                                runStatus={run.status}
                                members={members}
                                currentUserId={currentUser?.id}
                                onAssign={async (resId: string, assigneeId: number | null) => {
                                  try {
                                    if (assigneeId) {
                                      await assignRunResultAction(resId, assigneeId);
                                    } else {
                                      await unassignRunResultAction(resId);
                                    }
                                    await refetchResults();
                                    toast.success(assigneeId ? 'Assigned' : 'Unassigned');
                                  } catch (err: any) {
                                    toast.error(err.message || 'Failed to update assignee');
                                  }
                                }}
                                onAssignIteration={async (resId: string, iterIdx: number, assigneeId: number | null) => {
                                  try {
                                    const existingIters = (result.iterationResults || result.iteration_results || []) as any[];
                                    const nextIters = [...existingIters];
                                    const matchIdx = nextIters.findIndex((it: any) => it.iteration_index === iterIdx);
                                    if (matchIdx >= 0) {
                                      nextIters[matchIdx] = { ...nextIters[matchIdx], assigned_to: assigneeId };
                                    } else {
                                      nextIters.push({ iteration_index: iterIdx, assigned_to: assigneeId });
                                    }
                                    await updateRunResultAction(resId, { iterationResults: nextIters });
                                    await refetchResults();
                                    toast.success(`Iteration #${iterIdx} assignment updated`);
                                  } catch (err: any) {
                                    toast.error(err.message || 'Failed to update iteration assignee');
                                  }
                                }}
                              />
                            </div>

                            <div className="flex items-center justify-center">
                              <HoverDropdownMenu
                                open={openRowMenuId === result.id}
                                onOpenChange={(open) => setOpenRowMenuId(open ? result.id : null)}
                              >
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label="More actions"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  side="bottom"
                                  sideOffset={6}
                                  collisionPadding={12}
                                  className="w-48"
                                >
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setActionCase(result);
                                      setShowAssignDialog(true);
                                    }}
                                    className="gap-2 text-xs"
                                  >
                                    <UserPlus className="h-3.5 w-3.5" />
                                    <span>Assign...</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setActionCase(result);
                                      void handleUnassign([result.id]);
                                    }}
                                    className="gap-2 text-xs"
                                  >
                                    <UserMinus className="h-3.5 w-3.5" />
                                    <span>Unassign</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => router.push(`/p/${slug}/repository/${testCase.displayId}`)}
                                    className="gap-2 text-xs"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    <span>View Case</span>
                                  </DropdownMenuItem>
                                  {hasIterations && (
                                    <DropdownMenuItem
                                      onSelect={() => setAssignItersResult(result)}
                                      className="gap-2 text-xs"
                                    >
                                      <UserPlus className="h-3.5 w-3.5" />
                                      <span>Assign iterations...</span>
                                    </DropdownMenuItem>
                                  )}
                                  {hasIterations && (
                                    <DropdownMenuItem
                                      onSelect={() => setViewingIterationsResult(result)}
                                      className="gap-2 text-xs"
                                    >
                                      <ListChecks className="h-3.5 w-3.5" />
                                      <span>View Iterations...</span>
                                    </DropdownMenuItem>
                                  )}
                                  {run.status !== 'aborted' &&
                                    (caseUsesAutomated
                                      ? canRerunCase
                                      : result.status !== 'pending') && (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        if (caseUsesAutomated) handleStartCase(result, 'rerun');
                                        else handleRerunCase(result.id);
                                      }}
                                      className="gap-2 text-xs"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                      <span>Re-run</span>
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setActionCase(result);
                                      setShowDeleteConfirm(result.id);
                                    }}
                                    className="gap-2 text-xs text-red-500 focus:text-red-500"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    <span>Remove from Run</span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </HoverDropdownMenu>
                            </div>
                          </div>

                          {/* Expanded iterations: same grid as the parent row so
                              status, time and assignee stay column-aligned. */}
                          {hasIterations && (expandAllIters || expandedIters.has(result.id)) && (() => {
                            const rows = caseDs.rows;
                            const limit = Math.min(10, rows.length);
                            const parentIndex = resultIndexMap.get(result.id) ?? '';

                            return (
                              <div className="border-t border-border/50 bg-muted/25 py-1 dark:bg-white/[0.025]">
                                {rows.slice(0, limit).map((row: any, iterIdx: number) => {
                                  const iterResultsList = (result.iterationResults || result.iteration_results || []) as any[];
                                  const iterRes = iterResultsList.find((ir: any) => ir.iteration_index === iterIdx + 1);
                                  const rStatus = iterRes?.status?.toLowerCase() || 'pending';
                                  const params = Object.entries(row).filter(([k]) => k !== 'id');

                                  return (
                                    <div
                                      key={row.id || iterIdx}
                                      className={cn(
                                        CASE_TABLE_GRID,
                                        'px-2 py-1.5 transition-colors hover:bg-muted/40 dark:hover:bg-white/[0.05]'
                                      )}
                                    >
                                      <span className="w-full text-center font-mono text-[10px] tabular-nums text-muted-foreground/60">
                                        {parentIndex ? `${parentIndex}.${iterIdx + 1}` : iterIdx + 1}
                                      </span>

                                      <div className="flex min-w-0 flex-col gap-1 pl-4">
                                        <span className="truncate text-[11.5px] font-medium text-foreground/80">
                                          Iteration {iterIdx + 1}
                                        </span>
                                        {params.length > 0 && (
                                          <span className="flex min-w-0 flex-wrap items-center gap-1">
                                            {params.map(([key, val]) => (
                                              <span
                                                key={key}
                                                className="inline-flex max-w-[150px] items-center gap-1 rounded border border-border/60 bg-background/60 px-1.5 py-px font-mono text-[9.5px]"
                                              >
                                                <span className="text-muted-foreground/70">{key}</span>
                                                <span className="truncate text-foreground/80">{String(val ?? '')}</span>
                                              </span>
                                            ))}
                                          </span>
                                        )}
                                      </div>

                                      {/* Priority mirrors the parent so the remaining columns never shift. */}
                                      <div className="flex min-w-0 items-center justify-center">
                                        {testCase.priority && (
                                          <PriorityBadge
                                            priority={testCase.priority}
                                            showIcon={false}
                                            className={cn(
                                              'text-[10px] uppercase',
                                              PRIORITY_TEXT[String(testCase.priority).toUpperCase()] || 'text-muted-foreground'
                                            )}
                                          />
                                        )}
                                      </div>

                                      <div className="flex min-w-0 items-center justify-start">
                                        {rStatus !== 'pending' ? (
                                          <StatusPill
                                            tone={
                                              rStatus === 'pass' ? 'pass' :
                                              rStatus === 'fail' ? 'fail' :
                                              rStatus === 'blocked' ? 'blocked' :
                                              rStatus === 'skip' ? 'skip' :
                                              rStatus === 'invalid' ? 'invalid' :
                                              rStatus === 'error' ? 'error' :
                                              rStatus === 'cancelled' ? 'cancelled' :
                                              'pending'
                                            }
                                            className="text-[9px] font-semibold uppercase tracking-wide"
                                          >
                                            {rStatus}
                                          </StatusPill>
                                        ) : (
                                          <span className="px-1 font-mono text-[9px] font-medium uppercase text-muted-foreground/50">
                                            Not run
                                          </span>
                                        )}
                                      </div>

                                      <div className="hidden min-w-0 truncate text-left font-mono text-[11px] tabular-nums text-muted-foreground sm:block">
                                        {formatDuration(iterRes?.time_spent_seconds || 0)}
                                      </div>

                                      <div className="hidden min-w-0 items-center justify-start sm:flex">
                                        <AssigneeDropdown
                                          resultId={result.id}
                                          assignedTo={iterRes?.assigned_to}
                                          runStatus={run.status}
                                          members={members}
                                          currentUserId={currentUser?.id}
                                          onAssign={async (resId, assigneeId) => {
                                            try {
                                              const nextIters = [...iterResultsList];
                                              const matchIdx = nextIters.findIndex((it: any) => it.iteration_index === iterIdx + 1);
                                              if (matchIdx >= 0) {
                                                nextIters[matchIdx] = { ...nextIters[matchIdx], assigned_to: assigneeId };
                                              } else {
                                                nextIters.push({ iteration_index: iterIdx + 1, assigned_to: assigneeId });
                                              }
                                              await updateRunResultAction(resId, { iterationResults: nextIters });
                                              await refetchResults();
                                              toast.success(`Iteration #${iterIdx + 1} assignment updated`);
                                            } catch (err: any) {
                                              toast.error(err.message || 'Failed to update iteration assignee');
                                            }
                                          }}
                                        />
                                      </div>

                                      <div className="flex items-center justify-center">
                                        {caseUsesAutomated && caseHasLinkedRunner && !hasRunningCase && canStartCase && rStatus === 'pending' && (
                                          <button
                                            type="button"
                                            onClick={() => handleStartCase(result, 'start')}
                                            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary cursor-pointer"
                                            title="Run test case"
                                          >
                                            <Play className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                                {rows.length > 10 && (
                                  <div className="flex items-center px-10 py-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setViewingIterationsResult(result)}
                                      className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                                    >
                                      View all {rows.length} iterations
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}
          </>
        )}
      </div>

      {/* ── Assign Dialog ── */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign to Member</DialogTitle>
            <DialogDescription>
              project members. Select one or more to assign.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 py-2 max-h-[300px] overflow-y-auto">
            {members.map((m: any) => (
              <button
                key={m.userId}
                onClick={() => handleAssign(m.userId || m.user?.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted text-left"
              >
                <UserAvatar name={m.user?.name} imageUrl={m.user?.avatarUrl} size="sm" />
                <div>
                  <p className="text-sm font-medium">{m.user?.name}</p>
                  <p className="text-xs text-muted-foreground">{m.user?.email}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from Run</DialogTitle>
            <DialogDescription>
              Are you sure? This case will be removed from the current test run.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Clone Dialog ── */}
      <Dialog open={showCloneDialog} onOpenChange={setShowCloneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Copy className="h-5 w-5" /> Clone Run</DialogTitle>
            <DialogDescription>Duplicate this run with a new name and settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={cloneForm.name} onChange={(e) => setCloneForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Environment</label>
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={cloneForm.environment}
                onChange={(e) => setCloneForm((p) => ({ ...p, environment: e.target.value }))}
              >
                {[...new Set(runs.map((r: any) => r.environment).filter(Boolean))].map((env: any) => (
                  <option key={env} value={env}>{env}</option>
                ))}
                {[...new Set(runs.map((r: any) => r.environment).filter(Boolean))].length === 0 && (
                  <option value="staging">Staging</option>
                )}
              </select>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <Checkbox
                  checked={cloneForm.cloneAssignments}
                  onCheckedChange={(checked) => setCloneForm((p) => ({ ...p, cloneAssignments: checked }))}
                />
                Clone case assignments
              </label>
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={cloneForm.assignee}
                onChange={(e) => setCloneForm((p) => ({ ...p, assignee: e.target.value }))}
              >
                <option value="">Default: No assignee</option>
                {members.map((m: any) => (
                  <option key={m.userId} value={m.userId}>{m.user?.name || `User #${m.userId}`}</option>
                ))}
              </select>
              {cloneForm.cloneAssignments && <p className="text-xs text-muted-foreground">Original case assignments will be preserved.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloneDialog(false)} disabled={cloneBusy}>Cancel</Button>
            <Button onClick={confirmClone} disabled={cloneBusy || !cloneForm.name.trim()}>
              {cloneBusy ? 'Cloning...' : 'Clone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Abort Confirm ── */}
      <Dialog open={showAbortConfirm} onOpenChange={setShowAbortConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abort Run</DialogTitle>
            <DialogDescription>Are you sure you want to abort this run? In-progress cases will be marked as Aborted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAbortConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleAbort}>Abort Run</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Run Dialog ── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Run</DialogTitle>
            <DialogDescription>Update run name, environment, build version, or default assignee.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <input
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={editForm.name}
                onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Environment</label>
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={editForm.environment}
                onChange={(e) => setEditForm((p) => ({ ...p, environment: e.target.value }))}
              >
                {[...new Set(runs.map((r: any) => r.environment).filter(Boolean))].map((env: any) => (
                  <option key={env} value={env}>{env}</option>
                ))}
                {[...new Set(runs.map((r: any) => r.environment).filter(Boolean))].length === 0 && (
                  <option value="staging">Staging</option>
                )}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Build Version</label>
              <input
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={editForm.buildVersion}
                onChange={(e) => setEditForm((p) => ({ ...p, buildVersion: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Assignee (Default)</label>
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={editForm.assignedTo ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, assignedTo: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">No default assignee</option>
                {members.map((m: any) => (
                  <option key={m.userId || m.user?.id} value={m.userId || m.user?.id}>
                    {m.user?.name || `User #${m.userId || m.user?.id}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} disabled={editBusy}>Cancel</Button>
            <Button onClick={handleEditRun} disabled={editBusy || !editForm.name.trim()}>
              {editBusy ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Cases Dialog ── */}
      <Dialog open={showAddCasesDialog} onOpenChange={(open) => {
        setShowAddCasesDialog(open);
        if (!open) {
          setAddCasesSelected(new Set());
          setAddCasesSearch('');
          setAddCasesModuleFilter('');
          setAddCasesSuiteFilter('');
          setAddCasesPriorityFilter('');
          lastClickedAddCaseIndexRef.current = null;
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[85vh] !flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Add Cases to Run
            </DialogTitle>
            <DialogDescription>
              Select test cases to add to this run. Only non-draft cases not already in the run are shown. Use Shift+Click to range select.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col py-2 space-y-3 min-h-0">
            <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by title or ID (e.g. INK-46)..."
                  className="pl-9 h-9 text-sm"
                  value={addCasesSearch}
                  onChange={(e) => setAddCasesSearch(e.target.value)}
                />
              </div>

              {suites.length > 0 && (
                <Select
                  value={addCasesSuiteFilter}
                  onValueChange={setAddCasesSuiteFilter}
                  options={[
                    { value: '', label: 'All Suites' },
                    ...suites.map((s: any) => ({ value: s.id, label: s.name })),
                  ]}
                  className="w-40 h-9"
                />
              )}

              <Select
                value={addCasesModuleFilter}
                onValueChange={setAddCasesModuleFilter}
                options={[
                  { value: '', label: 'All Modules' },
                  ...modules.map((m: any) => ({ value: m.id, label: m.name })),
                ]}
                className="w-40 h-9"
              />

              <Select
                value={addCasesPriorityFilter}
                onValueChange={setAddCasesPriorityFilter}
                options={[
                  { value: '', label: 'All Priorities' },
                  { value: 'P0', label: 'P0' },
                  { value: 'P1', label: 'P1' },
                  { value: 'P2', label: 'P2' },
                  { value: 'P3', label: 'P3' },
                ]}
                className="w-32 h-9"
              />
            </div>

            {(() => {
              const filteredAvailableCases = cases
                .filter((c: any) => {
                  if (c.status === 'draft' || c.status === 'DRAFT') return false;
                  if (results.some((r: any) => r.testCaseId === c.id)) return false;
                  if (addCasesSearch) {
                    const q = addCasesSearch.toLowerCase();
                    const matchTitle = c.title?.toLowerCase().includes(q);
                    const matchId = c.displayId?.toLowerCase().includes(q);
                    if (!matchTitle && !matchId) return false;
                  }
                  if (addCasesSuiteFilter) {
                    const targetSuite = suites.find((s: any) => s.id === addCasesSuiteFilter);
                    const isInSuite = (targetSuite?.suite_cases || []).some((sc: any) => (sc.test_case_id || sc.testCaseId || sc.id) === c.id) ||
                                      (targetSuite?.cases || []).some((sc: any) => (sc.id || sc.testCaseId || sc.test_case_id) === c.id);
                    if (!isInSuite) return false;
                  }
                  if (addCasesModuleFilter && c.moduleId !== addCasesModuleFilter) return false;
                  if (addCasesPriorityFilter && c.priority !== addCasesPriorityFilter) return false;
                  return true;
                })
                .sort((a: any, b: any) => compareCaseAsc(a, b, addCasesSearch));

              const allSelected = filteredAvailableCases.length > 0 && filteredAvailableCases.every((c: any) => addCasesSelected.has(c.id));

              const handleToggleCase = (index: number, caseId: string, e: React.MouseEvent) => {
                const isShift = e.shiftKey;
                setAddCasesSelected((prev) => {
                  const next = new Set(prev);
                  if (isShift && lastClickedAddCaseIndexRef.current !== null) {
                    const start = Math.min(lastClickedAddCaseIndexRef.current, index);
                    const end = Math.max(lastClickedAddCaseIndexRef.current, index);
                    const shouldSelect = !prev.has(caseId);
                    for (let i = start; i <= end; i++) {
                      const item = filteredAvailableCases[i];
                      if (item) {
                        if (shouldSelect) next.add(item.id);
                        else next.delete(item.id);
                      }
                    }
                  } else {
                    if (next.has(caseId)) next.delete(caseId);
                    else next.add(caseId);
                  }
                  return next;
                });
                lastClickedAddCaseIndexRef.current = index;
              };

              return (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden border border-border/50 rounded-lg">
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/60 border-b border-border/50 text-xs font-semibold text-muted-foreground shrink-0">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setAddCasesSelected(new Set(filteredAvailableCases.map((c: any) => c.id)));
                          } else {
                            setAddCasesSelected(new Set());
                          }
                        }}
                      />
                      <span>Select All Available ({filteredAvailableCases.length})</span>
                    </label>
                    <span>{addCasesSelected.size} case(s) selected</span>
                  </div>

                  <div className="grid grid-cols-[40px_90px_1fr_90px_160px] gap-3 items-center px-3 py-2 bg-muted/30 border-b border-border/50 text-[11px] font-bold text-muted-foreground uppercase tracking-wider shrink-0">
                    <div className="text-center"></div>
                    <div>ID</div>
                    <div>Title</div>
                    <div className="text-center">Priority</div>
                    <div className="text-center">Module</div>
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-border/40 bg-card">
                    {filteredAvailableCases.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        {cases.length === 0
                          ? 'No test cases available in repository.'
                          : (addCasesSearch || addCasesSuiteFilter || addCasesModuleFilter || addCasesPriorityFilter)
                          ? 'No test cases match your filters.'
                          : 'All non-draft test cases are already in this run.'}
                      </div>
                    ) : (
                      filteredAvailableCases.map((c: any, index: number) => {
                        const isSelected = addCasesSelected.has(c.id);
                        const moduleName = modules.find((m: any) => m.id === c.moduleId)?.name;

                        return (
                          <div
                            key={c.id}
                            onClick={(e) => handleToggleCase(index, c.id, e)}
                            className={cn(
                              "grid grid-cols-[40px_90px_1fr_90px_160px] gap-3 items-center px-3 py-2.5 text-sm cursor-pointer transition-colors hover:bg-primary/[0.06] dark:hover:bg-white/[0.05] select-none",
                              isSelected && "bg-primary/5"
                            )}
                          >
                            <div className="flex items-center justify-center">
                              <Checkbox
                                checked={isSelected}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleCase(index, c.id, e as React.MouseEvent);
                                }}
                              />
                            </div>

                            <div>
                              <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border/40 inline-block font-medium">
                                {c.displayId || c.id}
                              </span>
                            </div>

                            <div className="min-w-0">
                              <span className="font-medium text-sm truncate block leading-snug" title={c.title}>
                                {c.title}
                              </span>
                            </div>

                            <div className="flex justify-center">
                              {c.priority ? (
                                <PriorityBadge priority={c.priority} />
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </div>

                            <div className="flex justify-center">
                              {moduleName ? (
                                <span className="text-[11px] px-2 py-0.5 rounded-full border font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200/30 truncate max-w-[150px] inline-block text-center" title={moduleName}>
                                  {moduleName}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">-</span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          <DialogFooter className="mt-2 shrink-0">
            <Button variant="outline" onClick={() => { setShowAddCasesDialog(false); setAddCasesSelected(new Set()); setAddCasesSearch(''); setAddCasesModuleFilter(''); setAddCasesPriorityFilter(''); }} disabled={addCasesBusy}>
              Cancel
            </Button>
            <Button onClick={handleAddCases} disabled={addCasesBusy || addCasesSelected.size === 0} className="gradient-btn text-white">
              {addCasesBusy ? 'Adding...' : `Add Selected (${addCasesSelected.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Iterations Dialog Modal ── */}
      {viewingIterationsResult && (() => {
        const tc = getCase(viewingIterationsResult.testCaseId);
        const snap = run?.resolved_datasets?.[viewingIterationsResult.testCaseId];
        const caseDs = snap || tc?.dataset || tc?.local_dataset || (tc as any)?.localDataset;
        const itList = ((viewingIterationsResult.iterationResults || viewingIterationsResult.iteration_results || []) as any[]);
        const rows = (caseDs?.rows || []) as any[];
        const parameters = (caseDs?.parameters || []) as string[];
        const blocks = (caseDs?.blocks || []) as any[];
        const hasBlocks = blocks.length > 0;

        let pass = 0, fail = 0, blocked = 0, skip = 0, invalid = 0, started = 0;
        itList.forEach((it: any) => {
          const s = it.status?.toLowerCase();
          const t = it.time_spent_seconds || 0;
          if (s === 'pass') pass++;
          else if (s === 'fail') fail++;
          else if (s === 'blocked') blocked++;
          else if (s === 'skip') skip++;
          else if (s === 'invalid') invalid++;
          else if (s === 'pending' && t > 0) started++;
        });
        const completed = pass + fail + blocked + skip + invalid;
        const pct = rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;

        const toggleSelectAll = () => {
          if (selectedIterIndices.size === rows.length) {
            setSelectedIterIndices(new Set());
          } else {
            setSelectedIterIndices(new Set(rows.map((_, i) => i + 1)));
          }
        };

        const toggleSelectIter = (iterIdx: number) => {
          setSelectedIterIndices((prev) => {
            const next = new Set(prev);
            if (next.has(iterIdx)) next.delete(iterIdx);
            else next.add(iterIdx);
            return next;
          });
        };

        return (
          <Dialog
            open={!!viewingIterationsResult}
            onOpenChange={(open) => {
              if (!open) {
                setViewingIterationsResult(null);
                setSelectedIterIndices(new Set());
              }
            }}
          >
            <DialogContent hideClose className="max-w-5xl bg-card border-border/80 shadow-2xl rounded-2xl p-0 overflow-hidden flex flex-col max-h-[88vh]">
              <div className="p-4 border-b border-border/60 bg-muted/20 flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-muted text-foreground border border-border/50">
                      {tc?.displayId}
                    </span>
                    <h3 className="text-sm font-bold text-foreground truncate" title={tc?.title}>
                      {tc?.title}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground pt-0.5 flex-wrap">
                    <span>{rows.length} iterations</span>
                    <span>·</span>
                    <span className="text-foreground font-semibold">{completed}/{rows.length} completed ({pct}%)</span>
                    <span>·</span>
                    {started > 0 && <span className="text-[#4aa8ff] font-medium inline-flex items-center gap-1"><i className="running-dot mr-0.5" />{started} running</span>}
                    {pass > 0 && <span className="text-emerald-500 font-medium">{pass} passed</span>}
                    {fail > 0 && <span className="text-red-400 font-medium">{fail} failed</span>}
                    {blocked > 0 && <span className="text-amber-400 font-medium">{blocked} blocked</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => {
                      const cKey = tc?.displayId || tc?.id;
                      setViewingIterationsResult(null);
                      router.push(`/p/${slug}/runs/${runId}/${cKey}`);
                    }}
                    className="h-8 text-xs font-semibold gradient-btn text-white cursor-pointer shadow-xs"
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    <span>Open Console</span>
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewingIterationsResult(null);
                      setSelectedIterIndices(new Set());
                    }}
                    className="h-8 w-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {selectedIterIndices.size > 0 && (
                <div className="mx-4 mt-3 mb-1 p-2 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-between text-xs animate-in fade-in-0 duration-150 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-primary font-mono">{selectedIterIndices.size} selected</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span className="text-muted-foreground text-[11px]">Assign selected to:</span>
                    <select
                      onChange={async (e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : null;
                        try {
                          const nextIters = [...itList];
                          rows.forEach((row: any, rIdx: number) => {
                            const iterIdx = rIdx + 1;
                            if (selectedIterIndices.has(iterIdx)) {
                              const matchIdx = nextIters.findIndex((it: any) => it.iteration_index === iterIdx);
                              if (matchIdx >= 0) {
                                nextIters[matchIdx] = { ...nextIters[matchIdx], assigned_to: val };
                              } else {
                                nextIters.push({ iteration_index: iterIdx, assigned_to: val, row_id: row.id || String(iterIdx), parameters: row, status: 'pending' });
                              }
                            }
                          });
                          await updateRunResultAction(viewingIterationsResult.id, { iterationResults: nextIters });
                          await refetchResults();
                          setViewingIterationsResult((prev: any) => prev ? { ...prev, iterationResults: nextIters } : null);
                          setSelectedIterIndices(new Set());
                          toast.success(`Assigned ${selectedIterIndices.size} iterations`);
                        } catch (err: any) {
                          toast.error(err.message || 'Failed to update assignees');
                        }
                      }}
                      className="bg-background border border-primary/30 rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary max-w-[170px]"
                    >
                      <option value="">Choose member...</option>
                      <option value="">Inherit Case Default</option>
                      {members.map((m: any) => {
                        const u = m.user || m;
                        const uId = m.userId || u?.id;
                        return <option key={uId} value={uId}>{u?.name}</option>;
                      })}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedIterIndices(new Set())}
                    className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer font-medium"
                  >
                    Clear Selection
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <div className="border border-border/60 rounded-xl overflow-x-auto bg-background max-h-[58vh]">
                  <table className="w-full text-xs font-mono min-w-[700px]">
                    <thead className="bg-muted/40 text-muted-foreground border-b border-border/40 text-[10.5px] uppercase font-semibold">
                      {hasBlocks ? (
                        <>
                          <tr>
                            <th rowSpan={2} className="w-10 px-2.5 py-2 text-center align-middle">
                              <Checkbox
                                checked={selectedIterIndices.size === rows.length && rows.length > 0}
                                onCheckedChange={toggleSelectAll}
                              />
                            </th>
                            <th rowSpan={2} className="w-12 px-3 py-2 text-left align-middle border-r border-border/20">#</th>
                            {blocks.map((b: any) => {
                              if (b.type === 'group') {
                                return (
                                  <th
                                    key={b.id}
                                    colSpan={b.params.length}
                                    className="px-3 py-1.5 text-center font-bold border-b border-r border-border/40 bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground"
                                  >
                                    Parameter Group ({b.params.join(', ')})
                                  </th>
                                );
                              }
                              return (
                                <th
                                  key={b.id}
                                  rowSpan={2}
                                  className="px-3 py-2 text-left font-mono font-semibold text-foreground/90 align-bottom border-r border-border/20"
                                >
                                  {b.param}
                                </th>
                              );
                            })}
                            <th rowSpan={2} className="w-24 px-3 py-2 text-left align-bottom border-l border-border/20">Status</th>
                            <th rowSpan={2} className="w-24 px-3 py-2 text-left align-bottom">Duration</th>
                            <th rowSpan={2} className="w-48 px-3 py-2 text-left align-bottom">Assignee</th>
                            <th rowSpan={2} className="w-14 px-3 py-2 text-center align-bottom">Action</th>
                          </tr>

                          <tr className="border-t border-border/30">
                            {blocks.map((b: any) => {
                              if (b.type === 'group') {
                                return b.params.map((col: string) => (
                                  <th
                                    key={col}
                                    className="px-3 py-1.5 text-left font-mono text-foreground/90 font-semibold border-r border-border/20 last:border-r-0"
                                  >
                                    {col}
                                  </th>
                                ));
                              }
                              return null;
                            })}
                          </tr>
                        </>
                      ) : (
                        <tr>
                          <th className="w-10 px-2.5 py-2 text-center">
                            <Checkbox
                              checked={selectedIterIndices.size === rows.length && rows.length > 0}
                              onCheckedChange={toggleSelectAll}
                            />
                          </th>
                          <th className="w-12 px-3 py-2 text-left">#</th>
                          {parameters.map((p: string) => (
                            <th key={p} className="px-3 py-2 text-left font-mono text-foreground/90 font-semibold">
                              {p}
                            </th>
                          ))}
                          <th className="w-24 px-3 py-2 text-left">Status</th>
                          <th className="w-24 px-3 py-2 text-left">Duration</th>
                          <th className="w-48 px-3 py-2 text-left">Assignee</th>
                          <th className="w-14 px-3 py-2 text-center">Action</th>
                        </tr>
                      )}
                    </thead>

                    <tbody className="divide-y divide-border/20">
                      {rows.map((row: any, rIdx: number) => {
                        const iterIdx = rIdx + 1;
                        const iterRes = itList.find((it: any) => it.iteration_index === iterIdx);
                        const iterStatus = iterRes?.status?.toLowerCase() || 'pending';
                        const iterTime = iterRes?.time_spent_seconds || (iterIdx === 1 && !itList.some((x: any) => x.time_spent_seconds > 0) ? (viewingIterationsResult.timeSpentSeconds || 0) : 0);
                        const isStarted = (iterStatus === 'pending' || iterStatus === 'not run') && iterTime > 0;
                        const displayStatus = isStarted ? 'started' : iterStatus;
                        const iterAssigneeId = iterRes?.assigned_to ?? viewingIterationsResult.assignedTo;
                        const iterMember = members.find((m: any) => (m.userId || m.user?.id) === iterAssigneeId);
                        const iterUser = iterMember?.user || iterMember;
                        const caseAssigneeMember = members.find((m: any) => (m.userId || m.user?.id) === viewingIterationsResult.assignedTo);
                        const caseAssigneeUser = caseAssigneeMember?.user || caseAssigneeMember;
                        const isSelected = selectedIterIndices.has(iterIdx);

                        return (
                          <tr
                            key={rIdx}
                            className={cn(
                              "hover:bg-primary/[0.06] dark:hover:bg-white/[0.05] transition-colors",
                              isSelected && "bg-primary/5"
                            )}
                          >
                            <td className="px-2.5 py-2 text-center">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelectIter(iterIdx)}
                              />
                            </td>

                            <td className="px-3 py-2 text-muted-foreground font-bold border-r border-border/20">
                              #{iterIdx}
                            </td>

                            {parameters.map((p: string) => (
                              <td key={p} className="px-3 py-2 font-mono text-foreground/90 border-r border-border/10 last:border-r-0">
                                {row[p] ?? <span className="text-muted-foreground/30 italic">—</span>}
                              </td>
                            ))}

                            <td className="px-3 py-2 border-l border-border/20">
                              <span className={cn(
                                "text-[9px] px-1.5 py-0.5 rounded font-sans uppercase font-bold tracking-wider inline-block",
                                displayStatus === 'pass' && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                                displayStatus === 'fail' && "bg-red-500/15 text-red-400 border border-red-500/30",
                                displayStatus === 'blocked' && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                                displayStatus === 'skip' && "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
                                displayStatus === 'invalid' && "bg-violet-500/15 text-violet-400 border border-violet-500/30",
                                displayStatus === 'unavailable' && "bg-orange-500/15 text-orange-400 border border-orange-500/30",
                                displayStatus === 'started' && "bg-[#4aa8ff]/15 text-[#4aa8ff] border border-[#4aa8ff]/30",
                                displayStatus === 'pending' && "bg-muted text-muted-foreground border border-border/40"
                              )}>
                                {displayStatus === 'started' ? (
                                  <span className="inline-flex items-center gap-1">
                                    <i className="running-dot mr-0.5" />
                                    Running
                                  </span>
                                ) : displayStatus === 'pending' ? 'Not Run' : displayStatus}
                              </span>
                            </td>

                            <td className="px-3 py-2 font-mono text-muted-foreground">
                              {iterTime > 0 ? formatDuration(iterTime) : '—'}
                            </td>

                            <td className="px-3 py-2">
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setEditingModalAssigneeIter(editingModalAssigneeIter === iterIdx ? null : iterIdx)}
                                  className="h-7 px-2 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted/70 text-xs flex items-center gap-1.5 transition-colors cursor-pointer select-none max-w-[170px]"
                                  title={iterUser ? `Assigned to ${iterUser.name}` : `Inherited from case (${caseAssigneeUser?.name || 'Unassigned'})`}
                                >
                                  {iterUser ? (
                                    <>
                                      <UserAvatar name={iterUser.name} imageUrl={iterUser.avatarUrl || iterUser.image} size="sm" className="h-4 w-4 text-[9px]" />
                                      <span className="truncate text-foreground/90 font-medium text-xs">{iterUser.name}</span>
                                    </>
                                  ) : caseAssigneeUser ? (
                                    <>
                                      <UserAvatar name={caseAssigneeUser.name} imageUrl={caseAssigneeUser.avatarUrl || caseAssigneeUser.image} size="sm" className="h-4 w-4 text-[9px] opacity-60" />
                                      <span className="truncate text-muted-foreground text-xs">{caseAssigneeUser.name} (Inherited)</span>
                                    </>
                                  ) : (
                                    <>
                                      <User className="h-3.5 w-3.5 text-muted-foreground/60" />
                                      <span className="text-muted-foreground/60 text-xs">Unassigned</span>
                                    </>
                                  )}
                                  <ChevronDown className="h-3 w-3 text-muted-foreground/60 ml-auto shrink-0" />
                                </button>

                                {editingModalAssigneeIter === iterIdx && (
                                  <>
                                    <div className="fixed inset-0 z-50" onClick={() => setEditingModalAssigneeIter(null)} />
                                    <div className="absolute left-0 top-full mt-1 z-50 w-52 rounded-xl bg-popover border border-border shadow-2xl p-1 text-xs space-y-0.5 animate-in fade-in-0 duration-100 pointer-events-auto">
                                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono border-b border-border/40 mb-1">
                                        Assign Iteration #{iterIdx}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setEditingModalAssigneeIter(null);
                                          try {
                                            const nextIters = [...itList];
                                            const matchIdx = nextIters.findIndex((it: any) => it.iteration_index === iterIdx);
                                            if (matchIdx >= 0) {
                                              nextIters[matchIdx] = { ...nextIters[matchIdx], assigned_to: null };
                                            } else {
                                              nextIters.push({ iteration_index: iterIdx, assigned_to: null, row_id: row.id || String(iterIdx), parameters: row, status: 'pending' });
                                            }
                                            await updateRunResultAction(viewingIterationsResult.id, { iterationResults: nextIters });
                                            await refetchResults();
                                            setViewingIterationsResult((prev: any) => prev ? { ...prev, iterationResults: nextIters } : null);
                                            toast.success(`Iteration #${iterIdx} set to inherit case default`);
                                          } catch (err: any) {
                                            toast.error(err.message || 'Failed to update assignee');
                                          }
                                        }}
                                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted text-xs transition-colors cursor-pointer flex items-center justify-between"
                                      >
                                        <span className="truncate">Inherit ({caseAssigneeUser?.name || 'Unassigned'})</span>
                                        {!iterRes?.assigned_to && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                                      </button>
                                      <div className="border-t border-border/40 my-0.5" />
                                      <div className="max-h-40 overflow-y-auto space-y-0.5">
                                        {members.map((m: any) => {
                                          const u = m.user || m;
                                          const uId = m.userId || u?.id;
                                          const isCur = iterRes?.assigned_to === uId;
                                          return (
                                            <button
                                              key={uId}
                                              type="button"
                                              onClick={async () => {
                                                setEditingModalAssigneeIter(null);
                                                try {
                                                  const nextIters = [...itList];
                                                  const matchIdx = nextIters.findIndex((it: any) => it.iteration_index === iterIdx);
                                                  if (matchIdx >= 0) {
                                                    nextIters[matchIdx] = { ...nextIters[matchIdx], assigned_to: uId };
                                                  } else {
                                                    nextIters.push({ iteration_index: iterIdx, assigned_to: uId, row_id: row.id || String(iterIdx), parameters: row, status: 'pending' });
                                                  }
                                                  await updateRunResultAction(viewingIterationsResult.id, { iterationResults: nextIters });
                                                  await refetchResults();
                                                  setViewingIterationsResult((prev: any) => prev ? { ...prev, iterationResults: nextIters } : null);
                                                  toast.success(`Iteration #${iterIdx} assigned to ${u?.name}`);
                                                } catch (err: any) {
                                                  toast.error(err.message || 'Failed to update assignee');
                                                }
                                              }}
                                              className={cn(
                                                "w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between text-xs hover:bg-muted transition-colors cursor-pointer",
                                                isCur && "font-semibold text-primary"
                                              )}
                                            >
                                              <div className="flex items-center gap-2 truncate min-w-0">
                                                <UserAvatar name={u.name} imageUrl={u.avatarUrl || u.image} size="sm" className="h-4 w-4 text-[9px]" />
                                                <span className="truncate">{u.name}</span>
                                              </div>
                                              {isCur && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </td>

                            <td className="px-3 py-2 text-center">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const cKey = tc?.displayId || tc?.id;
                                  setViewingIterationsResult(null);
                                  setSelectedIterIndices(new Set());
                                  router.push(`/p/${slug}/runs/${runId}/${cKey}?iteration=${iterIdx}`);
                                }}
                                className="h-7 w-7 p-0 rounded-lg text-primary hover:text-primary hover:bg-primary/10 cursor-pointer flex items-center justify-center mx-auto transition-colors"
                                title={`Run Iteration #${iterIdx}`}
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-3 border-t border-border/60 bg-muted/20 flex items-center justify-between text-xs">
                {members.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const nextIters = [...itList];
                        rows.forEach((row: any, rIdx: number) => {
                          const iterIdx = rIdx + 1;
                          const mIdx = rIdx % members.length;
                          const assignedToId = members[mIdx].userId || members[mIdx].user?.id;
                          const matchIdx = nextIters.findIndex((it: any) => it.iteration_index === iterIdx);
                          if (matchIdx >= 0) {
                            nextIters[matchIdx] = { ...nextIters[matchIdx], assigned_to: assignedToId };
                          } else {
                            nextIters.push({ iteration_index: iterIdx, assigned_to: assignedToId, row_id: row.id || String(iterIdx), parameters: row, status: 'pending' });
                          }
                        });
                        await updateRunResultAction(viewingIterationsResult.id, { iterationResults: nextIters });
                        await refetchResults();
                        setViewingIterationsResult((prev: any) => prev ? { ...prev, iterationResults: nextIters } : null);
                        toast.success(`Split iterations evenly across ${members.length} members`);
                      } catch (err: any) {
                        toast.error(err.message || 'Failed to split iterations');
                      }
                    }}
                    className="h-7 text-xs font-mono font-medium text-primary border-primary/30 hover:bg-primary/10 cursor-pointer shadow-2xs"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5 text-primary" />
                    <span>Split Evenly Across {members.length} Members</span>
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setViewingIterationsResult(null);
                    setSelectedIterIndices(new Set());
                  }}
                  className="text-xs cursor-pointer ml-auto"
                >
                  Close
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {confirmConfig && (
        <ConfirmModal
          open={confirmConfig.open}
          onOpenChange={(open) => !open && setConfirmConfig(null)}
          title={confirmConfig.title}
          description={confirmConfig.description}
          confirmLabel={confirmConfig.confirmLabel}
          variant={confirmConfig.variant || 'default'}
          requireTypedConfirmation={confirmConfig.requireTypedConfirmation}
          onConfirm={() => {
            confirmConfig.onConfirm();
            setConfirmConfig(null);
          }}
        />
      )}

      {/* ── Assign Iterations Dialog ── */}
      <Dialog open={!!assignItersResult} onOpenChange={(open) => !open && setAssignItersResult(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Assign Iterations</DialogTitle>
            <DialogDescription>
              Override the case assignee for specific iterations, or split them evenly across the team.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-4 max-h-[60vh] overflow-y-auto">
            {assignItersResult && (() => {
              const testCase = getCase(assignItersResult.testCaseId);
              const caseDs = run?.resolved_datasets?.[assignItersResult.testCaseId] || testCase?.dataset || testCase?.local_dataset || (testCase as any)?.localDataset;
              const rows = caseDs?.rows || [];
              const iterResultsList = (assignItersResult.iterationResults || assignItersResult.iteration_results || []) as any[];
              
              const handleSplitEvenly = async () => {
                const team = members.filter(m => m.user || m.userId);
                if (team.length === 0 || rows.length === 0) return;
                const nextIters = [...iterResultsList];
                rows.forEach((_: any, idx: number) => {
                  const assigneeId = team[idx % team.length].userId || team[idx % team.length].user?.id;
                  const matchIdx = nextIters.findIndex((it: any) => it.iteration_index === idx + 1);
                  if (matchIdx >= 0) {
                    nextIters[matchIdx] = { ...nextIters[matchIdx], assigned_to: assigneeId };
                  } else {
                    nextIters.push({ iteration_index: idx + 1, assigned_to: assigneeId });
                  }
                });
                try {
                  await updateRunResultAction(assignItersResult.id, { iterationResults: nextIters });
                  await refetchResults();
                  toast.success(`Iterations split across ${team.length} members`);
                  setAssignItersResult(null);
                } catch (e: any) {
                  toast.error(e.message || 'Failed to split iterations');
                }
              };

              const handleAssignOne = async (idx: number, assigneeId: number | null) => {
                const nextIters = [...iterResultsList];
                const matchIdx = nextIters.findIndex((it: any) => it.iteration_index === idx + 1);
                if (matchIdx >= 0) {
                  nextIters[matchIdx] = { ...nextIters[matchIdx], assigned_to: assigneeId };
                } else {
                  nextIters.push({ iteration_index: idx + 1, assigned_to: assigneeId });
                }
                try {
                  await updateRunResultAction(assignItersResult.id, { iterationResults: nextIters });
                  await refetchResults();
                  setAssignItersResult((prev: any) => prev ? { ...prev, iterationResults: nextIters } : null);
                  toast.success(`Iteration #${idx + 1} assigned`);
                } catch (e: any) {
                  toast.error(e.message || 'Failed to assign iteration');
                }
              };

              return (
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={handleSplitEvenly} className="text-xs">
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      Split evenly across team
                    </Button>
                  </div>
                  <div className="border rounded-xl divide-y">
                    {rows.map((row: any, idx: number) => {
                      const ir = iterResultsList.find((it: any) => it.iteration_index === idx + 1);
                      const iterAssigneeId = ir?.assigned_to || assignItersResult.assignedTo;
                      const paramEntries = Object.entries(row).filter(([k]) => k !== 'id').slice(0, 2).map(([k, v]) => `${k}:${v}`).join(', ');
                      return (
                        <div key={idx} className="flex items-center justify-between p-3 bg-muted/10">
                          <div className="min-w-0 pr-4">
                            <div className="font-mono text-xs font-semibold">Iteration {idx + 1}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{paramEntries}</div>
                          </div>
                          <select
                            value={ir?.assigned_to || ''}
                            onChange={(e) => handleAssignOne(idx, e.target.value ? parseInt(e.target.value, 10) : null)}
                            className="w-48 bg-background border rounded-lg px-2 py-1.5 text-xs focus:ring-1 focus:ring-primary"
                          >
                            <option value="">{assignItersResult.assignedTo ? 'Inherit Case Default' : 'Unassigned'}</option>
                            {members.map((m: any) => {
                              const u = m.user || m;
                              return <option key={u.id} value={u.id}>{u.name}</option>;
                            })}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignItersResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

