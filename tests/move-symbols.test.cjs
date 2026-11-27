// Run with: node --experimental-vm-modules --test tests/move-symbols.test.cjs
// Use the project's browser modules directly, without changing its module settings.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const modules = new Map();
async function load(relative) {
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep)) throw new Error('Module outside project');
  if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), {identifier:filename}));
  const mod = modules.get(filename);
  if (mod.status === 'unlinked') await mod.link(async (specifier, referencing) => {
    const dependency = path.resolve(path.dirname(referencing.identifier), specifier);
    return load(path.relative(root, dependency));
  });
  return mod;
}
async function get(relative) { const mod = await load(relative); if (mod.status === 'linked') await mod.evaluate(); return mod.namespace; }
class MemoryStorage {
  constructor(initial={}) { this.map=new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
const fixture = () => [
  {id:'root',name:'Open games',side:'white',parentId:null,line:'1. e4',note:'Control the center.',blunders:[{id:'b1',moves:['e4'],text:'Do not hang the pawn.',extra:'retain'}],moveSymbols:{e4:'□', 'e4 e5':'future-symbol'},extra:{source:'original'},games:[]},
  {id:'child',name:'Spanish',side:'white',parentId:'root',line:'1. e4 e5 2. Nf3',note:'Develop.',games:[{id:'game',name:'Game',pgn:'1. e4 e5 2. Nf3 Nc6',gameNote:'Game lesson',notes:{'e4 e5':'Position lesson'},moveSymbols:{'e4 e5 Nf3':'?'},analysisVariations:[{moves:['e4','c5'],extra:'retain'}],extraGameField:{value:1}}]},
];
const markings = {'game:game:position':{arrows:[{from:'e2',to:'e4',color:'green'}],squares:{d4:'red'},extra:'retain'}};

test('move symbols can be added, replaced, cleared, and legacy symbols read without rewriting', async () => {
  const {readMoveSymbols,setMoveSymbol} = await get('move-symbols.js');
  const game = fixture()[1].games[0];
  for (const symbol of ['!','!!','?','??']) {
    assert.equal(setMoveSymbol(game,['e4','e5'],symbol).changed,true);
    assert.equal(readMoveSymbols(game).symbols['e4 e5'],symbol);
  }
  assert.equal(setMoveSymbol(game,['e4','e5'],'').changed,true);
  assert.equal(readMoveSymbols(game).symbols['e4 e5'],undefined);
  const opening=fixture()[0];
  assert.equal(readMoveSymbols(opening).symbols.e4,'!');
  assert.equal(opening.moveSymbols.e4,'□');
  assert.equal(setMoveSymbol(opening,['e4'],'!').changed,false);
  assert.equal(opening.moveSymbols.e4,'□');
  assert.equal(setMoveSymbol(opening,[], '!').ok,false);
});

test('unrecognized or unreadable symbol values are never overwritten', async () => {
  const {readMoveSymbols,setMoveSymbol} = await get('move-symbols.js');
  const opening=fixture()[0], before=JSON.stringify(opening);
  assert.equal(setMoveSymbol(opening,['e4','e5'],'??').ok,false);
  assert.equal(JSON.stringify(opening),before);
  const malformed={moveSymbols:['not a map'],other:'keep'};
  assert.equal(readMoveSymbols(malformed).ok,false);
  assert.equal(setMoveSymbol(malformed,['e4'],'?').ok,false);
  assert.deepEqual(malformed,{moveSymbols:['not a map'],other:'keep'});
});

test('marking and saving an existing library preserves nested data and board annotations', async () => {
  const {LIBRARY_KEY,readLibrary,saveLibrary,restoreLibrary} = await get('library.js');
  const {setMoveSymbol} = await get('move-symbols.js');
  const original=fixture(), marksRaw=JSON.stringify(markings);
  const storage=new MemoryStorage({[LIBRARY_KEY]:JSON.stringify(original),'opening-notebook-marks-v1':marksRaw});
  const loaded=readLibrary(storage); assert.equal(loaded.writeBlocked,false);
  assert.equal(setMoveSymbol(loaded.folders[1].games[0],['e4','e5'],'!!').ok,true);
  assert.equal(saveLibrary(storage,loaded.folders).ok,true);
  const reloaded=readLibrary(storage).folders;
  const expected=fixture(); expected[1].games[0].moveSymbols['e4 e5']='!!';
  assert.deepEqual(reloaded,expected);
  assert.equal(storage.getItem('opening-notebook-marks-v1'),marksRaw);
  // Exercise the library recovery/import primitive with an exported JSON snapshot.
  const backup=JSON.parse(JSON.stringify({version:1,folders:reloaded,annotations:markings}));
  assert.equal(restoreLibrary(storage,backup.folders).ok,true);
  assert.deepEqual(readLibrary(storage).folders,expected);
  assert.deepEqual(backup.annotations,markings);
});

test('legacy library migration and corrupt storage preserve original records', async () => {
  const {LIBRARY_KEY,LEGACY_LIBRARY_KEY,readLibrary,saveLibrary} = await get('library.js');
  const legacy=JSON.stringify(fixture()), storage=new MemoryStorage({[LEGACY_LIBRARY_KEY]:legacy});
  const read=readLibrary(storage); assert.equal(read.migrated,true);
  assert.deepEqual(read.folders,fixture());
  assert.equal(saveLibrary(storage,read.folders).ok,true);
  assert.equal(storage.getItem(LEGACY_LIBRARY_KEY),legacy);
  assert.deepEqual(JSON.parse(storage.getItem(LIBRARY_KEY)),fixture());
  const corrupt=new MemoryStorage({[LIBRARY_KEY]:'{bad'});
  const result=readLibrary(corrupt); assert.equal(result.writeBlocked,true);
  assert.equal(saveLibrary(corrupt,fixture()).ok,false);
  assert.equal(corrupt.getItem(LIBRARY_KEY),'{bad');
});

test('move icons stay centered and paired question marks retain natural proportions', async () => {
  const {BOARD_SYMBOL_ICONS} = await get('move-symbols.js');
  for (const symbol of ['!','!!','?','??']) {
    const svg=BOARD_SYMBOL_ICONS[symbol];
    assert.match(svg, /viewBox="0 0 512 512"/);
    assert.match(svg, /aria-hidden="true"/);
    const transforms=[...svg.matchAll(/transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+) ([\d.]+)\)"/g)];
    assert.equal(transforms.length,symbol.length);
    const [sourceLeft,sourceRight]=symbol[0]==='!'?[24,104]:[16,304];
    const boxes=transforms.map(([,x,y,sx,sy])=>({left:Number(x)+sourceLeft*Number(sx),right:Number(x)+sourceRight*Number(sx),top:Number(y)+32*Number(sy),bottom:Number(y)+480*Number(sy),sx:Number(sx),sy:Number(sy)}));
    for(const box of boxes){assert.ok(box.left>=0 && box.right<=512 && box.top>=0 && box.bottom<=512);assert.ok(Math.abs((box.top+box.bottom)/2-256)<0.5);}
    assert.ok(Math.abs((boxes[0].left+boxes.at(-1).right)/2-256)<0.1);
    if(boxes.length===2)assert.ok(boxes[1].left-boxes[0].right>=16);
    if(symbol==='??')for(const box of boxes)assert.equal(box.sx,box.sy);
  }
});

test('board badge follows the current move, flips with the board, and clears cleanly', async () => {
  const {renderBoardMoveSymbol} = await get('move-symbols.js');
  const squares=new Map(['e4','d5','h8','a1'].map(name=>[name,{dataset:{otherMark:'keep'},label:`${name} pawn`,getAttribute(key){return key==='aria-label'?this.label:null},setAttribute(key,value){if(key==='aria-label')this.label=value}}]));
  let badge=null;
  const host={querySelector(){return badge},appendChild(node){badge=node}};
  const board={parentElement:host,ownerDocument:{createElement(){return {style:{},dataset:{},setAttribute(){},remove(){badge=null}}}},querySelectorAll(){return [...squares.values()].filter(s=>s.dataset.symbolBaseLabel)},querySelector(selector){const match=selector.match(/data-square="([a-h][1-8])"/);return match?squares.get(match[1]):null}};
  renderBoardMoveSymbol(board,{to:'e4'},'!!');
  assert.match(badge.innerHTML, /^<svg/); assert.equal((badge.innerHTML.match(/<path /g)||[]).length,2); assert.equal(badge.style.left,'62.5%'); assert.equal(badge.style.top,'50%');
  assert.equal(squares.get('e4').label,'e4 pawn, Brilliant move');
  assert.equal(squares.get('e4').dataset.moveSymbolTone,'brilliant');
  renderBoardMoveSymbol(board,{to:'d5'},'?',true);
  assert.match(badge.innerHTML, /^<svg/); assert.equal((badge.innerHTML.match(/<path /g)||[]).length,1); assert.equal(badge.style.left,'62.5%'); assert.equal(badge.style.top,'50%');
  assert.equal(squares.get('e4').label,'e4 pawn'); assert.equal(squares.get('d5').label,'d5 pawn, Mistake');
  assert.equal(squares.get('e4').dataset.moveSymbolTone,undefined);
  assert.equal(squares.get('d5').dataset.moveSymbolTone,'question');
  for (const [symbol,tone] of [['!','only'],['!!','brilliant'],['?','question'],['??','blunder']]) {
    renderBoardMoveSymbol(board,{to:'d5'},symbol);
    assert.equal(squares.get('d5').dataset.moveSymbolTone,tone);
    assert.equal(squares.get('e4').dataset.moveSymbolTone,undefined);
  }
  renderBoardMoveSymbol(board,{to:'h8'},'!');
  assert.equal(badge.dataset.edgeRight,'true'); assert.equal(badge.dataset.edgeTop,'true');
  renderBoardMoveSymbol(board,{to:'a1'},'!',true);
  assert.equal(badge.dataset.edgeRight,'true'); assert.equal(badge.dataset.edgeTop,'true');
  renderBoardMoveSymbol(board,{to:'e4'},'!');
  assert.equal(badge.dataset.edgeRight,'false'); assert.equal(badge.dataset.edgeTop,'false');
  renderBoardMoveSymbol(board,null,'');
  assert.equal(badge,null); assert.equal(squares.get('d5').label,'d5 pawn');
  assert.equal(squares.get('d5').dataset.moveSymbolTone,undefined);
  assert.equal(squares.get('d5').dataset.otherMark,'keep');
  renderBoardMoveSymbol(board,{to:'x9'},'!'); assert.equal(badge,null);
  renderBoardMoveSymbol(board,{to:'e4'},'__proto__'); assert.equal(badge,null);
});

test('actual marking click handler toggles, replaces, and rolls back on save failure', async () => {
  const {readMoveSymbols,setMoveSymbol} = await get('move-symbols.js');
  const line=fs.readFileSync(path.join(root,'app.js'),'utf8').split('\n').find(s=>s.startsWith("$('#moveSymbolControl').onclick="));
  assert.ok(line, 'marking click handler exists');
  const control={}; let owner={moveSymbols:{'e4 e5':'future-symbol'},other:'retain'};
  let saving=true, saves=0, boardRenders=0, treeRenders=0, error='';
  const engine={moves:['e4'],index:1};
  const sandbox={
    $: selector=>{assert.equal(selector,'#moveSymbolControl');return control},
    moveSymbolContext:()=>({owner,symbols:readMoveSymbols(owner).symbols,unknown:false}),
    engine, structuredClone, setMoveSymbol,
    save:()=>{saves++;return saving},
    renderBoard:()=>boardRenders++, renderMoveExplorer:()=>treeRenders++,
    showStorageFailure:message=>{error=message}
  };
  vm.runInNewContext(line,sandbox);
  const click=(symbol,disabled=false)=>control.onclick({target:{closest:()=>({dataset:{moveSymbol:symbol},disabled})}});
  click('!'); assert.equal(owner.moveSymbols.e4,'!');
  click('??'); assert.equal(owner.moveSymbols.e4,'??');
  click('??'); assert.equal(owner.moveSymbols.e4,undefined);
  assert.equal(owner.moveSymbols['e4 e5'],'future-symbol');
  assert.equal(saves,3); assert.equal(boardRenders,3); assert.equal(treeRenders,3);
  owner.moveSymbols.e4='□'; click('!'); assert.equal(owner.moveSymbols.e4,undefined);
  owner.moveSymbols.e4='?'; saving=false; click('!!');
  assert.equal(owner.moveSymbols.e4,'?'); assert.equal(owner.moveSymbols['e4 e5'],'future-symbol');
  assert.equal(owner.other,'retain'); assert.equal(boardRenders,5); assert.equal(treeRenders,5);
  const count=saves; click('!',true); assert.equal(saves,count);
  engine.index=0; click('!'); assert.equal(saves,count);
  assert.equal(error,'');
});
