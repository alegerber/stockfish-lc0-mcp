// Tool: Analyse a full game from PGN
import type { UciEngine, MoveAnalysis, MoveClassification, GameAnalysis, UciScore } from '../types.js';
import { centipawns } from '../types.js';
import { parsePgn, uciToSan, lookupOpening, isGameOver } from '../services/chess-utils.js';
import { formatGameAnalysis, formatScore, whitePovScore } from '../services/formatting.js';
import { START_FEN, BLUNDER_THRESHOLD, MISTAKE_THRESHOLD, INACCURACY_THRESHOLD, GOOD_THRESHOLD, EXCELLENT_THRESHOLD } from '../constants.js';

export async function analyseGame(
  engine: UciEngine,
  pgn: string,
  depth: number
): Promise<{ text: string; json: Record<string, unknown> }> {
  if (!pgn.trim()) {
    throw new Error('PGN cannot be empty. Please provide a valid game.');
  }
  const { moves, headers } = parsePgn(pgn);
  if (moves.length === 0) {
    throw new Error('PGN contains no moves. Please provide a valid game.');
  }

  // Detect opening
  const sanMoves = moves.map((m) => m.san);
  const opening = lookupOpening(sanMoves);
  const openingName = opening?.name ?? headers['ECO'] ?? 'Unknown';

  // Evaluate starting position
  const startEval = await engine.analyse(START_FEN, depth, 1);
  let prevScore: UciScore = startEval.evaluation;

  const moveAnalyses: MoveAnalysis[] = [];
  let currentFen = START_FEN;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const side: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black';
    const moveNumber = Math.floor(i / 2) + 1;
    const fenBefore = currentFen;

    // Check if the position after the move is terminal (checkmate/stalemate)
    const terminal = isGameOver(move.fen);

    // Analyse what the best move WAS in the position before
    const posBefore = await engine.analyse(fenBefore, depth, 1);
    const bestMoveUci = posBefore.bestMove;
    const bestMoveSan = uciToSan(fenBefore, bestMoveUci);

    let evalAfterScore: UciScore;
    let drop: number;
    let classification: MoveClassification;

    if (terminal.over && terminal.reason === 'checkmate') {
      // The mover delivered checkmate — this is always the best move.
      // From the opponent's POV after checkmate: they are mated → mate 0.
      evalAfterScore = { type: 'mate', value: 0 };
      drop = 0;
      classification = 'best';
    } else if (terminal.over) {
      // Stalemate or draw — eval is 0 from both sides
      evalAfterScore = { type: 'cp', value: 0 };
      const evalBeforeForMover = centipawns(prevScore);
      drop = Math.max(0, evalBeforeForMover); // losing a winning position is bad
      classification = classifyMove(drop, move.san === bestMoveSan);
    } else {
      // Normal position — analyse after the move
      const posAfter = await engine.analyse(move.fen, depth, 1);
      evalAfterScore = posAfter.evaluation;

      // Stockfish reports scores from the side-to-move's perspective.
      // prevScore is from `side`'s perspective (side-to-move before the move).
      // posAfter.evaluation is from the opponent's perspective (side-to-move after the move).
      // Normalise both to the moving player's perspective to compute eval drop.
      const evalBeforeForMover = centipawns(prevScore); // already from mover's POV
      const evalAfterForMover = -centipawns(posAfter.evaluation); // negate: opponent's POV → mover's POV

      drop = evalBeforeForMover - evalAfterForMover;
      classification = classifyMove(drop, move.san === bestMoveSan);
    }

    moveAnalyses.push({
      moveNumber,
      side,
      moveSan: move.san,
      moveUci: move.uci,
      fenBefore,
      fenAfter: move.fen,
      evalBefore: prevScore,
      evalAfter: evalAfterScore,
      bestMove: bestMoveUci,
      bestMoveSan,
      classification,
      evalDrop: drop,
    });

    prevScore = evalAfterScore;
    currentFen = move.fen;

    // Log progress to stderr
    if ((i + 1) % 10 === 0) {
      console.error(`[analyse-game] ${i + 1}/${moves.length} moves analysed`);
    }
  }

  // Compute accuracy (simplified model)
  const whiteAccuracy = computeAccuracy(moveAnalyses.filter((m) => m.side === 'white'));
  const blackAccuracy = computeAccuracy(moveAnalyses.filter((m) => m.side === 'black'));

  const summary = {
    totalMoves: moves.length,
    whiteBlunders: count(moveAnalyses, 'white', 'blunder'),
    whiteMistakes: count(moveAnalyses, 'white', 'mistake'),
    whiteInaccuracies: count(moveAnalyses, 'white', 'inaccuracy'),
    blackBlunders: count(moveAnalyses, 'black', 'blunder'),
    blackMistakes: count(moveAnalyses, 'black', 'mistake'),
    blackInaccuracies: count(moveAnalyses, 'black', 'inaccuracy'),
    opening: openingName,
  };

  const analysis: GameAnalysis = {
    moves: moveAnalyses,
    whiteAccuracy,
    blackAccuracy,
    summary,
  };

  const text = formatGameAnalysis(analysis);

  const json = {
    opening: openingName,
    totalMoves: moves.length,
    whiteAccuracy: Math.round(whiteAccuracy * 10) / 10,
    blackAccuracy: Math.round(blackAccuracy * 10) / 10,
    summary,
    moves: moveAnalyses.map((m) => ({
      moveNumber: m.moveNumber,
      side: m.side,
      move: m.moveSan,
      // evalAfter is stored raw (engine = side-to-move-after-the-move POV) for the
      // drop/accuracy math above; normalise to White's POV only here for display.
      evaluation: formatScore(whitePovScore(m.evalAfter, m.side)),
      bestMove: m.bestMoveSan,
      classification: m.classification,
      evalDrop: Math.round(m.evalDrop),
    })),
  };

  return { text, json };
}

// --- helpers ---

/** Classify a move based on centipawn loss. */
function classifyMove(drop: number, isBest: boolean): MoveClassification {
  if (isBest) return 'best';
  if (drop >= BLUNDER_THRESHOLD) return 'blunder';
  if (drop >= MISTAKE_THRESHOLD) return 'mistake';
  if (drop >= INACCURACY_THRESHOLD) return 'inaccuracy';
  if (drop >= GOOD_THRESHOLD) return 'good';
  if (drop >= EXCELLENT_THRESHOLD) return 'excellent';
  return 'great';
}

/** Count errors of a given classification for a side. */
function count(moves: MoveAnalysis[], side: 'white' | 'black', cls: MoveClassification): number {
  return moves.filter((m) => m.side === side && m.classification === cls).length;
}

/**
 * Win probability from centipawn score, using the Lichess model.
 * Returns a value between 0 and 1.
 */
function winProbability(cp: number): number {
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

/**
 * Accuracy model based on win-probability loss (similar to Lichess/chess.com).
 *
 * For each move, accuracy = 103.1668 * exp(-0.04354 * wpLoss) - 3.1669
 * where wpLoss is the win-probability loss in percentage points.
 * This gives ~100% for 0 loss, ~55% for a 10pp loss, and near 0% for
 * large losses. The formula is the Lichess accuracy model.
 */
function computeAccuracy(moves: MoveAnalysis[]): number {
  if (moves.length === 0) return 100;

  let totalAccuracy = 0;
  for (const m of moves) {
    const cpBefore = centipawns(m.evalBefore);
    const cpAfter = centipawns(m.evalAfter);

    // evalBefore is from the mover's perspective (side-to-move before the move).
    // evalAfter is from the opponent's perspective (side-to-move after the move).
    // winProbability(cp) gives win prob for the side whose perspective cp is in.
    const wpBefore = winProbability(cpBefore);       // mover's win prob before
    const wpAfter = winProbability(-cpAfter);         // mover's win prob after (negate opponent's POV)

    // Win-probability loss in percentage points (0–100 scale)
    const wpLoss = Math.max(0, (wpBefore - wpAfter) * 100);

    // Lichess accuracy formula per move
    const moveAccuracy = Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * wpLoss) - 3.1669));
    totalAccuracy += moveAccuracy;
  }

  return totalAccuracy / moves.length;
}
