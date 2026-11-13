import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices as mergeVerts } from 'three/addons/utils/BufferGeometryUtils.js';

const S = window.MB_SCI, I18N = window.MB_I18N, ASSETS = window.MB_ASSETS;
const { D2R, R2D, SITES, SRC } = S;
const RM = 3389500;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fmt = (v, d = 1) => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ state & prefs
const SITE_KEYS = ['jezero', 'gale', 'olympus', 'valles', 'elysium'];
const state = {
  view: 'menu', lang: 'en', mode: 'explore', fs: 15, hc: false, rm: false, cap: true, snd: true, ac: true, quality: 'med', ve: 1, sens: 1,
  siteKey: 'jezero', custom: null, samples: [], greenhouses: [], discovered: {}, ghRuns: [], leach: null, quiz: {}, labAnalysed: {},
  whatIf: { active: false, P: 6, tau: 0.5, gh: 0, years: 100, t: 1 }, timeMode: 'live', manualLtst: 12.5, lapseLtst: 9, dustStorm: false, explain: 'simple',
};
function savePrefs() {
  try { localStorage.setItem('mb-prefs', JSON.stringify({ lang: state.lang, mode: state.mode, fs: state.fs, hc: state.hc, rm: state.rm, cap: state.cap, snd: state.snd, ac: state.ac, quality: state.quality, ve: state.ve, sens: state.sens })); } catch (e) { }
}
function saveProgress() {
  try { localStorage.setItem('mb-progress', JSON.stringify({ samples: state.samples, greenhouses: state.greenhouses, discovered: state.discovered, ghRuns: state.ghRuns, quiz: state.quiz, labAnalysed: state.labAnalysed, leach: state.leach, atmoRun: state.atmoRun })); } catch (e) { }
}
try { Object.assign(state, JSON.parse(localStorage.getItem('mb-prefs') || '{}')); } catch (e) { }
try { Object.assign(state, JSON.parse(localStorage.getItem('mb-progress') || '{}')); } catch (e) { }
if (!I18N.LANGS[state.lang]) {
  const nl = (navigator.language || 'en').slice(0, 2); state.lang = I18N.LANGS[nl] ? nl : 'en';
}

const t = (k, vars) => { let s = (I18N.T[state.lang] && I18N.T[state.lang][k]) || I18N.T.en[k] || k; if (vars) for (const v in vars) s = s.replace('{' + v + '}', vars[v]); return s; };
const siteName = k => t('site_' + k);
const badge = (st) => `<span class="st st-${st}" title="${esc(t('st_' + st + '_d'))}">${esc(t('st_' + st))}</span>`;
const srcLink = (key, extra = '') => SRC[key] ? `<div class="src">${t('source')}: <a href="${SRC[key].u}" target="_blank" rel="noopener">${esc(SRC[key].t)}</a>${extra}</div>` : '';
function toast(msg, ms = 4200) { const el = $('#toast'); el.innerHTML = msg; el.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => el.style.display = 'none', ms); announce(el.textContent); }
function announce(msg) { $('#live').textContent = ''; setTimeout(() => $('#live').textContent = msg, 30); }
let capTimer = 0;
function caption(msg, ms = 3200) { if (!state.cap) return; const el = $('#captions'); el.textContent = msg; el.style.display = 'block'; clearTimeout(capTimer); capTimer = setTimeout(() => el.style.display = 'none', ms); }

// ------------------------------------------------------------------ asset decoding
async function gunzipB64(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ds = new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(ds)).arrayBuffer());
}
function decodeGrid(bytes, w, h) {
  const n = w * h, out = new Float32Array(n);
  for (let r = 0; r < h; r++) { let acc = 0; for (let c = 0; c < w; c++) { const i = r * w + c; let d = bytes[i] | (bytes[n + i] << 8); if (d >= 32768) d -= 65536; acc += d; out[i] = acc; } }
  return out;
}
const DATA = { global: null, sites: {} };
function globalElev(lat, lon) {
  const g = DATA.global; if (!g) return NaN;
  const r = clamp((90 - lat) / 0.25 - 0.5, 0, g.h - 1);
  let c = (S.mod(lon, 360)) / 0.25 - 0.5; if (c < 0) c += g.w;
  const r0 = Math.floor(r), c0 = Math.floor(c), fr = r - r0, fc = c - c0, r1 = Math.min(r0 + 1, g.h - 1), c1 = (c0 + 1) % g.w;
  const A = g.a;
  return (A[r0 * g.w + c0] * (1 - fc) + A[r0 * g.w + c1] * fc) * (1 - fr) + (A[r1 * g.w + c0] * (1 - fc) + A[r1 * g.w + c1] * fc) * fr;
}

// ------------------------------------------------------------------ loader
const ldSteps = $('#ld-steps');
function ldStep(txt, pct) { $$('#ld-steps div').forEach(d => d.classList.add('done')); const d = document.createElement('div'); d.textContent = txt; ldSteps.appendChild(d); $('#ld-fill').style.width = pct + '%'; }

// ------------------------------------------------------------------ renderer
const canvas = $('#c3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
function applyQuality() {
  const q = state.quality;
  renderer.setPixelRatio(q === 'low' ? 1 : q === 'med' ? Math.min(1.5, devicePixelRatio) : Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = q !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (field.sun) { field.sun.castShadow = q !== 'low'; field.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024); if (field.sun.shadow.map) { field.sun.shadow.map.dispose(); field.sun.shadow.map = null; } }
  resize();
}
function setGlobeOffset(on) { globe.offset = on; if (on && innerWidth > 820) globe.cam.setViewOffset(innerWidth, innerHeight, (document.documentElement.dir === 'rtl' ? 1 : -1) * innerWidth * 0.2, 0, innerWidth, innerHeight); else globe.cam.clearViewOffset(); }
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  globe.cam.aspect = field.cam.aspect = innerWidth / innerHeight; globe.cam.updateProjectionMatrix(); field.cam.updateProjectionMatrix(); if (globe.offset !== undefined) setGlobeOffset(globe.offset);
}
addEventListener('resize', () => resize());

// ================================================================== GLOBE
const globe = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(40, 1, 0.01, 200), markers: [], labels: [], exag: 10 };
let orbit;
function buildGlobe() {
  const sc = globe.scene;
  sc.background = new THREE.Color(0x050404);
  const loadTex = b64 => { const img = new Image(); const tx = new THREE.Texture(img); img.onload = () => { tx.needsUpdate = true; }; img.src = 'data:image/jpeg;base64,' + b64; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; return tx; };
  globe.texNat = loadTex(ASSETS.texNatural); globe.texSci = loadTex(ASSETS.texScience);
  // displacement texture from global grid (downsample to 720x360)
  const g = DATA.global, w = 720, h = 360, disp = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const a = g.a, i0 = (r * 2) * g.w + c * 2;
    disp[r * w + c] = (a[i0] + a[i0 + 1] + a[i0 + g.w] + a[i0 + g.w + 1]) / 4 / 21229;
  }
  const dt = new THREE.DataTexture(disp, w, h, THREE.RedFormat, THREE.FloatType); dt.flipY = true; dt.magFilter = THREE.LinearFilter; dt.minFilter = THREE.LinearFilter; dt.needsUpdate = true;
  // flipY is ignored for DataTexture in WebGL2 — flip rows manually instead
  const flipped = new Float32Array(w * h); for (let r = 0; r < h; r++) flipped.set(disp.subarray((h - 1 - r) * w, (h - r) * w), r * w);
  dt.image.data = flipped; dt.flipY = false;
  globe.mat = new THREE.MeshStandardMaterial({ map: globe.texNat, displacementMap: dt, displacementScale: 21229 / 3389500 * globe.exag, roughness: 1, metalness: 0 });
  globe.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 384, 192), globe.mat);
  sc.add(globe.mesh);
  // atmosphere rim
  const atm = new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 48), new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 wp=modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-wp.xyz); gl_Position=projectionMatrix*viewMatrix*wp; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f=pow(1.0-abs(dot(vN,vV)),3.0); gl_FragColor=vec4(vec3(0.85,0.55,0.35)*f*0.9, f); }'
  }));
  sc.add(atm);
  // stars
  const sg = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 3500; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(80); sp.push(v.x, v.y, v.z); }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sc.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xd8d0c8, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.8 })));
  sc.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xfff1e0, 2.6); sun.position.set(-3, 1.2, 2.5); sc.add(sun);
  globe.cam.position.set(0, 0.6, 3.4);
  orbit = new OrbitControls(globe.cam, canvas);
  orbit.enableDamping = true; orbit.minDistance = 1.25; orbit.maxDistance = 6; orbit.rotateSpeed = 0.5; orbit.enablePan = false;
  orbit.autoRotate = true; orbit.autoRotateSpeed = 0.35;
  // markers
  for (const k of SITE_KEYS) addGlobeMarker(k, SITES[k].lat, SITES[k].lon, true);
  canvas.addEventListener('pointerdown', e => { globe.down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (state.view !== 'globe' || !globe.down) return;
    if (Math.hypot(e.clientX - globe.down[0], e.clientY - globe.down[1]) > 5) return;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1), globe.cam);
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1.0), new THREE.Vector3());
    if (hit) { const [lat, lon] = vecToLatLon(hit); showGlobeInfo(lat, lon); }
  });
}
function latLonToVec(lat, lon, r = 1) { const th = (90 - lat) * D2R, ph = lon * D2R; return new THREE.Vector3(-Math.cos(ph) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(ph) * Math.sin(th) * r); }
function vecToLatLon(v) { const n = v.clone().normalize(); return [90 - Math.acos(n.y) * R2D, S.mod(Math.atan2(n.z, -n.x) * R2D, 360)]; }
function addGlobeMarker(key, lat, lon, isSite) {
  const el = document.createElement('div'); el.className = 'glabel'; el.dataset.key = key;
  el.addEventListener('click', () => { if (isSite) selectSite(key, true); });
  $('#globe-labels').appendChild(el);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe2a06a }));
  globe.scene.add(dot);
  const m = { key, lat, lon, el, dot, isSite }; globe.markers.push(m); placeMarker(m); return m;
}
function placeMarker(m) {
  const e = isFinite(globalElev(m.lat, m.lon)) ? globalElev(m.lat, m.lon) : 0;
  m.dot.position.copy(latLonToVec(m.lat, m.lon, 1 + e / 3389500 * globe.exag + 0.004));
}
function updateGlobeLabels() {
  const camDir = globe.cam.position.clone().normalize();
  for (const m of globe.markers) {
    m.el.textContent = m.isSite ? siteName(m.key) : t('custom_site');
    const p = m.dot.position.clone(); const facing = p.clone().normalize().dot(camDir);
    const s = p.project(globe.cam);
    const vis = facing > 0.15 && s.z < 1;
    m.el.style.display = vis ? 'block' : 'none';
    if (vis) { m.el.style.left = ((s.x + 1) / 2 * innerWidth) + 'px'; m.el.style.top = ((1 - s.y) / 2 * innerHeight) + 'px'; m.el.style.opacity = clamp((facing - 0.15) * 4, 0, 1); }
  }
}
function flyGlobeTo(lat, lon) {
  orbit.autoRotate = false;
  const target = latLonToVec(lat, lon, 1).normalize().multiplyScalar(2.3);
  globe.fly = { from: globe.cam.position.clone(), to: target, t: 0 };
}
function renderSiteList() {
  $('#site-list').innerHTML = SITE_KEYS.map(k => {
    const s = SITES[k];
    return `<button class="site-item ${k === state.siteKey && !state.custom ? 'sel' : ''}" data-site="${k}"><b>${esc(siteName(k))}</b><small>${fmtLat(s.lat)} ${fmtLon(s.lon)} · ${esc(t('kind_' + s.kind))}</small></button>`;
  }).join('');
  $$('#site-list [data-site]').forEach(b => b.onclick = () => selectSite(b.dataset.site, true));
}
const fmtLat = v => Math.abs(v).toFixed(2) + '°' + (v >= 0 ? 'N' : 'S');
const fmtLon = v => { v = S.mod(v, 360); return v.toFixed(2) + '°E'; };
function selectSite(k, fly) {
  state.siteKey = k; state.custom = null; renderSiteList();
  const s = SITES[k]; if (fly) flyGlobeTo(s.lat, s.lon);
  const e = globalElev(s.lat, s.lon);
  $('#globe-info').style.display = 'block';
  $('#globe-info').innerHTML = `<div class="kicker">${esc(t('kind_' + s.kind))}</div><h2>${esc(siteName(k))}</h2>
    <div class="muted mono">${fmtLat(s.lat)} · ${fmtLon(s.lon)} · ${t('elevation')} ${fmt(e / 1000, 2)} km ${badge('COMPUTED')}</div>
    <p>${esc(t('sitedesc_' + k))}</p>
    <div class="muted">${esc(s.mission)}</div>
    <div class="row" style="margin-top:12px"><button class="btn pri" id="land-btn">${t('land_site')}</button><button class="btn" id="env-btn">${t('nav_env')}</button></div>`;
  $('#land-btn').onclick = () => { go('field'); };
  $('#env-btn').onclick = () => go('env');
}
function showGlobeInfo(lat, lon) {
  const e = globalElev(lat, lon);
  let near = null, nd = 1e9; for (const k of SITE_KEYS) { const d = gcDist(lat, lon, SITES[k].lat, SITES[k].lon); if (d < nd) { nd = d; near = k; } }
  if (nd < 60) return selectSite(near, false);
  $('#globe-info').style.display = 'block';
  $('#globe-info').innerHTML = `<div class="kicker">${t('custom_site')}</div><h2 class="mono" style="font-size:1.2rem">${fmtLat(lat)} · ${fmtLon(lon)}</h2>
   <div class="muted mono">${t('elevation')} ${fmt(e / 1000, 2)} km ${badge('COMPUTED')} · ${t('pressure')} ≈ ${fmt(S.pressureModel(e), 0)} Pa ${badge('MODELLED')}</div>
   <p class="muted">${t('custom_note')}</p><p class="muted">${t('nearest')}: ${esc(siteName(near))} (${fmt(nd, 0)} km)</p>
   <div class="row"><button class="btn pri" id="land-custom">${t('land_here')}</button></div>`;
  $('#land-custom').onclick = () => { state.custom = { lat, lon }; go('field'); };
}
function gcDist(a1, o1, a2, o2) { const p1 = a1 * D2R, p2 = a2 * D2R, dl = (o2 - o1) * D2R; return Math.acos(clamp(Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl), -1, 1)) * RM / 1000; }
function parseCoords(q) {
  q = q.trim().toLowerCase(); if (!q) return null;
  for (const k of SITE_KEYS) if (q.includes(k) || siteName(k).toLowerCase().includes(q) || (k === 'olympus' && q.includes('olymp')) || (k === 'valles' && q.includes('valles')) || (k === 'elysium' && (q.includes('insight') || q.includes('elysium'))) || (k === 'jezero' && q.includes('persever')) || (k === 'gale' && q.includes('curiosity'))) return { site: k };
  const m = q.replace(/,/g, ' ').match(/(-?\d+(?:\.\d+)?)\s*°?\s*([ns])?\s+(-?\d+(?:\.\d+)?)\s*°?\s*([ew])?/);
  if (!m) return null;
  let lat = parseFloat(m[1]), lon = parseFloat(m[3]);
  if (m[2] === 's') lat = -Math.abs(lat); if (m[4] === 'w') lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
  return { lat, lon: S.mod(lon, 360) };
}

// ================================================================== FIELD
const field = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(70, 1, 0.3, 3e6), rig: new THREE.Group(), site: null, U: { tileC: { value: new THREE.Vector2() }, tileH: { value: 0 } } };
field.rig.add(field.cam); field.scene.add(field.rig);
const player = { x: 0, z: 0, y: 0, vy: 0, yaw: 0, pitch: 0, move: 'walk', onGround: true, speed: 0, eye: 1.7, steps: 0 };
const keys = {};

// --- noise
function hash2(ix, iz) { let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}
const SITE_LOOK = {
  jezero: { rough: 1.0, dust: [0.66, 0.44, 0.30], rock: [0.36, 0.30, 0.27], crat: 0.10, rocks: 0.11 },
  gale: { rough: 0.9, dust: [0.62, 0.38, 0.24], rock: [0.30, 0.22, 0.18], crat: 0.08, rocks: 0.09 },
  olympus: { rough: 1.5, dust: [0.55, 0.35, 0.24], rock: [0.22, 0.17, 0.15], crat: 0.04, rocks: 0.16 },
  valles: { rough: 1.3, dust: [0.66, 0.42, 0.28], rock: [0.42, 0.30, 0.24], crat: 0.05, rocks: 0.12, bands: true },
  elysium: { rough: 0.5, dust: [0.68, 0.45, 0.31], rock: [0.38, 0.30, 0.26], crat: 0.12, rocks: 0.04 },
  custom: { rough: 1.0, dust: [0.65, 0.42, 0.28], rock: [0.34, 0.27, 0.23], crat: 0.08, rocks: 0.08 },
};
function look() { return SITE_LOOK[field.site ? field.site.key : 'jezero'] || SITE_LOOK.custom; }
function detail(x, z) {
  const L = look(); let h = 0;
  h += vnoise(x / 420, z / 420) * 7 * L.rough + vnoise(x / 160, z / 160) * 3 * L.rough + vnoise(x / 60, z / 60) * 1.3 * L.rough + vnoise(x / 23, z / 23) * 0.5 * L.rough + vnoise(x / 9, z / 9) * 0.18;
  // small procedural craters (detail below MOLA resolution — procedural)
  const cs = 110, cx = Math.floor(x / cs), cz = Math.floor(z / cs);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const hx = cx + i, hz = cz + j, r0 = hash2(hx * 7 + 3, hz * 13 + 1);
    if (r0 > L.crat) continue;
    const rad = 4 + 40 * Math.pow(hash2(hx + 91, hz + 17), 2.2), px = (hx + hash2(hx, hz + 5)) * cs, pz = (hz + hash2(hx + 3, hz)) * cs;
    const d = Math.hypot(x - px, z - pz) / rad;
    if (d < 1.6) { const depth = rad * 0.18; h += d < 1 ? -depth * (1 - d * d) + depth * 0.25 * d * d * d * d * 0 + rimH(d) * depth : rimH(d) * depth; }
  }
  return h;
}
function rimH(d) { return d < 1 ? 0.25 * Math.pow(d, 6) : 0.25 * Math.exp(-(d - 1) * 6); }

// --- site loading
async function loadSite(key) {
  if (DATA.sites[key]) return DATA.sites[key];
  const a = ASSETS['site_' + key];
  const grid = decodeGrid(await gunzipB64(a.b64), a.n, a.n);
  const s = { key, grid, N: a.n, half: a.halfKm * 1000, lat0: a.lat0, lon0: a.lon0, min: a.min, max: a.max, res: '0.125° (≈7 km effective)' };
  DATA.sites[key] = s; return s;
}
function makeCustomSite(lat, lon) {
  const N = 129, half = 150000, grid = new Float32Array(N * N);
  let mn = 1e9, mx = -1e9;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const x = -half + c / (N - 1) * 2 * half, z = -half + r / (N - 1) * 2 * half;
    const la = lat + (-z / RM) * R2D, lo = lon + (x / (RM * Math.cos(la * D2R))) * R2D;
    const e = globalElev(la, lo); grid[r * N + c] = e; mn = Math.min(mn, e); mx = Math.max(mx, e);
  }
  return { key: 'custom', grid, N, half, lat0: lat, lon0: lon, min: mn, max: mx, res: '0.25° (≈15 km)' };
}
const G = {
  idx(s, r, c) { r = clamp(r, 0, s.N - 1); c = clamp(c, 0, s.N - 1); return s.grid[r * s.N + c]; },
  rc(s, x, z) { const k = (s.N - 1) / (2 * s.half); return [(z + s.half) * k, (x + s.half) * k]; },
  tri(s, x, z) { // matches the coarse mesh triangulation exactly
    let [r, c] = G.rc(s, x, z); r = clamp(r, 0, s.N - 1.0001); c = clamp(c, 0, s.N - 1.0001);
    const r0 = Math.floor(r), c0 = Math.floor(c), fy = r - r0, fx = c - c0;
    const ha = G.idx(s, r0, c0), hb = G.idx(s, r0 + 1, c0), hc = G.idx(s, r0 + 1, c0 + 1), hd = G.idx(s, r0, c0 + 1);
    return (fx + fy <= 1 ? ha + (hd - ha) * fx + (hb - ha) * fy : hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fy)) * state.ve;
  },
  cubic(s, x, z) {
    const [r, c] = G.rc(s, x, z), r0 = Math.floor(r), c0 = Math.floor(c), fy = r - r0, fx = c - c0;
    const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const row = i => cr(G.idx(s, r0 + i, c0 - 1), G.idx(s, r0 + i, c0), G.idx(s, r0 + i, c0 + 1), G.idx(s, r0 + i, c0 + 2), fx);
    return cr(row(-1), row(0), row(1), row(2), fy) * state.ve;
  },
};
function groundH(x, z) {
  const s = field.site, hc = G.tri(s, x, z), T = field.tile;
  if (!T) return hc;
  const dx = Math.abs(x - T.cx), dz = Math.abs(z - T.cz), m = Math.max(dx, dz);
  if (m >= T.half) return hc;
  const w = 1 - smooth(T.half * 0.62, T.half, m);
  return hc + w * (G.cubic(s, x, z) - hc + detail(x, z));
}
function latLonAt(x, z) { const s = field.site; const lat = s.lat0 + (-z / RM) * R2D; const lon = s.lon0 + (x / (RM * Math.cos(lat * D2R))) * R2D; return [lat, S.mod(lon, 360)]; }
function xzAt(lat, lon) { const s = field.site; let dl = lon - s.lon0; dl = ((dl + 540) % 360) - 180; return [dl * D2R * RM * Math.cos(lat * D2R), -(lat - s.lat0) * D2R * RM]; }
function dataElev(x, z) { return G.tri(field.site, x, z) / state.ve; }

// --- textures
function makeNoiseTex(size, seed, scale) {
  const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d'); const id = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // tileable value noise via wrapping hash
    let v = 0, a = 0.5, f = scale;
    for (let o = 0; o < 5; o++) { const X = x / size * f, Y = y / size * f; const ix = Math.floor(X), iy = Math.floor(Y), fx = X - ix, fy = Y - iy;
      const hh = (i, j) => hash2(((i % f) + f) % f + seed * 131, ((j % f) + f) % f + seed * 71);
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      v += a * (hh(ix, iy) * (1 - ux) * (1 - uy) + hh(ix + 1, iy) * ux * (1 - uy) + hh(ix, iy + 1) * (1 - ux) * uy + hh(ix + 1, iy + 1) * ux * uy); a *= 0.5; f *= 2; }
    const g = clamp(0.62 + v * 0.55, 0, 1) * 255, i = (y * size + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = g; id.data[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = 8; return tx;
}

// --- sky
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, tau: { value: 0.5 }, earth: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vDir = wp.xyz - cameraPosition; gl_Position = projectionMatrix*viewMatrix*wp; gl_Position.z = gl_Position.w*0.99999; }`,
  fragmentShader: `
  uniform vec3 sunDir; uniform float tau; uniform float earth; varying vec3 vDir;
  float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  vec3 marsSky(vec3 d){
    float se = sunDir.y, mu = dot(d,sunDir), h = max(d.y,0.0);
    float day = smoothstep(-0.16,0.18,se);
    vec3 zen = vec3(0.40,0.28,0.20), hor = vec3(0.84,0.63,0.45);
    vec3 col = mix(hor, zen, pow(h,0.5));
    col = mix(col, vec3(0.58,0.40,0.27), clamp((tau-0.6)/3.0,0.0,0.85));
    float low = 1.0 - smoothstep(0.0,0.55,se);
    float halo = pow(max(mu,0.0),5.0)*0.55 + pow(max(mu,0.0),48.0)*0.9;
    col = mix(col, vec3(0.47,0.63,0.86), clamp(halo*(0.3+0.7*low),0.0,0.92)*exp(-max(tau-1.0,0.0)*0.7));
    col *= day*(1.25-0.12*min(tau,4.0)) * mix(1.0, 0.55, clamp((tau-1.5)/3.0,0.0,1.0));
    float tw = smoothstep(-0.32,-0.02,se)*(1.0-smoothstep(-0.02,0.2,se));
    col += vec3(0.30,0.42,0.66)*tw*pow(max(mu,0.0),3.0)*exp(-h*3.0)*0.9;
    return col;
  }
  vec3 earthSky(vec3 d){
    float se = sunDir.y, mu = dot(d,sunDir), h = max(d.y,0.0);
    float day = smoothstep(-0.16,0.18,se);
    vec3 col = mix(vec3(0.66,0.78,0.92), vec3(0.17,0.35,0.76), pow(h,0.45));
    float low = 1.0 - smoothstep(0.0,0.35,se);
    col = mix(col, vec3(1.0,0.55,0.28), low*pow(max(mu,0.0),3.0)*exp(-h*5.0)*0.9);
    col += vec3(1.0,0.95,0.85)*pow(max(mu,0.0),60.0)*0.5;
    return col*day*1.15;
  }
  void main(){
    vec3 d = normalize(vDir);
    vec3 col = mix(marsSky(d), earthSky(d), earth);
    float se = sunDir.y, mu = dot(d,sunDir);
    float trans = exp(-tau*0.45/max(se,0.04));
    col += vec3(1.0,0.96,0.9)*smoothstep(0.99997,0.999988,mu)*2.5*trans*step(-0.02,se);
    col += vec3(1.0,0.85,0.7)*pow(max(mu,0.0),900.0)*0.6*trans;
    float night = 1.0 - smoothstep(-0.2,0.02,se);
    vec3 p = floor(d*420.0); float st = hash(p); float star = step(0.9965, st)*(0.4+0.6*hash(p+3.1));
    col += vec3(star)*night*exp(-tau*0.6)*step(0.0,d.y);
    col += vec3(0.010,0.012,0.02)*night;
    if(d.y<0.0) col *= 0.6;
    col = pow(max(col,vec3(0.0)), vec3(2.2));
    gl_FragColor = vec4(col,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`
});
function skyColorJS(dir, sunDir, tau, earthMix) { // CPU mirror (approx.) for fog/hemisphere colour
  const se = sunDir.y, mu = Math.max(0, dir.x * sunDir.x + dir.y * sunDir.y + dir.z * sunDir.z), h = Math.max(dir.y, 0);
  const day = smooth(-0.16, 0.18, se);
  let c = [lerp(0.84, 0.40, Math.pow(h, 0.5)), lerp(0.63, 0.28, Math.pow(h, 0.5)), lerp(0.45, 0.20, Math.pow(h, 0.5))];
  const dk = clamp((tau - 0.6) / 3, 0, 0.85); c = [lerp(c[0], 0.58, dk), lerp(c[1], 0.40, dk), lerp(c[2], 0.27, dk)];
  const k = day * (1.25 - 0.12 * Math.min(tau, 4)) * lerp(1, 0.55, clamp((tau - 1.5) / 3, 0, 1));
  c = c.map(v => v * k);
  const e = [lerp(0.66, 0.17, Math.pow(h, 0.45)) * day, lerp(0.78, 0.35, Math.pow(h, 0.45)) * day, lerp(0.92, 0.76, Math.pow(h, 0.45)) * day];
  return c.map((v, i) => lerp(v, e[i], earthMix));
}

function buildFieldScene() {
  const sc = field.scene;
  field.sky = new THREE.Mesh(new THREE.SphereGeometry(1e6, 48, 24), skyMat); field.sky.frustumCulled = false; field.sky.renderOrder = -1; sc.add(field.sky);
  sc.fog = new THREE.FogExp2(0xc08a60, 0.00002);
  field.hemi = new THREE.HemisphereLight(0xd09a70, 0x3a2418, 0.6); sc.add(field.hemi);
  field.nightLight = new THREE.AmbientLight(0x8090b0, 0); sc.add(field.nightLight);
  field.sun = new THREE.DirectionalLight(0xfff0dc, 3); field.sun.castShadow = true;
  const sh = field.sun.shadow; sh.camera.left = sh.camera.bottom = -90; sh.camera.right = sh.camera.top = 90; sh.camera.near = 1; sh.camera.far = 2000; sh.bias = -0.0004; sh.normalBias = 0.6;
  sc.add(field.sun); sc.add(field.sun.target);
  field.lamp = new THREE.SpotLight(0xe8f0ff, 0, 60, 0.5, 0.5, 1.2); field.lamp.position.set(0.25, -0.1, 0); field.cam.add(field.lamp); field.cam.add(field.lamp.target); field.lamp.target.position.set(0, -0.3, -5);
  field.detailTex = makeNoiseTex(256, 1, 8); field.detailTex2 = makeNoiseTex(256, 7, 4);
  // dust particles
  const n = 2400, pg = new THREE.BufferGeometry(), pp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pp[i * 3] = (Math.random() - 0.5) * 80; pp[i * 3 + 1] = Math.random() * 30; pp[i * 3 + 2] = (Math.random() - 0.5) * 80; }
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  field.dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xd8a070, size: 0.09, transparent: true, opacity: 0.35, depthWrite: false }));
  field.dust.frustumCulled = false; sc.add(field.dust);
  // rocks (instanced)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: false, map: field.detailTex2, bumpMap: field.detailTex, bumpScale: 2 });
  field.rockSets = [];
  for (let v = 0; v < 4; v++) {
    const g = new THREE.IcosahedronGeometry(1, v < 2 ? 3 : 2); const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      let k = 1 + 0.22 * Math.sin(x * 2.3 + v * 1.7) * Math.cos(y * 2.9 + v) + 0.16 * Math.sin(z * 4.1 + v * 2.3 + x) + 0.07 * Math.sin((x + y + z) * 9 + v);
      if (y > 0.35 + 0.1 * v) k *= 0.9; // flattened, weathered tops
      pa.setXYZ(i, x * k * (1 + v * 0.18), y * k * (0.5 + 0.1 * v), z * k * (1 - v * 0.06)); }
    g.deleteAttribute('normal'); g.deleteAttribute('uv'); const g2 = mergeVerts(g); g2.computeVertexNormals();
    g.computeVertexNormals();
    const im = new THREE.InstancedMesh(g2, rockMat, 2200); im.castShadow = true; im.receiveShadow = true; im.count = 0; im.frustumCulled = false;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2200 * 3), 3);
    sc.add(im); field.rockSets.push(im);
  }
  field.beacons = new THREE.Group(); sc.add(field.beacons);
  field.ghGroup = new THREE.Group(); sc.add(field.ghGroup);
}

function buildCoarseTerrain() {
  const s = field.site, N = s.N, pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
  const L = look(); const step = 2 * s.half / (N - 1);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = r * N + c, h = s.grid[i] * state.ve;
    pos[i * 3] = -s.half + c * step; pos[i * 3 + 1] = h; pos[i * 3 + 2] = -s.half + r * step;
    uv[i * 2] = c * step / 600; uv[i * 2 + 1] = r * step / 600;
  }
  const idx = [];
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) { const a = r * N + c, b = (r + 1) * N + c, cc = (r + 1) * N + c + 1, d = r * N + c + 1; idx.push(a, b, d, b, cc, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const nrm = g.attributes.normal;
  for (let i = 0; i < N * N; i++) colorFor(L, pos[i * 3], pos[i * 3 + 1] / state.ve, pos[i * 3 + 2], nrm.getY(i), col, i, s);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, map: field.detailTex });
  m.onBeforeCompile = sh => {
    sh.uniforms.tileC = field.U.tileC; sh.uniforms.tileH = field.U.tileH;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix*vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform vec2 tileC; uniform float tileH;').replace('void main() {', 'void main() {\n if(abs(vWp.x-tileC.x)<tileH && abs(vWp.z-tileC.y)<tileH) discard;');
  };
  if (field.coarse) { field.scene.remove(field.coarse); field.coarse.geometry.dispose(); field.coarse.material.dispose(); }
  field.coarse = new THREE.Mesh(g, m); field.coarse.receiveShadow = false; field.scene.add(field.coarse);
  buildMinimapImage();
}
function colorFor(L, x, hData, z, ny, col, i, s) {
  const slope = 1 - clamp(ny, 0, 1);
  const n1 = vnoise(x / 3000, z / 3000) * 0.5 + vnoise(x / 700, z / 700) * 0.3;
  let t = clamp(slope * 4.5 + n1 * 0.25, 0, 1);
  let r = lerp(L.dust[0], L.rock[0], t), g = lerp(L.dust[1], L.rock[1], t), b = lerp(L.dust[2], L.rock[2], t);
  if (L.bands) { const band = 0.5 + 0.5 * Math.sin(hData / 140 + n1 * 2); const k = slope > 0.08 ? 0.18 : 0.04; r += (band - 0.5) * k; g += (band - 0.5) * k * 0.8; b += (band - 0.5) * k * 0.6; }
  const v = 0.92 + 0.16 * n1; col[i * 3] = Math.pow(clamp(r * v, 0, 1), 2.2); col[i * 3 + 1] = Math.pow(clamp(g * v, 0, 1), 2.2); col[i * 3 + 2] = Math.pow(clamp(b * v, 0, 1), 2.2);
}

function buildTile(cx, cz) {
  const s = field.site, q = state.quality, seg = q === 'high' ? 200 : q === 'med' ? 150 : 100, half = 800;
  const n = seg + 1, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), col = new Float32Array(n * n * 3);
  field.tile = { cx, cz, half };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c, x = cx - half + c / seg * 2 * half, z = cz - half + r / seg * 2 * half;
    pos[i * 3] = x; pos[i * 3 + 1] = groundH(x, z); pos[i * 3 + 2] = z; uv[i * 2] = x / 7; uv[i * 2 + 1] = z / 7;
  }
  const idx = []; for (let r = 0; r < seg; r++) for (let c = 0; c < seg; c++) { const a = r * n + c, b = (r + 1) * n + c, cc = (r + 1) * n + c + 1, d = r * n + c + 1; idx.push(a, b, d, b, cc, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const L = look(), nrm = g.attributes.normal;
  for (let i = 0; i < n * n; i++) { colorFor(L, pos[i * 3], pos[i * 3 + 1] / state.ve, pos[i * 3 + 2], nrm.getY(i), col, i, s); const sp = 0.94 + 0.12 * vnoise(pos[i * 3] / 4, pos[i * 3 + 2] / 4); col[i * 3] *= sp; col[i * 3 + 1] *= sp; col[i * 3 + 2] *= sp; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!field.tileMat) field.tileMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, map: field.detailTex, bumpMap: field.detailTex2, bumpScale: 1.2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  if (field.tileMesh) { field.scene.remove(field.tileMesh); field.tileMesh.geometry.dispose(); }
  field.tileMesh = new THREE.Mesh(g, field.tileMat); field.tileMesh.receiveShadow = true; field.scene.add(field.tileMesh);
  field.U.tileC.value.set(cx, cz); field.U.tileH.value = half - 2 * (2 * half / seg);
  scatterRocks(cx, cz);
}
function scatterRocks(cx, cz) {
  const L = look(), max = state.quality === 'high' ? 2000 : state.quality === 'med' ? 1100 : 450, cell = 4.5, R = 330;
  const counts = [0, 0, 0, 0], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), cl = new THREE.Color();
  const c0x = Math.floor((cx - R) / cell), c1x = Math.floor((cx + R) / cell), c0z = Math.floor((cz - R) / cell), c1z = Math.floor((cz + R) / cell);
  let total = 0;
  outer: for (let ix = c0x; ix <= c1x; ix++) for (let iz = c0z; iz <= c1z; iz++) {
    const hsh = hash2(ix * 3 + 11, iz * 5 + 7);
    const dens = L.rocks * (0.6 + 0.8 * (vnoise(ix * cell / 90, iz * cell / 90) * 0.5 + 0.5));
    if (hsh > dens) continue;
    const x = (ix + hash2(ix, iz + 99)) * cell, z = (iz + hash2(ix + 77, iz)) * cell;
    if ((x - cx) ** 2 + (z - cz) ** 2 > R * R) continue;
    const sz = 0.07 + 1.5 * Math.pow(hash2(ix + 5, iz + 9), 7) + 0.12 * hash2(ix + 1, iz + 2);
    const v = Math.floor(hash2(ix + 13, iz + 3) * 4);
    const im = field.rockSets[v]; if (counts[v] >= 2200) continue;
    e.set((hash2(ix, iz + 1) - 0.5) * 0.6, hash2(ix + 2, iz) * 6.28, (hash2(ix + 3, iz) - 0.5) * 0.6); q.setFromEuler(e);
    p.set(x, groundH(x, z) + sz * 0.15, z); sc.set(sz, sz, sz); m4.compose(p, q, sc); im.setMatrixAt(counts[v], m4);
    const k = 0.75 + 0.5 * hash2(ix + 8, iz + 8); cl.setRGB(clamp(L.rock[0] * k * 1.25, 0, 1), clamp(L.rock[1] * k * 1.2, 0, 1), clamp(L.rock[2] * k * 1.15, 0, 1), THREE.SRGBColorSpace);
    im.setColorAt(counts[v], cl); counts[v]++; total++;
    if (total >= max) break outer;
  }
  field.rockSets.forEach((im, i) => { im.count = counts[i]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
}

async function enterSite() {
  const key = state.custom ? 'custom' : state.siteKey;
  const sigKey = state.custom ? 'custom:' + state.custom.lat.toFixed(2) + ',' + state.custom.lon.toFixed(2) : key;
  if (field.loadedSig === sigKey && field.loadedVe === state.ve) return;
  const s = state.custom ? makeCustomSite(state.custom.lat, state.custom.lon) : await loadSite(key);
  field.site = s; field.loadedSig = sigKey; field.loadedVe = state.ve; field.tile = null;
  buildCoarseTerrain();
  // start position
  let start = [s.lat0, s.lon0];
  if (!state.custom && SITES[key].landing) start = SITES[key].landing;
  if (key === 'olympus') start = [18.3, 227.45];
  if (key === 'valles') start = [-7.5, 288.6];
  const [x, z] = xzAt(start[0], start[1]); player.x = x; player.z = z;
  buildTile(Math.round(x / 50) * 50, Math.round(z / 50) * 50);
  player.y = groundH(x, z); player.vy = 0; player.yaw = key === 'gale' ? Math.PI * 0.82 : key === 'olympus' ? Math.PI * 0.5 : key === 'valles' ? Math.PI : 0.6; player.pitch = key === 'olympus' ? -0.42 : key === 'valles' ? -0.18 : -0.04;
  if (key === 'olympus' || key === 'valles') { setMove('drone'); player.y += key === 'olympus' ? 7000 : 1800; }
  else setMove('walk');
  buildBeacons(); rebuildGreenhouses();
  const ltst = currentLtst();
  if (state.timeMode === 'live' && (sunNow().el < -2)) toast(t('night_toast', { site: state.custom ? t('custom_site') : siteName(key), time: S.fmtClock(ltst) }) + ` <button class="btn sm" id="to-day">${t('noon')}</button>`, 9000), setTimeout(() => { const b = $('#to-day'); if (b) b.onclick = () => { $('#timesel').value = '12.5'; $('#timesel').onchange(); $('#toast').style.display = 'none'; }; }, 50);
  else toast(t('arrived', { site: state.custom ? t('custom_site') : siteName(key) }));
}
function poisForSite() { if (state.custom || !field.site) return []; return SITES[field.site.key].pois; }
function buildBeacons() {
  field.beacons.clear(); $('#poi-labels').innerHTML = ''; field.poiEls = [];
  for (const p of poisForSite()) {
    const [x, z] = xzAt(p.lat, p.lon); const y = G.tri(field.site, x, z);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x8fbccb, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.set(x, y, z); beam.userData = { p, x, z, y }; field.beacons.add(beam);
    const el = document.createElement('div'); el.className = 'poi-label'; $('#poi-labels').appendChild(el); field.poiEls.push({ el, p, x, z, y, beam });
  }
}
function rebuildGreenhouses() {
  field.ghGroup.clear();
  for (const gh of state.greenhouses) if (gh.sig === field.loadedSig) addGreenhouseModel(gh.x, gh.z, gh.yaw);
}
function addGreenhouseModel(x, z, yaw) {
  const gr = new THREE.Group(); const y = groundH(x, z);
  const berm = new THREE.Mesh(new THREE.TorusGeometry(6, 1.6, 10, 40), new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 1, map: field.detailTex })); berm.rotation.x = Math.PI / 2; berm.scale.z = 0.5; berm.receiveShadow = berm.castShadow = true; gr.add(berm);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, roughness: 0.08, transmission: 0.6, transparent: true, opacity: 0.42, metalness: 0.1 })); dome.scale.y = 0.35; gr.add(dome);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(4.6, 32), new THREE.MeshBasicMaterial({ color: 0xd06ad8, transparent: true, opacity: 0.55 })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.05; gr.add(glow);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.3, 3.2), new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.6, metalness: 0.2 })); lock.position.set(7.4, 1.0, 0); lock.castShadow = true; gr.add(lock);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.12, 8, 48), new THREE.MeshStandardMaterial({ color: 0x9a9690, metalness: 0.6, roughness: 0.4 })); ring.rotation.x = Math.PI / 2; gr.add(ring);
  gr.position.set(x, y - 0.2, z); gr.rotation.y = yaw; field.ghGroup.add(gr);
}

// --- sun / time
function currentLtst() {
  if (state.timeMode === 'live') { const s = field.site || { lon0: SITES[state.siteKey].lon }; return S.localTimes(S.marsTime(Date.now()), s.lon0).ltst; }
  if (state.timeMode === 'lapse') return state.lapseLtst;
  return state.manualLtst;
}
function siteLat() { return field.site ? field.site.lat0 : SITES[state.siteKey].lat; }
function sunNow() { const mt = S.marsTime(Date.now()); return S.sunENU(siteLat(), mt.decl, currentLtst()); }
function effTau() { if (state.whatIf.active) return state.whatIf.curTau ?? state.whatIf.tau; return field.tauCur ?? 0.5; }
function earthMix() { if (!state.whatIf.active) return 0; return atmoSkyMix(state.whatIf.curP ?? state.whatIf.P, effTau()); }
function atmoSkyMix(Pmbar, tau) { return clamp((1 - Math.exp(-(Pmbar - 6) / 260)) * Math.exp(-0.75 * Math.max(tau - 0.25, 0)), 0, 1); }

function updateEnvironment(dt) {
  const sun = sunNow(), mt = S.marsTime(Date.now());
  const target = state.dustStorm ? 4.0 : 0.5; field.tauCur = lerp(field.tauCur ?? 0.5, target, 1 - Math.exp(-dt * 0.5));
  const tau = effTau(), em = earthMix();
  const sd = new THREE.Vector3(sun.E, sun.U, -sun.N).normalize();
  skyMat.uniforms.sunDir.value.copy(sd); skyMat.uniforms.tau.value = tau; skyMat.uniforms.earth.value = em;
  const sinEl = Math.max(sun.U, 0);
  const trans = Math.exp(-0.38 * tau / Math.max(sinEl, 0.06));
  const day = smooth(-0.05, 0.12, sun.U);
  field.sun.intensity = 3.6 * (mt.toa / 590) * day * trans * (1 + em * 0.4);
  const warm = clamp(1 - sinEl * 1.6, 0, 1);
  field.sun.color.setRGB(1, lerp(0.95, 0.78, warm), lerp(0.88, 0.62, warm));
  const p = new THREE.Vector3(player.x, player.y, player.z);
  field.sun.position.copy(p).addScaledVector(sd, 800); field.sun.target.position.copy(p);
  const hor = skyColorJS({ x: -sd.x * 0.7, y: 0.05, z: -sd.z * 0.7 }, sd, tau, em);
  const zen = skyColorJS({ x: 0, y: 1, z: 0 }, sd, tau, em);
  const nightAmb = 0.07 + (state.dustStorm ? 0 : 0.02);
  field.hemi.color.setRGB(Math.min(1, zen[0] + nightAmb), Math.min(1, zen[1] + nightAmb), Math.min(1, zen[2] + nightAmb * 1.5), THREE.SRGBColorSpace);
  field.hemi.groundColor.setRGB(0.42 * day + 0.06, 0.28 * day + 0.045, 0.2 * day + 0.04, THREE.SRGBColorSpace);
  field.hemi.intensity = 0.9 + 1.3 * day * clamp(tau / 2.5, 0.25, 1.2);
  field.nightLight.intensity = 0.32 * (1 - smooth(-0.15, 0.05, sun.U)) * Math.exp(-tau * 0.3);
  field.scene.fog.color.setRGB(clamp(hor[0], 0.03, 1), clamp(hor[1], 0.025, 1), clamp(hor[2], 0.025, 1), THREE.SRGBColorSpace);
  const visM = Math.min(S.visibilityKm(tau) * 1000 * (1 + em * 3), field.site.half * 1.4);
  const altAbove = Math.max(0, player.y - (field.site.min * state.ve));
  field.scene.fog.density = (1.6 / visM) * Math.exp(-altAbove / 11100 * 0.9);
  renderer.toneMappingExposure = lerp(1.0, 1.5, 1 - day) * (state.dustStorm ? 1.15 : 1);
  field.dust.material.opacity = clamp(0.12 + tau * 0.12, 0, 0.75); field.dust.material.color.setRGB(clamp(hor[0] * 1.1 + 0.15, 0, 1), clamp(hor[1] * 1.1 + 0.1, 0, 1), clamp(hor[2] * 1.1 + 0.06, 0, 1), THREE.SRGBColorSpace);
  field.dust.material.size = state.dustStorm ? 0.16 : 0.08;
  // beacons scale with distance
  for (const b of field.beacons.children) { const d = Math.hypot(b.userData.x - player.x, b.userData.z - player.z); const w = Math.max(0.6, d * 0.0015), h = Math.max(300, d * 0.25); b.scale.set(w, h, w); b.position.y = b.userData.y + h / 2; b.visible = d > 80; }
  field.cur = { sun, mt, tau, em, ltst: currentLtst() };
}

// --- controls
function setMove(m) { player.move = m; $$('#moveseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.move === m)); player.eye = m === 'rover' ? 2.3 : 1.7; }
let pointerLocked = false;
canvas.addEventListener('click', () => { startAudio(); if (state.view === 'field' && !renderer.xr.isPresenting) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } } });
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', e => { if (!pointerLocked || state.view !== 'field') return; player.yaw -= e.movementX * 0.0022 * state.sens; player.pitch = clamp(player.pitch - e.movementY * 0.0022 * state.sens, -1.45, 1.45); });
let drag = null;
canvas.addEventListener('pointerdown', e => { if (state.view === 'field' && !pointerLocked) drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => drag = null);
addEventListener('pointermove', e => { if (!drag || state.view !== 'field') return; player.yaw -= (e.clientX - drag[0]) * 0.004 * state.sens; player.pitch = clamp(player.pitch - (e.clientY - drag[1]) * 0.004 * state.sens, -1.45, 1.45); drag = [e.clientX, e.clientY]; });
addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  keys[e.code] = true;
  if (state.view !== 'field') return;
  if (e.code === 'KeyE') collectSample();
  if (e.code === 'KeyG') placeGreenhouse();
  if (e.code === 'KeyL') { field.lamp.intensity = field.lamp.intensity ? 0 : 60; caption(t(field.lamp.intensity ? 'cap_lamp_on' : 'cap_lamp_off')); }
  if (e.code === 'KeyM') openMap();
  if (e.code === 'Digit1') setMove('walk'); if (e.code === 'Digit2') setMove('rover'); if (e.code === 'Digit3') setMove('drone');
  if (e.code === 'Space' && player.move !== 'drone' && player.onGround) { player.vy = 2.3; player.onGround = false; caption(t('cap_jump')); }
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
const touchHold = { f: 0, b: 0 };
['t-fwd', 't-back'].forEach(id => { const el = $('#' + id); const k = id === 't-fwd' ? 'f' : 'b'; el.addEventListener('pointerdown', e => { e.preventDefault(); touchHold[k] = 1; }); el.addEventListener('pointerup', () => touchHold[k] = 0); el.addEventListener('pointerleave', () => touchHold[k] = 0); });
if ('ontouchstart' in window) document.body.classList.add('has-touch');

function updatePlayer(dt) {
  let fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touchHold.f - touchHold.b;
  let str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const xr = vrInput(); fwd += xr.f; str += xr.s;
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const ground = groundH(player.x, player.z);
  let spd;
  if (player.move === 'walk') spd = sprint ? 6 : 1.6;
  else if (player.move === 'rover') spd = sprint ? 60 : 18;
  else { const alt = Math.max(5, player.y - ground); spd = Math.max(12, alt * 0.7) * (sprint ? 4 : 1); }
  const dir = renderer.xr.isPresenting ? xrYaw() : player.yaw;
  const len = Math.hypot(fwd, str) || 1;
  const vx = (-Math.sin(dir) * fwd + Math.cos(dir) * str) / len * spd, vz = (-Math.cos(dir) * fwd - Math.sin(dir) * str) / len * spd;
  player.x = clamp(player.x + vx * dt, -field.site.half * 0.995, field.site.half * 0.995);
  player.z = clamp(player.z + vz * dt, -field.site.half * 0.995, field.site.half * 0.995);
  player.speed = Math.hypot(vx, vz) * (fwd || str ? 1 : 0);
  const g2 = groundH(player.x, player.z);
  if (player.move === 'drone') {
    const up = (keys.Space || keys.KeyR ? 1 : 0) - (keys.KeyC || keys.ControlLeft || keys.KeyF ? 1 : 0);
    const alt = Math.max(5, player.y - g2);
    player.y += up * Math.max(20, alt * 0.9) * (sprint ? 3 : 1) * dt;
    player.y = Math.max(player.y, g2 + 2); player.onGround = false;
  } else {
    player.vy -= 3.721 * dt; player.y += player.vy * dt;   // Mars surface gravity 3.721 m/s²
    if (player.y <= g2) { player.y = g2; player.vy = 0; player.onGround = true; }
    if (player.onGround && player.speed > 0.3) { player.steps += dt * (player.move === 'walk' ? (sprint ? 2.6 : 1.7) : 0); if (player.steps > 1) { player.steps = 0; footstep(); } }
  }
  // move detail tile when far from its centre
  const T = field.tile; if (T && (Math.abs(player.x - T.cx) > 260 || Math.abs(player.z - T.cz) > 260) && player.y - g2 < 1500) buildTile(Math.round(player.x / 50) * 50, Math.round(player.z / 50) * 50);
  // camera
  if (renderer.xr.isPresenting) { field.rig.position.set(player.x, player.y, player.z); field.cam.position.set(0, 0, 0); }
  else {
    field.rig.position.set(player.x, player.y + player.eye, player.z); field.rig.rotation.set(0, 0, 0);
    field.cam.position.set(0, 0, 0); field.cam.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    if (player.move === 'walk' && player.speed > 0.3 && player.onGround && !state.rm) field.cam.position.y = Math.sin(performance.now() / 180) * 0.025;
  }
  field.sky.position.copy(field.rig.position);
  // dust particles drift and wrap around the camera
  const pa = field.dust.geometry.attributes.position, wind = state.dustStorm ? 14 : 3;
  for (let i = 0; i < pa.count; i++) {
    let x = pa.getX(i) + wind * dt, y = pa.getY(i) + Math.sin(i + performance.now() / 900) * 0.2 * dt, z = pa.getZ(i) + wind * 0.4 * dt;
    if (x - player.x > 40) x -= 80; if (x - player.x < -40) x += 80; if (z - player.z > 40) z -= 80; if (z - player.z < -40) z += 80;
    if (Math.abs(y - player.y) > 30) y = player.y + (Math.random() - 0.3) * 20;
    pa.setXYZ(i, x, y, z);
  }
  pa.needsUpdate = true;
  checkDiscovery();
}

// --- VR (WebXR)
let xrSession = null;
async function setupVR() {
  const slot = $('#vr-slot'); const b = document.createElement('button'); b.className = 'btn'; b.textContent = t('enter_vr'); slot.appendChild(b);
  let ok = false; try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch (e) { ok = false; }
  if (!ok) { b.disabled = true; b.title = t('vr_unavailable'); b.onclick = null; return; }
  b.onclick = async () => {
    if (xrSession) { xrSession.end(); return; }
    try {
      xrSession = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      renderer.xr.setReferenceSpaceType('local-floor'); await renderer.xr.setSession(xrSession); b.textContent = t('exit_vr');
      buildVRPanel();
      xrSession.addEventListener('end', () => { xrSession = null; b.textContent = t('enter_vr'); if (field.vrPanel) field.cam.remove(field.vrPanel); });
    } catch (e) { toast(t('vr_unavailable')); }
  };
}
let snapCool = 0;
function vrInput() {
  const out = { f: 0, s: 0 }; if (!renderer.xr.isPresenting) return out;
  const ss = renderer.xr.getSession(); if (!ss) return out;
  for (const src of ss.inputSources) { const gp = src.gamepad; if (!gp || gp.axes.length < 4) continue;
    if (src.handedness === 'left') { out.f = -gp.axes[3]; out.s = gp.axes[2]; if (Math.abs(out.f) < 0.15) out.f = 0; if (Math.abs(out.s) < 0.15) out.s = 0; }
    if (src.handedness === 'right') { const ax = gp.axes[2]; snapCool -= 1 / 72; if (Math.abs(ax) > 0.7 && snapCool <= 0) { field.rig.rotation.y -= Math.sign(ax) * Math.PI / 6; snapCool = 0.35; } if (gp.buttons[0] && gp.buttons[0].pressed && !src._pressed) { collectSample(); } src._pressed = gp.buttons[0] && gp.buttons[0].pressed; }
  }
  return out;
}
function xrYaw() { const d = new THREE.Vector3(); renderer.xr.getCamera().getWorldDirection(d); return Math.atan2(-d.x, -d.z); }
function buildVRPanel() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; field.vrCanvas = c;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  field.vrPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  field.vrPanel.position.set(0, -0.32, -0.75); field.vrPanel.rotation.x = -0.4; field.vrPanel.renderOrder = 10; field.cam.add(field.vrPanel);
}
function updateVRPanel() {
  if (!field.vrPanel || !field.hudCache) return; const c = field.vrCanvas, x = c.getContext('2d');
  x.clearRect(0, 0, 512, 256); x.fillStyle = 'rgba(10,9,8,0.72)'; x.fillRect(0, 0, 512, 256); x.fillStyle = '#ece4dc'; x.font = '22px monospace';
  field.hudCache.forEach((l, i) => x.fillText(l, 16, 34 + i * 30)); field.vrPanel.material.map.needsUpdate = true;
}

// --- audio
let AC = null, audio = {};
function startAudio() {
  if (AC || !state.snd) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const len = AC.sampleRate * 4, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
    const wg = AC.createGain(); wg.gain.value = 0.0;
    const marsLP = AC.createBiquadFilter(); marsLP.type = 'lowpass'; marsLP.frequency.value = state.ac ? 900 : 12000;
    const master = AC.createGain(); master.gain.value = 0.7;
    src.connect(bp).connect(wg).connect(marsLP).connect(master).connect(AC.destination); src.start();
    audio = { wg, bp, marsLP, master, buf };
  } catch (e) { AC = null; }
}
let gustT = 0, gustCapT = 0;
function updateAudio(dt) {
  if (!AC) return;
  const inField = state.view === 'field' && state.snd;
  gustT -= dt; if (gustT <= 0) { gustT = 0.6 + Math.random() * 1.8; const storm = state.dustStorm ? 1 : 0; const g = (0.05 + Math.random() * 0.12 + storm * 0.25) * (inField ? 1 : 0);
    audio.wg.gain.setTargetAtTime(g, AC.currentTime, 0.5); audio.bp.frequency.setTargetAtTime(300 + Math.random() * 400 + storm * 300, AC.currentTime, 0.6);
    if (inField && g > 0.13 && performance.now() - gustCapT > 9000) { gustCapT = performance.now(); caption(t(state.dustStorm ? 'cap_storm' : 'cap_wind')); } }
  audio.marsLP.frequency.setTargetAtTime(state.ac ? 900 : 12000, AC.currentTime, 0.2);
  audio.master.gain.setTargetAtTime(state.snd ? 0.7 : 0, AC.currentTime, 0.2);
}
let stepCapT = 0;
function footstep() {
  if (AC && state.snd) {
    const s = AC.createBufferSource(); s.buffer = audio.buf; const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + Math.random() * 300; const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.5, AC.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + 0.16);
    s.connect(f).connect(g).connect(audio.marsLP); s.start(AC.currentTime, Math.random() * 3, 0.2);
  }
  if (performance.now() - stepCapT > 15000) { stepCapT = performance.now(); caption(t('cap_steps')); }
}
function narrate(text) {
  caption(text, Math.max(5000, text.length * 70));
  try { if (!state.snd || !window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = I18N.LANGS[state.lang].bcp; u.rate = 0.98; speechSynthesis.speak(u); } catch (e) { }
}

// --- interactions: samples, greenhouse, discovery
function checkDiscovery() {
  if (!field.site || state.custom) return;
  const rad = Math.max(300, field.site.half * 0.012);
  for (const pe of field.poiEls || []) {
    const d = Math.hypot(pe.x - player.x, pe.z - player.z);
    if (d < rad && !state.discovered[pe.p.id]) {
      state.discovered[pe.p.id] = { t: Date.now(), site: field.site.key }; saveProgress();
      toast(`<b>${t('discovered')}:</b> ${esc(pe.p.name)}<br><span class="muted">${esc(pe.p.info)}</span>`, 7000); renderMission();
    }
  }
}
function collectSample() {
  if (state.view !== 'field' || !field.site) return;
  const g = groundH(player.x, player.z);
  if (player.y - g > 3) { toast(t('land_first')); return; }
  const key = state.custom ? null : field.site.key, [lat, lon] = latLonAt(player.x, player.z), elev = dataElev(player.x, player.z);
  let type;
  if (!key) type = { name: 'Regolith (unsurveyed location)', minerals: 'Unknown — no in-situ data', analogue: true };
  else {
    const list = SITES[key].samples; const rnd = Math.random();
    if (key === 'gale') type = elev < -4000 ? (rnd < 0.65 ? list[0] : list[1]) : elev > -3200 ? list[2] : list[1];
    else if (key === 'jezero') { const [dx, dz] = xzAt(18.51, 77.40); type = Math.hypot(dx - player.x, dz - player.z) < 7000 ? list[2] : (rnd < 0.5 ? list[0] : list[1]); }
    else type = list[0];
  }
  const id = 'S' + String(state.samples.length + 1).padStart(3, '0');
  const mt = S.marsTime(Date.now());
  state.samples.push({ id, site: key || 'custom', siteLabel: key ? siteName(key) : t('custom_site'), type: type.name, minerals: type.minerals, measured: type.measured || null, lat, lon, elev, ltst: currentLtst(), msd: mt.msd, t: Date.now() });
  saveProgress(); renderMission();
  toast(`<b>${t('sample_collected')} ${id}</b> — ${esc(type.name)}<br><span class="muted mono">${fmtLat(lat)} ${fmtLon(lon)} · ${fmt(elev, 0)} m</span>`);
  caption(t('cap_sample'));
}
function placeGreenhouse() {
  if (state.view !== 'field' || !field.site) return;
  const g = groundH(player.x, player.z); if (player.y - g > 3) { toast(t('land_first')); return; }
  const x = player.x - Math.sin(player.yaw) * 16, z = player.z - Math.cos(player.yaw) * 16;
  const [lat, lon] = latLonAt(x, z), elev = dataElev(x, z);
  const gh = { id: 'GH' + (state.greenhouses.length + 1), sig: field.loadedSig, site: state.custom ? 'custom' : field.site.key, x, z, yaw: player.yaw, lat, lon, elev, pModel: S.pressureModel(elev) };
  state.greenhouses.push(gh); saveProgress(); addGreenhouseModel(x, z, player.yaw); renderMission();
  toast(`<b>${t('gh_placed')}</b> ${gh.id} · ${fmtLat(lat)} ${fmtLon(lon)}<br><span class="muted">${t('gh_placed_note')}</span> <button class="btn sm" id="gh-open">${t('nav_gh')}</button>`, 8000);
  setTimeout(() => { const b = $('#gh-open'); if (b) b.onclick = () => go('gh'); }, 30);
}

// --- HUD
function updateHUD() {
  if (!field.cur || !field.site) return;
  const { sun, mt, tau, ltst } = field.cur; const s = field.site, key = state.custom ? null : s.key;
  const elev = dataElev(player.x, player.z), [lat, lon] = latLonAt(player.x, player.z), g = groundH(player.x, player.z);
  const range = key ? SITES[key].tempSim : [-90, -20];
  const temp = S.simTemp(range, ltst) - (state.dustStorm ? -6 * Math.sin(Math.PI * ((ltst + 18) % 24) / 24) : 0);
  const timeSt = state.timeMode === 'live' ? 'COMPUTED' : 'SIMULATED';
  const row = (k, v, st) => `<span class="hud-k">${esc(k)}</span><span class="hud-v">${v} ${st ? `<span class="st st-${st}" style="font-size:.55rem;padding:0 5px" title="${esc(t('st_' + st + '_d'))}">${t('st_' + st).slice(0, 4)}</span>` : ''}</span>`;
  $('#hl-title').textContent = t('environment');
  $('#hud-env').innerHTML = [
    row(t('ltst'), S.fmtClock(ltst), timeSt), row('MSD', fmt(mt.msd, 2), 'COMPUTED'), row('Ls', fmt(mt.Ls, 1) + '°', 'COMPUTED'),
    row(t('sun_el'), fmt(sun.el, 1) + '°', timeSt), row(t('temperature'), fmt(temp, 0) + ' °C', 'SIMULATED'),
    row(t('pressure'), fmt(S.pressureModel(elev), 0) + ' Pa', 'MODELLED'), row(t('dust'), 'τ ' + fmt(tau, 2), state.whatIf.active ? 'WHATIF' : 'SIMULATED'),
    row(t('visibility'), fmt(S.visibilityKm(tau), 0) + ' km', 'MODELLED'), row(t('radiation'), '0.67 mSv/d', 'REFERENCE'),
  ].join('');
  const near = nearestPOI();
  $('#hud-loc').innerHTML = [
    row(t('latitude'), fmtLat(lat)), row(t('longitude'), fmtLon(lon)),
    row(t('elevation'), fmt(elev, 0) + ' m', 'COMPUTED'), row(t('heading'), fmt(S.mod(-player.yaw * R2D, 360), 0) + '°'),
    row(t('speed'), fmt(player.speed, 1) + ' m/s'), row(t('altitude_agl'), fmt(player.y - g, 0) + ' m'),
    near ? row(esc(near.p.name.split('(')[0].trim()), fmt(near.d / 1000, 2) + ' km') : '',
  ].join('');
  $('#help-keys').innerHTML = `<kbd>WASD</kbd> ${t('k_move')} · <kbd>Shift</kbd> ${t('k_boost')} · <kbd>Space</kbd> ${t('k_jump')} · <kbd>E</kbd> ${t('k_sample')} · <kbd>G</kbd> ${t('k_gh')} · <kbd>L</kbd> ${t('k_lamp')} · <kbd>M</kbd> ${t('k_map')} · <kbd>1-3</kbd> ${t('k_modes')}<br><span class="muted">${t('terrain_src')}: MOLA ${esc(s.res)} + ${t('procedural_detail')}${state.ve > 1 ? ' · ' + state.ve + '× ' + t('vexag_short') : ''}</span>`;
  $('#whatif-flag').style.display = state.whatIf.active ? 'block' : 'none';
  // compass strip
  const hdg = S.mod(-player.yaw * R2D, 360), px = 4; let html = '';
  for (let a = -180; a <= 540; a += 15) { const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N', 450: 'E', '-90': 'W', '-180': 'S', 540: 'S' }[a] || (a % 45 === 0 ? String(S.mod(a, 360)) : '·'); html += `<span style="position:absolute;left:${(a + 180) * px}px;transform:translateX(-50%);${/[NESW]/.test(lab) ? 'color:var(--accent);font-weight:600' : ''}">${lab}</span>`; }
  const strip = $('#compass-strip'); strip.innerHTML = html; strip.style.left = (($('#compass').clientWidth / 2) - (hdg + 180) * px) + 'px';
  // prompt
  $('#prompt').style.display = (player.move !== 'drone' && player.y - g < 3) ? 'block' : 'none'; $('#prompt').innerHTML = `<kbd>E</kbd> ${t('k_sample')}`;
  field.hudCache = [`${key ? siteName(key) : t('custom_site')}`, `${fmtLat(lat)} ${fmtLon(lon)}  ${fmt(elev, 0)} m`, `LTST ${S.fmtClock(ltst)}  Sun ${fmt(sun.el, 0)}°`, `P ${fmt(S.pressureModel(elev), 0)} Pa (model)  T ${fmt(temp, 0)}°C (sim)`, `Samples ${state.samples.length}  [trigger] collect`];
  updateVRPanel();
}
function nearestPOI() { let best = null; for (const pe of field.poiEls || []) { const d = Math.hypot(pe.x - player.x, pe.z - player.z); if (!best || d < best.d) best = { p: pe.p, d }; } return best; }
function updatePOILabels() {
  const cam = field.cam; const v = new THREE.Vector3();
  for (const pe of field.poiEls || []) {
    v.set(pe.x, pe.y + 60, pe.z); v.project(cam); const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    pe.el.style.display = vis ? 'block' : 'none';
    if (vis) { pe.el.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; pe.el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px'; const d = Math.hypot(pe.x - player.x, pe.z - player.z); pe.el.textContent = `${pe.p.name} · ${(d / 1000).toFixed(1)} km`; pe.el.classList.toggle('found', !!state.discovered[pe.p.id]); }
  }
}
function renderMission() {
  const disc = Object.keys(state.discovered).length, sites = new Set(state.samples.map(s => s.site)).size;
  const items = [[t('ob_discover', { n: 3 }), disc >= 3, `${Math.min(disc, 3)}/3`], [t('ob_samples', { n: 3 }), state.samples.length >= 3 && sites >= 2, `${state.samples.length}/3 · ${sites}/2`], [t('ob_gh'), state.greenhouses.length > 0, ''], [t('ob_lab'), Object.keys(state.labAnalysed).length >= 2, `${Object.keys(state.labAnalysed).length}/2`]];
  $('#mission').innerHTML = `<div class="hud-k">${t('mission_a')}</div><ul>${items.map(([l, ok, p]) => `<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${esc(l)} <span class="mono muted">${p}</span></li>`).join('')}</ul>`;
}
// minimap
function buildMinimapImage() {
  const s = field.site, N = s.N, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), id = x.createImageData(N, N);
  const rng = Math.max(1, s.max - s.min);
  for (let r = 0; r < N; r++) for (let cc = 0; cc < N; cc++) {
    const h = s.grid[r * N + cc], hx = G.idx(s, r, cc + 1) - G.idx(s, r, cc - 1), hy = G.idx(s, r + 1, cc) - G.idx(s, r - 1, cc);
    const cell = 2 * s.half / (N - 1); const sh = clamp(0.6 + (-hx + hy) / (cell * 2) * 6, 0.15, 1.3);
    const t1 = (h - s.min) / rng; const i = (r * N + cc) * 4;
    id.data[i] = (70 + 150 * t1) * sh; id.data[i + 1] = (40 + 95 * t1) * sh; id.data[i + 2] = (28 + 70 * t1) * sh; id.data[i + 3] = 255;
  }
  x.putImageData(id, 0, 0); field.mmImg = c;
}
function drawMap(cv, big) {
  if (!field.mmImg) return; const x = cv.getContext('2d'), W = cv.width, s = field.site;
  x.imageSmoothingEnabled = true; x.drawImage(field.mmImg, 0, 0, W, W);
  const toPx = (px, pz) => [(px + s.half) / (2 * s.half) * W, (pz + s.half) / (2 * s.half) * W];
  for (const pe of field.poiEls || []) { const [a, b] = toPx(pe.x, pe.z); x.fillStyle = state.discovered[pe.p.id] ? '#79c495' : '#8fbccb'; x.beginPath(); x.arc(a, b, big ? 6 : 3.5, 0, 7); x.fill(); if (big) { x.font = '13px Inter,sans-serif'; x.fillStyle = '#fff'; x.fillText(pe.p.name, a + 9, b + 4); } }
  for (const gh of state.greenhouses) if (gh.sig === field.loadedSig) { const [a, b] = toPx(gh.x, gh.z); x.fillStyle = '#d06ad8'; x.fillRect(a - 3, b - 3, 6, 6); }
  for (const sm of state.samples) { if ((sm.site === (state.custom ? 'custom' : s.key))) { const [sx, sz] = xzAt(sm.lat, sm.lon); const [a, b] = toPx(sx, sz); x.fillStyle = '#e2b45a'; x.fillRect(a - 1.5, b - 1.5, 3, 3); } }
  const [px, py] = toPx(player.x, player.z); x.save(); x.translate(px, py); x.rotate(-player.yaw); x.fillStyle = '#e2a06a'; x.beginPath(); x.moveTo(0, -9); x.lineTo(5, 6); x.lineTo(0, 3); x.lineTo(-5, 6); x.closePath(); x.fill(); x.restore();
  x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 1; x.strokeRect(0.5, 0.5, W - 1, W - 1);
  x.fillStyle = '#ece4dc'; x.font = (big ? 13 : 10) + 'px IBM Plex Mono,monospace'; x.fillText('N↑', 6, big ? 18 : 13);
  x.fillText((2 * s.half / 1000).toFixed(0) + ' km', W - (big ? 70 : 46), W - 7);
}
function openMap() { $('#m-map').classList.add('on'); drawMap($('#mapc'), true); $('#map-scale').textContent = `${t('map_extent')}: ${(2 * field.site.half / 1000).toFixed(0)} × ${(2 * field.site.half / 1000).toFixed(0)} km · MOLA ${field.site.res}`; if (document.pointerLockElement) document.exitPointerLock(); }
$('#minimap').onclick = openMap;
$('#mapc').onclick = e => {
  const r = e.target.getBoundingClientRect(), s = field.site; const fx = (e.clientX - r.left) / r.width, fz = (e.clientY - r.top) / r.height;
  player.x = (fx * 2 - 1) * s.half * 0.99; player.z = (fz * 2 - 1) * s.half * 0.99; buildTile(Math.round(player.x / 50) * 50, Math.round(player.z / 50) * 50);
  player.y = groundH(player.x, player.z) + (player.move === 'drone' ? 300 : 0); player.vy = 0; $('#m-map').classList.remove('on');
  const [lat, lon] = latLonAt(player.x, player.z); toast(`${t('travelled')} ${fmtLat(lat)} ${fmtLon(lon)}`);
};

// ================================================================== VIEWS: ENVIRONMENT
const charts = {};
function chart(id, cfg) { if (charts[id]) charts[id].destroy(); const el = document.getElementById(id); if (!el || !window.Chart) return; charts[id] = new Chart(el, cfg); return charts[id]; }
const CH = { grid: 'rgba(255,232,214,0.08)', tick: '#b5aaa0', a: '#e2a06a', b: '#8fbccb', c: '#79c495', d: '#b49be0', e: '#e07a6a' };
function baseOpts(extra = {}) { return Object.assign({ responsive: true, maintainAspectRatio: false, animation: state.rm ? false : { duration: 500 }, plugins: { legend: { labels: { color: CH.tick, boxWidth: 12, font: { size: 11 } } }, tooltip: { mode: 'nearest', intersect: false } }, scales: { x: { grid: { color: CH.grid }, ticks: { color: CH.tick } }, y: { grid: { color: CH.grid }, ticks: { color: CH.tick } } } }, extra); }
function siteChips(cur, onPick, id) {
  return `<div class="seg" role="group" id="${id}" style="flex-wrap:wrap">${SITE_KEYS.map(k => `<button data-k="${k}" aria-pressed="${k === cur}">${esc(siteName(k))}</button>`).join('')}</div>`;
}
let envSite = null;
function renderEnv() {
  envSite = envSite || state.siteKey; const k = envSite, s = SITES[k];
  const elev = globalElev(s.lat, s.lon), pm = S.pressureModel(elev);
  const meas = s.measured;
  const mcard = (kind, title) => {
    const items = meas.filter(m => m.k === kind);
    return `<div class="card"><h3>${title}</h3>${items.length ? items.map(m => `<div style="margin:6px 0">${badge(m.st)} <span class="mono muted">${esc(m.date)}</span><div style="margin-top:3px">${esc(m.v)}</div>${srcLink(m.src)}</div>`).join('') : `<div class="muted">${t('no_insitu')}</div>`}</div>`;
  };
  $('#env-root').innerHTML = `
  <div class="row" style="justify-content:space-between;align-items:flex-end"><div><div class="kicker">${t('nav_env')}</div><h2>${t('env_title')}</h2></div>${siteChips(k, null, 'env-sites')}</div>
  <div class="note" style="margin:10px 0 14px">${t('env_note')}</div>
  <div class="row" style="gap:8px;margin-bottom:12px">${['MEASURED', 'REFERENCE', 'COMPUTED', 'MODELLED', 'SIMULATED'].map(x => `<span title="${esc(t('st_' + x + '_d'))}">${badge(x)} <span class="muted">${esc(t('st_' + x + '_d'))}</span></span>`).join('<span style="width:10px"></span>')}</div>
  <div class="grid g2">
    <div class="card" id="mars-clock"></div>
    <div class="card"><h3>${t('location')} ${badge('COMPUTED')}</h3>
      <div class="big">${fmtLat(s.lat)} · ${fmtLon(s.lon)}</div>
      <div class="mono" style="margin-top:6px">${t('elevation')}: ${fmt(elev, 0)} m <span class="muted">(${t('rel_areoid')})</span></div>
      <div class="muted" style="margin-top:6px">${esc(s.mission)}</div>${srcLink('mola')}${srcLink('gmm3')}
      <h3 style="margin-top:14px">${t('pressure')} — ${t('model_est')} ${badge('MODELLED')}</h3>
      <div class="big">${fmt(pm, 0)} Pa</div><div class="muted">p = ${S.P_DATUM} Pa × exp(−h / ${S.H_SCALE / 1000} km). ${t('season_25')}</div>${srcLink('factsheet')}${srcLink('remsSeason')}
    </div>
  </div>
  <div class="grid g3" style="margin-top:12px">
    ${mcard('temp', t('temperature'))}${mcard('pressure', t('pressure') + ' — ' + t('observations'))}${mcard('wind', t('wind'))}
    <div class="card"><h3>${t('radiation')}</h3><div>${badge('MEASURED')} <span class="mono muted">Aug 2012 – Jun 2013 · Gale</span><div style="margin-top:3px">0.67 mSv/day ${t('rad_gcr')}</div>${srcLink('rad')}</div><p class="muted">${t('rad_note')}</p></div>
    <div class="card"><h3>${t('dust')} ${badge('SIMULATED')}</h3><p>${t('dust_note')}</p><div class="mono">τ = 0.5 → ${t('visibility')} ≈ ${fmt(S.visibilityKm(0.5), 0)} km ${badge('MODELLED')}<br>τ = 4 (${t('duststorm')}) → ≈ ${fmt(S.visibilityKm(4), 0)} km</div></div>
    <div class="card"><h3>${t('temperature')} — ${t('now_sim')} ${badge('SIMULATED')}</h3><div class="big" id="env-tnow">—</div><p class="muted">${t('temp_sim_note')}</p></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>${t('diurnal_chart')}</h3><div class="chartbox"><canvas id="ch-diurnal"></canvas></div></div>
    <div class="card"><h3>${t('pressure_chart')}</h3><div class="chartbox"><canvas id="ch-press"></canvas></div></div>
    <div class="card"><h3>${t('season_chart')} ${badge('COMPUTED')}</h3><div class="chartbox"><canvas id="ch-season"></canvas></div>${srcLink('mars24')}</div>
    <div class="card"><h3>${t('why_no_live')}</h3><p>${t('why_no_live_txt')}</p>
      <pre class="code"># ${t('api_howto')}
# 1) Get a free key at https://api.nasa.gov  (DEMO_KEY works for light testing)
# 2) In a deployment you control (not this hosted page), set:  export NASA_API_KEY=your_key
import os, requests
key = os.environ.get("NASA_API_KEY", "DEMO_KEY")
# Archived InSight weather service (data ends 2020; mission ended 2022):
r = requests.get("https://api.nasa.gov/insight_weather/", params={"api_key": key, "feedtype": "json", "ver": "1.0"})
print(r.status_code)  # inspect sol_keys / AT / PRE / HWS fields (see API docs)</pre>${srcLink('insightApi')}</div>
  </div>
  <div class="card" style="margin-top:12px"><h3>${t('about_site')}</h3><p class="not-student">${esc(s.detail)}</p><p class="student-only mode-only">${esc(t('sitedesc_' + k))}</p></div>`;
  $$('#env-sites button').forEach(b => b.onclick = () => { envSite = b.dataset.k; renderEnv(); });
  updateEnvClock();
  const lon = s.lon, mt = S.marsTime(Date.now()), lt = S.localTimes(mt, lon).ltst;
  const hours = Array.from({ length: 49 }, (_, i) => i / 2);
  const ann = []; const tm = meas.find(m => m.k === 'temp' && m.st === 'MEASURED');
  chart('ch-diurnal', { type: 'line', data: { labels: hours.map(h => S.fmtClock(h)), datasets: [{ label: t('sim_curve'), data: hours.map(h => S.simTemp(s.tempSim, h)), borderColor: CH.d, borderDash: [5, 4], pointRadius: 0, tension: 0.3 }, { label: t('now_marker'), data: hours.map(h => Math.abs(h - lt) < 0.26 ? S.simTemp(s.tempSim, h) : null), borderColor: CH.a, backgroundColor: CH.a, pointRadius: 6, showLine: false }] }, options: baseOpts({ scales: { x: { ticks: { color: CH.tick, maxTicksLimit: 9 }, grid: { color: CH.grid } }, y: { title: { display: true, text: '°C', color: CH.tick }, ticks: { color: CH.tick }, grid: { color: CH.grid } } } }) });
  const mp = { jezero: 718, gale: (685 + 780) / 2, elysium: 721.7 };
  chart('ch-press', { type: 'bar', data: { labels: SITE_KEYS.map(siteName), datasets: [{ label: t('model_est') + ' (MODELLED)', data: SITE_KEYS.map(x => S.pressureModel(globalElev(SITES[x].lat, SITES[x].lon))), backgroundColor: 'rgba(226,180,90,.55)' }, { type: 'line', label: t('measured_pt') + ' (MEASURED)', data: SITE_KEYS.map(x => mp[x] ?? null), borderColor: CH.c, backgroundColor: CH.c, pointRadius: 7, pointStyle: 'rectRot', showLine: false }] }, options: baseOpts({ scales: { x: { ticks: { color: CH.tick }, grid: { color: CH.grid } }, y: { title: { display: true, text: 'Pa', color: CH.tick }, ticks: { color: CH.tick }, grid: { color: CH.grid } } } }) });
  const lsArr = Array.from({ length: 73 }, (_, i) => i * 5);
  const decl = L => Math.asin(0.42565 * Math.sin(L * D2R)) * R2D + 0.25 * Math.sin(L * D2R);
  chart('ch-season', { type: 'line', data: { labels: lsArr, datasets: [{ label: t('subsolar'), data: lsArr.map(decl), borderColor: CH.b, pointRadius: 0 }, { label: t('now_marker') + ` (Ls ${fmt(mt.Ls, 1)}°)`, data: lsArr.map(L => Math.abs(L - mt.Ls) <= 2.5 ? decl(mt.Ls) : null), borderColor: CH.a, backgroundColor: CH.a, pointRadius: 7, showLine: false }] }, options: baseOpts({ scales: { x: { title: { display: true, text: 'Ls (°)', color: CH.tick }, ticks: { color: CH.tick, maxTicksLimit: 9 }, grid: { color: CH.grid } }, y: { title: { display: true, text: '°', color: CH.tick }, ticks: { color: CH.tick }, grid: { color: CH.grid } } } }) });
  applyI18n($('#env-root'));
}
function updateEnvClock() {
  const el = $('#mars-clock'); if (!el) return; const s = SITES[envSite], mt = S.marsTime(Date.now()), lt = S.localTimes(mt, s.lon), sun = S.sunENU(s.lat, mt.decl, lt.ltst);
  el.innerHTML = `<h3>${t('mars_clock')} ${badge('COMPUTED')}</h3>
   <div class="grid g4" style="gap:10px">
    <div><div class="muted">UTC</div><div class="mono">${new Date().toISOString().slice(0, 19).replace('T', ' ')}</div></div>
    <div><div class="muted">${t('mars_year')}</div><div class="big">${mt.marsYear}</div></div>
    <div><div class="muted">Ls (${t('season')})</div><div class="big">${fmt(mt.Ls, 1)}°</div><div class="muted">${t('season_' + S.seasonName(mt.Ls, s.lat))} · ${s.lat >= 0 ? t('north_h') : t('south_h')}</div></div>
    <div><div class="muted">Mars Sol Date</div><div class="big">${fmt(mt.msd, 3)}</div></div>
    <div><div class="muted">${t('lmst')}</div><div class="big">${S.fmtClock(lt.lmst)}</div></div>
    <div><div class="muted">${t('ltst')}</div><div class="big">${S.fmtClock(lt.ltst)}</div></div>
    <div><div class="muted">${t('sun_el')} / az</div><div class="big">${fmt(sun.el, 1)}° / ${fmt(sun.az, 0)}°</div></div>
    <div><div class="muted">${t('toa')}</div><div class="big">${fmt(mt.toa, 0)} W/m²</div><div class="muted">${t('helio')} ${fmt(mt.rAU, 3)} AU</div></div>
   </div><div class="muted" style="margin-top:8px">${t('clock_note')}</div>`;
  const tn = $('#env-tnow'); if (tn) tn.textContent = fmt(S.simTemp(s.tempSim, lt.ltst), 0) + ' °C';
}
function renderMenuClock() {
  const mt = S.marsTime(Date.now()); const lt = S.localTimes(mt, SITES.jezero.lon).ltst;
  $('#menu-clock').innerHTML = `${t('mars_year')} ${mt.marsYear} · Ls ${fmt(mt.Ls, 1)}° · MSD ${fmt(mt.msd, 2)}<br>${t('ltst')} ${siteName('jezero')} ${S.fmtClock(lt)} · ${t('ltst')} ${siteName('gale')} ${S.fmtClock(S.localTimes(mt, SITES.gale.lon).ltst)} <span class="st st-COMPUTED">${t('st_COMPUTED')}</span>`;
}

// ================================================================== LAB
const MIXES = { // illustrative mixes (percent) for microscope rendering. Only 'rocknest' is a measurement.
  rocknest: null,
  basalt: [['Plagioclase', 40], ['Pyroxene', 35], ['Olivine', 10], ['Fe-Ti oxides', 5], ['Amorphous / dust', 10]],
  olivine: [['Olivine', 60], ['Pyroxene', 18], ['Plagioclase', 12], ['Fe-Ti oxides', 4], ['Amorphous / dust', 6]],
  sediment: [['Clay / amorphous', 45], ['Plagioclase', 20], ['Pyroxene', 15], ['Carbonate / sulfate', 12], ['Olivine', 8]],
  sulfate: [['Sulfates', 35], ['Clay / amorphous', 25], ['Plagioclase', 20], ['Pyroxene', 15], ['Fe oxides', 5]],
  regolith: [['Amorphous / dust', 35], ['Plagioclase', 28], ['Pyroxene', 22], ['Olivine', 10], ['Fe-Ti oxides', 5]],
};
const MINCOL = { Plagioclase: '#d9d4c9', 'Plagioclase (~An57)': '#d9d4c9', Pyroxene: '#3b2c25', Augite: '#3a2a22', Pigeonite: '#4a3428', Olivine: '#8f9a3a', 'Forsteritic olivine (~Fo62)': '#8f9a3a', 'Fe-Ti oxides': '#1d1b1b', Magnetite: '#161515', Ilmenite: '#222', Hematite: '#7a2b1e', 'Fe oxides': '#7a2b1e', Anhydrite: '#efe9e1', Quartz: '#f4f1ea', 'K-feldspar': '#e7c9b4', 'Amorphous / dust': '#b46a3e', 'Clay / amorphous': '#a27052', 'Carbonate / sulfate': '#e8dccb', Sulfates: '#efe2c9', 'X-ray amorphous': '#b46a3e' };
function mixFor(sm) {
  if (sm.measured === 'rocknest' || sm.ref === 'rocknest') { const cr = S.ROCKNEST.crystalline, k = (100 - S.ROCKNEST.amorphousWt) / 100; return { st: 'MEASURED', mix: [...cr.map(([n, v]) => [n, +(v * k).toFixed(1)]), ['X-ray amorphous', S.ROCKNEST.amorphousWt]] }; }
  const n = (sm.type || '').toLowerCase();
  const key = n.includes('olivine') ? 'olivine' : n.includes('delta') || n.includes('mudstone') || n.includes('lacustrine') ? 'sediment' : n.includes('sulfate') || n.includes('layered deposit') ? 'sulfate' : n.includes('basalt') || n.includes('igneous') || n.includes('lava') ? 'basalt' : 'regolith';
  return { st: 'ILLUSTRATIVE', mix: MIXES[key] };
}
const REF_SAMPLES = [
  { id: 'REF-RN', ref: 'rocknest', site: 'gale', siteLabel: 'Gale crater — Rocknest', type: 'Rocknest eolian sand (CheMin XRD)', minerals: 'Measured by Curiosity', lat: -4.58, lon: 137.44, measured: 'rocknest' },
];
let labSel = null, labMag = 120, labPol = false;
function renderLab() {
  const all = [...REF_SAMPLES, ...state.samples];
  if (!labSel || !all.find(s => s.id === labSel)) labSel = all[0].id;
  const sm = all.find(s => s.id === labSel); const M = mixFor(sm);
  state.labAnalysed[sm.id] = true; saveProgress();
  $('#lab-root').innerHTML = `
  <div class="kicker">${t('mission_b')}</div><h2>${t('lab_title')}</h2>
  <div class="grid" style="grid-template-columns:minmax(220px,280px) minmax(280px,1fr) minmax(280px,1fr);align-items:start">
    <div class="card"><h3>${t('samples')}</h3>
      ${all.map(s => `<button class="sample-li ${s.id === labSel ? 'sel' : ''}" data-id="${s.id}"><b class="mono">${s.id}</b> ${s.ref ? badge('MEASURED') : ''}<div>${esc(s.type)}</div><div class="muted">${esc(s.siteLabel || s.site)}${s.elev != null ? ' · ' + fmt(s.elev, 0) + ' m' : ''}</div></button>`).join('')}
      ${state.samples.length ? '' : `<p class="muted">${t('no_samples')}</p><button class="btn sm" id="lab-go-field">${t('nav_field')}</button>`}
    </div>
    <div class="card"><h3>${t('microscope')} ${badge('ILLUSTRATIVE')}</h3>
      <div class="scope" style="max-width:440px;margin:0 auto"><canvas id="scope" width="560" height="560" aria-label="Illustrative microscope view of the sample"></canvas><div class="reticle"></div></div>
      <div class="ctl"><label for="mag">${t('magnification')}</label><output id="mag-o">${labMag}×</output><input type="range" id="mag" min="40" max="400" step="10" value="${labMag}"></div>
      <div class="row"><label class="muted"><input type="checkbox" id="pol" ${labPol ? 'checked' : ''}> ${t('xpl')}</label></div>
      <p class="muted">${t('scope_note')}</p>
    </div>
    <div class="card"><h3>${t('composition')} ${badge(M.st)}</h3>
      <div class="chartbox" style="height:220px"><canvas id="ch-comp"></canvas></div>
      <table class="tb" style="margin-top:8px">${M.mix.map(([n, v]) => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${MINCOL[n] || '#888'};margin-inline-end:6px"></span>${esc(n)}</td><td class="mono" style="text-align:end">${M.st === 'MEASURED' ? '' : '~'}${v}%</td></tr>`).join('')}</table>
      ${M.st === 'MEASURED' ? `<p class="muted">${t('rocknest_note', { a: S.ROCKNEST.amorphousWt, e: S.ROCKNEST.amorphousErr })}</p>${srcLink('rocknest')}` : `<p class="muted">${t('illus_note')}</p><div class="note">${esc(sm.minerals)}</div>`}
      <div class="research-only mode-only muted mono" style="margin-top:8px">${sm.lat != null ? `${fmtLat(sm.lat)} ${fmtLon(sm.lon)}` : ''} ${sm.msd ? '· MSD ' + fmt(sm.msd, 2) + ' · LTST ' + S.fmtClock(sm.ltst) : ''}</div>
    </div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>${t('leach_title')} ${badge('SIMULATED')}</h3>
      <p>${t('leach_intro')}</p>
      <div class="mono" style="margin-bottom:6px">${badge('MEASURED')} Phoenix: ${S.PHOENIX.perchlorateWt[0]}–${S.PHOENIX.perchlorateWt[1]} wt% ClO₄⁻, pH ${S.PHOENIX.pH} ± ${S.PHOENIX.pHErr}</div>${srcLink('phoenix')}
      <div class="ctl"><label for="lc-ratio">${t('water_ratio')}</label><output id="lc-ratio-o">3 : 1</output><input type="range" id="lc-ratio" min="1" max="10" step="1" value="3"></div>
      <div class="ctl"><label for="lc-n">${t('rinses')}</label><output id="lc-n-o">4</output><input type="range" id="lc-n" min="1" max="8" step="1" value="4"></div>
      <div class="row"><label class="muted"><input type="checkbox" id="lc-org"> ${t('amend')}</label><button class="btn pri sm" id="lc-run">${t('run')}</button></div>
      <div class="chartbox" style="height:200px;margin-top:10px"><canvas id="ch-leach"></canvas></div>
      <div id="lc-out" class="mono" style="margin-top:8px"></div>
    </div>
    <div class="card"><h3>${t('compare')}</h3>
      <table class="tb"><tr><th>ID</th><th>${t('site')}</th><th>${t('type')}</th><th>${t('elevation')}</th><th>${t('data_status')}</th></tr>
      ${all.map(s => `<tr><td class="mono">${s.id}</td><td>${esc(s.siteLabel || s.site)}</td><td>${esc(s.type)}</td><td class="mono">${s.elev != null ? fmt(s.elev, 0) + ' m' : '—'}</td><td>${badge(mixFor(s).st)}</td></tr>`).join('')}</table>
      <h3 style="margin-top:14px">${t('plant_soil')}</h3><p>${t('plant_soil_txt')}</p>
    </div>
  </div>`;
  $$('#lab-root .sample-li').forEach(b => b.onclick = () => { labSel = b.dataset.id; renderLab(); });
  const gf = $('#lab-go-field'); if (gf) gf.onclick = () => go('field');
  $('#mag').oninput = e => { labMag = +e.target.value; $('#mag-o').textContent = labMag + '×'; drawScope(sm, M); };
  $('#pol').onchange = e => { labPol = e.target.checked; drawScope(sm, M); };
  drawScope(sm, M);
  chart('ch-comp', { type: 'doughnut', data: { labels: M.mix.map(m => m[0]), datasets: [{ data: M.mix.map(m => m[1]), backgroundColor: M.mix.map(m => MINCOL[m[0]] || '#888'), borderColor: '#141211', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, animation: state.rm ? false : {}, plugins: { legend: { display: false } }, cutout: '58%' } });
  const upd = () => { $('#lc-ratio-o').textContent = $('#lc-ratio').value + ' : 1'; $('#lc-n-o').textContent = $('#lc-n').value; };
  $('#lc-ratio').oninput = upd; $('#lc-n').oninput = upd;
  $('#lc-run').onclick = runLeach; if (state.leach) drawLeach(state.leach);
  applyI18n($('#lab-root'));
}
function drawScope(sm, M) {
  const cv = $('#scope'); if (!cv) return; const x = cv.getContext('2d'), W = cv.width;
  let seed = 0; for (const ch of sm.id) seed = seed * 31 + ch.charCodeAt(0);
  const rnd = (() => { let s = seed >>> 0 || 1; return () => (s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909), ((s ^= s >>> 16) >>> 0) / 4294967296); })();
  x.fillStyle = labPol ? '#0b0a0a' : '#c58a5c'; x.fillRect(0, 0, W, W);
  const cum = []; let tot = 0; for (const [n, v] of M.mix) { tot += v; cum.push([n, tot]); }
  const pick = () => { const r = rnd() * tot; return cum.find(c => r <= c[1])[0]; };
  const scale = labMag / 120, count = Math.floor(260 / Math.sqrt(scale));
  for (let i = 0; i < count; i++) {
    const n = pick(), cx = rnd() * W, cy = rnd() * W, isAm = /amorph|dust|clay/i.test(n);
    const r = (isAm ? 4 + rnd() * 6 : 10 + rnd() * 30) * scale;
    let col = MINCOL[n] || '#888';
    if (labPol) { const hue = Math.floor(rnd() * 360); col = /Olivine|olivine|Pyroxene|Augite|Pigeonite/.test(n) ? `hsl(${hue},70%,55%)` : /Plagio|feldspar|Quartz/.test(n) ? `hsl(0,0%,${20 + rnd() * 60}%)` : /Magnet|Ilmen|oxide|Hemat/.test(n) ? '#000' : `hsl(30,30%,${10 + rnd() * 15}%)`; }
    x.fillStyle = col; x.beginPath(); const k = 5 + Math.floor(rnd() * 4), rot = rnd() * 6.3;
    for (let j = 0; j < k; j++) { const a = rot + j / k * Math.PI * 2, rr = r * (0.65 + rnd() * 0.45); j ? x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    x.closePath(); x.fill(); if (!isAm) { x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1; x.stroke(); x.fillStyle = 'rgba(255,255,255,.12)'; x.beginPath(); x.arc(cx - r * 0.25, cy - r * 0.25, r * 0.25, 0, 7); x.fill(); }
  }
  // scale bar
  const um = Math.round(500 / scale / 50) * 50 || 50; const px = um * scale * 0.4;
  x.fillStyle = '#fff'; x.fillRect(W - px - 40, W - 46, px, 4); x.font = '16px IBM Plex Mono,monospace'; x.fillText(um + ' µm', W - px - 40, W - 54);
}
function runLeach() {
  const ratio = +$('#lc-ratio').value, n = +$('#lc-n').value, org = $('#lc-org').checked;
  const start = 0.5; // wt%, mid-range of Phoenix measurement
  const eff = 1 - 1 / (1 + 0.55 * ratio); // fraction removed per rinse — simulated (perchlorate salts are highly soluble)
  const series = [start]; for (let i = 0; i < n; i++) series.push(series[series.length - 1] * (1 - eff));
  const final = series[series.length - 1];
  const tol = 0.01; // illustrative plant tolerance threshold (wt%) — simulated
  const water = ratio * n; // L of water per kg of regolith
  const suit = clamp((1 - final / start) * 0.55 + (org ? 0.35 : 0.08), 0, 1);
  state.leach = { ratio, n, org, series, final, water, suit, t: Date.now() }; saveProgress(); drawLeach(state.leach);
}
function drawLeach(L) {
  chart('ch-leach', { type: 'line', data: { labels: L.series.map((_, i) => i), datasets: [{ label: 'ClO₄⁻ wt% (SIMULATED)', data: L.series, borderColor: CH.a, backgroundColor: 'rgba(226,160,106,.2)', fill: true, tension: 0.2 }, { label: t('tol_line'), data: L.series.map(() => 0.01), borderColor: CH.e, borderDash: [4, 4], pointRadius: 0 }] }, options: baseOpts({ scales: { x: { title: { display: true, text: t('rinses'), color: CH.tick }, ticks: { color: CH.tick }, grid: { color: CH.grid } }, y: { type: 'logarithmic', ticks: { color: CH.tick }, grid: { color: CH.grid } } } }) });
  const o = $('#lc-out'); if (o) o.innerHTML = `${t('final')}: ${L.final.toFixed(4)} wt% · ${t('water_used')}: ${L.water} L/kg · ${t('suit_idx')}: <b>${Math.round(L.suit * 100)}/100</b> ${badge('SIMULATED')}`;
}

// ================================================================== GREENHOUSE
const CROPS = {
  lettuce: { Tmin: 4, Topt: 20, Tmax: 30, dli: 15, days: 45, rgr: 0.09 },
  potato: { Tmin: 7, Topt: 18, Tmax: 28, dli: 25, days: 100, rgr: 0.041 },
  wheat: { Tmin: 3, Topt: 22, Tmax: 32, dli: 35, days: 85, rgr: 0.048 },
};
const SUBSTRATES = { raw: 0.12, leached: 0.45, amended: 0.82, hydro: 1.0 };
const ghP = { crop: 'lettuce', ppfd: 300, photo: 16, temp: 21, rh: 65, water: 100, co2: 1000, sub: 'amended', depth: 2 };
function ghModel(p) {
  const c = CROPS[p.crop], dli = p.ppfd * p.photo * 3600 / 1e6;
  const fL = (dli / (dli + c.dli * 0.6)) / (c.dli / (c.dli + c.dli * 0.6));
  const T = p.temp; const fT = (T <= c.Tmin || T >= c.Tmax) ? 0 : Math.pow((T - c.Tmin) / (c.Topt - c.Tmin), 1) * Math.pow((c.Tmax - T) / (c.Tmax - c.Topt), (c.Tmax - c.Topt) / (c.Topt - c.Tmin));
  const es = 0.6108 * Math.exp(17.27 * T / (T + 237.3)), vpd = es * (1 - p.rh / 100);
  const fV = vpd < 0.3 ? 0.85 : vpd > 2.0 ? clamp(1 - (vpd - 2.0) * 0.4, 0.3, 1) : 1;
  const fW = p.water >= 100 ? 1 - (p.water - 100) / 400 : clamp(Math.pow(p.water / 100, 1.5), 0, 1);
  const fC = 1 + 0.3 * (clamp(p.co2, 400, 1200) - 400) / 800 - (p.co2 > 3000 ? 0.1 : 0);
  let fS = SUBSTRATES[p.sub]; if (p.sub === 'leached' && state.leach) fS = 0.25 + 0.4 * state.leach.suit; if (p.sub === 'amended' && state.leach) fS = 0.55 + 0.35 * state.leach.suit;
  const f = clamp(fL, 0, 1.3) * clamp(fT, 0, 1) * fV * fW * fC * fS;
  const W = [0.02]; const Wmax = 1;
  for (let d = 1; d <= c.days; d++) { const w = W[d - 1]; W.push(w + c.rgr * f * w * (1 - w / Wmax)); }
  const ideal = (() => { const Wi = [0.02]; for (let d = 1; d <= c.days; d++) { const w = Wi[d - 1]; Wi.push(w + c.rgr * 1.3 * w * (1 - w / Wmax)); } return Wi[c.days]; })();
  const factors = { light: clamp(fL, 0, 1.3), temperature: fT, humidity: fV, water: fW, co2: fC, substrate: fS };
  const limiting = Object.entries(factors).filter(([k]) => k !== 'co2').sort((a, b) => a[1] - b[1])[0][0];
  const kwh = p.ppfd * p.photo * 3600 / 2.7 / 3.6e6;   // LED electricity per m² per day, assuming 2.7 µmol/J efficacy
  const relDose = Math.exp(-p.depth / 2.2) * 0.85 + 0.15 * Math.exp(-p.depth / 6); // illustrative attenuation trend
  return { W, rel: W[c.days] / ideal, dli, vpd, kwh, factors, limiting, dose: 0.67 * relDose, days: c.days, water: (2 + 3 * vpd) * (p.water / 100) };
}
function renderGH() {
  const placed = state.greenhouses[state.greenhouses.length - 1];
  const r = ghModel(ghP);
  const sl = (id, lab, min, max, step, unit) => `<div class="ctl"><label for="gh-${id}">${lab}</label><output id="gh-${id}-o">${ghP[id]}${unit}</output><input type="range" id="gh-${id}" min="${min}" max="${max}" step="${step}" value="${ghP[id]}"></div>`;
  $('#gh-root').innerHTML = `
  <div class="kicker">${t('mission_c')}</div><h2>${t('greenhouse_title')}</h2>
  <div class="note" style="margin-bottom:12px">${t('gh_intro')}</div>
  ${placed ? `<div class="card" style="margin-bottom:12px"><h3>${t('gh_site')}</h3><div class="mono">${placed.id} · ${esc(placed.site === 'custom' ? t('custom_site') : siteName(placed.site))} · ${fmtLat(placed.lat)} ${fmtLon(placed.lon)} · ${fmt(placed.elev, 0)} m · ${t('outside_p')} ≈ ${fmt(placed.pModel, 0)} Pa ${badge('MODELLED')}</div><div class="muted">${t('gh_site_note')}</div></div>` : `<div class="card" style="margin-bottom:12px"><span class="muted">${t('gh_none')}</span> <button class="btn sm" id="gh-go-field">${t('nav_field')}</button></div>`}
  <div class="grid" style="grid-template-columns:minmax(260px,330px) 1fr;align-items:start">
    <div class="card"><h3>${t('controls')}</h3>
      <div class="ctl"><label for="gh-crop">${t('crop')}</label><span></span><select class="sel" id="gh-crop" style="grid-column:1/-1">${Object.keys(CROPS).map(k => `<option value="${k}" ${k === ghP.crop ? 'selected' : ''}>${t('crop_' + k)}</option>`).join('')}</select></div>
      ${sl('ppfd', t('led_ppfd'), 50, 800, 10, ' µmol/m²/s')}${sl('photo', t('photoperiod'), 6, 24, 1, ' h')}${sl('temp', t('air_temp'), 0, 36, 1, ' °C')}${sl('rh', t('humidity'), 20, 95, 1, ' %')}${sl('water', t('water_supply'), 20, 160, 5, ' %')}${sl('co2', 'CO₂', 400, 3000, 50, ' ppm')}${sl('depth', t('shield_depth'), 0, 6, 0.5, ' m')}
      <div class="ctl"><label for="gh-sub">${t('substrate')}</label><span></span><select class="sel" id="gh-sub" style="grid-column:1/-1">${Object.keys(SUBSTRATES).map(k => `<option value="${k}" ${k === ghP.sub ? 'selected' : ''}>${t('sub_' + k)}</option>`).join('')}</select></div>
      <div class="row"><button class="btn pri" id="gh-run">${t('run_save')}</button><button class="btn" id="gh-clear">${t('reset')}</button></div>
    </div>
    <div>
      <div class="card"><canvas id="gh-canvas" width="1000" height="360" style="width:100%;height:auto;border-radius:8px" aria-label="Cross-section of the underground greenhouse"></canvas></div>
      <div class="grid g4" style="margin-top:12px" id="gh-kpis"></div>
      <div class="card" style="margin-top:12px"><h3>${t('growth_curve')} ${badge('SIMULATED')}</h3><div class="chartbox"><canvas id="ch-gh"></canvas></div></div>
    </div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>${t('runs')}</h3><div id="gh-runs"></div></div>
    <div class="card"><h3>${t('limits')}</h3><ul style="color:var(--tx2);line-height:1.6;padding-inline-start:18px">${t('limits_list').split('|').map(x => `<li>${x}</li>`).join('')}</ul></div>
  </div>`;
  const ids = ['ppfd', 'photo', 'temp', 'rh', 'water', 'co2', 'depth'];
  const units = { ppfd: ' µmol/m²/s', photo: ' h', temp: ' °C', rh: ' %', water: ' %', co2: ' ppm', depth: ' m' };
  ids.forEach(id => $('#gh-' + id).oninput = e => { ghP[id] = +e.target.value; $('#gh-' + id + '-o').textContent = ghP[id] + units[id]; updateGH(); });
  $('#gh-crop').onchange = e => { ghP.crop = e.target.value; updateGH(); };
  $('#gh-sub').onchange = e => { ghP.sub = e.target.value; updateGH(); };
  $('#gh-run').onclick = () => { const r = ghModel(ghP); state.ghRuns.push({ p: { ...ghP }, rel: r.rel, W: r.W, kwh: r.kwh, limiting: r.limiting, dli: r.dli, t: Date.now() }); if (state.ghRuns.length > 6) state.ghRuns.shift(); saveProgress(); updateGH(); toast(t('run_saved')); };
  $('#gh-clear').onclick = () => { state.ghRuns = []; saveProgress(); updateGH(); };
  const gf = $('#gh-go-field'); if (gf) gf.onclick = () => go('field');
  updateGH();
}
function updateGH() {
  const r = ghModel(ghP), c = CROPS[ghP.crop];
  const kpi = (k, v, st) => `<div class="card"><div class="muted">${k}</div><div class="big" style="font-size:1.3rem">${v}</div>${badge(st)}</div>`;
  $('#gh-kpis').innerHTML = kpi(t('rel_yield'), Math.round(r.rel * 100) + '%', 'SIMULATED') + kpi('DLI', fmt(r.dli, 1) + ' mol/m²/d', 'COMPUTED') + kpi(t('led_energy'), fmt(r.kwh, 2) + ' kWh/m²/d', 'COMPUTED') + kpi(t('limiting'), t('f_' + r.limiting), 'SIMULATED') + kpi('VPD', fmt(r.vpd, 2) + ' kPa', 'COMPUTED') + kpi(t('crew_dose'), fmt(r.dose, 2) + ' mSv/d', 'ILLUSTRATIVE');
  const ds = [{ label: t('current') + ' — ' + t('crop_' + ghP.crop), data: r.W.map(w => w * 100), borderColor: CH.a, borderWidth: 2.5, pointRadius: 0, tension: 0.2 }];
  const pal = [CH.b, CH.c, CH.d, CH.e, '#c9c08a', '#9fb0d8'];
  state.ghRuns.forEach((run, i) => ds.push({ label: `#${i + 1} ${t('crop_' + run.p.crop)} ${run.p.ppfd}µ/${run.p.temp}°C/${t('sub_' + run.p.sub)}`, data: run.W.map(w => w * 100), borderColor: pal[i % 6], borderDash: [4, 3], pointRadius: 0 }));
  const days = Math.max(r.days, ...state.ghRuns.map(x => x.W.length - 1));
  chart('ch-gh', { type: 'line', data: { labels: Array.from({ length: days + 1 }, (_, i) => i), datasets: ds }, options: baseOpts({ scales: { x: { title: { display: true, text: t('days'), color: CH.tick }, ticks: { color: CH.tick, maxTicksLimit: 10 }, grid: { color: CH.grid } }, y: { min: 0, max: 100, title: { display: true, text: t('biomass_idx'), color: CH.tick }, ticks: { color: CH.tick }, grid: { color: CH.grid } } } }) });
  $('#gh-runs').innerHTML = state.ghRuns.length ? `<table class="tb"><tr><th>#</th><th>${t('crop')}</th><th>PPFD / h</th><th>°C / RH</th><th>${t('substrate')}</th><th>${t('rel_yield')}</th><th>kWh/m²/d</th><th>${t('limiting')}</th></tr>${state.ghRuns.map((x, i) => `<tr><td>${i + 1}</td><td>${t('crop_' + x.p.crop)}</td><td class="mono">${x.p.ppfd} / ${x.p.photo}</td><td class="mono">${x.p.temp} / ${x.p.rh}%</td><td>${t('sub_' + x.p.sub)}</td><td class="mono">${Math.round(x.rel * 100)}%</td><td class="mono">${fmt(x.kwh, 2)}</td><td>${t('f_' + x.limiting)}</td></tr>`).join('')}</table>` : `<p class="muted">${t('no_runs')}</p>`;
  drawGHCanvas(r);
}
function drawGHCanvas(r) {
  const cv = $('#gh-canvas'); if (!cv) return; const x = cv.getContext('2d'), W = cv.width, H = cv.height;
  const g = x.createLinearGradient(0, 0, 0, 70); g.addColorStop(0, '#6b4a36'); g.addColorStop(1, '#c8946a'); x.fillStyle = g; x.fillRect(0, 0, W, 70);
  const surf = 70; x.fillStyle = '#7a4a2e'; x.fillRect(0, surf, W, H - surf);
  for (let i = 0; i < 6; i++) { x.fillStyle = `rgba(0,0,0,${0.05 + i * 0.03})`; x.fillRect(0, surf + i * 50, W, 50); }
  const depthPx = 30 + ghP.depth * 25; const top = surf + depthPx, bot = Math.min(H - 14, top + 180);
  x.fillStyle = '#1a1614'; x.fillRect(110, top, W - 220, bot - top);
  x.strokeStyle = '#9a9690'; x.lineWidth = 3; x.strokeRect(110, top, W - 220, bot - top);
  x.fillStyle = '#5a5550'; x.fillRect(W - 170, surf - 26, 46, top - surf + 26); x.fillStyle = '#d9d4cc'; x.fillRect(W - 176, surf - 34, 58, 12);
  x.fillStyle = '#ece4dc'; x.font = '15px Inter,sans-serif'; x.fillText(t('airlock'), W - 230, surf - 40);
  // LED bars coloured by photoperiod / intensity
  const ledA = clamp(ghP.ppfd / 800, 0.2, 1); for (let i = 0; i < 6; i++) { const lx = 140 + i * ((W - 280) / 6); x.fillStyle = `rgba(214,110,224,${ledA})`; x.fillRect(lx, top + 14, (W - 280) / 6 - 18, 6); const lg = x.createLinearGradient(0, top + 20, 0, bot - 40); lg.addColorStop(0, `rgba(214,110,224,${ledA * 0.35})`); lg.addColorStop(1, 'rgba(214,110,224,0)'); x.fillStyle = lg; x.fillRect(lx - 6, top + 20, (W - 280) / 6 - 6, bot - top - 60); }
  // beds + plants
  const bedY = bot - 32; x.fillStyle = ghP.sub === 'hydro' ? '#2c4a5a' : ghP.sub === 'raw' ? '#9a5a36' : '#5a3a26'; x.fillRect(130, bedY, W - 260, 22);
  const size = clamp(r.W[r.W.length - 1], 0.02, 1);
  for (let i = 0; i < 16; i++) { const px = 150 + i * ((W - 300) / 15); const h = 10 + size * 90 * (0.85 + 0.3 * hash2(i, 3));
    x.strokeStyle = '#4f7a3a'; x.lineWidth = 3; x.beginPath(); x.moveTo(px, bedY); x.lineTo(px, bedY - h); x.stroke();
    x.fillStyle = ghP.crop === 'wheat' ? '#c9b25a' : '#6fa04e'; for (let l = 0; l < 4; l++) { x.beginPath(); x.ellipse(px + (l % 2 ? 8 : -8) * (0.5 + size), bedY - h * (0.35 + l * 0.17), 9 * (0.4 + size), 4 * (0.4 + size), (l % 2 ? -0.5 : 0.5), 0, 7); x.fill(); } }
  x.fillStyle = '#ece4dc'; x.font = '14px IBM Plex Mono,monospace';
  x.fillText(`${t('shield_depth')}: ${ghP.depth} m`, 14, surf + 22); x.fillText(`${ghP.temp} °C · RH ${ghP.rh}% · CO₂ ${ghP.co2} ppm`, 128, top + 44);
  x.fillText(`${t('surface')} ≈ ${fmt(state.greenhouses.length ? state.greenhouses[state.greenhouses.length - 1].pModel : 700, 0)} Pa CO₂`, 14, 22);
}

// ================================================================== ATMOSPHERE WHAT-IF
function atmoModel(P, tau, gh) {
  const T0 = 210; // K, approx. present global mean surface temperature
  const dT = 22 * Math.log10(Math.max(P, 6) / 6) + gh - 3 * (tau - 0.5); // toy
  const T = T0 + dT, Tday = T + 30 * Math.exp(-(P - 6) / 400);
  const Tb = 1 / (1 / 373.15 - 8.314 * Math.log(P / 1013.25) / 40650) - 273.15; // boiling point (Clausius–Clapeyron)
  const liquid = P > 6.11 && Tday - 273.15 > 0 && Tday - 273.15 < Tb;
  return { T: T - 273.15, Tday: Tday - 273.15, Tb, liquid, armstrong: P >= 63, sky: atmoSkyMix(P, tau) };
}
let atmoAnim = null;
function renderAtmo() {
  const w = state.whatIf;
  $('#atmo-root').innerHTML = `
  <div class="kicker">${t('mission_d')}</div><h2>${t('atmo_title')}</h2>
  <div class="banner" role="note"><b>${t('whatif_banner_h')}</b> ${t('whatif_banner')}</div>
  <div class="grid" style="grid-template-columns:minmax(260px,340px) 1fr;align-items:start;margin-top:12px">
    <div class="card"><h3>${t('controls')}</h3>
      <div class="ctl"><label for="at-P">${t('target_p')}</label><output id="at-P-o">${w.P} mbar</output><input type="range" id="at-P" min="0" max="100" step="1" value="${Math.round(Math.log(w.P / 6) / Math.log(1000 / 6) * 100)}"></div>
      <div class="ctl"><label for="at-tau">${t('dust_tau')}</label><output id="at-tau-o">${w.tau}</output><input type="range" id="at-tau" min="0.05" max="5" step="0.05" value="${w.tau}"></div>
      <div class="ctl"><label for="at-gh">${t('extra_gh')}</label><output id="at-gh-o">${w.gh} K</output><input type="range" id="at-gh" min="0" max="60" step="1" value="${w.gh}"></div>
      <div class="ctl"><label for="at-yr">${t('sim_years')}</label><output id="at-yr-o">${w.years}</output><input type="range" id="at-yr" min="10" max="500" step="10" value="${w.years}"></div>
      <div class="row"><button class="btn pri" id="at-run">${t('run')}</button><button class="btn" id="at-apply" aria-pressed="${w.active}">${w.active ? t('remove_field') : t('apply_field')}</button></div>
      <div class="muted" style="margin-top:8px">${t('atmo_presets')}: <button class="btn sm" data-pre="6,0.5,0">${t('today')}</button> <button class="btn sm" data-pre="12,0.5,0">${t('pre_caps')}</button> <button class="btn sm" data-pre="1000,0.15,25">${t('pre_earth')}</button></div>
    </div>
    <div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3>${t('sky_preview')} ${badge('WHATIF')}</h3><span class="mono" id="at-year"></span></div><canvas id="at-sky" width="1000" height="380" style="width:100%;height:auto;border-radius:8px" aria-label="Sky colour preview"></canvas></div>
      <div class="grid g4" id="at-kpis" style="margin-top:12px"></div>
      <div class="card" style="margin-top:12px"><h3>${t('timeline')} ${badge('WHATIF')}</h3><div class="chartbox"><canvas id="ch-atmo"></canvas></div></div>
    </div>
  </div>
  <div class="card" style="margin-top:12px"><h3>${t('challenges')}</h3><ul style="color:var(--tx2);line-height:1.65;padding-inline-start:18px">${t('challenges_list').split('|').map(x => `<li>${x}</li>`).join('')}</ul>${srcLink('terraform')}</div>`;
  const pFrom = v => +(6 * Math.pow(1000 / 6, v / 100)).toFixed(v < 30 ? 1 : 0);
  $('#at-P').oninput = e => { w.P = pFrom(+e.target.value); $('#at-P-o').textContent = w.P + ' mbar'; drawAtmo(w.P, w.tau, w.gh); };
  $('#at-tau').oninput = e => { w.tau = +e.target.value; $('#at-tau-o').textContent = w.tau; drawAtmo(w.P, w.tau, w.gh); };
  $('#at-gh').oninput = e => { w.gh = +e.target.value; $('#at-gh-o').textContent = w.gh + ' K'; drawAtmo(w.P, w.tau, w.gh); };
  $('#at-yr').oninput = e => { w.years = +e.target.value; $('#at-yr-o').textContent = w.years; };
  $('#at-run').onclick = runAtmo;
  $('#at-apply').onclick = () => { w.active = !w.active; w.curP = w.P; w.curTau = w.tau; renderAtmo(); toast(w.active ? t('whatif_on') : t('whatif_off')); };
  $$('#atmo-root [data-pre]').forEach(b => b.onclick = () => { const [P, ta, g] = b.dataset.pre.split(',').map(Number); Object.assign(w, { P, tau: ta, gh: g }); renderAtmo(); });
  drawAtmo(w.P, w.tau, w.gh);
}
function runAtmo() {
  const w = state.whatIf, N = 60, P0 = 6, tau0 = 0.5, gh0 = 0;
  const ser = []; for (let i = 0; i <= N; i++) { const f = 1 / (1 + Math.exp(-(i / N - 0.5) * 10)); const k = (f - 1 / (1 + Math.exp(5))) / (1 / (1 + Math.exp(-5)) - 1 / (1 + Math.exp(5))); ser.push({ yr: Math.round(i / N * w.years), P: P0 * Math.pow(w.P / P0, k), tau: lerp(tau0, w.tau, k), gh: lerp(gh0, w.gh, k) }); }
  chart('ch-atmo', { type: 'line', data: { labels: ser.map(s => s.yr), datasets: [{ label: t('pressure') + ' (mbar)', data: ser.map(s => s.P), borderColor: CH.b, yAxisID: 'y', pointRadius: 0 }, { label: t('mean_temp') + ' (°C)', data: ser.map(s => atmoModel(s.P, s.tau, s.gh).T), borderColor: CH.a, yAxisID: 'y1', pointRadius: 0 }] }, options: baseOpts({ scales: { x: { title: { display: true, text: t('sim_years_ax'), color: CH.tick }, ticks: { color: CH.tick, maxTicksLimit: 10 }, grid: { color: CH.grid } }, y: { type: 'logarithmic', position: 'left', ticks: { color: CH.tick }, grid: { color: CH.grid } }, y1: { position: 'right', ticks: { color: CH.tick }, grid: { display: false } } } }) });
  cancelAnimationFrame(atmoAnim); let i = 0; const stepT = state.rm ? 0 : 70; let last = 0;
  const tick = (ts) => { if (ts - last >= stepT) { last = ts; const s = ser[i]; drawAtmo(s.P, s.tau, s.gh, s.yr); if (w.active) { w.curP = s.P; w.curTau = s.tau; } i++; } if (i < ser.length && state.view === 'atmo') atmoAnim = requestAnimationFrame(tick); else { state.atmoRun = { P: w.P, tau: w.tau, gh: w.gh, years: w.years, t: Date.now() }; saveProgress(); } };
  if (state.rm) { drawAtmo(w.P, w.tau, w.gh, w.years); state.atmoRun = { P: w.P, tau: w.tau, gh: w.gh, years: w.years }; saveProgress(); } else atmoAnim = requestAnimationFrame(tick);
}
function drawAtmo(P, tau, gh, yr) {
  const cv = $('#at-sky'); if (!cv) return; const x = cv.getContext('2d'), W = cv.width, H = cv.height, m = atmoModel(P, tau, gh);
  const sun = { x: 0.25, y: 0.22, z: -0.94 }; const l = Math.hypot(sun.x, sun.y, sun.z); sun.x /= l; sun.y /= l; sun.z /= l;
  const img = x.createImageData(W, H);
  for (let py = 0; py < H; py += 2) for (let px = 0; px < W; px += 2) {
    const az = (px / W - 0.5) * 1.6, el = (1 - py / H) * 0.9 - 0.05; const d = { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
    let c = skyColorJS(d, sun, tau, m.sky); const mu = Math.max(0, d.x * sun.x + d.y * sun.y + d.z * sun.z);
    const halo = (Math.pow(mu, 5) * 0.55 + Math.pow(mu, 48) * 0.9) * (1 - m.sky) * Math.exp(-Math.max(tau - 1, 0) * 0.7) * 0.6; c = [lerp(c[0], 0.47, halo), lerp(c[1], 0.63, halo), lerp(c[2], 0.86, halo)];
    if (mu > 0.9993) c = [1.2, 1.15, 1.05];
    const tm = v => Math.round(255 * Math.pow(clamp(v / (1 + v) * 1.6, 0, 1), 1 / 1.4));
    for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) { const i = ((py + oy) * W + px + ox) * 4; img.data[i] = tm(c[0]); img.data[i + 1] = tm(c[1]); img.data[i + 2] = tm(c[2]); img.data[i + 3] = 255; }
  }
  x.putImageData(img, 0, 0);
  // terrain silhouette (Gale crater rim profile from MOLA as a backdrop)
  x.fillStyle = m.liquid ? '#5a3a28' : '#4a2a1a'; x.beginPath(); x.moveTo(0, H);
  for (let i = 0; i <= 200; i++) { const lon = 137.2 + i / 200 * 1.2; const e = globalElev(-5.0, lon); x.lineTo(i / 200 * W, H - 60 - (e + 4500) / 5500 * 140); }
  x.lineTo(W, H); x.fill();
  if (m.liquid) { x.fillStyle = 'rgba(70,110,150,.7)'; x.fillRect(0, H - 34, W, 34); }
  x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 0, 330, 30); x.fillStyle = '#f3c6bd'; x.font = '14px IBM Plex Mono,monospace'; x.fillText(t('fictional_tag'), 10, 20);
  if (yr != null) $('#at-year').textContent = `${t('year')} ${yr}`;
  const k = (lab, v, ok) => `<div class="card"><div class="muted">${lab}</div><div class="big" style="font-size:1.2rem;${ok === true ? 'color:var(--ok)' : ok === false ? 'color:var(--bad)' : ''}">${v}</div></div>`;
  $('#at-kpis').innerHTML = k(t('pressure'), fmt(P, P < 20 ? 1 : 0) + ' mbar') + k(t('mean_temp'), fmt(m.T, 0) + ' °C') + k(t('liquid_water'), m.liquid ? t('yes_sim') : t('no'), m.liquid) + k(t('armstrong'), m.armstrong ? t('above') : t('below'), m.armstrong) + k(t('boil_pt'), fmt(m.Tb, 0) + ' °C') + k(t('sky_blue'), Math.round(m.sky * 100) + '%') + k(t('breathable'), t('no'), false) + k(t('vs_inventory'), P <= 20 ? t('within_inv') : t('beyond_inv'), P <= 20);
}

// ================================================================== RESEARCH
let resSite = null;
function renderResearch() {
  resSite = resSite || state.siteKey;
  const rows = SITE_KEYS.map(k => { const s = SITES[k], e = globalElev(s.lat, s.lon); return `<tr><td>${esc(siteName(k))}</td><td class="mono">${fmtLat(s.lat)} ${fmtLon(s.lon)}</td><td class="mono">${fmt(e, 0)} m</td><td class="mono">${fmt(S.pressureModel(e), 0)} Pa</td><td>${s.measured.filter(m => m.st === 'MEASURED').map(m => `<div class="mono">${esc(m.k)}: ${esc(m.v)} <span class="muted">(${m.date})</span></div>`).join('') || '<span class="muted">—</span>'}</td></tr>`; }).join('');
  const curE = (() => { const e = new Float32Array(1); return globalElev(-4.5895, 137.4417); })();
  $('#res-root').innerHTML = `
  <div class="kicker">${t('nav_research')}</div><h2>${t('research_title')}</h2>
  <div class="note" style="margin-bottom:12px">${t('research_disclaimer')}</div>
  <div class="grid g2">
    <div class="card"><h3>${t('datasets')}</h3><table class="tb">
      <tr><th>${t('dataset')}</th><th>${t('use')}</th><th>${t('data_status')}</th></tr>
      <tr><td>MarsTopo719 (MGS MOLA, SH degree 719)</td><td>${t('use_topo')}</td><td>${badge('MEASURED')}</td></tr>
      <tr><td>GMM-3 gravity (degree 120)</td><td>${t('use_areoid')}</td><td>${badge('MODELLED')}</td></tr>
      <tr><td>REMS, MEDA, APSS/TWINS, RAD, CheMin, WCL</td><td>${t('use_obs')}</td><td>${badge('MEASURED')}</td></tr>
      <tr><td>Mars24 / Allison & McEwen 2000</td><td>${t('use_time')}</td><td>${badge('COMPUTED')}</td></tr>
      <tr><td>${t('proc_detail')}</td><td>${t('use_proc')}</td><td>${badge('SIMULATED')}</td></tr></table>
      ${srcLink('mola')}${srcLink('gmm3')}${srcLink('mars24')}</div>
    <div class="card"><h3>${t('validation')}</h3>
      <table class="tb"><tr><th>${t('point')}</th><th>${t('published')}</th><th>${t('this_model')}</th><th>Δ</th></tr>
      <tr><td>Curiosity / Bradbury Landing</td><td class="mono">−4500.97 m</td><td class="mono">${fmt(curE, 0)} m</td><td class="mono">${fmt(curE + 4500.97, 0)} m</td></tr>
      <tr><td>Olympus Mons summit</td><td class="mono">≈ 21–22 km</td><td class="mono">${fmt(ASSETS.site_olympus.max / 1000, 2)} km</td><td class="muted">${t('consistent')}</td></tr></table>
      <p class="muted">${t('validation_note')}</p>${srcLink('curiosityElev')}${srcLink('rad', ' (−4.4 km MOLA)')}</div>
  </div>
  <div class="card" style="margin-top:12px"><h3>${t('site_compare')}</h3><table class="tb"><tr><th>${t('site')}</th><th>${t('coords')}</th><th>${t('elevation')} (MOLA)</th><th>${t('pressure')} (${t('st_MODELLED')})</th><th>${t('observations')} (${t('st_MEASURED')})</th></tr>${rows}</table></div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><div class="row" style="justify-content:space-between"><h3>${t('profile')} ${badge('COMPUTED')}</h3>${siteChips(resSite, null, 'res-sites')}</div><div class="chartbox" style="height:280px"><canvas id="ch-prof"></canvas></div></div>
    <div class="card"><h3>${t('elev_compare')}</h3><div class="chartbox" style="height:280px"><canvas id="ch-elev"></canvas></div></div>
  </div>
  <div class="grid g2" style="margin-top:12px">
    <div class="card"><h3>${t('log')}</h3>
      <div class="muted">${t('samples')}: ${state.samples.length} · ${t('discoveries')}: ${Object.keys(state.discovered).length} · ${t('gh_placed_n')}: ${state.greenhouses.length} · ${t('gh_runs')}: ${state.ghRuns.length}</div>
      <table class="tb" style="margin-top:8px"><tr><th>ID</th><th>${t('site')}</th><th>${t('type')}</th><th>${t('coords')}</th><th>${t('elevation')}</th><th>MSD</th></tr>
      ${state.samples.map(s => `<tr><td class="mono">${s.id}</td><td>${esc(s.siteLabel)}</td><td>${esc(s.type)}</td><td class="mono">${fmtLat(s.lat)} ${fmtLon(s.lon)}</td><td class="mono">${fmt(s.elev, 0)}</td><td class="mono">${fmt(s.msd, 2)}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">${t('no_samples')}</td></tr>`}</table>
      <div class="row" style="margin-top:10px"><button class="btn" id="copy-md">${t('copy_summary')}</button><button class="btn" id="copy-json">${t('copy_json')}</button><button class="btn" id="reset-prog">${t('reset_progress')}</button></div>
      <textarea id="export-box" class="inp mono" style="width:100%;height:120px;margin-top:8px;display:none;font-size:.7rem" aria-label="Export text"></textarea>
    </div>
    <div class="card"><h3>${t('pipeline')}</h3><p class="muted">${t('pipeline_note')}</p>
<pre class="code">import numpy as np, pyshtools as pysh
topo = pysh.SHCoeffs.from_file('MarsTopo719.shape', lmax=719)       # MOLA shape (radius, m)
grav = pysh.SHGravCoeffs.from_file('gmm3_120_sha.tab', header=True,
         r0_index=0, gm_index=1, errors=True, header_units='km')
grav.set_omega(7.088218e-5)                                           # Mars rotation rate (rad/s)
geoid = grav.geoid(potref=12652804.7, r=3396000., order=2, lmax=719, extend=False)
r = topo.expand(grid='DH2', lmax=719, extend=False).data              # 0.125° grid
elev = r - (3396000. + geoid.geoid.data)                              # height above areoid (m)
# → sampled to 257×257 site patches (bicubic) and a 0.25° global grid, int16, gzip</pre></div>
  </div>
  <div class="card" style="margin-top:12px"><h3>${t('references')}</h3><ol style="color:var(--tx2);font-size:.82rem;line-height:1.6">${Object.values(SRC).map(s => `<li><a href="${s.u}" target="_blank" rel="noopener">${esc(s.t)}</a></li>`).join('')}</ol></div>`;
  $$('#res-sites button').forEach(b => b.onclick = () => { resSite = b.dataset.k; renderResearch(); });
  drawProfile();
  chart('ch-elev', { type: 'bar', data: { labels: SITE_KEYS.map(siteName), datasets: [{ label: t('elevation') + ' (m)', data: SITE_KEYS.map(k => globalElev(SITES[k].lat, SITES[k].lon)), backgroundColor: SITE_KEYS.map((_, i) => [CH.a, CH.b, CH.c, CH.d, CH.e][i]) }] }, options: baseOpts({ plugins: { legend: { display: false } } }) });
  $('#copy-md').onclick = () => exportText('md'); $('#copy-json').onclick = () => exportText('json');
  $('#reset-prog').onclick = () => { if ($('#reset-prog').dataset.arm) { Object.assign(state, { samples: [], greenhouses: [], discovered: {}, ghRuns: [], quiz: {}, labAnalysed: {}, leach: null, atmoRun: null }); saveProgress(); rebuildGreenhouses(); renderResearch(); renderMission(); toast(t('progress_reset')); } else { $('#reset-prog').dataset.arm = 1; $('#reset-prog').textContent = t('confirm_reset'); } };
  applyI18n($('#res-root'));
}
async function drawProfile() {
  const s = await loadSite(resSite); const N = s.N, mid = Math.floor(N / 2);
  const xs = Array.from({ length: N }, (_, i) => ((-s.half + i / (N - 1) * 2 * s.half) / 1000).toFixed(0));
  chart('ch-prof', { type: 'line', data: { labels: xs, datasets: [{ label: 'W–E (km)', data: Array.from({ length: N }, (_, i) => s.grid[mid * N + i]), borderColor: CH.a, pointRadius: 0, fill: false }, { label: 'N–S (km)', data: Array.from({ length: N }, (_, i) => s.grid[i * N + mid]), borderColor: CH.b, pointRadius: 0 }] }, options: baseOpts({ scales: { x: { title: { display: true, text: 'km', color: CH.tick }, ticks: { color: CH.tick, maxTicksLimit: 9 }, grid: { color: CH.grid } }, y: { title: { display: true, text: 'm', color: CH.tick }, ticks: { color: CH.tick }, grid: { color: CH.grid } } } }) });
}
function exportText(kind) {
  const mt = S.marsTime(Date.now());
  const data = { generated_utc: new Date().toISOString(), mars: { MY: mt.marsYear, Ls: +mt.Ls.toFixed(2), MSD: +mt.msd.toFixed(3) }, disclaimer: 'MarsBound research & education prototype — not a validated scientific instrument.', samples: state.samples, discoveries: state.discovered, greenhouses: state.greenhouses.map(g => ({ id: g.id, site: g.site, lat: g.lat, lon: g.lon, elev_m: Math.round(g.elev), pressure_model_Pa: Math.round(g.pModel) })), greenhouse_runs: state.ghRuns.map(r => ({ params: r.p, relative_yield: +r.rel.toFixed(3), led_kWh_m2_day: +r.kwh.toFixed(2), limiting: r.limiting, status: 'SIMULATED' })), leaching: state.leach ? { ...state.leach, status: 'SIMULATED' } : null, atmosphere_whatif: state.atmoRun ? { ...state.atmoRun, status: 'FICTIONAL WHAT-IF' } : null, sources: SRC };
  let txt = kind === 'json' ? JSON.stringify(data, null, 2) :
    `# MarsBound research summary\nGenerated ${data.generated_utc} · Mars Year ${mt.marsYear}, Ls ${mt.Ls.toFixed(1)}°, MSD ${mt.msd.toFixed(2)}\n\n> ${data.disclaimer}\n\n## Samples (${state.samples.length})\n` +
    state.samples.map(s => `- ${s.id} · ${s.siteLabel} · ${s.type} · ${fmtLat(s.lat)} ${fmtLon(s.lon)} · ${Math.round(s.elev)} m (MOLA) · MSD ${s.msd.toFixed(2)}`).join('\n') +
    `\n\n## Greenhouse runs (SIMULATED)\n` + state.ghRuns.map((r, i) => `- #${i + 1} ${r.p.crop}, PPFD ${r.p.ppfd}, ${r.p.photo} h, ${r.p.temp} °C, ${r.p.sub}: relative yield ${Math.round(r.rel * 100)}%, LED ${r.kwh.toFixed(2)} kWh/m²/day, limiting: ${r.limiting}`).join('\n') +
    `\n\n## Sources\n` + Object.values(SRC).map(s => `- ${s.t} — ${s.u}`).join('\n');
  const box = $('#export-box'); box.style.display = 'block'; box.value = txt; box.select();
  try { navigator.clipboard.writeText(txt).then(() => toast(t('copied')), () => toast(t('copy_manual'))); } catch (e) { toast(t('copy_manual')); }
}

// ================================================================== LEARN
const QUIZ = () => I18N.QUIZ[state.lang] || I18N.QUIZ.en;
function renderLearn() {
  const disc = Object.keys(state.discovered).length, sites = new Set(state.samples.map(s => s.site)).size;
  const ms = [
    [t('mission_a'), [[t('ob_discover', { n: 3 }), disc >= 3], [t('ob_samples', { n: 3 }), state.samples.length >= 3 && sites >= 2]], 'field'],
    [t('mission_b'), [[t('ob_lab'), Object.keys(state.labAnalysed).length >= 2], [t('ob_leach'), !!state.leach]], 'lab'],
    [t('mission_c'), [[t('ob_gh'), state.greenhouses.length > 0], [t('ob_ghruns'), state.ghRuns.length >= 2]], 'gh'],
    [t('mission_d'), [[t('ob_atmo'), !!state.atmoRun]], 'atmo'],
  ];
  const done = ms.flatMap(m => m[1]).filter(o => o[1]).length, total = ms.flatMap(m => m[1]).length;
  const Q = QUIZ(); const answered = Object.keys(state.quiz).length, correct = Object.values(state.quiz).filter(Boolean).length;
  $('#learn-root').innerHTML = `
  <div class="kicker">${t('nav_learn')}</div><h2>${t('learn_title')}</h2>
  <div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${t('progress')}</h3><span class="mono">${done}/${total}</span></div><div class="bar" style="margin-top:8px"><i style="width:${done / total * 100}%;background:var(--ok)"></i></div></div>
  <div class="grid g2">${ms.map(([name, obs, v]) => `<div class="card"><h3>${name}</h3><ul style="padding-inline-start:18px;line-height:1.7">${obs.map(([l, ok]) => `<li style="color:${ok ? 'var(--ok)' : 'var(--tx2)'}">${ok ? '✓' : '○'} ${esc(l)}</li>`).join('')}</ul><p class="muted">${t('lo_' + v)}</p><button class="btn sm" data-goto="${v}">${t('start_mission')}</button></div>`).join('')}</div>
  <div class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${t('quiz')}</h3><span class="mono">${correct}/${Q.length} ${t('correct')} · ${answered} ${t('answered')}</span></div>
  ${Q.map((q, i) => `<div style="margin-top:16px" id="q${i}"><div><b>${i + 1}.</b> ${esc(q.q)}</div>${q.o.map((o, j) => `<button class="quiz-opt ${state.quiz[i] != null ? (j === q.a ? 'right' : (state.quizPick && state.quizPick[i] === j ? 'wrong' : '')) : ''}" data-q="${i}" data-o="${j}" ${state.quiz[i] != null ? 'disabled' : ''}>${esc(o)}</button>`).join('')}${state.quiz[i] != null ? `<div class="note">${esc(q.e)}</div>` : ''}</div>`).join('')}
  <div class="row" style="margin-top:12px"><button class="btn sm" id="quiz-reset">${t('reset')}</button></div></div>
  <div class="card" style="margin-top:12px"><h3>${t('glossary')}</h3><dl style="color:var(--tx2);line-height:1.6">${I18N.GLOSS.map(([k, v]) => `<dt style="color:var(--tx);margin-top:8px">${esc(k)}</dt><dd style="margin:0">${esc(v)}</dd>`).join('')}</dl></div>`;
  $$('#learn-root [data-goto]').forEach(b => b.onclick = () => go(b.dataset.goto));
  $$('#learn-root .quiz-opt').forEach(b => b.onclick = () => { const i = +b.dataset.q, j = +b.dataset.o; state.quiz[i] = j === QUIZ()[i].a; state.quizPick = state.quizPick || {}; state.quizPick[i] = j; saveProgress(); renderLearn(); $('#q' + i).scrollIntoView({ block: 'nearest' }); announce(state.quiz[i] ? t('correct') : t('incorrect')); });
  $('#quiz-reset').onclick = () => { state.quiz = {}; state.quizPick = {}; saveProgress(); renderLearn(); };
}

// ================================================================== NAV / I18N / SETTINGS
function applyI18n(root = document) {
  $$('[data-i18n]', root).forEach(el => { el.textContent = t(el.dataset.i18n); });
}
function setLang(l) {
  state.lang = l; const L = I18N.LANGS[l]; document.documentElement.lang = L.bcp; document.documentElement.dir = L.rtl ? 'rtl' : 'ltr';
  ['#lang-top', '#lang-menu', '#lang-set'].forEach(s => $(s).value = l); applyI18n(); savePrefs(); if (globe.offset !== undefined) setGlobeOffset(globe.offset); renderSiteList(); renderMenuClock(); renderMission();
  const vb = $('#vr-slot button'); if (vb) vb.textContent = xrSession ? t('exit_vr') : t('enter_vr');
  if (state.view !== 'menu' && state.view !== 'globe' && state.view !== 'field') go(state.view, true);
}
function setMode(m) { state.mode = m; document.body.classList.remove('m-explore', 'm-student', 'm-research'); document.body.classList.add('m-' + m); $$('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m)); savePrefs(); }
async function go(v, rerender) {
  if (state.view === 'field' && v !== 'field' && document.pointerLockElement) document.exitPointerLock();
  state.view = v; $$('.view').forEach(el => el.classList.toggle('on', el.id === 'v-' + v));
  $('#top').style.display = v === 'menu' ? 'none' : 'flex';
  $$('#tabs button').forEach(b => b.toggleAttribute('aria-current', false)); const tb = $(`#tabs [data-view="${v}"]`); if (tb) tb.setAttribute('aria-current', 'page');
  orbit.enabled = v === 'globe' || v === 'menu'; orbit.autoRotate = v === 'menu' || (v === 'globe' && !globe.fly && orbit.autoRotate);
  if (v === 'menu') { orbit.autoRotate = true; renderMenuClock(); }
  setGlobeOffset(v === 'menu');
  if (v === 'globe') { renderSiteList(); }
  if (v === 'field') { $('#loader').classList.remove('hide'); ldSteps.innerHTML = ''; ldStep(t('ld_terrain'), 60); await new Promise(r => setTimeout(r, 30)); await enterSite(); $('#loader').classList.add('hide'); renderMission(); }
  if (v === 'env') renderEnv(); if (v === 'lab') renderLab(); if (v === 'gh') renderGH(); if (v === 'atmo') renderAtmo(); if (v === 'research') renderResearch(); if (v === 'learn') renderLearn();
  try { if (!rerender && location.hash !== '#' + v) history.replaceState(null, '', '#' + v); } catch (e) { }
  announce(t('nav_' + ({ globe: 'globe', field: 'field', env: 'env', lab: 'lab', gh: 'gh', atmo: 'atmo', research: 'research', learn: 'learn', menu: 'globe' }[v])));
}
function bindUI() {
  $$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.view));
  $$('[data-go]').forEach(b => b.onclick = () => { startAudio(); if (b.dataset.go === 'field') { state.siteKey = 'jezero'; state.custom = null; } go(b.dataset.go); });
  $('#brand').onclick = () => go('menu');
  $$('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  const opts = Object.entries(I18N.LANGS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  ['#lang-top', '#lang-menu', '#lang-set'].forEach(s => { $(s).innerHTML = opts; $(s).onchange = e => setLang(e.target.value); });
  $('#btn-settings').onclick = () => $('#m-settings').classList.add('on'); $$('[data-open=settings]').forEach(b => b.onclick = () => $('#m-settings').classList.add('on'));
  $$('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('on'));
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on'); }));
  addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal.on').forEach(m => m.classList.remove('on')); });
  $('#fs').value = state.fs; $('#fs').oninput = e => { state.fs = +e.target.value; document.documentElement.style.setProperty('--fs', state.fs + 'px'); savePrefs(); };
  const sw = (id, key, fn) => { const el = $(id); el.setAttribute('aria-checked', !!state[key]); el.onclick = () => { state[key] = !state[key]; el.setAttribute('aria-checked', state[key]); fn && fn(); savePrefs(); }; };
  sw('#sw-hc', 'hc', () => document.body.classList.toggle('hc', state.hc)); sw('#sw-rm', 'rm', () => document.body.classList.toggle('rm', state.rm));
  sw('#sw-cap', 'cap'); sw('#sw-snd', 'snd', () => { if (state.snd) startAudio(); }); sw('#sw-ac', 'ac');
  $('#q-sel').value = state.quality; $('#q-sel').onchange = e => { state.quality = e.target.value; applyQuality(); if (field.tile) buildTile(field.tile.cx, field.tile.cz); savePrefs(); };
  $('#ve-sel').value = state.ve; $('#ve-sel').onchange = e => { state.ve = +e.target.value; savePrefs(); if (state.view === 'field') { field.loadedSig = null; const keep = { x: player.x, z: player.z }; enterSite().then(() => { player.x = keep.x; player.z = keep.z; buildTile(Math.round(player.x / 50) * 50, Math.round(player.z / 50) * 50); player.y = groundH(player.x, player.z); }); } };
  $('#sens').value = state.sens; $('#sens').oninput = e => { state.sens = +e.target.value; savePrefs(); };
  $$('#texseg button').forEach(b => b.onclick = () => { globe.mat.map = b.dataset.tex === 'sci' ? globe.texSci : globe.texNat; globe.mat.needsUpdate = true; $$('#texseg button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $('#texseg button').setAttribute('aria-pressed', 'true');
  $('#exag-globe').onchange = e => { globe.exag = e.target.checked ? 10 : 1; globe.mat.displacementScale = 21229 / 3389500 * globe.exag; globe.markers.forEach(placeMarker); };
  const doSearch = () => { const r = parseCoords($('#coord-search').value); if (!r) { $('#coord-msg').textContent = t('search_fail'); return; } $('#coord-msg').textContent = ''; if (r.site) selectSite(r.site, true); else { flyGlobeTo(r.lat, r.lon); showGlobeInfo(r.lat, r.lon); } };
  $('#coord-go').onclick = doSearch; $('#coord-search').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
  $$('#moveseg button').forEach(b => b.onclick = () => setMove(b.dataset.move));
  $('#timesel').onchange = function () { const v = $('#timesel').value; if (v === 'live') state.timeMode = 'live'; else if (v === 'lapse') { state.timeMode = 'lapse'; state.lapseLtst = currentLtstSafe(); } else { state.timeMode = 'manual'; state.manualLtst = +v; } };
  $('#btn-dust').onclick = () => { state.dustStorm = !state.dustStorm; $('#btn-dust').setAttribute('aria-pressed', state.dustStorm); caption(t(state.dustStorm ? 'cap_storm_on' : 'cap_storm_off')); };
  $('#btn-collect').onclick = collectSample; $('#btn-gh').onclick = placeGreenhouse;
  $('#btn-brief').onclick = () => { startAudio(); const k = state.custom ? null : field.site && field.site.key; narrate(k ? `${siteName(k)}. ${t('sitedesc_' + k)}` : t('custom_note')); };
}
function currentLtstSafe() { try { return S.localTimes(S.marsTime(Date.now()), field.site ? field.site.lon0 : 0).ltst; } catch (e) { return 9; } }

// ================================================================== MAIN LOOP
let lastT = performance.now(), slowT = 0, fpsAcc = 0, fpsN = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (state.view === 'field' && field.site) {
    if (state.timeMode === 'lapse') state.lapseLtst = S.mod(state.lapseLtst + dt * 0.4, 24);
    updatePlayer(dt); updateEnvironment(dt); updatePOILabels();
    slowT += dt; if (slowT > 0.15) { slowT = 0; updateHUD(); drawMap($('#mm'), false); }
    renderer.render(field.scene, field.cam);
  } else {
    if (globe.fly) { globe.fly.t = Math.min(1, globe.fly.t + dt * 0.9); const k = smooth(0, 1, globe.fly.t); const p = globe.fly.from.clone().lerp(globe.fly.to, k); globe.cam.position.copy(p.setLength(lerp(globe.fly.from.length(), globe.fly.to.length(), k))); if (globe.fly.t >= 1) globe.fly = null; }
    orbit.update(); updateGlobeLabels();
    const covered = ['env', 'lab', 'gh', 'atmo', 'research', 'learn'].includes(state.view);
    if (!covered || (now % 1000) < 40) renderer.render(globe.scene, globe.cam);
    slowT += dt; if (slowT > 1) { slowT = 0; if (state.view === 'env') updateEnvClock(); if (state.view === 'menu') renderMenuClock(); }
  }
  updateAudio(dt);
}

async function boot() {
  try {
    if (!('DecompressionStream' in window)) throw new Error('This browser lacks DecompressionStream — please use a current Chrome, Edge, Firefox or Safari.');
    setMode(state.mode); document.documentElement.style.setProperty('--fs', state.fs + 'px'); document.body.classList.toggle('hc', state.hc); document.body.classList.toggle('rm', state.rm);
    ldStep('Decoding MOLA global topography (0.25° grid, 1440×720)…', 15); await new Promise(r => setTimeout(r, 20));
    const ga = ASSETS.global; DATA.global = { w: ga.w, h: ga.h, a: decodeGrid(await gunzipB64(ga.b64), ga.w, ga.h) };
    ldStep('Building 3D globe with areoid-referenced relief…', 45); await new Promise(r => setTimeout(r, 20));
    buildGlobe(); buildFieldScene();
    ldStep('Computing Mars time (Mars24 algorithm)…', 70);
    const mt = S.marsTime(Date.now()); ldStep(`Mars Year ${mt.marsYear} · Ls ${mt.Ls.toFixed(1)}° · MSD ${mt.msd.toFixed(2)}`, 85);
    bindUI(); applyQuality(); setLang(state.lang); setupVR();
    renderer.setAnimationLoop(frame);
    ldStep('Ready.', 100);
    setTimeout(() => $('#loader').classList.add('hide'), 450);
    const h = (location.hash || '').slice(1); const views = ['globe', 'field', 'env', 'lab', 'gh', 'atmo', 'research', 'learn'];
    go(views.includes(h) ? h : 'menu');
    window.__MB = { state, field, globe, player, go, S, groundH };
  } catch (e) {
    console.error(e); ldStep('Error: ' + e.message, 100);
  }
}
boot();
