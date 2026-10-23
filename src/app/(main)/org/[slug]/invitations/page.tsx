import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { redirect, notFound } from 'next/navigation';
import { getOrganizationInvitationsAction } from '@/app/actions/organization-invitations';
import { OrgInvitationsClient } from './OrgInvitationsClient';

export default async function OrgInvitationsPage({
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

  // Fetch all existing invitations for this organization
  const invitations = await getOrganizationInvitationsAction(organization.id);

  // Fetch all workspaces in this organization to allow granting
  const workspaces = await prisma.workspace.findMany({
    where: { organization_id: organization.id },
    select: { id: true, name: true, slug: true },
    orderBy: { created_at: 'asc' },
  });

  return (
    <OrgInvitationsClient
      organizationId={organization.id}
      organizationName={organization.name}
      organizationSlug={organization.slug}
      initialInvitations={invitations}
      workspaces={workspaces}
    />
  );
}
