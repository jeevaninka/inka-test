import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/apiHandler';
import { prisma } from '@/lib/db';
import { requireProjectMember } from '@/lib/permissions';
import { getReviewDiffAction, getActiveReviewRequestAction, getReviewHistoryAction } from '@/app/actions/reviews';
import { getCommentsAction } from '@/app/actions/comments';
import { getAttachmentsAction } from '@/app/actions/attachments';

export const GET = createApiHandler<{ caseId: string }>(async (req, { params, userId }) => {
  const { caseId } = await params;

  if (!caseId) {
    return NextResponse.json({ error: 'Case ID is required' }, { status: 400 });
  }

  // 1. Locate test case by ID or display_id (case-insensitive)
  const testCase = await prisma.testCase.findFirst({
    where: {
      OR: [
        { id: caseId },
        { display_id: { equals: caseId, mode: 'insensitive' } },
      ],
      deleted_at: null,
    },
    include: {
      project: { select: { id: true, slug: true, name: true } },
      dataset: true,
    },
  });

  if (!testCase) {
    return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
  }

  const projectId = testCase.project_id;
  await requireProjectMember(projectId, userId);

  // 2. Fetch all related details in parallel (single DB round-trip)
  const isReviewing = Boolean(
    testCase.review_status && (testCase.review_status === 'PENDING' || testCase.review_status === 'CHANGES_REQUESTED')
  );
  const isDraft = testCase.status === 'DRAFT';

  const [
    stepRecords,
    suiteCases,
    localVars,
    globalVars,
    activeReq,
    reviewHistory,
    reviewDiff,
    latestRunResult,
    comments,
    attachments,
  ] = await Promise.all([
    // Steps
    prisma.testCaseStep.findMany({
      where: { test_case_id: testCase.id },
      orderBy: { order: 'asc' },
      include: { reusable_step: true },
    }),

    // Suites
    prisma.suiteCase.findMany({
      where: { test_case_id: testCase.id },
      include: { suite: { select: { id: true, name: true } } },
    }),

    // Local variables
    prisma.variable.findMany({
      where: { test_case_id: testCase.id, scope: 'LOCAL' },
      orderBy: { key: 'asc' },
      include: { values: { include: { environment: true } } },
    }),

    // Global variables
    prisma.variable.findMany({
      where: { project_id: projectId, scope: 'GLOBAL' },
      select: { key: true, scope: true },
      orderBy: { key: 'asc' },
    }),

    // Active review request (direct Prisma query — avoids duplicate getServerSession)
    prisma.reviewRequest.findFirst({
      where: { test_case_id: testCase.id, status: 'PENDING' },
      orderBy: { created_at: 'desc' },
      include: {
        requester: { select: { id: true, name: true, display_name: true, email: true, image: true } },
        assignee: { select: { id: true, name: true, display_name: true, email: true, image: true } },
      },
    }).catch(() => null),

    // Review history (direct Prisma query)
    prisma.reviewRequest.findMany({
      where: { test_case_id: testCase.id },
      orderBy: { created_at: 'desc' },
      include: {
        requester: { select: { id: true, name: true, display_name: true, email: true, image: true } },
        assignee: { select: { id: true, name: true, display_name: true, email: true, image: true } },
      },
    }).catch(() => []),

    // Review diff (only if actively in review)
    isReviewing ? getReviewDiffAction(testCase.id).catch(() => null) : Promise.resolve(null),

    // Latest executed run result
    prisma.runResult.findFirst({
      where: { test_case_id: testCase.id },
      orderBy: { executed_at: 'desc' },
      select: { status: true, executed_at: true },
    }),

    // Case comments (direct Prisma query)
    prisma.comment.findMany({
      where: { entity_id: testCase.id, entity_type: 'case', parent_id: null, deleted_at: null },
      orderBy: { created_at: 'asc' },
      include: {
        author: { select: { id: true, name: true, display_name: true, email: true, image: true } },
        replies: {
          where: { deleted_at: null },
          orderBy: { created_at: 'asc' },
          include: {
            author: { select: { id: true, name: true, display_name: true, email: true, image: true } },
          },
        },
      },
    }).catch(() => []),

    // Case attachments (direct Prisma query)
    prisma.attachment.findMany({
      where: { entity_id: testCase.id, entity_type: 'case', status: 'ACTIVE' },
      orderBy: { created_at: 'desc' },
    }).catch(() => []),
  ]);

  // Format steps exclusively from relational TestCaseStep records
  const formattedSteps = stepRecords.map((s) => ({
    id: s.id,
    order: s.order,
    step: s.step,
    expected_result: s.expected_result,
    data: s.data,
    reusableStepId: s.reusable_step_id,
    reusable_step_id: s.reusable_step_id,
    reusable_step_item_id: s.reusable_step_item_id,
    reusable_step: s.reusable_step,
    is_outdated: s.is_outdated,
    image_url: s.image_url,
  }));

  // Format suites
  const formattedSuites = suiteCases.map((sc) => ({
    suiteId: sc.suite.id,
    suiteName: sc.suite.name,
  }));

  return NextResponse.json({
    case: {
      id: testCase.id,
      displayId: testCase.display_id,
      projectId: testCase.project_id,
      moduleId: testCase.module_id,
      title: testCase.title,
      description: testCase.description,
      preConditions: testCase.pre_conditions,
      postConditions: testCase.post_conditions,
      expectedResult: testCase.expected_result,
      priority: testCase.priority,
      type: testCase.type.toLowerCase(),
      status: testCase.status.toLowerCase(),
      tags: testCase.tags,
      labels: testCase.labels || [],
      scenarioType: testCase.scenario_type,
      aiGenerated: testCase.ai_generated,
      needsUpdate: testCase.needs_update,
      reviewStatus: testCase.review_status ? testCase.review_status.toLowerCase() : null,
      createdBy: testCase.created_by,
      createdAt: testCase.created_at.toISOString(),
      updatedAt: testCase.updated_at?.toISOString(),
      updatedBy: testCase.updated_by,
      datasetId: testCase.dataset_id,
      dataset: testCase.dataset,
      localDataset: testCase.local_dataset,
    },
    steps: formattedSteps,
    suites: formattedSuites,
    localVars,
    allVariables: [
      ...localVars.map((v) => ({ ...v, scope: 'LOCAL' as const })),
      ...globalVars.map((v) => ({ ...v, scope: 'GLOBAL' as const })),
    ],
    activeReviewRequest: activeReq,
    reviewHistory: reviewHistory || [],
    reviewDiff,
    lastRunResult: latestRunResult
      ? {
          status: latestRunResult.status.toLowerCase(),
          date: latestRunResult.executed_at?.toISOString(),
        }
      : null,
    comments,
    attachments: (attachments as any)?.attachments || attachments || [],
  });
});
