import { parseLine } from './library.js';

// Cache canonical SAN for each folder object and invalidate it when its line is
// edited. Invalid and empty lines are not opening matches.
const openingLineCache = new WeakMap();
function openingMoves(folder) {
  const text = typeof folder.line === 'string' ? folder.line : '';
  const cached = openingLineCache.get(folder);
  if (cached && cached.text === text) return cached.moves;
  const parsed = parseLine(text);
  const moves = parsed.ok ? parsed.moves : [];
  openingLineCache.set(folder, {text, moves});
  return moves;
}

function openingDepth(folder, byId, side) {
  const seen = new Set([folder.id]);
  let depth = 1, parentId = folder.parentId;
  while (parentId != null) {
    const parent = byId.get(parentId);
    if (!parent || parent.side !== side || seen.has(parent.id)) break;
    seen.add(parent.id);
    depth++;
    parentId = parent.parentId;
  }
  return depth;
}

/**
 * Match a played line against the user's own opening folders.
 *
 * `moves` is the canonical SAN move list actually played so far, e.g. use
 * engine.moves.slice(0, engine.index), not the full future game. Only folders
 * in `side` whose complete nonempty line is a prefix are considered. The
 * longest line wins, then the deepest folder, then preferredId if tied;
 * remaining ties preserve library order and are explicitly reported.
 *
 * Returns { folder, candidates, ambiguous, matchedPlies }; folder is null when
 * there is no completed match. No remote opening database is consulted.
 */
export function matchOpening(folders, side, moves, {preferredId = null} = {}) {
  if (!Array.isArray(folders) || !Array.isArray(moves) || !['white','black'].includes(side)) {
    return {folder:null, candidates:[], ambiguous:false, matchedPlies:0};
  }
  const byId = new Map(folders.filter(folder => folder && typeof folder === 'object').map(folder => [folder.id, folder]));
  let matches = [], bestLength = 0, bestDepth = 0;
  for (const folder of folders) {
    if (!folder || typeof folder !== 'object' || folder.side !== side) continue;
    const line = openingMoves(folder);
    if (!line.length || line.length > moves.length || !line.every((move,i) => move === moves[i])) continue;
    const depth = openingDepth(folder, byId, side);
    if (line.length > bestLength || (line.length === bestLength && depth > bestDepth)) {
      matches = [folder]; bestLength = line.length; bestDepth = depth;
    } else if (line.length === bestLength && depth === bestDepth) matches.push(folder);
  }
  const selected = matches.find(folder => folder.id === preferredId) || matches[0] || null;
  return {folder:selected, candidates:matches, ambiguous:matches.length > 1, matchedPlies:bestLength};
}
