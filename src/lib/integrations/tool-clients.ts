import vm from 'node:vm';
import { decrypt } from '@/lib/crypto';
import { validateDestinationUrl } from '@/lib/network/ssrf-guard';

export type ToolProviderId = 'confluence' | 'notion' | 'figma' | 'postman' | 'datadog';

export interface ConfluenceIntegrationConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  defaultSpaceKey?: string;
}

export interface NotionIntegrationConfig {
  apiToken: string;
  defaultDatabaseId?: string;
}

export interface FigmaIntegrationConfig {
  accessToken: string;
  defaultTeamId?: string;
}

export interface PostmanIntegrationConfig {
  apiKey: string;
  workspaceId?: string;
  /** Maps InkaTest Environment Name (e.g. 'DEV', 'STAGING', 'UAT', 'PROD') -> Postman Environment UID */
  envMapping?: Record<string, string>;
  defaultDelayMs?: number;
  defaultTimeoutMs?: number;
  bailOnFailure?: boolean;
  persistResponses?: boolean;
  turnOffLogs?: boolean;
  keepVariableValues?: boolean;
  ignoreCookies?: boolean;
  saveCookies?: boolean;
  alertOnMissingEnvVars?: boolean;
}

export interface DatadogIntegrationConfig {
  site: string;
  apiKey: string;
  appKey: string;
  /** Maps InkaTest Environment Name (e.g. 'DEV', 'STAGING', 'PROD') -> Start URL */
  envStartUrls?: Record<string, string>;
  defaultExecutionRule?: 'blocking' | 'non_blocking' | 'skipped';
  defaultPollingTimeoutMs?: number;
}

export interface ToolConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  meta?: Record<string, any>;
}

/**
 * Deterministically interpolates both {{VAR}} (Postman / InkaTest env variables)
 * and {param} (InkaTest dataset parameters) in URLs, headers, and request bodies.
 */
export function resolveParameterizedTemplate(
  template: string,
  variables: Record<string, string>
): string {
  if (!template) return '';

  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(variables)) {
    if (v !== undefined && v !== null) {
      lookup.set(k, String(v));
      lookup.set(k.toLowerCase(), String(v));
      lookup.set(k.toUpperCase(), String(v));
    }
  }

  let resolved = template;
  // Multi-pass (up to 3 passes) to resolve nested Postman variables like base_api_url -> {{host}}/api
  for (let pass = 0; pass < 3; pass++) {
    const prev = resolved;
    // 1. Replace {{VAR_NAME}}
    resolved = resolved.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (full, key: string) => {
      const val = lookup.get(key) ?? lookup.get(key.toLowerCase()) ?? lookup.get(key.toUpperCase());
      return val !== undefined ? val : full;
    });

    // 2. Replace single {param} tokens (only simple identifier tokens, never JSON objects which contain quotes/colons)
    resolved = resolved.replace(/(?<!\{)\{\s*([a-zA-Z0-9_]+)\s*\}(?!\})/g, (full, key: string) => {
      const val = lookup.get(key) ?? lookup.get(key.toLowerCase());
      return val !== undefined ? val : full;
    });
    if (resolved === prev) break;
  }

  return resolved;
}

// ============================================================================
// 1. CONFLUENCE CLIENT
// ============================================================================

export async function testConfluenceConnection(
  config: ConfluenceIntegrationConfig
): Promise<ToolConnectionTestResult> {
  const start = Date.now();
  const baseUrl = (config.baseUrl || '').trim().replace(/\/+$/, '');
  const email = (config.email || '').trim();
  const token = decrypt((config.apiToken || '').trim());

  if (!baseUrl || !token) {
    return { success: false, message: 'Confluence Base URL and API Token are required.' };
  }

  const targetUrl = baseUrl.endsWith('/wiki')
    ? `${baseUrl}/rest/api/space?limit=3`
    : `${baseUrl}/wiki/rest/api/space?limit=3`;

  try {
    await validateDestinationUrl(targetUrl);
  } catch (urlErr: any) {
    return { success: false, message: urlErr?.message || 'Invalid Confluence URL' };
  }

  const authHeader = email
    ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
    : `Bearer ${token}`;

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        success: false,
        message: `Confluence returned HTTP ${res.status} (${res.statusText})`,
        latencyMs,
      };
    }

    const data = await res.json().catch(() => ({}));
    const count = Array.isArray(data?.results) ? data.results.length : 0;
    return {
      success: true,
      message: `Connected to Confluence (${count} space${count === 1 ? '' : 's'} accessible)`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Confluence connection failed: ${err?.message || 'Network error'}`,
      latencyMs: Date.now() - start,
    };
  }
}

// ============================================================================
// 2. NOTION CLIENT
// ============================================================================

export async function testNotionConnection(
  config: NotionIntegrationConfig
): Promise<ToolConnectionTestResult> {
  const start = Date.now();
  const token = decrypt((config.apiToken || '').trim());
  if (!token) {
    return { success: false, message: 'Notion Integration Token is required.' };
  }

  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        success: false,
        message: `Notion API returned HTTP ${res.status}`,
        latencyMs,
      };
    }

    const data = await res.json().catch(() => ({}));
    const botName = data?.name || data?.bot?.owner?.workspace_name || 'Notion Bot';
    return {
      success: true,
      message: `Connected to Notion as "${botName}"`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Notion connection failed: ${err?.message || 'Network error'}`,
      latencyMs: Date.now() - start,
    };
  }
}

// ============================================================================
// 3. FIGMA CLIENT
// ============================================================================

export async function testFigmaConnection(
  config: FigmaIntegrationConfig
): Promise<ToolConnectionTestResult> {
  const start = Date.now();
  const token = decrypt((config.accessToken || '').trim());
  if (!token) {
    return { success: false, message: 'Figma Personal Access Token is required.' };
  }

  try {
    const res = await fetch('https://api.figma.com/v1/me', {
      method: 'GET',
      headers: {
        'X-Figma-Token': token,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        success: false,
        message: `Figma API returned HTTP ${res.status}`,
        latencyMs,
      };
    }

    const data = await res.json().catch(() => ({}));
    return {
      success: true,
      message: `Connected to Figma (${data?.handle || data?.email || 'Verified'})`,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Figma connection failed: ${err?.message || 'Network error'}`,
      latencyMs: Date.now() - start,
    };
  }
}

// ============================================================================
// 4. POSTMAN CLIENT & PARAMETERIZED COLLECTION RUNNER
// ============================================================================

export interface PostmanCatalogItem {
  id: string;
  uid: string;
  name: string;
}

export async function testPostmanConnection(
  config: PostmanIntegrationConfig
): Promise<ToolConnectionTestResult> {
  const start = Date.now();
  const apiKey = decrypt((config.apiKey || '').trim());
  if (!apiKey) {
    return { success: false, message: 'Postman API Key (PMAK-...) is required.' };
  }

  try {
    const wsQuery = config.workspaceId ? `?workspace=${encodeURIComponent(config.workspaceId.trim())}` : '';
    const [meRes, colRes, envRes] = await Promise.all([
      fetch('https://api.getpostman.com/me', {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`https://api.getpostman.com/collections${wsQuery}`, {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      }).catch(() => null),
      fetch(`https://api.getpostman.com/environments${wsQuery}`, {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      }).catch(() => null),
    ]);

    const latencyMs = Date.now() - start;
    if (!meRes.ok) {
      return {
        success: false,
        message: `Postman API returned HTTP ${meRes.status}. Check your PMAK API key.`,
        latencyMs,
      };
    }

    const meData = await meRes.json().catch(() => ({}));
    const colData = colRes && colRes.ok ? await colRes.json().catch(() => ({})) : {};
    const envData = envRes && envRes.ok ? await envRes.json().catch(() => ({})) : {};

    const collections: PostmanCatalogItem[] = (colData?.collections || []).map((c: any) => ({
      id: c.id,
      uid: c.uid || c.id,
      name: c.name,
    }));
    const environments: PostmanCatalogItem[] = (envData?.environments || []).map((e: any) => ({
      id: e.id,
      uid: e.uid || e.id,
      name: e.name,
    }));

    const userLabel = meData?.user?.username || meData?.user?.fullName || meData?.user?.email || 'Postman User';
    return {
      success: true,
      message: `Connected as ${userLabel} · ${collections.length} collection(s), ${environments.length} environment(s)`,
      latencyMs,
      meta: { collections, environments },
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Postman connection failed: ${err?.message || 'Network error'}`,
      latencyMs: Date.now() - start,
    };
  }
}

export interface PostmanRequestDetailedSpec {
  order: number;
  name: string;
  folderPath: string;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string; description?: string }>;
  auth?: { type: string; details: Record<string, string> };
  bodyMode?: string;
  bodyRaw?: string;
  formDataFields?: Array<{ key: string; value: string; type?: string }>;
  preRequestScript?: string;
  testScript?: string;
  assertions?: string[];
  requiredVariables?: string[];
  curlCommand?: string;
}

export interface PostmanCollectionRequestItem {
  order: number;
  /** Stable Postman request item id (never use array order for linking). */
  requestId?: string;
  /** Stable Postman folder item id when the request lives inside a folder. */
  folderId?: string;
  name: string;
  folderPath: string;
  method: string;
  url: string;
  description?: string;
  curlCommand?: string;
  bodyPreview?: string;
  assertions?: string[];
  chainsVariables?: boolean;
  requiredVariables?: string[];
  requestSpec?: PostmanRequestDetailedSpec;
}

export interface PostmanAttachmentFilePayload {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  downloadUrl?: string;
}

export interface PostmanRunOptions {
  collectionUid: string;
  folderOrRequestFilter?: string;
  selectedRequestOrders?: number[];
  environmentName?: string;
  postmanEnvUidOverride?: string;
  inkaVariables?: Record<string, string>;
  attachmentFiles?: Record<string, PostmanAttachmentFilePayload>;
  datasetParams?: Record<string, string>;
  iterationRows?: Record<string, string>[];
  iterations?: number;
  delayMs?: number;
  timeoutMs?: number;
  maxLatencyMs?: number;
  bailOnFailure?: boolean;
  persistResponses?: boolean;
  turnOffLogs?: boolean;
  keepVariableValues?: boolean;
  ignoreCookies?: boolean;
  saveCookies?: boolean;
  skipStepOrders?: number[];
  expectedStatusCodes?: number[];
}

export interface PostmanAssertionResult {
  name: string;
  passed: boolean;
  error?: string;
  /**
   * True when the failure came from the emulated `pm` script runtime itself
   * (unsupported API, thrown exception) rather than from a product assertion.
   * These are reported as Error, never as a failed test.
   */
  scriptError?: boolean;
}

export interface StepApiExecutionRecord {
  method: string;
  url: string;
  statusCode?: number;
  statusText?: string;
  durationMs: number;
  assertions?: PostmanAssertionResult[];
  responseBody?: string;
  /** Actual response headers captured from the provider, when available. */
  responseHeaders?: Record<string, string>;
  errorDetail?: string;
}

export interface ExternalStepExecutionItem {
  order: number;
  name: string;
  status: 'pass' | 'fail' | 'error' | 'skip';
  durationMs: number;
  detail: string;
  /** Provider step id (Datadog `stepId`) used to match imported steps. */
  stepId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  statusText?: string;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  assertions?: PostmanAssertionResult[];
  /** Provider-native sub-steps (e.g. Datadog Synthetic browser/API steps). */
  subSteps?: ExternalStepExecutionItem[];
  /** Failure diagnostics from the provider, when available. */
  failureMessage?: string;
  /** Datadog artifact bucket key for a captured screenshot (not a public URL). */
  screenshotBucketKey?: string;
  /** Absolute screenshot URL, only when the provider returns one directly. */
  screenshotUrl?: string;
  /** Captured request/response for API-type provider steps. */
  apiExecution?: StepApiExecutionRecord;
  /** Direct link to the provider's result page for this execution. */
  externalResultUrl?: string;
}

export interface ExternalTestExecutionResult {
  provider: 'postman' | 'datadog';
  /**
   * PENDING   — execution triggered, result not yet available (async monitor).
   * UNAVAILABLE — monitoring expiry reached without a terminal provider result.
   * Neither PENDING nor UNAVAILABLE is a test failure.
   */
  overallStatus: 'PASS' | 'FAIL' | 'ERROR' | 'SKIP' | 'PENDING' | 'UNAVAILABLE';
  totalDurationMs: number;
  avgLatencyMs?: number;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  summary: string;
  stepResults: Record<
    string,
    {
      status: 'pass' | 'fail' | 'error' | 'skip' | 'pending' | 'unavailable';
      note?: string;
      apiExecution?: StepApiExecutionRecord;
      subSteps?: ExternalStepExecutionItem[];
      failureMessage?: string;
      externalResultUrl?: string;
    }
  >;
  steps: ExternalStepExecutionItem[];
  automationLog: string;
  externalUrl?: string;
  createdRunId?: string;
  /** Present while an async external execution is being monitored. */
  monitor?: {
    id: string;
    provider: 'datadog';
    status: string;
    deadlineAt: string;
  };
}


interface FlattenedPostmanEntry {
  order: number;
  id: string;
  folderId?: string;
  name: string;
  folderPath: string;
  request: any;
  event?: any[];
  inheritedAuth?: any;
}

function collectRawPostmanEntries(
  items: any[],
  parentPath = '',
  counter = { value: 0 },
  parentAuth: any = undefined,
  parentEvents: any[] = [],
  parentFolderId?: string
): FlattenedPostmanEntry[] {
  const flat: FlattenedPostmanEntry[] = [];
  for (const item of items || []) {
    const effectiveAuth = item.auth || parentAuth;
    const effectiveEvents = [
      ...parentEvents,
      ...(Array.isArray(item.event) ? item.event : []),
    ];
    if (Array.isArray(item.item)) {
      const nextPath = parentPath ? `${parentPath} / ${item.name}` : item.name || '';
      const folderId = String(item.id || item._postman_id || parentFolderId || '');
      flat.push(
        ...collectRawPostmanEntries(item.item, nextPath, counter, effectiveAuth, effectiveEvents, folderId)
      );
    } else if (item.request) {
      counter.value += 1;
      flat.push({
        order: counter.value,
        id: String(item.id || item._postman_id || ''),
        folderId: parentFolderId,
        name: item.name || 'Unnamed Request',
        folderPath: parentPath,
        request: item.request,
        event: effectiveEvents.length > 0 ? effectiveEvents : undefined,
        inheritedAuth: effectiveAuth,
      });
    }
  }
  return flat;
}

export function extractPostmanAssertions(events?: any[]): string[] {
  if (!Array.isArray(events)) return [];
  const assertions: string[] = [];
  for (const ev of events) {
    if (ev?.listen !== 'test') continue;
    const exec = ev?.script?.exec;
    const scriptText = Array.isArray(exec)
      ? exec.join('\n')
      : typeof exec === 'string'
      ? exec
      : '';
    if (!scriptText) continue;

    const pmTestRegex = /pm\.test\(\s*(['"`])([\s\S]*?)\1/g;
    let match: RegExpExecArray | null;
    while ((match = pmTestRegex.exec(scriptText)) !== null) {
      const title = match[2].trim();
      if (title && !assertions.includes(title)) {
        assertions.push(title);
      }
    }

    const legacyTestRegex = /tests\[\s*(['"`])([\s\S]*?)\1\s*\]/g;
    while ((match = legacyTestRegex.exec(scriptText)) !== null) {
      const title = match[2].trim();
      if (title && !assertions.includes(title)) {
        assertions.push(title);
      }
    }
  }
  return assertions;
}

function createChaiExpect(actual: any, negated = false): any {
  const check = (cond: boolean, msg: string) => {
    const ok = negated ? !cond : cond;
    if (!ok) {
      throw new Error(negated ? `Expected NOT: ${msg}` : msg);
    }
  };

  const getType = (val: any): string => {
    if (val === null) return 'null';
    if (Array.isArray(val)) return 'array';
    if (val instanceof RegExp) return 'regexp';
    if (val instanceof Date) return 'date';
    return typeof val;
  };

  const deepEqual = (a: any, b: any): boolean => {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return a === b;
    }
  };

  const target: Record<string, any> = {
    equal(expected: any, msg?: string) {
      check(actual === expected, msg || `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      return proxy;
    },
    equals(expected: any, msg?: string) {
      return target.equal(expected, msg);
    },
    eq(expected: any, msg?: string) {
      return target.equal(expected, msg);
    },
    eql(expected: any, msg?: string) {
      check(deepEqual(actual, expected), msg || `expected ${JSON.stringify(actual)} to deeply equal ${JSON.stringify(expected)}`);
      return proxy;
    },
    eqls(expected: any, msg?: string) {
      return target.eql(expected, msg);
    },
    a(type: string, msg?: string) {
      const t = String(type || '').toLowerCase();
      const actualType = getType(actual);
      check(actualType === t, msg || `expected ${JSON.stringify(actual)} to be a ${t} (got ${actualType})`);
      return proxy;
    },
    an(type: string, msg?: string) {
      return target.a(type, msg);
    },
    include(val: any, msg?: string) {
      let cond = false;
      if (typeof actual === 'string') {
        cond = actual.includes(String(val));
      } else if (Array.isArray(actual)) {
        cond = actual.some((item) => deepEqual(item, val) || item === val);
      } else if (actual && typeof actual === 'object' && val && typeof val === 'object') {
        cond = Object.entries(val).every(([k, v]) => deepEqual(actual[k], v));
      } else if (actual && typeof actual === 'object') {
        cond = String(val) in actual;
      }
      check(cond, msg || `expected ${JSON.stringify(actual)} to include ${JSON.stringify(val)}`);
      return proxy;
    },
    includes(val: any, msg?: string) {
      return target.include(val, msg);
    },
    contain(val: any, msg?: string) {
      return target.include(val, msg);
    },
    contains(val: any, msg?: string) {
      return target.include(val, msg);
    },
    property(name: string, val?: any, msg?: string) {
      const hasProp =
        actual !== null &&
        actual !== undefined &&
        (Object.prototype.hasOwnProperty.call(actual, name) || name in Object(actual));
      check(hasProp, msg || `expected object to have property '${name}'`);
      if (arguments.length >= 2 && !negated) {
        const propVal = actual?.[name];
        check(
          deepEqual(propVal, val) || propVal === val,
          msg || `expected property '${name}' to equal ${JSON.stringify(val)}, got ${JSON.stringify(propVal)}`
        );
        return createChaiExpect(propVal, false);
      }
      return hasProp ? createChaiExpect(actual?.[name], negated) : proxy;
    },
    ownProperty(name: string, msg?: string) {
      const hasOwn = actual !== null && actual !== undefined && Object.prototype.hasOwnProperty.call(actual, name);
      check(hasOwn, msg || `expected object to have own property '${name}'`);
      return proxy;
    },
    lengthOf(n: number, msg?: string) {
      const len = actual?.length ?? (actual && typeof actual === 'object' ? Object.keys(actual).length : -1);
      check(len === n, msg || `expected length ${n}, got ${len}`);
      return proxy;
    },
    above(n: number, msg?: string) {
      const val = typeof actual === 'number' ? actual : Number(actual?.length ?? actual);
      check(val > n, msg || `expected ${val} to be above ${n}`);
      return proxy;
    },
    gt(n: number, msg?: string) {
      return target.above(n, msg);
    },
    greaterThan(n: number, msg?: string) {
      return target.above(n, msg);
    },
    least(n: number, msg?: string) {
      const val = typeof actual === 'number' ? actual : Number(actual?.length ?? actual);
      check(val >= n, msg || `expected ${val} to be at least ${n}`);
      return proxy;
    },
    gte(n: number, msg?: string) {
      return target.least(n, msg);
    },
    below(n: number, msg?: string) {
      const val = typeof actual === 'number' ? actual : Number(actual?.length ?? actual);
      check(val < n, msg || `expected ${val} to be below ${n}`);
      return proxy;
    },
    lt(n: number, msg?: string) {
      return target.below(n, msg);
    },
    lessThan(n: number, msg?: string) {
      return target.below(n, msg);
    },
    most(n: number, msg?: string) {
      const val = typeof actual === 'number' ? actual : Number(actual?.length ?? actual);
      check(val <= n, msg || `expected ${val} to be at most ${n}`);
      return proxy;
    },
    lte(n: number, msg?: string) {
      return target.most(n, msg);
    },
    within(min: number, max: number, msg?: string) {
      const val = typeof actual === 'number' ? actual : Number(actual?.length ?? actual);
      check(val >= min && val <= max, msg || `expected ${val} to be within ${min}..${max}`);
      return proxy;
    },
    match(re: RegExp, msg?: string) {
      check(re instanceof RegExp && re.test(String(actual ?? '')), msg || `expected ${JSON.stringify(actual)} to match ${re}`);
      return proxy;
    },
    string(substr: string, msg?: string) {
      check(typeof actual === 'string' && actual.includes(substr), msg || `expected string to contain "${substr}"`);
      return proxy;
    },
    keys(...keys: any[]) {
      const expectedKeys = Array.isArray(keys[0]) ? keys[0] : keys;
      const actualKeys = actual && typeof actual === 'object' ? Object.keys(actual) : [];
      const hasAll = expectedKeys.every((k: any) => actualKeys.includes(String(k)));
      check(hasAll, `expected object to have keys ${JSON.stringify(expectedKeys)}`);
      return proxy;
    },
    oneOf(list: any[], msg?: string) {
      check(Array.isArray(list) && list.includes(actual), msg || `expected ${JSON.stringify(actual)} to be one of ${JSON.stringify(list)}`);
      return proxy;
    },
  };

  const chainGetters = new Set([
    'to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have',
    'with', 'at', 'of', 'same', 'but', 'does', 'still', 'deep', 'all', 'any',
  ]);

  const proxy: any = new Proxy(target, {
    get(obj, prop: string) {
      if (prop === 'not') {
        return createChaiExpect(actual, !negated);
      }
      if (chainGetters.has(prop)) {
        return proxy;
      }
      if (prop === 'ok') {
        check(Boolean(actual), `expected ${JSON.stringify(actual)} to be truthy`);
        return proxy;
      }
      if (prop === 'true') {
        check(actual === true, `expected ${JSON.stringify(actual)} to be true`);
        return proxy;
      }
      if (prop === 'false') {
        check(actual === false, `expected ${JSON.stringify(actual)} to be false`);
        return proxy;
      }
      if (prop === 'null') {
        check(actual === null, `expected ${JSON.stringify(actual)} to be null`);
        return proxy;
      }
      if (prop === 'undefined') {
        check(actual === undefined, `expected ${JSON.stringify(actual)} to be undefined`);
        return proxy;
      }
      if (prop === 'exist') {
        check(actual !== null && actual !== undefined, `expected value to exist (got ${actual})`);
        return proxy;
      }
      if (prop === 'empty') {
        const isEmpty =
          actual === '' ||
          (Array.isArray(actual) && actual.length === 0) ||
          (actual && typeof actual === 'object' && Object.keys(actual).length === 0);
        check(Boolean(isEmpty), `expected ${JSON.stringify(actual)} to be empty`);
        return proxy;
      }
      return obj[prop];
    },
  });

  return proxy;
}

export function runPostmanTestScripts(params: {
  events?: any[];
  statusCode: number;
  statusText: string;
  durationMs: number;
  responseText: string;
  responseHeaders: Record<string, string>;
  variables: Record<string, string>;
}): {
  assertions: PostmanAssertionResult[];
  updatedVariables: Record<string, string>;
  consoleLogs: string[];
} {
  const {
    events,
    statusCode,
    statusText,
    durationMs,
    responseText,
    responseHeaders,
    variables,
  } = params;

  const assertions: PostmanAssertionResult[] = [];
  const updatedVariables: Record<string, string> = { ...variables };
  const consoleLogs: string[] = [];

  if (!Array.isArray(events) || events.length === 0) {
    return { assertions, updatedVariables, consoleLogs };
  }

  const testScripts: string[] = [];
  for (const ev of events) {
    if (ev?.listen !== 'test') continue;
    const exec = ev?.script?.exec;
    const code = Array.isArray(exec)
      ? exec.join('\n')
      : typeof exec === 'string'
      ? exec
      : '';
    if (code.trim()) {
      testScripts.push(code);
    }
  }

  if (testScripts.length === 0) {
    return { assertions, updatedVariables, consoleLogs };
  }

  let parsedJson: any = undefined;
  let jsonParseError: Error | null = null;
  try {
    parsedJson = responseText ? JSON.parse(responseText) : undefined;
  } catch (e: any) {
    jsonParseError = e;
  }

  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(responseHeaders || {})) {
    lowerHeaders[k.toLowerCase()] = v;
  }

  const makeVarStore = () => ({
    get(key: string) {
      return updatedVariables[key];
    },
    set(key: string, val: any) {
      if (key) {
        updatedVariables[String(key)] = val !== undefined && val !== null ? String(val) : '';
      }
    },
    unset(key: string) {
      delete updatedVariables[String(key)];
    },
    has(key: string) {
      return Object.prototype.hasOwnProperty.call(updatedVariables, key);
    },
    toObject() {
      return { ...updatedVariables };
    },
    replaceIn(template: string) {
      return resolveParameterizedTemplate(String(template || ''), updatedVariables);
    },
  });

  const varStore = makeVarStore();
  const legacyTests: Record<string, any> = {};

  const pmResponseTo = {
    have: {
      status(expected: number | string) {
        if (typeof expected === 'number') {
          if (statusCode !== expected) {
            throw new Error(`expected response to have status code ${expected} but got ${statusCode}`);
          }
        } else if (String(statusText).toLowerCase() !== String(expected).toLowerCase()) {
          throw new Error(`expected response to have status "${expected}" but got "${statusText}" (${statusCode})`);
        }
      },
      header(key: string, expectedVal?: string) {
        const actualVal = lowerHeaders[String(key || '').toLowerCase()];
        if (actualVal === undefined) {
          throw new Error(`expected response to have header "${key}"`);
        }
        if (expectedVal !== undefined && !actualVal.toLowerCase().includes(String(expectedVal).toLowerCase())) {
          throw new Error(`expected header "${key}" to match "${expectedVal}", got "${actualVal}"`);
        }
      },
      body(expected?: string | RegExp) {
        if (expected === undefined) {
          if (!responseText) throw new Error('expected response to have non-empty body');
          return;
        }
        if (expected instanceof RegExp) {
          if (!expected.test(responseText)) {
            throw new Error(`expected response body to match ${expected}`);
          }
        } else if (responseText !== expected && !responseText.includes(String(expected))) {
          throw new Error(`expected response body to match "${expected}"`);
        }
      },
      jsonBody(pathOrExpected?: string | Record<string, any>, expectedValue?: any) {
        if (jsonParseError) {
          throw new Error(`expected valid JSON response body (${jsonParseError.message})`);
        }
        if (typeof pathOrExpected === 'string' && pathOrExpected.trim()) {
          const parts = pathOrExpected.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
          let cur = parsedJson;
          for (const p of parts) {
            if (cur === null || cur === undefined || !(p in Object(cur))) {
              throw new Error(`expected JSON body to have path "${pathOrExpected}"`);
            }
            cur = cur[p];
          }
          if (expectedValue !== undefined && cur !== expectedValue) {
            throw new Error(`expected JSON path "${pathOrExpected}" to equal ${JSON.stringify(expectedValue)}, got ${JSON.stringify(cur)}`);
          }
        }
      },
      jsonSchema() {
        if (jsonParseError) {
          throw new Error(`expected valid JSON response body for schema check`);
        }
      },
    },
    be: {
      get ok() {
        if (statusCode < 200 || statusCode >= 300) {
          throw new Error(`expected 2xx status code but got ${statusCode}`);
        }
        return true;
      },
      get success() {
        if (statusCode < 200 || statusCode >= 300) {
          throw new Error(`expected 2xx status code but got ${statusCode}`);
        }
        return true;
      },
      get json() {
        if (jsonParseError) {
          throw new Error(`expected valid JSON response (${jsonParseError.message})`);
        }
        return true;
      },
      get error() {
        if (statusCode < 400) {
          throw new Error(`expected 4xx/5xx error status but got ${statusCode}`);
        }
        return true;
      },
      get clientError() {
        if (statusCode < 400 || statusCode >= 500) {
          throw new Error(`expected 4xx status code but got ${statusCode}`);
        }
        return true;
      },
      get serverError() {
        if (statusCode < 500) {
          throw new Error(`expected 5xx status code but got ${statusCode}`);
        }
        return true;
      },
    },
  };

  const pm = {
    // InkaTest already fixes the request order, so Postman's control-flow API is
    // a no-op. Without it, scripts that call `pm.execution.setNextRequest(...)`
    // or the legacy `postman.setNextRequest(...)` crash the whole test script
    // and produce a false failure.
    setNextRequest: (_next?: string | null) => {},
    execution: {
      setNextRequest: (_next?: string | null) => {},
      location: { current: 0 },
    },
    test(name: string, fn?: () => void) {
      const testName = String(name || 'Assertion');
      if (typeof fn !== 'function') {
        assertions.push({ name: testName, passed: true });
        return;
      }
      try {
        fn();
        assertions.push({ name: testName, passed: true });
      } catch (err: any) {
        assertions.push({
          name: testName,
          passed: false,
          error: err?.message || String(err),
        });
      }
    },
    expect: (val: any) => createChaiExpect(val, false),
    response: {
      code: statusCode,
      status: statusText,
      responseTime: durationMs,
      responseSize: responseText.length,
      headers: {
        get: (k: string) => lowerHeaders[String(k || '').toLowerCase()],
        has: (k: string) => Object.prototype.hasOwnProperty.call(lowerHeaders, String(k || '').toLowerCase()),
        toObject: () => ({ ...responseHeaders }),
      },
      text: () => responseText,
      json: () => {
        if (jsonParseError) {
          throw new Error(`Response body is not valid JSON: ${jsonParseError.message}`);
        }
        return parsedJson;
      },
      to: pmResponseTo,
    },
    environment: varStore,
    collectionVariables: varStore,
    variables: varStore,
    globals: varStore,
    info: {
      eventName: 'test',
      iteration: 0,
      iterationCount: 1,
    },
  };

  const sandboxConsole = {
    log: (...args: any[]) =>
      consoleLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
    info: (...args: any[]) =>
      consoleLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
    warn: (...args: any[]) =>
      consoleLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
    error: (...args: any[]) =>
      consoleLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
  };

  const sandbox = vm.createContext({
    pm,
    tests: legacyTests,
    responseBody: responseText,
    responseCode: { code: statusCode, name: statusText },
    responseTime: durationMs,
    postman: {
      setEnvironmentVariable: (k: string, v: any) => varStore.set(k, v),
      getEnvironmentVariable: (k: string) => varStore.get(k),
      clearEnvironmentVariable: (k: string) => varStore.unset(k),
      setGlobalVariable: (k: string, v: any) => varStore.set(k, v),
      getGlobalVariable: (k: string) => varStore.get(k),
      getResponseHeader: (k: string) => lowerHeaders[String(k || '').toLowerCase()],
      setNextRequest: () => {},
    },
    console: sandboxConsole,
    JSON,
    Math,
    Date,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
  });

  for (const code of testScripts) {
    try {
      vm.runInContext(code, sandbox, { timeout: 500 });
    } catch (scriptErr: any) {
      // A thrown script exception is a runner limitation, not a product
      // failure. Tag it so the executor can report Error instead of Fail.
      const rawMessage = scriptErr?.message || String(scriptErr);
      assertions.push({
        name: 'Test Script Execution',
        passed: false,
        error: rawMessage,
        scriptError: true,
      });
    }
  }

  for (const [k, v] of Object.entries(legacyTests)) {
    if (!assertions.some((a) => a.name === k)) {
      const ok = Boolean(v);
      assertions.push({
        name: k,
        passed: ok,
        error: ok ? undefined : `Assertion "${k}" evaluated to ${JSON.stringify(v)}`,
      });
    }
  }

  return { assertions, updatedVariables, consoleLogs };
}

export function runPostmanPreRequestScripts(params: {
  events?: any[];
  variables: Record<string, string>;
}): {
  updatedVariables: Record<string, string>;
  consoleLogs: string[];
} {
  const { events, variables } = params;
  const updatedVariables: Record<string, string> = { ...variables };
  const consoleLogs: string[] = [];

  if (!Array.isArray(events) || events.length === 0) {
    return { updatedVariables, consoleLogs };
  }

  const preScripts: string[] = [];
  for (const ev of events) {
    if (ev?.listen !== 'prerequest') continue;
    const exec = ev?.script?.exec;
    const code = Array.isArray(exec)
      ? exec.join('\n')
      : typeof exec === 'string'
      ? exec
      : '';
    if (code.trim()) {
      preScripts.push(code);
    }
  }

  if (preScripts.length === 0) {
    return { updatedVariables, consoleLogs };
  }

  const varStore = {
    get(key: string) {
      return updatedVariables[key];
    },
    set(key: string, val: any) {
      if (key) {
        updatedVariables[String(key)] = val !== undefined && val !== null ? String(val) : '';
      }
    },
    unset(key: string) {
      delete updatedVariables[String(key)];
    },
    has(key: string) {
      return Object.prototype.hasOwnProperty.call(updatedVariables, key);
    },
    toObject() {
      return { ...updatedVariables };
    },
    replaceIn(template: string) {
      return resolveParameterizedTemplate(String(template || ''), updatedVariables);
    },
  };

  const sandboxConsole = {
    log: (...args: any[]) =>
      consoleLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
    info: (...args: any[]) =>
      consoleLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
    warn: (...args: any[]) =>
      consoleLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
    error: (...args: any[]) =>
      consoleLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
  };

  const sandbox = vm.createContext({
    pm: {
      environment: varStore,
      collectionVariables: varStore,
      variables: varStore,
      globals: varStore,
      info: { eventName: 'prerequest', iteration: 0, iterationCount: 1 },
    },
    postman: {
      setEnvironmentVariable: (k: string, v: any) => varStore.set(k, v),
      getEnvironmentVariable: (k: string) => varStore.get(k),
      clearEnvironmentVariable: (k: string) => varStore.unset(k),
      setGlobalVariable: (k: string, v: any) => varStore.set(k, v),
      getGlobalVariable: (k: string) => varStore.get(k),
    },
    console: sandboxConsole,
    JSON,
    Math,
    Date,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
  });

  for (const code of preScripts) {
    try {
      vm.runInContext(code, sandbox, { timeout: 500 });
    } catch {
      // non-fatal pre-request script error
    }
  }

  return { updatedVariables, consoleLogs };
}

export function flattenPostmanItems(
  items: any[],
  folderFilter?: string,
  collectionAuth?: any,
  collectionEvents?: any[]
): FlattenedPostmanEntry[] {
  const all = collectRawPostmanEntries(
    items,
    '',
    { value: 0 },
    collectionAuth,
    Array.isArray(collectionEvents) ? collectionEvents : []
  );
  if (!folderFilter || !folderFilter.trim()) {
    return all;
  }
  const q = folderFilter.trim().toLowerCase();
  return all.filter((entry) => {
    const fullPath = entry.folderPath ? `${entry.folderPath} / ${entry.name}` : entry.name;
    const matchesName = entry.name.toLowerCase().includes(q);
    const matchesFolder = entry.folderPath.toLowerCase().includes(q) || fullPath.toLowerCase().includes(q);
    const matchesId = entry.id.toLowerCase() === q;
    return matchesName || matchesFolder || matchesId;
  });
}

export function extractTemplateVariableKeys(text?: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const key = match[1].trim();
    if (key && !key.startsWith('$') && !found.includes(key)) {
      found.push(key);
    }
  }
  return found;
}

export function extractPostmanRequestVariables(
  request: any,
  rawUrl = '',
  bodyPreview = '',
  events?: any[],
  inheritedAuth?: any
): string[] {
  const keys = new Set<string>();
  const setInPreRequest = new Set<string>();

  const addFrom = (str?: string) => {
    for (const k of extractTemplateVariableKeys(str)) {
      keys.add(k);
    }
  };

  // 1. URL (raw + query params + path variables)
  addFrom(rawUrl);
  if (typeof request?.url === 'object' && request.url !== null) {
    if (Array.isArray(request.url.query)) {
      for (const q of request.url.query) {
        if (q && !q.disabled) {
          addFrom(String(q.key || ''));
          addFrom(String(q.value || ''));
        }
      }
    }
    if (Array.isArray(request.url.variable)) {
      for (const v of request.url.variable) {
        if (v && !v.disabled) {
          addFrom(String(v.value || ''));
        }
      }
    }
  }

  // 2. Full Untruncated Body (raw, urlencoded, formdata, graphql)
  addFrom(bodyPreview);
  if (request?.body) {
    if (typeof request.body.raw === 'string') {
      addFrom(request.body.raw);
    }
    if (Array.isArray(request.body.urlencoded)) {
      for (const p of request.body.urlencoded) {
        if (p && !p.disabled) {
          addFrom(String(p.key || ''));
          addFrom(String(p.value || ''));
        }
      }
    }
    if (Array.isArray(request.body.formdata)) {
      for (const p of request.body.formdata) {
        if (p && !p.disabled) {
          addFrom(String(p.key || ''));
          addFrom(String(p.value || ''));
          if (typeof p.src === 'string') addFrom(p.src);
        }
      }
    }
    if (request.body.graphql) {
      addFrom(String(request.body.graphql.query || ''));
      addFrom(String(request.body.graphql.variables || ''));
    }
  }

  // 3. Headers
  if (Array.isArray(request?.header)) {
    for (const h of request.header) {
      if (h && !h.disabled) {
        addFrom(String(h.key || ''));
        addFrom(String(h.value || ''));
      }
    }
  }

  // 4. Request Auth + Inherited Folder/Collection Auth
  for (const authObj of [request?.auth, inheritedAuth]) {
    if (!authObj || typeof authObj !== 'object') continue;
    for (const arr of [
      authObj.bearer,
      authObj.apikey,
      authObj.basic,
      authObj.oauth2,
      authObj.awsv4,
      authObj.hawk,
      authObj.digest,
      authObj.ntlm,
    ]) {
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          addFrom(String(entry?.value || ''));
        }
      }
    }
  }

  // 5. Pre-request & Test Scripts (pm.*.get("VAR"), postman.get*Variable("VAR"), and {{VAR}})
  if (Array.isArray(events)) {
    for (const ev of events) {
      const exec = ev?.script?.exec;
      const scriptCode = Array.isArray(exec)
        ? exec.join('\n')
        : typeof exec === 'string'
        ? exec
        : '';
      if (!scriptCode) continue;

      if (ev?.listen === 'prerequest') {
        const setRegex =
          /(?:pm\.(?:environment|collectionVariables|variables|globals)\.set|postman\.set(?:Environment|Global)Variable)\(\s*(['"`])([a-zA-Z0-9_.-]+)\1/g;
        let sm: RegExpExecArray | null;
        while ((sm = setRegex.exec(scriptCode)) !== null) {
          if (sm[2]) setInPreRequest.add(sm[2].trim());
        }
      }

      addFrom(scriptCode);
      const getRegex =
        /(?:pm\.(?:environment|collectionVariables|variables|globals)\.get|postman\.get(?:Environment|Global)Variable)\(\s*(['"`])([a-zA-Z0-9_.-]+)\1\s*\)/g;
      let gm: RegExpExecArray | null;
      while ((gm = getRegex.exec(scriptCode)) !== null) {
        const k = gm[2]?.trim();
        if (k && !k.startsWith('$')) {
          keys.add(k);
        }
      }
    }
  }

  // Exclude variables that are dynamically created in the request's own prerequest script
  for (const k of setInPreRequest) {
    keys.delete(k);
  }

  return Array.from(keys);
}

export function mapPostmanCollectionToRequestItems(
  collectionItems: any[],
  folderFilter?: string,
  collectionAuth?: any,
  collectionEvents?: any[]
): PostmanCollectionRequestItem[] {
  const flat = flattenPostmanItems(collectionItems || [], folderFilter, collectionAuth, collectionEvents);
  return flat.map((item) => {
    const rawUrl =
      typeof item.request?.url === 'string'
        ? item.request.url
        : typeof item.request?.url?.raw === 'string'
        ? item.request.url.raw
        : '';

    const rawDesc =
      typeof item.request?.description === 'string'
        ? item.request.description
        : typeof item.request?.description?.content === 'string'
        ? item.request.description.content
        : '';

    const method = String(item.request?.method || 'GET').toUpperCase();
    const bodyMode = item.request?.body?.mode ? String(item.request.body.mode) : undefined;

    let bodyRawFull = '';
    let bodyPreview = '';
    let formDataFields: Array<{ key: string; value: string; type?: string }> | undefined;

    if (bodyMode === 'raw' && typeof item.request?.body?.raw === 'string') {
      bodyRawFull = item.request.body.raw.trim();
      // Sanitize secrets from raw body
      bodyRawFull = bodyRawFull.replace(/("password"\s*:\s*")[^,}]+/gi, '$1"*****"');
      bodyRawFull = bodyRawFull.replace(/("token"\s*:\s*")[^,}]+/gi, '$1"{{token}}"');
      bodyRawFull = bodyRawFull.replace(/("secret"\s*:\s*")[^,}]+/gi, '$1"{{secret}}"');
      bodyPreview = bodyRawFull.slice(0, 600);
    } else if (
      bodyMode === 'urlencoded' &&
      Array.isArray(item.request?.body?.urlencoded)
    ) {
      formDataFields = item.request.body.urlencoded
        .filter((p: any) => p?.key && !p.disabled)
        .map((p: any) => {
          const key = String(p.key).toLowerCase();
          let value = String(p.value ?? '');
          // Sanitize sensitive fields
          if (/^(password|token|secret|apikey|api_key|auth|authorization)/i.test(key)) {
            value = `{{${key.replace(/-/g, '_')}}}`;
          }
          return { key: String(p.key), value, type: 'text' };
        });
      bodyRawFull = (formDataFields || []).map((p) => `${p.key}=${p.value}`).join('&');
      bodyPreview = bodyRawFull.slice(0, 600);
    } else if (
      bodyMode === 'formdata' &&
      Array.isArray(item.request?.body?.formdata)
    ) {
      formDataFields = item.request.body.formdata
        .filter((p: any) => p?.key && !p.disabled)
        .map((p: any) => {
          const key = String(p.key).toLowerCase();
          let value = String(p.value ?? (typeof p.src === 'string' ? p.src : ''));
          // Sanitize sensitive fields
          if (/^(password|token|secret|apikey|api_key|auth|authorization)/i.test(key)) {
            value = `{{${key.replace(/-/g, '_')}}}`;
          }
          return {
            key: String(p.key),
            value,
            type: String(p.type || 'text'),
          };
        });
      bodyRawFull = (formDataFields || []).map((p) => `${p.key}=${p.value}`).join('&');
      bodyPreview = bodyRawFull.slice(0, 600);
    } else if (bodyMode === 'graphql' && item.request?.body?.graphql) {
      bodyRawFull = JSON.stringify(item.request.body.graphql, null, 2);
      bodyPreview = bodyRawFull.slice(0, 600);
    }

    const headersList: Array<{ key: string; value: string; description?: string }> = [];
    if (Array.isArray(item.request?.header)) {
      for (const h of item.request.header) {
        if (h?.key && !h.disabled) {
          const key = String(h.key);
          let value = String(h.value ?? '');
          
          // Strip browser-fingerprint headers
          if (/^(sec-ch-ua|user-agent|accept-language|cookie|origin|referer|pragma|cache-control|priority)/i.test(key)) {
            continue;
          }
          
          // Convert auth-like header values to {{variable}} placeholders
          if (/^(authorization|x-csrftoken|x-csrf-token|xsrf-token|session-id|sessionid|token|api-key|x-api-key)/i.test(key)) {
            // Extract variable name from header key (e.g., "x-csrftoken" -> "csrftoken")
            const varName = key.replace(/^(x-|api-)/i, '').replace(/-/g, '_');
            value = `{{${varName}}}`;
          }
          
          headersList.push({
            key,
            value,
            description: typeof h.description === 'string' ? h.description : undefined,
          });
        }
      }
    }

    const effectiveAuthObj = item.request?.auth || item.inheritedAuth;
    let authSummary: { type: string; details: Record<string, string> } | undefined;
    if (effectiveAuthObj?.type && effectiveAuthObj.type !== 'noauth') {
      const details: Record<string, string> = {};
      const authArr = effectiveAuthObj[effectiveAuthObj.type];
      if (Array.isArray(authArr)) {
        for (const entry of authArr) {
          if (entry?.key && entry?.value !== undefined) {
            // Convert sensitive auth values to placeholders
            const key = String(entry.key).toLowerCase();
            if (/^(apikey|apitoken|secret|password|token|value)/i.test(key)) {
              details[String(entry.key)] = `{{${String(entry.key).replace(/[-_]/g, '_')}}}`;
            } else {
              details[String(entry.key)] = String(entry.value);
            }
          }
        }
      }
      authSummary = { type: String(effectiveAuthObj.type), details };
    }

    // Separate "Generated from cURL: curl ..." out of description into curlCommand
    let cleanDescription = rawDesc.trim();
    let curlCommand = '';
    const curlMatch = cleanDescription.match(/(?:Generated from cURL:\s*)?(curl\s+[\s\S]+)$/i);
    if (curlMatch) {
      curlCommand = curlMatch[1].trim();
      cleanDescription = cleanDescription.slice(0, curlMatch.index).trim();
    }

    if (!curlCommand && rawUrl) {
      const headerFlags: string[] = [];
      for (const h of headersList) {
        headerFlags.push(`-H '${h.key}: ${h.value}'`);
      }
      if (bodyPreview && !headerFlags.some((f) => /content-type/i.test(f))) {
        headerFlags.push(`-H 'Content-Type: application/json'`);
      }
      const parts = [
        `curl -X ${method} '${rawUrl}'`,
        ...headerFlags,
        ...(bodyPreview ? [`--data-raw '${bodyPreview}'`] : []),
      ];
      curlCommand = parts.join(' \\\n  ');
    }

    const assertions = extractPostmanAssertions(item.event);
    const preRequestScript = Array.isArray(item.event)
      ? item.event
          .filter((e: any) => e?.listen === 'prerequest')
          .map((e: any) =>
            Array.isArray(e?.script?.exec) ? e.script.exec.join('\n') : String(e?.script?.exec || '')
          )
          .filter(Boolean)
          .join('\n\n')
      : '';
    const testScript = Array.isArray(item.event)
      ? item.event
          .filter((e: any) => e?.listen === 'test')
          .map((e: any) =>
            Array.isArray(e?.script?.exec) ? e.script.exec.join('\n') : String(e?.script?.exec || '')
          )
          .filter(Boolean)
          .join('\n\n')
      : '';

    const chainsVariables =
      /pm\.(environment|collectionVariables|variables|globals)\.set\s*\(|postman\.setEnvironmentVariable\s*\(/i.test(
        `${preRequestScript}\n${testScript}`
      );

    const requiredVariables = extractPostmanRequestVariables(
      item.request,
      rawUrl,
      bodyRawFull || bodyPreview,
      item.event,
      item.inheritedAuth
    );

    const requestSpec: PostmanRequestDetailedSpec = {
      order: item.order,
      name: item.name,
      folderPath: item.folderPath,
      method,
      url: rawUrl,
      headers: headersList,
      auth: authSummary,
      bodyMode,
      bodyRaw: bodyRawFull || undefined,
      formDataFields,
      preRequestScript: preRequestScript || undefined,
      testScript: testScript || undefined,
      assertions: assertions.length > 0 ? assertions : undefined,
      requiredVariables: requiredVariables.length > 0 ? requiredVariables : undefined,
      curlCommand: curlCommand || undefined,
    };

    return {
      order: item.order,
      requestId: item.id || undefined,
      folderId: item.folderId || undefined,
      name: item.name,
      folderPath: item.folderPath,
      method,
      url: rawUrl,
      description: cleanDescription || undefined,
      curlCommand: curlCommand || undefined,
      bodyPreview: bodyPreview || undefined,
      assertions: assertions.length > 0 ? assertions : undefined,
      chainsVariables,
      requiredVariables: requiredVariables.length > 0 ? requiredVariables : undefined,
      requestSpec,
    };
  });
}

export function extractCleanEndpointPath(rawUrl?: string): string {
  if (!rawUrl || !rawUrl.trim()) return '/';
  const clean = rawUrl.trim();
  // Strip leading {{base_api_url}}, {{base_url}}, {{BASE_URL}}, {{host}}, or http(s)://domain
  const stripped = clean
    .replace(/^\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/, '')
    .replace(/^https?:\/\/[^/]+/i, '');
  if (!stripped) return clean;
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

export function normalizeAssertionText(raw: string): string {
  return String(raw || '')
    .replace(/\bisbelow\b/gi, 'is below')
    .replace(/\bisabove\b/gi, 'is above')
    .replace(/\bisequal\b/gi, 'is equal')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatPostmanAssertionsChecklist(assertions?: string[]): string {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    return '✓ Status code is 200\n✓ Valid JSON response body is returned';
  }
  return assertions
    .map((a) => `✓ ${normalizeAssertionText(a)}`)
    .join('\n');
}

export function detectRecommendedPostmanStructureMode(
  requests: PostmanCollectionRequestItem[],
  folderName?: string
): 'independent' | 'journey' {
  if (!Array.isArray(requests) || requests.length <= 1) {
    return 'independent';
  }

  // 1. Explicit variable chaining in scripts (pm.environment.set / pm.variables.set)
  if (requests.some((r) => r.chainsVariables)) {
    return 'journey';
  }

  const titles = requests.map((r) => String(r.name || '').trim());
  const effectiveFolder = String(folderName || requests[0]?.folderPath || '').trim();

  // 2. Step-numbered request titles (e.g. "1. Login", "Step 2: Create Quote", "01 - Init")
  const numberedCount = titles.filter((t) =>
    /^(?:step\s*\d+|#?\d+[.):\-_\s])/i.test(t)
  ).length;
  if (numberedCount >= 2) {
    return 'journey';
  }

  // 3. Explicit flow/journey keywords in folder name
  if (
    /\b(flow|journey|e2e|end-to-end|workflow|sequence|lifecycle|onboarding|checkout)\b/i.test(
      effectiveFolder
    )
  ) {
    return 'journey';
  }

  // 4. If requests use different base URL variables/hosts (e.g. {{base_api_url}} vs {{base_bot_api_url}}), they are unrelated independent features
  const baseHosts = new Set(
    requests
      .map((r) => {
        const m = String(r.url || '').match(/^(\{\{[^}]+\}\}|https?:\/\/[^/]+)/i);
        return m ? m[1].toLowerCase() : '';
      })
      .filter(Boolean)
  );
  if (baseHosts.size > 1) {
    return 'independent';
  }

  // 5. Scenario / Variant title pattern (e.g. "Policy Review with Policy Name - Health", "... - Super Top-Up")
  const prefixes = titles
    .map((t) => {
      const m = t.match(/^(.+?)\s*[-–—:]\s*.+$/);
      return m ? m[1].trim().toLowerCase() : '';
    })
    .filter(Boolean);
  if (prefixes.length >= 2) {
    const prefixCounts = new Map<string, number>();
    for (const p of prefixes) {
      prefixCounts.set(p, (prefixCounts.get(p) || 0) + 1);
    }
    const maxSamePrefix = Math.max(...Array.from(prefixCounts.values()));
    if (maxSamePrefix >= Math.ceil(requests.length * 0.6)) {
      return 'independent';
    }
  }

  const uniqueEndpoints = new Set(
    requests.map((r) => `${r.method} ${extractCleanEndpointPath(r.url).split('?')[0]}`)
  );
  if (uniqueEndpoints.size === 1) {
    return 'independent';
  }

  // 6. Strict monotonic lifecycle progression (e.g. Create/Init -> Upload/Update -> Approve/Issue)
  // First request must be an initialization/creation/login step, and stages must progress forward
  const getStage = (t: string): number => {
    if (/^(login|authenticate|create|register|generate|initiate|init|draft)\b/i.test(t)) return 1;
    if (/^(upload|attach|update|edit|patch|submit|add)\b/i.test(t)) return 2;
    if (/^(verify|validate|approve|confirm|complete|issue|finalize|delete)\b/i.test(t)) return 3;
    return 0;
  };
  const stages = titles.map(getStage);
  const allHaveLifecycleVerb = stages.every((s) => s > 0);
  const isMonotonic = stages.every((s, idx) => idx === 0 || s >= stages[idx - 1]);
  if (allHaveLifecycleVerb && isMonotonic && new Set(stages).size >= 2) {
    return 'journey';
  }

  // Default to independent (1 Test Case per Request) for module folders with distinct endpoints
  return 'independent';
}

export function buildJourneyCaseTitle(
  folderName: string,
  requests: PostmanCollectionRequestItem[],
  collectionName = 'API Suite'
): string {
  const prefix = (folderName || collectionName).trim();
  if (!Array.isArray(requests) || requests.length === 0) {
    return prefix;
  }
  const shortNames = requests.slice(0, 4).map((r) => {
    let n = r.name.trim();
    // Strip redundant prefix like "Policy Review with Policy Name - " or "<Folder> - "
    n = n.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^-–—:]*[-–—:]\\s*`, 'i'), '');
    return n.trim() || r.name.trim();
  });
  const suffix = shortNames.join(' / ') + (requests.length > 4 ? ` (+${requests.length - 4} more)` : '');
  return `${prefix} — ${suffix}`;
}

export function formatPostmanRequestAsStep(
  req: PostmanCollectionRequestItem,
  order: number
): Array<{
  order: number;
  description: string;
  step: string;
  expectedResult: string;
  data?: string;
}> {
  const endpointPath = extractCleanEndpointPath(req.url);
  const actionText = `Execute "${req.name}" API request (${req.method} ${endpointPath})`;
  let data = req.bodyPreview && req.bodyPreview.trim() ? req.bodyPreview.trim() : undefined;
  if (data) {
    try {
      data = JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      // keep raw string
    }
  }

  const steps: Array<{
    order: number;
    description: string;
    step: string;
    expectedResult: string;
    data?: string;
  }> = [
    {
      order,
      description: actionText,
      step: actionText,
      expectedResult: '',
      data,
    },
  ];

  // Add one verify step per assertion
  const assertions = req.assertions || [];
  assertions.forEach((assertion, idx) => {
    steps.push({
      order: order + idx + 1,
      description: `Verify: ${assertion}`,
      step: `Verify: ${assertion}`,
      expectedResult: `Check that ${assertion}`,
    });
  });

  return steps;
}

export async function listPostmanCollectionRequests(
  config: PostmanIntegrationConfig,
  collectionUid: string
): Promise<PostmanCollectionRequestItem[]> {
  const apiKey = decrypt((config.apiKey || '').trim());
  if (!apiKey || !collectionUid.trim()) return [];

  const colRes = await fetch(
    `https://api.getpostman.com/collections/${encodeURIComponent(collectionUid.trim())}`,
    {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    }
  );
  if (!colRes.ok) return [];
  const colJson = await colRes.json().catch(() => null);
  const collection = colJson?.collection;
  if (!collection) return [];

  return mapPostmanCollectionToRequestItems(
    collection.item || [],
    undefined,
    collection.auth,
    collection.event
  );
}

export async function executePostmanParameterizedRun(
  config: PostmanIntegrationConfig,
  options: PostmanRunOptions
): Promise<ExternalTestExecutionResult> {
  const apiKey = decrypt((config.apiKey || '').trim());
  if (!apiKey) {
    throw new Error('Postman API Key is not configured.');
  }
  const collectionUid = (options.collectionUid || '').trim();
  if (!collectionUid) {
    throw new Error('Postman Collection UID / ID is required.');
  }

  // 1. Fetch Collection definition from Postman API
  const colRes = await fetch(
    `https://api.getpostman.com/collections/${encodeURIComponent(collectionUid)}`,
    {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!colRes.ok) {
    throw new Error(`Failed to fetch Postman collection (${colRes.status} ${colRes.statusText})`);
  }
  const colJson = await colRes.json();
  const collection = colJson?.collection;
  if (!collection) {
    throw new Error('Invalid Postman collection payload');
  }

  // 2. Build layered variable map:
  const baseVars: Record<string, string> = {};
  if (Array.isArray(collection.variable)) {
    for (const v of collection.variable) {
      if (v?.key && !v.disabled && v.value !== undefined) {
        baseVars[v.key] = String(v.value);
      }
    }
  }

  const envNameKey = (options.environmentName || '').trim().toUpperCase();
  let targetPostmanEnvUid =
    options.postmanEnvUidOverride?.trim() ||
    (envNameKey && config.envMapping?.[envNameKey]) ||
    '';

  // Auto-discover a matching Postman Environment if not explicitly mapped
  if (!targetPostmanEnvUid) {
    const wsQuery = config.workspaceId
      ? `?workspace=${encodeURIComponent(config.workspaceId.trim())}`
      : '';
    const envListRes = await fetch(`https://api.getpostman.com/environments${wsQuery}`, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (envListRes && envListRes.ok) {
      const envListJson = await envListRes.json().catch(() => ({}));
      const envList: any[] = Array.isArray(envListJson?.environments)
        ? envListJson.environments
        : [];
      if (envList.length > 0) {
        const lowerTarget = envNameKey.toLowerCase();
        const matched =
          (lowerTarget &&
            envList.find((e) => String(e?.name || '').toLowerCase() === lowerTarget)) ||
          (lowerTarget &&
            envList.find((e) => String(e?.name || '').toLowerCase().includes(lowerTarget))) ||
          envList[0];
        if (matched) {
          targetPostmanEnvUid = matched.uid || matched.id || '';
        }
      }
    }
  }

  let postmanEnvName = '';
  if (targetPostmanEnvUid) {
    const envRes = await fetch(
      `https://api.getpostman.com/environments/${encodeURIComponent(targetPostmanEnvUid)}`,
      {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      }
    ).catch(() => null);

    if (envRes && envRes.ok) {
      const envJson = await envRes.json().catch(() => ({}));
      const envObj = envJson?.environment;
      if (envObj) {
        postmanEnvName = envObj.name || targetPostmanEnvUid;
        for (const val of envObj.values || []) {
          if (val?.key && val.enabled !== false && val.value !== undefined) {
            baseVars[val.key] = String(val.value);
          }
        }
      }
    }
  }

  for (const [k, v] of Object.entries(options.inkaVariables || {})) {
    if (v !== undefined && v !== null) {
      baseVars[k] = String(v);
    }
  }

  for (const [k, v] of Object.entries(options.datasetParams || {})) {
    if (v !== undefined && v !== null) {
      baseVars[k] = String(v);
    }
  }

  // 3. Extract requests to run. Selected orders are indices into the full
  // collection, so applying a folder/name filter first would shift them and
  // execute unrelated sibling requests. Filter only when no explicit selection.
  const effectiveFolderFilter =
    options.selectedRequestOrders && options.selectedRequestOrders.length > 0
      ? undefined
      : options.folderOrRequestFilter;
  const allRequests = flattenPostmanItems(
    collection.item || [],
    effectiveFolderFilter,
    collection.auth,
    collection.event
  );
  if (allRequests.length === 0) {
    throw new Error(
      options.folderOrRequestFilter
        ? `No requests matched filter "${options.folderOrRequestFilter}" in collection "${collection.info?.name || collectionUid}".`
        : `No executable requests found in Postman collection "${collection.info?.name || collectionUid}".`
    );
  }

  const selectedSet =
    options.selectedRequestOrders && options.selectedRequestOrders.length > 0
      ? new Set(options.selectedRequestOrders)
      : null;

  const delayMs = Math.max(0, Math.min(options.delayMs ?? config.defaultDelayMs ?? 0, 10000));
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? config.defaultTimeoutMs ?? 15000, 60000));
  const bailOnFailure = Boolean(options.bailOnFailure ?? config.bailOnFailure ?? false);
  const persistResponses = options.persistResponses ?? config.persistResponses ?? true;
  const turnOffLogs = Boolean(options.turnOffLogs ?? config.turnOffLogs ?? false);
  const keepVariableValues = options.keepVariableValues ?? config.keepVariableValues ?? true;
  const ignoreCookies = Boolean(options.ignoreCookies ?? config.ignoreCookies ?? false);
  const saveCookies = options.saveCookies ?? config.saveCookies ?? true;
  const maxLatencySlaMs = options.maxLatencyMs && options.maxLatencyMs > 0 ? options.maxLatencyMs : undefined;
  const skipSet = new Set(options.skipStepOrders || []);
  const expectedCodes =
    options.expectedStatusCodes && options.expectedStatusCodes.length > 0
      ? options.expectedStatusCodes
      : [200, 201, 202, 204];

  const iterationDataRows =
    options.iterationRows && options.iterationRows.length > 0
      ? options.iterationRows
      : [options.datasetParams || {}];
  const iterationCount = Math.max(
    1,
    Math.min(options.iterations ?? iterationDataRows.length, 20)
  );

  const stepResults: ExternalTestExecutionResult['stepResults'] = {};
  const steps: ExternalStepExecutionItem[] = [];
  const logLines: string[] = [
    `=== POSTMAN COLLECTION RUN ===`,
    `Collection: ${collection.info?.name || collectionUid}`,
    `InkaTest Environment: ${options.environmentName || 'Default'}${postmanEnvName ? ` -> Postman Env: ${postmanEnvName}` : ''}`,
    `Iterations: ${iterationCount} | Delay: ${delayMs}ms | Timeout: ${timeoutMs}ms | StopOnError: ${bailOnFailure}${maxLatencySlaMs ? ` | MaxLatencySLA: ${maxLatencySlaMs}ms` : ''}`,
    `Resolved Variables (${Object.keys(baseVars).length}): ${Object.keys(baseVars).join(', ') || 'none'}`,
    `------------------------------`,
  ];

  let totalDurationMs = 0;
  const latencies: number[] = [];
  let bailed = false;
  let stepCounter = 0;
  const cookieJar = new Map<string, string>();
  let sessionVars: Record<string, string> = { ...baseVars };

  for (let iter = 0; iter < iterationCount; iter++) {
    const rowParams = iterationDataRows[iter % iterationDataRows.length] || {};
    const mergedVars: Record<string, string> = keepVariableValues
      ? { ...sessionVars, ...rowParams }
      : { ...baseVars, ...rowParams };
    sessionVars = mergedVars;

    for (let i = 0; i < allRequests.length; i++) {
      const item = allRequests[i];
      const reqOrder = item.order ?? i + 1;
      if (selectedSet && !selectedSet.has(reqOrder)) {
        continue;
      }

      stepCounter += 1;
      const order = stepCounter;
      const displayStepName =
        iterationCount > 1 ? `[Iter #${iter + 1}] ${item.name}` : item.name;

      if (skipSet.has(reqOrder) || bailed) {
        const reason = bailed
          ? 'Skipped (stopped after earlier error)'
          : 'Skipped by user selection';
        stepResults[String(order)] = { status: 'skip', note: `[${displayStepName}] ${reason}` };
        steps.push({ order, name: displayStepName, status: 'skip', durationMs: 0, detail: reason });
        if (!turnOffLogs) {
          logLines.push(`#${order} [SKIP] ${displayStepName} — ${reason}`);
        }
        continue;
      }

      if (order > 1 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      // Execute Pre-request scripts (collection + folder + item) before resolving variables
      if (Array.isArray(item.event) && item.event.length > 0) {
        const preExec = runPostmanPreRequestScripts({
          events: item.event,
          variables: mergedVars,
        });
        Object.assign(mergedVars, preExec.updatedVariables);
        if (keepVariableValues) {
          sessionVars = { ...sessionVars, ...preExec.updatedVariables };
        }
      }

      const req = item.request;
      const method = String(req?.method || 'GET').toUpperCase();
      const rawUrl =
        typeof req?.url === 'string'
          ? req.url
          : typeof req?.url?.raw === 'string'
          ? req.url.raw
          : '';

      const resolvedUrl = resolveParameterizedTemplate(rawUrl, mergedVars).trim();
      const headers: Record<string, string> = {};

      if (Array.isArray(req?.header)) {
        for (const h of req.header) {
          if (h?.key && !h.disabled) {
            if (ignoreCookies && h.key.toLowerCase() === 'cookie') continue;
            headers[h.key] = resolveParameterizedTemplate(String(h.value || ''), mergedVars);
          }
        }
      }

      if (!ignoreCookies && cookieJar.size > 0 && !headers['Cookie'] && !headers['cookie']) {
        headers['Cookie'] = Array.from(cookieJar.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
      }

      const auth = req?.auth || item.inheritedAuth || collection.auth;
      if (auth?.type === 'bearer' && Array.isArray(auth.bearer)) {
        const tokenEntry = auth.bearer.find((b: any) => b.key === 'token');
        if (tokenEntry?.value) {
          headers['Authorization'] = `Bearer ${resolveParameterizedTemplate(String(tokenEntry.value), mergedVars)}`;
        }
      } else if (auth?.type === 'apikey' && Array.isArray(auth.apikey)) {
        const kEntry = auth.apikey.find((a: any) => a.key === 'key');
        const vEntry = auth.apikey.find((a: any) => a.key === 'value');
        if (kEntry?.value && vEntry?.value) {
          headers[String(kEntry.value)] = resolveParameterizedTemplate(String(vEntry.value), mergedVars);
        }
      } else if (auth?.type === 'basic' && Array.isArray(auth.basic)) {
        const uEntry = auth.basic.find((b: any) => b.key === 'username');
        const pEntry = auth.basic.find((b: any) => b.key === 'password');
        if (uEntry?.value || pEntry?.value) {
          const u = resolveParameterizedTemplate(String(uEntry?.value || ''), mergedVars);
          const p = resolveParameterizedTemplate(String(pEntry?.value || ''), mergedVars);
          headers['Authorization'] = `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
        }
      }

      let body: any = undefined;
      if (!['GET', 'HEAD'].includes(method) && req?.body) {
        if (req.body.mode === 'raw' && typeof req.body.raw === 'string') {
          body = resolveParameterizedTemplate(req.body.raw, mergedVars);
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
        } else if (req.body.mode === 'urlencoded' && Array.isArray(req.body.urlencoded)) {
          const params = new URLSearchParams();
          for (const p of req.body.urlencoded) {
            if (p?.key && !p.disabled) {
              params.append(p.key, resolveParameterizedTemplate(String(p.value || ''), mergedVars));
            }
          }
          body = params.toString();
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
          }
        } else if (req.body.mode === 'formdata' && Array.isArray(req.body.formdata)) {
          const hasAttachmentFile = req.body.formdata.some((p: any) => {
            if (!p?.key || p.disabled) return false;
            const rawVal = String(p.value ?? (typeof p.src === 'string' ? p.src : '')).trim();
            const varMatch = rawVal.match(/^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/);
            const varKey = varMatch ? varMatch[1] : p.key;
            return (
              p.type === 'file' ||
              Boolean(options.attachmentFiles?.[varKey]) ||
              Boolean(options.attachmentFiles?.[rawVal])
            );
          });

          if (hasAttachmentFile && typeof FormData !== 'undefined') {
            const multipart = new FormData();
            for (const p of req.body.formdata) {
              if (!p?.key || p.disabled) continue;
              const rawVal = String(p.value ?? (typeof p.src === 'string' ? p.src : '')).trim();
              const varMatch = rawVal.match(/^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/);
              const varKey = varMatch ? varMatch[1] : p.key;
              const fileAtt =
                options.attachmentFiles?.[varKey] || options.attachmentFiles?.[rawVal];
              if (fileAtt?.buffer) {
                const blob = new Blob([new Uint8Array(fileAtt.buffer)], {
                  type: fileAtt.mimeType || 'application/octet-stream',
                });
                multipart.append(p.key, blob, fileAtt.filename || 'attachment.bin');
              } else {
                multipart.append(p.key, resolveParameterizedTemplate(rawVal, mergedVars));
              }
            }
            body = multipart;
            delete headers['Content-Type'];
            delete headers['content-type'];
          } else {
            const formObj: Record<string, string> = {};
            for (const p of req.body.formdata) {
              if (p?.key && !p.disabled) {
                const rawVal = p.value ?? (typeof p.src === 'string' ? p.src : '');
                formObj[p.key] = resolveParameterizedTemplate(String(rawVal || ''), mergedVars);
              }
            }
            body = JSON.stringify(formObj);
            if (!headers['Content-Type'] && !headers['content-type']) {
              headers['Content-Type'] = 'application/json';
            }
          }
        }
      }

      const unresolvedMatch = resolvedUrl.match(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/);
      if (unresolvedMatch) {
        const missingVar = unresolvedMatch[1];
        const detail = `Unresolved variable {{${missingVar}}} in URL (${resolvedUrl}). Set ${missingVar}=https://... in Variable Overrides or Project Variables.`;
        stepResults[String(order)] = { status: 'fail', note: `[${method} ${displayStepName}] ${detail}` };
        steps.push({
          order,
          name: displayStepName,
          status: 'fail',
          durationMs: 0,
          detail,
          method,
          url: resolvedUrl,
        });
        if (!turnOffLogs) {
          logLines.push(`#${order} [FAIL] ${method} ${resolvedUrl} — ${detail}`);
        }
        if (bailOnFailure) bailed = true;
        continue;
      }

      const stepStart = Date.now();
      try {
        await validateDestinationUrl(resolvedUrl);
      } catch (urlErr: any) {
        const detail = `Blocked URL (${resolvedUrl}): ${urlErr?.message || 'Invalid destination URL'}`;
        stepResults[String(order)] = { status: 'fail', note: `[${method} ${displayStepName}] ${detail}` };
        steps.push({
          order,
          name: displayStepName,
          status: 'fail',
          durationMs: 0,
          detail,
          method,
          url: resolvedUrl,
        });
        if (!turnOffLogs) {
          logLines.push(`#${order} [FAIL] ${method} ${resolvedUrl} — ${detail}`);
        }
        if (bailOnFailure) bailed = true;
        continue;
      }

      try {
        const response = await fetch(resolvedUrl, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const durationMs = Date.now() - stepStart;
        totalDurationMs += durationMs;
        latencies.push(durationMs);

        if (saveCookies && !ignoreCookies) {
          const setCookieHeader = response.headers.get('set-cookie');
          if (setCookieHeader) {
            const pair = setCookieHeader.split(';')[0];
            const eqIdx = pair.indexOf('=');
            if (eqIdx > 0) {
              cookieJar.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
            }
          }
        }

        const respHeadersObj: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          respHeadersObj[k] = v;
        });

        const rawRespText = await response.text().catch(() => '');
        let prettyResponseBody = rawRespText;
        if (rawRespText) {
          try {
            const parsed = JSON.parse(rawRespText);
            prettyResponseBody = JSON.stringify(parsed, null, 2);
          } catch {
            prettyResponseBody = rawRespText;
          }
        }
        const storedResponseBody =
          persistResponses && prettyResponseBody
            ? prettyResponseBody.length > 20000
              ? `${prettyResponseBody.slice(0, 20000)}\n... [truncated]`
              : prettyResponseBody
            : undefined;

        // Execute Postman Test Scripts (collection-level + item-level)
        const combinedEvents = [
          ...(Array.isArray(collection.event) ? collection.event : []),
          ...(Array.isArray(item.event) ? item.event : []),
        ];
        const scriptExec = runPostmanTestScripts({
          events: combinedEvents,
          statusCode: response.status,
          statusText: response.statusText,
          durationMs,
          responseText: rawRespText,
          responseHeaders: respHeadersObj,
          variables: mergedVars,
        });

        if (keepVariableValues) {
          sessionVars = { ...sessionVars, ...scriptExec.updatedVariables };
          Object.assign(mergedVars, scriptExec.updatedVariables);
        }

        const assertions = scriptExec.assertions;
        const failedAssertions = assertions.filter((a) => !a.passed);
        const passedAssertions = assertions.filter((a) => a.passed);
        const scriptFailedAssertions = failedAssertions.filter((a) => a.scriptError);
        const realFailedAssertions = failedAssertions.filter((a) => !a.scriptError);

        const statusOk =
          assertions.some((a) => /status/i.test(a.name))
            ? realFailedAssertions.length === 0
            : expectedCodes.includes(response.status);
        const latencyOk = maxLatencySlaMs ? durationMs <= maxLatencySlaMs : true;
        // Only real assertion mismatches fail the request. A script-runtime
        // exception means the emulated runner could not execute the check, so
        // the request is reported as Error (a runner limitation) instead.
        const status: 'pass' | 'fail' | 'error' =
          !statusOk || !latencyOk || realFailedAssertions.length > 0
            ? 'fail'
            : scriptFailedAssertions.length > 0
            ? 'error'
            : 'pass';
        const passed = status === 'pass';

        const slaFailureNote =
          !latencyOk && maxLatencySlaMs
            ? ` [SLA Exceeded: ${durationMs}ms > ${maxLatencySlaMs}ms]`
            : '';
        const scriptErrorNote =
          scriptFailedAssertions.length > 0
            ? `Script error: not supported by InkaTest — ${scriptFailedAssertions
                .map((f) => f.error)
                .filter(Boolean)
                .join('; ')}`
            : '';
        const assertionSummary =
          assertions.length > 0
            ? ` · Tests: ${passedAssertions.length}/${assertions.length} passed${
                realFailedAssertions.length > 0
                  ? ` (Failed: ${realFailedAssertions.map((f) => f.name).join(', ')})`
                  : ''
              }${scriptFailedAssertions.length > 0 ? ` (Script errors: ${scriptFailedAssertions.length})` : ''}`
            : '';
        const preview =
          persistResponses && rawRespText
            ? rawRespText.length > 240
              ? `${rawRespText.slice(0, 240)}...`
              : rawRespText
            : '';

        const detail = `${scriptErrorNote ? `${scriptErrorNote} · ` : ''}HTTP ${response.status} ${response.statusText} (${durationMs}ms)${slaFailureNote}${assertionSummary}${
          preview ? ` · Body: ${preview.replace(/\s+/g, ' ')}` : ''
        }`;

        stepResults[String(order)] = {
          status,
          note: scriptErrorNote,
          apiExecution: {
            method,
            url: resolvedUrl,
            statusCode: response.status,
            statusText: response.statusText,
            durationMs,
            assertions: assertions.length > 0 ? assertions : undefined,
            responseBody: storedResponseBody,
            responseHeaders: respHeadersObj,
          },
        };
        steps.push({
          order,
          name: displayStepName,
          status,
          durationMs,
          detail,
          method,
          url: resolvedUrl,
          statusCode: response.status,
          statusText: response.statusText,
          responseBody: storedResponseBody,
          responseHeaders: respHeadersObj,
          assertions: assertions.length > 0 ? assertions : undefined,
        });
        if (!turnOffLogs) {
          logLines.push(`#${order} [${status.toUpperCase()}] ${method} ${resolvedUrl} -> HTTP ${response.status} (${durationMs}ms)`);
          for (const a of assertions) {
            logLines.push(
              `   ${a.passed ? '✓' : '✗'} [pm.test] ${a.name}${a.error ? ` — ${a.error}` : ''}`
            );
          }
          if (storedResponseBody) {
            logLines.push(`   [Response]: ${rawRespText.slice(0, 500)}`);
          }
        }

        if (!passed && bailOnFailure) {
          bailed = true;
        }
      } catch (err: any) {
        const durationMs = Date.now() - stepStart;
        totalDurationMs += durationMs;
        latencies.push(durationMs);
        const detail = `Request error after ${durationMs}ms: ${err?.message || 'Timeout / Network error'}`;
        stepResults[String(order)] = {
          status: 'fail',
          note: '',
          apiExecution: {
            method,
            url: resolvedUrl,
            durationMs,
            errorDetail: detail,
          },
        };
        steps.push({ order, name: displayStepName, status: 'fail', durationMs, detail });
        if (!turnOffLogs) {
          logLines.push(`#${order} [FAIL] ${method} ${resolvedUrl} -> ${detail}`);
        }
        if (bailOnFailure) {
          bailed = true;
        }
      }
    }
  }

  const passCount = steps.filter((s) => s.status === 'pass').length;
  const failCount = steps.filter((s) => s.status === 'fail').length;
  const errorCount = steps.filter((s) => s.status === 'error').length;
  const skipCount = steps.filter((s) => s.status === 'skip').length;
  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;
  const minLatencyMs = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatencyMs = latencies.length > 0 ? Math.max(...latencies) : 0;

  const overallStatus: 'PASS' | 'FAIL' | 'ERROR' | 'SKIP' =
    failCount > 0 ? 'FAIL' : errorCount > 0 ? 'ERROR' : passCount > 0 ? 'PASS' : 'SKIP';
  const summary = `Postman: ${passCount} passed, ${failCount} failed${
    errorCount > 0 ? `, ${errorCount} script error${errorCount === 1 ? '' : 's'}` : ''
  }, ${skipCount} skipped · avg ${avgLatencyMs}ms (${minLatencyMs}–${maxLatencyMs}ms, total ${totalDurationMs}ms)`;
  logLines.push(`------------------------------`, `Summary: ${summary}`);

  return {
    provider: 'postman',
    overallStatus,
    totalDurationMs,
    avgLatencyMs,
    minLatencyMs,
    maxLatencyMs,
    summary,
    stepResults,
    steps,
    automationLog: logLines.join('\n'),
  };
}

// ============================================================================
// 5. DATADOG SYNTHETICS CLIENT & PARAMETERIZED RUNNER
// ============================================================================

export interface DatadogSyntheticTestItem {
  public_id: string;
  name: string;
  type: string;
  status: string;
  tags: string[];
}

export function normalizeDatadogSite(site?: string): string {
  const clean = (site || 'datadoghq.com')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^api\./, '')
    .replace(/^app\./, '')
    .replace(/\/+$/, '');
  return clean || 'datadoghq.com';
}

/**
 * Datadog app (UI) host differs by region. US1/EU use an `app.` prefix,
 * while other regions (US3, US5, AP1, ...) use the site host directly.
 */
function getDatadogAppBaseUrl(site: string): string {
  const normalized = normalizeDatadogSite(site);
  if (normalized === 'datadoghq.com' || normalized === 'datadoghq.eu' || normalized === 'ddog-gov.com') {
    return `https://app.${normalized}`;
  }
  return `https://${normalized}`;
}

export async function testDatadogConnection(
  config: DatadogIntegrationConfig
): Promise<ToolConnectionTestResult> {
  const start = Date.now();
  const site = normalizeDatadogSite(config.site);
  const apiKey = decrypt((config.apiKey || '').trim());
  const appKey = decrypt((config.appKey || '').trim());

  if (!apiKey || !appKey) {
    return {
      success: false,
      message: 'Both Datadog API Key (DD-API-KEY) and Application Key (DD-APPLICATION-KEY) are required.',
    };
  }

  try {
    const res = await fetch(`https://api.${site}/api/v1/synthetics/tests`, {
      method: 'GET',
      headers: {
        'DD-API-KEY': apiKey,
        'DD-APPLICATION-KEY': appKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        success: false,
        message: `Datadog API (${site}) returned HTTP ${res.status}. Verify API Key, App Key, and Site.`,
        latencyMs,
      };
    }

    const data = await res.json().catch(() => ({}));
    const tests: DatadogSyntheticTestItem[] = (data?.tests || []).map((t: any) => ({
      public_id: t.public_id,
      name: t.name,
      type: t.type || 'api',
      status: t.status || 'live',
      tags: Array.isArray(t.tags) ? t.tags : [],
    }));

    return {
      success: true,
      message: `Connected to Datadog (${site}) · ${tests.length} Synthetic test(s) available`,
      latencyMs,
      meta: { tests },
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Datadog connection failed: ${err?.message || 'Network error'}`,
      latencyMs: Date.now() - start,
    };
  }
}

export interface DatadogResultStep {
  order: number;
  /** Datadog step id; matches the imported InkaTest step metadata. */
  stepId?: string;
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  failureMessage?: string;
  assertions?: PostmanAssertionResult[];
  screenshotBucketKey?: string;
  screenshotUrl?: string;
  /** Captured request/response for Datadog API-test steps, when returned. */
  apiExecution?: StepApiExecutionRecord;
}

export interface DatadogResultDetail {
  publicId: string;
  resultId: string;
  testType: string;
  overallStatus: 'pass' | 'fail' | 'skip';
  failureMessage?: string;
  durationMs: number;
  steps: DatadogResultStep[];
  /** True when the provider returned step-level detail we could map. */
  hasStepDetail: boolean;
  externalResultUrl: string;
}

/**
 * Fetch the detailed result for a single Datadog Synthetic execution.
 *
 * Endpoint differs by test type:
 *  - browser  -> GET /api/v2/synthetics/tests/browser/{public_id}/results/{result_id}
 *  - api / multistep -> GET /api/v1/synthetics/tests/{public_id}/results/{result_id}
 *
 * Returns `null` when the detail cannot be retrieved; callers must keep the
 * aggregate result rather than failing the whole run.
 */
/** Result of a single attempt to read a provider execution result. */
interface DatadogResultEnvelope {
  status: number;
  ok: boolean;
  payload: any;
  resolvedKind: 'browser' | 'api';
  unauthorized: boolean;
  rateLimited: boolean;
  notFound: boolean;
  networkError: boolean;
  retryAfterMs?: number;
}

function parseRetryAfter(res: any): number | undefined {
  const raw = res?.headers?.get?.('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(String(raw));
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/**
 * Fetch the raw result envelope for one execution, preserving the HTTP outcome
 * so callers can distinguish "not ready yet" from an integration error.
 */
async function fetchDatadogResultEnvelope(
  config: DatadogIntegrationConfig,
  publicId: string,
  resultId: string,
  testType?: string
): Promise<DatadogResultEnvelope> {
  const base: DatadogResultEnvelope = {
    status: 0,
    ok: false,
    payload: null,
    resolvedKind: String(testType || '').toLowerCase() === 'browser' ? 'browser' : 'api',
    unauthorized: false,
    rateLimited: false,
    notFound: false,
    networkError: false,
  };

  const site = normalizeDatadogSite(config.site);
  const apiKey = decrypt((config.apiKey || '').trim());
  const appKey = decrypt((config.appKey || '').trim());
  if (!apiKey || !appKey || !publicId || !resultId) return base;

  const headers = {
    'DD-API-KEY': apiKey,
    'DD-APPLICATION-KEY': appKey,
    Accept: 'application/json',
  };
  const isBrowser = String(testType || '').toLowerCase() === 'browser';
  const browserUrl = `https://api.${site}/api/v2/synthetics/tests/browser/${encodeURIComponent(
    publicId
  )}/results/${encodeURIComponent(resultId)}`;
  const genericUrl = `https://api.${site}/api/v1/synthetics/tests/${encodeURIComponent(
    publicId
  )}/results/${encodeURIComponent(resultId)}`;
  const attempts = isBrowser ? [browserUrl, genericUrl] : [genericUrl, browserUrl];

  let last: DatadogResultEnvelope = { ...base };
  for (const url of attempts) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!res) {
      last = { ...last, networkError: true };
      continue;
    }

    last = { ...last, status: res.status };
    if (res.status === 401 || res.status === 403) {
      return { ...last, unauthorized: true };
    }
    if (res.status === 429) {
      return { ...last, rateLimited: true, retryAfterMs: parseRetryAfter(res) };
    }
    if (res.status === 404) {
      // Either this is the wrong endpoint for the test type, or the execution
      // has not materialised a result yet. Try the alternate endpoint, then
      // treat as "pending" if neither returns a payload.
      last = { ...last, notFound: true };
      continue;
    }
    if (!res.ok) {
      continue;
    }

    const payload = await res.json().catch(() => null);
    if (!payload) continue;
    return {
      ...last,
      ok: true,
      payload,
      resolvedKind: isBrowser ? 'browser' : 'api',
    };
  }

  return last;
}

/**
 * Pure mapper: provider result payload -> typed step detail.
 * Exported so status transitions and parsing can be unit tested without fetch.
 */
export function mapDatadogResultPayload(
  payload: any,
  publicId: string,
  resultId: string,
  testType?: string,
  appBaseUrlOverride?: string
): DatadogResultDetail | null {
  if (!payload) return null;
  const hasV2Envelope = Boolean(payload?.data?.attributes);
  const isV2Envelope = Boolean(payload?.data?.attributes?.result);
  // A v2 envelope without a `result` means the execution is still running.
  if (hasV2Envelope && !isV2Envelope) return null;

  const result = isV2Envelope ? payload.data.attributes.result : payload?.result ?? payload;
  if (!result || typeof result !== 'object') return null;

  const rawResultStatus = String(result?.status || '').toLowerCase();
  if (
    ['in_progress', 'pending', 'running', 'queued', 'not_started', 'unknown'].includes(
      rawResultStatus
    )
  ) {
    return null; // not terminal yet
  }
  const looksLikeResult =
    'status' in result || 'steps' in result || 'duration' in result || 'failure' in result;
  if (!looksLikeResult) return null;

  const site = normalizeDatadogSite('datadoghq.com');
  const appBase = appBaseUrlOverride || getDatadogAppBaseUrl(site);
  const resolvedKind = isV2Envelope ? 'browser' : testType || 'api';

  const rawSteps: any[] = Array.isArray(result.steps) ? result.steps : [];

  const mapAssertion = (a: any): PostmanAssertionResult => ({
    name: [a?.type, a?.property, a?.operator].filter(Boolean).join(' ') || 'Datadog assertion',
    passed: a?.valid !== false && a?.passed !== false,
    error: a?.error_message || a?.error,
  });

  const steps: DatadogResultStep[] = rawSteps.map((s: any, idx: number) => {
    const failure = s?.failure || null;
    const isSkipped = s?.skipped === true || String(s?.status || '').toLowerCase() === 'skipped';
    const status: 'pass' | 'fail' | 'skip' = failure
      ? 'fail'
      : isSkipped
      ? 'skip'
      : String(s?.status || '').toLowerCase() === 'failed'
      ? 'fail'
      : 'pass';
    const bucketKeys = s?.bucket_keys || {};
    const screenshotBucketKey =
      bucketKeys?.screenshot || bucketKeys?.after_step_screenshot || bucketKeys?.before_step_screenshot;
    const directShot = [
      s?.screenshot_url,
      s?.screenshotUrl,
      s?.screenshot,
      s?.bucketKeys?.screenshot_url,
      s?.bucket_keys?.screenshot_url,
    ].find((v) => typeof v === 'string' && /^https?:\/\//i.test(v));
    const rawAssertions: any[] = Array.isArray(s?.assertions)
      ? s.assertions
      : Array.isArray(s?.assertion_result)
      ? [s.assertion_result]
      : [];

    const reqObj = s?.request || s?.http_request || s?.request_details || {};
    const resObj = s?.response || s?.http_response || s?.response_details || {};
    const rawBody = resObj?.body ?? resObj?.response_body ?? s?.response_body ?? s?.body;
    const responseBody =
      typeof rawBody === 'string'
        ? rawBody
        : rawBody && typeof rawBody === 'object'
        ? JSON.stringify(rawBody, null, 2)
        : undefined;
    const rawHeaders = resObj?.headers ?? resObj?.headers_obj ?? s?.response_headers ?? s?.headers;
    const responseHeaders: Record<string, string> | undefined = Array.isArray(rawHeaders)
      ? Object.fromEntries(
          rawHeaders
            .map((h: any) => [String(h?.name || h?.key || ''), String(h?.value ?? '')] as const)
            .filter(([k]) => Boolean(k))
        )
      : rawHeaders && typeof rawHeaders === 'object'
      ? Object.fromEntries(
          Object.entries(rawHeaders).map(([k, v]) => [
            k,
            typeof v === 'string' ? v : JSON.stringify(v),
          ])
        )
      : undefined;
    const statusCode =
      Number(resObj?.status_code ?? resObj?.statusCode ?? s?.status_code ?? s?.statusCode) || undefined;
    const method = reqObj?.method || s?.method;
    const url = reqObj?.url || s?.url;
    const durationMs = Math.max(0, Math.round(Number(s?.duration) || 0));
    const apiExecution: StepApiExecutionRecord | undefined =
      method || url || responseBody || statusCode
        ? {
            method: String(method || 'GET').toUpperCase(),
            url: String(url || ''),
            statusCode,
            statusText: resObj?.status_text || resObj?.statusText || s?.status_text || undefined,
            durationMs,
            assertions: rawAssertions.length > 0 ? rawAssertions.map(mapAssertion) : undefined,
            responseBody,
            responseHeaders,
            errorDetail: failure?.message || failure?.internal_message || undefined,
          }
        : undefined;

    return {
      order: idx + 1,
      stepId:
        (typeof s?.stepId === 'string' && s.stepId) ||
        (typeof s?.step_id === 'string' && s.step_id) ||
        (typeof s?.id === 'string' && s.id) ||
        (typeof s?.public_id === 'string' && s.public_id) ||
        undefined,
      name: s?.description || s?.name || `Step ${idx + 1}`,
      status,
      durationMs,
      failureMessage: failure?.message || failure?.internal_message || undefined,
      assertions: rawAssertions.length > 0 ? rawAssertions.map(mapAssertion) : undefined,
      screenshotBucketKey: screenshotBucketKey || undefined,
      screenshotUrl: directShot,
      apiExecution,
    };
  });

  const testFailure = result?.failure || null;
  const hasFailStep = steps.some((s) => s.status === 'fail');
  const allSkip = steps.length > 0 && steps.every((s) => s.status === 'skip');
  const failedByStatus = rawResultStatus === 'failed' || rawResultStatus === 'fail';
  const skippedByStatus = rawResultStatus === 'skipped' || rawResultStatus === 'skip';
  const overallStatus: 'pass' | 'fail' | 'skip' =
    hasFailStep || Boolean(testFailure) || failedByStatus
      ? 'fail'
      : allSkip || skippedByStatus
      ? 'skip'
      : 'pass';

  // Datadog reports browser-test failures on the failing step, not always on the
  // result itself. Promote the step failure so the case-level evidence is never
  // empty when a test genuinely failed.
  const firstFailingStep = steps.find((s) => s.status === 'fail');
  const failureMessage =
    testFailure?.message ||
    testFailure?.internal_message ||
    (overallStatus === 'fail'
      ? firstFailingStep?.failureMessage ||
        (firstFailingStep ? `Step failed: ${firstFailingStep.name}` : 'Datadog reported a failed result')
      : undefined);

  return {
    publicId,
    resultId,
    testType: resolvedKind,
    overallStatus,
    failureMessage,
    durationMs: Math.max(0, Math.round(Number(result?.duration) || 0)),
    steps,
    hasStepDetail: steps.length > 0,
    externalResultUrl: `${appBase}/synthetics/details/${publicId}?resultId=${encodeURIComponent(resultId)}`,
  };
}

/**
 * Fetch the detailed result for a single Datadog Synthetic execution.
 *
 * Endpoint differs by test type:
 *  - browser  -> GET /api/v2/synthetics/tests/browser/{public_id}/results/{result_id}
 *  - api / multistep -> GET /api/v1/synthetics/tests/{public_id}/results/{result_id}
 *
 * Returns `null` when the detail cannot be retrieved; callers must keep the
 * aggregate result rather than failing the whole run.
 */
export async function fetchDatadogSyntheticResultDetail(
  config: DatadogIntegrationConfig,
  publicId: string,
  resultId: string,
  testType?: string,
  appBaseUrlOverride?: string
): Promise<DatadogResultDetail | null> {
  const site = normalizeDatadogSite(config.site);
  const env = await fetchDatadogResultEnvelope(config, publicId, resultId, testType);
  if (!env.ok || !env.payload) return null;
  return mapDatadogResultPayload(
    env.payload,
    publicId,
    resultId,
    testType || env.resolvedKind,
    appBaseUrlOverride || getDatadogAppBaseUrl(site)
  );
}

/**
 * One polling read of a Datadog execution. Distinguishes:
 *  - pending      : no terminal result exists yet
 *  - terminal     : provider returned a finished result
 *  - auth_error   : credentials/permissions rejected (never a test failure)
 *  - rate_limited : back off and retry
 *  - error        : transient/provider error (never a test failure)
 */
export type DatadogExecutionState =
  | { state: 'pending' }
  | { state: 'terminal'; detail: DatadogResultDetail }
  | { state: 'auth_error'; error: string }
  | { state: 'rate_limited'; error: string; retryAfterMs?: number }
  | { state: 'error'; error: string; retryable: boolean };

export async function fetchDatadogSyntheticExecutionState(
  config: DatadogIntegrationConfig,
  publicId: string,
  resultId: string,
  testType?: string
): Promise<DatadogExecutionState> {
  if (!resultId) return { state: 'pending' };
  const site = normalizeDatadogSite(config.site);
  const env = await fetchDatadogResultEnvelope(config, publicId, resultId, testType);

  if (env.unauthorized) {
    return {
      state: 'auth_error',
      error: `Datadog rejected the credentials (HTTP ${env.status}). Check the API/Application key permissions (synthetics_read).`,
    };
  }
  if (env.rateLimited) {
    return {
      state: 'rate_limited',
      error: `Datadog rate limit reached (HTTP ${env.status}).`,
      retryAfterMs: env.retryAfterMs,
    };
  }
  if (!env.ok || !env.payload) {
    if (env.notFound || env.networkError || env.status === 0) return { state: 'pending' };
    return {
      state: 'error',
      error: `Datadog result request failed (HTTP ${env.status}).`,
      retryable: env.status >= 500,
    };
  }

  const detail = mapDatadogResultPayload(
    env.payload,
    publicId,
    resultId,
    testType || env.resolvedKind,
    getDatadogAppBaseUrl(site)
  );
  if (!detail) return { state: 'pending' };
  return { state: 'terminal', detail };
}

/** A single test execution created by a Datadog CI batch trigger. */
export interface DatadogTriggeredExecution {
  publicId: string;
  resultId: string;
  testType?: string;
  testName?: string;
}

export interface DatadogTriggerResult {
  batchId?: string;
  executions: DatadogTriggeredExecution[];
  raw: any;
}

/** Shape returned by GET /api/v1/synthetics/ci/batch/{batch_id}. */
export interface DatadogBatchSnapshot {
  status?: string;
  results: DatadogTriggeredExecution[];
  raw: any;
}

const DATADOG_VAR_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export interface DatadogVariableCandidate {
  /** Variable name without `{{ }}` delimiters. */
  name: string;
  /** Current/example value when the API exposes one. */
  example?: string;
  source: 'test' | 'global' | 'environment';
}

/**
 * Detect variables that Datadog will accept as per-execution overrides.
 *
 * The CI trigger API explicitly supports `variables: { NAME: value }`, replacing
 * `{{ NAME }}` references for that execution only. We therefore surface:
 *  - variables declared on the test (`config.variables` / `variables`)
 *  - any `{{ NAME }}` referenced inside the test definition
 *  - Datadog global variable names (values are intentionally read-only here)
 */
export function detectDatadogVariables(
  rawConfig: any,
  globalVariables: Array<{ name: string; value?: string }> = []
): DatadogVariableCandidate[] {
  const config = rawConfig?.config && typeof rawConfig.config === 'object' ? rawConfig.config : rawConfig;
  const out = new Map<string, DatadogVariableCandidate>();

  const add = (rawName: any, example: any, source: DatadogVariableCandidate['source']) => {
    if (rawName === undefined || rawName === null) return;
    const name = String(rawName).replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
    if (!name) return;
    const existing = out.get(name);
    // Test-defined variables win over globals; keep the richest example.
    if (existing && existing.source === 'test' && source !== 'test') return;
    out.set(name, {
      name,
      example:
        example !== undefined && example !== null && String(example).trim() !== ''
          ? String(example)
          : existing?.example,
      source: existing?.source === 'test' ? 'test' : source,
    });
  };

  const declared = config?.variables;
  if (Array.isArray(declared)) {
    for (const v of declared) {
      add(v?.name ?? v?.key, v?.example ?? v?.value ?? v?.default, 'test');
    }
  } else if (declared && typeof declared === 'object') {
    for (const [name, value] of Object.entries(declared)) {
      add(name, value, 'test');
    }
  }

  // Any `{{ VAR }}` reference anywhere in the test definition is overridable.
  let serialized = '';
  try {
    serialized = JSON.stringify(config) || '';
  } catch {
    serialized = '';
  }
  if (serialized) {
    let match: RegExpExecArray | null;
    const re = new RegExp(DATADOG_VAR_RE.source, 'g');
    while ((match = re.exec(serialized)) !== null) {
      if (match[1] && !match[1].startsWith('$')) add(match[1], undefined, 'test');
    }
  }

  for (const gv of globalVariables) add(gv?.name, gv?.value, 'global');

  return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Trigger Datadog Synthetic tests asynchronously. Returns as soon as Datadog
 * accepts the batch; it does NOT wait for execution results.
 */
export async function triggerDatadogSyntheticsTests(
  config: DatadogIntegrationConfig,
  options: DatadogRunOptions
): Promise<DatadogTriggerResult> {
  const site = normalizeDatadogSite(config.site);
  const apiKey = decrypt((config.apiKey || '').trim());
  const appKey = decrypt((config.appKey || '').trim());
  if (!apiKey || !appKey) {
    throw new Error('Datadog API Key and Application Key are required.');
  }

  const publicIds = (options.publicIds || []).map((id) => id.trim()).filter(Boolean);
  if (publicIds.length === 0) {
    throw new Error('At least one Datadog Synthetic Test public_id (e.g. abc-def-ghi) is required.');
  }

  const executionRule = options.executionRule || config.defaultExecutionRule || 'blocking';
  const delayMs = Math.max(0, Math.min(options.delayMs ?? 0, 10000));
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const runtimeVariables: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.inkaVariables || {})) {
    if (v !== undefined && v !== null) {
      runtimeVariables[k] = String(v);
      runtimeVariables[k.toUpperCase()] = String(v);
    }
  }
  for (const [k, v] of Object.entries(options.datasetParams || {})) {
    if (v !== undefined && v !== null) {
      runtimeVariables[k] = String(v);
      runtimeVariables[k.toUpperCase()] = String(v);
    }
  }

  const envNameKey = (options.environmentName || '').trim().toUpperCase();
  const startUrl =
    options.startUrlOverride?.trim() ||
    (envNameKey && config.envStartUrls?.[envNameKey]) ||
    runtimeVariables['BASE_URL'] ||
    undefined;

  const tests = publicIds.map((public_id) => {
    const entry: Record<string, any> = { public_id, executionRule };
    if (startUrl) entry.startUrl = startUrl;
    if (Object.keys(runtimeVariables).length > 0) entry.variables = runtimeVariables;
    if (options.retryCount && options.retryCount > 0) {
      entry.retry = {
        count: Math.min(options.retryCount, 5),
        interval: Math.min(options.retryIntervalMs || 1000, 10000),
      };
    }
    return entry;
  });

  const res = await fetch(`https://api.${site}/api/v1/synthetics/tests/trigger/ci`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'DD-API-KEY': apiKey,
      'DD-APPLICATION-KEY': appKey,
      Accept: 'application/json',
    },
    body: JSON.stringify({ tests }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const hint =
      res.status === 403
        ? ' Check that the Application Key has the synthetics_write permission.'
        : res.status === 429
        ? ' Datadog rate limit reached; retry shortly.'
        : '';
    throw new Error(`Datadog trigger failed (HTTP ${res.status}): ${errText.slice(0, 200)}${hint}`);
  }

  const raw = await res.json().catch(() => ({}));
  const batchId: string | undefined = raw?.batch_id;
  const rawResults: any[] = Array.isArray(raw?.results) ? raw.results : [];

  // The trigger response may include one result per device/location. Keep the
  // first per test so one InkaTest result maps to one Datadog execution.
  const byPublicId = new Map<string, DatadogTriggeredExecution>();
  for (const r of rawResults) {
    const publicId = String(r?.public_id || r?.test_public_id || '');
    const resultId = String(r?.result_id || '');
    if (!publicId || byPublicId.has(publicId)) continue;
    byPublicId.set(publicId, {
      publicId,
      resultId,
      testType: r?.test_type || r?.type || undefined,
      testName: r?.test_name || undefined,
    });
  }
  // Ensure every requested test is represented even when Datadog omits it.
  for (const pid of publicIds) {
    if (!byPublicId.has(pid)) byPublicId.set(pid, { publicId: pid, resultId: '' });
  }

  return {
    batchId,
    executions: publicIds.map((pid) => byPublicId.get(pid)!),
    raw,
  };
}

/**
 * Read the current state of a CI batch. Used to discover result ids when the
 * trigger response did not include them yet.
 */
export async function fetchDatadogBatchSnapshot(
  config: DatadogIntegrationConfig,
  batchId: string
): Promise<DatadogBatchSnapshot | null> {
  if (!batchId) return null;
  const site = normalizeDatadogSite(config.site);
  const apiKey = decrypt((config.apiKey || '').trim());
  const appKey = decrypt((config.appKey || '').trim());
  if (!apiKey || !appKey) return null;

  const res = await fetch(
    `https://api.${site}/api/v1/synthetics/ci/batch/${encodeURIComponent(batchId)}`,
    {
      headers: {
        'DD-API-KEY': apiKey,
        'DD-APPLICATION-KEY': appKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    }
  ).catch(() => null);
  if (!res || !res.ok) return null;

  const json = await res.json().catch(() => null);
  const data = json?.data || json;
  const rawResults: any[] = Array.isArray(data?.results) ? data.results : [];
  return {
    status: data?.status ? String(data.status) : undefined,
    results: rawResults.map((r: any) => ({
      publicId: String(r?.public_id || r?.test_public_id || ''),
      resultId: String(r?.result_id || ''),
      testType: r?.test_type || r?.type || undefined,
      testName: r?.test_name || undefined,
    })),
    raw: data,
  };
}

export interface DatadogRunOptions {  publicIds: string[];
  environmentName?: string;
  startUrlOverride?: string;
  inkaVariables?: Record<string, string>;
  datasetParams?: Record<string, string>;
  executionRule?: 'blocking' | 'non_blocking' | 'skipped';
  delayMs?: number;
  pollingIntervalMs?: number;
  pollingTimeoutMs?: number;
  retryCount?: number;
  retryIntervalMs?: number;
}

export async function executeDatadogSyntheticsRun(
  config: DatadogIntegrationConfig,
  options: DatadogRunOptions
): Promise<ExternalTestExecutionResult> {
  const site = normalizeDatadogSite(config.site);
  const apiKey = decrypt((config.apiKey || '').trim());
  const appKey = decrypt((config.appKey || '').trim());

  if (!apiKey || !appKey) {
    throw new Error('Datadog API Key and Application Key are required.');
  }

  const publicIds = (options.publicIds || []).map((id) => id.trim()).filter(Boolean);
  if (publicIds.length === 0) {
    throw new Error('At least one Datadog Synthetic Test public_id (e.g. abc-def-ghi) is required.');
  }

  const executionRule = options.executionRule || config.defaultExecutionRule || 'blocking';
  if (executionRule === 'skipped') {
  const stepResults: ExternalTestExecutionResult['stepResults'] = {};
    const steps: ExternalStepExecutionItem[] = publicIds.map((pid, idx) => {
      stepResults[String(idx + 1)] = {
        status: 'skip',
        note: `Datadog Synthetic test ${pid} skipped via executionRule=skipped`,
      };
      return {
        order: idx + 1,
        name: `Datadog Synthetic (${pid})`,
        status: 'skip',
        durationMs: 0,
        detail: 'Skipped by execution rule',
      };
    });

    return {
      provider: 'datadog',
      overallStatus: 'SKIP',
      totalDurationMs: 0,
      summary: `Datadog Synthetics skipped (${publicIds.length} test${publicIds.length === 1 ? '' : 's'})`,
      stepResults,
      steps,
      automationLog: `=== DATADOG SYNTHETICS ===\nExecution Rule: skipped\nTests: ${publicIds.join(', ')}`,
    };
  }

  const delayMs = Math.max(0, Math.min(options.delayMs ?? 0, 10000));
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  // Build runtime variable overrides for Datadog Synthetics
  const runtimeVariables: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.inkaVariables || {})) {
    if (v !== undefined && v !== null) {
      runtimeVariables[k] = String(v);
      runtimeVariables[k.toUpperCase()] = String(v);
    }
  }
  for (const [k, v] of Object.entries(options.datasetParams || {})) {
    if (v !== undefined && v !== null) {
      runtimeVariables[k] = String(v);
      runtimeVariables[k.toUpperCase()] = String(v);
    }
  }

  const envNameKey = (options.environmentName || '').trim().toUpperCase();
  const startUrl =
    options.startUrlOverride?.trim() ||
    (envNameKey && config.envStartUrls?.[envNameKey]) ||
    runtimeVariables['BASE_URL'] ||
    undefined;

  const triggerTestsPayload = publicIds.map((public_id) => {
    const entry: Record<string, any> = {
      public_id,
      executionRule,
    };
    if (startUrl) entry.startUrl = startUrl;
    if (Object.keys(runtimeVariables).length > 0) entry.variables = runtimeVariables;
    if (options.retryCount && options.retryCount > 0) {
      entry.retry = {
        count: Math.min(options.retryCount, 5),
        interval: Math.min(options.retryIntervalMs || 1000, 10000),
      };
    }
    return entry;
  });

  const runStart = Date.now();
  const triggerRes = await fetch(`https://api.${site}/api/v1/synthetics/tests/trigger/ci`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'DD-API-KEY': apiKey,
      'DD-APPLICATION-KEY': appKey,
      Accept: 'application/json',
    },
    body: JSON.stringify({ tests: triggerTestsPayload }),
    signal: AbortSignal.timeout(15000),
  });

  if (!triggerRes.ok) {
    const errText = await triggerRes.text().catch(() => '');
    throw new Error(`Datadog trigger failed (HTTP ${triggerRes.status}): ${errText.slice(0, 200)}`);
  }

  const triggerData = await triggerRes.json();
  const batchId: string | undefined = triggerData?.batch_id;

  const pollInterval = Math.max(1500, Math.min(options.pollingIntervalMs ?? 2500, 10000));
  const pollTimeout = Math.max(5000, Math.min(options.pollingTimeoutMs ?? config.defaultPollingTimeoutMs ?? 35000, 90000));

  let batchData: any = null;
  if (batchId) {
    const deadline = Date.now() + pollTimeout;
    while (Date.now() < deadline) {
      const pollRes = await fetch(
        `https://api.${site}/api/v1/synthetics/ci/batch/${encodeURIComponent(batchId)}`,
        {
          headers: {
            'DD-API-KEY': apiKey,
            'DD-APPLICATION-KEY': appKey,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        }
      ).catch(() => null);

      if (pollRes && pollRes.ok) {
        const json = await pollRes.json().catch(() => null);
        batchData = json?.data || json;
        if (batchData?.status && batchData.status !== 'in_progress') {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }

  const totalDurationMs = Date.now() - runStart;
  const resultsList: any[] = Array.isArray(batchData?.results)
    ? batchData.results
    : Array.isArray(triggerData?.results)
    ? triggerData.results
    : [];

  const stepResults: ExternalTestExecutionResult['stepResults'] = {};
  const steps: ExternalStepExecutionItem[] = [];
  const logLines: string[] = [
    `=== DATADOG SYNTHETICS CI RUN ===`,
    `Site: ${site} | Batch ID: ${batchId || 'N/A'}`,
    `InkaTest Environment: ${options.environmentName || 'Default'}${startUrl ? ` | Start URL: ${startUrl}` : ''}`,
    `Execution Rule: ${executionRule} | Variables Passed: ${Object.keys(runtimeVariables).length}`,
    `---------------------------------`,
  ];

  const detailFailures: string[] = [];
  for (let idx = 0; idx < publicIds.length; idx++) {
    const pid = publicIds[idx];
    const order = idx + 1;
    const match = resultsList.find((r: any) => r.public_id === pid || r.test_public_id === pid) || resultsList[idx];
    const rawStatus = String(match?.status || match?.result?.passed || 'passed').toLowerCase();
    const isFail = rawStatus === 'failed' || rawStatus === 'false' || match?.result?.passed === false;
    const isSkip = rawStatus === 'skipped';
    const status: 'pass' | 'fail' | 'skip' = isSkip ? 'skip' : isFail ? 'fail' : 'pass';
    let effectiveStatus: 'pass' | 'fail' | 'skip' = status;
    const resultId = match?.result_id || '';
    const duration = Number(match?.duration || Math.round(totalDurationMs / publicIds.length));
    const baseResultUrl = resultId
      ? `${getDatadogAppBaseUrl(site)}/synthetics/details/${pid}?resultId=${resultId}`
      : `${getDatadogAppBaseUrl(site)}/synthetics/details/${pid}`;
    const testName = match?.test_name || `Synthetic Test ${pid}`;

    // Ingest step-level diagnostics (and screenshot references) when available.
    // A failure here must never lose the aggregate result.
    let subSteps: ExternalStepExecutionItem[] | undefined;
    let failureMessage: string | undefined;
    let apiExecution: StepApiExecutionRecord | undefined;
    let externalResultUrl = baseResultUrl;
    if (resultId && !isSkip) {
      const testType = match?.test_type || match?.type || match?.config?.type;
      const detailRes = await fetchDatadogSyntheticResultDetail(config, pid, resultId, testType).catch(() => null);
      if (detailRes) {
        if (detailRes.externalResultUrl) externalResultUrl = detailRes.externalResultUrl;
        failureMessage = detailRes.failureMessage;
        // Surface the API response for the failing step first, else the first step.
        apiExecution =
          detailRes.steps.find((s) => s.status === 'fail')?.apiExecution ||
          detailRes.steps.find((s) => Boolean(s.apiExecution))?.apiExecution;
        if (detailRes.hasStepDetail) {
          subSteps = detailRes.steps.map((s) => ({
            order: s.order,
            name: s.name,
            status: s.status,
            durationMs: s.durationMs,
            detail: `[Datadog step] ${s.status.toUpperCase()} (${s.durationMs}ms)${
              s.failureMessage ? ` — ${s.failureMessage}` : ''
            }`,
            assertions: s.assertions,
            failureMessage: s.failureMessage,
            screenshotBucketKey: s.screenshotBucketKey,
            screenshotUrl: s.screenshotUrl,
            apiExecution: s.apiExecution,
          }));
        }
        if (!failureMessage) {
          const firstFail = detailRes.steps.find((s) => s.status === 'fail');
          failureMessage = firstFail?.failureMessage;
        }
      }
    }

    if (effectiveStatus !== 'skip' && failureMessage) effectiveStatus = 'fail';
    const failStepCount = subSteps?.filter((s) => s.status === 'fail').length || 0;
    const detail = `${effectiveStatus.toUpperCase()} (${duration}ms)${resultId ? ` · Result #${resultId}` : ''}${
      subSteps ? ` · ${subSteps.length} step(s)${failStepCount ? `, ${failStepCount} failed` : ''}` : ''
    }${failureMessage ? ` · ${failureMessage}` : ''} · ${externalResultUrl}`;

    stepResults[String(order)] = {
      status: effectiveStatus,
      note: `[${testName}] ${detail}`,
      subSteps,
      failureMessage,
      externalResultUrl,
      apiExecution,
    };
    steps.push({
      order,
      name: testName,
      status: effectiveStatus,
      durationMs: duration,
      detail,
      subSteps,
      failureMessage,
      externalResultUrl,
    });
    if (failureMessage) detailFailures.push(`${testName} (${pid}): ${failureMessage}`);
    logLines.push(`#${order} [${effectiveStatus.toUpperCase()}] ${testName} (${pid}) -> ${detail}`);
    if (subSteps) {
      for (const s of subSteps) {
        logLines.push(
          `   ${s.status === 'pass' ? '✓' : s.status === 'fail' ? '✗' : '○'} ${s.name} (${s.durationMs}ms)${
            s.failureMessage ? ` — ${s.failureMessage}` : ''
          }${s.screenshotBucketKey ? ` [screenshot: ${s.screenshotBucketKey}]` : ''}`
        );
      }
    }
  }

  const failCount = steps.filter((s) => s.status === 'fail').length;
  const passCount = steps.filter((s) => s.status === 'pass').length;
  const overallStatus: 'PASS' | 'FAIL' | 'SKIP' =
    failCount > 0 && executionRule === 'blocking'
      ? 'FAIL'
      : passCount > 0
      ? 'PASS'
      : 'SKIP';

  const summary = `Datadog Synthetics: ${passCount} passed, ${failCount} failed (${totalDurationMs}ms)`;
  logLines.push(`---------------------------------`, `Summary: ${summary}`);
  if (detailFailures.length > 0) {
    logLines.push(`Failure details:`);
    for (const f of detailFailures) logLines.push(`  ✗ ${f}`);
  }

  const primaryResultUrl =
    steps.find((s) => s.externalResultUrl)?.externalResultUrl ||
    (publicIds[0] ? `${getDatadogAppBaseUrl(site)}/synthetics/details/${publicIds[0]}` : undefined);

  return {
    provider: 'datadog',
    overallStatus,
    totalDurationMs,
    summary,
    stepResults,
    steps,
    automationLog: logLines.join('\n'),
    externalUrl: primaryResultUrl,
  };
}
