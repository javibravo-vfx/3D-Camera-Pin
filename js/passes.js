// passes: vista Depth del visor y pases para IA / Nuke (profundidad, máscaras, cámara por frame).
// La profundidad es la distancia sobre el eje óptico en metros (la que usan lensCocPx y el Z defocus), la
// misma para el entorno (calle, autos, fachadas) y el scan. Se dibuja con un material propio que reemplaza
// por un momento al de cada objeto; los splats se ven por sus puntos (el mismo proxy que usa el pick).

// ---------- Vista Depth ----------
const dv = { on: false, lens: false, near: 1, far: 100, auto: true, hold: false, U: null, mScan: null, mEnv: null, rt: null };
{ const s = lsGet('dv', null); if (s) { dv.lens = !!s.lens; dv.auto = s.auto !== false; if (s.near >= 0 && s.far > s.near) { dv.near = s.near; dv.far = s.far; } } }
function dvInit() {
  if (dv.U) return;
  const css = k => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(k).trim() || '#808080');
  dv.U = { uMode: { value: 1 }, uNear: { value: 1 }, uFar: { value: 100 }, uK: { value: 0 }, uFocus: { value: 1 }, uMax: { value: 2 }, uRef: { value: 10 }, uPt: { value: 2 },
    uFg: { value: css('--ov-fg') }, uFoc: { value: css('--ov-focus') }, uBg: { value: css('--ov-bg') } };
  // modo 0: datos (R = metros, G = 1 si es del entorno, A = cobertura) · 1: gris, cerca blanco · 2: Lens.
  // El gris va en 1/distancia (como los mapas de profundidad de las IA): en metros lineales casi todo
  // queda blanco, porque la mayor parte de lo que se ve está cerca.
  const mk = cls => new THREE.ShaderMaterial({
    uniforms: { ...dv.U, uCls: { value: cls } }, side: THREE.DoubleSide,
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uPt; varying float vZ; varying vec3 vPos;
      void main() {
        #include <begin_vertex>
        #include <project_vertex>
        #include <logdepthbuf_vertex>
        vZ = -mvPosition.z; vPos = mvPosition.xyz; gl_PointSize = uPt;
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform int uMode; uniform float uCls, uNear, uFar, uK, uFocus, uMax, uRef; uniform vec3 uFg, uFoc, uBg;
      varying float vZ; varying vec3 vPos;
      ${ZDF_GLSL_COC}
      void main() {
        #include <logdepthbuf_fragment>
        if (uMode == 0) { gl_FragColor = vec4(vZ, uCls, 0.0, 1.0); return; }
        if (uMode == 1) { gl_FragColor = vec4(vec3(clamp((1.0 / vZ - 1.0 / uFar) / max(1.0 / max(uNear, 1e-3) - 1.0 / uFar, 1e-9), 0.0, 1.0)), 1.0); return; }
        // Lens: verde dentro de la zona nítida (|CoC| <= Max CoC del bokeh), hacia rojo adelante y azul atrás
        float c = zdfCoc(vZ, uK, uFocus), a = abs(c);
        vec3 col = a <= uMax ? uFoc : mix(uFoc, c < 0.0 ? uFg : uBg, 0.35 + 0.65 * clamp((a - uMax) / max(uRef - uMax, 1e-3), 0.0, 1.0));
        vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos))); // sombreado por la normal de pantalla: que se lea la forma
        gl_FragColor = vec4(col * (0.6 + 0.4 * abs(n.z)), 1.0);
      }`,
  });
  dv.mScan = mk(0); dv.mEnv = mk(1);
}
// dibuja scan + entorno con el material de profundidad en target (null = canvas del visor)
function dvDraw(target, mode) {
  dvInit();
  const r = renderer, U = dv.U, K = lensCocPx(Infinity), mx = typeof bokehState !== 'undefined' ? bokehState.maxCoc : 2;
  U.uMode.value = mode; U.uNear.value = dv.near; U.uFar.value = dv.far;
  U.uK.value = K >= 0 ? K : 0; U.uFocus.value = lensState.focusM; U.uMax.value = mx; U.uRef.value = Math.max(U.uK.value, mx * 4);
  U.uPt.value = (+$('ptsize').value || 2) * (target ? 1 : r.getPixelRatio());
  const saved = [], put = (o, k, v) => { saved.push([o, k, o[k]]); o[k] = v; };
  for (const c of scene.children) if (c !== scanRoot && c !== envRoot) put(c, 'visible', false);
  scanRoot.traverse(o => { if (o.userData.isSplat) put(o, 'visible', false); else { if (o.userData.pickProxy) put(o, 'visible', true); if (o.material) put(o, 'material', dv.mScan); } });
  envRoot.traverse(o => { if (o.material) put(o, 'material', dv.mEnv); });
  const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(), ac = r.autoClear;
  r.setClearColor(0x000000, mode === 0 ? 0 : 1);
  r.setRenderTarget(target); r.clear(); r.autoClear = false;
  try {
    r.render(scene, camera);
    if (envRoot.parent === envScene && envRoot.visible) r.render(envScene, camera);
  } finally {
    r.autoClear = ac; r.setClearColor(cc, ca); r.setRenderTarget(null);
    for (let i = saved.length - 1; i >= 0; i--) { const [o, k, v] = saved[i]; o[k] = v; }
  }
}
function dvShown() { return dv.on && !dv.hold; }
function dvRender() { if (!dvShown()) return false; dvAutoFollow(); dvDraw(null, dv.lens && lensCocPx(Infinity) >= 0 ? 2 : 1); return true; }
// Auto: el rango sigue a la escena (cámara, lente, entorno, scan) sin Near / Far fijados a mano. Cada
// lectura es a 192 px; como mucho una cada 250 ms y otra al final, cuando la escena se queda quieta.
// El tránsito que anda con el play no cuenta: el gris no tiene que latir mientras corre.
function dvAutoFollow() {
  if (!dv.auto || dv.lens) { dv.sig = null; return; } // Lens no usa el rango; al volver a Gray se recalcula
  camera.updateMatrixWorld();
  const sig = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements, ...scanRoot.matrixWorld.elements,
    scanRoot.children.length, env.id, env.on, env.seed, JSON.stringify(env.vals), envRoot.children.length, st.plate.W, st.plate.H].join();
  if (sig === dv.sig) return;
  const wait = 250 - (performance.now() - (dv.tAuto || 0));
  clearTimeout(dv.tFollow);
  if (wait > 0) { dv.tFollow = setTimeout(render, wait); return; }
  dv.sig = sig; dv.tAuto = performance.now();
  dvAutoRange(); dvUI(); dvSave();
}
// lee la profundidad (m) y la cobertura del entorno a W×H; filas de arriba hacia abajo, cielo = NaN
function dvRead(W, H) {
  if (!dv.rt) dv.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  if (dv.rt.width !== W || dv.rt.height !== H) dv.rt.setSize(W, H);
  dvDraw(dv.rt, 0);
  const z = new Float32Array(W * H), envm = new Uint8Array(W * H), rows = Math.max(1, Math.floor((4 << 20) / (W * 16)));
  const buf = new Float32Array(W * rows * 4);
  for (let y0 = 0; y0 < H; y0 += rows) { // por franjas: un RGBA float entero a 4K son 160 MB
    const n = Math.min(rows, H - y0);
    renderer.readRenderTargetPixels(dv.rt, 0, y0, W, n, buf);
    for (let j = 0; j < n; j++) {
      const o = (H - 1 - y0 - j) * W;
      for (let x = 0, i = j * W * 4; x < W; x++, i += 4) { const cov = buf[i + 3] > 0.5; z[o + x] = cov ? buf[i] : NaN; envm[o + x] = cov && buf[i + 1] > 0.5 ? 255 : 0; }
    }
  }
  return { z, envm };
}
// rango de la escena: del más cercano al percentil 98 de lo que se ve (a 192 px de ancho)
function dvAutoRange() {
  const W = 192, H = Math.max(1, Math.round(W * st.plate.H / (st.plate.W * par())));
  const { z } = dvRead(W, H), v = Array.from(z).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return;
  dv.near = Math.max(0, Math.floor(v[0] * 10) / 10); dv.far = Math.max(dv.near + 0.1, Math.ceil(v[Math.floor((v.length - 1) * 0.98)]));
}
function dvSave() { lsSet('dv', { lens: dv.lens, near: dv.near, far: dv.far, auto: dv.auto }); }
function dvUI() {
  $('dv-chip').setAttribute('aria-pressed', String(dv.on)); $('dv-opts').hidden = !dv.on;
  stage.classList.toggle('dview', dv.on);
  $('dv-gray').setAttribute('aria-pressed', String(!dv.lens)); $('dv-lens').setAttribute('aria-pressed', String(dv.lens));
  $('dv-range').hidden = dv.lens; $('dv-leg').hidden = !dv.lens;
  for (const [id, v, d] of [['dv-near', dv.near, 2], ['dv-far', dv.far, 1]]) if (document.activeElement !== $(id)) $(id).value = +v.toFixed(d);
  $('dv-auto').setAttribute('aria-pressed', String(dv.auto));
  if (dv.lens) {
    const K = lensCocPx(Infinity), lim = K >= 0 ? BokehMath.dofLimits(bkLens(bokehState.active), bkCam(), lensState.focusM, bokehState.maxCoc) : null;
    $('dv-leg').innerHTML = !lim ? 'focus closer than the focal length' : `<b>sharp</b> ${fmt(lim.nearM, 2)} to ${Number.isFinite(lim.farM) ? fmt(lim.farM, 2) + ' m' : '∞'}`
      + ` <i class="fg">front</i> <i class="bg">behind</i>`;
  }
}
function setDv(patch) {
  const was = dv.on; Object.assign(dv, patch);
  if (dv.on && dv.auto && (!was || patch.auto)) dvAutoRange();
  dvSave(); dvUI(); render();
}
$('dv-chip').onclick = () => setDv({ on: !dv.on });
$('dv-gray').onclick = () => setDv({ lens: false });
$('dv-lens').onclick = () => setDv({ lens: true });
$('dv-auto').onclick = () => setDv({ auto: true });
for (const [id, k] of [['dv-near', 'near'], ['dv-far', 'far']]) $(id).addEventListener('change', () => {
  const v = +$(id).value; if (!Number.isFinite(v) || v < 0) return;
  const o = { near: dv.near, far: dv.far, [k]: v, auto: false };
  if (o.far > o.near) setDv(o); else dvUI();
});
document.addEventListener('lens-changed', () => { if (dv.on) { dvUI(); render(); } });
window.addEventListener('keydown', e => {
  if ((e.key || '').toLowerCase() !== 'd' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target.matches('textarea, select, input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=file])')) return;
  if (typeof drag !== 'undefined' && drag && drag.action === 'look') return;
  setDv({ on: !dv.on });
});
dvUI();

// ---------- Pases para IA / Nuke (los arma el playblast, frame a frame) ----------
// EXR mínimo: una parte, scanlines sin comprimir, un canal FLOAT. data: W×H, fila 0 arriba.
function exrWrite(W, H, channel, data) {
  const te = new TextEncoder(), parts = [];
  const le = (n, f) => { const b = new DataView(new ArrayBuffer(n)); f(b); return new Uint8Array(b.buffer); };
  const attr = (name, type, v) => { parts.push(te.encode(`${name}\0${type}\0`), le(4, b => b.setInt32(0, v.length, true)), v); };
  const cn = te.encode(channel + '\0');
  attr('channels', 'chlist', new Uint8Array([...cn, ...le(16, b => { b.setInt32(0, 2, true); b.setInt32(8, 1, true); b.setInt32(12, 1, true); }), 0])); // 2 = FLOAT
  attr('compression', 'compression', new Uint8Array([0]));
  const box = le(16, b => { b.setInt32(8, W - 1, true); b.setInt32(12, H - 1, true); });
  attr('dataWindow', 'box2i', box); attr('displayWindow', 'box2i', box);
  attr('lineOrder', 'lineOrder', new Uint8Array([0]));
  attr('pixelAspectRatio', 'float', le(4, b => b.setFloat32(0, 1, true)));
  attr('screenWindowCenter', 'v2f', new Uint8Array(8));
  attr('screenWindowWidth', 'float', le(4, b => b.setFloat32(0, 1, true)));
  const head = parts.reduce((n, p) => n + p.length, 8) + 1, line = 8 + W * 4;
  const out = new Uint8Array(head + H * 8 + H * line), v = new DataView(out.buffer);
  v.setUint32(0, 20000630, true); v.setUint32(4, 2, true); // magic, versión 2 scanline
  let o = 8; for (const p of parts) { out.set(p, o); o += p.length; } out[o++] = 0;
  const data0 = o + H * 8;
  for (let y = 0; y < H; y++) {
    const at = data0 + y * line;
    v.setBigUint64(o + y * 8, BigInt(at), true);
    v.setInt32(at, y, true); v.setInt32(at + 4, W * 4, true);
    new Uint8Array(out.buffer, at + 8, W * 4).set(new Uint8Array(data.buffer, data.byteOffset + y * W * 4, W * 4));
  }
  return out;
}
// gris de 8 bits (v: 0..255 por px) → PNG
async function passPng(W, H, v) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data;
  for (let i = 0, j = 0; i < v.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = v[i]; d[j + 3] = 255; }
  g.putImageData(im, 0, 0);
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await b.arrayBuffer());
}
// zip en Blob a medida que se arma (el navegador baja los Blob grandes a disco)
function passZip() {
  let parts = [], err = null;
  const z = new fflate.Zip((e, d) => { if (e) err = e; else parts.push(d); });
  const flush = () => { if (err) throw err; parts = [new Blob(parts)]; };
  return {
    add(name, u8, deflate) { const f = deflate ? new fflate.ZipDeflate(name, { level: 1 }) : new fflate.ZipPassThrough(name); z.add(f); f.push(u8, true); flush(); },
    end() { z.end(); flush(); return new Blob(parts, { type: 'application/zip' }); },
  };
}
const r6 = v => Number.isFinite(v) ? +v.toFixed(6) : null;
function passCamFrame() {
  camera.updateMatrixWorld();
  const a = camAngles(), p = camera.position, q = camera.quaternion, m = motionAt(tlU()), on = !!ENV_MODULES[env.id];
  const e = on ? envRoot.worldToLocal(p.clone()) : null;
  return {
    frame: tl.frame, time_s: r6((tl.frame - tl.start) / tl.fps), fps: tl.fps,
    focal_mm: r6(focalUsed()), sensor_mm: [r6(st.sw), r6(shUsed())],
    tilt_deg: r6(a.tilt), roll_deg: r6(a.roll), yaw_deg: r6(a.yaw), height_m: r6(p.y),
    position_m: [r6(p.x), r6(p.y), r6(p.z)], quaternion_xyzw: [r6(q.x), r6(q.y), r6(q.z), r6(q.w)],
    kmh: on && env.vals.mon ? r6((env.vals.speed || 0) * m.k) : 0, travelled_m: on && env.vals.mon ? r6(m.d) : 0,
    camera_in_environment_m: e ? [r6(e.x), r6(e.y), r6(e.z)] : null,
  };
}
// un frame: lo que está en la escena ahora (el playblast ya movió el timeline y el video)
async function passFrame(zip, W, H, want, plateEl) {
  const f = tl.frame, num = String(f).padStart(4, '0');
  if (want.depth || want.masks) {
    const { z, envm } = dvRead(W, H), sky = camera.far;
    if (want.depth) {
      const zz = new Float32Array(z.length), g = new Uint8Array(z.length), f1 = 1 / dv.far, k = 255 / Math.max(1 / Math.max(dv.near, 1e-3) - f1, 1e-9);
      for (let i = 0; i < z.length; i++) { const d = z[i], ok = Number.isFinite(d); zz[i] = ok ? d : sky; g[i] = ok ? Math.max(0, Math.min(255, Math.round((1 / d - f1) * k))) : 0; }
      zip.add(`depth/depth.${num}.exr`, exrWrite(W, H, 'Z', zz), true);
      zip.add(`depth_png/depth.${num}.png`, await passPng(W, H, g), false);
    }
    if (want.masks) zip.add(`mask_env/mask_env.${num}.png`, await passPng(W, H, envm), false);
  }
  if (want.masks && plateEl) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(plateEl, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, a = new Uint8Array(W * H), ch = plateEl === $('platekey') && key.view === 'matte' ? 0 : 3; // en Matte el key va en gris
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + ch];
    zip.add(`alpha_plate/alpha_plate.${num}.png`, await passPng(W, H, a), false);
  }
  return passCamFrame();
}
function passReadme(o) {
  const L = [`BackplateLab ${APP_VERSION} passes · ${o.plate} · frames ${o.start}-${o.end} at ${o.fps} fps · ${o.W} x ${o.H} px`, ''];
  L.push(`${o.mp4}  The playblast (beauty): what the viewer showed.`);
  if (o.want.depth) L.push('', 'depth/depth.####.exr  Depth for Nuke: one float channel "Z" (depth.Z in Nuke), uncompressed.',
    '  Meters from the camera along its optical axis (planar depth, not the distance to the lens), the same',
    `  distance the lens math uses. Environment and scan. Sky / nothing = ${o.sky} m (the far clip).`,
    '  Nuke ZDefocus: math "depth", focal plane = the focus distance in camera.json.',
    `depth_png/depth.####.png  Depth for AI tools (8-bit gray, like their depth maps): near = white, far = black,`,
    `  linear in 1 / distance from ${o.near} m (255) to ${o.far} m (0), the range of the Depth view:`,
    `  gray = 255 * (1/d - 1/${o.far}) / (1/${o.near} - 1/${o.far}). Sky = black.`);
  if (o.want.masks) L.push('', 'mask_env/mask_env.####.png  White where the environment (street, sidewalks, facades, cars) is the nearest',
    '  thing in front of the camera. Black: sky, the scan, nothing.',
    'alpha_plate/alpha_plate.####.png  The plate alpha as shown: the chroma key matte when the key is on,',
    '  the alpha of the EXR / PNG otherwise (white = plate kept).');
  if (o.want.cam) L.push('', 'camera.json  The camera, per frame: focal (mm), sensor (mm), tilt / roll / yaw (degrees), height and',
    '  position (m), rotation quaternion, fps, speed (km/h) and distance travelled (m). Y up, the camera looks',
    '  down its -Z (three.js / Nuke axes). The camera stays still and the environment slides past it;',
    '  camera_in_environment_m is the same camera in the coordinates of the street, so a camera moving',
    '  through a still street. lens: T-stop and focus distance of the active lens.');
  return L.join('\n') + '\n';
}
function passCameraJson(o, frames) {
  return JSON.stringify({
    app: 'BackplateLab', version: APP_VERSION, plate: o.plate, image: { width: o.W, height: o.H, plate_width: st.plate.W, plate_height: st.plate.H, pixel_aspect: par() },
    units: { length: 'm', angles: 'deg', focal: 'mm', depth: 'm along the optical axis' }, clip_m: [r6(camera.near), r6(camera.far)],
    lens: { t_stop: lensState.tStop, t_stop_source: bokehState.active === 0 ? (bokehState.setups[0].tSrc || 'default') : 'setup_b', focus_m: lensState.focusM, coc_at_infinity_px: r6(lensCocPx(Infinity)) },
    depth_png: o.want.depth ? { near_m: o.near, far_m: o.far, near_is_white: true, mapping: '255 * (1/d - 1/far) / (1/near - 1/far)' } : null, sky_depth_m: o.sky,
    frames,
  }, null, 1);
}
