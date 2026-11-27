// Run with: node --experimental-vm-modules --test tests/top-level-openings.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'), modules=new Map();
async function load(relative){const filename=path.resolve(root,relative.split('?')[0]);if(!filename.startsWith(root+path.sep))throw Error('Outside project');if(!modules.has(filename))modules.set(filename,new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{identifier:filename}));const m=modules.get(filename);if(m.status==='unlinked')await m.link((spec,ref)=>load(path.relative(root,path.resolve(path.dirname(ref.identifier),spec.split('?')[0]))));return m}
async function get(relative){const m=await load(relative);if(m.status==='linked')await m.evaluate();return m.namespace}
class Store{constructor(values={}){this.map=new Map(Object.entries(values));this.deny=false}getItem(k){return this.map.has(k)?this.map.get(k):null}setItem(k,v){if(this.deny&&k==='opening-notebook-v2')throw Error('denied');this.map.set(k,String(v))}removeItem(k){this.map.delete(k)}}
const clone=value=>JSON.parse(JSON.stringify(value));
const fixture=()=>[
 {id:'ruy',name:'Ruy López',side:'white',parentId:null,line:'1. e4 e5 2. Nf3 Nc6 3. Bb5',note:'Spanish ideas',blunders:[{id:'b',moves:['e4'],text:'Watch e4',extra:'keep'}],moveSymbols:{e4:'!'},openingVariations:[{moves:['e4','c5'],extra:'keep'}],unknown:{keep:true},games:[{id:'g',name:'Played game',pgn:'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6',gameNote:'Whole game',notes:{'e4 e5':'Position note'},moveSymbols:{'e4 e5':'??'},extra:'keep'}]},
 {id:'child',name:'Same position',side:'white',parentId:'ruy',line:'1. e4 e5 2. Nf3 Nc6 3. Bb5',note:'Child note',games:[],future:'preserve'},
 {id:'black',name:'Black repertoire',side:'black',parentId:null,line:'1. d4 d5',note:'Black note',games:[]}
];
const markings=()=>({'game:g:position':{squares:{d4:'red'},arrows:[{from:'e2',to:'e4',color:'green',extra:'keep'}],extra:'retain'}});
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
function between(a,b){const x=source.indexOf(a),y=source.indexOf(b,x);assert.ok(x>=0&&y>x,`${a} / ${b}`);return source.slice(x,y)}
async function harness(){
 const lib=await get('library.js'),{ChessGame}=await get('chess.js'),{matchOpening}=await get('opening-match.js');
 const initial=fixture(),storedMarks=JSON.stringify(markings()),storage=new Store({[lib.LIBRARY_KEY]:JSON.stringify(initial),'opening-notebook-marks-v1':storedMarks});
 const loaded=lib.readLibrary(storage);let dialog, selected=0, rendered=0, notice='', closed=0, id=0;
 const box={folders:loaded.folders,side:'white',folderId:'ruy',gameId:null,gameOwnerId:null,matched:null,engine:new ChessGame(),storageBlocked:false,storage,
  ...lib,matchOpening,crypto:{randomUUID:()=>`new-${++id}`},esc:s=>String(s??''),
  currentFolder(){return box.folders.find(f=>f.id===box.folderId&&f.side===box.side)||null},currentGame(){return null},gameOwner(){return null},
  setPosition(text,end=true){const next=new ChessGame();if(!next.load(text||''))return false;if(end)next.go(next.moves.length);box.engine=next;return true},
  render(){rendered++},save(){return lib.saveLibrary(storage,box.folders).ok},toast(msg){notice=msg},
  modal(title,body,submit){dialog={title,body,submit}},$(){return {close(){closed++}}},
  showStorageFailure(){},structuredClone
 };
 vm.createContext(box);
 vm.runInContext(between('function selectFolder(', 'function renderTree()')+'\n'+between('function addFolder(', 'function editFolder('),box);
 box.setPosition(initial[0].line);
 return {box,storage,initial,storedMarks,get dialog(){return dialog},get notice(){return notice},get closed(){return closed},get rendered(){return rendered}, submit(name,line){assert.ok(dialog);dialog.submit({get:key=>key==='name'?name:line})}};
}

function backupHarness(storage,folders,lib){
 const nodes=new Map();let captured=null;
 const $=key=>{if(!nodes.has(key))nodes.set(key,{});return nodes.get(key)};
 const ctx={storage,folders,annotations:JSON.parse(storage.getItem('opening-notebook-marks-v1')||'{}'),storageBlocked:false,marksBlocked:false,originalRaw:null,originalMarksRaw:storage.getItem('opening-notebook-marks-v1'),storageFailure:null,hasUserData:true,side:'white',flipped:false,folderId:folders[0]?.id||null,gameId:null,gameOwnerId:null,...lib,$,Blob,
  URL:{createObjectURL(blob){captured=blob;return 'blob:test'},revokeObjectURL(){}},document:{createElement(){return{click(){}}}},setTimeout(){},toast(){},showStorageFailure(){},migrateGameMarkings(){},setPosition(){},updateMatch(){},render(){},syncController:{start(){}},currentFolder(){return null},confirmAction(_title,_description,_label,action){action()},setStored(key,value){try{storage.setItem(key,value);return true}catch{return false}}};
 vm.createContext(ctx);
 const valid=source.split('\n').find(line=>line.startsWith('function validMarkings(')),checkpoint=source.split('\n').find(line=>line.startsWith('function saveCheckpoint('));
 const exports=source.split('\n').find(line=>line.startsWith("$('#exportData').onclick=")),imports=source.split('\n').find(line=>line.startsWith("$('#importFile').onchange="));
 assert.ok(valid&&checkpoint&&exports&&imports);
 vm.runInContext([valid,checkpoint,between('function checkMarkingsCurrent(){','function writeMarkings('),between('function snapshot(){','function confirmAction('),exports,imports].join('\n'),ctx);
 return {nodes,exported:()=>captured};
}

test('creates Sicilian as an independent root, preserving a nested Ruy library across reload and backups',async()=>{
 const h=await harness(),{box,storage}=h,lib=await get('library.js');
 box.addFolder();assert.match(h.dialog.title,/opening/i);h.submit('Sicilian Defense','1. e4 c5');
 const created=box.folders.find(f=>f.name==='Sicilian Defense');assert.ok(created);assert.equal(created.parentId,null);assert.equal(created.side,'white');assert.equal(created.line,'1. e4 c5');assert.equal(box.folderId,created.id);
 assert.deepEqual(clone(box.folders.slice(0,3)),h.initial);assert.equal(storage.getItem('opening-notebook-marks-v1'),h.storedMarks);
 box.setPosition(h.initial[0].line);box.updateMatch();assert.equal(box.folderId,created.id,'a matching different root must not steal the explicitly selected opening');
 const reloaded=lib.readLibrary(storage);assert.deepEqual(clone(reloaded.folders),clone(box.folders));
 const exporter=backupHarness(storage,reloaded.folders,lib);exporter.nodes.get('#exportData').onclick();const backup=JSON.parse(await exporter.exported().text());assert.deepEqual(backup,{version:1,folders:clone(box.folders),annotations:markings()});
 const target=new Store({[lib.LIBRARY_KEY]:JSON.stringify(fixture()),'opening-notebook-marks-v1':JSON.stringify(markings())});const targetFolders=lib.readLibrary(target).folders;const importer=backupHarness(target,targetFolders,lib);await importer.nodes.get('#importFile').onchange({target:{files:[{text:async()=>JSON.stringify(backup)}],value:'chosen'}});assert.deepEqual(clone(lib.readLibrary(target).folders),clone(box.folders));assert.deepEqual(JSON.parse(target.getItem('opening-notebook-marks-v1')),markings());
 const raw=JSON.stringify(backup.folders),legacy=new Store({[lib.LEGACY_LIBRARY_KEY]:raw});const migrated=lib.readLibrary(legacy);assert.equal(migrated.migrated,true);assert.equal(lib.saveLibrary(legacy,migrated.folders).ok,true);assert.equal(legacy.getItem(lib.LEGACY_LIBRARY_KEY),raw);assert.deepEqual(clone(lib.readLibrary(legacy).folders),clone(box.folders));
});

test('selecting a newly created root with the same moves stays in that opening',async()=>{
 const h=await harness(),{box}=h;box.addFolder();h.submit('Another opening','1. e4 e5 2. Nf3 Nc6 3. Bb5');
 const created=box.folders.find(f=>f.name==='Another opening');assert.ok(created);assert.equal(box.folderId,created.id);
});

test('creates a genuine subfolder from its parent and preserves the parent records',async()=>{
 const h=await harness(),{box}=h;box.addFolder('ruy');assert.match(h.dialog.title,/subfolder/i);h.submit('Morphy Defense','a6');
 const child=box.folders.find(f=>f.name==='Morphy Defense');assert.ok(child);assert.equal(child.parentId,'ruy');assert.equal(child.line,'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6');assert.deepEqual(clone(box.folders.slice(0,3)),h.initial);
});

test('failed persistence keeps the original folder list, selection, and stored library',async()=>{
 const h=await harness(),{box,storage}=h,before=storage.getItem('opening-notebook-v2');storage.deny=true;box.addFolder();h.submit('Sicilian Defense','1. e4 c5');
 assert.deepEqual(clone(box.folders),h.initial);assert.equal(box.folderId,'ruy');assert.equal(storage.getItem('opening-notebook-v2'),before);assert.equal(storage.getItem('opening-notebook-marks-v1'),h.storedMarks);assert.equal(h.closed,0);
});


test('invalid new line does not create a folder or alter stored data',async()=>{
 const h=await harness(),{box,storage}=h,before=storage.getItem('opening-notebook-v2');box.addFolder();h.submit('Sicilian Defense','1. e4 e5 2. c5');
 assert.deepEqual(clone(box.folders),h.initial);assert.equal(box.folderId,'ruy');assert.equal(storage.getItem('opening-notebook-v2'),before);assert.equal(h.closed,0);
});

test('independent roots are created in the selected repertoire',async()=>{
 const h=await harness(),{box}=h;box.side='black';box.folderId='black';box.setPosition('1. d4 d5');box.addFolder();h.submit('Sicilian Defense','1. e4 c5');
 const created=box.folders.find(f=>f.name==='Sicilian Defense');assert.equal(created.side,'black');assert.equal(created.parentId,null);assert.equal(box.folderId,created.id);assert.deepEqual(clone(box.folders.slice(0,3)),h.initial);
});
