import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

// The existing engine reliability tests also require Unix executables (`cat`).
// Here a process group lets failure cleanup kill only this test's descendants.
describe.skipIf(process.platform === 'win32')('stdio server lifecycle', () => {
  let suiteDirectory: string;

  beforeAll(() => {
    suiteDirectory = mkdtempSync(join(root, 'node_modules', '.lifecycle-'));
    writeFileSync(join(suiteDirectory, 'package.json'), '{"type":"module"}');
    execFileSync(process.execPath, [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--outDir', join(suiteDirectory, 'dist'),
      '--declaration', 'false', '--declarationMap', 'false', '--sourceMap', 'false',
    ], { cwd: root, timeout: 30_000 });
  }, 35_000);

  afterAll(() => {
    if (suiteDirectory) rmSync(suiteDirectory, { recursive: true, force: true });
  });

  async function waitFor(condition: () => boolean, message: () => string): Promise<void> {
    const deadline = Date.now() + 4_000;
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error(message());
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  function isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  async function withServer(
    environment: Record<string, string>,
    test: (server: ChildProcessWithoutNullStreams, directory: string, output: () => string) => Promise<void>,
    expectedExitCode = 0,
  ): Promise<void> {
    const directory = mkdtempSync(join(suiteDirectory, 'case-'));
    for (const role of ['sf', 'lc0']) {
      const executable = join(directory, role);
      writeFileSync(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(root, 'tests/fixtures/mock-uci.mjs'))} ${role}\n`);
      chmodSync(executable, 0o755);
    }
    const server = spawn(process.execPath, [join(suiteDirectory, 'dist/index.js')], {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        STOCKFISH_PATH: join(directory, 'sf'),
        LC0_PATH: join(directory, 'lc0'),
        LC0_WEIGHTS_PATH: 'test-weights',
        ENGINE_TIMEOUT_MS: '30000',
        TEST_ENGINE_DIRECTORY: directory,
        ...environment,
      },
    });
    let stdout = '';
    let stderr = '';
    server.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    server.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    server.stdin.on('error', () => {});
    try {
      await test(server, directory, () => stdout);
      await waitFor(() => server.exitCode !== null || server.signalCode !== null,
        () => `Server did not exit after disconnect:\n${stderr}`);
      expect(server.signalCode).toBeNull();
      expect(server.exitCode).toBe(expectedExitCode);
      for (const role of ['sf', 'lc0']) {
        const pidFile = join(directory, `${role}.pids`);
        if (existsSync(pidFile)) {
          const pids = readFileSync(pidFile, 'utf8').trim().split('\n').map(Number);
          for (const pid of pids) {
            expect(pid).toBeGreaterThan(1);
            await waitFor(() => !isAlive(pid), () => `Orphaned ${role} process ${pid}`);
          }
          expect(pids).toHaveLength(1);
        }
      }
    } finally {
      // Reap a regression without leaving test servers/engines behind.
      if (server.pid) {
        try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      server.stdin.destroy();
      if (server.exitCode === null && server.signalCode === null) {
        await new Promise<void>((resolve) => server.once('exit', () => resolve()));
      }
    }
  }

  async function initialize(server: ChildProcessWithoutNullStreams, output: () => string): Promise<void> {
    // Send before engine startup completes: startup must retain these bytes.
    server.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'lifecycle-test', version: '1.0.0' },
      },
    }) + '\n');
    const response = (): { id?: number; result?: { serverInfo?: unknown } } | undefined =>
      output().split('\n').slice(0, -1).filter(Boolean).map((line) => JSON.parse(line))
        .find((message: { id?: number }) => message.id === 1);
    await waitFor(() => response() !== undefined, () => `No initialization response: ${output()}`);
    expect(response()?.result?.serverInfo).toBeDefined();
    server.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  }

  it('exits and reaps both engines when an initialized client closes stdin', async () => {
    await withServer({}, async (server, _directory, output) => {
      await initialize(server, output);
      server.stdin.end();
    });
  }, 10_000);

  it.each(['sf', 'lc0'])('handles EOF during %s startup with buffered client input', async (role) => {
    await withServer({ TEST_ENGINE_STALL: role }, async (server, directory) => {
      server.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
      await waitFor(() => existsSync(join(directory, `${role}.pid`)), () => `${role} did not start`);
      server.stdin.end();
    });
  }, 10_000);

  it('stops active analysis without restarting engines for queued requests', async () => {
    await withServer({}, async (server, directory, output) => {
      await initialize(server, output);
      for (const id of [2, 3, 4]) {
        server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: {
          name: 'sf_analyse_position', arguments: { fen: START_FEN, depth: 10 },
        } }) + '\n');
      }
      await waitFor(() => existsSync(join(directory, 'sf.searching')), () => 'Analysis did not start');
      server.stdin.end();
    });
  }, 10_000);

  it.each(['SIGINT', 'SIGTERM'] as const)('handles %s during engine startup', async (signal) => {
    await withServer({ TEST_ENGINE_STALL: 'sf' }, async (server, directory) => {
      await waitFor(() => existsSync(join(directory, 'sf.pid')), () => 'Stockfish did not start');
      server.kill(signal);
    });
  }, 10_000);

  it('reaps Stockfish when Lc0 fails to start', async () => {
    await withServer({ LC0_PATH: '/nonexistent/lifecycle-lc0' }, async () => {}, 1);
  }, 10_000);

  it('forcibly reaps engines that ignore quit and SIGTERM', async () => {
    await withServer({ TEST_ENGINE_IGNORE_QUIT: '1' }, async (server, _directory, output) => {
      await initialize(server, output);
      server.stdin.end();
    });
  }, 10_000);
});
