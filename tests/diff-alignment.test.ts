import { describe, it, expect } from 'vitest';
import {
  alignSteps,
  computeStringSimilarity,
  type Step,
} from '@/components/reviews/ReviewDiff';

describe('computeStringSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(computeStringSimilarity('Click submit button', 'Click submit button')).toBe(1.0);
    expect(computeStringSimilarity('CLICK SUBMIT', 'click submit')).toBe(1.0);
  });

  it('returns 0.0 when either string is empty', () => {
    expect(computeStringSimilarity('', 'Click submit')).toBe(0.0);
    expect(computeStringSimilarity('Click submit', '')).toBe(0.0);
  });

  it('computes Jaccard word similarity accurately', () => {
    const sim = computeStringSimilarity('Click on button', 'Click on red button');
    // wordsA: Click, on, button (3)
    // wordsB: Click, on, red, button (4)
    // union: 4, intersection: 3 => 3/4 = 0.75
    expect(sim).toBe(0.75);
  });
});

describe('alignSteps', () => {
  const stepA: Step = { order: 1, step: 'Open login page', expected_result: 'Login page displayed' };
  const stepB: Step = { order: 2, step: 'Enter user credentials', expected_result: 'User authenticated' };

  it('returns empty array when both before and after are empty', () => {
    expect(alignSteps([], [])).toEqual([]);
  });

  it('detects all steps added when before is empty', () => {
    const diffs = alignSteps([], [stepA, stepB]);
    expect(diffs.length).toBe(2);
    expect(diffs[0].type).toBe('added');
    expect(diffs[1].type).toBe('added');
  });

  it('detects all steps removed when after is empty', () => {
    const diffs = alignSteps([stepA, stepB], []);
    expect(diffs.length).toBe(2);
    expect(diffs[0].type).toBe('removed');
    expect(diffs[1].type).toBe('removed');
  });

  it('detects unchanged steps when before and after are identical', () => {
    const diffs = alignSteps([stepA, stepB], [stepA, stepB]);
    expect(diffs.length).toBe(2);
    expect(diffs[0].type).toBe('unchanged');
    expect(diffs[1].type).toBe('unchanged');
  });

  it('detects modified step when similarity >= 0.40 threshold', () => {
    const modifiedStepB: Step = {
      order: 2,
      step: 'Enter user credentials and 2FA code', // similarity with 'Enter user credentials' is 3/5 = 0.60 >= 0.40
      expected_result: 'Dashboard opened',
    };
    const diffs = alignSteps([stepA, stepB], [stepA, modifiedStepB]);
    expect(diffs.length).toBe(2);
    expect(diffs[0].type).toBe('unchanged');
    expect(diffs[1].type).toBe('modified');
    expect(diffs[1].before?.step).toBe('Enter user credentials');
    expect(diffs[1].after?.step).toBe('Enter user credentials and 2FA code');
  });

  it('treats low similarity (<0.40) as separate remove and add', () => {
    const completelyDifferentStep: Step = {
      order: 2,
      step: 'Completely different action completely unmatched',
      expected_result: 'Result',
    };
    const diffs = alignSteps([stepA, stepB], [stepA, completelyDifferentStep]);
    // Step 1: unchanged, Step 2: removed, Step 3: added
    expect(diffs.length).toBe(3);
    expect(diffs[0].type).toBe('unchanged');
    expect(diffs.some((d) => d.type === 'removed')).toBe(true);
    expect(diffs.some((d) => d.type === 'added')).toBe(true);
  });

  it('aligns insertions in the middle of step sequence', () => {
    const insertedStep: Step = { order: 2, step: 'Solve captcha challenge', expected_result: 'Captcha verified' };
    const afterSteps = [
      stepA,
      insertedStep,
      { ...stepB, order: 3 },
    ];
    const diffs = alignSteps([stepA, stepB], afterSteps);
    expect(diffs.length).toBe(3);
    expect(diffs.some((d) => d.type === 'added' && d.after?.step === 'Solve captcha challenge')).toBe(true);
  });
});
