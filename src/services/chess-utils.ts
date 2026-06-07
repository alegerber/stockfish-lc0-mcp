// Chess utility service wrapping chess.js
import { Chess } from 'chess.js';
import type { OpeningInfo } from '../types.js';

// Bundled ECO opening book (A–E codes, most common lines).
// Kept small to stay self-contained; extend via external DB if desired.
const OPENING_BOOK: OpeningInfo[] = [
  { eco: 'A00', name: 'Uncommon Opening', pgn: '1. a3', fen: 'rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq - 0 1' },
  { eco: 'A04', name: 'Reti Opening', pgn: '1. Nf3', fen: 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1' },
  { eco: 'A10', name: 'English Opening', pgn: '1. c4', fen: 'rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1' },
  { eco: 'A45', name: "Queen's Pawn Game", pgn: '1. d4', fen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1' },
  { eco: 'B00', name: "King's Pawn Opening", pgn: '1. e4', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' },
  { eco: 'B01', name: 'Scandinavian Defense', pgn: '1. e4 d5', fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' },
  { eco: 'B10', name: 'Caro-Kann Defense', pgn: '1. e4 c6', fen: 'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' },
  { eco: 'B20', name: 'Sicilian Defense', pgn: '1. e4 c5', fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' },
  { eco: 'C00', name: 'French Defense', pgn: '1. e4 e6', fen: 'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' },
  { eco: 'C20', name: "King's Pawn Game", pgn: '1. e4 e5', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' },
  { eco: 'C20', name: 'Wayward Queen Attack', pgn: '1. e4 e5 2. Qh5', fen: 'rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2' },
  { eco: 'C44', name: "King's Pawn Game: Scotch", pgn: '1. e4 e5 2. Nf3 Nc6 3. d4', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3' },
  { eco: 'C50', name: 'Italian Game', pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3' },
  { eco: 'C57', name: 'Italian Game: Fried Liver', pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7', fen: 'r1bqkb1r/ppp2Npp/2n5/3np3/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 6' },
  { eco: 'C60', name: 'Ruy Lopez', pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5', fen: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3' },
  { eco: 'D00', name: 'London System', pgn: '1. d4 d5 2. Bf4', fen: 'rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq - 1 2' },
  { eco: 'D06', name: "Queen's Gambit", pgn: '1. d4 d5 2. c4', fen: 'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 2' },
  { eco: 'D30', name: "Queen's Gambit Declined", pgn: '1. d4 d5 2. c4 e6', fen: 'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3' },
  { eco: 'D35', name: "Queen's Gambit Declined: Exchange", pgn: '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5', fen: 'rnbqkb1r/ppp2ppp/5n2/3p4/3P4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 5' },
  { eco: 'E00', name: 'Catalan Opening', pgn: '1. d4 Nf6 2. c4 e6 3. g3', fen: 'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/6P1/PP2PP1P/RNBQKBNR b KQkq - 0 3' },
];

/**
 * Parse a PGN string and return the list of moves + final FEN.
 * Throws on invalid PGN.
 */
export function parsePgn(pgn: string): { moves: { san: string; uci: string; fen: string }[]; headers: Record<string, string> } {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  // Replay to collect FEN after each move
  const result: { san: string; uci: string; fen: string }[] = [];
  const replay = new Chess();

  for (const move of history) {
    replay.move(move.san);
    result.push({
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      fen: replay.fen(),
    });
  }

  // Extract headers
  const headerEntries = chess.header();
  const headers: Record<string, string> = {};
  // chess.js .header() returns an object when called without args
  if (typeof headerEntries === 'object' && headerEntries !== null) {
    Object.assign(headers, headerEntries);
  }

  return { moves: result, headers };
}

/** Validate a FEN string. Returns true if valid. */
export function isValidFen(fen: string): boolean {
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a FEN string and surface the underlying error message.
 * Returns `{ valid: true }` on success or `{ valid: false; error: string }` on failure.
 */
export function validateFen(fen: string): { valid: true } | { valid: false; error: string } {
  try {
    new Chess(fen);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Invalid FEN' };
  }
}

/**
 * Convert a sequence of UCI moves to SAN notation starting from the given FEN.
 * Stops at the first move that cannot be applied and returns what was converted so far.
 */
export function uciSequenceToSan(startFen: string, uciMoves: string[]): string[] {
  const sanMoves: string[] = [];
  let currentFen = startFen;
  for (const uci of uciMoves) {
    try {
      const chess = new Chess(currentFen);
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
      sanMoves.push(move.san);
      currentFen = chess.fen();
    } catch {
      break;
    }
  }
  return sanMoves;
}

/** Convert UCI move to SAN in the context of a given FEN. */
export function uciToSan(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = chess.move({ from, to, promotion });
    return move ? move.san : uci;
  } catch {
    return uci;
  }
}

/** Look up the opening name for a list of SAN moves. */
export function lookupOpening(moves: string[]): OpeningInfo | null {
  // Build progressive PGN and match against book
  let bestMatch: OpeningInfo | null = null;
  let bestLength = 0;

  for (const entry of OPENING_BOOK) {
    const bookMoves = pgnToMoveList(entry.pgn);
    if (bookMoves.length > moves.length) continue;

    let match = true;
    for (let i = 0; i < bookMoves.length; i++) {
      if (bookMoves[i] !== moves[i]) {
        match = false;
        break;
      }
    }

    if (match && bookMoves.length > bestLength) {
      bestMatch = entry;
      bestLength = bookMoves.length;
    }
  }

  return bestMatch;
}

/** Search openings by name or ECO code. */
export function searchOpenings(query: string): OpeningInfo[] {
  const q = query.toLowerCase();
  return OPENING_BOOK.filter(
    (o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase().includes(q)
  );
}

/** Extract a flat list of SAN moves from a short PGN (no headers). */
export function pgnToMoveList(pgn: string): string[] {
  return pgn
    .replace(/\d+\.\s*/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

/** Check if the current position is game over. */
export function isGameOver(fen: string): { over: boolean; reason?: string } {
  try {
    const chess = new Chess(fen);
    if (chess.isCheckmate()) return { over: true, reason: 'checkmate' };
    if (chess.isStalemate()) return { over: true, reason: 'stalemate' };
    if (chess.isDraw()) return { over: true, reason: 'draw' };
    if (chess.isThreefoldRepetition()) return { over: true, reason: 'threefold repetition' };
    if (chess.isInsufficientMaterial()) return { over: true, reason: 'insufficient material' };
    return { over: false };
  } catch {
    return { over: false };
  }
}
