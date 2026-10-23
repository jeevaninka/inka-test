import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { SetupClient } from './SetupClient';

export default async function SetupPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id as number;

  // If user already has a workspace, redirect to workspace
  const existingMember = await prisma.workspaceMember.findFirst({
    where: { user_id: userId },
  });
  if (existingMember) redirect('/workspace');

  // Only Org Owners/Admins (or initial bootstrap) can use setup to create a workspace
  const isOrgAdmin = await prisma.organizationMember.findFirst({
    where: {
      user_id: userId,
      role: { in: ['OWNER', 'ADMIN'] },
    },
  });

  const workspaceCount = await prisma.workspace.count();
  if (!isOrgAdmin && workspaceCount > 0) {
    redirect('/workspace');
  }

  return (
    <SetupClient
      userName={session.user.name || session.user.email?.split('@')[0] || 'User'}
      userEmail={session.user.email || ''}
    />
  );
}
