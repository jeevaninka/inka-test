import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { generateDownloadUrl } from '@/lib/s3/presigned-url';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  try {
    const { id } = await params;

    // Get attachment
    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!attachment || !attachment.storage_key) {
      return apiErrorResponse('Attachment not found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    // Enforce authentication on all attachment downloads
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return apiErrorResponse(
        'Unauthorized: authentication required to access attachments',
        401,
        ErrorCodes.UNAUTHORIZED,
        requestId
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        workspace_members: true,
        project_members: true,
      },
    });

    if (!user) {
      return apiErrorResponse('User not found', 401, ErrorCodes.UNAUTHORIZED, requestId);
    }

    // Verify workspace or project membership
    const hasWorkspaceAccess = user.workspace_members.some((wm) => wm.workspace_id === attachment.workspace_id);
    const hasProjectAccess = user.project_members.some((pm) => pm.project_id === attachment.project_id);

    if (!hasWorkspaceAccess && !hasProjectAccess) {
      return apiErrorResponse('Access denied', 403, ErrorCodes.FORBIDDEN, requestId);
    }

    // Generate presigned download URL
    const downloadUrl = await generateDownloadUrl(attachment.storage_key);

    // If client explicitly asks for JSON metadata
    if (req.nextUrl.searchParams.get('json') === 'true') {
      return NextResponse.json(
        {
          downloadUrl,
          filename: attachment.filename,
          mimeType: attachment.mime_type,
          sizeBytes: attachment.size_bytes,
        },
        { status: 200 }
      );
    }

    // Default: Redirect browser, iframe, img, or fetch directly to storage URL
    return NextResponse.redirect(downloadUrl, {
      status: 302,
    });
  } catch (e: any) {
    const normalized = normalizeError(e, ErrorCodes.S3_STORAGE, 'Failed to generate download URL');
    logger.error('Download URL generation failed', {
      module: 'Attachments',
      action: 'download',
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
