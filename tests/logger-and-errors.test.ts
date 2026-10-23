import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, runLoggedAction } from '@/lib/logger';
import { AppError, ErrorCodes, normalizeError } from '@/lib/errors';

describe('Logger & Error System (AWS Amplify / CloudWatch)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv, LOG_LEVEL: 'debug' };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('omits error, errorCode, and stack keys on non-failed logs (info, warn, debug)', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    logger.info('Run completed', {
      module: 'Runs',
      action: 'completeRun',
      runId: 'RUN-01',
      // Even if someone passes residual error fields, non-failed logs must strip them
      error: 'should-not-appear',
      errorCode: ErrorCodes.INTERNAL,
      stack: 'fake-stack',
    });

    logger.warn('Slow query detected', {
      module: 'Database',
      action: 'query',
      durationMs: 1250,
      error: 'should-not-appear',
    });

    logger.debug('Cache hit', {
      module: 'apiClient',
      action: 'get',
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const infoPayload = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(infoPayload.level).toBe('info');
    expect(infoPayload.module).toBe('Runs');
    expect(infoPayload.message).toBe('Run completed');
    expect(infoPayload).not.toHaveProperty('error');
    expect(infoPayload).not.toHaveProperty('errorCode');
    expect(infoPayload).not.toHaveProperty('stack');
    expect(infoPayload).not.toHaveProperty('status');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnPayload = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(warnPayload.level).toBe('warn');
    expect(warnPayload).not.toHaveProperty('error');
    expect(warnPayload).not.toHaveProperty('errorCode');

    expect(debugSpy).toHaveBeenCalledTimes(1);
    const debugPayload = JSON.parse(debugSpy.mock.calls[0][0] as string);
    expect(debugPayload.level).toBe('debug');
    expect(debugPayload).not.toHaveProperty('error');
  });

  it('includes status="Error", errorCode, message, and structured error object on failed logs', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const err = new AppError('Invalid API key for PM tool', ErrorCodes.PM_INTEGRATION);
    logger.error('Failed to sync ticket status', {
      module: 'Integrations',
      action: 'syncTicket',
      projectId: 'PRJ-01',
      error: err,
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(payload.level).toBe('error');
    expect(payload.status).toBe('Error');
    expect(payload.errorCode).toBe(ErrorCodes.PM_INTEGRATION);
    expect(payload.message).toBe('Failed to sync ticket status');
    expect(payload.error).toMatchObject({
      code: ErrorCodes.PM_INTEGRATION,
      message: 'Invalid API key for PM tool',
      name: 'AppError',
    });
    expect(payload.error.stack).toBeDefined();
  });

  it('redacts sensitive secrets from log context automatically', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    logger.info('Integration saved', {
      module: 'Integrations',
      apiKey: 'secret-api-key-123',
      webhookSecret: 'whsec_999',
      nested: {
        password: 'my-password',
        safeField: 'visible',
      },
    });

    const payload = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(payload.apiKey).toBe('[REDACTED]');
    expect(payload.webhookSecret).toBe('[REDACTED]');
    expect(payload.nested.password).toBe('[REDACTED]');
    expect(payload.nested.safeField).toBe('visible');
  });

  it('normalizes Prisma errors, permission errors, and validation errors into clear ErrorCodes', () => {
    const uniqueConflict = normalizeError({
      code: 'P2002',
      name: 'PrismaClientKnownRequestError',
      meta: { target: ['slug'] },
    });
    expect(uniqueConflict.code).toBe(ErrorCodes.DB_CONFLICT);
    expect(uniqueConflict.status).toBe(409);
    expect(uniqueConflict.message).toContain('slug');

    const notFound = normalizeError({
      code: 'P2025',
      name: 'PrismaClientKnownRequestError',
    });
    expect(notFound.code).toBe(ErrorCodes.NOT_FOUND);
    expect(notFound.status).toBe(404);

    const forbidden = normalizeError(new Error('Forbidden: not a member of this project'));
    expect(forbidden.code).toBe(ErrorCodes.FORBIDDEN);
    expect(forbidden.status).toBe(403);

    const validation = normalizeError(new Error('Project name is required'));
    expect(validation.code).toBe(ErrorCodes.VALIDATION);
    expect(validation.status).toBe(400);
  });

  it('logs action failure with errorCode and rethrows via runLoggedAction', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runLoggedAction('Cases', 'createTestCase', { projectId: 'PRJ-01' }, async () => {
        throw new Error('Forbidden: viewers cannot perform this action');
      })
    ).rejects.toThrow('Forbidden: viewers cannot perform this action');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(payload.status).toBe('Error');
    expect(payload.errorCode).toBe(ErrorCodes.FORBIDDEN);
    expect(payload.module).toBe('Cases');
    expect(payload.action).toBe('createTestCase');
  });
});
