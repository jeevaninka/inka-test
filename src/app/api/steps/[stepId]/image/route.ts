import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { requireProjectMemberByStepId } from '@/lib/permissions';
import { s3Client, getBucketName } from '@/lib/s3/client';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stepId: string }> }
) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const start = performance.now();

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      logger.warn('[Steps] Unauthorized image access attempt', {
        module: 'Steps',
        action: 'imageServe',
        requestId,
        stepId: (await params).stepId,
        status: 401,
      });
      return apiErrorResponse('Unauthorized: authentication required', 401, ErrorCodes.UNAUTHORIZED, requestId);
    }

    const userId = Number((session.user as any).id);
    const { stepId } = await params;

    logger.debug('[Steps] --> GET step image', {
      module: 'Steps',
      action: 'imageServe',
      requestId,
      userId: String(userId),
      stepId,
    });

    await requireProjectMemberByStepId(stepId, userId, 'VIEWER');

    const step = await prisma.testCaseStep.findUnique({
      where: { id: stepId },
      select: { image_url: true },
    });

    if (!step?.image_url) {
      logger.warn('[Steps] No image found for step', {
        module: 'Steps',
        action: 'imageServe',
        requestId,
        stepId,
        status: 404,
      });
      return apiErrorResponse('No image found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    // 1. Direct URLs (e.g. external link or CDN)
    if (step.image_url.startsWith('http://') || step.image_url.startsWith('https://')) {
      const durationMs = Math.round(performance.now() - start);
      logger.info('[Steps] Redirecting to external image URL', {
        module: 'Steps',
        action: 'imageServe',
        requestId,
        stepId,
        durationMs,
      });
      return NextResponse.redirect(step.image_url, 302);
    }

    // 2. Data URIs
    if (step.image_url.startsWith('data:image/')) {
      const parts = step.image_url.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
      const buffer = Buffer.from(parts[1], 'base64');
      const durationMs = Math.round(performance.now() - start);
      logger.info('[Steps] Served step image (data URI)', {
        module: 'Steps',
        action: 'imageServe',
        requestId,
        stepId,
        durationMs,
      });
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'x-request-id': requestId,
        },
      });
    }

    const bucket = getBucketName();
    if (!bucket) {
      const durationMs = Math.round(performance.now() - start);
      logger.error('[Steps] Storage not configured', {
        module: 'Steps',
        action: 'imageServe',
        requestId,
        stepId,
        durationMs,
        errorCode: ErrorCodes.S3_STORAGE,
      });
      return apiErrorResponse('Storage not configured', 503, ErrorCodes.S3_STORAGE, requestId);
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: step.image_url,
    });

    const s3Response = await s3Client.send(command);

    if (!s3Response.Body) {
      const durationMs = Math.round(performance.now() - start);
      logger.warn('[Steps] Empty image stream from S3', {
        module: 'Steps',
        action: 'imageServe',
        requestId,
        stepId,
        durationMs,
        status: 404,
      });
      return apiErrorResponse('Image not found in storage', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    const byteArray = await s3Response.Body.transformToByteArray();
    const contentType = s3Response.ContentType || 'image/png';
    const buffer = Buffer.from(byteArray);
    const durationMs = Math.round(performance.now() - start);

    logger.info('[Steps] Served step image from S3', {
      module: 'Steps',
      action: 'imageServe',
      requestId,
      stepId,
      bucket,
      key: step.image_url,
      contentType,
      sizeBytes: buffer.length,
      durationMs,
    });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...(s3Response.ContentLength ? { 'Content-Length': String(s3Response.ContentLength) } : {}),
        'x-request-id': requestId,
      },
    });
  } catch (e: any) {
    const durationMs = Math.round(performance.now() - start);

    if (
      e.name === 'NoSuchKey' ||
      e.name === 'NotFound' ||
      e.$metadata?.httpStatusCode === 404 ||
      e.message?.includes('bucket') ||
      e.message?.includes('credentials') ||
      e.message?.includes('connect')
    ) {
      logger.warn('[Steps] Image not found in storage', {
        module: 'Steps',
        action: 'imageServe',
        requestId,
        stepId: (await params).stepId,
        durationMs,
        reason: e.message,
        status: 404,
      });
      return apiErrorResponse(
        'Image not found in storage',
        404,
        ErrorCodes.NOT_FOUND,
        requestId,
        { details: e.message }
      );
    }

    const normalized = normalizeError(e, ErrorCodes.INTERNAL, 'Failed to serve step image');
    logger.error('[Steps] Failed to serve step image', {
      module: 'Steps',
      action: 'imageServe',
      requestId,
      stepId: (await params).stepId,
      durationMs,
      errorCode: normalized.code,
      error: e,
    });

    return apiErrorResponse(
      normalized.message,
      normalized.status,
      normalized.code,
      requestId,
      { details: e.message }
    );
  }
}
