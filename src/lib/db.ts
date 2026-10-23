import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const rawUrl = process.env.DATABASE_URL || '';
  let url = rawUrl;
  if (rawUrl && !rawUrl.includes('connection_limit=')) {
    // Serverless: every SSR instance owns its own pool. A high limit multiplies
    // across instances and exhausts Postgres max_connections. 3 is the safe
    // default behind a pooler (pgBouncer / RDS Proxy); override with
    // DATABASE_CONNECTION_LIMIT for long-lived servers.
    const limit = process.env.DATABASE_CONNECTION_LIMIT || '3';
    const separator = rawUrl.includes('?') ? '&' : '?';
    url = `${rawUrl}${separator}connection_limit=${limit}&pool_timeout=20`;
  }

  const client = new PrismaClient({
    ...(url
      ? {
          datasources: {
            db: { url },
          },
        }
      : {}),
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  client.$on('error', (e) => {
    logger.error('Prisma database client error', {
      module: 'Database',
      action: 'prismaError',
      target: e.target,
      errorCode: ErrorCodes.DB_FAILURE,
      error: e.message,
    });
  });

  client.$on('warn', (e) => {
    logger.warn('Prisma database client warning', {
      module: 'Database',
      action: 'prismaWarn',
      target: e.target,
      details: e.message,
    });
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type DbClient = typeof prisma;
