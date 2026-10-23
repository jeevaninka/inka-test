import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/apiHandler';
import { prisma } from '@/lib/db';

export const GET = createApiHandler(async (req, { userId, user }) => {
  const workspaceId = (user as any).workspaceId as string | undefined;

  let member = null;

  if (workspaceId) {
    member = await prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
      include: { workspace: { include: { organization: { select: { id: true, name: true } } } } },
    });
  }

  if (!member) {
    member = await prisma.workspaceMember.findFirst({
      where: { user_id: userId },
      include: { workspace: { include: { organization: { select: { id: true, name: true } } } } },
      orderBy: { created_at: 'asc' },
    });
  }

  if (!member) {
    return NextResponse.json({ error: 'No workspace found for user' }, { status: 404 });
  }

  let isOrgAdmin = member.role === 'OWNER';
  if (!isOrgAdmin && member.workspace.organization_id) {
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organization_id_user_id: {
          organization_id: member.workspace.organization_id,
          user_id: userId,
        },
      },
    });
    isOrgAdmin = Boolean(orgMember && (orgMember.role === 'OWNER' || orgMember.role === 'ADMIN'));
  }

  return NextResponse.json({
    id: member.workspace_id,
    name: member.workspace.name,
    slug: member.workspace.slug,
    role: member.role,
    organizationName: member.workspace.organization?.name || member.workspace.name,
    isOrgAdmin,
  });
});
