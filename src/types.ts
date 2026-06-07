// Types for Chess Engine MCP server

// ── UCI Engine Interface ──────────────────────────────────────────────────
// Implemented by both StockfishEngine and Lc0Engine.

export interface UciEngine {
  /** Spawn the engine process and configure UCI options. */
  init(): Promise<void>;
  /** Analyse a position given as FEN. An optional AbortSignal cancels the search. */
  analyse(fen: string, depth: number, multiPv: number, signal?: AbortSignal): Promise<PositionAnalysis>;
  /**
   * Get only the best move for a position (fast, single-PV). Part of the public
   * engine API; the MCP tools call analyse() directly, so this is exercised by
   * the integration tests and available to other consumers of the engine.
   */
  bestMove(fen: string, depth: number): Promise<string>;
  /** Shut down the engine process. */
  quit(): Promise<void>;
  /** Human-readable engine name for logging / display. */
  readonly displayName: string;
}

// ── UCI Output Types ──────────────────────────────────────────────────────

export interface UciLine {
  depth: number;
  score: UciScore;
  pv: string[];
  pvSan: string[];
  nodes: number;
  nps: number;
  time: number;
  multipv: number;
  /** Win/Draw/Loss from engine (Lc0 provides this natively; optional). */
  wdl?: { win: number; draw: number; loss: number };
}

export interface UciScore {
  type: 'cp' | 'mate';
  value: number;
}

export interface PositionAnalysis {
  fen: string;
  bestMove: string;
  evaluation: UciScore;
  lines: UciLine[];
  depth: number;
}

export interface MoveAnalysis {
  moveNumber: number;
  side: 'white' | 'black';
  moveSan: string;
  moveUci: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: UciScore;
  evalAfter: UciScore;
  bestMove: string;
  bestMoveSan: string;
  classification: MoveClassification;
  evalDrop: number;
}

export type MoveClassification =
  | 'book'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  // Position could not be analysed (engine timeout/crash); excluded from
  // accuracy and error counts.
  | 'unknown';

export interface GameAnalysis {
  moves: MoveAnalysis[];
  whiteAccuracy: number;
  blackAccuracy: number;
  summary: GameSummary;
}

export interface GameSummary {
  totalMoves: number;
  whiteBlunders: number;
  whiteMistakes: number;
  whiteInaccuracies: number;
  blackBlunders: number;
  blackMistakes: number;
  blackInaccuracies: number;
  opening: string;
  /** Moves whose engine analysis failed (timeout/crash) and were skipped. */
  skippedMoves: number;
}

export interface OpeningInfo {
  eco: string;
  name: string;
  pgn: string;
  fen: string;
}

export interface TacticPuzzle {
  [key: string]: unknown;
  fen: string;
  hasTactic: boolean;
  solution: string[];
  solutionSan: string[];
  theme: string;
  difficulty: 'easy' | 'medium' | 'hard';
  explanation: string;
}

/** Convert a score to centipawns (mate scores map to large values). */
export function centipawns(score: UciScore): number {
  if (score.type === 'mate') {
    return score.value > 0 ? 10000 - score.value : -10000 - score.value;
  }
  return score.value;
}
