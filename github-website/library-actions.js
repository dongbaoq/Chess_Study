import { parseLine } from './library.js';
import { matchOpening } from './opening-match.js';

/** Inspect a folder and every nested child before asking the user to delete it. */
export function inspectFolderDeletion(folders, folderId) {
  if (!Array.isArray(folders)) return {ok:false, error:'Library unavailable.'};
  const root = folders.find(folder => folder.id === folderId);
  if (!root) return {ok:false, error:'Opening not found.'};
  const ids = new Set([root.id]), pending = [root.id];
  // Iterative traversal prevents malformed cyclic data from looping forever.
  while (pending.length) {
    const id = pending.shift();
    for (const child of folders) if (child.side === root.side && child.parentId === id && !ids.has(child.id)) {
      ids.add(child.id); pending.push(child.id);
    }
  }
  const affected = folders.filter(folder => ids.has(folder.id) && folder.side === root.side);
  const games = affected.reduce((count, folder) => count + (Array.isArray(folder.games) ? folder.games.length : 0), 0);
  return {ok:true, folder:root, ids:[...ids], folderCount:affected.length, childCount:affected.length-1, gameCount:games};
}

/** Mutates the folder array only when explicitly called after confirmation. */
export function deleteFolder(folders, folderId, annotations = null) {
  const info = inspectFolderDeletion(folders, folderId);
  if (!info.ok) return info;
  const ids = new Set(info.ids);
  const gameIds = new Set(folders.filter(f => f.side === info.folder.side && ids.has(f.id)).flatMap(f => (f.games || []).map(g => g.id)));
  for (let i=folders.length-1;i>=0;i--) if (folders[i].side === info.folder.side && ids.has(folders[i].id)) folders.splice(i,1);
  if (annotations && typeof annotations === 'object') {
    for (const key of Object.keys(annotations)) {
      const [side,folderId,gameId] = key.split(':');
      if ((side === 'game' && gameIds.has(folderId)) ||
          (['white','black'].includes(side) && ((gameId === 'opening' && side === info.folder.side && ids.has(folderId)) || gameIds.has(gameId)))) delete annotations[key];
    }
  }
  return info;
}

/** Find the owner by folder ID rather than assuming the selected folder owns the game. */
export function deleteGame(folders, ownerId, gameId, annotations = null) {
  const folder = folders?.find(item => item.id === ownerId);
  if (!folder || !Array.isArray(folder.games)) return {ok:false,error:'Game folder not found.'};
  const index = folder.games.findIndex(game => game.id === gameId);
  if (index < 0) return {ok:false,error:'Game not found.'};
  const [game] = folder.games.splice(index,1);
  if (annotations && typeof annotations === 'object') {
    for (const key of Object.keys(annotations)) {
      const [side,folderId,id] = key.split(':');
      if ((side === 'game' && folderId === gameId) || (['white','black'].includes(side) && id === gameId)) delete annotations[key];
    }
  }
  return {ok:true, folder, game};
}

/** Move one game between any folders and keep its position annotations. */
export function moveGame(folders, ownerId, gameId, targetId, annotations = null) {
  const from = folders?.find(item => item.id === ownerId), to = folders?.find(item => item.id === targetId);
  if (!from || !to || !Array.isArray(from.games) || !Array.isArray(to.games)) return {ok:false,error:'Opening folder not found.'};
  const index = from.games.findIndex(game => game.id === gameId);
  if (index < 0) return {ok:false,error:'Game not found.'};
  if (from.id === to.id) return {ok:true, unchanged:true, game:from.games[index], from, to};
  if (to.games.some(game => game.id === gameId)) return {ok:false,error:'This game is already in the destination folder.'};
  const game = from.games[index];
  // Markings keyed by stable game ID or by a formerly matched folder remain
  // unchanged; the caller's reader can migrate legacy keys if needed.
  from.games.splice(index,1);to.games.push(game);
  return {ok:true, game, from, to, unchanged:false};
}

/** Find the most specific saved opening reached by the complete pasted game. */
export function matchGameFolder(folders, side, pgn, preferredId = null) {
  if (/\[\s*FEN\s+"[^"]*"\s*\]/i.test(String(pgn)) || /\[\s*SetUp\s+"1"\s*\]/i.test(String(pgn))) return {ok:false,error:'Games with a custom starting position are not supported yet.'};
  const parsed = parseLine(pgn);
  if (!parsed.ok) return parsed;
  if (!parsed.moves.length) return {ok:false,error:'Enter at least one move.'};
  const match = matchOpening(folders,side,parsed.moves,{preferredId});
  return {ok:true, ...match, moves:parsed.moves, line:parsed.line};
}
