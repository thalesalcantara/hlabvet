const enc = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function ok(data = {}) { return json({ ok: true, ...data }); }
export function err(message, status = 400, extra = {}) { return json({ ok: false, error: message, ...extra }, status); }

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

export function normalizeUsername(value = '') {
  return String(value)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ');
}

export function nowIso() { return new Date().toISOString(); }

export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

export function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return base64url(new Uint8Array(digest));
}

export function escapeFilename(name = 'arquivo') {
  return String(name).replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'arquivo';
}

export function protocolCode(id, date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `HLV-${y}${m}${d}-${String(id).padStart(6, '0')}`;
}

export function clampString(v, max = 5000) {
  if (v == null) return null;
  return String(v).trim().slice(0, max);
}

export function parseNumber(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function boolInt(v) { return v ? 1 : 0; }

export function statusLabel(status) {
  return ({
    solicitado: 'Solicitado',
    atribuido: 'Entregador atribuído',
    coletado: 'Coletado',
    recebido: 'Recebido pelo laboratório',
    em_analise: 'Em análise',
    concluido: 'Concluído',
    cancelado: 'Cancelado',
  })[status] || status;
}

export function corsHeaders(request) {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'vary': 'Origin',
  };
}
