import { describe, it, expect } from 'vitest';
import { StockfishEngine } from '../src/services/engine.js';

// These tests use `cat` as a stand-in "engine": it echoes stdin but never emits
// the UCI handshake reply ("uciok"), so they exercise the timeout and shutdown
// paths deterministically WITHOUT needing a real Stockfish binary.

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('BaseUciEngine reliability', () => {
  it('honours a configurable timeout when the handshake never completes', async () => {
    // 4th constructor arg = timeoutMs. `cat` never replies "uciok" → init must time out.
    const engine = new StockfishEngine('cat', 1, 16, 250);
    await expect(engine.init()).rejects.toThrow(/Timeout/);
    await engine.quit().catch(() => {});
  }, 5_000);

  it('quit() rejects an in-flight operation instead of leaving it hanging', async () => {
    const engine = new StockfishEngine('cat', 1, 16, 10_000);
    const pending = engine.analyse(START_FEN, 8, 1);
    // let it spawn `cat` and start the (never-completing) handshake
    await new Promise((r) => setTimeout(r, 100));
    await engine.quit();
    await expect(pending).rejects.toThrow();
  }, 5_000);

  it('rejects without spawning when given an already-aborted signal', async () => {
    const engine = new StockfishEngine('cat', 1, 16, 5_000);
    await expect(engine.analyse(START_FEN, 8, 1, AbortSignal.abort())).rejects.toThrow(/cancel/i);
    await engine.quit().catch(() => {});
  }, 5_000);
});
