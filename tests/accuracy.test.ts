import { describe, it, expect } from 'vitest';
import { winProbability, aggregateAccuracy } from '../src/tools/analyse-game.js';

describe('winProbability (#13 — mate-saturation clamp)', () => {
  it('is 0.5 at an equal position', () => {
    expect(winProbability(0)).toBeCloseTo(0.5, 5);
  });

  it('clamps cp to ±1000 so mate scores do not saturate to 0/1', () => {
    // centipawns() maps mate to ±10000; without the clamp win% would be ~1/~0.
    expect(winProbability(10000)).toBe(winProbability(1000));
    expect(winProbability(-10000)).toBe(winProbability(-1000));
    expect(winProbability(1000)).toBeLessThan(0.98); // a gradient remains
    expect(winProbability(1000)).toBeGreaterThan(0.95);
  });

  it('is symmetric around 0', () => {
    expect(winProbability(300) + winProbability(-300)).toBeCloseTo(1, 5);
  });
});

describe('aggregateAccuracy (#13 — arithmetic+harmonic blend)', () => {
  it('returns the move value for a single-move game', () => {
    expect(aggregateAccuracy([42])).toBeCloseTo(42, 5);
  });

  it('returns 100 for an all-perfect game', () => {
    expect(aggregateAccuracy([100, 100, 100])).toBeCloseTo(100, 5);
  });

  it('falls below the arithmetic mean when moves vary (harmonic penalty)', () => {
    // arithmetic = 75; harmonic = 2/(1/100 + 1/50) = 66.667; mean = 70.833.
    const agg = aggregateAccuracy([100, 50]);
    expect(agg).toBeLessThan(75);
    expect(agg).toBeCloseTo(70.83, 1);
  });

  it('does not collapse to 0 from a single catastrophic move', () => {
    // arithmetic stays high; the reciprocal floor keeps the harmonic term finite.
    const agg = aggregateAccuracy([100, 100, 100, 100, 0]);
    expect(agg).toBeGreaterThan(20);
    expect(agg).toBeLessThan(60);
  });

  it('returns 100 for an empty move list', () => {
    expect(aggregateAccuracy([])).toBe(100);
  });
});
