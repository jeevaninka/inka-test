'use server';

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getCachedServerSession } from "@/lib/auth.config";
import { requireProjectMemberByRunId } from "@/lib/permissions";
import crypto from "crypto";

export type ShareExpiry = "7d" | "30d" | "never";

interface CreateShareResult {
  ok: boolean;
  token?: string | null;
  expiresAt?: Date | null;
  url?: string | null;
  error?: string | null;
}

export async function createRunReportShare(
  runId: string,
  expiry: ShareExpiry = "7d",
): Promise<CreateShareResult> {
  try {
    const session = await getCachedServerSession();
    const userId = session?.user ? Number((session.user as any).id) : null;
    if (userId != null) {
      await requireProjectMemberByRunId(runId, userId, "VIEWER");
    }

    let expiresAt: Date | null = null;
    if (expiry === "7d") {
      expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    } else if (expiry === "30d") {
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    // ≥128-bit random token (32 bytes hex = 256 bits)
    const token = crypto.randomBytes(32).toString("hex");

    const share = await prisma.runReportShare.create({
      data: {
        runId,
        token,
        expiresAt,
        createdBy: userId ?? undefined,
      },
    });

    const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const url = `${base}/r/${runId}/report/share/${share.token}`;

    return { ok: true, token: share.token, expiresAt: share.expiresAt, url };
  } catch (err: any) {
    logger.error("Failed to create run report share", { module: "ReportShare", runId, error: err });
    return { ok: false, error: err?.message || "Failed to create share link" };
  }
}

export async function revokeRunReportShare(runId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await getCachedServerSession();
    const userId = session?.user ? Number((session.user as any).id) : null;
    if (userId != null) {
      await requireProjectMemberByRunId(runId, userId, "VIEWER");
    }

    await prisma.runReportShare.updateMany({
      where: { runId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { ok: true };
  } catch (err: any) {
    logger.error("Failed to revoke run report share", { module: "ReportShare", runId, error: err });
    return { ok: false, error: err?.message || "Failed to revoke share link" };
  }
}

export async function getRunReportShareByToken(token: string) {
  try {
    const share = await prisma.runReportShare.findUnique({
      where: { token },
      include: {
        run: {
          select: {
            id: true,
            name: true,
            project: { select: { id: true, name: true, slug: true } },
            status: true,
            started_at: true,
            completed_at: true,
          },
        },
      },
    });

    if (!share) return null;

    // Revoked or expired
    if (share.revokedAt != null) return null;
    if (share.expiresAt != null && share.expiresAt.getTime() < Date.now()) return null;

    return share;
  } catch (err: any) {
    logger.error("Failed to fetch run report share", { module: "ReportShare", token, error: err });
    return null;
  }
}
