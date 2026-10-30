import { getCachedServerSession } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { mapPrismaRunToMock, mapPrismaCaseToMock } from '@/lib/dal/mappers';
import { buildTeamProgress } from '@/lib/runs/team-progress';
import { isTerminalResultStatus, isFailedResultStatus, latestAttempts } from '@/lib/execution/state';
import { ReportShell } from '../../ReportShell';
import { getRunReportShareByToken } from '@/app/actions/report-shares';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ runId: string; token: string }>;
  searchParams: Promise<{ print?: string; includePassed?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const share = await getRunReportShareByToken(token);
  if (!share) return { title: 'Report not found — InkaTest' };
  return { title: `Report — ${share.run.name} — InkaTest` };
}

async function fetchPublicReport(runId: string, token: string) {
  const share = await getRunReportShareByToken(token);
  if (!share) return null;

  let run: any = null;
  try {
    run = await prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        project: { select: { id: true, name: true, slug: true, workspace: { select: { name: true } } } },
        suite: { select: { name: true } },
        release: { select: { id: true, name: true, due_date: true } },
      },
    });
  } catch {
    return null;
  }
  if (!run) return null;

  const workspaceName = run.project?.workspace?.name || 'Workspace';
  const projectName = run.project?.name || 'Project';

  const allResults = await prisma.runResult.findMany({
    where: { run_id: runId },
    orderBy: [{ test_case_id: 'asc' }, { attempt_number: 'desc' }],
    include: { test_case: true, defects: true },
  });
  const latest = latestAttempts(allResults);
  const ordered = latest.sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));

  const caseIds = Array.from(new Set(ordered.map((r: any) => r.test_case_id).filter(Boolean)));
  const prismaCases = await prisma.testCase.findMany({
    where: { id: { in: caseIds } },
    select: { id: true, display_id: true, title: true, module_id: true, priority: true, type: true, status: true },
  });
  const casesMap = new Map(prismaCases.map((c: any) => [c.id, { id: c.id, displayId: c.display_id, title: c.title, moduleId: c.module_id, priority: c.priority, type: c.type, status: c.status }]));

  const totalTimeByCase = new Map<string, number>();
  const attemptsByCase = new Map<string, number>();
  const attemptHistoryByCase = new Map<string, Array<{ attemptNumber: number; timeSpentSeconds: number; status: string }>>();
  for (const r of allResults) {
    totalTimeByCase.set(r.test_case_id, (totalTimeByCase.get(r.test_case_id) || 0) + (r.time_spent_seconds || 0));
    attemptsByCase.set(r.test_case_id, Math.max(attemptsByCase.get(r.test_case_id) || 0, r.attempt_number || 1));
    if (!attemptHistoryByCase.has(r.test_case_id)) attemptHistoryByCase.set(r.test_case_id, []);
    attemptHistoryByCase.get(r.test_case_id)!.push({
      attemptNumber: r.attempt_number || 1,
      timeSpentSeconds: r.time_spent_seconds || 0,
      status: String(r.status).toLowerCase(),
    });
  }

  const mappedRun = mapPrismaRunToMock({
    ...run,
    results: ordered,
  });
  mappedRun.projectSlug = run.project?.slug || '';
  mappedRun.suiteName = run.suite?.name || null;
  mappedRun.releaseId = run.release_id || null;
  mappedRun.releaseName = run.release?.name || null;
  mappedRun.expiresAt = share.expiresAt ?? null;
  mappedRun.startedAt = run.started_at?.toISOString() ?? undefined;
  mappedRun.completedAt = run.completed_at?.toISOString() ?? undefined;

  const results = ordered.map((r: any) => {
    const caseId = r.test_case_id;
    const mappedCase = casesMap.get(caseId);
    return {
      id: r.id,
      runId: r.run_id,
      testCaseId: caseId,
      displayId: mappedCase?.displayId,
      caseTitle: mappedCase?.title,
      orderIndex: r.order_index,
      attemptNumber: r.attempt_number,
      totalAttempts: attemptsByCase.get(caseId) ?? (r.attempt_number || 1),
      status: String(r.status).toLowerCase(),
      executedBy: r.executed_by,
      executedAt: r.executed_at?.toISOString() ?? null,
      timeSpentSeconds: r.time_spent_seconds ?? 0,
      totalTimeSpentSeconds: totalTimeByCase.get(caseId) ?? (r.time_spent_seconds ?? 0),
      attempts: (attemptHistoryByCase.get(caseId) || []).sort((a, b) => b.attemptNumber - a.attemptNumber),
      failureReason: r.failure_reason,
      notes: r.notes,
      evidenceUrl: r.evidence_url,
      stepResults: r.step_results,
      iterationResults: r.iteration_results,
      defects: (r.defects || []).map((d: any) => ({
        id: d.id,
        runResultId: d.run_result_id,
        testCaseId: d.test_case_id,
        title: d.title,
        description: d.description,
        severity: String(d.severity || '').toLowerCase(),
        ticketUrl: d.ticket_url,
        externalTicketId: d.external_ticket_id,
        ticketStatus: d.ticket_status,
        raisedBy: d.raised_by,
        raisedAt: d.raised_at.toISOString(),
      })),
    };
  });

  // Defects
  const defectRows = await prisma.defect.findMany({
    where: { run_result: { run_id: runId }, deleted_at: null },
    include: {
      run_result: { select: { test_case: { select: { display_id: true } }, test_case_id: true } },
    },
  });
  const defectUserIds = [...new Set(defectRows.map((d: any) => d.raised_by))];
  const defectUsers = defectUserIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: defectUserIds } }, select: { id: true, name: true, email: true, image: true } })
    : [];
  const defectUserMap = new Map(defectUsers.map((u) => [u.id, u]));
  const defects = defectRows.map((d: any) => ({
    id: d.id,
    runResultId: d.run_result_id,
    testCaseId: d.run_result?.test_case_id,
    displayId: d.run_result?.test_case?.display_id,
    title: d.title,
    description: d.description,
    severity: String(d.severity || '').toLowerCase(),
    localStatus: String(d.local_status || '').toLowerCase(),
    ticketUrl: d.ticket_url,
    externalTicketId: d.external_ticket_id,
    ticketStatus: d.ticket_status,
    raisedByName: defectUserMap.get(d.raised_by)?.name,
    raisedByEmail: defectUserMap.get(d.raised_by)?.email,
    raisedAt: d.raised_at.toISOString(),
  }));

  // Team progress (only manual executors)
  const executorIds = [...new Set(results.filter((r) => r.executedBy).map((r) => r.executedBy))];
  const users = executorIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: executorIds } }, select: { id: true, name: true, email: true, image: true } })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const resolveAssignee = (leaf: any) => {
    if (!leaf.assignedTo) return null;
    const u = userMap.get(leaf.assignedTo);
    if (!u) return null;
    return {
      id: String(u.id),
      name: u.name || u.email?.split('@')[0] || `User #${u.id}`,
      email: u.email ?? null,
      avatarUrl: u.image ?? null,
    };
  };
  const teamRows = buildTeamProgress(results as any, resolveAssignee as any);
  const hasManualCases = teamRows.some((row) => row.id !== 'unassigned');

  return {
    run: mappedRun,
    results,
    cases: Object.fromEntries(casesMap),
    defects,
    teamRows,
    hasManualCases,
    isInternal: false,
    workspaceName,
    projectName,
    runId,
    shareToken: token,
    shareReadOnly: true,
  };
}

export default async function PublicRunReportPage({ params, searchParams }: Props) {
  const { runId, token } = await params;
  const sp = await searchParams;
  const includePassed = sp.includePassed === '1' || sp.includePassed === 'true';

  let data: Awaited<ReturnType<typeof fetchPublicReport>> | null = null;
  let error = '';
  try {
    data = await fetchPublicReport(runId, token);
  } catch (err) {
    logger.error('Failed to load public run report', { module: 'PublicRunReportPage', runId, error: err });
    error = 'Failed to load report';
  }

  return (
    <ReportShell
      data={data}
      error={error}
      isPrint={sp.print === 'true'}
      includePassedDefault={includePassed}
    />
  );
}
