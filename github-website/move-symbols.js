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
