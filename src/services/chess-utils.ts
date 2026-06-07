// Chess utility service wrapping chess.js
import { Chess } from 'chess.js';
import type { OpeningInfo } from '../types.js';
import { OPENING_BOOK } from './openings-data.js';

/**
 * Does the side to move have a legal en-passant capture in this position?
 * chess.js writes an en-passant target square on every double pawn push, even
 * when no capture is actually available, so we only treat the ep square as part
 * of a position's identity when a capture truly exists.
 */
function hasEnPassantCapture(fen: string): boolean {
  try {
    return new Chess(fen).moves({ verbose: true }).some((m) => m.isEnPassant());
  } catch {
    return false;
  }
}

/**
 * Position-identity key for opening matching: piece placement + side to move +
 * castling rights + en passant — but the en-passant square is kept ONLY when an
 * en-passant capture is actually legal, and the halfmove/fullmove counters are
 * dropped entirely. This lets transpositions (the same position reached via a
 * different move order) share a key, while still distinguishing two positions
 * that differ only by a real, available en-passant capture (e.g. the King's
 * Gambit Mason-Keres Gambit vs the Van Geet Nowokunski Gambit, which share a
 * placement but not ep legality).
 */
function positionKey(fen: string): string {
  const [placement, side, castling, ep] = fen.split(' ');
  const epKey = ep && ep !== '-' && hasEnPassantCapture(fen) ? ep : '-';
  return `${placement} ${side} ${castling} ${epKey}`;
}

// Index every book position by its key once, so runtime lookup is an O(1) Map
// hit per ply instead of a linear scan of the whole book. First entry wins on
// the rare key collision (the dataset is already de-duplicated by position).
const BOOK_INDEX: Map<string, OpeningInfo> = (() => {
  const m = new Map<string, OpeningInfo>();
  for (const entry of OPENING_BOOK) {
    const key = positionKey(entry.fen);
    if (!m.has(key)) m.set(key, entry);
  }
  return m;
})();

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

/**
 * Replay SAN moves from the initial position and return the FEN after each ply.
 * Stops at the first move chess.js rejects, returning the FENs collected so far.
 */
function fensFromSanMoves(moves: string[]): string[] {
  const chess = new Chess();
  const fens: string[] = [];
  for (const san of moves) {
    try {
      chess.move(san);
    } catch {
      break;
    }
    fens.push(chess.fen());
  }
  return fens;
}

/**
 * Find the most specific known opening for a sequence of positions (one FEN per
 * ply). Returns:
 *   - `opening`: the deepest in-book position reached — the most specific name —
 *      even if it was reached via a transposition.
 *   - `bookDepth`: the length of the CONTIGUOUS leading run of in-book plies,
 *      i.e. how far the game followed theory before its first deviation. The
 *      book stores only named nodes, so a move that leaves book and later
 *      transposes back into a named line must NOT be credited as theory — hence
 *      we stop counting at the first out-of-book ply rather than at the deepest
 *      match.
 * Returns null if no position is in the book. Position-based, so it recognises
 * an opening regardless of move order.
 */
export function detectOpening(
  fens: string[]
): { opening: OpeningInfo; bookDepth: number } | null {
  let opening: OpeningInfo | null = null; // deepest in-book position → name
  let bookDepth = 0; // contiguous in-book prefix length → 'book' labelling
  let contiguous = true;
  for (let i = 0; i < fens.length; i++) {
    const entry = BOOK_INDEX.get(positionKey(fens[i]));
    if (entry) {
      opening = entry;
      if (contiguous) bookDepth = i + 1;
    } else {
      contiguous = false;
    }
  }
  return opening ? { opening, bookDepth } : null;
}

/** Look up the opening for a list of SAN moves (transposition-aware). */
export function lookupOpening(moves: string[]): OpeningInfo | null {
  const detected = detectOpening(fensFromSanMoves(moves));
  return detected ? detected.opening : null;
}

/**
 * Search openings by name or ECO code, ranked most-relevant first: an exact ECO
 * match, then a name-prefix match, then shorter (more canonical / main-line)
 * variations. Returns ALL matches sorted — the caller decides how many to show.
 */
export function searchOpenings(query: string): OpeningInfo[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const matches = OPENING_BOOK.filter(
    (o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase().includes(q)
  );

  return matches.sort((a, b) => {
    const ecoRank = (o: OpeningInfo): number => (o.eco.toLowerCase() === q ? 0 : 1);
    if (ecoRank(a) !== ecoRank(b)) return ecoRank(a) - ecoRank(b);

    const nameRank = (o: OpeningInfo): number => (o.name.toLowerCase().startsWith(q) ? 0 : 1);
    if (nameRank(a) !== nameRank(b)) return nameRank(a) - nameRank(b);

    const lenA = pgnToMoveList(a.pgn).length;
    const lenB = pgnToMoveList(b.pgn).length;
    if (lenA !== lenB) return lenA - lenB;

    return a.name.localeCompare(b.name);
  });
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
