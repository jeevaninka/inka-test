import { describe, it, expect } from 'vitest';
import { hit, enforceRateLimit, resetRateLimit, loginRateLimitKey } from '@/lib/rate-limit';

describe('fixed-window rate limiter', () => {
  const key = () => `test:${Math.random().toString(36).slice(2)}`;

  it('allows up to the limit and then blocks', () => {
    const k = key();
    for (let i = 0; i < 3; i++) {
      expect(hit(k, 3, 60_000).allowed).toBe(true);
    }
    const blocked = hit(k, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('reports remaining budget', () => {
    const k = key();
    expect(hit(k, 5, 60_000).remaining).toBe(4);
    expect(hit(k, 5, 60_000).remaining).toBe(3);
  });

  it('resets after the window elapses', () => {
    const k = key();
    // Window of 1ms: the next call falls outside it.
    hit(k, 1, 1);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(hit(k, 1, 1).allowed).toBe(true);
        resolve();
      }, 10);
    });
  });

  it('keeps separate budgets per key', () => {
    const a = key();
    const b = key();
    hit(a, 1, 60_000);
    expect(hit(a, 1, 60_000).allowed).toBe(false);
    expect(hit(b, 1, 60_000).allowed).toBe(true);
  });

  it('enforceRateLimit throws a rate limited error', () => {
    const k = key();
    enforceRateLimit(k, 1, 60_000);
    expect(() => enforceRateLimit(k, 1, 60_000)).toThrow(/Too many requests/);
  });

  it('resetRateLimit clears a bucket', () => {
    const k = key();
    hit(k, 1, 60_000);
    resetRateLimit(k);
    expect(hit(k, 1, 60_000).allowed).toBe(true);
  });

  it('login keys are case-insensitive on email', () => {
    expect(loginRateLimitKey('User@Example.com')).toBe(loginRateLimitKey('user@example.com'));
  });
});
