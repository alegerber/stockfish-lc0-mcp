# AGENTS.md — Chess Engine MCP Server (Stockfish + Lc0)

## Project Overview

MCP server wrapping UCI chess engines (Stockfish and Leela Chess Zero). Provides 8 tools for chess analysis over the Model Context Protocol stdio transport. Written in TypeScript (strict mode), runs on Node.js 24+, deployed via Docker.

Both engines are enabled by default in Docker. Lc0 ships with the Maia-1900 neural network and uses the OpenBLAS CPU backend. Stockfish tools (`sf_*`) are always available. Lc0 tools (`lc0_*`) are conditionally registered when `LC0_WEIGHTS_PATH` is set (enabled by default in Docker).

## Architecture

```
src/
├── index.ts              # Entry point: MCP server setup, tool registration, lifecycle
├── types.ts              # UciEngine interface, all TypeScript types, centipawns() helper
├── constants.ts          # Thresholds, defaults, starting FEN, Lc0 depth-to-nodes map
├── schemas/
│   └── index.ts          # Zod input schemas for all tools
├── services/
│   ├── engine.ts         # BaseUciEngine, StockfishEngine, Lc0Engine (spawn, send, parse)
│   ├── chess-utils.ts    # chess.js utilities: PGN parsing, FEN validation, opening book
│   └── formatting.ts     # Markdown formatting for analysis output
└── tools/
    ├── analyse-position.ts  # sf/lc0_analyse_position — single FEN analysis
    ├── analyse-game.ts      # sf/lc0_analyse_game — full PGN move-by-move analysis
    ├── openings.ts          # sf_lookup_opening, sf_identify_opening
    └── puzzle.ts            # sf/lc0_generate_puzzle — tactic puzzle generation
tests/
├── chess-utils.test.ts
├── formatting.test.ts
├── schemas.test.ts
├── constants.test.ts
├── types.test.ts
├── tools-openings.test.ts
├── tools-analyse-position.test.ts
├── tools-analyse-game.test.ts
└── tools-puzzle.test.ts
```

### Key design decisions

- **UciEngine interface**: All tools accept a `UciEngine` interface, not a concrete engine class. This allows Stockfish and Lc0 tools to share the same tool implementations.
- **BaseUciEngine abstract class**: Shared UCI protocol logic (process spawn, `sendAndWait`, info line parsing) lives in `BaseUciEngine`. Subclasses (`StockfishEngine`, `Lc0Engine`) override `configureOptions()` and `buildGoCommand()`.
- **Side-by-side tools**: Stockfish (`sf_*`) and Lc0 (`lc0_*`) tools are registered in parallel. Opening tools (`sf_lookup_opening`, `sf_identify_opening`) are engine-agnostic and shared.
- **Lc0 depth-to-nodes mapping**: Lc0 uses MCTS, where "depth" means something fundamentally different from alpha-beta depth. The `depth` parameter is mapped to node counts via `LC0_DEPTH_TO_NODES` in constants.ts for consistent UX.
- **WDL parsing**: The UCI info line parser extracts Lc0's native `wdl W D L` data when present, stored in `UciLine.wdl`.
- **Engine as long-lived process**: Each engine spawns one child process and reuses it across all tool calls. Commands are sent via UCI protocol over stdin/stdout.
- **Dual output**: Every tool returns both `content` (Markdown text for display) and `structuredContent` (JSON for programmatic use).
- **Eval perspective**: Both engines report scores from the side-to-move's perspective. Code that compares evals across moves must negate when the side-to-move changes. This is the most bug-prone area.
- **Win-probability accuracy model**: Game analysis uses the Lichess win-probability formula (`1 / (1 + exp(-0.00368208 * cp))`) to compute per-move accuracy. Note: this was calibrated for Stockfish evals; Lc0 accuracy percentages may differ in calibration.
- **Terminal positions**: Checkmate/stalemate/draw positions are detected before engine analysis to avoid garbage evals.

## Build & Run

```bash
# Build TypeScript
npm run build          # tsc → ./dist/

# Run locally (requires stockfish on PATH)
npm start

# Run with Lc0 enabled (requires lc0 on PATH + weights file)
LC0_WEIGHTS_PATH=/path/to/weights.pb.gz npm start

# Docker (recommended — both engines enabled by default)
docker compose up --build
docker run -i --rm stockfish-lc0-mcp
```

## Module System

ESM throughout. All local imports use `.js` extensions (e.g., `'./services/engine.js'`). TypeScript compiles to `./dist/` with `"module": "Node16"`.

## Environment Variables

### Stockfish (always enabled)

| Variable | Default | Notes |
|---|---|---|
| `STOCKFISH_PATH` | `stockfish` | Full path in Docker: `/usr/games/stockfish` |
| `STOCKFISH_THREADS` | `2` | UCI Threads option |
| `STOCKFISH_HASH` | `128` | UCI Hash option (MB) |

### Lc0 (optional — set `LC0_WEIGHTS_PATH` to enable)

| Variable | Default | Notes |
|---|---|---|
| `LC0_PATH` | `lc0` | Path to the Lc0 binary |
| `LC0_WEIGHTS_PATH` | _(empty)_ | **Required** to enable Lc0. Path to the neural network weights file (.pb.gz) |
| `LC0_BACKEND` | _(auto)_ | Lc0 backend: `cuda`, `cudnn`, `opencl`, `eigen`, `multiplexing`, etc. |
| `LC0_THREADS` | `2` | UCI Threads option |
| `LC0_HASH` | `128` | UCI Hash option (MB) |

## Tools

### Stockfish tools (always available)
- `sf_analyse_position` — Analyse a single FEN position
- `sf_analyse_game` — Analyse a full PGN game move-by-move
- `sf_lookup_opening` — Search opening database by name/ECO
- `sf_identify_opening` — Identify opening from moves/PGN
- `sf_generate_puzzle` — Generate tactic puzzle from position

### Lc0 tools (available when `LC0_WEIGHTS_PATH` is set)
- `lc0_analyse_position` — Analyse a single FEN position with Lc0
- `lc0_analyse_game` — Analyse a full PGN game with Lc0
- `lc0_generate_puzzle` — Generate tactic puzzle with Lc0

## Common Pitfalls

1. **Eval normalisation**: Both engines report scores from the side-to-move's perspective. When computing eval drop between positions, the score after a move is from the opponent's POV and must be negated. Failing to do this produces inverted accuracy and wrong move classifications.

2. **PV move validation**: The engine's principal variation can contain moves that `chess.js` rejects (edge cases at low depth or in unusual positions). Always validate each UCI move through `chess.js` before adding to SAN arrays, and break on the first failure.

3. **Dynamic imports**: Do not use `await import('chess.js')` inside loops. Use static imports at module top.

4. **Docker binary path**: The Debian `stockfish` package installs to `/usr/games/stockfish`, which is not on the default PATH in `node:24-slim`. `STOCKFISH_PATH` must be the absolute path.

5. **Terminal positions**: The engine cannot meaningfully analyse checkmate/stalemate positions. Detect these with `chess.js` before calling `engine.analyse()`.

6. **Lc0 depth vs nodes**: Lc0 uses MCTS where "depth" is average tree depth, not alpha-beta plies. Never pass `go depth N` to Lc0 directly — the `Lc0Engine.buildGoCommand()` maps depth to node counts via `LC0_DEPTH_TO_NODES`. Adjusting this mapping changes analysis quality/speed.

7. **Lc0 accuracy calibration**: The Lichess win-probability formula was calibrated for Stockfish centipawn scores. Lc0's centipawn values have different calibration, so accuracy percentages from `lc0_analyse_game` may not be directly comparable to Stockfish results. Lc0's native WDL data (parsed into `UciLine.wdl`) could provide more accurate win probabilities in future.

8. **Lc0 weights file**: Lc0 requires a neural network weights file. Without `LC0_WEIGHTS_PATH` set, Lc0 tools are not registered and the Lc0 engine is not started. The Docker image ships with the Maia-1900 network (~25MB) at `/usr/share/lc0/maia-1900.pb.gz`. To use a different network, set `LC0_WEIGHTS_PATH` to the desired file path.

## Testing

Tests use **Vitest** (`npm test`). 150+ unit tests across 10 files, no engine binary required — all tool tests use a mock `UciEngine` via `vi.fn()`.

```bash
npm test        # run all tests once
npm run lint    # ESLint (TypeScript rules configured in eslint.config.js)
```

### Test files

| File | What it covers |
|---|---|
| `tests/chess-utils.test.ts` | `isValidFen`, `uciToSan`, `lookupOpening`, `searchOpenings`, `isGameOver`, `parsePgn` |
| `tests/formatting.test.ts` | `formatScore`, `formatPositionAnalysis`, `formatGameAnalysis` |
| `tests/schemas.test.ts` | Zod schema validation: bounds, required fields, unknown field rejection |
| `tests/constants.test.ts` | `LC0_DEPTH_TO_NODES` shape/monotonicity, threshold ordering, default/max values |
| `tests/types.test.ts` | `centipawns()` — cp passthrough, positive/negative mate conversions |
| `tests/tools-openings.test.ts` | `lookupOpeningByQuery`, `identifyOpeningFromPgn` — found/not-found/ECO/headers |
| `tests/tools-analyse-position.test.ts` | `analysePosition` — invalid FEN error, JSON structure, PV SAN enrichment, engine call args |
| `tests/tools-analyse-game.test.ts` | `analyseGame` — empty PGN error, accuracy model (per-side perspective), classification taxonomy + book moves, move fields, opening detection, summary counts |
| `tests/tools-puzzle.test.ts` | `generatePuzzle` — invalid FEN/no-lines errors, difficulty classification, tactic gate, spoiler format; `detectTheme` — every theme branch |
| `tests/engine.test.ts` | `BaseUciEngine` reliability — configurable timeout, `quit()` rejecting an in-flight operation, already-aborted-signal rejection (stubbed engine) |

### Mock engine pattern

```ts
function makeEngine(overrides: Partial<PositionAnalysis> = {}): UciEngine {
  return {
    displayName: 'MockEngine',
    init: vi.fn(),
    analyse: vi.fn(async (fen) => ({ fen, bestMove: 'e2e4', evaluation: { type: 'cp', value: 30 }, lines: [...], depth: 20, ...overrides })),
    bestMove: vi.fn(async () => 'e2e4'),
    quit: vi.fn(),
  };
}
```

Engine integration tests (real Stockfish subprocess) live in `tests/integration.test.ts` and run via `npm run test:integration`. They auto-skip when no Stockfish binary is found — availability is probed with a real UCI handshake — so they stay out of the default `npm test` run. CI exercises them in a dedicated job with Stockfish installed.

### End-to-end smoke test

To verify tools work against a real engine, send JSON-RPC messages to the Docker container over stdin:

```bash
docker run -i --rm stockfish-lc0-mcp <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sf_analyse_position","arguments":{"fen":"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1","depth":10,"multiPv":2}}}
EOF
```

Diagnostic output goes to stderr. JSON-RPC responses go to stdout.

## Dependencies

| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server framework, stdio transport |
| `chess.js` | PGN parsing, FEN validation, move generation, SAN conversion |
| `zod` | Input schema validation for all tools |
| `typescript` | Build-time compiler |

## Code Style

- TypeScript strict mode; ESLint with `@typescript-eslint` rules (`eslint.config.js`)
- Explicit return types on exported functions
- `console.error()` for all logging (stdout is reserved for MCP JSON-RPC)
