// Game state on top of chess.js. chess.js owns move legality; this module adds
// the things a playable game needs on top: end-of-game adjudication (including
// resignation, time and agreed draws), history browsing, safe PGN/FEN import,
// and PGN export with proper headers.
import { Chess, DEFAULT_POSITION, validateFen } from 'chess.js';

export const START_FEN = DEFAULT_POSITION;

const COLOR_NAME = { w: 'White', b: 'Black' };
const other = (c) => (c === 'w' ? 'b' : 'w');

// Position identity for repetition: placement, side to move, castling rights and
// en passant square. chess.js only writes the ep square into fen() when an
// en passant capture is actually legal, which is what FIDE 9.2 requires.
const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

export class Game {
  constructor(fen = START_FEN) {
    this.reset(fen);
  }

  reset(fen = START_FEN) {
    const chess = new Chess();
    chess.load(fen); // throws on an invalid FEN; callers validate first
    this.chess = chess;
    this.startFen = chess.fen();
    this.manualEnd = null; // { reason, winner } for resign / timeout / agreement
    this.headers = {};
  }

  get fen() { return this.chess.fen(); }
  get turn() { return this.chess.turn(); }
  get ply() { return this.chess.history().length; }

  history() { return this.chess.history({ verbose: true }); }

  // Board as an 8x8 array (rank 8 first) at a given ply; defaults to the live position.
  boardAt(ply = this.ply) {
    return this.chessAt(ply).board();
  }

  fenAt(ply = this.ply) {
    return ply === this.ply ? this.fen : this.chessAt(ply).fen();
  }

  chessAt(ply) {
    if (ply === this.ply) return this.chess;
    const c = new Chess(this.startFen);
    const moves = this.history();
    for (let i = 0; i < ply; i++) c.move(moves[i].san);
    return c;
  }

  pieceAt(square) { return this.chess.get(square); }

  legalMoves(square) {
    if (this.isOver()) return [];
    return this.chess.moves({ square, verbose: true });
  }

  // Destination squares for the piece on `square` (promotion variants collapse to one).
  targets(square) {
    return [...new Set(this.legalMoves(square).map((m) => m.to))];
  }

  isPromotion(from, to) {
    return this.legalMoves(from).some((m) => m.to === to && m.promotion);
  }

  // Returns the chess.js Move, or null if the move is illegal or the game is over.
  // A promotion with no piece given is rejected rather than silently queened.
  move(from, to, promotion) {
    if (this.isOver()) return null;
    const candidates = this.legalMoves(from).filter((m) => m.to === to);
    if (!candidates.length) return null;
    if (candidates.some((m) => m.promotion)) {
      if (!['q', 'r', 'b', 'n'].includes(promotion)) return null;
    } else {
      promotion = undefined;
    }
    try {
      return this.chess.move({ from, to, promotion });
    } catch {
      return null;
    }
  }

  // Engine moves arrive as UCI ("e7e8q").
  moveUci(uci) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
    return this.move(uci.slice(0, 2), uci.slice(2, 4), uci[4]);
  }

  moveSan(san) {
    if (this.isOver()) return null;
    try { return this.chess.move(san); } catch { return null; }
  }

  undo(plies = 1) {
    if (this.manualEnd) return 0; // resignation / flag / agreed draw are final
    let undone = 0;
    while (undone < plies && this.chess.undo()) undone++;
    return undone;
  }

  resign(color) {
    if (this.isOver()) return false;
    this.manualEnd = { reason: 'resignation', winner: other(color), loser: color };
    return true;
  }

  // A flag fall loses, unless the opponent cannot possibly mate (FIDE 6.9).
  flagFall(color) {
    if (this.isOver()) return false;
    const winner = other(color);
    if (!canEverMate(this.chess, winner)) {
      this.manualEnd = { reason: 'timeout-insufficient', winner: null, loser: color };
    } else {
      this.manualEnd = { reason: 'timeout', winner, loser: color };
    }
    return true;
  }

  agreeDraw() {
    if (this.isOver()) return false;
    this.manualEnd = { reason: 'agreement', winner: null };
    return true;
  }

  // How many times the current position has occurred, this one included.
  repetitionCount() {
    const c = new Chess(this.startFen);
    const target = positionKey(this.fen);
    let count = positionKey(c.fen()) === target ? 1 : 0;
    for (const m of this.history()) {
      c.move(m.san);
      if (positionKey(c.fen()) === target) count++;
    }
    return count;
  }

  halfmoveClock() { return Number(this.fen.split(' ')[4]); }
  castlingRights() { return this.fen.split(' ')[2]; }

  isOver() { return this.status().over; }

  // Order matters: checkmate on the move that would complete 50 moves is still mate.
  status() {
    const c = this.chess;
    const m = this.manualEnd;
    if (m) {
      switch (m.reason) {
        case 'resignation':
          return end(m.winner, 'resignation', `${COLOR_NAME[m.loser]} resigned. ${COLOR_NAME[m.winner]} wins.`);
        case 'timeout':
          return end(m.winner, 'timeout', `${COLOR_NAME[m.loser]} ran out of time. ${COLOR_NAME[m.winner]} wins.`);
        case 'timeout-insufficient':
          return end(null, 'timeout-insufficient', `${COLOR_NAME[m.loser]} ran out of time, but ${COLOR_NAME[other(m.loser)]} cannot mate. Draw.`);
        case 'agreement':
          return end(null, 'agreement', 'Draw agreed.');
      }
    }
    if (c.isCheckmate()) {
      const winner = other(c.turn());
      return end(winner, 'checkmate', `Checkmate. ${COLOR_NAME[winner]} wins.`);
    }
    if (c.isStalemate()) return end(null, 'stalemate', 'Draw by stalemate.');
    if (c.isInsufficientMaterial()) return end(null, 'insufficient', 'Draw by insufficient material.');
    if (this.repetitionCount() >= 3) return end(null, 'threefold', 'Draw by threefold repetition.');
    if (c.isDrawByFiftyMoves()) return end(null, 'fifty', 'Draw by the fifty-move rule.');
    return { over: false, result: '*', reason: null, winner: null, title: '', check: c.inCheck() };
  }

  // Pieces each side has captured, derived from move history.
  captured() {
    const out = { w: [], b: [] };
    for (const m of this.history()) if (m.captured) out[m.color].push(m.captured);
    return out;
  }

  setHeaders(h) { this.headers = { ...this.headers, ...h }; }

  pgn() {
    const c = new Chess(this.startFen);
    for (const m of this.history()) c.move(m.san);
    const s = this.status();
    const d = new Date();
    const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    const headers = { Event: 'Casual game', Site: 'Chess web app', Date: date, Round: '-', White: 'White', Black: 'Black', ...this.headers, Result: s.result };
    if (this.startFen !== START_FEN) { headers.SetUp = '1'; headers.FEN = this.startFen; }
    if (s.over) headers.Termination = s.title;
    for (const [k, v] of Object.entries(headers)) c.setHeader(k, String(v));
    let text = c.pgn();
    // chess.js ends the movetext with the Result header's token; make sure it is there.
    if (!/(1-0|0-1|1\/2-1\/2|\*)\s*$/.test(text)) text = `${text.trimEnd()} ${s.result}`;
    return text;
  }

  // Imports never touch the current game unless they fully succeed.
  loadPgn(text) {
    const src = String(text || '').trim();
    if (!src) return { ok: false, error: 'Paste a PGN first.' };
    const c = new Chess();
    try {
      c.loadPgn(src);
    } catch (e) {
      return { ok: false, error: describePgnError(e, src) };
    }
    const headers = c.getHeaders();
    const startFen = headers.FEN && headers.SetUp !== '0' ? headers.FEN : START_FEN;
    const moves = c.history();
    const replay = new Chess(startFen);
    for (const san of moves) replay.move(san);
    this.chess = replay;
    this.startFen = new Chess(startFen).fen();
    this.manualEnd = null;
    this.headers = pick(headers, ['Event', 'Site', 'Date', 'Round', 'White', 'Black']);
    return { ok: true };
  }

  loadFen(text) {
    const fen = String(text || '').trim().replace(/\s+/g, ' ');
    if (!fen) return { ok: false, error: 'Paste a FEN first.' };
    const v = validateFen(fen);
    if (!v.ok) return { ok: false, error: `That FEN isn’t valid: ${v.error.replace(/^Invalid FEN: /, '')}` };
    try {
      this.reset(fen);
    } catch (e) {
      return { ok: false, error: `That FEN isn’t a legal position: ${e.message.replace(/^Invalid FEN: /, '')}` };
    }
    return { ok: true };
  }

  toJSON() {
    return { startFen: this.startFen, moves: this.history().map((m) => m.san), manualEnd: this.manualEnd, headers: this.headers };
  }

  static fromJSON(data) {
    const g = new Game(data.startFen || START_FEN);
    for (const san of data.moves || []) {
      if (!g.moveSan(san)) throw new Error(`Saved game has an illegal move: ${san}`);
    }
    g.manualEnd = data.manualEnd || null;
    g.headers = data.headers || {};
    return g;
  }
}

function end(winner, reason, title) {
  const result = winner === 'w' ? '1-0' : winner === 'b' ? '0-1' : '1/2-1/2';
  return { over: true, result, reason, winner, title, check: false };
}

// Could `color` deliver mate with any sequence of legal moves? Conservative:
// only bare king, or king plus a single minor piece, can never mate.
function canEverMate(chess, color) {
  const pieces = chess.board().flat().filter((p) => p && p.color === color && p.type !== 'k');
  if (pieces.length === 0) return false;
  if (pieces.length === 1 && (pieces[0].type === 'b' || pieces[0].type === 'n')) return false;
  return true;
}

function describePgnError(e, src) {
  const msg = String(e && e.message ? e.message : e);
  const bad = msg.match(/Invalid move in PGN: (\S+)/);
  if (bad) {
    const san = bad[1];
    const num = moveNumberOf(src, san);
    return `${num ? `Move ${num} ` : 'A move '}(${san}) isn’t legal in that position, so nothing was loaded. Your current game is unchanged.`;
  }
  return `Couldn’t read that PGN (${msg.replace(/^Error: /, '')}). Your current game is unchanged.`;
}

function moveNumberOf(src, san) {
  const body = src.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
  const re = /(\d+)\.(?:\.\.)?\s*([^\s.]+)?(?:\s+([^\s.]+))?/g;
  let m;
  while ((m = re.exec(body))) if (m[2] === san || m[3] === san) return m[1];
  return null;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] != null && obj[k] !== '?') out[k] = obj[k];
  return out;
}
