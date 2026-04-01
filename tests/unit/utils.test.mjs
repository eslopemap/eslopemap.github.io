import { describe, it, expect } from 'vitest';
import { smoothArray } from '../../app/js/utils.js';

describe('smoothArray', () => {
  it('returns input unchanged when radius is 0', () => {
    const data = [1, 2, 3, 4, 5];
    expect(smoothArray(data, 0)).toBe(data);
  });

  it('returns input unchanged when data is null/undefined', () => {
    expect(smoothArray(null, 3)).toBeNull();
    expect(smoothArray(undefined, 3)).toBeUndefined();
  });

  it('smooths a simple uniform array to itself', () => {
    const data = [5, 5, 5, 5, 5];
    const result = smoothArray(data, 2);
    expect(result).toEqual([5, 5, 5, 5, 5]);
  });

  it('computes correct moving average with radius 1', () => {
    const data = [1, 3, 5, 3, 1];
    const result = smoothArray(data, 1);
    // i=0: avg(1,3) = 2
    // i=1: avg(1,3,5) = 3
    // i=2: avg(3,5,3) = 11/3
    // i=3: avg(5,3,1) = 3
    // i=4: avg(3,1) = 2
    expect(result[0]).toBeCloseTo(2);
    expect(result[1]).toBeCloseTo(3);
    expect(result[2]).toBeCloseTo(11 / 3);
    expect(result[3]).toBeCloseTo(3);
    expect(result[4]).toBeCloseTo(2);
  });

  it('preserves null values and excludes them from neighbors', () => {
    const data = [2, null, 6, 4, 2];
    const result = smoothArray(data, 1);
    // i=0: avg(2) — neighbor is null, only 2 counts
    expect(result[0]).toBeCloseTo(2);
    // i=1: null stays null
    expect(result[1]).toBeNull();
    // i=2: avg(6,4) — left neighbor is null
    expect(result[2]).toBeCloseTo(5);
    // i=3: avg(6,4,2) = 4
    expect(result[3]).toBeCloseTo(4);
    // i=4: avg(4,2) = 3
    expect(result[4]).toBeCloseTo(3);
  });

  it('handles radius larger than array length gracefully', () => {
    const data = [10, 20, 30];
    const result = smoothArray(data, 100);
    const avg = 20;
    expect(result[0]).toBeCloseTo(avg);
    expect(result[1]).toBeCloseTo(avg);
    expect(result[2]).toBeCloseTo(avg);
  });

  it('handles single-element array', () => {
    expect(smoothArray([42], 5)).toEqual([42]);
  });

  it('handles all-null array', () => {
    expect(smoothArray([null, null, null], 2)).toEqual([null, null, null]);
  });
});
