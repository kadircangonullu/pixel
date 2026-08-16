const CFG = window.FANVERSE_SUPABASE || {};
const SB_ENABLED = Boolean(CFG.url && CFG.publishableKey && window.supabase?.createClient);
const sb = SB_ENABLED ? window.supabase.createClient(CFG.url, CFG.publishableKey) : null;
let currentUser = null;
let isAdminUser = false;
let activeEvent = null;

const $ = (id) => document.getElementById(id);
const TEAM_COLORS = {crush:'#ff4b9b',manifest:'#4ba8ff',aura:'#9c6bff',karm6:'#ff7b38',mantra:'#ffcf42',radikal:'#ee4054',perma:'#4ce3a4'};
const TEAM_NAMES = {crush:'CRUSH',manifest:'MANIFEST',aura:'AURA',karm6:'KARM6',mantra:'MANTRA',radikal:'RADİKAL',perma:'PERMA'};

function toast(text){ const el=$('adminToast'); el.textContent=text; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),2600); }
function status(text,kind=''){ const el=$('adminAuthStatus'); el.textContent=text; el.className=`status ${kind}`; }
function dt(value){ if(!value) return '—'; return new Intl.DateTimeFormat('tr-TR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)); }
function esc(v=''){ return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function toIsoLocal(v){ return v ? new Date(v).toISOString() : null; }
function eventState(ev){ const now=Date.now(), s=new Date(ev.starts_at).getTime(), e=new Date(ev.ends_at).getTime(); if(ev.status==='finished'||now>=e)return 'finished'; if(ev.status==='draft'||now<s)return 'waiting'; return 'active'; }

async function ensureAdmin(){
  if(!sb){ status('supabase-config.js henüz yapılandırılmamış.','error'); return false; }
  const {data:{session}} = await sb.auth.getSession();
  currentUser=session?.user||null;
  if(!currentUser){ showGate(); return false; }
  const {data,error}=await sb.rpc('is_admin');
  isAdminUser=!error && data===true;
  if(!isAdminUser){ status('Bu hesap admin_users tablosunda yetkili değil.','error'); await sb.auth.signOut(); currentUser=null; showGate(); return false; }
  showPanel(); return true;
}
function showGate(){ $('authGate').classList.remove('hidden'); $('adminContent').classList.add('hidden'); $('adminIdentity').textContent='Yetkili girişi gerekli'; }
function showPanel(){ $('authGate').classList.add('hidden'); $('adminContent').classList.remove('hidden'); $('adminIdentity').textContent=currentUser?.email||currentUser?.id||'Admin'; loadDashboard(); }

$('adminLoginBtn').onclick=async()=>{
  if(!sb){status('Önce supabase-config.js dosyasını doldur.','error');return;}
  status('Giriş yapılıyor…');
  const {error}=await sb.auth.signInWithPassword({email:$('adminEmail').value.trim(),password:$('adminPassword').value});
  if(error){status(error.message,'error');return;}
  const ok=await ensureAdmin(); if(ok) status('Yetkili giriş başarılı.','ok');
};
$('adminSignOutBtn').onclick=async()=>{ if(sb) await sb.auth.signOut(); currentUser=null; isAdminUser=false; showGate(); };

const pageCopy={dashboard:['Genel Bakış','Sezon, kullanıcı ve moderasyon durumunu tek ekrandan yönet.'],seasons:['Sezonlar','Yeni sezon aç, tarihleri ve durumları düzenle.'],players:['Oyuncular','Hesapları incele ve gerektiğinde süreli ban uygula.'],pixels:['Piksel Moderasyonu','Son yerleştirmeleri denetle ve uygunsuz pikselleri kaldır.'],zones:['Korumalı Alanlar','Artwork veya etkinlik alanlarını takım bazlı korumaya al.'],logs:['Moderasyon Logu','Admin işlemlerinin denetim kaydını görüntüle.']};
document.querySelectorAll('.admin-nav').forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll('.admin-nav').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  document.querySelectorAll('.admin-tab').forEach(p=>p.classList.remove('active')); document.querySelector(`[data-panel="${btn.dataset.tab}"]`)?.classList.add('active');
  const copy=pageCopy[btn.dataset.tab]; $('pageTitle').textContent=copy[0]; $('pageSubtitle').textContent=copy[1];
  ({dashboard:loadDashboard,seasons:loadSeasons,players:loadPlayers,pixels:loadPixels,zones:loadZones,logs:loadLogs}[btn.dataset.tab])?.();
});

async function getActiveEvent(){
  const slug=CFG.eventSlug||'season-01';
  const {data}=await sb.from('events').select('*').eq('slug',slug).maybeSingle(); activeEvent=data||null; return activeEvent;
}
async function loadDashboard(){
  if(!isAdminUser)return;
  const ev=await getActiveEvent();
  $('metricActiveSeason').textContent=ev?.name||'—'; $('metricSeasonState').textContent=ev?`${eventState(ev).toUpperCase()} · ${dt(ev.ends_at)}`:'Etkinlik bulunamadı';
  const [{count:players},{count:pixels},{data:bans},{data:members},{data:logs}] = await Promise.all([
    sb.from('profiles').select('id',{count:'exact',head:true}),
    ev?sb.from('pixels').select('x',{count:'exact',head:true}).eq('event_id',ev.id):Promise.resolve({count:0}),
    sb.from('user_moderation').select('user_id,banned_until').gt('banned_until',new Date().toISOString()),
    ev?sb.from('event_memberships').select('team_id').eq('event_id',ev.id):Promise.resolve({data:[]}),
    sb.from('moderation_log').select('action,created_at,details').order('created_at',{ascending:false}).limit(7)
  ]);
  $('metricPlayers').textContent=(players||0).toLocaleString('tr-TR'); $('metricPixels').textContent=(pixels||0).toLocaleString('tr-TR'); $('metricBans').textContent=(bans||[]).length;
  const counts={}; (members||[]).forEach(m=>counts[m.team_id]=(counts[m.team_id]||0)+1); const max=Math.max(1,...Object.values(counts));
  $('teamDistribution').innerHTML=Object.keys(TEAM_NAMES).map(id=>`<div class="bar-item"><b>${TEAM_NAMES[id]}</b><div class="bar-track"><div class="bar-fill" style="width:${((counts[id]||0)/max)*100}%;background:${TEAM_COLORS[id]}"></div></div><span>${counts[id]||0}</span></div>`).join('');
  $('recentActivity').innerHTML=(logs||[]).length?(logs||[]).map(l=>`<div class="feed-item"><strong>${esc(l.action)}</strong> · ${dt(l.created_at)}<br><span>${esc(JSON.stringify(l.details||{}))}</span></div>`).join(''):'<div class="feed-item">Henüz moderasyon işlemi yok.</div>';
}
$('refreshDashboardBtn').onclick=loadDashboard;

async function loadSeasons(){
  const {data,error}=await sb.from('events').select('*').order('starts_at',{ascending:false}); if(error){toast(error.message);return;}
  $('seasonAdminList').innerHTML=(data||[]).map(ev=>`<div class="list-item"><div><strong>${esc(ev.name)}</strong><small>${esc(ev.slug)} · ${dt(ev.starts_at)} → ${dt(ev.ends_at)} · ${ev.status}</small></div><div class="actions"><button data-event-status="${ev.id}" data-status="active">AKTİF</button><button data-event-status="${ev.id}" data-status="finished">BİTİR</button></div></div>`).join('')||'<div class="list-item">Sezon yok.</div>';
  document.querySelectorAll('[data-event-status]').forEach(b=>b.onclick=async()=>{ const {error}=await sb.from('events').update({status:b.dataset.status}).eq('id',b.dataset.eventStatus); if(error)toast(error.message);else{toast('Sezon durumu güncellendi.');loadSeasons();} });
}
$('refreshSeasonsBtn').onclick=loadSeasons;
$('createSeasonBtn').onclick=async()=>{
  const row={slug:$('newSeasonSlug').value.trim(),name:$('newSeasonName').value.trim(),starts_at:toIsoLocal($('newSeasonStart').value),ends_at:toIsoLocal($('newSeasonEnd').value),status:$('newSeasonStatus').value};
  if(!row.slug||!row.name||!row.starts_at||!row.ends_at){toast('Tüm sezon alanlarını doldur.');return;}
  const {error}=await sb.from('events').insert(row); if(error)toast(error.message);else{toast('Yeni sezon oluşturuldu.');loadSeasons();}
};

async function loadPlayers(){
  const q=$('playerSearch').value.trim(); let query=sb.from('profiles').select('id,username,xp,total_placed,created_at').order('total_placed',{ascending:false}).limit(100);
  if(q){ query=q.includes('-')?query.eq('id',q):query.ilike('username',`%${q}%`); }
  const [{data,error},{data:bans}]=await Promise.all([query,sb.from('user_moderation').select('user_id,banned_until,reason')]); if(error){toast(error.message);return;}
  const banMap=new Map((bans||[]).map(b=>[b.user_id,b]));
  $('playersTable').innerHTML=`<table class="admin-table"><thead><tr><th>Kullanıcı</th><th>UUID</th><th>XP</th><th>Piksel</th><th>Durum</th><th></th></tr></thead><tbody>${(data||[]).map(p=>{const b=banMap.get(p.id),active=b?.banned_until&&new Date(b.banned_until)>new Date();return `<tr><td><strong>${esc(p.username)}</strong></td><td>${esc(p.id)}</td><td>${Number(p.xp||0).toLocaleString('tr-TR')}</td><td>${Number(p.total_placed||0).toLocaleString('tr-TR')}</td><td><span class="pill ${active?'banned':'active'}">${active?`BAN · ${dt(b.banned_until)}`:'AKTİF'}</span></td><td><button data-ban-target="${p.id}">SEÇ</button></td></tr>`}).join('')}</tbody></table>`;
  document.querySelectorAll('[data-ban-target]').forEach(b=>b.onclick=()=>{$('banUserId').value=b.dataset.banTarget;window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});});
}
$('refreshPlayersBtn').onclick=loadPlayers; $('playerSearchBtn').onclick=loadPlayers;
async function setBan(hours){const id=$('banUserId').value.trim();if(!id){toast('User UUID gerekli.');return;}const {error}=await sb.rpc('admin_set_user_ban',{p_user_id:id,p_hours:hours,p_reason:$('banReason').value.trim()||null});if(error)toast(error.message);else{toast(hours?'Ban uygulandı.':'Ban kaldırıldı.');loadPlayers();loadDashboard();}}
$('banUserBtn').onclick=()=>setBan(Math.max(1,Number($('banHours').value||24))); $('unbanUserBtn').onclick=()=>setBan(0);

async function loadPixels(){
  const ev=await getActiveEvent(); if(!ev){$('pixelsTable').innerHTML='Aktif sezon bulunamadı.';return;}
  const {data,error}=await sb.from('pixels').select('x,y,color,team_id,placed_by,province_name,updated_at').eq('event_id',ev.id).order('updated_at',{ascending:false}).limit(100); if(error){toast(error.message);return;}
  $('pixelsTable').innerHTML=`<table class="admin-table"><thead><tr><th>Zaman</th><th>İl</th><th>Koordinat</th><th>Takım</th><th>Renk</th><th>Kullanıcı</th><th></th></tr></thead><tbody>${(data||[]).map(p=>`<tr><td>${dt(p.updated_at)}</td><td>${esc(p.province_name||'—')}</td><td>${p.x}, ${p.y}</td><td><span class="pill" style="border-color:${TEAM_COLORS[p.team_id]||'#555'}">${esc(TEAM_NAMES[p.team_id]||p.team_id)}</span></td><td><span style="display:inline-block;width:13px;height:13px;background:${esc(p.color)};border-radius:3px;vertical-align:middle"></span> ${esc(p.color)}</td><td>${esc(p.placed_by)}</td><td><button data-px="${p.x}" data-py="${p.y}">KALDIR</button></td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('[data-px]').forEach(b=>b.onclick=()=>{$('deletePixelSeason').value=ev.slug;$('deletePixelX').value=b.dataset.px;$('deletePixelY').value=b.dataset.py;});
}
$('refreshPixelsBtn').onclick=loadPixels;
$('deletePixelBtn').onclick=async()=>{const {data,error}=await sb.rpc('admin_delete_pixel',{p_event_slug:$('deletePixelSeason').value.trim(),p_x:Number($('deletePixelX').value),p_y:Number($('deletePixelY').value),p_reason:$('deletePixelReason').value.trim()||null});if(error)toast(error.message);else{toast(data?'Piksel kaldırıldı.':'Bu koordinatta DB pikseli yok.');loadPixels();loadDashboard();}};

async function loadZones(){
  const ev=await getActiveEvent(); let query=sb.from('protected_zones').select('id,label,x1,y1,x2,y2,allowed_team_id,starts_at,ends_at,event_id,created_at').order('created_at',{ascending:false}); if(ev)query=query.eq('event_id',ev.id);
  const {data,error}=await query;if(error){toast(error.message);return;}
  $('zonesList').innerHTML=(data||[]).map(z=>`<div class="list-item"><div><strong>${esc(z.label)}</strong><small>(${z.x1},${z.y1}) → (${z.x2},${z.y2}) · ${z.allowed_team_id?`Sadece ${TEAM_NAMES[z.allowed_team_id]||z.allowed_team_id}`:'Tam kilit'}</small></div><div class="actions"><button data-zone-delete="${z.id}">SİL</button></div></div>`).join('')||'<div class="list-item">Aktif korumalı alan yok.</div>';
  document.querySelectorAll('[data-zone-delete]').forEach(b=>b.onclick=async()=>{const {error}=await sb.rpc('admin_delete_protected_zone',{p_zone_id:b.dataset.zoneDelete});if(error)toast(error.message);else{toast('Koruma kaldırıldı.');loadZones();}});
}
$('refreshZonesBtn').onclick=loadZones;
$('createZoneBtn').onclick=async()=>{const payload={p_event_slug:$('zoneSeason').value.trim(),p_label:$('zoneLabel').value.trim(),p_x1:Number($('zoneX1').value),p_y1:Number($('zoneY1').value),p_x2:Number($('zoneX2').value),p_y2:Number($('zoneY2').value),p_allowed_team_id:$('zoneTeam').value||null,p_starts_at:null,p_ends_at:null};if(!payload.p_label){toast('Alan etiketi gerekli.');return;}const {error}=await sb.rpc('admin_create_protected_zone',payload);if(error)toast(error.message);else{toast('Korumalı alan oluşturuldu.');loadZones();}};

async function loadLogs(){const {data,error}=await sb.from('moderation_log').select('*').order('created_at',{ascending:false}).limit(200);if(error){toast(error.message);return;}$('logsTable').innerHTML=`<table class="admin-table"><thead><tr><th>Zaman</th><th>İşlem</th><th>Admin</th><th>Hedef</th><th>Koordinat</th><th>Detay</th></tr></thead><tbody>${(data||[]).map(l=>`<tr><td>${dt(l.created_at)}</td><td><strong>${esc(l.action)}</strong></td><td>${esc(l.admin_user_id||'—')}</td><td>${esc(l.target_user_id||'—')}</td><td>${l.x??'—'}, ${l.y??'—'}</td><td>${esc(JSON.stringify(l.details||{}))}</td></tr>`).join('')}</tbody></table>`;}
$('refreshLogsBtn').onclick=loadLogs;

ensureAdmin();
if(sb) sb.auth.onAuthStateChange(()=>setTimeout(ensureAdmin,0));
