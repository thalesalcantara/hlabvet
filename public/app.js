const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = { me:null, catalog:null, page:null, clients:[], couriers:[], receivers:[], alerts:[], cancelAlerts:[], missingPrices:[], timingReturnPage:'dashboard', timingAutoRefresh:null, timingClockTimer:null, timingEscHandler:null, timingBucket:'', timingScope:'unfinished' };
const STATUS = {solicitado:'Solicitado',atribuido:'Entregador atribuído',coletado:'Coletado',recebido:'Recebido',em_analise:'Em análise',concluido:'Concluído',cancelado:'Cancelado'};

const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtDate = v => v ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza'}).format(new Date(v.length===10 ? `${v}T12:00:00-03:00` : v)) : '—';
const fmtDateTime = v => v ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Fortaleza'}).format(new Date(v)) : '—';
const fmtTime = v => v ? new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Fortaleza'}).format(new Date(v)) : '';
const fmtBytes = n => !n ? '0 B' : n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1073741824?`${(n/1048576).toFixed(1)} MB`:`${(n/1073741824).toFixed(2)} GB`;
const today = () => new Date().toLocaleDateString('sv-SE',{timeZone:'America/Fortaleza'});
const currentMonth = () => today().slice(0,7);

function parseCalendarDate(v){
  const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return null;
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
  const test=new Date(Date.UTC(y,mo-1,d));
  if(test.getUTCFullYear()!==y||test.getUTCMonth()!==mo-1||test.getUTCDate()!==d)return null;
  return {y,m:mo,d};
}
function daysInMonth(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate()}
function exactAgeText(birthDate,referenceDate=today()){
  const b=parseCalendarDate(birthDate),r=parseCalendarDate(referenceDate);
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
  if(months<0){years--;months+=12}
  const parts=[];
  if(years)parts.push(`${years} ${years===1?'ano':'anos'}`);
  if(months)parts.push(`${months} ${months===1?'mês':'meses'}`);
  if(days||!parts.length)parts.push(`${days} ${days===1?'dia':'dias'}`);
  if(parts.length===1)return parts[0];
  if(parts.length===2)return `${parts[0]} e ${parts[1]}`;
  return `${parts[0]}, ${parts[1]} e ${parts[2]}`;
}

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
function bindResultFileButtons(root=document,onDeleted=null){
  $$('[data-result-view]',root).forEach(b=>b.addEventListener('click',()=>resultFileAction(Number(b.dataset.resultView),'view',b.dataset.filename||'resultado')));
  $$('[data-result-download]',root).forEach(b=>b.addEventListener('click',()=>resultFileAction(Number(b.dataset.resultDownload),'download',b.dataset.filename||'resultado')));
  $$('[data-print-result]',root).forEach(b=>b.addEventListener('click',()=>resultFileAction(Number(b.dataset.printResult),'print',b.dataset.filename||'resultado')));
  $$('[data-result-analysis]',root).forEach(b=>b.addEventListener('click',()=>openResultAnalysis(Number(b.dataset.resultAnalysis),b.dataset.filename||'resultado',b)));
  $$('[data-result-delete]',root).forEach(b=>b.addEventListener('click',async()=>{
    const filename=b.dataset.filename||'resultado';
    if(!confirm(`Excluir o resultado “${filename}”? O arquivo será removido do sistema e do armazenamento.`))return;
    try{const r=await api(`/api/results/${Number(b.dataset.resultDelete)}`,{method:'DELETE'});toast(r.message);await onDeleted?.();}
    catch(e){toast(e.message,'error')}
  }));
}
function resultFilesHtml(files,allowPrint=true,allowDelete=false,allowAnalyze=false){
  if(!files?.length)return '<div class="empty-state">Resultado ainda não disponível.</div>';
  return files.map(f=>`<div class="file-card"><div><strong>${esc(f.original_name)}</strong><small>${fmtBytes(f.size_bytes)} • ${fmtDateTime(f.created_at)}</small></div><div class="actions"><button class="btn soft small" data-result-view="${f.id}" data-filename="${esc(f.original_name)}">Visualizar</button>${allowAnalyze?`<button class="btn analysis small" data-result-analysis="${f.id}" data-filename="${esc(f.original_name)}">${Number(f.analysis_exists)?'Ver análise':'Analisar'}</button>`:''}<button class="btn secondary small" data-result-download="${f.id}" data-filename="${esc(f.original_name)}">Baixar</button>${allowPrint?`<button class="btn ghost small" data-print-result="${f.id}" data-filename="${esc(f.original_name)}">Imprimir</button>`:''}${allowDelete?`<button class="btn danger small" data-result-delete="${f.id}" data-filename="${esc(f.original_name)}">Excluir</button>`:''}</div></div>`).join('');
}

let pdfJsModulePromise=null;
async function loadPdfJs(){
  if(!pdfJsModulePromise){
    pdfJsModulePromise=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(m=>{
      if(m.GlobalWorkerOptions)m.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
      return m;
    });
  }
  return pdfJsModulePromise;
}
function numPt(v){if(v==null)return null;const n=Number(String(v).replace(/\s/g,'').replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?n:null}
function numFlexible(v){
  if(v==null)return null;let x=String(v).trim().replace(/\s/g,'');
  if(x.includes(',')&&x.includes('.')){const lastComma=x.lastIndexOf(','),lastDot=x.lastIndexOf('.');x=lastComma>lastDot?x.replace(/\./g,'').replace(',','.'):x.replace(/,/g,'');}
  else if(x.includes(','))x=x.replace(',','.');
  const n=Number(x);return Number.isFinite(n)?n:null;
}
async function extractPdfText(blob){
  const pdfjs=await loadPdfJs();
  const data=new Uint8Array(await blob.arrayBuffer());
  const pdf=await pdfjs.getDocument({data}).promise;
  const pages=[];
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p),content=await page.getTextContent();
    const rows=[];
    for(const item of content.items||[]){
      const text=String(item.str||'').trim();if(!text)continue;
      const y=Number(item.transform?.[5]||0),x=Number(item.transform?.[4]||0);let row=rows.find(r=>Math.abs(r.y-y)<2.2);
      if(!row){row={y,items:[]};rows.push(row)}row.items.push({x,text});
    }
    rows.sort((a,b)=>b.y-a.y);
    pages.push(rows.map(r=>r.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' ')).join('\n'));
  }
  return pages.join('\n');
}
async function extractResultText(blob,filename){
  const name=String(filename||'').toLowerCase(),type=String(blob.type||'').toLowerCase();
  if(type.includes('pdf')||name.endsWith('.pdf'))return extractPdfText(blob);
  if(type.startsWith('text/')||/\.(txt|csv|tsv)$/i.test(name))return blob.text();
  throw new Error('Para análise automática rápida, envie o resultado em PDF pesquisável ou arquivo de texto.');
}
function cleanParamName(v){return String(v||'').replace(/^[•·.:;\-–—\s]+|[.:;\-–—\s]+$/g,'').replace(/\s{2,}/g,' ').trim().slice(0,180)}
function parseResultAnalysis(text){
  const raw=String(text||'').replace(/\u00a0/g,' ').replace(/[−‐‑‒]/g,'-');
  const lines=raw.split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  const out=[];
  const seen=new Set();
  const push=(name,result,min,max,referenceText,unit='')=>{
    name=cleanParamName(name);if(!name||name.length<2||!/[A-Za-zÀ-ÿ]/.test(name)||!Number.isFinite(result))return;
    if(min!=null&&!Number.isFinite(min))min=null;if(max!=null&&!Number.isFinite(max))max=null;if(min==null&&max==null)return;
    let status='normal',deviationPct=null;
    if(min!=null&&result<min){status='low';if(min!==0)deviationPct=((min-result)/Math.abs(min))*100}
    else if(max!=null&&result>max){status='high';if(max!==0)deviationPct=((result-max)/Math.abs(max))*100}
    const key=`${name.toLowerCase()}|${result}|${min}|${max}`;if(seen.has(key))return;seen.add(key);
    out.push({name,result,unit:String(unit||'').trim().slice(0,50),referenceText,status,min,max,deviationPct:deviationPct==null?null:Math.round(deviationPct*10)/10});
  };
  for(const line of lines){
    if(line.length>300)continue;
    let m=line.match(/(-?\d[\d.,]*)\s*(?:-|–|—|a)\s*(-?\d[\d.,]*)\s*([A-Za-z%µμ\/³²0-9.\-]*)\s*$/i);
    if(m){
      const min=numFlexible(m[1]),max=numFlexible(m[2]);if(min==null||max==null||min>max)continue;
      const before=line.slice(0,m.index).trim();const nums=[...before.matchAll(/-?\d[\d.,]*/g)];if(!nums.length)continue;
      const last=nums[nums.length-1],result=numFlexible(last[0]);if(result==null)continue;
      const name=before.slice(0,last.index).trim();let unit=before.slice(last.index+last[0].length).trim();
      push(name,result,min,max,`${m[1]} – ${m[2]}${m[3]?` ${m[3]}`:''}`,unit||m[3]||'');continue;
    }
    m=line.match(/(?:até|<=|≤|menor\s+que|inferior\s+a|<)\s*(-?\d[\d.,]*)\s*([A-Za-z%µμ\/³²0-9.\-]*)\s*$/i);
    if(m){const max=numFlexible(m[1]),before=line.slice(0,m.index).trim(),nums=[...before.matchAll(/-?\d[\d.,]*/g)];if(max==null||!nums.length)continue;const last=nums[nums.length-1],result=numFlexible(last[0]);if(result==null)continue;push(before.slice(0,last.index),result,null,max,`até ${m[1]}${m[2]?` ${m[2]}`:''}`,before.slice(last.index+last[0].length).trim()||m[2]||'');continue;}
    m=line.match(/(?:>=|≥|maior\s+que|superior\s+a|>)\s*(-?\d[\d.,]*)\s*([A-Za-z%µμ\/³²0-9.\-]*)\s*$/i);
    if(m){const min=numFlexible(m[1]),before=line.slice(0,m.index).trim(),nums=[...before.matchAll(/-?\d[\d.,]*/g)];if(min==null||!nums.length)continue;const last=nums[nums.length-1],result=numFlexible(last[0]);if(result==null)continue;push(before.slice(0,last.index),result,min,null,`a partir de ${m[1]}${m[2]?` ${m[2]}`:''}`,before.slice(last.index+last[0].length).trim()||m[2]||'');}
  }
  const parameters=out.slice(0,300),normal=parameters.filter(x=>x.status==='normal').length,low=parameters.filter(x=>x.status==='low').length,high=parameters.filter(x=>x.status==='high').length;
  return {version:1,generatedAt:new Date().toISOString(),source:'Referências informadas no próprio laudo',summary:{total:parameters.length,normal,low,high,altered:low+high},parameters};
}
function analysisParamHtml(x){
  const cls=x.status==='normal'?'normal':x.status==='low'?'low':'high';
  const label=x.status==='normal'?'Dentro da referência':x.status==='low'?'Abaixo da referência':'Acima da referência';
  const delta=x.status==='normal'||x.deviationPct==null?'':`<strong>${x.deviationPct.toLocaleString('pt-BR',{maximumFractionDigits:1})}% ${x.status==='low'?'abaixo do mínimo':'acima do máximo'}</strong>`;
  return `<article class="analysis-param ${cls}"><div class="analysis-param-head"><div><h4>${esc(x.name)}</h4><span>${esc(label)}</span></div><b>${esc(String(x.result))}${x.unit?` ${esc(x.unit)}`:''}</b></div><div class="analysis-param-meta"><span>Referência: ${esc(x.referenceText||[x.min,x.max].filter(v=>v!=null).join(' – '))}</span>${delta}</div></article>`;
}
function showAnalysisModal(analysis,fileName){
  const a=analysis||{},sum=a.summary||{},params=Array.isArray(a.parameters)?a.parameters:[],altered=params.filter(x=>x.status!=='normal'),normal=params.filter(x=>x.status==='normal');
  modal(`<div class="analysis-modal"><div class="detail-head"><div><h3>📊 Análise do resultado</h3><p class="muted">${esc(fileName||'Resultado')} • referências do próprio laudo</p></div><span class="analysis-fast-pill">ANÁLISE RÁPIDA</span></div><div class="analysis-summary"><div><b>${sum.total||params.length}</b><span>Parâmetros analisados</span></div><div class="normal"><b>${sum.normal||0}</b><span>Normais</span></div><div class="low"><b>${sum.low||0}</b><span>Abaixo</span></div><div class="high"><b>${sum.high||0}</b><span>Acima</span></div></div>${params.length?`${altered.length?`<div class="analysis-section-title"><h4>Alterações encontradas</h4><p>Percentual calculado em relação ao limite informado no laudo.</p></div>${altered.map(analysisParamHtml).join('')}`:`<div class="analysis-all-normal"><b>✓ Todos os parâmetros analisados estão dentro das referências.</b><p>Segundo os valores e intervalos encontrados neste laudo, não foram identificados parâmetros fora da faixa informada.</p></div>`}${normal.length&&altered.length?`<details class="analysis-normal-details"><summary>Ver ${normal.length} parâmetro(s) dentro da referência</summary>${normal.map(analysisParamHtml).join('')}</details>`:''}`:`<div class="empty-state">Nenhum parâmetro com valor e referência reconhecíveis foi encontrado automaticamente.</div>`}<div class="analysis-disclaimer">Análise automatizada baseada exclusivamente nos valores e intervalos de referência presentes no laudo. Não constitui diagnóstico veterinário. A interpretação clínica deve ser realizada pelo médico-veterinário responsável.</div><div class="actions"><button class="btn ghost" data-close-modal>Fechar</button></div></div>`);
}
async function saveAndShowAnalysis(fileId,fileName,analysis,button){
  if(!analysis?.parameters?.length)return showAnalysisTextFallback(fileId,fileName,'Não consegui identificar automaticamente valores acompanhados de intervalos de referência.');
  try{const r=await api(`/api/results/${fileId}/analysis`,{method:'PUT',json:{analysis}});if(button)button.textContent='Ver análise';showAnalysisModal(r.analysis||analysis,fileName)}catch(e){toast(e.message,'error')}
}
function showAnalysisTextFallback(fileId,fileName,message,initial=''){
  modal(`<div class="analysis-modal"><h3>📊 Analisar resultado</h3><p class="muted">${esc(message)}</p><label class="field">Texto do laudo<textarea id="analysisTextManual" rows="12" placeholder="Cole aqui o texto do resultado com os valores e as referências.">${esc(initial||'')}</textarea></label><div class="actions"><button class="btn analysis" id="runManualAnalysis">Analisar texto</button><button class="btn ghost" data-close-modal>Cancelar</button></div></div>`);
  $('#runManualAnalysis')?.addEventListener('click',()=>{const a=parseResultAnalysis($('#analysisTextManual').value);if(!a.parameters.length)return toast('Ainda não encontrei linhas com resultado e referência.','error');saveAndShowAnalysis(fileId,fileName,a,null)});
}
async function openResultAnalysis(fileId,fileName,button){
  if(state.me?.role!=='client')return toast('A análise é exclusiva para a clínica/cliente.','error');
  try{
    const saved=await api(`/api/results/${fileId}/analysis`);if(saved.analysis){if(button)button.textContent='Ver análise';return showAnalysisModal(saved.analysis,fileName)}
    modal(`<div class="analysis-loading"><div class="analysis-spinner"></div><h3>Analisando resultado…</h3><p>Leitura local e rápida dos valores e referências do laudo.</p></div>`);
    const blob=await fetchResultBlob(fileId,'view');let text='';
    try{text=await extractResultText(blob,fileName)}catch(e){return showAnalysisTextFallback(fileId,fileName,e.message)}
    const analysis=parseResultAnalysis(text);if(!analysis.parameters.length)return showAnalysisTextFallback(fileId,fileName,'O arquivo abriu corretamente, mas o formato da tabela não pôde ser reconhecido automaticamente.',text.slice(0,12000));
    await saveAndShowAnalysis(fileId,fileName,analysis,button);
  }catch(e){toast(e.message,'error');closeModal()}
}
function toast(msg,type='ok'){const el=$('#toast');el.textContent=msg;el.className=`toast show ${type}`;clearTimeout(toast.t);toast.t=setTimeout(()=>el.className='toast',3300)}
function modal(html){$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden')}
function closeModal(){$('#modal').classList.add('hidden');$('#modalContent').innerHTML=''}

let alertPollTimer=null, audioCtx=null, alertSoundMode=null, labAudioBlocked=false;
const labRequestAudio=new Audio('/assets/alerta_nova_solicitacao.wav');
const labCancelAudio=new Audio('/assets/alerta_cancelamento_sirene.wav');
labRequestAudio.loop=true;labRequestAudio.preload='auto';labRequestAudio.volume=1;
labCancelAudio.loop=true;labCancelAudio.preload='auto';labCancelAudio.volume=1;
function unlockAudio(){
  try{audioCtx ||= new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended')audioCtx.resume();}catch{}
}
function stopMedia(a){try{a.pause();a.currentTime=0}catch{}}
function stopLabSound(){stopMedia(labRequestAudio);stopMedia(labCancelAudio);alertSoundMode=null;}
async function playLabSound(mode){
  const next=mode==='siren'?labCancelAudio:mode==='request'?labRequestAudio:null;
  const other=mode==='siren'?labRequestAudio:labCancelAudio;
  if(!next){stopLabSound();labAudioBlocked=false;return;}
  stopMedia(other);alertSoundMode=mode;
  try{if(next.paused)await next.play();labAudioBlocked=false;}
  catch{labAudioBlocked=true;}
}
async function enableLabSound(){
  unlockAudio();
  const mode=(state.cancelAlerts?.length||0)?'siren':(state.alerts?.length||0)?'request':null;
  if(mode)await playLabSound(mode);
  renderAlertDock();
}
function stopLabAlerts(){
  clearInterval(alertPollTimer);alertPollTimer=null;stopLabSound();labAudioBlocked=false;
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
  const soundGate=operational&&labAudioBlocked?`<div class="lab-alert-item"><div><strong>🔊 Som bloqueado pelo navegador</strong><small>Toque uma vez para liberar os alertas sonoros nesta sessão.</small></div><button class="btn primary small" data-enable-lab-sound>ATIVAR SOM</button></div>`:'';
  dock.innerHTML=`<div class="lab-alert-head">Central de avisos HLabVet</div>${soundGate}${cancellationHtml}${newHtml}${priceHtml}`;
  $$('[data-accept-alert]',dock).forEach(b=>b.addEventListener('click',async()=>{unlockAudio();try{const r=await api(`/api/requisitions/${b.dataset.acceptAlert}/accept`,{method:'POST'});toast(r.message);await pollLabAlerts();if(state.page==='requests'||state.page==='dashboard')navigate(state.page)}catch(e){toast(e.message,'error')}}));
  $$('[data-ack-alert]',dock).forEach(b=>b.addEventListener('click',async()=>{unlockAudio();try{await api(`/api/alerts/${b.dataset.ackAlert}/ack`,{method:'POST'});toast('Cancelamento confirmado.');await pollLabAlerts();if(state.page==='cancellations')navigate('cancellations')}catch(e){toast(e.message,'error')}}));
  $('[data-enable-lab-sound]',dock)?.addEventListener('click',enableLabSound);
  $('[data-go-prices]',dock)?.addEventListener('click',()=>navigate('prices'));
}
async function pollLabAlerts(){
  if(!state.me||!['admin','staff'].includes(state.me.role))return;
  try{
    const d=await api('/api/alerts');state.alerts=d.alerts||[];state.cancelAlerts=d.cancelAlerts||[];state.missingPrices=d.missingPrices||[];renderAlertDock();
    const soundCount=state.alerts.length+state.cancelAlerts.length;
    const wantedMode=state.cancelAlerts.length?'siren':state.alerts.length?'request':null;
    if(!soundCount){stopLabSound();labAudioBlocked=false;}
    else if(wantedMode!==alertSoundMode || (wantedMode==='request'&&labRequestAudio.paused) || (wantedMode==='siren'&&labCancelAudio.paused)){
      await playLabSound(wantedMode);renderAlertDock();
    }
  }catch{}
}

function startLabAlerts(){
  stopLabAlerts();if(!state.me||!['admin','staff'].includes(state.me.role))return;document.addEventListener('pointerdown',()=>{unlockAudio();if(labAudioBlocked)enableLabSound()},{once:true});pollLabAlerts();alertPollTimer=setInterval(pollLabAlerts,5000);
}
document.addEventListener('click',e=>{if(e.target.matches('[data-close-modal]'))closeModal()});


function ownerPath(){
  const clean=location.pathname.replace(/\/+$/,'')||'/';
  return clean==='/proprietario' || new URLSearchParams(location.search).get('proprietario')==='1';
}
function ownerToast(msg,type='ok'){
  let el=$('#ownerToast');if(!el){el=document.createElement('div');el.id='ownerToast';el.className='owner-toast';document.body.appendChild(el)}
  el.textContent=msg;el.className=`owner-toast show ${type}`;clearTimeout(ownerToast.t);ownerToast.t=setTimeout(()=>el.className='owner-toast',3600);
}
function reaisToCents(v){
  const raw=String(v??'').trim();if(!raw)return null;
  const n=Number(raw.replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?Math.round(n*100):NaN;
}
function centsToInput(c){return c==null?'':(Number(c)/100).toFixed(2).replace('.',',')}
function ownerShell(inner){
  stopLabAlerts();document.body.className='owner-mode';
  document.body.innerHTML=`<div class="owner-page"><div id="ownerRoot">${inner}</div><div id="ownerToast" class="owner-toast"></div></div>`;
}
async function ownerBoot(){
  try{await api('/api/owner/me');await renderOwnerDashboard(currentMonth())}catch{showOwnerLogin()}
}
function showOwnerLogin(){
  ownerShell(`<main class="owner-auth-wrap"><section class="owner-auth-card"><div class="owner-brand"><div class="owner-logo-mark">H</div><div><h1>HLabVet Gestão</h1><p>Painel exclusivo do proprietário do sistema</p></div></div><form id="ownerLoginForm" class="owner-stack"><label>Login<input name="username" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="current-password" required></label><button class="btn primary" type="submit">Entrar no painel</button></form><a class="owner-back-link" href="/">Voltar ao HLabVet do laboratório</a></section></main>`);
  $('#ownerLoginForm').addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await api('/api/owner/login',{json:body});await renderOwnerDashboard(currentMonth())}catch(err){ownerToast(err.message,'error')}});
}
async function renderOwnerDashboard(month=currentMonth()){
  let d,p;
  try{[d,p]=await Promise.all([api(`/api/owner/dashboard?month=${encodeURIComponent(month)}`),api('/api/owner/pricing')])}catch(e){if(e.status===401)return showOwnerLogin();return ownerToast(e.message,'error')}
  const q=d.counts,st=d.storage,h=d.health,pr=d.pricing;
  const tierLabel=pr.tier?`${pr.tier.min_clients}–${pr.tier.max_clients??'+'} clientes ativos`:'Sem faixa';
  const healthClass=(h.dbLatencyMs||0)>800?'bad':(h.dbLatencyMs||0)>350?'warn':'ok';
  const tierRows=(p.tiers||[]).map(t=>`<tr><td>${t.min_clients}</td><td>${t.max_clients??'Acima'}</td><td><input class="owner-price-input" data-tier-id="${t.id}" value="${centsToInput(t.monthly_cents)}"></td></tr>`).join('');
  ownerShell(`<header class="owner-top"><div><strong>HLabVet Gestão</strong><span>Painel do proprietário</span></div><div class="owner-top-actions"><a href="/" class="btn ghost small">Abrir sistema do laboratório</a><button id="ownerLogout" class="btn ghost small">Sair</button></div></header><main class="owner-container">
    <section class="owner-title-row"><div><h1>Visão geral</h1><p>Uso, cobrança, armazenamento, backup e encerramento da instalação.</p></div><label>Mês de referência<input id="ownerMonth" type="month" value="${esc(d.month)}"></label></section>
    <section class="owner-cards">
      <article class="owner-card emphasis"><small>VALOR MENSAL SUGERIDO</small><strong>${fmtMoney(pr.suggestedCents)}</strong><span>${esc(tierLabel)}</span></article>
      <article class="owner-card"><small>VALOR FINAL CONTRATADO</small><strong>${fmtMoney(pr.finalCents)}</strong><span>Vencimento: dia ${pr.dueDay}</span></article>
      <article class="owner-card"><small>CLIENTES ATIVOS NO MÊS</small><strong>${q.activeClients}</strong><span>${q.registeredClients} cadastrados • ${q.enabledClients} habilitados</span></article>
      <article class="owner-card"><small>SOLICITAÇÕES NO MÊS</small><strong>${q.requests}</strong><span>${q.exams} exames vinculados</span></article>
    </section>
    <section class="owner-grid-2">
      <article class="owner-panel"><div class="owner-panel-head"><div><h2>Consumo</h2><p>Indicadores reais desta instalação.</p></div></div><div class="owner-metric-list">
        <div><span>Resultados cadastrados</span><b>${q.results}</b></div><div><span>Tutores ativos</span><b>${q.tutors}</b></div><div><span>Entregadores ativos</span><b>${q.couriers}</b></div><div><span>Técnicos do laboratório</span><b>${q.staff}</b></div><div><span>Banco D1 aproximado</span><b>${st.databaseBytes==null?'Não informado':fmtBytes(st.databaseBytes)}</b></div><div><span>Objetos no R2</span><b>${st.r2Objects}${st.r2Truncated?' +':''}</b></div><div><span>Armazenamento R2</span><b>${fmtBytes(st.r2Bytes)}</b></div><div><span>Arquivos de resultados</span><b>${fmtBytes(st.resultBytes)}</b></div>
      </div></article>
      <article class="owner-panel"><div class="owner-panel-head"><div><h2>Saúde do sistema</h2><p>Leitura rápida para você não depender de reclamação do cliente.</p></div></div><div class="owner-health"><div class="status-dot ok"><i></i><span>API</span><b>ONLINE</b></div><div class="status-dot ok"><i></i><span>Banco D1</span><b>ONLINE</b></div><div class="status-dot ok"><i></i><span>Arquivos R2</span><b>ONLINE</b></div><div class="status-dot ${healthClass}"><i></i><span>Resposta do banco</span><b>${h.dbLatencyMs} ms</b></div></div><small class="owner-note">O painel mede o tempo de uma consulta simples. Picos isolados não significam falha; o histórico poderá ser ampliado depois.</small></article>
    </section>
    <section class="owner-grid-2">
      <article class="owner-panel"><div class="owner-panel-head"><div><h2>Tabela comercial</h2><p>O valor sugerido é calculado pelos clientes que realmente usaram o sistema no mês.</p></div></div><form id="ownerPricingForm"><div class="table-wrap"><table><thead><tr><th>De</th><th>Até</th><th>Mensalidade (R$)</th></tr></thead><tbody>${tierRows}</tbody></table></div><div class="owner-form-grid"><label>Valor contratado (R$)<input id="contractedMonthly" value="${centsToInput(p.contract?.contracted_monthly_cents)}" placeholder="Em branco = automático"></label><label>Desconto (R$)<input id="discountCents" value="${centsToInput(p.contract?.discount_cents||0)}"></label><label>Dia do vencimento<input id="dueDay" type="number" min="1" max="28" value="${p.contract?.due_day||10}"></label><label>Observação<input id="contractNotes" value="${esc(p.contract?.notes||'')}"></label></div><button class="btn primary" type="submit">Salvar preços</button></form></article>
      <article class="owner-panel"><div class="owner-panel-head"><div><h2>Backup e devolução dos dados</h2><p>Faça snapshot lógico e exporte um pacote organizado quando necessário.</p></div></div><div class="owner-actions-stack"><button id="ownerBackup" class="btn secondary">Criar backup lógico agora</button><button id="ownerExport" class="btn primary">Exportar dados completos (.ZIP)</button></div><div class="owner-backups"><h3>Últimos backups</h3>${(d.backups||[]).length?(d.backups||[]).map(b=>`<div><span>${fmtDateTime(b.created_at)}</span><b>${fmtBytes(b.size_bytes)}</b></div>`).join(''):'<p>Nenhum backup lógico criado ainda.</p>'}</div><small class="owner-note">O D1 também possui recuperação por Time Travel da Cloudflare; o ZIP é a cópia portátil para entregar ao laboratório.</small></article>
    </section>
    <section class="owner-grid-2">
      <article class="owner-panel"><div class="owner-panel-head"><div><h2>Segurança do proprietário</h2><p>Troque sua senha sem alterar o acesso do laboratório.</p></div></div><form id="ownerPasswordForm" class="owner-stack"><label>Senha atual<input name="currentPassword" type="password" required></label><label>Nova senha<input name="newPassword" type="password" minlength="10" required></label><label>Confirmar nova senha<input name="confirm" type="password" minlength="10" required></label><button class="btn secondary" type="submit">Alterar minha senha</button></form></article>
      <article class="owner-panel danger-zone"><div class="owner-panel-head"><div><h2>Zerar para primeiro uso</h2><p>Exclui todos os testes, clientes, tutores, entregadores, solicitações, resultados, preços e arquivos. Preserva seu acesso de proprietário e deixa somente HLabVet com a senha inicial para o novo laboratório.</p></div></div><div class="owner-stack"><label>Digite <b>ZERAR HLABVET</b><input id="ownerResetPhrase" autocomplete="off"></label><label>Sua senha de proprietário<input id="ownerResetPassword" type="password" autocomplete="current-password"></label><label class="owner-check"><input id="ownerResetCheck" type="checkbox"> Confirmo que já exportei o que preciso e que a exclusão é definitiva.</label><button id="ownerReset" class="btn danger" type="button">Zerar instalação</button></div></article>
    </section>
  </main>`);
  $('#ownerMonth').addEventListener('change',e=>renderOwnerDashboard(e.target.value||currentMonth()));
  $('#ownerLogout').addEventListener('click',async()=>{try{await api('/api/owner/logout',{method:'POST'})}catch{}showOwnerLogin()});
  $('#ownerPricingForm').addEventListener('submit',async e=>{e.preventDefault();const tiers=$$('.owner-price-input').map(i=>({id:Number(i.dataset.tierId),monthlyCents:reaisToCents(i.value)}));const contractedMonthlyCents=reaisToCents($('#contractedMonthly').value);const discountCents=reaisToCents($('#discountCents').value)??0;try{await api('/api/owner/pricing',{method:'PUT',json:{tiers,contractedMonthlyCents,discountCents,dueDay:Number($('#dueDay').value||10),notes:$('#contractNotes').value}});ownerToast('Configuração comercial salva.');await renderOwnerDashboard($('#ownerMonth')?.value||month)}catch(err){ownerToast(err.message,'error')}});
  $('#ownerBackup').addEventListener('click',async()=>{const b=$('#ownerBackup');b.disabled=true;b.textContent='Criando backup...';try{const r=await api('/api/owner/backup',{method:'POST'});ownerToast(`${r.message} ${fmtBytes(r.sizeBytes)}`);await renderOwnerDashboard(month)}catch(err){ownerToast(err.message,'error')}finally{if(document.body.contains(b)){b.disabled=false;b.textContent='Criar backup lógico agora'}}});
  $('#ownerExport').addEventListener('click',async()=>{const b=$('#ownerExport');b.disabled=true;b.textContent='Preparando ZIP...';try{const res=await fetch('/api/owner/export.zip',{credentials:'include'});if(!res.ok){const ct=res.headers.get('content-type')||'';const d=ct.includes('json')?await res.json():null;throw new Error(d?.error||`Erro ${res.status}`)}const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`HLabVet-exportacao-${today()}.zip`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);ownerToast('Exportação concluída.')}catch(err){ownerToast(err.message,'error')}finally{b.disabled=false;b.textContent='Exportar dados completos (.ZIP)'}});
  $('#ownerPasswordForm').addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));if(body.newPassword!==body.confirm)return ownerToast('A confirmação da nova senha não confere.','error');delete body.confirm;try{const r=await api('/api/owner/change-password',{json:body});ownerToast(r.message);e.currentTarget.reset()}catch(err){ownerToast(err.message,'error')}});
  $('#ownerReset').addEventListener('click',async()=>{if(!$('#ownerResetCheck').checked)return ownerToast('Marque a confirmação antes de zerar.','error');if(!confirm('Esta ação apagará definitivamente todos os dados de teste desta instalação. Continuar?'))return;const b=$('#ownerReset');b.disabled=true;b.textContent='Zerando...';try{const r=await api('/api/owner/reset',{json:{confirmation:$('#ownerResetPhrase').value,password:$('#ownerResetPassword').value}});ownerToast(r.message);setTimeout(()=>renderOwnerDashboard(currentMonth()),1200)}catch(err){ownerToast(err.message,'error')}finally{if(document.body.contains(b)){b.disabled=false;b.textContent='Zerar instalação'}}});
}

function publicWhatsappIcon(){
  return `<svg class="public-whatsapp-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3.5A11.7 11.7 0 0 0 5.9 21.1L4.3 27.9l7-1.6A11.7 11.7 0 1 0 16 3.5Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M11.3 9.8c.4-.8.8-.8 1.2-.8h.7c.2 0 .5.1.7.6l1 2.4c.1.4.1.7-.1 1l-.8 1c-.2.2-.3.5-.1.8.5 1 1.3 2 2.3 2.8 1 .8 2 1.3 2.8 1.6.3.1.6.1.8-.2l1-1.2c.3-.3.6-.4 1-.2l2.3 1.1c.4.2.6.4.6.7 0 .3-.2 1.7-1 2.5-.8.8-1.9 1.2-3.1 1.2-1.6 0-4.6-.9-7.6-3.6-2.5-2.2-4.2-5.1-4.3-6.9 0-1.1.4-2.1.8-2.8Z" fill="currentColor"/></svg>`;
}

function publicTrackingHtml(data){
  const c=data?.customer||{},requests=data?.requests||[];
  const reqHtml=requests.length?requests.map(r=>{
    const files=r.files||[];
    return `<article class="public-track-card"><div class="public-track-head"><div><small>${esc(r.protocol)}</small><h3>${esc(r.patient_name||'Animal')}</h3>${r.birth_date?`<span>Nascimento: ${fmtDate(r.birth_date)}</span>`:''}</div><span class="badge ${esc(r.status)}">${esc(r.status_label||STATUS[r.status]||r.status)}</span></div><div class="public-track-flow"><span class="${['solicitado','atribuido','coletado','recebido','em_analise','concluido'].includes(r.status)?'done':''}">Solicitado</span><span class="${['atribuido','coletado','recebido','em_analise','concluido'].includes(r.status)?'done':''}">Coleta</span><span class="${['recebido','em_analise','concluido'].includes(r.status)?'done':''}">Recebido</span><span class="${['em_analise','concluido'].includes(r.status)?'done':''}">Em análise</span><span class="${r.status==='concluido'?'done':''}">Resultado</span></div>${r.status==='cancelado'?`<div class="warning-box">Solicitação cancelada${r.cancellation_reason?`: ${esc(r.cancellation_reason)}`:''}.</div>`:''}${files.length?`<div class="public-result-list"><h4>Resultado disponível</h4>${files.map(f=>`<div class="public-result-file"><div><strong>${esc(f.original_name)}</strong><small>${fmtDateTime(f.created_at)}</small></div><div class="actions"><button class="btn soft small" data-public-result-view="${f.id}" data-filename="${esc(f.original_name)}">Visualizar</button><button class="btn secondary small" data-public-result-download="${f.id}" data-filename="${esc(f.original_name)}">Baixar</button></div></div>`).join('')}</div>`:`<div class="public-result-pending">${r.status==='concluido'?'O exame foi concluído. O arquivo do resultado ainda não está disponível neste acesso.':'O resultado aparecerá aqui assim que for liberado pelo laboratório.'}</div>`}</article>`;
  }).join(''):'<div class="empty-state">Nenhuma solicitação de exame encontrada para este cadastro.</div>';
  return `<div class="public-customer-profile"><div><small>CADASTRO LOCALIZADO</small><h3>${esc(c.name||'Cliente')}</h3><span>${esc(c.phone_display||'')}</span></div><div><small>ENDEREÇO DE COLETA</small><strong>${esc(c.address||'Ainda não informado')}</strong></div>${c.tutor_account_id?'<a class="btn ghost small" href="/">Abrir painel completo</a>':''}</div><div class="public-track-list">${reqHtml}</div>`;
}
async function publicResultAction(fileId,mode='view',filename='resultado'){
  try{
    const res=await fetch(`/api/public/results/${fileId}/${mode==='download'?'download':'view'}`,{credentials:'include'});
    if(!res.ok){const ct=res.headers.get('content-type')||'';if(ct.includes('application/json')){const d=await res.json();throw new Error(d.error||`Erro ${res.status}`)}throw new Error(`Não foi possível abrir o resultado (erro ${res.status}).`)}
    const blob=await res.blob(),url=URL.createObjectURL(blob);
    if(mode==='download'){const a=document.createElement('a');a.href=url;a.download=filename||'resultado';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return;}
    const w=window.open(url,'_blank');if(!w){URL.revokeObjectURL(url);return toast('O navegador bloqueou a nova janela. Libere pop-ups para visualizar o resultado.','error')}setTimeout(()=>URL.revokeObjectURL(url),120000);
  }catch(e){toast(e.message,'error')}
}
function bindPublicResultButtons(root=document){
  $$('[data-public-result-view]',root).forEach(b=>b.addEventListener('click',()=>publicResultAction(Number(b.dataset.publicResultView),'view',b.dataset.filename||'resultado')));
  $$('[data-public-result-download]',root).forEach(b=>b.addEventListener('click',()=>publicResultAction(Number(b.dataset.publicResultDownload),'download',b.dataset.filename||'resultado')));
}

async function renderPublicWebsite(focusQuote=false){
  stopLabAlerts();$('#loginView').classList.add('hidden');$('#appView').classList.add('hidden');$('#courierView').classList.remove('hidden');document.body.classList.remove('courier-mobile-mode');document.body.classList.add('public-quote-mode','public-site-mode');
  try{
    const site=await api('/api/public/site');
    if(!site.enabled){$('#courierView').innerHTML=`<div class="public-site-offline"><img src="/assets/hlabvet-logo.png"><h1>Site temporariamente indisponível</h1><p>Entre em contato com o HLab Vet pelos canais de atendimento.</p><a class="btn primary" href="/">Área do cliente</a></div>`;return}
    const st=site.settings||{},phone=String(st.whatsappPhone||'').replace(/\D/g,''),wa=phone?`https://wa.me/${phone.startsWith('55')?phone:`55${phone}`}`:'#contato';
    let quoteData=null;try{if(site.quote?.enabled)quoteData=await api('/api/public/quote-catalog')}catch{}
    const groups=new Map();for(const x of quoteData?.exams||[]){if(!groups.has(x.category))groups.set(x.category,[]);groups.get(x.category).push(x)}
    const offers=site.offers||[],partners=site.partners||[],tabImages=site.tabImages||{},popupOffer=offers.find(o=>o.offer_type==='promotion'&&Number(o.show_popup)&&o.active!==0)||null;
    $('#courierView').innerHTML=`<div class="hlab-public-site">
      <header class="public-site-header"><a href="/site" class="public-site-logo" data-public-tab="home"><img src="/assets/hlabvet-logo.png" alt="HLab Vet"></a><nav><a href="#inicio" data-public-tab="home">Início</a><a href="#cotacao" data-public-tab="cotacao">Faça sua cotação</a><a href="#acompanhamento" data-public-tab="acompanhamento">Acompanhar exames</a>${offers.length?`<a href="#servicos" data-public-tab="servicos">Serviços e promoções</a>`:''}${partners.length?`<a href="#parceiros" data-public-tab="parceiros">Parceiros</a>`:''}<a href="#localizacao" data-public-tab="localizacao">Localização</a><a href="#trabalhe" data-public-tab="trabalhe">Trabalhe conosco</a><a href="#contato" data-public-tab="contato">Contato</a></nav><a href="/" class="public-client-login">Área do cliente</a></header>
      <main class="public-site-main">
        <section id="inicio" class="public-hero public-site-tab-panel" data-public-panel="home"><div class="public-hero-copy"><span>HLAB VET • DIAGNÓSTICOS VETERINÁRIOS</span><h1>${esc(st.headline||'Diagnóstico veterinário com agilidade, cuidado e confiança')}</h1><p>${esc(st.subheadline||'')}</p><div class="public-hero-actions"><a class="public-cta primary" href="#cotacao" data-public-tab="cotacao">Faça sua cotação</a><a class="public-cta secondary" href="#acompanhamento" data-public-tab="acompanhamento">Acompanhar exame</a>${phone?`<a class="public-cta secondary" href="${wa}" target="_blank" rel="noopener">Falar no WhatsApp</a>`:''}</div><div class="public-trust-row"><div><b>Exames</b><small>Catálogo atualizado</small></div><div><b>Coleta</b><small>Fluxo integrado</small></div><div><b>Resultados</b><small>Acesso digital</small></div></div></div><div class="public-hero-visual">${tabImages.home?`<div class="public-hero-photo"><img src="${esc(tabImages.home)}" alt="HLab Vet"></div>`:`<div class="public-hero-mark"><img src="/assets/hlabvet-logo.png"><span>Ciência a favor da vida animal</span></div>`}</div></section>
        ${offers.length?`<section id="servicos" class="public-section public-offers-section public-site-tab-panel" data-public-panel="servicos"><div class="public-section-head"><span>DESTAQUES</span><h2>Serviços, produtos e promoções</h2><p>Conteúdos selecionados pelo HLab Vet.</p></div>${tabImages.offers?`<div class="public-tab-banner"><img src="${esc(tabImages.offers)}" alt="Serviços e promoções HLab Vet"></div>`:''}<div class="public-offer-grid">${offers.map(o=>`<article class="public-offer-card">${o.imageUrl?`<div class="public-offer-image"><img src="${esc(o.imageUrl)}" alt="${esc(o.title)}">${o.badge?`<span>${esc(o.badge)}</span>`:''}</div>`:`<div class="public-offer-image placeholder"><img src="/assets/hlabvet-logo.png" alt="HLab Vet">${o.badge?`<span>${esc(o.badge)}</span>`:''}</div>`}<div class="public-offer-body"><small>${o.offer_type==='product'?'PRODUTO':o.offer_type==='promotion'?'PROMOÇÃO':'SERVIÇO'}</small><h3>${esc(o.title)}</h3><p>${esc(o.description||'')}</p>${o.promo_price_cents!=null?`<div class="public-offer-price"><del>${o.price_cents!=null?fmtMoney(o.price_cents):''}</del><strong>${fmtMoney(o.promo_price_cents)}</strong></div>`:o.price_cents!=null?`<div class="public-offer-price"><strong>${fmtMoney(o.price_cents)}</strong></div>`:''}<a href="${phone?`${wa}?text=${encodeURIComponent(`Olá! Gostaria de saber mais sobre ${o.title}.`)}`:'#contato'}" ${phone?'target="_blank" rel="noopener"':'data-public-tab="contato"'} class="public-card-cta">${esc(o.button_text||'Quero saber mais')}</a></div></article>`).join('')}</div></section>`:''}
        <section id="cotacao" class="public-section public-quote-section public-site-tab-panel" data-public-panel="cotacao"><div class="public-section-head"><span>FAÇA SUA COTAÇÃO</span><h2>Monte seu orçamento de exames</h2><p>O orçamento fica vinculado ao seu cadastro pelo WhatsApp. Se decidir realizar os exames, você confirma a coleta sem preencher tudo novamente.</p></div>${tabImages.quote?`<div class="public-tab-banner"><img src="${esc(tabImages.quote)}" alt="Faça sua cotação HLab Vet"></div>`:''}${site.quote?.enabled&&quoteData?`<div class="public-quote-layout"><aside class="public-quote-contact"><h3>Dados do tutor e do animal</h3><label>Nome do tutor / responsável<input id="publicQuoteName" required placeholder="Seu nome"></label><label>WhatsApp com DDD<input id="publicQuotePhone" required inputmode="tel" placeholder="(84) 99999-9999"></label><label>E-mail (opcional)<input id="publicQuoteEmail" type="email" placeholder="voce@email.com"></label><label>Nome do animal<input id="publicQuotePatient" required placeholder="Nome do animal"></label><label>Data de nascimento do animal<input id="publicQuoteBirth" required type="date" max="${today()}"></label><div class="public-quote-summary"><span><small>Itens selecionados</small><b id="publicQuoteCount">0</b></span>${quoteData.showPrices?`<span><small>Total</small><strong id="publicQuoteTotal">R$ 0,00</strong></span>`:''}</div><button class="public-submit-quote" id="publicQuoteSubmit">ENVIAR COTAÇÃO AO HLAB VET</button><div id="publicQuoteSuccess"></div></aside><div class="public-quote-catalog"><div class="public-quote-search"><span>⌕</span><input id="publicQuoteSearch" placeholder="Informe o nome do exame"></div><div class="public-exam-list" id="publicExamGrid">${[...groups.entries()].map(([cat,items])=>`<section class="public-exam-category"><h3>${esc(cat)}</h3>${items.map(x=>`<label class="public-exam-line" data-search="${esc((x.examName+' '+cat).toLowerCase())}"><input type="checkbox" data-public-exam="${x.examCode}" data-name="${esc(x.examName)}" data-price="${x.priceCents||0}" ${x.priceCents==null?'disabled':''}><span>${esc(x.examName)}</span>${quoteData.showPrices?`<strong>${x.priceCents==null?'Consultar preço':fmtMoney(x.priceCents)}</strong>`:''}</label>`).join('')}</section>`).join('')}</div>${quoteData.showServices&&quoteData.services?.length?`<section class="public-exam-category public-extra-services"><h3>Serviços adicionais</h3>${quoteData.services.map(x=>`<label class="public-exam-line"><input type="checkbox" data-public-service="${x.id}" data-name="${esc(x.name)}" data-price="${x.price_cents}"><span>${esc(x.name)}${x.description?`<small>${esc(x.description)}</small>`:''}</span>${quoteData.showPrices?`<strong>${fmtMoney(x.price_cents)}</strong>`:''}</label>`).join('')}</section>`:''}</div></div>`:`<div class="public-offline-inline"><h3>Cotação online temporariamente desativada</h3><p>O site continua disponível. Para orçamento, fale com o laboratório.</p>${phone?`<a href="${wa}" target="_blank" class="public-cta primary">Falar no WhatsApp</a>`:''}</div>`}</section>
        <section id="acompanhamento" class="public-section public-tracking-section public-site-tab-panel" data-public-panel="acompanhamento"><div class="public-section-head"><span>ACOMPANHE SEU EXAME</span><h2>Andamento e resultados</h2><p>Digite o mesmo WhatsApp usado no orçamento ou solicitação para consultar o histórico dos seus animais.</p></div><div class="public-tracking-search"><label>WhatsApp com DDD<input id="publicTrackPhone" inputmode="tel" placeholder="(84) 99999-9999"></label><button class="public-cta primary" id="publicTrackButton" type="button">CONSULTAR</button><button class="btn ghost hidden" id="publicTrackRefresh" type="button">Atualizar andamento</button></div><div id="publicTrackingResults" class="public-tracking-results"><div class="empty-state">Informe seu telefone para visualizar suas solicitações.</div></div></section>
        ${partners.length?`<section id="parceiros" class="public-section public-partners-section public-site-tab-panel" data-public-panel="parceiros"><div class="public-section-head"><span>QUEM CONFIA NO HLAB VET</span><h2>Nossos parceiros e clientes</h2><p>Empresas e profissionais que fazem parte da nossa rede.</p></div><div class="public-partners-mask"><div class="public-partners-track">${[...partners,...partners].map(x=>`${x.website_url?`<a class="public-partner-logo" href="${esc(x.website_url)}" target="_blank" rel="noopener">`:`<div class="public-partner-logo">`}${x.logoUrl?`<img src="${esc(x.logoUrl)}" alt="${esc(x.name)}">`:`<strong>${esc(x.name)}</strong>`}${x.website_url?'</a>':'</div>'}`).join('')}</div></div></section>`:''}
        <section id="localizacao" class="public-section public-location-section public-site-tab-panel" data-public-panel="localizacao"><div class="public-location-card"><div><span>ONDE ESTAMOS</span><h2>Localização</h2><p>${esc(st.address||'Cadastre o endereço no painel do site.')}</p>${st.mapUrl?`<a href="${esc(st.mapUrl)}" target="_blank" rel="noopener" class="public-cta primary">Abrir localização exata no Google Maps</a>`:''}</div><div class="public-location-visuals">${tabImages.location?`<div class="public-location-photo"><img src="${esc(tabImages.location)}" alt="HLab Vet"></div>`:''}<div class="public-map-visual">${st.mapEmbedUrl?`<iframe src="${esc(st.mapEmbedUrl)}" title="Mapa HLab Vet" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`:`<div class="public-map-fallback"><div class="map-pin">⌖</div><strong>HLab Vet</strong><small>${esc(st.address||'Natal/RN')}</small></div>`}</div></div></div></section>
        <section id="trabalhe" class="public-section public-careers-section public-site-tab-panel" data-public-panel="trabalhe"><div class="public-careers-card"><div><span>TRABALHE CONOSCO</span><h2>Faça parte da nossa equipe</h2><p>Envie seu currículo por e-mail. O destinatário é configurado pelo laboratório no próprio sistema.</p>${st.careersEmail?`<a class="public-cta primary" href="mailto:${encodeURIComponent(st.careersEmail)}?subject=${encodeURIComponent('Currículo - Trabalhe conosco HLab Vet')}&body=${encodeURIComponent('Olá! Gostaria de enviar meu currículo para oportunidades no HLab Vet. Favor anexar o currículo a este e-mail.')}">Enviar currículo por e-mail</a><small>Envie para: ${esc(st.careersEmail)} • anexe o currículo antes de enviar.</small>`:'<small>O e-mail de currículos ainda não foi configurado.</small>'}</div>${tabImages.careers?`<div class="public-careers-photo"><img src="${esc(tabImages.careers)}" alt="Trabalhe conosco HLab Vet"></div>`:`<div class="public-careers-art"><div>HLAB VET</div><span>Talento + cuidado + ciência</span></div>`}</div></section>
        <section id="contato" class="public-section public-contact-section public-site-tab-panel" data-public-panel="contato"><div class="public-section-head"><span>CONTATO</span><h2>Fale com o HLab Vet</h2></div>${tabImages.contact?`<div class="public-tab-banner"><img src="${esc(tabImages.contact)}" alt="Contato HLab Vet"></div>`:''}<div class="public-contact-grid">${phone?`<a href="${wa}" target="_blank"><b>WhatsApp</b><span>${esc(st.whatsappPhone)}</span></a>`:''}${st.contactEmail?`<a href="mailto:${esc(st.contactEmail)}"><b>E-mail</b><span>${esc(st.contactEmail)}</span></a>`:''}<a href="#acompanhamento" data-public-tab="acompanhamento"><b>Acompanhar exame</b><span>Andamento e resultados usando seu telefone</span></a><a href="/"><b>Área do cliente</b><span>Painel completo quando liberado pelo laboratório</span></a></div></section>
      </main><footer class="public-site-footer"><img src="/assets/hlabvet-logo.png"><span>${esc(st.companyName||'HLab Vet Resultados')}</span><small>Diagnósticos veterinários • ${new Date().getFullYear()}</small></footer>${phone?`<a class="public-floating-whatsapp" href="${wa}" target="_blank" rel="noopener" aria-label="Abrir WhatsApp">${publicWhatsappIcon()}</a>`:''}${popupOffer?`<div class="public-promo-popup" id="publicPromoPopup"><div class="public-promo-card"><button type="button" class="public-promo-close" id="publicPromoClose" aria-label="Fechar propaganda">×</button><div class="public-promo-media">${popupOffer.imageUrl?`<img src="${esc(popupOffer.imageUrl)}" alt="${esc(popupOffer.title)}">`:`<img src="/assets/hlabvet-logo.png" alt="HLab Vet">`}</div><div class="public-promo-copy">${popupOffer.badge?`<span>${esc(popupOffer.badge)}</span>`:''}<h2>${esc(popupOffer.title)}</h2><p>${esc(popupOffer.description||'')}</p>${popupOffer.promo_price_cents!=null?`<div class="public-promo-price">${popupOffer.price_cents!=null?`<del>${fmtMoney(popupOffer.price_cents)}</del>`:''}<strong>${fmtMoney(popupOffer.promo_price_cents)}</strong></div>`:''}${phone?`<a class="public-cta primary" href="${wa}?text=${encodeURIComponent(`Olá! Gostaria de saber mais sobre ${popupOffer.title}.`)}" target="_blank">${esc(popupOffer.button_text||'Quero saber mais')}</a>`:''}<small class="public-promo-countdown">Fecha automaticamente em <b id="publicPromoCountdown">${Math.max(1,Number(popupOffer.popup_seconds||5))}</b>s</small></div></div></div>`:''}</div>`;

    const publicPanels=$$('[data-public-panel]'),publicTabs=$$('[data-public-tab]');
    const openPublicTab=(name,{updateUrl=true,smooth=false}={})=>{const valid=publicPanels.some(x=>x.dataset.publicPanel===name);name=valid?name:'home';publicPanels.forEach(x=>x.classList.toggle('active',x.dataset.publicPanel===name));publicTabs.forEach(x=>x.classList.toggle('active',x.dataset.publicTab===name));if(updateUrl){const hash=name==='home'?'':`#${name}`;history.replaceState(null,'',`${location.pathname}${hash}`)}window.scrollTo({top:0,behavior:smooth?'smooth':'auto'});};
    publicTabs.forEach(x=>x.addEventListener('click',e=>{e.preventDefault();openPublicTab(x.dataset.publicTab,{updateUrl:true,smooth:true})}));
    const hashMap={inicio:'home',home:'home',cotacao:'cotacao',acompanhamento:'acompanhamento',servicos:'servicos',parceiros:'parceiros',localizacao:'localizacao',trabalhe:'trabalhe',contato:'contato'};
    openPublicTab(focusQuote?'cotacao':(hashMap[location.hash.replace('#','')]||'home'),{updateUrl:false});

    if(popupOffer&&$('#publicPromoPopup')){const popup=$('#publicPromoPopup'),closeBtn=$('#publicPromoClose'),count=$('#publicPromoCountdown');let remaining=Math.max(1,Number(popupOffer.popup_seconds||5)),closed=false;const closePromo=()=>{if(closed)return;closed=true;popup.classList.add('closing');setTimeout(()=>popup.remove(),220)};closeBtn?.addEventListener('click',closePromo);const timer=setInterval(()=>{remaining--;if(count)count.textContent=Math.max(0,remaining);if(remaining<=0){clearInterval(timer);closePromo()}},1000);}

    const showTracking=async data=>{$('#publicTrackingResults').innerHTML=publicTrackingHtml(data);$('#publicTrackRefresh')?.classList.remove('hidden');bindPublicResultButtons($('#publicTrackingResults'));};
    $('#publicTrackButton')?.addEventListener('click',async()=>{const p=$('#publicTrackPhone').value.trim();if(!p)return toast('Informe seu WhatsApp com DDD.','error');const b=$('#publicTrackButton');b.disabled=true;b.textContent='CONSULTANDO...';try{await showTracking(await api('/api/public/customer-lookup',{json:{phone:p}}))}catch(e){$('#publicTrackingResults').innerHTML=`<div class="warning-box">${esc(e.message)}</div>`}finally{b.disabled=false;b.textContent='CONSULTAR'}});
    $('#publicTrackRefresh')?.addEventListener('click',async()=>{try{await showTracking(await api('/api/public/customer-status'))}catch(e){toast(e.message,'error')}});

    if(site.quote?.enabled&&quoteData){
      const selectedItems=()=>({examCodes:$$('[data-public-exam]:checked').map(x=>x.dataset.publicExam),services:$$('[data-public-service]:checked').map(x=>({id:Number(x.dataset.publicService),quantity:1}))});
      const update=()=>{let n=0,total=0;$$('[data-public-exam]:checked').forEach(x=>{n++;total+=Number(x.dataset.price||0)});$$('[data-public-service]:checked').forEach(x=>{n++;total+=Number(x.dataset.price||0)});$('#publicQuoteCount').textContent=n;if($('#publicQuoteTotal'))$('#publicQuoteTotal').textContent=fmtMoney(total)};
      $$('[data-public-exam],[data-public-service]').forEach(x=>x.addEventListener('change',update));
      $('#publicQuoteSearch')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase().trim();$$('.public-exam-line[data-search]').forEach(x=>x.classList.toggle('hidden',q&&!x.dataset.search.includes(q)))});
      $('#publicQuoteSubmit')?.addEventListener('click',async()=>{
        const name=$('#publicQuoteName').value.trim(),p=$('#publicQuotePhone').value.trim(),patient=$('#publicQuotePatient').value.trim(),birthDate=$('#publicQuoteBirth').value,sel=selectedItems();
        if(!name)return toast('Informe o nome do tutor ou responsável.','error');if(!p)return toast('Informe seu WhatsApp.','error');if(!patient)return toast('Informe o nome do animal.','error');if(!birthDate)return toast('Informe a data de nascimento do animal.','error');if(!sel.examCodes.length&&!sel.services.length)return toast('Selecione pelo menos um exame ou serviço.','error');
        const b=$('#publicQuoteSubmit');b.disabled=true;b.textContent='ENVIANDO...';
        try{
          const r=await api('/api/public/quotes',{json:{name,phone:p,email:$('#publicQuoteEmail').value,patientName:patient,birthDate,...sel}}),q=r.quote;
          $('#publicQuoteSuccess').innerHTML=`<div class="public-quote-success"><b>✓ Cotação enviada</b><span>${esc(q.quote_number)} • ${fmtMoney(q.total_cents)}</span><small>Seu cadastro e o animal foram registrados pelo telefone informado. Se deseja realizar os exames, confirme abaixo o local da coleta.</small><div class="actions"><button class="btn ghost small" id="publicQuotePrint">PDF / Imprimir</button>${phone?`<a class="btn secondary small" href="${wa}?text=${encodeURIComponent(`Olá! Acabei de enviar a cotação ${q.quote_number} pelo site HLab Vet.`)}" target="_blank">WhatsApp</a>`:''}<button class="btn primary small" id="publicQuoteConfirmOpen">QUERO REALIZAR OS EXAMES</button></div><div class="public-confirm-request hidden" id="publicConfirmRequest"><h4>Confirmar solicitação e coleta</h4><label>Endereço completo para coleta<input id="publicCollectionAddress" value="${esc(q.site_customer_address||q.customerAddress||'')}" placeholder="Rua, número, bairro e complemento"></label><label>Localização do Google Maps (opcional)<input id="publicCollectionMap" placeholder="https://maps.app.goo.gl/..."></label><button class="public-submit-quote" id="publicConfirmRequestBtn" type="button">ENVIAR SOLICITAÇÃO AO LABORATÓRIO</button></div></div>`;
          $('#publicQuotePrint')?.addEventListener('click',()=>printQuote(q));
          $('#publicQuoteConfirmOpen')?.addEventListener('click',()=>$('#publicConfirmRequest')?.classList.remove('hidden'));
          $('#publicConfirmRequestBtn')?.addEventListener('click',async()=>{const address=$('#publicCollectionAddress').value.trim();if(!address)return toast('Informe o endereço onde o material será coletado.','error');const btn=$('#publicConfirmRequestBtn');btn.disabled=true;btn.textContent='ENVIANDO SOLICITAÇÃO...';try{const req=await api(`/api/public/quotes/${q.id}/confirm`,{json:{collectionAddress:address,collectionMapUrl:$('#publicCollectionMap').value}});$('#publicConfirmRequest').innerHTML=`<div class="public-request-created"><b>✓ Solicitação criada</b><strong>${esc(req.protocol)}</strong><span>Ela já está na tela de Solicitações do HLab Vet e seguirá o fluxo normal de coleta, recebimento, análise e resultado.</span><button class="btn primary" id="goPublicTracking" type="button">ACOMPANHAR ANDAMENTO</button></div>`;$('#goPublicTracking')?.addEventListener('click',async()=>{openPublicTab('acompanhamento',{updateUrl:true,smooth:true});$('#publicTrackPhone').value=p;$('#publicTrackButton')?.click()})}catch(e){toast(e.message,'error');btn.disabled=false;btn.textContent='ENVIAR SOLICITAÇÃO AO LABORATÓRIO'}});
          b.textContent='COTAÇÃO ENVIADA';
        }catch(e){toast(e.message,'error');b.disabled=false;b.textContent='ENVIAR COTAÇÃO AO HLAB VET'}
      });
      update();
    }
  }catch(e){$('#courierView').innerHTML=`<div class="public-site-offline"><img src="/assets/hlabvet-logo.png"><h1>Não foi possível abrir o site</h1><p>${esc(e.message)}</p><a href="/" class="btn primary">Área do cliente</a></div>`}
}

async function boot(){
  const publicPath=location.pathname.replace(/\/+$/,'');
  if(publicPath==='/site')return renderPublicWebsite(false);
  if(publicPath==='/orcamento')return renderPublicWebsite(true);
  if(ownerPath()) return ownerBoot();
  const params=new URLSearchParams(location.search);
  const token=params.get('entregador');
  if(token)return renderCourierPortal(token);
  if(params.get('courier')==='1'){
    try{
      const r=await api('/api/courier/me');
      if(r.courier?.forcePasswordChange)return showCourierPasswordChange(true);
      return renderCourierPortal(null);
    }catch{return showCourierLogin();}
  }
  try { state.catalog=(await api('/api/catalog')).exams; } catch {}
  try { const r=await api('/api/me'); state.me=r.user; state.profile=r.profile; showApp(); }
  catch { showLogin(); }
}
function ensureCourierAccessButton(){
  if($('#courierAccessBtn'))return;
  const form=$('#loginForm');if(!form)return;
  form.insertAdjacentHTML('afterend',`<button id="courierAccessBtn" type="button" class="btn ghost" style="width:100%;margin-top:10px">Acesso do entregador</button>`);
  $('#courierAccessBtn').addEventListener('click',()=>{history.replaceState(null,'',`${location.pathname}?courier=1`);showCourierLogin()});
}
function showLogin(){
  document.body.classList.remove('courier-mobile-mode');
  $('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden');$('#courierView').classList.add('hidden');
  ensureCourierAccessButton();
}
function showCourierLogin(){
  stopLabAlerts();state.me=null;
  $('#loginView').classList.add('hidden');$('#appView').classList.add('hidden');$('#courierView').classList.remove('hidden');
  document.body.classList.add('courier-mobile-mode');
  $('#courierView').innerHTML=`<div class="auth-shell"><section class="auth-card"><div class="brand-lockup"><img src="/assets/hlabvet-logo.png" alt="HLabVet"><div><h1>HLabVet Entregador</h1><p>Acesse suas coletas atribuídas.</p></div></div><form id="courierLoginForm" class="stack"><label>Usuário<input name="username" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="current-password" required></label><button class="btn primary" type="submit">Entrar</button></form><button id="backMainLogin" type="button" class="btn ghost" style="width:100%;margin-top:10px">Voltar ao acesso do laboratório</button><footer>Acesso exclusivo do entregador HLabVet</footer></section></div>`;
  $('#backMainLogin').addEventListener('click',()=>{history.replaceState(null,'',location.pathname);showLogin()});
  $('#courierLoginForm').addEventListener('submit',async e=>{
    e.preventDefault();unlockAudio();const body=Object.fromEntries(new FormData(e.currentTarget));
    try{
      const r=await api('/api/courier/login',{json:body});
      if(r.forcePasswordChange)return showCourierPasswordChange(true);
      history.replaceState(null,'',`${location.pathname}?courier=1`);await renderCourierPortal(null);toast('Acesso realizado.');
    }catch(er){toast(er.message,'error')}
  });
}
async function showCourierPasswordChange(force=true){
  $('#loginView').classList.add('hidden');$('#appView').classList.add('hidden');$('#courierView').classList.remove('hidden');
  document.body.classList.add('courier-mobile-mode');
  $('#courierView').innerHTML=`<div class="auth-shell"><section class="auth-card"><div class="brand-lockup"><img src="/assets/hlabvet-logo.png" alt="HLabVet"><div><h1>${force?'Troque sua senha':'Alterar senha'}</h1><p>${force?'No primeiro acesso, defina sua senha pessoal.':'Atualize sua senha de acesso.'}</p></div></div><form id="courierPasswordForm" class="stack"><label>Senha atual<input name="currentPassword" type="password" required></label><label>Nova senha<input name="newPassword" type="password" minlength="8" required></label><label>Confirmar nova senha<input name="confirmPassword" type="password" minlength="8" required></label><button class="btn primary" type="submit">Salvar nova senha</button>${force?'':`<button class="btn ghost" type="button" data-back-courier>Voltar</button>`}</form></section></div>`;
  $('[data-back-courier]')?.addEventListener('click',()=>renderCourierPortal(null));
  $('#courierPasswordForm').addEventListener('submit',async e=>{
    e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));
    if(b.newPassword!==b.confirmPassword)return toast('A confirmação da nova senha não confere.','error');
    try{const r=await api('/api/courier/change-password',{json:{currentPassword:b.currentPassword,newPassword:b.newPassword}});toast(r.message);history.replaceState(null,'',`${location.pathname}?courier=1`);await renderCourierPortal(null)}catch(er){toast(er.message,'error')}
  });
}
async function courierLogout(){
  try{await api('/api/courier/logout',{method:'POST'})}catch{}
  location.href=`${location.pathname}?courier=1`;
}
async function showApp(){
  $('#loginView').classList.add('hidden');$('#courierView').classList.add('hidden');$('#appView').classList.remove('hidden');
  const roleLabel=state.me.role==='client'?'Cliente HLabVet':state.me.role==='staff'?(state.me.internalProfileType==='seller'?'Vendedor HLabVet':state.me.internalProfileType==='other'?'Equipe HLabVet':'Técnico HLabVet'):state.me.role==='tutor'?'Tutor / Cliente Final':'Administrador HLab Vet';
  $('#sideUser').innerHTML=`<strong>${esc(state.me.tutorName||state.me.technicianName||state.me.clientName||state.me.username)}</strong><small>${roleLabel}</small>`;
  renderNav();startLabAlerts();
  if(state.me.forcePasswordChange) return showPasswordChange(true);
  navigate(state.me.role==='tutor'?'tutor-results':'dashboard');
}

$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();unlockAudio();const f=new FormData(e.currentTarget);try{await api('/api/login',{json:Object.fromEntries(f)});const m=await api('/api/me');state.me=m.user;state.profile=m.profile;showApp();toast('Acesso realizado.');}catch(err){toast(err.message,'error')}});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'})}catch{} stopLabAlerts();state.me=null;history.replaceState(null,'',location.pathname);showLogin();});

function renderNav(){
  let items;
  if(state.me.role==='client'){
    items=[['dashboard','⌂','Painel'],['quotes','R$','Orçamento'],['new-request','＋','Nova solicitação'],['requests','▣','Meus exames'],['tutors','🐾','Tutores / clientes finais']];
    if(state.me.canManageClientUsers)items.push(['client-users','♙','Usuários / técnicos']);
    items.push(['password','⚿','Alterar senha']);
  }
  else if(state.me.role==='tutor') items=[
    ['tutor-results','▣','Meus resultados'],['password','⚿','Alterar senha']
  ];
  else if(state.me.role==='staff'){
    items=[['dashboard','⌂','Painel'],['requests','▣','Solicitações'],['exam-timing','◷','Tempo de exames'],['cancellations','×','Cancelamentos'],['clients','♙','Clientes'],['couriers','➜','Entregadores'],['receivers','✓','Equipe interna']];
    if(state.me.canViewPrices)items.push(['prices','R$','Preços']);
    if(state.me.canMakeQuotes){items.push(['quotes','▧','Orçamentos']);items.push(['site','◉','Site']);}
    items.push(['temperature','▤','Temperaturas'],['password','⚿','Alterar senha']);
  }
  else items=[
    ['dashboard','⌂','Painel'],['requests','▣','Solicitações'],['exam-timing','◷','Tempo de exames'],['cancellations','×','Cancelamentos'],['clients','♙','Clientes'],['couriers','➜','Entregadores'],['receivers','✓','Equipe interna'],['prices','R$','Preços'],['quotes','▧','Orçamentos'],['site','◉','Site'],['finance','▦','Financeiro'],['temperature','▤','Temperaturas'],['password','⚿','Alterar senha']
  ];
  $('#nav').innerHTML=items.map(([id,ic,label])=>`<button class="nav-btn" data-page="${id}"><span>${ic}</span>${label}</button>`).join('');
  $$('.nav-btn').forEach(b=>b.addEventListener('click',()=>{navigate(b.dataset.page);$('.sidebar').classList.remove('open')}));
}

async function navigate(page){
  const previousPage=state.page;
  if(page==='exam-timing' && previousPage && previousPage!=='exam-timing') state.timingReturnPage=previousPage;
  state.page=page; $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); $('#topActions').innerHTML='';
  const map={dashboard:['Painel','Visão geral do atendimento'],requests:[state.me.role==='client'?'Meus exames':'Solicitações','Pesquise por período, animal, tutor, raça e outros dados'],'exam-timing':['Tempo de exames','Prazos contados a partir do recebimento da amostra no laboratório'],cancellations:['Cancelamentos','Solicitações canceladas e motivo'],clients:['Clientes','Cadastros e acessos dos clientes'],couriers:['Entregadores','Painel móvel, login próprio e termômetros'],receivers:['Equipe interna','Técnicos, vendedores e outros usuários internos com permissões individuais'],prices:['Preços dos exames e serviços','Tabela geral de exames, valores específicos por cliente e serviços adicionais'],quotes:['Orçamentos','Monte, salve e imprima orçamentos profissionais'],site:['Site','Página pública, promoções, produtos e serviços'],finance:['Financeiro','Ranking de clientes e espelho detalhado para cobrança'],temperature:['Controle de temperatura','Fichas mensais de envio e recebimento'],password:['Alterar senha','A senha diferencia maiúsculas e minúsculas'],'client-users':['Usuários / técnicos','Cadastre acessos da clínica; carimbo é opcional e automático para técnicos'],tutors:['Tutores / clientes finais','Cadastre quem poderá acessar somente os próprios resultados'],'tutor-results':['Meus resultados','Visualize, baixe ou imprima somente os seus exames liberados'],'new-request':['Nova solicitação','Requisição de exames veterinários']};
  $('#pageTitle').textContent=map[page]?.[0]||'HLab Vet';$('#pageSubtitle').textContent=map[page]?.[1]||'';
  const fn={dashboard:renderDashboard,requests:renderRequests,'exam-timing':renderExamTiming,cancellations:renderCancellations,clients:renderClients,couriers:renderCouriers,receivers:renderReceivers,prices:renderPrices,quotes:renderQuotes,site:renderSiteManager,finance:renderFinance,temperature:renderTemperature,'client-users':renderClientUsers,tutors:renderTutors,'tutor-results':renderTutorResults,password:()=>showPasswordChange(false),'new-request':renderNewRequest}[page];
  try{await fn?.()}catch(e){if(e.status===428)return showPasswordChange(true);$('#content').innerHTML=`<div class="card empty-state">${esc(e.message)}</div>`;toast(e.message,'error')}
}

function chartBarList(items,{status=false}={}){
  if(!items?.length)return '<div class="chart-empty">Sem dados no período.</div>';
  const max=Math.max(...items.map(x=>Number(x.n||0)),1);
  return `<div class="mini-bars">${items.map(x=>{const label=status?(STATUS[x.status]||x.status):x.label;const pct=Math.max(3,Math.round(Number(x.n||0)/max*100));return `<div class="mini-bar-row"><div class="mini-bar-label"><span>${esc(label||'—')}</span><b>${Number(x.n||0)}</b></div><div class="mini-bar-track"><i style="width:${pct}%"></i></div></div>`}).join('')}</div>`;
}
function dailyLineChart(items){
  if(!items?.length)return '<div class="chart-empty">Sem dados no período.</div>';
  const vals=items.map(x=>Number(x.n||0)),max=Math.max(...vals,1),w=640,h=170,pad=18;
  const pts=vals.map((v,i)=>{const x=pad+(w-pad*2)*(i/Math.max(vals.length-1,1)),y=h-pad-(h-pad*2)*(v/max);return [x,y]});
  const poly=pts.map(p=>p.join(',')).join(' '),area=`${pad},${h-pad} ${poly} ${w-pad},${h-pad}`;
  return `<div class="line-chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Solicitações nos últimos 14 dias"><polygon class="line-area" points="${area}"></polygon><polyline class="line-stroke" points="${poly}"></polyline>${pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.5"><title>${items[i].day}: ${vals[i]}</title></circle>`).join('')}</svg><div class="line-labels"><span>${fmtDate(items[0].day)}</span><span>${fmtDate(items[items.length-1].day)}</span></div></div>`;
}
function labChartsHtml(c){
  if(!c)return '';
  return `<section class="dashboard-charts"><article class="card chart-wide"><div class="chart-head"><div><h3>Movimento dos últimos 14 dias</h3><p>Solicitações não canceladas por dia.</p></div></div>${dailyLineChart(c.daily||[])}</article><article class="card"><div class="chart-head"><div><h3>Status • 30 dias</h3><p>Visão rápida do fluxo.</p></div></div>${chartBarList((c.status30||[]).filter(x=>x.status!=='cancelado'),{status:true})}</article><article class="card"><div class="chart-head"><div><h3>Exames mais solicitados</h3><p>Últimos 30 dias.</p></div></div>${chartBarList(c.topExams||[])}</article><article class="card"><div class="chart-head"><div><h3>Clientes mais ativos</h3><p>Últimos 30 dias.</p></div></div>${chartBarList(c.topClients||[])}</article></section>`;
}
async function renderDashboard(){
  if(state.me.role==='tutor')return navigate('tutor-results');
  const d=await api('/api/dashboard'),t=d.totals||{},lab=['admin','staff'].includes(state.me.role);
  $('#content').innerHTML=`<div class="grid cards">
    ${metric('Solicitados hoje',t.solicitado||0)}${metric('Em coleta hoje',(t.atribuido||0)+(t.coletado||0))}${metric('Em análise hoje',(t.recebido||0)+(t.em_analise||0))}${metric('Concluídos hoje',t.concluido||0)}
  </div>${lab?labChartsHtml(d.charts):''}<div class="card" style="margin-top:16px"><div class="section-title"><div><h3>Solicitações de hoje</h3><p>Outros dias aparecem somente quando você filtrar em Solicitações.</p></div></div>${requestTable(d.recent||[],false)}</div>`;
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

function priorityBadge(value){const v=value||'normal';const label=v==='urgent'?'Urgente':v==='priority'?'Prioridade':'Normal';return `<span class="priority-pill ${v}">${label}</span>`}
function requestTable(rows,actions=true){
  if(!rows.length)return `<div class="empty-state">Nenhuma solicitação encontrada.</div>`;
  const client=state.me?.role==='client';
  return `<div class="table-wrap"><table><thead><tr><th>Protocolo</th>${!client?'<th>Cliente</th>':''}<th>Animal</th><th>Prioridade</th><th>Tutor</th><th>Status</th><th>Tipo</th><th>Data</th>${client?'<th>Resultado</th>':''}${actions&&!client?'<th>Ações</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr><td><button class="link-btn" data-detail="${r.id}"><strong>${esc(r.protocol)}</strong></button></td>${!client?`<td>${esc(r.client_name||'')}</td>`:''}<td>${esc(r.patient_name||'')}</td><td>${priorityBadge(r.priority)}</td><td>${esc(r.tutor_name||'')}</td><td><span class="badge ${r.status}">${esc(STATUS[r.status]||r.status)}</span>${!client&&r.status==='solicitado'&&!r.accepted_at?'<br><small class="pending-accept">Aguardando aceite</small>':''}</td><td>${r.request_kind==='scheduled'?`<span class="badge scheduled">Agendada</span><br><small>${fmtDateTime(r.scheduled_at)}</small>`:'Imediata'}</td><td>${fmtDateTime(r.created_at)}</td>${client?`<td class="result-cell"><button class="result-eye ${Number(r.result_count)>0?'ready':'pending'}" data-result-eye="${r.id}" data-has-result="${Number(r.result_count)>0?1:0}" title="${Number(r.result_count)>0?'Resultado disponível':'Resultado ainda não disponível'}">👁</button></td>`:''}${actions&&!client?`<td><div class="actions"><button class="btn soft small" data-detail="${r.id}">Abrir</button>${state.me.role==='admin'?`<button class="btn ghost small" data-print-one="${r.id}">Imprimir/PDF</button>`:''}</div></td>`:''}</tr>`).join('')}</tbody></table></div>`;
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
    modal(`<div class="detail-head"><div><h3>Resultado • ${esc(r.patient_name)}</h3><p class="muted">${esc(r.protocol)} • ${esc(r.client_name)}</p></div></div><h4>Exames solicitados</h4><div>${d.exams.map(x=>`<span class="badge" style="margin:2px">${esc(x.exam_name)}</span>`).join('')}</div><h4 style="margin-top:18px">Arquivos de resultado</h4>${resultFilesHtml(d.files,true,false,true)}<div class="actions" style="margin-top:16px"><button class="btn ghost" data-close-modal>Fechar</button></div>`);
    bindResultFileButtons($('#modalContent'),async()=>{closeModal();await openRequest(id)});
  $('[data-print-quote-detail]')?.addEventListener('click',()=>printQuoteById(Number($('[data-print-quote-detail]').dataset.printQuoteDetail)));
  $('[data-share-quote-detail]')?.addEventListener('click',()=>shareQuoteWhatsApp(Number($('[data-share-quote-detail]').dataset.shareQuoteDetail)));
  $('[data-edit-request-quote]')?.addEventListener('click',()=>{state.quoteRequisitionId=id;closeModal();navigate('quotes')});
  }catch(e){toast(e.message,'error')}
}

async function renderNewRequest(){
  const pendingQuote=state.pendingQuote||null;
  const quoteSelected=new Set(pendingQuote?.examCodes||[]);
  if(!state.catalog)state.catalog=(await api('/api/catalog')).exams;
  if(state.me.role!=='client')await loadAdminLists();
  const profile = state.me.role==='client' ? (await api('/api/my-client-profile')).profile : null;
  const tutorData = state.me.role==='client' ? await api('/api/tutors') : {tutors:[]};
  const tutors=tutorData.tutors||[];
  const loggedClientTech=state.me.role==='client'&&state.me.clientIsTechnician;
  const vetDefault=loggedClientTech?(state.me.clientMemberName||state.me.username):'';
  const crmvDefault=loggedClientTech?[state.me.clientCouncil||'CRMV',state.me.clientCouncilState,state.me.clientCouncilNumber].filter(Boolean).join(' '):'';
  $('#content').innerHTML=`<form id="newReqForm" class="stack">
    ${state.me.role!=='client'?`<div class="form-card"><h4>Cliente solicitante</h4><div class="form-grid"><label class="field span2">Cliente<select name="clientId" required><option value="">Selecione</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div></div>`:''}
    <div class="form-card"><h4>Tipo de solicitação</h4><div class="form-grid"><label class="field"><span>Atendimento</span><select name="requestKind" id="requestKind"><option value="immediate">Solicitar agora</option><option value="scheduled">Agendar coleta</option></select></label><label class="field"><span>Prioridade</span><select name="priority"><option value="normal">Normal</option><option value="priority">Prioridade</option><option value="urgent">Urgente</option></select></label><label class="field hidden" id="scheduledWrap">Data e hora agendada<input name="scheduledAtLocal" id="scheduledAtLocal" type="datetime-local"></label></div><p class="muted">A prioridade ajuda o laboratório a organizar a fila. O prazo técnico de cada exame começa somente quando a amostra é recebida no laboratório.</p></div>
    <div class="form-card"><h4>Dados da requisição</h4><div class="form-grid">
      <label class="field span2">Clínica / estabelecimento<input name="clinicName" value="${esc(profile?.name||'')}" placeholder="Nome da clínica"></label>
      <label class="field">Veterinário / técnico responsável<input name="veterinarianName" value="${esc(vetDefault)}" ${loggedClientTech?'readonly':''}></label><label class="field">CRMV / registro<input name="crmv" value="${esc(crmvDefault)}" ${loggedClientTech?'readonly':''}></label>
      ${state.me.role==='client'?`<label class="field span2">Tutor com acesso ao resultado<select name="tutorAccountId" id="tutorAccountId"><option value="">Sem login vinculado</option>${tutors.filter(t=>t.active).map(t=>`<option value="${t.id}" data-name="${esc(t.name)}">${esc(t.name)}${t.phone?` • ${esc(t.phone)}`:''}</option>`).join('')}</select><small>Se vincular um tutor cadastrado, ele verá somente os resultados desta solicitação.</small></label>`:''}
      <label class="field span2">Nome do tutor<input name="tutorName" id="tutorName"></label><label class="field span2">Paciente / animal<input name="patientName" value="${esc(pendingQuote?.patientName||'')}" required></label>
      <label class="field">Espécie<input name="species" placeholder="Canina, felina..."></label><label class="field">Raça<input name="breed"></label>
      <label class="field">Sexo<select name="sex"><option value="">—</option><option>M</option><option>F</option></select></label><label class="field">Data de nascimento<input name="birthDate" type="date"></label>
      <label class="field">Idade<input name="ageText" id="ageText" placeholder="Ex.: 4 anos"><small id="ageHint" class="muted">Ao informar a data de nascimento, a idade exata será calculada automaticamente.</small></label><label class="field">Data prevista da coleta<input name="collectionDate" id="collectionDate" type="date" value="${today()}"></label><label class="field span4">Localização exata no Google Maps (opcional)<input name="collectionMapUrl" id="collectionMapUrl" type="url" value="${esc(profile?.map_url||'')}" placeholder="https://maps.app.goo.gl/..."><small>Se preenchida, o entregador abre este ponto exato. Se ficar vazio, o sistema usa o endereço cadastrado.</small></label>
      <label class="field span4">Informações clínicas / observações<textarea name="clinicalInfo"></textarea></label>
    </div></div>
    ${state.me.role==='client'?`<div class="form-card client-requester"><h4>Solicitado por</h4><p><strong>${esc(state.me.clientMemberName||state.me.username)}</strong> • ${loggedClientTech?'Técnico — o carimbo será incluído automaticamente':'Usuário comum — sem carimbo'}</p></div>`:''}
    <div class="form-card"><h4>Exames solicitados</h4><div class="checks">${state.catalog.map(g=>`<section class="check-group"><h5>${esc(g.category)}</h5><div class="check-list">${g.items.map(e=>`<label><input type="checkbox" name="exams" value="${e.code}" ${quoteSelected.has(e.code)?'checked':''}><span>${esc(e.name)}</span></label>`).join('')}</div></section>`).join('')}</div></div>
    <div class="form-card"><h4>Material enviado</h4><div class="material-list">${['Sangue total','Soro','Plasma','Urina','Fezes'].map(m=>`<label><input type="checkbox" name="materials" value="${m}"> ${m}</label>`).join('')}</div><label class="field" style="margin-top:12px">Outros materiais<input name="materialOther"></label></div>
    <div class="form-card"><h4>Confirmação</h4><p class="muted">Ao enviar, a solicitação recebe um protocolo e fica disponível ao HLab Vet. O cliente acompanha o andamento e, quando o resultado for anexado, o olho amarelo ficará verde.</p><button class="btn primary" type="submit">Enviar solicitação ao HLab Vet</button></div>
  </form>`;
  const kind=$('#requestKind'),wrap=$('#scheduledWrap'),scheduled=$('#scheduledAtLocal');
  const syncSchedule=()=>{const on=kind.value==='scheduled';wrap.classList.toggle('hidden',!on);scheduled.required=on;if(!on)scheduled.value=''};kind.addEventListener('change',syncSchedule);syncSchedule();
  const reqClientSelect=$('[name="clientId"]'),mapInput=$('#collectionMapUrl');
  const syncClientMap=()=>{if(!reqClientSelect||!mapInput)return;const c=state.clients.find(x=>Number(x.id)===Number(reqClientSelect.value));mapInput.value=c?.map_url||'';};
  reqClientSelect?.addEventListener('change',syncClientMap);syncClientMap();
  const tutorSelect=$('#tutorAccountId'),tutorName=$('#tutorName');
  tutorSelect?.addEventListener('change',()=>{const opt=tutorSelect.selectedOptions[0];if(tutorSelect.value&&opt?.dataset.name){tutorName.value=opt.dataset.name;tutorName.readOnly=true}else tutorName.readOnly=false});
  const birthInput=$('[name="birthDate"]'),ageInput=$('#ageText'),collectionInput=$('#collectionDate'),ageHint=$('#ageHint');
  const syncAge=()=>{
    const birth=birthInput?.value||'',reference=collectionInput?.value||today();
    if(!birth){
      if(ageInput?.dataset.autoAge==='1')ageInput.value='';
      if(ageInput){ageInput.readOnly=false;delete ageInput.dataset.autoAge}
      if(ageHint)ageHint.textContent='Ao informar a data de nascimento, a idade exata será calculada automaticamente.';
      birthInput?.setCustomValidity('');
      return;
    }
    const age=exactAgeText(birth,reference);
    if(!age){
      if(ageInput){ageInput.value='';ageInput.readOnly=false;delete ageInput.dataset.autoAge}
      birthInput?.setCustomValidity('A data de nascimento não pode ser posterior à data prevista da coleta.');
      if(ageHint)ageHint.textContent='Confira a data de nascimento e a data prevista da coleta.';
      return;
    }
    birthInput?.setCustomValidity('');
    if(ageInput){ageInput.value=age;ageInput.readOnly=true;ageInput.dataset.autoAge='1'}
    if(ageHint)ageHint.textContent=`Idade calculada na data prevista da coleta: ${age}.`;
  };
  birthInput?.addEventListener('input',syncAge);
  birthInput?.addEventListener('change',syncAge);
  collectionInput?.addEventListener('input',syncAge);
  collectionInput?.addEventListener('change',syncAge);
  syncAge();
  $('#newReqForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body=Object.fromEntries(f);body.exams=f.getAll('exams');body.materials=f.getAll('materials');if(pendingQuote?.quoteId)body.quoteId=pendingQuote.quoteId;body.requestKind=f.get('requestKind')||'immediate';if(body.requestKind==='scheduled'){const local=f.get('scheduledAtLocal');if(!local)return toast('Informe a data e hora do agendamento.','error');body.scheduledAt=new Date(local).toISOString()}delete body.scheduledAtLocal;try{const r=await api('/api/requisitions',{json:body});toast(`${r.message} Protocolo ${r.protocol}`);state.pendingQuote=null;navigate('requests')}catch(err){toast(err.message,'error')}});
}

async function openRequest(id,opts={}){
  const d=await api(`/api/requisitions/${id}`),r=d.requisition;
  const lab=['admin','staff'].includes(state.me.role); if(lab) await loadAdminLists();
  const actions=lab?adminRequestActions(r,d.quote):'';
  const clientCanCancel=state.me.role==='client'&&!r.collected_at&&['solicitado','atribuido'].includes(r.status);
  const resultHtml=resultFilesHtml(d.files,true,lab,state.me.role==='client');
  const clientCanDeleteExam=state.me.role==='client'&&r.status==='solicitado'&&!r.accepted_at;
  const labCanDeleteExam=state.me.role!=='client'&&!['concluido','cancelado'].includes(r.status);
  const canDeleteExam=clientCanDeleteExam||labCanDeleteExam;
  const examsHtml=d.exams.map(x=>`<span class="exam-chip"><span class="badge">${esc(x.exam_name)}</span>${lab&&x.due_at?`<small class="exam-time-inline ${x.completed_at?(x.completed_within_sla===0?'late':'done'):(new Date(x.due_at).getTime()<Date.now()?'late':'')}">${x.completed_at?'Concluído':`Prazo ${fmtDateTime(x.due_at)}`}</small>`:''}${canDeleteExam&&d.exams.length>1?`<button class="exam-remove" type="button" data-delete-exam="${x.id}" title="Excluir este exame">×</button>`:''}</span>`).join('');
  modal(`<div class="detail-head"><div><h3>${esc(r.protocol)} • ${esc(r.patient_name)}</h3><p class="muted">${esc(r.client_name)} • criado em ${fmtDateTime(r.created_at)}${r.request_kind==='scheduled'?` • agendado para ${fmtDateTime(r.scheduled_at)}`:''}</p></div><span class="badge ${r.status}">${esc(STATUS[r.status])}</span></div>
    <div class="detail-cols"><div>
      <dl class="kv"><dt>Paciente</dt><dd>${esc(r.patient_name)}</dd><dt>Espécie / raça</dt><dd>${esc([r.species,r.breed].filter(Boolean).join(' • '))||'—'}</dd><dt>Nascimento / idade</dt><dd>${esc(r.birth_date?fmtDate(r.birth_date):'—')} ${esc(r.age_text||exactAgeText(r.birth_date,r.collection_date||today()))}</dd><dt>Tutor</dt><dd>${esc(r.tutor_name||'—')}</dd><dt>Veterinário / CRMV</dt><dd>${esc([r.veterinarian_name,r.crmv].filter(Boolean).join(' • '))||'—'}</dd><dt>Tipo</dt><dd>${r.request_kind==='scheduled'?`Agendada • ${fmtDateTime(r.scheduled_at)}`:'Imediata'}</dd><dt>Prioridade</dt><dd>${priorityBadge(r.priority)}</dd><dt>Aceite do laboratório</dt><dd>${r.accepted_at?`${fmtDateTime(r.accepted_at)} • ${esc(r.accepted_by_name||'HLab Vet')}`:'Aguardando aceite'}</dd><dt>Coleta</dt><dd>${fmtDateTime(r.collected_at)} ${r.collection_temperature!=null?`• ${esc(r.collection_temperature)} °C`:''}</dd><dt>Entregador / termômetro</dt><dd>${esc([r.transport_courier_name||r.courier_name,r.transport_thermometer_code].filter(Boolean).join(' • '))||'—'}</dd><dt>Responsável no envio</dt><dd>${esc(r.sent_by_name||'—')}</dd><dt>Local do envio</dt><dd>${esc(r.sent_from_location||'—')}</dd><dt>Recebimento</dt><dd>${fmtDateTime(r.lab_received_at)} ${r.lab_received_temperature!=null?`• ${esc(r.lab_received_temperature)} °C`:''}</dd><dt>Técnico</dt><dd>${esc(r.receiver_name||'—')}</dd><dt>Local do recebimento</dt><dd>${esc(r.received_location||'—')}</dd><dt>Observação do recebimento</dt><dd>${esc(r.receiving_observation||'—')}</dd></dl>
      <h4>Exames</h4><div class="exam-list">${examsHtml}</div>${canDeleteExam&&d.exams.length===1?'<p class="muted">A solicitação precisa manter pelo menos um exame. Para substituir o único exame, cancele esta solicitação e faça outra.</p>':''}
      <h4>Material enviado</h4><p>${d.materials.map(esc).join(', ')||'—'} ${r.material_other?`• ${esc(r.material_other)}`:''}</p>
      <h4>Informações clínicas</h4><p>${esc(r.clinical_info||'—')}</p>
      <h4>Orçamento</h4><div>${quoteSummaryHtml(d.quote,state.me.role)}</div>
      <h4>Resultados</h4><div>${resultHtml}</div>
    </div><div><h4>Andamento em tempo real</h4><div class="timeline">${d.events.map(e=>`<div class="timeline-item"><div class="timeline-dot"></div><div><strong>${esc(STATUS[e.status]||e.status)}</strong><p>${fmtDateTime(e.created_at)} • ${esc(e.actor_name||'Sistema')}</p>${eventDetails(e.details)}</div></div>`).join('')}</div>${actions}</div></div>
    <div class="actions" style="margin-top:18px">${state.me.role==='admin'?'<button class="btn ghost" id="printThis">Imprimir / Salvar em PDF</button>':''}${clientCanCancel?'<button class="btn danger" id="clientCancelBtn">Cancelar solicitação</button>':''}<button class="btn ghost" data-close-modal>Fechar</button></div>`);
  $('#printThis')?.addEventListener('click',()=>printRequisition(d));
  $('#clientCancelBtn')?.addEventListener('click',async()=>{const reason=prompt('Motivo do cancelamento:','Desistência da solicitação');if(reason===null)return;if(!confirm('Confirmar o cancelamento? O laboratório será avisado imediatamente.'))return;try{const x=await api(`/api/requisitions/${id}/cancel`,{json:{reason}});toast(x.message);closeModal();navigate('requests')}catch(e){toast(e.message,'error')}});
  bindResultFileButtons($('#modalContent'),async()=>{closeModal();await openRequest(id)});
  $$('[data-delete-exam]').forEach(b=>b.addEventListener('click',async()=>{
    const examId=Number(b.dataset.deleteExam);
    if(!confirm('Excluir este exame da solicitação?'))return;
    try{const x=await api(`/api/requisitions/${id}/exams/${examId}`,{method:'DELETE'});toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}
  }));
  if(lab) bindAdminRequestActions(id,r);
  if(opts?.focusResults){
    setTimeout(()=>{
      const input=$('#resultFile');
      if(input){
        const box=input.closest('.form-card');
        box?.classList.add('result-focus-flash');
        input.scrollIntoView({behavior:'smooth',block:'center'});
        setTimeout(()=>box?.classList.remove('result-focus-flash'),1800);
      }
    },80);
  }
}
function eventDetails(d){if(!d)return'';const parts=[];if(d.courier)parts.push(`Entregador: ${d.courier}`);if(d.thermometer)parts.push(`Termômetro: ${d.thermometer}`);if(d.temperature!=null)parts.push(`Temperatura: ${d.temperature} °C`);if(d.receiver)parts.push(`Técnico: ${d.receiver}`);if(d.location)parts.push(`Local: ${d.location}`);if(d.sentBy)parts.push(`Responsável: ${d.sentBy}`);if(d.observation)parts.push(`Obs.: ${d.observation}`);if(d.reason)parts.push(`Motivo: ${d.reason}`);if(d.message)parts.push(d.message);return parts.length?`<p>${esc(parts.join(' • '))}</p>`:''}
function quoteSummaryHtml(q,role){
  if(!q)return (role==='admin'||(role==='staff'&&state.me.canMakeQuotes))?`<div class="quote-empty-inline">Nenhum orçamento vinculado. <button class="btn soft small" data-edit-request-quote>Gerar orçamento</button></div>`:'<span class="muted">Nenhum orçamento vinculado.</span>';
  const buttons=`<div class="actions quote-inline-actions"><button class="btn ghost small" data-print-quote-detail="${q.id}">PDF / Imprimir</button><button class="btn soft small" data-share-quote-detail="${q.id}">WhatsApp</button>${(role==='admin'||(role==='staff'&&state.me.canMakeQuotes))?`<button class="btn secondary small" data-edit-request-quote>Editar orçamento</button>`:''}</div>`;
  return `<div class="quote-inline"><div><strong>${esc(q.quote_number)}</strong><small>${q.patient_name?`Paciente: ${esc(q.patient_name)} • `:''}${q.valid_until?`válido até ${fmtDate(q.valid_until)}`:'sem validade definida'}</small></div><b>${fmtMoney(q.total_cents)}</b></div>${buttons}`;
}
function paymentMethodLabel(v){return v==='credit'?'Crédito':v==='debit'?'Débito':v==='pix'?'PIX':v==='cash'?'Dinheiro':'—'}
function adminRequestActions(r,quote){
  const technicianField=state.me.role==='staff'?`<div class="logged-tech"><small>Técnico responsável pelo recebimento</small><strong>${esc(state.me.technicianName||state.me.username)}</strong></div>`:`<label>Técnico responsável<select id="technicianId"><option value="">Selecione</option>${state.receivers.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`;
  const assignable=['solicitado','atribuido','coletado'].includes(r.status)&&r.accepted_at;
  const adminPayment=(state.me.role==='admin'||state.me.canManagePayments)&&assignable?`<div class="payment-assign-box"><div class="payment-quote-line"><span>Orçamento vinculado</span><strong>${quote?fmtMoney(quote.total_cents):'Não gerado'}</strong></div>${quote?'':`<button class="btn soft small" id="createQuoteBtn" type="button">Gerar orçamento agora</button>`}<label>Situação do pagamento<select id="paymentStatus"><option value="not_set" ${!r.payment_status||r.payment_status==='not_set'?'selected':''}>Sem cobrança pelo entregador</option><option value="paid" ${r.payment_status==='paid'?'selected':''}>Já pago</option><option value="collect" ${r.payment_status==='collect'?'selected':''}>Cobrar na coleta</option></select></label><div id="paymentCollectFields" class="payment-collect-fields"><label>Forma de pagamento<select id="paymentMethod"><option value="pix" ${r.payment_method==='pix'?'selected':''}>PIX</option><option value="debit" ${r.payment_method==='debit'?'selected':''}>Débito</option><option value="credit" ${r.payment_method==='credit'?'selected':''}>Crédito</option><option value="cash" ${r.payment_method==='cash'?'selected':''}>Dinheiro</option></select></label><label id="paymentInstallmentsWrap">Parcelas<input id="paymentInstallments" type="number" min="1" max="24" value="${Number(r.payment_installments||1)}"></label></div></div>`:'';
  return `<div class="form-card" style="margin-top:16px"><h4>Ações HLab Vet</h4><div class="stack compact">
  ${r.status==='solicitado'&&!r.accepted_at?`<button class="btn primary" id="acceptBtn">Aceitar solicitação</button>`:''}
  ${assignable?`<label>Entregador<select id="assignCourier"><option value="">Selecione</option>${state.couriers.filter(c=>c.active).map(c=>`<option value="${c.id}" ${r.assigned_courier_id===c.id?'selected':''}>${esc(c.name)}${c.thermometer_code?` • ${esc(c.thermometer_code)}`:''}</option>`).join('')}</select></label>${adminPayment}<button class="btn secondary" id="assignBtn">Atribuir entregador</button>`:''}
  ${r.status==='coletado'?`${technicianField}<label>Temperatura no recebimento (°C)<input id="receiveTemp" type="number" step="0.1"></label><label>Local do recebimento<input id="receiveLocation" value="${esc(state.me.technicianLocation||'HLab Vet')}"></label><label>Observação<textarea id="receiveObservation" placeholder="Observação do recebimento, se houver"></textarea></label><button class="btn secondary" id="receiveBtn">Dar recebimento</button>`:''}
  ${['recebido','em_analise'].includes(r.status)?`<button class="btn soft" id="analysisBtn">Marcar Em análise</button>`:''}
  ${['recebido','em_analise','concluido'].includes(r.status)?`<label>Enviar resultado(s)<input id="resultFile" type="file" multiple></label><small class="muted">Você pode selecionar mais de um arquivo de uma vez.</small><button class="btn secondary" id="uploadBtn">Enviar arquivo(s)</button>`:''}
  ${['recebido','em_analise'].includes(r.status)?`<button class="btn primary" id="completeBtn">Marcar Concluído</button>`:''}
  ${r.status!=='cancelado'?`<button class="btn danger" id="cancelBtn">Cancelar requisição</button>`:''}
  </div></div>`
}
function bindAdminRequestActions(id,r){
  $('#acceptBtn')?.addEventListener('click',async()=>{unlockAudio();try{const x=await api(`/api/requisitions/${id}/accept`,{method:'POST'});toast(x.message);await pollLabAlerts();closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  const syncPaymentFields=()=>{const status=$('#paymentStatus')?.value,on=status==='collect';$('#paymentCollectFields')?.classList.toggle('hidden',!on);const credit=$('#paymentMethod')?.value==='credit';$('#paymentInstallmentsWrap')?.classList.toggle('hidden',!credit)};
  $('#paymentStatus')?.addEventListener('change',syncPaymentFields);$('#paymentMethod')?.addEventListener('change',syncPaymentFields);syncPaymentFields();
  $('#createQuoteBtn')?.addEventListener('click',()=>{state.quoteRequisitionId=id;closeModal();navigate('quotes')});
  $('#assignBtn')?.addEventListener('click',async()=>{const courierId=Number($('#assignCourier').value);if(!courierId)return toast('Selecione o entregador.','error');const body={courierId};if(state.me.role==='admin'||state.me.canManagePayments){body.paymentStatus=$('#paymentStatus')?.value||'not_set';if(body.paymentStatus==='collect'){body.paymentMethod=$('#paymentMethod')?.value;body.paymentInstallments=Number($('#paymentInstallments')?.value||1)}}try{const x=await api(`/api/requisitions/${id}/assign`,{json:body});toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#receiveBtn')?.addEventListener('click',async()=>{const body={temperature:$('#receiveTemp').value,location:$('#receiveLocation').value,observation:$('#receiveObservation').value};if(state.me.role==='admin')body.technicianId=Number($('#technicianId').value);try{const x=await api(`/api/requisitions/${id}/receive`,{json:body});toast(x.message);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#analysisBtn')?.addEventListener('click',async()=>{try{await api(`/api/requisitions/${id}/analysis`,{method:'POST'});toast('Exame em análise.');closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#completeBtn')?.addEventListener('click',async()=>{try{await api(`/api/requisitions/${id}/complete`,{method:'POST'});toast('Exame concluído.');closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#cancelBtn')?.addEventListener('click',async()=>{const reason=prompt('Motivo do cancelamento:');if(reason===null)return;try{await api(`/api/requisitions/${id}/cancel`,{json:{reason}});toast('Requisição cancelada.');closeModal();openRequest(id)}catch(e){toast(e.message,'error')}});
  $('#uploadBtn')?.addEventListener('click',async()=>{
    const files=[...($('#resultFile')?.files||[])];if(!files.length)return toast('Selecione pelo menos um arquivo.','error');
    try{let enviados=0;for(const file of files){const fd=new FormData();fd.append('file',file);const res=await fetch(`/api/requisitions/${id}/results`,{method:'POST',body:fd,credentials:'include'});const x=await res.json();if(!res.ok)throw new Error(x.error||`Falha no envio de ${file.name}`);enviados++;}toast(`${enviados} resultado${enviados>1?'s':''} enviado${enviados>1?'s':''} com sucesso.`);closeModal();openRequest(id)}catch(e){toast(e.message,'error')}
  });
}

async function loadAdminLists(){
  if(state.me.role==='client')return;
  const [c,co,r]=await Promise.all([api('/api/clients'),api('/api/couriers'),api('/api/technicians')]);state.clients=c.clients||[];state.couriers=co.couriers||[];state.receivers=r.receivers||[];
}


function fmtDurationSeconds(sec){
  if(sec==null||!Number.isFinite(Number(sec)))return '—';
  let n=Math.abs(Math.round(Number(sec))),days=Math.floor(n/86400);n%=86400;const h=Math.floor(n/3600);n%=3600;const m=Math.floor(n/60);
  const parts=[];if(days)parts.push(`${days}d`);if(h)parts.push(`${h}h`);parts.push(`${m}min`);return parts.join(' ');
}
function minutesLabel(min){const n=Number(min||0);if(!n)return '—';if(n%1440===0)return `${n/1440} dia${n/1440===1?'':'s'}`;if(n%60===0)return `${n/60} hora${n/60===1?'':'s'}`;return `${n} min`}
function timingPill(t){
  if(!t)return '<span class="sla-pill neutral">Sem prazo</span>';
  if(t.status==='late')return `<span class="sla-pill late">Atrasado há ${fmtDurationSeconds(t.seconds)}</span>`;
  if(t.status==='warning')return `<span class="sla-pill warning">Faltam ${fmtDurationSeconds(t.seconds)}</span>`;
  if(t.status==='on_time')return `<span class="sla-pill on-time">No prazo • ${fmtDurationSeconds(t.seconds)} restantes</span>`;
  if(t.status==='completed_late')return `<span class="sla-pill late">Concluído com atraso</span>`;
  if(t.status==='completed_on_time')return `<span class="sla-pill done">Concluído no prazo</span>`;
  return '<span class="sla-pill neutral">Sem prazo</span>';
}
function timingStateLabel(stateName){
  return stateName==='late'?'ATRASADO AGORA':stateName==='warning'?'NO LIMITE':stateName==='completed'?'CONCLUÍDO':'NO PRAZO';
}
function timingStateIcon(stateName){
  return stateName==='late'?'!':stateName==='warning'?'◷':stateName==='completed'?'✓':'✓';
}
function timingRequestCard(g,bucket=''){
  const allPending=(g.pending||[]).slice().sort((a,b)=>{
    const rank=x=>x?.timing?.status==='late'?0:x?.timing?.status==='warning'?1:2;
    return rank(a)-rank(b)||String(a.dueAt||'').localeCompare(String(b.dueAt||''));
  });
  const statusForBucket={late:'late',warning:'warning',on_time:'on_time'};
  const wanted=statusForBucket[bucket];
  const pending=wanted?allPending.filter(x=>x?.timing?.status===wanted):allPending;
  const completed=(g.completedExams||[]).slice().sort((a,b)=>new Date(b.completedAt||0)-new Date(a.completedAt||0));
  const headline=bucket==='late'?`${pending.length} exame${pending.length===1?'':'s'} atrasado${pending.length===1?'':'s'}`:bucket==='warning'?`${pending.length} exame${pending.length===1?'':'s'} no limite`:bucket==='on_time'?`${pending.length} exame${pending.length===1?'':'s'} dentro do prazo`:g.state==='completed'?'Todos os exames concluídos':g.state==='late'?`Há ${g.late} exame${g.late===1?'':'s'} atrasado${g.late===1?'':'s'}`:g.state==='warning'?`Há ${g.warning} exame${g.warning===1?'':'s'} no limite`:'Exames dentro do prazo';
  const pendingRows=pending.slice(0,8).map(x=>`<div class="timing-exam-row ${x?.timing?.status||''}"><div><strong>${esc(x.examName)}</strong><small>Prazo: ${fmtDateTime(x.dueAt)}</small></div>${timingPill(x.timing)}<button class="btn soft small" data-finish-exam="${x.examId}">Concluir</button></div>`).join('');
  const completedRows=(bucket==='completed'||g.state==='completed')?completed.slice(0,8).map(x=>`<div class="timing-exam-row completed"><div><strong>${esc(x.examName)}</strong><small>Concluído ${fmtDateTime(x.completedAt)}</small></div><span class="sla-pill ${x.onTime?'done':'late'}">${x.onTime?'No prazo':'Com atraso'}</span></div>`).join(''):'';
  const shownCount=(bucket==='completed'||g.state==='completed')?completed.length:pending.length;
  const more=shownCount>8?`<div class="timing-more">+ ${shownCount-8} exame${shownCount-8===1?'':'s'}</div>`:'';
  return `<article class="timing-card ${g.state}" data-request-card="${g.requisitionId}">
    <div class="timing-card-head"><div><div class="timing-title"><button class="timing-client-link" data-open-request="${g.requisitionId}" title="Abrir solicitação">${esc(g.clientName)}</button>${priorityBadge(g.priority)}<span class="timing-state-badge ${g.state}">${timingStateIcon(g.state)} ${timingStateLabel(g.state)}</span></div><h3>${esc(g.protocol)} • ${esc(g.patientName)}</h3><p>Recebido ${fmtDateTime(g.labReceivedAt)} • Técnico: ${esc(g.receiverName||'—')}</p></div><div class="progress-number"><b>${g.completed}/${g.total}</b><span>${g.progressPct}% concluído</span></div></div>
    <div class="timing-progress"><i style="width:${Math.max(0,Math.min(100,g.progressPct))}%"></i></div>
    <div class="timing-summary"><strong>${esc(headline)}</strong></div>
    ${(bucket==='completed'||g.state==='completed')?(completedRows||'<div class="timing-all-done">✓ Exames concluídos.</div>'):(pendingRows?`<div class="timing-exam-list">${pendingRows}${more}</div>`:'<div class="timing-all-done">Nenhum exame nesta situação.</div>')}
    <div class="timing-card-actions"><button class="btn ghost small" data-open-request="${g.requisitionId}">Abrir solicitação</button>${g.state==='completed'?`<button class="btn primary small" data-send-result="${g.requisitionId}">Enviar resultado ao cliente</button>`:''}</div>
  </article>`;
}
function timingSettingsHtml(settings){
  const overrides=new Map((settings.overrides||[]).map(x=>[x.exam_code,x]));
  return `<div class="timing-settings-panel-inner"><div class="timing-settings-head"><div><h2>Configuração dos prazos</h2><p>O cronômetro começa no recebimento da amostra. Selecione vários exames e aplique um único tempo.</p></div><button class="timing-close-settings" id="closeTimingSettings" type="button">×</button></div><form id="timingDefaultForm" class="timing-default-form"><label>Tempo padrão<input id="timingDefaultValue" type="number" min="1" value="${Math.round(settings.defaultTurnaroundMinutes%60===0?settings.defaultTurnaroundMinutes/60:settings.defaultTurnaroundMinutes)}"></label><label>Unidade<select id="timingDefaultUnit"><option value="minutes" ${settings.defaultTurnaroundMinutes%60?'selected':''}>Minutos</option><option value="hours" ${settings.defaultTurnaroundMinutes%60===0?'selected':''}>Horas</option></select></label><label>Aviso amarelo<input id="timingWarning" type="number" min="1" value="${settings.warningMinutes}"><small>minutos antes do vencimento</small></label><button class="btn primary">Salvar padrão</button></form><div class="bulk-time-box"><div><h4>Aplicar o mesmo tempo a vários exames</h4><p class="muted">Marque quantos exames quiser e informe somente um tempo.</p></div><div class="bulk-time-controls"><input id="bulkTimeValue" type="number" min="1" value="2"><select id="bulkTimeUnit"><option value="hours">Horas</option><option value="minutes">Minutos</option></select><button class="btn secondary" id="applyBulkTime" type="button">Aplicar aos selecionados</button><button class="btn ghost" id="removeBulkTime" type="button">Usar tempo padrão</button></div><div class="timing-catalog">${(settings.catalog||[]).map(g=>`<section><h5>${esc(g.category)}</h5>${g.items.map(e=>{const o=overrides.get(e.code);return `<label class="timing-check"><input type="checkbox" class="timing-exam-check" value="${e.code}"><span>${esc(e.name)}</span><small>${o?minutesLabel(o.turnaround_minutes):`Padrão • ${minutesLabel(settings.defaultTurnaroundMinutes)}`}</small></label>`}).join('')}</section>`).join('')}</div></div></div>`;
}
function closeExamTimingFullscreen(goBack=true){
  if(state.timingAutoRefresh){clearInterval(state.timingAutoRefresh);state.timingAutoRefresh=null}
  if(state.timingClockTimer){clearInterval(state.timingClockTimer);state.timingClockTimer=null}
  if(state.timingEscHandler){document.removeEventListener('keydown',state.timingEscHandler);state.timingEscHandler=null}
  $('#timingFullscreen')?.remove();
  if(goBack) navigate(state.timingReturnPage||'dashboard');
}
function timingReportHtml(d){
  const t=d?.totals||{},rows=d?.technicians||[];
  return `<div class="timing-report-kpis"><span><b>${t.completed||0}</b><small>Concluídos</small></span><span><b>${t.onTime||0}</b><small>No prazo</small></span><span><b>${t.late||0}</b><small>Com atraso</small></span><span><b>${t.pendingLate||0}</b><small>Atrasados agora</small></span><span><b>${t.onTimePct||0}%</b><small>Pontualidade</small></span></div>${rows.length?`<div class="timing-report-table"><table><thead><tr><th>Técnico</th><th>Concluídos</th><th>No prazo</th><th>Com atraso</th><th>Atrasados agora</th><th>Pontualidade</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.technician)}</strong></td><td>${x.completed}</td><td class="ok">${x.onTime}</td><td class="bad">${x.late}</td><td class="bad">${x.pendingLate}</td><td><strong>${x.onTimePct}%</strong><div class="tech-progress"><i style="width:${Math.max(0,Math.min(100,x.onTimePct))}%"></i></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Ainda não há dados suficientes para o período.</div>'}`;
}

async function renderExamTiming(){
  if(!['admin','staff'].includes(state.me.role))return navigate('dashboard');
  await loadAdminLists();
  state.timingScope='unfinished';state.timingBucket='';state.timingVisibleCount=0;state.timingBoardRows=[];
  if($('#timingFullscreen')) closeExamTimingFullscreen(false);
  const admin=state.me.role==='admin';
  const settings=admin?await api('/api/exam-timing/settings'):{warningMinutes:10};
  const warningInitial=Number(settings.warningMinutes||10);
  const panel=document.createElement('div');panel.id='timingFullscreen';panel.className=`timing-fullscreen ${admin?'is-admin':'is-staff'}`;
  panel.innerHTML=`<div class="timing-tv-hero">
      <div class="timing-brand-card"><img src="/assets/hlabvet-logo.png" alt="HLabVet"></div>
      <div class="timing-hero-title"><h1>Painel de Andamento dos Exames</h1><p>Monitoramento em tempo real</p></div>
      <div class="timing-hero-side"><div class="timing-hero-tagline">CIÊNCIA<br>A FAVOR<br>DA VIDA ANIMAL</div><span id="timingLiveClock" class="timing-live-clock"></span>${admin?'<button class="timing-icon-btn" id="openTimingSettings" title="Configurar tempo dos exames">⚙</button>':''}<button class="timing-icon-btn close" id="closeTimingFullscreen" title="Fechar (Esc)">×</button></div>
    </div>
    <main class="timing-tv-main">
      <div class="timing-fixed-zone">
        <section class="timing-kpis timing-kpis-tv">
          <button class="timing-kpi completed" data-timing-bucket="completed"><span class="timing-kpi-icon"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/><path d="m14 24 7 7 14-16"/></svg></span><span class="timing-kpi-copy"><em>Concluídos</em><strong id="kpiCompleted">—</strong><small>prontos para envio</small></span></button>
          <button class="timing-kpi on-time" data-timing-bucket="on_time"><span class="timing-kpi-icon"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="M24 12v13l9 5"/></svg></span><span class="timing-kpi-copy"><em>No prazo</em><strong id="kpiOnTime">—</strong><small>dentro do tempo</small></span></button>
          <button class="timing-kpi warning" data-timing-bucket="warning"><span class="timing-kpi-icon"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="M24 13v13M24 34h.01"/></svg></span><span class="timing-kpi-copy"><em>No limite</em><strong id="kpiWarning">—</strong><small id="timingWarningLabel">faltam até ${warningInitial} min</small></span></button>
          <button class="timing-kpi late" data-timing-bucket="late"><span class="timing-kpi-icon siren"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 34h20M17 34v-9a7 7 0 0 1 14 0v9M24 8v5M9 18l5 2M39 18l-5 2"/></svg></span><span class="timing-kpi-copy"><em>Atrasados agora</em><strong id="kpiLate">—</strong><small>prazo vencido</small></span></button>
        </section>
        <section class="timing-toolbar">
          <div class="timing-scope-tabs"><button class="active" data-timing-scope="unfinished">Não concluídos</button><button data-timing-scope="active">Em andamento</button><button data-timing-scope="all">Todos</button></div>
          <form id="timingFilters" class="timing-tv-filters">
            <div class="timing-period-presets"><button type="button" class="active" data-period="today">Hoje</button><button type="button" data-period="yesterday">Ontem</button><button type="button" data-period="month">Este mês</button><button type="button" data-period="lastMonth">Mês passado</button><button type="button" data-period="year">Este ano</button><button type="button" data-period="custom">Personalizado</button></div>
            <div class="timing-date-range"><label>De<input name="from" id="timingFrom" type="date"></label><label>Até<input name="to" id="timingTo" type="date"></label></div>
            <select name="clientId"><option value="">Todos os clientes</option>${state.clients.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
            <select name="technicianId"><option value="">Todos os técnicos</option>${state.receivers.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
            <select name="priority"><option value="">Todas as prioridades</option><option value="urgent">Urgente</option><option value="priority">Prioridade</option><option value="normal">Normal</option></select>
            <button class="btn soft small" type="submit">Aplicar</button><button class="btn ghost small" id="refreshTiming" type="button">↻ Atualizar</button>
          </form>
        </section>
        ${admin?`<section class="timing-overview-grid">
          <div class="timing-tech-panel"><div class="timing-panel-heading"><span class="timing-panel-icon">♟</span><div><h2>Desempenho por técnico</h2><p id="timingReportPeriod">Período selecionado</p></div></div><div id="timingReport"><div class="empty-state">Carregando…</div></div></div>
          <div class="timing-status-panel"><div class="timing-panel-heading"><span class="timing-panel-icon">◕</span><div><h2>Status geral dos exames</h2><p>Visão dos protocolos exibidos</p></div></div><div class="timing-status-body"><div class="timing-donut" id="timingDonut"><div><strong id="timingDonutTotal">0</strong><span>exames</span></div></div><div class="timing-status-legend"><span><i class="green"></i>No prazo <b id="legendOnTime">0</b></span><span><i class="yellow"></i>No limite <b id="legendWarning">0</b></span><span><i class="red"></i>Atrasados <b id="legendLate">0</b></span></div></div></div>
        </section>`:''}
      </div>
      <section class="timing-board-shell">
        <div class="timing-board-title"><div><h2 id="timingBoardTitle">Exames não concluídos</h2><p id="timingBoardSubtitle"></p></div><span id="timingListCount" class="timing-list-count"></span></div>
        <div id="timingScrollArea" class="timing-scroll-area"><div id="timingBoard" class="timing-board timing-board-tv"><div class="empty-state">Carregando…</div></div></div>
      </section>
    </main>${admin?`<aside id="timingSettingsPanel" class="timing-settings-drawer hidden">${timingSettingsHtml(settings)}</aside>`:''}`;
  document.body.appendChild(panel);

  const localIso=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
  const setPeriod=(preset,load=true)=>{
    const now=new Date();let from='',to='';
    if(preset==='today'){from=to=localIso(now)}
    else if(preset==='yesterday'){const d=new Date(now);d.setDate(d.getDate()-1);from=to=localIso(d)}
    else if(preset==='month'){from=localIso(new Date(now.getFullYear(),now.getMonth(),1));to=localIso(now)}
    else if(preset==='lastMonth'){from=localIso(new Date(now.getFullYear(),now.getMonth()-1,1));to=localIso(new Date(now.getFullYear(),now.getMonth(),0))}
    else if(preset==='year'){from=`${now.getFullYear()}-01-01`;to=localIso(now)}
    if(preset!=='custom'){$('#timingFrom').value=from;$('#timingTo').value=to}
    $$('.timing-period-presets [data-period]').forEach(x=>x.classList.toggle('active',x.dataset.period===preset));
    if(preset==='custom')$('#timingFrom')?.focus();
    if(load)loadBoard();
  };
  setPeriod('today',false);

  const updateClock=()=>{const el=$('#timingLiveClock');if(el)el.textContent=new Date().toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'})};updateClock();state.timingClockTimer=setInterval(updateClock,1000);
  const close=()=>closeExamTimingFullscreen(true);$('#closeTimingFullscreen')?.addEventListener('click',close);
  state.timingEscHandler=e=>{if(e.key!=='Escape')return;const drawer=$('#timingSettingsPanel');if(drawer&&!drawer.classList.contains('hidden'))drawer.classList.add('hidden');else close()};document.addEventListener('keydown',state.timingEscHandler);
  $('#openTimingSettings')?.addEventListener('click',()=>$('#timingSettingsPanel')?.classList.remove('hidden'));$('#closeTimingSettings')?.addEventListener('click',()=>$('#timingSettingsPanel')?.classList.add('hidden'));
  const unitToMinutes=(v,u)=>Math.max(1,Math.round(Number(v||0)*(u==='hours'?60:1)));
  $('#timingDefaultForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const r=await api('/api/exam-timing/settings',{method:'PUT',json:{mode:'defaults',defaultTurnaroundMinutes:unitToMinutes($('#timingDefaultValue').value,$('#timingDefaultUnit').value),warningMinutes:Number($('#timingWarning').value)}});toast(r.message);await renderExamTiming()}catch(er){toast(er.message,'error')}});
  const selectedCodes=()=>$$('.timing-exam-check:checked').map(x=>x.value);
  $('#applyBulkTime')?.addEventListener('click',async()=>{const examCodes=selectedCodes();if(!examCodes.length)return toast('Selecione pelo menos um exame.','error');try{const r=await api('/api/exam-timing/settings',{method:'PUT',json:{mode:'bulk',examCodes,turnaroundMinutes:unitToMinutes($('#bulkTimeValue').value,$('#bulkTimeUnit').value)}});toast(r.message);await renderExamTiming()}catch(er){toast(er.message,'error')}});
  $('#removeBulkTime')?.addEventListener('click',async()=>{const examCodes=selectedCodes();if(!examCodes.length)return toast('Selecione pelo menos um exame.','error');try{const r=await api('/api/exam-timing/settings',{method:'PUT',json:{mode:'remove',examCodes}});toast(r.message);await renderExamTiming()}catch(er){toast(er.message,'error')}});

  const board=$('#timingBoard');
  board?.addEventListener('click',async e=>{
    const finish=e.target.closest('[data-finish-exam]');if(finish){if(!confirm('Marcar este exame como concluído agora?'))return;try{const x=await api(`/api/exam-timing/exams/${finish.dataset.finishExam}/complete`,{method:'POST'});toast(x.message);await loadBoard()}catch(er){toast(er.message,'error')}return}
    const send=e.target.closest('[data-send-result]');if(send){const id=Number(send.dataset.sendResult);closeExamTimingFullscreen(false);await navigate(state.timingReturnPage||'dashboard');await openRequest(id,{focusResults:true});return}
    const open=e.target.closest('[data-open-request]');if(open){const id=Number(open.dataset.openRequest);closeExamTimingFullscreen(false);await navigate(state.timingReturnPage||'dashboard');await openRequest(id);return}
  });

  const bucketTitles={completed:'Exames concluídos',on_time:'Exames no prazo',warning:'Exames no limite',late:'Exames atrasados agora','':'Exames não concluídos'};
  const appendBatch=()=>{
    const rows=state.timingBoardRows||[];if(!board||state.timingVisibleCount>=rows.length)return;
    const start=state.timingVisibleCount,end=Math.min(rows.length,start+40),bucket=state.timingBucket||'';
    board.insertAdjacentHTML('beforeend',rows.slice(start,end).map(x=>timingRequestCard(x,bucket)).join(''));
    state.timingVisibleCount=end;
    const c=$('#timingListCount');if(c)c.textContent=rows.length?`${Math.min(state.timingVisibleCount,rows.length)} de ${rows.length}`:'';
  };
  $('#timingScrollArea')?.addEventListener('scroll',e=>{const el=e.currentTarget;if(el.scrollTop+el.clientHeight>=el.scrollHeight-260)appendBatch()});

  const loadReport=async(qs)=>{
    if(!admin||!$('#timingReport'))return;
    const rp=new URLSearchParams();if(qs.get('from'))rp.set('from',qs.get('from'));if(qs.get('to'))rp.set('to',qs.get('to'));
    try{const r=await api(`/api/exam-timing/report?${rp}`);$('#timingReport').innerHTML=timingReportHtml(r);const from=qs.get('from'),to=qs.get('to');$('#timingReportPeriod').textContent=from&&to?`${fmtDate(from+'T12:00:00')} a ${fmtDate(to+'T12:00:00')}`:'Período selecionado'}catch(e){$('#timingReport').innerHTML='<div class="empty-state">Não foi possível carregar o relatório.</div>'}
  };
  const updateDonut=d=>{
    if(!admin)return;
    const a=Number(d.counts?.onTimeRequests||0),w=Number(d.counts?.warningRequests||0),l=Number(d.counts?.lateRequests||0),total=a+w+l;
    const g=total?a/total*360:0,y=total?w/total*360:0;
    const donut=$('#timingDonut');if(donut)donut.style.background=total?`conic-gradient(#28a85b 0 ${g}deg,#f4b91c ${g}deg ${g+y}deg,#ed3d43 ${g+y}deg 360deg)`:'#e9e3ec';
    if($('#timingDonutTotal'))$('#timingDonutTotal').textContent=total;if($('#legendOnTime'))$('#legendOnTime').textContent=a;if($('#legendWarning'))$('#legendWarning').textContent=w;if($('#legendLate'))$('#legendLate').textContent=l;
  };
  const loadBoard=async()=>{
    if(!$('#timingFullscreen'))return;
    const qs=new URLSearchParams(new FormData($('#timingFilters')));for(const[k,v]of[...qs])if(!v)qs.delete(k);qs.set('scope',state.timingScope||'unfinished');if(state.timingBucket)qs.set('bucket',state.timingBucket);
    const d=await api(`/api/exam-timing/board?${qs}`);if(!$('#timingFullscreen'))return;
    $('#kpiCompleted').textContent=d.counts.completedRequests??0;$('#kpiOnTime').textContent=d.counts.onTimeRequests??0;$('#kpiWarning').textContent=d.counts.warningRequests??0;$('#kpiLate').textContent=d.counts.lateRequests??0;
    const lateCard=$('.timing-kpi.late');lateCard?.classList.toggle('alarm-active',Number(d.counts.lateRequests||0)>0);
    if($('#timingWarningLabel'))$('#timingWarningLabel').textContent=`faltam até ${Number(d.warningMinutes||warningInitial)} min`;
    $('#timingBoardTitle').textContent=bucketTitles[state.timingBucket||''];$('#timingBoardSubtitle').textContent='';$$('[data-timing-bucket]').forEach(x=>x.classList.toggle('selected',x.dataset.timingBucket===state.timingBucket));
    state.timingBoardRows=d.requests||[];state.timingVisibleCount=0;board.innerHTML=state.timingBoardRows.length?'':'<div class="empty-state timing-empty-tv">Nenhum exame neste filtro.</div>';appendBatch();$('#timingScrollArea').scrollTop=0;
    updateDonut(d);await loadReport(qs);
  };
  $$('[data-timing-bucket]').forEach(b=>b.addEventListener('click',()=>{const next=state.timingBucket===b.dataset.timingBucket?'':b.dataset.timingBucket;state.timingBucket=next;if(next==='completed'){state.timingScope='all';$$('[data-timing-scope]').forEach(x=>x.classList.toggle('active',x.dataset.timingScope==='all'))}loadBoard()}));
  $$('[data-timing-scope]').forEach(b=>b.addEventListener('click',()=>{state.timingScope=b.dataset.timingScope;$$('[data-timing-scope]').forEach(x=>x.classList.toggle('active',x===b));if(state.timingScope!=='all'&&state.timingBucket==='completed')state.timingBucket='';loadBoard()}));
  $$('.timing-period-presets [data-period]').forEach(b=>b.addEventListener('click',()=>setPeriod(b.dataset.period,true)));
  $('#timingFilters')?.addEventListener('submit',e=>{e.preventDefault();$$('.timing-period-presets [data-period]').forEach(x=>x.classList.remove('active'));loadBoard()});$('#refreshTiming')?.addEventListener('click',loadBoard);
  await loadBoard();state.timingAutoRefresh=setInterval(()=>{if($('#timingFullscreen'))loadBoard();else clearInterval(state.timingAutoRefresh)},20000);
}

async function renderClients(){
  const d=await api('/api/clients');state.clients=d.clients||[];const admin=state.me.role==='admin';$('#topActions').innerHTML=admin?`<button class="btn primary" id="addClient">＋ Cadastrar cliente</button>`:'';
  $('#content').innerHTML=`<div class="card">${!admin?'<p class="muted">Consulta de clientes. Cadastro, edição e senhas ficam exclusivos do administrador do laboratório.</p>':''}<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Usuário</th><th>Contato</th><th>Endereço</th><th>Status</th>${admin?'<th>Ações</th>':''}</tr></thead><tbody>${state.clients.map(c=>`<tr><td><strong>${esc(c.name)}</strong><br><small>${esc(c.document||'')}</small></td><td>${esc(c.username_display)}</td><td>${esc(c.phone||'')}<br><small>${esc(c.email||'')}</small></td><td>${esc([c.address,c.city,c.state].filter(Boolean).join(', '))}${c.map_url?`<br><a class="link-btn" href="${esc(c.map_url)}" target="_blank" rel="noopener">📍 Localização exata</a>`:''}</td><td><span class="badge ${c.active?'concluido':'cancelado'}">${c.active?'Ativo':'Inativo'}</span></td>${admin?`<td><div class="actions"><button class="btn soft small" data-edit-client="${c.id}">Editar</button><button class="btn ghost small" data-reset-client="${c.id}">Alterar senha</button>${c.active?`<button class="btn danger small" data-delete-client="${c.id}">Desativar</button>`:''}</div></td>`:''}</tr>`).join('')}</tbody></table></div></div>`;
  if(admin){$('#addClient').addEventListener('click',()=>clientForm());$$('[data-edit-client]').forEach(b=>b.addEventListener('click',()=>clientForm(state.clients.find(x=>x.id===Number(b.dataset.editClient)))));$$('[data-reset-client]').forEach(b=>b.addEventListener('click',()=>resetClient(Number(b.dataset.resetClient))));$$('[data-delete-client]').forEach(b=>b.addEventListener('click',()=>deleteClient(Number(b.dataset.deleteClient))))}
}

function clientForm(c=null){
  modal(`<h3>${c?'Editar cliente':'Cadastrar cliente'}</h3><p class="muted">O formulário só fecha em Salvar ou Cancelar. O cliente usa este acesso principal para administrar a clínica e pode criar usuários/técnicos próprios depois.</p><form id="clientForm" class="stack"><div class="form-grid"><label class="field span2">Nome fantasia / clínica<input name="name" value="${esc(c?.name||'')}" required></label><label class="field span2">Razão social<input name="legalName" value="${esc(c?.legal_name||'')}"></label><label class="field">CNPJ/CPF<input name="document" value="${esc(c?.document||'')}"></label><label class="field">Telefone<input name="phone" value="${esc(c?.phone||'')}"></label><label class="field span2">E-mail<input name="email" type="email" value="${esc(c?.email||'')}"></label><label class="field span2">Endereço<input name="address" value="${esc(c?.address||'')}"></label><label class="field span2">Localização Google Maps (opcional)<input name="mapUrl" type="url" value="${esc(c?.map_url||'')}" placeholder="https://maps.app.goo.gl/..."><small>Use o ponto exato quando o endereço não for suficiente para chegar ao local.</small></label><label class="field">Cidade<input name="city" value="${esc(c?.city||'Natal')}"></label><label class="field">UF<input name="state" value="${esc(c?.state||'RN')}"></label><label class="field">CEP<input name="zipCode" value="${esc(c?.zip_code||'')}"></label><label class="field">Usuário principal<input name="username" value="${esc(c?.username_display||'')}" required></label>${c?'':`<label class="field">Senha inicial<input name="password" type="password" minlength="8" required><small>Será trocada no primeiro login.</small></label>`}${c?`<label class="field">Ativo<select name="active"><option value="1" ${c.active?'selected':''}>Sim</option><option value="0" ${!c.active?'selected':''}>Não</option></select></label>`:''}</div><div class="actions"><button class="btn primary">Salvar cliente</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  $('#clientForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if('active'in b)b.active=b.active==='1';try{const r=await api(c?`/api/clients/${c.id}`:'/api/clients',{method:c?'PATCH':'POST',json:b});toast(r.message);closeModal();renderClients()}catch(er){toast(er.message,'error')}})
}

async function resetClient(id){const password=prompt('Digite a nova senha temporária (mínimo 8 caracteres):');if(password===null)return;try{const r=await api(`/api/clients/${id}/reset-password`,{json:{password}});toast(r.message)}catch(e){toast(e.message,'error')}}
async function deleteClient(id){if(!confirm('Desativar este cliente? O histórico será preservado.'))return;try{const r=await api(`/api/clients/${id}`,{method:'DELETE'});toast(r.message);renderClients()}catch(e){toast(e.message,'error')}}

async function renderCouriers(){
  const d=await api('/api/couriers');
  state.couriers=d.couriers||[];
  const admin=state.me?.role==='admin';
  $('#topActions').innerHTML=admin?`<button class="btn primary" id="addCourier">＋ Cadastrar entregador</button>`:'';
  const helper=admin
    ? '<p class="muted courier-admin-note">Como administrador, você pode editar nome, telefone, usuário, termômetro, status e redefinir a senha de acesso de cada entregador.</p>'
    : '<p class="muted">Consulta dos entregadores e respectivos termômetros. Edição de cadastro e alteração de senha ficam exclusivas do administrador do laboratório.</p>';
  $('#content').innerHTML=`<div class="card">${helper}<div class="table-wrap"><table><thead><tr><th>Entregador</th><th>Telefone</th><th>Usuário</th><th>Termômetro</th><th>Status</th><th>Acesso</th>${admin?'<th>Ações</th>':''}</tr></thead><tbody>${state.couriers.map(c=>{
    const accessLabel=!c.account_id?'Sem login':(!c.account_active?'Acesso inativo':(c.force_password_change?'Troca de senha pendente':'Liberado'));
    const accessClass=!c.account_id||!c.account_active?'cancelado':(c.force_password_change?'coletado':'concluido');
    return `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.phone||'—')}</td><td>${c.account_id?esc(c.username_display||''):'<span class="danger-text">Sem login</span>'}</td><td><strong>${esc(c.thermometer_code||'—')}</strong></td><td><span class="badge ${c.active?'concluido':'cancelado'}">${c.active?'Ativo':'Inativo'}</span></td><td><span class="badge ${accessClass}">${esc(accessLabel)}</span></td>${admin?`<td><div class="actions courier-admin-actions"><button class="btn soft small" data-edit-courier="${c.id}">Editar cadastro</button>${c.account_id?`<button class="btn ghost small" data-reset-courier="${c.id}">Alterar senha</button>`:`<button class="btn ghost small" data-edit-courier="${c.id}">Criar acesso</button>`}</div></td>`:''}</tr>`;
  }).join('')}</tbody></table></div></div>`;
  if(admin){
    $('#addCourier')?.addEventListener('click',()=>courierForm());
    $$('[data-edit-courier]').forEach(b=>b.addEventListener('click',()=>courierForm(state.couriers.find(x=>x.id===Number(b.dataset.editCourier)))));
    $$('[data-reset-courier]').forEach(b=>b.addEventListener('click',()=>resetCourierPassword(Number(b.dataset.resetCourier))));
  }
}

function courierForm(c=null){
  const hasLogin=!!c?.account_id;
  modal(`<h3>${c?'Editar entregador':'Cadastrar entregador'}</h3><p class="muted">${c?'Altere os dados do entregador. O usuário de acesso também pode ser corrigido aqui.':'Cadastre os dados e crie o acesso próprio do entregador ao painel móvel.'}</p><form id="courierForm" class="stack"><div class="form-grid"><label class="field span2">Nome<input name="name" value="${esc(c?.name||'')}" required></label><label class="field">Telefone<input name="phone" value="${esc(c?.phone||'')}"></label><label class="field">Usuário de acesso<input name="username" value="${esc(c?.username_display||'')}" required placeholder="Ex.: thales.alcantara"></label>${!hasLogin?`<label class="field">Senha inicial<input name="password" type="password" minlength="8" required autocomplete="new-password"><small>Mínimo 8 caracteres. No primeiro acesso o entregador deverá criar a senha pessoal.</small></label>`:''}<label class="field">Número do termômetro<input name="thermometerCode" value="${esc(c?.thermometer_code||'TER-001')}" placeholder="TER-001" required><small>Use o padrão TER-001, TER-002, TER-003...</small></label>${c?`<label class="field">Status<select name="active"><option value="1" ${c.active?'selected':''}>Ativo</option><option value="0" ${!c.active?'selected':''}>Inativo</option></select><small>Ao inativar, o acesso do entregador também é bloqueado.</small></label>`:''}</div><div class="actions"><button class="btn primary">Salvar alterações</button>${c&&hasLogin?`<button type="button" class="btn soft" id="courierPasswordFromEdit">Alterar senha</button>`:''}<button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  $('#courierPasswordFromEdit')?.addEventListener('click',()=>{const id=c.id;closeModal();resetCourierPassword(id)});
  $('#courierForm').addEventListener('submit',async e=>{
    e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if('active'in b)b.active=b.active==='1';
    try{const r=await api(c?`/api/couriers/${c.id}`:'/api/couriers',{method:c?'PATCH':'POST',json:b});toast(r.message);closeModal();renderCouriers()}catch(er){toast(er.message,'error')}
  });
}
function resetCourierPassword(id){
  const courier=state.couriers.find(x=>x.id===Number(id));
  modal(`<h3>Alterar senha do entregador</h3><p class="muted">Defina uma nova senha temporária para <strong>${esc(courier?.name||'este entregador')}</strong>. As sessões atuais serão encerradas e, no próximo acesso, ele deverá trocar a senha.</p><form id="courierResetPasswordForm" class="stack"><label>Nova senha temporária<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirmar senha<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label><div class="actions"><button class="btn primary">Salvar nova senha</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  $('#courierResetPasswordForm').addEventListener('submit',async e=>{
    e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));
    if(String(b.password||'').length<8)return toast('A senha precisa ter pelo menos 8 caracteres.','error');
    if(b.password!==b.confirmPassword)return toast('As senhas não coincidem.','error');
    try{const r=await api(`/api/couriers/${id}/reset-password`,{json:{password:b.password}});toast(r.message);closeModal();renderCouriers()}catch(er){toast(er.message,'error')}
  });
}

async function renderReceivers(){
  const d=await api('/api/technicians');state.receivers=d.receivers||[];const admin=state.me.role==='admin';$('#topActions').innerHTML=admin?`<button class="btn primary" id="addReceiver">＋ Usuário interno</button>`:'';
  const profileLabel=v=>v==='seller'?'Vendedor':v==='other'?'Outro':'Técnico';
  $('#content').innerHTML=`<div class="card"><div class="section-title"><div><h3>Equipe interna</h3><p>O administrador define individualmente quem pode visualizar valores, criar orçamentos, tratar cobranças e alterar a tabela oficial.</p></div></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Perfil</th><th>Usuário</th><th>Permissões comerciais</th><th>Status</th>${admin?'<th>Ações</th>':''}</tr></thead><tbody>${state.receivers.map(r=>`<tr><td><strong>${esc(r.name)}</strong><br><small>${esc(r.location||'HLab Vet')}</small></td><td><span class="badge">${profileLabel(r.profile_type)}</span></td><td>${esc(r.username_display||'Sem login')}</td><td><div class="permission-pills">${Number(r.can_view_prices)?'<span>Valores</span>':''}${Number(r.can_make_quotes)?'<span>Orçamentos</span>':''}${Number(r.can_manage_payments)?'<span>Pagamentos</span>':''}${Number(r.can_manage_prices)?'<span>Alterar preços</span>':''}</div></td><td><span class="badge ${r.active?'concluido':'cancelado'}">${r.active?'Ativo':'Inativo'}</span></td>${admin?`<td><div class="actions"><button class="btn soft small" data-edit-receiver="${r.id}">Editar</button>${r.user_id?`<button class="btn ghost small" data-reset-tech="${r.id}">Alterar senha</button>`:''}</div></td>`:''}</tr>`).join('')}</tbody></table></div></div>`;
  if(admin){$('#addReceiver').addEventListener('click',()=>receiverForm());$$('[data-edit-receiver]').forEach(b=>b.addEventListener('click',()=>receiverForm(state.receivers.find(x=>x.id===Number(b.dataset.editReceiver)))));$$('[data-reset-tech]').forEach(b=>b.addEventListener('click',()=>resetTechnician(Number(b.dataset.resetTech))))}
}
function receiverForm(r=null){
  const checked=(v,d=true)=>Number(v??(d?1:0))?'checked':'';
  modal(`<h3>${r?'Editar usuário interno':'Cadastrar usuário interno'}</h3><form id="receiverForm" class="stack"><div class="form-grid"><label class="field span2">Nome completo<input name="name" value="${esc(r?.name||'')}" required></label><label class="field">Perfil<select name="profileType"><option value="technician" ${r?.profile_type!=='seller'&&r?.profile_type!=='other'?'selected':''}>Técnico</option><option value="seller" ${r?.profile_type==='seller'?'selected':''}>Vendedor</option><option value="other" ${r?.profile_type==='other'?'selected':''}>Outro</option></select></label><label class="field">Usuário de login<input name="username" value="${esc(r?.username_display||'')}" required></label>${!r?.user_id?`<label class="field">Senha inicial<input name="password" type="password" minlength="8" required><small>Será trocada no primeiro acesso.</small></label>`:''}<label class="field">Local padrão<input name="location" value="${esc(r?.location||'HLab Vet')}"></label>${r?`<label class="field">Status<select name="active"><option value="1" ${r.active?'selected':''}>Ativo</option><option value="0" ${!r.active?'selected':''}>Inativo</option></select></label>`:''}</div><div class="permissions-box"><h4>Acesso comercial</h4><label><input type="checkbox" name="canViewPrices" value="1" ${checked(r?.can_view_prices)}> Ver valores dos exames e serviços</label><label><input type="checkbox" name="canMakeQuotes" value="1" ${checked(r?.can_make_quotes)}> Criar, editar, baixar e enviar orçamentos</label><label><input type="checkbox" name="canManagePayments" value="1" ${checked(r?.can_manage_payments)}> Definir cobrança e forma de pagamento</label><label><input type="checkbox" name="canManagePrices" value="1" ${checked(r?.can_manage_prices,false)}> Alterar tabela oficial e cadastrar exames/serviços</label></div><div class="actions"><button class="btn primary">Salvar usuário</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  $('#receiverForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),b=Object.fromEntries(f);for(const k of ['canViewPrices','canMakeQuotes','canManagePayments','canManagePrices'])b[k]=f.has(k);if('active'in b)b.active=b.active==='1';try{const x=await api(r?`/api/technicians/${r.id}`:'/api/technicians',{method:r?'PATCH':'POST',json:b});toast(x.message);closeModal();renderReceivers()}catch(er){toast(er.message,'error')}})
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


async function renderTutors(){
  if(state.me.role!=='client')return navigate(state.me.role==='tutor'?'tutor-results':'dashboard');
  const d=await api('/api/tutors'),tutors=d.tutors||[],manager=!!state.me.canManageClientUsers;
  $('#topActions').innerHTML=`<button class="btn primary" id="addTutor">＋ Cadastrar tutor</button>`;
  $('#content').innerHTML=`<div class="card"><div class="section-title"><div><h3>Tutores / clientes finais</h3><p>O tutor terá um login próprio e verá somente os resultados das solicitações vinculadas a ele.</p></div></div>${tutors.length?`<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Contato</th>${manager?'<th>Usuário</th>':''}<th>Status</th>${manager?'<th>Ações</th>':''}</tr></thead><tbody>${tutors.map(t=>`<tr><td><strong>${esc(t.name)}</strong><br><small>${esc(t.document||'')}</small></td><td>${esc(t.phone||'—')}<br><small>${esc(t.email||'')}</small></td>${manager?`<td>${esc(t.username_display||'')}</td>`:''}<td><span class="badge ${t.active?'concluido':'cancelado'}">${t.active?'Ativo':'Inativo'}</span></td>${manager?`<td><div class="actions"><button class="btn soft small" data-edit-tutor="${t.id}">Editar</button><button class="btn ghost small" data-reset-tutor="${t.id}">Senha</button>${t.active?`<button class="btn danger small" data-disable-tutor="${t.id}">Desativar</button>`:''}</div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Nenhum tutor cadastrado.</div>'}</div>`;
  $('#addTutor')?.addEventListener('click',()=>tutorForm());
  if(manager){
    $$('[data-edit-tutor]').forEach(b=>b.addEventListener('click',()=>tutorForm(tutors.find(x=>x.id===Number(b.dataset.editTutor)))));
    $$('[data-reset-tutor]').forEach(b=>b.addEventListener('click',()=>resetTutor(Number(b.dataset.resetTutor))));
    $$('[data-disable-tutor]').forEach(b=>b.addEventListener('click',()=>disableTutor(Number(b.dataset.disableTutor))));
  }
}

function tutorForm(t=null){
  modal(`<h3>${t?'Editar tutor / cliente final':'Cadastrar tutor / cliente final'}</h3><p class="muted">Esse acesso é exclusivo para o dono do animal. Ele não verá preços, coleta, ficha de temperatura, técnicos ou dados internos.</p><form id="tutorForm" class="stack"><div class="form-grid"><label class="field span2">Nome completo<input name="name" value="${esc(t?.name||'')}" required></label><label class="field">CPF / documento<input name="document" value="${esc(t?.document||'')}"></label><label class="field">Telefone<input name="phone" value="${esc(t?.phone||'')}"></label><label class="field span2">E-mail<input name="email" type="email" value="${esc(t?.email||'')}"></label><label class="field">Usuário de login<input name="username" value="${esc(t?.username_display||'')}" required></label>${t?'':`<label class="field">Senha inicial<input name="password" type="password" minlength="8" required><small>Será trocada no primeiro acesso.</small></label>`}${t?`<label class="field">Ativo<select name="active"><option value="1" ${t.active?'selected':''}>Sim</option><option value="0" ${!t.active?'selected':''}>Não</option></select></label>`:''}</div><div class="actions"><button class="btn primary">Salvar tutor</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form>`);
  $('#tutorForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if('active'in b)b.active=b.active==='1';try{const r=await api(t?`/api/tutors/${t.id}`:'/api/tutors',{method:t?'PATCH':'POST',json:b});toast(r.message);closeModal();renderTutors()}catch(er){toast(er.message,'error')}})
}
async function resetTutor(id){const password=prompt('Digite a nova senha temporária do tutor (mínimo 8 caracteres):');if(password===null)return;try{const r=await api(`/api/tutors/${id}/reset-password`,{json:{password}});toast(r.message)}catch(e){toast(e.message,'error')}}
async function disableTutor(id){if(!confirm('Desativar este tutor? O histórico de resultados continuará preservado.'))return;try{const r=await api(`/api/tutors/${id}`,{method:'DELETE'});toast(r.message);renderTutors()}catch(e){toast(e.message,'error')}}

async function renderTutorResults(){
  if(state.me.role!=='tutor')return navigate('dashboard');
  $('#topActions').innerHTML='';
  const d=await api('/api/tutor/results'),rows=d.results||[];
  $('#content').innerHTML=`<div class="tutor-portal"><div class="card tutor-welcome"><div><h3>Olá, ${esc(state.me.tutorName||state.me.username)}</h3><p>Aqui aparecem somente os resultados liberados para os seus animais.</p></div></div>${rows.length?`<div class="tutor-results-grid">${rows.map(r=>`<article class="card tutor-result-card"><div class="tutor-result-head"><div><small>${esc(r.protocol)}</small><h3>${esc(r.patient_name)}</h3><p>${esc([r.species,r.breed].filter(Boolean).join(' • '))}</p></div><span class="result-ready-pill">RESULTADO DISPONÍVEL</span></div><dl class="kv compact-kv"><dt>Clínica</dt><dd>${esc(r.client_name)}</dd><dt>Resultado liberado</dt><dd>${fmtDateTime(r.latest_result_at)}</dd><dt>Arquivos</dt><dd>${Number(r.result_count)}</dd></dl><button class="btn primary tutor-open-result" data-tutor-result="${r.id}">Visualizar resultado</button></article>`).join('')}</div>`:'<div class="card empty-state">Ainda não há resultados liberados para este acesso.</div>'}</div>`;
  $$('[data-tutor-result]').forEach(b=>b.addEventListener('click',()=>openTutorResult(Number(b.dataset.tutorResult))));
}

async function openTutorResult(id){
  try{
    const d=await api(`/api/tutor/results/${id}`),r=d.requisition;
    modal(`<div class="detail-head"><div><h3>${esc(r.patient_name)}</h3><p class="muted">${esc(r.protocol)} • ${esc(r.client_name)}</p></div><span class="result-ready-pill">RESULTADO DISPONÍVEL</span></div><dl class="kv"><dt>Paciente</dt><dd>${esc(r.patient_name)}</dd><dt>Espécie / raça</dt><dd>${esc([r.species,r.breed].filter(Boolean).join(' • '))||'—'}</dd><dt>Data</dt><dd>${fmtDate(r.created_at)}</dd></dl><h4>Exames</h4><div>${(d.exams||[]).map(x=>`<span class="badge" style="margin:2px">${esc(x)}</span>`).join('')}</div><h4 style="margin-top:18px">Resultados</h4>${resultFilesHtml(d.files,true,false)}<div class="actions" style="margin-top:16px"><button class="btn ghost" data-close-modal>Fechar</button></div>`);
    bindResultFileButtons($('#modalContent'));
  }catch(e){toast(e.message,'error')}
}

async function renderStamp(){
  const r=await api('/api/my-client-profile'),p=r.profile;$('#content').innerHTML=`<div class="grid two"><form id="stampForm" class="card stack"><div class="section-title"><div><h3>Dados do carimbo</h3><p>Digite exatamente o que existe no carimbo do técnico, veterinário ou estabelecimento.</p></div></div><label>Linha principal<input name="stampName" value="${esc(p.stamp_name||p.name||'')}"></label><label>Linha 2<input name="stampLine2" value="${esc(p.stamp_line2||'')}"></label><label>Linha 3<input name="stampLine3" value="${esc(p.stamp_line3||'')}"></label><label>Linha 4<input name="stampLine4" value="${esc(p.stamp_line4||'')}"></label><label>Cor da tinta<input name="stampColor" type="color" value="${esc(p.stamp_color||'#5c2a72')}"></label><label>Telefone<input name="phone" value="${esc(p.phone||'')}"></label><label>E-mail<input name="email" value="${esc(p.email||'')}"></label><button class="btn primary">Salvar carimbo</button></form><div class="card"><h3>Prévia</h3><div class="stamp-preview" id="stampPreview"></div><p class="muted">A visualização usa textura e leve inclinação para se aproximar da aparência de tinta de carimbo. O conteúdo é salvo junto à requisição enviada.</p></div></div>`;
  const form=$('#stampForm'),draw=()=>{const f=new FormData(form);$('#stampPreview').innerHTML=stampHtml({name:f.get('stampName'),line2:f.get('stampLine2'),line3:f.get('stampLine3'),line4:f.get('stampLine4'),color:f.get('stampColor')})};form.addEventListener('input',draw);draw();form.addEventListener('submit',async e=>{e.preventDefault();try{const x=await api('/api/my-client-profile',{method:'PATCH',json:Object.fromEntries(new FormData(form))});toast(x.message)}catch(er){toast(er.message,'error')}})
}
function stampHtml(s){return `<div class="stamp" style="color:${esc(s.color||'#5c2a72')}"><strong>${esc(s.name||'CARIMBO')}</strong>${[s.line2,s.line3,s.line4].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div>`}

function showPasswordChange(forced=false){
  $('#pageTitle').textContent='Alterar senha';$('#pageSubtitle').textContent=forced?'Obrigatório no primeiro acesso':'Mantenha seu acesso protegido';
  $('#content').innerHTML=`<div class="card" style="max-width:560px"><div class="section-title"><div><h3>${forced?'Primeiro acesso: crie sua senha':'Alterar sua senha'}</h3><p>O nome de usuário ignora maiúsculas/minúsculas e acentos. A senha, por segurança, é exata.</p></div></div><form id="passwordForm" class="stack"><label>Senha atual<input name="currentPassword" type="password" required></label><label>Nova senha<input name="newPassword" type="password" minlength="8" required></label><label>Confirmar nova senha<input name="confirm" type="password" minlength="8" required></label><button class="btn primary">Salvar nova senha</button></form></div>`;
  $('#passwordForm').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget));if(b.newPassword!==b.confirm)return toast('A confirmação não confere.','error');delete b.confirm;try{const x=await api('/api/change-password',{json:b});toast(x.message);const m=await api('/api/me');state.me=m.user;state.profile=m.profile;renderNav();navigate(state.me.role==='tutor'?'tutor-results':'dashboard')}catch(er){toast(er.message,'error')}})
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
  if(!(['admin','staff'].includes(state.me.role)&&state.me.canViewPrices))return navigate('dashboard');
  await loadAdminLists();const canManage=state.me.role==='admin'||!!state.me.canManagePrices;
  $('#content').innerHTML=`<section class="card price-page-card"><div class="price-page-head"><div><span class="price-kicker">PRECIFICAÇÃO CENTRAL</span><h3>Tabela de preços dos exames</h3><p>Esta é a fonte única usada em requisições, orçamentos, site, financeiro e cobrança. Preço específico de cliente substitui o geral somente para aquele cliente.</p></div><button class="btn ghost price-refresh" id="reloadPrices" type="button">↻ Atualizar</button></div><div class="price-toolbar"><label class="price-client-filter"><span>Visualizar preços para</span><select id="priceClient"><option value="">Tabela geral</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><div class="price-toolbar-note"><strong>Preço usado</strong><span>Individual do cliente quando existir; caso contrário, preço geral.</span></div></div><div id="priceList" class="price-list"><div class="empty-state">Carregando preços…</div></div></section>`;
  const moneyValue=c=>c==null?'':(c/100).toFixed(2).replace('.',','),moneyField=(attr,code,value,placeholder)=>`<div class="price-money-field"><span>R$</span><input class="money-input" ${attr}="${code}" value="${value}" placeholder="${placeholder}" inputmode="decimal" autocomplete="off" ${canManage?'':'readonly'}></div>`;
  const load=async()=>{const clientId=$('#priceClient').value,qs=clientId?`?clientId=${encodeURIComponent(clientId)}`:'';$('#priceList').innerHTML='<div class="empty-state">Carregando preços…</div>';const d=await api(`/api/prices${qs}`),groups=new Map();for(const x of d.items){if(!groups.has(x.category))groups.set(x.category,[]);groups.get(x.category).push(x)}$('#priceList').innerHTML=[...groups.entries()].map(([cat,items])=>`<section class="price-group"><div class="price-group-title"><div><h4>${esc(cat)}</h4><small>${items.length} exame${items.length===1?'':'s'}</small></div></div><div class="table-wrap price-table-wrap"><table class="price-table ${clientId?'has-client-price':''}"><colgroup><col class="col-exam"><col class="col-general">${clientId?'<col class="col-client"><col class="col-used">':''}<col class="col-actions"></colgroup><thead><tr><th>Exame</th><th>Preço geral</th>${clientId?'<th>Preço deste cliente</th><th>Preço usado</th>':''}<th>Ações</th></tr></thead><tbody>${items.map(x=>`<tr class="${x.effectivePriceCents==null?'price-missing':''}"><td class="price-exam-name"><strong>${esc(x.examName)}</strong>${x.customExamId?'<small class="price-custom-tag">OUTROS • cadastrado</small>':''}${x.effectivePriceCents==null?'<small class="price-status-missing">Sem preço cadastrado</small>':''}</td><td>${moneyField('data-general-price',x.examCode,moneyValue(x.generalPriceCents),'0,00')}</td>${clientId?`<td>${moneyField('data-client-price',x.examCode,moneyValue(x.clientPriceCents),'Usar geral')}</td><td class="price-effective"><strong>${x.effectivePriceCents==null?'—':fmtMoney(x.effectivePriceCents)}</strong><span>${x.source==='client'?'Preço individual':x.source==='general'?'Preço geral':'Pendente'}</span></td>`:''}<td class="price-action-cell">${canManage?`<div class="price-actions"><button class="btn soft small" data-save-general="${x.examCode}" type="button">Salvar geral</button>${clientId?`<button class="btn secondary small" data-save-client="${x.examCode}" type="button">Salvar cliente</button>`:''}${x.customExamId?`<button class="btn danger small" data-disable-custom="${x.customExamId}" type="button">Desativar</button>`:''}</div>`:'<span class="muted">Consulta</span>'}</td></tr>`).join('')}</tbody></table></div></section>`).join('');
    if(canManage){$$('[data-save-general]').forEach(b=>b.addEventListener('click',async()=>{try{const r=await api('/api/prices/general',{json:{examCode:b.dataset.saveGeneral,price:$(`[data-general-price="${b.dataset.saveGeneral}"]`).value}});toast(r.message);load()}catch(e){toast(e.message,'error')}}));$$('[data-save-client]').forEach(b=>b.addEventListener('click',async()=>{try{const r=await api('/api/prices/client',{json:{clientId:Number(clientId),examCode:b.dataset.saveClient,price:$(`[data-client-price="${b.dataset.saveClient}"]`).value}});toast(r.message);load()}catch(e){toast(e.message,'error')}}));$$('[data-disable-custom]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Desativar este exame? Ele deixará de aparecer em novas requisições e orçamentos.'))return;try{const r=await api(`/api/custom-exams/${b.dataset.disableCustom}`,{method:'PATCH',json:{active:false}});toast(r.message);state.catalog=(await api('/api/catalog')).exams;load()}catch(e){toast(e.message,'error')}}));}
  };
  $('#priceClient').addEventListener('change',load);$('#reloadPrices').addEventListener('click',load);await load();
  const services=await api('/api/services');$('#content').insertAdjacentHTML('beforeend',`<section class="card services-price-card"><div class="price-page-head"><div><span class="price-kicker">SERVIÇOS</span><h3>Serviços adicionais</h3><p>Coleta, deslocamento e outros serviços que podem entrar no orçamento.</p></div></div>${canManage?`<form id="serviceForm" class="service-form"><input name="name" placeholder="Nome do serviço" required><input name="description" placeholder="Descrição opcional"><input name="price" class="money-input" placeholder="0,00" required><button class="btn primary">Adicionar serviço</button></form>`:''}<div id="serviceList">${services.services.length?`<div class="table-wrap"><table class="service-price-table"><thead><tr><th>Serviço</th><th>Descrição</th><th>Valor</th><th>Status</th></tr></thead><tbody>${services.services.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.description||'—')}</td><td><strong>${fmtMoney(x.price_cents)}</strong></td><td><span class="badge ${x.active?'concluido':'cancelado'}">${x.active?'Ativo':'Inativo'}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Nenhum serviço cadastrado.</div>'}</div></section>`);
  $('#serviceForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const r=await api('/api/services',{json:Object.fromEntries(new FormData(e.currentTarget))});toast(r.message);renderPrices()}catch(er){toast(er.message,'error')}});
  if(canManage)$('#content').insertAdjacentHTML('beforeend',`<section class="card custom-exam-card"><div class="price-page-head"><div><span class="price-kicker">OUTROS</span><h3>Cadastrar novo exame</h3><p>Exames adicionados aqui entram automaticamente, separados em <b>Outros</b>, na requisição, orçamento, site e financeiro. O cliente apenas seleciona; não existe campo para digitar exame.</p></div></div><form id="customExamForm" class="custom-exam-form"><label>Nome do exame<input name="name" required placeholder="Ex.: Dosagem especial"></label><label>Preço geral (R$)<input name="price" inputmode="decimal" placeholder="0,00"></label><label>Prazo (horas)<input name="hours" type="number" min="0" step="0.5" placeholder="Ex.: 24"></label><button class="btn primary">Cadastrar em Outros</button></form></section>`);
  $('#customExamForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget)),hours=Number(f.hours||0);try{const r=await api('/api/custom-exams',{json:{name:f.name,price:f.price,turnaroundMinutes:hours>0?Math.round(hours*60):null}});toast(r.message);state.catalog=(await api('/api/catalog')).exams;renderPrices()}catch(er){toast(er.message,'error')}});
  if(state.me.role==='admin'){const cfg=(await api('/api/quote-site/settings')).settings,siteUrl=`${location.origin}/orcamento`;$('#content').insertAdjacentHTML('beforeend',`<section class="card quote-site-admin"><div class="price-page-head"><div><span class="price-kicker">SITE DE ORÇAMENTO</span><h3>Orçamento online</h3><p>O endereço acompanha automaticamente o domínio atual. Quando você colocar domínio próprio, não precisa alterar o código.</p></div><span class="badge ${cfg.enabled?'concluido':'cancelado'}">${cfg.enabled?'Ativado':'Desativado'}</span></div><form id="quoteSiteForm" class="quote-site-form"><label>Status<select name="enabled"><option value="1" ${cfg.enabled?'selected':''}>Ativado</option><option value="0" ${!cfg.enabled?'selected':''}>Desativado</option></select></label><label class="check-option"><input type="checkbox" name="showPrices" ${cfg.showPrices?'checked':''}> Mostrar valores dos exames</label><label class="check-option"><input type="checkbox" name="showServices" ${cfg.showServices?'checked':''}> Mostrar serviços adicionais</label><label>WhatsApp do laboratório<input name="whatsappPhone" value="${esc(cfg.whatsappPhone||'')}" placeholder="84999999999"></label><div class="site-link-box"><small>LINK DO SITE</small><strong>${esc(siteUrl)}</strong><div class="actions"><a class="btn soft small" href="${esc(siteUrl)}" target="_blank">Abrir site</a><button type="button" class="btn ghost small" id="copyQuoteSite">Copiar link</button></div></div><button class="btn primary">Salvar configuração</button></form></section>`);$('#copyQuoteSite').addEventListener('click',async()=>{await navigator.clipboard.writeText(siteUrl);toast('Link copiado.')});$('#quoteSiteForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const r=await api('/api/quote-site/settings',{method:'PUT',json:{enabled:f.get('enabled')==='1',showPrices:f.has('showPrices'),showServices:f.has('showServices'),whatsappPhone:f.get('whatsappPhone')}});toast(r.message);renderPrices()}catch(er){toast(er.message,'error')}})}
}

async function renderQuotes(){
  if(!(state.me.role==='client'||state.me.role==='admin'||(state.me.role==='staff'&&state.me.canMakeQuotes)))return navigate('dashboard');
  if(state.me.role!=='client')await loadAdminLists();let linkedReq=null,linkedQuote=null;if(state.quoteRequisitionId){try{linkedReq=await api(`/api/requisitions/${state.quoteRequisitionId}`);const ql=await api(`/api/quotes?requisitionId=${state.quoteRequisitionId}`);if(ql.quotes?.[0])linkedQuote=(await api(`/api/quotes/${ql.quotes[0].id}`)).quote}catch{}}
  const linkedR=linkedReq?.requisition||null,defaultClientId=state.me.role==='client'?Number(state.me.clientId||0):Number(linkedR?.client_id||linkedQuote?.client_id||0),internal=state.me.role!=='client';
  $('#content').innerHTML=`<div class="quote-layout"><section class="card quote-builder-card"><div class="section-title"><div><h3>${state.me.role==='client'?'Monte seu orçamento':'Gerar orçamento profissional'}</h3><p>Os valores vêm da precificação central. O exame precisa existir no cadastro: ninguém digita exame manualmente.</p></div></div><form id="quoteForm" class="stack">${internal?`<div class="quote-mode"><label><input type="radio" name="quoteMode" value="client" ${defaultClientId?'checked':''}> Cliente cadastrado</label><label><input type="radio" name="quoteMode" value="walk_in" ${!defaultClientId?'checked':''}> Avulso</label></div>`:''}<div class="form-grid">${internal?`<label class="field span2" id="quoteClientWrap">Cliente<select id="quoteClient"><option value="">Selecione</option>${state.clients.filter(c=>c.active).map(c=>`<option value="${c.id}" ${Number(c.id)===defaultClientId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="field span2 hidden" id="quoteWalkNameWrap">Nome do cliente avulso<input id="quoteWalkName" value="${esc(linkedQuote?.walk_in_name||'')}"></label><label class="field hidden" id="quoteWalkPhoneWrap">WhatsApp / telefone<input id="quoteWalkPhone" value="${esc(linkedQuote?.walk_in_phone||'')}"></label>`:''}<label class="field span2">Paciente / animal (opcional)<input id="quotePatient" value="${esc(linkedQuote?.patient_name||linkedR?.patient_name||'')}"></label><label class="field">Validade<input id="quoteValidity" type="date" value="${esc(linkedQuote?.valid_until||'')}"></label><label class="field span4">Observações<textarea id="quoteNotes">${esc(linkedQuote?.notes||'')}</textarea></label></div><div id="quoteCatalog" class="quote-catalog"><div class="empty-state">Carregando valores...</div></div><div class="quote-total-bar"><div><small>TOTAL DO ORÇAMENTO</small><strong id="quoteLiveTotal">R$ 0,00</strong></div><button class="btn primary" type="submit">Salvar orçamento</button></div></form></section><aside class="card quote-history"><div class="section-title"><div><h3>Orçamentos salvos</h3><p>PDF, WhatsApp e vínculo com solicitação.</p></div></div><div id="quoteHistory"></div></aside></div>`;
  if(internal)await setupOnlineQuoteTabs();
  const clientSelect=$('#quoteClient');let catalog=null;const mode=()=>state.me.role==='client'?'client':($('[name="quoteMode"]:checked')?.value||'walk_in'),clientId=()=>state.me.role==='client'?Number(state.me.clientId||0):(mode()==='client'?Number(clientSelect?.value||0):0);
  const syncMode=()=>{if(!internal)return;const av=mode()==='walk_in';$('#quoteClientWrap')?.classList.toggle('hidden',av);$('#quoteWalkNameWrap')?.classList.toggle('hidden',!av);$('#quoteWalkPhoneWrap')?.classList.toggle('hidden',!av)};
  const calc=()=>{let total=0;$$('[data-q-exam]:checked').forEach(i=>total+=Number(i.dataset.price||0));$$('[data-q-service]:checked').forEach(i=>total+=Number(i.dataset.price||0)*Math.max(1,Number($(`[data-q-qty="${i.dataset.qService}"]`)?.value||1)));$('#quoteLiveTotal').textContent=fmtMoney(total)};
  const renderCatalog=async()=>{const cid=clientId();if(mode()==='client'&&!cid){$('#quoteCatalog').innerHTML='<div class="empty-state">Selecione o cliente.</div>';return}try{catalog=await api(`/api/quotes/catalog${cid?`?clientId=${cid}`:''}`);const groups=new Map();for(const x of catalog.exams){if(!groups.has(x.category))groups.set(x.category,[]);groups.get(x.category).push(x)}$('#quoteCatalog').innerHTML=`<div class="quote-search-line"><input id="quoteExamSearch" placeholder="Pesquisar exame..."><small>Se não aparecer na busca, o laboratório precisa cadastrá-lo primeiro.</small></div><div class="quote-section-title">Exames</div><div class="quote-exam-grid" id="quoteExamGrid">${[...groups.entries()].map(([cat,items])=>`<section class="quote-group"><h4>${esc(cat)}</h4>${items.map(x=>`<label class="quote-choice ${x.priceCents==null?'disabled':''}" data-search="${esc((x.examName+' '+cat).toLowerCase())}"><input type="checkbox" data-q-exam="${x.examCode}" data-price="${x.priceCents||0}" ${x.priceCents==null?'disabled':''}><span>${esc(x.examName)}</span><strong>${x.priceCents==null?'Sem preço':fmtMoney(x.priceCents)}</strong></label>`).join('')}</section>`).join('')}</div><div class="quote-section-title">Serviços adicionais</div>${catalog.services.length?`<div class="quote-service-list">${catalog.services.map(x=>`<div class="quote-service-row"><label><input type="checkbox" data-q-service="${x.id}" data-price="${x.price_cents}"><span><b>${esc(x.name)}</b>${x.description?`<small>${esc(x.description)}</small>`:''}</span></label><strong>${fmtMoney(x.price_cents)}</strong><input class="quote-qty" data-q-qty="${x.id}" type="number" min="1" max="999" value="1"></div>`).join('')}</div>`:'<div class="muted">Nenhum serviço adicional cadastrado.</div>'}`;$$('[data-q-exam],[data-q-service],[data-q-qty]').forEach(x=>x.addEventListener('change',calc));$('#quoteExamSearch')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase().trim();$$('.quote-choice[data-search]').forEach(x=>x.classList.toggle('hidden',q&&!x.dataset.search.includes(q)))});if(linkedReq||linkedQuote){const selected=new Set(linkedQuote?linkedQuote.items.filter(i=>i.item_type==='exam').map(i=>i.item_ref):(linkedReq.exams||[]).map(e=>e.exam_code));$$('[data-q-exam]').forEach(i=>i.checked=selected.has(i.dataset.qExam));if(linkedQuote)for(const item of linkedQuote.items.filter(i=>i.item_type==='service')){const cb=$(`[data-q-service="${item.item_ref}"]`),qty=$(`[data-q-qty="${item.item_ref}"]`);if(cb)cb.checked=true;if(qty)qty.value=item.quantity}calc()}}catch(e){$('#quoteCatalog').innerHTML=`<div class="warning-box">${esc(e.message)}</div>`}};
  const loadHistory=async()=>{const cid=clientId(),qs=new URLSearchParams();if(cid)qs.set('clientId',cid);if(state.quoteRequisitionId)qs.set('requisitionId',state.quoteRequisitionId);const d=await api(`/api/quotes?${qs}`);$('#quoteHistory').innerHTML=d.quotes.length?d.quotes.map(q=>`<article class="quote-history-item"><div><strong>${esc(q.quote_number)}</strong><small>${esc(q.client_name||'Cliente avulso')} • ${esc(q.patient_name||'Sem paciente')} • ${fmtDateTime(q.updated_at)}</small></div><b>${fmtMoney(q.total_cents)}</b><div class="actions"><button class="btn ghost small" data-q-open="${q.id}">Abrir</button><button class="btn soft small" data-q-print="${q.id}">PDF</button><button class="btn soft small" data-q-share="${q.id}">WhatsApp</button>${state.me.role==='client'&&!q.requisition_id?`<button class="btn primary small" data-q-request="${q.id}">Criar solicitação</button>`:''}</div></article>`).join(''):'<div class="empty-state">Nenhum orçamento salvo.</div>';$$('[data-q-open]').forEach(b=>b.addEventListener('click',()=>openQuoteModal(Number(b.dataset.qOpen))));$$('[data-q-print]').forEach(b=>b.addEventListener('click',()=>printQuoteById(Number(b.dataset.qPrint))));$$('[data-q-share]').forEach(b=>b.addEventListener('click',()=>shareQuoteWhatsApp(Number(b.dataset.qShare))));$$('[data-q-request]').forEach(b=>b.addEventListener('click',()=>useQuoteForRequest(Number(b.dataset.qRequest))))};
  $$('[name="quoteMode"]').forEach(x=>x.addEventListener('change',async()=>{syncMode();await renderCatalog();await loadHistory()}));clientSelect?.addEventListener('change',async()=>{await renderCatalog();await loadHistory()});syncMode();
  $('#quoteForm').addEventListener('submit',async e=>{e.preventDefault();const cid=clientId();if(mode()==='client'&&!cid)return toast('Selecione o cliente.','error');const examCodes=$$('[data-q-exam]:checked').map(x=>x.dataset.qExam),services=$$('[data-q-service]:checked').map(x=>({id:Number(x.dataset.qService),quantity:Number($(`[data-q-qty="${x.dataset.qService}"]`)?.value||1)}));try{const x=await api('/api/quotes',{json:{quoteId:linkedQuote?.id||null,clientId:cid||null,walkInName:$('#quoteWalkName')?.value||'',walkInPhone:$('#quoteWalkPhone')?.value||'',requisitionId:state.quoteRequisitionId||null,patientName:$('#quotePatient').value,validUntil:$('#quoteValidity').value,notes:$('#quoteNotes').value,examCodes,services}});toast(x.message);linkedQuote=x.quote;await loadHistory();state.quoteRequisitionId=null;openQuoteModal(x.quote.id)}catch(er){toast(er.message,'error')}});await renderCatalog();await loadHistory();
}

async function openQuoteModal(id){try{const d=await api(`/api/quotes/${id}`),q=d.quote;modal(`<div class="quote-preview"><div class="quote-preview-head"><img src="/assets/hlabvet-logo.png" alt="HLabVet"><div><small>ORÇAMENTO</small><h2>${esc(q.quote_number)}</h2></div><strong>${fmtMoney(q.total_cents)}</strong></div><div class="quote-preview-meta"><div><small>CLIENTE</small><b>${esc(q.client_name)}</b></div><div><small>PACIENTE</small><b>${esc(q.patient_name||'—')}</b></div><div><small>VALIDADE</small><b>${q.valid_until?fmtDate(q.valid_until):'—'}</b></div></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${q.items.map(i=>`<tr><td>${esc(i.description)}<br><small>${i.item_type==='exam'?'Exame':'Serviço'}</small></td><td>${i.quantity}</td><td>${fmtMoney(i.unit_price_cents)}</td><td><strong>${fmtMoney(i.total_cents)}</strong></td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3"><strong>Total</strong></td><td><strong>${fmtMoney(q.total_cents)}</strong></td></tr></tfoot></table></div>${q.notes?`<div class="quote-notes"><b>Observações</b><p>${esc(q.notes)}</p></div>`:''}<div class="actions" style="margin-top:16px"><button class="btn primary" id="quotePdfBtn">PDF / Imprimir</button><button class="btn soft" id="quoteWhatsBtn">Enviar no WhatsApp</button>${state.me.role==='client'&&q.client_id&&!q.requisition_id?'<button class="btn secondary" id="quoteRequestBtn">Criar solicitação</button>':''}<button class="btn ghost" data-close-modal>Fechar</button></div></div>`);$('#quotePdfBtn').addEventListener('click',()=>printQuote(q));$('#quoteWhatsBtn').addEventListener('click',()=>shareQuoteWhatsApp(q.id));$('#quoteRequestBtn')?.addEventListener('click',()=>{closeModal();useQuoteForRequest(q.id)})}catch(e){toast(e.message,'error')}}
async function useQuoteForRequest(id){try{const d=await api(`/api/quotes/${id}`),q=d.quote;if(!q.client_id)return toast('Orçamento avulso precisa ser associado a um cliente antes de virar solicitação.','error');state.pendingQuote={quoteId:q.id,patientName:q.patient_name||'',examCodes:q.items.filter(i=>i.item_type==='exam').map(i=>i.item_ref)};navigate('new-request')}catch(e){toast(e.message,'error')}}
async function printQuoteById(id){try{const d=await api(`/api/quotes/${id}`);printQuote(d.quote)}catch(e){toast(e.message,'error')}}
function quotePrintCss(){return `@page{size:A4;margin:12mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{font-family:Arial,sans-serif;color:#2b2430;margin:0}.qpaper{border-top:7px solid #64236f;padding-top:18px}.qhead{display:flex;align-items:center;justify-content:space-between;gap:20px}.qhead img{width:150px}.qhead h1{color:#64236f;margin:0;font-size:25px}.qnum{text-align:right;color:#6c6370}.qmeta{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin:20px 0}.qmeta div{background:#f5eff7;border:1px solid #e1d4e5;border-radius:10px;padding:10px}.qmeta small{display:block;color:#766b79;font-size:9px;font-weight:bold}.qmeta b{font-size:12px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#64236f;color:white;text-align:left;padding:8px}td{border-bottom:1px solid #e7dfe9;padding:9px 8px}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.qtotal{margin-top:14px;display:flex;justify-content:flex-end}.qtotal div{background:#64236f;color:#fff;border-radius:12px;padding:13px 18px;min-width:210px;text-align:right}.qtotal small{display:block;font-size:9px}.qtotal b{font-size:23px}.qnotes{margin-top:18px;border:1px solid #ded5e0;border-radius:10px;padding:12px;font-size:11px}.qfoot{margin-top:28px;border-top:1px solid #ddd;padding-top:10px;color:#6e6571;font-size:9px;display:flex;justify-content:space-between}`}
function quotePrintHtml(q){return `<div class="qpaper"><div class="qhead"><img src="${location.origin}/assets/hlabvet-logo.png"><div><h1>ORÇAMENTO</h1><div class="qnum">${esc(q.quote_number)}</div></div></div><div class="qmeta"><div><small>CLIENTE</small><b>${esc(q.client_name)}</b>${q.document?`<br><span>${esc(q.document)}</span>`:''}</div><div><small>PACIENTE</small><b>${esc(q.patient_name||'—')}</b></div><div><small>VALIDADE</small><b>${q.valid_until?fmtDate(q.valid_until):'—'}</b></div></div><table><thead><tr><th>Descrição</th><th>Qtd.</th><th>Valor unitário</th><th>Total</th></tr></thead><tbody>${q.items.map(i=>`<tr><td>${esc(i.description)}<br><small>${i.item_type==='exam'?'Exame':'Serviço'}</small></td><td>${i.quantity}</td><td>${fmtMoney(i.unit_price_cents)}</td><td>${fmtMoney(i.total_cents)}</td></tr>`).join('')}</tbody></table><div class="qtotal"><div><small>VALOR TOTAL</small><b>${fmtMoney(q.total_cents)}</b></div></div>${q.notes?`<div class="qnotes"><b>Observações</b><br>${esc(q.notes)}</div>`:''}<div class="qfoot"><span>HLab Vet Resultados • Rua Américo Soares Wanderley, 1945 - Capim Macio, Natal/RN</span><span>(84) 99827-3567</span></div></div>`}
function printQuote(q){printWindow(`Orçamento ${q.quote_number}`,quotePrintHtml(q),quotePrintCss())}
async function shareQuoteWhatsApp(id){try{const d=await api(`/api/quotes/${id}`),q=d.quote;const phone=String(q.client_phone||'').replace(/\D/g,'');const text=`Olá! Segue o orçamento ${q.quote_number}${q.patient_name?` do paciente ${q.patient_name}`:''}. Valor total: ${fmtMoney(q.total_cents)}.${q.valid_until?` Válido até ${fmtDate(q.valid_until)}.`:''} O PDF pode ser anexado nesta conversa.`;window.open(`https://wa.me/${phone?`55${phone.replace(/^55/,'')}`:''}?text=${encodeURIComponent(text)}`,'_blank','noopener')}catch(e){toast(e.message,'error')}}


function onlineLeadLabel(v){return v==='contacted'?'Contatado':v==='converted'?'Convertido':v==='closed'?'Encerrado':'Novo';}
function onlineLeadClass(v){return v==='converted'?'concluido':v==='closed'?'cancelado':v==='contacted'?'recebido':'solicitado';}
async function openSiteCustomerRecord(id,onChanged){
  try{
    const d=await api(`/api/site-customers/${id}`),c=d.customer,pets=d.pets||[],requests=d.requests||[],isAdmin=state.me.role==='admin';
    modal(`<div class="site-customer-modal"><div class="section-title"><div><h3>Cadastro do cliente do site</h3><p>Este cadastro é reaproveitado sempre que o mesmo telefone fizer uma nova solicitação.</p></div>${c.tutor_account_id?'<span class="badge concluido">Painel liberado</span>':'<span class="badge solicitado">Cadastro do site</span>'}</div><form id="siteCustomerRecordForm" class="stack"><div class="form-grid"><label class="field span2">Nome do responsável<input name="name" value="${esc(c.name||'')}" ${isAdmin?'':'disabled'} required></label><label class="field">WhatsApp<input name="phone" value="${esc(c.phone_display||'')}" ${isAdmin?'':'disabled'} required></label><label class="field">E-mail<input name="email" type="email" value="${esc(c.email||'')}" ${isAdmin?'':'disabled'}></label><label class="field span4">Endereço de coleta / cadastro<input name="address" value="${esc(c.address||'')}" ${isAdmin?'':'disabled'}></label><label class="field span2">Cidade<input name="city" value="${esc(c.city||'Natal')}" ${isAdmin?'':'disabled'}></label><label class="field">UF<input name="state" value="${esc(c.state||'RN')}" maxlength="2" ${isAdmin?'':'disabled'}></label><label class="field">CEP<input name="zipCode" value="${esc(c.zip_code||'')}" ${isAdmin?'':'disabled'}></label></div>${isAdmin?`<div class="actions"><button class="btn primary">Salvar cadastro</button>${!c.tutor_account_id?'<button type="button" class="btn secondary" id="grantSiteCustomerPanelBtn">Liberar painel do cliente</button>':''}<button type="button" class="btn ghost" data-close-modal>Fechar</button></div>`:'<div class="actions"><button type="button" class="btn ghost" data-close-modal>Fechar</button></div>'}</form><div class="site-customer-history"><h4>Animais cadastrados</h4>${pets.length?`<div class="site-customer-pets">${pets.map(p=>`<div><strong>${esc(p.name)}</strong><small>Nascimento: ${p.birth_date?fmtDate(p.birth_date):'—'}${p.species?` • ${esc(p.species)}`:''}${p.breed?` • ${esc(p.breed)}`:''}</small></div>`).join('')}</div>`:'<p class="muted">Nenhum animal cadastrado.</p>'}<h4>Histórico de solicitações</h4>${requests.length?`<div class="table-wrap"><table><thead><tr><th>Data</th><th>Protocolo</th><th>Paciente</th><th>Status</th><th>Resultado</th></tr></thead><tbody>${requests.map(r=>`<tr><td>${fmtDateTime(r.created_at)}</td><td><strong>${esc(r.protocol)}</strong></td><td>${esc(r.patient_name||'—')}</td><td><span class="badge ${esc(r.status)}">${esc(r.status_label||r.status)}</span></td><td>${(r.files||[]).length?`${r.files.length} arquivo(s)`:'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Este cliente ainda não confirmou nenhuma solicitação.</p>'}</div></div>`);
    if(isAdmin){
      $('#siteCustomerRecordForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const r=await api(`/api/site-customers/${id}`,{method:'PATCH',json:{name:f.get('name'),phone:f.get('phone'),email:f.get('email'),address:f.get('address'),city:f.get('city'),state:f.get('state'),zipCode:f.get('zipCode')}});toast(r.message);if(onChanged)await onChanged();await openSiteCustomerRecord(id,onChanged)}catch(er){toast(er.message,'error')}});
      $('#grantSiteCustomerPanelBtn')?.addEventListener('click',()=>grantSiteCustomerPanelAccess(id,c,onChanged));
    }
  }catch(e){toast(e.message,'error')}
}
async function grantSiteCustomerPanelAccess(id,customer,onChanged){
  const suggested=String(customer.phone_display||'').replace(/\D/g,'');
  modal(`<div class="site-customer-modal"><h3>Liberar painel para ${esc(customer.name||'cliente')}</h3><p class="muted">O cadastro já existente será aproveitado. As solicitações e resultados anteriores também ficarão ligados ao painel.</p><form id="grantSiteCustomerPanelForm" class="stack"><label class="field">Usuário de acesso<input name="username" value="${esc(suggested)}" required></label><label class="field">Senha temporária<input name="password" type="password" minlength="8" autocomplete="new-password" required><small>Mínimo de 8 caracteres. O cliente será obrigado a trocar no primeiro acesso.</small></label><div class="actions"><button class="btn primary">Liberar painel</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form></div>`);
  $('#grantSiteCustomerPanelForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const r=await api(`/api/site-customers/${id}/grant-panel`,{method:'POST',json:{username:f.get('username'),password:f.get('password')}});toast(`${r.message} Usuário: ${r.username}`);closeModal();if(onChanged)await onChanged()}catch(er){toast(er.message,'error')}});
}
async function setupOnlineQuoteTabs(){
  const layout=$('.quote-layout');if(!layout)return;layout.id='quoteInternalPanel';
  const first=today().slice(0,8)+'01',summary=await api('/api/quotes?source=online');
  $('#content').insertAdjacentHTML('afterbegin',`<div class="quote-subtabs"><button class="quote-subtab active" data-quote-tab="internal">Criar orçamento</button><button class="quote-subtab" data-quote-tab="online">Orçamentos online <span id="onlineQuoteBadge" class="quote-count">${Number(summary.onlineNewCount||0)}</span></button></div>`);
  $('#content').insertAdjacentHTML('beforeend',`<section id="onlineQuotesPanel" class="card online-quotes-panel hidden"><div class="section-title"><div><h3>Orçamentos solicitados pelo site</h3><p>As cotações ficam ligadas ao cadastro do cliente. Quando ele confirma, a solicitação entra automaticamente no fluxo normal do laboratório.</p></div></div><form id="onlineQuoteFilters" class="online-quote-filters"><label>De<input name="from" type="date" value="${first}"></label><label>Até<input name="to" type="date" value="${today()}"></label><label>Status<select name="leadStatus"><option value="">Todos</option><option value="new">Novos</option><option value="contacted">Contatados</option><option value="converted">Convertidos</option><option value="closed">Encerrados</option></select></label><button class="btn primary">Buscar</button></form><div id="onlineQuoteList"><div class="empty-state">Carregando...</div></div></section>`);
  const load=async()=>{
    const qs=new URLSearchParams(new FormData($('#onlineQuoteFilters')));qs.set('source','online');for(const[k,v]of[...qs])if(!v)qs.delete(k);const d=await api(`/api/quotes?${qs}`);$('#onlineQuoteBadge').textContent=Number(d.onlineNewCount||0);
    $('#onlineQuoteList').innerHTML=d.quotes.length?`<div class="table-wrap"><table class="online-quote-table"><thead><tr><th>Data</th><th>Cliente</th><th>Contato</th><th>Paciente</th><th>Total</th><th>Status</th><th>Ações</th></tr></thead><tbody>${d.quotes.map(q=>`<tr><td>${fmtDateTime(q.created_at)}</td><td><strong>${esc(q.walk_in_name||q.client_name||'Cliente')}</strong>${q.lead_email?`<br><small>${esc(q.lead_email)}</small>`:''}${q.site_customer_address?`<br><small>${esc(q.site_customer_address)}</small>`:''}<br><small>${esc(q.quote_number)}</small></td><td>${esc(q.walk_in_phone||'—')}</td><td><strong>${esc(q.patient_name||'—')}</strong>${q.patient_birth_date?`<br><small>Nasc.: ${fmtDate(q.patient_birth_date)}</small>`:''}</td><td><strong>${fmtMoney(q.total_cents)}</strong></td><td><span class="badge ${onlineLeadClass(q.lead_status)}">${onlineLeadLabel(q.lead_status)}</span>${q.requisition_protocol?`<br><small>${esc(q.requisition_protocol)}</small>`:''}${q.site_tutor_account_id?'<br><small>Painel liberado</small>':''}</td><td><div class="actions"><button class="btn ghost small" data-online-open="${q.id}">Abrir</button>${q.site_customer_id?`<button class="btn soft small" data-site-customer="${q.site_customer_id}">Cadastro</button>`:''}${q.walk_in_phone?`<button class="btn secondary small" data-online-whats="${q.id}" data-phone="${esc(q.walk_in_phone)}" data-name="${esc(q.walk_in_name||'')}">WhatsApp</button>`:''}<select class="online-status-select" data-online-status="${q.id}"><option value="new" ${(q.lead_status||'new')==='new'?'selected':''}>Novo</option><option value="contacted" ${q.lead_status==='contacted'?'selected':''}>Contatado</option><option value="converted" ${q.lead_status==='converted'?'selected':''}>Convertido</option><option value="closed" ${q.lead_status==='closed'?'selected':''}>Encerrado</option></select></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">Nenhum orçamento online encontrado no período.</div>';
    $$('[data-online-open]').forEach(b=>b.addEventListener('click',()=>openQuoteModal(Number(b.dataset.onlineOpen))));
    $$('[data-site-customer]').forEach(b=>b.addEventListener('click',()=>openSiteCustomerRecord(Number(b.dataset.siteCustomer),load)));
    $$('[data-online-whats]').forEach(b=>b.addEventListener('click',async()=>{const id=Number(b.dataset.onlineWhats),phone=String(b.dataset.phone||'').replace(/\D/g,''),name=b.dataset.name||'';window.open(`https://wa.me/${phone?`55${phone.replace(/^55/,'')}`:''}?text=${encodeURIComponent(`Olá${name?` ${name}`:''}! Recebemos sua cotação pelo site do HLab Vet e gostaríamos de confirmar se deseja realizar os exames/serviços.`)}`,'_blank','noopener');try{await api(`/api/quotes/${id}/lead-status`,{method:'PATCH',json:{status:'contacted'}});await load()}catch{}}));
    $$('[data-online-status]').forEach(sel=>sel.addEventListener('change',async()=>{try{const r=await api(`/api/quotes/${sel.dataset.onlineStatus}/lead-status`,{method:'PATCH',json:{status:sel.value}});toast(r.message);await load()}catch(e){toast(e.message,'error')}}));
  };
  $('#onlineQuoteFilters').addEventListener('submit',e=>{e.preventDefault();load()});
  $$('[data-quote-tab]').forEach(b=>b.addEventListener('click',async()=>{$$('[data-quote-tab]').forEach(x=>x.classList.toggle('active',x===b));const online=b.dataset.quoteTab==='online';layout.classList.toggle('hidden',online);$('#onlineQuotesPanel').classList.toggle('hidden',!online);if(online)await load()}));
}

async function siteOfferEditor(offer=null){
  const type=offer?.offer_type||'service';
  modal(`<div class="site-editor-modal"><h3>${offer?'Editar conteúdo':'Novo conteúdo do site'}</h3><p class="muted">Cadastre serviço, produto ou promoção. Promoções podem abrir como propaganda automática ao entrar no site.</p><form id="siteOfferForm" class="stack"><div class="form-grid"><label class="field">Tipo<select name="offerType" id="siteOfferType"><option value="service" ${type==='service'?'selected':''}>Serviço</option><option value="product" ${type==='product'?'selected':''}>Produto</option><option value="promotion" ${type==='promotion'?'selected':''}>Promoção</option></select></label><label class="field span2">Título<input name="title" value="${esc(offer?.title||'')}" required></label><label class="field">Selo<input name="badge" value="${esc(offer?.badge||'')}" placeholder="Ex.: Oferta do mês"></label><label class="field span4">Descrição<textarea name="description">${esc(offer?.description||'')}</textarea></label><label class="field">Preço normal (R$)<input name="price" inputmode="decimal" value="${offer?.price_cents!=null?(offer.price_cents/100).toFixed(2).replace('.',','):''}" placeholder="0,00"></label><label class="field">Preço promocional (R$)<input name="promoPrice" inputmode="decimal" value="${offer?.promo_price_cents!=null?(offer.promo_price_cents/100).toFixed(2).replace('.',','):''}" placeholder="0,00"></label><label class="field">Botão<input name="buttonText" value="${esc(offer?.button_text||'Quero saber mais')}"></label><label class="field">Ordem<input name="sortOrder" type="number" value="${Number(offer?.sort_order||0)}"></label><label class="field">Status<select name="active"><option value="1" ${offer?.active!==0?'selected':''}>Ativo</option><option value="0" ${offer?.active===0?'selected':''}>Inativo</option></select></label><label class="field span2">Foto JPG/PNG/WEBP<input name="image" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="check-option span2" id="sitePopupOption"><input type="checkbox" name="showPopup" ${Number(offer?.show_popup||0)?'checked':''}> Abrir esta promoção como propaganda ao entrar no site</label><label class="field" id="sitePopupSeconds">Fechar automaticamente após<input name="popupSeconds" type="number" min="1" max="30" value="${Number(offer?.popup_seconds||5)}"><small>segundos • o visitante também pode fechar no X</small></label></div><div class="actions"><button class="btn primary">Salvar</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form></div>`);
  const syncPopupFields=()=>{const promotion=$('#siteOfferType')?.value==='promotion';$('#sitePopupOption')?.classList.toggle('hidden',!promotion);$('#sitePopupSeconds')?.classList.toggle('hidden',!promotion)};$('#siteOfferType')?.addEventListener('change',syncPopupFields);syncPopupFields();
  $('#siteOfferForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),body={offerType:fd.get('offerType'),title:fd.get('title'),badge:fd.get('badge'),description:fd.get('description'),price:fd.get('price'),promoPrice:fd.get('promoPrice'),buttonText:fd.get('buttonText'),sortOrder:Number(fd.get('sortOrder')||0),active:fd.get('active')==='1',showPopup:fd.has('showPopup'),popupSeconds:Number(fd.get('popupSeconds')||5)};try{const r=await api(offer?`/api/site/offers/${offer.id}`:'/api/site/offers',{method:offer?'PATCH':'POST',json:body});const id=offer?.id||r.id,file=fd.get('image');if(file&&file.size){const up=new FormData();up.append('file',file);const res=await fetch(`/api/site/offers/${id}/image`,{method:'POST',body:up,credentials:'include'}),x=await res.json();if(!res.ok)throw new Error(x.error||'Falha ao enviar imagem.')}toast(offer?'Conteúdo atualizado.':'Conteúdo criado.');closeModal();renderSiteManager()}catch(er){toast(er.message,'error')}});
}

async function sitePartnerEditor(partner=null){
  modal(`<div class="site-editor-modal"><h3>${partner?'Editar parceiro':'Novo parceiro / cliente'}</h3><p class="muted">Cadastre clientes e parceiros que poderão aparecer no painel de logos do site.</p><form id="sitePartnerForm" class="stack"><div class="form-grid"><label class="field span2">Nome<input name="name" value="${esc(partner?.name||'')}" required></label><label class="field span2">Site do parceiro (opcional)<input name="websiteUrl" value="${esc(partner?.website_url||'')}" placeholder="https://..."></label><label class="field">Ordem<input name="sortOrder" type="number" value="${Number(partner?.sort_order||0)}"></label><label class="field">Status<select name="active"><option value="1" ${partner?.active!==0?'selected':''}>Ativo</option><option value="0" ${partner?.active===0?'selected':''}>Inativo</option></select></label><label class="field span2">Logo JPG/PNG/WEBP<input name="image" type="file" accept="image/jpeg,image/png,image/webp" ${partner?.logoUrl?'':'required'}></label></div><div class="actions"><button class="btn primary">Salvar parceiro</button><button type="button" class="btn ghost" data-close-modal>Cancelar</button></div></form></div>`);
  $('#sitePartnerForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),body={name:fd.get('name'),websiteUrl:fd.get('websiteUrl'),sortOrder:Number(fd.get('sortOrder')||0),active:fd.get('active')==='1'};try{const r=await api(partner?`/api/site/partners/${partner.id}`:'/api/site/partners',{method:partner?'PATCH':'POST',json:body});const id=partner?.id||r.id,file=fd.get('image');if(file&&file.size){const up=new FormData();up.append('file',file);const res=await fetch(`/api/site/partners/${id}/image`,{method:'POST',body:up,credentials:'include'}),x=await res.json();if(!res.ok)throw new Error(x.error||'Falha ao enviar logo.')}toast(partner?'Parceiro atualizado.':'Parceiro cadastrado.');closeModal();renderSiteManager()}catch(er){toast(er.message,'error')}});
}

async function renderSiteManager(){
  if(!(state.me.role==='admin'||(state.me.role==='staff'&&state.me.canMakeQuotes)))return navigate('dashboard');
  const [offerData,partnerData]=await Promise.all([api('/api/site/offers'),api('/api/site/partners')]);
  const offers=offerData.offers||[],partners=partnerData.partners||[],admin=state.me.role==='admin',siteUrl=`${location.origin}/site`,quoteUrl=`${location.origin}/orcamento`;
  const tabMediaDefs=[['home','Início'],['quote','Faça sua cotação'],['offers','Serviços e promoções'],['location','Localização'],['careers','Trabalhe conosco'],['contact','Contato']];
  let settings=null,quoteCfg=null,tabMedia={};if(admin){settings=(await api('/api/site/settings')).settings;quoteCfg=(await api('/api/quote-site/settings')).settings;tabMedia=(await api('/api/site/tab-media')).media||{};}
  $('#topActions').innerHTML=`<a class="btn soft" href="${siteUrl}" target="_blank">Abrir site</a><button class="btn primary" id="newSiteOffer">＋ Conteúdo</button><button class="btn secondary" id="newSitePartner">＋ Parceiro</button>`;
  $('#content').innerHTML=`${admin?`<section class="card site-admin-settings"><div class="price-page-head"><div><span class="price-kicker">SITE PÚBLICO</span><h3>Configurações e endereço</h3><p>O link usa o domínio atual automaticamente. Depois de configurar seu domínio no Cloudflare, o endereço muda sozinho.</p></div><span class="badge ${settings.enabled?'concluido':'cancelado'}">${settings.enabled?'Ativado':'Desativado'}</span></div><div class="site-link-grid"><div><small>LINK DO SITE</small><strong>${esc(siteUrl)}</strong><button class="btn ghost small" data-copy-site="${esc(siteUrl)}">Copiar</button></div><div><small>LINK DIRETO DA COTAÇÃO</small><strong>${esc(quoteUrl)}</strong><button class="btn ghost small" data-copy-site="${esc(quoteUrl)}">Copiar</button></div></div><form id="siteSettingsForm" class="stack"><div class="form-grid"><label class="field">Site<select name="enabled"><option value="1" ${settings.enabled?'selected':''}>Ativado</option><option value="0" ${!settings.enabled?'selected':''}>Desativado</option></select></label><label class="field">Cotação online<select name="quoteEnabled"><option value="1" ${quoteCfg.enabled?'selected':''}>Ativada</option><option value="0" ${!quoteCfg.enabled?'selected':''}>Desativada</option></select></label><label class="field span2">Nome exibido<input name="companyName" value="${esc(settings.companyName||'')}"></label><label class="field span4">Título principal<input name="headline" value="${esc(settings.headline||'')}"></label><label class="field span4">Subtítulo<textarea name="subheadline">${esc(settings.subheadline||'')}</textarea></label><label class="field">WhatsApp<input name="whatsappPhone" value="${esc(settings.whatsappPhone||quoteCfg.whatsappPhone||'')}"></label><label class="field">E-mail de contato<input name="contactEmail" type="email" value="${esc(settings.contactEmail||'')}"></label><label class="field">E-mail Trabalhe conosco<input name="careersEmail" type="email" value="${esc(settings.careersEmail||'')}"></label><label class="field span2">Endereço<input name="address" value="${esc(settings.address||'')}"></label><label class="field span2">Localização exata no Google Maps<input name="mapUrl" value="${esc(settings.mapUrl||'')}" placeholder="https://maps.app.goo.gl/..."><small>Use o link de Compartilhar do Google Maps.</small></label><label class="field span2">Link para incorporar o mapa (opcional)<input name="mapEmbedUrl" value="${esc(settings.mapEmbedUrl||'')}" placeholder="https://www.google.com/maps/embed?... ou ...&output=embed"><small>Se o link curto não puder ser convertido automaticamente, cole aqui o link de “Incorporar um mapa” do Google Maps.</small></label><label class="check-option"><input type="checkbox" name="showPrices" ${quoteCfg.showPrices?'checked':''}> Mostrar preços</label><label class="check-option"><input type="checkbox" name="showServices" ${quoteCfg.showServices?'checked':''}> Mostrar serviços na cotação</label></div><button class="btn primary">Salvar configurações</button></form></section><section class="card site-tab-media-admin"><div class="section-title"><div><h3>Imagens das abas</h3><p>Aqui você escolhe a imagem de cada aba do site. JPG, PNG ou WEBP, até 8 MB.</p></div></div><div class="site-tab-media-grid">${tabMediaDefs.map(([slot,label])=>{const media=tabMedia?.[slot];return `<article class="site-tab-media-card"><div class="site-tab-media-preview">${media?.imageUrl?`<img src="${esc(media.imageUrl)}" alt="${esc(label)}">`:`<div><b>${esc(label)}</b><small>Sem imagem</small></div>`}</div><div class="site-tab-media-body"><strong>${esc(label)}</strong><input type="file" accept="image/jpeg,image/png,image/webp" data-tab-image-input="${slot}"><div class="actions"><button type="button" class="btn primary small" data-upload-tab-image="${slot}">Salvar imagem</button>${media?.imageUrl?`<button type="button" class="btn danger small" data-delete-tab-image="${slot}">Remover</button>`:''}</div></div></article>`}).join('')}</div></section>`:''}<section class="card site-content-admin"><div class="section-title"><div><h3>Produtos, serviços e promoções</h3><p>Promoções podem abrir como propaganda na entrada do site e fechar sozinhas após o tempo configurado.</p></div><button class="btn primary" id="newSiteOffer2">＋ Adicionar</button></div><div class="site-offer-admin-grid">${offers.length?offers.map(o=>`<article class="site-offer-admin-card">${o.imageUrl?`<img src="${esc(o.imageUrl)}" alt="">`:'<div class="site-offer-placeholder">HLab Vet</div>'}<div><span class="site-offer-type">${o.offer_type==='product'?'Produto':o.offer_type==='promotion'?'Promoção':'Serviço'}</span><h4>${esc(o.title)}</h4><p>${esc(o.description||'')}</p><div class="site-offer-price-admin">${o.promo_price_cents!=null?`<del>${o.price_cents!=null?fmtMoney(o.price_cents):''}</del><strong>${fmtMoney(o.promo_price_cents)}</strong>`:o.price_cents!=null?`<strong>${fmtMoney(o.price_cents)}</strong>`:''}</div><div class="site-offer-badges"><span class="badge ${o.active?'concluido':'cancelado'}">${o.active?'Ativo':'Inativo'}</span>${Number(o.show_popup)?`<span class="badge coletado">Propaganda • ${Number(o.popup_seconds||5)}s</span>`:''}</div></div><button class="btn ghost small" data-edit-site-offer="${o.id}">Editar</button></article>`).join(''):'<div class="empty-state">Nenhum conteúdo cadastrado.</div>'}</div></section><section class="card site-partners-admin"><div class="section-title"><div><h3>Parceiros e clientes</h3><p>Cadastre as logos que ficarão passando automaticamente na aba Parceiros.</p></div><button class="btn secondary" id="newSitePartner2">＋ Adicionar parceiro</button></div><div class="site-partner-admin-grid">${partners.length?partners.map(x=>`<article class="site-partner-admin-card"><div class="site-partner-logo-admin">${x.logoUrl?`<img src="${esc(x.logoUrl)}" alt="${esc(x.name)}">`:'<span>Sem logo</span>'}</div><div><h4>${esc(x.name)}</h4>${x.website_url?`<small>${esc(x.website_url)}</small>`:''}<br><span class="badge ${x.active?'concluido':'cancelado'}">${x.active?'Ativo':'Inativo'}</span></div><button class="btn ghost small" data-edit-site-partner="${x.id}">Editar</button></article>`).join(''):'<div class="empty-state">Nenhum parceiro cadastrado.</div>'}</div></section>`;
  $('#newSiteOffer')?.addEventListener('click',()=>siteOfferEditor());$('#newSiteOffer2')?.addEventListener('click',()=>siteOfferEditor());
  $('#newSitePartner')?.addEventListener('click',()=>sitePartnerEditor());$('#newSitePartner2')?.addEventListener('click',()=>sitePartnerEditor());
  $$('[data-edit-site-offer]').forEach(b=>b.addEventListener('click',()=>siteOfferEditor(offers.find(x=>Number(x.id)===Number(b.dataset.editSiteOffer)))));
  $$('[data-edit-site-partner]').forEach(b=>b.addEventListener('click',()=>sitePartnerEditor(partners.find(x=>Number(x.id)===Number(b.dataset.editSitePartner)))));
  $$('[data-copy-site]').forEach(b=>b.addEventListener('click',async()=>{await navigator.clipboard.writeText(b.dataset.copySite);toast('Link copiado.')}));
  $$('[data-upload-tab-image]').forEach(b=>b.addEventListener('click',async()=>{const slot=b.dataset.uploadTabImage,input=$(`[data-tab-image-input="${slot}"]`),file=input?.files?.[0];if(!file)return toast('Selecione uma imagem para esta aba.','error');const fd=new FormData();fd.append('file',file);b.disabled=true;try{const res=await fetch(`/api/site/tab-media/${encodeURIComponent(slot)}`,{method:'POST',body:fd,credentials:'include'}),x=await res.json();if(!res.ok)throw new Error(x.error||'Falha ao enviar imagem.');toast(x.message);renderSiteManager()}catch(er){toast(er.message,'error')}finally{if(document.body.contains(b))b.disabled=false}}));
  $$('[data-delete-tab-image]').forEach(b=>b.addEventListener('click',async()=>{const slot=b.dataset.deleteTabImage;if(!confirm('Remover a imagem desta aba?'))return;try{const r=await api(`/api/site/tab-media/${encodeURIComponent(slot)}`,{method:'DELETE'});toast(r.message);renderSiteManager()}catch(er){toast(er.message,'error')}}));
  $('#siteSettingsForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/site/settings',{method:'PUT',json:{enabled:f.get('enabled')==='1',companyName:f.get('companyName'),headline:f.get('headline'),subheadline:f.get('subheadline'),whatsappPhone:f.get('whatsappPhone'),contactEmail:f.get('contactEmail'),careersEmail:f.get('careersEmail'),address:f.get('address'),mapUrl:f.get('mapUrl'),mapEmbedUrl:f.get('mapEmbedUrl')}});await api('/api/quote-site/settings',{method:'PUT',json:{enabled:f.get('quoteEnabled')==='1',showPrices:f.has('showPrices'),showServices:f.has('showServices'),whatsappPhone:f.get('whatsappPhone')}});toast('Site atualizado.');renderSiteManager()}catch(er){toast(er.message,'error')}});
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

async function renderCourierPortal(token=null){
  $('#loginView').classList.add('hidden');$('#appView').classList.add('hidden');$('#courierView').classList.remove('hidden');
  document.body.classList.add('courier-mobile-mode');
  let tab='pending',currentUnaccepted=0,audioBlocked=false,lastPendingSignature='',pollTimer=null;
  const ringAudio=new Audio('/assets/toque_cooperado_triiiim.wav');ringAudio.loop=true;ringAudio.preload='auto';ringAudio.volume=1;
  const stopRing=()=>{try{ringAudio.pause();ringAudio.currentTime=0}catch{}};
  const unlockCourierAudio=async()=>{try{const volume=ringAudio.volume;ringAudio.volume=0;await ringAudio.play();ringAudio.pause();ringAudio.currentTime=0;ringAudio.volume=volume;audioBlocked=false;if(currentUnaccepted)await ringAudio.play();updateSoundGate();return true}catch{ringAudio.volume=1;audioBlocked=true;updateSoundGate();return false}};
  const updateSoundGate=()=>{const gate=$('#courierSoundGate');if(!gate)return;if(currentUnaccepted>0&&audioBlocked){gate.classList.remove('hidden');gate.innerHTML=`<div><strong>🔔 NOVA COLETA</strong><small>O celular bloqueou o toque automático. Toque abaixo uma vez para liberar o som.</small></div><button type="button" class="courier-sound-button" data-enable-courier-sound>ATIVAR SOM</button>`;$('[data-enable-courier-sound]',gate)?.addEventListener('click',unlockCourierAudio)}else{gate.classList.add('hidden');gate.innerHTML=''}};
  const syncRing=async tasks=>{currentUnaccepted=(tasks||[]).filter(t=>t.status==='atribuido'&&!t.courier_accepted_at).length;if(!currentUnaccepted){audioBlocked=false;stopRing();updateSoundGate();return}try{await ringAudio.play();audioBlocked=false}catch{audioBlocked=true}updateSoundGate()};
  const pendingSignature=tasks=>(tasks||[]).map(t=>`${t.id}:${t.status}:${t.courier_accepted_at||''}`).sort().join('|');
  const endpoint=suffix=>token?`/api/courier/${encodeURIComponent(token)}/${suffix}`:`/api/courier/${suffix}`;
  const render=async()=>{try{
    const oldFrom=$('#courierFrom')?.value||'',oldTo=$('#courierTo')?.value||'';
    const qs=new URLSearchParams({tab});if(tab==='collected'&&oldFrom)qs.set('from',oldFrom);if(tab==='collected'&&oldTo)qs.set('to',oldTo);
    const d=await api(`${endpoint('tasks')}?${qs}`);
    $('#courierView').innerHTML=`<div class="courier-shell"><header class="courier-head"><div class="inner"><img src="/assets/hlabvet-logo.png" alt="HLabVet"><div class="courier-ident"><strong>${esc(d.courier.name)}</strong><small>Entregador HLabVet • ${esc(d.courier.thermometer_code||'Sem termômetro')}</small></div>${!token?`<div class="actions" style="margin-left:auto"><button type="button" class="btn ghost small" data-courier-password>Senha</button><button type="button" class="btn ghost small" data-courier-logout>Sair</button></div>`:''}</div></header><div id="courierSoundGate" class="courier-sound-gate hidden"></div><main class="courier-main"><div class="courier-tabs"><button class="courier-tab ${tab==='pending'?'active':''}" data-tab="pending"><span>Pendentes</span></button><button class="courier-tab ${tab==='collected'?'active':''}" data-tab="collected"><span>Histórico</span></button></div>${tab==='collected'?`<details class="courier-filter-box"><summary>Filtrar período</summary><div class="courier-filter-grid"><label>De<input id="courierFrom" type="date" value="${esc(oldFrom)}"></label><label>Até<input id="courierTo" type="date" value="${esc(oldTo)}"></label><button class="btn ghost" id="courierFilter">Aplicar filtro</button></div></details>`:''}<div class="courier-task-list">${d.tasks.length?d.tasks.map(t=>courierTask(t,tab)).join(''):`<div class="courier-empty">${tab==='pending'?'Nenhuma coleta pendente agora.':'Nenhuma coleta encontrada neste período.'}</div>`}</div></main></div>`;
    $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.tab;render()}));$('#courierFilter')?.addEventListener('click',render);
    $('[data-courier-password]')?.addEventListener('click',()=>showCourierPasswordChange(false));$('[data-courier-logout]')?.addEventListener('click',courierLogout);
    $$('[data-accept-courier]').forEach(b=>b.addEventListener('click',()=>acceptCourierTask(endpoint,Number(b.dataset.acceptCourier),render,pollPending)));
    $$('[data-collect]').forEach(b=>b.addEventListener('click',()=>collectTask(endpoint,Number(b.dataset.collect),render,pollPending)));
    if(tab==='pending'){lastPendingSignature=pendingSignature(d.tasks);await syncRing(d.tasks)}else updateSoundGate();
  }catch(e){stopRing();if(!token&&e.status===428)return showCourierPasswordChange(true);if(!token&&e.status===401)return showCourierLogin();$('#courierView').innerHTML=`<div class="courier-shell"><div class="courier-error"><img src="/assets/hlabvet-logo.png"><h2>${token?'Link inválido':'Acesso indisponível'}</h2><p>${esc(e.message)}</p></div></div>`}};
  const pollPending=async()=>{try{const d=await api(`${endpoint('tasks')}?tab=pending`);await syncRing(d.tasks);const sig=pendingSignature(d.tasks);if(sig!==lastPendingSignature){lastPendingSignature=sig;const editing=document.activeElement?.closest?.('.courier-collect-form');if(tab==='pending'&&!editing)await render()}}catch(e){if(!token&&e.status===401){clearInterval(pollTimer);stopRing();showCourierLogin()}}};
  document.addEventListener('pointerdown',unlockCourierAudio,{once:true});document.addEventListener('keydown',unlockCourierAudio,{once:true});window.addEventListener('pagehide',()=>{clearInterval(pollTimer);stopRing()},{once:true});
  await render();await pollPending();pollTimer=setInterval(pollPending,6000);
}

function courierTask(t,tab){
  const address=[t.address,t.city,t.state].filter(Boolean).join(', '),routeDestination=address||t.client_name||'',mapsUrl=t.map_url||`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(routeDestination)}`,accepted=Boolean(t.courier_accepted_at);
  return `<article class="courier-task-card"><div class="courier-task-top"><div><small>${esc(t.protocol)}</small><h3>${esc(t.client_name)}</h3><p>${esc(t.patient_name)}${t.species?` • ${esc(t.species)}`:''}</p></div><span class="badge ${t.status}">${esc(STATUS[t.status]||t.status)}</span></div><div class="courier-info-row"><span>📍</span><div><small>LOCAL DA COLETA</small><strong>${esc(address||t.client_name)}</strong></div></div><div class="courier-info-grid"><div><small>TERMÔMETRO</small><strong>${esc(t.thermometer_code||'—')}</strong></div><div><small>CONTATO</small><strong>${esc(t.phone||'—')}</strong></div></div><a class="courier-route" href="${esc(mapsUrl)}" target="_blank" rel="noopener noreferrer">🗺️ ABRIR LOCALIZAÇÃO NO GOOGLE MAPS</a>${t.payment_status==='collect'?`<div class="courier-payment-box"><small>PAGAMENTO NA COLETA</small><strong>${fmtMoney(t.payment_amount_cents)}</strong><span>${paymentMethodLabel(t.payment_method)}${t.payment_method==='credit'?` • ${Number(t.payment_installments||1)}x`:''}</span></div>`:''}${tab==='pending'&&!accepted?`<div class="courier-accept-box"><strong>Nova coleta atribuída a você</strong><small>O toque continuará até você aceitar esta coleta.</small><button class="courier-accept-action" type="button" data-accept-courier="${t.id}">ACEITAR COLETA</button></div>`:tab==='pending'?`<div class="courier-accepted">✓ Coleta aceita ${t.courier_accepted_at?`em ${fmtDateTime(t.courier_accepted_at)}`:''}</div><form class="courier-collect-form" data-collect-form="${t.id}"><label>Temperatura da amostra (°C)<input name="temperature" inputmode="decimal" type="number" step="0.1" required placeholder="Ex.: 4,0"></label><label>Quem entregou a amostra?<input name="sentByName" required placeholder="Nome do responsável"></label><label>Local de envio<input name="sentFromLocation" value="${esc(t.client_name)}" readonly></label>${t.payment_status==='collect'?`<label class="courier-payment-confirm"><input name="paymentReceived" type="checkbox" value="1" required> Confirmo que recebi o pagamento de <strong>${fmtMoney(t.payment_amount_cents)}</strong></label>`:''}<button class="courier-primary-action" type="button" data-collect="${t.id}">CONFIRMAR COLETA</button></form>`:`<div class="courier-history-data"><div><small>COLETADO EM</small><strong>${fmtDateTime(t.collected_at)}</strong></div><div><small>TEMPERATURA</small><strong>${t.collection_temperature!=null?`${esc(t.collection_temperature)} °C`:'—'}</strong></div><div><small>RESPONSÁVEL</small><strong>${esc(t.sent_by_name||'—')}</strong></div><div><small>LOCAL</small><strong>${esc(t.sent_from_location||t.client_name)}</strong></div></div>`}</article>`;
}
async function acceptCourierTask(endpoint,id,render,pollPending){try{const r=await api(endpoint(`requisitions/${id}/accept`),{method:'POST'});toast(r.message);await pollPending();await render()}catch(e){toast(e.message,'error')}}
async function collectTask(endpoint,id,render,pollPending){const form=$(`[data-collect-form="${id}"]`);if(!form?.reportValidity())return;const body=Object.fromEntries(new FormData(form));try{const r=await api(endpoint(`requisitions/${id}/collect`),{json:body});toast(r.message);await pollPending();await render()}catch(e){toast(e.message,'error')}}

function printRequisition(data){printManyRequisitions([data])}
function printManyRequisitions(items){if(!items.length)return;const html=items.map(d=>requisitionPrintHtml(d)).join('<div style="page-break-after:always"></div>');printWindow('Requisições HLabVet',html,printCss())}
function requisitionPrintHtml(d){const r=d.requisition, selected=new Set(d.exams.map(x=>x.exam_code)), mats=new Set(d.materials);let stamp={};try{stamp=JSON.parse(r.stamp_snapshot_json||'{}')}catch{}
  const groups=state.catalog||[];const leftNames=new Set(['Hematologia','Análise fecal','Urinálises','Citologia','Parasitologia','Testes rápidos','Sorologias']);const left=groups.filter(g=>leftNames.has(g.category)),right=groups.filter(g=>!leftNames.has(g.category));
  const examBox=g=>`<section class="pbox"><h4>${esc(g.category)}</h4>${g.items.map(x=>`<div class="pline"><span class="cb">${selected.has(x.code)?'✓':''}</span>${esc(x.name)}</div>`).join('')}</section>`;
  return `<div class="req-paper"><header class="req-head"><img src="${location.origin}/assets/hlabvet-logo.png"><h1>REQUISIÇÃO DE EXAMES<br>USO VETERINÁRIO</h1></header><div class="patient-grid"><div><b>CLÍNICA:</b> ${esc(r.clinic_name||r.client_name||'')}<br><b>VETERINÁRIO:</b> ${esc(r.veterinarian_name||'')}<br><b>CRMV:</b> ${esc(r.crmv||'')}<br><b>TUTOR:</b> ${esc(r.tutor_name||'')}<br><b>DATA:</b> ${esc(r.collection_date?fmtDate(r.collection_date):fmtDate(r.created_at))}</div><div><b>PACIENTE:</b> ${esc(r.patient_name)}<br><b>ESPÉCIE:</b> ${esc(r.species||'')}<br><b>RAÇA:</b> ${esc(r.breed||'')}<br><b>SEXO:</b> ${esc(r.sex||'')}<br><b>IDADE:</b> ${esc(r.age_text||exactAgeText(r.birth_date,r.collection_date||today()))}</div></div><div class="req-cols"><div>${left.map(examBox).join('')}<div class="pathologist"><b>PATOLOGISTA RESPONSÁVEL</b><br>Dr. Antônio Rodrigues | CRMV-RN 1568<br>Rua Américo Soares Wanderley, 1945 - Capim Macio, Natal/RN<br>(84) 99827-3567</div></div><div>${right.map(examBox).join('')}<section class="pbox"><h4>MATERIAL ENVIADO</h4>${['Sangue total','Soro','Plasma','Urina','Fezes'].map(m=>`<div class="pline"><span class="cb">${mats.has(m)?'✓':''}</span>${m}</div>`).join('')}<div><b>Outros:</b> ${esc(r.material_other||'')}</div></section><section class="pbox"><h4>INFORMAÇÕES CLÍNICAS / OBSERVAÇÕES</h4><div class="clin">${esc(r.clinical_info||'')}</div></section><div class="stamp-box">${stamp.name?`<div class="print-stamp" style="color:${esc(stamp.color||'#5c2a72')}"><b>${esc(stamp.name)}</b>${[stamp.line2,stamp.line3,stamp.line4].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}</div></div></div><div class="proto">Protocolo: ${esc(r.protocol)} • Gerado pelo HLab Vet Resultados</div></div>`;
}
function printTemperature(data){printWindow('Ficha de Controle de Temperatura',temperatureSheetsHtml(data).replaceAll('temp-sheet-screen','temp-sheet-print'),printCss()+`@page{size:A4 landscape;margin:6mm}.temp-sheet-print{page-break-after:always}.temp-sheet-print:last-child{page-break-after:auto}`)}
function printWindow(title,body,css){const w=window.open('','_blank');if(!w)return toast('O navegador bloqueou a janela de impressão. Libere pop-ups.','error');w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}<script>setTimeout(()=>window.print(),500)<\/script></body></html>`);w.document.close()}
function printCss(){return `@page{size:A4;margin:8mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}body{font-family:Arial,sans-serif;color:#111;margin:0;background:#fff!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.req-paper{font-size:10.5px}.req-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.req-head img{width:150px}.req-head h1{text-align:right;font-size:20px;margin:0;color:#4f4f4f}.patient-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #aaa;border-radius:12px;padding:10px;gap:16px;line-height:1.75}.req-cols{display:grid;grid-template-columns:1fr 1.18fr;gap:10px;margin-top:8px}.pbox{border:1px solid #aaa;border-radius:10px;overflow:hidden;margin-bottom:7px;padding-bottom:5px}.pbox h4{margin:0 0 5px;background:#8f5f97!important;background-color:#8f5f97!important;box-shadow:inset 0 0 0 1000px #8f5f97!important;color:#fff!important;padding:4px 8px;font-size:11px;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.pline{padding:1px 7px}.cb{display:inline-grid;place-items:center;width:11px;height:11px;border:1px solid #888;margin-right:4px;vertical-align:middle;font-size:10px;font-weight:bold}.clin{padding:6px;min-height:70px;white-space:pre-wrap}.stamp-box{height:92px;border:1px solid #aaa;border-radius:10px;display:grid;place-items:center;color:#bbb;font-size:18px}.print-stamp{border:3px double currentColor;border-radius:7px;padding:8px 15px;text-align:center;transform:rotate(-1deg);opacity:.83;text-transform:uppercase;font-family:Georgia,serif}.print-stamp b{display:block;font-size:14px}.print-stamp span{display:block;font-size:10px;margin-top:2px}.pathologist{font-size:9px;margin:8px 4px}.proto{text-align:right;margin-top:5px;color:#777;font-size:8px}.temp-sheet{font-family:Arial,sans-serif;color:#000}.temp-header{display:grid;grid-template-columns:170px 1fr 160px;border:1px solid #000}.temp-header>div{border-right:1px solid #000;padding:5px}.temp-header>div:last-child{border:0}.temp-header img{width:145px}.temp-company{text-align:center;font-size:9px;font-weight:700}.temp-title{background:#6a236f!important;background-color:#6a236f!important;box-shadow:inset 0 0 0 1000px #6a236f!important;color:#fff!important;text-align:center;font-weight:700;padding:3px;border-left:1px solid #000;border-right:1px solid #000;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.temp-info{display:grid;grid-template-columns:1fr 1fr 1fr 2fr;border:1px solid #000;border-top:0}.temp-info div{padding:3px 5px;border-right:1px solid #000;font-size:9px}.temp-info div:last-child{border:0}.temp-table{width:100%;border-collapse:collapse;font-size:7.8px}.temp-table th,.temp-table td{border:1px solid #000;padding:2px;text-align:center;height:14px}.temp-table th{background:#154f53!important;background-color:#154f53!important;box-shadow:inset 0 0 0 1000px #154f53!important;color:#fff!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.temp-table .super th{background:#fff!important;background-color:#fff!important;box-shadow:none!important;color:#000!important}.temp-notes{font-size:8px;padding:5px}.page-break{page-break-after:always}`}

boot();
