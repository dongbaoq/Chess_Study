// Run with: node --experimental-vm-modules --test tests/sync-controller.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function syncModule() {
  const mod = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '..', 'sync.js'), 'utf8'));
  await mod.link(() => {});
  await mod.evaluate();
  return mod.namespace;
}
const clone = value => JSON.parse(JSON.stringify(value));
const fixture = () => ({version:1, folders:[
  {id:'root',side:'white',parentId:null,name:'Open games',line:'1. e4',note:'Opening ideas',blunders:[{id:'b',moves:['e4'],text:'Keep the center',extra:{future:1}}],openingVariations:[{moves:['e4','c5'],extra:'keep'}],games:[],extraFolder:{unrecognized:'keep'}},
  {id:'child',side:'white',parentId:'root',name:'Spanish',line:'1. e4 e5 2. Nf3',note:'Develop',games:[{id:'game',name:'Game',pgn:'1. e4 e5 2. Nf3 Nc6',gameNote:'Game reflection',notes:{'e4 e5':'Position note'},moveSymbols:{'e4 e5 Nf3':'??'},analysisVariations:[{moves:['e4','c5'],other:'retain'}],extraGame:{retain:42}}]}
],annotations:{'game:game:position':{squares:{d4:'red'},arrows:[{from:'e2',to:'e4',color:'green',extra:'keep'}],unknown:{preserve:true}}}});

function backend(initial = null) {
  let revision = initial === null ? 0 : 1, data = clone(initial), beforePut = null;
  const response = (status, body) => ({status,ok:status >= 200 && status < 300,json:async()=>clone(body)});
  return {
    async fetch(_url, options) {
      if (options.method === 'GET') return response(200,{revision,data});
      assert.equal(options.method,'PUT');
      const request = JSON.parse(options.body);
      if (beforePut) {const hook=beforePut;beforePut=null;hook();}
      if (request.revision !== revision) return response(409,{});
      data=clone(request.data);revision++;
      return response(200,{revision});
    },
    change(next) {data=clone(next);revision++;},
    onNextPut(hook) {beforePut=hook;},
    get data() {return clone(data);},
    get revision() {return revision;}
  };
}
function client(createSyncController, cloud, initial, hasData=true) {
  let data=clone(initial), applications=0;
  const controller=createSyncController({getSnapshot:()=>data,applySnapshot:value=>{data=clone(value);applications++;},hasLocalData:()=>hasData,fetchImpl:cloud.fetch,pollMs:0,debounceMs:60000,isFile:false});
  return {controller,get data(){return clone(data)},get applications(){return applications},edit(fn){fn(data);controller.markChanged()}};
}

test('first connection requires explicit upload and preserves a complete library on a second device', async t => {
  const {createSyncController}=await syncModule(), cloud=backend(), original=fixture();
  const pc=client(createSyncController,cloud,original), phone=client(createSyncController,cloud,{version:1,folders:[],annotations:{}},false);
  t.after(()=>{pc.controller.stop();phone.controller.stop()});
  await pc.controller.start();
  assert.equal(pc.controller.getStatus().kind,'setup');
  assert.equal(cloud.data,null);
  assert.deepEqual(pc.data,original);
  assert.equal(await pc.controller.useLocal(),true);
  assert.deepEqual(cloud.data,original);
  await phone.controller.start();
  assert.equal(phone.controller.getStatus().kind,'synced');
  assert.deepEqual(phone.data,original);
  phone.edit(data=>{data.folders[1].games[0].gameNote='A new reflection'});
  await phone.controller.syncNow();
  await pc.controller.syncNow();
  const expected=fixture();expected.folders[1].games[0].gameNote='A new reflection';
  assert.deepEqual(pc.data,expected);
  assert.deepEqual(cloud.data,expected);
});

test('different existing libraries and concurrent edits remain intact until an explicit choice', async t => {
  const {createSyncController}=await syncModule(), original=fixture(), cloud=backend(original);
  const other=fixture();other.folders[0].note='Other device';
  const phone=client(createSyncController,cloud,other), pc=client(createSyncController,cloud,original);
  t.after(()=>{phone.controller.stop();pc.controller.stop()});
  await phone.controller.start();
  assert.equal(phone.controller.getStatus().kind,'conflict');
  assert.deepEqual(phone.data,other);
  assert.deepEqual(cloud.data,original);
  await phone.controller.syncNow();
  assert.deepEqual(cloud.data,original);
  assert.equal(await phone.controller.useCloud(),true);
  await pc.controller.start();
  phone.edit(data=>{data.folders[0].note='Phone edit'});
  pc.edit(data=>{data.folders[1].games[0].gameNote='PC edit'});
  await pc.controller.syncNow();
  await phone.controller.syncNow();
  assert.equal(phone.controller.getStatus().kind,'conflict');
  assert.equal(phone.data.folders[0].note,'Phone edit');
  assert.equal(cloud.data.folders[1].games[0].gameNote,'PC edit');
  assert.equal(cloud.data.folders[0].note,original.folders[0].note);
});

test('atomic revision rejects a write that races with another device', async t => {
  const {createSyncController}=await syncModule(), original=fixture(), cloud=backend(original);
  const pc=client(createSyncController,cloud,original);
  t.after(()=>pc.controller.stop());
  await pc.controller.start();
  pc.edit(data=>{data.folders[0].note='Local edit'});
  const remote=fixture();remote.folders[1].games[0].gameNote='Remote edit';
  cloud.onNextPut(()=>cloud.change(remote));
  assert.equal(await pc.controller.syncNow(),false);
  assert.equal(pc.controller.getStatus().kind,'conflict');
  assert.equal(pc.data.folders[0].note,'Local edit');
  assert.deepEqual(cloud.data,remote);
  await pc.controller.syncNow();
  assert.deepEqual(cloud.data,remote);
});

test('offline errors do not alter either device copy or cloud data', async t => {
  const {createSyncController}=await syncModule(), original=fixture(), cloud=backend(original);
  const pc=client(createSyncController,{fetch:async()=>{throw new Error('offline')}},original);
  t.after(()=>pc.controller.stop());
  assert.equal(await pc.controller.start(),false);
  assert.equal(pc.controller.getStatus().kind,'offline');
  assert.deepEqual(pc.data,original);
  assert.deepEqual(cloud.data,original);
  assert.equal(pc.applications,0);
});

test('local storage failure pauses synchronization and prevents uploads and cloud adoption', async t => {
  const {createSyncController}=await syncModule(), original=fixture(), cloud=backend(original);
  let local=clone(original), safe=true, applications=0, requests=0;
  const c=createSyncController({getSnapshot:()=>local,applySnapshot:data=>{local=clone(data);applications++},hasLocalData:()=>true,canSync:()=>safe,fetchImpl:async(...args)=>{requests++;return cloud.fetch(...args)},pollMs:0,isFile:false});
  t.after(()=>c.stop());
  await c.start();
  safe=false;local.folders[0].note='Unsaved local edit';c.markChanged();
  assert.equal(c.getStatus().kind,'paused');
  const before=requests;
  assert.equal(await c.syncNow(),false);
  assert.equal(await c.useLocal(),false);
  assert.equal(await c.useCloud(),false);
  assert.equal(requests,before);
  assert.equal(applications,0);
  assert.deepEqual(cloud.data,original);
  assert.equal(local.folders[0].note,'Unsaved local edit');
});

test('storage failure during a cloud read prevents later adoption or upload', async t => {
  const {createSyncController}=await syncModule(), original=fixture(), cloud=backend(original);
  let local=clone(original), safe=true, applications=0, requests=0, release;
  const gate=new Promise(resolve=>{release=resolve});
  const c=createSyncController({getSnapshot:()=>local,applySnapshot:data=>{local=clone(data);applications++},hasLocalData:()=>false,canSync:()=>safe,fetchImpl:async(...args)=>{requests++;await gate;return cloud.fetch(...args)},pollMs:0,isFile:false});
  t.after(()=>c.stop());
  const pending=c.start();
  await new Promise(resolve=>setImmediate(resolve));
  safe=false;release();
  assert.equal(await pending,false);
  assert.equal(c.getStatus().kind,'paused');
  assert.equal(applications,0);
  assert.equal(requests,1);
  assert.deepEqual(local,original);
  assert.deepEqual(cloud.data,original);
});

test('storage failure while checking before an upload leaves the cloud untouched', async t => {
  const {createSyncController}=await syncModule(), original=fixture(), cloud=backend(original);
  let local=clone(original), safe=true, pauseRead=false, release, started;
  const readStarted=new Promise(resolve=>{started=resolve});
  const gate=new Promise(resolve=>{release=resolve});
  const c=createSyncController({getSnapshot:()=>local,applySnapshot:data=>{local=clone(data)},canSync:()=>safe,fetchImpl:async(...args)=>{if(pauseRead && args[1].method==='GET'){started();await gate}return cloud.fetch(...args)},pollMs:0,debounceMs:60000,isFile:false});
  t.after(()=>c.stop());
  await c.start();
  local.folders[0].note='Pending local edit';c.markChanged();pauseRead=true;
  const pending=c.syncNow();await readStarted;safe=false;release();
  assert.equal(await pending,false);
  assert.equal(c.getStatus().kind,'paused');
  assert.deepEqual(cloud.data,original);
  assert.equal(local.folders[0].note,'Pending local edit');
});
