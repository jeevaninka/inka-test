import { describe, it, expect } from 'vitest';
import {
  extractAutocompleteRowsFromCases,
  buildStepAutocompleteIndexFromRows,
  matchActionPrefix,
  matchExpectedResultPrefix,
  setCachedProjectAutocompleteRows,
  recordStepsIntoProjectCache,
} from '@/lib/step-autocomplete';

describe('Step Autocomplete (Deterministic 2-Char Bucket Index)', () => {
  const sampleCases = [
    {
      id: 'case-1',
      updatedAt: '2026-10-10T10:00:00Z',
      steps: [
        { step: 'Enter username', expected_result: 'Username is displayed in the field' },
        { step: 'Enter password', expected_result: 'Password is masked' },
      ],
    },
    {
      id: 'case-2',
      updatedAt: '2026-10-12T10:00:00Z',
      steps: [
        { step: 'Enter username', expected_result: 'Username is displayed in the field' },
        { step: 'Enter user ID', expected_result: 'User ID is accepted' },
      ],
    },
    {
      id: 'case-3',
      updatedAt: '2026-10-15T10:00:00Z',
      steps: [
        { step: 'Enter username', expected_result: 'Valid username is accepted' },
        { step: 'Click Login button', expected_result: 'User is redirected to dashboard' },
      ],
    },
  ];

  it('indexes actions ranked by frequency and pairs each action with its most frequent expected result', () => {
    const rows = extractAutocompleteRowsFromCases(sampleCases);
    const index = buildStepAutocompleteIndexFromRows(rows);

    const match = matchActionPrefix(index, 'Enter user');
    expect(match).not.toBeNull();
    expect(match?.completedAction).toBe('Enter username');
    expect(match?.ghostSuffix).toBe('name');
    expect(match?.isExact).toBe(false);
    // 'Username is displayed in the field' appeared 2x vs 'Valid username is accepted' 1x
    expect(match?.entry.expectedResult).toBe('Username is displayed in the field');
  });

  it('handles case-insensitive prefix typing and normalizes to canonical action on completion', () => {
    const rows = extractAutocompleteRowsFromCases(sampleCases);
    const index = buildStepAutocompleteIndexFromRows(rows);

    const match = matchActionPrefix(index, 'enter user');
    expect(match).not.toBeNull();
    expect(match?.ghostSuffix).toBe('name');
    expect(match?.completedAction).toBe('Enter username');
    expect(match?.entry.expectedResult).toBe('Username is displayed in the field');
  });

  it('breaks frequency ties by recency (lastSeenMs DESC)', () => {
    const rows = extractAutocompleteRowsFromCases([
      {
        id: 'old-case',
        updatedAt: '2026-01-01T00:00:00Z',
        steps: [{ step: 'Verify header logo', expected_result: 'Old logo is visible' }],
      },
      {
        id: 'new-case',
        updatedAt: '2026-10-16T00:00:00Z',
        steps: [{ step: 'Verify header navigation', expected_result: 'Nav links are visible' }],
      },
    ]);
    const index = buildStepAutocompleteIndexFromRows(rows);

    const match = matchActionPrefix(index, 'Verify header');
    expect(match?.completedAction).toBe('Verify header navigation');
    expect(match?.entry.expectedResult).toBe('Nav links are visible');
  });

  it('returns exact match with empty ghostSuffix so paired expected result stays available live', () => {
    const rows = extractAutocompleteRowsFromCases(sampleCases);
    const index = buildStepAutocompleteIndexFromRows(rows);

    const match = matchActionPrefix(index, 'Enter username');
    expect(match).not.toBeNull();
    expect(match?.isExact).toBe(true);
    expect(match?.ghostSuffix).toBe('');
    expect(match?.entry.expectedResult).toBe('Username is displayed in the field');
  });

  it('suppresses action ghost completion when user is typing a {param} or {{VAR}} token', () => {
    const rows = extractAutocompleteRowsFromCases([
      {
        id: 'c1',
        updatedAt: '2026-10-16T00:00:00Z',
        steps: [{ step: 'Enter {{USERNAME}} in login field', expected_result: 'Entered' }],
      },
    ]);
    const index = buildStepAutocompleteIndexFromRows(rows);

    expect(matchActionPrefix(index, 'Enter {{USER')).toBeNull();
    expect(matchActionPrefix(index, 'Enter {user')).toBeNull();
    // Once braces are closed, prefix completion resumes
    const resumed = matchActionPrefix(index, 'Enter {{USERNAME}}');
    expect(resumed?.ghostSuffix).toBe(' in login field');
  });

  it('matches expected result prefixes and suggests full paired expected result when empty', () => {
    const rows = extractAutocompleteRowsFromCases(sampleCases);
    const index = buildStepAutocompleteIndexFromRows(rows);

    // Empty expected result when action is 'Click Login button'
    const emptyMatch = matchExpectedResultPrefix(index, '', 'Click Login button');
    expect(emptyMatch?.completedText).toBe('User is redirected to dashboard');
    expect(emptyMatch?.ghostSuffix).toBe('User is redirected to dashboard');

    // Partial typing in expected result field
    const partialMatch = matchExpectedResultPrefix(index, 'User is redir', 'Click Login button');
    expect(partialMatch?.ghostSuffix).toBe('ected to dashboard');
    expect(partialMatch?.completedText).toBe('User is redirected to dashboard');
  });

  it('updates project cache immediately when a new step is committed in the session', () => {
    const rows = extractAutocompleteRowsFromCases(sampleCases);
    setCachedProjectAutocompleteRows('proj-test-1', rows);

    const updatedIndex = recordStepsIntoProjectCache('proj-test-1', [
      { step: 'Select billing cycle dropdown', expected_result: 'Monthly and Annual options appear' },
    ]);

    const match = matchActionPrefix(updatedIndex, 'Select bill');
    expect(match?.completedAction).toBe('Select billing cycle dropdown');
    expect(match?.entry.expectedResult).toBe('Monthly and Annual options appear');
  });
});
