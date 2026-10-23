import { describe, expect, it } from 'vitest';
import {
  buildDatadogPreConditions,
  buildDatadogSteps,
  collectDatadogVariablesUsed,
  datadogVariablesIn,
  matchDatadogResults,
  parseDatadogStepMeta,
  resolveDatadogTarget,
  stripSubtestTag,
} from '@/lib/integrations/datadog-steps';

const co = (value: unknown) => JSON.stringify(value);

/** Shape taken from a real Datadog browser test definition (locators trimmed). */
const browserTest = {
  public_id: 'yeh-sxw-6nu',
  name: 'Fetch Health Premium from Charts',
  type: 'browser',
  config: {
    request: { url: 'https://{{ UAT }}.inkasure.com/' },
    steps: [
      {
        type: 'click',
        name: 'Click on "Send OTP"',
        public_id: 'pu5-gue-5gd',
        params: {
          element: {
            multiLocator: { at: '', ro: '//*[text()[normalize-space(.) = "send otp"]]', co: co([{ text: 'send otp', textType: 'directText' }]) },
          },
        },
      },
      {
        type: 'typeText',
        name: 'Type text on input "mobile"',
        public_id: 'zz2-b8v-mkg',
        params: {
          value: '2100000849',
          element: {
            multiLocator: {
              at: '/descendant::*[@name="mobile" and @placeholder="Enter Mobile Number"]',
              ro: '//*[@name="mobile"]',
              co: co([{ text: 'enter mobile number', textType: 'placeholder' }]),
            },
          },
        },
      },
      {
        type: 'typeText',
        name: 'Type text on input "Please enter OTP character ..."',
        public_id: 'ry8-4we-5qw',
        params: {
          value: '{{ MAGIC_OTP }}',
          element: {
            multiLocator: {
              at: '/descendant::*[@*[local-name()="aria-label"]="Please enter OTP character 1" and @name="otp"]',
              ro: '//*[@*[local-name()="aria-label"]="Please enter OTP character 1"]',
              co: co([{ text: 'please enter otp character 1', textType: 'aria-label', tagName: 'INPUT' }]),
            },
          },
        },
      },
      { type: 'wait', name: 'Wait', public_id: 'cx9-5mr-79u', params: { value: 10 } },
      {
        type: 'goToUrl',
        name: 'Navigate to Onboarding Url',
        public_id: 'kq7-9ef-3wr',
        params: { value: '{{ ONBOARDING_URL }}' },
      },
      {
        type: 'assertElementContent',
        name: 'Test "Book a Call" card',
        public_id: '7m5-c7w-kt9',
        params: {
          value: 'Book a Call',
          check: 'contains',
          element: {
            multiLocator: {
              at: '',
              ro: '//*[contains(@class, " w-full ")]/*/*/*/*/*[local-name()="button"]',
              co: co([{ text: 'book a call', textType: 'directText' }]),
            },
          },
        },
      },
      {
        type: 'assertCurrentUrl',
        name: "Test active page URL's content",
        public_id: 'vb2-9sy-67d',
        params: { value: '{{ DASHBOARD_URL }}', check: 'contains' },
      },
      {
        type: 'assertElementPresent',
        name: 'Verify content is present',
        public_id: 'gwa-wy2-cgx',
        params: {
          element: {
            multiLocator: {
              at: '/descendant::*[@href="https://example.test/author/" and @title="View all posts by Dhruv Shah"]',
              ro: null,
              co: co([{ text: 'dhruv shah', textType: 'directText' }]),
            },
          },
        },
      },
      {
        type: 'click',
        name: 'Select Privacy and T&C',
        public_id: 'xim-c2x-3cq',
        params: {
          element: {
            multiLocator: {
              at: '/descendant::*[@name="isTermsChecked" and @type="checkbox"]',
              ro: '//*[@name="isTermsChecked"]',
              co: co([]),
            },
          },
        },
        allowFailure: true,
        isCritical: false,
        alwaysExecute: true,
        exitIfSucceed: true,
      },
      {
        type: 'someFutureStep',
        name: 'Do something Datadog added later',
        public_id: 'future-1',
        params: {},
      },
    ],
  },
};

describe('Datadog step sentences', () => {
  const steps = buildDatadogSteps(browserTest);
  const text = steps.map((s) => s.step);

  it('builds one readable step per Datadog step', () => {
    expect(steps).toHaveLength(browserTest.config.steps.length);
    expect(steps.map((s) => s.order)).toEqual(steps.map((_, i) => i + 1));
  });

  it('never renders locator/XPath/HTML/JSON', () => {
    const serialized = JSON.stringify(steps);
    expect(serialized).not.toContain('multiLocator');
    expect(serialized).not.toMatch(/local-name\(\)/);
    expect(serialized).not.toMatch(/descendant::/);
    expect(serialized).not.toContain('targetOuterHTML');
    expect(serialized).not.toContain('<input');
  });

  it('maps interaction steps to short sentences', () => {
    expect(text[0]).toBe('Click "Send OTP"');
    expect(text[1]).toBe('Enter "2100000849" in the "mobile" field');
    expect(text[2]).toBe('Enter {{ MAGIC_OTP }} in the "Please enter OTP character 1" field');
    expect(text[3]).toBe('Wait 10 seconds');
    expect(text[4]).toBe('Go to {{ ONBOARDING_URL }}');
    expect(text[8]).toBe('Click the "Privacy and T&C" checkbox');
  });

  it('leaves interaction steps without an invented expected result', () => {
    for (const index of [0, 1, 2, 3, 4, 8]) {
      expect(steps[index].expectedResult).toBeUndefined();
    }
  });

  it('maps assertion steps to Verify + condition', () => {
    expect(text[5]).toBe('Verify "Book a Call" card');
    expect(steps[5].expectedResult).toBe('Element "Book a Call" text contains "Book a Call"');

    expect(text[6]).toBe("Verify active page URL's content");
    expect(steps[6].expectedResult).toBe('URL contains {{ DASHBOARD_URL }}');

    expect(text[7]).toBe('Verify content is present');
    expect(steps[7].expectedResult).toBe('Element "Dhruv Shah" is present');
  });

  it('keeps Datadog step names for unknown types', () => {
    expect(text[9]).toBe('Do something Datadog added later');
  });

  it('renders variables as names without braces', () => {
    expect(datadogVariablesIn(text[2])).toEqual(['MAGIC_OTP']);
    expect(datadogVariablesIn(text[4])).toEqual(['ONBOARDING_URL']);
    expect(collectDatadogVariablesUsed(steps)).toEqual([
      'MAGIC_OTP',
      'ONBOARDING_URL',
      'DASHBOARD_URL',
    ]);
  });

  it('never stores secure-variable values (only names)', () => {
    const serialized = JSON.stringify(steps);
    expect(serialized).toContain('MAGIC_OTP');
    expect(serialized).not.toMatch(/MAGIC_OTP\s*[:=]\s*["']?\d{4,}/);
  });
});

describe('Datadog flag badges', () => {
  const steps = buildDatadogSteps(browserTest);
  const meta = steps.map((s) => parseDatadogStepMeta(s.meta));

  it('records only non-default flags', () => {
    expect(meta[0]?.badges).toEqual([]);
    expect(meta[8]?.badges).toEqual(['Optional', 'Non-critical', 'Always runs', 'Ends test if passed']);
  });

  it('records the Datadog stepId for result matching', () => {
    expect(meta[0]?.stepId).toBe('pu5-gue-5gd');
    expect(meta[5]?.stepId).toBe('7m5-c7w-kt9');
    expect(meta[9]?.stepId).toBe('future-1');
  });
});

describe('Datadog subtest grouping', () => {
  const testWithSubtest = {
    public_id: 'parent-test',
    type: 'browser',
    config: {
      steps: [
        { type: 'goToUrl', name: 'Navigate to home', public_id: 's0', params: { value: 'https://example.test' } },
        {
          type: 'playSubtest',
          name: 'Run booking journey',
          public_id: 's1',
          subtestName: '[SUBTEST] Booking Journey',
          sourcePublicId: 'sub-1',
          subSteps: [
            { type: 'click', name: 'Click on "Book a Call"', public_id: 'sub-step-1', params: {} },
            { type: 'wait', name: 'Wait', public_id: 'sub-step-2', params: { value: 5 } },
          ],
        },
        { type: 'refresh', name: 'Refresh page', public_id: 's3', params: {} },
      ],
    },
  };
  const steps = buildDatadogSteps(testWithSubtest);
  const metas = steps.map((s) => parseDatadogStepMeta(s.meta));

  it('flattens nested steps and counts them', () => {
    expect(steps.map((s) => s.step)).toEqual([
      'Go to https://example.test',
      'Click "Book a Call"',
      'Wait 5 seconds',
      'Refresh the page',
    ]);
  });

  it('does not prefix step text with the subtest name', () => {
    for (const step of steps) expect(step.step).not.toContain('[Subtest');
    expect(steps[1].step).not.toContain('Booking Journey');
  });

  it('carries the group name and source public id as metadata', () => {
    expect(metas[0]?.subtestGroup).toBeUndefined();
    expect(metas[1]?.subtestGroup).toBe('Booking Journey');
    expect(metas[2]?.subtestGroup).toBe('Booking Journey');
    expect(metas[1]?.sourcePublicId).toBe('sub-1');
    expect(metas[3]?.subtestGroup).toBeUndefined();
  });

  it('strips [SUBTEST] tags', () => {
    expect(stripSubtestTag('[SUBTEST] Booking Journey')).toBe('Booking Journey');
    expect(stripSubtestTag('[Subtest: Login] Sign in')).toBe('Sign in');
  });

  it('preserves sourcePublicId on every nested step', () => {
    for (const meta of metas.slice(1, 3)) expect(meta?.sourcePublicId).toBe('sub-1');
  });

  it('shows an explicit unresolved step when a subtest cannot be loaded', () => {
    const unavailable = {
      public_id: 'parent-missing',
      type: 'browser',
      config: {
        steps: [
          {
            type: 'subtest-unavailable',
            name: 'Run booking journey',
            subtestName: 'Booking Journey',
            sourcePublicId: 'sub-missing',
            params: {},
          },
        ],
      },
    };
    const [step] = buildDatadogSteps(unavailable);
    expect(step.step).toBe('Load subtest "Booking Journey"');
    expect(step.expectedResult).toContain('Re-sync');
    expect(parseDatadogStepMeta(step.meta)?.unresolved).toBe(true);
  });

  it('keeps groups for resolver-inlined steps carrying subtestName', () => {
    const flat = {
      public_id: 'parent-flat',
      type: 'browser',
      config: {
        steps: [
          { type: 'click', name: 'Click on "A"', public_id: 'a', params: {}, subtestName: '[SUBTEST] Group A', sourcePublicId: 'sub-9' },
          { type: 'click', name: 'Click on "B"', public_id: 'b', params: {} },
        ],
      },
    };
    const metas = buildDatadogSteps(flat).map((s) => parseDatadogStepMeta(s.meta));
    expect(metas[0]?.subtestGroup).toBe('Group A');
    expect(metas[0]?.sourcePublicId).toBe('sub-9');
    expect(metas[1]?.subtestGroup).toBeUndefined();
  });
});

describe('Datadog target resolution', () => {
  it('prefers user-defined names and never XPath', () => {
    const target = resolveDatadogTarget(browserTest.config.steps[1]);
    expect(target.label).toBe('mobile');
  });

  it('uses aria-label and element kind when available', () => {
    const target = resolveDatadogTarget(browserTest.config.steps[2]);
    expect(target).toEqual({ label: 'Please enter OTP character 1', kind: 'field' });
  });

  it('falls back to visible text and smart casing', () => {
    const target = resolveDatadogTarget(browserTest.config.steps[7]);
    expect(target.label).toBe('Dhruv Shah');
  });

  it('detects checkbox kind', () => {
    expect(resolveDatadogTarget(browserTest.config.steps[8]).kind).toBe('checkbox');
  });

  it('does not re-case prices, times or paths', () => {
    const priceStep = {
      type: 'assertElementContent',
      name: 'Test price',
      params: {
        value: '₹14,980/year*',
        check: 'contains',
        element: { multiLocator: { co: co([{ text: '14,980/year*', textType: 'directText' }]) } },
      },
    };
    expect(resolveDatadogTarget(priceStep).label).toBe('14,980/year*');
    const timeStep = {
      type: 'click',
      name: 'Click on first slot',
      params: {
        element: { multiLocator: { co: co([{ text: '9:00 am', textType: 'directText' }]) } },
      },
    };
    // The user-defined step name wins over provider candidate text.
    expect(resolveDatadogTarget(timeStep).label).toBe('first slot');
  });
});

describe('Datadog pre-conditions', () => {
  it('lists start URL, test type and variables used', () => {
    const steps = buildDatadogSteps(browserTest);
    expect(buildDatadogPreConditions(browserTest, steps)).toBe(
      [
        'Start URL: https://{{ UAT }}.inkasure.com/',
        'Test type: Browser (Datadog Synthetic)',
        'Variables used: MAGIC_OTP, ONBOARDING_URL, DASHBOARD_URL, UAT',
      ].join('\n')
    );
  });
});

describe('Datadog API steps', () => {
  const apiTest = {
    public_id: 'api-test',
    type: 'api',
    config: {
      request: { method: 'POST', url: 'https://api.example.test/orders' },
      assertions: [
        { type: 'statusCode', operator: 'equals', target: 201 },
        { type: 'body', property: 'body.data.id', operator: 'matches', expected: '^ord_' },
      ],
    },
  };
  const steps = buildDatadogSteps(apiTest);

  it('builds an Execute step plus real assertions', () => {
    expect(steps.map((s) => s.step)).toEqual([
      'Execute POST https://api.example.test/orders',
      'Verify status code equals "201"',
      'Verify response body data.id matches "^ord_"',
    ]);
  });

  it('always gives assertions an expected result', () => {
    expect(steps[1].expectedResult).toBe('status code equals "201"');
    expect(steps[2].expectedResult).toBe('response body data.id matches "^ord_"');
  });
});

describe('Datadog result matching by stepId', () => {
  const steps = buildDatadogSteps(browserTest);

  it('matches results to imported steps by stepId only', () => {
    const { matched, unmatched } = matchDatadogResults(steps, [
      { stepId: 'pu5-gue-5gd', name: 'Clicked something' },
      { stepId: '7m5-c7w-kt9', name: 'Assertion passed' },
    ]);
    expect(matched).toHaveLength(2);
    expect(unmatched).toHaveLength(0);
    expect(matched[0].step.step).toBe(steps[0].step);
    expect(matched[1].step.step).toBe(steps[5].step);
  });

  it('never guesses by name or position', () => {
    const { matched, unmatched } = matchDatadogResults(steps, [
      // Same name as an imported step but a stepId that no longer exists.
      { stepId: 'deleted-step', name: steps[0].step },
    ]);
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].stepId).toBe('deleted-step');
  });

  it('ignores results with no stepId (legacy payloads)', () => {
    const { matched, unmatched } = matchDatadogResults(steps, [{ name: 'Legacy result' }]);
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
  });
});

describe('parseDatadogStepMeta', () => {
  it('rejects non-Datadog or malformed metadata', () => {
    expect(parseDatadogStepMeta(null)).toBeNull();
    expect(parseDatadogStepMeta('not json')).toBeNull();
    expect(parseDatadogStepMeta(JSON.stringify({ provider: 'postman' }))).toBeNull();
  });

  it('returns a safe, display-only shape', () => {
    const meta = parseDatadogStepMeta(
      JSON.stringify({
        provider: 'datadog',
        stepId: 'abc',
        badges: ['Optional'],
        variablesUsed: ['UAT'],
        testType: 'browser',
        params: { element: 'raw should be ignored' },
      })
    );
    expect(meta).toMatchObject({
      provider: 'datadog',
      stepId: 'abc',
      badges: ['Optional'],
      variablesUsed: ['UAT'],
      testType: 'browser',
    });
    expect(JSON.stringify(meta)).not.toContain('raw should be ignored');
  });
});
