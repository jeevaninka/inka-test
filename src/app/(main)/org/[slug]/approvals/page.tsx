import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { redirect, notFound } from 'next/navigation';
import { ApprovalsClient } from '@/app/(main)/workspace/[slug]/settings/approvals/ApprovalsClient';
import { getOrganizationJoinRequestsAction } from '@/app/actions/workspace';

export default async function OrganizationApprovalsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });

  if (!organization) notFound();

  // Fetch pending org join requests
  const mappedRequests = await getOrganizationJoinRequestsAction(organization.id);

  // Fetch all workspaces in the organization
  const organizationWorkspaces = await prisma.workspace.findMany({
    where: { organization_id: organization.id },
    select: { id: true, name: true, slug: true },
    orderBy: { created_at: 'asc' },
  });

  const workspaceIds = organizationWorkspaces.map((w) => w.id);

  // Fetch projects under these workspaces
  const projects = await prisma.project.findMany({
    where: { workspace_id: { in: workspaceIds }, deleted_at: null },
    select: { id: true, name: true, workspace_id: true },
    orderBy: { created_at: 'desc' },
  });

  return (
    <ApprovalsClient
      organizationName={organization.name}
      initialRequests={mappedRequests}
      workspaces={organizationWorkspaces}
      projects={projects}
      mode="organization"
    />
  );
}
