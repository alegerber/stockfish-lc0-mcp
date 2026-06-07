// Tool: Generate a tactic puzzle from a position
import type { UciEngine, UciScore, TacticPuzzle } from '../types.js';
import { centipawns } from '../types.js';
import { validateFen, uciSequenceToSan } from '../services/chess-utils.js';
import { formatScore } from '../services/formatting.js';
import { MIN_TACTIC_ADVANTAGE } from '../constants.js';

export async function generatePuzzle(
  engine: UciEngine,
  fen: string,
  depth: number
): Promise<{ text: string; json: Record<string, unknown> }> {
  const fenCheck = validateFen(fen);
  if (!fenCheck.valid) {
    throw new Error(`Invalid FEN: "${fen}". ${fenCheck.error}`);
  }

  // Analyse with 2 PVs to compare the best move against the second-best.
  const analysis = await engine.analyse(fen, depth, 2);
  const lines = analysis.lines;

  if (lines.length === 0) {
    throw new Error('Engine returned no lines. The position may be terminal (checkmate/stalemate).');
  }

  const bestLine = lines[0];
  const secondLine = lines.length > 1 ? lines[1] : null;
  const sideToMove = fen.split(' ')[1] === 'b' ? 'Black' : 'White';
  const bestMoveSan = uciSequenceToSan(fen, bestLine.pv.slice(0, 1))[0] ?? bestLine.pv[0] ?? '';

  // Gate: is there actually a tactic? A forced mate always qualifies. Otherwise
  // the best move must be clearly better than the second-best (a real "only
  // move" gap) — which needs a second line to measure. A quiet position with no
  // dominant move is reported as such instead of a fabricated puzzle.
  // A forced mate FOR the side to move is always a puzzle. A mate AGAINST them
  // (negative value, or the 0 "already mated" sentinel) is a lost position, not
  // a puzzle. Otherwise the best move must clearly beat the second-best.
  const winningMate = bestLine.score.type === 'mate' && bestLine.score.value > 0;
  const losingMate = bestLine.score.type === 'mate' && bestLine.score.value <= 0;
  const bestScore = centipawns(bestLine.score);
  const advantage = secondLine ? bestScore - centipawns(secondLine.score) : null;
  const hasTactic =
    winningMate || (!losingMate && advantage !== null && advantage >= MIN_TACTIC_ADVANTAGE);

  if (!hasTactic) {
    const text = [
      '**No clear tactic** in this position.',
      `**FEN:** \`${fen}\``,
      `**${sideToMove} to move.** Best move ${bestMoveSan} (${formatScore(bestLine.score)}), `
        + 'but no move stands out enough to make a puzzle.',
    ].join('\n');
    return {
      text,
      json: {
        fen,
        hasTactic: false,
        bestMove: bestLine.pv[0] ?? '',
        bestMoveSan,
        evaluation: formatScore(bestLine.score),
      },
    };
  }

  // Build the solution sequence (first 3–5 moves of the PV).
  const solutionUci = bestLine.pv.slice(0, Math.min(bestLine.pv.length, 5));
  const solutionSan = uciSequenceToSan(fen, solutionUci);

  // Difficulty: mates by distance; tactics by how dominant the best move is.
  let difficulty: TacticPuzzle['difficulty'];
  if (winningMate) {
    const mateIn = Math.abs(bestLine.score.value);
    difficulty = mateIn <= 2 ? 'easy' : mateIn <= 4 ? 'medium' : 'hard';
  } else {
    const gap = advantage ?? 0;
    difficulty = gap > 500 ? 'easy' : gap > 300 ? 'medium' : 'hard';
  }

  const theme = detectTheme(bestLine.score, solutionSan);
  const explanation = `${sideToMove} to move. ${theme}. Evaluation: ${formatScore(bestLine.score)}`;

  // The PV alternates side-to-move (the solver) and opponent replies. Bold the
  // solver's moves (even indices) so the full line stays visible but the moves
  // to find are clear.
  const solutionMarked = solutionSan
    .map((san, i) => (i % 2 === 0 ? `**${san}**` : san))
    .join(' ');

  const puzzle: TacticPuzzle = {
    fen,
    hasTactic: true,
    solution: solutionUci.slice(0, solutionSan.length),
    solutionSan,
    theme,
    difficulty,
    explanation,
  };

  // A <details> block keeps the solution collapsed in clients that render GFM,
  // and degrades to plainly-labelled text where they don't.
  // Theme + solution live INSIDE the spoiler — the theme (e.g. "Mate in 1")
  // would otherwise give the answer away in the visible header.
  const text = [
    `**Tactic Puzzle** (${difficulty})`,
    `**FEN:** \`${fen}\``,
    `**${sideToMove} to move**`,
    '',
    '<details>',
    '<summary>Solution</summary>',
    '',
    `**Theme:** ${theme}`,
    '',
    solutionMarked,
    '',
    `_${explanation}_`,
    '</details>',
  ].join('\n');

  return { text, json: puzzle };
}

// --- helpers ---

function detectTheme(score: UciScore, solutionSan: string[]): string {
  if (score.type === 'mate') {
    return `Mate in ${Math.abs(score.value)}`;
  }

  const hasCapture = solutionSan.some((m) => m.includes('x'));
  const hasCheck = solutionSan.some((m) => m.includes('+'));
  const hasPromotion = solutionSan.some((m) => m.includes('='));

  if (hasPromotion) return 'Promotion';
  if (hasCheck && hasCapture) return 'Attacking combination';
  if (hasCheck) return 'Forcing sequence';
  if (hasCapture) return 'Tactical combination';
  if (Math.abs(score.value) > 300) return 'Winning material';

  // The gate already guaranteed a dominant move, so this isn't a quiet position.
  return 'Best move';
}
