// 3D Assets: cuatro visores 3D (uno se maximiza) con las piezas del entorno elegido en 3D Camera Pin | Environment
// (autos, gente, faroles, fachadas, ventanas, puertas, vagones). Cada visor muestra una pieza como base (la del
// entorno, violeta translúcida) y, encima, el asset importado (OBJ, GLB/glTF o FBX) que la va a reemplazar por uno de
// más calidad. El asset se acomoda al pivote de la base: al importarlo se gira (eje de arriba Z o Y, largo en X o Z)
// para que sus proporciones se parezcan a las de la base, y Fit to base lo escala y lo apoya en el mismo punto (abajo
// al centro en casi todas; la cara de la calle en la fachada; el pie del poste en el farol); después se ajusta a mano.
// Todavía no reemplaza nada en el entorno: lo deja armado para 3D Render (HDRI y sol, más adelante).
// Cada visor, como Maya: arrastrar (con o sin Alt) gira, el botón del medio o Shift desplaza, el derecho o la rueda
// acercan, doble click encuadra. Un solo
// WebGLRenderer fuera de pantalla (se crea al entrar a la pestaña) dibuja los cuatro y se copia a cada canvas 2D.
// Los archivos son de la sesión; el proyecto guarda la pieza de cada visor, el nombre del asset y su transformación
// (en la app de escritorio, también la ruta, y lo vuelve a abrir solo). Reemplaza al visor como VFX Shooting Sup.
// API: a3d, a3dShow, a3dFrame, a3dLoadFile, a3dFiles, a3dProjectState, a3dApplyProject.
const A3D_BASE_MAT = new THREE.MeshLambertMaterial({ color: 0x9b8fd6, transparent: true, opacity: 0.3, depthWrite: false });
const A3D_EDGE_MAT = new THREE.LineBasicMaterial({ color: 0xb9a8ff, transparent: true, opacity: 0.55 });
const A3D_EXT = ['obj', 'glb', 'gltf', 'fbx'];
const a3dBox = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
function a3dCarGeos(id) {
  const t = CAR_TYPES[id], g = carGeoms(t), wheels = [];
  for (const sx of [-1, 1]) for (const z of [-t.wheelbase / 2, t.wheelbase / 2])
    wheels.push(new THREE.CylinderGeometry(t.wheelR, t.wheelR, 0.22, 18).rotateZ(Math.PI / 2).translate(sx * (t.W / 2 - 0.13), t.wheelR, z));
  return [g.body, g.cab, g.roof, ...wheels];
}
// fachada: un edificio de 14 m de frente, 15 de alto y 16 de fondo, con las ventanas y la puerta de la avenida
function a3dBuildingGeos() {
  const W = 14, H = 15, D = 16, out = [a3dBox(W, H, D, 0, H / 2, -D / 2)];
  for (let fy = 3.2; fy + 1.6 < H; fy += 3) for (let fx = -W / 2 + 1; fx + 1.4 < W / 2 - 0.8; fx += 2.6) out.push(a3dBox(1.4, 1.6, 0.08, fx + 0.7, fy + 0.8, 0.03));
  out.push(a3dBox(DOOR_W, DOOR_H, 0.1, 0, DOOR_H / 2, 0.03));
  return out;
}
// pieza: nombre, entornos donde está, la medida que manda al escalar (key), el punto del bounding box que es el
// pivote (anchor: min / c / max por eje), si el pivote no es un punto del bounding box su valor (at) y, si la
// medida real no es la del bounding box, ésa (len: el largo de los autos, sin el bisel del modelo)
const A3D_PIECES = {
  sedan: { name: 'Car · sedan', envs: ['avenue'], key: 'z', len: CAR_TYPES.sedan.L, anchor: ['c', 'min', 'c'], at: [null, 0, null], note: 'Wheels on the ground, centred, front toward −Z.', geos: () => a3dCarGeos('sedan') },
  hatch: { name: 'Car · hatchback', envs: ['avenue'], key: 'z', len: CAR_TYPES.hatch.L, anchor: ['c', 'min', 'c'], at: [null, 0, null], note: 'Wheels on the ground, centred, front toward −Z.', geos: () => a3dCarGeos('hatch') },
  suv: { name: 'Car · SUV', envs: ['avenue'], key: 'z', len: CAR_TYPES.suv.L, anchor: ['c', 'min', 'c'], at: [null, 0, null], note: 'Wheels on the ground, centred, front toward −Z.', geos: () => a3dCarGeos('suv') },
  person: { name: 'Person', envs: ['avenue', 'rail'], key: 'y', anchor: ['c', 'min', 'c'], note: 'Feet on the ground, centred.', geos: () => [PERSON.body, PERSON.legs, PERSON.head] },
  light: { name: 'Street light', envs: ['avenue'], key: 'y', anchor: ['max', 'min', 'c'], note: 'Foot of the pole on the pivot, the arm over the street (−X).',
    geos: () => [a3dBox(0.18, 8, 0.18, 0, 4, 0), a3dBox(2.2, 0.15, 0.25, -1.1, 8, 0), a3dBox(0.5, 0.08, 0.3, -1.9, 7.89, 0)] },
  building: { name: 'Building', envs: ['avenue'], key: 'y', anchor: ['c', 'min', 'max'], note: 'Street face on the pivot, facing +Z, the block behind it.', geos: a3dBuildingGeos },
  window: { name: 'Window', envs: ['avenue'], key: 'y', anchor: ['c', 'min', 'c'], note: '1.4 × 1.6 m, bottom edge on the pivot, facing +Z.', geos: () => [a3dBox(1.4, 1.6, 0.08, 0, 0.8, 0)] },
  door: { name: 'Door', envs: ['avenue'], key: 'y', anchor: ['c', 'min', 'c'], note: `${DOOR_W} × ${DOOR_H} m, sill on the pivot, facing +Z.`, geos: () => [a3dBox(DOOR_W, DOOR_H, 0.1, 0, DOOR_H / 2, 0)] },
  train: { name: 'Train car', envs: ['rail'], key: 'z', anchor: ['c', 'min', 'c'], at: [null, 0, null], note: 'Top of the rail on the pivot, centred, 20 m along Z.', geos: () => Object.values(TRAIN) },
};
const a3dPieces = (id = env.id) => Object.keys(A3D_PIECES).filter(k => A3D_PIECES[k].envs.includes(id));
const a3dT0 = () => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1 });
function a3dCleanT(t) {
  const o = a3dT0(); if (!t || typeof t !== 'object') return o;
  for (const k of Object.keys(o)) if (Number.isFinite(+t[k]) && t[k] !== null && t[k] !== '') o[k] = +t[k];
  if (!(o.s > 0)) o.s = 1;
  return o;
}
function a3dCleanItems(it) {
  const out = {};
  if (it && typeof it === 'object') for (const k of Object.keys(it)) if (A3D_PIECES[k] && it[k] && typeof it[k].name === 'string') out[k] = { name: it[k].name.slice(0, 200), t: a3dCleanT(it[k].t) };
  return out;
}
const a3d = (() => {
  const s = lsGet('a3d', {}) || {};
  return { on: false, views: Array.isArray(s.views) ? s.views.slice(0, 4).map(v => A3D_PIECES[v] ? v : '') : [], max: [0, 1, 2, 3].includes(s.max) ? s.max : -1, cur: [0, 1, 2, 3].includes(s.cur) ? s.cur : 0,
    items: a3dCleanItems(s.items), objs: {}, panes: [], gl: null, raf: 0, pend: '' };
})();
const a3dState = () => ({ views: a3d.views, max: a3d.max, cur: a3d.cur, items: a3d.items });
function a3dSave() { lsSet('a3d', a3dState()); }
const a3dEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const a3dFmt = (v) => (Math.round(v * 100) / 100).toFixed(2);
const a3dDims = (sz) => `X ${a3dFmt(sz.x)} · Y ${a3dFmt(sz.y)} · Z ${a3dFmt(sz.z)} m`;

// ---------- Escena de un visor ----------
function a3dBaseGroup(id) {
  const g = new THREE.Group();
  for (const geo of A3D_PIECES[id].geos()) { g.add(new THREE.Mesh(geo, A3D_BASE_MAT)); g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), A3D_EDGE_MAT)); }
  return g;
}
const a3dBaseBox = {}; // bounding box de cada base (no cambia)
function a3dBaseBB(id) { return a3dBaseBox[id] || (a3dBaseBox[id] = new THREE.Box3().setFromObject(a3dBaseGroup(id))); }
// giro en orden YXZ: X y Z acomodan el eje de arriba del modelo y Y, al final, lo gira alrededor del arriba del mundo
function a3dApplyT(w, t) { w.position.set(t.x, t.y, t.z); w.rotation.set(t.rx * Math.PI / 180, t.ry * Math.PI / 180, t.rz * Math.PI / 180, 'YXZ'); w.scale.setScalar(t.s); w.updateMatrixWorld(true); }
function a3dPaneScene(p) {
  const id = a3d.views[p.i], sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 0.85 * Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI); sun.position.set(6, 12, 8); sc.add(sun);
  p.scene = sc; p.base = null; p.wrap = null; p.id = id;
  if (!id) return;
  const bb = a3dBaseBB(id), size = bb.getSize(new THREE.Vector3()), big = Math.max(size.x, size.y, size.z);
  const n = Math.max(4, Math.ceil(big * 1.6)), grid = new THREE.GridHelper(n * 2, n * 2, 0x5a5f6b, 0x30333a); sc.add(grid);
  const ax = new THREE.AxesHelper(Math.max(0.3, big * 0.12)); ax.material.depthTest = false; ax.renderOrder = 3; sc.add(ax);
  p.base = a3dBaseGroup(id); sc.add(p.base);
  const it = a3d.items[id], obj = a3d.objs[id];
  if (it && obj) { p.wrap = new THREE.Group(); p.wrap.add(a3dCentred(obj.clone(true), obj)); a3dApplyT(p.wrap, it.t); sc.add(p.wrap); }
  a3dVis(p);
}
function a3dVis(p) { if (p.base) p.base.visible = p.showBase; if (p.wrap) p.wrap.visible = p.showAsset; }
// orbita: yaw y pitch en grados alrededor de target, a dist metros
function a3dPlaceCam(p) {
  const o = p.orbit, y = o.yaw * Math.PI / 180, pt = o.pitch * Math.PI / 180;
  p.cam.position.set(o.t.x + o.dist * Math.cos(pt) * Math.sin(y), o.t.y + o.dist * Math.sin(pt), o.t.z + o.dist * Math.cos(pt) * Math.cos(y));
  p.cam.near = Math.max(0.01, o.dist / 500); p.cam.far = o.dist * 50 + 100; p.cam.lookAt(o.t); p.cam.updateProjectionMatrix();
}
function a3dFramePane(p) {
  if (!p.id) return;
  const bb = a3dBaseBB(p.id).clone();
  if (p.wrap && p.showAsset) bb.union(new THREE.Box3().setFromObject(p.wrap));
  const c = bb.getCenter(new THREE.Vector3()), r = bb.getSize(new THREE.Vector3()).length() / 2;
  p.orbit.t.copy(c); p.orbit.dist = Math.max(0.5, r / Math.sin(p.cam.fov * Math.PI / 360) * 1.05);
  a3dPlaceCam(p); a3dDirty();
}
function a3dFrame() { const p = a3d.panes[a3d.cur]; if (p) a3dFramePane(p); }

// ---------- Vista: cuatro visores en lugar del visor ----------
function a3dBuild() {
  const box = document.createElement('div');
  box.className = 'a3v'; box.id = 'a3v'; box.hidden = true; box.dataset.tour = 'assets.view';
  const vmid = document.querySelector('.viewer > .vmid'); vmid.parentNode.insertBefore(box, vmid.nextSibling);
  box.innerHTML = [0, 1, 2, 3].map(i => `<section class="impp a3p" data-i="${i}">
    <header><select data-i="${i}" data-k="piece" aria-label="Piece of viewport ${i + 1}" title="The piece of the environment this viewport shows"></select>
      <span class="note" id="a3-n-${i}"></span>
      <button class="vpchip" data-act="base" data-i="${i}" aria-pressed="true" title="The piece of the environment (translucent violet)">Base</button>
      <button class="vpchip" data-act="asset" data-i="${i}" aria-pressed="true" title="The imported asset">Asset</button>
      <button class="btn sm" data-act="import" data-i="${i}" title="Import an OBJ, GLB / glTF or FBX for this piece (or drop it on the viewport)">Import</button>
      <button class="btn sm ghost a3max" data-act="max" data-i="${i}" aria-pressed="false" aria-label="Maximize viewport ${i + 1}" title="Maximize this viewport (double click the header also does it)"><svg viewBox="0 0 24 24"><path class="a3-out" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path class="a3-in" d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg></button></header>
    <div class="impb a3b" title="Drag (or Alt+drag): orbit · middle button or Shift+drag: pan · right button or wheel: zoom · double click: frame"><canvas id="a3-cv-${i}"></canvas><p class="a3msg" id="a3-msg-${i}"></p><span class="a3dim" id="a3-dim-${i}"></span></div></section>`).join('');
  a3d.panes = [0, 1, 2, 3].map(i => {
    const cv = $('a3-cv-' + i), p = { i, cv, ctx: cv.getContext('2d'), cam: new THREE.PerspectiveCamera(35, 1, 0.01, 1000), orbit: { yaw: 35, pitch: 18, dist: 10, t: new THREE.Vector3() }, showBase: true, showAsset: true, id: null, scene: null };
    a3dNav(p); return p;
  });
  box.addEventListener('click', a3dOnClick);
  box.addEventListener('change', e => { const t = e.target; if (t.dataset.k === 'piece') a3dSetPiece(+t.dataset.i, t.value); });
  box.addEventListener('pointerdown', e => { const s = e.target.closest('.a3p'); if (s && +s.dataset.i !== a3d.cur) { a3d.cur = +s.dataset.i; a3dSave(); a3dPanesUI(); a3dPanel(); } }, true);
  box.addEventListener('dblclick', e => { const h = e.target.closest('.a3p > header'); if (h && !e.target.closest('button, select')) a3dMax(+h.parentNode.dataset.i); });
  // soltar un archivo en un visor: es el asset de su pieza (no va al plate ni al scan)
  box.addEventListener('dragover', e => { if (e.target.closest('.a3p')) { e.preventDefault(); e.stopPropagation(); } });
  box.addEventListener('drop', e => {
    const s = e.target.closest('.a3p'); if (!s) return;
    e.preventDefault(); e.stopPropagation();
    const f = [...(e.dataTransfer.files || [])].find(f => A3D_EXT.includes(f.name.split('.').pop().toLowerCase()));
    if (!f) { toast('Drop an OBJ, GLB / glTF or FBX file', true); return; }
    a3d.cur = +s.dataset.i; a3dLoadFile(f, a3d.views[a3d.cur]);
  });
  const inp = document.createElement('input'); inp.type = 'file'; inp.id = 'f-a3'; inp.hidden = true; inp.accept = A3D_EXT.map(x => '.' + x).join(',');
  inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (f) a3dLoadFile(f, a3d.views[a3d.cur]); };
  document.body.appendChild(inp);
  new ResizeObserver(() => { if (a3d.on) a3dDirty(); }).observe(box);
}
function a3dNav(p) {
  // el mismo Nav que el visor principal (js/navigation.js: Maya, Max, Blender, Game…)
  orbNav({ el: p.cv, cam: p.cam, orbit: () => p.orbit, enabled: () => !!p.id, minDist: 0.05, change: () => { a3dPlaceCam(p); a3dDirty(); } });
  p.cv.addEventListener('dblclick', () => a3dFramePane(p));
}
function a3dOnClick(e) {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = +b.dataset.i, p = a3d.panes[i]; a3d.cur = i;
  if (b.dataset.act === 'import') $('f-a3').click();
  else if (b.dataset.act === 'max') a3dMax(i);
  else if (b.dataset.act === 'base') { p.showBase = !p.showBase; a3dVis(p); a3dPanesUI(); a3dDirty(); }
  else if (b.dataset.act === 'asset') { p.showAsset = !p.showAsset; a3dVis(p); a3dPanesUI(); a3dDirty(); }
  a3dPanel();
}
function a3dMax(i) { a3d.max = a3d.max === i ? -1 : i; a3d.cur = i; a3dSave(); a3dPanesUI(); a3dPanel(); a3dDirty(); }
// la pieza de cada visor: las que tiene el entorno elegido, sin repetir (lo guardado que no está se reemplaza)
function a3dFillViews() {
  const list = a3dPieces();
  const used = new Set(), out = [];
  for (let i = 0; i < 4; i++) { const v = a3d.views[i]; out[i] = list.includes(v) && !used.has(v) ? v : ''; if (out[i]) used.add(out[i]); }
  for (let i = 0; i < 4; i++) if (!out[i]) { const v = list.find(k => !used.has(k)) || ''; out[i] = v; if (v) used.add(v); }
  const changed = out.join() !== a3d.views.join(); a3d.views = out; return changed;
}
function a3dSetPiece(i, id) {
  if (!A3D_PIECES[id]) return;
  const j = a3d.views.indexOf(id);
  if (j >= 0 && j !== i) a3d.views[j] = a3d.views[i]; // la que estaba en otro visor cambia de lugar con ésta
  a3d.views[i] = id; a3d.cur = i; a3dSave();
  for (const p of a3d.panes) if (p.id !== a3d.views[p.i]) { a3dPaneScene(p); a3dFramePane(p); }
  a3dPanesUI(); a3dPanel();
}
function a3dPanesUI() {
  const box = $('a3v'); if (!box) return;
  const list = a3dPieces(), none = !ENV_MODULES[env.id] ? 'Pick an environment in 3D Camera Pin | Environment › Environment › Module: its pieces show up here.'
    : !list.length ? `${ENV_MODULES[env.id].name} has no pieces to replace: it is floor and walls in lines.` : '';
  box.classList.toggle('maxed', a3d.max >= 0);
  for (const p of a3d.panes) {
    const s = box.querySelector(`.a3p[data-i="${p.i}"]`), id = a3d.views[p.i], it = a3d.items[id], has = !!(it && a3d.objs[id]);
    s.classList.toggle('on', p.i === a3d.cur); s.hidden = a3d.max >= 0 && a3d.max !== p.i;
    const sel = s.querySelector('select');
    const opts = list.map(k => `<option value="${k}"${k === id ? ' selected' : ''}>${A3D_PIECES[k].name}</option>`).join('');
    if (sel.innerHTML !== opts) sel.innerHTML = opts;
    sel.disabled = !list.length;
    s.querySelectorAll('button[data-i]').forEach(b => { if (b.dataset.act !== 'max') b.disabled = !id; });
    s.querySelector('[data-act="base"]').setAttribute('aria-pressed', String(p.showBase));
    const ab = s.querySelector('[data-act="asset"]'); ab.setAttribute('aria-pressed', String(p.showAsset && has)); ab.disabled = !has;
    { const m = s.querySelector('[data-act="max"]'), on = a3d.max === p.i; m.setAttribute('aria-pressed', String(on)); m.title = on ? 'Back to the four viewports' : 'Maximize this viewport (double click the header also does it)'; m.setAttribute('aria-label', (on ? 'Restore' : 'Maximize') + ' viewport ' + (p.i + 1)); }
    $('a3-n-' + p.i).textContent = !id ? '' : has ? it.name : it ? it.name + ' (not loaded)' : 'base only';
    $('a3-n-' + p.i).title = $('a3-n-' + p.i).textContent;
    $('a3-msg-' + p.i).textContent = none || (!id ? 'No more pieces in this environment' : has ? '' : it ? `Import ${it.name} again (or drop it here): its fit is saved` : 'Import or drop an OBJ, GLB or FBX to replace this piece');
    $('a3-msg-' + p.i).hidden = !$('a3-msg-' + p.i).textContent;
    const bb = id ? a3dBaseBB(id).getSize(new THREE.Vector3()) : null;
    $('a3-dim-' + p.i).textContent = !id ? '' : 'Base ' + a3dDims(bb) + (p.wrap ? '\nAsset ' + a3dDims(new THREE.Box3().setFromObject(p.wrap).getSize(new THREE.Vector3())) : '');
  }
}
// ---------- Dibujo: un renderer para los cuatro ----------
function a3dDirty() { if (a3d.on && !a3d.raf) a3d.raf = requestAnimationFrame(a3dRenderAll); }
function a3dRenderAll() {
  a3d.raf = 0; if (!a3d.on) return;
  if (!a3d.gl) {
    try { a3d.gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { toast('3D Assets: no WebGL', true); return; }
    a3d.gl.outputColorSpace = THREE.SRGBColorSpace; a3d.gl.setClearColor(0x000000, 0); glKeep(a3d.gl, () => a3dDirty());
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const p of a3d.panes) {
    const b = p.cv.parentNode, w = Math.max(1, Math.round(b.clientWidth * dpr)), h = Math.max(1, Math.round(b.clientHeight * dpr));
    if (!b.offsetParent) continue;
    if (p.cv.width !== w || p.cv.height !== h) { p.cv.width = w; p.cv.height = h; }
    p.cv.style.width = b.clientWidth + 'px'; p.cv.style.height = b.clientHeight + 'px';
    p.ctx.clearRect(0, 0, w, h);
    if (!p.scene || !p.id) continue;
    p.cam.aspect = w / h; p.cam.updateProjectionMatrix();
    a3d.gl.setSize(w, h, false); a3d.gl.render(p.scene, p.cam);
    p.ctx.drawImage(a3d.gl.domElement, 0, 0);
  }
}
function a3dShow(on) {
  if (on === a3d.on) return;
  a3d.on = on; $('a3v').hidden = !on;
  if (on) { a3dEnvChanged(true); a3dPanel(); }
}
function a3dEnvChanged(force) {
  const ch = a3dFillViews();
  if (ch) a3dSave();
  for (const p of a3d.panes) if (force || ch || p.id !== a3d.views[p.i]) { const was = p.id; a3dPaneScene(p); if (was !== p.id || !p.framed) { a3dFramePane(p); p.framed = true; } }
  a3dPanesUI(); a3dDirty();
}
{ const f = envRebuild; envRebuild = function (...a) { const r = f(...a); if (a3d.on) { a3dEnvChanged(false); a3dPanel(); } return r; }; }

// ---------- Importar y acomodar ----------
async function a3dParse(f) {
  const ext = f.name.split('.').pop().toLowerCase(), buf = await f.arrayBuffer();
  if (ext === 'glb' || ext === 'gltf') return new Promise((res, rej) => makeGLTFLoader().parse(buf, '', g => res(g.scene), rej));
  if (ext === 'fbx') return new THREE.FBXLoader().parse(buf, '');
  return new THREE.OBJLoader().parse(new TextDecoder().decode(buf));
}
// el asset con el centro de su bounding box en el origen: gira y escala sobre su centro, no sobre el origen del
// archivo (que puede estar lejos); la transformación (t) dice dónde queda ese centro
function a3dCentred(o, src) { const g = new THREE.Group(), c = src.userData.a3dC || [0, 0, 0]; g.position.set(-c[0], -c[1], -c[2]); g.add(o); return g; }
// bounding box del asset con un giro (sin escala ni corrimiento)
function a3dRotBB(obj, t) {
  const g = new THREE.Group(); a3dApplyT(g, { ...a3dT0(), rx: t.rx, ry: t.ry, rz: t.rz });
  const par = obj.parent, inner = a3dCentred(obj, obj); g.add(inner); g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(obj, true); inner.remove(obj); if (par) par.add(obj);
  return bb;
}
const a3dPick = (bb, a, k) => a === 'min' ? bb.min[k] : a === 'max' ? bb.max[k] : (bb.min[k] + bb.max[k]) / 2;
// Fit to base: misma medida en el eje que manda (key) y el pivote del asset sobre el de la base; el giro queda
function a3dFitT(id, obj, t) {
  const P = A3D_PIECES[id], base = a3dBaseBB(id), bb = a3dRotBB(obj, t), ax = ['x', 'y', 'z'];
  const ks = bb.max[P.key] - bb.min[P.key], kb = P.len || base.max[P.key] - base.min[P.key];
  const s = ks > 1e-9 ? kb / ks : 1, o = { ...t, s };
  ax.forEach((k, i) => { const to = P.at && P.at[i] !== null && P.at[i] !== undefined ? P.at[i] : a3dPick(base, P.anchor[i], k); o[k] = to - s * a3dPick(bb, P.anchor[i], k); });
  return o;
}
// al importar: el giro (eje de arriba Z o Y; largo en X o Z) cuyas proporciones se parecen más a las de la base
function a3dOrient(id, obj) {
  const P = A3D_PIECES[id], bs = a3dBaseBB(id).getSize(new THREE.Vector3());
  let best = null;
  for (const rx of [0, -90]) for (const ry of [0, 90]) {
    const sz = a3dRotBB(obj, { rx, ry, rz: 0 }).getSize(new THREE.Vector3());
    if (!(sz[P.key] > 1e-9)) continue;
    const k = bs[P.key] / sz[P.key];
    const score = ['x', 'y', 'z'].reduce((a, ax) => a + Math.abs(Math.log(Math.max(1e-3, sz[ax] * k) / Math.max(1e-3, bs[ax]))), 0);
    if (!best || score < best.score - 0.3) best = { rx, ry, score };
  }
  return best || { rx: 0, ry: 0 };
}
async function a3dLoadFile(f, id) {
  let obj;
  try { obj = await a3dParse(f); } catch (e) { console.error(e); toast('Could not read ' + f.name + ': ' + (e && e.message || e), true); return; }
  obj.updateMatrixWorld(true); obj.userData.a3dName = f.name;
  const raw = new THREE.Box3().setFromObject(obj, true);
  if (raw.isEmpty()) { toast(f.name + ' has no geometry', true); return; }
  obj.userData.a3dC = raw.getCenter(new THREE.Vector3()).toArray();
  // sin pieza (al abrir un proyecto): la que guardó este archivo
  const ids = id ? [id] : Object.keys(a3d.items).filter(k => a3d.items[k].name === f.name);
  if (!ids.length) return;
  for (const k of ids) {
    const it = a3d.items[k];
    a3d.objs[k] = obj;
    if (it && it.name === f.name) continue; // vuelve con su ajuste guardado
    const o = a3dOrient(k, obj), t = a3dFitT(k, obj, { ...a3dT0(), rx: o.rx, ry: o.ry });
    a3d.items[k] = { name: f.name, t };
    toast(`${f.name} fitted to the ${A3D_PIECES[k].name.toLowerCase()}: scale ${t.s.toFixed(3)}${o.rx || o.ry ? `, turned ${[o.rx && 'X ' + o.rx + '°', o.ry && 'Y ' + o.ry + '°'].filter(Boolean).join(', ')}` : ''}`);
  }
  a3dSave(); a3dRefreshPanes(ids); a3dPanel();
  if (id && $('a3').classList.contains('closed')) $('a3').querySelector('h2').click(); // el ajuste a la vista
}
function a3dRefreshPanes(ids) {
  for (const p of a3d.panes) if (ids.includes(p.id)) { p.showAsset = true; a3dPaneScene(p); }
  a3dPanesUI(); a3dDirty();
}
const a3dFiles = () => Object.keys(a3d.objs).filter(k => a3d.items[k]).map(k => a3d.items[k].name);

// ---------- Panel ----------
function a3dPanel() {
  const sec = $('a3'); if (!sec) return;
  const list = a3dPieces(), id = a3d.views[a3d.cur], P = A3D_PIECES[id], it = a3d.items[id], has = !!(it && a3d.objs[id]);
  $('a3-st').textContent = list.length ? `${list.filter(k => a3d.items[k]).length} / ${list.length}` : '';
  $('a3-env').textContent = !ENV_MODULES[env.id] ? 'No environment: pick one in 3D Camera Pin | Environment › Environment › Module.' : `Pieces of ${ENV_MODULES[env.id].name}:`;
  $('a3-list').innerHTML = list.map(k => { const x = a3d.items[k], l = x && a3d.objs[k];
    return `<button class="btn sm${k === id ? ' on' : ''}" data-piece="${k}" aria-pressed="${k === id}" title="Show it in the selected viewport">${A3D_PIECES[k].name}<span class="note">${x ? a3dEsc(x.name) + (l ? '' : ' (not loaded)') : 'base'}</span></button>`; }).join('');
  $('a3-sel').hidden = !P;
  if (!P) return;
  $('a3-piece').textContent = `Viewport ${a3d.cur + 1}: ${P.name}`;
  $('a3-pivot').textContent = 'Pivot: ' + P.note + ' Base ' + a3dDims(a3dBaseBB(id).getSize(new THREE.Vector3())) + '.';
  $('a3-file').textContent = it ? it.name + (has ? '' : ' (not loaded: import it again)') : 'No asset: the piece stays as it is.';
  const t = it ? it.t : a3dT0();
  for (const k of Object.keys(t)) { const el = $('a3-' + k); if (el && document.activeElement !== el) el.value = k === 's' ? +t.s.toFixed(4) : +t[k].toFixed(k[0] === 'r' ? 1 : 3); }
  $('a3-xf').classList.toggle('off', !it);
  $('a3-xf').querySelectorAll('input, button').forEach(el => { el.disabled = !it; });
  $('a3-fit').disabled = !has; $('a3-del').disabled = !it;
}
function a3dSetT(patch) {
  const id = a3d.views[a3d.cur], it = a3d.items[id]; if (!it) return;
  it.t = a3dCleanT({ ...it.t, ...patch }); a3dSave();
  for (const p of a3d.panes) if (p.id === id && p.wrap) a3dApplyT(p.wrap, it.t);
  a3dPanesUI(); a3dPanel(); a3dDirty();
}
{
  $('a3-list').addEventListener('click', e => { const b = e.target.closest('[data-piece]'); if (b) { const j = a3d.views.indexOf(b.dataset.piece); if (j >= 0) { a3d.cur = j; a3dSave(); a3dPanesUI(); a3dPanel(); } else a3dSetPiece(a3d.cur, b.dataset.piece); } });
  for (const k of Object.keys(a3dT0())) $('a3-' + k).addEventListener('change', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) a3dSetT({ [k]: v }); else a3dPanel(); });
  $('a3-xf').addEventListener('click', e => {
    const b = e.target.closest('[data-rot]'); if (!b) return;
    const id = a3d.views[a3d.cur], it = a3d.items[id]; if (!it) return;
    const k = b.dataset.rot, v = ((it.t[k] + +b.dataset.by) % 360 + 540) % 360 - 180;
    a3dSetT({ [k]: v === -180 ? 180 : v });
  });
  $('a3-fit').onclick = () => { const id = a3d.views[a3d.cur], it = a3d.items[id], obj = a3d.objs[id]; if (it && obj) a3dSetT(a3dFitT(id, obj, it.t)); };
  $('a3-imp').onclick = () => { if (a3d.views[a3d.cur]) $('f-a3').click(); };
  $('a3-del').onclick = () => { const id = a3d.views[a3d.cur]; if (!a3d.items[id]) return; delete a3d.items[id]; delete a3d.objs[id]; a3dSave(); a3dRefreshPanes([id]); a3dPanel(); };
  $('a3-frame').onclick = () => a3dFrame();
  a3dBuild();
}
// ---------- Proyecto ----------
function a3dProjectState() { return JSON.parse(JSON.stringify(a3dState())); }
function a3dApplyProject(s) {
  if (!s || typeof s !== 'object') return;
  a3d.items = a3dCleanItems(s.items);
  for (const k of Object.keys(a3d.objs)) if (!a3d.items[k] || a3d.items[k].name !== a3d.objs[k].userData.a3dName) delete a3d.objs[k];
  a3d.views = Array.isArray(s.views) ? s.views.slice(0, 4).map(v => A3D_PIECES[v] ? v : '') : [];
  a3d.max = [0, 1, 2, 3].includes(s.max) ? s.max : -1; a3d.cur = [0, 1, 2, 3].includes(s.cur) ? s.cur : 0;
  a3dSave();
  if (a3d.on) { a3dEnvChanged(true); a3dPanel(); }
}
