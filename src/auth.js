import { randomToken, sha256, normalizeUsername, nowIso } from './utils.js';

const enc = new TextEncoder();

function fromB64Url(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(b64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function toB64Url(bytes) {
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function hashPassword(password, saltB64 = null) {
  const salt = saltB64 ? fromB64Url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key,
    256,
  );
  return { hash: toB64Url(new Uint8Array(bits)), salt: toB64Url(salt) };
}

export async function verifyPassword(password, hash, salt) {
  const v = await hashPassword(password, salt);
  if (v.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= v.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function cookieToken(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)hlab_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function createSession(env, userId) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const days = Math.max(1, Number(env.SESSION_DAYS || 14));
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(tokenHash, userId, expires).run();
  return { token, expires };
}

export function sessionCookie(token, expires, secure = true) {
  return `hlab_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure ? '; Secure' : ''}`;
}
export function clearSessionCookie(secure = true) {
  return `hlab_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function getUser(request, env) {
  const token = cookieToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id,u.role,u.username_display,u.username_key,u.force_password_change,u.active,s.expires_at,
           c.id AS client_id,c.name AS client_name,c.active AS client_active,
           cm.id AS client_member_id,cm.name AS client_member_name,
           COALESCE(cm.can_manage_users,0) AS can_manage_client_users,
           COALESCE(cm.is_technician,0) AS client_is_technician,
           cm.function_title,cm.council_name,cm.council_number,cm.council_state,cm.stamp_color AS member_stamp_color,
           t.id AS tutor_id,t.client_id AS tutor_client_id,t.name AS tutor_name,t.document AS tutor_document,
           t.phone AS tutor_phone,t.email AS tutor_email,t.active AS tutor_active,
           cr.id AS courier_id,cr.name AS courier_name,cr.phone AS courier_phone,
           cr.thermometer_code AS courier_thermometer_code,cr.active AS courier_active
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    LEFT JOIN client_members cm ON cm.user_id=u.id AND cm.active=1
    LEFT JOIN clients c ON c.id=COALESCE(cm.client_id,(SELECT c2.id FROM clients c2 WHERE c2.user_id=u.id LIMIT 1))
    LEFT JOIN tutors t ON t.user_id=u.id
    LEFT JOIN couriers cr ON cr.user_id=u.id
    WHERE s.token_hash=?
  `).bind(tokenHash).first();
  if (!row) return null;
  const isTutor = !!row.tutor_id;
  const isCourier = !!row.courier_id;
  const invalidClient = row.role === 'client' && !isTutor && (!row.client_id || Number(row.client_active) !== 1);
  const invalidTutor = isTutor && Number(row.tutor_active) !== 1;
  const invalidCourier = isCourier && Number(row.courier_active) !== 1;
  if (!row.active || invalidClient || invalidTutor || invalidCourier || new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash).run();
    return null;
  }
  if (isTutor) row.role = 'tutor';
  else if (isCourier) row.role = 'courier';
  return row;
}

export async function destroySession(request, env) {
  const token = cookieToken(request);
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
}

export async function authenticate(env, username, password) {
  const key = normalizeUsername(username);
  const user = await env.DB.prepare('SELECT * FROM users WHERE username_key=?').bind(key).first();
  if (!user || !user.active) return null;
  if (!await verifyPassword(String(password || ''), user.password_hash, user.password_salt)) return null;
  return user;
}

export async function setPassword(env, userId, password, forceChange = false) {
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,force_password_change=?,updated_at=? WHERE id=?`)
    .bind(hash, salt, forceChange ? 1 : 0, nowIso(), userId).run();
}
