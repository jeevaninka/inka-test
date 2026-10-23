import { describe, it, expect } from 'vitest';
import {
  validateFile,
  sanitizeFilename,
  sniffMagicBytes,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
} from '@/lib/s3/validation';

describe('validateFile', () => {
  it('accepts files with valid extension AND valid mime type', () => {
    const file = new File(['content'], 'screenshot.png', { type: 'image/png' });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it('accepts valid PDF document', () => {
    const file = new File(['%PDF-1.4'], 'test_plan.pdf', { type: 'application/pdf' });
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it('rejects files with disallowed extension even if mime is spoofed', () => {
    const file = new File(['malicious'], 'payload.exe', { type: 'text/plain' });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('rejects files with disallowed mime even if extension looks safe', () => {
    const file = new File(['malicious'], 'photo.jpg', { type: 'application/x-msdownload' });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
  });

  it('rejects files exceeding 25MB limit', () => {
    const bigFile = new File(['x'], 'huge.zip', { type: 'application/zip' });
    Object.defineProperty(bigFile, 'size', { value: 30 * 1024 * 1024 });
    const result = validateFile(bigFile);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds 25MB');
  });
});

describe('sanitizeFilename', () => {
  it('strips special characters and path traversal', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('.._.._.._etc_passwd');
    expect(sanitizeFilename('my test file (1).png')).toBe('my_test_file_1_.png');
    expect(sanitizeFilename('normal-file_name.123.jpg')).toBe('normal-file_name.123.jpg');
  });

  it('truncates filename to 200 chars', () => {
    const longName = 'a'.repeat(300) + '.png';
    expect(sanitizeFilename(longName).length).toBe(200);
  });
});

describe('sniffMagicBytes', () => {
  it('detects JPEG magic bytes (FF D8 FF)', () => {
    const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    expect(sniffMagicBytes(bytes)).toBe('image/jpeg');
  });

  it('detects PNG magic bytes (89 50 4E 47)', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
    expect(sniffMagicBytes(bytes)).toBe('image/png');
  });

  it('detects GIF magic bytes (GIF8)', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(sniffMagicBytes(bytes)).toBe('image/gif');
  });

  it('detects PDF magic bytes (%PDF)', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31]);
    expect(sniffMagicBytes(bytes)).toBe('application/pdf');
  });

  it('detects ZIP magic bytes (PK..)', () => {
    const bytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04]);
    expect(sniffMagicBytes(bytes)).toBe('application/zip');
  });

  it('returns null for unknown or short buffers', () => {
    expect(sniffMagicBytes(new Uint8Array([0x00, 0x01]))).toBeNull();
    expect(sniffMagicBytes(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });
});
