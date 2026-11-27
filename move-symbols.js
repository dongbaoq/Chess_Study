/** Move symbols belong to a complete SAN path in one game or opening. */
export const MOVE_SYMBOL_LABELS = Object.freeze({
  '?': 'Mistake',
  '!': 'Only move',
  '□': 'Only move', // Legacy symbol: retain stored data and display as !.
  '!!': 'Brilliant move',
  '??': 'Blunder'
});

const symbolIsKnown = symbol => typeof symbol === 'string' && Object.hasOwn(MOVE_SYMBOL_LABELS, symbol);
const validPath = moves => Array.isArray(moves) && moves.length > 0 && moves.every(move => typeof move === 'string' && move.length > 0 && !/\s/.test(move));
const readableMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalidData = () => ({ok:false, error:'Saved move symbols could not be read. The original data was preserved.'});

/** Read recognized symbols without changing unfamiliar fields or values. */
export function readMoveSymbols(entity) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return invalidData();
  if (!Object.hasOwn(entity, 'moveSymbols')) return {ok:true, symbols:{}};
  if (!readableMap(entity.moveSymbols)) return invalidData();
  return {ok:true, symbols:Object.fromEntries(Object.entries(entity.moveSymbols).filter(([, symbol]) => symbolIsKnown(symbol)).map(([key,symbol]) => [key,symbol === '□' ? '!' : symbol]))};
}

/**
 * Add, replace, or clear a symbol on exactly one path. An unfamiliar value at
 * that path is protected; other unrecognized values and fields are retained.
 */
export function setMoveSymbol(entity, moves, symbol) {
  if (!validPath(moves)) return {ok:false, error:'Select a move before adding a symbol.'};
  if (symbol !== '' && !symbolIsKnown(symbol)) return {ok:false, error:'Choose a valid move symbol.'};
  const result = readMoveSymbols(entity);
  if (!result.ok) return result;
  const key = moves.join(' '), map = entity.moveSymbols;
  if (map && Object.hasOwn(map, key) && !symbolIsKnown(map[key])) {
    return {ok:false, error:'This move has an unrecognized saved symbol. The original data was preserved.'};
  }
  const previous = map && Object.hasOwn(map, key) ? map[key] : '';
  if ((previous === '□' ? '!' : previous) === symbol) return {ok:true, changed:false};
  if (!map) entity.moveSymbols = {};
  if (symbol === '') delete entity.moveSymbols[key];
  else entity.moveSymbols[key] = symbol;
  return {ok:true, changed:true};
}

// Fixed vector artwork keeps annotations legible without relying on a font.
const BOARD_SYMBOL_ICONS = Object.freeze({
  '!': '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><rect x="10" y="3" width="4" height="12" rx="2" fill="currentColor"/><circle cx="12" cy="19" r="2.2" fill="currentColor"/></svg>',
  '!!': '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><rect x="5" y="3" width="4" height="12" rx="2" fill="currentColor"/><circle cx="7" cy="19" r="2.2" fill="currentColor"/><rect x="15" y="3" width="4" height="12" rx="2" fill="currentColor"/><circle cx="17" cy="19" r="2.2" fill="currentColor"/></svg>',
  '?': '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="M7.7 8.3c0-2.6 1.8-4.3 4.4-4.3 2.6 0 4.3 1.6 4.3 3.9 0 2-1.1 3-2.6 4.1-1.1.8-1.8 1.5-1.8 3" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><circle cx="12" cy="19.5" r="2" fill="currentColor"/></svg>',
  '??': '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="M2 8c0-2.4 1.5-4 3.8-4s3.8 1.5 3.8 3.6c0 1.8-1 2.7-2.3 3.7-1 .8-1.5 1.4-1.5 2.8M14.4 8c0-2.4 1.5-4 3.8-4S22 5.5 22 7.6c0 1.8-1 2.7-2.3 3.7-1 .8-1.5 1.4-1.5 2.8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><circle cx="5.8" cy="19" r="1.8" fill="currentColor"/><circle cx="18.2" cy="19" r="1.8" fill="currentColor"/></svg>'
});

/** Display the current move's saved symbol without changing board markings. */
export function renderBoardMoveSymbol(board, lastMove, symbol, flipped = false) {
  const host = board?.parentElement;
  if (!host) return;
  let badge = host.querySelector('.board-move-symbol');
  for (const square of board.querySelectorAll('[data-symbol-base-label]')) {
    square.setAttribute('aria-label', square.dataset.symbolBaseLabel);
    delete square.dataset.symbolBaseLabel;
    delete square.dataset.moveSymbolTone;
  }
  const kind = Object.hasOwn(BOARD_SYMBOL_ICONS, symbol) ? {'!':'only','!!':'brilliant','?':'question','??':'blunder'}[symbol] : null;
  const destination = lastMove?.to;
  if (!kind || !/^[a-h][1-8]$/.test(destination || '')) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = board.ownerDocument.createElement('span');
    badge.setAttribute('aria-hidden', 'true');
    host.appendChild(badge);
  }
  let column = destination.charCodeAt(0) - 97, row = 8 - Number(destination[1]);
  if (flipped) { column = 7 - column; row = 7 - row; }
  badge.className = `board-move-symbol symbol-${kind}`;
  badge.dataset.edgeRight = String(column === 7);
  badge.dataset.edgeTop = String(row === 0);
  badge.style.left = `${(column + 1) * 12.5}%`;
  badge.style.top = `${row * 12.5}%`;
  badge.innerHTML = BOARD_SYMBOL_ICONS[symbol];
  const square = board.querySelector(`[data-square="${destination}"]`);
  if (square) {
    square.dataset.moveSymbolTone = kind;
    square.dataset.symbolBaseLabel = square.getAttribute('aria-label') || destination;
    square.setAttribute('aria-label', `${square.dataset.symbolBaseLabel}, ${MOVE_SYMBOL_LABELS[symbol]}`);
  }
}
