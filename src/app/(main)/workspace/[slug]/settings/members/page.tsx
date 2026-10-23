import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { redirect, notFound } from 'next/navigation';
import { MembersClient } from './MembersClient';

export const dynamic = 'force-dynamic';

export default async function WorkspaceMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id as number;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      organization: true,
      members: {
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
            },
          },
        },
        orderBy: { created_at: 'asc' },
      },
    },
  });

  if (!workspace) notFound();

  const currentMember = workspace.members.find((m) => m.user_id === userId);
  if (!currentMember || (currentMember.role !== 'OWNER' && currentMember.role !== 'ADMIN')) {
    redirect('/projects');
  }

  const organization =
    workspace.organization ||
    (await prisma.organization.findFirst({ orderBy: { created_at: 'asc' } }));

  const mappedMembers = workspace.members.map((m) => {
    const emailPrefix = m.user.email.split('@')[0];
    const cleanName =
      m.user.name && m.user.name.trim() && m.user.name.trim() !== emailPrefix
        ? m.user.name.trim()
        : null;
    return {
      userId: m.user_id,
      role: m.role,
      createdAt: m.created_at.toISOString(),
      user: {
        id: m.user.id,
        name: cleanName,
        fullName: m.user.name || null,
        email: m.user.email,
        avatarUrl: m.user.image || null,
        avatarColor: m.user.avatar_color || null,
        avatarInitials: m.user.avatar_initials || null,
      },
    };
  });

  return (
    <MembersClient
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      organizationId={organization?.id || ''}
      organizationName={organization?.name || ''}
      organizationSlug={organization?.slug || ''}
      initialMembers={mappedMembers}
      currentUserId={userId}
      currentUserRole={currentMember.role}
    />
  );
}
