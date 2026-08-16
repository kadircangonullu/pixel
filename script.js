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
let realtimePixelChannel = null;
let remotePixelsLoaded = false;
let remoteSyncPending = false;
let lockedTeamId = localStorage.getItem(TEAM_LOCK_STORAGE_KEY) || null;
let onboardingCandidateId = null;

const teams = [
  { id: "crush", name: "CRUSH", color: "#ff4b9b", city: "İstanbul", points: 1284221, pixels: 0, capturedProvinces: 0, securedRegions: 0 },
  { id: "manifest", name: "MANIFEST", color: "#4ba8ff", city: "İzmir", points: 1107542, pixels: 0, capturedProvinces: 0, securedRegions: 0 },
  { id: "aura", name: "AURA", color: "#9c6bff", city: "Ankara", points: 842193, pixels: 0, capturedProvinces: 0, securedRegions: 0 },
  { id: "karm6", name: "KARM6", color: "#ff7b38", city: "Antalya", points: 736481, pixels: 0, capturedProvinces: 0, securedRegions: 0 },
  { id: "mantra", name: "MANTRA", color: "#ffcf42", city: "Samsun", points: 692153, pixels: 0, capturedProvinces: 0, securedRegions: 0 },
  { id: "radikal", name: "RADİKAL", color: "#ee4054", city: "Erzurum", points: 581239, pixels: 0, capturedProvinces: 0, securedRegions: 0 },
  { id: "perma", name: "PERMA", color: "#4ce3a4", city: "Gaziantep", points: 477152, pixels: 0, capturedProvinces: 0, securedRegions: 0 }
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
let viewMode = "artwork";
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
    if (SUPABASE_ENABLED && authUser) await syncRemotePixels();
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
  const feature = provinceByName.get(provinceName); if (!feature) return;
  const stats = getProvinceStats(provinceName);
  const winnerId = stats.control >= 100 ? stats.leaderId : null;
  const oldWinner = feature._capturedBy;
  if (winnerId && winnerId !== oldWinner) {
    feature._capturedBy = winnerId;
    const team = teamById(winnerId);
    team.points += PROVINCE_BONUS;
    addBattleLog(`${team.name}, ${provinceName} ilini tamamen ele geçirdi.`, PROVINCE_BONUS);
    showToast(`${provinceName} artık tamamen ${team.name} kontrolünde! +${PROVINCE_BONUS.toLocaleString("tr-TR")}`);
  } else if (!winnerId && oldWinner && !feature._home) {
    feature._capturedBy = null;
  } else if (!winnerId && oldWinner && feature._home) {
    feature._capturedBy = null;
    feature._home = false;
  }
  recalcCapturedCounts();
  evaluateRegionCaptures();
}

function evaluateRegionCaptures() {
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

function renderProvinceSpotlight(name) {
  const target = document.getElementById("provinceSpotlight");
  if (!name || !provinceByName.has(name)) { target.innerHTML = `<div class="province-empty">Haritada bir ilin üzerine gel.</div>`; return; }
  const feature = provinceByName.get(name), stats = getProvinceStats(name), leader = teamById(stats.leaderId), captured = teamById(feature._capturedBy);
  const color = captured?.color || leader?.color || "#64748b";
  target.innerHTML = `<div class="province-head"><div><h3>${name}</h3><span>${feature._region}</span></div><span>${feature._home ? "BAŞLANGIÇ KALESİ" : (captured ? "ELE GEÇİRİLDİ" : "SAVAŞ ALANI")}</span></div>
    <div class="province-owner"><i class="dot" style="background:${color}"></i>${captured ? `${captured.name} tam kontrol` : leader ? `${leader.name} önde` : "Henüz tarafsız"}</div>
    <div class="province-grid"><div class="province-metric"><small>LİDER HAKİMİYETİ</small><strong>%${stats.control.toFixed(1)}</strong></div><div class="province-metric"><small>DOLULUK</small><strong>%${stats.claimedPct.toFixed(1)}</strong></div></div>
    <div class="province-progress"><div style="width:${stats.control}%;background:${color}"></div></div>
    ${selectedTeam ? (() => { const own = stats.counts[selectedTeam.id] || 0; const foreign = Math.max(0, stats.claimed - own); const attacks = attacksForProvince(name, selectedTeam.id).length; return `<div class="defense-summary"><span>${selectedTeam.name} savunma taraması</span><strong>${foreign.toLocaleString("tr-TR")} yabancı piksel</strong></div>${foreign ? `<div class="foreign-alert">Bu ilde ${selectedTeam.name} dışındaki fandomlara ait ${foreign.toLocaleString("tr-TR")} piksel var. Son 5 dk savunma kaybı: ${attacks}.</div><div class="province-defense-actions"><button onclick="findNextForeignPixel('${name.replace("'","\'")}')">YABANCI PİKSELE GİT</button><button onclick="setDefenseView()">SAVUNMA GÖRÜNÜMÜ</button></div>` : `<div class="foreign-clean">Bu ilde başka bir fandoma ait yerleştirilmiş piksel görünmüyor.</div>`}`; })() : `<div class="defense-summary"><span>Savunma taraması</span><strong>Fandom seç</strong></div>`}`;
}

function renderLeaderboard() {
  const sorted = [...teams].sort((a,b) => b.points - a.points || b.capturedProvinces - a.capturedProvinces || b.pixels - a.pixels);
  document.getElementById("leaderboard").innerHTML = sorted.map((team, index) => `<div class="leader-row"><span>${index + 1}</span><div class="leader-team"><span class="leader-dot" style="background:${team.color}"></span><span class="leader-team-text">${team.name}</span></div><span class="leader-score"><strong>${team.points.toLocaleString("tr-TR")}</strong><small>${team.capturedProvinces} il · ${team.securedRegions} bölge</small></span></div>`).join("");
}

function updateGlobalStats() {
  document.getElementById("pixelCount").textContent = todayPixels.toLocaleString("tr-TR");
  document.getElementById("provinceCount").textContent = `${provinceFeatures.filter(f => f._capturedBy).length} / 81`;
  document.getElementById("securedCount").textContent = `${regions.filter(r => r.securedBy).length} / 7`;
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
  const { x, y } = selectedPixel, provinceName = provinceAt(x, y);

  if (SUPABASE_ENABLED) {
    if (!authUser) { modal.classList.add("hidden"); openAuthModal(); showToast("Piksel bırakmak için giriş yapmalısın."); return; }
    const { data, error } = await supabaseClient.rpc("place_pixel", {
      p_event_slug: EVENT_SLUG, p_x: x, p_y: y, p_color: selectedColor, p_province_name: provinceName
    });
    if (error) {
      if (error.message.includes("COOLDOWN")) showToast("Cooldown henüz bitmedi.");
      else if (error.message.includes("TEAM_REQUIRED")) openTeamOnboarding();
      else showToast(`Piksel yerleştirilemedi: ${error.message}`);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      applySyncedPixel(row, true);
      cooldownEnd = row.cooldown_until ? new Date(row.cooldown_until).getTime() : Date.now() + COOLDOWN_MS;
      localStorage.setItem(COOLDOWN_STORAGE_KEY, String(cooldownEnd));
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
    if (countProgress) team.points += 10;
    if (counts) counts[teamId] = (counts[teamId] || 0) + 1;
  }
  if (countProgress) {
    todayPixels++;
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
  else if (target !== "map") showToast(`${btn.textContent.trim()} bölümü sonraki modülde genişletilecek.`);
}));


function renderProgression() {
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
  modal.classList.remove("hidden");
}
document.getElementById("profileOpenBtn")?.addEventListener("click", openProfileModal);
document.getElementById("closeProfileBtn")?.addEventListener("click",()=>document.getElementById("profileModal").classList.add("hidden"));
document.getElementById("saveProfileBtn")?.addEventListener("click",()=>{
  const value=document.getElementById("profileNameInput").value.trim().replace(/\s+/g," ").slice(0,18);
  player.name=value||"guest"; savePlayerProfile(); renderProgression(); document.getElementById("profileModal").classList.add("hidden"); showToast("Profil kaydedildi.");
});
document.getElementById("profileModal")?.addEventListener("click",e=>{ if(e.target.id==="profileModal") e.currentTarget.classList.add("hidden"); });

function renderAll() { renderTeams(); renderRegionBoard(); renderLeaderboard(); renderProvinceSpotlight(hoveredProvinceName); renderAttackCenter(); updateGlobalStats(); renderProgression(); }

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
async function hydrateAccountFromSupabase() {
  if (!SUPABASE_ENABLED || !authUser) return;
  const { data: eventData } = await supabaseClient.from("events").select("id,slug,name,ends_at,status").eq("slug", EVENT_SLUG).maybeSingle();
  activeEvent = eventData || null;
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
  renderAll(); updateCooldown(); updateAuthChip();
  if (mapReady) await syncRemotePixels(); else remoteSyncPending = true;
}
async function syncRemotePixels() {
  if (!SUPABASE_ENABLED || !authUser || !activeEvent || !mapReady) return;
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
      const row = payload.new; if (!row) return; applySyncedPixel(row, false); renderAll(); scheduleDraw();
    }).subscribe();
}
async function initAccountLayer() {
  updateAuthChip();
  if (!SUPABASE_ENABLED) {
    if (lockedTeamId) selectedTeam = teamById(lockedTeamId);
    else setTimeout(() => openTeamOnboarding(), 650);
    renderAll(); return;
  }
  supabaseClient = window.supabase.createClient(FANVERSE_CONFIG.url, FANVERSE_CONFIG.publishableKey);
  const { data } = await supabaseClient.auth.getSession();
  authUser = data.session?.user || null; updateAuthChip();
  if (authUser) await hydrateAccountFromSupabase();
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    authUser = session?.user || null; updateAuthChip();
    if (authUser) await hydrateAccountFromSupabase();
    else { lockedTeamId = null; selectedTeam = null; renderAll(); }
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

renderPalette(); renderTeams(); renderLeaderboard(); renderAttackCenter(); renderProgression(); updateCooldown(); requestAnimationFrame(resizeCanvas); loadTurkeyMap(); initAccountLayer();
setInterval(() => { pruneRecentAttacks(); if (recentAttacks.length) { heatmapDirty = true; renderAttackCenter(); scheduleDraw(); } }, 5000);
