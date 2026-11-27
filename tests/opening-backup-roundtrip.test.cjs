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
