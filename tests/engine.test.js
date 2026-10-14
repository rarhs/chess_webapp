// Runs the real Stockfish WASM build (same file the site ships) under Node and
// checks that every difficulty level returns a legal move the game accepts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Engine, LEVELS } from '../src/engine.js';
import { Game } from '../src/game.js';

function processTransport() {
  const dir = join(process.cwd(), 'node_modules', 'stockfish', 'src');
  const file = readdirSync(dir).find((f) => /lite-single-[0-9a-f]+\.js$/.test(f));
  const child = spawn(process.execPath, [join(dir, file)], { stdio: ['pipe', 'pipe', 'inherit'] });
  let handler = () => {};
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      handler(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  return {
    post: (cmd) => child.stdin.write(cmd + '\n'),
    onLine: (fn) => { handler = fn; },
    close: () => child.kill(),
  };
}

describe('Stockfish engine', () => {
  let engine;
  beforeAll(async () => {
    engine = new Engine(processTransport());
    await engine.ready;
  }, 60000);
  afterAll(() => engine?.quit());

  for (const lv of LEVELS) {
    it(`level ${lv.id} (${lv.name}) returns a legal move`, async () => {
      const g = new Game('r1bqk2r/pppp1ppp/2n2n2/8/1bBPP3/5N2/PP3PPP/RNBQK2R w KQkq - 1 7');
      const uci = await engine.bestMove(g.fen, lv);
      expect(uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
      expect(g.moveUci(uci)).not.toBeNull();
    }, 30000);
  }

  it('finds a mate in one at the strongest level', async () => {
    const g = new Game('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const uci = await engine.bestMove(g.fen, LEVELS[3]);
    g.moveUci(uci);
    expect(g.status().reason).toBe('checkmate');
  }, 30000);

  it('promotes with a piece letter the game accepts', async () => {
    const g = new Game('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    const uci = await engine.bestMove(g.fen, LEVELS[3]);
    expect(uci).toBe('a7a8q');
    expect(g.moveUci(uci).san).toBe('a8=Q');
  }, 30000);

  it('ignores a search that was cancelled by a newer one', async () => {
    const first = engine.bestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', LEVELS[3]);
    const g = new Game('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const second = engine.bestMove(g.fen, LEVELS[3]);
    expect(await first).toBeNull();
    expect(await second).toBe('a1a8');
  }, 30000);
});
