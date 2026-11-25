import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleEcosystemRequest } from '../ecosystem/worker.mjs';
import { normalizeIdgafCard } from '../shared/card.mjs';

const origin='https://idgafcord.example.workers.dev', uid='123456789012345678', other='234567890123456789';
function environment(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../ecosystem/migrations/0001_cards.sql',import.meta.url),'utf8'));
  return {sqlite,PUBLIC_ORIGIN:origin,DISCORD_CLIENT_ID:'345678901234567890',DISCORD_CLIENT_SECRET:'fixture-only-not-a-secret',DB:{
    prepare(sql){let params=[];return {bind(...values){params=values;return this;},async first(){return sqlite.prepare(sql).get(...params)||null;},async all(){return {results:sqlite.prepare(sql).all(...params)};},async run(){return sqlite.prepare(sql).run(...params);}};},async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}
  },ASSETS:{fetch:()=>new Response('fixture asset')}};
}
function request(path,options={}){return new Request(origin+path,options);}
async function signIn(env,id=uid){
  const start=await handleEcosystemRequest(request('/auth/start'),env),authorize=new URL(start.headers.get('location'));
  assert.equal(authorize.origin,'https://discord.com');assert.equal(authorize.searchParams.get('scope'),'identify');
  const state=authorize.searchParams.get('state'),stateCookie=start.headers.get('set-cookie').split(';')[0];
  const response=await handleEcosystemRequest(request('/auth/callback?code=fixture-code&state='+state,{headers:{cookie:stateCookie}}),env,async(url,options)=>{
    assert.equal(options.redirect,'error');
    if(url.endsWith('/oauth2/token'))return Response.json({access_token:'fixture-oauth-token-not-a-session-token',token_type:'Bearer',scope:'identify'});
    assert.equal(url,'https://discord.com/api/v10/users/@me');return Response.json({id,username:'fixture-user'});
  });
  assert.equal(response.status,302);const cookie=response.headers.getSetCookie().find(cookie=>cookie.startsWith('ig_session='));assert.match(cookie,/Secure; HttpOnly; SameSite=Lax/);return cookie.split(';')[0];
}
test('card schema is bounded data and strips code, URL, CSS and identity claims',()=>{
  const value=normalizeIdgafCard({name:'X'.repeat(100),bio:'a'.repeat(1000),skin:'url(javascript:evil)',accent:'red;position:fixed',font:'evil',radius:999,user_id:other,html:'<script>bad()</script>',client:'Discord Nitro Verified'});
  assert.equal(value.name.length,48);assert.equal(value.bio.length,320);assert.equal(value.skin,'aero-night');assert.equal(value.accent,'#68bfd5');assert.equal(value.radius,18);assert.equal(value.client,'idgafcord');assert.equal(value.user_id,undefined);assert.equal(value.html,undefined);
});
test('OAuth requires matching state before contacting Discord and stores only its own hashed session',async()=>{
  const env=environment();const wrong=await handleEcosystemRequest(request('/auth/callback?code=x&state=wrong'),env,()=>{throw Error('must not contact Discord');});assert.equal(wrong.status,400);
  const cookie=await signIn(env);assert.ok(cookie);const sessions=env.sqlite.prepare('SELECT * FROM sessions').all();assert.equal(sessions.length,1);assert.equal(sessions[0].token_hash.length,64);assert.equal(JSON.stringify(sessions).includes('fixture-oauth-token'),false);
  const me=await handleEcosystemRequest(request('/v1/me',{headers:{cookie}}),env);assert.equal((await me.json()).id,uid);
});
test('only the signed-in owner can publish; public lookups and deletion reflect that owner',async()=>{
  const env=environment(),cookie=await signIn(env);const headers={cookie,origin,'content-type':'application/json'};
  assert.equal((await handleEcosystemRequest(request('/v1/me',{method:'PUT',headers:{...headers,origin:'https://evil.test'},body:'{}'}),env)).status,403);
  const put=await handleEcosystemRequest(request('/v1/me',{method:'PUT',headers,body:JSON.stringify({user_id:other,name:'Adem',client:'Vesktop',bio:'<img src=x onerror=alert(1)>'})}),env);assert.equal(put.status,200);
  const cards=(await (await handleEcosystemRequest(request('/v1/cards?ids='+uid+','+other),env)).json()).cards;
  assert.equal(cards[uid].name,'Adem');assert.equal(cards[uid].client,'Vesktop');assert.equal(cards[other],undefined);
  assert.equal((await handleEcosystemRequest(request('/v1/me',{method:'DELETE',headers}),env)).status,200);
  assert.deepEqual((await(await handleEcosystemRequest(request('/v1/cards?ids='+uid),env)).json()).cards,{});
  assert.equal((await handleEcosystemRequest(request('/auth/logout',{method:'POST',headers}),env)).status,204);
  assert.equal((await handleEcosystemRequest(request('/v1/me',{headers:{cookie}}),env)).status,401);
});
test('unregistered and expired sessions cannot publish; bounded requests reject malformed input',async()=>{
  const env=environment();assert.equal((await handleEcosystemRequest(request('/v1/me',{method:'PUT',headers:{origin,'content-type':'application/json'},body:'{}'}),env)).status,401);
  assert.equal((await handleEcosystemRequest(request('/v1/cards?ids=not-an-id'),env)).status,400);
  assert.equal((await handleEcosystemRequest(request('/v1/cards?ids='+Array.from({length:17},(_,index)=>String(BigInt(uid)+BigInt(index))).join(',')),env)).status,400);
  const cookie=await signIn(env);assert.equal((await handleEcosystemRequest(request('/v1/me',{method:'PUT',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({bio:'x'.repeat(9000)})}),env)).status,400);
  env.sqlite.exec('UPDATE sessions SET expires_at=0');assert.equal((await handleEcosystemRequest(request('/v1/me',{headers:{cookie}}),env)).status,401);
});
