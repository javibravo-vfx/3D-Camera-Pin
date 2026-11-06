// Cars in lanes (DepthLab, debajo de Compare with the 3D): autos 3D de verdad sobre los carriles de la avenida, para
// juzgar la escala del plate contra ellos (D-06). Son los modelos de la colección del entorno (el car pack, el mismo
// del tráfico); el botón del modelo los va alternando. Add car pone uno delante de la cámara, en el carril de la toma;
// Lane lo pasa de carril (se arrastra el número, o ‹ ›) y Along lo corre a lo largo de la calle. Con Moves with the
// street viajan con la calle cuando hay motion (como los estacionados); sin eso quedan a la par de la cámara. El ojo
// de cada uno lo oculta, y el chip Cars in lanes de la caja de DepthLab los prende y apaga a todos.
// Viven dentro del entorno (envRoot): se ven en el visor, en Defocus, en Depth y en las 3D Guides (marcados 'cars');
// en el estilo Lines de las 3D Guides cada uno es una caja en wireframe con su medida (js/ghost.js).
// La gente va con Figure (S). API: lc, lcBuild (la llama envRebuild), lcBoxes, lcProjectState, lcApplyProject.
const LC_MODELS = Object.keys(PACK_WEIGHTS); // sedan, hatchback, suv… en el orden del pack
const LC_FALLBACK = { sedan: 'sedan', hatchback: 'hatch', compact: 'hatch', suv: 'suv', offroad: 'suv', pickup: 'suv', minivan: 'suv' }; // sin el pack, la caja simple más parecida
const lcCarClean = (c, i) => ({ id: i + 1, lane: Math.max(1, Math.round(+c.lane)), along: +c.along, moves: c.moves !== false, show: c.show !== false,
  model: LC_MODELS.includes(c.model) ? c.model : LC_MODELS[i % LC_MODELS.length] });
const lcCarsOf = (a) => (Array.isArray(a) ? a : []).filter(c => c && Number.isFinite(+c.lane) && Number.isFinite(+c.along)).map(lcCarClean);
const lc = (() => {
  const s = lsGet('lanecars', null) || {}, cars = lcCarsOf(s.cars);
  return { on: s.on !== false, cars, next: cars.length + 1, info: {} };
})();
const lcPlain = () => lc.cars.map(({ lane, along, moves, show, model }) => ({ lane, along, moves, show, model }));
function lcSave() { lsSet('lanecars', { on: lc.on, cars: lcPlain() }); }
const lcColor = (id) => CAR_COLORS[(id * 3 + 2) % CAR_COLORS.length];
// medidas de cada modelo (largo, ancho, alto), de sus piezas; sin el pack, las de la caja simple
const LC_DIMS = {};
function lcDims(model) {
  if (LC_DIMS[model]) return LC_DIMS[model];
  const p = PACK.state === 'ok' && PACK.cars[model];
  if (!p) { const t = CAR_TYPES[LC_FALLBACK[model] || 'sedan']; return { L: t.L, W: t.W, H: t.H, min: [-t.W / 2, 0, -t.L / 2], max: [t.W / 2, t.H, t.L / 2] }; }
  const b = new THREE.Box3();
  for (const pt of p.parts) { if (!pt.geometry.boundingBox) pt.geometry.computeBoundingBox(); b.union(pt.geometry.boundingBox.clone().applyMatrix4(pt.matrix)); }
  const s = b.getSize(new THREE.Vector3());
  return LC_DIMS[model] = { L: s.z, W: s.x, H: s.y, min: b.min.toArray(), max: b.max.toArray() };
}
// carriles de izquierda a derecha (1 = junto al cordón izquierdo), como Shot car lane
function lcLanes() { return env.id === 'avenue' && ENV_MODULES.avenue ? avenueLayout(env.vals).lanes.slice().sort((a, b) => a.x - b.x) : []; }
// la cámara en el marco de la calle sin el movimiento: dónde está y hacia qué lado de la calle mira
function lcCamSpot() {
  const Si = ghStreet().invert();
  const p = camera.position.clone().applyMatrix4(Si), f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).transformDirection(Si);
  return { x: p.x, z: p.z, sgn: f.z <= 0 ? -1 : 1 };
}
let lcPackWait = 0;
// Cars in lanes nace en Compare and Match y se ve de ahí hacia la derecha (DepthLab); no en las pestañas de la izquierda
const lcTabOn = () => typeof mtabCur === 'undefined' || ['compare', 'depthlab', 'render3d'].includes(mtabCur);
function lcTabApply() { const on = lcTabOn(); for (const o of envRoot.children) if (o.userData.lc && o.visible !== on) o.visible = on; }
function lcBuild() {
  lc.info = {};
  const lanes = lcLanes(); if (!lanes.length || !lc.cars.length) return null;
  const L = avenueLayout(env.vals), cam = lcCamSpot();
  for (const c of lc.cars) {
    const ln = lanes[Math.min(lanes.length, c.lane) - 1];
    lc.info[c.id] = { x: ln.x, y: L.crownY(ln.x), roll: Math.atan(L.crownS(ln.x)), z: cam.z + cam.sgn * c.along, dir: ln.dir };
  }
  const shown = lc.on ? lc.cars.filter(c => c.show) : [];
  if (!shown.length) return null;
  // la colección del entorno; si todavía no está, se pide y mientras tanto van las cajas simples
  if (PACK.state === 'idle') loadPack();
  if (PACK.state === 'loading' && !lcPackWait) lcPackWait = setInterval(() => { if (PACK.state !== 'loading') { clearInterval(lcPackWait); lcPackWait = 0; if (PACK.state === 'ok') lcRefresh(); } }, 300);
  const pack = PACK.state === 'ok' ? LC_MODELS.map(k => PACK.cars[k]).filter(Boolean) : null;
  const root = new THREE.Group(); root.visible = lcTabOn(); root.userData.lc = true; root.userData.guide = 'lcars'; // en las 3D Guides con Show › Cars; en VFX no van
  for (const moves of [true, false]) {
    const list = shown.filter(c => c.moves === moves).map(c => {
      const i = lc.info[c.id], car = { x: i.x, y: i.y, roll: i.roll, z: i.z, dir: i.dir, k: 1, color: lcColor(c.id) };
      if (pack) car.model = pack.indexOf(PACK.cars[c.model]); else car.type = LC_FALLBACK[c.model] || 'sedan';
      return car;
    });
    if (!list.length) continue;
    const g = pack ? buildUserCars(list, false, pack) : buildCars(list);
    if (!moves) g.userData.fixed = true; // a la par de la cámara: applyMotion le resta el corrimiento de la calle (js/timeline.js)
    root.add(g);
  }
  return root;
}
// rearmar sólo los autos (sin rehacer la calle)
function lcRefresh() {
  for (const c of envRoot.children.filter(o => o.userData.lc)) { envRoot.remove(c); c.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
  const g = ENV_MODULES[env.id] && envRoot.children.length ? lcBuild() : null;
  if (g) envRoot.add(g);
  applyMotion(); envMixApply(false); render(); drawOverlay(); lcUI();
}
function lcSet(fn) { fn(); lcSave(); lcRefresh(); }
function lcAdd() {
  const lanes = lcLanes();
  if (!lanes.length) { toast('Cars in lanes: pick Avenue / street in Environment › Module first', true); return; }
  const cam = lcCamSpot(), own = lanes.reduce((b, l, i) => Math.abs(l.x - cam.x) < Math.abs(lanes[b].x - cam.x) ? i : b, 0);
  const last = lc.cars[lc.cars.length - 1];
  lcSet(() => { lc.on = true; lc.cars.push({ id: lc.next, lane: own + 1, along: last ? Math.round((last.along + 8) * 10) / 10 : 10, moves: true, show: true, model: LC_MODELS[(lc.next - 1) % LC_MODELS.length] }); lc.next++; });
}
function lcToggle(on = !lc.on) { lcSet(() => { lc.on = on; }); }
// la matriz de un auto: los que viajan, con la calle de este cuadro; los que van a la par, con la calle sin el movimiento
function lcFrame(c) { envRoot.updateMatrixWorld(true); return c.moves ? envRoot.matrixWorld : ghStreet(); }
// distancia a la cámara sobre el eje óptico (desde el centro del auto)
function lcDepth(id) {
  const i = lc.info[id], c = lc.cars.find(q => q.id === id); if (!i || !c) return null;
  const d = lcDims(c.model), w = new THREE.Vector3(i.x, i.y + d.H / 2, i.z).applyMatrix4(lcFrame(c));
  return -w.applyMatrix4(camera.matrixWorldInverse).z;
}
const lcBlur = (d) => typeof lensCocShotPx === 'function' && d ? lensCocShotPx(d) * (typeof bkK === 'function' ? bkK() : 1) : NaN;
// para las 3D Guides: la caja de cada auto (sus 8 esquinas en el mundo, como «Display as box» de un programa 3D), con
// su medida y su distancia. También la de los ocultos (su ojo o el chip Cars in lanes): hidden dice cuáles son
function lcBoxes() {
  return lc.cars.map((c, n) => ({ c, n })).filter(({ c }) => lc.info[c.id]).map(({ c, n }) => {
    const i = lc.info[c.id], d = lcDims(c.model), M = lcFrame(c), cos = Math.cos(i.roll), sin = Math.sin(i.roll), f = i.dir > 0 ? 1 : -1;
    // el auto girado según su sentido y con la inclinación del bombeo, como lo arma buildUserCars
    const P = (x, y, z) => { x *= f; z *= f; return new THREE.Vector3(i.x + x * cos - y * sin, i.y + x * sin + y * cos, i.z + z).applyMatrix4(M); };
    const corners = [];
    for (const y of [d.min[1], d.max[1]]) for (const [x, z] of [[d.min[0], d.min[2]], [d.max[0], d.min[2]], [d.max[0], d.max[2]], [d.min[0], d.max[2]]]) corners.push(P(x, y, z));
    const dm = lcDepth(c.id);
    return { name: `Car ${n + 1}`, lane: c.lane, hidden: !lc.on || !c.show, d, corners, foot: P(0, d.min[1], 0), head: P(0, d.max[1], 0), depth: dm, blur: lcBlur(dm) };
  });
}
function lcUI() {
  const box = $('lc-list'); if (!box) return;
  const lanes = lcLanes(), n = lanes.length;
  $('lc-st').textContent = !n ? 'no street' : !lc.cars.length ? 'none' : `${lc.cars.length} car${lc.cars.length > 1 ? 's' : ''}${lc.on ? '' : ' · off'}`;
  $('lc').dataset.state = n && lc.cars.length && lc.on ? 'ok' : '';
  $('lc-add').disabled = !n;
  { const ch = $('lc-chip'); if (ch && ch.getAttribute('aria-pressed') !== String(lc.on)) ch.setAttribute('aria-pressed', String(lc.on)); }
  const key = lc.cars.map(c => c.id).join() + '|' + n;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = lc.cars.map((c, i) => `<div class="lc-row" data-id="${c.id}"><button class="btn sm ghost lc-eye" data-a="eye" aria-label="Show or hide car ${i + 1}" title="Show or hide this car"></button><i class="lc-sw" style="background:#${lcColor(c.id).toString(16).padStart(6, '0')}"></i><b>Car ${i + 1}</b>`
      + `<button class="btn sm lc-model" data-a="model" id="lc-model-${i + 1}" title="Model of the car, from the collection of the environment (click: the next one)"></button>`
      + `<span class="lc-lane" title="Lane, counted from the left curb (1 = next to the left curb). Drag the number or use the arrows to move the car from lane to lane."><span>Lane</span><button class="btn sm ghost" data-a="prev" aria-label="Lane to the left">‹</button><input type="number" class="mini" id="lc-lane-${i + 1}" data-k="lane" step="1" min="1" aria-label="Lane of car ${i + 1}"><button class="btn sm ghost" data-a="next" aria-label="Lane to the right">›</button></span>`
      + `<label class="lc-along" title="Distance in front of the camera along the street. Drag or type.">Along <input type="number" class="mini" id="lc-along-${i + 1}" data-k="along" step="0.1" data-unit="m" aria-label="Along the street, car ${i + 1}"></label>`
      + `<label class="chk" title="With motion on, the car travels with the street (like a parked car). Off: it keeps pace with the camera."><input type="checkbox" data-k="moves"> Moves with the street</label>`
      + `<button class="btn sm ghost lc-x" data-a="del" aria-label="Remove car ${i + 1}" title="Remove this car">×</button><span class="note lc-i"></span></div>`).join('');
    enhanceNumbers(box);
  }
  const eye = (on) => `<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/>${on ? '<circle cx="12" cy="12" r="2.6"/>' : '<path d="M4 20 20 4"/>'}</svg>`;
  for (const c of lc.cars) {
    const row = box.querySelector(`.lc-row[data-id="${c.id}"]`); if (!row) continue;
    const sv = (k, v) => { const el = row.querySelector(`[data-k="${k}"]`); if (document.activeElement !== el) { if (el.type === 'checkbox') el.checked = v; else el.value = v; } };
    sv('lane', Math.min(n || 1, c.lane)); sv('along', +c.along.toFixed(1)); sv('moves', c.moves);
    row.querySelector('[data-k="lane"]').max = n || 1;
    const e = row.querySelector('[data-a="eye"]'); if (e.getAttribute('aria-pressed') !== String(c.show)) { e.setAttribute('aria-pressed', String(c.show)); e.innerHTML = eye(c.show); }
    row.classList.toggle('lc-off', !c.show || !lc.on);
    const d = lcDims(c.model), mt = `${c.model} · ${d.L.toFixed(2)} × ${d.W.toFixed(2)} × ${d.H.toFixed(2)} m`, mb = row.querySelector('[data-a="model"]');
    if (mb.textContent !== c.model) mb.textContent = c.model; if (mb.title !== mt) mb.title = `${mt}. Click: the next model of the collection of the environment`;
    const dm = lcDepth(c.id);
    const t = !n ? '' : dm === null ? '' : dm <= 0 ? 'behind the camera' : `${dm.toFixed(1)} m from the camera · ${ghBlurTxt(lcBlur(dm))} · ${d.L.toFixed(2)} × ${d.H.toFixed(2)} m`;
    const el = row.querySelector('.lc-i'); if (el.textContent !== t) el.textContent = t;
  }
  const note = !n ? 'Cars in lanes need Avenue / street in Environment › Module.' : 'Distance from the camera along the optical axis; blur with the lens of the shot. People go with Figure (S).';
  if ($('lc-note').textContent !== note) $('lc-note').textContent = note;
}
{
  const box = $('lc-list');
  const carOf = (el) => { const r = el.closest('.lc-row'); return r && lc.cars.find(c => c.id === +r.dataset.id); };
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'), c = b && carOf(b); if (!c) return;
    const n = lcLanes().length, a = b.dataset.a;
    if (a === 'del') lcSet(() => { lc.cars = lc.cars.filter(q => q !== c); });
    else if (a === 'eye') lcSet(() => { c.show = !c.show; });
    else if (a === 'model') lcSet(() => { c.model = LC_MODELS[(LC_MODELS.indexOf(c.model) + 1) % LC_MODELS.length]; });
    else lcSet(() => { c.lane = Math.min(n, Math.max(1, Math.min(n, c.lane) + (a === 'next' ? 1 : -1))); });
  });
  const edit = (e) => {
    const el = e.target, c = carOf(el); if (!c || !el.dataset.k) return;
    if (el.dataset.k === 'moves') lcSet(() => { c.moves = el.checked; });
    else { const v = +el.value; if (!Number.isFinite(v)) return; lcSet(() => { if (el.dataset.k === 'lane') c.lane = Math.min(lcLanes().length || 1, Math.max(1, Math.round(v))); else c.along = Math.min(2000, Math.max(-2000, v)); }); }
  };
  box.addEventListener('input', e => { if (e.target.type === 'number') edit(e); });
  box.addEventListener('change', edit);
  $('lc-add').onclick = lcAdd;
  $('lc-chip').onclick = () => lcToggle();
  { const f = drawOverlay; drawOverlay = function (...a) { const r = f(...a); lcUI(); return r; }; }
  lcUI();
}
// hook project: los autos viajan con el proyecto
function lcProjectState() { return { on: lc.on, cars: lcPlain() }; }
function lcApplyProject(o) {
  lc.cars = lcCarsOf(o && o.cars); lc.on = !o || o.on !== false;
  lc.next = lc.cars.length + 1; lcSave(); lcRefresh();
}
// Con el driving plate prendido, los autos de Cars in lanes van encima del driving y debajo del plate: una capa
// propia (#lc-gl) con sólo esos autos, dibujada con las luces del entorno (envScene). La llama drvRender.
let lcOver = null;
function lcOverDrive(show) {
  const root = envRoot.children.find(o => o.userData.lc);
  const on = show && !!root && root.visible && lc.on;
  if (!lcOver) {
    if (!on) return;
    const cv = document.createElement('canvas'); cv.id = 'lc-gl'; cv.className = 'lc-gl'; cv.setAttribute('aria-hidden', 'true');
    $('drv-gl').after(cv);
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
    r.setClearColor(0x000000, 0); r.outputColorSpace = THREE.SRGBColorSpace;
    lcOver = { cv, r };
  }
  if (lcOver.cv.hidden === on) lcOver.cv.hidden = !on;
  if (!on) return;
  const v = st.view, pr = renderer.getPixelRatio(), r = lcOver.r;
  if (r.getPixelRatio() !== pr) r.setPixelRatio(pr);
  const sz = r.getSize(new THREE.Vector2()); if (sz.x !== v.baseW || sz.y !== v.baseH) r.setSize(v.baseW, v.baseH, false);
  // sólo los autos: el resto del entorno apagado un momento, en la escena con las luces del entorno
  const par = envRoot.parent, vis = envRoot.visible, off = envRoot.children.filter(o => o !== root && o.visible);
  off.forEach(o => { o.visible = false; }); envRoot.visible = true; envScene.add(envRoot);
  try { r.render(envScene, camera); } finally { par.add(envRoot); envRoot.visible = vis; off.forEach(o => { o.visible = true; }); }
}
