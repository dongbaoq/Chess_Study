// Run with: node --experimental-vm-modules --test tests/opening-variations.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const cache=new Map();
async function load(relative){const filename=path.resolve(root,relative);if(!filename.startsWith(root+path.sep))throw new Error('Outside project');if(!cache.has(filename))cache.set(filename,new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{identifier:filename}));const mod=cache.get(filename);if(mod.status==='unlinked')await mod.link((spec,ref)=>load(path.relative(root,path.resolve(path.dirname(ref.identifier),spec.split('?')[0]))));return mod}
async function get(relative){const mod=await load(relative);if(mod.status==='linked')await mod.evaluate();return mod.namespace}
class MemoryStorage{constructor(initial={}){this.map=new Map(Object.entries(initial))}getItem(key){return this.map.has(key)?this.map.get(key):null}setItem(key,value){this.map.set(key,String(value))}removeItem(key){this.map.delete(key)}}
const fixture=()=>[
 {id:'root',side:'white',parentId:null,name:'Open games',line:'1. e4',note:'Opening note',blunders:[{id:'b',moves:['e4'],text:'Trap',extra:'retain'}],moveSymbols:{e4:'!'},extra:{untouched:1},openingVariations:[{moves:['e4','c5'],extra:'retain'}, {future:{nested:true}}],games:[]},
 {id:'child',side:'white',parentId:'root',name:'Spanish',line:'1. e4 e5 2. Nf3',note:'Child note',games:[{id:'g',name:'Game',pgn:'1. e4 e5 2. Nf3 Nc6',gameNote:'Whole game',notes:{'e4 e5':'A position'},moveSymbols:{'e4 e5':'?'},analysisVariations:[{moves:['e4','c5'],extra:'game'}],extra:'retain'}]}
];
const marks=()=>({'game:g:position':{squares:{d4:'red'},arrows:[{from:'e2',to:'e4',color:'green',extra:7}],extra:'keep'}});
const clone=value=>JSON.parse(JSON.stringify(value));

test('save independent opening paths and restore them in the move tree',async()=>{
 const {saveOpeningVariation,getOpeningVariations}=await get('library.js');const {buildMoveTree}=await get('move-tree.js');const folders=fixture(), before=clone(folders);const line=['e4','e5','Nf3','Nc6','Bb5'];
 assert.equal(saveOpeningVariation(folders[1],line).changed,true);assert.equal(saveOpeningVariation(folders[1],line).changed,false);
 const expected=clone(before);expected[1].openingVariations=[{moves:line}];assert.deepEqual(folders,expected);
 const divergent=['d4','d5'];assert.equal(saveOpeningVariation(folders[1],divergent).changed,true);
 assert.deepEqual(getOpeningVariations(folders[1]),[line,divergent]);
 const tree=buildMoveTree({folders,side:'white',folderId:'child',moves:['e4'],index:1});
 const at=seq=>seq.reduce((node,move)=>node?.children.find(c=>c.san===move),tree);
 assert.ok(at(line));assert.ok(at(divergent));assert.ok(at(['e4','c5']));
 assert.deepEqual(folders[0],before[0]);
});

test('unknown data and invalid or unavailable storage are preserved',async()=>{
 const {saveOpeningVariation,LIBRARY_KEY,readLibrary,saveLibrary}=await get('library.js');
 const folder={openingVariations:{future:'format'},note:'keep'},before=clone(folder);assert.equal(saveOpeningVariation(folder,['e4']).ok,false);assert.deepEqual(folder,before);
 const unusual={openingVariations:[null,{newVersion:'keep'},{moves:['e4'],extra:8}]};assert.equal(saveOpeningVariation(unusual,['d4']).changed,true);assert.deepEqual(unusual.openingVariations,[null,{newVersion:'keep'},{moves:['e4'],extra:8},{moves:['d4']}]);
 assert.equal(saveOpeningVariation(unusual,['not-a-move']).ok,false);
 const corrupt=new MemoryStorage({[LIBRARY_KEY]:'{bad'});assert.equal(readLibrary(corrupt).writeBlocked,true);assert.equal(saveLibrary(corrupt,fixture()).ok,false);assert.equal(corrupt.getItem(LIBRARY_KEY),'{bad');
 const unavailable={getItem(){throw Error('denied')},setItem(){throw Error('denied')}};assert.equal(readLibrary(unavailable).writeBlocked,true);assert.equal(saveLibrary(unavailable,fixture()).ok,false);
});

test('existing library survives save, reload, actual export/import snapshot, and legacy migration',async()=>{
 const lib=await get('library.js');const source=new MemoryStorage({[lib.LIBRARY_KEY]:JSON.stringify(fixture()),'opening-notebook-marks-v1':JSON.stringify(marks())});const loaded=lib.readLibrary(source);const expected=fixture();expected[1].openingVariations=[{moves:['e4','e5','Nf3','Nc6']}];assert.equal(lib.saveOpeningVariation(loaded.folders[1],['e4','e5','Nf3','Nc6']).changed,true);assert.equal(lib.saveLibrary(source,loaded.folders).ok,true);assert.deepEqual(lib.readLibrary(source).folders,expected);assert.deepEqual(JSON.parse(source.getItem('opening-notebook-marks-v1')),marks());
 const code=fs.readFileSync(path.join(root,'app.js'),'utf8');const section=code.slice(code.indexOf('function snapshot(){'),code.indexOf('function confirmAction(',code.indexOf('function snapshot(){')));const validMarks=code.split('\n').find(line=>line.startsWith('function validMarkings('));
 const sourceContext={folders:loaded.folders,annotations:marks(),validStoredLibrary:lib.validStoredLibrary};vm.createContext(sourceContext);vm.runInContext(validMarks+'\n'+section.split('function applySnapshot')[0],sourceContext);const exported=JSON.parse(JSON.stringify(sourceContext.snapshot()));assert.equal(sourceContext.validSnapshot(exported),true);assert.deepEqual(exported,{version:1,folders:expected,annotations:marks()});
 const destination=new MemoryStorage({[lib.LIBRARY_KEY]:JSON.stringify(fixture()),'opening-notebook-marks-v1':JSON.stringify(marks())});lib.readLibrary(destination);const nodes={};const ctx={folders:fixture(),annotations:marks(),storage:destination,storageBlocked:false,marksBlocked:false,originalMarksRaw:JSON.stringify(marks()),validStoredLibrary:lib.validStoredLibrary,checkLibraryCurrent:lib.checkLibraryCurrent,checkMarkingsCurrent:()=>({ok:true}),saveCheckpoint:()=>true,migrateLibrary:lib.migrateLibrary,restoreLibrary:lib.restoreLibrary,saveLibrary:lib.saveLibrary,migrateGameMarkings:()=>{},setStored:(key,value)=>{destination.setItem(key,value);return true},$:selector=>nodes[selector]??=( {} ),syncController:{start(){}},setPosition:()=>{},updateMatch:()=>{},render:()=>{},currentFolder:()=>null,showStorageFailure:()=>{}};vm.createContext(ctx);vm.runInContext(validMarks+'\n'+section,ctx);ctx.applySnapshot(exported);assert.deepEqual(lib.readLibrary(destination).folders,expected);assert.deepEqual(JSON.parse(destination.getItem('opening-notebook-marks-v1')),marks());
 const oldRaw=JSON.stringify(expected), legacy=new MemoryStorage({[lib.LEGACY_LIBRARY_KEY]:oldRaw});const migrated=lib.readLibrary(legacy);assert.equal(migrated.migrated,true);assert.equal(lib.saveLibrary(legacy,migrated.folders).ok,true);assert.equal(legacy.getItem(lib.LEGACY_LIBRARY_KEY),oldRaw);assert.deepEqual(lib.readLibrary(legacy).folders,expected);
});

test('actual save button rolls back on failed save and respects game and disabled states',async()=>{
 const {saveOpeningVariation}=await get('library.js');const handler=fs.readFileSync(path.join(root,'app.js'),'utf8').split('\n').find(line=>line.startsWith("$('#saveOpeningLine').onclick="));assert.ok(handler);const button={};let folder=fixture()[1], game=null, ok=true;let treeCount=0;const ctx={$:()=>button,currentFolder:()=>folder,currentGame:()=>game,engine:{moves:['e4','e5','Nf3','Nc6'],index:4},storageBlocked:false,structuredClone,saveOpeningVariation,save:()=>ok,showStorageFailure:()=>{},renderMoveExplorer:()=>{treeCount++},toast:()=>{}};vm.runInNewContext(handler,ctx);button.onclick();assert.deepEqual(folder.openingVariations,[{moves:['e4','e5','Nf3','Nc6']}]);ok=false;ctx.engine.moves=['e4','c5'];ctx.engine.index=2;const before=clone(folder);button.onclick();assert.deepEqual(folder,before);game={id:'g'};ok=true;button.onclick();assert.deepEqual(folder,before);assert.equal(treeCount,2);
});
