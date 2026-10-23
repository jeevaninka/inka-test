'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import {
  resolveProjectId,
  requireProjectViewer,
  requireProjectMember,
  requireProjectMemberByCaseId,
  requireProjectMemberByStepId,
  requireProjectMemberByReusableStepId,
} from '@/lib/permissions';
import { logger } from '@/lib/logger';

async function getAuthorizedUser(): Promise<{ userId: number; user: any }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const user = session.user as any;
  if (!user.isApproved) throw new Error('Forbidden: Account pending approval');
  return { userId: Number(user.id), user };
}

// ============================================
// REUSABLE STEPS
// ============================================

export async function getReusableStepsAction(projectIdOrSlug: string) {
  const { userId } = await getAuthorizedUser();
  const actualProjectId = await resolveProjectId(projectIdOrSlug);
  await requireProjectViewer(actualProjectId, userId);

  const steps = await prisma.reusableStep.findMany({
    where: { project_id: actualProjectId },
    orderBy: { title: 'asc' },
    include: {
      module: { select: { id: true, name: true } },
    },
  });

  const usageCounts = await prisma.$queryRaw<
    { reusable_step_id: string; count: bigint }[]
  >`
    SELECT s.reusable_step_id, COUNT(DISTINCT s.test_case_id) as count
    FROM "TestCaseStep" s
    JOIN "TestCase" tc ON tc.id = s.test_case_id
    WHERE s.reusable_step_id IS NOT NULL AND tc.project_id = ${actualProjectId}
    GROUP BY s.reusable_step_id
  `;

  const countMap = new Map(usageCounts.map((r) => [r.reusable_step_id, Number(r.count)]));

  return steps.map((s) => ({
    ...s,
    _count: { test_case_steps: countMap.get(s.id) || 0 },
  }));
}

export async function createReusableStepAction(data: {
  projectId: string;
  title: string;
  step: string;
  expectedResult?: string;
  data?: string;
  moduleId?: string | null;
  steps?: { step: string; expectedResult?: string | null; data?: string | null; imageUrl?: string | null }[];
}) {
  const { userId } = await getAuthorizedUser();
  const actualProjectId = await resolveProjectId(data.projectId);
  await requireProjectMember(actualProjectId, userId);

  const reusableStep = await prisma.reusableStep.create({
    data: {
      project_id: actualProjectId,
      module_id: data.moduleId || null,
      title: data.title,
      step: data.step,
      expected_result: data.expectedResult,
      data: data.data,
      steps: data.steps || [],
      created_by: userId,
    },
    include: {
      module: { select: { id: true, name: true } },
    },
  });

  logger.info('Reusable step created', {
    module: 'Steps',
    action: 'createReusableStepAction',
    reusableStepId: reusableStep.id,
    projectId: actualProjectId,
    userId,
  });

  revalidatePath('/p');
  return reusableStep;
}

export async function updateReusableStepAction(
  id: string,
  data: {
    title?: string;
    step?: string;
    expectedResult?: string;
    data?: string;
    moduleId?: string | null;
    steps?: any[];
    currentTestCaseId?: string;
    reusableStepItemId?: string;
  }
) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByReusableStepId(id, userId);

  const existing = await prisma.reusableStep.findUnique({ where: { id } });
  if (!existing) throw new Error('Reusable step not found');

  const updateData: any = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.step !== undefined) updateData.step = data.step;
  if (data.expectedResult !== undefined) updateData.expected_result = data.expectedResult;
  if (data.data !== undefined) updateData.data = data.data;
  if (data.moduleId !== undefined) updateData.module_id = data.moduleId;

  if (data.steps !== undefined) {
    updateData.steps = data.steps;
  } else if (data.reusableStepItemId !== undefined && Array.isArray(existing.steps) && existing.steps.length > 0) {
    const idx = parseInt(data.reusableStepItemId, 10);
    const existingGroupSteps = [...(existing.steps as any[])];
    if (existingGroupSteps[idx]) {
      existingGroupSteps[idx] = {
        ...existingGroupSteps[idx],
        step: data.step !== undefined ? data.step : existingGroupSteps[idx].step,
        expectedResult: data.expectedResult !== undefined ? data.expectedResult : (existingGroupSteps[idx].expectedResult || existingGroupSteps[idx].expected_result),
        expected_result: data.expectedResult !== undefined ? data.expectedResult : (existingGroupSteps[idx].expectedResult || existingGroupSteps[idx].expected_result),
        data: data.data !== undefined ? data.data : existingGroupSteps[idx].data,
      };
      updateData.steps = existingGroupSteps;
      if (idx === 0 && data.step) {
        updateData.step = data.step;
      }
    }
  }

  const updated = await prisma.reusableStep.update({
    where: { id },
    data: updateData,
  });

  if (data.currentTestCaseId) {
    await prisma.testCaseStep.updateMany({
      where: {
        reusable_step_id: id,
        test_case_id: { not: data.currentTestCaseId },
      },
      data: { is_outdated: true },
    });
    await prisma.testCaseStep.updateMany({
      where: {
        reusable_step_id: id,
        test_case_id: data.currentTestCaseId,
      },
      data: { is_outdated: false },
    });
  } else {
    await prisma.testCaseStep.updateMany({
      where: { reusable_step_id: id },
      data: { is_outdated: true },
    });
  }

  revalidatePath('/p');
  return updated;
}

export async function cloneReusableStepAction(id: string, customTitle?: string) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByReusableStepId(id, userId);

  const original = await prisma.reusableStep.findUnique({ where: { id } });
  if (!original) throw new Error('Original reusable step not found');

  const cloned = await prisma.reusableStep.create({
    data: {
      project_id: original.project_id,
      title: customTitle || `Copy of ${original.title}`,
      step: original.step,
      expected_result: original.expected_result,
      data: original.data,
      steps: original.steps as any,
      created_by: userId,
    },
  });

  revalidatePath('/p');
  return cloned;
}

export async function createReusableStepGroupAction(data: {
  projectId: string;
  title: string;
  steps: { step: string; expectedResult?: string | null; data?: string | null; imageUrl?: string | null }[];
  testCaseStepIds: string[];
}) {
  const { userId } = await getAuthorizedUser();
  const actualProjectId = await resolveProjectId(data.projectId);
  await requireProjectMember(actualProjectId, userId);

  const reusableStep = await prisma.reusableStep.create({
    data: {
      project_id: actualProjectId,
      title: data.title,
      step: data.steps[0]?.step || '',
      expected_result: data.steps[0]?.expectedResult || null,
      data: data.steps[0]?.data || null,
      steps: data.steps,
      created_by: userId,
    },
  });

  for (let i = 0; i < data.testCaseStepIds.length; i++) {
    await requireProjectMemberByStepId(data.testCaseStepIds[i], userId);
    await prisma.testCaseStep.update({
      where: { id: data.testCaseStepIds[i] },
      data: {
        reusable_step_id: reusableStep.id,
        reusable_step_item_id: String(i),
        is_outdated: false,
      },
    });
  }

  revalidatePath('/p');
  return { id: reusableStep.id, title: reusableStep.title, steps: data.steps };
}

export async function deleteReusableStepAction(id: string, strategy: 'convert_to_normal' | 'delete_all' = 'convert_to_normal') {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByReusableStepId(id, userId);

  if (strategy === 'convert_to_normal') {
    await prisma.testCaseStep.updateMany({
      where: { reusable_step_id: id },
      data: {
        reusable_step_id: null,
        reusable_step_item_id: null,
        is_outdated: false,
      },
    });
  } else if (strategy === 'delete_all') {
    await prisma.testCaseStep.deleteMany({
      where: { reusable_step_id: id },
    });
  }

  await prisma.reusableStep.delete({ where: { id } });
  revalidatePath('/p');
  return true;
}

export async function detachReusableGroupAction(testCaseId: string, reusableStepId: string) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByCaseId(testCaseId, userId);

  await prisma.testCaseStep.updateMany({
    where: {
      test_case_id: testCaseId,
      reusable_step_id: reusableStepId,
    },
    data: {
      reusable_step_id: null,
      reusable_step_item_id: null,
      is_outdated: false,
    },
  });

  revalidatePath('/p');
  return true;
}

export async function syncReusableGroupAction(testCaseId: string, reusableStepId: string) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByCaseId(testCaseId, userId);

  const reusableStep = await prisma.reusableStep.findUnique({
    where: { id: reusableStepId },
  });
  if (!reusableStep) throw new Error('Reusable step not found in library');

  const groupSteps = Array.isArray(reusableStep.steps) && reusableStep.steps.length > 0
    ? (reusableStep.steps as any[])
    : null;

  const currentSteps = await prisma.testCaseStep.findMany({
    where: {
      test_case_id: testCaseId,
      reusable_step_id: reusableStepId,
    },
    orderBy: { order: 'asc' },
  });

  if (!groupSteps) {
    if (currentSteps.length > 0) {
      await prisma.testCaseStep.update({
        where: { id: currentSteps[0].id },
        data: {
          step: reusableStep.step,
          expected_result: reusableStep.expected_result,
          data: reusableStep.data,
          is_outdated: false,
        },
      });
    }
  } else {
    const baseOrder = currentSteps.length > 0 ? currentSteps[0].order : 1;

    for (let i = 0; i < groupSteps.length; i++) {
      const gStep = groupSteps[i];
      if (i < currentSteps.length) {
        await prisma.testCaseStep.update({
          where: { id: currentSteps[i].id },
          data: {
            step: gStep.step || '',
            expected_result: gStep.expectedResult || gStep.expected_result || null,
            data: gStep.data || null,
            image_url: gStep.imageUrl || gStep.image_url || null,
            reusable_step_item_id: String(i),
            is_outdated: false,
          },
        });
      } else {
        await prisma.testCaseStep.create({
          data: {
            test_case_id: testCaseId,
            reusable_step_id: reusableStepId,
            reusable_step_item_id: String(i),
            order: baseOrder + i,
            step: gStep.step || '',
            expected_result: gStep.expectedResult || gStep.expected_result || null,
            data: gStep.data || null,
            image_url: gStep.imageUrl || gStep.image_url || null,
            is_outdated: false,
          },
        });
      }
    }

    if (currentSteps.length > groupSteps.length) {
      const excess = currentSteps.slice(groupSteps.length);
      for (const eStep of excess) {
        await prisma.testCaseStep.delete({ where: { id: eStep.id } });
      }
    }
  }

  revalidatePath('/p');
  return true;
}

export async function getReusableStepUsageAction(reusableStepId: string) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByReusableStepId(reusableStepId, userId, 'VIEWER');

  const cases = await prisma.testCase.findMany({
    where: {
      test_case_steps: {
        some: { reusable_step_id: reusableStepId },
      },
      deleted_at: null,
    },
    select: {
      id: true,
      display_id: true,
      title: true,
      status: true,
      priority: true,
      module: { select: { id: true, name: true } },
    },
    orderBy: { display_id: 'desc' },
  });
  
  return cases.map((c) => ({
    id: c.id,
    display_id: c.display_id,
    title: c.title,
    status: c.status,
    priority: c.priority,
    moduleName: c.module?.name || null,
  }));
}

// ============================================
// TEST CASE STEPS
// ============================================

export async function getTestCaseStepsAction(testCaseId: string) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByCaseId(testCaseId, userId, 'VIEWER');

  const steps = await prisma.testCaseStep.findMany({
    where: { test_case_id: testCaseId },
    orderBy: { order: 'asc' },
    include: {
      reusable_step: {
        select: {
          id: true,
          title: true,
          step: true,
          expected_result: true,
          data: true,
          steps: true,
          _count: { select: { test_case_steps: true } },
        },
      },
    },
  });

  const hasReusable = steps.some((s) => s.reusable_step_id);
  if (!hasReusable) {
    return steps;
  }

  const stepProject = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { project_id: true },
  });

  const usageCounts = await prisma.$queryRaw<
    { reusable_step_id: string; count: bigint }[]
  >`
    SELECT s.reusable_step_id, COUNT(DISTINCT s.test_case_id) as count
    FROM "TestCaseStep" s
    JOIN "TestCase" tc ON tc.id = s.test_case_id
    WHERE s.reusable_step_id IS NOT NULL AND tc.project_id = ${stepProject?.project_id || ''}
    GROUP BY s.reusable_step_id
  `;

  const countMap = new Map(usageCounts.map((r) => [r.reusable_step_id, Number(r.count)]));

  return steps.map((s) => ({
    ...s,
    reusable_step: s.reusable_step
      ? {
          ...s.reusable_step,
          casesCount: countMap.get(s.reusable_step.id) || s.reusable_step._count?.test_case_steps || 1,
          _count: {
            test_case_steps: countMap.get(s.reusable_step.id) || s.reusable_step._count?.test_case_steps || 1,
          },
        }
      : null,
  }));
}

async function checkTestCaseReviewLock(testCaseId: string, userId: number) {
  const tc = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: {
      review_status: true,
      created_by: true,
      project_id: true,
      review_requests: {
        where: { status: 'PENDING' },
        orderBy: { created_at: 'desc' },
        select: { requested_by: true },
      },
    },
  });

  if (tc?.review_status === 'PENDING') {
    const activeReq = tc.review_requests?.[0];
    const isReviewRequester = activeReq ? activeReq.requested_by === userId : tc.created_by === userId;

    if (!isReviewRequester) {
      throw new Error('This test case is locked for peer review. Other users cannot edit steps while review is in progress.');
    }
  }
}

export async function createTestCaseStepAction(data: {
  testCaseId: string;
  order: number;
  step: string;
  expectedResult?: string;
  data?: string;
  imageUrl?: string;
  reusableStepId?: string;
  reusableStepItemId?: string;
  aiGenerated?: boolean;
}) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByCaseId(data.testCaseId, userId);
  await checkTestCaseReviewLock(data.testCaseId, userId);

  if (data.reusableStepId) {
    await requireProjectMemberByReusableStepId(data.reusableStepId, userId, 'VIEWER');
    const exists = await prisma.reusableStep.findUnique({
      where: { id: data.reusableStepId },
    });
    if (!exists) throw new Error('Reusable step not found');
  }

  const step = await prisma.testCaseStep.create({
    data: {
      test_case_id: data.testCaseId,
      reusable_step_id: data.reusableStepId || null,
      reusable_step_item_id: data.reusableStepItemId || null,
      order: data.order,
      step: data.step,
      expected_result: data.expectedResult,
      data: data.data,
      image_url: data.imageUrl || null,
      is_outdated: false,
      ai_generated: data.aiGenerated ?? false,
    },
  });

  return step;
}

export async function updateTestCaseStepAction(
  id: string,
  data: {
    order?: number;
    step?: string;
    expectedResult?: string;
    data?: string;
    imageUrl?: string | null;
    isOutdated?: boolean;
    aiGenerated?: boolean;
    reusableStepId?: string | null;
    reusableStepItemId?: string | null;
  }
) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByStepId(id, userId);

  const existingStep = await prisma.testCaseStep.findUnique({
    where: { id },
    select: { test_case_id: true },
  });
  if (existingStep) {
    await checkTestCaseReviewLock(existingStep.test_case_id, userId);
  }

  if (data.reusableStepId) {
    await requireProjectMemberByReusableStepId(data.reusableStepId, userId, 'VIEWER');
  }

  const prismaData: any = {};
  if (data.order !== undefined) prismaData.order = data.order;
  if (data.step !== undefined) prismaData.step = data.step;
  if (data.expectedResult !== undefined) prismaData.expected_result = data.expectedResult;
  if (data.data !== undefined) prismaData.data = data.data === '' ? null : data.data;
  if (data.imageUrl !== undefined) prismaData.image_url = data.imageUrl;
  if (data.isOutdated !== undefined) prismaData.is_outdated = data.isOutdated;
  if (data.aiGenerated !== undefined) prismaData.ai_generated = data.aiGenerated;
  if (data.reusableStepId !== undefined) prismaData.reusable_step_id = data.reusableStepId;
  if (data.reusableStepItemId !== undefined) prismaData.reusable_step_item_id = data.reusableStepItemId;

  const updated = await prisma.testCaseStep.update({
    where: { id },
    data: prismaData,
  });

  return updated;
}

export async function deleteTestCaseStepAction(id: string) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByStepId(id, userId);

  const existingStep = await prisma.testCaseStep.findUnique({
    where: { id },
    select: { test_case_id: true },
  });
  if (existingStep) {
    await checkTestCaseReviewLock(existingStep.test_case_id, userId);
  }

  await prisma.testCaseStep.delete({ where: { id } });
  return true;
}

export async function reorderTestCaseStepsAction(testCaseId: string, stepIds: string[]) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByCaseId(testCaseId, userId);
  await checkTestCaseReviewLock(testCaseId, userId);

  await prisma.$transaction(
    stepIds.map((id, index) =>
      prisma.testCaseStep.update({
        where: { id },
        data: { order: index + 1 },
      })
    )
  );

  return true;
}

export async function saveTestCaseStepsBulkAction(data: {
  testCaseId: string;
  deleteIds?: string[];
  steps: Array<{
    id?: string;
    isNew?: boolean;
    order: number;
    step: string;
    expectedResult?: string;
    data?: string;
    imageUrl?: string | null;
    reusableStepId?: string | null;
    reusableStepItemId?: string | null;
    aiGenerated?: boolean;
  }>;
}) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByCaseId(data.testCaseId, userId);
  await checkTestCaseReviewLock(data.testCaseId, userId);

  await prisma.$transaction(async (tx) => {
    if (data.deleteIds && data.deleteIds.length > 0) {
      await tx.testCaseStep.deleteMany({
        where: { id: { in: data.deleteIds }, test_case_id: data.testCaseId },
      });
    }

    const toCreate = data.steps.filter((s) => s.isNew || !s.id);
    const toUpdate = data.steps.filter((s) => !s.isNew && Boolean(s.id));

    if (toCreate.length > 0) {
      await tx.testCaseStep.createMany({
        data: toCreate.map((s) => ({
          test_case_id: data.testCaseId,
          reusable_step_id: s.reusableStepId || null,
          reusable_step_item_id: s.reusableStepItemId || null,
          order: s.order,
          step: s.step,
          expected_result: s.expectedResult ?? null,
          data: !s.data || s.data === '' ? null : s.data.trim(),
          image_url: s.imageUrl || null,
          is_outdated: false,
          ai_generated: s.aiGenerated ?? false,
        })),
      });
    }

    if (toUpdate.length > 0) {
      await Promise.all(
        toUpdate.map((s) =>
          tx.testCaseStep.update({
            where: { id: s.id! },
            data: {
              order: s.order,
              step: s.step,
              expected_result: s.expectedResult ?? null,
              data: !s.data || s.data === '' ? null : s.data.trim(),
              ...(s.imageUrl !== undefined ? { image_url: s.imageUrl } : {}),
              ...(s.reusableStepId !== undefined ? { reusable_step_id: s.reusableStepId } : {}),
              ...(s.reusableStepItemId !== undefined ? { reusable_step_item_id: s.reusableStepItemId } : {}),
              ...(s.aiGenerated !== undefined ? { ai_generated: s.aiGenerated } : {}),
            },
          })
        )
      );
    }
  });

  return prisma.testCaseStep.findMany({
    where: { test_case_id: data.testCaseId },
    orderBy: { order: 'asc' },
    include: { reusable_step: true },
  });
}

export async function updateStepFromSourceAction(stepId: string) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByStepId(stepId, userId);

  const step = await prisma.testCaseStep.findUnique({
    where: { id: stepId },
    include: { reusable_step: true },
  });

  if (!step?.reusable_step) throw new Error('Step has no reusable source');

  if (step.reusable_step_item_id && Array.isArray(step.reusable_step.steps) && step.reusable_step.steps.length > 0) {
    const groupSteps = step.reusable_step.steps as any[];
    const idx = parseInt(step.reusable_step_item_id, 10);
    const source = groupSteps[idx];
    if (source) {
      await prisma.testCaseStep.update({
        where: { id: stepId },
        data: {
          step: source.step || '',
          expected_result: source.expectedResult || source.expected_result || null,
          data: source.data || null,
          image_url: source.imageUrl || source.image_url || null,
          is_outdated: false,
        },
      });
      revalidatePath('/p');
      return true;
    }
  }

  await prisma.testCaseStep.update({
    where: { id: stepId },
    data: {
      step: step.reusable_step.step,
      expected_result: step.reusable_step.expected_result,
      data: step.reusable_step.data,
      is_outdated: false,
    },
  });

  revalidatePath('/p');
  return true;
}

export async function convertStepToCustomAction(stepId: string) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByStepId(stepId, userId);

  await prisma.testCaseStep.update({
    where: { id: stepId },
    data: {
      reusable_step_id: null,
      is_outdated: false,
    },
  });

  revalidatePath('/p');
  return true;
}

export async function uploadStepImageAction(
  data: FormData | {
    stepId: string;
    filename: string;
    mimeType: string;
    fileSize: number;
    fileBase64?: string;
  }
) {
  const { userId } = await getAuthorizedUser();
  const stepId = data instanceof FormData ? (data.get('stepId') as string) : data.stepId;
  if (!stepId) throw new Error('Missing stepId');

  await requireProjectMemberByStepId(stepId, userId);

  const { generateUploadUrl, uploadToS3 } = await import('@/lib/s3/presigned-url');

  if (data instanceof FormData) {
    const file = data.get('file') as File;
    if (!file) throw new Error('Missing file in upload');

    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size exceeds 10MB limit');
    }

    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const key = `steps/${stepId}/${Date.now()}-${sanitized}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await uploadToS3(key, buffer, file.type || 'image/png');

    await prisma.testCaseStep.update({
      where: { id: stepId },
      data: { image_url: key },
    });

    revalidatePath('/p');
    return { success: true, key };
  }

  const sanitized = data.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  const key = `steps/${data.stepId}/${Date.now()}-${sanitized}`;

  if (data.fileBase64) {
    const buffer = Buffer.from(data.fileBase64, 'base64');
    await uploadToS3(key, buffer, data.mimeType);

    await prisma.testCaseStep.update({
      where: { id: data.stepId },
      data: { image_url: key },
    });

    revalidatePath('/p');
    return { success: true, key };
  }

  const uploadUrl = await generateUploadUrl(
    key,
    data.mimeType,
    data.fileSize
  );

  await prisma.testCaseStep.update({
    where: { id: data.stepId },
    data: { image_url: key },
  });

  revalidatePath('/p');
  return { uploadUrl, key, success: true };
}

export async function removeStepImageAction(stepId: string) {
  const { userId } = await getAuthorizedUser();
  await requireProjectMemberByStepId(stepId, userId);

  await prisma.testCaseStep.update({
    where: { id: stepId },
    data: { image_url: null },
  });

  revalidatePath('/p');
  return { success: true };
}

// ============================================
// STEP AUTOCOMPLETE INDEX (DETERMINISTIC)
// ============================================

export interface StepAutocompleteRow {
  action: string;
  expectedResult: string | null;
  freq: number;
  lastSeenMs: number;
}

export async function getStepAutocompleteIndexAction(projectIdOrSlug: string): Promise<StepAutocompleteRow[]> {
  const { userId } = await getAuthorizedUser();
  const actualProjectId = await resolveProjectId(projectIdOrSlug);
  await requireProjectViewer(actualProjectId, userId);

  const [stepRows, reusableSteps] = await Promise.all([
    prisma.$queryRaw<
      {
        norm_step: string;
        action: string;
        expected_result: string | null;
        freq: number;
        last_seen: Date | null;
      }[]
    >`
      SELECT
        LOWER(TRIM(s.step)) AS norm_step,
        MODE() WITHIN GROUP (ORDER BY TRIM(s.step)) AS action,
        MODE() WITHIN GROUP (ORDER BY NULLIF(TRIM(s.expected_result), '')) AS expected_result,
        COUNT(*)::int AS freq,
        MAX(s.updated_at) AS last_seen
      FROM "TestCaseStep" s
      JOIN "TestCase" tc ON tc.id = s.test_case_id
      WHERE tc.project_id = ${actualProjectId}
        AND tc.deleted_at IS NULL
        AND LENGTH(TRIM(s.step)) >= 2
      GROUP BY LOWER(TRIM(s.step))
      ORDER BY freq DESC, last_seen DESC
      LIMIT 2500
    `,
    prisma.reusableStep.findMany({
      where: { project_id: actualProjectId },
      select: {
        step: true,
        expected_result: true,
        steps: true,
        updated_at: true,
      },
    }),
  ]);

  const byNorm = new Map<string, StepAutocompleteRow>();

  for (const r of stepRows) {
    if (!r.action) continue;
    byNorm.set(r.norm_step, {
      action: r.action,
      expectedResult: r.expected_result || null,
      freq: Number(r.freq) || 1,
      lastSeenMs: r.last_seen ? new Date(r.last_seen).getTime() : 0,
    });
  }

  for (const rs of reusableSteps) {
    const lastSeenMs = rs.updated_at ? new Date(rs.updated_at).getTime() : 0;
    const rawItems: Array<{ step?: string; expectedResult?: string | null; expected_result?: string | null }> =
      Array.isArray(rs.steps) && rs.steps.length > 0
        ? (rs.steps as any[])
        : [{ step: rs.step, expected_result: rs.expected_result }];

    for (const item of rawItems) {
      const action = (item?.step || '').trim();
      if (action.length < 2) continue;
      const norm = action.toLowerCase();
      const exp = (item?.expectedResult || item?.expected_result || '').trim() || null;
      const existing = byNorm.get(norm);
      if (existing) {
        existing.freq += 1;
        if (!existing.expectedResult && exp) existing.expectedResult = exp;
        if (lastSeenMs > existing.lastSeenMs) existing.lastSeenMs = lastSeenMs;
      } else {
        byNorm.set(norm, {
          action,
          expectedResult: exp,
          freq: 1,
          lastSeenMs,
        });
      }
    }
  }

  return Array.from(byNorm.values());
}

