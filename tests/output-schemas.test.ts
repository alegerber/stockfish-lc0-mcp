import { describe, it, expect, vi } from 'vitest';
import type { ZodType } from 'zod';
import {
  AnalysePositionOutput,
  AnalyseGameOutput,
  LookupOpeningOutput,
  IdentifyOpeningOutput,
  GeneratePuzzleOutput,
} from '../src/schemas/index.js';
import { analysePosition } from '../src/tools/analyse-position.js';
import { analyseGame } from '../src/tools/analyse-game.js';
import { lookupOpeningByQuery, identifyOpeningFromPgn } from '../src/tools/openings.js';
import { generatePuzzle } from '../src/tools/puzzle.js';
import type { UciEngine, PositionAnalysis, UciLine } from '../src/types.js';

// Mirrors the MCP SDK's validateToolOutput: structuredContent (the tool's json)
// must safeParse against the declared outputSchema, or the SDK throws at runtime.
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function expectValid(schema: ZodType, json: unknown): void {
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new Error('structuredContent failed its outputSchema: ' + JSON.stringify(result.error.issues, null, 2));
  }
  expect(result.success).toBe(true);
}

const line = (overrides: Partial<UciLine> = {}): UciLine => ({
  depth: 20,
  score: { type: 'cp', value: 30 },
  pv: ['e2e4', 'e7e5'],
  pvSan: ['e4', 'e5'],
  nodes: 1000,
  nps: 1000,
  time: 1,
  multipv: 1,
  ...overrides,
});

function engineWith(lines: UciLine[]): UciEngine {
  return {
    displayName: 'Mock',
    init: vi.fn(),
    quit: vi.fn(),
    bestMove: vi.fn(async () => lines[0]?.pv[0] ?? 'e2e4'),
    analyse: vi.fn(
      async (fen: string, depth: number): Promise<PositionAnalysis> => ({
        fen,
        depth,
        bestMove: lines[0]?.pv[0] ?? 'e2e4',
        evaluation: lines[0]?.score ?? { type: 'cp', value: 20 },
        lines,
      })
    ),
  };
}

describe('tool structuredContent validates against its declared outputSchema (#15 L5)', () => {
  it('analyse_position', async () => {
    const { json } = await analysePosition(engineWith([line({ multipv: 1 }), line({ multipv: 2 })]), START_FEN, 14, 2);
    expectValid(AnalysePositionOutput, json);
  });

  it('analyse_game — normal game', async () => {
    const { json } = await analyseGame(engineWith([line()]), '1. e4 e5', 12);
    expect(typeof json.whiteAccuracy).toBe('number');
    expectValid(AnalyseGameOutput, json);
  });

  it('analyse_game — no analysable moves (whiteAccuracy = n/a variant)', async () => {
    const failing: UciEngine = {
      displayName: 'Fails',
      init: vi.fn(),
      bestMove: vi.fn(async () => 'e2e4'),
      quit: vi.fn(),
      analyse: vi.fn(async () => {
        throw new Error('down');
      }),
    };
    const { json } = await analyseGame(failing, '1. e4 e5', 12);
    expect(json.whiteAccuracy).toBe('n/a'); // exercises the union branch
    expectValid(AnalyseGameOutput, json);
  });

  it('lookup opening — found and not-found variants', () => {
    const found = lookupOpeningByQuery('Sicilian');
    expect((found.json.results as unknown[]).length).toBeGreaterThan(0);
    expectValid(LookupOpeningOutput, found.json);

    const none = lookupOpeningByQuery('zzz-not-an-opening-xyz');
    expect((none.json.results as unknown[]).length).toBe(0); // no-count variant
    expectValid(LookupOpeningOutput, none.json);
  });

  it('identify opening — identified and not-identified variants', () => {
    const yes = identifyOpeningFromPgn('1. e4 c5');
    expect(yes.json.identified).toBe(true);
    expectValid(IdentifyOpeningOutput, yes.json);

    // Almost every legal first move is now a named opening, so the only
    // not-identified path is input with no legal replay. The tokens still
    // populate the optional `moves` field of the not-identified variant.
    const no = identifyOpeningFromPgn('not a real opening');
    expect(no.json.identified).toBe(false); // exercises the optional `moves` field
    expectValid(IdentifyOpeningOutput, no.json);
  });

  it('generate_puzzle — tactic and no-tactic variants', async () => {
    const tactic = await generatePuzzle(
      engineWith([line({ score: { type: 'cp', value: 600 } }), line({ score: { type: 'cp', value: 30 }, multipv: 2 })]),
      START_FEN,
      14
    );
    expect(tactic.json.hasTactic).toBe(true);
    expectValid(GeneratePuzzleOutput, tactic.json);

    const quiet = await generatePuzzle(engineWith([line({ score: { type: 'cp', value: 40 } })]), START_FEN, 14);
    expect(quiet.json.hasTactic).toBe(false); // no-tactic variant
    expectValid(GeneratePuzzleOutput, quiet.json);
  });
});
