import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  try {
    const run = await (prisma as any).testRun?.findFirst({
      where: {
        OR: [
          { id: runId },
          { id: { equals: runId, mode: 'insensitive' } },
        ],
      },
      include: {
        project: { select: { slug: true, id: true } },
      },
    });

    if (run?.project?.slug) {
      return NextResponse.redirect(new URL(`/p/${run.project.slug}/runs/${run.id}`, request.url));
    }
  } catch (err) {
    logger.error('Failed to resolve run redirect slug', {
      module: 'RunRedirect',
      action: 'redirectRun',
      runId,
      errorCode: ErrorCodes.DB_FAILURE,
      error: err,
    });
  }

  // Fallback redirect if run is not found
  return NextResponse.redirect(new URL('/workspace', request.url));
}
