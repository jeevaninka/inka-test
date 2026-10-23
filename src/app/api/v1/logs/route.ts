import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';
import { hit } from '@/lib/rate-limit';

/**
 * POST /api/v1/logs
 * Receives structured client-side error events (e.g. React Error Boundaries & logger.client.error)
 * and writes them to stdout/stderr so AWS Amplify forwards them into Amazon CloudWatch Logs.
 */
export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();

  // Public endpoint by design (errors can happen before sign-in), so it is
  // rate limited by caller IP to stop log flooding / CloudWatch cost abuse.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!hit(`client-log:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ ok: false, error: 'Rate limited' }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        {
          error: 'Invalid log payload',
          message: 'Invalid log payload',
          code: ErrorCodes.VALIDATION,
          requestId,
        },
        { status: 400 }
      );
    }

    const message = String(body.message || 'Client runtime error').slice(0, 500);
    const moduleName = String(body.module || body.component || 'ClientUI').slice(0, 100);
    const action = body.action ? String(body.action).slice(0, 100) : 'clientError';
    const errorCode = String(body.errorCode || body.error?.code || ErrorCodes.CLIENT_RUNTIME).slice(0, 64);
    const errorMessage = String(body.error?.message || message).slice(0, 500);
    const errorStack = typeof body.error?.stack === 'string' ? body.error.stack.slice(0, 2000) : undefined;
    const url = typeof body.url === 'string' ? body.url.slice(0, 300) : undefined;
    const digest = typeof body.digest === 'string' ? body.digest.slice(0, 100) : undefined;

    logger.error(message, {
      module: moduleName,
      action,
      source: 'browser',
      requestId: body.requestId || requestId,
      errorCode,
      url,
      digest,
      error: {
        code: errorCode,
        message: errorMessage,
        name: body.error?.name || 'ClientError',
        stack: errorStack,
      },
    });

    return NextResponse.json({ ok: true, requestId }, { status: 200 });
  } catch (err: any) {
    logger.error('Failed to ingest client log', {
      module: 'ClientLogIngest',
      action: 'ingest',
      requestId,
      errorCode: ErrorCodes.INTERNAL,
      error: err,
    });

    return NextResponse.json(
      {
        error: 'Failed to record log',
        message: 'Failed to record log',
        code: ErrorCodes.INTERNAL,
        requestId,
      },
      { status: 500 }
    );
  }
}
