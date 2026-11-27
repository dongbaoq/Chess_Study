/**
 * Supabase Auth and database adapter for createSyncController.
 * The project URL and publishable/legacy anon key are public configuration.
 * Passwords and sessions are kept only in memory; signing in is required again
 * after a page reload. No chess data or auth credentials are put in storage.
 *
 * Server contract: notebook_read() -> {revision,data};
 * notebook_write(expected_revision,snapshot) -> {revision} or {conflict:true}.
 */
export function createCloudSync({url, key, fetchImpl = globalThis.fetch?.bind(globalThis)} = {}) {
  let base;
  try { base = new URL(String(url)); } catch { throw new Error('Enter a valid Supabase project URL.'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) {
    throw new Error('Use the HTTPS project URL without a path.');
  }
  base = base.origin;
  key = String(key || '').trim();
  // Only public client keys belong in a browser. Legacy anon keys are JWTs.
  let publicKey = key.startsWith('sb_publishable_');
  if (!publicKey && key.split('.').length === 3) {
    try {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      publicKey = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).role === 'anon';
    } catch { publicKey = false; }
  }
  if (!publicKey) throw new Error('Use a Supabase publishable key or legacy anon key, never a secret key.');
  if (typeof fetchImpl !== 'function') throw new Error('Network access is unavailable.');
  let session = null, generation = 0, refreshing = null;
  const headers = token => ({apikey:key, 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})});
  const response = (status, value) => ({status, ok:status >= 200 && status < 300, json:async () => value});
  function parseSession(data) {
    if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || !data.user || typeof data.user.id !== 'string') {
      throw new Error('The sign-in response was invalid.');
    }
    const expiry = Number(data.expires_at) || (Date.now() / 1000 + Number(data.expires_in || 3600));
    return {accessToken:data.access_token, refreshToken:data.refresh_token, expiresAt:expiry, user:{id:data.user.id,email:data.user.email || ''}};
  }
  async function tokenRequest(grant, body) {
    const res = await fetchImpl(`${base}/auth/v1/token?grant_type=${grant}`, {method:'POST', headers:headers(), body:JSON.stringify(body), cache:'no-store'});
    if (!res.ok) throw new Error(grant === 'password' ? 'Sign-in failed. Check your email, password, and project settings.' : 'Your sign-in could not be refreshed. Please sign in again.');
    return parseSession(await res.json());
  }
  async function signIn(email, password) {
    const attempt = ++generation;
    session = null;
    refreshing = null;
    const next = await tokenRequest('password', {email:String(email).trim(),password:String(password)});
    if (generation !== attempt) throw new Error('Sign-in was cancelled.');
    session = next;
    return {...session.user};
  }
  async function signOut() {
    const old = session;
    ++generation; session = null; refreshing = null;
    if (old) {
      try { await fetchImpl(`${base}/auth/v1/logout?scope=local`, {method:'POST', headers:headers(old.accessToken), cache:'no-store'}); } catch { /* Local sign-out still succeeds. */ }
    }
  }
  async function refresh() {
    if (!session) throw new Error('Sign in to synchronize.');
    if (!refreshing) {
      const current = session, attempt = generation;
      const promise = tokenRequest('refresh_token', {refresh_token:current.refreshToken}).then(next => {
        if (generation !== attempt || session !== current) throw new Error('Sign-in changed during refresh.');
        session = next;
        return next;
      });
      refreshing = promise;
      promise.finally(() => { if (refreshing === promise) refreshing = null; }).catch(() => {});
    }
    return refreshing;
  }
  async function adapterFetch(_url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'PUT') return response(405, {error:'Unsupported method'});
    if (!session) return response(401, {error:'Sign in to synchronize.'});
    if (session.expiresAt <= Date.now() / 1000 + 60) await refresh();
    const started = generation;
    let body = {};
    if (method === 'PUT') {
      let input;
      try { input = JSON.parse(options.body); } catch { return response(400, {error:'Invalid sync request'}); }
      if (!Number.isSafeInteger(input?.revision) || input.revision < 0 || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) return response(400, {error:'Invalid sync request'});
      body = {expected_revision:input.revision,snapshot:input.data};
    }
    const request = () => fetchImpl(`${base}/rest/v1/rpc/${method === 'GET' ? 'notebook_read' : 'notebook_write'}`, {method:'POST',headers:headers(session.accessToken),body:JSON.stringify(body),cache:'no-store'});
    let result = await request();
    if (generation !== started || !session) throw new Error('Sign-in changed during synchronization.');
    if (result.status === 401) {
      await refresh();
      if (generation !== started || !session) throw new Error('Sign-in changed during synchronization.');
      result = await request();
    }
    if (generation !== started || !session) throw new Error('Sign-in changed during synchronization.');
    if (!result.ok) return response(result.status, {error:'Cloud request failed.'});
    const value = await result.json();
    if (generation !== started || !session) throw new Error('Sign-in changed during synchronization.');
    if (value?.conflict === true) return response(409, value);
    return response(result.status, value);
  }
  return {signIn, signOut, isSignedIn:() => !!session, getUser:() => session ? {...session.user} : null, fetch:adapterFetch};
}
