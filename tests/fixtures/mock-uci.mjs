// A real subprocess for server lifecycle tests; no chess binaries are needed.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const role = process.argv[2];
const directory = process.env.TEST_ENGINE_DIRECTORY;
appendFileSync(join(directory, `${role}.pids`), `${process.pid}\n`);
// Publish readiness only after the PID history is complete: the parent may
// terminate us as soon as it sees this marker during an early-disconnect test.
writeFileSync(join(directory, `${role}.pid`), String(process.pid));

if (process.env.TEST_ENGINE_IGNORE_QUIT === '1') {
  process.on('SIGTERM', () => {});
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line === 'uci' && process.env.TEST_ENGINE_STALL !== role) {
    process.stdout.write('id name lifecycle-test\nuciok\n');
  } else if (line === 'isready') {
    process.stdout.write('readyok\n');
  } else if (line.startsWith('go ')) {
    writeFileSync(join(directory, `${role}.searching`), 'true');
    // Stay in flight until shutdown so queued requests can also be tested.
  } else if (line === 'quit' && process.env.TEST_ENGINE_IGNORE_QUIT !== '1') {
    process.exit(0);
  }
});

// A stubborn engine must remain alive even when its input pipe closes.
setInterval(() => {}, 1_000);
