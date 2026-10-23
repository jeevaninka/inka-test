import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth.config';
import { getOrgSuspension, getUserSuspension, type SuspensionInfo } from '@/lib/access';
import { SuspendedClient } from './SuspendedClient';

export const dynamic = 'force-dynamic';

export default async function SuspendedPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const userId = Number((session.user as any).id);
  const { org } = await searchParams;

  let suspension: SuspensionInfo | null = null;

  if (org) {
    suspension = await getOrgSuspension(userId, org);
  }

  if (!suspension) {
    suspension = await getUserSuspension(userId);
  }

  // Not suspended (or suspension was lifted) — send them back into the app.
  if (!suspension) {
    redirect('/workspace');
  }

  return (
    <SuspendedClient
      organizationName={suspension.organizationName}
      kind={suspension.kind}
      reason={suspension.reason}
      userEmail={session.user.email || ''}
    />
  );
}
