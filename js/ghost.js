// ghost (3D Guides): comparar el plate (o el driving plate) contra el 3D, que es la referencia (D-06). Dos estilos,
// con las mismas partes para prender y apagar (Show: Horizon, Lanes, Curbs, Facades, People, Cars):
// - Hidden line (el de arranque): las líneas de todo el entorno 3D, cualquiera sea (calle, fachadas, puertas, gente,
//   autos, vías), sólo lo que la cámara ve (js/guides.js), más el horizonte.
// - Lines: sólo de la avenida, las líneas de la calle 3D (horizonte, carriles, cordones, pie y techo de las
//   fachadas, punto de fuga de la calle) y los autos de Cars in lanes (js/lane-cars.js) como cajas en wireframe con
//   su medida, su distancia y su desenfoque con la lente de la toma.
// Respeta el key: una copia va DEBAJO del plate (se ve entera por las ventanillas) y otra encima, tenue, sobre el FG.
// Sigue la reproducción: los techos y los autos que viajan se mueven con la calle.
// Trazado de la calle: js/street-layout.js (el mismo que arma environment.js). API: gh, ghDraw, ghSet, ghStreet,
// ghProjectState, ghApplyProject.

// [clave, nombre, muestra, estilo en que va (todos si falta)]
const GH_LINES = [['horizon', 'Horizon', 'hz'], ['lanes', 'Lanes', 'ln'], ['curbs', 'Curbs', 'cb'], ['facades', 'Facades', 'fb'], ['people', 'People', 'person', 'hidden'], ['cars', 'Cars', 'car'], ['vp', 'VP street', 'vp', 'lines']];
const GH_NEAR = 0.05;
const GH_COLORS = [['#ffffff', 'White'], ['#ffd54a', 'Yellow'], ['#39e07a', 'Green'], ['#3ad8ff', 'Cyan'], ['#ff4fa3', 'Magenta'], ['#000000', 'Black']];
const ghHidden = () => gh.mode === 'hidden';
const ghShowOf = (o) => Object.assign({ horizon: true, lanes: true, curbs: true, facades: true, people: true, cars: true, vp: true }, o && o.show || {}, o && o.parts || {}); // parts: hidden line de v0.054
const gh = (() => {
  const s = lsGet('ghost', {}) || {};
  const num = (v, d) => Number.isFinite(+v) && v !== null && v !== '' ? Math.min(1, Math.max(0, +v)) : d;
  return { on: false, op: Math.max(0.1, num(s.op, 0.9)), fg: num(s.fg, 0.25),
    mode: s.mode === 'lines' ? 'lines' : 'hidden', color: GH_COLORS.some(c => c[0] === s.color) ? s.color : GH_COLORS[0][0],
    show: ghShowOf(s), street: false };
})();
function ghSave() { lsSet('ghost', { op: gh.op, fg: gh.fg, mode: gh.mode, color: gh.color, show: gh.show }); }

// el marco de la calle sin el movimiento (lo que no viaja con la calle); el de envRoot sí se mueve
function ghStreet() { const b = envBase(), m = new THREE.Matrix4().makeRotationY(b.rot); m.setPosition(b.x, b.y, b.z); return m; }
const ghCam = (w) => w.clone().applyMatrix4(camera.matrixWorldInverse);
const ghPx = (c) => { const q = c.clone().applyMatrix4(camera.projectionMatrix); return [(q.x + 1) / 2 * st.plate.W, (1 - q.y) / 2 * st.plate.H]; };
// segmento del mundo -> px del plate, recortado contra el plano cercano y contra el cuadro
function ghSeg(a, b, R) {
  let ca = ghCam(a), cb = ghCam(b);
  if (ca.z > -GH_NEAR && cb.z > -GH_NEAR) return null;
  if (ca.z > -GH_NEAR || cb.z > -GH_NEAR) { const t = (-GH_NEAR - ca.z) / (cb.z - ca.z), cut = ca.clone().lerp(cb, t); if (ca.z > -GH_NEAR) ca = cut; else cb = cut; }
  return scClip([...ghPx(ca), ...ghPx(cb)], R);
}
const ghPt = (w) => { const c = ghCam(w); return c.z > -GH_NEAR ? null : ghPx(c); };
const ghEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ghBlurTxt = (px) => !Number.isFinite(px) ? '' : `ø${px < 10 ? px.toFixed(1) : Math.round(px)} ${typeof bkUnit === 'function' && bkUnit() !== 'plate px' ? bkUnit() : 'px'}`;
const ghMeasure = document.createElement('canvas').getContext('2d');

// ---------- Geometría (px del plate) ----------
function ghGeometry() {
  const W = st.plate.W, H = st.plate.H, R = [0, 0, W, H], paths = [], refs = [], tags = [];
  camera.updateMatrixWorld();
  const add = (cls, l) => { if (l) paths.push([cls, l]); };
  if (gh.show.horizon) { const h = sceneCam().horizon(); if (h) add('hz', scClip(h, R)); }
  if (ghHidden()) { gh.street = !!ENV_MODULES[env.id]; ghCarBoxes(add, refs, R, true); return { paths, refs, tags }; }
  const mod = env.id === 'avenue' && ENV_MODULES.avenue;
  gh.street = !!mod;
  if (!mod) return { paths, refs, tags };
  const p = env.vals, L = avenueLayout(p), S = ghStreet(), V = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(S);
  const along = (cls, x, y) => add(cls, ghSeg(V(x, y, -800), V(x, y, 800), R));
  if (gh.show.lanes) { L.dashes.forEach(x => along('ln', x, L.crownY(x))); L.centre.forEach(([x, yellow]) => along(yellow ? 'cl' : 'cw', x, L.crownY(x))); }
  const walk = (p.walk || 0) > 0;
  if (gh.show.curbs) for (const s of [1, -1]) { along('cb', L.edgeX(s), L.edgeY(s)); if (walk) along('cb2', L.edgeX(s), L.walkY(s)); }
  if (gh.show.facades && p.buildings) {
    for (const s of [1, -1]) along('fb', L.faceX(s), L.walkY(s));
    // techos de cada edificio, como están en este cuadro (se mueven con la calle al reproducir)
    const g = envRoot.children[0], roofs = g && g.userData.ghost ? g.userData.ghost.roofs : [];
    envRoot.updateMatrixWorld(true);
    const M = envRoot.matrixWorld, cp = camera.position;
    for (const [x, y, z0, z1] of roofs) {
      const a = new THREE.Vector3(x, y, z0).applyMatrix4(M), b = new THREE.Vector3(x, y, z1).applyMatrix4(M);
      if (Math.min(a.distanceTo(cp), b.distanceTo(cp)) > 250) continue;
      add('fr', ghSeg(a, b, R));
    }
  }
  if (gh.show.vp) for (const dz of [-1, 1]) {
    const d = new THREE.Vector3(0, 0, dz).transformDirection(S).transformDirection(camera.matrixWorldInverse);
    if (d.z >= -1e-6) continue;
    const q = ghPx(d.multiplyScalar(1e5));
    if (q[0] >= 0 && q[1] >= 0 && q[0] <= W && q[1] <= H) tags.push({ cls: 'vp', at: q, text: 'VP street' });
  }
  ghCarBoxes(add, refs, R, false);
  return { paths, refs, tags };
}
// ---------- Cars in lanes: cada auto como una caja (Display as box), con su medida ----------
// En Lines van todos; en Hidden line sólo los ocultos (los que se ven ya salen en las líneas del entorno). Un auto
// oculto (su ojo o el chip Cars in lanes) no está en el 3D pero su caja sí, si Show › Cars está prendido.
function ghCarBoxes(add, refs, R, onlyHidden) {
  if (!gh.show.cars || typeof lcBoxes !== 'function') return;
  const W = R[2], H = R[3];
  for (const b of lcBoxes()) {
    if (!(b.depth > GH_NEAR) || (onlyHidden && !b.hidden)) continue;
    const C = b.corners;
    for (let i = 0; i < 4; i++) { add('car', ghSeg(C[i], C[(i + 1) % 4], R)); add('car', ghSeg(C[4 + i], C[4 + (i + 1) % 4], R)); add('car', ghSeg(C[i], C[4 + i], R)); }
    const foot = ghPt(b.foot), head = ghPt(b.head);
    if (foot && head && foot[0] >= 0 && foot[0] <= W && foot[1] >= 0 && foot[1] <= H) {
      const dims = `${b.d.L.toFixed(2)} × ${b.d.W.toFixed(2)} × ${b.d.H.toFixed(2)} m`;
      refs.push({ kind: 'car', foot, head, text: `${b.name} · lane ${b.lane} · ${dims} · ${b.depth.toFixed(1)} m · ${ghBlurTxt(b.blur)}`, short: `${b.name} · ${b.depth.toFixed(1)} m` });
    }
  }
}

// ---------- Dibujo: una copia debajo del plate (por las ventanillas) y otra encima (tenue sobre el FG) ----------
const ghUn = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
ghUn.id = 'gh-un'; ghUn.setAttribute('class', 'gh gh-un'); ghUn.setAttribute('aria-hidden', 'true'); ghUn.setAttribute('preserveAspectRatio', 'none');
stage.insertBefore(ghUn, plateImg); // debajo del plate y encima del driving plate y del entorno
// hidden line: la imagen de js/guides.js en el stage, en px del plate; una copia debajo del plate (por las
// ventanillas) y otra encima, como las líneas. Se arma a la resolución de la pantalla: el trazo queda de ~1 px
const ghHl = document.createElement('canvas'), ghHlUn = document.createElement('canvas');
ghHl.className = ghHlUn.className = 'gh-hl'; ghHl.id = 'gh-hl'; ghHlUn.id = 'gh-hl-un'; ghHl.style.display = ghHlUn.style.display = 'none';
stage.appendChild(ghHl); stage.insertBefore(ghHlUn, plateImg);
function ghHlDraw(holes) {
  const k = Math.min(1, st.view.baseW * st.view.zoom * (window.devicePixelRatio || 1) / Math.max(1, st.plate.W));
  const img = gh.on && ghHidden() && !st.plate.empty ? guidesImage({ k, skip: { cars: !gh.show.cars, lcars: !gh.show.cars, people: !gh.show.people, lanes: !gh.show.lanes, curbs: !gh.show.curbs, facades: !gh.show.facades }, color: gh.color }) : null;
  for (const [cv, op] of [[ghHl, holes ? gh.op * gh.fg : gh.op], [ghHlUn, holes ? gh.op : 0]]) {
    if (!img || op <= 0) { if (cv.style.display !== 'none') cv.style.display = 'none'; continue; }
    if (cv.width !== img.width || cv.height !== img.height) { cv.width = img.width; cv.height = img.height; }
    const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0);
    cv.style.opacity = op.toFixed(3); cv.style.display = '';
  }
}
const ghKeyHoles = () => stage.classList.contains('keyed') && !stage.classList.contains('noplate') && key.view !== 'matte';
function ghDraw() {
  const ov = $('gh-ov'); if (!ov) return;
  gh.street = ghHidden() ? !!ENV_MODULES[env.id] : env.id === 'avenue';
  // con el fantasma prendido, las líneas FG / FOCUS / BG del bokeh sobran (cada referencia trae su desenfoque) y
  // tapan la comparación: se esconden mientras no haya una herramienta del bokeh armada ni el chip Focus prendido
  const bk = $('bk-ov'); if (bk) bk.classList.toggle('gh-quiet', gh.on && !st.plate.empty && !(typeof bokehState !== 'undefined' && (bokehState.tool || bokehState.showFocus)));
  if (!gh.on || st.plate.empty) { ov.innerHTML = ''; ghUn.innerHTML = ''; ghUn.style.display = 'none'; ghHlDraw(false); ghUI(); return; }
  const G = ghGeometry(), W = st.plate.W, H = st.plate.H, holes = ghKeyHoles();
  ghHlDraw(holes);
  const d = (l) => `M${l[0].toFixed(1)} ${l[1].toFixed(1)}L${l[2].toFixed(1)} ${l[3].toFixed(1)}`;
  const byCls = {}; G.paths.forEach(([c, l]) => { byCls[c] = (byCls[c] || '') + d(l); });
  // debajo: en px del plate (el stage escala); el trazo se mantiene en px de pantalla con --u
  const k = st.view.baseW * st.view.zoom / W;
  ghUn.setAttribute('viewBox', `0 0 ${W} ${H}`); ghUn.style.setProperty('--u', (1 / k).toFixed(4));
  ghUn.style.display = holes ? '' : 'none';
  ghUn.innerHTML = holes ? `<g opacity="${gh.op}">` + Object.entries(byCls).map(([c, p]) => `<path class="${c}" d="${p}"/>`).join('') + '</g>' : '';
  // encima: en px del visor; sobre el FG tenue si el key deja ver la copia de abajo
  const vpD = (l) => { const a = uvToVp(l[0], l[1]), b = uvToVp(l[2], l[3]); return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`; };
  const byV = {}; G.paths.forEach(([c, l]) => { byV[c] = (byV[c] || '') + vpD(l); });
  const out = [`<g opacity="${(holes ? gh.op * gh.fg : gh.op).toFixed(3)}">` + Object.entries(byV).map(([c, p]) => `<path class="${c}" d="${p}"/>`).join('') + '</g>'];
  // rótulos a opacidad plena: se leen siempre
  const fs = 1.05 * parseFloat(getComputedStyle(document.documentElement).fontSize);
  ghMeasure.font = `600 ${fs}px ${getComputedStyle(document.documentElement).getPropertyValue('--f-ui')}`;
  // los rótulos de la escena (HORIZON, VP car) ya están dibujados (sceneDrawOverlay va antes): se esquivan como
  // a los propios. Mismo marco (px del visor); y = la base del texto, como en place
  const [x0, y0] = uvToVp(0, 0), [x1, y1] = uvToVp(W, H);
  const boxes = [...document.querySelectorAll('#scene-ov text')].map(t => { const b = t.getBBox(); return { x: b.x, y: b.y + b.height, w: b.width, h: b.height }; }).filter(b => b.w > 0);
  // un lugar libre cerca de (x, y), dentro del cuadro: se prueba abajo y arriba, alternando, antes de pisar otro
  const place = (x, y, text) => {
    const w = ghMeasure.measureText(text).width + 6, top = y0 + fs + 4, bot = y1 - 6;
    const bx = Math.max(Math.min(x - w / 2, x1 - w - 4), x0 + 4), y1st = Math.min(Math.max(y, top), bot);
    const free = (by) => !boxes.some(b => bx < b.x + b.w && b.x < bx + w && by - fs < b.y && b.y - b.h < by);
    let by = y1st;
    for (let i = 1; i < 24 && !free(by); i++) { const t = y1st + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * fs * 1.35; if (t >= top && t <= bot) by = t; }
    if (!free(by)) by = y1st;
    const b = { x: bx, y: by, w, h: fs * 1.3 }; boxes.push(b); return b;
  };
  // en un visor chico el rótulo largo no entra: sin carril ni desenfoque (quedan en el panel)
  const fits = (text) => ghMeasure.measureText(text).width + 6 <= (x1 - x0) * 0.5;
  for (const r of G.refs) {
    const text = fits(r.text) ? r.text : r.short;
    const h = uvToVp(...r.head), b = place(h[0], h[1] - 10, text);
    out.push(`<text class="gh-tag ${r.kind}" x="${(b.x + 3).toFixed(1)}" y="${b.y.toFixed(1)}">${ghEsc(text)}</text>`);
  }
  for (const t of G.tags) {
    const q = uvToVp(...t.at), b = place(q[0] + 10 + (ghMeasure.measureText(t.text).width + 6) / 2, q[1] - 10, t.text);
    out.push(`<g class="gh-vp"><circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="6"/><path d="M${(q[0] - 11).toFixed(1)} ${q[1].toFixed(1)}h22M${q[0].toFixed(1)} ${(q[1] - 11).toFixed(1)}v22"/></g><text class="gh-tag vp" x="${(b.x + 3).toFixed(1)}" y="${b.y.toFixed(1)}">${t.text}</text>`);
  }
  ov.innerHTML = out.join('');
  ghUI();
}
// ---------- Panel ----------
function ghSet(patch) { Object.assign(gh, patch); ghSave(); drawOverlay(); }
function ghUI() {
  const chip = $('gh-chip'); if (!chip) return;
  chip.setAttribute('aria-pressed', String(gh.on)); $('gh-on').checked = gh.on;
  $('gh-st').textContent = !gh.on ? 'off' : gh.street ? 'on' : 'on · no street';
  $('gh').dataset.state = gh.on ? 'ok' : ''; $('gh').dataset.mode = gh.mode;
  ['hidden', 'lines'].forEach(m => $('gh-m-' + m).setAttribute('aria-pressed', String(gh.mode === m)));
  GH_LINES.forEach(([k, , , only]) => { const b = $('gh-l-' + k); b.setAttribute('aria-pressed', String(!!gh.show[k])); b.hidden = !!only && only !== gh.mode; });
  if ($('gh-color').value !== gh.color) $('gh-color').value = gh.color;
  const sv = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  sv('gh-op', gh.op); sv('gh-op-r', gh.op); sv('gh-mix', gh.op); sv('gh-fg', gh.fg); sv('gh-fg-r', gh.fg);
  const note = ghHidden() ? (!gh.street ? 'The hidden lines come from the 3D environment: pick one in Environment › Module (it does not need to show). Without it only the horizon shows.' : 'Every line of the 3D environment that the camera sees, without the ones behind: lay them over the filmed background to check it lines up. Show turns each part on or off; Cars in lanes adds cars at scale.')
    : !gh.street ? 'The lines come from the 3D street: pick Avenue / street in Environment › Module. Without it only the horizon shows.'
    : `The cars of Cars in lanes show as boxes with their size, their distance along the optical axis and the blur with the lens of the shot (${typeof drvLensTag === 'function' ? drvLensTag() : 'Lens & focus'}).`;
  if ($('gh-note').textContent !== note) $('gh-note').textContent = note;
}
function ghToggle(on = !gh.on) {
  if (on && st.plate.empty) { toast('3D Guides: open a plate first', true); return; }
  gh.on = on; drawOverlay();
  if (on && (ghHidden() ? !ENV_MODULES[env.id] : env.id !== 'avenue')) toast(ghHidden() ? '3D Guides: only the horizon until you pick an environment in Environment › Module' : '3D Guides: only the horizon until you pick Avenue / street in Environment › Module');
}
{
  $('gh-lines').innerHTML = GH_LINES.map(([k, n, c]) => `<button class="btn sm gh-lchip" id="gh-l-${k}" aria-pressed="true" title="Show the ${n.toLowerCase()} of the 3D environment"><i class="gh-sw ${c}"></i>${n}</button>`).join('');
  GH_LINES.forEach(([k]) => $('gh-l-' + k).onclick = () => { gh.show[k] = !gh.show[k]; ghSave(); drawOverlay(); });
  const pair = (id, key, lo) => {
    const f = (v) => { v = +v; if (Number.isFinite(v)) ghSet({ [key]: Math.min(1, Math.max(lo, v)) }); };
    $(id + '-r').addEventListener('input', (e) => f(e.target.value)); $(id).addEventListener('change', (e) => f(e.target.value));
  };
  pair('gh-op', 'op', 0.1); pair('gh-fg', 'fg', 0);
  $('gh-mix').addEventListener('input', (e) => ghSet({ op: Math.min(1, Math.max(0.1, +e.target.value)) })); // el Mix de la caja de DepthLab
  $('gh-on').onchange = (e) => ghToggle(e.target.checked);
  ['hidden', 'lines'].forEach(m => $('gh-m-' + m).onclick = () => ghSet({ mode: m }));
  $('gh-color').innerHTML = GH_COLORS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  $('gh-color').onchange = (e) => ghSet({ color: e.target.value });
  $('gh-chip').onclick = () => ghToggle();
  $('gh-chip').addEventListener('pointerdown', e => e.stopPropagation());
  window.addEventListener('keydown', e => {
    if ((e.key || '').toLowerCase() !== 'g' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target.matches('textarea, select, input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=file])')) return;
    if (typeof drag !== 'undefined' && drag && drag.action === 'look') return; // WASD de la navegación tipo juego
    ghToggle();
  });
  // el key y el plate prendido o apagado cambian qué copia se ve: el stage cambia de clase
  new MutationObserver(() => { if (gh.on) ghDraw(); }).observe(stage, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('lens-changed', () => { if (gh.on) ghDraw(); });
  ghUI();
}

// hook project: el estado de la comparación viaja con el proyecto
function ghProjectState() { return { on: gh.on, op: gh.op, fg: gh.fg, mode: gh.mode, color: gh.color, show: { ...gh.show } }; }
function ghApplyProject(o) {
  if (!o) { gh.on = false; drawOverlay(); return; }
  for (const k of ['op', 'fg']) if (Number.isFinite(o[k])) gh[k] = o[k];
  gh.mode = o.mode === 'hidden' ? 'hidden' : 'lines'; // un proyecto de antes de hidden line queda como estaba
  if (GH_COLORS.some(c => c[0] === o.color)) gh.color = o.color;
  gh.show = ghShowOf(o);
  gh.on = !!o.on; drawOverlay();
}
