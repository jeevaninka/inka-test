'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import {
  generateCases,
  improveSteps,
  enrichTestCasesWithAI,
  generateDefectReport,
  generateDatasetRows,
  GenerateDefectInput,
  DefectEvidencePart,
  GenerateDatasetRowsInput,
} from '@/lib/ai/client';
import { logAiCall, createAiSuggestion } from '@/lib/dal/ai';
import { createTestCaseAction } from './cases';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireProjectMember, requireProjectMemberByCaseId } from '@/lib/permissions';
import { s3Client, getBucketName } from '@/lib/s3/client';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';
import { enforceAiRateLimit } from '@/lib/rate-limit';

export interface ProjectAiConfig {
  enrichment: boolean;
  excelGeneration: boolean;
  defectDrafting: boolean;
  evidenceVision: boolean;
  datasetGeneration: boolean;
  selfHealing: boolean;
  deduplication: boolean;
  exploratory: boolean;
}

const DEFAULT_AI_CONFIG: ProjectAiConfig = {
  enrichment: true,
  excelGeneration: true,
  defectDrafting: true,
  evidenceVision: true,
  datasetGeneration: true,
  selfHealing: true,
  deduplication: true,
  exploratory: false,
};

async function getEffectiveAiConfig(projectId: string): Promise<{
  aiEnabled: boolean;
  config: ProjectAiConfig;
}> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, workspace_id: true, ai_enabled: true },
  });

  if (!project) {
    return { aiEnabled: false, config: DEFAULT_AI_CONFIG };
  }

  const [wsRecord, projRecord] = await Promise.all([
    project.workspace_id
      ? prisma.integration.findUnique({
          where: {
            workspace_id_provider: {
              workspace_id: project.workspace_id,
              provider: 'ai_config',
            },
          },
        })
      : Promise.resolve(null),
    prisma.integration.findUnique({
      where: {
        project_id_provider: {
          project_id: project.id,
          provider: 'ai_config',
        },
      },
    }),
  ]);

  const wsCfg = (wsRecord?.config && typeof wsRecord.config === 'object' ? wsRecord.config : {}) as Partial<ProjectAiConfig>;
  const projCfg = (projRecord?.config && typeof projRecord.config === 'object' ? projRecord.config : {}) as Partial<ProjectAiConfig>;

  return {
    aiEnabled: Boolean(project.ai_enabled),
    config: {
      ...DEFAULT_AI_CONFIG,
      ...wsCfg,
      ...projCfg,
    },
  };
}

export async function generateCasesAction(data: {
  projectId: string;
  description: string;
  moduleId?: string;
  tags?: string[];
  count?: number | 'auto';
  customInstructions?: string;
  reusableSteps?: { id: string; title: string; step: string; expected_result: string | null }[];
  projectModules?: { id: string; name: string }[];
  files?: { name: string; mimeType: string; data: string }[];
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);
  enforceAiRateLimit(userId, 'generate-cases');

  const projectConfig = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { ai_enabled: true },
  });
  if (projectConfig && !projectConfig.ai_enabled) {
    throw new Error('AI features are disabled for this project');
  }

  const maxInputChars = Number(process.env.AI_INPUT_CAP) || 8000;
  const trimmedDescription = data.description.slice(0, maxInputChars);

  const startTime = Date.now();

  try {
    const generated = await generateCases({
      description: trimmedDescription,
      tags: data.tags,
      count: data.count || 5,
      customInstructions: data.customInstructions,
      reusableSteps: data.reusableSteps,
      projectModules: data.projectModules,
      files: data.files,
    });

    await logAiCall({
      project_id: data.projectId,
      user_id: userId,
      feature: 'generate_cases',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.0',
      input_chars: data.description.length,
      output_chars: JSON.stringify(generated).length,
      duration_ms: Date.now() - startTime,
      status: 'success',
    });

    return generated;
  } catch (error: any) {
    await logAiCall({
      project_id: data.projectId,
      user_id: userId,
      feature: 'generate_cases',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.0',
      input_chars: data.description.length,
      output_chars: 0,
      duration_ms: Date.now() - startTime,
      status: 'error',
      error_message: error.message,
    });
    logger.error('AI test case generation failed', {
      module: 'AI',
      action: 'generateCasesAction',
      projectId: data.projectId,
      userId,
      durationMs: Date.now() - startTime,
      errorCode: ErrorCodes.AI_SERVICE,
      error,
    });
    throw new Error(`AI generation failed: ${error.message}`);
  }
}

export async function acceptAiCaseAction(data: {
  generated: {
    title: string;
    description?: string;
    preConditions?: string;
    expectedResult?: string;
    postConditions?: string;
    steps: { order: number; description: string; expectedResult?: string; data?: string; reusableStepId?: string | null }[];
    priority: string;
    suggestedTags: string[];
    scenarioType?: string;
  };
  projectId: string;
  moduleId?: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const saved = await createTestCaseAction({
    projectId: data.projectId,
    moduleId: data.moduleId || null,
    title: data.generated.title,
    description: data.generated.description,
    preConditions: data.generated.preConditions,
    expectedResult: data.generated.expectedResult,
    postConditions: data.generated.postConditions,
    steps: data.generated.steps,
    priority: data.generated.priority as any,
    type: 'manual',
    status: 'draft',
    tags: data.generated.suggestedTags,
    scenarioType: data.generated.scenarioType,
  });

  await createAiSuggestion({
    project_id: data.projectId,
    suggestion_type: 'NEW_TEST_CASE',
    payload: data.generated as any,
    test_case_id: saved.id,
  });

  revalidatePath('/p');
  return saved;
}

export async function acceptMultipleAiCasesAction(data: {
  cases: {
    title: string;
    description?: string;
    preConditions?: string;
    expectedResult?: string;
    postConditions?: string;
    steps: { order: number; description?: string; step?: string; expectedResult?: string; data?: string; meta?: string; reusableStepId?: string | null }[];
    priority: string;
    type?: string;
    status?: string;
    suggestedTags: string[];
    scenarioType?: string;
    moduleId?: string | null;
    customFields?: Record<string, any>;
    aiGenerated?: boolean;
  }[];
  projectId: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const results = [];
  for (const generated of data.cases) {
    const saved = await createTestCaseAction({
      projectId: data.projectId,
      moduleId: generated.moduleId || null,
      title: generated.title,
      description: generated.description,
      preConditions: generated.preConditions,
      expectedResult: generated.expectedResult,
      postConditions: generated.postConditions,
      steps: generated.steps,
      priority: generated.priority as any,
      type: generated.type || 'manual',
      status: generated.status || 'draft',
      tags: generated.suggestedTags,
      scenarioType: generated.scenarioType,
      customFields: generated.customFields,
      aiGenerated: generated.aiGenerated ?? true,
    });

    await createAiSuggestion({
      project_id: data.projectId,
      suggestion_type: 'NEW_TEST_CASE',
      payload: generated as any,
      test_case_id: saved.id,
    });

    const persistedSteps = await prisma.testCaseStep.findMany({
      where: { test_case_id: saved.id },
      orderBy: { order: 'asc' },
    });
    
    results.push({
      ...saved,
      displayId: saved.display_id,
      projectId: saved.project_id,
      moduleId: saved.module_id,
      preConditions: saved.pre_conditions,
      postConditions: saved.post_conditions,
      expectedResult: saved.expected_result,
      priority: saved.priority.toUpperCase(),
      type: saved.type.toLowerCase(),
      status: saved.status.toLowerCase(),
      scenarioType: saved.scenario_type,
      aiGenerated: saved.ai_generated,
      customFields: (saved.custom_fields as Record<string, any>) || {},
      custom_fields: (saved.custom_fields as Record<string, any>) || {},
      createdBy: saved.created_by,
      createdAt: saved.created_at.toISOString(),
      steps: persistedSteps.map((s) => ({
        id: s.id,
        order: s.order,
        step: s.step,
        expected_result: s.expected_result,
        data: s.data,
        meta: s.meta,
        reusable_step_id: s.reusable_step_id,
        reusable_step_item_id: s.reusable_step_item_id,
        is_outdated: s.is_outdated,
        image_url: s.image_url,
      })),
    });
  }

  revalidatePath('/p');
  return results;
}

export async function suggestModuleAction(data: {
  title: string;
  modules: { id: string; name: string }[];
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  if (!data.title || data.modules.length === 0) return null;

  // Simple keyword matching for now (faster, no API cost)
  const titleLower = data.title.toLowerCase();
  
  // Find a module whose name appears in the title
  let match = data.modules.find(m => titleLower.includes(m.name.toLowerCase()));
  
  // Or find a module where the title contains words from the module name
  if (!match) {
    match = data.modules.find(m => {
      const words = m.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return words.some(w => titleLower.includes(w));
    });
  }

  return match ? match.id : null;
}

export async function improveStepsAction(data: {
  caseId: string;
  title: string;
  description?: string;
  customInstructions?: string;
  steps: { order: number; description: string; expectedResult?: string; data?: string }[];
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  await requireProjectMemberByCaseId(data.caseId, userId);
  enforceAiRateLimit(userId, 'improve-steps');

  const startTime = Date.now();

  try {
    const testCase = await prisma.testCase.findUnique({
      where: { id: data.caseId },
      select: {
        project_id: true,
        tags: true,
        pre_conditions: true,
        expected_result: true,
      },
    });

    let reusableSteps: any[] = [];
    let existingTags: string[] = [];
    if (testCase) {
      const { aiEnabled, config } = await getEffectiveAiConfig(testCase.project_id);
      if (!aiEnabled || !config.enrichment) {
        throw new Error('AI step enrichment is disabled for this project');
      }

      const [rs, cases] = await Promise.all([
        prisma.reusableStep.findMany({
          where: { project_id: testCase.project_id },
          select: { id: true, title: true, step: true, expected_result: true },
        }),
        prisma.testCase.findMany({
          where: { project_id: testCase.project_id, deleted_at: null },
          select: { tags: true },
        }),
      ]);
      reusableSteps = rs;
      existingTags = Array.from(new Set(cases.flatMap((c) => c.tags || [])));
    }

    const improved = await improveSteps({
      title: data.title,
      description: data.description,
      preConditions: testCase?.pre_conditions || undefined,
      expectedResult: testCase?.expected_result || undefined,
      tags: testCase?.tags || undefined,
      existingTags,
      customInstructions: data.customInstructions,
      reusableSteps,
      steps: data.steps,
    });

    await logAiCall({
      project_id: data.caseId,
      user_id: userId,
      feature: 'improve_steps',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.0',
      input_chars: JSON.stringify(data.steps).length,
      output_chars: JSON.stringify(improved).length,
      duration_ms: Date.now() - startTime,
      status: 'success',
    });

    return improved;
  } catch (error: any) {
    await logAiCall({
      project_id: data.caseId,
      user_id: userId,
      feature: 'improve_steps',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.0',
      input_chars: JSON.stringify(data.steps).length,
      output_chars: 0,
      duration_ms: Date.now() - startTime,
      status: 'error',
      error_message: error.message,
    });
    throw new Error(`AI improvement failed: ${error.message}`);
  }
}

export async function enrichTestCasesWithAIAction(data: {
  projectId: string;
  customInstructions?: string;
  cases: {
    _id: string;
    title: string;
    description?: string;
    preConditions?: string;
    postConditions?: string;
    priority?: string;
    type?: string;
    scenarioType?: string;
    steps: {
      order: number;
      step: string;
      expectedResult?: string;
      data?: string;
    }[];
  }[];
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);
  enforceAiRateLimit(userId, 'enrich-excel');

  const { aiEnabled, config } = await getEffectiveAiConfig(actualProjectId);
  if (!aiEnabled || !config.excelGeneration) {
    throw new Error('AI spreadsheet enrichment is disabled for this project');
  }

  const startTime = Date.now();

  try {
    const [modules, reusableSteps, projectCases] = await Promise.all([
      prisma.module.findMany({
        where: { project_id: data.projectId },
        select: { id: true, name: true },
      }),
      prisma.reusableStep.findMany({
        where: { project_id: data.projectId },
        select: { id: true, title: true, step: true, expected_result: true },
      }),
      prisma.testCase.findMany({
        where: { project_id: data.projectId, deleted_at: null },
        select: { tags: true },
      }),
    ]);

    const existingTags = Array.from(
      new Set(projectCases.flatMap((c) => c.tags || []))
    );

    const CHUNK_SIZE = 5;
    const chunks = [];
    for (let i = 0; i < data.cases.length; i += CHUNK_SIZE) {
      chunks.push(data.cases.slice(i, i + CHUNK_SIZE));
    }

    const chunkPromises = chunks.map(chunk =>
      enrichTestCasesWithAI(chunk, modules, reusableSteps, existingTags, data.customInstructions)
    );
    const enrichedChunks = await Promise.all(chunkPromises);
    
    // Flatten array and filter out nulls/errors if any chunk failed
    const enriched = enrichedChunks.flat().filter(Boolean) as any[];

    await logAiCall({
      project_id: data.projectId,
      user_id: userId,
      feature: 'enrich_test_cases',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.0',
      input_chars: JSON.stringify(data.cases).length,
      output_chars: JSON.stringify(enriched).length,
      duration_ms: Date.now() - startTime,
      status: 'success',
    });

    return enriched;
  } catch (error: any) {
    await logAiCall({
      project_id: data.projectId,
      user_id: userId,
      feature: 'enrich_test_cases',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.0',
      input_chars: JSON.stringify(data.cases).length,
      output_chars: 0,
      duration_ms: Date.now() - startTime,
      status: 'error',
      error_message: error.message,
    });
    logger.error('AI test case enrichment failed', {
      module: 'AI',
      action: 'enrichTestCasesWithAIAction',
      projectId: data.projectId,
      userId,
      caseCount: data.cases.length,
      durationMs: Date.now() - startTime,
      errorCode: ErrorCodes.AI_SERVICE,
      error,
    });
    return null;
  }
}

async function loadEvidencePartsFromS3(
  projectId: string,
  attachmentIds: string[]
): Promise<DefectEvidencePart[]> {
  if (!attachmentIds || attachmentIds.length === 0) return [];
  const bucket = getBucketName();
  if (!bucket) return [];

  const attachments = await prisma.attachment.findMany({
    where: {
      id: { in: attachmentIds.slice(0, 4) },
      project_id: projectId,
      status: 'ACTIVE',
      storage_type: 'S3',
    },
    select: {
      id: true,
      filename: true,
      mime_type: true,
      size_bytes: true,
      storage_key: true,
    },
  });

  const parts: DefectEvidencePart[] = [];
  let imageCount = 0;

  for (const att of attachments) {
    if (!att.storage_key) continue;
    const ext = (att.filename.split('.').pop() || '').toLowerCase();
    const mime = (att.mime_type || '').toLowerCase();
    const isImage =
      mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
    const isLogOrText =
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      ['log', 'txt', 'json', 'csv', 'xml'].includes(ext);

    if (!isImage && !isLogOrText) continue;
    if (isImage && imageCount >= 2) continue;
    if (att.size_bytes && att.size_bytes > 5 * 1024 * 1024) continue;

    try {
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: att.storage_key });
      const res = await s3Client.send(cmd);
      if (!res.Body) continue;
      const bytes = await res.Body.transformToByteArray();

      if (isImage) {
        imageCount++;
        parts.push({
          name: att.filename,
          mimeType:
            mime.startsWith('image/')
              ? mime
              : ext === 'jpg' || ext === 'jpeg'
              ? 'image/jpeg'
              : ext === 'webp'
              ? 'image/webp'
              : 'image/png',
          data: Buffer.from(bytes).toString('base64'),
          isTextLog: false,
        });
      } else if (isLogOrText) {
        const rawText = Buffer.from(bytes).toString('utf-8');
        const tailText = rawText.length > 12000 ? rawText.slice(-12000) : rawText;
        parts.push({
          name: att.filename,
          mimeType: 'text/plain',
          data: tailText,
          isTextLog: true,
        });
      }
    } catch (err: any) {
      logger.warn('Skipped S3 evidence attachment during AI defect draft', {
        module: 'AI',
        action: 'loadEvidencePartsFromS3',
        attachmentId: att.id,
        reason: err?.message,
      });
    }
  }

  return parts;
}

export async function generateDefectReportAction(data: {
  projectId: string;
  defectInput: GenerateDefectInput;
  attachmentIds?: string[];
  inlineEvidence?: DefectEvidencePart[];
  includeEvidence?: boolean;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);
  enforceAiRateLimit(userId, 'defect-report');

  const { aiEnabled, config } = await getEffectiveAiConfig(actualProjectId);
  if (!aiEnabled || !config.defectDrafting) {
    throw new Error('AI defect drafting is disabled for this project');
  }

  const startTime = Date.now();

  try {
    let evidenceFiles: DefectEvidencePart[] = [];
    if (data.includeEvidence !== false && config.evidenceVision) {
      const s3Parts = data.attachmentIds?.length
        ? await loadEvidencePartsFromS3(actualProjectId, data.attachmentIds)
        : [];
      const inlineParts = (data.inlineEvidence || []).slice(0, 2);
      evidenceFiles = [...s3Parts, ...inlineParts].slice(0, 3);
    }

    const report = await generateDefectReport({
      ...data.defectInput,
      evidenceFiles,
    });

    await logAiCall({
      project_id: actualProjectId,
      user_id: userId,
      feature: 'generate_defect',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.1',
      input_chars:
        (data.defectInput.caseTitle + (data.defectInput.failureNotes || '') + (data.defectInput.stepNote || '')).length,
      output_chars: JSON.stringify(report).length,
      duration_ms: Date.now() - startTime,
      status: 'success',
    });

    return report;
  } catch (error: any) {
    await logAiCall({
      project_id: actualProjectId,
      user_id: userId,
      feature: 'generate_defect',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.1',
      input_chars:
        (data.defectInput.caseTitle + (data.defectInput.failureNotes || '') + (data.defectInput.stepNote || '')).length,
      output_chars: 0,
      duration_ms: Date.now() - startTime,
      status: 'error',
      error_message: error.message,
    });
    logger.error('AI defect report generation failed', {
      module: 'AI',
      action: 'generateDefectReportAction',
      projectId: actualProjectId,
      userId,
      durationMs: Date.now() - startTime,
      errorCode: ErrorCodes.AI_SERVICE,
      error,
    });
    throw new Error(`AI defect generation failed: ${error.message}`);
  }
}

export interface DuplicateDefectCandidate {
  id: string;
  title: string;
  severity: string;
  externalTicketId: string | null;
  ticketUrl: string | null;
  ticketStatus: string | null;
  testCaseDisplayId?: string;
  sameCase: boolean;
  similarityScore: number;
}

function computeTokenOverlap(textA: string, textB: string): number {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'when', 'from', 'that', 'this', 'step', 'test', 'case',
    'issue', 'bug', 'fail', 'failed', 'error', 'verify', 'check', 'validate', 'should',
  ]);
  const tokenize = (s: string) =>
    new Set(
      (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w))
    );
  const setA = tokenize(textA);
  const setB = tokenize(textB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let common = 0;
  setA.forEach((w) => {
    if (setB.has(w)) common++;
  });
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : common / union;
}

export async function checkDuplicateDefectsAction(data: {
  projectId: string;
  testCaseId?: string;
  title?: string;
  failedStepAction?: string;
  failureNotes?: string;
}): Promise<DuplicateDefectCandidate[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return [];
  const userId = (session.user as any).id as number;

  try {
    const actualProjectId = await requireProjectMember(data.projectId, userId);
    const { config } = await getEffectiveAiConfig(actualProjectId);
    if (!config.deduplication) return [];

    const openDefects = await prisma.defect.findMany({
      where: {
        deleted_at: null,
        local_status: { notIn: ['RESOLVED', 'CLOSED', 'WONT_FIX'] },
        run_result: {
          run: {
            project_id: actualProjectId,
            deleted_at: null,
          },
        },
      },
      orderBy: { raised_at: 'desc' },
      take: 50,
      include: {
        run_result: {
          select: {
            test_case: {
              select: { id: true, display_id: true },
            },
          },
        },
      },
    });

    const queryText = [data.title, data.failedStepAction, data.failureNotes]
      .filter(Boolean)
      .join(' ');

    const candidates: DuplicateDefectCandidate[] = [];
    for (const d of openDefects) {
      const sameCase = Boolean(data.testCaseId && d.test_case_id === data.testCaseId);
      const titleSim = computeTokenOverlap(data.title || queryText, d.title);
      const bodySim = computeTokenOverlap(queryText, `${d.title} ${d.description || ''}`);
      const score = Math.max(titleSim, bodySim, sameCase ? 0.65 : 0);

      if (sameCase || score >= 0.35) {
        candidates.push({
          id: d.id,
          title: d.title,
          severity: d.severity,
          externalTicketId: d.external_ticket_id,
          ticketUrl: d.ticket_url,
          ticketStatus: d.ticket_status,
          testCaseDisplayId: d.run_result?.test_case?.display_id,
          sameCase,
          similarityScore: Math.round(score * 100),
        });
      }
    }

    return candidates
      .sort((a, b) => {
        if (a.sameCase !== b.sameCase) return a.sameCase ? -1 : 1;
        return b.similarityScore - a.similarityScore;
      })
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function generateDatasetRowsAction(data: {
  projectId: string;
  input: GenerateDatasetRowsInput;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);
  enforceAiRateLimit(userId, 'dataset-rows');

  const { aiEnabled, config } = await getEffectiveAiConfig(actualProjectId);
  if (!aiEnabled || !config.datasetGeneration) {
    throw new Error('AI dataset generation is disabled for this project');
  }

  const startTime = Date.now();
  const inputChars = JSON.stringify(data.input).length;

  try {
    const generated = await generateDatasetRows(data.input);

    await logAiCall({
      project_id: actualProjectId,
      user_id: userId,
      feature: 'generate_dataset_rows',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.0',
      input_chars: inputChars,
      output_chars: JSON.stringify(generated).length,
      duration_ms: Date.now() - startTime,
      status: 'success',
    });

    return generated;
  } catch (error: any) {
    await logAiCall({
      project_id: actualProjectId,
      user_id: userId,
      feature: 'generate_dataset_rows',
      provider: 'google',
      model: 'gemini-2.5-flash',
      prompt_version: '1.0',
      input_chars: inputChars,
      output_chars: 0,
      duration_ms: Date.now() - startTime,
      status: 'error',
      error_message: error.message,
    });
    logger.error('AI dataset row generation failed', {
      module: 'AI',
      action: 'generateDatasetRowsAction',
      projectId: actualProjectId,
      userId,
      durationMs: Date.now() - startTime,
      errorCode: ErrorCodes.AI_SERVICE,
      error,
    });
    throw new Error(`Failed to generate dataset rows: ${error.message}`);
  }
}

export async function getProjectAiConfigAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = Number((session.user as { id?: number }).id);
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);
  return getEffectiveAiConfig(actualProjectId);
}

export async function updateProjectAiConfigAction(
  projectIdOrSlug: string,
  partial: Partial<ProjectAiConfig>
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = Number((session.user as { id?: number }).id);
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const current = await getEffectiveAiConfig(actualProjectId);
  const merged: ProjectAiConfig = {
    ...current.config,
    ...partial,
  };

  await prisma.integration.upsert({
    where: {
      project_id_provider: {
        project_id: actualProjectId,
        provider: 'ai_config',
      },
    },
    create: {
      project_id: actualProjectId,
      provider: 'ai_config',
      config: merged as any,
      enabled: true,
    },
    update: {
      config: merged as any,
      last_synced_at: new Date(),
    },
  });

  revalidatePath('/p');
  return merged;
}

export async function updateProjectAiEnabledAction(projectIdOrSlug: string, enabled: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = Number((session.user as { id?: number }).id);
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const updated = await prisma.project.update({
    where: { id: actualProjectId },
    data: { ai_enabled: enabled },
  });

  revalidatePath('/p');
  return updated;
}

export async function getProjectAiUsageAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = Number((session.user as { id?: number }).id);
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const count = await prisma.aiCall.count({
    where: {
      project_id: actualProjectId,
      created_at: { gte: startOfMonth },
    },
  });

  const monthlyLimit = Number(process.env.AI_MONTHLY_QUOTA) || 500;
  return { used: count, limit: monthlyLimit };
}

