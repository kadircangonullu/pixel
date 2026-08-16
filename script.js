const GEOJSON_URL = "https://raw.githubusercontent.com/cihadturhan/tr-geojson/master/geo/tr-cities-utf8.json";

// V9 account / season layer
const FANVERSE_CONFIG = window.FANVERSE_SUPABASE || {};
const EVENT_SLUG = FANVERSE_CONFIG.eventSlug || "season-01";
const TEAM_LOCK_STORAGE_KEY = `fanverse_v9_team_${EVENT_SLUG}`;
const SUPABASE_ENABLED = Boolean(
  FANVERSE_CONFIG.url &&
  FANVERSE_CONFIG.publishableKey &&
  window.supabase?.createClient
);
let supabaseClient = null;
let authUser = null;
let activeEvent = null;
let seasonResultShown = false;
let seasonUiTimer = null;
let realtimePixelChannel = null;
let realtimeBattleChannel = null;
let battleStateReloadTimer = null;
let battleMapSyncAttempted = false;
const serverProvinceStats = new Map();
let battleMapReady = false;
let remotePixelsLoaded = false;
let remoteSyncPending = false;
let liveStatsTimer = null;
let presenceTimer = null;
let welcomeDismissed = false;
let serverLiveStats = null;
let lockedTeamId = localStorage.getItem(TEAM_LOCK_STORAGE_KEY) || null;
let onboardingCandidateId = null;
let serverProfileOverview = null;

const teams = [
  { id: "crush", name: "CRUSH", color: "#ff4b9b", city: "İstanbul", points: 0, pixels: 0, provinceBonus:0, regionBonus:0, capturedProvinces: 0, securedRegions: 0 },
  { id: "manifest", name: "MANIFEST", color: "#4ba8ff", city: "İzmir", points: 0, pixels: 0, provinceBonus:0, regionBonus:0, capturedProvinces: 0, securedRegions: 0 },
  { id: "aura", name: "AURA", color: "#9c6bff", city: "Ankara", points: 0, pixels: 0, provinceBonus:0, regionBonus:0, capturedProvinces: 0, securedRegions: 0 },
  { id: "karm6", name: "KARM6", color: "#ff7b38", city: "Antalya", points: 0, pixels: 0, provinceBonus:0, regionBonus:0, capturedProvinces: 0, securedRegions: 0 },
  { id: "mantra", name: "MANTRA", color: "#ffcf42", city: "Samsun", points: 0, pixels: 0, provinceBonus:0, regionBonus:0, capturedProvinces: 0, securedRegions: 0 },
  { id: "radikal", name: "RADİKAL", color: "#ee4054", city: "Erzurum", points: 0, pixels: 0, provinceBonus:0, regionBonus:0, capturedProvinces: 0, securedRegions: 0 },
  { id: "perma", name: "PERMA", color: "#4ce3a4", city: "Gaziantep", points: 0, pixels: 0, provinceBonus:0, regionBonus:0, capturedProvinces: 0, securedRegions: 0 }
];

const REGION_PROVINCES = {
  "Marmara": ["Balıkesir","Bilecik","Bursa","Çanakkale","Edirne","İstanbul","Kırklareli","Kocaeli","Sakarya","Tekirdağ","Yalova"],
  "Ege": ["Afyonkarahisar","Aydın","Denizli","İzmir","Kütahya","Manisa","Muğla","Uşak"],
  "Akdeniz": ["Adana","Antalya","Burdur","Hatay","Isparta","Kahramanmaraş","Mersin","Osmaniye"],
  "İç Anadolu": ["Aksaray","Ankara","Çankırı","Eskişehir","Karaman","Kayseri","Kırıkkale","Kırşehir","Konya","Nevşehir","Niğde","Sivas","Yozgat"],
  "Karadeniz": ["Amasya","Artvin","Bartın","Bayburt","Bolu","Çorum","Düzce","Giresun","Gümüşhane","Karabük","Kastamonu","Ordu","Rize","Samsun","Sinop","Tokat","Trabzon","Zonguldak"],
  "Doğu Anadolu": ["Ağrı","Ardahan","Bingöl","Bitlis","Elazığ","Erzincan","Erzurum","Hakkari","Iğdır","Kars","Malatya","Muş","Tunceli","Van"],
  "Güneydoğu Anadolu": ["Adıyaman","Batman","Diyarbakır","Gaziantep","Kilis","Mardin","Siirt","Şanlıurfa","Şırnak"]
};

const regions = Object.entries(REGION_PROVINCES).map(([name, provinceNames], index) => ({
  id: `region-${index + 1}`,
  name,
  provinceNames,
  securedBy: null
}));

const HOME_PROVINCES = {
  "İstanbul": "crush",
  "İzmir": "manifest",
  "Ankara": "aura",
  "Antalya": "karm6",
  "Samsun": "mantra",
  "Erzurum": "radikal",
  "Gaziantep": "perma"
};

const paletteColors = ["#ff4b9b","#ff3864","#ff713e","#ffc938","#67d45c","#3dd3a5","#44a7ff","#625dff","#a860ff","#ffffff","#adb5c5","#111111"];
const WORLD_WIDTH = 1440;
const WORLD_HEIGHT = 615;
const PROVINCE_BONUS = 5000;
const REGION_BONUS = 25000;
const COOLDOWN_MS = 30000;
const OCEAN = "#061426";
const LAND = "#27364c";
const LAND_ALT = "#2d3e56";
const BORDER = "rgba(238,244,255,.82)";
const INNER_BORDER = "rgba(225,234,247,.52)";

const canvas = document.getElementById("pixelCanvas");
const ctx = canvas.getContext("2d");
const miniMap = document.getElementById("miniMap");
const miniCtx = miniMap.getContext("2d");
const loadingEl = document.getElementById("mapLoading");

// v6 performance model: compact typed arrays + cached artwork / ownership / defense layers.
const CELL_COUNT = WORLD_WIDTH * WORLD_HEIGHT;
const provinceIndexGrid = new Uint8Array(CELL_COUNT); // 0 = sea, 1..81 = province
const ownerGrid = new Uint8Array(CELL_COUNT);         // 0 = neutral, 1..7 = fandom
const colorGrid = new Uint8Array(CELL_COUNT);         // compact palette/material index
const provinceNamesByIndex = [null];
const provinceIndexByName = new Map();
const teamIndexById = new Map(teams.map((t, i) => [t.id, i + 1]));
const teamIdByIndex = [null, ...teams.map(t => t.id)];

const MATERIAL_COLORS = [OCEAN, LAND, LAND_ALT, ...paletteColors];
const MATERIAL_OCEAN = 0;
const MATERIAL_LAND = 1;
const MATERIAL_LAND_ALT = 2;
const PALETTE_OFFSET = 3;

const worldLayer = document.createElement("canvas");
worldLayer.width = WORLD_WIDTH; worldLayer.height = WORLD_HEIGHT;
const worldLayerCtx = worldLayer.getContext("2d", { alpha: false });
worldLayerCtx.imageSmoothingEnabled = false;

const borderLayer = document.createElement("canvas");
borderLayer.width = WORLD_WIDTH; borderLayer.height = WORLD_HEIGHT;
const borderLayerCtx = borderLayer.getContext("2d");
borderLayerCtx.imageSmoothingEnabled = false;

const ownershipLayer = document.createElement("canvas");
ownershipLayer.width = WORLD_WIDTH; ownershipLayer.height = WORLD_HEIGHT;
const ownershipLayerCtx = ownershipLayer.getContext("2d", { alpha: false });
ownershipLayerCtx.imageSmoothingEnabled = false;

const defenseLayer = document.createElement("canvas");
defenseLayer.width = WORLD_WIDTH; defenseLayer.height = WORLD_HEIGHT;
const defenseLayerCtx = defenseLayer.getContext("2d");
defenseLayerCtx.imageSmoothingEnabled = false;
const heatmapLayer = document.createElement("canvas");
heatmapLayer.width = WORLD_WIDTH; heatmapLayer.height = WORLD_HEIGHT;
const heatmapLayerCtx = heatmapLayer.getContext("2d");
heatmapLayerCtx.imageSmoothingEnabled = false;
let heatmapDirty = true;

const miniBase = document.createElement("canvas");
miniBase.width = miniMap.width; miniBase.height = miniMap.height;
const miniBaseCtx = miniBase.getContext("2d", { alpha: false });
miniBaseCtx.imageSmoothingEnabled = false;

const provinceCellTotals = new Map();
const provinceOwnerCounts = new Map();
let totalPlayablePixels = 0;
let miniMapDirty = true;
let renderQueued = false;
let lastFrameMs = 0;

function idx(x, y) { return y * WORLD_WIDTH + x; }
function provinceAt(x, y) {
  if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) return null;
  return provinceNamesByIndex[provinceIndexGrid[idx(x, y)]] || null;
}
function ownerAt(x, y) { return teamIdByIndex[ownerGrid[idx(x, y)]] || null; }
function setWorldPixelMaterial(x, y, materialIndex) {
  const i = idx(x, y);
  colorGrid[i] = materialIndex;
  worldLayerCtx.fillStyle = MATERIAL_COLORS[materialIndex];
  worldLayerCtx.fillRect(x, y, 1, 1);
  miniMapDirty = true;
}
function scheduleDraw() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    draw();
  });
}

let provinceFeatures = [];
let provinceByName = new Map();
let geoBounds = null;
let selectedTeam = teams.find(t => t.id === lockedTeamId) || null;
let selectedColor = paletteColors[0];
let selectedPixel = null;
const dailyVisitedProvinces = new Set();
let hoveredProvinceName = null;
const PROFILE_STORAGE_KEY = "fanverse_v8_profile";
const COOLDOWN_STORAGE_KEY = "fanverse_v8_cooldown_end";
const DAILY_STORAGE_KEY = "fanverse_v8_daily";
let cooldownEnd = Number(localStorage.getItem(COOLDOWN_STORAGE_KEY) || 0);

const player = loadPlayerProfile();
let dailyState = loadDailyState();

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function loadPlayerProfile() {
  try {
    return { name:"guest", xp:0, totalPlaced:0, streak:0, lastActiveDay:null, ...JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}") };
  } catch { return { name:"guest", xp:0, totalPlaced:0, streak:0, lastActiveDay:null }; }
}
function savePlayerProfile() { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(player)); }
function loadDailyState() {
  const today = todayKey();
  try {
    const saved = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY) || "{}");
    if (saved.date === today) return saved;
  } catch {}
  const fresh = { date:today, placed:0, defense:0, provinces:0, claimedRewards:[] };
  localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}
function saveDailyState() { localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(dailyState)); }
function levelFromXp(xp) { return Math.floor(Math.sqrt(Math.max(0,xp) / 250)) + 1; }
function levelFloorXp(level) { return Math.pow(level - 1, 2) * 250; }
function nextLevelXp(level) { return Math.pow(level, 2) * 250; }
function awardXp(amount, reason="") {
  const oldLevel = levelFromXp(player.xp);
  player.xp += amount;
  const newLevel = levelFromXp(player.xp);
  savePlayerProfile();
  renderProgression();
  if (newLevel > oldLevel) showToast(`Seviye atladın! LV ${newLevel} · ${reason || "+XP"}`);
}
function registerDailyActivity(type, amount=1) {
  if (dailyState.date !== todayKey()) dailyState = loadDailyState();
  dailyState[type] = (dailyState[type] || 0) + amount;
  const today = todayKey();
  if (player.lastActiveDay !== today) {
    if (player.lastActiveDay) {
      const prev = new Date(player.lastActiveDay + "T12:00:00");
      const now = new Date(today + "T12:00:00");
      const diff = Math.round((now-prev)/86400000);
      player.streak = diff === 1 ? (player.streak || 0) + 1 : 1;
    } else player.streak = 1;
    player.lastActiveDay = today;
    savePlayerProfile();
  }
  saveDailyState();
  checkDailyRewards();
  renderProgression();
}
const DAILY_MISSIONS = [
  { id:"placed", label:"İzini bırak", desc:"Bugün 10 piksel yerleştir", target:10, reward:100 },
  { id:"defense", label:"Bölgeyi savun", desc:"3 yabancı pikseli geri al", target:3, reward:150 },
  { id:"provinces", label:"Cephe değiştir", desc:"3 farklı ilde piksel bırak", target:3, reward:125 }
];
function checkDailyRewards() {
  for (const mission of DAILY_MISSIONS) {
    if ((dailyState[mission.id] || 0) >= mission.target && !dailyState.claimedRewards.includes(mission.id)) {
      dailyState.claimedRewards.push(mission.id); saveDailyState(); awardXp(mission.reward, mission.label); showToast(`${mission.label} tamamlandı · +${mission.reward} XP`);
    }
  }
}

let todayPixels = 0;
let mapReady = false;
let viewMode = "ownership";
let defenseLayerTeamId = null;
let heatmapEnabled = false;
const ATTACK_WINDOW_MS = 5 * 60 * 1000;
const recentAttacks = [];
let foreignCursor = -1;
let foreignCursorProvince = null;
let camera = { x: 28, y: 8, zoom: 2.2 };
const MIN_ZOOM = 1.45;
const MAX_ZOOM = 48;
let isDragging = false;
let dragStartX = 0, dragStartY = 0, cameraStartX = 0, cameraStartY = 0, mouseMovedWhileDragging = false;

function teamById(id) { return teams.find(t => t.id === id); }
function normalizeName(value = "") {
  return String(value).trim().toLocaleUpperCase("tr-TR")
    .replaceAll("İ", "I").replaceAll("İ", "I").replaceAll("Ş", "S").replaceAll("Ğ", "G")
    .replaceAll("Ü", "U").replaceAll("Ö", "O").replaceAll("Ç", "C").replaceAll("Â", "A")
    .replace(/[^A-Z0-9]/g, "");
}

const allProvinceNames = [...new Set(Object.values(REGION_PROVINCES).flat())];
const canonicalByNormalized = new Map(allProvinceNames.map(name => [normalizeName(name), name]));
canonicalByNormalized.set(normalizeName("Afyon"), "Afyonkarahisar");
canonicalByNormalized.set(normalizeName("Afyon K."), "Afyonkarahisar");
canonicalByNormalized.set(normalizeName("K.Maraş"), "Kahramanmaraş");
canonicalByNormalized.set(normalizeName("K Maras"), "Kahramanmaraş");
canonicalByNormalized.set(normalizeName("İçel"), "Mersin");

function getFeatureProvinceName(feature) {
  const props = feature?.properties || {};
  for (const value of Object.values(props)) {
    if (typeof value !== "string") continue;
    const canonical = canonicalByNormalized.get(normalizeName(value));
    if (canonical) return canonical;
  }
  return null;
}

function getRegionNameForProvince(name) {
  return Object.entries(REGION_PROVINCES).find(([, list]) => list.includes(name))?.[0] || "Bilinmeyen Bölge";
}

function geometryRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function walkCoordinates(coords, cb) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") { cb(coords[0], coords[1]); return; }
  for (const item of coords) walkCoordinates(item, cb);
}

function featureBBox(feature) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  walkCoordinates(feature.geometry.coordinates, (lon, lat) => {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  });
  return { minLon, minLat, maxLon, maxLat };
}

function computeGeoBounds(features) {
  const b = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const f of features) {
    const fb = f._bbox;
    b.minLon = Math.min(b.minLon, fb.minLon); b.maxLon = Math.max(b.maxLon, fb.maxLon);
    b.minLat = Math.min(b.minLat, fb.minLat); b.maxLat = Math.max(b.maxLat, fb.maxLat);
  }
  return b;
}

function lonToWorldX(lon) { return (lon - geoBounds.minLon) / (geoBounds.maxLon - geoBounds.minLon) * (WORLD_WIDTH - 1); }
function latToWorldY(lat) { return (geoBounds.maxLat - lat) / (geoBounds.maxLat - geoBounds.minLat) * (WORLD_HEIGHT - 1); }
function worldXToLon(x) { return geoBounds.minLon + (x / (WORLD_WIDTH - 1)) * (geoBounds.maxLon - geoBounds.minLon); }
function worldYToLat(y) { return geoBounds.maxLat - (y / (WORLD_HEIGHT - 1)) * (geoBounds.maxLat - geoBounds.minLat); }

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lon, lat, geometry) {
  for (const polygon of geometryRings(geometry)) {
    if (!polygon?.length || !pointInRing(lon, lat, polygon[0])) continue;
    let inHole = false;
    for (let h = 1; h < polygon.length; h++) if (pointInRing(lon, lat, polygon[h])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

function featureWorldCentroid(feature) {
  let bestRing = null, bestArea = -1;
  for (const polygon of geometryRings(feature.geometry)) {
    const ring = polygon[0];
    if (!ring) continue;
    const bb = ring.reduce((b, [lon, lat]) => ({ minLon: Math.min(b.minLon, lon), maxLon: Math.max(b.maxLon, lon), minLat: Math.min(b.minLat, lat), maxLat: Math.max(b.maxLat, lat) }), { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity });
    const area = (bb.maxLon - bb.minLon) * (bb.maxLat - bb.minLat);
    if (area > bestArea) { bestArea = area; bestRing = ring; }
  }
  if (!bestRing) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const [lon, lat] of bestRing) { sx += lon; sy += lat; }
  const lon = sx / bestRing.length, lat = sy / bestRing.length;
  return { x: lonToWorldX(lon), y: latToWorldY(lat) };
}

async function loadTurkeyMap() {
  try {
    const response = await fetch(GEOJSON_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`GeoJSON HTTP ${response.status}`);
    const data = await response.json();
    const rawFeatures = data.features || [];

    provinceFeatures = rawFeatures.map(feature => {
      const name = getFeatureProvinceName(feature);
      return { ...feature, _name: name, _bbox: featureBBox(feature) };
    }).filter(feature => feature._name);

    if (provinceFeatures.length < 75) throw new Error(`Yalnızca ${provinceFeatures.length} il eşleşti.`);

    geoBounds = computeGeoBounds(provinceFeatures);
    for (const feature of provinceFeatures) {
      feature._region = getRegionNameForProvince(feature._name);
      feature._centroid = featureWorldCentroid(feature);
      feature._capturedBy = null;
      feature._home = Boolean(HOME_PROVINCES[feature._name]);
      provinceByName.set(feature._name, feature);
    }

    rasterizeProvinces();
    seedHomeProvinces();
    mapReady = true;
    loadingEl.classList.add("hidden");
    resetViewToTurkey();
    renderAll();
    if (SUPABASE_ENABLED && activeEvent) {
      if (authUser) await ensureServerBattleMap();
      await syncRemotePixels();
      await loadServerBattleState();
      subscribeRealtimeBattleState();
      await refreshLiveStats();
    }
    scheduleDraw();
  } catch (error) {
    console.error(error);
    loadingEl.innerHTML = `<strong>İl sınırları yüklenemedi.</strong><span>İnternet bağlantısını kontrol edip sayfayı yenile. Harita verisi GitHub üzerindeki açık GeoJSON kaynağından okunuyor.</span>`;
    showToast("81 il GeoJSON verisi yüklenemedi.");
  }
}

function rasterizeProvinces() {
  provinceNamesByIndex.length = 1;
  provinceIndexByName.clear();
  provinceCellTotals.clear();
  totalPlayablePixels = 0;

  provinceFeatures.forEach((feature, featureIndex) => {
    const provinceIndex = featureIndex + 1;
    provinceNamesByIndex[provinceIndex] = feature._name;
    provinceIndexByName.set(feature._name, provinceIndex);

    const b = feature._bbox;
    const minX = Math.max(0, Math.floor(lonToWorldX(b.minLon)) - 1);
    const maxX = Math.min(WORLD_WIDTH - 1, Math.ceil(lonToWorldX(b.maxLon)) + 1);
    const minY = Math.max(0, Math.floor(latToWorldY(b.maxLat)) - 1);
    const maxY = Math.min(WORLD_HEIGHT - 1, Math.ceil(latToWorldY(b.minLat)) + 1);
    let total = 0;

    for (let y = minY; y <= maxY; y++) {
      const lat = worldYToLat(y + .5);
      for (let x = minX; x <= maxX; x++) {
        const lon = worldXToLon(x + .5);
        if (!pointInGeometry(lon, lat, feature.geometry)) continue;
        const i = idx(x, y);
        provinceIndexGrid[i] = provinceIndex;
        colorGrid[i] = ((x * 17 + y * 11) % 43 === 0) ? MATERIAL_LAND_ALT : MATERIAL_LAND;
        total++;
      }
    }

    provinceCellTotals.set(feature._name, total);
    totalPlayablePixels += total;
  });

  rebuildWorldLayer();
  rebuildBorderLayer();
}

function rebuildWorldLayer() {
  worldLayerCtx.fillStyle = OCEAN;
  worldLayerCtx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  // ImageData writes the whole 1440×615 world once. Afterwards placements update only 1 cell.
  const image = worldLayerCtx.createImageData(WORLD_WIDTH, WORLD_HEIGHT);
  const data = image.data;
  const rgbCache = MATERIAL_COLORS.map(hex => {
    if (!hex.startsWith('#')) return [6,20,38];
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  for (let i = 0; i < CELL_COUNT; i++) {
    const [r,g,b] = rgbCache[colorGrid[i]] || rgbCache[0];
    const p = i * 4;
    data[p] = r; data[p+1] = g; data[p+2] = b; data[p+3] = 255;
  }
  worldLayerCtx.putImageData(image, 0, 0);
  miniMapDirty = true;
}

function rebuildOwnershipLayer() {
  const image = ownershipLayerCtx.createImageData(WORLD_WIDTH, WORLD_HEIGHT);
  const data = image.data;
  const teamRgb = teams.map(team => {
    const n = parseInt(team.color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  for (let i = 0; i < CELL_COUNT; i++) {
    const p = i * 4;
    const provinceIndex = provinceIndexGrid[i];
    if (!provinceIndex) { data[p]=6; data[p+1]=20; data[p+2]=38; data[p+3]=255; continue; }
    const ownerIndex = ownerGrid[i];
    if (!ownerIndex) { data[p]=38; data[p+1]=52; data[p+2]=73; data[p+3]=255; continue; }
    const rgb = teamRgb[ownerIndex - 1];
    data[p]=rgb[0]; data[p+1]=rgb[1]; data[p+2]=rgb[2]; data[p+3]=255;
  }
  ownershipLayerCtx.putImageData(image, 0, 0);
}

function rebuildDefenseLayer() {
  defenseLayerCtx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  defenseLayerTeamId = selectedTeam?.id || null;
  if (!selectedTeam) return;
  const selectedIndex = teamIndexById.get(selectedTeam.id);
  const image = defenseLayerCtx.createImageData(WORLD_WIDTH, WORLD_HEIGHT);
  const data = image.data;
  const teamRgb = teams.map(team => {
    const n = parseInt(team.color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  for (let i = 0; i < CELL_COUNT; i++) {
    const ownerIndex = ownerGrid[i];
    if (!ownerIndex || ownerIndex === selectedIndex) continue;
    const rgb = teamRgb[ownerIndex - 1], p = i * 4;
    data[p]=rgb[0]; data[p+1]=rgb[1]; data[p+2]=rgb[2]; data[p+3]=245;
  }
  defenseLayerCtx.putImageData(image, 0, 0);
}

function updateOwnershipCell(x, y) {
  const i = idx(x,y), ownerIndex = ownerGrid[i];
  ownershipLayerCtx.fillStyle = ownerIndex ? teams[ownerIndex - 1].color : LAND;
  ownershipLayerCtx.fillRect(x,y,1,1);
  if (viewMode === "defense") defenseLayerTeamId = null;
}

function materialColorAt(x,y) {
  if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) return OCEAN;
  return MATERIAL_COLORS[colorGrid[idx(x,y)]] || OCEAN;
}

function rebuildBorderLayer() {
  borderLayerCtx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  const borderImage = borderLayerCtx.createImageData(WORLD_WIDTH, WORLD_HEIGHT);
  const d = borderImage.data;
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const pIndex = provinceIndexGrid[idx(x,y)];
      if (!pIndex) continue;
      const right = x + 1 < WORLD_WIDTH ? provinceIndexGrid[idx(x+1,y)] : 0;
      const left = x > 0 ? provinceIndexGrid[idx(x-1,y)] : 0;
      const down = y + 1 < WORLD_HEIGHT ? provinceIndexGrid[idx(x,y+1)] : 0;
      const up = y > 0 ? provinceIndexGrid[idx(x,y-1)] : 0;
      if (right === pIndex && left === pIndex && down === pIndex && up === pIndex) continue;
      const coast = !right || !left || !down || !up;
      const o = idx(x,y) * 4;
      d[o] = 238; d[o+1] = 244; d[o+2] = 255; d[o+3] = coast ? 225 : 132;
    }
  }
  borderLayerCtx.putImageData(borderImage, 0, 0);
}

function seedHomeProvinces() {
  provinceOwnerCounts.clear();
  for (const feature of provinceFeatures) {
    provinceOwnerCounts.set(feature._name, Object.fromEntries(teams.map(t => [t.id, 0])));
  }

  for (let i = 0; i < CELL_COUNT; i++) {
    const provinceName = provinceNamesByIndex[provinceIndexGrid[i]];
    if (!provinceName) continue;
    const teamId = HOME_PROVINCES[provinceName];
    if (!teamId) continue;
    const team = teamById(teamId);
    const teamIndex = teamIndexById.get(teamId);
    let paletteIndex = paletteColors.indexOf(team.color);
    if (paletteIndex < 0) { paletteColors.push(team.color); paletteIndex = paletteColors.length - 1; }
    ownerGrid[i] = teamIndex;
    colorGrid[i] = PALETTE_OFFSET + paletteIndex;
    team.pixels++;
    provinceOwnerCounts.get(provinceName)[teamId]++;
  }

  rebuildWorldLayer();
  rebuildOwnershipLayer();
  for (const [provinceName, teamId] of Object.entries(HOME_PROVINCES)) {
    const feature = provinceByName.get(provinceName);
    if (feature) feature._capturedBy = teamId;
  }
  recalcCapturedCounts();
}

function isLand(x, y) { return Boolean(provinceAt(x, y)); }

function getProvinceStats(name) {
  const counts = provinceOwnerCounts.get(name) || Object.fromEntries(teams.map(t => [t.id, 0]));
  const total = provinceCellTotals.get(name) || 0;
  const claimed = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
  const leaderId = sorted[0]?.[1] ? sorted[0][0] : null;
  const leaderCount = sorted[0]?.[1] || 0;
  return {
    total, claimed, counts, leaderId,
    control: total ? leaderCount / total * 100 : 0,
    claimedPct: total ? claimed / total * 100 : 0
  };
}

function evaluateProvinceCapture(provinceName) {
  const feature = provinceByName.get(provinceName);
  if (!feature) return;
  const stats = getProvinceStats(provinceName);
  const winnerId = stats.control >= 100 ? stats.leaderId : null;
  const oldWinner = feature._capturedBy;

  // Supabase modunda puan/bonusun tek otoritesi V12 PostgreSQL savaş motorudur.
  // Client yalnızca anlık harita görünümünü tahmini olarak günceller.
  if (SUPABASE_ENABLED) {
    feature._capturedBy = winnerId;
    recalcCapturedCounts();
    return;
  }

  if (winnerId && winnerId !== oldWinner) {
    feature._capturedBy = winnerId;
    const team = teamById(winnerId);
    team.points += PROVINCE_BONUS;
    addBattleLog(`${team.name}, ${provinceName} ilini tamamen ele geçirdi.`, PROVINCE_BONUS);
    showToast(`${provinceName} artık tamamen ${team.name} kontrolünde! +${PROVINCE_BONUS.toLocaleString("tr-TR")}`);
  } else if (!winnerId && oldWinner) {
    feature._capturedBy = null;
    feature._home = false;
  }
  recalcCapturedCounts();
  evaluateRegionCaptures();
}

function evaluateRegionCaptures() {
  if (SUPABASE_ENABLED) return;
  for (const region of regions) {
    const captured = region.provinceNames.map(name => provinceByName.get(name)?._capturedBy || null);
    const first = captured[0];
    const winnerId = first && captured.every(id => id === first) ? first : null;
    if (winnerId && region.securedBy !== winnerId) {
      region.securedBy = winnerId;
      const team = teamById(winnerId);
      team.points += REGION_BONUS;
      addBattleLog(`${team.name}, ${region.name} Bölgesi'nin tüm illerini kontrolüne aldı.`, REGION_BONUS);
      showToast(`${region.name} tamamen ${team.name}! +${REGION_BONUS.toLocaleString("tr-TR")} puan`);
    } else if (!winnerId && region.securedBy) {
      region.securedBy = null;
    }
  }
  recalcCapturedCounts();
}

function recalcCapturedCounts() {
  for (const team of teams) { team.capturedProvinces = 0; team.securedRegions = 0; }
  for (const feature of provinceFeatures) if (feature._capturedBy) teamById(feature._capturedBy).capturedProvinces++;
  for (const region of regions) if (region.securedBy) teamById(region.securedBy).securedRegions++;
}

function renderTeams() {
  const list = document.getElementById("teamList");
  list.innerHTML = "";
  for (const team of teams) {
    const card = document.createElement("div");
    card.className = `team-card ${selectedTeam?.id === team.id ? "active" : ""} ${lockedTeamId ? "locked" : ""}`;
    card.style.setProperty("--team-color", team.color);
    card.innerHTML = `<div class="team-top"><div class="team-name">${team.name}</div><span class="home-city">Kale · ${team.city}</span></div><div class="team-stats"><span>${team.points.toLocaleString("tr-TR")} puan</span><span>${team.capturedProvinces} il</span></div>${selectedTeam?.id === team.id && lockedTeamId ? `<div class="team-lock-badge">Sezon sonuna kadar bu takım</div>` : ""}`;
    card.onclick = () => {
      if (lockedTeamId) {
        if (lockedTeamId !== team.id) showToast(`Takımın ${selectedTeam?.name || ""}. Etkinlik bitene kadar değiştirilemez.`);
        return;
      }
      openTeamOnboarding(team.id);
    };
    list.appendChild(card);
  }
  const desc = document.getElementById("teamLockDesc");
  if (desc) desc.textContent = lockedTeamId && selectedTeam
    ? `${selectedTeam.name} takımındasın. Bu üyelik ${EVENT_SLUG} etkinliği bitene kadar kilitli.`
    : "İlk seçiminden sonra takımın etkinlik bitene kadar kilitlenir. Tüm pikseller hesabının takımına yazılır.";
}

function renderOnboardingTeams() {
  const wrap = document.getElementById("onboardingTeams");
  if (!wrap) return;
  wrap.innerHTML = teams.map(team => `<button class="onboarding-team ${onboardingCandidateId===team.id?"active":""}" data-team="${team.id}" style="--team-color:${team.color}"><i></i><strong>${team.name}</strong><small>Başlangıç kalesi · ${team.city}</small></button>`).join("");
  wrap.querySelectorAll(".onboarding-team").forEach(btn => btn.onclick = () => {
    onboardingCandidateId = btn.dataset.team;
    renderOnboardingTeams();
    const team = teamById(onboardingCandidateId);
    const warning = document.getElementById("teamLockWarning");
    warning.classList.remove("confirmed");
    warning.innerHTML = `<b>${team.name}</b> seçildi. Onaylarsan bu hesap etkinlik bitene kadar başka takıma geçemez.`;
    document.getElementById("confirmTeamLockBtn").disabled = false;
  });
}

function openTeamOnboarding(teamId=null) {
  if (lockedTeamId) { showToast("Bu etkinlik için takımın zaten kilitli."); return; }
  onboardingCandidateId = teamId;
  renderOnboardingTeams();
  const warning = document.getElementById("teamLockWarning");
  const btn = document.getElementById("confirmTeamLockBtn");
  if (teamId) {
    const team = teamById(teamId);
    warning.innerHTML = `<b>${team.name}</b> seçildi. Onaylarsan bu hesap etkinlik bitene kadar başka takıma geçemez.`;
    btn.disabled = false;
  } else {
    warning.textContent = "Bir fandom seç ve aşağıdan onayla."; btn.disabled = true;
  }
  document.getElementById("teamLockModal")?.classList.remove("hidden");
}

async function confirmTeamLock() {
  if (!isEventPlayable()) { showToast("Bu etkinlik şu anda takım seçimine açık değil."); return; }
  if (!onboardingCandidateId || lockedTeamId) return;
  const team = teamById(onboardingCandidateId);
  if (!team) return;
  if (SUPABASE_ENABLED) {
    if (!authUser) {
      showToast("Gerçek sezon modunda önce hesabına giriş yapmalısın.");
      document.getElementById("teamLockModal")?.classList.add("hidden");
      openAuthModal();
      return;
    }
    const { data, error } = await supabaseClient.rpc("join_event_team", { p_event_slug: EVENT_SLUG, p_team_id: team.id });
    if (error) {
      showToast(error.message.includes("TEAM_LOCKED") ? "Bu hesap başka bir takıma kilitli." : `Takım seçilemedi: ${error.message}`);
      await hydrateAccountFromSupabase();
      return;
    }
    lockedTeamId = data?.team_id || team.id;
  } else {
    lockedTeamId = team.id;
    localStorage.setItem(TEAM_LOCK_STORAGE_KEY, lockedTeamId);
  }
  selectedTeam = teamById(lockedTeamId);
  defenseLayerTeamId = null;
  document.getElementById("teamLockModal")?.classList.add("hidden");
  renderTeams(); renderProgression(); renderProvinceSpotlight(hoveredProvinceName);
  await loadV16Systems();
  if (viewMode === "defense") rebuildDefenseLayer();
  scheduleDraw();
  showToast(`${selectedTeam.name} takımına katıldın. Takımın sezon sonuna kadar kilitlendi.`);
}

function renderPalette() {
  const palette = document.getElementById("palette"); palette.innerHTML = "";
  paletteColors.forEach((color, index) => {
    const button = document.createElement("button");
    button.className = `color-btn ${index === 0 ? "active" : ""}`; button.style.background = color;
    button.onclick = () => { selectedColor = color; document.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active")); button.classList.add("active"); scheduleDraw(); };
    palette.appendChild(button);
  });
}

function renderRegionBoard() {
  const board = document.getElementById("regionBoard");
  board.innerHTML = regions.map(region => {
    const ownership = {};
    for (const pName of region.provinceNames) {
      const owner = provinceByName.get(pName)?._capturedBy;
      if (owner) ownership[owner] = (ownership[owner] || 0) + 1;
    }
    const sorted = Object.entries(ownership).sort((a,b) => b[1] - a[1]);
    const leaderId = sorted[0]?.[0] || null;
    const leader = teamById(leaderId);
    const owned = sorted[0]?.[1] || 0;
    const secured = region.securedBy ? teamById(region.securedBy) : null;
    const color = secured?.color || leader?.color || "#64748b";
    const pct = region.provinceNames.length ? owned / region.provinceNames.length * 100 : 0;
    return `<div class="region-row ${secured ? "secured" : ""}" data-region="${region.name}">
      <div class="region-row-top"><span class="region-name">${region.name}</span><span class="region-leader"><i class="dot" style="background:${color}"></i>${secured ? `${secured.name} · TAM HAKİMİYET` : (leader ? leader.name : "Tarafsız")}</span></div>
      <div class="region-progress"><div style="width:${secured ? 100 : pct}%;background:${color}"></div></div>
      <div class="region-row-bottom"><span>${owned}/${region.provinceNames.length} il aynı liderde</span><span>${secured ? "+25K kilitli" : `%${pct.toFixed(0)}`}</span></div>
    </div>`;
  }).join("");
}


function pruneRecentAttacks() {
  const cutoff = Date.now() - ATTACK_WINDOW_MS;
  while (recentAttacks.length && recentAttacks[0].ts < cutoff) recentAttacks.shift();
}

function recordAttack(x, y, provinceName, attackerId, defenderId) {
  if (!attackerId || !defenderId || attackerId === defenderId) return;
  recentAttacks.push({ x, y, provinceName, attackerId, defenderId, ts: Date.now() });
  pruneRecentAttacks();
  heatmapDirty = true;
  renderAttackCenter();
  maybeShowAttackAlert(provinceName, defenderId);
}

function attacksForProvince(provinceName, defenderId = null) {
  pruneRecentAttacks();
  return recentAttacks.filter(a => a.provinceName === provinceName && (!defenderId || a.defenderId === defenderId));
}

function maybeShowAttackAlert(provinceName, defenderId) {
  if (!selectedTeam || defenderId !== selectedTeam.id) return;
  const count = attacksForProvince(provinceName, selectedTeam.id).length;
  if (count < 3) return;
  showAttackAlert(`⚠ ${provinceName} saldırı altında · Son 5 dakikada ${count} piksel ${selectedTeam.name} kontrolünden çıktı.`);
}

function showAttackAlert(text) {
  let el = document.getElementById("attackAlert");
  if (!el) {
    el = document.createElement("div"); el.id = "attackAlert"; el.className = "attack-alert";
    document.querySelector(".canvas-wrapper")?.appendChild(el);
  }
  el.textContent = text; el.classList.add("show");
  clearTimeout(showAttackAlert._t); showAttackAlert._t = setTimeout(() => el.classList.remove("show"), 4200);
}

function rebuildHeatmapLayer() {
  pruneRecentAttacks();
  heatmapLayerCtx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  for (const a of recentAttacks) {
    const attacker = teamById(a.attackerId);
    const age = Math.max(0, Math.min(1, 1 - (Date.now() - a.ts) / ATTACK_WINDOW_MS));
    const radius = 10 + age * 14;
    const g = heatmapLayerCtx.createRadialGradient(a.x, a.y, 0, a.x, a.y, radius);
    const color = attacker?.color || "#ff4b6e";
    g.addColorStop(0, color + "c9");
    g.addColorStop(.3, color + "70");
    g.addColorStop(1, color + "00");
    heatmapLayerCtx.fillStyle = g;
    heatmapLayerCtx.fillRect(a.x-radius, a.y-radius, radius*2, radius*2);
  }
  heatmapDirty = false;
}

function renderAttackCenter() {
  pruneRecentAttacks();
  const countEl = document.getElementById("recentAttackCount"), hotEl = document.getElementById("hotProvince"), feed = document.getElementById("attackFeed");
  if (countEl) countEl.textContent = recentAttacks.length.toLocaleString("tr-TR");
  const byProvince = new Map();
  for (const a of recentAttacks) byProvince.set(a.provinceName, (byProvince.get(a.provinceName) || 0) + 1);
  const hot = [...byProvince.entries()].sort((a,b)=>b[1]-a[1])[0];
  if (hotEl) hotEl.textContent = hot ? `${hot[0]} · ${hot[1]}` : "—";
  if (feed) {
    if (!recentAttacks.length) feed.innerHTML = `<div class="log-empty">Bu oturumda henüz bir fandom başka bir fandomun pikselini ele geçirmedi.</div>`;
    else feed.innerHTML = recentAttacks.slice(-8).reverse().map(a => {
      const atk = teamById(a.attackerId), def = teamById(a.defenderId), sec = Math.max(0, Math.floor((Date.now()-a.ts)/1000));
      return `<div class="attack-feed-item"><i style="background:${atk?.color || '#fff'}"></i><span><b>${atk?.name || '—'}</b>, ${a.provinceName} içinde ${def?.name || '—'} pikselini aldı.</span><small>${sec < 60 ? sec+' sn' : Math.floor(sec/60)+' dk'}</small></div>`;
    }).join("");
  }
}

function findNextForeignPixel(provinceName = hoveredProvinceName) {
  if (!selectedTeam) { showToast("Önce savunacağın fandomu seçmelisin."); return; }
  if (!provinceName || !provinceIndexByName.has(provinceName)) { showToast("Önce haritada savunmak istediğin ilin üzerine gel."); return; }
  const pIndex = provinceIndexByName.get(provinceName);
  let start = foreignCursorProvince === provinceName ? foreignCursor + 1 : 0;
  const total = CELL_COUNT;
  for (let pass=0; pass<2; pass++) {
    const end = pass === 0 ? total : start;
    for (let i = pass === 0 ? start : 0; i < end; i++) {
      if (provinceIndexGrid[i] !== pIndex) continue;
      const ownerIndex = ownerGrid[i];
      if (!ownerIndex) continue;
      const ownerTeam = teams[ownerIndex - 1];
      if (!ownerTeam || ownerTeam.id === selectedTeam.id) continue;
      const x = i % WORLD_WIDTH, y = Math.floor(i / WORLD_WIDTH);
      foreignCursor = i; foreignCursorProvince = provinceName;
      selectedPixel = {x,y};
      centerCameraOnPixel(x,y,Math.max(camera.zoom,14));
      renderPixelInspector(x,y); scheduleDraw();
      showToast(`${provinceName}: ${ownerTeam.name} tarafından tutulan yabancı piksele gidildi.`);
      return;
    }
  }
  showToast(`${provinceName} içinde ${selectedTeam.name} dışındaki sahipli bir piksel bulunamadı.`);
}

function centerCameraOnPixel(x,y,targetZoom=14) {
  const r = canvas.getBoundingClientRect();
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
  camera.x = x + .5 - r.width / camera.zoom / 2;
  camera.y = y + .5 - r.height / camera.zoom / 2;
  clampCamera(); scheduleDraw();
}

function getBattleStatus(stats) {
  if (!stats) return { label:"VERİ YOK", cls:"neutral" };
  if (stats.controlled_by) return { label:"TAM HAKİM", cls:"dominant" };
  if (!stats.claimed_cells) return { label:"TARAFSIZ", cls:"neutral" };
  const counts = Object.values(stats.team_counts || {}).map(Number).sort((a,b)=>b-a);
  const margin = stats.total_cells ? ((counts[0]||0)-(counts[1]||0))/stats.total_cells*100 : 0;
  if (margin <= 2.5 && stats.claimed_pct >= 10) return { label:"KRİTİK", cls:"critical" };
  if (margin <= 8 && stats.claimed_pct >= 10) return { label:"ÇEKİŞMELİ", cls:"contested" };
  if (stats.control_pct >= 75) return { label:"GÜÇLÜ HAKİMİYET", cls:"strong" };
  return { label:"MÜCADELE", cls:"contested" };
}

function renderProvinceSpotlight(name) {
  const target = document.getElementById("provinceSpotlight");
  if (!name || !provinceByName.has(name)) { target.innerHTML = `<div class="province-empty">Haritada bir ilin üzerine gel.</div>`; return; }
  const feature = provinceByName.get(name);
  const local = getProvinceStats(name);
  const server = serverProvinceStats.get(name);
  const stats = server || { total_cells:local.total, claimed_cells:local.claimed, team_counts:local.counts, leader_team_id:local.leaderId, control_pct:local.control, claimed_pct:local.claimedPct, controlled_by:feature._capturedBy };
  const leader = teamById(stats.leader_team_id), captured = teamById(stats.controlled_by || feature._capturedBy);
  const color = captured?.color || leader?.color || "#64748b";
  const battle = getBattleStatus(stats);
  const distribution = teams.map(t=>({team:t,count:Number(stats.team_counts?.[t.id]||0)})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
  target.innerHTML = `<div class="province-head"><div><h3>${name}</h3><span>${feature._region}</span></div><span class="battle-state ${battle.cls}">${battle.label}</span></div>
    <div class="province-owner"><i class="dot" style="background:${color}"></i>${captured ? `${captured.name} tam kontrol` : leader ? `${leader.name} önde` : "Henüz tarafsız"}</div>
    <div class="province-grid"><div class="province-metric"><small>LİDER HAKİMİYETİ</small><strong>%${Number(stats.control_pct||0).toFixed(1)}</strong></div><div class="province-metric"><small>DOLULUK</small><strong>%${Number(stats.claimed_pct||0).toFixed(1)}</strong></div></div>
    <div class="province-progress"><div style="width:${Number(stats.control_pct||0)}%;background:${color}"></div></div>
    <div class="fandom-distribution">${distribution.length ? distribution.map(({team,count})=>{const pct=stats.total_cells?count/stats.total_cells*100:0;return `<div class="dist-row"><span><i style="background:${team.color}"></i>${team.name}</span><div><b style="width:${Math.max(.5,pct)}%;background:${team.color}"></b></div><strong>${count.toLocaleString("tr-TR")} · %${pct.toFixed(1)}</strong></div>`}).join("") : `<div class="distribution-empty">Henüz sahipli piksel yok.</div>`}</div>
    ${selectedTeam ? (() => { const own = Number(stats.team_counts?.[selectedTeam.id] || 0); const foreign = Math.max(0, Number(stats.claimed_cells||0) - own); const attacks = attacksForProvince(name, selectedTeam.id).length; return `<div class="defense-summary"><span>${selectedTeam.name} savunma taraması</span><strong>${foreign.toLocaleString("tr-TR")} yabancı piksel</strong></div>${foreign ? `<div class="foreign-alert">Bu ilde ${selectedTeam.name} dışındaki fandomlara ait ${foreign.toLocaleString("tr-TR")} piksel var. Son 5 dk savunma kaybı: ${attacks}.</div><div class="province-defense-actions"><button onclick="findNextForeignPixel('${name.replace("'","\'")}')">YABANCI PİKSELE GİT</button><button onclick="setDefenseView()">SAVUNMA GÖRÜNÜMÜ</button></div>` : `<div class="foreign-clean">Bu ilde başka bir fandoma ait yerleştirilmiş piksel görünmüyor.</div>`}`; })() : `<div class="defense-summary"><span>Savunma taraması</span><strong>Fandom seç</strong></div>`}`;
}

function renderLeaderboard() {
  const sorted = [...teams].sort((a,b) => b.points - a.points || b.capturedProvinces - a.capturedProvinces || b.pixels - a.pixels);
  document.getElementById("leaderboard").innerHTML = sorted.map((team, index) => `<div class="leader-row v13"><span>${index + 1}</span><div class="leader-team"><span class="leader-dot" style="background:${team.color}"></span><span class="leader-team-text">${team.name}</span></div><span class="leader-score"><strong>${team.points.toLocaleString("tr-TR")}</strong><small>${team.pixels.toLocaleString("tr-TR")} px · +${Number(team.provinceBonus||0).toLocaleString("tr-TR")} il · +${Number(team.regionBonus||0).toLocaleString("tr-TR")} bölge</small></span></div>`).join("");
}

function updateGlobalStats() {
  const live = serverLiveStats;
  const onlineEl = document.getElementById("onlineCount");
  const todayEl = document.getElementById("pixelCount");
  const seasonEl = document.getElementById("seasonPixelCount");
  const playersEl = document.getElementById("seasonPlayerCount");
  if (onlineEl) onlineEl.textContent = live ? Number(live.active_players || 0).toLocaleString("tr-TR") : "—";
  if (todayEl) todayEl.textContent = live ? Number(live.today_placements || 0).toLocaleString("tr-TR") : todayPixels.toLocaleString("tr-TR");
  if (seasonEl) seasonEl.textContent = live ? Number(live.season_placements || 0).toLocaleString("tr-TR") : "—";
  if (playersEl) playersEl.textContent = live ? Number(live.joined_players || 0).toLocaleString("tr-TR") : "—";
  document.getElementById("provinceCount").textContent = `${live ? Number(live.controlled_provinces || 0) : provinceFeatures.filter(f => f._capturedBy).length} / 81`;
  document.getElementById("securedCount").textContent = `${live ? Number(live.controlled_regions || 0) : regions.filter(r => r.securedBy).length} / 7`;
  const playableEl = document.getElementById("playableCount");
  if (playableEl) playableEl.textContent = totalPlayablePixels.toLocaleString("tr-TR");
}

function addBattleLog(text, bonus) {
  const log = document.getElementById("battleLog"); if (log.querySelector(".log-empty")) log.innerHTML = "";
  const item = document.createElement("div"); item.className = "log-item"; item.innerHTML = `${text} <b>+${bonus.toLocaleString("tr-TR")}</b>`; log.prepend(item);
}
let toastTimer;
function showToast(text) { const t = document.getElementById("toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2700); }

function resizeCanvas() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(r.width * dpr); canvas.height = Math.floor(r.height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.imageSmoothingEnabled = false;
  clampCamera();
  scheduleDraw();
}
window.addEventListener("resize", resizeCanvas);

function refreshMiniBase() {
  if (!miniMapDirty) return;
  miniBaseCtx.fillStyle = OCEAN;
  miniBaseCtx.fillRect(0,0,miniBase.width,miniBase.height);
  miniBaseCtx.imageSmoothingEnabled = false;
  miniBaseCtx.drawImage(worldLayer, 0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0, 0, miniBase.width, miniBase.height);
  miniMapDirty = false;
}

function draw() {
  const frameStart = performance.now();
  const r = canvas.getBoundingClientRect(), ps = camera.zoom;
  ctx.clearRect(0,0,r.width,r.height);
  ctx.fillStyle = OCEAN; ctx.fillRect(0,0,r.width,r.height);
  if (!mapReady) return;

  const sourceX = Math.max(0, camera.x);
  const sourceY = Math.max(0, camera.y);
  const sourceW = Math.min(WORLD_WIDTH - sourceX, r.width / ps);
  const sourceH = Math.min(WORLD_HEIGHT - sourceY, r.height / ps);
  const destX = sourceX > camera.x ? (sourceX - camera.x) * ps : 0;
  const destY = sourceY > camera.y ? (sourceY - camera.y) * ps : 0;

  // Cached render layers keep all three map views fast at 1440×615.
  if (sourceW > 0 && sourceH > 0) {
    ctx.imageSmoothingEnabled = false;
    if (viewMode === "ownership") {
      ctx.drawImage(ownershipLayer, sourceX, sourceY, sourceW, sourceH, destX, destY, sourceW * ps, sourceH * ps);
    } else if (viewMode === "defense") {
      if (defenseLayerTeamId !== selectedTeam?.id) rebuildDefenseLayer();
      ctx.globalAlpha = .34;
      ctx.drawImage(worldLayer, sourceX, sourceY, sourceW, sourceH, destX, destY, sourceW * ps, sourceH * ps);
      ctx.globalAlpha = 1;
      ctx.drawImage(defenseLayer, sourceX, sourceY, sourceW, sourceH, destX, destY, sourceW * ps, sourceH * ps);
    } else {
      ctx.drawImage(worldLayer, sourceX, sourceY, sourceW, sourceH, destX, destY, sourceW * ps, sourceH * ps);
    }
    ctx.drawImage(borderLayer, sourceX, sourceY, sourceW, sourceH, destX, destY, sourceW * ps, sourceH * ps);
    if (heatmapEnabled) {
      if (heatmapDirty) rebuildHeatmapLayer();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = .86;
      ctx.drawImage(heatmapLayer, sourceX, sourceY, sourceW, sourceH, destX, destY, sourceW * ps, sourceH * ps);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    }
  }

  if (ps >= 8) {
    ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
    for (let x = -(camera.x % 1) * ps; x < r.width; x += ps) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,r.height); ctx.stroke(); }
    for (let y = -(camera.y % 1) * ps; y < r.height; y += ps) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(r.width,y); ctx.stroke(); }
  }

  drawProvinceLabels();
  if (selectedPixel) {
    const x = (selectedPixel.x - camera.x) * ps, y = (selectedPixel.y - camera.y) * ps;
    ctx.globalAlpha = .68; ctx.fillStyle = selectedColor; ctx.fillRect(x,y,ps,ps); ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(x,y,ps,ps);
  }
  drawMiniMap();
  lastFrameMs = performance.now() - frameStart;
}

function drawProvinceLabels() {
  if (camera.zoom < 3.8) return;
  ctx.save(); ctx.font = `${camera.zoom > 8 ? 700 : 600} ${camera.zoom > 8 ? 9 : 7}px Inter,Arial`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const feature of provinceFeatures) {
    const c = feature._centroid, sx = (c.x - camera.x) * camera.zoom, sy = (c.y - camera.y) * camera.zoom;
    if (sx < -70 || sy < -30 || sx > canvas.clientWidth + 70 || sy > canvas.clientHeight + 30) continue;
    const captured = teamById(feature._capturedBy);
    ctx.fillStyle = "rgba(4,8,16,.76)";
    const label = feature._name, w = Math.max(26, ctx.measureText(label).width + 6);
    ctx.fillRect(sx - w / 2, sy - 6, w, 12);
    ctx.fillStyle = captured ? "#fff" : "#dce5f4"; ctx.fillText(label, sx, sy);
    if (captured && camera.zoom > 6) { ctx.fillStyle = captured.color; ctx.fillRect(sx - 2, sy + 8, 4, 4); }
  }
  ctx.restore();
}

function drawMiniMap() {
  refreshMiniBase();
  const w = miniMap.width, h = miniMap.height, px = w / WORLD_WIDTH, py = h / WORLD_HEIGHT;
  miniCtx.clearRect(0,0,w,h);
  if (viewMode === "ownership") {
    miniCtx.imageSmoothingEnabled = false;
    miniCtx.drawImage(ownershipLayer,0,0,WORLD_WIDTH,WORLD_HEIGHT,0,0,w,h);
  } else miniCtx.drawImage(miniBase,0,0);
  const r = canvas.getBoundingClientRect(); miniCtx.strokeStyle = "#fff"; miniCtx.lineWidth = 1.4;
  miniCtx.strokeRect(camera.x * px, camera.y * py, (r.width / camera.zoom) * px, (r.height / camera.zoom) * py);
}

function getWorldCoordinates(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: Math.floor(camera.x + (clientX - r.left) / camera.zoom), y: Math.floor(camera.y + (clientY - r.top) / camera.zoom) };
}
function clampCamera() {
  const r = canvas.getBoundingClientRect(), vw = r.width / camera.zoom, vh = r.height / camera.zoom;
  camera.x = Math.max(-25, Math.min(WORLD_WIDTH - vw + 25, camera.x));
  camera.y = Math.max(-25, Math.min(WORLD_HEIGHT - vh + 25, camera.y));
}
function setZoom(value, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2) {
  const wx = camera.x + cx / camera.zoom, wy = camera.y + cy / camera.zoom;
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  camera.x = wx - cx / camera.zoom; camera.y = wy - cy / camera.zoom; clampCamera(); scheduleDraw();
}
function resetViewToTurkey() {
  const r = canvas.getBoundingClientRect();
  const zoomX = r.width / (WORLD_WIDTH + 16), zoomY = r.height / (WORLD_HEIGHT + 20);
  camera.zoom = Math.max(MIN_ZOOM, Math.min(4.2, Math.min(zoomX, zoomY)));
  camera.x = (WORLD_WIDTH - r.width / camera.zoom) / 2;
  camera.y = (WORLD_HEIGHT - r.height / camera.zoom) / 2;
  clampCamera(); scheduleDraw();
}

canvas.addEventListener("mousemove", event => {
  const c = getWorldCoordinates(event.clientX, event.clientY);
  document.getElementById("coordX").textContent = c.x; document.getElementById("coordY").textContent = c.y;
  const provinceName = provinceAt(c.x, c.y);
  if (provinceName !== hoveredProvinceName) {
    hoveredProvinceName = provinceName;
    document.getElementById("hoverRegion").textContent = provinceName ? `${provinceName} · ${getRegionNameForProvince(provinceName)}` : "Türkiye dışı";
    renderProvinceSpotlight(provinceName);
  }
  if (isDragging) {
    const dx = event.clientX - dragStartX, dy = event.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mouseMovedWhileDragging = true;
    camera.x = cameraStartX - dx / camera.zoom; camera.y = cameraStartY - dy / camera.zoom; clampCamera(); scheduleDraw();
  }
});
canvas.addEventListener("mousedown", event => {
  if (event.button !== 0 || !mapReady) return;
  isDragging = true; mouseMovedWhileDragging = false; dragStartX = event.clientX; dragStartY = event.clientY; cameraStartX = camera.x; cameraStartY = camera.y; canvas.classList.add("dragging");
});
window.addEventListener("mouseup", event => {
  if (!isDragging) return; isDragging = false; canvas.classList.remove("dragging");
  if (!mouseMovedWhileDragging) {
    const c = getWorldCoordinates(event.clientX, event.clientY);
    selectedPixel = isLand(c.x,c.y) ? c : null;
    if (selectedPixel) renderPixelInspector(selectedPixel.x, selectedPixel.y); else hidePixelInspector();
    scheduleDraw();
  }
});
canvas.addEventListener("wheel", event => {
  event.preventDefault(); if (!mapReady) return;
  const r = canvas.getBoundingClientRect(); setZoom(camera.zoom * (event.deltaY < 0 ? 1.18 : .84), event.clientX - r.left, event.clientY - r.top);
}, { passive: false });

document.getElementById("zoomInBtn").onclick = () => setZoom(camera.zoom * 1.25);
document.getElementById("zoomOutBtn").onclick = () => setZoom(camera.zoom * .8);
document.getElementById("resetViewBtn").onclick = resetViewToTurkey;

const modal = document.getElementById("confirmModal"), preview = document.getElementById("confirmPreview"), confirmText = document.getElementById("confirmText"), confirmMeta = document.getElementById("confirmMeta"), placeBtn = document.getElementById("placePixelBtn");
placeBtn.onclick = () => {
  if (!mapReady) return;
  if (!isEventPlayable()) { showToast(effectiveEventState() === "finished" ? "Sezon sona erdi; harita artık salt okunur." : "Etkinlik henüz başlamadı."); return; }
  if (Date.now() < cooldownEnd) return;
  if (!selectedTeam) { showToast("Önce bir fandom seçmelisin."); return; }
  if (!selectedPixel) { showToast("Türkiye haritasından bir piksel seçmelisin."); return; }
  const provinceName = provinceAt(selectedPixel.x, selectedPixel.y), feature = provinceByName.get(provinceName);
  confirmText.textContent = `${selectedTeam.name} adına ${provinceName} içinde (${selectedPixel.x}, ${selectedPixel.y}) koordinatına piksel bırakacaksın.`;
  confirmMeta.textContent = `İl: ${provinceName} · Bölge: ${feature._region} · İl bonusu: ${PROVINCE_BONUS.toLocaleString("tr-TR")} · Bölge bonusu: ${REGION_BONUS.toLocaleString("tr-TR")}`;
  preview.style.setProperty("--preview-color", selectedColor); modal.classList.remove("hidden");
};
document.getElementById("cancelPlaceBtn").onclick = () => modal.classList.add("hidden");
document.getElementById("confirmPlaceBtn").onclick = async () => {
  if (!selectedPixel || !selectedTeam || !mapReady) return;
  if (!isEventPlayable()) { modal.classList.add("hidden"); updateSeasonUI(); showToast("Etkinlik piksel yerleştirmeye kapalı."); return; }
  const { x, y } = selectedPixel, provinceName = provinceAt(x, y);

  if (SUPABASE_ENABLED) {
    if (!authUser) { modal.classList.add("hidden"); openAuthModal(); showToast("Piksel bırakmak için giriş yapmalısın."); return; }
    const { data, error } = await supabaseClient.rpc("place_pixel", {
      p_event_slug: EVENT_SLUG, p_x: x, p_y: y, p_color: selectedColor, p_province_name: provinceName
    });
    if (error) {
      if (error.message.includes("COOLDOWN")) showToast("Cooldown henüz bitmedi.");
      else if (error.message.includes("TEAM_REQUIRED")) openTeamOnboarding();
      else if (error.message.includes("USER_BANNED")) showToast("Hesabın moderasyon nedeniyle geçici olarak piksel yerleştiremiyor.");
      else if (error.message.includes("PROTECTED_ZONE_TEAM")) showToast("Bu korumalı alana yalnızca izin verilen fandom piksel koyabilir.");
      else if (error.message.includes("PROTECTED_ZONE")) showToast("Bu alan moderasyon tarafından korumaya alınmış.");
      else showToast(`Piksel yerleştirilemedi: ${error.message}`);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      applySyncedPixel(row, true);
      cooldownEnd = row.cooldown_until ? new Date(row.cooldown_until).getTime() : Date.now() + COOLDOWN_MS;
      localStorage.setItem(COOLDOWN_STORAGE_KEY, String(cooldownEnd));
      scheduleBattleStateReload();
      await loadServerProfileOverview();
      await loadMyFandomRole();
    }
  } else {
    applyLocalPlacement(x, y, selectedTeam.id, selectedColor, true);
    cooldownEnd = Date.now() + COOLDOWN_MS;
    localStorage.setItem(COOLDOWN_STORAGE_KEY, String(cooldownEnd));
  }

  selectedPixel = null;
  modal.classList.add("hidden"); hidePixelInspector(); renderProgression();
  renderAll(); updateCooldown(); scheduleDraw();
};

function applyLocalPlacement(x, y, teamId, color, countProgress=false) {
  const provinceName = provinceAt(x, y);
  if (!provinceName || !teamId) return;
  const team = teamById(teamId);
  if (!team) return;
  const oldOwner = ownerAt(x, y);
  const isDefenseRecapture = Boolean(oldOwner && oldOwner !== teamId);
  if (countProgress && isDefenseRecapture) recordAttack(x, y, provinceName, teamId, oldOwner);
  const cellIndex = idx(x, y);
  let paletteIndex = paletteColors.indexOf(String(color).toLowerCase());
  if (paletteIndex < 0) paletteIndex = paletteColors.findIndex(c => c.toLowerCase() === String(color).toLowerCase());
  if (paletteIndex < 0) paletteIndex = 0;
  ownerGrid[cellIndex] = teamIndexById.get(teamId);
  setWorldPixelMaterial(x, y, PALETTE_OFFSET + paletteIndex);
  updateOwnershipCell(x, y);
  if (oldOwner !== teamId) {
    const counts = provinceOwnerCounts.get(provinceName);
    if (oldOwner) {
      const oldTeam = teamById(oldOwner);
      oldTeam.pixels = Math.max(0, oldTeam.pixels - 1);
      if (counts) counts[oldOwner] = Math.max(0, (counts[oldOwner] || 0) - 1);
    }
    team.pixels++;
    if (countProgress && !SUPABASE_ENABLED) team.points += 10;
    if (counts) counts[teamId] = (counts[teamId] || 0) + 1;
  }
  if (countProgress) {
    todayPixels++;
    if (SUPABASE_ENABLED) {
      // V14: XP, görev ve kişisel savaş istatistiklerinin otoritesi PostgreSQL'dir.
    } else {
      player.totalPlaced = (player.totalPlaced || 0) + 1;
      awardXp(isDefenseRecapture ? 18 : 10, isDefenseRecapture ? "Savunma hamlesi" : "Piksel yerleştirme");
      registerDailyActivity("placed", 1);
    if (isDefenseRecapture) registerDailyActivity("defense", 1);
    if (provinceName && !dailyVisitedProvinces.has(provinceName)) {
      dailyVisitedProvinces.add(provinceName); dailyState.provinces = dailyVisitedProvinces.size;
      saveDailyState(); checkDailyRewards();
    }
      savePlayerProfile();
    }
  }
  evaluateProvinceCapture(provinceName);
}

function updateCooldown() {
  const el = document.getElementById("cooldown"), left = Math.max(0, cooldownEnd - Date.now());
  if (left <= 0 && cooldownEnd) { cooldownEnd = 0; localStorage.removeItem(COOLDOWN_STORAGE_KEY); }
  if (left <= 0) { el.textContent = "HAZIR"; placeBtn.disabled = false; }
  else { el.textContent = `00:00:${String(Math.ceil(left / 1000)).padStart(2,"0")}`; placeBtn.disabled = true; }
}
setInterval(updateCooldown, 250);

function hidePixelInspector() { document.getElementById("pixelInspector")?.classList.add("hidden"); }
function renderPixelInspector(x,y) {
  const panel = document.getElementById("pixelInspector"), body = document.getElementById("pixelInspectorBody");
  if (!panel || !body || !isLand(x,y)) return hidePixelInspector();
  const province = provinceAt(x,y), ownerId = ownerAt(x,y), owner = teamById(ownerId), color = materialColorAt(x,y);
  const relation = selectedTeam ? (!owner ? "Tarafsız" : owner.id === selectedTeam.id ? "Senin fandomun" : "Yabancı fandom") : "Fandom seçilmedi";
  body.innerHTML = `<div class="inspector-grid">
    <div class="inspector-cell"><small>KOORDİNAT</small><strong>${x}, ${y}</strong></div>
    <div class="inspector-cell"><small>İL</small><strong>${province}</strong></div>
    <div class="inspector-cell"><small>GÖRSEL RENK</small><strong><i class="pixel-color-swatch" style="background:${color}"></i>${color}</strong></div>
    <div class="inspector-cell"><small>HAKİMİYET SAHİBİ</small><strong>${owner ? `<i class="pixel-color-swatch" style="background:${owner.color}"></i>${owner.name}` : "Tarafsız"}</strong></div>
  </div><div class="${selectedTeam && owner && owner.id !== selectedTeam.id ? "foreign-alert" : "foreign-clean"}">${relation}${selectedTeam && owner && owner.id !== selectedTeam.id ? ` · Bu pikseli ${selectedTeam.name} adına yeniden boyayarak geri alabilirsin.` : ""}</div>`;
  panel.classList.remove("hidden");
}
document.getElementById("closeInspectorBtn")?.addEventListener("click", hidePixelInspector);


function setDefenseView() {
  if (!selectedTeam) { showToast("Savunma görünümü için önce fandom seç."); return; }
  viewMode = "defense";
  document.querySelectorAll(".view-btn").forEach(x => x.classList.toggle("active", x.dataset.view === "defense"));
  rebuildDefenseLayer(); miniMapDirty = true; scheduleDraw();
}

document.getElementById("nextForeignBtn")?.addEventListener("click", () => findNextForeignPixel(hoveredProvinceName));
document.getElementById("heatmapToggleBtn")?.addEventListener("click", (event) => {
  heatmapEnabled = !heatmapEnabled;
  event.currentTarget.classList.toggle("active", heatmapEnabled);
  event.currentTarget.textContent = `ISI HARİTASI: ${heatmapEnabled ? "AÇIK" : "KAPALI"}`;
  heatmapDirty = true; scheduleDraw();
  showToast(heatmapEnabled ? "Son 5 dakikadaki saldırı yoğunluğu haritada gösteriliyor." : "Saldırı ısı haritası kapatıldı.");
});

document.querySelectorAll(".view-btn").forEach(btn => btn.addEventListener("click", () => {
  const next = btn.dataset.view;
  if (next === "defense" && !selectedTeam) { showToast("Savunma görünümü için önce bir fandom seçmelisin."); return; }
  viewMode = next;
  document.querySelectorAll(".view-btn").forEach(x => x.classList.toggle("active", x === btn));
  if (viewMode === "defense") rebuildDefenseLayer();
  miniMapDirty = true;
  scheduleDraw();
  showToast(viewMode === "artwork" ? "Artwork görünümü: gerçek çizim renkleri." : viewMode === "ownership" ? "Hakimiyet görünümü: her piksel sahibi fandomun renginde." : `${selectedTeam.name} savunması: yabancı pikseller vurgulanıyor.`);
}));

document.querySelectorAll(".nav-link").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach(x => x.classList.remove("active")); btn.classList.add("active");
  const target = btn.dataset.target;
  if (target === "regions") document.querySelector(".region-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
  else if (target === "ranking") document.getElementById("leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  else if (target === "teamcenter") openTeamCenter();
  else if (target === "seasons") openSeasonArchive();
  else if (target === "history") openHistoryModal();
  else if (target === "guide") openGuide();
  else if (target !== "map") showToast(`${btn.textContent.trim()} bölümü hazırlanıyor.`);
}));


function renderProgression() {
  if (SUPABASE_ENABLED && serverProfileOverview) {
    player.name = serverProfileOverview.username || player.name;
    player.xp = Number(serverProfileOverview.xp || 0);
    player.totalPlaced = Number(serverProfileOverview.total_placed || 0);
    player.streak = Number(serverProfileOverview.current_streak || 0);
    dailyState = {
      ...dailyState,
      date: todayKey(),
      placed: Number(serverProfileOverview.today_placed || 0),
      defense: Number(serverProfileOverview.today_enemy_taken || 0),
      provinces: Number(serverProfileOverview.today_provinces || 0),
      claimedRewards: serverProfileOverview.claimed_missions || []
    };
  }
  const level = levelFromXp(player.xp);
  const floor = levelFloorXp(level), next = nextLevelXp(level);
  const within = player.xp - floor, span = Math.max(1, next - floor);
  const pct = Math.max(0, Math.min(100, Math.round(within / span * 100)));
  const initial = (player.name || "F").trim().charAt(0).toUpperCase() || "F";
  const teamLabel = selectedTeam ? `${selectedTeam.name} · ${selectedTeam.city}` : "Fandom seçilmedi";
  for (const id of ["profileName","progressionName"]) { const el=document.getElementById(id); if(el) el.textContent=player.name; }
  for (const id of ["profileAvatar","progressionAvatar"]) { const el=document.getElementById(id); if(el) el.textContent=initial; }
  const top=document.getElementById("profileLevelText"); if(top) top.textContent=`Seviye ${level} · ${player.xp.toLocaleString("tr-TR")} XP`;
  const pt=document.getElementById("progressionTeam"); if(pt) pt.textContent=teamLabel;
  const pill=document.getElementById("levelPill"); if(pill) pill.textContent=`LV ${level}`;
  const label=document.getElementById("xpLabel"); if(label) label.textContent=`${within.toLocaleString("tr-TR")} / ${span.toLocaleString("tr-TR")} XP`;
  const per=document.getElementById("xpPercent"); if(per) per.textContent=`${pct}%`;
  const fill=document.getElementById("xpFill"); if(fill) fill.style.width=`${pct}%`;
  const streak=document.getElementById("streakBadge"); if(streak) streak.textContent=`${player.streak || 0} GÜN SERİ`;
  const rankBox=document.getElementById("playerBattleStats");
  if(rankBox){
    if(SUPABASE_ENABLED && serverProfileOverview){
      rankBox.innerHTML=`<div><small>FANDOM SIRASI</small><strong>#${serverProfileOverview.team_rank || "—"}<em> / ${serverProfileOverview.team_members || 0}</em></strong></div><div><small>SEZON PİKSELİ</small><strong>${Number(serverProfileOverview.event_placed||0).toLocaleString("tr-TR")}</strong></div><div><small>GERİ ALINAN</small><strong>${Number(serverProfileOverview.enemy_pixels_taken||0).toLocaleString("tr-TR")}</strong></div><div><small>CEPHE</small><strong>${Number(serverProfileOverview.unique_provinces||0)} il</strong></div>`;
    } else { rankBox.innerHTML=`<div><small>MOD</small><strong>DEMO</strong></div><div><small>TOPLAM</small><strong>${Number(player.totalPlaced||0).toLocaleString("tr-TR")}</strong></div>`; }
  }
  const missions=document.getElementById("dailyMissions");
  if (missions) missions.innerHTML = DAILY_MISSIONS.map(m => {
    const val=Math.min(m.target,dailyState[m.id]||0), done=dailyState.claimedRewards.includes(m.id), mp=Math.round(val/m.target*100);
    return `<div class="mission-row ${done?"complete":""}"><div class="mission-main"><strong>${done?"✓ ":""}${m.label}</strong><small>${m.desc} · ${val}/${m.target}</small></div><div class="mission-reward">+${m.reward} XP</div><div class="mission-track"><div style="width:${mp}%"></div></div></div>`;
  }).join("");
}
function openProfileModal() {
  const modal=document.getElementById("profileModal");
  document.getElementById("profileNameInput").value=player.name;
  document.getElementById("modalLevel").textContent=levelFromXp(player.xp);
  document.getElementById("modalXp").textContent=player.xp.toLocaleString("tr-TR");
  document.getElementById("modalPlaced").textContent=(player.totalPlaced||0).toLocaleString("tr-TR");
  document.getElementById("modalStreak").textContent=`${player.streak||0} gün`;
  const mr=document.getElementById("modalTeamRank"); if(mr) mr.textContent=serverProfileOverview ? `#${serverProfileOverview.team_rank || "—"} / ${serverProfileOverview.team_members || 0}` : "—";
  const me=document.getElementById("modalEnemyTaken"); if(me) me.textContent=Number(serverProfileOverview?.enemy_pixels_taken||0).toLocaleString("tr-TR");
  const logout=document.getElementById("logoutBtn"); if(logout) logout.classList.toggle("hidden", !(SUPABASE_ENABLED && authUser));
  modal.classList.remove("hidden");
}
document.getElementById("profileOpenBtn")?.addEventListener("click", openProfileModal);
document.getElementById("closeProfileBtn")?.addEventListener("click",()=>document.getElementById("profileModal").classList.add("hidden"));
document.getElementById("saveProfileBtn")?.addEventListener("click",async()=>{
  const value=document.getElementById("profileNameInput").value.trim().replace(/\s+/g," ").slice(0,18) || "guest";
  if (SUPABASE_ENABLED && authUser) {
    const { error } = await supabaseClient.from("profiles").update({ username:value }).eq("id",authUser.id);
    if (error) { showToast(`Profil kaydedilemedi: ${error.message}`); return; }
  }
  player.name=value; savePlayerProfile();
  if (SUPABASE_ENABLED) await loadServerProfileOverview();
  renderProgression(); document.getElementById("profileModal").classList.add("hidden"); showToast("Profil kaydedildi.");
});
document.getElementById("profileModal")?.addEventListener("click",e=>{ if(e.target.id==="profileModal") e.currentTarget.classList.add("hidden"); });

function renderAll() { renderTeams(); renderRegionBoard(); renderLeaderboard(); renderProvinceSpotlight(hoveredProvinceName); renderAttackCenter(); updateGlobalStats(); renderProgression(); }


// V10 — season lifecycle / archive / result screen
function effectiveEventState(event = activeEvent) {
  if (!event) return SUPABASE_ENABLED ? "loading" : "active";
  const now = Date.now();
  const starts = event.starts_at ? new Date(event.starts_at).getTime() : -Infinity;
  const ends = event.ends_at ? new Date(event.ends_at).getTime() : Infinity;
  if (event.status === "finished" || now >= ends) return "finished";
  if (event.status === "draft" || now < starts) return "waiting";
  return "active";
}
function isEventPlayable() {
  return effectiveEventState() === "active";
}
function formatSeasonRemaining(ms) {
  if (ms <= 0) return "00g 00s 00d";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  return `${String(days).padStart(2,"0")}g ${String(hours).padStart(2,"0")}s ${String(mins).padStart(2,"0")}d`;
}
function formatEventDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }).format(new Date(value));
}
function setEventEndedOverlay(show) {
  const wrapper = document.querySelector(".canvas-wrapper");
  if (!wrapper) return;
  let overlay = document.getElementById("eventEndedOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "eventEndedOverlay";
    overlay.className = "event-ended-overlay hidden";
    overlay.innerHTML = `<div>SEZON TAMAMLANDI · HARİTA İNCELEME MODU</div>`;
    wrapper.appendChild(overlay);
  }
  overlay.classList.toggle("hidden", !show);
}
function ownershipStandings() {
  const counts = Object.fromEntries(teams.map(t => [t.id, 0]));
  for (let i = 0; i < ownerGrid.length; i++) {
    const ownerIndex = ownerGrid[i];
    if (!ownerIndex) continue;
    const id = teamIdByIndex[ownerIndex];
    if (id) counts[id]++;
  }
  return teams.map(team => ({ team, pixels: counts[team.id] || 0 }))
    .sort((a,b) => b.pixels - a.pixels || b.team.capturedProvinces - a.team.capturedProvinces);
}
function showSeasonResult(force = false) {
  if (!force && seasonResultShown) return;
  if (effectiveEventState() !== "finished") return;
  seasonResultShown = true;
  const standings = ownershipStandings();
  const winner = standings[0];
  const title = document.getElementById("seasonResultTitle");
  const text = document.getElementById("seasonResultText");
  const podium = document.getElementById("seasonResultPodium");
  if (winner && title) title.textContent = `${winner.team.name} SEZON ŞAMPİYONU`;
  if (text) text.textContent = activeEvent?.name ? `${activeEvent.name} sona erdi. Harita artık salt okunur durumda; sonuçlar mevcut hakimiyet piksellerine göre gösteriliyor.` : "Etkinlik sona erdi. Harita artık salt okunur durumda.";
  if (podium) podium.innerHTML = standings.slice(0,3).map((entry, i) => `<div class="podium-item"><i style="background:${entry.team.color}"></i><strong>${i+1}. ${entry.team.name}</strong><span>${entry.pixels.toLocaleString("tr-TR")} hakimiyet pikseli · ${entry.team.capturedProvinces} il</span></div>`).join("");
  document.getElementById("seasonResultModal")?.classList.remove("hidden");
  loadSeasonAwards();
}
function updateSeasonUI() {
  const state = effectiveEventState();
  const badge = document.getElementById("seasonStatusBadge");
  const countdown = document.getElementById("seasonCountdown");
  const range = document.getElementById("seasonDateRange");
  const eventName = document.getElementById("seasonEventName");
  const chip = document.getElementById("seasonChip");
  const place = document.getElementById("placePixelBtn");
  if (eventName && activeEvent?.name) eventName.textContent = activeEvent.name;
  const welcomeName = document.getElementById("welcomeSeasonName");
  const welcomeState = document.getElementById("welcomeSeasonState");
  if (welcomeName) welcomeName.textContent = activeEvent?.name || "FANVERSE Türkiye";
  if (welcomeState) welcomeState.textContent = state === "active" ? "CANLI" : state === "waiting" ? "YAKINDA" : state === "finished" ? "TAMAMLANDI" : "YÜKLENİYOR";
  if (chip) chip.textContent = `${EVENT_SLUG.toUpperCase().replace("-", " ")} · V17`;
  if (range && activeEvent) range.textContent = `${formatEventDate(activeEvent.starts_at)} → ${formatEventDate(activeEvent.ends_at)}`;
  if (badge) {
    badge.classList.remove("waiting","finished");
    badge.textContent = state === "active" ? "CANLI" : state === "waiting" ? "YAKINDA" : state === "finished" ? "BİTTİ" : "YÜKLENİYOR";
    if (state === "waiting") badge.classList.add("waiting");
    if (state === "finished") badge.classList.add("finished");
  }
  if (countdown) {
    if (!activeEvent) countdown.textContent = SUPABASE_ENABLED ? "—" : "DEMO";
    else if (state === "waiting") countdown.textContent = `Başlangıç ${formatSeasonRemaining(new Date(activeEvent.starts_at).getTime() - Date.now())}`;
    else if (state === "active") countdown.textContent = formatSeasonRemaining(new Date(activeEvent.ends_at).getTime() - Date.now());
    else countdown.textContent = "TAMAMLANDI";
  }
  if (place) {
    const locked = state !== "active";
    place.disabled = locked;
    place.classList.toggle("event-locked", locked);
    if (state === "waiting") place.textContent = "ETKİNLİK HENÜZ BAŞLAMADI";
    else if (state === "finished") place.textContent = "SEZON TAMAMLANDI";
    else place.textContent = "PİKSEL YERLEŞTİR";
  }
  setEventEndedOverlay(state === "finished");
  if (state === "finished") showSeasonResult();
}
async function openSeasonArchive() {
  const modal = document.getElementById("seasonModal");
  const list = document.getElementById("seasonList");
  if (!modal || !list) return;
  modal.classList.remove("hidden");
  if (!SUPABASE_ENABLED || !supabaseClient) {
    list.innerHTML = `<div class="season-list-item current"><div><strong>${EVENT_SLUG}</strong><small>Demo modunda yalnızca aktif prototip sezonu gösteriliyor.</small></div><span class="season-list-state active">DEMO</span></div>`;
    return;
  }
  list.innerHTML = `<div class="season-list-empty">Sezonlar yükleniyor…</div>`;
  const { data, error } = await supabaseClient.from("events").select("id,slug,name,starts_at,ends_at,status").order("starts_at", { ascending:false });
  if (error) { list.innerHTML = `<div class="season-list-empty">Sezon arşivi yüklenemedi: ${error.message}</div>`; return; }
  list.innerHTML = (data || []).map(ev => {
    const state = effectiveEventState(ev);
    const label = state === "active" ? "CANLI" : state === "waiting" ? "YAKINDA" : "TAMAMLANDI";
    return `<div class="season-list-item ${ev.slug === EVENT_SLUG ? "current" : ""}"><div><strong>${ev.name}</strong><small>${formatEventDate(ev.starts_at)} → ${formatEventDate(ev.ends_at)} · ${ev.slug}</small></div><span class="season-list-state ${state}">${label}</span></div>`;
  }).join("") || `<div class="season-list-empty">Henüz sezon bulunmuyor.</div>`;
}


// V12 — server-side battle engine -------------------------------------------------
function buildProvinceRuns() {
  const runs = [];
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    let x = 0;
    while (x < WORLD_WIDTH) {
      const pIndex = provinceIndexGrid[idx(x, y)];
      if (!pIndex) { x++; continue; }
      const startX = x;
      x++;
      while (x < WORLD_WIDTH && provinceIndexGrid[idx(x, y)] === pIndex) x++;
      runs.push({ y, x1: startX, x2: x - 1, province_name: provinceNamesByIndex[pIndex] });
    }
  }
  return runs;
}

function buildProvinceTotalsPayload() {
  return [...provinceCellTotals.entries()].map(([province_name, total_cells]) => ({
    province_name,
    total_cells,
    region_name: getRegionNameForProvince(province_name),
    home_team_id: HOME_PROVINCES[province_name] || null
  }));
}

async function ensureServerBattleMap() {
  if (!SUPABASE_ENABLED || !authUser || !mapReady || battleMapSyncAttempted) return;
  battleMapSyncAttempted = true;
  const { data: status, error } = await supabaseClient.rpc("battle_map_status");
  if (error) {
    console.warn("V13 battle map status unavailable", error);
    battleMapReady = false;
    return;
  }
  const row = Array.isArray(status) ? status[0] : status;
  battleMapReady = Boolean(row?.ready);
  if (!battleMapReady) {
    showToast("Savaş motoru hazır değil. Bir admin, Admin Center > Savaş Motoru bölümünden haritayı hazırlamalı.");
  }
}

async function loadServerBattleState() {
  if (!SUPABASE_ENABLED || !activeEvent || !supabaseClient) return;
  const [scoresRes, provinceRes, regionRes, logRes, overviewRes] = await Promise.all([
    supabaseClient.from("event_team_scores").select("team_id,owned_pixels,province_bonus,region_bonus,total_score").eq("event_id", activeEvent.id),
    supabaseClient.from("province_control").select("province_name,team_id").eq("event_id", activeEvent.id),
    supabaseClient.from("region_control").select("region_name,team_id").eq("event_id", activeEvent.id),
    supabaseClient.from("battle_events").select("event_type,scope_name,team_id,previous_team_id,bonus_points,created_at").eq("event_id", activeEvent.id).order("created_at", { ascending:false }).limit(20),
    supabaseClient.rpc("battle_province_overview", { p_event_slug: EVENT_SLUG })
  ]);

  if (!scoresRes.error) {
    for (const team of teams) {
      const row = (scoresRes.data || []).find(r => r.team_id === team.id);
      team.pixels = Number(row?.owned_pixels || 0);
      team.provinceBonus = Number(row?.province_bonus || 0);
      team.regionBonus = Number(row?.region_bonus || 0);
      team.points = Number(row?.total_score || 0);
    }
  }
  if (!provinceRes.error) {
    for (const feature of provinceFeatures) feature._capturedBy = null;
    for (const row of provinceRes.data || []) {
      const f = provinceByName.get(row.province_name);
      if (f) f._capturedBy = row.team_id || null;
    }
  }
  if (!regionRes.error) {
    for (const region of regions) region.securedBy = null;
    for (const row of regionRes.data || []) {
      const r = regions.find(x => x.name === row.region_name);
      if (r) r.securedBy = row.team_id || null;
    }
  }
  recalcCapturedCounts();
  if (!overviewRes.error) {
    serverProvinceStats.clear();
    for (const row of overviewRes.data || []) serverProvinceStats.set(row.province_name, row);
  }

  if (!logRes.error) {
    const log = document.getElementById("battleLog");
    if (log) {
      const rows = logRes.data || [];
      log.innerHTML = rows.length ? rows.map(row => {
        const team = teamById(row.team_id);
        const prev = teamById(row.previous_team_id);
        const label = row.event_type === "PROVINCE_CAPTURE" ? `${team?.name || "—"}, ${row.scope_name} ilini ele geçirdi.`
          : row.event_type === "PROVINCE_BROKEN" ? `${row.scope_name} üzerindeki ${prev?.name || "—"} tam hakimiyeti kırıldı.`
          : row.event_type === "REGION_CAPTURE" ? `${team?.name || "—"}, ${row.scope_name} Bölgesi'ni tamamen aldı.`
          : row.event_type === "REGION_BROKEN" ? `${row.scope_name} Bölgesi'ndeki ${prev?.name || "—"} hakimiyeti kırıldı.`
          : `${row.scope_name} savaş durumu değişti.`;
        return `<div class="log-item">${label}${Number(row.bonus_points || 0) ? ` <b>+${Number(row.bonus_points).toLocaleString("tr-TR")}</b>` : ""}<small>${new Date(row.created_at).toLocaleTimeString("tr-TR", {hour:"2-digit",minute:"2-digit"})}</small></div>`;
      }).join("") : `<div class="log-empty">Sunucu savaş geçmişi henüz boş.</div>`;
    }
  }
  renderLeaderboard(); renderRegionBoard(); updateGlobalStats(); renderProvinceSpotlight(hoveredProvinceName);
}

function scheduleBattleStateReload() {
  clearTimeout(battleStateReloadTimer);
  battleStateReloadTimer = setTimeout(() => loadServerBattleState(), 180);
}

function subscribeRealtimeBattleState() {
  if (!SUPABASE_ENABLED || !activeEvent || realtimeBattleChannel) return;
  realtimeBattleChannel = supabaseClient.channel(`fanverse-battle-${activeEvent.id}`)
    .on("postgres_changes", { event:"*", schema:"public", table:"event_team_scores", filter:`event_id=eq.${activeEvent.id}` }, scheduleBattleStateReload)
    .on("postgres_changes", { event:"*", schema:"public", table:"province_control", filter:`event_id=eq.${activeEvent.id}` }, scheduleBattleStateReload)
    .on("postgres_changes", { event:"*", schema:"public", table:"region_control", filter:`event_id=eq.${activeEvent.id}` }, scheduleBattleStateReload)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"battle_events", filter:`event_id=eq.${activeEvent.id}` }, scheduleBattleStateReload)
    .subscribe();
}

// V9 — optional Supabase auth + realtime pixel delta sync
function setAuthStatus(text, kind="") {
  const el = document.getElementById("authStatus"); if (!el) return; el.textContent = text; el.className = `auth-status ${kind}`;
}
function updateAuthChip() {
  const btn = document.getElementById("authBtn"); if (!btn) return;
  if (!SUPABASE_ENABLED) { btn.textContent = "DEMO MODU"; btn.classList.remove("online"); return; }
  if (authUser) { btn.textContent = "HESAP BAĞLI"; btn.classList.add("online"); }
  else { btn.textContent = "GİRİŞ YAP"; btn.classList.remove("online"); }
}
function openAuthModal() {
  const modalEl = document.getElementById("authModal"); if (!modalEl) return;
  document.getElementById("authModeText").textContent = SUPABASE_ENABLED
    ? "Hesabına giriş yaptığında fandom seçimin ve piksellerin etkinlik üyeliğine bağlanır."
    : "Supabase henüz yapılandırılmadı. supabase-config.js dosyasına proje URL ve publishable key girildiğinde gerçek hesap modu açılır.";
  setAuthStatus(SUPABASE_ENABLED ? "" : "Şu anda local demo modu aktif.");
  modalEl.classList.remove("hidden");
}
async function loadServerProfileOverview() {
  if (!SUPABASE_ENABLED || !authUser || !supabaseClient) return;
  const { data, error } = await supabaseClient.rpc("profile_progress_overview", { p_event_slug: EVENT_SLUG });
  if (error) { console.warn("V14 profile overview unavailable", error); return; }
  serverProfileOverview = Array.isArray(data) ? data[0] : data;
  if (serverProfileOverview) {
    player.name = serverProfileOverview.username || player.name;
    player.xp = Number(serverProfileOverview.xp || 0);
    player.totalPlaced = Number(serverProfileOverview.total_placed || 0);
    player.streak = Number(serverProfileOverview.current_streak || 0);
    savePlayerProfile();
  }
  renderProgression();
}

async function hydrateAccountFromSupabase() {
  if (!SUPABASE_ENABLED || !authUser) return;
  const { data: eventData } = await supabaseClient.from("events").select("id,slug,name,starts_at,ends_at,status").eq("slug", EVENT_SLUG).maybeSingle();
  activeEvent = eventData || null;
  updateSeasonUI();
  if (!activeEvent) { showToast(`Supabase'te ${EVENT_SLUG} etkinliği bulunamadı.`); return; }
  const { data: membership } = await supabaseClient.from("event_memberships").select("team_id,last_pixel_at").eq("event_id", activeEvent.id).eq("user_id", authUser.id).maybeSingle();
  if (membership?.team_id) {
    lockedTeamId = membership.team_id; localStorage.removeItem(TEAM_LOCK_STORAGE_KEY);
    selectedTeam = teamById(lockedTeamId);
    if (membership.last_pixel_at) {
      const serverCooldown = new Date(membership.last_pixel_at).getTime() + COOLDOWN_MS;
      if (serverCooldown > Date.now()) cooldownEnd = serverCooldown;
    }
  } else {
    lockedTeamId = null; selectedTeam = null;
    setTimeout(() => openTeamOnboarding(), 200);
  }
  const { data: profile } = await supabaseClient.from("profiles").select("username,xp,total_placed").eq("id", authUser.id).maybeSingle();
  if (profile) {
    player.name = profile.username || player.name;
    player.xp = Number(profile.xp || 0);
    player.totalPlaced = Number(profile.total_placed || 0);
    savePlayerProfile();
  }
  await loadServerProfileOverview();
  await loadV16Systems();
  renderAll(); updateCooldown(); updateAuthChip(); updateSeasonUI(); await updateAdminPanelVisibility();
  if (mapReady) { await ensureServerBattleMap(); await syncRemotePixels(); await loadServerBattleState(); subscribeRealtimeBattleState(); await refreshLiveStats(); } else remoteSyncPending = true;
}
async function syncRemotePixels() {
  if (!SUPABASE_ENABLED || !activeEvent || !mapReady || !supabaseClient) return;
  let from = 0; const pageSize = 1000;
  while (true) {
    const { data, error } = await supabaseClient.from("pixels").select("x,y,color,team_id,province_name,updated_at").eq("event_id", activeEvent.id).range(from, from + pageSize - 1);
    if (error) { console.error(error); showToast("Ortak piksel haritası yüklenemedi."); break; }
    for (const row of data || []) applySyncedPixel(row, false);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  remotePixelsLoaded = true; remoteSyncPending = false;
  subscribeRealtimePixels(); renderAll(); scheduleDraw();
}
function applySyncedPixel(row, ownPlacement=false) {
  const x = Number(row.x), y = Number(row.y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !isLand(x,y) || !teamById(row.team_id)) return;
  applyLocalPlacement(x, y, row.team_id, row.color, ownPlacement);
}
function subscribeRealtimePixels() {
  if (!SUPABASE_ENABLED || !activeEvent || realtimePixelChannel) return;
  realtimePixelChannel = supabaseClient.channel(`fanverse-pixels-${activeEvent.id}`)
    .on("postgres_changes", { event:"*", schema:"public", table:"pixels", filter:`event_id=eq.${activeEvent.id}` }, payload => {
      if (payload.eventType === "DELETE") {
        const oldRow = payload.old || {};
        const x = Number(oldRow.x), y = Number(oldRow.y);
        if (Number.isInteger(x) && Number.isInteger(y)) restoreBaseCell(x, y);
      } else {
        const row = payload.new; if (row) applySyncedPixel(row, false);
      }
      renderAll(); scheduleDraw(); scheduleBattleStateReload();
    }).subscribe();
}
async function updateAdminPanelVisibility() {
  const btn = document.getElementById("adminPanelBtn");
  if (!btn) return;
  btn.classList.add("hidden");
  if (!SUPABASE_ENABLED || !authUser || !supabaseClient) return;
  const { data, error } = await supabaseClient.rpc("is_admin");
  if (!error && data === true) btn.classList.remove("hidden");
}

function restoreBaseCell(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !isLand(x, y)) return;
  const i = idx(x, y);
  const provinceName = provinceAt(x, y);
  const currentOwnerId = ownerAt(x, y);
  if (currentOwnerId) {
    const counts = provinceOwnerCounts.get(provinceName);
    if (counts) counts[currentOwnerId] = Math.max(0, (counts[currentOwnerId] || 0) - 1);
    const currentTeam = teamById(currentOwnerId);
    if (currentTeam) currentTeam.pixels = Math.max(0, currentTeam.pixels - 1);
  }
  const homeTeamId = HOME_PROVINCES[provinceName] || null;
  if (homeTeamId) {
    const team = teamById(homeTeamId);
    const ownerIndex = teamIndexById.get(homeTeamId);
    let paletteIndex = paletteColors.indexOf(team.color);
    ownerGrid[i] = ownerIndex;
    colorGrid[i] = PALETTE_OFFSET + paletteIndex;
    const counts = provinceOwnerCounts.get(provinceName);
    if (counts) counts[homeTeamId] = (counts[homeTeamId] || 0) + 1;
    team.pixels++;
  } else {
    ownerGrid[i] = 0;
    colorGrid[i] = (x * 17 + y * 11) % 43 === 0 ? MATERIAL_LAND_ALT : MATERIAL_LAND;
  }
  worldLayerCtx.fillStyle = MATERIAL_COLORS[colorGrid[i]];
  worldLayerCtx.fillRect(x, y, 1, 1);
  updateOwnershipCell(x, y);
  miniMapDirty = true;
  heatmapDirty = true;
  evaluateProvinceCapture(provinceName);
}


function renderWelcomeFandoms() {
  const wrap = document.getElementById("welcomeFandoms");
  if (!wrap) return;
  wrap.innerHTML = teams.map(team => `<span class="welcome-fandom"><i style="background:${team.color}"></i>${team.name}</span>`).join("");
}

function showWelcome(force=false) {
  const screen = document.getElementById("welcomeScreen");
  if (!screen || authUser || (!force && welcomeDismissed)) return;
  renderWelcomeFandoms();
  updateSeasonUI();
  screen.classList.remove("hidden");
}
function hideWelcome() {
  welcomeDismissed = true;
  document.getElementById("welcomeScreen")?.classList.add("hidden");
}
function openGuide() { document.getElementById("guideModal")?.classList.remove("hidden"); }
function closeGuide() { document.getElementById("guideModal")?.classList.add("hidden"); }

async function refreshLiveStats() {
  if (!SUPABASE_ENABLED || !supabaseClient) { serverLiveStats = null; updateGlobalStats(); return; }
  const { data, error } = await supabaseClient.rpc("fanverse_live_stats", { p_event_slug: EVENT_SLUG });
  if (error) { console.warn("V15 live stats unavailable", error); return; }
  serverLiveStats = Array.isArray(data) ? data[0] : data;
  updateGlobalStats();
}
async function heartbeatPresence() {
  if (!SUPABASE_ENABLED || !supabaseClient || !authUser) return;
  const { error } = await supabaseClient.rpc("fanverse_presence_heartbeat", { p_event_slug: EVENT_SLUG });
  if (error) console.warn("V15 presence heartbeat unavailable", error);
  await refreshLiveStats();
}
function startLiveStatTimers() {
  clearInterval(liveStatsTimer); clearInterval(presenceTimer);
  liveStatsTimer = setInterval(refreshLiveStats, 15000);
  if (authUser) presenceTimer = setInterval(heartbeatPresence, 45000);
}
async function signOutFanverse() {
  if (!SUPABASE_ENABLED || !supabaseClient) return;
  const btn = document.getElementById("logoutBtn");
  if (btn) { btn.disabled = true; btn.textContent = "ÇIKIŞ YAPILIYOR…"; }
  try { await supabaseClient.rpc("fanverse_presence_leave", { p_event_slug: EVENT_SLUG }); } catch (_) {}
  const { error } = await supabaseClient.auth.signOut();
  if (btn) { btn.disabled = false; btn.textContent = "ÇIKIŞ YAP"; }
  if (error) { showToast(`Çıkış yapılamadı: ${error.message}`); return; }
  document.getElementById("profileModal")?.classList.add("hidden");
  welcomeDismissed = false;
  showWelcome(true);
}

async function initAccountLayer() {
  updateAuthChip();
  renderWelcomeFandoms();
  if (!SUPABASE_ENABLED) {
    if (lockedTeamId) selectedTeam = teamById(lockedTeamId);
    else setTimeout(() => openTeamOnboarding(), 650);
    renderAll();
    showWelcome(true);
    return;
  }
  supabaseClient = window.supabase.createClient(FANVERSE_CONFIG.url, FANVERSE_CONFIG.publishableKey);

  // Etkinlik bilgisi izleyici modunda da gereklidir.
  const { data: eventData } = await supabaseClient.from("events").select("id,slug,name,starts_at,ends_at,status").eq("slug", EVENT_SLUG).maybeSingle();
  activeEvent = eventData || null;
  updateSeasonUI();
  await refreshLiveStats();

  const { data } = await supabaseClient.auth.getSession();
  authUser = data.session?.user || null;
  updateAuthChip();
  if (authUser) {
    leavePublicSpectatorMode();
    welcomeDismissed = true;
    document.getElementById("welcomeScreen")?.classList.add("hidden");
    await hydrateAccountFromSupabase();
    await heartbeatPresence();
  } else {
    enterPublicSpectatorMode();
    showWelcome(true);
    if (mapReady && activeEvent) {
      await syncRemotePixels();
      await loadServerBattleState();
      subscribeRealtimeBattleState();
      await refreshLiveStats();
    }
  }
  startLiveStatTimers();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    authUser = session?.user || null;
    updateAuthChip();
    if (authUser) {
      leavePublicSpectatorMode();
      welcomeDismissed = true;
      document.getElementById("welcomeScreen")?.classList.add("hidden");
      await hydrateAccountFromSupabase();
      await heartbeatPresence();
    } else {
      enterPublicSpectatorMode();
      lockedTeamId = null; selectedTeam = null; serverProfileOverview = null;
      v16Role = null; v16TeamCenter = null; v16Artworks = []; v16Notifications = [];
      if (v16NotificationChannel) { try { await supabaseClient.removeChannel(v16NotificationChannel); } catch (_) {} v16NotificationChannel = null; }
      renderV16Mini(); updateNotificationBadge();
      document.getElementById("adminPanelBtn")?.classList.add("hidden");
      clearInterval(presenceTimer);
      renderAll();
      welcomeDismissed = false;
      showWelcome(true);
    }
    startLiveStatTimers();
  });
}
document.getElementById("authBtn")?.addEventListener("click", openAuthModal);
document.getElementById("closeAuthBtn")?.addEventListener("click", () => document.getElementById("authModal")?.classList.add("hidden"));
document.getElementById("closeTeamLockBtn")?.addEventListener("click", () => document.getElementById("teamLockModal")?.classList.add("hidden"));
document.getElementById("confirmTeamLockBtn")?.addEventListener("click", confirmTeamLock);
document.getElementById("signInBtn")?.addEventListener("click", async () => {
  if (!SUPABASE_ENABLED) { setAuthStatus("Supabase yapılandırılmadı.", "error"); return; }
  const email=document.getElementById("authEmail").value.trim(), password=document.getElementById("authPassword").value;
  setAuthStatus("Giriş yapılıyor…");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) setAuthStatus(error.message,"error"); else { setAuthStatus("Giriş başarılı.","ok"); document.getElementById("authModal").classList.add("hidden"); }
});
document.getElementById("signUpBtn")?.addEventListener("click", async () => {
  if (!SUPABASE_ENABLED) { setAuthStatus("Supabase yapılandırılmadı.", "error"); return; }
  const email=document.getElementById("authEmail").value.trim(), password=document.getElementById("authPassword").value;
  setAuthStatus("Hesap oluşturuluyor…");
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) setAuthStatus(error.message,"error");
  else if (!data.session) setAuthStatus("Hesap oluşturuldu. E-posta doğrulaması açıksa gelen kutunu kontrol et.","ok");
  else { setAuthStatus("Hesap oluşturuldu ve giriş yapıldı.","ok"); document.getElementById("authModal").classList.add("hidden"); }
});



// =========================================================
// V16 · FANDOM SYSTEMS
// Artwork protection, roles, coordination and notifications
// =========================================================
let v16Role = null;
let v16TeamCenter = null;
let v16Artworks = [];
let v16ArtworkCells = new Map();
let v16ArtworkCursor = new Map();
let v16Notifications = [];
let v16NotificationChannel = null;

function roleLabelFallback(roleId) {
  return ({commander:"KOMUTAN",strategist:"STRATEJİST",artist:"SANATÇI",defender:"SAVUNMACI",raider:"AKINCI",supporter:"DESTEKÇİ",rookie:"ÇAYLAK"})[roleId] || "ÇAYLAK";
}

async function loadMyFandomRole() {
  if (!SUPABASE_ENABLED || !supabaseClient || !authUser || !selectedTeam) { v16Role = null; renderV16Mini(); return; }
  const { data, error } = await supabaseClient.rpc("fanverse_my_role", { p_event_slug: EVENT_SLUG });
  if (error) { console.warn("V16 role unavailable", error); return; }
  v16Role = Array.isArray(data) ? data[0] : data;
  renderV16Mini();
}

function renderV16Mini() {
  const role = v16Role?.role_label || (authUser && selectedTeam ? "ÇAYLAK" : "GİRİŞ GEREKLİ");
  const rb = document.getElementById("teamRoleBadge"); if (rb) rb.textContent = role;
  const mr = document.getElementById("modalRole"); if (mr) mr.textContent = role;
  const mini = document.getElementById("teamTargetMini");
  if (!mini) return;
  if (!authUser || !selectedTeam) { mini.innerHTML = `<div class="log-empty">Takım hedefi ve artwork savunması için giriş yap.</div>`; return; }
  const target = v16TeamCenter?.target;
  if (target?.province_name) mini.innerHTML = `<div class="team-target-line"><strong>🎯 ${target.province_name}</strong><small>${target.message || "Aktif takım hedefi"}</small></div>`;
  else mini.innerHTML = `<div class="team-target-line"><strong>🎯 Hedef yok</strong><small>${selectedTeam.name} stratejistleri henüz hedef belirlemedi.</small></div>`;
}

async function loadTeamCenterData() {
  if (!SUPABASE_ENABLED || !supabaseClient || !authUser || !selectedTeam) { v16TeamCenter = null; renderV16Mini(); return; }
  const { data, error } = await supabaseClient.rpc("team_center_overview", { p_event_slug: EVENT_SLUG });
  if (error) { console.warn("V16 team center unavailable", error); return; }
  v16TeamCenter = data || null;
  if (v16TeamCenter) {
    v16Role = {
      role_id: v16TeamCenter.role_id,
      role_label: v16TeamCenter.role_label || roleLabelFallback(v16TeamCenter.role_id),
      can_coordinate: Boolean(v16TeamCenter.can_coordinate),
      artwork_repairs: v16Role?.artwork_repairs || 0
    };
  }
  renderV16Mini();
}

function populateTargetProvinceSelect() {
  const select = document.getElementById("targetProvinceSelect"); if (!select) return;
  select.innerHTML = allProvinceNames.slice().sort((a,b)=>a.localeCompare(b,"tr")).map(n=>`<option value="${n}">${n}</option>`).join("");
  if (v16TeamCenter?.target?.province_name) select.value = v16TeamCenter.target.province_name;
  else if (hoveredProvinceName && allProvinceNames.includes(hoveredProvinceName)) select.value = hoveredProvinceName;
}

function provinceThreatColor(pct) {
  if (pct >= 90) return "#4ce3a4";
  if (pct >= 60) return "#ffcf42";
  return "#ff4b6e";
}

function goToProvince(name) {
  const f = provinceByName.get(name); if (!f?._centroid) { showToast("İl koordinatı bulunamadı."); return; }
  selectedPixel = { x: Math.round(f._centroid.x), y: Math.round(f._centroid.y) };
  centerCameraOnPixel(f._centroid.x, f._centroid.y, Math.max(camera.zoom, 7));
  hoveredProvinceName = name;
  renderProvinceSpotlight(name); scheduleDraw();
}

function renderTeamCenterModal() {
  const modal = document.getElementById("teamCenterModal"); if (!modal) return;
  const roleLabel = v16Role?.role_label || v16TeamCenter?.role_label || "ÇAYLAK";
  const canCoordinate = Boolean(v16Role?.can_coordinate ?? v16TeamCenter?.can_coordinate);
  const title = document.getElementById("teamCenterTitle"); if (title) title.textContent = `${selectedTeam?.name || "Fandom"} Savaş Merkezi`;
  const role = document.getElementById("teamCenterRole"); if (role) role.textContent = roleLabel;
  const target = v16TeamCenter?.target;
  const targetEl = document.getElementById("teamCenterTarget"); if (targetEl) targetEl.textContent = target?.province_name || "Henüz hedef yok";
  const goBtn = document.getElementById("goTeamTargetBtn"); if (goBtn) goBtn.disabled = !target?.province_name;
  const perm = document.getElementById("coordinationPermission"); if (perm) perm.textContent = canCoordinate ? "HEDEF YÖNETEBİLİR" : "OKUMA";
  document.getElementById("coordinateEditor")?.classList.toggle("hidden", !canCoordinate);
  document.getElementById("artworkCreateBox")?.classList.toggle("hidden", !canCoordinate);
  populateTargetProvinceSelect();
  const msg = document.getElementById("targetMessageInput"); if (msg) msg.value = target?.message || "";

  const threats = document.getElementById("teamThreats");
  const rows = Array.isArray(v16TeamCenter?.threats) ? v16TeamCenter.threats : [];
  if (threats) threats.innerHTML = rows.length ? rows.map(t => {
    const pct = Number(t.own_pct || 0); const foreign = Number(t.foreign_pixels || 0);
    return `<div class="threat-row" data-province="${t.province_name}"><div><strong>${t.province_name}</strong><span>${foreign.toLocaleString("tr-TR")} yabancı piksel</span></div><strong>%${pct.toFixed(1)}</strong><div class="threat-bar"><i style="width:${Math.max(2,Math.min(100,pct))}%;background:${provinceThreatColor(pct)}"></i></div></div>`;
  }).join("") : `<div class="log-empty">Takımının aktif olduğu bir cephe henüz görünmüyor.</div>`;
  threats?.querySelectorAll(".threat-row").forEach(el => el.addEventListener("click", () => { closeTeamCenter(); goToProvince(el.dataset.province); }));
  renderArtworkTemplates();
}

async function loadTeamArtworks() {
  v16Artworks = []; v16ArtworkCells = new Map();
  if (!SUPABASE_ENABLED || !supabaseClient || !authUser || !activeEvent || !selectedTeam) return;
  const { data, error } = await supabaseClient.from("artwork_templates")
    .select("id,name,province_name,x1,y1,x2,y2,status,created_at")
    .eq("event_id",activeEvent.id).eq("team_id",selectedTeam.id).eq("status","active").order("created_at",{ascending:false}).limit(12);
  if (error) { console.warn("V16 artwork templates unavailable", error); return; }
  v16Artworks = data || [];
  const ids = v16Artworks.map(x=>x.id);
  if (ids.length) {
    const { data: cells, error: cellsError } = await supabaseClient.from("artwork_template_cells").select("template_id,x,y,expected_color").in("template_id",ids);
    if (!cellsError) for (const c of cells || []) { if (!v16ArtworkCells.has(c.template_id)) v16ArtworkCells.set(c.template_id,[]); v16ArtworkCells.get(c.template_id).push(c); }
  }
  renderArtworkTemplates();
}

function artworkHealth(template) {
  const cells = v16ArtworkCells.get(template.id) || [];
  let good = 0, broken = 0, foreign = 0;
  for (const c of cells) {
    const colorOk = String(materialColorAt(Number(c.x),Number(c.y))).toLowerCase() === String(c.expected_color).toLowerCase();
    const ownerOk = ownerAt(Number(c.x),Number(c.y)) === selectedTeam?.id;
    if (colorOk && ownerOk) good++; else broken++;
    if (!ownerOk) foreign++;
  }
  return { total:cells.length, good, broken, foreign, integrity:cells.length ? good/cells.length*100 : 0 };
}

function renderArtworkTemplates() {
  const wrap = document.getElementById("artworkTemplates"); if (!wrap) return;
  const badge = document.getElementById("artworkCountBadge"); if (badge) badge.textContent = `${v16Artworks.length} ŞABLON`;
  if (!v16Artworks.length) { wrap.innerHTML = `<div class="log-empty">Takımın için aktif artwork şablonu yok. Stratejist veya Komutan mevcut artwork alanını kaydedebilir.</div>`; return; }
  wrap.innerHTML = v16Artworks.map(t => {
    const h = artworkHealth(t);
    return `<div class="artwork-card"><div class="artwork-card-head"><div><h4>${escapeHtml(t.name)}</h4><small>${t.province_name} · ${h.total.toLocaleString("tr-TR")} piksel</small></div><strong>%${h.integrity.toFixed(1)}</strong></div><div class="artwork-health"><div><span>BÜTÜNLÜK</span><strong>%${h.integrity.toFixed(1)}</strong></div><div><span>BOZUK</span><strong>${h.broken.toLocaleString("tr-TR")}</strong></div><div><span>YABANCI</span><strong>${h.foreign.toLocaleString("tr-TR")}</strong></div></div><div class="artwork-actions"><button data-repair="${t.id}">BOZUK PİKSELE GİT</button><button data-center="${t.id}">ALANI GÖSTER</button></div></div>`;
  }).join("");
  wrap.querySelectorAll("[data-repair]").forEach(btn => btn.addEventListener("click",()=>focusNextArtworkDamage(btn.dataset.repair)));
  wrap.querySelectorAll("[data-center]").forEach(btn => btn.addEventListener("click",()=>{
    const t=v16Artworks.find(x=>x.id===btn.dataset.center); if(!t)return; closeTeamCenter(); centerCameraOnPixel((t.x1+t.x2)/2,(t.y1+t.y2)/2,Math.max(camera.zoom,12));
  }));
}

function escapeHtml(value="") { return String(value).replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]); }

function focusNextArtworkDamage(templateId) {
  const t = v16Artworks.find(x=>x.id===templateId); const cells = v16ArtworkCells.get(templateId)||[];
  if (!t || !cells.length) return;
  let start = v16ArtworkCursor.get(templateId) || 0;
  for (let pass=0; pass<2; pass++) {
    for (let j=pass?0:start; j<(pass?start:cells.length); j++) {
      const c=cells[j], x=Number(c.x), y=Number(c.y);
      const damaged = String(materialColorAt(x,y)).toLowerCase()!==String(c.expected_color).toLowerCase() || ownerAt(x,y)!==selectedTeam.id;
      if (!damaged) continue;
      v16ArtworkCursor.set(templateId,j+1); selectedPixel={x,y}; selectedColor=String(c.expected_color).toLowerCase();
      const paletteMatch = paletteColors.findIndex(v=>String(v).toLowerCase()===selectedColor);
      document.querySelectorAll(".color-btn").forEach((b,k)=>b.classList.toggle("active",k===paletteMatch));
      closeTeamCenter(); centerCameraOnPixel(x,y,Math.max(camera.zoom,18)); renderPixelInspector(x,y); scheduleDraw();
      showToast(`${t.name}: onarılacak piksele gidildi · hedef renk ${selectedColor}`); return;
    }
  }
  showToast(`${t.name} şu anda %100 sağlam.`);
}

async function createArtworkFromSelection() {
  if (!v16Role?.can_coordinate) { showToast("Artwork şablonu için Stratejist veya Komutan rolü gerekir."); return; }
  if (!selectedPixel) { showToast("Önce haritada artwork'ün merkezinden bir piksel seç."); return; }
  const province = provinceAt(selectedPixel.x,selectedPixel.y); if (!province) return;
  const name=(document.getElementById("artworkNameInput")?.value||"").trim(); if(name.length<2){showToast("Artwork için bir isim yaz.");return;}
  const size=Math.min(48,Math.max(8,Number(document.getElementById("artworkSizeSelect")?.value||24)));
  let x1=Math.max(0,Math.round(selectedPixel.x-size/2)), y1=Math.max(0,Math.round(selectedPixel.y-size/2));
  let x2=Math.min(WORLD_WIDTH-1,x1+size-1), y2=Math.min(WORLD_HEIGHT-1,y1+size-1);
  const cells=[];
  for(let y=y1;y<=y2;y++) for(let x=x1;x<=x2;x++) {
    if(provinceAt(x,y)!==province || ownerAt(x,y)!==selectedTeam.id) continue;
    const color=String(materialColorAt(x,y)).toLowerCase(); if(/^#[0-9a-f]{6}$/.test(color)) cells.push({x,y,color});
  }
  if(!cells.length){showToast("Seçilen alanda takımına ait piksel bulunamadı.");return;}
  const btn=document.getElementById("createArtworkBtn"); if(btn){btn.disabled=true;btn.textContent="KAYDEDİLİYOR…";}
  const { data,error }=await supabaseClient.rpc("create_artwork_template",{p_event_slug:EVENT_SLUG,p_name:name,p_province_name:province,p_x1:x1,p_y1:y1,p_x2:x2,p_y2:y2,p_cells:cells});
  if(btn){btn.disabled=false;btn.textContent="SEÇİLİ PİKSEL ETRAFINI ŞABLON YAP";}
  if(error){showToast(error.message.includes("ROLE_REQUIRED")?"Bu işlem için Stratejist/Komutan rolü gerekir.":`Artwork kaydedilemedi: ${error.message}`);return;}
  document.getElementById("artworkNameInput").value=""; await loadTeamArtworks(); await loadNotifications(); showToast(`Artwork şablonu kaydedildi · ${cells.length.toLocaleString("tr-TR")} piksel`);
}

async function setTeamTargetFromUI() {
  if (!v16Role?.can_coordinate) { showToast("Takım hedefini yalnız Stratejist veya Komutan değiştirebilir."); return; }
  const province=document.getElementById("targetProvinceSelect")?.value; const message=document.getElementById("targetMessageInput")?.value||"";
  const { error }=await supabaseClient.rpc("set_team_target",{p_event_slug:EVENT_SLUG,p_province_name:province,p_message:message});
  if(error){showToast(`Hedef güncellenemedi: ${error.message}`);return;}
  await loadTeamCenterData(); renderTeamCenterModal(); await loadNotifications(); showToast(`${province} takım hedefi olarak belirlendi.`);
}

async function openTeamCenter() {
  if (!authUser || !selectedTeam) { showToast("Takım merkezi için giriş yapıp fandom seçmelisin."); if(!authUser) openAuthModal(); return; }
  document.getElementById("teamCenterModal")?.classList.remove("hidden");
  await Promise.all([loadMyFandomRole(),loadTeamCenterData(),loadTeamArtworks()]);
  renderTeamCenterModal();
}
function closeTeamCenter(){document.getElementById("teamCenterModal")?.classList.add("hidden");}

async function loadNotifications() {
  if (!SUPABASE_ENABLED || !supabaseClient || !authUser || !activeEvent) { v16Notifications=[]; updateNotificationBadge(); return; }
  const { data,error }=await supabaseClient.from("user_notifications").select("id,notification_type,title,body,metadata,read_at,created_at").eq("event_id",activeEvent.id).order("created_at",{ascending:false}).limit(40);
  if(error){console.warn("V16 notifications unavailable",error);return;}
  v16Notifications=data||[]; updateNotificationBadge(); renderNotifications();
}
function updateNotificationBadge(){
  const btn=document.getElementById("notificationBtn"), badge=document.getElementById("notificationBadge");
  if(btn) btn.classList.toggle("hidden",!authUser);
  const unread=v16Notifications.filter(n=>!n.read_at).length;
  if(badge){badge.textContent=unread>99?"99+":String(unread);badge.classList.toggle("hidden",!unread);}
}
function timeAgo(iso){const ms=Date.now()-new Date(iso).getTime();const m=Math.max(0,Math.floor(ms/60000));if(m<1)return"şimdi";if(m<60)return`${m} dk`;const h=Math.floor(m/60);if(h<24)return`${h} sa`;return`${Math.floor(h/24)} gün`;}
function renderNotifications(){const wrap=document.getElementById("notificationsList");if(!wrap)return;if(!v16Notifications.length){wrap.innerHTML=`<div class="log-empty">Henüz bildirimin yok.</div>`;return;}wrap.innerHTML=v16Notifications.map(n=>`<div class="notification-item ${n.read_at?"":"unread"}"><i></i><div><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.body)}</p></div><time>${timeAgo(n.created_at)}</time></div>`).join("");}
async function openNotifications(){if(!authUser){openAuthModal();return;}document.getElementById("notificationsModal")?.classList.remove("hidden");await loadNotifications();}
function closeNotifications(){document.getElementById("notificationsModal")?.classList.add("hidden");}
async function markNotificationsRead(){if(!authUser)return;const {error}=await supabaseClient.rpc("mark_notifications_read",{p_event_slug:EVENT_SLUG});if(error){showToast(`Bildirimler güncellenemedi: ${error.message}`);return;}await loadNotifications();}
function subscribeV16Notifications(){
  if(!SUPABASE_ENABLED||!supabaseClient||!authUser||!activeEvent)return;
  if(v16NotificationChannel){try{supabaseClient.removeChannel(v16NotificationChannel);}catch(_){}}
  v16NotificationChannel=supabaseClient.channel(`v16-notifications-${authUser.id}`)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"user_notifications",filter:`user_id=eq.${authUser.id}`},payload=>{
      const n=payload.new;if(n){v16Notifications.unshift(n);v16Notifications=v16Notifications.slice(0,40);updateNotificationBadge();renderNotifications();showToast(n.title||"Yeni bildirim");}
    }).subscribe();
}
async function loadV16Systems(){
  if(!authUser||!selectedTeam)return;
  await Promise.all([loadMyFandomRole(),loadTeamCenterData(),loadTeamArtworks(),loadNotifications()]);
  subscribeV16Notifications(); renderV16Mini();
}

// V16 UI hooks
document.getElementById("openTeamCenterBtn")?.addEventListener("click",openTeamCenter);
document.getElementById("closeTeamCenterBtn")?.addEventListener("click",closeTeamCenter);
document.getElementById("teamCenterModal")?.addEventListener("click",e=>{if(e.target.id==="teamCenterModal")closeTeamCenter();});
document.getElementById("goTeamTargetBtn")?.addEventListener("click",()=>{const p=v16TeamCenter?.target?.province_name;if(p){closeTeamCenter();goToProvince(p);}});
document.getElementById("setTeamTargetBtn")?.addEventListener("click",setTeamTargetFromUI);
document.getElementById("createArtworkBtn")?.addEventListener("click",createArtworkFromSelection);
document.getElementById("notificationBtn")?.addEventListener("click",openNotifications);
document.getElementById("closeNotificationsBtn")?.addEventListener("click",closeNotifications);
document.getElementById("notificationsModal")?.addEventListener("click",e=>{if(e.target.id==="notificationsModal")closeNotifications();});
document.getElementById("markNotificationsReadBtn")?.addEventListener("click",markNotificationsRead);


// =========================================================
// V17 · FINAL PLATFORM
// Spectator privacy + timelapse + season awards + mobile UX
// =========================================================
let spectatorMode = false;
let v17HistoryEvents = [];
let v17HistoryIndex = 0;
let v17HistoryTimer = null;
let v17HistorySnapshot = null;

function resetPrivateUiState() {
  serverProfileOverview = null;
  v16Role = null; v16TeamCenter = null; v16Artworks = []; v16Notifications = [];
  player.name = "guest"; player.xp = 0; player.totalPlaced = 0; player.streak = 0; player.lastActiveDay = null;
  dailyState = { date: todayKey(), placed:0, defense:0, provinces:0, claimedRewards:[] };
  selectedTeam = null; lockedTeamId = null;
  document.getElementById("profileName") && (document.getElementById("profileName").textContent = "");
  document.getElementById("profileLevelText") && (document.getElementById("profileLevelText").textContent = "");
  document.getElementById("dailyMissions") && (document.getElementById("dailyMissions").innerHTML = "");
  document.getElementById("playerBattleStats") && (document.getElementById("playerBattleStats").innerHTML = "");
  document.getElementById("teamTargetMini") && (document.getElementById("teamTargetMini").innerHTML = `<div class="log-empty">Giriş yapıldığında takım merkezi açılır.</div>`);
  updateNotificationBadge();
}
function enterPublicSpectatorMode(){
  spectatorMode = true;
  document.body.classList.add("spectator-mode");
  resetPrivateUiState();
  renderTeams();
  scheduleDraw();
}
function leavePublicSpectatorMode(){
  spectatorMode = false;
  document.body.classList.remove("spectator-mode");
}

async function loadSeasonAwards(){
  const wrap=document.getElementById("seasonAwards"); if(!wrap||!SUPABASE_ENABLED||!supabaseClient||!activeEvent)return;
  const {data,error}=await supabaseClient.rpc("season_awards_public",{p_event_slug:EVENT_SLUG});
  if(error){wrap.innerHTML=`<div class="season-list-empty">Ödüller henüz hazırlanmadı.</div>`;return;}
  const labels={CHAMPION_TEAM:"ŞAMPİYON FANDOM",MVP:"SEZON MVP",DEFENDER:"EN İYİ SAVUNMACI",EXPLORER:"EN GENİŞ CEPHE",ARTIST:"EN İYİ SANATÇI"};
  wrap.innerHTML=(data||[]).map(a=>{const team=teamById(a.team_id);const who=a.award_type==="CHAMPION_TEAM"?(team?.name||a.team_id):(a.username||"Oyuncu");return `<div class="award-card"><small>${labels[a.award_type]||a.award_type}</small><strong>${escapeHtml(who||"—")}</strong><span>${Number(a.value||0).toLocaleString("tr-TR")}</span></div>`}).join("")||`<div class="season-list-empty">Ödüller henüz hesaplanmadı.</div>`;
}

function setVisualCellForHistory(ev,useOld=false){
  const x=Number(ev.x),y=Number(ev.y); if(!isLand(x,y))return; const i=idx(x,y);
  const teamId=useOld?ev.old_team_id:ev.new_team_id; const color=useOld?ev.old_color:ev.new_color;
  if(teamId){ownerGrid[i]=teamIndexById.get(teamId)||0;let pi=paletteColors.indexOf((color||teamById(teamId)?.color||"#ffffff").toLowerCase());if(pi<0){paletteColors.push((color||"#ffffff").toLowerCase());MATERIAL_COLORS.push((color||"#ffffff").toLowerCase());pi=paletteColors.length-1;}colorGrid[i]=PALETTE_OFFSET+pi;}
  else {const province=provinceAt(x,y),home=HOME_PROVINCES[province]||null;if(home){ownerGrid[i]=teamIndexById.get(home)||0;let pi=paletteColors.indexOf(teamById(home).color);colorGrid[i]=PALETTE_OFFSET+Math.max(0,pi);}else{ownerGrid[i]=0;colorGrid[i]=(x*17+y*11)%43===0?MATERIAL_LAND_ALT:MATERIAL_LAND;}}
}
function refreshHistoryVisual(){rebuildWorldLayer();rebuildOwnershipLayer();defenseLayerTeamId=null;miniMapDirty=true;scheduleDraw();}
function restoreHistorySnapshot(){if(!v17HistorySnapshot)return;colorGrid.set(v17HistorySnapshot.color);ownerGrid.set(v17HistorySnapshot.owner);v17HistorySnapshot=null;refreshHistoryVisual();}
async function openHistoryModal(){document.getElementById("historyModal")?.classList.remove("hidden");}
function closeHistoryModal(){clearInterval(v17HistoryTimer);v17HistoryTimer=null;restoreHistorySnapshot();document.getElementById("historyModal")?.classList.add("hidden");}
async function loadHistory(){
  if(!SUPABASE_ENABLED||!supabaseClient){showToast("Timelapse için Supabase gerekli.");return;}
  const st=document.getElementById("historyStatus"); if(st)st.textContent="Yükleniyor…";
  const {data,error}=await supabaseClient.rpc("timelapse_events",{p_event_slug:EVENT_SLUG,p_from:null,p_to:null,p_limit:10000});
  if(error){if(st)st.textContent=error.message;return;}
  restoreHistorySnapshot(); v17HistorySnapshot={color:colorGrid.slice(),owner:ownerGrid.slice()}; v17HistoryEvents=data||[];
  for(let i=v17HistoryEvents.length-1;i>=0;i--)setVisualCellForHistory(v17HistoryEvents[i],true);
  refreshHistoryVisual(); v17HistoryIndex=0;
  const range=document.getElementById("historyRange");range.max=Math.max(0,v17HistoryEvents.length);range.value=0;range.disabled=!v17HistoryEvents.length;
  document.getElementById("playHistoryBtn").disabled=!v17HistoryEvents.length;
  document.getElementById("historyCount").textContent=`${v17HistoryEvents.length.toLocaleString("tr-TR")} olay`;
  if(st)st.textContent=v17HistoryEvents.length?"Hazır":"V17 sonrası geçmiş henüz yok";updateHistoryMeta();
}
function updateHistoryMeta(){const ev=v17HistoryEvents[Math.max(0,v17HistoryIndex-1)];document.getElementById("historyTime").textContent=ev?new Intl.DateTimeFormat("tr-TR",{dateStyle:"short",timeStyle:"medium"}).format(new Date(ev.created_at)):"Başlangıç";}
function seekHistory(target){target=Math.max(0,Math.min(v17HistoryEvents.length,Number(target))); if(!v17HistorySnapshot)return; colorGrid.set(v17HistorySnapshot.color);ownerGrid.set(v17HistorySnapshot.owner);for(let i=v17HistoryEvents.length-1;i>=0;i--)setVisualCellForHistory(v17HistoryEvents[i],true);for(let i=0;i<target;i++)setVisualCellForHistory(v17HistoryEvents[i],false);v17HistoryIndex=target;document.getElementById("historyRange").value=target;refreshHistoryVisual();updateHistoryMeta();}
function toggleHistoryPlay(){if(v17HistoryTimer){clearInterval(v17HistoryTimer);v17HistoryTimer=null;document.getElementById("playHistoryBtn").textContent="▶ OYNAT";return;}const speed=()=>Number(document.getElementById("historySpeed").value||1);document.getElementById("playHistoryBtn").textContent="Ⅱ DURDUR";v17HistoryTimer=setInterval(()=>{if(v17HistoryIndex>=v17HistoryEvents.length){clearInterval(v17HistoryTimer);v17HistoryTimer=null;document.getElementById("playHistoryBtn").textContent="▶ OYNAT";return;}const n=Math.min(v17HistoryEvents.length,v17HistoryIndex+Math.max(1,speed()*3));for(let i=v17HistoryIndex;i<n;i++)setVisualCellForHistory(v17HistoryEvents[i],false);v17HistoryIndex=n;document.getElementById("historyRange").value=n;refreshHistoryVisual();updateHistoryMeta();},120);}

document.getElementById("closeHistoryBtn")?.addEventListener("click",closeHistoryModal);
document.getElementById("loadHistoryBtn")?.addEventListener("click",loadHistory);
document.getElementById("playHistoryBtn")?.addEventListener("click",toggleHistoryPlay);
document.getElementById("historyRange")?.addEventListener("input",e=>seekHistory(e.target.value));
document.getElementById("historyModal")?.addEventListener("click",e=>{if(e.target.id==="historyModal")closeHistoryModal();});
document.querySelectorAll("[data-mobile]").forEach(btn=>btn.addEventListener("click",()=>{const t=btn.dataset.mobile;if(t==="map")resetViewToTurkey();else if(t==="ownership"){viewMode="ownership";document.querySelectorAll(".view-btn").forEach(x=>x.classList.toggle("active",x.dataset.view==="ownership"));scheduleDraw();}else if(t==="team")openTeamCenter();else if(t==="history")openHistoryModal();else if(t==="account")openProfileModal();}));

// Touch: one finger drag, tap select; two finger pinch zoom.
let v17Touches=null;
canvas.addEventListener("touchstart",e=>{if(!mapReady)return;if(e.touches.length===2){const a=e.touches[0],b=e.touches[1];v17Touches={mode:"pinch",dist:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),zoom:camera.zoom,cx:(a.clientX+b.clientX)/2,cy:(a.clientY+b.clientY)/2};}else if(e.touches.length===1){const t=e.touches[0];v17Touches={mode:"drag",sx:t.clientX,sy:t.clientY,cx:camera.x,cy:camera.y,moved:false};}e.preventDefault();},{passive:false});
canvas.addEventListener("touchmove",e=>{if(!v17Touches)return;if(v17Touches.mode==="pinch"&&e.touches.length===2){const a=e.touches[0],b=e.touches[1],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);const r=canvas.getBoundingClientRect();setZoom(v17Touches.zoom*(d/v17Touches.dist),v17Touches.cx-r.left,v17Touches.cy-r.top);}else if(v17Touches.mode==="drag"&&e.touches.length===1){const t=e.touches[0],dx=t.clientX-v17Touches.sx,dy=t.clientY-v17Touches.sy;if(Math.abs(dx)>5||Math.abs(dy)>5)v17Touches.moved=true;camera.x=v17Touches.cx-dx/camera.zoom;camera.y=v17Touches.cy-dy/camera.zoom;clampCamera();scheduleDraw();}e.preventDefault();},{passive:false});
canvas.addEventListener("touchend",e=>{if(v17Touches?.mode==="drag"&&!v17Touches.moved){const t=e.changedTouches[0],c=getWorldCoordinates(t.clientX,t.clientY);selectedPixel=isLand(c.x,c.y)?c:null;if(selectedPixel)renderPixelInspector(c.x,c.y);scheduleDraw();}v17Touches=null;});

document.getElementById("logoutBtn")?.addEventListener("click", signOutFanverse);
document.getElementById("welcomeLoginBtn")?.addEventListener("click", () => { hideWelcome(); openAuthModal(); document.getElementById("authEmail")?.focus(); });
document.getElementById("welcomeSignupBtn")?.addEventListener("click", () => { hideWelcome(); openAuthModal(); setAuthStatus("Yeni hesap için e-posta ve şifre girip Kayıt Ol'a bas."); document.getElementById("authEmail")?.focus(); });
document.getElementById("welcomeWatchBtn")?.addEventListener("click", () => { enterPublicSpectatorMode(); hideWelcome(); showToast("İzleyici modu: yalnızca herkese açık harita ve canlı istatistikler gösteriliyor."); });
document.getElementById("closeGuideBtn")?.addEventListener("click", closeGuide);
document.getElementById("guideGoMapBtn")?.addEventListener("click", () => { closeGuide(); document.querySelectorAll(".nav-link").forEach(x => x.classList.toggle("active", x.dataset.target === "map")); });
document.getElementById("guideModal")?.addEventListener("click", e => { if (e.target.id === "guideModal") closeGuide(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && authUser) heartbeatPresence(); });

document.getElementById("closeSeasonModalBtn")?.addEventListener("click", () => document.getElementById("seasonModal")?.classList.add("hidden"));
document.getElementById("closeSeasonResultBtn")?.addEventListener("click", () => document.getElementById("seasonResultModal")?.classList.add("hidden"));
document.getElementById("openArchiveFromResultBtn")?.addEventListener("click", () => { document.getElementById("seasonResultModal")?.classList.add("hidden"); openSeasonArchive(); });

renderWelcomeFandoms(); renderPalette(); renderTeams(); renderLeaderboard(); renderAttackCenter(); renderProgression(); updateCooldown(); updateSeasonUI(); requestAnimationFrame(resizeCanvas); loadTurkeyMap(); initAccountLayer();
seasonUiTimer = setInterval(updateSeasonUI, 1000);
setInterval(() => { pruneRecentAttacks(); if (recentAttacks.length) { heatmapDirty = true; renderAttackCenter(); scheduleDraw(); } }, 5000);
