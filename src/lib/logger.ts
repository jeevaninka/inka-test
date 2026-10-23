import { ErrorCode, ErrorCodes, normalizeError } from '@/lib/errors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  module?: string;
  action?: string;
  requestId?: string;
  userId?: string | number;
  projectId?: string;
  workspaceId?: string;
  organizationId?: string;
  durationMs?: number;
  errorCode?: ErrorCode;
  error?: unknown;
  err?: unknown;
  stack?: string;
  [key: string]: unknown;
}

const LOG_LEVEL_WEIGHT: Record<LogLevel | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

const SENSITIVE_KEY_PATTERN =
  /^(password|password_hash|secret|api_secret|webhook_?secret|api_?key|token|access_?token|refresh_?token|authorization|cookie|private_?key|client_?secret)$/i;

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_PATTERN, '');
}

function getConfiguredLogLevel(): LogLevel | 'silent' {
  const raw = (process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'silent') {
    return raw;
  }
  if (process.env.NODE_ENV === 'production') {
    return 'info';
  }
  return 'debug';
}

function shouldEmit(level: LogLevel): boolean {
  const threshold = LOG_LEVEL_WEIGHT[getConfiguredLogLevel()] ?? LOG_LEVEL_WEIGHT.info;
  return LOG_LEVEL_WEIGHT[level] >= threshold;
}

function getEnvironmentName(): string {
  return (
    process.env.APP_ENV ||
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.AWS_BRANCH ||
    process.env.NODE_ENV ||
    'development'
  );
}

/**
 * Recursively sanitizes metadata, strips undefined values, and redacts sensitive secrets.
 */
export function sanitizeContext(
  input: Record<string, unknown>,
  depth = 0
): Record<string, unknown> {
  if (depth > 4) return {};
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;

    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
      continue;
    }

    if (value instanceof Error) {
      const normalized = normalizeError(value);
      result[key] = {
        code: normalized.code,
        message: normalized.message,
        name: normalized.name,
      };
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value.slice(0, 50).map((item) =>
        item && typeof item === 'object' && !(item instanceof Date)
          ? sanitizeContext(item as Record<string, unknown>, depth + 1)
          : item
      );
      continue;
    }

    if (value && typeof value === 'object' && !(value instanceof Date)) {
      result[key] = sanitizeContext(value as Record<string, unknown>, depth + 1);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function emitNonErrorLog(
  level: 'debug' | 'info' | 'warn',
  message: string,
  context?: LogContext
) {
  if (!shouldEmit(level)) return;

  const rawContext = { ...(context || {}) };
  // Never emit error-specific keys on non-failed logs
  delete rawContext.error;
  delete rawContext.err;
  delete rawContext.errorCode;
  delete rawContext.stack;
  delete rawContext.code;

  const sanitized = sanitizeContext(rawContext);
  const cleanMessage = stripAnsi(message);

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: 'inkatest',
    env: getEnvironmentName(),
    ...(sanitized.module ? { module: sanitized.module } : {}),
    ...(sanitized.action ? { action: sanitized.action } : {}),
    message: cleanMessage,
    ...sanitized,
  };

  const serialized = JSON.stringify(payload);
  if (level === 'debug') {
    console.debug(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}

function emitErrorLog(message: string, context?: LogContext) {
  if (!shouldEmit('error')) return;

  const rawContext = { ...(context || {}) };
  const rawErrorSource = rawContext.error ?? rawContext.err;
  const explicitErrorCode =
    (typeof rawContext.errorCode === 'string' && rawContext.errorCode) ||
    (typeof rawContext.code === 'string' && rawContext.code.startsWith('ERR_')
      ? rawContext.code
      : undefined);
  const explicitStack = typeof rawContext.stack === 'string' ? rawContext.stack : undefined;

  delete rawContext.error;
  delete rawContext.err;
  delete rawContext.errorCode;
  delete rawContext.stack;

  const cleanMessage = stripAnsi(message);
  const normalized = normalizeError(
    rawErrorSource ?? cleanMessage,
    (explicitErrorCode as ErrorCode) || ErrorCodes.INTERNAL,
    cleanMessage
  );

  const finalErrorCode: ErrorCode = (explicitErrorCode as ErrorCode) || normalized.code;
  const finalErrorMessage = normalized.message || cleanMessage;
  const finalStack = explicitStack || normalized.stack;

  const sanitized = sanitizeContext(rawContext);

  const payload = {
    timestamp: new Date().toISOString(),
    level: 'error' as const,
    status: 'Error' as const,
    service: 'inkatest',
    env: getEnvironmentName(),
    ...(sanitized.module ? { module: sanitized.module } : {}),
    ...(sanitized.action ? { action: sanitized.action } : {}),
    errorCode: finalErrorCode,
    message: cleanMessage,
    error: {
      code: finalErrorCode,
      message: finalErrorMessage,
      name: normalized.name,
      ...(finalStack ? { stack: finalStack } : {}),
      ...(normalized.details ? { details: normalized.details } : {}),
    },
    ...sanitized,
  };

  console.error(JSON.stringify(payload));
}

export interface LoggerInstance {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  child: (defaultContext: LogContext) => LoggerInstance;
  startTimer: (
    action: string,
    initialContext?: LogContext
  ) => {
    done: (message?: string, extra?: LogContext) => number;
    fail: (err: unknown, message?: string, extra?: LogContext) => number;
  };
}

function createLogger(baseContext: LogContext = {}): LoggerInstance {
  const merge = (ctx?: LogContext): LogContext => ({
    ...baseContext,
    ...(ctx || {}),
  });

  return {
    debug: (message: string, context?: LogContext) => {
      emitNonErrorLog('debug', message, merge(context));
    },

    info: (message: string, context?: LogContext) => {
      emitNonErrorLog('info', message, merge(context));
    },

    warn: (message: string, context?: LogContext) => {
      emitNonErrorLog('warn', message, merge(context));
    },

    error: (message: string, context?: LogContext) => {
      emitErrorLog(message, merge(context));
    },

    child: (defaultContext: LogContext) => {
      return createLogger(merge(defaultContext));
    },

    startTimer: (action: string, initialContext?: LogContext) => {
      const start = performance.now();
      const timerContext = merge({ action, ...(initialContext || {}) });

      return {
        done: (message?: string, extra?: LogContext) => {
          const durationMs = Math.round(performance.now() - start);
          emitNonErrorLog('info', message || `${action} completed`, {
            ...timerContext,
            ...(extra || {}),
            durationMs,
          });
          return durationMs;
        },
        fail: (err: unknown, message?: string, extra?: LogContext) => {
          const durationMs = Math.round(performance.now() - start);
          const normalized = normalizeError(err);
          emitErrorLog(message || `${action} failed: ${normalized.message}`, {
            ...timerContext,
            ...(extra || {}),
            durationMs,
            errorCode: extra?.errorCode || normalized.code,
            error: err,
          });
          return durationMs;
        },
      };
    },
  };
}

export const logger: LoggerInstance = createLogger();

/**
 * Wraps a server action or service operation with structured start/complete/slow/error logging,
 * automatic duration tracking, and normalized `errorCode` + `message` emission for CloudWatch.
 */
export async function runLoggedAction<T>(
  module: string,
  action: string,
  context: (LogContext & { logSuccess?: boolean }) | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  const { logSuccess = false, ...restContext } = context || {};
  const requestId =
    (typeof restContext.requestId === 'string' && restContext.requestId) ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`);

  logger.debug(`[Action] --> ${module}.${action}`, {
    ...restContext,
    module,
    action,
    requestId,
  });

  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - start);

    if (durationMs > 1000) {
      logger.warn(`[Action] Slow execution: ${module}.${action} [${durationMs}ms]`, {
        ...restContext,
        module,
        action,
        requestId,
        durationMs,
      });
    } else if (logSuccess) {
      logger.info(`[Action] <-- ${module}.${action} [${durationMs}ms]`, {
        ...restContext,
        module,
        action,
        requestId,
        durationMs,
      });
    } else {
      logger.debug(`[Action] <-- ${module}.${action} [${durationMs}ms]`, {
        ...restContext,
        module,
        action,
        requestId,
        durationMs,
      });
    }

    return result;
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - start);
    const normalized = normalizeError(err, restContext.errorCode, `${module}.${action} failed`);

    logger.error(`[Action] Failed ${module}.${action} [${durationMs}ms]: ${normalized.message}`, {
      ...restContext,
      module,
      action,
      requestId,
      durationMs,
      errorCode: normalized.code,
      error: err,
    });

    if (err instanceof Error) {
      (err as any).code = normalized.code;
      (err as any).requestId = requestId;
      throw err;
    }

    const wrapped = new Error(normalized.message);
    (wrapped as any).code = normalized.code;
    (wrapped as any).requestId = requestId;
    throw wrapped;
  }
}
