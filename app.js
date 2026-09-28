const STORE_KEY = 'biblioteca-jogos-v1';
const SESSION_KEY = 'biblioteca-jogos-session-v1';
const THEME_KEY = 'biblioteca-jogos-theme-v1';
const THEMES = ['dark', 'original', 'light', 'console'];
const OWNER_EMAIL_HASH = '10012b6c45dc751d855860f6c700e69b37ca9f74ab61ae1097d5068bc4cb3e99';
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
let currentId = null;
let rating = 0;
let session = null;
let ownerAccess = false;
let syncBusy = false;
let syncAgain = false;
let toastTimer;
const dirty = new Set(JSON.parse(localStorage.getItem('biblioteca-jogos-dirty-v1') || '[]'));

function saveCache() { localStorage.setItem(STORE_KEY, JSON.stringify(games)); }
function saveDirty() { localStorage.setItem('biblioteca-jogos-dirty-v1', JSON.stringify([...dirty])); }
function stamp(game) { game.updatedAt = new Date().toISOString(); dirty.add(game.id); saveDirty(); saveCache(); }
function normalized(game) { return { id: game.id, title: game.title || '', platform: game.platform || 'PlayStation', console: game.console || '', format: game.format || 'digital', status: game.status || 'nao_classificado', priority: game.priority || '', rating: Number(game.rating) || 0, completion: game.completion || '', expansions: game.expansions || '', disliked: !!game.disliked, returnLater: !!game.returnLater, trophiesEarned:game.trophiesEarned??'', trophiesTotal:game.trophiesTotal??'', trophiesMissing:game.trophiesMissing||'', notes: game.notes || '', cover: game.cover || '', updatedAt: game.updatedAt || '', source: game.source || 'manual', deletedAt: game.deletedAt || '' }; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safeCover(url) { if (!url) return ''; if (/^covers\/[a-z0-9_./-]+\.(jpg|jpeg|png|webp)$/i.test(url) && !url.includes('..')) return url; if (/^https:\/\//i.test(url)) return url; if (/^data:image\/(jpeg|png|webp);base64,/i.test(url)) return url; return ''; }
function consoleFor(game) { return game.console || seedConsoles.get(game.id) || ''; }
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
async function isOwnerEmail(email) {
  const bytes = new TextEncoder().encode(String(email || '').trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('') === OWNER_EMAIL_HASH;
}
async function verifyOwner() {
  ownerAccess = !!(session?.user?.email && await isOwnerEmail(session.user.email));
  document.documentElement.dataset.access = ownerAccess ? 'owner' : 'visitor';
  render();
}
function activeGames() { return games.filter(g=>!g.deletedAt); }
function render() {
  const active=activeGames();
  $('#stat-total').textContent=active.length;
  $('#stat-playing').textContent=active.filter(g=>g.status==='jogando').length;
  $('#stat-finished').textContent=active.filter(g=>g.completion==='zerado'||g.completion==='platinado'||g.status==='zerado').length;
  $('#stat-priority').textContent=active.filter(g=>g.priority==='1').length;
  const search=$('#search').value.trim().toLocaleLowerCase('pt-BR');
  const platform=$('#platform-filter').value, consoleFilter=$('#console-filter').value, status=$('#status-filter').value, priority=$('#priority-filter').value;
  let list=active.filter(g=>(!search||`${g.title} ${g.notes}`.toLocaleLowerCase('pt-BR').includes(search))&&(!platform||g.platform===platform)&&(!consoleFilter||consoleFor(g)===consoleFilter)&&(!status||g.status===status)&&(!priority||g.priority===priority));
  const sort=$('#sort-filter').value;
  list.sort((a,b)=>sort==='updated'?(b.updatedAt||'').localeCompare(a.updatedAt||'')||a.title.localeCompare(b.title,'pt-BR'):sort==='priority'?(Number(a.priority||9)-Number(b.priority||9))||a.title.localeCompare(b.title,'pt-BR'):sort==='rating'?(b.rating-a.rating)||a.title.localeCompare(b.title,'pt-BR'):a.title.localeCompare(b.title,'pt-BR'));
  $('#shown-count').textContent=`${list.length}`;
  $('#empty-state').hidden=list.length>0;
  $('#game-grid').innerHTML=list.map(g=>{
    const cover=safeCover(g.cover || seedCovers.get(g.id)), label=STATUS[g.status]||STATUS.nao_classificado;
    return `<article class="game-card" data-platform="${g.platform==='Switch'?'switch':'playstation'}"><div class="card-main" ${ownerAccess?`data-edit="${g.id}" role="button" tabindex="0" aria-label="Editar ${escapeHtml(g.title)} em ${escapeHtml(consoleFor(g)||g.platform)}"`:''}><div class="card-visual">${cover?`<img src="${escapeHtml(cover)}" alt="Capa de ${escapeHtml(g.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">`:''}<span class="placeholder" style="${cover?'display:none':''}">${escapeHtml(initials(g.title))}</span><span class="platform-pill">${g.platform==='Switch'?'SWITCH':'PLAYSTATION'}${consoleFor(g)?' · '+escapeHtml(consoleFor(g)):''} · ${g.format==='fisico'?'FÍSICO':g.format==='digital'?'DIGITAL':'FORMATO A DEFINIR'}</span>${g.priority?`<span class="priority-pill">P${g.priority}</span>`:''}</div><div class="card-body"><h3>${escapeHtml(g.title)}</h3><div class="card-meta"><span class="status-badge ${g.status}">${escapeHtml(label)}</span><span class="stars" aria-label="Nota ${g.rating||'não definida'} de 5">${g.rating?'★'.repeat(g.rating)+'☆'.repeat(5-g.rating):'Sem nota'}</span></div>${g.notes?`<p class="card-note">${escapeHtml(g.notes)}</p>`:''}</div></div>${ownerAccess?`<div class="card-footer"><select data-status="${g.id}" aria-label="Status de ${escapeHtml(g.title)}">${Object.entries(STATUS).map(([v,l])=>`<option value="${v}" ${g.status===v?'selected':''}>${l}</option>`).join('')}</select><button type="button" data-edit="${g.id}">Editar</button></div>`:''}</article>`;
  }).join('');
  $('#sync-status').textContent=ownerAccess?'Sincronizado com sua conta':'Visualização pública';
  $('#account-button').textContent=ownerAccess?'Minha conta':session?'Conta sem acesso':'Entrar para editar';
  $('#add-button').hidden=!ownerAccess;
  $('#seed-note').textContent=ownerAccess?'Sua coleção: faça alterações quando quiser.':'Somente o proprietário pode editar esta biblioteca.';
}
function openEditor(id=null) {
  if (!ownerAccess) return;
  currentId=id; const g=id?games.find(x=>x.id===id):null; const f=$('#editor-form'); f.reset();
  $('#editor-title').textContent=g?'Editar jogo':'Adicionar jogo';
  $('#delete-button').hidden=!g;
  $('#editor-error').hidden=true;
  for(const name of ['title','platform','console','format','status','priority','completion','expansions','trophiesEarned','trophiesTotal','trophiesMissing','notes','cover']) f.elements[name].value=(name==='cover' ? (g?.cover || seedCovers.get(g?.id) || '') : name==='console' ? (g ? consoleFor(g) : '') : g?.[name])??(name==='platform'?'PlayStation':name==='format'?'digital':name==='status'?'nao_classificado':'');
  f.elements.disliked.checked=!!g?.disliked; f.elements.returnLater.checked=!!g?.returnLater;
  rating=g?.rating||0; renderRating(); updatePlatformFields(); $('#editor-dialog').showModal();
}
function renderRating(){ $('#rating-buttons').innerHTML=[1,2,3,4,5].map(n=>`<button type="button" class="${n<=rating?'active':''}" data-rating="${n}" role="radio" aria-checked="${rating===n}" aria-label="${n} de 5 estrelas">★</button>`).join(''); }
function updatePlatformFields(){const f=$('#editor-form');const isSwitch=f.elements.platform.value==='Switch';const o=f.elements.completion.querySelector('option[value="platinado"]');o.hidden=isSwitch;$('#trophy-fields').hidden=isSwitch;if(isSwitch&&f.elements.completion.value==='platinado')f.elements.completion.value='zerado';for(const option of f.elements.console.options)if(option.value)option.hidden=isSwitch?!option.value.startsWith('Switch'):option.value.startsWith('Switch');if(f.elements.console.selectedOptions[0]?.hidden)f.elements.console.value='';}
async function saveEditor(event) {
  event.preventDefault(); if (!ownerAccess) return; const f=$('#editor-form'); const existing=currentId?games.find(x=>x.id===currentId):null;
  const title=f.elements.title.value.trim(); if(!title)return;
  const file=$('#cover-file').files[0]; let cover=f.elements.cover.value.trim();
  if(file) { try { cover=await uploadCover(file,currentId||crypto.randomUUID()); } catch(err){ $('#editor-error').textContent=err.message;$('#editor-error').hidden=false;return; } }
  if(cover&&!safeCover(cover)){ $('#editor-error').textContent='Use uma URL https ou um arquivo dentro de covers/.';$('#editor-error').hidden=false;return; }
  const game=normalized({...existing,id:existing?.id||crypto.randomUUID(),title,platform:f.elements.platform.value,console:f.elements.console.value,format:f.elements.format.value,status:f.elements.status.value,priority:f.elements.priority.value,rating,completion:f.elements.completion.value,expansions:f.elements.expansions.value,disliked:f.elements.disliked.checked,returnLater:f.elements.returnLater.checked,trophiesEarned:f.elements.platform.value==='Switch'?'':f.elements.trophiesEarned.value,trophiesTotal:f.elements.platform.value==='Switch'?'':f.elements.trophiesTotal.value,trophiesMissing:f.elements.platform.value==='Switch'?'':f.elements.trophiesMissing.value.trim(),notes:f.elements.notes.value.trim(),cover,source:existing?.source||'manual'});
  if(existing)Object.assign(existing,game);else games.push(game);
  stamp(existing||game); $('#editor-dialog').close(); render(); showToast('Jogo salvo'); if(session)sync();
}
function deleteGame(){if(!ownerAccess||!currentId)return;const g=games.find(x=>x.id===currentId);if(!g)return;if(!confirm(`Excluir ${g.title} da biblioteca?`))return;g.deletedAt=new Date().toISOString();stamp(g);$('#editor-dialog').close();render();showToast('Jogo excluído');if(session)sync();}
function setQuickStatus(id,status){if(!ownerAccess)return;const g=games.find(x=>x.id===id);if(!g)return;g.status=status;stamp(g);render();showToast('Status atualizado');if(session)sync();}
function apiHeaders(access=true){const h={'apikey':config.publishableKey,'Content-Type':'application/json'};if(access&&session?.access_token)h.Authorization=`Bearer ${session.access_token}`;return h;}
async function api(path,options={}){const response=await fetch(config.supabaseUrl+path,{...options,headers:{...apiHeaders(options.access!==false),...(options.headers||{})}});const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}if(!response.ok)throw new Error(data?.msg||data?.error_description||data?.message||`Erro ${response.status}`);return data;}
function saveSession(value){session=value;ownerAccess=false;document.documentElement.dataset.access='visitor';if(value)localStorage.setItem(SESSION_KEY,JSON.stringify(value));else localStorage.removeItem(SESSION_KEY);render();}
async function ensureSession(){if(!session)return false;if(Date.now() < (session.expires_at||0)*1000-60000)return true;try{const data=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token}),access:false});saveSession({...data,expires_at:Math.floor(Date.now()/1000)+data.expires_in});await verifyOwner();return ownerAccess}catch{saveSession(null);return false}}
async function sendMagicLink(event){event.preventDefault();if(!configured){$('#account-message').textContent='A sincronização ainda precisa ser conectada pelo proprietário do site.';return}const email=$('#login-email').value.trim();if(!await isOwnerEmail(email)){$('#account-message').textContent='Esta conta não tem permissão para editar a biblioteca.';return}try{const redirect=encodeURIComponent(location.origin+location.pathname);await api(`/auth/v1/otp?redirect_to=${redirect}`,{method:'POST',body:JSON.stringify({email,create_user:true}),access:false});$('#account-message').textContent=`Enviamos um link para ${email}. Abra o e-mail neste aparelho.`;}catch(err){$('#account-message').textContent=err.message}}
async function handleAuthRedirect(){const hash=new URLSearchParams(location.hash.replace(/^#/,''));if(!hash.has('access_token'))return;const access_token=hash.get('access_token'),refresh_token=hash.get('refresh_token'),expires_in=Number(hash.get('expires_in')||3600);if(access_token&&refresh_token){const user=await api('/auth/v1/user',{headers:{Authorization:`Bearer ${access_token}`}}).catch(()=>null);saveSession({access_token,refresh_token,expires_at:Math.floor(Date.now()/1000)+expires_in,user});await verifyOwner();history.replaceState({},'',location.pathname+location.search);showToast('Conta conectada');}}
async function sync(){if(!configured||!session||!ownerAccess)return;if(syncBusy){syncAgain=true;return}syncBusy=true;try{if(!await ensureSession()||!ownerAccess)return;if(!session.user)session.user=await api('/auth/v1/user');const remote=await api('/rest/v1/games?select=id,data,updated_at&limit=1000',{headers:{Accept:'application/json'}});const remoteById=new Map(remote.map(row=>[row.id,row]));for(const game of games)if(!remoteById.has(game.id))dirty.add(game.id);saveDirty();for(const id of [...dirty]){const local=games.find(g=>g.id===id);if(!local){dirty.delete(id);continue}const other=remoteById.get(id);if(other&&(other.updated_at||'')>(local.updatedAt||'')){games=games.map(g=>g.id===id?normalized(other.data):g);dirty.delete(id);continue}const uploadStamp=local.updatedAt;await api('/rest/v1/games?on_conflict=owner_id,id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id,owner_id:session.user.id,data:local,updated_at:uploadStamp||new Date().toISOString()})});if(games.find(g=>g.id===id)?.updatedAt===uploadStamp)dirty.delete(id)}saveDirty();for(const row of remote){if(!dirty.has(row.id)){const index=games.findIndex(g=>g.id===row.id);if(index<0)games.push(normalized(row.data));else if((row.updated_at||'')>(games[index].updatedAt||''))games[index]=normalized(row.data)}}saveCache();render();$('#sync-status').textContent='Sincronizado agora';}catch(err){$('#sync-status').textContent='Sem conexão · salvo aqui';console.error(err)}finally{syncBusy=false;if(syncAgain){syncAgain=false;queueMicrotask(sync)}}}
async function uploadCover(file,id){if(!ownerAccess||!configured||!session)throw new Error('Entre na sua conta para enviar uma capa.');if(!await ensureSession())throw new Error('Sua sessão expirou. Entre novamente.');if(file.size>5*1024*1024)throw new Error('A capa deve ter até 5 MB.');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Para enviar pelo site, use JPG, PNG ou WebP.');const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';const name=`${session.user.id}/${id}-${Date.now()}.${ext}`;const response=await fetch(`${config.supabaseUrl}/storage/v1/object/covers/${name}`,{method:'POST',headers:{apikey:config.publishableKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':file.type,'x-upsert':'false'},body:file});if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.message||'Não foi possível enviar a capa.')}return `${config.supabaseUrl}/storage/v1/object/public/covers/${name}`;}
async function boot(){
  const seed=await fetch('data/games.json').then(r=>r.json()).catch(()=>[]);
  seedCovers=new Map(seed.filter(g=>g.cover).map(g=>[g.id,g.cover]));
  seedConsoles=new Map(seed.filter(g=>g.console).map(g=>[g.id,g.console]));
  const cached=JSON.parse(localStorage.getItem(STORE_KEY)||'null');games=Array.isArray(cached)?cached.map(normalized):seed.map(normalized);
  if(Array.isArray(cached)){const known=new Set(games.map(g=>g.id));for(const g of seed)if(!known.has(g.id))games.push(normalized(g));}
  saveCache();
  for(const [value,label] of Object.entries(STATUS)){$('#status-filter').add(new Option(label,value));$('#editor-form').elements.status.add(new Option(label,value));}
  $('#add-button').onclick=()=>openEditor();$('#close-editor').onclick=$('#cancel-editor').onclick=()=>$('#editor-dialog').close();$('#editor-form').onsubmit=saveEditor;$('#delete-button').onclick=deleteGame;$('#editor-form').elements.platform.onchange=updatePlatformFields;
  $('#rating-buttons').onclick=e=>{const btn=e.target.closest('[data-rating]');if(btn){rating=Number(btn.dataset.rating);renderRating()}};$('#clear-rating').onclick=()=>{rating=0;renderRating()};
  for(const id of ['search','platform-filter','console-filter','status-filter','priority-filter','sort-filter'])$('#'+id).addEventListener(id==='search'?'input':'change',render);
  $('#game-grid').onclick=e=>{if(!ownerAccess)return;const edit=e.target.closest('[data-edit]');if(edit)openEditor(edit.dataset.edit)};
  $('#game-grid').onkeydown=e=>{if(!ownerAccess||!['Enter',' '].includes(e.key))return;const edit=e.target.closest('.card-main[data-edit]');if(edit){e.preventDefault();openEditor(edit.dataset.edit)}};
  $('#game-grid').onchange=e=>{const select=e.target.closest('[data-status]');if(select)setQuickStatus(select.dataset.status,select.value)};
  $('#account-button').onclick=()=>{const text=ownerAccess?`Conectado como ${session.user?.email||'usuário'}. Suas alterações sincronizam entre aparelhos.`:session?'Esta conta não tem permissão para editar esta biblioteca.':'Entre com a conta do proprietário para editar jogos, notas e anotações.';$('#account-explanation').textContent=text;$('#login-form').hidden=!!session||!configured;$('#logout-button').hidden=!session;$('#account-message').textContent='';$('#account-dialog').showModal()};
  $('#close-account').onclick=()=>$('#account-dialog').close();$('#login-form').onsubmit=sendMagicLink;$('#logout-button').onclick=()=>{saveSession(null);$('#account-dialog').close();showToast('Você saiu da conta')};
  render();if(configured){session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');await handleAuthRedirect();if(session){if(await ensureSession()){session.user=await api('/auth/v1/user').catch(()=>null);await verifyOwner();if(ownerAccess)sync()}else await verifyOwner();}else await verifyOwner();}window.addEventListener('online',()=>{if(session)sync()});window.addEventListener('focus',()=>{if(session)sync()});
}
applyTheme(document.documentElement.dataset.theme, false);
document.querySelector('.theme-options').addEventListener('click', event => {
  const button = event.target.closest('[data-theme-choice]');
  if (button) applyTheme(button.dataset.themeChoice);
});
boot();
