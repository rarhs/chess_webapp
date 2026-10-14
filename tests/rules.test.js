import { describe, it, expect } from 'vitest';
import { Game, START_FEN } from '../src/game.js';

const play = (g, ...sans) => {
  for (const san of sans) {
    const m = g.moveSan(san);
    if (!m) throw new Error(`setup move rejected: ${san} in ${g.fen}`);
  }
  return g;
};

describe('illegal moves are rejected', () => {
  it('rejects moving the wrong side', () => {
    const g = new Game();
    expect(g.move('e7', 'e5')).toBeNull();
    expect(g.fen).toBe(START_FEN);
  });

  it('rejects impossible piece movement', () => {
    const g = new Game();
    expect(g.move('e2', 'e5')).toBeNull();
    expect(g.move('g1', 'g3')).toBeNull();
    expect(g.move('a1', 'a3')).toBeNull(); // blocked by own pawn
  });

  it('rejects moving a pinned piece', () => {
    // Knight on e2 is pinned to its king by the rook on e8
    const g = new Game('4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1');
    expect(g.targets('e2')).toEqual([]);
    expect(g.move('e2', 'c3')).toBeNull();
  });

  it('rejects moves that leave the king in check', () => {
    const g = new Game('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1');
    expect(g.move('e1', 'd1')).toBeNull(); // d1 is attacked by the d2 rook
    expect(g.move('e1', 'e2')).toBeNull(); // attacked by rook on d2
    expect(g.move('e1', 'f1')).not.toBeNull();
  });

  it('only allows check-resolving moves while in check', () => {
    // Position from the design: 6...Bb4+
    const g = new Game('r1bqk2r/pppp1ppp/2n2n2/8/1bBPP3/5N2/PP3PPP/RNBQK2R w KQkq - 1 7');
    expect(g.status().check).toBe(true);
    expect(g.targets('b1').sort()).toEqual(['c3', 'd2']); // a3 does not block
    expect(g.targets('e1').sort()).toEqual(['e2', 'f1']); // d2 is still on the bishop's line
    expect(g.move('h2', 'h3')).toBeNull();
    expect(g.move('e1', 'g1')).toBeNull(); // cannot castle out of check
  });

  it('rejects any move once the game is over', () => {
    const g = play(new Game(), 'f3', 'e5', 'g4', 'Qh4#');
    expect(g.status().reason).toBe('checkmate');
    expect(g.move('a2', 'a3')).toBeNull();
    expect(g.moveUci('a2a3')).toBeNull();
    expect(g.legalMoves('a2')).toEqual([]);
  });

  it('rejects malformed engine moves', () => {
    const g = new Game();
    expect(g.moveUci('e2e9')).toBeNull();
    expect(g.moveUci('')).toBeNull();
    expect(g.moveUci('e2e4')).not.toBeNull();
  });
});

describe('castling', () => {
  const FEN = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';

  it('allows kingside and queenside castling and moves the rook', () => {
    const g = new Game(FEN);
    const m = g.move('e1', 'g1');
    expect(m.san).toBe('O-O');
    expect(g.pieceAt('g1')).toEqual({ type: 'k', color: 'w' });
    expect(g.pieceAt('f1')).toEqual({ type: 'r', color: 'w' });
    expect(g.pieceAt('h1')).toBeUndefined();
    const m2 = g.move('e8', 'c8');
    expect(m2.san).toBe('O-O-O');
    expect(g.pieceAt('d8')).toEqual({ type: 'r', color: 'b' });
    expect(g.pieceAt('a8')).toBeUndefined();
  });

  it('forbids castling out of, through, or into check', () => {
    // Out of check: rook on e8 attacks the king
    expect(new Game('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1').targets('e1')).not.toContain('g1');
    // Through check: f1 attacked by rook on f8
    const through = new Game('5rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(through.targets('e1')).not.toContain('g1');
    expect(through.targets('e1')).toContain('c1');
    // Into check: g1 attacked by rook on g8
    const into = new Game('6rk/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(into.targets('e1')).not.toContain('g1');
    // d1 attacked blocks queenside; b1 attacked does not (only the rook passes b1)
    expect(new Game('3r2k1/8/8/8/8/8/8/R3K2R w KQ - 0 1').targets('e1')).not.toContain('c1');
    expect(new Game('1r4k1/8/8/8/8/8/8/R3K2R w KQ - 0 1').targets('e1')).toContain('c1');
  });

  it('forbids castling with pieces in the way', () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/RN2K1NR w KQkq - 0 1');
    expect(g.targets('e1')).not.toContain('g1');
    expect(g.targets('e1')).not.toContain('c1');
  });

  it('loses rights after the king moves, even if it returns', () => {
    const g = new Game('r3k2r/pppp1ppp/8/8/8/8/PPPP1PPP/R3K2R w KQkq - 0 1');
    play(g, 'Ke2', 'a6', 'Ke1', 'a5');
    expect(g.castlingRights()).toBe('kq');
    expect(g.targets('e1')).not.toContain('g1');
  });

  it('loses one side’s rights after that rook moves or is captured', () => {
    const g = new Game(FEN);
    play(g, 'Rb1');
    expect(g.castlingRights()).toBe('Kkq');
    const cap = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    play(cap, 'Rxa8+');
    expect(cap.castlingRights()).toBe('Kk');
  });
});

describe('en passant', () => {
  it('allows the capture immediately and removes the passed pawn', () => {
    const g = play(new Game(), 'e4', 'a6', 'e5', 'd5');
    expect(g.fen.split(' ')[3]).toBe('d6');
    const m = g.move('e5', 'd6');
    expect(m.san).toBe('exd6');
    expect(m.isEnPassant()).toBe(true);
    expect(g.pieceAt('d5')).toBeUndefined();
    expect(g.pieceAt('d6')).toEqual({ type: 'p', color: 'w' });
  });

  it('expires if not taken on the very next move', () => {
    const g = play(new Game(), 'e4', 'a6', 'e5', 'd5', 'h3', 'h6');
    expect(g.targets('e5')).not.toContain('d6');
  });

  it('is illegal when it would expose the king (horizontal pin)', () => {
    // After ...d7-d5 the e5 pawn cannot take: both pawns leave the 5th rank, exposing Ka5 to the h5 rook
    const g = new Game('4k3/3p4/8/K3P2r/8/8/8/8 b - - 0 1');
    play(g, 'd5');
    expect(g.targets('e5')).not.toContain('d6');
  });

  it('is available for black too', () => {
    const g = play(new Game(), 'a3', 'e5', 'a4', 'e4', 'd4');
    const m = g.move('e4', 'd3');
    expect(m.san).toBe('exd3');
    expect(g.pieceAt('d4')).toBeUndefined();
  });
});

describe('promotion', () => {
  const FEN = '1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1';

  it('is detected and requires a choice of piece', () => {
    const g = new Game(FEN);
    expect(g.isPromotion('a7', 'a8')).toBe(true);
    expect(g.isPromotion('a7', 'b8')).toBe(true);
    expect(g.move('a7', 'a8')).toBeNull(); // no piece chosen
    expect(g.move('a7', 'a8', 'k')).toBeNull(); // cannot promote to a king
    expect(g.fen).toBe(new Game(FEN).fen);
  });

  it('supports every piece, including underpromotion', () => {
    for (const p of ['q', 'r', 'b', 'n']) {
      const g = new Game(FEN);
      const m = g.move('a7', 'a8', p);
      expect(m).not.toBeNull();
      expect(g.pieceAt('a8')).toEqual({ type: p, color: 'w' });
      expect(g.pieceAt('a7')).toBeUndefined();
    }
  });

  it('works as a capture and writes correct SAN', () => {
    const g = new Game(FEN);
    expect(g.move('a7', 'b8', 'q').san).toBe('axb8=Q+');
    const g2 = new Game(FEN);
    expect(g2.move('a7', 'a8', 'n').san).toBe('a8=N');
  });

  it('accepts engine UCI promotions', () => {
    const g = new Game(FEN);
    expect(g.moveUci('a7a8r').san).toBe('a8=R');
    expect(g.pieceAt('a8')).toEqual({ type: 'r', color: 'w' });
  });

  it('underpromotion to a knight can deliver mate', () => {
    const g = new Game('6bn/5Ppk/6pp/8/8/8/8/4K3 w - - 0 1');
    const m = g.move('f7', 'f8', 'n');
    expect(m.san).toBe('f8=N#');
    expect(g.status()).toMatchObject({ over: true, reason: 'checkmate', result: '1-0' });
  });
});

describe('checkmate and stalemate', () => {
  it("announces fool's mate for Black", () => {
    const g = play(new Game(), 'f3', 'e5', 'g4', 'Qh4#');
    expect(g.status()).toMatchObject({ over: true, reason: 'checkmate', winner: 'b', result: '0-1', title: 'Checkmate. Black wins.' });
  });

  it('announces stalemate as a draw', () => {
    const g = new Game('7k/8/5QK1/8/8/8/8/8 w - - 0 1');
    play(g, 'Qf7'); // leaves the black king no moves, but not in check
    expect(g.status()).toMatchObject({ over: true, reason: 'stalemate', result: '1/2-1/2', title: 'Draw by stalemate.' });
    const s = new Game('7k/8/6QK/8/8/8/8/8 b - - 0 1');
    expect(s.status()).toMatchObject({ over: true, reason: 'stalemate', result: '1/2-1/2' });
  });

  it('checkmate on the move that reaches 50 moves is still checkmate', () => {
    // Halfmove clock at 99; the next move mates and would also complete 50 moves
    const g = new Game('7k/8/6K1/8/8/8/8/R7 w - - 99 120');
    play(g, 'Ra8#');
    expect(g.status()).toMatchObject({ reason: 'checkmate', result: '1-0' });
  });
});

describe('draw rules', () => {
  describe('threefold repetition', () => {
    it('ends the game on the third occurrence', () => {
      const g = new Game();
      play(g, 'Nf3', 'Nf6', 'Ng1', 'Ng8');
      expect(g.repetitionCount()).toBe(2);
      expect(g.status().over).toBe(false);
      play(g, 'Nf3', 'Nf6', 'Ng1');
      expect(g.status().over).toBe(false);
      play(g, 'Ng8');
      expect(g.repetitionCount()).toBe(3);
      expect(g.status()).toMatchObject({ over: true, reason: 'threefold', result: '1/2-1/2' });
    });

    it('needs the repetitions to be non-consecutive positions, not consecutive moves', () => {
      const g = new Game();
      play(g, 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nc3', 'Nc6', 'Nb1', 'Nb8');
      expect(g.repetitionCount()).toBe(3);
      expect(g.status().reason).toBe('threefold');
    });

    it('does not count positions with different castling rights as the same', () => {
      const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
      // First occurrence has full rights; after Ke2/Ke1 white has lost them.
      play(g, 'Ke2', 'Ke7', 'Ke1', 'Ke8');
      play(g, 'Ke2', 'Ke7', 'Ke1', 'Ke8');
      expect(g.repetitionCount()).toBe(2);
      expect(g.status().over).toBe(false);
      // The third cycle repeats the rights-less positions a third time
      play(g, 'Ke2', 'Ke7');
      expect(g.repetitionCount()).toBe(3);
      expect(g.status().reason).toBe('threefold');
    });

    it('does not count a position with a live en passant capture as the same', () => {
      const g = new Game('4k3/8/8/8/5p2/8/4P1N1/4K1n1 w - - 0 1');
      play(g, 'e4'); // black can play fxe3 e.p. here — occurrence #1 differs
      play(g, 'Nh3', 'Kd1', 'Ng1', 'Ke1', 'Nh3', 'Kd1', 'Ng1', 'Ke1');
      // Same placement as after e4 has occurred twice more, but without ep rights
      expect(g.repetitionCount()).toBe(2);
      expect(g.status().over).toBe(false);
    });

    it('can be undone back out of', () => {
      const g = play(new Game(), 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8');
      expect(g.status().reason).toBe('threefold');
      expect(g.undo(1)).toBe(1);
      expect(g.status().over).toBe(false);
    });
  });

  describe('fifty-move rule', () => {
    it('ends the game after 100 half-moves with no capture or pawn move', () => {
      const g = new Game('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80');
      expect(g.status().over).toBe(false);
      play(g, 'Ra2');
      expect(g.halfmoveClock()).toBe(100);
      expect(g.status()).toMatchObject({ over: true, reason: 'fifty', result: '1/2-1/2' });
    });

    it('resets on a pawn move', () => {
      const g = new Game('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80');
      play(g, 'e3');
      expect(g.halfmoveClock()).toBe(0);
      expect(g.status().over).toBe(false);
    });

    it('resets on a capture', () => {
      const g = new Game('4k3/8/8/8/8/8/r3P3/R3K3 w - - 99 80');
      play(g, 'Rxa2');
      expect(g.halfmoveClock()).toBe(0);
      expect(g.status().over).toBe(false);
    });

    it('counts up through real play', () => {
      const g = new Game('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
      let i = 0;
      // avoid threefold by walking the rook along the first rank and back
      while (g.halfmoveClock() < 99) {
        const before = g.halfmoveClock();
        const legal = g.chess.moves();
        const pick = legal.find((san) => {
          g.moveSan(san);
          const ok = !g.status().over;
          g.undo();
          return ok;
        });
        play(g, pick);
        expect(g.halfmoveClock()).toBe(before + 1);
        if (++i > 400) throw new Error('runaway');
      }
      // One more non-pawn, non-capture move hits 100 and ends the game (unless it is threefold first)
      const final = g.chess.moves().find((san) => !san.includes('x'));
      play(g, final);
      expect(g.status().over).toBe(true);
      expect(['fifty', 'threefold']).toContain(g.status().reason);
    });
  });

  describe('insufficient material', () => {
    const cases = [
      ['K vs K', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', true],
      ['K+B vs K', '4k3/8/8/8/8/8/8/2B1K3 w - - 0 1', true],
      ['K+N vs K', '4k3/8/8/8/8/8/8/1N2K3 w - - 0 1', true],
      ['K+B vs K+B, same-colour bishops', '3bk3/8/8/8/8/8/8/2B1K3 w - - 0 1', true],
      ['K+B vs K+B, opposite-colour bishops', '2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1', false],
      ['K+N+N vs K', '4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1', false],
      ['K+P vs K', '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', false],
      ['K+R vs K', '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', false],
    ];
    for (const [name, fen, draw] of cases) {
      it(`${name} is ${draw ? '' : 'not '}a draw`, () => {
        const s = new Game(fen).status();
        expect(s.over).toBe(draw);
        if (draw) expect(s).toMatchObject({ reason: 'insufficient', result: '1/2-1/2' });
      });
    }

    it('is detected right after the capture that causes it', () => {
      const g = new Game('4k3/8/8/8/8/8/3r4/3BK3 w - - 0 1');
      play(g, 'Kxd2');
      expect(g.status()).toMatchObject({ over: true, reason: 'insufficient' });
    });
  });
});

describe('resignation, time and agreement', () => {
  it('resignation awards the game to the opponent and cannot be undone', () => {
    const g = play(new Game(), 'e4');
    g.resign('b');
    expect(g.status()).toMatchObject({ over: true, reason: 'resignation', result: '1-0' });
    expect(g.undo()).toBe(0);
    expect(g.resign('w')).toBe(false);
  });

  it('flag fall loses, unless the opponent has no mating material', () => {
    const g = play(new Game(), 'e4');
    g.flagFall('b');
    expect(g.status()).toMatchObject({ reason: 'timeout', result: '1-0' });

    const lone = new Game('4k3/8/8/8/8/8/8/1N2K2q w - - 0 1');
    lone.flagFall('b'); // white has only a knight: cannot mate
    expect(lone.status()).toMatchObject({ reason: 'timeout-insufficient', result: '1/2-1/2' });
  });

  it('agreed draw', () => {
    const g = new Game();
    g.agreeDraw();
    expect(g.status()).toMatchObject({ over: true, reason: 'agreement', result: '1/2-1/2' });
  });
});

describe('undo', () => {
  it('takes back one or two plies', () => {
    const g = play(new Game(), 'e4', 'e5', 'Nf3');
    expect(g.undo(2)).toBe(2);
    expect(g.history().map((m) => m.san)).toEqual(['e4']);
    expect(g.undo(5)).toBe(1);
    expect(g.fen).toBe(START_FEN);
  });

  it('can take back a checkmate', () => {
    const g = play(new Game(), 'f3', 'e5', 'g4', 'Qh4#');
    g.undo();
    expect(g.status().over).toBe(false);
  });
});

describe('PGN and FEN', () => {
  it('exports PGN with headers and result, and re-imports it identically', () => {
    const g = play(new Game(), 'f3', 'e5', 'g4', 'Qh4#');
    g.setHeaders({ White: 'You', Black: 'Stockfish (Level 3)' });
    const pgn = g.pgn();
    expect(pgn).toContain('[White "You"]');
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toMatch(/1\. f3 e5 2\. g4 Qh4# 0-1\s*$/);
    const g2 = new Game();
    expect(g2.loadPgn(pgn)).toEqual({ ok: true });
    expect(g2.fen).toBe(g.fen);
    expect(g2.status().reason).toBe('checkmate');
  });

  it('exports games that started from a FEN with SetUp/FEN headers', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const g = play(new Game(fen), 'e4');
    const pgn = g.pgn();
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${fen}"]`);
    const g2 = new Game();
    expect(g2.loadPgn(pgn).ok).toBe(true);
    expect(g2.startFen).toBe(fen);
    expect(g2.fen).toBe(g.fen);
    expect(g2.undo()).toBe(1);
    expect(g2.fen).toBe(fen);
  });

  it('rejects a PGN with an illegal move and leaves the current game alone', () => {
    const g = play(new Game(), 'd4');
    const before = g.fen;
    const r = g.loadPgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Nxe5 Nxe5 5. Ke3');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Move 5 \(Ke3\) isn’t legal/);
    expect(g.fen).toBe(before);
  });

  it('imports a FEN, including side to move and ep square', () => {
    const g = new Game();
    expect(g.loadFen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3').ok).toBe(true);
    expect(g.turn).toBe('w');
    expect(g.move('e5', 'f6').san).toBe('exf6');
  });

  it('rejects malformed or impossible FENs and keeps the game', () => {
    const g = play(new Game(), 'e4');
    const before = g.fen;
    expect(g.loadFen('not a fen').ok).toBe(false);
    expect(g.loadFen('8/8/8/8/8/8/8/8 w - - 0 1').ok).toBe(false); // no kings
    expect(g.loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1').ok).toBe(false);
    expect(g.fen).toBe(before);
  });

  it('saves and restores a game through JSON', () => {
    const g = play(new Game(), 'e4', 'c5', 'Nf3');
    const g2 = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(g2.fen).toBe(g.fen);
    expect(g2.history().length).toBe(3);
  });

  it('positions earlier in the game can be viewed without changing the game', () => {
    const g = play(new Game(), 'e4', 'e5');
    expect(g.fenAt(0)).toBe(START_FEN);
    expect(g.fenAt(1)).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/4P3/);
    expect(g.ply).toBe(2);
  });
});
