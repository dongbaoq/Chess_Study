/** Saved game analysis paths. Paths use full SAN move sequences from the start,
 * so they can share prefixes and game position notes remain tied to their line.
 * Existing fields on the game and on variation records are never rewritten.
 */
const validMoves = moves => Array.isArray(moves) && moves.every(move => typeof move === 'string' && move.length > 0);
export const isMovePrefix = (prefix, moves) => validMoves(prefix) && validMoves(moves) && prefix.length <= moves.length && prefix.every((move, i) => move === moves[i]);

/** Return readable paths without changing unrecognized stored records. */
export function getAnalysisVariations(game) {
  if (!Array.isArray(game?.analysisVariations)) return [];
  return game.analysisVariations.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && validMoves(entry.moves)).map(entry => entry.moves.slice());
}

/** Add one complete path. Do not replace a field with an unknown format. */
export function saveAnalysisVariation(game, moves) {
  if (!game || typeof game !== 'object' || !validMoves(moves) || !moves.length) return {ok:false, error:'The analysis move line is invalid.'};
  if (game.analysisVariations !== undefined && !Array.isArray(game.analysisVariations)) return {ok:false, error:'Saved analysis lines could not be read; the original data was preserved.'};
  const existing = game.analysisVariations || [];
  if (existing.some(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && validMoves(entry.moves) && entry.moves.length === moves.length && isMovePrefix(entry.moves, moves))) return {ok:true, changed:false};
  if (!game.analysisVariations) game.analysisVariations = [];
  game.analysisVariations.push({moves:moves.slice()});
  return {ok:true, changed:true};
}

/** Delete recognized paths at or below a move. Other records and notes remain. */
export function deleteAnalysisVariation(game, prefix) {
  if (!game || !validMoves(prefix) || !prefix.length) return {ok:false, error:'The analysis move line is invalid.'};
  if (game.analysisVariations !== undefined && !Array.isArray(game.analysisVariations)) return {ok:false, error:'Saved analysis lines could not be read; the original data was preserved.'};
  if (!game.analysisVariations) return {ok:true, changed:false};
  let changed = false;
  for (let i = game.analysisVariations.length - 1; i >= 0; i--) {
    const entry = game.analysisVariations[i];
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && validMoves(entry.moves) && isMovePrefix(prefix, entry.moves)) {
      game.analysisVariations.splice(i, 1); changed = true;
    }
  }
  return {ok:true, changed};
}
