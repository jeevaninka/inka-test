import { describe, expect, it } from 'vitest';
import { moveById, moveByOffset } from '@/lib/suites/ordering';

const cases = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe('suite case ordering', () => {
  it('moves a case down onto the drop target slot', () => {
    expect(ids(moveById(cases, 'a', 'c'))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a case up onto the drop target slot', () => {
    expect(ids(moveById(cases, 'd', 'b'))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('is a no-op when dropping on itself', () => {
    const result = moveById(cases, 'b', 'b');
    expect(result).toBe(cases);
  });

  it('is a no-op for unknown ids', () => {
    expect(moveById(cases, 'zzz', 'a')).toBe(cases);
    expect(moveById(cases, 'a', 'zzz')).toBe(cases);
  });

  it('never mutates the input array', () => {
    const input = [...cases];
    moveById(input, 'a', 'd');
    moveByOffset(input, 'd', -2);
    expect(ids(input)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves by offset in both directions', () => {
    expect(ids(moveByOffset(cases, 'b', 1))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(moveByOffset(cases, 'c', -2))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('clamps at the ends', () => {
    expect(moveByOffset(cases, 'a', -1)).toBe(cases);
    expect(moveByOffset(cases, 'd', 1)).toBe(cases);
    expect(moveByOffset(cases, 'a', 0)).toBe(cases);
  });

  it('keeps a single-case list stable', () => {
    const one = [{ id: 'only' }];
    expect(moveByOffset(one, 'only', 1)).toBe(one);
  });
});
