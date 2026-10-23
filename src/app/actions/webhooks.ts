'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import {
  requireProjectMember,
  requireProjectAdmin,
  requireWorkspaceAdmin,
  resolveWorkspaceId,
} from '@/lib/permissions';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import { deliverWebhookWithRetry, WebhookAttempt } from '@/lib/webhook';
import { safeFetch } from '@/lib/network/ssrf-guard';
import { encrypt, decrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';

export interface WebhookDto {
  id: string;
  workspaceId?: string | null;
  projectId?: string | null;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  failureCount: number;
  lastDeliveryAt?: string | null;
  createdAt: string;
}

export async function getWebhooksAction(
  scopeId: string,
  scope: 'workspace' | 'project' = 'workspace'
): Promise<WebhookDto[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  let whereClause: any = {};

  if (scope === 'workspace') {
    const wsId = await resolveWorkspaceId(scopeId);
    const wm = await prisma.workspaceMember.findFirst({
      where: { workspace_id: wsId, user_id: userId },
    });
    if (!wm) {
      const pm = await prisma.projectMember.findFirst({
        where: { user_id: userId, project: { workspace_id: wsId } },
      });
      if (!pm) throw new Error('Forbidden');
    }
    whereClause = { workspace_id: wsId };
  } else {
    const projId = await requireProjectMember(scopeId, userId);
    whereClause = { project_id: projId };
  }

  const webhooks = await prisma.webhook.findMany({
    where: whereClause,
    orderBy: { created_at: 'desc' },
  });

  return webhooks.map((w) => ({
    id: w.id,
    workspaceId: w.workspace_id,
    projectId: w.project_id,
    url: w.url,
    secret: decrypt(w.secret),
    events: w.events,
    enabled: w.enabled,
    failureCount: w.failure_count,
    lastDeliveryAt: w.last_delivery_at?.toISOString() || null,
    createdAt: w.created_at.toISOString(),
  }));
}

export async function saveWebhookAction(data: {
  id?: string;
  scopeId: string;
  scope: 'workspace' | 'project';
  url: string;
  secret?: string;
  events: string[];
  enabled?: boolean;
}): Promise<WebhookDto> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  if (!data.url || !data.url.trim().startsWith('http')) {
    throw new Error('Valid destination URL (http:// or https://) is required');
  }

  let wsId: string | null = null;
  let projId: string | null = null;

  if (data.scope === 'workspace') {
    wsId = await requireWorkspaceAdmin(data.scopeId, userId);
  } else {
    projId = await requireProjectAdmin(data.scopeId, userId);
  }

  const rawSecret = data.secret && data.secret.trim()
    ? data.secret.trim()
    : `whsec_${crypto.randomBytes(16).toString('hex')}`;
  const encryptedSecret = encrypt(rawSecret);

  const events = data.events && data.events.length > 0
    ? data.events
    : ['run.completed', 'defect.created'];

  let webhook;

  if (data.id) {
    const existing = await prisma.webhook.findUnique({ where: { id: data.id } });
    if (!existing) throw new Error('Webhook not found');
    if (existing.project_id && existing.project_id !== projId) throw new Error('Forbidden');
    if (existing.workspace_id && existing.workspace_id !== wsId) throw new Error('Forbidden');

    webhook = await prisma.webhook.update({
      where: { id: data.id },
      data: {
        url: data.url.trim(),
        secret: encryptedSecret,
        events,
        enabled: data.enabled !== undefined ? data.enabled : true,
      },
    });
  } else {
    webhook = await prisma.webhook.create({
      data: {
        workspace_id: wsId,
        project_id: projId,
        url: data.url.trim(),
        secret: encryptedSecret,
        events,
        enabled: data.enabled !== undefined ? data.enabled : true,
      },
    });
  }

  // Record Activity Log
  const targetProjectId = projId || (await prisma.project.findFirst({
    where: { workspace_id: wsId || undefined },
    select: { id: true },
  }))?.id;

  if (targetProjectId) {
    await prisma.activityLog.create({
      data: {
        project_id: targetProjectId,
        actor_type: 'user',
        user_id: userId,
        entity_type: 'integration',
        entity_id: webhook.id,
        action: data.id ? `Updated outgoing webhook for ${data.url}` : `Configured outgoing webhook for ${data.url}`,
      },
    }).catch(() => null);
  }

  logger.info(data.id ? 'Webhook updated' : 'Webhook created', {
    module: 'Webhooks',
    action: 'saveWebhookAction',
    webhookId: webhook.id,
    scope: data.scope,
    workspaceId: wsId || undefined,
    projectId: projId || undefined,
    userId,
  });

  revalidatePath('/workspace');
  revalidatePath('/p');

  return {
    id: webhook.id,
    workspaceId: webhook.workspace_id,
    projectId: webhook.project_id,
    url: webhook.url,
    secret: rawSecret,
    events: webhook.events,
    enabled: webhook.enabled,
    failureCount: webhook.failure_count,
    lastDeliveryAt: webhook.last_delivery_at?.toISOString() || null,
    createdAt: webhook.created_at.toISOString(),
  };
}

export async function toggleWebhookEnabledAction(
  webhookId: string,
  enabled: boolean
): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook) throw new Error('Webhook not found');

  if (webhook.workspace_id) {
    await requireWorkspaceAdmin(webhook.workspace_id, userId);
  } else if (webhook.project_id) {
    await requireProjectAdmin(webhook.project_id, userId);
  } else {
    throw new Error('Forbidden');
  }

  await prisma.webhook.update({
    where: { id: webhookId },
    data: { enabled },
  });

  revalidatePath('/workspace');
  revalidatePath('/p');
  return true;
}

export async function deleteWebhookAction(webhookId: string): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook) throw new Error('Webhook not found');

  if (webhook.workspace_id) {
    await requireWorkspaceAdmin(webhook.workspace_id, userId);
  } else if (webhook.project_id) {
    await requireProjectAdmin(webhook.project_id, userId);
  } else {
    throw new Error('Forbidden');
  }

  await prisma.webhook.delete({
    where: { id: webhookId },
  });

  revalidatePath('/workspace');
  revalidatePath('/p');
  return true;
}

export async function testOutgoingWebhookAction(
  url: string,
  secret?: string
): Promise<{ success: boolean; message: string; latencyMs: number }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  if (!url || !url.trim().startsWith('http')) {
    throw new Error('Please enter a valid HTTP/HTTPS URL');
  }

  const startTime = Date.now();
  const testPayload = {
    event: 'ping',
    message: 'Test ping from InkaTest outgoing webhooks',
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await safeFetch(
      url.trim(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': secret?.trim() || '',
          'User-Agent': 'InkaTest-Webhook-Tester/1.0',
        },
        body: JSON.stringify(testPayload),
      },
      { maxRedirects: 2, maxSizeBytes: 64 * 1024, timeoutMs: 6000 }
    );

    const latencyMs = Date.now() - startTime;

    if (res.ok) {
      return {
        success: true,
        message: `HTTP ${res.status} OK (${latencyMs}ms) - Endpoint successfully responded`,
        latencyMs,
      };
    }

    const errText = await res.text().catch(() => '');
    return {
      success: false,
      message: `HTTP ${res.status} ${res.statusText} (${latencyMs}ms): ${errText.slice(0, 100) || 'Error response'}`,
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      message: err.message || `Connection failed after ${latencyMs}ms. Target server unreachable.`,
      latencyMs,
    };
  }
}

export async function manualRetryWebhookDeliveryAction(deliveryId: string): Promise<{
  success: boolean;
  statusCode: number;
  responseBody?: string;
  latencyMs: number;
  attempts: WebhookAttempt[];
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });

  if (!delivery || !delivery.webhook) {
    throw new Error('Webhook delivery record not found');
  }

  const userId = (session.user as any).id as number;
  if (delivery.webhook.workspace_id) {
    await requireWorkspaceAdmin(delivery.webhook.workspace_id, userId);
  } else if (delivery.webhook.project_id) {
    await requireProjectAdmin(delivery.webhook.project_id, userId);
  } else {
    throw new Error('Forbidden');
  }

  const payload = delivery.payload as any;
  const existingAttempts: WebhookAttempt[] = payload?._attempts || [];

  const bodyString = JSON.stringify({
    event: delivery.event_type,
    payload: {
      ...payload,
      _attempts: undefined,
    },
    sent_at: new Date().toISOString(),
  });

  const { lastStatus, lastBody, attempts: newAttempts } = await deliverWebhookWithRetry(
    delivery.webhook.url,
    delivery.webhook.secret,
    bodyString,
    1 // single manual replay
  );

  const updatedAttempts = [...existingAttempts, ...newAttempts];
  const statusCode = lastStatus || 500;
  const isSuccess = statusCode >= 200 && statusCode < 300;

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      response_status: statusCode,
      response_body: lastBody,
      retry_count: updatedAttempts.length - 1,
      delivered_at: isSuccess ? new Date() : delivery.delivered_at,
      payload: {
        ...payload,
        _attempts: updatedAttempts,
      },
    },
  });

  if (isSuccess) {
    await prisma.webhook.update({
      where: { id: delivery.webhook.id },
      data: { last_delivery_at: new Date(), failure_count: 0 },
    }).catch(() => null);
  }

  revalidatePath('/workspace');
  revalidatePath('/p');

  return {
    success: isSuccess,
    statusCode,
    responseBody: lastBody || undefined,
    latencyMs: newAttempts[0]?.durationMs || 0,
    attempts: updatedAttempts,
  };
}
