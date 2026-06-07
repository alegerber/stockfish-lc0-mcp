import { describe, it, expect, vi } from 'vitest';
import { generatePuzzle } from '../src/tools/puzzle.js';
import type { UciEngine, PositionAnalysis, UciLine } from '../src/types.js';
import { START_FEN } from '../src/constants.js';

function makeEngine(lines: UciLine[]): UciEngine {
  return {
    displayName: 'MockEngine',
    init: vi.fn(),
    analyse: vi.fn(async (fen: string) => ({
      fen,
      bestMove: lines[0]?.pv[0] ?? 'e2e4',
      evaluation: lines[0]?.score ?? { type: 'cp' as const, value: 0 },
      lines,
      depth: 20,
    } satisfies PositionAnalysis)),
    bestMove: vi.fn(async () => lines[0]?.pv[0] ?? 'e2e4'),
    quit: vi.fn(),
  };
}

const twoLines: UciLine[] = [
  {
    depth: 20,
    score: { type: 'cp', value: 630 },
    pv: ['e2e4', 'e7e5'],
    pvSan: [],
    nodes: 100_000,
    nps: 1_000_000,
    time: 100,
    multipv: 1,
  },
  {
    depth: 20,
    score: { type: 'cp', value: 30 },
    pv: ['d2d4', 'e7e5'],
    pvSan: [],
    nodes: 100_000,
    nps: 1_000_000,
    time: 100,
    multipv: 2,
  },
];

describe('generatePuzzle', () => {
  it('throws for an invalid FEN', async () => {
    const engine = makeEngine(twoLines);
    await expect(generatePuzzle(engine, 'not a fen', 20)).rejects.toThrow('Invalid FEN');
  });

  it('throws when engine returns no lines', async () => {
    const engine = makeEngine([]);
    await expect(generatePuzzle(engine, START_FEN, 20)).rejects.toThrow('no lines');
  });

  it('returns text and json', async () => {
    const engine = makeEngine(twoLines);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('json');
  });

  it('json has fen, solution, solutionSan, theme, difficulty, explanation', async () => {
    const engine = makeEngine(twoLines);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.json).toHaveProperty('fen', START_FEN);
    expect(result.json).toHaveProperty('solution');
    expect(result.json).toHaveProperty('solutionSan');
    expect(result.json).toHaveProperty('theme');
    expect(result.json).toHaveProperty('difficulty');
    expect(result.json).toHaveProperty('explanation');
  });

  it('classifies easy when advantage > 500 cp', async () => {
    // best=630, second=30, advantage=600
    const engine = makeEngine(twoLines);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.json.difficulty).toBe('easy');
  });

  it('classifies medium when the gap is 301–500 cp', async () => {
    const lines: UciLine[] = [
      { ...twoLines[0], score: { type: 'cp', value: 550 } },
      { ...twoLines[1], score: { type: 'cp', value: 150 } },
    ];
    const engine = makeEngine(lines);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.json.difficulty).toBe('medium'); // gap = 400
  });

  it('classifies hard when the gap is 150–300 cp', async () => {
    const lines: UciLine[] = [
      { ...twoLines[0], score: { type: 'cp', value: 300 } },
      { ...twoLines[1], score: { type: 'cp', value: 150 } },
    ];
    const engine = makeEngine(lines);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.json.difficulty).toBe('hard'); // gap = 150
  });

  it('detects mate theme when score type is mate', async () => {
    const mateLines: UciLine[] = [
      { ...twoLines[0], score: { type: 'mate', value: 2 } },
    ];
    const engine = makeEngine(mateLines);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.json.theme).toContain('Mate');
  });

  it('solution SAN moves are valid algebraic notation', async () => {
    const engine = makeEngine(twoLines);
    const result = await generatePuzzle(engine, START_FEN, 20);
    const san = result.json.solutionSan as string[];
    expect(san.length).toBeGreaterThan(0);
    // e4 is SAN for e2e4 from starting position
    expect(san[0]).toBe('e4');
  });

  it('solution length is at most 5 moves', async () => {
    const longPvLine: UciLine = {
      ...twoLines[0],
      pv: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'b1c3'],
    };
    // Two lines with a clear gap so the gate passes and a solution is produced.
    const engine = makeEngine([longPvLine, twoLines[1]]);
    const result = await generatePuzzle(engine, START_FEN, 20);
    const solution = result.json.solution as string[];
    expect(solution.length).toBeLessThanOrEqual(5);
  });

  it('calls engine.analyse with 2 PVs', async () => {
    const engine = makeEngine(twoLines);
    await generatePuzzle(engine, START_FEN, 15);
    expect(engine.analyse).toHaveBeenCalledWith(START_FEN, 15, 2, undefined);
  });

  it('text includes difficulty, FEN, theme, and spoiler solution', async () => {
    const engine = makeEngine(twoLines);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.text).toContain('easy');
    expect(result.text).toContain(START_FEN);
    expect(result.text).toContain('Solution');
  });
});

describe('generatePuzzle — tactic gate & output format', () => {
  it('returns a no-tactic result for a quiet position (gap below threshold)', async () => {
    const quiet: UciLine[] = [
      { ...twoLines[0], score: { type: 'cp', value: 80 } },
      { ...twoLines[1], score: { type: 'cp', value: 50 } }, // gap 30 < 150
    ];
    const engine = makeEngine(quiet);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.json.hasTactic).toBe(false);
    expect(result.text).toContain('No clear tactic');
    expect(result.json).not.toHaveProperty('solution');
  });

  it('returns a no-tactic result when only one (non-mate) line exists', async () => {
    const single: UciLine[] = [{ ...twoLines[0], score: { type: 'cp', value: 120 } }];
    const engine = makeEngine(single);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.json.hasTactic).toBe(false);
  });

  it('still makes a puzzle for a forced mate even with a single line', async () => {
    const mate: UciLine[] = [{ ...twoLines[0], score: { type: 'mate', value: 2 } }];
    const engine = makeEngine(mate);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.json.hasTactic).toBe(true);
    expect(result.json.theme).toContain('Mate');
  });

  it('makes a puzzle at the gate boundary (gap == 150)', async () => {
    const boundary: UciLine[] = [
      { ...twoLines[0], score: { type: 'cp', value: 200 } },
      { ...twoLines[1], score: { type: 'cp', value: 50 } }, // gap exactly 150
    ];
    const engine = makeEngine(boundary);
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.json.hasTactic).toBe(true);
    expect(result.json).toHaveProperty('solution');
  });

  it('marks solver moves in bold and wraps the solution in a <details> spoiler', async () => {
    const engine = makeEngine(twoLines); // pv e2e4 e7e5 → e4 (solver) e5 (opponent)
    const result = await generatePuzzle(engine, START_FEN, 20);
    expect(result.text).toContain('<details>');
    expect(result.text).toContain('<summary>Solution</summary>');
    expect(result.text).toContain('**e4**'); // solver move bolded
    expect(result.text).not.toContain('||'); // no Discord spoiler syntax
  });

  it('treats a position where the side to move is being mated as no tactic', async () => {
    // best line is a mate AGAINST the mover (negative) — a lost position, not a puzzle
    const losing: UciLine[] = [{ ...twoLines[0], score: { type: 'mate', value: -3 } }];
    const result = await generatePuzzle(makeEngine(losing), START_FEN, 20);
    expect(result.json.hasTactic).toBe(false);
    expect(result.json).not.toHaveProperty('solution');
    expect(result.text).not.toContain('Mate in 3');
  });

  it('does not reveal the theme in the visible header (it lives inside the spoiler)', async () => {
    const mate: UciLine[] = [{ ...twoLines[0], score: { type: 'mate', value: 1 } }];
    const result = await generatePuzzle(makeEngine(mate), START_FEN, 20);
    const header = result.text.split('<details>')[0];
    expect(header).not.toContain('Mate'); // theme not leaked before the spoiler
    expect(result.text).toContain('Mate in 1'); // but present inside it
  });
});
