import { authenticate, clearSessionCookie, createSession, destroySession, getUser, hashPassword, sessionCookie, setPassword, verifyPassword } from './auth.js';
import { catalogWithCodes, MATERIALS } from './catalog.js';
import { boolInt, clampString, corsHeaders, err, escapeFilename, json, normalizeUsername, nowIso, ok, parseNumber, protocolCode, randomToken, sha256, statusLabel } from './utils.js';

const ADMIN_ROLES = new Set(['admin','staff']);

function parseCalendarDate(value){
  const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return null;
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
  const test=new Date(Date.UTC(y,mo-1,d));
  if(test.getUTCFullYear()!==y||test.getUTCMonth()!==mo-1||test.getUTCDate()!==d)return null;
  return {y,m:mo,d};
}
function daysInMonth(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate();}
function fortalezaToday(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=t=>parts.find(p=>p.type===t)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function exactAgeText(birthDate,referenceDate){
  const b=parseCalendarDate(birthDate),r=parseCalendarDate(referenceDate||fortalezaToday());
  if(!b||!r)return '';
  const bKey=b.y*10000+b.m*100+b.d,rKey=r.y*10000+r.m*100+r.d;
  if(bKey>rKey)return '';
  let years=r.y-b.y,months=r.m-b.m,days=r.d-b.d;
  if(days<0){
    months--;
    const prevMonth=r.m===1?12:r.m-1;
    const prevYear=r.m===1?r.y-1:r.y;
    days+=daysInMonth(prevYear,prevMonth);
  }
  if(months<0){years--;months+=12;}
  const parts=[];
  if(years)parts.push(`${years} ${years===1?'ano':'anos'}`);
  if(months)parts.push(`${months} ${months===1?'mês':'meses'}`);
  if(days||!parts.length)parts.push(`${days} ${days===1?'dia':'dias'}`);
  if(parts.length===1)return parts[0];
  if(parts.length===2)return `${parts[0]} e ${parts[1]}`;
  return `${parts[0]}, ${parts[1]} e ${parts[2]}`;
}

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
  // Painel do proprietário: autenticação e rotas totalmente separadas do laboratório.
  if (path === '/api/owner/login' && method === 'POST') return ownerLogin(request, env, url);
  if (path === '/api/owner/logout' && method === 'POST') return ownerLogout(request, env, url);
  if (path === '/api/owner/me' && method === 'GET') return ownerMe(request, env);
  if (path === '/api/owner/dashboard' && method === 'GET') return ownerDashboard(request, env, url);
  if (path === '/api/owner/pricing' && method === 'GET') return ownerPricing(request, env);
  if (path === '/api/owner/pricing' && method === 'PUT') return ownerUpdatePricing(request, env);
  if (path === '/api/owner/change-password' && method === 'POST') return ownerChangePassword(request, env);
  if (path === '/api/owner/backup' && method === 'POST') return ownerCreateBackup(request, env);
  if (path === '/api/owner/backups' && method === 'GET') return ownerListBackups(request, env);
  if (path === '/api/owner/export.zip' && method === 'GET') return ownerExportZip(request, env, url);
  if (path === '/api/owner/reset' && method === 'POST') return ownerResetSystem(request, env);

  if (path === '/api/login' && method === 'POST') return login(request, env, url);
  if (path === '/api/logout' && method === 'POST') return logout(request, env, url);

  // Login do entregador é totalmente separado do login principal.
  if (path === '/api/courier/login' && method === 'POST') return courierLogin(request, env, url);
  if (path === '/api/courier/logout' && method === 'POST') return courierLogout(request, env, url);
  if (path === '/api/courier/me' && method === 'GET') return courierMe(request, env);
  if (path === '/api/courier/change-password' && method === 'POST') return courierChangePassword(request, env);
  if (path === '/api/courier/tasks' && method === 'GET') return courierSessionTaskApi(request, env, url, 'tasks');
  let courierSessionMatch = path.match(/^\/api\/courier\/requisitions\/(\d+)\/(accept|collect)$/);
  if (courierSessionMatch && method === 'POST') {
    return courierSessionTaskApi(request, env, url, `requisitions/${courierSessionMatch[1]}/${courierSessionMatch[2]}`);
  }

  // Compatibilidade com o link/token antigo do entregador.
  const courierMatch = path.match(/^\/api\/courier\/([^/]+)(?:\/(.*))?$/);
  if (courierMatch && !['login','logout','me','change-password','tasks','requisitions'].includes(courierMatch[1])) {
    return courierApi(request, env, url, decodeURIComponent(courierMatch[1]), courierMatch[2] || '');
  }

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
  if (path === '/api/couriers' && method === 'POST') return requireAdminOnly(user, () => createCourier(request, env, user));
  m = path.match(/^\/api\/couriers\/(\d+)$/);
  if (m && method === 'PATCH') return requireAdminOnly(user, () => updateCourier(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/couriers\/(\d+)\/reset-password$/);
  if (m && method === 'POST') return requireAdminOnly(user, () => resetCourierPassword(request, env, user, Number(m[1])));
  // Mantido apenas por compatibilidade com links antigos. A interface nova não depende deste recurso.
  m = path.match(/^\/api\/couriers\/(\d+)\/regenerate-link$/);
  if (m && method === 'POST') return requireAdminOnly(user, () => regenerateCourierLink(env, user, Number(m[1]), url));

  if ((path === '/api/technicians' || path === '/api/receivers') && method === 'GET') return requireAdmin(user, () => listReceivers(env));
  if ((path === '/api/technicians' || path === '/api/receivers') && method === 'POST') return requireAdminOnly(user, () => createReceiver(request, env, user));
  m = path.match(/^\/api\/(?:technicians|receivers)\/(\d+)$/);
  if (m && method === 'PATCH') return requireAdminOnly(user, () => updateReceiver(request, env, user, Number(m[1])));
  m = path.match(/^\/api\/technicians\/(\d+)\/reset-password$/);
  if (m && method === 'POST') return requireAdminOnly(user, () => resetTechnicianPassword(request, env, user, Number(m[1])));

  if (path === '/api/exam-timing/settings' && method === 'GET') return requireAdmin(user, () => examTimingSettings(env));
  if (path === '/api/exam-timing/settings' && method === 'PUT') return requireAdminOnly(user, () => updateExamTimingSettings(request, env, user));
  if (path === '/api/exam-timing/board' && method === 'GET') return requireAdmin(user, () => examTimingBoard(env, user, url));
  if (path === '/api/exam-timing/report' && method === 'GET') return requireAdmin(user, () => examTimingReport(env, user, url));
  m = path.match(/^\/api\/exam-timing\/exams\/(\d+)\/complete$/);
  if (m && method === 'POST') return requireAdmin(user, () => completeTimedExam(env, user, Number(m[1])));

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
  m = path.match(/^\/api\/results\/(\d+)\/analysis$/);
  if (m && method === 'GET') return requireClient(user, () => getResultAnalysis(env, user, Number(m[1])));
  if (m && (method === 'PUT' || method === 'POST')) return requireClient(user, () => saveResultAnalysis(request, env, user, Number(m[1])));
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


function ownerCookieToken(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)hlab_owner_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function ownerSessionCookie(token, expires, secure = true) {
  return `hlab_owner_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expires).toUTCString()}${secure ? '; Secure' : ''}`;
}
function clearOwnerSessionCookie(secure = true) {
  return `hlab_owner_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

async function ownerGet(request, env) {
  const token = ownerCookieToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT oa.id,oa.username_display,oa.username_key,oa.active,os.expires_at
    FROM owner_sessions os JOIN owner_accounts oa ON oa.id=os.owner_account_id
    WHERE os.token_hash=?
  `).bind(tokenHash).first();
  if (!row || !row.active || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row) await env.DB.prepare('DELETE FROM owner_sessions WHERE token_hash=?').bind(tokenHash).run();
    return null;
  }
  return row;
}

async function ownerRequire(request, env) {
  const owner = await ownerGet(request, env);
  return owner || null;
}

async function ownerLogin(request, env, url) {
  const body = await safeBody(request);
  const usernameKey = normalizeUsername(body?.username || '');
  const owner = await env.DB.prepare('SELECT * FROM owner_accounts WHERE username_key=? AND active=1').bind(usernameKey).first();
  if (!owner || !await verifyPassword(String(body?.password || ''), owner.password_hash, owner.password_salt)) {
    return err('Usuário ou senha inválidos.', 401);
  }
  await env.DB.prepare('DELETE FROM owner_sessions WHERE expires_at<=?').bind(nowIso()).run();
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const days = Math.max(1, Number(env.OWNER_SESSION_DAYS || env.SESSION_DAYS || 14));
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO owner_sessions(token_hash,owner_account_id,expires_at) VALUES(?,?,?)')
    .bind(tokenHash, owner.id, expires).run();
  return json({ok:true, owner:{id:owner.id,username:owner.username_display}}, 200, {
    'set-cookie': ownerSessionCookie(token, expires, url.protocol === 'https:')
  });
}

async function ownerLogout(request, env, url) {
  const token = ownerCookieToken(request);
  if (token) await env.DB.prepare('DELETE FROM owner_sessions WHERE token_hash=?').bind(await sha256(token)).run();
  return json({ok:true}, 200, {'set-cookie': clearOwnerSessionCookie(url.protocol === 'https:')});
}

async function ownerMe(request, env) {
  const owner = await ownerRequire(request, env);
  if (!owner) return err('Acesso do proprietário não autorizado.', 401);
  return ok({owner:{id:owner.id,username:owner.username_display}});
}

function ownerMonth(value='') {
  const v=String(value||'').trim();
  if(/^\d{4}-\d{2}$/.test(v)) return v;
  return fortalezaToday().slice(0,7);
}

async function ownerR2Stats(env, maxObjects=20000) {
  let cursor=undefined, count=0, bytes=0, truncated=false, loops=0;
  do {
    const page=await env.FILES.list({limit:1000,cursor});
    for(const o of page.objects||[]){count++;bytes+=Number(o.size||0);if(count>=maxObjects){truncated=true;break;}}
    if(truncated) break;
    cursor=page.truncated?page.cursor:undefined;
    loops++;
  } while(cursor && loops<25);
  if(cursor) truncated=true;
  return {count,bytes,truncated};
}

async function ownerDbSize(env) {
  try {
    const pc=await env.DB.prepare('PRAGMA page_count').first();
    const ps=await env.DB.prepare('PRAGMA page_size').first();
    const pageCount=Number(pc?.page_count ?? Object.values(pc||{})[0] ?? 0);
    const pageSize=Number(ps?.page_size ?? Object.values(ps||{})[0] ?? 0);
    return pageCount && pageSize ? pageCount*pageSize : null;
  } catch { return null; }
}

async function ownerPricingFor(env, activeClients) {
  const tier=await env.DB.prepare(`
    SELECT * FROM owner_pricing_tiers
    WHERE active=1 AND min_clients<=? AND (max_clients IS NULL OR max_clients>=?)
    ORDER BY sort_order,id LIMIT 1
  `).bind(activeClients,activeClients).first();
  const contract=await env.DB.prepare('SELECT * FROM owner_contract_settings WHERE id=1').first();
  const suggested=Number(tier?.monthly_cents||0);
  const contracted=contract?.contracted_monthly_cents==null ? null : Number(contract.contracted_monthly_cents);
  const base=contracted==null?suggested:contracted;
  const discount=Number(contract?.discount_cents||0);
  return {tier,suggestedCents:suggested,contractedCents:contracted,discountCents:discount,finalCents:Math.max(0,base-discount),dueDay:Number(contract?.due_day||10),notes:contract?.notes||''};
}

async function ownerDashboard(request, env, url) {
  const owner=await ownerRequire(request,env);if(!owner)return err('Acesso do proprietário não autorizado.',401);
  const month=ownerMonth(url.searchParams.get('month'));
  const t0=performance.now();
  await env.DB.prepare('SELECT 1 AS ok').first();
  const dbLatencyMs=Math.max(0,Math.round((performance.now()-t0)*10)/10);
  const [clients,activeClients,requests,exams,results,tutors,couriers,staff,dbBytes,r2]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) n,SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) active_n FROM clients`).first(),
    env.DB.prepare(`SELECT COUNT(DISTINCT client_id) n FROM requisitions WHERE status<>'cancelado' AND strftime('%Y-%m',datetime(created_at,'-3 hours'))=?`).bind(month).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM requisitions WHERE status<>'cancelado' AND strftime('%Y-%m',datetime(created_at,'-3 hours'))=?`).bind(month).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM requisition_exams e JOIN requisitions r ON r.id=e.requisition_id WHERE r.status<>'cancelado' AND strftime('%Y-%m',datetime(r.created_at,'-3 hours'))=?`).bind(month).first(),
    env.DB.prepare(`SELECT COUNT(*) n,COALESCE(SUM(size_bytes),0) bytes FROM result_files rf JOIN requisitions r ON r.id=rf.requisition_id WHERE r.status<>'cancelado'`).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM tutors WHERE active=1`).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM couriers WHERE active=1`).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM receivers WHERE active=1`).first(),
    ownerDbSize(env),
    ownerR2Stats(env)
  ]);
  const activeN=Number(activeClients?.n||0);
  const pricing=await ownerPricingFor(env,activeN);
  const backups=await env.DB.prepare(`SELECT id,r2_key,size_bytes,kind,created_by,created_at FROM owner_backup_log ORDER BY id DESC LIMIT 5`).all();
  return ok({
    month,
    counts:{registeredClients:Number(clients?.n||0),enabledClients:Number(clients?.active_n||0),activeClients:activeN,requests:Number(requests?.n||0),exams:Number(exams?.n||0),results:Number(results?.n||0),tutors:Number(tutors?.n||0),couriers:Number(couriers?.n||0),staff:Number(staff?.n||0)},
    storage:{databaseBytes:dbBytes,resultBytes:Number(results?.bytes||0),r2Bytes:r2.bytes,r2Objects:r2.count,r2Truncated:r2.truncated},
    health:{api:'online',database:'online',r2:'online',dbLatencyMs},
    pricing,
    backups:backups.results||[]
  });
}

async function ownerPricing(request, env) {
  const owner=await ownerRequire(request,env);if(!owner)return err('Acesso do proprietário não autorizado.',401);
  const tiers=await env.DB.prepare('SELECT * FROM owner_pricing_tiers WHERE active=1 ORDER BY sort_order,id').all();
  const contract=await env.DB.prepare('SELECT * FROM owner_contract_settings WHERE id=1').first();
  return ok({tiers:tiers.results||[],contract});
}

async function ownerUpdatePricing(request, env) {
  const owner=await ownerRequire(request,env);if(!owner)return err('Acesso do proprietário não autorizado.',401);
  const body=await safeBody(request);if(!body)return err('Dados inválidos.');
  const stmts=[];
  if(Array.isArray(body.tiers)){
    for(const item of body.tiers){
      const id=Number(item.id),cents=Math.round(Number(item.monthlyCents));
      if(!Number.isInteger(id)||id<1||!Number.isFinite(cents)||cents<0)return err('Faixa de preço inválida.');
      stmts.push(env.DB.prepare('UPDATE owner_pricing_tiers SET monthly_cents=?,updated_at=? WHERE id=?').bind(cents,nowIso(),id));
    }
  }
  const contracted=body.contractedMonthlyCents==null||body.contractedMonthlyCents===''?null:Math.round(Number(body.contractedMonthlyCents));
  const discount=Math.max(0,Math.round(Number(body.discountCents||0)));
  const dueDay=Math.max(1,Math.min(28,Math.round(Number(body.dueDay||10))));
  if(contracted!==null && (!Number.isFinite(contracted)||contracted<0))return err('Valor contratado inválido.');
  stmts.push(env.DB.prepare(`UPDATE owner_contract_settings SET contracted_monthly_cents=?,discount_cents=?,due_day=?,notes=?,updated_at=? WHERE id=1`)
    .bind(contracted,discount,dueDay,clampString(body.notes||'',1000),nowIso()));
  if(stmts.length)await env.DB.batch(stmts);
  return ok({message:'Configuração comercial salva.'});
}

async function ownerChangePassword(request, env) {
  const owner=await ownerRequire(request,env);if(!owner)return err('Acesso do proprietário não autorizado.',401);
  const body=await safeBody(request),current=String(body?.currentPassword||''),next=String(body?.newPassword||'');
  const dbu=await env.DB.prepare('SELECT * FROM owner_accounts WHERE id=?').bind(owner.id).first();
  if(!dbu||!await verifyPassword(current,dbu.password_hash,dbu.password_salt))return err('Senha atual incorreta.',400);
  if(next.length<10)return err('A nova senha deve ter pelo menos 10 caracteres.');
  if(next===current)return err('A nova senha deve ser diferente da atual.');
  const hp=await hashPassword(next);
  await env.DB.prepare('UPDATE owner_accounts SET password_hash=?,password_salt=?,updated_at=? WHERE id=?').bind(hp.hash,hp.salt,nowIso(),owner.id).run();
  await env.DB.prepare('DELETE FROM owner_sessions WHERE owner_account_id=? AND token_hash<>?')
    .bind(owner.id,await sha256(ownerCookieToken(request)||'')).run();
  return ok({message:'Senha do proprietário alterada com sucesso.'});
}

async function ownerLogicalSnapshot(env) {
  const tables={};
  const specs={
    clients:`SELECT * FROM clients ORDER BY id`,
    client_members:`SELECT cm.*,u.username_display FROM client_members cm LEFT JOIN users u ON u.id=cm.user_id ORDER BY cm.id`,
    tutors:`SELECT t.*,u.username_display FROM tutors t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.id`,
    couriers:`SELECT c.*,ca.username_display AS login_username FROM couriers c LEFT JOIN courier_accounts ca ON ca.courier_id=c.id ORDER BY c.id`,
    receivers:`SELECT r.*,u.username_display FROM receivers r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.id`,
    requisitions:`SELECT * FROM requisitions ORDER BY id`,
    requisition_exams:`SELECT * FROM requisition_exams ORDER BY id`,
    requisition_materials:`SELECT * FROM requisition_materials ORDER BY id`,
    status_events:`SELECT * FROM status_events ORDER BY id`,
    result_files:`SELECT * FROM result_files ORDER BY id`,
    result_analyses:`SELECT * FROM result_analyses ORDER BY result_file_id`,
    exam_prices:`SELECT * FROM exam_prices ORDER BY exam_code`,
    client_exam_prices:`SELECT * FROM client_exam_prices ORDER BY id`,
    exam_turnaround_settings:`SELECT * FROM exam_turnaround_settings ORDER BY exam_name`,
    lab_timing_settings:`SELECT * FROM lab_timing_settings ORDER BY id`,
    lab_alerts:`SELECT * FROM lab_alerts ORDER BY id`
  };
  for(const [name,sql] of Object.entries(specs)){
    try{const r=await env.DB.prepare(sql).all();tables[name]=r.results||[];}catch{tables[name]=[];}
  }
  return {format:'HLabVet logical backup v1',createdAt:nowIso(),tables};
}

async function ownerCreateBackup(request, env) {
  const owner=await ownerRequire(request,env);if(!owner)return err('Acesso do proprietário não autorizado.',401);
  const snap=await ownerLogicalSnapshot(env);
  const data=JSON.stringify(snap);
  const stamp=nowIso().replace(/[:.]/g,'-');
  const key=`backups/hlabvet-${stamp}.json`;
  await env.FILES.put(key,data,{httpMetadata:{contentType:'application/json; charset=utf-8'}});
  await env.DB.prepare('INSERT INTO owner_backup_log(r2_key,size_bytes,kind,created_by) VALUES(?,?,?,?)')
    .bind(key,new TextEncoder().encode(data).length,'logical',owner.username_display).run();
  return ok({message:'Backup lógico criado.',key,sizeBytes:new TextEncoder().encode(data).length});
}

async function ownerListBackups(request,env){
  const owner=await ownerRequire(request,env);if(!owner)return err('Acesso do proprietário não autorizado.',401);
  const rows=await env.DB.prepare('SELECT * FROM owner_backup_log ORDER BY id DESC LIMIT 50').all();
  return ok({backups:rows.results||[]});
}

function csvCell(v){
  if(v==null)return '';
  const s=typeof v==='object'?JSON.stringify(v):String(v);
  return /["\n\r,;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
function rowsToCsv(rows){
  if(!rows?.length)return '';
  const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  return '\ufeff'+cols.join(';')+'\r\n'+rows.map(r=>cols.map(c=>csvCell(r[c])).join(';')).join('\r\n');
}
function safeZipName(v){return String(v||'arquivo').replace(/[\\/:*?"<>|\r\n]+/g,'_').replace(/^\.+/,'').slice(0,180)||'arquivo';}
function crc32(bytes){
  let c=0xffffffff;
  for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}
  return (c^0xffffffff)>>>0;
}
function u16(n){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,n,true);return a;}
function u32(n){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n>>>0,true);return a;}
function concatBytes(parts){let len=0;for(const p of parts)len+=p.length;const out=new Uint8Array(len);let off=0;for(const p of parts){out.set(p,off);off+=p.length;}return out;}
function zipDosDate(d=new Date()){
  const year=Math.max(1980,d.getFullYear());
  return {time:(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),date:((year-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()};
}
function buildStoreZip(entries){
  const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;const dt=zipDosDate();
  for(const e of entries){
    const name=enc.encode(e.name),data=e.data instanceof Uint8Array?e.data:enc.encode(String(e.data??'')),crc=crc32(data);
    const local=concatBytes([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(dt.time),u16(dt.date),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);
    locals.push(local);
    const central=concatBytes([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(dt.time),u16(dt.date),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);
    centrals.push(central);offset+=local.length;
  }
  const centralSize=centrals.reduce((n,a)=>n+a.length,0);
  const end=concatBytes([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(centralSize),u32(offset),u16(0)]);
  return concatBytes([...locals,...centrals,end]);
}

async function ownerExportZip(request, env, url) {
  const owner=await ownerRequire(request,env);if(!owner)return err('Acesso do proprietário não autorizado.',401);
  const snap=await ownerLogicalSnapshot(env),entries=[];
  entries.push({name:'00_LEIA-ME.txt',data:`Exportação HLabVet\nGerada em: ${snap.createdAt}\nContém dados operacionais em CSV/JSON e arquivos de resultados encontrados no R2.\nSenhas, hashes e sessões não são exportados.\n`});
  entries.push({name:'01_DADOS/dados_completos.json',data:JSON.stringify(snap,null,2)});
  const map={clients:'clientes',client_members:'usuarios_clientes',tutors:'tutores',couriers:'entregadores',receivers:'tecnicos_laboratorio',requisitions:'solicitacoes',requisition_exams:'exames_solicitados',requisition_materials:'materiais',status_events:'historico_status',result_files:'indice_resultados',result_analyses:'analises_resultados',exam_prices:'precos_gerais',client_exam_prices:'precos_por_cliente',exam_turnaround_settings:'tempos_por_exame',lab_timing_settings:'configuracao_tempo_exames',lab_alerts:'alertas_cancelamentos'};
  for(const [table,filename] of Object.entries(map))entries.push({name:`01_DADOS/${filename}.csv`,data:rowsToCsv(snap.tables[table]||[])});
  let total=entries.reduce((n,e)=>n+(typeof e.data==='string'?new TextEncoder().encode(e.data).length:e.data.length),0);
  const maxBytes=80*1024*1024;
  for(const rf of snap.tables.result_files||[]){
    if(!rf.r2_key)continue;
    const obj=await env.FILES.get(rf.r2_key);if(!obj)continue;
    const bytes=new Uint8Array(await obj.arrayBuffer());
    if(total+bytes.length>maxBytes)return err('A exportação completa ultrapassou 80 MB. Faça exportações periódicas ou use o procedimento de exportação em lote.',413,{estimatedBytes:total+bytes.length});
    const req=(snap.tables.requisitions||[]).find(r=>Number(r.id)===Number(rf.requisition_id));
    entries.push({name:`02_RESULTADOS/${safeZipName(req?.protocol||`requisicao-${rf.requisition_id}`)}/${String(rf.id).padStart(6,'0')}-${safeZipName(rf.original_name)}`,data:bytes});
    total+=bytes.length;
  }
  const zip=buildStoreZip(entries);
  const stamp=fortalezaToday();
  return new Response(zip,{status:200,headers:{'content-type':'application/zip','content-disposition':`attachment; filename="HLabVet-exportacao-${stamp}.zip"`,'cache-control':'no-store'}});
}

async function ownerDeleteAllR2(env){
  let cursor=undefined,loops=0;const keys=[];
  do{
    const page=await env.FILES.list({limit:1000,cursor});
    for(const o of page.objects||[])keys.push(o.key);
    cursor=page.truncated?page.cursor:undefined;loops++;
  }while(cursor&&loops<100);
  if(cursor)throw new Error('Há arquivos demais para o reset seguro em uma única operação. Faça a limpeza em lote.');
  for(let i=0;i<keys.length;i+=100)await env.FILES.delete(keys.slice(i,i+100));
  return keys.length;
}

async function ownerResetSystem(request, env) {
  const owner=await ownerRequire(request,env);if(!owner)return err('Acesso do proprietário não autorizado.',401);
  const body=await safeBody(request);
  if(String(body?.confirmation||'').trim().toUpperCase()!=='ZERAR HLABVET')return err('Confirmação incorreta. Digite exatamente ZERAR HLABVET.');
  const dbOwner=await env.DB.prepare('SELECT * FROM owner_accounts WHERE id=?').bind(owner.id).first();
  if(!dbOwner||!await verifyPassword(String(body?.password||''),dbOwner.password_hash,dbOwner.password_salt))return err('Senha do proprietário incorreta.',401);
  const deletedFiles=await ownerDeleteAllR2(env);
  const stmts=[
    'DELETE FROM lab_alerts','DELETE FROM result_analyses','DELETE FROM result_files','DELETE FROM status_events','DELETE FROM requisition_materials','DELETE FROM requisition_exams','DELETE FROM requisitions',
    'DELETE FROM client_exam_prices','DELETE FROM exam_prices','DELETE FROM exam_turnaround_settings','DELETE FROM lab_timing_settings','INSERT INTO lab_timing_settings(id,default_turnaround_minutes,warning_minutes) VALUES(1,1440,10)','DELETE FROM tutors','DELETE FROM client_members','DELETE FROM clients',
    'DELETE FROM courier_sessions','DELETE FROM courier_accounts','DELETE FROM couriers','DELETE FROM receivers','DELETE FROM sessions','DELETE FROM audit_log',
    `DELETE FROM users WHERE username_key<>'hlabvet'`,
    `UPDATE users SET role='admin',username_display='HLabVet',username_key='hlabvet',password_hash='TwP_yjkuugIsPRV71Z4e0rVeTcmPgXU7YImyBgrCPLI',password_salt='pinBnr9TtE24ToDkIXYa6g',force_password_change=1,active=1,updated_at=CURRENT_TIMESTAMP WHERE username_key='hlabvet'`,
    'DELETE FROM owner_backup_log'
  ].map(sql=>env.DB.prepare(sql));
  await env.DB.batch(stmts);
  return ok({message:'HLabVet zerado para primeiro uso. Somente o administrador HLabVet foi preservado e voltou para a senha inicial com troca obrigatória.',deletedFiles});
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

async function labDashboardCharts(env){
  const [dailyRows,statusRows,examRows,clientRows]=await Promise.all([
    env.DB.prepare(`SELECT date(datetime(created_at,'-3 hours')) day,COUNT(*) n FROM requisitions WHERE status<>'cancelado' AND datetime(created_at,'-3 hours')>=datetime('now','-3 hours','-13 days','start of day') GROUP BY day ORDER BY day`).all(),
    env.DB.prepare(`SELECT status,COUNT(*) n FROM requisitions WHERE datetime(created_at,'-3 hours')>=datetime('now','-3 hours','-29 days','start of day') GROUP BY status ORDER BY n DESC`).all(),
    env.DB.prepare(`SELECT e.exam_name label,COUNT(*) n FROM requisition_exams e JOIN requisitions r ON r.id=e.requisition_id WHERE r.status<>'cancelado' AND datetime(r.created_at,'-3 hours')>=datetime('now','-3 hours','-29 days','start of day') GROUP BY e.exam_name ORDER BY n DESC,e.exam_name LIMIT 6`).all(),
    env.DB.prepare(`SELECT c.name label,COUNT(*) n FROM requisitions r JOIN clients c ON c.id=r.client_id WHERE r.status<>'cancelado' AND datetime(r.created_at,'-3 hours')>=datetime('now','-3 hours','-29 days','start of day') GROUP BY c.id,c.name ORDER BY n DESC,c.name LIMIT 6`).all()
  ]);
  const map=new Map((dailyRows.results||[]).map(x=>[x.day,Number(x.n||0)]));
  const daily=[];
  const base=new Date(Date.now()-3*3600000);
  for(let i=13;i>=0;i--){
    const d=new Date(base);d.setUTCDate(d.getUTCDate()-i);
    const day=d.toISOString().slice(0,10);daily.push({day,n:map.get(day)||0});
  }
  return {
    daily,
    status30:(statusRows.results||[]).map(x=>({status:x.status,n:Number(x.n||0)})),
    topExams:(examRows.results||[]).map(x=>({label:x.label,n:Number(x.n||0)})),
    topClients:(clientRows.results||[]).map(x=>({label:x.label,n:Number(x.n||0)}))
  };
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
  const charts=ADMIN_ROLES.has(user.role)?await labDashboardCharts(env):null;
  return ok({ totals, recent: recent.results || [], charts, day: new Date(Date.now()-3*3600000).toISOString().slice(0,10) });
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
  const rows=await env.DB.prepare(`
    SELECT c.id,c.name,c.phone,c.token_last4,c.thermometer_code,c.active,c.created_at,c.updated_at,
           ca.id AS account_id,ca.username_display,ca.force_password_change,ca.active AS account_active
    FROM couriers c
    LEFT JOIN courier_accounts ca ON ca.courier_id=c.id
    ORDER BY c.active DESC,c.name COLLATE NOCASE
  `).all();
  return ok({couriers:rows.results||[]});
}

function normalizeThermometer(v){
  const raw=String(v||'').trim().toUpperCase().replace(/\s+/g,'');
  if(!raw)return '';
  const m=raw.match(/^TER-?(\d{1,4})$/);
  return m ? `TER-${String(Number(m[1])).padStart(3,'0')}` : raw;
}

async function courierUsernameExists(env,key,excludeAccountId=null){
  if(await env.DB.prepare('SELECT id FROM users WHERE username_key=?').bind(key).first())return true;
  const row=excludeAccountId
    ? await env.DB.prepare('SELECT id FROM courier_accounts WHERE username_key=? AND id<>?').bind(key,excludeAccountId).first()
    : await env.DB.prepare('SELECT id FROM courier_accounts WHERE username_key=?').bind(key).first();
  return !!row;
}

async function createCourier(request,env,user){
  const b=await safeBody(request);
  const name=clampString(b?.name,160),username=clampString(b?.username,120),password=String(b?.password||'');
  if(!name||!username||password.length<8)return err('Nome, usuário e senha inicial do entregador (mínimo 8 caracteres) são obrigatórios.');
  const thermometer=normalizeThermometer(b?.thermometerCode);
  if(!/^TER-\d{3,4}$/.test(thermometer))return err('Informe o termômetro no padrão TER-001.');
  const used=await env.DB.prepare(`SELECT id,name FROM couriers WHERE active=1 AND thermometer_code=?`).bind(thermometer).first();
  if(used)return err(`O ${thermometer} já está vinculado a ${used.name}. Desative ou altere o entregador anterior antes de reutilizar o termômetro.`,409);
  const key=normalizeUsername(username);
  if(await courierUsernameExists(env,key))return err('Esse nome de usuário já está em uso.',409);
  const legacyToken=randomToken(30),legacyHash=await sha256(legacyToken);
  const {hash:passwordHash,salt}=await hashPassword(password);
  const r=await env.DB.prepare('INSERT INTO couriers(name,phone,token_hash,token_last4,thermometer_code,active) VALUES(?,?,?,?,?,1)')
    .bind(name,clampString(b.phone,40),legacyHash,legacyToken.slice(-4),thermometer).run();
  const courierId=r.meta.last_row_id;
  try{
    await env.DB.prepare(`INSERT INTO courier_accounts(courier_id,username_display,username_key,password_hash,password_salt,force_password_change,active)
      VALUES(?,?,?,?,?,1,1)`).bind(courierId,username,key,passwordHash,salt).run();
  }catch(e){
    await env.DB.prepare('DELETE FROM couriers WHERE id=?').bind(courierId).run();
    throw e;
  }
  await audit(env,user,'criou_entregador','courier',courierId,{name,username,thermometer});
  return ok({id:courierId,message:`Entregador cadastrado. Login: ${username}. No primeiro acesso ele deverá trocar a senha.`});
}

async function updateCourier(request,env,user,id){
  const b=await safeBody(request);
  const c=await env.DB.prepare(`
    SELECT c.*,ca.id account_id,ca.username_display,ca.active account_active
    FROM couriers c LEFT JOIN courier_accounts ca ON ca.courier_id=c.id
    WHERE c.id=?
  `).bind(id).first();
  if(!c)return err('Entregador não encontrado.',404);
  const active=b.active==null?c.active:boolInt(b.active);
  const thermometer=normalizeThermometer(b.thermometerCode??c.thermometer_code);
  if(active&&!/^TER-\d{3,4}$/.test(thermometer))return err('Informe o termômetro no padrão TER-001.');
  if(active){
    const used=await env.DB.prepare(`SELECT id,name FROM couriers WHERE active=1 AND thermometer_code=? AND id<>?`).bind(thermometer,id).first();
    if(used)return err(`O ${thermometer} já está vinculado a ${used.name}.`,409);
  }
  const username=clampString(b?.username??c.username_display,120);
  if(!username)return err('Informe o usuário de acesso do entregador.');
  const key=normalizeUsername(username);
  if(c.account_id){
    if(await courierUsernameExists(env,key,c.account_id))return err('Esse nome de usuário já está em uso.',409);
    await env.DB.prepare(`UPDATE courier_accounts SET username_display=?,username_key=?,active=?,updated_at=? WHERE id=?`)
      .bind(username,key,active,nowIso(),c.account_id).run();
    if(!active)await env.DB.prepare('DELETE FROM courier_sessions WHERE courier_account_id=?').bind(c.account_id).run();
  }else{
    const password=String(b?.password||'');
    if(password.length<8)return err('Esse entregador ainda não possui login. Informe uma senha inicial com pelo menos 8 caracteres.');
    if(await courierUsernameExists(env,key))return err('Esse nome de usuário já está em uso.',409);
    const {hash:passwordHash,salt}=await hashPassword(password);
    await env.DB.prepare(`INSERT INTO courier_accounts(courier_id,username_display,username_key,password_hash,password_salt,force_password_change,active)
      VALUES(?,?,?,?,?,1,?)`).bind(id,username,key,passwordHash,salt,active).run();
  }
  await env.DB.prepare('UPDATE couriers SET name=?,phone=?,thermometer_code=?,active=?,updated_at=? WHERE id=?')
    .bind(clampString(b.name??c.name,160),clampString(b.phone??c.phone,40),thermometer||null,active,nowIso(),id).run();
  await audit(env,user,'editou_entregador','courier',id,{thermometer,username,active:!!active});
  return ok({message:c.account_id?'Entregador atualizado.':'Login do entregador criado e cadastro atualizado.'});
}

async function resetCourierPassword(request,env,user,id){
  const b=await safeBody(request),pwd=String(b?.password||'');
  if(pwd.length<8)return err('A senha temporária deve ter pelo menos 8 caracteres.');
  const row=await env.DB.prepare(`
    SELECT ca.id account_id,c.name
    FROM couriers c JOIN courier_accounts ca ON ca.courier_id=c.id
    WHERE c.id=?
  `).bind(id).first();
  if(!row)return err('Este entregador ainda não possui login cadastrado.',404);
  const {hash,salt}=await hashPassword(pwd);
  await env.DB.prepare(`UPDATE courier_accounts SET password_hash=?,password_salt=?,force_password_change=1,updated_at=? WHERE id=?`)
    .bind(hash,salt,nowIso(),row.account_id).run();
  await env.DB.prepare('DELETE FROM courier_sessions WHERE courier_account_id=?').bind(row.account_id).run();
  await audit(env,user,'redefiniu_senha_entregador','courier',id,{name:row.name});
  return ok({message:'Senha temporária definida. O entregador deverá trocá-la no próximo acesso.'});
}

async function regenerateCourierLink(env,user,id,url){
  const c=await env.DB.prepare('SELECT id,name FROM couriers WHERE id=?').bind(id).first(); if(!c)return err('Entregador não encontrado.',404);
  const token=randomToken(30), hash=await sha256(token);
  await env.DB.prepare('UPDATE couriers SET token_hash=?,token_last4=?,updated_at=? WHERE id=?').bind(hash,token.slice(-4),nowIso(),id).run();
  await audit(env,user,'regenerou_link_entregador','courier',id);
  return ok({link:courierLink(url,token),message:'Novo link legado criado.'});
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
  let sql=`SELECT r.id,r.protocol,r.status,r.priority,r.patient_name,r.species,r.breed,r.birth_date,r.tutor_name,r.created_at,r.collection_date,r.assigned_at,r.collected_at,r.collection_temperature,r.lab_received_at,r.lab_received_temperature,r.analysis_started_at,r.completed_at,r.request_kind,r.scheduled_at,r.accepted_at,r.accepted_by_name,c.name client_name,co.name courier_name,CASE WHEN r.status='cancelado' THEN 0 ELSE (SELECT COUNT(*) FROM result_files rf WHERE rf.requisition_id=r.id) END result_count FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE 1=1`;
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
  const priority=['normal','priority','urgent'].includes(String(b.priority||''))?String(b.priority):'normal';
  let scheduledAt=null;
  if(requestKind==='scheduled'){
    const dt=new Date(String(b.scheduledAt||''));if(!Number.isFinite(dt.getTime()))return err('Informe a data e hora do agendamento.');
    if(dt.getTime()<Date.now()-60000)return err('O agendamento deve ser para um horário futuro.');scheduledAt=dt.toISOString();
  }
  const birthDate=clampString(b.birthDate,20);
  const collectionDate=clampString(b.collectionDate,20);
  if(birthDate&&collectionDate&&!exactAgeText(birthDate,collectionDate))return err('A data de nascimento não pode ser posterior à data prevista da coleta.');
  const ageText=clampString(b.ageText,60)||exactAgeText(birthDate,collectionDate||fortalezaToday());

  const tempProto=`TEMP-${crypto.randomUUID()}`;
  const requesterName=member?.name||user.username_display;
  const ins=await env.DB.prepare(`INSERT INTO requisitions(protocol,client_id,status,priority,clinic_name,veterinarian_name,crmv,tutor_name,tutor_account_id,patient_name,species,breed,sex,birth_date,age_text,collection_date,clinical_info,material_other,stamp_snapshot_json,observations,request_kind,scheduled_at,requested_by_user_id,requested_by_name) VALUES(?,?,'solicitado',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(tempProto,clientId,priority,clampString(b.clinicName,200)||client.name,veterinarianName,crmv,tutorName,tutorAccount?.id||null,patient,clampString(b.species,100),clampString(b.breed,120),clampString(b.sex,20),birthDate,ageText,collectionDate,clampString(b.clinicalInfo,5000),clampString(b.materialOther,500),Object.keys(stamp).length?JSON.stringify(stamp):null,clampString(b.observations,2000),requestKind,scheduledAt,user.id,requesterName).run();
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
  statements.push(env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json) VALUES(?,'solicitado',?,?,?)`).bind(id,user.id,requesterName,JSON.stringify({message,requestKind,scheduledAt,priority,missingPriceCount})));
  await env.DB.batch(statements); await audit(env,user,'criou_requisicao','requisition',id,{protocol:proto,patient,requestKind,scheduledAt,priority,missingPriceCount,requesterName});
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
    env.DB.prepare('SELECT id,category,exam_code,exam_name,turnaround_minutes,due_at,completed_at,completed_by_name,completed_within_sla FROM requisition_exams WHERE requisition_id=? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT material_name FROM requisition_materials WHERE requisition_id=? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT status,actor_name,details_json,created_at FROM status_events WHERE requisition_id=? ORDER BY created_at,id').bind(id).all(),
    env.DB.prepare(`SELECT rf.id,rf.original_name,rf.mime_type,rf.size_bytes,rf.created_at,CASE WHEN EXISTS(SELECT 1 FROM result_analyses ra WHERE ra.result_file_id=rf.id) THEN 1 ELSE 0 END analysis_exists FROM result_files rf WHERE rf.requisition_id=? ORDER BY rf.created_at DESC`).bind(id).all()
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
  const timing=await env.DB.prepare('SELECT default_turnaround_minutes,warning_minutes FROM lab_timing_settings WHERE id=1').first();
  const defaultMinutes=Math.max(1,Number(timing?.default_turnaround_minutes||1440));
  const reqExams=await env.DB.prepare(`SELECT e.id,e.exam_code,COALESCE(s.turnaround_minutes,?) turnaround_minutes FROM requisition_exams e LEFT JOIN exam_turnaround_settings s ON s.exam_code=e.exam_code AND s.active=1 WHERE e.requisition_id=?`).bind(defaultMinutes,id).all();
  const timingStatements=(reqExams.results||[]).map(e=>{
    const minutes=Math.max(1,Number(e.turnaround_minutes||defaultMinutes));
    const dueAt=new Date(new Date(ts).getTime()+minutes*60000).toISOString();
    return env.DB.prepare(`UPDATE requisition_exams SET turnaround_minutes=?,due_at=?,completed_at=NULL,completed_by_user_id=NULL,completed_by_name=NULL,completed_within_sla=NULL WHERE id=?`).bind(minutes,dueAt,e.id);
  });
  await env.DB.batch([
    env.DB.prepare(`UPDATE requisitions SET status='recebido',lab_received_at=?,lab_received_temperature=?,receiver_id=?,receiver_name=?,received_location=?,receiving_observation=?,updated_at=? WHERE id=?`).bind(ts,temp,rec.id,rec.name,loc,obs,ts,id),
    env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'recebido',?,?,?,?)`).bind(id,user.id,rec.name,JSON.stringify({temperature:temp,receiver:rec.name,location:loc,observation:obs,timingStarted:true}),ts),
    ...timingStatements
  ]);
  await audit(env,user,'recebeu_amostra','requisition',id,{temperature:temp,receiver:rec.name,location:loc,observation:obs});return ok({message:`Recebimento registrado por ${rec.name} com data e hora automáticas.`});
}

async function markAnalysis(env,user,id){
  const r=await env.DB.prepare('SELECT status FROM requisitions WHERE id=?').bind(id).first(); if(!r)return err('Requisição não encontrada.',404);if(!['recebido','em_analise'].includes(r.status))return err('O exame deve estar recebido pelo laboratório.');
  const ts=nowIso();await env.DB.batch([env.DB.prepare(`UPDATE requisitions SET status='em_analise',analysis_started_at=COALESCE(analysis_started_at,?),updated_at=? WHERE id=?`).bind(ts,ts,id),env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'em_analise',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({message:'Amostra em análise'}),ts)]);await audit(env,user,'iniciou_analise','requisition',id);return ok({message:'Status alterado para Em análise.'});
}
async function markComplete(env,user,id){
  const r=await env.DB.prepare('SELECT status FROM requisitions WHERE id=?').bind(id).first();if(!r)return err('Requisição não encontrada.',404);if(!['recebido','em_analise','concluido'].includes(r.status))return err('Não é possível concluir nesse status.');
  const ts=nowIso();
  const pending=await env.DB.prepare('SELECT id,due_at FROM requisition_exams WHERE requisition_id=? AND completed_at IS NULL').bind(id).all();
  const examStatements=(pending.results||[]).map(e=>env.DB.prepare(`UPDATE requisition_exams SET completed_at=?,completed_by_user_id=?,completed_by_name=?,completed_within_sla=? WHERE id=?`).bind(ts,user.id,user.username_display,e.due_at?(new Date(ts).getTime()<=new Date(e.due_at).getTime()?1:0):null,e.id));
  await env.DB.batch([env.DB.prepare(`UPDATE requisitions SET status='concluido',completed_at=?,updated_at=? WHERE id=?`).bind(ts,ts,id),...examStatements,env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'concluido',?,?,?,?)`).bind(id,user.id,user.username_display,JSON.stringify({message:'Solicitação concluída e exames pendentes marcados como concluídos'}),ts)]);
  await audit(env,user,'concluiu_exame','requisition',id);return ok({message:'Solicitação concluída. Os exames pendentes também foram marcados como concluídos.'});
}
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
    env.DB.prepare('DELETE FROM result_analyses WHERE result_file_id=?').bind(fileId),
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

async function resultForClient(env,user,fileId){
  const row=await env.DB.prepare(`
    SELECT rf.id,rf.requisition_id,rf.original_name,rf.mime_type,rf.size_bytes,r.client_id,r.patient_name,r.protocol,r.status
    FROM result_files rf JOIN requisitions r ON r.id=rf.requisition_id
    WHERE rf.id=?
  `).bind(fileId).first();
  if(!row)return {error:err('Resultado não encontrado.',404)};
  if(user.role!=='client'||Number(row.client_id)!==Number(user.client_id)||row.status==='cancelado')return {error:err('Sem acesso a esta análise.',403)};
  return {row};
}

async function getResultAnalysis(env,user,fileId){
  const access=await resultForClient(env,user,fileId);if(access.error)return access.error;
  const a=await env.DB.prepare(`SELECT analysis_json,created_at,updated_at FROM result_analyses WHERE result_file_id=? AND client_id=?`).bind(fileId,user.client_id).first();
  return ok({analysis:a?parseJson(a.analysis_json):null,createdAt:a?.created_at||null,updatedAt:a?.updated_at||null,file:{id:access.row.id,name:access.row.original_name,mimeType:access.row.mime_type,sizeBytes:access.row.size_bytes,patientName:access.row.patient_name,protocol:access.row.protocol}});
}

async function saveResultAnalysis(request,env,user,fileId){
  const access=await resultForClient(env,user,fileId);if(access.error)return access.error;
  const b=await safeBody(request);const analysis=b?.analysis;
  if(!analysis||typeof analysis!=='object')return err('Análise inválida.',400);
  const params=Array.isArray(analysis.parameters)?analysis.parameters:[];
  if(params.length>300)return err('A análise excede o limite de parâmetros.',400);
  const clean={
    version:1,
    generatedAt:clampString(analysis.generatedAt,60)||nowIso(),
    source:'Referências informadas no próprio laudo',
    summary:{
      total:Number(analysis.summary?.total||params.length),normal:Number(analysis.summary?.normal||0),low:Number(analysis.summary?.low||0),high:Number(analysis.summary?.high||0),altered:Number(analysis.summary?.altered||0)
    },
    parameters:params.slice(0,300).map(x=>({
      name:clampString(x?.name,180),result:Number(x?.result),unit:clampString(x?.unit,50),referenceText:clampString(x?.referenceText,120),min:x?.min==null?null:Number(x.min),max:x?.max==null?null:Number(x.max),status:['normal','low','high'].includes(x?.status)?x.status:'normal',deviationPct:x?.deviationPct==null?null:Number(x.deviationPct)
    })).filter(x=>x.name&&Number.isFinite(x.result)),
    notes:clampString(analysis.notes,500)
  };
  clean.summary.total=clean.parameters.length;clean.summary.normal=clean.parameters.filter(x=>x.status==='normal').length;clean.summary.low=clean.parameters.filter(x=>x.status==='low').length;clean.summary.high=clean.parameters.filter(x=>x.status==='high').length;clean.summary.altered=clean.summary.low+clean.summary.high;
  const jsonText=JSON.stringify(clean);if(jsonText.length>120000)return err('A análise ficou muito grande.',400);
  const now=nowIso();
  await env.DB.prepare(`INSERT INTO result_analyses(result_file_id,requisition_id,client_id,created_by_user_id,analysis_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(result_file_id) DO UPDATE SET client_id=excluded.client_id,created_by_user_id=excluded.created_by_user_id,analysis_json=excluded.analysis_json,updated_at=excluded.updated_at`)
    .bind(fileId,access.row.requisition_id,user.client_id,user.id,jsonText,now,now).run();
  await audit(env,user,'analisou_resultado','result_file',fileId,{protocol:access.row.protocol,patient:access.row.patient_name,total:clean.summary.total,altered:clean.summary.altered});
  return ok({analysis:clean,message:'Análise salva e pronta para consulta.'});
}


function timingStatusForExam(row,warningMinutes,nowMs=Date.now()){
  const dueMs=row.due_at?new Date(row.due_at).getTime():NaN;
  const completedMs=row.completed_at?new Date(row.completed_at).getTime():NaN;
  if(row.completed_at){
    const late=Number.isFinite(dueMs)&&Number.isFinite(completedMs)&&completedMs>dueMs;
    return {status:late?'completed_late':'completed_on_time',seconds: Number.isFinite(dueMs)?Math.round((dueMs-completedMs)/1000):null};
  }
  if(!Number.isFinite(dueMs))return {status:'no_deadline',seconds:null};
  const seconds=Math.round((dueMs-nowMs)/1000);
  if(seconds<0)return {status:'late',seconds};
  if(seconds<=Math.max(1,Number(warningMinutes||10))*60)return {status:'warning',seconds};
  return {status:'on_time',seconds};
}

async function examTimingSettings(env){
  const base=await env.DB.prepare('SELECT default_turnaround_minutes,warning_minutes FROM lab_timing_settings WHERE id=1').first();
  const rows=await env.DB.prepare('SELECT exam_code,exam_name,turnaround_minutes,active FROM exam_turnaround_settings WHERE active=1 ORDER BY exam_name COLLATE NOCASE').all();
  return ok({defaultTurnaroundMinutes:Number(base?.default_turnaround_minutes||1440),warningMinutes:Number(base?.warning_minutes||10),overrides:rows.results||[],catalog:catalogWithCodes()});
}

async function updateExamTimingSettings(request,env,user){
  const b=await safeBody(request);if(!b)return err('Dados inválidos.');
  const mode=String(b.mode||'bulk');
  if(mode==='defaults'){
    const defaultMinutes=Math.round(Number(b.defaultTurnaroundMinutes));
    const warningMinutes=Math.round(Number(b.warningMinutes));
    if(!Number.isFinite(defaultMinutes)||defaultMinutes<1||defaultMinutes>60*24*30)return err('Informe um tempo padrão válido.');
    if(!Number.isFinite(warningMinutes)||warningMinutes<1||warningMinutes>1440)return err('Informe um aviso válido em minutos.');
    const ts=nowIso();
    await env.DB.prepare(`INSERT INTO lab_timing_settings(id,default_turnaround_minutes,warning_minutes,created_at,updated_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET default_turnaround_minutes=excluded.default_turnaround_minutes,warning_minutes=excluded.warning_minutes,updated_at=excluded.updated_at`).bind(defaultMinutes,warningMinutes,ts,ts).run();
    await audit(env,user,'alterou_tempo_padrao_exames','timing_settings',1,{defaultMinutes,warningMinutes});
    return ok({message:'Tempo padrão atualizado.'});
  }
  if(mode==='remove'){
    const codes=Array.isArray(b.examCodes)?[...new Set(b.examCodes.map(String).filter(Boolean))]:[];if(!codes.length)return err('Selecione pelo menos um exame.');
    const stmts=codes.map(code=>env.DB.prepare('DELETE FROM exam_turnaround_settings WHERE exam_code=?').bind(code));
    await env.DB.batch(stmts);await audit(env,user,'removeu_tempo_exames','timing_settings','bulk',{examCodes:codes});return ok({message:'Os exames selecionados voltaram a usar o tempo padrão.'});
  }
  const minutes=Math.round(Number(b.turnaroundMinutes));
  const codes=Array.isArray(b.examCodes)?[...new Set(b.examCodes.map(String).filter(Boolean))]:[];
  if(!codes.length)return err('Selecione um ou mais exames.');
  if(!Number.isFinite(minutes)||minutes<1||minutes>60*24*30)return err('Informe um tempo válido para os exames selecionados.');
  const catalog=new Map();for(const g of catalogWithCodes())for(const e of g.items)catalog.set(e.code,e.name);
  const ts=nowIso(),stmts=[];for(const code of codes){const name=catalog.get(code);if(!name)continue;stmts.push(env.DB.prepare(`INSERT INTO exam_turnaround_settings(exam_code,exam_name,turnaround_minutes,active,created_at,updated_at) VALUES(?,?,?,1,?,?) ON CONFLICT(exam_code) DO UPDATE SET exam_name=excluded.exam_name,turnaround_minutes=excluded.turnaround_minutes,active=1,updated_at=excluded.updated_at`).bind(code,name,minutes,ts,ts));}
  if(!stmts.length)return err('Nenhum exame válido foi selecionado.');
  await env.DB.batch(stmts);await audit(env,user,'definiu_tempo_exames','timing_settings','bulk',{examCodes:codes,minutes});
  return ok({message:`Tempo único aplicado a ${stmts.length} exame${stmts.length>1?'s':''}.`});
}

async function examTimingBoard(env,user,url){
  const legacyMode=['pending','late','completed','all'].includes(url.searchParams.get('mode'))?url.searchParams.get('mode'):null;
  let scope=['unfinished','active','all'].includes(url.searchParams.get('scope'))?url.searchParams.get('scope'):'unfinished';
  let bucket=['on_time','warning','late','completed'].includes(url.searchParams.get('bucket'))?url.searchParams.get('bucket'):'';
  if(legacyMode==='pending')scope='unfinished';
  if(legacyMode==='late'){scope='all';bucket='late'}
  if(legacyMode==='completed'){scope='all';bucket='completed'}
  if(legacyMode==='all')scope='all';
  const clientId=Number(url.searchParams.get('clientId')||0),technicianId=Number(url.searchParams.get('technicianId')||0);
  const priority=['normal','priority','urgent'].includes(String(url.searchParams.get('priority')||''))?String(url.searchParams.get('priority')):'';
  const setting=await env.DB.prepare('SELECT warning_minutes FROM lab_timing_settings WHERE id=1').first();const warningMinutes=Number(setting?.warning_minutes||10);
  let sql=`SELECT e.id exam_id,e.requisition_id,e.exam_code,e.exam_name,e.turnaround_minutes,e.due_at,e.completed_at,e.completed_by_user_id,e.completed_by_name,e.completed_within_sla,r.protocol,r.priority,r.patient_name,r.status requisition_status,r.lab_received_at,r.completed_at requisition_completed_at,r.receiver_id,r.receiver_name,r.client_id,c.name client_name FROM requisition_exams e JOIN requisitions r ON r.id=e.requisition_id JOIN clients c ON c.id=r.client_id WHERE r.status<>'cancelado' AND r.lab_received_at IS NOT NULL AND (EXISTS(SELECT 1 FROM requisition_exams pnd WHERE pnd.requisition_id=r.id AND pnd.completed_at IS NULL) OR datetime(r.completed_at)>=datetime('now','-7 days'))`;
  const p=[];
  if(clientId){sql+=' AND r.client_id=?';p.push(clientId)}
  if(technicianId){sql+=' AND r.receiver_id=?';p.push(technicianId)}
  if(priority){sql+=' AND r.priority=?';p.push(priority)}
  sql+=' ORDER BY CASE r.priority WHEN \'urgent\' THEN 0 WHEN \'priority\' THEN 1 ELSE 2 END, COALESCE(e.due_at,e.completed_at) ASC LIMIT 2000';
  const rows=await env.DB.prepare(sql).bind(...p).all(),now=Date.now();
  const exams=(rows.results||[]).map(x=>({...x,timing:timingStatusForExam(x,warningMinutes,now)}));
  const groups=new Map();
  for(const e of exams){
    let g=groups.get(e.requisition_id);
    if(!g){g={requisitionId:e.requisition_id,protocol:e.protocol,priority:e.priority||'normal',patientName:e.patient_name,clientName:e.client_name,receiverName:e.receiver_name,labReceivedAt:e.lab_received_at,requisitionCompletedAt:e.requisition_completed_at,requisitionStatus:e.requisition_status,total:0,completed:0,onTime:0,warning:0,late:0,completedLate:0,pending:[],latestCompletedAt:null,earliestDueAt:null};groups.set(e.requisition_id,g)}
    g.total++;
    if(e.completed_at){g.completed++;if(!g.latestCompletedAt||new Date(e.completed_at)>new Date(g.latestCompletedAt))g.latestCompletedAt=e.completed_at}
    if(e.timing.status==='on_time')g.onTime++;
    if(e.timing.status==='warning')g.warning++;
    if(e.timing.status==='late')g.late++;
    if(e.timing.status==='completed_late')g.completedLate++;
    if(!e.completed_at){g.pending.push({examId:e.exam_id,examName:e.exam_name,dueAt:e.due_at,timing:e.timing});if(e.due_at&&(!g.earliestDueAt||new Date(e.due_at)<new Date(g.earliestDueAt)))g.earliestDueAt=e.due_at}
  }
  const allRequests=[...groups.values()].map(g=>({...g,progressPct:g.total?Math.round(g.completed/g.total*100):0,state:g.completed===g.total?'completed':g.late?'late':g.warning?'warning':'on_time'}));
  const counts={requests:allRequests.length,completedRequests:allRequests.filter(g=>g.state==='completed').length,onTimeRequests:allRequests.filter(g=>g.state==='on_time').length,warningRequests:allRequests.filter(g=>g.state==='warning').length,lateRequests:allRequests.filter(g=>g.state==='late').length};
  let requests=allRequests;
  if(bucket==='completed')requests=allRequests.filter(g=>g.state==='completed');
  else{
    if(scope==='unfinished')requests=requests.filter(g=>g.completed<g.total);
    else if(scope==='active')requests=requests.filter(g=>g.completed>0&&g.completed<g.total);
    if(bucket)requests=requests.filter(g=>g.state===bucket);
  }
  const stateRank={late:0,warning:1,on_time:2,completed:3},priorityRank={urgent:0,priority:1,normal:2};
  requests.sort((a,b)=>{
    const sr=(stateRank[a.state]??9)-(stateRank[b.state]??9);if(sr)return sr;
    const pr=(priorityRank[a.priority]??9)-(priorityRank[b.priority]??9);if(pr)return pr;
    if(a.state==='completed')return new Date(b.latestCompletedAt||0)-new Date(a.latestCompletedAt||0);
    return new Date(a.earliestDueAt||'9999-12-31')-new Date(b.earliestDueAt||'9999-12-31');
  });
  const visibleIds=new Set(requests.map(g=>Number(g.requisitionId)));
  const visibleExams=exams.filter(e=>visibleIds.has(Number(e.requisition_id)));
  return ok({scope,bucket,warningMinutes,counts,requests,exams:visibleExams});
}

async function completeTimedExam(env,user,examId){
  const e=await env.DB.prepare(`SELECT e.*,r.id requisition_id,r.protocol,r.status requisition_status,r.receiver_name FROM requisition_exams e JOIN requisitions r ON r.id=e.requisition_id WHERE e.id=?`).bind(examId).first();
  if(!e)return err('Exame não encontrado.',404);if(e.requisition_status==='cancelado')return err('A solicitação está cancelada.',409);if(!e.due_at)return err('O cronômetro deste exame ainda não começou. Dê o recebimento da amostra primeiro.',409);if(e.completed_at)return ok({message:'Este exame já está concluído.'});
  const ts=nowIso(),within=new Date(ts).getTime()<=new Date(e.due_at).getTime()?1:0;
  await env.DB.prepare(`UPDATE requisition_exams SET completed_at=?,completed_by_user_id=?,completed_by_name=?,completed_within_sla=? WHERE id=?`).bind(ts,user.id,user.username_display,within,examId).run();
  const left=await env.DB.prepare('SELECT COUNT(*) n FROM requisition_exams WHERE requisition_id=? AND completed_at IS NULL').bind(e.requisition_id).first();
  const stmts=[env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,?,?,?,?,?)`).bind(e.requisition_id,e.requisition_status,user.id,user.username_display,JSON.stringify({message:`Exame concluído: ${e.exam_name}`,examId,onTime:!!within}),ts)];
  if(Number(left?.n||0)===0 && ['recebido','em_analise'].includes(e.requisition_status))stmts.push(env.DB.prepare(`UPDATE requisitions SET status='concluido',completed_at=?,updated_at=? WHERE id=?`).bind(ts,ts,e.requisition_id));
  await env.DB.batch(stmts);await audit(env,user,'concluiu_exame_individual','requisition',e.requisition_id,{examId,examName:e.exam_name,onTime:!!within});return ok({message:`${e.exam_name} concluído${within?' dentro do prazo':' com atraso'}.`,allCompleted:Number(left?.n||0)===0});
}

async function examTimingReport(env,user,url){
  const from=clampString(url.searchParams.get('from'),20),to=clampString(url.searchParams.get('to'),20);
  let where=`r.status<>'cancelado' AND r.lab_received_at IS NOT NULL`;const p=[];
  if(from){where+=` AND date(datetime(r.lab_received_at,'-3 hours'))>=date(?)`;p.push(from)}
  if(to){where+=` AND date(datetime(r.lab_received_at,'-3 hours'))<=date(?)`;p.push(to)}
  if(!from&&!to)where+=` AND datetime(r.lab_received_at)>=datetime('now','-30 days')`;
  const [rows,setting]=await Promise.all([
    env.DB.prepare(`SELECT e.completed_at,e.due_at,e.completed_within_sla,e.completed_by_name,r.receiver_name,r.receiver_id FROM requisition_exams e JOIN requisitions r ON r.id=e.requisition_id WHERE ${where}`).bind(...p).all(),
    env.DB.prepare('SELECT warning_minutes FROM lab_timing_settings WHERE id=1').first()
  ]);
  const warningMinutes=Number(setting?.warning_minutes||10),now=Date.now(),map=new Map();
  for(const x of rows.results||[]){
    const tech=x.completed_at?(x.completed_by_name||x.receiver_name||'Sem técnico'):(x.receiver_name||x.completed_by_name||'Sem técnico');
    let a=map.get(tech);if(!a){a={technician:tech,total:0,completed:0,onTime:0,late:0,pending:0,pendingWarning:0,pendingLate:0};map.set(tech,a)}
    a.total++;
    if(x.completed_at){a.completed++;const late=x.due_at&&new Date(x.completed_at).getTime()>new Date(x.due_at).getTime();late?a.late++:a.onTime++;}
    else{
      a.pending++;
      if(x.due_at){const left=new Date(x.due_at).getTime()-now;if(left<0)a.pendingLate++;else if(left<=warningMinutes*60000)a.pendingWarning++;}
    }
  }
  const technicians=[...map.values()].map(x=>({...x,onTimePct:x.completed?Math.round(x.onTime/x.completed*100):0})).sort((a,b)=>(b.pendingLate+b.late)-(a.pendingLate+a.late)||b.pendingWarning-a.pendingWarning||a.technician.localeCompare(b.technician));
  const totals=technicians.reduce((a,x)=>{for(const k of ['total','completed','onTime','late','pending','pendingWarning','pendingLate'])a[k]+=x[k];return a},{total:0,completed:0,onTime:0,late:0,pending:0,pendingWarning:0,pendingLate:0});
  totals.onTimePct=totals.completed?Math.round(totals.onTime/totals.completed*100):0;
  return ok({from:from||null,to:to||null,warningMinutes,totals,technicians});
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

function courierCookieToken(request){
  const cookie=request.headers.get('cookie')||'';
  const m=cookie.match(/(?:^|;\s*)hlab_courier_session=([^;]+)/);
  return m?decodeURIComponent(m[1]):null;
}
function courierSessionCookie(token,expires,secure=true){
  return `hlab_courier_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure?'; Secure':''}`;
}
function clearCourierSessionCookie(secure=true){
  return `hlab_courier_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`;
}
async function createCourierSession(env,accountId){
  const token=randomToken(32),tokenHash=await sha256(token);
  const days=Math.max(1,Number(env.SESSION_DAYS||14));
  const expires=new Date(Date.now()+days*86400000).toISOString();
  await env.DB.prepare('INSERT INTO courier_sessions(token_hash,courier_account_id,expires_at) VALUES(?,?,?)')
    .bind(tokenHash,accountId,expires).run();
  return {token,expires};
}
async function getCourierSession(request,env){
  const token=courierCookieToken(request);if(!token)return null;
  const tokenHash=await sha256(token);
  const row=await env.DB.prepare(`
    SELECT ca.id account_id,ca.username_display,ca.password_hash,ca.password_salt,ca.force_password_change,
           ca.active account_active,cs.expires_at,
           c.id courier_id,c.name,c.phone,c.thermometer_code,c.active courier_active
    FROM courier_sessions cs
    JOIN courier_accounts ca ON ca.id=cs.courier_account_id
    JOIN couriers c ON c.id=ca.courier_id
    WHERE cs.token_hash=?
  `).bind(tokenHash).first();
  if(!row)return null;
  if(!row.account_active||!row.courier_active||new Date(row.expires_at).getTime()<=Date.now()){
    await env.DB.prepare('DELETE FROM courier_sessions WHERE token_hash=?').bind(tokenHash).run();
    return null;
  }
  return row;
}
async function courierLogin(request,env,url){
  const b=await safeBody(request),key=normalizeUsername(b?.username),password=String(b?.password||'');
  if(!key||!password)return err('Informe usuário e senha.',400);
  const account=await env.DB.prepare(`
    SELECT ca.*,c.name,c.phone,c.thermometer_code,c.active courier_active
    FROM courier_accounts ca JOIN couriers c ON c.id=ca.courier_id
    WHERE ca.username_key=?
  `).bind(key).first();
  if(!account||!account.active||!account.courier_active||!await verifyPassword(password,account.password_hash,account.password_salt)){
    return err('Usuário ou senha inválidos.',401);
  }
  await env.DB.prepare('DELETE FROM courier_sessions WHERE expires_at<=?').bind(nowIso()).run();
  const session=await createCourierSession(env,account.id);
  await audit(env,{name:account.name},'login_entregador','courier',account.courier_id);
  return json({ok:true,forcePasswordChange:!!account.force_password_change,courier:{id:account.courier_id,name:account.name}},200,{
    'set-cookie':courierSessionCookie(session.token,session.expires,url.protocol==='https:')
  });
}
async function courierLogout(request,env,url){
  const row=await getCourierSession(request,env);
  const token=courierCookieToken(request);
  if(token)await env.DB.prepare('DELETE FROM courier_sessions WHERE token_hash=?').bind(await sha256(token)).run();
  if(row)await audit(env,{name:row.name},'logout_entregador','courier',row.courier_id);
  return json({ok:true},200,{'set-cookie':clearCourierSessionCookie(url.protocol==='https:')});
}
async function courierMe(request,env){
  const row=await getCourierSession(request,env);
  if(!row)return err('Acesso do entregador expirado.',401);
  return ok({courier:{
    id:row.courier_id,name:row.name,phone:row.phone,thermometer_code:row.thermometer_code,
    username:row.username_display,forcePasswordChange:!!row.force_password_change
  }});
}
async function courierChangePassword(request,env){
  const row=await getCourierSession(request,env);
  if(!row)return err('Acesso do entregador expirado.',401);
  const b=await safeBody(request),current=String(b?.currentPassword||''),next=String(b?.newPassword||'');
  if(next.length<8)return err('A nova senha deve ter pelo menos 8 caracteres.');
  if(!await verifyPassword(current,row.password_hash,row.password_salt))return err('Senha atual incorreta.',400);
  const {hash,salt}=await hashPassword(next);
  await env.DB.prepare(`UPDATE courier_accounts SET password_hash=?,password_salt=?,force_password_change=0,updated_at=? WHERE id=?`)
    .bind(hash,salt,nowIso(),row.account_id).run();
  await audit(env,{name:row.name},'alterou_senha_entregador','courier',row.courier_id);
  return ok({message:'Senha alterada com sucesso.'});
}
async function courierSessionTaskApi(request,env,url,rest){
  const row=await getCourierSession(request,env);
  if(!row)return err('Acesso do entregador expirado.',401);
  if(row.force_password_change)return err('Troque a senha inicial para continuar.',428,{code:'COURIER_PASSWORD_CHANGE_REQUIRED'});
  const courier={id:row.courier_id,name:row.name,phone:row.phone,thermometer_code:row.thermometer_code,active:row.courier_active};
  return courierTaskApi(request,env,url,courier,rest);
}

async function courierApi(request,env,url,token,rest){
  const hash=await sha256(token);
  const courier=await env.DB.prepare('SELECT id,name,phone,thermometer_code,active FROM couriers WHERE token_hash=?').bind(hash).first();
  if(!courier||!courier.active)return err('Link de entregador inválido ou desativado.',403);
  return courierTaskApi(request,env,url,courier,rest);
}

async function courierTaskApi(request,env,url,courier,rest){
  const method=request.method.toUpperCase();
  if((rest===''||rest==='tasks')&&method==='GET'){
    const from=url.searchParams.get('from'),to=url.searchParams.get('to'),tab=url.searchParams.get('tab')||'pending';
    let sql=`SELECT r.id,r.protocol,r.status,r.patient_name,r.species,r.tutor_name,r.created_at,r.assigned_at,r.courier_accepted_at,r.courier_accepted_name,r.collected_at,r.collection_temperature,r.sent_by_name,r.sent_from_location,c.name client_name,c.address,c.city,c.state,c.phone,co.thermometer_code FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE r.assigned_courier_id=?`;
    const p=[courier.id];
    if(tab==='collected')sql+=` AND r.status IN ('coletado','recebido','em_analise','concluido')`;else sql+=` AND r.status='atribuido'`;
    if(from){sql+=' AND date(COALESCE(r.collected_at,r.assigned_at,r.created_at))>=date(?)';p.push(from);}
    if(to){sql+=' AND date(COALESCE(r.collected_at,r.assigned_at,r.created_at))<=date(?)';p.push(to);}
    sql+=' ORDER BY COALESCE(r.assigned_at,r.created_at) DESC';
    const rows=await env.DB.prepare(sql).bind(...p).all();
    return ok({courier,tasks:rows.results||[]});
  }
  const acceptMatch=rest.match(/^requisitions\/(\d+)\/accept$/);
  if(acceptMatch&&method==='POST'){
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
  const m=rest.match(/^requisitions\/(\d+)\/collect$/);
  if(m&&method==='POST'){
    const id=Number(m[1]),b=await safeBody(request),temp=parseNumber(b?.temperature);
    if(temp==null)return err('Informe a temperatura da coleta.');
    const r=await env.DB.prepare(`SELECT r.*,c.name client_name,c.address,c.city,c.state,co.thermometer_code FROM requisitions r JOIN clients c ON c.id=r.client_id LEFT JOIN couriers co ON co.id=r.assigned_courier_id WHERE r.id=? AND r.assigned_courier_id=?`).bind(id,courier.id).first();
    if(!r)return err('Coleta não encontrada para este entregador.',404);
    if(r.status!=='atribuido')return err('Essa coleta já foi movimentada ou não está mais pendente.');
    if(!r.courier_accepted_at)return err('Aceite a coleta antes de registrar a retirada.',409);
    const ts=nowIso(),sentBy=clampString(b.sentByName,160)||'Responsável no local',loc=clampString(b.sentFromLocation,250)||r.client_name;
    await env.DB.batch([
      env.DB.prepare(`UPDATE requisitions SET status='coletado',collected_at=?,collection_temperature=?,sent_by_name=?,sent_from_location=?,transport_courier_name=?,transport_thermometer_code=?,updated_at=? WHERE id=?`)
        .bind(ts,temp,sentBy,loc,courier.name,r.thermometer_code||null,ts,id),
      env.DB.prepare(`INSERT INTO status_events(requisition_id,status,actor_user_id,actor_name,details_json,created_at) VALUES(?,'coletado',NULL,?,?,?)`)
        .bind(id,courier.name,JSON.stringify({temperature:temp,sentBy,location:loc}),ts)
    ]);
    await audit(env,{name:courier.name},'coletou_amostra','requisition',id,{temperature:temp,sentBy,location:loc});
    return ok({message:'Coleta registrada. O item foi movido para o histórico de coletados.',collectedAt:ts});
  }
  return err('Rota de entregador não encontrada.',404);
}

async function safeBody(request){try{return await request.json();}catch{return null;}}
function parseJson(s){try{return s?JSON.parse(s):null;}catch{return null;}}
