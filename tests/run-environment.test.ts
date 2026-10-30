import { describe, expect, it } from 'vitest';
import {
  hasRunEnvironmentDetails,
  normalizeRunEnvironmentDetails,
  readRunEnvironmentDetails,
  summarizeRunEnvironment,
} from '@/lib/runs/environment';
import { touchesCaseContent } from '@/lib/cases/versioning';

describe('run environment details (C8)', () => {
  it('drops blank fields and blank custom rows on save', () => {
    const details = normalizeRunEnvironmentDetails({
      platform: ' iOS ',
      os: '   ',
      browser: '',
      device: null,
      custom: [
        { label: 'Region', value: 'eu-west-1' },
        { label: '  ', value: 'orphan' },
        { label: 'Orphan', value: ' ' },
      ],
    });
    expect(details).toEqual({
      platform: 'iOS',
      custom: [{ label: 'Region', value: 'eu-west-1' }],
    });
  });

  it('returns nothing for non-object payloads', () => {
    expect(normalizeRunEnvironmentDetails(undefined)).toEqual({});
    expect(normalizeRunEnvironmentDetails('iOS')).toEqual({});
    expect(hasRunEnvironmentDetails({})).toBe(false);
  });

  it('reads details from either custom_fields shape', () => {
    expect(
      readRunEnvironmentDetails({
        customFields: { environmentDetails: { os: 'Android 14' } },
      })
    ).toEqual({ os: 'Android 14' });

    expect(
      readRunEnvironmentDetails({
        custom_fields: { environmentDetails: { device: 'Pixel 8' } },
      })
    ).toEqual({ device: 'Pixel 8' });
  });

  it('falls back to build_version for the build chip', () => {
    const details = readRunEnvironmentDetails({ buildVersion: '2.4.1' });
    expect(details.build).toBe('2.4.1');
    expect(summarizeRunEnvironment(details)).toEqual([
      { key: 'build', label: 'Build', value: '2.4.1' },
    ]);
  });

  it('summarizes known fields first, then custom rows', () => {
    const chips = summarizeRunEnvironment({
      browser: 'Safari',
      platform: 'iOS',
      custom: [{ label: 'Region', value: 'eu-west-1' }],
    });
    expect(chips.map((c) => c.label)).toEqual(['Platform', 'Browser', 'Region']);
  });
});

describe('case content versioning (C1)', () => {
  it('treats content fields as content changes', () => {
    expect(touchesCaseContent({ title: 'New title' })).toBe(true);
    expect(touchesCaseContent({ preConditions: 'logged in' })).toBe(true);
    expect(touchesCaseContent({ custom_fields: { a: 1 } })).toBe(true);
  });

  it('ignores metadata-only updates', () => {
    expect(touchesCaseContent({ status: 'ACTIVE' })).toBe(false);
    expect(touchesCaseContent({ priority: 'P0', moduleId: 'mod-1' })).toBe(false);
    expect(touchesCaseContent({})).toBe(false);
  });
});
