// Run with: node --experimental-vm-modules --test tests/sync-ui.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,`${start} through ${end}`);return source.slice(a,b)};

function detectData(initial){
  const values=new Map(Object.entries(initial)),nodes=new Map(),errors=[];
  const context={storage:{getItem:key=>values.has(key)?values.get(key):null},getStored:key=>values.has(key)?values.get(key):null,setStored:(key,value)=>values.set(key,value),showStorageFailure:e=>errors.push(e),$:key=>{if(!nodes.has(key))nodes.set(key,{});return nodes.get(key)}};
  vm.createContext(context);
  const detection=between('const existingLibrary=', 'let syncController=null;');
  const marking=between('function validMarkings(', '// Keep game markings');
  vm.runInContext(detection+marking+'\nthis.result={hasUserData,marksBlocked,annotations,originalMarksRaw};',context);
  return {...context.result,errors,values};
}

test('a legacy or current library and existing markings count as local user data',()=>{
  assert.equal(detectData({}).hasUserData,false);
  assert.equal(detectData({'opening-notebook-v1':'[]'}).hasUserData,true);
  assert.equal(detectData({'opening-notebook-v2':'[]'}).hasUserData,true);
  const raw=JSON.stringify({'game:g:p':{squares:{d4:'red'},arrows:[]}});
  const marks=detectData({'opening-notebook-marks-v1':raw});
  assert.equal(marks.hasUserData,true);assert.equal(marks.marksBlocked,false);
  assert.equal(marks.originalMarksRaw,raw);assert.equal(JSON.stringify(marks.annotations),raw);
  const bad=detectData({'opening-notebook-marks-v1':'not JSON'});
  assert.equal(bad.hasUserData,true);assert.equal(bad.marksBlocked,true);assert.equal(bad.values.get('opening-notebook-marks-v1'),'not JSON');assert.match(bad.errors[0],/not be read/i);
});

function harness(){
  const nodes=new Map(), writes=[], clients=[], controllers=[];let callback, modalCount=0;
  const node=key=>{if(!nodes.has(key))nodes.set(key,{});return nodes.get(key)};
  const dialog=node('#modal');dialog.close=()=>{dialog.open=false};
  const sandbox={storageBlocked:false,marksBlocked:false,storageFailure:null,hasUserData:true,syncController:null,
    getStored:()=>null,storage:{setItem:(key,value)=>writes.push([key,value])},esc:s=>String(s),
    $:node,showStorageFailure:()=>{},checkLibraryCurrent:()=>({ok:true}),checkMarkingsCurrent:()=>({ok:true}),
    snapshot:()=>({}),applySnapshot:()=>{},confirmAction:()=>{},
    modal(_title,_body,submit){callback=submit;modalCount++;dialog.open=true;nodes.set('#connectError',{textContent:''});nodes.set('#modalForm',{button:{disabled:false},querySelector(){return this.button}})},
    createCloudSync(){let resolve,reject;const client={signIn:()=>new Promise((a,b)=>{resolve=a;reject=b}),signOut:async()=>{client.signedOut=true},fetch:()=>{},resolve:()=>resolve(),reject:e=>reject(e),signedOut:false};clients.push(client);return client},
    createSyncController(options){const controller={options,started:false,start:async()=>{controller.started=true},stop:async()=>{},syncNow(){}};controllers.push(controller);return controller}
  };
  vm.createContext(sandbox);vm.runInContext(between('let cloudSync=null;','if(storageBlocked||marksBlocked){$(\'#syncStatus\')'),sandbox);
  return {sandbox,node,dialog,clients,controllers,writes,get callback(){return callback},get modalCount(){return modalCount}};
}
const form={get:key=>({url:' https://study.supabase.co ',key:' sb_publishable_key ',email:' me@example.test ',password:'password'}[key])};

test('cancelled sign-in closes the created session without starting synchronization or storing configuration',async()=>{
  const h=harness();h.node('#syncNow').onclick();const pending=h.callback(form);
  assert.equal(h.node('#modalForm').button.disabled,true);
  h.dialog.close();h.clients[0].resolve();await pending;
  assert.equal(h.clients[0].signedOut,true);assert.equal(h.controllers.length,0);assert.equal(h.writes.length,0);
});

test('a replaced modal cannot be connected by the earlier sign-in, even when it is open',async()=>{
  const h=harness();h.node('#syncNow').onclick();const old=h.callback(form);h.dialog.close();
  h.node('#syncNow').onclick();const current=h.callback(form);
  h.clients[0].resolve();await old;
  assert.equal(h.clients[0].signedOut,true);assert.equal(h.controllers.length,0);
  h.clients[1].resolve();await current;
  assert.equal(h.controllers.length,1);assert.equal(h.controllers[0].started,true);assert.equal(h.controllers[0].options.hasLocalData(),true);
  assert.deepEqual(JSON.parse(h.writes[0][1]),{url:'https://study.supabase.co',key:'sb_publishable_key'});
  assert.equal(h.dialog.open,false);
});

test('duplicate submission while sign-in is pending does not create a second session',async()=>{
  const h=harness();h.node('#syncNow').onclick();const pending=h.callback(form);await h.callback(form);
  assert.equal(h.clients.length,1);h.clients[0].resolve();await pending;assert.equal(h.controllers.length,1);
});
