import { describe, it, expect } from 'vitest';
import {
  isValidFen,
  uciToSan,
  lookupOpening,
  searchOpenings,
  isGameOver,
  parsePgn,
} from '../src/services/chess-utils.js';
import { START_FEN } from '../src/constants.js';

describe('isValidFen', () => {
  it('accepts the starting position', () => {
    expect(isValidFen(START_FEN)).toBe(true);
  });

  it('accepts a mid-game FEN', () => {
    expect(isValidFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3')).toBe(true);
  });

  it('rejects an invalid FEN string', () => {
    expect(isValidFen('not a fen')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidFen('')).toBe(false);
  });
});

describe('uciToSan', () => {
  it('converts e2e4 to e4 from starting position', () => {
    expect(uciToSan(START_FEN, 'e2e4')).toBe('e4');
  });

  it('converts d2d4 to d4 from starting position', () => {
    expect(uciToSan(START_FEN, 'd2d4')).toBe('d4');
  });

  it('converts Nf3 correctly', () => {
    expect(uciToSan(START_FEN, 'g1f3')).toBe('Nf3');
  });

  it('returns the uci as-is for an illegal move', () => {
    expect(uciToSan(START_FEN, 'e2e5')).toBe('e2e5');
  });
});

describe('lookupOpening', () => {
  it('identifies the Sicilian Defense', () => {
    const result = lookupOpening(['e4', 'c5']);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Sicilian Defense');
    expect(result?.eco).toBe('B20');
  });

  it('identifies the Italian Game', () => {
    const result = lookupOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Italian Game');
    expect(result?.eco).toBe('C50');
  });

  it('identifies the Ruy Lopez over the shorter King\'s Pawn match', () => {
    const result = lookupOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(result?.eco).toBe('C60');
    expect(result?.name).toBe('Ruy Lopez');
  });

  it('returns null for an unrecognised (illegal) move token', () => {
    // No legal replay → no positions to match → null (and no crash).
    expect(lookupOpening(['notamove'])).toBeNull();
  });

  it('returns null for an empty move list', () => {
    expect(lookupOpening([])).toBeNull();
  });

  // ── Coverage gaps the expanded book closes (issue #48) ──────────────────
  it('identifies the Ruy Lopez Morphy Defence (C70) one ply deeper than C60', () => {
    const result = lookupOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(result?.eco).toBe('C70');
    expect(result?.name).toContain('Morphy');
  });

  it("identifies the King's Indian main line as E-code, not a shallow Queen's Pawn match", () => {
    const result = lookupOpening(['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6']);
    expect(result?.eco?.[0]).toBe('E');
    expect(result?.name).toContain("King's Indian");
  });

  it("names 1.e4 e5 2.Bc4 the Bishop's Opening, not a generic King's Pawn Game", () => {
    const result = lookupOpening(['e4', 'e5', 'Bc4']);
    expect(result?.name).toBe("Bishop's Opening");
  });

  // ── Transposition-robust (position-based) matching (issue #49) ──────────
  it('matches the same opening regardless of move order (transposition)', () => {
    const direct = lookupOpening(['d4', 'd5', 'c4']); // Queen's Gambit, direct order
    const transposed = lookupOpening(['c4', 'd5', 'd4']); // same position, other order
    expect(direct).not.toBeNull();
    expect(transposed?.eco).toBe(direct?.eco);
    expect(transposed?.name).toBe(direct?.name);
  });

  it('keeps en-passant-distinct positions separate (Mason-Keres C33 vs Van Geet A00)', () => {
    // Same piece placement, but ep is legal on only one path — they are genuinely
    // different positions and must not collapse to one entry (review finding).
    const masonKeres = lookupOpening(['e4', 'e5', 'f4', 'exf4', 'Nc3']); // ep not available
    const vanGeet = lookupOpening(['Nc3', 'e5', 'f4', 'exf4', 'e4']); // ...fxe3 e.p. legal
    expect(masonKeres?.eco).toBe('C33');
    expect(vanGeet?.eco).toBe('A00');
    expect(masonKeres?.eco).not.toBe(vanGeet?.eco);
  });
});

describe('searchOpenings', () => {
  it('finds openings by partial name (case-insensitive)', () => {
    const results = searchOpenings('sicilian');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((o) => o.name.toLowerCase().includes('sicilian') || o.eco.toLowerCase().includes('sicilian'))).toBe(true);
  });

  it('finds openings by ECO code', () => {
    const results = searchOpenings('C50');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((o) => o.eco === 'C50')).toBe(true);
  });

  it('returns an empty array for no match', () => {
    expect(searchOpenings('zzznomatch')).toHaveLength(0);
  });

  it("finds the King's Indian Defense by name (absent from the old 20-entry book)", () => {
    const results = searchOpenings("King's Indian");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((o) => o.eco.startsWith('E'))).toBe(true);
  });

  it('ranks an exact ECO match first', () => {
    const results = searchOpenings('C50');
    expect(results[0].eco).toBe('C50');
  });
});

describe('isGameOver', () => {
  it('returns false for the starting position', () => {
    const result = isGameOver(START_FEN);
    expect(result.over).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('detects checkmate (Fool\'s Mate)', () => {
    // Position after 1.f3 e5 2.g4 Qh4# — white is in checkmate
    const checkmateFen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    const result = isGameOver(checkmateFen);
    expect(result.over).toBe(true);
    expect(result.reason).toBe('checkmate');
  });

  it('detects stalemate', () => {
    // Black king a8, white queen b6, white king h1, black to move — all king moves covered
    const stalemateFen = 'k7/8/1Q6/8/8/8/8/7K b - - 0 1';
    const result = isGameOver(stalemateFen);
    expect(result.over).toBe(true);
    expect(result.reason).toBe('stalemate');
  });
});

describe('parsePgn', () => {
  it('parses move count correctly', () => {
    const { moves } = parsePgn('1. e4 e5 2. Nf3 Nc6');
    expect(moves).toHaveLength(4);
  });

  it('returns correct SAN moves', () => {
    const { moves } = parsePgn('1. e4 e5');
    expect(moves[0].san).toBe('e4');
    expect(moves[1].san).toBe('e5');
  });

  it('returns correct UCI moves', () => {
    const { moves } = parsePgn('1. e4 e5');
    expect(moves[0].uci).toBe('e2e4');
    expect(moves[1].uci).toBe('e7e5');
  });

  it('returns a FEN after each move', () => {
    const { moves } = parsePgn('1. e4');
    expect(moves[0].fen).toContain('rnbqkbnr');
    expect(moves[0].fen).not.toBe(START_FEN);
  });

  it('extracts PGN headers', () => {
    const pgn = '[White "Magnus"]\n[Black "Hikaru"]\n1. e4 e5';
    const { headers } = parsePgn(pgn);
    expect(headers['White']).toBe('Magnus');
    expect(headers['Black']).toBe('Hikaru');
  });
});
