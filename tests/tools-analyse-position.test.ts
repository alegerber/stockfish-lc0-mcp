import { describe, it, expect, vi } from 'vitest';
import { analysePosition } from '../src/tools/analyse-position.js';
import type { UciEngine, PositionAnalysis } from '../src/types.js';
import { START_FEN } from '../src/constants.js';

function makeEngine(overrides: Partial<PositionAnalysis> = {}): UciEngine {
  const base: PositionAnalysis = {
    fen: START_FEN,
    bestMove: 'e2e4',
    evaluation: { type: 'cp', value: 30 },
    lines: [
      {
        depth: 20,
        score: { type: 'cp', value: 30 },
        pv: ['e2e4', 'e7e5'],
        pvSan: [],
        nodes: 100_000,
        nps: 1_000_000,
        time: 100,
        multipv: 1,
      },
    ],
    depth: 20,
    ...overrides,
  };
  return {
    displayName: 'MockEngine',
    init: vi.fn(),
    analyse: vi.fn(async () => base),
    bestMove: vi.fn(async () => base.bestMove),
    quit: vi.fn(),
  };
}

describe('analysePosition', () => {
  it('throws for an invalid FEN', async () => {
    const engine = makeEngine();
    await expect(analysePosition(engine, 'not a valid fen', 20, 3)).rejects.toThrow('Invalid FEN');
  });

  it('returns text and json for a valid FEN', async () => {
    const engine = makeEngine();
    const result = await analysePosition(engine, START_FEN, 20, 3);
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('json');
    expect(typeof result.text).toBe('string');
    expect(typeof result.json).toBe('object');
  });

  it('json contains expected top-level fields', async () => {
    const engine = makeEngine();
    const result = await analysePosition(engine, START_FEN, 20, 3);
    expect(result.json).toHaveProperty('fen', START_FEN);
    expect(result.json).toHaveProperty('depth', 20);
    expect(result.json).toHaveProperty('bestMove', 'e2e4');
    expect(result.json).toHaveProperty('bestMoveSan', 'e4');
    expect(result.json).toHaveProperty('evaluation');
    expect(result.json).toHaveProperty('evaluationRaw');
    expect(result.json).toHaveProperty('lines');
  });

  it('enriches PV lines with SAN notation', async () => {
    const engine = makeEngine();
    const result = await analysePosition(engine, START_FEN, 20, 3);
    const lines = result.json.lines as Array<{ movesSan: string[] }>;
    expect(lines[0].movesSan).toContain('e4');
    expect(lines[0].movesSan).toContain('e5');
  });

  it('formats evaluation as a string', async () => {
    const engine = makeEngine();
    const result = await analysePosition(engine, START_FEN, 20, 3);
    expect(typeof result.json.evaluation).toBe('string');
    expect(result.json.evaluation).toBe('+0.30');
  });

  it('each line has rank, score, depth, movesUci, movesSan', async () => {
    const engine = makeEngine();
    const result = await analysePosition(engine, START_FEN, 20, 3);
    const lines = result.json.lines as Array<Record<string, unknown>>;
    const line = lines[0];
    expect(line).toHaveProperty('rank');
    expect(line).toHaveProperty('score');
    expect(line).toHaveProperty('depth');
    expect(line).toHaveProperty('movesUci');
    expect(line).toHaveProperty('movesSan');
  });

  it('calls engine.analyse with correct arguments', async () => {
    const engine = makeEngine();
    await analysePosition(engine, START_FEN, 15, 2);
    expect(engine.analyse).toHaveBeenCalledWith(START_FEN, 15, 2, undefined);
  });

  it('text contains depth and evaluation', async () => {
    const engine = makeEngine();
    const result = await analysePosition(engine, START_FEN, 20, 3);
    expect(result.text).toContain('depth 20');
    expect(result.text).toContain('+0.30');
  });

  it('works for a mid-game FEN', async () => {
    const midGameFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    const engine = makeEngine({ fen: midGameFen });
    const result = await analysePosition(engine, midGameFen, 20, 1);
    expect(result.json.fen).toBe(midGameFen);
  });

  it('forwards the abort signal to engine.analyse', async () => {
    const engine = makeEngine();
    const signal = AbortSignal.abort();
    await analysePosition(engine, START_FEN, 20, 3, signal);
    expect(engine.analyse).toHaveBeenCalledWith(START_FEN, 20, 3, signal);
  });
});
