import { prisma } from '@/lib/db';

export type OrgAdminRole = 'OWNER' | 'ADMIN';

export interface CurrentUserOrg {
  organization: { id: string; name: string; slug: string } | null;
  role: OrgAdminRole | 'MEMBER' | 'GUEST' | null;
}

export async function getCurrentUserOrgRole(userId: number | string): Promise<CurrentUserOrg> {
  const numericUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (!numericUserId || isNaN(numericUserId)) {
    return { organization: null, role: null };
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { user_id: numericUserId },
    select: {
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  });

  if (membership) {
    return {
      organization: membership.organization,
      role: membership.role as CurrentUserOrg['role'],
    };
  }

  // Fallback: check if user is an OWNER of a workspace linked to an organization
  const wsMembership = await prisma.workspaceMember.findFirst({
    where: {
      user_id: numericUserId,
      workspace: { organization_id: { not: null } },
    },
    include: {
      workspace: {
        include: {
          organization: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  if (wsMembership?.workspace.organization) {
    return {
      organization: wsMembership.workspace.organization,
      role: wsMembership.role as CurrentUserOrg['role'],
    };
  }

  return { organization: null, role: null };
}

export function isOrgAdmin(role: CurrentUserOrg['role']): role is OrgAdminRole {
  return role === 'OWNER' || role === 'ADMIN';
}

export async function checkIsPlatformAdmin(userId: number | string): Promise<boolean> {
  const numericUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (!numericUserId || isNaN(numericUserId)) return false;

  const rows = await prisma.$queryRaw<{ is_platform_admin: boolean }[]>`
    SELECT is_platform_admin FROM "User" WHERE id = ${numericUserId} LIMIT 1
  `;

  return Boolean(rows[0]?.is_platform_admin);
}
