# Chess Engine MCP Server

A Model Context Protocol (MCP) server providing AI assistants with professional-grade chess analysis using **Stockfish** (alpha-beta) and optionally **Leela Chess Zero / Lc0** (neural network). Both engines share the same tool interface and run side-by-side when Lc0 is configured.

## Features

### Stockfish tools (always available)

| Tool | Description |
|------|-------------|
| `sf_analyse_position` | Analyse any position (FEN → evaluation + best moves + top lines) |
| `sf_analyse_game` | Full game analysis (PGN → move-by-move eval, accuracy %, error counts) |
| `sf_lookup_opening` | Search opening database by name or ECO code |
| `sf_identify_opening` | Identify the opening from moves or PGN |
| `sf_generate_puzzle` | Generate tactic puzzles from positions |

### Lc0 tools (enabled when `LC0_WEIGHTS_PATH` is set)

| Tool | Description |
|------|-------------|
| `lc0_analyse_position` | Analyse a position with the Lc0 neural network |
| `lc0_analyse_game` | Full game analysis using Lc0 evaluation |
| `lc0_generate_puzzle` | Generate tactic puzzles using Lc0's evaluation |

## Quick Start

### Option 1: Docker (recommended)

```bash
# Published image (Stockfish + Lc0 + Maia-1900 baked in; linux/amd64 + arm64)
docker run -i ghcr.io/alegerber/stockfish-lc0-mcp:latest

# …or build it yourself — Stockfish only
docker build -t stockfish-lc0-mcp .
docker run -i stockfish-lc0-mcp

# With Lc0 (mount weights file)
docker run -i \
  -e LC0_WEIGHTS_PATH=/weights/lc0.pb.gz \
  -v /path/to/weights:/weights \
  stockfish-lc0-mcp

# Or with docker compose
docker compose up --build
```

### Option 2: npm (npx)

Prerequisites: Node.js 22+, Stockfish binary installed (the npm package does **not** bundle the engines — the Docker image does).

```bash
# Install Stockfish
# macOS:  brew install stockfish
# Ubuntu: sudo apt install stockfish

npx stockfish-lc0-mcp
```

### Option 3: Local Node.js (from source)

Prerequisites: Node.js 22+ (CI-tested on LTS 22, 24, 26), Stockfish binary installed.

```bash
# Install Stockfish
# macOS:  brew install stockfish
# Ubuntu: sudo apt install stockfish
# Windows: download from https://stockfishchess.org/download/

# Install dependencies and build
npm install
npm run build

# Run (Stockfish only)
npm start

# Run with Lc0
LC0_WEIGHTS_PATH=/path/to/lc0.pb.gz npm start
```

## Configuration

### Stockfish environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STOCKFISH_PATH` | `stockfish` | Path to the Stockfish binary |
| `STOCKFISH_THREADS` | `2` | Number of CPU threads |
| `STOCKFISH_HASH` | `128` | Hash table size in MB |

### Lc0 environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LC0_WEIGHTS_PATH` | *(unset)* | Path to a `.pb.gz` weights file — **required to enable Lc0** |
| `LC0_PATH` | `lc0` | Path to the Lc0 binary |
| `LC0_BACKEND` | *(auto)* | Lc0 backend: `cuda`, `metal`, `cpu`, etc. |
| `LC0_THREADS` | `2` | Number of CPU threads for Lc0 |
| `LC0_HASH` | `128` | Hash table size in MB for Lc0 |

> **Note:** The `depth` parameter for Lc0 tools is mapped internally to node counts via an exponential table (100 nodes at depth 1 → 1 000 000 nodes at depth 30), since MCTS depth is not comparable to alpha-beta depth.

## Claude Desktop Integration

Add to your `claude_desktop_config.json`:

### Docker (Stockfish only)

```json
{
  "mcpServers": {
    "chess": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "stockfish-lc0-mcp"]
    }
  }
}
```

### Docker (Stockfish + Lc0)

```json
{
  "mcpServers": {
    "chess": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "LC0_WEIGHTS_PATH=/weights/lc0.pb.gz",
        "-v", "/path/to/weights:/weights",
        "stockfish-lc0-mcp"
      ]
    }
  }
}
```

### npm (npx)

Requires a locally installed Stockfish (see [Quick Start](#option-2-npm-npx)).

```json
{
  "mcpServers": {
    "chess": {
      "command": "npx",
      "args": ["-y", "stockfish-lc0-mcp"]
    }
  }
}
```

### Local Node.js

```json
{
  "mcpServers": {
    "chess": {
      "command": "node",
      "args": ["/path/to/stockfish-lc0-mcp/dist/index.js"],
      "env": {
        "STOCKFISH_PATH": "stockfish",
        "STOCKFISH_THREADS": "2",
        "STOCKFISH_HASH": "256",
        "LC0_PATH": "lc0",
        "LC0_WEIGHTS_PATH": "/path/to/lc0.pb.gz"
      }
    }
  }
}
```

## Usage Examples

### Stockfish

> "Analyse this position: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"

> "Review this game: 1. e4 e5 2. Qh5 Nc6 3. Nf3 g6 4. Qh4 Be7 ..."

> "What is the Wayward Queen Attack?"

> "What opening is 1. e4 e5 2. Nf3 Nc6 3. Bc4?"

> "Create a tactic puzzle from this position: [FEN]"

### Lc0

> "What does the neural network think of this position?"

> "Analyse this game with Lc0 and compare with Stockfish: 1. e4 e5 ..."

> "Find tactics using Lc0 in this position: [FEN]"

## Architecture

```
src/
├── index.ts              # MCP server entry, tool registration (Stockfish + Lc0)
├── types.ts              # TypeScript interfaces (UciEngine, UciLine, UciScore, …)
├── constants.ts          # Thresholds, defaults, LC0_DEPTH_TO_NODES mapping
├── schemas/
│   └── index.ts          # Zod input validation schemas
├── services/
│   ├── engine.ts         # BaseUciEngine, StockfishEngine, Lc0Engine
│   ├── chess-utils.ts    # chess.js wrapper (PGN/FEN/SAN/openings)
│   └── formatting.ts     # Markdown output formatting
└── tools/
    ├── analyse-position.ts  # Single position analysis
    ├── analyse-game.ts      # Full game analysis + accuracy model
    ├── openings.ts          # Opening lookup & identification
    └── puzzle.ts            # Tactic puzzle generation
```

Both engines implement the `UciEngine` interface and are interchangeable at the tool layer — all tool functions accept a `UciEngine` parameter, so `sf_*` and `lc0_*` tools share identical logic with different engine instances.

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → dist/
npm test             # Run unit tests (Vitest, 150+ tests)
npm run lint         # ESLint
```

## License

MIT
