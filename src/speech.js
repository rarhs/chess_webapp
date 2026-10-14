// Plain-language descriptions of moves for the screen-reader live region.
// Spoken SAN ("Nxe4+") is unclear, so moves are described in words.

const PIECE = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const COLOR = { w: 'White', b: 'Black' };

// move: a chess.js verbose Move
export function describeMove(move) {
  let text;
  if (move.san.startsWith('O-O-O')) text = 'castles queenside';
  else if (move.san.startsWith('O-O')) text = 'castles kingside';
  else {
    const piece = PIECE[move.piece];
    text = move.captured
      ? `${piece} on ${move.from} takes ${PIECE[move.captured]} on ${move.to}`
      : `${piece} ${move.from} to ${move.to}`;
    if (move.flags.includes('e')) text += ' en passant';
    if (move.promotion) text += `, promotes to ${PIECE[move.promotion]}`;
  }
  if (move.san.endsWith('#')) text += ', checkmate';
  else if (move.san.endsWith('+')) text += ', check';
  return `${COLOR[move.color]} ${text}.`;
}

// What to say after a move: the move, then the outcome or whose turn it is.
// `status` is Game#status(); `you` is the human's colour in a computer game (else null).
export function announceAfterMove(move, status, you = null) {
  const parts = [describeMove(move)];
  if (status.over) {
    if (status.reason !== 'checkmate') parts.push(status.title);
    else parts.push(`${status.title.replace(/^Checkmate\. /, '')}`);
  } else {
    const next = move.color === 'w' ? 'b' : 'w';
    parts.push(you ? (next === you ? 'Your move.' : 'Computer to move.') : `${COLOR[next]} to move.`);
  }
  return parts.join(' ');
}
