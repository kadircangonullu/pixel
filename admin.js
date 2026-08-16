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

const pageCopy={dashboard:['Genel Bakış','Sezon, kullanıcı ve moderasyon durumunu tek ekrandan yönet.'],seasons:['Sezonlar','Yeni sezon aç, tarihleri ve durumları düzenle.'],players:['Oyuncular','Hesapları incele ve gerektiğinde süreli ban uygula.'],pixels:['Piksel Moderasyonu','Son yerleştirmeleri denetle ve uygunsuz pikselleri kaldır.'],battlemap:['Savaş Motoru','81 il rasterını doğrula, hazırla ve server-side savaş durumunu yeniden kur.'],zones:['Korumalı Alanlar','Artwork veya etkinlik alanlarını takım bazlı korumaya al.'],logs:['Moderasyon Logu','Admin işlemlerinin denetim kaydını görüntüle.']};
document.querySelectorAll('.admin-nav').forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll('.admin-nav').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  document.querySelectorAll('.admin-tab').forEach(p=>p.classList.remove('active')); document.querySelector(`[data-panel="${btn.dataset.tab}"]`)?.classList.add('active');
  const copy=pageCopy[btn.dataset.tab]; $('pageTitle').textContent=copy[0]; $('pageSubtitle').textContent=copy[1];
  ({dashboard:loadDashboard,seasons:loadSeasons,players:loadPlayers,pixels:loadPixels,battlemap:loadBattleMapStatus,zones:loadZones,logs:loadLogs}[btn.dataset.tab])?.();
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

// V13 Battle Map Builder — admin-only, explicit bootstrap
const BATTLE_GEOJSON_URL="https://raw.githubusercontent.com/cihadturhan/tr-geojson/master/geo/tr-cities-utf8.json";
const BATTLE_W=1440,BATTLE_H=615;
const BATTLE_REGIONS={"Marmara": ["Balıkesir", "Bilecik", "Bursa", "Çanakkale", "Edirne", "İstanbul", "Kırklareli", "Kocaeli", "Sakarya", "Tekirdağ", "Yalova"], "Ege": ["Afyonkarahisar", "Aydın", "Denizli", "İzmir", "Kütahya", "Manisa", "Muğla", "Uşak"], "Akdeniz": ["Adana", "Antalya", "Burdur", "Hatay", "Isparta", "Kahramanmaraş", "Mersin", "Osmaniye"], "İç Anadolu": ["Aksaray", "Ankara", "Çankırı", "Eskişehir", "Karaman", "Kayseri", "Kırıkkale", "Kırşehir", "Konya", "Nevşehir", "Niğde", "Sivas", "Yozgat"], "Karadeniz": ["Amasya", "Artvin", "Bartın", "Bayburt", "Bolu", "Çorum", "Düzce", "Giresun", "Gümüşhane", "Karabük", "Kastamonu", "Ordu", "Rize", "Samsun", "Sinop", "Tokat", "Trabzon", "Zonguldak"], "Doğu Anadolu": ["Ağrı", "Ardahan", "Bingöl", "Bitlis", "Elazığ", "Erzincan", "Erzurum", "Hakkari", "Iğdır", "Kars", "Malatya", "Muş", "Tunceli", "Van"], "Güneydoğu Anadolu": ["Adıyaman", "Batman", "Diyarbakır", "Gaziantep", "Kilis", "Mardin", "Siirt", "Şanlıurfa", "Şırnak"]};
const BATTLE_HOME={"İstanbul": "crush", "İzmir": "manifest", "Ankara": "aura", "Antalya": "karm6", "Samsun": "mantra", "Erzurum": "radikal", "Gaziantep": "perma"};
function battleNormalize(value=""){return String(value).trim().toLocaleUpperCase("tr-TR").replaceAll("İ","I").replaceAll("İ","I").replaceAll("Ş","S").replaceAll("Ğ","G").replaceAll("Ü","U").replaceAll("Ö","O").replaceAll("Ç","C").replaceAll("Â","A").replace(/[^A-Z0-9]/g,"");}
const battleProvinceNames=[...new Set(Object.values(BATTLE_REGIONS).flat())];
const battleCanonical=new Map(battleProvinceNames.map(n=>[battleNormalize(n),n]));
battleCanonical.set(battleNormalize("Afyon"),"Afyonkarahisar");battleCanonical.set(battleNormalize("Afyon K."),"Afyonkarahisar");battleCanonical.set(battleNormalize("K.Maraş"),"Kahramanmaraş");battleCanonical.set(battleNormalize("K Maras"),"Kahramanmaraş");battleCanonical.set(battleNormalize("İçel"),"Mersin");
function battleName(f){for(const v of Object.values(f?.properties||{})){if(typeof v!=="string")continue;const c=battleCanonical.get(battleNormalize(v));if(c)return c;}return null;}
function battleWalk(c,cb){if(!Array.isArray(c))return;if(typeof c[0]==="number"&&typeof c[1]==="number"){cb(c[0],c[1]);return;}for(const i of c)battleWalk(i,cb);}
function battleBBox(f){let minLon=Infinity,minLat=Infinity,maxLon=-Infinity,maxLat=-Infinity;battleWalk(f.geometry.coordinates,(lon,lat)=>{minLon=Math.min(minLon,lon);maxLon=Math.max(maxLon,lon);minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat)});return{minLon,minLat,maxLon,maxLat};}
function battleRings(g){if(!g)return[];if(g.type==="Polygon")return[g.coordinates];if(g.type==="MultiPolygon")return g.coordinates;return[];}
function battlePIR(lon,lat,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];const hit=(yi>lat)!=(yj>lat)&&lon<((xj-xi)*(lat-yi))/((yj-yi)||Number.EPSILON)+xi;if(hit)inside=!inside;}return inside;}
function battlePIG(lon,lat,g){for(const poly of battleRings(g)){if(!poly?.length||!battlePIR(lon,lat,poly[0]))continue;let hole=false;for(let h=1;h<poly.length;h++)if(battlePIR(lon,lat,poly[h])){hole=true;break;}if(!hole)return true;}return false;}
function battleRegion(name){return Object.entries(BATTLE_REGIONS).find(([,a])=>a.includes(name))?.[0]||"Bilinmeyen Bölge";}
async function buildBattlePayload(progress){const res=await fetch(BATTLE_GEOJSON_URL,{cache:"force-cache"});if(!res.ok)throw new Error(`GeoJSON HTTP ${res.status}`);const raw=(await res.json()).features||[];const fs=raw.map(f=>({...f,_name:battleName(f),_bbox:battleBBox(f)})).filter(f=>f._name);if(fs.length<75)throw new Error(`Yalnızca ${fs.length} il eşleşti.`);let bounds={minLon:Infinity,minLat:Infinity,maxLon:-Infinity,maxLat:-Infinity};for(const f of fs){bounds.minLon=Math.min(bounds.minLon,f._bbox.minLon);bounds.maxLon=Math.max(bounds.maxLon,f._bbox.maxLon);bounds.minLat=Math.min(bounds.minLat,f._bbox.minLat);bounds.maxLat=Math.max(bounds.maxLat,f._bbox.maxLat);}const lonX=lon=>(lon-bounds.minLon)/(bounds.maxLon-bounds.minLon)*(BATTLE_W-1),latY=lat=>(bounds.maxLat-lat)/(bounds.maxLat-bounds.minLat)*(BATTLE_H-1),xLon=x=>bounds.minLon+x/(BATTLE_W-1)*(bounds.maxLon-bounds.minLon),yLat=y=>bounds.maxLat-y/(BATTLE_H-1)*(bounds.maxLat-bounds.minLat);const grid=new Uint8Array(BATTLE_W*BATTLE_H),names=[null],totals=[];for(let fi=0;fi<fs.length;fi++){const f=fs[fi],pi=fi+1;names[pi]=f._name;const b=f._bbox,minX=Math.max(0,Math.floor(lonX(b.minLon))-1),maxX=Math.min(BATTLE_W-1,Math.ceil(lonX(b.maxLon))+1),minY=Math.max(0,Math.floor(latY(b.maxLat))-1),maxY=Math.min(BATTLE_H-1,Math.ceil(latY(b.minLat))+1);let total=0;for(let y=minY;y<=maxY;y++){const lat=yLat(y+.5);for(let x=minX;x<=maxX;x++){const lon=xLon(x+.5);if(!battlePIG(lon,lat,f.geometry))continue;grid[y*BATTLE_W+x]=pi;total++;}}totals.push({province_name:f._name,total_cells:total,region_name:battleRegion(f._name),home_team_id:BATTLE_HOME[f._name]||null});progress?.(5+Math.round((fi+1)/fs.length*45),`Raster: ${fi+1}/${fs.length} il`);await new Promise(r=>setTimeout(r,0));}const runs=[];for(let y=0;y<BATTLE_H;y++){let x=0;while(x<BATTLE_W){const pi=grid[y*BATTLE_W+x];if(!pi){x++;continue;}const x1=x;x++;while(x<BATTLE_W&&grid[y*BATTLE_W+x]===pi)x++;runs.push({y,x1,x2:x-1,province_name:names[pi]});}if(y%40===0){progress?.(50+Math.round(y/BATTLE_H*15),`Run üretimi: ${y}/${BATTLE_H}`);await new Promise(r=>setTimeout(r,0));}}return{totals,runs};}
async function loadBattleMapStatus(){if(!isAdminUser)return;const {data,error}=await sb.rpc("battle_map_status");if(error){toast(error.message);return;}const r=Array.isArray(data)?data[0]:data;$('battleProvinceCount').textContent=`${Number(r?.province_count||0)} / 81`;$('battleRunCount').textContent=Number(r?.run_count||0).toLocaleString('tr-TR');$('battleReadyState').textContent=r?.ready?'READY':'HAZIR DEĞİL';$('battleReadyState').className=r?.ready?'ready':'not-ready';$('battleMapProgressFill').style.width=r?.ready?'100%':`${Math.min(99,Number(r?.province_count||0)/81*45+(Number(r?.run_count||0)>0?45:0))}%`;$('battleMapMessage').textContent=r?.ready?'Server-side savaş motoru kullanıma hazır.':'Harita eksik veya yarım kalmış. Hazırla butonuyla güvenli biçimde yeniden oluşturabilirsin.';}
$('refreshBattleMapBtn').onclick=loadBattleMapStatus;
$('prepareBattleMapBtn').onclick=async()=>{if(!confirm('Savaş haritası yeniden oluşturulsun mu? Mevcut pixel kayıtları silinmez; savaş sayaçları sonunda yeniden hesaplanır.'))return;const st=$('battleMapActionStatus'),fill=$('battleMapProgressFill');const prog=(pct,msg)=>{fill.style.width=`${pct}%`;st.textContent=msg;};try{$('prepareBattleMapBtn').disabled=true;prog(1,'Türkiye GeoJSON hazırlanıyor…');const {totals,runs}=await buildBattlePayload(prog);if(totals.length!==81)throw new Error(`81 il bekleniyordu, ${totals.length} üretildi.`);prog(68,'Sunucu tabloları temizleniyor…');let r=await sb.rpc('admin_begin_battle_map_sync');if(r.error)throw r.error;prog(71,'81 il toplamı gönderiliyor…');r=await sb.rpc('admin_sync_province_totals',{p_rows:totals});if(r.error)throw r.error;if(Number(r.data)!==81)throw new Error(`İl toplamı RPC ${r.data} döndürdü.`);const batch=350;for(let i=0;i<runs.length;i+=batch){r=await sb.rpc('admin_sync_province_runs',{p_rows:runs.slice(i,i+batch)});if(r.error)throw r.error;prog(74+Math.round(Math.min(1,(i+batch)/runs.length)*20),`Koordinatlar: ${Math.min(i+batch,runs.length)}/${runs.length}`);}prog(95,'Savaş durumları yeniden hesaplanıyor…');r=await sb.rpc('admin_finalize_battle_map');if(r.error)throw r.error;prog(100,`Hazır · 81 il · ${runs.length.toLocaleString('tr-TR')} run`);toast('V13 savaş motoru hazır.');await loadBattleMapStatus();}catch(e){console.error(e);st.textContent=`Hata: ${e.message||e}`;toast(`Harita hazırlanamadı: ${e.message||e}`);}finally{$('prepareBattleMapBtn').disabled=false;}};

ensureAdmin();
if(sb) sb.auth.onAuthStateChange(()=>setTimeout(ensureAdmin,0));
