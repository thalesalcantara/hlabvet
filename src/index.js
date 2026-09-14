import { authenticate, clearSessionCookie, createSession, destroySession, getUser, hashPassword, sessionCookie, setPassword, verifyPassword } from './auth.js';
import { catalogWithCodes, MATERIALS } from './catalog.js';
import { boolInt, clampString, corsHeaders, err, escapeFilename, json, normalizeUsername, nowIso, ok, parseNumber, protocolCode, randomToken, sha256, statusLabel } from './utils.js';

const ADMIN_ROLES = new Set(['admin','staff']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname.startsWith('/api/')) {
        const response = await api(request, env, url);
        const headers = new Headers(response.headers);
        Object.entries(cors).forEach(([k,v]) => headers.set(k,v));
        return new Response(response.body, { status: response.status, headers });
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return err('Erro interno do sistema.', 500, { detail: env.ENVIRONMENT === 'dev' ? String(e?.stack || e) : undefined });
    }
  }
};

async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/api/health') return ok({ app: env.APP_NAME || 'HLab Vet Resultados', time: nowIso() });
  if (path === '/api/catalog' && method === 'GET') return ok({ exams: catalogWithCodes(), materials: MATERIALS });
  if (path === '/api/setup' && method === 'POST') return setup(request, env);
  if (path === '/api/login' && method === 'POST') return login(request, env, url);
  if (path === '/api/logout' && method === 'POST') return logout(request, env, url);

  const courierMatch = path.match(/^\/api\/courier\/([^/]+)(?:\/(.*))?$/);
  if (courierMatch) return courierApi(request, env, url, decodeURIComponent(courierMatch[1]), courierMatch[2] || '');

  const user = await getUser(request, env);
  if (!user) return err('Sessão expirada ou acesso não autorizado.', 401);
  if (user.force_password_change && path !== '/api/change-password' && path !== '/api/me') {
    return err('Troque a senha inicial para continuar.', 428, { code: 'PASSWORD_CHANGE_REQUIRED' });
  }

  if (path === '/api/me' && method === 'GET') return me(env, user);
  if (path === '/api/change-password' && method === 'POST') return changePassword(request, env, user);
  if (path === '/api/dashboard' && method === 'GET') return dashboard(env, user);

  if (path === '/api/clients' && method === 'GET') return requireAdmin(user, () => listClients(env, url));
  if (path === '/api/clients' && method === 'POST') return requireAdmin(user, () => createClient(request, env, user));
  let m = path.match(/^\/api\/clients\/(\d+)$/);
  if (m && method === 'PATCH') return requireAdmin(user, () => updateClient(request, env, user, Number(m[1])));
  if (m && method === 'DELETE') return requireAdmin(user, () => deleteClient(env, user, Number(m[1])));
  m = path.match(/^\/api\/clients\/(\d+)\/reset-password$/);
  if (m && method === 'POST') return requireAdmin(user, () => resetClientPassword(request, env, user, Number(m[1])));

  if (path === '/api/my-client-profile' && method === 'GET') return getMyClientProfile(env, user);
  if (path === '/api/my-client-profile' && method === 'PATCH') return updateMyClientProfile(request, env, user);

  if (path === '/api/couriers' && method === 'GET') return requireAdmin(user, () => listCouriers(env));
  if (path === '/api/couriers' && method === 'POST') return requireAdmin(user, () => createCourier(request, env, user, url));
  m = path.match(/^\/api\/couriers\/(\d+)$/);
  if (m && method === 'PATCH') return requireAdmin(user, () => updateCourier(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/couriers\/(\d+)\/regenerate-link$/);
  if (m && method === 'POST') return requireAdmin(user, () => regenerateCourierLink(env, user, Number(m[1]), url));

  if (path === '/api/receivers' && method === 'GET') return requireAdmin(user, () => listReceivers(env));
  if (path === '/api/receivers' && method === 'POST') return requireAdmin(user, () => createReceiver(request, env, user));
  m = path.match(/^\/api\/receivers\/(\d+)$/);
  if (m && method === 'PATCH') return requireAdmin(user, () => updateReceiver(request, env, user, Number(m[1])));

  if (path === '/api/requisitions' && method === 'GET') return listRequisitions(env, user, url);
  if (path === '/api/requisitions' && method === 'POST') return createRequisition(request, env, user);
  m = path.match(/^\/api\/requisitions\/(\d+)$/);
  if (m && method === 'GET') return getRequisition(env, user, Number(m[1]));
  m = path.match(/^\/api\/requisitions\/(\d+)\/assign$/);
  if (m && method === 'POST') return requireAdmin(user, () => assignCourier(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/receive$/);
  if (m && method === 'POST') return requireAdmin(user, () => receiveAtLab(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/analysis$/);
  if (m && method === 'POST') return requireAdmin(user, () => markAnalysis(env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/complete$/);
  if (m && method === 'POST') return requireAdmin(user, () => markComplete(env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/cancel$/);
  if (m && method === 'POST') return requireAdmin(user, () => cancelRequisition(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/results$/);
  if (m && method === 'POST') return requireAdmin(user, () => uploadResult(request, env, user, Number(m[1])));

  m = path.match(/^\/api\/results\/(\d+)\/download$/);
  if (m && method === 'GET') return downloadResult(env, user, Number(m[1]));

  if (path === '/api/temperature-sheet' && method === 'GET') return temperatureSheet(env, user, url);
  if (path === '/api/audit' && method === 'GET') return requireAdmin(user, () => listAudit(env, url));

  return err('Rota não encontrada.', 404);
}

function requireAdmin(user, fn) {
  return ADMIN_ROLES.has(user.role) ? fn() : err('Acesso permitido somente ao HLab Vet.', 403);
}

async function audit(env, user, action, entityType = null, entityId = null, details = null) {
  try {
    await env.DB.prepare(`INSERT INTO audit_log(actor_user_id,actor_name,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)`)
      .bind(user?.id || null, user?.username_display || user?.name || 'Sistema', action, entityType, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null).run();
  } catch (e) { console.error('audit', e); }
}

async function setup(request, env) {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  if ((count?.n || 0) > 0) return err('A configuração inicial já foi concluída.', 409);
  const body = await safeBody(request);
  if (!body) return err('Dados inválidos.');
  if (!env.SETUP_KEY || body.setupKey !== env.SETUP_KEY) return err('Chave de configuração inválida.', 403);
  const username = clampString(body.username, 120);
  const password = String(body.password || '');
  if (!username || password.length < 8) return err('Informe usuário e senha com pelo menos 8 caracteres.');
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare(`INSERT INTO users(role,username_display,username_key,password_hash,password_salt,force_password_change,active) VALUES('admin',?,?,?,?,0,1)`)
    .bind(username, normalizeUsername(username), hash, salt).run();
  return ok({ message: 'Administrador criado. Acesse o sistema com o usuário informado.' });
}

async function login(request, env, url) {
  const body = await safeBody(request);
  const user = body && await authenticate(env, body.username, body.password);
  if (!user) return err('Usuário ou senha inválidos.', 401);
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowIso()).run();
  const session = await createSession(env, user.id);
  await audit(env, user, 'login', 'user', user.id);
  return json({ ok: true, forcePasswordChange: !!user.force_password_change, role: user.role }, 200, {
    'set-cookie': sessionCookie(session.token, session.expires, url.protocol === 'https:')
  });
}

async function logout(request, env, url) {
  const u = await getUser(request, env);
  await destroySession(request, env);
  if (u) await audit(env, u, 'logout', 'user', u.id);
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(url.protocol === 'https:') });
}

async function me(env, user) {
  let profile = null;
  if (user.role === 'client') {
    profile = await env.DB.prepare(`SELECT id,name,legal_name,document,phone,email,address,city,state,zip_code,stamp_name,stamp_line2,stamp_line3,stamp_line4,stamp_color FROM clients WHERE user_id=?`).bind(user.id).first();
  }
  return ok({ user: {
    id: user.id, role: user.role, username: user.username_display,
    forcePasswordChange: !!user.force_password_change, clientId: user.client_id || null, clientName: user.client_name || null
  }, profile });
}

async function changePassword(request, env, user) {
  const body = await safeBody(request);
  const current = String(body?.currentPassword || '');
  const next = String(body?.newPassword || '');
  const dbu = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
  if (!dbu || !await verifyPassword(current, dbu.password_hash, dbu.password_salt)) return err('Senha atual incorreta.', 400);
  if (next.length < 8) return err('A nova senha deve ter pelo menos 8 caracteres.');
  if (next === current) return err('A nova senha deve ser diferente da atual.');
  await setPassword(env, user.id, next, false);
  await audit(env, user, 'alterou_senha', 'user', user.id);
  return ok({ message: 'Senha alterada com sucesso.' });
}

async function dashboard(env, user) {
  const where = user.role === 'client' ? ' WHERE client_id=?' : '';
  const bind = user.role === 'client' ? [user.client_id] : [];
  const rows = await env.DB.prepare(`SELECT status,COUNT(*) n FROM requisitions${where} GROUP BY status`).bind(...bind).all();
  const totals = Object.fromEntries((rows.results || []).map(r => [r.status, r.n]));
  const recent = await env.DB.prepare(`
    SELECT r.id,r.protocol,r.patient_name,r.tutor_name,r.status,r.created_at,c.name client_name
    FROM requisitions r JOIN clients c ON c.id=r.client_id
    ${user.role === 'client' ? 'WHERE r.client_id=?' : ''}
    ORDER BY r.created_at DESC LIMIT 8
  `).bind(...bind).all();
  return ok({ totals, recent: recent.results || [] });
}

async function listClients(env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  const active = url.searchParams.get('active');
  let sql = `SELECT c.*,u.username_display,u.force_password_change,u.active AS user_active FROM clients c JOIN users u ON u.id=c.user_id WHERE 1=1`;
  const params = [];
  if (q) { sql += ` AND (c.name LIKE ? OR c.legal_name LIKE ? OR c.document LIKE ? OR u.username_display LIKE ?)`; params.push(...Array(4).fill(`%${q}%`)); }
  if (active === '1' || active === '0') { sql += ` AND c.active=?`; params.push(Number(active)); }
  sql += ' ORDER BY c.active DESC,c.name COLLATE NOCASE';
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return ok({ clients: rows.results || [] });
}

async function createClient(request, env, admin) {
  const b = await safeBody(request);
  const name = clampString(b?.name, 200), username = clampString(b?.username, 120), password = String(b?.password || '');
  if (!name || !username || password.length < 8) return err('Nome, usuário e senha inicial (mínimo 8 caracteres) são obrigatórios.');
  const key = normalizeUsername(username);
  const exists = await env.DB.prepare('SELECT id FROM users WHERE username_key=?').bind(key).first();
  if (exists) return err('Esse nome de usuário já existe, inclusive desconsiderando maiúsculas/minúsculas e acentos.', 409);
  const { hash, salt } = await hashPassword(password);
  const u = await env.DB.prepare(`INSERT INTO users(role,username_display,username_key,password_hash,password_salt,force_password_change,active) VALUES('client',?,?,?,?,1,1)`)
    .bind(username, key, hash, salt).run();
  const userId = u.meta.last_row_id;
  const c = await env.DB.prepare(`INSERT INTO clients(user_id,name,legal_name,document,phone,email,address,city,state,zip_code,stamp_color) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(userId,name,clampString(b.legalName,200),clampString(b.document,50),clampString(b.phone,40),clampString(b.email,200),clampString(b.address,300),clampString(b.city,120),clampString(b.state,30)||'RN',clampString(b.zipCode,20),clampString(b.stampColor,20)||'#5c2a72').run();
  await audit(env, admin, 'criou_cliente', 'client', c.meta.last_row_id, { name, username });
  return ok({ id: c.meta.last_row_id, userId, message: 'Cliente cadastrado. No primeiro acesso ele deverá trocar a senha.' });
}

async function updateClient(request, env, admin, id) {
  const b = await safeBody(request);
  const current = await env.DB.prepare(`SELECT c.*,u.id user_id,u.username_display FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id=?`).bind(id).first();
  if (!current) return err('Cliente não encontrado.', 404);
  let username = clampString(b.username ?? current.username_display,120);
  let key = normalizeUsername(username);
  const dup = await env.DB.prepare('SELECT id FROM users WHERE username_key=? AND id<>?').bind(key,current.user_id).first();
  if (dup) return err('Esse nome de usuário já está em uso.',409);
  const active = b.active == null ? current.active : boolInt(b.active);
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET username_display=?,username_key=?,active=?,updated_at=? WHERE id=?`).bind(username,key,active,nowIso(),current.user_id),
    env.DB.prepare(`UPDATE clients SET name=?,legal_name=?,document=?,phone=?,email=?,address=?,city=?,state=?,zip_code=?,active=?,updated_at=? WHERE id=?`)
      .bind(clampString(b.name ?? current.name,200),clampString(b.legalName ?? current.legal_name,200),clampString(b.document ?? current.document,50),clampString(b.phone ?? current.phone,40),clampString(b.email ?? current.email,200),clampString(b.address ?? current.address,300),clampString(b.city ?? current.city,120),clampString(b.state ?? current.state,30),clampString(b.zipCode ?? current.zip_code,20),active,nowIso(),id)
  ]);
  await audit(env,admin,'editou_cliente','client',id,{ username, active:!!active });
  return ok({ message:'Cliente atualizado.' });
}

async function deleteClient(env, admin, id) {
  const row = await env.DB.prepare('SELECT user_id,name FROM clients WHERE id=?').bind(id).first();
  if (!row) return err('Cliente não encontrado.',404);
  await env.DB.batch([
    env.DB.prepare('UPDATE clients SET active=0,updated_at=? WHERE id=?').bind(nowIso(),id),
    env.DB.prepare('UPDATE users SET active=0,updated_at=? WHERE id=?').bind(nowIso(),row.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id)
  ]);
  await audit(env,admin,'excluiu_desativou_cliente','client',id,{ name:row.name });
  return ok({ message:'Cliente desativado. O histórico de exames foi preservado.' });
}

async function resetClientPassword(request, env, admin, id) {
  const b=await safeBody(request); const pwd=String(b?.password||'');
  if(pwd.length<8) return err('A senha temporária deve ter pelo menos 8 caracteres.');
  const row=await env.DB.prepare('SELECT user_id,name FROM clients WHERE id=?').bind(id).first();
  if(!row) return err('Cliente não encontrado.',404);
  await setPassword(env,row.user_id,pwd,true);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id).run();
  await audit(env,admin,'redefiniu_senha_cliente','client',id,{name:row.name});
  return ok({message:'Senha temporária definida. O cliente deverá trocá-la no próximo login.'});
}

async function getMyClientProfile(env,user){
  if(user.role!=='client') return err('Disponível somente para cliente.',403);
  const c=await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(user.client_id).first();
  return ok({profile:c});
}

async function updateMyClientProfile(request,env,user){
  if(user.role!=='client') return err('Disponível somente para cliente.',403);
  const b=await safeBody(request); const c=await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(user.client_id).first();
  if(!c) return err('Cliente não encontrado.',404);
  await env.DB.prepare(`UPDATE clients SET stamp_name=?,stamp_line2=?,stamp_line3=?,stamp_line4=?,stamp_color=?,phone=?,email=?,updated_at=? WHERE id=?`)
    .bind(clampString(b.stampName??c.stamp_name,120),clampString(b.stampLine2??c.stamp_line2,120),clampString(b.stampLine3??c.stamp_line3,120),clampString(b.stampLine4??c.stamp_line4,120),clampString(b.stampColor??c.stamp_color,20)||'#5c2a72',clampString(b.phone??c.phone,40),clampString(b.email??c.email,200),nowIso(),user.client_id).run();
  await audit(env,user,'atualizou_carimbo','client',user.client_id);
  return ok({message:'Carimbo e dados de contato atualizados.'});
}

async function listCouriers(env){
  const rows=await env.DB.prepare('SELECT id,name,phone,token_last4,active,created_at,updated_at FROM couriers ORDER BY active DESC,name COLLATE NOCASE').all();
  return ok({couriers:rows.results||[]});
}

async function createCourier(request,env,user,url){
  const b=await safeBody(request); const name=clampString(b?.name,160); if(!name) return err('Informe o nome do entregador.');
  const token=randomToken(30), hash=await sha256(token);
  const r=await env.DB.prepare('INSERT INTO couriers(name,phone,token_hash,token_last4,active) VALUES(?,?,?,?,1)').bind(name,clampString(b.phone,40),hash,token.slice(-4)).run();
  await audit(env,user,'criou_entregador','courier',r.meta.last_row_id,{name});
  return ok({id:r.meta.last_row_id,link:courierLink(url,token),message:'Entregador cadastrado. Copie e guarde o link privado.'});
}

async function updateCourier(request,env,user,id){
  const b=await safeBody(request); const c=await env.DB.prepare('SELECT * FROM couriers WHERE id=?').bind(id).first(); if(!c)return err('Entregador não encontrado.',404);
  await env.DB.prepare('UPDATE couriers SET name=?,phone=?,active=?,updated_at=? WHERE id=?').bind(clampString(b.name??c.name,160),clampString(b.phone??c.phone,40),b.active==null?c.active:boolInt(b.active),nowIso(),id).run();
  await audit(env,user,'editou_entregador','courier',id); return ok({message:'Entregador atualizado.'});
}

async function regenerateCourierLink(env,user,id,url){
  const c=await env.DB.prepare('SELECT id,name FROM couriers WHERE id=?').bind(id).first(); if(!c)return err('Entregador não encontrado.',404);
  const token=randomToken(30), hash=await sha256(token);
  await env.DB.prepare('UPDATE couriers SET token_hash=?,token_last4=?,updated_at=? WHERE id=?').bind(hash,token.slice(-4),nowIso(),id).run();
  await audit(env,user,'regenerou_link_entregador','courier',id);
  return ok({link:courierLink(url,token),message:'Novo link criado. O link anterior deixou de funcionar.'});
}
function courierLink(url,token){return `${url.origin}/?entregador=${encodeURIComponent(token)}`;}

async function listReceivers(env){ const rows=await env.DB.prepare('SELECT * FROM receivers ORDER BY active DESC,name COLLATE NOCASE').all(); return ok({receivers:rows.results||[]}); }
async function createReceiver(request,env,user){const b=await safeBody(request);const name=clampString(b?.name,160);if(!name)return err('Informe o nome de quem recebe.');const r=await env.DB.prepare('INSERT INTO receivers(name,location,active) VALUES(?,?,1)').bind(name,clampString(b.location,200)).run();await audit(env,user,'criou_recebedor','receiver',r.meta.last_row_id,{name});return ok({id:r.meta.last_row_id,message:'Recebedor cadastrado.'});}
async function updateReceiver(request,env,user,id){const b=await safeBody(request),r=await env.DB.prepare('SELECT * FROM receivers WHERE id=?').bind(id).first();if(!r)return err('Recebedor não encontrado.',404);await env.DB.prepare('UPDATE receivers SET name=?,location=?,active=?,updated_at=? WHERE id=?').bind(clampString(b.name??r.name,160),clampString(b.location??r.location,200),b.active==null?r.active:boolInt(b.active),nowIso(),id).run();await audit(env,user,'editou_recebedor','receiver',id);return ok({message:'Recebedor atualizado.'});}

async function listRequisitions(env,user,url){
  const filters={q:url.searchParams.get('q'),status:url.searchParams.get('status'),from:url.searchParams.get('from'),to:url.searchParams.get('to'),patient:url.searchParams.get('patient'),tutor:url.searchParams.get('tutor'),birth:url.searchParams.get('birth'),breed:url.searchParams.get('breed'),clientId:url.searchParams.get('clientId')};
  let sql=`SELECT r.id,r.protocol,r.status,r.patient_name,r.species,r.breed,r.birth_date,r.tutor_name,r.created_at,r.collection_date,r.assigned_at,r.collected_at,r.collection_temperature,r.lab_received_at,r.lab_received_temperature,r.analysis_started_at,r.completed_at,c.name client_name,co.name courier_name FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE 1=1`;
  const p=[];
  if(user.role==='client'){sql+=' AND r.client_id=?';p.push(user.client_id);} else if(filters.clientId){sql+=' AND r.client_id=?';p.push(Number(filters.clientId));}
  if(filters.status){sql+=' AND r.status=?';p.push(filters.status);}
  if(filters.from){sql+=' AND date(r.created_at)>=date(?)';p.push(filters.from);}
  if(filters.to){sql+=' AND date(r.created_at)<=date(?)';p.push(filters.to);}
  if(filters.patient){sql+=' AND r.patient_name LIKE ?';p.push(`%${filters.patient}%`);}
  if(filters.tutor){sql+=' AND r.tutor_name LIKE ?';p.push(`%${filters.tutor}%`);}
  if(filters.birth){sql+=' AND r.birth_date=?';p.push(filters.birth);}
  if(filters.breed){sql+=' AND r.breed LIKE ?';p.push(`%${filters.breed}%`);}
  if(filters.q){sql+=` AND (r.protocol LIKE ? OR r.patient_name LIKE ? OR r.tutor_name LIKE ? OR r.breed LIKE ? OR r.species LIKE ? OR r.sex LIKE ? OR r.clinic_name LIKE ? OR r.veterinarian_name LIKE ? OR r.crmv LIKE ? OR r.age_text LIKE ? OR r.clinical_info LIKE ? OR r.material_other LIKE ? OR c.name LIKE ? OR EXISTS(SELECT 1 FROM requisition_exams e WHERE e.requisition_id=r.id AND e.exam_name LIKE ?) OR EXISTS(SELECT 1 FROM requisition_materials m WHERE m.requisition_id=r.id AND m.material_name LIKE ?))`;p.push(...Array(15).fill(`%${filters.q}%`));}
  sql+=' ORDER BY r.created_at DESC LIMIT 500';
  const rows=await env.DB.prepare(sql).bind(...p).all(); return ok({requisitions:rows.results||[]});
}

async function createRequisition(request,env,user){
  const b=await safeBody(request); if(!b) return err('Dados inválidos.');
  let clientId=user.role==='client'?user.client_id:Number(b.clientId);
  if(!clientId) return err('Cliente não informado.');
  if(user.role!=='client'&&!ADMIN_ROLES.has(user.role)) return err('Sem permissão.',403);
  const client=await env.DB.prepare('SELECT * FROM clients WHERE id=? AND active=1').bind(clientId).first(); if(!client)return err('Cliente não encontrado ou inativo.',404);
  const patient=clampString(b.patientName,160); if(!patient)return err('Nome do paciente é obrigatório.');
  const exams=Array.isArray(b.exams)?b.exams:[]; if(!exams.length)return err('Marque pelo menos um exame.');
  const catalog=new Map(); for(const g of catalogWithCodes()) for(const e of g.items) catalog.set(e.code,{...e,category:g.category});
  const selected=[]; for(const code of exams){const e=catalog.get(String(code));if(e)selected.push(e);} if(!selected.length)return err('Nenhum exame válido foi selecionado.');
  const materials=Array.isArray(b.materials)?b.materials.filter(x=>MATERIALS.includes(x)):[];
  const stamp={name:client.stamp_name,line2:client.stamp_line2,line3:client.stamp_line3,line4:client.stamp_line4,color:client.stamp_color};
  const tempProto=`TEMP-${crypto.randomUUID()}`;
  const ins=await env.DB.prepare(`INSERT INTO requisitions(protocol,client_id,status,clinic_name,veterinarian_name,crmv,tutor_name,patient_name,species,breed,sex,birth_date,age_text,collection_date,clinical_info,material_other,stamp_snapshot_json,observations) VALUES(?,?,'solicitado',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(tempProto,clientId,clampString(b.clinicName,200)||client.name,clampString(b.veterinarianName,160),clampString(b.crmv,80),clampString(b.tutorName,160),patient,clampString(b.species,100),clampString(b.breed,120),clampString(b.sex,20),clampString(b.birthDate,20),clampString(b.ageText,60),clampString(b.collectionDate,20),clampString(b.clinicalInfo,5000),clampString(b.materialOther,500),JSON.stringify(stamp),clampString(b.observations,2000)).run();
  const id=ins.meta.last_row_id, proto=protocolCode(id,new Date());
  const statements=[env.DB.prepare('UPDATE requisitions SET protocol=? WHERE id=?').bind(proto,id)];
  for(const e of selected) statements.push(env.DB.prepare('INSERT INTO requisition_exams(requisition_id,category,exam_code,exam_name) VALUES(?,?,?,?)').bind(id,e.category,e.code,e.name));
  for(const m of materials) statements.push(env.DB.prepare('INSERT INTO requisition_materials(requisition_id,material_code,material_name) VALUES(?,?,?)').bind(id,m.toLowerCase().replace(/\s+/g,'_'),m));
  statements.push(env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json) VALUES(?,'solicitado',?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({message:'Requisição enviada ao HLab Vet'})));
  await env.DB.batch(statements); await audit(env,user,'criou_requisicao','requisition',id,{protocol:proto,patient});
  return ok({id,protocol:proto,message:'Solicitação enviada ao HLab Vet.'});
}

async function canSeeReq(env,user,id){
  const r=await env.DB.prepare('SELECT id,client_id FROM requisitions WHERE id=?').bind(id).first();
  if(!r)return null; if(ADMIN_ROLES.has(user.role)|| (user.role==='client'&&r.client_id===user.client_id))return r; return false;
}

async function getRequisition(env,user,id){
  const allowed=await canSeeReq(env,user,id); if(allowed===null)return err('Requisição não encontrada.',404); if(!allowed)return err('Sem acesso a essa requisição.',403);
  const r=await env.DB.prepare(`SELECT r.*,c.name client_name,c.address client_address,c.city client_city,c.state client_state,c.phone client_phone,co.name courier_name FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE r.id=?`).bind(id).first();
  const [ex,mat,events,files]=await Promise.all([
    env.DB.prepare('SELECT category,exam_code,exam_name FROM requisition_exams WHERE requisition_id=? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT material_name FROM requisition_materials WHERE requisition_id=? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT status,actor_name,details_json,created_at FROM status_events WHERE requisition_id=? ORDER BY created_at,id').bind(id).all(),
    env.DB.prepare('SELECT id,original_name,mime_type,size_bytes,created_at FROM result_files WHERE requisition_id=? ORDER BY created_at DESC').bind(id).all()
  ]);
  return ok({requisition:r,exams:ex.results||[],materials:(mat.results||[]).map(x=>x.material_name),events:(events.results||[]).map(e=>({...e,details:parseJson(e.details_json)})),files:files.results||[]});
}

async function assignCourier(request,env,user,id){
  const b=await safeBody(request); const courierId=Number(b?.courierId); if(!courierId)return err('Selecione o entregador.');
  const [r,c]=await Promise.all([env.DB.prepare('SELECT * FROM requisitions WHERE id=?').bind(id).first(),env.DB.prepare('SELECT * FROM couriers WHERE id=? AND active=1').bind(courierId).first()]);
  if(!r)return err('Requisição não encontrada.',404); if(!c)return err('Entregador não encontrado ou inativo.',404); if(['recebido','em_analise','concluido','cancelado'].includes(r.status))return err('Não é possível atribuir entregador nesse status.');
  const ts=nowIso(); await env.DB.batch([
    env.DB.prepare(`UPDATE requisitions SET assigned_courier_id=?,assigned_at=?,status='atribuido',updated_at=? WHERE id=?`).bind(courierId,ts,ts,id),
    env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'atribuido',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({courier:c.name}),ts)
  ]);
  await audit(env,user,'atribuiu_entregador','requisition',id,{courierId,courier:c.name});return ok({message:`${c.name} atribuído à coleta.`});
}

async function receiveAtLab(request,env,user,id){
  const b=await safeBody(request),temp=parseNumber(b?.temperature),receiverId=Number(b?.receiverId);
  if(temp==null)return err('Informe a temperatura de recebimento.'); if(!receiverId)return err('Selecione quem recebeu.');
  const [r,rec]=await Promise.all([env.DB.prepare('SELECT * FROM requisitions WHERE id=?').bind(id).first(),env.DB.prepare('SELECT * FROM receivers WHERE id=? AND active=1').bind(receiverId).first()]);
  if(!r)return err('Requisição não encontrada.',404); if(!rec)return err('Recebedor não encontrado.',404); if(r.status!=='coletado')return err('A requisição precisa estar marcada como coletada pelo entregador antes do recebimento.');
  const ts=nowIso(),loc=clampString(b.location,200)||rec.location||'HLab Vet';
  await env.DB.batch([
    env.DB.prepare(`UPDATE requisitions SET status='recebido',lab_received_at=?,lab_received_temperature=?,receiver_id=?,receiver_name=?,received_location=?,updated_at=? WHERE id=?`).bind(ts,temp,receiverId,rec.name,loc,ts,id),
    env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'recebido',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({temperature:temp,receiver:rec.name,location:loc}),ts)
  ]);
  await audit(env,user,'recebeu_amostra','requisition',id,{temperature:temp,receiver:rec.name,location:loc});return ok({message:'Recebimento registrado com data e hora automáticas.'});
}

async function markAnalysis(env,user,id){
  const r=await env.DB.prepare('SELECT status FROM requisitions WHERE id=?').bind(id).first(); if(!r)return err('Requisição não encontrada.',404);if(!['recebido','em_analise'].includes(r.status))return err('O exame deve estar recebido pelo laboratório.');
  const ts=nowIso();await env.DB.batch([env.DB.prepare(`UPDATE requisitions SET status='em_analise',analysis_started_at=COALESCE(analysis_started_at,?),updated_at=? WHERE id=?`).bind(ts,ts,id),env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'em_analise',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({message:'Amostra em análise'}),ts)]);await audit(env,user,'iniciou_analise','requisition',id);return ok({message:'Status alterado para Em análise.'});
}
async function markComplete(env,user,id){const r=await env.DB.prepare('SELECT status FROM requisitions WHERE id=?').bind(id).first();if(!r)return err('Requisição não encontrada.',404);if(!['recebido','em_analise','concluido'].includes(r.status))return err('Não é possível concluir nesse status.');const ts=nowIso();await env.DB.batch([env.DB.prepare(`UPDATE requisitions SET status='concluido',completed_at=?,updated_at=? WHERE id=?`).bind(ts,ts,id),env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'concluido',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({message:'Exame concluído'}),ts)]);await audit(env,user,'concluiu_exame','requisition',id);return ok({message:'Exame concluído.'});}
async function cancelRequisition(request,env,user,id){const b=await safeBody(request);const r=await env.DB.prepare('SELECT status FROM requisitions WHERE id=?').bind(id).first();if(!r)return err('Requisição não encontrada.',404);if(r.status==='concluido')return err('Exame concluído não pode ser cancelado.');const reason=clampString(b?.reason,1000)||'Cancelado pelo HLab Vet',ts=nowIso();await env.DB.batch([env.DB.prepare(`UPDATE requisitions SET status='cancelado',cancellation_reason=?,updated_at=? WHERE id=?`).bind(reason,ts,id),env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'cancelado',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({reason}),ts)]);await audit(env,user,'cancelou_requisicao','requisition',id,{reason});return ok({message:'Requisição cancelada.'});}

async function uploadResult(request,env,user,id){
  const r=await env.DB.prepare('SELECT id,protocol FROM requisitions WHERE id=?').bind(id).first(); if(!r)return err('Requisição não encontrada.',404);
  const form=await request.formData(); const file=form.get('file'); if(!(file instanceof File)||file.size===0)return err('Selecione um arquivo.');
  if(file.size>25*1024*1024)return err('O arquivo excede o limite de 25 MB.');
  const safe=escapeFilename(file.name), key=`results/${id}/${Date.now()}-${crypto.randomUUID()}-${safe}`;
  await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'},customMetadata:{originalName:safe,requisitionId:String(id)}});
  const ins=await env.DB.prepare('INSERT INTO result_files(requisition_id,r2_key,original_name,mime_type,size_bytes,uploaded_by_user_id) VALUES(?,?,?,?,?,?)').bind(id,key,safe,file.type||'application/octet-stream',file.size,user.id).run();
  await audit(env,user,'enviou_resultado','requisition',id,{file:safe,fileId:ins.meta.last_row_id});return ok({id:ins.meta.last_row_id,message:'Resultado enviado. O cliente já pode visualizar e baixar.'});
}

async function downloadResult(env,user,fileId){
  const f=await env.DB.prepare(`SELECT f.*,r.client_id FROM result_files f JOIN requisitions r ON r.id=f.requisition_id WHERE f.id=?`).bind(fileId).first(); if(!f)return err('Arquivo não encontrado.',404);
  if(!ADMIN_ROLES.has(user.role)&&!(user.role==='client'&&f.client_id===user.client_id))return err('Sem acesso a esse arquivo.',403);
  const obj=await env.FILES.get(f.r2_key); if(!obj)return err('Arquivo não encontrado no armazenamento.',404);
  const h=new Headers(); obj.writeHttpMetadata(h); h.set('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`); h.set('cache-control','private, no-store'); return new Response(obj.body,{headers:h});
}

async function temperatureSheet(env,user,url){
  const month=url.searchParams.get('month')||new Date().toISOString().slice(0,7); const clientId=user.role==='client'?user.client_id:Number(url.searchParams.get('clientId')||0); const courierId=Number(url.searchParams.get('courierId')||0);
  let sql=`SELECT r.id,r.protocol,r.created_at,r.collection_date,r.collected_at,r.collection_temperature,r.sent_from_location,r.sent_by_name,r.lab_received_at,r.lab_received_temperature,r.received_location,r.receiver_name,r.observations,r.patient_name,c.name client_name,co.name courier_name FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE COALESCE(substr(r.collected_at,1,7),substr(r.created_at,1,7))=?`;
  const p=[month]; if(clientId){sql+=' AND r.client_id=?';p.push(clientId);} if(courierId&&ADMIN_ROLES.has(user.role)){sql+=' AND r.assigned_courier_id=?';p.push(courierId);} sql+=' ORDER BY COALESCE(r.collected_at,r.created_at),r.id';
  const rows=await env.DB.prepare(sql).bind(...p).all(); return ok({month,entries:rows.results||[]});
}

async function listAudit(env,url){const limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit')||200)));const rows=await env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').bind(limit).all();return ok({events:(rows.results||[]).map(x=>({...x,details:parseJson(x.details_json)}))});}

async function courierApi(request,env,url,token,rest){
  const hash=await sha256(token), courier=await env.DB.prepare('SELECT id,name,phone,active FROM couriers WHERE token_hash=?').bind(hash).first(); if(!courier||!courier.active)return err('Link de entregador inválido ou desativado.',403);
  const method=request.method.toUpperCase();
  if((rest===''||rest==='tasks')&&method==='GET'){
    const from=url.searchParams.get('from'),to=url.searchParams.get('to'),tab=url.searchParams.get('tab')||'pending';
    let sql=`SELECT r.id,r.protocol,r.status,r.patient_name,r.species,r.tutor_name,r.created_at,r.assigned_at,r.collected_at,r.collection_temperature,r.sent_by_name,r.sent_from_location,c.name client_name,c.address,c.city,c.state,c.phone FROM requisitions r JOIN clients c ON c.id=r.client_id WHERE r.assigned_courier_id=?`;
    const p=[courier.id]; if(tab==='collected')sql+=` AND r.status IN ('coletado','recebido','em_analise','concluido')`; else sql+=` AND r.status='atribuido'`; if(from){sql+=' AND date(COALESCE(r.collected_at,r.assigned_at,r.created_at))>=date(?)';p.push(from);} if(to){sql+=' AND date(COALESCE(r.collected_at,r.assigned_at,r.created_at))<=date(?)';p.push(to);} sql+=' ORDER BY COALESCE(r.assigned_at,r.created_at) DESC';
    const rows=await env.DB.prepare(sql).bind(...p).all(); return ok({courier,tasks:rows.results||[]});
  }
  const m=rest.match(/^requisitions\/(\d+)\/collect$/); if(m&&method==='POST'){
    const id=Number(m[1]),b=await safeBody(request),temp=parseNumber(b?.temperature); if(temp==null)return err('Informe a temperatura da coleta.');
    const r=await env.DB.prepare(`SELECT r.*,c.name client_name,c.address,c.city,c.state FROM requisitions r JOIN clients c ON c.id=r.client_id WHERE r.id=? AND r.assigned_courier_id=?`).bind(id,courier.id).first(); if(!r)return err('Coleta não encontrada para este entregador.',404);if(r.status!=='atribuido')return err('Essa coleta já foi movimentada ou não está pendente.');
    const ts=nowIso(),sentBy=clampString(b.sentByName,160)||'Responsável no local',loc=clampString(b.sentFromLocation,250)||[r.address,r.city,r.state].filter(Boolean).join(', ');
    await env.DB.batch([env.DB.prepare(`UPDATE requisitions SET status='coletado',collected_at=?,collection_temperature=?,sent_by_name=?,sent_from_location=?,updated_at=? WHERE id=?`).bind(ts,temp,sentBy,loc,ts,id),env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'coletado',NULL,?,?,?)`).bind(id,courier.name,JSON.stringify({temperature:temp,sentBy,location:loc}),ts)]);
    await audit(env,{name:courier.name},'coletou_amostra','requisition',id,{temperature:temp,sentBy,location:loc}); return ok({message:'Coleta registrada. O item foi movido para o histórico de coletados.',collectedAt:ts});
  }
  return err('Rota de entregador não encontrada.',404);
}

async function safeBody(request){try{return await request.json();}catch{return null;}}
function parseJson(s){try{return s?JSON.parse(s):null;}catch{return null;}}
