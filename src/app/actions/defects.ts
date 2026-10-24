'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { requireProjectMember, requireProjectMemberByCaseId, requireProjectMemberByRunId } from '@/lib/permissions';
import { logger } from '@/lib/logger';

export interface ProjectDefectItem {
  id: string;
  runResultId: string;
  testCaseId: string;
  testCaseDisplayId?: string;
  testCaseTitle?: string;
  runId: string;
  runName?: string;
  environment?: string;
  title: string;
  description?: string | null;
  severity: string;
  localStatus: string;
  ticketUrl?: string | null;
  externalTicketId?: string | null;
  ticketStatus?: string | null;
  raisedBy: number;
  raisedByName?: string;
  raisedByFullName?: string | null;
  raisedByImage?: string | null;
  raisedByColor?: string | null;
  raisedByInitials?: string | null;
  raisedAt: string;
  lastSyncedAt?: string | null;
}

export async function getProjectDefectsAction(projectIdOrSlug: string): Promise<ProjectDefectItem[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const defects = await prisma.defect.findMany({
    where: {
      deleted_at: null,
      run_result: {
        run: {
          project_id: actualProjectId,
          deleted_at: null,
        },
      },
    },
    orderBy: { raised_at: 'desc' },
    include: {
      run_result: {
        include: {
          test_case: {
            select: { id: true, display_id: true, title: true },
          },
          run: {
            select: { id: true, name: true, environment: true },
          },
        },
      },
    },
  });

  const userIds = [...new Set(defects.map((d) => d.raised_by))];
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, display_name: true, image: true, avatar_color: true, avatar_initials: true },
      })
    : [];

  const userMap = new Map(users.map((u) => [u.id, u]));

  return defects.map((d) => {
    const u = userMap.get(d.raised_by);
    return {
      id: d.id,
      runResultId: d.run_result_id,
      testCaseId: d.test_case_id,
      testCaseDisplayId: d.run_result?.test_case?.display_id,
      testCaseTitle: d.run_result?.test_case?.title,
      runId: d.run_result?.run?.id,
      runName: d.run_result?.run?.name,
      environment: d.run_result?.run?.environment,
      title: d.title,
      description: d.description,
      severity: d.severity.toLowerCase(),
      localStatus: d.local_status,
      ticketUrl: d.ticket_url,
      externalTicketId: d.external_ticket_id,
      ticketStatus: d.ticket_status,
      raisedBy: d.raised_by,
      raisedByName: u ? u.display_name || u.name || `User #${u.id}` : 'User',
      raisedByFullName: u?.name || null,
      raisedByImage: u?.image || null,
      raisedByColor: u?.avatar_color || null,
      raisedByInitials: u?.avatar_initials || null,
      raisedAt: d.raised_at.toISOString(),
      lastSyncedAt: d.last_synced_at?.toISOString() || null,
    };
  });
}

export async function getProjectOpenDefectCountAction(projectIdOrSlug: string): Promise<number> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return 0;

  const userId = (session.user as any).id as number;
  let actualProjectId: string;
  try {
    actualProjectId = await requireProjectMember(projectIdOrSlug, userId);
  } catch (err: any) {
    logger.debug('Skipped defect count for non-member project', {
      module: 'Defects',
      action: 'getProjectOpenDefectCountAction',
      projectIdOrSlug,
      userId,
    });
    return 0;
  }

  return prisma.defect.count({
    where: {
      deleted_at: null,
      local_status: { notIn: ['RESOLVED', 'CLOSED', 'WONT_FIX'] },
      run_result: {
        run: {
          project_id: actualProjectId,
          deleted_at: null,
        },
      },
    },
  });
}

export async function getTestCaseDefectsAction(testCaseId: string): Promise<ProjectDefectItem[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(testCaseId, userId);

  const defects = await prisma.defect.findMany({
    where: {
      test_case_id: testCaseId,
      deleted_at: null,
    },
    orderBy: { raised_at: 'desc' },
    include: {
      run_result: {
        include: {
          test_case: {
            select: { id: true, display_id: true, title: true },
          },
          run: {
            select: { id: true, name: true, environment: true },
          },
        },
      },
    },
  });

  const userIds = [...new Set(defects.map((d) => d.raised_by))];
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, display_name: true, image: true, avatar_color: true, avatar_initials: true },
      })
    : [];

  const userMap = new Map(users.map((u) => [u.id, u]));

  return defects.map((d) => {
    const u = userMap.get(d.raised_by);
    return {
      id: d.id,
      runResultId: d.run_result_id,
      testCaseId: d.test_case_id,
      testCaseDisplayId: d.run_result?.test_case?.display_id,
      testCaseTitle: d.run_result?.test_case?.title,
      runId: d.run_result?.run?.id,
      runName: d.run_result?.run?.name,
      environment: d.run_result?.run?.environment,
      title: d.title,
      description: d.description,
      severity: d.severity.toLowerCase(),
      localStatus: d.local_status,
      ticketUrl: d.ticket_url,
      externalTicketId: d.external_ticket_id,
      ticketStatus: d.ticket_status,
      raisedBy: d.raised_by,
      raisedByName: u ? u.display_name || u.name || `User #${u.id}` : 'User',
      raisedByFullName: u?.name || null,
      raisedByImage: u?.image || null,
      raisedByColor: u?.avatar_color || null,
      raisedByInitials: u?.avatar_initials || null,
      raisedAt: d.raised_at.toISOString(),
      lastSyncedAt: d.last_synced_at?.toISOString() || null,
    };
  });
}


/**
 * Defects raised against one run, newest first. The run overview drawer shows
 * the open count plus the three latest rows; the permission check is the same
 * as the case list so every run viewer sees the same set.
 */
export async function getRunDefectsAction(runId: string): Promise<ProjectDefectItem[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, userId, 'VIEWER');

  const defects = await prisma.defect.findMany({
    where: {
      deleted_at: null,
      run_result: { run_id: runId },
    },
    orderBy: { raised_at: 'desc' },
    include: {
      run_result: {
        include: {
          test_case: {
            select: { id: true, display_id: true, title: true },
          },
          run: {
            select: { id: true, name: true, environment: true },
          },
        },
      },
    },
  });

  const userIds = [...new Set(defects.map((d) => d.raised_by))];
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, display_name: true, image: true, avatar_color: true, avatar_initials: true },
      })
    : [];

  const userMap = new Map(users.map((u) => [u.id, u]));

  return defects.map((d) => {
    const u = userMap.get(d.raised_by);
    return {
      id: d.id,
      runResultId: d.run_result_id,
      testCaseId: d.test_case_id,
      testCaseDisplayId: d.run_result?.test_case?.display_id,
      testCaseTitle: d.run_result?.test_case?.title,
      runId: d.run_result?.run?.id,
      runName: d.run_result?.run?.name,
      environment: d.run_result?.run?.environment,
      title: d.title,
      description: d.description,
      severity: d.severity.toLowerCase(),
      localStatus: d.local_status,
      ticketUrl: d.ticket_url,
      externalTicketId: d.external_ticket_id,
      ticketStatus: d.ticket_status,
      raisedBy: d.raised_by,
      raisedByName: u ? u.display_name || u.name || `User #${u.id}` : 'User',
      raisedByFullName: u?.name || null,
      raisedByImage: u?.image || null,
      raisedByColor: u?.avatar_color || null,
      raisedByInitials: u?.avatar_initials || null,
      raisedAt: d.raised_at.toISOString(),
      lastSyncedAt: d.last_synced_at?.toISOString() || null,
    };
  });
}
