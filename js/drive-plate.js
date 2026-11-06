// drive-plate: un driving plate (calle filmada desde un auto, imagen o video) con SU cámara,
// reproyectado detrás del plate de croma con la cámara de la toma (homografía de rotación de
// js/drive-math.js, en GPU) y analizado: escala, cobertura, horizonte, altura y desenfoque.
// Puede ser un ARRAY: hasta DRV_MAX cámaras del mismo auto, cada una con su archivo, su cámara, su yaw de
// montaje y su sincro; donde se superponen manda la que mejor cubre, con un borde suave.
// La cámara de la toma no se duplica: sale de sceneIntr() / scenePose() (js/scene-lines.js).
// API: drv (los campos de una cámara son los de la elegida, drv.units[drv.sel]), drvRender (enganche en
// render()), drvLoadFile, drvClear, drvSetCamera, drvProjectState, drvApplyProject, drvCornerPinText.
const DRV_CAM_DEF = { preset: 'custom', ex: null, sw: 36, focal: 35, par: 1, tiltDeg: 0, rollDeg: 0, yawDeg: 180, heightM: 1.5 };
const DRV_MAX = 6, DRV_TAU = 0.015; // TAU: ancho del borde suave entre dos cámaras, en fracción del cuadro
const DRV_UNIT_KEYS = ['src', 'kind', 'name', 'url', 'W', 'H', 'fps', 'n', 'offset', 'cam', 'metaNote', 'shown', 'wantName', 'keepCam', 'file', 'tex', 'track', 'label', 'tc', 'fit', 'pin', 'pinScale'];
function drvNewUnit() {
  return { src: null, kind: '', name: '', url: '', W: 0, H: 0, fps: 24, n: 1, offset: 0, cam: { ...DRV_CAM_DEF }, metaNote: '', shown: -1, pending: -1, wantName: '', keepCam: false, file: null, tex: null, track: null, label: '', tc: null, fit: 'meta', pin: null, pinScale: 100 };
}
// defAt: a qué distancia va el desenfoque del driving (Copy Defocus): 'inf', 'bg', 'm<metros>' o 'p<id de sonda>'
// libFiles: los driving plates cargados en la sesión (las flechas de la caja pasan de uno a otro); pinEdit: las manijas
// del corner pin a la vista (el botón de la izquierda en Compare and Match); hz: el horizonte del driving en el visor
const drv = { units: [drvNewUnit()], sel: 0, on: true, mix: 1, gl: null, mat: null, info: '', an: null, win: null, defAt: 'inf', wipe: null, libFiles: [], pinEdit: true, hz: !!lsGet('drv.hz', false) };
// drv.src, drv.cam, drv.name… son los de la cámara elegida (así lo leen drive-tools, el recorrido y el playblast)
DRV_UNIT_KEYS.forEach(k => Object.defineProperty(drv, k, { get: () => drv.units[drv.sel][k], set: (v) => { drv.units[drv.sel][k] = v; }, enumerable: true }));
// pending: el cuadro que espera cualquiera de las cámaras (el playblast espera a todas)
Object.defineProperty(drv, 'pending', { get: () => { const u = drv.units.find(x => x.pending >= 0); return u ? u.pending : -1; }, set: (v) => { drv.units[drv.sel].pending = v; }, enumerable: true });
const drvU = () => drv.units[drv.sel];
const drvLive = () => drv.units.filter(u => u.src);
const drvCv = $('drv-gl');
stage.insertBefore(drvCv, plateImg); // debajo del plate, encima del entorno (#glenv): se ve donde el key deja pasar

function drvIntr(u = drvU()) { return { focalMm: u.cam.focal, filmWidthMm: u.cam.sw, squeeze: u.cam.par, plateW: u.W, plateH: u.H }; }
// cuadro del driving (desde 0) que va con un cuadro f del timeline (el actual si no se da)
const drvIndexAt = (u, f) => Math.min(Math.max(f - tl.start + u.offset, 0), u.n - 1);
function drvFrameIndex(u = drvU()) { return drvIndexAt(u, tl.frame); }
// cuadro EXR de la secuencia que va con el cuadro i del video (el actual si no se da)
const drvTrackFrame = (u, i = drvFrameIndex(u)) => u.track.start + (u.kind === 'video' ? i : 0);
const drvTrackNow = (u, i) => u.track && u.track.on ? DriveMath.trackAt(u.track, drvTrackFrame(u, i)) : null;
// keyframes de la cámara (Measure drive camera en varios cuadros de un video): con dos o más, tilt, roll y yaw se
// interpolan entre ellos. Mientras se mide, manda la cámara que se está midiendo.
const drvKeys = (u = drvU()) => (u.cam.keys || []);
const drvKeyed = (u = drvU()) => u.kind === 'video' && drvKeys(u).length >= 2 && !(typeof dm !== 'undefined' && dm.on && u === drvU());
const drvKeysAt = (u, i = drvFrameIndex(u)) => drvKeyed(u) ? DriveMath.keysAt(drvKeys(u), i) : null;
// tilt y roll por cuadro: los headers de la secuencia EXR mandan sobre los keyframes, y éstos sobre la cámara
function drvPose(u = drvU(), i) {
  const c = u.cam, t = drvTrackNow(u, i), k = drvKeysAt(u, i), b = k || c;
  return { tiltDeg: t ? t.tilt : b.tiltDeg, rollDeg: t ? t.roll : b.rollDeg, yawDeg: b.yawDeg, heightM: c.heightM };
}
// la cámara cambia a lo largo del clip (keyframes o tilt por cuadro): Copy CornerPin va animado
const drvAnimated = (u = drvU()) => u.kind === 'video' && (drvKeyed(u) || !!(u.track && u.track.on));
const drvLooks = (yaw) => SC_LOOKS.reduce((b, l) => Math.abs(SceneMath.angleDelta(yaw, l[1])) < Math.abs(SceneMath.angleDelta(yaw, b[1])) ? l : b)[2];
const drvCamName = (u) => `Cam ${drv.units.indexOf(u) + 1} · ${u.label || drvLooks(u.cam.yawDeg)}`;

// ---------- Fit: por la metadata (la cámara del driving) o con un corner pin 2D ----------
// Con Corner pin, las cuatro esquinas del driving, donde las pone su cámara, se corren a mano (u.pin: [dx, dy] en
// px de la toma, arriba-izq, arriba-der, abajo-der, abajo-izq) para machearlo a las 3D Guides; Copy CornerPin las
// lleva a Nuke así. Lo que se corre se dice en el panel: el 3D sigue siendo la referencia (D-06).
const drvPinOn = (u = drvU()) => u.fit === 'pin' && !!u.pin;
const drvPinCorners = (u, h) => [[0, 0], [u.W, 0], [u.W, u.H], [0, u.H]].map(q => DriveMath.apply(h.ds, q));
function drvPinned(u, h) {
  if (!h || !drvPinOn(u)) return h;
  const C = drvPinCorners(u, h); if (C.some(c => !c)) return h;
  const A = DriveMath.quad(C.map((c, i) => [c[0] + u.pin[i][0], c[1] + u.pin[i][1]]), C); if (!A) return h;
  const sd = DriveMath.mul(h.sd, A), ds = DriveMath.inv(sd);
  return ds ? { sd, ds } : h;
}
const drvPinMax = (u = drvU()) => drvPinOn(u) ? Math.max(...u.pin.map(([x, y]) => Math.hypot(x, y))) : 0;

// ---------- GPU: un quad que lee cada driving por su homografía; fuera de todos, rayado ----------
function drvInitGL() {
  if (drv.gl) return;
  drv.gl = new THREE.WebGLRenderer({ canvas: drvCv, alpha: true, antialias: false });
  drv.gl.outputColorSpace = THREE.LinearSRGBColorSpace; // como el default de r147: el shader ya escribe lo que va a pantalla
  drv.gl.setClearColor(0x000000, 0); glKeep(drv.gl, () => render());
  const I = [...Array(DRV_MAX).keys()];
  const uniforms = { Hm: { value: I.map(() => new THREE.Matrix3()) }, size: { value: I.map(() => new THREE.Vector2(1, 1)) }, count: { value: 0 }, shot: { value: new THREE.Vector2(1, 1) }, mixv: { value: 1 }, gap: { value: new THREE.Color() } };
  I.forEach(i => { uniforms['map' + i] = { value: null }; });
  // un bloque por cámara con índices fijos (GLSL no deja indexar samplers con una variable)
  const one = (i) => `e[${i}] = -1.0; c[${i}] = vec3(0.0);
        if (${i} < count) { vec3 q = Hm[${i}] * p; vec2 u = q.xy / max(q.z, 1e-9) / size[${i}];
          if (q.z > 0.0 && u.x >= 0.0 && u.y >= 0.0 && u.x <= 1.0 && u.y <= 1.0) { e[${i}] = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y)); c[${i}] = texture2D(map${i}, vec2(u.x, 1.0 - u.y)).rgb; m = max(m, e[${i}]); } }`;
  drv.mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // salida premultiplicada (el canvas compone así); el rayado marca lo que la toma ve fuera de los driving.
    // Donde se superponen pesa exp((margen - mejor margen) / TAU): la que mejor cubre, con un borde suave.
    fragmentShader: `${I.map(i => `uniform sampler2D map${i};`).join(' ')} uniform mat3 Hm[${DRV_MAX}]; uniform vec2 size[${DRV_MAX}]; uniform int count;
      uniform vec2 shot; uniform float mixv; uniform vec3 gap; varying vec2 vUv;
      void main() {
        vec3 p = vec3(vUv.x * shot.x, (1.0 - vUv.y) * shot.y, 1.0);
        float e[${DRV_MAX}]; vec3 c[${DRV_MAX}]; float m = -1.0;
        ${I.map(one).join('\n        ')}
        if (m < 0.0) {
          float a = 0.4 * step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 18.0));
          gl_FragColor = vec4(gap * a, a);
        } else {
          vec3 s = vec3(0.0); float ws = 0.0;
          ${I.map(i => `if (e[${i}] >= 0.0) { float w = exp((e[${i}] - m) / ${DRV_TAU.toFixed(4)}); s += w * c[${i}]; ws += w; }`).join('\n          ')}
          gl_FragColor = vec4(s / ws * mixv, mixv);
        }
      }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  drv.scene = new THREE.Scene();
  drv.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), drv.mat));
  drv.cam3 = new THREE.Camera();
}
function drvSetTexture(u, el, still) {
  drvInitGL();
  if (u.tex) u.tex.dispose();
  // un <video> va en VideoTexture: con Texture, three (WebGL2) reserva la textura con video.width / height, que
  // valen 0, y el driving de video salía negro
  const t = still ? new THREE.Texture(el) : new THREE.VideoTexture(el);
  t.minFilter = still ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.generateMipmaps = still;
  t.needsUpdate = true; u.tex = t;
}

// enganche en render() (js/timeline.js): cada vez que se dibuja el visor
function drvRender() {
  const live = drvLive(), show = !!(live.length && drv.on);
  if (drvCv.hidden === show) drvCv.hidden = !show;
  drvWipeUI(show);
  if (typeof lcOverDrive === 'function') lcOverDrive(show); // hook lane-cars: los autos encima del driving
  drvDefocusView(show);
  if (!show) { drvAnalysisUI(); return; }
  const iS = sceneIntr(), pS = scenePose(), U = drv.mat.uniforms;
  live.forEach((u, k) => {
    if (u.kind === 'video') {
      const i = drvFrameIndex(u);
      if (i !== u.shown && u.pending < 0) { u.pending = i; u.src.currentTime = (i + 0.5) / u.fps; }
    }
    const h = drvPinned(u, DriveMath.homography(iS, pS, drvIntr(u), drvPose(u)));
    if (h) U.Hm.value[k].set(...h.sd[0], ...h.sd[1], ...h.sd[2]); else U.Hm.value[k].set(0, 0, 0, 0, 0, 0, 0, 0, -1);
    U.size.value[k].set(u.W, u.H); U['map' + k].value = u.tex;
  });
  for (let k = live.length; k < DRV_MAX; k++) U['map' + k].value = null;
  U.count.value = live.length;
  U.shot.value.set(st.plate.W, st.plate.H); U.mixv.value = drv.mix;
  U.gap.value.set(getComputedStyle(document.documentElement).getPropertyValue('--bad').trim() || '#e0605a');
  const v = st.view, pr = renderer.getPixelRatio();
  if (drv.gl.getPixelRatio() !== pr) drv.gl.setPixelRatio(pr);
  const sz = drv.gl.getSize(new THREE.Vector2());
  if (sz.x !== v.baseW || sz.y !== v.baseH) drv.gl.setSize(v.baseW, v.baseH, false);
  drv.gl.render(drv.scene, drv.cam3);
  drvAnalysisUI();
  if (typeof dm !== 'undefined' && dm.on) dmDraw(); // hook drive-tools: el cuadro del video que se mide
}

// Defocus (Z defocus, D) en DepthLab: el driving se desenfoca con el desenfoque que da la lente de la toma a la
// distancia elegida al lado de Copy Defocus (∞ de arranque, el BG, una probe o una distancia fija), igual que el
// Defocus que se copia a Nuke. El driving no tiene profundidad: es un solo desenfoque para toda la imagen, y en
// pantalla es un blur de CSS (gaussiano, sigma = un cuarto del diámetro del disco).
function drvDefocusView(show) {
  const on = show && typeof zdf !== 'undefined' && zdf.on && typeof mtabCur !== 'undefined' && mtabCur === 'depthlab';
  const d = on ? (drvDefChoices().find(x => x.key === drv.defAt) || drvDefChoices().find(x => x.key === 'inf')) : null;
  const px = d && Number.isFinite(d.coc) ? d.coc * st.view.baseW / Math.max(1, st.plate.W) / 4 : 0;
  const f = px > 0.05 ? `blur(${px.toFixed(2)}px)` : '';
  if (drvCv.style.filter !== f) drvCv.style.filter = f;
  drv.blurPx = d && Number.isFinite(d.coc) && px > 0.05 ? d.coc : 0; // para la prueba y el panel
}

// ---------- Cargar ----------
// el nombre de una cámara está en el de un archivo: adentro si tiene 3 letras o más (ArrayDer en
// ..._ArrayDer_T2.mov); uno corto (A, B) sólo como palabra suelta (..._B_...)
const drvNameIn = (label, file) => { const l = String(label || '').toLowerCase(), f = String(file || '').toLowerCase(); return !!l && (l.length >= 3 ? f.includes(l) : f.split(/[^a-z0-9]+/).includes(l)); };
// into: la cámara que lo recibe; si no, la que espera ese archivo (proyecto abierto), la vacía cuyo nombre
// está en el del archivo (un array del reporte de set: ArrayDer -> ..._ArrayDer_T2.mov) o la elegida
async function drvLoadFile(file, into) {
  const u = into || drv.units.find(x => x.wantName === file.name && !x.src)
    || drv.units.find(x => !x.src && !x.wantName && drvNameIn(x.label, file.name)) || drvU();
  drv.sel = drv.units.indexOf(u);
  setBusy(true, 'Reading ' + file.name + '…');
  u.file = file;
  if (!drv.libFiles.some(f => f.name === file.name)) drv.libFiles.push(file);
  const want = u.wantName, prev = u.name; // el archivo que espera un proyecto abierto: sólo ése se queda con la cámara del proyecto
  try {
    let md = null;
    if (/\.exr$/i.test(file.name)) {
      const buf = await file.arrayBuffer(), h = EXR.parseHeader(buf), px = EXR.decode(buf, h);
      const cv = document.createElement('canvas');
      // shortcut: el EXR se ve con el espacio que detecta y el visor actual; se elige a mano si hace falta, más adelante
      const d = EXR.draw(px, h, { cs: EXR.detectSpace(h)[0], view: $('view').value || 'aces709', ev: 0 }, cv);
      drvSetSource(u, cv, 'image', file.name, d.W, d.H, '');
      md = camReadMeta(h);
    } else if (vplIsVideo(file)) {
      const info = /\.(mp4|m4v|mov)$/i.test(file.name) ? await vplMp4Info(file).catch(() => null) : null;
      const el = document.createElement('video'), url = URL.createObjectURL(file);
      el.muted = true; el.playsInline = true; el.preload = 'auto';
      try { await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(el.error); el.src = url; }); }
      catch (e) { URL.revokeObjectURL(url); throw new Error('the browser cannot play it (convert it to H.264 MP4)'); }
      // shortcut: WebM / MKV no dicen los fps; se usan los del timeline
      const fps = info ? info.fps : tl.fps;
      el.addEventListener('seeked', () => { if (u.src !== el) return; u.shown = u.pending; u.pending = -1; u.tex.needsUpdate = true; render(); });
      drvSetSource(u, el, 'video', file.name, el.videoWidth, el.videoHeight, url);
      Object.assign(u, { fps, n: info ? info.n : Math.max(1, Math.round(el.duration * fps)), tc: info && info.tc || null });
      if (u.track) drvTrackSync(u);
    } else {
      const url = URL.createObjectURL(file), im = new Image();
      try { await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; }); }
      catch (e) { URL.revokeObjectURL(url); throw new Error('the browser cannot open it'); }
      drvSetSource(u, im, 'image', file.name, im.naturalWidth, im.naturalHeight, url);
    }
    if (u.keepCam && want !== file.name) u.keepCam = false;
    if (u.track && file.name !== prev && file.name !== want) u.track = null; // el tilt/roll por cuadro era del archivo anterior
    drvApplyMeta(u, md);
    projectAfterLoad('drive'); // un proyecto que lo nombra espera este archivo
  } catch (err) {
    console.warn('drive plate', err); toast('Could not open ' + file.name + ': ' + (err.message || err), true);
  }
  setBusy(false);
  drvUI(); render();
}
// un video o un JPG no traen la cámara: se lee de un EXR del mismo driving (p. ej. el de _input)
async function drvLoadRef(file) {
  const u = drvU(); if (!u.src) return;
  setBusy(true, 'Reading ' + file.name + '…');
  try { u.keepCam = false; drvApplyMeta(u, camReadMeta(EXR.parseHeader(await file.arrayBuffer())), true); u.metaNote = u.metaNote.replace(/^From the file/, 'From ' + file.name); if (u.cam.src === 'exr') drvRemember('exr', u); }
  catch (err) { console.warn('drive EXR', err); toast('Could not read ' + file.name + ': ' + (err.message || err), true); }
  setBusy(false);
  drvUI(); render();
}
function drvSetSource(u, el, kind, name, W, H, url) {
  drvDrop(u);
  Object.assign(u, { src: el, kind, name, W, H, url, shown: -1, pending: -1, n: 1, wantName: '', tc: null });
  drvSetTexture(u, el, kind !== 'video');
  if (kind === 'video') u.shown = -2; // el primer render pide el frame que corresponde
}
function drvDrop(u = drvU()) {
  if (u.kind === 'video' && u.src) { u.src.pause(); u.src.removeAttribute('src'); u.src.load(); }
  if (u.url) URL.revokeObjectURL(u.url);
  if (u.tex) { u.tex.dispose(); u.tex = null; }
  Object.assign(u, { src: null, kind: '', name: '', url: '', W: 0, H: 0, pending: -1 });
  drv.an = null; drv.info = '';
}
// todo el driving (todas las cámaras): Remove con una sola cámara, y el reset de la app
function drvClear() {
  drv.units.forEach(u => drvDrop(u));
  drv.units = [drvNewUnit()]; drv.sel = 0; drv.on = true; drv.mix = 1; drv.defAt = 'inf';
  drvCams = {}; drv.libFiles = []; // un proyecto nuevo, la demo o Reset all no heredan las cámaras del driving anterior
  drvUI(); render();
}
// Remove: saca la cámara elegida del array (con una sola, todo el driving)
function drvRemoveCam() {
  if (drv.units.length < 2) { drvClear(); return; }
  drvDrop(drvU()); drv.units.splice(drv.sel, 1); drv.sel = Math.max(0, drv.sel - 1);
  drvUI(); render();
}
// una cámara más del array; devuelve la nueva (elegida) o null si ya hay DRV_MAX
function drvAddCam() {
  if (drv.units.length >= DRV_MAX) { toast(`An array takes up to ${DRV_MAX} cameras`, true); return null; }
  const u = drvNewUnit(), p = drvU().cam;
  // mismo auto: la misma altura y lente de arranque que la elegida; el yaw lo pone el usuario (o el reporte)
  Object.assign(u.cam, { heightM: p.heightM, focal: p.focal, sw: p.sw, preset: p.preset, ex: p.ex });
  drv.units.push(u); drv.sel = drv.units.length - 1;
  return u;
}

// metadata del EXR -> cámara del driving (como camApplyPlateMeta). Pura: la usa también la tabla de candidatos.
// Devuelve { cam, out, check } con la cámara completada sobre base, u null si el archivo no trae cámara. bands: las
// negras de la imagen ({ x, y } px por lado, drvBands); check: lo supuesto del encuadre, para Values to check.
function drvCamFromMeta(md, W, H, base, bands) {
  if (!md || !md.has) return null;
  const c = { ...base }, out = [], b = camMatchBody(md.camera), m = b && camMatchMode(b, md.rw, md.rh);
  let check = '';
  if (m) {
    const bx = bands ? bands.x : 0, by = bands ? bands.y : 0, f = camPlateFormat(m, W, H, bx, by), ex = f.ex;
    c.preset = m.key; c.ex = ex; c.sw = f.sw;
    const bt = by ? `${by} px black bands top and bottom` : bx ? `${bx} px black bands left and right` : '';
    // «KOMODO 6K» + «6K 17:9»: no repetir la palabra en que termina el cuerpo
    const bn = camBodyName(b), lw = m.label.split(' ')[0], ml = bn.split(' ').pop() === lw ? m.label.slice(lw.length).trim() : m.label;
    if (f.guess) check = `${bn} ${ml} on a ${W} × ${H} picture` + (bt ? ` with ${bt}` : '') + `: ${ex ? `extraction ${ex.w} × ${ex.h}` : 'the full recorded frame'} guessed (film ${fmt(c.sw, 2)} mm), the file does not say how it was framed`;
    out.push(bn + ' ' + ml + (f.guess ? ` (${ex ? `extraction ${ex.w} × ${ex.h}` : 'full width'}${bt ? ', ' + bt : ''}: guessed, check it)` : ''));
  }
  else if (md.pitch > 0 && md.rw > 0) { c.preset = 'custom'; c.ex = null; c.sw = md.rw * md.pitch / 1000; out.push(`film ${fmt(c.sw, 2)} mm`); }
  else if (b) { const g = camClosestMode(b, W, H); c.preset = g.key; c.ex = null; c.sw = g.w; out.push(camBodyName(b) + ' ' + g.label + ' (mode guessed)'); }
  else if (md.hint.sw) { c.preset = 'custom'; c.ex = null; c.sw = md.hint.sw; out.push(`film ${fmt(c.sw, 2)} mm`); }
  if (md.focal > 0) { c.focal = md.focal; out.push(`${fmt(md.focal, 1)} mm`); }
  c.par = Math.abs(md.par - 1) > 1e-3 ? md.par : md.squeeze > 0 ? md.squeeze : 1;
  if (md.orient && md.orient.tilt) { c.tiltDeg = md.orient.tilt.v; out.push(`tilt ${fmt(c.tiltDeg, 1)}°`); }
  if (md.orient && md.orient.roll) { c.rollDeg = md.orient.roll.v; out.push(`roll ${fmt(c.rollDeg, 1)}°`); }
  if (c.keys && md.orient && (md.orient.tilt || md.orient.roll)) delete c.keys; // la cámara nueva reemplaza a la medida por cuadros
  c.src = 'exr';
  return out.length ? { cam: c, out, check } : null;
}
// bandas negras de la imagen del driving ({ x, y } px por lado, camBands), de dos copias angostas
function drvBands(el, W, H) {
  try {
    const cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true }), n = 64;
    const scan = (w, h, len, at) => {
      cv.width = w; cv.height = h; g.drawImage(el, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      // negra: ningún canal pasa de 8/255 a lo largo de toda la fila (o columna)
      return camBands(len, (k) => { for (let j = 0; j < n; j++) { const i = at(k, j) * 4; if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) return false; } return true; });
    };
    return { y: scan(n, H, H, (y, x) => y * n + x), x: scan(W, n, W, (x, y) => y * W + x) };
  } catch (e) { return { x: 0, y: 0 }; }
}
// hook setreport: lo supuesto de la cámara del driving va a Values to check del reporte cargado
function drvToCheck(w) { if (w && typeof sr !== 'undefined' && sr.report && !sr.report.warnings.includes(w)) { sr.report.warnings.push(w); srUI(); } }
// fromRef: el usuario eligió un EXR de referencia, así que su metadata manda sobre lo guardado.
function drvApplyMeta(u, md, fromRef) {
  // re-vínculo: manda el proyecto, con la nota que se guardó (de dónde salió esa cámara)
  if (u.keepCam) { u.keepCam = false; if (!u.metaNote) u.metaNote = `Camera from the project (${drvSrcText(u.cam)}).`; return; }
  // la cámara que se midió o tipeó antes para este mismo archivo (queda en el proyecto) manda sobre su metadata
  const k = !fromRef && drvCams[u.name];
  // con su cámara vuelven el fit y el corner pin de ese archivo (al pasar de un driving a otro con las flechas)
  if (k) { const { note, fit, pin, pinScale, ...kc } = k; u.cam = { ...DRV_CAM_DEF, ...kc }; u.metaNote = note || `Camera ${drvSrcText(kc)}, kept for this file.`; u.fit = fit === 'pin' ? 'pin' : 'meta'; u.pin = drvPinOf(pin); u.pinScale = pinScale || 100; return; }
  if (!fromRef) { u.fit = 'meta'; u.pin = null; u.pinScale = 100; } // un archivo nuevo arranca por su metadata
  if (!fromRef && u.cam.keys) { u.cam = { ...u.cam }; delete u.cam.keys; } // los keyframes eran del archivo anterior
  const r = drvCamFromMeta(md, u.W, u.H, u.cam, md && md.has && u.src ? drvBands(u.src, u.W, u.H) : null);
  if (!r) { u.metaNote = u.cam.src === 'report' ? `Camera from the set report${u.label ? ' (' + u.label + ')' : ''}.` : 'No camera in the file: set it by hand or Measure drive camera.'; return; }
  u.cam = r.cam;
  u.metaNote = 'From the file: ' + r.out.join(', ') + '. Height and Looks to are not in the file.';
  if (r.check) drvToCheck(`Drive plate ${u.name}: ${r.check}`);
}
// cámaras medidas o tipeadas por archivo (nombre), con su nota, para los que no traen metadata: van en el proyecto
let drvCams = {};
// de dónde sale cada cámara (D-05): src 'measured' (Measure drive camera), 'exr' (metadata de un EXR), 'report'
// (reporte de set; planned: lo planeado de un array) o 'typed' (a mano)
const DRV_SRC = { measured: 'measured on the plate', report: 'from the set report', typed: 'typed by hand', exr: 'from the EXR metadata' };
const drvSrcText = (c) => c.src === 'report' && c.planned ? 'planned in the set report, not measured' : DRV_SRC[c.src] || 'not set';
// src vacío: a mano (lo medido sigue medido); al pasar a mano desde otra fuente, la nota lo dice
function drvRemember(src, u = drvU()) {
  const was = u.cam.src;
  u.cam.src = src || (was === 'measured' ? 'measured' : 'typed');
  if (u.cam.src === 'typed' && was !== 'typed') u.metaNote = 'Typed by hand' + (DRV_SRC[was] ? ` (it started ${drvSrcText({ ...u.cam, src: was })})` : '') + '.';
  const ks = drvKeys(u); if (ks.length === 1 && !src) Object.assign(ks[0], { tiltDeg: u.cam.tiltDeg, rollDeg: u.cam.rollDeg, yawDeg: u.cam.yawDeg, typed: true });
  drvKeep(u);
}
// lo de este archivo que vuelve al cargarlo otra vez: la cámara con su nota, el fit y el corner pin
function drvKeep(u = drvU()) { if (u.src && u.name) drvCams[u.name] = { ...u.cam, note: u.metaNote, fit: u.fit, pin: u.pin ? u.pin.map(p => p.slice()) : undefined, pinScale: u.pinScale !== 100 ? u.pinScale : undefined }; }

// Cámara de un array desde un reporte de set (js/setreport.js). o = { focal (mm), filmW (mm), yaw, tilt, roll (°),
// height (m), name, index, planned (lo planeado de un array), note (de dónde sale) }; lo que no viene queda como está.
// Yaw: 0 frente, 90 izquierda, -90 derecha.
// index elige la cámara; si no, name: la que se llama así o cuyo archivo lo contiene; si no hay ninguna, se
// agrega una (espera su archivo; Load drive plate se lo da). Devuelve su índice, -1 si no entra (ya hay DRV_MAX).
function drvSetCamera(o = {}) {
  const nm = String(o.name || '').trim(), low = nm.toLowerCase(), cur = drvU();
  let i = o.index >= 0 && o.index < drv.units.length ? o.index : low ? drv.units.findIndex(u => (u.label || '').toLowerCase() === low || drvNameIn(low, u.name || u.wantName)) : drv.sel;
  if (i < 0) { if (cur.src || cur.wantName || cur.label) { if (!drvAddCam()) return -1; } i = drv.sel; }
  drv.sel = i;
  const u = drv.units[i], c = u.cam, num = (v) => v != null && v !== '' && Number.isFinite(+v);
  if (nm) u.label = nm;
  if (num(o.focal) && +o.focal > 0) c.focal = +o.focal;
  if (num(o.filmW) && +o.filmW > 0) { c.preset = 'custom'; c.ex = null; c.sw = +o.filmW; }
  [['yaw', 'yawDeg'], ['tilt', 'tiltDeg'], ['roll', 'rollDeg'], ['height', 'heightM']].forEach(([k, ck]) => { if (num(o[k])) c[ck] = +o[k]; });
  if (c.keys && ['yaw', 'tilt', 'roll'].some(k => num(o[k]))) delete c.keys; // los keyframes medidos mandarían sobre lo nuevo
  c.planned = !!o.planned; u.metaNote = o.note || `Camera from the set report${nm ? ' (' + nm + ')' : ''}.`;
  drvRemember('report', u);
  drvUI(); render();
  return i;
}

// ---------- Tilt y roll por cuadro: headers de una carpeta de EXR (sin decodificar la imagen) ----------
const drvTcFrames = (s, rate) => String(s).split(':').map(Number).reduce((a, x, k) => k < 3 ? a * (k === 0 ? 1 : 60) + x : a * rate + x, 0);
// el header de un EXR sin leer el archivo entero; con ceros al final, un header cortado termina en vez de colgarse
async function drvHeader(f) {
  for (const n of [1 << 16, 1 << 20]) {
    const src = new Uint8Array(await f.slice(0, n).arrayBuffer()), b = new Uint8Array(src.length + 4096); b.set(src);
    try { const h = EXR.parseHeader(b.buffer); if (h.end <= src.length) return h; } catch (e) { /* más grande */ }
    if (src.length < n) break;
  }
  return null;
}
async function drvLoadSeq(list) {
  const u = drvU(); if (!u.src) return;
  const exr = [...list].map(f => ({ f, n: +((f.name.match(/(\d+)\.exr$/i) || [])[1]) })).filter(x => /\.exr$/i.test(x.f.name) && Number.isFinite(x.n)).sort((a, b) => a.n - b.n);
  if (!exr.length) { toast('No numbered EXR frames there (name.1001.exr)', true); return; }
  const first = exr[0].n, len = exr[exr.length - 1].n - first + 1;
  if (len > 200000) { toast('That EXR numbering is too sparse to read', true); return; }
  const tilt = Array(len).fill(null), roll = Array(len).fill(null);
  let md0 = null, tc0 = null, rate = 0, got = 0;
  setBusy(true, `Reading ${exr.length} EXR headers…`);
  try {
    for (let i = 0; i < exr.length; i += 16) { // de a 16: una carpeta de red tarda más en abrir que en leer
      const hs = await Promise.all(exr.slice(i, i + 16).map(x => drvHeader(x.f).catch(() => null)));
      hs.forEach((h, k) => {
        if (!h) return;
        const x = exr[i + k], md = camReadMeta(h);
        if (!md0) {
          md0 = md; const fr = h.get('framesPerSecond'), tcs = h.get('timeCode');
          rate = Math.round(Array.isArray(fr) && fr[1] ? fr[0] / fr[1] : +fr || 0);
          if (typeof tcs === 'string' && rate) tc0 = drvTcFrames(tcs, rate) - (x.n - first); // TC del primer número
        }
        if (md.orient && md.orient.tilt) { tilt[x.n - first] = +md.orient.tilt.v.toFixed(3); roll[x.n - first] = md.orient.roll ? +md.orient.roll.v.toFixed(3) : 0; got++; }
      });
      setBusy(true, `Reading EXR headers… ${Math.min(i + 16, exr.length)} of ${exr.length}`);
    }
  } catch (err) { console.warn('drive EXR folder', err); }
  setBusy(false);
  if (!got) { toast('No tilt or roll in those EXR headers', true); drvUI(); return; }
  const dir = (exr[0].f.webkitRelativePath || '').split('/').slice(-2, -1)[0] || exr[0].f.name.replace(/[._]?\d+\.exr$/i, '');
  u.track = { name: dir, n: exr.length, got, first, tilt, roll, tc0, rate, start: first, sync: 'first', on: true };
  drvTrackSync(u);
  // la cámara (cuerpo, modo, focal) del primer header, como Camera from EXR; tilt y roll quedan por cuadro
  u.keepCam = false; drvApplyMeta(u, md0, true); u.metaNote = u.metaNote.replace(/^From the file/, `From ${dir}`); if (u.cam.src === 'exr') drvRemember('exr', u);
  drvUI(); render();
}
// qué cuadro EXR va con el primer cuadro del video: por timecode si los dos lo tienen, si no el primero
function drvTrackSync(u) {
  const t = u.track; if (!t || t.sync === 'manual') return;
  if (u.tc && t.tc0 != null && t.rate && Math.abs(u.tc.rate - t.rate) < 0.5) { t.start = t.first + (u.tc.start - t.tc0); t.sync = 'tc'; }
  else { t.start = t.first; t.sync = 'first'; }
}

// ---------- Panel ----------
$('drv-body').innerHTML = $('cam-body').innerHTML; // mismo catálogo que la cámara de la toma
let drvModesFor = null;
function drvSetMode(m, ex) {
  const c = drv.cam;
  if (!m) { c.preset = 'custom'; c.ex = null; return; }
  const cl = (v, hi) => Math.max(16, Math.min(hi, Math.round(v)));
  c.preset = m.key; c.ex = ex && m.pw > 0 ? { w: cl(ex.w, m.pw), h: cl(ex.h, m.ph) } : null;
  c.sw = +camFilmBack(m, c.ex).w.toFixed(4);
}
const drvSetVal = (id, v, d) => { const el = $(id); if (document.activeElement !== el && !el.parentNode.classList.contains('scrubbing')) el.value = +(+v).toFixed(d); };
const drvTcText = (u, i) => { if (!u.tc) return ''; const p = (n) => String(n).padStart(2, '0'), f = u.tc.start + i, r = u.tc.rate, s = Math.floor(f / r); return `${p(Math.floor(s / 3600) % 24)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f % r)}`; };
function drvUI() {
  const u = drvU(), has = !!u.src, c = u.cam, rig = drv.units.length > 1, any = has || !!u.wantName || !!u.label || rig;
  $('drv-ui').hidden = !any; $('drv-hint').hidden = any; $('drv-ref').hidden = !has;
  $('drv-name').textContent = has ? `${u.name} · ${u.W} × ${u.H}` + (u.kind === 'video' ? ` · ${u.n} fr` : '') : u.wantName ? `Load ${u.wantName} to re-link` : 'none';
  $('drv-name').title = $('drv-name').textContent;
  const live = drvLive().length, want = drv.units.some(x => x.wantName && !x.src);
  $('drv-st').textContent = live ? (drv.on ? (rig ? `${live} cameras` : 'on') : 'off') : want ? 'missing' : 'none';
  $('drv').dataset.state = live && drv.on && !want ? 'ok' : want ? 'warn' : '';
  // cámaras del array
  $('drv-rig-row').hidden = !(has || rig);
  $('drv-rig').innerHTML = drv.units.map((x, i) => `<button type="button" data-drv-cam="${i}" aria-pressed="${i === drv.sel}" class="${x.src ? '' : 'drv-miss'}" title="${escAttr(x.src ? x.name : x.wantName ? 'Waiting for ' + x.wantName : 'No file yet: Load drive plate')}">${i + 1} · ${escAttr(x.label || drvLooks(x.cam.yawDeg))}</button>`).join('');
  $('drv-add').classList.toggle('disabled', drv.units.length >= DRV_MAX); $('f-drvadd').disabled = drv.units.length >= DRV_MAX;
  $('drv-label-row').hidden = !rig && !u.label;
  if (document.activeElement !== $('drv-label')) $('drv-label').value = u.label || '';
  $('drv-label').placeholder = drvLooks(c.yawDeg);
  const m = camMode(c.preset), bid = m ? m.body.id : '';
  if (bid !== drvModesFor) {
    drvModesFor = bid;
    $('drv-mode').innerHTML = m ? camModes(m.body).map(x => `<option value="${x.key}">${x.label}</option>`).join('') : '<option value="custom">Custom film back</option>';
  }
  $('drv-body').value = bid; $('drv-mode').value = m ? m.key : 'custom'; $('drv-mode').disabled = !m;
  $('drv-full').setAttribute('aria-pressed', String(!c.ex)); $('drv-crop').setAttribute('aria-pressed', String(!!c.ex));
  $('drv-full').disabled = !m; $('drv-crop').disabled = !(m && m.pw > 0);
  $('drv-ex-row').hidden = !c.ex;
  if (c.ex) { drvSetVal('drv-exw', c.ex.w, 0); drvSetVal('drv-exh', c.ex.h, 0); }
  drvSetVal('drv-sw', c.sw, 3); $('drv-sw').disabled = !!m;
  drvSetVal('drv-focal', c.focal, 2); drvSetVal('drv-yaw', c.yawDeg, 2); drvSetVal('drv-h', c.heightM, 3);
  SC_LOOKS.forEach(([n, y]) => $('drv-look-' + n.toLowerCase()).setAttribute('aria-pressed', String(Math.abs(SceneMath.angleDelta(c.yawDeg, y)) < 0.05)));
  lookDiagram($('drv-look-dia'), c.yawDeg, 'drive'); $('drv-look-note').textContent = lookNote(c.yawDeg, 'drive');
  if (document.activeElement !== $('drv-bmix')) $('drv-bmix').value = drv.mix;
  $('drv-off-row').hidden = u.kind !== 'video'; drvSetVal('drv-off', u.offset, 0);
  $('drv-tcsync').hidden = drv.units.filter(x => x.src && x.tc).length < 2;
  // por cuadro: la carpeta de EXR sólo sirve para un video (una imagen es un solo cuadro)
  $('drv-seq').hidden = u.kind !== 'video';
  const t = u.track;
  $('drv-seq-row').hidden = !t;
  if (t) {
    $('drv-seq-on').checked = !!t.on; drvSetVal('drv-seq-start', t.start, 0);
    const ts = t.tilt.filter(v => v != null), lo = Math.min(...ts), hi = Math.max(...ts);
    $('drv-seq-note').textContent = `${t.name}: ${t.got} of ${t.n} headers with tilt (${fmt(lo, 1)}° to ${fmt(hi, 1)}°). ` +
      (t.sync === 'tc' ? 'Synced by timecode.' : t.sync === 'manual' ? 'EXR frame typed.' : u.tc ? 'The timecodes do not match: the first EXR goes with the first video frame.' : 'No timecode in the video: the first EXR goes with the first video frame.');
  }
  drvKeysUI(u);
  drvPoseUI(u);
  const px = u.W > 0 ? `${fmt(u.W / c.sw, 1)} px/mm` : '';
  $('drv-src').textContent = [u.metaNote, px && `${px} on the drive plate${Math.abs(c.par - 1) > 1e-3 ? `, pixel aspect ${fmt(c.par, 2)}` : ''}.`].filter(Boolean).join(' ');
  $('drv-fit-meta').setAttribute('aria-pressed', String(u.fit !== 'pin')); $('drv-fit-pin').setAttribute('aria-pressed', String(u.fit === 'pin'));
  $('drv-pin-reset').hidden = u.fit !== 'pin';
  { const m = drvMeasured(u); $('drv-auto').disabled = !has || !m; $('drv-auto').title = m ? 'Line up the horizon and the vanishing point of the street measured in Measure drive camera with the ones of the plate, and scale it (keeping the horizon) just enough to cover the windows, or the frame without the key' : 'Measure drive camera first: set the horizon with two or more street lines';
    $('drv-pin-screen').disabled = !has; $('drv-pscale').closest('label').hidden = u.fit !== 'pin';
    if (document.activeElement !== $('drv-pscale') && !$('drv-pscale').parentNode.classList.contains('scrubbing')) $('drv-pscale').value = Math.round((u.pinScale || 100) * 10) / 10; }
  drvNavUI();
  const pm = drvPinMax(u);
  $('drv-fit-note').textContent = u.fit !== 'pin' ? 'The drive camera (from the EXR metadata, the set report or measured) places the drive plate. The format of the shot (Import) rules.'
    : pm < 0.5 ? 'Drag the four corners in the viewer (Compare and Match) to match the drive plate to the 3D Guides. Copy CornerPin takes them to Nuke.'
    : `Corner pin: up to ${fmt(pm, 0)} px off the camera fit. The 3D stays the reference: if it takes a lot, this drive plate may not fit the shot.`;
  drv.info = ''; drvAnalysisUI(); drvPinDraw();
  { const b = $('drv-vb-hz'), m = drvMeasured(u); b.disabled = !m; if (!m && drv.hz) drv.hz = false; b.setAttribute('aria-pressed', String(m && drv.hz)); }
  if (typeof dlBoxUI === 'function') dlBoxUI(); // el chip Driving de la caja
}
// tilt y roll: con la secuencia EXR prendida son los del cuadro (sólo lectura) y siguen al timeline
function drvPoseUI(u = drvU()) {
  const tr = drvTrackNow(u), p = drvPose(u), kd = drvKeyed(u), kt = kd ? ' — from the keyframes: measure this frame again or remove the keys to type it' : '';
  $('drv-tilt').disabled = !!tr || kd; $('drv-roll').disabled = !!tr || kd; $('drv-yaw').disabled = kd;
  SC_LOOKS.forEach(([n]) => { $('drv-look-' + n.toLowerCase()).disabled = kd; });
  drvSetVal('drv-tilt', p.tiltDeg, 2); drvSetVal('drv-roll', p.rollDeg, 2); if (kd) drvSetVal('drv-yaw', p.yawDeg, 2);
  $('drv-tilt').title = tr ? `Tilt of EXR frame ${tr.frame} (from its header)` : 'Tilt of the drive camera (negative looks down)' + kt;
  $('drv-yaw').title = 'Direction of the drive camera from the car axis (0 front, 90 left, 180 rear)' + kt;
}
// keyframes de la cámara medida (sólo un video): en qué cuadros se midió y qué hay entre ellos
function drvKeysUI(u = drvU()) {
  const ks = drvKeys(u).slice().sort((a, b) => a.frame - b.frame), show = u.kind === 'video' && ks.length > 0;
  $('drv-keys-row').hidden = !show; if (!show) return;
  const i = drvFrameIndex(u), at = ks.find(k => k.frame === i), fr = ks.map(k => k.frame + 1).join(', ');
  $('drv-keys-note').textContent = ks.length === 1 ? `Measured on frame ${fr} only: the same camera for the whole clip.`
    : `Measured on frames ${fr}: tilt, roll and yaw are interpolated between them${at ? ` (this is frame ${i + 1})` : ''}.`;
  $('drv-key-del').disabled = !at; $('drv-key-prev').disabled = !ks.some(k => k.frame < i); $('drv-key-next').disabled = !ks.some(k => k.frame > i);
}
function drvCamChanged() { drvRemember(); drvUI(); render(); }
$('drv-body').onchange = () => {
  const b = camBody($('drv-body').value);
  drvSetMode(b ? camClosestMode(b, drv.W || 1920, drv.H || 1080) : null, null); drvCamChanged();
};
$('drv-mode').onchange = () => { drvSetMode(camMode($('drv-mode').value), null); drvCamChanged(); };
$('drv-full').onclick = () => { drvSetMode(camMode(drv.cam.preset), null); drvCamChanged(); };
$('drv-crop').onclick = () => { const m = camMode(drv.cam.preset); if (m) { drvSetMode(m, camGuessExtract(m, drv.W, drv.H) || { w: m.pw, h: m.ph }); drvCamChanged(); } };
['drv-exw', 'drv-exh'].forEach(id => $(id).addEventListener('change', () => { const w = +$('drv-exw').value, h = +$('drv-exh').value; if (w > 0 && h > 0) { drvSetMode(camMode(drv.cam.preset), { w, h }); drvCamChanged(); } }));
[['drv-sw', 'sw', 1], ['drv-focal', 'focal', 1], ['drv-yaw', 'yawDeg'], ['drv-tilt', 'tiltDeg'], ['drv-roll', 'rollDeg'], ['drv-h', 'heightM', 0]].forEach(([id, k, min]) =>
  $(id).addEventListener('input', () => { const v = parseFloat($(id).value); if (Number.isFinite(v) && !(min !== undefined && v < min)) { drv.cam[k] = v; drv.info = ''; render(); } }));
['drv-sw', 'drv-focal', 'drv-yaw', 'drv-tilt', 'drv-roll', 'drv-h'].forEach(id => $(id).addEventListener('change', () => { drvRemember(); drvUI(); }));
SC_LOOKS.forEach(([n, y]) => $('drv-look-' + n.toLowerCase()).onclick = () => { drv.cam.yawDeg = y; drvCamChanged(); });
$('drv-vb-on').onclick = () => drvShow();
$('drv-vb-wipe').onclick = () => drvWipe();
['pointerdown', 'wheel', 'dblclick'].forEach(t => $('drv-vbox').addEventListener(t, e => e.stopPropagation()));

// ---------- Calle 3D / fondo filmado (paso 4: juzgar el fondo contra el 3D, D-06) ----------
// X: el driving detrás del plate o la calle 3D (lo mismo que Behind the plate). Shift+X: la cortina, una línea que se
// arrastra por las ventanillas: el driving a la izquierda y la calle 3D a la derecha. Es sólo de la vista: no se guarda
// en el proyecto ni cambia el playblast.
function drvShow(on) {
  if (!drvLive().length) { toast('Load a driving plate first (4 Judge background › Driving plate)', true); return; }
  drv.on = on === undefined ? !drv.on : !!on;
  if (!drv.on) drv.wipe = null;
  drvUI(); render();
  toast(drv.on ? 'Filmed background behind the plate' : '3D street behind the plate');
}
function drvWipe(on) {
  if (!drvLive().length) { toast('Load a driving plate first (4 Judge background › Driving plate)', true); return; }
  on = on === undefined ? drv.wipe == null : !!on;
  drv.wipe = on ? 0.5 : null;
  if (on) drv.on = true;
  drvUI(); render();
}
// la línea y sus rótulos van en el visor (fuera del stage, para no escalarse con el zoom); el recorte, en el canvas
function drvWipeUI(show) {
  const el = $('drv-wipe'), on = show && drv.wipe != null;
  // la barra de abajo del visor: Behind the plate y Wiper (con un driving cargado)
  { const live = drvLive().length > 0, vb = $('drv-vbox'); if (vb.hidden === live) vb.hidden = !live;
    const p = (id, v) => { const b = $(id); if (b.getAttribute('aria-pressed') !== String(v)) b.setAttribute('aria-pressed', String(v)); };
    p('drv-vb-on', live && drv.on); p('drv-vb-wipe', live && drv.wipe != null); }
  drvCv.style.clipPath = on ? `inset(0 ${((1 - drv.wipe) * 100).toFixed(3)}% 0 0)` : '';
  if (el.hidden === on) el.hidden = !on;
  if (!on) return;
  const [x, y0] = uvToVp(drv.wipe * st.plate.W, 0), y1 = uvToVp(0, st.plate.H)[1];
  el.style.left = x + 'px'; el.style.top = y0 + 'px'; el.style.height = (y1 - y0) + 'px';
}
{
  const el = $('drv-wipe');
  el.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
    const move = ev => { drv.wipe = Math.min(1, Math.max(0, vpToUv(...evVp(ev))[0] / st.plate.W)); render(); };
    const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  window.addEventListener('keydown', e => {
    if ((e.key || '').toLowerCase() !== 'x' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target.matches('textarea, select, input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=file])')) return;
    if (typeof drag !== 'undefined' && drag && drag.action === 'look') return; // WASD de la navegación tipo juego
    e.preventDefault();
    if (e.shiftKey) drvWipe(); else drvShow();
  });
}
// Mix del driving: en la caja de la derecha del visor (Compare and Match y DepthLab)
const drvMix = (v) => { if (Number.isFinite(v)) { drv.mix = Math.min(1, Math.max(0, v)); if (document.activeElement !== $('drv-bmix')) $('drv-bmix').value = drv.mix; render(); } };
$('drv-bmix').oninput = () => drvMix(+$('drv-bmix').value);
$('drv-bmix').addEventListener('dblclick', () => drvMix(1));
$('drv-off').addEventListener('input', () => { const v = parseInt($('drv-off').value, 10); if (Number.isFinite(v)) { drvU().offset = v; render(); } });
// sincro por timecode: cada cámara muestra el mismo TC que la elegida
$('drv-tcsync').onclick = () => {
  const r = drvU(); if (!r.tc) { toast('This camera has no timecode', true); return; }
  const at = r.tc.start + r.offset, out = [];
  drv.units.forEach((u, i) => { if (u === r || !u.src || !u.tc) return; u.offset = at - u.tc.start; out.push(`${i + 1}: ${u.offset >= 0 ? '+' : ''}${u.offset} fr`); });
  drvUI(); render(); toast('Synced by timecode — offsets ' + out.join(', '));
};
$('f-drv').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) drvLoadFile(f); };
$('f-drvadd').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) { const u = drvAddCam(); if (u) drvLoadFile(f, u); } };
$('f-drvref').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) drvLoadRef(f); };
$('f-drvseq').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) drvLoadSeq(f); };
$('drv-seq-on').onchange = () => { const t = drv.track; if (t) { t.on = $('drv-seq-on').checked; drvUI(); render(); } };
$('drv-seq-start').addEventListener('change', () => { const t = drv.track, v = parseInt($('drv-seq-start').value, 10); if (t && Number.isFinite(v)) { t.start = v; t.sync = 'manual'; drvUI(); render(); } });
$('drv-rig').addEventListener('click', (e) => { const b = e.target.closest('[data-drv-cam]'); if (!b) return; drv.sel = +b.dataset.drvCam; drvModesFor = null; drvUI(); render(); });
$('drv-label').addEventListener('change', () => { drvU().label = $('drv-label').value.trim(); drvUI(); });
$('drv-clear').onclick = drvRemoveCam;
function drvSetFit(fit) { const u = drvU(); u.fit = fit; if (fit === 'pin') { if (!u.pin) { u.pin = [[0, 0], [0, 0], [0, 0], [0, 0]]; u.pinScale = 100; } drv.pinEdit = true; } drvKeep(u); drvUI(); render(); }
$('drv-fit-meta').onclick = () => drvSetFit('meta');
$('drv-fit-pin').onclick = () => drvSetFit('pin');
$('drv-pin-reset').onclick = () => { const u = drvU(); u.pin = [[0, 0], [0, 0], [0, 0], [0, 0]]; u.pinScale = 100; drvKeep(u); drvUI(); render(); };
$('drv-pin-screen').onclick = () => drvFitScreen();
$('drv-auto').onclick = () => drvAutoMatch();
$('drv-pscale').addEventListener('input', () => { const v = parseFloat($('drv-pscale').value); if (Number.isFinite(v) && v >= 10 && v <= 1000) drvScalePin(v); });
$('drv-pscale').addEventListener('change', () => drvUI());
$('drv-prev').onclick = () => drvStep(-1);
$('drv-next').onclick = () => drvStep(1);
$('drv-vb-hz').onclick = () => { drv.hz = !drv.hz; lsSet('drv.hz', drv.hz); drvUI(); };
$('m-cpin').onclick = () => {
  const u = drvU(); if (!u.src) { toast('Load a driving plate first (Compare and Match › Driving plate)', true); return; }
  if (u.fit !== 'pin') { drvSetFit('pin'); return; }
  drv.pinEdit = !drv.pinEdit; drvUI();
};
// las cuatro manijas del corner pin en el visor (sólo en Compare and Match)
const drvPinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
drvPinSvg.id = 'drv-pin'; drvPinSvg.setAttribute('class', 'ov drv-pin'); drvPinSvg.setAttribute('aria-hidden', 'true');
$('gh-ov').after(drvPinSvg);
// las esquinas del corner pin en px del plate (donde las pone la cámara más lo corrido), o null
function drvPinNow(u = drvU()) {
  const h = u.src && DriveMath.homography(sceneIntr(), scenePose(), drvIntr(u), drvPose(u)), C = h && drvPinCorners(u, h);
  const d = (i) => (u.pin && u.pin[i]) || [0, 0];
  return C && !C.some(c => !c) ? { C, P: C.map((c, i) => [c[0] + d(i)[0], c[1] + d(i)[1]]) } : null;
}
// manijas: las cuatro esquinas, el medio de cada lado (lo corre con perspectiva: DriveMath.edgeMove) y el interior
// (arrastrar adentro mueve el driving entero)
function drvPinDraw() {
  const u = drvU(), cmp = typeof mtabCur !== 'undefined' && mtabCur === 'compare', on = cmp && u.src && drv.on && u.fit === 'pin' && drv.pinEdit && !st.plate.empty;
  { const b = $('m-cpin'), p = String(!!on); if (b.getAttribute('aria-pressed') !== p) b.setAttribute('aria-pressed', p); }
  drvHzDraw();
  const k = on && drvPinNow(u);
  if (!k) { if (drvPinSvg.innerHTML) drvPinSvg.innerHTML = ''; return; }
  const P = k.P.map(p => uvToVp(p[0], p[1])), f = (p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
  const N = ['top left', 'top right', 'bottom right', 'bottom left'], E = ['top', 'right', 'bottom', 'left'];
  drvPinSvg.innerHTML = `<path data-move="1" d="M${P.map(f).join('L')}Z"><title>Drag inside to move the whole drive plate</title></path>` +
    P.map((p, i) => { const q = P[(i + 1) % 4], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      return `<rect data-edge="${i}" x="${(m[0] - 6).toFixed(1)}" y="${(m[1] - 6).toFixed(1)}" width="12" height="12" rx="2"><title>Corner pin, ${E[i]} side: drag it, the perspective stays</title></rect>`; }).join('') +
    P.map((p, i) => `<circle data-pin="${i}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="9"><title>Corner pin, ${N[i]}: drag it</title></circle>`).join('');
}
{
  let d = null;
  const at = (e) => { const r = drvPinSvg.getBoundingClientRect(); return vpToUv(e.clientX - r.left, e.clientY - r.top); };
  drvPinSvg.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('[data-pin], [data-edge], [data-move]'); if (!c) return;
    // el paneo del visor (Alt, Espacio, botón del medio) sigue pasando por adentro del driving
    if (c.dataset.move && (e.button !== 0 || e.altKey || e.metaKey || e.ctrlKey || (typeof spaceDown !== 'undefined' && spaceDown))) return;
    const u = drvU(), k = drvPinNow(u); if (!k) return;
    e.preventDefault(); e.stopPropagation(); drvPinSvg.setPointerCapture(e.pointerId);
    d = { u, k, at: at(e), pin0: u.pin.map(p => p.slice()), kind: c.dataset.pin ? 'pin' : c.dataset.edge ? 'edge' : 'move', i: +(c.dataset.pin || c.dataset.edge || 0) };
    $('m-cpin').classList.add('drag');
  });
  drvPinSvg.addEventListener('pointermove', (e) => {
    if (!d) return;
    const q = at(e), dx = q[0] - d.at[0], dy = q[1] - d.at[1], { u, k, pin0, i } = d;
    if (d.kind === 'pin') u.pin[i] = [pin0[i][0] + dx, pin0[i][1] + dy];
    else if (d.kind === 'move') u.pin = pin0.map(p => [p[0] + dx, p[1] + dy]);
    else {
      // el lado pasa por donde se lo tomó, corrido lo que se movió el mouse
      const m = [(k.P[i][0] + k.P[(i + 1) % 4][0]) / 2 + dx, (k.P[i][1] + k.P[(i + 1) % 4][1]) / 2 + dy];
      const r = DriveMath.edgeMove(k.P, i, m); if (!r) return;
      const j = (i + 1) % 4;
      u.pin[i] = [r[0][0] - k.C[i][0], r[0][1] - k.C[i][1]]; u.pin[j] = [r[1][0] - k.C[j][0], r[1][1] - k.C[j][1]];
    }
    render(); drvUI();
  });
  const end = () => { if (d) drvKeep(d.u); d = null; $('m-cpin').classList.remove('drag'); };
  drvPinSvg.addEventListener('pointerup', end); drvPinSvg.addEventListener('pointercancel', end);
  const f = drawOverlay; drawOverlay = function (...a) { const r = f(...a); drvPinDraw(); return r; };
}
// ---------- Horizonte, Fit to screen, Auto match plate y Scale ----------
// medido: Measure drive camera dejó el horizonte con dos o más líneas de la calle (en la cámara o en un keyframe)
const drvMeasured = (u = drvU()) => !!u.src && ((u.cam.lines && u.cam.lines.length >= 2) || drvKeys(u).some(k => k.lines && k.lines.length >= 2));
// el horizonte del driving en px de la toma, como lo pone su cámara más el corner pin
function drvHzShot(u = drvU()) {
  const h = u.src && drvPinned(u, DriveMath.homography(sceneIntr(), scenePose(), drvIntr(u), drvPose(u)));
  return h ? DriveMath.mapLine(h.ds, DriveMath.horizonLine(drvIntr(u), drvPose(u))) : null;
}
// el punto de una recta más cercano al centro de la toma (la escala alrededor de él no mueve la recta)
function drvHzAnchor(l) {
  const x0 = st.plate.W / 2, y0 = st.plate.H / 2;
  if (!l || Math.hypot(l[0], l[1]) < 1e-12) return [x0, y0];
  const k = (l[0] * x0 + l[1] * y0 + l[2]) / (l[0] * l[0] + l[1] * l[1]);
  return [x0 - k * l[0], y0 - k * l[1]];
}
// la línea magenta del horizonte del driving, de lado a lado de la toma (Compare and Match y DepthLab)
const drvHzSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
drvHzSvg.id = 'drv-hz'; drvHzSvg.setAttribute('class', 'ov drv-hzov'); drvHzSvg.setAttribute('aria-hidden', 'true');
$('gh-ov').after(drvHzSvg);
function drvHzDraw() {
  const u = drvU(), on = drv.hz && drv.on && drvMeasured(u) && typeof mtabCur !== 'undefined' && (mtabCur === 'compare' || mtabCur === 'depthlab') && !st.plate.empty;
  const l = on && drvHzShot(u);
  if (!l || Math.abs(l[1]) < 1e-9) { if (drvHzSvg.innerHTML) drvHzSvg.innerHTML = ''; return; }
  const W = st.plate.W, y = (x) => -(l[0] * x + l[2]) / l[1], a = uvToVp(0, y(0)), b = uvToVp(W, y(W)), f = (p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
  drvHzSvg.innerHTML = `<path d="M${f(a)}L${f(b)}"/><text x="${(b[0] - 8).toFixed(1)}" y="${(b[1] - 6).toFixed(1)}" text-anchor="end">DRIVE HORIZON</text>`;
}
// Fit to screen: las cuatro esquinas del driving en las cuatro esquinas del cuadro (un punto de partida)
function drvFitScreen() {
  const u = drvU(), h = u.src && DriveMath.homography(sceneIntr(), scenePose(), drvIntr(u), drvPose(u)), C = h && drvPinCorners(u, h);
  if (!C || C.some(c => !c)) { toast('Load a driving plate whose camera sees the shot first', true); return; }
  const W = st.plate.W, H = st.plate.H;
  u.fit = 'pin'; u.pin = [[0, 0], [W, 0], [W, H], [0, H]].map((p, i) => [p[0] - C[i][0], p[1] - C[i][1]]); u.pinScale = 100; drv.pinEdit = true;
  drvKeep(u); drvUI(); render();
  toast('Corner pin: the driving plate fills the frame');
}
// Auto match plate: con la cámara medida en Measure drive camera, el horizonte y el punto de fuga de la calle caen sobre
// los de la toma (la reproyección por la cámara ya los alinea); después se escala alrededor del horizonte lo justo para
// cubrir las ventanillas (con el key) o el cuadro, y queda como corner pin para retocar. El panel dice cuánto se escaló.
function drvAutoMatch() {
  const u = drvU(); if (!u.src) return;
  if (!drvMeasured(u)) { toast('Auto match plate needs Measure drive camera: the horizon with two or more street lines', true); return; }
  const h = DriveMath.homography(sceneIntr(), scenePose(), drvIntr(u), drvPose(u)), C = h && drvPinCorners(u, h);
  if (!C || C.some(c => !c)) { toast('A corner of the driving plate falls behind the shot camera: check Camera looks and the angles', true); return; }
  const A = drvHzAnchor(DriveMath.mapLine(h.ds, DriveMath.horizonLine(drvIntr(u), drvPose(u))));
  const win = drvWindows(), pts = win.regs.flatMap(r => r.pts);
  const cov = (s) => { let n = 0; for (const p of pts) { const q = DriveMath.apply(h.sd, [A[0] + (p[0] - A[0]) / s, A[1] + (p[1] - A[1]) / s]); if (q && q[0] >= 0 && q[1] >= 0 && q[0] <= u.W && q[1] <= u.H) n++; } return n / Math.max(1, pts.length); };
  let s = 1, best = [cov(1), 1];
  if (best[0] < 0.995) for (let t = 1.01; t <= 3.0001; t += 0.01) { const c = cov(t); if (c > best[0] + 1e-9) best = [c, t]; if (c >= 0.995) { best = [c, t]; break; } }
  s = best[1];
  u.fit = 'pin'; u.pin = C.map(c => [A[0] + s * (c[0] - A[0]) - c[0], A[1] + s * (c[1] - A[1]) - c[1]]); u.pinScale = +(s * 100).toFixed(1); drv.pinEdit = true;
  drvKeep(u); drvUI(); render();
  const what = win.regs[0] && win.regs[0].frame ? 'the frame' : 'the windows';
  toast(`Auto match: horizon and vanishing point from Measure drive camera${s > 1.0001 ? `, scaled ${Math.round(s * 100)}% to cover ${what}` : ''}${best[0] < 0.995 ? ` (it covers ${Math.round(best[0] * 100)}% of ${what})` : ''}`);
}
// Scale: el corner pin entero alrededor del punto de su horizonte más cercano al centro; el horizonte no se mueve
function drvScalePin(pct) {
  const u = drvU(); if (!u.src) return;
  if (u.fit !== 'pin') { u.fit = 'pin'; if (!u.pin) u.pin = [[0, 0], [0, 0], [0, 0], [0, 0]]; u.pinScale = 100; }
  const k = drvPinNow(u), r = pct / (u.pinScale || 100); if (!k || !(r > 0) || Math.abs(r - 1) < 1e-9) return;
  const A = drvHzAnchor(drvHzShot(u));
  u.pin = k.P.map((p, i) => [A[0] + r * (p[0] - A[0]) - k.C[i][0], A[1] + r * (p[1] - A[1]) - k.C[i][1]]); u.pinScale = pct; drv.pinEdit = true;
  drvKeep(u); render(); drvUI();
}
// las flechas de la caja: los driving plates de la sesión (los cargados y los de Compare drive plates), en la cámara
// elegida; cada uno vuelve con su cámara y su corner pin (drvKeep)
function drvLib() {
  const out = [], seen = new Set(), add = (f) => { if (f && f.name && !seen.has(f.name)) { seen.add(f.name); out.push(f); } };
  drv.libFiles.forEach(add); if (typeof dc !== 'undefined') dc.cands.forEach(c => add(c.file));
  return out;
}
async function drvStep(dir) {
  const L = drvLib(); if (L.length < 2) { toast(L.length ? 'Only one driving plate in this session: load another one (or add candidates in Compare drive plates)' : 'Load a driving plate first', true); return; }
  const i = L.findIndex(f => f.name === drvU().name), f = L[((i < 0 ? 0 : i + dir) % L.length + L.length) % L.length];
  drvKeep(drvU());
  await drvLoadFile(f, drvU());
  toast(`Driving plate ${L.indexOf(f) + 1} of ${L.length}: ${f.name}`);
}
function drvNavUI() {
  const L = drvLib(), i = L.findIndex(f => f.name === drvU().name), t = L.length ? `${i + 1 || '–'}/${L.length}` : '–';
  if ($('drv-nav-n').textContent !== t) $('drv-nav-n').textContent = t;
  $('drv-nav-n').title = L.map((f, k) => `${k + 1}. ${f.name}`).join('\n');
  $('drv-prev').disabled = $('drv-next').disabled = L.length < 2;
}
$('drv-copy').onclick = () => {
  const comp = typeof dlComp === 'function' && dlComp(), anim = drvAnimated();
  drvCopy(drvCornerPinText(), `CornerPin copied${drv.units.length > 1 ? ' for ' + drvCamName(drvU()) : ''}${anim ? ', animated over the timeline' : ''}, in ${comp ? 'comp px: paste it under the drive plate Read and merge it under the reformatted plate' : 'plate px: paste it under the drive plate Read; the delivery reformat (if any) goes after the Merge'}.`);
};
$('drv-defocus').onclick = () => {
  const d = drvDefChoices().find(x => x.key === drv.defAt) || drvDefChoices().find(x => x.key === 'inf');
  if (!d || !Number.isFinite(d.coc)) { toast('Nothing to copy: the focus is closer than the focal length', true); return; }
  const r = bokehDefocusText(d.coc, 'Drive_' + d.name, `Drive plate at ${d.long}`, 0);
  drvCopy(r.text, r.msg.replace('Paste it in Nuke.', 'Put it after the CornerPin.'));
};
$('drv-def-at').onchange = () => { drv.defAt = $('drv-def-at').value; drv.info = ''; drvAnalysisUI(); render(); };
// keyframes: ir al cuadro medido anterior / siguiente y sacar el de este cuadro
const drvGoKey = (dir) => {
  const u = drvU(), i = drvFrameIndex(u), ks = drvKeys(u).map(k => k.frame).sort((a, b) => a - b);
  const k = dir < 0 ? ks.filter(x => x < i).pop() : ks.find(x => x > i);
  if (k !== undefined) tlSet(k - u.offset + tl.start);
};
$('drv-key-prev').onclick = () => drvGoKey(-1);
$('drv-key-next').onclick = () => drvGoKey(1);
$('drv-key-del').onclick = () => {
  const u = drvU(), i = drvFrameIndex(u), ks = drvKeys(u);
  if (!ks.some(k => k.frame === i)) return;
  u.cam.keys = ks.filter(k => k.frame !== i);
  // con una sola que queda, ésa es la cámara
  if (u.cam.keys.length === 1) Object.assign(u.cam, { tiltDeg: u.cam.keys[0].tiltDeg, rollDeg: u.cam.keys[0].rollDeg, yawDeg: u.cam.keys[0].yawDeg });
  drvRemember('measured', u); drvUI(); render();
};
document.addEventListener('lens-changed', () => drvDefSelect());
document.addEventListener('lens-changed', () => { drv.info = ''; drvAnalysisUI(); });

// ---------- Análisis ----------
// ventanillas: zonas conexas del área keyeada (o del alpha) en una grilla de la toma; sin key, el cuadro entero
function drvWindows() {
  const sig = [st.plate.name, st.plate.W, st.plate.H, key.on, typeof exrState !== 'undefined' && exrState ? exrState.name : ''].join('|');
  if (drv.win && drv.win.sig === sig) return drv.win;
  const W = st.plate.W, H = st.plate.H, nx = 96, ny = Math.max(2, Math.round(nx * H / W)), at = (i, j) => [(i + 0.5) * W / nx, (j + 0.5) * H / ny];
  let s = null; try { s = key.on && typeof sceneHoleSampler === 'function' ? sceneHoleSampler() : null; } catch (e) { s = null; }
  const hole = new Uint8Array(nx * ny); let nh = 0;
  if (s) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const p = at(i, j); if (s.isHole(p[0], p[1])) { hole[j * nx + i] = 1; nh++; } }
  let regs = [];
  if (nh >= 8) {
    const lab = new Int32Array(nx * ny).fill(-1);
    for (let k0 = 0; k0 < nx * ny; k0++) {
      if (!hole[k0] || lab[k0] >= 0) continue;
      const pts = [], stack = [k0]; lab[k0] = regs.length;
      while (stack.length) {
        const k = stack.pop(), i = k % nx, j = (k - i) / nx; pts.push(at(i, j));
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj, kk = b * nx + a; if (a >= 0 && b >= 0 && a < nx && b < ny && hole[kk] && lab[kk] < 0) { lab[kk] = regs.length; stack.push(kk); } }
      }
      regs.push({ pts });
    }
    regs = regs.filter(r => r.pts.length >= Math.max(4, nh * 0.02)); // restos sueltos del key no son ventanillas
    regs.forEach(r => { r.cx = r.pts.reduce((a, p) => a + p[0], 0) / r.pts.length; r.share = r.pts.length / (nx * ny); });
    regs.sort((a, b) => a.cx - b.cx);
    const side = (x) => x < W / 3 ? 'left' : x > 2 * W / 3 ? 'right' : 'middle', count = {};
    regs.forEach(r => { r.side = side(r.cx); count[r.side] = (count[r.side] || 0) + 1; });
    const seen = {}; regs.forEach(r => { seen[r.side] = (seen[r.side] || 0) + 1; r.name = `${r.side[0].toUpperCase() + r.side.slice(1)} window` + (count[r.side] > 1 ? ` ${seen[r.side]}` : ''); });
  }
  if (!regs.length) { const pts = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push(at(i, j)); regs = [{ pts, name: 'Frame', share: 1, frame: true }]; }
  return drv.win = { sig, regs };
}
function drvAnalysisUI() {
  const u = drvU();
  if (!u.src) {
    if (drv.info !== 'none') { drv.info = 'none'; $('drv-kv').innerHTML = ''; $('drv-warn').innerHTML = ''; $('drv-keymsg').hidden = true; $('drv-rig-kv').innerHTML = ''; drv.an = null; }
    return;
  }
  const iS = sceneIntr(), pS = scenePose(), live = drvLive(), defs = drvDefChoices(), K = typeof dlK === 'function' ? dlK() : 1;
  const sig = JSON.stringify([iS, pS, live.map(x => [drvIntr(x), drvPose(x), x.kind === 'video' ? drvFrameIndex(x) : 0, drvKeys(x).length]), drv.sel, defs.map(d => [d.key, d.short, d.coc]), drv.defAt, drv.on, key.on, st.plate.empty,
    typeof dl !== 'undefined' ? [dl.on, dl.units, dl.scale, dl.rotDeg, dl.tx, dl.ty, dl.outW, dl.outH] : 0, typeof bokehState !== 'undefined' ? bokehState.setups[0].tSrc : '']);
  if (sig === drv.info) return;
  drv.info = sig;
  if (drvTrackNow(u) || drvKeyed(u)) drvPoseUI(u);
  if (u.kind === 'video' && drvKeys(u).length) drvKeysUI(u);
  const a = drv.an = DriveMath.analyze(iS, pS, drvIntr(), drvPose());
  $('drv-keymsg').hidden = !(drv.on && !key.on && !st.plate.empty);
  if (u.kind === 'video') { const i = drvFrameIndex(u), tc = drvTcText(u, i), tr = drvTrackNow(u); $('drv-frame').textContent = `frame ${i + 1} of ${u.n} now` + (tc ? ` · ${tc}` : '') + (tr ? ` · EXR ${tr.frame}` : ''); }
  drvRigUI(iS, pS, live);
  if (!a) { $('drv-kv').innerHTML = ''; $('drv-warn').innerHTML = '<p class="msg bad">Camera data is missing (focal or film width).</p>'; return; }
  const pD = drvPose();
  const pct = (y, H) => y == null ? '–' : y < 0 ? 'above the frame' : y > H ? 'below the frame' : `${fmt(y / H * 100, 0)}% down`;
  const sgn = (v, d) => { const r = +(+v).toFixed(d) || 0; return (r >= 0 ? '+' : '') + fmt(r, d); };
  // con el reencuadre de entrega en px del comp (js/delivery.js): escala, upscale, cobertura y horizonte del comp
  const comp = typeof dlComp === 'function' && dlComp(), ut = comp ? 'comp' : 'shot';
  const cov = comp ? drvCompCoverage(a) : a.coverage, hc = comp ? dlHorizon(sceneCam().horizon()) : null;
  const rows = [
    // con el centro fuera del driving (otro tilt, tele) la escala se mide en lo que sí cubre
    ['Scale', a.centerIn ? `${fmt(a.scale / K, 2)} drive px per ${ut} px` : a.worstUpscale > 0 ? `${fmt(1 / (a.worstUpscale * K), 2)} drive px per ${ut} px at the edge` : '–'],
    ['Coverage', `${fmt(cov * 100, cov > 0.995 || cov < 0.005 ? 0 : 1)}% of the ${comp ? 'comp' : 'shot'}` + (drv.rigCov !== undefined ? ` (all cameras ${fmt(drv.rigCov * 100, drv.rigCov > 0.995 ? 0 : 1)}%)` : '')],
    ['Horizon', `${comp ? 'comp' : 'shot'} ${comp ? (hc ? pct(hc.ys[1], hc.H) : '–') : pct(a.horizonShot, st.plate.H)} · drive ${pct(a.horizonDrive, u.H)}`],
    ['Angle change', `tilt ${sgn(pS.tiltDeg - pD.tiltDeg, 1)}° · roll ${sgn(pS.rollDeg - pD.rollDeg, 1)}° · yaw ${sgn(SceneMath.angleDelta(pS.yawDeg, pD.yawDeg), 1)}°`],
    ['Height', `shot ${fmt(pS.heightM, 2)} m · drive ${fmt(pD.heightM, 2)} m`],
  ];
  // desenfoque con la lente de la toma a varias distancias (la BG del lente y fijas), en la unidad elegida
  const dRow = defs.filter(d => !/^p/.test(d.key) && Number.isFinite(d.coc)).sort((x, y) => x.m - y.m).map(d => `${d.short}: ${Math.round(d.coc * K)}`);
  if (dRow.length) rows.push(['Defocus', dRow.join(' · ') + ` ${comp ? 'comp' : 'plate'} px`]);
  $('drv-kv').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const w = [], who = drv.units.length > 1 ? drvCamName(u) + ': ' : '';
  if (a.coverage < 0.005) w.push(['bad', `${who}the drive plate does not cover the shot: check Looks to and the angles.`.replace(/^./, s => s.toUpperCase())]);
  else {
    const up = (a.centerIn ? a.upscale : a.worstUpscale) * K, upW = a.worstUpscale * K, inC = comp ? ' in the comp' : '';
    if (up > 1.05) w.push(['', `Upscale ${fmt(up, 2)}×${inC} — the drive plate is softer than the shot.` + (upW > up * 1.05 ? ` Up to ${fmt(upW, 2)}× towards the edges.` : '')]);
    else if (Number.isFinite(up)) w.push(['ok', `Enough resolution: the drive plate is scaled ${fmt(up, 2)}×${inC}.`]);
    if (cov < 0.995 && !(drv.rigCov > 0.995)) w.push(['', `The ${comp ? 'comp' : 'shot'} sees past the drive plate${drv.rigCov !== undefined ? 's' : ''}: ${fmt((1 - (drv.rigCov ?? cov)) * 100, 1)}% of the frame is empty (hatched).`]);
  }
  if (Math.abs(a.dh) >= 0.05) {
    const p10 = DriveMath.parallaxPx(a.fpxShot, a.dh, 10) * K, p100 = DriveMath.parallaxPx(a.fpxShot, a.dh, 100) * K;
    w.push(['', `Camera ${fmt(Math.abs(a.dh), 2)} m ${a.dh < 0 ? 'lower' : 'higher'} than the drive plate: near objects will not line up (about ${Math.round(p10)} ${comp ? 'comp ' : ''}px off at 10 m, ${Math.round(p100)} px at 100 m).`]);
  }
  // una sola medición en un clip largo: un driving estabilizado (o con la cámara que se mueve) cambia por cuadro
  const ks = drvKeys(u);
  if (u.kind === 'video' && u.cam.src === 'measured' && ks.length <= 1 && u.n >= DRV_LONG && !(u.track && u.track.on))
    w.push(['', `The drive camera was measured on one frame of a ${u.n}-frame clip. A stabilized render or a camera that moves changes along the clip: measure it again on other frames (Measure drive camera) and the camera is interpolated between them.`]);
  const dc = defs.find(d => d.key === drv.defAt) || defs.find(d => d.key === 'inf');
  if (dc && Number.isFinite(dc.coc) && dc.coc * K >= 1) {
    const shaky = typeof lensTStopShaky === 'function' && lensTStopShaky();
    w.push([shaky ? '' : 'ok', `Defocus the drive plate ~${Math.round(dc.coc * K)} ${comp ? 'comp' : 'plate'} px (radius ${fmt(dc.coc * K / 2, 1)}) at ${dc.long}, with the shot lens ${drvLensTag()}.`]);
  }
  drvDefSelect(defs);
  $('drv-warn').innerHTML = w.map(([c, t]) => `<p class="msg${c ? ' ' + c : ''}">${t}</p>`).join('');
}
// desenfoque del driving (lente de la toma, Setup A): la distancia BG del lente, las sondas con distancia y fijas.
// coc: diámetro en px del plate. El driving se supone nítido (filmado con mucha profundidad de campo).
const DRV_DEF_FIXED = [5, 10, 20, Infinity], DRV_LONG = 48; // LONG: un clip de más cuadros que esto es «largo»
function drvDefChoices() {
  if (typeof lensCocShotPx !== 'function') return [];
  const m = (v) => bkFmt(v, Number.isInteger(v) || v >= 10 ? 0 : 1), out = [];
  out.push({ key: 'bg', m: lensState.bgM, short: `BG ${m(lensState.bgM)}`, long: `the Background distance ${m(lensState.bgM)}`, name: 'BG' });
  bokehState.probes.forEach(p => { const d = bkProbeDist(p); if (d !== null && Number.isFinite(d)) out.push({ key: 'p' + p.id, m: d, short: `${p.name} ${m(d)}`, long: `${p.name} (${m(d)})`, name: p.name }); });
  DRV_DEF_FIXED.forEach(d => out.push(Number.isFinite(d) ? { key: 'm' + d, m: d, short: m(d), long: m(d), name: `${d}m` } : { key: 'inf', m: Infinity, short: '∞', long: 'infinity', name: 'Infinity' }));
  out.forEach(d => { d.coc = lensCocShotPx(d.m); });
  return out;
}
const drvLensTag = () => typeof lensTStopTag === 'function' ? `${fmt(bkLens(0).focalMm, 1)} mm ${lensTStopTag(0)}, focus ${bkFmt(lensState.focusM)}` : '';
function drvDefSelect(defs = drvDefChoices()) {
  const sel = $('drv-def-at'), K = typeof dlK === 'function' ? dlK() : 1;
  if (!defs.some(d => d.key === drv.defAt)) drv.defAt = 'inf';
  const html = defs.map(d => `<option value="${d.key}">${esc(d.short)}${Number.isFinite(d.coc) ? ` · ${Math.round(d.coc * K)} px` : ''}</option>`).join('');
  if (sel._html !== html) { sel.innerHTML = html; sel._html = html; }
  sel.value = drv.defAt;
}
// qué parte del comp cubre el driving: la grilla del comp llevada al plate (fuera del plate no cuenta)
function drvCompCoverage(a) {
  const o = DeliveryMath.fmtOf(dl, st.plate.W, st.plate.H), n = 48, m = Math.max(2, Math.round(n * o.H / o.W)), pts = [];
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) pts.push(DeliveryMath.toPlate(dl, st.plate.W, st.plate.H, [(i + 0.5) * o.W / n, (j + 0.5) * o.H / m]));
  return DriveMath.windowStats(a.sd, pts, drvIntr()).coverage;
}
// array: qué cámara cubre cada ventanilla (la que manda en el shader: la de más margen)
function drvRigUI(iS, pS, live) {
  drv.rigCov = undefined;
  if (live.length < 2 || st.plate.empty) { $('drv-rig-kv').innerHTML = ''; drv.rig = null; return; }
  const cams = live.map(u => { const h = DriveMath.homography(iS, pS, drvIntr(u), drvPose(u)); return h && { sd: h.sd, intr: drvIntr(u) }; });
  const W = drvWindows(), rows = [], all = [];
  W.regs.forEach(r => {
    const own = DriveMath.owners(cams, r.pts), cnt = live.map(() => 0); let none = 0;
    own.forEach(k => { if (k < 0) none++; else cnt[k]++; });
    all.push(...own);
    const parts = cnt.map((c, k) => [c / own.length, k]).filter(x => x[0] >= 0.01).sort((a, b) => b[0] - a[0]).map(([f, k]) => `${escAttr(drvCamName(live[k]))} ${fmt(f * 100, 0)}%`);
    if (none / own.length >= 0.01) parts.push(`<span class="bad">${fmt(none / own.length * 100, 0)}% uncovered</span>`);
    rows.push([r.name, parts.join(' · ') || '–', r.frame ? 'The whole frame (no keyed area: turn the key on)' : `${fmt(r.share * 100, 0)}% of the frame, keyed`]);
  });
  if (W.regs[0] && W.regs[0].frame) drv.rigCov = all.filter(k => k >= 0).length / all.length;
  else { const pts = []; for (let j = 0; j < 30; j++) for (let i = 0; i < 48; i++) pts.push([(i + 0.5) * st.plate.W / 48, (j + 0.5) * st.plate.H / 30]); const o = DriveMath.owners(cams, pts); drv.rigCov = o.filter(k => k >= 0).length / o.length; }
  drv.rig = { rows, names: live.map(drvCamName) };
  $('drv-rig-kv').innerHTML = rows.map(([k, v, t]) => `<dt title="${t}">${k}</dt><dd>${v}</dd>`).join('');
}

// ---------- Nuke: Reformat al formato de la toma + CornerPin2D (de la cámara elegida) ----------
function drvCornerPinText() {
  const u = drvU(), a = u.src && DriveMath.analyze(sceneIntr(), scenePose(), drvIntr(u), drvPose(u));
  if (!a) { toast('Load a drive plate first', true); return ''; }
  if (a.coverage < 0.005) { toast('The drive plate does not cover the shot: check Looks to and the angles before copying a CornerPin', true); return ''; }
  if (a.corners.some(c => !c)) { toast('A corner of the drive plate falls behind the shot camera: a CornerPin cannot do this view', true); return ''; }
  const p = drvPose(u), rig = drv.units.length > 1;
  // en px del comp (reencuadre de entrega): las esquinas pasan por el mismo Transform y el formato es el del comp
  const comp = typeof dlComp === 'function' && dlComp(), fo = comp ? DeliveryMath.fmtOf(dl, st.plate.W, st.plate.H) : { W: st.plate.W, H: st.plate.H };
  const pin = (cs) => drvPinOn(u) ? cs.map((c, i) => [c[0] + u.pin[i][0], c[1] + u.pin[i][1]]) : cs;
  const map = (cs) => (comp ? pin(cs).map(c => dlToComp(c)) : pin(cs));
  // la cámara cambia por cuadro (keyframes, tilt por cuadro): un juego de esquinas por cuadro del timeline
  let anim = null;
  if (drvAnimated(u)) {
    const iS = sceneIntr(), pS = scenePose(), last = Math.min(tl.end, tl.start + 9999), seq = [];
    for (let fr = tl.start; fr <= last; fr++) {
      const h = DriveMath.homography(iS, pS, drvIntr(u), drvPose(u, drvIndexAt(u, fr))), cs = h && [[0, 0], [u.W, 0], [u.W, u.H], [0, u.H]].map(q => DriveMath.apply(h.ds, q));
      if (!cs || cs.some(c => !c)) { toast(`On frame ${fr} a corner of the drive plate falls behind the shot camera: a CornerPin cannot do this view`, true); return ''; }
      seq.push(map(cs));
    }
    anim = { first: tl.start, to: seq };
  }
  const kn = drvKeys(u).length;
  return DriveMath.cornerPinText({
    drvW: u.W, drvH: u.H, shotW: fo.W, shotH: fo.H, shotPar: comp ? 1 : par(), to: map(a.corners), anim, suffix: rig ? '_' + (drv.sel + 1) : '',
    label: `${rig ? drvCamName(u) + '\n' : ''}${u.name}\n${drvPinOn(u) ? `corner pin, up to ${fmt(drvPinMax(u), 0)} px off the camera fit\n` : ''}${fmt(u.cam.focal, 1)} mm ${anim ? `animated ${tl.start}-${tl.start + anim.to.length - 1}${kn >= 2 ? ` (${kn} keys)` : ' (tilt per frame)'}` : `yaw ${fmt(p.yawDeg, 0)} tilt ${fmt(p.tiltDeg, 1)}`} h ${fmt(p.heightM, 2)} m\n${comp ? 'comp' : 'plate'} px`,
  });
}
function drvCopyShow(ok, text, msg) {
  $('drv-copy-msg').textContent = ok ? msg : 'The browser blocked the clipboard: copy it from the box below.';
  $('drv-copy-out').hidden = ok; $('drv-copy-out').value = text; if (ok) toast(msg);
}
function drvCopy(text, msg) {
  if (!text) return '';
  try { navigator.clipboard.writeText(text).then(() => drvCopyShow(true, text, msg), () => drvCopyShow(false, text, msg)); } catch (e) { drvCopyShow(false, text, msg); }
  return text;
}

// ---------- Proyecto (enganches en js/project.js y js/panel.js) ----------
// file / cam / offset de arriba son los de la primera cámara (lo que re-vincula js/project.js); rig, todas
const drvUnitState = (u) => ({ file: u.name || u.wantName, label: u.label || undefined, cam: { ...u.cam }, note: u.metaNote || undefined, offset: u.offset, track: u.track || undefined, fit: u.fit === 'pin' ? 'pin' : undefined, pin: u.pin || undefined, pinScale: u.pinScale !== 100 ? u.pinScale : undefined });
function drvProjectState() {
  const cams = Object.keys(drvCams).length ? { ...drvCams } : undefined;
  const us = drv.units.filter(u => u.src || u.wantName || u.label);
  if (!us.length) return cams ? { file: '', cams } : undefined;
  return { ...drvUnitState(us[0]), on: drv.on, mix: drv.mix, defAt: drv.defAt !== 'inf' ? drv.defAt : undefined, cams, rig: us.length > 1 ? us.map(drvUnitState) : undefined, sel: us.length > 1 ? Math.max(0, us.indexOf(drvU())) : undefined };
}
const drvPinOf = (p) => Array.isArray(p) && p.length === 4 && p.every(q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)) ? p.map(q => q.slice()) : null;
function drvApplyProject(o) {
  // proyectos de antes: el origen 'file' es el EXR
  const src = (c) => c && c.src === 'file' ? { ...c, src: 'exr' } : c;
  drvCams = Object.fromEntries(Object.entries((o && o.cams) || {}).map(([k, c]) => [k, src(c)]));
  if (!o || !(o.file || o.rig || o.label)) return;
  drv.on = o.on !== false; drv.mix = o.mix ?? 1; drv.defAt = typeof o.defAt === 'string' ? o.defAt : 'inf';
  // el archivo no viaja en el proyecto: cada cámara queda esperando el suyo, y su metadata no pisa esta cámara
  const old = drv.units.slice();
  drv.units = (o.rig || [o]).slice(0, DRV_MAX).map(s => {
    const k = old.findIndex(u => u.src && u.name === s.file), u = k >= 0 ? old.splice(k, 1)[0] : drvNewUnit();
    Object.assign(u, { cam: { ...DRV_CAM_DEF, ...(src(s.cam) || {}) }, metaNote: s.note || (s.cam && s.cam.src ? `Camera from the project (${drvSrcText(src(s.cam))}).` : ''), offset: s.offset || 0, label: s.label || '', track: s.track || null, fit: s.fit === 'pin' ? 'pin' : 'meta', pin: drvPinOf(s.pin), pinScale: Number.isFinite(s.pinScale) ? s.pinScale : 100 });
    if (!u.src) Object.assign(u, { wantName: s.file || '', keepCam: !!s.file });
    return u;
  });
  old.forEach(u => drvDrop(u));
  drv.sel = Math.min(Math.max(0, o.sel || 0), drv.units.length - 1);
  drvModesFor = null; drvUI(); render();
}
drvUI();
