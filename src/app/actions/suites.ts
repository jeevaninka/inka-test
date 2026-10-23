'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { generateTestSuiteId } from '@/lib/ids';
import { revalidatePath } from 'next/cache';
import {
  requireProjectAdmin,
  requireProjectMember,
  requireProjectViewer,
  requireProjectMemberBySuiteId,
  requireProjectMemberByCaseId,
} from '@/lib/permissions';
import { logger } from '@/lib/logger';

export async function createTestSuiteAction(data: {
  projectId: string;
  name: string;
  type: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const id = await generateTestSuiteId();

  const suite = await prisma.testSuite.create({
    data: {
      id,
      project_id: data.projectId,
      name: data.name,
      tags: [data.type.toUpperCase()],
      created_by: userId,
    },
  });

  // Log detailed activity
  await prisma.activityLog.create({
    data: {
      project_id: data.projectId,
      user_id: userId,
      action: `Created test suite "${data.name}"`,
      entity_type: 'test_suite',
      entity_id: id,
    },
  });

  logger.info('Test suite created', {
    module: 'Suites',
    action: 'createTestSuiteAction',
    suiteId: id,
    projectId: data.projectId,
    userId,
  });

  revalidatePath(`/p`);
  return suite;
}

export async function updateTestSuiteAction(suiteId: string, data: { name?: string; type?: string }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const suite = await prisma.testSuite.findUnique({ where: { id: suiteId } });
  if (!suite) throw new Error('Suite not found');

  if (suite.project_id) {
    await requireProjectMember(suite.project_id, userId);
  }

  const updateData: any = {};
  if (data.name) updateData.name = data.name.trim();
  if (data.type) updateData.tags = [data.type.toUpperCase()];

  const updated = await prisma.testSuite.update({
    where: { id: suiteId },
    data: updateData,
  });

  if (suite.project_id) {
    await prisma.activityLog.create({
      data: {
        project_id: suite.project_id,
        user_id: userId,
        action: `Updated test suite "${updated.name}"`,
        entity_type: 'test_suite',
        entity_id: suiteId,
      },
    });
  }

  revalidatePath('/p');
  return updated;
}

export async function saveSuiteCasesAction(suiteId: string, cases: { id: string; assigneeId: number | null }[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const suite = await prisma.testSuite.findUnique({ where: { id: suiteId } });
  if (!suite) throw new Error('Suite not found');
  
  if (suite.project_id) {
    await requireProjectMember(suite.project_id, userId);
  }

  await prisma.$transaction(async (tx) => {
    // Delete existing cases
    await tx.suiteCase.deleteMany({
      where: { suite_id: suiteId },
    });

    // Insert new cases in order with assignee
    if (cases.length > 0) {
      await tx.suiteCase.createMany({
        data: cases.map((c, index) => ({
          suite_id: suiteId,
          test_case_id: c.id,
          order_index: index,
          assignee_id: c.assigneeId,
        })),
      });
    }

    // Log detailed activity
    await tx.activityLog.create({
      data: {
        project_id: suite.project_id,
        user_id: userId,
        action: `Updated test cases and assignments for suite "${suite.name}"`,
        entity_type: 'test_suite',
        entity_id: suiteId,
      },
    });
  });

  revalidatePath(`/p`);
  return true;
}

export async function getSuiteCasesAction(suiteId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await requireProjectMemberBySuiteId(suiteId, userId, 'VIEWER');

  const suiteCases = await prisma.suiteCase.findMany({
    where: { suite_id: suiteId },
    include: { test_case: true },
    orderBy: { order_index: 'asc' },
  });

  return suiteCases.map((sc) => ({
    id: sc.test_case.id,
    displayId: sc.test_case.display_id,
    projectId: sc.test_case.project_id,
    moduleId: sc.test_case.module_id,
    title: sc.test_case.title,
    description: sc.test_case.description,
    steps: sc.test_case.steps as any[],
    priority: sc.test_case.priority,
    type: sc.test_case.type.toLowerCase(),
    status: sc.test_case.status.toLowerCase(),
    tags: sc.test_case.tags,
    aiGenerated: sc.test_case.ai_generated,
    createdBy: sc.test_case.created_by,
    createdAt: sc.test_case.created_at.toISOString(),
    suiteCaseOrderIndex: sc.order_index,
    assignee_id: sc.assignee_id,
  }));
}

export async function addCaseToSuiteAction(suiteId: string, testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const suite = await prisma.testSuite.findUnique({
    where: { id: suiteId },
    select: { project_id: true },
  });
  if (!suite) throw new Error('Suite not found');
  await requireProjectMember(suite.project_id, userId);

  let testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { status: true, id: true, title: true, display_id: true, project_id: true },
  });

  // Fallback: try lookup by display_id scoped to project (e.g. "TC-001")
  if (!testCase) {
    testCase = await prisma.testCase.findFirst({
      where: { display_id: testCaseId, project_id: suite.project_id },
      select: { status: true, id: true, title: true, display_id: true, project_id: true },
    });
  }

  if (!testCase) throw new Error('Test case not found');
  if (testCase.project_id !== suite.project_id) {
    throw new Error('Test case does not belong to the same project as the suite');
  }

  const resolvedId = testCase.id;

  const lastCase = await prisma.suiteCase.findFirst({
    where: { suite_id: suiteId },
    orderBy: { order_index: 'desc' },
  });

  const orderIndex = lastCase ? lastCase.order_index + 1 : 0;

  await prisma.suiteCase.create({
    data: {
      suite_id: suiteId,
      test_case_id: resolvedId,
      order_index: orderIndex,
    },
  });

  // Log detailed activity
  await prisma.activityLog.create({
    data: {
      project_id: testCase.project_id,
      user_id: userId,
      action: `Added test case "${testCase.title}" (${testCase.display_id || testCase.id}) to suite`,
      entity_type: 'test_suite',
      entity_id: suiteId,
    },
  });

  revalidatePath(`/p`);
  return true;
}

export async function removeCaseFromSuiteAction(suiteId: string, testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const suiteProjectId = await requireProjectMemberBySuiteId(suiteId, userId);

  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { id: true, title: true, display_id: true, project_id: true },
  });

  // Both sides of the relation must live in the same tenant.
  if (!testCase || testCase.project_id !== suiteProjectId) {
    throw new Error('Test case not found in this project');
  }

  await prisma.suiteCase.delete({
    where: {
      suite_id_test_case_id: {
        suite_id: suiteId,
        test_case_id: testCaseId,
      },
    },
  });

  // Log detailed activity
  if (testCase) {
    await prisma.activityLog.create({
      data: {
        project_id: testCase.project_id,
        user_id: userId,
        action: `Removed test case "${testCase.title}" (${testCase.display_id || testCase.id}) from suite`,
        entity_type: 'test_suite',
        entity_id: suiteId,
      },
    });
  }

  revalidatePath(`/p`);
  return true;
}

export async function reorderSuiteCasesAction(suiteId: string, caseIds: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const suite = await prisma.testSuite.findUnique({
    where: { id: suiteId },
    select: { name: true, project_id: true },
  });

  await requireProjectMemberBySuiteId(suiteId, userId);

  await prisma.$transaction(
    caseIds.map((caseId, index) =>
      prisma.suiteCase.updateMany({
        where: {
          suite_id: suiteId,
          test_case_id: caseId,
          test_case: { project_id: suite?.project_id },
        },
        data: { order_index: index },
      })
    )
  );

  // Log detailed activity
  if (suite) {
    await prisma.activityLog.create({
      data: {
        project_id: suite.project_id,
        user_id: userId,
        action: `Reordered test cases in suite`,
        entity_type: 'test_suite',
        entity_id: suiteId,
      },
    });
  }

  revalidatePath(`/p`);
  return true;
}

export async function getSuitesForCaseAction(testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await requireProjectMemberByCaseId(testCaseId, userId, 'VIEWER');

  const suiteCases = await prisma.suiteCase.findMany({
    where: { test_case_id: testCaseId },
    include: { suite: true },
  });

  return suiteCases.map((sc) => ({
    suiteId: sc.suite_id,
    suiteName: sc.suite.name,
  }));
}

export async function archiveTestSuiteAction(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const suite = await prisma.testSuite.findUnique({ where: { id } });
  if (!suite) throw new Error('Suite not found');
  if (suite.project_id) await requireProjectMember(suite.project_id, userId);

  await prisma.testSuite.update({
    where: { id },
    data: { deleted_at: new Date() },
  });

  // Log detailed activity
  await prisma.activityLog.create({
    data: {
      project_id: suite.project_id,
      user_id: userId,
      action: `Archived test suite "${suite.name}"`,
      entity_type: 'test_suite',
      entity_id: id,
    },
  });

  revalidatePath(`/p`);
  return true;
}

export async function restoreTestSuiteAction(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const suite = await prisma.testSuite.findUnique({ where: { id } });
  if (!suite) throw new Error('Suite not found');
  if (suite.project_id) await requireProjectMember(suite.project_id, userId);

  await prisma.testSuite.update({
    where: { id },
    data: { deleted_at: null },
  });

  // Log detailed activity
  await prisma.activityLog.create({
    data: {
      project_id: suite.project_id,
      user_id: userId,
      action: `Restored test suite "${suite.name}"`,
      entity_type: 'test_suite',
      entity_id: id,
    },
  });

  revalidatePath(`/p`);
  return true;
}

export async function bulkArchiveSuitesAction(ids: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  if (ids.length === 0) return true;

  const suites = await prisma.testSuite.findMany({
    where: { id: { in: ids } },
  });

  if (suites.length === 0) throw new Error('No suites found to archive');
  if (suites[0].project_id) await requireProjectMember(suites[0].project_id, userId);

  await prisma.$transaction([
    prisma.testSuite.updateMany({
      where: { id: { in: ids } },
      data: { deleted_at: new Date() },
    }),
    ...suites.map((suite) =>
      prisma.activityLog.create({
        data: {
          project_id: suite.project_id,
          user_id: userId,
          action: `Archived test suite "${suite.name}" (Bulk)`,
          entity_type: 'test_suite',
          entity_id: suite.id,
        },
      })
    ),
  ]);

  revalidatePath(`/p`);
  return true;
}

export async function getSuiteHistoryAction(suiteId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await requireProjectMemberBySuiteId(suiteId, userId, 'VIEWER');

  const logs = await prisma.activityLog.findMany({
    where: { entity_type: 'test_suite', entity_id: suiteId },
    orderBy: { created_at: 'desc' },
  });

  const userIds = [...new Set(logs.map((l) => l.user_id).filter((id): id is number => id !== null))];
  const dbUsers = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, display_name: true, image: true, avatar_color: true, avatar_initials: true } })
    : [];

  const userMap = new Map(dbUsers.map((u) => [u.id, u]));

  return logs.map((log) => {
    const user = log.user_id ? userMap.get(log.user_id) : null;
    return {
      id: log.id,
      action: log.action,
      createdAt: log.created_at.toISOString(),
      user: user ? {
        id: user.id,
        name: user.display_name || user.name || 'Unknown User',
        fullName: user.name || null,
        avatarUrl: user.image,
        avatarColor: user.avatar_color || null,
        avatarInitials: user.avatar_initials || null,
      } : null,
    };
  });
}

export async function getSuiteRunHistoryAction(suiteId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await requireProjectMemberBySuiteId(suiteId, userId, 'VIEWER');

  const suite = await prisma.testSuite.findUnique({
    where: { id: suiteId },
    select: { id: true, name: true, project_id: true },
  });

  const runs = await prisma.testRun.findMany({
    where: {
      deleted_at: null,
      OR: [
        { suite_id: suiteId },
        ...(suite ? [{ project_id: suite.project_id, name: { contains: suite.name, mode: 'insensitive' as const } }] : []),
      ],
    },
    orderBy: { created_at: 'desc' },
    include: { results: true },
  });

  const userIds = [...new Set(runs.map((r) => r.created_by))];
  const dbUsers = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, display_name: true, image: true, avatar_color: true, avatar_initials: true } })
    : [];

  const userMap = new Map(dbUsers.map((u) => [u.id, u]));

  return runs.map((run) => {
    const user = userMap.get(run.created_by);
    const results = run.results || [];
    const total = results.length;
    const pass = results.filter((r) => r.status === 'PASS').length;
    const fail = results.filter((r) => r.status === 'FAIL').length;
    const blocked = results.filter((r) => r.status === 'BLOCKED').length;
    const skip = results.filter((r) => r.status === 'SKIP').length;
    const invalid = results.filter((r) => r.status === 'INVALID').length;
    const started = results.filter((r) => r.status === 'PENDING' && (r.time_spent_seconds || 0) > 0).length;
    const pending = results.filter((r) => r.status === 'PENDING' && (!r.time_spent_seconds || r.time_spent_seconds === 0)).length;
    const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;

    let durationMinutes: number | null = null;
    if (run.started_at && run.completed_at) {
      durationMinutes = Math.max(1, Math.round((run.completed_at.getTime() - run.started_at.getTime()) / (1000 * 60)));
    } else {
      const totalSeconds = results.reduce((acc, r) => acc + (r.time_spent_seconds || 0), 0);
      if (totalSeconds > 0) {
        durationMinutes = Math.max(1, Math.round(totalSeconds / 60));
      }
    }

    return {
      id: run.id,
      name: run.name,
      environment: run.environment,
      buildVersion: run.build_version || null,
      status: run.status.toLowerCase(),
      createdAt: run.created_at.toISOString(),
      startedAt: run.started_at?.toISOString() || null,
      completedAt: run.completed_at?.toISOString() || null,
      durationMinutes,
      creator: user ? {
        id: user.id,
        name: user.display_name || user.name || 'Unknown User',
        fullName: user.name || null,
        avatarUrl: user.image,
        avatarColor: user.avatar_color || null,
        avatarInitials: user.avatar_initials || null,
      } : null,
      stats: {
        total,
        pass,
        fail,
        blocked,
        skip,
        invalid,
        started,
        pending,
        passRate,
      },
    };
  });
}

export async function bulkAddCasesToSuiteAction(suiteId: string, testCaseIds: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  const suite = await prisma.testSuite.findUnique({
    where: { id: suiteId },
    select: { project_id: true },
  });
  if (!suite) throw new Error('Suite not found');
  await requireProjectMember(suite.project_id, userId);

  const existingSuiteCases = await prisma.suiteCase.findMany({
    where: { suite_id: suiteId },
    select: { test_case_id: true, order_index: true },
    orderBy: { order_index: 'desc' },
  });

  const existingIds = new Set(existingSuiteCases.map((s) => s.test_case_id));
  let maxOrder = existingSuiteCases.length > 0 ? existingSuiteCases[0].order_index : 0;
  const newIds = testCaseIds.filter((id) => !existingIds.has(id));

  if (newIds.length === 0) return { count: 0 };

  await prisma.suiteCase.createMany({
    data: newIds.map((caseId, idx) => ({
      suite_id: suiteId,
      test_case_id: caseId,
      order_index: maxOrder + idx + 1,
    })),
    skipDuplicates: true,
  });

  revalidatePath('/p');
  return { count: newIds.length };
}

export async function getArchivedSuitesAction(projectId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectViewer(projectId, userId);

  const archived = await prisma.testSuite.findMany({
    where: { project_id: projectId, deleted_at: { not: null } },
    orderBy: { deleted_at: 'desc' },
    include: { _count: { select: { suite_cases: true } } },
  });

  return archived.map((s) => ({
    id: s.id,
    projectId: s.project_id,
    name: s.name,
    type: (s.tags[0] || 'smoke').toLowerCase(),
    environment: s.environment,
    createdBy: s.created_by,
    createdAt: s.created_at.toISOString(),
    caseCount: s._count?.suite_cases || 0,
  }));
}

export async function deleteTestSuiteAction(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const suite = await prisma.testSuite.findUnique({ where: { id } });
  if (!suite) throw new Error('Suite not found');
  if (suite.project_id) await requireProjectAdmin(suite.project_id, userId);

  await prisma.$transaction([
    prisma.testRun.updateMany({
      where: { suite_id: id },
      data: { suite_id: null },
    }),
    prisma.testSuite.delete({
      where: { id },
    }),
    prisma.activityLog.create({
      data: {
        project_id: suite.project_id,
        user_id: userId,
        action: `Deleted test suite "${suite.name}"`,
        entity_type: 'test_suite',
        entity_id: id,
      },
    }),
  ]);

  revalidatePath('/p');
  return true;
}
