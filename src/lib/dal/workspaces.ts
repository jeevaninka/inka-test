import { prisma } from '@/lib/db';
import { generateWorkspaceId } from '@/lib/ids';
import type { Workspace } from '@prisma/client';

export async function getWorkspaces(userId: number) {
  return prisma.workspace.findMany({
    where: {
      members: {
        some: { user_id: userId },
      },
    },
    orderBy: { created_at: 'desc' },
    include: {
      projects: true,
      members: { include: { user: true } },
    },
  });
}

export async function getWorkspaceBySlug(slug: string) {
  return prisma.workspace.findUnique({
    where: { slug },
    include: {
      projects: { where: { deleted_at: null } },
      members: { include: { user: true } },
      api_keys: true,
    },
  });
}

export async function createWorkspace(name: string, userId: number) {
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  const id = await generateWorkspaceId();
  return prisma.workspace.create({
    data: {
      id,
      name,
      slug,
      members: {
        create: {
          user_id: userId,
          role: 'OWNER',
        },
      },
    },
  });
}

export async function getWorkspaceMembers(workspaceId: string) {
  return prisma.workspaceMember.findMany({
    where: { workspace_id: workspaceId },
    include: { user: true },
  });
}

export async function inviteMember(workspaceId: string, email: string, role: 'ADMIN' | 'MEMBER' | 'GUEST', userId: number) {
  const token = crypto.randomUUID();
  return prisma.invitation.create({
    data: {
      workspace_id: workspaceId,
      email,
      role,
      token,
      invited_by: userId,
      status: 'PENDING',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}

export async function getJoinRequests(workspaceId: string) {
  return prisma.workspaceJoinRequest.findMany({
    where: { workspace_id: workspaceId, status: 'PENDING' },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { created_at: 'desc' },
  });
}

export async function getApiKeys(workspaceId: string) {
  return prisma.apiKey.findMany({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: 'desc' },
  });
}

export async function createApiKey(workspaceId: string, name: string, scopes: string[], userId: number) {
  const keyHash = crypto.randomUUID();
  return prisma.apiKey.create({
    data: {
      workspace_id: workspaceId,
      name,
      key_hash: keyHash,
      scopes,
      created_by: userId,
    },
  });
}