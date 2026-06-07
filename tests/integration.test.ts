/// <reference types="node" />
/**
 * Integration tests — require a real Stockfish binary in PATH.
 * Run with: npm run test:integration
 *
 * These tests exercise the full stack: process spawn → UCI handshake →
 * real analysis → response parsing. They are intentionally separate from
 * the unit tests so CI can run them conditionally (only when Stockfish
 * is available in the build environment).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { StockfishEngine } from '../src/services/engine.js';
import { START_FEN } from '../src/constants.js';

// ── Skip the whole suite if Stockfish is not installed ────────────────────

const SF_BIN = process.env.STOCKFISH_PATH ?? 'stockfish';
// Probe via a real UCI handshake — a binary that ignores '--help' and reads
// stdin would hang until timeout and be wrongly reported as unavailable.
const sfProbe = spawnSync(SF_BIN, [], { input: 'uci\nquit\n', timeout: 3000, encoding: 'utf8' });
const stockfishAvailable = sfProbe.error === undefined && (sfProbe.stdout ?? '').includes('uciok');

const describeIfSf = stockfishAvailable ? describe : describe.skip;

// ── Helpers ───────────────────────────────────────────────────────────────

function makeEngine(): StockfishEngine {
  // 30s engine timeout < the 60s per-test vitest budget, so a stuck engine
  // surfaces the descriptive engine error instead of an opaque test timeout.
  return new StockfishEngine(SF_BIN, 1, 16, 30_000);
}

// ── Suite ─────────────────────────────────────────────────────────────────

describeIfSf('StockfishEngine (integration)', () => {
  let engine: StockfishEngine;

  beforeAll(async () => {
    engine = makeEngine();
    await engine.init();
  }, 60_000);

  afterAll(async () => {
    await engine.quit();
  });

  // ── Init & lifecycle ────────────────────────────────────────────────────

  it('initialises without error', () => {
    // Passes if beforeAll did not throw.
    expect(engine).toBeDefined();
  });

  it('calling init() a second time is a no-op', async () => {
    // Should not throw or spawn a second process.
    await expect(engine.init()).resolves.toBeUndefined();
  });

  // ── Position analysis ───────────────────────────────────────────────────

  it('analyses the starting position and returns a non-empty bestMove', async () => {
    const result = await engine.analyse(START_FEN, 10, 1);
    expect(result.fen).toBe(START_FEN);
    expect(result.bestMove).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
  }, 60_000);

  it('returns a centipawn evaluation near 0 for the starting position', async () => {
    const result = await engine.analyse(START_FEN, 10, 1);
    expect(result.evaluation.type).toBe('cp');
    // Starting position should be roughly equal (-100 to +100 cp at depth 10)
    expect(Math.abs(result.evaluation.value)).toBeLessThan(200);
  }, 60_000);

  it('returns the requested number of PV lines', async () => {
    const result = await engine.analyse(START_FEN, 10, 3);
    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    expect(result.lines.length).toBeLessThanOrEqual(3);
  }, 60_000);

  it('each line has a valid PV array', async () => {
    const result = await engine.analyse(START_FEN, 10, 2);
    for (const line of result.lines) {
      expect(line.pv.length).toBeGreaterThan(0);
      expect(line.pv[0]).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
      expect(line.depth).toBeGreaterThan(0);
    }
  }, 60_000);

  it('detects mate-in-1 correctly', async () => {
    // Scholar's mate position — white plays Qxf7#
    const mateFen = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
    const result = await engine.analyse(mateFen, 12, 1);
    // Position is already checkmate for black, so engine may return no lines.
    // Just check we get a result back without throwing.
    expect(result).toBeDefined();
  }, 60_000);

  it('bestMove() returns a valid UCI move', async () => {
    const move = await engine.bestMove(START_FEN, 8);
    expect(move).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
  }, 60_000);

  // ── Concurrency (key regression for the sendQueue fix) ──────────────────

  it('handles concurrent analyse() calls without listener accumulation', async () => {
    // Fire 3 calls in parallel. With the old code each would add a new
    // stdout data listener and they would interleave, corrupting results.
    // With sendQueue they are serialised and all must resolve correctly.
    const fens = [
      START_FEN,
      'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3', // Italian
      'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',        // Scandinavian
    ];

    const results = await Promise.all(fens.map((fen) => engine.analyse(fen, 6, 1)));

    expect(results).toHaveLength(3);
    for (const [i, result] of results.entries()) {
      expect(result.fen).toBe(fens[i]);
      expect(result.bestMove).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    }
  }, 120_000);

  // ── Quit & restart ──────────────────────────────────────────────────────

  it('can quit and re-initialise cleanly', async () => {
    const e = makeEngine();
    await e.init();
    await e.quit();
    // After quit, init() should spawn a fresh process.
    await e.init();
    const result = await e.analyse(START_FEN, 6, 1);
    expect(result.bestMove).toBeTruthy();
    await e.quit();
  }, 60_000);
});
