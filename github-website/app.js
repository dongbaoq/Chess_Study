import { ChessGame } from './chess.js';
import { readLibrary, saveLibrary, restoreLibrary, checkLibraryCurrent, validStoredLibrary, folderChildren, folderPath, makeContinuation, validateFolderLine, formatLine, parseLine, migrateLibrary, saveOpeningVariation, getOpeningVariations } from './library.js?v=opening-lines-11';
import { createBoardAnnotations } from './annotations.js?v=arrows-24';
import { PIECES } from './pieces.js';
import { matchOpening } from './opening-match.js';
import { createBoardDrag } from './drag.js?v=board-22';
import { createSyncController } from './sync.js?v=cloud-sync-27';
import { createCloudSync } from './cloud-sync.js?v=cloud-sync-27';
import { inspectFolderDeletion, deleteFolder, deleteGame, moveGame, matchGameFolder } from './library-actions.js';
import { createStudyNotes } from './study-notes.js?v=theory-12';
import { buildMoveTree } from './move-tree.js?v=opening-notes-12';
import { createMoveTreeView } from './move-tree-view.js?v=note-markers-22';
import { MOVE_SYMBOL_LABELS, readMoveSymbols, setMoveSymbol, renderBoardMoveSymbol } from './move-symbols.js?v=icons-18';
import { getAnalysisVariations, saveAnalysisVariation, deleteAnalysisVariation } from './analysis-variations.js';
import { parseGameResult, resultAtPosition, resultLabel, getResultSides } from './game-result.js?v=game-results-19';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const seed = [
 {id:'ruy',side:'white',name:'Ruy López',line:'1. e4 e5 2. Nf3 Nc6 3. Bb5',idea:'Put pressure on the knight that defends e5. Develop naturally, castle early, and keep an eye on the center.',plan:'Build a strong center with c3 and d4. The bishop on b5 creates a useful long-term pin and can retreat to a4 or b3.',games:[{id:'g1',name:'A lesson in development',date:'Sample game',pgn:'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3',notes:{6:'The bishop can retreat and keep pressure on the center.',12:'Develop first; the central break can wait until the pieces are ready.'},takeaway:'Bring all the pieces into the game before committing to a central break.'}]},
 {id:'italian',side:'white',name:'Italian Game',line:'1. e4 e5 2. Nf3 Nc6 3. Bc4',idea:'Develop the bishop actively and aim at the sensitive f7 square.',plan:'Castle, support the center with c3 and d3, and look for the right moment to play d4.',games:[]},
 {id:'alapin',side:'black',name:'Sicilian · Alapin',line:'1. e4 c5 2. c3',idea:'White prepares d4 and aims to build a broad pawn center.',plan:'Challenge the center early. Consider ...Nf6 or ...d5 and develop with purpose.',games:[{id:'g2',name:'Meeting the Alapin',date:'Sample game',pgn:'1. e4 c5 2. c3 Nf6 3. e5 Nd5 4. d4 cxd4 5. cxd4 Nc6',notes:{4:'Attacking e4 asks White to make a decision in the center.'},takeaway:'Challenge the center before it becomes too comfortable.'}]},
 {id:'caro',side:'black',name:'Caro–Kann',line:'1. e4 c6 2. d4 d5',idea:'Build a resilient pawn structure and challenge White’s center with ...d5.',plan:'Develop the light-squared bishop before closing it in when the position allows.',games:[]}
];seed.push({id:'ruy-morphy',parentId:'ruy',side:'white',name:'Morphy Defense',line:'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6',idea:'Black asks the bishop to decide where it belongs.',plan:'Retreat to a4 and continue development.',games:[]});
const storage={getItem:key=>globalThis.localStorage.getItem(key),setItem:(key,value)=>globalThis.localStorage.setItem(key,value),removeItem:key=>globalThis.localStorage.removeItem(key)};
let storageFailure=null, storageBlocked=false, originalRaw=null;
function showStorageFailure(message){storageFailure=message;const banner=$('#storageWarning');if(banner){banner.hidden=false;$('#storageWarningText').textContent=message}const label=document.querySelector('.study-autosave');if(label)label.textContent='Changes not saved'}
function getStored(key){try{return storage.getItem(key)}catch{return null}}
function setStored(key,value){try{storage.setItem(key,value);return true}catch{showStorageFailure('Browser storage is unavailable or full. Changes may not be saved; export a backup.');return false}}
const existingLibrary=!!(getStored('opening-notebook-v1') || getStored('opening-notebook-v2'));
let hasUserData=!!getStored('opening-notebook-user-data-v1') || existingLibrary;
if(!existingLibrary)setStored('opening-notebook-seed-only-v1','1');
let syncController=null;
const libraryRead=readLibrary(storage,seed);
let {folders,migrated}=libraryRead;storageBlocked=libraryRead.writeBlocked;originalRaw=libraryRead.raw;
if(libraryRead.storageError)showStorageFailure(libraryRead.storageError.message);
if(originalRaw!==null)$('#downloadOriginal').hidden=false;
if(migrated&&!storageBlocked){const result=saveLibrary(storage,folders);if(!result.ok)showStorageFailure(result.error.message)}
let side='white', folderId=folders.find(f=>f.side===side)?.id||null, gameId=null, gameOwnerId=null, gameListScopeId=null, matched=null, flipped=false, selected=null, engine=new ChessGame();
function validMarkings(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(mark=>mark&&typeof mark==='object'&&!Array.isArray(mark)&&(!('squares' in mark)||(mark.squares&&typeof mark.squares==='object'&&!Array.isArray(mark.squares)))&&(!('arrows' in mark)||Array.isArray(mark.arrows)))}
let annotations={},marksBlocked=false,originalMarksRaw=null;
try{originalMarksRaw=storage.getItem('opening-notebook-marks-v1')}catch{marksBlocked=true;showStorageFailure('Saved board markings could not be read. Saving markings is paused to protect the original data.') }
if(originalMarksRaw!==null){try{const parsed=JSON.parse(originalMarksRaw);if(!validMarkings(parsed))throw new Error();annotations=parsed}catch{marksBlocked=true;showStorageFailure('Saved board markings could not be read. The original markings have not been changed.');$('#downloadOriginalMarks').hidden=false;}}
if(originalMarksRaw!==null)hasUserData=true;
// Keep game markings tied to the game and position, even when the matched folder changes.
function migrateGameMarkings(){
 if(marksBlocked)return;
 const gameIds=new Set(folders.flatMap(f=>f.games.map(g=>g.id))),updated={...annotations};let changed=false;
 const compatible=(a,b)=>Object.keys(a).every(key=>!Object.hasOwn(b,key)||JSON.stringify(a[key])===JSON.stringify(b[key]));
 for(const [key,value] of Object.entries(annotations)){
  const parts=key.split(':');if(parts.length<4||!gameIds.has(parts[2]))continue;
  const stable=`game:${parts[2]}:${parts.slice(3).join(':')}`,previous=updated[stable]||{squares:{},arrows:[]};
  if(![...(value.arrows||[]),...(previous.arrows||[])].every(a=>a&&typeof a==='object'&&!Array.isArray(a)))continue;
  const extras=Object.fromEntries(Object.entries(value).filter(([k])=>k!=='squares'&&k!=='arrows'));
  const existingExtras=Object.fromEntries(Object.entries(previous).filter(([k])=>k!=='squares'&&k!=='arrows'));
  if(!compatible(extras,existingExtras)||!compatible(value.squares||{},previous.squares||{}))continue;
  const arrows=[...(previous.arrows||[])];let conflict=false;
  for(const a of value.arrows||[]){const i=arrows.findIndex(x=>x.from===a.from&&x.to===a.to&&x.color===a.color);if(i>=0){if(!compatible(a,arrows[i])){conflict=true;break}arrows[i]={...a,...arrows[i]}}else arrows.push(a)}
  if(conflict)continue;
  updated[stable]={...value,...previous,squares:{...(value.squares||{}),...(previous.squares||{})},arrows};delete updated[key];changed=true;
 }
 if(!changed)return;
 try{if(storage.getItem('opening-notebook-marks-v1')!==originalMarksRaw)throw new Error();let key=`opening-notebook-legacy-marks-backup-${Date.now()}`,n=0;while(storage.getItem(key)!==null)key=`opening-notebook-legacy-marks-backup-${Date.now()}-${++n}`;const raw=JSON.stringify(annotations);storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error();const serialized=JSON.stringify(updated);storage.setItem('opening-notebook-marks-v1',serialized);originalMarksRaw=serialized;annotations=updated}catch{showStorageFailure('Board markings could not be migrated. The original markings are preserved.')}
}
migrateGameMarkings();
const currentFolder=()=>folders.find(f=>f.id===folderId&&f.side===side)||null;
const gameOwner=()=>folders.find(f=>f.id===gameOwnerId&&f.side===side)||null;
const currentGame=()=>gameOwner()?.games.find(g=>g.id===gameId)||null;
const save=()=>{const result=saveLibrary(storage,folders);if(!result.ok){showStorageFailure(result.error.message);return false}hasUserData=true;setStored('opening-notebook-user-data-v1','1');syncController?.markChanged();return true};
const moveView=createMoveTreeView({container:$('#moveTree'),onNavigate:navigateTreeMove,onDeleteAnalysis:removeAnalysis});
const studyNotes=createStudyNotes({container:$('#studyNotes'),onChange:()=>{save();renderMoveExplorer()},onJump:go,getSaveStatus:()=>storageFailure});
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3200)}
function setPosition(text,end=true){const next=new ChessGame();if(!next.load(text||'')){toast(next.error);return false} engine=next;if(end)engine.go(engine.moves.length);selected=null;return true;}
function switchSide(value){side=value;flipped=value==='black';folderId=folders.find(f=>f.side===side)?.id||null;gameId=null;gameOwnerId=null;gameListScopeId=null;setPosition('');updateMatch();render()}
function selectFolder(id){folderId=id;gameId=null;gameOwnerId=null;gameListScopeId=null;setPosition(currentFolder()?.line||'');updateMatch();render()}
function selectGame(id,ownerId=folderId){const owner=folders.find(f=>f.id===ownerId&&f.side===side),game=owner?.games.find(g=>g.id===id);if(!game)return;const next=new ChessGame();if(!next.load(game.pgn||'')){toast(`Could not open game: ${next.error}`);return}const scope=gameId&&gameListScopeId?gameListScopeId:currentFolder()?.id;gameListScopeId=openingContainsFolder(folders,scope,owner.id,side)?scope:owner.id;gameOwnerId=owner.id;gameId=id;engine=next;selected=null;updateMatch();render()}
// Compare played prefixes against saved opening families without switching on shared moves.
const liveOpeningLineCache=new WeakMap();
function liveOpeningMoves(folder){const line=typeof folder.line==='string'?folder.line:'';const cached=liveOpeningLineCache.get(folder);if(cached?.line===line)return cached.moves;const parsed=parseLine(line),moves=parsed.ok?parsed.moves:[];liveOpeningLineCache.set(folder,{line,moves});return moves}
function detectOpeningFamily(list,repertoireSide,moves,preferredRoot,{keepEmptyPreferred=true}={}){
 if(!Array.isArray(moves)||!moves.length)return {root:preferredRoot,score:0};
 const families=new Map();
 for(const folder of list){if(!folder||folder.side!==repertoireSide)continue;const root=folderPath(list,folder.id)[0];if(!root||root.side!==repertoireSide)continue;
  let entry=families.get(root.id);if(!entry){entry={root,score:0,hasPaths:false};families.set(root.id,entry)}
  const rootMoves=liveOpeningMoves(root),line=liveOpeningMoves(folder),paths=line.length?[line]:[];
  // Empty top-level openings may contain lines saved with Save line instead.
  if(!rootMoves.length)paths.push(...getOpeningVariations(folder));
  for(const path of paths){if(!path.length)continue;entry.hasPaths=true;const n=Math.min(path.length,moves.length);if(path.slice(0,n).every((move,i)=>move===moves[i]))entry.score=Math.max(entry.score,n)}
 }
 const preferred=preferredRoot&&families.get(preferredRoot.id);
 // Keep an empty new opening selected while the user is building its first line.
 if(keepEmptyPreferred&&preferred&&!liveOpeningMoves(preferredRoot).length&&!preferred.hasPaths)return {root:preferredRoot,score:0};
 const best=Math.max(0,...Array.from(families.values(),entry=>entry.score));if(!best)return {root:null,score:0};
 const leaders=Array.from(families.values()).filter(entry=>entry.score===best);
 if(leaders.length===1)return {root:leaders[0].root,score:best};
 const tied=leaders.find(entry=>entry.root.id===preferredRoot?.id);return tied?{root:tied.root,score:best}:{root:null,score:0};
}
function updateMatch(){
 const selected=currentFolder(),root=selected&&folderPath(folders,selected.id)[0],moves=engine.moves.slice(0,engine.index);
 if(currentGame()){
  const detected=detectOpeningFamily(folders,side,moves,root,{keepEmptyPreferred:false}),family=detected.root?folders.filter(f=>folderPath(folders,f.id)[0]?.id===detected.root.id):folders;
  matched=matchOpening(family,side,moves,{preferredId:folderId});
  if(matched.folder)folderId=matched.folder.id;
  else if(detected.root&&detected.score){folderId=detected.root.id;matched={...matched,folder:detected.root,matchedPlies:detected.score,partial:true}}
  else if(gameOwner())folderId=gameOwner().id;
  return
 }
 const detected=detectOpeningFamily(folders,side,moves,root),chosen=detected.root||root;
 const matchingFolders=chosen?folders.filter(f=>folderPath(folders,f.id)[0]?.id===chosen.id):folders;
 matched=matchOpening(matchingFolders,side,moves,{preferredId:folderId});
 const exact=selected&&chosen?.id===root?.id&&moves.length?parseLine(selected.line||''):null;
 if(exact?.ok&&exact.moves.length===moves.length&&exact.moves.every((move,i)=>move===moves[i])){matched={...matched,folder:selected,matchedPlies:moves.length};folderId=selected.id}
 else if(matched.folder)folderId=matched.folder.id;
 else if(detected.root&&detected.root.id!==root?.id){folderId=detected.root.id;matched={...matched,folder:detected.root,matchedPlies:detected.score,partial:true}}
 else if(detected.root&&detected.score){matched={...matched,folder:detected.root,matchedPlies:detected.score,partial:true}}
}
function renderTree(){$('#addRoot').disabled=storageBlocked;let out='';function walk(parent,depth){for(const f of folderChildren(folders,side,parent)){const children=folderChildren(folders,side,f.id);out+=`<div class="tree-row" style="--depth:${depth}"><button class="tree-item ${f.id===folderId?'active':''}" data-folder="${esc(f.id)}"><span class="folder-icon">${children.length?'▾':'·'}</span><span class="folder-name">${esc(f.name)}</span><span class="tree-count">${f.games.length||''}</span></button></div>`;walk(f.id,depth+1)}}walk(null,0);$('#tree').innerHTML=out||'<p class="empty-tree">No openings yet. Add your first line.</p>';document.querySelectorAll('[data-folder]').forEach(b=>b.onclick=()=>selectFolder(b.dataset.folder));$('#libraryTitle').textContent=`${side==='white'?'White':'Black'} openings`;$('#sideWhite').setAttribute('aria-pressed',side==='white');$('#sideBlack').setAttribute('aria-pressed',side==='black');$('#addChild').disabled=$('#editFolder').disabled=$('#deleteFolder').disabled=!currentFolder();}
function checkMarkingsCurrent(){
 if(marksBlocked)return {ok:false,error:'Saving markings is paused to protect the original data.'};
 try{if(storage.getItem('opening-notebook-marks-v1')!==originalMarksRaw)return {ok:false,error:'Board markings changed in another tab. Export a backup, then reload before editing markings.'};return {ok:true}}
 catch{return {ok:false,error:'Board markings could not be read. The original data is preserved.'}}
}
function writeMarkings(value){const check=checkMarkingsCurrent();if(!check.ok){showStorageFailure(check.error);return false}const raw=JSON.stringify(value);try{storage.setItem('opening-notebook-marks-v1',raw);originalMarksRaw=raw;return true}catch{showStorageFailure('Board markings could not be saved. The original data is preserved.');return false}}
const marks=createBoardAnnotations({board:$('#board'),getFlipped:()=>flipped,getKey:()=>gameId?`game:${gameId}:${engine.fen()}`:`${side}:${folderId||'root'}:opening:${engine.fen()}`,read:key=>annotations[key],write:(key,value)=>{const next={...annotations,[key]:value};if(!writeMarkings(next))return;annotations=next;hasUserData=true;setStored('opening-notebook-user-data-v1','1');syncController?.markChanged()},onError:showStorageFailure,onModeChange:on=>{$('#drawMode').setAttribute('aria-pressed',String(on));$('#drawMode').classList.toggle('active',on)}});
let activeMotions=[];
function cancelMotions(){for(const item of activeMotions){item.animation.cancel();item.target.style.visibility='';item.ghost.remove()}activeMotions=[];}
function prepareMotion(from,to){
 cancelMotions();
 const pieceAt=sq=>engine.board[8-Number(sq[1])]['abcdefgh'.indexOf(sq[0])];
 const moving=pieceAt(from);if(!moving)return [];
 const moves=[{from,to,piece:moving}];
 const a='abcdefgh'.indexOf(from[0]),b='abcdefgh'.indexOf(to[0]);
 if(moving[1]==='K' && Math.abs(a-b)===2){
  const rank=from[1];let rookFrom,rookTo;
  if(a===4){rookFrom=(b===6?'h':'a')+rank;rookTo=(b===6?'f':'d')+rank}
  else {rookFrom=(a===6?'f':'d')+rank;rookTo=(a===6?'h':'a')+rank}
  const rook=pieceAt(rookFrom);if(rook)moves.push({from:rookFrom,to:rookTo,piece:rook});
 }
 return moves;
}
function animateMotion(moves){
 if(!moves?.length || matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const board=$('#board'),host=board.parentElement;
 const point=sq=>{const x='abcdefgh'.indexOf(sq[0]),y=8-Number(sq[1]);return flipped?[7-x,7-y]:[x,y]};
 for(const move of moves){
  const target=board.querySelector(`[data-square="${move.to}"] .piece`);if(!target)continue;
  const [x,y]=point(move.from),[tx,ty]=point(move.to);
  const ghost=document.createElement('span');ghost.className='moving-piece';ghost.setAttribute('aria-hidden','true');
  ghost.style.left=`${x*12.5}%`;ghost.style.top=`${y*12.5}%`;ghost.innerHTML=`<span class="piece">${PIECES[move.piece]}</span>`;
  host.appendChild(ghost);target.style.visibility='hidden';
  const animation=ghost.animate([{transform:'translate(0,0)'},{transform:`translate(${(tx-x)*100}%, ${(ty-y)*100}%)`}],{duration:190,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'});
  const item={animation,target,ghost};activeMotions.push(item);
  animation.onfinish=()=>{target.style.visibility='';ghost.remove();activeMotions=activeMotions.filter(a=>a!==item)};
 }
}
function renderBoard(motion=[]){cancelMotions();const focus=document.activeElement?.closest?.('#board [data-square]')?.dataset.square;let html='';const game=currentGame(),played=game?originalGameMoves():[],position=engine.moves.slice(0,engine.index),analysis=!!game&&(position.length>played.length||position.some((move,i)=>move!==played[i]));$('#board').classList.toggle('is-analysis',analysis);const last=engine.lastMove,legal=selected?engine.legalMoves().filter(m=>m.from===selected):[];for(let vr=0;vr<8;vr++)for(let vc=0;vc<8;vc++){let r=flipped?7-vr:vr,c=flipped?7-vc:vc,sq='abcdefgh'[c]+(8-r),p=engine.board[r][c];html+=`<button class="square ${(r+c)%2?'dark':'light'} ${last&&(last.from===sq||last.to===sq)?'last-move':''} ${selected===sq?'selected':''} ${legal.some(m=>m.to===sq)?'legal':''} ${legal.some(m=>m.to===sq&&m.san.includes('x'))?'legal-capture':''}" data-square="${sq}" aria-label="${sq}${p?' '+p:''}">${vc===0?`<span class="coord rank">${8-r}</span>`:''}${vr===7?`<span class="coord file">${'abcdefgh'[c]}</span>`:''}${p?`<span class="piece" aria-hidden="true">${PIECES[p]}</span>`:''}</button>`}$('#board').innerHTML=html;if(focus)$('#board').querySelector(`[data-square="${focus}"]`)?.focus({preventScroll:true});animateMotion(motion);document.querySelectorAll('[data-square]').forEach(b=>b.onclick=()=>squareClick(b.dataset.square));marks.refresh();$('#positionLabel').textContent=engine.index===0?'Starting position':`${Math.ceil(engine.index/2)}${engine.index%2?'.':'...'} ${engine.moves[engine.index-1]}`;const finalResult=resultAtPosition(game,engine.moves,engine.index,played),resultSides=getResultSides(finalResult,flipped);$('#boardResultTop').hidden=$('#boardResultBottom').hidden=!finalResult;$('#boardResultTop').textContent=resultSides.top;$('#boardResultBottom').textContent=resultSides.bottom;$('#positionSub').textContent=finalResult?`${finalResult} · ${resultLabel(finalResult)}`:`${engine.turn==='w'?'White':'Black'} to move${analysis?' · Analysis variation':''}`;$('#prev').disabled=$('#first').disabled=engine.index===0;$('#next').disabled=$('#last').disabled=engine.index===engine.moves.length;}

function playMove(from,to,animate=true){
 const legal=engine.legalMoves().filter(m=>m.from===from&&m.to===to);if(!legal.length)return false;
 function finish(promotion){const motion=animate?prepareMotion(from,to):[];if(!engine.move(from,to,promotion))return;const game=currentGame(),line=engine.moves.slice(0,engine.index);if(game&&!startsWithMoves(originalGameMoves(),line)){const result=saveAnalysisVariation(game,line);if(!result.ok)showStorageFailure(result.error);else if(result.changed)save()}selected=null;updateMatch();renderBoard(motion);renderContext()}
 if(legal.some(move=>move.promotion)){modal('Choose promotion',`<label>Promote pawn to<select name="promotion"><option value="Q">Queen</option><option value="R">Rook</option><option value="B">Bishop</option><option value="N">Knight</option></select></label><div class="form-actions"><button type="button" class="button secondary cancel">Cancel</button><button class="button primary">Promote</button></div>`,data=>{const choice=String(data.get('promotion'));if(!legal.some(move=>move.promotion===choice))return;$('#modal').close();finish(choice)});return true}
 finish('Q');return true
}
function squareClick(sq){let r=8-Number(sq[1]),c='abcdefgh'.indexOf(sq[0]),p=engine.board[r][c];if(selected&&playMove(selected,sq))return;selected=p&&p[0]===engine.turn?sq:null;renderBoard();renderMoveExplorer()}
// Update destination hints in place so an active drag keeps its pointer capture.
function showLegalHints(from){
 const legal=from?engine.legalMoves().filter(move=>move.from===from):[];
 for(const square of $('#board').querySelectorAll('[data-square]')){
  const choices=legal.filter(move=>move.to===square.dataset.square);
  square.classList.toggle('legal',choices.length>0);
  square.classList.toggle('legal-capture',choices.some(move=>move.san.includes('x')));
 }
}
createBoardDrag({board:$('#board'),isDrawing:()=>marks.getMode(),canStart:sq=>engine.legalMoves().some(m=>m.from===sq),onMove:(from,to)=>playMove(from,to,false),onDragStart:showLegalHints,onDragEnd:()=>showLegalHints(selected)});
function gameResultHtml(game){const result=parseGameResult(game.pgn);return result?`<small class="game-result-label">${esc(result)} · ${esc(resultLabel(result))}</small>`:''}
// A retained list scope is valid only while it contains the actual game owner.
function openingContainsFolder(list,rootId,folderId,repertoireSide){
 if(!Array.isArray(list)||!rootId||!folderId)return false;
 const seen=new Set();let folder=list.find(item=>item?.id===folderId&&item.side===repertoireSide);
 while(folder&&!seen.has(folder.id)){if(folder.id===rootId)return true;seen.add(folder.id);folder=list.find(item=>item?.id===folder.parentId&&item.side===repertoireSide)}
 return false;
}
// Include games filed in this opening and its descendants without changing ownership.
function openingGameEntries(list,root){
 if(!root||!Array.isArray(list))return [];
 const seen=new Set(),queue=[root],entries=[];
 while(queue.length){const folder=queue.shift();if(!folder||seen.has(folder.id)||folder.side!==root.side)continue;seen.add(folder.id);
  for(const game of Array.isArray(folder.games)?folder.games:[])if(game&&typeof game==='object')entries.push({owner:folder,game});
  for(const child of list)if(child&&child.side===root.side&&child.parentId===folder.id&&!seen.has(child.id))queue.push(child);
 }
 return entries;
}
function renderGames(){
 const f=currentGame()?(folders.find(folder=>folder.id===gameListScopeId&&folder.side===side)||gameOwner()):currentFolder();
 const entries=openingGameEntries(folders,f);
 $('#gamesHeading').textContent=f?`Games in ${f.name}`:'Games';
 $('#games').innerHTML=entries.length?entries.map(({owner,game:g})=>`<div class="game-entry ${g.id===gameId&&owner.id===gameOwnerId?'active':''}"><button class="game-item" data-game="${esc(g.id)}" data-game-owner="${esc(owner.id)}"><span class="game-piece">♟</span><span><strong>${esc(g.name)}</strong><small>${esc(g.date||'Your game')}${owner.id!==f.id?` · ${esc(owner.name)}`:''}</small>${gameResultHtml(g)}</span><span class="chevron">›</span></button><div class="game-entry-actions"><button class="game-action" data-rename-game="${esc(g.id)}" data-game-owner="${esc(owner.id)}" aria-label="Rename ${esc(g.name)}" ${storageBlocked?'disabled':''}>Rename</button><button class="game-action" data-move-game="${esc(g.id)}" data-game-owner="${esc(owner.id)}" aria-label="Move ${esc(g.name)}">Move</button><button class="game-action danger" data-delete-game="${esc(g.id)}" data-game-owner="${esc(owner.id)}" aria-label="Delete ${esc(g.name)}">Delete</button></div></div>`).join(''):'<p class="empty-state">No games in this opening or its subfolders.</p>';
 document.querySelectorAll('[data-game]').forEach(b=>b.onclick=()=>selectGame(b.dataset.game,b.dataset.gameOwner));
 document.querySelectorAll('[data-rename-game]').forEach(b=>b.onclick=()=>renameGame(b.dataset.gameOwner,b.dataset.renameGame));
 document.querySelectorAll('[data-move-game]').forEach(b=>b.onclick=()=>transferGame(b.dataset.gameOwner,b.dataset.moveGame));
 document.querySelectorAll('[data-delete-game]').forEach(b=>b.onclick=()=>removeGame(b.dataset.gameOwner,b.dataset.deleteGame));
 $('#addGame').disabled=!currentFolder();$('#openingView').disabled=!gameId;
}
function renderContext(){const f=currentFolder(),path=folderPath(folders,folderId);renderTree();$('#breadcrumbs').innerHTML=`<span>${side==='white'?'White':'Black'}</span>${path.map(p=>`<span class="crumb-sep">/</span><span>${esc(p.name)}</span>`).join('')}${currentGame()?`<span class="crumb-sep">/</span><span>${esc(currentGame().name)}</span>`:''}`;$('#boardTitle').textContent=currentGame()?.name||f?.name||`${side==='white'?'White':'Black'} repertoire`;$('#openingStatus').textContent=(matched?.folder?`${matched.partial?'Exploring':'Matched'}: ${matched.folder.name}${matched.ambiguous?' (multiple saved lines match)':''}`:'No saved opening matched at this position')+(currentGame()&&gameOwner()?.id!==f?.id?` · Game filed in ${gameOwner().name}`:'');studyNotes.render({folders,folder:f,game:currentGame(),moves:engine.moves,index:engine.index});if(storageFailure){const label=document.querySelector('.study-autosave');if(label)label.textContent='Changes not saved'}$('#saveLine').disabled=$('#addBranch').disabled=!f;$('#saveOpeningLine').hidden=!!currentGame();$('#saveOpeningLine').disabled=!f||!engine.index||storageBlocked;$('#copyPgn').disabled=!engine.index;renderGames();renderMoveExplorer()}
const gameMoveCache=new WeakMap();
let currentMoveTree=null;
function originalGameMoves(){const g=currentGame();if(!g)return [];const cached=gameMoveCache.get(g);if(cached?.pgn===g.pgn)return cached.moves;const parsed=parseLine(g.pgn||'');const result=parsed.ok?parsed.moves:[];gameMoveCache.set(g,{pgn:g.pgn,moves:result});return result}
const startsWithMoves=(line,prefix)=>prefix.length<=line.length&&prefix.every((move,i)=>line[i]===move);
function treeNodeFor(prefix){let node=currentMoveTree;for(const move of prefix){node=node?.children?.find(child=>child.san===move);if(!node)return null}return node}
function markGamePositionNotes(node,game,gameMoves){
 const notes=game?.notes;
 if(!notes||typeof notes!=='object'||Array.isArray(notes))return;
 function visit(current){
  const moves=Array.isArray(current.moves)?current.moves:[],key=moves.join(' ');
  let note=Object.hasOwn(notes,key)?notes[key]:null;
  if(note==null&&startsWithMoves(gameMoves,moves)&&Object.hasOwn(notes,moves.length))note=notes[moves.length];
  current.hasNote=!!note;
  for(const child of current.children||[])visit(child);
 }
 visit(node);
}
let branchHintSvg=null;
function renderBranchHints(node){
 const children=node?.children;
 if(!Array.isArray(children)||children.length<2){if(branchHintSvg)branchHintSvg.innerHTML='';return}
 const normalizeSan=san=>String(san).replace(/0/g,'O').replace(/[!?]+/g,'').replace(/[+#]+$/,'');
 const legal=engine.legalMoves(), choices=new Map();
 for(const child of children){
  const move=legal.find(candidate=>normalizeSan(candidate.san)===normalizeSan(child.san));
  if(move)choices.set(`${move.from}-${move.to}`,move);
 }
 if(choices.size<2){if(branchHintSvg)branchHintSvg.innerHTML='';return}
 if(!branchHintSvg){
  branchHintSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  branchHintSvg.setAttribute('class','branch-hints');
  branchHintSvg.setAttribute('viewBox','0 0 8 8');
  branchHintSvg.setAttribute('preserveAspectRatio','none');
  branchHintSvg.setAttribute('aria-hidden','true');
  Object.assign(branchHintSvg.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'4',overflow:'hidden'});
  $('#board').parentElement.appendChild(branchHintSvg);
 }
 const point=square=>{
  const x=square.charCodeAt(0)-97,y=8-Number(square[1]);
  return flipped?[7-x,7-y]:[x,y];
 };
 const xy=(x,y)=>`${x.toFixed(4)} ${y.toFixed(4)}`;
 branchHintSvg.innerHTML=[...choices.values()].map(move=>{
  const [x1,y1]=point(move.from),[x2,y2]=point(move.to),length=Math.hypot(x2-x1,y2-y1),ux=(x2-x1)/length,uy=(y2-y1)/length,nx=-uy,ny=ux;
  const startX=x1+ux*.16,startY=y1+uy*.16,tipX=x2-ux*.12,tipY=y2-uy*.12,baseX=tipX-ux*.28,baseY=tipY-uy*.28,shaft=.055,head=.16;
  const path=`M ${xy(startX+nx*shaft,startY+ny*shaft)} L ${xy(baseX+nx*shaft,baseY+ny*shaft)} L ${xy(baseX+nx*head,baseY+ny*head)} L ${xy(tipX,tipY)} L ${xy(baseX-nx*head,baseY-ny*head)} L ${xy(baseX-nx*shaft,baseY-ny*shaft)} L ${xy(startX-nx*shaft,startY-ny*shaft)} Q ${xy(x1-ux*shaft,y1-uy*shaft)} ${xy(startX+nx*shaft,startY+ny*shaft)} Z`;
  return `<path data-branch-from="${move.from}" data-branch-to="${move.to}" d="${path}" />`;
 }).join('');
}
function moveSymbolContext(){
 const game=currentGame(),owners=game?[game]:folderPath(folders,folderId),symbols={},key=engine.moves.slice(0,engine.index).join(' ');let owner=owners.at(-1)||null,unknown=false;
 for(const item of owners){const result=readMoveSymbols(item);if(!result.ok){showStorageFailure(result.error);return {owner:null,symbols:{},unknown:true}}Object.assign(symbols,result.symbols);const raw=item.moveSymbols;if(raw&&Object.hasOwn(raw,key)){if(Object.hasOwn(MOVE_SYMBOL_LABELS,raw[key]))owner=item;else unknown=true}}
 if(unknown)showStorageFailure('This move has an unrecognized saved symbol. The original data was preserved.');
 return {owner,symbols,unknown}
}
function renderMoveExplorer(){const gameMoves=originalGameMoves(),game=currentGame(),symbolContext=moveSymbolContext(),currentSymbol=symbolContext.symbols[engine.moves.slice(0,engine.index).join(' ')]||'';renderBoardMoveSymbol($('#board'),engine.lastMove,currentSymbol,flipped);document.querySelectorAll('[data-move-symbol]').forEach(button=>{button.disabled=!symbolContext.owner||!engine.index||storageBlocked||symbolContext.unknown;button.setAttribute('aria-pressed',String(button.dataset.moveSymbol===currentSymbol))});currentMoveTree=buildMoveTree({folders,side,folderId,moves:engine.moves,index:engine.index,gameMoves,variations:getAnalysisVariations(game),moveSymbols:symbolContext.symbols,gameMode:!!game});if(game)markGamePositionNotes(currentMoveTree,game,gameMoves);moveView.render(currentMoveTree);const playedResult=parseGameResult(game?.pgn),playedList=$('#moveTree').querySelector('[data-move-scroll="game"] .move-tree-sequence');if(playedResult&&playedList){const result=document.createElement('span');result.className='move-tree-result';result.textContent=`${playedResult} · ${resultLabel(playedResult)}`;playedList.appendChild(result)}const current=treeNodeFor(engine.moves.slice(0,engine.index));renderBranchHints(current);$('#next').disabled=$('#last').disabled=engine.index>=engine.moves.length&&!current?.children?.length;$('#returnGame').hidden=!game||(gameMoves.length===engine.moves.length&&startsWithMoves(gameMoves,engine.moves));}
function stepNext(){const current=engine.moves.slice(0,engine.index),game=currentGame(),recorded=game?originalGameMoves():[];if(game&&current.length<recorded.length&&startsWithMoves(recorded,current)){navigateTreeMove({moves:recorded.slice(0,current.length+1)});return}if(engine.index<engine.moves.length){go(engine.index+1);return}const children=treeNodeFor(current)?.children||[];if(game&&children.length>1){toast('Choose a variation in the move list.');return}if(children.length)navigateTreeMove(children[0])}
function stepLast(){
 while(true){
  const position=engine.moves.slice(0,engine.index),recorded=currentGame()?originalGameMoves():[];
  if(currentGame()&&position.length<recorded.length&&startsWithMoves(recorded,position)){navigateTreeMove({moves:recorded});return}
  if(engine.index<engine.moves.length){go(engine.moves.length);continue}
  const children=treeNodeFor(position)?.children||[];
  if(children.length>1){toast('Choose a variation in the move list.');return}
  if(!children.length)return;
  const before=engine.index;navigateTreeMove(children[0]);if(engine.index<=before)return;
 }
}
function navigateTreeMove(node){const prefix=node.moves||[],game=currentGame(),gameMoves=originalGameMoves(),recorded=!!game&&startsWithMoves(gameMoves,prefix);if(startsWithMoves(engine.moves,prefix)&&(!recorded||(engine.moves.length===gameMoves.length&&startsWithMoves(gameMoves,engine.moves)))){go(prefix.length);return}let line=recorded?gameMoves:null;if(!line&&!game){const candidates=folders.filter(f=>f.side===side).map(f=>({f,parsed:parseLine(f.line||'')})).filter(c=>c.parsed.ok&&startsWithMoves(c.parsed.moves,prefix));const preferred=candidates.find(c=>c.f.id===folderId&&c.parsed.moves.length>prefix.length);line=(preferred||candidates.sort((a,b)=>b.parsed.moves.length-a.parsed.moves.length)[0])?.parsed.moves||null;}if(!line)line=prefix;const next=new ChessGame();if(!next.load(formatLine(line))){toast(next.error);return}engine=next;engine.go(prefix.length);selected=null;updateMatch();renderBoard();renderContext()}
function removeAnalysis(prefix){const game=currentGame();if(!game||!prefix.length||startsWithMoves(originalGameMoves(),prefix))return;if(!saveCheckpoint())return;const before=captureLibraryState();const result=deleteAnalysisVariation(game,prefix);if(!result.ok){showStorageFailure(result.error);return}if(!result.changed)return;if(startsWithMoves(engine.moves,prefix)){const parent=engine.moves.slice(0,Math.min(engine.index,prefix.length-1));const next=new ChessGame();if(next.load(formatLine(parent))){engine=next;engine.go(parent.length);selected=null}}const saved=save();if(!saved)restoreLibraryState(before);updateMatch();render();toast(saved?'Analysis moves deleted':'Changes not saved; export a backup')}
$('#returnGame').onclick=()=>{const moves=originalGameMoves();let common=0;while(common<engine.index&&common<moves.length&&engine.moves[common]===moves[common])common++;const next=new ChessGame();if(!next.load(formatLine(moves))){toast(next.error);return}engine=next;engine.go(common);selected=null;updateMatch();renderBoard();renderContext()};
function render(){renderBoard();renderContext()}
function modal(title,body,submit){$('#modalTitle').textContent=title;$('#modalForm').innerHTML=body;$('#modalForm').onsubmit=e=>{e.preventDefault();submit(new FormData(e.target))};$('#modal').showModal();$('.cancel').onclick=()=>$('#modal').close()}
function addFolder(parentId=null){const parent=folders.find(f=>f.id===parentId);const parsed=parent?parseLine(parent.line):null;let continuation='';if(parent&&parsed?.ok&&parsed.moves.every((m,i)=>engine.moves[i]===m)&&engine.index>=parsed.moves.length)continuation=engine.moves.slice(parsed.moves.length,engine.index).join(' ');modal(parent?'Add a subfolder':'Add an opening',`<p class="form-copy">${parent?`Continuing from <strong>${esc(parent.name)}</strong> · ${esc(parent.line||'starting position')}`:`Create an independent opening in your ${side} repertoire.`}</p><label>Folder name<input name="name" required placeholder="e.g. Morphy Defense"></label><label>${parent?'Continuation moves':'Opening moves'} <span>Optional</span><textarea name="line" placeholder="${parent?'e.g. a6 Ba4':'e.g. 1. e4 e5 2. Nf3'}">${esc(continuation)}</textarea></label><p class="form-hint">${parent?'Enter only moves after the selected parent. For a different opening, use Add opening instead.':'Enter moves from the starting position, such as 1. e4 c5 for the Sicilian Defense.'} Leave blank to start from ${parent?'the parent position':'the initial position'}.</p><div class="form-actions"><button type="button" class="button secondary cancel">Cancel</button><button class="button primary">Create folder</button></div>`,d=>{let name=String(d.get('name')).trim();if(!name){toast('Enter a folder name');return}let result=makeContinuation(folders,parentId,side,String(d.get('line')).trim());if(!result.ok){toast(result.error);return}const f={id:crypto.randomUUID(),parentId,side,name,line:result.line,idea:'',plan:'',games:[]};folders.push(f);if(!save()){const addedIndex=folders.indexOf(f);if(addedIndex!==-1)folders.splice(addedIndex,1);toast('Opening not saved; export a backup');return}$('#modal').close();selectFolder(f.id);toast('Opening added')})}
function editFolder(){const f=currentFolder();if(!f)return;modal('Edit opening',`<label>Folder name<input name="name" required value="${esc(f.name)}"></label><label>Full opening line <span>from the starting position</span><textarea name="line">${esc(f.line)}</textarea></label><p class="form-hint">The line must include its parent’s moves and remain compatible with its subfolders.</p><div class="form-actions"><button type="button" class="button secondary cancel">Cancel</button><button class="button primary">Save changes</button></div>`,d=>{const name=String(d.get('name')).trim();if(!name){toast('Enter a folder name');return}const result=validateFolderLine(folders,f.id,String(d.get('line')).trim());if(!result.ok){toast(result.error);return}f.name=name;f.line=result.line;const saved=save();$('#modal').close();selectFolder(f.id);toast(saved?'Opening updated':'Changes not saved; export a backup')})}
function folderOptions(selectedId){return folders.map(f=>{const path=folderPath(folders,f.id).map(x=>x.name).join(' / ');return `<option value="${esc(f.id)}" ${f.id===selectedId?'selected':''}>${f.side==='white'?'White':'Black'} / ${esc(path)}</option>`}).join('')}
function saveCheckpoint(){if(!setStored('opening-notebook-before-import',JSON.stringify(snapshot())))return false;$('#restoreData').hidden=false;return true}
function persistActions(){
 const current=checkLibraryCurrent(storage);if(!current.ok){showStorageFailure(current.error.message);return false}
 const before=originalMarksRaw;if(!writeMarkings(annotations))return false;
 const written=originalMarksRaw,result=saveLibrary(storage,folders);
 if(!result.ok){try{if(storage.getItem('opening-notebook-marks-v1')===written){if(before===null)storage.removeItem('opening-notebook-marks-v1');else storage.setItem('opening-notebook-marks-v1',before);originalMarksRaw=before}}catch{showStorageFailure('Changes could not be saved and board markings could not be restored. Use the previous copy in Library Storage.');return false}showStorageFailure(result.error.message);return false}
 hasUserData=true;setStored('opening-notebook-user-data-v1','1');syncController?.markChanged();return true
}
function captureLibraryState(){return {folders:structuredClone(folders),annotations:structuredClone(annotations),folderId,gameId,gameOwnerId,gameListScopeId,engine,side,flipped}}
function restoreLibraryState(state){({folders,annotations,folderId,gameId,gameOwnerId,gameListScopeId,engine,side,flipped}=state)}
function removeFolder(){const f=currentFolder();if(!f)return;const info=inspectFolderDeletion(folders,f.id);if(!info.ok){toast(info.error);return}const description=`Delete “${f.name}”, ${info.childCount} subfolder${info.childCount===1?'':'s'} and ${info.gameCount} game${info.gameCount===1?'':'s'}? Their notes and markings will also be removed. You can restore the previous copy from Library Storage.`;confirmAction('Delete opening',description,'Delete opening',()=>{if(!saveCheckpoint())return;const before=captureLibraryState();const affectedGame=info.ids.includes(gameOwnerId);deleteFolder(folders,f.id,annotations);folderId=(folders.find(x=>x.id===f.parentId)?.id)||folders.find(x=>x.side===side)?.id||null;if(affectedGame){gameId=null;gameOwnerId=null}if(!gameId)setPosition(currentFolder()?.line||'');const saved=persistActions();if(!saved)restoreLibraryState(before);updateMatch();render();toast(saved?'Opening deleted':'Changes not saved; export a backup')})}
function renameGame(ownerId,id){
 const owners=folders.filter(folder=>folder.id===ownerId);
 if(owners.length!==1){if(owners.length)toast('This opening shares an ID with another opening. Rename is paused to protect your data.');return}
 const owner=owners[0],matches=Array.isArray(owner.games)?owner.games.filter(game=>game?.id===id):[];
 if(!matches.length)return;
 if(matches.length!==1){toast('This folder contains games with the same ID. Rename is paused to protect your data.');return}
 if(storageBlocked){showStorageFailure('Saving is paused to protect the saved library.');return}
 const game=matches[0];
 modal('Rename game',`<label>Game title<input name="name" required value="${esc(game.name)}"></label><div class="form-actions"><button type="button" class="button secondary cancel">Cancel</button><button class="button primary">Save</button></div>`,data=>{
  const name=String(data.get('name')??'').trim();
  if(!name){toast('Enter a game title');return}
  if(name===game.name){$('#modal').close();return}
  const previous=game.name;game.name=name;
  if(!save()){game.name=previous;renderContext();toast('Game title not saved; check the storage message.');return}
  $('#modal').close();renderContext();toast('Game renamed');
 });
}
function removeGame(ownerId,id){const f=folders.find(x=>x.id===ownerId),g=f?.games.find(x=>x.id===id);if(!g)return;const count=folders.reduce((total,folder)=>total+(Array.isArray(folder.games)?folder.games.filter(game=>game?.id===id).length:0),0);if(count>1){toast('This game shares an ID with another game. Deletion is paused to protect their annotations; export a backup before resolving duplicates.');return}confirmAction('Delete game',`Delete “${g.name}” and its game notes and markings? You can restore the previous copy from Library Storage.`,'Delete game',()=>{if(!saveCheckpoint())return;const before=captureLibraryState();const result=deleteGame(folders,ownerId,id,annotations);if(!result.ok){toast(result.error);return}if(gameId===id&&gameOwnerId===ownerId){folderId=folders.some(folder=>folder.id===gameListScopeId&&folder.side===side)?gameListScopeId:folderId;gameId=null;gameOwnerId=null;gameListScopeId=null;setPosition(currentFolder()?.line||'')}const saved=persistActions();if(!saved)restoreLibraryState(before);updateMatch();render();toast(saved?'Game deleted':'Changes not saved; export a backup')})}
function transferGame(ownerId,id){const f=folders.find(x=>x.id===ownerId),g=f?.games.find(x=>x.id===id);if(!g)return;modal('Move game',`<p class="form-copy">Choose where to keep <strong>${esc(g.name)}</strong>. Its moves, notes and markings will travel with it.</p><label>Destination opening<select name="destination">${folderOptions(ownerId)}</select></label><div class="form-actions"><button type="button" class="button secondary cancel">Cancel</button><button class="button primary">Move game</button></div>`,d=>{const before=captureLibraryState(),previousScope=gameListScopeId||folderId;const result=moveGame(folders,ownerId,id,String(d.get('destination')),annotations);if(!result.ok){toast(result.error);return}$('#modal').close();if(result.unchanged){toast('Game is already in that folder');return}const wasOpen=gameId===id&&gameOwnerId===ownerId;side=result.to.side;flipped=side==='black';folderId=result.to.id;gameListScopeId=openingContainsFolder(folders,previousScope,result.to.id,side)?previousScope:result.to.id;gameOwnerId=result.to.id;gameId=id;if(!wasOpen)setPosition(g.pgn,false);const saved=persistActions();if(!saved)restoreLibraryState(before);updateMatch();render();toast(saved?'Game moved':'Changes not saved; export a backup')})}
function addGame(){const f=currentFolder();if(!f)return;modal('Paste a game',`<p class="form-copy">Paste a complete game. We’ll suggest the deepest matching line in your ${side} repertoire.</p><label>Game name <span>Optional</span><input name="name" placeholder="e.g. A lesson in development"></label><label>Moves <span>Standard notation or PGN</span><textarea name="pgn" required rows="6" placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5"></textarea></label><p class="form-hint">Use a game starting from the standard chess position. Comments and variations stay in the pasted text but are not shown as notes.</p><div class="form-actions"><button type="button" class="button secondary cancel">Cancel</button><button class="button primary">Find opening</button></div>`,d=>{const pgn=String(d.get('pgn')).trim(),found=matchGameFolder(folders,side,pgn,f.id);if(!found.ok){toast(found.error);return}const white=pgn.match(/\[White\s+"([^"]+)"\]/i)?.[1],black=pgn.match(/\[Black\s+"([^"]+)"\]/i)?.[1];const name=String(d.get('name')).trim()||((white&&black)?`${white} vs ${black}`:'Imported game');const target=found.folder||f;const reason=found.folder?(found.ambiguous?'Several saved lines match. Choose where to file this game.':`Matched your saved line: ${target.name}.`):'No saved opening matched. Choose a folder or use the current one.';$('#modal').close();modal('Choose a game folder',`<p class="form-copy">${esc(reason)}</p><label>Destination opening<select name="destination">${folderOptions(target.id)}</select></label><p class="form-hint">You can move the game later. Only your saved opening lines are used.</p><div class="form-actions"><button type="button" class="button secondary cancel">Cancel</button><button class="button primary">Add game</button></div>`,choice=>{const destination=folders.find(x=>x.id===String(choice.get('destination')));if(!destination){toast('Choose an opening');return}const g={id:crypto.randomUUID(),name,date:'Your game',pgn,notes:{},gameNote:''};destination.games.push(g);const saved=save();$('#modal').close();side=destination.side;flipped=side==='black';folderId=destination.id;selectGame(g.id);toast(saved?'Game added':'Game not saved; export a backup')})})}
$('#moveSymbolControl').onclick=event=>{const button=event.target.closest('[data-move-symbol]');if(!button||button.disabled)return;const {owner,unknown,symbols}=moveSymbolContext();if(!owner||unknown||!engine.index)return;const path=engine.moves.slice(0,engine.index),symbol=button.dataset.moveSymbol,value=symbols[path.join(' ')]===symbol?'':symbol;const had=Object.hasOwn(owner,'moveSymbols'),previous=had?structuredClone(owner.moveSymbols):null;const result=setMoveSymbol(owner,path,value);if(!result.ok){showStorageFailure(result.error);renderMoveExplorer();return}if(result.changed&&!save()){if(had)owner.moveSymbols=previous;else delete owner.moveSymbols}renderBoard();renderMoveExplorer()};
$('#editFolder').onclick=()=>editFolder();$('#deleteFolder').onclick=()=>removeFolder();
$('#sideWhite').onclick=()=>switchSide('white');$('#sideBlack').onclick=()=>switchSide('black');$('#addRoot').onclick=()=>addFolder();$('#addChild').onclick=()=>addFolder(folderId);$('#addBranch').onclick=()=>addFolder(folderId);$('#addGame').onclick=addGame;$('#closeModal').onclick=()=>$('#modal').close();$('#openingView').onclick=()=>{gameId=null;gameOwnerId=null;gameListScopeId=null;setPosition(currentFolder()?.line||'');updateMatch();render()};$('#flip').onclick=()=>{flipped=!flipped;renderBoard();renderMoveExplorer()};$('#drawMode').onclick=()=>marks.setMode(!marks.getMode());$('#clearMarks').onclick=()=>marks.clear();
function go(index){const target=Math.max(0,Math.min(engine.moves.length,index));let motion=[];if(target===engine.index+1){const move=engine.history[engine.index];motion=prepareMotion(move.from,move.to)}else if(target===engine.index-1){const move=engine.history[target];motion=prepareMotion(move.to,move.from)}engine.go(target);selected=null;updateMatch();renderBoard(motion);renderContext()}
// Copy only the moves reached on the board, not later moves or sibling variations.
async function copyTextToClipboard(text){
 const clipboard=globalThis.navigator?.clipboard;
 if(clipboard?.writeText){try{await clipboard.writeText(text);return true}catch{ /* Try the local-file fallback. */ }}
 const previous=document.activeElement;let input;
 try{
  input=document.createElement('textarea');input.value=text;input.readOnly=true;
  input.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(input);input.focus();input.select();
  return document.execCommand('copy')===true;
 }catch{return false}
 finally{input?.remove();try{previous?.focus({preventScroll:true})}catch{}}
}
async function copyCurrentPgn(){
 const moves=engine.moves.slice(0,engine.index);
 if(!moves.length){toast('Play or select a move first');return}
 const pgn=`${formatLine(moves)} *`;
 toast(await copyTextToClipboard(pgn)?'PGN copied':'Could not copy PGN. Check clipboard permission and try again.');
}
$('#copyPgn').onclick=copyCurrentPgn;
$('#saveOpeningLine').onclick=()=>{const folder=currentFolder();if(!folder||currentGame()||!engine.index||storageBlocked)return;const had=Object.hasOwn(folder,'openingVariations'),previous=had?structuredClone(folder.openingVariations):null;const result=saveOpeningVariation(folder,engine.moves.slice(0,engine.index));if(!result.ok){showStorageFailure(result.error);return}if(!result.changed){toast('This line is already saved');return}if(!save()){if(had)folder.openingVariations=previous;else delete folder.openingVariations;renderMoveExplorer();toast('Line not saved; export a backup');return}renderMoveExplorer();toast('Opening line saved')};
$('#first').onclick=()=>go(0);$('#prev').onclick=()=>go(engine.index-1);$('#next').onclick=stepNext;$('#last').onclick=stepLast;$('#saveLine').onclick=()=>{if(!currentFolder())return;const result=validateFolderLine(folders,folderId,formatLine(engine.moves.slice(0,engine.index)));if(!result.ok){toast(result.error);return}currentFolder().line=result.line;const saved=save();updateMatch();renderContext();toast(saved?'Folder position saved':'Changes not saved; export a backup')};document.addEventListener('keydown',e=>{if(e.target.matches('input, textarea, select')||$('#modal').open)return;if(e.key==='ArrowLeft')$('#prev').click();if(e.key==='ArrowRight')$('#next').click()});setPosition('');updateMatch();render();

function snapshot(){return {version:1,folders,annotations}}
function validSnapshot(data){return data && typeof data==='object' && validStoredLibrary(data.folders) && (!('annotations' in data) || validMarkings(data.annotations))}
function applySnapshot(data){
 const wasBlocked=storageBlocked||marksBlocked;
 if(!validSnapshot(data))throw new Error('Invalid library data');
 if(!storageBlocked){const current=checkLibraryCurrent(storage);if(!current.ok)throw new Error(current.error.message)}
 if(!marksBlocked){const current=checkMarkingsCurrent();if(!current.ok)throw new Error(current.error)}
 if(!storageBlocked&&!saveCheckpoint())throw new Error('The current library could not be backed up');
 const replacement=migrateLibrary(data.folders,[]);
 const nextMarks=data.annotations||{};let oldMarks=null,marksWritten=false;
 try{
  oldMarks=storage.getItem('opening-notebook-marks-v1');
  if(!marksBlocked&&oldMarks!==originalMarksRaw)throw new Error('Board markings changed in another tab. Reload before importing.');
  if(oldMarks!==null){let key=`opening-notebook-marks-recovery-${Date.now()}`,n=0;while(storage.getItem(key)!==null)key=`opening-notebook-marks-recovery-${Date.now()}-${++n}`;storage.setItem(key,oldMarks);if(storage.getItem(key)!==oldMarks)throw new Error('The current markings could not be backed up')}
  if(storage.getItem('opening-notebook-marks-v1')!==oldMarks)throw new Error('Board markings changed during import. Nothing was replaced.');
  storage.setItem('opening-notebook-marks-v1',JSON.stringify(nextMarks));marksWritten=true;
  const result=storageBlocked?restoreLibrary(storage,replacement):saveLibrary(storage,replacement);
  if(!result.ok)throw new Error(result.error.message);
 }catch(error){
  if(marksWritten){try{if(storage.getItem('opening-notebook-marks-v1')===JSON.stringify(nextMarks)){if(oldMarks===null)storage.removeItem('opening-notebook-marks-v1');else storage.setItem('opening-notebook-marks-v1',oldMarks)}else{showStorageFailure('The library import failed and board markings changed during recovery. Reload and review your backups.');throw error}}catch(rollbackError){showStorageFailure('The library import failed; board markings could not be restored automatically. Review your backups.');throw rollbackError}}
  showStorageFailure(error.message||'The library could not be imported. The previous copy was kept.');throw error;
 }
 folders=replacement;annotations=nextMarks;storageBlocked=false;marksBlocked=false;originalRaw=null;originalMarksRaw=JSON.stringify(nextMarks);migrateGameMarkings();
 if(!setStored('opening-notebook-user-data-v1','1'))throw new Error('The imported library was saved, but the browser could not update its status');
 storageFailure=null;$('#storageWarning').hidden=true;$('#downloadOriginal').hidden=true;$('#downloadOriginalMarks').hidden=true;$('#exportData').disabled=false;$('#syncNow').hidden=false;hasUserData=true;if(wasBlocked)syncController?.start();side='white';flipped=false;folderId=folders.find(f=>f.side===side)?.id||null;gameId=null;gameOwnerId=null;gameListScopeId=null;setPosition(currentFolder()?.line||'');updateMatch();render();
}
function confirmAction(title,description,label,action){modal(title,`<p class="form-copy">${esc(description)}</p><div class="form-actions"><button type="button" class="button secondary cancel">Cancel</button><button class="button primary">${esc(label)}</button></div>`,()=>{$('#modal').close();action()})}
$('#exportData').onclick=()=>{const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chess-study-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup download started. Check your Downloads.')};
$('#importData').onclick=()=>$('#importFile').click();
$('#downloadOriginalMarks').onclick=()=>{if(originalMarksRaw===null)return;const blob=new Blob([originalMarksRaw],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chess-original-markings.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Original markings download started. Check your Downloads.')};
$('#downloadOriginal').onclick=()=>{if(originalRaw===null)return;const blob=new Blob([originalRaw],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chess-original-library.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Original data download started. Check your Downloads.')};
$('#restoreData').hidden=!getStored('opening-notebook-before-import');
$('#restoreData').onclick=()=>{let previous;try{previous=JSON.parse(getStored('opening-notebook-before-import'));if(!validSnapshot(previous))throw new Error()}catch{toast('No previous copy is available');return}confirmAction('Restore previous copy','This replaces the current library on this device with the copy saved before the last import.','Restore copy',()=>{try{applySnapshot(previous);syncController?.markChanged();toast('Previous copy restored')}catch(error){toast(error.message||'Could not restore the previous copy')}})};
$('#importFile').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;let data;try{data=JSON.parse(await file.text());if(!validSnapshot(data))throw new Error()}catch{toast('This is not a valid study backup');return}confirmAction('Import backup','This replaces the library on this device. The current copy will be kept in browser storage as a backup.','Import backup',()=>{try{applySnapshot(data);syncController?.markChanged();toast('Backup imported')}catch(error){toast(error.message||'Could not import the backup')}})};
let cloudSync=null;
function syncStatus(status){
 $('#syncStatus').textContent=status.message;
 const busy=status.kind==='checking'||status.kind==='syncing';
 $('#syncNow').disabled=busy;$('#syncSignOut').disabled=busy;
 $('#useCloud').hidden=status.kind!=='conflict';$('#useLocal').hidden=!['setup','conflict'].includes(status.kind);
}
function canSyncLibrary(){
 if(storageFailure||storageBlocked||marksBlocked)return false;
 const library=checkLibraryCurrent(storage);if(!library.ok){showStorageFailure(library.error.message);return false}
 const marking=checkMarkingsCurrent();if(!marking.ok){showStorageFailure(marking.error);return false}
 return true;
}
function connectSync(){
 if(storageBlocked||marksBlocked){showStorageFailure('Synchronization is paused to protect the saved data.');return}
 let config={};try{config=JSON.parse(getStored('opening-notebook-cloud-config-v1')||'{}')}catch{}
 modal('Connect phone and PC',`<p class="form-copy">Sign in with the same private sync account on both devices. Set up your cloud project first; see the sync setup guide. Your library stays on this device until you choose to upload it.</p><label>Project URL<input name="url" type="url" required value="${esc(config.url||'')}" placeholder="https://your-project.supabase.co"></label><label>Publishable key<input name="key" required value="${esc(config.key||'')}" autocomplete="off"></label><label>Email<input name="email" type="email" required autocomplete="username"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><p id="connectError" class="form-hint" role="alert"></p><div class="form-actions"><button type="button" class="button secondary cancel">Cancel</button><button class="button primary">Sign in</button></div>`,async data=>{
  const form=$('#modalForm'),button=form.querySelector('button[type="submit"], button:not([type])'),errorElement=$('#connectError');
  const active=()=>$('#modal').open&&$('#connectError')===errorElement;
  if(button.disabled)return;
  button.disabled=true;errorElement.textContent='Signing in…';
  let client;try{
   const url=String(data.get('url')).trim(),key=String(data.get('key')).trim();
   client=createCloudSync({url,key});await client.signIn(String(data.get('email')).trim(),String(data.get('password')));
   if(!active()){await client.signOut();return}
   try{storage.setItem('opening-notebook-cloud-config-v1',JSON.stringify({url,key}))}catch{}
   cloudSync=client;
   syncController=createSyncController({getSnapshot:snapshot,applySnapshot,hasLocalData:()=>hasUserData,canSync:canSyncLibrary,onStatus:syncStatus,fetchImpl:cloudSync.fetch,isFile:false});
   $('#modal').close();$('#syncNow').textContent='Synchronize';$('#syncSignOut').hidden=false;await syncController.start();
  }catch(error){if(active())errorElement.textContent=error.message||'Could not sign in. Check the project and account details.'}
  finally{button.disabled=false}
 });
}
$('#syncNow').onclick=()=>{if(syncController)void syncController.syncNow();else connectSync()};
$('#syncSignOut').onclick=async()=>{const controller=syncController,client=cloudSync;if(!controller)return;$('#syncSignOut').disabled=true;$('#syncNow').disabled=true;await controller.stop();await client.signOut();syncController=null;cloudSync=null;$('#syncSignOut').hidden=true;$('#syncNow').disabled=false;$('#syncNow').textContent='Connect to sync';$('#useCloud').hidden=true;$('#useLocal').hidden=true;$('#syncStatus').textContent='Saved on this device. Sign in to synchronize.'};
$('#useCloud').onclick=()=>confirmAction('Use cloud copy','This replaces this device’s library with your cloud copy. A local backup will be retained.','Use cloud copy',()=>syncController?.useCloud());
$('#useLocal').onclick=()=>confirmAction('Upload this device','This saves this device’s library to your account, replacing the current cloud copy if there is one.','Upload library',()=>syncController?.useLocal());
if(storageBlocked||marksBlocked){$('#syncStatus').textContent='Synchronization is paused to protect the saved data.';$('#syncNow').hidden=true;$('#exportData').disabled=originalRaw!==null;}
