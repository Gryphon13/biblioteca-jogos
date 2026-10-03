const STORE_KEY = 'biblioteca-jogos-v1';
const SESSION_KEY = 'biblioteca-jogos-session-v1';
const THEME_KEY = 'biblioteca-jogos-theme-v1';
const THEMES = ['dark', 'original', 'light', 'console'];
const OWNER_ID = 'e5723e52-41e4-46cd-85cb-37ae533251d4';
const GROUP_KEY = 'biblioteca-jogos-agrupar-v1';
const STATUS = {
  nao_classificado: 'Para organizar', a_chegar: 'A chegar', prioridade: 'Quero jogar', jogando: 'Jogando', pausado: 'Pausado',
  zerado: 'Zerado', abandonado: 'Abandonado', nao_jogarei: 'Não jogarei'
};
const config = window.APP_CONFIG || {};
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || '') && !!config.publishableKey;
const $ = selector => document.querySelector(selector);
let games = [];
let seedCovers = new Map();
let seedConsoles = new Map();
let trophyData = {};
let currentId = null;
let rating = 0;
let previewObjectUrl = '';
let session = null;
let ownerAccess = false;
let syncBusy = false;
let syncAgain = false;
let toastTimer;
let syncTimer;
let lastSyncAt = 0;
let triageList = [];
let triageIndex = 0;
const dirty = new Set(JSON.parse(localStorage.getItem('biblioteca-jogos-dirty-v1') || '[]'));

function ts(value) { const t=Date.parse(value||''); return Number.isFinite(t)?t:0; }
function scheduleSync(delay=1500) { if(!session)return; clearTimeout(syncTimer); syncTimer=setTimeout(()=>sync(),delay); }
function saveCache() { localStorage.setItem(STORE_KEY, JSON.stringify(games)); }
function saveDirty() { localStorage.setItem('biblioteca-jogos-dirty-v1', JSON.stringify([...dirty])); }
function stamp(game) { game.updatedAt = new Date().toISOString(); dirty.add(game.id); saveDirty(); saveCache(); }
const PLATFORMS=['PlayStation','Switch'];
const CONSOLES=['PS5','PS4','PS3','PS Vita','Switch','Switch 2'];
const FORMATS=['digital','fisico','outro'];
const COMPLETIONS=['','zerado','platinado'];
const EXPANSIONS=['','nao_tem','pendentes','jogadas','nao_quero'];
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pick(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function text(value, max) { return String(value ?? '').slice(0, max); }
function count(value) { if(value===''||value==null)return ''; const n=Math.trunc(Number(value)); return Number.isFinite(n)&&n>=0&&n<=100000?n:''; }
function isoDate(value) { return typeof value==='string'&&ts(value)?value.slice(0,40):''; }
// Todo dado (cache local, lista inicial, banco) passa por aqui: campos com valores fora da lista são descartados.
function normalized(game) {
  game = game && typeof game==='object' ? game : {};
  const id = UUID_RE.test(String(game.id||'')) ? String(game.id).toLowerCase() : crypto.randomUUID();
  const platform = pick(game.platform, PLATFORMS, 'PlayStation');
  return { id, title: text(game.title, 160), platform, console: pick(game.console, CONSOLES, ''), format: pick(game.format, FORMATS, 'digital'), status: pick(game.status, Object.keys(STATUS), 'nao_classificado'), priority: pick(String(game.priority ?? ''), ['','1','2','3'], ''), rating: Math.max(0, Math.min(5, Math.trunc(Number(game.rating)) || 0)), completion: pick(game.completion ?? '', COMPLETIONS, ''), expansions: pick(game.expansions ?? '', EXPANSIONS, ''), disliked: game.disliked===true, returnLater: game.returnLater===true, trophiesEarned: count(game.trophiesEarned), trophiesTotal: count(game.trophiesTotal), trophiesMissing: text(game.trophiesMissing, 300), notes: text(game.notes, 4000), cover: safeCover(text(game.cover, 600)), coverPositionX: coverPosition(game.coverPositionX), coverPositionY: coverPosition(game.coverPositionY), updatedAt: isoDate(game.updatedAt), source: text(game.source || 'manual', 60), deletedAt: isoDate(game.deletedAt) };
}
function coverPosition(value) { return value === '' || value == null || !Number.isFinite(Number(value)) ? 50 : Math.max(0, Math.min(100, Math.round(Number(value)))); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safeCover(url) { if (!url) return ''; if (/^covers\/[a-z0-9_./-]+\.(jpg|jpeg|png|webp)$/i.test(url) && !url.includes('..')) return url; if (/^https:\/\//i.test(url)) { try { return new URL(url).protocol==='https:' ? url : ''; } catch { return ''; } } if (/^data:image\/(jpeg|png|webp);base64,/i.test(url)) return url; return ''; }
function trophiesFor(game) { return game.platform==='Switch' ? null : trophyData[game.id] || null; }
function trophyProgress(game) {
  const auto=trophiesFor(game);
  if(auto && Number(auto.total)>0) return { earned:Math.max(0,Number(auto.earned)||0), total:Number(auto.total), auto };
  const earned=Number(game.trophiesEarned), total=Number(game.trophiesTotal);
  return total>0 && Number.isFinite(earned) ? { earned, total, auto:null } : null;
}
function trophyHtml(game, label='') {
  const t=trophyProgress(game); if(!t) return '';
  const pct=Math.round(t.earned/t.total*100);
  const types=t.auto?[['platinum','P'],['gold','O'],['silver','Pr'],['bronze','B']].filter(([k])=>t.auto.totalByType[k]).map(([k,l])=>`<span class="trophy-type ${k}" title="${({platinum:'Platina',gold:'Ouro',silver:'Prata',bronze:'Bronze'})[k]}: ${t.auto.earnedByType[k]} de ${t.auto.totalByType[k]}">${l} ${t.auto.earnedByType[k]}/${t.auto.totalByType[k]}</span>`).join(''):'';
  const plat=t.auto?.earnedByType.platinum>0;
  return `<div class="trophy-row${plat?' has-platinum':''}"><div class="trophy-head"><span>🏆 ${label?`<em>${escapeHtml(label)}</em> `:''}${t.earned}/${t.total} troféus</span><b>${plat?'Platinado':pct+'%'}</b></div><div class="trophy-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>${types?`<div class="trophy-types">${types}</div>`:''}</div>`;
}
function consoleFor(game) { return game.console || ''; }
function initials(title) { return title.split(/\s+/).filter(w => !/^(the|of|a|de|do|da|e)$/i.test(w)).slice(0,2).map(w => w[0]).join('').toUpperCase(); }
function showToast(message) { const t=$('#toast'); t.textContent=message; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2700); }
function applyTheme(theme, persist = true) {
  const selected = THEMES.includes(theme) ? theme : 'original';
  document.documentElement.dataset.theme = selected;
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === selected));
  });
  const colors = { dark: '#080b13', original: '#0b0f17', light: '#f4f7fb', console: '#07142d' };
  document.querySelector('meta[name="theme-color"]').content = colors[selected];
  if (persist) {
    try { localStorage.setItem(THEME_KEY, selected); } catch { /* A escolha continua ativa nesta página. */ }
  }
}
async function verifyOwner() {
  ownerAccess = session?.user?.id === OWNER_ID;
  document.documentElement.dataset.access = ownerAccess ? 'owner' : 'visitor';
  render();
}
function activeGames() { return games.filter(g=>!g.deletedAt); }
const CONSOLE_ORDER = ['PS5','PS4','PS3','PS Vita','Switch 2','Switch',''];
function titleKey(title) { return String(title||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’']/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim(); }
function groupGames(list) {
  const map=new Map();
  for(const g of list){ const key=groupMode()?`${g.platform}|${titleKey(g.title)}`:g.id; if(!map.has(key))map.set(key,[]); map.get(key).push(g); }
  return [...map.values()].map(versions=>{
    versions.sort((a,b)=>CONSOLE_ORDER.indexOf(consoleFor(a))-CONSOLE_ORDER.indexOf(consoleFor(b)));
    const score=g=>(g.status!=='nao_classificado'?4:0)+(trophyProgress(g)?.earned?2:0)+(g.rating?1:0);
    const primary=[...versions].sort((a,b)=>score(b)-score(a)||ts(b.updatedAt)-ts(a.updatedAt))[0];
    return { versions, primary };
  });
}
function groupMode() { try { return localStorage.getItem(GROUP_KEY)!=='separado'; } catch { return true; } }
function coverOf(g) { return safeCover(g.cover || seedCovers.get(g.id)); }
function formatLabel(g) { return g.format==='fisico'?'Físico':g.format==='digital'?'Digital':'Formato a definir'; }
function groupStat(groups, test) { return groups.filter(gr=>gr.versions.some(test)).length; }
function render() {
  const active=activeGames();
  const allGroups=groupGames(active);
  $('#stat-total').textContent=allGroups.length;
  $('#stat-playing').textContent=groupStat(allGroups,g=>g.status==='jogando');
  $('#stat-finished').textContent=groupStat(allGroups,g=>g.completion==='zerado'||g.completion==='platinado'||g.status==='zerado');
  $('#stat-priority').textContent=groupStat(allGroups,g=>g.priority==='1');
  $('#stat-platinum').textContent=groupStat(allGroups,g=>trophiesFor(g)?.earnedByType.platinum>0||g.completion==='platinado');
  const search=$('#search').value.trim().toLocaleLowerCase('pt-BR');
  const platform=$('#platform-filter').value, consoleFilter=$('#console-filter').value, status=$('#status-filter').value, priority=$('#priority-filter').value;
  const list=active.filter(g=>(!search||`${g.title} ${g.notes}`.toLocaleLowerCase('pt-BR').includes(search))&&(!platform||g.platform===platform)&&(!consoleFilter||(consoleFilter==='__unknown__'?!consoleFor(g):consoleFor(g)===consoleFilter))&&(!status||g.status===status)&&(!priority||g.priority===priority));
  const groups=groupGames(list);
  const sort=$('#sort-filter').value, byTitle=(a,b)=>a.primary.title.localeCompare(b.primary.title,'pt-BR');
  const best=(gr,f)=>Math.max(...gr.versions.map(f));
  const progress=g=>{const t=trophyProgress(g);return t?t.earned/t.total:-1};
  groups.sort((a,b)=>sort==='updated'?best(b,g=>ts(g.updatedAt))-best(a,g=>ts(g.updatedAt))||byTitle(a,b):sort==='priority'?best(b,g=>-Number(g.priority||9))-best(a,g=>-Number(g.priority||9))||byTitle(a,b):sort==='rating'?best(b,g=>g.rating)-best(a,g=>g.rating)||byTitle(a,b):sort==='trophies'?best(b,progress)-best(a,progress)||byTitle(a,b):byTitle(a,b));
  $('#shown-count').textContent=`${groups.length}`;
  $('#empty-state').hidden=groups.length>0;
  $('#group-toggle').textContent=groupMode()?'Versões juntas':'Versões separadas';
  $('#group-toggle').setAttribute('aria-pressed',String(groupMode()));
  $('#game-grid').innerHTML=groups.map(renderCard).join('');
  $('#sync-status').textContent=ownerAccess?'Sincronizado com sua conta':'Visualização pública';
  $('#account-button').textContent=ownerAccess?'Minha conta':session?'Conta sem acesso':'Entrar para editar';
  $('#add-button').hidden=!ownerAccess;
  $('#triage-button').hidden=!ownerAccess;
  $('#triage-button').textContent=`Classificar rapidamente (${triageQueue().length})`;
  $('#seed-note').textContent=ownerAccess?'Sua coleção: faça alterações quando quiser.':'Somente o proprietário pode editar esta biblioteca.';
}
function renderCard({versions, primary:g}) {
  const multi=versions.length>1;
  const coverGame=versions.find(v=>v===g&&coverOf(v))||versions.find(coverOf)||g, cover=coverOf(coverGame);
  const label=STATUS[g.status]||STATUS.nao_classificado;
  const generation=consoleFor(g), consoleOptions=g.platform==='Switch'?['Switch','Switch 2']:['PS5','PS4','PS3','PS Vita'];
  const seenLists=new Set(), trophyRows=versions.filter(v=>{const t=trophiesFor(v);const k=t?t.exophase:`manual-${v.id}`;if(!trophyProgress(v)||seenLists.has(k))return false;seenLists.add(k);return true;});
  const consoleRow=multi
    ? `<div class="console-row versions">${versions.map(v=>`<${ownerAccess?`button type="button" data-edit="${escapeHtml(v.id)}"`:'span'} class="console-badge${consoleFor(v)?'':' undefined'}" title="${escapeHtml(formatLabel(v))} · ${escapeHtml(STATUS[v.status]||'')}">${escapeHtml(consoleFor(v)||'A definir')}<small>${v.format==='fisico'?'físico':v.format==='digital'?'digital':'?'}</small></${ownerAccess?'button':'span'}>`).join('')}</div>`
    : `<div class="console-row"><strong class="console-badge${generation?'':' undefined'}">${escapeHtml(generation||'Console a definir')}</strong><span class="format-label">${formatLabel(g)}</span></div>`;
  const trophies=trophyRows.map(v=>trophyHtml(v, multi&&trophyRows.length>1?(trophiesFor(v)?.platforms||consoleFor(v)):'')).join('');
  const footer=!ownerAccess?'':multi
    ? `<div class="card-footer versions-footer"><span>${versions.length} versões</span><div>${versions.map(v=>`<button type="button" data-edit="${escapeHtml(v.id)}">Editar ${escapeHtml(consoleFor(v)||'versão')}</button>`).join('')}</div></div>`
    : `<div class="card-footer"><select data-console="${escapeHtml(g.id)}" aria-label="Console de ${escapeHtml(g.title)}"><option value="" ${generation?'':'selected'}>Definir console</option>${consoleOptions.map(value=>`<option value="${value}" ${generation===value?'selected':''}>${value}</option>`).join('')}</select><select data-status="${escapeHtml(g.id)}" aria-label="Status de ${escapeHtml(g.title)}">${Object.entries(STATUS).map(([v,l])=>`<option value="${v}" ${g.status===v?'selected':''}>${l}</option>`).join('')}</select><button type="button" data-edit="${escapeHtml(g.id)}">Editar</button></div>`;
  return `<article class="game-card${multi?' is-group':''}" data-platform="${g.platform==='Switch'?'switch':'playstation'}"><div class="card-main" ${ownerAccess?`data-edit="${escapeHtml(g.id)}" role="button" tabindex="0" aria-label="Editar ${escapeHtml(g.title)} em ${escapeHtml(generation||g.platform)}"`:''}><div class="card-visual">${cover?`<img src="${escapeHtml(cover)}" alt="Capa de ${escapeHtml(g.title)}" loading="lazy" style="object-position:${coverPosition(coverGame.coverPositionX)}% ${coverPosition(coverGame.coverPositionY)}%">`:''}<span class="placeholder" style="${cover?'display:none':''}">${escapeHtml(initials(g.title))}</span><span class="platform-pill">${g.platform==='Switch'?'NINTENDO':'PLAYSTATION'}</span>${multi?`<span class="versions-pill">${versions.length} versões</span>`:''}${g.priority?`<span class="priority-pill">P${escapeHtml(g.priority)}</span>`:''}</div><div class="card-body"><h3>${escapeHtml(g.title)}</h3>${consoleRow}<div class="card-meta"><span class="status-badge ${escapeHtml(g.status)}">${escapeHtml(label)}</span><span class="stars" aria-label="Nota ${g.rating||'não definida'} de 5">${g.rating?'★'.repeat(g.rating)+'☆'.repeat(5-g.rating):'Sem nota'}</span></div>${trophies}${g.notes?`<p class="card-note">${escapeHtml(g.notes)}</p>`:''}</div></div>${footer}</article>`;
}
function consoleChoices(g) { return g.platform==='Switch'?['Switch','Switch 2']:['PS5','PS4','PS3','PS Vita']; }
function needsTriage(g) { return !consoleFor(g) || g.format==='outro' || g.status==='nao_classificado'; }
function triageQueue() { return activeGames().filter(needsTriage).sort((a,b)=>a.title.localeCompare(b.title,'pt-BR')||CONSOLE_ORDER.indexOf(consoleFor(a))-CONSOLE_ORDER.indexOf(consoleFor(b))); }
const COMPLETION_OPTIONS=[['zerado','Zerei'],['platinado','Zerei e platinei']];
const EXPANSION_OPTIONS=[['nao_tem','Não tem expansões'],['pendentes','Zerei, faltam expansões'],['jogadas','Joguei as expansões'],['nao_quero','Não pretendo jogar']];
// Campos de escolha usados no editor e na classificação rápida. Tocar na opção já marcada desmarca (volta para "empty").
function choiceFields(platform) {
  const sw=platform==='Switch';
  return [
    {name:'console',label:'Console',empty:'',options:consoleChoices({platform}).map(c=>[c,c])},
    {name:'format',label:'Formato',empty:'outro',options:[['digital','Digital'],['fisico','Físico']]},
    {name:'status',label:'Status',empty:'nao_classificado',options:Object.entries(STATUS).filter(([v])=>v!=='nao_classificado')},
    {name:'priority',label:'Prioridade para jogar',empty:'',options:[['1','Prioridade 1'],['2','Prioridade 2'],['3','Prioridade 3']]},
    {name:'completion',label:'Campanha',empty:'',options:sw?COMPLETION_OPTIONS.slice(0,1):COMPLETION_OPTIONS},
    {name:'expansions',label:'Expansões',empty:'',options:EXPANSION_OPTIONS}
  ];
}
function chipGroupHtml(def,current,scope) {
  return `<div class="chip-field" data-chip-field="${def.name}"><span class="chip-label">${escapeHtml(def.label)}</span><div class="chip-row">${def.options.map(([v,l])=>`<button type="button" class="chip${current===v?' selected':''}" data-${scope}-field="${def.name}" data-value="${escapeHtml(v)}" aria-pressed="${current===v}">${escapeHtml(l)}</button>`).join('')}</div></div>`;
}
function starsHtml(value,scope) {
  return `<div class="chip-field"><span class="chip-label">Minha nota</span><div class="chip-row stars-row" role="group" aria-label="Nota de 1 a 5">${[1,2,3,4,5].map(n=>`<button type="button" class="star${n<=value?' active':''}" data-${scope}-star="${n}" aria-pressed="${value===n}" aria-label="${n} de 5 estrelas">★</button>`).join('')}<span class="star-hint">${value?`${value} de 5 · toque de novo para limpar`:'Sem nota'}</span></div></div>`;
}
function impressionsHtml(disliked,returnLater,scope) {
  const chip=(name,on,label)=>`<button type="button" class="chip${on?' selected':''}" data-${scope}-flag="${name}" aria-pressed="${on}">${label}</button>`;
  return `<div class="chip-field"><span class="chip-label">Impressões</span><div class="chip-row">${chip('disliked',disliked,'Joguei e não gostei')}${chip('returnLater',returnLater,'Pretendo voltar')}</div></div>`;
}
function toggled(def,current,value) { return current===value ? def.empty : value; }
function fixForPlatform(obj) {
  if(obj.console && !consoleChoices(obj).includes(obj.console)) obj.console='';
  if(obj.platform==='Switch' && obj.completion==='platinado') obj.completion='zerado';
}
function openTriage() {
  if(!ownerAccess)return;
  triageList=triageQueue().map(g=>g.id); triageIndex=0;
  if(!triageList.length){ showToast('Nada pendente: todos os jogos já têm console, formato e status'); return; }
  renderTriage(); $('#triage-dialog').showModal();
}
function triageGame() { return games.find(x=>x.id===triageList[triageIndex]); }
function renderTriage() {
  const g=triageGame();
  if(!g){ $('#triage-dialog').close(); render(); return; }
  const cover=coverOf(g), pending=triageList.filter(id=>{const x=games.find(y=>y.id===id);return x&&needsTriage(x)}).length;
  $('#triage-progress').textContent=`${triageIndex+1} de ${triageList.length} · ${pending} pendentes`;
  $('#triage-game').innerHTML=`<div class="triage-cover">${cover?`<img src="${escapeHtml(cover)}" alt="">`:`<span>${escapeHtml(initials(g.title))}</span>`}</div><div><span class="eyebrow">${g.platform==='Switch'?'NINTENDO':'PLAYSTATION'}</span><h3>${escapeHtml(g.title)}</h3>${trophyHtml(g)}</div>`;
  renderTriageChoices();
  const notes=$('#triage-notes'); notes.value=g.notes||''; notes.dataset.id=g.id;
  $('#triage-prev').disabled=triageIndex===0;
  $('#triage-next').textContent=triageIndex===triageList.length-1?'Concluir':'Próximo →';
}
function renderTriageChoices() {
  const g=triageGame(); if(!g)return;
  const values={...g,console:consoleFor(g)};
  const defs=choiceFields(g.platform);
  $('#triage-main').innerHTML=defs.slice(0,4).map(d=>chipGroupHtml(d,values[d.name],'tri')).join('');
  $('#triage-extra').innerHTML=starsHtml(g.rating,'tri')+defs.slice(4).map(d=>chipGroupHtml(d,values[d.name],'tri')).join('')+impressionsHtml(g.disliked,g.returnLater,'tri');
}
function saveTriage(g) { stamp(g); scheduleSync(4000); renderTriageChoices(); }
function onTriageClick(e) {
  const g=triageGame(); if(!g||!ownerAccess)return;
  const field=e.target.closest('[data-tri-field]'), star=e.target.closest('[data-tri-star]'), flag=e.target.closest('[data-tri-flag]');
  if(field){ const def=choiceFields(g.platform).find(d=>d.name===field.dataset.triField); if(!def)return; const current=def.name==='console'?consoleFor(g):g[def.name]; g[def.name]=toggled(def,current,field.dataset.value); saveTriage(g); }
  else if(star){ const n=Number(star.dataset.triStar); g.rating=g.rating===n?0:n; saveTriage(g); }
  else if(flag){ const k=flag.dataset.triFlag; if(k==='disliked'||k==='returnLater'){ g[k]=!g[k]; saveTriage(g); } }
}
let triageNotesTimer;
function onTriageNotes() {
  const box=$('#triage-notes'); const g=games.find(x=>x.id===box.dataset.id); if(!g||!ownerAccess)return;
  clearTimeout(triageNotesTimer);
  triageNotesTimer=setTimeout(()=>{ g.notes=text(box.value.trim(),4000); stamp(g); scheduleSync(4000); },500);
}
function flushTriageNotes() {
  const box=$('#triage-notes'); const g=games.find(x=>x.id===box.dataset.id);
  clearTimeout(triageNotesTimer);
  if(g&&ownerAccess&&(g.notes||'')!==box.value.trim()){ g.notes=text(box.value.trim(),4000); stamp(g); scheduleSync(2000); }
}
function moveTriage(step) {
  flushTriageNotes();
  triageIndex+=step;
  if(triageIndex>=triageList.length){ $('#triage-dialog').close(); render(); showToast('Classificação concluída'); return; }
  triageIndex=Math.max(0,triageIndex); renderTriage();
}
function downloadFile(name,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type})); const a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function backupName(ext) { return `biblioteca-jogos-${new Date().toISOString().slice(0,10)}.${ext}`; }
function exportJson() {
  downloadFile(backupName('json'),JSON.stringify({exportedAt:new Date().toISOString(),games:games.map(normalized)},null,2),'application/json');
}
function exportCsv() {
  const cols=[['Título',g=>g.title],['Plataforma',g=>g.platform],['Console',g=>consoleFor(g)],['Formato',formatLabel],['Status',g=>STATUS[g.status]||g.status],['Prioridade',g=>g.priority],['Nota',g=>g.rating||''],['Campanha',g=>g.completion],['Expansões',g=>g.expansions],['Não gostei',g=>g.disliked?'sim':''],['Pretendo voltar',g=>g.returnLater?'sim':''],['Troféus obtidos',g=>trophyProgress(g)?.earned??''],['Troféus total',g=>trophyProgress(g)?.total??''],['Platina',g=>trophiesFor(g)?.earnedByType.platinum??''],['Ouro',g=>trophiesFor(g)?.earnedByType.gold??''],['Prata',g=>trophiesFor(g)?.earnedByType.silver??''],['Bronze',g=>trophiesFor(g)?.earnedByType.bronze??''],['Anotações',g=>g.notes],['Excluído em',g=>g.deletedAt],['Atualizado em',g=>g.updatedAt]];
  const cell=v=>{const t=String(v??'');return /[";\n\r]/.test(t)?`"${t.replace(/"/g,'""')}"`:t;};
  const rows=[cols.map(c=>c[0]).join(';'),...[...games].sort((a,b)=>a.title.localeCompare(b.title,'pt-BR')).map(g=>cols.map(c=>cell(c[1](g))).join(';'))];
  downloadFile(backupName('csv'),'﻿'+rows.join('\r\n'),'text/csv;charset=utf-8');
}
function openEditor(id=null) {
  if (!ownerAccess) return;
  clearPreviewObjectUrl();
  currentId=id; const g=id?games.find(x=>x.id===id):null; const f=$('#editor-form'); f.reset();
  $('#editor-title').textContent=g?'Editar jogo':'Adicionar jogo';
  $('#delete-button').hidden=!g;
  $('#duplicate-button').hidden=!g;
  $('#editor-error').hidden=true; $('#editor-error').classList.remove('info');
  for(const name of ['title','platform','console','format','status','priority','completion','expansions','trophiesEarned','trophiesTotal','trophiesMissing','notes','cover']) f.elements[name].value=(name==='cover' ? (g?.cover || seedCovers.get(g?.id) || '') : name==='console' ? (g ? consoleFor(g) : '') : g?.[name])??(name==='platform'?'PlayStation':name==='format'?'digital':name==='status'?'nao_classificado':'');
  f.elements.disliked.value=g?.disliked?'1':''; f.elements.returnLater.value=g?.returnLater?'1':'';
  rating=g?.rating||0; updatePlatformFields();
  const auto=g?trophiesFor(g):null;
  $('#trophy-auto').hidden=!auto;
  if(auto)$('#trophy-auto').textContent=`Importado do Exophase: ${auto.earned}/${auto.total} · Platina ${auto.earnedByType.platinum}/${auto.totalByType.platinum} · Ouro ${auto.earnedByType.gold}/${auto.totalByType.gold} · Prata ${auto.earnedByType.silver}/${auto.totalByType.silver} · Bronze ${auto.earnedByType.bronze}/${auto.totalByType.bronze}${auto.lastPlayed?` · jogado em ${auto.lastPlayed.split('-').reverse().join('/')}`:''}${auto.playtime?` · ${auto.playtime}`:''}. Esses números aparecem no card; os campos abaixo são para anotações manuais.`;
  $('#cover-position-x').value=coverPosition(g?.coverPositionX);
  $('#cover-position-y').value=coverPosition(g?.coverPositionY);
  updateCoverPreview();
  $('#editor-dialog').showModal();
}
function duplicateCurrent() {
  const g=games.find(x=>x.id===currentId); if(!g||!ownerAccess)return;
  const f=$('#editor-form');
  currentId=null;
  $('#editor-title').textContent=`Nova versão de ${g.title}`;
  $('#delete-button').hidden=true; $('#duplicate-button').hidden=true; $('#trophy-auto').hidden=true;
  for(const name of ['console','priority','completion','expansions','trophiesEarned','trophiesTotal','trophiesMissing','notes']) f.elements[name].value='';
  f.elements.status.value='nao_classificado'; f.elements.format.value='outro'; f.elements.disliked.value=''; f.elements.returnLater.value='';
  rating=0; updatePlatformFields();
  $('#editor-error').textContent='Mesmo título e capa copiados. Escolha o console (ou a plataforma) desta versão e salve.';
  $('#editor-error').hidden=false; $('#editor-error').classList.add('info');
  f.elements.console.focus();
}
function clearPreviewObjectUrl() { if(previewObjectUrl) URL.revokeObjectURL(previewObjectUrl); previewObjectUrl=''; }
function updateCoverPreview() {
  const file=$('#cover-file').files[0];
  clearPreviewObjectUrl();
  const source=file ? (previewObjectUrl=URL.createObjectURL(file)) : safeCover($('#editor-form').elements.cover.value.trim());
  const image=$('#cover-preview-image');
  image.hidden=!source;
  $('#cover-preview-empty').hidden=!!source;
  if(source) image.src=source; else image.removeAttribute('src');
  updateCoverPosition();
}
function updateCoverPosition() {
  $('#cover-preview-image').style.objectPosition=`${$('#cover-position-x').value}% ${$('#cover-position-y').value}%`;
}
function dragCover(event) {
  if(event.button!==0 && event.pointerType==='mouse') return;
  const image=$('#cover-preview-image'), frame=$('#cover-preview');
  if(image.hidden || !image.naturalWidth || !image.naturalHeight) return;
  const scale=Math.max(frame.clientWidth/image.naturalWidth,frame.clientHeight/image.naturalHeight);
  const overflowX=image.naturalWidth*scale-frame.clientWidth;
  const overflowY=image.naturalHeight*scale-frame.clientHeight;
  const startX=event.clientX, startY=event.clientY;
  const initialX=Number($('#cover-position-x').value), initialY=Number($('#cover-position-y').value);
  frame.setPointerCapture(event.pointerId);
  frame.onpointermove=move=>{
    if(move.pointerId!==event.pointerId)return;
    if(overflowX>0.5)$('#cover-position-x').value=coverPosition(initialX-(move.clientX-startX)/overflowX*100);
    if(overflowY>0.5)$('#cover-position-y').value=coverPosition(initialY-(move.clientY-startY)/overflowY*100);
    updateCoverPosition();
  };
  const finish=()=>{frame.onpointermove=null;frame.onpointerup=null;frame.onpointercancel=null;};
  frame.onpointerup=finish;
  frame.onpointercancel=finish;
}
function renderEditorChips() {
  const f=$('#editor-form'), platform=f.elements.platform.value, el=f.elements;
  const v=name=>el[name].value;
  const defs=choiceFields(platform);
  $('#editor-chips').innerHTML=defs.slice(0,4).map(d=>chipGroupHtml(d,v(d.name),'ed')).join('')+starsHtml(rating,'ed')+defs.slice(4).map(d=>chipGroupHtml(d,v(d.name),'ed')).join('')+impressionsHtml(v('disliked')==='1',v('returnLater')==='1','ed');
}
function updatePlatformFields() {
  const f=$('#editor-form'), el=f.elements;
  const obj={platform:el.platform.value,console:el.console.value,completion:el.completion.value};
  fixForPlatform(obj); el.console.value=obj.console; el.completion.value=obj.completion;
  $('#trophy-fields').hidden=obj.platform==='Switch';
  renderEditorChips();
}
function onEditorChipClick(e) {
  const f=$('#editor-form'), el=f.elements;
  const field=e.target.closest('[data-ed-field]'), star=e.target.closest('[data-ed-star]'), flag=e.target.closest('[data-ed-flag]');
  if(field){ const def=choiceFields(el.platform.value).find(d=>d.name===field.dataset.edField); if(!def)return; el[def.name].value=toggled(def,el[def.name].value,field.dataset.value); }
  else if(star){ const n=Number(star.dataset.edStar); rating=rating===n?0:n; }
  else if(flag){ const k=flag.dataset.edFlag; if(k==='disliked'||k==='returnLater') el[k].value=el[k].value==='1'?'':'1'; }
  else return;
  renderEditorChips();
}
async function saveEditor(event) {
  event.preventDefault(); if (!ownerAccess) return; const f=$('#editor-form'); const existing=currentId?games.find(x=>x.id===currentId):null;
  const title=f.elements.title.value.trim(); if(!title)return;
  const file=$('#cover-file').files[0]; let cover=f.elements.cover.value.trim();
  if(file) { try { cover=await uploadCover(file,currentId||crypto.randomUUID()); } catch(err){ $('#editor-error').textContent=err.message;$('#editor-error').hidden=false;return; } }
  if(cover&&!safeCover(cover)){ $('#editor-error').textContent='Use uma URL https ou um arquivo dentro de covers/.';$('#editor-error').hidden=false;return; }
  const game=normalized({...existing,id:existing?.id||crypto.randomUUID(),title,platform:f.elements.platform.value,console:f.elements.console.value,format:f.elements.format.value,status:f.elements.status.value,priority:f.elements.priority.value,rating,completion:f.elements.completion.value,expansions:f.elements.expansions.value,disliked:f.elements.disliked.value==='1',returnLater:f.elements.returnLater.value==='1',trophiesEarned:f.elements.platform.value==='Switch'?'':f.elements.trophiesEarned.value,trophiesTotal:f.elements.platform.value==='Switch'?'':f.elements.trophiesTotal.value,trophiesMissing:f.elements.platform.value==='Switch'?'':f.elements.trophiesMissing.value.trim(),notes:f.elements.notes.value.trim(),cover,coverPositionX:$('#cover-position-x').value,coverPositionY:$('#cover-position-y').value,source:existing?.source||'manual'});
  if(existing)Object.assign(existing,game);else games.push(game);
  stamp(existing||game); $('#editor-dialog').close(); clearPreviewObjectUrl(); render(); showToast('Jogo salvo'); scheduleSync();
}
function deleteGame(){if(!ownerAccess||!currentId)return;const g=games.find(x=>x.id===currentId);if(!g)return;if(!confirm(`Excluir ${g.title} da biblioteca?`))return;g.deletedAt=new Date().toISOString();stamp(g);$('#editor-dialog').close();render();showToast('Jogo excluído');scheduleSync();}
function setQuickStatus(id,status){if(!ownerAccess)return;const g=games.find(x=>x.id===id);if(!g)return;g.status=status;stamp(g);render();showToast('Status atualizado');scheduleSync();}
function setQuickConsole(id,consoleName){if(!ownerAccess||!consoleName)return;const g=games.find(x=>x.id===id);if(!g)return;const allowed=g.platform==='Switch'?['Switch','Switch 2']:['PS5','PS4','PS3','PS Vita'];if(!allowed.includes(consoleName))return;g.console=consoleName;stamp(g);render();showToast('Console atualizado');scheduleSync();}
function apiHeaders(access=true){const h={'apikey':config.publishableKey,'Content-Type':'application/json'};if(access&&session?.access_token)h.Authorization=`Bearer ${session.access_token}`;return h;}
async function api(path,options={}){const response=await fetch(config.supabaseUrl+path,{...options,headers:{...apiHeaders(options.access!==false),...(options.headers||{})}});const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}if(!response.ok)throw new Error(data?.msg||data?.error_description||data?.message||`Erro ${response.status}`);return data;}
function saveSession(value){session=value;ownerAccess=false;document.documentElement.dataset.access='visitor';if(value)localStorage.setItem(SESSION_KEY,JSON.stringify(value));else localStorage.removeItem(SESSION_KEY);render();}
async function ensureSession(){if(!session)return false;if(Date.now() < (session.expires_at||0)*1000-60000)return true;try{const data=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token}),access:false});saveSession({...data,expires_at:Math.floor(Date.now()/1000)+data.expires_in});await verifyOwner();return ownerAccess}catch{saveSession(null);return false}}
async function sendMagicLink(event){event.preventDefault();if(!configured){$('#account-message').textContent='A sincronização ainda precisa ser conectada pelo proprietário do site.';return}const email=$('#login-email').value.trim();try{const redirect=encodeURIComponent(location.origin+location.pathname);await api(`/auth/v1/otp?redirect_to=${redirect}`,{method:'POST',body:JSON.stringify({email,create_user:false}),access:false});$('#account-message').textContent=`Enviamos um link para ${email}. Abra o e-mail neste aparelho.`;}catch(err){$('#account-message').textContent=/signup|not allowed|cadastros/i.test(err.message)?'Este e-mail não tem acesso para editar a biblioteca.':err.message}}
async function handleAuthRedirect(){const hash=new URLSearchParams(location.hash.replace(/^#/,''));if(!hash.has('access_token'))return;const access_token=hash.get('access_token'),refresh_token=hash.get('refresh_token'),expires_in=Number(hash.get('expires_in')||3600);if(access_token&&refresh_token){const user=await api('/auth/v1/user',{headers:{Authorization:`Bearer ${access_token}`}}).catch(()=>null);saveSession({access_token,refresh_token,expires_at:Math.floor(Date.now()/1000)+expires_in,user});await verifyOwner();history.replaceState({},'',location.pathname+location.search);showToast('Conta conectada');}}
async function sync(){if(!configured||!session||!ownerAccess)return;if(syncBusy){syncAgain=true;return}syncBusy=true;try{if(!await ensureSession()||!ownerAccess)return;if(!session.user)session.user=await api('/auth/v1/user');const remote=await api('/rest/v1/games?select=id,data,updated_at&limit=1000',{headers:{Accept:'application/json'}});const remoteById=new Map(remote.map(row=>[row.id,row]));for(const game of games)if(!remoteById.has(game.id))dirty.add(game.id);saveDirty();for(const id of [...dirty]){const local=games.find(g=>g.id===id);if(!local){dirty.delete(id);continue}const other=remoteById.get(id);if(other&&ts(other.updated_at)>ts(local.updatedAt)){games=games.map(g=>g.id===id?normalized(other.data):g);dirty.delete(id);continue}const uploadStamp=local.updatedAt;await api('/rest/v1/games?on_conflict=owner_id,id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id,owner_id:session.user.id,data:local,updated_at:uploadStamp||new Date().toISOString()})});if(games.find(g=>g.id===id)?.updatedAt===uploadStamp)dirty.delete(id)}saveDirty();for(const row of remote){if(!dirty.has(row.id)){const index=games.findIndex(g=>g.id===row.id);if(index<0)games.push(normalized(row.data));else if(ts(row.updated_at)>ts(games[index].updatedAt))games[index]=normalized(row.data)}}saveCache();render();$('#sync-status').textContent='Sincronizado agora';lastSyncAt=Date.now();}catch(err){$('#sync-status').textContent='Sem conexão · salvo aqui';console.error(err)}finally{syncBusy=false;if(syncAgain){syncAgain=false;queueMicrotask(sync)}}}
async function loadPublic(){if(!configured||ownerAccess)return;try{const remote=await api('/rest/v1/games?select=id,data,updated_at&limit=2000',{access:false,headers:{Accept:'application/json'}});if(!Array.isArray(remote)||!remote.length)return;const byId=new Map(remote.map(r=>[r.id,normalized(r.data)]));games=games.map(g=>byId.get(g.id)||g);for(const [id,g] of byId)if(!games.some(x=>x.id===id))games.push(g);render();}catch(err){console.error(err)}}
async function uploadCover(file,id){if(!ownerAccess||!configured||!session)throw new Error('Entre na sua conta para enviar uma capa.');if(!await ensureSession())throw new Error('Sua sessão expirou. Entre novamente.');if(file.size>5*1024*1024)throw new Error('A capa deve ter até 5 MB.');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Para enviar pelo site, use JPG, PNG ou WebP.');const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';const name=`${session.user.id}/${id}-${Date.now()}.${ext}`;const response=await fetch(`${config.supabaseUrl}/storage/v1/object/covers/${name}`,{method:'POST',headers:{apikey:config.publishableKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':file.type,'x-upsert':'false'},body:file});if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.message||'Não foi possível enviar a capa.')}return `${config.supabaseUrl}/storage/v1/object/public/covers/${name}`;}
async function boot(){
  const seed=await fetch('data/games.json',{cache:'no-cache'}).then(r=>r.json()).catch(()=>[]);
  seedCovers=new Map(seed.filter(g=>g.cover).map(g=>[g.id,g.cover]));
  seedConsoles=new Map(seed.filter(g=>g.console).map(g=>[g.id,g.console]));
  trophyData=await fetch('data/trophies.json',{cache:'no-cache'}).then(r=>r.ok?r.json():{}).then(d=>d.games||{}).catch(()=>({}));
  const cached=JSON.parse(localStorage.getItem(STORE_KEY)||'null');games=Array.isArray(cached)?cached.map(normalized):seed.map(normalized);
  if(Array.isArray(cached)){const known=new Set(games.map(g=>g.id));for(const g of seed)if(!known.has(g.id))games.push(normalized(g));}
  saveCache();
  for(const [value,label] of Object.entries(STATUS)){$('#status-filter').add(new Option(label,value));}
  $('#cover-file').closest('label').insertAdjacentHTML('afterend',`<div class="span-2 cover-framing"><strong>Enquadramento da capa</strong><p>Arraste a imagem para escolher o que aparece no card. A proporção original é preservada.</p><div id="cover-preview" class="cover-preview"><img id="cover-preview-image" alt="Prévia da capa" draggable="false" hidden><span id="cover-preview-empty">Escolha uma capa para ajustar o enquadramento</span></div><div class="cover-position-controls"><label>Horizontal<input id="cover-position-x" type="range" min="0" max="100" value="50"></label><label>Vertical<input id="cover-position-y" type="range" min="0" max="100" value="50"></label></div></div>`);
  $('#add-button').onclick=()=>openEditor();$('#close-editor').onclick=$('#cancel-editor').onclick=()=>$('#editor-dialog').close();$('#editor-form').onsubmit=saveEditor;$('#delete-button').onclick=deleteGame;$('#duplicate-button').onclick=duplicateCurrent;$('#editor-form').elements.platform.onchange=updatePlatformFields;
  $('#editor-dialog').addEventListener('close',clearPreviewObjectUrl);
  $('#cover-file').addEventListener('change',()=>{if($('#cover-file').files[0]){$('#cover-position-x').value=50;$('#cover-position-y').value=50;}updateCoverPreview()});
  $('#editor-form').elements.cover.addEventListener('input',()=>{if(!$('#cover-file').files.length)updateCoverPreview()});
  $('#cover-preview-image').addEventListener('error',()=>{$('#cover-preview-image').hidden=true;$('#cover-preview-empty').hidden=false;$('#cover-preview-empty').textContent='Não foi possível mostrar esta capa';});
  $('#cover-preview-image').addEventListener('load',()=>{$('#cover-preview-empty').textContent='Escolha uma capa para ajustar o enquadramento';});
  for(const id of ['cover-position-x','cover-position-y'])$('#'+id).addEventListener('input',updateCoverPosition);
  $('#cover-preview').addEventListener('pointerdown',dragCover);
  $('#editor-chips').addEventListener('click',onEditorChipClick);
  for(const id of ['search','platform-filter','console-filter','status-filter','priority-filter','sort-filter'])$('#'+id).addEventListener(id==='search'?'input':'change',render);
  $('#game-grid').onclick=e=>{if(!ownerAccess)return;const edit=e.target.closest('[data-edit]');if(edit)openEditor(edit.dataset.edit)};
  $('#game-grid').onkeydown=e=>{if(!ownerAccess||!['Enter',' '].includes(e.key))return;const edit=e.target.closest('.card-main[data-edit]');if(edit){e.preventDefault();openEditor(edit.dataset.edit)}};
  $('#game-grid').onchange=e=>{const consoleSelect=e.target.closest('[data-console]');if(consoleSelect){setQuickConsole(consoleSelect.dataset.console,consoleSelect.value);return}const statusSelect=e.target.closest('[data-status]');if(statusSelect)setQuickStatus(statusSelect.dataset.status,statusSelect.value)};
  const activeFilters=()=>['platform-filter','console-filter','status-filter','priority-filter'].filter(id=>$('#'+id).value).length;
  const updateFiltersToggle=()=>{const n=activeFilters();$('#filters-toggle').textContent=n?`Filtros (${n})`:'Filtros';};
  $('#filters-toggle').onclick=()=>{const open=$('.controls').classList.toggle('filters-open');$('#filters-toggle').setAttribute('aria-expanded',String(open));};
  const toResults=()=>{updateFiltersToggle();const top=$('.list-heading').getBoundingClientRect().top+window.scrollY-$('.controls').offsetHeight-8;if(window.scrollY>top)window.scrollTo({top});};
  for(const id of ['search','platform-filter','console-filter','status-filter','priority-filter','sort-filter'])$('#'+id).addEventListener(id==='search'?'input':'change',toResults);
  document.addEventListener('error',e=>{const img=e.target;if(img instanceof HTMLImageElement&&img.closest('.card-visual')){img.style.display='none';const ph=img.nextElementSibling;if(ph)ph.style.display='block';}},true);
  $('#group-toggle').onclick=()=>{try{localStorage.setItem(GROUP_KEY,groupMode()?'separado':'junto')}catch{}render()};
  $('#triage-button').onclick=openTriage;
  $('#close-triage').onclick=()=>{$('#triage-dialog').close();render()};
  $('#triage-dialog').addEventListener('close',()=>{flushTriageNotes();render()});
  $('#triage-dialog').addEventListener('click',onTriageClick);
  $('#triage-notes').addEventListener('input',onTriageNotes);
  $('#triage-prev').onclick=()=>moveTriage(-1);$('#triage-next').onclick=()=>moveTriage(1);
  $('#triage-edit').onclick=()=>{flushTriageNotes();const id=triageList[triageIndex];$('#triage-dialog').close();openEditor(id)};
  $('#export-json').onclick=exportJson;$('#export-csv').onclick=exportCsv;
  $('#account-button').onclick=()=>{$('#backup-actions').hidden=!ownerAccess;const text=ownerAccess?`Conectado como ${session.user?.email||'usuário'}. Suas alterações sincronizam entre aparelhos.`:session?'Esta conta não tem permissão para editar esta biblioteca.':'Entre com a conta do proprietário para editar jogos, notas e anotações.';$('#account-explanation').textContent=text;$('#login-form').hidden=!!session||!configured;$('#logout-button').hidden=!session;$('#account-message').textContent='';$('#account-dialog').showModal()};
  $('#close-account').onclick=()=>$('#account-dialog').close();$('#login-form').onsubmit=sendMagicLink;$('#logout-button').onclick=async()=>{const token=session?.access_token;if(token)fetch(config.supabaseUrl+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:config.publishableKey,Authorization:`Bearer ${token}`}}).catch(()=>{});saveSession(null);$('#account-dialog').close();showToast('Você saiu da conta')};
  render();if(configured){session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');await handleAuthRedirect();if(session){if(await ensureSession()){session.user=await api('/auth/v1/user').catch(()=>null);await verifyOwner();if(ownerAccess)sync()}else await verifyOwner();}else await verifyOwner();if(!ownerAccess)await loadPublic();}window.addEventListener('online',()=>{if(session)sync()});window.addEventListener('focus',()=>{if(session&&Date.now()-lastSyncAt>60000)sync()});
}
applyTheme(document.documentElement.dataset.theme, false);
document.querySelector('.theme-options').addEventListener('click', event => {
  const button = event.target.closest('[data-theme-choice]');
  if (button) applyTheme(button.dataset.themeChoice);
});
boot();
