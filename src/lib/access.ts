import { prisma } from '@/lib/db';
import { AppError, ErrorCodes } from '@/lib/errors';

/**
 * Organization / member access suspension.
 *
 * Suspension is enforced per request against the database (no caching), so a
 * suspended organization or member loses access immediately for every user,
 * including the organization owner. Nothing is deleted, so unsuspending
 * restores access exactly as it was.
 */

export type SuspensionKind = 'ORG' | 'MEMBER';

export interface SuspensionInfo {
  kind: SuspensionKind;
  organizationId: string;
  organizationName: string;
  reason: string | null;
}

export class AccessSuspendedError extends AppError {
  readonly suspension: SuspensionInfo;

  constructor(suspension: SuspensionInfo) {
    super(
      suspension.kind === 'ORG'
        ? 'Organization suspended: access is disabled for all members'
        : 'Access suspended: your organization membership is suspended',
      ErrorCodes.FORBIDDEN,
      {
        details: {
          kind: suspension.kind === 'ORG' ? 'ORG_SUSPENDED' : 'MEMBER_SUSPENDED',
          organizationId: suspension.organizationId,
        },
      }
    );
    this.name = 'AccessSuspendedError';
    this.suspension = suspension;
  }
}

export async function getOrgSuspension(
  userId: number,
  organizationId: string
): Promise<SuspensionInfo | null> {
  const [org, member] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, suspended_at: true, suspend_reason: true },
    }),
    prisma.organizationMember.findUnique({
      where: {
        organization_id_user_id: { organization_id: organizationId, user_id: userId },
      },
      select: { suspended_at: true },
    }),
  ]);

  if (!org) return null;

  if (org.suspended_at) {
    return {
      kind: 'ORG',
      organizationId: org.id,
      organizationName: org.name,
      reason: org.suspend_reason,
    };
  }

  if (member?.suspended_at) {
    return {
      kind: 'MEMBER',
      organizationId: org.id,
      organizationName: org.name,
      reason: null,
    };
  }

  return null;
}

export async function getWorkspaceSuspension(
  userId: number,
  workspaceId: string
): Promise<SuspensionInfo | null> {
  // One round-trip: the caller's organization membership for the organization
  // that owns this workspace carries both suspension flags.
  const member = await prisma.organizationMember.findFirst({
    where: {
      user_id: userId,
      organization: { workspaces: { some: { id: workspaceId } } },
    },
    select: {
      suspended_at: true,
      organization: {
        select: { id: true, name: true, suspended_at: true, suspend_reason: true },
      },
    },
  });

  const org = member?.organization;
  if (!org) return null;

  if (org.suspended_at) {
    return {
      kind: 'ORG',
      organizationId: org.id,
      organizationName: org.name,
      reason: org.suspend_reason,
    };
  }

  if (member.suspended_at) {
    return {
      kind: 'MEMBER',
      organizationId: org.id,
      organizationName: org.name,
      reason: null,
    };
  }

  return null;
}

export async function getProjectSuspension(
  userId: number,
  projectId: string
): Promise<SuspensionInfo | null> {
  // One round-trip: find the caller's organization membership for the
  // organization that owns this project.
  const member = await prisma.organizationMember.findFirst({
    where: {
      user_id: userId,
      organization: {
        workspaces: {
          some: { projects: { some: { id: projectId } } },
        },
      },
    },
    select: {
      suspended_at: true,
      organization: {
        select: { id: true, name: true, suspended_at: true, suspend_reason: true },
      },
    },
  });

  const org = member?.organization;
  if (!org) return null;

  if (org.suspended_at) {
    return {
      kind: 'ORG',
      organizationId: org.id,
      organizationName: org.name,
      reason: org.suspend_reason,
    };
  }

  if (member.suspended_at) {
    return {
      kind: 'MEMBER',
      organizationId: org.id,
      organizationName: org.name,
      reason: null,
    };
  }

  return null;
}

/**
 * Resolver helper: returns suspension info when the user has no usable
 * organization access left (all their org memberships are suspended or belong
 * to suspended organizations). Returns null when at least one active
 * membership exists.
 */
export async function getUserSuspension(userId: number): Promise<SuspensionInfo | null> {
  const memberships = await prisma.organizationMember.findMany({
    where: { user_id: userId },
    select: {
      suspended_at: true,
      organization: {
        select: { id: true, name: true, suspended_at: true, suspend_reason: true },
      },
    },
  });

  if (memberships.length === 0) return null;

  const hasActive = memberships.some(
    (m) => !m.suspended_at && !m.organization.suspended_at
  );
  if (hasActive) return null;

  const orgSuspended = memberships.find((m) => m.organization.suspended_at);
  if (orgSuspended) {
    return {
      kind: 'ORG',
      organizationId: orgSuspended.organization.id,
      organizationName: orgSuspended.organization.name,
      reason: orgSuspended.organization.suspend_reason,
    };
  }

  const member = memberships.find((m) => m.suspended_at);
  if (member) {
    return {
      kind: 'MEMBER',
      organizationId: member.organization.id,
      organizationName: member.organization.name,
      reason: null,
    };
  }

  return null;
}

export async function assertOrgAccess(userId: number, organizationId: string): Promise<void> {
  const suspension = await getOrgSuspension(userId, organizationId);
  if (suspension) throw new AccessSuspendedError(suspension);
}

export async function assertWorkspaceAccess(userId: number, workspaceId: string): Promise<void> {
  const suspension = await getWorkspaceSuspension(userId, workspaceId);
  if (suspension) throw new AccessSuspendedError(suspension);
}

export async function assertProjectAccess(userId: number, projectId: string): Promise<void> {
  const suspension = await getProjectSuspension(userId, projectId);
  if (suspension) throw new AccessSuspendedError(suspension);
}

export function isAccessSuspendedError(error: unknown): error is AccessSuspendedError {
  return error instanceof AccessSuspendedError;
}
