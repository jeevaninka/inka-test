import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'crypto';
import { processStatusUpdate } from '@/lib/integrations/status-sync';
import { PmIntegrationConfig } from '@/lib/integrations/pm-client';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const startTime = Date.now();
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();

  try {
    const { projectId: projectParam } = await params;
    const rawBody = await req.text();

    // Resolve project by id or slug
    const project = await prisma.project.findFirst({
      where: {
        OR: [{ id: projectParam }, { slug: projectParam }],
      },
      select: { id: true, slug: true, name: true },
    });

    if (!project) {
      return apiErrorResponse('Project not found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    const integration = await prisma.integration.findFirst({
      where: {
        project_id: project.id,
        provider: 'custom_pm',
        enabled: true,
      },
    });

    if (!integration) {
      return apiErrorResponse(
        'PM tool integration is not enabled for this project',
        404,
        ErrorCodes.NOT_FOUND,
        requestId
      );
    }

    const config = (integration.config as any) as PmIntegrationConfig;

    // 1. Verify Webhook Secret / Signature (Mandatory Secret - Fail-Closed)
    if (!config.webhookSecret || !config.webhookSecret.trim()) {
      logger.warn('Inbound project webhook rejected: webhook secret not configured', {
        module: 'WebhooksIngress',
        action: 'verifySecret',
        projectId: project.id,
        requestId,
      });
      return apiErrorResponse(
        'Inbound webhooks disabled: Webhook secret must be configured in integration settings.',
        401,
        ErrorCodes.WEBHOOK_SIGNATURE,
        requestId
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
      const dirBuf = Buffer.from(directSecret);
      const expBuf = Buffer.from(expectedSecret);
      if (dirBuf.byteLength === expBuf.byteLength && crypto.timingSafeEqual(dirBuf, expBuf)) {
        isValid = true;
      }
    }

    if (!isValid) {
      logger.warn('Inbound project webhook signature verification failed', {
        module: 'WebhooksIngress',
        action: 'verifySignature',
        projectId: project.id,
        requestId,
      });

      await prisma.activityLog.create({
        data: {
          project_id: project.id,
          actor_type: 'webhook',
          action: 'Inbound Webhook: Signature verification failed (HTTP 401)',
          entity_type: 'webhook_ingress',
          entity_id: 'auth_failed',
        },
      }).catch(() => null);

      return apiErrorResponse(
        'Invalid or missing webhook signature/secret',
        401,
        ErrorCodes.WEBHOOK_SIGNATURE,
        requestId
      );
    }

    // 2. Parse JSON Payload
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return apiErrorResponse('Invalid JSON body', 400, ErrorCodes.VALIDATION, requestId);
    }

    // Handle ping test events
    const eventType = req.headers.get('x-inkaboard-event') || req.headers.get('x-webhook-event') || payload.event;
    if (eventType === 'ping') {
      logger.info('Inbound project webhook ping received', {
        module: 'WebhooksIngress',
        action: 'ping',
        projectId: project.id,
        requestId,
      });
      return NextResponse.json({
        success: true,
        message: 'Ping received successfully',
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Extract ticket ID / key and status generically
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
      return apiErrorResponse(
        'Payload must contain a ticket identifier and status',
        400,
        ErrorCodes.VALIDATION,
        requestId,
        { received: { ticketId, status: rawStatus } }
      );
    }

    const ticketStatus = typeof rawStatus === 'object' ? rawStatus.name || JSON.stringify(rawStatus) : String(rawStatus);
    const latencyMs = Date.now() - startTime;

    // 4. Process Status Update
    const result = await processStatusUpdate({
      projectId: project.id,
      externalTicketId: String(ticketId),
      ticketStatus,
      statusMapping: config.statusMapping,
      actorType: 'webhook',
    });

    logger.info('Inbound project webhook processed', {
      module: 'WebhooksIngress',
      action: 'processStatusUpdate',
      projectId: project.id,
      externalTicketId: String(ticketId),
      ticketStatus,
      localStatus: result.localStatus,
      matchedDefectsCount: result.count,
      durationMs: latencyMs,
      requestId,
    });

    // 5. Record Webhook Ingress Activity Log
    await prisma.activityLog.create({
      data: {
        project_id: project.id,
        actor_type: 'webhook',
        action: `Inbound Webhook: ${ticketId} -> ${ticketStatus} (${result.localStatus}) [${latencyMs}ms]`,
        entity_type: 'webhook_ingress',
        entity_id: String(ticketId),
      },
    }).catch(() => null);

    return NextResponse.json({
      success: true,
      projectId: project.id,
      externalTicketId: String(ticketId),
      ticketStatus,
      localStatus: result.localStatus,
      matchedDefectsCount: result.count,
      latencyMs,
    });
  } catch (err: any) {
    const normalized = normalizeError(err, ErrorCodes.INTERNAL, 'Internal server error processing webhook');
    logger.error('Incoming project webhook failed', {
      module: 'WebhooksIngress',
      action: 'handleIncomingWebhook',
      requestId,
      durationMs: Date.now() - startTime,
      errorCode: normalized.code,
      error: err,
    });
    return apiErrorResponse(normalized.message, normalized.status, normalized.code, requestId);
  }
}
