import { describe, expect, it } from 'vitest';
import {
  analyzePostmanFolders,
  buildPostmanImportPlan,
  extractPostmanSetVariables,
  getPostmanFolderKey,
} from '@/lib/integrations/postman-grouping';
import type { PostmanCollectionRequestItem } from '@/lib/integrations/tool-clients';

function request(
  order: number,
  name: string,
  folder: string,
  overrides: Partial<PostmanCollectionRequestItem> = {}
): PostmanCollectionRequestItem {
  return {
    order,
    requestId: `req-${order}`,
    folderId: `folder-${folder}`,
    name,
    folderPath: folder,
    method: 'GET',
    url: `https://api.test/${name.toLowerCase()}`,
    requiredVariables: [],
    requestSpec: {
      order,
      name,
      folderPath: folder,
      method: 'GET',
      url: `https://api.test/${name.toLowerCase()}`,
      headers: [],
      preRequestScript: '',
      testScript: '',
    },
    ...overrides,
  };
}

describe('postman-grouping', () => {
  it('extracts variables written by pre-request and test scripts', () => {
    const item = request(1, 'Login', 'Auth', {
      requestSpec: {
        order: 1,
        name: 'Login',
        folderPath: 'Auth',
        method: 'POST',
        url: '/login',
        headers: [],
        preRequestScript: `pm.environment.set('tenant', 'acme');`,
        testScript: `pm.collectionVariables.set("token", json.token);\npm.globals.set('userId', 1);`,
      },
    });

    expect(extractPostmanSetVariables(item)).toEqual(['tenant', 'token', 'userId']);
  });

  it('reads variable sets from legacy postman.setEnvironmentVariable too', () => {
    const item = request(1, 'Login', 'Auth', {
      requestSpec: {
        order: 1,
        name: 'Login',
        folderPath: 'Auth',
        method: 'POST',
        url: '/login',
        headers: [],
        preRequestScript: '',
        testScript: `postman.setEnvironmentVariable('auth_token', value);\npostman.setGlobalVariable('tenant', value);`,
      },
    });

    expect(extractPostmanSetVariables(item)).toEqual(['auth_token', 'tenant']);
  });

  it('recommends a flow when a later request reads an earlier request variable', () => {
    const login = request(1, 'Login', 'Auth', {
      requestSpec: {
        order: 1,
        name: 'Login',
        folderPath: 'Auth',
        method: 'POST',
        url: '/login',
        headers: [],
        preRequestScript: '',
        testScript: `pm.environment.set('auth_token', token);`,
      },
    });
    const profile = request(2, 'Profile', 'Auth', {
      requiredVariables: ['auth_token'],
    });

    const [folder] = analyzePostmanFolders([login, profile]);
    expect(folder.key).toBe('folder-Auth');
    expect(folder.recommended).toBe('flow');
    expect(folder.reason).toBe('Profile uses {{auth_token}} set by Login.');
  });

  it('recommends individual when there is no variable dependency', () => {
    const first = request(1, 'List', 'Catalog');
    const second = request(2, 'Detail', 'Catalog');

    const [folder] = analyzePostmanFolders([first, second]);
    expect(folder.recommended).toBe('individual');
    expect(folder.reason).toContain('No request uses a variable set by an earlier request');
  });

  it('ignores dependency direction: an earlier read is not a flow signal', () => {
    const reader = request(1, 'Reader', 'Mixed', { requiredVariables: ['token'] });
    const writer = request(2, 'Writer', 'Mixed', {
      requestSpec: {
        order: 2,
        name: 'Writer',
        folderPath: 'Mixed',
        method: 'POST',
        url: '/writer',
        headers: [],
        preRequestScript: '',
        testScript: `pm.environment.set('token', value);`,
      },
    });

    const [folder] = analyzePostmanFolders([reader, writer]);
    expect(folder.recommended).toBe('individual');
  });

  it('builds smart mode: dependent folder as one flow, independent folder as individuals', () => {
    const login = request(1, 'Login', 'Auth', {
      requestSpec: {
        order: 1,
        name: 'Login',
        folderPath: 'Auth',
        method: 'POST',
        url: '/login',
        headers: [],
        preRequestScript: '',
        testScript: `pm.environment.set('auth_token', token);`,
      },
    });
    const profile = request(2, 'Profile', 'Auth', { requiredVariables: ['auth_token'] });
    const list = request(3, 'List', 'Catalog');
    const detail = request(4, 'Detail', 'Catalog');

    const plan = buildPostmanImportPlan({
      allRequests: [login, profile, list, detail],
      selectedOrders: [1, 2, 3, 4],
      mode: 'smart',
    });

    expect(plan.groups.map((group) => group.kind)).toEqual([
      'flow',
      'individual',
      'individual',
    ]);
    expect(plan.groups[0].requests.map((item) => item.order)).toEqual([1, 2]);
    expect(plan.summary).toEqual({
      cases: 3,
      flows: 1,
      flowRequests: 2,
      individuals: 2,
    });
  });

  it('builds individual mode for every selected request', () => {
    const login = request(1, 'Login', 'Auth', {
      requestSpec: {
        order: 1,
        name: 'Login',
        folderPath: 'Auth',
        method: 'POST',
        url: '/login',
        headers: [],
        preRequestScript: '',
        testScript: `pm.environment.set('auth_token', token);`,
      },
    });
    const profile = request(2, 'Profile', 'Auth', { requiredVariables: ['auth_token'] });

    const plan = buildPostmanImportPlan({
      allRequests: [login, profile],
      selectedOrders: [1, 2],
      mode: 'individual',
    });

    expect(plan.groups.every((group) => group.kind === 'individual')).toBe(true);
    expect(plan.summary).toEqual({
      cases: 2,
      flows: 0,
      flowRequests: 0,
      individuals: 2,
    });
  });

  it('builds folder mode with one flow per folder', () => {
    const first = request(1, 'List', 'Catalog');
    const second = request(2, 'Detail', 'Catalog');
    const third = request(3, 'Ping', 'Health');

    const plan = buildPostmanImportPlan({
      allRequests: [first, second, third],
      selectedOrders: [1, 2, 3],
      mode: 'folder',
    });

    // A one-request folder is a case, not a flow.
    expect(plan.groups.map((group) => group.kind)).toEqual(['flow', 'individual']);
    expect(plan.groups[0].requests.map((item) => item.order)).toEqual([1, 2]);
  });

  it('respects a per-folder individual override in smart mode', () => {
    const login = request(1, 'Login', 'Auth', {
      requestSpec: {
        order: 1,
        name: 'Login',
        folderPath: 'Auth',
        method: 'POST',
        url: '/login',
        headers: [],
        preRequestScript: '',
        testScript: `pm.environment.set('auth_token', token);`,
      },
    });
    const profile = request(2, 'Profile', 'Auth', { requiredVariables: ['auth_token'] });

    const plan = buildPostmanImportPlan({
      allRequests: [login, profile],
      selectedOrders: [1, 2],
      mode: 'smart',
      folderOverrides: { [getPostmanFolderKey(login)]: 'individual' },
    });

    expect(plan.groups.every((group) => group.kind === 'individual')).toBe(true);
  });

  it('falls back to individual cases when only one request is selected in a folder', () => {
    const login = request(1, 'Login', 'Auth', {
      requestSpec: {
        order: 1,
        name: 'Login',
        folderPath: 'Auth',
        method: 'POST',
        url: '/login',
        headers: [],
        preRequestScript: '',
        testScript: `pm.environment.set('auth_token', token);`,
      },
    });
    const profile = request(2, 'Profile', 'Auth', { requiredVariables: ['auth_token'] });

    const plan = buildPostmanImportPlan({
      allRequests: [login, profile],
      selectedOrders: [2],
      mode: 'folder',
    });

    expect(plan.groups.map((group) => group.kind)).toEqual(['individual']);
  });

  it('allows a custom flow that touches a partially imported folder', () => {
    const first = request(1, 'List', 'Catalog');
    const second = request(2, 'Detail', 'Catalog');

    const plan = buildPostmanImportPlan({
      allRequests: [first, second],
      selectedOrders: [1, 2],
      mode: 'individual',
      customGroups: [[1, 2]],
    });

    expect(plan.groups.map((group) => group.kind)).toEqual(['flow']);
    expect(plan.groups[0].custom).toBe(true);
    expect(plan.groups[0].requests.map((r) => r.order)).toEqual([1, 2]);
  });

  it('allows remaining requests in a partially imported folder to be grouped as a flow', () => {
    const first = request(1, 'List', 'Catalog');
    const second = request(2, 'Detail', 'Catalog');
    const third = request(3, 'Create', 'Catalog');

    // first is already imported, second and third are selected in folder mode
    const plan = buildPostmanImportPlan({
      allRequests: [first, second, third],
      selectedOrders: [2, 3],
      mode: 'folder',
    });

    expect(plan.groups.map((group) => group.kind)).toEqual(['flow']);
    expect(plan.groups[0].requests.map((r) => r.order)).toEqual([2, 3]);
    expect(plan.groups[0].coversWholeFolder).toBe(false);
    expect(plan.groups[0].folderId).toBeUndefined();
  });

  it('creates a custom flow across folders and removes it from base groups', () => {
    const first = request(1, 'List', 'Catalog');
    const second = request(2, 'Detail', 'Catalog');
    const third = request(3, 'Ping', 'Health');

    const plan = buildPostmanImportPlan({
      allRequests: [first, second, third],
      selectedOrders: [1, 2, 3],
      mode: 'individual',
      customGroups: [[1, 3]],
    });

    expect(plan.groups.map((group) => group.kind)).toEqual(['flow', 'individual']);
    expect(plan.groups[0].custom).toBe(true);
    expect(plan.groups[0].label).toBe('Custom flow');
    expect(plan.groups[0].requests.map((item) => item.order)).toEqual([1, 3]);
    expect(plan.groups[1].requests.map((item) => item.order)).toEqual([2]);
    expect(plan.summary.cases).toBe(2);
  });

  it('only a whole-folder flow claims the folder id', () => {
    const first = request(1, 'List', 'Catalog');
    const second = request(2, 'Detail', 'Catalog');

    const full = buildPostmanImportPlan({
      allRequests: [first, second],
      selectedOrders: [1, 2],
      mode: 'folder',
    });
    expect(full.groups[0].coversWholeFolder).toBe(true);
    expect(full.groups[0].folderId).toBe('folder-Catalog');

    const third = request(3, 'Create', 'Catalog');
    const partial = buildPostmanImportPlan({
      allRequests: [first, second, third],
      selectedOrders: [1, 2],
      mode: 'folder',
    });
    expect(partial.groups[0].kind).toBe('flow');
    expect(partial.groups[0].coversWholeFolder).toBe(false);
    expect(partial.groups[0].folderId).toBeUndefined();
  });

  it('drops custom groups with fewer than two selected requests', () => {
    const first = request(1, 'List', 'Catalog');
    const second = request(2, 'Detail', 'Catalog');

    const plan = buildPostmanImportPlan({
      allRequests: [first, second],
      selectedOrders: [1],
      mode: 'individual',
      customGroups: [[1, 2]],
    });

    expect(plan.groups.map((group) => group.kind)).toEqual(['individual']);
    expect(plan.groups[0].requests.map((item) => item.order)).toEqual([1]);
  });

  it('groups root requests under a synthetic folder key', () => {
    const root = request(1, 'Root', '');
    root.folderId = undefined;

    expect(getPostmanFolderKey(root)).toBe('__root__');
    const [folder] = analyzePostmanFolders([root]);
    expect(folder.name).toBe('Collection root');
  });
});
