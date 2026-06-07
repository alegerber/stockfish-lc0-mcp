// End-to-end smoke test for the Chess Engine MCP server.
//
// Unlike the Vitest integration tests (which exercise the StockfishEngine class
// directly), this drives the FULL stack the way a real client does: it spawns
// the server as a child process and talks to it over the MCP stdio transport
// using the official SDK client — initialize handshake, tools/list, real
// tools/call against Stockfish, and (when available) against Lc0.
//
// Two modes:
//   • Local build (default):  npm run build && npm run smoke
//       spawns `node dist/index.js`; Stockfish-only unless LC0_WEIGHTS_PATH is set.
//   • Full Docker image:      npm run smoke:docker
//       sets SMOKE_DOCKER_IMAGE so the client drives `docker run -i --rm <image>`.
//       The image ships Lc0 + the Maia-1900 network with Lc0 enabled by default,
//       so the lc0_* tools register and get exercised here.
//
// Env:
//   STOCKFISH_PATH      (local mode) path to the Stockfish binary; default "stockfish"
//   SMOKE_DOCKER_IMAGE  if set, drive the containerised server instead of dist/index.js
//
// The lc0_* checks run only when the server advertises those tools, so the
// Stockfish-only CI smoke stays green. Exit 0 = all checks passed, 1 = failure.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, '..', 'dist', 'index.js');
const DOCKER_IMAGE = process.env.SMOKE_DOCKER_IMAGE;
const EXPECTED_SF_TOOLS = [
  'sf_analyse_position',
  'sf_analyse_game',
  'sf_lookup_opening',
  'sf_identify_opening',
  'sf_generate_puzzle',
];
const LC0_TOOLS = ['lc0_analyse_position', 'lc0_analyse_game', 'lc0_generate_puzzle'];
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const CALL_TIMEOUT_MS = 30_000;
// Generous overall budget: the Docker container has a cold start and Lc0 loads
// its neural-network weights before the server connects its transport.
const OVERALL_TIMEOUT_MS = DOCKER_IMAGE ? 180_000 : 90_000;

let checks = 0;
function assert(cond, message) {
  checks++;
  if (!cond) throw new Error(`assertion failed: ${message}`);
  console.error(`  ✓ ${message}`);
}

/** Spawn either the containerised server or the locally-built one. */
function buildTransport() {
  if (DOCKER_IMAGE) {
    console.error(`→ driving containerised server: docker run -i --rm ${DOCKER_IMAGE}`);
    return new StdioClientTransport({
      command: 'docker',
      args: ['run', '-i', '--rm', DOCKER_IMAGE],
      // env is for the docker CLI; the container's own ENV (incl. LC0_WEIGHTS_PATH)
      // is baked into the image.
      env: { ...process.env },
      stderr: 'inherit',
    });
  }
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`server build not found at ${SERVER_ENTRY} — run "npm run build" first`);
  }
  console.error(`→ driving local server: ${process.execPath} ${SERVER_ENTRY}`);
  return new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: { ...process.env, STOCKFISH_PATH: process.env.STOCKFISH_PATH ?? 'stockfish' },
    stderr: 'inherit',
  });
}

async function checkAnalysePosition(client, toolName) {
  const res = await client.callTool(
    { name: toolName, arguments: { fen: START_FEN, depth: toolName.startsWith('lc0') ? 4 : 8, multiPv: 1 } },
    undefined,
    { timeout: CALL_TIMEOUT_MS }
  );
  assert(res.isError !== true, `${toolName} returned a non-error result`);
  const sc = res.structuredContent ?? {};
  assert(typeof sc.bestMove === 'string' && UCI_MOVE.test(sc.bestMove),
    `${toolName} returned a valid UCI bestMove (got "${sc.bestMove}")`);
  assert(sc.evaluation !== undefined, `${toolName} returned an evaluation`);
  assert(Array.isArray(sc.lines) && sc.lines.length >= 1,
    `${toolName} returned at least one analysis line`);
}

async function checkAnalyseGame(client, toolName) {
  const res = await client.callTool(
    {
      name: toolName,
      arguments: { pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6', depth: toolName.startsWith('lc0') ? 4 : 8 },
    },
    undefined,
    { timeout: CALL_TIMEOUT_MS }
  );
  assert(res.isError !== true, `${toolName} returned a non-error result`);
  const sc = res.structuredContent ?? {};
  assert(sc.whiteAccuracy !== undefined && sc.blackAccuracy !== undefined,
    `${toolName} returned white/black accuracy`);
  assert(Array.isArray(sc.moves) && sc.moves.length >= 1,
    `${toolName} returned per-move analysis`);
  assert(sc.summary !== null && typeof sc.summary === 'object',
    `${toolName} returned a summary`);
}

async function checkGeneratePuzzle(client, toolName) {
  const res = await client.callTool(
    { name: toolName, arguments: { fen: START_FEN, depth: toolName.startsWith('lc0') ? 4 : 8 } },
    undefined,
    { timeout: CALL_TIMEOUT_MS }
  );
  assert(res.isError !== true, `${toolName} returned a non-error result`);
  const sc = res.structuredContent ?? {};
  assert(typeof sc.hasTactic === 'boolean', `${toolName} returned a hasTactic flag`);
  // Either a tactic (with a solution) or a quiet position (with a best move).
  assert(sc.hasTactic ? Array.isArray(sc.solution) : typeof sc.bestMove === 'string',
    `${toolName} returned a coherent puzzle / no-tactic payload`);
}

async function checkIdentifyOpening(client) {
  const res = await client.callTool(
    { name: 'sf_identify_opening', arguments: { pgn: '1. e4 c5' } },
    undefined,
    { timeout: CALL_TIMEOUT_MS }
  );
  assert(res.isError !== true, 'sf_identify_opening returned a non-error result');
  const sc = res.structuredContent ?? {};
  assert(sc.identified === true, 'sf_identify_opening identified 1. e4 c5');
  assert(JSON.stringify(sc).toLowerCase().includes('sicilian'),
    'sf_identify_opening recognised the Sicilian');
}

async function run() {
  const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(buildTransport());
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
    await checkIdentifyOpening(client);

    // 3) Every Stockfish engine tool, end-to-end (each call also exercises the
    //    server-side outputSchema validation against real engine output).
    await checkAnalysePosition(client, 'sf_analyse_position');
    await checkAnalyseGame(client, 'sf_analyse_game');
    await checkGeneratePuzzle(client, 'sf_generate_puzzle');

    // 4) The Lc0 path — only when the server advertises the lc0_* tools (full
    //    Docker image / LC0_WEIGHTS_PATH set). Skipped cleanly otherwise.
    if (names.has('lc0_analyse_position')) {
      for (const t of LC0_TOOLS) assert(names.has(t), `tools/list advertises ${t}`);
      await checkAnalysePosition(client, 'lc0_analyse_position');
      await checkAnalyseGame(client, 'lc0_analyse_game');
      await checkGeneratePuzzle(client, 'lc0_generate_puzzle');
    } else {
      console.error('  • Lc0 not enabled — skipping lc0_* checks '
        + '(set LC0_WEIGHTS_PATH, or run with SMOKE_DOCKER_IMAGE=stockfish-lc0-mcp)');
    }
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
