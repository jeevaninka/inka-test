/**
 * Ordering helpers for suite case lists.
 *
 * Suite case order is the execution order a run copies, so it has to be
 * predictable: move the dragged case to the drop target's slot, keep every
 * other case in place, and never mutate the input array.
 */

interface HasId {
  id: string;
}

/** Move `id` onto `targetId`'s slot. Returns the input array when nothing changes. */
export function moveById<T extends HasId>(items: T[], id: string, targetId: string): T[] {
  if (id === targetId) return items;
  const from = items.findIndex((item) => item.id === id);
  const to = items.findIndex((item) => item.id === targetId);
  if (from === -1 || to === -1) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Move `id` by `offset` slots (negative = up). Clamps at the ends. */
export function moveByOffset<T extends HasId>(items: T[], id: string, offset: number): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from === -1 || offset === 0) return items;
  const to = from + offset;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
