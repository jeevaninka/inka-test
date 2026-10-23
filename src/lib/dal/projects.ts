import { prisma } from '@/lib/db';
import type { Project, TestCase, TestRun, TestSuite } from '@prisma/client';

// ==========================================
// PROJECT QUERIES
// ==========================================

export async function getProjects(workspaceId: string) {
  return prisma.project.findMany({
    where: { workspace_id: workspaceId, deleted_at: null },
    orderBy: { created_at: 'desc' },
  });
}

export async function getProjectBySlug(workspaceId: string, slug: string) {
  return prisma.project.findUnique({
    where: {
      workspace_id_slug: {
        workspace_id: workspaceId,
        slug,
      },
    },
  });
}

// ==========================================
// TEST CASE QUERIES
// ==========================================

export async function getTestCases(projectId: string) {
  return prisma.testCase.findMany({
    where: { project_id: projectId, deleted_at: null },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      display_id: true,
      project_id: true,
      module_id: true,
      title: true,
      description: true,
      pre_conditions: true,
      post_conditions: true,
      expected_result: true,
      priority: true,
      type: true,
      status: true,
      tags: true,
      labels: true,
      scenario_type: true,
      custom_fields: true,
      current_version: true,
      ai_generated: true,
      needs_update: true,
      review_status: true,
      external_ref: true,
      created_by: true,
      created_at: true,
      updated_at: true,
      updated_by: true,
      dataset_id: true,
      local_dataset: true,
      dataset: true,
      test_case_steps: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          order: true,
          step: true,
          expected_result: true,
          data: true,
          reusable_step_id: true,
          reusable_step_item_id: true,
          is_outdated: true,
          image_url: true,
          reusable_step: true,
        },
      },
    },
  });
}

/**
 * Reads a single test case inside an explicit tenant scope.
 * Callers MUST pass the project or workspace the request has already been
 * authorised for; the id alone is never trusted.
 */
export async function getTestCaseById(
  id: string,
  scope: { projectId?: string; workspaceId?: string }
) {
  return prisma.testCase.findFirst({
    where: {
      id,
      deleted_at: null,
      ...(scope.projectId ? { project_id: scope.projectId } : {}),
      ...(scope.workspaceId ? { project: { workspace_id: scope.workspaceId } } : {}),
    },
    include: {
      module: true,
      dataset: true,
      versions: true,
      ai_suggestions: true,
      test_case_steps: {
        orderBy: { order: 'asc' },
        include: {
          reusable_step: true,
        },
      },
    },
  });
}

export async function createTestCase(data: {
  project_id: string;
  module_id?: string;
  title: string;
  description?: string;
  pre_conditions?: string;
  steps: Record<string, unknown>;
  expected_result?: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  type: 'MANUAL' | 'AUTO';
  status: 'ACTIVE' | 'DRAFT' | 'DEPRECATED';
  tags?: string[];
  created_by: string;
}) {
  return prisma.testCase.create({
    data: data as any,
  });
}

// ==========================================
// TEST RUN QUERIES
// ==========================================

export async function getTestRuns(projectId: string) {
  return prisma.testRun.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
    orderBy: { created_at: 'desc' },
    include: {
      results: {
        select: {
          id: true,
          test_case_id: true,
          status: true,
          attempt_number: true,
          time_spent_seconds: true,
        },
      },
      suite: {
        select: {
          name: true,
        },
      },
    },
  });
}

/**
 * Reads a single run inside an explicit tenant scope (see getTestCaseById).
 */
export async function getTestRunById(
  runId: string,
  scope: { projectId?: string; workspaceId?: string }
) {
  return prisma.testRun.findFirst({
    where: {
      id: runId,
      deleted_at: null,
      ...(scope.projectId ? { project_id: scope.projectId } : {}),
      ...(scope.workspaceId ? { project: { workspace_id: scope.workspaceId } } : {}),
    },
    include: {
      results: {
        include: {
          test_case: true,
          defects: true,
        },
      },
      suite: true,
    },
  });
}

// ==========================================
// TEST SUITE QUERIES
// ==========================================

export async function getTestSuites(projectId: string) {
  return prisma.testSuite.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
    },
    orderBy: { created_at: 'desc' },
    include: {
      suite_cases: {
        select: {
          suite_id: true,
          test_case_id: true,
          order_index: true,
          assignee_id: true,
        },
        orderBy: { order_index: 'asc' },
      },
    },
  });
}

export async function getModules(projectId: string) {
  return prisma.module.findMany({
    where: { project_id: projectId },
    orderBy: { order_index: 'asc' },
    select: {
      id: true,
      project_id: true,
      name: true,
      parent_id: true,
      order_index: true,
    },
  });
}
