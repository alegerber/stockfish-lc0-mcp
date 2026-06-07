// Tools: Opening lookup and identification
import { searchOpenings, lookupOpening, parsePgn } from '../services/chess-utils.js';

export function lookupOpeningByQuery(
  query: string
): { text: string; json: Record<string, unknown> } {
  const results = searchOpenings(query);

  if (results.length === 0) {
    return {
      text: `No openings found for "${query}". Try a broader search term.`,
      json: { query, results: [] },
    };
  }

  // The book has thousands of lines, so a broad query ("Sicilian") can match
  // hundreds. Show the top-ranked slice but report the true total in `count`.
  const DISPLAY_LIMIT = 25;
  const shown = results.slice(0, DISPLAY_LIMIT);
  const more = results.length > shown.length ? ` (showing first ${shown.length})` : '';

  const lines = shown.map(
    (o) => `**${o.eco} – ${o.name}**\nMoves: ${o.pgn}\nFEN: \`${o.fen}\``
  );

  return {
    text: `Found ${results.length} opening(s) for "${query}"${more}:\n\n${lines.join('\n\n')}`,
    json: { query, count: results.length, results: shown },
  };
}

export function identifyOpeningFromPgn(
  pgn: string
): { text: string; json: Record<string, unknown> } {
  // Try parsing as full PGN first, fall back to bare move list
  let sanMoves: string[];
  try {
    const parsed = parsePgn(pgn);
    sanMoves = parsed.moves.map((m) => m.san);
  } catch {
    // Treat input as space-separated SAN moves, strip move numbers
    sanMoves = pgn
      .replace(/\d+\.\s*/g, '')
      .split(/\s+/)
      .filter(Boolean);
  }

  const opening = lookupOpening(sanMoves);

  if (!opening) {
    return {
      text: 'Could not identify the opening from the given moves.',
      json: { identified: false, moves: sanMoves },
    };
  }

  return {
    text: `**${opening.eco} – ${opening.name}**\nBook line: ${opening.pgn}`,
    json: { identified: true, eco: opening.eco, name: opening.name, pgn: opening.pgn, fen: opening.fen },
  };
}
