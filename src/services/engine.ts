// UCI chess engine process wrappers (Stockfish and Lc0)
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import {
  DEFAULT_DEPTH,
  DEFAULT_MULTI_PV,
  DEFAULT_THREADS,
  DEFAULT_HASH_MB,
  DEFAULT_ENGINE_TIMEOUT_MS,
  LC0_DEPTH_TO_NODES,
} from '../constants.js';
import type { UciEngine, UciLine, UciScore, PositionAnalysis } from '../types.js';

// ── Shared UCI helpers ────────────────────────────────────────────────────

/**
 * Defense-in-depth guard for every outbound UCI command. Callers are expected
 * to validate their inputs (e.g. `validateFen` rejects whitespace before a FEN
 * ever reaches the engine), but the engine must not trust them: a command
 * carrying a newline could smuggle a second UCI line. Throws — rather than
 * silently stripping — so a validation bypass surfaces loudly instead of
 * sending a half-sanitised command.
 */
export function assertSafeUciCommand(cmd: string): void {
  for (let i = 0; i < cmd.length; i++) {
    // Reject C0 control characters (incl. newline/CR/tab) and DEL — the
    // vehicles for UCI line injection. Space (0x20) and printable ASCII pass.
    const code = cmd.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      throw new Error(`Refusing to send UCI command with control characters: ${JSON.stringify(cmd)}`);
    }
  }
}

/** Parse UCI info lines into structured data. */
function parseInfoLines(output: string[], multiPv: number): UciLine[] {
  const pvMap = new Map<number, UciLine>();

  for (const line of output) {
    if (!line.startsWith('info') || !line.includes(' pv ')) continue;

    const parsed = parseInfoLine(line);
    if (parsed) {
      // Keep the deepest info for each multipv index.
      const existing = pvMap.get(parsed.multipv);
      if (!existing || parsed.depth > existing.depth) {
        pvMap.set(parsed.multipv, parsed);
      }
    }
  }

  return Array.from(pvMap.values())
    .sort((a, b) => a.multipv - b.multipv)
    .slice(0, multiPv);
}

/** Parse a single UCI info line (supports both Stockfish and Lc0 output). */
function parseInfoLine(line: string): UciLine | null {
  const tokens = line.split(/\s+/);

  const get = (key: string): string | undefined => {
    const idx = tokens.indexOf(key);
    return idx >= 0 && idx + 1 < tokens.length ? tokens[idx + 1] : undefined;
  };

  const getNumber = (key: string): number => {
    const val = get(key);
    return val !== undefined ? parseInt(val, 10) : 0;
  };

  const depth = getNumber('depth');
  const multipv = getNumber('multipv') || 1;
  const nodes = getNumber('nodes');
  const nps = getNumber('nps');
  const time = getNumber('time');

  // Parse score
  const scoreIdx = tokens.indexOf('score');
  if (scoreIdx < 0) return null;
  const scoreTypeStr = tokens[scoreIdx + 1];
  if (scoreTypeStr !== 'cp' && scoreTypeStr !== 'mate') return null;
  const scoreType = scoreTypeStr;
  const scoreValue = parseInt(tokens[scoreIdx + 2], 10);
  if (isNaN(scoreValue)) return null;
  const score: UciScore = { type: scoreType, value: scoreValue };

  // Parse WDL if present (Lc0 emits "wdl W D L" after score)
  let wdl: { win: number; draw: number; loss: number } | undefined;
  const wdlIdx = tokens.indexOf('wdl');
  if (wdlIdx >= 0 && wdlIdx + 3 < tokens.length) {
    const win = parseInt(tokens[wdlIdx + 1], 10);
    const draw = parseInt(tokens[wdlIdx + 2], 10);
    const loss = parseInt(tokens[wdlIdx + 3], 10);
    if (!isNaN(win) && !isNaN(draw) && !isNaN(loss)) {
      wdl = { win, draw, loss };
    }
  }

  // Parse PV (principal variation) – everything after "pv"
  const pvIdx = tokens.indexOf('pv');
  if (pvIdx < 0) return null;
  const pv = tokens.slice(pvIdx + 1);

  return { depth, score, pv, pvSan: [], nodes, nps, time, multipv, wdl };
}

// ── Base UCI Engine ───────────────────────────────────────────────────────

/**
 * Shared base class for UCI-compatible engines.
 * Handles process spawning, UCI communication, info parsing.
 * Subclasses provide engine-specific init options and search commands.
 */
abstract class BaseUciEngine implements UciEngine {
  protected process: ChildProcessWithoutNullStreams | null = null;
  protected binaryPath: string;
  protected ready = false;
  protected timeoutMs: number;
  abstract readonly displayName: string;

  /**
   * Called when the process crashes or exits while a sendAndWait call is
   * in flight — rejects the pending promise so it doesn't hang forever.
   */
  private pendingReject: ((err: Error) => void) | null = null;

  /**
   * Mutex: serialises whole operations (init/analyse) so concurrent callers on
   * the same engine can never interleave their UCI commands on stdin/stdout.
   */
  private opQueue: Promise<unknown> = Promise.resolve();

  constructor(binaryPath: string, timeoutMs: number = DEFAULT_ENGINE_TIMEOUT_MS) {
    this.binaryPath = binaryPath;
    this.timeoutMs = timeoutMs;
  }

  /** Run `fn` as an exclusive critical section on this engine. */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.opQueue.then(() => fn());
    // Advance the queue even when this op rejects, so the next one still runs.
    this.opQueue = result.then(() => {}, () => {});
    return result;
  }

  /** Send engine-specific UCI options after the uci/uciok handshake. */
  protected abstract configureOptions(): Promise<void>;

  /** Build the UCI "go" command for analysis. */
  protected abstract buildGoCommand(depth: number): string;

  async init(): Promise<void> {
    await this.runExclusive(() => this.ensureReadyInternal());
  }

  /** Spawn + handshake if not already ready. Assumes the mutex is held. */
  private async ensureReadyInternal(): Promise<void> {
    if (this.process && this.ready) return;
    await this.spawnAndHandshake();
  }

  private async spawnAndHandshake(): Promise<void> {
    this.process = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.on('error', (err) => {
      console.error(`[${this.displayName}] Process error: ${err.message}`);
      const reject = this.pendingReject;
      this.pendingReject = null;
      this.process = null;
      this.ready = false;
      reject?.(new Error(`Engine process error: ${err.message}`));
    });

    this.process.on('exit', (code) => {
      console.error(`[${this.displayName}] Process exited with code ${code}`);
      const reject = this.pendingReject;
      this.pendingReject = null;
      this.process = null;
      this.ready = false;
      reject?.(new Error(`Engine process exited with code ${code}`));
    });

    // The std streams emit their own 'error' events (e.g. EPIPE when the engine
    // is killed while a write is buffered). With no listener those would crash
    // the whole MCP server, so log and swallow — the operation still fails via
    // the write callback or the 'exit' handler above.
    const onStreamError = (stream: string) => (err: Error): void => {
      console.error(`[${this.displayName}] ${stream} error: ${err.message}`);
    };
    this.process.stdin.on('error', onStreamError('stdin'));
    this.process.stdout.on('error', onStreamError('stdout'));
    this.process.stderr.on('error', onStreamError('stderr'));

    await this.sendAndWait('uci', 'uciok');
    await this.configureOptions();
    await this.sendAndWait('isready', 'readyok');
    this.ready = true;
    console.error(`[${this.displayName}] Engine initialized`);
  }

  /** Write a command to the engine's stdin. */
  protected send(cmd: string): Promise<void> {
    const proc = this.process;
    if (!proc) return Promise.reject(new Error(`${this.displayName} not running`));
    try {
      assertSafeUciCommand(cmd);
    } catch (err) {
      return Promise.reject(err as Error);
    }
    return new Promise((resolve, reject) => {
      // The write callback fires once the chunk is flushed (which also orders
      // correctly under backpressure). UCI commands are tiny, so the pipe buffer
      // is never a concern; if the pipe breaks (engine killed) the callback
      // rejects with EPIPE instead of hanging.
      proc.stdin.write(`${cmd}\n`, (err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Send a command and collect all output until a line starting with `until`.
   * Must be called from inside a runExclusive() section, so only one stdout
   * listener is ever attached at a time. Defaults to `this.timeoutMs`.
   */
  protected sendAndWait(cmd: string, until: string, timeoutMs?: number, signal?: AbortSignal): Promise<string[]> {
    const ms = timeoutMs ?? this.timeoutMs;
    return new Promise((resolve, reject) => {
      if (!this.process) return reject(new Error(`${this.displayName} not running`));
      try {
        assertSafeUciCommand(cmd);
      } catch (err) {
        return reject(err as Error);
      }

      const lines: string[] = [];
      let buffer = '';
      const timeout = setTimeout(() => {
        // Halt a still-running search so it cannot desync the next operation.
        try {
          this.process?.stdin.write('stop\n');
        } catch {
          /* stream errors surface via the stdin 'error' handler */
        }
        cleanup();
        reject(new Error(`Timeout waiting for "${until}" after ${ms}ms`));
      }, ms);

      // On cancellation, ask the engine to stop searching so it emits its pending
      // reply (e.g. "bestmove") promptly; the caller then rejects after draining.
      const onAbort = (): void => {
        // Ask the engine to stop searching so a live search emits its bestmove.
        try {
          this.process?.stdin.write('stop\n');
        } catch {
          /* stream errors surface via the stdin 'error' handler */
        }
        // Non-search waits (handshake/isready) have nothing to drain, so reject
        // promptly. The search wait instead lets the incoming "bestmove" resolve
        // it (drain), keeping the process in sync; the caller rejects afterwards.
        if (until !== 'bestmove') {
          cleanup();
          reject(new Error('Analysis cancelled'));
        }
      };

      const onData = (chunk: Buffer): void => {
        buffer += chunk.toString();
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (trimmed) lines.push(trimmed);
          if (trimmed.startsWith(until)) {
            cleanup();
            resolve(lines);
            return;
          }
        }
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.process?.stdout.removeListener('data', onData);
        signal?.removeEventListener('abort', onAbort);
        this.pendingReject = null;
      };

      this.pendingReject = (err: Error): void => {
        cleanup();
        reject(err);
      };

      this.process.stdout.on('data', onData);
      this.process.stdin.write(`${cmd}\n`, (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });

      // Register the abort listener AFTER the command is queued so "stop" can
      // never precede it.
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async analyse(
    fen: string,
    depth = DEFAULT_DEPTH,
    multiPv = DEFAULT_MULTI_PV,
    signal?: AbortSignal
  ): Promise<PositionAnalysis> {
    return this.runExclusive(() => this.analyseInternal(fen, depth, multiPv, signal));
  }

  /** The full analysis transaction. Assumes the mutex is held. */
  private async analyseInternal(
    fen: string,
    depth: number,
    multiPv: number,
    signal?: AbortSignal
  ): Promise<PositionAnalysis> {
    if (signal?.aborted) throw new Error('Analysis cancelled');
    await this.ensureReadyInternal();

    await this.send('ucinewgame');
    await this.sendAndWait('isready', 'readyok', undefined, signal);
    await this.send(`setoption name MultiPV value ${multiPv}`);
    await this.send(`position fen ${fen}`);

    // Pass the signal to the search wait: on abort it sends UCI "stop" so the
    // engine returns "bestmove" promptly, keeping the process in sync.
    const output = await this.sendAndWait(this.buildGoCommand(depth), 'bestmove', undefined, signal);
    if (signal?.aborted) throw new Error('Analysis cancelled');

    const lines = parseInfoLines(output, multiPv);
    const bestMoveLine = output.find((l) => l.startsWith('bestmove'));
    const bestMove = bestMoveLine?.split(/\s+/)[1] ?? '';

    if (lines.length === 0) {
      console.error(`[${this.displayName}] No analysis lines returned for FEN: ${fen}`);
    }

    const topLine = lines[0];
    const evaluation: UciScore = topLine ? topLine.score : { type: 'cp', value: 0 };

    return { fen, bestMove, evaluation, lines, depth };
  }

  async bestMove(fen: string, depth = DEFAULT_DEPTH): Promise<string> {
    const result = await this.analyse(fen, depth, 1);
    return result.bestMove;
  }

  async quit(): Promise<void> {
    const proc = this.process;
    if (!proc) return;
    // Reject any in-flight sendAndWait first so it doesn't hang until timeout.
    const reject = this.pendingReject;
    this.pendingReject = null;
    reject?.(new Error(`${this.displayName} engine shutting down`));
    // Drop our handlers so the async exit event can't fire pendingReject and
    // corrupt a subsequent init().
    proc.removeAllListeners('error');
    proc.removeAllListeners('exit');
    this.process = null;
    this.ready = false;
    try {
      proc.stdin.write('quit\n');
    } catch {
      /* process may already be gone */
    }
    proc.kill();
  }
}

// ── Stockfish Engine ──────────────────────────────────────────────────────

export class StockfishEngine extends BaseUciEngine {
  readonly displayName = 'stockfish';
  private threads: number;
  private hashMb: number;

  constructor(
    binaryPath = 'stockfish',
    threads = DEFAULT_THREADS,
    hashMb = DEFAULT_HASH_MB,
    timeoutMs = DEFAULT_ENGINE_TIMEOUT_MS
  ) {
    super(binaryPath, timeoutMs);
    this.threads = threads;
    this.hashMb = hashMb;
  }

  protected async configureOptions(): Promise<void> {
    await this.send(`setoption name Threads value ${this.threads}`);
    await this.send(`setoption name Hash value ${this.hashMb}`);
  }

  protected buildGoCommand(depth: number): string {
    return `go depth ${depth}`;
  }
}

// ── Lc0 Engine ────────────────────────────────────────────────────────────

export class Lc0Engine extends BaseUciEngine {
  readonly displayName = 'lc0';
  private weightsPath: string;
  private backend?: string;
  private threads: number;
  private hashMb: number;

  constructor(
    binaryPath = 'lc0',
    weightsPath: string,
    backend?: string,
    threads = DEFAULT_THREADS,
    hashMb = DEFAULT_HASH_MB,
    timeoutMs = DEFAULT_ENGINE_TIMEOUT_MS
  ) {
    super(binaryPath, timeoutMs);
    this.weightsPath = weightsPath;
    this.backend = backend;
    this.threads = threads;
    this.hashMb = hashMb;
  }

  protected async configureOptions(): Promise<void> {
    await this.send(`setoption name WeightsFile value ${this.weightsPath}`);
    if (this.backend) {
      await this.send(`setoption name Backend value ${this.backend}`);
    }
    await this.send(`setoption name Threads value ${this.threads}`);
    await this.send(`setoption name Hash value ${this.hashMb}`);
  }

  protected buildGoCommand(depth: number): string {
    // Lc0's MCTS "depth" is fundamentally different from alpha-beta depth.
    // Map the requested depth to a sensible node count for consistent results.
    const clampedDepth = Math.min(depth, LC0_DEPTH_TO_NODES.length - 1);
    const nodes = LC0_DEPTH_TO_NODES[clampedDepth] ?? LC0_DEPTH_TO_NODES[LC0_DEPTH_TO_NODES.length - 1];
    return `go nodes ${nodes}`;
  }
}
