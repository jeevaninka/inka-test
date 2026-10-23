'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { generateWorkspaceId } from '@/lib/ids';
import { revalidatePath } from 'next/cache';
import { sendEmail } from '@/lib/email/send';
import { inviteWorkspaceTemplate } from '@/lib/email/templates/inviteWorkspace';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';
import { getBaseUrl } from '@/lib/config';
import {
  closePendingAccessRequests,
  hasPendingInvitationForOrganization,
  upsertPendingOrganizationJoinRequest,
} from '@/lib/join-requests';

async function getSessionUserId() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  return (session.user as any).id as number;
}

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

async function requireOrganizationAdmin(organizationId: string, userId: number) {
  const platRows = await prisma.$queryRaw<{ is_platform_admin: boolean }[]>`
    SELECT is_platform_admin FROM "User" WHERE id = ${userId} LIMIT 1
  `;
  if (platRows[0]?.is_platform_admin) {
    return { role: 'OWNER' };
  }

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

  // Fallback check: if user is OWNER of a workspace in this organization
  const wsOwner = await prisma.workspaceMember.findFirst({
    where: {
      user_id: userId,
      role: 'OWNER',
      workspace: { organization_id: organizationId },
    },
  });
  if (wsOwner) {
    return wsOwner;
  }

  throw new Error('Only organization administrators can perform this action');
}

async function requireWorkspaceOwner(workspaceId: string, userId: number) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    include: { workspace: { select: { organization_id: true } } },
  });
  if (member && member.role === 'OWNER') return member;

  if (member?.workspace.organization_id) {
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organization_id_user_id: {
          organization_id: member.workspace.organization_id,
          user_id: userId,
        },
      },
    });
    if (orgMember && (orgMember.role === 'OWNER' || orgMember.role === 'ADMIN')) {
      return member;
    }
  }

  throw new Error('Only workspace owner or organization admin can perform this action');
}

async function requireWorkspaceOwnerOrAdmin(workspaceId: string, userId: number) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    include: { workspace: { select: { organization_id: true } } },
  });
  if (member && (member.role === 'OWNER' || member.role === 'ADMIN')) {
    return member;
  }

  const ws = member?.workspace || await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { organization_id: true },
  });

  if (ws?.organization_id) {
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organization_id_user_id: {
          organization_id: ws.organization_id,
          user_id: userId,
        },
      },
    });
    if (orgMember && (orgMember.role === 'OWNER' || orgMember.role === 'ADMIN')) {
      return orgMember;
    }
  }

  throw new Error('Only workspace owner or admin can perform this action');
}

export async function createWorkspaceAction(data: { name: string; prefix?: string; organizationId?: string }) {
  const userId = await getSessionUserId();

  // Only Organization Owners/Admins (or initial bootstrap user) can create new workspaces
  const orgMember = await prisma.organizationMember.findFirst({
    where: { user_id: userId, role: { in: ['OWNER', 'ADMIN'] } },
  });

  const userCount = await prisma.user.count();
  const isBootstrap = userCount <= 1;

  if (!orgMember && !isBootstrap) {
    throw new Error('Only organization administrators can create new workspaces');
  }

  let orgId = data.organizationId || orgMember?.organization_id;
  if (!orgId) {
    const defaultOrg = await prisma.organization.findFirst({ orderBy: { created_at: 'asc' } });
    orgId = defaultOrg?.id;
  }

  const trimmedName = data.name.trim();
  if (!trimmedName) {
    throw new Error('Workspace name cannot be empty');
  }

  // Check if a workspace with the same name already exists in this organization
  const existingWorkspace = await prisma.workspace.findFirst({
    where: {
      organization_id: orgId,
      name: { equals: trimmedName, mode: 'insensitive' },
    },
  });
  if (existingWorkspace) {
    throw new Error(`A workspace named "${trimmedName}" already exists in this organization.`);
  }

  let slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
  let counter = 0;
  while (true) {
    const existing = await prisma.workspace.findUnique({ where: { slug } });
    if (!existing) break;
    counter++;
    slug = `${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${counter}`;
  }
  const id = await generateWorkspaceId();

  const workspace = await prisma.workspace.create({
    data: {
      id,
      organization_id: orgId,
      name: trimmedName,
      slug,
      members: {
        create: {
          user_id: userId,
          role: 'OWNER',
        },
      },
    },
  });

  revalidatePath('/projects');
  revalidatePath('/workspace');
  return workspace;
}

export async function getDomainSettingsAction(workspaceId: string) {
  const userId = await getSessionUserId();
  await requireWorkspaceOwnerOrAdmin(workspaceId, userId);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { organization: true },
  });

  if (!workspace?.organization) {
    const firstOrg = await prisma.organization.findFirst();
    return {
      organizationName: firstOrg?.name || 'Default Organization',
      allowedDomains: firstOrg?.allowed_domains || [],
      domainJoinEnabled: firstOrg?.domain_join_enabled ?? true,
    };
  }

  return {
    organizationName: workspace.organization.name,
    allowedDomains: workspace.organization.allowed_domains,
    domainJoinEnabled: workspace.organization.domain_join_enabled,
  };
}

export async function updateDomainSettingsAction(data: {
  workspaceId: string;
  allowedDomains: string[];
  domainJoinEnabled: boolean;
}) {
  const userId = await getSessionUserId();

  const workspace = await prisma.workspace.findUnique({
    where: { id: data.workspaceId },
    include: { organization: true },
  });

  let orgId = workspace?.organization_id;
  if (!orgId) {
    const firstOrg = await prisma.organization.findFirst();
    orgId = firstOrg?.id;
  }

  if (!orgId) throw new Error('Organization not found');

  // Strict check: only Org Admins/Owners can modify corporate email domains
  await requireOrganizationAdmin(orgId, userId);

  const cleanedDomains = Array.from(
    new Set(
      data.allowedDomains
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean)
    )
  );

  // Prevent adding public consumer email domains
  for (const dom of cleanedDomains) {
    if (PUBLIC_EMAIL_DOMAINS.has(dom)) {
      throw new Error(`Public email domain "@${dom}" cannot be used for organization domain matching.`);
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) {
      throw new Error(`Invalid domain format: "${dom}"`);
    }
  }

  // Ensure no other organization already claims any of these domains
  if (cleanedDomains.length > 0) {
    const conflictingOrg = await prisma.organization.findFirst({
      where: {
        id: { not: orgId },
        allowed_domains: { hasSome: cleanedDomains },
      },
      select: { name: true, allowed_domains: true },
    });

    if (conflictingOrg) {
      const overlap = cleanedDomains.filter((d) => conflictingOrg.allowed_domains.includes(d));
      throw new Error(`Domain(s) ${overlap.join(', ')} are already claimed by another organization.`);
    }
  }

  const updatedOrg = await prisma.organization.update({
    where: { id: orgId },
    data: {
      allowed_domains: cleanedDomains,
      domain_join_enabled: data.domainJoinEnabled,
    },
  });

  revalidatePath(`/workspace/${workspace?.slug}/settings/invitations`);
  return {
    allowedDomains: updatedOrg.allowed_domains,
    domainJoinEnabled: updatedOrg.domain_join_enabled,
  };
}

export async function checkUserDomainMatchAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const userEmail = session.user.email.toLowerCase().trim();
  const userName = session.user.name || userEmail.split('@')[0];
  const domain = userEmail.split('@')[1] || '';

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, is_approved: true, email_verified: true, email: true },
  });

  const isApproved = !!dbUser?.is_approved;
  const emailVerified = !!dbUser?.email_verified;

  // Check if user already has a valid pending organization invitation
  const pendingOrgInvRows: {
    token: string;
    role: string;
    org_name: string;
    org_slug: string;
  }[] = emailVerified
    ? await prisma.$queryRaw`
        SELECT i.token, i.role::text as role, o.name as org_name, o.slug as org_slug
        FROM "OrganizationInvitation" i
        JOIN "Organization" o ON o.id = i.organization_id
        WHERE LOWER(i.email) = ${userEmail}
          AND i.status = 'PENDING'::"InvitationStatus"
          AND i.expires_at > NOW()
        ORDER BY i.created_at DESC
        LIMIT 1
      `
    : [];
  const pendingOrgInvite = pendingOrgInvRows[0];

  // Check if user already has a valid pending workspace invitation (legacy)
  const pendingInvite = emailVerified && !pendingOrgInvite
    ? await prisma.invitation.findFirst({
        where: {
          email: { equals: userEmail, mode: 'insensitive' },
          status: 'PENDING',
          expires_at: { gt: new Date() },
        },
        include: {
          workspace: {
            select: { id: true, name: true, slug: true, organization: { select: { name: true } } },
          },
        },
        orderBy: { created_at: 'desc' },
      })
    : null;

  // Find matching organization by domain
  const matchedOrg = emailVerified
    ? await prisma.organization.findFirst({
        where: {
          domain_join_enabled: true,
          allowed_domains: {
            has: domain,
          },
        },
        include: {
          workspaces: {
            select: { id: true, name: true, slug: true },
          },
        },
      })
    : null;

  let hasPendingRequest = false;
  let isRejected = false;
  let pendingRequestNote: string | null = null;
  let pendingRequestId: string | null = null;

  if (matchedOrg) {
    const latestOrgReq = await prisma.organizationJoinRequest.findFirst({
      where: {
        user_id: userId,
        organization_id: matchedOrg.id,
      },
      orderBy: { created_at: 'desc' },
    });

    if (latestOrgReq) {
      if (latestOrgReq.status === 'PENDING') {
        hasPendingRequest = true;
        pendingRequestNote = latestOrgReq.message;
        pendingRequestId = latestOrgReq.id;
      } else if (latestOrgReq.status === 'REJECTED') {
        isRejected = true;
        pendingRequestNote = latestOrgReq.message;
        pendingRequestId = latestOrgReq.id;
      }
    }
  }

  if (!hasPendingRequest && !isRejected) {
    const legacyReq = await prisma.workspaceJoinRequest.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
    if (legacyReq) {
      if (legacyReq.status === 'PENDING') {
        hasPendingRequest = true;
        pendingRequestNote = legacyReq.message;
        pendingRequestId = legacyReq.id;
      } else if (legacyReq.status === 'REJECTED') {
        isRejected = true;
        pendingRequestNote = legacyReq.message;
        pendingRequestId = legacyReq.id;
      }
    }
  }

  return {
    isApproved,
    userEmail,
    userName,
    domain,
    hasMatch: !!matchedOrg,
    organizationName:
      matchedOrg?.name ||
      pendingOrgInvite?.org_name ||
      pendingInvite?.workspace.organization?.name ||
      null,
    organizationId: matchedOrg?.id || null,
    hasPendingRequest,
    isRejected,
    pendingRequestNote,
    pendingRequestId,
    pendingInvitation: pendingOrgInvite
      ? {
          token: pendingOrgInvite.token,
          workspaceName: pendingOrgInvite.org_name,
          workspaceSlug: '',
          role: pendingOrgInvite.role,
          isOrgInvitation: true,
        }
      : pendingInvite
      ? {
          token: pendingInvite.token,
          workspaceName: pendingInvite.workspace.name,
          workspaceSlug: pendingInvite.workspace.slug,
          role: pendingInvite.role,
          isOrgInvitation: false,
        }
      : null,
  };
}

export async function requestDomainJoinAction(data: { message?: string }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  const userEmail = session.user.email.toLowerCase().trim();
  const domain = userEmail.split('@')[1] || '';

  const matchedOrg = await prisma.organization.findFirst({
    where: {
      domain_join_enabled: true,
      allowed_domains: {
        has: domain,
      },
      suspended_at: null,
    },
    include: {
      workspaces: { select: { id: true, slug: true } },
    },
  });

  if (!matchedOrg) {
    throw new Error(`No organization found matching domain @${domain}`);
  }

  // A pending invitation always beats a request: do not create a duplicate request.
  if (await hasPendingInvitationForOrganization(userEmail, matchedOrg.id)) {
    throw new Error('You already have a pending invitation. Please use the invitation link instead.');
  }

  const request = await upsertPendingOrganizationJoinRequest({
    userId,
    organizationId: matchedOrg.id,
    message: data.message,
  });

  if (!request.created) {
    return { success: true, requestId: request.id };
  }

  const orgOwners = await prisma.organizationMember.findMany({
    where: { organization_id: matchedOrg.id, role: { in: ['OWNER', 'ADMIN'] } },
    select: { user_id: true },
  });

  const wsOwners = await prisma.workspaceMember.findMany({
    where: {
      workspace: { organization_id: matchedOrg.id },
      role: { in: ['OWNER', 'ADMIN'] },
    },
    select: { user_id: true },
  });

  const recipientIds = Array.from(new Set([...orgOwners.map((o) => o.user_id), ...wsOwners.map((w) => w.user_id)]));

  const firstWs = matchedOrg.workspaces[0];
  const actionUrl = firstWs ? `/workspace/${firstWs.slug}/settings/members?tab=requests` : '/workspace';

  await prisma.notification.createMany({
    data: recipientIds.map((uid) => ({
      user_id: uid,
      type: 'JOIN_REQUEST',
      entity_type: 'OrganizationJoinRequest',
      entity_id: request.id,
      action_url: actionUrl,
    })),
  });

  revalidatePath('/pending');
  return { success: true, requestId: request.id };
}

export async function getWorkspacesAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const workspaces = await prisma.workspace.findMany({
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });

  const pendingRequests = await prisma.workspaceJoinRequest.findMany({
    where: { user_id: userId, status: 'PENDING' },
    select: { workspace_id: true }
  });

  const pendingIds = pendingRequests.map(r => r.workspace_id);

  return workspaces.map(ws => ({
    ...ws,
    hasPendingRequest: pendingIds.includes(ws.id)
  }));
}

export async function requestJoinAction(data: { workspaceId: string; message?: string }) {
  const userId = await getSessionUserId();

  const requestingUser = await prisma.user.findUnique({ where: { id: userId } });
  const requesterDisplay = requestingUser?.name ? `${requestingUser.name} (${requestingUser.email})` : requestingUser?.email;

  const workspace = await prisma.workspace.findUnique({ where: { id: data.workspaceId } });
  if (!workspace) throw new Error('Workspace not found');

  const existing = await prisma.workspaceJoinRequest.findFirst({
    where: {
      user_id: userId,
      workspace_id: data.workspaceId,
      status: 'PENDING',
    },
  });
  if (existing) throw new Error('You already have a pending request for this workspace');

  const request = await prisma.workspaceJoinRequest.create({
    data: {
      user_id: userId,
      workspace_id: data.workspaceId,
      message: data.message,
      status: 'PENDING',
    },
  });

  const owners = await prisma.workspaceMember.findMany({
    where: { workspace_id: data.workspaceId, role: 'OWNER' },
    select: { user_id: true },
  });

  await prisma.notification.createMany({
    data: owners.map((o) => ({
      user_id: o.user_id,
      type: 'JOIN_REQUEST',
      entity_type: 'WorkspaceJoinRequest',
      entity_id: request.id,
      action_url: `/workspace/${workspace.slug}/settings/members?tab=requests&requester=${encodeURIComponent(requesterDisplay || 'A user')}`,
    })),
  });

  revalidatePath('/pending');
  return request;
}

export async function getOrganizationJoinRequestsAction(orgIdOrSlug: string) {
  const userId = await getSessionUserId();
  const organization = await prisma.organization.findFirst({
    where: {
      OR: [{ id: orgIdOrSlug }, { slug: orgIdOrSlug }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      allowed_domains: true,
      domain_join_enabled: true,
    },
  });
  if (!organization) throw new Error('Organization not found');

  await requireOrganizationAdmin(organization.id, userId);

  const orgRequests = await prisma.organizationJoinRequest.findMany({
    where: {
      organization_id: organization.id,
      status: 'PENDING',
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          avatar_color: true,
          avatar_initials: true,
          is_approved: true,
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  return orgRequests.map((r) => {
    const emailPrefix = r.user.email.split('@')[0];
    const cleanName =
      r.user.name && r.user.name.trim() && r.user.name.trim() !== emailPrefix
        ? r.user.name.trim()
        : null;
    const domain = r.user.email.split('@')[1] || '';

    return {
      id: r.id,
      message: r.message,
      createdAt: r.created_at.toISOString(),
      isOrgRequest: true,
      requestType: 'NEW_SIGNUP' as const,
      contextPrimary: `@${domain}`,
      contextSecondary: 'Corporate domain match',
      requestedWorkspaceId: null as string | null,
      requestedWorkspaceName: null as string | null,
      user: {
        id: r.user.id,
        name: cleanName,
        fullName: r.user.name || null,
        email: r.user.email,
        avatarUrl: r.user.image || null,
        avatarColor: r.user.avatar_color || null,
        avatarInitials: r.user.avatar_initials || null,
      },
    };
  });
}

export async function getJoinRequestsAction(workspaceId: string) {
  const userId = await getSessionUserId();
  await requireWorkspaceOwnerOrAdmin(workspaceId, userId);

  // Exclusively surfaces internal requests for this specific workspace
  const wsRequests = await prisma.workspaceJoinRequest.findMany({
    where: { workspace_id: workspaceId, status: 'PENDING' },
    include: { user: { select: { id: true, name: true, email: true, image: true, avatar_color: true, avatar_initials: true } } },
    orderBy: { created_at: 'desc' },
  });

  return wsRequests.map((r) => ({
    id: r.id,
    message: r.message,
    createdAt: r.created_at.toISOString(),
    isOrgRequest: false,
    user: {
      id: r.user.id,
      name: r.user.name || r.user.email.split('@')[0],
      fullName: r.user.name || null,
      email: r.user.email,
      avatarUrl: r.user.image || null,
      avatarColor: r.user.avatar_color || null,
      avatarInitials: r.user.avatar_initials || null,
    },
  }));
}

export async function approveJoinRequestAction(data: {
  requestId: string;
  isOrgRequest?: boolean;
  workspaceRole?: 'ADMIN' | 'MEMBER' | 'GUEST';
  workspaceAssignments?: { workspaceId: string; role: 'ADMIN' | 'MEMBER' | 'GUEST' }[];
  projectAssignments?: { projectId: string; role: 'ADMIN' | 'TESTER' | 'VIEWER' }[];
}) {
  const userId = await getSessionUserId();

  // Check if it's an OrganizationJoinRequest
  const orgRequest = await prisma.organizationJoinRequest.findUnique({
    where: { id: data.requestId },
    include: { organization: true },
  });

  if (orgRequest || data.isOrgRequest) {
    const req = orgRequest || await prisma.organizationJoinRequest.findUniqueOrThrow({ where: { id: data.requestId } });
    if (req.status !== 'PENDING') throw new Error('Request is not pending');

    // Enforce strict Organization Admin/Owner authority
    await requireOrganizationAdmin(req.organization_id, userId);

    // Validate tenant ownership of all assigned workspaces
    if (data.workspaceAssignments && data.workspaceAssignments.length > 0) {
      const requestedWsIds = data.workspaceAssignments.map((w) => w.workspaceId);
      const validWorkspaces = await prisma.workspace.findMany({
        where: { id: { in: requestedWsIds }, organization_id: req.organization_id },
        select: { id: true },
      });
      if (validWorkspaces.length !== requestedWsIds.length) {
        throw new Error('Forbidden: One or more workspaces do not belong to this organization');
      }
    }

    // Validate tenant ownership of all assigned projects
    if (data.projectAssignments && data.projectAssignments.length > 0) {
      const requestedProjIds = data.projectAssignments.map((p) => p.projectId);
      const validProjects = await prisma.project.findMany({
        where: {
          id: { in: requestedProjIds },
          workspace: { organization_id: req.organization_id },
        },
        select: { id: true },
      });
      if (validProjects.length !== requestedProjIds.length) {
        throw new Error('Forbidden: One or more projects do not belong to this organization');
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.organizationJoinRequest.update({
        where: { id: req.id },
        data: { status: 'APPROVED', reviewed_by: userId, reviewed_at: new Date(), pending_key: null },
      });

      await tx.user.update({
        where: { id: req.user_id },
        data: { is_approved: true },
      });

      // Add to organization members
      const existingOrgMember = await tx.organizationMember.findUnique({
        where: { organization_id_user_id: { organization_id: req.organization_id, user_id: req.user_id } },
      });
      if (!existingOrgMember) {
        await tx.organizationMember.create({
          data: {
            organization_id: req.organization_id,
            user_id: req.user_id,
            role: 'MEMBER',
          },
        });
      }

      // Add to assigned workspaces
      if (data.workspaceAssignments && data.workspaceAssignments.length > 0) {
        for (const ws of data.workspaceAssignments) {
          const existingWsMember = await tx.workspaceMember.findUnique({
            where: { workspace_id_user_id: { workspace_id: ws.workspaceId, user_id: req.user_id } },
          });
          if (existingWsMember) {
            await tx.workspaceMember.update({
              where: { workspace_id_user_id: { workspace_id: ws.workspaceId, user_id: req.user_id } },
              data: { role: ws.role },
            });
          } else {
            await tx.workspaceMember.create({
              data: {
                workspace_id: ws.workspaceId,
                user_id: req.user_id,
                role: ws.role,
              },
            });
          }
        }
      }

      // Add to assigned projects
      if (data.projectAssignments && data.projectAssignments.length > 0) {
        for (const p of data.projectAssignments) {
          const existingProjMember = await tx.projectMember.findUnique({
            where: { project_id_user_id: { project_id: p.projectId, user_id: req.user_id } },
          });
          if (existingProjMember) {
            await tx.projectMember.update({
              where: { project_id_user_id: { project_id: p.projectId, user_id: req.user_id } },
              data: { role: p.role },
            });
          } else {
            await tx.projectMember.create({
              data: {
                project_id: p.projectId,
                user_id: req.user_id,
                role: p.role,
              },
            });
          }
        }
      }

      // Also mark any pending legacy workspace requests as approved
      await tx.workspaceJoinRequest.updateMany({
        where: { user_id: req.user_id, status: 'PENDING' },
        data: { status: 'APPROVED', reviewed_by: userId, reviewed_at: new Date() },
      });
    });

    revalidatePath('/workspace');
    return { success: true };
  }

  // Internal WorkspaceJoinRequest: allowed by Workspace Owner/Admin OR Org Admin
  const joinRequest = await prisma.workspaceJoinRequest.findUniqueOrThrow({
    where: { id: data.requestId },
  });

  await requireWorkspaceOwnerOrAdmin(joinRequest.workspace_id, userId);
  if (joinRequest.status !== 'PENDING') throw new Error('Request is not pending');

  const wsAssignments =
    data.workspaceAssignments && data.workspaceAssignments.length > 0
      ? data.workspaceAssignments
      : [{ workspaceId: joinRequest.workspace_id, role: data.workspaceRole || 'MEMBER' }];

  await prisma.$transaction(async (tx) => {
    await tx.workspaceJoinRequest.update({
      where: { id: data.requestId },
      data: { status: 'APPROVED', reviewed_by: userId, reviewed_at: new Date() },
    });

    await tx.user.update({
      where: { id: joinRequest.user_id },
      data: { is_approved: true },
    });

    for (const ws of wsAssignments) {
      const existingMember = await tx.workspaceMember.findUnique({
        where: { workspace_id_user_id: { workspace_id: ws.workspaceId, user_id: joinRequest.user_id } },
      });
      if (existingMember) {
        await tx.workspaceMember.update({
          where: { workspace_id_user_id: { workspace_id: ws.workspaceId, user_id: joinRequest.user_id } },
          data: { role: ws.role },
        });
      } else {
        await tx.workspaceMember.create({
          data: {
            workspace_id: ws.workspaceId,
            user_id: joinRequest.user_id,
            role: ws.role,
          },
        });
      }
    }

    if (data.projectAssignments && data.projectAssignments.length > 0) {
      for (const p of data.projectAssignments) {
        const existingP = await tx.projectMember.findUnique({
          where: { project_id_user_id: { project_id: p.projectId, user_id: joinRequest.user_id } },
        });
        if (existingP) {
          await tx.projectMember.update({
            where: { project_id_user_id: { project_id: p.projectId, user_id: joinRequest.user_id } },
            data: { role: p.role },
          });
        } else {
          await tx.projectMember.create({
            data: {
              project_id: p.projectId,
              user_id: joinRequest.user_id,
              role: p.role,
            },
          });
        }
      }
    }
  });

  revalidatePath(`/workspace/${joinRequest.workspace_id}/settings/approvals`);
  return { success: true };
}

export async function rejectJoinRequestAction(data: { requestId: string; isOrgRequest?: boolean; reason?: string }) {
  const userId = await getSessionUserId();

  const orgRequest = await prisma.organizationJoinRequest.findUnique({
    where: { id: data.requestId },
  });

  if (orgRequest || data.isOrgRequest) {
    const req = orgRequest || await prisma.organizationJoinRequest.findUniqueOrThrow({ where: { id: data.requestId } });
    await requireOrganizationAdmin(req.organization_id, userId);

    await prisma.$transaction(async (tx) => {
      await tx.organizationJoinRequest.update({
        where: { id: req.id },
        data: { status: 'REJECTED', reviewed_by: userId, reviewed_at: new Date(), pending_key: null },
      });

      await tx.notification.create({
        data: {
          user_id: req.user_id,
          type: 'JOIN_REJECTED',
          entity_type: 'OrganizationJoinRequest',
          entity_id: req.id,
        },
      });
    });

    revalidatePath('/workspace');
    return { success: true };
  }

  const joinRequest = await prisma.workspaceJoinRequest.findUniqueOrThrow({
    where: { id: data.requestId },
  });

  await requireWorkspaceOwnerOrAdmin(joinRequest.workspace_id, userId);

  await prisma.$transaction(async (tx) => {
    await tx.workspaceJoinRequest.update({
      where: { id: data.requestId },
      data: { status: 'REJECTED', reviewed_by: userId, reviewed_at: new Date() },
    });

    await tx.notification.create({
      data: {
        user_id: joinRequest.user_id,
        type: 'JOIN_REJECTED',
        entity_type: 'WorkspaceJoinRequest',
        entity_id: data.requestId,
      },
    });
  });

  revalidatePath(`/workspace/${joinRequest.workspace_id}/settings/approvals`);
  return { success: true };
}

export async function inviteByEmailAction(data: {
  workspaceId: string;
  email: string;
  role: 'ADMIN' | 'MEMBER' | 'GUEST';
  projectAssignments?: { projectId: string; role: 'ADMIN' | 'TESTER' | 'VIEWER' }[];
}) {
  const userId = await getSessionUserId();
  await requireWorkspaceOwnerOrAdmin(data.workspaceId, userId);

  const normalizedEmail = data.email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Please enter a valid email address');
  }

  // Check if user is already an active member of this workspace
  const existingMember = await prisma.workspaceMember.findFirst({
    where: {
      workspace_id: data.workspaceId,
      user: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    },
  });
  if (existingMember) {
    throw new Error('This user is already a member of the workspace');
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // If a pending/expired/revoked invitation already exists for this email in this workspace, rotate its token & expiry
  const existingInvite = await prisma.invitation.findFirst({
    where: {
      workspace_id: data.workspaceId,
      email: { equals: normalizedEmail, mode: 'insensitive' },
      status: { in: ['PENDING', 'REJECTED'] },
    },
    orderBy: { created_at: 'desc' },
  });

  const invitation = existingInvite
    ? await prisma.invitation.update({
        where: { id: existingInvite.id },
        data: {
          email: normalizedEmail,
          role: data.role,
          token,
          invited_by: userId,
          status: 'PENDING',
          expires_at: expiresAt,
        },
      })
    : await prisma.invitation.create({
        data: {
          workspace_id: data.workspaceId,
          email: normalizedEmail,
          role: data.role,
          token,
          invited_by: userId,
          status: 'PENDING',
          expires_at: expiresAt,
        },
      });

  // Persist pre-assigned projects via raw SQL (safe across hot-reload cached Prisma clients)
  const assignmentsJson = JSON.stringify(data.projectAssignments || []);
  await prisma.$executeRaw`
    UPDATE "Invitation"
    SET project_assignments = ${assignmentsJson}::jsonb
    WHERE id = ${invitation.id}
  `;

  // Send email notification
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: data.workspaceId },
    });
    
    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    if (workspace && inviter) {
      const inviteData = inviteWorkspaceTemplate(
        normalizedEmail.split('@')[0],
        workspace.name,
        `${getBaseUrl()}/invite?token=${token}`,
        inviter.name || 'A team member',
        data.role.toLowerCase()
      );

      await sendEmail({
        to: [normalizedEmail],
        subject: inviteData.subject,
        htmlBody: inviteData.html,
        textBody: inviteData.text,
      });
    }
  } catch (e: any) {
    // Log error but don't fail the invitation
    logger.error('Failed to send workspace invite email', {
      module: 'Workspace',
      action: 'createInvitation',
      workspaceId: data.workspaceId,
      email: normalizedEmail,
      errorCode: ErrorCodes.EMAIL_SEND,
      error: e,
    });
  }

  revalidatePath(`/workspace/${data.workspaceId}/settings/invitations`);
  revalidatePath(`/workspace/${data.workspaceId}/settings/members`);
  return invitation;
}

export async function resendInvitationAction(invitationId: string) {
  const userId = await getSessionUserId();

  const invitation = await prisma.invitation.findUniqueOrThrow({
    where: { id: invitationId },
    include: { workspace: true },
  });

  await requireWorkspaceOwnerOrAdmin(invitation.workspace_id, userId);

  // Rotate cryptographic token and reset 7-day expiry so old links are invalidated
  const newToken = crypto.randomUUID();
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.invitation.update({
    where: { id: invitationId },
    data: {
      token: newToken,
      status: 'PENDING',
      expires_at: newExpiresAt,
    },
  });

  const inviter = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  try {
    const inviteData = inviteWorkspaceTemplate(
      invitation.email.split('@')[0],
      invitation.workspace.name,
      `${getBaseUrl()}/invite?token=${newToken}`,
      inviter?.name || 'A team member',
      invitation.role.toLowerCase()
    );

    await sendEmail({
      to: [invitation.email],
      subject: inviteData.subject,
      htmlBody: inviteData.html,
      textBody: inviteData.text,
    });
  } catch (e: any) {
    logger.error('Failed to resend workspace invite email', {
      module: 'Workspace',
      action: 'resendInvitation',
      invitationId,
      workspaceId: invitation.workspace_id,
      email: invitation.email,
      errorCode: ErrorCodes.EMAIL_SEND,
      error: e,
    });
  }

  revalidatePath(`/workspace/${invitation.workspace.slug}/settings/invitations`);
  revalidatePath(`/workspace/${invitation.workspace.slug}/settings/members`);
  return {
    success: true,
    token: newToken,
    expiresAt: newExpiresAt.toISOString(),
    status: 'PENDING' as const,
  };
}

import { requireWorkspaceMember } from '@/lib/permissions';

export async function acceptInvitationAction(token: string) {
  const userId = await getSessionUserId();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const invitation = await prisma.invitation.findUniqueOrThrow({
    where: { token },
    include: { workspace: true },
  });

  if (invitation.status !== 'PENDING') throw new Error('Invitation is not pending');
  if (invitation.expires_at < new Date()) throw new Error('Invitation has expired');

  if (invitation.email.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
    throw new Error('This invitation was sent to a different email address. Please sign in with the invited email.');
  }

  if (invitation.workspace.organization_id) {
    const invitingOrg = await prisma.organization.findUnique({
      where: { id: invitation.workspace.organization_id },
      select: { suspended_at: true },
    });
    if (invitingOrg?.suspended_at) {
      throw new Error('This organization is suspended. Ask a platform administrator to restore access.');
    }
  }

  const rawRows = await prisma.$queryRaw<{ project_assignments: any }[]>`
    SELECT project_assignments FROM "Invitation" WHERE id = ${invitation.id}
  `;
  const rawAssignments = rawRows[0]?.project_assignments ?? (invitation as any).project_assignments;
  const projectAssignments = Array.isArray(rawAssignments)
    ? (rawAssignments as { projectId: string; role: 'ADMIN' | 'TESTER' | 'VIEWER' }[])
    : [];

  await prisma.$transaction(async (tx) => {
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', accepted_at: new Date() },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        is_approved: true,
        email_verified: true,
        email_verification_token: null,
        email_verification_expires: null,
      },
    });

    // Accepting an invitation closes any pending access requests for this org.
    if (invitation.workspace.organization_id) {
      await closePendingAccessRequests(tx, userId, invitation.workspace.organization_id);
    } else {
      await tx.workspaceJoinRequest.updateMany({
        where: {
          user_id: userId,
          workspace_id: invitation.workspace_id,
          status: 'PENDING',
        },
        data: { status: 'APPROVED', reviewed_at: new Date() },
      });
    }

    const existingMember = await tx.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: invitation.workspace_id, user_id: userId } },
    });

    if (!existingMember) {
      await tx.workspaceMember.create({
        data: {
          workspace_id: invitation.workspace_id,
          user_id: userId,
          role: invitation.role,
        },
      });
    }

    if (invitation.workspace.organization_id) {
      const existingOrgMember = await tx.organizationMember.findUnique({
        where: {
          organization_id_user_id: {
            organization_id: invitation.workspace.organization_id,
            user_id: userId,
          },
        },
      });

      if (!existingOrgMember) {
        await tx.organizationMember.create({
          data: {
            organization_id: invitation.workspace.organization_id,
            user_id: userId,
            role: 'MEMBER',
          },
        });
      }
    }

    if (projectAssignments.length > 0) {
      for (const p of projectAssignments) {
        if (!p.projectId) continue;
        const existingProj = await tx.projectMember.findUnique({
          where: { project_id_user_id: { project_id: p.projectId, user_id: userId } },
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
    }
  });

  revalidatePath('/projects');
  revalidatePath('/workspace');
  revalidatePath(`/workspace/${invitation.workspace.slug}`);
  return { success: true, workspaceSlug: invitation.workspace.slug };
}

export async function revokeInvitationAction(invitationId: string) {
  const userId = await getSessionUserId();

  const invitation = await prisma.invitation.findUniqueOrThrow({
    where: { id: invitationId },
  });

  await requireWorkspaceOwnerOrAdmin(invitation.workspace_id, userId);

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: 'REJECTED' },
  });

  revalidatePath(`/workspace/${invitation.workspace_id}/settings/invitations`);
  return { success: true };
}

export async function getInvitationsAction(workspaceId: string) {
  const userId = await getSessionUserId();
  await requireWorkspaceOwnerOrAdmin(workspaceId, userId);

  return prisma.invitation.findMany({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: 'desc' },
  });
}

export async function getWorkspaceMembersAction(workspaceId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await requireWorkspaceMember(workspaceId, userId);

  return prisma.workspaceMember.findMany({
    where: { workspace_id: workspaceId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { created_at: 'asc' },
  });
}

export async function updateWorkspaceMemberRoleAction(data: {
  workspaceId: string;
  targetUserId: number;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
}) {
  const userId = await getSessionUserId();

  const currentMember = await prisma.workspaceMember.findUnique({
    where: {
      workspace_id_user_id: { workspace_id: data.workspaceId, user_id: userId },
    },
  });
  if (!currentMember) throw new Error('Unauthorized');

  if (currentMember.role !== 'OWNER' && currentMember.role !== 'ADMIN') {
    throw new Error('Forbidden: only workspace owner or admin can update member roles');
  }

  if (currentMember.role === 'ADMIN' && data.role === 'OWNER') {
    throw new Error('Admin cannot promote members to owner');
  }
  if (currentMember.role !== 'OWNER' && data.role === 'OWNER') {
    throw new Error('Only owner can assign owner role');
  }

  const targetMember = await prisma.workspaceMember.findUnique({
    where: {
      workspace_id_user_id: { workspace_id: data.workspaceId, user_id: data.targetUserId },
    },
  });
  if (!targetMember) throw new Error('Target user is not a member of this workspace');

  if (currentMember.role === 'ADMIN' && targetMember.role === 'OWNER') {
    throw new Error('Admin cannot modify owner role');
  }

  if (currentMember.role === 'OWNER' && data.targetUserId === userId && data.role !== 'OWNER') {
    throw new Error('Owner cannot demote themselves');
  }

  await prisma.workspaceMember.update({
    where: {
      workspace_id_user_id: { workspace_id: data.workspaceId, user_id: data.targetUserId },
    },
    data: { role: data.role },
  });

  revalidatePath(`/workspace/${data.workspaceId}/settings/members`);
  return { success: true };
}

export async function removeWorkspaceMemberAction(data: { workspaceId: string; targetUserId: number }) {
  const userId = await getSessionUserId();
  await requireWorkspaceOwnerOrAdmin(data.workspaceId, userId);

  if (data.targetUserId === userId) throw new Error('Cannot remove yourself');

  const target = await prisma.workspaceMember.findUnique({
    where: {
      workspace_id_user_id: { workspace_id: data.workspaceId, user_id: data.targetUserId },
    },
  });
  if (target?.role === 'OWNER') throw new Error('Cannot remove workspace owner');

  await prisma.workspaceMember.delete({
    where: {
      workspace_id_user_id: { workspace_id: data.workspaceId, user_id: data.targetUserId },
    },
  });

  await prisma.projectMember.deleteMany({
    where: { user_id: data.targetUserId, project: { workspace_id: data.workspaceId } },
  });

  revalidatePath(`/workspace/${data.workspaceId}/settings/members`);
  return { success: true };
}

export async function getWorkspaceProjectsForAssignmentAction(workspaceId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await requireWorkspaceMember(workspaceId, userId);

  return prisma.project.findMany({
    where: { workspace_id: workspaceId, deleted_at: null },
    select: { id: true, name: true },
    orderBy: { created_at: 'desc' },
  });
}

export async function updateWorkspaceAction(data: { workspaceId: string; name: string }) {
  const userId = await getSessionUserId();
  await requireWorkspaceOwner(data.workspaceId, userId);

  const trimmedName = data.name.trim();
  if (!trimmedName) {
    throw new Error('Workspace name cannot be empty');
  }

  const currentWs = await prisma.workspace.findUnique({
    where: { id: data.workspaceId },
    select: { id: true, organization_id: true },
  });
  if (!currentWs) {
    throw new Error('Workspace not found');
  }

  const existingDuplicate = await prisma.workspace.findFirst({
    where: {
      id: { not: data.workspaceId },
      organization_id: currentWs.organization_id,
      name: { equals: trimmedName, mode: 'insensitive' },
    },
  });
  if (existingDuplicate) {
    throw new Error(`A workspace named "${trimmedName}" already exists in this organization.`);
  }

  const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';

  const updated = await prisma.workspace.update({
    where: { id: data.workspaceId },
    data: { name: trimmedName, slug },
  });

  revalidatePath(`/workspace/${updated.slug}/settings/general`);
  return updated;
}

export async function deleteWorkspaceAction(data: { workspaceId: string }) {
  const userId = await getSessionUserId();
  await requireWorkspaceOwner(data.workspaceId, userId);

  await prisma.workspace.delete({
    where: { id: data.workspaceId },
  });

  revalidatePath('/projects');
  return { success: true };
}

export async function getActiveWorkspaceAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const workspaceId = (session.user as any).workspaceId as string;

  if (!workspaceId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { user_id: userId },
      include: { workspace: true },
    });
    if (!member) return null;
    return {
      id: member.workspace_id,
      name: member.workspace.name,
      slug: member.workspace.slug,
      role: member.role,
    };
  }

  const member = await prisma.workspaceMember.findUnique({
    where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    include: { workspace: true },
  });

  if (!member) return null;

  return {
    id: member.workspace_id,
    name: member.workspace.name,
    slug: member.workspace.slug,
    role: member.role,
  };
}

export async function getWorkspaceBySlugAction(slug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const member = await prisma.workspaceMember.findFirst({
    where: {
      user_id: userId,
      workspace: { slug },
    },
    include: { workspace: true },
  });

  if (!member) return null;

  return {
    id: member.workspace_id,
    name: member.workspace.name,
    slug: member.workspace.slug,
    role: member.role,
  };
}

export async function updateProfileAction(data: { displayName?: string; avatarColor?: string; avatarInitials?: string }) {
  const userId = await getSessionUserId();

  const updateData: any = {};
  if (data.displayName !== undefined) updateData.display_name = data.displayName;
  if (data.avatarColor !== undefined) updateData.avatar_color = data.avatarColor;
  if (data.avatarInitials !== undefined) updateData.avatar_initials = data.avatarInitials;

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: { id: true, name: true, display_name: true, email: true, avatar_color: true, avatar_initials: true, image: true },
  });

  return user;
}