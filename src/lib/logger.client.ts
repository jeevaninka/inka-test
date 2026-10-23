import { ErrorCode, ErrorCodes, normalizeError } from '@/lib/errors';

export interface ClientLogContext {
  component?: string;
  module?: string;
  action?: string;
  requestId?: string;
  errorCode?: ErrorCode;
  error?: unknown;
  err?: unknown;
  stack?: string;
  skipRemote?: boolean;
  [key: string]: unknown;
}

function getClientMetadata() {
  return {
    service: 'inkatest-frontend',
    env: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || 'development',
    url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };
}

function stripNonErrorFields(ctx?: ClientLogContext): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...(ctx || {}) };
  delete clean.error;
  delete clean.err;
  delete clean.errorCode;
  delete clean.stack;
  delete clean.code;
  delete clean.skipRemote;
  for (const key of Object.keys(clean)) {
    if (clean[key] === undefined) {
      delete clean[key];
    }
  }
  return clean;
}

function forwardErrorToCloudWatch(payload: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    fetch('/api/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => null);
  } catch {
    // Never throw from client logger
  }
}

export interface ClientLoggerInstance {
  debug: (message: string, context?: ClientLogContext) => void;
  info: (message: string, context?: ClientLogContext) => void;
  warn: (message: string, context?: ClientLogContext) => void;
  error: (message: string, context?: ClientLogContext) => void;
  child: (defaultContext: ClientLogContext) => ClientLoggerInstance;
}

function createClientLogger(baseContext: ClientLogContext = {}): ClientLoggerInstance {
  const merge = (ctx?: ClientLogContext): ClientLogContext => ({
    ...baseContext,
    ...(ctx || {}),
  });

  return {
    debug: (message: string, context?: ClientLogContext) => {
      if (process.env.NODE_ENV === 'production') return;
      const merged = stripNonErrorFields(merge(context));
      console.debug(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'debug',
          ...getClientMetadata(),
          message,
          ...merged,
        })
      );
    },

    info: (message: string, context?: ClientLogContext) => {
      const merged = stripNonErrorFields(merge(context));
      console.info(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'info',
          ...getClientMetadata(),
          message,
          ...merged,
        })
      );
    },

    warn: (message: string, context?: ClientLogContext) => {
      const merged = stripNonErrorFields(merge(context));
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'warn',
          ...getClientMetadata(),
          message,
          ...merged,
        })
      );
    },

    error: (message: string, context?: ClientLogContext) => {
      const raw = merge(context);
      const skipRemote = Boolean(raw.skipRemote);
      const rawError = raw.error ?? raw.err;
      const explicitCode =
        (typeof raw.errorCode === 'string' && raw.errorCode) ||
        (typeof raw.code === 'string' && String(raw.code).startsWith('ERR_')
          ? (raw.code as ErrorCode)
          : undefined);
      const explicitStack = typeof raw.stack === 'string' ? raw.stack : undefined;

      const normalized = normalizeError(
        rawError ?? message,
        explicitCode || ErrorCodes.CLIENT_RUNTIME,
        message
      );

      const finalErrorCode = explicitCode || normalized.code;
      const cleanRest = stripNonErrorFields(raw);

      const payload = {
        timestamp: new Date().toISOString(),
        level: 'error' as const,
        status: 'Error' as const,
        ...getClientMetadata(),
        module: (cleanRest.module as string) || (cleanRest.component as string) || 'ClientUI',
        errorCode: finalErrorCode,
        message,
        error: {
          code: finalErrorCode,
          message: normalized.message || message,
          name: normalized.name,
          ...(explicitStack || normalized.stack ? { stack: explicitStack || normalized.stack } : {}),
        },
        ...cleanRest,
      };

      console.error(JSON.stringify(payload));

      if (!skipRemote) {
        forwardErrorToCloudWatch(payload);
      }
    },

    child: (defaultContext: ClientLogContext) => {
      return createClientLogger(merge(defaultContext));
    },
  };
}

export const logger: ClientLoggerInstance = createClientLogger();
