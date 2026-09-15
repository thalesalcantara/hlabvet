const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = { me:null, catalog:null, page:null, clients:[], couriers:[], receivers:[], alerts:[], cancelAlerts:[], missingPrices:[] };
const STATUS = {solicitado:'Solicitado',atribuido:'Entregador atribuído',coletado:'Coletado',recebido:'Recebido',em_analise:'Em análise',concluido:'Concluído',cancelado:'Cancelado'};

const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtDate = v => v ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza'}).format(new Date(v.length===10 ? `${v}T12:00:00-03:00` : v)) : '—';
const fmtDateTime = v => v ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Fortaleza'}).format(new Date(v)) : '—';
const fmtTime = v => v ? new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Fortaleza'}).format(new Date(v)) : '';
const fmtBytes = n => !n ? '0 B' : n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
const today = () => new Date().toLocaleDateString('sv-SE',{timeZone:'America/Fortaleza'});
const currentMonth = () => today().slice(0,7);

async function api(path, opts={}) {
  const options = {...opts, credentials:'include', headers:{...(opts.headers||{})}};
  if (opts.json !== undefined) { options.method ||= 'POST'; options.headers['content-type']='application/json'; options.body=JSON.stringify(opts.json); delete options.json; }
  const res = await fetch(path, options);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    return res;
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    const e = new Error(data.error || `Erro ${res.status}`); e.status=res.status; e.data=data; throw e;
  }
  return data;
}

async function fetchResultBlob(fileId, mode='view'){
  const res=await fetch(`/api/results/${fileId}/${mode==='download'?'download':'view'}`,{credentials:'include'});
  if(!res.ok){
    const ct=res.headers.get('content-type')||'';
    if(ct.includes('application/json')){const d=await res.json();throw new Error(d.error||`Erro ${res.status}`)}
    throw new Error(`Não foi possível abrir o resultado (erro ${res.status}).`);
  }
  return await res.blob();
}
async function resultFileAction(fileId, mode, filename='resultado'){
  try{
    const blob=await fetchResultBlob(fileId,mode==='download'?'download':'view');
    const url=URL.createObjectURL(blob);
    if(mode==='download'){
      const a=document.createElement('a');a.href=url;a.download=filename||'resultado';document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);return;
    }
    const w=window.open(url,'_blank');
    if(!w){URL.revokeObjectURL(url);return toast('O navegador bloqueou a nova janela. Libere pop-ups para visualizar o resultado.','error')}
    if(mode==='print') toast('O resultado foi aberto. Use Imprimir no navegador.');
    setTimeout(()=>URL.revokeObjectURL(url),120000);
  }catch(e){toast(e.message,'error')}
}
function bindResultFileButtons(root=document){
  $$('[data-result-view]',root).forEach(b=>b.addEventListener('click',()=>resultFileAction(Number(b.dataset.resultView),'view',b.dataset.filename||'resultado')));
  $$('[data-result-download]',root).forEach(b=>b.addEventListener('click',()=>resultFileAction(Number(b.dataset.resultDownload),'download',b.dataset.filename||'resultado')));
  $$('[data-print-result]',root).forEach(b=>b.addEventListener('click',()=>resultFileAction(Number(b.dataset.printResult),'print',b.dataset.filename||'resultado')));
}
function resultFilesHtml(files,allowPrint=true){
  if(!files?.length)return '<div class="empty-state">Resultado ainda não disponível.</div>';
  return files.map(f=>`<div class="file-card"><div><strong>${esc(f.original_name)}</strong><small>${fmtBytes(f.size_bytes)} • ${fmtDateTime(f.created_at)}</small></div><div class="actions"><button class="btn soft small" data-result-view="${f.id}" data-filename="${esc(f.original_name)}">Visualizar</button><button class="btn secondary small" data-result-download="${f.id}" data-filename="${esc(f.original_name)}">Baixar</button>${allowPrint?`<button class="btn ghost small" data-print-result="${f.id}" data-filename="${esc(f.original_name)}">Imprimir</button>`:''}</div></div>`).join('');
}
function toast(msg,type='ok'){const el=$('#toast');el.textContent=msg;el.className=`toast show ${type}`;clearTimeout(toast.t);toast.t=setTimeout(()=>el.className='toast',3300)}
function modal(html){$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden')}
function closeModal(){$('#modal').classList.add('hidden');$('#modalContent').innerHTML=''}

let alertPollTimer=null, alertBeepTimer=null, audioCtx=null, alertSoundMode=null, sirenFlip=false;
function unlockAudio(){
  try{audioCtx ||= new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended')audioCtx.resume();}catch{}
}
function beep(){
  if(!audioCtx||audioCtx.state!=='running')return;
  try{const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.frequency.value=880;g.gain.value=.055;o.connect(g);g.connect(audioCtx.destination);o.start();g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.22);o.stop(audioCtx.currentTime+.23);}catch{}
}
function siren(){
  if(!audioCtx||audioCtx.state!=='running')return;
  try{const o=audioCtx.createOscillator(),g=audioCtx.createGain();sirenFlip=!sirenFlip;o.frequency.value=sirenFlip?720:1040;g.gain.value=.07;o.connect(g);g.connect(audioCtx.destination);o.start();g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.32);o.stop(audioCtx.currentTime+.33);}catch{}
}
function stopLabAlerts(){
  clearInterval(alertPollTimer);clearInterval(alertBeepTimer);alertPollTimer=null;alertBeepTimer=null;alertSoundMode=null;
  state.alerts=[];state.cancelAlerts=[];state.missingPrices=[];$('#labAlertDock')?.remove();
}
function renderAlertDock(){
  let dock=$('#labAlertDock');
  const operational=(state.alerts?.length||0)+(state.cancelAlerts?.length||0);
  const pricing=state.me?.role==='admin'?(state.missingPrices?.length||0):0;
  if(!operational&&!pricing){dock?.remove();return;}
  if(!dock){dock=document.createElement('div');dock.id='labAlertDock';dock.className='lab-alert-dock';document.body.appendChild(dock)}
  const cancellationHtml=(state.cancelAlerts||[]).map(a=>`<div class="lab-alert-item cancellation"><div><strong>🚨 ${esc(a.title||'SOLICITAÇÃO CANCELADA')}</strong><small>${esc(a.message||`${a.client_name||''} • ${a.protocol||''}`)}</small></div><button class="btn danger small" data-ack-alert="${a.alert_id}">Confirmar</button></div>`).join('');
  const newHtml=(state.alerts||[]).map(a=>`<div class="lab-alert-item"><div><strong>${esc(a.client_name)}</strong><small>${esc(a.protocol)} • ${esc(a.patient_name)}${a.request_kind==='scheduled'?` • agendada ${fmtDateTime(a.scheduled_at)}`:''}</small></div><button class="btn primary small" data-accept-alert="${a.id}">Aceitar</button></div>`).join('');
  const priceHtml=pricing?`<div class="lab-alert-price"><strong>⚠ ${pricing} exame${pricing>1?'s':''} sem preço cadastrado</strong><small>Cadastre os valores para o financeiro ficar completo.</small><button class="btn soft small" data-go-prices>Ir para preços</button></div>`:'';
  dock.innerHTML=`<div class="lab-alert-head">Central de avisos HLabVet</div>${cancellationHtml}${newHtml}${priceHtml}`;
  $$('[data-accept-alert]',dock).forEach(b=>b.addEventListener('click',async()=>{unlockAudio();try{const r=await api(`/api/requisitions/${b.dataset.acceptAlert}/accept`,{method:'POST'});toast(r.message);await pollLabAlerts();if(state.page==='requests'||state.page==='dashboard')navigate(state.page)}catch(e){toast(e.message,'error')}}));
  $$('[data-ack-alert]',dock).forEach(b=>b.addEventListener('click',async()=>{unlockAudio();try{await api(`/api/alerts/${b.dataset.ackAlert}/ack`,{method:'POST'});toast('Cancelamento confirmado.');await pollLabAlerts();if(state.page==='cancellations')navigate('cancellations')}catch(e){toast(e.message,'error')}}));
  $('[data-go-prices]',dock)?.addEventListener('click',()=>navigate('prices'));
}
async function pollLabAlerts(){
  if(!state.me||state.me.role==='client')return;
  try{
    const d=await api('/api/alerts');state.alerts=d.alerts||[];state.cancelAlerts=d.cancelAlerts||[];state.missingPrices=d.missingPrices||[];renderAlertDock();
    const soundCount=state.alerts.length+state.cancelAlerts.length;
    const wantedMode=state.cancelAlerts.length?'siren':state.alerts.length?'beep':null;
    if(wantedMode!==alertSoundMode){clearInterval(alertBeepTimer);alertBeepTimer=null;alertSoundMode=wantedMode;if(wantedMode==='siren'){siren();alertBeepTimer=setInterval(siren,700)}else if(wantedMode==='beep'){beep();alertBeepTimer=setInterval(beep,1800)}}
    if(!soundCount){clearInterval(alertBeepTimer);alertBeepTimer=null;alertSoundMode=null}
  }catch{}
}

function startLabAlerts(){
  stopLabAlerts();if(!state.me||state.me.role==='client')return;document.addEventListener('pointerdown',unlockAudio,{once:true});pollLabAlerts();alertPollTimer=setInterval(pollLabAlerts,5000);
}
document.addEventListener('click',e=>{if(e.target.matches('[data-close-modal]'))closeModal()});

async function boot(){
  const token = new URLSearchParams(location.search).get('entregador');
  if(token) return renderCourierPortal(token);
  try { state.catalog=(await api('/api/catalog')).exams; } catch {}
  try { const r=await api('/api/me'); state.me=r.user; state.profile=r.profile; showApp(); }
  catch { showLogin(); }
}
function showLogin(){ $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); $('#courierView').classList.add('hidden'); }
async function showApp(){
  $('#loginView').classList.add('hidden');$('#courierView').classList.add('hidden');$('#appView').classList.remove('hidden');
  const roleLabel=state.me.role==='client'?'Cliente HLabVet':state.me.role==='staff'?'Técnico HLabVet':'Administrador HLab Vet';
  $('#sideUser').innerHTML=`<strong>${esc(state.me.technicianName||state.me.clientName||state.me.username)}</strong><small>${roleLabel}</small>`;
  renderNav();startLabAlerts();
  if(state.me.forcePasswordChange) return showPasswordChange(true);
  navigate('dashboard');
}

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();unlockAudio();const f=new FormData(e.currentTarget);try{await api('/api/login',{json:Object.fromEntries(f)});const m=await api('/api/me');state.me=m.user;state.profile=m.profile;showApp();toast('Acesso realizado.');}catch(err){toast(err.message,'error')}});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'})}catch{} stopLabAlerts();state.me=null;showLogin();});
$('#menuBtn').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));

function renderNav(){
  let items;
  if(state.me.role==='client'){
    items=[['dashboard','⌂','Painel'],['new-request','＋','Nova solicitação'],['requests','▣','Meus exames']];
    if(state.me.canManageClientUsers)items.push(['client-users','♙','Usuários / técnicos']);
    items.push(['password','⚿','Alterar senha']);
  }
  else if(state.me.role==='staff') items=[
    ['dashboard','⌂','Painel'],['requests','▣','Solicitações'],['cancellations','×','Cancelamentos'],['clients','♙','Clientes'],['couriers','➜','Entregadores'],['receivers','✓','Técnicos'],['temperature','▤','Temperaturas'],['password','⚿','Alterar senha']
  ];
  else items=[
    ['dashboard','⌂','Painel'],['requests','▣','Solicitações'],['cancellations','×','Cancelamentos'],['clients','♙','Clientes'],['couriers','➜','Entregadores'],['receivers','✓','Técnicos'],['prices','R$','Preços'],['finance','▦','Financeiro'],['temperature','▤','Temperaturas'],['audit','◴','Auditoria'],['password','⚿','Alterar senha']
  ];
  $('#nav').innerHTML=items.map(([id,ic,label])=>`<button class="nav-btn" data-page="${id}"><span>${ic}</span>${label}</button>`).join('');
  $$('.nav-btn').forEach(b=>b.addEventListener('click',()=>{navigate(b.dataset.page);$('.sidebar').classList.remove('open')}));
}

async function navigate(page){
  state.page=page; $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); $('#topActions').innerHTML='';
  const map={dashboard:['Painel','Visão geral do atendimento'],requests:[state.me.role==='client'?'Meus exames':'Solicitações','Pesquise por período, animal, tutor, raça e outros dados'],cancellations:['Cancelamentos','Solicitações canceladas e motivo'],clients:['Clientes','Cadastros e acessos dos clientes'],couriers:['Entregadores','Painel móvel, links privados e termômetros'],receivers:['Técnicos','Técnicos do laboratório com login próprio'],prices:['Preços dos exames','Tabela geral e valores específicos por cliente'],finance:['Financeiro','Ranking de clientes e espelho detalhado para cobrança'],temperature:['Controle de temperatura','Fichas mensais de envio e recebimento'],password:['Alterar senha','A senha diferencia maiúsculas e minúsculas'],audit:['Auditoria','Registro de ações importantes'],'client-users':['Usuários / técnicos','Cadastre acessos da clínica; carimbo é opcional e automático para técnicos'],'new-request':['Nova solicitação','Requisição de exames veterinários']};
  $('#pageTitle').textContent=map[page]?.[0]||'HLab Vet';$('#pageSubtitle').textContent=map[page]?.[1]||'';
  const fn={dashboard:renderDashboard,requests:renderRequests,cancellations:renderCancellations,clients:renderClients,couriers:renderCouriers,receivers:renderReceivers,prices:renderPrices,finance:renderFinance,temperature:renderTemperature,'client-users':renderClientUsers,password:()=>showPasswordChange(false),audit:renderAudit,'new-request':renderNewRequest}[page];
  try{await fn?.()}catch(e){if(e.status===428)return showPasswordChange(true);$('#content').innerHTML=`<div class="card empty-state">${esc(e.message)}</div>`;toast(e.message,'error')}
}

async function renderDashboard(){
  const d=await api('/api/dashboard'),t=d.totals||{};
  $('#content').innerHTML=`<div class="grid cards">
    ${metric('Solicitados hoje',t.solicitado||0)}${metric('Em coleta hoje',(t.atribuido||0)+(t.coletado||0))}${metric('Em análise hoje',(t.recebido||0)+(t.em_analise||0))}${metric('Concluídos hoje',t.concluido||0)}
  </div><div class="card" style="margin-top:16px"><div class="section-title"><div><h3>Solicitações de hoje</h3><p>Outros dias aparecem somente quando você filtrar em Solicitações.</p></div></div>${requestTable(d.recent||[],false)}</div>`;
  bindDetailButtons();bindResultEyes();
}

function metric(label,n){return `<div class="card metric"><div class="number">${n}</div><div class="label">${label}</div></div>`}

async function renderRequests(){
  if(state.me.role!=='client'){
    await loadAdminLists();
    if(state.me.role==='admin') $('#topActions').innerHTML=`<button class="btn soft" id="newAdminReq">＋ Nova solicitação</button><button class="btn secondary" id="printFiltered">Imprimir filtradas</button>`;
    else $('#topActions').innerHTML='';
    $('#newAdminReq')?.addEventListener('click',()=>navigate('new-request'));
  } else {
    $('#topActions').innerHTML=`<button class="btn primary" id="newReqTop">＋ Nova solicitação</button>`;
    $('#newReqTop')?.addEventListener('click',()=>navigate('new-request'));
  }
  $('#content').innerHTML=`<div class="card"><form id="reqFilters" class="filters">
    <input class="span2" name="q" placeholder="Busca geral: protocolo, exame, animal, tutor...">
    <select name="status"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
    <input name="from" type="date" title="Data inicial" value="${today()}"><input name="to" type="date" title="Data final" value="${today()}">
    ${state.me.role!=='client'?`<select name="clientId"><option value="">Todos os clientes</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`:''}
    <input name="patient" placeholder="Nome do animal"><input name="tutor" placeholder="Tutor"><input name="birth" type="date" title="Nascimento do animal"><input name="breed" placeholder="Raça">
    <button class="btn primary" type="submit">Pesquisar</button><button class="btn ghost" type="button" id="clearReqFilters">Hoje</button>
  </form><p class="muted" style="margin:0 0 12px">Por padrão, aparecem somente as solicitações do dia. Altere o período para consultar datas anteriores ou futuras.</p><div id="reqResults"><div class="empty-state">Carregando…</div></div></div>`;
  let current=[];
  const load=async()=>{const qs=new URLSearchParams(new FormData($('#reqFilters')));for(const [k,v] of [...qs])if(!v)qs.delete(k);const r=await api(`/api/requisitions?${qs}`);current=r.requisitions||[];$('#reqResults').innerHTML=requestTable(current,true);bindDetailButtons();bindResultEyes(current);};
  $('#reqFilters').addEventListener('submit',e=>{e.preventDefault();load()});
  $('#clearReqFilters').addEventListener('click',()=>{const f=$('#reqFilters');f.reset();f.elements.from.value=today();f.elements.to.value=today();load()});
  $('#printFiltered')?.addEventListener('click',async()=>{if(!current.length)return toast('Nenhuma solicitação na pesquisa.','error');const details=[];for(const x of current.slice(0,100)){try{details.push(await api(`/api/requisitions/${x.id}`))}catch{}}printManyRequisitions(details)});
  await load();
}

function requestTable(rows,actions=true){
  if(!rows.length)return `<div class="empty-state">Nenhuma solicitação encontrada.</div>`;
  const client=state.me?.role==='client';
  return `<div class="table-wrap"><table><thead><tr><th>Protocolo</th>${!client?'<th>Cliente</th>':''}<th>Animal</th><th>Tutor</th><th>Status</th><th>Tipo</th><th>Data</th>${client?'<th>Resultado</th>':''}${actions&&!client?'<th>Ações</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr><td><button class="link-btn" data-detail="${r.id}"><strong>${esc(r.protocol)}</strong></button></td>${!client?`<td>${esc(r.client_name||'')}</td>`:''}<td>${esc(r.patient_name||'')}</td><td>${esc(r.tutor_name||'')}</td><td><span class="badge ${r.status}">${esc(STATUS[r.status]||r.status)}</span>${!client&&r.status==='solicitado'&&!r.accepted_at?'<br><small class="pending-accept">Aguardando aceite</small>':''}</td><td>${r.request_kind==='scheduled'?`<span class="badge scheduled">Agendada</span><br><small>${fmtDateTime(r.scheduled_at)}</small>`:'Imediata'}</td><td>${fmtDateTime(r.created_at)}</td>${client?`<td class="result-cell"><button class="result-eye ${Number(r.result_count)>0?'ready':'pending'}" data-result-eye="${r.id}" data-has-result="${Number(r.result_count)>0?1:0}" title="${Number(r.result_count)>0?'Resultado disponível':'Resultado ainda não disponível'}">👁</button></td>`:''}${actions&&!client?`<td><div class="actions"><button class="btn soft small" data-detail="${r.id}">Abrir</button>${state.me.role==='admin'?`<button class="btn ghost small" data-print-one="${r.id}">Imprimir/PDF</button>`:''}</div></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function bindDetailButtons(){
  $$('[data-detail]').forEach(b=>b.addEventListener('click',()=>openRequest(Number(b.dataset.detail))));
  $$('[data-print-one]').forEach(b=>b.addEventListener('click',async()=>{try{printRequisition(await api(`/api/requisitions/${b.dataset.printOne}`))}catch(e){toast(e.message,'error')}}));
}
function bindResultEyes(){
  $$('[data-result-eye]').forEach(b=>b.addEventListener('click',()=>{
    const id=Number(b.dataset.resultEye);if(b.dataset.hasResult==='1')openClientResults(id);else openRequest(id);
  }));
}
async function openClientResults(id){
  try{
    const d=await api(`/api/requisitions/${id}`),r=d.requisition;
    modal(`<div class="detail-head"><div><h3>Resultado • ${esc(r.patient_name)}</h3><p class="muted">${esc(r.protocol)} • ${esc(r.client_name)}</p></div></div><h4>Exames solicitados</h4><div>${d.exams.map(x=>`<span class="badge" style="margin:2px">${esc(x.exam_name)}</span>`).join('')}</div><h4 style="margin-top:18px">Arquivos de resultado</h4>${resultFilesHtml(d.files,true)}<div class="actions" style="margin-top:16px"><button class="btn ghost" data-close-modal>Fechar</button></div>`);
    bindResultFileButtons($('#modalContent'));
  }catch(e){toast(e.message,'error')}
}

async function renderNewRequest(){
  if(!state.catalog)state.catalog=(await api('/api/catalog')).exams;
  if(state.me.role!=='client')await loadAdminLists();
  const profile = state.me.role==='client' ? (await api('/api/my-client-profile')).profile : null;
  const loggedClientTech=state.me.role==='client'&&state.me.clientIsTechnician;
  const vetDefault=loggedClientTech?(state.me.clientMemberName||state.me.username):'';
  const crmvDefault=loggedClientTech?[state.me.clientCouncil||'CRMV',state.me.clientCouncilState,state.me.clientCouncilNumber].filter(Boolean).join(' '):'';
  $('#content').innerHTML=`<form id="newReqForm" class="stack">
    ${state.me.role!=='client'?`<div class="form-card"><h4>Cliente solicitante</h4><div class="form-grid"><label class="field span2">Cliente<select name="clientId" required><option value="">Selecione</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div></div>`:''}
    <div class="form-card"><h4>Tipo de solicitação</h4><div class="form-grid"><label class="field"><span>Atendimento</span><select name="requestKind" id="requestKind"><option value="immediate">Solicitar agora</option><option value="scheduled">Agendar coleta</option></select></label><label class="field hidden" id="scheduledWrap">Data e hora agendada<input name="scheduledAtLocal" id="scheduledAtLocal" type="datetime-local"></label></div><p class="muted">Solicitações imediatas alertam o laboratório assim que são enviadas. Nas agendadas, o alerta começa no horário marcado.</p></div>
    <div class="form-card"><h4>Dados da requisição</h4><div class="form-grid">
      <label class="field span2">Clínica / estabelecimento<input name="clinicName" value="${esc(profile?.name||'')}" placeholder="Nome da clínica"></label>
      <label class="field">Veterinário / técnico responsável<input name="veterinarianName" value="${esc(vetDefault)}" ${loggedClientTech?'readonly':''}></label><label class="field">CRMV / registro<input name="crmv" value="${esc(crmvDefault)}" ${loggedClientTech?'readonly':''}></label>
      <label class="field span2">Tutor<input name="tutorName"></label><label class="field span2">Paciente / animal<input name="patientName" required></label>
      <label class="field">Espécie<input name="species" placeholder="Canina, felina..."></label><label class="field">Raça<input name="breed"></label>
      <label class="field">Sexo<select name="sex"><option value="">—</option><option>M</option><option>F</option></select></label><label class="field">Data de nascimento<input name="birthDate" type="date"></label>
      <label class="field">Idade<input name="ageText" placeholder="Ex.: 4 anos"></label><label class="field">Data prevista da coleta<input name="collectionDate" type="date" value="${today()}"></label>
      <label class="field span4">Informações clínicas / observações<textarea name="clinicalInfo"></textarea></label>
    </div></div>
    ${state.me.role==='client'?`<div class="form-card client-requester"><h4>Solicitado por</h4><p><strong>${esc(state.me.clientMemberName||state.me.username)}</strong> • ${loggedClientTech?'Técnico — o carimbo será incluído automaticamente':'Usuário comum — sem carimbo'}</p></div>`:''}
    <div class="form-card"><h4>Exames solicitados</h4><div class="checks">${state.catalog.map(g=>`<section class="check-group"><h5>${esc(g.category)}</h5><div class="check-list">${g.items.map(e=>`<label><input type="checkbox" name="exams" value="${e.code}"><span>${esc(e.name)}</span></label>`).join('')}</div></section>`).join('')}</div></div>
    <div class="form-card"><h4>Material enviado</h4><div class="material-list">${['Sangue total','Soro','Plasma','Urina','Fezes'].map(m=>`<label><input type="checkbox" name="materials" value="${m}"> ${m}</label>`).join('')}</div><label class="field" style="margin-top:12px">Outros materiais<input name="materialOther"></label></div>
    <div class="form-card"><h4>Confirmação</h4><p class="muted">Ao enviar, a solicitação recebe um protocolo e fica disponível ao HLab Vet. O cliente acompanha o andamento e, quando o resultado for anexado, o olho amarelo ficará verde.</p><button class="btn primary" type="submit">Enviar solicitação ao HLab Vet</button></div>
  </form>`;
  const kind=$('#requestKind'),wrap=$('#scheduledWrap'),scheduled=$('#scheduledAtLocal');
  const syncSchedule=()=>{const on=kind.value==='scheduled';wrap.classList.toggle('hidden',!on);scheduled.required=on;if(!on)scheduled.value=''};kind.addEventListener('change',syncSchedule);syncSchedule();
  $('#newReqForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body=Object.fromEntries(f);body.exams=f.getAll('exams');body.materials=f.getAll('materials');body.requestKind=f.get('requestKind')||'immediate';if(body.requestKind==='scheduled'){const local=f.get('scheduledAtLocal');if(!local)return toast('Informe a data e hora do agendamento.','error');body.scheduledAt=new Date(local).toISOString()}delete body.scheduledAtLocal;try{const r=await api('/api/requisitions',{json:body});toast(`${r.message} Protocolo ${r.protocol}`);navigate('requests')}catch(err){toast(err.message,'error')}});
}

async function openRequest(id){
  const d=await api(`/api/requisitions/${id}`),r=d.requisition;
  const lab=state.me.role!=='client'; if(lab) await loadAdminLists();
  const actions=lab?adminRequestActions(r):'';
  const clientCanCancel=state.me.role==='client'&&!r.collected_at&&['solicitado','atribuido'].includes(r.status);
  const resultHtml=resultFilesHtml(d.files,true);
  const clientCanDeleteExam=state.me.role==='client'&&r.status==='solicitado'&&!r.accepted_at;
  const labCanDeleteExam=state.me.role!=='client'&&!['concluido','cancelado'].includes(r.status);
  const canDeleteExam=clientCanDeleteExam||labCanDeleteExam;
  const examsHtml=d.exams.map(x=>`<span class="exam-chip"><span class="badge">${esc(x.exam_name)}</span>${canDeleteExam&&d.exams.length>1?`<button class="exam-remove" type="button" data-delete-exam="${x.id}" title="Excluir este exame">×</button>`:''}</span>`).join('');
  modal(`<div class="detail-head"><div><h3>${esc(r.protocol)} • ${esc(r.patient_name)}</h3><p class="muted">${esc(r.client_name)} • criado em ${fmtDateTime(r.created_at)}${r.request_kind==='scheduled'?` • agendado para ${fmtDateTime(r.scheduled_at)}`:''}</p></div><span class="badge ${r.status}">${esc(STATUS[r.status])}</span></div>
    <div class="detail-cols"><div>
      <dl class="kv"><dt>Paciente</dt><dd>${esc(r.patient_name)}</dd><dt>Espécie / raça</dt><dd>${esc([r.species,r.breed].filter(Boolean).join(' • '))||'—'}</dd><dt>Nascimento / idade</dt><dd>${esc(r.birth_date?fmtDate(r.birth_date):'—')} ${esc(r.age_text||'')}</dd><dt>Tutor</dt><dd>${esc(r.tutor_name||'—')}</dd><dt>Veterinário / CRMV</dt><dd>${esc([r.veterinarian_name,r.crmv].filter(Boolean).join(' • '))||'—'}</dd><dt>Tipo</dt><dd>${r.request_kind==='scheduled'?`Agendada • ${fmtDateTime(r.scheduled_at)}`:'Imediata'}</dd><dt>Aceite do laboratório</dt><dd>${r.accepted_at?`${fmtDateTime(r.accepted_at)} • ${esc(r.accepted_by_name||'HLab Vet')}`:'Aguardando aceite'}</dd><dt>Coleta</dt><dd>${fmtDateTime(r.collected_at)} ${r.collection_temperature!=null?`• ${esc(r.collection_temperature)} °C`:''}</dd><dt>Entregador / termômetro</dt><dd>${esc([r.transport_courier_name||r.courier_name,r.transport_thermometer_code].filter(Boolean).join(' • '))||'—'}</dd><dt>Responsável no envio</dt><dd>${esc(r.sent_by_name||'—')}</dd><dt>Local do envio</dt><dd>${esc(r.sent_from_location||'—')}</dd><dt>Recebimento</dt><dd>${fmtDateTime(r.lab_received_at)} ${r.lab_received_temperature!=null?`• ${esc(r.lab_received_temperature)} °C`:''}</dd><dt>Técnico</dt><dd>${esc(r.receiver_name||'—')}</dd><dt>Local do recebimento</dt><dd>${esc(r.received_location||'—')}</dd><dt>Observação do recebimento</dt><dd>${esc(r.receiving_observation||'—')}</dd></dl>
      <h4>Exames</h4><div class="exam-list">${examsHtml}</div>${canDeleteExam&&d.exams.length===1?'<p class="muted">A solicitação precisa manter pelo menos um exame. Para substituir o único exame, cancele esta solicitação e faça outra.</p>':''}
      <h4>Material enviado</h4><p>${d.materials.map(esc).join(', ')||'—'} ${r.material_other?`• ${esc(r.material_other)}`:''}</p>
      <h4>Informações clínicas</h4><p>${esc(r.clinical_info||'—')}</p>
      <h4>Resultados</h4><div>${resultHtml}</div>
    </div><div><h4>Andamento em tempo real</h4><div class="timeline">${d.events.map(e=>`<div class="timeline-item"><div class="timeline-dot"></div><div><strong>${esc(STATUS[e.status]||e.status)}</strong><p>${fmtDateTime(e.created_at)} • ${esc(e.actor_name||'Sistema')}</p>${eventDetails(e.details)}</div></div>`).join('')}</div>${actions}</div></div>
    <div class="actions" style="margin-top:18px">${state.me.role==='admin'?'<button class="btn ghost" id="printThis">Imprimir / Salvar em PDF</button>':''}${clientCanCancel?'<button class="btn danger" id="clientCancelBtn">Cancelar solicitação</button>':''}<button class="btn ghost" data-close-modal>Fechar</button></div>`);
  $('#printThis')?.addEventListener('click',()=>printRequisition(d));
  $('#clientCancelBtn')?.addEventListener('click',async()=>{const reason=prompt('Motivo do cancelamento:','Desistência da solicitação');if(reason===null)return;if(!confirm('Confirmar o cancelamento? O laboratório será avisado imediatamente.'))return;try{const x=await api(`/api/requisitions/${id}/cancel`,{json:{reason}});toast(x.message);closeModal();navigate('requests')}catch(e){toast(e.message,'error')}});
  bindResultFileButtons($('#modalContent'));
  $$('[data-delete-exam]').forEach(b=>b.addEventListener('click',async()=>{
    const examId=Number(b.dataset.deleteExam);
    if(!confirm('Excluir este exame da solicitação?'))return;
    try{const x=await api(`/api/requisitions/${id}/exams/${examId}`,{method:'DELETE'});toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}
  }));
  if(lab) bindAdminRequestActions(id,r);
}
function eventDetails(d){if(!d)return'';const parts=[];if(d.courier)parts.push(`Entregador: ${d.courier}`);if(d.thermometer)parts.push(`Termômetro: ${d.thermometer}`);if(d.temperature!=null)parts.push(`Temperatura: ${d.temperature} °C`);if(d.receiver)parts.push(`Técnico: ${d.receiver}`);if(d.location)parts.push(`Local: ${d.location}`);if(d.sentBy)parts.push(`Responsável: ${d.sentBy}`);if(d.observation)parts.push(`Obs.: ${d.observation}`);if(d.reason)parts.push(`Motivo: ${d.reason}`);if(d.message)parts.push(d.message);return parts.length?`<p>${esc(parts.join(' • '))}</p>`:''}
function adminRequestActions(r){
  const technicianField=state.me.role==='staff'?`<div class="logged-tech"><small>Técnico responsável pelo recebimento</small><strong>${esc(state.me.technicianName||state.me.username)}</strong></div>`:`<label>Técnico responsável<select id="technicianId"><option value="">Selecione</option>${state.receivers.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`;
  return `<div class="form-card" style="margin-top:16px"><h4>Ações HLab Vet</h4><div class="stack compact">
  ${r.status==='solicitado'&&!r.accepted_at?`<button class="btn primary" id="acceptBtn">Aceitar solicitação</button>`:''}
  ${['solicitado','atribuido','coletado'].includes(r.status)&&r.accepted_at?`<label>Entregador<select id="assignCourier"><option value="">Selecione</option>${state.couriers.filter(c=>c.active).map(c=>`<option value="${c.id}" ${r.assigned_courier_id===c.id?'selected':''}>${esc(c.name)}${c.thermometer_code?` • ${esc(c.thermometer_code)}`:''}</option>`).join('')}</select></label><button class="btn secondary" id="assignBtn">Atribuir entregador</button>`:''}
  ${r.status==='coletado'?`${technicianField}<label>Temperatura no recebimento (°C)<input id="receiveTemp" type="number" step="0.1"></label><label>Local do recebimento<input id="receiveLocation" value="${esc(state.me.technicianLocation||'HLab Vet')}"></label><label>Observação<textarea id="receiveObservation" placeholder="Observação do recebimento, se houver"></textarea></label><button class="btn secondary" id="receiveBtn">Dar recebimento</button>`:''}
  ${['recebido','em_analise'].includes(r.status)?`<button class="btn soft" id="analysisBtn">Marcar Em análise</button>`:''}
  ${['recebido','em_analise','concluido'].includes(r.status)?`<label>Enviar resultado<input id="resultFile" type="file"></label><button class="btn secondary" id="uploadBtn">Enviar arquivo</button>`:''}
  ${['recebido','em_analise'].includes(r.status)?`<button class="btn primary" id="completeBtn">Marcar Concluído</button>`:''}
  ${!['concluido','cancelado'].includes(r.status)?`<button class="btn danger" id="cancelBtn">Cancelar requisição</button>`:''}
  </div></div>`
}
function bindAdminRequestActions(id,r){
  $('#acceptBtn')?.addEventListener('click',async()=>{unlockAudio();try{const x=await api(`/api/requisitions/${id}/accept`,{method:'POST'});toast(x.message);await pollLabAlerts();closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#assignBtn')?.addEventListener('click',async()=>{const courierId=Number($('#assignCourier').value);if(!courierId)return toast('Selecione o entregador.','error');try{const x=await api(`/api/requisitions/${id}/assign`,{json:{courierId}});toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#receiveBtn')?.addEventListener('click',async()=>{const body={temperature:$('#receiveTemp').value,location:$('#receiveLocation').value,observation:$('#receiveObservation').value};if(state.me.role==='admin')body.technicianId=Number($('#technicianId').value);try{const x=await api(`/api/requisitions/${id}/receive`,{json:body});toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#analysisBtn')?.addEventListener('click',async()=>{try{await api(`/api/requisitions/${id}/analysis`,{method:'POST'});toast('Exame em análise.');closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#completeBtn')?.addEventListener('click',async()=>{try{await api(`/api/requisitions/${id}/complete`,{method:'POST'});toast('Exame concluído.');closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#cancelBtn')?.addEventListener('click',async()=>{const reason=prompt('Motivo do cancelamento:');if(reason===null)return;try{await api(`/api/requisitions/${id}/cancel`,{json:{reason}});toast('Requisição cancelada.');closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#uploadBtn')?.addEventListener('click',async()=>{const file=$('#resultFile').files[0];if(!file)return toast('Selecione um arquivo.','error');const fd=new FormData();fd.append('file',file);try{const res=await fetch(`/api/requisitions/${id}/results`,{method:'POST',body:fd,credentials:'include'});const x=await res.json();if(!res.ok)throw new Error(x.error||'Falha no envio');toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
}

async function loadAdminLists(){
  if(state.me.role==='client')return;
  const [c,co,r]=await Promise.all([api('/api/clients'),api('/api/couriers'),api('/api/technicians')]);state.clients=c.clients||[];state.couriers=co.couriers||[];state.receivers=r.receivers||[];
}

async function renderClients(){
  const d=await api('/api/clients');state.clients=d.clients||[];const admin=state.me.role==='admin';$('#topActions').innerHTML=admin?`<button class="btn primary" id="addClient">＋ Cadastrar cliente</button>`:'';
  $('#content').innerHTML=`<div class="card">${!admin?'<p class="muted">Consulta de clientes. Cadastro, edição e senhas ficam exclusivos do administrador do laboratório.</p>':''}<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Usuário</th><th>Contato</th><th>Endereço</th><th>Status</th>${admin?'<th>Ações</th>':''}</tr></thead><tbody>${state.clients.map(c=>`<tr><td><strong>${esc(c.name)}</strong><br><small>${esc(c.document||'')}</small></td><td>${esc(c.username_display)}</td><td>${esc(c.phone||'')}<br><small>${esc(c.email||'')}</small></td><td>${esc([c.address,c.city,c.state].filter(Boolean).join(', '))}</td><td><span class="badge ${c.active?'concluido':'cancelado'}">${c.active?'Ativo':'Inativo'}</span></td>${admin?`<td><div class="actions"><button class="btn soft small" data-edit-client="${c.id}">Editar</button><button class="btn ghost small" data-reset-client="${c.id}">Alterar senha</button>${c.active?`<button class="btn danger small" data-delete-client="${c.id}">Desativar</button>`:''}</div></td>`:''}</tr>`).join('')}</tbody></table></div></div>`;
  if(admin){$('#addClient').addEventListener('click',()=>clientForm());$$('[data-edit-client]').forEach(b=>b.addEventListener('click',()=>clientForm(state.clients.find(x=>x.id===Number(b.dataset.editClient)))));$$('[data-reset-client]').forEach(b=>b.addEventListener('click',()=>resetClient(Number(b.dataset.resetClient))));$$('[data-delete-client]').forEach(b=>b.addEventListener('click',()=>deleteClient(Number(b.dataset.deleteClient))))}
}

function clientForm(c=null){
  modal(`<h3>${c?'Editar cliente':'Cadastrar cliente'}</h3><p class="muted">O formulário só fecha em Salvar ou Cancelar. O cliente usa este acesso principal para administrar a clínica e pode criar usuários/técnicos próprios depois.</p><form id="clientForm" class="stack"><div class="form-grid"><label class="field span2">Nome fantasia / clínica<input name="name" value="${esc(c?.name||'')}" required></label><label class="field span2">Razão social<input name="legalName" value="${esc(c?.legal_name||'')}"></label><label class="field">CNPJ/CPF<input name="document" value="${esc(c?.document||'')}"></label><label class="field">Telefone<input name="phone" value="${esc(c?.phone||'')}"></label><label class="field span2">E-mail<input name="email" type="email" value="${esc(c?.email||'')}"></label><label class="field span2">Endereço<input name="address" value="${esc(c?.address||'')}"></label><label class="field">Cidade<input name="city" value="${esc(c?.city||'Natal')}"></label><label class="field">UF<input name="state" value="${esc(c?.state||'RN')}"></label><label class="field">CEP<input name="zipCode" value="${esc(c?.zip_code||'')}"></label><label class="field">Usuário principal<input name="username" value="${esc(c?.username_display||'')}" required></label>${c?'':`<label class="field">Senha inicial<input name="password" type="password" minlength="8" required><small>Será trocada no primeiro login.</small></label>`}${c?`<label class="field">Ativo<select name="active"><option value="1" ${c.active?'selected':''}>Sim</option><option value="0" ${!c.active?'selected':''}>Não</option></select></label>`:''}</div><div class="actions"><button class="btn primary">Salvar cliente</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  $('#clientForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if('active'in b)b.active=b.active==='1';try{const r=await api(c?`/api/clients/${c.id}`:'/api/clients',{method:c?'PATCH':'POST',json:b});toast(r.message);closeModal();renderClients()}catch(er){toast(er.message,'error')}})
}

async function resetClient(id){const password=prompt('Digite a nova senha temporária (mínimo 8 caracteres):');if(password===null)return;try{const r=await api(`/api/clients/${id}/reset-password`,{json:{password}});toast(r.message)}catch(e){toast(e.message,'error')}}
async function deleteClient(id){if(!confirm('Desativar este cliente? O histórico será preservado.'))return;try{const r=await api(`/api/clients/${id}`,{method:'DELETE'});toast(r.message);renderClients()}catch(e){toast(e.message,'error')}}

async function renderCouriers(){
  const d=await api('/api/couriers');state.couriers=d.couriers||[];const admin=state.me.role==='admin';$('#topActions').innerHTML=admin?`<button class="btn primary" id="addCourier">＋ Entregador</button>`:'';
  $('#content').innerHTML=`<div class="card">${!admin?'<p class="muted">Consulta dos entregadores e respectivos termômetros. Alterações ficam exclusivas do administrador.</p>':''}<div class="table-wrap"><table><thead><tr><th>Entregador</th><th>Telefone</th><th>Termômetro</th><th>Status</th>${admin?'<th>Ações</th>':''}</tr></thead><tbody>${state.couriers.map(c=>`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.phone||'')}</td><td><strong>${esc(c.thermometer_code||'—')}</strong></td><td><span class="badge ${c.active?'concluido':'cancelado'}">${c.active?'Ativo':'Inativo'}</span></td>${admin?`<td><div class="actions"><button class="btn soft small" data-edit-courier="${c.id}">Editar</button><button class="btn secondary small" data-link-courier="${c.id}">Gerar novo link</button></div></td>`:''}</tr>`).join('')}</tbody></table></div></div>`;
  if(admin){$('#addCourier').addEventListener('click',()=>courierForm());$$('[data-edit-courier]').forEach(b=>b.addEventListener('click',()=>courierForm(state.couriers.find(x=>x.id===Number(b.dataset.editCourier)))));$$('[data-link-courier]').forEach(b=>b.addEventListener('click',()=>regenerateLink(Number(b.dataset.linkCourier))))}
}

function courierForm(c=null){
  modal(`<h3>${c?'Editar entregador':'Cadastrar entregador'}</h3><form id="courierForm" class="stack"><label>Nome<input name="name" value="${esc(c?.name||'')}" required></label><label>Telefone<input name="phone" value="${esc(c?.phone||'')}"></label><label>Número do termômetro<input name="thermometerCode" value="${esc(c?.thermometer_code||'TER-001')}" placeholder="TER-001" required><small>Use o padrão TER-001, TER-002, TER-003...</small></label>${c?`<label>Ativo<select name="active"><option value="1" ${c.active?'selected':''}>Sim</option><option value="0" ${!c.active?'selected':''}>Não</option></select></label>`:''}<div class="actions"><button class="btn primary">Salvar</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  $('#courierForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if('active'in b)b.active=b.active==='1';try{const r=await api(c?`/api/couriers/${c.id}`:'/api/couriers',{method:c?'PATCH':'POST',json:b});if(r.link){await navigator.clipboard?.writeText(r.link).catch(()=>{});modal(`<h3>Entregador cadastrado</h3><p>Copie e guarde este link privado:</p><label class="field"><input id="newCourierLink" value="${esc(r.link)}" readonly></label><div class="actions"><button class="btn primary" id="copyCourierLink">Copiar link</button><button class="btn ghost" data-close-modal>Fechar</button></div>`);$('#copyCourierLink').addEventListener('click',async()=>{await navigator.clipboard.writeText(r.link);toast('Link copiado.')})}else{toast(r.message);closeModal();renderCouriers()}}catch(er){toast(er.message,'error')}})
}
async function regenerateLink(id){if(!confirm('Gerar um novo link? O anterior deixará de funcionar.'))return;try{const r=await api(`/api/couriers/${id}/regenerate-link`,{method:'POST'});modal(`<h3>Novo link do entregador</h3><p>O link anterior foi invalidado.</p><label class="field"><input id="newCourierLink" value="${esc(r.link)}" readonly></label><button class="btn primary" id="copyCourierLink">Copiar link</button>`);$('#copyCourierLink').addEventListener('click',async()=>{await navigator.clipboard.writeText(r.link);toast('Link copiado.')})}catch(e){toast(e.message,'error')}}

async function renderReceivers(){
  const d=await api('/api/technicians');state.receivers=d.receivers||[];const admin=state.me.role==='admin';$('#topActions').innerHTML=admin?`<button class="btn primary" id="addReceiver">＋ Técnico</button>`:'';
  $('#content').innerHTML=`<div class="card"><p class="muted">Cada técnico possui login próprio. Quando registra o recebimento logado, o nome é gravado automaticamente.${!admin?' Somente o administrador pode cadastrar, editar ou redefinir outros técnicos.':''}</p><div class="table-wrap"><table><thead><tr><th>Técnico</th><th>Usuário</th><th>Local padrão</th><th>Status</th>${admin?'<th>Ações</th>':''}</tr></thead><tbody>${state.receivers.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.username_display||'Sem login')}</td><td>${esc(r.location||'HLab Vet')}</td><td><span class="badge ${r.active?'concluido':'cancelado'}">${r.active?'Ativo':'Inativo'}</span></td>${admin?`<td><div class="actions"><button class="btn soft small" data-edit-receiver="${r.id}">Editar</button>${r.user_id?`<button class="btn ghost small" data-reset-tech="${r.id}">Alterar senha</button>`:''}</div></td>`:''}</tr>`).join('')}</tbody></table></div></div>`;
  if(admin){$('#addReceiver').addEventListener('click',()=>receiverForm());$$('[data-edit-receiver]').forEach(b=>b.addEventListener('click',()=>receiverForm(state.receivers.find(x=>x.id===Number(b.dataset.editReceiver)))));$$('[data-reset-tech]').forEach(b=>b.addEventListener('click',()=>resetTechnician(Number(b.dataset.resetTech))))}
}

function receiverForm(r=null){
  modal(`<h3>${r?'Editar técnico':'Cadastrar técnico'}</h3><form id="receiverForm" class="stack"><label>Nome do técnico<input name="name" value="${esc(r?.name||'')}" required></label><label>Usuário de login<input name="username" value="${esc(r?.username_display||'')}" required></label>${!r?.user_id?`<label>Senha inicial<input name="password" type="password" minlength="8" required><small>O técnico deverá trocar no primeiro acesso.</small></label>`:''}<label>Local padrão do recebimento<input name="location" value="${esc(r?.location||'HLab Vet')}"></label>${r?`<label>Ativo<select name="active"><option value="1" ${r.active?'selected':''}>Sim</option><option value="0" ${!r.active?'selected':''}>Não</option></select></label>`:''}<div class="actions"><button class="btn primary">Salvar técnico</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  $('#receiverForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if('active'in b)b.active=b.active==='1';try{const x=await api(r?`/api/technicians/${r.id}`:'/api/technicians',{method:r?'PATCH':'POST',json:b});toast(x.message);closeModal();renderReceivers()}catch(er){toast(er.message,'error')}})
}
async function resetTechnician(id){const password=prompt('Digite a nova senha temporária do técnico (mínimo 8 caracteres):');if(password===null)return;try{const r=await api(`/api/technicians/${id}/reset-password`,{json:{password}});toast(r.message)}catch(e){toast(e.message,'error')}}


async function renderClientUsers(){
  if(state.me.role!=='client'||!state.me.canManageClientUsers)return navigate('dashboard');
  const d=await api('/api/client-users'),users=d.users||[];
  $('#topActions').innerHTML=`<button class="btn primary" id="addClientUser">＋ Usuário / técnico</button>`;
  $('#content').innerHTML=`<div class="card"><div class="section-title"><div><h3>Equipe da clínica</h3><p>O técnico é opcional. Usuário comum solicita exames sem carimbo; técnico logado usa o carimbo automático dele.</p></div></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Função / registro</th><th>Usuário</th><th>Status</th><th>Ações</th></tr></thead><tbody>${users.map(u=>`<tr><td><strong>${esc(u.name)}</strong>${u.can_manage_users?'<br><small>Usuário principal</small>':''}</td><td><span class="badge ${u.is_technician?'em_analise':'solicitado'}">${u.is_technician?'Técnico':'Usuário comum'}</span></td><td>${u.is_technician?`${esc(u.function_title||'Técnico')}<br><small>${esc([u.council_name,u.council_state,u.council_number].filter(Boolean).join(' '))}</small>`:'Sem carimbo'}</td><td>${esc(u.username_display)}</td><td><span class="badge ${u.active?'concluido':'cancelado'}">${u.active?'Ativo':'Inativo'}</span></td><td><div class="actions"><button class="btn soft small" data-edit-client-user="${u.id}">Editar</button><button class="btn ghost small" data-reset-client-user="${u.id}">Senha</button>${!u.can_manage_users&&u.active?`<button class="btn danger small" data-disable-client-user="${u.id}">Desativar</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></div>`;
  $('#addClientUser').addEventListener('click',()=>clientUserForm());
  $$('[data-edit-client-user]').forEach(b=>b.addEventListener('click',()=>clientUserForm(users.find(x=>x.id===Number(b.dataset.editClientUser)))));
  $$('[data-reset-client-user]').forEach(b=>b.addEventListener('click',()=>resetClientUser(Number(b.dataset.resetClientUser))));
  $$('[data-disable-client-user]').forEach(b=>b.addEventListener('click',()=>disableClientUser(Number(b.dataset.disableClientUser))));
}

function clientUserForm(u=null){
  const tech=!!u?.is_technician;
  modal(`<h3>${u?'Editar usuário':'Cadastrar usuário / técnico'}</h3><p class="muted">Marque como técnico somente quando esse usuário tiver carimbo profissional. Se não for técnico, nenhum carimbo será colocado nas requisições dele.</p><form id="clientUserForm" class="stack"><div class="form-grid"><label class="field span2">Nome completo<input name="name" value="${esc(u?.name||'')}" required></label><label class="field">Usuário de login<input name="username" value="${esc(u?.username_display||'')}" required></label>${u?'':`<label class="field">Senha inicial<input name="password" type="password" minlength="8" required></label>`}<label class="field">Tipo de acesso<select name="isTechnician" id="clientUserType"><option value="0" ${!tech?'selected':''}>Usuário comum — sem carimbo</option><option value="1" ${tech?'selected':''}>Técnico — com carimbo</option></select></label>${u?`<label class="field">Ativo<select name="active"><option value="1" ${u.active?'selected':''}>Sim</option><option value="0" ${!u.active?'selected':''}>Não</option></select></label>`:''}</div><div id="clientTechFields" class="form-card ${tech?'':'hidden'}"><h4>Dados do carimbo automático</h4><div class="form-grid"><label class="field span2">Função<input name="functionTitle" value="${esc(u?.function_title||'')}" placeholder="Ex.: Médica Veterinária"></label><label class="field">Conselho<input name="councilName" value="${esc(u?.council_name||'CRMV')}" placeholder="CRMV"></label><label class="field">UF<input name="councilState" value="${esc(u?.council_state||'RN')}" maxlength="2"></label><label class="field">Número do registro<input name="councilNumber" value="${esc(u?.council_number||'')}"></label><label class="field">Cor da tinta<input name="stampColor" type="color" value="${esc(u?.stamp_color||'#5c2a72')}"></label></div><div class="stamp-preview" id="clientTechPreview" style="margin-top:12px"></div></div><div class="actions"><button class="btn primary">Salvar</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  const form=$('#clientUserForm'),type=$('#clientUserType'),fields=$('#clientTechFields'),preview=$('#clientTechPreview');
  const draw=()=>{const f=new FormData(form),isTech=f.get('isTechnician')==='1';fields.classList.toggle('hidden',!isTech);if(preview&&isTech){const reg=[f.get('councilName')||'CRMV',f.get('councilState')].filter(Boolean).join('-')+' '+(f.get('councilNumber')||'');preview.innerHTML=stampHtml({name:f.get('name'),line2:f.get('functionTitle'),line3:reg.trim(),color:f.get('stampColor')})}};
  type.addEventListener('change',draw);form.addEventListener('input',draw);draw();
  form.addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(form));b.isTechnician=b.isTechnician==='1';if('active'in b)b.active=b.active==='1';if(!b.isTechnician){b.functionTitle='';b.councilNumber='';}try{const r=await api(u?`/api/client-users/${u.id}`:'/api/client-users',{method:u?'PATCH':'POST',json:b});toast(r.message);closeModal();renderClientUsers()}catch(er){toast(er.message,'error')}});
}

async function resetClientUser(id){const password=prompt('Digite a nova senha temporária (mínimo 8 caracteres):');if(password===null)return;try{const r=await api(`/api/client-users/${id}/reset-password`,{json:{password}});toast(r.message)}catch(e){toast(e.message,'error')}}
async function disableClientUser(id){if(!confirm('Desativar este usuário? O histórico será mantido.'))return;try{const r=await api(`/api/client-users/${id}`,{method:'DELETE'});toast(r.message);renderClientUsers()}catch(e){toast(e.message,'error')}}

async function renderStamp(){
  const r=await api('/api/my-client-profile'),p=r.profile;$('#content').innerHTML=`<div class="grid two"><form id="stampForm" class="card stack"><div class="section-title"><div><h3>Dados do carimbo</h3><p>Digite exatamente o que existe no carimbo do técnico, veterinário ou estabelecimento.</p></div></div><label>Linha principal<input name="stampName" value="${esc(p.stamp_name||p.name||'')}"></label><label>Linha 2<input name="stampLine2" value="${esc(p.stamp_line2||'')}"></label><label>Linha 3<input name="stampLine3" value="${esc(p.stamp_line3||'')}"></label><label>Linha 4<input name="stampLine4" value="${esc(p.stamp_line4||'')}"></label><label>Cor da tinta<input name="stampColor" type="color" value="${esc(p.stamp_color||'#5c2a72')}"></label><label>Telefone<input name="phone" value="${esc(p.phone||'')}"></label><label>E-mail<input name="email" value="${esc(p.email||'')}"></label><button class="btn primary">Salvar carimbo</button></form><div class="card"><h3>Prévia</h3><div class="stamp-preview" id="stampPreview"></div><p class="muted">A visualização usa textura e leve inclinação para se aproximar da aparência de tinta de carimbo. O conteúdo é salvo junto à requisição enviada.</p></div></div>`;
  const form=$('#stampForm'),draw=()=>{const f=new FormData(form);$('#stampPreview').innerHTML=stampHtml({name:f.get('stampName'),line2:f.get('stampLine2'),line3:f.get('stampLine3'),line4:f.get('stampLine4'),color:f.get('stampColor')})};form.addEventListener('input',draw);draw();form.addEventListener('submit',async e=>{e.preventDefault();try{const x=await api('/api/my-client-profile',{method:'PATCH',json:Object.fromEntries(new FormData(form))});toast(x.message)}catch(er){toast(er.message,'error')}})
}
function stampHtml(s){return `<div class="stamp" style="color:${esc(s.color||'#5c2a72')}"><strong>${esc(s.name||'CARIMBO')}</strong>${[s.line2,s.line3,s.line4].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div>`}

function showPasswordChange(forced=false){
  $('#pageTitle').textContent='Alterar senha';$('#pageSubtitle').textContent=forced?'Obrigatório no primeiro acesso':'Mantenha seu acesso protegido';
  $('#content').innerHTML=`<div class="card" style="max-width:560px"><div class="section-title"><div><h3>${forced?'Primeiro acesso: crie sua senha':'Alterar sua senha'}</h3><p>O nome de usuário ignora maiúsculas/minúsculas e acentos. A senha, por segurança, é exata.</p></div></div><form id="passwordForm" class="stack"><label>Senha atual<input name="currentPassword" type="password" required></label><label>Nova senha<input name="newPassword" type="password" minlength="8" required></label><label>Confirmar nova senha<input name="confirm" type="password" minlength="8" required></label><button class="btn primary">Salvar nova senha</button></form></div>`;
  $('#passwordForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if(b.newPassword!==b.confirm)return toast('A confirmação não confere.','error');delete b.confirm;try{const x=await api('/api/change-password',{json:b});toast(x.message);const m=await api('/api/me');state.me=m.user;state.profile=m.profile;renderNav();navigate('dashboard')}catch(er){toast(er.message,'error')}})
}


async function renderCancellations(){
  if(state.me.role==='client')return navigate('requests');
  await loadAdminLists();
  $('#content').innerHTML=`<div class="card"><form id="cancelFilters" class="filters"><input name="from" type="date" value="${today()}"><input name="to" type="date" value="${today()}"><select name="clientId"><option value="">Todos os clientes</option>${state.clients.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button class="btn primary">Pesquisar</button><button type="button" class="btn ghost" id="cancelMonth">Este mês</button></form><p class="muted">Aqui ficam as solicitações canceladas pelo cliente, laboratório ou técnico, com data, responsável e motivo. Cancelamentos não entram no financeiro.</p><div id="cancelResults"></div></div>`;
  const load=async()=>{const qs=new URLSearchParams(new FormData($('#cancelFilters')));for(const[k,v]of[...qs])if(!v)qs.delete(k);const d=await api(`/api/cancellations?${qs}`);$('#cancelResults').innerHTML=d.cancellations.length?`<div class="table-wrap"><table><thead><tr><th>Cancelado em</th><th>Protocolo</th><th>Cliente</th><th>Paciente</th><th>Cancelado por</th><th>Motivo</th><th></th></tr></thead><tbody>${d.cancellations.map(r=>`<tr><td>${fmtDateTime(r.cancelled_at)}</td><td>${esc(r.protocol)}</td><td>${esc(r.client_name)}</td><td>${esc(r.patient_name)}</td><td>${esc(r.cancelled_by_name||'—')}<br><small>${r.cancelled_by_role==='client'?'Cliente':r.cancelled_by_role==='staff'?'Técnico HLabVet':'Laboratório'}</small></td><td>${esc(r.cancellation_reason||'—')}</td><td><button class="btn soft small" data-detail="${r.id}">Abrir</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Nenhum cancelamento no período.</div>';bindDetailButtons()};
  $('#cancelFilters').addEventListener('submit',e=>{e.preventDefault();load()});
  $('#cancelMonth').addEventListener('click',()=>{const f=$('#cancelFilters'),d=new Date(),first=new Date(d.getFullYear(),d.getMonth(),1).toLocaleDateString('sv-SE');f.elements.from.value=first;f.elements.to.value=today();load()});
  await load();
}

const fmtMoney=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100);

async function renderPrices(){
  if(state.me.role!=='admin')return navigate('dashboard');
  await loadAdminLists();
  $('#content').innerHTML=`<div class="card"><div class="section-title"><div><h3>Tabela de preços</h3><p>Cadastre o preço geral. Se um cliente tiver valor negociado, selecione-o e informe apenas o valor diferente.</p></div></div><div class="filters" style="grid-template-columns:minmax(260px,1fr) auto"><select id="priceClient"><option value="">Somente preços gerais</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button class="btn ghost" id="reloadPrices">Atualizar</button></div><div id="priceList"></div></div>`;
  const load=async()=>{const clientId=$('#priceClient').value,qs=clientId?`?clientId=${encodeURIComponent(clientId)}`:'';const d=await api(`/api/prices${qs}`);const groups=new Map();for(const x of d.items){if(!groups.has(x.category))groups.set(x.category,[]);groups.get(x.category).push(x)}$('#priceList').innerHTML=[...groups.entries()].map(([cat,items])=>`<section class="price-group"><h4>${esc(cat)}</h4><div class="table-wrap"><table><thead><tr><th>Exame</th><th>Preço geral</th>${clientId?'<th>Preço deste cliente</th><th>Preço usado</th>':''}<th></th></tr></thead><tbody>${items.map(x=>`<tr class="${x.effectivePriceCents==null?'price-missing':''}"><td><strong>${esc(x.examName)}</strong>${x.effectivePriceCents==null?'<br><small class="danger-text">Sem preço cadastrado</small>':''}</td><td><input class="money-input" data-general-price="${x.examCode}" value="${x.generalPriceCents==null?'':(x.generalPriceCents/100).toFixed(2).replace('.',',')}" placeholder="0,00"></td>${clientId?`<td><input class="money-input" data-client-price="${x.examCode}" value="${x.clientPriceCents==null?'':(x.clientPriceCents/100).toFixed(2).replace('.',',')}" placeholder="usar geral"></td><td><strong>${x.effectivePriceCents==null?'—':fmtMoney(x.effectivePriceCents)}</strong><br><small>${x.source==='client'?'Individual':x.source==='general'?'Geral':'Pendente'}</small></td>`:''}<td><div class="actions"><button class="btn soft small" data-save-general="${x.examCode}">Salvar geral</button>${clientId?`<button class="btn secondary small" data-save-client="${x.examCode}">Salvar cliente</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></section>`).join('');
    $$('[data-save-general]').forEach(b=>b.addEventListener('click',async()=>{const code=b.dataset.saveGeneral,price=$(`[data-general-price="${code}"]`).value;try{const r=await api('/api/prices/general',{json:{examCode:code,price}});toast(r.message);load();pollLabAlerts()}catch(e){toast(e.message,'error')}}));
    $$('[data-save-client]').forEach(b=>b.addEventListener('click',async()=>{const code=b.dataset.saveClient,price=$(`[data-client-price="${code}"]`).value;try{const r=await api('/api/prices/client',{json:{clientId:Number(clientId),examCode:code,price}});toast(r.message);load();pollLabAlerts()}catch(e){toast(e.message,'error')}}));
  };
  $('#priceClient').addEventListener('change',load);$('#reloadPrices').addEventListener('click',load);await load();
}

async function renderFinance(){
  if(state.me.role!=='admin')return navigate('dashboard');
  await loadAdminLists();
  const first=today().slice(0,8)+'01';
  $('#content').innerHTML=`<div class="card"><form id="financeFilters" class="filters"><input name="from" type="date" value="${first}" required><input name="to" type="date" value="${today()}" required><button class="btn primary">Atualizar período</button></form><p class="muted">Somente amostras recebidas pelo HLabVet entram na cobrança. Solicitações canceladas ficam automaticamente fora dos totais.</p></div><div id="financeRanking" style="margin-top:14px"></div><div id="financeReport" style="margin-top:14px"></div>`;
  let selectedClient=null,currentReport=null;
  const periodQs=()=>new URLSearchParams(new FormData($('#financeFilters')));
  const loadRanking=async()=>{const d=await api(`/api/finance/clients?${periodQs()}`);$('#financeRanking').innerHTML=`<div class="card"><div class="section-title"><div><h3>Clientes no período</h3><p>Ordenado por quantidade de solicitações.</p></div></div>${d.clients.length?`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Solicitações</th><th>Exames</th><th>Sem preço</th><th>Total</th><th></th></tr></thead><tbody>${d.clients.map(c=>`<tr><td><strong>${esc(c.client_name)}</strong></td><td>${c.request_count}</td><td>${c.exam_count}</td><td>${Number(c.missing_price_count)?`<span class="badge cancelado">${c.missing_price_count}</span>`:'0'}</td><td><strong>${fmtMoney(c.total_cents)}</strong></td><td><button class="btn soft small" data-fin-client="${c.client_id}">Ver espelho</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Nenhuma amostra recebida no período.</div>'}</div>`;$$('[data-fin-client]').forEach(b=>b.addEventListener('click',()=>loadReport(Number(b.dataset.finClient))));};
  const loadReport=async clientId=>{selectedClient=clientId;const qs=periodQs();qs.set('clientId',clientId);const d=await api(`/api/finance/report?${qs}`);currentReport=d;const byDay=new Map();for(const x of d.items){const day=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza'}).format(new Date(x.lab_received_at));if(!byDay.has(day,[]))byDay.set(day,[]);byDay.get(day).push(x)}$('#financeReport').innerHTML=`<div class="card"><div class="section-title"><div><h3>Espelho • ${esc(d.client.name)}</h3><p>${esc(d.from||'')} até ${esc(d.to||'')}</p></div><div class="finance-total">${fmtMoney(d.totalCents)}</div></div>${d.missingPriceCount?`<div class="warning-box">⚠ Existem ${d.missingPriceCount} exame(s) sem preço. O total será incompleto até a precificação.</div>`:''}<div class="finance-days">${[...byDay.entries()].map(([day,items])=>{const total=items.reduce((a,x)=>a+(Number(x.unit_price_cents)||0),0);return `<details class="finance-day"><summary><span>${day}</span><span>${items.length} exame${items.length>1?'s':''}</span><strong>${fmtMoney(total)}</strong><span class="chevron">⌄</span></summary><div class="table-wrap"><table><thead><tr><th>Protocolo</th><th>Paciente</th><th>Exame</th><th>Valor</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.protocol)}</td><td>${esc(x.patient_name)}</td><td>${esc(x.exam_name)}</td><td>${x.unit_price_cents==null?'<span class="danger-text">Sem preço</span>':fmtMoney(x.unit_price_cents)}</td></tr>`).join('')}</tbody></table></div></details>`}).join('')||'<div class="empty-state">Nenhum exame faturável neste período.</div>'}</div><div class="actions" style="margin-top:14px"><button class="btn secondary" id="printFinance">Imprimir / PDF</button></div></div>`;$('#printFinance')?.addEventListener('click',()=>printFinanceReport(d));};
  $('#financeFilters').addEventListener('submit',e=>{e.preventDefault();loadRanking();if(selectedClient)loadReport(selectedClient)});await loadRanking();
}

function printFinanceReport(d){
  const byDay=new Map();for(const x of d.items){const day=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza'}).format(new Date(x.lab_received_at));if(!byDay.has(day,[]))byDay.set(day,[]);byDay.get(day).push(x)}
  const body=`<h1>HLab Vet Resultados</h1><h2>Espelho de exames — ${esc(d.client.name)}</h2><p>Período: ${esc(d.from||'')} a ${esc(d.to||'')}</p>${[...byDay.entries()].map(([day,items])=>`<h3>${day} — ${fmtMoney(items.reduce((a,x)=>a+(Number(x.unit_price_cents)||0),0))}</h3><table><thead><tr><th>Protocolo</th><th>Paciente</th><th>Exame</th><th>Valor</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.protocol)}</td><td>${esc(x.patient_name)}</td><td>${esc(x.exam_name)}</td><td>${x.unit_price_cents==null?'SEM PREÇO':fmtMoney(x.unit_price_cents)}</td></tr>`).join('')}</tbody></table>`).join('')}<h2>Total: ${fmtMoney(d.totalCents)}</h2>`;
  printWindow('Espelho financeiro HLabVet',body,'body{font-family:Arial,sans-serif;color:#111}h1{color:#64236f}table{width:100%;border-collapse:collapse;margin-bottom:18px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}');
}

async function renderAudit(){const d=await api('/api/audit?limit=300');$('#content').innerHTML=`<div class="card"><div class="table-wrap"><table><thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Registro</th><th>Detalhes</th></tr></thead><tbody>${d.events.map(e=>`<tr><td>${fmtDateTime(e.created_at)}</td><td>${esc(e.actor_name||'Sistema')}</td><td>${esc(e.action)}</td><td>${esc([e.entity_type,e.entity_id].filter(Boolean).join(' #'))}</td><td><small>${esc(e.details?JSON.stringify(e.details):'')}</small></td></tr>`).join('')}</tbody></table></div></div>`}

async function renderTemperature(){
  if(state.me.role==='client'){return navigate('dashboard')}
  await loadAdminLists();
  $('#content').innerHTML=`<div class="card no-print"><form id="tempFilters" class="filters"><input name="month" type="month" value="${currentMonth()}" required><select name="courierId"><option value="">Todos os entregadores / termômetros</option>${state.couriers.map(c=>`<option value="${c.id}">${esc(c.name)}${c.thermometer_code?` • ${esc(c.thermometer_code)}`:''}</option>`).join('')}</select><button class="btn primary">Buscar mês</button><button type="button" class="btn secondary" id="printTemp">Imprimir / PDF</button></form><p class="muted">A ficha é exclusiva do laboratório. Quando houver mais de um termômetro, o sistema gera uma ficha separada para cada entregador/termômetro.</p></div><div id="tempResult" style="margin-top:14px"></div>`;
  let currentData=null;const load=async()=>{const qs=new URLSearchParams(new FormData($('#tempFilters')));for(const[k,v]of[...qs])if(!v)qs.delete(k);currentData=await api(`/api/temperature-sheet?${qs}`);$('#tempResult').innerHTML=temperatureSheetsHtml(currentData)};$('#tempFilters').addEventListener('submit',e=>{e.preventDefault();load()});$('#printTemp').addEventListener('click',()=>{if(!currentData)return;printTemperature(currentData)});await load();
}
function temperatureSheetsHtml(data){
  const entries=data.entries||[],byKey=new Map();
  for(const r of entries){const key=`${r.thermometer_code||'SEM'}|${r.courier_name||'Sem entregador'}`;if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(r)}
  if(!byKey.size)byKey.set('SEM|Sem entregador',[]);
  const sheets=[];
  for(const rows of byKey.values()){
    const pageCount=Math.max(1,Math.ceil(rows.length/45));
    for(let page=0;page<pageCount;page++)sheets.push(temperatureSheetInner(data.month,rows.slice(page*45,(page+1)*45),page+1,pageCount));
  }
  return sheets.map((h,i)=>`<div class="temp-sheet-screen ${i<sheets.length-1?'page-break':''}">${h}</div>`).join('');
}
function temperatureSheetInner(month,rows,page,total){
  const [year]=month.split('-'),monthName=new Intl.DateTimeFormat('pt-BR',{month:'long',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
  const first=rows[0],courier=first?.courier_name||'Sem entregador',thermometer=first?.thermometer_code||'—';
  const padded=[...rows];while(padded.length<45)padded.push(null);
  return `<div class="temp-sheet"><div class="temp-header"><div><img src="/assets/hlabvet-logo.png"></div><div class="temp-company">HLABVET DIAGNÓSTICOS VETERINÁRIOS LTDA<br>CNPJ: 88.816.118/0001-84<br>RUA AMÉRICO SOARES WANDERLEY, 1945 - CAPIM MACIO, NATAL - RN, 59082-080, BRASIL</div><div><strong>ENTREGADOR:</strong><br>${esc(courier)}</div></div><div class="temp-title">FICHA DE CONTROLE DE TEMPERATURA HLABVET</div><div class="temp-info"><div><b>SETOR:</b> TRANSPORTE DE AMOSTRAS</div><div><b>TERMÔMETRO:</b> ${esc(thermometer)}</div><div><b>MÊS:</b> ${esc(monthName)} &nbsp; <b>ANO:</b> ${year}</div><div><b>CONTATO HLABVET:</b> (84) 99180-4816 ${total>1?` • PÁG. ${page}/${total}`:''}</div></div><table class="temp-table"><thead><tr class="super"><th colspan="6">DADOS DO ENVIO</th><th colspan="5">DADOS DO RECEBIMENTO</th></tr><tr><th>Nº</th><th>DATA</th><th>HORA</th><th>TEMP.</th><th>LOCAL</th><th>RESPONSÁVEL</th><th>HORA</th><th>TEMP.</th><th>LOCAL</th><th>RESPONSÁVEL</th><th>OBSERVAÇÃO</th></tr></thead><tbody>${padded.map((r,i)=>`<tr><td>${((page-1)*45)+i+1}</td><td>${r?fmtDate(r.collected_at):''}</td><td>${r?fmtTime(r.collected_at):''}</td><td>${r?.collection_temperature!=null?`${esc(r.collection_temperature)}°C`:''}</td><td style="text-align:left">${r?esc(r.sent_from_location||r.client_name||''):''}</td><td style="text-align:left">${r?esc(r.sent_by_name||''):''}</td><td>${r?fmtTime(r.lab_received_at):''}</td><td>${r?.lab_received_temperature!=null?`${esc(r.lab_received_temperature)}°C`:''}</td><td style="text-align:left">${r?esc(r.received_location||''):''}</td><td style="text-align:left">${r?esc(r.receiver_name||''):''}</td><td style="text-align:left">${r?esc(r.receiving_observation||''):''}</td></tr>`).join('')}</tbody></table><div class="temp-notes">* Sempre identificar o termômetro e o entregador. &nbsp; * Temperatura refrigerada: 2°C a 8°C. Monitorar durante o transporte e, ao atingir 20°C, substituir o gelo.</div></div>`;
}

async function renderCourierPortal(token){
  $('#loginView').classList.add('hidden');$('#appView').classList.add('hidden');$('#courierView').classList.remove('hidden');document.body.classList.add('courier-mobile-mode');let tab='pending';
  const render=async()=>{try{
    const oldFrom=$('#courierFrom')?.value||'',oldTo=$('#courierTo')?.value||'';
    const qs=new URLSearchParams({tab});if(oldFrom)qs.set('from',oldFrom);if(oldTo)qs.set('to',oldTo);
    const d=await api(`/api/courier/${encodeURIComponent(token)}/tasks?${qs}`);
    $('#courierView').innerHTML=`<div class="courier-shell"><header class="courier-head"><div class="inner"><img src="/assets/hlabvet-logo.png" alt="HLabVet"><div class="courier-ident"><strong>${esc(d.courier.name)}</strong><small>Entregador HLabVet • ${esc(d.courier.thermometer_code||'Sem termômetro')}</small></div></div></header><main class="courier-main"><div class="courier-tabs"><button class="courier-tab ${tab==='pending'?'active':''}" data-tab="pending"><span>Pendentes</span></button><button class="courier-tab ${tab==='collected'?'active':''}" data-tab="collected"><span>Histórico</span></button></div>${tab==='collected'?`<details class="courier-filter-box"><summary>Filtrar período</summary><div class="courier-filter-grid"><label>De<input id="courierFrom" type="date" value="${esc(oldFrom)}"></label><label>Até<input id="courierTo" type="date" value="${esc(oldTo)}"></label><button class="btn ghost" id="courierFilter">Aplicar filtro</button></div></details>`:''}<div class="courier-task-list">${d.tasks.length?d.tasks.map(t=>courierTask(t,tab)).join(''):`<div class="courier-empty">${tab==='pending'?'Nenhuma coleta pendente agora.':'Nenhuma coleta encontrada neste período.'}</div>`}</div></main></div>`;
    $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.tab;render()}));
    $('#courierFilter')?.addEventListener('click',render);
    $$('[data-collect]').forEach(b=>b.addEventListener('click',()=>collectTask(token,Number(b.dataset.collect))));
  }catch(e){$('#courierView').innerHTML=`<div class="courier-shell"><div class="courier-error"><img src="/assets/hlabvet-logo.png"><h2>Link inválido</h2><p>${esc(e.message)}</p></div></div>`}};
  await render();
}
function courierTask(t,tab){
  const phoneDigits=String(t.phone||'').replace(/\D/g,'');
  const address=[t.address,t.city,t.state].filter(Boolean).join(', ');
  return `<article class="courier-task-card"><div class="courier-task-top"><div><small>${esc(t.protocol)}</small><h3>${esc(t.client_name)}</h3><p>${esc(t.patient_name)}${t.species?` • ${esc(t.species)}`:''}</p></div><span class="badge ${t.status}">${esc(STATUS[t.status]||t.status)}</span></div><div class="courier-info-row"><span>📍</span><div><small>LOCAL DA COLETA</small><strong>${esc(address||t.client_name)}</strong></div></div><div class="courier-info-grid"><div><small>TERMÔMETRO</small><strong>${esc(t.thermometer_code||'—')}</strong></div><div><small>CONTATO</small><strong>${esc(t.phone||'—')}</strong></div></div>${phoneDigits?`<a class="courier-call" href="tel:${phoneDigits}">Ligar para o local</a>`:''}${tab==='pending'?`<form class="courier-collect-form" data-collect-form="${t.id}"><label>Temperatura da amostra (°C)<input name="temperature" inputmode="decimal" type="number" step="0.1" required placeholder="Ex.: 4,0"></label><label>Quem entregou a amostra?<input name="sentByName" required placeholder="Nome do responsável"></label><label>Local de envio<input name="sentFromLocation" value="${esc(t.client_name)}" readonly></label><button class="courier-primary-action" type="button" data-collect="${t.id}">CONFIRMAR COLETA</button></form>`:`<div class="courier-history-data"><div><small>COLETADO EM</small><strong>${fmtDateTime(t.collected_at)}</strong></div><div><small>TEMPERATURA</small><strong>${t.collection_temperature!=null?`${esc(t.collection_temperature)} °C`:'—'}</strong></div><div><small>RESPONSÁVEL</small><strong>${esc(t.sent_by_name||'—')}</strong></div><div><small>LOCAL</small><strong>${esc(t.sent_from_location||t.client_name)}</strong></div></div>`}</article>`;
}

async function collectTask(token,id){const form=$(`[data-collect-form="${id}"]`);if(!form.reportValidity())return;const body=Object.fromEntries(new FormData(form));try{const r=await api(`/api/courier/${encodeURIComponent(token)}/requisitions/${id}/collect`,{json:body});toast(r.message);const btn=$(`[data-tab="pending"]`);if(btn)btn.click();else location.reload()}catch(e){toast(e.message,'error')}}

function printRequisition(data){printManyRequisitions([data])}
function printManyRequisitions(items){if(!items.length)return;const html=items.map(d=>requisitionPrintHtml(d)).join('<div style="page-break-after:always"></div>');printWindow('Requisições HLabVet',html,printCss())}
function requisitionPrintHtml(d){const r=d.requisition, selected=new Set(d.exams.map(x=>x.exam_code)), mats=new Set(d.materials);let stamp={};try{stamp=JSON.parse(r.stamp_snapshot_json||'{}')}catch{}
  const groups=state.catalog||[];const leftNames=new Set(['Hematologia','Análise fecal','Urinálises','Citologia','Parasitologia','Testes rápidos','Sorologias']);const left=groups.filter(g=>leftNames.has(g.category)),right=groups.filter(g=>!leftNames.has(g.category));
  const examBox=g=>`<section class="pbox"><h4>${esc(g.category)}</h4>${g.items.map(x=>`<div class="pline"><span class="cb">${selected.has(x.code)?'✓':''}</span>${esc(x.name)}</div>`).join('')}</section>`;
  return `<div class="req-paper"><header class="req-head"><img src="${location.origin}/assets/hlabvet-logo.png"><h1>REQUISIÇÃO DE EXAMES<br>USO VETERINÁRIO</h1></header><div class="patient-grid"><div><b>CLÍNICA:</b> ${esc(r.clinic_name||r.client_name||'')}<br><b>VETERINÁRIO:</b> ${esc(r.veterinarian_name||'')}<br><b>CRMV:</b> ${esc(r.crmv||'')}<br><b>TUTOR:</b> ${esc(r.tutor_name||'')}<br><b>DATA:</b> ${esc(r.collection_date?fmtDate(r.collection_date):fmtDate(r.created_at))}</div><div><b>PACIENTE:</b> ${esc(r.patient_name)}<br><b>ESPÉCIE:</b> ${esc(r.species||'')}<br><b>RAÇA:</b> ${esc(r.breed||'')}<br><b>SEXO:</b> ${esc(r.sex||'')}<br><b>IDADE:</b> ${esc(r.age_text||'')}</div></div><div class="req-cols"><div>${left.map(examBox).join('')}<div class="pathologist"><b>PATOLOGISTA RESPONSÁVEL</b><br>Dr. Antônio Rodrigues | CRMV-RN 1568<br>Rua Américo Soares Wanderley, 1945 - Capim Macio, Natal/RN<br>(84) 99827-3567</div></div><div>${right.map(examBox).join('')}<section class="pbox"><h4>MATERIAL ENVIADO</h4>${['Sangue total','Soro','Plasma','Urina','Fezes'].map(m=>`<div class="pline"><span class="cb">${mats.has(m)?'✓':''}</span>${m}</div>`).join('')}<div><b>Outros:</b> ${esc(r.material_other||'')}</div></section><section class="pbox"><h4>INFORMAÇÕES CLÍNICAS / OBSERVAÇÕES</h4><div class="clin">${esc(r.clinical_info||'')}</div></section><div class="stamp-box">${stamp.name?`<div class="print-stamp" style="color:${esc(stamp.color||'#5c2a72')}"><b>${esc(stamp.name)}</b>${[stamp.line2,stamp.line3,stamp.line4].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}</div></div></div><div class="proto">Protocolo: ${esc(r.protocol)} • Gerado pelo HLab Vet Resultados</div></div>`;
}
function printTemperature(data){printWindow('Ficha de Controle de Temperatura',temperatureSheetsHtml(data).replaceAll('temp-sheet-screen','temp-sheet-print'),printCss()+`@page{size:A4 landscape;margin:6mm}.temp-sheet-print{page-break-after:always}.temp-sheet-print:last-child{page-break-after:auto}`)}
function printWindow(title,body,css){const w=window.open('','_blank');if(!w)return toast('O navegador bloqueou a janela de impressão. Libere pop-ups.','error');w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}<script>setTimeout(()=>window.print(),500)<\/script></body></html>`);w.document.close()}
function printCss(){return `@page{size:A4;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0}.req-paper{font-size:10.5px}.req-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.req-head img{width:150px}.req-head h1{text-align:right;font-size:20px;margin:0;color:#4f4f4f}.patient-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #aaa;border-radius:12px;padding:10px;gap:16px;line-height:1.75}.req-cols{display:grid;grid-template-columns:1fr 1.18fr;gap:10px;margin-top:8px}.pbox{border:1px solid #aaa;border-radius:10px;overflow:hidden;margin-bottom:7px;padding-bottom:5px}.pbox h4{margin:0 0 5px;background:#8f5f97;color:#fff;padding:4px 8px;font-size:11px}.pline{padding:1px 7px}.cb{display:inline-grid;place-items:center;width:11px;height:11px;border:1px solid #888;margin-right:4px;vertical-align:middle;font-size:10px;font-weight:bold}.clin{padding:6px;min-height:70px;white-space:pre-wrap}.stamp-box{height:92px;border:1px solid #aaa;border-radius:10px;display:grid;place-items:center;color:#bbb;font-size:18px}.print-stamp{border:3px double currentColor;border-radius:7px;padding:8px 15px;text-align:center;transform:rotate(-1deg);opacity:.83;text-transform:uppercase;font-family:Georgia,serif}.print-stamp b{display:block;font-size:14px}.print-stamp span{display:block;font-size:10px;margin-top:2px}.pathologist{font-size:9px;margin:8px 4px}.proto{text-align:right;margin-top:5px;color:#777;font-size:8px}.temp-sheet{font-family:Arial,sans-serif;color:#000}.temp-header{display:grid;grid-template-columns:170px 1fr 160px;border:1px solid #000}.temp-header>div{border-right:1px solid #000;padding:5px}.temp-header>div:last-child{border:0}.temp-header img{width:145px}.temp-company{text-align:center;font-size:9px;font-weight:700}.temp-title{background:#6a236f;color:#fff;text-align:center;font-weight:700;padding:3px;border-left:1px solid #000;border-right:1px solid #000}.temp-info{display:grid;grid-template-columns:1fr 1fr 1fr 2fr;border:1px solid #000;border-top:0}.temp-info div{padding:3px 5px;border-right:1px solid #000;font-size:9px}.temp-info div:last-child{border:0}.temp-table{width:100%;border-collapse:collapse;font-size:7.8px}.temp-table th,.temp-table td{border:1px solid #000;padding:2px;text-align:center;height:14px}.temp-table th{background:#154f53;color:#fff}.temp-table .super th{background:#fff;color:#000}.temp-notes{font-size:8px;padding:5px}.page-break{page-break-after:always}`}

boot();
