import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '@/lib/crypto';

describe('AES-256-GCM crypto utility', () => {
  it('encrypts and decrypts text accurately', () => {
    const secret = 'super-secret-api-key-1234567890';
    const encrypted = encrypt(secret);
    expect(encrypted).not.toBe(secret);
    expect(encrypted.startsWith('enc:v1:')).toBe(true);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('handles empty strings gracefully', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt('')).toBe('');
  });

  it('gracefully returns legacy unencrypted text as-is', () => {
    const legacyKey = 'plain_api_key_without_encryption';
    expect(decrypt(legacyKey)).toBe(legacyKey);
  });

  it('generates distinct IVs for identical plaintexts (IND-CPA semantic security)', () => {
    const plaintext = 'identical-token';
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(plaintext);
    expect(decrypt(enc2)).toBe(plaintext);
  });
});
