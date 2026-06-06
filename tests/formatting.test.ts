import { describe, it, expect } from 'vitest';
import { formatScore, formatPositionAnalysis, formatGameAnalysis } from '../src/services/formatting.js';
import type { PositionAnalysis, GameAnalysis } from '../src/types.js';

describe('formatScore', () => {
  it('formats a positive centipawn score', () => {
    expect(formatScore({ type: 'cp', value: 150 })).toBe('+1.50');
  });

  it('formats a negative centipawn score', () => {
    expect(formatScore({ type: 'cp', value: -75 })).toBe('-0.75');
  });

  it('formats zero as positive', () => {
    expect(formatScore({ type: 'cp', value: 0 })).toBe('+0.00');
  });

  it('formats a positive mate score', () => {
    expect(formatScore({ type: 'mate', value: 3 })).toBe('M3');
  });

  it('formats a negative mate score', () => {
    expect(formatScore({ type: 'mate', value: -2 })).toBe('-M2');
  });
});

describe('formatPositionAnalysis', () => {
  const analysis: PositionAnalysis = {
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    bestMove: 'e2e4',
    evaluation: { type: 'cp', value: 30 },
    lines: [
      {
        depth: 20,
        score: { type: 'cp', value: 30 },
        pv: ['e2e4'],
        pvSan: ['e4'],
        nodes: 1_000_000,
        nps: 500_000,
        time: 2000,
        multipv: 1,
      },
    ],
    depth: 20,
  };

  it('includes the depth in the output', () => {
    expect(formatPositionAnalysis(analysis)).toContain('depth 20');
  });

  it('includes the formatted evaluation', () => {
    expect(formatPositionAnalysis(analysis)).toContain('+0.30');
  });

  it('includes the best move', () => {
    expect(formatPositionAnalysis(analysis)).toContain('e2e4');
  });

  it('includes the FEN', () => {
    expect(formatPositionAnalysis(analysis)).toContain(analysis.fen);
  });

  it('includes top lines section', () => {
    expect(formatPositionAnalysis(analysis)).toContain('Top lines');
  });
});

describe('formatGameAnalysis', () => {
  const analysis: GameAnalysis = {
    moves: [
      {
        moveNumber: 1,
        side: 'white',
        moveSan: 'e4',
        moveUci: 'e2e4',
        fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        evalBefore: { type: 'cp', value: 20 },
        evalAfter: { type: 'cp', value: 30 },
        bestMove: 'e2e4',
        bestMoveSan: 'e4',
        classification: 'best',
        evalDrop: 0,
      },
    ],
    whiteAccuracy: 95.5,
    blackAccuracy: 88.2,
    summary: {
      totalMoves: 1,
      whiteBlunders: 0,
      whiteMistakes: 0,
      whiteInaccuracies: 0,
      blackBlunders: 0,
      blackMistakes: 0,
      blackInaccuracies: 0,
      opening: 'King\'s Pawn Opening',
      skippedMoves: 0,
    },
  };

  it('includes the opening name', () => {
    expect(formatGameAnalysis(analysis)).toContain("King's Pawn Opening");
  });

  it('includes white accuracy', () => {
    expect(formatGameAnalysis(analysis)).toContain('95.5%');
  });

  it('includes black accuracy', () => {
    expect(formatGameAnalysis(analysis)).toContain('88.2%');
  });

  it('includes the move-by-move section', () => {
    expect(formatGameAnalysis(analysis)).toContain('Move-by-Move');
  });

  it('includes move classification icon for best move', () => {
    const output = formatGameAnalysis(analysis);
    expect(output).toContain('★');
  });

  it('includes the error count table', () => {
    const output = formatGameAnalysis(analysis);
    expect(output).toContain('Blunders');
    expect(output).toContain('White');
    expect(output).toContain('Black');
  });
});
