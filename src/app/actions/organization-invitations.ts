'use server';

import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import type { WorkspaceRole } from '@prisma/client';
import { sendEmail } from '@/lib/email/send';
import { inviteWorkspaceTemplate } from '@/lib/email/templates/inviteWorkspace';
import { generateWorkspaceId } from '@/lib/ids';
import { checkIsPlatformAdmin } from '@/lib/auth/org-role';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';
import { getBaseUrl } from '@/lib/config';
import { closePendingAccessRequests } from '@/lib/join-requests';

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'yandex.com',
  'mail.com',
  'gmx.com',
]);

async function getSessionUserId(): Promise<number> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized: Please sign in');
  return (session.user as any).id as number;
}

async function requireOrganizationAdmin(organizationId: string, userId: number) {
  const isPlatAdmin = await checkIsPlatformAdmin(userId);
  if (isPlatAdmin) return { role: 'OWNER' as WorkspaceRole };

  const suspendedOrg = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { suspended_at: true },
  });
  if (suspendedOrg?.suspended_at) {
    throw new Error('Forbidden: organization is suspended');
  }

  const orgMember = await prisma.organizationMember.findUnique({
    where: {
      organization_id_user_id: {
        organization_id: organizationId,
        user_id: userId,
      },
    },
  });

  if (orgMember?.suspended_at) {
    throw new Error('Forbidden: your organization access is suspended');
  }

  if (orgMember && (orgMember.role === 'OWNER' || orgMember.role === 'ADMIN')) {
    return orgMember;
  }

  // Fallback check: if user is OWNER or ADMIN of a workspace in this organization
  const wsAdmin = await prisma.workspaceMember.findFirst({
    where: {
      user_id: userId,
      role: { in: ['OWNER', 'ADMIN'] },
      workspace: { organization_id: organizationId },
    },
  });

  if (wsAdmin) return { role: wsAdmin.role };

  throw new Error('Forbidden: Only Organization or Workspace Admins can perform this action');
}

function generateCuid(): string {
  return 'c' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

// ============================================================================
// 1. SHARED INVITE DIALOG HELPERS & ACTIONS
// ============================================================================

export async function getOrganizationWorkspacesAndProjectsAction(organizationIdOrSlug: string) {
  const userId = await getSessionUserId();

  const organization = await prisma.organization.findFirst({
    where: {
      OR: [{ id: organizationIdOrSlug }, { slug: organizationIdOrSlug }],
    },
    select: { id: true, name: true, slug: true },
  });

  if (!organization) throw new Error('Organization not found');
  await requireOrganizationAdmin(organization.id, userId);

  const workspaces = await prisma.workspace.findMany({
    where: { organization_id: organization.id },
    select: { id: true, name: true, slug: true },
    orderBy: { created_at: 'asc' },
  });

  const wsIds = workspaces.map((w) => w.id);
  const projects =
    wsIds.length > 0
      ? await prisma.project.findMany({
          where: { workspace_id: { in: wsIds }, deleted_at: null },
          select: { id: true, name: true, workspace_id: true },
          orderBy: { created_at: 'desc' },
        })
      : [];

  return {
    organization,
    workspaces,
    projects,
  };
}

export async function createOrganizationInvitationAction(data: {
  organizationIdOrSlug: string;
  email: string;
  role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  workspaceGrants?: { workspaceId: string; role: 'ADMIN' | 'MEMBER' | 'GUEST' }[];
  projectAssignments?: { projectId: string; role: 'ADMIN' | 'TESTER' | 'VIEWER' }[];
}) {
  const userId = await getSessionUserId();

  const organization = await prisma.organization.findFirst({
    where: {
      OR: [{ id: data.organizationIdOrSlug }, { slug: data.organizationIdOrSlug }],
    },
    select: { id: true, name: true, slug: true },
  });

  if (!organization) throw new Error('Organization not found');

  await requireOrganizationAdmin(organization.id, userId);

  const normalizedEmail = data.email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Please enter a valid email address');
  }

  // 1-Org-Per-User Invariant: Check if email already belongs to ANOTHER organization
  const otherOrgMembership = await prisma.organizationMember.findFirst({
    where: {
      organization_id: { not: organization.id },
      user: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    },
    include: { organization: { select: { name: true } } },
  });

  if (otherOrgMembership) {
    throw new Error(
      `This email already belongs to another organization (${otherOrgMembership.organization.name}). Each account is scoped to a single organization.`
    );
  }

  // Check if email has a pending invite to ANOTHER organization
  const otherPendingInvRows = await prisma.$queryRaw<{ org_name: string }[]>`
    SELECT o.name as org_name
    FROM "OrganizationInvitation" i
    JOIN "Organization" o ON o.id = i.organization_id
    WHERE i.organization_id != ${organization.id}
      AND LOWER(i.email) = ${normalizedEmail}
      AND i.status = 'PENDING'::"InvitationStatus"
      AND i.expires_at > NOW()
    LIMIT 1
  `;
  if (otherPendingInvRows.length > 0) {
    throw new Error(
      `This email already has an active pending invitation to ${otherPendingInvRows[0].org_name}.`
    );
  }

  // Validate that all granted workspaces belong to this organization
  if (data.workspaceGrants && data.workspaceGrants.length > 0) {
    const wsIds = data.workspaceGrants.map((g) => g.workspaceId);
    const validCount = await prisma.workspace.count({
      where: { id: { in: wsIds }, organization_id: organization.id },
    });
    if (validCount !== wsIds.length) {
      throw new Error('Forbidden: One or more selected workspaces do not belong to this organization');
    }
  }

  // Check if user is already an Organization Member of THIS organization
  const existingOrgMember = await prisma.organizationMember.findFirst({
    where: {
      organization_id: organization.id,
      user: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    },
  });

  if (existingOrgMember) {
    throw new Error('This user is already a member of this organization');
  }

  const invId = generateCuid();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const role = data.role || 'MEMBER';
  const projectAssignmentsJson = JSON.stringify(data.projectAssignments || []);

  await prisma.$transaction(async (tx) => {
    // Delete any previous pending/revoked invitation for this email in this org
    await tx.$executeRaw`
      DELETE FROM "OrganizationInvitation"
      WHERE organization_id = ${organization.id}
        AND LOWER(email) = ${normalizedEmail}
        AND status IN ('PENDING'::"InvitationStatus", 'REJECTED'::"InvitationStatus")
    `;

    await tx.$executeRaw`
      INSERT INTO "OrganizationInvitation" (id, organization_id, email, role, token, invited_by, status, project_assignments, expires_at, created_at)
      VALUES (${invId}, ${organization.id}, ${normalizedEmail}, ${role}::"WorkspaceRole", ${token}, ${userId}, 'PENDING'::"InvitationStatus", ${projectAssignmentsJson}::jsonb, ${expiresAt}, NOW())
    `;

    if (data.workspaceGrants && data.workspaceGrants.length > 0) {
      for (const g of data.workspaceGrants) {
        const grantId = generateCuid();
        const wsRole = (g.role as WorkspaceRole) || 'MEMBER';
        await (tx as any).organizationInvitationWorkspaceGrant.create({
          data: {
            id: grantId,
            invitation_id: invId,
            workspace_id: g.workspaceId,
            role: wsRole,
          },
        });
      }
    }
  });

  // Send invitation email
  try {
    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    const inviteData = inviteWorkspaceTemplate(
      normalizedEmail.split('@')[0],
      organization.name,
      `${getBaseUrl()}/invite?token=${token}`,
      inviter?.name || 'An administrator',
      role.toLowerCase()
    );

    await sendEmail({
      to: [normalizedEmail],
      subject: inviteData.subject,
      htmlBody: inviteData.html,
      textBody: inviteData.text,
    });
  } catch (e: any) {
    logger.error('Failed to send organization invite email', {
      module: 'OrgInvite',
      action: 'createOrganizationInvitation',
      organizationId: organization.id,
      email: normalizedEmail,
      errorCode: ErrorCodes.EMAIL_SEND,
      error: e,
    });
  }

  revalidatePath(`/org/${organization.slug}/invitations`);

  return {
    id: invId,
    token,
    email: normalizedEmail,
    role,
    status: 'PENDING',
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    workspaceGrants: data.workspaceGrants || [],
  };
}

export async function getOrganizationInvitationsAction(organizationIdOrSlug: string) {
  const userId = await getSessionUserId();

  const organization = await prisma.organization.findFirst({
    where: {
      OR: [{ id: organizationIdOrSlug }, { slug: organizationIdOrSlug }],
    },
    select: { id: true, name: true, slug: true },
  });

  if (!organization) throw new Error('Organization not found');

  await requireOrganizationAdmin(organization.id, userId);

  const invitations = await prisma.$queryRaw<
    {
      id: string;
      email: string;
      role: string;
      status: string;
      token: string;
      expires_at: Date;
      created_at: Date;
      accepted_at: Date | null;
    }[]
  >`
    SELECT id, email, role::text as role, status::text as status, token, expires_at, created_at, accepted_at
    FROM "OrganizationInvitation"
    WHERE organization_id = ${organization.id}
      AND status = 'PENDING'::"InvitationStatus"
    ORDER BY created_at DESC
  `;

  if (invitations.length === 0) return [];

  const invIds = invitations.map((i) => i.id);
  const grants = await (prisma as any).organizationInvitationWorkspaceGrant.findMany({
    where: { invitation_id: { in: invIds } },
    include: {
      workspace: {
        select: { id: true, name: true, slug: true },
      },
    },
  });

  return invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    token: inv.token,
    expiresAt: new Date(inv.expires_at).toISOString(),
    createdAt: new Date(inv.created_at).toISOString(),
    acceptedAt: inv.accepted_at ? new Date(inv.accepted_at).toISOString() : null,
    workspaceGrants: grants
      .filter((g: any) => g.invitation_id === inv.id)
      .map((g: any) => ({
        workspaceId: g.workspace_id,
        workspaceName: g.workspace?.name || 'Workspace',
        workspaceSlug: g.workspace?.slug || '',
        role: g.role,
      })),
  }));
}

export async function resendOrganizationInvitationAction(invitationId: string) {
  const userId = await getSessionUserId();

  const rows = await prisma.$queryRaw<
    {
      id: string;
      organization_id: string;
      email: string;
      role: string;
      org_name: string;
      org_slug: string;
    }[]
  >`
    SELECT i.id, i.organization_id, i.email, i.role::text as role, o.name as org_name, o.slug as org_slug
    FROM "OrganizationInvitation" i
    JOIN "Organization" o ON o.id = i.organization_id
    WHERE i.id = ${invitationId}
  `;

  const invitation = rows[0];
  if (!invitation) throw new Error('Invitation not found');

  await requireOrganizationAdmin(invitation.organization_id, userId);

  // Rotate cryptographic token and reset 7-day expiry
  const newToken = crypto.randomUUID();
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.$executeRaw`
    UPDATE "OrganizationInvitation"
    SET token = ${newToken},
        status = 'PENDING'::"InvitationStatus",
        expires_at = ${newExpiresAt}
    WHERE id = ${invitationId}
  `;

  try {
    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    const inviteData = inviteWorkspaceTemplate(
      invitation.email.split('@')[0],
      invitation.org_name,
      `${getBaseUrl()}/invite?token=${newToken}`,
      inviter?.name || 'An administrator',
      invitation.role.toLowerCase()
    );

    await sendEmail({
      to: [invitation.email],
      subject: inviteData.subject,
      htmlBody: inviteData.html,
      textBody: inviteData.text,
    });
  } catch (e: any) {
    logger.error('Failed to resend organization invite email', {
      module: 'OrgInvite',
      action: 'resendOrganizationInvitation',
      invitationId,
      email: invitation.email,
      errorCode: ErrorCodes.EMAIL_SEND,
      error: e,
    });
  }

  revalidatePath(`/org/${invitation.org_slug}/invitations`);

  return {
    success: true,
    token: newToken,
    expiresAt: newExpiresAt.toISOString(),
    status: 'PENDING' as const,
  };
}

export async function revokeOrganizationInvitationAction(invitationId: string) {
  const userId = await getSessionUserId();

  const rows = await prisma.$queryRaw<{ id: string; organization_id: string; org_slug: string }[]>`
    SELECT i.id, i.organization_id, o.slug as org_slug
    FROM "OrganizationInvitation" i
    JOIN "Organization" o ON o.id = i.organization_id
    WHERE i.id = ${invitationId}
  `;
  const invitation = rows[0];

  if (!invitation) throw new Error('Invitation not found');

  await requireOrganizationAdmin(invitation.organization_id, userId);

  await prisma.$executeRaw`
    UPDATE "OrganizationInvitation"
    SET status = 'REJECTED'::"InvitationStatus"
    WHERE id = ${invitationId}
  `;

  revalidatePath(`/org/${invitation.org_slug}/invitations`);
  return { success: true };
}

export async function acceptOrganizationInvitationAction(token: string) {
  const userId = await getSessionUserId();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const invRows = await prisma.$queryRaw<
    {
      id: string;
      organization_id: string;
      email: string;
      role: string;
      status: string;
      project_assignments: any;
      expires_at: Date;
      org_name: string;
      org_slug: string;
    }[]
  >`
    SELECT i.id, i.organization_id, i.email, i.role::text as role, i.status::text as status,
           i.project_assignments, i.expires_at, o.name as org_name, o.slug as org_slug
    FROM "OrganizationInvitation" i
    JOIN "Organization" o ON o.id = i.organization_id
    WHERE i.token = ${token}
  `;

  const invitation = invRows[0];
  if (!invitation) throw new Error('Invitation not found or invalid');
  if (invitation.status !== 'PENDING') throw new Error('This invitation is no longer active');
  if (new Date(invitation.expires_at) < new Date()) throw new Error('This invitation has expired');

  if (invitation.email.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
    throw new Error('This invitation was sent to a different email address. Please sign in with the invited email.');
  }

  const invitingOrg = await prisma.organization.findUnique({
    where: { id: invitation.organization_id },
    select: { suspended_at: true },
  });
  if (invitingOrg?.suspended_at) {
    throw new Error('This organization is suspended. Ask a platform administrator to restore access.');
  }

  // Enforce 1-org-per-user invariant
  const otherOrgMember = await prisma.organizationMember.findFirst({
    where: {
      user_id: userId,
      organization_id: { not: invitation.organization_id },
    },
    include: { organization: { select: { name: true } } },
  });
  if (otherOrgMember) {
    throw new Error(
      `Your account already belongs to ${otherOrgMember.organization.name}. Each user account is scoped to a single organization.`
    );
  }

  const grants = await prisma.$queryRaw<{ workspace_id: string; role: string; slug: string }[]>`
    SELECT g.workspace_id, g.role::text as role, w.slug
    FROM "OrganizationInvitationWorkspaceGrant" g
    JOIN "Workspace" w ON w.id = g.workspace_id
    WHERE g.invitation_id = ${invitation.id}
  `;

  const projectAssignments = Array.isArray(invitation.project_assignments)
    ? (invitation.project_assignments as { projectId: string; role: 'ADMIN' | 'TESTER' | 'VIEWER' }[])
    : [];

  await prisma.$transaction(async (tx) => {
    // 1. Mark invitation accepted
    await tx.$executeRaw`
      UPDATE "OrganizationInvitation"
      SET status = 'ACCEPTED'::"InvitationStatus", accepted_at = NOW()
      WHERE id = ${invitation.id}
    `;

    // 2. Mark user approved and verified (the emailed token proves ownership)
    await tx.user.update({
      where: { id: userId },
      data: {
        is_approved: true,
        email_verified: true,
        email_verification_token: null,
        email_verification_expires: null,
      },
    });

    // The invitation wins over any request the user had already submitted.
    await closePendingAccessRequests(tx, userId, invitation.organization_id);

    // 3. Add to OrganizationMember
    const existingOrgMember = await tx.organizationMember.findUnique({
      where: {
        organization_id_user_id: {
          organization_id: invitation.organization_id,
          user_id: userId,
        },
      },
    });

    if (!existingOrgMember) {
      await tx.organizationMember.create({
        data: {
          organization_id: invitation.organization_id,
          user_id: userId,
          role: invitation.role as WorkspaceRole,
        },
      });
    }

    // 4. Provision granted workspaces
    for (const grant of grants) {
      const existingWsMember = await tx.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: grant.workspace_id,
            user_id: userId,
          },
        },
      });

      if (!existingWsMember) {
        await tx.workspaceMember.create({
          data: {
            workspace_id: grant.workspace_id,
            user_id: userId,
            role: grant.role as WorkspaceRole,
          },
        });
      }
    }

    // 5. Provision pre-assigned projects
    for (const p of projectAssignments) {
      if (!p.projectId) continue;
      const existingProj = await tx.projectMember.findUnique({
        where: {
          project_id_user_id: {
            project_id: p.projectId,
            user_id: userId,
          },
        },
      });
      if (!existingProj) {
        await tx.projectMember.create({
          data: {
            project_id: p.projectId,
            user_id: userId,
            role: p.role || 'TESTER',
          },
        });
      }
    }
  });

  revalidatePath('/workspace');
  revalidatePath('/projects');

  return {
    success: true,
    organizationName: invitation.org_name,
    organizationSlug: invitation.org_slug,
    firstWorkspaceSlug: grants[0]?.slug || null,
  };
}

// ============================================================================
// 2. ORGANIZATION DOMAINS (Single Source of Truth in /org/[slug]/domains)
// ============================================================================

export async function getOrganizationDomainsAction(organizationIdOrSlug: string) {
  const userId = await getSessionUserId();

  const org = await prisma.organization.findFirst({
    where: {
      OR: [{ id: organizationIdOrSlug }, { slug: organizationIdOrSlug }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      allowed_domains: true,
      domain_join_enabled: true,
    },
  });

  if (!org) throw new Error('Organization not found');
  await requireOrganizationAdmin(org.id, userId);

  return {
    organizationId: org.id,
    organizationName: org.name,
    organizationSlug: org.slug,
    domains: org.allowed_domains,
    allowDomainRequests: org.domain_join_enabled,
  };
}

export async function updateOrganizationDomainsAction(data: {
  organizationIdOrSlug: string;
  domains: string[];
  allowDomainRequests: boolean;
}) {
  const userId = await getSessionUserId();

  const org = await prisma.organization.findFirst({
    where: {
      OR: [{ id: data.organizationIdOrSlug }, { slug: data.organizationIdOrSlug }],
    },
    select: { id: true, slug: true },
  });

  if (!org) throw new Error('Organization not found');
  await requireOrganizationAdmin(org.id, userId);

  const cleanedDomains = Array.from(
    new Set(
      data.domains
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean)
    )
  );

  for (const dom of cleanedDomains) {
    if (PUBLIC_EMAIL_DOMAINS.has(dom)) {
      throw new Error(`Public email domain "@${dom}" cannot be used for organization domain matching.`);
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) {
      throw new Error(`Invalid domain format: "${dom}"`);
    }
  }

  if (cleanedDomains.length > 0) {
    const conflictingOrg = await prisma.organization.findFirst({
      where: {
        id: { not: org.id },
        allowed_domains: { hasSome: cleanedDomains },
      },
      select: { name: true, allowed_domains: true },
    });

    if (conflictingOrg) {
      const overlap = cleanedDomains.filter((d) => conflictingOrg.allowed_domains.includes(d));
      throw new Error(
        `Domain(s) @${overlap.join(', @')} are already claimed by ${conflictingOrg.name}.`
      );
    }
  }

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: {
      allowed_domains: cleanedDomains,
      domain_join_enabled: data.allowDomainRequests,
    },
  });

  revalidatePath(`/org/${org.slug}/domains`);

  return {
    domains: updated.allowed_domains,
    allowDomainRequests: updated.domain_join_enabled,
  };
}

// ============================================================================
// 3. PLATFORM OWNER CONSOLE (/platform-admin/organizations)
// ============================================================================

export async function getPlatformOrganizationsAction() {
  const userId = await getSessionUserId();
  const isPlatAdmin = await checkIsPlatformAdmin(userId);
  if (!isPlatAdmin) {
    throw new Error('Forbidden: Platform Administrator access required');
  }

  const orgs = await prisma.organization.findMany({
    orderBy: { created_at: 'desc' },
    include: {
      workspaces: {
        select: { id: true, name: true, slug: true },
        orderBy: { created_at: 'asc' },
      },
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { created_at: 'asc' },
      },
    },
  });

  const pendingOwnerInvites = await prisma.$queryRaw<
    {
      id: string;
      organization_id: string;
      email: string;
      token: string;
      status: string;
      expires_at: Date;
    }[]
  >`
    SELECT id, organization_id, email, token, status::text as status, expires_at
    FROM "OrganizationInvitation"
    WHERE role = 'OWNER'::"WorkspaceRole"
      AND status = 'PENDING'::"InvitationStatus"
    ORDER BY created_at DESC
  `;

  return orgs.map((org) => {
    const ownerMember = org.members.find((m) => m.role === 'OWNER');
    const pendingOwnerInvite = pendingOwnerInvites.find((inv) => inv.organization_id === org.id);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      allowedDomains: org.allowed_domains,
      domainJoinEnabled: org.domain_join_enabled,
      createdAt: org.created_at.toISOString(),
      workspaces: org.workspaces,
      memberCount: org.members.length,
      suspendedAt: org.suspended_at ? org.suspended_at.toISOString() : null,
      suspendReason: org.suspend_reason,
      suspendedMemberCount: org.members.filter((m) => m.suspended_at).length,
      owner: ownerMember
        ? {
            email: ownerMember.user.email,
            name: ownerMember.user.name,
            status: 'ACTIVE' as const,
            inviteToken: null,
          }
        : pendingOwnerInvite
        ? {
            email: pendingOwnerInvite.email,
            name: null,
            status: new Date(pendingOwnerInvite.expires_at) > new Date() ? ('INVITED' as const) : ('EXPIRED' as const),
            inviteToken: pendingOwnerInvite.token,
            invitationId: pendingOwnerInvite.id,
          }
        : null,
    };
  });
}

export interface ProvisionOrgFieldErrors {
  name?: string;
  slug?: string;
  domain?: string;
  workspaceName?: string;
  ownerEmail?: string;
}

export async function createOrganizationByPlatformAdminAction(input: {
  name: string;
  slug: string;
  domain?: string;
  workspaceName: string;
  ownerEmail: string;
}): Promise<{
  ok: boolean;
  fieldErrors?: ProvisionOrgFieldErrors;
  organization?: { id: string; name: string; slug: string; inviteToken: string };
}> {
  const userId = await getSessionUserId();
  const isPlatAdmin = await checkIsPlatformAdmin(userId);
  if (!isPlatAdmin) {
    throw new Error('Forbidden: Platform Administrator access required');
  }

  const fieldErrors: ProvisionOrgFieldErrors = {};

  const orgName = input.name.trim();
  const orgSlug = input.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
  const rawDomain = (input.domain || '').trim().toLowerCase().replace(/^@/, '');
  const wsName = input.workspaceName.trim();
  const wsSlug = wsName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
  const ownerEmail = input.ownerEmail.trim().toLowerCase();

  if (!orgName) fieldErrors.name = 'Organization name is required.';
  if (!orgSlug) fieldErrors.slug = 'Organization slug is required.';
  if (!wsName || !wsSlug) fieldErrors.workspaceName = 'Initial workspace name is required.';
  if (!ownerEmail || !ownerEmail.includes('@')) {
    fieldErrors.ownerEmail = 'A valid owner email address is required.';
  }

  // 1. Check Organization name & slug collision
  if (orgName) {
    const existingOrgName = await prisma.organization.findFirst({
      where: { name: { equals: orgName, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (existingOrgName) {
      fieldErrors.name = `An organization named "${orgName}" already exists.`;
    }
  }

  if (orgSlug) {
    const existingOrgSlug = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true },
    });
    if (existingOrgSlug) {
      fieldErrors.slug = `Organization slug "/org/${orgSlug}" is already taken by ${existingOrgSlug.name}.`;
    }
  }

  // 2. Check Workspace slug collision
  if (wsSlug) {
    const existingWsSlug = await prisma.workspace.findUnique({
      where: { slug: wsSlug },
      select: { id: true, name: true },
    });
    if (existingWsSlug) {
      fieldErrors.workspaceName = `Workspace slug "/workspace/${wsSlug}" is already taken.`;
    }
  }

  // 3. Check Corporate Email Domain validity & collision
  if (rawDomain) {
    if (PUBLIC_EMAIL_DOMAINS.has(rawDomain)) {
      fieldErrors.domain = `Public email domain "@${rawDomain}" cannot be used for organization auto-matching.`;
    } else if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(rawDomain)) {
      fieldErrors.domain = `Invalid domain format "${rawDomain}".`;
    } else {
      const conflictingOrg = await prisma.organization.findFirst({
        where: { allowed_domains: { has: rawDomain } },
        select: { name: true },
      });
      if (conflictingOrg) {
        fieldErrors.domain = `Domain "@${rawDomain}" is already claimed by ${conflictingOrg.name}.`;
      }
    }
  }

  // 4. Enforce 1-Org-Per-User Invariant on ownerEmail
  if (ownerEmail && ownerEmail.includes('@')) {
    const existingOrgMembership = await prisma.organizationMember.findFirst({
      where: {
        user: { email: { equals: ownerEmail, mode: 'insensitive' } },
      },
      include: { organization: { select: { name: true } } },
    });

    if (existingOrgMembership) {
      fieldErrors.ownerEmail = `This email already belongs to "${existingOrgMembership.organization.name}". Each user account is scoped to a single organization.`;
    } else {
      const existingPendingInvite = await prisma.$queryRaw<{ org_name: string }[]>`
        SELECT o.name as org_name
        FROM "OrganizationInvitation" i
        JOIN "Organization" o ON o.id = i.organization_id
        WHERE LOWER(i.email) = ${ownerEmail}
          AND i.status = 'PENDING'::"InvitationStatus"
          AND i.expires_at > NOW()
        LIMIT 1
      `;
      if (existingPendingInvite.length > 0) {
        fieldErrors.ownerEmail = `This email already has an active pending invitation to "${existingPendingInvite[0].org_name}".`;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const wsId = await generateWorkspaceId();
  const invId = generateCuid();
  const grantId = generateCuid();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const createdOrg = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: orgName,
        slug: orgSlug,
        allowed_domains: rawDomain ? [rawDomain] : [],
        domain_join_enabled: Boolean(rawDomain),
      },
    });

    await tx.workspace.create({
      data: {
        id: wsId,
        organization_id: org.id,
        name: wsName,
        slug: wsSlug,
      },
    });

    await tx.$executeRaw`
      INSERT INTO "OrganizationInvitation" (id, organization_id, email, role, token, invited_by, status, project_assignments, expires_at, created_at)
      VALUES (${invId}, ${org.id}, ${ownerEmail}, 'OWNER'::"WorkspaceRole", ${token}, ${userId}, 'PENDING'::"InvitationStatus", '[]'::jsonb, ${expiresAt}, NOW())
    `;

    await tx.$executeRaw`
      INSERT INTO "OrganizationInvitationWorkspaceGrant" (id, invitation_id, workspace_id, role, created_at)
      VALUES (${grantId}, ${invId}, ${wsId}, 'OWNER'::"WorkspaceRole", NOW())
    `;

    return org;
  });

  // Dispatch owner invitation email
  try {
    const inviteData = inviteWorkspaceTemplate(
      ownerEmail.split('@')[0],
      createdOrg.name,
      `${getBaseUrl()}/invite?token=${token}`,
      'InkaTest Platform Admin',
      'owner'
    );
    await sendEmail({
      to: [ownerEmail],
      subject: inviteData.subject,
      htmlBody: inviteData.html,
      textBody: inviteData.text,
    });
  } catch (e: any) {
    logger.error('Failed to send platform owner invite email', {
      module: 'PlatformAdmin',
      action: 'createOrganizationByPlatformAdmin',
      organizationId: createdOrg.id,
      ownerEmail,
      errorCode: ErrorCodes.EMAIL_SEND,
      error: e,
    });
  }

  revalidatePath('/platform-admin/organizations');

  return {
    ok: true,
    organization: {
      id: createdOrg.id,
      name: createdOrg.name,
      slug: createdOrg.slug,
      inviteToken: token,
    },
  };
}

// ============================================================================
// 4. ORGANIZATION MEMBERS DIRECTORY (/org/[slug]/members)
// ============================================================================

export async function getOrganizationMembersAction(organizationIdOrSlug: string) {
  const userId = await getSessionUserId();

  const organization = await prisma.organization.findFirst({
    where: {
      OR: [{ id: organizationIdOrSlug }, { slug: organizationIdOrSlug }],
    },
    select: { id: true, name: true, slug: true },
  });

  if (!organization) throw new Error('Organization not found');
  await requireOrganizationAdmin(organization.id, userId);

  const orgMembers = await prisma.organizationMember.findMany({
    where: { organization_id: organization.id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          display_name: true,
          email: true,
          image: true,
          avatar_color: true,
          avatar_initials: true,
          workspace_members: {
            where: { workspace: { organization_id: organization.id } },
            include: {
              workspace: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
    },
    orderBy: { created_at: 'asc' },
  });

  const workspaces = await prisma.workspace.findMany({
    where: { organization_id: organization.id },
    select: { id: true, name: true, slug: true },
    orderBy: { created_at: 'asc' },
  });

  return {
    organization,
    workspaces,
    currentUserId: userId,
    members: orgMembers.map((m) => {
      const emailPrefix = m.user.email.split('@')[0];
      const cleanName =
        m.user.name && m.user.name.trim() && m.user.name.trim() !== emailPrefix
          ? m.user.name.trim()
          : null;
      return {
        userId: m.user_id,
        orgRole: m.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
        suspendedAt: m.suspended_at ? m.suspended_at.toISOString() : null,
        joinedAt: m.created_at.toISOString(),
        user: {
          id: m.user.id,
          name: cleanName,
          fullName: m.user.name || null,
          email: m.user.email,
          avatarUrl: m.user.image || null,
          avatarColor: m.user.avatar_color || null,
          avatarInitials: m.user.avatar_initials || null,
        },
        workspaceAccess: m.user.workspace_members.map((wm) => ({
          workspaceId: wm.workspace_id,
          workspaceName: wm.workspace.name,
          workspaceSlug: wm.workspace.slug,
          role: wm.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
        })),
      };
    }),
  };
}

export async function updateOrganizationMemberAccessAction(data: {
  organizationId: string;
  targetUserId: number;
  orgRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  workspaceGrants: { workspaceId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST' }[];
}) {
  const userId = await getSessionUserId();
  await requireOrganizationAdmin(data.organizationId, userId);

  const org = await prisma.organization.findUnique({
    where: { id: data.organizationId },
    select: { id: true, slug: true },
  });
  if (!org) throw new Error('Organization not found');

  const targetOrgMember = await prisma.organizationMember.findUnique({
    where: {
      organization_id_user_id: {
        organization_id: data.organizationId,
        user_id: data.targetUserId,
      },
    },
  });
  if (!targetOrgMember) throw new Error('Member not found in organization');

  if (targetOrgMember.role === 'OWNER' && data.orgRole !== 'OWNER' && data.targetUserId === userId) {
    throw new Error('Organization Owner cannot demote themselves');
  }

  await prisma.$transaction(async (tx) => {
    await tx.organizationMember.update({
      where: {
        organization_id_user_id: {
          organization_id: data.organizationId,
          user_id: data.targetUserId,
        },
      },
      data: { role: data.orgRole },
    });

    // Get all workspaces in this organization
    const orgWorkspaces = await tx.workspace.findMany({
      where: { organization_id: data.organizationId },
      select: { id: true },
    });
    const orgWsIds = orgWorkspaces.map((w) => w.id);
    const grantedIds = data.workspaceGrants.map((g) => g.workspaceId);

    // Remove memberships from unchecked workspaces in this org (except if they are last OWNER)
    const toRemoveIds = orgWsIds.filter((id) => !grantedIds.includes(id));
    if (toRemoveIds.length > 0) {
      await tx.workspaceMember.deleteMany({
        where: {
          user_id: data.targetUserId,
          workspace_id: { in: toRemoveIds },
        },
      });
    }

    // Upsert granted workspaces
    for (const grant of data.workspaceGrants) {
      const existing = await tx.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: grant.workspaceId,
            user_id: data.targetUserId,
          },
        },
      });
      if (existing) {
        await tx.workspaceMember.update({
          where: {
            workspace_id_user_id: {
              workspace_id: grant.workspaceId,
              user_id: data.targetUserId,
            },
          },
          data: { role: grant.role },
        });
      } else {
        await tx.workspaceMember.create({
          data: {
            workspace_id: grant.workspaceId,
            user_id: data.targetUserId,
            role: grant.role,
          },
        });
      }
    }
  });

  revalidatePath(`/org/${org.slug}/members`);
  return { success: true };
}

export async function removeOrganizationMemberAction(data: {
  organizationId: string;
  targetUserId: number;
}) {
  const userId = await getSessionUserId();
  await requireOrganizationAdmin(data.organizationId, userId);

  if (data.targetUserId === userId) {
    throw new Error('Cannot remove yourself from the organization');
  }

  const target = await prisma.organizationMember.findUnique({
    where: {
      organization_id_user_id: {
        organization_id: data.organizationId,
        user_id: data.targetUserId,
      },
    },
  });
  if (target?.role === 'OWNER') {
    throw new Error('Cannot remove the Organization Owner');
  }

  const org = await prisma.organization.findUnique({
    where: { id: data.organizationId },
    select: { id: true, slug: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({
      where: {
        user_id: data.targetUserId,
        project: { workspace: { organization_id: data.organizationId } },
      },
    });

    await tx.workspaceMember.deleteMany({
      where: {
        user_id: data.targetUserId,
        workspace: { organization_id: data.organizationId },
      },
    });

    await tx.organizationMember.delete({
      where: {
        organization_id_user_id: {
          organization_id: data.organizationId,
          user_id: data.targetUserId,
        },
      },
    });
  });

  if (org) {
    revalidatePath(`/org/${org.slug}/members`);
  }
  return { success: true };
}
