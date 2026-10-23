import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { generateDeleteUrl } from '@/lib/s3/presigned-url';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return apiErrorResponse('Unauthorized', 401, ErrorCodes.UNAUTHORIZED, requestId);
  }

  const { id } = await params;
  return NextResponse.redirect(new URL(`/api/v1/attachments/${id}/download`, req.url));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return apiErrorResponse('Unauthorized', 401, ErrorCodes.UNAUTHORIZED, requestId);
    }

    const { id } = await params;

    // Get attachment
    const attachment = await prisma.attachment.findUnique({
      where: { id },
    });

    if (!attachment) {
      return apiErrorResponse('Attachment not found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    // Verify user has permission
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        workspace_members: true,
        project_members: true,
      },
    });

    if (!user) {
      return apiErrorResponse('User not found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    const wm = user.workspace_members.find((m) => m.workspace_id === attachment.workspace_id);
    const pm = user.project_members.find((m) => m.project_id === attachment.project_id);

    const isWorkspaceAdminOrOwner = wm && (wm.role === 'OWNER' || wm.role === 'ADMIN');
    const isProjectAdmin = pm && pm.role === 'ADMIN';
    const isUploader = attachment.uploaded_by === user.id;

    if (!isWorkspaceAdminOrOwner && !isProjectAdmin && !isUploader) {
      return apiErrorResponse(
        'Access denied: only uploader or administrator can delete this attachment',
        403,
        ErrorCodes.FORBIDDEN,
        requestId
      );
    }

    // Delete from S3 if it's an S3 file
    if (attachment.storage_type === 'S3' && attachment.storage_key) {
      try {
        const deleteUrl = await generateDeleteUrl(attachment.storage_key);
        await fetch(deleteUrl, { method: 'DELETE' });
      } catch (e: any) {
        logger.warn('S3 delete failed, proceeding with soft delete', {
          module: 'Attachments',
          action: 'delete',
          attachmentId: id,
          reason: e.message,
          requestId,
        });
      }
    }

    // Soft delete
    await prisma.attachment.update({
      where: { id },
      data: { status: 'DELETED' },
    });

    logger.info('Attachment deleted', {
      module: 'Attachments',
      action: 'delete',
      attachmentId: id,
      userId: String(user.id),
      requestId,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    const normalized = normalizeError(e, ErrorCodes.S3_STORAGE, 'Failed to delete attachment');
    logger.error('Attachment deletion failed', {
      module: 'Attachments',
      action: 'delete',
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
