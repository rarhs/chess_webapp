# Chess

A browser chess app: play another person on the same device, or Stockfish at four difficulty levels. Static site, no server code.

- Rules from [chess.js](https://github.com/jhlywa/chess.js): castling, en passant, promotion (including underpromotion), check, checkmate, stalemate, threefold repetition, the fifty-move rule and insufficient material. Illegal moves are rejected.
- Computer opponent: [Stockfish 17.1](https://github.com/nmrugg/stockfish.js) (lite, single-threaded WASM) in a Web Worker. Levels map to Stockfish's Skill Level 0 / 5 / 10 / 20 with increasing search depth/time.
- Click or drag to move, legal-move highlighting, last move and check shown, promotion picker.
- New game (mode, difficulty, play as White / Random / Black, optional clock), undo, resign, offer draw, flip board.
- Move list in SAN with browsing (click a move, or ← / →), PGN export (download + clipboard), PGN/FEN import with validation. A failed import leaves the current game untouched.
- The current game is saved in the browser and restored on reload.

## Develop

```sh
npm install        # also copies the Stockfish build into public/engine/
npm run dev        # http://localhost:5173
npm test           # rules + engine tests
npm run build      # static site in dist/
npm run preview    # serve dist/ locally
```

## Deploy

Upload `dist/` to any static host (GitHub Pages, Netlify, S3, nginx…). Paths are relative, so a subfolder works too. The engine is single-threaded, so no COOP/COEP headers are needed. Serve `.wasm` as `application/wasm` (most hosts already do).

## Rules notes

- Threefold repetition and the fifty-move rule **end the game automatically** when they occur, rather than waiting for a claim.
- Positions count as repeated only when the side to move, castling rights and a *legal* en passant capture are also the same (FIDE 9.2).
- Checkmate takes precedence over the fifty-move rule on the same move.
- Running out of time is a draw if the opponent has only a king, or a king and one minor piece.
- Resignation, a flag fall or an agreed draw can't be undone. Checkmate and the automatic draws can.

## Layout

- `src/game.js`: game state and adjudication on top of chess.js (no DOM)
- `src/engine.js`: UCI client; transport-agnostic (Web Worker in the browser, child process in tests)
- `src/board.js`: board rendering, click/drag input, promotion picker
- `src/main.js`: app wiring, dialogs, clocks, persistence
- `tests/rules.test.js`: rules edge cases; `tests/engine.test.js` runs the real Stockfish build
