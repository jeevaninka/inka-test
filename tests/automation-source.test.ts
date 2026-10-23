import { describe, expect, it } from 'vitest';
import {
  caseMatchesMode,
  caseMatchesSource,
  getCaseAutomationSource,
  isAutomatedCase,
} from '@/lib/cases/automation-source';

const postmanCase = {
  type: 'automated',
  customFields: { _postman: { collectionUid: 'col-1', requestId: 'req-1' } },
};

const datadogCase = {
  type: 'automated',
  customFields: { _datadog: { publicIds: ['abc-def-ghi'] } },
};

const externalAutomatedCase = { type: 'automated', customFields: {} };
const manualCase = { type: 'manual', customFields: {} };

describe('case automation source', () => {
  it('prefers a linked Postman runner over generic automation', () => {
    expect(getCaseAutomationSource(postmanCase)).toBe('postman');
  });

  it('detects Datadog public ids', () => {
    expect(getCaseAutomationSource(datadogCase)).toBe('datadog');
  });

  it('labels unlinked automated cases as external, not manual', () => {
    expect(isAutomatedCase(externalAutomatedCase)).toBe(true);
    expect(getCaseAutomationSource(externalAutomatedCase)).toBe('external');
    expect(caseMatchesMode(externalAutomatedCase, 'manual')).toBe(false);
    expect(caseMatchesMode(externalAutomatedCase, 'auto')).toBe(true);
  });

  it('treats mixed mode as both kinds of work', () => {
    expect(caseMatchesMode(manualCase, 'mixed')).toBe(true);
    expect(caseMatchesMode(datadogCase, 'mixed')).toBe(true);
  });

  it('filters automated sub-sources, including None', () => {
    expect(caseMatchesSource(postmanCase, 'postman')).toBe(true);
    expect(caseMatchesSource(postmanCase, 'datadog')).toBe(false);
    expect(caseMatchesSource(externalAutomatedCase, 'external')).toBe(true);
    expect(caseMatchesSource(manualCase, 'external')).toBe(false);
  });

  it('parses custom fields stored as JSON strings', () => {
    expect(
      getCaseAutomationSource({
        type: 'automated',
        custom_fields: JSON.stringify({ _datadog: { publicIds: ['x'] } }),
      })
    ).toBe('datadog');
  });
});
