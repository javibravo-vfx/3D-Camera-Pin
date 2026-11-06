// Vista de la pestaña Import: en lugar del visor, cuatro paneles con su Load: el plate, la metadata leída,
// el scan en 3D (órbita libre, no toca la cámara del plano) y Google Maps (a futuro).
// El scan usa EL MISMO visor 3D de la app: el canvas del renderer se muda al cuadro del scan mientras la
// pestaña está abierta y render() dibuja ahí con la cámara de órbita y sólo lo que corresponde (el scan, la
// grilla y la medida; sin el entorno). Al salir vuelve al stage y applyView() le devuelve su tamaño.
// La metadata: los campos de cámara a la izquierda (con de dónde salió cada uno y en qué unidad se leyó) y
// todo lo leído de los archivos a la derecha; un dato se arrastra (o click y click) sobre el campo al que
// corresponde, y la unidad se puede cambiar.
const impv = { on: false, plateKey: '', scanKey: '', theta: 0.7, phi: 1.15, dist: 0, tgt: new THREE.Vector3(), cam: new THREE.PerspectiveCamera(40, 1, 0.01, 5000), drag: null,
  measure: false, grid: lsGet('imp.grid', true), map: {}, pick: null, srcKey: '', tgKey: '', srcs: [] };
function impEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function impBuild() {
  const box = document.createElement('div');
  box.className = 'impv'; box.id = 'impv'; box.hidden = true; box.dataset.tour = 'import.view';
  box.innerHTML = `
  <section class="impp" id="imp-plate"><header><b>Plate</b><span class="note" id="imp-plate-n"></span><button class="btn sm ghost" id="imp-plate-x" title="Remove the plate (the camera and the scan stay); click twice" hidden>Remove</button><button class="btn sm primary" id="imp-plate-load" title="Load a plate (EXR, JPG, PNG, MP4)">Load plate</button></header>
    <div class="impb"><img id="imp-plate-img" alt="" hidden><canvas id="imp-plate-cv" hidden></canvas><p class="impe" id="imp-plate-e">No plate yet.</p></div></section>
  <section class="impp" id="imp-meta"><header><b>Metadata</b><span class="note" id="imp-meta-n"></span><button class="btn sm ghost" id="imp-meta-reload" data-tour="import.reload" title="Read the plate metadata again from scratch: the edited and dragged values are dropped and the camera takes the values of the file again">Reload metadata</button><button class="btn sm" id="imp-meta-load" title="Import the set report: shot reports, the camera report (.xlsx), array calculations and the rig JSON">Load set report</button></header>
    <div class="impb impmeta">
      <div class="imcol"><h4>Camera</h4><p class="note" id="imp-meta-cam"></p><div id="imp-tg" class="imtg"></div>
        <p class="note">What the files say, not what the other tabs do with the camera. A field the metadata does not have stays empty: fill it with ✎. Edited, dragged and set report values show in <span class="imkey">yellow</span>. Drag a value from the right onto the field it belongs to (or click it, then the field) to read it under another name; the unit says how it is read.</p></div>
      <div class="imcol"><h4>Read from the files</h4><input id="imp-src-q" type="text" placeholder="Filter" aria-label="Filter the metadata">
        <div id="imp-src" class="imsrc"></div></div>
    </div></section>
  <section class="impp" id="imp-scan"><header><b>Scan</b><span class="note" id="imp-scan-n"></span>
    <button class="btn sm ghost" id="imp-scan-x" title="Remove the scan (the camera, the pins and the plate stay); click twice" hidden>Remove</button><button class="btn sm primary" id="imp-scan-load" title="Load a scan (OBJ, PLY, SPLAT, SPZ, KSPLAT, GLB, FBX)">Load scan</button><button class="btn sm ghost a3max" id="imp-scan-max" aria-pressed="false" aria-label="Maximize the scan" title="Maximize the scan view (Esc: back to the four panes)"><svg viewBox="0 0 24 24"><path class="a3-out" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path class="a3-in" d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg></button></header>
    <div class="impb" id="imp-scan-b">
      <div class="imptools"><button class="tool" id="imp-nav" data-tour="import.nav" aria-pressed="true" aria-label="Navigate" title="Navigate (N): drag to orbit, middle drag to pan, right drag or wheel to zoom (the Nav mouse style of the app works too)">
        <svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M17.5 6.2 21 8.3l-1.2 3.6"/><circle cx="12" cy="12" r="1.6"/><path d="M12 3v3M12 18v3"/></svg><kbd>N</kbd></button>
        <button class="tool" id="imp-measure" data-tour="import.measure" aria-pressed="false" aria-label="Measure" title="Measure (M): click two points on the scan, type the real length and Scale">
        <svg viewBox="0 0 24 24"><rect x="2.5" y="8" width="19" height="8" rx="1" transform="rotate(-30 12 12)"/><path d="m7.3 13.9-1-1.7M10.3 12.2l-1.5-2.6M13.3 10.4l-1-1.7M16.3 8.7l-1.5-2.6"/></svg><kbd>M</kbd></button>
        <button class="tool" id="imp-fit" data-tour="import.fit" aria-label="Frame the scan" title="Frame the scan (F, or double-click)">
        <svg viewBox="0 0 24 24"><path d="M12 7.5 16 9.8v4.4L12 16.5 8 14.2V9.8z"/><path d="M8 9.8l4 2.3 4-2.3M12 12.1v4.4"/><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg><kbd>F</kbd></button>
        <button class="tool" id="imp-grid" data-tour="import.grid" aria-pressed="true" aria-label="Grid" title="Grid on the ground, one line per meter (only in this view)">
        <svg viewBox="0 0 24 24"><path d="M3 9.5l9-4.5 9 4.5-9 4.5z"/><path d="M7.5 7.3l9 4.5M16.5 7.3l-9 4.5"/><path d="M3 14.5l9 4.5 9-4.5"/></svg></button></div>
      <svg class="impov" id="imp-scan-ov"></svg><svg class="axgz" id="imp-axgz" aria-hidden="true"></svg>
      <div class="impmpop" id="imp-mpop" hidden><span class="d" id="imp-md">0.000 m</span><span>→</span>
        <input id="imp-mreal" class="mini" type="number" step="0.001" min="0" placeholder="real" aria-label="Real length in meters"><span class="u">m</span>
        <button class="btn sm primary" id="imp-mok">Scale</button><button class="btn sm ghost" id="imp-mx" aria-label="Clear measurement" title="Clear (Esc)">×</button></div>
      <p class="impe" id="imp-scan-e">No scan yet. Load it or drop it here (an OBJ with its .mtl and texture: select or drop them together).</p>
      <p class="msg bad impmsg-scan" id="imp-scan-msg" hidden></p></div></section>
  <section class="impp" id="imp-maps"><header><b>Google Maps</b><span class="note">3D</span><button class="btn sm" disabled title="Coming later: import the street from Google Maps 3D">Import from Google Maps</button></header>
    <div class="impb"><p class="impe">Import the location from <b>Google Maps</b> in 3D.<br><span class="note">Coming later.</span></p></div></section>`;
  const vmid = document.querySelector('.viewer > .vmid');
  vmid.parentNode.insertBefore(box, vmid.nextSibling);
  $('imp-plate-load').onclick = () => $('f-plate').click();
  // Remove: un segundo click en 3 s confirma (como Reset all)
  const arm = (b, fn) => { let t = 0; b.onclick = () => {
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Click again'; t = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Remove'; }, 3000); return; }
    clearTimeout(t); b.classList.remove('armed'); b.textContent = 'Remove'; fn(); }; };
  arm($('imp-plate-x'), impRemovePlate); arm($('imp-scan-x'), impRemoveScan);
  $('imp-scan-load').onclick = () => $('f-scan').click();
  $('imp-meta-load').onclick = () => $('f-sr').click();
  $('imp-meta-reload').onclick = () => impMetaReload();
  $('imp-nav').onclick = () => impMeasureToggle(false);
  $('imp-measure').onclick = () => impMeasureToggle();
  $('imp-fit').onclick = () => impFit();
  $('imp-grid').onclick = () => { impv.grid = !impv.grid; lsSet('imp.grid', impv.grid); impRenderScan(); };
  // navegación del scan (sobre el cuadro: el canvas se muda adentro). El estilo de mouse de la app (Nav: Maya, Max,
  // Blender…) vale igual que en 3D Camera Pin; además, con Navigate, sin modificador: izquierdo gira, medio desplaza,
  // derecho acerca. Con Measure, el click izquierdo sin arrastre marca un punto.
  const host = $('imp-scan-b');
  host.addEventListener('pointerdown', e => {
    if (e.target.closest('#imp-mpop, .imptools')) return;
    let action = NAV[navPreset].map(e.button, e);
    if (!action) action = e.button === 1 ? 'pan' : e.button === 2 ? 'dolly' : impv.measure ? null : 'orbit';
    impv.drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, b: e.button, action }; host.setPointerCapture(e.pointerId); e.preventDefault();
  });
  host.addEventListener('pointermove', e => {
    const d = impv.drag; if (!d || !d.action) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
    if (d.action === 'orbit') { impv.theta -= dx * 0.008; impv.phi = Math.min(3.1, Math.max(0.05, impv.phi - dy * 0.008)); }
    else if (d.action === 'look') { // Game: mirar desde donde está la cámara (el punto que orbita gira alrededor de ella)
      const off = (th, ph) => new THREE.Vector3(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)).multiplyScalar(impv.dist);
      const P = impv.tgt.clone().add(off(impv.theta, impv.phi));
      impv.theta -= dx * 0.005; impv.phi = Math.min(3.1, Math.max(0.05, impv.phi - dy * 0.005));
      impv.tgt.copy(P).sub(off(impv.theta, impv.phi));
    }
    else if (d.action === 'pan') {
      impv.cam.updateMatrixWorld();
      const k = impv.dist * 0.0015, r = new THREE.Vector3().setFromMatrixColumn(impv.cam.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(impv.cam.matrixWorld, 1);
      impv.tgt.addScaledVector(r, -dx * k).addScaledVector(u, dy * k);
    } else impv.dist = Math.max(1e-3, impv.dist * Math.exp((dy - dx) * 0.004)); // dolly
    impRenderScan();
  });
  host.addEventListener('pointerup', e => {
    const d = impv.drag; impv.drag = null;
    if (d && d.b === 0 && !d.action && impv.measure && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) impMeasureClick(e.clientX, e.clientY);
  });
  host.addEventListener('pointercancel', () => { impv.drag = null; });
  host.addEventListener('contextmenu', e => e.preventDefault()); navNoAutoscroll(host);
  // Game: WASD mueve la vista del scan como en los otros visores (js/navigation.js)
  const impFly = { fly: {
    ok: () => impv.on && host.getClientRects().length > 0,
    basis: () => { impv.cam.updateMatrixWorld(); return { fwd: new THREE.Vector3(0, 0, -1).applyQuaternion(impv.cam.quaternion), right: new THREE.Vector3(1, 0, 0).applyQuaternion(impv.cam.quaternion) }; },
    speed: () => Math.max(0.2, impv.dist / 4),
    move: (v) => { impv.tgt.add(v); impRenderScan(); },
  } };
  host.addEventListener('pointerenter', () => { navHover = impFly; }); host.addEventListener('pointerleave', () => { if (navHover === impFly) navHover = null; });
  host.addEventListener('pointerdown', () => { navFlyLast = impFly.fly; }); navFlyReg(host, impFly.fly);
  host.addEventListener('wheel', e => { if (e.target.closest('#imp-mpop')) return; e.preventDefault(); impv.dist *= Math.exp(e.deltaY * 0.0012); impRenderScan(); }, { passive: false });
  host.addEventListener('dblclick', e => { if (e.target.closest('#imp-mpop, .imptools')) return; impFit(); });
  // la medida: el largo real y Scale (lo mismo que el cartel del visor y Scan & scale)
  const ok = () => { const v = +$('imp-mreal').value; if (v > 0) { applyScaleFrom(v); impv.dist = 0; impRenderScan(); toast(`Scan scaled: that length is now ${fmt(v, 3)} m`); } };
  $('imp-mok').onclick = ok;
  $('imp-mreal').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } if (e.key === 'Escape') { e.preventDefault(); impMeasureClear(); } e.stopPropagation(); });
  $('imp-mx').onclick = impMeasureClear;
  new ResizeObserver(() => { if (impv.on) { impRenderScan(); impPlate(true); } }).observe(box);
  // maximizar la vista del scan: ocupa los cuatro paneles (Esc o el mismo botón vuelve); sólo en esta sesión
  new ResizeObserver(() => { if (impv.on) impRenderScan(); }).observe(host);
  const maxSet = (on) => { box.classList.toggle('scanmax', on); $('imp-scan-max').setAttribute('aria-pressed', String(on)); const t = on ? 'Back to the four panes (Esc)' : 'Maximize the scan view (Esc: back to the four panes)'; $('imp-scan-max').title = t; $('imp-scan-max').setAttribute('aria-label', on ? 'Back to the four panes' : 'Maximize the scan'); };
  $('imp-scan-max').onclick = () => maxSet(!box.classList.contains('scanmax'));
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && impv.on && box.classList.contains('scanmax') && !(e.target.matches && e.target.matches('input, textarea, select'))) { maxSet(false); } });
  // soltar archivos sobre la vista: lo mismo que en el visor (plate, scan con su .mtl y textura, set report, proyecto)
  let depth = 0;
  const isMeta = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('text/x-bpl-meta');
  box.addEventListener('dragenter', e => { if (isMeta(e)) return; e.preventDefault(); depth++; box.classList.add('dropping'); });
  box.addEventListener('dragleave', e => { if (isMeta(e)) return; if (--depth <= 0) { depth = 0; box.classList.remove('dropping'); } });
  box.addEventListener('dragover', e => e.preventDefault());
  box.addEventListener('drop', e => { e.preventDefault(); depth = 0; box.classList.remove('dropping'); if (!isMeta(e)) dropFiles(e.dataTransfer); });
  impMetaWire();
}
// los avisos de carga viven en el visor, que en Import está oculto: mientras tanto se muestran en el cuadro del scan
const IMP_MOVE = ['busy', 'obj-busy'];
const impHome = {};
function impMove(on) {
  const host = $('imp-scan-b');
  for (const id of [...IMP_MOVE, 'gl']) {
    const el = $(id); if (!el) continue;
    if (on) { if (!impHome[id]) impHome[id] = { parent: el.parentNode, next: el.nextSibling }; if (id === 'gl') { host.prepend(el); el.classList.add('impgl'); } else host.appendChild(el); }
    else if (impHome[id]) { impHome[id].parent.insertBefore(el, impHome[id].next); delete impHome[id]; el.classList.remove('impgl'); el.style.visibility = ''; }
  }
}
function impFrame() {
  const b = new THREE.Box3().setFromObject(scanRoot);
  if (b.isEmpty()) return;
  // la esfera que envuelve la caja entra entera en el lado más angosto del cuadro
  const r = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 0.25), c = impv.cam;
  const vf = c.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * (c.aspect || 1));
  b.getCenter(impv.tgt); impv.dist = r / Math.sin(Math.min(vf, hf) / 2) * 1.08;
}
function impSize() {
  const r = $('imp-scan-b').getBoundingClientRect();
  return { w: Math.max(2, Math.round(r.width)), h: Math.max(2, Math.round(r.height)), r };
}
function impRenderScan() {
  if (!impv.on) return;
  const has = !!scanObj;
  $('imp-scan-e').hidden = has; canvas.style.visibility = has ? '' : 'hidden';
  $('imp-scan-n').textContent = has ? st.scanName || '' : '';
  $('imp-measure').disabled = $('imp-nav').disabled = $('imp-fit').disabled = !has;
  if (!has) { $('imp-scan-ov').innerHTML = ''; $('imp-mpop').hidden = true; return; }
  const { w, h } = impSize(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = impv.cam;
  c.aspect = w / h;
  if (!impv.dist) impFrame();
  const sp = Math.sin(impv.phi);
  c.near = Math.max(impv.dist / 2000, 0.005); c.far = impv.dist * 100; c.updateProjectionMatrix();
  c.position.set(impv.tgt.x + impv.dist * sp * Math.sin(impv.theta), impv.tgt.y + impv.dist * Math.cos(impv.phi), impv.tgt.z + impv.dist * sp * Math.cos(impv.theta));
  c.lookAt(impv.tgt); c.updateMatrixWorld();
  // sólo el scan, la grilla y la medida: el entorno no va en este cuadro. El scan se ve siempre (aunque esté
  // apagado en el visor de las otras pestañas) y la grilla tiene su propio botón
  const keep = [envRoot.visible, scanRoot.visible, grid.visible];
  envRoot.visible = false; scanRoot.visible = true; grid.visible = impv.grid;
  // siempre Flat (unlit), sea cual sea el modo del visor de las otras pestañas (un splat, con sus gaussianas)
  const mats = [];
  scanObj.traverse(o => {
    if (o.userData.isSplat || !o.isMesh) return;
    if (!o.userData.flat) o.userData.flat = flatOf(o.userData.orig);
    mats.push([o, o.material]); o.material = o.userData.flat;
  });
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  renderer.render(scene, c);
  mats.forEach(([o, m]) => { o.material = m; });
  [envRoot.visible, scanRoot.visible, grid.visible] = keep;
  $('imp-grid').setAttribute('aria-pressed', String(impv.grid));
  impDrawMeasure(w, h);
  if (typeof axGizmo === 'function') axGizmo($('imp-axgz'), c); // los ejes del mundo, abajo a la izquierda (js/cam-move.js)
}
// encuadra el scan entero, manteniendo la dirección de la vista
function impFit() { impv.dist = 0; impRenderScan(); }
// ---------- Medida en el scan de Import ----------
function impMeasureToggle(on = !impv.measure) {
  impv.measure = on && !!scanObj;
  $('imp-measure').setAttribute('aria-pressed', String(impv.measure)); $('imp-nav').setAttribute('aria-pressed', String(!impv.measure));
  $('imp-scan-b').classList.toggle('measuring', impv.measure);
  if (!impv.measure) $('imp-mpop').hidden = true;
  impRenderScan();
}
function impMeasureClear() { clearMeasure(); impRenderScan(); }
function impPickScan(cx, cy) {
  const { w, h, r } = impSize(), c = impv.cam;
  const ndc = new THREE.Vector2((cx - r.left) / w * 2 - 1, -((cy - r.top) / h * 2 - 1));
  ray.setFromCamera(ndc, c);
  ray.params.Points.threshold = Math.max(2 * impv.dist * Math.tan(c.fov * Math.PI / 360) / h * 6, 1e-5);
  const hits = ray.intersectObject(scanRoot, true).filter(x => (x.object.visible || x.object.userData.pickProxy) && (x.object.isMesh || x.object.isPoints) && !x.object.userData.isSplat);
  if (!hits.length) return null;
  let best = hits[0];
  if (best.object.isPoints) best = hits.filter(x => x.object.isPoints && x.distance < best.distance * 1.03).reduce((a, b) => (b.distanceToRay < a.distanceToRay ? b : a), best);
  return best.point.clone();
}
function impMeasureClick(cx, cy) {
  const p = impPickScan(cx, cy);
  if (!p) { toast('Click on the scan'); return; }
  const loc = scanRoot.worldToLocal(p.clone()), m = st.measure;
  if (!m.la || m.lb) { m.la = loc; m.ea = false; m.lb = null; m.eb = false; $('imp-mreal').value = ''; }
  else { m.lb = loc; m.eb = false; }
  measWorld(); updateMeasureGeo(); impRenderScan();
  if (st.measure.lb) setTimeout(() => $('imp-mreal').focus(), 0);
}
function impDrawMeasure(w, h) {
  const ov = $('imp-scan-ov'), pop = $('imp-mpop'), m = st.measure, c = impv.cam;
  ov.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const to = (p) => { const v = p.clone().project(c); return v.z < 1 ? [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h] : null; };
  let s = '';
  const a = m.a && !measEnv() && to(m.a), b = m.b && !measEnv() && to(m.b);
  if (a && b) s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  for (const q of [a, b]) if (q) s += `<circle cx="${q[0]}" cy="${q[1]}" r="4.5"/>`;
  ov.innerHTML = s;
  pop.hidden = !(a && b);
  if (a && b) {
    $('imp-md').textContent = m.a.distanceTo(m.b).toFixed(3) + ' m';
    pop.style.left = Math.min(w - 10, Math.max(10, (a[0] + b[0]) / 2)) + 'px'; pop.style.top = Math.min(h - 10, Math.max(10, (a[1] + b[1]) / 2)) + 'px';
  }
}
// el plate: la misma imagen del visor (JPG/PNG/video) o una copia del canvas del EXR
function impPlate(force) {
  if (!impv.on) return;
  const empty = st.plate.empty, key = empty ? '' : `${st.plate.name}|${st.plate.W}|${st.plate.H}|${plateImg.src.length}|${$('platecv').hidden}`;
  $('imp-plate-e').hidden = !empty;
  $('imp-plate-n').textContent = empty ? '' : `${st.plate.sample ? 'Sample' : st.plate.name} · ${st.plate.W} × ${st.plate.H}`;
  if (!force && key === impv.plateKey) return;
  impv.plateKey = key;
  const img = $('imp-plate-img'), cv = $('imp-plate-cv');
  if (empty) { img.hidden = cv.hidden = true; return; }
  if (!plateImg.hidden && plateImg.getAttribute('src')) { img.src = plateImg.src; img.hidden = false; cv.hidden = true; return; }
  const src = $('platecv'); img.hidden = true; cv.hidden = false;
  if (src.width && src.height) { cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0); }
}

// ---------- Metadata: campos de cámara y lo leído de los archivos ----------
// unidades de cada clase, con su factor a la unidad de la app (mm para lentes y film back, m para distancias, ° para ángulos)
const IMP_UNITS = {
  len: { mm: 1, cm: 10, m: 1000, in: 25.4 },
  dist: { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 },
  ang: { deg: 1, rad: 180 / Math.PI },
  num: { '': 1 },
};
const IMP_UNIT_LABEL = { deg: '°', rad: 'rad' };
const impSetField = (id, v) => { const el = $(id); el.value = String(+v.toFixed(4)); el.dispatchEvent(new Event('change', { bubbles: true })); };
const IMP_TARGETS = [
  { id: 'focal', label: 'Lens (focal)', kind: 'len', get: () => focalUsed(), set: (v) => { $('focal').value = +v.toFixed(3); $('focal').onchange(); } },
  { id: 'sw', label: 'Film back width', kind: 'len', get: () => st.sw, set: (v) => setSensor(+v.toFixed(4), st.sh, false) },
  { id: 'focus', label: 'Focus distance', kind: 'dist', get: () => lensState.focusM, set: (v, src) => lensSet({ focusM: v, focusSrc: src }) },
  { id: 'tstop', label: 'T-stop', kind: 'num', get: () => lensState.tStop, set: (v, src) => lensSet({ tStop: v, tStopSrc: src }) },
  { id: 'tilt', label: 'Tilt', kind: 'ang', get: () => camAngles().tilt, set: (v) => impSetField('ang-tilt', v) },
  { id: 'roll', label: 'Roll', kind: 'ang', get: () => camAngles().roll, set: (v) => impSetField('ang-roll', v) },
  { id: 'yaw', label: 'Yaw', kind: 'ang', get: () => camAngles().yaw, set: (v) => impSetField('ang-yaw', v) },
  { id: 'height', label: 'Camera height', kind: 'dist', get: () => camera.position.y, set: (v) => impSetField('cam-h', v) },
];
const impBase = (kind) => Object.keys(IMP_UNITS[kind])[0];
function impFmtVal(t, v) {
  if (!Number.isFinite(v)) return '–';
  const u = impBase(t.kind);
  return t.kind === 'ang' ? `${fmt(v, 2)}°` : t.kind === 'num' ? `T${+v.toFixed(2)}` : `${fmt(v, t.kind === 'dist' ? 3 : 2)} ${u}`;
}
// el primer número del texto (coma decimal también) y la unidad que dice el texto, si dice alguna
function impParse(text, kind) {
  const s = String(text), m = s.match(/-?\d+(?:[.,]\d+)?(?:e-?\d+)?/i);
  const num = m ? parseFloat(m[0].replace(',', '.')) : NaN;
  const after = m ? s.slice(m.index + m[0].length).toLowerCase() : s.toLowerCase();
  const has = (re) => re.test(after) || re.test(s.toLowerCase());
  let unit = '';
  if (kind === 'ang') unit = has(/rad/) ? 'rad' : 'deg';
  else if (kind === 'len') unit = has(/\bcm\b/) ? 'cm' : has(/\bin\b|inch|"/) ? 'in' : has(/(^|[^a-z])m\b(?!m)/) && !has(/mm/) ? 'm' : 'mm';
  else if (kind === 'dist') unit = has(/mm\b/) ? 'mm' : has(/\bcm\b/) ? 'cm' : has(/ft\b|feet|'/) ? 'ft' : has(/\bin\b|inch|"/) ? 'in' : has(/(^|[^a-z])m\b|meter|metro/) ? 'm' : Math.abs(num) >= 100 ? 'mm' : 'm';
  return { num, unit };
}
// el film back que da la metadata (la cámara y el modo contra el catálogo, o fotositos × pitch), sin aplicarlo
function impAutoSw(md) {
  try {
    const W = st.plate.W, H = st.plate.H, b = camMatchBody(md.camera), m = b && camMatchMode(b, md.rw, md.rh);
    // el mismo orden que camApplyPlateMeta (js/exr.js): raster, film back que declara la cámara, fotositos × pitch
    const byFilm = b && !m && md.filmW > 0 ? camModes(b).find(x => Math.abs(x.w / md.filmW - 1) < 0.01 && (!(md.filmH > 0) || Math.abs(x.h / md.filmH - 1) < 0.02)) : null;
    if (m || byFilm) { const mm = m || byFilm; return [camFilmBack(mm, camGuessExtract(mm, W, H)).w, camBodyName(b) + ' ' + mm.label]; }
    if (md.pitch > 0 && md.rw > 0) return [md.rw * md.pitch / 1000, 'photosites × pitch'];
    if (md.filmW > 0) return [md.filmW, md.sources.filmW.key];
    if (b) return [camClosestMode(b, W, H).w, camBodyName(b) + ' (mode not in the file: choose it)'];
    if (md.hint && md.hint.sw) return [md.hint.sw, md.hint.sensorKey || 'sensor'];
  } catch (e) { /* sin catálogo */ }
  return null;
}
// lo que dice la metadata interpretada del EXR para cada campo (sin edición): null si no lo trae
function impAuto(id) {
  const md = st.plateMeta; if (!md || !md.has) return null;
  if (id === 'sw') { const a = impAutoSw(md); return a ? { src: 'exr', where: md.file || 'EXR', key: a[1], text: '', num: a[0], unit: 'mm', auto: true } : null; }
  const o = md.orient || {}, file = md.file || 'EXR';
  const a = { focal: md.focal > 0 && [md.focal, 'mm', 'lens'], focus: md.focusM > 0 && [md.focusM, 'm', 'focus'], tstop: md.tStop > 0 && [md.tStop, '', 'T-stop'],
    tilt: o.tilt && [o.tilt.v, 'deg', 'tilt'], roll: o.roll && [o.roll.v, 'deg', 'roll'], yaw: o.yaw && [o.yaw.v, 'deg', 'yaw'] }[id];
  // la clave del archivo de donde salió (js/meta-profiles.js: md.sources), no sólo el nombre del campo
  const f = { focal: 'focalMm', focus: 'focusM', tstop: 'tStop', tilt: 'tiltDeg', roll: 'rollDeg', yaw: 'yawDeg' }[id], c = md.sources && md.sources[f];
  return a ? { src: 'exr', where: file, key: c && c.key || a[2], text: '', num: a[0], unit: a[1], auto: true } : null;
}
function impEdit(t) {
  const row = $('imp-tg').querySelector(`.imt[data-t="${t.id}"]`); if (!row) return;
  const m = impv.map[t.id] || impAuto(t.id), base = impBase(t.kind);
  const cur = m ? m.num * (IMP_UNITS[t.kind][m.unit] ?? 1) : NaN;
  const cell = row.querySelector('.imt-v');
  cell.innerHTML = `<input class="mini imt-in" type="number" step="any" value="${Number.isFinite(cur) ? +cur.toFixed(4) : ''}" aria-label="${t.label}">`;
  const inp = cell.querySelector('input'); inp.focus(); inp.select();
  let fin = false;
  const done = (ok) => {
    if (fin) return; fin = true; // Enter y el blur que sigue al sacar el campo
    const v = parseFloat(inp.value);
    inp.remove(); impv.tgKey = '';
    if (ok && Number.isFinite(v)) { impv.map[t.id] = { src: 'edit', where: 'typed', key: 'typed', text: String(v), num: v, unit: base }; impApply(t); }
    else impMeta();
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } e.stopPropagation(); });
  inp.addEventListener('blur', () => done(true));
}
// Reload metadata: de cero, como recién abierto el plate
function impMetaReload() {
  impv.map = {}; impv.tgKey = '';
  const md = st.plateMeta;
  if (md && md.has && typeof camApplyPlateMeta === 'function') { pushHistory(); const a = camApplyPlateMeta(); camRenderMeta(a); refreshAll(); toast(`Metadata read again from ${md.file || 'the plate'}${a.length ? ': ' + a.join(', ') : ''}`); }
  else toast(md ? 'The plate has no camera metadata to read again' : 'No plate metadata: load an EXR plate', true);
  impMeta();
}
function impAssign(t, it) {
  const { num, unit } = impParse(it.v, t.kind);
  if (!Number.isFinite(num)) { toast(`“${it.k}” has no number to use as ${t.label.toLowerCase()}`, true); return; }
  impv.map[t.id] = { src: it.src, where: it.where, key: it.k, text: it.v, num, unit };
  impApply(t);
}
function impApply(t) {
  const m = impv.map[t.id] || impAuto(t.id); if (!m) return;
  const v = m.num * (IMP_UNITS[t.kind][m.unit] ?? 1);
  if (!(Number.isFinite(v)) || ((t.kind === 'len' || t.kind === 'num') && v <= 0) || (t.id === 'focus' && v <= 0)) { toast(`${t.label}: ${fmt(m.num, 3)} ${m.unit} is not a valid value`, true); return; }
  if (t.id !== 'focus' && t.id !== 'tstop' && t.id !== 'focal' && t.id !== 'sw') pushHistory();
  t.set(v, m.src === 'report' ? 'report' : m.src === 'edit' ? 'typed' : 'exr');
  impv.tgKey = ''; impMeta();
  toast(`${t.label}: ${impFmtVal(t, v)} (${m.key}${m.unit ? ', read in ' + (IMP_UNIT_LABEL[m.unit] || m.unit) : ''})`);
}
// todo lo leído: los atributos del EXR y las filas del set report
function impSources() {
  const out = [];
  const A = st.metaAttrs;
  if (A && A.list) for (const x of A.list) out.push({ src: 'exr', where: A.file || 'EXR', k: x.k, v: x.v });
  const kv = $('sr-kv');
  if (kv && $('sr-ui') && !$('sr-ui').hidden) {
    const dts = [...kv.querySelectorAll('dt')];
    for (const dt of dts) { const dd = dt.nextElementSibling; const v = dd ? dd.textContent.trim() : ''; if (v && !dt.classList.contains('sr-sep')) out.push({ src: 'report', where: 'Set report', k: dt.textContent.trim(), v }); }
  }
  return out;
}
function impMetaWire() {
  $('imp-src-q').addEventListener('input', () => { impv.srcKey = ''; impMeta(); });
  const list = $('imp-src'), tg = $('imp-tg');
  list.addEventListener('dragstart', e => {
    const el = e.target.closest('.ims'); if (!el) return;
    e.dataTransfer.setData('text/x-bpl-meta', el.dataset.i); e.dataTransfer.setData('text/plain', el.dataset.i); e.dataTransfer.effectAllowed = 'copy';
    tg.classList.add('dragging');
  });
  list.addEventListener('dragend', () => { tg.classList.remove('dragging'); tg.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
  list.addEventListener('click', e => { // click y click: para pantallas táctiles
    const el = e.target.closest('.ims'); if (!el) return;
    const i = +el.dataset.i; impv.pick = impv.pick === i ? null : i;
    list.querySelectorAll('.ims').forEach(x => x.classList.toggle('sel', +x.dataset.i === impv.pick));
    tg.classList.toggle('dragging', impv.pick != null);
  });
  tg.addEventListener('dragover', e => { const r = e.target.closest('.imt'); if (!r) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; tg.querySelectorAll('.over').forEach(x => x !== r && x.classList.remove('over')); r.classList.add('over'); });
  tg.addEventListener('dragleave', e => { const r = e.target.closest('.imt'); if (r && !r.contains(e.relatedTarget)) r.classList.remove('over'); });
  tg.addEventListener('drop', e => {
    const r = e.target.closest('.imt'); if (!r) return;
    e.preventDefault(); e.stopPropagation(); r.classList.remove('over'); tg.classList.remove('dragging');
    const it = impv.srcs[+e.dataTransfer.getData('text/x-bpl-meta')], t = IMP_TARGETS.find(x => x.id === r.dataset.t);
    if (it && t) impAssign(t, it);
  });
  tg.addEventListener('click', e => {
    const r = e.target.closest('.imt'); if (!r || e.target.closest('select, button, input')) return;
    if (impv.pick == null) return;
    const it = impv.srcs[impv.pick], t = IMP_TARGETS.find(x => x.id === r.dataset.t);
    impv.pick = null; tg.classList.remove('dragging'); $('imp-src').querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
    if (it && t) impAssign(t, it);
  });
  tg.addEventListener('change', e => {
    const sel = e.target.closest('.imt-u'); if (!sel) return;
    const t = IMP_TARGETS.find(x => x.id === sel.dataset.t), m = impv.map[t.id] || impAuto(t.id); if (!m) return;
    impv.map[t.id] = { ...m, unit: sel.value, auto: false };
    impApply(t);
  });
  tg.addEventListener('click', e => { const b = e.target.closest('.imt-e'); if (b) impEdit(IMP_TARGETS.find(x => x.id === b.dataset.t)); });
  tg.addEventListener('click', e => {
    const b = e.target.closest('.imt-x'); if (!b) return;
    delete impv.map[b.dataset.t]; impv.tgKey = ''; impMeta();
  });
}
function impMeta() {
  if (!impv.on) return;
  // arriba: el plate y la cámara en uso
  const camTxt = $('tb-cam') && $('tb-cam').textContent.trim();
  const head = [!st.plate.empty && `${st.plate.sample ? 'Sample' : st.plate.name} · ${st.plate.W} × ${st.plate.H}`, camTxt].filter(Boolean).join(' · ');
  if ($('imp-meta-cam').textContent !== head) $('imp-meta-cam').textContent = head;
  $('imp-meta-n').textContent = $('sr-name') && $('sr-name').textContent !== 'none' ? $('sr-name').textContent : '';
  // los campos (sólo se rehacen si algo cambió: no pisar un select abierto)
  const rows = IMP_TARGETS.map(t => {
    const m = impv.map[t.id] || impAuto(t.id), v = m ? m.num * (IMP_UNITS[t.kind][m.unit] ?? 1) : NaN;
    const units = Object.keys(IMP_UNITS[t.kind]);
    const from = !m ? '<span class="faint">not in the metadata: ✎ to fill it</span>' : m.src === 'edit' ? 'typed' : m.src === 'report' ? `Set report · ${impEsc(m.key)}` : `EXR · ${impEsc(m.key)}${m.auto ? '' : ' = ' + impEsc(m.text.slice(0, 40))}`;
    const sel = m && t.kind !== 'num' ? `<select class="imt-u mini" data-t="${t.id}" aria-label="Unit the value is read in" title="Unit the value in the file is read in">${units.map(u => `<option value="${u}"${u === m.unit ? ' selected' : ''}>${IMP_UNIT_LABEL[u] || u}</option>`).join('')}</select>` : '';
    return `<div class="imt${m && !m.auto ? ' set' : ''}${m ? '' : ' imt-none'}" data-t="${t.id}"><span class="imt-l">${t.label}</span><span class="imt-v">${m ? impFmtVal(t, v) : '—'}</span>`
      + `<span class="imt-s" title="${m ? 'Read as ' + fmt(m.num, 4) + ' ' + (m.unit || '') : 'Drop a value here or type it'}">${from}</span>${sel}<button class="imt-e" data-t="${t.id}" title="Edit by hand">✎</button>${m && !m.auto ? `<button class="imt-x" data-t="${t.id}" title="Forget this edit (back to what the metadata says; the camera keeps its value)">×</button>` : '<span></span>'}</div>`;
  }).join('');
  if (rows !== impv.tgKey && !$('imp-tg').contains(document.activeElement)) { impv.tgKey = rows; $('imp-tg').innerHTML = rows; }
  // lo leído
  const all = impSources(), q = $('imp-src-q').value.trim().toLowerCase();
  const key = JSON.stringify(all) + '|' + q + '|' + impv.pick;
  if (key === impv.srcKey) return;
  impv.srcKey = key; impv.srcs = all;
  let h = '', last = '';
  all.forEach((it, i) => {
    if (q && !(it.k + ' ' + it.v).toLowerCase().includes(q)) return;
    if (it.where !== last) { h += `<h5>${impEsc(it.src === 'exr' ? 'Plate · ' + it.where : it.where)}</h5>`; last = it.where; }
    h += `<div class="ims${impv.pick === i ? ' sel' : ''}" draggable="true" data-i="${i}" title="Drag onto a camera field"><b>${impEsc(it.k)}</b><span>${impEsc(it.v.slice(0, 120))}</span></div>`;
  });
  $('imp-src').innerHTML = h || `<p class="impe">${all.length ? 'Nothing matches the filter.' : 'Nothing read yet: load an EXR plate (its header) or a set report.'}</p>`;
}
let impTimer = 0;
function impTick() {
  impPlate(false); impMeta();
  if ($('imp-plate-x').hidden !== !!st.plate.empty) $('imp-plate-x').hidden = !!st.plate.empty;
  if ($('imp-scan-x').hidden !== !scanObj) $('imp-scan-x').hidden = !scanObj;
  { // el aviso de error de la carga del scan (Scan & scale) también en su cuadro
    const m = ['obj-msg', 'unit-msg'].map($).find(el => el && !el.hidden && /\bbad\b/.test(el.className) && el.textContent.trim()), out = $('imp-scan-msg');
    const t = m ? m.textContent.trim() : ''; out.hidden = !t; if (out.textContent !== t) out.textContent = t;
  }
  const sk = scanObj ? `${scanObj.uuid}|${st.unit}|${st.userScale}|${st.up}|${(st.rot || []).join(',')}` : '';
  if (sk !== impv.scanKey) {
    const fresh = !impv.scanKey.startsWith(scanObj ? `${scanObj.uuid}|${st.unit}|${st.userScale}|` : '-'); // otro scan u otra escala: se encuadra de nuevo
    impv.scanKey = sk; if (fresh) impv.dist = 0; impRenderScan();
  }
}
function impShow(on) {
  if (on === impv.on) return;
  impv.on = on; $('impv').hidden = !on;
  clearInterval(impTimer);
  impMove(on);
  if (on) { impv.scanKey = ''; impv.plateKey = ''; impv.srcKey = ''; impv.tgKey = ''; impTick(); impTimer = setInterval(impTick, 600); }
  else { impMeasureToggle(false); applyView(); render(); drawOverlay(); }
}
// lo que aplica el set report (Shot Docs, planilla de cámara) no es metadata interpretada: queda como editado
if (typeof srApplyShot === 'function') {
  const f = srApplyShot;
  srApplyShot = function (s) {
    const r = f(s);
    if (s) {
      const fs = s.fromTake || {}, rec = (id, v, unit, key) => { if (Number.isFinite(v)) impv.map[id] = { src: 'report', where: 'Set report', key, text: `${+(+v).toFixed(4)}${unit && unit !== 'deg' ? ' ' + unit : unit === 'deg' ? '°' : ''}`, num: v, unit }; };
      rec('focal', s.focalMm, 'mm', 'Lens'); rec('tilt', s.tiltDeg, 'deg', 'Tilt'); rec('roll', s.rollDeg, 'deg', 'Roll'); rec('yaw', s.yawDeg, 'deg', 'Yaw');
      rec('height', s.heightM, 'm', 'Height'); rec('focus', Number.isFinite(s.focusM) ? s.focusM : s.subjectM, 'm', fs.focus ? 'Camera report · Focus' : 'Focus'); rec('tstop', s.tStop, '', fs.tStop ? 'Camera report · T-stop' : 'T-stop');
      impv.tgKey = '';
    }
    return r;
  };
}
// la barra de cámara: el número que coincide con la metadata (la de Import and Measure: EXR, set report o lo tipeado
// en ✎) se pinta violeta; si la cámara se cambia y deja de coincidir, vuelve al color de siempre
const IMP_BAR = [['tb-focal', 'focal', 2], ['ang-tilt', 'tilt', 2], ['ang-roll', 'roll', 2], ['ang-yaw', 'yaw', 2], ['cam-h', 'height', 3]];
function impBarMeta() {
  for (const [el, id, d] of IMP_BAR) {
    const inp = $(el), t = IMP_TARGETS.find(x => x.id === id); if (!inp || !t) continue;
    const m = impv.map[id] || impAuto(id), v = m ? m.num * (IMP_UNITS[t.kind][m.unit] ?? 1) : NaN;
    const same = Number.isFinite(v) && (+t.get()).toFixed(d) === (+v).toFixed(d);
    if (inp.classList.contains('meta') !== same) inp.classList.toggle('meta', same);
    const tip = same ? `Matches the metadata (${m.src === 'edit' ? 'typed in Import and Measure' : m.src === 'report' ? 'Set report · ' + m.key : 'EXR · ' + m.key})` : '';
    const base = inp.title.replace(/\n?· Matches the metadata.*$/s, ''), want = tip ? (base ? base + '\n· ' : '· ') + tip : base;
    if (inp.title !== want) inp.title = want;
  }
}
{ const f = updateCamInfo; updateCamInfo = function (...a) { const r = f(...a); impBarMeta(); return r; }; }
// Remove plate: el plate y lo que viene con él (metadata, key, video) se van; la cámara, el scan y los pins quedan,
// y el cuadro sigue con la medida del plate que había (la cámara no cambia de encuadre)
function impRemovePlate() {
  if (st.plate.empty) return;
  const W = st.plate.W, H = st.plate.H;
  exrState = null; camClearMeta(); st.metaCamera = null; st.metaFocal = null;
  plateImg.removeAttribute('src'); plateImg.hidden = true; $('platecv').hidden = true;
  vplClear(); setKey({ on: false });
  $('exr-box').hidden = true; $('orient-row').hidden = true; $('orient-auto-row').hidden = true; $('meta-msg').hidden = true; $('aspect-msg').hidden = true;
  $('cs').value = 'disp'; $('cs').disabled = true;
  st.plate = { W, H, name: '', sample: false, empty: true };
  $('plate-name').textContent = 'No plate'; $('tag').textContent = 'NO PLATE';
  if (typeof drvClear === 'function') { /* el driving plate es otro archivo: queda */ }
  impv.map = {}; impv.plateKey = ''; impv.tgKey = ''; impv.srcKey = '';
  layoutStage(true); applyIntrinsics(); checkAspect(); refreshAll(); impMeta();
  toast('Plate removed: the camera, the scan and the pins stay');
}
// Remove scan: el scan se va; la cámara, el plate y los pins (sus puntos quedan donde estaban) quedan
function impRemoveScan() {
  if (!scanObj) return;
  clearScan(); st.scanName = ''; st.scanFmt = null; st.sample = false;
  $('scan-name').textContent = 'No scan'; $('scan-kv').innerHTML = '';
  ['dx', 'dy', 'dz'].forEach(id => $(id).textContent = '–');
  impv.scanKey = ''; refreshAll(); render();
  toast('Scan removed: the camera, the plate and the pins stay');
}
// mientras Import está abierta, todo render() de la app dibuja el cuadro del scan
{ const f = render; render = function () { if (impv.on) return impRenderScan(); return f(); }; }
impBuild();
