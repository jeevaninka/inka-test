import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth.config';
import { InviteClient } from './InviteClient';

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <InviteClient
        status="INVALID"
        error="Missing invitation token. Please check your link or contact your workspace administrator."
      />
    );
  }

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          organization: { select: { name: true } },
        },
      },
    },
  });

  if (!invitation) {
    const orgInvRows = await prisma.$queryRaw<
      {
        id: string;
        organization_id: string;
        email: string;
        role: string;
        status: string;
        invited_by: number;
        expires_at: Date;
        org_name: string;
        org_slug: string;
      }[]
    >`
      SELECT i.id, i.organization_id, i.email, i.role::text as role, i.status::text as status,
             i.invited_by, i.expires_at, o.name as org_name, o.slug as org_slug
      FROM "OrganizationInvitation" i
      JOIN "Organization" o ON o.id = i.organization_id
      WHERE i.token = ${token}
    `;

    const orgInvitation = orgInvRows[0];

    if (!orgInvitation) {
      return (
        <InviteClient
          status="INVALID"
          error="This invitation could not be found. It may have been deleted or the link is invalid."
        />
      );
    }

    const grantCountRows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM "OrganizationInvitationWorkspaceGrant" WHERE invitation_id = ${orgInvitation.id}
    `;
    const grantCount = Number(grantCountRows[0]?.count || 0);

    if (orgInvitation.status === 'ACCEPTED') {
      const session = await getServerSession(authOptions);
      if (session?.user) {
        redirect('/workspace');
      }
      redirect(`/login?email=${encodeURIComponent(orgInvitation.email)}`);
    }

    if (orgInvitation.status === 'REJECTED') {
      return (
        <InviteClient
          status="REVOKED"
          error="This invitation has been revoked by an organization administrator."
        />
      );
    }

    if (new Date(orgInvitation.expires_at) < new Date()) {
      return (
        <InviteClient
          status="EXPIRED"
          error="This invitation link has expired. Please ask your administrator to resend the invite."
        />
      );
    }

    const orgInviter = await prisma.user.findUnique({
      where: { id: orgInvitation.invited_by },
      select: { name: true, email: true },
    });

    const session = await getServerSession(authOptions);

    return (
      <InviteClient
        status="VALID"
        token={token}
        email={orgInvitation.email}
        role={orgInvitation.role}
        isOrgInvitation={true}
        organizationName={orgInvitation.org_name}
        workspaceName={`${grantCount} workspace(s)`}
        workspaceSlug="workspace"
        inviterName={orgInviter?.name || orgInviter?.email || 'An organization administrator'}
        sessionEmail={session?.user?.email ? session.user.email.toLowerCase().trim() : null}
      />
    );
  }

  if (invitation.status === 'ACCEPTED') {
    const session = await getServerSession(authOptions);
    if (session?.user) {
      redirect('/workspace');
    }
    redirect(`/login?email=${encodeURIComponent(invitation.email)}`);
  }

  if (invitation.status === 'REJECTED') {
    return (
      <InviteClient
        status="REVOKED"
        error="This invitation has been revoked by an administrator."
      />
    );
  }

  if (invitation.expires_at < new Date()) {
    return (
      <InviteClient
        status="EXPIRED"
        error="This invitation link has expired. Please ask your administrator to resend the invite."
      />
    );
  }

  const inviter = await prisma.user.findUnique({
    where: { id: invitation.invited_by },
    select: { name: true, email: true },
  });

  const session = await getServerSession(authOptions);

  return (
    <InviteClient
      status="VALID"
      token={token}
      email={invitation.email}
      role={invitation.role}
      workspaceName={invitation.workspace.name}
      workspaceSlug={invitation.workspace.slug}
      organizationName={invitation.workspace.organization?.name || 'InkaTest'}
      inviterName={inviter?.name || inviter?.email || 'A team administrator'}
      sessionEmail={session?.user?.email ? session.user.email.toLowerCase().trim() : null}
    />
  );
}
