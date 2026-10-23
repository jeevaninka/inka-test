/**
 * Minimal fixed-window rate limiter.
 *
 * Deliberately dependency-free and in-memory: it protects a single SSR instance
 * (Amplify WEB_COMPUTE) from credential stuffing, accidental loops and runaway
 * AI/import cost. It is a stop-gap, not a distributed limiter — if you scale to
 * several instances, swap the `hit()` body for Redis/Upstash or an API Gateway
 * usage plan and keep the same call sites.
 */

type Bucket = { count: number; resetAt: number };

const globalForRateLimit = globalThis as unknown as {
  __rateLimitBuckets?: Map<string, Bucket>;
};

const buckets = globalForRateLimit.__rateLimitBuckets ?? new Map<string, Bucket>();
globalForRateLimit.__rateLimitBuckets = buckets;

const MAX_BUCKETS = 10_000;

function sweep(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Records one hit for `key`.
 *
 * @param key        Stable identifier, e.g. `login:user@example.com`
 * @param limit      Allowed hits per window
 * @param windowMs   Window length in milliseconds
 */
export function hit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/**
 * Throws a user-readable error when the key exceeded its budget.
 * Server actions call this at the top of the handler.
 */
export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message = 'Too many requests. Please try again in a moment.'
): void {
  const result = hit(key, limit, windowMs);
  if (!result.allowed) {
    const error = new Error(message) as RateLimitError;
    error.code = 'RATE_LIMITED';
    error.retryAfterSeconds = result.retryAfterSeconds;
    throw error;
  }
}

export interface RateLimitError extends Error {
  code: 'RATE_LIMITED';
  retryAfterSeconds: number;
}

/** Per-user AI budget (default: 20 AI calls per 10 minutes per user). */
export function enforceAiRateLimit(userId: number | string, scope: string): void {
  const limit = Number(process.env.AI_RATE_LIMIT_PER_10MIN || 20);
  enforceRateLimit(`ai:${scope}:${userId}`, limit, 10 * 60 * 1000, 'AI request limit reached. Please wait a few minutes.');
}

/** Per-user bulk-import budget (default: 5 imports per 10 minutes). */
export function enforceImportRateLimit(userId: number | string): void {
  const limit = Number(process.env.IMPORT_RATE_LIMIT_PER_10MIN || 5);
  enforceRateLimit(`import:${userId}`, limit, 10 * 60 * 1000, 'Import limit reached. Please wait a few minutes.');
}

/** Login attempt budget keyed by email + IP (default: 8 attempts per 15 minutes). */
export function loginRateLimitKey(email: string, ip?: string): string {
  return `login:${email.toLowerCase()}:${ip || 'unknown'}`;
}

export function enforceLoginRateLimit(email: string, ip?: string): void {
  const limit = Number(process.env.LOGIN_RATE_LIMIT_PER_15MIN || 8);
  enforceRateLimit(loginRateLimitKey(email, ip), limit, 15 * 60 * 1000, 'Too many sign-in attempts. Try again later.');
}

/** Clears a bucket (e.g. after a successful login). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
