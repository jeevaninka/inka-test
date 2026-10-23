'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { extractMentions, findMentionedUserIds } from '@/lib/comments/mentions';
import { sendEmail } from '@/lib/email/send';
import { mentionTemplate } from '@/lib/email/templates/mention';
import { shouldSendEmail } from '@/lib/email/preferences';
import { getBaseUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { requireProjectMember, requireProjectViewer } from '@/lib/permissions';

async function getSessionUserId() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  return (session.user as any).id as number;
}

/**
 * Resolves the owning project of a polymorphic comment target.
 * Returns null when the entity cannot be found.
 */
async function resolveEntityProjectId(entityType: string, entityId: string): Promise<string | null> {
  if (entityType === 'case') {
    const tc = await prisma.testCase.findUnique({ where: { id: entityId }, select: { project_id: true } });
    return tc?.project_id ?? null;
  }
  if (entityType === 'run') {
    const run = await prisma.testRun.findUnique({ where: { id: entityId }, select: { project_id: true } });
    return run?.project_id ?? null;
  }
  if (entityType === 'run_result') {
    const rr = await prisma.runResult.findUnique({
      where: { id: entityId },
      select: { test_case: { select: { project_id: true } } },
    });
    return rr?.test_case.project_id ?? null;
  }
  if (entityType === 'defect') {
    const def = await prisma.defect.findUnique({
      where: { id: entityId },
      select: { run_result: { select: { test_case: { select: { project_id: true } } } } },
    });
    return def?.run_result?.test_case.project_id ?? null;
  }
  return null;
}

export async function createCommentAction(data: {
  project_id: string;
  entity_type: string;
  entity_id: string;
  parent_id?: string;
  body: string;
  attachment_ids?: string[];
  assigned_to_id?: number;
}) {
  try {
    const userId = await getSessionUserId();

    await requireProjectMember(data.project_id, userId);

    // Guard against attaching a comment to an entity from another tenant:
    // the claimed project must match the entity's real project.
    const entityProjectId = await resolveEntityProjectId(data.entity_type, data.entity_id);
    if (entityProjectId && entityProjectId !== data.project_id) {
      throw new Error('Forbidden: entity does not belong to this project');
    }

    // Extract mentions
    const mentionedUsernames = extractMentions(data.body);
    const mentionedUserIds = await findMentionedUserIds(data.project_id, mentionedUsernames);

    // Create comment
    const comment = await prisma.comment.create({
      data: {
        project_id: data.project_id,
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        parent_id: data.parent_id,
        body: data.body,
        author_id: userId,
        mentioned_user_ids: mentionedUserIds,
        attachment_ids: data.attachment_ids || [],
        assigned_to_id: data.assigned_to_id,
      },
      include: { author: true },
    });

    // Resolve target URL for notifications & mention emails
    let caseUrl = `/p/${data.project_id}`;
    let entityLabel = `${data.entity_type} "${data.entity_id}"`;
    if (data.entity_type === 'case') {
      const tc = await prisma.testCase.findUnique({
        where: { id: data.entity_id },
        select: { display_id: true, title: true, project: { select: { slug: true } } },
      });
      if (tc) {
        caseUrl = `/p/${tc.project.slug}/repository/${tc.display_id}`;
        entityLabel = `[${tc.display_id}] ${tc.title}`;
      }
    }

    // Create notification if assigned
    if (data.assigned_to_id) {
      await prisma.notification.create({
        data: {
          type: 'ASSIGNED_COMMENT',
          entity_type: 'Comment',
          entity_id: comment.id,
          action_url: caseUrl,
          user_id: data.assigned_to_id,
        },
      });
    }

    // Send mention emails
    for (const mentionedUserId of mentionedUserIds) {
      const shouldEmail = await shouldSendEmail(mentionedUserId, 'mention');
      if (shouldEmail && mentionedUserId !== userId) {
        try {
          const [author, mentionedUser] = await Promise.all([
            prisma.user.findUnique({ where: { id: userId } }),
            prisma.user.findUnique({ where: { id: mentionedUserId }, select: { email: true } }),
          ]);
          if (mentionedUser?.email) {
            const template = mentionTemplate(
              author?.name || 'Someone',
              entityLabel,
              data.body,
              `${getBaseUrl()}${caseUrl}`
            );

            await sendEmail({
              to: [mentionedUser.email],
              subject: template.subject,
              htmlBody: template.html,
              textBody: template.text,
            });
          }
        } catch (e: any) {
          logger.warn('Failed to send mention email', {
            module: 'Comments',
            action: 'createComment',
            reason: e.message,
          });
        }
      }
    }

    logger.info('Comment created', {
      module: 'Comments',
      action: 'createComment',
      commentId: comment.id,
      mentionedUsers: mentionedUserIds.length,
    });

    return comment;
  } catch (e: any) {
    logger.error('Comment creation failed', {
      module: 'Comments',
      action: 'createComment',
      error: e.message,
      stack: e.stack,
    });
    throw e;
  }
}

export async function updateCommentAction(commentId: string, body: string) {
  try {
    const userId = await getSessionUserId();

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.author_id !== userId) {
      throw new Error('Unauthorized');
    }

    // Tenant guard: authorship alone is not enough, the caller must still be a
    // member of the project the comment belongs to.
    await requireProjectMember(comment.project_id, userId);

    return await prisma.comment.update({
      where: { id: commentId },
      data: { body },
    });
  } catch (e: any) {
    logger.error('Comment update failed', {
      module: 'Comments',
      action: 'updateComment',
      error: e.message,
    });
    throw e;
  }
}

export async function deleteCommentAction(commentId: string) {
  try {
    const userId = await getSessionUserId();

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.author_id !== userId) {
      throw new Error('Unauthorized');
    }

    // Tenant guard: authors lose access when they leave the project.
    await requireProjectMember(comment.project_id, userId);

    // Soft delete by setting deleted_at
    return await prisma.comment.update({
      where: { id: commentId },
      data: { deleted_at: new Date() },
    });
  } catch (e: any) {
    logger.error('Comment deletion failed', {
      module: 'Comments',
      action: 'deleteComment',
      error: e.message,
    });
    throw e;
  }
}

export async function getCommentsAction(entityId: string, entityType: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) throw new Error('Unauthorized');
    const userId = (session.user as any).id as number;

    // Resolve project and authorize
    let projectId: string | null = null;
    if (entityType === 'case') {
      const tc = await prisma.testCase.findUnique({ where: { id: entityId }, select: { project_id: true } });
      projectId = tc?.project_id || null;
    } else if (entityType === 'run') {
      const run = await prisma.testRun.findUnique({ where: { id: entityId }, select: { project_id: true } });
      projectId = run?.project_id || null;
    } else if (entityType === 'run_result') {
      const rr = await prisma.runResult.findUnique({ where: { id: entityId }, include: { run: { select: { project_id: true } } } });
      projectId = rr?.run?.project_id || null;
    } else if (entityType === 'defect') {
      const def = await prisma.defect.findUnique({ where: { id: entityId }, include: { run_result: { include: { run: { select: { project_id: true } } } } } });
      projectId = def?.run_result?.run?.project_id || null;
    } else {
      const firstComment = await prisma.comment.findFirst({ where: { entity_id: entityId }, select: { project_id: true } });
      projectId = firstComment?.project_id || null;
    }

    if (projectId) {
      await requireProjectViewer(projectId, userId);
    }

    const comments = await prisma.comment.findMany({
      where: {
        entity_id: entityId,
        entity_type: entityType,
        ...(projectId ? { project_id: projectId } : {}),
        deleted_at: null,
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
        assignedTo: {
          select: { id: true, name: true },
        },
        resolvedBy: {
          select: { id: true, name: true },
        },
        replies: {
          where: { deleted_at: null },
          orderBy: { created_at: 'asc' },
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
            assignedTo: {
              select: { id: true, name: true },
            },
            resolvedBy: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    return comments;
  } catch (e: any) {
    logger.error('Get comments failed', {
      module: 'Comments',
      action: 'getComments',
      error: e.message,
    });
    throw e;
  }
}

export async function resolveCommentAction(commentId: string, replyText?: string) {
  try {
    const userId = await getSessionUserId();

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new Error('Comment not found');
    }

    await requireProjectMember(comment.project_id, userId);

    // Update comment as resolved
    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: {
        resolved: true,
        resolved_at: new Date(),
        resolved_by_id: userId,
      },
    });

    // If reply text is provided, create a reply comment
    if (replyText) {
      await prisma.comment.create({
        data: {
          project_id: comment.project_id,
          entity_type: comment.entity_type,
          entity_id: comment.entity_id,
          parent_id: commentId,
          body: replyText,
          author_id: userId,
          attachment_ids: [],
        },
      });
    }

    // Create notification for the original author
    let resolvedCaseUrl = `/p/${comment.project_id}`;
    if (comment.entity_type === 'case') {
      const tc = await prisma.testCase.findUnique({
        where: { id: comment.entity_id },
        select: { display_id: true, project: { select: { slug: true } } }
      });
      if (tc) resolvedCaseUrl = `/p/${tc.project.slug}/repository/${tc.display_id}`;
    }

    await prisma.notification.create({
      data: {
        type: 'COMMENT_RESOLVED',
        entity_type: 'Comment',
        entity_id: commentId,
        action_url: resolvedCaseUrl,
        user_id: comment.author_id,
      },
    });

    logger.info('Comment resolved', {
      module: 'Comments',
      action: 'resolveComment',
      commentId,
      resolvedBy: userId,
    });

    return updatedComment;
  } catch (e: any) {
    logger.error('Comment resolution failed', {
      module: 'Comments',
      action: 'resolveComment',
      error: e.message,
    });
    throw e;
  }
}
