// Run with node --experimental-vm-modules --test tests/drag-hints.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

function classes(initial=[]){const values=new Set(initial);return {toggle(name,on){if(on)values.add(name);else values.delete(name)},contains(name){return values.has(name)}}}
test('drag hints distinguish ordinary moves and captures and clear or restore the selected piece',()=>{
 const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
 const start=source.indexOf('function showLegalHints(from){'),end=source.indexOf('\ncreateBoardDrag(',start);
 assert.ok(start>=0&&end>start);
 const squares=['e4','d5','d6','b3'].map(square=>({dataset:{square},classList:classes()}));
 const legal=[{from:'e2',to:'e4',san:'e4'},{from:'e4',to:'d5',san:'exd5'},{from:'e5',to:'d6',san:'exd6'},{from:'a1',to:'b3',san:'Nb3'}];
 const context={engine:{legalMoves:()=>legal},$:()=>({querySelectorAll:()=>squares})};
 vm.runInNewContext(source.slice(start,end),context);
 context.showLegalHints('e4');assert.equal(squares[1].classList.contains('legal-capture'),true);assert.equal(squares[1].classList.contains('legal'),true);
 context.showLegalHints('e5');assert.equal(squares[1].classList.contains('legal'),false);assert.equal(squares[2].classList.contains('legal-capture'),true); // en passant target can be empty
 context.showLegalHints('e2');assert.equal(squares[0].classList.contains('legal'),true);assert.equal(squares[0].classList.contains('legal-capture'),false);
 context.showLegalHints(null);assert.ok(squares.every(square=>!square.classList.contains('legal')&&!square.classList.contains('legal-capture')));
});

test('drag callbacks run only during a drag and are cleaned on drop and cancellation',async()=>{
 const listeners={},windowListeners={},calls=[];let under='e2';
 const piece={style:{visibility:''},getBoundingClientRect:()=>({left:0,top:0,width:50,height:50}),cloneNode:()=>({style:{},setAttribute(){},remove(){}})};
 const square={dataset:{square:'e2'},querySelector:()=>piece,closest(){return this}};
 const host={appendChild(){}};
 const board={parentElement:host,style:{},classList:{},addEventListener:(key,fn)=>listeners[key]=fn,removeEventListener(){},contains:()=>true,getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture(){}};
 const win={addEventListener:(key,fn)=>windowListeners[key]=fn,removeEventListener(){}};
 const context=vm.createContext({window:win,document:{elementFromPoint:()=>({closest:()=>({dataset:{square:under}})})},setTimeout,clearTimeout});
 const mod=new vm.SourceTextModule(fs.readFileSync(path.join(root,'drag.js'),'utf8'),{context});await mod.link(()=>{});await mod.evaluate();
 mod.namespace.createBoardDrag({board,canStart:()=>true,onDragStart:from=>calls.push('start '+from),onDragEnd:()=>calls.push('end'),onMove:(from,to)=>calls.push(from+' '+to)});
 const event=(x,y)=>({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,target:square,preventDefault(){},stopPropagation(){}});
 listeners.pointerdown(event(0,0));windowListeners.pointermove(event(10,10));under='e4';windowListeners.pointerup(event(10,10));
 assert.deepEqual(calls,['start e2','end','e2 e4']);
 under='e2';listeners.pointerdown(event(0,0));windowListeners.pointermove(event(10,10));windowListeners.pointercancel(event(10,10));assert.deepEqual(calls.slice(-2),['start e2','end']);
});
