// Minimal UCI client for Stockfish. The transport is injected so the same code
// drives a Web Worker in the browser and a child process in tests.

export const LEVELS = [
  { id: 1, name: 'Beginner', detail: 'Skill 0', skill: 0, go: 'go depth 1' },
  { id: 2, name: 'Casual', detail: 'Skill 5', skill: 5, go: 'go depth 5' },
  { id: 3, name: 'Club', detail: 'Skill 10', skill: 10, go: 'go depth 10 movetime 1500' },
  { id: 4, name: 'Strong', detail: 'Skill 20', skill: 20, go: 'go movetime 2000' },
];

export function levelById(id) {
  return LEVELS.find((l) => l.id === Number(id)) || LEVELS[2];
}

export class Engine {
  constructor(transport) {
    this.t = transport;
    this.waiters = []; // FIFO of { match, resolve } for one-shot replies (uciok, readyok)
    this.searches = []; // FIFO: UCI answers every `go` with exactly one `bestmove`
    this.lastScore = null; // side-to-move centipawns from the last finished search ({cp} or {mate})
    this.pendingScore = null;
    this.t.onLine((line) => this.handle(line));
    this.ready = this.init();
  }

  async init() {
    this.t.post('uci');
    await this.waitFor((l) => l === 'uciok');
    this.t.post('setoption name Threads value 1');
    await this.isReady();
  }

  isReady() {
    this.t.post('isready');
    return this.waitFor((l) => l === 'readyok');
  }

  waitFor(match) {
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  handle(raw) {
    const line = String(raw).trim();
    if (!line) return;
    const i = this.waiters.findIndex((w) => w.match(line));
    if (i >= 0) {
      this.waiters.splice(i, 1)[0].resolve(line);
      return;
    }
    if (line.startsWith('info') && / score /.test(line)) {
      const m = line.match(/score (cp|mate) (-?\d+)/);
      if (m) this.pendingScore = { [m[1]]: Number(m[2]) };
    } else if (line.startsWith('bestmove')) {
      const s = this.searches.shift();
      const move = line.split(/\s+/)[1];
      this.lastScore = this.pendingScore;
      this.pendingScore = null;
      if (s) s.resolve(s.cancelled || !move || move === '(none)' ? null : move);
    }
  }

  // Resolves with a UCI move string, or null if the search was cancelled.
  async bestMove(fen, level) {
    await this.ready;
    this.cancel();
    const lv = typeof level === 'object' ? level : levelById(level);
    this.t.post(`setoption name Skill Level value ${lv.skill}`);
    this.t.post('ucinewgame');
    this.t.post(`position fen ${fen}`);
    return new Promise((resolve) => {
      this.searches.push({ resolve, cancelled: false });
      this.t.post(lv.go);
    });
  }

  // Any in-flight search still answers with a bestmove; we just ignore it.
  cancel() {
    if (this.searches.length) {
      for (const s of this.searches) s.cancelled = true;
      this.t.post('stop');
    }
  }

  get thinking() {
    return this.searches.some((s) => !s.cancelled);
  }

  quit() {
    this.cancel();
    this.t.post('quit');
    this.t.close?.();
  }
}

export function workerTransport(url) {
  const worker = new Worker(url);
  let handler = () => {};
  worker.onmessage = (e) => handler(typeof e.data === 'string' ? e.data : String(e.data));
  return {
    post: (cmd) => worker.postMessage(cmd),
    onLine: (fn) => { handler = fn; },
    close: () => worker.terminate(),
    onError: (fn) => { worker.onerror = fn; },
  };
}
