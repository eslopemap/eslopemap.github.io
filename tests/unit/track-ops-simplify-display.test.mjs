import { describe, it, expect } from 'vitest';
import { simplifyForDisplay } from '../../app/js/track-ops.js';

describe('simplifyForDisplay', () => {
  it('returns empty array for null/undefined', () => {
    expect(simplifyForDisplay(null)).toEqual([]);
    expect(simplifyForDisplay(undefined)).toEqual([]);
  });

  it('returns 2D coords unchanged for small tracks (<= minPoints)', () => {
    const coords = [[7.0, 46.0, 1000], [7.1, 46.1, 1100], [7.2, 46.2, 1200]];
    const result = simplifyForDisplay(coords, 5, 500);
    expect(result).toEqual([[7.0, 46.0], [7.1, 46.1], [7.2, 46.2]]);
  });

  it('strips elevation even for short tracks', () => {
    const coords = [[7.0, 46.0, 500], [7.1, 46.1, 600]];
    const result = simplifyForDisplay(coords);
    expect(result).toEqual([[7.0, 46.0], [7.1, 46.1]]);
    expect(result[0]).toHaveLength(2);
  });

  it('simplifies tracks exceeding minPoints threshold', () => {
    // Generate a straight line with 1000 points — all mid-points are on the line
    // so DP should remove them all except first and last
    const coords = [];
    for (let i = 0; i < 1000; i++) {
      const t = i / 999;
      coords.push([7.0 + t * 0.1, 46.0 + t * 0.1, 1000]);
    }
    const result = simplifyForDisplay(coords, 5, 500);
    // A perfectly straight line should simplify to just 2 points
    expect(result.length).toBe(2);
    expect(result[0]).toEqual([7.0, 46.0]);
    expect(result[result.length - 1]).toEqual([coords[999][0], coords[999][1]]);
  });

  it('retains points that deviate more than threshold', () => {
    // 600-point track: mostly on a straight line with some large deviations
    const coords = [];
    for (let i = 0; i < 600; i++) {
      const t = i / 599;
      // Every 50th point deviates by 0.001° ≈ 80m — well above 5m threshold
      const offset = (i % 50 === 25) ? 0.001 : 0;
      coords.push([7.0 + t * 0.1, 46.0 + offset, 1000]);
    }
    const result = simplifyForDisplay(coords, 5, 500);
    // Should retain the deviated points (about 12 zigzags + first + last)
    expect(result.length).toBeGreaterThan(2);
    // But far fewer than original since most points are on the line
    expect(result.length).toBeLessThan(100);
  });

  it('respects custom minPoints threshold', () => {
    const coords = [];
    for (let i = 0; i < 100; i++) {
      coords.push([7.0 + i * 0.001, 46.0, 1000]);
    }
    // With minPoints=50, the 100-point straight line should be simplified
    const result = simplifyForDisplay(coords, 5, 50);
    expect(result.length).toBe(2); // straight line → 2 points

    // With minPoints=200, the 100-point track passes through unchanged
    const result2 = simplifyForDisplay(coords, 5, 200);
    expect(result2.length).toBe(100);
  });
});
