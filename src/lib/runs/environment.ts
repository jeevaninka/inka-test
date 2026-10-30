/**
 * Run environment details (C8).
 *
 * A run records *where* it executed: platform, OS, browser, device, build and
 * any project-specific pairs. They are stored in `TestRun.custom_fields`
 * (`environmentDetails`) so no migration is needed, and surfaced as compact
 * chips in the run header and as editable fields in the Edit Run dialog.
 */

export interface RunEnvironmentCustomField {
  label: string;
  value: string;
}

export interface RunEnvironmentDetails {
  platform?: string;
  os?: string;
  browser?: string;
  device?: string;
  build?: string;
  custom?: RunEnvironmentCustomField[];
}

export const ENVIRONMENT_DETAIL_LABELS: Record<
  Exclude<keyof RunEnvironmentDetails, 'custom'>,
  string
> = {
  platform: 'Platform',
  os: 'OS',
  browser: 'Browser',
  device: 'Device',
  build: 'Build',
};

const KNOWN_KEYS = Object.keys(ENVIRONMENT_DETAIL_LABELS) as Array<
  Exclude<keyof RunEnvironmentDetails, 'custom'>
>;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Read the details out of a run payload without assuming a shape. */
export function readRunEnvironmentDetails(run: any): RunEnvironmentDetails {
  const details: RunEnvironmentDetails = {};
  const raw =
    run?.customFields?.environmentDetails ??
    run?.custom_fields?.environmentDetails ??
    run?.environmentDetails ??
    null;

  if (raw && typeof raw === 'object') {
    for (const key of KNOWN_KEYS) {
      const text = asText((raw as any)[key]);
      if (text) details[key] = text;
    }
    if (Array.isArray((raw as any).custom)) {
      const custom = (raw as any).custom
        .map((row: any) => ({
          label: asText(row?.label),
          value: asText(row?.value),
        }))
        .filter((row: RunEnvironmentCustomField) => row.label && row.value);
      if (custom.length > 0) details.custom = custom;
    }
  }

  // `build_version` is the canonical column; surface it as a chip too, even
  // when the run has no custom environment payload at all.
  if (!details.build) {
    const legacyBuild = asText(run?.buildVersion ?? run?.build_version);
    if (legacyBuild) details.build = legacyBuild;
  }
  return details;
}

/** Chips for the run header: "Platform: iOS", "Build: 2.4.1", … */
export function summarizeRunEnvironment(details: RunEnvironmentDetails): Array<{
  key: string;
  label: string;
  value: string;
}> {
  const chips: Array<{ key: string; label: string; value: string }> = [];
  for (const key of KNOWN_KEYS) {
    const value = details[key];
    if (value) chips.push({ key, label: ENVIRONMENT_DETAIL_LABELS[key], value });
  }
  for (const [index, row] of (details.custom || []).entries()) {
    chips.push({ key: `custom-${index}`, label: row.label, value: row.value });
  }
  return chips;
}

/** Normalise an incoming payload before persisting it. */
export function normalizeRunEnvironmentDetails(input: unknown): RunEnvironmentDetails {
  if (!input || typeof input !== 'object') return {};
  const raw = input as Record<string, unknown>;
  const details: RunEnvironmentDetails = {};
  for (const key of KNOWN_KEYS) {
    const text = asText(raw[key]);
    if (text) details[key] = text;
  }
  if (Array.isArray(raw.custom)) {
    const custom = raw.custom
      .map((row: any) => ({ label: asText(row?.label), value: asText(row?.value) }))
      .filter((row: RunEnvironmentCustomField) => row.label && row.value);
    if (custom.length > 0) details.custom = custom;
  }
  return details;
}

export function hasRunEnvironmentDetails(details: RunEnvironmentDetails): boolean {
  return summarizeRunEnvironment(details).length > 0;
}
