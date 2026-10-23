import { TopBar } from '@/components/layout/TopBar';
import { Sidebar } from '@/components/layout/Sidebar';
import { prisma } from '@/lib/db';
import { getWorkspaceSuspension } from '@/lib/access';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { notFound, redirect } from 'next/navigation';

export default async function WorkspaceSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect('/login');
  }

  const userId = (session.user as any).id;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      organization: { select: { name: true } },
      members: {
        where: { user_id: userId },
      },
    },
  });

  if (!workspace) {
    notFound();
  }

  const member = workspace.members[0];
  if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
    redirect('/projects');
  }

  const suspension = await getWorkspaceSuspension(userId, workspace.id);
  if (suspension) redirect(`/suspended?org=${encodeURIComponent(suspension.organizationId)}`);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        initialWorkspace={{
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          role: member.role,
          organizationName: workspace.organization?.name || undefined,
        }}
      />
      <TopBar breadcrumbs={[{ label: workspace.name, href: `/workspace/${slug}` }, { label: 'Settings' }]} />
      <main className="pt-14 md:pl-48">
        <div className="max-w-6xl mx-auto p-6 md:p-8">
          <div className="animate-fade-up">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}