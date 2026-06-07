// Regenerate src/services/openings-data.ts from the Lichess chess-openings
// database (https://github.com/lichess-org/chess-openings, CC0 / public domain).
//
// The dataset ships the ECO code, name, and PGN move text for ~3.5k opening
// lines (files a.tsv … e.tsv). We compute the resulting FEN for each line with
// the SAME chess.js the server uses at runtime, so the bundled FEN is byte-for-
// byte what `lookupOpening` will derive when replaying a game — that consistency
// is what makes FEN-based (transposition-robust) matching reliable.
//
// Usage:  node scripts/gen-openings.mjs
//
// We commit the generated TS module (not a JSON file) on purpose: `tsc` does not
// copy .json into dist/, and Node16 ESM JSON imports need import attributes — a
// generated .ts sidesteps both and keeps the Docker build offline/reproducible.

import { Chess } from 'chess.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const FILES = ['a', 'b', 'c', 'd', 'e'];
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';

/** Strip move numbers ("1.", "2...") and split a short PGN into SAN tokens. */
function sanTokens(pgn) {
  return pgn
    .split(/\s+/)
    .filter((t) => t && !/^\d+\.+$/.test(t));
}

/** Replay SAN tokens and return the final FEN, or null if any move is illegal. */
function fenFromPgn(pgn) {
  const chess = new Chess();
  for (const san of sanTokens(pgn)) {
    try {
      chess.move(san);
    } catch {
      return null;
    }
  }
  return chess.fen();
}

/**
 * Position identity key: placement + side-to-move + castling + en passant, where
 * ep is kept only when an ep capture is actually legal (chess.js writes a phantom
 * ep target on every double push) and the move counters are dropped. Must match
 * positionKey() in src/services/chess-utils.ts so de-dup uses the same identity.
 */
function positionKey(fen) {
  const [placement, side, castling, ep] = fen.split(' ');
  let epKey = '-';
  if (ep && ep !== '-') {
    const chess = new Chess(fen);
    if (chess.moves({ verbose: true }).some((m) => m.isEnPassant())) epKey = ep;
  }
  return `${placement} ${side} ${castling} ${epKey}`;
}

async function main() {
  const seen = new Set();
  const entries = [];
  let fetched = 0;
  let skipped = 0;

  for (const f of FILES) {
    const url = `${BASE}/${f}.tsv`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    const text = await res.text();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const [eco, name, pgn] = line.split('\t');
      // Skip the header row ("eco\tname\tpgn") and any malformed line.
      if (!eco || eco === 'eco' || !name || !pgn) continue;
      fetched++;

      const fen = fenFromPgn(pgn);
      if (!fen) {
        skipped++;
        console.error(`skip (illegal replay): ${eco} ${name} | ${pgn}`);
        continue;
      }

      const key = positionKey(fen);
      if (seen.has(key)) continue; // de-dup transposed/identical positions
      seen.add(key);
      entries.push({ eco, name, pgn, fen });
    }
  }

  const header = `// GENERATED FILE — do not edit by hand.
// Regenerate with:  node scripts/gen-openings.mjs
//
// Source: Lichess chess-openings database (https://github.com/lichess-org/chess-openings)
// License: CC0 1.0 Universal (public domain dedication).
// FENs computed with chess.js to match the server's runtime move replay.
//
// ${entries.length} opening positions (ECO A00–E99), de-duplicated by board position.

import type { OpeningInfo } from '../types.js';

export const OPENING_BOOK: OpeningInfo[] = [
`;

  const body = entries
    .map(
      (e) =>
        `  { eco: ${JSON.stringify(e.eco)}, name: ${JSON.stringify(e.name)}, pgn: ${JSON.stringify(
          e.pgn
        )}, fen: ${JSON.stringify(e.fen)} },`
    )
    .join('\n');

  const out = `${header}${body}\n];\n`;

  const here = dirname(fileURLToPath(import.meta.url));
  const target = resolve(here, '../src/services/openings-data.ts');
  writeFileSync(target, out, 'utf8');

  console.error(
    `Wrote ${entries.length} entries to ${target} (fetched ${fetched}, skipped ${skipped}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
