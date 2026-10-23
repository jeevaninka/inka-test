import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { redirect } from 'next/navigation';
import { checkIsPlatformAdmin } from '@/lib/auth/org-role';
import { getPlatformOrganizationsAction } from '@/app/actions/organization-invitations';
import { TopBar } from '@/components/layout/TopBar';
import { PlatformOrganizationsClient } from './PlatformOrganizationsClient';

export const dynamic = 'force-dynamic';

export default async function PlatformOrganizationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id as number;
  const isPlatAdmin = await checkIsPlatformAdmin(userId);
  if (!isPlatAdmin) {
    redirect('/workspace');
  }

  const organizations = await getPlatformOrganizationsAction();

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 mesh-gradient opacity-60 pointer-events-none" />
      <TopBar
        breadcrumbs={[
          { label: 'Workspaces', href: '/workspace' },
          { label: 'Platform Admin' },
        ]}
      />

      <main className="relative pt-20 px-4 md:px-8 pb-12 max-w-6xl mx-auto">
        <PlatformOrganizationsClient initialOrganizations={organizations} />
      </main>
    </div>
  );
}
