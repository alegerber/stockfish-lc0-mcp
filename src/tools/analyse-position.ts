// Tool: Analyse a single chess position
import type { UciEngine } from '../types.js';
import { validateFen, uciToSan, uciSequenceToSan } from '../services/chess-utils.js';
import { formatPositionAnalysis, formatScore } from '../services/formatting.js';

export async function analysePosition(
  engine: UciEngine,
  fen: string,
  depth: number,
  multiPv: number,
  signal?: AbortSignal
): Promise<{ text: string; json: Record<string, unknown> }> {
  const fenCheck = validateFen(fen);
  if (!fenCheck.valid) {
    throw new Error(`Invalid FEN: "${fen}". ${fenCheck.error}`);
  }

  const analysis = await engine.analyse(fen, depth, multiPv, signal);

  // Enrich PV with SAN notation
  for (const line of analysis.lines) {
    line.pvSan = uciSequenceToSan(fen, line.pv);
  }

  const text = formatPositionAnalysis(analysis);

  const json = {
    fen: analysis.fen,
    depth: analysis.depth,
    evaluation: formatScore(analysis.evaluation),
    evaluationRaw: analysis.evaluation,
    bestMove: analysis.bestMove,
    bestMoveSan: uciToSan(fen, analysis.bestMove),
    lines: analysis.lines.map((l) => ({
      rank: l.multipv,
      score: formatScore(l.score),
      scoreRaw: l.score,
      depth: l.depth,
      movesUci: l.pv,
      movesSan: l.pvSan,
    })),
  };

  return { text, json };
}
