'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { generateTestCaseDisplayId } from '@/lib/ids';
import { revalidatePath } from 'next/cache';
import { requireProjectMember, requireProjectMemberByCaseId } from '@/lib/permissions';
import { enforceImportRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { snapshotTestCaseVersion, touchesCaseContent } from '@/lib/cases/versioning';

export async function createTestCaseAction(data: {
  projectId: string;
  moduleId: string | null;
  title: string;
  description?: string;
  steps: { order: number; step?: string; description?: string; expectedResult?: string; expected_result?: string; data?: string; meta?: string; reusableStepId?: string | null }[];
  priority: string;
  type: string;
  status: string;
  tags: string[];
  labels?: string[];
  scenarioType?: string;
  customFields?: Record<string, any>;
  custom_fields?: Record<string, any>;
  preConditions?: string;
  postConditions?: string;
  expectedResult?: string;
  aiGenerated?: boolean;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMember(data.projectId, userId);
  const displayId = await generateTestCaseDisplayId(data.projectId);

  const rawModuleId =
    data.moduleId && data.moduleId !== 'auto' && data.moduleId.trim() !== ''
      ? data.moduleId.trim()
      : null;

  let validatedModuleId: string | null = null;
  if (rawModuleId) {
    const modExists = await prisma.module.findFirst({
      where: { id: rawModuleId, project_id: data.projectId },
      select: { id: true },
    });
    if (modExists) validatedModuleId = modExists.id;
  }

  const testCase = await prisma.$transaction(async (tx) => {
    const tc = await tx.testCase.create({
      data: {
        display_id: displayId,
        project_id: data.projectId,
        module_id: validatedModuleId,
        title: data.title,
        description: data.description || null,
        steps: [],
        priority: data.priority.toUpperCase() as any,
        type: data.type.toUpperCase() as any,
        status: data.status.toUpperCase() as any,
        tags: data.tags,
        labels: data.labels || [],
        scenario_type: data.scenarioType || null,
        custom_fields: data.customFields || data.custom_fields || {},
        pre_conditions: data.preConditions || null,
        post_conditions: data.postConditions || null,
        expected_result: data.expectedResult || null,
        ai_generated: data.aiGenerated ?? false,
        created_by: userId,
      },
    });

    // Create TestCaseStep records
    const mappedSteps = data.steps.map((s, i) => ({
      order: s.order ?? i + 1,
      step: s.step || s.description || '',
      expected_result: s.expectedResult || s.expected_result || null,
      data: s.data || null,
      meta: s.meta || null,
      reusable_step_id: s.reusableStepId || null,
      is_outdated: false,
    }));

    if (mappedSteps.length > 0) {
      await tx.testCaseStep.createMany({
        data: mappedSteps.map(s => ({ ...s, test_case_id: tc.id })),
      });
    }

    // Create initial TestCaseVersion snapshot (v1)
    await tx.testCaseVersion.create({
      data: {
        test_case_id: tc.id,
        version_number: 1,
        steps: mappedSteps.map(s => ({
          order: s.order,
          step: s.step,
          expectedResult: s.expected_result,
          data: s.data,
          meta: s.meta,
        })),
        pre_conditions: data.preConditions || null,
        snapshot_by: userId,
      },
    });

    await tx.activityLog.create({
      data: {
        project_id: data.projectId,
        user_id: userId,
        action: `Created test case "${tc.title}" (${tc.display_id})`,
        entity_type: 'test_case',
        entity_id: tc.id,
        metadata: {
          caseTitle: tc.title,
          caseDisplayId: tc.display_id,
        },
      }
    });

    return tc;
  });

  logger.info('Test case created', {
    module: 'Cases',
    action: 'createTestCaseAction',
    projectId: data.projectId,
    caseId: testCase.id,
    displayId: testCase.display_id,
    userId,
  });

  revalidatePath(`/p`);
  return testCase;
}

export async function updateTestCaseAction(id: string, data: {
  moduleId?: string | null;
  title?: string;
  steps?: any[];
  priority?: string;
  type?: string;
  status?: string;
  tags?: string[];
  labels?: string[];
  scenarioType?: string;
  customFields?: Record<string, any>;
  custom_fields?: Record<string, any>;
  description?: string;
  preConditions?: string;
  postConditions?: string;
  expectedResult?: string;
  needsUpdate?: boolean;
  cancelPendingReview?: boolean;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(id, userId);

  const updateData: any = {};
  if (data.moduleId !== undefined) {
    const rawModId =
      data.moduleId && data.moduleId !== 'auto' && data.moduleId.trim() !== ''
        ? data.moduleId.trim()
        : null;
    if (rawModId) {
      const tc = await prisma.testCase.findUnique({
        where: { id },
        select: { project_id: true },
      });
      const modExists = tc
        ? await prisma.module.findFirst({
            where: { id: rawModId, project_id: tc.project_id },
            select: { id: true },
          })
        : null;
      updateData.module_id = modExists ? modExists.id : null;
    } else {
      updateData.module_id = null;
    }
  }
  if (data.title !== undefined) updateData.title = data.title;
  if (data.priority !== undefined) updateData.priority = data.priority.toUpperCase();
  if (data.type !== undefined) updateData.type = data.type.toUpperCase();
  if (data.status !== undefined) {
    const targetStatus = data.status.toUpperCase();
    if (targetStatus === 'ACTIVE') {
      const pm = await prisma.projectMember.findFirst({
        where: {
          project: { test_cases: { some: { id } } },
          user_id: userId,
        },
      });
      const isProjectAdmin = pm?.role === 'ADMIN';
      const wm = await prisma.workspaceMember.findFirst({
        where: {
          user_id: userId,
          workspace: { projects: { some: { test_cases: { some: { id } } } } },
        },
      });
      const isWsAdmin = wm?.role === 'OWNER' || wm?.role === 'ADMIN';

      if (!isProjectAdmin && !isWsAdmin) {
        throw new Error('Test cases cannot be manually marked as Active. Please submit for review to activate.');
      }

      const stepCount = await prisma.testCaseStep.count({
        where: {
          test_case_id: id,
          NOT: { step: '' },
        },
      });
      const incomingStepsCount = Array.isArray(data.steps)
        ? data.steps.filter((s: any) => Boolean((s.step || s.description || '').trim())).length
        : 0;
      if (stepCount === 0 && incomingStepsCount === 0) {
        throw new Error('Please add at least one test step before publishing as Active.');
      }
    }
    updateData.status = targetStatus;
  }
  if (data.tags !== undefined) updateData.tags = data.tags;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.preConditions !== undefined) updateData.pre_conditions = data.preConditions;
  if (data.postConditions !== undefined) updateData.post_conditions = data.postConditions;
  if (data.expectedResult !== undefined) updateData.expected_result = data.expectedResult;
  if (data.labels !== undefined) updateData.labels = data.labels;
  if (data.scenarioType !== undefined) updateData.scenario_type = data.scenarioType;
  if (data.customFields !== undefined) updateData.custom_fields = data.customFields;
  else if (data.custom_fields !== undefined) updateData.custom_fields = data.custom_fields;
  if (data.needsUpdate !== undefined) updateData.needs_update = data.needsUpdate;

  const existingCase = await prisma.testCase.findUnique({
    where: { id },
    select: {
      review_status: true,
      status: true,
      project_id: true,
      display_id: true,
      created_by: true,
      project: { select: { slug: true } },
      review_requests: {
        where: { status: 'PENDING' },
        orderBy: { created_at: 'desc' },
        select: { requested_by: true },
      },
    },
  });

  // If locked in review and not an explicit cancel/withdraw, disallow other users
  if (existingCase?.review_status === 'PENDING' && !data.cancelPendingReview) {
    const activeReq = existingCase.review_requests?.[0];
    const isReviewRequester = activeReq ? activeReq.requested_by === userId : existingCase.created_by === userId;

    if (!isReviewRequester) {
      throw new Error('This test case is locked for peer review. Other users cannot make changes while review is in progress.');
    }
  }

  // Only cancel if explicit cancellation requested or if explicitly saving as DRAFT while pending
  if (data.cancelPendingReview && existingCase?.review_status === 'PENDING') {
    const req = await prisma.reviewRequest.findFirst({
      where: { test_case_id: id, status: 'PENDING' },
      orderBy: { created_at: 'desc' }
    });
    if (req) {
      const updatedReq = await prisma.reviewRequest.update({
        where: { id: req.id },
        data: { status: 'CANCELLED', resolved_at: new Date() }
      });
      const { createNotification } = await import('@/lib/dal/collaboration');
      if (req?.assigned_to && existingCase) {
        await createNotification({
          user_id: req.assigned_to,
          type: 'REVIEW_CANCELLED',
          entity_type: 'ReviewRequest',
          entity_id: updatedReq.id,
          action_url: `/p/${existingCase.project.slug}/repository/${existingCase.display_id}`,
        });
      }
    }
    updateData.review_status = null;
    updateData.status = 'DRAFT';
  }

  const testCase = await prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id },
      data: {
        ...updateData,
        updated_by: userId,
      },
    });

    // Content changes create a new immutable version. Runs lock themselves to a
    // version when a case is added, so this is what makes "case updated since
    // added" detectable instead of invisible.
    if (touchesCaseContent(data as Record<string, unknown>)) {
      await snapshotTestCaseVersion(tx, id, userId);
    }

    return updated;
  });

  revalidatePath(`/p`);
  return testCase;
}

export async function deleteTestCaseAction(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(id, userId);

  const testCase = await prisma.testCase.findUnique({ where: { id } });

  await prisma.testCase.update({
    where: { id },
    data: { deleted_at: new Date() },
  });

  if (testCase) {
    await prisma.activityLog.create({
      data: {
        project_id: testCase.project_id,
        user_id: userId,
        action: `Archived test case "${testCase.title}" (${testCase.display_id})`,
        entity_type: 'test_case',
        entity_id: id,
      }
    });
  }

  revalidatePath(`/p`);
  return true;
}

export async function archiveTestCaseAction(id: string) {
  return deleteTestCaseAction(id);
}

export async function bulkArchiveTestCasesAction(ids: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  if (ids.length === 0) return true;

  const userId = (session.user as any).id as number;
  const cases = await prisma.testCase.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, display_id: true, project_id: true },
  });

  if (cases.length === 0) return true;

  const uniqueProjectIds = [...new Set(cases.map((c) => c.project_id))];
  for (const pid of uniqueProjectIds) {
    await requireProjectMember(pid, userId);
  }

  await prisma.$transaction([
    prisma.testCase.updateMany({
      where: { id: { in: ids } },
      data: { deleted_at: new Date() },
    }),
    prisma.activityLog.createMany({
      data: cases.map((tc) => ({
        project_id: tc.project_id,
        user_id: userId,
        action: `Archived test case "${tc.title}" (${tc.display_id})`,
        entity_type: 'test_case',
        entity_id: tc.id,
      })),
    }),
  ]);

  revalidatePath(`/p`);
  return true;
}

export async function restoreTestCaseAction(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(id, userId);

  const testCase = await prisma.testCase.findUnique({ where: { id } });

  await prisma.testCase.update({
    where: { id },
    data: { deleted_at: null },
  });

  if (testCase) {
    await prisma.activityLog.create({
      data: {
        project_id: testCase.project_id,
        user_id: userId,
        action: `Restored test case "${testCase.title}" (${testCase.display_id})`,
        entity_type: 'test_case',
        entity_id: id,
      }
    });
  }

  revalidatePath(`/p`);
  return true;
}

export async function getArchivedTestCasesAction(projectId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const cases = await prisma.testCase.findMany({
    where: { project_id: projectId, deleted_at: { not: null } },
    orderBy: { deleted_at: 'desc' },
    select: {
      id: true,
      display_id: true,
      project_id: true,
      module_id: true,
      title: true,
      priority: true,
      type: true,
      status: true,
      tags: true,
      labels: true,
      ai_generated: true,
      created_by: true,
      created_at: true,
      updated_at: true,
      deleted_at: true,
    },
  });

  return cases.map((c) => ({
    id: c.id,
    displayId: c.display_id,
    projectId: c.project_id,
    moduleId: c.module_id,
    title: c.title,
    steps: [],
    priority: c.priority,
    type: c.type.toLowerCase(),
    status: c.status.toLowerCase(),
    tags: c.tags,
    labels: c.labels,
    aiGenerated: c.ai_generated,
    createdBy: c.created_by,
    createdAt: c.created_at.toISOString(),
    updatedAt: c.updated_at.toISOString(),
    archivedAt: c.deleted_at?.toISOString(),
  }));
}

export async function cloneTestCaseAction(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  await requireProjectMemberByCaseId(id, userId);

  const original = await prisma.testCase.findUnique({
    where: { id },
    include: { project: true },
  });

  if (!original) throw new Error('Test case not found');

  const displayId = await generateTestCaseDisplayId(original.project_id);

  // Get original steps
  const originalSteps = await prisma.testCaseStep.findMany({
    where: { test_case_id: id },
    orderBy: { order: 'asc' },
  });

  const cloned = await prisma.testCase.create({
    data: {
      display_id: displayId,
      project_id: original.project_id,
      module_id: original.module_id,
      title: `Copy of ${original.title}`,
      description: original.description,
      pre_conditions: original.pre_conditions,
      post_conditions: original.post_conditions,
      steps: [],
      expected_result: original.expected_result,
      priority: original.priority,
      type: original.type,
      status: 'DRAFT',
      tags: original.tags,
      labels: original.labels,
      created_by: userId,
    },
  });

  // Clone steps
  if (originalSteps.length > 0) {
    await prisma.testCaseStep.createMany({
      data: originalSteps.map((s) => ({
        test_case_id: cloned.id,
        order: s.order,
        step: s.step,
        expected_result: s.expected_result,
        reusable_step_id: s.reusable_step_id,
        is_outdated: s.is_outdated,
      })),
    });
  }

  revalidatePath(`/p`);
  const clonedSteps = await prisma.testCaseStep.findMany({
    where: { test_case_id: cloned.id },
    orderBy: { order: 'asc' },
  });
  return {
    id: cloned.id,
    projectId: cloned.project_id,
    moduleId: cloned.module_id,
    title: cloned.title,
    priority: cloned.priority.toLowerCase(),
    type: cloned.type.toLowerCase(),
    status: cloned.status.toLowerCase(),
    tags: cloned.tags,
    aiGenerated: cloned.ai_generated,
    createdBy: cloned.created_by,
    createdAt: cloned.created_at.toISOString(),
    steps: clonedSteps as any[],
  };
}

export async function importTestCasesAction(data: {
  projectId: string;
  suiteId?: string | null;
  newSuiteName?: string | null;
  cases: {
    title: string;
    description?: string;
    preConditions?: string;
    postConditions?: string;
    priority: string;
    type: string;
    status: string;
    tags: string[];
    labels?: string[];
    moduleId: string | null;
    scenarioType?: string;
    customFields?: Record<string, any>;
    custom_fields?: Record<string, any>;
    aiGenerated?: boolean;
    steps: {
      order: number;
      step: string;
      expectedResult?: string;
      data?: string;
      reusableStepId?: string | null;
    }[];
  }[];
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMember(data.projectId, userId);
  enforceImportRateLimit(userId);

  if (data.cases.length === 0) return [];

  // Import guardrails: one file may not create an unbounded number of rows.
  const MAX_IMPORT_ROWS = Number(process.env.IMPORT_MAX_ROWS || 500);
  if (data.cases.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import is limited to ${MAX_IMPORT_ROWS} rows per file`);
  }

  // Prepare bulk insert data for test cases (pure normalisers, no I/O)
  const normalizeType = (t?: string): 'MANUAL' | 'AUTO' => {
    if (!t) return 'MANUAL';
    const clean = t.trim().toUpperCase();
    if (clean === 'AUTO' || clean === 'AUTOMATED' || clean.includes('AUTO') || clean.includes('API')) {
      return 'AUTO';
    }
    return 'MANUAL';
  };

  const normalizePriority = (p?: string): 'P0' | 'P1' | 'P2' | 'P3' => {
    if (!p) return 'P2';
    const clean = p.trim().toUpperCase();
    if (['P0', 'P1', 'P2', 'P3'].includes(clean)) return clean as any;
    if (/critical|blocker|high|p0/i.test(clean)) return 'P0';
    if (/p1|medium/i.test(clean)) return 'P1';
    if (/p3|minor|low/i.test(clean)) return 'P3';
    return 'P2';
  };

  const normalizeStatus = (s?: string): 'ACTIVE' | 'DRAFT' | 'DEPRECATED' => {
    if (!s) return 'DRAFT';
    const clean = s.trim().toUpperCase();
    if (['ACTIVE', 'DRAFT', 'DEPRECATED'].includes(clean)) return clean as any;
    return 'DRAFT';
  };

  // 1. Resolve or Create Test Suite if requested
  let targetSuiteId: string | null = data.suiteId || null;
  let createdSuiteObj: any = null;
  let createdCases: any[] = [];

  // One transaction: the counter bump, the cases, their steps/versions and the
  // suite links commit together. Without it a failed import leaves orphan
  // display ids (gaps) and partially written cases.
  await prisma.$transaction(
    async (tx) => {
      if (!targetSuiteId && data.newSuiteName && data.newSuiteName.trim()) {
        const { generateTestSuiteId } = await import('@/lib/ids');
        const newId = await generateTestSuiteId();
        createdSuiteObj = await tx.testSuite.create({
          data: {
            id: newId,
            project_id: data.projectId,
            name: data.newSuiteName.trim(),
            tags: ['REGRESSION'],
            created_by: userId,
          },
        });
        targetSuiteId = newId;

        await tx.activityLog.create({
          data: {
            project_id: data.projectId,
            user_id: userId,
            action: `Created test suite "${data.newSuiteName.trim()}" on import`,
            entity_type: 'test_suite',
            entity_id: newId,
          },
        });
      }

      // Atomic counter bump for display ids (UPDATE ... increment ... RETURNING)
      const project = await tx.project.update({
        where: { id: data.projectId },
        data: { case_counter: { increment: data.cases.length } },
        select: { key: true, case_counter: true },
      });

      const startCounter = project.case_counter - data.cases.length + 1;

      const testCasesData = data.cases.map((c, index) => {
        const displayId = `${project.key}-${startCounter + index}`;
        const mappedSteps = c.steps.map((s) => ({
          order: s.order,
          step: s.step,
          expectedResult: s.expectedResult || null,
          data: s.data || null,
        }));

        return {
          project_id: data.projectId,
          module_id: c.moduleId,
          display_id: displayId,
          title: c.title,
          description: c.description || null,
          pre_conditions: c.preConditions || null,
          post_conditions: c.postConditions || null,
          steps: mappedSteps,
          expected_result: c.steps[0]?.expectedResult || null,
          priority: normalizePriority(c.priority),
          type: normalizeType(c.type),
          status: normalizeStatus(c.status),
          tags: c.tags || [],
          labels: c.labels || [],
          scenario_type: c.scenarioType || null,
          custom_fields: (c as any).customFields || (c as any).custom_fields || {},
          ai_generated: c.aiGenerated ?? false,
          created_by: userId,
        };
      });

      // Execute test cases insert and get generated IDs back in one query
      createdCases = await tx.testCase.createManyAndReturn({
        data: testCasesData,
      });

      // Prepare bulk insert data for all steps linking them to their generated case id
      const stepsData: any[] = [];
      createdCases.forEach((tc, index) => {
        const originalSteps = data.cases[index].steps;
        originalSteps.forEach((s) => {
          stepsData.push({
            test_case_id: tc.id,
            order: s.order,
            step: s.step,
            expected_result: s.expectedResult || null,
            data: s.data || null,
            reusable_step_id: s.reusableStepId || null,
          });
        });
      });

      if (stepsData.length > 0) {
        await tx.testCaseStep.createMany({
          data: stepsData,
        });
      }

      // Create initial TestCaseVersion (v1) snapshot for each imported case
      const versionsData = createdCases.map((tc, index) => {
        const originalSteps = data.cases[index].steps;
        return {
          test_case_id: tc.id,
          version_number: 1,
          steps: originalSteps.map((s) => ({
            order: s.order,
            step: s.step,
            expectedResult: s.expectedResult || null,
            data: s.data || null,
          })),
          pre_conditions: tc.pre_conditions || null,
          snapshot_by: userId,
        };
      });

      await tx.testCaseVersion.createMany({
        data: versionsData,
        skipDuplicates: true,
      });

      // If a suite is assigned, link all imported cases into SuiteCase
      if (targetSuiteId) {
        const existingCount = await tx.suiteCase.count({ where: { suite_id: targetSuiteId } });
        const suiteCasesData = createdCases.map((tc, idx) => ({
          suite_id: targetSuiteId!,
          test_case_id: tc.id,
          order_index: existingCount + idx + 1,
        }));

        await tx.suiteCase.createMany({
          data: suiteCasesData,
          skipDuplicates: true,
        });
      }
    },
    { timeout: 60_000 }
  );

  // Map results locally to avoid unnecessary database queries
  const results = createdCases.map((testCase, index) => {
    const originalSteps = data.cases[index].steps;
    return {
      id: testCase.id,
      displayId: testCase.display_id,
      projectId: testCase.project_id,
      moduleId: testCase.module_id,
      title: testCase.title,
      description: testCase.description,
      preConditions: testCase.pre_conditions,
      postConditions: testCase.post_conditions,
      expectedResult: testCase.expected_result,
      priority: testCase.priority.toUpperCase(),
      type: testCase.type.toLowerCase(),
      status: testCase.status.toLowerCase(),
      tags: testCase.tags,
      labels: testCase.labels || [],
      scenarioType: testCase.scenario_type,
      customFields: (testCase.custom_fields as Record<string, any>) || {},
      custom_fields: (testCase.custom_fields as Record<string, any>) || {},
      aiGenerated: testCase.ai_generated,
      reviewStatus: testCase.review_status?.toLowerCase(),
      createdBy: testCase.created_by,
      createdAt: testCase.created_at.toISOString(),
      updatedAt: testCase.updated_at ? new Date(testCase.updated_at).toISOString() : testCase.created_at.toISOString(),
      updatedBy: testCase.updated_by,
      steps: originalSteps.map((s, sIdx) => ({
        id: `${testCase.id}-step-${s.order ?? sIdx + 1}`,
        order: s.order,
        step: s.step,
        expected_result: s.expectedResult,
        data: s.data,
        reusable_step_id: s.reusableStepId,
      })),
      suiteId: targetSuiteId,
      createdSuite: createdSuiteObj ? { id: createdSuiteObj.id, name: createdSuiteObj.name } : null,
    };
  });

  revalidatePath(`/p`);
  return results;
}

export async function getProjectCasesForTagsAction(projectId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  await requireProjectMember(projectId, userId);

  const cases = await prisma.testCase.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true, tags: true, title: true, display_id: true },
  });

  return cases.map((c) => ({
    id: c.id,
    tags: c.tags || [],
    title: c.title,
    displayId: c.display_id,
  }));
}

export async function bulkAddTagsAction(caseIds: string[], tagsToAdd: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  const cleanTags = tagsToAdd.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (cleanTags.length === 0 || caseIds.length === 0) return { count: 0 };

  const cases = await prisma.testCase.findMany({
    where: { id: { in: caseIds } },
    select: { id: true, tags: true, project_id: true },
  });

  // Authorize every project represented in the request before writing.
  for (const pid of Array.from(new Set(cases.map((c) => c.project_id)))) {
    await requireProjectMember(pid, userId);
  }

  await prisma.$transaction(
    cases.map((c) => {
      const merged = Array.from(new Set([...(c.tags || []), ...cleanTags]));
      return prisma.testCase.updateMany({
        where: { id: c.id, project_id: c.project_id },
        data: { tags: merged },
      });
    })
  );

  revalidatePath('/p');
  return { count: cases.length };
}

export async function bulkRemoveTagAction(projectId: string, tagToRemove: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  await requireProjectMember(projectId, userId);

  const cleanTag = tagToRemove.trim().toLowerCase();
  if (!cleanTag) return { count: 0 };

  const candidateCases = await prisma.testCase.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true, tags: true, labels: true },
  });

  const casesToUpdate = candidateCases.filter((c) =>
    (c.tags || []).some((t) => t.trim().toLowerCase() === cleanTag) ||
    (c.labels || []).some((l) => l.trim().toLowerCase() === cleanTag && !l.startsWith('ticket:'))
  );

  if (casesToUpdate.length === 0) {
    return { count: 0 };
  }

  await prisma.$transaction(
    casesToUpdate.map((c) => {
      const remainingTags = (c.tags || []).filter((t) => t.trim().toLowerCase() !== cleanTag);
      const remainingLabels = (c.labels || []).filter(
        (l) => l.startsWith('ticket:') || l.trim().toLowerCase() !== cleanTag
      );
      return prisma.testCase.update({
        where: { id: c.id },
        data: {
          tags: remainingTags,
          labels: remainingLabels,
        },
      });
    })
  );

  revalidatePath('/p');
  return { count: casesToUpdate.length };
}

export async function bulkRenameTagAction(projectId: string, oldTag: string, newTag: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  await requireProjectMember(projectId, userId);

  const cleanOld = oldTag.trim().toLowerCase();
  const cleanNew = newTag.trim().toLowerCase();
  if (!cleanNew) return { count: 0 };

  const candidateCases = await prisma.testCase.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true, tags: true, labels: true },
  });

  const casesToUpdate = candidateCases.filter((c) =>
    (c.tags || []).some((t) => t.trim().toLowerCase() === cleanOld) ||
    (c.labels || []).some((l) => l.trim().toLowerCase() === cleanOld && !l.startsWith('ticket:'))
  );

  if (casesToUpdate.length === 0) {
    return { count: 0 };
  }

  await prisma.$transaction(
    casesToUpdate.map((c) => {
      const updatedTags = Array.from(
        new Set(
          (c.tags || []).map((t) => (t.trim().toLowerCase() === cleanOld ? cleanNew : t))
        )
      );
      const updatedLabels = (c.labels || []).map((l) =>
        !l.startsWith('ticket:') && l.trim().toLowerCase() === cleanOld ? cleanNew : l
      );
      return prisma.testCase.update({
        where: { id: c.id },
        data: {
          tags: updatedTags,
          labels: updatedLabels,
        },
      });
    })
  );

  revalidatePath('/p');
  return { count: casesToUpdate.length };
}

export async function bulkRemoveMultipleTagsAction(projectId: string, tagsToRemove: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  await requireProjectMember(projectId, userId);

  const cleanTags = new Set(tagsToRemove.map((t) => t.trim().toLowerCase()).filter(Boolean));
  if (cleanTags.size === 0) return { count: 0 };

  const candidateCases = await prisma.testCase.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true, tags: true, labels: true },
  });

  const casesToUpdate = candidateCases.filter((c) =>
    (c.tags || []).some((t) => cleanTags.has(t.trim().toLowerCase())) ||
    (c.labels || []).some((l) => cleanTags.has(l.trim().toLowerCase()) && !l.startsWith('ticket:'))
  );

  if (casesToUpdate.length === 0) {
    return { count: 0 };
  }

  await prisma.$transaction(
    casesToUpdate.map((c) => {
      const remainingTags = (c.tags || []).filter((t) => !cleanTags.has(t.trim().toLowerCase()));
      const remainingLabels = (c.labels || []).filter(
        (l) => l.startsWith('ticket:') || !cleanTags.has(l.trim().toLowerCase())
      );
      return prisma.testCase.update({
        where: { id: c.id },
        data: {
          tags: remainingTags,
          labels: remainingLabels,
        },
      });
    })
  );

  revalidatePath('/p');
  return { count: casesToUpdate.length };
}

export async function bulkMergeTagsAction(projectId: string, tagsToMerge: string[], targetTag: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  await requireProjectMember(projectId, userId);

  const cleanTarget = targetTag.trim().toLowerCase();
  const mergeSet = new Set(tagsToMerge.map((t) => t.trim().toLowerCase()).filter(Boolean));
  if (!cleanTarget || mergeSet.size === 0) return { count: 0 };

  const candidateCases = await prisma.testCase.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true, tags: true, labels: true },
  });

  const casesToUpdate = candidateCases.filter((c) =>
    (c.tags || []).some((t) => mergeSet.has(t.trim().toLowerCase())) ||
    (c.labels || []).some((l) => mergeSet.has(l.trim().toLowerCase()) && !l.startsWith('ticket:'))
  );

  if (casesToUpdate.length === 0) {
    return { count: 0 };
  }

  await prisma.$transaction(
    casesToUpdate.map((c) => {
      const updatedTags = Array.from(
        new Set(
          (c.tags || []).map((t) => (mergeSet.has(t.trim().toLowerCase()) ? cleanTarget : t))
        )
      );
      const updatedLabels = (c.labels || []).map((l) =>
        !l.startsWith('ticket:') && mergeSet.has(l.trim().toLowerCase()) ? cleanTarget : l
      );
      return prisma.testCase.update({
        where: { id: c.id },
        data: {
          tags: updatedTags,
          labels: updatedLabels,
        },
      });
    })
  );

  revalidatePath('/p');
  return { count: casesToUpdate.length };
}

export interface DuplicateCaseGroup {
  key: string;
  title: string;
  link: string;
  cases: Array<{
    id: string;
    displayId: string;
    title: string;
    moduleId: string | null;
    moduleName: string | null;
    createdAt: string;
    source: 'postman' | 'datadog' | 'manual' | 'external';
  }>;
}

/**
 * Find probable duplicate cases in a project.
 *
 * A duplicate is defined conservatively: the same normalized title AND the same
 * automation link (Postman request/folder or Datadog test). Title alone is not
 * enough — parameterized suites intentionally reuse titles with different links.
 */
/**
 * Titles that already exist in the project, used by the import dialog to
 * de-duplicate a file before it reaches the database.
 */
export async function findExistingCaseTitlesAction(
  projectId: string,
  titles: string[]
): Promise<Array<{ id: string; displayId: string; title: string }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  await requireProjectMember(projectId, (session.user as any).id as number);

  const wanted = new Set(
    (titles || [])
      .map((t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').replace(/[—–-]/g, '-').trim())
      .filter(Boolean)
  );
  if (wanted.size === 0) return [];

  const cases = await prisma.testCase.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: { id: true, display_id: true, title: true },
  });

  return cases
    .filter((c) =>
      wanted.has(
        String(c.title || '').toLowerCase().replace(/\s+/g, ' ').replace(/[—–-]/g, '-').trim()
      )
    )
    .map((c) => ({ id: c.id, displayId: c.display_id, title: c.title }));
}

export async function findDuplicateTestCasesAction(
  projectId: string
): Promise<DuplicateCaseGroup[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  await requireProjectMember(projectId, (session.user as any).id as number);

  const cases = await prisma.testCase.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: {
      id: true,
      display_id: true,
      title: true,
      module_id: true,
      custom_fields: true,
      created_at: true,
      module: { select: { name: true } },
    },
    orderBy: { created_at: 'asc' },
  });

  const normalize = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[—–-]/g, '-')
      .trim();

  const linkOf = (customFields: any) => {
    const fields =
      typeof customFields === 'string'
        ? (() => {
            try {
              return JSON.parse(customFields);
            } catch {
              return {};
            }
          })()
        : customFields || {};
    const postman = fields._postman || {};
    const datadog = fields._datadog || {};
    if (postman.linkKey) return { link: `postman:${postman.linkKey}`, source: 'postman' as const };
    if (postman.requestId || postman.collectionUid) {
      return {
        link: `postman:${postman.collectionUid || ''}/${postman.folderId || ''}/${postman.requestId || ''}`,
        source: 'postman' as const,
      };
    }
    if (datadog.linkKey) return { link: `datadog:${datadog.linkKey}`, source: 'datadog' as const };
    if (datadog.publicId) return { link: `datadog:${datadog.publicId}`, source: 'datadog' as const };
    return { link: '', source: 'manual' as const };
  };

  const groups = new Map<string, DuplicateCaseGroup>();
  for (const c of cases) {
    const { link, source } = linkOf(c.custom_fields);
    // Without a link there is no reliable identity, so skip title-only matches.
    if (!link) continue;
    const normalizedTitle = normalize(c.title);
    if (!normalizedTitle) continue;
    const key = `${normalizedTitle}::${link}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: c.title,
        link,
        cases: [],
      });
    }
    groups.get(key)!.cases.push({
      id: c.id,
      displayId: c.display_id,
      title: c.title,
      moduleId: c.module_id,
      moduleName: c.module?.name || null,
      createdAt: c.created_at.toISOString(),
      source,
    });
  }

  return [...groups.values()]
    .filter((g) => g.cases.length > 1)
    .sort((a, b) => b.cases.length - a.cases.length);
}
