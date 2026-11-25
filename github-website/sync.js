/**
 * Revision-aware synchronization for a private hosted study.
 *
 * The server returns GET {revision, data}; revision 0 with null data means an
 * empty account. PUT accepts {revision, data}, returns {revision}, and responds
 * 409 when the supplied revision is stale. The revision must be checked by the
 * server atomically; this client never resolves a conflict by itself.
 *
 * createSyncController({ getSnapshot, applySnapshot, hasLocalData, onStatus })
 * - start(): check cloud; never upload on first connect.
 * - markChanged(): debounce a change after initial sync is enabled.
 * - syncNow(): check for remote edits and flush safe local edits.
 * - useCloud(): explicitly replace local data with the last checked cloud data.
 * - useLocal(): explicitly upload the current local data against the last
 *   checked revision. A concurrent change becomes a conflict, never an overwrite.
 * - stop(): stop polling and timers. getStatus() returns the latest status.
 *
 * hasLocalData() should report genuine user data, not untouched demo seed data.
 * applySnapshot() must synchronously replace the complete local snapshot.
 */
function stableSyncValue(value) {
  if (Array.isArray(value)) return value.map(stableSyncValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSyncValue(value[key])]));
  }
  return value;
}
function syncFingerprint(value) { return JSON.stringify(stableSyncValue(value)); }
function syncClone(value) { return JSON.parse(JSON.stringify(value)); }

export function createSyncController({getSnapshot, applySnapshot, hasLocalData = () => true, onStatus = () => {}, fetchImpl = globalThis.fetch?.bind(globalThis), url = '/api/sync', debounceMs = 800, pollMs = 30000, isFile = globalThis.location?.protocol === 'file:'} = {}) {
  if (typeof getSnapshot !== 'function' || typeof applySnapshot !== 'function') throw new Error('Sync requires snapshot callbacks.');
  let status = {kind:'local-only', message:'Saved on this device.'};
  let revision = null, observedRevision = null, remoteData = null, baseline = null;
  let enabled = false, needsResolution = false, started = false, stopped = false, timer = null, poll = null;
  let queue = Promise.resolve();
  const publish = (kind, message) => {if(kind==='conflict')needsResolution=true;status={kind,message,revision:observedRevision}; onStatus({...status});};
  const serial = fn => {const operation=queue.then(()=>stopped ? false : fn()); queue=operation.catch(()=>{}); return operation;};
  const dirty = () => baseline !== syncFingerprint(getSnapshot());
  const clearTimer = () => {if(timer!==null){clearTimeout(timer);timer=null;}};
  function schedule() {
    if(!enabled || stopped || needsResolution) return;
    clearTimer();timer=setTimeout(()=>{timer=null;void syncNow();},debounceMs);
  }
  async function request(method, body) {
    if (typeof fetchImpl !== 'function') throw new Error('Sync is unavailable.');
    const response=await fetchImpl(url,{method,headers:{'Accept':'application/json',...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {}),cache:'no-store',credentials:'same-origin'});
    if(response.status===409) return {conflict:true};
    if(!response.ok) throw new Error(`Sync is unavailable (${response.status}).`);
    const json=await response.json();
    if(!json || !Number.isInteger(json.revision) || json.revision<0 || (method==='GET' && !('data' in json))) throw new Error('Invalid sync response.');
    return json;
  }
  function adoptCloud() {
    applySnapshot(syncClone(remoteData));
    revision=observedRevision;baseline=syncFingerprint(getSnapshot());enabled=true;needsResolution=false;
    publish('synced','Saved and synchronized.');
  }
  async function refresh() {
    if(isFile){publish('local-only','Saved on this device. Open the hosted site to synchronize.');return false;}
    try {
      const result=await request('GET');
      observedRevision=result.revision;remoteData=result.data;
      const here=syncFingerprint(getSnapshot());
      if(needsResolution){publish('conflict','The cloud study changed. Choose which copy to keep.');return true;}
      if(!enabled) {
        if(remoteData===null) {publish('setup','Cloud is empty. Choose to upload your local study.');return true;}
        if(!hasLocalData()) {adoptCloud();return true;}
        if(here===syncFingerprint(remoteData)) {revision=observedRevision;baseline=here;enabled=true;publish('synced','Saved and synchronized.');return true;}
        publish('conflict','Local and cloud studies differ. Choose which copy to keep.');return true;
      }
      if(observedRevision===revision) {
        if(dirty()) publish('pending','Changes saved on this device, waiting to sync.');
        else publish('synced','Saved and synchronized.');
        return true;
      }
      if(remoteData!==null && here===syncFingerprint(remoteData)) {revision=observedRevision;baseline=here;publish('synced','Saved and synchronized.');return true;}
      if(!dirty() && remoteData!==null) {adoptCloud();return true;}
      publish('conflict','The cloud study changed on another device. Choose which copy to keep.');return true;
    } catch(error) {publish('offline','Saved on this device. Cloud sync is unavailable.');return false;}
  }
  async function upload(expectedRevision) {
    const snapshot=syncClone(getSnapshot()), sentHash=syncFingerprint(snapshot);
    publish('syncing','Saving to cloud…');
    try {
      const result=await request('PUT',{revision:expectedRevision,data:snapshot});
      if(result.conflict) {
        // The cloud changed after our read. Fetch its latest copy without
        // adopting it: the current local edits must survive the conflict.
        const fresh=await request('GET');observedRevision=fresh.revision;remoteData=fresh.data;
        if(remoteData!==null && syncFingerprint(remoteData)===sentHash && syncFingerprint(getSnapshot())===sentHash){revision=observedRevision;baseline=sentHash;enabled=true;needsResolution=false;publish('synced','Saved and synchronized.');return true;}
        publish('conflict','The cloud study changed. Choose which copy to keep.');return false;
      }
      revision=result.revision;observedRevision=result.revision;remoteData=snapshot;baseline=sentHash;enabled=true;needsResolution=false;
      if(dirty()){publish('pending','Changes saved on this device, waiting to sync.');schedule();}
      else publish('synced','Saved and synchronized.');
      return true;
    } catch(error) {publish('offline','Saved on this device. Cloud sync is unavailable.');return false;}
  }
  async function start() {
    if(started)return false;started=true;stopped=false;
    if(!isFile && pollMs>0)poll=setInterval(()=>{void syncNow();},pollMs);
    return serial(async()=>{publish('checking','Checking cloud sync…');const ok=await refresh();if(ok && enabled && dirty() && status.kind!=='conflict')schedule();return ok;});
  }
  function markChanged() {
    if(!started || stopped)return;
    if(enabled && !needsResolution){publish('pending','Changes saved on this device, waiting to sync.');schedule();}
  }
  function syncNow() {
    clearTimer();
    return serial(async()=>{const ok=await refresh();if(ok && enabled && !needsResolution && dirty())return upload(revision);return ok;});
  }
  function useCloud() {
    clearTimer();
    return serial(async()=>{
      if(isFile)return false;
      try {const fresh=await request('GET');observedRevision=fresh.revision;remoteData=fresh.data;
        if(remoteData===null){publish('setup','Cloud is empty. Choose to upload your local study.');return false;}
        adoptCloud();return true;
      } catch(error) {publish('offline','Saved on this device. Cloud sync is unavailable.');return false;}
    });
  }
  function useLocal() {
    clearTimer();
    return serial(async()=>{if(isFile || observedRevision===null)return false;return upload(observedRevision);});
  }
  function stop() {stopped=true;clearTimer();if(poll!==null)clearInterval(poll);poll=null;}
  return {start,markChanged,syncNow,useCloud,useLocal,stop,getStatus:()=>({...status})};
}
