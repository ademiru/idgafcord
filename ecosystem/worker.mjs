import { normalizeIdgafCard } from '../shared/card.mjs';

const cookie = (request, name) => (request.headers.get('cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(name + '='))?.slice(name.length + 1) || '';
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const cookieValue = (name, value, age) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const redirect = (location, cookies = []) => { const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' }); cookies.forEach(value => headers.append('Set-Cookie', value)); return new Response(null, { status: 302, headers }); };
const userId = value => typeof value === 'string' && /^\d{16,22}$/.test(value);
async function session(request, env) {
  const token = cookie(request, 'ig_session'); if (!/^[\w-]{43}$/.test(token)) return null;
  return env.DB.prepare('SELECT user_id, display_name FROM sessions WHERE token_hash=? AND expires_at>?').bind(await digest(token), Date.now()).first();
}
async function body(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new Error('JSON required');
  if (Number(request.headers.get('content-length') || 0) > 8192) throw new Error('Body too large');
  const reader = request.body?.getReader(); if (!reader) throw new Error('Body required');
  const chunks = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 8192) throw new Error('Body too large'); chunks.push(value); } }
  finally { reader.cancel().catch(() => {}); }
  const data = new Uint8Array(length); let offset = 0; chunks.forEach(chunk => { data.set(chunk, offset); offset += chunk.length; });
  return JSON.parse(new TextDecoder().decode(data));
}
export async function handleEcosystemRequest(request, env, discordFetch = fetch) {
  const url = new URL(request.url), origin = env.PUBLIC_ORIGIN;
  if (!origin || new URL(origin).origin !== origin || url.origin !== origin) return json({ error: 'Unconfigured origin' }, 503);
  if (url.pathname === '/health' && request.method === 'GET') return json({ name: 'idgafcord-ecosystem', version: 1 });
  if (url.pathname === '/auth/start' && request.method === 'GET') {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({ error: 'Discord sign-in is not configured' }, 503);
    const state = random(); const authorize = new URL('https://discord.com/oauth2/authorize');
    authorize.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: origin + '/auth/callback', response_type: 'code', scope: 'identify', state }).toString();
    return redirect(authorize.href, [cookieValue('ig_state', state, 600)]);
  }
  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state'), expected = cookie(request, 'ig_state'), code = url.searchParams.get('code');
    if (!state || !/^[\w-]{43}$/.test(expected) || await digest(state) !== await digest(expected) || !code || code.length > 2048) return json({ error: 'Invalid sign-in state' }, 400);
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({ error: 'Sign-in unavailable' }, 503);
    const tokenResponse = await discordFetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: origin + '/auth/callback' }) });
    if (!tokenResponse.ok) return json({ error: 'Discord sign-in failed' }, 401);
    const token = await tokenResponse.json(); if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer' || !String(token.scope).split(' ').includes('identify')) return json({ error: 'Invalid Discord authorization' }, 401);
    const identityResponse = await discordFetch('https://discord.com/api/v10/users/@me', { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + token.access_token } });
    if (!identityResponse.ok) return json({ error: 'Could not verify identity' }, 401);
    const identity = await identityResponse.json(); if (!userId(identity.id)) return json({ error: 'Invalid identity' }, 401);
    // OAuth access/refresh tokens are never persisted or returned to the app.
    const sessionToken = random(), tokenHash = await digest(sessionToken), expires = Date.now() + 30 * 86400000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<? OR user_id=?').bind(Date.now(), identity.id),
      env.DB.prepare('INSERT INTO sessions(token_hash,user_id,display_name,expires_at) VALUES(?,?,?,?)').bind(tokenHash, identity.id, String(identity.global_name || identity.username || 'idgafcord').slice(0, 48), expires)
    ]);
    return redirect(origin + '/', [cookieValue('ig_state', '', 0), cookieValue('ig_session', sessionToken, 30 * 86400)]);
  }
  if (url.pathname === '/v1/cards' && request.method === 'GET') {
    const ids = [...new Set((url.searchParams.get('ids') || '').split(','))];
    if (ids.length > 16 || !ids.every(userId)) return json({ error: 'Request 1–16 user IDs' }, 400);
    const result = await env.DB.prepare(`SELECT user_id,card_json FROM cards WHERE user_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    const cards = Object.fromEntries(result.results.map(row => [row.user_id, normalizeIdgafCard(JSON.parse(row.card_json))]));
    return Response.json({ cards }, { headers: { 'Cache-Control': 'public, max-age=30' } });
  }
  if (url.pathname === '/v1/me' || url.pathname === '/auth/logout') {
    if (request.method !== 'GET' && request.headers.get('origin') !== origin) return json({ error: 'Invalid request origin' }, 403);
    const current = await session(request, env); if (!current) return json({ error: 'Sign in first' }, 401);
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(cookie(request, 'ig_session'))).run();
      return new Response(null, { status: 204, headers: { 'Set-Cookie': cookieValue('ig_session', '', 0), 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/v1/me' && request.method === 'GET') {
      const stored = await env.DB.prepare('SELECT card_json FROM cards WHERE user_id=?').bind(current.user_id).first();
      return json({ id: current.user_id, name: current.display_name, card: stored ? normalizeIdgafCard(JSON.parse(stored.card_json)) : null });
    }
    if (url.pathname === '/v1/me' && request.method === 'PUT') {
      let submitted; try { submitted = await body(request); } catch { return json({ error: 'Invalid card' }, 400); }
      const card = normalizeIdgafCard(submitted);
      await env.DB.prepare('INSERT INTO cards(user_id,card_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET card_json=excluded.card_json,updated_at=excluded.updated_at').bind(current.user_id, JSON.stringify(card), Date.now()).run();
      return json({ card });
    }
    if (url.pathname === '/v1/me' && request.method === 'DELETE') { await env.DB.prepare('DELETE FROM cards WHERE user_id=?').bind(current.user_id).run(); return json({ deleted: true }); }
    return json({ error: 'Method not allowed' }, 405);
  }
  if (request.method === 'GET' && ['/', '/index.html', '/app.mjs', '/card.mjs', '/card.css', '/style.css'].includes(url.pathname)) return env.ASSETS.fetch(request);
  return json({ error: 'Not found' }, 404);
}
export default { async fetch(request, env) {
  let response; try { response = await handleEcosystemRequest(request, env); } catch { response = json({ error: 'Temporarily unavailable' }, 503); }
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'no-referrer');
  return new Response(response.body, { status: response.status, headers });
} };
