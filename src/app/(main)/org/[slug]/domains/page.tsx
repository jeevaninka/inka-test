import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getOrganizationDomainsAction } from '@/app/actions/organization-invitations';
import { DomainsClient } from './DomainsClient';

export const dynamic = 'force-dynamic';

export default async function OrgDomainsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const data = await getOrganizationDomainsAction(slug);

  return (
    <DomainsClient
      organizationId={data.organizationId}
      organizationName={data.organizationName}
      initialDomains={data.domains}
      initialAllowRequests={data.allowDomainRequests}
    />
  );
}
