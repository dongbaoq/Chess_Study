import { ChessGame } from './chess.js';

// Folders store a complete line from the starting position, while parentId
// records the tree. This makes each node independently usable on the board.
export const LIBRARY_KEY = 'opening-notebook-v2';
export const LEGACY_LIBRARY_KEY = 'opening-notebook-v1';

export function migrateLibrary(input, seed = []) {
  const source = Array.isArray(input) ? input : seed;
  const folders = source.map(f => ({...f, side: f.side === 'black' ? 'black' : 'white', parentId: f.parentId ?? null, line: typeof f.line === 'string' ? f.line : '', games: Array.isArray(f.games) ? f.games : []}));
  const byId = new Map(folders.map(f => [f.id, f]));
  // A missing, cross-side, or cyclic parent must not make the library invisible.
  for (const folder of folders) {
    let node = folder, seen = new Set([folder.id]);
    while (node.parentId !== null) {
      const parent = byId.get(node.parentId);
      if (!parent || parent.side !== folder.side || seen.has(parent.id)) { folder.parentId = null; break; }
      seen.add(parent.id); node = parent;
    }
  }
  return folders;
}

// A failed read must never be followed by a write over the damaged copy.
// Keep the guard tied to the particular storage object, without storing data
// outside the browser or mutating the original value.
const blockedStores = new WeakMap();
// Each app instance remembers exactly what it read. A stale tab must not
// silently replace changes saved by another tab.
const libraryBaselines = new WeakMap();
const isStore = value => (typeof value === 'object' && value !== null) || typeof value === 'function';
const blockStore = (storage, error) => { if (isStore(storage)) blockedStores.set(storage, error); };
const rememberLibrary = (storage, v2, v1) => { if (isStore(storage)) libraryBaselines.set(storage, {v2, v1}); };
const forgetLibrary = storage => { if (isStore(storage)) libraryBaselines.delete(storage); };

/** Check for stale local state before a write, without changing stored data. */
export function checkLibraryCurrent(storage) {
  if (isStore(storage) && blockedStores.has(storage)) return {ok:false,error:{kind:'blocked',message:'Saving is paused to protect the unreadable library. Download the original data before recovering it.'}};
  const baseline = isStore(storage) ? libraryBaselines.get(storage) : null;
  if (!baseline) return {ok:false,error:{kind:'blocked',message:'The saved library has not been safely read. Reload before saving.'}};
  try {
    const v2 = storage.getItem(LIBRARY_KEY);
    const v1 = v2 === null ? storage.getItem(LEGACY_LIBRARY_KEY) : null;
    if (v2 !== baseline.v2 || (v2 === null && v1 !== baseline.v1)) {
      return {ok:false,error:{kind:'conflict',message:'The library changed in another tab. Your changes are not saved; export a backup, then reload and review the saved library.'}};
    }
    return {ok:true};
  } catch (_) {
    return {ok:false,error:{kind:'unavailable',message:'Browser storage is unavailable. Changes could not be saved; export a backup.'}};
  }
}
export const validStoredLibrary = value => Array.isArray(value) && value.every(folder => {
  if (!folder || typeof folder !== 'object' || Array.isArray(folder) || typeof folder.id !== 'string' || typeof folder.name !== 'string') return false;
  if ('side' in folder && folder.side !== 'white' && folder.side !== 'black') return false;
  if ('line' in folder && typeof folder.line !== 'string') return false;
  if ('parentId' in folder && folder.parentId !== null && typeof folder.parentId !== 'string') return false;
  if ('games' in folder && (!Array.isArray(folder.games) || !folder.games.every(game => game && typeof game === 'object' && !Array.isArray(game) && typeof game.id === 'string' && typeof game.name === 'string' && typeof game.pgn === 'string'))) return false;
  return true;
});

/**
 * Read without ever replacing an unreadable existing library with sample data.
 * Raw damaged text is returned for an explicit download/recovery action.
 */
export function readLibrary(storage, seed = []) {
  let saved, legacy;
  try {
    saved = storage.getItem(LIBRARY_KEY);
    // A present v2 value is authoritative even if it is invalid. Do not silently
    // fall back to v1 and accidentally overwrite that value with older content.
    legacy = saved === null ? storage.getItem(LEGACY_LIBRARY_KEY) : null;
  } catch (_) {
    forgetLibrary(storage);
    const error = {kind:'unavailable', key:null, message:'Browser storage is unavailable. Your library has not been replaced.'};
    blockStore(storage, {error, key:null, raw:null});
    return {folders:[], migrated:false, storageError:error, raw:null, writeBlocked:true};
  }
  const key = saved !== null ? LIBRARY_KEY : legacy !== null ? LEGACY_LIBRARY_KEY : null;
  const raw = key === LIBRARY_KEY ? saved : key === LEGACY_LIBRARY_KEY ? legacy : null;
  if (key !== null) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    if (!validStoredLibrary(parsed)) {
      forgetLibrary(storage);
      const error = {kind:'corrupt', key, message:'The saved library could not be read. The original data is still preserved; download it before attempting recovery.'};
      blockStore(storage, {error, key, raw});
      return {folders:[], migrated:false, storageError:error, raw, writeBlocked:true};
    }
    if (isStore(storage)) blockedStores.delete(storage);
    rememberLibrary(storage, saved, legacy);
    return {folders:migrateLibrary(parsed,seed), migrated:key===LEGACY_LIBRARY_KEY, storageError:null, raw:null, writeBlocked:false};
  }
  if (isStore(storage)) blockedStores.delete(storage);
  rememberLibrary(storage, saved, legacy);
  return {folders:migrateLibrary(seed,seed), migrated:false, storageError:null, raw:null, writeBlocked:false};
}

/** Save only after a safe read, reporting failures to the caller. */
export function saveLibrary(storage, folders) {
  const current = checkLibraryCurrent(storage);
  if (!current.ok) return current;
  if (!validStoredLibrary(folders)) return {ok:false,error:{kind:'invalid',message:'This library could not be saved because its data is invalid.'}};
  try {
    const serialized = JSON.stringify(folders);
    storage.setItem(LIBRARY_KEY, serialized);
    rememberLibrary(storage, serialized, null);
    return {ok:true};
  } catch (error) {
    const quota = error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return {ok:false,error:{kind:quota?'quota':'unavailable',message:quota?'Browser storage is full. Changes could not be saved; export a backup.':'Browser storage is unavailable. Changes could not be saved; export a backup.'}};
  }
}

/**
 * Explicit user-confirmed recovery or import. Before replacing any existing raw
 * library, write and verify a separate recovery copy. A failed checkpoint or a
 * concurrently changed source aborts the replacement; no existing key is reset.
 */
export function restoreLibrary(storage, folders) {
  if (!validStoredLibrary(folders)) return {ok:false,error:{kind:'invalid',message:'The replacement library is invalid; nothing was changed.'}};
  const blocked = isStore(storage) ? blockedStores.get(storage) : null;
  if (!blocked) {
    const current = checkLibraryCurrent(storage);
    if (!current.ok) return current;
  }
  let sourceKey = null, sourceRaw = null, backupKey = null;
  try {
    const v2 = storage.getItem(LIBRARY_KEY);
    const v1 = v2 === null ? storage.getItem(LEGACY_LIBRARY_KEY) : null;
    sourceKey = v2 !== null ? LIBRARY_KEY : v1 !== null ? LEGACY_LIBRARY_KEY : null;
    sourceRaw = sourceKey === LIBRARY_KEY ? v2 : sourceKey === LEGACY_LIBRARY_KEY ? v1 : null;
    if (blocked?.key && (blocked.key !== sourceKey || blocked.raw !== sourceRaw)) {
      return {ok:false,error:{kind:'conflict',message:'The saved library changed during recovery. Reload and inspect it before replacing it.'}};
    }
    if (sourceKey !== null) {
      const stamp = Date.now(); let suffix = 0;
      do { backupKey = `opening-notebook-recovery-${stamp}-${suffix++}`; }
      while (storage.getItem(backupKey) !== null && suffix < 1000);
      if (storage.getItem(backupKey) !== null) return {ok:false,error:{kind:'backup',message:'Could not create a separate recovery copy; nothing was changed.'}};
      const backup = JSON.stringify({key:sourceKey,raw:sourceRaw,savedAt:stamp});
      storage.setItem(backupKey,backup);
      if (storage.getItem(backupKey) !== backup || storage.getItem(sourceKey) !== sourceRaw || storage.getItem(LIBRARY_KEY) !== v2) {
        return {ok:false,error:{kind:'backup',message:'Could not verify the recovery copy; nothing was changed.'}};
      }
    }
    const serialized = JSON.stringify(folders);
    storage.setItem(LIBRARY_KEY,serialized);
    rememberLibrary(storage, serialized, null);
    if (isStore(storage)) blockedStores.delete(storage);
    return {ok:true,backupKey};
  } catch (error) {
    const quota = error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return {ok:false,error:{kind:quota?'quota':'unavailable',message:quota?'There is not enough browser storage to keep a recovery copy. Nothing was replaced.':'A recovery copy could not be saved. Nothing was replaced.'}};
  }
}

export function folderChildren(folders, side, parentId = null) {
  return folders.filter(f => f.side === side && (f.parentId ?? null) === parentId);
}

export function folderPath(folders, folderId) {
  const path = [], seen = new Set();
  let folder = folders.find(f => f.id === folderId);
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id); path.unshift(folder);
    folder = folders.find(f => f.id === folder.parentId);
  }
  return path;
}

export function formatLine(moves) {
  return moves.map((move, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : '') + move).join(' ');
}

export function parseLine(text) {
  const game = new ChessGame();
  if (!game.load(text || '')) return {ok: false, error: game.error};
  return {ok: true, line: formatLine(game.moves), moves: game.moves.slice(), game};
}

function startsWithLine(moves, prefix) {
  return prefix.length <= moves.length && prefix.every((move, i) => move === moves[i]);
}

// continuation is SAN/PGN text relative to the parent position, e.g. "a6 Ba4".
// For a top-level folder the parent line is empty and input starts at move one.
export function makeContinuation(folders, parentId, side, continuation = '') {
  const parent = parentId == null ? null : folders.find(f => f.id === parentId);
  if (parentId != null && (!parent || parent.side !== side)) return {ok: false, error: 'Choose a parent in the same repertoire.'};
  const parentLine = parent?.line || '';
  const parsedParent = parseLine(parentLine);
  if (!parsedParent.ok) return {ok: false, error: 'The parent opening has an invalid move line.'};
  const result = parseLine(`${parsedParent.line} ${continuation}`.trim());
  if (!result.ok) return result;
  return {...result, parentId: parent?.id ?? null, side};
}

// Validate a complete line before storing it on an existing folder. A parent
// cannot be shortened/changed in a way that leaves its descendants inconsistent.
export function validateFolderLine(folders, folderId, fullLine) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return {ok: false, error: 'Opening not found.'};
  const candidate = parseLine(fullLine);
  if (!candidate.ok) return candidate;
  if (folder.parentId != null) {
    const parent = folders.find(f => f.id === folder.parentId);
    const parsedParent = parent && parseLine(parent.line);
    if (!parent || parent.side !== folder.side || !parsedParent.ok || !startsWithLine(candidate.moves, parsedParent.moves)) {
      return {ok: false, error: 'This line must continue from its parent opening.'};
    }
  }
  const directChildren = folderChildren(folders, folder.side, folder.id);
  for (const child of directChildren) {
    const childLine = parseLine(child.line);
    if (!childLine.ok || !startsWithLine(childLine.moves, candidate.moves)) {
      return {ok: false, error: `This change would disconnect “${child.name}”. Keep its starting moves or update the child first.`};
    }
  }
  return candidate;
}
