import { prisma } from '@/lib/db';
import type { Comment, ReviewRequest, Notification } from '@prisma/client';
import { sendEmail } from '@/lib/email/send';
import { reviewRequestTemplate } from '@/lib/email/templates/reviewRequest';
import { shouldSendEmail } from '@/lib/email/preferences';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/config';

// ==========================================
// COMMENTS (Polymorphic)
// ==========================================

export async function getComments(projectId: string, entityType: string, entityId: string) {
  return prisma.comment.findMany({
    where: {
      project_id: projectId,
      entity_type: entityType,
      entity_id: entityId,
      resolved: false,
    },
    orderBy: { created_at: 'desc' },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          avatar_color: true,
          avatar_initials: true,
        },
      },
      replies: {
        where: { resolved: false },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              avatar_color: true,
              avatar_initials: true,
            },
          },
        },
        orderBy: { created_at: 'asc' },
      },
    },
  });
}

export async function createComment(data: {
  project_id: string;
  entity_type: string;
  entity_id: string;
  parent_id?: string;
  body: string;
  author_id: number;
  mentioned_user_ids?: number[];
  attachment_ids?: string[];
}) {
  const comment = await prisma.comment.create({
    data: {
      ...data,
      mentioned_user_ids: data.mentioned_user_ids ?? [],
      attachment_ids: data.attachment_ids ?? [],
    },
    include: { author: true },
  });

  // Create in-app notifications for mentioned users
  if (data.mentioned_user_ids && data.mentioned_user_ids.length > 0) {
    for (const mentionedUserId of data.mentioned_user_ids) {
      if (mentionedUserId !== data.author_id) {
        await createNotification({
          user_id: mentionedUserId,
          type: 'MENTION',
          entity_type: 'Comment',
          entity_id: comment.id,
          action_url: `/p/project/${data.entity_id}`,
        });
      }
    }
  }

  return comment;
}

// ==========================================
// REVIEW REQUESTS
// ==========================================

export async function getReviewRequests(testCaseId: string) {
  return prisma.reviewRequest.findMany({
    where: { test_case_id: testCaseId },
    orderBy: { created_at: 'desc' },
    include: {
      requester: true,
      assignee: true,
    },
  });
}

export async function createReviewRequest(data: {
  test_case_id: string;
  requested_by: number;
  assigned_to: number;
  comment?: string;
}) {
  const request = await prisma.reviewRequest.create({ data: data as any });

  // Get requester info
  const requester = await prisma.user.findUnique({
    where: { id: data.requested_by },
    select: { name: true },
  });

  // Get test case info
  const testCase = await prisma.testCase.findUnique({
    where: { id: data.test_case_id },
    select: { title: true, project_id: true, display_id: true, project: { select: { slug: true } } },
  });

  // Create in-app notification (always)
  await createNotification({
    user_id: data.assigned_to,
    type: 'REVIEW_REQUEST',
    entity_type: 'ReviewRequest',
    entity_id: request.id,
    action_url: testCase ? `/p/${testCase.project.slug}/repository/${testCase.display_id}` : undefined,
  });

  // Send email if user has preferences enabled
  const shouldEmail = await shouldSendEmail(data.assigned_to, 'review_request');
  if (shouldEmail && requester && testCase) {
    try {
      const template = reviewRequestTemplate(
        requester.name || 'Someone',
        testCase.title || 'this test case',
        `${getBaseUrl()}/p/${testCase.project.slug}/repository/${testCase.display_id}`,
        data.comment
      );

      const assignee = await prisma.user.findUnique({
        where: { id: data.assigned_to },
        select: { email: true },
      });

      if (assignee?.email) {
        await sendEmail({
          to: [assignee.email],
          subject: template.subject,
          htmlBody: template.html,
          textBody: template.text,
        });
      }
    } catch (e: any) {
      logger.warn('Failed to send review request email', {
        module: 'Collaboration',
        action: 'createReviewRequest',
        error: e.message,
      });
    }
  }

  return request;
}

export async function resolveReviewRequest(id: string, status: 'APPROVED' | 'CHANGES_REQUESTED') {
  return prisma.reviewRequest.update({
    where: { id },
    data: {
      status,
      resolved_at: new Date(),
    },
  });
}

// ==========================================
// NOTIFICATIONS
// ==========================================

export async function getNotifications(userId: number, unreadOnly = false) {
  return prisma.notification.findMany({
    where: {
      user_id: userId,
      type: { not: 'JOIN_APPROVED' },
      ...(unreadOnly ? { read: false } : {}),
    },
    orderBy: { created_at: 'desc' },
  });
}

export async function createNotification(data: {
  user_id: number;
  type: string;
  entity_type: string;
  entity_id: string;
  action_url?: string;
  metadata?: any;
}) {
  return prisma.notification.create({ 
    data: {
      ...data,
      metadata: data.metadata || null
    } as any 
  });
}

export async function markNotificationRead(id: string) {
  return prisma.notification.update({
    where: { id },
    data: { read: true },
  });
}
