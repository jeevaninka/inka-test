import { describe, it, expect } from 'vitest';
import {
  sanitizeFieldKey,
  MAX_CUSTOM_FIELDS_PER_ENTITY,
  MAX_KEY_NAME_LENGTH,
  MAX_OPTION_LENGTH,
  MAX_OPTIONS_COUNT,
  MAX_TEXT_VALUE_LENGTH,
} from '@/lib/custom-fields';

describe('Custom Fields Key Sanitization & Validation', () => {
  it('correctly converts normal property names to clean snake_case keys', () => {
    expect(sanitizeFieldKey('Severity')).toBe('severity');
    expect(sanitizeFieldKey('Testing Type')).toBe('testing_type');
    expect(sanitizeFieldKey('Target OS / Device')).toBe('target_os_device');
    expect(sanitizeFieldKey('Automated in CI?')).toBe('automated_in_ci');
  });

  it('strips special characters and trims leading/trailing underscores', () => {
    expect(sanitizeFieldKey('---Custom!!Field$$$---')).toBe('custom_field');
    expect(sanitizeFieldKey('___hello___world___')).toBe('hello_world');
  });

  it('enforces the 30-character limit on generated keys', () => {
    const longName = 'This Is A Very Long Custom Property Name That Exceeds Thirty Characters';
    const key = sanitizeFieldKey(longName);
    expect(key.length).toBeLessThanOrEqual(MAX_KEY_NAME_LENGTH);
    expect(key.length).toBe(30);
  });
});

describe('Custom Fields Hard Limits and Governance', () => {
  it('has max custom fields per project capped at 15', () => {
    expect(MAX_CUSTOM_FIELDS_PER_ENTITY).toBe(15);
  });

  it('has name length capped at 30 characters', () => {
    expect(MAX_KEY_NAME_LENGTH).toBe(30);
  });

  it('has option length capped at 30 characters', () => {
    expect(MAX_OPTION_LENGTH).toBe(30);
  });

  it('has max options count capped at 20 per dropdown', () => {
    expect(MAX_OPTIONS_COUNT).toBe(20);
  });

  it('has text value length capped at 100 characters', () => {
    expect(MAX_TEXT_VALUE_LENGTH).toBe(100);
  });
});

describe('Dropdown Options Deduplication and Sanitization', () => {
  function sanitizeOptions(rawOptions: string[]) {
    const seen = new Set<string>();
    const sanitized: string[] = [];
    for (const opt of rawOptions) {
      const trimmed = opt.trim();
      if (!trimmed) continue;
      if (trimmed.length > MAX_OPTION_LENGTH) {
        throw new Error(`Option "${trimmed}" exceeds limit of ${MAX_OPTION_LENGTH} characters.`);
      }
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        sanitized.push(trimmed);
      }
    }
    if (sanitized.length === 0) throw new Error('At least one option required');
    if (sanitized.length > MAX_OPTIONS_COUNT) throw new Error('Exceeds max options');
    return sanitized;
  }

  it('deduplicates options case-insensitively and preserves original casing of first occurrence', () => {
    const raw = ['Critical', 'critical', 'CRITICAL', 'High', 'high', 'Medium', 'Low'];
    const result = sanitizeOptions(raw);
    expect(result).toEqual(['Critical', 'High', 'Medium', 'Low']);
  });

  it('trims whitespace and skips empty entries', () => {
    const raw = ['  Functional  ', '', '   ', 'Regression'];
    const result = sanitizeOptions(raw);
    expect(result).toEqual(['Functional', 'Regression']);
  });

  it('throws an error if an option exceeds 30 characters', () => {
    const raw = ['Valid Option', 'This option string is way too long and exceeds thirty chars limit'];
    expect(() => sanitizeOptions(raw)).toThrow(/exceeds limit of 30 characters/);
  });

  it('throws an error if more than 20 options are provided', () => {
    const raw = Array.from({ length: 25 }, (_, i) => `Option ${i + 1}`);
    expect(() => sanitizeOptions(raw)).toThrow(/Exceeds max options/);
  });
});

describe('Custom Field Value Merge and State Handling', () => {
  function applyCustomFieldChange(
    currentFields: Record<string, any>,
    key: string,
    value: any
  ): Record<string, any> {
    const next = { ...currentFields };
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    } else {
      next[key] = value;
    }
    return next;
  }

  it('adds and updates custom field values correctly', () => {
    let fields: Record<string, any> = {};
    fields = applyCustomFieldChange(fields, 'severity', 'Critical');
    expect(fields).toEqual({ severity: 'Critical' });

    fields = applyCustomFieldChange(fields, 'testing_type', 'Functional');
    expect(fields).toEqual({ severity: 'Critical', testing_type: 'Functional' });

    fields = applyCustomFieldChange(fields, 'severity', 'High');
    expect(fields).toEqual({ severity: 'High', testing_type: 'Functional' });
  });

  it('removes the key when empty, null, or undefined is passed', () => {
    const initial = { severity: 'Critical', testing_type: 'Functional', automated: true };
    const updated = applyCustomFieldChange(initial, 'severity', '');
    expect(updated).toEqual({ testing_type: 'Functional', automated: true });

    const updated2 = applyCustomFieldChange(updated, 'testing_type', null);
    expect(updated2).toEqual({ automated: true });
  });

  it('handles boolean values without treating false as empty', () => {
    let fields: Record<string, any> = {};
    fields = applyCustomFieldChange(fields, 'is_flaky', true);
    expect(fields.is_flaky).toBe(true);

    fields = applyCustomFieldChange(fields, 'is_flaky', false);
    expect(fields.is_flaky).toBe(false);
  });

  it('handles multi-select arrays and removes key when array is empty', () => {
    let fields: Record<string, any> = {};
    fields = applyCustomFieldChange(fields, 'browsers', ['Chrome', 'Firefox']);
    expect(fields.browsers).toEqual(['Chrome', 'Firefox']);

    fields = applyCustomFieldChange(fields, 'browsers', []);
    expect(fields.browsers).toBeUndefined();
  });
});
