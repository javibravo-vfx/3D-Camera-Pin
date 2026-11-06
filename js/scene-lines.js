// scene-lines: escena Car GS sobre el plate (horizonte, grilla de fuga, figuras de escala), las
// herramientas Lines y Figure, los arrastres directos (VP del auto, horizonte, calle), los presets
// Front / Left / Right / Rear y Auto from windows. Todo mueve LA MISMA cámara de la app (camera, st):
// tilt, roll, yaw y altura, como los campos de la barra y los pins. La grilla de piso es la "Home Grid"
// de la app (una sola). Port de DepthLab: OverlayPainter.cpp, BokehViewport.cpp, BokehState (líneas),
// MainWindow::autoAlignFromWindows y SidePanel (Virtual camera, Vanishing lines, Scene overlay).
// API: sceneSt, sceneDrawOverlay, sceneOnDown/Move/Up, sceneHover, sceneDeleteSel, sceneAutoFromWindows,
// sceneSetPose, scenePose, sceneCam.

const sceneSt = {
  show: Object.assign({ horizon: true, vanishing: false, figures: true }, lsGet('scene.show2', {})), // las paredes de fuga (naranjas) arrancan apagadas
  wallM: lsGet('scene.wallM', 8),
  // los ejes prendidos: X transversal, Y vertical, Z a lo largo del auto (al menos uno). 1 VP = Z, 2 VP = Z + X, 3 VP =
  // los tres; también Z + Y, X + Y, X o Y solos
  // en la interfaz, cuatro combinaciones (XYZ, XY, XZ, YZ); Auto from windows usa sólo Z.
  // La app abre siempre en XZ y con Show lines tildado; lo elegido dura la sesión y el proyecto lo guarda
  ax: { x: true, y: false, z: true },
  lines: null, linesFor: '', edited: false, auto: null, solve: null,
  figures: [], nextFig: 1, sel: 0, kind: lsGet('scene.kind', 'person'),
  hover: '', drag: null, busy: false,
  showLines: true, // 2D Camera Match › Show lines
};
// hacia dónde mira la cámara, desde el auto: [clave de los ids, yaw, nombre]. El nombre dice el lado del AUTO (no
// «Camera left» de rodaje, que confunde): la cámara de la toma que mira hacia la derecha del auto ve su lado izquierdo
// y la calle de la derecha detrás; el driving que mira hacia la derecha filma la calle de la derecha.
const SC_LOOKS = [['Front', 0, 'Ahead'], ['Left', 90, 'Car left'], ['Right', -90, 'Car right'], ['Rear', 180, 'Behind']];
// el dibujito del auto visto desde arriba (frente arriba) con la cámara y hacia dónde mira. shot: la cámara de la toma,
// afuera del auto mirándolo; drive: la del driving, sobre su auto mirando afuera
function lookDiagram(svg, yawDeg, kind) {
  if (!svg) return;
  const a = yawDeg * Math.PI / 180, dx = -Math.sin(a), dy = -Math.cos(a), f = (v) => v.toFixed(1);
  const cx = kind === 'drive' ? 22 : 22 - dx * 17, cy = kind === 'drive' ? 22 : 22 - dy * 17, ex = cx + dx * 8, ey = cy + dy * 8;
  const html = `<rect class="car" x="17" y="13" width="10" height="18" rx="3"/><path class="car" d="M18.3 17.5h7.4M18.3 26.5h7.4"/><path class="arr" d="M${f(cx)} ${f(cy)}L${f(ex)} ${f(ey)}"/><circle class="cam" cx="${f(cx)}" cy="${f(cy)}" r="2.6"/><circle class="tip" cx="${f(ex)}" cy="${f(ey)}" r="1.3"/>`;
  if (svg._h !== html) { svg.innerHTML = html; svg._h = html; }
}
// lo que eso quiere decir, en una línea
function lookNote(yawDeg, kind) {
  const k = SC_LOOKS.reduce((b, l) => Math.abs(SceneMath.angleDelta(yawDeg, l[1])) < Math.abs(SceneMath.angleDelta(yawDeg, b[1])) ? l : b)[0];
  const off = Math.abs(SceneMath.angleDelta(yawDeg, SC_LOOKS.find(l => l[0] === k)[1])) > 2 ? ` (nearest; yaw ${yawDeg.toFixed(1)}°)` : '';
  if (kind === 'drive') return { Front: 'Films the street ahead of its car', Left: 'Films the street on the left of its car', Right: 'Films the street on the right of its car', Rear: 'Films the street behind its car' }[k] + off + '.';
  return { Front: 'Looks ahead: sees the back of the car, with the street in front behind it', Left: 'Looks toward the car\'s left: sees its right side, with the street on its left behind it', Right: 'Looks toward the car\'s right: sees its left side, with the street on its right behind it', Rear: 'Looks back: sees the front of the car, with the street behind it' }[k] + off + '.';
}
// nvp (1, 2, 3) y twoVP quedan por compatibilidad (proyectos, botones 1 / 2 / 3 VP): se leen y escriben sobre ax
Object.defineProperty(sceneSt, 'nvp', { get: () => sceneSt.ax.x + sceneSt.ax.y + sceneSt.ax.z, set: (n) => { sceneSt.ax = { x: n >= 2, y: n >= 3, z: true }; } });
Object.defineProperty(sceneSt, 'twoVP', { get: () => sceneSt.ax.x, set: (v) => { sceneSt.ax = { ...sceneSt.ax, x: !!v }; } });
const scOn = (k) => (k === 0 ? sceneSt.ax.z : k === 1 ? sceneSt.ax.x : sceneSt.ax.y); // el par de líneas k (0 Z, 1 X, 2 Y) está prendido
// los tres ejes, en el orden de las líneas: 0-1 a lo largo del auto (Z), 2-3 transversales (X), 4-5 verticales (Y)
const SC_AXES = [{ cls: 'ax', tag: 'Z · along the car' }, { cls: 'cr', tag: 'X · across the car' }, { cls: 'vt', tag: 'Y · vertical' }];
// Rotation (js/cam-move.js) gira los ejes del mundo de a 90°: con un giro impar, el par 0 (que nació como Z) es el X del
// mundo y el par 1 el Z. Los colores, las letras y las combinaciones (XYZ, XY, XZ, YZ) hablan de los ejes del mundo.
const scSwap = () => ((sceneSt.rot90 || 0) & 1) === 1;
const scAx = (k) => SC_AXES[k === 2 ? 2 : scSwap() ? 1 - k : k];
// de los ejes del mundo a los pares de líneas, y al revés (es la misma permutación)
const scWorldToPairs = (a) => scSwap() ? { x: a.z, y: a.y, z: a.x } : a;

// ---------- La cámara de la app vista como la cámara virtual de DepthLab ----------
function sceneIntr() { return { focalMm: focalUsed(), filmWidthMm: st.sw, squeeze: par(), plateW: st.plate.W, plateH: st.plate.H }; }
function scenePose() {
  camera.updateMatrixWorld();
  const a = camAngles(), p = camera.position;
  return { tiltDeg: a.tilt, rollDeg: a.roll, yawDeg: a.yaw, heightM: p.y, xM: p.x, zM: p.z };
}
function sceneCam() { return SceneMath.camera(sceneIntr(), scenePose()); }
// tilt / roll / yaw (Euler YXZ, como camAngles) y altura; la posición x, z no se toca
function sceneSetPose(p, done) {
  const r = Math.PI / 180;
  camera.quaternion.setFromEuler(new THREE.Euler(p.tiltDeg * r, p.yawDeg * r, p.rollDeg * r, 'YXZ'));
  const dy = p.heightM - camera.position.y; camera.position.y += dy; nav.target.y += dy;
  navRetarget(); camera.updateMatrixWorld(true);
  if (done) refreshAll(); else { render(); drawOverlay(); }
}
const scFmt = (v, d = 2) => (+v).toFixed(d);

// ---------- Líneas de fuga (px del plate; 0 y 1 a lo largo del auto, 2 y 3 transversales, 4 y 5 verticales) ----------
function sceneLines() {
  const key = st.plate.name + '|' + st.plate.W + '|' + st.plate.H;
  if (sceneSt.linesFor !== key) { sceneSt.linesFor = key; sceneResetLines(); }
  if (sceneSt.lines.length < 6) sceneSt.lines.push(...scDefaultLines().slice(sceneSt.lines.length)); // proyectos de antes de las verticales
  return sceneSt.lines;
}
function scDefaultLines() {
  const w = st.plate.W, h = st.plate.H;
  // eje del auto: dos líneas que convergen al centro (un pasillo); transversales: una arriba y otra abajo;
  // verticales: una a cada lado (postes, marcos de puerta, esquinas de edificios)
  return [[0.12 * w, 0.88 * h, 0.40 * w, 0.58 * h], [0.88 * w, 0.88 * h, 0.60 * w, 0.58 * h],
    [0.30 * w, 0.30 * h, 0.70 * w, 0.31 * h], [0.25 * w, 0.72 * h, 0.75 * w, 0.70 * h],
    [0.18 * w, 0.22 * h, 0.20 * w, 0.62 * h], [0.82 * w, 0.22 * h, 0.80 * w, 0.62 * h]];
}
function sceneResetLines() {
  sceneSt.lines = scDefaultLines();
  sceneSt.edited = false; sceneSt.auto = null; sceneSt.solve = null; sceneSt.lineKey = ''; // las de arranque se alinean con la vista
}
// ---------- Las líneas siguen a la vista ----------
// Si la cámara cambió por otro lado (los campos de la barra, Reset view, Rotation, pins, otra pestaña), en 2D Camera
// Match cada línea gira sobre su punto medio, con el mismo largo, hasta apuntar a la dirección de su eje en la vista
// actual: las líneas siempre describen la cámara que se ve. Las mueve sólo la cámara; el solve de las líneas no las toca.
function scCamKey() {
  camera.updateMatrixWorld(); const q = camera.quaternion;
  return [q.x, q.y, q.z, q.w, focalUsed(), st.plate.W, st.plate.H, sceneSt.rot90 || 0, par()].map(v => (+v).toFixed(5)).join(',');
}
// la línea i con el medio en (mu, mv) y el largo len, apuntando a la dirección de su eje en la vista actual (la
// misma punta del lado de ref); null si el eje apunta a la cámara o queda detrás
function scLineAt(i, mu, mv, len, ref) {
  const up = new THREE.Vector3(0, 1, 0), k90 = (sceneSt.rot90 || 0) * Math.PI / 2;
  const d = new THREE.Vector3(...[[0, 0, 1], [1, 0, 0], [0, 1, 0]][i >> 1]).applyAxisAngle(up, k90);
  camera.updateMatrixWorld();
  // un punto del rayo del medio de la línea, a 10 m, y ese punto corrido por el eje: la dirección en el plate
  const p = new THREE.Vector3(mu / st.plate.W * 2 - 1, -(mv / st.plate.H * 2 - 1), 0.5).unproject(camera);
  p.sub(camera.position).normalize().multiplyScalar(10).add(camera.position);
  const a = projectWorld(p), b = projectWorld(p.clone().addScaledVector(d, 0.5));
  if (!a.front || !b.front) return null;
  let dx = b.u - a.u, dy = b.v - a.v; const n = Math.hypot(dx, dy);
  if (n < 1e-6) return null; // el eje apunta a la cámara: el VP cae justo ahí
  dx /= n; dy /= n;
  if (dx * (ref[2] - ref[0]) + dy * (ref[3] - ref[1]) < 0) { dx = -dx; dy = -dy; } // la misma punta queda del mismo lado
  return [mu - dx * len / 2, mv - dy * len / 2, mu + dx * len / 2, mv + dy * len / 2];
}
function sceneRealignLines() {
  const L = sceneLines();
  for (let i = 0; i < 6; i++) {
    const l = L[i], n = scLineAt(i, (l[0] + l[2]) / 2, (l[1] + l[3]) / 2, Math.hypot(l[2] - l[0], l[3] - l[1]), l);
    if (n) L[i] = n;
  }
}
function sceneFollowView() {
  if (!scLinesOnly() || st.plate.empty || sceneSt.drag || sceneSt.solving) return;
  const k = scCamKey(); if (k === sceneSt.lineKey) return;
  sceneSt.lineKey = k; sceneRealignLines();
}
// yawHint: hacia dónde elegir entre las dos soluciones de yaw (frente / atrás); sin él, la más cercana a la actual
function sceneSolveLines(yawHint) {
  sceneSt.solving = true;
  try { return scSolve(yawHint); } finally { sceneSt.solving = false; sceneSt.lineKey = scCamKey(); }
}
function scSolve(yawHint) {
  // Rotation (js/cam-move.js) gira los ejes de a 90°: las líneas se resuelven en el marco sin girar y se le suma el giro
  const k90 = (sceneSt.rot90 || 0) * 90, pose0 = scenePose();
  const L = sceneLines(), intr = sceneIntr(), pose = { ...pose0, yawDeg: SceneMath.angleDelta(pose0.yawDeg - k90, 0) };
  if (yawHint != null) yawHint = SceneMath.angleDelta(yawHint - k90, 0);
  const A = sceneSt.ax, vpOf = (k) => SceneMath.intersectLines(L[2 * k], L[2 * k + 1]);
  const vpZ = A.z ? vpOf(0) : null, vpX = A.x ? vpOf(1) : null, vpY = A.y ? vpOf(2) : null;
  // el eje horizontal de base es Z; sin Z, X hace de Z con el yaw corrido 90° (X mira donde Z miraría con yaw - 90°)
  const base = A.z ? vpZ : vpX, off = A.z ? 0 : 90, F = st.freeF ? 0 : focalUsed();
  const pb = { ...pose, yawDeg: SceneMath.angleDelta(pose.yawDeg - off, 0) }, hb = yawHint == null ? pb : { ...pb, yawDeg: SceneMath.angleDelta(yawHint - off, 0) };
  let s;
  if (A.z && !vpZ) s = { ok: false, error: 'The car axis lines (Z) are parallel: tilt them towards their vanishing point' };
  else if (A.x && !vpX) s = { ok: false, error: 'The cross lines (X) are parallel: they need a vanishing point' };
  else if (A.y && !vpY) s = { ok: false, error: 'The vertical lines (Y) are parallel: tilt them towards their vanishing point' };
  else if (st.lockTR) { // Keep tilt (= Lock tilt/roll de la app): sólo un eje horizontal da el yaw
    s = base ? SceneMath.solveOneVP(intr, hb, base, true) : { ok: false, error: 'Keep tilt with only the vertical lines (Y): nothing to solve. Turn on X or Z, or untick Keep tilt.' };
  } else if (A.y && base) s = SceneMath.solveThreeVP(intr, pb, base, A.z && A.x ? vpX : null, vpY, F); // con la vertical: Z + Y, X + Y o los tres
  else if (A.z && A.x) s = SceneMath.solveTwoVP(intr, pb, vpZ, vpX, F); // Lock focal: la focal queda
  else if (base) s = SceneMath.solveOneVP(intr, hb, base, false);
  else s = SceneMath.solveVerticalVP(intr, pose, vpY); // sólo Y: tilt y roll
  if (s.ok && base) s.pose = { ...s.pose, yawDeg: SceneMath.angleDelta(s.pose.yawDeg + off, 0) };
  if (s.ok && k90) s.pose = { ...s.pose, yawDeg: SceneMath.angleDelta(s.pose.yawDeg + k90, 0) };
  sceneSt.solve = s;
  if (!s.ok) { drawOverlay(); return s; }
  if (sceneSt.nvp >= 2 && !st.lockTR && st.freeF && s.focalMm > 0) { st.fScale = s.focalMm / st.focal; applyIntrinsics(); }
  sceneSetPose({ ...s.pose, heightM: pose.heightM }, false);
  s.after = { ...scenePose(), focal: focalUsed() }; // para saber si después la cámara se movió por otro lado
  sceneMarkYaw();
  return s;
}
// El yaw que eligió el usuario (Looks to, campo YAW, arrastre del VP, líneas, pins, proyecto). Sirve
// mientras la cámara siga ahí: el yaw de arranque (33,7°, la vista de la app vacía) no dice nada del plate.
function sceneMarkYaw() { sceneSt.yawUser = scenePose().yawDeg; }
function sceneYawIsSet() {
  if (st.solved && st.pins.length >= 2) return true;
  return sceneSt.yawUser != null && Math.abs(SceneMath.angleDelta(scenePose().yawDeg, sceneSt.yawUser)) < 0.5;
}
function sceneSetAxes(a) {
  const ax = { x: !!a.x, y: !!a.y, z: a.z !== false };
  if (!ax.x && !ax.y && !ax.z) { toast('At least one axis stays on'); return; }
  sceneSt.ax = ax; if (sceneSt.edited) sceneSolveLines(); refreshAll();
}
function sceneSetNVP(n) { sceneSetAxes({ x: n >= 2, y: n >= 3, z: true }); }

// ---------- Auto from windows ----------
let scHalf = null;
function scHalfLUT() {
  if (scHalf) return scHalf;
  scHalf = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const s = i & 0x8000 ? -1 : 1, e = (i >> 10) & 31, m = i & 1023;
    scHalf[i] = e === 0 ? s * Math.pow(2, -14) * m / 1024 : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024);
  }
  return scHalf;
}
// agujero del plate en px de display: alpha < 0.5 si el EXR trae alpha; si no, el verde (g domina)
function sceneHoleSampler() {
  if (exrState && exrState.px && exrState.px.hasRGB) {
    const px = exrState.px, d = px.data, sd = px.stride, lut = scHalfLUT();
    const disp = exrState.h.get('displayWindow') || px.dw, ox = px.dw.xMin - disp.xMin, oy = px.dw.yMin - disp.yMin;
    const useAlpha = (exrState.h.get('channels') || []).some(c => c.name === 'A') && sd >= 4;
    // px del plate -> px del EXR (el de referencia de un video puede tener otro tamaño)
    const kx = (disp.xMax - disp.xMin + 1) / st.plate.W, ky = (disp.yMax - disp.yMin + 1) / st.plate.H;
    return { useAlpha, isHole: (x, y) => {
      const xx = Math.floor(x * kx) - ox, yy = Math.floor(y * ky) - oy;
      if (xx < 0 || yy < 0 || xx >= px.w || yy >= px.h) return false;
      const i = ((px.h - 1 - yy) * px.w + xx) * sd; // EXRLoader guarda las filas de abajo hacia arriba
      if (useAlpha) return lut[d[i + 3]] < 0.5;
      const r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
      return g > 0.02 && g > 1.25 * r && g > 1.25 * b;
    } };
  }
  const src = typeof keySource === 'function' ? keySource() : null;
  if (!src || !src.width) return null;
  const d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data, w = src.width, kx = w / st.plate.W, ky = src.height / st.plate.H;
  // shortcut: verde en valores de display (1.1 en vez del 1.25 lineal), alcanza para JPG / PNG de croma
  return { useAlpha: false, isHole: (x, y) => { const i = (Math.floor(y * ky) * w + Math.floor(x * kx)) * 4; return d[i + 1] > 5 && d[i + 1] > 1.1 * d[i] && d[i + 1] > 1.1 * d[i + 2]; } };
}
function sceneFindAxis(job) {
  return new Promise((resolve) => {
    let w = null;
    try { w = new Worker('js/scene-worker.js'); } catch (e) { w = null; }
    const inline = () => setTimeout(() => resolve(SceneMath.findAxisVanishingPoint(SceneMath.maskEdgeSegments(job.mask), job.W, job.H, job.horizon, job.prior)), 0);
    if (!w) return inline();
    w.onmessage = (e) => { w.terminate(); resolve(e.data); };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); inline(); };
    w.postMessage(job);
  });
}
// por qué no alcanzó, en palabras (lo mide findAxisVanishingPoint)
function sceneAutoWhy(found, c) {
  if (found.sideLen > 0.25 * st.plate.W) return '. The window edges run almost parallel to the horizon (a side view): their vanishing point is far outside the frame, where a tenth of a degree of edge moves the yaw by degrees. Pick Looks to › Left or Right and drag the VP car marker or the lines by hand.';
  if (!found.vpSpread) return '';
  const yaw = (p) => { const s = SceneMath.solveOneVP(sceneIntr(), c.pose, p, true); return s.ok ? Math.round(s.pose.yawDeg) : null; };
  const [a, b] = found.vpSpread.map(yaw);
  return a === null || b === null || a === b ? '' : `. The edges point at different vanishing points (yaw ${a}° to ${b}°): in a 3/4 view the window frames do not run parallel to the car. Put the two lines by hand on the lower edges (sills) of the side windows.`;
}
async function sceneAutoFromWindows() {
  if (sceneSt.busy) return null;
  if (st.plate.empty) { toast('Auto from windows: open a plate first', true); return null; }
  const src = sceneHoleSampler();
  if (!src) { toast('Auto from windows needs the plate pixels (EXR, JPG or PNG)', true); return null; }
  sceneSt.busy = true; sceneUI(); setBusy(true, 'Finding the window edges…');
  await new Promise(r => setTimeout(r, 20));
  let msg;
  try {
    const W = st.plate.W, H = st.plate.H, mask = SceneMath.holeMask(W, H, src.isHole);
    // el VP del eje del auto donde lo pone el yaw actual (el sentido que queda delante de la cámara),
    // sólo si ese yaw lo eligió el usuario
    const c = sceneCam(), userYaw = sceneYawIsSet();
    const prior = userYaw ? c.vanishingPoint([0, 0, 1]) || c.vanishingPoint([0, 0, -1]) : null;
    const found = await sceneFindAxis({ mask, W, H, horizon: c.horizon(), prior });
    sceneLines();
    sceneSt.auto = { segments: found.segments, inlier: found.inlier };
    const what = src.useAlpha ? 'alpha' : 'green';
    if (!found.ok) {
      msg = `Auto from windows (${what}): ${found.error}` + sceneAutoWhy(found, c);
      sceneSt.solve = { ok: false, error: found.error, detail: msg }; // el visor muestra el corto; el panel y el aviso, el porqué
    } else {
      pushHistory();
      sceneSt.lines[0] = found.lines[0]; sceneSt.lines[1] = found.lines[1];
      sceneSt.ax = { x: false, y: false, z: true }; sceneSt.edited = true;
      // Las dos soluciones (yaw y yaw + 180) ponen el VP y el horizonte en el mismo px: la imagen no
      // dice si la cámara mira hacia la cola o hacia la trompa. Con un yaw elegido, ese lado; si no,
      // la cola: la toma habitual de un auto de croma es a los actores, de frente, por el parabrisas.
      sceneSolveLines(userYaw ? null : 180);
      const p = scenePose(), rear = Math.abs(p.yawDeg) > 90;
      const why = userYaw ? `kept the side of the yaw you set (${rear ? 'rear' : 'front'})`
        : 'facing the car rear: no yaw was set, so it takes the usual shot of the actors through the windshield (for the other way pick Looks to › Front and run it again)';
      msg = `Auto from windows (${what}): ${found.horizonLine ? found.inlierCount + ' (+ horizon)' : found.inlierCount} of ${found.segmentCount} edges meet at ${Math.round(found.vp[0])}, ${Math.round(found.vp[1])} px (${scFmt(found.rmsAngleDeg)}° spread) · yaw ${scFmt(p.yawDeg)}°, tilt ${scFmt(p.tiltDeg)}° · ${why}`;
    }
    sceneSt.lastAuto = { ...found, message: msg };
    setMode('lines');
    toast(msg, !found.ok);
  } finally { sceneSt.busy = false; setBusy(false); refreshAll(); }
  return msg;
}

// ---------- Figuras ----------
// el icono de cada figura, con su mismo contorno (24 x 24, parada en el piso)
function scFigIcon(kind) {
  const f = SceneMath.figureSpec(kind), k = 18 / Math.max(f.w, f.h), w = f.w * k, h = f.h * k, x0 = 12 - w / 2, y0 = 21;
  return `<svg viewBox="0 0 24 24" class="figico"><polygon points="${f.outline.map(([u, v]) => `${(x0 + u * w).toFixed(1)},${(y0 - v * h).toFixed(1)}`).join(' ')}"/></svg>`;
}
function scFigToolIcon() {
  const t = $('m-figure'); if (!t) return;
  const f = SceneMath.figureSpec(sceneSt.kind), old = t.querySelector('svg');
  if (old && old.dataset.k === sceneSt.kind) return;
  const tmp = document.createElement('span'); tmp.innerHTML = scFigIcon(sceneSt.kind); const svg = tmp.firstChild; svg.dataset.k = sceneSt.kind;
  if (old) old.replaceWith(svg); else t.prepend(svg);
  t.title = `Figure (S): click below the horizon to stand a ${f.name.toLowerCase()} on the road. Hold (or right click) to pick another figure.`;
}
function scFigKind(k) { sceneSt.kind = k; lsSet('scene.kind', k); scFigToolIcon(); setMode('figure'); }
function sceneAddFigure(uv) {
  const g = sceneCam().groundPoint(uv);
  if (!g) { toast('Click below the horizon: figures stand on the road'); return null; }
  const f = { id: sceneSt.nextFig++, kind: sceneSt.kind, xM: g[0], zM: g[2] };
  sceneSt.figures.push(f); sceneSt.sel = f.id;
  toast(`${SceneMath.figureSpec(f.kind).name} placed ${scFmt(sceneCam().depth([f.xM, 0, f.zM]), 1)} m from the camera`);
  drawOverlay();
  return f;
}
function sceneDeleteSel() {
  const i = sceneSt.figures.findIndex(f => f.id === sceneSt.sel);
  if (i < 0) return false;
  sceneSt.figures.splice(i, 1); sceneSt.sel = 0; drawOverlay();
  return true;
}

// ---------- Hit tests (coordenadas del visor) ----------
const scToVp = (p) => uvToVp(p[0], p[1]);
// 2D Camera Match (js/module-tabs.js), como Perspective Match de 3ds Max: sólo las líneas de fuga
const scLinesOnly = () => typeof mtabCur !== 'undefined' && mtabCur === 'match';
function scFigHit(c, x, y) {
  for (let i = sceneSt.figures.length - 1; i >= 0; i--) {
    const q = SceneMath.figureQuad(c, sceneSt.figures[i]); if (!q) continue;
    const pts = q.map(scToVp), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    if (x > Math.min(...xs) - 6 && x < Math.max(...xs) + 6 && y > Math.min(...ys) - 6 && y < Math.max(...ys) + 6) return { type: 'fig', id: sceneSt.figures[i].id };
  }
  return null;
}
function sceneHit(x, y) {
  const mode = st.mode, c = sceneCam();
  // sin plate, sólo las figuras (se ven y se mueven igual en el visor 3D)
  if (st.plate.empty) return sceneSt.show.figures && (mode === 'nav' || mode === 'figure') ? scFigHit(c, x, y) : null;
  if (scLinesOnly() && mode === 'lines') { // las puntas de las líneas y, si no, el cuerpo (se corre sin girar)
    if (!sceneSt.showLines) return null;
    const L = sceneLines(); let best = null, bd = 9;
    for (let i = 0; i < 6; i++) if (scOn(i >> 1)) for (let e = 0; e < 2; e++) {
      const q = scToVp([L[i][e * 2], L[i][e * 2 + 1]]), dd = Math.hypot(q[0] - x, q[1] - y);
      if (dd < bd) { bd = dd; best = { type: 'handle', i, e }; }
    }
    if (best) return best;
    bd = 6;
    for (let i = 0; i < 6; i++) if (scOn(i >> 1)) {
      const a = scToVp([L[i][0], L[i][1]]), b = scToVp([L[i][2], L[i][3]]), lx = b[0] - a[0], ly = b[1] - a[1], l2 = lx * lx + ly * ly;
      if (l2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * lx + (y - a[1]) * ly) / l2)), dd = Math.hypot(a[0] + lx * t - x, a[1] + ly * t - y);
      if (dd < bd) { bd = dd; best = { type: 'body', i }; }
    }
    return best;
  }
  if (mode !== 'nav' && mode !== 'lines' && mode !== 'figure') return null;
  const [u, v] = vpToUv(x, y), inside = u >= 0 && v >= 0 && u <= st.plate.W && v <= st.plate.H;
  // el marcador del VP gana a las puntas de las líneas: Auto from windows deja una punta justo encima
  if (sceneSt.show.vanishing && mode !== 'figure') {
    for (const d of [[0, 0, -1], [0, 0, 1]]) { const p = c.vanishingPoint(d); if (p) { const q = scToVp(p); if (Math.hypot(q[0] - x, q[1] - y) < 12) return { type: 'vp' }; } }
  }
  if (mode === 'lines') {
    const L = sceneLines(); let best = null, bd = 9;
    for (let i = 0; i < 6; i++) if (scOn(i >> 1)) for (let e = 0; e < 2; e++) {
      const q = scToVp([L[i][e * 2], L[i][e * 2 + 1]]), dd = Math.hypot(q[0] - x, q[1] - y);
      if (dd < bd) { bd = dd; best = { type: 'handle', i, e }; }
    }
    if (best) return best;
  }
  if (sceneSt.show.figures) { const f = scFigHit(c, x, y); if (f) return f; }
  if (!inside) return null;
  if (sceneSt.show.horizon && !st.lockTR && mode !== 'figure') {
    const h = c.horizon();
    if (h) {
      const a = scToVp([h[0], h[1]]), b = scToVp([h[2], h[3]]), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 1 && Math.abs(((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / L) < 6) return { type: 'horizon' };
    }
  }
  // la calle debajo del horizonte fija la altura: en 3D Camera Pin con Navigate (salvo Game)
  if ((mode === 'lines' || (mode === 'nav' && navPreset !== 'game' && sceneSt.show.horizon)) && c.groundPoint([u, v])) return { type: 'ground' };
  return null;
}
const scHoverKey = (h) => !h ? '' : h.type === 'handle' ? `h${h.i * 2 + h.e}` : h.type === 'fig' ? `f${h.id}` : h.type;

// ---------- Ratón (lo llama interaction.js) ----------
// true si el evento es de la escena: un agarre o un clic de las herramientas Lines / Figure
function sceneOnDown(e, x, y) {
  const plain = e.button === 0 && !e.altKey && !e.ctrlKey && !e.shiftKey && !spaceDown;
  if (!plain) return false;
  const hit = sceneHit(x, y), [u, v] = vpToUv(x, y);
  if (hit) {
    const c = sceneCam();
    if (hit.type === 'fig') {
      sceneSt.sel = hit.id;
      const f = sceneSt.figures.find(o => o.id === hit.id), g = c.groundPoint([u, v]);
      // agarrada por encima del horizonte no hay punto de piso: se arrastra desde la base
      sceneSt.drag = { type: 'fig', id: hit.id, off: g ? [f.xM - g[0], f.zM - g[2]] : [0, 0] };
      drawOverlay();
      return true;
    }
    pushHistory(); // Ctrl+Z vuelve la cámara de antes del arrastre
    sceneSt.drag = { ...hit, grab: hit.type === 'ground' ? c.groundPoint([u, v]) : null };
    if (hit.type === 'body') { const l = sceneSt.lines[hit.i]; sceneSt.drag.off = [(l[0] + l[2]) / 2 - u, (l[1] + l[3]) / 2 - v]; }
    return true;
  }
  if (st.mode === 'figure') { sceneSt.sel = 0; sceneAddFigure([u, v]); return true; }
  if (st.mode === 'lines') { sceneSt.sel = 0; drawOverlay(); return true; }
  return false;
}
function sceneOnMove(x, y) {
  const d = sceneSt.drag; if (!d) return;
  const uv = vpToUv(x, y), intr = sceneIntr(), pose = scenePose();
  if (d.type === 'body') {
    // la línea se corre por el espacio sin girar: en su lugar nuevo apunta otra vez a su punto de fuga; la cámara no cambia
    const l = sceneSt.lines[d.i], mu = uv[0] + d.off[0], mv = uv[1] + d.off[1], len = Math.hypot(l[2] - l[0], l[3] - l[1]);
    sceneSt.lines[d.i] = scLineAt(d.i, mu, mv, len, l) || [mu - (l[2] - l[0]) / 2, mv - (l[3] - l[1]) / 2, mu + (l[2] - l[0]) / 2, mv + (l[3] - l[1]) / 2];
    drawOverlay();
  } else if (d.type === 'handle') {
    const l = sceneSt.lines[d.i].slice(); l[d.e * 2] = uv[0]; l[d.e * 2 + 1] = uv[1];
    if (Math.hypot(l[2] - l[0], l[3] - l[1]) > 1) { sceneSt.lines[d.i] = l; sceneSt.edited = true; sceneSolveLines(); } // largo cero: sin dirección
  } else if (d.type === 'vp') {
    // el VP del eje del auto va al cursor (con Keep tilt sólo el yaw: el punto corre por el horizonte)
    const s = SceneMath.solveOneVP(intr, pose, uv, !!st.lockTR);
    if (s.ok) { sceneSetPose(s.pose, false); sceneMarkYaw(); }
  } else if (d.type === 'horizon') {
    const t = SceneMath.tiltForHorizonThrough(intr, pose, uv);
    if (t !== null) sceneSetPose({ ...pose, tiltDeg: t }, false);
  } else if (d.type === 'ground') {
    const h = d.grab && SceneMath.heightKeepingGroundPoint(intr, pose, d.grab, uv);
    if (h) sceneSetPose({ ...pose, heightM: h }, false);
  } else if (d.type === 'fig') {
    const g = sceneCam().groundPoint(uv), f = sceneSt.figures.find(o => o.id === d.id);
    if (g && f) { f.xM = g[0] + d.off[0]; f.zM = g[2] + d.off[1]; drawOverlay(); }
  }
}
function sceneOnUp() {
  const d = sceneSt.drag; if (!d) return;
  sceneSt.drag = null;
  const p = scenePose();
  if (d.type === 'vp' || d.type === 'horizon') toast(`Camera yaw ${scFmt(p.yawDeg, 1)}°, tilt ${scFmt(p.tiltDeg, 1)}°`);
  else if (d.type === 'ground') toast(`Camera ${scFmt(p.heightM)} m above the road`);
  refreshAll();
}
function sceneHover(x, y) {
  const h = sceneHit(x, y), k = scHoverKey(h);
  vp.style.cursor = !h ? (st.mode === 'lines' || st.mode === 'figure' || st.mode === 'slate' ? 'crosshair' : '') : h.type === 'horizon' || h.type === 'ground' ? 'ns-resize' : 'move';
  if (k !== sceneSt.hover) { sceneSt.hover = k; sceneDrawOverlay(); }
}

// ---------- Overlay (SVG en coordenadas del visor; lo llama drawOverlay) ----------
function scClip(l, r) { // Liang-Barsky: una proyección pegada al plano cercano puede quedar a millones de px
  let t0 = 0, t1 = 1; const dx = l[2] - l[0], dy = l[3] - l[1];
  const p = [-dx, dx, -dy, dy], q = [l[0] - r[0], r[2] - l[0], l[1] - r[1], r[3] - l[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [l[0] + dx * t0, l[1] + dy * t0, l[0] + dx * t1, l[1] + dy * t1];
}
const scEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const scTag = (x, y, text, cls = '', anchor = 'start') => `<text class="sc-tag ${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${scEsc(text)}</text>`;
const scM = (l) => `M${l[0].toFixed(1)} ${l[1].toFixed(1)}L${l[2].toFixed(1)} ${l[3].toFixed(1)}`;
// rótulo del horizonte: arriba de la línea a la izquierda; si pisa un rótulo del bokeh (FG / FOCUS / BG),
// abajo, o en la otra punta, y si no hay lugar, la versión corta. bkDrawLayer vuelve a llamar a
// sceneDrawOverlay si sus rótulos lo pisan.
let sceneHzBox = null;
const scMeasure = document.createElement('canvas').getContext('2d');
function scHzSpot(l, texts) {
  const fs = 1.15 * parseFloat(getComputedStyle(document.documentElement).fontSize); // .sc-tag: 1.15rem
  scMeasure.font = `600 ${fs}px ${getComputedStyle(document.documentElement).getPropertyValue('--f-ui')}`;
  const busy = [...document.querySelectorAll('#bk-ov rect[rx="3"]')].map(e => ({ x: +e.getAttribute('x'), y: +e.getAttribute('y'), w: +e.getAttribute('width'), h: +e.getAttribute('height') }));
  const hit = (b) => busy.some(r => b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h);
  const spots = texts.flatMap(text => { const w = scMeasure.measureText(text).width + 4;
    return [[l[0] + 10, l[1] - 8, 'start'], [l[0] + 10, l[1] + fs + 6, 'start'], [l[2] - 10, l[3] - 8, 'end'], [l[2] - 10, l[3] + fs + 6, 'end']]
      .map(([x, y, anchor]) => ({ text, x, y, anchor, box: { x: anchor === 'end' ? x - w : x, y: y - fs, w, h: fs * 1.3 } })); });
  // que entre en el largo de la línea (el ancho del plate en el visor): en un visor chico, la versión corta
  const inLine = (b) => b.x >= Math.min(l[0], l[2]) - 2 && b.x + b.w <= Math.max(l[0], l[2]) + 2;
  const s = spots.find(p => !hit(p.box) && inLine(p.box)) || spots.find(p => inLine(p.box)) || spots.find(p => !hit(p.box)) || spots[0];
  sceneHzBox = s.box;
  return s;
}
// Con una avenida con edificios a la vista, la grilla de fuga se arma sobre sus fachadas, en el marco de la
// calle (ghStreet, js/ghost.js): con «Facades at» a 8 m y las fachadas a ~12 m se veían dos paredes que no
// coincidían. null sin avenida: la grilla vuelve a «Facades at», a lo largo del eje del auto.
function sceneAvenueWalls() {
  // al cargar la página, el car pack puede llegar (y redibujar) antes de que corra js/ghost.js
  if (env.id !== 'avenue' || !ENV_MODULES.avenue || !envRoot.visible || !env.vals.buildings || typeof ghStreet !== 'function') return null;
  const L = avenueLayout(env.vals);
  return { faceX: L.faceX, walkY: L.walkY, S: ghStreet() };
}
function sceneDrawOverlay() {
  const el = $('scene-ov'); if (!el) return;
  sceneFollowView();
  sceneHzBox = null;
  sceneUI();
  // sin plate, sólo las figuras: en el visor 3D se ven igual, paradas en el piso (el resto mide contra el plate)
  const noPlate = st.plate.empty;
  const c = sceneCam(), out = [], W = st.plate.W, H = st.plate.H;
  const [px0, py0] = uvToVp(0, 0), [px1, py1] = uvToVp(W, H);
  const R = [Math.max(px0, -2), Math.max(py0, -2), Math.min(px1, vp.clientWidth + 2), Math.min(py1, vp.clientHeight + 2)];
  const inR = (q) => q[0] >= R[0] - 1 && q[0] <= R[2] + 1 && q[1] >= R[1] - 1 && q[1] <= R[3] + 1;
  const vpLine = (l) => l && scClip([...scToVp([l[0], l[1]]), ...scToVp([l[2], l[3]])], R);
  const world = (a, b) => vpLine(c.projectSegment(a, b));
  const fade = (dm) => Math.min(1, Math.max(0.18, 12 / Math.max(1, dm)));
  const eye = c.position, LONG = 150, WALL_H = 12, only = scLinesOnly();

  if (sceneSt.show.vanishing && !noPlate) { // Walls: también en 2D Camera Match, si se prende
    // dos fachadas a lo largo del eje del auto: una línea por metro de alto y verticales cada 5 m. Con una
    // avenida con edificios, las paredes van sobre sus fachadas (las mismas del fantasma)
    let major = '', minor = '';
    const aw = sceneAvenueWalls();
    for (const side of [-1, 1]) {
      const x = aw ? aw.faceX(side) : side * sceneSt.wallM, y0 = aw ? aw.walkY(side) : 0;
      const P = aw ? (a, h, z) => { const v = new THREE.Vector3(a, y0 + h, z).applyMatrix4(aw.S); return [v.x, v.y, v.z]; } : (a, h, z) => [a, h, z];
      for (let h = 0; h <= WALL_H; h++) { const l = world(P(x, h, -LONG), P(x, h, LONG)); if (l) { if (h % 3 === 0) major += scM(l); else minor += scM(l); } }
      for (let z = -LONG; z <= LONG; z += 5) {
        const a = P(x, 0, z), l = world(a, P(x, WALL_H, z));
        if (l) out.push(`<path class="sc-vg" d="${scM(l)}" stroke-opacity="${(0.45 * fade(Math.hypot(a[2] - eye[2], a[0] - eye[0]))).toFixed(2)}"/>`);
      }
    }
    out.push(`<path class="sc-vg maj" d="${major}"/><path class="sc-vg" d="${minor}"/>`);
    for (const [d, label] of [[[0, 0, -1], 'VP car front'], [[0, 0, 1], 'VP car rear'], [[-1, 0, 0], 'VP left'], [[1, 0, 0], 'VP right']]) {
      const p = c.vanishingPoint(d); if (!p) continue;
      const q = scToVp(p); if (!inR(q)) continue;
      const hot = d[0] === 0 && (sceneSt.hover === 'vp' || (sceneSt.drag && sceneSt.drag.type === 'vp')), r = hot ? 10 : 7;
      out.push(`<g class="sc-vp${hot ? ' hot' : ''}${d[0] === 0 ? ' car' : ''}"><circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${r}"/>`
        + `<path d="M${(q[0] - 12).toFixed(1)} ${q[1].toFixed(1)}h24M${q[0].toFixed(1)} ${(q[1] - 12).toFixed(1)}v24"/></g>`
        + scTag(q[0] + 12, q[1] + 20, label, 'vg'));
    }
    // con la avenida, la grilla converge en el punto de fuga de la calle, que no es el del auto si la calle está
    // rotada (Environment › Rotation): se marca, sin manija (el yaw se arrastra desde VP car). Con el fantasma
    // prendido lo marca él (js/ghost.js)
    if (aw && !(typeof gh !== 'undefined' && gh.on)) for (const dz of [-1, 1]) {
      const d = new THREE.Vector3(0, 0, dz).transformDirection(aw.S), p = c.vanishingPoint([d.x, d.y, d.z]); if (!p) continue;
      const q = scToVp(p); if (!inR(q)) continue;
      out.push(`<g class="sc-vp street"><circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="5"/></g>` + scTag(q[0] + 10, q[1] + 20, 'VP street', 'vg'));
    }
  }

  if (sceneSt.show.horizon && !noPlate) { // en 2D Camera Match se ve (se prende y apaga con su icono) pero no se arrastra
    const h = c.horizon();
    if (h) {
      const l = vpLine(h);
      if (l) {
        const hot = sceneSt.hover === 'horizon' || (sceneSt.drag && sceneSt.drag.type === 'horizon');
        out.push(`<path class="sc-halo" d="${scM(l)}"/><path class="sc-hz${hot ? ' hot' : ''}" d="${scM(l)}"/>`);
        const at = scHzSpot(l, [`HORIZON · camera ${scFmt(eye[1])} m above the road`, `HORIZON · ${scFmt(eye[1])} m`]);
        out.push(scTag(at.x, at.y, at.text, 'hz', at.anchor));
      } else {
        const above = (h[1] + h[3]) / 2 < 0;
        out.push(scTag(R[0] + 10, above ? R[1] + 20 : R[3] - 12, `Horizon ${above ? 'above' : 'below'} frame`, 'hz'));
      }
    }
  }

  if (sceneSt.show.figures) {
    const coc = typeof lensCocPx === 'function' ? lensCocPx : null; // blur del agente de bokeh, si está
    for (const f of sceneSt.figures) {
      const q = SceneMath.figureQuad(c, f); if (!q) continue;
      const s = SceneMath.figureSpec(f.kind), sel = f.id === sceneSt.sel;
      const pts = s.outline.map(o => scToVp(SceneMath.bilinear(q, o[0], o[1])).map(v => v.toFixed(1)).join(',')).join(' ');
      out.push(`<polygon class="sc-fig${sel ? ' sel' : ''}" points="${pts}"/>`);
      const depth = c.depth([f.xM, s.h / 2, f.zM]);
      const hb = SceneMath.bilinear(q, 0.5, 0), ht = SceneMath.bilinear(q, 0.5, 1), tallPx = Math.hypot(ht[0] - hb[0], ht[1] - hb[1]);
      const blur = coc ? coc(depth) : NaN;
      const top = scToVp(ht), ly = Math.max(top[1] - 26, R[1] + 16);
      out.push(scTag(top[0], ly, `${s.name}  ${scFmt(depth, 1)} m`, 'fig' + (sel ? ' sel' : ''), 'middle'));
      out.push(scTag(top[0], ly + 16, `${Math.round(tallPx)} px tall` + (Number.isFinite(blur) ? ` · ${blur < 10 ? scFmt(blur, 1) : Math.round(blur)} px blur` : ''), 'sub', 'middle'));
    }
  }

  if (!noPlate && (scLinesOnly() ? sceneSt.showLines : st.mode === 'lines')) { // en 2D Camera Match, con cualquier herramienta (Figure, Measure…)
    const L = sceneLines();
    if (sceneSt.auto) sceneSt.auto.segments.forEach((sg, i) => { const l = vpLine(sg); if (l) out.push(`<path class="sc-auto${sceneSt.auto.inlier[i] ? ' in' : ''}" d="${scM(l)}"/>`); });
    const vps = SC_AXES.map((x, k) => scOn(k) ? SceneMath.intersectLines(L[2 * k], L[2 * k + 1]) : null);
    for (let i = 0; i < 6; i++) {
      if (!scOn(i >> 1)) continue;
      const cls = scAx(i >> 1).cls, a = scToVp([L[i][0], L[i][1]]), b = scToVp([L[i][2], L[i][3]]), vpt = vps[i >> 1];
      if (vpt) { // prolongación punteada hasta el punto de fuga, como en fSpy
        const v = scToVp(vpt), near = Math.hypot(a[0] - v[0], a[1] - v[1]) < Math.hypot(b[0] - v[0], b[1] - v[1]) ? a : b;
        const ext = scClip([...near, ...v], R); if (ext) out.push(`<path class="sc-ext ${cls}" d="${scM(ext)}"/>`);
      }
      out.push(`<path class="sc-halo" d="${scM([...a, ...b])}"/><path class="sc-ln ${cls}" d="${scM([...a, ...b])}"/>`);
      [a, b].forEach((p, e) => { const hot = sceneSt.hover === `h${i * 2 + e}`; out.push(`<circle class="sc-hd ${cls}${hot ? ' hot' : ''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${hot ? 7 : 5.5}"/>`); });
      if (!(i & 1)) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; out.push(scTag(m[0] + 10, m[1] - 8, scAx(i >> 1).tag, 'ln ' + cls)); } // el eje de cada par
    }
    vps.forEach((p, k) => {
      if (!p) return; const q = scToVp(p); if (!inR(q)) return;
      out.push(`<path class="sc-halo" d="M${q[0] - 9} ${q[1] - 9}l18 18M${q[0] - 9} ${q[1] + 9}l18 -18"/><path class="sc-x ${scAx(k).cls}" d="M${q[0] - 9} ${q[1] - 9}l18 18M${q[0] - 9} ${q[1] + 9}l18 -18"/>`);
    });
    if (sceneSt.solve && !sceneSt.solve.ok && sceneSt.solve.error) { // donde no pise los rótulos del bokeh (FG, FOCUS, BG) ni el del horizonte
      const t = sceneSt.solve.error, x = (R[0] + R[2]) / 2, fs = 1.15 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      scMeasure.font = `600 ${fs}px ${getComputedStyle(document.documentElement).getPropertyValue('--f-ui')}`;
      const w = scMeasure.measureText(t).width + 8;
      const busy = [...document.querySelectorAll('#bk-ov rect[rx="3"]')].map(e => ({ x: +e.getAttribute('x'), y: +e.getAttribute('y'), w: +e.getAttribute('width'), h: +e.getAttribute('height') })).concat(sceneHzBox ? [sceneHzBox] : []);
      const free = (y) => !busy.some(r => x - w / 2 < r.x + r.w && r.x < x + w / 2 && y - fs < r.y + r.h && r.y < y + fs * 0.3);
      let y = R[1] + 30; for (let k = 0; k < 12 && !free(y); k++) y += fs * 1.6;
      out.push(scTag(x, y, t, 'err', 'middle'));
    }
  }
  el.innerHTML = out.join('');
}

// ---------- Panel ----------
function sceneUI() {
  if (!$('sc-hz')) return;
  const set = (id, on) => $(id).setAttribute('aria-pressed', String(!!on));
  const p = scenePose();
  SC_LOOKS.forEach(([n, y]) => set('sc-look-' + n.toLowerCase(), Math.abs(SceneMath.angleDelta(p.yawDeg, y)) < 0.05));
  lookDiagram($('sc-look-dia'), p.yawDeg, 'shot'); { const t = lookNote(p.yawDeg, 'shot'); if ($('sc-look-note').textContent !== t) $('sc-look-note').textContent = t; }
  let hz = 'none (camera looks straight up or down)';
  if (!st.plate.empty) {
    const h = sceneCam().horizon();
    if (h) { const y = (h[1] + h[3]) / 2; hz = y < 0 ? `above the frame (${Math.round(y)} px)` : y > st.plate.H ? `below the frame (${Math.round(y)} px)` : `y ${Math.round(y)} px · ${Math.round(100 * y / st.plate.H)}% from top`; }
  } else hz = '–';
  if ($('sc-hz').textContent !== hz) $('sc-hz').textContent = hz;
  // hook delivery: el mismo horizonte en el comp (después del reencuadre de entrega), a la izquierda, al centro y a la derecha
  const hc = !st.plate.empty && typeof dlHorizon === 'function' ? dlHorizon(sceneCam().horizon()) : null;
  $('sc-hzc-k').hidden = $('sc-hzc').hidden = !hc;
  if (hc) { const t = `y ${hc.ys.map(v => Math.round(v)).join(' · ')} comp px (left · centre · right)`; if ($('sc-hzc').textContent !== t) $('sc-hzc').textContent = t; }
  ['horizon', 'vanishing', 'figures'].forEach(k => set('sc-show-' + k, sceneSt.show[k]));
  set('walls-on', sceneSt.show.vanishing);
  set('sc-show-ground', $('grid').checked);
  const wax = scWorldToPairs(sceneSt.ax), combo = ['x', 'y', 'z'].filter(k => wax[k]).join(''); // en ejes del mundo
  ['xyz', 'xy', 'xz', 'yz'].forEach(c => { set('scv-' + c, combo === c); set('sc-c-' + c, combo === c); });
  // los iconos del visor de 2D Camera Match: ejes, Keep tilt, horizonte
  { const show = !!(scLinesOnly() && st.plate.empty); if ($('vp-load').hidden === show) $('vp-load').hidden = !show; } // 2D Camera Match sin plate: Load plate al medio
  set('scv-keep', !!st.lockTR); set('fig-on', sceneSt.show.figures); { const c = $('scv-lines'); if (c && c.checked !== !!sceneSt.showLines) c.checked = !!sceneSt.showLines; } set('scv-hz', sceneSt.show.horizon);
  $('sc-keep').checked = !!st.lockTR;
  set('sc-edit', st.mode === 'lines');
  $('sc-auto').disabled = sceneSt.busy;
  SceneMath.FIGURES.forEach(f => set('sc-fig-' + f.key, sceneSt.kind === f.key && st.mode === 'figure'));
  const s = sceneSt.solve;
  // "Solved" sólo mientras la cámara siga donde la dejó el solve de líneas (pins, campos o arrastres la mueven)
  const a = s && s.ok && s.after, moved = a && (Math.abs(SceneMath.angleDelta(p.yawDeg, a.yawDeg)) > 0.01 || Math.abs(p.tiltDeg - a.tiltDeg) > 0.01 || Math.abs(p.rollDeg - a.rollDeg) > 0.01 || Math.abs(focalUsed() - a.focal) > 0.01);
  const res = moved ? 'The camera moved after the lines solve (pins, fields or drags). Drag a line end to solve from the lines again.' : s ? (s.ok ? `Solved: yaw ${scFmt(p.yawDeg)}°, tilt ${scFmt(p.tiltDeg)}°` + (sceneSt.nvp >= 2 && !st.lockTR ? `, roll ${scFmt(p.rollDeg)}°, focal ${scFmt(focalUsed())} mm` : sceneSt.nvp >= 2 ? ` (Keep tilt: only the ${sceneSt.ax.z ? 'Z' : 'X'} axis turns the camera)` : '') + (sceneSt.nvp === 3 && s.checkDeg > 0.5 ? ` · the cross lines are ${scFmt(s.checkDeg, 1)}° off square with the other two` : '') : s.detail || s.error) : 'Lines not placed yet.';
  if ($('sc-res').textContent !== res) { $('sc-res').textContent = res; $('sc-res').classList.toggle('bad', !!(s && !s.ok)); }
  const n = sceneSt.figures.length;
  $('sc-st').textContent = `yaw ${scFmt(p.yawDeg, 1)}° · ${scFmt(p.heightM)} m` + (n ? ` · ${n} figure${n > 1 ? 's' : ''}` : '');
  const aw = sceneAvenueWalls();
  $('sc-wall').disabled = !!aw;
  $('sc-wall').title = aw ? `The avenue is loaded: the grid goes on its facades (${scFmt(Math.abs(aw.faceX(1)), 1)} m to the right and ${scFmt(Math.abs(aw.faceX(-1)), 1)} m to the left of the street axis)` : 'Distance from the car axis to the facades of the vanishing grid, on each side';
  if (document.activeElement !== $('sc-wall')) $('sc-wall').value = aw ? '' : sceneSt.wallM;
  $('sc-wall').placeholder = aw ? 'avenue' : '';
}
{
  const saveShow = () => { lsSet('scene.show2', sceneSt.show); drawOverlay(); };
  ['horizon', 'vanishing', 'figures'].forEach(k => $('sc-show-' + k).onclick = () => { sceneSt.show[k] = !sceneSt.show[k]; saveShow(); });
  $('scv-lines').onchange = () => { sceneSt.showLines = $('scv-lines').checked; drawOverlay(); };
  $('fig-on').onclick = () => { sceneSt.show.figures = !sceneSt.show.figures; saveShow(); };
  $('walls-on').onclick = () => { sceneSt.show.vanishing = !sceneSt.show.vanishing; saveShow(); }; // chip Walls del visor: lo mismo que Vanishing
  // la grilla de piso es la Home Grid de la app: el chip maneja el mismo checkbox
  $('sc-show-ground').onclick = () => { $('grid').checked = !$('grid').checked; $('grid').dispatchEvent(new Event('change')); drawOverlay(); };
  $('sc-wall').addEventListener('change', () => { const v = +$('sc-wall').value; if (v >= 0.5 && v <= 200) { sceneSt.wallM = v; lsSet('scene.wallM', v); } drawOverlay(); });
  SC_LOOKS.forEach(([n, y]) => $('sc-look-' + n.toLowerCase()).onclick = () => { if (st.plate.empty) return; pushHistory(); sceneSt.rot90 = 0; sceneSetPose({ ...scenePose(), yawDeg: y }, true); sceneMarkYaw(); });
  $('ang-yaw').addEventListener('change', sceneMarkYaw); // después del de panel.js, que mueve la cámara
  // las cuatro combinaciones de ejes, sobre la imagen y en Vanishing lines
  document.querySelectorAll('.scv-c, .sc-c').forEach(b => b.onclick = () => { const c = b.dataset.c; sceneSetAxes(scWorldToPairs({ x: c.includes('x'), y: c.includes('y'), z: c.includes('z') })); });
  $('scv-keep').onclick = () => { $('sc-keep').checked = !$('sc-keep').checked; $('sc-keep').dispatchEvent(new Event('change')); };
  $('scv-hz').onclick = () => { sceneSt.show.horizon = !sceneSt.show.horizon; saveShow(); refreshAll(); };
  // Keep tilt es el Lock tilt/roll de la app: un solo estado
  $('sc-keep').onchange = () => { $('lock-tr').checked = $('sc-keep').checked; $('lock-tr').dispatchEvent(new Event('change')); if (sceneSt.edited) sceneSolveLines(); refreshAll(); };
  $('sc-edit').onclick = () => setMode(st.mode === 'lines' && !(typeof mtabCur !== 'undefined' && mtabCur === 'match') ? 'nav' : 'lines'); // en 2D Camera Match no se navega: queda en Lines
  $('sc-auto').onclick = () => sceneAutoFromWindows();
  $('sc-reset-lines').onclick = () => { sceneLines(); sceneResetLines(); drawOverlay(); };
  SceneMath.FIGURES.forEach(f => $('sc-fig-' + f.key).onclick = () => scFigKind(f.key));
  // la herramienta Figure: un click la elige con la figura de antes; manteniéndola apretada (o con click derecho) se
  // abre el menú de figuras (Person, Door, Car, Bus) y el icono pasa a ser el de la elegida, como los flyouts de 3ds Max
  const tool = $('m-figure'), menu = document.createElement('div');
  menu.className = 'figmenu'; menu.id = 'figmenu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  menu.innerHTML = SceneMath.FIGURES.map(f => `<button role="menuitem" data-k="${f.key}" title="${f.name}">${scFigIcon(f.key)}<span>${f.label}</span></button>`).join('');
  document.body.appendChild(menu);
  const open = () => {
    const r = tool.getBoundingClientRect();
    menu.style.left = r.right + 6 + 'px'; menu.style.top = r.top + 'px'; menu.hidden = false;
    menu.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.k === sceneSt.kind)));
  };
  let hold = 0, opened = false;
  tool.addEventListener('pointerdown', e => { opened = false; if (e.button !== 0) return; clearTimeout(hold); hold = setTimeout(() => { opened = true; open(); }, 380); });
  ['pointerup', 'pointerleave'].forEach(t => tool.addEventListener(t, () => clearTimeout(hold)));
  tool.addEventListener('contextmenu', e => { e.preventDefault(); opened = true; open(); });
  tool.onclick = (e) => { if (opened) { e.preventDefault(); return; } setMode('figure'); };
  menu.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; menu.hidden = true; scFigKind(b.dataset.k); });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== tool && !tool.contains(e.target)) menu.hidden = true; }, true);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') menu.hidden = true; });
  scFigToolIcon();
  $('sc-clear-figs').onclick = () => { sceneSt.figures = []; sceneSt.sel = 0; drawOverlay(); };
  $('m-lines').onclick = () => setMode('lines');
  setTimeout(drawOverlay, 0);
}
