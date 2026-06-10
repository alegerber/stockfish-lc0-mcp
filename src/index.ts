#!/usr/bin/env node
// Main entry point – Chess Engine MCP Server (Stockfish + Lc0)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StockfishEngine, Lc0Engine, missingBinaryHint } from './services/engine.js';
import {
  AnalysePositionSchema,
  AnalyseGameSchema,
  Lc0AnalysePositionSchema,
  Lc0AnalyseGameSchema,
  LookupOpeningSchema,
  IdentifyOpeningSchema,
  GeneratePuzzleSchema,
  AnalysePositionOutput,
  AnalyseGameOutput,
  LookupOpeningOutput,
  IdentifyOpeningOutput,
  GeneratePuzzleOutput,
} from './schemas/index.js';
import { analysePosition } from './tools/analyse-position.js';
import { analyseGame } from './tools/analyse-game.js';
import { lookupOpeningByQuery, identifyOpeningFromPgn } from './tools/openings.js';
import { generatePuzzle } from './tools/puzzle.js';
import { truncateOutput } from './services/formatting.js';
import { DEFAULT_ENGINE_TIMEOUT_MS } from './constants.js';
import { readFileSync } from 'node:fs';

// Single source of truth for the version — read from package.json at runtime,
// with a safe fallback so a stripped deployment can't crash startup.
let serverVersion = '0.0.0';
try {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { version?: string };
  if (pkg.version) serverVersion = pkg.version;
} catch (err) {
  console.error(`[stockfish-lc0-mcp] Could not read version from package.json: ${err instanceof Error ? err.message : err}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Parse a positive integer env var, warning and falling back to default on invalid input. */
function parsePositiveInt(raw: string | undefined, name: string, defaultValue: number): number {
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.error(`[stockfish-lc0-mcp] Invalid ${name}: "${raw}", using default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Wraps a tool handler function with uniform error handling.
 * On success returns structured content; on failure returns isError with the message.
 */
function wrapTool<T>(
  fn: (args: T, signal?: AbortSignal) => Promise<{ text: string; json: Record<string, unknown> }>
) {
  return async (args: T, extra?: { signal?: AbortSignal }) => {
    try {
      const result = await fn(args, extra?.signal);
      // truncateOutput caps the human-readable text channel; structuredContent
      // is structured data and is passed through as-is.
      return {
        content: [{ type: 'text' as const, text: truncateOutput(result.text) }],
        structuredContent: result.json,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Conventional MCP error: isError + text (no structuredContent — it would
      // diverge from the success shape and there is no outputSchema to validate).
      return {
        isError: true as const,
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
      };
    }
  };
}

// ── Stockfish configuration ──────────────────────────────────────────────
const SF_PATH = process.env.STOCKFISH_PATH ?? 'stockfish';
const SF_THREADS = parsePositiveInt(process.env.STOCKFISH_THREADS, 'STOCKFISH_THREADS', 2);
const SF_HASH = parsePositiveInt(process.env.STOCKFISH_HASH, 'STOCKFISH_HASH', 128);
const ENGINE_TIMEOUT_MS = parsePositiveInt(process.env.ENGINE_TIMEOUT_MS, 'ENGINE_TIMEOUT_MS', DEFAULT_ENGINE_TIMEOUT_MS);

const sfEngine = new StockfishEngine(SF_PATH, SF_THREADS, SF_HASH, ENGINE_TIMEOUT_MS);

// ── Lc0 configuration (optional — only enabled when LC0_WEIGHTS_PATH is set) ─
const LC0_PATH = process.env.LC0_PATH ?? 'lc0';
const LC0_WEIGHTS = process.env.LC0_WEIGHTS_PATH ?? '';
const LC0_BACKEND = process.env.LC0_BACKEND; // undefined = Lc0 auto-detects
const LC0_THREADS = parsePositiveInt(process.env.LC0_THREADS, 'LC0_THREADS', 2);
const LC0_HASH = parsePositiveInt(process.env.LC0_HASH, 'LC0_HASH', 128);
const lc0Enabled = LC0_WEIGHTS.length > 0;
let lc0Engine: Lc0Engine | null = null;

if (lc0Enabled) {
  lc0Engine = new Lc0Engine(LC0_PATH, LC0_WEIGHTS, LC0_BACKEND, LC0_THREADS, LC0_HASH, ENGINE_TIMEOUT_MS);
}

const server = new McpServer({
  name: 'stockfish-lc0-mcp',
  version: serverVersion,
});

// ── Tool 1: Analyse Position ──────────────────────────────────────────────

server.registerTool(
  'sf_analyse_position',
  {
    title: 'Analyse Chess Position',
    description: `Analyse a chess position using Stockfish engine.

Takes a FEN string and returns the evaluation, best move, and top
principal variations with scores. Use this for single-position analysis.

Args:
  - fen (string): FEN of the position
  - depth (number): Search depth 1–30 (default 20)
  - multiPv (number): Number of lines 1–5 (default 3)

Returns:
  Evaluation (cp or mate), best move in UCI+SAN, top lines with scores.

Examples:
  - "Analyse this position: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
  - "What is the best move for black in FEN ...?"`,
    inputSchema: AnalysePositionSchema,
    outputSchema: AnalysePositionOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(({ fen, depth, multiPv }, signal) => analysePosition(sfEngine, fen, depth, multiPv, signal))
);

// ── Tool 2: Analyse Game ──────────────────────────────────────────────────

server.registerTool(
  'sf_analyse_game',
  {
    title: 'Analyse Full Chess Game',
    description: `Analyse an entire chess game move by move using Stockfish.

Takes a PGN and returns per-move evaluations, accuracy scores, error
counts (blunders/mistakes/inaccuracies), and the detected opening.

This is computationally expensive – depth 22 is the default for reliable
accuracy; use depth 16 for faster but less precise overviews.

Args:
  - pgn (string): Complete PGN of the game
  - depth (number): Search depth per move 1–30 (default 22)

Returns:
  Opening name, accuracy %, error summary table, move-by-move analysis
  with classification (book/best/excellent/good/inaccuracy/mistake/blunder).

Examples:
  - "Analyse this game: 1. e4 e5 2. Nf3 Nc6 ..."
  - "Review my chess.com game [PGN]"`,
    inputSchema: AnalyseGameSchema,
    outputSchema: AnalyseGameOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(({ pgn, depth }, signal) => analyseGame(sfEngine, pgn, depth, signal))
);

// ── Tool 3: Lookup Opening ────────────────────────────────────────────────

server.registerTool(
  'sf_lookup_opening',
  {
    title: 'Lookup Chess Opening',
    description: `Search the opening database by name or ECO code.

Returns matching openings with ECO code, name, book moves, and FEN.

Args:
  - query (string): Name fragment or ECO code (e.g. "Sicilian", "B20", "Italian")

Returns:
  List of matching openings with ECO, name, PGN, and FEN.

Examples:
  - "Look up the Italian Game"
  - "What openings start with B2?"`,
    inputSchema: LookupOpeningSchema,
    outputSchema: LookupOpeningOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(({ query }) => Promise.resolve(lookupOpeningByQuery(query)))
);

// ── Tool 4: Identify Opening ──────────────────────────────────────────────

server.registerTool(
  'sf_identify_opening',
  {
    title: 'Identify Chess Opening',
    description: `Identify the opening from a sequence of moves or a PGN.

Matches the move sequence against the opening book and returns the
most specific matching opening.

Args:
  - pgn (string): PGN or bare SAN moves (e.g. "1. e4 e5 2. Nf3 Nc6")

Returns:
  ECO code, opening name, and book line if identified.

Examples:
  - "What opening is 1. e4 e5 2. Qh5?"
  - "Identify the opening from this PGN: ..."`,
    inputSchema: IdentifyOpeningSchema,
    outputSchema: IdentifyOpeningOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(({ pgn }) => Promise.resolve(identifyOpeningFromPgn(pgn)))
);

// ── Tool 5: Generate Puzzle ───────────────────────────────────────────────

server.registerTool(
  'sf_generate_puzzle',
  {
    title: 'Generate Tactic Puzzle',
    description: `Generate a tactic puzzle from a given position.

Analyses the position to find the best tactical sequence and presents
it as a puzzle with theme detection, difficulty rating, and solution.

Args:
  - fen (string): FEN of the position
  - depth (number): Analysis depth 1–30 (default 22)

Returns:
  Puzzle FEN, theme (e.g. "Mate in 3", "Fork", "Pin"), difficulty,
  solution in UCI and SAN, and an explanation. If the position has no clear
  tactic, returns hasTactic:false with the best move instead of a puzzle.

Examples:
  - "Make a puzzle from this position: [FEN]"
  - "Find tactics in this position: ..."`,
    inputSchema: GeneratePuzzleSchema,
    outputSchema: GeneratePuzzleOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  wrapTool(({ fen, depth }, signal) => generatePuzzle(sfEngine, fen, depth, signal))
);

// ── Lc0 Tools (only registered when LC0_WEIGHTS_PATH is set) ──────────────

/** Guard: return the Lc0 engine or throw a user-friendly error. */
function requireLc0(): Lc0Engine {
  if (!lc0Engine) {
    throw new Error('Lc0 is not configured. Set the LC0_WEIGHTS_PATH environment variable to enable Lc0 tools.');
  }
  return lc0Engine;
}

if (lc0Enabled) {
  // ── Lc0 Tool 1: Analyse Position ─────────────────────────────────────
  server.registerTool(
    'lc0_analyse_position',
    {
      title: 'Analyse Chess Position (Lc0)',
      description: `Analyse a chess position using the Leela Chess Zero (Lc0) neural network engine.

Lc0 uses a neural network for evaluation, providing a different perspective
from traditional alpha-beta engines like Stockfish. Particularly strong at
positional and strategic evaluation.

Note: The "depth" parameter is mapped to Lc0 node counts internally since
MCTS depth is not comparable to alpha-beta depth. Lc0 runs on the CPU backend
here, so it is slower than Stockfish — keep the depth low (default 12) for
responsive analysis; high values may time out.

Note: each returned line's "depth" is Lc0's internal MCTS search-tree depth,
which is unrelated to the requested "depth" parameter above (that sets the node
budget). Seeing e.g. depth 6 for a requested depth 12 is expected, not an error.

Args:
  - fen (string): FEN of the position
  - depth (number): Search strength 1–30 (mapped to node count; default 12 for Lc0)
  - multiPv (number): Number of lines 1–5 (default 3)

Returns:
  Evaluation (cp or mate), best move in UCI+SAN, top lines with scores.

Examples:
  - "Analyse this position with Lc0: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
  - "What does the neural network think of this position?"`,
      inputSchema: Lc0AnalysePositionSchema,
      outputSchema: AnalysePositionOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    wrapTool(({ fen, depth, multiPv }, signal) => analysePosition(requireLc0(), fen, depth, multiPv, signal))
  );

  // ── Lc0 Tool 2: Analyse Game ─────────────────────────────────────────
  server.registerTool(
    'lc0_analyse_game',
    {
      title: 'Analyse Full Chess Game (Lc0)',
      description: `Analyse an entire chess game move by move using Leela Chess Zero.

Provides a neural-network-based evaluation of every move, which can
highlight different aspects than a traditional engine. Especially useful
for comparing with Stockfish analysis to get a fuller picture.

Note: The "depth" parameter is mapped to Lc0 node counts internally.
Higher depth values use more nodes and take longer.

Args:
  - pgn (string): Complete PGN of the game
  - depth (number): Search strength per move 1–30 (mapped to nodes; default 10 — Lc0 on CPU is slow, raise for higher fidelity)

Returns:
  Opening name, accuracy %, error summary table, move-by-move analysis
  with classification (book/best/excellent/good/inaccuracy/mistake/blunder).

Examples:
  - "Analyse this game with Lc0: 1. e4 e5 2. Nf3 Nc6 ..."
  - "Get the neural network's take on my game [PGN]"`,
      inputSchema: Lc0AnalyseGameSchema,
      outputSchema: AnalyseGameOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    wrapTool(({ pgn, depth }, signal) => analyseGame(requireLc0(), pgn, depth, signal))
  );

  // ── Lc0 Tool 3: Generate Puzzle ──────────────────────────────────────
  server.registerTool(
    'lc0_generate_puzzle',
    {
      title: 'Generate Tactic Puzzle (Lc0)',
      description: `Generate a tactic puzzle using Leela Chess Zero's neural network.

Uses Lc0's evaluation to find tactical sequences, which may differ from
Stockfish in complex positions where intuition matters.

Args:
  - fen (string): FEN of the position
  - depth (number): Search strength 1–30 (mapped to nodes; default 22)

Returns:
  Puzzle FEN, theme, difficulty, solution in UCI and SAN, and explanation.
  If there is no clear tactic, returns hasTactic:false with the best move.

Examples:
  - "Make a puzzle with Lc0 from this position: [FEN]"
  - "Find tactics using the neural network: ..."`,
      inputSchema: GeneratePuzzleSchema,
      outputSchema: GeneratePuzzleOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    wrapTool(({ fen, depth }, signal) => generatePuzzle(requireLc0(), fen, depth, signal))
  );

  console.error('[stockfish-lc0-mcp] Lc0 tools registered: lc0_analyse_position, lc0_analyse_game, lc0_generate_puzzle');
}

// ── Start ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.error('[stockfish-lc0-mcp] Initialising Stockfish engine...');
  await sfEngine.init();
  console.error('[stockfish-lc0-mcp] Stockfish ready.');

  if (lc0Engine) {
    console.error('[stockfish-lc0-mcp] Initialising Lc0 engine...');
    await lc0Engine.init();
    console.error('[stockfish-lc0-mcp] Lc0 ready.');
  } else {
    console.error('[stockfish-lc0-mcp] Lc0 disabled (set LC0_WEIGHTS_PATH to enable).');
  }

  console.error('[stockfish-lc0-mcp] Starting stdio transport...');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[stockfish-lc0-mcp] MCP server running on stdio');

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.error('[stockfish-lc0-mcp] Shutting down...');
    await sfEngine.quit();
    if (lc0Engine) await lc0Engine.quit();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[stockfish-lc0-mcp] Fatal:', err);
  const hint = missingBinaryHint(err, { stockfish: SF_PATH, lc0: LC0_PATH });
  if (hint) console.error(`[stockfish-lc0-mcp] ${hint}`);
  process.exit(1);
});
