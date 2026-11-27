// Run with: node --experimental-vm-modules --test tests/move-tree-icons.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const rootPath = path.resolve(__dirname, '..');
const document = {addEventListener(){}, removeEventListener(){}};
const context = vm.createContext({document});
const cache = new Map();
async function load(relative) {
  const file = path.resolve(rootPath, relative.split('?')[0]);
  if (!file.startsWith(rootPath + path.sep)) throw new Error('Module outside project');
  if (!cache.has(file)) cache.set(file, new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{identifier:file, context}));
  const module = cache.get(file);
  if (module.status === 'unlinked') await module.link((specifier, ref) => load(path.relative(rootPath, path.resolve(path.dirname(ref.identifier), specifier.split('?')[0]))));
  return module;
}
async function get(relative) {const module=await load(relative);if(module.status==='linked')await module.evaluate();return module.namespace;}
function container() {return {innerHTML:'',addEventListener(){},removeEventListener(){},querySelectorAll(){return []},querySelector(){return null}};}
function move(san, symbol, warnings=[]) {return {san,ply:1,moves:[san],children:[],folders:[],blunders:warnings,moveSymbol:symbol,onLine:false,onGameLine:false};}
function root(children, blunders=[]) {return {san:null,ply:0,moves:[],children,folders:[],blunders,gameMode:false};}
function buttonFor(html, label) {const match=html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?<\\/button>`));assert.ok(match,`Missing button: ${label}`);return match[0];}

test('move list renders the matching icon and spoken label for every saved mark',async()=>{
 const {createMoveTreeView}=await get('move-tree-view.js');const {BOARD_SYMBOL_ICONS}=await get('move-symbols.js');const viewContainer=container();const view=createMoveTreeView({container:viewContainer});
 view.render(root([move('e4','!'),move('d4','!!'),move('c4','?'),move('Nf3','??')]));
 for(const [san,symbol,label,kind] of [['e4','!','Only move','only'],['d4','!!','Brilliant move','brilliant'],['c4','?','Mistake','question'],['Nf3','??','Blunder','blunder']]) {
  const button=buttonFor(viewContainer.innerHTML,`1\\. ${san}, ${label}`);
  assert.ok(button.includes(`<span class="move-tree-symbol symbol-${kind}" aria-hidden="true">${BOARD_SYMBOL_ICONS[symbol]}</span>`));
 }
 view.destroy();assert.equal(viewContainer.innerHTML,'');
});

test('legacy blunder warnings render an icon, a spoken label, and no duplicate when already marked',async()=>{
 const {createMoveTreeView}=await get('move-tree-view.js');const {BOARD_SYMBOL_ICONS}=await get('move-symbols.js');const viewContainer=container();const view=createMoveTreeView({container:viewContainer});
 const warning={folderName:'Opening',text:'Watch the pawn'};
 view.render(root([move('e4',null,[warning]),move('d4','??',[warning])],[warning]));
 const legacy=buttonFor(viewContainer.innerHTML,'1\\. e4, marked blunder: Opening: Watch the pawn');
 assert.ok(legacy.includes(`<span class="move-tree-blunder" aria-hidden="true">${BOARD_SYMBOL_ICONS['??']}</span>`));
 const alreadyMarked=buttonFor(viewContainer.innerHTML,'1\\. d4, Blunder, marked blunder: Opening: Watch the pawn');
 assert.ok(alreadyMarked.includes(`<span class="move-tree-symbol symbol-blunder" aria-hidden="true">${BOARD_SYMBOL_ICONS['??']}</span>`));
 assert.ok(!alreadyMarked.includes('class="move-tree-blunder"'));
 const start=buttonFor(viewContainer.innerHTML,'Starting position, marked blunder: Opening: Watch the pawn');
 assert.ok(start.includes(`<span class="move-tree-blunder" aria-hidden="true">${BOARD_SYMBOL_ICONS['??']}</span>`));
 view.destroy();
});
