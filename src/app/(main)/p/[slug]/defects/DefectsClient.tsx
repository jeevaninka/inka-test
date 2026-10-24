"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Bug,
  Search,
  ExternalLink,
  RefreshCw,
  Loader2,
  Clock,
  Layers,
  Play,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Filter,
  ChevronDown,
  Check,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { apiClient } from '@/lib/apiClient';
import type { ProjectDefectItem } from '@/app/actions/defects';
import { syncDefectStatusAction } from '@/app/actions/integrations';
import { DefectDetailModal } from '@/components/runs/DefectDetailModal';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Tooltip } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/common/PageHeader';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function isDefectDone(d: ProjectDefectItem): boolean {
  const st = (d.ticketStatus || d.localStatus || '').toLowerCase();
  return st.includes('released') || st.includes('done') || st.includes('resolved') || st.includes('closed');
}

export function DefectsClient({
  initialDefects = [],
  initialRunFilter = 'ALL',
}: {
  initialDefects?: ProjectDefectItem[];
  initialRunFilter?: string;
}) {
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const router = useRouter();
  const { project } = useProjectData();

  const [defects, setDefects] = useState<ProjectDefectItem[]>(initialDefects);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED'>('ALL');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [runFilter, setRunFilter] = useState<string>(initialRunFilter);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState<ProjectDefectItem | null>(null);

  const fetchDefects = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const data = await apiClient.get<ProjectDefectItem[]>(
        `/api/v1/projects/${encodeURIComponent(slug)}/defects`
      );
      setDefects(data || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load defects');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // Initial load is now handled by server component
  // useEffect(() => {
  //   fetchDefects();
  // }, [fetchDefects]);

  const handleSyncStatus = async (defectId: string) => {
    setSyncingId(defectId);
    try {
      const res = await syncDefectStatusAction(defectId);
      toast.success(`Synced status: ${res.status || 'Updated'}`);
      fetchDefects();
    } catch (err: any) {
      toast.error(err.message || 'Failed to sync status');
    } finally {
      setSyncingId(null);
    }
  };

  const handleSyncAllStatuses = async () => {
    const linked = defects.filter((d) => Boolean(d.externalTicketId));
    if (linked.length === 0) {
      toast.info('No external tickets to sync');
      return;
    }
    setSyncingAll(true);
    toast.info(`Syncing ${linked.length} defect(s) from PM tool...`);
    let updated = 0;
    for (const d of linked) {
      try {
        await syncDefectStatusAction(d.id);
        updated++;
      } catch {
        // continue
      }
    }
    toast.success(`Synced ${updated} of ${linked.length} defects`);
    fetchDefects();
    setSyncingAll(false);
  };

  const availableRuns = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of defects) {
      if (d.runId && !map.has(d.runId)) {
        map.set(d.runId, d.runName ? `${d.runId} · ${d.runName}` : d.runId);
      }
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [defects]);

  const filteredDefects = useMemo(() => {
    return defects.filter((d) => {
      if (statusFilter !== 'ALL') {
        const isDone = isDefectDone(d);
        if (statusFilter === 'RESOLVED' && !isDone) return false;
        if (statusFilter === 'OPEN' && isDone) return false;
      }
      if (severityFilter !== 'ALL') {
        const sev = (d.severity || '').toUpperCase();
        const targetSev = severityFilter === 'URGENT' ? 'CRITICAL' : severityFilter;
        if (sev !== severityFilter && sev !== targetSev) return false;
      }
      if (runFilter !== 'ALL' && d.runId !== runFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchTitle = d.title.toLowerCase().includes(q);
        const matchKey = (d.externalTicketId || '').toLowerCase().includes(q);
        const matchCase = (d.testCaseDisplayId || '').toLowerCase().includes(q);
        const matchRun = (d.runName || '').toLowerCase().includes(q) || (d.runId || '').toLowerCase().includes(q);
        if (!matchTitle && !matchKey && !matchCase && !matchRun) return false;
      }
      return true;
    });
  }, [defects, statusFilter, severityFilter, runFilter, search]);

  const stats = useMemo(() => {
    const total = defects.length;
    const resolved = defects.filter(isDefectDone).length;
    const open = total - resolved;
    return { total, open, resolved };
  }, [defects]);

  return (
    <div className="w-full space-y-4 p-4 sm:p-6 xl:space-y-5">
      {/* ── Header & Left-Aligned Toolbar ── */}
      <div className="space-y-3 xl:space-y-4">
        <PageHeader
          title="Bugs"
          description="Track and synchronize bugs logged across test runs with your issue tracker"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncAllStatuses}
              disabled={loading || syncingAll}
              title="Sync latest ticket statuses from issue tracker"
              className="h-9 px-3.5 text-xs gap-1.5 border-border/60 hover:bg-muted cursor-pointer font-semibold rounded-xl"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncingAll && "animate-spin text-primary")} />
              <span>{syncingAll ? 'Syncing...' : 'Sync Statuses'}</span>
            </Button>
          }
        />

        {/* Search, Status Tabs, and Filters (Left-Aligned) */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative w-full sm:w-80 max-w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, ticket ID, or case..."
              className="pl-8 h-9 text-xs bg-background border-border/60 rounded-xl"
            />
          </div>

          {/* Segmented Status Filter Tabs with Counts */}
          <div className="inline-flex rounded-xl border border-border/60 bg-muted/20 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setStatusFilter('OPEN')}
              className={cn(
                "px-3 py-1.5 rounded-lg transition-all cursor-pointer",
                statusFilter === 'OPEN'
                  ? "bg-primary/20 text-primary font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Open ({stats.open})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('RESOLVED')}
              className={cn(
                "px-3 py-1.5 rounded-lg transition-all cursor-pointer",
                statusFilter === 'RESOLVED'
                  ? "bg-primary/20 text-primary font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Resolved ({stats.resolved})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={cn(
                "px-3 py-1.5 rounded-lg transition-all cursor-pointer",
                statusFilter === 'ALL'
                  ? "bg-primary/20 text-primary font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              All ({stats.total})
            </button>
          </div>

          {/* Severity Dropdown Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-9 px-3 text-xs gap-1.5 border-border/60 hover:bg-muted font-medium rounded-xl cursor-pointer",
                  severityFilter !== 'ALL' && "border-primary/40 bg-primary/5 text-primary"
                )}
              >
                <span className="text-muted-foreground font-normal">Severity:</span>
                <span>
                  {severityFilter === 'ALL'
                    ? 'All'
                    : severityFilter === 'URGENT'
                    ? 'Critical'
                    : severityFilter.charAt(0) + severityFilter.slice(1).toLowerCase()}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40 p-1 rounded-xl">
              <DropdownMenuItem onClick={() => setSeverityFilter('ALL')} className="gap-2 cursor-pointer text-xs">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
                <span>All Severities</span>
                {severityFilter === 'ALL' && <Check className="h-3.5 w-3.5 text-primary ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSeverityFilter('URGENT')} className="gap-2 cursor-pointer text-xs">
                <span className="h-2 w-2 rounded-full bg-rose-400 shrink-0" />
                <span>Critical</span>
                {severityFilter === 'URGENT' && <Check className="h-3.5 w-3.5 text-primary ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSeverityFilter('HIGH')} className="gap-2 cursor-pointer text-xs">
                <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                <span>High</span>
                {severityFilter === 'HIGH' && <Check className="h-3.5 w-3.5 text-primary ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSeverityFilter('MEDIUM')} className="gap-2 cursor-pointer text-xs">
                <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                <span>Medium</span>
                {severityFilter === 'MEDIUM' && <Check className="h-3.5 w-3.5 text-primary ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSeverityFilter('LOW')} className="gap-2 cursor-pointer text-xs">
                <span className="h-2 w-2 rounded-full bg-zinc-500 shrink-0" />
                <span>Low</span>
                {severityFilter === 'LOW' && <Check className="h-3.5 w-3.5 text-primary ml-auto" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Test Run Filter Dropdown (shown when multiple runs exist) */}
          {availableRuns.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-9 px-3 text-xs gap-1.5 border-border/60 hover:bg-muted font-medium rounded-xl cursor-pointer",
                    runFilter !== 'ALL' && "border-primary/40 bg-primary/5 text-primary"
                  )}
                >
                  <span className="text-muted-foreground font-normal">Run:</span>
                  <span className="max-w-[140px] truncate">
                    {runFilter === 'ALL' ? 'All' : runFilter}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60 ml-0.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60 p-1 rounded-xl max-h-64 overflow-y-auto">
                <DropdownMenuItem onClick={() => setRunFilter('ALL')} className="gap-2 cursor-pointer text-xs">
                  <span>All Runs</span>
                  {runFilter === 'ALL' && <Check className="h-3.5 w-3.5 text-primary ml-auto shrink-0" />}
                </DropdownMenuItem>
                {availableRuns.map((r) => (
                  <DropdownMenuItem
                    key={r.id}
                    onClick={() => setRunFilter(r.id)}
                    className="gap-2 cursor-pointer text-xs"
                  >
                    <span className="truncate">{r.label}</span>
                    {runFilter === r.id && <Check className="h-3.5 w-3.5 text-primary ml-auto shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Reset Filters button */}
          {(statusFilter !== 'ALL' || severityFilter !== 'ALL' || runFilter !== 'ALL' || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter('ALL');
                setSeverityFilter('ALL');
                setRunFilter('ALL');
                setSearch('');
              }}
              className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              <span>Reset</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Bugs Table ── */}
      {loading ? (
        <div className="p-16 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Loading bugs...</span>
        </div>
      ) : filteredDefects.length === 0 ? (
        <div className="border border-dashed border-border/60 rounded-2xl p-16 text-center space-y-3 bg-card/20">
          <div className="w-12 h-12 rounded-2xl bg-muted/40 text-muted-foreground flex items-center justify-center mx-auto border border-border/50">
            <Bug className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-foreground">No bugs found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            {search || statusFilter !== 'ALL' || severityFilter !== 'ALL' || runFilter !== 'ALL'
              ? 'No bugs match your active filter criteria.'
              : 'No bugs have been logged for this project yet.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs w-full">
          <table className="w-full table-fixed min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-muted/35 dark:bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="h-11 px-5 w-[44%]">Bug / Issue</th>
                <th className="h-11 px-4 w-[22%]">Run / Case</th>
                <th className="h-11 px-4 w-[12%]">Severity</th>
                <th className="hidden lg:table-cell h-11 px-4 w-[10%] text-center">Author</th>
                <th className="h-11 px-4 w-[9%]">Status</th>
                <th className="h-11 px-3 w-[3%] text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-foreground">
              {filteredDefects.map((defect) => {
                const isResolved = isDefectDone(defect);
                const sev = (defect.severity || '').toUpperCase();

                return (
                  <tr
                    key={defect.id}
                    onClick={() => setSelectedDefect(defect)}
                    className="transition-colors hover:bg-primary/[0.06] dark:hover:bg-white/[0.05] cursor-pointer group"
                  >
                    {/* 1. Bug Title & Ticket ID */}
                    <td className="py-3.5 px-5 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {defect.externalTicketId ? (
                          <a
                            href={defect.ticketUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors inline-flex items-center gap-1 shrink-0"
                            title="Open ticket in PM tracker"
                          >
                            <span>{defect.externalTicketId}</span>
                            <ExternalLink className="h-3 w-3 opacity-60" />
                          </a>
                        ) : (
                          <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-muted/50 text-muted-foreground border border-border/40 shrink-0">
                            Local
                          </span>
                        )}
                        <span
                          className="font-semibold text-foreground/95 group-hover:text-primary transition-colors text-sm truncate"
                          title={defect.title}
                        >
                          {defect.title}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Logged {format(new Date(defect.raisedAt), 'MMM d, yyyy · h:mm a')}
                      </div>
                    </td>

                    {/* 2. Run / Case */}
                    <td className="py-3.5 px-4 min-w-0">
                      {defect.runId && (defect.testCaseDisplayId || defect.testCaseId) ? (
                        <div className="min-w-0">
                          <Link
                            href={`/p/${slug}/runs/${defect.runId}/${defect.testCaseDisplayId || defect.testCaseId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-muted/50 text-foreground/85 border border-border/60 hover:border-primary/40 hover:text-primary inline-flex items-center gap-1 group/link transition-colors"
                            title={`Launch ${defect.testCaseDisplayId || 'Case'} in run console`}
                          >
                            <span>{defect.runId} · {defect.testCaseDisplayId || 'Case'}</span>
                            <ExternalLink className="h-3 w-3 opacity-50 group-hover/link:opacity-100" />
                          </Link>
                          {defect.runName && (
                            <span className="text-[11px] text-muted-foreground truncate block mt-0.5" title={defect.runName}>
                              {defect.runName}
                            </span>
                          )}
                        </div>
                      ) : defect.runId ? (
                        <Link
                          href={`/p/${slug}/runs/${defect.runId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-muted/50 text-foreground/85 border border-border/60 hover:border-primary/40 hover:text-primary inline-flex items-center gap-1 transition-colors"
                        >
                          {defect.runId}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>

                    {/* 3. Severity */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {sev === 'CRITICAL' || sev === 'URGENT' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-rose-400 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                          Critical
                        </span>
                      ) : sev === 'HIGH' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                          High
                        </span>
                      ) : sev === 'MEDIUM' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400/80 shrink-0" />
                          Medium
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500/60 shrink-0" />
                          Low
                        </span>
                      )}
                    </td>

                    {/* 4. Author (Avatar + Name on hover) */}
                    <td className="hidden lg:table-cell py-3.5 px-4 text-center whitespace-nowrap">
                      <Tooltip content={defect.raisedByName || 'User'} side="top">
                        <div className="flex items-center justify-center">
                          <UserAvatar
                            userId={defect.raisedBy}
                            name={defect.raisedByName}
                            fullName={defect.raisedByFullName}
                            imageUrl={defect.raisedByImage}
                            color={defect.raisedByColor}
                            initials={defect.raisedByInitials}
                            size="sm"
                            className="shrink-0 mx-auto"
                          />
                        </div>
                      </Tooltip>
                    </td>

                    {/* 5. Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-xs font-medium",
                          isResolved ? "text-emerald-400" : "text-foreground/90"
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full shrink-0",
                            isResolved ? "bg-emerald-400" : "bg-sky-400"
                          )}
                        />
                        {isResolved ? 'Resolved' : 'Open'}
                      </span>
                    </td>

                    {/* 6. Sync Action */}
                    <td className="py-3.5 px-3 text-right">
                      {defect.externalTicketId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSyncStatus(defect.id);
                          }}
                          disabled={syncingId === defect.id}
                          title="Sync status from issue tracker"
                          className="p-1 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={cn("h-3.5 w-3.5", syncingId === defect.id && "animate-spin text-primary")} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Defect Detail Modal ── */}
      <DefectDetailModal
        open={Boolean(selectedDefect)}
        onOpenChange={(open) => !open && setSelectedDefect(null)}
        defect={selectedDefect as any}
      />
    </div>
  );
}
