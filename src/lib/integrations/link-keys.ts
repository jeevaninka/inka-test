/**
 * Stable external link keys for imported Postman / Datadog test cases.
 *
 * Imported cases are linked by provider ids, never by array order or title.
 * Older cases may not have a stored `linkKey`, so keys are derived from the
 * provider ids that were persisted alongside them.
 */

export type ExternalProvider = 'postman' | 'datadog';

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

export function customFieldsOf(caseOrFields: any): Record<string, any> {
  if (!caseOrFields || typeof caseOrFields !== 'object') return {};
  const fields = caseOrFields.customFields ?? caseOrFields.custom_fields;
  return fields ? readCustomFields(fields) : readCustomFields(caseOrFields);
}

export function postmanRequestLinkKey(collectionUid: string, requestId: string): string {
  return `postman:${collectionUid}:request:${requestId}`;
}

export function postmanFolderLinkKey(collectionUid: string, folderId: string): string {
  return `postman:${collectionUid}:folder:${folderId}`;
}

export function datadogTestLinkKey(publicId: string): string {
  return `datadog:${publicId}`;
}

export interface PostmanLinkKeys {
  requestKeys: string[];
  folderKeys: string[];
}

/**
 * Returns the request-level and folder-level link keys stored on a case.
 *
 * A journey import links the whole folder (folder key). An independent import
 * links one request (request key) even though it may also carry the folder id,
 * so we never derive a folder key when a request key exists.
 */
export function getPostmanLinkKeys(caseOrFields: any): PostmanLinkKeys {
  const fields = customFieldsOf(caseOrFields);
  const postman = readCustomFields(fields._postman);
  const requestKeys: string[] = [];
  const folderKeys: string[] = [];

  const storedKey = typeof postman.linkKey === 'string' ? postman.linkKey.trim() : '';
  if (storedKey.startsWith('postman:')) {
    if (storedKey.includes(':folder:')) folderKeys.push(storedKey);
    else requestKeys.push(storedKey);
  }

  const collectionUid =
    typeof postman.collectionUid === 'string' ? postman.collectionUid.trim() : '';
  const requestId = typeof postman.requestId === 'string' ? postman.requestId.trim() : '';
  const folderId = typeof postman.folderId === 'string' ? postman.folderId.trim() : '';

  if (collectionUid && requestId) {
    const key = postmanRequestLinkKey(collectionUid, requestId);
    if (!requestKeys.includes(key)) requestKeys.push(key);
  } else if (collectionUid && folderId) {
    // Only legacy journeys (no requestId) represent the whole folder.
    const key = postmanFolderLinkKey(collectionUid, folderId);
    if (!folderKeys.includes(key)) folderKeys.push(key);
  }

  // Flows store the requests they cover so partial/custom flows mark exactly
  // those requests as imported, never the whole folder.
  const coveredRequestIds = Array.isArray(postman.requestIds) ? postman.requestIds : [];
  if (collectionUid) {
    for (const raw of coveredRequestIds) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const key = postmanRequestLinkKey(collectionUid, raw.trim());
      if (!requestKeys.includes(key)) requestKeys.push(key);
    }
  }

  return { requestKeys, folderKeys };
}

export function getDatadogLinkKeys(caseOrFields: any): string[] {
  const fields = customFieldsOf(caseOrFields);
  const datadog = readCustomFields(fields._datadog);

  // A case is only "already imported" when it belongs to exactly one Datadog
  // test. Legacy combined cases listed several public ids; they must not mark
  // any of those tests as imported.
  const publicIds = Array.from(
    new Set(
      (Array.isArray(datadog.publicIds) ? datadog.publicIds : [])
        .filter((raw): raw is string => typeof raw === 'string')
        .map((raw) => raw.trim())
        .filter(Boolean)
    )
  );

  if (publicIds.length > 1) return [];
  if (publicIds.length === 1) return [datadogTestLinkKey(publicIds[0])];

  // Older single-test cases may only carry the stored link key.
  const storedKey = typeof datadog.linkKey === 'string' ? datadog.linkKey.trim() : '';
  return storedKey.startsWith('datadog:') ? [storedKey] : [];
}

/** All stable external keys stored on a case (Postman + Datadog). */
export function getExternalLinkKeys(caseOrFields: any): string[] {
  const { requestKeys, folderKeys } = getPostmanLinkKeys(caseOrFields);
  return [...requestKeys, ...folderKeys, ...getDatadogLinkKeys(caseOrFields)];
}

export interface ImportedCaseRef {
  caseId: string;
  displayId: string;
  title: string;
}

/**
 * Builds a key -> case index so the import picker can mark items that are
 * already linked to a repository case.
 */
export function buildImportedCaseIndex(cases: any[] | null | undefined): Map<string, ImportedCaseRef> {
  const index = new Map<string, ImportedCaseRef>();
  for (const testCase of cases || []) {
    if (!testCase) continue;
    const ref: ImportedCaseRef = {
      caseId: String(testCase.id || ''),
      displayId: String(testCase.displayId || testCase.display_id || ''),
      title: String(testCase.title || ''),
    };
    for (const key of getExternalLinkKeys(testCase)) {
      if (key && !index.has(key)) index.set(key, ref);
    }
  }
  return index;
}
