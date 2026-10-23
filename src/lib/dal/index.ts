import { prisma } from '@/lib/db';
import type { Project, TestCase, TestRun, TestSuite, Module } from '@prisma/client';

export * from './projects';
export * from './workspaces';
export * from './ai';
export * from './collaboration';
export * from './execution';

// Re-export prisma client for direct use if needed
export { prisma };

// ==========================================
// SHARED/UTILITY QUERIES
// ==========================================

export interface RunHistoryPoint {
  id: string;
  name: string;
  environment: string;
  dateStr: string;
  createdAtIso: string;
  completedAtIso?: string | null;
  startedAtIso?: string | null;
  passRate: number;
  passCount: number;
  failCount: number;
  pendingCount: number;
  totalCount: number;
}

export interface EnhancedDashboardStats {
  totalCases: number;
  casesThisWeek: number;
  suites: number;
  suiteCasesCovered: number;
  openRuns: number;
  openRunsWithFailures: number;
  passRate: number;
  recentRuns: number[];
  runHistory: RunHistoryPoint[];
  passRateDelta: number;
  sparklinePeriodLabel: string;
}

export async function getDashboardStats(projectId: string): Promise<EnhancedDashboardStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalCases,
    casesThisWeek,
    suites,
    suiteCasesCovered,
    activeRuns,
    openRunsWithFailures,
    recentRunsData,
  ] = await Promise.all([
    prisma.testCase.count({ where: { project_id: projectId, deleted_at: null } }),
    prisma.testCase.count({ where: { project_id: projectId, deleted_at: null, created_at: { gte: sevenDaysAgo } } }),
    prisma.testSuite.count({ where: { project_id: projectId, deleted_at: null } }),
    prisma.suiteCase.count({ where: { suite: { project_id: projectId, deleted_at: null } } }),
    prisma.testRun.count({ where: { project_id: projectId, status: 'IN_PROGRESS', deleted_at: null } }),
    prisma.testRun.count({
      where: {
        project_id: projectId,
        status: 'IN_PROGRESS',
        deleted_at: null,
        results: { some: { status: 'FAIL' } },
      },
    }),
    prisma.testRun.findMany({
      where: {
        project_id: projectId,
        deleted_at: null,
        OR: [
          { status: { in: ['COMPLETED', 'FAILED'] } },
          {
            results: {
              none: { status: 'PENDING' },
              some: {},
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        environment: true,
        created_at: true,
        started_at: true,
        completed_at: true,
        results: {
          select: {
            test_case_id: true,
            status: true,
            attempt_number: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    }),
  ]);

  let totalOverallCases = 0;
  let totalOverallPassed = 0;

  const recentRunsReversed = [...recentRunsData].reverse();

  const runHistory: RunHistoryPoint[] = recentRunsReversed.map((run) => {
    const caseMap = new Map<string, any>();
    run.results.forEach((r) => {
      const existing = caseMap.get(r.test_case_id);
      if (!existing || (r.attempt_number || 1) > (existing.attempt_number || 1)) {
        caseMap.set(r.test_case_id, r);
      }
    });

    const dedupedResults = Array.from(caseMap.values());
    const totalCount = dedupedResults.length;
    const passed = dedupedResults.filter((r) => r.status === 'PASS');
    const failed = dedupedResults.filter((r) => r.status === 'FAIL');
    const pending = dedupedResults.filter((r) => r.status === 'PENDING');

    totalOverallCases += totalCount;
    totalOverallPassed += passed.length;

    // Honest pass rate: passed / totalCases on finalized runs
    const rate = totalCount > 0 ? Math.round((passed.length / totalCount) * 100) : 0;
    const finishDate = run.completed_at || run.created_at;

    return {
      id: run.id,
      name: run.name || 'Test Run',
      environment: run.environment || 'STAGING',
      dateStr: new Date(finishDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      createdAtIso: run.created_at.toISOString(),
      completedAtIso: run.completed_at ? run.completed_at.toISOString() : null,
      startedAtIso: run.started_at ? run.started_at.toISOString() : null,
      passRate: rate,
      passCount: passed.length,
      failCount: failed.length,
      pendingCount: pending.length,
      totalCount,
    };
  });

  const recentRuns = runHistory.map((r) => r.passRate);

  const passRate = totalOverallCases > 0 ? Math.round((totalOverallPassed / totalOverallCases) * 100) : 0;

  // Calculate passRate delta (recent half vs previous half)
  let passRateDelta = 0;
  if (recentRuns.length >= 4) {
    const mid = Math.floor(recentRuns.length / 2);
    const firstHalf = recentRuns.slice(0, mid);
    const secondHalf = recentRuns.slice(mid);
    const avgFirst = Math.round(firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length);
    const avgSecond = Math.round(secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length);
    passRateDelta = avgSecond - avgFirst;
  }

  return {
    totalCases,
    casesThisWeek,
    suites,
    suiteCasesCovered,
    openRuns: activeRuns,
    openRunsWithFailures,
    passRate,
    recentRuns,
    runHistory,
    passRateDelta,
    sparklinePeriodLabel: recentRuns.length > 0 ? `last ${recentRuns.length} runs` : 'last 14 days',
  };
}
