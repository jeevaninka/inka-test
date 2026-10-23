'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getDashboardStats, type EnhancedDashboardStats } from '@/lib/dal';
import { prisma } from '@/lib/db';
import { requireProjectMember } from '@/lib/permissions';
import { getReleasesAction } from '@/app/actions/releases';
import { logger } from '@/lib/logger';

export interface AttentionReleaseItem {
  id: string;
  name: string;
  dueDate: string | null;
  timelineText: string;
  isOverdue: boolean;
  isDueToday: boolean;
  failingCount: number;
  totalPassing: number;
  uncoveredTickets: number;
  urgency: 'critical' | 'high' | 'medium';
}

export interface AttentionRunItem {
  id: string;
  name: string;
  environment: string;
  failCount: number;
  passCount: number;
  totalCases: number;
  timeAgoText: string;
  isStale: boolean;
  urgency: 'critical' | 'high' | 'medium';
}

export interface AttentionReviewItem {
  id: string;
  caseId: string;
  caseDisplayId: string;
  title: string;
  priority: string;
  requesterName: string;
  requesterAvatar: string | null;
  timeAgoText: string;
  urgency: 'critical' | 'high' | 'medium';
}

export interface AttentionBugItem {
  id: string;
  title: string;
  severity: string;
  caseDisplayId: string | null;
  timeAgoText: string;
  urgency: 'critical' | 'high' | 'medium';
}

export interface NeedsAttentionData {
  totalCount: number;
  releases: AttentionReleaseItem[];
  runs: AttentionRunItem[];
  reviews: AttentionReviewItem[];
  bugs: AttentionBugItem[];
  unassignedReviewsCount: number;
}

export interface ActiveReleaseCardData {
  id: string;
  name: string;
  dueDate: string | null;
  dueDateFormatted: string | null;
  daysRemainingText: string;
  isOverdue: boolean;
  isDueToday: boolean;
  passCount: number;
  failCount: number;
  pendingCount: number;
  totalCount: number;
  passRate: number;
  uncoveredTickets: number;
}

export interface MyQueueItem {
  id: string;
  type: 'review' | 'run';
  title: string;
  subtitle: string;
  link: string;
  badge?: string;
  timeAgoText: string;
}

export interface TopFailingCaseItem {
  id: string;
  displayId: string;
  title: string;
  failCount: number;
}

export interface AttentionRowItem {
  id: string;
  type: 'release' | 'run' | 'review' | 'bug' | 'stale_runs';
  title: string;
  subtitle: string;
  badge?: {
    label: string;
    variant: 'danger' | 'warning' | 'info' | 'default';
  };
  link: string;
  severityRank: number;
}

export interface ActivityItem {
  id: string;
  userId: string | null;
  action: string;
  displayText: string;
  displayDate: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  entityDisplayId?: string;
  metadata?: any;
  createdAt: string;
  formattedTime: string;
  dateGroup: 'Today' | 'Yesterday' | 'Earlier';
}

export interface DashboardData {
  stats: EnhancedDashboardStats;
  activeRelease: ActiveReleaseCardData | null;
  activeReleases: ActiveReleaseCardData[];
  needsAttentionItems: AttentionRowItem[];
  needsAttention: NeedsAttentionData;
  staleRunsCount: number;
  topFailingCases: TopFailingCaseItem[];
  myQueue: MyQueueItem[];
  activity: ActivityItem[];
  users: {
    id: string;
    name: string;
    avatarUrl: string | null;
  }[];
}

function formatRelativeTime(dateStr: string | Date | null): string {
  if (!dateStr) return '';
  const now = Date.now();
  const past = new Date(dateStr).getTime();
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatExactDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function getDateGroup(dateStr: string): 'Today' | 'Yesterday' | 'Earlier' {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return 'Earlier';
}

function formatHumanActivityText(action: string, entityType: string, entityName?: string): string {
  const text = action.trim();
  const matchCase = text.match(/Created test case ["“](.+?)["”]/i);
  if (matchCase) return `Created a Test Case - ${matchCase[1]}`;

  const matchRun = text.match(/Created (?:test )?run ["“](.+?)["”]/i);
  if (matchRun) return `Created a Test Run - ${matchRun[1]}`;

  const matchRelease = text.match(/Created release ["“](.+?)["”]/i);
  if (matchRelease) return `Created a Release - ${matchRelease[1]}`;

  const matchPlan = text.match(/Created (?:test )?plan ["“](.+?)["”]/i);
  if (matchPlan) return `Created a Test Plan - ${matchPlan[1]}`;

  const matchSuite = text.match(/(?:Created|Added) (?:test )?suite ["“](.+?)["”]/i);
  if (matchSuite) return `Created a Test Suite - ${matchSuite[1]}`;

  const matchModule = text.match(/Created module ["“](.+?)["”]/i);
  if (matchModule) return `Created a Module - ${matchModule[1]}`;

  const matchImport = text.match(/Imported release ["“](.+?)["”]/i);
  if (matchImport) return `Created a Release - ${matchImport[1]}`;

  const matchExecuted = text.match(/Executed test case ["“](.+?)["”]/i);
  if (matchExecuted) return `Executed a Test Case - ${matchExecuted[1]}`;

  const cleanAction = action.replace(/["“”]/g, '');
  if (entityName) return `${cleanAction} - ${entityName}`;
  return cleanAction;
}

export async function getDashboardDataAction(projectId: string): Promise<DashboardData> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectId, userId);

  const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Parallel fetch: stats, human activity, releases, runs, reviews, defects, failing cases
  const [
    stats,
    activityLogs,
    rawReleases,
    rawOpenRuns,
    rawUserReviews,
    unassignedReviewsCount,
    rawOpenDefects,
    assignedRuns,
    failingResults,
  ] = await Promise.all([
    getDashboardStats(actualProjectId),
    // 1. Human activities only (omits background system/bot noise)
    prisma.activityLog.findMany({
      where: {
        project_id: actualProjectId,
        user_id: { not: null },
      },
      orderBy: { created_at: 'desc' },
      take: 12,
    }),
    // 2. Canonical releases with accurate ticket coverage
    getReleasesAction(actualProjectId),
    // 3. Open runs
    prisma.testRun.findMany({
      where: { project_id: actualProjectId, status: 'IN_PROGRESS', deleted_at: null },
      include: {
        results: { select: { status: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    }),
    // 4. Reviews assigned to current user
    prisma.reviewRequest.findMany({
      where: {
        test_case: { project_id: actualProjectId, deleted_at: null },
        status: { in: ['PENDING', 'CHANGES_REQUESTED'] },
        assigned_to: userId,
      },
      include: {
        test_case: { select: { id: true, display_id: true, title: true, priority: true } },
        requester: { select: { id: true, name: true, image: true, email: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 6,
    }),
    // 4b. Unassigned reviews count
    prisma.reviewRequest.count({
      where: {
        test_case: { project_id: actualProjectId, deleted_at: null },
        status: { in: ['PENDING', 'CHANGES_REQUESTED'] },
        assigned_to: null,
      },
    }),
    // 5. Open defects
    prisma.defect.findMany({
      where: {
        deleted_at: null,
        local_status: { in: ['OPEN', 'IN_PROGRESS'] },
        run_result: {
          run: {
            project_id: actualProjectId,
            deleted_at: null,
          },
        },
      },
      include: {
        run_result: {
          select: {
            run_id: true,
            test_case: { select: { display_id: true, title: true } },
          },
        },
      },
      orderBy: { raised_at: 'desc' },
      take: 10,
    }),
    // 6. Runs assigned to current user
    prisma.testRun.findMany({
      where: {
        project_id: actualProjectId,
        assigned_to: userId,
        status: 'IN_PROGRESS',
        deleted_at: null,
      },
      include: {
        results: { select: { status: true } },
      },
      take: 5,
    }),
    // 7. Top failing cases across runs
    prisma.runResult.groupBy({
      by: ['test_case_id'],
      where: {
        run: { project_id: actualProjectId, deleted_at: null },
        status: 'FAIL',
      },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: 4,
    }),
  ]) as unknown as [
    EnhancedDashboardStats,
    any[],
    any[],
    any[],
    any[],
    number,
    any[],
    any[],
    any[]
  ];

  // Transform: Top Failing Cases
  const failingCaseIds = failingResults.map((r: any) => r.test_case_id);
  const failingCaseDetails =
    failingCaseIds.length > 0
      ? await prisma.testCase.findMany({
          where: { id: { in: failingCaseIds } },
          select: { id: true, display_id: true, title: true },
        })
      : [];
  const failingCaseMap = new Map(failingCaseDetails.map((c) => [c.id, c]));

  const topFailingCases: TopFailingCaseItem[] = failingResults
    .filter((r) => failingCaseMap.has(r.test_case_id))
    .map((r) => {
      const c = failingCaseMap.get(r.test_case_id)!;
      return {
        id: c.id,
        displayId: c.display_id,
        title: c.title,
        failCount: r._count.id,
      };
    });

  // Transform: Active Release Card Data
  const activeReleasesList: ActiveReleaseCardData[] = rawReleases
    .filter((r) => r.status === 'IN_TESTING' || r.status === 'NOT_STARTED')
    .map((r) => {
      const passCount = r.metrics ? r.metrics.pass : 0;
      const failCount = r.metrics ? r.metrics.fail : 0;
      const pendingCount = r.metrics ? r.metrics.pend : 0;
      const totalCount = r.metrics ? r.metrics.total : 0;
      const passRate = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 0;
      const uncoveredTickets = r.coverage.uncoveredCount; // Canonical: 2!

      return {
        id: r.id,
        name: r.name,
        dueDate: r.dueDate,
        dueDateFormatted: r.dueDate ? formatExactDate(new Date(r.dueDate)) : null,
        daysRemainingText: r.timelineText || 'No due date',
        isOverdue: r.isOverdue,
        isDueToday: r.isDueToday,
        passCount,
        failCount,
        pendingCount,
        totalCount,
        passRate,
        uncoveredTickets,
      };
    });

  const activeRelease = activeReleasesList[0] || null;

  // Stale runs separation
  let staleRunsCount = 0;
  const activeOpenRuns: typeof rawOpenRuns = [];
  for (const run of rawOpenRuns) {
    const runDate = run.started_at || run.created_at;
    const isStale = runDate < staleThreshold;
    if (isStale) {
      staleRunsCount++;
    } else {
      activeOpenRuns.push(run);
    }
  }

  // Transform legacy attention items
  const attentionReleases: AttentionReleaseItem[] = rawReleases.map((r) => {
    const failingCount = r.metrics ? r.metrics.fail : 0;
    const totalPassing = r.metrics ? r.metrics.pass : 0;
    const uncoveredTickets = r.coverage.uncoveredCount;
    const urgency: 'critical' | 'high' | 'medium' = r.isOverdue || failingCount > 0 ? 'critical' : r.isDueToday ? 'high' : 'medium';

    return {
      id: r.id,
      name: r.name,
      dueDate: r.dueDate,
      timelineText: r.timelineText || 'No due date',
      isOverdue: r.isOverdue,
      isDueToday: r.isDueToday,
      failingCount,
      totalPassing,
      uncoveredTickets,
      urgency,
    };
  });

  const attentionRuns: AttentionRunItem[] = rawOpenRuns.map((r) => {
    const failCount = r.results.filter((res: any) => res.status === 'FAIL').length;
    const passCount = r.results.filter((res: any) => res.status === 'PASS').length;
    const totalCases = r.results.length;
    const runDate = r.started_at || r.created_at;
    const isStale = runDate < staleThreshold;
    const urgency: 'critical' | 'high' | 'medium' = failCount > 0 ? 'critical' : isStale ? 'high' : 'medium';

    return {
      id: r.id,
      name: r.name,
      environment: r.environment,
      failCount,
      passCount,
      totalCases,
      timeAgoText: formatRelativeTime(runDate),
      isStale,
      urgency,
    };
  });

  const attentionReviews: AttentionReviewItem[] = rawUserReviews.map((r) => {
    const createdDate = new Date(r.created_at);
    const diffDays = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    const urgency: 'critical' | 'high' | 'medium' = diffDays >= 2 || r.test_case.priority === 'P0' || r.test_case.priority === 'P1' ? 'critical' : diffDays >= 1 ? 'high' : 'medium';

    return {
      id: r.id,
      caseId: r.test_case.id,
      caseDisplayId: r.test_case.display_id,
      title: r.test_case.title,
      priority: r.test_case.priority,
      requesterName: r.requester ? r.requester.name || r.requester.email.split('@')[0] : 'Teammate',
      requesterAvatar: r.requester?.image || null,
      timeAgoText: formatRelativeTime(r.created_at),
      urgency,
    };
  });

  const attentionBugs: AttentionBugItem[] = rawOpenDefects.slice(0, 6).map((d) => {
    const urgency: 'critical' | 'high' | 'medium' = d.severity === 'CRITICAL' ? 'critical' : d.severity === 'HIGH' ? 'high' : 'medium';
    return {
      id: d.id,
      title: d.title,
      severity: d.severity,
      caseDisplayId: (d as any).run_result?.test_case?.display_id || null,
      timeAgoText: formatRelativeTime(d.raised_at),
      urgency,
    };
  });

  // Construct Top 5 Capped Unified Needs Attention Rows
  const attentionCandidates: AttentionRowItem[] = [];

  // 1. Releases with failing runs or due today (excluding the active release card if displayed)
  for (const rel of attentionReleases) {
    if (activeRelease && rel.id === activeRelease.id) continue; // Don't duplicate the active release card!
    if (rel.failingCount > 0 || rel.isDueToday || rel.isOverdue) {
      attentionCandidates.push({
        id: rel.id,
        type: 'release',
        title: rel.name,
        subtitle: `${rel.failingCount} failing tests · ${rel.uncoveredTickets} uncovered tickets`,
        badge: {
          label: rel.isOverdue ? 'Overdue' : rel.isDueToday ? 'Due today' : `${rel.failingCount} failing`,
          variant: rel.isOverdue || rel.failingCount > 0 ? 'danger' : 'warning',
        },
        link: `/releases`,
        severityRank: rel.isOverdue ? 1 : rel.failingCount > 0 ? 2 : 3,
      });
    }
  }

  // 2. Active runs with failures
  for (const run of activeOpenRuns) {
    const failCount = run.results.filter((res: any) => res.status === 'FAIL').length;
    if (failCount > 0) {
      const passCount = run.results.filter((res: any) => res.status === 'PASS').length;
      attentionCandidates.push({
        id: run.id,
        type: 'run',
        title: run.name,
        subtitle: `${run.environment} · ${passCount}/${run.results.length} passed · ${formatRelativeTime(run.started_at || run.created_at)}`,
        badge: {
          label: `${failCount} failed`,
          variant: 'danger',
        },
        link: `/runs/${run.id}`,
        severityRank: 4,
      });
    }
  }

  // 3. User reviews waiting
  for (const rev of attentionReviews) {
    attentionCandidates.push({
      id: rev.id,
      type: 'review',
      title: rev.title,
      subtitle: `${rev.caseDisplayId} · Requested by ${rev.requesterName} · ${rev.timeAgoText}`,
      badge: {
        label: rev.priority,
        variant: rev.priority === 'P0' || rev.priority === 'P1' ? 'danger' : 'default',
      },
      link: `/reviews/${rev.caseId}`,
      severityRank: 5,
    });
  }

  // 4. Critical / High Bugs
  for (const bug of attentionBugs) {
    if (bug.severity === 'CRITICAL' || bug.severity === 'HIGH') {
      attentionCandidates.push({
        id: bug.id,
        type: 'bug',
        title: bug.title,
        subtitle: `${bug.caseDisplayId ? `${bug.caseDisplayId} · ` : ''}${bug.severity} severity · ${bug.timeAgoText}`,
        badge: {
          label: bug.severity,
          variant: bug.severity === 'CRITICAL' ? 'danger' : 'warning',
        },
        link: `/defects`,
        severityRank: 6,
      });
    }
  }

  // 5. Folded Stale Runs (single consolidated row!)
  if (staleRunsCount > 0) {
    attentionCandidates.push({
      id: 'stale-runs-group',
      type: 'stale_runs',
      title: `${staleRunsCount} runs untouched for 7+ days`,
      subtitle: 'Inactive runs requiring review or cleanup',
      badge: {
        label: 'Stale',
        variant: 'warning',
      },
      link: `/runs?status=in_progress`,
      severityRank: 7,
    });
  }

  // Cap at 5 rows maximum sorted by severity
  const needsAttentionItems = attentionCandidates.sort((a, b) => a.severityRank - b.severityRank).slice(0, 5);

  // My Queue (Assigned runs + Assigned reviews)
  const myQueue: MyQueueItem[] = [];
  for (const rev of attentionReviews) {
    myQueue.push({
      id: rev.id,
      type: 'review',
      title: rev.title,
      subtitle: `${rev.caseDisplayId} · Review requested`,
      badge: rev.priority,
      link: `/reviews/${rev.caseId}`,
      timeAgoText: rev.timeAgoText,
    });
  }
  for (const run of assignedRuns) {
    const pCount = run.results.filter((res: any) => res.status === 'PASS').length;
    myQueue.push({
      id: run.id,
      type: 'run',
      title: run.name,
      subtitle: `${pCount}/${run.results.length} passed · ${run.environment}`,
      badge: run.environment,
      link: `/runs/${run.id}`,
      timeAgoText: formatRelativeTime(run.started_at || run.created_at),
    });
  }

  // Resolve metadata names for activity log
  const userIds = activityLogs.map((a) => a.user_id).filter((id): id is number => id !== null);
  const suiteIds = activityLogs.filter((a) => a.entity_type === 'test_suite' || a.entity_type === 'suite').map((a) => a.entity_id);
  const runIds = activityLogs.filter((a) => a.entity_type === 'test_run' || a.entity_type === 'run').map((a) => a.entity_id);
  const caseIds = activityLogs.filter((a) => a.entity_type === 'test_case' || a.entity_type === 'case').map((a) => a.entity_id);
  const moduleIds = activityLogs.filter((a) => a.entity_type === 'module').map((a) => a.entity_id);
  const releaseIds = activityLogs.filter((a) => a.entity_type === 'release').map((a) => a.entity_id);

  const [dbUsers, dbSuites, dbRuns, dbCases, dbModules, dbReleases] = await Promise.all([
    userIds.length > 0 ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, image: true } }) : [],
    suiteIds.length > 0 ? prisma.testSuite.findMany({ where: { id: { in: suiteIds } }, select: { id: true, name: true } }) : [],
    runIds.length > 0 ? prisma.testRun.findMany({ where: { id: { in: runIds } }, select: { id: true, name: true } }) : [],
    caseIds.length > 0 ? prisma.testCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, title: true, display_id: true } }) : [],
    moduleIds.length > 0 ? prisma.module.findMany({ where: { id: { in: moduleIds } }, select: { id: true, name: true } }) : [],
    releaseIds.length > 0 ? prisma.release.findMany({ where: { id: { in: releaseIds } }, select: { id: true, name: true } }) : [],
  ]);

  const suiteMap = new Map(dbSuites.map((s) => [s.id, s.name]));
  const runMap = new Map(dbRuns.map((r) => [r.id, r.name]));
  const caseMap = new Map(dbCases.map((c) => [c.id, { title: c.title, displayId: c.display_id }]));
  const moduleMap = new Map(dbModules.map((m) => [m.id, m.name]));
  const releaseMap = new Map(dbReleases.map((r) => [r.id, r.name]));

  const activity: ActivityItem[] = activityLogs.map((log) => {
    let entityName: string | undefined = undefined;
    let entityDisplayId: string | undefined = undefined;
    const type = log.entity_type.toLowerCase();

    if (type === 'test_suite' || type === 'suite') {
      entityName = suiteMap.get(log.entity_id);
    } else if (type === 'test_run' || type === 'run') {
      entityName = runMap.get(log.entity_id);
    } else if (type === 'test_case' || type === 'case') {
      const c = caseMap.get(log.entity_id);
      if (c) {
        entityName = c.title;
        entityDisplayId = c.displayId;
      }
    } else if (type === 'module') {
      entityName = moduleMap.get(log.entity_id);
    } else if (type === 'release') {
      entityName = releaseMap.get(log.entity_id);
    }

    const isoStr = log.created_at.toISOString();
    return {
      id: log.id,
      userId: log.user_id !== null ? String(log.user_id) : null,
      action: log.action,
      displayText: formatHumanActivityText(log.action, log.entity_type, entityName),
      displayDate: formatExactDate(log.created_at),
      entityType: log.entity_type,
      entityId: log.entity_id,
      entityName,
      entityDisplayId,
      metadata: log.metadata,
      createdAt: isoStr,
      formattedTime: formatRelativeTime(log.created_at),
      dateGroup: getDateGroup(isoStr),
    };
  });

  return {
    stats,
    activeRelease,
    activeReleases: activeReleasesList,
    needsAttentionItems,
    needsAttention: {
      totalCount: needsAttentionItems.length,
      releases: attentionReleases,
      runs: attentionRuns,
      reviews: attentionReviews,
      bugs: attentionBugs,
      unassignedReviewsCount,
    },
    staleRunsCount,
    topFailingCases,
    myQueue,
    activity,
    users: dbUsers.map((u) => ({
      id: String(u.id),
      name: u.name || u.email.split('@')[0],
      avatarUrl: u.image || null,
    })),
  };
}
