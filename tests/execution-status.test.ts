import { describe, it, expect } from 'vitest';
import {
  deriveCaseStatus,
  deriveOverallCaseStatusWithIterations,
} from '@/app/(main)/p/[slug]/runs/[runId]/ExecutionConsole';
import type { StepItem } from '@/lib/types';

describe('deriveCaseStatus', () => {
  const sampleSteps: StepItem[] = [
    {
      id: 'step-1',
      order: 1,
      step: 'Open login page',
      expected_result: 'Page loaded',
      data: null,
      image_url: null,
      reusable_step_id: null,
      reusable_step_item_id: null,
      is_outdated: false,
    },
    {
      id: 'step-2',
      order: 2,
      step: 'Enter credentials',
      expected_result: 'User dashboard displayed',
      data: null,
      image_url: null,
      reusable_step_id: null,
      reusable_step_item_id: null,
      is_outdated: false,
    },
  ];

  it('returns pending when steps array is empty', () => {
    expect(deriveCaseStatus([], {})).toBe('pending');
  });

  it('returns pending when not all steps are executed and no fail/blocked', () => {
    const results = {
      '1': { status: 'pass' },
    };
    expect(deriveCaseStatus(sampleSteps, results)).toBe('pending');
  });

  it('returns fail immediately if any step fails (fail takes precedence)', () => {
    const results = {
      '1': { status: 'pass' },
      '2': { status: 'fail' },
    };
    expect(deriveCaseStatus(sampleSteps, results)).toBe('fail');
  });

  it('returns fail even if earlier step was blocked', () => {
    const results = {
      '1': { status: 'blocked' },
      '2': { status: 'fail' },
    };
    expect(deriveCaseStatus(sampleSteps, results)).toBe('fail');
  });

  it('returns blocked if a step is blocked and no step failed', () => {
    const results = {
      '1': { status: 'pass' },
      '2': { status: 'blocked' },
    };
    expect(deriveCaseStatus(sampleSteps, results)).toBe('blocked');
  });

  it('returns pass when all steps are executed with at least one pass and no fail/blocked', () => {
    const results = {
      '1': { status: 'pass' },
      '2': { status: 'pass' },
    };
    expect(deriveCaseStatus(sampleSteps, results)).toBe('pass');
  });

  it('returns skip when all steps are marked skip', () => {
    const results = {
      '1': { status: 'skip' },
      '2': { status: 'skip' },
    };
    expect(deriveCaseStatus(sampleSteps, results)).toBe('skip');
  });

  it('returns invalid when all steps are marked invalid', () => {
    const results = {
      '1': { status: 'invalid' },
      '2': { status: 'invalid' },
    };
    expect(deriveCaseStatus(sampleSteps, results)).toBe('invalid');
  });
});

describe('deriveOverallCaseStatusWithIterations', () => {
  it('returns pending for empty iterations', () => {
    expect(deriveOverallCaseStatusWithIterations([])).toBe('pending');
  });

  it('returns fail if any iteration fails', () => {
    const iters = [
      { status: 'pass' },
      { status: 'fail' },
      { status: 'pass' },
    ];
    expect(deriveOverallCaseStatusWithIterations(iters)).toBe('fail');
  });

  it('returns blocked if any iteration is blocked and none failed', () => {
    const iters = [
      { status: 'pass' },
      { status: 'blocked' },
    ];
    expect(deriveOverallCaseStatusWithIterations(iters)).toBe('blocked');
  });

  it('returns pass when all iterations pass', () => {
    const iters = [
      { status: 'pass' },
      { status: 'pass' },
    ];
    expect(deriveOverallCaseStatusWithIterations(iters)).toBe('pass');
  });

  it('returns pass when mixed pass and skip', () => {
    const iters = [
      { status: 'pass' },
      { status: 'skip' },
    ];
    expect(deriveOverallCaseStatusWithIterations(iters)).toBe('pass');
  });

  it('returns pending when only some iterations are executed', () => {
    const iters = [
      { status: 'pass' },
      { status: 'pending' },
    ];
    expect(deriveOverallCaseStatusWithIterations(iters)).toBe('pending');
  });
});
