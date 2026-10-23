'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { resolveProjectId, requireProjectMember, requireProjectMemberByCaseId } from '@/lib/permissions';
import { uploadToS3 } from '@/lib/s3/presigned-url';
import { logger } from '@/lib/logger';

async function getUserId(): Promise<number> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  return (session.user as any).id as number;
}

// ============================================
// ENVIRONMENTS
// ============================================

export async function getEnvironmentsAction(projectIdOrSlug: string) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);
  return prisma.environment.findMany({
    where: {
      project_id: actualProjectId,
    },
    orderBy: [
      { is_default: 'desc' },
      { name: 'asc' },
    ],
    include: {
      _count: { select: { variable_values: true } },
    },
  });
}

export async function createEnvironmentAction(data: {
  projectId: string;
  name: string;
  description?: string;
  baseUrl?: string;
  color?: string;
  isDefault?: boolean;
}) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  if (data.isDefault) {
    await prisma.environment.updateMany({
      where: { project_id: actualProjectId },
      data: { is_default: false },
    });
  }

  const env = await prisma.environment.create({
    data: {
      project_id: actualProjectId,
      name: data.name.toUpperCase().trim(),
      description: data.description?.trim() || null,
      base_url: data.baseUrl?.trim() || null,
      color: data.color || 'blue',
      is_default: data.isDefault ?? false,
      created_by: userId,
    },
  });
  logger.info('Environment created', {
    module: 'Variables',
    action: 'createEnvironmentAction',
    environmentId: env.id,
    projectId: actualProjectId,
    userId,
  });
  revalidatePath('/p');
  return env;
}

export async function updateEnvironmentAction(
  id: string,
  data: {
    name?: string;
    description?: string;
    baseUrl?: string;
    color?: string;
    isDefault?: boolean;
  }
) {
  const userId = await getUserId();
  const existing = await prisma.environment.findUnique({ where: { id } });
  if (!existing) throw new Error('Environment not found');
  await requireProjectMember(existing.project_id, userId);

  if (data.isDefault) {
    await prisma.environment.updateMany({
      where: { project_id: existing.project_id },
      data: { is_default: false },
    });
  }

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name.toUpperCase().trim();
  if (data.description !== undefined) updateData.description = data.description.trim() || null;
  if (data.baseUrl !== undefined) updateData.base_url = data.baseUrl.trim() || null;
  if (data.color !== undefined) updateData.color = data.color;
  if (data.isDefault !== undefined) updateData.is_default = data.isDefault;

  const updated = await prisma.environment.update({
    where: { id },
    data: updateData,
  });
  revalidatePath('/p');
  return updated;
}

export async function deleteEnvironmentAction(id: string) {
  const userId = await getUserId();
  const existing = await prisma.environment.findUnique({ where: { id } });
  if (!existing) throw new Error('Environment not found');
  await requireProjectMember(existing.project_id, userId);

  await prisma.environment.delete({ where: { id } });
  revalidatePath('/p');
  return true;
}

// ============================================
// VARIABLES
// ============================================

export async function getVariablesAction(
  projectIdOrSlug: string,
  filters?: { testCaseId?: string; scope?: 'GLOBAL' | 'LOCAL' }
) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);
  const where: any = {
    project_id: actualProjectId,
    NOT: { key: { startsWith: 'postman:' } },
  };
  if (filters?.testCaseId) where.test_case_id = filters.testCaseId;
  if (filters?.scope) where.scope = filters.scope;
  return prisma.variable.findMany({
    where,
    orderBy: { key: 'asc' },
    include: { values: { include: { environment: true } } },
  });
}

export async function getTestCaseLocalVariablesAction(testCaseId: string) {
  const userId = await getUserId();
  await requireProjectMemberByCaseId(testCaseId, userId);
  return prisma.variable.findMany({
    where: { test_case_id: testCaseId, scope: 'LOCAL' },
    orderBy: { key: 'asc' },
    include: { values: { include: { environment: true } } },
  });
}

export async function getGlobalVariablesAction(projectIdOrSlug: string) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const [variables, steps, testCases] = await Promise.all([
    prisma.variable.findMany({
      where: {
        project_id: actualProjectId,
        scope: 'GLOBAL',
        NOT: { key: { startsWith: 'postman:' } },
      },
      orderBy: { key: 'asc' },
      include: { values: { include: { environment: true } } },
    }),
    prisma.testCaseStep.findMany({
      where: { test_case: { project_id: actualProjectId, deleted_at: null } },
      select: { step: true, data: true, expected_result: true, test_case_id: true },
    }),
    prisma.testCase.findMany({
      where: { project_id: actualProjectId, deleted_at: null },
      select: { id: true, pre_conditions: true, post_conditions: true, description: true },
    }),
  ]);

  return variables.map((v) => {
    const matchingCases = new Set<string>();
    const varPattern1 = `{{${v.key}}}`;
    const varPattern2 = `{${v.key}}`;

    for (const s of steps) {
      if (
        (s.step && (s.step.includes(varPattern1) || s.step.includes(varPattern2))) ||
        (s.data && (s.data.includes(varPattern1) || s.data.includes(varPattern2))) ||
        (s.expected_result && (s.expected_result.includes(varPattern1) || s.expected_result.includes(varPattern2)))
      ) {
        matchingCases.add(s.test_case_id);
      }
    }

    for (const tc of testCases) {
      if (
        (tc.pre_conditions && (tc.pre_conditions.includes(varPattern1) || tc.pre_conditions.includes(varPattern2))) ||
        (tc.post_conditions && (tc.post_conditions.includes(varPattern1) || tc.post_conditions.includes(varPattern2))) ||
        (tc.description && (tc.description.includes(varPattern1) || tc.description.includes(varPattern2)))
      ) {
        matchingCases.add(tc.id);
      }
    }

    return {
      ...v,
      usage_count: matchingCases.size,
    };
  });
}

export async function getVariableUsageAction(projectId: string, variableKey: string) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(projectId, userId);
  const cleanVarKey = variableKey.replace(/^postman:/i, '');

  const [steps, testCases] = await Promise.all([
    prisma.testCaseStep.findMany({
      where: { test_case: { project_id: actualProjectId, deleted_at: null } },
      include: {
        test_case: {
          select: { id: true, display_id: true, title: true, status: true }
        }
      },
      orderBy: { order: 'asc' },
    }),
    prisma.testCase.findMany({
      where: { project_id: actualProjectId, deleted_at: null },
      select: {
        id: true,
        display_id: true,
        title: true,
        status: true,
        pre_conditions: true,
        post_conditions: true,
        description: true,
        custom_fields: true,
      },
    }),
  ]);

  const results: Array<{
    id: string;
    display_id: string;
    title: string;
    status: string;
    step_order?: number;
    step_text: string;
    field: string;
  }> = [];

  const seen = new Set<string>();
  const varPattern1 = `{{${cleanVarKey}}}`;
  const varPattern2 = `{${cleanVarKey}}`;

  for (const s of steps) {
    const hasInStep = s.step && (s.step.includes(varPattern1) || s.step.includes(varPattern2));
    const hasInData = s.data && (s.data.includes(varPattern1) || s.data.includes(varPattern2));
    const hasInExp = s.expected_result && (s.expected_result.includes(varPattern1) || s.expected_result.includes(varPattern2));

    if (hasInStep || hasInData || hasInExp) {
      const key = `${s.test_case_id}-${s.order}`;
      if (!seen.has(key)) {
        seen.add(key);
        seen.add(`case:${s.test_case_id}`);
        results.push({
          id: s.test_case.id,
          display_id: s.test_case.display_id,
          title: s.test_case.title,
          status: s.test_case.status,
          step_order: s.order,
          step_text: hasInData ? `DATA: ${s.data}` : (hasInExp ? `Expected: ${s.expected_result}` : s.step),
          field: hasInData ? 'Data' : (hasInExp ? 'Expected Result' : 'Step Action'),
        });
      }
    }
  }

  for (const tc of testCases) {
    const hasInPre = tc.pre_conditions && (tc.pre_conditions.includes(varPattern1) || tc.pre_conditions.includes(varPattern2));
    const hasInPost = tc.post_conditions && (tc.post_conditions.includes(varPattern1) || tc.post_conditions.includes(varPattern2));

    if (hasInPre || hasInPost) {
      const key = `${tc.id}-conditions`;
      if (!seen.has(key)) {
        seen.add(key);
        seen.add(`case:${tc.id}`);
        results.push({
          id: tc.id,
          display_id: tc.display_id,
          title: tc.title,
          status: tc.status,
          step_text: hasInPre ? `Pre-conditions: ${tc.pre_conditions}` : `Post-conditions: ${tc.post_conditions}`,
          field: hasInPre ? 'Pre-conditions' : 'Post-conditions',
        });
      }
    }

    const pmMeta = (tc.custom_fields as any)?._postman;
    if (pmMeta && !seen.has(`case:${tc.id}`)) {
      const inRequired =
        Array.isArray(pmMeta.requiredVariables) &&
        pmMeta.requiredVariables.some(
          (rk: string) => String(rk).toLowerCase() === cleanVarKey.toLowerCase()
        );
      const inCurl =
        typeof pmMeta.curlCommand === 'string' && pmMeta.curlCommand.includes(varPattern1);
      const inSpec =
        pmMeta.requestSpec && JSON.stringify(pmMeta.requestSpec).includes(varPattern1);

      if (inRequired || inCurl || inSpec) {
        seen.add(`case:${tc.id}`);
        results.push({
          id: tc.id,
          display_id: tc.display_id,
          title: tc.title,
          status: tc.status,
          step_text: `Postman API Request (${pmMeta.folderOrRequestFilter || pmMeta.collectionName || 'Linked'})`,
          field: 'Postman Request',
        });
      }
    }
  }

  return results;
}

export async function uploadVariableAttachmentAction(data: {
  projectId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  fileBase64: string;
}) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  if (data.fileSize > 10 * 1024 * 1024) {
    throw new Error('File size exceeds 10MB limit');
  }

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { id: true, workspace_id: true },
  });
  if (!project) throw new Error('Project not found');

  const sanitizedFilename = data.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
  const key = `attachments/${project.workspace_id}/${project.id}/variable/${Date.now()}-${sanitizedFilename}`;
  const buffer = Buffer.from(data.fileBase64, 'base64');
  const mimeType = data.mimeType || 'application/octet-stream';

  await uploadToS3(key, buffer, mimeType);

  const attachment = await prisma.attachment.create({
    data: {
      workspace_id: project.workspace_id,
      project_id: project.id,
      entity_type: 'variable',
      entity_id: project.id,
      filename: sanitizedFilename,
      original_filename: data.filename,
      mime_type: mimeType,
      size_bytes: data.fileSize,
      storage_type: 'S3',
      storage_key: key,
      uploaded_by: userId,
      status: 'ACTIVE',
    },
  });

  return {
    attachmentId: attachment.id,
    filename: sanitizedFilename,
    valueToken: `attachment://${attachment.id}/${sanitizedFilename}`,
  };
}

export async function createVariableAction(data: {
  projectId: string;
  testCaseId?: string;
  key: string;
  scope: 'GLOBAL' | 'LOCAL';
  defaultValue?: string;
  description?: string;
  isSecret?: boolean;
}) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(data.projectId, userId);
  const cleanKey = data.key.toUpperCase().replace(/[^A-Z0-9_]/g, '');

  if (data.scope === 'GLOBAL') {
    const existing = await prisma.variable.findFirst({
      where: {
        project_id: actualProjectId,
        scope: 'GLOBAL',
        key: cleanKey,
      },
    });
    if (existing) {
      throw new Error(`Global variable with key "${cleanKey}" already exists.`);
    }
  }

  const variable = await prisma.variable.create({
    data: {
      project_id: actualProjectId,
      test_case_id: data.testCaseId || null,
      key: cleanKey,
      scope: data.scope,
      default_value: data.defaultValue ?? null,
      description: data.description ?? null,
      is_secret: data.isSecret ?? false,
      created_by: userId,
    },
  });
  revalidatePath('/p');
  return variable;
}

export async function updateVariableAction(
  id: string,
  data: { key?: string; defaultValue?: string; description?: string; isSecret?: boolean }
) {
  const userId = await getUserId();
  const existing = await prisma.variable.findUnique({ where: { id } });
  if (!existing) throw new Error('Variable not found');
  await requireProjectMember(existing.project_id, userId);

  const isPostmanVar = existing.key.startsWith('postman:');
  const updateData: any = {};
  if (data.key !== undefined) {
    if (isPostmanVar) {
      const cleanPmKey = data.key.replace(/^postman:/i, '').trim().replace(/[^a-zA-Z0-9_.-]/g, '');
      updateData.key = `postman:${cleanPmKey}`;
    } else {
      updateData.key = data.key.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    }
  }
  if (data.defaultValue !== undefined) updateData.default_value = data.defaultValue;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.isSecret !== undefined) updateData.is_secret = data.isSecret;

  const updated = await prisma.variable.update({ where: { id }, data: updateData });
  revalidatePath('/p');
  return {
    ...updated,
    key: updated.key.replace(/^postman:/, ''),
  };
}

// ============================================
// POSTMAN / API VARIABLES (Separate Namespace)
// ============================================

export async function getPostmanVariablesAction(projectIdOrSlug: string) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const [variables, steps, testCases] = await Promise.all([
    prisma.variable.findMany({
      where: {
        project_id: actualProjectId,
        scope: 'GLOBAL',
        key: { startsWith: 'postman:' },
      },
      orderBy: { key: 'asc' },
      include: { values: { include: { environment: true } } },
    }),
    prisma.testCaseStep.findMany({
      where: { test_case: { project_id: actualProjectId, deleted_at: null } },
      select: { step: true, data: true, expected_result: true, test_case_id: true },
    }),
    prisma.testCase.findMany({
      where: { project_id: actualProjectId, deleted_at: null },
      select: {
        id: true,
        pre_conditions: true,
        post_conditions: true,
        description: true,
        custom_fields: true,
      },
    }),
  ]);

  return variables.map((v) => {
    const displayKey = v.key.replace(/^postman:/, '');
    const matchingCases = new Set<string>();
    const varPattern1 = `{{${displayKey}}}`;
    const varPattern2 = `{${displayKey}}`;

    for (const s of steps) {
      if (
        (s.step && (s.step.includes(varPattern1) || s.step.includes(varPattern2))) ||
        (s.data && (s.data.includes(varPattern1) || s.data.includes(varPattern2))) ||
        (s.expected_result && (s.expected_result.includes(varPattern1) || s.expected_result.includes(varPattern2)))
      ) {
        matchingCases.add(s.test_case_id);
      }
    }

    for (const tc of testCases) {
      const pmMeta = (tc.custom_fields as any)?._postman;
      if (
        Array.isArray(pmMeta?.requiredVariables) &&
        pmMeta.requiredVariables.some(
          (rk: string) => String(rk).toLowerCase() === displayKey.toLowerCase()
        )
      ) {
        matchingCases.add(tc.id);
      } else if (
        typeof pmMeta?.curlCommand === 'string' &&
        pmMeta.curlCommand.includes(varPattern1)
      ) {
        matchingCases.add(tc.id);
      }
    }

    return {
      ...v,
      key: displayKey,
      rawKey: v.key,
      usage_count: matchingCases.size,
    };
  });
}

export async function createPostmanVariableAction(data: {
  projectId: string;
  key: string;
  defaultValue?: string;
  description?: string;
  isSecret?: boolean;
}) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(data.projectId, userId);
  const cleanKey = data.key.replace(/^postman:/i, '').trim().replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!cleanKey) throw new Error('Variable key is required.');
  const storageKey = `postman:${cleanKey}`;

  const existing = await prisma.variable.findFirst({
    where: {
      project_id: actualProjectId,
      scope: 'GLOBAL',
      key: { equals: storageKey, mode: 'insensitive' },
    },
  });
  if (existing) {
    throw new Error(`Postman variable "${cleanKey}" already exists.`);
  }

  const variable = await prisma.variable.create({
    data: {
      project_id: actualProjectId,
      test_case_id: null,
      key: storageKey,
      scope: 'GLOBAL',
      default_value: data.defaultValue ?? null,
      description: data.description ?? 'Postman API variable',
      is_secret: data.isSecret ?? false,
      created_by: userId,
    },
  });
  revalidatePath('/p');
  return {
    ...variable,
    key: cleanKey,
  };
}

export async function registerPostmanVariablesAction(data: {
  projectId: string;
  keys: string[];
  collectionName?: string;
}) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const uniqueKeys = Array.from(
    new Set(
      (data.keys || [])
        .map((k) => k.replace(/^postman:/i, '').trim().replace(/[^a-zA-Z0-9_.-]/g, ''))
        .filter((k) => k && !k.startsWith('$'))
    )
  );
  if (uniqueKeys.length === 0) return [];

  const existing = await prisma.variable.findMany({
    where: {
      project_id: actualProjectId,
      scope: 'GLOBAL',
      key: { startsWith: 'postman:' },
    },
    select: { key: true },
  });
  const existingSet = new Set(
    existing.map((e) => e.key.replace(/^postman:/, '').toLowerCase())
  );

  const toCreate = uniqueKeys.filter((k) => !existingSet.has(k.toLowerCase()));
  for (const k of toCreate) {
    await prisma.variable
      .create({
        data: {
          project_id: actualProjectId,
          test_case_id: null,
          key: `postman:${k}`,
          scope: 'GLOBAL',
          default_value: null,
          description: data.collectionName
            ? `Imported from Postman collection "${data.collectionName}"`
            : 'Imported from Postman request',
          is_secret: /token|secret|password|apikey|api_key|auth/i.test(k),
          created_by: userId,
        },
      })
      .catch(() => {});
  }

  if (toCreate.length > 0) {
    revalidatePath('/p');
  }
  return toCreate;
}

export async function savePostmanEnvironmentVariablesAction(data: {
  projectId: string;
  environmentName: string;
  values: Record<string, string>;
}) {
  const userId = await getUserId();
  const actualProjectId = await requireProjectMember(data.projectId, userId);
  const envName = (data.environmentName || 'UAT').trim().toUpperCase();

  let env = await prisma.environment.findFirst({
    where: {
      project_id: actualProjectId,
      name: { equals: envName, mode: 'insensitive' },
    },
  });
  if (!env) {
    env = await prisma.environment.create({
      data: {
        project_id: actualProjectId,
        name: envName,
        color: 'blue',
        is_default: false,
        created_by: userId,
      },
    });
  }

  for (const [rawKey, rawVal] of Object.entries(data.values || {})) {
    const cleanKey = rawKey.replace(/^postman:/i, '').trim().replace(/[^a-zA-Z0-9_.-]/g, '');
    const val = String(rawVal ?? '').trim();
    if (!cleanKey || !val) continue;

    const storageKey = `postman:${cleanKey}`;
    let variable = await prisma.variable.findFirst({
      where: {
        project_id: actualProjectId,
        scope: 'GLOBAL',
        key: { equals: storageKey, mode: 'insensitive' },
      },
    });
    if (!variable) {
      variable = await prisma.variable.create({
        data: {
          project_id: actualProjectId,
          test_case_id: null,
          key: storageKey,
          scope: 'GLOBAL',
          default_value: null,
          description: 'Postman API variable',
          is_secret: /token|secret|password|apikey|api_key|auth/i.test(cleanKey),
          created_by: userId,
        },
      });
    }

    await prisma.variableValue.upsert({
      where: {
        variable_id_environment_id: {
          variable_id: variable.id,
          environment_id: env.id,
        },
      },
      create: {
        variable_id: variable.id,
        environment_id: env.id,
        value: val,
        created_by: userId,
      },
      update: { value: val },
    });
  }

  revalidatePath('/p');
  return { environmentId: env.id, environmentName: env.name };
}

export async function deleteVariableAction(id: string) {
  const userId = await getUserId();
  const existing = await prisma.variable.findUnique({ where: { id } });
  if (!existing) throw new Error('Variable not found');
  await requireProjectMember(existing.project_id, userId);

  await prisma.variable.delete({ where: { id } });
  revalidatePath('/p');
  return true;
}

// ============================================
// VARIABLE VALUES
// ============================================

export async function setVariableValueAction(data: {
  variableId: string;
  environmentId: string;
  value: string;
}) {
  const userId = await getUserId();
  const existing = await prisma.variable.findUnique({ where: { id: data.variableId } });
  if (!existing) throw new Error('Variable not found');
  await requireProjectMember(existing.project_id, userId);

  const val = await prisma.variableValue.upsert({
    where: {
      variable_id_environment_id: {
        variable_id: data.variableId,
        environment_id: data.environmentId,
      },
    },
    create: {
      variable_id: data.variableId,
      environment_id: data.environmentId,
      value: data.value,
      created_by: userId,
    },
    update: { value: data.value },
  });
  revalidatePath('/p');
  return val;
}

export async function getVariableValuesForEnvironmentAction(environmentId: string) {
  const userId = await getUserId();
  const env = await prisma.environment.findUnique({ where: { id: environmentId } });
  if (!env) throw new Error('Environment not found');
  await requireProjectMember(env.project_id, userId);

  return prisma.variableValue.findMany({
    where: { environment_id: environmentId },
    include: { variable: true },
  });
}