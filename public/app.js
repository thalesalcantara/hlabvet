const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = { me:null, catalog:null, page:null, clients:[], couriers:[], receivers:[] };
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
function toast(msg,type='ok'){const el=$('#toast');el.textContent=msg;el.className=`toast show ${type}`;clearTimeout(toast.t);toast.t=setTimeout(()=>el.className='toast',3300)}
function modal(html){$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden')}
function closeModal(){$('#modal').classList.add('hidden');$('#modalContent').innerHTML=''}
document.addEventListener('click',e=>{if(e.target.matches('[data-close-modal]')||e.target.id==='modal')closeModal()});

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
  $('#sideUser').innerHTML=`<strong>${esc(state.me.clientName||state.me.username)}</strong><small>${state.me.role==='client'?'Cliente HLabVet':'HLab Vet'}</small>`;
  renderNav();
  if(state.me.forcePasswordChange) return showPasswordChange(true);
  navigate('dashboard');
}

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/login',{json:Object.fromEntries(f)});const m=await api('/api/me');state.me=m.user;state.profile=m.profile;showApp();toast('Acesso realizado.');}catch(err){toast(err.message,'error')}});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'})}catch{} state.me=null;showLogin();});
$('#menuBtn').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));

function renderNav(){
  const client = state.me.role==='client';
  const items = client ? [
    ['dashboard','⌂','Painel'],['new-request','＋','Nova solicitação'],['requests','▣','Meus exames'],['stamp','▧','Meu carimbo'],['temperature','▤','Temperaturas'],['password','⚿','Alterar senha']
  ] : [
    ['dashboard','⌂','Painel'],['requests','▣','Solicitações'],['clients','♙','Clientes'],['couriers','➜','Entregadores'],['receivers','✓','Recebedores'],['temperature','▤','Temperaturas'],['audit','◴','Auditoria'],['password','⚿','Alterar senha']
  ];
  $('#nav').innerHTML=items.map(([id,ic,label])=>`<button class="nav-btn" data-page="${id}"><span>${ic}</span>${label}</button>`).join('');
  $$('.nav-btn').forEach(b=>b.addEventListener('click',()=>{navigate(b.dataset.page);$('.sidebar').classList.remove('open')}));
}
async function navigate(page){
  state.page=page; $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); $('#topActions').innerHTML='';
  const map={dashboard:['Painel','Visão geral do atendimento'],requests:[state.me.role==='client'?'Meus exames':'Solicitações','Pesquise por período, animal, tutor, raça e outros dados'],clients:['Clientes','Cadastros e acessos dos clientes'],couriers:['Entregadores','Links privados e histórico de coletas'],receivers:['Recebedores','Equipe que recebe as amostras no laboratório'],temperature:['Controle de temperatura','Fichas mensais de envio e recebimento'],stamp:['Meu carimbo','Configure como o carimbo aparece na requisição'],password:['Alterar senha','A senha diferencia maiúsculas e minúsculas'],audit:['Auditoria','Registro de ações importantes'], 'new-request':['Nova solicitação','Requisição de exames veterinários']};
  $('#pageTitle').textContent=map[page]?.[0]||'HLab Vet';$('#pageSubtitle').textContent=map[page]?.[1]||'';
  const fn={dashboard:renderDashboard,requests:renderRequests,clients:renderClients,couriers:renderCouriers,receivers:renderReceivers,temperature:renderTemperature,stamp:renderStamp,password:()=>showPasswordChange(false),audit:renderAudit,'new-request':renderNewRequest}[page];
  try{await fn?.()}catch(e){if(e.status===428)return showPasswordChange(true);$('#content').innerHTML=`<div class="card empty-state">${esc(e.message)}</div>`;toast(e.message,'error')}
}

async function renderDashboard(){
  const d=await api('/api/dashboard');const t=d.totals||{};
  $('#content').innerHTML=`<div class="grid cards">
    ${metric('Solicitados',t.solicitado||0)}${metric('Em coleta',(t.atribuido||0)+(t.coletado||0))}${metric('Em análise',(t.recebido||0)+(t.em_analise||0))}${metric('Concluídos',t.concluido||0)}
  </div><div class="card" style="margin-top:16px"><div class="section-title"><div><h3>Movimentações recentes</h3><p>Últimas solicitações cadastradas.</p></div></div>${requestTable(d.recent||[],false)}</div>`;
  bindDetailButtons();
}
function metric(label,n){return `<div class="card metric"><div class="number">${n}</div><div class="label">${label}</div></div>`}

async function renderRequests(){
  if(state.me.role!=='client'){await loadAdminLists();$('#topActions').innerHTML=`<button class="btn soft" id="newAdminReq">＋ Nova solicitação</button><button class="btn secondary" id="printFiltered">Imprimir filtradas</button>`;$('#newAdminReq')?.addEventListener('click',()=>navigate('new-request'));}
  else $('#topActions').innerHTML=`<button class="btn primary" id="newReqTop">＋ Nova solicitação</button><button class="btn secondary" id="printFiltered">Imprimir filtradas</button>`;
  $('#newReqTop')?.addEventListener('click',()=>navigate('new-request'));
  $('#content').innerHTML=`<div class="card"><form id="reqFilters" class="filters">
    <input class="span2" name="q" placeholder="Busca geral: protocolo, exame, animal, tutor...">
    <select name="status"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
    <input name="from" type="date" title="Data inicial"><input name="to" type="date" title="Data final">
    ${state.me.role!=='client'?`<select name="clientId"><option value="">Todos os clientes</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`:''}
    <input name="patient" placeholder="Nome do animal"><input name="tutor" placeholder="Tutor"><input name="birth" type="date" title="Nascimento do animal"><input name="breed" placeholder="Raça">
    <button class="btn primary" type="submit">Pesquisar</button><button class="btn ghost" type="button" id="clearReqFilters">Limpar</button>
  </form><div id="reqResults"><div class="empty-state">Carregando…</div></div></div>`;
  let current=[];
  const load=async()=>{const qs=new URLSearchParams(new FormData($('#reqFilters')));for(const [k,v] of [...qs])if(!v)qs.delete(k);const r=await api(`/api/requisitions?${qs}`);current=r.requisitions||[];$('#reqResults').innerHTML=requestTable(current,true);bindDetailButtons();};
  $('#reqFilters').addEventListener('submit',e=>{e.preventDefault();load()});$('#clearReqFilters').addEventListener('click',()=>{$('#reqFilters').reset();load()});
  $('#printFiltered')?.addEventListener('click',async()=>{if(!current.length)return toast('Nenhuma solicitação na pesquisa.','error');const details=[];for(const x of current.slice(0,100)){try{details.push(await api(`/api/requisitions/${x.id}`))}catch{}}printManyRequisitions(details)});
  await load();
}
function requestTable(rows,actions=true){
  if(!rows.length)return `<div class="empty-state">Nenhuma solicitação encontrada.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Protocolo</th>${state.me?.role!=='client'?'<th>Cliente</th>':''}<th>Animal</th><th>Tutor</th><th>Raça</th><th>Status</th><th>Data</th>${actions?'<th>Ações</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.protocol)}</strong></td>${state.me?.role!=='client'?`<td>${esc(r.client_name||'')}</td>`:''}<td>${esc(r.patient_name||'')}</td><td>${esc(r.tutor_name||'')}</td><td>${esc(r.breed||'')}</td><td><span class="badge ${r.status}">${esc(STATUS[r.status]||r.status)}</span></td><td>${fmtDateTime(r.created_at)}</td>${actions?`<td><div class="actions"><button class="btn soft small" data-detail="${r.id}">Abrir</button><button class="btn ghost small" data-print-one="${r.id}">Imprimir/PDF</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function bindDetailButtons(){
  $$('[data-detail]').forEach(b=>b.addEventListener('click',()=>openRequest(Number(b.dataset.detail))));
  $$('[data-print-one]').forEach(b=>b.addEventListener('click',async()=>{try{printRequisition(await api(`/api/requisitions/${b.dataset.printOne}`))}catch(e){toast(e.message,'error')}}));
}

async function renderNewRequest(){
  if(!state.catalog)state.catalog=(await api('/api/catalog')).exams;
  if(state.me.role!=='client')await loadAdminLists();
  const profile = state.me.role==='client' ? (await api('/api/my-client-profile')).profile : null;
  $('#content').innerHTML=`<form id="newReqForm" class="stack">
    ${state.me.role!=='client'?`<div class="form-card"><h4>Cliente solicitante</h4><div class="form-grid"><label class="field span2">Cliente<select name="clientId" required><option value="">Selecione</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div></div>`:''}
    <div class="form-card"><h4>Dados da requisição</h4><div class="form-grid">
      <label class="field span2">Clínica / estabelecimento<input name="clinicName" value="${esc(profile?.name||'')}" placeholder="Nome da clínica"></label>
      <label class="field">Veterinário<input name="veterinarianName"></label><label class="field">CRMV<input name="crmv"></label>
      <label class="field span2">Tutor<input name="tutorName"></label><label class="field span2">Paciente / animal<input name="patientName" required></label>
      <label class="field">Espécie<input name="species" placeholder="Canina, felina..."></label><label class="field">Raça<input name="breed"></label>
      <label class="field">Sexo<select name="sex"><option value="">—</option><option>M</option><option>F</option></select></label><label class="field">Data de nascimento<input name="birthDate" type="date"></label>
      <label class="field">Idade<input name="ageText" placeholder="Ex.: 4 anos"></label><label class="field">Data da coleta<input name="collectionDate" type="date" value="${today()}"></label>
      <label class="field span4">Informações clínicas / observações<textarea name="clinicalInfo"></textarea></label>
    </div></div>
    <div class="form-card"><h4>Exames solicitados</h4><div class="checks">${state.catalog.map(g=>`<section class="check-group"><h5>${esc(g.category)}</h5><div class="check-list">${g.items.map(e=>`<label><input type="checkbox" name="exams" value="${e.code}"><span>${esc(e.name)}</span></label>`).join('')}</div></section>`).join('')}</div></div>
    <div class="form-card"><h4>Material enviado</h4><div class="material-list">${['Sangue total','Soro','Plasma','Urina','Fezes'].map(m=>`<label><input type="checkbox" name="materials" value="${m}"> ${m}</label>`).join('')}</div><label class="field" style="margin-top:12px">Outros materiais<input name="materialOther"></label></div>
    <div class="form-card"><h4>Confirmação</h4><p class="muted">Ao enviar, a ficha ficará disponível ao HLab Vet e receberá um protocolo. O carimbo cadastrado pelo cliente será gravado na requisição.</p><button class="btn primary" type="submit">Enviar solicitação ao HLab Vet</button></div>
  </form>`;
  $('#newReqForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const body=Object.fromEntries(f);body.exams=f.getAll('exams');body.materials=f.getAll('materials');try{const r=await api('/api/requisitions',{json:body});toast(`${r.message} Protocolo ${r.protocol}`);navigate('requests')}catch(err){toast(err.message,'error')}});
}

async function openRequest(id){
  const d=await api(`/api/requisitions/${id}`),r=d.requisition;
  const admin=state.me.role!=='client'; if(admin) await loadAdminLists();
  const actions=admin?adminRequestActions(r):'';
  modal(`<div class="detail-head"><div><h3>${esc(r.protocol)} • ${esc(r.patient_name)}</h3><p class="muted">${esc(r.client_name)} • criado em ${fmtDateTime(r.created_at)}</p></div><span class="badge ${r.status}">${esc(STATUS[r.status])}</span></div>
    <div class="detail-cols"><div>
      <dl class="kv"><dt>Paciente</dt><dd>${esc(r.patient_name)}</dd><dt>Espécie / raça</dt><dd>${esc([r.species,r.breed].filter(Boolean).join(' • '))||'—'}</dd><dt>Nascimento / idade</dt><dd>${esc(r.birth_date?fmtDate(r.birth_date):'—')} ${esc(r.age_text||'')}</dd><dt>Tutor</dt><dd>${esc(r.tutor_name||'—')}</dd><dt>Veterinário / CRMV</dt><dd>${esc([r.veterinarian_name,r.crmv].filter(Boolean).join(' • '))||'—'}</dd><dt>Coleta</dt><dd>${fmtDateTime(r.collected_at)} ${r.collection_temperature!=null?`• ${esc(r.collection_temperature)} °C`:''}</dd><dt>Enviado por</dt><dd>${esc(r.sent_by_name||'—')}</dd><dt>Local de envio</dt><dd>${esc(r.sent_from_location||'—')}</dd><dt>Recebimento</dt><dd>${fmtDateTime(r.lab_received_at)} ${r.lab_received_temperature!=null?`• ${esc(r.lab_received_temperature)} °C`:''}</dd><dt>Recebido por</dt><dd>${esc(r.receiver_name||'—')} ${r.received_location?`• ${esc(r.received_location)}`:''}</dd></dl>
      <h4>Exames</h4><div>${d.exams.map(x=>`<span class="badge" style="margin:2px">${esc(x.exam_name)}</span>`).join('')}</div>
      <h4>Material enviado</h4><p>${d.materials.map(esc).join(', ')||'—'} ${r.material_other?`• ${esc(r.material_other)}`:''}</p>
      <h4>Informações clínicas</h4><p>${esc(r.clinical_info||'—')}</p>
      <h4>Resultados</h4><div>${d.files.length?d.files.map(f=>`<div class="file-card"><div><strong>${esc(f.original_name)}</strong><small>${fmtBytes(f.size_bytes)} • ${fmtDateTime(f.created_at)}</small></div><a class="btn secondary small" href="/api/results/${f.id}/download">Baixar</a></div>`).join(''):'<p class="muted">Nenhum resultado enviado ainda.</p>'}</div>
    </div><div><h4>Andamento em tempo real</h4><div class="timeline">${d.events.map(e=>`<div class="timeline-item"><div class="timeline-dot"></div><div><strong>${esc(STATUS[e.status]||e.status)}</strong><p>${fmtDateTime(e.created_at)} • ${esc(e.actor_name||'Sistema')}</p>${eventDetails(e.details)}</div></div>`).join('')}</div>${actions}</div></div>
    <div class="actions" style="margin-top:18px"><button class="btn ghost" id="printThis">Imprimir / Salvar em PDF</button><button class="btn ghost" data-close-modal>Fechar</button></div>`);
  $('#printThis').addEventListener('click',()=>printRequisition(d));
  if(admin) bindAdminRequestActions(id,r);
}
function eventDetails(d){if(!d)return'';const parts=[];if(d.courier)parts.push(`Entregador: ${d.courier}`);if(d.temperature!=null)parts.push(`Temperatura: ${d.temperature} °C`);if(d.receiver)parts.push(`Recebido por: ${d.receiver}`);if(d.location)parts.push(`Local: ${d.location}`);if(d.sentBy)parts.push(`Enviado por: ${d.sentBy}`);if(d.reason)parts.push(`Motivo: ${d.reason}`);if(d.message)parts.push(d.message);return parts.length?`<p>${esc(parts.join(' • '))}</p>`:''}
function adminRequestActions(r){return `<div class="form-card" style="margin-top:16px"><h4>Ações HLab Vet</h4><div class="stack compact">
  ${['solicitado','atribuido','coletado'].includes(r.status)?`<label>Entregador<select id="assignCourier"><option value="">Selecione</option>${state.couriers.filter(c=>c.active).map(c=>`<option value="${c.id}" ${r.assigned_courier_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><button class="btn secondary" id="assignBtn">Atribuir entregador</button>`:''}
  ${r.status==='coletado'?`<label>Quem recebeu<select id="receiverId"><option value="">Selecione</option>${state.receivers.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}${x.location?` — ${esc(x.location)}`:''}</option>`).join('')}</select></label><label>Temperatura no recebimento (°C)<input id="receiveTemp" type="number" step="0.1"></label><label>Local do recebimento<input id="receiveLocation" value="HLab Vet"></label><button class="btn secondary" id="receiveBtn">Dar recebimento</button>`:''}
  ${['recebido','em_analise'].includes(r.status)?`<button class="btn soft" id="analysisBtn">Marcar Em análise</button>`:''}
  ${['recebido','em_analise','concluido'].includes(r.status)?`<label>Enviar resultado<input id="resultFile" type="file"></label><button class="btn secondary" id="uploadBtn">Enviar arquivo</button>`:''}
  ${['recebido','em_analise'].includes(r.status)?`<button class="btn primary" id="completeBtn">Marcar Concluído</button>`:''}
  ${!['concluido','cancelado'].includes(r.status)?`<button class="btn danger" id="cancelBtn">Cancelar requisição</button>`:''}
  </div></div>`}
function bindAdminRequestActions(id,r){
  $('#assignBtn')?.addEventListener('click',async()=>{const courierId=Number($('#assignCourier').value);if(!courierId)return toast('Selecione o entregador.','error');try{const x=await api(`/api/requisitions/${id}/assign`,{json:{courierId}});toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#receiveBtn')?.addEventListener('click',async()=>{const receiverId=Number($('#receiverId').value),temperature=$('#receiveTemp').value,location=$('#receiveLocation').value;try{const x=await api(`/api/requisitions/${id}/receive`,{json:{receiverId,temperature,location}});toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#analysisBtn')?.addEventListener('click',async()=>{try{await api(`/api/requisitions/${id}/analysis`,{method:'POST'});toast('Exame em análise.');closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#completeBtn')?.addEventListener('click',async()=>{try{await api(`/api/requisitions/${id}/complete`,{method:'POST'});toast('Exame concluído.');closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#cancelBtn')?.addEventListener('click',async()=>{const reason=prompt('Motivo do cancelamento:');if(reason===null)return;try{await api(`/api/requisitions/${id}/cancel`,{json:{reason}});toast('Requisição cancelada.');closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#uploadBtn')?.addEventListener('click',async()=>{const file=$('#resultFile').files[0];if(!file)return toast('Selecione um arquivo.','error');const fd=new FormData();fd.append('file',file);try{const res=await fetch(`/api/requisitions/${id}/results`,{method:'POST',body:fd,credentials:'include'});const x=await res.json();if(!res.ok)throw new Error(x.error||'Falha no envio');toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
}

async function loadAdminLists(){
  if(state.me.role==='client')return;
  const [c,co,r]=await Promise.all([api('/api/clients'),api('/api/couriers'),api('/api/receivers')]);state.clients=c.clients||[];state.couriers=co.couriers||[];state.receivers=r.receivers||[];
}

async function renderClients(){
  const d=await api('/api/clients');state.clients=d.clients||[];$('#topActions').innerHTML=`<button class="btn primary" id="addClient">＋ Cadastrar cliente</button>`;
  $('#content').innerHTML=`<div class="card"><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Usuário</th><th>Contato</th><th>Endereço</th><th>Status</th><th>Ações</th></tr></thead><tbody>${state.clients.map(c=>`<tr><td><strong>${esc(c.name)}</strong><br><small>${esc(c.document||'')}</small></td><td>${esc(c.username_display)}</td><td>${esc(c.phone||'')}<br><small>${esc(c.email||'')}</small></td><td>${esc([c.address,c.city,c.state].filter(Boolean).join(', '))}</td><td><span class="badge ${c.active?'concluido':'cancelado'}">${c.active?'Ativo':'Inativo'}</span></td><td><div class="actions"><button class="btn soft small" data-edit-client="${c.id}">Editar</button><button class="btn ghost small" data-reset-client="${c.id}">Alterar senha</button>${c.active?`<button class="btn danger small" data-delete-client="${c.id}">Excluir/desativar</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></div>`;
  $('#addClient').addEventListener('click',()=>clientForm());$$('[data-edit-client]').forEach(b=>b.addEventListener('click',()=>clientForm(state.clients.find(x=>x.id===Number(b.dataset.editClient)))));$$('[data-reset-client]').forEach(b=>b.addEventListener('click',()=>resetClient(Number(b.dataset.resetClient))));$$('[data-delete-client]').forEach(b=>b.addEventListener('click',()=>deleteClient(Number(b.dataset.deleteClient))));
}
function clientForm(c=null){modal(`<h3>${c?'Editar cliente':'Cadastrar cliente'}</h3><form id="clientForm" class="stack"><div class="form-grid"><label class="field span2">Nome / clínica<input name="name" value="${esc(c?.name||'')}" required></label><label class="field span2">Razão social<input name="legalName" value="${esc(c?.legal_name||'')}"></label><label class="field">CNPJ/CPF<input name="document" value="${esc(c?.document||'')}"></label><label class="field">Telefone<input name="phone" value="${esc(c?.phone||'')}"></label><label class="field span2">E-mail<input name="email" type="email" value="${esc(c?.email||'')}"></label><label class="field span2">Endereço<input name="address" value="${esc(c?.address||'')}"></label><label class="field">Cidade<input name="city" value="${esc(c?.city||'Natal')}"></label><label class="field">UF<input name="state" value="${esc(c?.state||'RN')}"></label><label class="field">CEP<input name="zipCode" value="${esc(c?.zip_code||'')}"></label><label class="field">Usuário<input name="username" value="${esc(c?.username_display||'')}" required></label>${c?'':`<label class="field">Senha inicial<input name="password" type="password" minlength="8" required><small>Será trocada no primeiro login.</small></label>`}${c?`<label class="field">Ativo<select name="active"><option value="1" ${c.active?'selected':''}>Sim</option><option value="0" ${!c.active?'selected':''}>Não</option></select></label>`:''}</div><div class="actions"><button class="btn primary">Salvar</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  $('#clientForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if('active'in b)b.active=b.active==='1';try{const r=await api(c?`/api/clients/${c.id}`:'/api/clients',{method:c?'PATCH':'POST',json:b});toast(r.message);closeModal();renderClients()}catch(er){toast(er.message,'error')}})
}
async function resetClient(id){const password=prompt('Digite a nova senha temporária (mínimo 8 caracteres):');if(password===null)return;try{const r=await api(`/api/clients/${id}/reset-password`,{json:{password}});toast(r.message)}catch(e){toast(e.message,'error')}}
async function deleteClient(id){if(!confirm('Desativar este cliente? O histórico será preservado.'))return;try{const r=await api(`/api/clients/${id}`,{method:'DELETE'});toast(r.message);renderClients()}catch(e){toast(e.message,'error')}}

async function renderCouriers(){
  const d=await api('/api/couriers');state.couriers=d.couriers||[];$('#topActions').innerHTML=`<button class="btn primary" id="addCourier">＋ Entregador</button>`;
  $('#content').innerHTML=`<div class="card"><p class="muted">Cada entregador possui um link privado. O link mostra apenas as coletas atribuídas a ele. Ao marcar <strong>Coletado</strong>, data e hora são gravadas automaticamente e o item vai para o histórico.</p><div class="table-wrap"><table><thead><tr><th>Entregador</th><th>Telefone</th><th>Link</th><th>Status</th><th>Ações</th></tr></thead><tbody>${state.couriers.map(c=>`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.phone||'')}</td><td>••••${esc(c.token_last4||'')}</td><td><span class="badge ${c.active?'concluido':'cancelado'}">${c.active?'Ativo':'Inativo'}</span></td><td><div class="actions"><button class="btn soft small" data-edit-courier="${c.id}">Editar</button><button class="btn secondary small" data-link-courier="${c.id}">Gerar novo link</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
  $('#addCourier').addEventListener('click',()=>courierForm());$$('[data-edit-courier]').forEach(b=>b.addEventListener('click',()=>courierForm(state.couriers.find(x=>x.id===Number(b.dataset.editCourier)))));$$('[data-link-courier]').forEach(b=>b.addEventListener('click',()=>regenerateLink(Number(b.dataset.linkCourier))));
}
function courierForm(c=null){modal(`<h3>${c?'Editar entregador':'Cadastrar entregador'}</h3><form id="courierForm" class="stack"><label>Nome<input name="name" value="${esc(c?.name||'')}" required></label><label>Telefone<input name="phone" value="${esc(c?.phone||'')}"></label>${c?`<label>Ativo<select name="active"><option value="1" ${c.active?'selected':''}>Sim</option><option value="0" ${!c.active?'selected':''}>Não</option></select></label>`:''}<div class="actions"><button class="btn primary">Salvar</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);$('#courierForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if('active'in b)b.active=b.active==='1';try{const r=await api(c?`/api/couriers/${c.id}`:'/api/couriers',{method:c?'PATCH':'POST',json:b});if(r.link){await navigator.clipboard?.writeText(r.link).catch(()=>{});modal(`<h3>Entregador cadastrado</h3><p>Copie e guarde este link privado:</p><label class="field"><input id="newCourierLink" value="${esc(r.link)}" readonly></label><div class="actions"><button class="btn primary" id="copyCourierLink">Copiar link</button><button class="btn ghost" data-close-modal>Fechar</button></div>`);$('#copyCourierLink').addEventListener('click',async()=>{await navigator.clipboard.writeText(r.link);toast('Link copiado.')})}else{toast(r.message);closeModal();renderCouriers()}}catch(er){toast(er.message,'error')}})}
async function regenerateLink(id){if(!confirm('Gerar um novo link? O anterior deixará de funcionar.'))return;try{const r=await api(`/api/couriers/${id}/regenerate-link`,{method:'POST'});modal(`<h3>Novo link do entregador</h3><p>O link anterior foi invalidado.</p><label class="field"><input id="newCourierLink" value="${esc(r.link)}" readonly></label><button class="btn primary" id="copyCourierLink">Copiar link</button>`);$('#copyCourierLink').addEventListener('click',async()=>{await navigator.clipboard.writeText(r.link);toast('Link copiado.')})}catch(e){toast(e.message,'error')}}

async function renderReceivers(){
  const d=await api('/api/receivers');state.receivers=d.receivers||[];$('#topActions').innerHTML=`<button class="btn primary" id="addReceiver">＋ Recebedor</button>`;
  $('#content').innerHTML=`<div class="card"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Local padrão</th><th>Status</th><th>Ações</th></tr></thead><tbody>${state.receivers.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.location||'')}</td><td><span class="badge ${r.active?'concluido':'cancelado'}">${r.active?'Ativo':'Inativo'}</span></td><td><button class="btn soft small" data-edit-receiver="${r.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>`;
  $('#addReceiver').addEventListener('click',()=>receiverForm());$$('[data-edit-receiver]').forEach(b=>b.addEventListener('click',()=>receiverForm(state.receivers.find(x=>x.id===Number(b.dataset.editReceiver)))));
}
function receiverForm(r=null){modal(`<h3>${r?'Editar recebedor':'Cadastrar recebedor'}</h3><form id="receiverForm" class="stack"><label>Nome<input name="name" value="${esc(r?.name||'')}" required></label><label>Local padrão<input name="location" value="${esc(r?.location||'HLab Vet')}"></label>${r?`<label>Ativo<select name="active"><option value="1" ${r.active?'selected':''}>Sim</option><option value="0" ${!r.active?'selected':''}>Não</option></select></label>`:''}<div class="actions"><button class="btn primary">Salvar</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);$('#receiverForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if('active'in b)b.active=b.active==='1';try{const x=await api(r?`/api/receivers/${r.id}`:'/api/receivers',{method:r?'PATCH':'POST',json:b});toast(x.message);closeModal();renderReceivers()}catch(er){toast(er.message,'error')}})}

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

async function renderAudit(){const d=await api('/api/audit?limit=300');$('#content').innerHTML=`<div class="card"><div class="table-wrap"><table><thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Registro</th><th>Detalhes</th></tr></thead><tbody>${d.events.map(e=>`<tr><td>${fmtDateTime(e.created_at)}</td><td>${esc(e.actor_name||'Sistema')}</td><td>${esc(e.action)}</td><td>${esc([e.entity_type,e.entity_id].filter(Boolean).join(' #'))}</td><td><small>${esc(e.details?JSON.stringify(e.details):'')}</small></td></tr>`).join('')}</tbody></table></div></div>`}

async function renderTemperature(){
  if(state.me.role!=='client')await loadAdminLists();
  $('#content').innerHTML=`<div class="card no-print"><form id="tempFilters" class="filters"><input name="month" type="month" value="${currentMonth()}" required>${state.me.role!=='client'?`<select name="clientId"><option value="">Todos os clientes</option>${state.clients.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><select name="courierId"><option value="">Todos os entregadores</option>${state.couriers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>`:''}<button class="btn primary">Buscar mês</button><button type="button" class="btn secondary" id="printTemp">Imprimir / PDF</button></form></div><div id="tempResult" style="margin-top:14px"></div>`;
  let currentData=null;const load=async()=>{const qs=new URLSearchParams(new FormData($('#tempFilters')));for(const[k,v]of[...qs])if(!v)qs.delete(k);currentData=await api(`/api/temperature-sheet?${qs}`);$('#tempResult').innerHTML=temperatureSheetsHtml(currentData)};$('#tempFilters').addEventListener('submit',e=>{e.preventDefault();load()});$('#printTemp').addEventListener('click',()=>{if(!currentData)return;printTemperature(currentData)});await load();
}
function temperatureSheetsHtml(data){
  const entries=data.entries||[],groups=[];for(let i=0;i<Math.max(1,entries.length);i+=45)groups.push(entries.slice(i,i+45));
  return groups.map((rows,idx)=>`<div class="temp-sheet-screen ${idx<groups.length-1?'page-break':''}">${temperatureSheetInner(data.month,rows,idx+1,groups.length)}</div>`).join('');
}
function temperatureSheetInner(month,rows,page,total){
  const [year,mon]=month.split('-'),monthName=new Intl.DateTimeFormat('pt-BR',{month:'long',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
  const first=rows[0];const sector=state.me?.role==='client'?(state.me.clientName||'Cliente'):(first?.client_name||'Geral');const courier=first?.courier_name||'';
  const padded=[...rows];while(padded.length<45)padded.push(null);
  return `<div class="temp-sheet"><div class="temp-header"><div><img src="/assets/hlabvet-logo.png"></div><div class="temp-company">HLABVET DIAGNÓSTICOS VETERINÁRIOS LTDA<br>CNPJ: 88.816.118/0001-84<br>RUA AMÉRICO SOARES WANDERLEY, 1945 - CAPIM MACIO, NATAL - RN, 59082-080, BRASIL</div><div><strong>ENTREGADOR:</strong><br>${esc(courier)}</div></div><div class="temp-title">FICHA DE CONTROLE DE TEMPERATURA HLABVET</div><div class="temp-info"><div><b>SETOR:</b> ${esc(sector)}</div><div><b>TERMÔMETRO:</b> ______</div><div><b>MÊS:</b> ${esc(monthName)} &nbsp; <b>ANO:</b> ${year}</div><div><b>CONTATO HLABVET:</b> (84) 99180-4816 ${total>1?` • PÁG. ${page}/${total}`:''}</div></div><table class="temp-table"><thead><tr class="super"><th colspan="5">DADOS DO ENVIO</th><th colspan="4">DADOS DO RECEBIMENTO</th></tr><tr><th>DIA</th><th>DATA</th><th>HORA</th><th>TEMP.</th><th>LOCAL / RESP.</th><th>HORA</th><th>TEMP.</th><th>LOCAL</th><th>RESP. / OBS.</th></tr></thead><tbody>${padded.map((r,i)=>`<tr><td>${i+1}</td><td>${r?fmtDate(r.collected_at||r.created_at):''}</td><td>${r?fmtTime(r.collected_at):''}</td><td>${r?.collection_temperature!=null?`${esc(r.collection_temperature)}°C`:''}</td><td style="text-align:left">${r?esc([r.sent_from_location,r.sent_by_name].filter(Boolean).join(' / ')):''}</td><td>${r?fmtTime(r.lab_received_at):''}</td><td>${r?.lab_received_temperature!=null?`${esc(r.lab_received_temperature)}°C`:''}</td><td style="text-align:left">${r?esc(r.received_location||''):''}</td><td style="text-align:left">${r?esc([r.receiver_name,r.observations].filter(Boolean).join(' / ')):''}</td></tr>`).join('')}</tbody></table><div class="temp-notes"><b>OBSERVAÇÕES:</b> _______________________________________________<br><br>* Sempre identificar o termômetro e o Entregador.<br>* Temperatura refrigerada: 2°C a 8°C. Monitorar durante o transporte e, ao atingir 20°C, substituir o gelo.</div></div>`;
}

async function renderCourierPortal(token){
  $('#loginView').classList.add('hidden');$('#appView').classList.add('hidden');$('#courierView').classList.remove('hidden');let tab='pending';
  const render=async()=>{try{const qs=new URLSearchParams({tab});const from=$('#courierFrom')?.value,to=$('#courierTo')?.value;if(from)qs.set('from',from);if(to)qs.set('to',to);const d=await api(`/api/courier/${encodeURIComponent(token)}/tasks?${qs}`);$('#courierView').innerHTML=`<div class="courier-shell"><header class="courier-head"><div class="inner"><img src="/assets/hlabvet-logo.png"><div><strong>Portal do entregador</strong><div>${esc(d.courier.name)}</div></div></div></header><main class="courier-main"><div class="card" style="margin-bottom:14px"><div class="filters" style="grid-template-columns:1fr 1fr auto"><input id="courierFrom" type="date" value="${esc(from||'')}"><input id="courierTo" type="date" value="${esc(to||'')}"><button class="btn ghost" id="courierFilter">Filtrar período</button></div><div class="tabs"><button class="tab ${tab==='pending'?'active':''}" data-tab="pending">Pendentes</button><button class="tab ${tab==='collected'?'active':''}" data-tab="collected">Coletados / histórico</button></div></div><div>${d.tasks.length?d.tasks.map(t=>courierTask(t,tab)).join(''):`<div class="card empty-state">${tab==='pending'?'Nenhuma coleta pendente.':'Nenhuma coleta no período.'}</div>`}</div></main></div>`;$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.tab;render()}));$('#courierFilter').addEventListener('click',render);$$('[data-collect]').forEach(b=>b.addEventListener('click',()=>collectTask(token,Number(b.dataset.collect))));}catch(e){$('#courierView').innerHTML=`<div class="auth-shell"><div class="auth-card"><div class="brand-lockup"><img src="/assets/hlabvet-logo.png"><h1>Link inválido</h1></div><p>${esc(e.message)}</p></div></div>`}};await render();
}
function courierTask(t,tab){return `<article class="task-card"><div style="display:flex;justify-content:space-between;gap:10px"><div><small class="muted">${esc(t.protocol)}</small><h3>${esc(t.client_name)}</h3><div>${esc(t.patient_name)} ${t.species?`• ${esc(t.species)}`:''}</div></div><span class="badge ${t.status}">${esc(STATUS[t.status]||t.status)}</span></div><div class="task-meta"><div>ENDEREÇO<strong>${esc([t.address,t.city,t.state].filter(Boolean).join(', '))}</strong></div><div>CONTATO<strong>${esc(t.phone||'—')}</strong></div><div>ATRIBUÍDO<strong>${fmtDateTime(t.assigned_at)}</strong></div><div>COLETADO<strong>${fmtDateTime(t.collected_at)}</strong></div></div>${tab==='pending'?`<form class="collect-form" data-collect-form="${t.id}"><label>Temperatura (°C)<input name="temperature" type="number" step="0.1" required></label><label>Nome de quem entregou a amostra<input name="sentByName" required placeholder="Responsável no local"></label><label>Local de envio<input name="sentFromLocation" value="${esc([t.address,t.city,t.state].filter(Boolean).join(', '))}"></label><button class="btn primary" type="button" data-collect="${t.id}">Coletado</button></form>`:`<p class="muted">Temperatura: <strong>${t.collection_temperature!=null?`${esc(t.collection_temperature)} °C`:'—'}</strong> • Enviado por: <strong>${esc(t.sent_by_name||'—')}</strong></p>`}</article>`}
async function collectTask(token,id){const form=$(`[data-collect-form="${id}"]`);if(!form.reportValidity())return;const body=Object.fromEntries(new FormData(form));try{const r=await api(`/api/courier/${encodeURIComponent(token)}/requisitions/${id}/collect`,{json:body});toast(r.message);const btn=$(`[data-tab="pending"]`);if(btn)btn.click();else location.reload()}catch(e){toast(e.message,'error')}}

function printRequisition(data){printManyRequisitions([data])}
function printManyRequisitions(items){if(!items.length)return;const html=items.map(d=>requisitionPrintHtml(d)).join('<div style="page-break-after:always"></div>');printWindow('Requisições HLabVet',html,printCss())}
function requisitionPrintHtml(d){const r=d.requisition, selected=new Set(d.exams.map(x=>x.exam_code)), mats=new Set(d.materials);let stamp={};try{stamp=JSON.parse(r.stamp_snapshot_json||'{}')}catch{}
  const groups=state.catalog||[];const leftNames=new Set(['Hematologia','Análise fecal','Urinálises','Citologia','Parasitologia','Testes rápidos','Sorologias']);const left=groups.filter(g=>leftNames.has(g.category)),right=groups.filter(g=>!leftNames.has(g.category));
  const examBox=g=>`<section class="pbox"><h4>${esc(g.category)}</h4>${g.items.map(x=>`<div class="pline"><span class="cb">${selected.has(x.code)?'✓':''}</span>${esc(x.name)}</div>`).join('')}</section>`;
  return `<div class="req-paper"><header class="req-head"><img src="${location.origin}/assets/hlabvet-logo.png"><h1>REQUISIÇÃO DE EXAMES<br>USO VETERINÁRIO</h1></header><div class="patient-grid"><div><b>CLÍNICA:</b> ${esc(r.clinic_name||r.client_name||'')}<br><b>VETERINÁRIO:</b> ${esc(r.veterinarian_name||'')}<br><b>CRMV:</b> ${esc(r.crmv||'')}<br><b>TUTOR:</b> ${esc(r.tutor_name||'')}<br><b>DATA:</b> ${esc(r.collection_date?fmtDate(r.collection_date):fmtDate(r.created_at))}</div><div><b>PACIENTE:</b> ${esc(r.patient_name)}<br><b>ESPÉCIE:</b> ${esc(r.species||'')}<br><b>RAÇA:</b> ${esc(r.breed||'')}<br><b>SEXO:</b> ${esc(r.sex||'')}<br><b>IDADE:</b> ${esc(r.age_text||'')}</div></div><div class="req-cols"><div>${left.map(examBox).join('')}<div class="pathologist"><b>PATOLOGISTA RESPONSÁVEL</b><br>Dr. Antônio Rodrigues | CRMV-RN 1568<br>Rua Américo Soares Wanderley, 1945 - Capim Macio, Natal/RN<br>(84) 99827-3567</div></div><div>${right.map(examBox).join('')}<section class="pbox"><h4>MATERIAL ENVIADO</h4>${['Sangue total','Soro','Plasma','Urina','Fezes'].map(m=>`<div class="pline"><span class="cb">${mats.has(m)?'✓':''}</span>${m}</div>`).join('')}<div><b>Outros:</b> ${esc(r.material_other||'')}</div></section><section class="pbox"><h4>INFORMAÇÕES CLÍNICAS / OBSERVAÇÕES</h4><div class="clin">${esc(r.clinical_info||'')}</div></section><div class="stamp-box">${stamp.name?`<div class="print-stamp" style="color:${esc(stamp.color||'#5c2a72')}"><b>${esc(stamp.name)}</b>${[stamp.line2,stamp.line3,stamp.line4].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:'CARIMBO'}</div></div></div><div class="proto">Protocolo: ${esc(r.protocol)} • Gerado pelo HLab Vet Resultados</div></div>`;
}
function printTemperature(data){printWindow('Ficha de Controle de Temperatura',temperatureSheetsHtml(data).replaceAll('temp-sheet-screen','temp-sheet-print'),printCss()+`.temp-sheet-print{page-break-after:always}.temp-sheet-print:last-child{page-break-after:auto}`)}
function printWindow(title,body,css){const w=window.open('','_blank');if(!w)return toast('O navegador bloqueou a janela de impressão. Libere pop-ups.','error');w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}<script>setTimeout(()=>window.print(),500)<\/script></body></html>`);w.document.close()}
function printCss(){return `@page{size:A4;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0}.req-paper{font-size:10.5px}.req-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.req-head img{width:150px}.req-head h1{text-align:right;font-size:20px;margin:0;color:#4f4f4f}.patient-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #aaa;border-radius:12px;padding:10px;gap:16px;line-height:1.75}.req-cols{display:grid;grid-template-columns:1fr 1.18fr;gap:10px;margin-top:8px}.pbox{border:1px solid #aaa;border-radius:10px;overflow:hidden;margin-bottom:7px;padding-bottom:5px}.pbox h4{margin:0 0 5px;background:#8f5f97;color:#fff;padding:4px 8px;font-size:11px}.pline{padding:1px 7px}.cb{display:inline-grid;place-items:center;width:11px;height:11px;border:1px solid #888;margin-right:4px;vertical-align:middle;font-size:10px;font-weight:bold}.clin{padding:6px;min-height:70px;white-space:pre-wrap}.stamp-box{height:92px;border:1px solid #aaa;border-radius:10px;display:grid;place-items:center;color:#bbb;font-size:18px}.print-stamp{border:3px double currentColor;border-radius:7px;padding:8px 15px;text-align:center;transform:rotate(-1deg);opacity:.83;text-transform:uppercase;font-family:Georgia,serif}.print-stamp b{display:block;font-size:14px}.print-stamp span{display:block;font-size:10px;margin-top:2px}.pathologist{font-size:9px;margin:8px 4px}.proto{text-align:right;margin-top:5px;color:#777;font-size:8px}.temp-sheet{font-family:Arial,sans-serif;color:#000}.temp-header{display:grid;grid-template-columns:170px 1fr 160px;border:1px solid #000}.temp-header>div{border-right:1px solid #000;padding:5px}.temp-header>div:last-child{border:0}.temp-header img{width:145px}.temp-company{text-align:center;font-size:9px;font-weight:700}.temp-title{background:#6a236f;color:#fff;text-align:center;font-weight:700;padding:3px;border-left:1px solid #000;border-right:1px solid #000}.temp-info{display:grid;grid-template-columns:1fr 1fr 1fr 2fr;border:1px solid #000;border-top:0}.temp-info div{padding:3px 5px;border-right:1px solid #000;font-size:9px}.temp-info div:last-child{border:0}.temp-table{width:100%;border-collapse:collapse;font-size:7.8px}.temp-table th,.temp-table td{border:1px solid #000;padding:2px;text-align:center;height:14px}.temp-table th{background:#154f53;color:#fff}.temp-table .super th{background:#fff;color:#000}.temp-notes{font-size:8px;padding:5px}.page-break{page-break-after:always}`}

boot();
