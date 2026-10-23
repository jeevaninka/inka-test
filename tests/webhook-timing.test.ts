import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

describe('Webhook signature timing-safe buffer comparison', () => {
  it('does not crash when buffer lengths differ and safely returns false', () => {
    const computed = crypto.createHmac('sha256', 'secret-key').update('test payload').digest('hex');
    const attackerSignature = 'short'; // Only 5 chars, computed is 64 hex chars

    const compBuf = Buffer.from(computed);
    const sigBuf = Buffer.from(attackerSignature);

    let isValid = false;
    // Without byteLength check, crypto.timingSafeEqual throws RangeError
    if (compBuf.byteLength === sigBuf.byteLength && crypto.timingSafeEqual(compBuf, sigBuf)) {
      isValid = true;
    }

    expect(isValid).toBe(false);
  });

  it('matches valid signatures correctly', () => {
    const secret = 'prod-webhook-secret';
    const payload = JSON.stringify({ event: 'run.completed', id: 'RUN-1' });
    const computed = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const compBuf = Buffer.from(computed);
    const sigBuf = Buffer.from(computed);

    let isValid = false;
    if (compBuf.byteLength === sigBuf.byteLength && crypto.timingSafeEqual(compBuf, sigBuf)) {
      isValid = true;
    }

    expect(isValid).toBe(true);
  });
});
