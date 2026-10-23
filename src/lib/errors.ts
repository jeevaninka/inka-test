export const ErrorCodes = {
  UNAUTHORIZED: 'ERR_UNAUTHORIZED',
  FORBIDDEN: 'ERR_FORBIDDEN',
  PENDING_APPROVAL: 'ERR_PENDING_APPROVAL',
  NOT_FOUND: 'ERR_NOT_FOUND',
  VALIDATION: 'ERR_VALIDATION',
  DB_CONFLICT: 'ERR_DB_CONFLICT',
  DB_FAILURE: 'ERR_DB_FAILURE',
  S3_STORAGE: 'ERR_S3_STORAGE',
  EMAIL_SEND: 'ERR_EMAIL_SEND',
  SLACK_WEBHOOK: 'ERR_SLACK_WEBHOOK',
  PM_INTEGRATION: 'ERR_PM_INTEGRATION',
  WEBHOOK_SIGNATURE: 'ERR_WEBHOOK_SIGNATURE',
  WEBHOOK_DELIVERY: 'ERR_WEBHOOK_DELIVERY',
  AI_SERVICE: 'ERR_AI_SERVICE',
  SSRF_BLOCKED: 'ERR_SSRF_BLOCKED',
  CLIENT_RUNTIME: 'ERR_CLIENT_RUNTIME',
  INTERNAL: 'ERR_INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | (string & {});

const STATUS_BY_CODE: Record<string, number> = {
  [ErrorCodes.UNAUTHORIZED]: 401,
  [ErrorCodes.WEBHOOK_SIGNATURE]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.PENDING_APPROVAL]: 403,
  [ErrorCodes.SSRF_BLOCKED]: 403,
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.VALIDATION]: 400,
  [ErrorCodes.DB_CONFLICT]: 409,
  [ErrorCodes.PM_INTEGRATION]: 502,
  [ErrorCodes.EMAIL_SEND]: 502,
  [ErrorCodes.SLACK_WEBHOOK]: 502,
  [ErrorCodes.WEBHOOK_DELIVERY]: 502,
  [ErrorCodes.AI_SERVICE]: 502,
  [ErrorCodes.S3_STORAGE]: 500,
  [ErrorCodes.DB_FAILURE]: 500,
  [ErrorCodes.CLIENT_RUNTIME]: 500,
  [ErrorCodes.INTERNAL]: 500,
};

export interface NormalizedError {
  code: ErrorCode;
  message: string;
  status: number;
  name: string;
  stack?: string;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.INTERNAL,
    options?: {
      status?: number;
      details?: Record<string, unknown>;
      requestId?: string;
      cause?: unknown;
    }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = options?.status ?? STATUS_BY_CODE[code] ?? 500;
    this.details = options?.details;
    this.requestId = options?.requestId;
  }
}

function inferCodeAndStatusFromMessage(
  message: string,
  fallbackCode?: ErrorCode
): { code: ErrorCode; status: number } {
  const lower = message.toLowerCase();

  if (lower.includes('pending approval')) {
    return { code: ErrorCodes.PENDING_APPROVAL, status: 403 };
  }
  if (lower.includes('ssrf protection') || lower.includes('blocked protocol')) {
    return { code: ErrorCodes.SSRF_BLOCKED, status: 403 };
  }
  if (
    lower.includes('unauthorized') ||
    lower.includes('not authenticated') ||
    lower.includes('invalid api key') ||
    lower.includes('api key required') ||
    lower.includes('please sign in')
  ) {
    return { code: ErrorCodes.UNAUTHORIZED, status: 401 };
  }
  if (
    lower.includes('webhook signature') ||
    lower.includes('webhook secret')
  ) {
    return { code: ErrorCodes.WEBHOOK_SIGNATURE, status: 401 };
  }
  if (
    lower.includes('forbidden') ||
    lower.includes('access denied') ||
    lower.includes('not a member') ||
    lower.includes('cannot perform this action') ||
    lower.includes('read-only access') ||
    lower.startsWith('only workspace') ||
    lower.startsWith('only project') ||
    lower.startsWith('only organization') ||
    lower.startsWith('only platform')
  ) {
    return { code: ErrorCodes.FORBIDDEN, status: 403 };
  }
  if (lower.includes('not found') || lower.includes('no workspace found') || lower.includes('no image found')) {
    return { code: ErrorCodes.NOT_FOUND, status: 404 };
  }
  if (
    lower.includes('already exists') ||
    lower.includes('already in use') ||
    lower.includes('already a member') ||
    lower.includes('duplicate')
  ) {
    return { code: ErrorCodes.DB_CONFLICT, status: 409 };
  }
  if (
    lower.includes('is required') ||
    lower.includes('are required') ||
    lower.includes('missing required') ||
    lower.includes('invalid ') ||
    lower.includes('cannot be empty') ||
    lower.includes('exceeds ') ||
    lower.includes('must be ')
  ) {
    return { code: ErrorCodes.VALIDATION, status: 400 };
  }
  if (lower.includes('pm tool') || lower.includes('inkaboard')) {
    return { code: ErrorCodes.PM_INTEGRATION, status: 502 };
  }
  if (lower.includes('ai generation') || lower.includes('ai enrichment') || lower.includes('gemini')) {
    return { code: ErrorCodes.AI_SERVICE, status: 502 };
  }
  if (lower.includes('s3') || lower.includes('bucket') || lower.includes('upload url') || lower.includes('download url')) {
    return { code: ErrorCodes.S3_STORAGE, status: 500 };
  }
  if (lower.includes('slack')) {
    return { code: ErrorCodes.SLACK_WEBHOOK, status: 502 };
  }
  if (lower.includes('email') || /\b(ses|smtp)\b/i.test(lower)) {
    return { code: ErrorCodes.EMAIL_SEND, status: 502 };
  }

  const code = fallbackCode || ErrorCodes.INTERNAL;
  return { code, status: STATUS_BY_CODE[code] ?? 500 };
}

/**
 * Normalizes any thrown value (AppError, PrismaError, Error, string, unknown)
 * into a structured NormalizedError with a clear `code`, `message`, and HTTP `status`.
 */
export function normalizeError(
  err: unknown,
  fallbackCode?: ErrorCode,
  fallbackMessage = 'An unexpected error occurred'
): NormalizedError {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message || fallbackMessage,
      status: err.status,
      name: err.name,
      stack: err.stack,
      details: err.details,
    };
  }

  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, any>;
    const rawCode = typeof anyErr.code === 'string' ? anyErr.code : undefined;

    // Handle Prisma Client Known Request Errors (P2xxx / P1xxx)
    if (rawCode && /^P[12]\d{3}$/.test(rawCode)) {
      const target = Array.isArray(anyErr.meta?.target)
        ? anyErr.meta.target.join(', ')
        : typeof anyErr.meta?.target === 'string'
        ? anyErr.meta.target
        : undefined;

      if (rawCode === 'P2002') {
        return {
          code: ErrorCodes.DB_CONFLICT,
          message: target
            ? `A record with this ${target} already exists`
            : 'A record with these details already exists',
          status: 409,
          name: anyErr.name || 'PrismaClientKnownRequestError',
          stack: typeof anyErr.stack === 'string' ? anyErr.stack : undefined,
          details: { prismaCode: rawCode, ...(target ? { target } : {}) },
        };
      }

      if (rawCode === 'P2025') {
        return {
          code: ErrorCodes.NOT_FOUND,
          message: (typeof anyErr.meta?.cause === 'string' && anyErr.meta.cause) || 'Requested record was not found',
          status: 404,
          name: anyErr.name || 'PrismaClientKnownRequestError',
          stack: typeof anyErr.stack === 'string' ? anyErr.stack : undefined,
          details: { prismaCode: rawCode },
        };
      }

      if (rawCode === 'P2003') {
        return {
          code: ErrorCodes.VALIDATION,
          message: 'Operation failed due to a related record reference constraint',
          status: 400,
          name: anyErr.name || 'PrismaClientKnownRequestError',
          stack: typeof anyErr.stack === 'string' ? anyErr.stack : undefined,
          details: { prismaCode: rawCode },
        };
      }

      return {
        code: ErrorCodes.DB_FAILURE,
        message: fallbackMessage !== 'An unexpected error occurred' ? fallbackMessage : 'Database operation failed',
        status: 500,
        name: anyErr.name || 'PrismaClientError',
        stack: typeof anyErr.stack === 'string' ? anyErr.stack : undefined,
        details: { prismaCode: rawCode },
      };
    }

    const rawMessage =
      typeof anyErr.message === 'string' && anyErr.message.trim()
        ? anyErr.message.trim()
        : fallbackMessage;

    if (
      rawMessage.includes('Failed to load chunk') ||
      rawMessage.includes('ChunkLoadError') ||
      rawMessage.includes('Loading chunk') ||
      rawMessage.includes('module factory is not available') ||
      rawMessage.includes('was instantiated because it was required')
    ) {
      return {
        code: ErrorCodes.CLIENT_RUNTIME,
        message: 'Page resources were updated or temporarily unavailable. Please reload the page.',
        status: 500,
        name: 'ChunkLoadError',
        stack: typeof anyErr.stack === 'string' ? anyErr.stack : undefined,
        details: { rawError: rawMessage },
      };
    }

    const inferred = inferCodeAndStatusFromMessage(rawMessage, fallbackCode);
    const explicitCode =
      rawCode && rawCode.startsWith('ERR_') ? (rawCode as ErrorCode) : inferred.code;
    const explicitStatus =
      typeof anyErr.status === 'number' && anyErr.status >= 400 && anyErr.status < 600
        ? anyErr.status
        : STATUS_BY_CODE[explicitCode] ?? inferred.status;

    return {
      code: explicitCode,
      message: rawMessage,
      status: explicitStatus,
      name: typeof anyErr.name === 'string' ? anyErr.name : 'Error',
      stack: typeof anyErr.stack === 'string' ? anyErr.stack : undefined,
      details:
        anyErr.details && typeof anyErr.details === 'object'
          ? (anyErr.details as Record<string, unknown>)
          : rawCode && !rawCode.startsWith('ERR_')
          ? { originalCode: rawCode }
          : undefined,
    };
  }

  if (typeof err === 'string' && err.trim()) {
    const inferred = inferCodeAndStatusFromMessage(err.trim(), fallbackCode);
    return {
      code: inferred.code,
      message: err.trim(),
      status: inferred.status,
      name: 'Error',
    };
  }

  const code = fallbackCode || ErrorCodes.INTERNAL;
  return {
    code,
    message: fallbackMessage,
    status: STATUS_BY_CODE[code] ?? 500,
    name: 'Error',
  };
}
