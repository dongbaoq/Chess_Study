// Run with: node --experimental-vm-modules --test tests/opening-auto-detection.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),modules=new Map();
async function load(relative){const filename=path.resolve(root,relative.split('?')[0]);if(!filename.startsWith(root+path.sep))throw Error('Outside project');if(!modules.has(filename))modules.set(filename,new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{identifier:filename}));const m=modules.get(filename);if(m.status==='unlinked')await m.link((spec,ref)=>load(path.relative(root,path.resolve(path.dirname(ref.identifier),spec.split('?')[0]))));return m}
async function get(relative){const m=await load(relative);if(m.status==='linked')await m.evaluate();return m.namespace}
const clone=value=>JSON.parse(JSON.stringify(value));
const fixture=()=>[
 {id:'ruy',name:'Ruy Lopez',side:'white',parentId:null,line:'1. e4 e5 2. Nf3 Nc6 3. Bb5',note:'Ruy ideas',blunders:[{id:'b',text:'Keep',moves:['e4'],future:42}],moveSymbols:{e4:'!'},games:[{id:'g',name:'Study game',pgn:'1. e4 c5 2. Nf3',notes:{e4:'keep'},gameNote:'whole',other:{retain:true}}],unknown:{keep:true}},
 {id:'sic',name:'Sicilian',side:'white',parentId:null,line:'1. e4 c5 2. Nf3',note:'Sic ideas',games:[]},
 {id:'sic-child',name:'Open Sicilian',side:'white',parentId:'sic',line:'1. e4 c5 2. Nf3 d6',note:'branch',games:[]},
 {id:'black',name:'Black Sicilian',side:'black',parentId:null,line:'1. e4 c5',games:[]}
];
async function harness(folders=fixture()){
 const lib=await get('library.js'),{ChessGame}=await get('chess.js'),matching=await get('opening-match.js');
 const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
 function section(a,b){const x=source.indexOf(a),y=source.indexOf(b,x);assert.ok(x>=0&&y>x,`${a} / ${b}`);return source.slice(x,y)}
 const box={folders,side:'white',folderId:'ruy',gameId:null,gameOwnerId:null,gameListScopeId:null,matched:null,selected:null,engine:new ChessGame(),...lib,...matching,
  currentFolder(){return box.folders.find(f=>f.id===box.folderId&&f.side===box.side)||null},
  currentGame(){return box.gameId?box.folders.find(f=>f.id===box.gameOwnerId)?.games.find(g=>g.id===box.gameId)||null:null},
  gameOwner(){return box.folders.find(f=>f.id===box.gameOwnerId)||null},
  originalGameMoves(){const g=box.currentGame();return g?lib.parseLine(g.pgn).moves:[]},
  startsWithMoves:(line,prefix)=>prefix.length<=line.length&&prefix.every((m,i)=>line[i]===m),
  saveAnalysisVariation(){throw Error('unexpected variation save')},save(){throw Error('unexpected storage write')},
  showStorageFailure(){throw Error('unexpected storage failure')},prepareMotion(){return []},renderBoard(){},renderContext(){},render(){},toast(){},modal(){throw Error('unexpected promotion')},
  setPosition(text,end=true){const engine=new ChessGame();assert.ok(engine.load(text));if(end)engine.go(engine.moves.length);box.engine=engine;return true}
 };
 vm.createContext(box);
 // Use the actual app functions, including any adjacent matching helpers.
 vm.runInContext(section('function selectFolder(', 'function renderTree()')+'\n'+section('function playMove(', 'function squareClick(')+'\n'+section('function go(', '// Copy only the moves'),box);
 return box;
}

test('real board moves identify a unique partially-entered Sicilian without jumping at shared e4',async()=>{
 const folders=fixture(),before=clone(folders),box=await harness(folders);
 box.setPosition('1. e4 e5 2. Nf3 Nc6 3. Bb5');box.go(0);
 assert.equal(box.folderId,'ruy');
 assert.equal(box.playMove('e2','e4',false),true);assert.equal(box.folderId,'ruy','shared e4 is not decisive');
 assert.equal(box.playMove('c7','c5',false),true);assert.equal(box.folderId,'sic','e4 c5 is a unique prefix of the saved Sicilian');
 assert.equal(box.playMove('g1','f3',false),true);assert.equal(box.folderId,'sic');
 assert.equal(box.playMove('d7','d6',false),true);assert.equal(box.folderId,'sic-child');
 box.go(1);assert.equal(box.folderId,'sic-child','rewinding to a shared prefix does not jump to another root');
 box.go(2);assert.ok(['sic','sic-child'].includes(box.folderId),'navigation stays within the correct opening family');
 assert.deepEqual(clone(folders),before,'detection never mutates saved library data');
});

test('an explicitly selected empty root stays selected while its new line is being entered',async()=>{
 const folders=fixture();folders.unshift({id:'empty',name:'New opening',side:'white',parentId:null,line:'',games:[],unknown:'retain'});
 folders.push({id:'e4',name:'Short e4',side:'white',parentId:null,line:'1. e4',games:[]});
 const box=await harness(folders);box.folderId='empty';assert.equal(box.playMove('e2','e4',false),true);assert.equal(box.folderId,'empty');
});

test('identical opening endpoints retain the chosen parent; deeper matching still works',async()=>{
 const folders=[{id:'parent',name:'Parent',side:'white',parentId:null,line:'1. e4',games:[]}, {id:'child',name:'Child',side:'white',parentId:'parent',line:'1. e4',games:[]}, {id:'deep',name:'Deep',side:'white',parentId:'child',line:'1. e4 e5',games:[]}];
 const box=await harness(folders);box.selectFolder('parent');assert.equal(box.folderId,'parent');assert.equal(box.playMove('e7','e5',false),true);assert.equal(box.folderId,'deep');
});

test('game mode retains global matching and does not rewrite saved game data',async()=>{
 const folders=fixture(),before=clone(folders),box=await harness(folders);box.gameId='g';box.gameOwnerId='ruy';box.setPosition('1. e4 c5 2. Nf3',false);box.go(3);assert.equal(box.folderId,'sic');assert.deepEqual(clone(folders),before);
});

test('an empty root with a saved continuation can be detected without rewriting the saved line',async()=>{
 const folders=fixture().filter(f=>!['sic','sic-child'].includes(f.id));
 folders.push({id:'sic-saved',name:'Sicilian',side:'white',parentId:null,line:'',openingVariations:[{moves:['e4','c5','Nf3'],unknown:'retain'}],games:[]});
 const before=clone(folders),box=await harness(folders);assert.equal(box.playMove('e2','e4',false),true);assert.equal(box.folderId,'ruy');assert.equal(box.playMove('c7','c5',false),true);assert.equal(box.folderId,'sic-saved');assert.deepEqual(clone(folders),before);
});

test('other repertoires and ambiguous prefixes do not claim an unrelated opening',async()=>{
 let folders=fixture().filter(f=>!['sic','sic-child'].includes(f.id));let box=await harness(folders);
 box.playMove('e2','e4',false);box.playMove('c7','c5',false);assert.equal(box.folderId,'ruy');assert.equal(box.matched.folder,null);
 folders=fixture();folders.push({id:'other-sic',name:'Other Sicilian',side:'white',parentId:null,line:'1. e4 c5 2. d4',games:[]});box=await harness(folders);
 box.playMove('e2','e4',false);box.playMove('c7','c5',false);assert.equal(box.folderId,'ruy');assert.equal(box.matched.folder,null);
 box.playMove('g1','f3',false);assert.equal(box.folderId,'sic');
});

test('a game detects a partial Sicilian path without changing its owner or list scope',async()=>{
 const folders=fixture(),before=clone(folders),box=await harness(folders);box.gameId='g';box.gameOwnerId='ruy';box.gameListScopeId='ruy';box.setPosition('1. e4 c5 2. Nf3',false);
 assert.equal(box.playMove('e2','e4',false),true);assert.equal(box.folderId,'ruy','shared e4 retains current selection');assert.equal(box.playMove('c7','c5',false),true);assert.equal(box.folderId,'sic');assert.equal(box.gameOwnerId,'ruy');assert.equal(box.gameListScopeId,'ruy');assert.deepEqual(clone(folders),before);
});
