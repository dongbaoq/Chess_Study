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

// Font Awesome Free 6.7.2 “exclamation” and “question” icons, by Fonticons, Inc.
// CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . Source and changes:
// https://github.com/FortAwesome/Font-Awesome/tree/6.7.2/svgs/solid
// Icons are recolored, resized and duplicated for paired move annotations.
const FA_EXCLAMATION_PATH = 'M96 64c0-17.7-14.3-32-32-32S32 46.3 32 64l0 256c0 17.7 14.3 32 32 32s32-14.3 32-32L96 64zM64 480a40 40 0 1 0 0-80 40 40 0 1 0 0 80z';
const FA_QUESTION_PATH = 'M80 160c0-35.3 28.7-64 64-64l32 0c35.3 0 64 28.7 64 64l0 3.6c0 21.8-11.1 42.1-29.4 53.8l-42.2 27.1c-25.2 16.2-40.4 44.1-40.4 74l0 1.4c0 17.7 14.3 32 32 32s32-14.3 32-32l0-1.4c0-8.2 4.2-15.8 11-20.2l42.2-27.1c36.6-23.6 58.8-64.1 58.8-107.7l0-3.6c0-70.7-57.3-128-128-128l-32 0C73.3 32 16 89.3 16 160c0 17.7 14.3 32 32 32s32-14.3 32-32zm80 320a40 40 0 1 0 0-80 40 40 0 1 0 0 80z';
// Normalize each composition to a square canvas. The question pair keeps
// its original proportions and is centered as two equally scaled icons.
const iconPath = (path, x, scaleX, y = 26, scaleY = 0.9) => `<path fill="currentColor" transform="translate(${x} ${y}) scale(${scaleX} ${scaleY})" d="${path}"/>`;
const iconSvg = contents => `<svg viewBox="0 0 512 512" aria-hidden="true"><!--! Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2024 Fonticons, Inc. -->${contents}</svg>`;
export const BOARD_SYMBOL_ICONS = Object.freeze({
  '!': iconSvg(iconPath(FA_EXCLAMATION_PATH, 176, 1.25)),
  '!!': iconSvg(iconPath(FA_EXCLAMATION_PATH, 110, 1.25) + iconPath(FA_EXCLAMATION_PATH, 242, 1.25)),
  '?': iconSvg(iconPath(FA_QUESTION_PATH, 104, 0.95)),
  '??': iconSvg(iconPath(FA_QUESTION_PATH, 0, 0.8, 51.2, 0.8) + iconPath(FA_QUESTION_PATH, 256, 0.8, 51.2, 0.8))
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
