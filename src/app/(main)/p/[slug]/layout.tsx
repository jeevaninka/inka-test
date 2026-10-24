import { ProjectLayoutShell } from '@/components/layout/ProjectLayoutShell';
import { getProjectSuspension } from '@/lib/access';
import { redirect } from 'next/navigation';
import { ProjectDataProvider } from '@/components/providers/ProjectDataProvider';
import { cookies } from 'next/headers';
import { getCachedServerSession } from '@/lib/auth.config';
import { getProjectBySlug, getProjects, getTestCases, getTestSuites, getTestRuns, getModules } from '@/lib/dal/projects';
import { mapPrismaRunToMock, mapPrismaCaseToMock, mapPrismaModuleToMock } from '@/lib/dal/mappers';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Project } from '@/lib/types';

function mapPrismaProjectToMock(p: Record<string, unknown>): Project & Record<string, unknown> {
  const rawDate = p.created_at;
  const createdAt =
    rawDate instanceof Date
      ? rawDate.toISOString()
      : typeof rawDate === 'string'
      ? rawDate
      : new Date().toISOString();
  const workspace =
    p.workspace && typeof p.workspace === 'object'
      ? (p.workspace as Record<string, unknown>)
      : null;

  return {
    id: p.id as string,
    name: p.name as string,
    slug: p.slug as string,
    key: (p.key as string) || 'PRJ',
    workspaceSlug: (workspace?.slug as string) || undefined,
    aiEnabled: (p.ai_enabled as boolean) ?? false,
    reviewRequired: (p.review_required as boolean) ?? false,
    emailRunCompleteEnabled: (p.email_run_complete_enabled as boolean) ?? true,
    createdBy: p.created_by as string,
    createdAt,
  };
}



function mapPrismaSuiteToMock(s: any, casesMap?: Map<string, any>): any {
  return {
    id: s.id,
    projectId: s.project_id,
    name: s.name,
    type: (s.tags[0] || 'smoke').toLowerCase(),
    environment: s.environment,
    createdBy: s.created_by,
    createdAt: s.created_at.toISOString(),
    caseCount: s.suite_cases?.length || 0,
    suite_cases: (s.suite_cases || []).map((sc: any) => ({
      suite_id: sc.suite_id,
      test_case_id: sc.test_case_id,
      order_index: sc.order_index,
      assignee_id: sc.assignee_id,
    })),
  };
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cookieStore = await cookies();
  const initialSidebarCollapsed = cookieStore.get('inka_sidebar_collapsed')?.value === 'true';
  const session = await getCachedServerSession();
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;
  const currentUser = session?.user
    ? {
        id: (session.user as any).id as number,
        name: ((session.user as any).displayName || (session.user as any).name) as string,
        fullName: ((session.user as any).name || null) as string | null,
        displayName: ((session.user as any).displayName || null) as string | null,
        email: (session.user as any).email as string,
        image: (session.user as any).image as string | null,
      }
    : null;

  let project: Project | null = null;
  let projects: Project[] = [];
  let modules: any[] = [];
  let cases: any[] = [];
  let archivedCases: any[] = [];
  let customFieldDefs: any[] = [];
  let suites: any[] = [];
  let runs: any[] = [];
  let members: any[] = [];

  let workspaceName = 'Workspace';
  let userRole: 'admin' | 'tester' | 'viewer' = 'viewer';
  let initialWorkspace: {
    id: string;
    name: string;
    slug: string;
    role: string;
    organizationName?: string;
  } | null = null;
  let suspendedOrgId: string | null = null;

  if (currentUser?.id) {
    try {
      // Fast path: check active workspace first via unique index (workspace_id, slug)
      let prismaProject = workspaceId
        ? await prisma.project.findFirst({
            where: {
              workspace_id: workspaceId,
              slug,
              deleted_at: null,
            },
            include: {
              workspace: { select: { id: true, name: true, slug: true, organization: { select: { name: true } } } },
            },
          })
        : null;

      if (!prismaProject) {
        const candidateProjects = await prisma.project.findMany({
          where: {
            slug,
            deleted_at: null,
            OR: [
              ...(workspaceId ? [{ workspace_id: workspaceId }] : []),
              { workspace: { members: { some: { user_id: currentUser.id } } } },
              { members: { some: { user_id: currentUser.id } } },
            ],
          },
          include: {
            workspace: { select: { id: true, name: true, slug: true, organization: { select: { name: true } } } },
          },
        });
        prismaProject = candidateProjects[0] || null;
      }

      if (prismaProject) {
        const activeWsId = prismaProject.workspace_id;
        workspaceName = prismaProject.workspace?.name || 'Workspace';
        project = mapPrismaProjectToMock(prismaProject as unknown as Record<string, unknown>);
        const projectId = prismaProject.id;

        const memberUserSelect = {
          id: true,
          name: true,
          display_name: true,
          email: true,
          image: true,
          avatar_color: true,
          avatar_initials: true,
        };

        const [
          prismaProjects,
          prismaModules,
          prismaCases,
          prismaArchivedCases,
          prismaCustomFieldDefs,
          prismaSuites,
          prismaRuns,
          dbMembers,
          allWsMembers,
        ] = await Promise.all([
          getProjects(activeWsId),
          getModules(projectId),
          getTestCases(projectId),
          prisma.testCase.findMany({
            where: { project_id: projectId, deleted_at: { not: null } },
            orderBy: { deleted_at: 'desc' },
            select: {
              id: true,
              display_id: true,
              project_id: true,
              module_id: true,
              title: true,
              priority: true,
              type: true,
              status: true,
              tags: true,
              labels: true,
              ai_generated: true,
              created_by: true,
              created_at: true,
              deleted_at: true,
            },
          }),
          prisma.customFieldDefinition.findMany({
            where: { project_id: projectId, entity_type: 'TEST_CASE' },
            orderBy: [{ order: 'asc' }, { created_at: 'asc' }],
          }),
          getTestSuites(projectId),
          getTestRuns(projectId),
          prisma.projectMember.findMany({
            where: { project_id: projectId },
            include: { user: { select: memberUserSelect } },
          }),
          prisma.workspaceMember.findMany({
            where: { workspace_id: activeWsId },
            include: { user: { select: memberUserSelect } },
          }),
        ]);

        const wsMember = allWsMembers.find((wm) => wm.user_id === currentUser.id);

        const projectSuspension = await getProjectSuspension(currentUser.id, projectId);
        if (projectSuspension) {
          suspendedOrgId = projectSuspension.organizationId;
        }

        if (prismaProject.workspace) {
          initialWorkspace = {
            id: prismaProject.workspace.id,
            name: prismaProject.workspace.name,
            slug: prismaProject.workspace.slug,
            role: (wsMember?.role as string) || 'MEMBER',
            organizationName: prismaProject.workspace.organization?.name || undefined,
          };
        }

        // Authoritative role resolution: Workspace GUEST is strictly 'viewer' (read-only) everywhere
        const currentProjMember = dbMembers.find((m) => m.user_id === currentUser.id);
        if (wsMember?.role === 'GUEST') {
          userRole = 'viewer';
        } else if (currentProjMember) {
          userRole = currentProjMember.role.toLowerCase() as 'admin' | 'tester' | 'viewer';
        } else if (wsMember?.role === 'OWNER' || wsMember?.role === 'ADMIN') {
          userRole = 'admin';
        } else if (wsMember?.role === 'MEMBER') {
          userRole = 'tester';
        } else {
          userRole = 'viewer';
        }

        modules = prismaModules.map(mapPrismaModuleToMock);
        cases = prismaCases.map(mapPrismaCaseToMock);
        archivedCases = prismaArchivedCases.map((c) => ({
          id: c.id,
          displayId: c.display_id,
          projectId: c.project_id,
          moduleId: c.module_id,
          title: c.title,
          steps: [],
          priority: c.priority,
          type: c.type.toLowerCase(),
          status: c.status.toLowerCase(),
          tags: c.tags,
          labels: c.labels,
          aiGenerated: c.ai_generated,
          createdBy: c.created_by,
          createdAt: c.created_at.toISOString(),
          archivedAt: c.deleted_at?.toISOString(),
        }));
        customFieldDefs = prismaCustomFieldDefs;
        const casesByIdMap = new Map(cases.map((c: any) => [c.id, c]));
        suites = prismaSuites.map((s: any) => mapPrismaSuiteToMock(s, casesByIdMap));
        runs = prismaRuns.map(mapPrismaRunToMock);
        members = dbMembers.map((m) => {
          const matchingWs = allWsMembers.find((wm) => wm.user_id === m.user_id);
          const resolvedRole =
            m.user_id === currentUser.id
              ? userRole
              : matchingWs?.role === 'GUEST'
              ? 'viewer'
              : m.role.toLowerCase();

          return {
            userId: m.user_id,
            projectId: m.project_id,
            role: resolvedRole,
            user: {
              id: m.user.id,
              name: (m.user as any).display_name || m.user.name || m.user.email,
              fullName: m.user.name || null,
              displayName: (m.user as any).display_name || null,
              email: m.user.email,
              avatarUrl: m.user.image || null,
              avatarColor: (m.user as any).avatar_color || null,
              avatarInitials: (m.user as any).avatar_initials || null,
            },
          };
        });

        // Merge any workspace members who don't yet have an explicit ProjectMember row
        for (const wm of allWsMembers) {
          if (!members.some((m) => m.userId === wm.user_id)) {
            const derivedRole =
              wm.role === 'OWNER' || wm.role === 'ADMIN'
                ? 'admin'
                : wm.role === 'GUEST'
                ? 'viewer'
                : 'tester';
            members.push({
              userId: wm.user_id,
              projectId,
              role: derivedRole,
              user: {
                id: wm.user.id,
                name: (wm.user as any).display_name || wm.user.name || wm.user.email,
                fullName: wm.user.name || null,
                displayName: (wm.user as any).display_name || null,
                email: wm.user.email,
                avatarUrl: wm.user.image || null,
                avatarColor: (wm.user as any).avatar_color || null,
                avatarInitials: (wm.user as any).avatar_initials || null,
              },
            });
          }
        }

        // Ensure currentUser is present in members with their authoritative role
        if (!members.some((m) => m.userId === currentUser.id)) {
          members.push({
            userId: currentUser.id,
            projectId,
            role: userRole,
            user: {
              id: currentUser.id,
              name: currentUser.displayName || currentUser.fullName || currentUser.email,
              fullName: currentUser.fullName,
              displayName: currentUser.displayName,
              email: currentUser.email,
              avatarUrl: currentUser.image,
            },
          });
        }

        projects = (prismaProjects as unknown as Record<string, unknown>[]).map(
          mapPrismaProjectToMock
        );
      }
    } catch (e: any) {
      logger.error('Failed to load project data', {
        module: 'ProjectLayout',
        action: 'loadProjectData',
        slug,
        error: e.message,
        stack: e.stack,
      });
    }
  }

  if (suspendedOrgId) {
    redirect(`/suspended?org=${encodeURIComponent(suspendedOrgId)}`);
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  const canEdit = userRole !== 'viewer';
  const isAdmin = userRole === 'admin';

  return (
    <ProjectDataProvider
      project={project}
      projects={projects}
      currentUser={currentUser}
      userRole={userRole}
      canEdit={canEdit}
      isAdmin={isAdmin}
      modules={modules}
      cases={cases}
      archivedCases={archivedCases}
      customFieldDefs={customFieldDefs}
      suites={suites}
      runs={runs}
      members={members}
      workspaceName={workspaceName}
    >
      <ProjectLayoutShell workspaceName={workspaceName} projectName={project.name} initialCollapsed={initialSidebarCollapsed} initialWorkspace={initialWorkspace}>
        {children}
      </ProjectLayoutShell>
    </ProjectDataProvider>
  );
}
