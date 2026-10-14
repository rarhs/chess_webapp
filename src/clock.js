// "600+5" -> { base: 600, inc: 5 } (seconds); empty -> null
export function parseClock(value) {
  const m = /^(\d+)\+(\d+)$/.exec(String(value || ''));
  return m ? { base: Number(m[1]), inc: Number(m[2]) } : null;
}

// Milliseconds -> "m:ss", or "s.t" under 20 seconds.
export function formatClock(ms) {
  const t = Math.max(0, ms);
  if (t < 20000) return (Math.floor(t / 100) / 10).toFixed(1);
  const total = Math.ceil(t / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
