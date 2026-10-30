'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { requireProjectMember, resolveProjectId } from '@/lib/permissions';
import { logger } from '@/lib/logger';

async function getAuthorizedUser(): Promise<{ userId: number; user: any }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const user = session.user as any;
  if (!user.isApproved) throw new Error('Forbidden: Account pending approval');
  return { userId: Number(user.id), user };
}

export async function createModuleAction(data: {
  projectId: string;
  name: string;
  parentId?: string | null;
}) {
  const { userId } = await getAuthorizedUser();
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  // If parentId is specified, verify it belongs to the same project and is a root module (max 1 level depth)
  if (data.parentId) {
    const parent = await prisma.module.findUnique({ where: { id: data.parentId } });
    if (!parent || parent.project_id !== actualProjectId) {
      throw new Error('Invalid parent module for this project');
    }
    if (parent.parent_id !== null) {
      throw new Error('Sub-modules can only be 1 level deep. Cannot nest a sub-module inside another sub-module.');
    }
  }

  const trimmedName = data.name.trim();
  if (!trimmedName) throw new Error('Module name cannot be empty');

  // Verify no duplicate name among siblings (parent modules or sub-modules within the same parent)
  const existingSibling = await prisma.module.findFirst({
    where: {
      project_id: actualProjectId,
      parent_id: data.parentId || null,
      name: { equals: trimmedName, mode: 'insensitive' },
    },
  });
  if (existingSibling) {
    throw new Error(data.parentId ? `Sub-module "${trimmedName}" already exists in this module` : `Module "${trimmedName}" already exists`);
  }

  // Get current max order_index
  const lastModule = await prisma.module.findFirst({
    where: { project_id: actualProjectId, parent_id: data.parentId || null },
    orderBy: { order_index: 'desc' },
  });

  const orderIndex = lastModule ? lastModule.order_index + 1 : 0;

  const module = await prisma.module.create({
    data: {
      project_id: actualProjectId,
      name: trimmedName,
      parent_id: data.parentId || null,
      order_index: orderIndex,
    },
  });

  await prisma.activityLog.create({
    data: {
      project_id: actualProjectId,
      user_id: userId,
      action: `Created module "${module.name}"`,
      entity_type: 'module',
      entity_id: module.id,
    },
  }).catch(() => null);

  logger.info('Module created', {
    module: 'Modules',
    action: 'createModuleAction',
    moduleId: module.id,
    projectId: actualProjectId,
    userId,
  });

  revalidatePath(`/p`);
  return {
    id: module.id,
    projectId: module.project_id,
    name: module.name,
    parentId: module.parent_id,
    orderIndex: module.order_index,
  };
}

export async function deleteModuleAction(id: string) {
  const { userId } = await getAuthorizedUser();

  const mod = await prisma.module.findUnique({ where: { id } });
  if (!mod) throw new Error('Module not found');
  await requireProjectMember(mod.project_id, userId);

  // Deleting a module never deletes test cases. Cases are re-homed:
  // - sub-module  -> its parent module (fallback: root / "No Module")
  // - root module -> root / "No Module"
  // Sub-modules of a deleted root module are promoted to root instead of removed.
  const fallbackModuleId = mod.parent_id ?? null;

  const [movedCases, promotedSubmodules] = await Promise.all([
    prisma.testCase.count({ where: { module_id: id } }),
    prisma.module.count({ where: { parent_id: id } }),
  ]);

  await prisma.$transaction([
    prisma.testCase.updateMany({
      where: { module_id: id },
      data: { module_id: fallbackModuleId },
    }),
    prisma.module.updateMany({
      where: { parent_id: id },
      data: { parent_id: null },
    }),
    prisma.module.delete({ where: { id } }),
  ]);

  await prisma.activityLog.create({
    data: {
      project_id: mod.project_id,
      user_id: userId,
      action: `Deleted module "${mod.name}" (${movedCases} case${movedCases === 1 ? '' : 's'} moved to ${
        fallbackModuleId ? 'parent module' : 'No Module'
      }${promotedSubmodules > 0 ? `, ${promotedSubmodules} sub-module${promotedSubmodules === 1 ? '' : 's'} promoted to root` : ''})`,
      entity_type: 'module',
      entity_id: id,
    },
  }).catch(() => null);

  revalidatePath(`/p`);
  return { movedCases, promotedSubmodules, fallbackModuleId };
}

export async function updateModuleAction(id: string, data: { name?: string; parentId?: string | null }) {
  const { userId } = await getAuthorizedUser();

  const mod = await prisma.module.findUnique({ where: { id } });
  if (!mod) throw new Error('Module not found');
  await requireProjectMember(mod.project_id, userId);

  if (data.parentId) {
    const parent = await prisma.module.findUnique({ where: { id: data.parentId } });
    if (!parent || parent.project_id !== mod.project_id) {
      throw new Error('Invalid parent module');
    }
    if (parent.parent_id !== null) {
      throw new Error('Sub-modules can only be 1 level deep. Cannot nest a sub-module inside another sub-module.');
    }
  }

  const updateData: any = {};
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) throw new Error('Module name cannot be empty');
    const targetParentId = data.parentId !== undefined ? (data.parentId || null) : mod.parent_id;
    const existingSibling = await prisma.module.findFirst({
      where: {
        id: { not: id },
        project_id: mod.project_id,
        parent_id: targetParentId,
        name: { equals: trimmed, mode: 'insensitive' },
      },
    });
    if (existingSibling) {
      throw new Error(targetParentId ? `Sub-module "${trimmed}" already exists in this module` : `Module "${trimmed}" already exists`);
    }
    updateData.name = trimmed;
  }
  if (data.parentId !== undefined) updateData.parent_id = data.parentId;

  const updatedMod = await prisma.module.update({
    where: { id },
    data: updateData,
  });

  await prisma.activityLog.create({
    data: {
      project_id: mod.project_id,
      user_id: userId,
      action: `Updated module "${updatedMod.name}"`,
      entity_type: 'module',
      entity_id: id,
    },
  }).catch(() => null);

  revalidatePath(`/p`);
  return {
    id: updatedMod.id,
    projectId: updatedMod.project_id,
    name: updatedMod.name,
    parentId: updatedMod.parent_id,
    orderIndex: updatedMod.order_index,
  };
}

export async function reorderModulesAction(moduleIds: string[]) {
  const { userId } = await getAuthorizedUser();
  if (moduleIds.length === 0) return true;

  const modules = await prisma.module.findMany({
    where: { id: { in: moduleIds } },
    select: { id: true, project_id: true },
  });

  if (modules.length === 0) return true;
  const projectId = modules[0].project_id;
  await requireProjectMember(projectId, userId);

  // Verify all belong to same project
  for (const m of modules) {
    if (m.project_id !== projectId) {
      throw new Error('All reordered modules must belong to the same project');
    }
  }

  await prisma.$transaction(
    moduleIds.map((id, index) =>
      prisma.module.update({
        where: { id },
        data: { order_index: index },
      })
    )
  );

  revalidatePath(`/p`);
  return true;
}

export async function bulkMoveCasesAction(caseIds: string[], targetModuleId: string | null) {
  const { userId } = await getAuthorizedUser();
  if (caseIds.length === 0) return true;

  // Verify target module if supplied
  let targetProjectId: string | null = null;
  if (targetModuleId) {
    const targetMod = await prisma.module.findUnique({ where: { id: targetModuleId } });
    if (!targetMod) throw new Error('Target module not found');
    await requireProjectMember(targetMod.project_id, userId);
    targetProjectId = targetMod.project_id;
  }

  // Verify all cases belong to a project the user can edit
  const cases = await prisma.testCase.findMany({
    where: { id: { in: caseIds } },
    select: { id: true, project_id: true },
  });

  const uniqueProjectIds = [...new Set(cases.map((c) => c.project_id))];
  for (const pid of uniqueProjectIds) {
    await requireProjectMember(pid, userId);
    if (targetProjectId && pid !== targetProjectId) {
      throw new Error('Cannot move test cases across different projects');
    }
  }

  await prisma.testCase.updateMany({
    where: { id: { in: caseIds } },
    data: { module_id: targetModuleId },
  });

  revalidatePath(`/p`);
  return true;
}
