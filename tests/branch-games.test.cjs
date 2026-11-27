// Run with node --experimental-vm-modules --test tests/branch-games.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const snippet=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start,`${a} / ${b}`);return source.slice(start,end)};
const fixture=()=>[
 {id:'root',side:'white',parentId:null,name:'Ruy López',line:'1. e4 e5',note:'keep opening',blunders:[{id:'x',moves:['e4'],text:'keep'}],extra:{future:true},games:[{id:'g0',name:'Root game',pgn:'1. e4 e5 1-0',gameNote:'keep',notes:{e4:'note'}}]},
 {id:'a',side:'white',parentId:'root',name:'Morphy',line:'1. e4 e5 2. Nf3',games:[{id:'g1',name:'Child game',pgn:'1. e4 e5 2. Nf3 0-1',gameNote:'child',notes:{e4:'important'}}]},
 {id:'deep',side:'white',parentId:'a',name:'Deep branch',line:'1. e4 e5 2. Nf3 Nc6',games:[{id:'g2',name:'Deep game',pgn:'1. e4 e5 2. Nf3 Nc6',unknown:'preserve'}]},
 {id:'b',side:'white',parentId:'root',name:'Other branch',line:'1. e4 e5 2. Bc4',games:[{id:'dup',name:'Sibling game',pgn:'1. e4 e5 2. Bc4'}]},
 {id:'other',side:'white',parentId:null,name:'Sicilian',line:'1. e4 c5',games:[{id:'g3',name:'Different opening',pgn:'1. e4 c5'}]},
 {id:'black',side:'black',parentId:'root',name:'Wrong side',line:'1. e4 c5',games:[{id:'g4',name:'Different repertoire',pgn:'1. e4 c5'}]},
];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=value=>JSON.parse(JSON.stringify(value));
const makeScope=()=>{
 const folders=fixture(),elements=new Map(),bindings={'[data-game]':[],'[data-move-game]':[],'[data-delete-game]':[]},calls=[];
 const $=key=>{if(!elements.has(key))elements.set(key,{});return elements.get(key)};
 const sandbox={folders,side:'white',folderId:'root',gameId:null,gameOwnerId:null,gameListScopeId:null,selected:null,engine:null,esc,$,
  currentFolder(){return sandbox.folders.find(x=>x.id===sandbox.folderId&&x.side===sandbox.side)||null},
  gameOwner(){return sandbox.folders.find(x=>x.id===sandbox.gameOwnerId&&x.side===sandbox.side)||null},
  currentGame(){return sandbox.gameOwner()?.games.find(g=>g.id===sandbox.gameId)||null},
  gameResultHtml:g=>g.pgn.endsWith('1-0')?'<small class="game-result-label">1-0 · White won · Black lost</small>':g.pgn.endsWith('0-1')?'<small class="game-result-label">0-1 · Black won · White lost</small>':'',
  document:{querySelectorAll(selector){return bindings[selector]||[]}},
  ChessGame:class{load(pgn){this.pgn=pgn;return !pgn.includes('INVALID')}},
  updateMatch(){sandbox.folderId='deep'},render(){calls.push(['render'])},toast(v){calls.push(['toast',v])},
  transferGame:(owner,id)=>calls.push(['move',owner,id]),removeGame:(owner,id)=>calls.push(['delete',owner,id])};
 vm.createContext(sandbox);
 vm.runInContext(snippet('function selectGame(', 'function updateMatch(')+snippet('function openingContainsFolder(', 'function renderContext('),sandbox);
 return {sandbox,elements,bindings,calls,folders};
};

test('includes games from all descendants, excludes other roots and repertoires, and leaves records unchanged',()=>{
 const {sandbox,folders}=makeScope(),before=JSON.stringify(folders);
 const entries=sandbox.openingGameEntries(folders,folders[0]);
 assert.deepEqual(norm(entries.map(({owner,game})=>[owner.id,game.id])),[['root','g0'],['a','g1'],['b','dup'],['deep','g2']]);
 assert.deepEqual(norm(sandbox.openingGameEntries(folders,folders[1]).map(({owner,game})=>[owner.id,game.id])),[['a','g1'],['deep','g2']]);
 assert.equal(JSON.stringify(folders),before);
 const cycle=[{id:'x',parentId:'y',side:'white',games:[{id:'xg'}]},{id:'y',parentId:'x',side:'white',games:[{id:'yg'}]}];
 assert.deepEqual(norm(sandbox.openingGameEntries(cycle,cycle[0]).map(e=>e.game.id)),['xg','yg']);
 assert.equal(sandbox.openingGameEntries([],null).length,0);
});

test('renders descendants with their folder, result, and unambiguous owner attributes',()=>{
 const {sandbox,elements}=makeScope();sandbox.renderGames();const html=elements.get('#games').innerHTML;
 for(const name of ['Root game','Child game','Deep game','Sibling game'])assert.match(html,new RegExp(name));
 assert.doesNotMatch(html,/Different opening|Different repertoire/);
 assert.match(html,/data-game="g2" data-game-owner="deep"/);
 assert.match(html,/data-move-game="g2" data-game-owner="deep"/);
 assert.match(html,/data-delete-game="g2" data-game-owner="deep"/);
 assert.match(html,/Child game[\s\S]*?Morphy[\s\S]*?0-1 · Black won · White lost/);
 assert.equal(elements.get('#gamesHeading').textContent,'Games in Ruy López');
});

test('open, move and delete controls pass the game’s actual folder and keep the parent scope while open',()=>{
 const {sandbox,elements,bindings,calls,folders}=makeScope();
 const open={dataset:{game:'g2',gameOwner:'deep'}},move={dataset:{moveGame:'g2',gameOwner:'deep'}},del={dataset:{deleteGame:'g2',gameOwner:'deep'}};
 bindings['[data-game]']=[open];bindings['[data-move-game]']=[move];bindings['[data-delete-game]']=[del];
 const before=JSON.stringify(folders);sandbox.renderGames();open.onclick();
 assert.equal(sandbox.gameId,'g2');assert.equal(sandbox.gameOwnerId,'deep');assert.equal(sandbox.gameListScopeId,'root');assert.equal(sandbox.engine.pgn,'1. e4 e5 2. Nf3 Nc6');
 assert.equal(sandbox.folderId,'deep'); // match can update board context without shrinking the game list
 sandbox.renderGames();assert.equal(elements.get('#gamesHeading').textContent,'Games in Ruy López');assert.match(elements.get('#games').innerHTML,/Sibling game/);
 move.onclick();del.onclick();assert.deepEqual(calls.filter(x=>x[0]==='move'||x[0]==='delete'),[['move','deep','g2'],['delete','deep','g2']]);assert.equal(JSON.stringify(folders),before);
});

test('duplicate game IDs mark only the actual owner row active and deletion is paused to protect shared annotations',()=>{
 const {sandbox,elements,folders}=makeScope();
 folders[1].games.push({id:'dup',name:'Duplicate child game',pgn:'1. e4 e5',notes:{x:'keep'}});
 const before=JSON.stringify(folders),markers={'game:dup:position':{squares:{e4:'green'},arrows:[]}};
 sandbox.gameListScopeId='root';sandbox.gameOwnerId='a';sandbox.gameId='dup';sandbox.renderGames();const html=elements.get('#games').innerHTML;
 assert.equal((html.match(/class="game-entry active"/g)||[]).length,1);
 assert.match(html,/class="game-entry active"><button[^>]*data-game="dup" data-game-owner="a"/);
 assert.match(html,/class="game-entry "><button[^>]*data-game="dup" data-game-owner="b"/);
 let message='',confirmations=0;
 const remove=source.split('\n').find(line=>line.startsWith('function removeGame('));assert.ok(remove);
 const ctx={folders,annotations:markers,toast:v=>{message=v},confirmAction:()=>{confirmations++}};
 vm.createContext(ctx);vm.runInContext(remove,ctx);ctx.removeGame('b','dup');
 assert.match(message,/shares an ID|protect/i);assert.equal(confirmations,0);assert.equal(JSON.stringify(folders),before);
 assert.deepEqual(markers,{'game:dup:position':{squares:{e4:'green'},arrows:[]}});
});

test('selecting a parent with an identical child line keeps the parent game list, while longer lines still match descendants',async()=>{
 const base=path.join(__dirname,'..'),cache=new Map();
 async function load(relative){const file=path.resolve(base,relative.split('?')[0]);if(!file.startsWith(base+path.sep))throw Error('Outside project');if(!cache.has(file))cache.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{identifier:file}));const mod=cache.get(file);if(mod.status==='unlinked')await mod.link((spec,ref)=>load(path.relative(base,path.resolve(path.dirname(ref.identifier),spec.split('?')[0]))));return mod}
 async function get(relative){const mod=await load(relative);if(mod.status==='linked')await mod.evaluate();return mod.namespace}
 const {folderPath,parseLine}=await get('library.js'),{matchOpening}=await get('opening-match.js');
 const folders=fixture();folders[1].line=folders[0].line;folders[2].line='1. e4 e5 2. Nf3';
 const elems=new Map(),$=key=>{if(!elems.has(key))elems.set(key,{});return elems.get(key)};
 const sandbox={folders,side:'white',folderId:'deep',gameId:null,gameOwnerId:null,gameListScopeId:null,matched:null,engine:{moves:[],index:0},folderPath,parseLine,matchOpening,esc,$,
  currentFolder(){return folders.find(f=>f.id===sandbox.folderId&&f.side===sandbox.side)||null},currentGame(){return null},gameOwner(){return null},
  setPosition(text){const parsed=parseLine(text);assert.equal(parsed.ok,true);sandbox.engine={moves:parsed.moves,index:parsed.moves.length}},render(){},gameResultHtml:()=>'',document:{querySelectorAll:()=>[]}};
 vm.createContext(sandbox);
 vm.runInContext(snippet('function selectFolder(', 'function renderTree()')+snippet('function openingGameEntries(', 'function renderContext('),sandbox);
 sandbox.selectFolder('root');assert.equal(sandbox.folderId,'root');sandbox.renderGames();
 assert.equal(elems.get('#gamesHeading').textContent,'Games in Ruy López');assert.match(elems.get('#games').innerHTML,/Root game/);assert.match(elems.get('#games').innerHTML,/Deep game/);
 const longer=parseLine('1. e4 e5 2. Nf3');sandbox.engine={moves:longer.moves,index:longer.moves.length};sandbox.updateMatch();assert.equal(sandbox.folderId,'deep');
 sandbox.selectFolder('root');assert.equal(sandbox.folderId,'root');sandbox.renderGames();assert.match(elems.get('#games').innerHTML,/Root game/);
});

test('opening a game retains a containing scope and switches scope when its owner is outside it, including the other repertoire',()=>{
 const {sandbox,elements}=makeScope();
 sandbox.selectGame('g2','deep');assert.equal(sandbox.gameListScopeId,'root');sandbox.renderGames();assert.match(elements.get('#games').innerHTML,/Sibling game/);
 sandbox.selectGame('g3','other');assert.equal(sandbox.gameListScopeId,'other');sandbox.renderGames();assert.equal(elements.get('#gamesHeading').textContent,'Games in Sicilian');assert.match(elements.get('#games').innerHTML,/class="game-entry active"[^]*Different opening/);
 sandbox.side='black';sandbox.folderId='black';sandbox.selectGame('g4','black');assert.equal(sandbox.gameListScopeId,'black');sandbox.renderGames();assert.equal(elements.get('#gamesHeading').textContent,'Games in Wrong side');assert.match(elements.get('#games').innerHTML,/class="game-entry active"[^]*Different repertoire/);
});

test('moving an open game keeps its scope only while the destination is within it, including cross-repertoire moves',()=>{
 const {sandbox,elements,folders}=makeScope();let dialog;const annotations={'game:g1:position':{squares:{d4:'red'},arrows:[{from:'e2',to:'e4',color:'green'}]}};
 sandbox.annotations=annotations;sandbox.flipped=false;sandbox.folderOptions=()=>'';sandbox.modal=(title,body,submit)=>{dialog={title,submit}};sandbox.$=key=>{if(!elements.has(key))elements.set(key,key==='#modal'?{close(){}}:{});return elements.get(key)};
 sandbox.captureLibraryState=()=>({});sandbox.restoreLibraryState=()=>{throw Error('unexpected rollback')};sandbox.persistActions=()=>true;sandbox.updateMatch=()=>{};sandbox.setPosition=()=>{};
 sandbox.moveGame=(list,owner,id,dest)=>{const from=list.find(f=>f.id===owner),to=list.find(f=>f.id===dest),i=from.games.findIndex(g=>g.id===id),game=from.games.splice(i,1)[0];to.games.push(game);return {ok:true,from,to,game}};
 vm.runInContext(snippet('function transferGame(', 'function addGame('),sandbox);
 sandbox.gameId='g1';sandbox.gameOwnerId='a';sandbox.gameListScopeId='root';sandbox.folderId='a';const original=JSON.stringify(folders[1].games[0]),marks=JSON.stringify(annotations);
 for(const [from,dest,expectedScope,expectedSide] of [['a','deep','root','white'],['deep','other','other','white'],['other','black','black','black']]){
  sandbox.transferGame(from,'g1');assert.equal(dialog.title,'Move game');dialog.submit({get:()=>dest});
  assert.equal(sandbox.gameOwnerId,dest);assert.equal(sandbox.gameListScopeId,expectedScope);assert.equal(sandbox.side,expectedSide);assert.equal(JSON.stringify(folders.find(f=>f.id===dest).games.find(g=>g.id==='g1')),original);
  sandbox.renderGames();assert.match(elements.get('#games').innerHTML,/class="game-entry active"[^]*Child game/);assert.equal(JSON.stringify(annotations),marks);
 }
});

test('adding a game in or outside the current scope keeps it visible, even if assigned to another repertoire',()=>{
 const {sandbox,elements,folders}=makeScope();let dialog,id=0;
 sandbox.$=key=>{if(!elements.has(key))elements.set(key,key==='#modal'?{close(){}}:{});return elements.get(key)};sandbox.modal=(title,body,submit)=>{dialog={title,submit}};
 sandbox.crypto={randomUUID:()=>`new${++id}`};sandbox.matchGameFolder=()=>({ok:true,folder:null});sandbox.folderOptions=()=>'';sandbox.save=()=>true;sandbox.updateMatch=()=>{};sandbox.flipped=false;
 vm.runInContext(snippet('function addGame(', "$('#moveSymbolControl').onclick="),sandbox);
 sandbox.gameId='g1';sandbox.gameOwnerId='a';sandbox.gameListScopeId='root';sandbox.folderId='a';
 for(const [dest,expectedScope,expectedSide] of [['deep','root','white'],['other','other','white'],['black','black','black']]){
  sandbox.addGame();assert.equal(dialog.title,'Paste a game');dialog.submit({get:key=>key==='pgn'?'1. e4 e5':`Added ${dest}`});
  assert.equal(dialog.title,'Choose a game folder');dialog.submit({get:()=>dest});
  assert.equal(sandbox.gameOwnerId,dest);assert.equal(sandbox.gameListScopeId,expectedScope);assert.equal(sandbox.side,expectedSide);
  sandbox.renderGames();assert.match(elements.get('#games').innerHTML,new RegExp(`class="game-entry active"[^]*Added ${dest}`));assert.ok(folders.find(f=>f.id===dest).games.some(g=>g.name===`Added ${dest}`));
 }
});
