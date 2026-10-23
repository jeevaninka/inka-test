import { encrypt, decrypt } from '@/lib/crypto';

/** Config keys that must never be stored in plaintext. */
export const SECRET_KEYS = ['apiToken', 'accessToken', 'apiKey', 'appKey'] as const;

export function encryptToolConfig(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...raw };
  for (const key of SECRET_KEYS) {
    if (typeof out[key] === 'string' && out[key].trim()) {
      out[key] = encrypt(out[key].trim());
    }
  }
  return out;
}

export function decryptToolConfig(raw: Record<string, any> | null | undefined): Record<string, any> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, any> = { ...raw };
  for (const key of SECRET_KEYS) {
    if (typeof out[key] === 'string' && out[key].trim()) {
      out[key] = decrypt(out[key].trim());
    }
  }
  return out;
}
