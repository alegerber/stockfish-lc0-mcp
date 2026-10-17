// Regression checks for Docker stdio disconnects. Each test owns one bounded
// container and removes only that container on failure. No engine installation
// is needed on the host. Build the image first, then run:
// LIFECYCLE_DOCKER_IMAGE=stockfish-lc0-mcp npm run test:lifecycle:docker
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const image = process.env.LIFECYCLE_DOCKER_IMAGE;
if (!image) throw new Error('Set LIFECYCLE_DOCKER_IMAGE to the image to test');
const runId = randomUUID();
const cases = process.env.LIFECYCLE_CASES?.split(',') ?? [
  'startup', 'idle', 'analysis', 'killed-client',
  ...Array.from({ length: 5 }, () => 'idle'),
];
const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 10_000 }).trim();
}

async function waitFor(check, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(message());
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function checkDisconnect(mode, index) {
  assert(['startup', 'idle', 'analysis', 'killed-client'].includes(mode), `Unknown case: ${mode}`);
  const name = `mcp-lifecycle-${runId}-${index}`;
  const exists = () => docker(['ps', '-aq', '--filter', `name=^/${name}$`]) !== '';
  const client = spawn('docker', [
    'run', '-i', '--rm', '--name', name, '--label', `mcp-lifecycle-test=${runId}`,
    '--network', 'none', '--memory', '768m', '--memory-swap', '768m',
    '--cpus', '2', '--pids-limit', '128', image,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let spawnError;
  client.on('error', (error) => { spawnError = error; });
  client.stdout.on('data', (data) => { stdout += data; });
  client.stderr.on('data', (data) => { stderr += data; });
  client.stdin.on('error', () => {});
  const send = (message) => client.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  // A pipe chunk can end in the middle of a JSON-RPC response.
  const response = (id) => stdout.split('\n').slice(0, -1).filter(Boolean)
    .map((line) => JSON.parse(line)).find((message) => message.id === id);
  try {
    send({ id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'docker-lifecycle-test', version: '1.0.0' },
    } });
    if (mode === 'startup') {
      await waitFor(() => stderr.includes('Initialising Stockfish'), () => `Startup failed: ${spawnError ?? stderr}`);
    } else {
      await waitFor(() => response(1), () => `Handshake failed: ${spawnError ?? stderr}`, 30_000);
      assert(response(1)?.result, 'MCP initialization succeeds');
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/call', params: {
        name: 'sf_analyse_position', arguments: { fen: startFen, depth: mode === 'analysis' ? 30 : 4 },
      } });
      if (mode === 'analysis') {
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert(!response(2), `Analysis must still be in flight at disconnect: ${JSON.stringify(response(2))}`);
      } else {
        await waitFor(() => response(2), () => `Analysis failed: ${stderr}`, 30_000);
        assert.equal(response(2)?.result?.isError, undefined);
        assert.match(response(2)?.result?.structuredContent?.bestMove ?? '', /^[a-h][1-8][a-h][1-8][qrbn]?$/);
      }
    }

    if (mode === 'killed-client') client.kill('SIGKILL');
    else client.stdin.end();
    await waitFor(() => !exists(), () => `Container survived ${mode}: ${name}\n${stderr}`);
    await waitFor(() => client.exitCode !== null || client.signalCode !== null, () => 'Docker client did not exit');
    if (mode !== 'killed-client') assert.equal(client.exitCode, 0, stderr);
    console.error(`PASS ${index + 1}: ${mode}; container removed`);
  } finally {
    // Explicit fallback is essential when testing the unfixed image.
    if (exists()) docker(['rm', '-f', name]);
    client.stdin.destroy();
    if (client.exitCode === null && client.signalCode === null) client.kill('SIGKILL');
  }
}

for (const [index, mode] of cases.entries()) await checkDisconnect(mode, index);
assert.equal(docker(['ps', '-aq', '--filter', `label=mcp-lifecycle-test=${runId}`]), '');
console.error(`${cases.length} Docker lifecycle checks passed; no test containers remain`);
