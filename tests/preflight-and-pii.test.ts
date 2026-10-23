import { describe, it, expect } from 'vitest';
import {
  scrubPiiAndSecrets,
  scrubParametersRecord,
  detectPiiOrSecrets,
} from '@/lib/ai/pii-scrubber';
import { runReviewPreflightChecks } from '@/lib/reviews/preflight';
import {
  buildGeneratePrompt,
  buildImproveStepsPrompt,
  buildEnrichPrompt,
} from '@/lib/ai/client';

describe('PII and Secret Scrubber', () => {
  it('redacts PAN, Aadhaar, email, Indian mobile, and Bearer/key-value secrets', () => {
    const raw =
      'Customer PAN ABCDE1234F, Aadhaar 4567 8901 2345, mobile +91 9876543210, email user@inkasure.com, Authorization: Bearer abcdef1234567890xyz, password="mySecretPassword123"';
    const scrubbed = scrubPiiAndSecrets(raw);

    expect(scrubbed).not.toContain('ABCDE1234F');
    expect(scrubbed).not.toContain('4567 8901 2345');
    expect(scrubbed).not.toContain('9876543210');
    expect(scrubbed).not.toContain('user@inkasure.com');
    expect(scrubbed).not.toContain('abcdef1234567890xyz');
    expect(scrubbed).not.toContain('mySecretPassword123');

    expect(scrubbed).toContain('[REDACTED_PAN]');
    expect(scrubbed).toContain('[REDACTED_AADHAAR]');
    expect(scrubbed).toContain('[REDACTED_PHONE]');
    expect(scrubbed).toContain('[REDACTED_EMAIL]');
    expect(scrubbed).toContain('Bearer [REDACTED_TOKEN]');
    expect(scrubbed).toContain('[REDACTED_SECRET]');
  });

  it('preserves non-sensitive insurance parameters while redacting sensitive keys and values', () => {
    const record = {
      age: 55,
      city: 'Nashik',
      sum_insured: '₹50L',
      pan: 'ABCDE1234F',
      mobile: '9876543210',
      notes: 'Contact customer at test@example.com',
    };

    const scrubbed = scrubParametersRecord(record);
    expect(scrubbed).toEqual({
      age: '55',
      city: 'Nashik',
      sum_insured: '₹50L',
      pan: '[REDACTED]',
      mobile: '[REDACTED]',
      notes: 'Contact customer at [REDACTED_EMAIL]',
    });
  });

  it('detects secrets and PII patterns for pre-flight checks', () => {
    const findings = detectPiiOrSecrets('Enter PAN ABCDE1234F and api_key=sk_live_998877665544');
    expect(findings.map((f) => f.type)).toContain('PAN');
    expect(findings.map((f) => f.type)).toContain('SECRET');
  });
});

describe('Review Pre-Flight Checks Engine', () => {
  it('flags missing and generic expected results, escalating final step to error', () => {
    const issues = runReviewPreflightChecks({
      steps: [
        { order: 1, step: 'Open quote form', expectedResult: 'ok' },
        { order: 2, step: 'Click Calculate Premium', expectedResult: '' },
      ],
    });

    const step1 = issues.find((i) => i.stepOrder === 1 && i.rule === 'generic_expected_result');
    const step2 = issues.find((i) => i.stepOrder === 2 && i.rule === 'missing_expected_result');

    expect(step1?.severity).toBe('warning');
    expect(step2?.severity).toBe('error');
  });

  it('does not flag missing expected result when step is linked to a ReusableStep', () => {
    const issues = runReviewPreflightChecks({
      steps: [
        { order: 1, step: 'Login as Agent', expectedResult: '', reusableStepId: 'shared-1' },
        { order: 2, step: 'Verify dashboard loads', expectedResult: 'Agent dashboard displays active quotes' },
      ],
    });

    expect(issues).toHaveLength(0);
  });

  it('flags undefined {{ENV_VAR}} and {param} references', () => {
    const issues = runReviewPreflightChecks({
      steps: [
        {
          order: 1,
          step: 'Navigate to {{BASE_URL}} and login with {{UNKNOWN_VAR}}',
          expectedResult: 'Quote calculated for {age} and {missing_param}',
        },
      ],
      knownVariableKeys: ['BASE_URL'],
      knownParameterKeys: ['age'],
    });

    const varIssue = issues.find((i) => i.rule === 'unresolved_variable');
    const paramIssue = issues.find((i) => i.rule === 'unresolved_parameter');

    expect(varIssue?.title).toContain('{{UNKNOWN_VAR}}');
    expect(paramIssue?.title).toContain('{missing_param}');
  });

  it('flags hardcoded URLs and maps them to matching project variables or environments', () => {
    const issues = runReviewPreflightChecks({
      steps: [
        {
          order: 1,
          step: 'Navigate to https://staging.inkasure.com/quotes',
          expectedResult: 'Quotes page is visible',
        },
      ],
      variableValueToKeyMap: {
        'https://staging.inkasure.com': 'STAGE_URL',
      },
      environmentUrls: [{ name: 'STAGING', baseUrl: 'https://staging.inkasure.com' }],
    });

    const urlIssue = issues.find((i) => i.rule === 'hardcoded_url');
    expect(urlIssue).toBeDefined();
    expect(urlIssue?.suggestion).toContain('STAGING');
  });
});

describe('AI Custom Prompt Injection & Scrubbing', () => {
  it('injects customInstructions into buildGeneratePrompt and buildImproveStepsPrompt while scrubbing PII', () => {
    const genPrompt = buildGeneratePrompt({
      countInstruction: 'Generate 3 cases.',
      input: {
        description: 'Premium calculation flow',
        customInstructions: 'Focus on negative cases and do not use PAN ABCDE1234F',
      },
      modulesContext: 'None',
      reusableStepsContext: 'None',
    });

    expect(genPrompt).toContain('<user_custom_instructions>');
    expect(genPrompt).toContain('Focus on negative cases');
    expect(genPrompt).toContain('[REDACTED_PAN]');
    expect(genPrompt).not.toContain('ABCDE1234F');

    const improvePrompt = buildImproveStepsPrompt({
      input: {
        title: 'Calculate quote',
        customInstructions: 'Keep step count unchanged, only refine expected results',
      },
      currentSteps: '1. Click calculate',
      existingTags: 'None',
      reusableStepsContext: 'None',
    });

    expect(improvePrompt).toContain('<user_custom_instructions>');
    expect(improvePrompt).toContain('Keep step count unchanged, only refine expected results');

    const enrichPrompt = buildEnrichPrompt({
      cases: [{ _id: '1', title: 'Row 1' }],
      modulesContext: 'None',
      reusableStepsContext: 'None',
      existingTags: 'None',
      columnHints: 'Column C represents feature toggle state',
    });

    expect(enrichPrompt).toContain('Column C represents feature toggle state');
  });
});

