import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/apiHandler';
import { prisma } from '@/lib/db';

// Single round-trip: the membership row pulls in the workspace, its
// organization and the caller's organization role in one query.
const memberInclude = (userId: number) =>
  ({
    workspace: {
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            members: { where: { user_id: userId }, select: { role: true } },
          },
        },
      },
    },
  }) as const;

export const GET = createApiHandler(async (req, { userId, user }) => {
  const workspaceId = (user as any).workspaceId as string | undefined;
  const include = memberInclude(userId);

  let member = null;

  if (workspaceId) {
    member = await prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
      include,
    });
  }

  if (!member) {
    member = await prisma.workspaceMember.findFirst({
      where: { user_id: userId },
      include,
      orderBy: { created_at: 'asc' },
    });
  }

  if (!member) {
    return NextResponse.json({ error: 'No workspace found for user' }, { status: 404 });
  }

  const orgMemberRole = member.workspace.organization?.members[0]?.role;
  const isOrgAdmin = member.role === 'OWNER' || orgMemberRole === 'OWNER' || orgMemberRole === 'ADMIN';

  return NextResponse.json({
    id: member.workspace_id,
    name: member.workspace.name,
    slug: member.workspace.slug,
    role: member.role,
    organizationName: member.workspace.organization?.name || member.workspace.name,
    isOrgAdmin,
  });
});
