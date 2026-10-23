'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { requireProjectMember, requireProjectMemberByCaseId, requireProjectAdmin } from '@/lib/permissions';
import { createNotification } from '@/lib/dal/collaboration';
import { getBaseUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { runReviewPreflightChecks } from '@/lib/reviews/preflight';

export async function requestReviewAction(data: {
  testCaseId: string;
  assignedTo?: number;
  comment?: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(data.testCaseId, userId);

  if (data.assignedTo && userId === data.assignedTo) {
    throw new Error('You cannot assign a review to yourself');
  }

  const testCase = await prisma.testCase.findUnique({
    where: { id: data.testCaseId },
    select: { id: true, display_id: true, title: true, description: true, review_status: true, pre_conditions: true, post_conditions: true, current_version: true, project_id: true, steps: true },
  });

  if (!testCase) throw new Error('Test case not found');

  // Read steps from TestCaseStep records (authoritative source)
  const stepRecords = await prisma.testCaseStep.findMany({
    where: { test_case_id: data.testCaseId },
    orderBy: { order: 'asc' },
  });

  const nonEmptySteps = stepRecords.filter((s) => Boolean((s.step || '').trim()));
  if (nonEmptySteps.length === 0) {
    throw new Error('Please add at least one test step before submitting for review.');
  }

  const newVersionNumber = testCase.current_version + 1;
  const isPending = testCase.review_status === 'PENDING';
  const isChangesRequested = testCase.review_status === 'CHANGES_REQUESTED';
  let assignedTargetUserId: number | null | undefined = data.assignedTo;

  await prisma.$transaction(async (tx) => {
    // 0. Ensure baseline snapshot exists for current_version if this is an update to an existing active/approved case
    if (testCase.current_version >= 1) {
      const existingBaseline = await tx.testCaseVersion.findUnique({
        where: {
          test_case_id_version_number: {
            test_case_id: data.testCaseId,
            version_number: testCase.current_version,
          }
        }
      });

      let baselineSteps: any[] = [];
      if (existingBaseline && Array.isArray(existingBaseline.steps) && existingBaseline.steps.length > 0) {
        baselineSteps = existingBaseline.steps as any[];
      } else if (Array.isArray(testCase.steps) && testCase.steps.length > 0) {
        baselineSteps = testCase.steps as any[];
      } else if (stepRecords && stepRecords.length > 0) {
        baselineSteps = stepRecords.map(s => ({
          order: s.order,
          step: s.step,
          expectedResult: s.expected_result,
          data: s.data,
        }));
      }

      if (!existingBaseline) {
        await tx.testCaseVersion.create({
          data: {
            test_case_id: data.testCaseId,
            version_number: testCase.current_version,
            steps: baselineSteps,
            pre_conditions: testCase.pre_conditions,
            description: null,
            snapshot_by: userId,
          }
        });
      } else if (Array.isArray(existingBaseline.steps) && existingBaseline.steps.length === 0 && baselineSteps.length > 0) {
        await tx.testCaseVersion.update({
          where: { id: existingBaseline.id },
          data: { steps: baselineSteps },
        });
      }
    }

    // 1. Create a snapshot from current TestCaseStep records
    await tx.testCaseVersion.create({
      data: {
        test_case_id: data.testCaseId,
        version_number: newVersionNumber,
        steps: stepRecords.map(s => ({
          order: s.order,
          step: s.step,
          expectedResult: s.expected_result,
          data: s.data,
          imageUrl: s.image_url,
        })),
        pre_conditions: testCase.pre_conditions,
        description: testCase.description,
        snapshot_by: userId,
      },
    });

    // 2. If it was CHANGES_REQUESTED, resolve the old request
    if (isChangesRequested) {
      await tx.reviewRequest.updateMany({
        where: { test_case_id: data.testCaseId, status: 'CHANGES_REQUESTED' },
        data: { resolved_at: new Date() },
      });
    }

    // 3. If it was already PENDING, we can update or create a new revision request
    let reviewRequest;
    if (isPending) {
      // Find the pending request to update
      const existingReq = await tx.reviewRequest.findFirst({
        where: { test_case_id: data.testCaseId, status: 'PENDING' },
        orderBy: { created_at: 'desc' },
      });

      if (existingReq) {
        reviewRequest = await tx.reviewRequest.update({
          where: { id: existingReq.id },
          data: {
            version_number_at_request: newVersionNumber,
            assigned_to: data.assignedTo !== undefined ? data.assignedTo : existingReq.assigned_to,
            comment: data.comment || existingReq.comment,
            created_at: new Date(),
          },
        });
      }
    }

    if (!reviewRequest) {
      reviewRequest = await tx.reviewRequest.create({
        data: {
          test_case_id: data.testCaseId,
          requested_by: userId,
          assigned_to: data.assignedTo ?? null,
          comment: data.comment || (isChangesRequested ? 'Resubmitted after addressing requested changes' : undefined),
          version_number_at_request: newVersionNumber,
          status: 'PENDING',
        },
      });
    }

    // 4. Update current version and review status of test case
    const updatedTestCase = await tx.testCase.update({
      where: { id: data.testCaseId },
      data: {
        current_version: newVersionNumber,
        review_status: 'PENDING',
      },
      include: {
        project: { select: { slug: true } },
      },
    });

    // 5. Send appropriate notification
    const targetUserId = data.assignedTo || reviewRequest.assigned_to;
    assignedTargetUserId = targetUserId;
    const notificationType = isChangesRequested ? 'REVIEW_RESUBMITTED' : (isPending ? 'REVIEW_UPDATED' : 'REVIEW_REQUEST');

    if (targetUserId) {
      await createNotification({
        user_id: targetUserId,
        type: notificationType,
        entity_type: 'ReviewRequest',
        entity_id: reviewRequest.id,
        action_url: `/p/${updatedTestCase.project.slug}/repository/${updatedTestCase.display_id}`,
        metadata: {
          requesterName: (session.user as any).name,
          requesterImage: (session.user as any).image,
          testCaseKey: updatedTestCase.display_id,
          testCaseName: updatedTestCase.title,
          comment: data.comment,
        },
      });
    } else {
      // Notify all project members if pooled
      const members = await tx.projectMember.findMany({
        where: { project_id: updatedTestCase.project_id, user_id: { not: userId } },
        select: { user_id: true },
      });
      if (members.length > 0) {
        await tx.notification.createMany({
          data: members.map((member) => ({
            user_id: member.user_id,
            type: notificationType,
            entity_type: 'ReviewRequest',
            entity_id: reviewRequest.id,
            action_url: `/p/${updatedTestCase.project.slug}/repository/${updatedTestCase.display_id}`,
            metadata: {
              requesterName: (session.user as any).name,
              requesterImage: (session.user as any).image,
              testCaseKey: updatedTestCase.display_id,
              testCaseName: updatedTestCase.title,
              comment: data.comment,
            },
          })),
        });
      }
    }
  });

  if (assignedTargetUserId) {
    try {
      const { shouldSendEmail } = await import('@/lib/email/preferences');
      const shouldEmail = await shouldSendEmail(assignedTargetUserId, 'review_request');
      if (shouldEmail) {
        const assignee = await prisma.user.findUnique({
          where: { id: assignedTargetUserId },
          select: { email: true },
        });
        if (assignee?.email) {
          const { reviewRequestTemplate } = await import('@/lib/email/templates/reviewRequest');
          const { sendEmail } = await import('@/lib/email/send');
          const baseUrl = getBaseUrl();
          const template = reviewRequestTemplate(
            (session.user as any).name || 'A team member',
            testCase.title,
            `${baseUrl}/p/${testCase.project_id}/repository/${testCase.display_id}`,
            data.comment
          );
          await sendEmail({
            to: [assignee.email],
            subject: template.subject,
            htmlBody: template.html,
            textBody: template.text,
          });
        }
      }
    } catch {
      // silent fallback
    }
  }

  revalidatePath('/p');
  return true;
}

export async function approveReviewAction(reviewRequestId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const req = await prisma.reviewRequest.findUnique({
    where: { id: reviewRequestId },
    select: { test_case_id: true, requested_by: true },
  });
  if (!req) throw new Error('Review request not found');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(req.test_case_id, userId);

  if (req.requested_by === userId) {
    throw new Error('You cannot approve your own review');
  }

  await prisma.$transaction(async (tx) => {
    const updatedReview = await tx.reviewRequest.update({
      where: { id: reviewRequestId },
      data: { status: 'APPROVED', resolved_at: new Date() },
    });

    const stepRecords = await tx.testCaseStep.findMany({
      where: { test_case_id: req.test_case_id },
      orderBy: { order: 'asc' },
    });

    const mappedApprovedSteps = stepRecords.map(s => ({
      order: s.order,
      step: s.step,
      expectedResult: s.expected_result,
      data: s.data,
    }));

    const testCase = await tx.testCase.update({
      where: { id: req.test_case_id },
      data: {
        review_status: 'APPROVED',
        status: 'ACTIVE',
        steps: mappedApprovedSteps,
      },
      include: { project: { select: { slug: true } } },
    });

    // Ensure version snapshot is recorded/updated for the approved state
    await tx.testCaseVersion.upsert({
      where: {
        test_case_id_version_number: {
          test_case_id: testCase.id,
          version_number: testCase.current_version,
        },
      },
      update: {
        steps: mappedApprovedSteps,
        pre_conditions: testCase.pre_conditions,
        description: testCase.description,
        snapshot_by: userId,
        snapshot_at: new Date(),
      },
      create: {
        test_case_id: testCase.id,
        version_number: testCase.current_version,
        steps: mappedApprovedSteps,
        pre_conditions: testCase.pre_conditions,
        description: testCase.description,
        snapshot_by: userId,
      },
    });

    // Auto-resolve open comments from this approved review cycle
    await tx.comment.updateMany({
      where: {
        entity_id: req.test_case_id,
        entity_type: 'case',
        resolved: false,
        deleted_at: null,
      },
      data: {
        resolved: true,
        resolved_at: new Date(),
        resolved_by_id: userId,
      },
    });

    await createNotification({
      user_id: req.requested_by,
      type: 'REVIEW_APPROVED',
      entity_type: 'ReviewRequest',
      entity_id: updatedReview.id,
      action_url: `/p/${testCase.project.slug}/repository/${testCase.display_id}`,
      metadata: {
        approverName: (session.user as any).name,
        approverImage: (session.user as any).image,
        testCaseKey: testCase.display_id,
        testCaseName: testCase.title,
      },
    });
  });

  revalidatePath('/p');
  return true;
}

export async function requestChangesOnReviewAction(reviewRequestId: string, comment?: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const req = await prisma.reviewRequest.findUnique({
    where: { id: reviewRequestId },
    select: { test_case_id: true, requested_by: true },
  });
  if (!req) throw new Error('Review request not found');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(req.test_case_id, userId);

  if (req.requested_by === userId) {
    throw new Error('You cannot request changes on your own review');
  }

  if (!comment || !comment.trim()) {
    throw new Error('A comment is required when requesting changes');
  }

  await prisma.$transaction(async (tx) => {
    const updatedReview = await tx.reviewRequest.update({
      where: { id: reviewRequestId },
      data: { status: 'CHANGES_REQUESTED', comment: comment, resolved_at: new Date() },
    });
    const testCase = await tx.testCase.update({
      where: { id: req.test_case_id },
      data: { review_status: 'CHANGES_REQUESTED' },
      include: { project: { select: { slug: true } } },
    });

    await createNotification({
      user_id: req.requested_by,
      type: 'REVIEW_CHANGES_REQUESTED',
      entity_type: 'ReviewRequest',
      entity_id: updatedReview.id,
      action_url: `/p/${testCase.project.slug}/repository/${testCase.display_id}`,
    });
  });

  revalidatePath('/p');
  return true;
}

export async function cancelReviewAction(testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  // Tenant guard first: the caller must belong to the case's project.
  await requireProjectMemberByCaseId(testCaseId, userId);

  const req = await prisma.reviewRequest.findFirst({
    where: { 
      test_case_id: testCaseId,
      status: 'PENDING'
    },
    orderBy: { created_at: 'desc' }
  });

  if (!req) {
    throw new Error('No active review to cancel');
  }

  // Allow cancellation if user is the requester (ideally admins could too, but let's strictly follow plan)
  const member = await prisma.projectMember.findFirst({
    where: { user_id: userId, project: { test_cases: { some: { id: testCaseId } } } }
  });
  const isAdmin = member?.role === 'ADMIN';

  if (req.requested_by !== userId && !isAdmin) {
    throw new Error('You did not submit this review and are not an admin');
  }

  await prisma.$transaction(async (tx) => {
    const updatedReview = await tx.reviewRequest.update({
      where: { id: req.id },
      data: { status: 'CANCELLED', resolved_at: new Date() },
    });
    const testCase = await tx.testCase.update({
      where: { id: testCaseId },
      data: { review_status: null, status: 'DRAFT' },
      include: { project: { select: { slug: true } } },
    });

    if (req.assigned_to) {
      await createNotification({
        user_id: req.assigned_to,
        type: 'REVIEW_CANCELLED',
        entity_type: 'ReviewRequest',
        entity_id: updatedReview.id,
        action_url: `/p/${testCase.project.slug}/repository/${testCase.display_id}`,
      });
    }
  });

  revalidatePath('/p');
  return true;
}

export async function adminForceApproveAction(testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(testCaseId, userId);

  // Check role
  const member = await prisma.projectMember.findFirst({
    where: { user_id: userId, project: { test_cases: { some: { id: testCaseId } } } }
  });
  if (member?.role !== 'ADMIN' && (session.user as any).role !== 'admin' && (session.user as any).role !== 'owner') {
    throw new Error('Only admins can force approve');
  }

  // If there's an active review request, resolve it as approved
  const req = await prisma.reviewRequest.findFirst({
    where: { test_case_id: testCaseId, status: { in: ['PENDING', 'CHANGES_REQUESTED'] } },
    orderBy: { created_at: 'desc' }
  });

  await prisma.$transaction(async (tx) => {
    let updatedReview;
    if (req) {
      updatedReview = await tx.reviewRequest.update({
        where: { id: req.id },
        data: { status: 'APPROVED', resolved_at: new Date() },
      });
    }

    const stepRecords = await tx.testCaseStep.findMany({
      where: { test_case_id: testCaseId },
      orderBy: { order: 'asc' },
    });

    const mappedApprovedSteps = stepRecords.map(s => ({
      order: s.order,
      step: s.step,
      expectedResult: s.expected_result,
      data: s.data,
    }));

    const testCase = await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        review_status: 'APPROVED',
        status: 'ACTIVE',
        steps: mappedApprovedSteps,
      },
      include: { project: { select: { slug: true } } },
    });

    // Ensure version snapshot is recorded/updated for the approved state
    await tx.testCaseVersion.upsert({
      where: {
        test_case_id_version_number: {
          test_case_id: testCase.id,
          version_number: testCase.current_version,
        },
      },
      update: {
        steps: mappedApprovedSteps,
        pre_conditions: testCase.pre_conditions,
        description: testCase.description,
        snapshot_by: userId,
        snapshot_at: new Date(),
      },
      create: {
        test_case_id: testCase.id,
        version_number: testCase.current_version,
        steps: mappedApprovedSteps,
        pre_conditions: testCase.pre_conditions,
        description: testCase.description,
        snapshot_by: userId,
      },
    });

    // Auto-resolve open comments from this approved review cycle
    await tx.comment.updateMany({
      where: {
        entity_id: testCaseId,
        entity_type: 'case',
        resolved: false,
        deleted_at: null,
      },
      data: {
        resolved: true,
        resolved_at: new Date(),
        resolved_by_id: userId,
      },
    });

    if (updatedReview) {
      await createNotification({
        user_id: req!.requested_by,
        type: 'REVIEW_APPROVED',
        entity_type: 'ReviewRequest',
        entity_id: updatedReview.id,
        action_url: `/p/${testCase.project.slug}/repository/${testCase.display_id}`,
        metadata: {
          approverName: (session.user as any).name,
          approverImage: (session.user as any).image,
          testCaseKey: testCase.display_id,
          testCaseName: testCase.title,
        },
      });
    }
  });

  revalidatePath('/p');
  return true;
}

export async function bulkAdminForceApproveAction(testCaseIds: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  if (testCaseIds.length === 0) return true;

  const userId = (session.user as any).id as number;

  // Resolve every case's project and require admin rights on each of them, so a
  // single call cannot mutate cases in another tenant.
  const cases = await prisma.testCase.findMany({
    where: { id: { in: testCaseIds } },
    select: { id: true, project_id: true },
  });

  const projectIds = Array.from(new Set(cases.map((c) => c.project_id)));
  for (const pid of projectIds) {
    await requireProjectAdmin(pid, userId);
  }

  const scopedCaseIds = cases.map((c) => c.id);
  if (scopedCaseIds.length === 0) return true;

  const pendingRequests = await prisma.reviewRequest.findMany({
    where: { test_case_id: { in: scopedCaseIds }, status: { in: ['PENDING', 'CHANGES_REQUESTED'] } }
  });

  await prisma.$transaction(async (tx) => {
    if (pendingRequests.length > 0) {
      await tx.reviewRequest.updateMany({
        where: { id: { in: pendingRequests.map(r => r.id) } },
        data: { status: 'APPROVED', resolved_at: new Date() }
      });
    }

    await tx.testCase.updateMany({
      where: { id: { in: scopedCaseIds } },
      data: { review_status: 'APPROVED', status: 'ACTIVE' }
    });
  });

  revalidatePath('/p');
  return true;
}

export async function getActiveReviewRequestAction(testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(testCaseId, userId, 'VIEWER');

  const r = await prisma.reviewRequest.findFirst({
    where: { test_case_id: testCaseId, status: { in: ['PENDING', 'CHANGES_REQUESTED'] } },
    include: {
      requester: { select: { id: true, name: true, image: true, avatar_color: true, avatar_initials: true } },
      assignee: { select: { id: true, name: true, image: true, avatar_color: true, avatar_initials: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  if (!r) return null;

  return {
    id: r.id,
    status: r.status.toLowerCase(),
    comment: r.comment,
    requestedById: r.requester.id,
    requestedByName: r.requester.name || 'Unknown',
    requestedByImage: r.requester.image,
    requestedByColor: r.requester.avatar_color ?? null,
    requestedByInitials: r.requester.avatar_initials ?? null,
    assignedToId: r.assignee?.id ?? null,
    assignedToName: r.assignee?.name ?? null,
    assignedToImage: r.assignee?.image ?? null,
    assignedToColor: r.assignee?.avatar_color ?? null,
    assignedToInitials: r.assignee?.avatar_initials ?? null,
    createdAt: r.created_at.toISOString(),
    versionNumberAtRequest: r.version_number_at_request,
  };
}

export async function getReviewHistoryAction(testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(testCaseId, userId, 'VIEWER');

  const requests = await prisma.reviewRequest.findMany({
    where: { test_case_id: testCaseId, status: { not: 'PENDING' } },
    include: {
      requester: { select: { name: true } },
      assignee: { select: { name: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  return requests.map(r => ({
    id: r.id,
    status: r.status.toLowerCase(),
    comment: r.comment,
    requestedByName: r.requester.name || 'Unknown',
    assignedToName: r.assignee?.name || 'Unknown',
    createdAt: r.created_at.toISOString(),
    resolvedAt: r.resolved_at?.toISOString(),
  }));
}

export async function getReviewDiffAction(testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(testCaseId, userId, 'VIEWER');

  // Find the active ReviewRequest (PENDING or CHANGES_REQUESTED) that has a snapshot
  const r = await prisma.reviewRequest.findFirst({
    where: {
      test_case_id: testCaseId,
      status: { in: ['PENDING', 'CHANGES_REQUESTED'] },
    },
    orderBy: { created_at: 'desc' },
  });

  const currentTestCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: {
      project_id: true,
      current_version: true,
      pre_conditions: true,
      post_conditions: true,
      expected_result: true,
      title: true,
      priority: true,
      type: true,
      description: true,
      steps: true,
      local_dataset: true,
      dataset: { select: { parameters: true } },
    },
  });

  if (!currentTestCase) return null;

  // Read current steps from TestCaseStep records (authoritative source)
  const [currentStepRecords, projectVars, projectEnvs] = await Promise.all([
    prisma.testCaseStep.findMany({
      where: { test_case_id: testCaseId },
      orderBy: { order: 'asc' },
    }),
    prisma.variable.findMany({
      where: {
        project_id: currentTestCase.project_id,
        OR: [{ test_case_id: null }, { test_case_id: testCaseId }],
      },
      include: {
        values: { select: { value: true } },
      },
    }),
    prisma.environment.findMany({
      where: { project_id: currentTestCase.project_id },
      select: { name: true, base_url: true },
    }),
  ]);
  const currentSteps = currentStepRecords.map(s => ({
    order: s.order,
    step: s.step,
    expectedResult: s.expected_result,
    data: s.data,
    imageUrl: s.image_url,
    reusableStepId: s.reusable_step_id,
  }));

  const targetVersion = r?.version_number_at_request ?? currentTestCase.current_version;

  // Load requested snapshot if available
  let afterSteps = currentSteps;
  let afterPreConditions = currentTestCase.pre_conditions;
  const afterPostConditions = currentTestCase.post_conditions;
  let afterDescription = currentTestCase.description || '';

  if (r?.version_number_at_request) {
    const requestedSnapshot = await prisma.testCaseVersion.findUnique({
      where: {
        test_case_id_version_number: {
          test_case_id: testCaseId,
          version_number: r.version_number_at_request
        }
      }
    });

    if (requestedSnapshot) {
      if (Array.isArray(requestedSnapshot.steps) && requestedSnapshot.steps.length > 0) {
        afterSteps = requestedSnapshot.steps as any[];
      }
      if (requestedSnapshot.pre_conditions !== undefined) {
        afterPreConditions = requestedSnapshot.pre_conditions;
      }
      if (requestedSnapshot.description !== undefined && requestedSnapshot.description !== null) {
        afterDescription = requestedSnapshot.description;
      }
    }
  }

  // Find the last approved review request before targetVersion to use as baseline
  const lastApprovedReq = await prisma.reviewRequest.findFirst({
    where: {
      test_case_id: testCaseId,
      status: 'APPROVED',
      version_number_at_request: { not: null, lt: targetVersion },
    },
    orderBy: { version_number_at_request: 'desc' },
  });

  const baselineVersionNumber = lastApprovedReq?.version_number_at_request ?? null;

  // Find the baseline snapshot
  let priorSnapshot = baselineVersionNumber
    ? await prisma.testCaseVersion.findUnique({
        where: {
          test_case_id_version_number: {
            test_case_id: testCaseId,
            version_number: baselineVersionNumber,
          },
        },
      })
    : null;

  if (!priorSnapshot) {
    // Fallback: take latest version prior to targetVersion
    priorSnapshot = await prisma.testCaseVersion.findFirst({
      where: {
        test_case_id: testCaseId,
        version_number: { lt: targetVersion },
      },
      orderBy: { version_number: 'desc' },
    });
  }

  let beforeSteps = priorSnapshot && Array.isArray(priorSnapshot.steps) ? (priorSnapshot.steps as any[]) : [];
  let beforePreConditions = priorSnapshot?.pre_conditions || '';
  const beforePostConditions = '';
  if (beforeSteps.length === 0 && targetVersion > 1) {
    if (Array.isArray(currentTestCase.steps) && currentTestCase.steps.length > 0) {
      beforeSteps = currentTestCase.steps as any[];
    }
  }

  const hasBaseline = (Boolean(priorSnapshot) && beforeSteps.length > 0) || (targetVersion > 1 && beforeSteps.length > 0);
  const beforeDescription = priorSnapshot?.description ?? (hasBaseline ? '' : null);

  // Filter out any empty/ghost steps and normalize comparison sequentially
  const validCurrentSteps = currentSteps.filter(s => Boolean((s.step || '').trim() || (s.expectedResult || '').trim() || (s.data || '').trim()));
  const validAfterSteps = afterSteps.filter((s: any) => Boolean((s.step || '').trim() || (s.expectedResult || s.expected_result || '').trim() || (s.data || '').trim()));

  const currentStepSimplified = validCurrentSteps.map((s, idx) => ({ order: idx + 1, step: (s.step || '').trim(), exp: (s.expectedResult || '').trim(), data: (s.data || '').trim() }));
  const afterStepSimplified = validAfterSteps.map((s: any, idx) => ({ order: idx + 1, step: (s.step || '').trim(), exp: (s.expectedResult || s.expected_result || '').trim(), data: (s.data || '').trim() }));

  const hasWorkingEdits = Boolean(
    r && (
      JSON.stringify(currentStepSimplified) !== JSON.stringify(afterStepSimplified) ||
      (currentTestCase.description || '').trim() !== (afterDescription || '').trim() ||
      (currentTestCase.pre_conditions || '').trim() !== (afterPreConditions || '').trim()
    )
  );

  const knownVariableKeys = projectVars.map((v) => v.key);
  const variableValueToKeyMap: Record<string, string> = {};
  for (const v of projectVars) {
    if (!v.is_secret && v.default_value && v.default_value.length >= 6) {
      variableValueToKeyMap[v.default_value.trim()] = v.key;
    }
    if (!v.is_secret) {
      for (const valItem of v.values || []) {
        if (valItem.value && valItem.value.length >= 6) {
          variableValueToKeyMap[valItem.value.trim()] = v.key;
        }
      }
    }
  }

  const environmentUrls = projectEnvs
    .filter((e) => Boolean(e.base_url))
    .map((e) => ({ name: e.name, baseUrl: e.base_url! }));

  const localDsParams = Array.isArray((currentTestCase.local_dataset as any)?.parameters)
    ? ((currentTestCase.local_dataset as any).parameters as string[])
    : [];
  const dsParams = Array.isArray(currentTestCase.dataset?.parameters)
    ? currentTestCase.dataset!.parameters
    : [];
  const knownParameterKeys = Array.from(new Set([...dsParams, ...localDsParams]));

  const preflightIssues = runReviewPreflightChecks({
    steps: validAfterSteps,
    preConditions: afterPreConditions,
    caseExpectedResult: currentTestCase.expected_result,
    knownVariableKeys,
    variableValueToKeyMap,
    environmentUrls,
    knownParameterKeys,
  });

  return {
    targetVersion,
    baselineVersion: priorSnapshot?.version_number ?? (hasBaseline ? 1 : null),
    hasBaseline,
    hasWorkingEdits,
    preflightIssues,
    workingCopy: {
      steps: currentSteps,
      description: currentTestCase.description || '',
      preConditions: currentTestCase.pre_conditions || '',
    },
    before: {
      steps: beforeSteps,
      preConditions: beforePreConditions,
      postConditions: beforePostConditions,
      title: hasBaseline ? currentTestCase.title : '',
      priority: currentTestCase.priority,
      type: currentTestCase.type,
      description: beforeDescription,
    },
    after: {
      steps: afterSteps,
      preConditions: afterPreConditions,
      postConditions: afterPostConditions,
      title: currentTestCase.title,
      priority: currentTestCase.priority,
      type: currentTestCase.type,
      description: afterDescription,
    }
  };
}

export async function updateReviewSnapshotAction(testCaseId: string, comment?: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(testCaseId, userId);

  const req = await prisma.reviewRequest.findFirst({
    where: { test_case_id: testCaseId, status: { in: ['PENDING', 'CHANGES_REQUESTED'] } },
    orderBy: { created_at: 'desc' },
  });

  if (!req || !req.version_number_at_request) {
    throw new Error('No active review request found to update');
  }

  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { id: true, title: true, description: true, pre_conditions: true, current_version: true, project: { select: { slug: true } } },
  });
  if (!testCase) throw new Error('Test case not found');

  const currentStepRecords = await prisma.testCaseStep.findMany({
    where: { test_case_id: testCaseId },
    orderBy: { order: 'asc' },
  });

  const formattedSteps = currentStepRecords.map(s => ({
    order: s.order,
    step: s.step,
    expectedResult: s.expected_result,
    data: s.data,
    imageUrl: s.image_url,
  }));

  await prisma.$transaction(async (tx) => {
    // 1. Update or create the snapshot for version_number_at_request
    await tx.testCaseVersion.upsert({
      where: {
        test_case_id_version_number: {
          test_case_id: testCaseId,
          version_number: req.version_number_at_request!,
        },
      },
      update: {
        steps: formattedSteps,
        description: testCase.description,
        pre_conditions: testCase.pre_conditions,
        snapshot_by: userId,
        snapshot_at: new Date(),
      },
      create: {
        test_case_id: testCaseId,
        version_number: req.version_number_at_request!,
        steps: formattedSteps,
        description: testCase.description,
        pre_conditions: testCase.pre_conditions,
        snapshot_by: userId,
      },
    });

    // 2. Update review request timestamp and ensure status is PENDING
    await tx.reviewRequest.update({
      where: { id: req.id },
      data: {
        status: 'PENDING',
        comment: comment || req.comment,
        created_at: new Date(),
      },
    });

    // 3. Notify reviewer if assigned
    if (req.assigned_to) {
      await createNotification({
        user_id: req.assigned_to,
        type: 'REVIEW_UPDATED',
        entity_type: 'ReviewRequest',
        entity_id: req.id,
        action_url: `/p/${testCase.project.slug}/reviews/${testCase.id}`,
        metadata: {
          updaterName: (session.user as any).name || 'Author',
        },
      });
    }
  });

  revalidatePath('/p');
  return true;
}

export async function discardWorkingChangesAction(testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(testCaseId, userId);

  // Find active review request (PENDING or CHANGES_REQUESTED)
  const req = await prisma.reviewRequest.findFirst({
    where: { test_case_id: testCaseId, status: { in: ['PENDING', 'CHANGES_REQUESTED'] } },
    orderBy: { created_at: 'desc' },
  });

  let snapshot = null;
  if (req?.version_number_at_request) {
    snapshot = await prisma.testCaseVersion.findUnique({
      where: {
        test_case_id_version_number: {
          test_case_id: testCaseId,
          version_number: req.version_number_at_request,
        },
      },
    });
  }

  // Fallback to last approved baseline version
  if (!snapshot) {
    snapshot = await prisma.testCaseVersion.findFirst({
      where: { test_case_id: testCaseId },
      orderBy: { version_number: 'desc' },
    });
  }

  if (!snapshot) {
    throw new Error('No snapshot found to restore from');
  }

  const snapshotSteps = Array.isArray(snapshot.steps) ? (snapshot.steps as any[]) : [];

  await prisma.$transaction(async (tx) => {
    // 1. Delete current live TestCaseStep records
    await tx.testCaseStep.deleteMany({ where: { test_case_id: testCaseId } });

    // 2. Recreate from snapshot
    if (snapshotSteps.length > 0) {
      await tx.testCaseStep.createMany({
        data: snapshotSteps.map((s: any, i: number) => ({
          test_case_id: testCaseId,
          order: s.order ?? i + 1,
          step: s.step || '',
          expected_result: s.expectedResult ?? s.expected_result ?? null,
          data: s.data ?? null,
          image_url: s.imageUrl ?? s.image_url ?? null,
          reusable_step_id: null,
          is_outdated: false,
        })),
      });
    }

    // 3. Restore description and pre_conditions
    await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        description: snapshot.description,
        pre_conditions: snapshot.pre_conditions,
      },
    });
  });

  revalidatePath('/p');
  return true;
}

export async function revertTestCaseVersionAction(testCaseId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(testCaseId, userId);

  const req = await prisma.reviewRequest.findFirst({
    where: { test_case_id: testCaseId, status: { in: ['PENDING', 'CHANGES_REQUESTED'] } },
    orderBy: { created_at: 'desc' },
  });

  if (!req || !req.version_number_at_request) {
    throw new Error('No snapshot found to revert to');
  }

  const snapshot = await prisma.testCaseVersion.findUnique({
    where: { test_case_id_version_number: { test_case_id: testCaseId, version_number: req.version_number_at_request } }
  });

  if (!snapshot) throw new Error('Snapshot not found');

  const snapshotSteps = Array.isArray(snapshot.steps) ? snapshot.steps : [];

  await prisma.$transaction(async (tx) => {
    // Delete current TestCaseStep records
    await tx.testCaseStep.deleteMany({ where: { test_case_id: testCaseId } });

    // Recreate from snapshot
    if (snapshotSteps.length > 0) {
      await tx.testCaseStep.createMany({
        data: snapshotSteps.map((s: any, i: number) => ({
          test_case_id: testCaseId,
          order: s.order ?? i + 1,
          step: s.step || '',
          expected_result: s.expectedResult || null,
          reusable_step_id: null,
          is_outdated: false,
        })),
      });
    }

    // Update pre_conditions and reset review status to allow re-review
    await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        pre_conditions: snapshot.pre_conditions,
        review_status: null,
        status: 'DRAFT',
      },
    });
  });

  revalidatePath('/p');
  return true;
}

export async function assignReviewAction(reviewRequestId: string, userId: number) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const currentUserId = (session.user as any).id as number;

  const req = await prisma.reviewRequest.findUnique({
    where: { id: reviewRequestId },
    include: {
      test_case: {
        select: {
          id: true,
          display_id: true,
          title: true,
          project_id: true,
          project: { select: { slug: true } }
        }
      },
      requester: { select: { id: true, name: true, image: true } }
    },
  });
  if (!req) throw new Error('Review request not found');

  await requireProjectMemberByCaseId(req.test_case_id, currentUserId);

  if (req.requested_by === userId) {
    throw new Error('Author cannot be assigned to review their own test case');
  }

  const newAssignee = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, image: true, email: true }
  });
  if (!newAssignee) throw new Error('Assignee user not found');

  await prisma.$transaction(async (tx) => {
    await tx.reviewRequest.update({
      where: { id: reviewRequestId },
      data: { assigned_to: userId },
    });

    // Record activity log entry
    await tx.activityLog.create({
      data: {
        project_id: req.test_case.project_id,
        user_id: currentUserId,
        action: `Assigned review of "${req.test_case.title}" (${req.test_case.display_id}) to ${newAssignee.name || newAssignee.email}`,
        entity_type: 'test_case',
        entity_id: req.test_case_id,
      }
    });

    // In-app notification to the new assignee
    if (userId !== currentUserId) {
      await createNotification({
        user_id: userId,
        type: 'REVIEW_REQUEST',
        entity_type: 'ReviewRequest',
        entity_id: reviewRequestId,
        action_url: `/p/${req.test_case.project.slug}/repository/${req.test_case.display_id}`,
        metadata: {
          requesterName: req.requester.name,
          requesterImage: req.requester.image,
          testCaseKey: req.test_case.display_id,
          testCaseName: req.test_case.title,
        },
      });
    }
  });

  if (userId !== currentUserId && newAssignee.email) {
    try {
      const { shouldSendEmail } = await import('@/lib/email/preferences');
      const shouldEmail = await shouldSendEmail(userId, 'review_request');
      if (shouldEmail) {
        const { reviewRequestTemplate } = await import('@/lib/email/templates/reviewRequest');
        const { sendEmail } = await import('@/lib/email/send');
        const baseUrl = getBaseUrl();
        const template = reviewRequestTemplate(
          req.requester.name || 'A team member',
          req.test_case.title,
          `${baseUrl}/p/${req.test_case.project.slug}/repository/${req.test_case.display_id}`
        );
        await sendEmail({
          to: [newAssignee.email],
          subject: template.subject,
          htmlBody: template.html,
          textBody: template.text,
        });
      }
    } catch {
      // silent fallback
    }
  }

  revalidatePath('/p');
  return { success: true };
}

export async function unassignReviewAction(reviewRequestId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const currentUserId = (session.user as any).id as number;
  const req = await prisma.reviewRequest.findUnique({
    where: { id: reviewRequestId },
    include: {
      test_case: {
        select: {
          id: true,
          display_id: true,
          title: true,
          project_id: true,
          project: { select: { slug: true } }
        }
      }
    },
  });
  if (!req) throw new Error('Review request not found');

  await requireProjectMemberByCaseId(req.test_case_id, currentUserId);

  await prisma.$transaction(async (tx) => {
    await tx.reviewRequest.update({
      where: { id: reviewRequestId },
      data: { assigned_to: null },
    });

    await tx.activityLog.create({
      data: {
        project_id: req.test_case.project_id,
        user_id: currentUserId,
        action: `Unassigned review of "${req.test_case.title}" (${req.test_case.display_id}) to Project Pool`,
        entity_type: 'test_case',
        entity_id: req.test_case_id,
      }
    });
  });

  revalidatePath('/p');
  return { success: true };
}

export async function getReviewQueueAction(projectId: string, viewMode: 'mine' | 'all' = 'mine', overrideUserId?: number) {
  let userId = overrideUserId;
  if (!userId) {
    const session = await getServerSession(authOptions);
    if (!session?.user) throw new Error('Unauthorized');
    userId = (session.user as any).id as number;
  }

  const whereClause: any = {
    test_case: { project_id: projectId, deleted_at: null },
    status: { in: ['PENDING', 'CHANGES_REQUESTED'] },
  };

  if (viewMode === 'mine') {
    whereClause.assigned_to = userId;
  }

  const requests = await prisma.reviewRequest.findMany({
    where: whereClause,
    include: {
      test_case: {
        select: {
          id: true,
          display_id: true,
          title: true,
          review_status: true,
          current_version: true,
          pre_conditions: true,
          post_conditions: true,
        },
      },
      requester: { select: { id: true, name: true, image: true, avatar_color: true, avatar_initials: true } },
      assignee: { select: { id: true, name: true, image: true, avatar_color: true, avatar_initials: true } },
    },
    orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
  });

  const caseIds = [...new Set(requests.map((r) => r.test_case.id))];

  const [versions, currentSteps] = await Promise.all([
    caseIds.length > 0
      ? prisma.testCaseVersion.findMany({
          where: { test_case_id: { in: caseIds } },
          select: {
            test_case_id: true,
            version_number: true,
            steps: true,
            pre_conditions: true,
            description: true,
          },
          orderBy: { version_number: 'desc' },
        })
      : [],
    caseIds.length > 0
      ? prisma.testCaseStep.findMany({
          where: { test_case_id: { in: caseIds } },
          select: {
            test_case_id: true,
            order: true,
            step: true,
            expected_result: true,
            data: true,
          },
          orderBy: { order: 'asc' },
        })
      : [],
  ]);

  const versionsByCase = new Map<string, typeof versions>();
  for (const v of versions) {
    const list = versionsByCase.get(v.test_case_id) || [];
    list.push(v);
    versionsByCase.set(v.test_case_id, list);
  }

  const currentStepsByCase = new Map<string, typeof currentSteps>();
  for (const s of currentSteps) {
    const list = currentStepsByCase.get(s.test_case_id) || [];
    list.push(s);
    currentStepsByCase.set(s.test_case_id, list);
  }

  return requests.map((r) => {
    const targetVersion = r.version_number_at_request ?? r.test_case.current_version ?? 1;
    const caseVers = versionsByCase.get(r.test_case.id) || [];
    const caseCurrentSteps = currentStepsByCase.get(r.test_case.id) || [];

    // Get "after" steps
    let afterSteps = caseCurrentSteps;
    let afterPre = r.test_case.pre_conditions || '';
    const afterPost = r.test_case.post_conditions || '';

    const reqVersion = caseVers.find((v) => v.version_number === targetVersion);
    if (reqVersion && Array.isArray(reqVersion.steps) && reqVersion.steps.length > 0) {
      afterSteps = reqVersion.steps as any[];
      afterPre = reqVersion.pre_conditions || '';
    }

    // Get "before" steps (prior version snapshot)
    const priorVersion = caseVers.find((v) => v.version_number < targetVersion);
    const beforeSteps = priorVersion && Array.isArray(priorVersion.steps) ? (priorVersion.steps as any[]) : [];
    const beforePre = priorVersion?.pre_conditions || '';
    const beforePost = '';

    const hasBaseline = Boolean(priorVersion) || (targetVersion > 1 && beforeSteps.length > 0);

    let addedCount = 0;
    let removedCount = 0;
    let modifiedCount = 0;

    if (!hasBaseline) {
      // Brand new test case
      addedCount = afterSteps.length;
    } else {
      const allOrders = new Set([
        ...beforeSteps.map((s: any) => s.order),
        ...afterSteps.map((s: any) => s.order),
      ]);
      allOrders.forEach((order) => {
        const b = beforeSteps.find((s: any) => s.order === order) as any;
        const a = afterSteps.find((s: any) => s.order === order) as any;
        if (!b && a) addedCount++;
        else if (b && !a) removedCount++;
        else if (b && a) {
          const bExp = b.expectedResult ?? b.expected_result ?? null;
          const aExp = a.expectedResult ?? a.expected_result ?? null;
          const bData = b.data ?? null;
          const aData = a.data ?? null;
          if (b.step !== a.step || bExp !== aExp || bData !== aData) {
            modifiedCount++;
          }
        }
      });
    }

    const preChanged = hasBaseline && beforePre !== afterPre;
    const postChanged = hasBaseline && beforePost !== afterPost;
    const descChanged = hasBaseline && (priorVersion?.description || '').trim() !== (reqVersion?.description || '').trim();
    const totalChanges = addedCount + removedCount + modifiedCount + (preChanged ? 1 : 0) + (postChanged ? 1 : 0) + (descChanged ? 1 : 0);

    let changeChip = {
      text: `+${afterSteps.length || 1} added`,
      type: 'added' as 'added' | 'modified' | 'mixed' | 'none',
      total: totalChanges,
      added: addedCount,
      modified: modifiedCount,
      removed: removedCount,
    };

    if (!hasBaseline) {
      changeChip = {
        text: `+${afterSteps.length || 1} added`,
        type: 'added',
        total: afterSteps.length,
        added: afterSteps.length,
        modified: 0,
        removed: 0,
      };
    } else if (totalChanges === 0) {
      changeChip = {
        text: '0 changes',
        type: 'none',
        total: 0,
        added: 0,
        modified: 0,
        removed: 0,
      };
    } else if (addedCount > 0 && modifiedCount === 0 && removedCount === 0) {
      changeChip = {
        text: `+${addedCount} added`,
        type: 'added',
        total: totalChanges,
        added: addedCount,
        modified: 0,
        removed: 0,
      };
    } else if (modifiedCount > 0 && addedCount === 0 && removedCount === 0) {
      changeChip = {
        text: `~${modifiedCount} modified`,
        type: 'modified',
        total: totalChanges,
        added: 0,
        modified: modifiedCount,
        removed: 0,
      };
    } else {
      const parts = [];
      if (addedCount > 0) parts.push(`+${addedCount}`);
      if (modifiedCount > 0) parts.push(`~${modifiedCount}`);
      if (removedCount > 0) parts.push(`-${removedCount}`);
      if (parts.length === 0 && (preChanged || postChanged)) parts.push('~1');
      changeChip = {
        text: parts.join(' ') || `${totalChanges} changes`,
        type: 'mixed',
        total: totalChanges,
        added: addedCount,
        modified: modifiedCount,
        removed: removedCount,
      };
    }

    return {
      id: r.id,
      testCaseId: r.test_case.id,
      displayId: r.test_case.display_id,
      title: r.test_case.title,
      reviewStatus: (r.test_case.review_status || 'pending').toLowerCase(),
      requestStatus: r.status.toLowerCase(),
      comment: r.comment,
      hasBaseline,
      changeChip,
      requestedById: r.requester.id,
      requesterName: r.requester.name || 'Unknown',
      requesterImage: r.requester.image,
      requesterColor: r.requester.avatar_color ?? null,
      requesterInitials: r.requester.avatar_initials ?? null,
      assigneeId: r.assignee?.id ?? null,
      assigneeName: r.assignee?.name ?? null,
      assigneeImage: r.assignee?.image ?? null,
      assigneeColor: r.assignee?.avatar_color ?? null,
      assigneeInitials: r.assignee?.avatar_initials ?? null,
      createdAt: r.created_at.toISOString(),
    };
  });
}

export async function updateProjectReviewSettingAction(projectId: string, reviewRequired: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const member = await prisma.projectMember.findUnique({
    where: { project_id_user_id: { project_id: projectId, user_id: userId } },
  });
  if (!member || (member.role !== 'ADMIN' && member.role !== 'TESTER')) {
    const wm = await prisma.workspaceMember.findFirst({
      where: { user_id: userId, workspace: { projects: { some: { id: projectId } } } },
    });
    if (!wm || (wm.role !== 'OWNER' && wm.role !== 'ADMIN')) {
      throw new Error('Forbidden: only project admins or workspace owners/admins can change review settings');
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { review_required: reviewRequired },
  });

  revalidatePath('/p');
  return true;
}

export async function bulkRequestReviewAction(data: {
  testCaseIds: string[];
  assignedTo?: number;
  comment?: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  if (!data.testCaseIds || data.testCaseIds.length === 0) return true;

  const userId = (session.user as any).id as number;

  if (data.assignedTo && userId === data.assignedTo) {
    throw new Error('You cannot assign a review to yourself');
  }

  const [cases, allStepRecords] = await Promise.all([
    prisma.testCase.findMany({
      where: { id: { in: data.testCaseIds } },
      select: {
        id: true,
        display_id: true,
        title: true,
        current_version: true,
        pre_conditions: true,
        project_id: true,
        project: { select: { slug: true } },
      },
    }),
    prisma.testCaseStep.findMany({
      where: { test_case_id: { in: data.testCaseIds } },
      orderBy: { order: 'asc' },
    }),
  ]);

  if (cases.length === 0) return true;

  const uniqueProjectIds = [...new Set(cases.map((c) => c.project_id))];
  for (const pid of uniqueProjectIds) {
    await requireProjectMember(pid, userId);
  }

  const stepsByCaseId = new Map<string, typeof allStepRecords>();
  for (const step of allStepRecords) {
    const list = stepsByCaseId.get(step.test_case_id) || [];
    list.push(step);
    stepsByCaseId.set(step.test_case_id, list);
  }

  const caseById = new Map(cases.map((c) => [c.id, c]));

  await prisma.$transaction(async (tx) => {
    // 1. Batch create version snapshots
    await tx.testCaseVersion.createMany({
      data: cases.map((testCase) => {
        const stepRecords = stepsByCaseId.get(testCase.id) || [];
        return {
          test_case_id: testCase.id,
          version_number: testCase.current_version + 1,
          steps: stepRecords.map((s) => ({
            order: s.order,
            step: s.step,
            expectedResult: s.expected_result,
            data: s.data,
          })),
          pre_conditions: testCase.pre_conditions,
          snapshot_by: userId,
        };
      }),
      skipDuplicates: true,
    });

    // 2. Update test cases in parallel
    await Promise.all(
      cases.map((testCase) =>
        tx.testCase.update({
          where: { id: testCase.id },
          data: {
            current_version: testCase.current_version + 1,
            review_status: 'PENDING',
          },
        })
      )
    );

    // 3. Batch create review requests
    const createdRequests = await tx.reviewRequest.createManyAndReturn({
      data: cases.map((testCase) => ({
        test_case_id: testCase.id,
        requested_by: userId,
        assigned_to: data.assignedTo ?? null,
        comment: data.comment,
        version_number_at_request: testCase.current_version + 1,
        status: 'PENDING' as const,
      })),
    });

    // 4. Batch create notifications if assigned
    if (data.assignedTo && createdRequests.length > 0) {
      await tx.notification.createMany({
        data: createdRequests.map((req) => {
          const testCase = caseById.get(req.test_case_id)!;
          return {
            user_id: data.assignedTo!,
            type: 'REVIEW_REQUEST',
            entity_type: 'ReviewRequest',
            entity_id: req.id,
            action_url: `/p/${testCase.project.slug}/repository/${testCase.display_id}`,
            metadata: {
              requesterName: (session.user as any).name,
              requesterImage: (session.user as any).image,
              testCaseKey: testCase.display_id,
              testCaseName: testCase.title,
              comment: data.comment,
            },
          };
        }),
      });
    }
  });

  revalidatePath('/p');
  return true;
}