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
  if (path === '/api/login' && method === 'POST') return login(request, env, url);
  if (path === '/api/logout' && method === 'POST') return logout(request, env, url);

  const courierMatch = path.match(/^\/api\/courier\/([^/]+)(?:\/(.*))?$/);
  if (courierMatch) return courierApi(request, env, url, decodeURIComponent(courierMatch[1]), courierMatch[2] || '');

  const user = await getUser(request, env);
  if (!user) return err('Sessão expirada ou acesso não autorizado.', 401);
  if (user.force_password_change && path !== '/api/change-password' && path !== '/api/me') {
    return err('Troque a senha inicial para continuar.', 428, { code: 'PASSWORD_CHANGE_REQUIRED' });
  }

  let m;
  if (path === '/api/me' && method === 'GET') return me(env, user);
  if (path === '/api/change-password' && method === 'POST') return changePassword(request, env, user);
  if (path === '/api/dashboard' && method === 'GET') return dashboard(env, user);
  if (path === '/api/alerts' && method === 'GET') return requireAdmin(user, () => pendingAlerts(env, user));
  m = path.match(/^\/api\/alerts\/(\d+)\/ack$/);
  if (m && method === 'POST') return requireAdmin(user, () => acknowledgeAlert(env, user, Number(m[1])));

  if (path === '/api/clients' && method === 'GET') return requireAdmin(user, () => listClients(env, url));
  if (path === '/api/clients' && method === 'POST') return requireAdminOnly(user, () => createClient(request, env, user));
  m = path.match(/^\/api\/clients\/(\d+)$/);
  if (m && method === 'PATCH') return requireAdminOnly(user, () => updateClient(request, env, user, Number(m[1])));
  if (m && method === 'DELETE') return requireAdminOnly(user, () => deleteClient(env, user, Number(m[1])));
  m = path.match(/^\/api\/clients\/(\d+)\/reset-password$/);
  if (m && method === 'POST') return requireAdminOnly(user, () => resetClientPassword(request, env, user, Number(m[1])));

  if (path === '/api/my-client-profile' && method === 'GET') return getMyClientProfile(env, user);
  if (path === '/api/my-client-profile' && method === 'PATCH') return updateMyClientProfile(request, env, user);

  if (path === '/api/client-users' && method === 'GET') return requireClientManager(user, () => listClientUsers(env, user));
  if (path === '/api/client-users' && method === 'POST') return requireClientManager(user, () => createClientUser(request, env, user));
  m = path.match(/^\/api\/client-users\/(\d+)$/);
  if (m && method === 'PATCH') return requireClientManager(user, () => updateClientUser(request, env, user, Number(m[1])));
  if (m && method === 'DELETE') return requireClientManager(user, () => deleteClientUser(env, user, Number(m[1])));
  m = path.match(/^\/api\/client-users\/(\d+)\/reset-password$/);
  if (m && method === 'POST') return requireClientManager(user, () => resetClientUserPassword(request, env, user, Number(m[1])));

  if (path === '/api/tutors' && method === 'GET') return requireClient(user, () => listTutors(env, user));
  if (path === '/api/tutors' && method === 'POST') return requireClient(user, () => createTutor(request, env, user));
  m = path.match(/^\/api\/tutors\/(\d+)$/);
  if (m && method === 'PATCH') return requireClientManager(user, () => updateTutor(request, env, user, Number(m[1])));
  if (m && method === 'DELETE') return requireClientManager(user, () => deleteTutor(env, user, Number(m[1])));
  m = path.match(/^\/api\/tutors\/(\d+)\/reset-password$/);
  if (m && method === 'POST') return requireClientManager(user, () => resetTutorPassword(request, env, user, Number(m[1])));

  if (path === '/api/tutor/results' && method === 'GET') return requireTutor(user, () => tutorResults(env, user));
  m = path.match(/^\/api\/tutor\/results\/(\d+)$/);
  if (m && method === 'GET') return requireTutor(user, () => tutorResultDetail(env, user, Number(m[1])));

  if (path === '/api/couriers' && method === 'GET') return requireAdmin(user, () => listCouriers(env));
  if (path === '/api/couriers' && method === 'POST') return requireAdminOnly(user, () => createCourier(request, env, user, url));
  m = path.match(/^\/api\/couriers\/(\d+)$/);
  if (m && method === 'PATCH') return requireAdminOnly(user, () => updateCourier(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/couriers\/(\d+)\/regenerate-link$/);
  if (m && method === 'POST') return requireAdminOnly(user, () => regenerateCourierLink(env, user, Number(m[1]), url));

  if ((path === '/api/technicians' || path === '/api/receivers') && method === 'GET') return requireAdmin(user, () => listReceivers(env));
  if ((path === '/api/technicians' || path === '/api/receivers') && method === 'POST') return requireAdminOnly(user, () => createReceiver(request, env, user));
  m = path.match(/^\/api\/(?:technicians|receivers)\/(\d+)$/);
  if (m && method === 'PATCH') return requireAdminOnly(user, () => updateReceiver(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/technicians\/(\d+)\/reset-password$/);
  if (m && method === 'POST') return requireAdminOnly(user, () => resetTechnicianPassword(request, env, user, Number(m[1])));

  if (path === '/api/requisitions' && method === 'GET') return listRequisitions(env, user, url);
  if (path === '/api/requisitions' && method === 'POST') return createRequisition(request, env, user);
  m = path.match(/^\/api\/requisitions\/(\d+)$/);
  if (m && method === 'GET') return getRequisition(env, user, Number(m[1]));
  m = path.match(/^\/api\/requisitions\/(\d+)\/exams\/(\d+)$/);
  if (m && method === 'DELETE') return deleteRequisitionExam(env, user, Number(m[1]), Number(m[2]));
  m = path.match(/^\/api\/requisitions\/(\d+)\/accept$/);
  if (m && method === 'POST') return requireAdmin(user, () => acceptRequisition(env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/assign$/);
  if (m && method === 'POST') return requireAdmin(user, () => assignCourier(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/receive$/);
  if (m && method === 'POST') return requireAdmin(user, () => receiveAtLab(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/analysis$/);
  if (m && method === 'POST') return requireAdmin(user, () => markAnalysis(env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/complete$/);
  if (m && method === 'POST') return requireAdmin(user, () => markComplete(env, user, Number(m[1])));
  m = path.match(/^\/api\/requisitions\/(\d+)\/cancel$/);
  if (m && method === 'POST') return cancelRequisition(request, env, user, Number(m[1]));
  m = path.match(/^\/api\/requisitions\/(\d+)\/results$/);
  if (m && method === 'POST') return requireAdmin(user, () => uploadResult(request, env, user, Number(m[1])));

  m = path.match(/^\/api\/results\/(\d+)\/(download|view)$/);
  if (m && method === 'GET') return downloadResult(env, user, Number(m[1]), m[2] === 'view');
  m = path.match(/^\/api\/results\/(\d+)$/);
  if (m && method === 'DELETE') return requireAdmin(user, () => deleteResult(env, user, Number(m[1])));

  if (path === '/api/temperature-sheet' && method === 'GET') return requireAdmin(user, () => temperatureSheet(env, user, url));
  if (path === '/api/cancellations' && method === 'GET') return requireAdmin(user, () => listCancellations(env, url));
  if (path === '/api/prices' && method === 'GET') return requireAdminOnly(user, () => listPrices(env, url));
  if (path === '/api/prices/general' && method === 'POST') return requireAdminOnly(user, () => setGeneralPrice(request, env, user));
  if (path === '/api/prices/client' && method === 'POST') return requireAdminOnly(user, () => setClientPrice(request, env, user));
  if (path === '/api/finance/clients' && method === 'GET') return requireAdminOnly(user, () => financeClients(env, url));
  if (path === '/api/finance/report' && method === 'GET') return requireAdminOnly(user, () => financeReport(env, url));
  if (path === '/api/audit' && method === 'GET') return requireAdminOnly(user, () => listAudit(env, url));

  return err('Rota não encontrada.', 404);
}

function requireAdmin(user, fn) {
  return ADMIN_ROLES.has(user.role) ? fn() : err('Acesso permitido somente ao HLab Vet.', 403);
}
function requireAdminOnly(user, fn) {
  return user.role === 'admin' ? fn() : err('Acesso permitido somente ao administrador central do HLab Vet.', 403);
}

function requireClient(user, fn) {
  return user.role === 'client' ? fn() : err('Acesso permitido somente ao cliente.', 403);
}
function requireClientManager(user, fn) {
  return user.role === 'client' && Number(user.can_manage_client_users) === 1
    ? fn()
    : err('Somente o usuário principal do cliente pode administrar usuários, técnicos e tutores.', 403);
}
function requireTutor(user, fn) {
  return user.role === 'tutor' ? fn() : err('Acesso permitido somente ao tutor / cliente final.', 403);
}

async function audit(env, user, action, entityType = null, entityId = null, details = null) {
  try {
    await env.DB.prepare(`INSERT INTO audit_log(actor_user_id,actor_name,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)`)
      .bind(user?.id || null, user?.username_display || user?.name || 'Sistema', action, entityType, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null).run();
  } catch (e) { console.error('audit', e); }
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
  let technician = null;
  let clientMember = null;
  let tutorProfile = null;
  if (user.role === 'client') {
    profile = await env.DB.prepare(`SELECT id,name,legal_name,document,phone,email,address,city,state,zip_code,active FROM clients WHERE id=?`).bind(user.client_id).first();
    clientMember = await env.DB.prepare(`SELECT id,name,can_manage_users,is_technician,function_title,council_name,council_number,council_state,stamp_color,active FROM client_members WHERE user_id=?`).bind(user.id).first();
  } else if (user.role === 'staff') {
    technician = await env.DB.prepare(`SELECT id,name,location,active FROM receivers WHERE user_id=?`).bind(user.id).first();
  } else if (user.role === 'tutor') {
    tutorProfile = await env.DB.prepare(`SELECT t.id,t.client_id,t.name,t.document,t.phone,t.email,t.active,c.name AS client_name FROM tutors t JOIN clients c ON c.id=t.client_id WHERE t.id=?`).bind(user.tutor_id).first();
  }
  return ok({ user: {
    id: user.id, role: user.role, username: user.username_display,
    forcePasswordChange: !!user.force_password_change, clientId: user.client_id || null, clientName: user.client_name || null,
    clientMemberId: clientMember?.id || null, clientMemberName: clientMember?.name || user.client_member_name || null,
    canManageClientUsers: !!(clientMember?.can_manage_users || user.can_manage_client_users),
    clientIsTechnician: !!(clientMember?.is_technician || user.client_is_technician),
    clientFunction: clientMember?.function_title || user.function_title || null,
    clientCouncil: clientMember?.council_name || user.council_name || null,
    clientCouncilNumber: clientMember?.council_number || user.council_number || null,
    clientCouncilState: clientMember?.council_state || user.council_state || null,
    technicianId: technician?.id || null, technicianName: technician?.name || null, technicianLocation: technician?.location || null,
    tutorId: tutorProfile?.id || user.tutor_id || null, tutorName: tutorProfile?.name || user.tutor_name || null,
    tutorClientId: tutorProfile?.client_id || user.tutor_client_id || null, tutorClientName: tutorProfile?.client_name || null
  }, profile, clientMember, tutorProfile });
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
  if(user.role==='tutor') return tutorDashboard(env,user);
  const p=[];
  let where=` WHERE date(datetime(r.created_at,'-3 hours'))=date('now','-3 hours')`;
  if(user.role==='client'){where+=' AND r.client_id=?';p.push(user.client_id);}
  const rows = await env.DB.prepare(`SELECT r.status,COUNT(*) n FROM requisitions r${where} GROUP BY r.status`).bind(...p).all();
  const totals = Object.fromEntries((rows.results || []).map(r => [r.status, r.n]));
  const recent = await env.DB.prepare(`
    SELECT r.id,r.protocol,r.patient_name,r.tutor_name,r.status,r.created_at,r.request_kind,r.scheduled_at,r.accepted_at,
           CASE WHEN r.status='cancelado' THEN 0 ELSE (SELECT COUNT(*) FROM result_files rf WHERE rf.requisition_id=r.id) END result_count,
           c.name client_name
    FROM requisitions r JOIN clients c ON c.id=r.client_id
    ${where}
    ORDER BY COALESCE(r.scheduled_at,r.created_at) DESC LIMIT 20
  `).bind(...p).all();
  return ok({ totals, recent: recent.results || [], day: new Date(Date.now()-3*3600000).toISOString().slice(0,10) });
}

async function tutorDashboard(env,user){
  const row=await env.DB.prepare(`
    SELECT COUNT(DISTINCT r.id) total_results
    FROM requisitions r
    JOIN result_files rf ON rf.requisition_id=r.id
    WHERE r.tutor_account_id=? AND r.status<>'cancelado'
  `).bind(user.tutor_id).first();
  return ok({ tutor:true, totalResults:Number(row?.total_results||0) });
}

async function pendingAlerts(env,user){
  const rows=await env.DB.prepare(`
    SELECT r.id,r.protocol,r.patient_name,r.request_kind,r.scheduled_at,r.created_at,c.name client_name
    FROM requisitions r JOIN clients c ON c.id=r.client_id
    WHERE r.status='solicitado' AND r.accepted_at IS NULL
      AND (r.request_kind<>'scheduled' OR r.scheduled_at IS NULL OR r.scheduled_at<=?)
    ORDER BY COALESCE(r.scheduled_at,r.created_at),r.id
    LIMIT 50
  `).bind(nowIso()).all();
  const cancelled=await env.DB.prepare(`
    SELECT a.id alert_id,a.requisition_id,a.title,a.message,a.created_at,
           r.protocol,r.patient_name,c.name client_name
    FROM lab_alerts a
    LEFT JOIN requisitions r ON r.id=a.requisition_id
    LEFT JOIN clients c ON c.id=a.client_id
    WHERE a.alert_type='client_cancelled' AND a.acknowledged_at IS NULL
    ORDER BY a.created_at
    LIMIT 50
  `).all();
  let missingPrices=[];
  if(user.role==='admin'){
    const mp=await env.DB.prepare(`
      SELECT e.exam_code,e.exam_name,COUNT(*) pending_count
      FROM requisition_exams e
      JOIN requisitions r ON r.id=e.requisition_id
      WHERE e.unit_price_cents IS NULL AND r.status<>'cancelado'
      GROUP BY e.exam_code,e.exam_name
      ORDER BY e.exam_name COLLATE NOCASE
      LIMIT 100
    `).all();
    missingPrices=mp.results||[];
  }
  return ok({alerts:rows.results||[],cancelAlerts:cancelled.results||[],missingPrices});
}

async function acknowledgeAlert(env,user,id){
  const row=await env.DB.prepare('SELECT id FROM lab_alerts WHERE id=?').bind(id).first();
  if(!row)return err('Alerta não encontrado.',404);
  await env.DB.prepare(`UPDATE lab_alerts SET acknowledged_at=COALESCE(acknowledged_at,?),acknowledged_by_user_id=?,acknowledged_by_name=? WHERE id=?`)
    .bind(nowIso(),user.id,user.username_display,id).run();
  await audit(env,user,'confirmou_alerta','lab_alert',id);
  return ok({message:'Alerta confirmado.'});
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
  const c = await env.DB.prepare(`INSERT INTO clients(user_id,name,legal_name,document,phone,email,address,city,state,zip_code,stamp_name,stamp_line2,stamp_line3,stamp_line4,stamp_color) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(userId,name,clampString(b.legalName,200),clampString(b.document,50),clampString(b.phone,40),clampString(b.email,200),clampString(b.address,300),clampString(b.city,120),clampString(b.state,30)||'RN',clampString(b.zipCode,20),null,null,null,null,'#5c2a72').run();
  await env.DB.prepare(`INSERT INTO client_members(client_id,user_id,name,can_manage_users,is_technician,council_name,council_state,active) VALUES(?,?,?,1,0,'CRMV',?,1)`)
    .bind(c.meta.last_row_id,userId,name,clampString(b.state,30)||'RN').run();
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
    env.DB.prepare(`UPDATE clients SET name=?,legal_name=?,document=?,phone=?,email=?,address=?,city=?,state=?,zip_code=?,stamp_name=?,stamp_line2=?,stamp_line3=?,stamp_line4=?,stamp_color=?,active=?,updated_at=? WHERE id=?`)
      .bind(clampString(b.name ?? current.name,200),clampString(b.legalName ?? current.legal_name,200),clampString(b.document ?? current.document,50),clampString(b.phone ?? current.phone,40),clampString(b.email ?? current.email,200),clampString(b.address ?? current.address,300),clampString(b.city ?? current.city,120),clampString(b.state ?? current.state,30),clampString(b.zipCode ?? current.zip_code,20),clampString(b.stampName ?? current.stamp_name,120),clampString(b.stampLine2 ?? current.stamp_line2,120),clampString(b.stampLine3 ?? current.stamp_line3,120),clampString(b.stampLine4 ?? current.stamp_line4,120),clampString(b.stampColor ?? current.stamp_color,20)||'#5c2a72',active,nowIso(),id)
  ]);
  if(!active){
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET active=0,updated_at=? WHERE id IN (SELECT user_id FROM client_members WHERE client_id=?)').bind(nowIso(),id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM client_members WHERE client_id=?)').bind(id)
    ]);
  }else{
    await env.DB.prepare('UPDATE users SET active=1,updated_at=? WHERE id IN (SELECT user_id FROM client_members WHERE client_id=? AND active=1)').bind(nowIso(),id).run();
  }
  await audit(env,admin,'editou_cliente','client',id,{ username, active:!!active });
  return ok({ message:'Cliente atualizado.' });
}

async function deleteClient(env, admin, id) {
  const row = await env.DB.prepare('SELECT user_id,name FROM clients WHERE id=?').bind(id).first();
  if (!row) return err('Cliente não encontrado.',404);
  await env.DB.batch([
    env.DB.prepare('UPDATE clients SET active=0,updated_at=? WHERE id=?').bind(nowIso(),id),
    env.DB.prepare('UPDATE users SET active=0,updated_at=? WHERE id IN (SELECT user_id FROM client_members WHERE client_id=?)').bind(nowIso(),id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM client_members WHERE client_id=?)').bind(id)
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
  if(!Number(user.can_manage_client_users)) return err('Somente o usuário principal pode alterar os dados da clínica.',403);
  const b=await safeBody(request); const c=await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(user.client_id).first();
  if(!c) return err('Cliente não encontrado.',404);
  await env.DB.prepare(`UPDATE clients SET phone=?,email=?,updated_at=? WHERE id=?`)
    .bind(clampString(b.phone??c.phone,40),clampString(b.email??c.email,200),nowIso(),user.client_id).run();
  await audit(env,user,'atualizou_dados_cliente','client',user.client_id);
  return ok({message:'Dados de contato atualizados.'});
}


async function listClientUsers(env,user){
  const rows=await env.DB.prepare(`
    SELECT cm.id,cm.client_id,cm.user_id,cm.name,cm.can_manage_users,cm.is_technician,
           cm.function_title,cm.council_name,cm.council_number,cm.council_state,cm.stamp_color,cm.active,
           u.username_display,u.force_password_change,u.active AS user_active
    FROM client_members cm JOIN users u ON u.id=cm.user_id
    WHERE cm.client_id=?
    ORDER BY cm.can_manage_users DESC,cm.active DESC,cm.name COLLATE NOCASE
  `).bind(user.client_id).all();
  return ok({users:rows.results||[]});
}

async function createClientUser(request,env,user){
  const b=await safeBody(request);
  const name=clampString(b?.name,160),username=clampString(b?.username,120),password=String(b?.password||'');
  if(!name||!username||password.length<8)return err('Nome, usuário e senha inicial com pelo menos 8 caracteres são obrigatórios.');
  const key=normalizeUsername(username);
  if(await env.DB.prepare('SELECT id FROM users WHERE username_key=?').bind(key).first())return err('Esse nome de usuário já existe.',409);
  const isTechnician=boolInt(b?.isTechnician);
  const {hash,salt}=await hashPassword(password);
  const u=await env.DB.prepare(`INSERT INTO users(role,username_display,username_key,password_hash,password_salt,force_password_change,active) VALUES('client',?,?,?,?,1,1)`)
    .bind(username,key,hash,salt).run();
  const member=await env.DB.prepare(`INSERT INTO client_members(client_id,user_id,name,can_manage_users,is_technician,function_title,council_name,council_number,council_state,stamp_color,active) VALUES(?,?,?,0,?,?,?,?,?,?,1)`)
    .bind(user.client_id,u.meta.last_row_id,name,isTechnician,clampString(b?.functionTitle,120),clampString(b?.councilName,30)||'CRMV',clampString(b?.councilNumber,60),clampString(b?.councilState,20)||'RN',clampString(b?.stampColor,20)||'#5c2a72').run();
  await audit(env,user,'criou_usuario_cliente','client_member',member.meta.last_row_id,{name,username,isTechnician:!!isTechnician});
  return ok({id:member.meta.last_row_id,message:isTechnician?'Técnico do cliente cadastrado. O carimbo será preenchido automaticamente quando ele solicitar exames.':'Usuário do cliente cadastrado sem carimbo.'});
}

async function updateClientUser(request,env,user,id){
  const b=await safeBody(request);
  const row=await env.DB.prepare(`SELECT cm.*,u.username_display FROM client_members cm JOIN users u ON u.id=cm.user_id WHERE cm.id=? AND cm.client_id=?`).bind(id,user.client_id).first();
  if(!row)return err('Usuário não encontrado.',404);
  if(row.can_manage_users && row.user_id===user.id && b.active===false)return err('O usuário principal não pode desativar o próprio acesso.');
  const name=clampString(b?.name??row.name,160),username=clampString(b?.username??row.username_display,120),key=normalizeUsername(username);
  const dup=await env.DB.prepare('SELECT id FROM users WHERE username_key=? AND id<>?').bind(key,row.user_id).first();if(dup)return err('Esse nome de usuário já está em uso.',409);
  const active=b.active==null?row.active:boolInt(b.active),isTechnician=boolInt(b?.isTechnician??row.is_technician);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET username_display=?,username_key=?,active=?,updated_at=? WHERE id=?').bind(username,key,active,nowIso(),row.user_id),
    env.DB.prepare(`UPDATE client_members SET name=?,is_technician=?,function_title=?,council_name=?,council_number=?,council_state=?,stamp_color=?,active=?,updated_at=? WHERE id=?`)
      .bind(name,isTechnician,clampString(b?.functionTitle??row.function_title,120),clampString(b?.councilName??row.council_name,30)||'CRMV',clampString(b?.councilNumber??row.council_number,60),clampString(b?.councilState??row.council_state,20)||'RN',clampString(b?.stampColor??row.stamp_color,20)||'#5c2a72',active,nowIso(),id)
  ]);
  if(!active)await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id).run();
  await audit(env,user,'editou_usuario_cliente','client_member',id,{name,username,isTechnician:!!isTechnician,active:!!active});
  return ok({message:'Usuário do cliente atualizado.'});
}

async function deleteClientUser(env,user,id){
  const row=await env.DB.prepare('SELECT * FROM client_members WHERE id=? AND client_id=?').bind(id,user.client_id).first();
  if(!row)return err('Usuário não encontrado.',404);
  if(row.can_manage_users)return err('O usuário principal do cliente não pode ser excluído.');
  await env.DB.batch([
    env.DB.prepare('UPDATE client_members SET active=0,updated_at=? WHERE id=?').bind(nowIso(),id),
    env.DB.prepare('UPDATE users SET active=0,updated_at=? WHERE id=?').bind(nowIso(),row.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id)
  ]);
  await audit(env,user,'desativou_usuario_cliente','client_member',id,{name:row.name});
  return ok({message:'Usuário desativado. O histórico das solicitações foi preservado.'});
}

async function resetClientUserPassword(request,env,user,id){
  const b=await safeBody(request),pwd=String(b?.password||'');if(pwd.length<8)return err('A senha temporária deve ter pelo menos 8 caracteres.');
  const row=await env.DB.prepare('SELECT user_id,name FROM client_members WHERE id=? AND client_id=?').bind(id,user.client_id).first();if(!row)return err('Usuário não encontrado.',404);
  await setPassword(env,row.user_id,pwd,true);await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id).run();
  await audit(env,user,'redefiniu_senha_usuario_cliente','client_member',id,{name:row.name});return ok({message:'Senha temporária definida. O usuário deverá trocá-la no próximo login.'});
}


async function listTutors(env,user){
  let sql=`SELECT t.id,t.client_id,t.user_id,t.name,t.document,t.phone,t.email,t.active,t.created_at,t.updated_at,u.username_display,u.force_password_change,u.active AS user_active
           FROM tutors t JOIN users u ON u.id=t.user_id WHERE t.client_id=?`;
  const params=[user.client_id];
  if(!Number(user.can_manage_client_users)) sql+=' AND t.active=1';
  sql+=' ORDER BY t.active DESC,t.name COLLATE NOCASE';
  const rows=await env.DB.prepare(sql).bind(...params).all();
  return ok({tutors:rows.results||[]});
}

async function createTutor(request,env,user){
  const b=await safeBody(request);
  const name=clampString(b?.name,160),username=clampString(b?.username,120),password=String(b?.password||'');
  if(!name||!username||password.length<8)return err('Nome, usuário e senha inicial com pelo menos 8 caracteres são obrigatórios.');
  const key=normalizeUsername(username);
  if(await env.DB.prepare('SELECT id FROM users WHERE username_key=?').bind(key).first())return err('Esse nome de usuário já existe.',409);
  const {hash,salt}=await hashPassword(password);
  const u=await env.DB.prepare(`INSERT INTO users(role,username_display,username_key,password_hash,password_salt,force_password_change,active) VALUES('client',?,?,?,?,1,1)`)
    .bind(username,key,hash,salt).run();
  const t=await env.DB.prepare(`INSERT INTO tutors(client_id,user_id,name,document,phone,email,active) VALUES(?,?,?,?,?,?,1)`)
    .bind(user.client_id,u.meta.last_row_id,name,clampString(b?.document,60),clampString(b?.phone,40),clampString(b?.email,200)).run();
  await audit(env,user,'criou_tutor_cliente_final','tutor',t.meta.last_row_id,{name,username,clientId:user.client_id});
  return ok({id:t.meta.last_row_id,message:'Tutor / cliente final cadastrado. Ele verá somente os resultados vinculados a ele.'});
}

async function updateTutor(request,env,user,id){
  const b=await safeBody(request);
  const row=await env.DB.prepare(`SELECT t.*,u.username_display FROM tutors t JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.client_id=?`).bind(id,user.client_id).first();
  if(!row)return err('Tutor não encontrado.',404);
  const name=clampString(b?.name??row.name,160),username=clampString(b?.username??row.username_display,120),key=normalizeUsername(username);
  if(!name||!username)return err('Nome e usuário são obrigatórios.');
  const dup=await env.DB.prepare('SELECT id FROM users WHERE username_key=? AND id<>?').bind(key,row.user_id).first();
  if(dup)return err('Esse nome de usuário já está em uso.',409);
  const active=b.active==null?row.active:boolInt(b.active);
  const ts=nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET username_display=?,username_key=?,active=?,updated_at=? WHERE id=?').bind(username,key,active,ts,row.user_id),
    env.DB.prepare('UPDATE tutors SET name=?,document=?,phone=?,email=?,active=?,updated_at=? WHERE id=?')
      .bind(name,clampString(b?.document??row.document,60),clampString(b?.phone??row.phone,40),clampString(b?.email??row.email,200),active,ts,id)
  ]);
  if(!active)await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id).run();
  await audit(env,user,'editou_tutor_cliente_final','tutor',id,{name,username,active:!!active});
  return ok({message:'Tutor / cliente final atualizado.'});
}

async function deleteTutor(env,user,id){
  const row=await env.DB.prepare('SELECT id,user_id,name FROM tutors WHERE id=? AND client_id=?').bind(id,user.client_id).first();
  if(!row)return err('Tutor não encontrado.',404);
  const ts=nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE tutors SET active=0,updated_at=? WHERE id=?').bind(ts,id),
    env.DB.prepare('UPDATE users SET active=0,updated_at=? WHERE id=?').bind(ts,row.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id)
  ]);
  await audit(env,user,'desativou_tutor_cliente_final','tutor',id,{name:row.name});
  return ok({message:'Tutor desativado. Os resultados antigos continuam vinculados ao histórico.'});
}

async function resetTutorPassword(request,env,user,id){
  const b=await safeBody(request),pwd=String(b?.password||'');
  if(pwd.length<8)return err('A senha temporária deve ter pelo menos 8 caracteres.');
  const row=await env.DB.prepare('SELECT user_id,name FROM tutors WHERE id=? AND client_id=?').bind(id,user.client_id).first();
  if(!row)return err('Tutor não encontrado.',404);
  await setPassword(env,row.user_id,pwd,true);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id).run();
  await audit(env,user,'redefiniu_senha_tutor','tutor',id,{name:row.name});
  return ok({message:'Senha temporária definida. O tutor deverá trocá-la no próximo login.'});
}

async function tutorResults(env,user){
  const rows=await env.DB.prepare(`
    SELECT r.id,r.protocol,r.patient_name,r.species,r.breed,r.sex,r.birth_date,r.created_at,r.completed_at,
           c.name client_name,COUNT(rf.id) result_count,MAX(rf.created_at) latest_result_at
    FROM requisitions r
    JOIN clients c ON c.id=r.client_id
    JOIN result_files rf ON rf.requisition_id=r.id
    WHERE r.tutor_account_id=? AND r.status<>'cancelado'
    GROUP BY r.id,r.protocol,r.patient_name,r.species,r.breed,r.sex,r.birth_date,r.created_at,r.completed_at,c.name
    ORDER BY latest_result_at DESC,r.id DESC
  `).bind(user.tutor_id).all();
  return ok({results:rows.results||[]});
}

async function tutorResultDetail(env,user,id){
  const r=await env.DB.prepare(`
    SELECT r.id,r.protocol,r.patient_name,r.species,r.breed,r.sex,r.birth_date,r.created_at,r.completed_at,c.name client_name
    FROM requisitions r JOIN clients c ON c.id=r.client_id
    WHERE r.id=? AND r.tutor_account_id=? AND r.status<>'cancelado'
      AND EXISTS(SELECT 1 FROM result_files rf WHERE rf.requisition_id=r.id)
  `).bind(id,user.tutor_id).first();
  if(!r)return err('Resultado não encontrado para este acesso.',404);
  const [ex,files]=await Promise.all([
    env.DB.prepare('SELECT exam_name FROM requisition_exams WHERE requisition_id=? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT id,original_name,mime_type,size_bytes,created_at FROM result_files WHERE requisition_id=? ORDER BY created_at DESC,id DESC').bind(id).all()
  ]);
  return ok({requisition:r,exams:(ex.results||[]).map(x=>x.exam_name),files:files.results||[]});
}

async function listCouriers(env){
  const rows=await env.DB.prepare('SELECT id,name,phone,token_last4,thermometer_code,active,created_at,updated_at FROM couriers ORDER BY active DESC,name COLLATE NOCASE').all();
  return ok({couriers:rows.results||[]});
}

function normalizeThermometer(v){
  const raw=String(v||'').trim().toUpperCase().replace(/\s+/g,'');
  if(!raw)return '';
  const m=raw.match(/^TER-?(\d{1,4})$/);
  return m ? `TER-${String(Number(m[1])).padStart(3,'0')}` : raw;
}

async function createCourier(request,env,user,url){
  const b=await safeBody(request); const name=clampString(b?.name,160); if(!name) return err('Informe o nome do entregador.');
  const thermometer=normalizeThermometer(b?.thermometerCode);
  if(!/^TER-\d{3,4}$/.test(thermometer)) return err('Informe o termômetro no padrão TER-001.');
  const used=await env.DB.prepare(`SELECT id,name FROM couriers WHERE active=1 AND thermometer_code=?`).bind(thermometer).first();
  if(used)return err(`O ${thermometer} já está vinculado a ${used.name}. Desative ou altere o entregador anterior antes de reutilizar o termômetro.`,409);
  const token=randomToken(30), hash=await sha256(token);
  const r=await env.DB.prepare('INSERT INTO couriers(name,phone,token_hash,token_last4,thermometer_code,active) VALUES(?,?,?,?,?,1)').bind(name,clampString(b.phone,40),hash,token.slice(-4),thermometer).run();
  await audit(env,user,'criou_entregador','courier',r.meta.last_row_id,{name,thermometer});
  return ok({id:r.meta.last_row_id,link:courierLink(url,token),message:`Entregador cadastrado com o termômetro ${thermometer}. Copie e guarde o link privado.`});
}

async function updateCourier(request,env,user,id){
  const b=await safeBody(request); const c=await env.DB.prepare('SELECT * FROM couriers WHERE id=?').bind(id).first(); if(!c)return err('Entregador não encontrado.',404);
  const active=b.active==null?c.active:boolInt(b.active), thermometer=normalizeThermometer(b.thermometerCode??c.thermometer_code);
  if(active && !/^TER-\d{3,4}$/.test(thermometer)) return err('Informe o termômetro no padrão TER-001.');
  if(active){const used=await env.DB.prepare(`SELECT id,name FROM couriers WHERE active=1 AND thermometer_code=? AND id<>?`).bind(thermometer,id).first();if(used)return err(`O ${thermometer} já está vinculado a ${used.name}.`,409);}
  await env.DB.prepare('UPDATE couriers SET name=?,phone=?,thermometer_code=?,active=?,updated_at=? WHERE id=?').bind(clampString(b.name??c.name,160),clampString(b.phone??c.phone,40),thermometer||null,active,nowIso(),id).run();
  await audit(env,user,'editou_entregador','courier',id,{thermometer}); return ok({message:'Entregador atualizado. O histórico anterior permanece com o nome e termômetro gravados no momento da coleta.'});
}

async function regenerateCourierLink(env,user,id,url){
  const c=await env.DB.prepare('SELECT id,name FROM couriers WHERE id=?').bind(id).first(); if(!c)return err('Entregador não encontrado.',404);
  const token=randomToken(30), hash=await sha256(token);
  await env.DB.prepare('UPDATE couriers SET token_hash=?,token_last4=?,updated_at=? WHERE id=?').bind(hash,token.slice(-4),nowIso(),id).run();
  await audit(env,user,'regenerou_link_entregador','courier',id);
  return ok({link:courierLink(url,token),message:'Novo link criado. O link anterior deixou de funcionar.'});
}
function courierLink(url,token){return `${url.origin}/?entregador=${encodeURIComponent(token)}`;}

async function listReceivers(env){
  const rows=await env.DB.prepare(`SELECT r.*,u.username_display,u.force_password_change,u.active user_active FROM receivers r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.active DESC,r.name COLLATE NOCASE`).all();
  return ok({receivers:rows.results||[]});
}
async function createReceiver(request,env,user){
  const b=await safeBody(request),name=clampString(b?.name,160),username=clampString(b?.username,120),password=String(b?.password||'');
  if(!name||!username||password.length<8)return err('Nome, usuário e senha inicial do técnico (mínimo 8 caracteres) são obrigatórios.');
  const key=normalizeUsername(username);if(await env.DB.prepare('SELECT id FROM users WHERE username_key=?').bind(key).first())return err('Esse usuário já existe.',409);
  const {hash,salt}=await hashPassword(password);
  const u=await env.DB.prepare(`INSERT INTO users(role,username_display,username_key,password_hash,password_salt,force_password_change,active) VALUES('staff',?,?,?,?,1,1)`).bind(username,key,hash,salt).run();
  const r=await env.DB.prepare('INSERT INTO receivers(user_id,name,location,active) VALUES(?,?,?,1)').bind(u.meta.last_row_id,name,clampString(b.location,200)||'HLab Vet').run();
  await audit(env,user,'criou_tecnico','technician',r.meta.last_row_id,{name,username});return ok({id:r.meta.last_row_id,message:'Técnico cadastrado. No primeiro login ele deverá trocar a senha.'});
}
async function updateReceiver(request,env,user,id){
  const b=await safeBody(request),r=await env.DB.prepare(`SELECT r.*,u.username_display FROM receivers r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=?`).bind(id).first();if(!r)return err('Técnico não encontrado.',404);
  let userId=r.user_id,username=clampString(b.username??r.username_display,120),active=b.active==null?r.active:boolInt(b.active);
  if(!userId){
    const password=String(b.password||'');if(!username||password.length<8)return err('Para ativar o login deste técnico, informe usuário e senha temporária com pelo menos 8 caracteres.');
    const key=normalizeUsername(username);if(await env.DB.prepare('SELECT id FROM users WHERE username_key=?').bind(key).first())return err('Esse usuário já existe.',409);
    const {hash,salt}=await hashPassword(password);const u=await env.DB.prepare(`INSERT INTO users(role,username_display,username_key,password_hash,password_salt,force_password_change,active) VALUES('staff',?,?,?,?,1,?)`).bind(username,key,hash,salt,active).run();userId=u.meta.last_row_id;
  }else{
    const key=normalizeUsername(username);const dup=await env.DB.prepare('SELECT id FROM users WHERE username_key=? AND id<>?').bind(key,userId).first();if(dup)return err('Esse usuário já está em uso.',409);
    await env.DB.prepare('UPDATE users SET username_display=?,username_key=?,active=?,updated_at=? WHERE id=?').bind(username,key,active,nowIso(),userId).run();
    if(!active)await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId).run();
  }
  await env.DB.prepare('UPDATE receivers SET user_id=?,name=?,location=?,active=?,updated_at=? WHERE id=?').bind(userId,clampString(b.name??r.name,160),clampString(b.location??r.location,200)||'HLab Vet',active,nowIso(),id).run();
  await audit(env,user,'editou_tecnico','technician',id);return ok({message:'Técnico atualizado.'});
}
async function resetTechnicianPassword(request,env,user,id){
  const b=await safeBody(request),pwd=String(b?.password||'');if(pwd.length<8)return err('A senha temporária deve ter pelo menos 8 caracteres.');
  const r=await env.DB.prepare('SELECT user_id,name FROM receivers WHERE id=?').bind(id).first();if(!r||!r.user_id)return err('Técnico sem login cadastrado.',404);
  await setPassword(env,r.user_id,pwd,true);await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(r.user_id).run();await audit(env,user,'redefiniu_senha_tecnico','technician',id,{name:r.name});return ok({message:'Senha temporária definida. O técnico deverá trocá-la no próximo login.'});
}

async function listRequisitions(env,user,url){
  if(user.role==='tutor')return err('O tutor acessa somente os resultados liberados.',403);
  const filters={q:url.searchParams.get('q'),status:url.searchParams.get('status'),from:url.searchParams.get('from'),to:url.searchParams.get('to'),patient:url.searchParams.get('patient'),tutor:url.searchParams.get('tutor'),birth:url.searchParams.get('birth'),breed:url.searchParams.get('breed'),clientId:url.searchParams.get('clientId')};
  let sql=`SELECT r.id,r.protocol,r.status,r.patient_name,r.species,r.breed,r.birth_date,r.tutor_name,r.created_at,r.collection_date,r.assigned_at,r.collected_at,r.collection_temperature,r.lab_received_at,r.lab_received_temperature,r.analysis_started_at,r.completed_at,r.request_kind,r.scheduled_at,r.accepted_at,r.accepted_by_name,c.name client_name,co.name courier_name,CASE WHEN r.status='cancelado' THEN 0 ELSE (SELECT COUNT(*) FROM result_files rf WHERE rf.requisition_id=r.id) END result_count FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE 1=1`;
  const p=[];
  if(user.role==='client'){sql+=' AND r.client_id=?';p.push(user.client_id);} else if(filters.clientId){sql+=' AND r.client_id=?';p.push(Number(filters.clientId));}
  if(filters.status){sql+=' AND r.status=?';p.push(filters.status);}
  if(filters.from){sql+=` AND date(datetime(r.created_at,'-3 hours'))>=date(?)`;p.push(filters.from);}
  if(filters.to){sql+=` AND date(datetime(r.created_at,'-3 hours'))<=date(?)`;p.push(filters.to);}
  if(!filters.from&&!filters.to){sql+=` AND date(datetime(r.created_at,'-3 hours'))=date('now','-3 hours')`;}
  if(filters.patient){sql+=' AND r.patient_name LIKE ?';p.push(`%${filters.patient}%`);}
  if(filters.tutor){sql+=' AND r.tutor_name LIKE ?';p.push(`%${filters.tutor}%`);}
  if(filters.birth){sql+=' AND r.birth_date=?';p.push(filters.birth);}
  if(filters.breed){sql+=' AND r.breed LIKE ?';p.push(`%${filters.breed}%`);}
  if(filters.q){sql+=` AND (r.protocol LIKE ? OR r.patient_name LIKE ? OR r.tutor_name LIKE ? OR r.breed LIKE ? OR r.species LIKE ? OR r.sex LIKE ? OR r.clinic_name LIKE ? OR r.veterinarian_name LIKE ? OR r.crmv LIKE ? OR r.age_text LIKE ? OR r.clinical_info LIKE ? OR r.material_other LIKE ? OR c.name LIKE ? OR EXISTS(SELECT 1 FROM requisition_exams e WHERE e.requisition_id=r.id AND e.exam_name LIKE ?) OR EXISTS(SELECT 1 FROM requisition_materials m WHERE m.requisition_id=r.id AND m.material_name LIKE ?))`;p.push(...Array(15).fill(`%${filters.q}%`));}
  sql+=' ORDER BY COALESCE(r.scheduled_at,r.created_at) DESC LIMIT 500';
  const rows=await env.DB.prepare(sql).bind(...p).all(); return ok({requisitions:rows.results||[]});
}

async function createRequisition(request,env,user){
  const b=await safeBody(request); if(!b) return err('Dados inválidos.');
  const clientId=user.role==='client'?Number(user.client_id):Number(b.clientId);
  if(!clientId) return err('Cliente não informado.');
  if(user.role!=='client'&&!ADMIN_ROLES.has(user.role)) return err('Sem permissão.',403);
  const client=await env.DB.prepare('SELECT * FROM clients WHERE id=? AND active=1').bind(clientId).first(); if(!client)return err('Cliente não encontrado ou inativo.',404);
  const patient=clampString(b.patientName,160); if(!patient)return err('Nome do paciente é obrigatório.');
  const exams=Array.isArray(b.exams)?b.exams:[]; if(!exams.length)return err('Marque pelo menos um exame.');
  const catalog=new Map(); for(const g of catalogWithCodes()) for(const e of g.items) catalog.set(e.code,{...e,category:g.category});
  const selected=[]; for(const code of exams){const e=catalog.get(String(code));if(e)selected.push(e);} if(!selected.length)return err('Nenhum exame válido foi selecionado.');
  const materials=Array.isArray(b.materials)?b.materials.filter(x=>MATERIALS.includes(x)):[];

  let member=null,stamp={},tutorAccount=null;
  if(user.role==='client') member=await env.DB.prepare('SELECT * FROM client_members WHERE user_id=? AND client_id=? AND active=1').bind(user.id,clientId).first();
  const tutorAccountId=Number(b.tutorAccountId||0);
  if(tutorAccountId){
    tutorAccount=await env.DB.prepare('SELECT id,name FROM tutors WHERE id=? AND client_id=? AND active=1').bind(tutorAccountId,clientId).first();
    if(!tutorAccount)return err('Tutor / cliente final não encontrado ou não pertence a este cliente.',404);
  }
  if(member?.is_technician){
    const council=[member.council_name||'CRMV',member.council_state].filter(Boolean).join('-');
    const registration=[council,member.council_number].filter(Boolean).join(' ');
    stamp={name:member.name,line2:member.function_title||'',line3:registration,line4:'',color:member.stamp_color||'#5c2a72'};
  }
  const veterinarianName=clampString(b.veterinarianName,160)||(member?.is_technician?member.name:null);
  const crmv=clampString(b.crmv,80)||(member?.is_technician?[member.council_name||'CRMV',member.council_state,member.council_number].filter(Boolean).join(' '):null);
  const tutorName=tutorAccount?.name||clampString(b.tutorName,160);

  const requestKind=b.requestKind==='scheduled'?'scheduled':'immediate';
  let scheduledAt=null;
  if(requestKind==='scheduled'){
    const dt=new Date(String(b.scheduledAt||''));if(!Number.isFinite(dt.getTime()))return err('Informe a data e hora do agendamento.');
    if(dt.getTime()<Date.now()-60000)return err('O agendamento deve ser para um horário futuro.');scheduledAt=dt.toISOString();
  }
  const tempProto=`TEMP-${crypto.randomUUID()}`;
  const requesterName=member?.name||user.username_display;
  const ins=await env.DB.prepare(`INSERT INTO requisitions(protocol,client_id,status,clinic_name,veterinarian_name,crmv,tutor_name,tutor_account_id,patient_name,species,breed,sex,birth_date,age_text,collection_date,clinical_info,material_other,stamp_snapshot_json,observations,request_kind,scheduled_at,requested_by_user_id,requested_by_name) VALUES(?,?,'solicitado',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(tempProto,clientId,clampString(b.clinicName,200)||client.name,veterinarianName,crmv,tutorName,tutorAccount?.id||null,patient,clampString(b.species,100),clampString(b.breed,120),clampString(b.sex,20),clampString(b.birthDate,20),clampString(b.ageText,60),clampString(b.collectionDate,20),clampString(b.clinicalInfo,5000),clampString(b.materialOther,500),Object.keys(stamp).length?JSON.stringify(stamp):null,clampString(b.observations,2000),requestKind,scheduledAt,user.id,requesterName).run();
  const id=ins.meta.last_row_id, proto=protocolCode(id,new Date());
  const statements=[env.DB.prepare('UPDATE requisitions SET protocol=? WHERE id=?').bind(proto,id)];
  let missingPriceCount=0;
  for(const e of selected){
    const price=await resolveExamPrice(env,clientId,e.code);
    if(price.priceCents==null)missingPriceCount++;
    statements.push(env.DB.prepare('INSERT INTO requisition_exams(requisition_id,category,exam_code,exam_name,unit_price_cents,price_source) VALUES(?,?,?,?,?,?)').bind(id,e.category,e.code,e.name,price.priceCents,price.source));
  }
  for(const m of materials) statements.push(env.DB.prepare('INSERT INTO requisition_materials(requisition_id,material_code,material_name) VALUES(?,?,?)').bind(id,m.toLowerCase().replace(/\s+/g,'_'),m));
  const message=requestKind==='scheduled'?`Coleta agendada para ${scheduledAt}`:'Requisição enviada ao HLab Vet';
  statements.push(env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json) VALUES(?,'solicitado',?,?,?)`).bind(id,user.id,requesterName,JSON.stringify({message,requestKind,scheduledAt,missingPriceCount})));
  await env.DB.batch(statements); await audit(env,user,'criou_requisicao','requisition',id,{protocol:proto,patient,requestKind,scheduledAt,missingPriceCount,requesterName});
  return ok({id,protocol:proto,missingPriceCount,message:requestKind==='scheduled'?'Solicitação agendada e enviada ao HLab Vet.':'Solicitação enviada ao HLab Vet.'});
}

async function canSeeReq(env,user,id){
  const r=await env.DB.prepare('SELECT id,client_id FROM requisitions WHERE id=?').bind(id).first();
  if(!r)return null; if(ADMIN_ROLES.has(user.role)|| (user.role==='client'&&r.client_id===user.client_id))return r; return false;
}

async function getRequisition(env,user,id){
  const allowed=await canSeeReq(env,user,id); if(allowed===null)return err('Requisição não encontrada.',404); if(!allowed)return err('Sem acesso a essa requisição.',403);
  const r=await env.DB.prepare(`SELECT r.*,c.name client_name,c.address client_address,c.city client_city,c.state client_state,c.phone client_phone,co.name courier_name FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE r.id=?`).bind(id).first();
  const [ex,mat,events,files]=await Promise.all([
    env.DB.prepare('SELECT id,category,exam_code,exam_name FROM requisition_exams WHERE requisition_id=? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT material_name FROM requisition_materials WHERE requisition_id=? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT status,actor_name,details_json,created_at FROM status_events WHERE requisition_id=? ORDER BY created_at,id').bind(id).all(),
    env.DB.prepare('SELECT id,original_name,mime_type,size_bytes,created_at FROM result_files WHERE requisition_id=? ORDER BY created_at DESC').bind(id).all()
  ]);
  const visibleFiles=(user.role==='client'&&r.status==='cancelado')?[]:(files.results||[]);
  return ok({requisition:r,exams:ex.results||[],materials:(mat.results||[]).map(x=>x.material_name),events:(events.results||[]).map(e=>({...e,details:parseJson(e.details_json)})),files:visibleFiles});
}

async function deleteRequisitionExam(env,user,requisitionId,examId){
  const row=await env.DB.prepare(`
    SELECT r.id,r.client_id,r.status,r.accepted_at,e.id exam_id,e.exam_name
    FROM requisitions r
    JOIN requisition_exams e ON e.requisition_id=r.id
    WHERE r.id=? AND e.id=?
  `).bind(requisitionId,examId).first();
  if(!row)return err('Exame não encontrado nesta solicitação.',404);

  const lab=ADMIN_ROLES.has(user.role);
  const ownClient=user.role==='client' && Number(row.client_id)===Number(user.client_id);
  if(!lab&&!ownClient)return err('Sem acesso a essa solicitação.',403);

  if(['concluido','cancelado'].includes(row.status))return err('Não é possível excluir exame de uma solicitação concluída ou cancelada.');
  if(ownClient && (row.status!=='solicitado' || row.accepted_at)){
    return err('Após o laboratório aceitar a solicitação, a exclusão do exame deve ser feita pelo HLab Vet.',409);
  }

  const count=await env.DB.prepare('SELECT COUNT(*) total FROM requisition_exams WHERE requisition_id=?').bind(requisitionId).first();
  if(Number(count?.total||0)<=1)return err('A solicitação precisa manter pelo menos um exame. Se o único exame estiver errado, cancele a solicitação e faça outra.');

  const ts=nowIso();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM requisition_exams WHERE id=? AND requisition_id=?').bind(examId,requisitionId),
    env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(requisitionId,row.status,user.id,user.username_display,JSON.stringify({message:`Exame removido da solicitação: ${row.exam_name}`}),ts)
  ]);
  await audit(env,user,'removeu_exame_requisicao','requisition',requisitionId,{examId,examName:row.exam_name});
  return ok({message:`Exame “${row.exam_name}” excluído da solicitação.`});
}

async function acceptRequisition(env,user,id){
  const r=await env.DB.prepare('SELECT id,status,accepted_at,request_kind,scheduled_at FROM requisitions WHERE id=?').bind(id).first();if(!r)return err('Requisição não encontrada.',404);
  if(r.status!=='solicitado')return err('Essa solicitação já avançou no fluxo.');
  if(r.accepted_at)return ok({message:'Solicitação já aceita.'});
  if(r.request_kind==='scheduled'&&r.scheduled_at&&new Date(r.scheduled_at).getTime()>Date.now())return err('Essa solicitação está agendada para um horário futuro.');
  const ts=nowIso();await env.DB.batch([
    env.DB.prepare('UPDATE requisitions SET accepted_at=?,accepted_by_user_id=?,accepted_by_name=?,updated_at=? WHERE id=?').bind(ts,user.id,user.username_display,ts,id),
    env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'solicitado',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({message:'Solicitação aceita pelo laboratório'}),ts)
  ]);await audit(env,user,'aceitou_solicitacao','requisition',id);return ok({message:'Solicitação aceita. O alerta sonoro foi encerrado.'});
}

async function assignCourier(request,env,user,id){
  const b=await safeBody(request); const courierId=Number(b?.courierId); if(!courierId)return err('Selecione o entregador.');
  const [r,c]=await Promise.all([env.DB.prepare('SELECT * FROM requisitions WHERE id=?').bind(id).first(),env.DB.prepare('SELECT * FROM couriers WHERE id=? AND active=1').bind(courierId).first()]);
  if(!r)return err('Requisição não encontrada.',404); if(!c)return err('Entregador não encontrado ou inativo.',404); if(['recebido','em_analise','concluido','cancelado'].includes(r.status))return err('Não é possível atribuir entregador nesse status.');
  if(!r.accepted_at)return err('Aceite a solicitação antes de atribuir o entregador.');
  const ts=nowIso(); await env.DB.batch([
    env.DB.prepare(`UPDATE requisitions SET assigned_courier_id=?,assigned_at=?,courier_accepted_at=NULL,courier_accepted_name=NULL,status='atribuido',updated_at=? WHERE id=?`).bind(courierId,ts,ts,id),
    env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'atribuido',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({courier:c.name,thermometer:c.thermometer_code}),ts)
  ]);
  await audit(env,user,'atribuiu_entregador','requisition',id,{courierId,courier:c.name,thermometer:c.thermometer_code});return ok({message:`${c.name} atribuído à coleta (${c.thermometer_code||'sem termômetro'}).`});
}

async function receiveAtLab(request,env,user,id){
  const b=await safeBody(request),temp=parseNumber(b?.temperature);
  if(temp==null)return err('Informe a temperatura de recebimento.');
  const r=await env.DB.prepare('SELECT * FROM requisitions WHERE id=?').bind(id).first();if(!r)return err('Requisição não encontrada.',404);if(r.status!=='coletado')return err('A requisição precisa estar marcada como coletada pelo entregador antes do recebimento.');
  let rec=null;
  if(user.role==='staff')rec=await env.DB.prepare('SELECT * FROM receivers WHERE user_id=? AND active=1').bind(user.id).first();
  else if(Number(b?.technicianId))rec=await env.DB.prepare('SELECT * FROM receivers WHERE id=? AND active=1').bind(Number(b.technicianId)).first();
  if(!rec)return err(user.role==='staff'?'Seu login não está vinculado a um técnico ativo.':'Selecione o técnico que está recebendo.');
  const ts=nowIso(),loc=clampString(b.location,200)||rec.location||'HLab Vet',obs=clampString(b.observation,1000);
  await env.DB.batch([
    env.DB.prepare(`UPDATE requisitions SET status='recebido',lab_received_at=?,lab_received_temperature=?,receiver_id=?,receiver_name=?,received_location=?,receiving_observation=?,updated_at=? WHERE id=?`).bind(ts,temp,rec.id,rec.name,loc,obs,ts,id),
    env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'recebido',?,?,?,?)`).bind(id,user.id,rec.name,JSON.stringify({temperature:temp,receiver:rec.name,location:loc,observation:obs}),ts)
  ]);
  await audit(env,user,'recebeu_amostra','requisition',id,{temperature:temp,receiver:rec.name,location:loc,observation:obs});return ok({message:`Recebimento registrado por ${rec.name} com data e hora automáticas.`});
}

async function markAnalysis(env,user,id){
  const r=await env.DB.prepare('SELECT status FROM requisitions WHERE id=?').bind(id).first(); if(!r)return err('Requisição não encontrada.',404);if(!['recebido','em_analise'].includes(r.status))return err('O exame deve estar recebido pelo laboratório.');
  const ts=nowIso();await env.DB.batch([env.DB.prepare(`UPDATE requisitions SET status='em_analise',analysis_started_at=COALESCE(analysis_started_at,?),updated_at=? WHERE id=?`).bind(ts,ts,id),env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'em_analise',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({message:'Amostra em análise'}),ts)]);await audit(env,user,'iniciou_analise','requisition',id);return ok({message:'Status alterado para Em análise.'});
}
async function markComplete(env,user,id){const r=await env.DB.prepare('SELECT status FROM requisitions WHERE id=?').bind(id).first();if(!r)return err('Requisição não encontrada.',404);if(!['recebido','em_analise','concluido'].includes(r.status))return err('Não é possível concluir nesse status.');const ts=nowIso();await env.DB.batch([env.DB.prepare(`UPDATE requisitions SET status='concluido',completed_at=?,updated_at=? WHERE id=?`).bind(ts,ts,id),env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'concluido',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({message:'Exame concluído'}),ts)]);await audit(env,user,'concluiu_exame','requisition',id);return ok({message:'Exame concluído.'});}
async function cancelRequisition(request,env,user,id){
  const b=await safeBody(request);
  const r=await env.DB.prepare(`SELECT r.*,c.name client_name FROM requisitions r JOIN clients c ON c.id=r.client_id WHERE r.id=?`).bind(id).first();
  if(!r)return err('Requisição não encontrada.',404);
  if(r.status==='cancelado')return ok({message:'Essa solicitação já está cancelada.'});

  const isLab=ADMIN_ROLES.has(user.role);
  const isOwnClient=user.role==='client'&&Number(r.client_id)===Number(user.client_id);
  if(!isLab&&!isOwnClient)return err('Sem permissão para cancelar esta solicitação.',403);
  if(isOwnClient&&(r.collected_at||['coletado','recebido','em_analise','concluido'].includes(r.status))){
    return err('O cliente só pode cancelar antes de o entregador registrar a coleta.',409);
  }

  const defaultReason=isOwnClient?'Cancelado pelo cliente':'Cancelado pelo HLab Vet';
  const reason=clampString(b?.reason,1000)||defaultReason,ts=nowIso();
  const actorName=user.client_member_name||user.username_display;
  const statements=[
    env.DB.prepare(`UPDATE requisitions SET status='cancelado',cancellation_reason=?,cancelled_at=?,cancelled_by_user_id=?,cancelled_by_name=?,cancelled_by_role=?,updated_at=? WHERE id=?`)
      .bind(reason,ts,user.id,actorName,user.role,ts,id),
    env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'cancelado',?,?,?,?)`)
      .bind(id,user.id,actorName,JSON.stringify({reason,cancelledBy:user.role}),ts)
  ];
  if(isOwnClient){
    statements.push(env.DB.prepare(`INSERT INTO lab_alerts(alert_type,requisition_id,client_id,title,message,created_at) VALUES('client_cancelled',?,?,?,?,?)`)
      .bind(id,r.client_id,'SOLICITAÇÃO CANCELADA',`${r.client_name} cancelou ${r.protocol} • ${r.patient_name}. Motivo: ${reason}`,ts));
  }
  await env.DB.batch(statements);
  await audit(env,user,'cancelou_requisicao','requisition',id,{reason,clientCancellation:isOwnClient,financialChargeRemoved:true});
  return ok({message:isOwnClient?'Solicitação cancelada. O HLab Vet foi avisado.':'Requisição cancelada. Qualquer cobrança vinculada foi retirada do financeiro.'});
}


async function uploadResult(request,env,user,id){
  const r=await env.DB.prepare('SELECT id,protocol,status FROM requisitions WHERE id=?').bind(id).first(); if(!r)return err('Requisição não encontrada.',404);
  if(r.status==='cancelado')return err('Não é possível enviar resultado para uma solicitação cancelada.',409);
  const form=await request.formData(); const file=form.get('file'); if(!(file instanceof File)||file.size===0)return err('Selecione um arquivo.');
  if(file.size>25*1024*1024)return err('O arquivo excede o limite de 25 MB.');
  const safe=escapeFilename(file.name), key=`results/${id}/${Date.now()}-${crypto.randomUUID()}-${safe}`;
  await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'},customMetadata:{originalName:safe,requisitionId:String(id)}});
  const ins=await env.DB.prepare('INSERT INTO result_files(requisition_id,r2_key,original_name,mime_type,size_bytes,uploaded_by_user_id) VALUES(?,?,?,?,?,?)').bind(id,key,safe,file.type||'application/octet-stream',file.size,user.id).run();
  await audit(env,user,'enviou_resultado','requisition',id,{file:safe,fileId:ins.meta.last_row_id});return ok({id:ins.meta.last_row_id,message:'Resultado enviado. O cliente já pode visualizar e baixar.'});
}

async function deleteResult(env,user,fileId){
  const f=await env.DB.prepare(`SELECT f.*,r.id requisition_id,r.protocol,r.status FROM result_files f JOIN requisitions r ON r.id=f.requisition_id WHERE f.id=?`).bind(fileId).first();
  if(!f)return err('Resultado não encontrado.',404);
  await env.FILES.delete(f.r2_key);
  const ts=nowIso();
  const count=await env.DB.prepare('SELECT COUNT(*) total FROM result_files WHERE requisition_id=? AND id<>?').bind(f.requisition_id,fileId).first();
  const remaining=Number(count?.total||0);
  const statements=[
    env.DB.prepare('DELETE FROM result_files WHERE id=?').bind(fileId),
    env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(f.requisition_id,f.status,user.id,user.username_display,JSON.stringify({message:`Resultado excluído: ${f.original_name}`,fileId}),ts)
  ];
  if(remaining===0 && f.status==='concluido'){
    statements.push(env.DB.prepare(`UPDATE requisitions SET status='em_analise',completed_at=NULL,updated_at=? WHERE id=?`).bind(ts,f.requisition_id));
    statements.push(env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'em_analise',?,?,?,?)`)
      .bind(f.requisition_id,user.id,user.username_display,JSON.stringify({message:'Solicitação voltou para Em análise porque todos os resultados foram excluídos.'}),ts));
  }
  await env.DB.batch(statements);
  await audit(env,user,'excluiu_resultado','requisition',f.requisition_id,{fileId,filename:f.original_name,protocol:f.protocol,remaining});
  return ok({message:remaining?'Resultado excluído. Os demais arquivos continuam disponíveis.':'Resultado excluído. Não há outro arquivo liberado para esta solicitação.',remaining});
}

async function downloadResult(env,user,fileId,inline=false){
  const f=await env.DB.prepare(`SELECT f.*,r.client_id,r.tutor_account_id,r.status FROM result_files f JOIN requisitions r ON r.id=f.requisition_id WHERE f.id=?`).bind(fileId).first(); if(!f)return err('Arquivo não encontrado.',404);
  const allowedLab=ADMIN_ROLES.has(user.role);
  const allowedClient=user.role==='client'&&Number(f.client_id)===Number(user.client_id)&&f.status!=='cancelado';
  const allowedTutor=user.role==='tutor'&&Number(f.tutor_account_id)===Number(user.tutor_id)&&f.status!=='cancelado';
  if(!allowedLab&&!allowedClient&&!allowedTutor)return err('Sem acesso a esse arquivo.',403);
  const obj=await env.FILES.get(f.r2_key); if(!obj)return err('Arquivo não encontrado no armazenamento.',404);
  const h=new Headers(); obj.writeHttpMetadata(h);
  if(!h.get('content-type')) h.set('content-type',f.mime_type||'application/octet-stream');
  h.set('content-disposition',`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  h.set('cache-control','private, no-store');
  h.set('x-content-type-options','nosniff');
  return new Response(obj.body,{headers:h});
}

async function temperatureSheet(env,user,url){
  const month=url.searchParams.get('month')||new Date().toISOString().slice(0,7),courierId=Number(url.searchParams.get('courierId')||0);
  let sql=`SELECT r.id,r.protocol,r.created_at,r.collected_at,r.collection_temperature,r.sent_from_location,r.sent_by_name,r.lab_received_at,r.lab_received_temperature,r.received_location,r.receiver_name,r.receiving_observation,r.patient_name,c.name client_name,COALESCE(r.transport_courier_name,co.name) courier_name,COALESCE(r.transport_thermometer_code,co.thermometer_code) thermometer_code FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE r.status<>'cancelado' AND r.collected_at IS NOT NULL AND strftime('%Y-%m', datetime(r.collected_at,'-3 hours'))=?`;
  const p=[month];if(courierId){sql+=' AND r.assigned_courier_id=?';p.push(courierId);}sql+=' ORDER BY COALESCE(r.transport_thermometer_code,co.thermometer_code),r.collected_at,r.id';
  const rows=await env.DB.prepare(sql).bind(...p).all();return ok({month,entries:rows.results||[]});
}


function moneyInputToCents(v){
  if(v==null||v==='')return null;
  let raw=String(v).trim().replace(/R\$/gi,'').replace(/\s+/g,'');
  if(raw.includes(',')&&raw.includes('.')) raw=raw.replace(/\./g,'').replace(',','.');
  else if(raw.includes(',')) raw=raw.replace(',','.');
  const n=Number(raw);if(!Number.isFinite(n)||n<0)return null;
  return Math.round(n*100);
}

async function resolveExamPrice(env,clientId,examCode){
  const row=await env.DB.prepare(`
    SELECT cp.price_cents AS client_price,gp.price_cents AS general_price
    FROM (SELECT 1) x
    LEFT JOIN client_exam_prices cp ON cp.client_id=? AND cp.exam_code=?
    LEFT JOIN exam_prices gp ON gp.exam_code=? AND gp.active=1
  `).bind(clientId,examCode,examCode).first();
  if(row?.client_price!=null)return {priceCents:Number(row.client_price),source:'client'};
  if(row?.general_price!=null)return {priceCents:Number(row.general_price),source:'general'};
  return {priceCents:null,source:null};
}

async function listPrices(env,url){
  const clientId=Number(url.searchParams.get('clientId')||0);
  const [g,c]=await Promise.all([
    env.DB.prepare('SELECT exam_code,exam_name,price_cents,active FROM exam_prices').all(),
    clientId?env.DB.prepare('SELECT exam_code,exam_name,price_cents FROM client_exam_prices WHERE client_id=?').bind(clientId).all():Promise.resolve({results:[]})
  ]);
  const general=new Map((g.results||[]).map(x=>[x.exam_code,x]));
  const client=new Map((c.results||[]).map(x=>[x.exam_code,x]));
  const items=[];
  for(const group of catalogWithCodes())for(const e of group.items){
    const gp=general.get(e.code),cp=client.get(e.code);
    items.push({category:group.category,examCode:e.code,examName:e.name,generalPriceCents:gp?.active?Number(gp.price_cents):null,clientPriceCents:cp?Number(cp.price_cents):null,effectivePriceCents:cp?Number(cp.price_cents):(gp?.active?Number(gp.price_cents):null),source:cp?'client':gp?.active?'general':null});
  }
  return ok({clientId:clientId||null,items});
}

async function setGeneralPrice(request,env,user){
  const b=await safeBody(request),code=clampString(b?.examCode,30),priceCents=moneyInputToCents(b?.price);
  if(!code||priceCents==null)return err('Informe o exame e um valor válido.');
  let exam=null;for(const g of catalogWithCodes()){exam=g.items.find(x=>x.code===code);if(exam)break;}if(!exam)return err('Exame não encontrado.',404);
  const ts=nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO exam_prices(exam_code,exam_name,price_cents,active,created_at,updated_at) VALUES(?,?,?,1,?,?) ON CONFLICT(exam_code) DO UPDATE SET exam_name=excluded.exam_name,price_cents=excluded.price_cents,active=1,updated_at=excluded.updated_at`).bind(code,exam.name,priceCents,ts,ts),
    env.DB.prepare(`UPDATE requisition_exams SET unit_price_cents=?,price_source='general' WHERE exam_code=? AND unit_price_cents IS NULL AND requisition_id IN (SELECT r.id FROM requisitions r WHERE r.status<>'cancelado' AND NOT EXISTS (SELECT 1 FROM client_exam_prices cp WHERE cp.client_id=r.client_id AND cp.exam_code=?))`).bind(priceCents,code,code)
  ]);
  await audit(env,user,'definiu_preco_geral','exam_price',code,{exam:exam.name,priceCents});
  return ok({message:`Preço geral de ${exam.name} atualizado.`});
}

async function setClientPrice(request,env,user){
  const b=await safeBody(request),clientId=Number(b?.clientId),code=clampString(b?.examCode,30);
  if(!clientId||!code)return err('Cliente e exame são obrigatórios.');
  const client=await env.DB.prepare('SELECT id,name FROM clients WHERE id=?').bind(clientId).first();if(!client)return err('Cliente não encontrado.',404);
  let exam=null;for(const g of catalogWithCodes()){exam=g.items.find(x=>x.code===code);if(exam)break;}if(!exam)return err('Exame não encontrado.',404);
  if(b?.price==null||String(b.price).trim()===''){
    await env.DB.prepare('DELETE FROM client_exam_prices WHERE client_id=? AND exam_code=?').bind(clientId,code).run();
    await audit(env,user,'removeu_preco_cliente','client_exam_price',`${clientId}:${code}`,{client:client.name,exam:exam.name});
    return ok({message:'Preço individual removido. Novas solicitações usarão o preço geral.'});
  }
  const priceCents=moneyInputToCents(b.price);if(priceCents==null)return err('Informe um valor válido.');
  const ts=nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO client_exam_prices(client_id,exam_code,exam_name,price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(client_id,exam_code) DO UPDATE SET exam_name=excluded.exam_name,price_cents=excluded.price_cents,updated_at=excluded.updated_at`).bind(clientId,code,exam.name,priceCents,ts,ts),
    env.DB.prepare(`UPDATE requisition_exams SET unit_price_cents=?,price_source='client' WHERE exam_code=? AND unit_price_cents IS NULL AND requisition_id IN (SELECT id FROM requisitions WHERE client_id=? AND status<>'cancelado')`).bind(priceCents,code,clientId)
  ]);
  await audit(env,user,'definiu_preco_cliente','client_exam_price',`${clientId}:${code}`,{client:client.name,exam:exam.name,priceCents});
  return ok({message:`Preço de ${exam.name} para ${client.name} atualizado.`});
}

function financeDateWhere(url,field='r.lab_received_at'){
  const from=url.searchParams.get('from'),to=url.searchParams.get('to');
  const sql=[];const params=[];
  if(from){sql.push(`date(datetime(${field},'-3 hours'))>=date(?)`);params.push(from);}
  if(to){sql.push(`date(datetime(${field},'-3 hours'))<=date(?)`);params.push(to);}
  return {sql:sql.length?' AND '+sql.join(' AND '):'',params,from,to};
}

async function financeClients(env,url){
  const d=financeDateWhere(url);
  const rows=await env.DB.prepare(`
    SELECT c.id client_id,c.name client_name,
           COUNT(DISTINCT r.id) request_count,COUNT(e.id) exam_count,
           SUM(CASE WHEN e.id IS NOT NULL AND e.unit_price_cents IS NULL THEN 1 ELSE 0 END) missing_price_count,
           COALESCE(SUM(e.unit_price_cents),0) total_cents
    FROM clients c
    LEFT JOIN requisitions r ON r.client_id=c.id AND r.status<>'cancelado' AND r.lab_received_at IS NOT NULL ${d.sql}
    LEFT JOIN requisition_exams e ON e.requisition_id=r.id
    WHERE c.active=1 OR r.id IS NOT NULL
    GROUP BY c.id,c.name
    ORDER BY request_count DESC,total_cents DESC,c.name COLLATE NOCASE
  `).bind(...d.params).all();
  return ok({from:d.from,to:d.to,clients:rows.results||[]});
}

async function financeReport(env,url){
  const clientId=Number(url.searchParams.get('clientId')||0);if(!clientId)return err('Selecione o cliente.');
  const client=await env.DB.prepare('SELECT id,name,legal_name,document FROM clients WHERE id=?').bind(clientId).first();if(!client)return err('Cliente não encontrado.',404);
  const d=financeDateWhere(url);
  const rows=await env.DB.prepare(`
    SELECT r.id requisition_id,r.protocol,r.patient_name,r.lab_received_at,r.created_at,
           e.id exam_id,e.exam_code,e.exam_name,e.unit_price_cents,e.price_source
    FROM requisitions r
    JOIN requisition_exams e ON e.requisition_id=r.id
    WHERE r.client_id=? AND r.status<>'cancelado' AND r.lab_received_at IS NOT NULL ${d.sql}
    ORDER BY r.lab_received_at,r.protocol,e.id
  `).bind(clientId,...d.params).all();
  const items=rows.results||[];
  const totalCents=items.reduce((a,x)=>a+(x.unit_price_cents==null?0:Number(x.unit_price_cents)),0);
  const missingPriceCount=items.filter(x=>x.unit_price_cents==null).length;
  return ok({client,from:d.from,to:d.to,items,totalCents,missingPriceCount});
}

async function listCancellations(env,url){
  const from=url.searchParams.get('from'),to=url.searchParams.get('to'),clientId=Number(url.searchParams.get('clientId')||0);
  let sql=`SELECT r.id,r.protocol,r.patient_name,r.cancelled_at,r.cancelled_by_name,r.cancelled_by_role,r.cancellation_reason,r.created_at,c.name client_name FROM requisitions r JOIN clients c ON c.id=r.client_id WHERE r.status='cancelado'`;
  const p=[];
  if(from){sql+=` AND date(datetime(r.cancelled_at,'-3 hours'))>=date(?)`;p.push(from);}if(to){sql+=` AND date(datetime(r.cancelled_at,'-3 hours'))<=date(?)`;p.push(to);}if(clientId){sql+=' AND r.client_id=?';p.push(clientId);}sql+=' ORDER BY r.cancelled_at DESC LIMIT 1000';
  const rows=await env.DB.prepare(sql).bind(...p).all();return ok({cancellations:rows.results||[]});
}

async function listAudit(env,url){const limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit')||200)));const rows=await env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').bind(limit).all();return ok({events:(rows.results||[]).map(x=>({...x,details:parseJson(x.details_json)}))});}

async function courierApi(request,env,url,token,rest){
  const hash=await sha256(token), courier=await env.DB.prepare('SELECT id,name,phone,thermometer_code,active FROM couriers WHERE token_hash=?').bind(hash).first(); if(!courier||!courier.active)return err('Link de entregador inválido ou desativado.',403);
  const method=request.method.toUpperCase();
  if((rest===''||rest==='tasks')&&method==='GET'){
    const from=url.searchParams.get('from'),to=url.searchParams.get('to'),tab=url.searchParams.get('tab')||'pending';
    let sql=`SELECT r.id,r.protocol,r.status,r.patient_name,r.species,r.tutor_name,r.created_at,r.assigned_at,r.courier_accepted_at,r.courier_accepted_name,r.collected_at,r.collection_temperature,r.sent_by_name,r.sent_from_location,c.name client_name,c.address,c.city,c.state,c.phone,co.thermometer_code FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE r.assigned_courier_id=?`;
    const p=[courier.id]; if(tab==='collected')sql+=` AND r.status IN ('coletado','recebido','em_analise','concluido')`; else sql+=` AND r.status='atribuido'`; if(from){sql+=' AND date(COALESCE(r.collected_at,r.assigned_at,r.created_at))>=date(?)';p.push(from);} if(to){sql+=' AND date(COALESCE(r.collected_at,r.assigned_at,r.created_at))<=date(?)';p.push(to);} sql+=' ORDER BY COALESCE(r.assigned_at,r.created_at) DESC';
    const rows=await env.DB.prepare(sql).bind(...p).all(); return ok({courier,tasks:rows.results||[]});
  }
  const acceptMatch=rest.match(/^requisitions\/(\d+)\/accept$/); if(acceptMatch&&method==='POST'){
    const id=Number(acceptMatch[1]);
    const r=await env.DB.prepare(`SELECT r.id,r.protocol,r.status,r.courier_accepted_at,c.name client_name FROM requisitions r JOIN clients c ON c.id=r.client_id WHERE r.id=? AND r.assigned_courier_id=?`).bind(id,courier.id).first();
    if(!r)return err('Coleta não encontrada para este entregador.',404);
    if(r.status!=='atribuido')return err('Essa coleta já foi movimentada ou não está mais pendente.',409);
    if(r.courier_accepted_at)return ok({message:'Coleta já aceita.',acceptedAt:r.courier_accepted_at});
    const ts=nowIso();
    await env.DB.batch([
      env.DB.prepare(`UPDATE requisitions SET courier_accepted_at=?,courier_accepted_name=?,updated_at=? WHERE id=?`).bind(ts,courier.name,ts,id),
      env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'atribuido',NULL,?,?,?)`).bind(id,courier.name,JSON.stringify({message:'Coleta aceita pelo entregador',courier:courier.name}),ts)
    ]);
    await audit(env,{name:courier.name},'aceitou_coleta','requisition',id,{protocol:r.protocol,client:r.client_name});
    return ok({message:'Coleta aceita. O toque foi encerrado para esta solicitação.',acceptedAt:ts});
  }

  const m=rest.match(/^requisitions\/(\d+)\/collect$/); if(m&&method==='POST'){
    const id=Number(m[1]),b=await safeBody(request),temp=parseNumber(b?.temperature); if(temp==null)return err('Informe a temperatura da coleta.');
    const r=await env.DB.prepare(`SELECT r.*,c.name client_name,c.address,c.city,c.state,co.thermometer_code FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE r.id=? AND r.assigned_courier_id=?`).bind(id,courier.id).first(); if(!r)return err('Coleta não encontrada para este entregador.',404);if(r.status!=='atribuido')return err('Essa coleta já foi movimentada ou não está pendente.');if(!r.courier_accepted_at)return err('Aceite a coleta antes de registrar a retirada.',409);
    const ts=nowIso(),sentBy=clampString(b.sentByName,160)||'Responsável no local',loc=clampString(b.sentFromLocation,250)||r.client_name;
    await env.DB.batch([env.DB.prepare(`UPDATE requisitions SET status='coletado',collected_at=?,collection_temperature=?,sent_by_name=?,sent_from_location=?,transport_courier_name=?,transport_thermometer_code=?,updated_at=? WHERE id=?`).bind(ts,temp,sentBy,loc,courier.name,r.thermometer_code||null,ts,id),env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'coletado',NULL,?,?,?)`).bind(id,courier.name,JSON.stringify({temperature:temp,sentBy,location:loc}),ts)]);
    await audit(env,{name:courier.name},'coletou_amostra','requisition',id,{temperature:temp,sentBy,location:loc}); return ok({message:'Coleta registrada. O item foi movido para o histórico de coletados.',collectedAt:ts});
  }
  return err('Rota de entregador não encontrada.',404);
}

async function safeBody(request){try{return await request.json();}catch{return null;}}
function parseJson(s){try{return s?JSON.parse(s):null;}catch{return null;}}
