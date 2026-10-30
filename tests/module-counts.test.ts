import { describe, expect, it } from 'vitest';
import { buildModuleCaseCounts } from '@/lib/repository/module-counts';

const modules = [
  { id: 'auth', parentId: null },
  { id: 'login', parentId: 'auth' },
  { id: 'logout', parentId: 'auth' },
  { id: 'mfa', parentId: 'login' },
];

const cases = [
  { moduleId: 'login' },
  { moduleId: 'mfa' },
  { moduleId: 'logout' },
  { moduleId: null },
  { moduleId: 'deleted-module' },
];

describe('buildModuleCaseCounts', () => {
  it('rolls descendants into the parent total', () => {
    const counts = buildModuleCaseCounts(modules, cases);
    // auth has no direct cases, login owns 1 and mfa 1, logout 1.
    expect(counts.get('auth')).toEqual({ direct: 0, total: 3 });
  });

  it('reports each sub-module subtree total', () => {
    const counts = buildModuleCaseCounts(modules, cases);
    expect(counts.get('login')).toEqual({ direct: 1, total: 2 });
    expect(counts.get('mfa')).toEqual({ direct: 1, total: 1 });
    expect(counts.get('logout')).toEqual({ direct: 1, total: 1 });
  });

  it('counts a parent that also owns cases', () => {
    const counts = buildModuleCaseCounts(
      [{ id: 'parent', parentId: null }, { id: 'child', parentId: 'parent' }],
      [{ moduleId: 'parent' }, { moduleId: 'child' }]
    );
    expect(counts.get('parent')).toEqual({ direct: 1, total: 2 });
    expect(counts.get('child')).toEqual({ direct: 1, total: 1 });
  });

  it('ignores cases without a module or pointing at an unknown module', () => {
    const counts = buildModuleCaseCounts(modules, cases);
    expect([...counts.values()].reduce((sum, c) => sum + c.direct, 0)).toBe(3);
  });

  it('handles an empty tree', () => {
    expect(buildModuleCaseCounts([], []).size).toBe(0);
  });

  it('survives a cyclic parent chain', () => {
    const counts = buildModuleCaseCounts(
      [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }],
      [{ moduleId: 'a' }]
    );
    expect(counts.get('a')?.total).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(counts.get('b')?.total ?? NaN)).toBe(true);
  });
});
