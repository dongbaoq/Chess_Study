// Run with: node --experimental-vm-modules --test tests/cloud-sync.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const mod = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname,'..','cloud-sync.js'),'utf8'));
  await mod.link(()=>{});await mod.evaluate();return mod.namespace.createCloudSync;
}
const answer = (status, body) => ({status,ok:status >= 200 && status < 300,json:async()=>body});
const login = (access='access', refresh='refresh', expiresIn=3600) => ({access_token:access,refresh_token:refresh,expires_in:expiresIn,user:{id:'user-id',email:'study@example.test'}});
const config = {url:'https://study.supabase.co',key:'sb_publishable_public'};

test('accepts public configuration only and never calls the network without sign in', async()=>{
  const create=await load();let requests=0;
  const fetchImpl=async()=>{requests++;throw Error('unexpected request')};
  for (const url of ['http://study.supabase.co','https://study.supabase.co/path','https://user:pass@study.supabase.co','not a url']) assert.throws(()=>create({...config,url,fetchImpl}));
  for (const key of ['sb_secret_hidden','', 'invalid']) assert.throws(()=>create({...config,key,fetchImpl}));
  const adapter=create({...config,fetchImpl});
  assert.equal((await adapter.fetch('',{method:'GET'})).status,401);
  assert.equal(requests,0);
});

test('uses the authenticated token for per-user RPCs and translates revision conflicts', async()=>{
  const create=await load(), calls=[];
  const adapter=create({...config,fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/auth/v1/token'))return answer(200,login());
    if(url.endsWith('/notebook_read'))return answer(200,{revision:7,data:{version:1,folders:[],annotations:{}}});
    if(url.endsWith('/notebook_write'))return answer(200,{conflict:true});
    throw Error('unexpected request');
  }});
  assert.deepEqual(await adapter.signIn(' study@example.test ','secret'),{id:'user-id',email:'study@example.test'});
  const read=await adapter.fetch('/api/sync',{method:'GET'});
  assert.deepEqual(await read.json(),{revision:7,data:{version:1,folders:[],annotations:{}}});
  const snapshot={version:1,folders:[{id:'opening',note:'keep',games:[]}],annotations:{square:{squares:{d4:'red'}}}};
  const write=await adapter.fetch('/api/sync',{method:'PUT',body:JSON.stringify({revision:7,data:snapshot})});
  assert.equal(write.status,409);
  assert.deepEqual(JSON.parse(calls[2].options.body),{expected_revision:7,snapshot});
  assert.equal(calls[1].options.headers.Authorization,'Bearer access');
  assert.equal(calls[1].options.headers.apikey,config.key);
  assert.equal((await adapter.fetch('',{method:'PUT',body:JSON.stringify({revision:-1,data:snapshot})})).status,400);
  assert.equal(calls.length,3);
});

test('refreshes an expired session once for concurrent requests', async()=>{
  const create=await load();let refreshes=0;const rpcTokens=[];
  const adapter=create({...config,fetchImpl:async(url,options)=>{
    if(url.includes('grant_type=password'))return answer(200,login('expired','old-refresh',1));
    if(url.includes('grant_type=refresh_token')){refreshes++;assert.deepEqual(JSON.parse(options.body),{refresh_token:'old-refresh'});return answer(200,login('new-token','new-refresh'));}
    rpcTokens.push(options.headers.Authorization);return answer(200,{revision:0,data:null});
  }});
  await adapter.signIn('a','b');
  await Promise.all([adapter.fetch('',{method:'GET'}),adapter.fetch('',{method:'GET'})]);
  assert.equal(refreshes,1);assert.deepEqual(rpcTokens,['Bearer new-token','Bearer new-token']);
});

test('an in-flight sign-in or read cannot restore a session after sign-out', async()=>{
  const create=await load();let finishLogin;
  const first=create({...config,fetchImpl:()=>new Promise(resolve=>{finishLogin=resolve})});
  const pending=first.signIn('a','b');await first.signOut();finishLogin(answer(200,login()));
  await assert.rejects(pending,/cancelled/i);assert.equal(first.isSignedIn(),false);
  let finishRead;
  const second=create({...config,fetchImpl:async(url)=>{
    if(url.includes('/token'))return answer(200,login());
    if(url.includes('/logout'))return answer(204,{});
    return new Promise(resolve=>{finishRead=resolve});
  }});
  await second.signIn('a','b');const pendingRead=second.fetch('',{method:'GET'});await second.signOut();
  finishRead(answer(200,{revision:1,data:{}}));
  await assert.rejects(pendingRead,/changed/i);assert.equal(second.isSignedIn(),false);
});
