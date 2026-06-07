import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEPTH,
  DEFAULT_MULTI_PV,
  MAX_DEPTH,
  MAX_MULTI_PV,
  BLUNDER_THRESHOLD,
  MISTAKE_THRESHOLD,
  INACCURACY_THRESHOLD,
  GOOD_THRESHOLD,
  MAX_REPORTED_DROP,
  MIN_TACTIC_ADVANTAGE,
  CHARACTER_LIMIT,
  DEFAULT_ENGINE_TIMEOUT_MS,
  LC0_DEPTH_TO_NODES,
  START_FEN,
} from '../src/constants.js';

describe('constants', () => {
  describe('LC0_DEPTH_TO_NODES', () => {
    it('covers depths 0..MAX_DEPTH', () => {
      expect(LC0_DEPTH_TO_NODES.length).toBe(MAX_DEPTH + 1);
    });

    it('is monotonically non-decreasing', () => {
      for (let i = 1; i < LC0_DEPTH_TO_NODES.length; i++) {
        expect(LC0_DEPTH_TO_NODES[i]).toBeGreaterThanOrEqual(LC0_DEPTH_TO_NODES[i - 1]);
      }
    });

    it('ramps from 100 nodes to 1,000,000', () => {
      expect(LC0_DEPTH_TO_NODES[1]).toBe(100);
      expect(LC0_DEPTH_TO_NODES[MAX_DEPTH]).toBe(1_000_000);
    });

    it('contains only positive integers', () => {
      for (const n of LC0_DEPTH_TO_NODES) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThan(0);
      }
    });
  });

  it('orders the move-classification thresholds strictly', () => {
    expect(BLUNDER_THRESHOLD).toBeGreaterThan(MISTAKE_THRESHOLD);
    expect(MISTAKE_THRESHOLD).toBeGreaterThan(INACCURACY_THRESHOLD);
    expect(INACCURACY_THRESHOLD).toBeGreaterThan(GOOD_THRESHOLD);
    expect(GOOD_THRESHOLD).toBeGreaterThan(0);
  });

  it('keeps the defaults within their advertised bounds', () => {
    expect(DEFAULT_DEPTH).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_DEPTH).toBeLessThanOrEqual(MAX_DEPTH);
    expect(DEFAULT_MULTI_PV).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_MULTI_PV).toBeLessThanOrEqual(MAX_MULTI_PV);
  });

  it('has positive size/limit constants', () => {
    for (const v of [MAX_REPORTED_DROP, MIN_TACTIC_ADVANTAGE, CHARACTER_LIMIT, DEFAULT_ENGINE_TIMEOUT_MS]) {
      expect(v).toBeGreaterThan(0);
    }
  });

  it('START_FEN is a well-formed white-to-move starting position', () => {
    const fields = START_FEN.split(' ');
    expect(fields).toHaveLength(6);
    expect(fields[1]).toBe('w');
    expect(START_FEN).toContain('rnbqkbnr');
  });
});
