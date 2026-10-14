import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { describeMove, announceAfterMove } from '../src/speech.js';

const last = (g) => g.history().at(-1);

describe('move descriptions for screen readers', () => {
  it('describes a quiet move and a capture', () => {
    const g = new Game();
    g.moveSan('e4');
    expect(describeMove(last(g))).toBe('White pawn e2 to e4.');
    g.moveSan('d5');
    g.moveSan('exd5');
    expect(describeMove(last(g))).toBe('White pawn on e4 takes pawn on d5.');
  });

  it('describes castling on both sides', () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    g.moveSan('O-O');
    expect(describeMove(last(g))).toBe('White castles kingside.');
    g.moveSan('O-O-O');
    expect(describeMove(last(g))).toBe('Black castles queenside.');
  });

  it('describes en passant and promotion', () => {
    const g = new Game();
    for (const m of ['e4', 'a6', 'e5', 'd5', 'exd6']) g.moveSan(m);
    expect(describeMove(last(g))).toBe('White pawn on e5 takes pawn on d6 en passant.');
    const p = new Game('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    p.move('a7', 'b8', 'n');
    expect(describeMove(last(p))).toBe('White pawn on a7 takes knight on b8, promotes to knight.');
  });

  it('announces check, checkmate and the result', () => {
    const g = new Game();
    for (const m of ['f3', 'e5', 'g4', 'Qh4#']) g.moveSan(m);
    expect(announceAfterMove(last(g), g.status())).toBe('Black queen d8 to h4, checkmate. Black wins.');
  });

  it("tells the human it's their move after the computer plays", () => {
    const g = new Game();
    g.moveSan('e4');
    g.moveSan('e5');
    expect(announceAfterMove(last(g), g.status(), 'w')).toBe('Black pawn e7 to e5. Your move.');
    expect(announceAfterMove(last(g), g.status())).toBe('Black pawn e7 to e5. White to move.');
  });

  it('announces draws by name', () => {
    const g = new Game('7k/8/5QK1/8/8/8/8/8 w - - 0 1');
    g.moveSan('Qf7');
    expect(announceAfterMove(last(g), g.status())).toBe('White queen f6 to f7. Draw by stalemate.');
  });
});
