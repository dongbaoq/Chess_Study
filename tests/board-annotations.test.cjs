// Run with: node --experimental-vm-modules --test tests/board-annotations.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','annotations.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));

async function setup(initial={}){
  const listeners=new Map(), nodes=new Map(), released=[], svg={style:{},innerHTML:'',setAttribute(){},remove(){}};
  for(const name of ['a1','b2','c3','d4','e5'])nodes.set(name,{dataset:{square:name},closest(selector){return selector==='[data-square]'?this:null}});
  const names=[...nodes.keys()], records=clone(initial),writes=[],errors=[];
  let position='one', flipped=false, allowWrite=true, modeState=false;
  const host={style:{},appendChild(node){assert.equal(node,svg)}};
  const board={parentElement:host,style:{},classList:{toggle(){}},contains(node){return [...nodes.values()].includes(node)},setPointerCapture(){},releasePointerCapture(id){released.push(id)},addEventListener(type,fn){listeners.set(type,fn)},removeEventListener(type){listeners.delete(type)}};
  const document={createElementNS(_namespace,tag){assert.equal(tag,'svg');return svg},elementFromPoint(x){return nodes.get(names[x])||null}};
  const context=vm.createContext({document,getComputedStyle:()=>({position:'relative'}),setTimeout,clearTimeout});
  const mod=new vm.SourceTextModule(source,{context});await mod.link(()=>{});await mod.evaluate();
  const controller=mod.namespace.createBoardAnnotations({board,getFlipped:()=>flipped,getKey:()=>position,read:key=>records[key],write:(key,value)=>{writes.push({key,value:clone(value)});if(allowWrite)records[key]=clone(value)},onError:message=>errors.push(message),onModeChange:on=>{modeState=on}});
  function fire(type,square,options={}){
    const fn=listeners.get(type); if(!fn)return;
    const index=names.indexOf(square);
    const event={button:2,buttons:2,pointerType:'mouse',pointerId:1,clientX:index,clientY:0,shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.propagationStopped=true},stopImmediatePropagation(){this.immediateStopped=true},...options};
    fn(event);return event;
  }
  return {controller,svg,records,writes,errors,released,fire,position:value=>{position=value},flip:value=>{flipped=value},allow:value=>{allowWrite=value},getMode:()=>modeState};
}

test('rendering existing annotations uses circles and arrows without writing; flip changes only coordinates',async()=>{
  const record={squares:{a1:'green',d4:'future-color'},arrows:[{from:'a1',to:'b2',color:'red',note:'retain'}],extra:{keep:true}};
  const x=await setup({one:record});
  assert.equal(x.writes.length,0);
  assert.match(x.svg.innerHTML,/<circle\b/);
  assert.match(x.svg.innerHTML,/<path data-annotation-arrow="saved" /);
  assert.doesNotMatch(x.svg.innerHTML,/<line\b|<marker\b|marker-end=/);
  assert.match(x.svg.innerHTML,/cx="0\.5" cy="7\.5"/);
  x.flip(true);x.controller.refresh();
  assert.match(x.svg.innerHTML,/cx="7\.5" cy="0\.5"/);
  assert.equal(x.writes.length,0);assert.deepEqual(x.records.one,record);
});

test('right-click toggles circles; drag previews without writing and toggles or recolors arrows',async()=>{
  const x=await setup({one:{squares:{d4:'future-color'},arrows:[{from:'a1',to:'b2',color:'green',note:'retain'},{from:'d4',to:'e5',color:'future-color',note:'keep'}],extra:'retain'}});
  x.fire('pointerdown','c3');x.fire('pointerup','c3');
  assert.equal(x.records.one.squares.c3,'green');
  x.fire('pointerdown','c3');x.fire('pointerup','c3');assert.equal(x.records.one.squares.c3,undefined);
  const count=x.writes.length;
  x.fire('pointerdown','a1',{shiftKey:true});x.fire('pointermove','b2',{shiftKey:true});
  assert.equal(x.writes.length,count,'preview must not persist');
  x.fire('pointerup','b2',{shiftKey:true});
  assert.deepEqual(x.records.one.arrows[0],{from:'a1',to:'b2',color:'red',note:'retain'});
  assert.deepEqual(x.records.one.arrows[1],{from:'d4',to:'e5',color:'future-color',note:'keep'});
  x.fire('pointerdown','a1',{shiftKey:true});x.fire('pointerup','b2',{shiftKey:true});
  assert.deepEqual(x.records.one.arrows,[{from:'d4',to:'e5',color:'future-color',note:'keep'}]);
  assert.equal(x.records.one.squares.d4,'future-color');assert.equal(x.records.one.extra,'retain');
});

test('preview is visible but never saved; cancellation, position changes and normal clicks preserve records',async()=>{
  const record={squares:{a1:'green'},arrows:[],extra:'keep'},x=await setup({one:record,two:{squares:{b2:'blue'},arrows:[]}});
  x.fire('pointerdown','b2');x.fire('pointermove','c3');
  assert.equal(x.writes.length,0);assert.match(x.svg.innerHTML,/<path data-annotation-arrow="preview"/,'drag should show a temporary arrow');
  x.fire('pointercancel','c3');assert.equal(x.writes.length,0);assert.deepEqual(x.released,[1]);assert.doesNotMatch(x.svg.innerHTML,/data-annotation-arrow="preview"/,'cancelling removes the temporary arrow');
  x.fire('pointerdown','b2');x.fire('pointermove','c3');x.position('two');x.controller.refresh();assert.deepEqual(x.released,[1,1]);x.fire('pointerup','c3');
  assert.equal(x.writes.length,0);assert.deepEqual(x.records.one,record);
  x.fire('pointerdown','b2',{button:0,buttons:1});x.fire('pointerup','b2',{button:0,buttons:0});
  assert.equal(x.writes.length,0);assert.deepEqual(x.records.two,{squares:{b2:'blue'},arrows:[]});
});

test('touch drawing mode still supports two taps and preserves other markings',async()=>{
  const x=await setup({one:{squares:{d4:'red'},arrows:[],extra:'keep'}});x.controller.setMode(true);assert.equal(x.getMode(),true);
  x.fire('pointerdown','a1',{button:0,pointerType:'touch'});x.fire('pointerup','a1',{button:0,pointerType:'touch'});assert.equal(x.writes.length,0);
  x.fire('pointerdown','b2',{button:0,pointerType:'touch'});x.fire('pointerup','b2',{button:0,pointerType:'touch'});
  assert.deepEqual(x.records.one,{squares:{d4:'red'},arrows:[{from:'a1',to:'b2',color:'green'}],extra:'keep'});
  x.controller.setMode(false);assert.equal(x.getMode(),false);
});

test('unreadable, unknown and unavailable data is not overwritten',async()=>{
  const x=await setup({one:{squares:{a1:'future-color',d4:'red'},arrows:[{from:'a1',to:'b2',color:'future-color',note:'keep'}],extra:'keep'}});
  x.fire('pointerdown','a1');x.fire('pointerup','a1');assert.equal(x.writes.length,0);assert.match(x.errors[0],/unsupported/i);
  x.controller.clear();assert.deepEqual(x.records.one,{squares:{a1:'future-color'},arrows:[{from:'a1',to:'b2',color:'future-color',note:'keep'}],extra:'keep'});
  const bad=await setup({one:{squares:'unreadable',arrows:[],extra:'keep'}});bad.fire('pointerdown','a1');bad.fire('pointerup','a1');assert.equal(bad.writes.length,0);assert.deepEqual(bad.records.one,{squares:'unreadable',arrows:[],extra:'keep'});assert.match(bad.errors[0],/preserved/i);
  const failed=await setup({one:{squares:{a1:'red'},arrows:[],extra:'keep'}});failed.allow(false);failed.fire('pointerdown','a1');failed.fire('pointerup','a1');assert.deepEqual(failed.records.one,{squares:{a1:'red'},arrows:[],extra:'keep'});
});


test('modifier combinations and control-click choose colors without clearing unrelated marks',async()=>{
  const x=await setup({one:{squares:{d4:'green'},arrows:[],extra:'keep'}});
  for(const [square,options,color] of [
    ['a1',{ctrlKey:true},'red'],['b2',{altKey:true},'blue'],
    ['c3',{ctrlKey:true,altKey:true},'yellow'],['e5',{button:0,buttons:1,ctrlKey:true},'red']
  ]){x.fire('pointerdown',square,options);x.fire('pointerup',square,options);assert.equal(x.records.one.squares[square],color)}
  assert.equal(x.records.one.squares.d4,'green');assert.equal(x.records.one.extra,'keep');
});


test('control-click drawing consumes its subsequent click, while the next ordinary click passes',async()=>{
  const x=await setup({one:{squares:{},arrows:[]}});
  x.fire('pointerdown','a1',{button:0,buttons:1,ctrlKey:true});
  x.fire('pointerup','a1',{button:0,buttons:0,ctrlKey:true});
  assert.equal(x.records.one.squares.a1,'red');
  const generated=x.fire('click','a1',{button:0,buttons:0,ctrlKey:true});
  assert.equal(generated.immediateStopped,true,'the synthetic click must not select or move a piece');
  const next=x.fire('click','b2',{button:0,buttons:0});
  assert.notEqual(next.immediateStopped,true,'a later normal click should still select a piece');
});


test('arrows are single outlines composited together without shaded overlaps',async()=>{
  const record={squares:{d4:'blue'},arrows:[{from:'a1',to:'b2',color:'green',note:'keep'},{from:'a1',to:'e5',color:'red',other:1}],extra:{keep:true}};
  const x=await setup({one:record});
  assert.equal(x.writes.length,0);
  const group=x.svg.innerHTML.match(/<g opacity="\.75">([\s\S]*?)<\/g>/);assert.ok(group,'saved arrows must share one opacity group');
  const arrows=[...group[1].matchAll(/<path data-annotation-arrow="saved" d="([^"]+)" fill="([^"]+)" \/>/g)];
  assert.equal(arrows.length,2);
  for(const [,d] of arrows){
    assert.match(d,/^M [-\d.]+ [-\d.]+(?: L [-\d.]+ [-\d.]+){6} Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ Z$/);
    assert.doesNotMatch(d,/NaN|Infinity/);
  }
  const tip=d=>{const commands=[...d.matchAll(/L ([-\d.]+) ([-\d.]+)/g)];return commands[2].slice(1).map(Number)};
  const near=tip(arrows[0][1]),far=tip(arrows[1][1]);
  assert.ok(Math.abs(near[0]-1.4293)<0.001 && Math.abs(near[1]-6.5707)<0.001,'short arrow tip follows a1 to b2');
  assert.ok(Math.abs(far[0]-4.4293)<0.001 && Math.abs(far[1]-3.5707)<0.001,'long arrow tip follows a1 to e5');
  x.flip(true);x.controller.refresh();
  const flipped=[...x.svg.innerHTML.matchAll(/<path data-annotation-arrow="saved" d="([^"]+)"/g)];
  const flippedTip=tip(flipped[0][1]);assert.ok(Math.abs(flippedTip[0]-6.5707)<0.001 && Math.abs(flippedTip[1]-1.4293)<0.001);
  assert.equal(x.writes.length,0);assert.deepEqual(x.records.one,record);
});

test('preview does not overlay its saved arrow and cancellation restores it without writes',async()=>{
  const record={squares:{},arrows:[{from:'a1',to:'b2',color:'green',note:'keep'}]},x=await setup({one:record});
  x.fire('pointerdown','a1');x.fire('pointermove','b2');
  assert.equal(x.writes.length,0);
  assert.equal((x.svg.innerHTML.match(/data-annotation-arrow="preview"/g)||[]).length,1);
  assert.equal((x.svg.innerHTML.match(/data-annotation-arrow="saved"/g)||[]).length,0);
  x.fire('pointercancel','b2');
  assert.equal((x.svg.innerHTML.match(/data-annotation-arrow="preview"/g)||[]).length,0);
  assert.equal((x.svg.innerHTML.match(/data-annotation-arrow="saved"/g)||[]).length,1);
  assert.equal(x.writes.length,0);assert.deepEqual(x.records.one,record);
});


test('preview and saved arrows share the same opacity group at crossings',async()=>{
  const record={squares:{},arrows:[{from:'a1',to:'e5',color:'green'}]},x=await setup({one:record});
  x.fire('pointerdown','a1');x.fire('pointermove','b2');
  assert.match(x.svg.innerHTML,/<g opacity="\.75">[\s\S]*data-annotation-arrow="saved"[\s\S]*<g opacity="\.733333"><path data-annotation-arrow="preview"/);
  assert.equal(x.writes.length,0);assert.deepEqual(x.records.one,record);
});
