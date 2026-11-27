// Run with: node --experimental-vm-modules --test tests/game-result.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const modules=new Map();
async function load(relative){
 const file=path.resolve(root,relative.split('?')[0]);
 if(!file.startsWith(root+path.sep))throw new Error('Module outside project');
 if(!modules.has(file))modules.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{identifier:file}));
 const mod=modules.get(file);
 if(mod.status==='unlinked')await mod.link((specifier,ref)=>load(path.relative(root,path.resolve(path.dirname(ref.identifier),specifier.split('?')[0]))));
 return mod;
}
async function get(relative){const mod=await load(relative);if(mod.status==='linked')await mod.evaluate();return mod.namespace;}

test('reads white wins, black wins, and draws from explicit PGN results',async()=>{
 const {parseGameResult}=await get('game-result.js');
 for(const [token,pgn] of [
  ['1-0','[Result "1-0"]\n1. e4 e5 2. Nf3 1-0'],
  ['0-1','[Result "0-1"]\n1. e4 e5 0-1'],
  ['1/2-1/2','[Result "1/2-1/2"]\n1. d4 d5 1/2-1/2'],
  ['1-0','1. e4 e5 1-0'],
  ['0-1','[Result "0-1"]\n1. d4 d5']
 ]) assert.equal(parseGameResult(pgn),token);
});

test('ignores annotations, headers other than Result, nested variations, and conflicts',async()=>{
 const {parseGameResult}=await get('game-result.js');
 assert.equal(parseGameResult('[Result "1-0"]\n1. e4 (1. d4 d5 (1... Nf6 0-1) 0-1) e5 1-0'),'1-0');
 for(const pgn of [
  '[Event "The 1-0 tournament"]\n1. e4 e5',
  '1. e4 { white thought 1-0 } e5',
  '1. e4 ; 0-1 was in a note\n e5',
  '1. e4 (1. d4 d5 0-1) e5',
  '[Result "*"]\n1. e4 e5 *',
  '1. e4 e5 *',
  '[Result "1-0"]\n1. e4 e5 0-1',
  '[Result "1-0"]\n1. e4 e5 *',
  '1. e4 e5 1-0 0-1',
  '',null
 ])assert.equal(parseGameResult(pgn),null,`${pgn}`);
});

test('end result appears only at the recorded game endpoint, not a prefix or analysis branch',async()=>{
 const {resultAtPosition}=await get('game-result.js');
 const game={pgn:'[Result "1-0"]\n1. e4 e5 2. Nf3 Nc6 1-0'};
 const played=['e4','e5','Nf3','Nc6'];
 assert.equal(resultAtPosition(game,played,4,played),'1-0');
 assert.equal(resultAtPosition(game,['e4','e5','Nf3','Nc6','Bb5'],4,played),'1-0');
 assert.equal(resultAtPosition(game,played,3,played),null);
 assert.equal(resultAtPosition(game,['e4','c5','Nf3','d6'],4,played),null);
 assert.equal(resultAtPosition(game,['e4','e5','Nf3','Nc6','Bb5'],5,played),null);
 assert.equal(resultAtPosition(game,played,0,played),null);
 assert.equal(resultAtPosition(null,played,4,played),null);
 assert.equal(resultAtPosition({pgn:'[Result "1-0"]'},[],0,[]),null);
 assert.equal(resultAtPosition({pgn:'1. e4 e5 *'},['e4','e5'],2,['e4','e5']),null);
});

test('result labels show both sides and follow board orientation',async()=>{
 const {resultLabel,getResultSides}=await get('game-result.js');
 assert.match(resultLabel('1-0'),/White.*won.*Black.*lost/i);
 assert.match(resultLabel('0-1'),/Black.*won.*White.*lost/i);
 assert.match(resultLabel('1/2-1/2'),/draw/i);
 const sides=result=>JSON.parse(JSON.stringify(result));
 assert.deepEqual(sides(getResultSides('1-0',false)),{top:'Black · Loss',bottom:'White · Win'});
 assert.deepEqual(sides(getResultSides('1-0',true)),{top:'White · Win',bottom:'Black · Loss'});
 assert.deepEqual(sides(getResultSides('0-1',false)),{top:'Black · Win',bottom:'White · Loss'});
 assert.deepEqual(sides(getResultSides('0-1',true)),{top:'White · Loss',bottom:'Black · Win'});
 assert.deepEqual(sides(getResultSides('1/2-1/2',false)),{top:'Black · Draw',bottom:'White · Draw'});
 assert.deepEqual(sides(getResultSides('1/2-1/2',true)),{top:'White · Draw',bottom:'Black · Draw'});
});

test('actual game list shows outcome only for games with explicit consistent results',async()=>{
 const {parseGameResult,resultLabel}=await get('game-result.js');
 const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
 const helper=source.split('\n').find(s=>s.startsWith('function gameResultHtml('));
 const start=source.indexOf('function openingGameEntries('),end=source.indexOf('function renderContext(',start);
 const renderer=source.slice(start,end);
 assert.ok(helper&&start>=0&&end>start);
 const elements=new Map();const $=key=>{if(!elements.has(key))elements.set(key,{});return elements.get(key)};
 const games=[{id:'w',name:'White victory',pgn:'1. e4 e5 1-0'},{id:'b',name:'Black victory',pgn:'1. d4 d5 0-1'},{id:'d',name:'Draw',pgn:'1. e4 e5 1/2-1/2'},{id:'x',name:'Incomplete',pgn:'1. e4 e5 *'}];
 const folder={id:'opening',side:'white',name:'Opening',games};const sandbox={$,parseGameResult,resultLabel,esc:s=>String(s),folders:[folder],side:'white',gameListScopeId:null,gameOwnerId:null,currentGame:()=>null,currentFolder:()=>folder,gameOwner:()=>folder,gameId:null,document:{querySelectorAll:()=>[]}};
 vm.runInNewContext(`${helper}\n${renderer}\nrenderGames();`,sandbox);
 const html=elements.get('#games').innerHTML;
 assert.match(html,/1-0 · White won · Black lost/);
 assert.match(html,/0-1 · Black won · White lost/);
 assert.match(html,/1\/2-1\/2 · Draw/);
 const incomplete=html.match(/<strong>Incomplete<\/strong>[\s\S]*?<\/button>/)[0];
 assert.doesNotMatch(incomplete,/game-result-label/);
});

test('actual board renderer shows results only at game end and follows the flip',async()=>{
 const {resultAtPosition,resultLabel,getResultSides}=await get('game-result.js');
 const source=fs.readFileSync(path.join(root,'app.js'),'utf8');const renderer=source.split('\n').find(s=>s.startsWith('function renderBoard('));assert.ok(renderer);
 const elements=new Map();const $=key=>{if(!elements.has(key))elements.set(key,{classList:{toggle(){}},querySelector(){return null}});return elements.get(key)};
 const played=['e4','e5'];const game={pgn:'1. e4 e5 1-0'};const engine={moves:played,index:2,board:Array.from({length:8},()=>Array(8).fill(null)),turn:'w',lastMove:{from:'e7',to:'e5'}};
 const sandbox={$,engine,selected:null,flipped:false,currentGame:()=>game,originalGameMoves:()=>played,cancelMotions(){},animateMotion(){},squareClick(){},marks:{refresh(){}},PIECES:{},document:{activeElement:null,querySelectorAll:()=>[]},resultAtPosition,resultLabel,getResultSides};
 vm.runInNewContext(renderer,sandbox);sandbox.renderBoard();
 assert.equal(elements.get('#boardResultTop').hidden,false);assert.equal(elements.get('#boardResultTop').textContent,'Black · Loss');assert.equal(elements.get('#boardResultBottom').textContent,'White · Win');
 sandbox.flipped=true;sandbox.renderBoard();assert.equal(elements.get('#boardResultTop').textContent,'White · Win');assert.equal(elements.get('#boardResultBottom').textContent,'Black · Loss');
 engine.index=1;sandbox.renderBoard();assert.equal(elements.get('#boardResultTop').hidden,true);assert.equal(elements.get('#boardResultBottom').hidden,true);
 engine.index=2;engine.moves=['e4','c5'];sandbox.renderBoard();assert.equal(elements.get('#boardResultTop').hidden,true);
});

test('actual played-game move list appends the recorded result without inventing one',async()=>{
 const {parseGameResult,resultLabel}=await get('game-result.js');
 const source=fs.readFileSync(path.join(root,'app.js'),'utf8');const renderer=source.split('\n').find(s=>s.startsWith('function renderMoveExplorer('));assert.ok(renderer);
 const children=[],list={appendChild(node){children.push(node)}};const elements=new Map();
 const $=key=>{if(!elements.has(key))elements.set(key,key==='#moveTree'?{querySelector:()=>list}:{});return elements.get(key)};
 let game={pgn:'1. e4 e5 0-1'};const engine={moves:['e4','e5'],index:1,lastMove:{from:'e2',to:'e4'}};
 const sandbox={$,engine,parseGameResult,resultLabel,currentGame:()=>game,originalGameMoves:()=>['e4','e5'],moveSymbolContext:()=>({symbols:{},owner:{},unknown:false}),renderBoardMoveSymbol(){},flipped:false,storageBlocked:false,buildMoveTree:()=>({}),folders:[],side:'white',folderId:'x',getAnalysisVariations:()=>[],moveView:{render(){children.length=0}},treeNodeFor:()=>null,startsWithMoves:(a,b)=>b.every((m,i)=>a[i]===m),document:{querySelectorAll:()=>[],createElement:()=>({})}};
 vm.runInNewContext(renderer,sandbox);sandbox.renderMoveExplorer();assert.equal(children.length,1);assert.equal(children[0].textContent,'0-1 · Black won · White lost');
 game={pgn:'1. e4 e5 *'};sandbox.renderMoveExplorer();assert.equal(children.length,0);
});
