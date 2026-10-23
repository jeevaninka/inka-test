'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { resolveProjectId, requireProjectMember } from '@/lib/permissions';
import { logger } from '@/lib/logger';

async function getUserId(): Promise<number> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  return (session.user as any).id as number;
}

export async function getDatasetsAction(projectIdOrSlug: string) {
  const userId = await getUserId();
  const projectId = await resolveProjectId(projectIdOrSlug);
  await requireProjectMember(projectId, userId);

  const datasets = await prisma.dataset.findMany({
    where: { project_id: projectId },
    orderBy: { updated_at: 'desc' },
    include: {
      _count: {
        select: {
          test_cases: { where: { deleted_at: null } },
        },
      },
    },
  });

  return datasets.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    parameters: d.parameters || [],
    rows: (d.rows as any[]) || [],
    casesCount: d._count.test_cases,
    createdAt: d.created_at.toISOString(),
    updatedAt: d.updated_at.toISOString(),
  }));
}

export async function getDatasetByIdAction(id: string) {
  const userId = await getUserId();
  const dataset = await prisma.dataset.findUnique({
    where: { id },
    include: {
      test_cases: {
        where: { deleted_at: null },
        select: { id: true, display_id: true, title: true },
      },
    },
  });

  if (!dataset) throw new Error('Dataset not found');
  await requireProjectMember(dataset.project_id, userId);

  return {
    id: dataset.id,
    projectId: dataset.project_id,
    name: dataset.name,
    description: dataset.description,
    parameters: dataset.parameters || [],
    rows: (dataset.rows as any[]) || [],
    cases: dataset.test_cases,
    createdAt: dataset.created_at.toISOString(),
    updatedAt: dataset.updated_at.toISOString(),
  };
}

export async function createDatasetAction(data: {
  projectId: string;
  name: string;
  description?: string;
  parameters: string[];
  rows: any[];
}) {
  const userId = await getUserId();
  const projectId = await resolveProjectId(data.projectId);
  await requireProjectMember(projectId, userId);

  // Clean parameter names: lowercase alphanumeric and underscores
  const cleanParams = data.parameters.map((p) =>
    p.toLowerCase().replace(/[^a-z0-9_]/g, '')
  ).filter(Boolean);

  const dataset = await prisma.dataset.create({
    data: {
      project_id: projectId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      parameters: cleanParams,
      rows: data.rows || [],
      created_by: userId,
    },
  });

  revalidatePath('/p');
  return {
    id: dataset.id,
    name: dataset.name,
    parameters: dataset.parameters,
    rows: dataset.rows,
  };
}

export async function updateDatasetAction(
  id: string,
  data: {
    name?: string;
    description?: string;
    parameters?: string[];
    rows?: any[];
  }
) {
  const userId = await getUserId();
  const existing = await prisma.dataset.findUnique({ where: { id } });
  if (!existing) throw new Error('Dataset not found');
  await requireProjectMember(existing.project_id, userId);

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.description !== undefined) updateData.description = data.description?.trim() || null;
  if (data.parameters !== undefined) {
    updateData.parameters = data.parameters.map((p) =>
      p.toLowerCase().replace(/[^a-z0-9_]/g, '')
    ).filter(Boolean);
  }
  if (data.rows !== undefined) updateData.rows = data.rows;

  const updated = await prisma.dataset.update({
    where: { id },
    data: updateData,
  });

  revalidatePath('/p');
  return {
    id: updated.id,
    name: updated.name,
    parameters: updated.parameters,
    rows: updated.rows,
  };
}

export async function deleteDatasetAction(id: string) {
  const userId = await getUserId();
  const existing = await prisma.dataset.findUnique({ where: { id } });
  if (!existing) throw new Error('Dataset not found');
  await requireProjectMember(existing.project_id, userId);

  // Unlink any test cases referencing this dataset
  await prisma.testCase.updateMany({
    where: { dataset_id: id },
    data: { dataset_id: null },
  });

  await prisma.dataset.delete({ where: { id } });
  revalidatePath('/p');
  return true;
}

export async function linkTestCaseDatasetAction(testCaseId: string, datasetId: string | null) {
  const userId = await getUserId();
  const tc = await prisma.testCase.findUnique({ where: { id: testCaseId } });
  if (!tc) throw new Error('Test case not found');
  await requireProjectMember(tc.project_id, userId);

  const updated = await prisma.testCase.update({
    where: { id: testCaseId },
    data: { dataset_id: datasetId },
    include: { dataset: true },
  });

  revalidatePath('/p');
  return updated;
}

export async function updateTestCaseLocalDatasetAction(
  testCaseId: string,
  localDataset: { parameters: string[]; rows: any[] } | null
) {
  const userId = await getUserId();
  const tc = await prisma.testCase.findUnique({ where: { id: testCaseId } });
  if (!tc) throw new Error('Test case not found');
  await requireProjectMember(tc.project_id, userId);

  const updated = await prisma.testCase.update({
    where: { id: testCaseId },
    data: { local_dataset: localDataset ? (localDataset as any) : null },
  });

  revalidatePath('/p');
  return updated;
}

export async function addParameterToTestCaseAction(
  testCaseId: string,
  rawParam: string
): Promise<{ success: boolean; parameters: string[] }> {
  const userId = await getUserId();
  const tc = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    include: { dataset: true },
  });
  if (!tc) throw new Error('Test case not found');
  await requireProjectMember(tc.project_id, userId);

  const clean = rawParam.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!clean) throw new Error('Invalid parameter name');

  if (tc.dataset_id && tc.dataset) {
    const existingParams = tc.dataset.parameters || [];
    if (!existingParams.includes(clean)) {
      const nextParams = [...existingParams, clean];
      const existingRows = Array.isArray(tc.dataset.rows) ? (tc.dataset.rows as any[]) : [];
      const nextRows = existingRows.map((r) => ({ ...r, [clean]: r[clean] || '' }));
      await prisma.dataset.update({
        where: { id: tc.dataset_id },
        data: { parameters: nextParams, rows: nextRows },
      });
      revalidatePath('/p');
      return { success: true, parameters: nextParams };
    }
    return { success: true, parameters: existingParams };
  }

  let localDataset = tc.local_dataset as any;
  if (!localDataset || typeof localDataset !== 'object') {
    localDataset = { parameters: [clean], rows: [{ id: '1', [clean]: '' }] };
  } else {
    const existingParams = Array.isArray(localDataset.parameters) ? localDataset.parameters : [];
    if (!existingParams.includes(clean)) {
      const nextParams = [...existingParams, clean];
      const existingRows = Array.isArray(localDataset.rows) ? localDataset.rows : [{ id: '1' }];
      const nextRows = existingRows.map((r: any) => ({ ...r, [clean]: r[clean] || '' }));
      localDataset = { parameters: nextParams, rows: nextRows };
    }
  }

  await prisma.testCase.update({
    where: { id: testCaseId },
    data: { local_dataset: localDataset },
  });

  revalidatePath('/p');
  return { success: true, parameters: localDataset.parameters };
}
