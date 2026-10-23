import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { getExternalLinkPreview } from '@/lib/attachments/preview';
import { logger } from '@/lib/logger';
import { requireProjectMember } from '@/lib/permissions';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return apiErrorResponse('Unauthorized', 401, ErrorCodes.UNAUTHORIZED, requestId);
    }

    const body = await req.json();
    const { url, title, description, entityId, entityType, previewUrl, projectId } = body;

    if (!url || !entityId || !entityType || !projectId) {
      return apiErrorResponse(
        'Missing required fields: url, entityId, entityType, projectId',
        400,
        ErrorCodes.VALIDATION,
        requestId
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return apiErrorResponse('Invalid URL format', 400, ErrorCodes.VALIDATION, requestId);
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return apiErrorResponse('User not found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    // Verify project membership
    await requireProjectMember(projectId, user.id);

    // Get preview if not provided
    let finalPreviewUrl = previewUrl;
    let finalTitle = title;
    let finalDescription = description;

    if (!finalPreviewUrl || !finalTitle) {
      const preview = await getExternalLinkPreview(url);
      finalPreviewUrl = preview.thumbnailUrl || previewUrl;
      finalTitle = title || preview.title || 'External Link';
      finalDescription = description || preview.description;
    }

    // Get project workspace
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return apiErrorResponse('Project not found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    // Create attachment record
    const attachment = await prisma.attachment.create({
      data: {
        workspace_id: project.workspace_id,
        project_id: projectId,
        entity_type: entityType,
        entity_id: entityId,
        filename: finalTitle || 'External Link',
        storage_type: 'EXTERNAL_LINK',
        storage_key: url,
        external_url: url,
        preview_url: finalPreviewUrl,
        title: finalTitle,
        description: finalDescription,
        uploaded_by: user.id,
        status: 'ACTIVE',
      },
    });

    logger.info('External link added', {
      module: 'Attachments',
      action: 'link',
      attachmentId: attachment.id,
      projectId: project.id,
      userId: user.id,
      url,
      requestId,
    });

    return NextResponse.json({
      attachmentId: attachment.id,
      previewUrl: finalPreviewUrl,
      type: 'EXTERNAL_LINK',
    });
  } catch (e: any) {
    const normalized = normalizeError(e, ErrorCodes.INTERNAL, 'Failed to add external link');
    logger.error('External link addition failed', {
      module: 'Attachments',
      action: 'link',
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