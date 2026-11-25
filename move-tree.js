import { folderPath, parseLine } from './library.js';

const treeLineCache = new WeakMap();
function parsedFolderLine(folder) {
  const text = typeof folder.line === 'string' ? folder.line : '';
  const cached = treeLineCache.get(folder);
  if (cached?.text === text) return cached.parsed;
  const parsed = parseLine(text);
  treeLineCache.set(folder, {text, parsed});
  return parsed;
}

/**
 * Construct a move trie for the selected opening family and the displayed line.
 * A node's `moves` is its complete prefix from the normal starting position;
 * callers can use it to navigate the board. Folder endpoints and user-marked
 * blunders retain their original folder IDs, even for identical move lines.
 */
export function buildMoveTree({folders = [], side = 'white', folderId = null, moves = [], gameMoves = [], variations = [], index = 0, gameMode = false} = {}) {
  const library = Array.isArray(folders) ? folders.filter(f => f && f.side === side) : [];
  const line = Array.isArray(moves) ? moves.filter(m => typeof m === 'string' && m.length > 0) : [];
  const originalGame = Array.isArray(gameMoves) ? gameMoves.filter(m => typeof m === 'string' && m.length > 0) : [];
  const position = Math.min(line.length, Math.max(0, Number.isFinite(Number(index)) ? Math.trunc(Number(index)) : 0));
  const path = gameMode ? [] : folderPath(library, folderId);
  const origin = path[0] || null;
  const family = [];
  if (origin) {
    const originMoves = parsedFolderLine(origin);
    const firstMove = originMoves.ok ? originMoves.moves[0] : null;
    const relatedRoots = library.filter(folder => {
      if (folder.parentId != null) return false;
      if (folder.id === origin.id) return true;
      const parsed = parsedFolderLine(folder);
      return firstMove && parsed.ok && parsed.moves[0] === firstMove;
    });
    const seen = new Set(relatedRoots.map(folder => folder.id));
    const queue = [...relatedRoots];
    while (queue.length) {
      const parent = queue.shift(); family.push(parent);
      for (const folder of library) if (folder.parentId === parent.id && !seen.has(folder.id)) {
        seen.add(folder.id); queue.push(folder);
      }
    }
  }
  const root = {san:null, ply:0, moves:[], children:[], folders:[], blunders:[], gameMode};
  function add(sequence) {
    let current = root;
    for (const san of sequence) {
      let child = current.children.find(entry => entry.san === san);
      if (!child) {
        child = {san, ply:current.ply + 1, moves:[...current.moves,san], children:[], folders:[], blunders:[]};
        current.children.push(child);
      }
      current = child;
    }
    return current;
  }
  // Insertion from the current board/game first makes it the main line.
  if (gameMode) {
    add(originalGame);
    for (const variation of variations) if (Array.isArray(variation) && variation.every(move => typeof move === 'string' && move)) add(variation);
    add(line);
  } else {
    add(line);
    add(originalGame);
  }
  for (const folder of gameMode ? [] : family) {
    const parsed = parsedFolderLine(folder);
    if (!parsed.ok) continue;
    const endpoint = add(parsed.moves);
    endpoint.folders.push({id:folder.id, name:folder.name, side:folder.side});
    if (!Array.isArray(folder.blunders)) continue;
    for (const warning of folder.blunders) {
      if (!warning || !Array.isArray(warning.moves) || !warning.moves.every(m => typeof m === 'string' && m.length)) continue;
      const warningNode = add(warning.moves);
      warningNode.blunders.push({id:warning.id || null, folderId:folder.id, folderName:folder.name, text:typeof warning.text === 'string' ? warning.text : '', moveLabel:warning.moveLabel || ''});
    }
  }
  function mark(node) {
    node.onLine = node.moves.length <= line.length && node.moves.every((move,i) => move === line[i]);
    node.onGameLine = node.moves.length <= originalGame.length && node.moves.every((move,i) => move === originalGame[i]);
    node.isAnalysis = gameMode && !node.onGameLine && node.moves.length > 0;
    node.isCurrent = node.onLine && node.ply === position;
    node.isPlayed = node.onLine && node.ply <= position;
    for (const child of node.children) mark(child);
    node.children.sort((a,b) => gameMode ? Number(b.onGameLine)-Number(a.onGameLine) || Number(b.onLine)-Number(a.onLine) : Number(b.onLine)-Number(a.onLine));
  }
  mark(root);
  return root;
}
