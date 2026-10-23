import { prisma } from '@/lib/db';
import { assertProjectAccess, assertWorkspaceAccess } from '@/lib/access';

const ID_CACHE_TTL_MS = 60_000;
const PERM_CACHE_TTL_MS = 15_000;

interface CachedProjectAccess {
  pmRole: 'ADMIN' | 'TESTER' | 'VIEWER' | null;
  wmRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST' | null;
  expiresAt: number;
}

const globalForPermissions = globalThis as unknown as {
  projectIdCache?: Map<string, { id: string; expiresAt: number }>;
  workspaceIdCache?: Map<string, { id: string; expiresAt: number }>;
  projectAccessCache?: Map<string, CachedProjectAccess>;
};

const projectIdCache =
  globalForPermissions.projectIdCache ?? new Map<string, { id: string; expiresAt: number }>();
const workspaceIdCache =
  globalForPermissions.workspaceIdCache ?? new Map<string, { id: string; expiresAt: number }>();
const projectAccessCache =
  globalForPermissions.projectAccessCache ?? new Map<string, CachedProjectAccess>();

if (process.env.NODE_ENV !== 'production') {
  globalForPermissions.projectIdCache = projectIdCache;
  globalForPermissions.workspaceIdCache = workspaceIdCache;
  globalForPermissions.projectAccessCache = projectAccessCache;
}

export async function resolveProjectId(projectIdOrSlug: string): Promise<string> {
  if (/^PRJ-\d+$/.test(projectIdOrSlug)) {
    return projectIdOrSlug;
  }

  const now = Date.now();
  const cached = projectIdCache.get(projectIdOrSlug);
  if (cached && cached.expiresAt > now) {
    return cached.id;
  }

  const project = await prisma.project.findFirst({
    where: {
      OR: [{ id: projectIdOrSlug }, { slug: projectIdOrSlug }],
    },
    select: { id: true },
  });

  if (project) {
    projectIdCache.set(projectIdOrSlug, { id: project.id, expiresAt: now + ID_CACHE_TTL_MS });
    return project.id;
  }

  return projectIdOrSlug;
}

export async function resolveWorkspaceId(workspaceIdOrSlug: string): Promise<string> {
  if (/^WS-\d+$/.test(workspaceIdOrSlug)) {
    return workspaceIdOrSlug;
  }

  const now = Date.now();
  const cached = workspaceIdCache.get(workspaceIdOrSlug);
  if (cached && cached.expiresAt > now) {
    return cached.id;
  }

  const ws = await prisma.workspace.findFirst({
    where: {
      OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }],
    },
    select: { id: true },
  });

  if (ws) {
    workspaceIdCache.set(workspaceIdOrSlug, { id: ws.id, expiresAt: now + ID_CACHE_TTL_MS });
    return ws.id;
  }

  return workspaceIdOrSlug;
}

async function getProjectAccess(actualProjectId: string, userId: number): Promise<CachedProjectAccess> {
  // Suspension must take effect immediately, so it is checked on every request
  // (never served from the role cache below).
  await assertProjectAccess(userId, actualProjectId);

  const cacheKey = `${actualProjectId}:${userId}`;
  const now = Date.now();
  const cached = projectAccessCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const [pm, wm] = await Promise.all([
    prisma.projectMember.findUnique({
      where: { project_id_user_id: { project_id: actualProjectId, user_id: userId } },
      select: { role: true },
    }),
    prisma.workspaceMember.findFirst({
      where: {
        user_id: userId,
        workspace: { projects: { some: { id: actualProjectId } } },
      },
      select: { role: true },
    }),
  ]);

  const entry: CachedProjectAccess = {
    pmRole: pm?.role ?? null,
    wmRole: wm?.role ?? null,
    expiresAt: now + PERM_CACHE_TTL_MS,
  };
  projectAccessCache.set(cacheKey, entry);
  return entry;
}

export async function requireWorkspaceMember(workspaceIdOrSlug: string, userId: number): Promise<string> {
  const actualWsId = await resolveWorkspaceId(workspaceIdOrSlug);

  const wm = await prisma.workspaceMember.findUnique({
    where: {
      workspace_id_user_id: {
        workspace_id: actualWsId,
        user_id: userId,
      },
    },
    select: { role: true },
  });

  if (!wm) {
    throw new Error('Forbidden: not a member of this workspace');
  }

  await assertWorkspaceAccess(userId, actualWsId);

  return actualWsId;
}

export async function requireWorkspaceAdmin(workspaceIdOrSlug: string, userId: number): Promise<string> {
  const actualWsId = await resolveWorkspaceId(workspaceIdOrSlug);

  const wm = await prisma.workspaceMember.findUnique({
    where: {
      workspace_id_user_id: {
        workspace_id: actualWsId,
        user_id: userId,
      },
    },
    select: { role: true },
  });

  if (!wm || (wm.role !== 'OWNER' && wm.role !== 'ADMIN')) {
    throw new Error('Forbidden: only workspace owner or admin can perform this action');
  }

  await assertWorkspaceAccess(userId, actualWsId);

  return actualWsId;
}

export async function requireProjectViewer(projectIdOrSlug: string, userId: number): Promise<string> {
  const actualProjectId = await resolveProjectId(projectIdOrSlug);
  const { pmRole, wmRole } = await getProjectAccess(actualProjectId, userId);

  if (pmRole || wmRole) {
    return actualProjectId;
  }

  throw new Error('Forbidden: not a member of this project');
}

export async function requireProjectMember(projectIdOrSlug: string, userId: number): Promise<string> {
  const actualProjectId = await resolveProjectId(projectIdOrSlug);
  const { pmRole, wmRole } = await getProjectAccess(actualProjectId, userId);

  // Check parent workspace role first: a Workspace GUEST is strictly read-only everywhere in that workspace
  if (wmRole === 'GUEST') {
    throw new Error('Forbidden: workspace guests have read-only access');
  }

  if (pmRole) {
    if (pmRole === 'VIEWER') {
      throw new Error('Forbidden: viewers cannot perform this action');
    }
    return actualProjectId;
  }

  if (!wmRole || (wmRole !== 'OWNER' && wmRole !== 'ADMIN' && wmRole !== 'MEMBER')) {
    throw new Error('Forbidden: not a member of this project');
  }

  return actualProjectId;
}

export async function requireProjectAdmin(projectIdOrSlug: string, userId: number): Promise<string> {
  const actualProjectId = await resolveProjectId(projectIdOrSlug);
  const { pmRole, wmRole } = await getProjectAccess(actualProjectId, userId);

  if (wmRole === 'GUEST') {
    throw new Error('Forbidden: workspace guests have read-only access');
  }

  if (pmRole === 'ADMIN') {
    return actualProjectId;
  }

  if (wmRole === 'OWNER' || wmRole === 'ADMIN') {
    return actualProjectId;
  }

  throw new Error('Only project admin or workspace owner/admin can perform this action');
}

export async function requireProjectMemberByCaseId(caseId: string, userId: number, role: 'VIEWER' | 'MEMBER' = 'MEMBER'): Promise<string> {
  const testCase = await prisma.testCase.findFirst({
    where: {
      OR: [{ id: caseId }, { display_id: caseId }],
    },
    select: { project_id: true },
  });
  if (!testCase) throw new Error('Test case not found');
  if (role === 'VIEWER') {
    await requireProjectViewer(testCase.project_id, userId);
  } else {
    await requireProjectMember(testCase.project_id, userId);
  }
  return testCase.project_id;
}

export async function requireProjectMemberByRunResultId(resultId: string, userId: number, role: 'VIEWER' | 'MEMBER' = 'MEMBER'): Promise<void> {
  const result = await prisma.runResult.findUnique({
    where: { id: resultId },
    include: { test_case: { select: { project_id: true } } },
  });
  if (!result) throw new Error('Run result not found');
  if (role === 'VIEWER') {
    await requireProjectViewer(result.test_case.project_id, userId);
  } else {
    await requireProjectMember(result.test_case.project_id, userId);
  }
}

export async function requireProjectMemberByRunId(runId: string, userId: number, role: 'VIEWER' | 'MEMBER' = 'MEMBER'): Promise<void> {
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { project_id: true },
  });
  if (!run) throw new Error('Run not found');
  if (role === 'VIEWER') {
    await requireProjectViewer(run.project_id, userId);
  } else {
    await requireProjectMember(run.project_id, userId);
  }
}

export async function requireProjectMemberByAttachmentId(attachmentId: string, userId: number): Promise<void> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: { project_id: true },
  });
  if (!attachment) throw new Error('Attachment not found');
  await requireProjectMember(attachment.project_id, userId);
}

export async function requireProjectMemberBySuiteId(suiteId: string, userId: number, role: 'VIEWER' | 'MEMBER' = 'MEMBER'): Promise<string> {
  const suite = await prisma.testSuite.findUnique({
    where: { id: suiteId },
    select: { project_id: true },
  });
  if (!suite) throw new Error('Suite not found');
  if (role === 'VIEWER') {
    await requireProjectViewer(suite.project_id, userId);
  } else {
    await requireProjectMember(suite.project_id, userId);
  }
  return suite.project_id;
}

export async function requireProjectMemberByStepId(stepId: string, userId: number, role: 'VIEWER' | 'MEMBER' = 'MEMBER'): Promise<string> {
  const step = await prisma.testCaseStep.findUnique({
    where: { id: stepId },
    include: { test_case: { select: { project_id: true } } },
  });
  if (!step?.test_case) throw new Error('Step not found');
  if (role === 'VIEWER') {
    await requireProjectViewer(step.test_case.project_id, userId);
  } else {
    await requireProjectMember(step.test_case.project_id, userId);
  }
  return step.test_case.project_id;
}

export async function requireProjectMemberByReusableStepId(reusableStepId: string, userId: number, role: 'VIEWER' | 'MEMBER' = 'MEMBER'): Promise<string> {
  const step = await prisma.reusableStep.findUnique({
    where: { id: reusableStepId },
    select: { project_id: true },
  });
  if (!step) throw new Error('Reusable step not found');
  if (role === 'VIEWER') {
    await requireProjectViewer(step.project_id, userId);
  } else {
    await requireProjectMember(step.project_id, userId);
  }
  return step.project_id;
}

export async function requireProjectMemberByModuleId(moduleId: string, userId: number, role: 'VIEWER' | 'MEMBER' = 'MEMBER'): Promise<string> {
  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { project_id: true },
  });
  if (!mod) throw new Error('Module not found');
  if (role === 'VIEWER') {
    await requireProjectViewer(mod.project_id, userId);
  } else {
    await requireProjectMember(mod.project_id, userId);
  }
  return mod.project_id;
}

export async function requireProjectMemberByCommentId(commentId: string, userId: number, role: 'VIEWER' | 'MEMBER' = 'MEMBER'): Promise<string> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { project_id: true },
  });
  if (!comment) throw new Error('Comment not found');
  if (role === 'VIEWER') {
    await requireProjectViewer(comment.project_id, userId);
  } else {
    await requireProjectMember(comment.project_id, userId);
  }
  return comment.project_id;
}
