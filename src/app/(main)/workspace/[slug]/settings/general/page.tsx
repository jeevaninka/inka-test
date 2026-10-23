import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { redirect, notFound } from 'next/navigation';
import { GeneralClient } from './GeneralClient';

export default async function WorkspaceGeneralPage({
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
      organization: { select: { name: true, slug: true } },
      members: true,
      _count: {
        select: {
          projects: { where: { deleted_at: null } },
        },
      },
    },
  });

  if (!workspace) notFound();

  const currentMember = workspace.members.find((m) => m.user_id === userId);
  if (!currentMember || currentMember.role !== 'OWNER') {
    redirect(`/workspace/${slug}/settings/members`);
  }

  return (
    <GeneralClient
      workspaceId={workspace.id}
      initialName={workspace.name}
      initialSlug={workspace.slug}
      organizationName={workspace.organization?.name || ''}
      projectCount={workspace._count.projects}
      memberCount={workspace.members.length}
      createdAt={workspace.created_at.toISOString()}
    />
  );
}
