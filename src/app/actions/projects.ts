'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { generateProjectId } from '@/lib/ids';
import { revalidatePath } from 'next/cache';
import { requireProjectMember, requireProjectAdmin, requireProjectViewer } from '@/lib/permissions';
import { logger } from '@/lib/logger';

export async function createProjectAction(data: {
  name: string;
  slug: string;
  prefix?: string;
  workspaceSlug?: string;
  workspaceId?: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  let workspaceId = data.workspaceId || ((session.user as any).workspaceId as string);

  if (data.workspaceSlug) {
    const ws = await prisma.workspace.findUnique({
      where: { slug: data.workspaceSlug },
      select: { id: true },
    });
    if (!ws) throw new Error('Workspace not found');
    workspaceId = ws.id;
  }

  if (!workspaceId) throw new Error('No active workspace');

  const member = await prisma.workspaceMember.findUnique({
    where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
  });
  if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
    throw new Error('Only workspace owner or admin can create projects');
  }

  const trimmedName = data.name.trim();
  if (!trimmedName) throw new Error('Project name cannot be empty');

  const slug = data.slug.trim().toLowerCase();
  const key = (data.prefix || 'PRJ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'PRJ';

  // Validate duplicate project name, slug, or prefix in this workspace
  const existingNameOrSlug = await prisma.project.findFirst({
    where: {
      workspace_id: workspaceId,
      deleted_at: null,
      OR: [
        { name: { equals: trimmedName, mode: 'insensitive' } },
        { slug: { equals: slug, mode: 'insensitive' } },
      ],
    },
  });
  if (existingNameOrSlug) {
    throw new Error(`A project named "${trimmedName}" already exists in this workspace.`);
  }

  const existingKey = await prisma.project.findFirst({
    where: {
      workspace_id: workspaceId,
      deleted_at: null,
      key: { equals: key, mode: 'insensitive' },
    },
  });
  if (existingKey) {
    throw new Error(`Project prefix "${key}" is already in use in this workspace. Please choose a different prefix.`);
  }

  // Fetch all workspace members so they are automatically provisioned into the new project
  const wsMembers = await prisma.workspaceMember.findMany({
    where: { workspace_id: workspaceId },
  });

  const projectMembersToCreate = wsMembers.map((wm) => ({
    user_id: wm.user_id,
    role: (
      wm.user_id === userId || wm.role === 'OWNER' || wm.role === 'ADMIN'
        ? 'ADMIN'
        : wm.role === 'GUEST'
        ? 'VIEWER'
        : 'TESTER'
    ) as 'ADMIN' | 'TESTER' | 'VIEWER',
  }));

  if (!projectMembersToCreate.some((pm) => pm.user_id === userId)) {
    projectMembersToCreate.push({ user_id: userId, role: 'ADMIN' });
  }

  const id = await generateProjectId();

  const project = await prisma.project.create({
    data: {
      id,
      workspace_id: workspaceId,
      name: trimmedName,
      slug,
      key,
      created_by: userId,
      members: {
        create: projectMembersToCreate,
      },
      environments: {
        create: [
          {
            name: 'DEV',
            color: 'blue',
            description: 'Development and local testing environment',
            is_default: false,
            created_by: userId,
          },
          {
            name: 'STAGING',
            color: 'amber',
            description: 'Pre-production staging environment',
            is_default: true,
            created_by: userId,
          },
          {
            name: 'PRODUCTION',
            color: 'emerald',
            description: 'Production release verification environment',
            is_default: false,
            created_by: userId,
          },
        ],
      },
    },
  });

  logger.info('Project created', {
    module: 'Projects',
    action: 'createProjectAction',
    projectId: project.id,
    slug: project.slug,
    workspaceId,
    userId,
  });

  revalidatePath('/projects');
  revalidatePath('/workspace');
  if (data.workspaceSlug) revalidatePath(`/workspace/${data.workspaceSlug}`);
  return project;
}

export async function getApiSecretAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { api_secret: true },
  });

  return { secret: project?.api_secret || null };
}

export async function generateApiSecretAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectAdmin(projectIdOrSlug, userId);

  const secret = 'inka_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  await prisma.project.update({
    where: { id: actualProjectId },
    data: { api_secret: secret },
  });

  return { secret };
}

export async function regenerateApiSecretAction(projectIdOrSlug: string) {
  return generateApiSecretAction(projectIdOrSlug);
}

export async function getProjectBadgesAction(projectIdOrSlug: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { pendingReviews: 0, openDefects: 0, pendingReleases: 0 };

    const userId = (session.user as any).id as number;
    const actualProjectId = await requireProjectViewer(projectIdOrSlug, userId);

    const [pendingReviews, openDefects, pendingReleases] = await Promise.all([
      prisma.reviewRequest.count({
        where: {
          test_case: {
            project_id: actualProjectId,
            deleted_at: null,
          },
          status: { in: ['PENDING', 'CHANGES_REQUESTED'] },
        },
      }),
      prisma.defect.count({
        where: {
          deleted_at: null,
          local_status: { in: ['OPEN', 'IN_PROGRESS'] },
          run_result: {
            run: {
              project_id: actualProjectId,
              deleted_at: null,
            },
          },
        },
      }),
      prisma.release.count({
        where: {
          project_id: actualProjectId,
          decision: null,
        },
      }),
    ]);

    return { pendingReviews, openDefects, pendingReleases };
  } catch {
    return { pendingReviews: 0, openDefects: 0, pendingReleases: 0 };
  }
}

export async function updateProjectDetailsAction(
  projectIdOrSlug: string,
  data: { name: string; description?: string }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = Number((session.user as { id?: number }).id);
  const actualProjectId = await requireProjectAdmin(projectIdOrSlug, userId);

  const trimmedName = data.name.trim();
  if (!trimmedName) throw new Error('Project name cannot be empty');

  const currentProject = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { id: true, workspace_id: true },
  });
  if (!currentProject) throw new Error('Project not found');

  const existingDuplicate = await prisma.project.findFirst({
    where: {
      id: { not: actualProjectId },
      workspace_id: currentProject.workspace_id,
      deleted_at: null,
      name: { equals: trimmedName, mode: 'insensitive' },
    },
  });
  if (existingDuplicate) {
    throw new Error(`A project named "${trimmedName}" already exists in this workspace.`);
  }

  const updated = await prisma.project.update({
    where: { id: actualProjectId },
    data: { name: trimmedName },
  });

  revalidatePath('/projects');
  revalidatePath(`/p/${updated.slug}`);
  return updated;
}

export async function updateProjectEmailRunCompleteAction(
  projectIdOrSlug: string,
  enabled: boolean
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = Number((session.user as { id?: number }).id);
  const actualProjectId = await requireProjectAdmin(projectIdOrSlug, userId);

  const updated = await prisma.project.update({
    where: { id: actualProjectId },
    data: { email_run_complete_enabled: enabled },
  });

  revalidatePath(`/p/${updated.slug}`);
  return updated;
}

export async function archiveProjectAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = Number((session.user as { id?: number }).id);
  const actualProjectId = await requireProjectAdmin(projectIdOrSlug, userId);

  const updated = await prisma.project.update({
    where: { id: actualProjectId },
    data: { deleted_at: new Date() },
  });

  revalidatePath('/projects');
  return updated;
}

export async function deleteProjectAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = Number((session.user as { id?: number }).id);
  const actualProjectId = await requireProjectAdmin(projectIdOrSlug, userId);

  await prisma.project.delete({
    where: { id: actualProjectId },
  });

  logger.info('Project deleted', {
    module: 'Projects',
    action: 'deleteProjectAction',
    projectId: actualProjectId,
    userId,
  });

  revalidatePath('/projects');
  return { success: true };
}
