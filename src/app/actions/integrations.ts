'use server';

import { fetchConfluencePageContent, fetchNotionPageContent } from '@/lib/integrations/tool-clients';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import {
  requireProjectMember,
  requireProjectMemberByRunId,
  requireProjectAdmin,
  requireWorkspaceAdmin,
  resolveProjectId,
  resolveWorkspaceId,
} from '@/lib/permissions';
import { revalidatePath } from 'next/cache';
import {
  CustomPmClient,
  PmIntegrationConfig,
  PmSpace,
  PmPriority,
  getEffectivePmIntegration,
} from '@/lib/integrations/pm-client';
import {
  type ToolProviderId,
  type ConfluenceIntegrationConfig,
  type NotionIntegrationConfig,
  type FigmaIntegrationConfig,
  type PostmanIntegrationConfig,
  type DatadogIntegrationConfig,
  testConfluenceConnection,
  testNotionConnection,
  testFigmaConnection,
  testPostmanConnection,
  testDatadogConnection,
  listPostmanCollectionRequests,
  executePostmanParameterizedRun,
  executeDatadogSyntheticsRun,
  triggerDatadogSyntheticsTests,
  detectDatadogVariables,
  type ExternalTestExecutionResult,
  buildJourneyCaseTitle,
  formatPostmanRequestAsStep,
  normalizeDatadogSite,
  type PostmanAttachmentFilePayload,
} from '@/lib/integrations/tool-clients';
import { buildDatadogPreConditions, buildDatadogSteps } from '@/lib/integrations/datadog-steps';
import { getExternalLinkKeys } from '@/lib/integrations/link-keys';
import { getCaseAutomationSource } from '@/lib/cases/automation-source';
import { createTestCaseAction } from '@/app/actions/cases';
import { encryptToolConfig, decryptToolConfig } from '@/lib/integrations/tool-config';
import { readSystemActor } from '@/lib/execution/system-actor';
import { startRunCases, stopRun, tickRun, executeRunCase } from '@/lib/execution/coordinator';
import {
  buildExternalResultFromExecutions,
  enqueueDatadogMonitor,
  type MonitorExecutionRecord,
} from '@/lib/integrations/execution-monitor';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, getBucketName } from '@/lib/s3/client';
import { generateDownloadUrl } from '@/lib/s3/presigned-url';
import { generateTestRunId, generateTestCaseDisplayId } from '@/lib/ids';
import { processStatusUpdate } from '@/lib/integrations/status-sync';
import { encrypt, decrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';

function maskSecret(val?: string | null, prefixLen = 8, suffixLen = 4): string {
  if (!val) return '';
  if (val.length <= prefixLen + suffixLen) return '••••••••';
  return `${val.slice(0, prefixLen)}••••••••${val.slice(-suffixLen)}`;
}

// =========================================================================
// WORKSPACE-LEVEL PM INTEGRATION ACTIONS
// =========================================================================

export async function getWorkspacePmIntegrationConfigAction(workspaceIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualWsId = await requireWorkspaceAdmin(workspaceIdOrSlug, userId);

  const integration = await prisma.integration.findFirst({
    where: {
      workspace_id: actualWsId,
      provider: 'custom_pm',
    },
  });

  const workspace = await prisma.workspace.findUnique({
    where: { id: actualWsId },
    select: { id: true, name: true, slug: true },
  });

  if (!integration) {
    return {
      id: null,
      enabled: false,
      workspace: workspace!,
      lastSyncedAt: null,
      config: {
        baseUrl: '',
        apiKey: '',
        webhookSecret: '',
        autoCreateDefect: true,
        statusMapping: {
          'In Progress': 'IN_PROGRESS',
          'Done': 'RESOLVED',
          'Resolved': 'RESOLVED',
          'Closed': 'CLOSED',
          'Released': 'RESOLVED',
          'Approved/Go-live': 'RESOLVED',
        },
      } as PmIntegrationConfig,
    };
  }

  const config = (integration.config as any) || {};

  return {
    id: integration.id,
    enabled: integration.enabled,
    workspace: workspace!,
    lastSyncedAt: integration.last_synced_at?.toISOString() || null,
    config: {
      baseUrl: config.baseUrl || '',
      apiKey: config.apiKey ? decrypt(config.apiKey) : '',
      webhookSecret: config.webhookSecret ? decrypt(config.webhookSecret) : '',
      autoCreateDefect: config.autoCreateDefect !== false,
      statusMapping: config.statusMapping || {
        'In Progress': 'IN_PROGRESS',
        'Done': 'RESOLVED',
        'Resolved': 'RESOLVED',
        'Closed': 'CLOSED',
        'Released': 'RESOLVED',
        'Approved/Go-live': 'RESOLVED',
      },
    } as PmIntegrationConfig,
  };
}

export async function saveWorkspacePmIntegrationConfigAction(
  workspaceIdOrSlug: string,
  data: {
    enabled: boolean;
    config: PmIntegrationConfig;
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualWsId = await requireWorkspaceAdmin(workspaceIdOrSlug, userId);

  // Clean base URL so it points strictly to API root (no trailing /tickets or /issues)
  let cleanBaseUrl = (data.config.baseUrl || '').trim().replace(/\/+$/, '');
  cleanBaseUrl = cleanBaseUrl.replace(/\/tickets\/?$/, '').replace(/\/issues\/?$/, '').replace(/\/spaces\/?$/, '');

  const cleanedConfig = {
    ...data.config,
    baseUrl: cleanBaseUrl,
    apiKey: data.config.apiKey ? encrypt(data.config.apiKey.trim()) : '',
    webhookSecret: data.config.webhookSecret ? encrypt(data.config.webhookSecret.trim()) : '',
  };

  const existing = await prisma.integration.findFirst({
    where: {
      workspace_id: actualWsId,
      provider: 'custom_pm',
    },
  });

  let saved;
  if (existing) {
    saved = await prisma.integration.update({
      where: { id: existing.id },
      data: {
        enabled: data.enabled,
        config: cleanedConfig as any,
      },
    });
  } else {
    saved = await prisma.integration.create({
      data: {
        workspace_id: actualWsId,
        project_id: null,
        provider: 'custom_pm',
        enabled: data.enabled,
        config: cleanedConfig as any,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      workspace_id: actualWsId,
      user_id: userId,
      action: data.enabled ? 'Enabled workspace PM tool integration' : 'Updated workspace PM tool integration settings',
      metadata: { provider: 'custom_pm', baseUrl: cleanBaseUrl },
    },
  }).catch(() => null);

  revalidatePath('/workspace');
  revalidatePath('/p');
  return { success: true, id: saved.id };
}

export async function testWorkspacePmConnectionAction(
  workspaceIdOrSlug: string,
  config: PmIntegrationConfig
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualWsId = await requireWorkspaceAdmin(workspaceIdOrSlug, userId);

  const client = new CustomPmClient(config);
  try {
    const res = await client.testConnection();
    const ws = await prisma.workspace.findUnique({
      where: { id: actualWsId },
      include: { projects: { select: { id: true }, take: 1 } },
    });
    const projId = ws?.projects[0]?.id;
    if (projId) {
      await prisma.activityLog.create({
        data: {
          project_id: projId,
          user_id: userId,
          actor_type: 'user',
          entity_type: 'integration_egress',
          entity_id: 'pm_connection_test',
          action: `Outbound PM Tool: Connection verified with InkaBoard [${res.latencyMs || 0}ms]`,
        },
      }).catch(() => null);
    }
    return res;
  } catch (err: any) {
    const ws = await prisma.workspace.findUnique({
      where: { id: actualWsId },
      include: { projects: { select: { id: true }, take: 1 } },
    });
    const projId = ws?.projects[0]?.id;
    if (projId) {
      await prisma.activityLog.create({
        data: {
          project_id: projId,
          user_id: userId,
          actor_type: 'user',
          entity_type: 'integration_egress',
          entity_id: 'pm_connection_error',
          action: `Outbound PM Tool Error: Connection test failed - ${err.message || 'Unreachable'} (HTTP 500)`,
        },
      }).catch(() => null);
    }
    throw err;
  }
}

// =========================================================================
// PROJECT-LEVEL CONNECTIONS & OVERRIDES ACTIONS
// =========================================================================

export async function getProjectConnectionsAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const effective = await getEffectivePmIntegration(actualProjectId);
  if (!effective) throw new Error('Project not found');

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: {
      id: true,
      name: true,
      slug: true,
      workspace_id: true,
      default_pm_space_id: true,
      default_pm_space_key: true,
      default_pm_space_name: true,
      api_secret: true,
    },
  });

  const [projectSlack, workspaceSlack] = await Promise.all([
    prisma.notificationSettings.findUnique({
      where: { project_id: actualProjectId },
      select: { slack_webhook_url: true },
    }),
    project?.workspace_id
      ? prisma.notificationSettings.findUnique({
          where: { workspace_id: project.workspace_id },
          select: { slack_webhook_url: true },
        })
      : null,
  ]);

  const hasSlackOverride = Boolean(projectSlack?.slack_webhook_url?.trim());
  const isSlackInherited = !hasSlackOverride && Boolean(workspaceSlack?.slack_webhook_url?.trim());
  const isSlackConnected = hasSlackOverride || isSlackInherited;

  return {
    projectId: actualProjectId,
    projectName: project?.name,
    projectSlug: project?.slug,
    pm: {
      enabled: effective.enabled,
      isInherited: effective.isInherited,
      hasOverride: effective.hasOverride,
      workspaceName: effective.workspaceName,
      workspaceSlug: effective.workspaceSlug,
      baseUrl: effective.config.baseUrl,
      maskedApiKey: maskSecret(effective.config.apiKey, 9, 4),
      maskedWebhookSecret: maskSecret(effective.config.webhookSecret, 6, 4),
      defaultSpace: {
        id: project?.default_pm_space_id || null,
        key: project?.default_pm_space_key || null,
        name: project?.default_pm_space_name || null,
      },
    },
    slack: {
      connected: isSlackConnected,
      hasOverride: hasSlackOverride,
      isInherited: isSlackInherited,
      webhookUrl: projectSlack?.slack_webhook_url || workspaceSlack?.slack_webhook_url || '',
      workspaceWebhookUrl: workspaceSlack?.slack_webhook_url || null,
      projectWebhookUrl: projectSlack?.slack_webhook_url || null,
    },
    cicd: {
      hasKey: Boolean(project?.api_secret),
      maskedKey: maskSecret(project?.api_secret, 9, 4),
    },
  };
}

export async function revertProjectSlackOverrideAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectAdmin(projectIdOrSlug, userId);

  await prisma.notificationSettings.upsert({
    where: { project_id: actualProjectId },
    create: {
      project_id: actualProjectId,
      slack_webhook_url: null,
    },
    update: {
      slack_webhook_url: null,
    },
  });

  revalidatePath('/p');
  return { success: true };
}

export async function getWorkspaceConnectionsAction(workspaceIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualWsId = await requireWorkspaceAdmin(workspaceIdOrSlug, userId);

  const [pmIntegration, slackSettings, webhookCount, lastDelivery] = await Promise.all([
    prisma.integration.findFirst({
      where: { workspace_id: actualWsId, provider: 'custom_pm' },
    }),
    prisma.notificationSettings.findUnique({ where: { workspace_id: actualWsId } }),
    prisma.webhook.count({ where: { workspace_id: actualWsId } }),
    prisma.webhookDelivery.findFirst({
      where: { webhook: { workspace_id: actualWsId } },
      orderBy: { created_at: 'desc' },
      select: { created_at: true, response_status: true },
    }),
  ]);

  return {
    pm: {
      connected: Boolean(pmIntegration?.enabled),
      lastSyncedAt: pmIntegration?.last_synced_at?.toISOString() || null,
    },
    slack: {
      connected: Boolean(slackSettings?.slack_webhook_url?.trim()),
      webhookUrl: slackSettings?.slack_webhook_url || null,
    },
    webhooks: {
      count: webhookCount,
      lastDeliveryAt: lastDelivery?.created_at?.toISOString() || null,
      lastStatus: lastDelivery?.response_status || null,
    },
  };
}

export async function updateProjectPmDefaultsAction(
  projectIdOrSlug: string,
  spaceData: {
    spaceId?: string | null;
    spaceKey?: string | null;
    spaceName?: string | null;
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectAdmin(projectIdOrSlug, userId);

  await prisma.project.update({
    where: { id: actualProjectId },
    data: {
      default_pm_space_id: spaceData.spaceId || null,
      default_pm_space_key: spaceData.spaceKey || null,
      default_pm_space_name: spaceData.spaceName || null,
    },
  });

  revalidatePath('/p');
  return { success: true };
}

export async function saveProjectPmOverrideAction(
  projectIdOrSlug: string,
  overrideData: {
    enabled: boolean;
    config: PmIntegrationConfig;
  } | null
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectAdmin(projectIdOrSlug, userId);

  if (!overrideData) {
    // Revert to workspace inheritance by removing project-level row
    await prisma.integration.deleteMany({
      where: {
        project_id: actualProjectId,
        provider: 'custom_pm',
      },
    });
    revalidatePath('/p');
    return { success: true, isInherited: true };
  }

  let cleanBaseUrl = (overrideData.config.baseUrl || '').trim().replace(/\/+$/, '');
  cleanBaseUrl = cleanBaseUrl.replace(/\/tickets\/?$/, '').replace(/\/issues\/?$/, '').replace(/\/spaces\/?$/, '');

  const cleanedConfig = {
    ...overrideData.config,
    baseUrl: cleanBaseUrl,
    apiKey: overrideData.config.apiKey ? encrypt(overrideData.config.apiKey.trim()) : '',
    webhookSecret: overrideData.config.webhookSecret ? encrypt(overrideData.config.webhookSecret.trim()) : '',
  };

  await prisma.integration.upsert({
    where: {
      project_id_provider: {
        project_id: actualProjectId,
        provider: 'custom_pm',
      },
    },
    create: {
      project_id: actualProjectId,
      workspace_id: null,
      provider: 'custom_pm',
      enabled: overrideData.enabled,
      config: cleanedConfig as any,
    },
    update: {
      enabled: overrideData.enabled,
      config: cleanedConfig as any,
    },
  });

  revalidatePath('/p');
  return { success: true, isInherited: false };
}

// =========================================================================
// TEST CONNECTION & WEBHOOK ACTIVITY LOGS ACTIONS
// =========================================================================

export async function testPmConnectionAction(
  projectIdOrSlug: string,
  config?: PmIntegrationConfig
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  let activeConfig = config;
  if (!activeConfig) {
    const effective = await getEffectivePmIntegration(actualProjectId);
    if (!effective || !effective.config.baseUrl || !effective.config.apiKey) {
      throw new Error('No PM tool configuration found for this project or its workspace.');
    }
    activeConfig = effective.config;
  }

  const client = new CustomPmClient(activeConfig);
  try {
    const res = await client.testConnection();
    await prisma.activityLog.create({
      data: {
        project_id: actualProjectId,
        user_id: userId,
        actor_type: 'user',
        entity_type: 'integration_egress',
        entity_id: 'pm_connection_test',
        action: `Outbound PM Tool: Connection verified with InkaBoard [${res.latencyMs || 0}ms]`,
      },
    }).catch(() => null);
    return res;
  } catch (err: any) {
    await prisma.activityLog.create({
      data: {
        project_id: actualProjectId,
        user_id: userId,
        actor_type: 'user',
        entity_type: 'integration_egress',
        entity_id: 'pm_connection_error',
        action: `Outbound PM Tool Error: Connection test failed - ${err.message || 'Unreachable'} (HTTP 500)`,
      },
    }).catch(() => null);
    throw err;
  }
}

export async function testCiCdKeyAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const startTime = Date.now();
  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { api_secret: true, key: true },
  });

  const latencyMs = Date.now() - startTime;

  if (!project?.api_secret) {
    return {
      success: false,
      message: 'No CI/CD API Key generated yet. Click "Generate Key" below.',
      latencyMs,
    };
  }

  return {
    success: true,
    message: `API Key active (${latencyMs}ms). Endpoint: PATCH /api/v1/runs/:runId/results`,
    latencyMs,
  };
}

export interface WebhookActivityLogItem {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  integration: string;
  eventType: string;
  sourceOrTarget: string;
  ticketKey?: string;
  summary?: string;
  statusCode: number;
  statusText: 'SUCCESS' | 'FAILED' | 'PENDING';
  durationMs?: number;
  payload?: any;
  responseBody?: string;
  timestamp: string;
  attempts?: Array<{
    attempt: number;
    statusCode: number;
    durationMs?: number;
    timestamp: string;
    responseBody?: string;
    error?: string;
  }>;
  deliveryId?: string;
  retryCount?: number;
  canRetry?: boolean;
}

export async function getWebhookActivityLogsAction(
  projectIdOrSlug: string,
  scope: 'project' | 'workspace' = 'project'
): Promise<WebhookActivityLogItem[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  let targetWorkspaceId: string;
  let targetProjectId: string | undefined;

  if (scope === 'workspace') {
    targetWorkspaceId = await resolveWorkspaceId(projectIdOrSlug);
    const wm = await prisma.workspaceMember.findFirst({
      where: { workspace_id: targetWorkspaceId, user_id: userId },
    });
    if (!wm) {
      const pm = await prisma.projectMember.findFirst({
        where: { user_id: userId, project: { workspace_id: targetWorkspaceId } },
      });
      if (!pm) throw new Error('Forbidden: not a member of this workspace');
    }
  } else {
    targetProjectId = await requireProjectMember(projectIdOrSlug, userId);
    const project = await prisma.project.findUnique({
      where: { id: targetProjectId },
      select: { workspace_id: true },
    });
    targetWorkspaceId = project?.workspace_id || '';
  }

  const whereActivity = scope === 'workspace'
    ? {
        project: { workspace_id: targetWorkspaceId },
        OR: [
          { entity_type: { in: ['webhook_ingress', 'integration_egress', 'webhook_egress', 'integration'] } },
          { actor_type: 'webhook' },
          { action: { startsWith: 'Inbound Webhook' } },
          { action: { startsWith: 'Outbound' } },
          { action: { contains: 'PM Tool' } },
          { action: { contains: 'External ticket' } },
        ],
      }
    : {
        project_id: targetProjectId,
        OR: [
          { entity_type: { in: ['webhook_ingress', 'integration_egress', 'webhook_egress', 'integration'] } },
          { actor_type: 'webhook' },
          { action: { startsWith: 'Inbound Webhook' } },
          { action: { startsWith: 'Outbound' } },
          { action: { contains: 'PM Tool' } },
          { action: { contains: 'External ticket' } },
        ],
      };

  const whereDelivery = scope === 'workspace'
    ? {
        OR: [
          { webhook: { workspace_id: targetWorkspaceId } },
          { webhook: { project: { workspace_id: targetWorkspaceId } } },
        ],
      }
    : {
        webhook: { project_id: targetProjectId },
      };

  const [rawActivityLogs, outboundDeliveries] = await Promise.all([
    prisma.activityLog.findMany({
      where: whereActivity,
      orderBy: { created_at: 'desc' },
      take: 100,
    }),
    prisma.webhookDelivery.findMany({
      where: whereDelivery,
      orderBy: { created_at: 'desc' },
      take: 100,
      include: { webhook: { select: { url: true } } },
    }),
  ]);

  // Deduplicate rapid consecutive duplicate logs (e.g. from retries within 2.5s)
  // and avoid redundant defect status update rows when a corresponding webhook_ingress entry exists
  const uniqueLogs: typeof rawActivityLogs = [];
  for (const log of rawActivityLogs) {
    const isDuplicate = uniqueLogs.some((existing) => {
      const sameTarget = existing.entity_id === log.entity_id;
      const timeDiff = Math.abs(new Date(existing.created_at).getTime() - new Date(log.created_at).getTime());
      if (sameTarget && timeDiff < 2500) {
        if (existing.entity_type === 'webhook_ingress' && log.entity_type === 'defect') {
          return true;
        }
        if (existing.action === log.action) {
          return true;
        }
      }
      return false;
    });
    if (!isDuplicate) {
      uniqueLogs.push(log);
    }
  }

  const items: WebhookActivityLogItem[] = [];

  for (const log of uniqueLogs) {
    const isOutbound =
      log.action.startsWith('Outbound') ||
      log.entity_type === 'integration_egress' ||
      log.entity_type === 'webhook_egress';

    if (isOutbound) {
      const isError =
        log.action.toLowerCase().includes('failed') ||
        log.action.toLowerCase().includes('error') ||
        log.action.includes('500') ||
        log.action.includes('401');

      let integration = 'InkaBoard';
      let eventType = 'integration.outbound';
      let sourceOrTarget = 'External Integration';
      let ticketKey: string | undefined = undefined;

      if (log.action.includes('Slack')) {
        integration = 'Slack';
        eventType = 'notification.slack';
        sourceOrTarget = 'Slack Webhook';
      } else if (log.action.includes('Jira')) {
        integration = 'Jira Cloud';
        eventType = 'ticket.sync';
        sourceOrTarget = 'Jira Cloud';
      } else if (log.action.includes('Linear')) {
        integration = 'Linear';
        eventType = 'ticket.sync';
        sourceOrTarget = 'Linear';
      } else if (log.action.includes('GitHub')) {
        integration = 'GitHub';
        eventType = 'repo.sync';
        sourceOrTarget = 'GitHub';
      } else if (log.action.includes('PM Tool') || log.action.includes('InkaBoard')) {
        integration = 'InkaBoard';
        eventType = log.action.includes('Created ticket')
          ? 'ticket.created'
          : log.action.includes('Connection verified') || log.action.includes('Connection test')
          ? 'connection.test'
          : 'ticket.status_sync';
        sourceOrTarget = 'InkaBoard (PM Tool)';
        const keyMatch = log.action.match(/#([A-Za-z0-9_-]+)/);
        if (keyMatch) ticketKey = keyMatch[1];
      }

      const durationMatch = log.action.match(/\[(\d+)ms\]/);
      const durationMs = durationMatch ? parseInt(durationMatch[1], 10) : undefined;
      const cleanSummary = log.action.replace(/^Outbound (PM Tool|Slack)( Error)?:?\s*/i, '');

      items.push({
        id: log.id,
        direction: 'OUTBOUND',
        integration,
        eventType,
        sourceOrTarget,
        ticketKey,
        summary: cleanSummary,
        statusCode: isError ? (log.action.includes('401') ? 401 : 500) : 200,
        statusText: isError ? 'FAILED' : 'SUCCESS',
        durationMs,
        timestamp: log.created_at.toISOString(),
        payload: { action: log.action, entityId: log.entity_id, actorType: log.actor_type },
      });
    } else {
      // INBOUND
      const isError =
        log.action.includes('401') ||
        log.action.toLowerCase().includes('failed') ||
        log.action.toLowerCase().includes('error');

      const ticketMatch = log.action.match(
        /Inbound Webhook:\s*([^\s]+)\s*->\s*([^(]+)\s*(?:\(([^)]+)\))?(?:\s*\[(\d+)ms\])?/
      );
      const ticketKey = ticketMatch
        ? ticketMatch[1]
        : log.entity_id !== 'auth_failed'
        ? log.entity_id
        : undefined;

      const summary = ticketMatch
        ? `${ticketMatch[1]} → ${ticketMatch[2].trim()}${ticketMatch[3] ? ` (${ticketMatch[3]})` : ''}`
        : log.action.replace(/^Inbound Webhook:?\s*/i, '');

      const durationMs = ticketMatch && ticketMatch[4] ? parseInt(ticketMatch[4], 10) : undefined;

      let integration = 'InkaBoard';
      if (log.action.includes('Slack')) integration = 'Slack';
      else if (log.action.includes('Jira')) integration = 'Jira Cloud';
      else if (log.action.includes('Linear')) integration = 'Linear';
      else if (log.action.includes('GitHub')) integration = 'GitHub';

      items.push({
        id: log.id,
        direction: 'INBOUND',
        integration,
        eventType: log.action.includes('->')
          ? 'ticket.status_sync'
          : log.action.includes('verification')
          ? 'webhook.verify'
          : log.entity_type === 'defect'
          ? 'defect.status_sync'
          : 'webhook.ingress',
        sourceOrTarget: ticketKey ? `Ticket ${ticketKey}` : 'InkaBoard Webhook',
        ticketKey,
        summary,
        statusCode: isError ? 401 : 200,
        statusText: isError ? 'FAILED' : 'SUCCESS',
        durationMs,
        timestamp: log.created_at.toISOString(),
        payload: { action: log.action, entityId: log.entity_id, actorType: log.actor_type },
      });
    }
  }

  for (const del of outboundDeliveries) {
    const isSuccess = del.response_status && del.response_status >= 200 && del.response_status < 300;
    const isError = del.response_status ? del.response_status >= 400 : false;
    const isSlack = del.webhook?.url?.includes('slack.com');
    const payload = del.payload as any;
    const attempts = payload?._attempts;

    items.push({
      id: del.id,
      direction: 'OUTBOUND',
      integration: isSlack ? 'Slack' : 'Webhooks',
      eventType: del.event_type,
      sourceOrTarget: del.webhook?.url || 'Outgoing Webhook',
      summary: del.event_type,
      statusCode: del.response_status || (isSuccess ? 200 : isError ? del.response_status || 500 : 200),
      statusText: isSuccess ? 'SUCCESS' : del.response_status ? 'FAILED' : 'PENDING',
      responseBody: del.response_body || undefined,
      payload: {
        ...payload,
        _attempts: undefined,
      },
      timestamp: del.created_at.toISOString(),
      attempts,
      deliveryId: del.id,
      retryCount: del.retry_count,
      canRetry: true,
    });
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return items;
}

export async function syncDefectStatusAction(defectId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;

  const defect = await prisma.defect.findUnique({
    where: { id: defectId },
    include: {
      run_result: {
        include: {
          run: {
            select: { project_id: true },
          },
        },
      },
    },
  });

  if (!defect) throw new Error('Defect not found');

  const projectId = defect.run_result.run.project_id;
  await requireProjectMember(projectId, userId);

  if (!defect.external_ticket_id) {
    throw new Error('This defect does not have an external ticket ID linked');
  }

  const effective = await getEffectivePmIntegration(projectId);
  if (!effective || !effective.enabled || !effective.config.baseUrl || !effective.config.apiKey) {
    throw new Error('PM tool integration is not configured or enabled for this project or its workspace');
  }

  const client = new CustomPmClient(effective.config);
  const result = await client.getTicketStatus(defect.external_ticket_id);

  if (result.status) {
    await processStatusUpdate({
      projectId,
      externalTicketId: defect.external_ticket_id,
      ticketStatus: result.status,
      statusMapping: effective.config.statusMapping,
      actorType: 'user',
      userId,
    });

    await prisma.activityLog.create({
      data: {
        project_id: projectId,
        user_id: userId,
        actor_type: 'user',
        entity_type: 'integration_egress',
        entity_id: defect.external_ticket_id,
        action: `Outbound PM Tool: Synced status for #${defect.external_ticket_id} -> "${result.status}"`,
      },
    }).catch(() => null);
  }

  revalidatePath('/p');

  return {
    success: true,
    status: result.status,
    title: result.title,
    url: result.url,
  };
}

export async function getPmSpacesAction(projectIdOrSlug: string): Promise<{ isPmConnected: boolean; spaces: PmSpace[] }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const effective = await getEffectivePmIntegration(actualProjectId);
  if (!effective || !effective.enabled || !effective.config.baseUrl || !effective.config.apiKey) {
    return { isPmConnected: false, spaces: [] };
  }

  // Pre-seed with project's saved default space (or workspace default space) so the UI always has options even if remote PM server is offline
  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: {
      default_pm_space_id: true,
      default_pm_space_key: true,
      default_pm_space_name: true,
      workspace_id: true,
    },
  });

  const savedSpaces: PmSpace[] = [];
  const defaultPriorities: PmPriority[] = [
    { id: 'urgent', name: 'Urgent', severity: 'CRITICAL', color: 'red' },
    { id: 'high', name: 'High', severity: 'HIGH', color: 'orange' },
    { id: 'medium', name: 'Medium', severity: 'MEDIUM', color: 'yellow' },
    { id: 'low', name: 'Low', severity: 'LOW', color: 'blue' },
  ];

  if (project?.default_pm_space_id || project?.default_pm_space_name || project?.default_pm_space_key) {
    savedSpaces.push({
      id: project.default_pm_space_id || project.default_pm_space_key || 'default',
      name: project.default_pm_space_name || project.default_pm_space_key || 'Default Space',
      key: project.default_pm_space_key || project.default_pm_space_name || 'DEFAULT',
      custom_priorities: defaultPriorities,
    });
  }

  // Also check if workspace config has space info
  const wsConfig = effective.config as any;
  if (wsConfig?.defaultSpaceId || wsConfig?.spaceId || wsConfig?.spaceName) {
    const wsSpaceId = wsConfig.defaultSpaceId || wsConfig.spaceId || 'ws-default';
    const wsSpaceName = wsConfig.spaceName || wsConfig.spaceKey || 'Workspace Default Space';
    const wsSpaceKey = wsConfig.spaceKey || wsConfig.spaceName || 'WS';
    if (!savedSpaces.some((s) => s.id === wsSpaceId || s.key === wsSpaceKey)) {
      savedSpaces.push({
        id: wsSpaceId,
        name: wsSpaceName,
        key: wsSpaceKey,
        custom_priorities: defaultPriorities,
      });
    }
  }

  try {
    const client = new CustomPmClient(effective.config);
    const fetchedSpaces = await client.getSpaces();
    const merged = [...fetchedSpaces];
    for (const saved of savedSpaces) {
      if (!merged.some((s) => s.id === saved.id || s.key === saved.key || s.name === saved.name)) {
        merged.unshift(saved);
      }
    }
    return { isPmConnected: true, spaces: merged.length > 0 ? merged : savedSpaces };
  } catch (err: any) {
    logger.warn('Failed to fetch spaces from PM tool, falling back to saved spaces', {
      module: 'Integrations',
      action: 'getPmSpaces',
      projectId: actualProjectId,
      reason: err?.message,
    });
    return { isPmConnected: true, spaces: savedSpaces };
  }
}

export async function getPmPrioritiesAction(
  projectIdOrSlug: string,
  spaceId?: string
): Promise<PmPriority[]> {
  const defaultPriorities: PmPriority[] = [
    { id: 'urgent', name: 'Urgent', severity: 'CRITICAL', color: 'red' },
    { id: 'high', name: 'High', severity: 'HIGH', color: 'orange' },
    { id: 'medium', name: 'Medium', severity: 'MEDIUM', color: 'yellow' },
    { id: 'low', name: 'Low', severity: 'LOW', color: 'blue' },
  ];

  const session = await getServerSession(authOptions);
  if (!session?.user) return defaultPriorities;

  const userId = (session.user as any).id as number;
  let actualProjectId: string;
  try {
    actualProjectId = await requireProjectMember(projectIdOrSlug, userId);
  } catch {
    return defaultPriorities;
  }

  const effective = await getEffectivePmIntegration(actualProjectId);
  if (!effective || !effective.enabled || !effective.config.baseUrl || !effective.config.apiKey) {
    return defaultPriorities;
  }

  try {
    const client = new CustomPmClient(effective.config);
    return await client.getPriorities(spaceId);
  } catch (err: any) {
    logger.warn('Failed to fetch priorities from PM tool, using defaults', {
      module: 'Integrations',
      action: 'getPmPriorities',
      projectId: actualProjectId,
      spaceId,
      reason: err?.message,
    });
    return defaultPriorities;
  }
}

export interface ProjectTicketOption {
  key: string;
  title: string;
  status: string;
  url?: string;
  source: 'inkaboard' | 'project';
}

export async function getProjectTicketsAction(
  projectIdOrSlug: string,
  query?: string
): Promise<{ isPmConnected: boolean; tickets: ProjectTicketOption[] }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { isPmConnected: false, tickets: [] };

  const userId = (session.user as any).id as number;
  let actualProjectId: string;
  try {
    actualProjectId = await requireProjectMember(projectIdOrSlug, userId);
  } catch {
    return { isPmConnected: false, tickets: [] };
  }

  const ticketMap = new Map<string, ProjectTicketOption>();
  const cleanQuery = (query || '').trim().toLowerCase();

  // 1. Fetch tickets from existing ReleaseTickets in this project
  try {
    const releaseTickets = await prisma.releaseTicket.findMany({
      where: {
        release: { project_id: actualProjectId },
      },
      select: {
        ticket_key: true,
        title: true,
        ticket_status: true,
        ticket_url: true,
      },
      orderBy: { updated_at: 'desc' },
      take: 50,
    });

    for (const rt of releaseTickets) {
      const k = rt.ticket_key.toUpperCase();
      ticketMap.set(k, {
        key: k,
        title: rt.title || `${k} User Story`,
        status: rt.ticket_status || 'In QA',
        url: rt.ticket_url || undefined,
        source: 'project',
      });
    }
  } catch (err: any) {
    logger.warn('Failed to fetch release tickets for project', {
      module: 'Integrations',
      action: 'getProjectTickets',
      projectId: actualProjectId,
      reason: err?.message,
    });
  }

  // 2. Fetch existing ticket keys from TestCase labels & tags
  try {
    const projectCases = await prisma.testCase.findMany({
      where: { project_id: actualProjectId, deleted_at: null },
      select: { labels: true, tags: true },
      take: 200,
    });

    for (const c of projectCases) {
      const allLabels = [...(c.labels || []), ...(c.tags || [])];
      for (const l of allLabels) {
        let clean = String(l || '').trim();
        if (clean.toLowerCase().startsWith('ticket:')) {
          clean = clean.slice(7).trim();
        }
        if (/^[A-Za-z0-9]+-[0-9]+$/i.test(clean)) {
          const k = clean.toUpperCase();
          if (!ticketMap.has(k)) {
            ticketMap.set(k, {
              key: k,
              title: `${k} User Story`,
              status: 'In QA',
              source: 'project',
            });
          }
        }
      }
    }
  } catch (err: any) {
    logger.warn('Failed to fetch test case ticket keys', {
      module: 'Integrations',
      action: 'getProjectTickets',
      projectId: actualProjectId,
      reason: err?.message,
    });
  }

  // 3. Fetch live tickets from PM tool (InkaBoard / Jira) if connected
  let isPmConnected = false;
  const effective = await getEffectivePmIntegration(actualProjectId).catch(() => null);
  if (effective?.enabled && effective.config.baseUrl && effective.config.apiKey) {
    isPmConnected = true;
    try {
      const client = new CustomPmClient(effective.config);
      const pmTickets = await client.getTickets(cleanQuery);
      for (const t of pmTickets) {
        const k = t.key.toUpperCase();
        ticketMap.set(k, {
          key: k,
          title: t.title,
          status: t.status,
          url: t.url,
          source: 'inkaboard',
        });
      }
    } catch (err: any) {
      logger.warn('Failed to fetch live tickets from PM tool', {
        module: 'Integrations',
        action: 'getProjectTickets',
        projectId: actualProjectId,
        reason: err?.message,
      });
    }
  }

  // Filter by query if supplied
  let allTickets = Array.from(ticketMap.values());
  if (cleanQuery) {
    allTickets = allTickets.filter(
      (t) =>
        t.key.toLowerCase().includes(cleanQuery) ||
        t.title.toLowerCase().includes(cleanQuery)
    );
  }

  return {
    isPmConnected,
    tickets: allTickets.slice(0, 30),
  };
}

// =========================================================================
// WORKSPACE TOOL INTEGRATIONS (Confluence, Notion, Figma, Postman, Datadog)
// =========================================================================


export interface WorkspaceToolIntegrationState {
  enabled: boolean;
  lastSyncedAt: string | null;
  config: Record<string, any>;
}

export async function getWorkspaceToolIntegrationsAction(
  workspaceIdOrSlug: string
): Promise<Record<ToolProviderId, WorkspaceToolIntegrationState>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualWsId = await requireWorkspaceAdmin(workspaceIdOrSlug, userId);

  const providers: ToolProviderId[] = ['confluence', 'notion', 'figma', 'postman', 'datadog'];
  const rows = await prisma.integration.findMany({
    where: {
      workspace_id: actualWsId,
      provider: { in: providers },
    },
  });

  const byProvider = new Map(rows.map((r) => [r.provider as ToolProviderId, r]));

  const defaults: Record<ToolProviderId, Record<string, any>> = {
    confluence: { baseUrl: '', email: '', apiToken: '', defaultSpaceKey: '' },
    notion: { apiToken: '', defaultDatabaseId: '' },
    figma: { accessToken: '', defaultTeamId: '' },
    postman: {
      apiKey: '',
      workspaceId: '',
      envMapping: { DEV: '', STAGING: '', UAT: '', PROD: '' },
      defaultDelayMs: 0,
      defaultTimeoutMs: 15000,
      bailOnFailure: true,
      persistResponses: true,
      turnOffLogs: false,
      keepVariableValues: true,
      ignoreCookies: false,
      saveCookies: true,
      alertOnMissingEnvVars: true,
    },
    datadog: {
      site: 'datadoghq.com',
      apiKey: '',
      appKey: '',
      envStartUrls: { DEV: '', STAGING: '', UAT: '', PROD: '' },
      defaultExecutionRule: 'blocking',
      defaultPollingTimeoutMs: 35000,
    },
  };

  const result = {} as Record<ToolProviderId, WorkspaceToolIntegrationState>;
  for (const p of providers) {
    const row = byProvider.get(p);
    result[p] = {
      enabled: Boolean(row?.enabled),
      lastSyncedAt: row?.last_synced_at?.toISOString() || null,
      config: {
        ...defaults[p],
        ...decryptToolConfig(row?.config as Record<string, any>),
      },
    };
  }

  return result;
}

export async function saveWorkspaceToolIntegrationAction(
  workspaceIdOrSlug: string,
  provider: ToolProviderId,
  data: {
    enabled: boolean;
    config: Record<string, any>;
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualWsId = await requireWorkspaceAdmin(workspaceIdOrSlug, userId);

  const encryptedConfig = encryptToolConfig(data.config || {});

  const saved = await prisma.integration.upsert({
    where: {
      workspace_id_provider: {
        workspace_id: actualWsId,
        provider,
      },
    },
    create: {
      workspace_id: actualWsId,
      provider,
      enabled: data.enabled,
      config: encryptedConfig as any,
      last_synced_at: new Date(),
    },
    update: {
      enabled: data.enabled,
      config: encryptedConfig as any,
      last_synced_at: new Date(),
    },
  });

  revalidatePath(`/workspace`);
  revalidatePath(`/p`);

  return {
    id: saved.id,
    enabled: saved.enabled,
    lastSyncedAt: saved.last_synced_at?.toISOString() || null,
  };
}

export async function testWorkspaceToolIntegrationAction(
  workspaceIdOrSlug: string,
  provider: ToolProviderId,
  config: Record<string, any>
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualWsId = await requireWorkspaceAdmin(workspaceIdOrSlug, userId);

  let testRes;
  switch (provider) {
    case 'confluence':
      testRes = await testConfluenceConnection(config as ConfluenceIntegrationConfig);
      break;
    case 'notion':
      testRes = await testNotionConnection(config as NotionIntegrationConfig);
      break;
    case 'figma':
      testRes = await testFigmaConnection(config as FigmaIntegrationConfig);
      break;
    case 'postman':
      testRes = await testPostmanConnection(config as PostmanIntegrationConfig);
      break;
    case 'datadog':
      testRes = await testDatadogConnection(config as DatadogIntegrationConfig);
      break;
    default:
      throw new Error(`Unsupported integration provider: ${provider}`);
  }

  if (testRes.success) {
    await prisma.integration
      .updateMany({
        where: { workspace_id: actualWsId, provider },
        data: { last_synced_at: new Date() },
      })
      .catch(() => {});
  }

  return testRes;
}

export async function getProjectRunnerCatalogAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const [project, projectVars] = await Promise.all([
    prisma.project.findUnique({
      where: { id: actualProjectId },
      select: {
        id: true,
        workspace_id: true,
        environments: {
          select: { id: true, name: true, base_url: true, is_default: true },
          orderBy: { created_at: 'asc' },
        },
      },
    }),
    prisma.variable.findMany({
      where: { project_id: actualProjectId, scope: 'GLOBAL' },
      include: {
        values: {
          include: { environment: { select: { name: true } } },
        },
      },
    }),
  ]);

  if (!project) throw new Error('Project not found');

  const postmanVariablesByEnv: Record<string, Record<string, string>> = {};
  const allEnvNames = new Set<string>([
    'DEV',
    'STAGING',
    'UAT',
    'PROD',
    ...project.environments.map((e) => e.name.toUpperCase()),
  ]);

  for (const envName of allEnvNames) {
    postmanVariablesByEnv[envName] = {};
    const matchedEnv = project.environments.find(
      (e) => e.name.toUpperCase() === envName
    );
    if (matchedEnv?.base_url) {
      const cleanBase = matchedEnv.base_url.replace(/\/+$/, '');
      postmanVariablesByEnv[envName]['BASE_URL'] = cleanBase;
      postmanVariablesByEnv[envName]['base_url'] = cleanBase;
      postmanVariablesByEnv[envName]['base_api_url'] = cleanBase;
      postmanVariablesByEnv[envName]['api_url'] = cleanBase;
    }
  }

  // Layer 1: Standard global variables as fallback
  for (const v of projectVars) {
    if (v.key.startsWith('postman:')) continue;
    for (const envName of allEnvNames) {
      if (v.default_value) {
        postmanVariablesByEnv[envName][v.key] = v.default_value;
      }
    }
    for (const val of v.values || []) {
      const envName = val.environment?.name?.toUpperCase();
      if (envName && val.value) {
        if (!postmanVariablesByEnv[envName]) postmanVariablesByEnv[envName] = {};
        postmanVariablesByEnv[envName][v.key] = val.value;
      }
    }
  }

  // Layer 2: Dedicated Postman variables (postman:<key>) override any colliding standard variables
  for (const v of projectVars) {
    if (!v.key.startsWith('postman:')) continue;
    const cleanKey = v.key.replace(/^postman:/, '');
    for (const envName of allEnvNames) {
      if (v.default_value) {
        postmanVariablesByEnv[envName][cleanKey] = v.default_value;
      }
    }
    for (const val of v.values || []) {
      const envName = val.environment?.name?.toUpperCase();
      if (envName && val.value) {
        if (!postmanVariablesByEnv[envName]) postmanVariablesByEnv[envName] = {};
        postmanVariablesByEnv[envName][cleanKey] = val.value;
      }
    }
  }

  const integrations = await prisma.integration.findMany({
    where: {
      workspace_id: project.workspace_id,
      provider: { in: ['postman', 'datadog', 'confluence', 'notion', 'figma'] },
      enabled: true,
    },
  });

  const byProv = new Map(integrations.map((i) => [i.provider, decryptToolConfig(i.config as any)]));
  const postmanCfg = byProv.get('postman') as PostmanIntegrationConfig | undefined;
  const datadogCfg = byProv.get('datadog') as DatadogIntegrationConfig | undefined;

  let postmanCollections: Array<{ id: string; uid: string; name: string }> = [];
  let postmanEnvironments: Array<{ id: string; uid: string; name: string }> = [];
  let datadogTests: Array<{ public_id: string; name: string; type: string }> = [];

  if (postmanCfg?.apiKey) {
    const pmTest = await testPostmanConnection(postmanCfg).catch(() => null);
    if (pmTest?.meta) {
      postmanCollections = pmTest.meta.collections || [];
      postmanEnvironments = pmTest.meta.environments || [];
    }
  }

  if (datadogCfg?.apiKey && datadogCfg?.appKey) {
    const ddTest = await testDatadogConnection(datadogCfg).catch(() => null);
    if (ddTest?.meta) {
      datadogTests = ddTest.meta.tests || [];
    }
  }

  return {
    environments: project.environments.map((e) => ({
      id: e.id,
      name: e.name,
      baseUrl: e.base_url || '',
      isDefault: e.is_default,
    })),
    postman: {
      connected: Boolean(postmanCfg?.apiKey),
      envMapping: postmanCfg?.envMapping || {},
      defaultDelayMs: postmanCfg?.defaultDelayMs ?? 250,
      defaultTimeoutMs: postmanCfg?.defaultTimeoutMs ?? 15000,
      bailOnFailure: Boolean(postmanCfg?.bailOnFailure),
      alertOnMissingEnvVars: postmanCfg?.alertOnMissingEnvVars !== false,
      collections: postmanCollections,
      environments: postmanEnvironments,
      variablesByEnv: postmanVariablesByEnv,
    },
    datadog: {
      connected: Boolean(datadogCfg?.apiKey && datadogCfg?.appKey),
      site: datadogCfg?.site || 'datadoghq.com',
      envStartUrls: datadogCfg?.envStartUrls || {},
      defaultExecutionRule: datadogCfg?.defaultExecutionRule || 'blocking',
      defaultPollingTimeoutMs: datadogCfg?.defaultPollingTimeoutMs ?? 35000,
      tests: datadogTests,
    },
    confluenceConnected: Boolean(byProv.get('confluence')?.apiToken),
    notionConnected: Boolean(byProv.get('notion')?.apiToken),
    figmaConnected: Boolean(byProv.get('figma')?.accessToken),
  };
}

/**
 * Fetch full Datadog Synthetic test definitions (config.assertions / config.steps)
 * for the given public_ids so InkaTest can build real test steps on import.
 */
function datadogSubtestPublicId(step: any): string | undefined {
  return (
    step?.subtestPublicId ||
    step?.subTestPublicId ||
    step?.subtest_public_id ||
    step?.subtestId ||
    step?.subtest?.public_id ||
    step?.params?.subtestPublicId ||
    step?.params?.subTestPublicId ||
    step?.params?.subtest_public_id ||
    step?.params?.sub_test_public_id ||
    undefined
  );
}

async function fetchDatadogBrowserDefinition(
  site: string,
  headers: Record<string, string>,
  publicId: string
): Promise<{ name?: string; publicId?: string; config: any }> {
  // The browser-test configuration endpoint is v1. The v2 browser path returns
  // 404 on Datadog, which previously caused every browser import to fall back
  // to a synthetic placeholder step. Steps live at the top level of this
  // response (not under config.steps).
  const res = await fetch(
    `https://api.${site}/api/v1/synthetics/tests/browser/${encodeURIComponent(publicId)}`,
    { method: 'GET', headers, signal: AbortSignal.timeout(15000) }
  );
  const text = await res.text().catch(() => '');
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const apiError =
      (Array.isArray(data?.errors) && data.errors.map((e: any) => (typeof e === 'string' ? e : e?.message || JSON.stringify(e))).join('; ')) ||
      data?.error ||
      data?.message ||
      text.slice(0, 300) ||
      res.statusText;
    throw new Error(
      `Datadog browser test "${publicId}" could not be loaded (HTTP ${res.status}): ${apiError}`
    );
  }
  const t = data?.test || data?.data?.attributes || data;
  const steps = Array.isArray(t?.steps)
    ? t.steps
    : Array.isArray(t?.config?.steps)
      ? t.config.steps
      : [];
  return {
    name: t?.name,
    publicId: t?.public_id || publicId,
    config: { ...(t?.config || {}), steps },
  };
}

/**
 * Datadog's "All Steps" view is a flattened journey that includes referenced
 * subtests. The public API returns subtests as step references, so resolve them
 * recursively and inline their steps in order with a traceable prefix.
 */
async function resolveDatadogBrowserSteps(
  steps: any[],
  site: string,
  headers: Record<string, string>,
  depth: number,
  seen: Set<string>
): Promise<any[]> {
  if (!Array.isArray(steps) || depth > 6) return Array.isArray(steps) ? steps : [];
  const out: any[] = [];

  for (const step of steps) {
    if (!step) continue;
    const subtestId = datadogSubtestPublicId(step);

    if (subtestId && !seen.has(subtestId)) {
      try {
        const child = await fetchDatadogBrowserDefinition(site, headers, subtestId);
        const childSteps = Array.isArray(child?.config?.steps) ? child.config.steps : [];
        if (childSteps.length > 0) {
          const resolved = await resolveDatadogBrowserSteps(
            childSteps,
            site,
            headers,
            depth + 1,
            new Set([...seen, subtestId])
          );
          const label = step?.name || child?.name || subtestId;
          for (const childStep of resolved) {
            out.push({
              ...childStep,
              // Keep Datadog's own step name untouched; the subtest boundary is
              // carried as metadata and rendered as a collapsible group.
              sourcePublicId: childStep?.sourcePublicId || child?.publicId || subtestId,
              subtestName: childStep?.subtestName || label,
            });
          }
          continue;
        }
      } catch (err) {
        out.push({
          ...step,
          type: 'subtest-unavailable',
          subtestName: step?.name || step?.subtestName || subtestId,
          sourcePublicId: step?.sourcePublicId || subtestId,
          params: {
            ...(step?.params || {}),
            subtestPublicId: subtestId,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        continue;
      }
    }

    if (Array.isArray(step?.subSteps) && step.subSteps.length > 0) {
      const nested = await resolveDatadogBrowserSteps(step.subSteps, site, headers, depth + 1, seen);
      out.push({ ...step, subSteps: nested });
      continue;
    }

    out.push(step);
  }

  return out;
}

async function resolveDatadogSubTestEntries(
  subTests: any[],
  site: string,
  headers: Record<string, string>
): Promise<any[]> {
  const out: any[] = [];
  for (const raw of subTests) {
    const st = typeof raw === 'string' ? { public_id: raw } : raw;
    const id =
      st?.public_id ||
      st?.publicId ||
      st?.subtestPublicId ||
      st?.subTestPublicId ||
      st?.subtest_public_id ||
      st?.subtestId;
    const label = st?.name || st?.title || id || 'Subtest';
    let childSteps = Array.isArray(st?.steps) ? st.steps : [];
    if (childSteps.length === 0 && id) {
      try {
        const child = await fetchDatadogBrowserDefinition(site, headers, id);
        childSteps = Array.isArray(child?.config?.steps) ? child.config.steps : [];
      } catch (err) {
        out.push({
          type: 'subtest-unavailable',
          subtestName: label,
          sourcePublicId: id,
          params: { subtestPublicId: id, error: err instanceof Error ? err.message : String(err) },
        });
        continue;
      }
    }
    if (childSteps.length > 0) {
      const resolved = await resolveDatadogBrowserSteps(
        childSteps,
        site,
        headers,
        1,
        new Set(id ? [id] : [])
      );
      for (const childStep of resolved) {
        out.push({
          ...childStep,
          sourcePublicId: childStep?.sourcePublicId || id,
          subtestName: childStep?.subtestName || label,
        });
      }
    } else {
      out.push({ name: label, type: 'subtest', subtestName: label, sourcePublicId: id });
    }
  }
  return out;
}

export async function fetchDatadogTestDefinitionsAction(data: {
  projectId: string;
  publicIds: string[];
}): Promise<Array<{
  public_id: string;
  name: string;
  type: 'api' | 'browser';
  config: any;
}>> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { id: true, workspace_id: true },
  });
  if (!project) throw new Error('Project not found');

  const row = await prisma.integration.findUnique({
    where: {
      workspace_id_provider: {
        workspace_id: project.workspace_id,
        provider: 'datadog',
      },
    },
  });
  if (!row || !row.enabled) {
    throw new Error('Datadog Synthetics integration is not enabled for this workspace.');
  }

  const cfg = decryptToolConfig(row.config as any) as DatadogIntegrationConfig;
  const site = normalizeDatadogSite(cfg.site);
  const apiKey = decrypt((cfg.apiKey || '').trim());
  const appKey = decrypt((cfg.appKey || '').trim());
  if (!apiKey || !appKey) {
    throw new Error('Datadog API Key and Application Key are required.');
  }

  const headers = {
    'DD-API-KEY': apiKey,
    'DD-APPLICATION-KEY': appKey,
    Accept: 'application/json',
  };

  const definitions: Array<{ public_id: string; name: string; type: 'api' | 'browser'; config: any }> = [];

  for (const publicId of data.publicIds) {
    let testType: 'api' | 'browser' = 'api';
    let config: any = {};
    let testName = publicId;

    // Look the test up through the v1 test endpoint first to learn its type.
    const genericRes = await fetch(
      `https://api.${site}/api/v1/synthetics/tests/${encodeURIComponent(publicId)}`,
      { method: 'GET', headers, signal: AbortSignal.timeout(15000) }
    );
    const genericText = await genericRes.text().catch(() => '');
    let generic: any = {};
    try {
      generic = genericText ? JSON.parse(genericText) : {};
    } catch {
      generic = {};
    }

    if (!genericRes.ok && genericRes.status !== 404) {
      const apiError =
        (Array.isArray(generic?.errors) &&
          generic.errors
            .map((e: any) => (typeof e === 'string' ? e : e?.message || JSON.stringify(e)))
            .join('; ')) ||
        generic?.error ||
        generic?.message ||
        genericText.slice(0, 300) ||
        genericRes.statusText;
      throw new Error(
        `Datadog test "${publicId}" could not be loaded (HTTP ${genericRes.status}): ${apiError}`
      );
    }

    if (genericRes.ok) {
      const t = generic?.test || generic;
      testName = t?.name || publicId;
      testType =
        String(t?.type || t?.config?.type || 'api').toLowerCase() === 'browser'
          ? 'browser'
          : 'api';
      config = t?.config || {};
      // API/multistep definitions may expose steps outside config.
      if (testType === 'api' && Array.isArray(t?.steps) && !Array.isArray(config?.steps)) {
        config = { ...config, steps: t.steps };
      }
    }

    // Browser test configuration (including its full top-level steps array) is
    // only available from the v1 browser endpoint. A 404 above means the test
    // is a browser test, so fetch it directly.
    if (testType === 'browser' || genericRes.status === 404) {
      const browser = await fetchDatadogBrowserDefinition(site, headers, publicId);
      testName = browser.name || testName;
      testType = 'browser';
      config = browser.config || {};
    }

    // Flatten referenced subtests into the step list so the imported case shows
    // one continuous, traceable journey (matching Datadog's "All Steps" view).
    if (testType === 'browser' && config && typeof config === 'object') {
      const baseSteps = Array.isArray(config.steps) ? config.steps : [];
      const resolvedSteps = await resolveDatadogBrowserSteps(
        baseSteps,
        site,
        headers,
        0,
        new Set([publicId])
      );
      const inlineSubTests = Array.isArray(config.subTests)
        ? await resolveDatadogSubTestEntries(config.subTests, site, headers)
        : [];
      config = {
        ...config,
        steps: [...resolvedSteps, ...inlineSubTests],
        subTests: [],
      };

      if (config.steps.length === 0) {
        throw new Error(
          `Datadog browser test "${testName}" (${publicId}) returned no configured steps. ` +
            'Check that the test is a browser test and that it has recorded steps in Datadog.'
        );
      }
    }

    definitions.push({ public_id: publicId, name: testName, type: testType, config });
  }

  return definitions;
}

/**
 * Fetch the variables that can be overridden for Datadog synthetic executions.
 *
 * The Datadog CI trigger API accepts `variables: { NAME: value }` per test and
 * substitutes `{{ NAME }}` for that execution only. We therefore expose the
 * declared test variables, any `{{ }}` reference in the definition, and the
 * workspace's Datadog global variable names.
 */
export async function fetchDatadogTestVariablesAction(data: {
  projectId: string;
  publicIds: string[];
}): Promise<{
  supported: boolean;
  reason?: string;
  variables: Array<{ name: string; example?: string; source: 'test' | 'global' | 'environment' }>;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const publicIds = Array.from(new Set((data.publicIds || []).map((s) => s.trim()).filter(Boolean)));
  if (publicIds.length === 0) {
    return { supported: true, variables: [] };
  }

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { workspace_id: true },
  });
  if (!project) throw new Error('Project not found');

  const row = await prisma.integration.findUnique({
    where: {
      workspace_id_provider: { workspace_id: project.workspace_id, provider: 'datadog' },
    },
  });
  if (!row || !row.enabled) {
    return {
      supported: false,
      reason: 'Datadog Synthetics integration is not enabled for this workspace.',
      variables: [],
    };
  }

  const cfg = decryptToolConfig(row.config as any) as DatadogIntegrationConfig;
  const site = normalizeDatadogSite(cfg.site);
  const apiKey = decrypt((cfg.apiKey || '').trim());
  const appKey = decrypt((cfg.appKey || '').trim());
  if (!apiKey || !appKey) {
    return {
      supported: false,
      reason: 'Datadog API Key and Application Key are required to list overridable variables.',
      variables: [],
    };
  }

  const headers = {
    'DD-API-KEY': apiKey,
    'DD-APPLICATION-KEY': appKey,
    Accept: 'application/json',
  };

  const merged = new Map<string, { name: string; example?: string; source: 'test' | 'global' | 'environment' }>();

  for (const publicId of publicIds) {
    let testConfig: any = null;
    try {
      const res = await fetch(
        `https://api.${site}/api/v1/synthetics/tests/${encodeURIComponent(publicId)}`,
        { method: 'GET', headers, signal: AbortSignal.timeout(15000) }
      );
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        const test = json?.test || json;
        const isBrowser = String(test?.type || '').toLowerCase() === 'browser';
        if (isBrowser) {
          const browser = await fetchDatadogBrowserDefinition(site, headers, publicId);
          testConfig = browser?.config || test?.config || null;
        } else {
          testConfig = test?.config || null;
        }
      } else if (res.status === 404) {
        const browser = await fetchDatadogBrowserDefinition(site, headers, publicId);
        testConfig = browser?.config || null;
      }
    } catch {
      testConfig = null;
    }

    for (const v of detectDatadogVariables(testConfig, [])) {
      if (!merged.has(v.name)) merged.set(v.name, v);
    }
  }

  // Workspace-level Datadog global variables (names are always overridable in CI).
  try {
    const res = await fetch(`https://api.${site}/api/v1/synthetics/variables`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      const list: any[] = Array.isArray(json?.variables) ? json.variables : [];
      for (const gv of list) {
        const name = String(gv?.name || '').replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
        if (name && !merged.has(name)) {
          merged.set(name, { name, source: 'global' });
        }
      }
    }
  } catch {
    // Global variables are optional; test-scoped variables still work.
  }

  return {
    supported: true,
    variables: Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function fetchPostmanCollectionRequestsAction(
  projectIdOrSlug: string,
  collectionUid: string
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { workspace_id: true },
  });
  if (!project) return [];

  const row = await prisma.integration.findUnique({
    where: {
      workspace_id_provider: {
        workspace_id: project.workspace_id,
        provider: 'postman',
      },
    },
  });
  if (!row || !row.enabled) return [];

  const cfg = decryptToolConfig(row.config as any) as PostmanIntegrationConfig;
  return listPostmanCollectionRequests(cfg, collectionUid);
}

export async function executeTestCaseExternalRunnerAction(data: {
  projectId: string;
  testCaseId: string;
  runResultId?: string;
  recordInTestRuns?: boolean;
  provider: 'postman' | 'datadog';
  environmentName?: string;
  datasetParams?: Record<string, string>;
  customVariables?: Record<string, string>;
  saveLinkToCase?: boolean;
  postman?: {
    collectionUid: string;
    folderOrRequestFilter?: string;
    selectedRequestOrders?: number[];
    postmanEnvUidOverride?: string;
    iterationDataMode?: 'none' | 'dataset';
    iterations?: number;
    delayMs?: number;
    timeoutMs?: number;
    maxLatencyMs?: number;
    bailOnFailure?: boolean;
    persistResponses?: boolean;
    turnOffLogs?: boolean;
    keepVariableValues?: boolean;
    ignoreCookies?: boolean;
    saveCookies?: boolean;
    skipStepOrders?: number[];
  };
  datadog?: {
    publicIds: string[];
    startUrlOverride?: string;
    executionRule?: 'blocking' | 'non_blocking' | 'skipped';
    delayMs?: number;
    retryCount?: number;
  };
  /**
   * Process-local system activation supplied by the execution coordinator.
   * Cannot be forged by a client: server-action arguments are deserialized into
   * fresh objects that are never members of the WeakSet in system-actor.ts.
   */
  __systemActor?: unknown;
  /** Fencing: only write to the attempt the caller actually claimed. */
  expectedAttemptNumber?: number;
  expectedGeneration?: number;
}) {
  const internalActor = readSystemActor(data.__systemActor);
  let userId: number;
  let actualProjectId: string;

  if (internalActor) {
    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { id: true },
    });
    if (!project) throw new Error('Project not found');
    userId = internalActor.userId;
    actualProjectId = project.id;
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user) throw new Error('Unauthorized');
    userId = (session.user as any).id as number;
    actualProjectId = await requireProjectMember(data.projectId, userId);
  }

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { id: true, workspace_id: true },
  });
  if (!project) throw new Error('Project not found');

  // Fencing before any provider side effect: the row must belong to this
  // project, still be PENDING, and still be the attempt the caller claimed.
  if (data.runResultId) {
    const row = await prisma.runResult.findUnique({
      where: { id: data.runResultId },
      select: {
        run_id: true,
        status: true,
        attempt_number: true,
        execution_generation: true,
      },
    });
    if (!row) throw new Error('Run result not found');
    const parentRun = await prisma.testRun.findUnique({
      where: { id: row.run_id },
      select: { project_id: true },
    });
    if (!parentRun || parentRun.project_id !== actualProjectId) {
      throw new Error('Run result does not belong to this project');
    }
    if (row.status !== 'PENDING') {
      throw new Error('This case is no longer pending; refresh to see the latest result');
    }
    if (
      typeof data.expectedAttemptNumber === 'number' &&
      row.attempt_number !== data.expectedAttemptNumber
    ) {
      throw new Error('This attempt has been superseded by a newer attempt');
    }
    if (
      typeof data.expectedGeneration === 'number' &&
      row.execution_generation !== data.expectedGeneration
    ) {
      throw new Error('This execution belongs to an older run generation');
    }
  }

  const integrationRow = await prisma.integration.findUnique({
    where: {
      workspace_id_provider: {
        workspace_id: project.workspace_id,
        provider: data.provider,
      },
    },
  });

  if (!integrationRow || !integrationRow.enabled) {
    throw new Error(
      `${data.provider === 'postman' ? 'Postman' : 'Datadog Synthetics'} integration is not enabled for this workspace.`
    );
  }

  const toolConfig = decryptToolConfig(integrationRow.config as any);

  // Resolve InkaTest variables + test case dataset for the selected environment + test case
  const [envRecord, globalVars, localVars, testCaseRecord] = await Promise.all([
    data.environmentName
      ? prisma.environment.findFirst({
          where: {
            project_id: actualProjectId,
            name: { equals: data.environmentName.trim(), mode: 'insensitive' },
          },
          include: {
            variable_values: {
              include: { variable: { select: { key: true } } },
            },
          },
        })
      : prisma.environment.findFirst({
          where: { project_id: actualProjectId, is_default: true },
          include: {
            variable_values: {
              include: { variable: { select: { key: true } } },
            },
          },
        }),
    prisma.variable.findMany({
      where: { project_id: actualProjectId, test_case_id: null },
      select: { key: true, default_value: true },
    }),
    prisma.variable.findMany({
      where: { test_case_id: data.testCaseId },
      select: { key: true, default_value: true },
    }),
    prisma.testCase.findUnique({
      where: { id: data.testCaseId },
      select: {
        id: true,
        display_id: true,
        title: true,
        current_version: true,
        custom_fields: true,
        local_dataset: true,
        dataset: { select: { rows: true } },
      },
    }),
  ]);

  const resolvedInkaVars: Record<string, string> = {};
  const savedCasePostman = (testCaseRecord?.custom_fields as any)?._postman;
  if (savedCasePostman?.customVariables && typeof savedCasePostman.customVariables === 'object') {
    for (const [k, v] of Object.entries(savedCasePostman.customVariables)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        resolvedInkaVars[k] = String(v);
      }
    }
  }
  for (const gv of globalVars) {
    if (!gv.key.startsWith('postman:') && gv.default_value) {
      resolvedInkaVars[gv.key] = gv.default_value;
    }
  }
  for (const gv of globalVars) {
    if (gv.key.startsWith('postman:') && gv.default_value) {
      resolvedInkaVars[gv.key.replace(/^postman:/, '')] = gv.default_value;
    }
  }
  for (const lv of localVars) {
    if (lv.default_value) resolvedInkaVars[lv.key] = lv.default_value;
  }
  if (envRecord) {
    if (envRecord.base_url) {
      const cleanBase = envRecord.base_url.replace(/\/+$/, '');
      if (!resolvedInkaVars['BASE_URL']) resolvedInkaVars['BASE_URL'] = cleanBase;
      if (!resolvedInkaVars['base_url']) resolvedInkaVars['base_url'] = cleanBase;
      if (!resolvedInkaVars['base_api_url']) resolvedInkaVars['base_api_url'] = cleanBase;
      if (!resolvedInkaVars['api_url']) resolvedInkaVars['api_url'] = cleanBase;
      if (!resolvedInkaVars['baseUrl']) resolvedInkaVars['baseUrl'] = cleanBase;
    }
    for (const vv of envRecord.variable_values || []) {
      if (vv.variable?.key && !vv.variable.key.startsWith('postman:') && vv.value !== null && vv.value !== undefined) {
        resolvedInkaVars[vv.variable.key] = vv.value;
      }
    }
    // Postman namespace variables take precedence over colliding standard variables
    for (const vv of envRecord.variable_values || []) {
      if (vv.variable?.key && vv.variable.key.startsWith('postman:') && vv.value !== null && vv.value !== undefined) {
        resolvedInkaVars[vv.variable.key.replace(/^postman:/, '')] = vv.value;
      }
    }
  }
  for (const [k, v] of Object.entries(data.customVariables || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      resolvedInkaVars[k] = String(v);
    }
  }

  // Resolve any attachment://<id>/<filename> variable values to actual S3 file bytes + presigned URLs
  const attachmentFiles: Record<string, PostmanAttachmentFilePayload> = {};
  for (const [varKey, varVal] of Object.entries(resolvedInkaVars)) {
    const attMatch = String(varVal || '').match(/^attachment:\/\/([^/]+)\/(.+)$/);
    if (!attMatch) continue;
    const attId = attMatch[1];
    const fallbackName = attMatch[2];
    try {
      const att = await prisma.attachment.findUnique({ where: { id: attId } });
      if (att?.storage_key) {
        const bucket = getBucketName();
        const [s3Obj, signedUrl] = await Promise.all([
          s3Client
            .send(new GetObjectCommand({ Bucket: bucket, Key: att.storage_key }))
            .catch(() => null),
          generateDownloadUrl(att.storage_key).catch(() => ''),
        ]);

        let fileBuffer = Buffer.alloc(0);
        if (s3Obj?.Body) {
          const byteArr = await s3Obj.Body.transformToByteArray();
          fileBuffer = Buffer.from(byteArr);
        }

        const mime = att.mime_type || 'application/octet-stream';
        const fname = att.original_filename || att.filename || fallbackName;
        attachmentFiles[varKey] = {
          filename: fname,
          mimeType: mime,
          buffer: fileBuffer,
          downloadUrl: signedUrl || undefined,
        };

        // If text/JSON/CSV file, allow text interpolation; otherwise provide the signed S3 download URL
        if (
          fileBuffer.length > 0 &&
          (mime.startsWith('text/') || mime === 'application/json' || /\.(json|txt|csv|xml)$/i.test(fname))
        ) {
          resolvedInkaVars[varKey] = fileBuffer.toString('utf-8');
        } else if (signedUrl) {
          resolvedInkaVars[varKey] = signedUrl;
        }
      }
    } catch {
      // non-fatal
    }
  }

  // Optionally persist the linked Postman Collection / Datadog Public ID on the TestCase custom_fields
  if (data.saveLinkToCase && testCaseRecord) {
    const existingFields =
      testCaseRecord.custom_fields && typeof testCaseRecord.custom_fields === 'object'
        ? { ...(testCaseRecord.custom_fields as Record<string, any>) }
        : {};

    if (data.provider === 'postman' && data.postman) {
      // A case is linked to exactly one external provider. Running/linking another
      // provider replaces the previous link so the UI never shows both.
      delete existingFields._datadog;
      existingFields._postman = {
        ...(existingFields._postman || {}),
        collectionUid: data.postman.collectionUid,
        folderOrRequestFilter: data.postman.folderOrRequestFilter || '',
        selectedRequestOrders: data.postman.selectedRequestOrders || [],
        postmanEnvUidOverride: data.postman.postmanEnvUidOverride || '',
        defaultEnvironment: data.environmentName || existingFields._postman?.defaultEnvironment || 'UAT',
        customVariables: data.customVariables || existingFields._postman?.customVariables || {},
        delayMs: data.postman.delayMs ?? 0,
        timeoutMs: data.postman.timeoutMs ?? 15000,
        maxLatencyMs: data.postman.maxLatencyMs,
        bailOnFailure: Boolean(data.postman.bailOnFailure),
        persistResponses: data.postman.persistResponses !== false,
        turnOffLogs: Boolean(data.postman.turnOffLogs),
        keepVariableValues: data.postman.keepVariableValues !== false,
        ignoreCookies: Boolean(data.postman.ignoreCookies),
        saveCookies: data.postman.saveCookies !== false,
      };
    } else if (data.provider === 'datadog' && data.datadog) {
      delete existingFields._postman;
      existingFields._datadog = {
        publicIds: data.datadog.publicIds,
        executionRule: data.datadog.executionRule || 'blocking',
        delayMs: data.datadog.delayMs ?? 0,
        retryCount: data.datadog.retryCount ?? 0,
        startUrlOverride: data.datadog.startUrlOverride || '',
        defaultEnvironment:
          data.environmentName || existingFields._datadog?.defaultEnvironment || 'UAT',
        // Variable overrides are saved only when the user opted in.
        customVariables:
          data.customVariables || existingFields._datadog?.customVariables || {},
      };
    }

    await prisma.testCase
      .update({
        where: { id: data.testCaseId },
        data: { custom_fields: existingFields },
      })
      .catch(() => {});
  }

  let execResult: ExternalTestExecutionResult;

  if (data.provider === 'postman') {
    if (!data.postman?.collectionUid) {
      throw new Error('Postman Collection UID is required.');
    }

    let iterationRows: Record<string, string>[] | undefined;
    if (data.postman.iterationDataMode === 'dataset' && testCaseRecord) {
      const dsRows =
        (testCaseRecord.dataset?.rows as any[]) ||
        ((testCaseRecord.local_dataset as any)?.rows as any[]) ||
        [];
      if (Array.isArray(dsRows) && dsRows.length > 0) {
        iterationRows = dsRows;
      }
    }

    execResult = await executePostmanParameterizedRun(toolConfig as PostmanIntegrationConfig, {
      collectionUid: data.postman.collectionUid,
      // Selected orders are full-collection indices; a folder/name pre-filter
      // would shift them onto unrelated sibling requests.
      folderOrRequestFilter: data.postman.selectedRequestOrders?.length
        ? undefined
        : data.postman.folderOrRequestFilter,
      selectedRequestOrders: data.postman.selectedRequestOrders,
      environmentName: data.environmentName || envRecord?.name,
      postmanEnvUidOverride: data.postman.postmanEnvUidOverride,
      inkaVariables: resolvedInkaVars,
      attachmentFiles,
      datasetParams: data.datasetParams,
      iterationRows,
      iterations: data.postman.iterations,
      delayMs: data.postman.delayMs,
      timeoutMs: data.postman.timeoutMs,
      maxLatencyMs: data.postman.maxLatencyMs,
      bailOnFailure: data.postman.bailOnFailure,
      persistResponses: data.postman.persistResponses,
      turnOffLogs: data.postman.turnOffLogs,
      keepVariableValues: data.postman.keepVariableValues,
      ignoreCookies: data.postman.ignoreCookies,
      saveCookies: data.postman.saveCookies,
      skipStepOrders: data.postman.skipStepOrders,
    });
  } else {
    if (!data.datadog?.publicIds?.length) {
      throw new Error('Datadog Synthetic Test public_id is required.');
    }

    const ddConfig = toolConfig as DatadogIntegrationConfig;
    const environmentName = data.environmentName || envRecord?.name;
    const executionRule =
      data.datadog.executionRule || ddConfig.defaultExecutionRule || 'blocking';

    // Trigger only. Datadog returns as soon as the CI batch is accepted; results
    // are retrieved by the durable background monitor, so this never blocks the
    // caller and never holds the request open while the test executes.
    const trigger = await triggerDatadogSyntheticsTests(ddConfig, {
      publicIds: data.datadog.publicIds,
      environmentName,
      startUrlOverride: data.datadog.startUrlOverride,
      inkaVariables: resolvedInkaVars,
      datasetParams: data.datasetParams,
      executionRule,
      delayMs: data.datadog.delayMs,
      retryCount: data.datadog.retryCount,
    });

    const executions: MonitorExecutionRecord[] = trigger.executions.map((e) => ({
      publicId: e.publicId,
      resultId: e.resultId,
      testType: e.testType,
      testName: e.testName,
      status: 'pending' as const,
      startedAt: new Date().toISOString(),
    }));

    execResult = buildExternalResultFromExecutions({
      executions,
      batchId: trigger.batchId,
      environment: environmentName,
      executionRule,
      startedAtMs: Date.now(),
    });

    // Record the run/result as PENDING, then hand off to the durable monitor.
    let targetRunId: string | null = null;
    let targetResultId: string | null = null;

    if (data.runResultId) {
      const existing = await prisma.runResult.findUnique({
        where: { id: data.runResultId },
        select: { run_id: true },
      });
      targetRunId = existing?.run_id ?? null;
      targetResultId = data.runResultId;
      await prisma.runResult
        .updateMany({
          where: {
            id: data.runResultId,
            status: 'PENDING',
            ...(typeof data.expectedAttemptNumber === 'number'
              ? { attempt_number: data.expectedAttemptNumber }
              : {}),
            ...(typeof data.expectedGeneration === 'number'
              ? { execution_generation: data.expectedGeneration }
              : {}),
          },
          data: {
            status: 'PENDING',
            source: 'automated',
            notes: execResult.summary,
            step_results: {
              ...(execResult.stepResults as any || {}),
              ...(data.customVariables && Object.keys(data.customVariables).length > 0 ? { _overrideVariables: data.customVariables } : {})
            },
            automation_log: execResult.automationLog,
          },
        })
        .catch(() => {});
    } else if (testCaseRecord) {
      // No opt-out: an execution outside a Run always creates a tracked ad-hoc run.
      try {
        const runId = await generateTestRunId();
        const now = new Date();
        const created = await prisma.testRun.create({
          data: {
            id: runId,
            project_id: actualProjectId,
            name: `Datadog Run · ${testCaseRecord.display_id}`,
            environment: (environmentName || 'UAT').toUpperCase(),
            // Still awaiting the provider: the monitor completes this run.
            status: 'IN_PROGRESS',
            source: 'datadog',
            started_at: now,
            created_by: userId,
            resolved_variables: resolvedInkaVars as any,
            // Ad-hoc runs (case-detail Run button) are hidden by default in the
            // runs list behind the "Show ad-hoc runs" toggle.
            run_context: { adhoc: true } as any,
            results: {
              create: [
                {
                  test_case_id: testCaseRecord.id,
                  order_index: 1,
                  status: 'PENDING',
                  source: 'automated',
                  notes: execResult.summary,
                  step_results: {
                    ...(execResult.stepResults as any || {}),
                    ...(data.customVariables && Object.keys(data.customVariables).length > 0 ? { _overrideVariables: data.customVariables } : {})
                  },
                  automation_log: execResult.automationLog,
                },
              ],
            },
          },
          include: { results: { select: { id: true } } },
        });
        targetRunId = runId;
        targetResultId = created.results[0]?.id ?? null;
        execResult.createdRunId = runId;
      } catch {
        // non-fatal
      }
    }

    if (targetRunId) {
      const monitor = await enqueueDatadogMonitor({
        projectId: actualProjectId,
        runId: targetRunId,
        runResultId: targetResultId,
        environment: environmentName ?? null,
        batchId: trigger.batchId ?? null,
        executions,
        executionRule,
        triggerContext: {
          publicIds: data.datadog.publicIds,
          executionRule,
          startUrlOverride: data.datadog.startUrlOverride,
          customVariables: data.customVariables || {},
          attemptNumber: data.expectedAttemptNumber,
          generation: data.expectedGeneration,
        },
      });
      execResult.monitor = {
        id: monitor.id,
        provider: 'datadog',
        status: monitor.status,
        deadlineAt: monitor.deadline_at.toISOString(),
      };
      execResult.stepResults = {
        ...execResult.stepResults,
        _externalMonitor: {
          provider: 'datadog',
          status: 'PENDING',
          deadlineAt: monitor.deadline_at.toISOString(),
        },
      } as any;
    }

    return execResult;
  }

  // If triggered inside an active Test Run, persist results to RunResult.
  // Fenced write: a delayed execution for an older attempt/generation must never
  // overwrite the current attempt, and a manual verdict recorded while the
  // provider was running is preserved.
  if (data.runResultId) {
    await prisma.runResult
      .updateMany({
        where: {
          id: data.runResultId,
          status: 'PENDING',
          ...(typeof data.expectedAttemptNumber === 'number'
            ? { attempt_number: data.expectedAttemptNumber }
            : {}),
          ...(typeof data.expectedGeneration === 'number'
            ? { execution_generation: data.expectedGeneration }
            : {}),
        },
        data: {
          status: execResult.overallStatus,
          executed_at: new Date(),
          time_spent_seconds: Math.max(1, Math.round(execResult.totalDurationMs / 1000)),
          source: 'automated',
          notes: execResult.summary,
          step_results: execResult.stepResults as any,
          automation_log: execResult.automationLog,
        },
      })
      .catch(() => {});
  } else if (testCaseRecord) {
    // No opt-out: an execution outside a Run always creates a tracked ad-hoc run.
    try {
      const runId = await generateTestRunId();
      const now = new Date();
      await prisma.testRun.create({
        data: {
          id: runId,
          project_id: actualProjectId,
          name: `${data.provider === 'postman' ? 'Postman' : 'Datadog'} Run · ${testCaseRecord.display_id}`,
          environment: (data.environmentName || envRecord?.name || 'UAT').toUpperCase(),
          status: execResult.overallStatus === 'FAIL' ? 'FAILED' : 'COMPLETED',
          source: data.provider,
          started_at: now,
          completed_at: now,
          created_by: userId,
          resolved_variables: resolvedInkaVars as any,
          // Ad-hoc runs (case-detail Run button) are hidden by default in the
          // runs list behind the "Show ad-hoc runs" toggle.
          run_context: { adhoc: true } as any,
          results: {
            create: [
              {
                test_case_id: testCaseRecord.id,
                order_index: 1,
                status: execResult.overallStatus,
                source: 'automated',
                executed_by: userId,
                executed_at: now,
                time_spent_seconds: Math.max(1, Math.round(execResult.totalDurationMs / 1000)),
                notes: execResult.summary,
                step_results: execResult.stepResults as any,
                automation_log: execResult.automationLog,
              },
            ],
          },
        },
      });
      execResult.createdRunId = runId;
    } catch {
      // non-fatal
    }
  }

  return execResult;
}

/**
 * Find-or-create a synthetic InkaTest TestCase for an external (Postman/Datadog)
 * selection, then trigger execution and record a dedicated run.
 * Reuses executeTestCaseExternalRunnerAction with recordInTestRuns=true.
 */
export async function createExternalRunAction(data: {
  projectId: string;
  provider: 'postman' | 'datadog';
  name: string;
  environmentName?: string;
  customVariables?: Record<string, string>;
  postman?: {
    collectionUid: string;
    folderOrRequestFilter?: string;
    selectedRequestOrders?: number[];
    postmanEnvUidOverride?: string;
    iterations?: number;
    delayMs?: number;
    timeoutMs?: number;
    maxLatencyMs?: number;
    bailOnFailure?: boolean;
    persistResponses?: boolean;
    turnOffLogs?: boolean;
    keepVariableValues?: boolean;
    ignoreCookies?: boolean;
    saveCookies?: boolean;
  };
  datadog?: {
    publicIds: string[];
    executionRule?: 'blocking' | 'non_blocking' | 'skipped';
    startUrlOverride?: string;
    delayMs?: number;
    retryCount?: number;
  };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  // Build a stable external key for find-or-create
  const externalKey =
    data.provider === 'postman'
      ? `postman:${data.postman?.collectionUid || ''}:${data.postman?.folderOrRequestFilter || ''}`
      : `datadog:${(data.datadog?.publicIds || []).join(',')}`;

  // Find existing synthetic case
  let syntheticCase = await prisma.testCase.findFirst({
    where: {
      project_id: actualProjectId,
      external_ref: externalKey,
      deleted_at: null,
    },
    select: { id: true, display_id: true, title: true, custom_fields: true },
  });

  if (!syntheticCase) {
    // Atomic counter increment (UPDATE ... RETURNING under the hood). A
    // read-then-write here produced duplicate display ids under concurrent
    // synthetic-case creation.
    const displayId = await generateTestCaseDisplayId(actualProjectId);

    const customFields: Record<string, any> = {};
    if (data.provider === 'postman' && data.postman) {
      delete customFields._datadog;
      customFields._postman = {
        collectionUid: data.postman.collectionUid,
        folderOrRequestFilter: data.postman.folderOrRequestFilter || '',
        selectedRequestOrders: data.postman.selectedRequestOrders || [],
        postmanEnvUidOverride: data.postman.postmanEnvUidOverride || '',
        defaultEnvironment: 'UAT',
        customVariables: data.customVariables || {},
        delayMs: data.postman.delayMs ?? 0,
        timeoutMs: data.postman.timeoutMs ?? 15000,
        maxLatencyMs: data.postman.maxLatencyMs,
        bailOnFailure: Boolean(data.postman.bailOnFailure),
        persistResponses: data.postman.persistResponses !== false,
        turnOffLogs: Boolean(data.postman.turnOffLogs),
        keepVariableValues: data.postman.keepVariableValues !== false,
        ignoreCookies: Boolean(data.postman.ignoreCookies),
        saveCookies: data.postman.saveCookies !== false,
      };
    } else if (data.provider === 'datadog' && data.datadog) {
      delete customFields._postman;
      customFields._datadog = {
        publicIds: data.datadog.publicIds,
        executionRule: data.datadog.executionRule || 'blocking',
        delayMs: data.datadog.delayMs ?? 0,
        retryCount: data.datadog.retryCount ?? 0,
        startUrlOverride: data.datadog.startUrlOverride || '',
        defaultEnvironment: data.environmentName || 'UAT',
        customVariables: data.customVariables || {},
      };
    }

    syntheticCase = await prisma.testCase.create({
      data: {
        display_id: displayId,
        project_id: actualProjectId,
        title: data.name,
        description: `Auto-generated external test case for ${data.provider === 'postman' ? 'Postman' : 'Datadog Synthetics'} execution.`,
        priority: 'P2',
        type: 'AUTO',
        status: 'ACTIVE',
        tags: [data.provider === 'postman' ? 'Postman' : 'Datadog'],
        labels: [],
        steps: [],
        custom_fields: customFields,
        external_ref: externalKey,
        created_by: userId,
      },
      select: { id: true, display_id: true, title: true, custom_fields: true },
    });
  } else {
    // Update custom_fields if config changed
    const existingFields =
      syntheticCase.custom_fields && typeof syntheticCase.custom_fields === 'object'
        ? { ...(syntheticCase.custom_fields as Record<string, any>) }
        : {};
    if (data.provider === 'postman' && data.postman) {
      // A case is linked to exactly one external provider. Running/linking another
      // provider replaces the previous link so the UI never shows both.
      delete existingFields._datadog;
      existingFields._postman = {
        ...(existingFields._postman || {}),
        collectionUid: data.postman.collectionUid,
        folderOrRequestFilter: data.postman.folderOrRequestFilter || '',
        selectedRequestOrders: data.postman.selectedRequestOrders || [],
        postmanEnvUidOverride: data.postman.postmanEnvUidOverride || '',
        customVariables: data.customVariables || existingFields._postman?.customVariables || {},
        delayMs: data.postman.delayMs ?? 0,
        timeoutMs: data.postman.timeoutMs ?? 15000,
        maxLatencyMs: data.postman.maxLatencyMs,
        bailOnFailure: Boolean(data.postman.bailOnFailure),
        persistResponses: data.postman.persistResponses !== false,
        turnOffLogs: Boolean(data.postman.turnOffLogs),
        keepVariableValues: data.postman.keepVariableValues !== false,
        ignoreCookies: Boolean(data.postman.ignoreCookies),
        saveCookies: data.postman.saveCookies !== false,
      };
    } else if (data.provider === 'datadog' && data.datadog) {
      delete existingFields._postman;
      existingFields._datadog = {
        publicIds: data.datadog.publicIds,
        executionRule: data.datadog.executionRule || 'blocking',
        delayMs: data.datadog.delayMs ?? 0,
        retryCount: data.datadog.retryCount ?? 0,
        startUrlOverride: data.datadog.startUrlOverride || '',
        defaultEnvironment:
          data.environmentName || existingFields._datadog?.defaultEnvironment || 'UAT',
        customVariables:
          data.customVariables || existingFields._datadog?.customVariables || {},
      };
    }
    await prisma.testCase
      .update({
        where: { id: syntheticCase.id },
        data: { custom_fields: existingFields, title: data.name },
      })
      .catch(() => {});
  }

  // Populate the synthetic case's steps so provider executions render per-step in
  // the execution console. Step orders are chosen to match the run's step_results keys
  // (Datadog: 1..n by selection order; Postman: the collection request order).
  // Only ever touches this auto-generated external case (matched by external_ref),
  // never manually authored cases.
  try {
    const projectRow = await prisma.project.findUnique({
      where: { id: actualProjectId },
      select: { workspace_id: true },
    });

    let stepSpecs: Array<{ order: number; step: string; expectedResult: string }> = [];

    if (data.provider === 'datadog' && data.datadog?.publicIds?.length && projectRow) {
      const nameByPublicId: Record<string, string> = {};
      const row = await prisma.integration.findUnique({
        where: {
          workspace_id_provider: { workspace_id: projectRow.workspace_id, provider: 'datadog' },
        },
      });
      if (row?.enabled) {
        const cfg = decryptToolConfig(row.config as any) as DatadogIntegrationConfig;
        const meta = await testDatadogConnection(cfg).catch(() => null);
        for (const t of meta?.meta?.tests || []) nameByPublicId[t.public_id] = t.name;
      }
      stepSpecs = data.datadog.publicIds.map((pid, idx) => ({
        order: idx + 1,
        step: `Run Datadog Synthetic: ${nameByPublicId[pid] || pid}`,
        expectedResult: 'Datadog Synthetic test passes',
      }));
    } else if (data.provider === 'postman' && data.postman?.collectionUid && projectRow) {
      const nameByOrder: Record<number, string> = {};
      const row = await prisma.integration.findUnique({
        where: {
          workspace_id_provider: { workspace_id: projectRow.workspace_id, provider: 'postman' },
        },
      });
      if (row?.enabled) {
        const cfg = decryptToolConfig(row.config as any) as PostmanIntegrationConfig;
        const items = await listPostmanCollectionRequests(cfg, data.postman.collectionUid).catch(() => []);
        for (const it of items) nameByOrder[it.order] = it.name;
      }
      const collectionOrders =
        data.postman.selectedRequestOrders && data.postman.selectedRequestOrders.length > 0
          ? [...data.postman.selectedRequestOrders].sort((a, b) => a - b)
          : Object.keys(nameByOrder).map(Number).sort((a, b) => a - b);
      // Postman step_results keys are a sequential counter over the executed
      // (selected) requests in collection order, not the raw collection order.
      stepSpecs = collectionOrders.map((cOrder, idx) => ({
        order: idx + 1,
        step: `Execute Postman request: ${nameByOrder[cOrder] || `#${cOrder}`}`,
        expectedResult: 'Request assertions pass',
      }));
    }

    if (stepSpecs.length > 0) {
      const caseId = syntheticCase.id;
      await prisma.$transaction(async (tx) => {
        await tx.testCaseStep.deleteMany({ where: { test_case_id: caseId } });
        await tx.testCaseStep.createMany({
          data: stepSpecs.map((s) => ({
            test_case_id: caseId,
            order: s.order,
            step: s.step,
            expected_result: s.expectedResult,
            data: null,
            is_outdated: false,
          })),
        });
      });
    }
  } catch {
    // Step metadata is best-effort; execution still proceeds.
  }

  // Now trigger execution via the existing action
  const result = await executeTestCaseExternalRunnerAction({
    projectId: actualProjectId,
    testCaseId: syntheticCase.id,
    provider: data.provider,
    environmentName: data.environmentName,
    customVariables: data.customVariables,
    recordInTestRuns: true,
    saveLinkToCase: false,
    postman: data.postman
      ? {
          collectionUid: data.postman.collectionUid,
          folderOrRequestFilter: data.postman.folderOrRequestFilter,
          selectedRequestOrders: data.postman.selectedRequestOrders,
          postmanEnvUidOverride: data.postman.postmanEnvUidOverride,
          iterations: data.postman.iterations,
          delayMs: data.postman.delayMs,
          timeoutMs: data.postman.timeoutMs,
          maxLatencyMs: data.postman.maxLatencyMs,
          bailOnFailure: data.postman.bailOnFailure,
          persistResponses: data.postman.persistResponses,
          turnOffLogs: data.postman.turnOffLogs,
          keepVariableValues: data.postman.keepVariableValues,
          ignoreCookies: data.postman.ignoreCookies,
          saveCookies: data.postman.saveCookies,
        }
      : undefined,
    datadog: data.datadog
      ? {
          publicIds: data.datadog.publicIds,
          executionRule: data.datadog.executionRule,
          startUrlOverride: data.datadog.startUrlOverride,
          delayMs: data.datadog.delayMs,
          retryCount: data.datadog.retryCount,
        }
      : undefined,
  });

  return result;
}

/**
 * Fast external run creation. Only already-imported TestCases can be run — this
 * action never creates cases. It inserts the TestRun + PENDING RunResults and
 * either leaves them READY or (explicit Create & Start) submits them to the
 * server-side execution coordinator.
 */
export async function createExternalRunFromCasesAction(data: {
  projectId: string;
  name: string;
  /** 'postman' | 'datadog' narrows the picker; a run may still contain both. */
  source?: 'postman' | 'datadog';
  environmentName?: string;
  caseIds: string[];
  /**
   * Explicit "Create & Start". When false the run is persisted in a READY state
   * and only executes when the user presses Start on the Run Deck.
   */
  startImmediately?: boolean;
  config?: {
    customVariables?: Record<string, string>;
    /** Stop the run after the first failing case (default: continue). */
    stopOnFirstFailure?: boolean;
    /** Delay between cases. Applies to the Postman lane only. */
    interTestDelayMs?: number;
    postman?: {
      postmanEnvUidOverride?: string;
      iterations?: number;
      delayMs?: number;
      timeoutMs?: number;
      maxLatencyMs?: number;
      bailOnFailure?: boolean;
      persistResponses?: boolean;
      turnOffLogs?: boolean;
      keepVariableValues?: boolean;
      ignoreCookies?: boolean;
      saveCookies?: boolean;
    };
    datadog?: {
      executionRule?: 'blocking' | 'non_blocking' | 'skipped';
      startUrlOverride?: string;
      delayMs?: number;
      retryCount?: number;
      /**
       * Datadog lane: 'together' (default) runs up to `concurrency` tests at
       * the same time; 'sequential' runs them one by one.
       */
      mode?: 'together' | 'sequential';
      concurrency?: number;
    };
  };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const caseIds = Array.from(new Set((data.caseIds || []).filter(Boolean)));
  if (caseIds.length === 0) throw new Error('Select at least one linked test case to run.');

  const cases = await prisma.testCase.findMany({
    where: { id: { in: caseIds }, project_id: actualProjectId, deleted_at: null },
    select: { id: true, custom_fields: true, type: true },
  });
  if (cases.length === 0) throw new Error('None of the selected cases are available in this project.');

  // Every selected case must have an in-app runner. The provider of each case
  // decides which execution lane it belongs to, so one run can carry both a
  // Postman lane and a Datadog lane.
  const providerByCaseId = new Map<string, 'postman' | 'datadog'>();
  for (const c of cases) {
    const source = getCaseAutomationSource({
      type: c.type,
      custom_fields: c.custom_fields,
    });
    if (source === 'postman' || source === 'datadog') providerByCaseId.set(c.id, source);
  }

  // Preserve the user's selection order: execution follows the list order.
  const providerLinked = cases
    .filter((c) => providerByCaseId.has(c.id))
    .sort((a, b) => caseIds.indexOf(a.id) - caseIds.indexOf(b.id));
  if (providerLinked.length === 0) {
    throw new Error(
      'None of the selected cases are linked to Postman or Datadog. Cases that run elsewhere are recorded manually.'
    );
  }

  const providers = new Set(
    providerLinked.map((c) => providerByCaseId.get(c.id) as 'postman' | 'datadog')
  );
  const runSource =
    providers.size > 1 ? 'mixed' : (providers.values().next().value as 'postman' | 'datadog');

  const runId = await generateTestRunId();
  const now = new Date();
  const environment = (data.environmentName || 'UAT').toUpperCase();

  // Postman runs must resolve through the project's explicit environment mapping.
  // Fail loudly rather than silently auto-discovering a different Postman env.
  if (providers.has('postman')) {
    const projectRow = await prisma.project.findUnique({
      where: { id: actualProjectId },
      select: { workspace_id: true },
    });
    const integration = projectRow
      ? await prisma.integration.findUnique({
          where: {
            workspace_id_provider: {
              workspace_id: projectRow.workspace_id,
              provider: 'postman',
            },
          },
        })
      : null;
    const toolConfig =
      integration?.enabled && integration.config
        ? (decryptToolConfig(integration.config as Record<string, any>) as PostmanIntegrationConfig)
        : undefined;
    if (!toolConfig?.envMapping?.[environment]) {
      throw new Error(
        `No Postman environment is mapped for ${environment}. Map it in Settings → Integrations before starting the run.`
      );
    }
  }

  await prisma.testRun.create({
    data: {
      id: runId,
      project_id: actualProjectId,
      name: data.name,
      environment,
      status: 'IN_PROGRESS',
      source: runSource,
      started_at: now,
      created_by: userId,
      resolved_variables: (data.config?.customVariables || {}) as any,
      run_context: {
        external: true,
        provider: runSource,
        config: data.config || {},
      } as any,
      results: {
        create: providerLinked.map((c, index) => ({
          test_case_id: c.id,
          order_index: index,
          status: 'PENDING' as const,
          source: 'automated',
          provider: providerByCaseId.get(c.id),
        })),
      },
    },
  });

  let startError: string | null = null;
  if (data.startImmediately) {
    try {
      await startRunCases({ runId, actorId: userId, mode: 'start' });
    } catch (e: any) {
      // The run exists; surface the start failure without losing the created run.
      startError = e?.message || 'Run was created but could not be started';
    }
  }

  revalidatePath('/p');

  return {
    createdRunId: runId,
    startError,
    createdRun: {
      id: runId,
      projectId: actualProjectId,
      suiteId: null,
      releaseId: null,
      suiteName: null,
      name: data.name,
      environment,
      buildVersion: null,
      assignedTo: null,
      status: 'in_progress',
      source: runSource,
      startedAt: now.toISOString(),
      completedAt: undefined,
      createdBy: userId,
      createdAt: now.toISOString(),
      resolved_variables: data.config?.customVariables || {},
      results: providerLinked.map((c) => ({
        testCaseId: c.id,
        test_case_id: c.id,
        status: 'pending',
        timeSpentSeconds: 0,
      })),
    },
  };
}

/**
 * Queue one or more pending cases for an external run through the server-side
 * execution coordinator. With no ids this starts every eligible NOT_RUN case
 * (Start run / Start remaining); with ids it starts a single case without
 * touching the others. Duplicate/concurrent calls are idempotent because the
 * queue transition is a single conditional DB update.
 */
export async function startExternalRunCasesAction(runId: string, resultIds?: string[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  // Tenant guard: run ids are not authorisation.
  await requireProjectMemberByRunId(runId, userId);
  const result = await startRunCases({
    runId,
    actorId: userId,
    resultIds,
    mode: 'start',
  });
  revalidatePath('/p');
  revalidatePath(`/p/runs/${runId}`);
  return { ok: true, queued: result.queued, lifecycle: result.lifecycle };
}

/**
 * Resume a stopped run: every case that the stop cancelled gets a fresh
 * attempt, so the previous attempts stay in the history.
 */
export async function resumeExternalRunCasesAction(runId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, userId);
  const result = await startRunCases({
    runId,
    actorId: userId,
    mode: 'resume',
  });
  revalidatePath('/p');
  revalidatePath(`/p/runs/${runId}`);
  return {
    ok: true,
    queued: result.queued,
    skipped: result.skipped,
    generation: result.generation,
    lifecycle: result.lifecycle,
  };
}

/**
 * Rerun failed / rerun all through the coordinator. Both create new attempts;
 * previous attempts and evidence stay in history.
 */
export async function rerunRunCasesAction(
  runId: string,
  mode: 'rerun-failed' | 'rerun-all',
  resultIds?: string[]
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, userId);
  const result = await startRunCases({
    runId,
    actorId: userId,
    resultIds,
    mode,
  });
  revalidatePath('/p');
  revalidatePath(`/p/runs/${runId}`);
  return {
    ok: true,
    queued: result.queued,
    skipped: result.skipped,
    generation: result.generation,
    lifecycle: result.lifecycle,
  };
}

/**
 * Durable scheduler entry point. Safe to call from the browser, cron or the
 * backend worker: it never dispatches a duplicate (DB lease + atomic claim).
 * The browser no longer needs to call it; the backend worker owns progression.
 */
export async function executeExternalRunAction(runId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, userId);
  return tickRun(runId, { actorId: userId });
}

/**
 * Stop an automated run. `abort` additionally terminates the run explicitly.
 * In-flight provider executions keep being reconciled: a valid late result is
 * preserved instead of being discarded.
 */
export async function stopRunExecutionAction(runId: string, abort = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunId(runId, userId);
  const result = await stopRun({ runId, actorId: userId, abort });
  revalidatePath('/p');
  revalidatePath(`/p/runs/${runId}`);
  return result;
}

/**
 * Execute a single case from the Execution Console. The coordinator claims the
 * attempt (or creates a new one when the current attempt is terminal), so the
 * console can never bypass queue ownership or overwrite provider evidence.
 */
export async function executeRunCaseAction(data: {
  runId: string;
  resultId: string;
  overrides?: {
    provider?: 'postman' | 'datadog';
    customVariables?: Record<string, string>;
    datasetParams?: Record<string, string>;
    postman?: Record<string, any>;
    datadog?: Record<string, any>;
  };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  await requireProjectMemberByRunId(data.runId, userId);
  const result = await executeRunCase({
    runId: data.runId,
    resultId: data.resultId,
    actorId: userId,
    overrides: data.overrides,
  });
  revalidatePath('/p');
  revalidatePath(`/p/runs/${data.runId}`);
  return result;
}

/**
 * Link an existing (typically manually created) case to a stable external key.
 * A case is linked to exactly one provider: writing one marker deletes the other.
 */
export async function linkTestCaseToExternalSourceAction(data: {
  projectId: string;
  testCaseId: string;
  provider: 'postman' | 'datadog';
  postman?: {
    collectionUid: string;
    collectionName?: string;
    requestId?: string;
    folderId?: string;
    requestName?: string;
    folderPath?: string;
    order?: number;
    selectedRequestOrders?: number[];
    curlCommand?: string;
    requestSpec?: any;
  };
  datadog?: {
    publicId: string;
    name?: string;
    testType?: 'api' | 'browser';
  };
  /**
   * When the external key is already linked to another case, pass that case's
   * id to move the link here instead of blocking.
   */
  moveLinkFromCaseId?: string;
}): Promise<
  | { linkKey: string; stepsCount: number; movedFromCaseId?: string }
  | {
      blocked: true;
      linkKey: string;
      conflict: { caseId: string; displayId: string; title: string };
    }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const tc = await prisma.testCase.findFirst({
    where: { id: data.testCaseId, project_id: actualProjectId, deleted_at: null },
    select: { id: true, custom_fields: true },
  });
  if (!tc) throw new Error('Test case not found');

  const customFields =
    tc.custom_fields && typeof tc.custom_fields === 'object'
      ? { ...(tc.custom_fields as Record<string, any>) }
      : {};

  let linkKey = '';
  if (data.provider === 'postman') {
    const pm = data.postman;
    if (!pm?.collectionUid) throw new Error('Select a Postman collection first.');
    linkKey = pm.requestId
      ? `postman:${pm.collectionUid}:request:${pm.requestId}`
      : pm.folderId
        ? `postman:${pm.collectionUid}:folder:${pm.folderId}`
        : `postman:${pm.collectionUid}`;
    customFields._postman = {
      collectionUid: pm.collectionUid,
      collectionName: pm.collectionName,
      requestId: pm.requestId,
      folderId: pm.folderId,
      requestName: pm.requestName,
      folderPath: pm.folderPath,
      folderOrRequestFilter: pm.requestId ? undefined : pm.folderPath || pm.collectionName,
      selectedRequestOrders:
        pm.selectedRequestOrders && pm.selectedRequestOrders.length > 0
          ? pm.selectedRequestOrders
          : pm.order
            ? [pm.order]
            : undefined,
      curlCommand: pm.curlCommand,
      requestSpec: pm.requestSpec,
      linkKey,
      source: 'manual_link',
    };
    delete customFields._datadog;
  } else {
    const dd = data.datadog;
    if (!dd?.publicId) throw new Error('Select a Datadog Synthetic test first.');
    linkKey = `datadog:${dd.publicId}`;
    customFields._datadog = {
      publicIds: [dd.publicId],
      testType: dd.testType || 'api',
      executionRule: 'blocking',
      delayMs: 0,
      source: 'manual_link',
      linkKey,
    };
    delete customFields._postman;
  }

  /* ── External key uniqueness ─────────────────────────────────────────
     One external test maps to one case. Without this check two cases can point
     at the same Postman request / Datadog test, and a run then reports the same
     provider result twice. */
  const conflictFilters: any[] = [
    { custom_fields: { path: ['_postman', 'linkKey'], equals: linkKey } },
    { custom_fields: { path: ['_datadog', 'linkKey'], equals: linkKey } },
  ];
  if (data.provider === 'datadog' && data.datadog?.publicId) {
    conflictFilters.push({
      custom_fields: { path: ['_datadog', 'publicIds'], array_contains: [data.datadog.publicId] },
    });
  }

  const conflicting = await prisma.testCase.findFirst({
    where: {
      project_id: actualProjectId,
      deleted_at: null,
      id: { not: tc.id },
      OR: conflictFilters,
    },
    select: { id: true, display_id: true, title: true, custom_fields: true },
  });

  if (conflicting && conflicting.id !== data.moveLinkFromCaseId) {
    return {
      blocked: true as const,
      linkKey,
      conflict: {
        caseId: conflicting.id,
        displayId: conflicting.display_id,
        title: conflicting.title,
      },
    };
  }

  let movedFromCaseId: string | undefined;
  if (conflicting) {
    // "Move link…" — detach the key from the other case, keeping everything
    // else it has (datasets, steps, history) intact.
    const otherFields =
      conflicting.custom_fields && typeof conflicting.custom_fields === 'object'
        ? { ...(conflicting.custom_fields as Record<string, any>) }
        : {};
    if (data.provider === 'postman') delete otherFields._postman;
    else delete otherFields._datadog;
    await prisma.testCase.update({
      where: { id: conflicting.id },
      data: { custom_fields: otherFields, updated_by: userId },
    });
    movedFromCaseId = conflicting.id;
  }

  await prisma.testCase.update({
    where: { id: tc.id },
    data: { custom_fields: customFields, updated_by: userId },
  });

  // Datadog has no assertion-level "sync" endpoint of its own; pull the current
  // definition immediately so the linked case never stays at zero steps.
  let stepsCount = 0;
  if (data.provider === 'datadog' && data.datadog?.publicId) {
    const synced = await syncTestCaseFromDatadogAction({
      projectId: actualProjectId,
      testCaseId: tc.id,
    });
    stepsCount = synced.stepsCount;
  }

  revalidatePath('/p');
  return { linkKey, stepsCount, movedFromCaseId };
}

/**
 * Re-pull steps from the linked Datadog Synthetic test definition, overwriting
 * the case's current steps. Callers confirm first when steps were edited.
 */
export async function syncTestCaseFromDatadogAction(data: {
  projectId: string;
  testCaseId: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const tc = await prisma.testCase.findFirst({
    where: { id: data.testCaseId, project_id: actualProjectId, deleted_at: null },
    select: { id: true, custom_fields: true },
  });
  if (!tc) throw new Error('Test case not found');

  const savedDatadog = (tc.custom_fields as any)?._datadog;
  const savedPublicIds: string[] = Array.isArray(savedDatadog?.publicIds)
    ? Array.from(
        new Set(
          savedDatadog.publicIds
            .filter((id: any) => typeof id === 'string')
            .map((id: string) => id.trim())
            .filter(Boolean)
        )
      )
    : [];
  const publicId = savedPublicIds[0];
  if (!publicId) {
    throw new Error('This test case does not have a Datadog Synthetic test linked yet.');
  }
  if (savedPublicIds.length > 1) {
    throw new Error(
      'This legacy case is linked to multiple Datadog tests. Import each Datadog test as its own case.'
    );
  }

  const definitions = await fetchDatadogTestDefinitionsAction({
    projectId: actualProjectId,
    publicIds: [publicId],
  });
  const definition = definitions.find((d) => d.public_id === publicId) || definitions[0];
  if (!definition) {
    throw new Error('Could not load the linked Datadog Synthetic test definition.');
  }

  // One repository case maps to exactly one Datadog test. Keep its real steps;
  // nested subtests are expanded inside buildDatadogSteps.
  const builtByDefinition = definitions.map((d) => ({ definition: d, built: buildDatadogSteps(d) }));
  const steps = builtByDefinition
    .flatMap(({ built }) => built)
    .map((s, idx) => ({ ...s, order: idx + 1 }));

  if (steps.length === 0) {
    throw new Error(
      'The linked Datadog test has no assertions or steps, so no test steps can be created.'
    );
  }

  const preConditions = builtByDefinition
    .map(({ definition, built }) => buildDatadogPreConditions(definition, built))
    .filter(Boolean)
    .join('\n\n');

  const customFields =
    tc.custom_fields && typeof tc.custom_fields === 'object'
      ? { ...(tc.custom_fields as Record<string, any>) }
      : {};
  customFields._datadog = {
    ...(customFields._datadog || {}),
    publicIds: [publicId],
    testType: definition.type,
    linkKey: `datadog:${publicId}`,
    lastSyncedAt: new Date().toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    await tx.testCaseStep.deleteMany({ where: { test_case_id: tc.id } });
    await tx.testCaseStep.createMany({
      data: steps.map((s) => ({
        test_case_id: tc.id,
        order: s.order,
        step: s.step,
        expected_result: s.expectedResult,
        data: s.data || null,
        meta: s.meta || null,
        is_outdated: false,
      })),
    });
    await tx.testCase.update({
      where: { id: tc.id },
      data: { custom_fields: customFields, pre_conditions: preConditions || undefined, updated_by: userId },
    });
  });

  revalidatePath('/p');
  return { stepsCount: steps.length, name: definition.name, steps };
}

export async function syncTestCaseFromPostmanAction(data: {
  projectId: string;
  testCaseId: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  const [project, tc] = await Promise.all([
    prisma.project.findUnique({
      where: { id: actualProjectId },
      select: { id: true, workspace_id: true },
    }),
    prisma.testCase.findUnique({
      where: { id: data.testCaseId },
      select: { id: true, title: true, custom_fields: true },
    }),
  ]);

  if (!project || !tc) throw new Error('Test case not found');

  const savedPostman = (tc.custom_fields as any)?._postman;
  if (!savedPostman?.collectionUid) {
    throw new Error('This test case does not have a Postman Collection linked yet.');
  }

  const integrationRow = await prisma.integration.findUnique({
    where: {
      workspace_id_provider: {
        workspace_id: project.workspace_id,
        provider: 'postman',
      },
    },
  });
  if (!integrationRow || !integrationRow.enabled) {
    throw new Error('Postman integration is not enabled for this workspace.');
  }

  const cfg = decryptToolConfig(integrationRow.config as any) as PostmanIntegrationConfig;
  const allRequests = await listPostmanCollectionRequests(cfg, savedPostman.collectionUid);
  if (allRequests.length === 0) {
    throw new Error('Could not load requests from the linked Postman collection.');
  }

  const selectedSet =
    Array.isArray(savedPostman.selectedRequestOrders) &&
    savedPostman.selectedRequestOrders.length > 0
      ? new Set<number>(savedPostman.selectedRequestOrders)
      : null;
  const folderFilter = String(savedPostman.folderOrRequestFilter || '').trim().toLowerCase();

  const matchedRequests = allRequests.filter((r) => {
    if (selectedSet && selectedSet.has(r.order)) return true;
    if (!selectedSet && folderFilter) {
      const fullPath = r.folderPath ? `${r.folderPath} / ${r.name}` : r.name;
      return (
        r.folderPath.toLowerCase().includes(folderFilter) ||
        fullPath.toLowerCase().includes(folderFilter)
      );
    }
    return !selectedSet && !folderFilter;
  });

  const targetRequests = matchedRequests.length > 0 ? matchedRequests : allRequests;
  const formattedSteps = targetRequests.flatMap((req, idx) =>
    formatPostmanRequestAsStep(req, idx + 1)
  );

  const folderName =
    savedPostman.folderOrRequestFilter ||
    targetRequests[0]?.folderPath ||
    savedPostman.collectionName ||
    'API Flow';
  const nextTitle =
    targetRequests.length === 1
      ? targetRequests[0].name
      : buildJourneyCaseTitle(
          folderName,
          targetRequests,
          savedPostman.collectionName || 'API Automation'
        );

  const mergedRequiredVars = Array.from(
    new Set(targetRequests.flatMap((r) => r.requiredVariables || []))
  );
  const existingCustomFields =
    tc.custom_fields && typeof tc.custom_fields === 'object'
      ? { ...(tc.custom_fields as Record<string, any>) }
      : {};
  existingCustomFields._postman = {
    ...(existingCustomFields._postman || {}),
    requiredVariables: mergedRequiredVars,
    curlCommand:
      targetRequests.length === 1
        ? targetRequests[0].curlCommand
        : targetRequests
            .map((r, i) => (r.curlCommand ? `# Step ${i + 1}: ${r.name}\n${r.curlCommand}` : ''))
            .filter(Boolean)
            .join('\n\n'),
    requestSpec: targetRequests[0]?.requestSpec,
    requestSpecs: targetRequests.map((r) => r.requestSpec).filter(Boolean),
  };

  await prisma.$transaction(async (tx) => {
    await tx.testCase.update({
      where: { id: tc.id },
      data: {
        title: nextTitle,
        post_conditions: null,
        custom_fields: existingCustomFields,
        updated_by: userId,
      },
    });
    await tx.testCaseStep.deleteMany({
      where: { test_case_id: tc.id },
    });
    await tx.testCaseStep.createMany({
      data: formattedSteps.map((s) => ({
        test_case_id: tc.id,
        order: s.order,
        step: s.step,
        expected_result: s.expectedResult,
        data: s.data || null,
        is_outdated: false,
      })),
    });
  });

  revalidatePath('/p');
  return {
    title: nextTitle,
    stepsCount: formattedSteps.length,
    steps: formattedSteps,
  };
}


export interface ExternalImportCaseInput {
  title: string;
  description?: string;
  preConditions?: string;
  postConditions?: string;
  expectedResult?: string;
  steps: Array<{
    order?: number;
    step?: string;
    description?: string;
    expectedResult?: string;
    expected_result?: string;
    data?: string;
    meta?: string;
    reusableStepId?: string | null;
  }>;
  priority?: string;
  type?: string;
  status?: string;
  suggestedTags?: string[];
  labels?: string[];
  scenarioType?: string;
  moduleId?: string | null;
  customFields?: Record<string, any>;
  aiGenerated?: boolean;
}

export interface ExternalImportSkipped {
  title: string;
  displayId: string;
  linkKey: string;
}

/**
 * Idempotent import of Postman / Datadog cases.
 *
 * The client hides and disables already-linked items, but the server is the
 * authority: any case whose stable provider key already exists in the project
 * is skipped and reported back, so re-running an import never duplicates data.
 */
export async function importExternalTestCasesAction(data: {
  projectId: string;
  cases: ExternalImportCaseInput[];
  /** Optional destination suite: imported cases are linked in import order. */
  suiteId?: string;
}): Promise<{ created: any[]; skipped: ExternalImportSkipped[] }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(data.projectId, userId);

  // Resolve the destination suite up front: a stale or cross-project id must
  // fail loudly instead of silently importing unlinked cases.
  let suiteId: string | null = null;
  let nextSuiteOrder = 0;
  if (data.suiteId) {
    const suite = await prisma.testSuite.findFirst({
      where: { id: data.suiteId, project_id: actualProjectId, deleted_at: null },
      select: { id: true },
    });
    if (!suite) throw new Error('Suite not found in this project');
    suiteId = suite.id;
    const maxOrder = await prisma.suiteCase.aggregate({
      where: { suite_id: suite.id },
      _max: { order_index: true },
    });
    nextSuiteOrder = (maxOrder._max.order_index ?? -1) + 1;
  }

  const existing = await prisma.testCase.findMany({
    where: { project_id: actualProjectId, deleted_at: null },
    select: { id: true, display_id: true, title: true, custom_fields: true },
  });

  const existingByKey = new Map<string, { id: string; displayId: string; title: string }>();
  for (const row of existing) {
    const ref = {
      id: row.id,
      displayId: row.display_id,
      title: row.title,
    };
    for (const key of getExternalLinkKeys(row)) {
      if (key && !existingByKey.has(key)) existingByKey.set(key, ref);
    }
  }

  const created: any[] = [];
  const skipped: ExternalImportSkipped[] = [];

  for (const incoming of data.cases || []) {
    const keys = getExternalLinkKeys(incoming.customFields || {});
    const duplicateKey = keys.find((key) => existingByKey.has(key));

    if (duplicateKey) {
      const duplicate = existingByKey.get(duplicateKey)!;
      skipped.push({
        title: incoming.title,
        displayId: duplicate.displayId,
        linkKey: duplicateKey,
      });
      continue;
    }

    const priority = ['P0', 'P1', 'P2', 'P3'].includes(
      String(incoming.priority || '').toUpperCase()
    )
      ? String(incoming.priority).toUpperCase()
      : 'P1';
    const scenarioType = ['positive', 'negative', 'edge_case', 'boundary'].includes(
      String(incoming.scenarioType || '').toLowerCase()
    )
      ? String(incoming.scenarioType).toLowerCase()
      : 'positive';

    const resolvedModuleId =
      incoming.moduleId && incoming.moduleId !== 'auto' && incoming.moduleId.trim() !== ''
        ? incoming.moduleId.trim()
        : null;

    const saved = await createTestCaseAction({
      projectId: actualProjectId,
      moduleId: resolvedModuleId,
      title: incoming.title,
      description: incoming.description,
      preConditions: incoming.preConditions,
      postConditions: incoming.postConditions,
      expectedResult: incoming.expectedResult,
      steps: (incoming.steps || []).map((step, index) => ({
        ...step,
        order: step.order ?? index + 1,
      })),
      priority,
      type: incoming.type || 'auto',
      status: incoming.status || 'active',
      tags: incoming.suggestedTags || [],
      labels: incoming.labels || [],
      scenarioType,
      customFields: incoming.customFields || {},
      aiGenerated: incoming.aiGenerated ?? false,
    });

    if (keys.length > 0) {
      const ref = { id: saved.id, displayId: saved.display_id, title: saved.title };
      for (const key of keys) {
        if (key && !existingByKey.has(key)) existingByKey.set(key, ref);
      }
    }

    // Link into the chosen suite in import order. Duplicates skipped above are
    // deliberately left alone: their suite membership is existing state.
    if (suiteId) {
      await prisma.suiteCase.create({
        data: {
          suite_id: suiteId,
          test_case_id: saved.id,
          order_index: nextSuiteOrder++,
        },
      });
    }

    created.push({
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
    });
  }

  revalidatePath('/p');
  return { created, skipped };
}

export async function fetchConfluencePageAction(projectId: string, pageUrl: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectId, userId);

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { workspace_id: true }
  });
  if (!project) throw new Error('Project not found');

  const integration = await prisma.integration.findUnique({
    where: { workspace_id_provider: { workspace_id: project.workspace_id, provider: 'confluence' } }
  });
  if (!integration || !integration.enabled) throw new Error('Confluence integration not configured or enabled.');

  const config = decryptToolConfig(integration.config as any);
  try {
    return await fetchConfluencePageContent(config as any, pageUrl);
  } catch (err) {
    logger.error('Confluence page import failed', {
      module: 'Integrations',
      action: 'fetchConfluencePageAction',
      projectId: actualProjectId,
      error: err,
    });
    throw err;
  }
}

export async function fetchNotionPageAction(projectId: string, pageUrl: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectMember(projectId, userId);

  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    select: { workspace_id: true }
  });
  if (!project) throw new Error('Project not found');

  const integration = await prisma.integration.findUnique({
    where: { workspace_id_provider: { workspace_id: project.workspace_id, provider: 'notion' } }
  });
  if (!integration || !integration.enabled) throw new Error('Notion integration not configured or enabled.');

  const config = decryptToolConfig(integration.config as any);
  return fetchNotionPageContent(config as any, pageUrl);
}
