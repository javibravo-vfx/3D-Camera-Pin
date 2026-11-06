// 3D Render, el motor Path trace del visor Render (el otro es Raster, el de siempre). three-gpu-pathtracer y
// three-mesh-bvh (vendor/, por el import map de index.html) se cargan recién al elegirlo. No copia la escena de las
// otras pestañas: traza las copias físicas de esta (r3StdOf, con lo editado en Material), el sol, el cielo o el HDRI.
// - Un solo renderer: el de la pestaña (r3.gl). El path tracer dibuja en un target propio, de tamaño fijo (720p o
//   1080p de ancho, o el del plate, con el aspecto de la toma) y se escala para entrar en el visor. Al volver a Raster
//   (o al salir de la pestaña) se libera todo lo suyo: ningún contexto WebGL de más.
// - Color: el path tracer trabaja en lineal Rec.709 (sus materiales son copias de los de la pestaña pasados de ACEScg a
//   Rec.709: el path tracer no corre el onBeforeCompile que lleva a AP1). Su salida no pasa por el tone map de three:
//   el paso final de la pestaña (R3_FINAL_SHADER, js/render3d-fx.js) la lleva a ACEScg (R3_709_TO_AP1), aplica la
//   exposición y el Viewer de Render, como con Raster.
// - Cámara: la de la vista Render, ya puesta por r3CamPush (js/render3d.js): la de la toma, la de Shakelab cuadro a
//   cuadro, o la libre del visor (la misma en los dos motores; no toca la toma, el proyecto, Shakelab ni otras pestañas).
// - Armar la escena: el BVH se arma en otro hilo (js/bvh-worker.js) y el visor muestra una barra con cuánto falta; si el
//   worker no anda, se arma acá (la página se frena un momento). Reload la vuelve a armar desde cero.
// - Mientras la cámara se mueve o corre la línea de tiempo, una imagen de un cuarto del tamaño (unas pocas muestras y el
//   denoise); quieta, se completa hasta Samples. La línea de tiempo mueve las copias y reajusta el BVH (no lo rehace).
// - El sol: la luz direccional de la pestaña; con Sun size, cada muestra cae en otro punto del disco (sombras suaves).
// API: r3pt, r3PtDraw, r3PtDispose, r3PtReload, r3PtFrameCanvas, r3PtPbQuality, r3PtStatus, R3_PT_PB.
const R3_PT_PB = { draft: [16, 3], preview: [64, 4], good: [256, 5], final: [1024, 8] };
const r3pt = { lib: null, bvhLib: null, worker: null, tr: null, rt: null, fx: null, dnq: null, scene: null, cam: null, sun: null, sunJ: null, prog: null,
  links: [], geo: new Map(), mats: new Map(), skipped: 0, tris: 0, built: false, busy: false, err: '', msg: '', keys: {}, frame: NaN, jitN: -1,
  paused: false, t0: 0, tDone: 0, env: null, envKey: '', more: false, gen: 0 };

// ---------- La librería y el renderer ----------
async function r3PtLib() {
  if (!r3pt.lib) [r3pt.lib, r3pt.bvhLib] = await Promise.all([import('three-gpu-pathtracer'), import('three-mesh-bvh')]);
  return r3pt.lib;
}
// el BVH en otro hilo (js/bvh-worker.js), con lo que ya armó: lo que el generador de la librería le pide a setBVHWorker
const r3PtBvhWorker = {
  generate(geometry, options) {
    return new Promise((res, rej) => {
      if (!r3pt.worker) r3pt.worker = new Worker('js/bvh-worker.js', { type: 'module' });
      const w = r3pt.worker, { onProgress, ...opts } = options, pos = geometry.attributes.position.array.slice(), idx = geometry.index ? geometry.index.array.slice() : null;
      w.onmessage = (e) => {
        const d = e.data;
        if (d.progress !== undefined) { if (onProgress) onProgress(d.progress); return; }
        if (d.error) { rej(new Error(d.error)); return; }
        res(r3pt.bvhLib.MeshBVH.deserialize(d.serialized, geometry, { setIndex: false }));
      };
      w.onerror = (e) => { e.preventDefault(); rej(new Error(e.message || 'the BVH worker did not start')); };
      w.postMessage({ base: new URL('.', location.href).href, position: pos, index: idx, options: opts }, idx ? [pos.buffer, idx.buffer] : [pos.buffer]);
    });
  },
  dispose() {},
};
// la barra de progreso del armado (en el visor Render): { f: 0 a 1, t: el paso } o null
function r3PtProg(p) {
  r3pt.prog = p;
  const el = $('r3-pt-prog'); if (!el) return;
  const on = !!p && r3.on && r3.engine === 'pt';
  el.hidden = !on; if (!on) return;
  $('r3-pt-prog-t').textContent = p.t; $('r3-pt-prog-b').style.width = (Math.max(0, Math.min(1, p.f)) * 100).toFixed(1) + '%';
}
const r3PtPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); // que la barra llegue a verse
function r3PtInit() {
  const { WebGLPathTracer, DenoiseMaterial } = r3pt.lib, gl = r3.gl;
  // WebGLPathTracer avisa que está deprecado (en favor del de WebGPU): la consola queda limpia
  const warn = console.warn; let tr; console.warn = () => {};
  try { tr = new WebGLPathTracer(gl); } finally { console.warn = warn; }
  tr.setBVHWorker(r3PtBvhWorker);
  tr.synchronizeRenderSize = false; tr.rasterizeScene = false; tr.textureSize.set(2048, 2048);
  // mientras recompila (cambió el fondo, un material de vidrio…) queda la imagen anterior: sin el raster de la librería
  tr.rasterizeSceneCallback = () => {};
  // al moverse: un cuarto del tamaño; quieta, se completa (como en 3D Camera Pin)
  tr.renderDelay = 80; tr.fadeDuration = 200; tr.minSamples = 2; tr.dynamicLowRes = true; tr.lowResScale = 0.25;
  // el denoise con la misma salida que el quad de la librería: color premultiplicado por alfa y por la opacidad del fundido
  const dm = new DenoiseMaterial({ map: null, blending: THREE.NoBlending, premultipliedAlpha: true });
  dm.fragmentShader = dm.fragmentShader.replace(/#include <premultiplied_alpha_fragment>\s*gl_FragColor\.a \*= opacity;/, 'gl_FragColor *= opacity;');
  r3pt.dnq = new THREE.FullScreenQuad(dm);
  const den = (map, q, k) => { dm.map = map; dm.sigma = r3.pt.dnS * k; dm.threshold = 0.03; dm.kSigma = 1; dm.opacity = q.material.opacity; dm.blending = q.material.blending; r3pt.dnq.render(gl); };
  tr.renderToCanvasCallback = (target, renderer, quad) => {
    const ac = renderer.autoClear; renderer.autoClear = false;
    if (r3.pt.dn) den(target.texture, quad, 1); else quad.render(renderer);
    renderer.autoClear = ac;
  };
  // la imagen chica al moverse también pasa por el denoise: se lee como una vista previa suave y no como puntos
  const q = tr._quad, qr = q.render.bind(q);
  q.render = (renderer) => { if (r3.pt.dn && q.material.map === tr._lowResPathTracer.target.texture) den(q.material.map, q, 0.5); else qr(renderer); };
  r3pt.tr = tr;
  r3pt.sun = new THREE.DirectionalLight(0xffffff, 1); r3pt.sunJ = new THREE.DirectionalLight(0xffffff, 1);
}
// libera todo lo del path tracer (al volver a Raster o al salir de la pestaña)
function r3PtDispose() {
  r3pt.gen++; // un armado en curso no sigue
  const tr = r3pt.tr;
  if (tr) {
    const freeAll = (m) => {
      if (!m) return;
      for (const u of Object.values(m.uniforms || {})) {
        const v = u && u.value; if (!v || typeof v !== 'object') continue;
        if (typeof v.dispose === 'function') { try { v.dispose(); } catch (e) { /* ya liberado */ } }
        for (const x of Object.values(v)) if (x && (x.isTexture || x.isRenderTarget) && typeof x.dispose === 'function') x.dispose();
      }
      m.dispose();
    };
    try { freeAll(tr._pathTracer.material); tr.dispose(); tr._lowResPathTracer.dispose(); } catch (e) { console.warn('path tracer dispose', e); }
    if (tr._colorBackground) tr._colorBackground.dispose();
  }
  if (r3pt.dnq) { r3pt.dnq.material.dispose(); r3pt.dnq.dispose(); }
  if (r3pt.worker) r3pt.worker.terminate(); // un BVH a medio armar no sigue
  r3PtProg(null);
  r3PtFxDispose(r3pt.fx);
  for (const g of r3pt.geo.values()) g.dispose(); for (const m of r3pt.mats.values()) m.dispose(); if (r3pt.env) r3pt.env.dispose();
  Object.assign(r3pt, { worker: null, tr: null, rt: null, fx: null, dnq: null, scene: null, cam: null, links: [], geo: new Map(), mats: new Map(), built: false, busy: false, err: '', empty: false, msg: '', keys: {}, env: null, envKey: '', more: false, frame: NaN, jitN: -1 });
}
// la imagen del path tracer (lineal Rec.709, premultiplicada) y lo que necesita el paso final de la pestaña
function r3PtFxMake(W, H) {
  const rt = (type) => { const t = new THREE.WebGLRenderTarget(W, H, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }); t.texture.colorSpace = THREE.LinearSRGBColorSpace; return t; };
  const fx = { W, H, cur: 0, acc: [rt(THREE.HalfFloatType)], post: rt(THREE.HalfFloatType), out: rt(THREE.UnsignedByteType), in709: true, alphaMode: 0, checker: false,
    qFinal: new THREE.FullScreenQuad(new THREE.ShaderMaterial(R3_FINAL_SHADER)), qCopy: new THREE.FullScreenQuad(new THREE.ShaderMaterial(THREE.CopyShader)), bloom: null };
  fx.qFinal.material.depthTest = fx.qCopy.material.depthTest = false;
  return fx;
}
function r3PtFxDispose(fx) {
  if (!fx) return;
  [...fx.acc, fx.post, fx.out].forEach(t => t.dispose());
  [fx.qFinal, fx.qCopy].forEach(q => { q.material.dispose(); q.dispose(); });
  if (fx.bloom) fx.bloom.dispose();
}

// ---------- La escena: las copias de 3D Render ----------
// el material para el path tracer: el de la pestaña (ACEScg) en lineal Rec.709, con el tinte de la instancia
function r3PtMatFill(m) {
  const s = m.userData.src;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'roughness', 'metalness', 'emissiveIntensity', 'opacity', 'transparent', 'side', 'vertexColors', 'alphaTest',
    'clearcoat', 'clearcoatRoughness', 'transmission', 'ior', 'thickness'])
    if (s[k] !== undefined) m[k] = s[k];
  if (s.normalScale) m.normalScale.copy(s.normalScale);
  m.color.fromArray(r3WsTo709(s.color.toArray())); if (m.userData.tint) m.color.multiply(m.userData.tint);
  m.emissive.fromArray(r3WsTo709(s.emissive.toArray()));
}
function r3PtMat(s, tint) {
  const key = s.uuid + (tint ? `|${tint.r.toFixed(4)},${tint.g.toFixed(4)},${tint.b.toFixed(4)}` : '');
  let m = r3pt.mats.get(key);
  if (!m) { m = new THREE.MeshPhysicalMaterial(); m.name = s.name; m.userData.src = s; m.userData.tint = tint ? tint.clone() : null; r3PtMatFill(m); r3pt.mats.set(key, m); }
  return m;
}
// la geometría como la junta el path tracer: posición, normal, uv y (si el material los usa) colores por vértice en
// RGBA, todo en float sin normalizar (mezclar tipos o colores de 3 y 4 componentes rompe la unión)
function r3PtGeo(g, color) {
  const key = g.uuid + (color ? 'c' : '');
  let o = r3pt.geo.get(key); if (o) return o;
  const f32 = (a, n) => {
    const out = new Float32Array(a.count * n), get = [a.getX, a.getY, a.getZ, a.getW];
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = k < a.itemSize ? get[k].call(a, i) : 1;
    return new THREE.BufferAttribute(out, n);
  };
  o = new THREE.BufferGeometry();
  for (const [n, sz] of [['position', 3], ['normal', 3], ['uv', 2]]) if (g.attributes[n]) o.setAttribute(n, f32(g.attributes[n], sz));
  if (g.index) o.setIndex(Array.from(g.index.array));
  for (const gr of g.groups) o.addGroup(gr.start, gr.count, gr.materialIndex);
  if (!o.attributes.normal) o.computeVertexNormals();
  if (color && g.attributes.color) o.setAttribute('color', f32(g.attributes.color, 4)); // ya lineales (como en Raster)
  r3pt.geo.set(key, o); return o;
}
// lo que el path tracer no traza: shaders propios (Gaussian splats), nubes de puntos, líneas y wireframe. Hoy no llega
// nada de eso: 3D Render dibuja el entorno sólido (r3Show) y el scan (OBJ o splat) no entra en 3D Render, en ningún motor
const r3PtSkip = (m) => !m || m.isShaderMaterial || m.isRawShaderMaterial || m.isPointsMaterial || m.isLineBasicMaterial || m.wireframe;
function r3PtVisible(o) { for (let p = o; p && p !== envRoot; p = p.parent) if (!p.visible) return false; return true; }
function r3PtScene() {
  const sc = new THREE.Scene(), links = [], im = new THREE.Matrix4(), mw = new THREE.Matrix4(), ic = new THREE.Color();
  let tris = 0, skipped = 0;
  const vis = envRoot.visible; envRoot.visible = !!ENV_MODULES[env.id];
  try {
    envRoot.updateMatrixWorld(true);
    envRoot.traverse(o => {
      if (o.isPoints || (o.isMesh && (Array.isArray(o.material) ? o.material : [o.material]).some(r3PtSkip))) { if (o.isPoints || o.isMesh) skipped++; return; }
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material], g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
      const add = (matrix, i, tint) => {
        const pm = mats.map(m => r3PtMat(m, tint));
        const mesh = new THREE.Mesh(r3PtGeo(g, mats.some(m => m.vertexColors)), Array.isArray(o.material) ? pm : pm[0]);
        mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix); mesh.visible = r3PtVisible(o);
        sc.add(mesh); links.push([mesh, o, i]); tris += n;
      };
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, im); mw.multiplyMatrices(o.matrixWorld, im);
          // los colores por instancia ya son lineales (r3Swap): son el tinte
          add(mw, i, o.instanceColor ? o.getColorAt(i, ic).clone() : null);
        }
      } else add(o.matrixWorld, -1, null);
    });
  } finally { envRoot.visible = vis; }
  sc.add(r3pt.sun, r3pt.sun.target);
  sc.updateMatrixWorld(true);
  Object.assign(r3pt, { scene: sc, links, tris, skipped });
}
// la línea de tiempo: las copias siguen a sus originales y el BVH se reajusta (no se rehace)
function r3PtRefit() { if (r3PtRefitScene()) r3pt.tr.reset(); }
// sin reiniciar las muestras (el motion blur de los renders: cada muestra en otro momento del obturador)
function r3PtRefitScene() {
  if (!r3pt.links.length) return false;
  envRoot.updateMatrixWorld(true);
  const im = new THREE.Matrix4();
  for (const [mesh, o, i] of r3pt.links) {
    if (i < 0) mesh.matrix.copy(o.matrixWorld);
    else if (i < o.count) { o.getMatrixAt(i, im); mesh.matrix.multiplyMatrices(o.matrixWorld, im); }
    mesh.visible = r3PtVisible(o) && (i < 0 || i < o.count);
  }
  r3pt.scene.updateMatrixWorld(true);
  const tr = r3pt.tr, res = tr._generator.generate(), m = tr._pathTracer.material;
  if (res.bvhChanged) { const a = res.geometry.attributes; m.bvh.updateFrom(res.bvh); m.attributesArray.updateFrom(a.normal, a.tangent, a.uv, a.color); }
  if (res.needsMaterialIndexUpdate) m.materialIndexAttribute.updateFrom(res.geometry.attributes.materialIndex);
  return true;
}

// ---------- Luz, entorno y cámara ----------
// el entorno en lineal Rec.709: el HDRI (con su giro, como en Raster) o el cielo (de colores o físico)
function r3PtEnv() {
  const H = r3.hdri, has = !!(H.tex && H.src);
  const key = has ? `h|${H.name}|${H.cs}|${H.rot}|${H.src.w}` : `s|${r3SkyKeyNow()}`;
  if (key !== r3pt.envKey) {
    let w, h, data;
    if (has) {
      const s = H.src, sh = Math.round(r3Wrap(H.rot) / 360 * s.w) % s.w, M = H.cs === 'acescg' ? R3_AP1_TO_709 : null;
      w = s.w; h = s.h; data = new Float32Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + ((x + sh) % w)) * 4, o = (y * w + x) * 4, r = s.data[i], g = s.data[i + 1], b = s.data[i + 2];
        if (M) { data[o] = M[0] * r + M[1] * g + M[2] * b; data[o + 1] = M[3] * r + M[4] * g + M[5] * b; data[o + 2] = M[6] * r + M[7] * g + M[8] * b; }
        else { data[o] = r; data[o + 1] = g; data[o + 2] = b; }
        data[o + 3] = 1;
      }
    } else ({ w, h, data } = r3SkyData());
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.flipY = false; t.needsUpdate = true;
    if (r3pt.env) r3pt.env.dispose();
    r3pt.env = t; r3pt.envKey = key;
  }
  // el fondo: como en Raster (el HDRI o un color de cielo parejo; el cielo físico se ve entero) o transparente
  const bgOn = r3.pt.bg === 'env', c709 = (hex, k) => new THREE.Color().fromArray(r3WsTo709(r3HexToWs(hex))).multiplyScalar(k);
  let bg = null, bgI = 1;
  if (bgOn) {
    if (has) { if (H.bg) { bg = r3pt.env; bgI = H.int; } else bg = c709('#8ea9c8', Math.min(1, H.int)); }
    else if (r3.skyMode === 'phys') bg = r3pt.env;
    else bg = c709(r3.skyCol, 0.75 * Math.min(1, r3.skyInt / 0.6));
  }
  return { env: r3pt.env, envI: has ? H.int : 1, bg, bgI, key: [r3pt.envKey, has ? H.int : 1, r3.pt.bg, bg && bg.isColor ? bg.getHexString() : bg ? 't' : 'n', bgI].join('|') };
}
function r3PtSunKey() {
  const s = r3.sun, d = s.position.clone().sub(s.target.position).normalize();
  return [d.x, d.y, d.z].map(v => v.toFixed(5)).join() + `|${s.intensity.toFixed(4)}|${r3.sunCol}|${r3.sunSize}`;
}
function r3PtSunSet() {
  const s = r3.sun, L = r3pt.sun;
  L.position.copy(s.position); L.target.position.copy(s.target.position); L.intensity = s.intensity;
  L.color.fromArray(r3WsTo709(r3HexToWs(r3.sunCol))); L.updateMatrixWorld(); L.target.updateMatrixWorld();
}
// Sun size: cada muestra, el sol en otro punto de su disco (sólo la luz: sin recompilar ni reiniciar)
function r3PtJitter() {
  const tr = r3pt.tr, n = Math.floor(tr.samples);
  if (n === r3pt.jitN) return; r3pt.jitN = n;
  const L = r3pt.sun, J = r3pt.sunJ, t = L.target.position, d = L.position.clone().sub(t), len = d.length(); d.normalize();
  J.copy(L); J.target.position.copy(t);
  if (r3.sunSize > 0 && n > 0) {
    const a = r3Halton(n, 2) * Math.PI * 2, r = Math.sqrt(r3Halton(n, 3)) * Math.tan(r3.sunSize / 2 * Math.PI / 180);
    const u = new THREE.Vector3(0, 1, 0).cross(d); if (u.lengthSq() < 1e-6) u.set(1, 0, 0); u.normalize(); const v = d.clone().cross(u);
    J.position.copy(t).addScaledVector(d.addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize(), len);
  }
  J.updateMatrixWorld(); J.target.updateMatrixWorld();
  tr._pathTracer.material.lights.updateFrom([J], []);
}
// la cámara: la de la toma (con Shakelab, si va, ya puesta) o la libre del visor; el foco y el diafragma
function r3PtCamSet() {
  const cam = r3pt.cam;
  THREE.PerspectiveCamera.prototype.copy.call(cam, camera, false); // la de la vista (r3CamPush ya puso la libre o Shakelab)
  cam.near = Math.max(0.01, camera.near); cam.far = Math.max(camera.far, 5000);
  const P = r3.pt, lens = typeof bkLens === 'function' ? bkLens(0) : { focalMm: 35, fNumber: 2.8 };
  let N = 0, fd = 10;
  if (P.focus === 'depthlab' && typeof lensState !== 'undefined') { N = lens.fNumber; fd = lensState.focusM; }
  else if (P.focus === 'manual') { N = P.fstop; fd = P.focusM; }
  // un lente anamórfico (el squeeze del plate): el bokeh es un óvalo vertical en la imagen desqueezada, con el alto que
  // da DepthLab y el ancho dividido por el squeeze (la librería angosta la pupila en horizontal con anamorphicRatio < 1)
  const sq = typeof par === 'function' ? par() : 1;
  cam.apertureBlades = 0; cam.anamorphicRatio = N > 0 && Math.abs(sq - 1) > 1e-3 ? 1 / sq : 1; cam.focusDistance = Math.max(0.01, fd || 10);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  // el diámetro de la pupila en mm (focal / T-stop): el path tracer lo pasa a metros
  if (N > 0 && lens.focalMm > 0) cam.bokehSize = lens.focalMm / N; else cam.fStop = Infinity;
  return [...cam.matrixWorld.elements, ...cam.projectionMatrix.elements].map(v => v.toFixed(6)).join() + `|${cam.bokehSize.toFixed(5)}|${cam.focusDistance}|${cam.anamorphicRatio}`;
}
function r3PtSize() {
  const a = camera.aspect || 16 / 9, pl = st.plate && !st.plate.empty ? st.plate : null;
  const W = r3.pt.res === 'plate' && pl ? Math.round(pl.W * par()) : r3.pt.res === '1080' ? 1920 : 1280;
  return { W, H: Math.max(2, Math.round(W / a)) };
}

// ---------- Armar ----------
async function r3PtBuild() {
  if (r3pt.busy) return; r3pt.busy = true; r3pt.err = ''; r3pt.empty = false;
  const gen = r3pt.gen, live = () => gen === r3pt.gen && r3.on && r3.engine === 'pt';
  try {
    r3PtProg({ f: 0.02, t: 'Loading the path tracer…' }); await r3PtPaint();
    await r3PtLib();
    if (!live() || !r3Init()) return;
    if (!r3pt.tr) r3PtInit();
    r3PtProg({ f: 0.06, t: 'Copying the scene of 3D Render…' }); await r3PtPaint();
    if (!live()) return;
    if (!ENV_MODULES[env.id]) { r3pt.empty = true; r3pt.err = 'Nothing to trace: pick an environment in 3D Camera Pin | Environment › Environment › Module.'; return; }
    r3CamPush(tl.frame);
    try {
      r3SunApply(); r3PtScene();
      if (!r3pt.tris) { r3pt.empty = true; r3pt.err = 'Nothing to trace: the environment has no surfaces.'; return; }
      if (!r3pt.cam) r3pt.cam = new r3pt.lib.PhysicalCamera();
      r3PtSunSet();
      const E = r3PtEnv(), sc = r3pt.scene;
      sc.environment = E.env; sc.environmentIntensity = E.envI; sc.background = E.bg; sc.backgroundIntensity = E.bgI;
      const tr = r3pt.tr, P = r3.pt;
      tr.bounces = P.bounces; tr.filterGlossyFactor = P.glossy; tr.tiles.set(P.tiles, P.tiles);
      const ck = r3PtCamSet();
      r3PtProg({ f: 0.15, t: `Joining ${Math.round(r3pt.tris).toLocaleString('en-US')} triangles…` }); await r3PtPaint();
      if (!live()) return;
      // el BVH en otro hilo, con su avance; si el worker no anda, acá (la página se frena un momento)
      try {
        await tr.setSceneAsync(sc, r3pt.cam, { onProgress: (p) => { if (live()) r3PtProg({ f: 0.2 + 0.7 * p, t: `Building the BVH… ${Math.round(p * 100)} %` }); } });
      } catch (e) {
        if (!live()) return;
        console.warn('BVH worker', e); r3pt.bvhSync = true; // quedó dicho para la QA
        r3PtProg({ f: 0.5, t: 'Building the BVH (the page stops for a moment)…' }); await r3PtPaint();
        tr.setScene(sc, r3pt.cam);
      }
      if (!live()) return;
      r3PtProg({ f: 0.95, t: 'Compiling the shaders…' });
      r3pt.keys = { cam: ck, sun: r3PtSunKey(), env: E.key, mat: JSON.stringify(r3.matEdits), q: [P.bounces, P.glossy, P.tiles].join() };
      r3pt.frame = tl.frame; r3pt.jitN = -1; r3pt.built = true;
    } finally { r3CamPop(); }
  } catch (e) {
    console.error(e); r3pt.built = false;
    r3pt.err = /import|module|fetch/i.test(String(e && e.message)) ? 'The path tracer could not be loaded: ' + e.message : 'Path tracer error: ' + (e && e.message || e);
  } finally { r3pt.busy = false; r3pt.msg = ''; if (!r3pt.built) r3PtProg(null); r3PtMsgShow(); r3Panel(); r3Dirty('shot'); }
}
function r3PtMsgShow() { const m = r3pt.err; if (r3.on && r3.engine === 'pt') { $('r3-msg').textContent = m; $('r3-msg').hidden = !m; } }
// lo que cambió desde el último dibujo: el cuadro, la cámara, el sol, el entorno, los materiales, la calidad
function r3PtSync() {
  const tr = r3pt.tr, K = r3pt.keys, P = r3.pt;
  if (tl.frame !== r3pt.frame) { r3pt.frame = tl.frame; r3PtRefit(); }
  const q = [P.bounces, P.glossy, P.tiles].join();
  if (q !== K.q) { K.q = q; tr.bounces = P.bounces; tr.filterGlossyFactor = P.glossy; tr.tiles.set(P.tiles, P.tiles); tr.reset(); }
  const mk = JSON.stringify(r3.matEdits);
  if (mk !== K.mat) { K.mat = mk; for (const m of r3pt.mats.values()) r3PtMatFill(m); tr.updateMaterials(); }
  const sk = r3PtSunKey(); if (sk !== K.sun) { K.sun = sk; r3PtSunSet(); tr.updateLights(); r3pt.jitN = -1; }
  const E = r3PtEnv();
  if (E.key !== K.env) { K.env = E.key; const sc = r3pt.scene; sc.environment = E.env; sc.environmentIntensity = E.envI; sc.background = E.bg; sc.backgroundIntensity = E.bgI; tr.updateEnvironment(); }
  const ck = r3PtCamSet(); if (ck !== K.cam) { K.cam = ck; tr.updateCamera(); }
}
function r3PtSizeSet(W, H) {
  const tr = r3pt.tr;
  tr._pathTracer.setSize(W, H); tr._lowResPathTracer.setSize(Math.max(1, Math.floor(W * tr.lowResScale)), Math.max(1, Math.floor(H * tr.lowResScale)));
}
// una muestra (o un pedazo, con tiles) dentro de fx.acc[0]
function r3PtSample(fx) {
  const gl = r3.gl, tr = r3pt.tr;
  r3PtJitter();
  gl.setRenderTarget(fx.acc[0]);
  try { tr.renderSample(); } finally { gl.setRenderTarget(null); }
}

// ---------- El visor Render ----------
// devuelve si hay que seguir dibujando (faltan muestras o el fundido de la vista previa)
function r3PtDraw(p, w, h) {
  const gl = r3.gl;
  if (!r3pt.built) {
    if (!r3pt.busy && !r3pt.err) r3PtBuild();
    p.ctx.fillStyle = '#16161a'; p.ctx.fillRect(0, 0, w, h);
    $('r3-shot-n').textContent = r3pt.err ? (r3pt.empty ? 'Path trace · nothing to trace' : 'Path trace · error') : 'Path trace · building…';
    r3PtProg(r3pt.prog); // la barra sobre el visor (se mantiene al redibujar)
    return false;
  }
  const tr = r3pt.tr, P = r3.pt, { W, H } = r3PtSize();
  try {
    r3PtSync();
    if (!r3pt.fx || r3pt.fx.W !== W || r3pt.fx.H !== H) { r3PtFxDispose(r3pt.fx); r3pt.fx = r3PtFxMake(W, H); tr.reset(); }
    r3PtSizeSet(W, H);
    if (r3pt.prog && !tr.isCompiling && tr.samples > 0) r3PtProg(null); // listo: ya hay imagen
    const fresh = !tr.samples;
    tr.pausePathTracing = r3pt.paused || tr.samples >= P.samples;
    if (fresh) { r3pt.t0 = performance.now(); r3pt.tDone = 0; }
    // la vista previa al moverse: unas pocas muestras a un cuarto del tamaño, no una sola
    const lo = tr._lowResPathTracer;
    if (!tr.isCompiling && lo.samples >= 1 && lo.samples < 4 && tr.samples < tr.minSamples) { lo.material = tr._pathTracer.material; lo.update(); }
    r3PtSample(r3pt.fx);
    if (tr.samples >= P.samples && !r3pt.tDone) r3pt.tDone = performance.now();
  } catch (e) { console.error(e); r3pt.err = 'Path tracer error: ' + (e && e.message || e); r3pt.built = false; r3PtMsgShow(); return false; }
  // el paso final de la pestaña: a ACEScg, exposición, post y el Viewer de Render
  const fx = r3pt.fx, behind = P.bg === 'plate' && typeof pbPlateEl === 'function' ? pbPlateEl() : null;
  fx.alphaMode = behind ? 2 : 0; fx.checker = P.bg === 'alpha' || (P.bg === 'plate' && !behind);
  gl.setPixelRatio(1); gl.setSize(w, h, false);
  r3FxShow(fx, null);
  p.ctx.clearRect(0, 0, w, h);
  if (behind) p.ctx.drawImage(behind, 0, 0, w, h);
  p.ctx.drawImage(gl.domElement, 0, 0);
  const pe = r3.plate && typeof pbPlateEl === 'function' ? pbPlateEl() : null;
  if (pe) p.ctx.drawImage(pe, 0, 0, w, h);
  $('r3-shot-n').textContent = r3PtStatus();
  return !r3pt.paused && (tr.samples < P.samples || tr._quad.material.opacity < 1) || tr.isCompiling;
}
function r3PtStatus() {
  const tr = r3pt.tr, P = r3.pt; if (!tr || !r3pt.built) return 'Path trace';
  const n = Math.floor(tr.samples), { W, H } = r3PtSize();
  const state = tr.isCompiling ? 'compiling shaders…' : r3pt.paused ? 'paused' : n >= P.samples ? 'done' : n < tr.minSamples ? 'preview' : 'rendering';
  const sec = ((r3pt.tDone || performance.now()) - r3pt.t0) / 1000;
  return `Path trace · ${n} / ${P.samples} · ${state} · ${W} × ${H}${n ? ` · ${sec.toFixed(1)} s` : ''}${r3.free ? ' · free camera' : ''}`;
}
// Reload: la escena del path tracer se vuelve a armar desde cero (si algo de 3D Render no le llegó)
function r3PtReload() {
  if (r3.engine !== 'pt') return;
  r3PtDispose(); r3pt.paused = false;
  r3ViewUI(); r3Panel(); r3Dirty('shot');
}
// Focus center: la distancia a lo que está en el centro de la imagen (foco manual)
function r3PtFocusCenter() {
  if (!r3pt.built) { toast('Path trace: wait until the scene is built', true); return; }
  r3CamPush(tl.frame);
  try { r3PtCamSet(); } finally { r3CamPop(); }
  const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), r3pt.cam);
  const hit = rc.intersectObjects(r3pt.scene.children, false).find(h => h.object.isMesh && h.object.visible);
  if (!hit) { toast('Nothing in the centre of the image', true); return; }
  r3.pt.focus = 'manual'; r3.pt.focusM = +hit.distance.toFixed(3);
  r3Save(); r3Panel(); r3Dirty('shot'); toast(`Focus at ${hit.distance.toFixed(2)} m (the centre of the image)`);
}

// ---------- Renders y playblast ----------
// la calidad del playblast: los presets, o 'panel' (Samples y Bounces del panel)
function r3PtPbQuality(q) { const v = R3_PT_PB[q]; return v ? { spp: v[0], bounces: v[1] } : { spp: r3.pt.samples, bounces: r3.pt.bounces }; }
// un cuadro del path tracer de W × H, con N muestras y esos rebotes: con la cámara de ahora (la de la toma o Shakelab,
// ya puestas en ese cuadro, o la libre), el foco, el fondo y la exposición. El cuadro de la línea de tiempo ya está puesto
async function r3PtFrameCanvas(W, H, N, bounces, onSample) {
  if (!r3pt.built) { await r3PtBuild(); if (!r3pt.built) throw new Error(r3pt.err || 'the path tracer is not available'); }
  const tr = r3pt.tr, gl = r3.gl, P = r3.pt;
  const keep = { delay: tr.renderDelay, fade: tr.fadeDuration, low: tr.dynamicLowRes, min: tr.minSamples };
  const fx = r3PtFxMake(W, H);
  tr.renderDelay = 0; tr.fadeDuration = 0; tr.dynamicLowRes = false; tr.minSamples = 1; tr.pausePathTracing = false;
  try {
    r3SunApply(); r3PtSync(); tr.bounces = bounces; r3pt.keys.q = '';
    r3PtSizeSet(W, H); tr.reset(); r3pt.jitN = -1;
    // motion blur: cada muestra en otro momento del obturador (el tráfico y la cámara de Shakelab), sin rehacer el BVH
    const mb = r3.mb && r3.shutter > 0 && N > 1, frame = tl.frame;
    let t = performance.now(), lastN = -1;
    while (tr.samples < N) {
      if (r3.cancel) throw new Error('cancelled');
      const n = Math.floor(tr.samples);
      if (mb && n !== lastN && tr.samples === n) {
        lastN = n; tl.frame = frame + (r3Halton(n + 1, 5) - 0.5) * r3.shutter / 360; applyMotion();
        if (r3.camKeep && !r3.free) { r3CamPush(tl.frame); r3PtCamSet(); tr._pathTracer.setCamera(r3pt.cam); }
        r3PtRefitScene();
      }
      r3PtSample(fx);
      if (performance.now() - t > 40) { onSample(Math.floor(tr.samples), N); await new Promise(r => setTimeout(r, 0)); t = performance.now(); } // la página respira
    }
    if (mb) { tl.frame = frame; applyMotion(); if (r3.camKeep && !r3.free) r3CamPush(frame); }
    // a la salida de 8 bits, con el alfa (fondo transparente o el plate detrás)
    fx.alphaMode = P.bg === 'env' ? 0 : 1; fx.checker = false;
    r3FxShow(fx, fx.out);
    const px = new Uint8Array(W * H * 4); gl.readRenderTargetPixels(fx.out, 0, 0, W, H, px);
    const img = new ImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4); // abajo para arriba
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    const behind = P.bg === 'plate' && typeof pbPlateEl === 'function' ? pbPlateEl() : null;
    if (behind) { const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tmp.getContext('2d').putImageData(img, 0, 0); g.drawImage(behind, 0, 0, W, H); g.drawImage(tmp, 0, 0); }
    else g.putImageData(img, 0, 0);
    return cv;
  } finally {
    tr.renderDelay = keep.delay; tr.fadeDuration = keep.fade; tr.dynamicLowRes = keep.low; tr.minSamples = keep.min;
    r3PtFxDispose(fx); tr.reset(); r3pt.frame = NaN;
  }
}
