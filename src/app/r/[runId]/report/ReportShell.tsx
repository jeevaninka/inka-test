"use client";

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResultStatusBadge } from '@/components/common/ResultStatusBadge';
import { AlertTriangle, Bug, Clock, Copy, Database, ExternalLink, Printer, RotateCcw, ChevronDown, ChevronRight, CalendarDays, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ResultStatus } from '@/lib/types';

interface DefectMini {
  id: string;
  externalTicketId?: string | null;
  ticketUrl?: string | null;
  title?: string | null;
  ticketStatus?: string | null;
  raisedByName?: string | null;
  raisedAt: string;
}

interface RunResult {
  id: string;
  runId: string;
  testCaseId: string;
  displayId?: string;
  caseTitle?: string;
  orderIndex: number;
  attemptNumber: number;
  totalAttempts: number;
  status: string;
  executedBy?: number | null;
  executedAt?: string | null;
  timeSpentSeconds: number;
  totalTimeSpentSeconds: number;
  attempts: Array<{ attemptNumber: number; timeSpentSeconds: number; status: string }>;
  failureReason?: string | null;
  notes?: string | null;
  evidenceUrl?: string | null;
  stepResults?: any;
  iterationResults?: any[];
  defects: DefectMini[];
}

interface RunHeader {
  id: string;
  projectId: string;
  projectSlug?: string;
  suiteId?: string;
  releaseId?: string | null;
  releaseName?: string | null;
  name: string;
  environment: string;
  buildVersion?: string;
  assignedTo?: number | null;
  status: string;
  source: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  expiresAt?: string | null;
  resolved_variables?: Record<string, unknown>;
  suiteName?: string | null;
}

interface TeamRow {
  id: string;
  name: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  pending: number;
  executed: number;
  lastActivity: string | null;
  executedSeconds: number;
  counts: Record<string, number>;
}

interface ReportData {
  run: RunHeader;
  results: RunResult[];
  cases: Record<string, { displayId?: string; title?: string }>;
  defects: any[];
  teamRows: TeamRow[];
  hasManualCases: boolean;
  isInternal: boolean;
  workspaceName: string;
  projectName: string;
  runId: string;
}

export function ReportShell({
  data,
  error,
  isPrint,
  includePassedDefault,
}: {
  data: ReportData | null;
  error: string;
  isPrint: boolean;
  includePassedDefault: boolean;
}) {
  const [includePassed, setIncludePassed] = useState(includePassedDefault);
const [statusFilter, setStatusFilter] = useState<null | 'fail' | 'error' | 'blocked' | 'invalid'>(null);
  const setFilter = (v: string | null) => setStatusFilter(v === 'fail' ? 'fail' : v === 'error' ? 'error' : v === 'blocked' ? 'blocked' : v === 'invalid' ? 'invalid' : null);
  const [showAttempts, setShowAttempts] = useState(false);

  if (error || !data || !data.run) {
    return (
      <div className="min-h-screen flex items-center justify-center font-sans">
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">{error || 'Report not found'}</p>
          {data?.isInternal && (
            <Link href={`/p/${data.run?.id ? '' : ''}`} className="text-sm text-primary underline">Go back to runs</Link>
          )}
        </div>
      </div>
    );
  }

  const { run, results, defects, teamRows, hasManualCases, isInternal, workspaceName, projectName, runId } = data;

  // ---- Stats
  const stats = useMemo(() => {
    const total = results.length;
    const pass = results.filter((r) => r.status === 'pass').length;
    const fail = results.filter((r) => r.status === 'fail').length;
    const error = results.filter((r) => r.status === 'error').length;
    const blocked = results.filter((r) => r.status === 'blocked').length;
    const skip = results.filter((r) => r.status === 'skip').length;
    const invalid = results.filter((r) => r.status === 'invalid').length;
    return { total, pass, fail, error, blocked, skip, invalid, rerun: results.filter((r) => r.attemptNumber > 1).length };
  }, [results]);

  // ---- Effective result label per interim rules
  const effectiveResult = useMemo(() => {
    const hasFailures = stats.fail > 0 || stats.error > 0;
    const allTerminal = stats.total > 0
      && (stats.pass + stats.invalid + (stats.skip === 0 ? 0 : stats.skip) + stats.blocked + stats.error) >= stats.total
      && stats.pass + stats.invalid + stats.blocked + stats.error + stats.skip === stats.total;
    if (run.status?.toLowerCase() === 'aborted') return 'Aborted';
    if (hasFailures) return 'Failed';
    if (stats.invalid > 0 && !hasFailures) return `Passed with ${stats.invalid} invalid`;
    if (allTerminal) return 'Passed';
    return 'In progress';
  }, [run.status, stats]);

  const resultBadgeColor = (label: string) => {
    if (label.includes('Passed')) return 'green';
    if (label.includes('Failed')) return 'red';
    if (label === 'In progress') return 'blue';
    if (label === 'Aborted') return 'zinc';
    return 'zinc';
  };

  // ---- Pass rate = Passed ÷ (Total − Invalid)
  const passRateDenom = Math.max(0, stats.total - stats.invalid);
  const passRate = passRateDenom > 0 ? Math.round((stats.pass / passRateDenom) * 100) : 0;

  // ---- Timing
  const startTime = run.startedAt ? new Date(run.startedAt) : null;
  const endTime = run.completedAt ? new Date(run.completedAt) : null;
  const durationMs = startTime && endTime ? endTime.getTime() - startTime.getTime() : null;
  const duration = durationMs ? formatDuration(durationMs / 1000) : null;
  const executionTotalSeconds = results.reduce((s, r) => s + (r.totalTimeSpentSeconds || 0), 0);

  // ---- Attention items: failed / blocked / error / invalid
  const attentionItems = useMemo(
    () => results.filter((r) => isFailedResultStatus(r.status) || r.status === 'blocked' || r.status === 'invalid'),
    [results]
  );

  // ---- Table rows (passed collapsed by default unless filter/print+includePassed)
  const showAll = isPrint && includePassed;
  const passedRows = results.filter((r) => r.status === 'pass');
  const nonPassedRows = results.filter((r) => r.status !== 'pass');
  const tableRows = statusFilter
    ? results.filter((r) => r.status === statusFilter)
    : showAll
      ? results
      : [...nonPassedRows, ...passedRows];

  // ---- Conditional columns
  const hasDefects = results.some((r) => r.defects && r.defects.length > 0);
  const hasIterations = results.some((r) => r.iterationResults && Array.isArray(r.iterationResults) && r.iterationResults.length > 0);
  const executors = useMemo(() => {
    const set = new Set<number>();
    results.forEach((r) => { if (r.executedBy) set.add(r.executedBy); });
    return Array.from(set);
  }, [results]);

  const columns: any[] = [
    { id: 'order', header: '#', className: 'w-12 text-center', cell: (i: number) => i + 1 },
    { id: 'case', header: 'Case', cell: (r: RunResult) => <CaseCell result={r} /> },
    { id: 'result', header: 'Result', className: 'text-center', cell: (r: RunResult) => <ResultStatusBadge status={r.status as ResultStatus} /> },
    { id: 'time', header: 'Time (mm:ss)', className: 'text-center', cell: (r: RunResult) => fmtTimer(r.totalTimeSpentSeconds) },
    ...(hasDefects ? [{ id: 'defect', header: 'Defect', cell: (r: RunResult) => <DefectCell defects={r.defects} failureReason={r.failureReason} /> }] : []),
    ...(hasIterations ? [{ id: 'iterations', header: 'Iterations', className: 'text-center', cell: (r: RunResult) => <IterationsCell row={r} /> }] : []),
    ...(executors.length > 1 ? [{ id: 'executor', header: 'Executed By', className: 'text-center', cell: (r: RunResult) => r.executedBy ? <ExecutorCell userId={r.executedBy} /> : '—' }] : []),
    { id: 'attempts', header: 'Attempts', className: 'text-center', cell: (r: RunResult) => <span className="font-mono text-xs">{r.totalAttempts || r.attemptNumber}</span> },
  ];

  const chartData = [
    { name: 'Pass', value: stats.pass, color: '#10b981' },
    { name: 'Fail', value: stats.fail, color: '#f43f5e' },
    { name: 'Blocked', value: stats.blocked, color: '#f59e0b' },
    { name: 'Skip', value: stats.skip, color: '#71717a' },
    { name: 'Invalid', value: stats.invalid, color: '#a855f7' },
    { name: 'Error', value: stats.error, color: '#ef4444' },
  ].filter((d) => d.value > 0);

  const statusFilterTabs = [
    { key: null, label: 'All', count: stats.total },
    { key: 'pass', label: 'Pass', count: stats.pass },
    { key: 'fail', label: 'Fail', count: stats.fail + stats.error },
    { key: 'blocked', label: 'Blocked', count: stats.blocked },
    { key: 'invalid', label: 'Invalid', count: stats.invalid },
    { key: 'skip', label: 'Skip', count: stats.skip },
  ];

  return (
    <div className="font-sans text-foreground bg-background min-h-screen print:bg-white print:text-black">
      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm 10mm; }
          body { background: #fff !important; color: #000 !important; }
          header, nav, .print-hidden { display: none !important; }
          .print-shadow-none { box-shadow: none !important; border-color: #e2e8f0 !important; }
          table td, table th { padding: 4px 6px !important; font-size: 9px !important; }
          tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          a { color: #000 !important; text-decoration: underline !important; }
          .print-header { position: fixed; top: 0; left: 0; right: 0; border-bottom: 1px solid #e2e8f0; padding: 4mm 10mm; font-size: 8px; color: #000; }
          .print-page-number:after { content: counter(page); }
          .print-page-count:after { content: counter(pages); }
        }
        @page { margin: 8mm 10mm; }
      `}</style>

      {/* Print header (fixed) */}
      <div className="print-header print:hidden sm:print:block hidden">
        <span className="font-bold">{run.name}</span> · <span>Page <span className="print-page-number"></span> of <span className="print-page-count"></span></span>
      </div>

      {/* ── Slim Header (web) / footer region */}
      <header className="print-hidden border-b border-border/50 px-4 py-2.5 flex items-center justify-between bg-background/80 backdrop-blur">
        <div className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{workspaceName}</span> · {projectName}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {data?.isInternal && data.run?.projectSlug && (
            <Link href={`/p/${data.run.projectSlug}/runs/${runId}`} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              Back to run
            </Link>
          )}
        </div>
      </header>

      {/* Report generation meta (web, above title) */}
      {!isPrint && (
        <div className="print-hidden px-4 py-2 text-xs text-muted-foreground border-b border-border/30">
          Report generated {fmtDate(new Date())}
          {isInternal && ' · internal view'}
        </div>
      )}

      {/* ── Main content */}
      <main className="px-4 py-4 print:px-0 print:py-0 max-w-5xl mx-auto space-y-4 print:space-y-3">
        {/* Title block */}
        <section className="print-shadow-none space-y-2.5 print:space-y-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-bold text-foreground print:text-black">{run.name}</h1>
            <ResultStatusWithBadge label={effectiveResult} color={resultBadgeColor(effectiveResult)} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {run.suiteName && <span className="font-medium text-foreground">{run.suiteName}</span>}
            <span className="px-2 py-0.5 rounded bg-muted font-medium capitalize">{run.environment}</span>
            {run.buildVersion && <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{run.buildVersion}</span>}
            {run.releaseName && <span className="font-medium text-foreground">Release: {run.releaseName}</span>}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs print:grid-cols-2">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground font-medium">Started:</span>
              <span className="font-mono text-foreground">{startTime ? fmtDateTime(startTime) : '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground font-medium">Ended:</span>
              <span className="font-mono text-foreground">{endTime ? fmtDateTime(endTime) : '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground font-medium">Duration:</span>
              <span className="font-mono text-foreground font-semibold">{duration || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground font-medium">Execution time:</span>
              <span className="font-mono text-foreground font-semibold">{fmtTimerColon(executionTotalSeconds)}</span>
            </div>
          </div>
        </section>

        {/* Copy link / Print buttons (slim) */}
        <div className="print:hidden flex items-center gap-2 justify-end print-hidden">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success('Report link copied'); }}>
            <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy link
          </Button>
          <Button size="sm" className="h-7 gradient-btn text-white" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5 mr-1.5" /> Print (PDF)
          </Button>
        </div>

        {/* Summary: pass rate ring + stat tiles */}
        <section className="print-shadow-none grid gap-4 md:grid-cols-[220px_1fr] print:grid-cols-[180px_1fr]">
          <PassRateRing passRate={passRate} passed={stats.pass} denom={passRateDenom} />
          <StatTiles stats={stats} />
        </section>

        {/* Attention section (first) */}
        <AttentionSection items={attentionItems} results={results} />

        {/* Bugs section */}
        {defects && defects.length > 0 && (
          <BugsSection defects={defects} />
        )}

        {/* Team progress section */}
        {hasManualCases && teamRows && teamRows.length > 0 && (
          <TeamProgressSection rows={teamRows as TeamRow[]} />
        )}

        {/* Re-run attempts collapsible */}
        {stats.rerun > 0 && (
          <ReRunSection results={results} />
        )}

        {/* Results table */}
        <ResultsTable
          columns={columns as any}
          rows={tableRows}
          statusFilter={statusFilter}
          onFilter={setFilter}
          tabs={statusFilterTabs}
          passedCount={passedRows.length}
          includePassed={includePassed}
          onTogglePassed={() => setIncludePassed(!includePassed)}
          isPrint={isPrint}
          passedRows={passedRows}
        />

        {/* Re-run attempts detail (collapsible) */}
        {stats.rerun > 0 && <ReRunAttemptsSection results={results} />}

        {/* Environment snapshot */}
        {run.resolved_variables && Object.keys(run.resolved_variables).length > 0 && (
          <EnvSnapshot vars={run.resolved_variables} />
        )}
      </main>

      {/* Shared-link footer */}
      {!isInternal && !isPrint && (
        <footer className="print-hidden px-4 py-3 border-t border-border/50 text-xs text-muted-foreground flex justify-between">
          <span>Shared link</span>
          <span>Expires {run.expiresAt ? fmtDate(new Date(run.expiresAt)) : 'Never'}</span>
        </footer>
      )}
    </div>
  );
}

// ────────────────────────────── helpers ──────────────────────────────

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtDateTime(d: Date) {
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtTimer(sec: number) {
  if (!sec || sec <= 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
function fmtTimerColon(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
function formatDuration(sec: number) {
  if (!sec || sec <= 0) return '0s';
  const s = Math.floor(sec);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
function isFailedResultStatus(status: string) {
  return status === 'fail' || status === 'error' || status === 'blocked' || status === 'invalid';
}

// ────────────────────────────── sub-components ──────────────────────────────

function ResultStatusWithBadge({ label, color }: { label: string; color: string }) {
  const colorClass =
    color === 'green' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' :
    color === 'red' ? 'bg-rose-500/10 text-rose-600 border-rose-500/30' :
    color === 'blue' ? 'bg-sky-500/10 text-sky-600 border-sky-500/30' :
    'bg-zinc-500/10 text-zinc-500 border-zinc-500/30';
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${colorClass}`}>
      {label}
    </span>
  );
}

function PassRateRing({ passRate, passed, denom }: { passRate: number; passed: number; denom: number }) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const pct = passRate / 100;
  const offset = circumference * (1 - pct);
  return (
    <div className="print-shadow-none flex flex-col items-center justify-center p-4 border rounded-lg bg-card/40">
      <svg width="180" height="180" viewBox="0 0 180 180" className="print:hidden">
        <circle cx="90" cy="90" r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth="10" />
        <circle
          cx="90" cy="90" r={radius} fill="none" stroke={pct === 1 ? '#10b981' : pct === 0 ? '#ef4444' : '#38bdf8'}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 90 90)"
          className="transition-all duration-900"
        />
        <text x="90" y="95" textAnchor="middle" className="fill-foreground font-black text-3xl" dy="0.3em">{passRate}%</text>
        <text x="90" y="120" textAnchor="middle" className="fill-muted-foreground text-[9px] uppercase tracking-wider" dy="0.3em">Pass Rate</text>
      </svg>
      {/* Print fallback */}
      <div className="hidden print-donut-fallback items-center justify-center w-28 h-28 rounded-full border-[7px] border-emerald-600"></div>
      <div className="mt-1 text-center">
        <div className="text-xs font-bold uppercase tracking-wide text-foreground print:text-black">{passed} of {passed + denom === 0 ? 0 : passed + denom} cases passed</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Passed ÷ (Total − Invalid)</div>
      </div>
    </div>
  );
}

function StatTiles({ stats }: { stats: { total: number; pass: number; fail: number; error: number; blocked: number; skip: number; invalid: number; rerun: number } }) {
  const items = [
    { label: 'Total', value: stats.total },
    { label: 'Passed', value: stats.pass, muted: stats.pass === 0 },
    { label: 'Failed', value: stats.fail + stats.error, muted: stats.fail + stats.error === 0, danger: true },
    { label: 'Blocked', value: stats.blocked, muted: stats.blocked === 0 },
    { label: 'Invalid', value: stats.invalid, muted: stats.invalid === 0 },
    ...(stats.skip > 0 ? [{ label: 'Skipped', value: stats.skip, muted: false }] : []),
    { label: 'Re-ran', value: stats.rerun, muted: stats.rerun === 0 },
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
      {items.map((it) => (
        <div
          key={it.label}
          className={`p-3 rounded-lg border text-center ${
            it.muted ? 'opacity-50' : ''
          } ${it.danger ? 'border-destructive/30 bg-destructive/5' : 'border-border/50 bg-card/50'}`}
        >
          <div className={`text-2xl font-bold font-mono ${it.muted ? 'text-muted-foreground' : it.danger ? 'text-destructive' : 'text-foreground'}`}>{it.value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function CaseCell({ result }: { result: RunResult }) {
  const { displayId, caseTitle, orderIndex } = result;
  const title = caseTitle || 'Unknown case';
  return (
    <div className="flex flex-col min-w-0">
      {displayId ? (
        <span className="font-mono text-xs font-bold text-foreground">{displayId}</span>
      ) : (
        <span className="text-xs font-mono text-muted-foreground">#{orderIndex + 1}</span>
      )}
      <span className="font-mono text-xs text-muted-foreground" title={title}><span className="text-xs font-medium text-foreground line-clamp-1">{title}</span></span>
    </div>
  );
}

function DefectCell({ defects, failureReason }: { defects: DefectMini[]; failureReason?: string | null }) {
  if (defects && defects.length > 0) {
    const d = defects[0];
    const label = d.externalTicketId || d.ticketUrl?.split('/').pop() || d.title || 'Defect';
    return (
      <a href={d.ticketUrl || '#'} target="_blank" rel="noopener noreferrer" className="text-xs text-red-500 hover:underline flex items-center gap-1 font-medium" title={label}>
        <Bug className="h-3 w-3" />
        <span className="truncate max-w-[140px]">{label}</span>
        {d.ticketUrl && <ExternalLink className="h-2.5 w-2.5" />}
      </a>
    );
  }
  if (failureReason) {
    return <em className="text-xs text-muted-foreground italic line-clamp-1 block max-w-[180px]" title={failureReason}>{failureReason}</em>;
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function IterationsCell({ row }: { row: RunResult }) {
  const iters = (row as any).iterationResults;
  if (!iters || !Array.isArray(iters) || iters.length === 0) return '—';
  const passCount = iters.filter((i: any) => i.status?.toLowerCase() === 'pass').length;
  return (
    <span className={cn(
      "text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold inline-block",
      passCount === iters.length
        ? "bg-emerald-500/15 text-emerald-700 border border-emerald-500/25"
        : "bg-red-500/15 text-red-700 border border-red-500/25"
    )}>
      {passCount}/{iters.length}
    </span>
  );
}

function ExecutorCell({ userId }: { userId: number }) {
  // Lightweight: show id badge (resolved name available via team rows in practice).
  return <span className="text-xs font-mono text-muted-foreground">#{userId}</span>;
}

function AttentionSection({ items, results }: { items: RunResult[]; results: RunResult[] }) {
  if (!items.length) {
    return (
      <Card className="print-shadow-none">
        <CardContent className="p-4">
          <div className="text-center py-6 text-muted-foreground">
            <Bug className="h-6 w-6 mx-auto mb-2 opacity-30" />
            <p className="font-semibold text-foreground">No failures</p>
            <p className="text-xs mt-1">This run has no failed, blocked, errored, or invalid cases.</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="print-shadow-none">
      <CardHeader className="py-2.5 px-4 border-b">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          Failures & Attention ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-border/40">
        {items.map((r) => (
          <div key={r.id} className="p-3 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <span className="font-mono text-xs font-bold text-muted-foreground w-16 text-right">{r.displayId || `#${r.orderIndex + 1}`}</span>
              <span className="text-xs font-medium text-foreground line-clamp-2" title={r.caseTitle}>{r.caseTitle || 'Unknown'}</span>
            </div>
            <div className="flex items-center gap-3 text-right shrink-0">
              <ResultStatusBadge status={r.status as ResultStatus} />
              <span className="font-mono text-xs text-muted-foreground">{fmtTimerColon(r.totalTimeSpentSeconds)}</span>
              <span className="text-xs text-muted-foreground">Attempts: {r.totalAttempts}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function BugsSection({ defects }: { defects: any[] }) {
  return (
    <Card className="print-shadow-none">
      <CardHeader className="py-2.5 px-4 border-b">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Bug className="h-4 w-4 text-rose-500" />
          Bugs ({defects.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Key / ID</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Title</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Severity</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reported</th>
            </tr>
          </thead>
          <tbody>
            {defects.map((d) => (
              <tr key={d.id} className="border-b border-border/30">
                <td className="px-3 py-2">
                  {d.externalTicketId || d.ticketUrl ? (
                    <a href={d.ticketUrl || '#'} target="_blank" rel="noopener noreferrer" className="text-xs text-red-500 hover:underline flex items-center gap-1 font-medium">
                      <Bug className="h-3 w-3" />
                      <span>{d.externalTicketId || d.ticketUrl?.split('/').pop()}</span>
                      {d.ticketUrl && <ExternalLink className="h-2.5 w-2.5" />}
                    </a>
                  ) : (
                    <span className="text-xs font-mono">{d.id.slice(0, 8)}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-foreground">{d.title || d.description || '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{d.ticketStatus || d.localStatus || '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground capitalize">{d.severity || '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{d.raisedByName ? `${d.raisedByName} · ${fmtDate(new Date(d.raisedAt))}` : fmtDate(new Date(d.raisedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function TeamProgressSection({ rows }: { rows: TeamRow[] }) {
  const totalExecuted = rows.reduce((s, r) => s + r.executed, 0);
  return (
    <Card className="print-shadow-none">
      <CardHeader className="py-2.5 px-4 border-b">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Users className="h-4 w-4 text-sky-500" />
          Team progress
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tester</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Total</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Passed</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Failed</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Blocked</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
              return (
                <tr key={r.id} className="border-b border-border/30">
                  <td className="px-3 py-2 text-xs font-medium text-foreground">{r.name}</td>
                  <td className="px-3 py-2 text-xs text-center">{r.total}</td>
                  <td className="px-3 py-2 text-xs text-center text-emerald-600">{r.passed}</td>
                  <td className="px-3 py-2 text-xs text-center text-rose-600">{r.failed + (r.counts?.error || 0)}</td>
                  <td className="px-3 py-2 text-xs text-center text-amber-600">{r.blocked}</td>
                  <td className="px-3 py-2 text-xs font-mono text-center text-muted-foreground">{fmtTimerColon(r.executedSeconds)}</td>
                  <td className="px-3 py-2 w-32">
                    <div className="h-2 rounded bg-muted/50 overflow-hidden">
                      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-3 py-2 text-[10px] text-muted-foreground border-t border-border/30">{totalExecuted} cases executed across {rows.length} testers</div>
      </CardContent>
    </Card>
  );
}

function ReRunSection({ results }: { results: RunResult[] }) {
  const rerunResults = results.filter((r) => r.attemptNumber > 1);
  return (
    <Card className="print-shadow-none">
      <CardHeader className="py-2.5 px-4 border-b cursor-pointer" onClick={() => {}}>
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-purple-500" />
          Re-run attempts ({rerunResults.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-2">
        {rerunResults.map((r) => (
          <div key={r.id} className="p-2.5 border border-border/50 rounded-lg bg-card/40 text-xs">
            <div className="flex items-center gap-2 font-medium">
              <span className="font-mono text-muted-foreground">{r.displayId || `#${r.orderIndex + 1}`}</span>
              <span className="text-foreground line-clamp-1" title={r.caseTitle}>{r.caseTitle || 'Unknown'}</span>
              <ResultStatusBadge status={r.status as ResultStatus} className="ml-auto" />
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>Attempt #{r.attemptNumber} of {r.totalAttempts}</span>
            <span>Time: <strong className="text-foreground font-mono">{fmtTimerColon(r.totalTimeSpentSeconds)}</strong></span>
            {r.failureReason && <span>Failure: <em className="text-red-400">{r.failureReason}</em></span>}
          </div>
        </div>
      ))}
    </CardContent>
  </Card>
  );
}

function ReRunAttemptsSection({ results }: { results: RunResult[] }) {
  const [open, setOpen] = useState(false);
  const rerunResults = results.filter((r) => r.attemptNumber > 1 || r.attempts.length > 1);
  if (!rerunResults.length) return null;
  return (
    <Card className="print-shadow-none print:hidden">
      <CardHeader
        className="py-2.5 px-4 border-b cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <CardTitle className="text-sm font-bold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-purple-500" />
            Re-run attempts ({rerunResults.length})
          </span>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="p-4 space-y-3">
          {rerunResults.map((r) => (
            <div key={r.id} className="border border-border/50 rounded-lg p-3 text-xs">
              <div className="flex items-center gap-2 font-medium mb-1.5">
                <span className="font-mono text-muted-foreground">{r.displayId || `#${r.orderIndex + 1}`}</span>
                <span className="text-foreground">{r.caseTitle}</span>
              </div>
              <div className="space-y-1">
                {r.attempts.slice().reverse().map((a) => (
                  <div key={a.attemptNumber} className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Attempt #{a.attemptNumber}</span>
                    <span className={cn(
                      "font-mono",
                      a.status === 'pass' ? 'text-emerald-600' :
                      a.status === 'fail' || a.status === 'error' ? 'text-rose-600' : 'text-foreground'
                    )}>
                      {a.status} — {fmtTimer(a.timeSpentSeconds)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function EnvSnapshot({ vars }: { vars: Record<string, unknown> }) {
  return (
    <Card className="print-shadow-none">
      <CardHeader className="py-2 px-4 border-b">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-sky-400" />
          <span>Environment &amp; Variable Snapshot ({Object.keys(vars).length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(vars).map(([key, val]) => (
            <div key={key} className="px-2 py-0.75 rounded bg-muted/40 border border-border/50 text-xs font-mono inline-flex">
              <span className="text-sky-600 dark:text-sky-400 font-semibold mr-1">{key}:</span>
              <span className="text-foreground">{String(val)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultsTable({
  columns,
  rows,
  statusFilter,
  onFilter,
  tabs,
  passedCount,
  includePassed,
  onTogglePassed,
  isPrint,
  passedRows,
}: {
  columns: any[];
  rows: any[];
  statusFilter: string | null;
  onFilter: (v: string | null) => void;
  tabs: { key: string | null; label: string; count: number }[];
  passedCount: number;
  includePassed: boolean;
  onTogglePassed: () => void;
  isPrint: boolean;
  passedRows: any[];
}) {
  return (
    <Card className="print-shadow-none">
      <CardHeader className="py-2.5 px-4 border-b flex flex-row items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <CardTitle className="text-sm font-bold">Test Case Results ({rows.length})</CardTitle>
          <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg text-xs print:hidden flex-wrap">
            {tabs.map((tab) => (
              <button
                key={tab.key || 'all'}
                onClick={() => onFilter(tab.key)}
                className={cn(
                  'px-2 py-0.5 rounded-md transition-colors text-xs font-medium cursor-pointer',
                  statusFilter === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
        </div>
        {!isPrint && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={includePassed} onChange={() => onTogglePassed()} className="rounded" />
              Include passed cases
            </label>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              {columns.map((c) => (
                <th key={c.id} className={cn("px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id} className="border-b border-border/20 hover:bg-muted/20">
                {columns.map((c) => (
                  <td key={c.id} className={cn("px-3 py-2 text-xs align-middle", c.className)}>
                    {typeof c.cell === 'function' ? (c.header === '#' ? c.cell(i) : c.cell(row)) : c.cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
      {/* Collapsed passed notice */}
      {!includePassed && !isPrint && passedCount > 0 && (
        <div className="px-3 py-1.5 border-t border-border/30 text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="font-mono font-semibold">{passedCount} passed cases collapsed</span>
          <span className="opacity-40">— showing failed/blocked/error/invalid & skip cases</span>
        </div>
      )}
    </Card>
  );
}


