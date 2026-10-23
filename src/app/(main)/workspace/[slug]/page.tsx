import { getCachedServerSession } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { getWorkspaceSuspension } from '@/lib/access';
import { notFound, redirect } from 'next/navigation';
import { TopBar } from '@/components/layout/TopBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { WorkspaceLandingClient } from './WorkspaceLandingClient';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getCachedServerSession();
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      _count: { select: { members: true } },
      organization: { select: { name: true } },
      members: {
        where: { user_id: userId },
        select: { role: true },
      },
    },
  });

  if (!workspace) notFound();

  const isMember = workspace.members.length > 0;
  if (!isMember) redirect('/projects');

  const suspension = await getWorkspaceSuspension(userId, workspace.id);
  if (suspension) redirect(`/suspended?org=${encodeURIComponent(suspension.organizationId)}`);

  const projects = await prisma.project.findMany({
    where: { workspace_id: workspace.id, deleted_at: null },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      key: true,
      created_at: true,
      _count: { select: { test_cases: true, members: true } },
    },
  });

  const memberCount = workspace._count.members;

  const currentRole = workspace.members[0]?.role;
  const canCreateProject = currentRole === 'OWNER' || currentRole === 'ADMIN';

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        initialWorkspace={{
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          role: currentRole || 'MEMBER',
          organizationName: workspace.organization?.name || undefined,
        }}
      />
      <TopBar breadcrumbs={[{ label: workspace.name }]} />
      <main className="pt-14 md:pl-48">
        <WorkspaceLandingClient
          workspaceName={workspace.name}
          workspaceSlug={workspace.slug}
          memberCount={memberCount}
          canCreateProject={canCreateProject}
          projects={projects.map(p => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            key: p.key,
            createdAt: p.created_at.toISOString(),
            testCaseCount: p._count.test_cases,
            memberCount: p._count.members,
          }))}
        />
      </main>
    </div>
  );
}
