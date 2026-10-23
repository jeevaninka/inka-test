import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { generateProjectId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';

export async function GET(req: Request) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return apiErrorResponse('Unauthorized', 401, ErrorCodes.UNAUTHORIZED, requestId);
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get('workspaceId');

  if (!workspaceId) {
    return apiErrorResponse('workspaceId is required', 400, ErrorCodes.VALIDATION, requestId);
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return apiErrorResponse('User not found', 404, ErrorCodes.NOT_FOUND, requestId);

    // Verify user belongs to workspace
    const member = await prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: user.id } },
    });
    if (!member) return apiErrorResponse('Access denied', 403, ErrorCodes.FORBIDDEN, requestId);

    const projects = await prisma.project.findMany({
      where: { workspace_id: workspaceId, deleted_at: null },
      orderBy: { created_at: 'desc' },
      include: { members: true },
    });
    return NextResponse.json(projects);
  } catch (error) {
    const normalized = normalizeError(error, ErrorCodes.DB_FAILURE, 'Failed to fetch projects');
    logger.error('Failed to fetch projects', {
      module: 'ProjectsAPI',
      action: 'listProjects',
      workspaceId,
      requestId,
      errorCode: normalized.code,
      error,
    });
    return apiErrorResponse(normalized.message, normalized.status, normalized.code, requestId);
  }
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return apiErrorResponse('Unauthorized', 401, ErrorCodes.UNAUTHORIZED, requestId);
  }

  try {
    const body = await req.json();
    const { workspace_id, name, slug, created_by } = body;

    if (!workspace_id || !name || !slug || !created_by) {
      return apiErrorResponse(
        'workspace_id, name, slug, and created_by are required',
        400,
        ErrorCodes.VALIDATION,
        requestId
      );
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return apiErrorResponse('User not found', 404, ErrorCodes.NOT_FOUND, requestId);

    // Verify user has admin/owner role in workspace
    const member = await prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id, user_id: user.id } },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
      return apiErrorResponse(
        'Only workspace owners and admins can create projects',
        403,
        ErrorCodes.FORBIDDEN,
        requestId
      );
    }

    const creatorId = typeof created_by === 'string' ? parseInt(created_by, 10) : created_by;
    const id = await generateProjectId();

    const project = await prisma.project.create({
      data: {
        id,
        workspace_id,
        name,
        slug,
        created_by: creatorId,
      },
      include: { members: true },
    });

    logger.info('Project created via API', {
      module: 'ProjectsAPI',
      action: 'createProject',
      projectId: project.id,
      workspaceId: workspace_id,
      userId: user.id,
      requestId,
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error: any) {
    if (error.code === 'P2002') {
      logger.warn('Duplicate project slug conflict', {
        module: 'ProjectsAPI',
        action: 'createProject',
        requestId,
      });
      return apiErrorResponse(
        'Project with this slug already exists in workspace',
        409,
        ErrorCodes.DB_CONFLICT,
        requestId
      );
    }
    const normalized = normalizeError(error, ErrorCodes.DB_FAILURE, 'Failed to create project');
    logger.error('Failed to create project', {
      module: 'ProjectsAPI',
      action: 'createProject',
      requestId,
      errorCode: normalized.code,
      error,
    });
    return apiErrorResponse(normalized.message, normalized.status, normalized.code, requestId);
  }
}
