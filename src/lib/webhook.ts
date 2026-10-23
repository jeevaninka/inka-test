import { prisma } from '@/lib/db';
import crypto from 'crypto';
import { decrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';
import { validateDestinationUrl } from '@/lib/network/ssrf-guard';

export interface WebhookAttempt {
  attempt: number;
  statusCode: number;
  statusText: string;
  durationMs: number;
  timestamp: string;
  responseBody?: string;
  error?: string;
}

export async function deliverWebhookWithRetry(
  url: string,
  secret: string,
  bodyString: string,
  maxAttempts = 3
): Promise<{
  lastStatus: number | null;
  lastBody: string | null;
  attempts: WebhookAttempt[];
}> {
  const attempts: WebhookAttempt[] = [];
  let lastStatus: number | null = null;
  let lastBody: string | null = null;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const startTime = Date.now();
    let currentStatus: number | null = null;
    let currentBody: string | null = null;
    let currentError: string | undefined = undefined;

    try {
      const validatedUrl = await validateDestinationUrl(url);
      const hmac = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');

      const res = await fetch(validatedUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature-256': `sha256=${hmac}`,
          'X-Hub-Signature-256': `sha256=${hmac}`,
          'X-Webhook-Secret': secret,
          'User-Agent': 'InkaTest-Webhook/1.0',
        },
        body: bodyString,
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });

      currentStatus = res.status;
      currentBody = await res.text().catch(() => null);
    } catch (err: any) {
      currentStatus = 500;
      currentError = err.message || 'Network timeout or unreachable';
    }

    const durationMs = Date.now() - startTime;
    lastStatus = currentStatus;
    lastBody = currentBody;

    attempts.push({
      attempt: attemptNumber,
      statusCode: currentStatus,
      statusText: currentStatus >= 200 && currentStatus < 300 ? 'OK' : 'FAILED',
      durationMs,
      timestamp: new Date().toISOString(),
      responseBody: currentBody || undefined,
      error: currentError,
    });

    if (currentStatus >= 200 && currentStatus < 300) {
      break;
    }

    if (attemptNumber < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attemptNumber * 800));
    }
  }

  return { lastStatus, lastBody, attempts };
}

export async function triggerProjectWebhooks(projectId: string, eventType: string, payload: any) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, workspace_id: true },
    });

    const webhooks = await prisma.webhook.findMany({
      where: {
        enabled: true,
        events: { has: eventType },
        OR: [
          { project_id: projectId },
          ...(project?.workspace_id ? [{ workspace_id: project.workspace_id }] : []),
        ],
      },
    });

    await Promise.allSettled(
      webhooks.map(async (webhook) => {
        const body = JSON.stringify({ event: eventType, payload, sent_at: new Date().toISOString() });
        const secret = decrypt(webhook.secret);
        const { lastStatus, lastBody, attempts } = await deliverWebhookWithRetry(webhook.url, secret, body, 3);

        const isSuccess = lastStatus !== null && lastStatus >= 200 && lastStatus < 300;

        await prisma.webhookDelivery.create({
          data: {
            webhook_id: webhook.id,
            event_type: eventType,
            payload: {
              ...payload,
              _attempts: attempts,
            },
            response_status: lastStatus,
            response_body: lastBody,
            retry_count: attempts.length - 1,
            delivered_at: isSuccess ? new Date() : null,
          },
        }).catch(() => null);

        if (isSuccess) {
          logger.info('Outbound project webhook delivered', {
            module: 'WebhooksEgress',
            action: 'triggerProjectWebhooks',
            projectId,
            webhookId: webhook.id,
            eventType,
            status: lastStatus,
            attempts: attempts.length,
          });
          await prisma.webhook.update({
            where: { id: webhook.id },
            data: { last_delivery_at: new Date(), failure_count: 0 },
          }).catch(() => null);
        } else {
          logger.error('Outbound project webhook delivery failed', {
            module: 'WebhooksEgress',
            action: 'triggerProjectWebhooks',
            projectId,
            webhookId: webhook.id,
            eventType,
            status: lastStatus,
            attempts: attempts.length,
            errorCode: ErrorCodes.WEBHOOK_DELIVERY,
            error: attempts[attempts.length - 1]?.error || `Webhook endpoint returned HTTP ${lastStatus}`,
          });
          await prisma.webhook.update({
            where: { id: webhook.id },
            data: { failure_count: { increment: 1 } },
          }).catch(() => null);
        }

        const hostname = (() => {
          try {
            return new URL(webhook.url).hostname;
          } catch {
            return webhook.url;
          }
        })();

        const lastAttempt = attempts[attempts.length - 1];
        const attemptSuffix = attempts.length > 1 ? ` (${attempts.length} attempts)` : '';

        await prisma.activityLog.create({
          data: {
            project_id: projectId,
            actor_type: 'system',
            entity_type: 'webhook_egress',
            entity_id: webhook.id,
            action: isSuccess
              ? `Outbound Webhook: Delivered "${eventType}" to ${hostname} (HTTP ${lastStatus}) [${lastAttempt.durationMs}ms]${attemptSuffix}`
              : `Outbound Webhook Error: Delivery failed for "${eventType}" to ${hostname} after ${attempts.length} attempts (HTTP ${lastStatus || 500})`,
          },
        }).catch(() => null);
      })
    );
  } catch (err: any) {
    logger.error('Failed to process project webhooks', {
      module: 'WebhooksEgress',
      action: 'triggerProjectWebhooks',
      projectId,
      eventType,
      errorCode: ErrorCodes.WEBHOOK_DELIVERY,
      error: err,
    });
  }
}
