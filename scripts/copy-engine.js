// Copies the single-threaded "lite" Stockfish build into public/engine so it is
// served as a static Web Worker. Single-threaded needs no SharedArrayBuffer, so
// the site works on any static host without COOP/COEP headers.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'src');
if (!existsSync(src)) {
  console.warn('stockfish package not installed yet; skipping engine copy');
  process.exit(0);
}
const js = readdirSync(src).find((f) => /^stockfish-[\d.]+-lite-single-[0-9a-f]+\.js$/.test(f));
if (!js) throw new Error('Could not find the lite single-threaded Stockfish build');
const out = join(root, 'public', 'engine');
mkdirSync(out, { recursive: true });
// The engine looks for its .wasm next to itself under the same base name.
copyFileSync(join(src, js), join(out, 'stockfish.js'));
copyFileSync(join(src, js.replace(/\.js$/, '.wasm')), join(out, 'stockfish.wasm'));
console.log(`Copied ${js} to public/engine/stockfish.js (+ .wasm)`);
