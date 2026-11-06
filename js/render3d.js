// 3D Render: el entorno de 3D Camera Pin | Environment iluminado por un HDRI y un sol, en tres visores en lugar del
// visor de la app: a la derecha la cámara de la toma (se maximiza; arriba, Shadows y Quality), a la izquierda la vista
// de arriba (para ubicar el sol, con las herramientas Move y Rotate) y una vista libre. El sol sale del lugar, la fecha
// y la hora (como una calculadora de sol, js/sun-math.js) o se pone a mano (Artistic). El mundo de la app no tiene
// norte: el rumbo de la calle (Heading) dice hacia dónde apunta su −Z. El lugar y la fecha salen de la metadata del
// plate si la trae (los atributos estándar de OpenEXR latitude, longitude, capDate y utcOffset); si no, se elige en el
// mapa (OpenStreetMap, necesita internet), con un link de Google Maps o escrito.
// El entorno no se copia: se dibuja el mismo envRoot, que entra un momento en la escena de esta pestaña para cada
// dibujo (como en js/lane-cars.js). Mientras la pestaña está abierta sus materiales pasan a MeshStandardMaterial (para
// el HDRI y las sombras) y vuelven al salir; los autos son siempre los del car pack, aunque el entorno use cajas.
// Todavía no reemplaza las piezas por los assets de 3D Assets: mientras tanto van las del entorno (pendiente en docs/ROADMAP.md).
// Un solo WebGLRenderer fuera de pantalla (se crea al entrar) dibuja los tres visores y se copia a cada canvas 2D.
// El visor Render tiene dos motores: Raster (este archivo y js/render3d-fx.js) y Path trace (js/render3d-pt.js), con
// sus ajustes de calidad aparte (r3.pt). El cielo sin HDRI es de colores o físico (js/sky-math.js), igual en los dos.
// API: r3, r3dShow, r3dProjectState, r3dApplyProject.
const R3_QUALITY = { low: { px: 0.6, map: 1024, box: 45 }, med: { px: 1, map: 2048, box: 60 }, high: { px: 2, map: 4096, box: 80 } };
const R3_SUN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>';
const R3_LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const R3_TOP_BG = new THREE.Color(0.004, 0.0045, 0.0052); // lineal (ACEScg): casi negro después del Viewer
// los ajustes del path tracer (js/render3d-pt.js): van aparte de los de Raster, en el proyecto y en Reset
const R3_PT_DEF = { samples: 256, bounces: 5, res: '720', tiles: 2, dn: true, dnS: 5, glossy: 0.5, bg: 'env', focus: 'off', focusM: 3, fstop: 2.8 };
function r3PtOf(s) {
  s = s && typeof s === 'object' ? s : {};
  const D = R3_PT_DEF, num = (v, d, lo, hi) => { const x = Number.isFinite(+v) && v !== null && v !== '' ? +v : d; return Math.max(lo, Math.min(hi, x)); };
  return { samples: Math.round(num(s.samples, D.samples, 1, 16384)), bounces: Math.round(num(s.bounces, D.bounces, 1, 32)), res: ['720', '1080', 'plate'].includes(s.res) ? s.res : D.res,
    tiles: [1, 2, 3, 4].includes(+s.tiles) ? +s.tiles : D.tiles, dn: s.dn !== false, dnS: num(s.dnS, D.dnS, 0.5, 20), glossy: num(s.glossy, D.glossy, 0, 1),
    bg: ['env', 'alpha', 'plate'].includes(s.bg) ? s.bg : D.bg, focus: ['off', 'depthlab', 'manual'].includes(s.focus) ? s.focus : D.focus,
    focusM: num(s.focusM, D.focusM, 0.05, 10000), fstop: num(s.fstop, D.fstop, 0.5, 64) };
}
// el cielo físico (js/sky-math.js, Preetham): la turbidez y el albedo del suelo
function r3SkyOf(s) {
  const D = SKY_DEF, num = (v, d, lo, hi) => { const x = Number.isFinite(+v) && v !== null && v !== '' ? +v : d; return Math.max(lo, Math.min(hi, x)); };
  return { mode: s.skyMode === 'phys' ? 'phys' : 'colors', T: num(s.skyT, D.turbidity, 1.7, 10), alb: num(s.skyAlb, D.albedo, 0, 1) };
}
// el sol marcado en el HDRI (js/sun-math.js: sunFromHdri): u de 0 a 1 en la imagen del archivo y la altura en grados
const r3HdriSunOf = (v) => v && Number.isFinite(+v.u) && Number.isFinite(+v.el) ? { u: ((+v.u % 1) + 1) % 1, el: Math.max(-10, Math.min(90, +v.el)) } : null;
const r3ViewsOf = (v) => { const ok = (x) => R3_VIEWS.some(e => e[0] === x) ? x : 'aces709'; v = v || {}; return { shot: ok(v.shot), top: ok(v.top), free: ok(v.free) }; };
const r3 = (() => {
  const s = lsGet('r3', {}) || {}, num = (v, d) => Number.isFinite(+v) && v !== null && v !== '' ? +v : d;
  const today = new Date(), pad = (n) => String(n).padStart(2, '0');
  return {
    on: false, gl: null, raf: 0, scene: null, sun: null, hemi: null, panes: {}, tool: s.tool === 'rotate' ? 'rotate' : 'move',
    max: !!s.max, shadows: s.shadows !== false, quality: R3_QUALITY[s.quality] ? s.quality : 'high',
    hdri: { name: '', on: s.hdriOn !== false, cs: s.hdriCs === 'acescg' ? 'acescg' : 'lin', rot: num(s.hdriRot, 0), int: num(s.hdriInt, 1), bg: s.hdriBg !== false, src: null, tex: null, env: null,
      lock: !!s.hdriLock, sun: r3HdriSunOf(s.hdriSun), prev: null, raf: 0 },
    loc: { lat: num(s.lat, NaN), lon: num(s.lon, NaN), src: s.locSrc === 'manual' ? 'manual' : '' },
    date: /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') ? s.date : `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    time: /^\d{1,2}:\d{2}$/.test(s.time || '') ? s.time : '12:00', utc: num(s.utc, -today.getTimezoneOffset() / 60), dtSrc: s.dtSrc === 'manual' ? 'manual' : '',
    heading: num(s.heading, 0), sunMode: s.sunMode === 'art' || s.hdriLock ? 'art' : 'auto', az: num(s.az, 0), el: num(s.el, 45),
    sunInt: num(s.sunInt, 2.4), sunCol: /^#[0-9a-f]{6}$/i.test(s.sunCol || '') ? s.sunCol : '#fff4e5', exp: num(s.exp, 0),
    mats: new Map(), swapped: false, map: { z: 15, lat: NaN, lon: NaN, imgs: {}, aim: false, off: 0 },
    // calidad del visor RENDER y de los renders finales (js/render3d-fx.js)
    hq: !!s.hq, samples: Math.max(1, Math.min(4096, Math.round(num(s.samples, 64)))), sunSize: num(s.sunSize, 0.53), ao: s.ao !== false, aoInt: num(s.aoInt, 0.25), aoDist: num(s.aoDist, 1.5), aoSamples: Math.max(4, Math.min(64, Math.round(num(s.aoSamples, 16)))),
    gi: s.gi !== false, giInt: num(s.giInt, 1), refl: s.refl !== false, mb: !!s.mb, shutter: num(s.shutter, 180), plate: !!s.plate, outScale: [1, 0.5, 0.25].includes(+s.outScale) ? +s.outScale : 1,
    post: { on: !!s.postOn, bloom: num(s.bloom, 0.25), bloomR: num(s.bloomR, 0.4), bloomT: num(s.bloomT, 0.9), vig: num(s.vig, 0.25), grain: num(s.grain, 0.02), sat: num(s.sat, 1), con: num(s.con, 1) },
    need: { shot: true, top: true, free: true }, sideT: 0, shadowOk: false,
    fx: null, reset: true, busy: false, cancel: false, giT: 0, probe: null,
    // la luz de cielo sin HDRI, la cámara de Shakelab y lo editado de los materiales
    // el Viewer de cada visor (js/render3d-color.js); los renders salen con el de Render
    views: r3ViewsOf(s.views),
    skyInt: num(s.skyInt, 0.6), skyCol: /^#[0-9a-f]{6}$/i.test(s.skyCol || '') ? s.skyCol : '#bfd4ff', gndCol: /^#[0-9a-f]{6}$/i.test(s.gndCol || '') ? s.gndCol : '#4a4238',
    // los materiales editados viven en el proyecto, no en el navegador: un reload los borra
    useShk: !!s.useShk, matEdits: {}, matSel: '', picking: false, camKeep: null, sunPick: false,
    // el motor del visor Render y los ajustes del path tracer; el cielo sin HDRI
    engine: 'raster', pt: r3PtOf(s.pt), skyMode: r3SkyOf(s).mode, sky: r3SkyOf(s),
    // la cámara libre del visor Render (los dos motores): nunca toca la de la toma; navCam es la que mira orbNav
    free: false, orbit: { yaw: 0, pitch: 0, dist: 10, t: new THREE.Vector3() }, navCam: new THREE.PerspectiveCamera(),
  };
})();
function r3State() {
  return { tool: r3.tool, max: r3.max, shadows: r3.shadows, quality: r3.quality, hdriCs: r3.hdri.cs, hdriRot: r3.hdri.rot, hdriInt: r3.hdri.int, hdriBg: r3.hdri.bg, hdriOn: r3.hdri.on, hdriLock: r3.hdri.lock, hdriSun: r3.hdri.sun,
    hdriName: r3.hdri.name, lat: r3.loc.lat, lon: r3.loc.lon, locSrc: r3.loc.src, date: r3.date, time: r3.time, utc: r3.utc, dtSrc: r3.dtSrc,
    heading: r3.heading, sunMode: r3.sunMode, az: r3.az, el: r3.el, sunInt: r3.sunInt, sunCol: r3.sunCol, exp: r3.exp,
    hq: r3.hq, samples: r3.samples, sunSize: r3.sunSize, ao: r3.ao, aoInt: r3.aoInt, aoDist: r3.aoDist, aoSamples: r3.aoSamples, gi: r3.gi, giInt: r3.giInt, refl: r3.refl, mb: r3.mb, shutter: r3.shutter, plate: r3.plate, outScale: r3.outScale,
    postOn: r3.post.on, bloom: r3.post.bloom, bloomR: r3.post.bloomR, bloomT: r3.post.bloomT, vig: r3.post.vig, grain: r3.post.grain, sat: r3.post.sat, con: r3.post.con,
    views: Object.assign({}, r3.views), skyInt: r3.skyInt, skyCol: r3.skyCol, gndCol: r3.gndCol, useShk: r3.useShk, matEdits: r3.matEdits,
    engine: r3.engine, pt: Object.assign({}, r3.pt), skyMode: r3.skyMode, skyT: r3.sky.T, skyAlb: r3.sky.alb };
}
// sin los materiales (van sólo al proyecto) ni el motor: al abrir la app es siempre Raster (el path tracer arma su escena
// recién cuando se lo elige)
function r3Save() { const s = r3State(); delete s.matEdits; delete s.engine; lsSet('r3', s); }
const r3Fmt = (v, d = 1) => Number.isFinite(v) ? (+v).toFixed(d) : '–';
const r3Wrap = (a) => ((a % 360) + 360) % 360;

// ---------- Lo que dice la metadata del plate ----------
// OpenEXR: latitude / longitude (grados), capDate "YYYY:MM:DD hh:mm:ss" (hora local) y utcOffset (segundos: UTC = local + utcOffset)
function r3Meta() {
  const A = st.metaAttrs && st.metaAttrs.list; if (!A) return null;
  const find = (re) => { const a = A.find(x => re.test(x.k)); return a ? a.v : undefined; };
  const lat = parseFloat(find(/(^|[.:_])latitude$/i)), lon = parseFloat(find(/(^|[.:_])longitude$/i));
  const cd = /(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{1,2}):(\d{2})/.exec(find(/(^|[.:_])capDate$/i) || '');
  const off = parseFloat(find(/(^|[.:_])utcOffset$/i));
  const out = { file: st.metaAttrs.file || 'the plate' };
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) { out.lat = lat; out.lon = lon; }
  if (cd) { out.date = `${cd[1]}-${cd[2]}-${cd[3]}`; out.time = `${cd[4].padStart(2, '0')}:${cd[5]}`; if (Number.isFinite(off)) out.utc = -off / 3600; }
  return out.lat !== undefined || out.date ? out : null;
}
// lo de la metadata manda mientras no se haya cambiado a mano
function r3FromMeta() {
  const m = r3Meta(); if (!m) return false;
  let ch = false;
  if (m.lat !== undefined && r3.loc.src !== 'manual' && (r3.loc.lat !== m.lat || r3.loc.lon !== m.lon || r3.loc.src !== 'meta')) { r3.loc = { lat: m.lat, lon: m.lon, src: 'meta' }; ch = true; }
  if (m.date && r3.dtSrc !== 'manual' && (r3.date !== m.date || r3.time !== m.time || r3.dtSrc !== 'meta')) { r3.date = m.date; r3.time = m.time; if (m.utc !== undefined) r3.utc = m.utc; r3.dtSrc = 'meta'; ch = true; }
  return ch;
}

// ---------- El sol ----------
function r3SunCalc() {
  if (r3.sunMode !== 'auto') return null;
  if (!Number.isFinite(r3.loc.lat) || !Number.isFinite(r3.loc.lon)) return null;
  const ms = sunUTC(r3.date, r3.time, r3.utc); if (!Number.isFinite(ms)) return null;
  return sunPosition(ms, r3.loc.lat, r3.loc.lon);
}
// el sol trabado al HDRI (Lock the sun to the HDRI): sale del punto marcado en el HDRI, con su giro y el rumbo de la calle
const r3HdriLock = () => { const H = r3.hdri; return !!(H.lock && H.sun && H.name && H.on); };
function r3SunNow() {
  if (r3HdriLock()) { const H = r3.hdri, s = sunFromHdri(H.sun.u, H.sun.el, H.rot, r3.heading); r3.az = r3Wrap(s.az); r3.el = Math.max(-10, Math.min(90, s.el)); return { az: r3.az, el: r3.el }; }
  const c = r3SunCalc(); if (c) { r3.az = c.az; r3.el = c.el; } return { az: r3.az, el: r3.el };
}
// pasar a mano: el sol queda donde estaba y desde ahí se mueve. Trabado al HDRI sólo gira, y lo que gira es el HDRI:
// la altura es la del sol del HDRI hasta destrabarlo
function r3SetSun(az, el, fromTool) {
  if (r3HdriLock()) {
    const H = r3.hdri;
    if (fromTool && Math.abs(el - H.sun.el) > 0.5 && performance.now() - (r3.lockToastT || 0) > 4000) {
      r3.lockToastT = performance.now(); toast('The sun is locked to the HDRI: it only turns, and the HDRI turns with it. Unlock it to change its height.');
    }
    r3SetHdriRot(sunHdriRot(H.sun.u, az, r3.heading));
    r3Dirty('top'); return;
  }
  if (r3.sunMode !== 'art') { r3.sunMode = 'art'; if (fromTool) toast('Sun: Artistic (placed by hand). Place and time puts it back where it was that day.'); }
  r3.az = r3Wrap(az); r3.el = Math.max(-10, Math.min(90, el));
  r3Save(); r3Panel(); r3Dirty(); r3Dirty('top'); // el sol en la vista de arriba, sin esperar
}
// el sol calculado (Place and time, la fecha, la hora, From metadata): el sol del HDRI se destraba
function r3SunAuto() {
  if (r3.hdri.lock) { r3.hdri.lock = false; toast('Sun unlocked from the HDRI: Place and time puts it where it was that day'); }
  r3.sunMode = 'auto';
}
// trabar o destrabar el sol al HDRI: al trabarlo queda donde está, y el HDRI y el sol giran juntos desde ahí
function r3HdriSetLock(on) {
  const H = r3.hdri;
  if (on) {
    if (!H.name || !H.on) { toast(H.name ? 'Turn the HDRI on (Use the HDRI) to lock the sun to it' : 'Load an HDRI first', true); r3Panel(); return; }
    const s = r3SunNow(); H.sun = r3HdriSunOf(sunToHdri(s.az, s.el, H.rot, r3.heading)); H.lock = true; r3.sunMode = 'art';
    toast('Sun locked to the HDRI: turning the HDRI turns the sun, and moving the sun turns the HDRI');
  } else if (H.lock) { H.lock = false; toast('Sun unlocked from the HDRI: it moves on its own again'); }
  r3Save(); r3Panel(); r3Dirty(); r3Dirty('top');
}
// el giro del HDRI: la textura se rehace una vez por cuadro aunque el giro cambie más seguido (arrastrar el sol trabado)
function r3SetHdriRot(v) {
  const H = r3.hdri; H.rot = Math.round((((v + 180) % 360 + 360) % 360 - 180) * 100) / 100;
  if (!H.raf) H.raf = requestAnimationFrame(() => { H.raf = 0; r3HdriBuild(); r3GiSoon(); });
  r3Save(); r3Panel(); r3Dirty();
}

// ---------- Escena ----------
function r3Init() {
  if (r3.gl) return true;
  // alpha: el plate detrás del path trace (js/render3d-pt.js); Raster siempre dibuja opaco
  try { r3.gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true }); } catch (e) { toast('3D Render: no WebGL', true); return false; }
  const gl = r3.gl; glKeep(gl, () => { r3.giT = 0; r3Dirty(); });
  gl.outputColorSpace = THREE.SRGBColorSpace; gl.toneMapping = THREE.ACESFilmicToneMapping; gl.shadowMap.enabled = true;
  r3.scene = new THREE.Scene();
  r3.sun = new THREE.DirectionalLight(0xffffff, 2.4 * Math.PI); r3.sun.castShadow = true;
  r3.sun.shadow.bias = -0.0004; r3.sun.shadow.normalBias = 0.03;
  r3.scene.add(r3.sun, r3.sun.target);
  r3.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4238, 0.6 * Math.PI); r3.scene.add(r3.hemi);
  r3.probe = new THREE.LightProbe(); r3.probe.intensity = 0; r3.scene.add(r3.probe); // GI (js/render3d-fx.js)
  // la cámara de la toma en las vistas de arriba y libre: el cuerpo y las cuatro aristas del cuadro, 12 m
  r3.camGizmo = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb74d, depthTest: false, transparent: true }));
  r3.camGizmo.renderOrder = 10; r3.camGizmo.frustumCulled = false; r3.scene.add(r3.camGizmo);
  r3.pmrem = new THREE.PMREMGenerator(gl);
  r3ApplyQuality();
  return true;
}
// best: Max quality y los renders finales (sombras de 4096)
function r3ApplyQuality(best = r3.hq) {
  const q = R3_QUALITY[best ? 'high' : r3.quality], gl = r3.gl; if (!gl) return;
  // siempre PCF: r187 sacó PCFSoftShadowMap y lo cambia por PCF recién al dibujar la sombra; Top y Free, que reusan la
  // sombra de Render sin redibujarla, compilaban sus shaders con el tipo viejo y no dibujaban nada
  const type = THREE.PCFShadowMap;
  if (gl.shadowMap.type !== type) { gl.shadowMap.type = type; for (const m of r3.mats.values()) m.needsUpdate = true; }
  const s = r3.sun.shadow;
  if (s.mapSize.x !== q.map) { s.mapSize.set(q.map, q.map); if (s.map) { s.map.dispose(); s.map = null; } }
  const c = s.camera; c.left = c.bottom = -q.box; c.right = c.top = q.box; c.near = 1; c.far = 900; c.updateProjectionMatrix();
}
// el punto del piso debajo de la cámara de la toma (y un poco adelante): el centro de la vista de arriba y de las sombras
function r3Center() {
  camera.updateMatrixWorld();
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); f.y = 0;
  const c = camera.position.clone(); c.y = 0;
  if (f.lengthSq() > 1e-6) c.addScaledVector(f.normalize(), 12);
  return c;
}
function r3CamGizmo() {
  camera.updateMatrixWorld();
  const inv = new THREE.Matrix4().copy(camera.projectionMatrix).invert(), p = camera.position, pts = [];
  const corner = (x, y) => new THREE.Vector3(x, y, 0.5).applyMatrix4(inv).applyMatrix4(camera.matrixWorld).sub(p).normalize().multiplyScalar(12).add(p);
  const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  for (let i = 0; i < 4; i++) { pts.push(p, cs[i], cs[i], cs[(i + 1) % 4]); }
  r3.camGizmo.geometry.setFromPoints(pts);
}
// los materiales del entorno tienen nombre (el editor de materiales y lo guardado se ubican por él)
for (const [pre, M] of [['Street', typeof ENV_MAT !== 'undefined' ? ENV_MAT : null], ['Rail', typeof RAIL_MAT !== 'undefined' ? RAIL_MAT : null]])
  if (M) for (const [k, m] of Object.entries(M)) if (m && m.isMaterial && !m.name) m.name = `${pre} · ${k}`;
// materiales del entorno: una copia física (MeshPhysicalMaterial) mientras la pestaña está abierta (el HDRI, las sombras,
// el editor de materiales); los de las otras pestañas no se tocan y vuelven al salir
function r3StdOf(m) {
  if (!m || m.isLineBasicMaterial || m.isPointsMaterial || m.isShaderMaterial || m.userData.r3) return m;
  let s = r3.mats.get(m); if (s) return s;
  if (m.isMeshStandardMaterial) { // el car pack (glTF): ya es físico y lineal; se copia para poder editarlo sin tocar el original
    s = new THREE.MeshPhysicalMaterial();
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'roughness', 'metalness', 'emissiveIntensity', 'opacity', 'transparent', 'side', 'vertexColors', 'alphaTest', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits'])
      if (m[k] !== undefined) s[k] = m[k];
    s.color.copy(m.color); s.emissive.copy(m.emissive); if (m.normalScale) s.normalScale.copy(m.normalScale);
    if (m.isMeshPhysicalMaterial) for (const k of ['clearcoat', 'clearcoatRoughness', 'transmission', 'ior']) s[k] = m[k];
  } else {
    const rough = m.isMeshPhongMaterial ? Math.max(0.08, 1 - Math.min(1, (m.shininess || 30) / 110)) : 0.9;
    s = new THREE.MeshPhysicalMaterial({ color: m.color ? m.color.clone() : 0xffffff, map: m.map || null, vertexColors: !!m.vertexColors, roughness: rough, metalness: 0,
      side: m.side, transparent: false, opacity: 1, polygonOffset: !!m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor || 0, polygonOffsetUnits: m.polygonOffsetUnits || 0 });
    // los colores del entorno son de pantalla (sRGB) y three r147 los usa tal cual: para la luz van lineales
    if (s.color) s.color.convertSRGBToLinear();
    if (m.emissive) s.emissive.copy(m.emissive).convertSRGBToLinear();
  }
  // a ACEScg (js/render3d-color.js): los colores acá; las texturas de color se leen como sRGB y el shader las pasa
  r3ColorToWs(s.color); r3ColorToWs(s.emissive);
  for (const k of ['map', 'emissiveMap']) if (s[k]) s[k] = r3SrgbTex(s[k]);
  r3WsPatch(s);
  s.name = m.name || `Material ${r3.mats.size + 1}`; s.userData.r3 = true; s.userData.r3Src = m;
  s.userData.r3Base = r3MatRead(s); r3MatApply(s);
  r3.mats.set(m, s); return s;
}
// una textura de color de las otras pestañas leída como sRGB: una copia (la original queda como está)
const r3SrgbTexs = new Map();
function r3SrgbTex(t) {
  if (!t || t.colorSpace === THREE.SRGBColorSpace || t.isDataTexture || t.isVideoTexture) return t;
  let c = r3SrgbTexs.get(t); if (!c) { c = t.clone(); c.colorSpace = THREE.SRGBColorSpace; c.needsUpdate = true; r3SrgbTexs.set(t, c); }
  return c;
}
// lo editable de un material (el editor de materiales y lo guardado en el proyecto: colores en lineal Rec.709; la
// copia del render los tiene en ACEScg)
function r3MatRead(s) { return { color: r3WsTo709(s.color.toArray()), rough: s.roughness, metal: s.metalness, cc: s.clearcoat, trans: s.transmission, emis: r3WsTo709(s.emissive.toArray()), emisInt: s.emissiveIntensity }; }
function r3MatApply(s) {
  const e = Object.assign({}, s.userData.r3Base, r3.matEdits[s.name] || {});
  s.color.fromArray(r3M3(R3_709_TO_AP1, e.color)); s.roughness = e.rough; s.metalness = e.metal; s.clearcoat = e.cc; s.transmission = e.trans;
  s.emissive.fromArray(r3M3(R3_709_TO_AP1, e.emis)); s.emissiveIntensity = e.emisInt;
  if (s.transmission > 0 && !s.userData.r3TransWas) { s.userData.r3TransWas = true; s.needsUpdate = true; }
}
function r3Swap(on) {
  envRoot.traverse(o => {
    if (!o.isMesh) return;
    if (on) {
      if (o.userData.r3Mat !== undefined) return;
      o.userData.r3Mat = o.material;
      o.material = Array.isArray(o.material) ? o.material.map(r3StdOf) : r3StdOf(o.material);
      o.userData.r3Sh = [o.castShadow, o.receiveShadow]; o.castShadow = o.receiveShadow = true;
      if (o.isInstancedMesh && o.instanceColor && !o.userData.r3Col) { // los colores por instancia (autos, gente, fachadas), también a lineal
        const a = o.instanceColor.array; o.userData.r3Col = a.slice();
        for (let i = 0; i < a.length; i++) { const c = a[i]; a[i] = c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4); }
        o.instanceColor.needsUpdate = true;
      }
    } else if (o.userData.r3Mat !== undefined) {
      o.material = o.userData.r3Mat; [o.castShadow, o.receiveShadow] = o.userData.r3Sh || [false, false];
      if (o.userData.r3Col) { o.instanceColor.array.set(o.userData.r3Col); o.instanceColor.needsUpdate = true; delete o.userData.r3Col; }
      delete o.userData.r3Mat; delete o.userData.r3Sh;
    }
  });
  r3.swapped = on;
}
// la luz del entorno que llega a los materiales: el HDRI con su intensidad; el cielo sin HDRI y la captura de la escena
// ya traen la suya adentro. En r187 los materiales que toman scene.environment usan scene.environmentIntensity y no su
// envMapIntensity: va en los dos
function r3MatsUpdate() {
  const k = r3.scene && r3.scene.environment === r3.hdri.env ? r3.hdri.int : 1;
  for (const s of r3.mats.values()) { s.envMapIntensity = k; }
  if (r3.scene) r3.scene.environmentIntensity = k;
}
// el cielo sin HDRI como entorno: de colores (Sky color arriba, Ground color abajo) o físico (js/sky-math.js, con el sol
// de la pestaña), por Sky light: la luz de cielo y lo que reflejan la pintura, el vidrio y el metal. Equirectangular
// chico; se rehace sólo si cambió algo. r3SkyData lo da en lineal Rec.709 (el path tracer lo usa así); Raster, en ACEScg
function r3SkySun() { const s = r3SunNow(); return { s, dir: sunWorldDir(s.az, s.el, r3.heading) }; }
function r3SkyKeyNow() {
  if (r3.skyMode !== 'phys') return ['c', r3.skyCol, r3.gndCol, r3.skyInt].join('|');
  const { s } = r3SkySun(), K = r3.sky;
  return ['p', s.az.toFixed(2), s.el.toFixed(2), r3.heading, r3.skyInt, r3.sunInt, K.T, K.alb].join('|');
}
function r3SkyData() {
  if (r3.skyMode === 'phys') {
    const { s, dir } = r3SkySun(), K = r3.sky, w = 128, h = 64;
    const sunE = s.el > -1 ? r3.sunInt * Math.PI * Math.min(1, (s.el + 1) / 4) * Math.max(0, Math.sin(s.el * Math.PI / 180)) : 0; // la del sol de la pestaña sobre el piso
    return { w, h, data: skyBake(w, h, dir, { turbidity: K.T, albedo: K.alb, k: SKY_K * r3.skyInt / 0.6, sunE }) };
  }
  const w = 64, h = 32, d = new Float32Array(w * h * 4), lin = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => r3SrgbToLin(v / 255)); };
  const top = lin(r3.skyCol), bot = lin(r3.gndCol), k = r3.skyInt;
  for (let y = 0; y < h; y++) {
    const s = Math.sin(((y + 0.5) / h - 0.5) * Math.PI); // fila 0 abajo (v = 0)
    const t = Math.max(0, Math.min(1, (s + 0.04) / 0.12)), f = t * t * (3 - 2 * t); // el horizonte, suave
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; for (let c = 0; c < 3; c++) d[o + c] = k * (bot[c] + (top[c] - bot[c]) * f); d[o + 3] = 1; }
  }
  return { w, h, data: d };
}
function r3SkyEnv() {
  const key = r3SkyKeyNow();
  if (r3.skyEnv && r3.skyKey === key) return r3.skyEnv;
  const { w, h, data } = r3SkyData(), d = new Float32Array(data.length), M = R3_709_TO_AP1; // a ACEScg
  for (let i = 0; i < data.length; i += 4) { const r = data[i], g = data[i + 1], b = data[i + 2]; d[i] = M[0] * r + M[1] * g + M[2] * b; d[i + 1] = M[3] * r + M[4] * g + M[5] * b; d[i + 2] = M[6] * r + M[7] * g + M[8] * b; d[i + 3] = 1; }
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.flipY = false; t.needsUpdate = true;
  if (r3.skyEnvRT) r3.skyEnvRT.dispose(); if (r3.skyTex) r3.skyTex.dispose();
  r3.skyTex = t; r3.skyEnvRT = r3.pmrem.fromEquirectangular(t); r3.skyEnv = r3.skyEnvRT.texture; r3.skyKey = key;
  return r3.skyEnv;
}
// mientras la pestaña está abierta: los autos del car pack aunque el entorno use cajas, y sólido aunque esté en wireframe
for (const id of Object.keys(ENV_MODULES)) {
  const mod = ENV_MODULES[id], f = mod.build;
  mod.build = function (p, ...a) { return f.call(this, r3.on && p && p.carsrc === 'simple' ? Object.assign({}, p, { carsrc: 'pack' }) : p, ...a); };
}
{ const f = envRebuild; envRebuild = function (...a) {
  if (!r3.on) return f(...a);
  const d = env.display; env.display = 'solid'; r3Swap(false);
  try { return f(...a); } finally { env.display = d; r3Swap(true); r3MatsUpdate(); if (r3.engine === 'pt') r3PtDispose(); r3Dirty(); r3MatUI(); } // el path tracer se rearma con el entorno nuevo
}; }

// ---------- HDRI ----------
async function r3LoadHdri(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  let d;
  try {
    const buf = await file.arrayBuffer();
    if (ext === 'exr') { const l = new THREE.EXRLoader(); l.setDataType(THREE.FloatType); d = l.parse(buf); }
    else if (ext === 'hdr') { const l = new THREE.HDRLoader(); l.setDataType(THREE.FloatType); d = l.parse(buf); d.flip = true; }
    else throw new Error('use an .hdr or .exr');
    if (!d || !d.data || !d.width) throw new Error('no image data');
  } catch (e) { console.error(e); toast(`Could not read ${file.name}: ${e && e.message || e}`, true); return; }
  // copia en float RGBA, achicada a 2048 de ancho como mucho (promedio por bloques: el sol del HDRI no se pierde)
  const W = d.width, H = d.height, ch = Math.round(d.data.length / (W * H)), f = Math.max(1, Math.ceil(W / 2048));
  const w = Math.floor(W / f), h = Math.floor(H / f), out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < f; j++) { const sy = d.flip ? H - 1 - (y * f + j) : y * f + j; for (let i = 0; i < f; i++) { const k = (sy * W + x * f + i) * ch; r += d.data[k]; g += d.data[k + 1]; b += d.data[k + 2]; } }
    const n = f * f, o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 1;
  }
  // otro archivo: su sol está en otro lado (el mismo, vuelto a cargar después de abrir el proyecto, lo conserva)
  if (file.name !== r3.hdri.name) { r3.hdri.lock = false; r3.hdri.sun = null; }
  r3.hdri.src = { w, h, data: out }; r3.hdri.name = file.name; r3.hdri.prev = null;
  r3HdriBuild(); r3Save(); r3Panel();
  toast(`HDRI ${file.name}: ${W} × ${H}${f > 1 ? `, lit from a ${w} × ${h} copy` : ''}`);
}
// el HDRI con su espacio de color y su giro (las columnas corridas: r147 no gira el environment), y su PMREM
function r3HdriBuild() {
  const H = r3.hdri, s = H.src;
  if (H.tex) { H.tex.dispose(); H.tex = null; } if (H.envRT) { H.envRT.dispose(); H.envRT = null; } else if (H.env) H.env.dispose(); H.env = null;
  if (!s || !r3.gl || !H.on) { r3Lights(); return; } // apagado: el cielo de colores o el físico, con el archivo cargado
  const { w, h } = s, data = new Float32Array(w * h * 4), sh = Math.round(r3Wrap(H.rot) / 360 * w) % w, M = H.cs === 'acescg' ? null : R3_709_TO_AP1; // a ACEScg, el espacio de trabajo
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + ((x + sh) % w)) * 4, o = (y * w + x) * 4, r = s.data[i], g = s.data[i + 1], b = s.data[i + 2];
    if (M) { data[o] = M[0] * r + M[1] * g + M[2] * b; data[o + 1] = M[3] * r + M[4] * g + M[5] * b; data[o + 2] = M[6] * r + M[7] * g + M[8] * b; }
    else { data[o] = r; data[o + 1] = g; data[o + 2] = b; }
    data[o + 3] = 1;
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.flipY = false; t.needsUpdate = true;
  H.tex = t; H.envRT = r3.pmrem.fromEquirectangular(t); H.env = H.envRT.texture;
  r3Lights();
}
function r3Lights() {
  if (!r3.scene) return;
  const H = r3.hdri;
  // el entorno de base: el HDRI o el cielo; con Scene reflections, la captura de la escena (que lo lleva adentro)
  r3.baseEnv = H.env || (r3.pmrem ? r3SkyEnv() : null);
  r3.scene.environment = r3.refl && r3.reflEnv ? r3.reflEnv : r3.baseEnv;
  // sin HDRI, el fondo es el color del cielo (Sky color), un poco más oscuro que la luz que da, y baja con su slider; el
  // cielo físico se ve entero
  r3.scene.background = H.tex && H.bg ? H.tex : !H.tex && r3.skyMode === 'phys' && r3.skyTex ? r3.skyTex : new THREE.Color().fromArray(r3HexToWs(H.tex ? '#8ea9c8' : r3.skyCol)).multiplyScalar(H.tex ? Math.min(1, H.int) : 0.75 * Math.min(1, r3.skyInt / 0.6));
  r3.scene.backgroundIntensity = H.tex && H.bg ? H.int : 1; // el fondo baja con el slider (en 0, negro)
  r3.hemi.intensity = r3.baseEnv ? 0 : r3.skyInt * Math.PI; // la luz de cielo ahora es el entorno (el cielo de r3SkyEnv), que también llega a 0
  r3.hemi.color.fromArray(r3HexToWs(r3.skyCol)); r3.hemi.groundColor.fromArray(r3HexToWs(r3.gndCol)); // en ACEScg
  r3MatsUpdate(); r3Dirty();
}

// ---------- Vista: tres visores en lugar del visor ----------
function r3Build() {
  const box = document.createElement('div');
  box.className = 'r3v'; box.id = 'r3v'; box.hidden = true; box.dataset.tour = 'render3d.view';
  const vmid = document.querySelector('.viewer > .vmid'); vmid.parentNode.insertBefore(box, vmid.nextSibling);
  const maxSvg = '<svg viewBox="0 0 24 24"><path class="a3-out" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path class="a3-in" d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>';
  box.innerHTML = `<div class="r3tools" role="toolbar" aria-label="Sun tools">
      <button class="tool" data-tool="move" title="Move the sun (W): drag it in the top view; the centre is overhead, the circle is the horizon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg><kbd>W</kbd></button>
      <button class="tool" data-tool="rotate" title="Rotate the sun (E): drag around the centre of the top view to turn it, keeping its height"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4v4h-4"/></svg><kbd>E</kbd></button>
    </div>
    <div class="r3left">
      <section class="impp r3p" data-k="top"><header><b>Top</b><span class="note" id="r3-top-n"></span><select class="r3vt" data-k="top" aria-label="Viewer of top" title="Viewer: how this view shows the render (ACEScg linear), as in Maya. ACES 1.0 · Rec.709 or sRGB: the ACES output transform for that display"></select><button class="btn sm ghost" data-act="frame" data-k="top" title="Back to the default size around the shot camera">Frame</button></header>
        <div class="impb r3b" title="Move / Rotate: drag the sun · wheel: zoom · middle or right button: pan"><canvas id="r3-cv-top"></canvas><canvas class="r3ov" id="r3-ov-top"></canvas></div></section>
      <section class="impp r3p" data-k="free"><header><b>Free</b><span class="note">Orbit around the shot</span><select class="r3vt" data-k="free" aria-label="Viewer of free" title="Viewer: how this view shows the render (ACEScg linear), as in Maya. ACES 1.0 · Rec.709 or sRGB: the ACES output transform for that display"></select><button class="btn sm ghost" data-act="frame" data-k="free" title="Back to the default view behind the shot camera">Frame</button></header>
        <div class="impb r3b" title="Drag: orbit · middle button or Shift+drag: pan · right button or wheel: zoom · double click: frame"><canvas id="r3-cv-free"></canvas></div></section>
    </div>
    <div class="r3right">
    <section class="impp r3p r3main" data-k="shot"><header><b>Render</b>
        <div class="seg r3eng" role="group" aria-label="Engine of the Render view" data-tour="render3d.engine"><button data-eng="raster" aria-pressed="true" title="Raster: the usual engine, fast and interactive (its settings: Raster, in the panel)">Raster</button><button data-eng="pt" aria-pressed="false" title="Path trace: light that really bounces, glass, soft shadows and depth of field; slower (its settings: Path trace, in the panel)">Path trace</button></div>
        <span class="note" id="r3-shot-n">Shot camera</span>
        <button class="btn sm primary r3back" id="r3-shot-back" hidden title="The view was moved: this is a free camera of the view. Back to the shot camera (the shot camera itself never changed)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.2"/></svg>Back to shot camera</button>
        <select class="r3vt" data-k="shot" aria-label="Viewer of shot" title="Viewer: how this view shows the render (ACEScg linear), as in Maya. ACES 1.0 · Rec.709 or sRGB: the ACES output transform for that display"></select>
        <button class="btn sm ghost" id="r3-reset" title="All of 3D Render back to its defaults with one click: quality, lights, HDRI settings, sun, post and Viewers. The place, the date, the street heading, the HDRI file and the edited materials stay">Reset</button>
        <button class="btn sm ghost a3max" id="r3-max" aria-pressed="false" aria-label="Maximize the render" title="Maximize the render">${maxSvg}</button>
        <span class="r3brk" aria-hidden="true"></span>
        <label class="vpchip" id="r3-v-exp-l" title="Exposure of the shot camera, in stops (EV): both engines, before the Viewer. +1 is twice the light (double click: 0)">Exp <input id="r3-v-exp" type="range" min="-6" max="6" step="0.1"><span class="r3num" id="r3-v-exp-n"></span></label>
        <button class="vpchip" id="r3-hq" aria-pressed="false" title="Raster, Max quality: keeps adding samples while nothing moves (antialiasing, soft shadows, motion blur). Off: interactive">Max quality</button>
        <button class="vpchip" id="r3-shadows" aria-pressed="true" title="Raster: realistic shadows of the sun (shadow maps). Off: faster">Shadows</button>
        <label class="vpchip" for="r3-quality" title="Raster, viewport quality: lower it if it does not move smoothly">Quality <select id="r3-quality"><option value="low">Low</option><option value="med">Medium</option><option value="high">High</option></select></label>
        <button class="btn sm ghost" id="r3-pt-pause" aria-pressed="false" hidden title="Path trace: stop adding samples (moving the camera starts again)">Pause</button>
        <button class="btn sm ghost" id="r3-pt-reload" hidden title="Path trace: build its scene again from what is in 3D Render now (if something did not update)">Reload</button>
        <button class="vpchip" id="r3-plate-v" aria-pressed="false" title="The plate on top of the render (keyed with the Chroma key, K): the render shows through the windows">Plate</button>
        <button class="vpchip" id="r3-key-v" aria-pressed="false" title="Chroma key of the plate (K): with Plate on, the render shows through the keyed screen (the windows). The key settings are in the viewer bar of the other tabs">Key</button>
        <label class="vpchip" id="r3-v-hdri-l" title="How much the HDRI lights the scene (double click: 1)"><span id="r3-v-hdri-t">HDRI</span> <input id="r3-v-hdri" type="range" min="0" max="3" step="0.05"><button class="r3x r3gone" id="r3-v-hdri-x" title="Remove the HDRI: a plain sky light (Sky)" disabled>×</button></label>
        <button class="tool sm r3sunpick" id="r3-sun-pick" aria-pressed="false" data-tour="render3d.sunpick" aria-label="Place the sun in Render" title="Place the sun: click (or drag) in Render where the sun should be, in the sky; the light comes from there. With the HDRI as background, click its sun. Esc or this button again: done">${R3_SUN_SVG}</button>
        <label class="vpchip" title="Intensity of the sun (double click: 2.4)">Sun <input id="r3-v-sun" type="range" min="0" max="10" step="0.1"></label></header>
      <div class="impb r3b r3shot"><canvas id="r3-cv-shot"></canvas><button class="btn sm primary r3lockv" id="r3-sun-lock-v" hidden title="The sun is locked to the HDRI: it only turns, and the HDRI turns with it. Its height is the one of the sun in the HDRI. Click to unlock it">${R3_LOCK_SVG}Sun locked to HDRI · Unlock</button><p class="a3msg" id="r3-msg" hidden></p>
        <div class="r3ptprog" id="r3-pt-prog" hidden role="progressbar" aria-label="Building the path trace scene"><span id="r3-pt-prog-t"></span><div class="r3-bar"><i id="r3-pt-prog-b"></i></div></div></div></section>
    <section class="impp r3mat" id="r3-mat" data-tour="render3d.materials"><header><b>Material</b>
        <select id="r3-mat-sel" aria-label="Material to edit" title="The materials of the 3D render (a copy: the other tabs keep theirs)"></select>
        <button class="vpchip" id="r3-mat-pick" aria-pressed="false" title="Then click an object in Render to edit its material">Pick</button>
        <span class="note" id="r3-mat-n"></span>
        <button class="btn sm ghost" id="r3-mat-reset" title="Back to the values it came with">Reset</button></header>
      <div class="r3mat-b" id="r3-mat-b">
        <label class="camh" title="Base color (albedo)">COLOR <input id="r3m-color" type="color"></label>
        <label class="camh">ROUGH <input id="r3m-rough" type="range" min="0" max="1" step="0.01"></label>
        <label class="camh">METAL <input id="r3m-metal" type="range" min="0" max="1" step="0.01"></label>
        <label class="camh" title="A clear varnish layer on top (car paint)">COAT <input id="r3m-cc" type="range" min="0" max="1" step="0.01"></label>
        <label class="camh" title="Glass: light goes through and the paint gets thinner (a transparent glass in Raster)">GLASS <input id="r3m-trans" type="range" min="0" max="1" step="0.01"></label>
        <label class="camh" title="Light it gives off">EMIT <input id="r3m-emis" type="color"></label>
        <label class="camh">EMIT × <input id="r3m-emisint" type="range" min="0" max="20" step="0.1"></label>
      </div></section>
    </div>`;
  const pane = (k, cam) => ({ k, cv: $('r3-cv-' + k), ctx: $('r3-cv-' + k).getContext('2d'), cam });
  r3.panes.top = Object.assign(pane('top', new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000)), { span: 70, off: new THREE.Vector2(), ov: $('r3-ov-top') });
  r3.panes.free = Object.assign(pane('free', new THREE.PerspectiveCamera(45, 1, 0.1, 4000)), { orbit: { yaw: 200, pitch: 22, dist: 45, t: new THREE.Vector3() }, framed: false });
  r3.panes.shot = pane('shot', null);
  r3NavFree(r3.panes.free); r3NavTop(r3.panes.top);
  // la cámara libre del visor Render, con el Nav de la app (js/navigation.js: orbNav); no mientras se elige un material
  orbNav({ el: $('r3-cv-shot'), cam: r3.navCam, orbit: r3FreeOrbit, enabled: () => r3.on && !r3.picking && !r3.sunPick && (r3.engine === 'raster' || r3pt.built), pitchMin: -89, pitchMax: 89, minDist: 0.05,
    change: () => { r3pt.paused = false; r3ViewUI(); r3Dirty('shot'); } });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-tool]'); if (b) { r3.tool = b.dataset.tool; r3Save(); r3ViewUI(); return; }
    const f = e.target.closest('[data-act="frame"]'); if (f) { if (f.dataset.k === 'top') { r3.panes.top.span = 70; r3.panes.top.off.set(0, 0); } else r3.panes.free.framed = false; r3Dirty(); }
  });
  $('r3-shadows').onclick = () => { r3.shadows = !r3.shadows; r3Save(); r3Panel(); r3Dirty(); };
  $('r3-hq').onclick = () => { r3.hq = !r3.hq; r3Save(); r3ViewUI(); r3Panel(); r3Dirty('shot'); };
  $('r3-plate-v').onclick = () => { r3.plate = !r3.plate; r3Save(); r3ViewUI(); r3Panel(); r3Dirty('shot'); };
  // el key sólo se ve con el plate encima: prenderlo prende también Plate
  $('r3-key-v').onclick = () => { const on = !key.on; if (on && !r3.plate) { r3.plate = true; r3Save(); r3Panel(); } setKey({ on }); r3ViewUI(); r3Dirty('shot'); };
  // sin HDRI el mismo slider es la luz de cielo (Sky)
  $('r3-v-hdri').oninput = e => { if (r3.hdri.tex) r3.hdri.int = +e.target.value; else r3.skyInt = +e.target.value; r3Lights(); r3Save(); r3Panel(); r3GiSoon(); };
  $('r3-v-sun').oninput = e => { r3.sunInt = +e.target.value; r3Save(); r3Panel(); r3Dirty(); r3GiSoon(); };
  $('r3-v-hdri').ondblclick = () => { if (r3.hdri.tex) r3.hdri.int = 1; else r3.skyInt = 0.6; r3Lights(); r3Save(); r3ViewUI(); r3Panel(); r3GiSoon(); };
  $('r3-v-hdri-x').onclick = e => { e.preventDefault(); e.stopPropagation(); $('r3-hdri-x').click(); };
  // el Viewer de cada visor
  box.querySelectorAll('select.r3vt').forEach(sel => {
    sel.innerHTML = R3_VIEWS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
    sel.onchange = () => { r3.views[sel.dataset.k] = sel.value; r3Save(); r3Dirty(sel.dataset.k); };
  });
  r3MatBind();
  $('r3-v-sun').ondblclick = () => { r3.sunInt = 2.4; r3Save(); r3ViewUI(); r3Panel(); r3Dirty(); };
  box.querySelectorAll('[data-eng]').forEach(b => { b.onclick = () => r3SetEngine(b.dataset.eng); });
  $('r3-pt-pause').onclick = () => { r3pt.paused = !r3pt.paused; r3ViewUI(); r3Dirty('shot'); };
  $('r3-pt-reload').onclick = () => r3PtReload();
  $('r3-shot-back').onclick = () => r3ShotCam();
  $('r3-sun-lock-v').onclick = () => r3HdriSetLock(false);
  $('r3-sun-pick').onclick = () => r3SunPickSet(!r3.sunPick);
  r3SunPickBind();
  $('r3-v-exp').oninput = e => { r3.exp = +e.target.value; r3Save(); r3Panel(); r3Dirty('shot'); };
  $('r3-v-exp').ondblclick = () => { r3.exp = 0; r3Save(); r3ViewUI(); r3Panel(); r3Dirty('shot'); };
  $('r3-quality').onchange = () => { r3.quality = $('r3-quality').value; r3ApplyQuality(); r3Save(); r3Panel(); r3Dirty(); };
  $('r3-reset').onclick = () => { r3ResetPart('view'); toast('3D Render back to its defaults'); };
  $('r3-max').onclick = () => { r3.max = !r3.max; r3Save(); r3ViewUI(); r3Dirty(); };
  box.addEventListener('dblclick', e => { if (e.target.closest('.r3main > header') && !e.target.closest('button, select, label')) $('r3-max').click(); });
  new ResizeObserver(() => { if (r3.on) r3Dirty(); }).observe(box);
}
// el motor del visor Render: al volver a Raster se libera todo lo del path tracer
function r3SetEngine(v) {
  v = v === 'pt' ? 'pt' : 'raster'; if (v === r3.engine) return;
  r3.engine = v; r3pt.paused = false; // la cámara libre sigue: los dos motores desde el mismo lugar
  if (v === 'raster') { r3PtDispose(); $('r3-msg').hidden = true; }
  r3Save(); r3ViewUI(); r3Panel(); r3Dirty();
}
function r3ShotCam() { r3.free = false; r3pt.paused = false; r3ViewUI(); r3Panel(); r3Dirty('shot'); }
function r3ViewUI() {
  const box = $('r3v'); if (!box) return;
  box.classList.toggle('maxed', r3.max);
  { const pt = r3.engine === 'pt';
    box.querySelectorAll('[data-eng]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.eng === r3.engine)));
    $('r3-pt-pause').hidden = $('r3-pt-reload').hidden = !pt; $('r3-pt-pause').setAttribute('aria-pressed', String(r3pt.paused)); $('r3-pt-pause').textContent = r3pt.paused ? 'Resume' : 'Pause';
    $('r3-shot-back').hidden = !r3.free; box.querySelector('.r3main').classList.toggle('free', r3.free);
    $('r3-sun-lock-v').hidden = !r3HdriLock();
    $('r3-sun-pick').setAttribute('aria-pressed', String(r3.sunPick)); box.querySelector('.r3main').classList.toggle('sunpick', r3.sunPick);
    if (document.activeElement !== $('r3-v-exp')) $('r3-v-exp').value = r3.exp;
    $('r3-v-exp-n').textContent = (r3.exp > 0 ? '+' : r3.exp < 0 ? '−' : '') + Math.abs(r3.exp).toFixed(1);
    // los ajustes de Raster no son del path tracer
    for (const id of ['r3-hq', 'r3-shadows']) $(id).hidden = pt;
    $('r3-quality').closest('label').hidden = pt; }
  box.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === r3.tool)));
  $('r3-shadows').setAttribute('aria-pressed', String(r3.shadows));
  $('r3-hq').setAttribute('aria-pressed', String(r3.hq)); $('r3-plate-v').setAttribute('aria-pressed', String(r3.plate)); $('r3-key-v').setAttribute('aria-pressed', String(!!key.on));
  if (document.activeElement !== $('r3-v-sun')) $('r3-v-sun').value = r3.sunInt;
  $('r3-quality').value = r3.quality;
  { const H = r3.hdri, has = !!H.tex;
    $('r3-v-hdri-t').textContent = has ? 'HDRI' : 'Sky'; $('r3-v-hdri-x').classList.toggle('r3gone', !has); $('r3-v-hdri-x').disabled = !has;
    $('r3-v-hdri-l').title = has ? 'How much the HDRI lights the scene (double click: 1)' : 'No HDRI: how much the plain sky lights the scene (double click: 0.6)';
    if (document.activeElement !== $('r3-v-hdri')) $('r3-v-hdri').value = has ? H.int : r3.skyInt; }
  document.querySelectorAll('#r3v select.r3vt').forEach(sel => { if (document.activeElement !== sel) sel.value = r3.views[sel.dataset.k]; });
  $('r3-max').setAttribute('aria-pressed', String(r3.max)); $('r3-max').title = r3.max ? 'Back to the three viewports' : 'Maximize the render';
}
function r3NavFree(p) {
  // el mismo Nav que el visor principal (js/navigation.js: Maya, Max, Blender, Game…); la órbita no baja del piso
  orbNav({ el: p.cv, cam: p.cam, orbit: () => p.orbit, pitchMin: -5, pitchMax: 89, minDist: 1, change: () => r3Dirty('free') });
  p.cv.addEventListener('dblclick', () => { p.framed = false; r3Dirty('free'); });
}
// vista de arriba: el centro (la cámara de la toma) y el círculo del horizonte, en px del canvas
function r3TopGeom(p) {
  const w = p.cv.clientWidth, h = p.cv.clientHeight;
  return { cx: w / 2, cy: h / 2, R: 0.4 * Math.min(w, h) };
}
function r3NavTop(p) {
  let drag = null;
  p.ov.addEventListener('contextmenu', e => e.preventDefault()); navNoAutoscroll(p.ov);
  const local = (e) => { const r = p.ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  p.ov.addEventListener('pointerdown', e => {
    const [x, y] = local(e), g = r3TopGeom(p);
    drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0, a0: Math.atan2(x - g.cx, -(y - g.cy)), az0: r3SunNow().az };
    p.ov.setPointerCapture(e.pointerId); e.preventDefault();
    if (!drag.pan && r3.tool === 'move') r3MoveTo(p, x, y);
  });
  p.ov.addEventListener('pointermove', e => {
    if (!drag) return;
    const [x, y] = local(e), g = r3TopGeom(p);
    if (drag.pan) {
      const k = p.span * 2 / Math.max(1, Math.min(p.cv.clientWidth, p.cv.clientHeight));
      p.off.x -= (e.clientX - drag.x) * k; p.off.y -= (e.clientY - drag.y) * k; drag.x = e.clientX; drag.y = e.clientY; r3Dirty('top'); return;
    }
    if (r3.tool === 'move') r3MoveTo(p, x, y);
    else { const a = Math.atan2(x - g.cx, -(y - g.cy)); r3SetSun(drag.az0 + (a - drag.a0) * 180 / Math.PI, r3.el, true); }
  });
  const end = () => { drag = null; };
  p.ov.addEventListener('pointerup', end); p.ov.addEventListener('pointercancel', end);
  p.ov.addEventListener('wheel', e => { e.preventDefault(); p.span = Math.max(5, Math.min(1500, p.span * Math.exp(e.deltaY * 0.0015))); r3Dirty('top'); }, { passive: false });
}
// Move: el punto del visor es el sol; ángulo = azimut (respecto de la calle), distancia al centro = 90° − altura
function r3MoveTo(p, x, y) {
  const g = r3TopGeom(p), dx = x - g.cx, dy = y - g.cy, r = Math.min(1, Math.hypot(dx, dy) / g.R);
  r3SetSun(r3.heading + Math.atan2(dx, -dy) * 180 / Math.PI, 90 * (1 - r), true);
}

// ---------- Dibujo: un renderer para los tres ----------
// cualquier cambio vuelve a empezar la acumulación de Max quality; cont: seguir sumando muestras (sólo RENDER)
// qué visores se redibujan. 'all' (el de siempre): Render enseguida y Top y Free un momento después del último cambio
// (no en cada paso de un slider); 'shot': sólo Render (calidad, post, Viewer de Render: Top y Free no cambian);
// 'top' / 'free': sólo ese visor (navegarlo, su Viewer)
function r3Dirty(k = 'all') {
  if (!r3.on) return;
  if (k === 'top' || k === 'free') r3.need[k] = true;
  else {
    r3.reset = true; r3.need.shot = true; r3.shadowOk = false;
    if (k === 'all') { clearTimeout(r3.sideT); r3.sideT = setTimeout(() => { r3.need.top = r3.need.free = true; r3Kick(); }, 150); }
  }
  r3Kick();
}
function r3Kick() { if (r3.on && !r3.raf) r3.raf = requestAnimationFrame(() => r3RenderAll(false)); }
function r3SunApply() {
  const gl = r3.gl, sun = r3SunNow(), c = r3Center(), dir = sunWorldDir(sun.az, sun.el, r3.heading);
  r3.sun.target.position.copy(c); r3.sun.position.set(c.x + dir[0] * 400, c.y + dir[1] * 400, c.z + dir[2] * 400);
  r3.sun.color.fromArray(r3HexToWs(r3.sunCol)); // en ACEScg
  r3.sun.intensity = sun.el > -1 ? r3.sunInt * Math.PI * Math.min(1, (sun.el + 1) / 4) : 0; // × π: las intensidades de la pestaña son las de r147 (luces legacy)
  r3.sun.castShadow = r3.shadows; r3.sun.target.updateMatrixWorld(); r3.sun.updateMatrixWorld();
  if (gl.shadowMap.enabled !== r3.shadows) { gl.shadowMap.enabled = r3.shadows; for (const m of r3.mats.values()) m.needsUpdate = true; }
  gl.toneMappingExposure = Math.pow(2, r3.exp);
  return { sun, c };
}
function r3RenderAll(cont) {
  r3.raf = 0; if (!r3.on || r3.busy || !r3Init()) return;
  r3CamPush(tl.frame); // la cámara libre del visor o la de Shakelab, si va
  r3.navCam.copy(camera, false); r3.navCam.updateMatrixWorld(true);
  try { r3RenderAllIn(cont); } finally { r3CamPop(); }
}
function r3RenderAllIn(cont) {
  const gl = r3.gl, q = R3_QUALITY[r3.quality], dpr = Math.min(q.px, window.devicePixelRatio || 1);
  if (r3.reset) cont = false;
  r3ApplyQuality();
  const { sun, c } = r3SunApply();
  if (r3.skyMode === 'phys' && !r3.hdri.tex && r3SkyKeyNow() !== r3.skyKey) r3Lights(); // el cielo físico sigue al sol
  r3CamGizmo();
  // el entorno entra un momento en esta escena (y vuelve a la suya)
  const par = envRoot.parent, vis = envRoot.visible, mod = ENV_MODULES[env.id];
  envRoot.visible = !!mod; r3.scene.add(envRoot);
  try {
    // Render: si cambió algo, o si Max quality sigue sumando muestras; Top y Free sólo cuando les toca
    const more = r3.engine === 'pt' ? r3pt.more : r3.hq && r3.fx && r3.fx.n < r3.samples;
    const list = ['shot', 'top', 'free'].filter(k => k === 'shot' ? r3.need.shot || cont || more : !cont && r3.need[k]);
    for (const k of list) r3.need[k] = false;
    for (const k of list) {
      const p = r3.panes[k], b = p.cv.parentNode;
      if (!b.offsetParent) continue;
      let bw = b.clientWidth, bh = b.clientHeight, cam = p.cam;
      if (k === 'shot') { // el cuadro de la toma entero, centrado
        const a = camera.aspect || 16 / 9; if (bw / bh > a) bw = bh * a; else bh = bw / a;
        cam = camera; r3.camGizmo.visible = false;
      } else r3.camGizmo.visible = true;
      bw = Math.max(1, Math.round(bw)); bh = Math.max(1, Math.round(bh));
      const w = Math.round(bw * dpr), h = Math.round(bh * dpr);
      if (p.cv.width !== w || p.cv.height !== h) { p.cv.width = w; p.cv.height = h; }
      p.cv.style.width = bw + 'px'; p.cv.style.height = bh + 'px';
      if (k === 'top') {
        const a = bw / bh, s = p.span, o = c.clone().add(new THREE.Vector3(p.off.x, 0, p.off.y));
        Object.assign(cam, { left: -s * Math.max(1, a), right: s * Math.max(1, a), top: s * Math.max(1, 1 / a), bottom: -s * Math.max(1, 1 / a) });
        cam.position.set(o.x, 1500, o.z); cam.up.set(0, 0, -1); cam.lookAt(o.x, 0, o.z); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        p.center = o;
      } else if (k === 'free') {
        if (!p.framed) { p.orbit.t.copy(c); p.orbit.yaw = r3Wrap(camAngles().yaw + 25); p.orbit.pitch = 24; p.orbit.dist = 45; p.framed = true; }
        const o = p.orbit, y = o.yaw * Math.PI / 180, pi = o.pitch * Math.PI / 180;
        cam.position.set(o.t.x + o.dist * Math.cos(pi) * Math.sin(y), o.t.y + o.dist * Math.sin(pi), o.t.z + o.dist * Math.cos(pi) * Math.cos(y));
        cam.lookAt(o.t); cam.aspect = bw / bh; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      }
      gl.setPixelRatio(1); gl.setSize(w, h, false);
      if (k === 'shot') {
        if (r3.engine === 'pt') { r3pt.more = r3PtDraw(p, w, h); r3.reset = false; r3.shadowOk = false; r3SunMark(p, w, h, sun); continue; } // Top y Free hacen su sombra
        r3ShotDraw(p, w, h, !r3.reset); r3.shadowOk = true; r3SunMark(p, w, h, sun);
        continue;
      }
      // la vista de arriba sobre un fondo oscuro: el HDRI visto desde arriba no deja leer el círculo del sol
      const bg = r3.scene.background; if (k === 'top') r3.scene.background = R3_TOP_BG;
      // la sombra del sol es la misma para las tres cámaras: Top y Free usan la que ya dibujó Render (sin rehacerla)
      const au = gl.shadowMap.autoUpdate; gl.shadowMap.autoUpdate = !r3.shadowOk;
      try { r3PaneDraw(p, k, cam, w, h); } finally { r3.scene.background = bg; gl.shadowMap.autoUpdate = au; r3.shadowOk = true; }
      p.ctx.drawImage(gl.domElement, 0, 0);
      if (k === 'top') r3DrawTop(p, bw, bh, sun);
    }
  } finally { par ? par.add(envRoot) : r3.scene.remove(envRoot); envRoot.visible = vis; }
  const msg = r3.engine === 'pt' && r3pt.err ? r3pt.err : !mod ? 'No environment: pick one in 3D Camera Pin | Environment › Environment › Module.' : sun.el < -1 ? 'The sun is below the horizon at this time: only the HDRI or the sky light.' : '';
  $('r3-msg').textContent = msg; $('r3-msg').hidden = !msg;
  $('r3-top-n').textContent = `Sun ${r3Fmt(sun.az)}° · ${r3Fmt(sun.el)}° up${r3HdriLock() ? ' · locked to the HDRI' : ''} · street ${r3Fmt(r3.heading, 0)}°`;
  // Max quality: mientras falten muestras, sigue en el próximo cuadro (sólo el visor RENDER)
  if (r3.engine !== 'pt' && r3.hq && r3.fx && r3.fx.n < r3.samples && !r3.raf) r3.raf = requestAnimationFrame(() => r3RenderAll(true));
  // Path trace: mientras falten muestras (o termine el fundido de la vista previa)
  if (r3.engine === 'pt' && r3pt.more && !r3.raf) r3.raf = requestAnimationFrame(() => r3RenderAll(true));
}
// el visor RENDER: muestras acumuladas (js/render3d-fx.js), el post y el plate encima si va
function r3ShotDraw(p, w, h, cont) {
  const gl = r3.gl;
  if (!r3.fx || r3.fx.W !== w || r3.fx.H !== h) { r3FxDispose(r3.fx); r3.fx = r3FxMake(w, h); cont = false; }
  const fx = r3.fx;
  if (!cont) {
    fx.n = 0; fx.cur = 0; r3.reset = false;
    const cap = r3.gi || r3.refl; // el rebote y los reflejos de la escena salen de una captura desde la toma
    if (cap && (r3.hq || performance.now() - r3.giT > 300)) r3GiUpdate();
    else if (cap) r3GiSoon(); // arrastrando un slider: se pone al día al soltar
    else { if (r3.probe) r3.probe.intensity = 0; if (r3.scene.environment !== r3.baseEnv) { r3.scene.environment = r3.baseEnv; r3MatsUpdate(); } }
  }
  // por cuadro, muestras mientras entren en ~30 ms (al menos una): la interfaz sigue respondiendo con una placa lenta
  const t0 = performance.now(), max = r3.hq ? r3.samples : 1;
  do r3FxSample(fx, { jitter: r3.hq, soft: r3.hq, mb: r3.hq && r3.mb, frame: tl.frame });
  while (r3.hq && fx.n < max && performance.now() - t0 < 30);
  r3FxShow(fx, null);
  p.ctx.drawImage(gl.domElement, 0, 0);
  const pe = r3.plate && typeof pbPlateEl === 'function' ? pbPlateEl() : null;
  if (pe) p.ctx.drawImage(pe, 0, 0, w, h);
  $('r3-shot-n').textContent = r3.hq ? `Max quality · ${fx.n} / ${r3.samples}` : 'Interactive';
}
// el sol, el horizonte y el norte sobre la vista de arriba (el centro es la cámara de la toma)
function r3DrawTop(p, w, h, sun) {
  const ov = p.ov, dpr = window.devicePixelRatio || 1;
  if (ov.width !== Math.round(w * dpr) || ov.height !== Math.round(h * dpr)) { ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr); }
  ov.style.width = w + 'px'; ov.style.height = h + 'px';
  const x = ov.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const g = r3TopGeom(p);
  x.lineWidth = 1.5; x.strokeStyle = 'rgba(255,255,255,0.55)'; x.setLineDash([5, 5]);
  x.beginPath(); x.arc(g.cx, g.cy, g.R, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
  // el norte: un rumbo de 0° está girado −heading respecto del −Z (arriba)
  const na = -r3.heading * Math.PI / 180, nx = g.cx + Math.sin(na) * (g.R + 14), ny = g.cy - Math.cos(na) * (g.R + 14);
  x.fillStyle = '#ff6b6b'; x.font = '600 12px Inter, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.beginPath(); x.moveTo(g.cx + Math.sin(na) * g.R, g.cy - Math.cos(na) * g.R); x.lineTo(g.cx + Math.sin(na) * (g.R - 10), g.cy - Math.cos(na) * (g.R - 10)); x.strokeStyle = '#ff6b6b'; x.stroke();
  x.fillText('N', nx, ny);
  // el sol: ángulo respecto de la calle, distancia = 90° − altura
  const d = (sun.az - r3.heading) * Math.PI / 180, r = g.R * (1 - Math.max(0, Math.min(90, sun.el)) / 90);
  const sx = g.cx + Math.sin(d) * r, sy = g.cy - Math.cos(d) * r;
  x.strokeStyle = 'rgba(255,214,102,0.9)'; x.lineWidth = 2; x.beginPath(); x.moveTo(g.cx, g.cy); x.lineTo(sx, sy); x.stroke();
  x.fillStyle = sun.el < 0 ? '#7a6a3a' : '#ffd666'; x.beginPath(); x.arc(sx, sy, 9, 0, Math.PI * 2); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 1; x.stroke();
  x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = '11px Inter, sans-serif'; x.fillText(`${r3Fmt(sun.el)}°`, sx, sy - 17);
}
function r3Show(on) {
  if (on === r3.on) return;
  r3.on = on; $('r3v').hidden = !on;
  if (on) {
    if (!r3Init()) return;
    const needPack = env.vals && env.vals.carsrc === 'simple', wire = env.display === 'wire';
    r3FromMeta();
    if (needPack || wire) envRebuild(); else { r3Swap(true); r3MatsUpdate(); }
    if (r3.hdri.src && !r3.hdri.tex) r3HdriBuild(); else r3Lights();
    r3ViewUI(); r3Panel(); r3MapDraw(true); r3MatUI(); r3Dirty();
  } else {
    // al salir, las otras pestañas recuperan su entorno tal cual, aunque algo de acá falle
    if (r3.busy) r3.cancel = true;
    r3PtDispose(); r3.free = false; r3.sunPick = false; r3HdriDlg(false);
    r3Swap(false);
    if ((env.vals && env.vals.carsrc === 'simple') || env.display === 'wire') envRebuild();
    render();
  }
}
const r3dShow = r3Show;
// el rebote (GI) un momento después del último cambio: mientras se arrastra un slider no se recalcula en cada paso
function r3GiSoon() { r3Dirty(); clearTimeout(r3.giTimer); r3.giTimer = setTimeout(() => { r3.giT = 0; r3Dirty(); }, 350); }
// la cámara de Shakelab: la toma elegida allá, en el cuadro de la línea de tiempo (también entre cuadros, para el motion
// blur), sobre la cámara de la toma. Push la pone (desde la cámara original, aunque ya estuviera puesta) y Pop la saca.
const r3ShkOn = () => !!(r3.useShk && typeof shk !== 'undefined' && shk.sel >= 0 && shk.takes[shk.sel]);
// la cámara de Render mientras se dibuja: la libre del visor (si se movió) o la de Shakelab; r3CamPop deja la de la toma
// como estaba. La libre gana: es lo que el usuario está mirando.
function r3CamPush(frame) {
  if (!r3.free && !r3ShkOn()) return false;
  if (r3.camKeep) { camera.position.copy(r3.camKeep.p); camera.quaternion.copy(r3.camKeep.q); camera.updateMatrixWorld(true); }
  else r3.camKeep = { p: camera.position.clone(), q: camera.quaternion.clone() };
  if (r3.free) { r3FreePose(camera); return true; }
  const r = shkCamAt(shkLimit(shkSample(shk.takes[shk.sel], (frame - tl.start) / tl.fps), shk.lims, shk.brake));
  camera.position.fromArray(r.p); camera.quaternion.setFromEuler(new THREE.Euler(r.e.x, r.e.y, r.e.z, 'YXZ')); camera.updateMatrixWorld(true);
  return true;
}
// la pose de la cámara libre (la órbita del visor), sin tocar el up de la cámara
function r3FreePose(cam) {
  const O = r3.orbit, y = O.yaw * Math.PI / 180, p = O.pitch * Math.PI / 180;
  cam.position.set(O.t.x + O.dist * Math.cos(p) * Math.sin(y), O.t.y + O.dist * Math.sin(p), O.t.z + O.dist * Math.cos(p) * Math.cos(y));
  cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, O.t, new THREE.Vector3(0, 1, 0)));
  cam.updateMatrixWorld(true);
}
// la primera vez que se mueve la vista: la órbita sale de la cámara que se estaba viendo (la de la toma o Shakelab)
function r3FreeOrbit() {
  if (!r3.free) {
    r3CamPush(tl.frame);
    try {
      const c = camera, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
      let dist = 12;
      envRoot.updateMatrixWorld(true);
      const vis = (o) => { for (let q = o; q && q !== envRoot; q = q.parent) if (!q.visible) return false; return true; };
      const hit = new THREE.Raycaster(c.position.clone(), fwd.clone()).intersectObject(envRoot, true).find(h => h.object.isMesh && vis(h.object));
      if (hit) dist = Math.max(1, Math.min(80, hit.distance));
      const O = r3.orbit; O.dist = dist; O.t.copy(c.position).addScaledVector(fwd, dist);
      O.pitch = Math.asin(Math.max(-1, Math.min(1, -fwd.y))) * 180 / Math.PI; O.yaw = Math.atan2(-fwd.x, -fwd.z) * 180 / Math.PI;
    } finally { r3CamPop(); }
    r3.free = true; r3ViewUI(); r3Panel();
  }
  return r3.orbit;
}
function r3CamPop() { if (!r3.camKeep) return; camera.position.copy(r3.camKeep.p); camera.quaternion.copy(r3.camKeep.q); camera.updateMatrixWorld(true); r3.camKeep = null; }

// ---------- Poner el sol desde Render: el click es la dirección del sol vista desde la cámara de Render ----------
function r3SunPickSet(on) {
  r3.sunPick = !!on; if (on && r3.picking) { r3.picking = false; r3MatUI(); }
  r3ViewUI(); r3Dirty('shot');
}
// u, v de 0 a 1 desde arriba a la izquierda del cuadro → azimut y altura (con la cámara que tiene el visor)
function r3SunAt(u, v) {
  r3CamPush(tl.frame);
  try {
    camera.updateMatrixWorld(); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), camera);
    const d = rc.ray.direction; return sunFromWorld(d.x, d.y, d.z, r3.heading);
  } finally { r3CamPop(); }
}
function r3SunPickBind() {
  const cv = $('r3-cv-shot'); let on = false, low = false;
  const at = (e) => {
    const r = cv.getBoundingClientRect(), s = r3SunAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (s.el < -10 && !low) { low = true; toast('That is below the horizon: the sun goes as low as −10°. Click in the sky', true); }
    r3SetSun(s.az, s.el, true);
  };
  cv.addEventListener('pointerdown', e => { if (!r3.sunPick || e.button !== 0) return; on = true; low = false; cv.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); at(e); });
  cv.addEventListener('pointermove', e => { if (on) at(e); });
  const end = () => { on = false; }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}
// dónde está el sol en Render mientras se lo pone: un círculo amarillo (o una flecha al borde si queda fuera del cuadro)
function r3SunMark(p, w, h, sun) {
  if (!r3.sunPick) return;
  const d = sunWorldDir(sun.az, sun.el, r3.heading), x = p.ctx, k = Math.max(1, w / Math.max(1, p.cv.clientWidth)) * uiScaleGet();
  const q = new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(1e4).add(camera.position).project(camera);
  const inF = new THREE.Vector3(d[0], d[1], d[2]).dot(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)) > 0;
  x.save(); x.lineWidth = 2 * k;
  if (inF && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1) {
    const sx = (q.x + 1) / 2 * w, sy = (1 - q.y) / 2 * h, R = 11 * k;
    x.strokeStyle = 'rgba(0,0,0,0.65)'; x.lineWidth = 4 * k; x.beginPath(); x.arc(sx, sy, R, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#ffd666'; x.lineWidth = 2 * k; x.beginPath(); x.arc(sx, sy, R, 0, Math.PI * 2); x.stroke();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; x.beginPath(); x.moveTo(sx + Math.cos(a) * R * 1.35, sy + Math.sin(a) * R * 1.35); x.lineTo(sx + Math.cos(a) * R * 1.8, sy + Math.sin(a) * R * 1.8); x.stroke(); }
  } else { // fuera del cuadro: una flecha en el borde hacia donde está
    let ax = inF ? q.x : -q.x, ay = inF ? q.y : -q.y; const m = Math.max(Math.abs(ax), Math.abs(ay), 1e-6); ax /= m; ay /= m;
    const sx = (ax * 0.93 + 1) / 2 * w, sy = (1 - ay * 0.9) / 2 * h, a = Math.atan2(-ay, ax), L = 14 * k;
    x.fillStyle = '#ffd666'; x.strokeStyle = 'rgba(0,0,0,0.65)'; x.beginPath();
    x.moveTo(sx + Math.cos(a) * L, sy + Math.sin(a) * L); x.lineTo(sx + Math.cos(a + 2.5) * L, sy + Math.sin(a + 2.5) * L); x.lineTo(sx + Math.cos(a - 2.5) * L, sy + Math.sin(a - 2.5) * L); x.closePath(); x.fill(); x.stroke();
  }
  { const t = `Click where the sun goes · ${r3Fmt(sun.az, 0)}° · ${r3Fmt(sun.el, 0)}° up`, u = k * uiScaleGet(), fh = 12 * u;
    x.font = `600 ${fh}px Inter, sans-serif`; const tw = x.measureText(t).width;
    x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(8 * k, h - 8 * k - fh * 1.9, tw + fh * 1.3, fh * 1.9);
    x.fillStyle = '#ffd666'; x.textBaseline = 'middle'; x.fillText(t, 8 * k + fh * 0.65, h - 8 * k - fh * 0.95); }
  x.restore();
}

// ---------- Editor de materiales (debajo de Render): las copias físicas de esta pestaña, por nombre ----------
const r3MatsByName = (name) => [...r3.mats.values()].filter(m => m.name === name);
const r3Lin2Hex = (a) => '#' + new THREE.Color().fromArray(a).convertLinearToSRGB().getHexString();
const r3Hex2Lin = (h) => new THREE.Color(h).convertSRGBToLinear().toArray();
function r3MatUI() {
  if (!$('r3-mat')) return;
  const names = [...new Set([...r3.mats.values()].map(m => m.name))].sort((a, b) => a.localeCompare(b));
  if (!names.includes(r3.matSel)) r3.matSel = names[0] || '';
  const sel = $('r3-mat-sel'), opts = names.map(n => `<option value="${n.replace(/"/g, '&quot;')}"${n === r3.matSel ? ' selected' : ''}>${n.replace(/</g, '&lt;')}${r3.matEdits[n] ? ' •' : ''}</option>`).join('');
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
  sel.value = r3.matSel;
  const m = r3MatsByName(r3.matSel)[0], has = !!m;
  $('r3-mat-b').classList.toggle('off', !has); $('r3-mat-b').querySelectorAll('input').forEach(el => { el.disabled = !has; });
  $('r3-mat-reset').disabled = !has || !r3.matEdits[r3.matSel];
  $('r3-mat-pick').setAttribute('aria-pressed', String(r3.picking));
  $('r3-mat-n').textContent = r3.picking ? 'Click an object in Render' : has ? `${r3MatsByName(r3.matSel).length > 1 ? 'shared' : ''}` : 'No materials: pick an environment';
  if (!has) return;
  const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  set('r3m-color', r3Lin2Hex(r3WsTo709(m.color.toArray()))); set('r3m-rough', m.roughness); set('r3m-metal', m.metalness); set('r3m-cc', m.clearcoat);
  set('r3m-trans', m.transmission); set('r3m-emis', r3Lin2Hex(r3WsTo709(m.emissive.toArray()))); set('r3m-emisint', m.emissiveIntensity);
}
function r3MatSet(patch) {
  const n = r3.matSel; if (!n) return;
  r3.matEdits[n] = Object.assign(r3.matEdits[n] || {}, patch);
  for (const m of r3MatsByName(n)) r3MatApply(m);
  r3Save(); r3MatUI(); r3Dirty();
}
function r3MatBind() {
  $('r3-mat-sel').onchange = e => { r3.matSel = e.target.value; r3MatUI(); };
  $('r3-mat-pick').onclick = () => { r3.picking = !r3.picking; if (r3.picking && r3.sunPick) r3SunPickSet(false); r3MatUI(); };
  $('r3-mat-reset').onclick = () => { const n = r3.matSel; delete r3.matEdits[n]; for (const m of r3MatsByName(n)) r3MatApply(m); r3Save(); r3MatUI(); r3Dirty(); };
  const rng = (id, k) => { $(id).oninput = e => r3MatSet({ [k]: +e.target.value }); };
  rng('r3m-rough', 'rough'); rng('r3m-metal', 'metal'); rng('r3m-cc', 'cc'); rng('r3m-trans', 'trans'); rng('r3m-emisint', 'emisInt');
  $('r3m-color').oninput = e => r3MatSet({ color: r3Hex2Lin(e.target.value) });
  $('r3m-emis').oninput = e => r3MatSet({ emis: r3Hex2Lin(e.target.value) });
  $('r3-cv-shot').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); r3PickAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
}
// Pick: el objeto bajo el click en Render (u, v de 0 a 1 desde arriba a la izquierda) → su material
function r3PickAt(u, v) {
  if (!r3.picking) return;
  r3CamPush(tl.frame);
  try {
    camera.updateMatrixWorld(); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), camera); // ya es la de la vista
    envRoot.updateMatrixWorld(true);
    const vis = (o) => { for (let p = o; p && p !== envRoot; p = p.parent) if (!p.visible) return false; return true; };
    const hit = rc.intersectObject(envRoot, true).find(h => h.object.isMesh && vis(h.object));
    const mat = hit && (Array.isArray(hit.object.material) ? hit.object.material[hit.face && hit.face.materialIndex || 0] : hit.object.material);
    if (mat && mat.userData.r3) { r3.matSel = mat.name; r3.picking = false; toast('Material: ' + mat.name); }
    else toast('Nothing with a material there', true);
  } finally { r3CamPop(); }
  r3MatUI();
}
{ const f = render; render = function (...a) { if (r3.on) r3Dirty(); return f(...a); }; }
// el key cambiado desde otro lado (K): el botón Key y Render al día
{ const f = keyUI; keyUI = function (...a) { const r = f(...a); if (r3.on && $('r3-key-v')) { $('r3-key-v').setAttribute('aria-pressed', String(!!key.on)); r3Dirty('shot'); } return r; }; }

// ---------- Mapa (OpenStreetMap, teselas de 256 px) ----------
const R3_TILE = 256;
const r3MapPx = (lat, lon, z) => { const n = R3_TILE * 2 ** z, s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180); return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
const r3MapLL = (x, y, z) => { const n = R3_TILE * 2 ** z, lon = x / n * 360 - 180, k = Math.PI - 2 * Math.PI * y / n; return [180 / Math.PI * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k))), lon]; };
function r3MapDraw(recentre) {
  const M = r3.map, box = $('r3-map'); if (!box || !box.offsetParent) return;
  const has = Number.isFinite(r3.loc.lat) && Number.isFinite(r3.loc.lon);
  if (recentre || !Number.isFinite(M.lat)) { if (has) { M.lat = r3.loc.lat; M.lon = r3.loc.lon; } else if (!Number.isFinite(M.lat)) { M.lat = 0; M.lon = 0; M.z = 2; } }
  const w = box.clientWidth, h = box.clientHeight, [cx, cy] = r3MapPx(M.lat, M.lon, M.z), x0 = cx - w / 2, y0 = cy - h / 2, n = 2 ** M.z;
  const lay = $('r3-map-t'), want = new Set();
  for (let ty = Math.floor(y0 / R3_TILE); ty <= Math.floor((y0 + h) / R3_TILE); ty++) for (let tx = Math.floor(x0 / R3_TILE); tx <= Math.floor((x0 + w) / R3_TILE); tx++) {
    if (ty < 0 || ty >= n) continue;
    const wx = ((tx % n) + n) % n, key = `${M.z}/${wx}/${ty}`; want.add(key + '@' + tx);
    let im = M.imgs[key + '@' + tx];
    if (!im) {
      im = document.createElement('img'); im.alt = ''; im.draggable = false; im.decoding = 'async';
      im.onerror = () => { im.style.visibility = 'hidden'; M.off++; $('r3-map-off').hidden = false; }; im.onload = () => { M.off = 0; $('r3-map-off').hidden = true; };
      im.src = `https://tile.openstreetmap.org/${key}.png`; M.imgs[key + '@' + tx] = im; lay.appendChild(im);
    }
    im.style.transform = `translate(${Math.round(tx * R3_TILE - x0)}px, ${Math.round(ty * R3_TILE - y0)}px)`;
  }
  for (const k of Object.keys(M.imgs)) if (!want.has(k)) { M.imgs[k].remove(); delete M.imgs[k]; }
  // el lugar del plate y la calle
  const cv = $('r3-map-cv'), dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  if (has) {
    const [px, py] = r3MapPx(r3.loc.lat, r3.loc.lon, M.z), sx = px - x0, sy = py - y0, a = r3.heading * Math.PI / 180;
    x.strokeStyle = '#7c4dff'; x.fillStyle = '#7c4dff'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.sin(a) * 34, sy - Math.cos(a) * 34); x.stroke();
    x.beginPath(); x.moveTo(sx + Math.sin(a) * 42, sy - Math.cos(a) * 42); x.lineTo(sx + Math.sin(a - 0.35) * 30, sy - Math.cos(a - 0.35) * 30); x.lineTo(sx + Math.sin(a + 0.35) * 30, sy - Math.cos(a + 0.35) * 30); x.closePath(); x.fill();
    x.fillStyle = '#ffffff'; x.strokeStyle = '#7c4dff'; x.lineWidth = 3; x.beginPath(); x.arc(sx, sy, 6, 0, Math.PI * 2); x.fill(); x.stroke();
  }
}
{
  const box = $('r3-map'); let drag = null;
  box.addEventListener('pointerdown', e => { if (e.target.closest('a')) return; drag = { x: e.clientX, y: e.clientY, moved: 0 }; box.setPointerCapture(e.pointerId); e.preventDefault(); });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    if (drag.moved < 4) return;
    const M = r3.map, [cx, cy] = r3MapPx(M.lat, M.lon, M.z); [M.lat, M.lon] = r3MapLL(cx - dx, cy - dy, M.z); r3MapDraw(false);
  });
  box.addEventListener('pointerup', e => {
    const d = drag; drag = null; if (!d || d.moved >= 4) return;
    const r = box.getBoundingClientRect(), M = r3.map, [cx, cy] = r3MapPx(M.lat, M.lon, M.z);
    const [lat, lon] = r3MapLL(cx - r.width / 2 + (e.clientX - r.left), cy - r.height / 2 + (e.clientY - r.top), M.z);
    if (M.aim && Number.isFinite(r3.loc.lat)) { // rumbo inicial del lugar del plate al punto
      const p1 = r3.loc.lat * Math.PI / 180, p2 = lat * Math.PI / 180, dl = (lon - r3.loc.lon) * Math.PI / 180;
      const b = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * 180 / Math.PI;
      M.aim = false; r3SetHeading(b); return;
    }
    r3SetLoc(lat, lon, 'manual', false);
  });
  box.addEventListener('wheel', e => { e.preventDefault(); const M = r3.map; M.z = Math.max(2, Math.min(19, M.z + (e.deltaY < 0 ? 1 : -1))); r3MapDraw(false); }, { passive: false });
  new ResizeObserver(() => { if (r3.on) r3MapDraw(false); }).observe(box);
}

// ---------- El sol en el HDRI (HDRI › Sun in the HDRI…): un popup que no tapa el resto de la app ----------
// la imagen del HDRI para mirarla: a 1024 de ancho como mucho, con una exposición automática (promedio logarítmico) y
// Reinhard, en sRGB. La fila 0 del archivo es la de abajo
function r3HdriPrev() {
  const H = r3.hdri, s = H.src; if (!s) return null;
  if (H.prev && H.prev.src === s) return H.prev.cv;
  const f = Math.max(1, Math.ceil(s.w / 1024)), w = Math.floor(s.w / f), h = Math.floor(s.h / f), d = s.data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 28) { const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; if (L > 0 && Number.isFinite(L)) { sum += Math.log(L); n++; } }
  const k = 0.18 / Math.exp(n ? sum / n : 0);
  const enc = (c) => { c = Math.max(0, c * k); c = c / (1 + c); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); };
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), D = img.data;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(s.h - 1, Math.floor((h - 1 - y + 0.5) * s.h / h));
    for (let x = 0; x < w; x++) { const i = (sy * s.w + Math.min(s.w - 1, x * f)) * 4, o = (y * w + x) * 4; D[o] = enc(d[i]); D[o + 1] = enc(d[i + 1]); D[o + 2] = enc(d[i + 2]); D[o + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0); H.prev = { src: s, cv };
  return cv;
}
function r3HdriDlg(on) {
  const dlg = $('r3-hdri-dlg'); if (!dlg) return;
  if (on && !r3.hdri.src) { toast(r3.hdri.name ? 'Load the HDRI again to see it' : 'Load an HDRI first', true); return; }
  dlg.hidden = !on;
  if (on) { r3HdriDlgDraw(); $('r3-hdri-cv').focus({ preventScroll: true }); }
}
// la imagen, el horizonte, hacia dónde mira la cámara de la toma y el sol de 3D Render (con su giro: sin el lock, girar
// el HDRI mueve el sol sobre la imagen; con el lock, quedan juntos)
function r3HdriDlgDraw() {
  const dlg = $('r3-hdri-dlg'); if (!dlg || dlg.hidden) return;
  const H = r3.hdri, cv = $('r3-hdri-cv'), pv = r3HdriPrev(); if (!pv) { dlg.hidden = true; return; }
  const W = Math.max(1, Math.min(cv.parentNode.clientWidth, Math.floor(window.innerHeight * 0.25) * 4)), Hh = Math.round(W / 2), dpr = window.devicePixelRatio || 1, us = uiScaleGet();
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
  cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.imageSmoothingQuality = 'high';
  x.drawImage(pv, 0, 0, W, Hh);
  x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,0.45)'; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(0, Hh / 2); x.lineTo(W, Hh / 2); x.stroke();
  x.font = `600 ${Math.round(11 * us)}px Inter, sans-serif`; x.textBaseline = 'middle';
  { camera.updateMatrixWorld(); const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), a = sunFromWorld(fw.x, fw.y, fw.z, r3.heading);
    const cx = sunToHdri(a.az, 0, H.rot, r3.heading).u * W;
    x.strokeStyle = '#ffb74d'; x.setLineDash([4, 5]); x.beginPath(); x.moveTo(cx, 0); x.lineTo(cx, Hh); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#ffb74d'; x.textAlign = cx > W - 90 * us ? 'right' : 'left'; x.fillText('Shot camera', cx + (cx > W - 90 * us ? -6 : 6), Hh - 12 * us); }
  x.setLineDash([]);
  const sun = r3SunNow(), p = sunToHdri(sun.az, sun.el, H.rot, r3.heading), sx = p.u * W, sy = (0.5 - p.el / 180) * Hh, R = 10 * us, lk = r3HdriLock();
  for (const [c, lw] of [['rgba(0,0,0,0.7)', 4], ['#ffd666', 2]]) {
    x.strokeStyle = c; x.lineWidth = lw * us; x.beginPath(); x.arc(sx, sy, R, 0, Math.PI * 2); x.stroke();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; x.beginPath(); x.moveTo(sx + Math.cos(a) * R * 1.35, sy + Math.sin(a) * R * 1.35); x.lineTo(sx + Math.cos(a) * R * 1.8, sy + Math.sin(a) * R * 1.8); x.stroke(); }
  }
  x.textAlign = sx > W - 140 * us ? 'right' : 'left'; x.fillStyle = '#ffd666';
  x.fillText(`${r3Fmt(sun.el)}° up${lk ? ' · locked' : ''}`, sx + (sx > W - 140 * us ? -R * 2 : R * 2), sy);
  $('r3-hdri-dlg-n').textContent = `${H.name} · click or drag where its sun is${H.on ? '' : ' (the HDRI is off: Use the HDRI)'}`;
  const r2 = $('r3-hdri-rot2'); if (document.activeElement !== r2) r2.value = H.rot;
  $('r3-hdri-rot2-n').textContent = `${r3Fmt(H.rot)}°`;
  $('r3-hdri-lock2').checked = H.lock; $('r3-hdri-lock2').disabled = !H.lock && !H.on;
}
// el click en el HDRI: con el lock, ese pasa a ser el punto del sol trabado; sin el lock, el sol va ahí y sigue libre
function r3HdriPick(u, el) {
  const H = r3.hdri; el = Math.max(-10, Math.min(90, el)); u = ((u % 1) + 1) % 1;
  if (r3HdriLock()) { H.sun = { u, el }; r3.sunMode = 'art'; r3Save(); r3Panel(); r3Dirty(); r3Dirty('top'); }
  else { const s = sunFromHdri(u, el, H.rot, r3.heading); r3SetSun(s.az, s.el, true); }
}
{
  const cv = $('r3-hdri-cv'); let on = false;
  const at = (e) => { const r = cv.getBoundingClientRect(); r3HdriPick((e.clientX - r.left) / r.width, (0.5 - (e.clientY - r.top) / r.height) * 180); };
  cv.addEventListener('pointerdown', e => { if (e.button !== 0) return; on = true; cv.setPointerCapture(e.pointerId); e.preventDefault(); at(e); });
  cv.addEventListener('pointermove', e => { if (on) at(e); });
  cv.addEventListener('pointerup', () => { on = false; }); cv.addEventListener('pointercancel', () => { on = false; });
  cv.tabIndex = 0;
  $('r3-hdri-dlg-x').onclick = () => { r3HdriDlg(false); $('r3-hdri-pick').focus(); };
  $('r3-hdri-dlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); r3HdriDlg(false); $('r3-hdri-pick').focus(); } });
  $('r3-hdri-rot2').oninput = e => r3SetHdriRot(+e.target.value);
  $('r3-hdri-rot2').ondblclick = () => r3SetHdriRot(0);
  $('r3-hdri-pick').onclick = () => r3HdriDlg(true);
  for (const id of ['r3-hdri-lock', 'r3-hdri-lock2']) $(id).onchange = e => r3HdriSetLock(e.target.checked);
  new ResizeObserver(() => r3HdriDlgDraw()).observe($('r3-hdri-dlg').querySelector('.r3hdlg-pic'));
}

// ---------- Panel ----------
function r3SetLoc(lat, lon, src, recentre = true) {
  r3.loc = { lat: +(+lat).toFixed(6), lon: +(+lon).toFixed(6), src }; r3Save(); r3Panel(); r3MapDraw(recentre); r3Dirty();
}
function r3SetHeading(v) { r3.heading = Math.round(r3Wrap(v) * 10) / 10; r3Save(); r3Panel(); r3MapDraw(false); r3Dirty(); }
function r3Dial() {
  const cv = $('r3-dial'), x = cv.getContext('2d'), w = cv.width, c = w / 2, R = c - 14;
  x.clearRect(0, 0, w, w); x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1.5; x.beginPath(); x.arc(c, c, R, 0, Math.PI * 2); x.stroke();
  x.fillStyle = 'rgba(255,255,255,0.75)'; x.font = '600 11px Inter, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => { const r = a * Math.PI / 180; x.fillStyle = t === 'N' ? '#ff6b6b' : 'rgba(255,255,255,0.7)'; x.fillText(t, c + Math.sin(r) * (R + 8), c - Math.cos(r) * (R + 8)); });
  const a = r3.heading * Math.PI / 180; x.strokeStyle = '#9c90e8'; x.fillStyle = '#9c90e8'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(c - Math.sin(a) * R * 0.6, c + Math.cos(a) * R * 0.6); x.lineTo(c + Math.sin(a) * R * 0.75, c - Math.cos(a) * R * 0.75); x.stroke();
  x.beginPath(); x.moveTo(c + Math.sin(a) * R, c - Math.cos(a) * R); x.lineTo(c + Math.sin(a - 0.4) * R * 0.62, c - Math.cos(a - 0.4) * R * 0.62); x.lineTo(c + Math.sin(a + 0.4) * R * 0.62, c - Math.cos(a + 0.4) * R * 0.62); x.closePath(); x.fill();
}
function r3Panel() {
  if (!$('r3d')) return;
  const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  const H = r3.hdri, has = Number.isFinite(r3.loc.lat) && Number.isFinite(r3.loc.lon), meta = r3Meta();
  $('r3-hdri-name').textContent = H.src ? H.name : H.name ? `${H.name} (not loaded: load it again)` : 'No HDRI: a plain sky light';
  $('r3-hdri-x').hidden = !H.name;
  set('r3-hdri-cs', H.cs); set('r3-hdri-rot', H.rot); set('r3-hdri-int', H.int); $('r3-hdri-bg').checked = H.bg;
  $('r3-hdri-on').checked = H.on; $('r3-hdri-on').disabled = !H.name;
  $('r3-hdri-pick').disabled = !H.src; $('r3-hdri-lock').checked = H.lock; $('r3-hdri-lock').disabled = !H.lock && (!H.name || !H.on);
  for (const id of ['r3-hdri-cs', 'r3-hdri-rot', 'r3-hdri-int', 'r3-hdri-bg']) $(id).closest('.knobrow, .fld').classList.toggle('dim', !H.on || !H.name);
  $('r3-loc-src').textContent = !has ? (meta ? 'The plate metadata has no place: pick it on the map, paste a Google Maps link or type it.' : 'No place in the plate metadata: pick it on the map, paste a Google Maps link or type it.')
    : r3.loc.src === 'meta' ? `Place from the plate metadata (${meta ? meta.file : 'EXR'}).` : 'Place picked by hand' + (meta && meta.lat !== undefined ? ' (the plate metadata has its own: From metadata puts it back).' : '.');
  $('r3-from-meta').hidden = !(meta && ((meta.lat !== undefined && r3.loc.src !== 'meta') || (meta.date && r3.dtSrc !== 'meta')));
  $('r3-loc-src').classList.toggle('ok', r3.loc.src === 'meta');
  set('r3-lat', has ? r3.loc.lat : ''); set('r3-lon', has ? r3.loc.lon : '');
  set('r3-date', r3.date); set('r3-time', r3.time); set('r3-utc', r3.utc);
  set('r3-head', r3Fmt(r3.heading, 1)); r3Dial();
  $('r3-aim').setAttribute('aria-pressed', String(r3.map.aim)); $('r3-aim').disabled = !has;
  $('r3-sun-auto').setAttribute('aria-pressed', String(r3.sunMode === 'auto')); $('r3-sun-art').setAttribute('aria-pressed', String(r3.sunMode === 'art'));
  const sun = r3SunNow(), calc = r3.sunMode === 'auto' && !r3SunCalc();
  set('r3-az', r3Fmt(sun.az, 1)); set('r3-el', r3Fmt(sun.el, 1));
  $('r3-az').readOnly = r3.sunMode === 'auto'; $('r3-el').readOnly = r3.sunMode === 'auto' || r3HdriLock();
  $('r3-sun-note').textContent = r3HdriLock() ? 'Locked to the HDRI: it turns with the HDRI (Rotation), and moving it turns the HDRI. Its height is the one of the sun in the HDRI until it is unlocked.'
    : r3.sunMode === 'art' ? 'Placed by hand: Move (W) and Rotate (E) in the top view, or the numbers.'
    : calc ? 'Needs the place and the date: until then the sun stays where it was.' : `Sun of ${r3.date} ${r3.time} (UTC${r3.utc >= 0 ? '+' : ''}${r3.utc})${r3.dtSrc === 'meta' ? ', from the plate metadata' : ''}.${sun.el < 0 ? ' Below the horizon.' : ''}`;
  set('r3-sun-int', r3.sunInt); set('r3-sun-col', r3.sunCol); set('r3-exp', r3.exp);
  set('r3-sky-col', r3.skyCol); set('r3-gnd-col', r3.gndCol);
  { const has = !!r3.hdri.tex, phys = r3.skyMode === 'phys'; $('r3-sky-n').hidden = !has;
    $('r3-sky-sub').textContent = H.name && !H.on ? 'Sky (the HDRI is off)' : 'Sky (no HDRI)';
    for (const id of ['r3-sky-col', 'r3-gnd-col', 'r3-sky-def', 'r3-sky', 'r3-sky-colors', 'r3-sky-phys', 'r3-sky-t', 'r3-sky-alb']) $(id).disabled = has;
    $('r3-sky-colors').setAttribute('aria-pressed', String(!phys)); $('r3-sky-phys').setAttribute('aria-pressed', String(phys));
    $('r3-phys-rows').hidden = !phys; document.querySelector('.r3-skycols').hidden = phys;
    set('r3-sky-t', r3.sky.T); set('r3-sky-alb', r3.sky.alb); }
  // el path tracer (js/render3d-pt.js)
  { const P = r3.pt, pt = r3.engine === 'pt';
    set('r3-engine-p', r3.engine); $('r3-pt-st').textContent = pt ? (r3pt.built ? 'on' : r3pt.err ? (r3pt.empty ? 'no scene' : 'error') : 'loading') : 'off';
    set('r3-pt-samples', P.samples); set('r3-pt-bounces', P.bounces); set('r3-pt-res', P.res); set('r3-pt-tiles', String(P.tiles)); $('r3-pt-dn').checked = P.dn; set('r3-pt-dns', P.dnS); set('r3-pt-glossy', P.glossy);
    set('r3-pt-bg', P.bg); set('r3-pt-focus', P.focus); set('r3-pt-focusm', P.focusM); set('r3-pt-fstop', P.fstop);
    $('r3-pt-dns').closest('.knobrow').classList.toggle('dim', !P.dn);
    for (const id of ['r3-pt-focusm', 'r3-pt-fstop']) $(id).closest('.knobrow').classList.toggle('dim', P.focus !== 'manual');
    $('r3-pt-bg-n').textContent = P.bg === 'alpha' ? 'Transparent: the view shows a checkerboard; Render still and Render sequence save PNG with alpha (an MP4 playblast has no alpha).'
      : P.bg === 'plate' ? 'The plate behind the path trace (Plate on top, in Render, still puts it on top with the key).' : '';
    { let t = '';
      if (P.focus === 'depthlab' && typeof lensState !== 'undefined' && typeof bkLens === 'function') { const L = bkLens(0); t = `DepthLab: focus at ${(+lensState.focusM).toFixed(2)} m, T${+(+L.fNumber).toFixed(2)}, ${(+L.focalMm).toFixed(1)} mm lens, ${(+st.sw).toFixed(2)} mm sensor (DepthLab, in Lens and focus).`; }
      else if (P.focus === 'off') t = 'All sharp: no depth of field.';
      if (P.focus !== 'off' && Math.abs(par() - 1) > 1e-3) t += ` Anamorphic ${+par().toFixed(2)}×: oval bokeh, as tall as DepthLab's and ${+par().toFixed(2)}× narrower.`;
      $('r3-pt-focus-n').textContent = t; }
    $('r3-pt-skip-n').textContent = r3pt.built ? `${Math.round(r3pt.tris).toLocaleString('en-US')} triangles traced.` + (r3pt.skipped ? ` ${r3pt.skipped} objects left out: lines, points and splats are not path traced.` : '') : ''; }
  $('r3-sun-st').textContent = `${r3Fmt(sun.az, 0)}° · ${r3Fmt(sun.el, 0)}°`;
  $('r3-hdri-st').textContent = H.src ? (r3HdriLock() ? 'sun locked' : 'on') : H.name ? 'reload' : 'none';
  r3HdriDlgDraw();
  $('r3-post-st').textContent = r3.post.on ? 'on' : 'off';
  $('r3-st').textContent = (r3.engine === 'pt' ? 'path trace' : 'raster') + (r3.free ? ' · free camera' : '');
  $('r3-ras-st').textContent = r3.engine === 'pt' ? 'not in use' : r3.hq ? `max · ${r3.samples}` : 'interactive';
  { const id = typeof navPreset !== 'undefined' ? navPreset : 'maya', nv = typeof NAV !== 'undefined' && NAV[id];
    $('r3-cam-n').textContent = (r3.free ? 'Free camera of the view: it does not change the shot camera, the project, Shakelab or the other tabs. Renders and the playblast use it while it is on.' : r3.useShk ? 'The Shakelab camera, frame by frame.' : 'The shot camera.') +
      (nv ? ` Drag in Render to move the view (navigation of the app: ${id === 'game' ? 'WASD, RMB: look' : nv.hint}).` : '');
    $('r3-shot2').disabled = !r3.free; }
  $('r3-hq-p').checked = r3.hq; $('r3-shadows-p').checked = r3.shadows; set('r3-quality-p', r3.quality); set('r3-samples', r3.samples); set('r3-sunsize', r3.sunSize); set('r3-sky', r3.skyInt);
  $('r3-sky').closest('.knobrow').classList.toggle('dim', !!H.tex);
  { const ok = typeof shk !== 'undefined' && shk.takes && shk.takes.length;
    $('r3-shk').checked = r3.useShk;
    $('r3-shk-n').textContent = !ok ? 'Shakelab has no takes yet: record one there.' : shk.sel < 0 ? 'Choose a take in Shakelab.' : r3.useShk ? `Take ${shk.sel + 1} of Shakelab, on the shot camera.` : `Take ${shk.sel + 1} is chosen in Shakelab.`; }
  $('r3-ao').checked = r3.ao; set('r3-aoint', r3.aoInt); set('r3-aodist', r3.aoDist); set('r3-aosamples', r3.aoSamples); $('r3-gi').checked = r3.gi; set('r3-giint', r3.giInt); $('r3-refl').checked = r3.refl; $('r3-refl-n').hidden = !r3.refl; $('r3-gi').closest('label').classList.toggle('dim', r3.refl);
  $('r3-mb').checked = r3.mb; set('r3-shutter', r3.shutter);
  $('r3-mb-n').textContent = r3.mb ? (r3.engine === 'pt' ? 'Path trace: in Render still, Render sequence and the playblast (each sample at another moment of the shutter); not in the view.' : 'Raster: with Max quality and in the renders.') : ''; $('r3-plate').checked = r3.plate; set('r3-scale', String(r3.outScale));
  const P = r3.post; $('r3-post').checked = P.on; set('r3-bloom', P.bloom); set('r3-bloomr', P.bloomR); set('r3-bloomt', P.bloomT); set('r3-vig', P.vig); set('r3-grain', P.grain); set('r3-sat', P.sat); set('r3-con', P.con);
  $('r3-post-s').querySelectorAll('.knobrow').forEach(r => r.classList.toggle('dim', !P.on));
  $('r3-aoint').closest('.knobrow').classList.toggle('dim', !r3.ao); $('r3-aodist').closest('.knobrow').classList.toggle('dim', !r3.ao); $('r3-aosamples').closest('.knobrow').classList.toggle('dim', !r3.ao); $('r3-giint').closest('.knobrow').classList.toggle('dim', !r3.gi || r3.refl); $('r3-shutter').closest('.knobrow').classList.toggle('dim', !r3.mb);
  { const o = typeof r3OutSize === 'function' ? r3OutSize() : null, n = tl.end - tl.start + 1;
    $('r3-out-n').textContent = !o ? '' : r3.engine === 'pt'
      ? `${o.W} × ${o.H} px · path trace, ${r3.pt.samples} samples and ${r3.pt.bounces} bounces per frame · sequence: frames ${tl.start}–${tl.end} (${n}), PNG in a ZIP${r3.pt.bg !== 'env' ? ' with alpha' : ''}${r3.mb ? `, motion blur ${r3.shutter}°` : ''}.`
      : `${o.W} × ${o.H} px · ${r3.samples} samples per frame · sequence: frames ${tl.start}–${tl.end} (${n}), PNG in a ZIP${r3.mb ? `, motion blur ${r3.shutter}°` : ''}.`; }
  if (r3.gl) r3ViewUI();
}
{
  const num = (id, fn) => $(id).addEventListener('change', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) fn(v); r3Save(); r3Panel(); r3Dirty(); });
  document.querySelectorAll('[data-r3reset]').forEach(b => { b.onclick = () => r3ResetPart(b.dataset.r3reset); });
  $('f-r3-hdri').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) r3LoadHdri(f); };
  $('r3-from-meta').onclick = () => { r3.loc.src = ''; r3.dtSrc = ''; r3SunAuto(); if (r3FromMeta()) toast('Place and date from the plate metadata'); r3Save(); r3Panel(); r3MapDraw(true); r3Dirty(); };
  $('r3-hdri-x').onclick = () => { r3.hdri.src = null; r3.hdri.name = ''; r3.hdri.prev = null; r3.hdri.lock = false; r3.hdri.sun = null; r3HdriDlg(false); r3HdriBuild(); r3Save(); r3Panel(); };
  $('r3-hdri-cs').onchange = e => { r3.hdri.cs = e.target.value; r3HdriBuild(); r3Save(); };
  num('r3-hdri-rot', v => r3SetHdriRot(v));
  num('r3-hdri-int', v => { r3.hdri.int = Math.max(0, v); r3Lights(); r3GiSoon(); });
  $('r3-hdri-bg').onchange = e => { r3.hdri.bg = e.target.checked; r3Lights(); r3Save(); };
  $('r3-hdri-on').onchange = e => { r3.hdri.on = e.target.checked; r3HdriBuild(); r3Save(); r3Panel(); r3GiSoon(); };
  $('r3-place').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return; e.preventDefault(); e.stopPropagation();
    const p = sunParseLocation(e.target.value);
    if (!p) { toast('Paste a Google Maps link with the place, or type latitude, longitude (e.g. -34.6037, -58.3816)', true); return; }
    e.target.value = ''; r3SetLoc(p.lat, p.lon, 'manual'); toast(`Place: ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`);
  });
  $('r3-gmaps').onclick = () => {
    const has = Number.isFinite(r3.loc.lat) && Number.isFinite(r3.loc.lon);
    window.open(has ? `https://www.google.com/maps/search/?api=1&query=${r3.loc.lat},${r3.loc.lon}` : 'https://www.google.com/maps', '_blank', 'noopener');
  };
  num('r3-lat', v => { if (Math.abs(v) <= 90) r3SetLoc(v, Number.isFinite(r3.loc.lon) ? r3.loc.lon : 0, 'manual'); });
  num('r3-lon', v => { if (Math.abs(v) <= 180) r3SetLoc(Number.isFinite(r3.loc.lat) ? r3.loc.lat : 0, v, 'manual'); });
  $('r3-date').onchange = e => { if (e.target.value) { r3.date = e.target.value; r3.dtSrc = 'manual'; r3SunAuto(); r3Save(); r3Panel(); r3Dirty(); } };
  $('r3-time').onchange = e => { if (e.target.value) { r3.time = e.target.value.slice(0, 5); r3.dtSrc = 'manual'; r3SunAuto(); r3Save(); r3Panel(); r3Dirty(); } };
  num('r3-utc', v => { r3.utc = Math.max(-12, Math.min(14, v)); r3.dtSrc = 'manual'; });
  num('r3-head', v => r3SetHeading(v));
  $('r3d').querySelectorAll('[data-head]').forEach(b => { b.onclick = () => r3SetHeading(+b.dataset.head); });
  $('r3-aim').onclick = () => { r3.map.aim = !r3.map.aim; r3Panel(); if (r3.map.aim) toast('Click on the map where the street goes, ahead of the shot\'s car'); };
  { const cv = $('r3-dial'); let on = false;
    const at = (e) => { const r = cv.getBoundingClientRect(); r3SetHeading(Math.atan2(e.clientX - r.left - r.width / 2, -(e.clientY - r.top - r.height / 2)) * 180 / Math.PI); };
    cv.addEventListener('pointerdown', e => { on = true; cv.setPointerCapture(e.pointerId); at(e); });
    cv.addEventListener('pointermove', e => { if (on) at(e); });
    cv.addEventListener('pointerup', () => { on = false; }); }
  $('r3-sun-auto').onclick = () => { r3SunAuto(); r3Save(); r3Panel(); r3Dirty(); };
  $('r3-sun-art').onclick = () => { r3.sunMode = 'art'; r3Save(); r3Panel(); r3Dirty(); };
  num('r3-az', v => { if (r3HdriLock()) r3SetSun(v, r3.el); else if (r3.sunMode === 'art') r3.az = r3Wrap(v); });
  num('r3-el', v => { if (r3.sunMode === 'art' && !r3HdriLock()) r3.el = Math.max(-10, Math.min(90, v)); });
  num('r3-sun-int', v => { r3.sunInt = Math.max(0, v); });
  $('r3-sun-col').oninput = e => { r3.sunCol = e.target.value; r3Save(); r3Dirty(); };
  // el cielo sin HDRI: su color y el del suelo iluminan la escena (luz de cielo) y el del cielo es el fondo
  $('r3-sky-col').oninput = e => { r3.skyCol = e.target.value; r3Lights(); r3Save(); r3GiSoon(); };
  $('r3-gnd-col').oninput = e => { r3.gndCol = e.target.value; r3Lights(); r3Save(); r3GiSoon(); };
  $('r3-sky-colors').onclick = () => { r3.skyMode = 'colors'; r3Lights(); r3Save(); r3Panel(); r3GiSoon(); };
  $('r3-sky-phys').onclick = () => { r3.skyMode = 'phys'; r3Lights(); r3Save(); r3Panel(); r3GiSoon(); };
  for (const [id, k, lo, hi] of [['r3-sky-t', 'T', 1.7, 10], ['r3-sky-alb', 'alb', 0, 1]])
    num(id, v => { r3.sky[k] = Math.max(lo, Math.min(hi, v)); r3Lights(); r3GiSoon(); });
  // el path tracer: sus ajustes, aparte de los de Raster
  $('r3-engine-p').onchange = e => r3SetEngine(e.target.value);
  const ptSet = (patch) => { r3.pt = r3PtOf(Object.assign({}, r3.pt, patch)); r3Save(); r3Panel(); r3Dirty('shot'); };
  for (const [id, k] of [['r3-pt-samples', 'samples'], ['r3-pt-bounces', 'bounces'], ['r3-pt-dns', 'dnS'], ['r3-pt-glossy', 'glossy'], ['r3-pt-focusm', 'focusM'], ['r3-pt-fstop', 'fstop']])
    $(id).addEventListener('change', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) ptSet({ [k]: v, ...(k === 'focusM' || k === 'fstop' ? { focus: 'manual' } : {}) }); else r3Panel(); });
  for (const [id, k] of [['r3-pt-res', 'res'], ['r3-pt-tiles', 'tiles'], ['r3-pt-bg', 'bg'], ['r3-pt-focus', 'focus']]) $(id).onchange = e => ptSet({ [k]: e.target.value });
  $('r3-pt-dn').onchange = e => ptSet({ dn: e.target.checked });
  $('r3-pt-fc').onclick = () => r3PtFocusCenter();
  $('r3-shot2').onclick = () => r3ShotCam();
  $('r3-sky-def').onclick = () => { r3.skyCol = '#bfd4ff'; r3.gndCol = '#4a4238'; r3Lights(); r3Save(); r3Panel(); r3GiSoon(); };
  num('r3-exp', v => { r3.exp = Math.max(-8, Math.min(8, v)); });
  // calidad, salida y post (js/render3d-fx.js)
  // k: 'shot' si sólo cambia Render (calidad, salida, post)
  const chk = (id, fn, k = 'shot') => $(id).addEventListener('change', e => { fn(e.target.checked); r3Save(); r3Panel(); r3Dirty(k); });
  const numS = (id, fn) => $(id).addEventListener('change', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) fn(v); r3Save(); r3Panel(); r3Dirty('shot'); });
  chk('r3-hq-p', v => { r3.hq = v; }); chk('r3-shadows-p', v => { r3.shadows = v; }, 'all');
  $('r3-quality-p').onchange = e => { r3.quality = e.target.value; r3ApplyQuality(); r3Save(); r3Panel(); r3Dirty(); }; chk('r3-ao', v => { r3.ao = v; }); chk('r3-gi', v => { r3.gi = v; }); chk('r3-refl', v => { r3.refl = v; if (!v) r3Lights(); r3.giT = 0; }); chk('r3-mb', v => { r3.mb = v; });
  chk('r3-plate', v => { r3.plate = v; }); chk('r3-post', v => { r3.post.on = v; });
  numS('r3-samples', v => { r3.samples = Math.max(1, Math.min(4096, Math.round(v))); });
  num('r3-sky', v => { r3.skyInt = Math.max(0, Math.min(5, v)); r3Lights(); r3GiSoon(); });
  chk('r3-shk', v => { r3.useShk = v; }, 'all'); numS('r3-sunsize', v => { r3.sunSize = Math.max(0, Math.min(20, v)); });
  numS('r3-aoint', v => { r3.aoInt = Math.max(0, Math.min(2, v)); }); numS('r3-aodist', v => { r3.aoDist = Math.max(0.05, Math.min(50, v)); }); numS('r3-aosamples', v => { r3.aoSamples = Math.max(4, Math.min(64, Math.round(v))); }); numS('r3-giint', v => { r3.giInt = Math.max(0, Math.min(4, v)); });
  numS('r3-shutter', v => { r3.shutter = Math.max(0, Math.min(360, v)); });
  $('r3-scale').onchange = e => { r3.outScale = +e.target.value; r3Save(); r3Panel(); };
  for (const [id, k, lo, hi] of [['r3-bloom', 'bloom', 0, 3], ['r3-bloomr', 'bloomR', 0, 1], ['r3-bloomt', 'bloomT', 0, 10], ['r3-vig', 'vig', 0, 1], ['r3-grain', 'grain', 0, 0.3], ['r3-sat', 'sat', 0, 2], ['r3-con', 'con', 0.5, 2]])
    numS(id, v => { r3.post[k] = Math.max(lo, Math.min(hi, v)); });
  $('r3-still').onclick = () => r3RenderStill(); $('r3-seq').onclick = () => r3RenderSeq(); $('r3-cancel').onclick = () => { r3.cancel = true; };
  // W / E: las herramientas del sol, sólo en esta pestaña y fuera de los campos
  document.addEventListener('keydown', e => {
    if (!r3.on || e.ctrlKey || e.metaKey || e.altKey || e.target.closest && e.target.closest('input, select, textarea, [contenteditable]')) return;
    if (e.key === 'Escape' && r3.sunPick) { r3SunPickSet(false); e.preventDefault(); e.stopPropagation(); return; }
    const k = e.key.toLowerCase(); if (k !== 'w' && k !== 'e') return;
    r3.tool = k === 'w' ? 'move' : 'rotate'; r3Save(); r3ViewUI(); e.preventDefault(); e.stopPropagation();
  }, true);
  // la metadata de un plate nuevo: el lugar y la fecha (si no se cambiaron a mano)
  if (typeof camRenderMeta === 'function') { const f = camRenderMeta; camRenderMeta = function (...a) { const r = f(...a); if (r3FromMeta()) { r3Save(); if (r3.on) { r3Panel(); r3MapDraw(true); r3Dirty(); } } return r; }; }
  r3Build();
}
// ---------- Proyecto ----------
function r3dProjectState() { return r3State(); }
// Reset de una sección del panel (o del visor entero): esas claves vuelven a sus valores de arranque y el resto queda
// como está. Nunca se tocan el lugar, la fecha, el rumbo de la calle, el archivo del HDRI ni los materiales editados
// (tienen su propio Reset).
const R3_RESET = {
  render: ['useShk', 'sunSize', 'mb', 'shutter', 'exp', 'plate', 'outScale'],
  raster: ['hq', 'samples', 'ao', 'aoInt', 'aoDist', 'aoSamples', 'gi', 'giInt', 'refl', 'quality', 'shadows'],
  hdri: ['hdriOn', 'hdriCs', 'hdriRot', 'hdriInt', 'hdriBg', 'hdriLock', 'hdriSun', 'skyInt', 'skyCol', 'gndCol', 'skyMode', 'skyT', 'skyAlb'],
  pt: ['pt'],
  sun: ['sunMode', 'az', 'el', 'sunInt', 'sunCol', 'hdriLock'],
  post: ['postOn', 'bloom', 'bloomR', 'bloomT', 'vig', 'grain', 'sat', 'con'],
};
R3_RESET.view = [...R3_RESET.render, ...R3_RESET.raster, ...R3_RESET.hdri, ...R3_RESET.sun, ...R3_RESET.post, ...R3_RESET.pt, 'views', 'engine'];
function r3ResetPart(part) {
  const s = r3State(); for (const k of R3_RESET[part] || []) delete s[k];
  if (part === 'sun' || part === 'view') { const d = r3SunNow(); s.az = d.az; s.el = d.el; } // en Artistic se queda donde estaba hasta recalcular
  r3dApplyProject(s); r3Dirty();
}
// Reset all (y abrir otro proyecto o la demo): los materiales editados vuelven a como vienen; con Reset all, además,
// todo 3D Render a sus valores de arranque (un proyecto que se abre después pone los suyos)
function r3dReset(keepPrefs) {
  if (!keepPrefs) { r3dApplyProject({}); return; }
  r3.matEdits = {}; r3.matSel = '';
  for (const m of r3.mats.values()) r3MatApply(m);
  if (r3.on) { r3MatUI(); r3Dirty(); }
}
function r3dApplyProject(s) {
  if (!s || typeof s !== 'object') return;
  const H = r3.hdri, num = (v, d) => Number.isFinite(+v) && v !== null && v !== '' ? +v : d;
  r3.tool = s.tool === 'rotate' ? 'rotate' : 'move'; r3.max = !!s.max; r3.shadows = s.shadows !== false; r3.quality = R3_QUALITY[s.quality] ? s.quality : 'high';
  H.on = s.hdriOn !== false; H.cs = s.hdriCs === 'acescg' ? 'acescg' : 'lin'; H.rot = num(s.hdriRot, 0); H.int = num(s.hdriInt, 1); H.bg = s.hdriBg !== false;
  if ((s.hdriName || '') !== H.name) { H.name = s.hdriName || ''; H.src = null; H.prev = null; }
  H.lock = !!s.hdriLock; H.sun = r3HdriSunOf(s.hdriSun);
  r3.loc = { lat: num(s.lat, NaN), lon: num(s.lon, NaN), src: s.locSrc === 'manual' ? 'manual' : s.locSrc === 'meta' ? 'meta' : '' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) r3.date = s.date; if (/^\d{1,2}:\d{2}$/.test(s.time || '')) r3.time = s.time;
  r3.utc = num(s.utc, r3.utc); r3.dtSrc = s.dtSrc === 'manual' ? 'manual' : s.dtSrc === 'meta' ? 'meta' : '';
  r3.heading = r3Wrap(num(s.heading, 0)); r3.sunMode = s.sunMode === 'art' || H.lock ? 'art' : 'auto'; r3.az = num(s.az, r3.az); r3.el = num(s.el, r3.el);
  r3.sunInt = num(s.sunInt, 2.4); r3.sunCol = /^#[0-9a-f]{6}$/i.test(s.sunCol || '') ? s.sunCol : '#fff4e5'; r3.exp = num(s.exp, 0);
  r3.hq = !!s.hq; r3.samples = Math.max(1, Math.min(4096, Math.round(num(s.samples, 64)))); r3.sunSize = num(s.sunSize, 0.53); r3.ao = s.ao !== false; r3.aoInt = num(s.aoInt, 0.25); r3.aoDist = Math.max(0.05, Math.min(50, num(s.aoDist, 1.5))); r3.aoSamples = Math.max(4, Math.min(64, Math.round(num(s.aoSamples, 16))));
  r3.gi = s.gi !== false; r3.giInt = num(s.giInt, 1); r3.refl = s.refl !== false; r3.mb = !!s.mb; r3.shutter = num(s.shutter, 180); r3.plate = !!s.plate; r3.outScale = [1, 0.5, 0.25].includes(+s.outScale) ? +s.outScale : 1;
  r3.views = r3ViewsOf(s.views); r3.skyInt = num(s.skyInt, 0.6); r3.skyCol = /^#[0-9a-f]{6}$/i.test(s.skyCol || '') ? s.skyCol : '#bfd4ff'; r3.gndCol = /^#[0-9a-f]{6}$/i.test(s.gndCol || '') ? s.gndCol : '#4a4238'; r3.useShk = !!s.useShk;
  { const sk = r3SkyOf(s); r3.skyMode = sk.mode; r3.sky = sk; }
  r3.pt = r3PtOf(s.pt);
  { const e = s.engine === 'pt' ? 'pt' : 'raster'; if (e !== r3.engine) { r3.engine = e; r3.free = false; if (e === 'raster') r3PtDispose(); } }
  r3.matEdits = s.matEdits && typeof s.matEdits === 'object' ? JSON.parse(JSON.stringify(s.matEdits)) : {};
  for (const m of r3.mats.values()) r3MatApply(m);
  r3.post = { on: !!s.postOn, bloom: num(s.bloom, 0.25), bloomR: num(s.bloomR, 0.4), bloomT: num(s.bloomT, 0.9), vig: num(s.vig, 0.25), grain: num(s.grain, 0.02), sat: num(s.sat, 1), con: num(s.con, 1) };
  r3Save(); r3ApplyQuality();
  if (r3.gl) r3HdriBuild();
  r3ViewUI(); r3Panel(); if (r3.on) { r3MapDraw(true); r3Dirty(); }
}
