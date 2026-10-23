'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function getUserAction(userId: number) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const currentUserId = Number((session.user as any).id);

  if (userId !== currentUserId) {
    // Verify that current user and target user share at least one workspace or project
    const sharedWorkspace = await prisma.workspaceMember.findFirst({
      where: {
        user_id: currentUserId,
        workspace: {
          members: { some: { user_id: userId } },
        },
      },
    });

    if (!sharedWorkspace) {
      const sharedProject = await prisma.projectMember.findFirst({
        where: {
          user_id: currentUserId,
          project: {
            members: { some: { user_id: userId } },
          },
        },
      });
      if (!sharedProject) {
        logger.warn('Blocked cross-tenant user profile lookup', {
          module: 'Users',
          action: 'getUserAction',
          userId: currentUserId,
          targetUserId: userId,
        });
        return null;
      }
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true },
  });

  if (!user) return null;

  return {
    id: user.id,
    name: user.name || user.email.split('@')[0],
    email: user.email,
    avatarUrl: user.image || null,
  };
}

export async function getUsersAction(userIds: number[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const currentUserId = Number((session.user as any).id);

  if (userIds.length === 0) return [];

  // Find all workspaces current user belongs to
  const userWorkspaces = await prisma.workspaceMember.findMany({
    where: { user_id: currentUserId },
    select: { workspace_id: true },
  });
  const workspaceIds = userWorkspaces.map((w) => w.workspace_id);

  // Find all projects current user belongs to
  const userProjects = await prisma.projectMember.findMany({
    where: { user_id: currentUserId },
    select: { project_id: true },
  });
  const projectIds = userProjects.map((p) => p.project_id);

  // Allow lookup of userIds that share at least one workspace, project, or is current user
  const allowedMembers = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      OR: [
        { id: currentUserId },
        { workspace_members: { some: { workspace_id: { in: workspaceIds } } } },
        { project_members: { some: { project_id: { in: projectIds } } } },
      ],
    },
    select: { id: true, name: true, email: true, image: true },
  });

  return allowedMembers.map((user) => ({
    id: user.id,
    name: user.name || user.email.split('@')[0],
    email: user.email,
    avatarUrl: user.image || null,
  }));
}
