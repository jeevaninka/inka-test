"use client";

import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useMemo, useEffect } from 'react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/common/DataTable';
import { RunStatusBadge } from '@/components/common/RunStatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { UserAvatar } from '@/components/common/UserAvatar';
import { AdvancedFilters } from '@/components/common/AdvancedFilters';
import { AutomationFilter } from '@/components/common/AutomationFilter';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { SplitButton } from '@/components/ui/split-button';
import dynamic from 'next/dynamic';
import { PostmanLogo, DatadogLogo } from '@/components/icons/IntegrationLogos';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Tooltip } from '@/components/ui/tooltip';
import { ProgressCircle } from '@/components/common/ProgressCircle';
import { QualityTrendChart } from '@/components/common/QualityTrendChart';
import { Play, Plus, Trash2, CheckCircle2, XCircle, Ban, X, Copy, Layers, Search, Clock, ArrowRight, FileText, MoreVertical, Check, AlertTriangle, SkipForward, RotateCcw, Rocket, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatDuration } from '@/lib/utils';
import { bulkDeleteRunsAction, bulkFinishRunsAction, cloneTestRunAction, archiveTestRunAction, restoreTestRunAction, updateTestRunAction, getArchivedRunsAction, deleteTestRunAction, rerunTestRunAction, getProjectRunsAction } from '@/app/actions/runs';
import { getProjectReleasesAction } from '@/app/actions/releases';
import type { TestRun } from '@/lib/types';
import type { FilterField } from '@/components/common/AdvancedFilters';

const CreateRunModal = dynamic(
  () => import('@/components/runs/CreateRunModal').then((m) => m.CreateRunModal),
  { ssr: false }
);

const GenerateTestCasesDialog = dynamic(
  () => import('@/components/cases/GenerateTestCasesDialog').then((m) => m.GenerateTestCasesDialog),
  { ssr: false }
);

export function RunsClient({ initialRuns, projectReleases: initialProjectReleases }: { initialRuns?: any[], projectReleases?: any[] }) {
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const router = useRouter();

  const { project, runs: contextRuns, suites, members, currentUser, setRuns, canEdit = true, isAdmin = false } = useProjectData();
  const runs = initialRuns || contextRuns;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<'archive' | 'finish' | null>(null);
  const [singleArchiveId, setSingleArchiveId] = useState<string | null>(null);
  const [singleDeleteId, setSingleDeleteId] = useState<string | null>(null);
  const [rerunRunModal, setRerunRunModal] = useState<{ open: boolean; run: any } | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showCreateRunModal, setShowCreateRunModal] = useState(false);
  const [createRunType, setCreateRunType] = useState<'manual' | 'postman' | 'datadog'>('manual');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importSourceMode, setImportSourceMode] = useState<'prompt' | 'postman' | 'datadog'>('prompt');
  const [showAdhocRuns, setShowAdhocRuns] = useState(false);
  const [cloneRunId, setCloneRunId] = useState<string | null>(null);
  const [cloneForm, setCloneForm] = useState({ name: '', environment: '', assignee: '', cloneAssignments: false });
  const [cloneBusy, setCloneBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [openRowMenuId, setOpenRowMenuId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: '',
    environment: '',
    suite: '',
    source: '',
    createdBy: '',
    release: '',
  });
  const [projectReleases, setProjectReleases] = useState<any[]>(initialProjectReleases || []);

  useEffect(() => {
    if (project?.id) {
      getProjectReleasesAction(project.id).then((rels) => {
        setProjectReleases(rels);
      }).catch(() => {});
    }
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id) return;
    const hasLiveCases = runs.some((r: any) => {
      const isFinished = r.status === 'completed' || r.status === 'completed_with_errors' || r.status === 'failed' || r.status === 'aborted';
      return r.status === 'in_progress' || !isFinished;
    });
    if (!hasLiveCases) return;
    const timer = setInterval(async () => {
      try {
        const freshRuns = await getProjectRunsAction(project.id);
        setRuns(freshRuns);
      } catch (e) {}
    }, 15000);
    return () => clearInterval(timer);
  }, [project?.id, runs, setRuns]);

  const [showTrends, setShowTrends] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedRuns, setArchivedRuns] = useState<any[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);

  // Fetch archived runs when toggling to archived tab
  const handleShowArchived = async () => {
    if (!project) return;
    if (showArchived) { setShowArchived(false); return; }
    setShowArchived(true);
    if (archivedRuns.length > 0) return;
    setArchivedLoading(true);
    try {
      const data = await getArchivedRunsAction(project.id);
      setArchivedRuns(data);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load archived runs');
    } finally {
      setArchivedLoading(false);
    }
  };

  const isAdhocRun = (r: any) =>
    Boolean(
      r?.runContext?.adhoc ||
        r?.run_context?.adhoc ||
        r?.customFields?.adhoc ||
        r?.custom_fields?.adhoc
    );
  const adhocRunCount = runs.filter(isAdhocRun).length;

  const runAutomationCounts = useMemo(() => {
    let manual = 0;
    let postman = 0;
    let datadog = 0;
    for (const r of runs as any[]) {
      if (r.source === 'postman') postman += 1;
      else if (r.source === 'datadog') datadog += 1;
      else manual += 1;
    }
    return {
      all: runs.length,
      manual,
      auto: postman + datadog,
      postman,
      datadog,
      external: 0,
    };
  }, [runs]);

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((r: any) => {
      // Case-detail Run creates a lightweight "Ad-hoc" run; hidden by default.
      if (!showAdhocRuns && isAdhocRun(r)) return false;
      if (filters.status) {
        const stats = getRunProgressStats(r);
        if (filters.status === 'running' && !stats.isRunning) return false;
        if (filters.status === 'passed' && !stats.isPassed) return false;
        if (filters.status === 'failed' && !stats.isFailed) return false;
        if (filters.status === 'aborted' && !stats.isAborted) return false;
      }
      if (filters.environment && r.environment !== filters.environment) return false;
      if (filters.suite && r.suiteId !== filters.suite) return false;
      if (filters.createdBy && String(r.createdBy) !== filters.createdBy) return false;
      if (filters.release && r.releaseId !== filters.release && r.release_id !== filters.release) return false;
      // Mode + source: runs store a single `source`; manual runs may be stored as empty or "manual".
      const runSource = String(r.source || 'manual');
      if (filters.source === 'manual' && runSource !== 'manual') return false;
      if (filters.source === 'postman' && runSource !== 'postman') return false;
      if (filters.source === 'datadog' && runSource !== 'datadog') return false;
      if (filters.source === 'automated' && runSource !== 'postman' && runSource !== 'datadog') return false;
      if (q) {
        const matchesName = r.name?.toLowerCase().includes(q);
        const matchesId = r.id?.toLowerCase().includes(q);
        const suite = suites.find((s: any) => s.id === r.suiteId || s.id === r.suite_id);
        const matchesSuite = suite?.name?.toLowerCase().includes(q);
        const matchesEnv = r.environment?.toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesSuite && !matchesEnv) return false;
      }
      return true;
    });
  }, [runs, filters, search, suites, showAdhocRuns]);

  const activeFilterCount = [filters.status, filters.environment, filters.suite, filters.source, filters.createdBy, filters.release].filter(Boolean).length;

  const clearFilters = () => setFilters({ status: '', environment: '', suite: '', source: '', createdBy: '', release: '' });

  const filterFields: FilterField[] = [
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      value: filters.status,
      onChange: (v) => setFilters((p) => ({ ...p, status: v || '' })),
      options: [
        { label: 'Running', value: 'running' },
        { label: 'Passed', value: 'passed' },
        { label: 'Attention / Failed', value: 'failed' },
        { label: 'Aborted', value: 'aborted' },
      ],
    },
    {
      id: 'environment',
      label: 'Environment',
      type: 'select',
      value: filters.environment,
      onChange: (v) => setFilters((p) => ({ ...p, environment: v || '' })),
      options: [...new Set(runs.map((r: any) => r.environment))].map((e: any) => ({ label: e, value: e })),
    },
    {
      id: 'suite',
      label: 'Suite',
      type: 'select',
      value: filters.suite,
      onChange: (v) => setFilters((p) => ({ ...p, suite: v || '' })),
      options: suites.map((s: any) => ({ label: s.name, value: s.id })),
    },
    {
      id: 'createdBy',
      label: 'Created by',
      type: 'select',
      value: filters.createdBy,
      onChange: (v) => setFilters((p) => ({ ...p, createdBy: v || '' })),
      options: members.map((m: any) => ({ label: m.user?.name || `User #${m.userId}`, value: String(m.userId) })),
    },
    ...(projectReleases.length > 0 ? [{
      id: 'release',
      label: 'Release',
      type: 'select' as const,
      value: filters.release,
      onChange: (v: any) => setFilters((p) => ({ ...p, release: v || '' })),
      options: projectReleases.map((rel: any) => ({ label: rel.name, value: rel.id })),
    }] : []),
    {
      id: 'source',
      label: 'Mode & source',
      type: 'custom',
      value: filters.source,
      custom: (
        <AutomationFilter
          mode={filters.source === 'manual' ? 'manual' : filters.source ? 'auto' : ''}
          source={filters.source === 'postman' || filters.source === 'datadog' ? filters.source : ''}
          counts={runAutomationCounts}
          externalLabel="None"
          showExternal={false}
          compact
          onChange={({ mode, source }) => {
            const next = mode === 'manual' ? 'manual' : mode === 'auto' ? source || 'automated' : '';
            setFilters((p) => ({ ...p, source: next }));
          }}
        />
      ),
    },
  ];

  if (!project) return null;

  const selectedRuns = filteredRuns.filter((r: any) => selectedIds.has(r.id));
  const hasInProgress = selectedRuns.some((r: any) => r.status === 'in_progress');

  const handleBulkDelete = async () => {
    setBusy(true);
    try {
      await bulkDeleteRunsAction(Array.from(selectedIds));
      toast.success(`Deleted ${selectedIds.size} run(s)`);
      setSelectedIds(new Set());
      setConfirmAction(null);
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkFinish = async () => {
    setBusy(true);
    try {
      await bulkFinishRunsAction(Array.from(selectedIds));
      toast.success(`Finished ${selectedIds.size} run(s)`);
      setSelectedIds(new Set());
      setConfirmAction(null);
    } catch (e: any) {
      toast.error(e.message || 'Failed to finish');
    } finally {
      setBusy(false);
    }
  };

  const handleClone = (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) { toast.error('Not authenticated'); return; }
    const run = runs.find((r: any) => r.id === runId);
    if (!run) return;
    setCloneRunId(runId);
    setCloneForm({ name: `${run.name} (Copy)`, environment: run.environment, assignee: run.assignedTo || '', cloneAssignments: false });
    setShowCloneDialog(true);
  };

  const confirmClone = async () => {
    if (!currentUser || !cloneRunId) return;
    setCloneBusy(true);
    try {
      const cloned = await cloneTestRunAction(cloneRunId, currentUser.id, {
        name: cloneForm.name,
        environment: cloneForm.environment,
        assignee: cloneForm.assignee ? Number(cloneForm.assignee) : undefined,
        cloneCaseAssignments: cloneForm.cloneAssignments,
      });
      toast.success(`Cloned as "${cloned.name}"`);
      setShowCloneDialog(false);
      setCloneRunId(null);
      router.push(`/p/${slug}/runs/${cloned.id}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to clone');
    } finally {
      setCloneBusy(false);
    }
  };

  const handleRerunClick = (run: any) => {
    setRerunRunModal({ open: true, run });
  };

  const confirmRerunRun = async (mode: 'all' | 'failed_blocked') => {
    if (!currentUser || !rerunRunModal?.run) return;
    setBusy(true);
    try {
      const result = await rerunTestRunAction(rerunRunModal.run.id, currentUser.id, mode);
      toast.success(`Created retest run with ${result.count} case(s)`);
      setRerunRunModal(null);
      router.push(`/p/${slug}/runs/${result.id}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to rerun');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    setBusy(true);
    try {
      await deleteTestRunAction(runId);
      setRuns(runs.filter((r: any) => r.id !== runId));
      toast.success('Test run deleted');
      setSingleDeleteId(null);
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete run');
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveRun = (runId: string) => {
    setSingleArchiveId(runId);
  };

  const handleRestoreRun = async (runId: string) => {
    try {
      await restoreTestRunAction(runId);
      const run = archivedRuns.find((r: any) => r.id === runId);
      setArchivedRuns(archivedRuns.filter((r: any) => r.id !== runId));
      if (run) setRuns([...runs, run]);
      toast.success('Run restored');
    } catch (e: any) {
      toast.error(e.message || 'Failed to restore');
    }
  };

  const handleBulkArchive = async () => {
    setConfirmAction('archive');
  };

  const confirmBulkArchive = async () => {
    setBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const archived = runs.filter((r: any) => selectedIds.has(r.id));
      for (const id of ids) {
        await archiveTestRunAction(id);
      }
      setRuns(runs.filter((r: any) => !selectedIds.has(r.id)));
      setArchivedRuns([...archived, ...archivedRuns]);
      toast.success(`Deleted ${selectedIds.size} run(s)`);
      setSelectedIds(new Set());
      setConfirmAction(null);
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete runs');
    } finally {
      setBusy(false);
    }
  };

  function getRunProgressStats(row: any) {
    const rawResults = row.results || [];
    const sorted = [...rawResults].sort((a: any, b: any) => (b.attempt_number || 1) - (a.attempt_number || 1));
    const seen = new Set<string>();
    const results = sorted.filter((r: any) => {
      if (seen.has(r.test_case_id)) return false;
      seen.add(r.test_case_id);
      return true;
    });

    const total = results.length;
    const pass = results.filter((r: any) => String(r.status).toLowerCase() === 'pass').length;
    const fail = results.filter((r: any) => String(r.status).toLowerCase() === 'fail').length;
    const error = results.filter((r: any) => String(r.status).toLowerCase() === 'error').length;
    const blocked = results.filter((r: any) => String(r.status).toLowerCase() === 'blocked').length;
    const skip = results.filter((r: any) => String(r.status).toLowerCase() === 'skip').length;
    const invalid = results.filter((r: any) => String(r.status).toLowerCase() === 'invalid').length;
    // "Unavailable" is a resolved outcome (provider never returned a terminal
    // result); it must not keep the run looking in-progress or count as a failure.
    const unavailable = results.filter((r: any) => String(r.status).toLowerCase() === 'unavailable').length;
    const completed = pass + fail + error + blocked + skip + invalid + unavailable;
    const pending = Math.max(0, total - completed);
    const started = results.filter((r: any) => String(r.status).toLowerCase() === 'pending' && (!r.attempt_number || r.attempt_number === 1) && (r.time_spent_seconds || 0) > 0).length;
    const completedPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const isAllResolved = total > 0 && completed === total;
    const isAborted = row.status === 'aborted';
    const isFinished = row.status === 'completed' || row.status === 'completed_with_errors' || row.status === 'failed' || isAllResolved;
    const isFailed = !isAborted && isFinished && (fail > 0 || error > 0);
    const isPassed = !isAborted && isFinished && !isFailed;
    const isRunning = !isAborted && !isFinished;

    return {
      total,
      pass,
      fail,
      error,
      blocked,
      skip,
      invalid,
      unavailable,
      pending,
      started,
      completed,
      completedPct,
      isAllResolved,
      isAborted,
      isFinished,
      isFailed,
      isPassed,
      isRunning,
    };
  }

  // Quality trend calculation strictly across completed/finalized runs.
  // Ad-hoc single-case runs are excluded so they do not skew quality trends.
  const trendsData = useMemo(() => {
    const completedRuns = [...runs]
      .filter((r: any) => !isAdhocRun(r))
      .filter((r: any) => {
        const stats = getRunProgressStats(r);
        const status = String(r.status || '').toLowerCase();
        // Only include completed, failed, or fully resolved runs (not in-progress drafts)
        return (status === 'completed' || status === 'completed_with_errors' || status === 'failed' || stats.isAllResolved);
      })
      .sort((a: any, b: any) => {
        const tA = new Date(a.started_at || a.startedAt || a.created_at || a.createdAt || 0).getTime();
        const tB = new Date(b.started_at || b.startedAt || b.created_at || b.createdAt || 0).getTime();
        return tA - tB;
      });

    return completedRuns.map((r: any) => {
      const s = getRunProgressStats(r);
      // Honest pass rate: passed / total test cases in run
      const honestRate = s.total > 0 ? Math.round((s.pass / s.total) * 100) : 0;
      const execDate = r.started_at || r.startedAt || r.created_at || r.createdAt || r.completed_at || r.completedAt;
      return {
        id: r.id,
        name: r.name,
        environment: r.environment || 'STAGING',
        passRate: honestRate,
        pass: s.pass,
        fail: s.fail,
        pending: s.pending,
        invalid: s.invalid,
        unavailable: s.unavailable,
        total: s.total,
        date: new Date(execDate || new Date().toISOString()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : r.createdAt ? new Date(r.createdAt).toISOString() : undefined,
        completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : r.completedAt ? new Date(r.completedAt).toISOString() : null,
        startedAt: r.started_at ? new Date(r.started_at).toISOString() : r.startedAt ? new Date(r.startedAt).toISOString() : null,
      };
    });
  }, [runs]);

  const avgPassRate = useMemo(() => {
    if (trendsData.length === 0) return 0;
    return Math.round(trendsData.reduce((acc, r) => acc + r.passRate, 0) / trendsData.length);
  }, [trendsData]);

  const columns = [
    {
      id: 'name',
      header: 'Run',
      className: 'flex-1 min-w-[220px] text-left pr-4',
      accessor: (row: any) => {
        const stats = getRunProgressStats(row);
        const rel = projectReleases.find((x) => x.id === row.releaseId || x.id === row.release_id);

        // Duration / Timing formatting
        let durationText = '';
        if (row.startedAt) {
          const startDate = new Date(row.startedAt);
          if (row.completedAt) {
            const endDate = new Date(row.completedAt);
            const durationSecs = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 1000));
            durationText = `Duration: ${formatDuration(durationSecs)}`;
          } else if (stats.isFinished) {
            durationText = 'Completed';
          } else {
            durationText = 'Running';
          }
        }

        return (
          <div className="flex flex-col gap-1 py-0.5 min-w-0">
            {/* Line 1: Teal Run ID (no pill bg) + Run Name (hover teal) */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs font-semibold text-primary shrink-0">
                {row.id}
              </span>
              <span className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors cursor-pointer" title={row.name}>
                {row.name}
              </span>
              {(row.source === 'postman' || row.source === 'datadog') && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wide shrink-0',
                    row.source === 'postman'
                      ? 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400'
                      : 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                  )}
                  title={row.source === 'postman' ? 'Postman run' : 'Datadog Synthetic run'}
                >
                  {row.source === 'postman' ? (
                    <PostmanLogo className="h-3 w-3" />
                  ) : (
                    <DatadogLogo className="h-3 w-3" />
                  )}
                  {row.source}
                </span>
              )}
              {isAdhocRun(row) && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border/60 bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0"
                  title="Ad-hoc run created from a single test case; excluded from quality trends"
                >
                  Ad-hoc
                </span>
              )}
            </div>

            {/* Line 2: Release (if present) · Duration */}
            {(rel || durationText) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 flex-wrap sm:flex-nowrap">
                {rel && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 hover:text-primary transition-colors truncate max-w-[200px]"
                    title={`Release: ${rel.name}`}
                  >
                    <Rocket className="w-3 h-3 text-primary/70 shrink-0" />
                    <span className="truncate">{rel.name}</span>
                  </span>
                )}

                {rel && durationText && <span className="opacity-40">·</span>}

                {durationText && (
                  <span className="font-mono text-[11px] text-muted-foreground/70 truncate whitespace-nowrap">
                    {durationText}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      },
      sortable: true,
    },
    {
      id: 'environment',
      header: 'Env',
      className: 'w-24 shrink-0 text-left',
      sortable: true,
      accessor: (row: any) => {
        const env = String(row.environment || 'Default').toUpperCase();
        return (
          <span className="font-mono text-xs font-medium uppercase text-muted-foreground">
            {env}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      className: 'w-28 shrink-0 text-left',
      sortable: true,
      accessor: (row: any) => {
        const stats = getRunProgressStats(row);

        return (
          <div className="flex items-center text-xs font-semibold whitespace-nowrap select-none">
            {stats.isRunning && (
              <span className="inline-flex items-center gap-1.5 text-blue-400">
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                <span>Running</span>
              </span>
            )}
            {stats.isPassed && (
              <span className="inline-flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 stroke-[2.5] shrink-0" />
                <span>Passed</span>
              </span>
            )}
            {stats.isFailed && (
              <span className="inline-flex items-center gap-1.5 text-rose-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>Attention</span>
              </span>
            )}
            {stats.isAborted && (
              <span className="inline-flex items-center gap-1.5 text-zinc-400">
                <Ban className="h-3.5 w-3.5 shrink-0" />
                <span>Aborted</span>
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'progress',
      header: 'Progress',
      className: 'w-28 shrink-0 text-left',
      accessor: (row: any) => {
        const stats = getRunProgressStats(row);

        if (stats.total === 0) return <span className="text-xs text-muted-foreground/40 font-mono">—</span>;

        return (
          <div className="flex items-center gap-2.5 w-full select-none">
            {/* Progress Circle with hover breakdown Tooltip */}
            <Tooltip
              side="top"
              align="center"
              className="p-0 border border-border bg-popover text-popover-foreground rounded-xl shadow-2xl overflow-hidden max-w-none text-xs select-none whitespace-normal min-w-[220px]"
              content={
                <div className="flex flex-col text-xs font-sans">
                  <div className="px-3 py-2 border-b border-border/50 bg-muted/40 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground font-semibold text-[10px] uppercase tracking-wider">
                      <Clock className="h-3 w-3 text-primary" />
                      <span>Execution Breakdown</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground font-semibold">
                      {stats.total} cases
                    </span>
                  </div>

                  <div className="p-2 space-y-1 font-mono text-xs">
                    {stats.pass > 0 && (
                      <div className="flex items-center justify-between gap-4 px-2 py-0.5 rounded text-xs text-emerald-400 font-medium">
                        <span className="flex items-center gap-1.5 font-sans">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          <span>Passed</span>
                        </span>
                        <span className="font-bold">{stats.pass}</span>
                      </div>
                    )}
                    {stats.fail > 0 && (
                      <div className="flex items-center justify-between gap-4 px-2 py-0.5 rounded text-xs text-rose-400 font-medium">
                        <span className="flex items-center gap-1.5 font-sans">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                          <span>Failed</span>
                        </span>
                        <span className="font-bold">{stats.fail}</span>
                      </div>
                    )}
                    {stats.error > 0 && (
                      <div className="flex items-center justify-between gap-4 px-2 py-0.5 rounded text-xs text-violet-400 font-medium">
                        <span className="flex items-center gap-1.5 font-sans">
                          <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                          <span>Error</span>
                        </span>
                        <span className="font-bold">{stats.error}</span>
                      </div>
                    )}
                    {stats.blocked > 0 && (
                      <div className="flex items-center justify-between gap-4 px-2 py-0.5 rounded text-xs text-amber-400 font-medium">
                        <span className="flex items-center gap-1.5 font-sans">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          <span>Blocked</span>
                        </span>
                        <span className="font-bold">{stats.blocked}</span>
                      </div>
                    )}
                    {stats.skip > 0 && (
                      <div className="flex items-center justify-between gap-4 px-2 py-0.5 rounded text-xs text-slate-300 font-medium">
                        <span className="flex items-center gap-1.5 font-sans">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                          <span>Skipped</span>
                        </span>
                        <span className="font-bold">{stats.skip}</span>
                      </div>
                    )}
                    {stats.invalid > 0 && (
                      <div className="flex items-center justify-between gap-4 px-2 py-0.5 rounded text-xs text-violet-400 font-medium">
                        <span className="flex items-center gap-1.5 font-sans">
                          <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                          <span>Invalid</span>
                        </span>
                        <span className="font-bold">{stats.invalid}</span>
                      </div>
                    )}
                    {stats.unavailable > 0 && (
                      <div className="flex items-center justify-between gap-4 px-2 py-0.5 rounded text-xs text-orange-400 font-medium">
                        <span className="flex items-center gap-1.5 font-sans">
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                          <span>Result unavailable</span>
                        </span>
                        <span className="font-bold">{stats.unavailable}</span>
                      </div>
                    )}
                    {stats.started > 0 && (
                      <div className="flex items-center justify-between gap-4 px-2 py-0.5 rounded text-xs text-[#4aa8ff] font-medium">
                        <span className="flex items-center gap-1.5 font-sans">
                          <i className="running-dot mr-0.5" />
                          <span>Running</span>
                        </span>
                        <span className="font-bold">{stats.started}</span>
                      </div>
                    )}
                    {stats.pending > 0 && (
                      <div className="flex items-center justify-between gap-4 px-2 py-0.5 rounded text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5 font-sans">
                          <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                          <span>Not run</span>
                        </span>
                        <span>{stats.pending}</span>
                      </div>
                    )}
                  </div>

                  <div className="px-3 py-1.5 border-t border-white/10 bg-white/[0.02] flex items-center justify-between gap-4 font-semibold text-[11px]">
                    <span className="text-muted-foreground font-sans">Completed</span>
                    <span className="text-foreground font-mono font-bold">
                      {stats.completed}/{stats.total} ({stats.completedPct}%)
                    </span>
                  </div>
                </div>
              }
            >
              <div className="flex items-center gap-2 cursor-pointer">
                <ProgressCircle
                  segments={{
                    pass: stats.pass,
                    fail: stats.fail + stats.error,
                    blocked: stats.blocked,
                    invalid: stats.invalid,
                    skip: stats.skip,
                    total: stats.total,
                  }}
                  size={28}
                  strokeWidth={3}
                />
                <div className="flex flex-col min-w-[46px]">
                  <div className="flex items-center gap-1">
                    <span className={cn(
                      "font-bold font-mono text-xs leading-tight",
                      stats.isFailed ? "text-rose-400" : stats.isPassed ? "text-emerald-400" : "text-foreground"
                    )}>
                      {stats.completedPct}%
                    </span>
                    {stats.fail > 0 && (
                      <span className="text-[10px] font-mono font-bold text-rose-400 leading-tight">
                        · {stats.fail}F
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground leading-tight">
                    {stats.completed}/{stats.total}
                  </span>
                </div>
              </div>
            </Tooltip>
          </div>
        );
      },
    },
    {
      id: 'createdAt',
      header: 'Date',
      className: 'w-28 shrink-0 text-left',
      sortable: true,
      sortValue: (row: any) => new Date(row.startedAt || row.createdAt).getTime(),
      accessor: (row: any) => {
        const d = new Date(row.startedAt || row.createdAt);
        const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return (
          <div className="flex flex-col text-xs font-mono">
            <span className="text-foreground/90 leading-tight whitespace-nowrap">{datePart}</span>
            <span className="text-[11px] text-muted-foreground leading-tight mt-0.5 whitespace-nowrap">{timePart}</span>
          </div>
        );
      },
    },
    {
      id: 'createdBy',
      header: 'Author',
      className: 'w-14 shrink-0 text-center',
      accessor: (row: any) => {
        const member = members.find((m: any) => m.userId === row.createdBy);
        const name = member?.user?.name || `User #${row.createdBy}`;

        return (
          <Tooltip content={name} side="top">
            <div className="flex items-center justify-center cursor-pointer">
              {member ? (
                <UserAvatar
                  name={member.user.name}
                  imageUrl={member.user.avatarUrl}
                  size="sm"
                  className="h-6 w-6 text-[10px] shrink-0 mx-auto"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[10px] text-muted-foreground shrink-0 mx-auto">
                  U
                </div>
              )}
            </div>
          </Tooltip>
        );
      },
    },
    {
      id: 'action',
      header: '',
      className: 'w-10 shrink-0 text-center',
      accessor: (row: any) => {
        const stats = getRunProgressStats(row);

        return (
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {stats.isRunning ? (
              <Tooltip content="Open Execution Console" side="top">
                <button
                  type="button"
                  onClick={() => router.push(`/p/${slug}/runs/${row.id}`)}
                  className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400 text-slate-300 flex items-center justify-center transition-all cursor-pointer shadow-xs"
                >
                  <ArrowRight className="h-4 w-4 stroke-[2.5]" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="View Summary Report" side="top">
                <button
                  type="button"
                  onClick={() => router.push(`/p/${slug}/runs/${row.id}/report`)}
                  className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400 text-slate-300 flex items-center justify-center transition-all cursor-pointer shadow-xs"
                >
                  <FileText className="h-4 w-4" />
                </button>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      id: 'menu',
      header: '',
      className: 'w-8 shrink-0 text-center',
      accessor: (row: any, idx: number) => {
        if (!canEdit) return null;
        return (
          <div className="flex items-center justify-center relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenRowMenuId(openRowMenuId === row.id ? null : row.id);
              }}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="More actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {openRowMenuId === row.id && (
              <>
                <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpenRowMenuId(null); }} />
                <div
                  className={cn(
                    "absolute right-0 z-50 w-44 rounded-xl border border-white/15 bg-[#141a29] shadow-2xl p-1 text-xs space-y-0.5 animate-in fade-in-0 duration-100",
                    idx >= 4 ? "bottom-full mb-1 origin-bottom-right" : "top-full mt-1 origin-top-right"
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      setOpenRowMenuId(null);
                      handleClone(row.id, e);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-white/5 flex items-center gap-2 text-slate-300 hover:text-white cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Clone Run</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRowMenuId(null);
                      handleRerunClick(row);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-white/5 flex items-center gap-2 text-slate-300 hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Rerun...</span>
                  </button>
                  <div className="border-t border-white/10 my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRowMenuId(null);
                      handleArchiveRun(row.id);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete</span>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenRowMenuId(null);
                        setSingleDeleteId(row.id);
                      }}
                      className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-rose-500/10 text-rose-400 flex items-center gap-2 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete Permanently</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        );
      },
    },
  ];

  const archivedColumns = [
    {
      id: 'name',
      header: 'Run',
      className: 'min-w-[280px] flex-1',
      accessor: (row: any) => {
        const env = String(row.environment || 'Default').toUpperCase();
        return (
          <div className="flex flex-col gap-1 py-0.5 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs font-semibold text-muted-foreground/80 shrink-0">
                {row.id}
              </span>
              <span className="font-semibold text-sm text-foreground truncate" title={row.name}>
                {row.name}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <span className="font-mono text-xs font-semibold uppercase text-muted-foreground">
                {env}
              </span>
              <span>·</span>
              <span>Archived</span>
            </div>
          </div>
        );
      },
      sortable: true,
    },
    {
      id: 'status',
      header: 'Status',
      className: 'w-24 shrink-0 text-left',
      accessor: (row: any) => <RunStatusBadge status={row.status} />,
    },
    {
      id: 'actions',
      header: '',
      className: 'w-24 shrink-0 text-right',
      accessor: (row: any) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
          onClick={(e) => {
            e.stopPropagation();
            handleRestoreRun(row.id);
          }}
        >
          Restore
        </Button>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-3.5">
      {/* ── Row 1: Title & primary actions ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Test Runs</h1>

        <div className="flex items-center gap-3">
          {trendsData.length > 0 && (
            <button
              onClick={() => setShowTrends(!showTrends)}
              title="Ad-hoc runs are excluded from quality trends"
              className={cn(
                "h-9 px-3.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer",
                showTrends
                  ? "bg-primary/15 text-primary border-primary/30 font-semibold"
                  : "bg-muted/30 text-muted-foreground border-border/40 hover:text-foreground hover:bg-muted/50"
              )}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              {showTrends ? 'Hide Trends' : 'Show Trends'}
            </button>
          )}

          {canEdit && (
            <SplitButton
              label="New Run"
              icon={<Plus className="h-3.5 w-3.5" />}
              variant="primary-gradient"
              onClick={() => {
                setCreateRunType('manual');
                setShowCreateRunModal(true);
              }}
              title="Create a new run"
              items={[
                {
                  label: 'Repository / Suites',
                  icon: <Layers className="h-3.5 w-3.5" />,
                  onClick: () => {
                    setCreateRunType('manual');
                    setShowCreateRunModal(true);
                  },
                },
                {
                  label: 'Postman Run',
                  icon: <PostmanLogo className="h-3.5 w-3.5" />,
                  onClick: () => {
                    setCreateRunType('postman');
                    setShowCreateRunModal(true);
                  },
                },
                {
                  label: 'Datadog Run',
                  icon: <DatadogLogo className="h-3.5 w-3.5" />,
                  onClick: () => {
                    setCreateRunType('datadog');
                    setShowCreateRunModal(true);
                  },
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* ── Row 2: Scope tabs & ad-hoc visibility ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-1 text-xs font-medium">
          <button
            onClick={() => setShowArchived(false)}
            className={cn(
              'px-3 py-1 rounded-lg transition-colors cursor-pointer',
              !showArchived
                ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Active ({filteredRuns.length})
          </button>
          <button
            onClick={handleShowArchived}
            className={cn(
              'px-3 py-1 rounded-lg transition-colors cursor-pointer',
              showArchived
                ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Archived ({archivedRuns.length})
          </button>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={showAdhocRuns}
          onClick={() => setShowAdhocRuns((v) => !v)}
          className="inline-flex h-8 items-center gap-2.5 rounded-xl border border-border/40 bg-muted/20 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
          title="Runs created from a test case menu are ad-hoc and hidden by default"
        >
          <span
            className={cn(
              'relative h-5 w-9 shrink-0 rounded-full transition-colors',
              showAdhocRuns ? 'bg-primary' : 'bg-muted-foreground/30'
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                showAdhocRuns ? 'translate-x-[18px]' : 'translate-x-0.5'
              )}
            />
          </span>
          <span>Ad-hoc runs</span>
          {adhocRunCount > 0 && (
            <span className="font-mono text-[11px] opacity-70">({adhocRunCount})</span>
          )}
        </button>
      </div>

      {/* ── Collapsible Trends Panel ── */}
      {showTrends && trendsData.length > 0 && (
        <div className="p-4 rounded-2xl glass border border-border/50 space-y-3 animate-in fade-in-0 duration-200">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Execution Quality Trends</h3>
                <p className="text-xs text-muted-foreground">
                  Pass rate across completed runs ({trendsData.length}) · Average: <span className="font-semibold text-emerald-500 font-mono">{avgPassRate}%</span>
                </p>
                <p className="text-[10px] text-muted-foreground/80 mt-0.5 inline-flex items-center gap-1">
                  Ad-hoc runs are excluded from trends.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowTrends(false)}
              className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground text-xs cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <QualityTrendChart
            data={trendsData}
            height={190}
            onSelectRun={(runId) => router.push(`/p/${slug}/runs/${runId}`)}
          />
        </div>
      )}

      {/* ── Row 2: Search, Filters & Bulk Actions ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search runs by name, ID, or suite..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs bg-background"
            />
          </div>
          <AdvancedFilters fields={filterFields} onClear={clearFilters} activeCount={activeFilterCount} />
        </div>

        {selectedIds.size > 0 && !showArchived && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg border bg-muted/40 animate-in fade-in-0 duration-150">
            <span className="text-xs font-medium">{selectedIds.size} selected</span>
            <div className="h-3.5 w-px bg-border" />
            <Button
              variant="outline"
              size="sm"
              disabled={!hasInProgress}
              onClick={() => setConfirmAction('finish')}
              className="h-7 text-xs px-2"
            >
              <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" /> Finish
            </Button>
            {selectedIds.size === 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => handleClone(Array.from(selectedIds)[0], e)}
                className="h-7 text-xs px-2"
              >
                <Copy className="h-3 w-3 mr-1" /> Clone
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
              onClick={handleBulkArchive}
            >
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        {showArchived ? (
          <DataTable
            data={archivedRuns}
            columns={archivedColumns}
            getId={(row) => row.id}
            tableClassName="min-w-[720px] w-full"
            emptyComponent={
              <EmptyState
                icon={Play}
                heading="No archived runs"
                subtext="Archived runs will appear here"
              />
            }
          />
        ) : (
          <DataTable
            data={filteredRuns}
            columns={columns}
            selectable={canEdit}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onRowClick={(row) =>
              router.push(
                canEdit ? `/p/${slug}/runs/${row.id}` : `/p/${slug}/runs/${row.id}/report`
              )
            }
            getId={(row) => row.id}
            tableClassName="w-full min-w-[700px]"
            emptyComponent={
              <EmptyState
                icon={Play}
                heading="No test runs"
                subtext={canEdit ? "Start your first test run" : "No test runs have been executed yet"}
                action={
                  canEdit
                    ? {
                        label: 'New Run',
                        onClick: () => {
                          setCreateRunType('manual');
                          setShowCreateRunModal(true);
                        },
                      }
                    : undefined
                }
              />
            }
          />
        )}
      </div>

      <Dialog open={confirmAction === 'finish'} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" /> Finish Runs
            </DialogTitle>
            <DialogDescription>
              Mark {selectedIds.size} run(s) as completed? Failed runs will be marked as Failed, completed runs as Completed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={busy}>Cancel</Button>
            <Button disabled={busy} onClick={handleBulkFinish}>
              {busy ? 'Processing...' : 'Finish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={confirmAction === 'archive'}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title={`Delete ${selectedIds.size} Test Run${selectedIds.size === 1 ? '' : 's'}`}
        description={`Are you sure you want to delete ${selectedIds.size} test run${selectedIds.size === 1 ? '' : 's'}? They will be removed from your active runs. Their execution history is preserved.`}
        confirmLabel="Delete Runs"
        variant="destructive"
        requireTypedConfirmation="DELETE"
        disabled={busy}
        onConfirm={confirmBulkArchive}
      />

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
              <input
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={cloneForm.name}
                onChange={(e) => setCloneForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Environment</label>
              <Select
                value={cloneForm.environment}
                onValueChange={(val) => setCloneForm((p) => ({ ...p, environment: val }))}
                options={
                  [...new Set(runs.map((r: any) => r.environment).filter(Boolean))].length > 0
                    ? [...new Set(runs.map((r: any) => r.environment).filter(Boolean))].map((env: any) => ({ value: env, label: env }))
                    : [{ value: 'staging', label: 'Staging' }]
                }
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={cloneForm.cloneAssignments}
                  onChange={(e) => setCloneForm((p) => ({ ...p, cloneAssignments: e.target.checked }))}
                />
                Clone case assignments
              </label>
              <Select
                value={cloneForm.assignee}
                onValueChange={(val) => setCloneForm((p) => ({ ...p, assignee: val }))}
                options={[
                  { value: '', label: 'Default: No assignee' },
                  ...members.map((m: any) => ({ value: m.userId, label: m.user?.name || `User #${m.userId}` }))
                ]}
              />
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

      <ConfirmModal
        open={!!singleArchiveId}
        onOpenChange={(open) => !open && setSingleArchiveId(null)}
        title="Delete Test Run"
        description="Are you sure you want to delete this test run? It will be removed from your active runs. Its execution history is preserved."
        confirmLabel="Delete Run"
        variant="destructive"
        requireTypedConfirmation="DELETE"
        onConfirm={async () => {
          if (!singleArchiveId) return;
          try {
            await archiveTestRunAction(singleArchiveId);
            const run = runs.find((r: any) => r.id === singleArchiveId);
            setRuns(runs.filter((r: any) => r.id !== singleArchiveId));
            if (run) setArchivedRuns([...archivedRuns, run]);
            toast.success('Run deleted');
          } catch (e: any) {
            toast.error(e.message || 'Failed to delete run');
          } finally {
            setSingleArchiveId(null);
          }
        }}
      />

      <ConfirmModal
        open={Boolean(singleDeleteId)}
        onOpenChange={(open) => !open && setSingleDeleteId(null)}
        title="Delete Test Run"
        description="Are you sure you want to permanently delete this test run? All associated results and execution history will be removed. This action cannot be undone."
        confirmLabel="Delete Run"
        variant="destructive"
        requireTypedConfirmation="DELETE"
        onConfirm={() => {
          if (singleDeleteId) {
            handleDeleteRun(singleDeleteId);
          }
        }}
      />

      {/* ── Re-run Modal (Creates New Run) ── */}
      <Dialog open={Boolean(rerunRunModal?.open)} onOpenChange={(open) => !open && setRerunRunModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <RotateCcw className="h-4 w-4 text-primary" />
              <span>Re-run Test Run</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              This will create a new test run for re-execution while keeping the original run record intact.
            </DialogDescription>
          </DialogHeader>

          {rerunRunModal?.run && (() => {
            const stats = getRunProgressStats(rerunRunModal.run);
            const hasFailOrBlocked = stats.fail > 0 || stats.error > 0 || stats.blocked > 0;

            return (
              <div className="space-y-3 py-2 text-xs">
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1">
                  <div className="font-semibold text-foreground flex items-center justify-between">
                    <span>{rerunRunModal.run.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{rerunRunModal.run.id}</span>
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    {stats.total} total cases · {stats.pass} passed · {stats.fail} failed · {stats.error} error · {stats.blocked} blocked
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  {hasFailOrBlocked && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => confirmRerunRun('failed_blocked')}
                      className="w-full p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15 text-left transition-colors flex items-center justify-between group cursor-pointer"
                    >
                      <div>
                        <div className="font-semibold text-rose-300">Rerun Failed & Blocked Only</div>
                        <div className="text-[11px] text-rose-400/80 mt-0.5">
                          Targeted re-test with {stats.fail + stats.error + stats.blocked} unresolved case(s)
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-rose-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => confirmRerunRun('all')}
                    className="w-full p-3 rounded-xl border border-border/80 bg-white/5 hover:bg-white/10 text-left transition-colors flex items-center justify-between group cursor-pointer"
                  >
                    <div>
                      <div className="font-semibold text-foreground">Rerun All Cases</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Start a complete new run with all {stats.total} case(s)
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setRerunRunModal(null)} disabled={busy} className="h-8 text-xs">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateRunModal
        open={showCreateRunModal}
        onOpenChange={setShowCreateRunModal}
        slug={slug}
        runType={createRunType}
        onRequestImport={(provider) => {
          setImportSourceMode(provider);
          setShowCreateRunModal(false);
          setShowImportDialog(true);
        }}
      />

      <GenerateTestCasesDialog
        key={importSourceMode}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        projectId={project?.id || ''}
        initialSourceMode={importSourceMode}
        onSuccess={() => {
          setShowImportDialog(false);
          setShowCreateRunModal(true);
        }}
      />
    </div>
  );
}
