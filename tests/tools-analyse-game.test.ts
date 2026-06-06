import { describe, it, expect, vi } from 'vitest';
import { analyseGame } from '../src/tools/analyse-game.js';
import type { UciEngine, PositionAnalysis } from '../src/types.js';

function makeEngine(evalValue = 0): UciEngine {
  return {
    displayName: 'MockEngine',
    init: vi.fn(),
    analyse: vi.fn(async (fen: string) => ({
      fen,
      bestMove: 'e2e4',
      evaluation: { type: 'cp' as const, value: evalValue },
      lines: [
        {
          depth: 20,
          score: { type: 'cp' as const, value: evalValue },
          pv: ['e2e4'],
          pvSan: [],
          nodes: 1_000,
          nps: 1_000_000,
          time: 10,
          multipv: 1,
        },
      ],
      depth: 20,
    } satisfies PositionAnalysis)),
    bestMove: vi.fn(async () => 'e2e4'),
    quit: vi.fn(),
  };
}

describe('analyseGame', () => {
  it('throws for an empty PGN', async () => {
    const engine = makeEngine();
    await expect(analyseGame(engine, '', 20)).rejects.toThrow('cannot be empty');
  });

  it('returns text and json for a valid PGN', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5', 20);
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('json');
    expect(typeof result.text).toBe('string');
    expect(typeof result.json).toBe('object');
  });

  it('json contains totalMoves equal to move count', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5', 20);
    expect(result.json).toHaveProperty('totalMoves', 2);
  });

  it('json contains white and black accuracy values', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5', 20);
    expect(result.json).toHaveProperty('whiteAccuracy');
    expect(result.json).toHaveProperty('blackAccuracy');
    expect(typeof result.json.whiteAccuracy).toBe('number');
    expect(typeof result.json.blackAccuracy).toBe('number');
  });

  it('accuracy values are between 0 and 100', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5', 20);
    const wa = result.json.whiteAccuracy as number;
    const ba = result.json.blackAccuracy as number;
    expect(wa).toBeGreaterThanOrEqual(0);
    expect(wa).toBeLessThanOrEqual(100);
    expect(ba).toBeGreaterThanOrEqual(0);
    expect(ba).toBeLessThanOrEqual(100);
  });

  it('moves array has an entry per move', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5', 20);
    const moves = result.json.moves as unknown[];
    expect(moves).toHaveLength(2);
  });

  it('each move has classification, evalDrop, and side', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5', 20);
    const moves = result.json.moves as Array<Record<string, unknown>>;
    for (const m of moves) {
      expect(m).toHaveProperty('classification');
      expect(m).toHaveProperty('evalDrop');
      expect(m).toHaveProperty('side');
    }
  });

  it('first move is white, second is black', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5', 20);
    const moves = result.json.moves as Array<{ side: string }>;
    expect(moves[0].side).toBe('white');
    expect(moves[1].side).toBe('black');
  });

  it('identifies opening from move sequence', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5 2. Nf3 Nc6 3. Bb5', 20);
    expect((result.json.opening as string).toLowerCase()).toContain('ruy');
  });

  it('summary includes blunder/mistake/inaccuracy counts for both sides', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5', 20);
    const summary = result.json.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('whiteBlunders');
    expect(summary).toHaveProperty('whiteMistakes');
    expect(summary).toHaveProperty('whiteInaccuracies');
    expect(summary).toHaveProperty('blackBlunders');
    expect(summary).toHaveProperty('blackMistakes');
    expect(summary).toHaveProperty('blackInaccuracies');
  });

  it('handles a longer game without throwing', async () => {
    const engine = makeEngine();
    const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6';
    await expect(analyseGame(engine, pgn, 20)).resolves.toBeDefined();
  });

  it('text output contains accuracy and move-by-move section', async () => {
    const engine = makeEngine();
    const result = await analyseGame(engine, '1. e4 e5', 20);
    expect(result.text).toContain('%');
    expect(result.text).toContain('Move-by-Move');
  });
});

// A mock engine encoding a STEADY +0.30 White advantage, expressed in the
// engine's side-to-move perspective: White to move -> +cp, Black to move -> -cp.
// A correct report must display this as a stable +0.30 on every ply (White POV),
// never alternating -0.30 / +0.30 with the side to move.
function makeStaticWhiteAdvantageEngine(cp = 30): UciEngine {
  return {
    displayName: 'StaticWhiteAdv',
    init: vi.fn(),
    analyse: vi.fn(async (fen: string) => {
      const sideToMove = fen.split(' ')[1];
      const value = sideToMove === 'w' ? cp : -cp;
      return {
        fen,
        bestMove: 'e2e4',
        evaluation: { type: 'cp' as const, value },
        lines: [
          {
            depth: 20,
            score: { type: 'cp' as const, value },
            pv: ['e2e4'],
            pvSan: [],
            nodes: 1,
            nps: 1,
            time: 1,
            multipv: 1,
          },
        ],
        depth: 20,
      } satisfies PositionAnalysis;
    }),
    bestMove: vi.fn(async () => 'e2e4'),
    quit: vi.fn(),
  };
}

describe('analyseGame — evaluation display (White POV normalisation)', () => {
  it('shows a steady White advantage with a stable sign across plies', async () => {
    const engine = makeStaticWhiteAdvantageEngine(30);
    const result = await analyseGame(engine, '1. e4 e5 2. Nf3 Nc6', 20);
    const moves = result.json.moves as Array<{ evaluation: string }>;

    // +0.30 for White must read +0.30 after every move, regardless of side.
    for (const m of moves) {
      expect(m.evaluation).toBe('+0.30');
    }
    // The Markdown report must not contain the perspective-flipped value.
    expect(result.text).not.toContain('-0.30');
  });

  it('renders a delivered checkmate as "#", not "-M0"', async () => {
    const engine = makeStaticWhiteAdvantageEngine(30);
    const result = await analyseGame(
      engine,
      '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#',
      20
    );
    const moves = result.json.moves as Array<{ move: string; evaluation: string }>;
    const mateMove = moves[moves.length - 1];

    expect(mateMove.move).toBe('Qxf7#');
    expect(mateMove.evaluation).toBe('#');
    expect(result.text).not.toContain('-M0');
  });
});

describe('analyseGame — engine efficiency & resilience', () => {
  it('analyses each position only once (no redundant double analysis)', async () => {
    let calls = 0;
    const engine: UciEngine = {
      displayName: 'Counter',
      init: vi.fn(),
      bestMove: vi.fn(async () => 'e2e4'),
      quit: vi.fn(),
      analyse: vi.fn(async (fen: string, depth: number) => {
        calls++;
        return {
          fen, bestMove: 'e2e4', evaluation: { type: 'cp' as const, value: 20 }, depth,
          lines: [{ depth, score: { type: 'cp' as const, value: 20 }, pv: ['e2e4'], pvSan: [], nodes: 1, nps: 1, time: 1, multipv: 1 }],
        } satisfies PositionAnalysis;
      }),
    };
    // 4 half-moves → start position + one analysis per move = 5 (NOT 1 + 2*4 = 9).
    await analyseGame(engine, '1. e4 e5 2. Nf3 Nc6', 20);
    expect(calls).toBe(5);
  });

  it('marks a move unanalysed when its engine analysis fails, and continues', async () => {
    let call = 0;
    const engine: UciEngine = {
      displayName: 'Flaky',
      init: vi.fn(),
      bestMove: vi.fn(async () => 'e2e4'),
      quit: vi.fn(),
      analyse: vi.fn(async (fen: string, depth: number) => {
        call++;
        if (call === 3) throw new Error('Timeout waiting for "bestmove" after 120000ms');
        return {
          fen, bestMove: 'e2e4', evaluation: { type: 'cp' as const, value: 20 }, depth,
          lines: [{ depth, score: { type: 'cp' as const, value: 20 }, pv: ['e2e4'], pvSan: [], nodes: 1, nps: 1, time: 1, multipv: 1 }],
        } satisfies PositionAnalysis;
      }),
    };
    // Must NOT throw — one failed position is tolerated.
    const result = await analyseGame(engine, '1. e4 e5 2. Nf3 Nc6', 20);
    const summary = result.json.summary as Record<string, unknown>;
    expect(summary.skippedMoves).toBeGreaterThanOrEqual(1);

    const moves = result.json.moves as Array<{ classification: string }>;
    expect(moves).toHaveLength(4); // every move is still listed
    expect(moves.some((m) => m.classification === 'unknown')).toBe(true);
  });

  it('keeps the eval perspective correct for the move after a skip (asymmetric)', async () => {
    // White is a steady +2.00 (side-to-move POV: white +200, black -200).
    // The analysis after 1...e5 fails → that move is skipped; the FOLLOWING move
    // (2. Nf3) must still be scored in the right frame, not with an inverted sign.
    let call = 0;
    const engine: UciEngine = {
      displayName: 'AsymFlaky',
      init: vi.fn(),
      bestMove: vi.fn(async () => 'e2e4'),
      quit: vi.fn(),
      analyse: vi.fn(async (fen: string, depth: number) => {
        call++;
        if (call === 3) throw new Error('Timeout waiting for "bestmove"');
        const value = fen.split(' ')[1] === 'w' ? 200 : -200;
        return {
          fen, bestMove: 'e2e4', evaluation: { type: 'cp' as const, value }, depth,
          lines: [{ depth, score: { type: 'cp' as const, value }, pv: ['e2e4'], pvSan: [], nodes: 1, nps: 1, time: 1, multipv: 1 }],
        } satisfies PositionAnalysis;
      }),
    };
    const result = await analyseGame(engine, '1. e4 e5 2. Nf3', 20);
    const moves = result.json.moves as Array<{ classification: string; evalDrop: number }>;
    expect(moves[1].classification).toBe('unknown'); // 1...e5 was skipped
    // 2. Nf3 holds White's +2.00 → drop ≈ 0, NOT a large negative (inverted POV).
    expect(moves[2].evalDrop).toBe(0);
  });
});
