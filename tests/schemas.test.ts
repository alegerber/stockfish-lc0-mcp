import { describe, it, expect } from 'vitest';
import {
  AnalysePositionSchema,
  AnalyseGameSchema,
  Lc0AnalyseGameSchema,
  LookupOpeningSchema,
  IdentifyOpeningSchema,
  GeneratePuzzleSchema,
} from '../src/schemas/index.js';
import { MAX_DEPTH, MAX_MULTI_PV, LC0_GAME_DEFAULT_DEPTH, LC0_DEPTH_TO_NODES } from '../src/constants.js';

const VALID_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const VALID_PGN = '1. e4 e5';

describe('AnalysePositionSchema', () => {
  it('accepts valid input', () => {
    const result = AnalysePositionSchema.safeParse({ fen: VALID_FEN, depth: 15, multiPv: 2 });
    expect(result.success).toBe(true);
  });

  it('applies default depth and multiPv', () => {
    const result = AnalysePositionSchema.safeParse({ fen: VALID_FEN });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.depth).toBe(20);
      expect(result.data.multiPv).toBe(3);
    }
  });

  it('rejects depth above MAX_DEPTH', () => {
    const result = AnalysePositionSchema.safeParse({ fen: VALID_FEN, depth: MAX_DEPTH + 1 });
    expect(result.success).toBe(false);
  });

  it('rejects multiPv above MAX_MULTI_PV', () => {
    const result = AnalysePositionSchema.safeParse({ fen: VALID_FEN, multiPv: MAX_MULTI_PV + 1 });
    expect(result.success).toBe(false);
  });

  it('rejects depth of 0', () => {
    const result = AnalysePositionSchema.safeParse({ fen: VALID_FEN, depth: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects missing fen', () => {
    const result = AnalysePositionSchema.safeParse({ depth: 10 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown extra fields', () => {
    const result = AnalysePositionSchema.safeParse({ fen: VALID_FEN, unknownField: true });
    expect(result.success).toBe(false);
  });
});

describe('AnalyseGameSchema', () => {
  it('accepts valid input', () => {
    const result = AnalyseGameSchema.safeParse({ pgn: VALID_PGN, depth: 18 });
    expect(result.success).toBe(true);
  });

  it('applies default depth', () => {
    const result = AnalyseGameSchema.safeParse({ pgn: VALID_PGN });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.depth).toBe(22);
    }
  });

  it('rejects depth above MAX_DEPTH', () => {
    const result = AnalyseGameSchema.safeParse({ pgn: VALID_PGN, depth: MAX_DEPTH + 1 });
    expect(result.success).toBe(false);
  });

  it('rejects missing pgn', () => {
    const result = AnalyseGameSchema.safeParse({ depth: 10 });
    expect(result.success).toBe(false);
  });
});

describe('LookupOpeningSchema', () => {
  it('accepts a name query', () => {
    const result = LookupOpeningSchema.safeParse({ query: 'Sicilian' });
    expect(result.success).toBe(true);
  });

  it('accepts an ECO code query', () => {
    const result = LookupOpeningSchema.safeParse({ query: 'B20' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty string', () => {
    const result = LookupOpeningSchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });
});

describe('IdentifyOpeningSchema', () => {
  it('accepts a PGN string', () => {
    const result = IdentifyOpeningSchema.safeParse({ pgn: VALID_PGN });
    expect(result.success).toBe(true);
  });

  it('rejects missing pgn', () => {
    const result = IdentifyOpeningSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('GeneratePuzzleSchema', () => {
  it('accepts valid input', () => {
    const result = GeneratePuzzleSchema.safeParse({ fen: VALID_FEN, depth: 22 });
    expect(result.success).toBe(true);
  });

  it('applies default depth', () => {
    const result = GeneratePuzzleSchema.safeParse({ fen: VALID_FEN });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.depth).toBe(22);
    }
  });

  it('rejects depth above MAX_DEPTH', () => {
    const result = GeneratePuzzleSchema.safeParse({ fen: VALID_FEN, depth: MAX_DEPTH + 1 });
    expect(result.success).toBe(false);
  });
});

describe('Lc0AnalyseGameSchema (#12 M2 — lower Lc0 game default)', () => {
  it('defaults depth to LC0_GAME_DEFAULT_DEPTH, below the Stockfish game default', () => {
    expect(Lc0AnalyseGameSchema.parse({ pgn: VALID_PGN }).depth).toBe(LC0_GAME_DEFAULT_DEPTH);
    expect(LC0_GAME_DEFAULT_DEPTH).toBeLessThan(AnalyseGameSchema.parse({ pgn: VALID_PGN }).depth);
  });

  it('maps that default to a modest per-position node budget (avoids CPU timeouts)', () => {
    expect(LC0_DEPTH_TO_NODES[LC0_GAME_DEFAULT_DEPTH]).toBeLessThanOrEqual(20_000);
  });

  it('still honours an explicit depth and the MAX_DEPTH bound', () => {
    expect(Lc0AnalyseGameSchema.parse({ pgn: VALID_PGN, depth: 18 }).depth).toBe(18);
    expect(Lc0AnalyseGameSchema.safeParse({ pgn: VALID_PGN, depth: MAX_DEPTH + 1 }).success).toBe(false);
  });
});
