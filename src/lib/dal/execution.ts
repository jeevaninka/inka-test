import { prisma } from '@/lib/db';
import type { RunResult } from '@prisma/client';
import { notifyRunCompletion } from './notifications';

// ==========================================
// RUN RESULTS
// ==========================================

export async function getRunResults(runId: string, projectId: string) {
  return prisma.runResult.findMany({
    where: { run_id: runId, run: { project_id: projectId } },
    orderBy: { order_index: 'asc' },
    include: {
      test_case: true,
      test_version: true,
      defects: true,
    },
  });
}

export async function updateRunResult(
  id: string,
  projectId: string,
  data: {
    status: 'PENDING' | 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP';
    notes?: string;
    evidence_url?: string;
    time_spent_seconds?: number;
    executed_by: number;
  }
) {
  // Tenant-scoped write: the id alone is never trusted.
  const { count } = await prisma.runResult.updateMany({
    where: { id, run: { project_id: projectId } },
    data: {
      ...data,
      executed_at: new Date(),
    },
  });
  if (count === 0) throw new Error('Run result not found');

  const result = await prisma.runResult.findFirstOrThrow({
    where: { id, run: { project_id: projectId } },
  });

  // Check if run is complete and notify
  const run = await prisma.testRun.findUnique({
    where: { id: result.run_id },
    include: { _count: { select: { results: true } } },
  });

  if (run && run.completed_at) {
    // Run is complete, send notification
    await notifyRunCompletion(run.id);
  }

  return result;
}

// ==========================================
// DEFECTS
// ==========================================

export async function getDefects(projectId: string) {
  return prisma.defect.findMany({
    where: {
      run_result: {
        test_case: { project_id: projectId },
      },
      deleted_at: null,
    },
    orderBy: { raised_at: 'desc' },
    include: {
      run_result: { include: { test_case: true } },
    },
  });
}

export async function createDefect(data: {
  run_result_id: string;
  test_case_id: string;
  title: string;
  description?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  raised_by: number;
}) {
  return prisma.defect.create({ data: data as any });
}

// ==========================================
// ACTIVITY LOG
// ==========================================

export async function getActivityLogs(projectId: string, limit?: number) {
  return prisma.activityLog.findMany({
    where: { project_id: projectId },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
}

export async function logActivity(data: {
  project_id: string;
  user_id?: number;
  actor_type?: 'user' | 'system' | 'ai' | 'webhook';
  action: string;
  entity_type: string;
  entity_id: string;
}) {
  return prisma.activityLog.create({
    data: {
      ...data,
      actor_type: data.actor_type ?? 'user',
    } as any,
  });
}
