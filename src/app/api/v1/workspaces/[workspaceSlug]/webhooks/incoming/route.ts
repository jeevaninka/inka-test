import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'crypto';
import { processStatusUpdate } from '@/lib/integrations/status-sync';
import { PmIntegrationConfig } from '@/lib/integrations/pm-client';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';

// In-memory idempotency cache: deliveryId / (ticketId + status) -> timestamp
const processedDeliveries = new Map<string, number>();

// Clean up entries older than 60 seconds
function cleanIdempotencyCache() {
  const now = Date.now();
  for (const [key, ts] of processedDeliveries.entries()) {
    if (now - ts > 60000) {
      processedDeliveries.delete(key);
    }
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string }> }
) {
  const startTime = Date.now();
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  cleanIdempotencyCache();

  try {
    const { workspaceSlug } = await params;
    const rawBody = await req.text();

    logger.debug('[Webhook] --> POST workspace incoming webhook', {
      module: 'WebhooksIngress',
      action: 'requestStart',
      requestId,
      workspaceSlug,
    });

    // 1. Resolve Workspace
    const workspace = await prisma.workspace.findFirst({
      where: {
        OR: [{ id: workspaceSlug }, { slug: workspaceSlug }],
      },
      include: {
        projects: { select: { id: true, slug: true, name: true } },
      },
    });

    if (!workspace) {
      logger.warn('[Webhook] Workspace not found', {
        module: 'WebhooksIngress',
        action: 'resolveWorkspace',
        requestId,
        workspaceSlug,
        status: 404,
      });
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404, headers: { 'x-request-id': requestId } });
    }

    const integration = await prisma.integration.findFirst({
      where: {
        workspace_id: workspace.id,
        provider: 'custom_pm',
        enabled: true,
      },
    });

    if (!integration) {
      logger.warn('[Webhook] PM tool integration not enabled', {
        module: 'WebhooksIngress',
        action: 'resolveIntegration',
        requestId,
        workspaceId: workspace.id,
        workspaceSlug,
        status: 404,
      });
      return NextResponse.json(
        { error: 'PM tool integration is not enabled at the workspace level' },
        { status: 404, headers: { 'x-request-id': requestId } }
      );
    }

    const config = (integration.config as any) as PmIntegrationConfig;

    // 2. Idempotency Check via X-Inkaboard-Delivery UUID
    const deliveryId =
      req.headers.get('x-inkaboard-delivery') ||
      req.headers.get('x-delivery-id') ||
      req.headers.get('x-request-id');

    if (deliveryId && processedDeliveries.has(deliveryId)) {
      return NextResponse.json({
        received: true,
        idempotent: true,
        message: 'Duplicate delivery skipped',
      });
    }

    // 3. Verify HMAC-SHA256 Signature (Mandatory Secret - Fail-Closed)
    if (!config.webhookSecret || !config.webhookSecret.trim()) {
      return NextResponse.json(
        { error: 'Inbound webhooks disabled: Webhook secret must be configured in integration settings.' },
        { status: 401 }
      );
    }

    const expectedSecret = config.webhookSecret.trim();
    const signature =
      req.headers.get('x-inkaboard-signature') ||
      req.headers.get('x-webhook-signature') ||
      req.headers.get('x-signature') ||
      req.headers.get('x-hub-signature-256');
    const directSecret =
      req.headers.get('x-webhook-secret') ||
      req.headers.get('x-api-secret') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    let isValid = false;

    if (signature) {
      const hmac = crypto.createHmac('sha256', expectedSecret);
      hmac.update(rawBody);
      const computed = hmac.digest('hex');
      const cleanSignature = signature.replace(/^sha256=/i, '');

      const compBuf = Buffer.from(computed);
      const sigBuf = Buffer.from(cleanSignature);
      if (compBuf.byteLength === sigBuf.byteLength && crypto.timingSafeEqual(compBuf, sigBuf)) {
        isValid = true;
      }
    } else if (directSecret) {
      const directBuf = Buffer.from(directSecret);
      const expBuf = Buffer.from(expectedSecret);
      if (directBuf.byteLength === expBuf.byteLength && crypto.timingSafeEqual(directBuf, expBuf)) {
        isValid = true;
      }
    }

    if (!isValid) {
      logger.warn('Workspace inbound webhook signature verification failed', {
        module: 'WebhooksIngress',
        action: 'verifyWorkspaceSignature',
        workspaceId: workspace.id,
        workspaceSlug,
      });

      const fallbackProjectId = workspace.projects[0]?.id;
      if (fallbackProjectId) {
        await prisma.activityLog.create({
          data: {
            project_id: fallbackProjectId,
            actor_type: 'webhook',
            action: `Inbound Webhook: Signature verification failed for workspace "${workspace.name}" (HTTP 401)`,
            entity_type: 'webhook_ingress',
            entity_id: 'auth_failed',
          },
        }).catch(() => null);
      }

      return apiErrorResponse(
        'Invalid or missing webhook signature/secret',
        401,
        ErrorCodes.WEBHOOK_SIGNATURE
      );
    }

    // 4. Parse JSON Payload
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // 5. Extract Ticket Identifier and Status
    const ticketId =
      payload.ticket_key ||
      payload.ticketKey ||
      payload.issue_key ||
      payload.issueKey ||
      payload.key ||
      payload.ticket?.key ||
      payload.issue?.key ||
      payload.data?.key ||
      payload.ticket_id ||
      payload.ticketId ||
      payload.ticket?.id ||
      payload.issue?.id ||
      payload.data?.id ||
      payload.id;

    const rawStatus =
      payload.new_status ||
      payload.newStatus ||
      payload.status?.name ||
      payload.status ||
      payload.ticket?.status?.name ||
      payload.ticket?.status ||
      payload.data?.status?.name ||
      payload.data?.status ||
      payload.data?.state?.name ||
      payload.data?.state ||
      payload.state ||
      payload.transition?.to;

    if (!ticketId || !rawStatus) {
      return NextResponse.json(
        {
          error: 'Payload must contain a ticket identifier and status',
          received: { ticketId, status: rawStatus },
        },
        { status: 400 }
      );
    }

    const ticketStatus = typeof rawStatus === 'object' ? rawStatus.name || JSON.stringify(rawStatus) : String(rawStatus);
    const dedupeKey = `${ticketId}:${ticketStatus}`;

    if (processedDeliveries.has(dedupeKey)) {
      const prevTs = processedDeliveries.get(dedupeKey)!;
      if (Date.now() - prevTs < 5000) {
        return NextResponse.json({
          received: true,
          idempotent: true,
          message: 'Rapid duplicate event skipped',
        });
      }
    }

    if (deliveryId) processedDeliveries.set(deliveryId, Date.now());
    processedDeliveries.set(dedupeKey, Date.now());

    // 6. Cross-Project Defect Resolution (Resolves which project owns this defect)
    const matchingDefect = await prisma.defect.findFirst({
      where: {
        external_ticket_id: String(ticketId),
        run_result: {
          run: {
            project: { workspace_id: workspace.id },
          },
        },
      },
      include: {
        run_result: {
          include: {
            run: {
              include: {
                project: true,
              },
            },
          },
        },
      },
    });

    const targetProjectId = matchingDefect?.run_result.run.project.id || workspace.projects[0]?.id;
    const latencyMs = Date.now() - startTime;

    if (targetProjectId) {
      const updateResult = await processStatusUpdate({
        projectId: targetProjectId,
        externalTicketId: String(ticketId),
        ticketStatus,
        statusMapping: config.statusMapping,
        actorType: 'webhook',
      });

      // Record a single ingress telemetry log
      await prisma.activityLog.create({
        data: {
          project_id: targetProjectId,
          actor_type: 'webhook',
          action: `Inbound Webhook: ${ticketId} -> ${ticketStatus} (${updateResult.localStatus}) [${latencyMs}ms]`,
          entity_type: 'webhook_ingress',
          entity_id: String(ticketId),
        },
      }).catch(() => null);

      logger.info('[Webhook] Workspace webhook processed', {
        module: 'WebhooksIngress',
        action: 'processStatusUpdate',
        requestId,
        workspaceId: workspace.id,
        workspaceSlug,
        projectId: targetProjectId,
        externalTicketId: String(ticketId),
        ticketStatus,
        localStatus: updateResult.localStatus,
        matchedDefectsCount: updateResult.count,
        durationMs: latencyMs,
      });

      return NextResponse.json({
        success: true,
        workspaceId: workspace.id,
        projectId: targetProjectId,
        externalTicketId: String(ticketId),
        ticketStatus,
        localStatus: updateResult.localStatus,
        matchedDefectsCount: updateResult.count,
        latencyMs,
      }, { headers: { 'x-request-id': requestId } });
    }

    logger.info('[Webhook] Workspace webhook processed (no matching defect)', {
      module: 'WebhooksIngress',
      action: 'processStatusUpdate',
      requestId,
      workspaceId: workspace.id,
      workspaceSlug,
      externalTicketId: String(ticketId),
      ticketStatus,
      matchedDefectsCount: 0,
      durationMs: latencyMs,
    });

    return NextResponse.json({
      success: true,
      workspaceId: workspace.id,
      externalTicketId: String(ticketId),
      ticketStatus,
      matchedDefectsCount: 0,
      latencyMs,
    }, { headers: { 'x-request-id': requestId } });
  } catch (err: any) {
    const normalized = normalizeError(err, ErrorCodes.INTERNAL, 'Internal server error processing webhook');
    logger.error('Workspace inbound webhook failed', {
      module: 'WebhooksIngress',
      action: 'handleWorkspaceWebhook',
      requestId,
      durationMs: Date.now() - startTime,
      errorCode: normalized.code,
      error: err,
    });
    return apiErrorResponse(normalized.message, normalized.status, normalized.code, requestId);
  }
}
