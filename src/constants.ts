// Shared constants for Chess Engine MCP server

export const DEFAULT_DEPTH = 20;
export const DEFAULT_MULTI_PV = 3;
export const DEFAULT_THREADS = 2;
export const DEFAULT_HASH_MB = 128;
export const MAX_DEPTH = 30;
export const MAX_MULTI_PV = 5;
export const CHARACTER_LIMIT = 50000;

// Max time to wait for a single UCI command to complete (handshake or a `go`
// search). A deep game analysis (depth 22) can be slow, so this is generous;
// override per deployment via the ENGINE_TIMEOUT_MS env var.
export const DEFAULT_ENGINE_TIMEOUT_MS = 120_000;

// Minimum centipawn gap between the best and second-best move for a position to
// count as a tactic puzzle (a forced mate always qualifies regardless).
export const MIN_TACTIC_ADVANTAGE = 150;

// Thresholds for move classification (in centipawns)
export const BLUNDER_THRESHOLD = 200;
export const MISTAKE_THRESHOLD = 100;
export const INACCURACY_THRESHOLD = 50;
export const GOOD_THRESHOLD = 20;
export const EXCELLENT_THRESHOLD = 10;

// Starting position FEN
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ── Lc0-specific constants ────────────────────────────────────────────────

/**
 * Map Stockfish-style depth (1–30) to Lc0 node counts.
 *
 * Lc0 uses MCTS (Monte Carlo Tree Search) where "depth" measures average
 * tree depth, not alpha-beta plies. A depth-20 Stockfish search is roughly
 * comparable to ~50k Lc0 nodes in terms of analysis quality, but the
 * mapping is approximate and position-dependent.
 *
 * Index = requested depth, value = Lc0 node count.
 * Ramps exponentially from 100 nodes (depth 1) to 1M nodes (depth 30).
 */
export const LC0_DEPTH_TO_NODES: readonly number[] = [
  /* 0 */     100,
  /* 1 */     100,
  /* 2 */     200,
  /* 3 */     400,
  /* 4 */     800,
  /* 5 */    1_500,
  /* 6 */    2_500,
  /* 7 */    4_000,
  /* 8 */    6_000,
  /* 9 */    8_000,
  /* 10 */  10_000,
  /* 11 */  15_000,
  /* 12 */  20_000,
  /* 13 */  25_000,
  /* 14 */  30_000,
  /* 15 */  40_000,
  /* 16 */  50_000,
  /* 17 */  65_000,
  /* 18 */  80_000,
  /* 19 */ 100_000,
  /* 20 */ 150_000,
  /* 21 */ 200_000,
  /* 22 */ 300_000,
  /* 23 */ 400_000,
  /* 24 */ 500_000,
  /* 25 */ 600_000,
  /* 26 */ 700_000,
  /* 27 */ 800_000,
  /* 28 */ 900_000,
  /* 29 */ 950_000,
  /* 30 */ 1_000_000,
];
