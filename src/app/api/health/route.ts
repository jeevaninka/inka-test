import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const start = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const durationMs = Math.round(performance.now() - start);

    return NextResponse.json(
      {
        status: 'ok',
        service: 'inkatest',
        database: 'connected',
        latencyMs: durationMs,
        env: process.env.APP_ENV || process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);
    logger.error('Health check failed: database unreachable', {
      module: 'HealthCheck',
      action: 'GET /api/health',
      durationMs,
      errorCode: ErrorCodes.DB_FAILURE,
      error,
    });

    return NextResponse.json(
      {
        status: 'degraded',
        service: 'inkatest',
        database: 'disconnected',
        latencyMs: durationMs,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
