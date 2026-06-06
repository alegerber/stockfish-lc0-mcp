// End-to-end smoke test for the Chess Engine MCP server.
//
// Unlike the Vitest integration tests (which exercise the StockfishEngine class
// directly), this drives the FULL stack the way a real client does: it spawns
// the built server (`dist/index.js`) as a child process and talks to it over the
// MCP stdio transport using the official SDK client — initialize handshake,
// tools/list, and a real tools/call against Stockfish.
//
// Usage:  npm run build && npm run smoke
// Env:    STOCKFISH_PATH (defaults to "stockfish"; CI sets /usr/games/stockfish)
//
// Exit code 0 = all checks passed, 1 = a check failed or the server misbehaved.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, '..', 'dist', 'index.js');
const EXPECTED_SF_TOOLS = [
  'sf_analyse_position',
  'sf_analyse_game',
  'sf_lookup_opening',
  'sf_identify_opening',
  'sf_generate_puzzle',
];
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const CALL_TIMEOUT_MS = 30_000;
const OVERALL_TIMEOUT_MS = 90_000;

let checks = 0;
function assert(cond, message) {
  checks++;
  if (!cond) throw new Error(`assertion failed: ${message}`);
  console.error(`  ✓ ${message}`);
}

async function run() {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`server build not found at ${SERVER_ENTRY} — run "npm run build" first`);
  }

  const transport = new StdioClientTransport({
    command: process.execPath, // the current node binary
    args: [SERVER_ENTRY],
    // Pass through the environment so the child can find node/stockfish on PATH.
    env: { ...process.env, STOCKFISH_PATH: process.env.STOCKFISH_PATH ?? 'stockfish' },
    stderr: 'inherit', // surface the server's diagnostic logs in CI output
  });

  const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    console.error('→ connected (initialize handshake OK)');

    // 1) tools/list must advertise all five always-on Stockfish tools.
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const expected of EXPECTED_SF_TOOLS) {
      assert(names.has(expected), `tools/list advertises ${expected}`);
    }

    // 2) A non-engine tool path: opening lookup returns a known opening.
    const lookup = await client.callTool(
      { name: 'sf_lookup_opening', arguments: { query: 'Italian' } },
      undefined,
      { timeout: CALL_TIMEOUT_MS }
    );
    assert(lookup.isError !== true, 'sf_lookup_opening returned a non-error result');
    assert(
      JSON.stringify(lookup.structuredContent ?? {}).toLowerCase().includes('italian'),
      'sf_lookup_opening found the Italian Game'
    );

    // 3) The real engine path: analyse the starting position at a shallow depth.
    const analyse = await client.callTool(
      { name: 'sf_analyse_position', arguments: { fen: START_FEN, depth: 8, multiPv: 1 } },
      undefined,
      { timeout: CALL_TIMEOUT_MS }
    );
    assert(analyse.isError !== true, 'sf_analyse_position returned a non-error result');

    const sc = analyse.structuredContent ?? {};
    assert(typeof sc.bestMove === 'string' && UCI_MOVE.test(sc.bestMove),
      `sf_analyse_position returned a valid UCI bestMove (got "${sc.bestMove}")`);
    assert(sc.evaluation !== undefined, 'sf_analyse_position returned an evaluation');
    assert(Array.isArray(sc.lines) && sc.lines.length >= 1,
      'sf_analyse_position returned at least one analysis line');
  } finally {
    await client.close().catch(() => {});
  }
}

const overall = setTimeout(() => {
  console.error(`✗ smoke test exceeded ${OVERALL_TIMEOUT_MS}ms — aborting`);
  process.exit(1);
}, OVERALL_TIMEOUT_MS);
overall.unref();

run()
  .then(() => {
    console.error(`\n✓ smoke test passed (${checks} checks)`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n✗ smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
