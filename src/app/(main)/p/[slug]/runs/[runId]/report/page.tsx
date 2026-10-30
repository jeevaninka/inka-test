"use client";

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/common/DataTable';
import { ResultStatusBadge } from '@/components/common/ResultStatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ExternalLink, RotateCcw, Loader2, Copy, Bug, Plus, Printer, Share2, Clock, CheckCircle2, AlertOctagon, MinusCircle, Ban, ArrowLeft, Globe, Database, TriangleAlert } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { getRunResultsAction } from '@/app/actions/runs';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn, formatVariableName } from '@/lib/utils';
import { toast } from 'sonner';
import { logger } from '@/lib/logger.client';
import type { ResultStatus } from '@/lib/types';

interface RunReportPageProps {
  slug: string;
  runId: string;
}

export default function RunReportPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { slug,runId } = params as Record<string, string>;
  const { project, runs, suites, cases: allCases, members } = useProjectData();
  const run = runs.find((r) => r.id === runId);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);


  const getUser = (userId: number) => {
    const member = members.find((m: any) => m.userId === userId || m.user.id === userId);
    return member?.user || null;
  };

  const getCase = (id: string) => allCases.find(c => c.id === id);

  useEffect(() => {
    getRunResultsAction(runId)
      .then((data) => {
        setResults(data);
        setLoading(false);

        if (searchParams.get('print') === 'true') {
          setTimeout(() => {
            if (typeof window !== 'undefined') {
              window.print();
            }
          }, 500);
        }
      })
      .catch((err) => {
        logger.error('Failed to load run report results', {
          component: 'RunReportPage',
          action: 'getRunResultsAction',
          runId,
          error: err,
        });
        setLoading(false);
      });
  }, [runId, searchParams]);

  const filteredResults = useMemo(() => {
    if (!statusFilter) return results;
    return results.filter((r) => r.status === statusFilter);
  }, [results, statusFilter]);

  const totalTimeSpentSeconds = useMemo(() => {
    return results.reduce((sum, r) => sum + (r.totalTimeSpentSeconds || r.timeSpentSeconds || 0), 0);
  }, [results]);

  // Bugs data - collect all defects from results
  const allDefects = useMemo(() => {
    const defects: any[] = [];
    results.forEach((r: any) => {
      if (r.defects && r.defects.length > 0) {
        r.defects.forEach((d: any) => {
          defects.push({
            ...d,
            linkedCase: getCase(r.testCaseId),
            linkedResult: r,
          });
        });
      }
    });
    return defects;
  }, [results, allCases]);

  const stats = useMemo(() => ({
    total: results.length,
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    error: results.filter((r) => r.status === 'error').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
    skip: results.filter((r) => r.status === 'skip').length,
    invalid: results.filter((r) => r.status === 'invalid').length,
  }), [results]);

  const rerunResults = useMemo(() => {
    return results.filter((r) => r.attemptNumber && r.attemptNumber > 1);
  }, [results]);



  const pendingCount = useMemo(() => {
    return results.filter((r) => {
      const status = String(r.status || '').toLowerCase();
      return status === 'pending' || status === 'queued' || status === 'running' || r.caseState === 'QUEUED' || r.caseState === 'RUNNING';
    }).length;
  }, [results]);

  const isRunInProgress = pendingCount > 0 && run.status?.toLowerCase() !== 'completed' && run.status?.toLowerCase() !== 'aborted';

  const effectiveRunStatus = useMemo(() => {
    if (!run) return { label: 'In Progress', color: 'blue' };
    if (run.status?.toLowerCase() === 'aborted') return { label: 'Aborted', color: 'zinc' };
    if (isRunInProgress) return { label: 'In Progress', color: 'blue' };
    if (stats.fail > 0 || stats.error > 0) return { label: 'Failed', color: 'red' };
    if (stats.total > 0 && stats.pass + stats.invalid + stats.skip + stats.blocked + stats.error === stats.total) {
      return { label: 'Passed', color: 'green' };
    }
    if (run.status?.toLowerCase() === 'completed') return { label: 'Completed', color: 'green' };
    return { label: 'In Progress', color: 'blue' };
  }, [run?.status, stats, isRunInProgress]);

  if (!project || !run) return null;

  const suite = run.suiteId ? suites.find((s) => s.id === run.suiteId) : null;
  const assignee = run.assignedTo ? getUser(run.assignedTo) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const passRate = stats.total > 0 ? Math.round((stats.pass / stats.total) * 100) : 0;

  const startTime = run.startedAt ? new Date(run.startedAt) : null;
  const endTime = run.completedAt ? new Date(run.completedAt) : null;
  const duration = startTime && endTime ? Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60)) : null;

  const chartData = [
    { name: 'Pass', value: stats.pass, color: '#10b981' },
    { name: 'Fail', value: stats.fail, color: '#f43f5e' },
    { name: 'Blocked', value: stats.blocked, color: '#f59e0b' },
    { name: 'Skip', value: stats.skip, color: '#71717a' },
    { name: 'Invalid', value: stats.invalid, color: '#a855f7' },
  ].filter((d) => d.value > 0);

  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const percent = stats.total > 0 ? Math.round((data.value / stats.total) * 100) : 0;
      return (
        <div className="rounded-xl border border-border bg-popover text-popover-foreground px-3.5 py-2 shadow-2xl text-xs flex flex-col gap-1 z-50 animate-in fade-in-0 zoom-in-95 duration-150 pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 shadow-xs" style={{ backgroundColor: data.payload.color }} />
            <span className="font-semibold text-foreground">{data.name}</span>
          </div>
          <div className="flex items-center justify-between gap-4 font-mono text-[11px] text-muted-foreground">
            <span className="font-bold text-foreground">{data.value} {data.value === 1 ? 'case' : 'cases'}</span>
            <span className="text-muted-foreground/80">({percent}%)</span>
          </div>
        </div>
      );
    }
    return null;
  };

  // Format timer MM:SS
  const formatTimer = (secs: number) => {
    if (!secs || secs <= 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const columns = [
    {
      id: 'order',
      header: '#',
      accessor: (_: any, index: number) => (
        <span className="font-mono text-xs text-muted-foreground font-semibold block text-center w-6">{index + 1}</span>
      ),
      className: 'w-10 text-center',
    },
    {
      id: 'title',
      header: 'Case ID & Title',
      accessor: (row: any) => {
        const tc = getCase(row.testCaseId);
        return tc?.displayId ? (
          <Link
            href={`/p/${slug}/repository/${tc.displayId}`}
            className="flex items-start gap-2 py-0.5 max-w-[480px] hover:text-primary transition-colors group cursor-pointer"
          >
            <span className="text-xs font-mono font-bold shrink-0 text-foreground group-hover:text-primary whitespace-nowrap">
              {tc.displayId}
            </span>
            <span className="text-xs font-bold leading-snug text-foreground group-hover:text-primary line-clamp-2" title={tc?.title || ''}>
              {tc?.title || 'Unknown'}
            </span>
          </Link>
        ) : (
          <span className="text-xs font-bold leading-snug text-foreground line-clamp-2" title={tc?.title || ''}>
            {tc?.title || 'Unknown'}
          </span>
        );
      },
    },
    {
      id: 'result',
      header: 'Result',
      accessor: (row: any) => <ResultStatusBadge status={row.status} />,
      className: 'text-center',
    },
    {
      id: 'timeSpent',
      header: 'Time',
      accessor: (row: any) => (
        <span className="font-mono text-xs font-semibold whitespace-nowrap text-center block">
          {formatTimer(row.timeSpentSeconds)}
        </span>
      ),
      className: 'text-center',
    },
    {
      id: 'attempts',
      header: 'Attempts',
      accessor: (row: any) => (
        <span className="text-xs font-mono font-semibold whitespace-nowrap block text-center">
          {row.attemptNumber || 1}
        </span>
      ),
      className: 'text-center',
    },
    {
      id: 'defect',
      header: 'Defects / Failure Reason',
      accessor: (row: any) => {
        const defects = row.defects || [];
        if (defects.length > 0) {
          const d = defects[0];
          const label = d.externalTicketId || d.ticketUrl?.split('/').pop() || d.title || 'Defect';
          const statusLower = (d.ticketStatus || '').toLowerCase();
          const isResolved =
            statusLower.includes('done') ||
            statusLower.includes('resolved') ||
            statusLower.includes('closed') ||
            statusLower.includes('fixed');
          const isInProgress =
            statusLower.includes('progress') ||
            statusLower.includes('review') ||
            statusLower.includes('investigating');

          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <a
                href={d.ticketUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-red-500 hover:underline flex items-center gap-1 font-medium whitespace-nowrap"
              >
                <Bug className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[120px]">{label}</span>
                {d.ticketUrl && <ExternalLink className="h-2.5 w-2.5 shrink-0" />}
              </a>
              {d.ticketStatus && (
                <span
                  className={cn(
                    "text-[9px] font-semibold px-1.5 py-0.2 rounded-full border shrink-0",
                    isResolved
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : isInProgress
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      : "bg-red-500/10 text-red-400 border-red-500/30"
                  )}
                >
                  {d.ticketStatus}
                </span>
              )}
            </div>
          );
        }
        if (row.failureReason || row.notes) {
          return (
            <em className="text-xs text-muted-foreground font-normal italic line-clamp-1 block max-w-[200px]" title={row.failureReason || row.notes}>
              {row.failureReason || row.notes}
            </em>
          );
        }
        return '—';
      },
    },
    {
      id: 'iterations',
      header: 'Iterations',
      accessor: (row: any) => {
        const iters = row.iterationResults || row.iteration_results;
        if (!iters || !Array.isArray(iters) || iters.length === 0) return '—';
        const passCount = iters.filter((i: any) => i.status?.toLowerCase() === 'pass').length;
        const failCount = iters.filter((i: any) => i.status?.toLowerCase() === 'fail').length;
        return (
          <span className={cn(
            "text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold inline-flex items-center gap-1",
            failCount > 0 ? "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25" :
            passCount === iters.length ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25" :
            "bg-muted text-muted-foreground border border-border/40"
          )}>
            <span>{passCount}/{iters.length} Pass</span>
          </span>
        );
      },
    },
    {
      id: 'executedBy',
      header: 'Executed By',
      accessor: (row: any) => {
        const user = row.executedBy ? getUser(row.executedBy) : null;
        return user ? (
          <span className="text-xs font-medium text-foreground whitespace-nowrap">{user.name}</span>
        ) : (
          '—'
        );
      },
    },
  ];

  return (
    <div className="p-6 pt-3 flex flex-col gap-5 print:p-0 print:gap-3 max-w-7xl mx-auto font-sans">
      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm 10mm; }
          body { background: #ffffff !important; color: #000000 !important; }
          header, nav, .print\:hidden { display: none !important; }
          .print\:shadow-none { box-shadow: none !important; }
          .print\:border { border: 1px solid #e2e8f0 !important; }
          table td, table th { padding: 4px 8px !important; font-size: 11px !important; }
          tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          .recharts-responsive-container { display: none !important; }
          .print-donut-fallback { display: flex !important; }
        }
      `}</style>

      {/* Print / Export Header Bar */}
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/p/${slug}/runs/${runId}`)} className="text-xs text-muted-foreground hover:text-foreground font-medium">
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Run
        </Button>

        <div className="flex items-center gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success('Shareable report link copied!'); }}>
            <Share2 className="h-3.5 w-3.5 mr-1.5" /> Share link
          </Button>
          <Button size="sm" onClick={() => window.print()} className="gradient-btn text-white">
            <Printer className="h-3.5 w-3.5 mr-1.5" /> Print Report
          </Button>
        </div>
      </div>

      {/* Summary Card */}
      <Card className="print:shadow-none print:border">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">{run.name}</h1>
                <span className={cn(
                  "px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize inline-flex items-center gap-1.5",
                  effectiveRunStatus.color === 'green' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                  effectiveRunStatus.color === 'red' ? "bg-rose-500/10 text-rose-400 border-rose-500/30" :
                  effectiveRunStatus.color === 'blue' ? "bg-sky-500/10 text-sky-400 border-sky-500/30" :
                  "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                )}>
                  {effectiveRunStatus.label}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground font-medium flex-wrap">
                {suite && <span className="font-semibold text-foreground">{suite.name}</span>}
                <span className="px-2 py-0.5 rounded bg-muted font-medium capitalize">{run.environment}</span>
                {run.buildVersion && <span className="font-mono bg-muted px-2 py-0.5 rounded">{run.buildVersion}</span>}
                {assignee && (
                  <div className="flex items-center gap-1.5">
                    <UserAvatar name={assignee.name} imageUrl={assignee.avatarUrl} size="sm" className="h-4 w-4" />
                    <span className="font-medium text-foreground">Assigned: {assignee.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-[auto_auto] items-center justify-end gap-x-3 gap-y-1 text-xs">
              {startTime && (
                <>
                  <span className="text-muted-foreground font-medium text-right">Started:</span>
                  <span suppressHydrationWarning className="font-mono font-semibold text-foreground text-left">{startTime.toLocaleString()}</span>
                </>
              )}
              {endTime && (
                <>
                  <span className="text-muted-foreground font-medium text-right">Ended:</span>
                  <span suppressHydrationWarning className="font-mono font-semibold text-foreground text-left">{endTime.toLocaleString()}</span>
                </>
              )}
              {totalTimeSpentSeconds > 0 && (
                <>
                  <span className="text-muted-foreground font-medium text-right">Total Time Spent:</span>
                  <span className="font-mono font-bold text-foreground text-left flex items-center gap-1">
                    {formatTimer(totalTimeSpentSeconds)}
                    <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                  </span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards & Chart */}
      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          <StatCard label="Total Cases" value={stats.total} />
          <StatCard label="Passed" value={stats.pass} color="green" />
          <StatCard label="Failed" value={stats.fail} color="red" />
          <StatCard label="Blocked" value={stats.blocked} color="orange" />
          <StatCard label="Skipped" value={stats.skip} color="zinc" />
          <StatCard label="Invalid" value={stats.invalid} color="purple" />
          <StatCard label="Re-ran Cases" value={rerunResults.length} color="blue" />
        </div>

        <Card className="print:shadow-none print:border flex flex-col items-center justify-center">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center w-full">
            <div className="relative w-40 h-40 flex items-center justify-center">
              <div className="w-40 h-40 flex items-center justify-center print:hidden">
                <PieChart width={160} height={160}>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={46}
                    outerRadius={62}
                    paddingAngle={3}
                    dataKey="value"
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={true}
                    animationDuration={900}
                    animationEasing="ease-out"
                  >
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        stroke="transparent"
                        className="transition-all duration-300 hover:opacity-80 cursor-pointer outline-none"
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} wrapperStyle={{ outline: 'none', zIndex: 100 }} />
                </PieChart>
              </div>

              {/* Print Fallback Circle */}
              <div className="hidden print-donut-fallback absolute inset-0 items-center justify-center">
                <div className="w-28 h-28 rounded-full border-[7px] border-emerald-500 shadow-sm" />
              </div>

              {/* Pass % Centered Inside Ring with Smooth Scale In */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-foreground tracking-tight animate-in fade-in-0 zoom-in-75 duration-500">
                  {passRate}%
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pass Rate</span>
              </div>
            </div>

            <div className="mt-1 text-center space-y-0.5">
              <div className="text-xs font-bold text-foreground uppercase tracking-wide">Overall Pass Rate</div>
              <div className="text-[11px] text-muted-foreground font-medium">{stats.pass} of {stats.total} test cases passed</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bugs Section */}
      <Card className="print:shadow-none print:border">
        <CardHeader className="py-2.5 px-5 border-b">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <TriangleAlert className="h-3.5 w-3.5 text-red-500" />
            <span>Bugs ({allDefects.length})</span>
            <div className="flex items-center gap-2 ml-auto">
              <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", 0 > 0 ? "bg-red-500/10 text-red-500 border-red-500/30 border" : "bg-muted text-muted-foreground border-border")}>
                Critical: {0}
              </span>
              <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", 0 > 0 ? "bg-orange-500/10 text-orange-500 border-orange-500/30 border" : "bg-muted text-muted-foreground border-border")}>
                High: {0}
              </span>
              <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", 0 > 0 ? "bg-amber-500/10 text-amber-500 border-amber-500/30 border" : "bg-muted text-muted-foreground border-border")}>
                Medium: {0}
              </span>
              <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", 0 > 0 ? "bg-blue-500/10 text-blue-500 border-blue-500/30 border" : "bg-muted text-muted-foreground border-border")}>
                Low: {0}
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {allDefects.length === 0 ? (
            <div className="p-8 text-center">
              <TriangleAlert className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm">No bugs logged</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: '0' }}>
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider print:break-inside-avoid">Key</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider print:break-inside-avoid">Title</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider print:break-inside-avoid">Severity</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider print:break-inside-avoid">Status</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider print:break-inside-avoid">Linked Case</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider print:break-inside-avoid">Reporter</th>
                  </tr>
                </thead>
                <tbody>
                  {allDefects.map((defect, index) => {
                    const severity = (defect.severity || '').toUpperCase();
                    const severityColors: Record<string, string> = {
                      CRITICAL: 'bg-red-500/10 text-red-500 border-red-500/30',
                      HIGH: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
                      MEDIUM: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
                      LOW: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
                    };
                    const statusLower = (defect.ticketStatus || '').toLowerCase();
                    const isResolved =
                      statusLower.includes('done') ||
                      statusLower.includes('resolved') ||
                      statusLower.includes('closed') ||
                      statusLower.includes('fixed');
                    const isInProgress =
                      statusLower.includes('progress') ||
                      statusLower.includes('review') ||
                      statusLower.includes('investigating');
                    const reporter = defect.raisedBy ? getUser(defect.raisedBy) : null;
                    const linkedCase = defect.linkedCase;
                    return (
                      <tr key={defect.id} className="border-b border-border/50 print:break-inside-avoid" style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                        <td className="px-3 py-2 text-xs font-mono font-semibold text-foreground print:break-inside-avoid">
                          {defect.externalTicketId ? (
                            <a
                              href={defect.ticketUrl || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline flex items-center gap-1"
                            >
                              {defect.externalTicketId}
                              {defect.ticketUrl && <ExternalLink className="h-3 w-3" />}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs font-medium text-foreground max-w-[250px] break-words print:break-inside-avoid print:max-w-none" title={defect.title}>{defect.title}</td>
                        <td className="px-3 py-2 text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 whitespace-nowrap print:break-inside-avoid"
                            style={{ backgroundColor: 'transparent' }}>
                          <span className={cn("inline-flex items-center gap-1", severityColors[severity] || "bg-muted text-muted-foreground border-border")}>
                            {severity || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground print:break-inside-avoid">
                          {defect.ticketStatus ? (
                            <span className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0",
                              isResolved
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                : isInProgress
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                : "bg-red-500/10 text-red-400 border-red-500/30"
                            )}>
                              {defect.ticketStatus}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs print:break-inside-avoid">
                          {linkedCase?.displayId ? (
                            <Link
                              href={`/p/${slug}/repository/${linkedCase.displayId}`}
                              className="flex items-center gap-1 hover:text-primary transition-colors font-medium"
                            >
                              <span className="font-mono text-muted-foreground">{linkedCase.displayId}</span>
                              <span className="truncate max-w-[200px]">{linkedCase.title}</span>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs print:break-inside-avoid">
                          {reporter ? (
                            <span className="font-medium text-foreground">{reporter.name}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {run.resolved_variables && Object.keys(run.resolved_variables).length > 0 && (
        <Card className="print:shadow-none print:border">
          <CardHeader className="py-2.5 px-5 border-b">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-sky-500" />
              <span>Environment &amp; Variable Snapshot ({Object.keys(run.resolved_variables).length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-2">
              {Object.entries(run.resolved_variables).map(([key, val]) => (
                <div key={key} className="px-2.5 py-1 rounded-lg bg-muted/40 border border-border/50 text-xs font-mono inline-flex items-center gap-1.5">
                  <span className="text-sky-600 dark:text-sky-400 font-semibold">{formatVariableName(key)}:</span>
                  <span className="text-foreground">{String(val)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Results Table - Displaying All Cases Without Pagination */}
      <Card className="print:shadow-none print:border">
          {isRunInProgress && (
            <div className="mb-3 p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <p className="text-xs text-yellow-700 dark:text-yellow-300 font-medium">In progress · snapshot at {new Date().toLocaleString()} · {pendingCount} pending</p>
              {pendingCount > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-yellow-700 dark:text-yellow-300 font-semibold">Pending cases:</p>
                  {results.filter(r => {
                    const status = String(r.status || '').toLowerCase();
                    return status === 'pending' || status === 'queued' || status === 'running' || r.caseState === 'QUEUED' || r.caseState === 'RUNNING';
                  }).slice(0, 5).map((r, idx) => {
                    const tc = getCase(r.testCaseId);
                    return (
                      <div key={idx} className="text-[10px] text-yellow-700 dark:text-yellow-300">
                        • {tc?.displayId || r.testCaseId} {tc?.title ? `- ${tc.title}` : ''}
                      </div>
                    );
                  })}
                  {pendingCount > 5 && <p className="text-[10px] text-yellow-700 dark:text-yellow-300">... and {pendingCount - 5} more</p>}
                </div>
              )}
            </div>
          )}
        <CardHeader className="flex-row items-center justify-between flex-wrap gap-3 py-3 px-5 border-b">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm font-bold">Test Case Results ({filteredResults.length})</CardTitle>
            <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg text-xs print:hidden flex-wrap">
              {[
                { key: null, label: 'All', count: stats.total },
                { key: 'pass', label: 'Pass', count: stats.pass },
                { key: 'fail', label: 'Fail', count: stats.fail },
                { key: 'error', label: 'Error', count: stats.error },
                { key: 'blocked', label: 'Blocked', count: stats.blocked },
                { key: 'skip', label: 'Skip', count: stats.skip },
                { key: 'invalid', label: 'Invalid', count: stats.invalid },
              ].map((tab) => (
                <button
                  key={tab.key || 'all'}
                  onClick={() => setStatusFilter(tab.key)}
                  className={cn(
                    'px-2 py-0.5 rounded-md transition-colors text-xs font-medium cursor-pointer',
                    statusFilter === tab.key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable data={filteredResults} columns={columns} getId={(row) => row.id} pagination={{ pageSize: 1000 }} />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorClasses: Record<string, string> = {
    green: 'text-emerald-500 dark:text-emerald-400',
    red: 'text-rose-500 dark:text-rose-400',
    orange: 'text-amber-500 dark:text-amber-400',
    zinc: 'text-zinc-500 dark:text-zinc-400',
    purple: 'text-purple-500 dark:text-purple-400',
    blue: 'text-sky-500 dark:text-sky-400',
  };

  return (
    <div className="p-3.5 rounded-xl bg-card/60 border border-border/60 shadow-xs flex flex-col justify-between">
      <div className={`text-2xl font-bold font-mono tracking-tight ${color ? colorClasses[color] || '' : 'text-foreground'}`}>{value}</div>
      <div className="text-xs font-medium text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
