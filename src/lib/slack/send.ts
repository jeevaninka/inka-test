import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { ErrorCodes } from '@/lib/errors';

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: {
    type: string;
    text: string;
  }[];
  elements?: any[];
  accessory?: any;
}

export interface SlackPayload {
  text: string;
  blocks?: SlackBlock[];
  attachments?: any[];
}

export async function sendSlackWebhook(
  webhookUrl: string,
  payload: SlackPayload,
  context?: {
    projectId?: string;
    userId?: string;
    eventType?: string;
    recipientType?: 'channel' | 'dm';
  }
): Promise<{ success: boolean; status?: number; error?: string }> {
  if (!webhookUrl || !webhookUrl.trim()) {
    logger.warn('Slack notification skipped: empty webhook URL', {
      module: 'Notifications',
      channel: 'slack',
      action: 'sendSlackWebhook',
      ...context,
    });
    return { success: false, error: 'Empty webhook URL' };
  }

  const trimmedUrl = webhookUrl.trim();
  if (!trimmedUrl.startsWith('https://hooks.slack.com/services/') && !trimmedUrl.startsWith('https://hooks.slack.com/workflows/')) {
    logger.warn('Slack notification rejected: Invalid Slack webhook domain', {
      module: 'Notifications',
      channel: 'slack',
      action: 'sendSlackWebhook',
      ...context,
    });
    return { success: false, error: 'Invalid Slack webhook URL: must be a legitimate hooks.slack.com endpoint' };
  }

  const startTime = Date.now();

  try {
    const res = await fetch(webhookUrl.trim(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    const durationMs = Date.now() - startTime;
    const responseText = await res.text().catch(() => '');

    if (res.ok) {
      logger.info('Slack notification delivered', {
        module: 'Notifications',
        channel: 'slack',
        action: 'sendSlackWebhook',
        status: res.status,
        durationMs,
        ...context,
      });

      if (context?.projectId) {
        await prisma.activityLog.create({
          data: {
            project_id: context.projectId,
            actor_type: 'system',
            entity_type: 'integration_egress',
            entity_id: 'slack_notification',
            action: `Outbound Slack: Delivered notification for ${context.eventType || 'Event'} (HTTP ${res.status}) [${durationMs}ms]`,
          },
        }).catch(() => null);
      }

      return { success: true, status: res.status };
    } else {
      logger.warn('Slack notification delivery failed', {
        module: 'Notifications',
        channel: 'slack',
        action: 'sendSlackWebhook',
        status: res.status,
        response: responseText,
        durationMs,
        ...context,
      });

      if (context?.projectId) {
        await prisma.activityLog.create({
          data: {
            project_id: context.projectId,
            actor_type: 'system',
            entity_type: 'integration_egress',
            entity_id: 'slack_error',
            action: `Outbound Slack Error: Delivery failed for ${context.eventType || 'Event'} - HTTP ${res.status}`,
          },
        }).catch(() => null);
      }

      return { success: false, status: res.status, error: responseText || res.statusText };
    }
  } catch (err: any) {
    const durationMs = Date.now() - startTime;

    logger.error('Slack webhook request error', {
      module: 'Notifications',
      channel: 'slack',
      action: 'sendSlackWebhook',
      errorCode: ErrorCodes.SLACK_WEBHOOK,
      error: err,
      durationMs,
      ...context,
    });

    if (context?.projectId) {
      await prisma.activityLog.create({
        data: {
          project_id: context.projectId,
          actor_type: 'system',
          entity_type: 'integration_egress',
          entity_id: 'slack_network_error',
          action: `Outbound Slack Error: Connection failed - ${err.message || 'Network error'} (HTTP 500)`,
        },
      }).catch(() => null);
    }

    return { success: false, error: err.message };
  }
}
