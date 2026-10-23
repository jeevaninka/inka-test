'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import {
  requireProjectMember,
  requireProjectAdmin,
  resolveProjectId,
} from '@/lib/permissions';
import { revalidatePath } from 'next/cache';
import {
  CustomPmClient,
  getEffectivePmIntegration,
  PmReleaseItem,
  PmReleaseDetail,
} from '@/lib/integrations/pm-client';
import {
  sanitizeTicketTitle,
  formatTicketStatusName,
  computeTimeAgo,
} from '@/lib/releases/utils';
import { generateCases } from '@/lib/ai/client';
import { createTestCaseAction } from '@/app/actions/cases';
import { logger } from '@/lib/logger';

export interface ReleaseOverviewItem {
  id: string;
  projectId: string;
  name: string;
  dueDate: string | null;
  externalRef: string | null;
  externalUrl?: string | null;
  createdBy?: {
    id: number;
    name: string;
    imageUrl?: string | null;
    avatarColor?: string | null;
    avatarInitials?: string | null;
  } | null;
  status: 'NOT_STARTED' | 'IN_TESTING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  completedAt: string | null;
  isOverdue: boolean;
  isDueToday: boolean;
  isAtRisk: boolean;
  timelineText: string;
  decision: {
    by: string;
    byId: number;
    at: string;
    note: string | null;
    override: boolean;
  } | null;
  metrics: {
    pass: number;
    fail: number;
    blocked: number;
    skip: number;
    invalid: number;
    pend: number;
    completed: number;
    completedPct: number;
    total: number;
    caseCount: number;
    runCount: number;
  } | null;
  coverage: {
    totalTickets: number;
    coveredTickets: number;
    uncoveredCount: number;
    exemptCount: number;
    toDoCount: number;
  };
  blocker: {
    hasFailingBlocker: boolean;
    failText?: string;
    uncoveredText?: string;
    pendingText?: string;
    readyText?: string;
    summary: string;
  };
  blockerSummary: string;
  runs: Array<{
    id: string;
    name: string;
    environment: string;
    pass: number;
    fail: number;
    blocked: number;
    skip: number;
    invalid: number;
    pend: number;
    completed: number;
    completedPct: number;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    timeAgoText: string;
    cases: Array<{
      id: string;
      title: string;
      status: string;
      ticket: string | null;
    }>;
  }>;
  tickets: Array<{
    id: string;
    ticketKey: string;
    title: string | null;
    ticketStatus: string | null;
    ticketUrl: string | null;
    exempt: boolean;
    isStillToDo: boolean;
    caseCount: number;
    caseIds: string[];
    cases: Array<{
      id: string;
      displayId: string;
      title: string;
      status?: string;
    }>;
    qaStatus: 'PASS' | 'FAIL' | 'PENDING' | 'UNCOVERED' | 'NOT_READY';
  }>;
}

/**
 * Format due date urgency / timeline status
 */
function computeTimeline(
  dueDateStr: string | null,
  completedAtStr: string | null,
  createdAtStr: string,
  isCompleted: boolean,
  hasBlockersOrPending: boolean
): { timelineText: string; isOverdue: boolean; isDueToday: boolean; isAtRisk: boolean } {
  if (isCompleted && completedAtStr) {
    const d = new Date(completedAtStr);
    const completedFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return {
      timelineText: `Completed ${completedFormatted}`,
      isOverdue: false,
      isDueToday: false,
      isAtRisk: false,
    };
  }

  if (!dueDateStr) {
    return { timelineText: 'No due date', isOverdue: false, isDueToday: false, isAtRisk: false };
  }

  const due = new Date(dueDateStr);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const dueFormatted = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (diffDays < 0) {
    return {
      timelineText: `${dueFormatted} - overdue`,
      isOverdue: true,
      isDueToday: false,
      isAtRisk: true,
    };
  } else if (diffDays === 0) {
    return {
      timelineText: `${dueFormatted} - today`,
      isOverdue: false,
      isDueToday: true,
      isAtRisk: hasBlockersOrPending,
    };
  } else {
    return {
      timelineText: dueFormatted,
      isOverdue: false,
      isDueToday: false,
      isAtRisk: diffDays <= 2 && hasBlockersOrPending,
    };
  }
}

/**
 * Fetch all releases for a project with aggregated metrics and run details
 */
export async function getProjectReleasesAction(
  projectIdOrSlug: string
): Promise<ReleaseOverviewItem[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const [releases, projectCases, releaseLogs, pmConfig] = await Promise.all([
    prisma.release.findMany({
      where: { project_id: actualProjectId },
      orderBy: { created_at: 'desc' },
      include: {
        decision_by: {
          select: { id: true, name: true, display_name: true, email: true, image: true, avatar_color: true, avatar_initials: true },
        },
        tickets: {
          orderBy: { created_at: 'asc' },
        },
        runs: {
          orderBy: { created_at: 'desc' },
          include: {
            results: {
              orderBy: [{ test_case_id: 'asc' }, { attempt_number: 'desc' }],
              include: {
                test_case: {
                  select: { id: true, display_id: true, title: true, labels: true, tags: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.testCase.findMany({
      where: { project_id: actualProjectId, deleted_at: null },
      select: { id: true, display_id: true, title: true, labels: true, tags: true },
    }),
    prisma.activityLog.findMany({
      where: { project_id: actualProjectId, entity_type: 'release' },
      orderBy: { created_at: 'asc' },
      select: { entity_id: true, user_id: true },
    }),
    getEffectivePmIntegration(actualProjectId).catch(() => null),
  ]);

  const pmRootUrl = pmConfig?.config?.baseUrl
    ? pmConfig.config.baseUrl.replace(/\/api(\/v\d+)?\/?$/, '')
    : null;
  const pmSpaceKey = pmConfig?.defaultSpace?.key || null;

  const logUserIds = Array.from(
    new Set(releaseLogs.map((l) => l.user_id).filter((id): id is number => typeof id === 'number'))
  );
  const logUsers =
    logUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: logUserIds } },
          select: {
            id: true,
            name: true,
            display_name: true,
            email: true,
            image: true,
            avatar_color: true,
            avatar_initials: true,
          },
        })
      : [];
  const logUserById = new Map(logUsers.map((u) => [u.id, u]));

  const creatorByReleaseId = new Map<
    string,
    { id: number; name: string; imageUrl?: string | null; avatarColor?: string | null; avatarInitials?: string | null }
  >();
  for (const log of releaseLogs) {
    if (log.entity_id && log.user_id && !creatorByReleaseId.has(log.entity_id)) {
      const u = logUserById.get(log.user_id);
      if (u) {
        creatorByReleaseId.set(log.entity_id, {
          id: u.id,
          name: u.name || (u as any).display_name || u.email || 'User',
          imageUrl: u.image || null,
          avatarColor: (u as any).avatar_color || null,
          avatarInitials: (u as any).avatar_initials || null,
        });
      }
    }
  }

  return releases.map((rel) => {
    // 1. Effective status calculation
    let effectiveStatus: 'NOT_STARTED' | 'IN_TESTING' | 'APPROVED' | 'REJECTED';
    if (rel.decision === 'APPROVED') effectiveStatus = 'APPROVED';
    else if (rel.decision === 'REJECTED') effectiveStatus = 'REJECTED';
    else if (rel.runs.length > 0) effectiveStatus = 'IN_TESTING';
    else effectiveStatus = 'NOT_STARTED';

    // 2. Aggregate cases & verdicts across linked runs
    // Latest attempt in the newest run takes precedence
    const seenCaseIds = new Set<string>();
    const caseMap = new Map<
      string,
      { id: string; displayId: string; title: string; status: string; tickets: string[] }
    >();

    const transformedRuns = rel.runs.map((r) => {
      let rPass = 0;
      let rFail = 0;
      let rBlocked = 0;
      let rSkip = 0;
      let rInvalid = 0;
      let rPend = 0;

      const runCases: Array<{
        id: string;
        title: string;
        status: string;
        ticket: string | null;
      }> = [];

      // Dedup results in this run (only latest attempt per case)
      const seenInRun = new Set<string>();
      for (const res of r.results) {
        if (seenInRun.has(res.test_case_id)) continue;
        seenInRun.add(res.test_case_id);

        const st = String(res.status || 'PENDING').toUpperCase();
        if (st === 'PASS') rPass++;
        else if (st === 'FAIL') rFail++;
        else if (st === 'BLOCKED') rBlocked++;
        else if (st === 'SKIP' || st === 'SKIPPED') rSkip++;
        else if (st === 'INVALID') rInvalid++;
        else rPend++;

        // Extract all ticket keys from labels and tags
        const allTags = [
          ...(res.test_case?.labels || []),
          ...(res.test_case?.tags || []),
        ];
        const caseTickets = Array.from(
          new Set(
            allTags
              .map((l) => {
                const clean = String(l || '').trim();
                if (clean.toLowerCase().startsWith('ticket:')) {
                  return clean.slice(7).toUpperCase();
                }
                if (/^[A-Za-z0-9]+-[0-9]+$/i.test(clean)) {
                  return clean.toUpperCase();
                }
                return null;
              })
              .filter(Boolean) as string[]
          )
        );

        const caseItem = {
          id: res.test_case?.id || res.test_case_id,
          displayId: res.test_case?.display_id || '',
          title: res.test_case?.title || 'Test Case',
          status: st,
          tickets: caseTickets,
        };
        runCases.push({
          id: caseItem.id,
          title: caseItem.title,
          status: caseItem.status,
          ticket: caseTickets[0] || null,
        });

        // Global latest verdict precedence across runs
        if (!seenCaseIds.has(res.test_case_id)) {
          seenCaseIds.add(res.test_case_id);
          caseMap.set(res.test_case_id, caseItem);
        }
      }

      const rCompleted = rPass + rFail + rBlocked + rSkip + rInvalid;
      const rTotal = rCompleted + rPend;
      const rCompletedPct = rTotal > 0 ? Math.round((rCompleted / rTotal) * 100) : 0;

      return {
        id: r.id,
        name: r.name,
        environment: r.environment,
        pass: rPass,
        fail: rFail,
        blocked: rBlocked,
        skip: rSkip,
        invalid: rInvalid,
        pend: rPend,
        completed: rCompleted,
        completedPct: rCompletedPct,
        status: String(r.status || 'IN_PROGRESS'),
        startedAt: r.started_at ? r.started_at.toISOString() : null,
        completedAt: r.completed_at ? r.completed_at.toISOString() : null,
        timeAgoText: computeTimeAgo(r.started_at?.toISOString() || r.created_at.toISOString()),
        cases: runCases,
      };
    });

    let aggPass = 0;
    let aggFail = 0;
    let aggBlocked = 0;
    let aggSkip = 0;
    let aggInvalid = 0;
    let aggPend = 0;
    for (const c of caseMap.values()) {
      if (c.status === 'PASS') aggPass++;
      else if (c.status === 'FAIL') aggFail++;
      else if (c.status === 'BLOCKED') aggBlocked++;
      else if (c.status === 'SKIP' || c.status === 'SKIPPED') aggSkip++;
      else if (c.status === 'INVALID') aggInvalid++;
      else aggPend++;
    }

    const aggCompleted = aggPass + aggFail + aggBlocked + aggSkip + aggInvalid;
    const aggTotal = aggCompleted + aggPend;
    const aggCompletedPct = aggTotal > 0 ? Math.round((aggCompleted / aggTotal) * 100) : 0;

    const metrics =
      rel.runs.length > 0
        ? {
            pass: aggPass,
            fail: aggFail,
            blocked: aggBlocked,
            skip: aggSkip,
            invalid: aggInvalid,
            pend: aggPend,
            completed: aggCompleted,
            completedPct: aggCompletedPct,
            total: aggTotal,
            caseCount: caseMap.size,
            runCount: rel.runs.length,
          }
        : null;

    // 3. Ticket coverage matching
    const transformedTickets = rel.tickets.map((t) => {
      const cleanKey = t.ticket_key.trim().toUpperCase();
      const rawStatus = (t.ticket_status || '').toLowerCase();
      const isStillToDo = ['to_do', 'todo', 'brain_storming', 'on_hold'].includes(rawStatus);

      // Cases in linked runs that cover this ticket
      const coveringRunCases = Array.from(caseMap.values()).filter((c) => {
        return (c.tickets || []).includes(cleanKey);
      });

      // Cases in project repository tagged with this ticket
      const repoCasesForTicket = projectCases.filter((pc) => {
        const tags = [...(pc.labels || []), ...(pc.tags || [])].map((l) =>
          String(l || '').trim().toLowerCase()
        );
        return (
          tags.includes(`ticket:${cleanKey.toLowerCase()}`) ||
          tags.includes(cleanKey.toLowerCase())
        );
      });

      // Merge unique case objects
      const caseDetailMap = new Map<string, { id: string; displayId: string; title: string; status?: string }>();
      for (const c of coveringRunCases) {
        caseDetailMap.set(c.id, { id: c.id, displayId: c.displayId, title: c.title, status: c.status });
      }
      for (const pc of repoCasesForTicket) {
        if (!caseDetailMap.has(pc.id)) {
          caseDetailMap.set(pc.id, { id: pc.id, displayId: pc.display_id, title: pc.title });
        }
      }
      const linkedCases = Array.from(caseDetailMap.values());
      const allCaseIds = linkedCases.map((c) => c.id);

      let qaStatus: 'PASS' | 'FAIL' | 'PENDING' | 'UNCOVERED' | 'NOT_READY';
      if (allCaseIds.length === 0) {
        qaStatus = isStillToDo ? 'NOT_READY' : 'UNCOVERED';
      } else if (coveringRunCases.length === 0) {
        qaStatus = 'PENDING';
      } else if (coveringRunCases.some((c) => c.status === 'FAIL')) {
        qaStatus = 'FAIL';
      } else if (coveringRunCases.every((c) => c.status === 'PASS')) {
        qaStatus = 'PASS';
      } else {
        qaStatus = 'PENDING';
      }

      return {
        id: t.id,
        ticketKey: cleanKey,
        title: sanitizeTicketTitle(t.title),
        ticketStatus: formatTicketStatusName(t.ticket_status),
        ticketUrl: t.ticket_url,
        exempt: t.exempt,
        isStillToDo,
        caseCount: allCaseIds.length,
        caseIds: allCaseIds,
        cases: linkedCases,
        qaStatus,
      };
    });

    const readyNonExemptTickets = transformedTickets.filter((t) => !t.exempt && !t.isStillToDo);
    const unlinkedTickets = readyNonExemptTickets.filter((t) => t.caseCount === 0);
    const uncoveredCount = unlinkedTickets.length;
    const coveredTickets = readyNonExemptTickets.length - uncoveredCount;

    // 4. Timeline
    const isCompleted =
      effectiveStatus === 'APPROVED' || effectiveStatus === 'REJECTED';
    const hasBlockersOrPending = (metrics && (metrics.fail > 0 || metrics.blocked > 0 || metrics.pend > 0)) || uncoveredCount > 0;
    const { timelineText, isOverdue, isDueToday, isAtRisk } = computeTimeline(
      rel.due_date ? rel.due_date.toISOString() : null,
      rel.decision_at ? rel.decision_at.toISOString() : null,
      rel.created_at.toISOString(),
      isCompleted,
      hasBlockersOrPending
    );

    // 5. Calm, High-Signal Blocker / Sign-off Summary
    let blockerSummary = '';
    if (effectiveStatus === 'IN_TESTING') {
      blockerSummary = metrics && metrics.fail === 0 && metrics.blocked === 0 && metrics.pend === 0 && uncoveredCount === 0
        ? 'Ready for sign-off'
        : 'Awaiting sign-off';
    } else if (effectiveStatus === 'APPROVED') {
      const approverName =
        rel.decision_by?.display_name ||
        rel.decision_by?.name ||
        'QA Lead';
      const dateStr = rel.decision_at
        ? rel.decision_at.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        : 'recently';
      blockerSummary = `${Boolean(rel.decision_note) ? 'Approved with override' : 'Approved'} by ${approverName} · ${dateStr}`;
    } else if (effectiveStatus === 'REJECTED') {
      const rejecterName =
        rel.decision_by?.display_name ||
        rel.decision_by?.name ||
        'QA Lead';
      blockerSummary = `Rejected by ${rejecterName}`;
    } else {
      blockerSummary = 'Awaiting test runs';
    }

    const blockerObj = {
      hasFailingBlocker: metrics ? metrics.fail > 0 : false,
      failText: metrics && metrics.fail > 0 ? `${metrics.fail} failing tests block approval` : '',
      uncoveredText: uncoveredCount > 0 ? `${uncoveredCount} tickets without cases` : '',
      pendingText: metrics && metrics.pend > 0 ? `${metrics.pend} pending tests` : '',
      readyText: effectiveStatus === 'IN_TESTING' && metrics && metrics.fail === 0 && metrics.pend === 0 && uncoveredCount === 0 ? 'Ready for sign-off' : '',
      summary: blockerSummary,
    };

    const customFieldsObj =
      rel.custom_fields && typeof rel.custom_fields === 'object'
        ? (rel.custom_fields as Record<string, any>)
        : {};

    let externalUrl: string | null = customFieldsObj.externalUrl || null;
    if (!externalUrl && rel.external_ref) {
      let baseOrigin = pmRootUrl;
      if (!baseOrigin) {
        const sampleTicketUrl = rel.tickets.find((t) => t.ticket_url)?.ticket_url;
        if (sampleTicketUrl) {
          try {
            baseOrigin = new URL(sampleTicketUrl).origin;
          } catch {
            baseOrigin = null;
          }
        }
      }
      if (baseOrigin) {
        externalUrl = pmSpaceKey
          ? `${baseOrigin}/spaces/${encodeURIComponent(pmSpaceKey)}/releases/${encodeURIComponent(rel.external_ref)}`
          : `${baseOrigin}/releases/${encodeURIComponent(rel.external_ref)}`;
      }
    }

    const createdBy =
      creatorByReleaseId.get(rel.id) ||
      (customFieldsObj.createdById
        ? {
            id: Number(customFieldsObj.createdById),
            name: customFieldsObj.createdByName || 'User',
            imageUrl: customFieldsObj.createdByImage || null,
            avatarColor: customFieldsObj.createdByColor || null,
            avatarInitials: customFieldsObj.createdByInitials || null,
          }
        : null);

    return {
      id: rel.id,
      projectId: rel.project_id,
      name: rel.name,
      dueDate: rel.due_date ? rel.due_date.toISOString() : null,
      externalRef: rel.external_ref,
      externalUrl,
      createdBy,
      status: effectiveStatus,
      createdAt: rel.created_at.toISOString(),
      completedAt: rel.decision_at ? rel.decision_at.toISOString() : null,
      isOverdue,
      isDueToday,
      isAtRisk,
      timelineText,
      decision: rel.decision
        ? {
            by:
              rel.decision_by?.display_name ||
              rel.decision_by?.name ||
              'QA Lead',
            byId: rel.decision_by_id || 0,
            at: rel.decision_at?.toISOString() || '',
            note: rel.decision_note,
            override: Boolean(rel.decision_note),
          }
        : null,
      metrics,
      coverage: {
        totalTickets: readyNonExemptTickets.length,
        coveredTickets,
        uncoveredCount,
        exemptCount: transformedTickets.filter((t) => t.exempt).length,
        toDoCount: transformedTickets.filter((t) => t.isStillToDo).length,
      },
      blocker: blockerObj,
      blockerSummary,
      runs: transformedRuns,
      tickets: transformedTickets,
    };
  });
}

export async function getReleasesAction(projectIdOrSlug: string): Promise<ReleaseOverviewItem[]> {
  return getProjectReleasesAction(projectIdOrSlug);
}

/**
 * Create a new standalone release
 */
export async function createReleaseAction(data: {
  projectId: string;
  name: string;
  dueDate?: string | null;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  if (!data.name || !data.name.trim()) {
    throw new Error('Release name is required');
  }

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { workspace_id: true },
  });

  if (!project) throw new Error('Project not found');

  const dueDate = data.dueDate ? new Date(data.dueDate) : null;

  const release = await prisma.release.create({
    data: {
      workspace_id: project.workspace_id,
      project_id: actualProjectId,
      name: data.name.trim(),
      due_date: dueDate,
      custom_fields: {
        createdById: userId,
        createdByName: (session.user as any).displayName || session.user.name || session.user.email || 'User',
        createdByImage: session.user.image || null,
        createdByColor: (session.user as any).avatarColor || null,
        createdByInitials: (session.user as any).avatarInitials || null,
      },
    },
  });

  await prisma.activityLog
    .create({
      data: {
        project_id: actualProjectId,
        user_id: userId,
        actor_type: 'user',
        action: `Created release "${release.name}"`,
        entity_type: 'release',
        entity_id: release.id,
      },
    })
    .catch(() => null);

  revalidatePath('/p');
  return release;
}

/**
 * Update an existing release
 */
export async function updateReleaseAction(
  releaseId: string,
  data: {
    name?: string;
    dueDate?: string | null;
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { project_id: true, name: true },
  });

  if (!release) throw new Error('Release not found');
  await requireProjectMember(release.project_id, userId);

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.dueDate !== undefined) {
    updateData.due_date = data.dueDate ? new Date(data.dueDate) : null;
  }

  const updated = await prisma.release.update({
    where: { id: releaseId },
    data: updateData,
  });

  revalidatePath('/p');
  return updated;
}

/**
 * Delete a release and detach its runs
 */
export async function deleteReleaseAction(releaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { project_id: true, name: true },
  });

  if (!release) throw new Error('Release not found');
  await requireProjectAdmin(release.project_id, userId);

  // Detach all runs
  await prisma.testRun.updateMany({
    where: { release_id: releaseId },
    data: { release_id: null },
  });

  await prisma.release.delete({
    where: { id: releaseId },
  });

  await prisma.activityLog
    .create({
      data: {
        project_id: release.project_id,
        user_id: userId,
        actor_type: 'user',
        action: `Deleted release "${release.name}"`,
        entity_type: 'release',
        entity_id: releaseId,
      },
    })
    .catch(() => null);

  revalidatePath('/p');
  return { success: true };
}

/**
 * Add tickets to a release and fetch details via PM client if available
 */
export async function addTicketsToReleaseAction(
  releaseId: string,
  ticketKeys: string[]
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { project_id: true, name: true },
  });

  if (!release) throw new Error('Release not found');
  await requireProjectMember(release.project_id, userId);

  // Check if existing PM tool integration is configured for this project
  const pmConfig = await getEffectivePmIntegration(release.project_id).catch(
    () => null
  );
  let pmClient: CustomPmClient | null = null;
  if (pmConfig?.enabled && pmConfig.config?.baseUrl && pmConfig.config?.apiKey) {
    try {
      pmClient = new CustomPmClient(pmConfig.config);
    } catch {
      pmClient = null;
    }
  }

  const results: any[] = [];

  for (const rawKey of ticketKeys) {
    const cleanKey = rawKey.trim().toUpperCase();
    if (!cleanKey) continue;

    // Check if ticket already exists on this release
    const existing = await prisma.releaseTicket.findUnique({
      where: {
        release_id_ticket_key: {
          release_id: releaseId,
          ticket_key: cleanKey,
        },
      },
    });

    if (existing) {
      results.push(existing);
      continue;
    }

    let title: string | null = null;
    let ticketStatus: string | null = 'In QA';
    let ticketUrl: string | null = null;

    if (pmClient) {
      try {
        const remoteTicket = await pmClient.getTicketStatus(cleanKey);
        if (remoteTicket) {
          title = sanitizeTicketTitle(remoteTicket.title) || null;
          ticketStatus = formatTicketStatusName(remoteTicket.status);
          ticketUrl = remoteTicket.url || null;
        }
      } catch {
        // Fallback gracefully
        title = `${cleanKey} User Story`;
      }
    } else {
      title = `${cleanKey} User Story`;
    }

    const created = await prisma.releaseTicket.create({
      data: {
        release_id: releaseId,
        ticket_key: cleanKey,
        title: title || `${cleanKey} Verification`,
        ticket_status: ticketStatus,
        ticket_url: ticketUrl,
        exempt: false,
      },
    });

    results.push(created);
  }

  revalidatePath('/p');
  return results;
}

/**
 * Re-sync ticket statuses from InkaBoard via CustomPmClient
 */
export async function syncReleaseTicketsAction(releaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: { tickets: true },
  });

  if (!release) throw new Error('Release not found');
  if (release.decision !== null) {
    throw new Error(
      'Cannot sync tickets for an approved or rejected release. Please re-open the release first.'
    );
  }
  await requireProjectMember(release.project_id, userId);

  const pmConfig = await getEffectivePmIntegration(release.project_id).catch(
    () => null
  );
  if (!pmConfig?.enabled || !pmConfig.config?.baseUrl || !pmConfig.config?.apiKey) {
    return { success: true, count: 0, addedCount: 0, message: 'PM integration not connected' };
  }

  const pmClient = new CustomPmClient(pmConfig.config);
  const spaceKey = pmConfig.defaultSpace?.key || undefined;
  let updatedCount = 0;
  let addedCount = 0;

  // If release was synced from InkaBoard (has external_ref), fetch full release detail with tickets
  if (release.external_ref) {
    try {
      const remoteDetail = await pmClient.getReleaseWithTickets(
        release.external_ref,
        spaceKey
      );
      if (remoteDetail && Array.isArray(remoteDetail.tickets)) {
        const existingKeys = new Set(
          release.tickets.map((t) => t.ticket_key.toUpperCase())
        );
        const newTickets = remoteDetail.tickets.filter(
          (t) => !existingKeys.has(t.key.toUpperCase())
        );

        if (newTickets.length > 0) {
          await prisma.releaseTicket.createMany({
            data: newTickets.map((t) => ({
              release_id: releaseId,
              ticket_key: t.key.toUpperCase(),
              title: sanitizeTicketTitle(t.title),
              ticket_status: formatTicketStatusName(t.status),
              ticket_url: t.url,
              exempt: false,
            })),
          });
          addedCount = newTickets.length;
        }

        // Update existing tickets with any title/status changes from InkaBoard
        const remoteTicketMap = new Map(
          remoteDetail.tickets.map((t) => [t.key.toUpperCase(), t])
        );
        for (const t of release.tickets) {
          const remoteTicket = remoteTicketMap.get(t.ticket_key.toUpperCase());
          if (remoteTicket) {
            await prisma.releaseTicket.update({
              where: { id: t.id },
              data: {
                title: sanitizeTicketTitle(remoteTicket.title) || t.title,
                ticket_status:
                  formatTicketStatusName(remoteTicket.status) || t.ticket_status,
                ticket_url: remoteTicket.url || t.ticket_url,
              },
            });
            updatedCount++;
          }
        }

        revalidatePath('/p');
        return { success: true, count: updatedCount, addedCount };
      }
    } catch {
      // Fallback to individual status refresh if full release lookup fails
    }
  }

  for (const t of release.tickets) {
    try {
      const remote = await pmClient.getTicketStatus(t.ticket_key);
      if (remote) {
        await prisma.releaseTicket.update({
          where: { id: t.id },
          data: {
            title: sanitizeTicketTitle(remote.title) || t.title,
            ticket_status: formatTicketStatusName(remote.status) || t.ticket_status,
            ticket_url: remote.url || t.ticket_url,
          },
        });
        updatedCount++;
      }
    } catch {
      // Ignore individual fetch fails
    }
  }

  logger.info('Release tickets synced with PM tool', {
    module: 'Releases',
    action: 'syncReleaseTicketsAction',
    releaseId,
    updatedCount,
    addedCount,
    userId,
  });

  revalidatePath('/p');
  return { success: true, count: updatedCount, addedCount };
}

/**
 * Toggle ticket exemption (e.g. chore / sub-ticket that needs no tests)
 */
export async function toggleTicketExemptionAction(
  ticketId: string,
  exempt: boolean
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const ticket = await prisma.releaseTicket.findUnique({
    where: { id: ticketId },
    include: { release: { select: { project_id: true, decision: true } } },
  });

  if (!ticket) throw new Error('Ticket not found');
  if (ticket.release.decision !== null) {
    throw new Error(
      'Cannot modify ticket exemptions in an approved or rejected release. Please re-open the release first.'
    );
  }
  await requireProjectMember(ticket.release.project_id, userId);

  const updated = await prisma.releaseTicket.update({
    where: { id: ticketId },
    data: { exempt },
  });

  revalidatePath('/p');
  return updated;
}

/**
 * Remove ticket from release
 */
export async function deleteReleaseTicketAction(ticketId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const ticket = await prisma.releaseTicket.findUnique({
    where: { id: ticketId },
    include: { release: { select: { project_id: true, decision: true } } },
  });

  if (!ticket) throw new Error('Ticket not found');
  if (ticket.release.decision !== null) {
    throw new Error(
      'Cannot remove tickets from an approved or rejected release. Please re-open the release first.'
    );
  }
  await requireProjectMember(ticket.release.project_id, userId);

  await prisma.releaseTicket.delete({
    where: { id: ticketId },
  });

  revalidatePath('/p');
  return { success: true };
}

/**
 * Synchronize linked test cases for a ticket (adds tags to selected cases, removes tags from unselected cases)
 */
export async function syncTicketCasesAction(data: {
  projectId: string;
  ticketKey: string;
  selectedCaseIds: string[];
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const cleanKey = data.ticketKey.trim().toUpperCase();
  const lowerKey = cleanKey.toLowerCase();
  const tagKey = `ticket:${lowerKey}`;
  const selectedSet = new Set(data.selectedCaseIds);

  const allCases = await prisma.testCase.findMany({
    where: { project_id: actualProjectId, deleted_at: null },
    select: { id: true, tags: true, labels: true },
  });

  const isMatchingTag = (val: string) => {
    const v = String(val || '').toLowerCase().trim();
    return v === lowerKey || v === tagKey;
  };

  const updates: any[] = [];

  for (const c of allCases) {
    const isSelected = selectedSet.has(c.id);
    const existingTags = c.tags || [];
    const existingLabels = c.labels || [];
    const hasExistingMatch =
      existingTags.some(isMatchingTag) || existingLabels.some(isMatchingTag);

    if (isSelected) {
      const mergedTags = Array.from(
        new Set([...existingTags, tagKey, lowerKey])
      );
      if (mergedTags.length !== existingTags.length) {
        updates.push(
          prisma.testCase.update({
            where: { id: c.id },
            data: { tags: mergedTags },
          })
        );
      }
    } else if (hasExistingMatch) {
      const filteredTags = existingTags.filter((t) => !isMatchingTag(t));
      const filteredLabels = existingLabels.filter((l) => !isMatchingTag(l));
      updates.push(
        prisma.testCase.update({
          where: { id: c.id },
          data: { tags: filteredTags, labels: filteredLabels },
        })
      );
    }
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  revalidatePath('/p');
  return { success: true, count: data.selectedCaseIds.length };
}

/**
 * Link an existing test run to a release
 */
export async function linkRunToReleaseAction(runId: string, releaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { project_id: true, name: true, decision: true },
  });

  if (!release) throw new Error('Release not found');
  if (release.decision !== null) {
    throw new Error(
      'Cannot link test runs to an approved or rejected release. Please re-open the release first.'
    );
  }
  await requireProjectMember(release.project_id, userId);

  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { project_id: true, name: true },
  });

  if (!run || run.project_id !== release.project_id) {
    throw new Error('Run does not belong to this project');
  }

  const updated = await prisma.testRun.update({
    where: { id: runId },
    data: { release_id: releaseId },
  });

  revalidatePath('/p');
  return updated;
}

/**
 * Detach a test run from its release
 */
export async function unlinkRunFromReleaseAction(runId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { project_id: true, release_id: true, release: { select: { decision: true } } },
  });

  if (!run) throw new Error('Run not found');
  if (run.release && run.release.decision !== null) {
    throw new Error(
      'Cannot unlink test runs from an approved or rejected release. Please re-open the release first.'
    );
  }
  await requireProjectMember(run.project_id, userId);

  const updated = await prisma.testRun.update({
    where: { id: runId },
    data: { release_id: null },
  });

  revalidatePath('/p');
  return updated;
}

/**
 * Approve release (Failing tests strictly BLOCK, Pending tests allow override)
 */
export async function approveReleaseAction(
  releaseId: string,
  note?: string
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: {
      tickets: true,
      runs: {
        include: {
          results: {
            orderBy: [{ test_case_id: 'asc' }, { attempt_number: 'desc' }],
          },
        },
      },
    },
  });

  if (!release) throw new Error('Release not found');
  await requireProjectMember(release.project_id, userId);

  if (release.runs.length === 0) {
    throw new Error('Approval blocked: No test runs are linked to this release');
  }

  // Pre-flight verdict checks across runs
  const caseMap = new Map<string, string>();
  for (const r of release.runs) {
    const seen = new Set<string>();
    for (const res of r.results) {
      if (!seen.has(res.test_case_id)) {
        seen.add(res.test_case_id);
        if (!caseMap.has(res.test_case_id)) {
          caseMap.set(res.test_case_id, String(res.status || 'PENDING').toUpperCase());
        }
      }
    }
  }

  let failCount = 0;
  let blockedCount = 0;
  let pendCount = 0;
  for (const st of caseMap.values()) {
    if (st === 'FAIL') failCount++;
    else if (st === 'BLOCKED') blockedCount++;
    else if (st === 'PENDING') pendCount++;
  }

  // HARD BLOCK on failing or blocked tests
  if (failCount > 0 || blockedCount > 0) {
    const reasons = [];
    if (failCount > 0) reasons.push(`${failCount} failing test(s)`);
    if (blockedCount > 0) reasons.push(`${blockedCount} blocked test(s)`);
    throw new Error(
      `Approval is strictly blocked: ${reasons.join(' and ')} detected across linked runs. Fix issues before approval.`
    );
  }

  // Pending tests require written override note
  if (pendCount > 0 && (!note || note.trim().length < 5)) {
    throw new Error(
      `Approval requires an override reason note (at least 5 characters) because ${pendCount} test(s) are still pending.`
    );
  }

  const updated = await prisma.release.update({
    where: { id: releaseId },
    data: {
      decision: 'APPROVED',
      decision_by_id: userId,
      decision_at: new Date(),
      decision_note: note ? note.trim() : null,
    },
  });

  await prisma.activityLog
    .create({
      data: {
        project_id: release.project_id,
        user_id: userId,
        actor_type: 'user',
        action: `Approved release "${release.name}"${note ? ` with override: ${note}` : ''}`,
        entity_type: 'release',
        entity_id: releaseId,
        metadata: { decision: 'APPROVED', note: note || null },
      },
    })
    .catch(() => null);

  revalidatePath('/p');
  return updated;
}

/**
 * Reject release with mandatory reason
 */
export async function rejectReleaseAction(
  releaseId: string,
  reason: string,
  bugLink?: string
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { project_id: true, name: true },
  });

  if (!release) throw new Error('Release not found');
  await requireProjectMember(release.project_id, userId);

  if (!reason || reason.trim().length < 5) {
    throw new Error('Rejection reason must be at least 5 characters');
  }

  const finalNote = bugLink ? `${reason.trim()} (Ref: ${bugLink.trim()})` : reason.trim();

  const updated = await prisma.release.update({
    where: { id: releaseId },
    data: {
      decision: 'REJECTED',
      decision_by_id: userId,
      decision_at: new Date(),
      decision_note: finalNote,
    },
  });

  await prisma.activityLog
    .create({
      data: {
        project_id: release.project_id,
        user_id: userId,
        actor_type: 'user',
        action: `Rejected release "${release.name}": ${finalNote}`,
        entity_type: 'release',
        entity_id: releaseId,
        metadata: { decision: 'REJECTED', note: finalNote },
      },
    })
    .catch(() => null);

  revalidatePath('/p');
  return updated;
}

/**
 * Re-open a release for testing
 */
export async function reopenReleaseAction(releaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { project_id: true, name: true },
  });

  if (!release) throw new Error('Release not found');
  await requireProjectMember(release.project_id, userId);

  const updated = await prisma.release.update({
    where: { id: releaseId },
    data: {
      decision: null,
      decision_by_id: null,
      decision_at: null,
      decision_note: null,
    },
  });

  await prisma.activityLog
    .create({
      data: {
        project_id: release.project_id,
        user_id: userId,
        actor_type: 'user',
        action: `Reopened release "${release.name}" for testing`,
        entity_type: 'release',
        entity_id: releaseId,
      },
    })
    .catch(() => null);

  revalidatePath('/p');
  return updated;
}

/**
 * Fetch active unreleased releases from InkaBoard via existing PM Integration
 */
export async function getInkaBoardActiveReleasesAction(
  projectIdOrSlug: string
): Promise<{
  connected: boolean;
  releases: PmReleaseItem[];
  spaceName?: string;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const pmConfig = await getEffectivePmIntegration(actualProjectId).catch(() => null);
  if (!pmConfig?.enabled || !pmConfig.config?.baseUrl || !pmConfig.config?.apiKey) {
    return { connected: false, releases: [] };
  }

  try {
    const client = new CustomPmClient(pmConfig.config);
    const spaceKey = pmConfig.defaultSpace?.key || undefined;
    const remoteReleases = await client.getActiveReleases(spaceKey);

    return {
      connected: true,
      releases: remoteReleases,
      spaceName: pmConfig.defaultSpace?.name || undefined,
    };
  } catch {
    return { connected: false, releases: [] };
  }
}

/**
 * Import a release and its tickets directly from InkaBoard
 */
export async function importReleaseFromInkaBoardAction(data: {
  projectId: string;
  externalReleaseId: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const pmConfig = await getEffectivePmIntegration(actualProjectId).catch(() => null);
  if (!pmConfig?.enabled || !pmConfig.config?.baseUrl || !pmConfig.config?.apiKey) {
    throw new Error('PM tool is not connected for this project');
  }

  const client = new CustomPmClient(pmConfig.config);
  const spaceKey = pmConfig.defaultSpace?.key || undefined;
  const remoteDetail = await client.getReleaseWithTickets(data.externalReleaseId, spaceKey);

  if (!remoteDetail) {
    throw new Error('Release not found in InkaBoard');
  }

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { workspace_id: true },
  });

  if (!project) throw new Error('Project not found');

  let formattedName = `${remoteDetail.name}${remoteDetail.versionTag ? ` - ${remoteDetail.versionTag}` : ''}`.trim();
  const existingSameName = await prisma.release.findFirst({
    where: { project_id: actualProjectId, name: formattedName },
    select: { id: true },
  });
  if (existingSameName) {
    formattedName = `${formattedName} (#${remoteDetail.id})`;
  }

  const dueDate = remoteDetail.releaseDate ? new Date(remoteDetail.releaseDate) : null;
  const rootUrl = pmConfig.config.baseUrl.replace(/\/api(\/v\d+)?\/?$/, '');
  const externalUrl = spaceKey
    ? `${rootUrl}/spaces/${encodeURIComponent(spaceKey)}/releases/${encodeURIComponent(remoteDetail.id)}`
    : `${rootUrl}/releases/${encodeURIComponent(remoteDetail.id)}`;

  const release = await prisma.release.create({
    data: {
      workspace_id: project.workspace_id,
      project_id: actualProjectId,
      name: formattedName,
      due_date: dueDate,
      external_ref: remoteDetail.id,
      custom_fields: {
        createdById: userId,
        createdByName: (session.user as any).displayName || session.user.name || session.user.email || 'User',
        createdByImage: session.user.image || null,
        createdByColor: (session.user as any).avatarColor || null,
        createdByInitials: (session.user as any).avatarInitials || null,
        externalUrl,
      },
      tickets: {
        create: remoteDetail.tickets.map((t) => ({
          ticket_key: t.key.toUpperCase(),
          title: sanitizeTicketTitle(t.title),
          ticket_status: formatTicketStatusName(t.status),
          ticket_url: t.url,
          exempt: false,
        })),
      },
    },
    include: {
      tickets: true,
    },
  });

  await prisma.activityLog
    .create({
      data: {
        project_id: actualProjectId,
        user_id: userId,
        actor_type: 'user',
        action: `Imported release "${release.name}" (#${remoteDetail.id}) with ${remoteDetail.tickets.length} ticket(s) from InkaBoard`,
        entity_type: 'release',
        entity_id: release.id,
      },
    })
    .catch(() => null);

  revalidatePath('/p');
  return release;
}

/**
 * Search tickets live across accessible spaces in InkaBoard
 */
export async function searchInkaBoardTicketsAction(
  projectIdOrSlug: string,
  query: string
): Promise<Array<{ id: string; key: string; title: string; status: string; spaceName?: string; url?: string }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const pmConfig = await getEffectivePmIntegration(actualProjectId).catch(() => null);
  if (!pmConfig?.enabled || !pmConfig.config?.baseUrl || !pmConfig.config?.apiKey) {
    return [];
  }

  const client = new CustomPmClient(pmConfig.config);
  return client.getTickets(query);
}

/**
 * Generate test cases with Gemini AI specifically for a ticket, persist them into the DB, and tag them
 */
export async function generateAndSaveAiCasesAction(data: {
  projectId: string;
  ticketKey: string;
  ticketTitle: string;
  count?: number;
  customInstructions?: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const cleanKey = data.ticketKey.trim().toUpperCase();
  const lowerKey = cleanKey.toLowerCase();
  const tagKey = `ticket:${lowerKey}`;

  // Generate test cases via Gemini AI
  const prompt = `Generate functional test cases for ticket ${cleanKey}: ${data.ticketTitle}`;
  const generatedList = await generateCases({
    description: prompt,
    tags: [lowerKey, tagKey, 'release'],
    count: data.count || 2,
    customInstructions: data.customInstructions,
  });

  const savedCases: any[] = [];
  for (const item of generatedList) {
    const saved = await createTestCaseAction({
      projectId: actualProjectId,
      moduleId: null,
      title: item.title,
      description: item.description,
      preConditions: item.preConditions,
      expectedResult: item.expectedResult,
      postConditions: item.postConditions,
      steps: (item.steps || []).map((s: any, idx: number) => ({
        order: idx + 1,
        step: s.description || s.step || `Step ${idx + 1}`,
        expected_result: s.expectedResult || s.expected_result || null,
        data: s.data || null,
        reusableStepId: null,
      })),
      priority: (item.priority || 'P1').toUpperCase(),
      type: 'manual',
      status: 'active',
      tags: [lowerKey, tagKey, 'release', 'ai-generated'],
      labels: [cleanKey],
      aiGenerated: true,
    });
    savedCases.push(saved);
  }

  revalidatePath('/p');
  return savedCases;
}
