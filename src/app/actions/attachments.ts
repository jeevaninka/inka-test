'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { generateUploadUrl, uploadToS3 } from '@/lib/s3/presigned-url';
import { logger } from '@/lib/logger';
import { requireProjectMember, requireProjectMemberByAttachmentId } from '@/lib/permissions';

export async function uploadFileAction(
  data: FormData | {
    filename: string;
    mimeType: string;
    fileSize: number;
    entityId: string;
    entityType: string;
    projectId?: string;
    fileBase64?: string;
  }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      throw new Error('Unauthorized');
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { workspace_members: { include: { workspace: true } } },
    });

    if (!user || !user.workspace_members.length) {
      throw new Error('User not found or has no workspaces');
    }

    const workspace = user.workspace_members[0].workspace;
    const workspaceId = workspace.id;

    if (data instanceof FormData) {
      const file = data.get('file') as File;
      const entityId = data.get('entityId') as string;
      const entityType = data.get('entityType') as string;
      let projectId = data.get('projectId') as string | null;

      if (!file || !entityId || !entityType) {
        throw new Error('Missing required fields in upload form');
      }

      if (file.size > 10 * 1024 * 1024) {
        throw new Error('File size exceeds 10MB limit');
      }

      if (!projectId) {
        const project = await prisma.project.findFirst({
          where: { workspace_id: workspaceId },
        });
        if (!project) throw new Error('Project not found');
        projectId = project.id;
      }

      await requireProjectMember(projectId, user.id);

      const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      const timestamp = Date.now();
      const key = `attachments/${workspaceId}/${projectId}/${entityType}/${entityId}/${timestamp}-${sanitizedFilename}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = file.type || 'application/octet-stream';

      await uploadToS3(key, buffer, mimeType);

      const attachment = await prisma.attachment.create({
        data: {
          workspace_id: workspaceId,
          project_id: projectId,
          entity_type: entityType,
          entity_id: entityId,
          filename: sanitizedFilename,
          original_filename: file.name,
          mime_type: mimeType,
          size_bytes: file.size,
          storage_type: 'S3',
          storage_key: key,
          uploaded_by: user.id,
          status: 'ACTIVE',
        },
      });

      return {
        success: true,
        attachmentId: attachment.id,
        key,
        attachment,
      };
    }

    let projectId = data.projectId;
    if (!projectId) {
      const project = await prisma.project.findFirst({
        where: { workspace_id: workspaceId },
      });
      if (!project) throw new Error('Project not found');
      projectId = project.id;
    }

    await requireProjectMember(projectId, user.id);

    // Generate S3 key
    const sanitizedFilename = data.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const timestamp = Date.now();
    const key = `attachments/${workspaceId}/${projectId}/${data.entityType}/${data.entityId}/${timestamp}-${sanitizedFilename}`;

    if (data.fileBase64) {
      const buffer = Buffer.from(data.fileBase64, 'base64');
      await uploadToS3(key, buffer, data.mimeType);

      const attachment = await prisma.attachment.create({
        data: {
          workspace_id: workspaceId,
          project_id: projectId,
          entity_type: data.entityType,
          entity_id: data.entityId,
          filename: sanitizedFilename,
          original_filename: data.filename,
          mime_type: data.mimeType,
          size_bytes: data.fileSize,
          storage_type: 'S3',
          storage_key: key,
          uploaded_by: user.id,
          status: 'ACTIVE',
        },
      });

      return {
        attachmentId: attachment.id,
        key,
        success: true,
        attachment,
      };
    }

    // Create attachment record
    const attachment = await prisma.attachment.create({
      data: {
        workspace_id: workspaceId,
        project_id: projectId,
        entity_type: data.entityType,
        entity_id: data.entityId,
        filename: sanitizedFilename,
        original_filename: data.filename,
        mime_type: data.mimeType,
        size_bytes: data.fileSize,
        storage_type: 'S3',
        storage_key: key,
        uploaded_by: user.id,
        status: 'PENDING',
      },
    });

    // Validate file size
    if (data.fileSize > 10 * 1024 * 1024) {
      throw new Error('File size exceeds 10MB limit');
    }

    // Generate presigned upload URL
    const uploadUrl = await generateUploadUrl(
      key,
      data.mimeType,
      data.fileSize
    );

    return {
      uploadUrl,
      attachmentId: attachment.id,
      key,
      success: true,
    };
  } catch (e: any) {
    logger.error('File upload action failed', {
      module: 'Attachments',
      action: 'uploadFileAction',
      error: e.message,
    });
    throw e;
  }
}

export async function addExternalLinkAction(data: {
  url: string;
  title?: string;
  description?: string;
  previewUrl?: string;
  entityId: string;
  entityType: string;
  projectId?: string;
}) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      throw new Error('Unauthorized');
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { workspace_members: { include: { workspace: true } } },
    });

    if (!user || !user.workspace_members.length) {
      throw new Error('User not found or has no workspaces');
    }

    const workspace = user.workspace_members[0].workspace;
    const workspaceId = workspace.id;

    let projectId = data.projectId;
    if (!projectId) {
      const project = await prisma.project.findFirst({
        where: { workspace_id: workspaceId },
      });
      if (!project) throw new Error('Project not found');
      projectId = project.id;
    }

    await requireProjectMember(projectId, user.id);

    // Create attachment record
    const attachment = await prisma.attachment.create({
      data: {
        workspace_id: workspaceId,
        project_id: projectId,
        entity_type: data.entityType,
        entity_id: data.entityId,
        filename: data.title || 'External Link',
        storage_type: 'EXTERNAL_LINK',
        storage_key: data.url,
        external_url: data.url,
        preview_url: data.previewUrl,
        title: data.title,
        description: data.description,
        uploaded_by: user.id,
        status: 'ACTIVE',
      },
    });

    return {
      attachmentId: attachment.id,
      success: true,
    };
  } catch (e: any) {
    logger.error('External link action failed', {
      module: 'Attachments',
      action: 'addExternalLinkAction',
      error: e.message,
    });
    throw e;
  }
}

export async function completeUploadAction(attachmentId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      throw new Error('Unauthorized');
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) throw new Error('User not found');
    await requireProjectMemberByAttachmentId(attachmentId, user.id);

    const attachment = await prisma.attachment.update({
      where: { id: attachmentId },
      data: { status: 'ACTIVE' },
    });

    return {
      success: true,
      attachment,
    };
  } catch (e: any) {
    logger.error('Upload completion action failed', {
      module: 'Attachments',
      action: 'completeUploadAction',
      error: e.message,
    });
    throw e;
  }
}

export async function deleteAttachmentAction(attachmentId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      throw new Error('Unauthorized');
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) throw new Error('User not found');
    await requireProjectMemberByAttachmentId(attachmentId, user.id);

    const attachment = await prisma.attachment.update({
      where: { id: attachmentId },
      data: { status: 'DELETED' },
    });

    return {
      success: true,
      attachment,
    };
  } catch (e: any) {
    logger.error('Attachment deletion failed', {
      module: 'Attachments',
      action: 'deleteAttachmentAction',
      error: e.message,
    });
    throw e;
  }
}

export async function getAttachmentsAction(entityId: string, entityType: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      throw new Error('Unauthorized');
    }

    const userId = (session.user as any).id as number;

    const attachments = await prisma.attachment.findMany({
      where: {
        entity_id: entityId,
        entity_type: entityType,
        status: 'ACTIVE',
      },
      orderBy: { created_at: 'desc' },
    });

    if (attachments.length > 0) {
      await requireProjectMember(attachments[0].project_id, userId);
    }

    return {
      success: true,
      attachments,
    };
  } catch (e: any) {
    logger.error('Get attachments action failed', {
      module: 'Attachments',
      action: 'getAttachmentsAction',
      error: e.message,
    });
    throw e;
  }
}