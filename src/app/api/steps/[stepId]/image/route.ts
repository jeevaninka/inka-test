import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { requireProjectMemberByStepId } from '@/lib/permissions';
import { s3Client, getBucketName } from '@/lib/s3/client';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '@/lib/logger';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stepId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = Number((session.user as any).id);
    const { stepId } = await params;

    await requireProjectMemberByStepId(stepId, userId, 'VIEWER');

    const step = await prisma.testCaseStep.findUnique({
      where: { id: stepId },
      select: { image_url: true },
    });

    if (!step?.image_url) {
      return NextResponse.json({ error: 'No image found' }, { status: 404 });
    }

    // 1. Direct URLs (e.g. external link or CDN)
    if (step.image_url.startsWith('http://') || step.image_url.startsWith('https://')) {
      return NextResponse.redirect(step.image_url, 302);
    }

    // 2. Data URIs
    if (step.image_url.startsWith('data:image/')) {
      const parts = step.image_url.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
      const buffer = Buffer.from(parts[1], 'base64');
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    const bucket = getBucketName();
    if (!bucket) {
      return NextResponse.json({ error: 'Storage not configured' }, { status: 404 });
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: step.image_url,
    });

    const s3Response = await s3Client.send(command);

    if (!s3Response.Body) {
      return NextResponse.json({ error: 'Empty image stream' }, { status: 404 });
    }

    const byteArray = await s3Response.Body.transformToByteArray();
    const contentType = s3Response.ContentType || 'image/png';
    const buffer = Buffer.from(byteArray);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...(s3Response.ContentLength ? { 'Content-Length': String(s3Response.ContentLength) } : {}),
      },
    });
  } catch (e: any) {
    if (
      e.name === 'NoSuchKey' ||
      e.name === 'NotFound' ||
      e.$metadata?.httpStatusCode === 404 ||
      e.message?.includes('bucket') ||
      e.message?.includes('credentials') ||
      e.message?.includes('connect')
    ) {
      return NextResponse.json({ error: 'Image not found in storage' }, { status: 404 });
    }

    logger.warn('Step image serve unavailable', {
      module: 'Steps',
      action: 'image-serve',
      reason: e.message,
    });

    return NextResponse.json(
      { error: 'Image not found in storage', message: 'Image not found in storage', code: 'ERR_NOT_FOUND', details: e.message },
      { status: 404 }
    );
  }
}
