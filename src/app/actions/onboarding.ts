'use server';

import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { issueEmailVerification } from '@/lib/auth/verification';
import type { SuspensionInfo } from '@/lib/access';

export type OnboardingDestination =
  | 'WORKSPACE'
  | 'INVITE'
  | 'WAITING'
  | 'REQUEST_ACCESS'
  | 'NO_ORG'
  | 'VERIFY_EMAIL'
  | 'SUSPENDED';

export interface PendingInvitationInfo {
  token: string;
  organizationName: string;
  workspaceName: string;
  workspaceSlug: string | null;
  role: string;
  kind: 'organization' | 'workspace';
}

export interface PendingRequestInfo {
  id: string;
  organizationName: string;
  note: string | null;
  kind: 'organization' | 'workspace';
}

export interface OnboardingResolution {
  destination: OnboardingDestination;
  userEmail: string;
  userName: string;
  domain: string;
  isApproved: boolean;
  emailVerified: boolean;
  pendingInvitation: PendingInvitationInfo | null;
  pendingRequest: PendingRequestInfo | null;
  matchedOrganization: { id: string; name: string; domain: string } | null;
  suspension: SuspensionInfo | null;
}

async function getSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  return {
    userId,
    email: session.user.email.toLowerCase().trim(),
    name: session.user.name || session.user.email.split('@')[0],
  };
}

async function resolveForUser(
  userId: number,
  userEmail: string,
  userName: string
): Promise<OnboardingResolution> {
  const domain = userEmail.split('@')[1] || '';

  const [dbUser, workspaceMemberships, orgMemberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { is_approved: true, email_verified: true, name: true },
    }),
    prisma.workspaceMember.findMany({
      where: { user_id: userId },
      select: {
        workspace: {
          select: {
            organization_id: true,
            organization: {
              select: { id: true, name: true, suspended_at: true, suspend_reason: true },
            },
          },
        },
      },
    }),
    prisma.organizationMember.findMany({
      where: { user_id: userId },
      select: {
        suspended_at: true,
        organization: {
          select: { id: true, name: true, suspended_at: true, suspend_reason: true },
        },
      },
    }),
  ]);

  const isApproved = Boolean(dbUser?.is_approved);
  const emailVerified = Boolean(dbUser?.email_verified);

  const base: OnboardingResolution = {
    destination: 'NO_ORG',
    userEmail,
    userName: dbUser?.name || userName,
    domain,
    isApproved,
    emailVerified,
    pendingInvitation: null,
    pendingRequest: null,
    matchedOrganization: null,
    suspension: null,
  };

  // 1. Existing members always land in their workspace, unless access is
  //    suspended at the organization or membership level.
  const activeOrgIds = new Set(
    orgMemberships
      .filter((m) => !m.suspended_at && !m.organization.suspended_at)
      .map((m) => m.organization.id)
  );

  const hasUsableWorkspace = workspaceMemberships.some(
    (wm) =>
      !wm.workspace.organization_id || activeOrgIds.has(wm.workspace.organization_id)
  );

  if (hasUsableWorkspace || activeOrgIds.size > 0) {
    return { ...base, destination: 'WORKSPACE' };
  }

  // 1b. No usable access left: surface the suspension reason instead of
  //     pretending the user has no organization.
  const suspendedOrg =
    orgMemberships.find((m) => m.organization.suspended_at)?.organization ||
    workspaceMemberships.find((wm) => wm.workspace.organization?.suspended_at)?.workspace
      .organization;

  if (suspendedOrg) {
    return {
      ...base,
      destination: 'SUSPENDED',
      suspension: {
        kind: 'ORG',
        organizationId: suspendedOrg.id,
        organizationName: suspendedOrg.name,
        reason: suspendedOrg.suspend_reason,
      },
    };
  }

  const suspendedMember = orgMemberships.find((m) => m.suspended_at);
  if (suspendedMember) {
    return {
      ...base,
      destination: 'SUSPENDED',
      suspension: {
        kind: 'MEMBER',
        organizationId: suspendedMember.organization.id,
        organizationName: suspendedMember.organization.name,
        reason: null,
      },
    };
  }

  // 2. Pending invitation for this email wins over any access request.
  const [orgInvitation, workspaceInvitation] = await Promise.all([
    prisma.organizationInvitation.findFirst({
      where: {
        email: { equals: userEmail, mode: 'insensitive' },
        status: 'PENDING',
        expires_at: { gt: new Date() },
        organization: { suspended_at: null },
      },
      include: { organization: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
    }),
    prisma.invitation.findFirst({
      where: {
        email: { equals: userEmail, mode: 'insensitive' },
        status: 'PENDING',
        expires_at: { gt: new Date() },
        OR: [
          { workspace: { organization_id: null } },
          { workspace: { organization: { suspended_at: null } } },
        ],
      },
      include: {
        workspace: {
          select: {
            name: true,
            slug: true,
            organization: { select: { name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  if (orgInvitation) {
    base.pendingInvitation = {
      token: orgInvitation.token,
      organizationName: orgInvitation.organization.name,
      workspaceName: orgInvitation.organization.name,
      workspaceSlug: null,
      role: orgInvitation.role,
      kind: 'organization',
    };
  } else if (workspaceInvitation) {
    base.pendingInvitation = {
      token: workspaceInvitation.token,
      organizationName:
        workspaceInvitation.workspace.organization?.name || workspaceInvitation.workspace.name,
      workspaceName: workspaceInvitation.workspace.name,
      workspaceSlug: workspaceInvitation.workspace.slug,
      role: workspaceInvitation.role,
      kind: 'workspace',
    };
  }

  // Invitations are hidden until the account email is verified.
  if (base.pendingInvitation) {
    return { ...base, destination: emailVerified ? 'INVITE' : 'VERIFY_EMAIL' };
  }

  // 3. Pending access request (organization request preferred, then workspace).
  const [orgRequest, wsRequest] = await Promise.all([
    prisma.organizationJoinRequest.findFirst({
      where: {
        user_id: userId,
        status: 'PENDING',
        organization: { suspended_at: null },
      },
      include: { organization: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
    }),
    prisma.workspaceJoinRequest.findFirst({
      where: {
        user_id: userId,
        status: 'PENDING',
        OR: [
          { workspace: { organization_id: null } },
          { workspace: { organization: { suspended_at: null } } },
        ],
      },
      include: {
        workspace: {
          select: { name: true, organization: { select: { name: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  if (orgRequest) {
    base.pendingRequest = {
      id: orgRequest.id,
      organizationName: orgRequest.organization.name,
      note: orgRequest.message,
      kind: 'organization',
    };
    return { ...base, destination: 'WAITING' };
  }

  if (wsRequest) {
    base.pendingRequest = {
      id: wsRequest.id,
      organizationName: wsRequest.workspace.organization?.name || wsRequest.workspace.name,
      note: wsRequest.message,
      kind: 'workspace',
    };
    return { ...base, destination: 'WAITING' };
  }

  // 4. Corporate domain match.
  const matchedOrg = await prisma.organization.findFirst({
    where: {
      domain_join_enabled: true,
      allowed_domains: { has: domain },
      suspended_at: null,
    },
    select: { id: true, name: true },
  });

  if (matchedOrg) {
    base.matchedOrganization = {
      id: matchedOrg.id,
      name: matchedOrg.name,
      domain,
    };
    return {
      ...base,
      destination: emailVerified ? 'REQUEST_ACCESS' : 'VERIFY_EMAIL',
    };
  }

  // No organization matches this domain. Unverified password accounts must
  // still finish email verification first (the screen offers resend + recheck).
  return {
    ...base,
    destination: emailVerified ? 'NO_ORG' : 'VERIFY_EMAIL',
  };
}

export async function resolveOnboardingAction(): Promise<OnboardingResolution> {
  const { userId, email, name } = await getSessionUser();
  return resolveForUser(userId, email, name);
}

export async function checkApprovalStatusAction(): Promise<{
  approved: boolean;
  resolution: OnboardingResolution;
}> {
  const { userId, email, name } = await getSessionUser();
  const resolution = await resolveForUser(userId, email, name);

  if (resolution.destination === 'WORKSPACE') {
    return { approved: true, resolution };
  }

  if (resolution.destination === 'SUSPENDED') {
    return { approved: false, resolution };
  }

  const [orgRequest, wsRequest] = await Promise.all([
    prisma.organizationJoinRequest.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { status: true },
    }),
    prisma.workspaceJoinRequest.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { status: true },
    }),
  ]);

  const approved =
    orgRequest?.status === 'APPROVED' || wsRequest?.status === 'APPROVED';

  if (approved) {
    revalidatePath('/pending');
  }

  return { approved, resolution };
}

export async function resendVerificationEmailAction(): Promise<{
  success: boolean;
  error?: string;
}> {
  const { userId } = await getSessionUser();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, email_verified: true },
  });

  if (!user) throw new Error('User not found');
  if (user.email_verified) return { success: true };

  const result = await issueEmailVerification(user);
  if (!result.sent) {
    return { success: false, error: result.error || 'Could not send verification email' };
  }
  return { success: true };
}
