import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { getProjects } from '@/lib/dal/projects';
import { ProjectDataProvider } from '@/components/providers/ProjectDataProvider';
import type { Project } from '@/lib/types';
import { ProfileClient } from './ProfileClient';

function mapPrismaProjectToMock(p: Record<string, unknown>): Project {
  return {
    id: p.id as string,
    name: p.name as string,
    slug: p.slug as string,
    aiEnabled: (p.ai_enabled as boolean) ?? false,
    reviewRequired: (p.review_required as boolean) ?? false,
    createdBy: p.created_by as string,
    createdAt: (p.created_at as string) || new Date().toISOString(),
  };
}

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id as number;
  const workspaceId = (session.user as any)?.workspaceId as string | undefined;

  const [user, prefs, workspaceMember] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        display_name: true,
        email: true,
        image: true,
        avatar_color: true,
        avatar_initials: true,
      },
    }),
    prisma.userNotificationPrefs.findUnique({
      where: { user_id: userId },
    }),
    workspaceId
      ? prisma.workspaceMember.findUnique({
          where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
          include: { workspace: { select: { id: true, name: true, slug: true, organization: { select: { name: true } } } } },
        })
      : prisma.workspaceMember.findFirst({
          where: { user_id: userId },
          include: { workspace: { select: { id: true, name: true, slug: true, organization: { select: { name: true } } } } },
          orderBy: { last_active_at: 'desc' },
        }),
  ]);

  const effectiveWorkspaceId = workspaceId || workspaceMember?.workspace_id;
  const cookieStore = await cookies();
  const lastProjectSlug = cookieStore.get('inka_last_project_slug')?.value;

  const dbProjects = effectiveWorkspaceId ? await getProjects(effectiveWorkspaceId) : [];
  const projects: Project[] = (dbProjects as unknown as Record<string, unknown>[]).map(mapPrismaProjectToMock);
  const activeProject = (lastProjectSlug ? projects.find(p => p.slug === lastProjectSlug) : null) || projects[0] || null;

  const rawRole = workspaceMember?.role ? String(workspaceMember.role) : 'MEMBER';
  const formattedRole = rawRole.charAt(0).toUpperCase() + rawRole.slice(1).toLowerCase();

  return (
    <ProjectDataProvider
      project={activeProject}
      projects={projects}
      currentUser={{
        id: user.id,
        name: user.name || '',
        email: user.email,
        image: user.image,
      }}
      workspaceName={workspaceMember?.workspace?.name || 'Workspace'}
    >
      <ProfileClient
        user={{
          id: user.id,
          name: user.name || '',
          displayName: user.display_name,
          email: user.email,
          image: user.image,
          avatarColor: user.avatar_color,
          avatarInitials: user.avatar_initials,
          role: formattedRole,
          workspaceName: workspaceMember?.workspace?.name || 'Workspace',
        }}
        prefs={prefs ? {
          emailMentions: prefs.email_mentions,
          emailReviewRequests: prefs.email_review_requests,
          emailRunComplete: prefs.email_run_complete,
        } : null}
        initialWorkspace={workspaceMember?.workspace ? {
          id: workspaceMember.workspace.id,
          name: workspaceMember.workspace.name,
          slug: workspaceMember.workspace.slug,
          role: String(workspaceMember.role),
          organizationName: workspaceMember.workspace.organization?.name || undefined,
        } : null}
      />
    </ProjectDataProvider>
  );
}
