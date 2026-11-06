// Pestañas de módulo arriba de la app. Cada una arma su propia vista:
// - Import: cuatro paneles (plate, metadata leída, scan en 3D, Google Maps a futuro) en lugar del visor.
// - 2D Camera Match: como Perspective Match de 3ds Max, el plate y las líneas de fuga de los tres ejes (los
//   chips del visor son los mismos de las otras pestañas); sin navegación 3D: la cámara sale de las fugas (zoom y
//   paneo 2D sí) y se mueve sin cambiar la perspectiva con Move camera (js/cam-move.js). Slate solve (js/slate.js)
//   también vive acá: la focal medida sobre el plate con la claqueta, para contrastar la de las fugas y la del EXR.
// - 3D Camera Pin: el visor con pins, medida, figuras y navegación; sin riel de foco. Los pins sólo se ven acá.
// - VFX Shooting Sup: un cuadro por setup de rodaje en lugar del visor (js/vfx-sup.js).
// - Compare and Match: el driving plate detrás del plate, las 3D Guides y Cars in lanes; el driving se encaja por su
//   metadata o con un corner pin 2D (js/drive-plate.js). El visor fijo, como en DepthLab.
// - DepthLab: el visor fijo con el riel de foco; la vista no se mueve y la barra de cámara se ve pero no se edita
//   (el foco se maneja en el riel y en Lens & focus). Para mover la cámara, 3D Camera Pin. El driving plate es el
//   mismo de Compare and Match (su sección está sólo allá; acá queda la caja de la derecha y los botones de abajo).
// - 3D Assets: cuatro visores 3D con las piezas del entorno, para reemplazarlas por assets importados (js/assets3d.js).
// - Shakelab: el visor fijo en la cámara de la toma con el movimiento de un iPhone encima (js/shakelab.js).
// - 3D Render: el entorno con HDRI y sol; vista de arriba (el sol), vista libre y la cámara de la toma (js/render3d.js).
// Las secciones del panel también son de cada pestaña (Export camera está en las dos de cámara).
// Lo que abre una sección o una herramienta de otra pestaña (Next:, un recorrido, P, L, N…) pasa antes a esa.
const MTABS = [
  { id: 'import', label: 'Import and Measure', secs: ['s2', 'sr', 's1'], title: 'Load the plate, its set report and metadata, and the scan' },
  { id: 'match', label: '2D Camera Match', secs: ['sc-lines', 'sc-cam', 's4'], title: 'Match the perspective with vanishing lines on a geometric plate (buildings, walls), like Perspective Match in 3ds Max' },
  { id: 'camerapin', label: '3D Camera Pin | Environment', secs: ['s3', 's5', 's6', 's4'], title: 'Pins on the scan, the street behind the car and its motion' },
  { id: 'vfx', label: 'VFX Shooting Sup', secs: ['vfx'], title: 'Sheets for shooting background and foreground plates with another camera and lens: the 3D guides, a green or blue screen and the camera data, exported as PNG' },
  { id: 'compare', label: 'Compare and Match', secs: ['drv', 'gh', 'lc'], title: 'The driving plate behind the plate, fitted by its metadata or with a corner pin, against the 3D Guides and cars in the lanes' },
  { id: 'depthlab', label: 'DepthLab', secs: ['bk-lens', 'bk-out', 'sc-overlay', 's4'], title: 'Lens, focus and bokeh with the camera you solved, the driving plate (set up in Compare and Match) and the delivery' },
  { id: 'shakelab', label: 'Shakelab', secs: ['shk'], title: 'Move a phone by hand (it opens a page this app serves: free, nothing to install) and record its motion on the shot camera, with a limit per axis that brakes on a curve' },
  { id: 'assets', label: '3D Assets', secs: ['a3'], title: 'Four 3D viewports with the pieces of the environment (cars, people, street lights, buildings…): import a better asset for each one and fit it to the pivot of the piece, for the 3D render' },
  { id: 'render3d', label: '3D Render', secs: ['r3d', 'r3-ras-s', 'r3-pt-s', 'r3-hdri-s', 'r3-sun-s', 'r3-post-s'], title: 'The environment lit by an HDRI and a sun from the place, date and time of the shot, seen from the shot camera, from the top and from a free camera' },
];
if (typeof cpEditionTabs === 'function') cpEditionTabs(MTABS); // 3D Camera Pin edition (edition/cp-edition.js)
// herramienta → pestaña donde vive
// Measure y Figure andan en 2D Camera Match, 3D Camera Pin y DepthLab: no cambian de pestaña (desde Import van a 3D Camera Pin)
const MTAB_OF_MODE = { pins: 'camerapin', lines: 'match', slate: 'match', depth: 'depthlab' };
let mtabCur = '';
// Lo que se ve en el visor es de cada pestaña: lo que se prende en DepthLab queda en DepthLab. Al abrir la app,
// 2D Camera Match muestra sólo el plate y las líneas; Walls y Horizon arrancan apagados en Match y Camera Pin.
const MTAB_VIEW_DEF = {
  match: { plate: true, scan: false, grid: false, horizon: false, walls: false, figures: true, envmix: 1 },
  camerapin: { plate: true, scan: true, grid: true, horizon: false, walls: false, figures: true, envmix: 1 },
  compare: { plate: true, key: true, scan: false, grid: false, horizon: true, walls: false, figures: true, envmix: 1 }, // plate y key prendidos, scan apagado
  depthlab: { plate: true, scan: true, grid: true, horizon: true, walls: false, figures: true, envmix: 1 },
  shakelab: { plate: false, scan: true, grid: true, horizon: false, walls: false, figures: false, envmix: 1 }, // el plate no se mueve con la cámara
};
// DepthLab y Compare and Match: la vista queda en la cámara de la toma (sin navegar; zoom y paneo 2D sobre el plate)
const mtabLocked = (t = mtabCur) => t === 'depthlab' || t === 'compare';
// Todo lo de la barra de arriba del visor es de cada pestaña: además, Mix, Env mix, Point, el modo del scan, Env, Key,
// Exposure y Cars. Lo que una pestaña todavía no tiene guardado queda como estaba al entrar.
const mtabViews = Object.assign({}, lsGet('mtab.view', {}));
// Cars (barra del visor): los autos y trenes del entorno (los grupos marcados 'cars'), de cada pestaña como el resto
let envCarsOn = true;
function envCarsApply() {
  envRoot.traverse(o => { if (o.userData.guide === 'cars') { o.visible = envCarsOn; o.userData.chipOff = !envCarsOn; } });
  const b = $('cars-on'); if (b.getAttribute('aria-pressed') !== String(envCarsOn)) b.setAttribute('aria-pressed', String(envCarsOn));
}
function envCarsSet(on) { envCarsOn = !!on; envCarsApply(); render(); }
$('cars-on').onclick = () => envCarsSet(!envCarsOn);
{ const f = envRebuild; envRebuild = function (...a) { const r = f(...a); envCarsApply(); return r; }; }
function mtabViewRead() {
  return { cars: envCarsOn, plate: !$('stage').classList.contains('noplate'), scan: !!scanRoot.visible, grid: !!$('grid').checked, horizon: !!sceneSt.show.horizon, walls: !!sceneSt.show.vanishing, figures: !!sceneSt.show.figures,
    mix: +$('opac').value, envmix: +$('envmix').value, point: +$('ptsize').value, disp: $('disp').value, exposure: +$('vgain').value, key: !!key.on,
    ...(ENV_MODULES[env.id] ? { env: !!env.on } : {}) }; // sin entorno, Env no dice nada
}
function mtabViewApply(v) {
  if (v.plate !== !$('stage').classList.contains('noplate')) togglePlate();
  if (v.scan !== !!scanRoot.visible) toggleScan();
  if (v.grid !== !!$('grid').checked) { $('grid').checked = v.grid; $('grid').dispatchEvent(new Event('change')); }
  sceneSt.show.horizon = !!v.horizon; sceneSt.show.vanishing = !!v.walls; sceneSt.show.figures = v.figures !== false;
  let disp = false;
  if (Number.isFinite(v.envmix) && +$('envmix').value !== v.envmix) { $('envmix').value = v.envmix; envMixApply(false); }
  for (const [k, id] of [['mix', 'opac'], ['point', 'ptsize']]) if (Number.isFinite(v[k]) && +$(id).value !== v[k]) { $(id).value = v[k]; disp = true; }
  if (v.disp && v.disp !== $('disp').value && [...$('disp').options].some(o => o.value === v.disp)) { $('disp').value = v.disp; disp = true; }
  if (disp) applyDisplay();
  if (Number.isFinite(v.exposure) && +$('vgain').value !== v.exposure) { $('vgain').value = v.exposure; setGain(); }
  if (typeof v.key === 'boolean' && v.key !== !!key.on) setKey({ on: v.key });
  if (typeof v.env === 'boolean' && ENV_MODULES[env.id] && v.env !== !!env.on) toggleEnv();
  if ((v.cars !== false) !== envCarsOn) { envCarsOn = v.cars !== false; envCarsApply(); }
}
function mtabViewSave() { if (MTAB_VIEW_DEF[mtabCur]) { mtabViews[mtabCur] = mtabViewRead(); lsSet('mtab.view', mtabViews); } }
// un scan nuevo entra en Flat (o Splat) en todas las pestañas (js/scan.js, js/splat.js)
function mtabViewForget(k) { for (const t of Object.keys(mtabViews)) delete mtabViews[t][k]; lsSet('mtab.view', mtabViews); }
// el proyecto guarda lo que se ve en cada pestaña (js/project.js); uno viejo, sin esto, deja lo que había
function mtabProjectState() { mtabViewSave(); return JSON.parse(JSON.stringify(mtabViews)); }
function mtabApplyProject(views) {
  if (!views || typeof views !== 'object') return;
  for (const t of Object.keys(MTAB_VIEW_DEF)) if (views[t] && typeof views[t] === 'object') mtabViews[t] = { ...views[t] };
  lsSet('mtab.view', mtabViews);
  if (MTAB_VIEW_DEF[mtabCur]) { mtabViewApply({ ...MTAB_VIEW_DEF[mtabCur], ...mtabViews[mtabCur] }); refreshAll(); }
}
window.addEventListener('beforeunload', mtabViewSave);
const mtabSetMode = setMode; // el original (js/interaction.js)
// pestaña de un elemento del panel: la actual si la sección está ahí, si no la primera que la tiene
function mtabOf(el) {
  let sec = el && el.closest('.props .step');
  while (sec && sec.parentElement && sec.parentElement.closest('.props .step')) sec = sec.parentElement.closest('.props .step');
  // la herramienta de una pestaña (Lines, Pins…) se ve en la suya
  const tool = el && el.closest('.tools .tool[id^="m-"]');
  if (tool && MTAB_OF_MODE[tool.id.slice(2)]) return MTAB_OF_MODE[tool.id.slice(2)];
  // el visor, sus barras y la línea de tiempo no están en Import: un recorrido que los señala pasa a 3D Camera Pin
  if (!sec) return (mtabCur === 'import' || mtabCur === 'render3d' || mtabCur === 'vfx' || mtabCur === 'assets') && el && el.closest('.viewer > .vbar, .viewer > .vmid, .viewer > .tlbar') ? 'camerapin' : '';
  // en DepthLab, Export camera es sólo para Nuke: Target y el código se ven en las otras pestañas
  if (mtabCur === 'depthlab' && el.closest('#s4 [data-tour="export.target"], #s4 #out')) return 'camerapin';
  const cur = MTABS.find(m => m.id === mtabCur);
  if (cur && cur.secs.includes(sec.id)) return cur.id;
  const t = MTABS.find(m => m.secs.includes(sec.id));
  return t ? t.id : '';
}
function mtabShow(id, save = true) {
  if (!MTABS.some(m => m.id === id)) id = MTABS[0].id;
  if (id !== mtabCur) mtabViewSave(); // lo que se veía en la pestaña de la que se sale
  const prev = mtabCur; mtabCur = id;
  if (prev !== id && MTAB_VIEW_DEF[id]) mtabViewApply({ ...MTAB_VIEW_DEF[id], ...(mtabViews[id] || {}) });
  const tab = MTABS.find(m => m.id === id);
  for (const m of MTABS) {
    const b = $('mt-' + m.id); if (b) { b.setAttribute('aria-selected', String(m.id === id)); b.tabIndex = m.id === id ? 0 : -1; }
    for (const s of m.secs) { const el = $(s); if (el) el.classList.toggle('mt-off', !tab.secs.includes(s)); }
  }
  document.querySelector('.app').dataset.mtab = id;
  if (save) lsSet('mtab', id);
  if (typeof impShow === 'function') impShow(id === 'import');
  if (typeof vfxShow === 'function') vfxShow(id === 'vfx');
  if (typeof a3dShow === 'function') a3dShow(id === 'assets');
  if (typeof r3dShow === 'function') r3dShow(id === 'render3d');
  if (typeof shkShow === 'function') shkShow(id === 'shakelab');
  if (typeof tourNewPlace === 'function') tourNewPlace(id === 'import');
  // Export camera en DepthLab: sólo Nuke y el código plegado (el destino de las otras pestañas no se toca)
  if (prev !== id && typeof updateExport === 'function') {
    { const h = $('s4').querySelector('h2'); if (h.firstChild) h.firstChild.nodeValue = id === 'depthlab' ? 'Export camera to Nuke' : 'Export camera'; }
    if (id === 'depthlab') { mtabTarget = $('target').value; $('target').value = 'nuke'; $('out').classList.remove('open'); $('out-toggle').textContent = 'Show code'; updateExport(); }
    else if (prev === 'depthlab' && mtabTarget) { $('target').value = mtabTarget; mtabTarget = ''; updateExport(); }
  }
  if (typeof setDv === 'function' && prev !== id) {
    if (prev === 'depthlab' && dv.on) { mtabDvWas = true; setDv({ on: false }); }
    else if (id === 'depthlab' && mtabDvWas) { mtabDvWas = false; setDv({ on: true }); }
  }
  // DepthLab: con una cámara guardada (Store cam) muestra ésa; sin ella, el último encuadre de la pestaña de la que
  // se viene. Al volver a 2D Camera Match o 3D Camera Pin, el encuadre de antes de entrar a DepthLab.
  if (prev !== id) mtabCamSwitch(prev, id);
  // la herramienta de cada pestaña
  // DepthLab, Compare and Match y Shakelab: la barra de cámara queda a la vista pero sin edición ni arrastre (inert)
  document.querySelectorAll('.camrow, #tb-cam').forEach(el => { el.inert = mtabLocked(id) || id === 'shakelab'; });
  if (id === 'match' && !['lines', 'slate', 'measure', 'figure'].includes(st.mode)) mtabSetMode('lines');
  else if (id === 'camerapin' && (st.mode === 'lines' || st.mode === 'slate' || st.mode === 'depth')) mtabSetMode('nav');
  else if (id === 'depthlab' && !['nav', 'measure', 'figure', 'depth'].includes(st.mode)) mtabSetMode('nav');
  else if (id === 'compare' && !['nav', 'measure', 'figure'].includes(st.mode)) mtabSetMode('nav');
  else if (id !== 'depthlab' && st.mode === 'depth') mtabSetMode(id === 'match' ? 'lines' : 'nav');
  else if (prev !== id && typeof refreshAll === 'function') refreshAll(); // los pins se muestran o no según la pestaña
  if (prev !== id && typeof drvPinDraw === 'function') drvPinDraw(); // las manijas del corner pin son de Compare and Match
  if (prev !== id && typeof lcTabApply === 'function') { lcTabApply(); render(); } // Cars in lanes, de Compare and Match a la derecha
}
function mtabReveal(el) { const t = mtabOf(el); if (t && t !== mtabCur) mtabShow(t); }
// elegir una herramienta pasa a su pestaña: P / Pins y M → 3D Camera Pin; L, C (Slate solve) y S → 2D Camera Match;
// N (navegar) desde Import, 2D Camera Match, Compare and Match, DepthLab o Shakelab → 3D Camera Pin
const mtabNoNav = () => mtabLocked() || mtabCur === 'match' || mtabCur === 'shakelab';
setMode = function (m) {
  if (mtabCur === 'import' && (m === 'measure' || m === 'nav') && typeof impMeasureToggle === 'function') { impMeasureToggle(m === 'measure' ? undefined : false); return; } // M y N en Import: las herramientas de su cuadro del scan
  const want = MTAB_OF_MODE[m] || (m === 'nav' && mtabNoNav() ? 'camerapin' : (m === 'measure' || m === 'figure') && mtabCur === 'import' ? 'camerapin' : mtabCur === 'render3d' || mtabCur === 'vfx' || mtabCur === 'assets' || mtabCur === 'shakelab' ? 'camerapin' : mtabCur);
  if (want && want !== mtabCur) mtabShow(want);
  mtabSetMode(m);
};
// en DepthLab la vista no se mueve: ni navegación con el mouse, ni rueda, ni arrastrar el horizonte o el VP, ni F.
// En 2D Camera Match tampoco se navega en 3D (la cámara sale de las fugas); F pasa a 3D Camera Pin
for (const k of Object.keys(NAV)) { const f = NAV[k].map; NAV[k].map = (b, e) => mtabNoNav() ? null : f(b, e); }
{ const f = sceneOnDown; sceneOnDown = (e, x, y) => mtabLocked() && st.mode !== 'figure' ? false : f(e, x, y); } // en DepthLab y Compare and Match sólo las figuras
{ const f = fit3D; fit3D = (...a) => { if (mtabCur === 'import' && typeof impFit === 'function') return impFit(); if (mtabCur === 'assets' && typeof a3dFrame === 'function') return a3dFrame(); if (mtabNoNav()) mtabShow('camerapin'); return f(...a); }; }
{ const f = render; render = function () {
  if (mtabCur !== 'match') return f();
  const keep = [measLine.visible, measPts.visible]; // el scan, la grilla y el entorno siguen sus chips; la medida no va
  measLine.visible = measPts.visible = false;
  try { f(); } finally { [measLine.visible, measPts.visible] = keep; }
}; }
// DepthLab y 2D Camera Match se mueven en 2D sobre el plate (rueda: zoom; Alt, Espacio o el botón del medio: paneo)
{ const f = plateMode; plateMode = () => f() || mtabNoNav(); }
// lo de DepthLab (Z defocus, vista Depth, Compare with the 3D) se ve y se toca sólo en DepthLab
{ const a = zdfMain, b = zdfRender; zdfMain = () => mtabCur === 'depthlab' ? a() : false; zdfRender = () => mtabCur === 'depthlab' ? b() : false; }
let mtabTarget = '';
// el encuadre de 2D Camera Match / 3D Camera Pin al entrar a DepthLab con una cámara guardada (y el último gesto
// de navegación de entonces, para que la cámara guardada no se pise al volver a navegar)
let mtabCamWas = null;
function mtabCamPut(c) {
  camera.position.copy(c.p); camera.quaternion.copy(c.q); nav.target.copy(c.t); st.fScale = c.f;
  camera.updateMatrixWorld(true); applyIntrinsics(); navChanged();
}
function mtabCamSwitch(prev, id) {
  const pin = t => t === 'match' || t === 'camerapin';
  if (mtabLocked(id) && pin(prev) && shotNav.stored && shotNav.cam) {
    const now = camSnap();
    if (camSame(now, shotNav.cam)) return;
    mtabCamWas = { cam: now, end: shotNav.end };
    mtabCamPut(shotNav.cam); shotNav.end = camSnap();
    toast(`${id === 'compare' ? 'Compare and Match' : 'DepthLab'} shows the stored camera (Store cam)`);
  } else if (pin(id) && mtabCamWas) {
    const w = mtabCamWas; mtabCamWas = null;
    mtabCamPut(w.cam); shotNav.end = w.end; shotUI();
  }
}
let mtabDvWas = false; // la vista Depth se apaga al salir de DepthLab y vuelve al entrar
vp.addEventListener('wheel', e => { if (mtabNoNav() && !plateMode()) { e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true, passive: false });
{
  const bar = $('mtabs');
  bar.innerHTML = MTABS.map(m => `<button class="mtab" role="tab" id="mt-${m.id}" data-tour="tab.${m.id}" aria-controls="props-scroll" title="${m.title}">${m.label}</button>`).join('');
  // con el panel oculto, elegir una pestaña lo vuelve a mostrar
  MTABS.forEach(m => $('mt-' + m.id).addEventListener('click', () => { mtabShow(m.id); const app = document.querySelector('.app'); if (app.classList.contains('noside')) $('ab-panel').click(); }));
  bar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = MTABS.findIndex(m => m.id === mtabCur), n = MTABS[(i + (e.key === 'ArrowRight' ? 1 : MTABS.length - 1)) % MTABS.length];
    mtabShow(n.id); $('mt-' + n.id).focus(); e.preventDefault(); e.stopPropagation();
  });
  document.addEventListener('click', e => { const h = e.target.closest && e.target.closest('.props .step > h2'); if (h) mtabReveal(h); }, true);
  document.querySelectorAll('.props .pgroup').forEach(g => g.classList.add('mt-hide'));
  mtabShow(lsGet('mtab', MTABS[0].id), false);
}
