import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

function generateJoinRequestId(): string {
  return `c${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export async function hasPendingInvitationForOrganization(
  email: string,
  organizationId: string
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const [orgInvite, workspaceInvite] = await Promise.all([
    prisma.organizationInvitation.findFirst({
      where: {
        organization_id: organizationId,
        email: { equals: normalizedEmail, mode: 'insensitive' },
        status: 'PENDING',
        expires_at: { gt: new Date() },
      },
      select: { id: true },
    }),
    prisma.invitation.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        status: 'PENDING',
        expires_at: { gt: new Date() },
        workspace: { organization_id: organizationId },
      },
      select: { id: true },
    }),
  ]);

  return Boolean(orgInvite || workspaceInvite);
}

/**
 * Idempotently creates (or refreshes) the single pending access request for a
 * user + organization pair. Backed by the partial unique index on PENDING rows.
 */
export async function upsertPendingOrganizationJoinRequest(input: {
  userId: number;
  organizationId: string;
  message?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const id = generateJoinRequestId();
  const message = input.message?.trim() || null;
  const pendingKey = `${input.userId}:${input.organizationId}`;

  const rows = await prisma.$queryRaw<{ id: string; inserted: boolean }[]>`
    INSERT INTO "OrganizationJoinRequest" ("id", "user_id", "organization_id", "message", "status", "pending_key", "created_at")
    VALUES (${id}, ${input.userId}, ${input.organizationId}, ${message}, 'PENDING'::"JoinRequestStatus", ${pendingKey}, NOW())
    ON CONFLICT ("pending_key")
    DO UPDATE SET "message" = COALESCE(EXCLUDED."message", "OrganizationJoinRequest"."message")
    RETURNING "id", (xmax = 0) AS "inserted"
  `;

  return {
    id: rows[0]?.id || id,
    created: Boolean(rows[0]?.inserted),
  };
}

/**
 * Closes every pending access request for a user inside an organization.
 * Used when an invitation is accepted (invite beats request).
 */
export async function closePendingAccessRequests(
  tx: Prisma.TransactionClient,
  userId: number,
  organizationId: string
): Promise<void> {
  const now = new Date();

  await tx.organizationJoinRequest.updateMany({
    where: {
      user_id: userId,
      organization_id: organizationId,
      status: 'PENDING',
    },
    data: { status: 'APPROVED', reviewed_at: now, pending_key: null },
  });

  await tx.workspaceJoinRequest.updateMany({
    where: {
      user_id: userId,
      status: 'PENDING',
      workspace: { organization_id: organizationId },
    },
    data: { status: 'APPROVED', reviewed_at: now },
  });
}
