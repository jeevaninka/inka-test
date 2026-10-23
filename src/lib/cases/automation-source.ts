/**
 * Automation source registry.
 *
 * A case is either manual, or automated by a specific tool. Each integrated
 * tool contributes one entry here; everything else (filter pills, counts,
 * labels, icons) is derived from this list. Adding a new integration is a
 * single registry entry — no changes to filters or UI.
 */

export type CaseAutomationSource = string;

export const MANUAL_SOURCE = 'manual';
export const EXTERNAL_SOURCE = 'external';
/** Label for automated cases that are not linked to an integrated tool. */
export const EXTERNAL_SOURCE_LABEL = 'Others (not integrated)';

export interface AutomationSourceDefinition {
  /** Stable id stored on filters and used for comparisons (e.g. `postman`). */
  id: string;
  /** Human label used in filters and badges. */
  label: string;
  /** True when the case carries this tool's link metadata. */
  matches: (fields: Record<string, any>, testCase: any) => boolean;
}

export const AUTOMATION_SOURCE_DEFS: AutomationSourceDefinition[] = [
  {
    id: 'postman',
    label: 'Postman',
    matches: (fields) => {
      const postman = fields._postman || {};
      return Boolean(
        postman.collectionUid || postman.requestId || postman.linkKey || postman.folderId
      );
    },
  },
  {
    id: 'datadog',
    label: 'Datadog',
    matches: (fields) => {
      const datadog = fields._datadog || {};
      return Boolean(
        (Array.isArray(datadog.publicIds) && datadog.publicIds.length > 0) ||
          datadog.publicId ||
          datadog.linkKey
      );
    },
  },
];

function readCustomFields(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as Record<string, any>) : {};
}

export function getCaseCustomFields(testCase: any): Record<string, any> {
  return readCustomFields(testCase?.customFields ?? testCase?.custom_fields);
}

export function isAutomatedCase(testCase: any): boolean {
  const type = String(testCase?.type || testCase?.caseType || '').toLowerCase();
  if (type === 'auto' || type === 'automated') return true;
  const fields = getCaseCustomFields(testCase);
  return AUTOMATION_SOURCE_DEFS.some((def) => def.matches(fields, testCase));
}

/**
 * Where an automated case actually executes:
 * - a registry id (postman, datadog, ...): linked to an in-app runner
 * - external: automated somewhere else, but not integrated with InkaTest
 * - manual: not an automated case
 */
export function getCaseAutomationSource(testCase: any): CaseAutomationSource {
  const fields = getCaseCustomFields(testCase);
  for (const def of AUTOMATION_SOURCE_DEFS) {
    if (def.matches(fields, testCase)) return def.id;
  }
  return isAutomatedCase(testCase) ? EXTERNAL_SOURCE : MANUAL_SOURCE;
}

export function getAutomationSourceLabel(
  source: string,
  externalLabel: string = EXTERNAL_SOURCE_LABEL
): string {
  if (source === MANUAL_SOURCE) return 'Manual';
  if (source === EXTERNAL_SOURCE) return externalLabel;
  return AUTOMATION_SOURCE_DEFS.find((def) => def.id === source)?.label || source;
}

export function getCaseAutomationLabel(
  source: CaseAutomationSource,
  externalLabel: string = EXTERNAL_SOURCE_LABEL
): string {
  if (source === MANUAL_SOURCE) return 'Manual';
  if (source === EXTERNAL_SOURCE) return `Automated · ${externalLabel}`;
  return `Automated · ${getAutomationSourceLabel(source, externalLabel)}`;
}

/** Integrated automation tools, in registry order. */
export function getAutomationSourceOptions(): Array<{ value: string; label: string }> {
  return AUTOMATION_SOURCE_DEFS.map((def) => ({ value: def.id, label: def.label }));
}

export function caseMatchesMode(testCase: any, mode: string): boolean {
  if (!mode || mode === 'mixed') return true;
  const source = getCaseAutomationSource(testCase);
  const isAuto = source !== MANUAL_SOURCE;
  if (mode === 'manual') return !isAuto;
  if (mode === 'auto' || mode === 'automated') return isAuto;
  return true;
}

export function caseMatchesSource(testCase: any, source: string): boolean {
  if (!source) return true;
  return getCaseAutomationSource(testCase) === source;
}

export interface AutomationFilterCounts {
  all: number;
  manual: number;
  auto: number;
  /** One entry per registry source id, plus `external` for not-integrated cases. */
  [source: string]: number;
}

/** Bucket counts for the interconnected Mode / Integration filter. */
export function getAutomationFilterCounts(cases: any[]): AutomationFilterCounts {
  const counts: AutomationFilterCounts = {
    all: cases.length,
    manual: 0,
    auto: 0,
  };
  for (const def of AUTOMATION_SOURCE_DEFS) counts[def.id] = 0;
  counts[EXTERNAL_SOURCE] = 0;

  for (const testCase of cases) {
    const source = getCaseAutomationSource(testCase);
    if (source === MANUAL_SOURCE) {
      counts.manual += 1;
      continue;
    }
    counts.auto += 1;
    counts[source] = (counts[source] || 0) + 1;
  }

  return counts;
}
