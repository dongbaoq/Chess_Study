// Run with: node --experimental-vm-modules --test tests/branch-board-hints.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const interfaceCss=fs.readFileSync(path.join(root,'interface.css'),'utf8');
const start=source.indexOf('let branchHintSvg=null;');
const end=source.indexOf('\nfunction moveSymbolContext()',start);
assert.ok(start>=0&&end>start,'branch hint renderer should exist');
const renderer=source.slice(start,end);
const cache=new Map();

async function load(relative){
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep))throw new Error('Module outside project');
 if(!cache.has(file))cache.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{identifier:file}));
 const module=cache.get(file);
 if(module.status==='unlinked'){
  await module.link((specifier,ref)=>{
   const filename=path.resolve(path.dirname(ref.identifier),specifier.split('?')[0]);
   return load(path.relative(root,filename));
  });
 }
 return module;
}

async function get(relative){const module=await load(relative);if(module.status==='linked')await module.evaluate();return module.namespace}

function makeRenderer(engine){
 const svg={attributes:{},style:{},innerHTML:'',setAttribute(key,value){this.attributes[key]=value}};
 const board={parentElement:{children:[],appendChild(node){this.children.push(node)}}};
 const context=vm.createContext({engine,flipped:false,document:{createElementNS(namespace,name){assert.equal(namespace,'http://www.w3.org/2000/svg');assert.equal(name,'svg');return svg}},$:()=>board});
 vm.runInContext(renderer,context);
 return {svg,context,board,render:node=>context.renderBranchHints(node)};
}

test('game analysis branches display arrows for every available next move',async()=>{
 const {buildMoveTree}=await get('move-tree.js');
 const {ChessGame}=await get('chess.js');
 const game=new ChessGame();assert.equal(game.load('1. e4 e5 2. Nf3'),true);game.go(1);
 const tree=buildMoveTree({gameMode:true,gameMoves:['e4','e5','Nf3'],variations:[['e4','c5']],moves:game.moves,index:game.index});
 const current=tree.children.find(node=>node.san==='e4');
 const view=makeRenderer(game);view.render(current);
 assert.match(view.svg.innerHTML,/data-branch-from="e7" data-branch-to="e5"/);
 assert.match(view.svg.innerHTML,/data-branch-from="c7" data-branch-to="c5"/);
 const paths=[...view.svg.innerHTML.matchAll(/<path\b[^>]*d="([^"]+)"/g)];
 assert.equal(paths.length,2);
 for(const [,d] of paths){
  assert.match(d,/^M [-\d.]+ [-\d.]+(?: L [-\d.]+ [-\d.]+){6} Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ Z$/);
  assert.doesNotMatch(d,/NaN|Infinity/);
 }
 assert.match(interfaceCss,/\.branch-hints path\{fill:#73777b\}/);
});

test('repertoire branches display arrows, follow board flip, and clear at non-branch positions',async()=>{
 const {buildMoveTree}=await get('move-tree.js');
 const {ChessGame}=await get('chess.js');
 const folders=[
  {id:'root',side:'white',parentId:null,line:'1. e4 e5'},
  {id:'sicilian',side:'white',parentId:'root',line:'1. e4 c5'}
 ];
 const tree=buildMoveTree({folders,side:'white',folderId:'root',moves:['e4'],index:1});
 const current=tree.children.find(node=>node.san==='e4');
 const game=new ChessGame();game.load('1. e4');game.go(1);
 const view=makeRenderer(game);view.render(current);
 const normal=view.svg.innerHTML;
 assert.match(normal,/data-branch-from="e7" data-branch-to="e5"/);
 assert.match(normal,/data-branch-from="c7" data-branch-to="c5"/);
 view.context.flipped=true;view.render(current);
 assert.notEqual(view.svg.innerHTML,normal,'arrow coordinates should follow the flipped board');
 view.render({children:[{san:'e5'}]});
 assert.equal(view.svg.innerHTML,'','a single continuation is not marked as a branch');
 assert.equal(view.board.parentElement.children.length,1,'the overlay is reused');
});
