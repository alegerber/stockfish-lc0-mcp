import { describe, it, expect } from 'vitest';
import { StockfishEngine, assertSafeUciCommand, missingBinaryHint } from '../src/services/engine.js';

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

describe('assertSafeUciCommand (UCI-injection defense)', () => {
  // Control characters built by code point — no literal control bytes in source.
  const LF = String.fromCharCode(10); // newline
  const CR = String.fromCharCode(13); // carriage return
  const TAB = String.fromCharCode(9);

  it('accepts ordinary UCI commands', () => {
    expect(() => assertSafeUciCommand(`position fen ${START_FEN}`)).not.toThrow();
    expect(() => assertSafeUciCommand('setoption name Hash value 128')).not.toThrow();
    expect(() => assertSafeUciCommand('go depth 12')).not.toThrow();
  });

  it('rejects a newline-smuggled second UCI line', () => {
    expect(() => assertSafeUciCommand(`position fen ${START_FEN}${LF}quit`)).toThrow(/control characters/);
  });

  it('rejects carriage returns and tabs', () => {
    expect(() => assertSafeUciCommand(`go depth 8${CR}stop`)).toThrow(/control characters/);
    expect(() => assertSafeUciCommand(`setoption name Backend value${TAB}x`)).toThrow(/control characters/);
  });
});

describe('missingBinaryHint', () => {
  const paths = { stockfish: '/opt/homebrew/bin/stockfish', lc0: 'lc0' };

  // Shape of the error Node's child_process emits when spawn() can't find the binary.
  const spawnEnoent = (path: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`spawn ${path} ENOENT`), { code: 'ENOENT', syscall: `spawn ${path}`, path });

  it('explains how to install Stockfish when its binary is missing', () => {
    const hint = missingBinaryHint(spawnEnoent(paths.stockfish), paths);
    expect(hint).toContain('/opt/homebrew/bin/stockfish');
    expect(hint).toContain('brew install stockfish');
    expect(hint).toContain('STOCKFISH_PATH');
  });

  it('points at LC0_PATH and LC0_WEIGHTS_PATH when the Lc0 binary is missing', () => {
    const hint = missingBinaryHint(spawnEnoent('lc0'), paths);
    expect(hint).toContain('LC0_PATH');
    expect(hint).toContain('LC0_WEIGHTS_PATH');
  });

  it('still names the missing binary when the path matches neither engine', () => {
    const hint = missingBinaryHint(spawnEnoent('/custom/engine'), paths);
    expect(hint).toContain('/custom/engine');
  });

  it('returns null for non-ENOENT errors and non-errors', () => {
    expect(missingBinaryHint(new Error('Timeout waiting for uciok'), paths)).toBeNull();
    expect(missingBinaryHint(undefined, paths)).toBeNull();
    expect(missingBinaryHint('ENOENT', paths)).toBeNull();
  });

  it('finds the spawn failure behind a wrapped error (cause chain)', () => {
    const wrapped = Object.assign(new Error('Engine process error: spawn lc0 ENOENT'), {
      cause: spawnEnoent('lc0'),
    });
    expect(missingBinaryHint(wrapped, paths)).toContain('LC0_PATH');
  });

  it('yields a hint for the error init() actually rejects with for a missing binary', async () => {
    const engine = new StockfishEngine('/nonexistent/stockfish-binary', 1, 16, 2_000);
    const err = await engine.init().then(
      () => null,
      (e: unknown) => e
    );
    await engine.quit().catch(() => {});
    expect(err).toBeTruthy();
    const hint = missingBinaryHint(err, { stockfish: '/nonexistent/stockfish-binary', lc0: 'lc0' });
    expect(hint).toContain('/nonexistent/stockfish-binary');
  }, 5_000);
});
