// Tool: Analyse a full game from PGN
import type { UciEngine, MoveAnalysis, MoveClassification, GameAnalysis, UciScore, PositionAnalysis } from '../types.js';
import { centipawns } from '../types.js';
import { parsePgn, uciToSan, isGameOver, detectOpening } from '../services/chess-utils.js';
import { formatGameAnalysis, formatScore, whitePovScore, negateScore } from '../services/formatting.js';
import { START_FEN, BLUNDER_THRESHOLD, MISTAKE_THRESHOLD, INACCURACY_THRESHOLD, GOOD_THRESHOLD, MAX_REPORTED_DROP } from '../constants.js';

export async function analyseGame(
  engine: UciEngine,
  pgn: string,
  depth: number,
  signal?: AbortSignal
): Promise<{ text: string; json: Record<string, unknown> }> {
  if (!pgn.trim()) {
    throw new Error('PGN cannot be empty. Please provide a valid game.');
  }
  const { moves, headers } = parsePgn(pgn);
  if (moves.length === 0) {
    throw new Error('PGN contains no moves. Please provide a valid game.');
  }
  if (signal?.aborted) throw new Error('Analysis cancelled');

  // Detect opening by board position (transposition-aware). detectOpening keys
  // on the FEN after each ply, so the recognised line is correct even when the
  // opening arises via a different move order.
  const detected = detectOpening(moves.map((m) => m.fen));
  const openingName = detected?.opening.name ?? headers['ECO'] ?? 'Unknown';
  // How many leading plies stayed "in book" (theory) — they get the 'book'
  // label. bookDepth is the actual ply at which the game left book, so it is
  // right even for transposed openings.
  const bookMoveCount = detected?.bookDepth ?? 0;

  // Analyse the starting position once. This analysis is carried forward and
  // reused as the "before" analysis of the next move, so each position is
  // analysed exactly once (N+1 calls, not 2N+1). safeAnalyse returns null on
  // engine failure (timeout/crash) instead of throwing.
  let prevAnalysis: PositionAnalysis | null = await safeAnalyse(engine, START_FEN, depth, signal);
  let prevScore: UciScore = prevAnalysis?.evaluation ?? { type: 'cp', value: 0 };

  const moveAnalyses: MoveAnalysis[] = [];
  let currentFen = START_FEN;
  let skippedMoves = 0;

  for (let i = 0; i < moves.length; i++) {
    if (signal?.aborted) throw new Error('Analysis cancelled');
    const move = moves[i];
    const side: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black';
    const moveNumber = Math.floor(i / 2) + 1;
    const fenBefore = currentFen;

    // Check if the position after the move is terminal (checkmate/stalemate)
    const terminal = isGameOver(move.fen);

    // Best move in the position before — reused from the previous iteration's
    // analysis (its position == this fenBefore). Empty if that analysis failed.
    const bestMoveUci = prevAnalysis?.bestMove ?? '';
    const bestMoveSan = bestMoveUci ? uciToSan(fenBefore, bestMoveUci) : '';

    let evalAfterScore: UciScore;
    let drop: number;
    let classification: MoveClassification;
    // Analysis of the position AFTER this move; carried into the next iteration.
    let curAnalysis: PositionAnalysis | null = null;

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
      // Normal position — analyse after the move (reused as next "before").
      curAnalysis = await safeAnalyse(engine, move.fen, depth, signal);
      if (curAnalysis === null) {
        // Engine failed (timeout/crash): tolerate it — mark this move
        // unanalysed, keep the eval chain stable, and continue the game.
        evalAfterScore = prevScore;
        drop = 0;
        classification = 'unknown';
        skippedMoves++;
      } else {
        evalAfterScore = curAnalysis.evaluation;

        // Scores are from the side-to-move's perspective. prevScore is from the
        // mover's POV; curAnalysis.evaluation is from the opponent's POV (side to
        // move after the move). Normalise both to the mover's POV for the drop.
        const evalBeforeForMover = centipawns(prevScore);
        const evalAfterForMover = -centipawns(curAnalysis.evaluation);

        drop = evalBeforeForMover - evalAfterForMover;
        classification = classifyMove(drop, move.san === bestMoveSan);
      }
    }

    // Opening-book moves the engine doesn't fault are theory, not engine
    // decisions — label them 'book'. A move that is actually an error (even a
    // named book line like the Wayward Queen 2. Qh5) keeps its error label so it
    // isn't hidden; terminal moves keep their 'best'/mate signal; skipped moves
    // keep 'unknown'.
    const bookEligible =
      classification === 'best' || classification === 'excellent' || classification === 'good';
    if (i < bookMoveCount && bookEligible && !terminal.over) {
      classification = 'book';
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

    if (classification === 'unknown') {
      // The after-position eval is unknown. Flip the before-eval to the next
      // mover's POV (they alternate) so the following move's drop is at least in
      // the correct frame — an approximation, since the true after-eval is gone.
      prevScore = negateScore(prevScore);
    } else {
      prevScore = evalAfterScore;
    }
    // After a terminal/failed move prevAnalysis is null, so the NEXT move has no
    // reused "before" analysis: its bestMoveSan is '' and it cannot be tagged
    // 'best'. Accepted trade-off of the single-analysis-per-position optimisation.
    prevAnalysis = curAnalysis;
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
    skippedMoves,
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
    whiteAccuracy: whiteAccuracy === null ? 'n/a' : Math.round(whiteAccuracy * 10) / 10,
    blackAccuracy: blackAccuracy === null ? 'n/a' : Math.round(blackAccuracy * 10) / 10,
    summary,
    moves: moveAnalyses.map((m) => ({
      moveNumber: m.moveNumber,
      side: m.side,
      move: m.moveSan,
      // evalAfter is stored raw (engine = side-to-move-after-the-move POV) for the
      // drop/accuracy math above; normalise to White's POV only here for display.
      evaluation:
        m.classification === 'unknown'
          ? 'n/a'
          : formatScore(whitePovScore(m.evalAfter, m.side)),
      bestMove: m.bestMoveSan,
      classification: m.classification,
      evalDrop: Math.round(Math.max(-MAX_REPORTED_DROP, Math.min(MAX_REPORTED_DROP, m.evalDrop))),
    })),
  };

  return { text, json };
}

// --- helpers ---

/**
 * Single-PV analysis that returns null (instead of throwing) when the engine
 * fails — e.g. a timeout or process crash on one position. Lets game analysis
 * tolerate a bad position instead of aborting the whole game.
 */
async function safeAnalyse(
  engine: UciEngine,
  fen: string,
  depth: number,
  signal?: AbortSignal
): Promise<PositionAnalysis | null> {
  try {
    return await engine.analyse(fen, depth, 1, signal);
  } catch (err) {
    if (signal?.aborted) throw err; // propagate cancellation — don't treat it as a skipped move
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[analyse-game] analysis failed for "${fen}": ${msg}`);
    return null;
  }
}

/** Classify a move based on centipawn loss. */
function classifyMove(drop: number, isBest: boolean): MoveClassification {
  if (isBest) return 'best';
  if (drop >= BLUNDER_THRESHOLD) return 'blunder';
  if (drop >= MISTAKE_THRESHOLD) return 'mistake';
  if (drop >= INACCURACY_THRESHOLD) return 'inaccuracy';
  if (drop >= GOOD_THRESHOLD) return 'good';
  return 'excellent'; // negligible or negative loss
}

/** Count errors of a given classification for a side. */
function count(moves: MoveAnalysis[], side: 'white' | 'black', cls: MoveClassification): number {
  return moves.filter((m) => m.side === side && m.classification === cls).length;
}

/**
 * Win probability (0–1) from a centipawn score, using the Lichess logistic.
 * The cp is clamped to ±1000 first — Lichess caps the eval before the logistic,
 * so mate scores (centipawns() maps them to ±10000) don't saturate win% to 0/1
 * and flatten accuracy distinctions in clearly won/lost positions.
 */
export function winProbability(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + Math.exp(-0.00368208 * clamped));
}

/**
 * Aggregate per-move accuracies into a single game accuracy. Approximates the
 * Lichess model — the mean of the arithmetic and harmonic means of the per-move
 * curve — but omits Lichess's volatility weighting (which would weight the
 * arithmetic term by the win% volatility around each move). The harmonic term
 * makes a few bad moves weigh more than a plain average would; flooring each
 * reciprocal at 1 keeps a single catastrophic (0%) move from collapsing the
 * whole game to 0.
 */
export function aggregateAccuracy(accuracies: number[]): number {
  if (accuracies.length === 0) return 100;
  const arithmetic = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
  const harmonic = accuracies.length / accuracies.reduce((sum, a) => sum + 1 / Math.max(a, 1), 0);
  return (arithmetic + harmonic) / 2;
}

/**
 * Per-move accuracy via the Lichess win-probability curve, aggregated with
 * {@link aggregateAccuracy}. Per move: accuracy = 103.1668 * exp(-0.04354 *
 * wpLoss) - 3.1669 (clamped 0–100), where wpLoss is the win-probability loss in
 * percentage points — ~100% for 0 loss, ~64% for a 10pp loss, near 0% for large.
 *
 * Returns null when no move could be analysed (e.g. the engine failed on every
 * position for this side), so "no data" is reported as n/a rather than masquerading
 * as a flawless 100%.
 */
function computeAccuracy(moves: MoveAnalysis[]): number | null {
  // Unanalysed (skipped) moves have no meaningful eval — exclude them.
  const analysed = moves.filter((m) => m.classification !== 'unknown');
  if (analysed.length === 0) return null;

  const perMove = analysed.map((m) => {
    // evalBefore is from the mover's perspective (side-to-move before the move);
    // evalAfter is from the opponent's (side-to-move after). Normalise both to the
    // mover's win probability, then derive the per-move accuracy from the loss.
    const wpBefore = winProbability(centipawns(m.evalBefore));
    const wpAfter = winProbability(-centipawns(m.evalAfter));
    const wpLoss = Math.max(0, (wpBefore - wpAfter) * 100);
    return Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * wpLoss) - 3.1669));
  });

  return aggregateAccuracy(perMove);
}
