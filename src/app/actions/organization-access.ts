'use server';

import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { checkIsPlatformAdmin } from '@/lib/auth/org-role';
import { AppError, ErrorCodes } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Organization access controls.
 *
 * - Organization suspend / unsuspend / delete: platform administrators only.
 * - Member suspend / unsuspend: organization OWNER or ADMIN (cannot target the
 *   OWNER and cannot target yourself).
 *
 * All suspension state is reversible (nullable timestamps). Suspension takes
 * effect on the next request because every authorization path re-checks the
 * database (see `src/lib/access.ts`).
 */

async function requirePlatformAdmin(): Promise<number> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new AppError('Unauthorized: Please sign in', ErrorCodes.UNAUTHORIZED);
  }
  const userId = Number((session.user as any).id);
  const isPlatformAdmin = await checkIsPlatformAdmin(userId);
  if (!isPlatformAdmin) {
    throw new AppError(
      'Forbidden: platform administrator access required',
      ErrorCodes.FORBIDDEN
    );
  }
  return userId;
}

async function requireOrganizationAdmin(organizationId: string, userId: number) {
  const isPlatformAdmin = await checkIsPlatformAdmin(userId);
  if (isPlatformAdmin) return { role: 'OWNER' as const };

  const membership = await prisma.organizationMember.findUnique({
    where: {
      organization_id_user_id: { organization_id: organizationId, user_id: userId },
    },
    select: { role: true, suspended_at: true },
  });

  if (!membership || membership.suspended_at) {
    throw new AppError('Forbidden: not an active member of this organization', ErrorCodes.FORBIDDEN);
  }

  if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
    throw new AppError(
      'Forbidden: only organization owner or admin can manage members',
      ErrorCodes.FORBIDDEN
    );
  }

  return { role: membership.role };
}

async function getOrganizationOrThrow(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      suspended_at: true,
      suspend_reason: true,
    },
  });

  if (!organization) {
    throw new AppError('Organization not found', ErrorCodes.NOT_FOUND);
  }

  return organization;
}

export async function suspendOrganizationAction(data: {
  organizationId: string;
  reason?: string | null;
}) {
  const userId = await requirePlatformAdmin();
  const organization = await getOrganizationOrThrow(data.organizationId);

  if (organization.suspended_at) {
    return { success: true, alreadySuspended: true };
  }

  const reason = (data.reason || '').trim() || null;

  await prisma.organization.update({
    where: { id: organization.id },
    data: {
      suspended_at: new Date(),
      suspended_by: userId,
      suspend_reason: reason,
    },
  });

  logger.info(`Organization suspended: ${organization.name}`, {
    module: 'OrganizationAccess',
    action: 'suspendOrganization',
    userId: String(userId),
    organizationId: organization.id,
  });

  revalidatePath('/platform-admin/organizations');
  revalidatePath(`/org/${organization.slug}`);

  return { success: true };
}

export async function unsuspendOrganizationAction(data: { organizationId: string }) {
  const userId = await requirePlatformAdmin();
  const organization = await getOrganizationOrThrow(data.organizationId);

  if (!organization.suspended_at) {
    return { success: true, alreadyActive: true };
  }

  await prisma.organization.update({
    where: { id: organization.id },
    data: {
      suspended_at: null,
      suspended_by: null,
      suspend_reason: null,
    },
  });

  logger.info(`Organization unsuspended: ${organization.name}`, {
    module: 'OrganizationAccess',
    action: 'unsuspendOrganization',
    userId: String(userId),
    organizationId: organization.id,
  });

  revalidatePath('/platform-admin/organizations');
  revalidatePath(`/org/${organization.slug}`);

  return { success: true };
}

export async function getOrganizationDeletionPreviewAction(data: { organizationId: string }) {
  await requirePlatformAdmin();
  const organization = await getOrganizationOrThrow(data.organizationId);

  const workspaces = await prisma.workspace.findMany({
    where: { organization_id: organization.id },
    select: {
      id: true,
      name: true,
      _count: { select: { projects: true, members: true } },
    },
  });

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      suspendedAt: organization.suspended_at?.toISOString() ?? null,
    },
    workspaceCount: workspaces.length,
    projectCount: workspaces.reduce((sum, ws) => sum + ws._count.projects, 0),
    memberCount: workspaces.reduce((sum, ws) => sum + ws._count.members, 0),
  };
}

export async function deleteOrganizationAction(data: {
  organizationId: string;
  confirmSlug: string;
}) {
  const userId = await requirePlatformAdmin();
  const organization = await getOrganizationOrThrow(data.organizationId);

  if (data.confirmSlug?.trim() !== organization.slug) {
    throw new AppError(
      'Confirmation does not match the organization slug',
      ErrorCodes.VALIDATION
    );
  }

  // Workspaces, projects, members, invitations and join requests all cascade
  // from the organization (see prisma/schema.prisma).
  await prisma.organization.delete({ where: { id: organization.id } });

  logger.warn(`Organization deleted: ${organization.name} (${organization.slug})`, {
    module: 'OrganizationAccess',
    action: 'deleteOrganization',
    userId: String(userId),
    organizationId: organization.id,
  });

  revalidatePath('/platform-admin/organizations');

  return { success: true };
}

export async function suspendOrganizationMemberAction(data: {
  organizationId: string;
  targetUserId: number;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new AppError('Unauthorized: Please sign in', ErrorCodes.UNAUTHORIZED);
  }
  const userId = Number((session.user as any).id);
  await requireOrganizationAdmin(data.organizationId, userId);

  if (data.targetUserId === userId) {
    throw new AppError('You cannot suspend your own access', ErrorCodes.VALIDATION);
  }

  const target = await prisma.organizationMember.findUnique({
    where: {
      organization_id_user_id: {
        organization_id: data.organizationId,
        user_id: data.targetUserId,
      },
    },
    select: { role: true, suspended_at: true },
  });

  if (!target) {
    throw new AppError('Member not found in this organization', ErrorCodes.NOT_FOUND);
  }

  if (target.role === 'OWNER') {
    throw new AppError('The organization owner cannot be suspended', ErrorCodes.VALIDATION);
  }

  if (target.suspended_at) {
    return { success: true, alreadySuspended: true };
  }

  await prisma.organizationMember.update({
    where: {
      organization_id_user_id: {
        organization_id: data.organizationId,
        user_id: data.targetUserId,
      },
    },
    data: { suspended_at: new Date(), suspended_by: userId },
  });

  logger.info(`Organization member suspended (user ${data.targetUserId})`, {
    module: 'OrganizationAccess',
    action: 'suspendOrganizationMember',
    userId: String(userId),
    organizationId: data.organizationId,
  });

  revalidatePath('/platform-admin/organizations');

  const organization = await prisma.organization.findUnique({
    where: { id: data.organizationId },
    select: { slug: true },
  });
  if (organization) revalidatePath(`/org/${organization.slug}/members`);

  return { success: true };
}

export async function unsuspendOrganizationMemberAction(data: {
  organizationId: string;
  targetUserId: number;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new AppError('Unauthorized: Please sign in', ErrorCodes.UNAUTHORIZED);
  }
  const userId = Number((session.user as any).id);
  await requireOrganizationAdmin(data.organizationId, userId);

  const target = await prisma.organizationMember.findUnique({
    where: {
      organization_id_user_id: {
        organization_id: data.organizationId,
        user_id: data.targetUserId,
      },
    },
    select: { suspended_at: true },
  });

  if (!target) {
    throw new AppError('Member not found in this organization', ErrorCodes.NOT_FOUND);
  }

  if (!target.suspended_at) {
    return { success: true, alreadyActive: true };
  }

  await prisma.organizationMember.update({
    where: {
      organization_id_user_id: {
        organization_id: data.organizationId,
        user_id: data.targetUserId,
      },
    },
    data: { suspended_at: null, suspended_by: null },
  });

  logger.info(`Organization member unsuspended (user ${data.targetUserId})`, {
    module: 'OrganizationAccess',
    action: 'unsuspendOrganizationMember',
    userId: String(userId),
    organizationId: data.organizationId,
  });

  const organization = await prisma.organization.findUnique({
    where: { id: data.organizationId },
    select: { slug: true },
  });
  if (organization) revalidatePath(`/org/${organization.slug}/members`);

  return { success: true };
}
