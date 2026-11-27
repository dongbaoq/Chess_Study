// Run with: node --experimental-vm-modules --test tests/opening-backup-roundtrip.test.cjs
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
  if (mod.status === 'unlinked') await mod.link(async (specifier, referencing) => load(path.relative(root, path.resolve(path.dirname(referencing.identifier), specifier))));
  return mod;
}
async function library() { const m = await load('library.js'); if (m.status === 'linked') await m.evaluate(); return m.namespace; }
class MemoryStorage {
  constructor(values={}) { this.map = new Map(Object.entries(values)); this.denyV2 = false; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { if (this.denyV2 && key === 'opening-notebook-v2') throw new Error('storage unavailable'); this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
const fixture = () => [
  {id:'root',side:'white',parentId:null,name:'Open games',line:'1. e4',note:'Opening ideas',blunders:[{id:'b',moves:['e4'],text:'Keep the center',extra:{future:1}}],moveSymbols:{e4:'□'},openingVariations:[{moves:['e4','c5','Nf3'],extra:'keep'}, {moves:['e4','e5','Nf3'],comment:{unknown:true}}],games:[],extraFolder:{unrecognized:'keep'}},
  {id:'child',side:'white',parentId:'root',name:'Spanish',line:'1. e4 e5 2. Nf3',note:'Develop',games:[{id:'game',name:'Game',pgn:'1. e4 e5 2. Nf3 Nc6',gameNote:'Game reflection',notes:{'e4 e5':'Position note'},moveSymbols:{'e4 e5 Nf3':'??'},analysisVariations:[{moves:['e4','c5'],other:'retain'}],extraGame:{retain:42}}]},
];
const marks = () => ({'game:game:position':{squares:{d4:'red'},arrows:[{from:'e2',to:'e4',color:'green',extra:'keep'}],unknown:{preserve:true}}});
const clone = value => JSON.parse(JSON.stringify(value));

function appHarness(storage, loaded, lib) {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const snippet = (start, end) => { const a=source.indexOf(start); assert.notEqual(a,-1,start); const b=source.indexOf(end,a); assert.notEqual(b,-1,end); return source.slice(a,b); };
  const element = new Map(); let capturedBlob = null, downloaded = null, lastError = null;
  const $ = key => { if (!element.has(key)) element.set(key,{}); return element.get(key); };
  const sandbox = {
    storage, folders:loaded.folders, annotations:JSON.parse(storage.getItem('opening-notebook-marks-v1') || '{}'),
    storageBlocked:loaded.writeBlocked, marksBlocked:false, originalRaw:loaded.raw,
    originalMarksRaw:storage.getItem('opening-notebook-marks-v1'), storageFailure:null, hasUserData:true,
    side:'white', flipped:false, folderId:loaded.folders[0]?.id || null, gameId:null, gameOwnerId:null,
    syncController:{start(){}}, ...lib, $, Blob,
    URL:{createObjectURL(blob){capturedBlob=blob;return 'blob:test'},revokeObjectURL(){}},
    document:{createElement(type){assert.equal(type,'a');return {click(){downloaded={href:this.href,download:this.download}}}}},
    setTimeout(){}, toast(){}, setPosition(){}, updateMatch(){}, render(){},
    currentFolder(){return sandbox.folders.find(f=>f.id===sandbox.folderId)||null},
    showStorageFailure(message){lastError=message;sandbox.storageFailure=message},
    setStored(key,value){try{storage.setItem(key,value);return true}catch{return false}},
    confirmAction(_title,_description,_label,action){action()}
  };
  vm.createContext(sandbox);
  const validMarkings=source.split('\n').find(line=>line.startsWith('function validMarkings('));
  const checkpoint=source.split('\n').find(line=>line.startsWith('function saveCheckpoint('));
  assert.ok(validMarkings);assert.ok(checkpoint);
  const checking=snippet('function checkMarkingsCurrent(){','function writeMarkings(');
  const migrateMarks=snippet('function migrateGameMarkings(){','migrateGameMarkings();');
  const snapshots=snippet('function snapshot(){','function confirmAction(');
  const exportHandler=source.split('\n').find(line=>line.startsWith("$('#exportData').onclick="));
  const importHandler=source.split('\n').find(line=>line.startsWith("$('#importFile').onchange="));
  assert.ok(exportHandler);assert.ok(importHandler);
  vm.runInContext([validMarkings,checkpoint,checking,migrateMarks,snapshots,exportHandler,importHandler].join('\n'),sandbox);
  return {sandbox,element,exported:()=>capturedBlob,downloaded:()=>downloaded,error:()=>lastError};
}

test('existing nested library survives v1 migration and actual export/import handlers', async () => {
  const lib=await library(), original=fixture(), originalMarks=marks(), v1=JSON.stringify(original), markRaw=JSON.stringify(originalMarks);
  const sourceStore=new MemoryStorage({[lib.LEGACY_LIBRARY_KEY]:v1,'opening-notebook-marks-v1':markRaw});
  const loaded=lib.readLibrary(sourceStore); assert.equal(loaded.migrated,true); assert.equal(lib.saveLibrary(sourceStore,loaded.folders).ok,true);
  const source=appHarness(sourceStore,loaded,lib);
  source.element.get('#exportData').onclick();
  assert.deepEqual(source.downloaded(),{href:'blob:test',download:'chess-study-backup.json'});
  const exported=JSON.parse(await source.exported().text());
  assert.deepEqual(exported,{version:1,folders:original,annotations:originalMarks});
  assert.equal(sourceStore.getItem(lib.LEGACY_LIBRARY_KEY),v1);
  const unrelated=[{id:'other',side:'white',parentId:null,name:'Existing',line:'1. d4',games:[],note:'Preserve in checkpoint'}];
  const oldMarks={'white:other:opening:position':{squares:{a1:'blue'},arrows:[]}};
  const targetStore=new MemoryStorage({[lib.LIBRARY_KEY]:JSON.stringify(unrelated),'opening-notebook-marks-v1':JSON.stringify(oldMarks)});
  const target=appHarness(targetStore,lib.readLibrary(targetStore),lib);
  await target.element.get('#importFile').onchange({target:{files:[{text:async()=>JSON.stringify(exported)}],value:'chosen'}});
  assert.deepEqual(clone(lib.readLibrary(targetStore).folders),original);
  assert.deepEqual(JSON.parse(targetStore.getItem('opening-notebook-marks-v1')),originalMarks);
  assert.deepEqual(JSON.parse(targetStore.getItem('opening-notebook-before-import')),{version:1,folders:unrelated,annotations:oldMarks});
  assert.ok([...targetStore.map.keys()].some(k=>k.startsWith('opening-notebook-marks-recovery-')));
  assert.equal(target.error(),null);
});

test('failed import restores original library and board marks', async () => {
  const lib=await library(), original=fixture(), originalMarks=marks();
  const store=new MemoryStorage({[lib.LIBRARY_KEY]:JSON.stringify(original),'opening-notebook-marks-v1':JSON.stringify(originalMarks)});
  const harness=appHarness(store,lib.readLibrary(store),lib);
  store.denyV2=true;
  const incoming={version:1,folders:[{id:'other',side:'white',parentId:null,name:'Other',line:'1. d4',games:[]}],annotations:{}};
  assert.throws(()=>harness.sandbox.applySnapshot(incoming));
  assert.deepEqual(JSON.parse(store.getItem(lib.LIBRARY_KEY)),original);
  assert.deepEqual(JSON.parse(store.getItem('opening-notebook-marks-v1')),originalMarks);
  assert.match(harness.error(),/storage/i);
});

test('renaming a nested game preserves all other records through save, reload, export and import', async () => {
  const lib=await library(), original=fixture(), originalMarks=marks(), raw=JSON.stringify(original);
  const store=new MemoryStorage({[lib.LEGACY_LIBRARY_KEY]:raw,'opening-notebook-marks-v1':JSON.stringify(originalMarks)});
  const loaded=lib.readLibrary(store); assert.equal(loaded.migrated,true); assert.equal(lib.saveLibrary(store,loaded.folders).ok,true);
  const h=appHarness(store,loaded,lib), source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const start=source.indexOf('function renameGame('),end=source.indexOf('function removeGame(',start);assert.ok(start>=0&&end>start);
  let callback=null,closed=0,rendered=0,saves=0;const notices=[];
  Object.assign(h.sandbox,{gameId:'game',gameOwnerId:'child',gameListScopeId:'root',storageBlocked:false,
    esc:s=>String(s),modal(_title,_body,fn){callback=fn},renderContext(){rendered++},toast:s=>notices.push(s),
    save(){saves++;return lib.saveLibrary(store,h.sandbox.folders).ok}});
  h.element.set('#modal',{close(){closed++}});
  vm.runInContext(source.slice(start,end),h.sandbox);
  h.sandbox.renameGame('child','game'); assert.equal(typeof callback,'function');
  callback({get:()=> '   '}); assert.equal(saves,0); assert.match(notices.at(-1),/title/i);
  callback({get:()=> 'Game'}); assert.equal(saves,0); assert.equal(closed,1);
  h.sandbox.renameGame('child','game'); callback({get:()=> ' New title '});
  const expected=fixture();expected[1].games[0].name='New title';
  assert.equal(saves,1);assert.equal(rendered,1);assert.equal(h.sandbox.gameId,'game');assert.equal(h.sandbox.gameOwnerId,'child');
  assert.deepEqual(clone(lib.readLibrary(store).folders),expected);
  assert.deepEqual(JSON.parse(store.getItem('opening-notebook-marks-v1')),originalMarks);
  assert.equal(store.getItem(lib.LEGACY_LIBRARY_KEY),raw);
  h.element.get('#exportData').onclick();const exported=JSON.parse(await h.exported().text());
  assert.deepEqual(exported,{version:1,folders:expected,annotations:originalMarks});
  const targetStore=new MemoryStorage({[lib.LIBRARY_KEY]:JSON.stringify(fixture()),'opening-notebook-marks-v1':JSON.stringify(originalMarks)});
  const target=appHarness(targetStore,lib.readLibrary(targetStore),lib);
  await target.element.get('#importFile').onchange({target:{files:[{text:async()=>JSON.stringify(exported)}],value:'chosen'}});
  assert.deepEqual(clone(lib.readLibrary(targetStore).folders),expected);
  assert.deepEqual(JSON.parse(targetStore.getItem('opening-notebook-marks-v1')),originalMarks);
});

test('rename rollback and duplicate-ID guard leave the original nested game and markings intact', async () => {
  const lib=await library(), original=fixture(), originalMarks=marks();
  const store=new MemoryStorage({[lib.LIBRARY_KEY]:JSON.stringify(original),'opening-notebook-marks-v1':JSON.stringify(originalMarks)});
  const h=appHarness(store,lib.readLibrary(store),lib), source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const start=source.indexOf('function renameGame('),end=source.indexOf('function removeGame(',start);assert.ok(start>=0&&end>start);
  let callback=null,notice='';Object.assign(h.sandbox,{storageBlocked:false,esc:s=>String(s),modal(_t,_b,fn){callback=fn},renderContext(){},toast:s=>{notice=s},save(){return lib.saveLibrary(store,h.sandbox.folders).ok}});
  h.element.set('#modal',{close(){}});vm.runInContext(source.slice(start,end),h.sandbox);
  store.denyV2=true;h.sandbox.renameGame('child','game');callback({get:()=> 'New title'});
  assert.deepEqual(clone(h.sandbox.folders),original);assert.deepEqual(JSON.parse(store.getItem(lib.LIBRARY_KEY)),original);
  assert.deepEqual(JSON.parse(store.getItem('opening-notebook-marks-v1')),originalMarks);assert.match(notice,/not saved/i);
  store.denyV2=false;h.sandbox.folders[1].games.push({...original[1].games[0],name:'Another game'});callback=null;
  const before=JSON.stringify(h.sandbox.folders);h.sandbox.renameGame('child','game');
  assert.equal(callback,null);assert.equal(JSON.stringify(h.sandbox.folders),before);assert.match(notice,/same ID/i);
  h.sandbox.folders[1].games.pop();h.sandbox.folders.push({...h.sandbox.folders[1],name:'Duplicate folder'});callback=null;
  const duplicateFolder=JSON.stringify(h.sandbox.folders);h.sandbox.renameGame('child','game');
  assert.equal(callback,null);assert.equal(JSON.stringify(h.sandbox.folders),duplicateFolder);assert.match(notice,/opening shares an ID/i);
});

test('startup and repertoire switches use the starting position; selecting a folder opens its line', async () => {
  const module=await load('chess.js');if(module.status==='linked')await module.evaluate();const {ChessGame}=module.namespace;
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8'), snippets=['function setPosition(','function switchSide(','function selectFolder('].map(prefix=>source.split('\n').find(line=>line.startsWith(prefix)));
  assert.ok(snippets.every(Boolean));
  const startup=source.match(/\}\);(setPosition\(''\);updateMatch\(\);render\(\);)/);assert.ok(startup,'startup uses the initial position');
  const folders=[...fixture(),{id:'black',name:'Black line',side:'black',parentId:null,line:'1. d4 d5',games:[]}],before=JSON.stringify(folders);
  const state={folders,side:'white',folderId:'root',gameId:'game',gameOwnerId:'child',gameListScopeId:'root',flipped:false,selected:'e2',engine:new ChessGame(),ChessGame,
    currentFolder(){return state.folders.find(f=>f.id===state.folderId&&f.side===state.side)||null},updateMatch(){},render(){},toast(message){throw new Error(message)}};
  vm.createContext(state);vm.runInContext(snippets.join('\n')+'\n'+startup[1],state);
  assert.equal(state.engine.index,0);assert.equal(state.engine.moves.length,0);
  state.selectFolder('child');assert.equal(state.engine.index,3);assert.equal(state.engine.moves.join(' '),'e4 e5 Nf3');
  state.switchSide('black');assert.equal(state.engine.index,0);assert.equal(state.flipped,true);assert.equal(state.gameId,null);
  state.selectFolder('black');assert.equal(state.engine.moves.join(' '),'d4 d5');
  state.switchSide('white');assert.equal(state.engine.index,0);assert.equal(state.flipped,false);
  assert.equal(JSON.stringify(folders),before);
});
