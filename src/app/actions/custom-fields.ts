'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { resolveProjectId, requireProjectAdmin, requireProjectViewer } from '@/lib/permissions';
import { CustomFieldType, CustomFieldEntityType } from '@prisma/client';
import {
  MAX_CUSTOM_FIELDS_PER_ENTITY,
  MAX_KEY_NAME_LENGTH,
  MAX_OPTION_LENGTH,
  MAX_OPTIONS_COUNT,
  sanitizeFieldKey,
} from '@/lib/custom-fields';
import { logger } from '@/lib/logger';

async function getUserId(): Promise<number> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  return Number((session.user as any).id);
}

export async function getCustomFieldDefinitionsAction(
  projectIdOrSlug: string,
  entityType: CustomFieldEntityType = CustomFieldEntityType.TEST_CASE
) {
  const userId = await getUserId();
  const projectId = await requireProjectViewer(projectIdOrSlug, userId);

  return prisma.customFieldDefinition.findMany({
    where: {
      project_id: projectId,
      entity_type: entityType,
    },
    orderBy: [
      { order: 'asc' },
      { created_at: 'asc' },
    ],
  });
}

export async function createCustomFieldDefinitionAction(data: {
  projectId: string;
  entityType?: CustomFieldEntityType;
  name: string;
  key?: string;
  type: CustomFieldType;
  description?: string;
  options?: string[];
  defaultVal?: any;
  required?: boolean;
}) {
  const userId = await getUserId();
  const projectId = await requireProjectAdmin(data.projectId, userId);

  const entityType = data.entityType || CustomFieldEntityType.TEST_CASE;

  // Check max limit
  const currentCount = await prisma.customFieldDefinition.count({
    where: { project_id: projectId, entity_type: entityType },
  });

  if (currentCount >= MAX_CUSTOM_FIELDS_PER_ENTITY) {
    throw new Error(`Maximum limit of ${MAX_CUSTOM_FIELDS_PER_ENTITY} custom properties reached for this project.`);
  }

  const name = data.name.trim();
  if (!name) {
    throw new Error('Property name is required.');
  }
  if (name.length > MAX_KEY_NAME_LENGTH) {
    throw new Error(`Property name cannot exceed ${MAX_KEY_NAME_LENGTH} characters.`);
  }

  const key = sanitizeFieldKey(data.key || name);
  if (!key) {
    throw new Error('Property key could not be generated. Please enter a valid name.');
  }

  // Check unique key in project & entityType
  const existing = await prisma.customFieldDefinition.findFirst({
    where: {
      project_id: projectId,
      entity_type: entityType,
      key,
    },
  });

  if (existing) {
    throw new Error(`A property with key "${key}" already exists in this project.`);
  }

  // Clean options if dropdown or multi_select
  let cleanOptions: string[] | null = null;
  if (data.type === CustomFieldType.DROPDOWN || data.type === CustomFieldType.MULTI_SELECT) {
    const rawOptions = Array.isArray(data.options) ? data.options : [];
    const seen = new Set<string>();
    const sanitized: string[] = [];

    for (const opt of rawOptions) {
      const trimmed = String(opt || '').trim();
      if (!trimmed) continue;
      if (trimmed.length > MAX_OPTION_LENGTH) {
        throw new Error(`Option "${trimmed}" exceeds limit of ${MAX_OPTION_LENGTH} characters.`);
      }
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        sanitized.push(trimmed);
      }
    }

    if (sanitized.length === 0) {
      throw new Error('Dropdown fields require at least one option.');
    }
    if (sanitized.length > MAX_OPTIONS_COUNT) {
      throw new Error(`Dropdown fields cannot have more than ${MAX_OPTIONS_COUNT} options.`);
    }
    cleanOptions = sanitized;
  }

  const highestOrder = await prisma.customFieldDefinition.findFirst({
    where: { project_id: projectId, entity_type: entityType },
    orderBy: { order: 'desc' },
    select: { order: true },
  });

  const nextOrder = (highestOrder?.order ?? -1) + 1;

  const definition = await prisma.customFieldDefinition.create({
    data: {
      project_id: projectId,
      entity_type: entityType,
      name,
      key,
      type: data.type,
      description: data.description ? data.description.trim().slice(0, 100) : null,
      options: cleanOptions ? (cleanOptions as any) : undefined,
      default_val: data.defaultVal !== undefined ? data.defaultVal : null,
      required: Boolean(data.required),
      order: nextOrder,
    },
  });

  logger.info('Custom field definition created', {
    module: 'CustomFields',
    action: 'createCustomFieldDefinitionAction',
    fieldId: definition.id,
    key: definition.key,
    projectId,
    userId,
  });

  revalidatePath(`/p`);
  return definition;
}

export async function updateCustomFieldDefinitionAction(
  id: string,
  data: {
    name?: string;
    description?: string;
    options?: string[];
    defaultVal?: any;
    required?: boolean;
  }
) {
  const userId = await getUserId();
  const existing = await prisma.customFieldDefinition.findUnique({
    where: { id },
  });
  if (!existing) throw new Error('Property definition not found');

  await requireProjectAdmin(existing.project_id, userId);

  const updateData: any = {};

  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) throw new Error('Property name cannot be empty');
    if (trimmed.length > MAX_KEY_NAME_LENGTH) {
      throw new Error(`Property name cannot exceed ${MAX_KEY_NAME_LENGTH} characters`);
    }
    updateData.name = trimmed;
  }

  if (data.description !== undefined) {
    updateData.description = data.description ? data.description.trim().slice(0, 100) : null;
  }

  if (data.required !== undefined) {
    updateData.required = Boolean(data.required);
  }

  if (data.defaultVal !== undefined) {
    updateData.default_val = data.defaultVal;
  }

  if (
    data.options !== undefined &&
    (existing.type === CustomFieldType.DROPDOWN || existing.type === CustomFieldType.MULTI_SELECT)
  ) {
    const rawOptions = Array.isArray(data.options) ? data.options : [];
    const seen = new Set<string>();
    const sanitized: string[] = [];

    for (const opt of rawOptions) {
      const trimmed = String(opt || '').trim();
      if (!trimmed) continue;
      if (trimmed.length > MAX_OPTION_LENGTH) {
        throw new Error(`Option "${trimmed}" exceeds limit of ${MAX_OPTION_LENGTH} characters.`);
      }
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        sanitized.push(trimmed);
      }
    }

    if (sanitized.length === 0) {
      throw new Error('Dropdown fields require at least one option.');
    }
    if (sanitized.length > MAX_OPTIONS_COUNT) {
      throw new Error(`Dropdown fields cannot have more than ${MAX_OPTIONS_COUNT} options.`);
    }
    updateData.options = sanitized;
  }

  const updated = await prisma.customFieldDefinition.update({
    where: { id },
    data: updateData,
  });

  revalidatePath(`/p`);
  return updated;
}

export async function deleteCustomFieldDefinitionAction(id: string) {
  const userId = await getUserId();
  const existing = await prisma.customFieldDefinition.findUnique({
    where: { id },
  });
  if (!existing) throw new Error('Property definition not found');

  await requireProjectAdmin(existing.project_id, userId);

  await prisma.customFieldDefinition.delete({
    where: { id },
  });

  revalidatePath(`/p`);
  return { success: true };
}

export async function reorderCustomFieldDefinitionsAction(
  projectIdOrSlug: string,
  orderedIds: string[],
  entityType: CustomFieldEntityType = CustomFieldEntityType.TEST_CASE
) {
  const userId = await getUserId();
  await requireProjectAdmin(projectIdOrSlug, userId);

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.customFieldDefinition.update({
        where: { id },
        data: { order: index },
      })
    )
  );

  revalidatePath(`/p`);
  return { success: true };
}
