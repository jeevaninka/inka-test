import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { requireProjectMemberByAttachmentId } from '@/lib/permissions';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';

export async function PATCH(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return apiErrorResponse('Unauthorized', 401, ErrorCodes.UNAUTHORIZED, requestId);
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return apiErrorResponse('User not found', 404, ErrorCodes.NOT_FOUND, requestId);

    const body = await req.json();
    const { attachmentId } = body;

    if (!attachmentId) {
      return apiErrorResponse('Missing attachmentId', 400, ErrorCodes.VALIDATION, requestId);
    }

    await requireProjectMemberByAttachmentId(attachmentId, user.id);

    const attachment = await prisma.attachment.update({
      where: { id: attachmentId },
      data: { status: 'ACTIVE' },
    });

    logger.info('Upload completed', {
      module: 'Attachments',
      action: 'complete',
      attachmentId,
      userId: user.id,
      requestId,
    });

    return NextResponse.json({
      success: true,
      attachment: {
        id: attachment.id,
        filename: attachment.filename,
        storage_type: attachment.storage_type,
        status: attachment.status,
      },
    });
  } catch (e: any) {
    const normalized = normalizeError(e, ErrorCodes.S3_STORAGE, 'Failed to complete upload');
    logger.error('Upload completion failed', {
      module: 'Attachments',
      action: 'complete',
      requestId,
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