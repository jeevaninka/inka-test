import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getOrganizationMembersAction } from '@/app/actions/organization-invitations';
import { OrgMembersClient } from './OrgMembersClient';

export const dynamic = 'force-dynamic';

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const data = await getOrganizationMembersAction(slug);

  return (
    <OrgMembersClient
      organizationId={data.organization.id}
      organizationName={data.organization.name}
      workspaces={data.workspaces}
      initialMembers={data.members}
      currentUserId={data.currentUserId}
    />
  );
}
