import { Game, START_FEN } from './game.js';
import { Engine, LEVELS, levelById, workerTransport } from './engine.js';
import { Board, glyph } from './board.js';
import { formatClock, parseClock } from './clock.js';
import { announceAfterMove } from './speech.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'chess-webapp:v1';
const ROBOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="11" rx="2"/><path d="M12 3v4M9 12h.01M15 12h.01M9 15h6"/></svg>';
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const COLOR = { w: 'White', b: 'Black' };
const PIECE_NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const fmtResult = (r) => r.replaceAll('1/2', '½').replace('-', '–');

const state = {
  settings: { mode: 'computer', level: 3, humanColor: 'w', clock: null, theme: 'slate', hints: true },
  game: new Game(),
  viewPly: null, // null = live position
  selected: null,
  orientation: 'w',
  thinking: false,
  searchToken: 0,
  clocks: null, // { w, b, inc, lastTick } in ms
  overShown: false,
};

let engine = null;
let engineError = null;

const board = new Board($('board'), {
  onSquare: (sq, opts) => onSquare(sq, opts),
  onDrop: (from, to) => tryMove(from, to),
  canDrag: (sq) => canHumanMove() && state.game.pieceAt(sq)?.color === state.game.turn,
});

// ---------- engine ----------
function getEngine() {
  if (engine || engineError) return engine;
  try {
    const url = new URL('engine/stockfish.js', document.baseURI).href;
    const transport = workerTransport(url);
    transport.onError(() => {
      engineError = new Error('engine failed');
      toast('The computer opponent could not load. You can still play two-player games.');
      state.thinking = false;
      render();
    });
    engine = new Engine(transport);
  } catch (e) {
    engineError = e;
    toast('The computer opponent could not load in this browser.');
  }
  return engine;
}

const isComputerTurn = () =>
  state.settings.mode === 'computer' && !state.game.isOver() && state.game.turn !== state.settings.humanColor;

async function maybeEngineMove() {
  if (!isComputerTurn()) return;
  const eng = getEngine();
  if (!eng) return;
  const token = ++state.searchToken;
  state.thinking = true;
  render();
  const uci = await eng.bestMove(state.game.fen, levelById(state.settings.level));
  if (token !== state.searchToken) return; // undone / new game meanwhile
  state.thinking = false;
  if (!uci || !isComputerTurn()) { render(); return; }
  const move = state.game.moveUci(uci);
  if (!move) { toast('The engine suggested an illegal move; it was ignored.'); render(); return; }
  afterMove(move);
}

function stopEngine() {
  state.searchToken++;
  state.thinking = false;
  engine?.cancel();
}

// ---------- moves ----------
function canHumanMove() {
  const g = state.game;
  if (g.isOver() || state.viewPly !== null || state.thinking) return false;
  if (state.settings.mode === 'computer' && g.turn !== state.settings.humanColor) return false;
  return true;
}

function onSquare(sq, opts = {}) {
  if (state.viewPly !== null) { goLive(); return; }
  if (!canHumanMove()) return;
  const g = state.game;
  const piece = g.pieceAt(sq);
  if (state.selected && state.selected !== sq && g.targets(state.selected).includes(sq)) {
    tryMove(state.selected, sq);
    return;
  }
  const before = state.selected;
  if (piece && piece.color === g.turn) {
    state.selected = state.selected === sq && !opts.dragStart ? null : sq;
  } else {
    state.selected = null;
  }
  render();
  if (state.selected && state.selected !== before) {
    const t = g.targets(state.selected);
    announce(`${COLOR[piece.color]} ${PIECE_NAME[piece.type]} on ${sq} selected. ${t.length ? `Can move to ${t.join(', ')}.` : 'It has no legal moves.'}`);
  } else if (!state.selected && before && !opts.dragStart) {
    announce(piece && piece.color === g.turn ? 'Selection cleared.' : `${sq} isn’t a legal move. Selection cleared.`);
  }
}

async function tryMove(from, to) {
  if (!canHumanMove()) return;
  const g = state.game;
  if (!g.targets(from).includes(to)) {
    // Illegal: keep the piece selected so the player can try again.
    state.selected = g.pieceAt(from)?.color === g.turn ? from : null;
    render();
    announce(`${to} isn’t a legal move.`);
    return;
  }
  let promotion;
  if (g.isPromotion(from, to)) {
    state.selected = from;
    render();
    promotion = await board.choosePromotion(to, g.turn, from);
    if (!promotion) { state.selected = null; render(); return; }
  }
  const move = g.move(from, to, promotion);
  if (!move) { state.selected = null; render(); return; }
  afterMove(move);
}

function afterMove(move) {
  const c = state.clocks;
  if (c) {
    tickClock();
    c[move.color] += c.inc;
  }
  state.selected = null;
  state.viewPly = null;
  save();
  render();
  announce(announceAfterMove(move, state.game.status(), state.settings.mode === 'computer' ? state.settings.humanColor : null));
  if (state.game.isOver()) showGameOver();
  else maybeEngineMove();
}

// Screen-reader announcements go through one polite live region. Clearing it first
// makes an identical message (e.g. "Your move.") be read again. Messages that arrive
// close together (your move, then an instant engine reply) are joined, not dropped.
let announceTimer;
let pendingAnnouncement = '';
function announce(text) {
  const el = $('announcer');
  el.textContent = '';
  pendingAnnouncement = pendingAnnouncement ? `${pendingAnnouncement} ${text}` : text;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    el.textContent = pendingAnnouncement;
    pendingAnnouncement = '';
  }, 60);
}

// ---------- clocks ----------
function clockRunningFor() {
  const g = state.game;
  if (!state.clocks || g.isOver() || g.ply === 0) return null; // starts after White's first move
  return g.turn;
}

function tickClock() {
  const c = state.clocks;
  if (!c) return;
  const now = performance.now();
  const color = clockRunningFor();
  if (color && c.lastTick != null) c[color] = Math.max(0, c[color] - (now - c.lastTick));
  c.lastTick = now;
  if (color && c[color] <= 0) {
    stopEngine();
    state.game.flagFall(color);
    save();
    render();
    announce(state.game.status().title);
    showGameOver();
  }
}

setInterval(() => {
  if (!state.clocks) return;
  tickClock();
  renderPlayers();
}, 200);

// ---------- game controls ----------
function startGame(settings) {
  stopEngine();
  board.closePromotion(null);
  const s = { ...state.settings, ...settings };
  if (s.humanColor === 'random') s.humanColor = Math.random() < 0.5 ? 'w' : 'b';
  if (s.mode === 'computer' && engineError) {
    toast('The computer opponent is unavailable, so this is a two-player game.');
    s.mode = 'human';
  }
  state.settings = s;
  state.game = new Game();
  state.game.setHeaders(playerHeaders());
  state.viewPly = null;
  state.selected = null;
  state.overShown = false;
  state.orientation = s.mode === 'computer' ? s.humanColor : 'w';
  state.clocks = s.clock ? { w: s.clock.base * 1000, b: s.clock.base * 1000, inc: s.clock.inc * 1000, lastTick: null } : null;
  save();
  render();
  announce(s.mode === 'computer'
    ? `New game against Stockfish, ${levelById(s.level).name}. You play ${COLOR[s.humanColor]}.${s.humanColor === 'b' ? ' Computer moves first.' : ' Your move.'}`
    : 'New two-player game. White to move.');
  maybeEngineMove();
}

function playerHeaders() {
  const s = state.settings;
  if (s.mode !== 'computer') return { White: 'White', Black: 'Black' };
  const cpu = `Stockfish (${levelById(s.level).name})`;
  return s.humanColor === 'w' ? { White: 'You', Black: cpu } : { White: cpu, Black: 'You' };
}

function undo() {
  const g = state.game;
  if (g.manualEnd || g.ply === 0) return;
  stopEngine();
  board.closePromotion(null);
  if (state.settings.mode === 'computer') {
    // Take back to the last position where it was the human's turn.
    g.undo(1);
    if (g.turn !== state.settings.humanColor) g.undo(1);
  } else {
    g.undo(1);
  }
  state.selected = null;
  state.viewPly = null;
  state.overShown = false;
  if (state.clocks) state.clocks.lastTick = performance.now();
  save();
  render();
  const last = g.history().at(-1);
  announce(`Move taken back. ${last ? `Last move: ${last.san}. ` : ''}${state.settings.mode === 'computer' && g.turn === state.settings.humanColor ? 'Your move.' : `${COLOR[g.turn]} to move.`}`);
  maybeEngineMove(); // e.g. human is Black and undid to the start
}

async function resign() {
  const g = state.game;
  if (g.isOver()) return;
  const color = state.settings.mode === 'computer' ? state.settings.humanColor : g.turn;
  const ok = await confirmDialog(`Resign as ${COLOR[color]}?`, 'The game ends and is scored as a loss.', 'Resign');
  if (!ok || g.isOver()) return;
  stopEngine();
  g.resign(color);
  save();
  render();
  announce(g.status().title);
  showGameOver();
}

async function offerDraw() {
  const g = state.game;
  if (g.isOver()) return;
  if (state.settings.mode === 'human') {
    const other = g.turn === 'w' ? 'b' : 'w';
    const ok = await confirmDialog(`${COLOR[other]}, accept a draw?`, `${COLOR[g.turn]} offers a draw. Hand the device over to answer.`, 'Accept draw', 'Decline');
    if (!ok) { toast('Draw declined.'); return; }
  } else {
    // Stockfish accepts when its last evaluation says it is not better.
    const score = engine?.lastScore;
    const accepts = g.ply >= 20 && score && score.cp !== undefined && score.cp <= 15;
    if (!accepts) { toast('Stockfish declines the draw.'); return; }
  }
  stopEngine();
  g.agreeDraw();
  save();
  render();
  announce(g.status().title);
  showGameOver();
}

function flip() {
  state.orientation = state.orientation === 'w' ? 'b' : 'w';
  const refocus = board.hasFocus();
  render();
  if (refocus) board.setCursor(board.cursor, { focus: true });
  announce(`Board flipped. ${COLOR[state.orientation]} at the bottom.`);
}

function setView(ply) {
  const g = state.game;
  board.closePromotion(null);
  state.selected = null;
  const prev = state.viewPly;
  if (ply === null || ply >= g.ply) state.viewPly = null;
  else state.viewPly = Math.max(0, ply);
  render();
  if (prev !== state.viewPly) {
    announce(state.viewPly === null ? 'Back to the current position.'
      : state.viewPly === 0 ? 'Viewing the starting position.' : `Viewing the position after ${moveLabel(state.viewPly)}.`);
  }
}
const goLive = () => setView(null);
const currentPly = () => (state.viewPly === null ? state.game.ply : state.viewPly);

// ---------- rendering ----------
function render() {
  const g = state.game;
  const s = state.settings;
  const ply = currentPly();
  const history = g.history();
  const last = ply > 0 ? history[ply - 1] : null;
  const live = state.viewPly === null;
  const chessAtPly = live ? g.chess : g.chessAt(ply);

  board.orientation = state.orientation;
  $('board').className = `board theme-${s.theme}`;
  let check = null;
  if (chessAtPly.inCheck()) {
    const king = chessAtPly.board().flat().find((p) => p && p.type === 'k' && p.color === chessAtPly.turn());
    check = king?.square || null;
  }
  board.render({
    board: chessAtPly.board(),
    lastMove: last ? { from: last.from, to: last.to } : null,
    check,
    selected: state.selected,
    targets: state.selected ? g.targets(state.selected) : [],
    interactive: canHumanMove(),
    legalHints: s.hints,
  });

  renderStatus();
  renderPlayers();
  renderMoves(history, ply);

  $('fen').value = live ? g.fen : chessAtPly.fen();
  $('fact-fifty').textContent = `${Number(chessAtPly.fen().split(' ')[4])} / 100 half-moves`;
  $('fact-rep').textContent = live ? `${g.repetitionCount()}×` : '—';
  $('fact-castle').textContent = chessAtPly.fen().split(' ')[2];
  $('mode-chip').textContent = s.mode === 'computer'
    ? `vs Computer · ${levelById(s.level).name} · You play ${COLOR[s.humanColor]}`
    : 'Two players · this device';
  $('btn-undo').disabled = g.ply === 0 || !!g.manualEnd || (s.mode === 'computer' && !history.some((m) => m.color === s.humanColor));
  $('btn-resign').disabled = g.isOver();
  $('btn-draw').disabled = g.isOver();
  $('nav-first').disabled = $('nav-prev').disabled = ply === 0;
  $('nav-next').disabled = $('nav-last').disabled = live;
  $('theme').value = s.theme;
  $('opt-hints').checked = s.hints;
}

function renderStatus() {
  const g = state.game;
  const st = g.status();
  const el = $('status');
  el.className = 'status';
  if (state.viewPly !== null) {
    el.innerHTML = `<span>Viewing ${state.viewPly === 0 ? 'the starting position' : `after move ${moveLabel(state.viewPly)}`}.</span><button type="button" class="link" id="status-live">Back to the game</button>`;
    $('status-live').onclick = goLive;
    return;
  }
  if (st.over) {
    el.classList.add('over');
    el.innerHTML = `<span><strong>${st.title}</strong> ${fmtResult(st.result)}</span>`;
    return;
  }
  const side = COLOR[g.turn];
  if (state.thinking) {
    el.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>Stockfish is thinking…</span>`;
    if (st.check) el.classList.add('check');
    return;
  }
  if (st.check) {
    el.classList.add('check');
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><span><strong>${side} is in check.</strong> Block, capture the checking piece, or move the king.</span>`;
    return;
  }
  const yours = state.settings.mode === 'computer' ? 'Your move.' : `${side} to move.`;
  el.innerHTML = `<span>${yours}</span>`;
}

function moveLabel(ply) {
  const m = state.game.history()[ply - 1];
  const [, side, , , , full] = state.game.startFen.split(' ');
  const n = Number(full) + Math.floor((ply - 1 + (side === 'b' ? 1 : 0)) / 2);
  return `${n}${m.color === 'w' ? '.' : '…'} ${m.san}`;
}

function renderPlayers() {
  const bottom = state.orientation;
  const top = bottom === 'w' ? 'b' : 'w';
  $('player-top').innerHTML = playerHTML(top);
  $('player-bottom').innerHTML = playerHTML(bottom);
}

function playerHTML(color) {
  const g = state.game;
  const s = state.settings;
  const isCpu = s.mode === 'computer' && color !== s.humanColor;
  const isYou = s.mode === 'computer' && color === s.humanColor;
  const name = isCpu ? `Stockfish · ${levelById(s.level).name}` : isYou ? 'You' : COLOR[color];
  const avatar = isCpu ? `<div class="avatar">${ROBOT}</div>` : `<div class="avatar ${isYou || s.mode === 'human' ? 'you' : ''}" ${s.mode === 'human' && color === 'b' ? 'style="background:#2A2F37;color:#E8EAED"' : ''}>${isYou ? 'Y' : COLOR[color][0]}</div>`;
  const caps = g.captured()[color];
  const myMat = caps.reduce((a, p) => a + VALUE[p], 0);
  const theirMat = g.captured()[color === 'w' ? 'b' : 'w'].reduce((a, p) => a + VALUE[p], 0);
  const diff = myMat - theirMat;
  const capsHtml = caps.length
    ? `<span class="caps" aria-label="captured ${caps.length} pieces">${caps.sort((a, b) => VALUE[b] - VALUE[a]).map(glyph).join('')}</span>${diff > 0 ? `<span>+${diff}</span>` : ''}`
    : '';
  let right = '';
  const st = g.status();
  if (state.clocks) {
    const ms = state.clocks[color];
    const running = clockRunningFor() === color;
    right = `<span class="clock ${running ? 'running' : ''} ${ms < 20000 ? 'low' : ''}" aria-label="${COLOR[color]} clock">${formatClock(ms)}</span>`;
  } else if (!st.over && g.turn === color && state.viewPly === null) {
    right = isCpu ? `<span class="badge quiet">${state.thinking ? 'Thinking…' : 'To move'}</span>` : `<span class="badge">${isYou ? 'Your move' : 'To move'}</span>`;
  }
  return `<div class="who">${avatar}<div style="display:flex;flex-direction:column;min-width:0"><span class="name">${name}</span><span class="sub">${COLOR[color]}${capsHtml ? ' · ' : ''}${capsHtml}</span></div></div><div class="right">${right}</div>`;
}

function renderMoves(history, ply) {
  const ol = $('moves');
  const startBlack = state.game.startFen.split(' ')[1] === 'b';
  const startNum = Number(state.game.startFen.split(' ')[5]) || 1;
  if (!history.length) {
    ol.innerHTML = '<li><span class="empty">No moves yet.</span></li>';
  } else {
    const rows = [];
    let i = 0;
    let num = startNum;
    if (startBlack) {
      rows.push({ num, w: null, b: { m: history[0], ply: 1 } });
      i = 1; num++;
    }
    for (; i < history.length; i += 2, num++) {
      rows.push({ num, w: { m: history[i], ply: i + 1 }, b: history[i + 1] ? { m: history[i + 1], ply: i + 2 } : null });
    }
    const btn = (x) => (x ? `<button type="button" data-ply="${x.ply}" class="${x.ply === ply ? 'current' : ''}">${x.m.san}</button>` : '<span></span>');
    const st = state.game.status();
    ol.innerHTML = rows.map((r) => `<li><span class="num">${r.num}.</span>${r.w ? btn(r.w) : '<span class="num">…</span>'}${btn(r.b)}</li>`).join('')
      + (st.over ? `<li><span></span><span class="num" style="padding-left:10px">${fmtResult(st.result)}</span><span></span></li>` : '');
    ol.querySelectorAll('button').forEach((b) => (b.onclick = () => setView(Number(b.dataset.ply))));
    const cur = ol.querySelector('button.current');
    if (cur) {
      const top = cur.offsetTop - ol.offsetTop;
      if (top < ol.scrollTop || top > ol.scrollTop + ol.clientHeight - 40) ol.scrollTop = top - ol.clientHeight / 2;
    }
  }
  $('ply-info').textContent = history.length ? `${Math.ceil(history.length / 2)} move${history.length > 2 ? 's' : ''}` : '';
}

// ---------- dialogs ----------
function showGameOver() {
  const st = state.game.status();
  if (!st.over || state.overShown) return;
  state.overShown = true;
  save();
  $('go-title').textContent = st.title;
  $('go-score').textContent = fmtResult(st.result);
  const h = state.game.history();
  $('go-final').textContent = h.length ? `Final move ${moveLabel(h.length)}` : '';
  const dlg = $('dlg-over');
  if (!dlg.open) dlg.showModal();
}

function confirmDialog(title, body, yes = 'OK', no = 'Cancel') {
  const dlg = $('dlg-confirm');
  $('cf-title').textContent = title;
  $('cf-body').textContent = body;
  $('cf-yes').textContent = yes;
  $('cf-no').textContent = no;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true }));
}

function openNewGame() {
  const dlg = $('dlg-new');
  const form = dlg.querySelector('form');
  const s = state.settings;
  form.mode.value = s.mode;
  form.level.value = String(s.level);
  form.side.value = s.humanColor;
  form.clock.value = s.clock ? `${s.clock.base}+${s.clock.inc}` : '';
  syncNewGameForm();
  dlg.showModal();
}

function syncNewGameForm() {
  const form = $('dlg-new').querySelector('form');
  const cpu = form.mode.value === 'computer';
  $('fs-level').disabled = !cpu;
  $('fs-side').disabled = !cpu;
}

let importKind = 'pgn';
function openImport() {
  setImportKind('pgn');
  $('import-text').value = '';
  showImportError(null);
  $('dlg-import').showModal();
}
function setImportKind(kind) {
  importKind = kind;
  $('tab-pgn').setAttribute('aria-selected', String(kind === 'pgn'));
  $('tab-fen').setAttribute('aria-selected', String(kind === 'fen'));
  $('import-label').textContent = kind === 'pgn' ? 'Paste PGN or choose a .pgn file' : 'Paste a FEN position';
  $('import-text').rows = kind === 'pgn' ? 8 : 2;
  $('import-text').placeholder = kind === 'pgn' ? '1. e4 e5 2. Nf3 Nc6 …' : START_FEN;
  showImportError(null);
}
function showImportError(msg) {
  const el = $('import-error');
  el.hidden = !msg;
  el.textContent = msg || '';
  $('import-text').classList.toggle('invalid', !!msg);
}
function doImport() {
  const text = $('import-text').value;
  const trial = new Game();
  const r = importKind === 'pgn' ? trial.loadPgn(text) : trial.loadFen(text);
  if (!r.ok) { showImportError(r.error); return; }
  stopEngine();
  board.closePromotion(null);
  state.game = trial;
  if (!Object.keys(trial.headers).some((k) => k === 'White' || k === 'Black')) trial.setHeaders(playerHeaders());
  state.viewPly = null;
  state.selected = null;
  state.overShown = false;
  if (state.clocks) state.clocks = { ...state.clocks, w: state.settings.clock.base * 1000, b: state.settings.clock.base * 1000, lastTick: null };
  $('dlg-import').close();
  save();
  render();
  if (trial.isOver()) showGameOver();
  else maybeEngineMove();
  toast(importKind === 'pgn' ? `Loaded ${trial.ply} half-moves.` : 'Position loaded.');
}

function exportPgn() {
  const text = state.game.pgn();
  const d = new Date();
  const name = `chess-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.pgn`;
  const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'application/x-chess-pgn' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  navigator.clipboard?.writeText(text).then(() => toast('PGN downloaded and copied.'), () => toast('PGN downloaded.'));
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

// ---------- persistence ----------
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      settings: state.settings,
      game: state.game.toJSON(),
      orientation: state.orientation,
      clocks: state.clocks && { ...state.clocks, lastTick: null },
      overShown: state.overShown,
    }));
  } catch { /* storage unavailable: play on without saving */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    state.settings = { ...state.settings, ...data.settings };
    state.game = Game.fromJSON(data.game);
    state.orientation = data.orientation === 'b' ? 'b' : 'w';
    state.clocks = data.clocks || null;
    state.overShown = !!data.overShown;
    return true;
  } catch {
    return false;
  }
}

// ---------- wiring ----------
function initLevelOptions() {
  $('level-options').innerHTML = LEVELS.map((l) =>
    `<label><input type="radio" name="level" value="${l.id}"><span>${l.name}<small>${l.detail}</small></span></label>`).join('');
}

function wire() {
  $('btn-new').onclick = openNewGame;
  $('btn-undo').onclick = undo;
  $('btn-flip').onclick = flip;
  $('btn-resign').onclick = resign;
  $('btn-draw').onclick = offerDraw;
  $('btn-export').onclick = exportPgn;
  $('btn-import').onclick = openImport;
  $('nav-first').onclick = () => setView(0);
  $('nav-prev').onclick = () => setView(currentPly() - 1);
  $('nav-next').onclick = () => setView(currentPly() + 1);
  $('nav-last').onclick = goLive;
  $('btn-copy-fen').onclick = () => navigator.clipboard?.writeText($('fen').value).then(() => toast('FEN copied.'), () => toast('Couldn’t copy. Select the FEN and copy it manually.'));
  $('theme').onchange = (e) => { state.settings.theme = e.target.value; save(); render(); };
  $('opt-hints').onchange = (e) => { state.settings.hints = e.target.checked; save(); render(); };

  const newForm = $('dlg-new').querySelector('form');
  newForm.addEventListener('change', syncNewGameForm);
  $('dlg-new').addEventListener('close', () => {
    if ($('dlg-new').returnValue !== 'start') return;
    startGame({
      mode: newForm.mode.value,
      level: Number(newForm.level.value) || 3,
      humanColor: newForm.side.value,
      clock: parseClock(newForm.clock.value),
    });
  });

  $('tab-pgn').onclick = () => setImportKind('pgn');
  $('tab-fen').onclick = () => setImportKind('fen');
  $('btn-import-load').onclick = doImport;
  $('import-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    $('import-text').value = text;
    setImportKind(/^\s*([rnbqkpRNBQKP1-8]+\/){7}/.test(text) ? 'fen' : 'pgn');
    $('import-text').value = text;
    e.target.value = '';
  };

  $('go-new').onclick = () => { $('dlg-over').close(); openNewGame(); };
  $('go-export').onclick = exportPgn;

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || board.promo || e.target.closest?.('.board')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setView(currentPly() - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setView(currentPly() + 1); }
    else if (e.key === 'Escape' && state.selected) { state.selected = null; render(); }
  });
}

initLevelOptions();
wire();
if (restore()) {
  render();
  maybeEngineMove();
} else {
  startGame({});
}
