// Run with: node --experimental-vm-modules --test tests/game-position-notes.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=source.indexOf('function markGamePositionNotes(');
const end=source.indexOf('\nlet branchHintSvg=null;',start);
assert.ok(start>=0&&end>start,'game position note marker should exist');

test('marks notes on played and analysis paths, including legacy ply-indexed notes',()=>{
 const moves=(sequence,children=[])=>({moves:sequence,children});
 const tree=moves([],[
  moves(['e4'],[
   moves(['e4','e5'],[moves(['e4','e5','Nf3'])]),
   moves(['e4','c5'])
  ])
 ]);
 const game={notes:{'':'Starting note',1:'Legacy first move','e4 e5':'Played position','e4 c5':'Analysis position','e4 e5 Nf3':''}};
 const context=vm.createContext({startsWithMoves:(line,prefix)=>prefix.length<=line.length&&prefix.every((move,index)=>line[index]===move)});
 vm.runInContext(source.slice(start,end),context);
 context.markGamePositionNotes(tree,game,['e4','e5','Nf3']);
 assert.equal(tree.hasNote,true);
 assert.equal(tree.children[0].hasNote,true);
 assert.equal(tree.children[0].children[0].hasNote,true);
 assert.equal(tree.children[0].children[0].children[0].hasNote,false);
 assert.equal(tree.children[0].children[1].hasNote,true);
 assert.deepEqual(game.notes,{'':'Starting note',1:'Legacy first move','e4 e5':'Played position','e4 c5':'Analysis position','e4 e5 Nf3':''});
});

test('ignores malformed note containers without rewriting them or adding markers',()=>{
 const tree={moves:[],children:[{moves:['e4'],children:[]}]};
 for(const notes of [null,'future-format',[]]){
  const game={notes};const before=JSON.stringify(game);
  const context=vm.createContext({startsWithMoves:()=>false});
  vm.runInContext(source.slice(start,end),context);
  context.markGamePositionNotes(tree,game,[]);
  assert.equal(JSON.stringify(game),before);
  assert.equal(tree.hasNote,undefined);
 }
});
