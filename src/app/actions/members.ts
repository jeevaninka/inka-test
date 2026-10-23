'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { sendEmail } from '@/lib/email/send';
import { inviteProjectTemplate } from '@/lib/email/templates/inviteProject';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';
import { getBaseUrl } from '@/lib/config';

async function getSessionUserId() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  return (session.user as any).id as number;
}

async function requireProjectAdminOrAbove(projectId: string, userId: number) {
  const pm = await prisma.projectMember.findUnique({
    where: { project_id_user_id: { project_id: projectId, user_id: userId } },
  });
  if (!pm || pm.role !== 'ADMIN') {
    const wm = await prisma.workspaceMember.findFirst({
      where: {
        user_id: userId,
        workspace: { projects: { some: { id: projectId } } },
      },
    });
    if (!wm || (wm.role !== 'OWNER' && wm.role !== 'ADMIN')) {
      throw new Error('Only project admin or workspace owner/admin can manage members');
    }
  }
}

export async function inviteMemberAction(projectId: string, email: string, role: 'ADMIN' | 'TESTER' | 'VIEWER') {
  const userId = await getSessionUserId();
  await requireProjectAdminOrAbove(projectId, userId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { workspace: true },
  });
  if (!project) throw new Error('Project not found');

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split('@')[0],
        is_approved: true,
      },
    });
  } else if (!user.is_approved) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { is_approved: true },
    });
  }

  const existing = await prisma.projectMember.findUnique({
    where: { project_id_user_id: { project_id: projectId, user_id: user.id } },
  });
  if (existing) throw new Error('User is already a member of this project');

  // Ensure user is also a member of the parent workspace and organization
  const existingWsMember = await prisma.workspaceMember.findUnique({
    where: { workspace_id_user_id: { workspace_id: project.workspace_id, user_id: user.id } },
  });
  if (!existingWsMember) {
    await prisma.workspaceMember.create({
      data: {
        workspace_id: project.workspace_id,
        user_id: user.id,
        role: role === 'VIEWER' ? 'GUEST' : 'MEMBER',
      },
    });
  }

  if (project.workspace.organization_id) {
    const existingOrgMember = await prisma.organizationMember.findUnique({
      where: {
        organization_id_user_id: {
          organization_id: project.workspace.organization_id,
          user_id: user.id,
        },
      },
    });
    if (!existingOrgMember) {
      await prisma.organizationMember.create({
        data: {
          organization_id: project.workspace.organization_id,
          user_id: user.id,
          role: 'MEMBER',
        },
      });
    }
  }

  const member = await prisma.projectMember.create({
    data: {
      project_id: projectId,
      user_id: user.id,
      role: role.toUpperCase() as any,
    },
    include: { user: true },
  });

  // Send email notification
  try {
    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    if (project && inviter) {
      const inviteData = inviteProjectTemplate(
        email.split('@')[0],
        project.name,
        `${getBaseUrl()}/p/${project.slug}`,
        inviter.name || 'A team member',
        role.toLowerCase()
      );

      await sendEmail({
        to: [email],
        subject: inviteData.subject,
        htmlBody: inviteData.html,
        textBody: inviteData.text,
      });
    }
  } catch (e: any) {
    // Log error but don't fail the invitation
    logger.error('Failed to send project member invite email', {
      module: 'Members',
      action: 'inviteMember',
      projectId,
      email,
      errorCode: ErrorCodes.EMAIL_SEND,
      error: e,
    });
  }

  await prisma.notification.create({
    data: {
      user_id: user.id,
      type: 'ADDED_TO_PROJECT',
      entity_type: 'Project',
      entity_id: projectId,
    },
  });

  revalidatePath(`/p`);
  return member;
}

export async function updateMemberRoleAction(projectId: string, targetUserId: number, role: 'ADMIN' | 'TESTER' | 'VIEWER') {
  const userId = await getSessionUserId();
  await requireProjectAdminOrAbove(projectId, userId);

  const member = await prisma.projectMember.update({
    where: {
      project_id_user_id: { project_id: projectId, user_id: targetUserId },
    },
    data: { role: role.toUpperCase() as any },
  });

  revalidatePath(`/p`);
  return member;
}

export async function removeMemberAction(projectId: string, targetUserId: number) {
  const userId = await getSessionUserId();
  await requireProjectAdminOrAbove(projectId, userId);

  if (targetUserId === userId) throw new Error('Cannot remove yourself');

  await prisma.projectMember.delete({
    where: {
      project_id_user_id: { project_id: projectId, user_id: targetUserId },
    },
  });

  revalidatePath(`/p`);
  return true;
}