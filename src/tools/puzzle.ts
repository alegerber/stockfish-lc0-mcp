// Tool: Generate a tactic puzzle from a position
import type { UciEngine, TacticPuzzle } from '../types.js';
import { centipawns } from '../types.js';
import { validateFen, uciSequenceToSan } from '../services/chess-utils.js';
import { formatScore } from '../services/formatting.js';

export async function generatePuzzle(
  engine: UciEngine,
  fen: string,
  depth: number,
  signal?: AbortSignal
): Promise<{ text: string; json: Record<string, unknown> }> {
  const fenCheck = validateFen(fen);
  if (!fenCheck.valid) {
    throw new Error(`Invalid FEN: "${fen}". ${fenCheck.error}`);
  }

  // Analyse with 2 PVs to compare best vs second-best
  const analysis = await engine.analyse(fen, depth, 2, signal);
  const lines = analysis.lines;

  if (lines.length === 0) {
    throw new Error('Engine returned no lines. The position may be terminal (checkmate/stalemate).');
  }

  const bestLine = lines[0];
  const secondLine = lines.length > 1 ? lines[1] : null;

  // Determine if the position has a clear tactical solution
  const bestScore = centipawns(bestLine.score);
  const secondScore = secondLine ? centipawns(secondLine.score) : bestScore - 300;
  const advantage = bestScore - secondScore;

  // Build the solution sequence (first 3–5 moves of the PV)
  const solutionLength = Math.min(bestLine.pv.length, 5);
  const solutionUci = bestLine.pv.slice(0, solutionLength);
  const solutionSan = uciSequenceToSan(fen, solutionUci);

  // Classify difficulty
  const difficulty = advantage > 500 ? 'easy' : advantage > 200 ? 'medium' : 'hard';

  // Detect theme
  const theme = detectTheme(fen, bestLine, solutionSan);

  // Build explanation
  const sideToMove = fen.includes(' w ') ? 'White' : 'Black';
  const explanation = `${sideToMove} to move. ${theme}. Evaluation: ${formatScore(bestLine.score)}`;

  const puzzle: TacticPuzzle = {
    fen,
    solution: solutionUci.slice(0, solutionSan.length),
    solutionSan,
    theme,
    difficulty,
    explanation,
  };

  const text = [
    `**Tactic Puzzle** (${difficulty})`,
    `**FEN:** \`${fen}\``,
    `**Theme:** ${theme}`,
    `**${sideToMove} to move**`,
    '',
    `||**Solution:** ${solutionSan.join(' ')}||`,
    `||**Explanation:** ${explanation}||`,
  ].join('\n');

  return { text, json: puzzle };
}

// --- helpers ---

function detectTheme(
  fen: string,
  bestLine: { score: { type: string; value: number }; pv: string[] },
  solutionSan: string[]
): string {
  // Check for mate
  if (bestLine.score.type === 'mate') {
    return `Mate in ${Math.abs(bestLine.score.value)}`;
  }

  // Check for captures in solution
  const hasCapture = solutionSan.some((m) => m.includes('x'));
  const hasCheck = solutionSan.some((m) => m.includes('+'));
  const hasPromotion = solutionSan.some((m) => m.includes('='));

  if (hasPromotion) return 'Promotion';
  if (hasCheck && hasCapture) return 'Attacking combination';
  if (hasCheck) return 'Forcing sequence';
  if (hasCapture) return 'Tactical combination';

  // Check material advantage
  if (bestLine.score.type === 'cp' && Math.abs(bestLine.score.value) > 300) {
    return 'Winning material';
  }

  return 'Positional advantage';
}
