// Board view: an ARIA grid (8 rows x 8 gridcells) that is a single tab stop with
// arrow-key navigation (roving tabindex), click-to-move, pointer drag and drop,
// and the promotion picker. It holds no game rules; main.js tells it what to draw
// and receives square activations / drops back.

const FILES = 'abcdefgh';
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const VS = '︎'; // text presentation, so no emoji pawns

export const glyph = (type) => GLYPH[type] + VS;

export class Board {
  constructor(root, { onSquare, onDrop, canDrag }) {
    this.root = root;
    this.onSquare = onSquare;
    this.onDrop = onDrop;
    this.canDrag = canDrag;
    this.orientation = 'w';
    this.cursor = null; // square holding the roving tab stop
    this.drag = null;
    this.promo = null;
    this.build();
  }

  build() {
    this.root.classList.add('board');
    this.root.setAttribute('role', 'grid');
    this.root.setAttribute('aria-describedby', 'board-help');
    this.cells = [];
    for (let r = 0; r < 8; r++) {
      const row = document.createElement('div');
      row.className = 'rank';
      row.setAttribute('role', 'row');
      for (let c = 0; c < 8; c++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sq';
        b.setAttribute('role', 'gridcell');
        b.tabIndex = -1;
        b.innerHTML = '<span class="piece" aria-hidden="true"></span><span class="coord rank-label" aria-hidden="true"></span><span class="coord file-label" aria-hidden="true"></span>';
        row.appendChild(b);
        this.cells.push(b);
      }
      this.root.appendChild(row);
    }

    this.root.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.root.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.root.addEventListener('pointerup', (e) => this.pointerUp(e));
    this.root.addEventListener('pointercancel', () => this.endDrag());
    this.root.addEventListener('keydown', (e) => this.keyDown(e));
    this.root.addEventListener('focusin', (e) => {
      const cell = e.target.closest('.sq');
      if (cell) this.setCursor(cell.dataset.square);
    });
    // Keyboard activation (Enter/Space) arrives as a click with detail 0.
    this.root.addEventListener('click', (e) => {
      const cell = e.target.closest('.sq');
      if (cell && e.detail === 0) this.onSquare(cell.dataset.square);
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  squareOfIndex(i) {
    const r = Math.floor(i / 8), c = i % 8;
    return this.orientation === 'w' ? FILES[c] + (8 - r) : FILES[7 - c] + (r + 1);
  }

  indexOfSquare(sq) {
    const c = FILES.indexOf(sq[0]), rank = Number(sq[1]);
    return this.orientation === 'w' ? (8 - rank) * 8 + c : (rank - 1) * 8 + (7 - c);
  }

  cellOf(sq) { return this.cells[this.indexOfSquare(sq)]; }

  setCursor(sq, { focus = false } = {}) {
    if (!sq) return;
    if (this.cursor !== sq) {
      if (this.cursor) this.cellOf(this.cursor).tabIndex = -1;
      this.cursor = sq;
    }
    const cell = this.cellOf(sq);
    cell.tabIndex = 0;
    if (focus) cell.focus();
  }

  hasFocus() { return this.root.contains(document.activeElement); }

  // Arrow keys move in screen directions, so they follow the board's orientation.
  keyDown(e) {
    if (this.promo || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = this.indexOfSquare(this.cursor || this.squareOfIndex(56));
    let r = Math.floor(i / 8), c = i % 8;
    switch (e.key) {
      case 'ArrowUp': r = Math.max(0, r - 1); break;
      case 'ArrowDown': r = Math.min(7, r + 1); break;
      case 'ArrowLeft': c = Math.max(0, c - 1); break;
      case 'ArrowRight': c = Math.min(7, c + 1); break;
      case 'Home': c = 0; break;
      case 'End': c = 7; break;
      case 'PageUp': r = 0; break;
      case 'PageDown': r = 7; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.setCursor(this.squareOfIndex(r * 8 + c), { focus: true });
  }

  // view: { board (chess.js 8x8), lastMove {from,to}, check (square), selected, targets [], interactive, legalHints }
  render(view) {
    this.view = view;
    this.root.setAttribute('aria-label', `Chessboard, ${this.orientation === 'w' ? 'White' : 'Black'} at bottom`);
    this.root.classList.toggle('interactive', !!view.interactive);
    const targets = new Set(view.legalHints ? view.targets || [] : []);
    this.cells.forEach((cell, i) => {
      const sq = this.squareOfIndex(i);
      const file = FILES.indexOf(sq[0]);
      const rank = Number(sq[1]);
      const piece = view.board[8 - rank][file];
      const light = (file + rank) % 2 === 1;
      const isLast = view.lastMove && (view.lastMove.from === sq || view.lastMove.to === sq);
      cell.dataset.square = sq;
      cell.className = 'sq ' + (light ? 'light' : 'dark');
      if (isLast) cell.classList.add('last');
      if (view.selected === sq) cell.classList.add('selected');
      if (view.check === sq) cell.classList.add('check');
      if (targets.has(sq)) cell.classList.add(piece ? 'target-capture' : 'target');
      const p = cell.firstChild;
      p.textContent = piece ? glyph(piece.type) : '';
      p.className = 'piece' + (piece ? (piece.color === 'w' ? ' white' : ' black') : '');
      if (this.drag && this.drag.from === sq && this.drag.active) p.classList.add('lifted');
      cell.children[1].textContent = i % 8 === 0 ? String(rank) : '';
      cell.children[2].textContent = i >= 56 ? sq[0] : '';
      const parts = [sq];
      parts.push(piece ? `${piece.color === 'w' ? 'white' : 'black'} ${NAME[piece.type]}` : 'empty');
      if (view.selected === sq) parts.push('selected');
      if (view.check === sq) parts.push('in check');
      if (targets.has(sq)) parts.push(piece ? 'can capture' : 'legal move');
      if (isLast) parts.push(view.lastMove.from === sq ? 'last move from' : 'last move to');
      cell.setAttribute('aria-label', parts.join(', '));
      cell.tabIndex = sq === this.cursor ? 0 : -1;
    });
    if (!this.cursor) this.setCursor(this.squareOfIndex(56));
  }

  squareFromPoint(x, y) {
    const r = this.root.getBoundingClientRect();
    const c = Math.floor(((x - r.left) / r.width) * 8);
    const row = Math.floor(((y - r.top) / r.height) * 8);
    if (c < 0 || c > 7 || row < 0 || row > 7) return null;
    return this.squareOfIndex(row * 8 + c);
  }

  pointerDown(e) {
    if (e.button !== 0 || this.promo) return;
    const cell = e.target.closest('.sq');
    if (!cell) return;
    const sq = cell.dataset.square;
    e.preventDefault(); // no text selection while dragging
    this.setCursor(sq);
    if (this.canDrag(sq)) {
      this.drag = { from: sq, x: e.clientX, y: e.clientY, active: false, pointerId: e.pointerId };
      this.root.setPointerCapture?.(e.pointerId);
    } else {
      this.drag = null;
    }
    this.downSquare = sq;
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
      d.active = true;
      const size = this.root.getBoundingClientRect().width / 8;
      const piece = this.view.board[8 - Number(d.from[1])][FILES.indexOf(d.from[0])];
      const ghost = document.createElement('span');
      ghost.className = 'piece ghost ' + (piece.color === 'w' ? 'white' : 'black');
      ghost.textContent = glyph(piece.type);
      ghost.style.fontSize = `${size * 0.78}px`;
      ghost.style.width = ghost.style.height = `${size}px`;
      document.body.appendChild(ghost);
      d.ghost = ghost;
      d.size = size;
      this.onSquare(d.from, { dragStart: true }); // select it so targets show
    }
    if (d.active) {
      d.ghost.style.transform = `translate(${e.clientX - d.size / 2}px, ${e.clientY - d.size / 2}px)`;
      const over = this.squareFromPoint(e.clientX, e.clientY);
      this.cells.forEach((c) => c.classList.toggle('hover', c.dataset.square === over));
    }
  }

  pointerUp(e) {
    const d = this.drag;
    if (d && d.active) {
      const to = this.squareFromPoint(e.clientX, e.clientY);
      this.endDrag();
      if (to && to !== d.from) this.onDrop(d.from, to);
      else this.render(this.view);
      return;
    }
    this.endDrag();
    const cell = e.target.closest('.sq');
    const sq = cell ? cell.dataset.square : this.squareFromPoint(e.clientX, e.clientY);
    if (sq && sq === this.downSquare) this.onSquare(sq);
    this.downSquare = null;
  }

  endDrag() {
    if (this.drag?.ghost) this.drag.ghost.remove();
    if (this.drag && this.root.hasPointerCapture?.(this.drag.pointerId)) this.root.releasePointerCapture(this.drag.pointerId);
    this.drag = null;
    this.cells.forEach((c) => c.classList.remove('hover'));
  }

  // Shows Q/R/B/N over the promotion square; resolves with the piece letter or null.
  // Focus then returns to the board: the promotion square, or `from` if cancelled.
  choosePromotion(square, color, from = square) {
    this.closePromotion(null);
    return new Promise((resolve) => {
      const idx = this.indexOfSquare(square);
      const col = idx % 8;
      const fromTop = Math.floor(idx / 8) === 0;
      const wrap = document.createElement('div');
      wrap.className = 'promo-backdrop';
      const list = document.createElement('div');
      list.className = 'promo';
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', 'Promote pawn to');
      list.style.left = `${col * 12.5}%`;
      list.style[fromTop ? 'top' : 'bottom'] = '0';
      const pieces = [['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']];
      if (!fromTop) pieces.reverse();
      const buttons = [];
      for (const [p, name] of pieces) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', name);
        b.className = 'piece ' + (color === 'w' ? 'white' : 'black');
        b.textContent = glyph(p);
        b.addEventListener('click', (e) => { e.stopPropagation(); this.closePromotion(p); });
        list.appendChild(b);
        buttons.push(b);
      }
      wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) this.closePromotion(null); });
      // Escape cancels; Up/Down move between choices; Tab stays inside the picker.
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); this.closePromotion(null); return; }
        const i = buttons.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
        }
      };
      document.addEventListener('keydown', onKey, true);
      wrap.appendChild(list);
      this.root.parentElement.appendChild(wrap);
      this.promo = { wrap, resolve, onKey, square, from };
      buttons[fromTop ? 0 : buttons.length - 1].focus();
    });
  }

  closePromotion(choice) {
    if (!this.promo) return;
    const { wrap, resolve, onKey, square, from } = this.promo;
    this.promo = null;
    document.removeEventListener('keydown', onKey, true);
    wrap.remove();
    this.setCursor(choice ? square : from, { focus: true });
    resolve(choice);
  }
}
