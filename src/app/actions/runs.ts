'use server';

import {
  requireProjectAdmin,
  requireProjectMember,
  requireProjectMemberByRunId,
  requireProjectMemberByRunResultId,
  requireProjectMemberByCaseId,
} from '@/lib/permissions';
import { buildResolvedVariables, extractEnvironmentVariableKeys, extractDatasetParameterKeys } from '@/lib/variables';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { generateTestRunId, generateDefectId } from '@/lib/ids';
import { revalidatePath } from 'next/cache';
import { triggerProjectWebhooks } from '@/lib/webhook';
import { CustomPmClient, PmIntegrationConfig, getEffectivePmIntegration } from '@/lib/integrations/pm-client';
import { NotificationService } from '@/lib/notifications/service';
import { getBaseUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';
import {
  normalizeExecutionState,
  computeQueuePositions,
  isTerminalResultStatus,
  EXECUTION_STATE,
} from '@/lib/execution/state';
import { loadRunResults } from '@/lib/runs/load-results';
import {
  hasRunEnvironmentDetails,
  normalizeRunEnvironmentDetails,
} from '@/lib/runs/environment';
import { createRetryAttempts } from '@/lib/execution/attempts';
import { reconcileRunState } from '@/lib/integrations/execution-monitor';
import { skipRemainingCases, startRunCases, stopRun } from '@/lib/execution/coordinator';
import { getCaseAutomationSource, isAutomatedCase } from '@/lib/cases/automation-source';

export async function validateRunPlanAction(data: {
  projectId: string;
  environmentId?: string;
  caseIds: string[];
}): Promise<{
  valid: boolean;
  missingVariables: string[];
  missingParameters: Array<{ caseId: string; displayId: string; title: string; param: string }>;
  warnings: string[];
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const [cases, globalVars, envVars, allSteps] = await Promise.all([
    prisma.testCase.findMany({
      where: { id: { in: data.caseIds }, project_id: actualProjectId },
      select: {
        id: true,
        display_id: true,
        title: true,
        dataset_id: true,
        local_dataset: true,
        dataset: { select: { parameters: true } },
      },
    }),
    prisma.variable.findMany({
      where: { project_id: actualProjectId, test_case_id: null },
      select: { key: true, default_value: true },
    }),
    data.environmentId
      ? prisma.variableValue.findMany({
          where: {
            environment_id: data.environmentId,
            variable: { project_id: actualProjectId },
          },
          include: { variable: { select: { key: true } } },
        })
      : Promise.resolve([]),
    prisma.testCaseStep.findMany({
      where: {
        test_case_id: { in: data.caseIds },
        test_case: { project_id: actualProjectId },
      },
      select: { test_case_id: true, step: true, expected_result: true, data: true },
    }),
  ]);

  const envValMap = new Map(envVars.map((v) => [v.variable.key, v.value]));
  const defaultValMap = new Map(globalVars.map((v) => [v.key, v.default_value || '']));

  const missingVariables: string[] = [];
  const missingParameters: Array<{ caseId: string; displayId: string; title: string; param: string }> = [];
  const warnings: string[] = [];

  for (const s of allSteps) {
    const combined = `${s.step || ''} ${s.expected_result || ''} ${s.data || ''}`;
    const keys = extractEnvironmentVariableKeys(combined);
    for (const key of keys) {
      if (missingVariables.includes(key)) continue;
      const envVal = envValMap.get(key);
      const defVal = defaultValMap.get(key);
      if (!envVal && !defVal) {
        missingVariables.push(key);
      }
    }

    const paramKeys = extractDatasetParameterKeys(combined);
    if (paramKeys.length > 0) {
      const tc = cases.find((c) => c.id === s.test_case_id);
      const dsParams = tc?.dataset?.parameters ||
        ((tc?.local_dataset as any)?.parameters as string[]) || [];

      for (const pk of paramKeys) {
        if (!dsParams.includes(pk.toLowerCase())) {
          if (!missingParameters.some((mp) => mp.caseId === s.test_case_id && mp.param === pk)) {
            missingParameters.push({
              caseId: s.test_case_id,
              displayId: tc?.display_id || '',
              title: tc?.title || '',
              param: pk,
            });
          }
        }
      }
    }
  }

  if (missingVariables.length > 0) {
    warnings.push(
      `${missingVariables.length} environment variable(s) lack values or defaults for this environment: ${missingVariables.join(', ')}.`
    );
  }

  if (missingParameters.length > 0) {
    // Name the case and the parameter: "it won't work" is not actionable.
    const shown = missingParameters
      .slice(0, 3)
      .map(
        (mp) =>
          `${mp.displayId || mp.title}: parameter \`${mp.param}\` has no column in the dataset`
      );
    const more = missingParameters.length - shown.length;
    warnings.push(
      `${shown.join(' · ')}${more > 0 ? ` · +${more} more` : ''}`
    );
  }

  return {
    valid: missingVariables.length === 0 && missingParameters.length === 0,
    missingVariables,
    missingParameters,
    warnings,
  };
}

/**
 * Authorized entry point for the run deck: verifies the caller is a project
 * viewer, then loads the results.
 */
export async function getRunResultsAction(runId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  // Tenant guard: a run id must never be readable outside its project.
  await requireProjectMemberByRunId(runId, userId, 'VIEWER');

  return loadRunResults(runId);
}

/**
 * Fetch a single run header (+ result statuses). Used by the run page when the
 * run is not yet present in the project data context (e.g. immediately after
 * creating an async external run), so it never spins forever.
 */
export async function getTestRunByIdAction(runId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  const userId = (session.user as any).id as number;
  try {
    await requireProjectMemberByRunId(runId, userId);
  } catch {
    return null;
  }

  const r = await prisma.testRun.findUnique({
    where: { id: runId },
    include: {
      suite: { select: { name: true } },
      release: { select: { due_date: true } },
      results: true,
    },
  });
  if (!r) return null;

  return {
    id: r.id,
    projectId: r.project_id,
    suiteId: r.suite_id,
    releaseId: r.release_id || null,
    suiteName: r.suite?.name || null,
    name: r.name,
    environment: r.environment,
    buildVersion: r.build_version,
    assignedTo: r.assigned_to,
    status: r.status.toLowerCase(),
    source: r.source || 'manual',
    startedAt: r.started_at?.toISOString(),
    completedAt: r.completed_at?.toISOString(),
    dueDate: r.release?.due_date?.toISOString() ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    resolved_variables: r.resolved_variables,
    resolved_datasets: r.resolved_datasets,
    runContext: r.run_context || null,
    run_context: r.run_context || null,
    customFields: r.custom_fields || {},
    custom_fields: r.custom_fields || {},
    stopRequestedAt: r.stop_requested_at?.toISOString() ?? null,
    executionGeneration: r.execution_generation,
    results: (r.results || []).map((res: any) => ({
      ...res,
      id: res.id,
      testCaseId: res.test_case_id,
      status: res.status ? String(res.status).toLowerCase() : 'pending',
      executionState: res.execution_state || 'IDLE',
      timeSpentSeconds: res.time_spent_seconds ?? 0,
    })),
  };
}

export async function getRunResultStepsAction(runResultId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  // Tenant guard: never resolve steps for a result outside the caller's projects.
  await requireProjectMemberByRunResultId(runResultId, userId, 'VIEWER');

  const result = await prisma.runResult.findUnique({
    where: { id: runResultId },
    include: {
      test_version: true,
      test_case: {
        include: {
          test_case_steps: { orderBy: { order: 'asc' } }
        }
      }
    }
  });

  if (!result) return [];

  // 1. If run result is locked to an approved test_version, use the approved version's steps
  if (result.test_version && Array.isArray(result.test_version.steps) && result.test_version.steps.length > 0) {
    return (result.test_version.steps as any[]).map((s, idx) => ({
      id: `vstep-${idx}`,
      order: s.order ?? idx + 1,
      step: s.step || s.description || '',
      expected_result: s.expectedResult || s.expected_result || null,
      data: s.data || null,
      image_url: null,
      reusable_step_id: null,
      reusable_step_item_id: null,
      is_outdated: false,
    }));
  }

  // 2. Primary source of truth: relational test_case_steps
  return (result.test_case?.test_case_steps || []).map(s => ({
    id: s.id,
    order: s.order,
    step: s.step,
    expected_result: s.expected_result,
    data: s.data,
    image_url: s.image_url,
    reusable_step_id: s.reusable_step_id,
    reusable_step_item_id: s.reusable_step_item_id,
    is_outdated: s.is_outdated,
  }));
}

export async function createTestRunAction(data: {
  projectId: string;
  name: string;
  suiteId?: string;
  environment: string;
  environmentId?: string;
  buildVersion?: string;
  assignedTo?: number;
  createdBy: number;
  /** Where the run executed: platform / OS / browser / device / build + custom. */
  environmentDetails?: Record<string, any>;
  testCaseIds?: string[];
  assignments?: Record<string, number>;
  iterationAssignments?: Record<string, Record<number, number>>;
  source?: string;
  triggerRef?: string;
  releaseId?: string;
  config?: {
    customVariables?: Record<string, string>;
    stopOnFirstFailure?: boolean;
    /** Run-level wait after a case finishes, before the next starts (ms). */
    interTestDelayMs?: number;
    postman?: Record<string, any>;
    datadog?: Record<string, any>;
  };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMember(data.projectId, userId);

  const id = await generateTestRunId();

  // Create RunResults from selected cases, suite cases, or all project cases
  let casesToRun: { id: string; assigneeId?: number | null }[] = [];
  
  if (data.testCaseIds && data.testCaseIds.length > 0) {
    const rawCases = await prisma.testCase.findMany({
      where: { id: { in: data.testCaseIds }, deleted_at: null },
    });
    casesToRun = rawCases.map(c => ({ id: c.id, assigneeId: null }));
  } else if (data.suiteId) {
    const suiteCases = await prisma.suiteCase.findMany({
      where: { suite_id: data.suiteId },
      include: { test_case: true },
      orderBy: { order_index: 'asc' },
    });
    casesToRun = suiteCases
      .filter((sc) => sc.test_case && !sc.test_case.deleted_at)
      .map((sc) => ({ id: sc.test_case_id, assigneeId: sc.assignee_id }));
  } else {
    const rawCases = await prisma.testCase.findMany({
      where: { project_id: data.projectId, deleted_at: null },
      orderBy: { created_at: 'asc' },
    });
    casesToRun = rawCases.map(c => ({ id: c.id, assigneeId: null }));
  }

  let casesWithDatasets: any[] = [];
  let runResultsData: any[] = [];

  if (casesToRun.length > 0) {
    const caseIds = casesToRun.map(c => c.id);
    const [caseVersions, activeReviews, fetchedCasesWithDatasets] = await Promise.all([
      prisma.testCaseVersion.findMany({
        where: { test_case_id: { in: caseIds } },
        orderBy: { version_number: 'desc' },
      }),
      prisma.reviewRequest.findMany({
        where: { test_case_id: { in: caseIds }, status: { in: ['PENDING', 'CHANGES_REQUESTED'] } },
        select: { test_case_id: true, version_number_at_request: true },
      }),
      prisma.testCase.findMany({
        where: { id: { in: caseIds } },
        select: {
          id: true,
          dataset_id: true,
          local_dataset: true,
          dataset: { select: { id: true, name: true, parameters: true, rows: true } },
        },
      }),
    ]);
    casesWithDatasets = fetchedCasesWithDatasets;

    const activeReviewMap = new Map<string, number>();
    for (const r of activeReviews) {
      if (r.version_number_at_request) {
        activeReviewMap.set(r.test_case_id, r.version_number_at_request);
      }
    }

    const versionMap = new Map<string, string>();
    for (const v of caseVersions) {
      const inReviewVersion = activeReviewMap.get(v.test_case_id);
      // Lock test run to the approved baseline version, never an unapproved review draft
      if (inReviewVersion && v.version_number >= inReviewVersion) {
        continue;
      }
      if (!versionMap.has(v.test_case_id)) {
        versionMap.set(v.test_case_id, v.id);
      }
    }

    runResultsData = casesToRun.map((tc, index) => {
      let initialIterResults: any = undefined;
      const iterMap = data.iterationAssignments?.[tc.id];
      const tcData = casesWithDatasets.find((c) => c.id === tc.id);
      const ds = (tcData?.dataset || tcData?.local_dataset) as any;
      if (ds && Array.isArray(ds.rows) && ds.rows.length > 1) {
        initialIterResults = ds.rows.map((row: any, rIdx: number) => ({
          iteration_index: rIdx + 1,
          row_id: row.id || String(rIdx + 1),
          parameters: row,
          status: 'pending',
          assigned_to: iterMap?.[rIdx + 1] ?? data.assignments?.[tc.id] ?? tc.assigneeId ?? null,
          time_spent_seconds: 0,
        }));
      }

      return {
        run_id: id,
        test_case_id: tc.id,
        test_version_id: versionMap.get(tc.id) ?? null,
        order_index: index,
        status: 'PENDING' as const,
        assigned_to: data.assignments?.[tc.id] ?? tc.assigneeId ?? null,
        iteration_results: initialIterResults ? initialIterResults : undefined,
      };
    });
  }

  // Snapshot variables and datasets at run creation for auditability and reproducibility
  const [globalVars, allSteps, localVarsList] = await Promise.all([
    data.environmentId
      ? prisma.variable.findMany({
          where: { project_id: data.projectId, test_case_id: null },
          include: { values: { where: { environment_id: data.environmentId } } },
        })
      : Promise.resolve([]),
    prisma.testCaseStep.findMany({
      where: { test_case_id: { in: casesToRun.map((tc) => tc.id) } },
      orderBy: { order: 'asc' },
    }),
    data.environmentId
      ? prisma.variable.findMany({
          where: { test_case_id: { in: casesToRun.map((tc) => tc.id) } },
          include: { values: { where: { environment_id: data.environmentId } } },
        })
      : Promise.resolve([]),
  ]);

  // Build resolved datasets map for all cases in this run
  const resolvedDatasets: Record<string, {
    datasetName: string;
    parameters: string[];
    rows: any[];
  }> = {};

  for (const c of casesWithDatasets) {
    if (c.dataset) {
      resolvedDatasets[c.id] = {
        datasetName: c.dataset.name,
        parameters: c.dataset.parameters || [],
        rows: (c.dataset.rows as any[]) || [],
      };
    } else if (c.local_dataset && typeof c.local_dataset === 'object') {
      const ld = c.local_dataset as any;
      if (Array.isArray(ld.parameters) && ld.parameters.length > 0) {
        resolvedDatasets[c.id] = {
          datasetName: 'Case Parameters',
          parameters: ld.parameters,
          rows: Array.isArray(ld.rows) ? ld.rows : [],
        };
      }
    }
  }

  let resolvedVariables: Record<string, string> | null = null;

  if (data.environmentId && globalVars.length > 0) {
    const globalVarMap = new Map(globalVars.map((v) => [v.key, v.values[0]?.value || v.default_value || '']));
    const envValMap = new Map(globalVars.map((v) => [v.key, v.values[0]?.value || '']));
    const defaultsMap = new Map(globalVars.map((v) => [v.key, v.default_value || '']));

    const localVarsMap = new Map<string, Map<string, string>>();
    for (const lv of localVarsList) {
      if (!localVarsMap.has(lv.test_case_id!)) {
        localVarsMap.set(lv.test_case_id!, new Map());
      }
      localVarsMap.get(lv.test_case_id!)!.set(lv.key, lv.values[0]?.value || lv.default_value || '');
    }

    resolvedVariables = buildResolvedVariables(
      data.projectId,
      data.environmentId,
      allSteps.map((s) => ({
        test_case_id: s.test_case_id,
        step: s.step,
        expected_result: s.expected_result,
        data: s.data,
      })),
      localVarsMap,
      globalVarMap,
      envValMap,
      defaultsMap
    );
  }

  const run = await prisma.$transaction(async (tx) => {
    const createdRun = await tx.testRun.create({
      data: {
        id,
        project_id: data.projectId,
        suite_id: data.suiteId || null,
        release_id: data.releaseId || null,
        name: data.name,
        environment: data.environment,
        build_version: data.buildVersion || null,
        assigned_to: data.assignedTo || null,
        source: data.source || 'manual',
        trigger_ref: data.triggerRef || null,
        run_context: data.config ? ({ config: data.config } as any) : undefined,
        custom_fields: (() => {
          const details = normalizeRunEnvironmentDetails(data.environmentDetails);
          return hasRunEnvironmentDetails(details)
            ? ({ environmentDetails: details } as any)
            : ({} as any);
        })(),
        status: 'IN_PROGRESS',
        started_at: new Date(),
        created_by: data.createdBy,
        resolved_variables: resolvedVariables ? (resolvedVariables as any) : Prisma.DbNull,
        resolved_datasets: Object.keys(resolvedDatasets).length > 0 ? (resolvedDatasets as any) : Prisma.DbNull,
      },
    });

    if (runResultsData.length > 0) {
      await tx.runResult.createMany({
        data: runResultsData,
      });
    }

    await tx.activityLog.create({
      data: {
        project_id: data.projectId,
        user_id: userId,
        action: `Created test run "${createdRun.name}"`,
        entity_type: 'test_run',
        entity_id: createdRun.id,
        metadata: {
          runName: createdRun.name,
          runId: createdRun.id,
        },
      },
    });

    return createdRun;
  });

  revalidatePath(`/p`);
  return {
    id: run.id,
    projectId: run.project_id,
    suiteId: run.suite_id,
    name: run.name,
    environment: run.environment,
    buildVersion: run.build_version,
    assignedTo: run.assigned_to,
    status: run.status.toLowerCase(),
    startedAt: run.started_at?.toISOString(),
    createdBy: run.created_by,
    createdAt: run.created_at.toISOString(),
    customFields: run.custom_fields || {},
    custom_fields: run.custom_fields || {},
  };
}

export async function updateRunResultAction(
  id: string,
  data: {
    status?: 'PASS' | 'FAIL' | 'ERROR' | 'BLOCKED' | 'SKIP' | 'INVALID';
    notes?: string;
    evidenceUrl?: string;
    executedBy?: number;
    stepResults?: any;
    iterationResults?: any;
    failureReason?: string;
    assignedTo?: number;
    source?: string;
    automationLog?: string;
    timeSpentSeconds?: number;
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunResultId(id, userId);

  const currentRow = await prisma.runResult.findUnique({
    where: { id },
    select: {
      execution_state: true,
      source: true,
      status: true,
      assigned_to: true,
      executed_by: true,
      run_id: true,
      test_case: { select: { id: true, display_id: true, project_id: true } },
      run: { select: { id: true, name: true } },
    },
  });
  if (!currentRow) throw new Error('Result not found');

  // Project-level restriction: only the assignee, project leads or admins may
  // record a result. Enforced here on the server regardless of UI state.
  const project = await prisma.project.findUnique({
    where: { id: currentRow.test_case.project_id },
    select: { restrict_result_recording: true, workspace_id: true },
  });
  const workspaceId = project?.workspace_id ?? null;
  const isAssignee = currentRow.assigned_to != null && currentRow.assigned_to === userId;
  let isLeadOrAdmin = false;
  if (project?.restrict_result_recording && !isAssignee) {
    try {
      await requireProjectAdmin(currentRow.test_case.project_id, userId);
      isLeadOrAdmin = true;
    } catch {
      isLeadOrAdmin = false;
    }
    if (!isLeadOrAdmin) {
      throw new Error(
        'Only the assignee, project leads or admins can record a result for this case.'
      );
    }
  }

  // A manual verdict must not corrupt an automated execution that is still
  // owned by the provider (or by a running Postman request).
  if (
    data.status !== undefined &&
    currentRow.status === 'PENDING' &&
    ['RUNNING', 'WAITING'].includes(String(currentRow.execution_state || '').toUpperCase())
  ) {
    throw new Error(
      'This case is currently executing automatically. Wait for the result or stop the run before recording a manual verdict.'
    );
  }

  const oldStatus = currentRow.status;

  const updateData: any = {
    executed_at: new Date(),
  };
  if (data.status !== undefined) {
    updateData.status = data.status;
    updateData.execution_state = 'SETTLED';
    updateData.finished_at = new Date();
    updateData.lease_owner = null;
    updateData.lease_expires_at = null;
  }
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.evidenceUrl !== undefined) updateData.evidence_url = data.evidenceUrl;
  if (data.executedBy !== undefined) updateData.executed_by = data.executedBy;
  if (data.stepResults !== undefined) updateData.step_results = data.stepResults;
  if (data.iterationResults !== undefined) updateData.iteration_results = data.iterationResults;
  if (data.failureReason !== undefined) updateData.failure_reason = data.failureReason;
  if (data.assignedTo !== undefined) {
    updateData.assigned_to = data.assignedTo;
  } else if (data.status !== undefined) {
    // Auto-assign to current tester if currently unassigned
    if (currentRow.assigned_to === null) {
      updateData.assigned_to = data.executedBy || userId;
    }
  }
  if (data.source !== undefined) updateData.source = data.source;
  if (data.automationLog !== undefined) updateData.automation_log = data.automationLog;
  if (data.timeSpentSeconds !== undefined) updateData.time_spent_seconds = data.timeSpentSeconds;

  await prisma.runResult.update({ where: { id }, data: updateData });

  // Audit entry: actor, case, old → new result, whether the executor differed
  // from the assignee.
  const executor = data.executedBy ?? userId;
  const differedFromAssignee = currentRow.assigned_to != null && currentRow.assigned_to !== executor;
  await prisma.auditLog.create({
    data: {
      workspace_id: workspaceId!,
      user_id: userId,
      action: 'recordRunResult',
      metadata: {
        projectId: currentRow.test_case.project_id,
        runId: currentRow.run_id,
        runName: currentRow.run.name,
        caseId: currentRow.test_case.id,
        caseDisplayId: currentRow.test_case.display_id,
        oldStatus,
        newStatus: data.status ?? oldStatus,
        executedBy: executor,
        assignedTo: currentRow.assigned_to ?? null,
        differedFromAssignee,
      },
    },
  }).catch(() => null);

  // Optional in-app notification to the assignee when a non-assignee records a
  // result on their case.
  if (
    currentRow.assigned_to != null &&
    currentRow.assigned_to !== userId &&
    currentRow.assigned_to !== executor
  ) {
    await prisma.notification.create({
      data: {
        user_id: currentRow.assigned_to,
        type: 'RESULT_RECORDED',
        entity_type: 'RunResult',
        entity_id: id,
        action_url: `/p/${currentRow.test_case.project_id}/runs/${currentRow.run_id}/report`,
        metadata: {
          caseId: currentRow.test_case.id,
          caseDisplayId: currentRow.test_case.display_id,
          runId: currentRow.run_id,
          runName: currentRow.run.name,
          oldStatus,
          newStatus: data.status ?? oldStatus,
          recordedBy: userId,
        },
      },
    }).catch(() => null);
  }

  return true;
}

export async function getProjectExecutionSettingsAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { restrict_result_recording: true },
  });

  return {
    restrict_result_recording: project?.restrict_result_recording ?? false,
  };
}

export async function finishRunAction(runId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, userId);

  // Check latest attempt for each test case in this run to ignore resolved re-runs
  const allResults = await prisma.runResult.findMany({
    where: { run_id: runId },
    orderBy: [{ test_case_id: 'asc' }, { attempt_number: 'desc' }],
    select: { test_case_id: true, status: true },
  });

  const seenCases = new Set<string>();
  const latestResults = allResults.filter((r) => {
    if (seenCases.has(r.test_case_id)) return false;
    seenCases.add(r.test_case_id);
    return true;
  });

  const activeFailCount = latestResults.filter((r) => r.status === 'FAIL').length;
  const resultStatus = activeFailCount > 0 ? 'FAILED' : 'COMPLETED';

  const run = await prisma.testRun.update({
    where: { id: runId },
    data: {
      status: resultStatus as any,
      completed_at: new Date(),
    },
  });

  // Dispatch notifications (In-App to Creator, Slack Channel, Email Report)
  NotificationService.notifyRunCompleted(runId).catch((err) =>
    logger.error('Failed to notify run completion', {
      module: 'Runs',
      action: 'completeRunAction',
      runId,
      projectId: run.project_id,
      errorCode: ErrorCodes.INTERNAL,
      error: err,
    })
  );

  // Fire webhook in background
  triggerProjectWebhooks(run.project_id, 'run.completed', {
    runId,
    name: run.name,
    status: resultStatus,
    completedAt: new Date().toISOString(),
  }).catch(() => null);

  await prisma.activityLog.create({
    data: {
      project_id: run.project_id,
      user_id: userId,
      action: `Completed test run "${run.name}"`,
      entity_type: 'test_run',
      entity_id: runId,
    }
  });

  revalidatePath(`/p`);
  return true;
}

export async function abortRunAction(runId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, userId);

  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { project_id: true, name: true },
  });
  if (!run) throw new Error('Run not found');

  // Persisted stop request + explicit abort. In-flight provider executions keep
  // reconciling so a valid late result is preserved (not marked UNAVAILABLE just
  // because the run was aborted).
  await stopRun({ runId, actorId: userId, abort: true });

  await prisma.activityLog.create({
    data: {
      project_id: run.project_id,
      user_id: userId,
      action: `Aborted test run "${run.name}"`,
      entity_type: 'test_run',
      entity_id: runId,
    }
  });

  revalidatePath(`/p`);
  return true;
}

export async function raiseDefectAction(data: {
  runResultId: string;
  testCaseId: string;
  title: string;
  description?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  priorityName?: string;
  raisedBy: number;
  ticketUrl?: string;
  createExternalTicket?: boolean;
  spaceId?: string;
  spaceKey?: string;
  spaceName?: string;
  attachmentUrl?: string;
  attachmentFilename?: string;
  attachmentId?: string;
  attachments?: Array<{ id: string; filename: string; url?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunResultId(data.runResultId, userId);

  // Fetch runResult with testCase and project details
  const runResult = await prisma.runResult.findUnique({
    where: { id: data.runResultId },
    include: {
      test_case: {
        select: { id: true, display_id: true, title: true, module_id: true },
      },
      run: {
        include: {
          project: {
            select: { id: true, slug: true, name: true },
          },
        },
      },
    },
  });

  if (!runResult) throw new Error('Run result not found');

  const projectId = runResult.run.project.id;
  const projectSlug = runResult.run.project.slug;

  let externalTicketId: string | null = null;
  let finalTicketUrl: string | null = data.ticketUrl || null;
  let ticketStatus: string | null = null;

  // If user requested to create an external ticket in the PM tool
  if (data.createExternalTicket) {
    const effective = await getEffectivePmIntegration(projectId);

    if (effective && effective.enabled && effective.config.baseUrl && effective.config.apiKey) {
      try {
        const config = effective.config;
        const client = new CustomPmClient(config);

        const baseUrl = getBaseUrl();
        const caseKey = runResult.test_case.display_id || runResult.test_case.id;
        const testCaseRunUrl = `${baseUrl}/p/${projectSlug}/runs/${runResult.run_id}/${caseKey}`;
        const runOverviewUrl = `${baseUrl}/p/${projectSlug}/runs/${runResult.run_id}`;
        const executionKey = `${runResult.run_id}:${caseKey}${
          runResult.attempt_number > 1 ? `.${runResult.attempt_number}` : ''
        }`;

        const created = await client.createTicket({
          title: data.title,
          description: data.description || '',
          severity: data.severity,
          priorityName: data.priorityName,
          spaceId: data.spaceId || effective.defaultSpace?.id || undefined,
          spaceKey: data.spaceKey || effective.defaultSpace?.key || undefined,
          spaceName: data.spaceName || effective.defaultSpace?.name || undefined,
          testCaseDisplayId: runResult.test_case.display_id,
          testCaseTitle: runResult.test_case.title,
          runResultUrl: testCaseRunUrl,
          testCaseRunUrl,
          runUrl: runOverviewUrl,
          executionKey,
          testCaseLink: testCaseRunUrl,
          runId: runResult.run_id,
          environment: runResult.run.environment,
          attachmentUrl: data.attachmentUrl,
          attachmentFilename: data.attachmentFilename,
          attachments: data.attachments,
        });

        if (created.key || created.id) {
          externalTicketId = created.key || created.id;
          finalTicketUrl = created.url || finalTicketUrl;
          ticketStatus = created.status || 'To Do';

          await prisma.activityLog.create({
            data: {
              project_id: projectId,
              user_id: userId,
              actor_type: 'user',
              entity_type: 'integration_egress',
              entity_id: String(externalTicketId),
              action: `Outbound PM Tool: Created ticket #${externalTicketId} in InkaBoard (${data.severity || 'Defect'})`,
            },
          }).catch(() => null);
        }
      } catch (pmError: any) {
        logger.error('Failed to create ticket in PM tool', {
          module: 'Runs',
          action: 'raiseDefectAction',
          projectId,
          runResultId: data.runResultId,
          userId,
          errorCode: ErrorCodes.PM_INTEGRATION,
          error: pmError,
        });
        await prisma.activityLog.create({
          data: {
            project_id: projectId,
            user_id: userId,
            actor_type: 'user',
            entity_type: 'integration_egress',
            entity_id: 'pm_create_error',
            action: `Outbound PM Tool Error: Failed to create ticket in InkaBoard - ${pmError.message || 'Unknown error'} (HTTP 500)`,
          },
        }).catch(() => null);
      }
    }
  }

  const id = await generateDefectId();

  const defect = await prisma.defect.create({
    data: {
      id,
      run_result_id: data.runResultId,
      test_case_id: data.testCaseId,
      title: data.title,
      description: data.description,
      severity: data.severity,
      raised_by: data.raisedBy,
      ticket_url: finalTicketUrl,
      external_ticket_id: externalTicketId,
      ticket_status: ticketStatus,
      last_synced_at: externalTicketId ? new Date() : null,
    },
  });

  // Associate attachments with the defect without detaching existing run_result evidence
  const attachmentIdsToLink =
    data.attachments && data.attachments.length > 0
      ? data.attachments.map((a) => a.id).filter(Boolean)
      : data.attachmentId
      ? [data.attachmentId]
      : [];

  if (attachmentIdsToLink.length > 0) {
    try {
      const existingAtts = await prisma.attachment.findMany({
        where: { id: { in: attachmentIdsToLink } },
      });
      const toCloneForDefect = existingAtts.filter(
        (a) => a.entity_type === 'run_result' && a.storage_key
      );
      const toDirectUpdate = existingAtts
        .filter((a) => a.entity_type !== 'run_result')
        .map((a) => a.id);

      if (toDirectUpdate.length > 0) {
        await prisma.attachment.updateMany({
          where: { id: { in: toDirectUpdate } },
          data: {
            entity_type: 'defect',
            entity_id: defect.id,
            status: 'ACTIVE',
          },
        });
      }

      if (toCloneForDefect.length > 0) {
        await prisma.attachment.createMany({
          data: toCloneForDefect.map((a) => ({
            workspace_id: a.workspace_id,
            project_id: a.project_id,
            entity_type: 'defect',
            entity_id: defect.id,
            test_case_step_id: a.test_case_step_id,
            filename: a.filename,
            original_filename: a.original_filename,
            mime_type: a.mime_type,
            size_bytes: a.size_bytes,
            storage_type: a.storage_type,
            storage_key: a.storage_key,
            external_url: a.external_url,
            preview_url: a.preview_url,
            title: a.title,
            description: a.description,
            status: 'ACTIVE',
            uploaded_by: a.uploaded_by,
          })),
        });
      }
    } catch {
      // Non-fatal attachment linking
    }
  }

  // Trigger webhooks in background
  triggerProjectWebhooks(projectId, 'defect.created', {
    id: defect.id,
    title: defect.title,
    description: defect.description,
    severity: defect.severity,
    externalTicketId: defect.external_ticket_id,
    ticketUrl: defect.ticket_url,
    ticketStatus: defect.ticket_status,
    runResultId: defect.run_result_id,
    testCaseId: defect.test_case_id,
    raisedBy: defect.raised_by,
    raisedAt: defect.raised_at.toISOString(),
    source: 'inkatest',
  }).catch(() => null);

  // Trigger notifications (Slack Channel, In-App alerts)
  NotificationService.notifyDefectRaised({ defectId: defect.id }).catch((err) =>
    logger.error('Failed to notify defect creation', {
      module: 'Runs',
      action: 'raiseDefectAction',
      defectId: defect.id,
      projectId,
      errorCode: ErrorCodes.INTERNAL,
      error: err,
    })
  );

  revalidatePath('/p');

  return {
    id: defect.id,
    externalTicketId,
    ticketUrl: finalTicketUrl,
    ticketStatus,
  };
}

export async function resetRunResultsAction(runId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, userId);

  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { source: true },
  });
  if (!run) throw new Error('Run not found');

  const automated = ['postman', 'datadog', 'mixed', 'automated'].includes(
    String(run.source || '')
  );
  if (automated) {
    // Non-destructive: new attempts for every case, then start them. Previous
    // attempts stay available in history.
    const result = await startRunCases({ runId, actorId: userId, mode: 'rerun-all' });
    revalidatePath('/p');
    return { mode: 'new-attempts' as const, queued: result.queued };
  }

  await prisma.runResult.updateMany({
    where: { run_id: runId },
    data: {
      status: 'PENDING',
      execution_state: 'IDLE',
      execution_generation: 1,
      queued_at: null,
      started_at: null,
      finished_at: null,
      lease_owner: null,
      lease_expires_at: null,
      notes: null,
      evidence_url: null,
      executed_by: null,
      executed_at: null,
      failure_reason: null,
      step_results: Prisma.DbNull,
      source: 'manual',
      automation_log: null,
    },
  });

  revalidatePath('/p');
  return { mode: 'reset' as const, queued: 0 };
}

export async function assignRunResultAction(resultId: string, userId: number) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunResultId(resultId, uid);

  await prisma.runResult.update({
    where: { id: resultId },
    data: { assigned_to: userId },
  });

  return true;
}

export async function unassignRunResultAction(resultId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunResultId(resultId, uid);

  await prisma.runResult.update({
    where: { id: resultId },
    data: { assigned_to: null },
  });

  return true;
}

export async function deleteRunResultAction(resultId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunResultId(resultId, uid);

  const row = await prisma.runResult.findUnique({
    where: { id: resultId },
    select: { run_id: true, test_case_id: true },
  });
  if (!row) return true;

  // Remove every attempt of the case in this run, otherwise an older attempt
  // would simply reappear in the deck.
  await prisma.runResult.deleteMany({
    where: { run_id: row.run_id, test_case_id: row.test_case_id },
  });
  await reconcileRunState(row.run_id).catch(() => {});

  return true;
}

export async function bulkUpdateRunResultStatusAction(
  runId: string,
  data: {
    status: 'PASS' | 'FAIL' | 'ERROR' | 'BLOCKED' | 'SKIP' | 'INVALID';
    executedBy: number;
    source?: 'manual' | 'automated';
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, uid);

  await prisma.runResult.updateMany({
    // Never overwrite a case that is actively running or already completed.
    where: {
      run_id: runId,
      status: 'PENDING',
      execution_state: { in: ['IDLE', 'QUEUED'] },
    },
    data: {
      status: data.status,
      execution_state: 'SETTLED',
      finished_at: new Date(),
      lease_owner: null,
      lease_expires_at: null,
      executed_by: data.executedBy,
      executed_at: new Date(),
      source: data.source || 'manual',
    },
  });

  // Closing the run is now a derived decision; never leave it IN_PROGRESS once
  // no case is pending (e.g. Skip Remaining on a queued run).
  await reconcileRunState(runId).catch(() => {});

  return true;
}

/**
 * Apply one manual verdict to a set of run results.
 *
 * Only results the user may still act on are touched: a case that is already
 * running under a provider keeps its execution, and a case that already has a
 * verdict is left alone (re-running is the way to test it again).
 */
export async function bulkSetRunResultStatusAction(
  resultIds: string[],
  data: {
    status: 'PASS' | 'FAIL' | 'ERROR' | 'BLOCKED' | 'SKIP' | 'INVALID';
    executedBy: number;
    source?: 'manual' | 'automated' | 'list';
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  if (resultIds.length === 0) return { updated: 0, skipped: 0 };

  const rows = await prisma.runResult.findMany({
    where: { id: { in: resultIds } },
    select: {
      id: true,
      run_id: true,
      status: true,
      execution_state: true,
      test_case: {
        select: { project_id: true, type: true, custom_fields: true },
      },
    },
  });
  if (rows.length === 0) return { updated: 0, skipped: 0 };

  const projectIds = [...new Set(rows.map((r) => r.test_case.project_id))];
  for (const pid of projectIds) {
    await requireProjectMember(pid, uid);
  }

  // Never overwrite a case that a provider is currently executing, and never
  // overwrite a verdict an automation tool already produced: those cases have
  // to be re-run instead.
  const eligible = rows.filter((r) => {
    const state = String(r.execution_state || '').toUpperCase();
    if (r.status === 'PENDING' && ['RUNNING', 'WAITING'].includes(state)) {
      return false;
    }
    const automated = isAutomatedCase({
      type: r.test_case.type,
      custom_fields: r.test_case.custom_fields,
    });
    if (!automated) return true;
    // An automated case that is queued will be dispatched right away, so a
    // manual verdict on it would be overwritten anyway.
    if (r.status === 'PENDING' && state === 'QUEUED') return false;
    // A settled automated result is the tool's verdict: only a re-run changes it.
    if (String(r.status || '').toUpperCase() !== 'PENDING') return false;
    return true;
  });
  const eligibleIds = eligible.map((r) => r.id);

  if (eligibleIds.length === 0) {
    return { updated: 0, skipped: rows.length };
  }

  const updated = await prisma.runResult.updateMany({
    where: { id: { in: eligibleIds } },
    data: {
      status: data.status,
      execution_state: 'SETTLED',
      finished_at: new Date(),
      lease_owner: null,
      lease_expires_at: null,
      executed_by: data.executedBy,
      executed_at: new Date(),
      source: data.source || 'manual',
    },
  });

  const runIds = [...new Set(eligible.map((r) => r.run_id))];
  for (const rid of runIds) {
    await reconcileRunState(rid).catch(() => {});
  }

  revalidatePath('/p');
  return { updated: updated.count, skipped: rows.length - updated.count };
}

/**
 * Re-run a set of cases: every settled case gets a fresh attempt (its history
 * is preserved). Automated cases that have a linked runner are queued right
 * away; manual cases stay "Not run" until the tester executes them.
 */
export async function bulkRerunRunResultsAction(runId: string, resultIds: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, uid);
  if (resultIds.length === 0) return { created: 0, queued: 0, skipped: 0 };

  const rows = await prisma.runResult.findMany({
    where: { id: { in: resultIds }, run_id: runId },
    select: {
      id: true,
      status: true,
      execution_state: true,
      test_case: { select: { project_id: true } },
    },
  });
  if (rows.length === 0) return { created: 0, queued: 0, skipped: 0 };

  const projectIds = [...new Set(rows.map((r) => r.test_case.project_id))];
  for (const pid of projectIds) {
    await requireProjectMember(pid, uid);
  }

  // A case that is still in flight is left alone; it is already executing.
  const settled = rows.filter(
    (r) =>
      !(
        r.status === 'PENDING' &&
        ['RUNNING', 'WAITING', 'QUEUED'].includes(String(r.execution_state || '').toUpperCase())
      )
  );
  const settledIds = settled.map((r) => r.id);
  if (settledIds.length === 0) {
    return { created: 0, queued: 0, skipped: rows.length };
  }

  const created = await createRetryAttempts({
    runId,
    resultIds: settledIds,
    mode: 'rerun-all',
  });
  if (created.createdIds.length === 0) {
    return { created: 0, queued: 0, skipped: rows.length };
  }

  // Only automated cases with an in-app runner can be dispatched.
  const createdRows = await prisma.runResult.findMany({
    where: { id: { in: created.createdIds } },
    select: {
      id: true,
      test_case: { select: { type: true, custom_fields: true } },
    },
  });

  // The rerunner owns the fresh attempts that nobody is assigned to.
  await prisma.runResult
    .updateMany({
      where: { id: { in: created.createdIds }, assigned_to: null },
      data: { assigned_to: uid },
    })
    .catch(() => {});

  const queueIds = createdRows
    .filter((row) => {
      const source = getCaseAutomationSource({
        type: row.test_case.type,
        custom_fields: row.test_case.custom_fields,
      });
      return source === 'postman' || source === 'datadog';
    })
    .map((row) => row.id);

  let queued = 0;
  if (queueIds.length > 0) {
    const started = await startRunCases({
      runId,
      actorId: uid,
      resultIds: queueIds,
      mode: 'start',
    });
    queued = started.queued;
  }

  revalidatePath('/p');
  revalidatePath(`/p/runs/${runId}`);
  return {
    created: created.createdIds.length,
    queued,
    skipped: rows.length - created.createdIds.length,
  };
}

/**
 * Remove a set of cases from the run.
 *
 * Every attempt of the selected cases is removed, so the case really leaves
 * the run instead of an older attempt reappearing.
 */
export async function bulkDeleteRunResultsAction(resultIds: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  if (resultIds.length === 0) return { deleted: 0 };

  const rows = await prisma.runResult.findMany({
    where: { id: { in: resultIds } },
    select: {
      id: true,
      run_id: true,
      test_case_id: true,
      test_case: { select: { project_id: true } },
    },
  });
  if (rows.length === 0) return { deleted: 0 };

  const projectIds = [...new Set(rows.map((r) => r.test_case.project_id))];
  for (const pid of projectIds) {
    await requireProjectMember(pid, uid);
  }

  // Group by run so a case is only removed from the run it was selected in.
  const byRun = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!byRun.has(row.run_id)) byRun.set(row.run_id, new Set());
    byRun.get(row.run_id)!.add(row.test_case_id);
  }

  let deleted = 0;
  let cases = 0;
  for (const [runId, caseIds] of byRun) {
    const removed = await prisma.runResult.deleteMany({
      where: { run_id: runId, test_case_id: { in: [...caseIds] } },
    });
    deleted += removed.count;
    cases += caseIds.size;
    await reconcileRunState(runId).catch(() => {});
  }

  revalidatePath('/p');
  return { deleted, cases };
}

export async function bulkDeleteRunsAction(runIds: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  if (runIds.length === 0) throw new Error('No runs selected');

  // Validate all runs belong to projects the user can access
  const targetRuns = await prisma.testRun.findMany({
    where: { id: { in: runIds }, deleted_at: null },
    select: { id: true, project_id: true, name: true },
  });
  const uniqueProjectIds = [...new Set(targetRuns.map((r) => r.project_id))];
  for (const pid of uniqueProjectIds) {
    await requireProjectAdmin(pid, uid);
  }

  await prisma.testRun.updateMany({
    where: { id: { in: runIds }, deleted_at: null },
    data: { deleted_at: new Date() },
  });

  // One audit row per archived run: the metrics drop is explainable later.
  if (targetRuns.length > 0) {
    await prisma.activityLog.createMany({
      data: targetRuns.map((run) => ({
        project_id: run.project_id,
        user_id: uid,
        actor_type: 'user',
        action: `Archived test run "${run.name}"`,
        entity_type: 'test_run',
        entity_id: run.id,
        metadata: { name: run.name, bulk: true } as any,
      })),
    });
  }

  revalidatePath(`/p`);
  return true;
}

export async function deleteTestRunAction(runId: string) {
  return bulkDeleteRunsAction([runId]);
}

export async function rerunTestRunAction(
  runId: string,
  userId: number,
  mode: 'all' | 'failed_blocked' = 'all'
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, uid);

  const original = await prisma.testRun.findUnique({
    where: { id: runId },
    include: { results: true },
  });
  if (!original) throw new Error('Run not found');

  // Filter cases based on mode
  let targetResults = original.results;
  if (mode === 'failed_blocked') {
    targetResults = original.results.filter(
      (r) => r.status === 'FAIL' || r.status === 'ERROR' || r.status === 'BLOCKED'
    );
    if (targetResults.length === 0) {
      targetResults = original.results;
    }
  }

  const newId = await generateTestRunId();
  const rerunSuffix = mode === 'failed_blocked' ? 'Retest' : 'Rerun';
  const newRun = await prisma.testRun.create({
    data: {
      id: newId,
      project_id: original.project_id,
      suite_id: original.suite_id,
      name: `${original.name} (${rerunSuffix})`,
      environment: original.environment,
      build_version: original.build_version,
      assigned_to: original.assigned_to,
      source: original.source,
      trigger_ref: original.trigger_ref,
      status: 'IN_PROGRESS',
      started_at: new Date(),
      created_by: userId,
    },
  });

  if (targetResults.length > 0) {
    await prisma.runResult.createMany({
      data: targetResults.map((r, idx) => ({
        run_id: newId,
        test_case_id: r.test_case_id,
        test_version_id: r.test_version_id,
        order_index: idx + 1,
        status: 'PENDING',
        assigned_to: r.assigned_to,
      })),
    });
  }

  revalidatePath(`/p`);
  return { id: newRun.id, name: newRun.name, count: targetResults.length };
}

export async function bulkFinishRunsAction(runIds: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  if (runIds.length === 0) throw new Error('No runs selected');

  const runs = await prisma.testRun.findMany({
    where: { id: { in: runIds }, deleted_at: null },
    select: { id: true, project_id: true, status: true },
  });

  // Validate all runs belong to projects the user can access
  const uniqueProjectIds = [...new Set(runs.map((r) => r.project_id))];
  for (const pid of uniqueProjectIds) {
    await requireProjectMember(pid, uid);
  }

  const runIdsToFinish = runs.filter((r) => r.status === 'IN_PROGRESS').map((r) => r.id);
  if (runIdsToFinish.length === 0) return true;

  // Get latest results per test case for each run to ignore resolved re-runs
  const allResults = await prisma.runResult.findMany({
    where: { run_id: { in: runIdsToFinish } },
    orderBy: [{ test_case_id: 'asc' }, { attempt_number: 'desc' }],
    select: { run_id: true, test_case_id: true, status: true },
  });

  const seenPerRun = new Map<string, Set<string>>();
  const failRunIds = new Set<string>();

  for (const r of allResults) {
    let seenCases = seenPerRun.get(r.run_id);
    if (!seenCases) {
      seenCases = new Set<string>();
      seenPerRun.set(r.run_id, seenCases);
    }
    if (seenCases.has(r.test_case_id)) continue;
    seenCases.add(r.test_case_id);

    if (r.status === 'FAIL') {
      failRunIds.add(r.run_id);
    }
  }

  const now = new Date();
  const failedIds = runIdsToFinish.filter((id) => failRunIds.has(id));
  const completedIds = runIdsToFinish.filter((id) => !failRunIds.has(id));

  await Promise.all([
    failedIds.length > 0
      ? prisma.testRun.updateMany({
          where: { id: { in: failedIds } },
          data: { status: 'FAILED', completed_at: now },
        })
      : Promise.resolve(),
    completedIds.length > 0
      ? prisma.testRun.updateMany({
          where: { id: { in: completedIds } },
          data: { status: 'COMPLETED', completed_at: now },
        })
      : Promise.resolve(),
  ]);

  for (const id of runIdsToFinish) {
    NotificationService.notifyRunCompleted(id).catch(() => null);
  }

  revalidatePath(`/p`);
  return true;
}

export async function cloneTestRunAction(runId: string, userId: number, options?: {
  name?: string;
  environment?: string;
  assignee?: number;
  cloneCaseAssignments?: boolean;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, uid);

  const original = await prisma.testRun.findUnique({
    where: { id: runId },
    include: { results: true },
  });
  if (!original) throw new Error('Run not found');

  const newId = await generateTestRunId();
  const newRun = await prisma.testRun.create({
    data: {
      id: newId,
      project_id: original.project_id,
      suite_id: original.suite_id,
      name: options?.name || `${original.name} (Copy)`,
      environment: options?.environment || original.environment,
      build_version: original.build_version,
      assigned_to: options?.assignee !== undefined ? options.assignee : original.assigned_to,
      source: original.source,
      trigger_ref: original.trigger_ref,
      resolved_variables: original.resolved_variables ? (original.resolved_variables as any) : Prisma.DbNull,
      resolved_datasets: original.resolved_datasets ? (original.resolved_datasets as any) : Prisma.DbNull,
      status: 'IN_PROGRESS',
      started_at: new Date(),
      created_by: userId,
    },
  });

  if (original.results.length > 0) {
    await prisma.runResult.createMany({
      data: original.results.map((r) => ({
        run_id: newId,
        test_case_id: r.test_case_id,
        test_version_id: r.test_version_id,
        order_index: r.order_index,
        status: 'PENDING',
        assigned_to: options?.cloneCaseAssignments
          ? r.assigned_to
          : (options?.assignee !== undefined ? options.assignee : null),
      })),
    });
  }

  revalidatePath(`/p`);
  return { id: newRun.id, name: newRun.name };
}

export async function getRunResultHistoryAction(testCaseId: string, currentRunId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const uid = (session.user as any).id as number;

  await requireProjectMemberByCaseId(testCaseId, uid, 'VIEWER');

  const results = await prisma.runResult.findMany({
    where: { test_case_id: testCaseId },
    orderBy: [{ attempt_number: 'desc' }, { executed_at: 'desc' }],
    include: {
      run: { select: { id: true, name: true, environment: true, status: true } },
      defects: true,
    },
  });

  return results.map((r) => ({
    id: r.id,
    runId: r.run_id,
    runName: r.run.name,
    runEnvironment: r.run.environment,
    runStatus: r.run.status.toLowerCase(),
    attemptNumber: r.attempt_number,
    status: r.status.toLowerCase(),
    executedBy: r.executed_by,
    executedAt: r.executed_at?.toISOString(),
    notes: r.notes,
    failureReason: r.failure_reason,
    defectCount: r.defects.length,
    timeSpentSeconds: r.time_spent_seconds ?? 0,
    stepResults: (r.step_results as Record<string, any>) || {},
    automationLog: r.automation_log || null,
  }));
}
export async function updateTestRunAction(runId: string, data: {
  name?: string;
  environment?: string;
  buildVersion?: string;
  assignedTo?: number | null;
  environmentDetails?: Record<string, any>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, uid);

  const run = await prisma.testRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error('Run not found');
  if (run.status === 'ABORTED') throw new Error('Cannot edit an aborted run');

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.environment !== undefined) updateData.environment = data.environment;
  if (data.buildVersion !== undefined) updateData.build_version = data.buildVersion;
  if (data.assignedTo !== undefined) updateData.assigned_to = data.assignedTo;
  if (data.environmentDetails !== undefined) {
    // Merge so unrelated custom fields survive an environment edit.
    const existing =
      run.custom_fields && typeof run.custom_fields === 'object'
        ? { ...(run.custom_fields as Record<string, any>) }
        : {};
    const details = normalizeRunEnvironmentDetails(data.environmentDetails);
    if (hasRunEnvironmentDetails(details)) existing.environmentDetails = details;
    else delete existing.environmentDetails;
    updateData.custom_fields = existing;
  }

  await prisma.testRun.update({ where: { id: runId }, data: updateData });

  revalidatePath(`/p`);
  return true;
}

export async function addCasesToRunAction(runId: string, testCaseIds: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, uid);

  const run = await prisma.testRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error('Run not found');
  if (run.status !== 'IN_PROGRESS') throw new Error('Can only add cases to an in-progress run');

  if (testCaseIds.length === 0) return { added: 0 };

  const cases = await prisma.testCase.findMany({
    where: { id: { in: testCaseIds }, deleted_at: null },
    include: { dataset: true },
  });

  if (cases.length === 0) throw new Error('No valid cases to add');

  const existingResults = await prisma.runResult.findMany({
    where: { run_id: runId },
    select: { test_case_id: true },
  });
  const existingIds = new Set(existingResults.map((r) => r.test_case_id));
  const newCases = cases.filter((c) => !existingIds.has(c.id));

  if (newCases.length === 0) throw new Error('All selected cases are already in this run');

  const maxOrder = await prisma.runResult.aggregate({
    where: { run_id: runId },
    _max: { order_index: true },
  });
  let nextOrder = (maxOrder._max.order_index ?? -1) + 1;

  // Lock each appended case to its current snapshot, exactly like cases picked
  // at run creation, so a later edit is detectable from the deck.
  const versionRows = await prisma.testCaseVersion.findMany({
    where: { test_case_id: { in: newCases.map((c) => c.id) } },
    orderBy: { version_number: 'desc' },
    select: { id: true, test_case_id: true },
  });
  const versionMap = new Map<string, string>();
  for (const v of versionRows) {
    if (!versionMap.has(v.test_case_id)) versionMap.set(v.test_case_id, v.id);
  }

  await prisma.runResult.createMany({
    data: newCases.map((tc) => ({
      run_id: runId,
      test_case_id: tc.id,
      test_version_id: versionMap.get(tc.id) ?? null,
      order_index: nextOrder++,
      status: 'PENDING',
      attempt_number: 1,
    })),
  });

  // Snapshot datasets for newly added cases into testRun.resolved_datasets
  const currentResolvedDatasets = (run.resolved_datasets && typeof run.resolved_datasets === 'object')
    ? { ...(run.resolved_datasets as Record<string, any>) }
    : {};
  let datasetsUpdated = false;

  for (const c of newCases) {
    if (c.dataset) {
      currentResolvedDatasets[c.id] = {
        datasetName: c.dataset.name,
        parameters: c.dataset.parameters || [],
        rows: (c.dataset.rows as any[]) || [],
      };
      datasetsUpdated = true;
    } else if (c.local_dataset && typeof c.local_dataset === 'object') {
      const ld = c.local_dataset as any;
      if (Array.isArray(ld.parameters) && ld.parameters.length > 0) {
        currentResolvedDatasets[c.id] = {
          datasetName: 'Case Parameters',
          parameters: ld.parameters,
          rows: Array.isArray(ld.rows) ? ld.rows : [],
        };
        datasetsUpdated = true;
      }
    }
  }

  if (datasetsUpdated) {
    await prisma.testRun.update({
      where: { id: runId },
      data: { resolved_datasets: currentResolvedDatasets },
    });
  }

  // Append + queue: when the run is already executing, the new cases join the
  // queue instead of sitting idle until someone presses Start again.
  const createdRows = await prisma.runResult.findMany({
    where: { run_id: runId, test_case_id: { in: newCases.map((c) => c.id) } },
    select: { id: true },
  });
  const activeStates = ['QUEUED', 'RUNNING', 'WAITING'];
  const inFlight = await prisma.runResult.findFirst({
    where: { run_id: runId, status: 'PENDING', execution_state: { in: activeStates } },
    select: { id: true },
  });
  if (inFlight && createdRows.length > 0) {
    await startRunCases({
      runId,
      actorId: uid,
      resultIds: createdRows.map((r) => r.id),
      mode: 'start',
      startImmediately: true,
    }).catch((error) => {
      logger.warn('add-cases: could not queue appended cases', { runId, error });
    });
  }

  revalidatePath(`/p`);
  return { added: newCases.length, queued: inFlight ? createdRows.length : 0 };
}

/**
 * Mark a manual case as started the first time its console is opened.
 *
 * Idempotent: the conditional write only lands while the case is undecided and
 * has no start timestamp yet, so re-opening the console never moves the clock.
 */
export async function startManualResultAction(resultId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunResultId(resultId, uid);

  const updated = await prisma.runResult.updateMany({
    where: {
      id: resultId,
      status: 'PENDING',
      started_at: null,
      execution_state: 'IDLE',
    },
    data: { started_at: new Date() },
  });

  return { started: updated.count === 1 };
}

export async function reorderRunCasesAction(runId: string, orderedResultIds: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, uid);

  if (!Array.isArray(orderedResultIds) || orderedResultIds.length === 0) {
    throw new Error('No cases to reorder');
  }

  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  });
  if (!run) throw new Error('Run not found');

  const rows = await prisma.runResult.findMany({
    where: { run_id: runId },
    select: { id: true, status: true, execution_state: true, order_index: true, test_case_id: true, attempt_number: true },
    orderBy: [{ order_index: 'asc' }, { id: 'asc' }],
  });

  // Latest attempt per case is the row that owns a position.
  const latestByCase = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = latestByCase.get(row.test_case_id);
    if (!current || (row.attempt_number || 1) >= (current.attempt_number || 1)) {
      latestByCase.set(row.test_case_id, row);
    }
  }
  const latestRows = [...latestByCase.values()].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
  );

  // Reordering is only meaningful for a run that is not executing anything and
  // only for cases that have not been run yet. Executed rows never move.
  const activeStates = [EXECUTION_STATE.RUNNING, EXECUTION_STATE.WAITING, EXECUTION_STATE.QUEUED] as string[];
  const hasActive = latestRows.some(
    (row) => row.status === 'PENDING' && activeStates.includes(row.execution_state as string)
  );
  if (hasActive) {
    throw new Error('Stop the run before changing the execution order');
  }

  const movable = latestRows.filter(
    (row) => row.status === 'PENDING' && row.execution_state === EXECUTION_STATE.IDLE
  );
  const movableIds = new Set(movable.map((row) => row.id));

  if (
    orderedResultIds.length !== movableIds.size ||
    new Set(orderedResultIds).size !== orderedResultIds.length ||
    orderedResultIds.some((id) => !movableIds.has(id))
  ) {
    throw new Error('Only not-run cases can be reordered');
  }

  if (movable.length < 2) return { reordered: 0 };

  // Fill the movable slots in the requested order, leaving executed rows exactly
  // where they are so history stays readable.
  const queue = [...orderedResultIds];
  const finalOrder = latestRows.map((row) =>
    movableIds.has(row.id) ? queue.shift()! : row.id
  );

  await prisma.$transaction(
    finalOrder.map((id, index) =>
      prisma.runResult.update({ where: { id }, data: { order_index: index + 1 } })
    )
  );

  revalidatePath(`/p`);
  return { reordered: movable.length };
}

export async function resetSingleResultAction(resultId: string, retryMode: 'all' | 'failed_only' = 'all') {  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunResultId(resultId, uid);

  const original = await prisma.runResult.findUnique({ where: { id: resultId } });
  if (!original) throw new Error('Result not found');

  const run = await prisma.testRun.findUnique({ where: { id: original.run_id } });
  if (!run) throw new Error('Run not found');
  if (run.status === 'ABORTED') throw new Error('Cannot re-run in an aborted run');
  if (original.status === 'PENDING') throw new Error('Case is already pending');

  // Creates a new attempt; the previous attempt (and its evidence) is preserved.
  const created = await createRetryAttempts({
    runId: original.run_id,
    resultIds: [original.id],
    mode: 'rerun-all',
    retryMode,
  });
  if (created.createdIds.length === 0) {
    throw new Error('Could not create a new attempt for this case');
  }

  // Whoever queues the retry owns the case when nobody is assigned to it.
  await prisma.runResult
    .updateMany({
      where: { id: { in: created.createdIds }, assigned_to: null },
      data: { assigned_to: uid },
    })
    .catch(() => {});

  revalidatePath('/p');
  return { newResultId: created.createdIds[0] };
}

/**
 * "Skip Remaining": only not-yet-started cases are skipped. Running cases and
 * provider monitors are never overwritten by a skip.
 */
export async function skipRemainingRunCasesAction(runId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, uid);
  const result = await skipRemainingCases({ runId, actorId: uid });
  revalidatePath('/p');
  return result;
}

export async function archiveTestRunAction(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(id, uid);

  const run = await prisma.testRun.update({
    where: { id },
    data: { deleted_at: new Date() },
    select: { id: true, name: true, project_id: true },
  });

  // Archiving removes a run from every metric, so it must be auditable.
  await prisma.activityLog.create({
    data: {
      project_id: run.project_id,
      user_id: uid,
      actor_type: 'user',
      action: `Archived test run "${run.name}"`,
      entity_type: 'test_run',
      entity_id: run.id,
      metadata: { name: run.name },
    },
  });

  revalidatePath(`/p`);
  return true;
}

export async function getArchivedRunsAction(projectId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMember(projectId, userId);

  const archived = await prisma.testRun.findMany({
    where: { project_id: projectId, deleted_at: { not: null } },
    orderBy: { deleted_at: 'desc' },
    include: {
      results: {
        select: {
          id: true,
          run_id: true,
          test_case_id: true,
          status: true,
          attempt_number: true,
        },
      },
    },
  });

  return archived.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    suiteId: r.suite_id,
    name: r.name,
    environment: r.environment,
    buildVersion: r.build_version,
    assignedTo: r.assigned_to,
    status: r.status.toLowerCase(),
    source: r.source,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    startedAt: r.started_at?.toISOString(),
    completedAt: r.completed_at?.toISOString(),
    deletedAt: r.deleted_at?.toISOString(),
    results: r.results.map((res) => ({
      id: res.id,
      run_id: res.run_id,
      test_case_id: res.test_case_id,
      status: res.status,
      attempt_number: res.attempt_number,
    })),
  }));
}

export async function restoreTestRunAction(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const uid = (session.user as any).id as number;
  await requireProjectMemberByRunId(id, uid);

  const run = await prisma.testRun.update({
    where: { id },
    data: { deleted_at: null },
    select: { id: true, name: true, project_id: true },
  });

  await prisma.activityLog.create({
    data: {
      project_id: run.project_id,
      user_id: uid,
      actor_type: 'user',
      action: `Restored test run "${run.name}"`,
      entity_type: 'test_run',
      entity_id: run.id,
      metadata: { name: run.name },
    },
  });

  revalidatePath(`/p`);
  return true;
}




export async function getProjectRunsAction(projectId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const { getTestRuns } = await import('@/lib/dal/projects');
  const { mapPrismaRunToMock } = await import('@/lib/dal/mappers');
  const prismaRuns = await getTestRuns(projectId);
  return prismaRuns.map(mapPrismaRunToMock);
}
