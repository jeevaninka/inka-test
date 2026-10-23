import {
  extractEnvironmentVariableKeys,
  extractDatasetParameterKeys,
} from '@/lib/variables';
import { detectPiiOrSecrets } from '@/lib/ai/pii-scrubber';

export type PreflightSeverity = 'error' | 'warning' | 'info';

export type PreflightRuleId =
  | 'no_steps'
  | 'missing_expected_result'
  | 'generic_expected_result'
  | 'unresolved_variable'
  | 'unresolved_parameter'
  | 'hardcoded_url'
  | 'hardcoded_secret_or_pii'
  | 'step_count_bloat';

export interface PreflightIssue {
  id: string;
  rule: PreflightRuleId;
  severity: PreflightSeverity;
  stepOrder?: number;
  title: string;
  suggestion: string;
}

export interface PreflightStepInput {
  order: number;
  step?: string | null;
  description?: string | null;
  expectedResult?: string | null;
  expected_result?: string | null;
  data?: string | null;
  reusableStepId?: string | null;
  reusable_step_id?: string | null;
}

export interface RunPreflightInput {
  steps: PreflightStepInput[];
  preConditions?: string | null;
  caseExpectedResult?: string | null;
  knownVariableKeys?: string[];
  variableValueToKeyMap?: Record<string, string>;
  environmentUrls?: Array<{ name: string; baseUrl: string }>;
  knownParameterKeys?: string[];
}

const GENERIC_EXPECTED_RESULTS = new Set([
  'ok',
  'okay',
  'done',
  'works',
  'working',
  'pass',
  'passed',
  'success',
  'successful',
  'yes',
  'true',
  'na',
  'n/a',
  'none',
  '-',
  'same',
  'as expected',
  'it works',
  'should work',
]);

const RAW_URL_REGEX = /\b(?:https?:\/\/[^\s'",;)>]+|localhost:\d+(?:\/[^\s'",;)>]*)?)/gi;

export function runReviewPreflightChecks(input: RunPreflightInput): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const steps = input.steps || [];

  if (steps.length === 0) {
    issues.push({
      id: 'no-steps',
      rule: 'no_steps',
      severity: 'error',
      title: 'No test steps defined',
      suggestion: 'Add at least one executable step with a verifiable expected result before approving.',
    });
    return issues;
  }

  const knownVars = input.knownVariableKeys
    ? new Set(input.knownVariableKeys.map((k) => k.trim().toUpperCase()))
    : null;
  const knownParams = input.knownParameterKeys
    ? new Set(input.knownParameterKeys.map((k) => k.trim().toLowerCase()))
    : null;

  // Check preconditions for hardcoded secrets/PII
  const preFindings = detectPiiOrSecrets(input.preConditions);
  for (const f of preFindings) {
    issues.push({
      id: `pre-pii-${f.type}`,
      rule: 'hardcoded_secret_or_pii',
      severity: 'error',
      title: `Preconditions: ${f.label}`,
      suggestion: 'Replace real credentials or PII with a project {{VARIABLE}} or synthetic test description.',
    });
  }

  steps.forEach((s, idx) => {
    const order = typeof s.order === 'number' ? s.order : idx + 1;
    const stepText = (s.step ?? s.description ?? '').trim();
    const expectedText = (s.expectedResult ?? s.expected_result ?? '').trim();
    const dataText = (s.data ?? '').trim();
    const isSharedStep = Boolean(s.reusableStepId || s.reusable_step_id);
    const isLastStep = idx === steps.length - 1;

    // 1. Missing or generic expected result (skip if linked to a ReusableStep which carries its own checks)
    if (!isSharedStep) {
      if (!expectedText) {
        const hasCaseLevelExpected = Boolean((input.caseExpectedResult || '').trim());
        issues.push({
          id: `step-${order}-missing-expected`,
          rule: 'missing_expected_result',
          severity: isLastStep && !hasCaseLevelExpected ? 'error' : 'warning',
          stepOrder: order,
          title: `Step ${order}: Missing expected result`,
          suggestion: isLastStep
            ? 'The final step must state an observable outcome that proves the test case passed.'
            : 'Add a verifiable checkpoint or merge this action into the next step.',
        });
      } else if (GENERIC_EXPECTED_RESULTS.has(expectedText.toLowerCase().replace(/[.!]+$/, '').trim())) {
        issues.push({
          id: `step-${order}-generic-expected`,
          rule: 'generic_expected_result',
          severity: 'warning',
          stepOrder: order,
          title: `Step ${order}: Vague expected result ("${expectedText}")`,
          suggestion: 'State the specific UI change, message, or state transition observed after this step.',
        });
      }
    }

    const combinedStepText = `${stepText} ${expectedText} ${dataText}`;

    // 2. Unresolved {{ENV_VAR}} references
    if (knownVars) {
      const referencedVars = extractEnvironmentVariableKeys(combinedStepText);
      for (const vKey of referencedVars) {
        if (!knownVars.has(vKey.toUpperCase())) {
          issues.push({
            id: `step-${order}-var-${vKey}`,
            rule: 'unresolved_variable',
            severity: 'error',
            stepOrder: order,
            title: `Step ${order}: Undefined variable {{${vKey}}}`,
            suggestion: `Create {{${vKey}}} in Configuration → Variables or fix the variable key spelling.`,
          });
        }
      }
    }

    // 3. Unresolved {param} dataset parameter references
    if (knownParams) {
      const referencedParams = extractDatasetParameterKeys(combinedStepText);
      for (const pKey of referencedParams) {
        if (!knownParams.has(pKey.toLowerCase())) {
          issues.push({
            id: `step-${order}-param-${pKey}`,
            rule: 'unresolved_parameter',
            severity: 'error',
            stepOrder: order,
            title: `Step ${order}: Undefined parameter {${pKey}}`,
            suggestion: `Add column "${pKey.toLowerCase()}" to the case's Parameters / Dataset table.`,
          });
        }
      }
    }

    // 4. Hardcoded URLs that should use {{BASE_URL}} or Environment config
    const urlInspectText = `${stepText} ${dataText}`;
    const urlMatches = Array.from(urlInspectText.matchAll(RAW_URL_REGEX)).map((m) => m[0]);
    if (urlMatches.length > 0) {
      const rawUrl = urlMatches[0];
      let matchedSuggestion = 'Replace hardcoded URL with an environment variable (e.g. {{BASE_URL}}) so the case runs across DEV/STAGING/UAT.';

      if (input.variableValueToKeyMap) {
        for (const [val, key] of Object.entries(input.variableValueToKeyMap)) {
          if (val && rawUrl.toLowerCase().startsWith(val.toLowerCase())) {
            matchedSuggestion = `Matches existing variable {{${key}}} — use {{${key}}} instead of "${rawUrl}".`;
            break;
          }
        }
      }
      if (input.environmentUrls && input.environmentUrls.length > 0) {
        const matchedEnv = input.environmentUrls.find(
          (e) => e.baseUrl && rawUrl.toLowerCase().startsWith(e.baseUrl.toLowerCase())
        );
        if (matchedEnv) {
          matchedSuggestion = `Hardcodes ${matchedEnv.name} URL ("${matchedEnv.baseUrl}"). Use an environment variable like {{BASE_URL}} instead.`;
        }
      }

      issues.push({
        id: `step-${order}-url`,
        rule: 'hardcoded_url',
        severity: 'warning',
        stepOrder: order,
        title: `Step ${order}: Hardcoded URL (${rawUrl.length > 40 ? rawUrl.slice(0, 37) + '...' : rawUrl})`,
        suggestion: matchedSuggestion,
      });
    }

    // 5. Hardcoded secrets or real PII in step / data
    const stepPii = detectPiiOrSecrets(`${stepText} ${dataText}`);
    for (const finding of stepPii) {
      issues.push({
        id: `step-${order}-pii-${finding.type}`,
        rule: 'hardcoded_secret_or_pii',
        severity: 'error',
        stepOrder: order,
        title: `Step ${order}: ${finding.label}`,
        suggestion:
          finding.type === 'SECRET'
            ? 'Move credentials/tokens into a masked Variable (Configuration → Variables with Secret enabled).'
            : 'Avoid real customer PII (PAN/Aadhaar) in repository test steps; describe the data type or use a parameter.',
      });
    }
  });

  // 6. Step count bloat check
  if (steps.length > 8) {
    issues.push({
      id: 'case-step-count-bloat',
      rule: 'step_count_bloat',
      severity: 'info',
      title: `${steps.length} steps in case (recommended: 3–6 goal-oriented steps)`,
      suggestion: 'Consider merging consecutive clicks/inputs that lead to a single verification, or use AI Improve Steps.',
    });
  }

  return issues;
}
