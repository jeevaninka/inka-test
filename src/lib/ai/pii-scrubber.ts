/**
 * Deterministic PII and secret redaction utility for AI prompts and pre-flight checks.
 * Masks Indian insurance PII (PAN, Aadhaar, mobile numbers), emails, and auth tokens/secrets
 * while preserving non-sensitive domain parameters (age, sum insured, city, tier, plan names).
 */

const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const AADHAAR_REGEX = /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const INDIAN_MOBILE_REGEX = /(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g;
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_REGEX = /\b(Bearer\s+)[A-Za-z0-9\-._~+/]{12,}=*/gi;
const KEY_VALUE_SECRET_REGEX =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|auth[_-]?token|client[_-]?secret|access[_-]?key)(\s*[:=]\s*)(['"]?)([^'",\s\n]+)(['"]?)/gi;

const SENSITIVE_PARAM_KEY_REGEX =
  /^(pan|aadhaar|aadhar|ssn|email|phone|mobile|contact|password|passwd|pwd|secret|token|api_?key|card_?number|cvv|account_?number|ifsc)$/i;

export function scrubPiiAndSecrets(input?: string | null): string {
  if (!input) return '';

  return input
    .replace(JWT_REGEX, '[REDACTED_JWT]')
    .replace(BEARER_REGEX, '$1[REDACTED_TOKEN]')
    .replace(KEY_VALUE_SECRET_REGEX, '$1$2$3[REDACTED_SECRET]$5')
    .replace(PAN_REGEX, '[REDACTED_PAN]')
    .replace(AADHAAR_REGEX, '[REDACTED_AADHAAR]')
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(INDIAN_MOBILE_REGEX, '[REDACTED_PHONE]');
}

export function scrubParametersRecord(
  params?: Record<string, unknown> | null
): Record<string, string> | undefined {
  if (!params || typeof params !== 'object') return undefined;

  const scrubbed: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(params)) {
    if (rawVal === null || rawVal === undefined) continue;
    const strVal = String(rawVal).trim();
    if (!strVal) continue;

    if (SENSITIVE_PARAM_KEY_REGEX.test(key.trim())) {
      scrubbed[key] = '[REDACTED]';
    } else {
      scrubbed[key] = scrubPiiAndSecrets(strVal);
    }
  }

  return Object.keys(scrubbed).length > 0 ? scrubbed : undefined;
}

export interface DetectedPiiOrSecret {
  type: 'PAN' | 'AADHAAR' | 'EMAIL' | 'PHONE' | 'SECRET';
  label: string;
}

/**
 * Detects whether a string contains raw secrets or PII (used by Review Pre-Flight).
 */
export function detectPiiOrSecrets(input?: string | null): DetectedPiiOrSecret[] {
  if (!input) return [];
  const findings: DetectedPiiOrSecret[] = [];

  if (
    JWT_REGEX.test(input) ||
    BEARER_REGEX.test(input) ||
    KEY_VALUE_SECRET_REGEX.test(input)
  ) {
    findings.push({ type: 'SECRET', label: 'Hardcoded secret, password, or token' });
  }
  JWT_REGEX.lastIndex = 0;
  BEARER_REGEX.lastIndex = 0;
  KEY_VALUE_SECRET_REGEX.lastIndex = 0;

  if (PAN_REGEX.test(input)) {
    findings.push({ type: 'PAN', label: 'Real PAN number format detected' });
  }
  PAN_REGEX.lastIndex = 0;

  if (AADHAAR_REGEX.test(input)) {
    findings.push({ type: 'AADHAAR', label: 'Aadhaar number format detected' });
  }
  AADHAAR_REGEX.lastIndex = 0;

  return findings;
}
