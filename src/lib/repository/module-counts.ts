/**
 * Module case counts for the repository tree.
 *
 * A module badge shows the number of cases that live in the module **and** in
 * every descendant sub-module, so collapsing a branch never hides work. Direct
 * counts are kept alongside so callers can still say "3 cases here, 7 in the
 * subtree" when they need to.
 */

export interface ModuleLike {
  id: string;
  parentId?: string | null;
}

export interface ModuleCaseCount {
  /** Cases assigned to this module only. */
  direct: number;
  /** Cases assigned to this module plus every descendant module. */
  total: number;
}

export function buildModuleCaseCounts(
  modules: ModuleLike[],
  cases: { moduleId?: string | null }[]
): Map<string, ModuleCaseCount> {
  const directCounts = new Map<string, number>();
  for (const testCase of cases) {
    const moduleId = testCase.moduleId || null;
    if (!moduleId) continue;
    directCounts.set(moduleId, (directCounts.get(moduleId) || 0) + 1);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const mod of modules) {
    const parentId = mod.parentId || null;
    if (!parentId) continue;
    const list = childrenByParent.get(parentId) || [];
    list.push(mod.id);
    childrenByParent.set(parentId, list);
  }

  const totals = new Map<string, number>();
  const computeTotal = (moduleId: string, seen: Set<string>): number => {
    const cached = totals.get(moduleId);
    if (cached !== undefined) return cached;
    // Defensive: a malformed parent chain must not hang the tree.
    if (seen.has(moduleId)) return 0;
    seen.add(moduleId);
    let total = directCounts.get(moduleId) || 0;
    for (const childId of childrenByParent.get(moduleId) || []) {
      total += computeTotal(childId, seen);
    }
    seen.delete(moduleId);
    totals.set(moduleId, total);
    return total;
  };

  const counts = new Map<string, ModuleCaseCount>();
  for (const mod of modules) {
    counts.set(mod.id, {
      direct: directCounts.get(mod.id) || 0,
      total: computeTotal(mod.id, new Set()),
    });
  }
  return counts;
}
