import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { generateUploadUrl, uploadToS3 } from '@/lib/s3/presigned-url';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';
import { requireProjectMember } from '@/lib/permissions';
import { hit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return apiErrorResponse('Unauthorized', 401, ErrorCodes.UNAUTHORIZED, requestId);
    }

    const contentType = req.headers.get('content-type') || '';

    // Get user and workspace
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { workspace_members: { include: { workspace: true } } },
    });

    if (!user || !user.workspace_members.length) {
      return apiErrorResponse('User not found or has no workspaces', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    // Abuse guard: uploads are the most expensive unauthenticated-shape endpoint.
    const uploadLimit = hit(`upload:${user.id}`, 60, 60 * 1000);
    if (!uploadLimit.allowed) {
      return apiErrorResponse(
        'Too many uploads. Please try again in a moment.',
        429,
        ErrorCodes.VALIDATION,
        requestId,
        { retryAfterSeconds: uploadLimit.retryAfterSeconds }
      );
    }

    const workspace = user.workspace_members[0].workspace;
    const workspaceId = workspace.id;

    // Direct multipart/form-data upload (Bypasses S3 CORS)
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const entityId = formData.get('entityId') as string | null;
      const entityType = formData.get('entityType') as string | null;
      const projectIdInput = formData.get('projectId') as string | null;

      if (!file || !entityId || !entityType) {
        return apiErrorResponse(
          'Missing required fields: file, entityId, entityType',
          400,
          ErrorCodes.VALIDATION,
          requestId
        );
      }

      if (file.size > 25 * 1024 * 1024) {
        return apiErrorResponse('File size exceeds 25MB limit', 400, ErrorCodes.VALIDATION, requestId);
      }

      let projectId = projectIdInput;
      if (!projectId) {
        const project = await prisma.project.findFirst({
          where: { workspace_id: workspaceId },
        });
        if (!project) return apiErrorResponse('Project not found', 404, ErrorCodes.NOT_FOUND, requestId);
        projectId = project.id;
      }

      // Tenant guard: a client-supplied project id must belong to a project the
      // caller is actually a member of. Without this check a member of workspace A
      // could attach files to a project in workspace B.
      const actualProjectId = await requireProjectMember(projectId, user.id);
      const targetProject = await prisma.project.findUnique({
        where: { id: actualProjectId },
        select: { workspace_id: true },
      });
      if (!targetProject) {
        return apiErrorResponse('Project not found', 404, ErrorCodes.NOT_FOUND, requestId);
      }
      projectId = actualProjectId;

      const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      const timestamp = Date.now();
      const key = `attachments/${targetProject.workspace_id}/${projectId}/${entityType}/${entityId}/${timestamp}-${sanitizedFilename}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mime = file.type || 'application/octet-stream';

      await uploadToS3(key, buffer, mime);

      const attachment = await prisma.attachment.create({
        data: {
          workspace_id: targetProject.workspace_id,
          project_id: projectId,
          entity_type: entityType,
          entity_id: entityId,
          filename: sanitizedFilename,
          original_filename: file.name,
          mime_type: mime,
          size_bytes: file.size,
          storage_type: 'S3',
          storage_key: key,
          uploaded_by: user.id,
          status: 'ACTIVE',
        },
      });

      logger.info('Direct S3 file uploaded', {
        module: 'Attachments',
        action: 'uploadMultipart',
        attachmentId: attachment.id,
        projectId,
        workspaceId,
        userId: user.id,
        fileSize: file.size,
        requestId,
      });

      return NextResponse.json({
        success: true,
        attachmentId: attachment.id,
        key,
        attachment,
      });
    }

    const body = await req.json();
    const { filename, mimeType, fileSize, entityId, entityType } = body;

    if (!filename || !mimeType || !fileSize || !entityId || !entityType) {
      return apiErrorResponse(
        'Missing required fields: filename, mimeType, fileSize, entityId, entityType',
        400,
        ErrorCodes.VALIDATION,
        requestId
      );
    }

    // Validate file size
    if (fileSize > 10 * 1024 * 1024) {
      return apiErrorResponse('File size exceeds 10MB limit', 400, ErrorCodes.VALIDATION, requestId);
    }

    // Get project to verify access
    const actualProjectId = await requireProjectMember(body.projectId, user.id);
    const project = await prisma.project.findFirst({
      where: {
        id: actualProjectId,
      },
    });

    if (!project) {
      return apiErrorResponse('Project not found or access denied', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    // Generate S3 key
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const timestamp = Date.now();
    const key = `attachments/${project.workspace_id}/${project.id}/${entityType}/${entityId}/${timestamp}-${sanitizedFilename}`;

    // Create attachment record
    const attachment = await prisma.attachment.create({
      data: {
        workspace_id: project.workspace_id,
        project_id: project.id,
        entity_type: entityType,
        entity_id: entityId,
        filename: sanitizedFilename,
        original_filename: filename,
        mime_type: mimeType,
        size_bytes: fileSize,
        storage_type: 'S3',
        storage_key: key,
        uploaded_by: user.id,
        status: 'PENDING',
      },
    });

    // Generate presigned upload URL
    const uploadUrl = await generateUploadUrl(
      key,
      mimeType,
      fileSize
    );

    logger.info('Upload URL generated', {
      module: 'Attachments',
      action: 'upload',
      attachmentId: attachment.id,
      projectId: project.id,
      userId: user.id,
      fileSize,
      requestId,
    });

    return NextResponse.json({
      uploadUrl,
      attachmentId: attachment.id,
      key,
      type: 'FILE',
    });
  } catch (e: any) {
    const normalized = normalizeError(e, ErrorCodes.S3_STORAGE, 'Failed to generate upload URL');
    logger.error('Upload URL generation failed', {
      module: 'Attachments',
      action: 'upload',
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