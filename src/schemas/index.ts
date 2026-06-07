// Zod input schemas for all tools
import { z } from 'zod';
import { MAX_DEPTH, MAX_MULTI_PV, LC0_GAME_DEFAULT_DEPTH, LC0_POSITION_DEFAULT_DEPTH } from '../constants.js';

export const AnalysePositionSchema = z.object({
  fen: z.string()
    .describe('FEN string of the position to analyse'),
  depth: z.number()
    .int()
    .min(1)
    .max(MAX_DEPTH)
    .default(20)
    .describe('Search depth (1–30, default 20)'),
  multiPv: z.number()
    .int()
    .min(1)
    .max(MAX_MULTI_PV)
    .default(3)
    .describe('Number of principal variations to return (1–5, default 3)'),
}).strict();

export const AnalyseGameSchema = z.object({
  pgn: z.string()
    .describe('Full PGN of the game to analyse'),
  depth: z.number()
    .int()
    .min(1)
    .max(MAX_DEPTH)
    .default(22)
    .describe('Search depth per move (1–30, default 22). Lower depth = faster.'),
}).strict();

// Same shape as AnalysePositionSchema, but with an Lc0-appropriate default and
// a CPU-performance warning. Lc0 runs on the OpenBLAS CPU backend here, so a
// high depth (e.g. 20 → 150k nodes) can be slow / time out; the default is
// lowered and the cost is called out so callers opt into deeper searches.
export const Lc0AnalysePositionSchema = z.object({
  fen: z.string()
    .describe('FEN string of the position to analyse'),
  depth: z.number()
    .int()
    .min(1)
    .max(MAX_DEPTH)
    .default(LC0_POSITION_DEFAULT_DEPTH)
    .describe(`Search strength (1–30, default ${LC0_POSITION_DEFAULT_DEPTH} for Lc0; mapped to a node budget). Higher = slower; Lc0 on CPU may time out at high depth.`),
  multiPv: z.number()
    .int()
    .min(1)
    .max(MAX_MULTI_PV)
    .default(3)
    .describe('Number of principal variations to return (1–5, default 3)'),
}).strict();

// Lc0 reaches its node budget far more slowly than Stockfish reaches a depth,
// so game analysis (many positions) gets a lower default depth to avoid timing
// out on every move. Same shape as AnalyseGameSchema, lower default.
export const Lc0AnalyseGameSchema = z.object({
  pgn: z.string()
    .describe('Full PGN of the game to analyse'),
  depth: z.number()
    .int()
    .min(1)
    .max(MAX_DEPTH)
    .default(LC0_GAME_DEFAULT_DEPTH)
    .describe(`Search depth per move (1–30, default ${LC0_GAME_DEFAULT_DEPTH} for Lc0). Higher = slower; Lc0 on CPU may time out at high depth.`),
}).strict();

export const LookupOpeningSchema = z.object({
  query: z.string()
    .min(1)
    .describe('Opening name or ECO code to search for (e.g. "Sicilian", "B20", "Italian")'),
}).strict();

export const IdentifyOpeningSchema = z.object({
  pgn: z.string()
    .describe('PGN or space-separated SAN moves to identify the opening'),
}).strict();

export const GeneratePuzzleSchema = z.object({
  fen: z.string()
    .describe('FEN of the position to generate a puzzle from'),
  depth: z.number()
    .int()
    .min(1)
    .max(MAX_DEPTH)
    .default(22)
    .describe('Search depth for finding tactics (1–30, default 22)'),
}).strict();

// ── Output schemas (structuredContent contracts) ──────────────────────────
// NOT .strict(): the MCP SDK validates structuredContent against these but does
// not strip, so extra fields are tolerated — only a missing required field or a
// wrong type fails. Fields that exist only in one response variant are optional.

const UciScoreSchema = z.object({
  type: z.enum(['cp', 'mate']),
  value: z.number(),
});

export const AnalysePositionOutput = z.object({
  fen: z.string(),
  depth: z.number(),
  evaluation: z.string(),
  evaluationRaw: UciScoreSchema,
  bestMove: z.string(),
  bestMoveSan: z.string(),
  lines: z.array(
    z.object({
      rank: z.number(),
      score: z.string(),
      scoreRaw: UciScoreSchema,
      depth: z.number(),
      movesUci: z.array(z.string()),
      movesSan: z.array(z.string()),
    })
  ),
});

const AccuracySchema = z.union([z.number(), z.literal('n/a')]);

export const AnalyseGameOutput = z.object({
  opening: z.string(),
  totalMoves: z.number(),
  whiteAccuracy: AccuracySchema,
  blackAccuracy: AccuracySchema,
  summary: z.object({
    totalMoves: z.number(),
    whiteBlunders: z.number(),
    whiteMistakes: z.number(),
    whiteInaccuracies: z.number(),
    blackBlunders: z.number(),
    blackMistakes: z.number(),
    blackInaccuracies: z.number(),
    opening: z.string(),
    skippedMoves: z.number(),
  }),
  moves: z.array(
    z.object({
      moveNumber: z.number(),
      side: z.enum(['white', 'black']),
      move: z.string(),
      evaluation: z.string(), // formatted score, or 'n/a' for unanalysed moves
      bestMove: z.string(),
      classification: z.string(),
      evalDrop: z.number(),
    })
  ),
});

export const LookupOpeningOutput = z.object({
  query: z.string(),
  count: z.number().optional(), // absent in the no-results variant
  results: z.array(
    z.object({
      eco: z.string(),
      name: z.string(),
      pgn: z.string(),
      fen: z.string(),
    })
  ),
});

export const IdentifyOpeningOutput = z.object({
  identified: z.boolean(),
  moves: z.array(z.string()).optional(), // present when NOT identified
  eco: z.string().optional(), // the next four present when identified
  name: z.string().optional(),
  pgn: z.string().optional(),
  fen: z.string().optional(),
});

export const GeneratePuzzleOutput = z.object({
  fen: z.string(),
  hasTactic: z.boolean(),
  // no-tactic variant:
  bestMove: z.string().optional(),
  bestMoveSan: z.string().optional(),
  evaluation: z.string().optional(),
  // tactic variant:
  solution: z.array(z.string()).optional(),
  solutionSan: z.array(z.string()).optional(),
  theme: z.string().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  explanation: z.string().optional(),
});

export type AnalysePositionInput = z.infer<typeof AnalysePositionSchema>;
export type AnalyseGameInput = z.infer<typeof AnalyseGameSchema>;
export type LookupOpeningInput = z.infer<typeof LookupOpeningSchema>;
export type IdentifyOpeningInput = z.infer<typeof IdentifyOpeningSchema>;
export type GeneratePuzzleInput = z.infer<typeof GeneratePuzzleSchema>;
