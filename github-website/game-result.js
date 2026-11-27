// Read a recorded PGN result without changing the game or guessing a winner.
const RESULT_TOKENS = new Set(['1-0','0-1','1/2-1/2','*']);

/** Read result tags and mainline termination tokens, ignoring comments and variations. */
export function parseGameResult(pgn) {
  if (typeof pgn !== 'string') return null;
  const tags = [], mainline = []; let variation = 0, brace = 0, lineComment = false;
  for (let i = 0; i < pgn.length; i++) {
    const ch = pgn[i];
    if (lineComment) { if (ch === '\n' || ch === '\r') { lineComment = false; mainline.push(' '); } continue; }
    if (brace) { if (ch === '}') brace--; else if (ch === '{') brace++; continue; }
    if (ch === '{') { brace++; mainline.push(' '); continue; }
    if (ch === ';' || (ch === '%' && (i === 0 || pgn[i-1] === '\n' || pgn[i-1] === '\r'))) { lineComment = true; mainline.push(' '); continue; }
    if (ch === '(') { variation++; mainline.push(' '); continue; }
    if (ch === ')') { if (variation) variation--; mainline.push(' '); continue; }
    if (ch === '[') {
      let end = i + 1, quoted = false, escaped = false;
      for (; end < pgn.length; end++) {
        const c = pgn[end];
        if (quoted && escaped) { escaped = false; continue; }
        if (quoted && c === '\\') { escaped = true; continue; }
        if (c === '"') { quoted = !quoted; continue; }
        if (c === ']' && !quoted) break;
      }
      if (end >= pgn.length) return null;
      if (!variation) {
        const tag = pgn.slice(i, end+1).match(/^\[\s*Result\s+"([^"\\]*)"\s*\]$/i);
        if (tag) tags.push(tag[1]);
      }
      i = end; mainline.push(' '); continue;
    }
    if (!variation) mainline.push(ch);
  }
  if (brace || variation) return null;
  const tokens = mainline.join('').trim().split(/\s+/).filter(Boolean);
  const resultTokens = tokens.filter(token => RESULT_TOKENS.has(token));
  if (tags.some(value => !RESULT_TOKENS.has(value))) return null;
  // A termination marker must end the actual played moves.
  if (resultTokens.length && !RESULT_TOKENS.has(tokens.at(-1))) return null;
  const all = [...tags, ...resultTokens];
  if (!all.length || all.some(value => value !== all[0]) || all[0] === '*') return null;
  return all[0];
}

/** Return a result only at the recorded game's final position, never a branch. */
export function resultAtPosition(game, moves, index, playedMoves) {
  if (!game || !Array.isArray(moves) || !Array.isArray(playedMoves) || !playedMoves.length || index !== playedMoves.length || moves.length < index || !playedMoves.every((move, i) => moves[i] === move)) return null;
  return parseGameResult(game.pgn);
}

export function resultLabel(result) {
  if (result === '1-0') return 'White won · Black lost';
  if (result === '0-1') return 'Black won · White lost';
  if (result === '1/2-1/2') return 'Draw';
  return '';
}

/** Labels follow the board orientation, not the chosen repertoire. */
export function getResultSides(result, flipped = false) {
  const white = result === '1-0' ? 'White · Win' : result === '0-1' ? 'White · Loss' : result === '1/2-1/2' ? 'White · Draw' : '';
  const black = result === '0-1' ? 'Black · Win' : result === '1-0' ? 'Black · Loss' : result === '1/2-1/2' ? 'Black · Draw' : '';
  return flipped ? {top:white,bottom:black} : {top:black,bottom:white};
}
