import { getCachedServerSession } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/layout/TopBar';
import { WorkspacesClient } from './WorkspacesClient';

export const dynamic = 'force-dynamic';

export default async function WorkspacesPage() {
  const session = await getCachedServerSession();
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id;

  const [memberships, orgMemberships, pendingRequests, platRows] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { user_id: userId },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            organization_id: true,
            organization: {
              select: { id: true, name: true, slug: true, suspended_at: true },
            },
            created_at: true,
          },
        },
      },
      orderBy: { last_active_at: 'desc' },
    }),
    prisma.organizationMember.findMany({
      where: { user_id: userId },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, suspended_at: true },
        },
      },
    }),
    prisma.workspaceJoinRequest.findMany({
      where: {
        user_id: userId,
        status: 'PENDING',
      },
      select: { workspace_id: true },
    }),
    (session.user as any).isPlatformAdmin !== undefined
      ? Promise.resolve([{ is_platform_admin: Boolean((session.user as any).isPlatformAdmin) }])
      : prisma.$queryRaw<{ is_platform_admin: boolean }[]>`
          SELECT is_platform_admin FROM "User" WHERE id = ${userId} LIMIT 1
        `,
  ]);

  // Suspended organizations and suspended memberships disappear immediately.
  const activeOrgMemberships = orgMemberships.filter(
    (om) => !om.suspended_at && !om.organization.suspended_at
  );
  const activeOrgIds = new Set(activeOrgMemberships.map((om) => om.organization_id));
  const visibleMemberships = memberships.filter(
    (m) => !m.workspace.organization_id || activeOrgIds.has(m.workspace.organization_id)
  );

  if (visibleMemberships.length === 0 && activeOrgMemberships.length === 0) {
    const suspendedOrg =
      orgMemberships.find((om) => om.organization.suspended_at)?.organization ||
      memberships.find((m) => m.workspace.organization?.suspended_at)?.workspace.organization;

    if (suspendedOrg) {
      redirect(`/suspended?org=${encodeURIComponent(suspendedOrg.id)}`);
    }
  }

  const userOrgIds = Array.from(
    new Set([
      ...activeOrgMemberships.map((om) => om.organization_id),
      ...visibleMemberships.map((m) => m.workspace.organization_id).filter(Boolean) as string[],
    ])
  );

  const organizationName =
    activeOrgMemberships[0]?.organization.name ||
    visibleMemberships[0]?.workspace.organization?.name ||
    '';

  const organizationSlug =
    activeOrgMemberships[0]?.organization.slug ||
    visibleMemberships[0]?.workspace.organization?.slug ||
    '';

  const workspaceIds = visibleMemberships.map(m => m.workspace.id);

  // Check if user can create workspaces (strictly Organization OWNER or ADMIN only)
  const isOrgAdmin = activeOrgMemberships.some((om) => om.role === 'OWNER' || om.role === 'ADMIN') ||
    visibleMemberships.some((m) => m.role === 'OWNER');
  const canCreateWorkspace = Boolean(isOrgAdmin);

  const [projectCounts, allWorkspaces, pendingOrgRequestsCount] = await Promise.all([
    workspaceIds.length > 0
      ? prisma.project.groupBy({
          by: ['workspace_id'],
          where: {
            workspace_id: { in: workspaceIds },
            deleted_at: null,
          },
          _count: { id: true },
        })
      : Promise.resolve([]),
    userOrgIds.length > 0
      ? prisma.workspace.findMany({
          where: {
            organization_id: { in: userOrgIds },
            id: { notIn: workspaceIds },
          },
          select: {
            id: true,
            name: true,
            slug: true,
          },
          orderBy: { created_at: 'desc' },
        })
      : Promise.resolve([]),
    isOrgAdmin && userOrgIds.length > 0
      ? prisma.organizationJoinRequest.count({
          where: {
            organization_id: { in: userOrgIds },
            status: 'PENDING',
            user: { is_approved: false },
          },
        })
      : Promise.resolve(0),
  ]);

  const projectCountMap = new Map(
    projectCounts.map(pc => [pc.workspace_id, pc._count.id])
  );

  const workspaces = visibleMemberships.map(m => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    role: m.role,
    projectCount: projectCountMap.get(m.workspace.id) || 0,
    createdAt: m.workspace.created_at.toISOString(),
  }));

  const pendingRequestWorkspaceIds = pendingRequests.map(r => r.workspace_id);
  const isPlatformAdmin = Boolean(platRows[0]?.is_platform_admin);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 mesh-gradient opacity-60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />
      <div className="absolute top-20 left-10 w-72 h-72 bg-primary/20 dark:bg-primary/10 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-cyan-500/20 dark:bg-cyan-500/10 rounded-full blur-3xl animate-float animation-delay-300" />

      <TopBar />

      <main className="relative pt-20 px-4 md:px-8 pb-8">
        <div className="max-w-6xl mx-auto">
          <WorkspacesClient
            organizationName={organizationName}
            organizationSlug={organizationSlug}
            isOrgAdmin={canCreateWorkspace}
            isPlatformAdmin={isPlatformAdmin}
            pendingOrgRequestsCount={pendingOrgRequestsCount}
            workspaces={workspaces}
            availableWorkspaces={allWorkspaces}
            canCreateWorkspace={canCreateWorkspace}
            pendingRequestWorkspaceIds={pendingRequestWorkspaceIds}
          />
        </div>
      </main>
    </div>
  );
}
