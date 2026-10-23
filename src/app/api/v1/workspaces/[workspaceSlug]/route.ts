import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/apiHandler';
import { prisma } from '@/lib/db';

export const GET = createApiHandler<{ workspaceSlug: string }>(async (req, { params, userId }) => {
  const { workspaceSlug } = await params;

  if (!workspaceSlug) {
    return NextResponse.json({ error: 'Workspace slug is required' }, { status: 400 });
  }

  const member = await prisma.workspaceMember.findFirst({
    where: {
      user_id: userId,
      workspace: { slug: workspaceSlug },
    },
    include: { workspace: { include: { organization: { select: { id: true, name: true } } } } },
  });

  if (!member) {
    return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 });
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
