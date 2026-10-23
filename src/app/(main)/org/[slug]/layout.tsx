import { TopBar } from '@/components/layout/TopBar';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { Building2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OrgPortalNav } from './OrgPortalNav';

export default async function OrgPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect('/login');
  }

  const userId = (session.user as any).id as number;

  const organization = await prisma.organization.findUnique({
    where: { slug },
    include: {
      members: {
        where: { user_id: userId },
      },
      workspaces: {
        where: {
          members: {
            some: { user_id: userId, role: 'OWNER' },
          },
        },
      },
    },
  });

  if (!organization) {
    notFound();
  }

  if (organization.suspended_at) {
    redirect(`/suspended?org=${encodeURIComponent(organization.id)}`);
  }

  const orgMember = organization.members[0];
  const isWsOwnerInOrg = organization.workspaces.length > 0;
  const platRows = await prisma.$queryRaw<{ is_platform_admin: boolean }[]>`
    SELECT is_platform_admin FROM "User" WHERE id = ${userId} LIMIT 1
  `;
  const isPlatAdmin = Boolean(platRows[0]?.is_platform_admin);
  const isOrgAdmin = Boolean(
    isPlatAdmin ||
      (orgMember && (orgMember.role === 'OWNER' || orgMember.role === 'ADMIN')) ||
      isWsOwnerInOrg
  );

  if (!isOrgAdmin) {
    redirect('/workspace');
  }

  const [membersCount, pendingApprovalsCount, invCountRows] = await Promise.all([
    prisma.organizationMember.count({
      where: { organization_id: organization.id },
    }),
    prisma.organizationJoinRequest.count({
      where: {
        organization_id: organization.id,
        status: 'PENDING',
      },
    }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM "OrganizationInvitation" WHERE organization_id = ${organization.id} AND status = 'PENDING'::"InvitationStatus"
    `,
  ]);

  const invitationsCount = Number(invCountRows[0]?.count || 0);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 mesh-gradient opacity-60 pointer-events-none" />
      <TopBar
        breadcrumbs={[
          { label: organization.name, href: '/workspace' },
          { label: 'Organization Console' },
        ]}
      />

      <main className="relative pt-20 px-4 md:px-8 pb-12 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-border/40">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono uppercase tracking-wider mb-1">
              <Building2 className="h-3.5 w-3.5" />
              <span>{organization.name}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              Organization Console
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              Manage organization members, workspace access requests, invitations, and corporate email domains.
            </p>
          </div>

          <Button asChild variant="outline">
            <Link href="/workspace">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to Workspaces
            </Link>
          </Button>
        </div>

        {/* Navigation Tabs */}
        <OrgPortalNav
          slug={slug}
          membersCount={membersCount}
          pendingApprovalsCount={pendingApprovalsCount}
          invitationsCount={invitationsCount}
        />

        {/* Content */}
        <div className="animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
