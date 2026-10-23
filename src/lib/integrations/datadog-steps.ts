/**
 * Shared Datadog Synthetic test → InkaTest step builders.
 *
 * Used by both the import dialog (client) and the re-sync server action so a
 * linked Datadog case always gets real, source-derived steps (never a guessed
 * or empty structure).
 *
 * Design rules:
 *  - Steps are stored as readable sentences plus a compact metadata blob
 *    (stepId, flag badges, subtest group, source test id, variable names).
 *  - The raw Datadog step object is NEVER stored: no params, no locators, no
 *    XPath, no HTML, no JSON in the UI.
 *  - Re-sync re-fetches the definition and regenerates everything.
 */

/** Compact, display-safe metadata stored on each imported step. */
export interface DatadogStepMeta {
  provider: 'datadog';
  /** Datadog step id (result matching key). */
  stepId?: string;
  /** Datadog public id of the test this step was defined on. */
  testPublicId?: string;
  /** Public id of the subtest this step came from (nested groups). */
  sourcePublicId?: string;
  /** Collapsible subtest group header (tag already stripped). */
  subtestGroup?: string;
  /** Only non-default flags are recorded. */
  badges: string[];
  /** Variable names referenced by this step, without `{{ }}`. */
  variablesUsed: string[];
  testType: 'browser' | 'api';
  /** Displayed when nested subtest steps could not be loaded. */
  unresolved?: boolean;
}

export interface BuiltStep {
  order: number;
  step: string;
  expectedResult?: string;
  /** JSON-encoded DatadogStepMeta. */
  meta?: string;
  /**
   * Kept for API compatibility with older call sites. Datadog steps never use
   * it (raw provider data is not stored).
   */
  data?: string;
}

export type DatadogStepBadge =
  | 'Optional'
  | 'Non-critical'
  | 'Always runs'
  | 'Ends test if passed';

const VARIABLE_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

export function datadogVariablesIn(text: string | undefined | null): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(VARIABLE_RE)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Strip `[SUBTEST]`-style tags Datadog adds to referenced test names. */
export function stripSubtestTag(name: string | undefined | null): string {
  return String(name || '')
    .replace(/\[\s*subtest[^\]]*\]/gi, '')
    .replace(/^[\s\-:]+|[\s\-:]+$/g, '')
    .trim();
}

export function parseDatadogStepMeta(raw: string | null | undefined): DatadogStepMeta | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || parsed.provider !== 'datadog') return null;
    return {
      provider: 'datadog',
      stepId: typeof parsed.stepId === 'string' ? parsed.stepId : undefined,
      testPublicId: typeof parsed.testPublicId === 'string' ? parsed.testPublicId : undefined,
      sourcePublicId: typeof parsed.sourcePublicId === 'string' ? parsed.sourcePublicId : undefined,
      subtestGroup:
        typeof parsed.subtestGroup === 'string' && parsed.subtestGroup.trim()
          ? parsed.subtestGroup.trim()
          : undefined,
      badges: Array.isArray(parsed.badges) ? parsed.badges.map(String) : [],
      variablesUsed: Array.isArray(parsed.variablesUsed)
        ? parsed.variablesUsed.map(String).filter(Boolean)
        : [],
      testType: parsed.testType === 'api' ? 'api' : 'browser',
      unresolved: parsed.unresolved === true,
    };
  } catch {
    return null;
  }
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function collapse(value: unknown, max = 80): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function smartCase(label: string): string {
  // Only restore casing for plain lower-case words. Prices, times and paths
  // ("14,980/year*", "9:00 am", "a/b") must stay exactly as provided.
  if (!/^[a-z][a-z'’\s]*$/.test(label)) return label;
  return label.replace(/\b[a-z][a-z'’]*/g, (word) =>
    word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word
  );
}

/* ------------------------------------------------------------------ *
 * Element target resolution (never XPath / locator text)
 * ------------------------------------------------------------------ */

interface LocatorCandidate {
  text?: string;
  textType?: string;
  tagName?: string;
}

function locatorCandidates(element: any): LocatorCandidate[] {
  const co = element?.multiLocator?.co;
  if (Array.isArray(co)) return co;
  if (typeof co === 'string' && co.trim()) {
    try {
      const parsed = JSON.parse(co);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function pickCandidate(element: any, textType: string, max = 80): string | undefined {
  const wanted = textType.toLowerCase();
  const hit = locatorCandidates(element).find(
    (candidate) =>
      String(candidate?.textType || '').toLowerCase() === wanted &&
      String(candidate?.text || '').trim()
  );
  return hit?.text ? collapse(hit.text, max) : undefined;
}

/**
 * Read an attribute out of a Datadog locator without ever displaying the
 * locator itself. Supports both `@name="x"` and
 * `@*[local-name()="aria-label"]="x"` shapes.
 */
function locatorAttribute(locators: string, attribute: string): string | undefined {
  if (!locators) return undefined;
  const safe = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`@\\*\\[\\s*local-name\\(\\)\\s*=\\s*["']${safe}["']\\s*\\]\\s*=\\s*["']([^"']+)["']`, 'i'),
    new RegExp(`@${safe}\\s*=\\s*["']([^"']+)["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = locators.match(pattern);
    if (match?.[1]) return collapse(match[1]);
  }
  return undefined;
}

function tagFromLocator(locators: string): string | undefined {
  if (!locators) return undefined;
  const local = locators.match(/local-name\(\)\s*=\s*["']([a-zA-Z][a-zA-Z0-9]*)["']/);
  if (local?.[1]) return local[1].toLowerCase();
  const axis = locators.match(/::([a-zA-Z][a-zA-Z0-9]*)\s*\[/) || locators.match(/\/\/([a-zA-Z][a-zA-Z0-9]*)\s*\[/);
  if (axis?.[1] && axis[1] !== '*') return axis[1].toLowerCase();
  return undefined;
}

function elementKind(step: any, element: any, locators: string): string | undefined {
  const name = String(step?.name || '').toLowerCase();
  if (/\bbutton\b/.test(name)) return 'button';
  if (/\blink\b/.test(name)) return 'link';
  if (/\bpath\b/.test(name)) return 'link';
  if (/\bcheckbox\b/.test(name)) return 'checkbox';
  if (/\bdropdown\b/.test(name)) return 'dropdown';

  const fromCandidate = locatorCandidates(element)
    .map((candidate) => String(candidate?.tagName || '').toLowerCase())
    .find(Boolean);
  const tag = fromCandidate || tagFromLocator(locators);
  if (tag) {
    if (tag === 'input') {
      if (/@type\s*=\s*["']checkbox["']/i.test(locators)) return 'checkbox';
      if (/@type\s*=\s*["']submit["']/i.test(locators)) return 'button';
      return 'field';
    }
    if (tag === 'textarea') return 'field';
    if (tag === 'select') return 'dropdown';
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'img') return 'image';
  }
  if (/@type\s*=\s*["']checkbox["']/i.test(locators)) return 'checkbox';
  if (/@placeholder\s*=/i.test(locators)) return 'field';
  if (/@name\s*=\s*["']is[A-Z][A-Za-z]*["']/.test(locators)) return 'checkbox';
  return undefined;
}

/** Quoted target embedded in Datadog's own (user-editable) step name. */
function quotedFromName(name: string): string | undefined {
  const quoted = [...String(name || '').matchAll(/"([^"]{1,80})"/g)]
    .map((m) => m[1].trim())
    // Datadog truncates long element names with an ellipsis; prefer the real
    // aria-label/placeholder from the element definition over a truncated name.
    .filter((value) => value && !/(\.\.\.|…)$/.test(value));
  return quoted.find(Boolean);
}

/** Unquoted target from an interaction sentence name ("Click on Start Now"). */
function unquotedTargetFromName(name: string): string | undefined {
  const text = String(name || '').trim();
  const patterns = [
    /^(?:click|tap|double\s*click)\s+(?:on|over)?\s*(?:button|link|path|element|field|input|checkbox|dropdown|option|tab|the)?\s*(.+)$/i,
    /^(?:type\s*text|enter\s*text|type|enter)\s+(?:on|in|into)?\s*(?:the)?\s*(?:input|field|element)?\s*(.+)$/i,
    /^(?:select|choose)\s+(.+?)\s+(?:from|in)\s+(?:the\s+)?(?:dropdown|select)$/i,
    /^(?:select|choose)\s+(.+)$/i,
    /^(?:hover)\s+(?:over|on)?\s*(?:the)?\s*(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const target = match[1]
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/^(?:button|link|path|element|field|input|checkbox|dropdown|option|tab)\s+/i, '')
        .trim();
      if (target && !/(\.\.\.|…)$/.test(target)) return target;
    }
  }
  return undefined;
}

function preferStepNameCasing(label: string, stepName: string): string {
  const quoted = [...String(stepName || '').matchAll(/"([^"]{1,80})"/g)].map((m) => m[1].trim());
  const match = quoted.find((candidate) => {
    const a = normalizeKey(candidate);
    const b = normalizeKey(label);
    return a === b || (b.length > 3 && (a.includes(b) || b.includes(a)));
  });
  return match || label;
}

export interface ResolvedTarget {
  label: string;
  kind?: string;
}

/**
 * Target priority (per spec): user-defined step/element name → placeholder →
 * aria-label → visible text → input name attribute → "element".
 */
export function resolveDatadogTarget(step: any): ResolvedTarget {
  const element = step?.params?.element;
  const locators = [element?.multiLocator?.at, element?.multiLocator?.ro, element?.selector]
    .filter((value) => typeof value === 'string' && value)
    .join('\n');
  const stepName = String(step?.name || '');

  // [candidate, cameFromProviderCandidateText]
  const candidates: Array<[string | undefined, boolean]> = [
    [typeof element?.name === 'string' ? element.name : undefined, false],
    [quotedFromName(stepName), false],
    [unquotedTargetFromName(stepName), false],
    [locatorAttribute(locators, 'placeholder'), false],
    [typeof element?.placeholder === 'string' ? element.placeholder : undefined, false],
    [pickCandidate(element, 'placeholder'), true],
    [locatorAttribute(locators, 'aria-label'), false],
    [typeof element?.['aria-label'] === 'string' ? element['aria-label'] : undefined, false],
    [typeof element?.ariaLabel === 'string' ? element.ariaLabel : undefined, false],
    [pickCandidate(element, 'aria-label'), true],
    [pickCandidate(element, 'directText'), true],
    [pickCandidate(element, 'innerText', 60), true],
    [locatorAttribute(locators, 'title'), false],
    [pickCandidate(element, 'alt'), true],
    [locatorAttribute(locators, 'name'), false],
  ];

  const found = candidates.find(([value]) => typeof value === 'string' && value.trim());
  let label = collapse(found?.[0] || 'element', 80);
  // Datadog's candidate text is lower-cased; restore readable casing for it
  // only, never for the user's own step/element name.
  if (found?.[1]) label = smartCase(label);
  label = preferStepNameCasing(label, stepName);
  return { label: label || 'element', kind: elementKind(step, element, locators) };
}

function targetPhrase(target: ResolvedTarget): string {
  return target.kind ? `the "${target.label}" ${target.kind}` : `"${target.label}"`;
}

function isVariable(value: string): boolean {
  return /^\s*\{\{\s*[A-Za-z0-9_.-]+\s*\}\}\s*$/.test(value);
}

function formatValue(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return 'text';
  if (isVariable(text)) return text; // renders as a variable chip
  return `"${collapse(text, 120)}"`;
}

function checkVerb(check: unknown): string {
  const normalized = String(check || '').toLowerCase();
  if (normalized === 'equals' || normalized === 'equal' || normalized === 'is') return 'equals';
  if (normalized === 'notcontains' || normalized === 'not_contains') return 'does not contain';
  if (normalized === 'matches' || normalized === 'match') return 'matches';
  if (normalized === 'notmatches' || normalized === 'not_matches') return 'does not match';
  return normalized || 'contains';
}

function waitSeconds(step: any): number | undefined {
  const raw = step?.params?.value ?? step?.value;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  // Datadog wait values are seconds; tolerate millisecond payloads.
  return numeric > 600 ? Math.round(numeric / 1000) : Math.round(numeric);
}

function interactionExpected(): string | undefined {
  // Interaction steps carry no assertion: leave Expected Result empty rather
  // than inventing a result the provider never evaluated.
  return undefined;
}

function assertionAction(name: string, fallback: string): string {
  const cleaned = String(name || '')
    .replace(/^\s*(test|verify|check|assert)\s+/i, '')
    .trim();
  return cleaned ? `Verify ${cleaned}` : `Verify ${fallback}`;
}

function browserStepAction(step: any): { action: string; expected?: string } {
  const type = String(step?.type || '').toLowerCase();
  const name = collapse(step?.name, 120);
  const params = step?.params || {};
  const value = params?.value ?? step?.value ?? '';
  const target = resolveDatadogTarget(step);

  switch (type) {
    case 'click':
      return { action: `Click ${targetPhrase(target)}`, expected: interactionExpected() };
    case 'typetext':
      return {
        action: value !== '' && value !== undefined
          ? `Enter ${formatValue(value)} in ${targetPhrase(target)}`
          : `Enter text in ${targetPhrase(target)}`,
        expected: interactionExpected(),
      };
    case 'selectoption':
    case 'select':
      return {
        action: value !== '' && value !== undefined
          ? `Select ${formatValue(value)} in ${targetPhrase(target)}`
          : `Select an option in ${targetPhrase(target)}`,
        expected: interactionExpected(),
      };
    case 'gotourl':
    case 'navigation':
      return { action: `Go to ${String(value || 'the configured URL')}`, expected: interactionExpected() };
    case 'refresh':
      return { action: 'Refresh the page', expected: interactionExpected() };
    case 'wait': {
      const seconds = waitSeconds(step);
      return {
        action: seconds ? `Wait ${seconds} seconds` : 'Wait',
        expected: interactionExpected(),
      };
    }
    case 'hover':
      return { action: `Hover over ${targetPhrase(target)}`, expected: interactionExpected() };
    case 'presskey':
      return {
        action: value !== '' && value !== undefined ? `Press the "${String(value)}" key` : 'Press a key',
        expected: interactionExpected(),
      };
    case 'scroll':
      return {
        action: target.label !== 'element' ? `Scroll to ${targetPhrase(target)}` : 'Scroll the page',
        expected: interactionExpected(),
      };
    case 'uploadfiles':
      return { action: `Upload a file to ${targetPhrase(target)}`, expected: interactionExpected() };

    case 'assertelementcontent':
      return {
        action: assertionAction(name, `${targetPhrase(target)} content`),
        expected: `Element "${target.label}" text ${checkVerb(params?.check)} ${formatValue(value)}`,
      };
    case 'assertelementlackscontent':
      return {
        action: assertionAction(name, `${targetPhrase(target)} content`),
        expected: `Element "${target.label}" text ${checkVerb(params?.check || 'notcontains')} ${formatValue(value)}`,
      };
    case 'assertelementpresent':
      return {
        action: assertionAction(name, `${targetPhrase(target)} is present`),
        expected: `Element "${target.label}" is present`,
      };
    case 'assertcurrenturl':
      return {
        action: assertionAction(name, 'current page URL'),
        expected: `URL ${checkVerb(params?.check)} ${formatValue(value)}`,
      };
    case 'assertpagecontains':
      return {
        action: assertionAction(name, 'page content'),
        expected: `Page contains ${formatValue(value)}`,
      };
    case 'assertpagelacks':
    case 'assertpagedoesnotcontain':
      return {
        action: assertionAction(name, 'page content'),
        expected: `Page does not contain ${formatValue(value)}`,
      };

    case 'extractfromjavascript':
    case 'extractvariable': {
      const variableName =
        params?.variable?.name || params?.variableName || params?.name || '';
      return {
        action: variableName
          ? `Extract ${formatValue(`{{ ${variableName} }}`)} from the page`
          : 'Extract a value from the page',
        expected: variableName ? `Variable "${variableName}" is captured` : undefined,
      };
    }

    default:
      // Unknown types: keep Datadog's own human name unchanged.
      return {
        action: name || `Datadog step (${step?.type || 'unknown'})`,
        expected: /^(test|verify|check|assert)\b/i.test(name)
          ? 'Assertion details are not exposed by the Datadog API — review this step in Datadog.'
          : interactionExpected(),
      };
  }
}

function stepBadges(step: any): DatadogStepBadge[] {
  const badges: DatadogStepBadge[] = [];
  if (step?.allowFailure === true) badges.push('Optional');
  if (step?.isCritical === false) badges.push('Non-critical');
  if (step?.alwaysExecute === true) badges.push('Always runs');
  if (step?.exitIfSucceed === true) badges.push('Ends test if passed');
  return badges;
}

function buildMeta(options: {
  step?: any;
  testPublicId?: string;
  testType: 'browser' | 'api';
  subtestGroup?: string;
  sourcePublicId?: string;
  action: string;
  expected?: string;
  unresolved?: boolean;
}): string {
  const meta: DatadogStepMeta = {
    provider: 'datadog',
    stepId: options.step?.public_id || options.step?.id || undefined,
    testPublicId: options.testPublicId,
    sourcePublicId: options.sourcePublicId || options.testPublicId,
    subtestGroup: options.subtestGroup || undefined,
    badges: options.step ? stepBadges(options.step) : [],
    variablesUsed: [
      ...new Set([
        ...datadogVariablesIn(options.action),
        ...datadogVariablesIn(options.expected),
      ]),
    ],
    testType: options.testType,
    unresolved: options.unresolved || undefined,
  };
  return JSON.stringify(meta);
}

/* ------------------------------------------------------------------ *
 * API / multistep tests
 * ------------------------------------------------------------------ */

function operatorVerb(operator: unknown): string {
  const normalized = String(operator || '').toLowerCase();
  if (normalized === 'is' || normalized === 'equals' || normalized === 'equal' || normalized === '==') return 'equals';
  if (normalized === 'isnot' || normalized === 'not_equals' || normalized === '!=') return 'does not equal';
  if (normalized === 'contains') return 'contains';
  if (normalized === 'notcontains' || normalized === 'not_contains') return 'does not contain';
  if (normalized === 'matches') return 'matches';
  if (normalized === 'notmatches') return 'does not match';
  if (normalized === 'isempty') return 'is empty';
  if (normalized === 'lessthan') return 'is less than';
  if (normalized === 'morethan' || normalized === 'greaterthan') return 'is greater than';
  return normalized || 'matches';
}

function assertionSubject(assertion: any): string {
  const type = String(assertion?.type || '').toLowerCase();
  const property = String(
    assertion?.property || assertion?.target_property || assertion?.path || ''
  ).trim();
  if (type === 'statuscode' || type === 'status_code') return 'status code';
  if (type === 'responsetime' || type === 'response_time') return 'response time';
  if (type === 'body') {
    const path = property.replace(/^body\.?/i, '');
    return path ? `response body ${path}` : 'response body';
  }
  if (type === 'header' || type === 'headers') {
    return property ? `response header ${property}` : 'response header';
  }
  if (property) return property.replace(/([a-z])([A-Z])/g, '$1 $2');
  const target = String(assertion?.target || '').trim();
  if (target && !/^\d+$/.test(target)) return target;
  return type || 'value';
}

function assertionCondition(assertion: any): string {
  const type = String(assertion?.type || '').toLowerCase();
  const subject = assertionSubject(assertion);
  const verb = operatorVerb(assertion?.operator || assertion?.assertion);
  let expected =
    assertion?.expected ?? assertion?.expectedValue ?? assertion?.value ?? assertion?.target_value;
  if (expected === undefined || expected === null || expected === '') {
    if (['statuscode', 'status_code', 'responsetime', 'response_time'].includes(type)) {
      expected = assertion?.target;
    }
  }
  const value = expected === undefined || expected === null ? '' : String(expected);
  return value ? `${subject} ${verb} "${collapse(value, 120)}"` : `${subject} ${verb}`;
}

function assertionActionLabel(assertion: any): string {
  const description = collapse(assertion?.description || assertion?.name, 120);
  if (description) return description;
  return assertionCondition(assertion);
}

export function buildDatadogApiSteps(test: any, orderStart = 1): BuiltStep[] {
  const config = test?.config || {};
  const request = config?.request || {};
  const method = String(request?.method || test?.method || 'GET').toUpperCase();
  const url = request?.url || request?.uri || test?.url || '';
  const built: BuiltStep[] = [];
  const action = `Execute ${method} ${url}`.trim();
  const expected = 'Request returns a successful response';
  built.push({
    order: orderStart,
    step: action,
    expectedResult: expected,
    meta: buildMeta({
      step: undefined,
      testPublicId: test?.public_id,
      testType: 'api',
      action,
      expected,
    }),
  });

  const assertions = Array.isArray(config?.assertions) ? config.assertions : [];
  // No silent fallback: never fabricate assertion steps. If the source test has
  // no assertions the case still gets its real Execute step.
  assertions.forEach((assertion: any, index: number) => {
    const assertAction = `Verify ${assertionActionLabel(assertion)}`;
    const assertExpected = assertionCondition(assertion);
    built.push({
      order: orderStart + 1 + index,
      step: assertAction,
      expectedResult: assertExpected,
      meta: buildMeta({
        step: undefined,
        testPublicId: test?.public_id,
        testType: 'api',
        action: assertAction,
        expected: assertExpected,
      }),
    });
  });
  return built;
}

/* ------------------------------------------------------------------ *
 * Browser tests (including nested subtests)
 * ------------------------------------------------------------------ */

/** Extract the ordered browser step array from either supported Datadog shape. */
export function datadogBrowserSteps(test: any): any[] {
  const config = test?.config || {};
  if (Array.isArray(test?.steps)) return test.steps;
  if (Array.isArray(config?.steps)) return config.steps;
  return [];
}

function datadogSubtestId(step: any): string | undefined {
  return (
    step?.subtestPublicId ||
    step?.subTestPublicId ||
    step?.subtest_public_id ||
    step?.subtestId ||
    step?.subtest?.public_id ||
    step?.params?.subtestPublicId ||
    step?.params?.subTestPublicId ||
    step?.params?.subtest_public_id ||
    step?.params?.sub_test_public_id ||
    undefined
  );
}

export function buildDatadogBrowserSteps(test: any, orderStart = 1): BuiltStep[] {
  const config = test?.config || {};
  const stepsConfig = datadogBrowserSteps(test);
  const subTests = Array.isArray(config?.subTests) ? config.subTests : [];
  const built: BuiltStep[] = [];
  let order = orderStart;

  const addStep = (
    step: any,
    context: { group?: string; sourcePublicId?: string; depth: number } = { depth: 0 }
  ) => {
    if (!step || context.depth > 8) return;
    const type = String(step?.type || '').toLowerCase();
    const rawName = collapse(step?.name, 120);
    const stepGroup = stripSubtestTag(step?.subtestName) || undefined;
    const group = context.group || stepGroup;
    const sourcePublicId = context.sourcePublicId || step?.sourcePublicId;

    // Referenced subtest wrapper: inline child steps under a group header.
    if (
      type === 'playsubtest' ||
      type === 'subtest' ||
      type === 'subtest-unavailable' ||
      datadogSubtestId(step)
    ) {
      const childSteps = Array.isArray(step?.subSteps) ? step.subSteps : [];
      const childSource = step?.sourcePublicId || datadogSubtestId(step) || context.sourcePublicId;
      const childGroup =
        stripSubtestTag(step?.subtestName || step?.subtest?.name || rawName) || 'Subtest';
      if (childSteps.length > 0) {
        for (const child of childSteps) {
          addStep(child, {
            group: stripSubtestTag(child?.subtestName || childGroup) || childGroup,
            sourcePublicId: child?.sourcePublicId || childSource,
            depth: context.depth + 1,
          });
        }
        return;
      }
      const action = `Load subtest "${stripSubtestTag(childGroup)}"`;
      const expected = 'Subtest steps could not be loaded from Datadog — use Re-sync to retry.';
      built.push({
        order: order++,
        step: action,
        expectedResult: expected,
        meta: buildMeta({
          step,
          testPublicId: test?.public_id,
          testType: 'browser',
          subtestGroup: stripSubtestTag(childGroup),
          sourcePublicId: childSource,
          action,
          expected,
          unresolved: true,
        }),
      });
      return;
    }

    const { action, expected } = browserStepAction(step);
    built.push({
      order: order++,
      step: action,
      expectedResult: expected,
      meta: buildMeta({
        step,
        testPublicId: test?.public_id,
        testType: 'browser',
        subtestGroup: group,
        sourcePublicId: sourcePublicId,
        action,
        expected,
      }),
    });

    // Some shapes nest child steps directly on a regular step.
    if (Array.isArray(step?.subSteps) && step.subSteps.length > 0) {
      const nestedGroup = stripSubtestTag(step?.subtestName || rawName) || group;
      for (const child of step.subSteps) {
        addStep(child, {
          group: nestedGroup,
          sourcePublicId: child?.sourcePublicId || sourcePublicId,
          depth: context.depth + 1,
        });
      }
    }
  };

  stepsConfig.forEach((step: any) => addStep(step, { depth: 0 }));

  // Legacy shape: config.subTests with inline steps.
  for (const subTest of subTests) {
    const group = stripSubtestTag(subTest?.name || subTest?.title || 'Subtest') || 'Subtest';
    const inlineSteps = Array.isArray(subTest?.steps) ? subTest.steps : [];
    if (inlineSteps.length === 0) {
      const action = `Load subtest "${group}"`;
      const expected = 'Subtest steps could not be loaded from Datadog — use Re-sync to retry.';
      built.push({
        order: order++,
        step: action,
        expectedResult: expected,
        meta: buildMeta({
          step: undefined,
          testPublicId: test?.public_id,
          testType: 'browser',
          subtestGroup: group,
          sourcePublicId: subTest?.public_id,
          action,
          expected,
          unresolved: true,
        }),
      });
      continue;
    }
    for (const step of inlineSteps) {
      addStep(step, {
        group: stripSubtestTag(step?.subtestName || group) || group,
        sourcePublicId: subTest?.public_id,
        depth: 1,
      });
    }
  }

  return built;
}

export function buildDatadogSteps(test: any): BuiltStep[] {
  const testType = String(test?.type || 'api').toLowerCase() === 'browser' ? 'browser' : 'api';
  return testType === 'browser'
    ? buildDatadogBrowserSteps(test, 1)
    : buildDatadogApiSteps(test, 1);
}

/**
 * Match provider results to imported steps by Datadog stepId only.
 * Results whose stepId is unknown are returned as unmatched (never guessed by
 * name or position). Results without a stepId cannot be matched and are not
 * reported as unmatched (legacy payloads).
 */
export function matchDatadogResults<
  S extends { order: number; step: string; meta?: string | null },
  R extends { stepId?: string; name: string }
>(
  steps: S[],
  results: R[]
): { matched: Array<{ result: R; step: S }>; unmatched: R[]; stepByResult: Map<R, S> } {
  const stepByProviderId = new Map<string, S>();
  for (const step of steps) {
    const meta = parseDatadogStepMeta(step.meta);
    if (meta?.stepId) stepByProviderId.set(meta.stepId, step);
  }
  const matched: Array<{ result: R; step: S }> = [];
  const unmatched: R[] = [];
  const stepByResult = new Map<R, S>();
  for (const result of results) {
    const step = result.stepId ? stepByProviderId.get(result.stepId) : undefined;
    if (step) {
      matched.push({ result, step });
      stepByResult.set(result, step);
    } else if (result.stepId) {
      unmatched.push(result);
    }
  }
  return { matched, unmatched, stepByResult };
}

/** Every distinct variable referenced by the built steps (no values). */
export function collectDatadogVariablesUsed(steps: BuiltStep[]): string[] {
  const found = new Set<string>();
  for (const step of steps) {
    for (const name of datadogVariablesIn(step.step)) found.add(name);
    for (const name of datadogVariablesIn(step.expectedResult)) found.add(name);
    const meta = parseDatadogStepMeta(step.meta);
    for (const name of meta?.variablesUsed || []) found.add(name);
  }
  return [...found];
}

/** Scheduled/CI start URL, kept as-written so `{{ VAR }}` stays a chip. */
export function datadogStartUrl(test: any): string | undefined {
  const url = test?.config?.request?.url || test?.config?.url;
  return typeof url === 'string' && url.trim() ? url.trim() : undefined;
}

/**
 * Readable pre-conditions block: Start URL, test type, variables used.
 * Never includes a value, only variable names.
 */
export function buildDatadogPreConditions(test: any, steps: BuiltStep[]): string {
  const testType = String(test?.type || 'api').toLowerCase() === 'browser' ? 'Browser' : 'API';
  const lines: string[] = [];
  const startUrl = datadogStartUrl(test);
  if (startUrl) lines.push(`Start URL: ${startUrl}`);
  lines.push(`Test type: ${testType} (Datadog Synthetic)`);
  const variables = [
    ...new Set([...collectDatadogVariablesUsed(steps), ...datadogVariablesIn(startUrl)]),
  ];
  if (variables.length > 0) lines.push(`Variables used: ${variables.join(', ')}`);
  return lines.join('\n');
}
