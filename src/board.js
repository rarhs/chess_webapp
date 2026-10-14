// Board view: 64 real <button>s (so keyboard and screen readers work), click-to-move,
// pointer-based drag and drop, and the promotion picker. It holds no game rules;
// main.js tells it what to draw and receives square clicks / drops back.

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
    this.squares = new Map();
    this.drag = null;
    this.promo = null;
    this.build();
  }

  build() {
    this.root.classList.add('board');
    this.root.setAttribute('role', 'grid');
    for (let i = 0; i < 64; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sq';
      b.innerHTML = '<span class="piece" aria-hidden="true"></span><span class="coord rank" aria-hidden="true"></span><span class="coord file" aria-hidden="true"></span>';
      this.root.appendChild(b);
    }
    this.cells = [...this.root.querySelectorAll('.sq')];

    this.root.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.root.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.root.addEventListener('pointerup', (e) => this.pointerUp(e));
    this.root.addEventListener('pointercancel', () => this.endDrag());
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
      cell.dataset.square = sq;
      cell.className = 'sq ' + (light ? 'light' : 'dark');
      if (view.lastMove && (view.lastMove.from === sq || view.lastMove.to === sq)) cell.classList.add('last');
      if (view.selected === sq) cell.classList.add('selected');
      if (view.check === sq) cell.classList.add('check');
      if (targets.has(sq)) cell.classList.add(piece ? 'target-capture' : 'target');
      const p = cell.firstChild;
      p.textContent = piece ? glyph(piece.type) : '';
      p.className = 'piece' + (piece ? (piece.color === 'w' ? ' white' : ' black') : '');
      if (this.drag && this.drag.from === sq && this.drag.active) p.classList.add('lifted');
      const isLeftCol = i % 8 === 0, isBottomRow = i >= 56;
      cell.children[1].textContent = isLeftCol ? String(rank) : '';
      cell.children[2].textContent = isBottomRow ? sq[0] : '';
      let label = sq;
      if (piece) label += `, ${piece.color === 'w' ? 'white' : 'black'} ${NAME[piece.type]}`;
      if (view.selected === sq) label += ', selected';
      if (targets.has(sq)) label += ', legal move';
      cell.setAttribute('aria-label', label);
    });
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
    e.preventDefault(); // no text selection / focus flicker while dragging
    if (this.canDrag(sq)) {
      this.drag = { from: sq, x: e.clientX, y: e.clientY, active: false, pointerId: e.pointerId };
      this.root.setPointerCapture(e.pointerId);
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
  choosePromotion(square, color) {
    this.closePromotion(null);
    return new Promise((resolve) => {
      const idx = this.cells.findIndex((c) => c.dataset.square === square);
      const col = idx % 8;
      const fromTop = Math.floor(idx / 8) === 0;
      const wrap = document.createElement('div');
      wrap.className = 'promo-backdrop';
      const list = document.createElement('div');
      list.className = 'promo';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Promote pawn to');
      list.style.left = `${col * 12.5}%`;
      list.style[fromTop ? 'top' : 'bottom'] = '0';
      const pieces = [['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']];
      if (!fromTop) pieces.reverse();
      for (const [p, name] of pieces) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.setAttribute('aria-label', name);
        b.className = 'piece ' + (color === 'w' ? 'white' : 'black');
        b.textContent = glyph(p);
        b.addEventListener('click', (e) => { e.stopPropagation(); this.closePromotion(p); });
        list.appendChild(b);
      }
      wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) this.closePromotion(null); });
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closePromotion(null); } };
      document.addEventListener('keydown', onKey);
      wrap.appendChild(list);
      this.root.parentElement.appendChild(wrap);
      this.promo = { wrap, resolve, onKey };
      list.querySelector('button').focus();
    });
  }

  closePromotion(choice) {
    if (!this.promo) return;
    const { wrap, resolve, onKey } = this.promo;
    this.promo = null;
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    resolve(choice);
  }
}
