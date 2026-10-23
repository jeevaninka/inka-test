import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { logger } from '@/lib/logger';
import { ErrorCode, ErrorCodes, normalizeError } from '@/lib/errors';
import { assertWorkspaceAccess } from '@/lib/access';

export interface ApiHandlerContext<TParams = any> {
  params: Promise<TParams>;
  requestId: string;
  userId: number;
  user: any;
}

export type ApiRouteHandler<TParams = any> = (
  req: NextRequest,
  ctx: ApiHandlerContext<TParams>
) => Promise<NextResponse>;

export interface ApiHandlerOptions {
  requireAuth?: boolean;
  requireApproved?: boolean;
  module?: string;
}

export function apiErrorResponse(
  message: string,
  status: number,
  code: ErrorCode,
  requestId?: string,
  extra?: Record<string, unknown>
): NextResponse {
  const res = NextResponse.json(
    {
      error: message,
      message,
      code,
      ...(requestId ? { requestId } : {}),
      ...(extra || {}),
    },
    { status }
  );
  if (requestId) {
    res.headers.set('x-request-id', requestId);
  }
  return res;
}

/**
 * Standard API Handler wrapper for Next.js App Router route handlers.
 *
 * Provides:
 * 1. Consistent session validation & user resolution
 * 2. Distributed request tracing with `x-request-id`
 * 3. High-precision execution timing & performance metrics
 * 4. Structured server logging for AWS Amplify CloudWatch observability
 * 5. Normalized error responses with clear `code` & `message`
 */
export function createApiHandler<TParams = any>(
  handler: ApiRouteHandler<TParams>,
  options: ApiHandlerOptions = {}
) {
  const {
    requireAuth = true,
    requireApproved = true,
    module: moduleName = 'apiHandler',
  } = options;

  return async (req: NextRequest, rawCtx?: { params: Promise<TParams> }): Promise<NextResponse> => {
    const start = performance.now();
    const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
    const method = req.method;
    const url = new URL(req.url);
    const pathname = url.pathname;

    let userId = 0;
    let sessionUser: any = null;

    try {
      if (requireAuth) {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
          logger.warn(`[API] Unauthorized access attempt: ${method} ${pathname}`, {
            module: moduleName,
            action: 'authCheck',
            requestId,
            method,
            pathname,
            status: 401,
          });

          return apiErrorResponse(
            'Unauthorized: authentication required',
            401,
            ErrorCodes.UNAUTHORIZED,
            requestId
          );
        }

        if (requireApproved && !(session.user as any).isApproved) {
          logger.warn(`[API] Unapproved access attempt: ${method} ${pathname}`, {
            module: moduleName,
            action: 'approvalCheck',
            requestId,
            userId: String((session.user as any).id),
            method,
            pathname,
            status: 403,
          });

          return apiErrorResponse(
            'Forbidden: Account pending approval',
            403,
            ErrorCodes.PENDING_APPROVAL,
            requestId
          );
        }

        userId = Number((session.user as any).id);
        sessionUser = session.user;

        // Suspended organizations / members lose API access immediately, even
        // while their JWT is still valid. Throws AccessSuspendedError (403).
        const activeWorkspaceId = (session.user as any).workspaceId as string | undefined;
        if (activeWorkspaceId && userId) {
          await assertWorkspaceAccess(userId, activeWorkspaceId);
        }
      }

      logger.debug(`[API] --> ${method} ${pathname}`, {
        module: moduleName,
        action: 'requestStart',
        requestId,
        ...(userId ? { userId: String(userId) } : {}),
        method,
        pathname,
        ...(url.search ? { search: url.search } : {}),
      });

      const params = rawCtx?.params ? await rawCtx.params : ({} as TParams);

      const response = await handler(req, {
        params: Promise.resolve(params),
        requestId,
        userId,
        user: sessionUser,
      });

      const durationMs = Math.round(performance.now() - start);
      response.headers.set('x-request-id', requestId);

      if (response.status >= 500) {
        logger.error(`[API] <-- ${response.status} ${method} ${pathname} [${durationMs}ms]`, {
          module: moduleName,
          action: 'requestError',
          requestId,
          ...(userId ? { userId: String(userId) } : {}),
          method,
          pathname,
          status: response.status,
          durationMs,
          errorCode: ErrorCodes.INTERNAL,
          error: `HTTP ${response.status} returned from handler`,
        });
      } else if (response.status >= 400) {
        logger.warn(`[API] <-- ${response.status} ${method} ${pathname} [${durationMs}ms]`, {
          module: moduleName,
          action: 'requestClientError',
          requestId,
          ...(userId ? { userId: String(userId) } : {}),
          method,
          pathname,
          status: response.status,
          durationMs,
        });
      } else {
        logger.info(`[API] <-- ${response.status} ${method} ${pathname} [${durationMs}ms]`, {
          module: moduleName,
          action: 'requestComplete',
          requestId,
          ...(userId ? { userId: String(userId) } : {}),
          method,
          pathname,
          status: response.status,
          durationMs,
        });
      }

      return response;
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - start);
      const normalized = normalizeError(err, ErrorCodes.INTERNAL, 'Internal Server Error');

      logger.error(
        `[API] <-- ${normalized.status} ${method} ${pathname} [${durationMs}ms]: ${normalized.message}`,
        {
          module: moduleName,
          action: 'requestError',
          requestId,
          ...(userId ? { userId: String(userId) } : {}),
          method,
          pathname,
          status: normalized.status,
          durationMs,
          errorCode: normalized.code,
          error: err,
        }
      );

      return apiErrorResponse(
        normalized.message,
        normalized.status,
        normalized.code,
        requestId,
        normalized.details ? { details: normalized.details } : undefined
      );
    }
  };
}
