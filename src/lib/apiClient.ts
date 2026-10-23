/**
 * apiClient — robust frontend fetch utility with in-flight request deduplication,
 * short-term TTL memory caching, and end-to-end request logging & debugging.
 *
 * Problems solved:
 * 1. Duplicate requests: When multiple components mount simultaneously and call the
 *    same GET endpoint, only ONE network request is dispatched. All callers share
 *    the exact same in-flight Promise.
 * 2. Rapid re-renders / navigation spam: Configurable TTL cache (in milliseconds)
 *    serves recent results instantly without hitting the network.
 * 3. Observability & Debugging: Logs timing, status, request IDs, error codes, and
 *    structured errors for easy inspection in DevTools and CloudWatch correlation.
 */

import { logger as clientLogger } from '@/lib/logger.client';
import { ErrorCode, ErrorCodes } from '@/lib/errors';

export interface RequestOptions extends Omit<RequestInit, 'method' | 'body'> {
  /** Optional params object serialized into query string */
  params?: Record<string, string | number | boolean | undefined | null>;
  /** Optional time-to-live in milliseconds to keep the response cached in memory */
  ttl?: number;
  /** Force bypass cache and in-flight promise deduplication */
  forceRefresh?: boolean;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

// In-flight Promise map: cacheKey -> Promise
const inFlightRequests = new Map<string, Promise<unknown>>();

// Response memory cache: cacheKey -> CacheEntry
const responseCache = new Map<string, CacheEntry>();

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params || Object.keys(params).length === 0) return path;

  const searchParams = new URLSearchParams();
  const sortedKeys = Object.keys(params).sort();

  for (const key of sortedKeys) {
    const val = params[key];
    if (val !== undefined && val !== null && val !== '') {
      searchParams.append(key, String(val));
    }
  }

  const qs = searchParams.toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ApiError extends Error {
  status: number;
  code: ErrorCode;
  requestId?: string;
  details?: unknown;

  constructor(
    message: string,
    status: number,
    code: ErrorCode = ErrorCodes.INTERNAL,
    requestId?: string,
    details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const { params, ttl = 0, forceRefresh = false, headers: customHeaders, ...fetchInit } = options;
  const url = buildUrl(path, params);
  const cacheKey = `${method}:${url}`;

  // Check TTL cache for GET requests
  if (method === 'GET' && !forceRefresh && ttl > 0) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      clientLogger.debug(`API cache hit: ${method} ${url}`, {
        module: 'apiClient',
        action: 'cacheHit',
        method,
        url,
      });
      return cached.data as T;
    }
    if (cached) {
      responseCache.delete(cacheKey);
    }
  }

  // Check in-flight requests for GET
  if (method === 'GET' && !forceRefresh && inFlightRequests.has(cacheKey)) {
    clientLogger.debug(`API join in-flight: ${method} ${url}`, {
      module: 'apiClient',
      action: 'joinInFlight',
      method,
      url,
    });
    return inFlightRequests.get(cacheKey) as Promise<T>;
  }

  const requestId = generateRequestId();
  const startTime = performance.now();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-request-id': requestId,
    ...(customHeaders as Record<string, string>),
  };

  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  clientLogger.debug(`API request start: ${method} ${url}`, {
    module: 'apiClient',
    action: 'requestStart',
    method,
    url,
    requestId,
  });

  const promise = (async () => {
    try {
      const response = await fetch(url, {
        ...fetchInit,
        method,
        headers,
        body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });

      const durationMs = Math.round(performance.now() - startTime);
      const serverReqId = response.headers.get('x-request-id') || requestId;

      if (!response.ok) {
        let errJson: any = null;
        let errText = '';
        try {
          errJson = await response.json();
        } catch {
          errText = await response.text().catch(() => response.statusText);
        }

        const errorMessage =
          errJson?.message ||
          errJson?.error ||
          errText ||
          `Request failed with status ${response.status}`;
        const errorCode: ErrorCode =
          errJson?.code ||
          (response.status === 401
            ? ErrorCodes.UNAUTHORIZED
            : response.status === 403
            ? ErrorCodes.FORBIDDEN
            : response.status === 404
            ? ErrorCodes.NOT_FOUND
            : response.status === 409
            ? ErrorCodes.DB_CONFLICT
            : response.status === 400
            ? ErrorCodes.VALIDATION
            : ErrorCodes.INTERNAL);

        const apiError = new ApiError(
          errorMessage,
          response.status,
          errorCode,
          serverReqId,
          errJson
        );

        clientLogger.error(`API request failed: ${response.status} ${method} ${url}`, {
          module: 'apiClient',
          action: 'requestError',
          method,
          url,
          status: response.status,
          durationMs,
          requestId: serverReqId,
          errorCode,
          error: apiError,
          // Server already logs API route failures in CloudWatch; skip duplicate remote POST
          skipRemote: true,
        });

        throw apiError;
      }

      // 204 No Content
      if (response.status === 204) {
        clientLogger.debug(`API request complete: 204 ${method} ${url}`, {
          module: 'apiClient',
          action: 'requestComplete',
          method,
          url,
          status: 204,
          durationMs,
          requestId: serverReqId,
        });
        return undefined as T;
      }

      const data = (await response.json()) as T;

      clientLogger.debug(`API request complete: ${response.status} ${method} ${url}`, {
        module: 'apiClient',
        action: 'requestComplete',
        method,
        url,
        status: response.status,
        durationMs,
        requestId: serverReqId,
      });

      // Save to TTL cache if requested for GET
      if (method === 'GET' && ttl > 0) {
        responseCache.set(cacheKey, {
          data,
          expiresAt: Date.now() + ttl,
        });
      }

      return data;
    } finally {
      if (method === 'GET') {
        inFlightRequests.delete(cacheKey);
      }
    }
  })();

  if (method === 'GET') {
    inFlightRequests.set(cacheKey, promise);
  }

  return promise;
}

export const apiClient = {
  get: <T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean | undefined | null>,
    options?: RequestOptions
  ) => request<T>('GET', path, undefined, { ...options, params }),

  post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),

  put: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, body, options),

  patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),

  delete: <T = unknown>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),

  /**
   * Invalidate memory cache matching a URL substring or key pattern
   */
  invalidate: (urlSubstring?: string) => {
    if (!urlSubstring) {
      responseCache.clear();
      return;
    }
    for (const key of responseCache.keys()) {
      if (key.includes(urlSubstring)) {
        responseCache.delete(key);
      }
    }
  },
};
