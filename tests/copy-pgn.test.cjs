// Run with: node --experimental-vm-modules --test tests/copy-pgn.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const modules=new Map();
async function load(relative){
  const filename=path.resolve(root,relative);
  if(!filename.startsWith(root+path.sep))throw new Error('Module outside project');
  if(!modules.has(filename))modules.set(filename,new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{identifier:filename}));
  const module=modules.get(filename);
  if(module.status==='unlinked')await module.link((specifier,referencing)=>load(path.relative(root,path.resolve(path.dirname(referencing.identifier),specifier))));
  return module;
}
async function library(){const module=await load('library.js');if(module.status==='linked')await module.evaluate();return module.namespace;}
function harness(engine,formatLine,{clipboard,copyResult=true,execThrows=false}={}){
  const messages=[],written=[];let currentInput=null,removed=0,focusRestored=0;
  const button={};
  const document={
    activeElement:{focus(){focusRestored++}},
    body:{appendChild(input){currentInput=input}},
    createElement(tag){assert.equal(tag,'textarea');return {value:'',style:{},focus(){},select(){},remove(){removed++;currentInput=null}}},
    execCommand(command){assert.equal(command,'copy');if(execThrows)throw new Error('not supported');if(copyResult)written.push(currentInput.value);return copyResult}
  };
  const sandbox={engine,formatLine,document,navigator:clipboard?{clipboard}:{},toast:message=>messages.push(message),$:selector=>{assert.equal(selector,'#copyPgn');return button}};
  vm.createContext(sandbox);
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const start=source.indexOf('async function copyTextToClipboard(text){');
  const marker="$('#copyPgn').onclick=copyCurrentPgn;";const end=source.indexOf(marker,start);
  assert.ok(start>=0 && end>start,'copy helpers and binding exist');
  vm.runInContext(source.slice(start,end+marker.length),sandbox);
  return {button,messages,written,get removed(){return removed},get focusRestored(){return focusRestored}};
}

test('copy PGN includes only the currently displayed path and no future or sibling moves',async()=>{
  const {parseLine,formatLine}=await library();
  const parsed=parseLine('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6');assert.equal(parsed.ok,true);
  const engine=parsed.game,written=[];
  const ui=harness(engine,formatLine,{clipboard:{writeText:async text=>written.push(text)}});
  await ui.button.onclick();assert.equal(written.length,0);assert.match(ui.messages.at(-1),/move first/i);
  engine.go(3);await ui.button.onclick();assert.equal(written.at(-1),'1. e4 e5 2. Nf3 *');
  assert.deepEqual(parseLine(written.at(-1)).moves,['e4','e5','Nf3']);
  engine.go(1);assert.equal(engine.move('c5'),true);assert.equal(engine.move('Nf3'),true);assert.equal(engine.move('d6'),true);
  engine.go(3);await ui.button.onclick();assert.equal(written.at(-1),'1. e4 c5 2. Nf3 *');
  assert.deepEqual(parseLine(written.at(-1)).moves,['e4','c5','Nf3']);
  assert.equal(ui.messages.at(-1),'PGN copied');
});

test('copy uses local-file fallback after unavailable or denied clipboard and reports failure honestly',async()=>{
  const {parseLine,formatLine}=await library();const game=parseLine('1. d4 d5').game;game.go(2);
  const denied=harness(game,formatLine,{clipboard:{writeText:async()=>{throw new Error('denied')}}});
  await denied.button.onclick();assert.deepEqual(denied.written,['1. d4 d5 *']);assert.equal(denied.removed,1);assert.equal(denied.focusRestored,1);assert.equal(denied.messages.at(-1),'PGN copied');
  const noClipboard=harness(game,formatLine);await noClipboard.button.onclick();assert.deepEqual(noClipboard.written,['1. d4 d5 *']);
  for(const options of [{copyResult:false},{execThrows:true}]){
    const failed=harness(game,formatLine,options);await failed.button.onclick();assert.deepEqual(failed.written,[]);assert.equal(failed.removed,1);assert.equal(failed.focusRestored,1);assert.match(failed.messages.at(-1),/could not copy/i);
  }
});
