import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM
const TAG_LENGTH = 16; // Standard 128-bit auth tag

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL SECURITY ERROR: ENCRYPTION_KEY or NEXTAUTH_SECRET must be configured in production.');
    }
    return crypto.createHash('sha256').update('inkaqa-dev-local-only-key-not-for-prod').digest();
  }
  // Hash with SHA-256 to ensure exactly 32 bytes (256 bits)
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: `enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an encrypted string produced by `encrypt`.
 * If the string is not encrypted (e.g. legacy plain text), returns it as-is.
 */
export function decrypt(data: string): string {
  if (!data || typeof data !== 'string') return data;
  if (!data.startsWith('enc:v1:')) return data; // Gracefully handle legacy unencrypted strings

  const parts = data.split(':');
  if (parts.length !== 5) return data;

  const [, , ivHex, tagHex, cipherHex] = parts;
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (err) {
    // If decryption fails (e.g. corrupted tag or wrong key), return empty string to prevent leaking raw ciphertext
    return '';
  }
}
