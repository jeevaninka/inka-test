import type { PostmanCollectionRequestItem } from './tool-clients';

export type PostmanGroupingMode = 'smart' | 'individual' | 'folder';
export type PostmanFolderStrategy = 'flow' | 'individual';

export interface PostmanFolderAnalysis {
  key: string;
  name: string;
  folderPath: string;
  folderId?: string;
  requests: PostmanCollectionRequestItem[];
  recommended: PostmanFolderStrategy;
  reason: string;
}

export interface PostmanImportGroup {
  id: string;
  kind: 'flow' | 'individual';
  label: string;
  folderKey: string;
  folderPath: string;
  folderId?: string;
  requests: PostmanCollectionRequestItem[];
  custom: boolean;
  coversWholeFolder: boolean;
}

export interface PostmanImportPlan {
  folders: PostmanFolderAnalysis[];
  groups: PostmanImportGroup[];
  summary: {
    cases: number;
    flows: number;
    flowRequests: number;
    individuals: number;
  };
}

export function getPostmanFolderKey(
  request: Pick<PostmanCollectionRequestItem, 'folderId' | 'folderPath'>
): string {
  return (request.folderId || '').trim() || (request.folderPath || '').trim() || '__root__';
}

export function getPostmanFolderName(
  request: Pick<PostmanCollectionRequestItem, 'folderPath'>
): string {
  return (request.folderPath || '').trim() || 'Collection root';
}

const SET_VARIABLE_PATTERNS = [
  /pm\.(?:environment|collectionVariables|variables|globals)\.set\s*\(\s*['"]([^'"]+)['"]/g,
  /postman\.set(?:Environment|Global)Variable\s*\(\s*['"]([^'"]+)['"]/g,
];

/** Variables written by a request's pre-request / test scripts. */
export function extractPostmanSetVariables(
  request: Pick<PostmanCollectionRequestItem, 'requestSpec'>
): string[] {
  const spec = request.requestSpec;
  const script = `${spec?.preRequestScript || ''}\n${spec?.testScript || ''}`;
  if (!script.trim()) return [];

  const variables = new Set<string>();
  for (const pattern of SET_VARIABLE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(script)) !== null) {
      if (match[1]?.trim()) variables.add(match[1].trim());
    }
  }
  return Array.from(variables);
}

/** Variables a request reads (placeholders in URL/body/headers). */
export function extractPostmanUsedVariables(
  request: Pick<PostmanCollectionRequestItem, 'requiredVariables'>
): string[] {
  return Array.from(
    new Set((request.requiredVariables || []).map((v) => String(v).trim()).filter(Boolean))
  );
}

/**
 * Groups requests into folders and recommends flow vs individual based on
 * explicit variable chaining: a later request reads a variable that an earlier
 * request in the same folder writes.
 */
export function analyzePostmanFolders(
  requests: PostmanCollectionRequestItem[]
): PostmanFolderAnalysis[] {
  const byFolder = new Map<string, PostmanCollectionRequestItem[]>();

  for (const request of requests) {
    const key = getPostmanFolderKey(request);
    const list = byFolder.get(key) || [];
    list.push(request);
    byFolder.set(key, list);
  }

  const folders: PostmanFolderAnalysis[] = [];

  for (const [key, folderRequests] of byFolder) {
    const ordered = [...folderRequests].sort((a, b) => a.order - b.order);
    const writtenBy = new Map<string, PostmanCollectionRequestItem>();
    let recommended: PostmanFolderStrategy = 'individual';
    let reason = 'No request uses a variable set by an earlier request in this folder.';

    for (const request of ordered) {
      const used = extractPostmanUsedVariables(request);
      const dependency = used.find((variable) => writtenBy.has(variable));
      if (dependency && recommended !== 'flow') {
        const earlier = writtenBy.get(dependency)!;
        recommended = 'flow';
        reason = `${request.name} uses {{${dependency}}} set by ${earlier.name}.`;
      }
      for (const variable of extractPostmanSetVariables(request)) {
        writtenBy.set(variable, request);
      }
    }

    folders.push({
      key,
      name: getPostmanFolderName(ordered[0]),
      folderPath: (ordered[0]?.folderPath || '').trim(),
      folderId: ordered.find((r) => r.folderId)?.folderId,
      requests: ordered,
      recommended,
      reason,
    });
  }

  return folders.sort((a, b) => (a.requests[0]?.order || 0) - (b.requests[0]?.order || 0));
}

function individualGroup(request: PostmanCollectionRequestItem): PostmanImportGroup {
  return {
    id: `individual:${request.order}`,
    kind: 'individual',
    label: request.folderPath?.trim() || 'Collection root',
    folderKey: getPostmanFolderKey(request),
    folderPath: (request.folderPath || '').trim(),
    folderId: request.folderId,
    requests: [request],
    custom: false,
    coversWholeFolder: false,
  };
}

function flowGroup(
  requests: PostmanCollectionRequestItem[],
  folder: PostmanFolderAnalysis | undefined,
  custom: boolean
): PostmanImportGroup {
  const ordered = [...requests].sort((a, b) => a.order - b.order);
  const folderPaths = Array.from(
    new Set(ordered.map((r) => (r.folderPath || '').trim()).filter(Boolean))
  );
  const singleFolderPath = folderPaths.length === 1 ? folderPaths[0] : '';
  const coversWholeFolder = Boolean(
    folder &&
      folder.requests.length > 0 &&
      folder.requests.every((r) => ordered.some((selected) => selected.order === r.order))
  );
  const label = custom && folderPaths.length > 1
    ? 'Custom flow'
    : folder?.name || singleFolderPath || 'Collection root';

  return {
    id: `flow:${ordered.map((r) => r.order).join('-')}${custom ? ':custom' : ''}`,
    kind: 'flow',
    label,
    folderKey: folder?.key || getPostmanFolderKey(ordered[0]),
    folderPath: singleFolderPath,
    // A partial flow must not claim the folder link key: otherwise every other
    // request in that folder would look imported.
    folderId: coversWholeFolder ? folder?.folderId || ordered[0]?.folderId : undefined,
    requests: ordered,
    custom,
    coversWholeFolder,
  };
}

/**
 * Builds the effective import partition for the selected requests.
 *
 * Modes:
 * - smart: per-folder recommendation (flow when variable chaining is detected)
 * - individual: one case per request
 * - folder: one flow per folder
 *
 * Folder overrides and custom flows take precedence over the mode.
 */
export function buildPostmanImportPlan(args: {
  allRequests: PostmanCollectionRequestItem[];
  selectedOrders: Set<number> | number[];
  mode: PostmanGroupingMode;
  folderOverrides?: Record<string, PostmanFolderStrategy>;
  customGroups?: number[][];
  /**
   * Folders that already contain imported requests. A partially imported
   * folder must not become a new journey, so flows fall back to individual
   * cases there.
   */
  flowBlockedFolderKeys?: Set<string> | string[];
}): PostmanImportPlan {
  const selected = args.selectedOrders instanceof Set
    ? args.selectedOrders
    : new Set(args.selectedOrders);
  const folders = analyzePostmanFolders(args.allRequests);
  const byOrder = new Map(args.allRequests.map((request) => [request.order, request]));
  const overrides = args.folderOverrides || {};
  const customGroups = args.customGroups || [];

  // 1. Base partition from the mode + per-folder overrides.
  let groups: PostmanImportGroup[] = [];
  for (const folder of folders) {
    const selectedInFolder = folder.requests.filter((request) => selected.has(request.order));
    if (selectedInFolder.length === 0) continue;

    const requestedStrategy =
      overrides[folder.key] ||
      (args.mode === 'individual'
        ? 'individual'
        : args.mode === 'folder'
          ? 'flow'
          : folder.recommended);
    const strategy = requestedStrategy;

    if (strategy === 'flow' && selectedInFolder.length >= 2) {
      groups.push(flowGroup(selectedInFolder, folder, false));
    } else {
      groups.push(...selectedInFolder.map(individualGroup));
    }
  }

  // 2. Overlay custom flows (can span folders). Only valid groups remove
  //    requests from the base partition.
  const customOrderSet = new Set<number>();
  const customFlows: PostmanImportGroup[] = [];

  for (const rawOrders of customGroups) {
    const requests = Array.from(new Set(rawOrders))
      .map((order) => byOrder.get(order))
      .filter((request): request is PostmanCollectionRequestItem =>
        Boolean(request && selected.has(request.order) && !customOrderSet.has(request.order))
      )
      .sort((a, b) => a.order - b.order);

    if (requests.length < 2) continue;
    for (const request of requests) customOrderSet.add(request.order);

    const folderKeys = new Set(requests.map(getPostmanFolderKey));
    const matchingFolder = folderKeys.size === 1
      ? folders.find((f) => f.key === getPostmanFolderKey(requests[0]))
      : undefined;
    customFlows.push(flowGroup(requests, matchingFolder, true));
  }

  if (customOrderSet.size > 0) {
    const rebuilt: PostmanImportGroup[] = [];
    for (const group of groups) {
      const remaining = group.requests.filter((request) => !customOrderSet.has(request.order));
      if (remaining.length === 0) continue;
      if (group.kind === 'flow') {
        if (remaining.length >= 2) {
          rebuilt.push(flowGroup(remaining, folders.find((f) => f.key === group.folderKey), false));
        } else {
          rebuilt.push(individualGroup(remaining[0]));
        }
      } else {
        rebuilt.push(...remaining.map(individualGroup));
      }
    }
    groups = [...rebuilt, ...customFlows];
  } else {
    groups = [...groups, ...customFlows];
  }

  groups.sort((a, b) => (a.requests[0]?.order || 0) - (b.requests[0]?.order || 0));

  const flows = groups.filter((group) => group.kind === 'flow');
  const individuals = groups.filter((group) => group.kind === 'individual');

  return {
    folders,
    groups,
    summary: {
      cases: groups.length,
      flows: flows.length,
      flowRequests: flows.reduce((sum, group) => sum + group.requests.length, 0),
      individuals: individuals.length,
    },
  };
}
