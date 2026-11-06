// ---------- Recorridos guiados: motor, host, copia de práctica y Help ----------
// Versión web de libs/lgatour de DepthLab (capa que oscurece, hueco sobre el control real, aro verde
// que pulsa, globo «STEP n OF N»). El usuario hace la acción de verdad; las condiciones sólo leen.
// El guion es tours/catalog.json. Un recorrido corre en una copia de práctica: la misma app en un
// iframe con ?tour=<ruta> (core.js guarda en memoria con ese parámetro) y la escena demo de Javi.
// El progreso es lo único que se comparte con la app del usuario (localStorage 'backplatelab.tours').

const TOUR_PROGRESS_KEY = 'backplatelab.tours';
const TOUR_POLL_MS = 100, TOUR_DONE_MS = 500;
const TOUR_LABELS = {
  en: {
    stepOf: 'STEP %1 OF %2', chapterOf: 'CHAPTER %1 OF %2', next: 'Next', back: 'Back', exitTour: 'Exit tour',
    exit: 'Exit', keepGoing: 'Keep going', tryAgain: 'Try again', skipStep: 'Skip this step',
    restart: 'Restart tour', backToProject: 'Back to my project', startChapter: 'Start chapter',
    skipChapter: 'Skip chapter', nextChapter: 'Next chapter', yourTurn: 'Do this:', done: 'Done',
    alreadyDone: 'Already done', preparing: 'Getting this step ready…', keyNext: 'next', keyBack: 'back', keyExit: 'exit', keyKeep: 'keep going',
    keyStart: 'start', steps: '%1 steps', step1: '1 step', minutes: 'about %1 min',
    confirmExit: 'Exit the tour? The practice copy is discarded.',
    takingLong: 'This is taking longer than expected.', couldNot: 'This step could not be completed.',
    notOnScreen: 'This step\'s control is not on screen right now.',
    unavailable: 'This chapter is not part of this version of BackplateLab yet (missing: %1).',
    catalogBad: 'The tour catalog could not be loaded.',
  },
  es: {
    stepOf: 'PASO %1 DE %2', chapterOf: 'CAPÍTULO %1 DE %2', next: 'Siguiente', back: 'Atrás', exitTour: 'Salir',
    exit: 'Salir', keepGoing: 'Seguir', tryAgain: 'Reintentar', skipStep: 'Saltear paso',
    restart: 'Reiniciar recorrido', backToProject: 'Volver a mi proyecto', startChapter: 'Empezar capítulo',
    skipChapter: 'Saltear capítulo', nextChapter: 'Capítulo siguiente', yourTurn: 'Hacé esto:', done: 'Hecho',
    alreadyDone: 'Ya está hecho', preparing: 'Preparando este paso…', keyNext: 'siguiente', keyBack: 'atrás', keyExit: 'salir', keyKeep: 'seguir',
    keyStart: 'empezar', steps: '%1 pasos', step1: '1 paso', minutes: 'unos %1 min',
    confirmExit: '¿Salir del recorrido? La copia de práctica se descarta.',
    takingLong: 'Esto está tardando más de lo esperado.', couldNot: 'Este paso no se pudo completar.',
    notOnScreen: 'El control de este paso no está en pantalla ahora.',
    unavailable: 'Este capítulo todavía no es parte de esta versión de BackplateLab (falta: %1).',
    catalogBad: 'No se pudo cargar el catálogo de recorridos.',
  },
};
const tourFmt = (s, ...a) => a.reduce((t, v, i) => t.replace('%' + (i + 1), v), s);

// ---------- Host: anclas, operaciones (lo mismo que hace el usuario) y condiciones (sólo leen) ----------
// Ancla: data-tour="<id>"; '#id' sólo para controles que la app genera (parámetros del entorno).
function tourEl(a) {
  if (!a || typeof document === 'undefined') return null;
  return a[0] === '#' ? document.getElementById(a.slice(1)) : document.querySelector(`[data-tour="${CSS.escape(a)}"]`);
}
function tourNeed(a) { const el = tourEl(a); if (!el) throw new Error('missing anchor ' + a); return el; }
// lo que se resalta: un campo suelto se ve mejor con su fila
function tourTarget(el) {
  if (el.matches('input, select') && !el.matches('.vpchip')) return el.closest('.fld, .knobrow, label.camh') || el;
  return el;
}
function tourSetValue(el, v) {
  if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}
// abre la sección del panel (o el <details>) donde vive el ancla, con el mismo click del usuario
function tourOpenSection(el) {
  if (typeof mtabReveal === 'function') mtabReveal(el); // la sección puede estar en otra pestaña de módulo
  // de afuera hacia adentro: Probes y Bokeh overlay están adentro de Lens & focus
  const secs = []; for (let s = el.closest('.step'); s; s = s.parentElement.closest('.step')) secs.unshift(s);
  for (const sec of secs) if (sec.classList.contains('closed')) sec.querySelector(':scope > h2').click();
  const d = el.closest('details'); if (d && !d.open) d.open = true;
  if (el.closest('.bk-rail.collapsed') && typeof bkRailCollapse === 'function') bkRailCollapse(false); // riel de foco plegado
  if (typeof vbMore === 'function') vbMore(!!el.closest('#vrow2') && !!$('vb-more').offsetParent); // barra angosta: More abierto sólo si el paso es de ahí
}
// cámara oculta con la que sample.js dibuja el plate demo (buildSample): los pins de práctica caen exactos
function tourDemoCamera() {
  const W = 1920, H = 1336, f = 24, sw = 36.70;
  const cam = new THREE.PerspectiveCamera(2 * Math.atan((H / 2) / (f / sw * W)) * 180 / Math.PI, W / H, 0.02, 500);
  cam.position.set(0.08, 1.36, -1.62); cam.lookAt(-0.02, 1.04, 0.4); cam.rotateZ(-0.012); cam.updateMatrixWorld(true);
  return { cam, W, H };
}
// esquinas del auto demo repartidas en profundidad y altura: parabrisas, parantes B arriba, parantes C abajo
const TOUR_DEMO_POINTS = [[-0.775, 1.43, -0.32], [0.775, 1.43, -0.32], [-0.7, 1.42, 0.58], [0.7, 1.42, 0.58], [-0.76, 0.78, 1.42], [0.76, 0.78, 1.42]];
// un punto de la pantalla donde un click en modo Pins cae sobre el scan
function tourPinPoint() {
  const r = vp.getBoundingClientRect(), box = new THREE.Box3().setFromObject(scanRoot);
  const cands = [...TOUR_DEMO_POINTS.map(p => new THREE.Vector3(...p)), box.getCenter(new THREE.Vector3())];
  for (const w of cands) {
    const q = projectWorld(w); if (!q.front) continue;
    const [x, y] = uvToVp(q.u, q.v);
    if (x < 20 || y < 60 || x > r.width - 20 || y > r.height - 20) continue;
    if (pick(x, y)) return { x: r.left + x, y: r.top + y };
  }
  return null;
}
const TOUR_OPS = {
  press: { args: ['anchor'], run: o => tourNeed(o.anchor).click() },
  set: { args: ['anchor', 'value'], run: o => tourSetValue(tourNeed(o.anchor), o.value) },
  open: { args: ['anchor'], run: o => tourOpenSection(tourNeed(o.anchor)) },
  mode: { args: ['name'], run: o => { if (st.mode !== o.name) setMode(o.name); } },
  clear_pins: { args: [], run: () => { clearPinsKeepCam(); st.solved = null; refreshAll(); } },
  // seis pins ya puestos donde corresponden (lo que haría el usuario a mano), sin resolver
  demo_pins: { args: [], run: () => {
    const { cam } = tourDemoCamera();
    st.pins = TOUR_DEMO_POINTS.map(p => {
      const w = new THREE.Vector3(...p), v = w.clone().project(cam);
      return { id: st.nextId++, local: scanRoot.worldToLocal(w.clone()), uv: [(v.x + 1) / 2 * st.plate.W, (1 - v.y) / 2 * st.plate.H], on: true, err: NaN };
    });
    st.sel = -1; st.solved = null; st.rms = null; refreshAll();
  } },
  // vía privada del chequeo: el mismo pin que deja un click en modo Pins
  add_pin: { args: [], run: () => {
    const p = tourPinPoint(); if (!p) throw new Error('no scan point under the camera');
    const r = vp.getBoundingClientRect(), hit = pick(p.x - r.left, p.y - r.top), q = projectWorld(hit);
    pushHistory(); st.pins.push({ id: st.nextId++, local: scanRoot.worldToLocal(hit.clone()), uv: [q.u, q.v], on: true, err: 0 });
    st.sel = st.pins.length - 1; solveLive(false); refreshAll();
  } },
  frame: { args: ['f'], run: o => { tlPlay(false); tlSet(o.f); } },
  stop: { args: [], run: () => tlPlay(false) },
  // Cars in lanes vacío al empezar el capítulo (js/lane-cars.js)
  lane_cars_clear: { args: [], run: () => { if (typeof lcApplyProject === 'function') lcApplyProject(null); } },
  // aprieta un botón con estado (aria-pressed) sólo si no está como se pide
  toggle: { args: ['anchor', 'on'], run: o => { const el = tourNeed(o.anchor); if ((el.getAttribute('aria-pressed') === 'true') !== !!o.on) el.click(); } },
  // driving plate de práctica: la avenida de la app vista con OTRA cámara (18 mm full frame, mirando atrás,
  // a 1.5 m), como el que arma qa/drive.mjs; se carga por el mismo camino que «Load drive plate»
  // keep: si ya hay un driving cargado (el usuario lo midió o lo eligió), queda ése
  demo_drive: { args: [], opt: ['keep'], run: async (o) => {
    if (o && o.keep && drv.src) return;
    const D = { focal: 18, sw: 36, W: 1920, H: 1080, yawDeg: 180, heightM: 1.5 };
    const prev = env.id; if (prev !== 'avenue') envSelect('avenue');
    const cv = document.createElement('canvas'); cv.width = D.W; cv.height = D.H;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, logarithmicDepthBuffer: true });
    r.outputColorSpace = THREE.SRGBColorSpace; r.setClearColor(0xb4c3cf, 1);
    const c = new THREE.PerspectiveCamera(2 * Math.atan(D.H / 2 / (D.focal / D.sw * D.W)) * 180 / Math.PI, D.W / D.H, 0.05, 5000);
    c.position.set(camera.position.x, D.heightM, camera.position.z);
    c.quaternion.setFromEuler(new THREE.Euler(0, D.yawDeg * Math.PI / 180, 0, 'YXZ')); c.updateMatrixWorld(true);
    const vis = [scanRoot.visible, grid.visible, envRoot.visible]; scanRoot.visible = false; grid.visible = false; envRoot.visible = true;
    const par = envRoot.parent; if (par !== scene) scene.add(envRoot); // con el key prendido la calle vive en envScene
    r.render(scene, c); [scanRoot.visible, grid.visible, envRoot.visible] = vis; if (par && par !== scene) par.add(envRoot);
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9)); r.dispose(); r.forceContextLoss();
    if (prev !== 'avenue') envSelect(prev); // detrás del verde queda sólo el driving plate
    await drvLoadFile(new File([blob], 'practice_drive_18mm.jpg', { type: 'image/jpeg' }));
    Object.assign(drv.cam, { preset: 'custom', ex: null, sw: D.sw, focal: D.focal, par: 1, tiltDeg: 0, rollDeg: 0, yawDeg: D.yawDeg, heightM: D.heightM });
    drvUI(); render();
  } },
  // Measure drive camera (js/drive-tools.js): las dos líneas sobre los bordes de la calle del driving de
  // práctica (demo_drive mira atrás desde 1.5 m), como las pondría el usuario
  demo_measure_lines: { args: [], run: () => {
    if (!dm.on && !dmOpen()) throw new Error('no drive plate');
    const c = SceneMath.camera(drvIntr(), { ...drvPose(), heightM: 1.5, xM: 0, zM: 0 });
    dm.lines[0] = c.projectSegment([-1.75, 0, 6], [-1.75, 0, 40]); dm.lines[1] = c.projectSegment([1.75, 0, 5], [1.75, 0, 30]);
    dm.twoVP = false; dmSolve();
  } },
  // si la medición quedó abierta (Back, saltear paso), se cierra sin tocar la cámara
  drive_measure_close: { args: [], run: () => { if (dm.on) dmClose(false); } },
};
const tourNum = (el) => parseFloat(el.value);
// cada condición: test(c, snap); snap() se toma al entrar al paso, para pedir un resultado NUEVO
const TOUR_CONDS = {
  mode: { args: ['name'], test: c => st.mode === c.name },
  pins: { args: ['min'], test: c => st.pins.length >= c.min },
  rms: { args: ['max'], test: c => !!st.solved && st.rms != null && st.rms <= c.max },
  value: { args: ['anchor'], opt: ['equals', 'min', 'max'], test: c => {
    const el = tourEl(c.anchor); if (!el) return false;
    if (c.equals !== undefined) return String(el.value) === String(c.equals);
    const v = tourNum(el); return Number.isFinite(v) && (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
  } },
  checked: { args: ['anchor'], opt: ['is'], test: c => { const el = tourEl(c.anchor); return !!el && el.checked === (c.is !== false); } },
  pressed: { args: ['anchor'], opt: ['is'], test: c => { const el = tourEl(c.anchor); return !!el && (el.getAttribute('aria-pressed') === 'true') === (c.is !== false); } },
  shown: { args: ['anchor'], opt: ['is'], test: c => { const el = tourEl(c.anchor); return !!el && !!tourBox(el) === (c.is !== false); } },
  open: { args: ['anchor'], test: c => { const el = tourEl(c.anchor); const s = el && el.closest('.step'); return !!s && !el.closest('.step.closed'); } },
  env: { args: ['id'], test: c => env.id === c.id && env.on },
  motion: { args: [], opt: ['min_speed', 'max_speed'], test: c => !!env.vals.mon && (env.vals.speed || 0) >= (c.min_speed || 0) && (c.max_speed === undefined || (env.vals.speed || 0) <= c.max_speed) },
  frame_moved: { args: [], snap: () => tl.frame, test: (c, f0) => tl.frame !== f0 },
  key: { args: [], test: () => key.on },
  zdefocus: { args: [], test: () => typeof zdf !== 'undefined' && zdf.on },
  ghost: { args: [], test: () => typeof gh !== 'undefined' && gh.on }, // la comparación con el 3D (js/ghost.js)
  lane_car: { args: [], opt: ['min'], test: c => typeof lc !== 'undefined' && lc.cars.length >= (c.min || 1) }, // Cars in lanes (js/lane-cars.js)
  focus: { args: [], opt: ['min', 'max'], test: c => typeof lensState !== 'undefined' && (c.min === undefined || lensState.focusM >= c.min) && (c.max === undefined || lensState.focusM <= c.max) },
  defocus_copied: { args: [], snap: () => typeof bokehState !== 'undefined' ? bokehState.copies : 0, test: (c, n) => typeof bokehState !== 'undefined' && bokehState.copies > n },
  camera_copied: { args: [], snap: () => tourCopies.camera, test: (c, n) => tourCopies.camera > n },
  cornerpin_copied: { args: [], snap: () => tourCopies.drive, test: (c, n) => tourCopies.drive > n },
  drive_measured: { args: [], snap: () => dm.applied, test: (c, n) => dm.applied > n && !dm.on },
  scene_auto: { args: [], snap: () => typeof sceneSt !== 'undefined' ? sceneSt.auto : null, test: (c, a0) => typeof sceneSt !== 'undefined' && !!sceneSt.auto && sceneSt.auto !== a0 },
};
// otros módulos pueden registrar sus operaciones y condiciones (mismo formato) antes de que arranque
const tourCopies = { camera: 0, drive: 0 };

// ---------- Validación del guion (también la usa tests/test_tour_catalog.mjs) ----------
function tourValidate(cat) {
  const errs = [], L = (o, where) => { if (!o || typeof o.en !== 'string' || typeof o.es !== 'string' || !o.en || !o.es) errs.push(where + ': needs en and es'); };
  const only = (o, keys, where) => Object.keys(o || {}).forEach(k => { if (!keys.includes(k)) errs.push(`${where}: unknown field "${k}"`); });
  const checkArgs = (o, def, where) => {
    if (!def) { errs.push(`${where}: unknown "${o.op || o.what}"`); return; }
    (def.args || []).forEach(a => { if (o[a] === undefined) errs.push(`${where}: needs "${a}"`); });
    only(o, [o.op !== undefined ? 'op' : 'what', ...(def.args || []), ...(def.opt || [])], where);
  };
  if (!cat || typeof cat !== 'object') return ['catalog is not an object'];
  only(cat, ['version', 'order', 'tutorials', 'welcome', 'final', 'chapters'], 'catalog');
  L(cat.welcome && cat.welcome.title, 'welcome.title'); L(cat.welcome && cat.welcome.text, 'welcome.text');
  L(cat.final && cat.final.title, 'final.title'); L(cat.final && cat.final.text, 'final.text');
  const steps = new Set();
  for (const [cid, ch] of Object.entries(cat.chapters || {})) {
    const w = 'chapter ' + cid;
    only(ch, ['contentVersion', 'minutes', 'title', 'summary', 'steps'], w);
    if (!(ch.contentVersion >= 1)) errs.push(w + ': contentVersion');
    L(ch.title, w + '.title'); L(ch.summary, w + '.summary');
    if (!Array.isArray(ch.steps) || !ch.steps.length) errs.push(w + ': no steps');
    (ch.steps || []).forEach((s, i) => {
      const ws = `${w} step ${s.id || i}`;
      only(s, ['id', 'mode', 'anchor', 'place', 'enter', 'title', 'text', 'turn', 'do', 'until', 'timeout_s'], ws);
      if (!s.id || steps.has(s.id)) errs.push(ws + ': id missing or repeated'); steps.add(s.id);
      if (!['info', 'do'].includes(s.mode)) errs.push(ws + ': mode must be info or do');
      if (s.place && !['left', 'right', 'top', 'bottom'].includes(s.place)) errs.push(ws + ': place');
      L(s.title, ws + '.title'); L(s.text, ws + '.text');
      (s.enter || []).forEach((o, k) => checkArgs(o, TOUR_OPS[o.op], `${ws} enter ${k}`));
      (s.do || []).forEach((o, k) => checkArgs(o, TOUR_OPS[o.op], `${ws} do ${k}`));
      if (s.mode === 'do') {
        if (!s.anchor) errs.push(ws + ': a do step needs an anchor');
        L(s.turn, ws + '.turn');
        if (!s.until) errs.push(ws + ': a do step needs until'); else checkArgs(s.until, TOUR_CONDS[s.until.what], ws + ' until');
        if (!s.do || !s.do.length) errs.push(ws + ': a do step needs do (the check path)');
      } else if (s.until || s.turn || s.do) errs.push(ws + ': info steps have no turn, do or until');
    });
  }
  for (const id of cat.order || []) if (!(cat.tutorials || {})[id]) errs.push('order: unknown tour ' + id);
  for (const [tid, t] of Object.entries(cat.tutorials || {})) {
    only(t, ['group', 'title', 'summary', 'chapters'], 'tour ' + tid);
    if (!['workflow', 'topic', 'pack'].includes(t.group)) errs.push(`tour ${tid}: group`);
    L(t.title, `tour ${tid}.title`); L(t.summary, `tour ${tid}.summary`);
    (t.chapters || []).forEach(c => { if (!cat.chapters[c]) errs.push(`tour ${tid}: unknown chapter ${c}`); });
  }
  return errs;
}
// anclas que un capítulo usa (para decir qué falta en esta versión)
function tourChapterAnchors(ch) {
  const a = new Set();
  ch.steps.forEach(s => { if (s.anchor) a.add(s.anchor); [...(s.enter || []), ...(s.do || [])].forEach(o => { if (o.anchor) a.add(o.anchor); }); if (s.until && s.until.anchor) a.add(s.until.anchor); });
  return [...a];
}
// '#id' son controles que la app genera al preparar el paso: no cuentan como faltantes
const tourMissing = (ch) => tourChapterAnchors(ch).filter(a => a[0] !== '#' && !tourEl(a));

// ---------- Progreso (por id y versión de capítulo, nunca por posición) ----------
function tourProg() { try { return JSON.parse(localStorage.getItem(TOUR_PROGRESS_KEY)) || {}; } catch (e) { return {}; } }
function tourProgEdit(fn) { const p = tourProg(); fn(p); try { localStorage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(p)); } catch (e) {} }
const tourSeen = (p, id, v) => !!(p.seen && p.seen[id] && p.seen[id][v]);
const tourSeenOlder = (p, id, v) => !!(p.seen && p.seen[id] && Object.keys(p.seen[id]).some(k => +k < v));
const tourOmitted = (p, r, id, v) => !!(p.omit && p.omit[r] && p.omit[r][id] === v);

// ---------- Catálogo ----------
let tourCat = null, tourCatErr = '';
const tourCatReady = typeof document === 'undefined' ? null : fetch('tours/catalog.json').then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
  .then(c => { const e = tourValidate(c); if (e.length) throw new Error(e.slice(0, 5).join('; ')); tourCat = c; return c; })
  .catch(e => { tourCatErr = e.message; console.error('tour catalog: ' + e.message); return null; });
const tourT = (o, lang) => o ? (o[lang] || o.en) : '';
const tourMinutes = (ids) => ids.reduce((m, c) => m + (tourCat.chapters[c].minutes || 0), 0);

// ---------- Motor: capa, hueco, aro y globo ----------
const tour = { on: false, route: '', lang: 'en', chapters: [], ci: 0, si: -1, phase: '', line: '', snap: null, problem: '', poll: 0, t0: 0, hole: null, from: '' };
let tourDom = null;
function tourBuild() {
  if (tourDom) return tourDom;
  const L = document.createElement('div'); L.className = 'tour-layer'; L.id = 'tour-layer'; L.hidden = true;
  L.innerHTML = `<svg class="tour-dim" aria-hidden="true"><defs><mask id="tour-mask"><rect width="100%" height="100%" fill="#fff"/><rect id="tour-hole" rx="7" fill="#000"/></mask></defs><rect class="tour-dim-r" width="100%" height="100%" mask="url(#tour-mask)"/></svg>`
    + ['t', 'b', 'l', 'r'].map(s => `<div class="tour-block" data-s="${s}"></div>`).join('')
    + `<div class="tour-ring" aria-hidden="true"></div><div class="tour-bubble" role="dialog" aria-live="polite" aria-label="Guided tour"></div>`;
  document.body.appendChild(L);
  const blocks = [...L.querySelectorAll('.tour-block')], bubble = L.querySelector('.tour-bubble');
  blocks.forEach(b => {
    b.addEventListener('pointerdown', e => { e.preventDefault(); bubble.classList.remove('nudge'); void bubble.offsetWidth; bubble.classList.add('nudge'); });
    // mirar siempre se puede: la rueda llega al visor (zoom) y al panel (scroll) aunque estén tapados
    b.addEventListener('wheel', e => {
      e.preventDefault();
      blocks.forEach(x => x.style.pointerEvents = 'none'); const under = document.elementFromPoint(e.clientX, e.clientY); blocks.forEach(x => x.style.pointerEvents = '');
      if (!under) return;
      if (under.closest('#vp')) under.dispatchEvent(new WheelEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, bubbles: true, cancelable: true }));
      else { const sc = under.closest('.scroll'); if (sc) sc.scrollBy(0, e.deltaY); }
    }, { passive: false });
  });
  // los botones del globo no se llevan el foco de la app
  bubble.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  bubble.addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (b && !b.disabled) tourAct(b.dataset.act); });
  tourDom = { L, blocks, bubble, ring: L.querySelector('.tour-ring'), hole: L.querySelector('#tour-hole') };
  return tourDom;
}
const tourLab = () => TOUR_LABELS[tour.lang] || TOUR_LABELS.en;
const tourCh = () => tourCat.chapters[tour.chapters[tour.ci]];
const tourStep = () => tour.si >= 0 ? tourCh().steps[tour.si] : null;
function tourRich(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
}
function tourStart(route, chapter, lang) {
  tour.route = route; tour.lang = lang === 'es' ? 'es' : 'en';
  tour.chapters = tourCat.tutorials[route].chapters.slice();
  tour.on = true; tourBuild().L.hidden = false;
  const ci = chapter ? tour.chapters.indexOf(chapter) : -1;
  if (ci >= 0) { tour.ci = ci; tourChapterCard(); } else { tour.ci = 0; tour.si = -1; tour.phase = 'welcome'; tourRender(); }
  clearInterval(tour.poll); tour.poll = setInterval(tourTick, TOUR_POLL_MS);
}
function tourChapterCard() {
  tour.si = -1; tour.phase = 'chapter'; tour.line = '';
  tourProgEdit(p => { (p.cursor = p.cursor || {})[tour.route] = tour.chapters[tour.ci]; });
  tourRender();
}
async function tourRunOps(ops) { for (const o of ops || []) await TOUR_OPS[o.op].run(o); }
// entrar a un paso: preparar (enter), mostrar la sección del ancla, tomar la foto para la condición
async function tourEnter(si, fromBack) {
  tour.si = si; tour.phase = 'step'; tour.line = ''; tour.problem = ''; tour.t0 = Date.now(); tour.from = fromBack ? 'back' : '';
  const token = tour.token = (tour.token || 0) + 1;
  const s = tourStep();
  if (!fromBack && s.enter && s.enter.length) {
    tour.line = 'preparing'; tourRender(); // una preparación larga (cargar un archivo) se anuncia
    try { await tourRunOps(s.enter); } catch (e) { if (token === tour.token) { tour.phase = 'problem'; tour.problem = e.message; tourRender(); } return; }
    if (token !== tour.token) return; // el usuario se movió mientras se preparaba
    tour.line = ''; tour.t0 = Date.now();
  }
  const el = tourEl(s.anchor);
  if (!el && typeof vbMore === "function") vbMore(false); // un paso sin control no deja More abierto tapando el visor
  if (el) { tourOpenSection(el); const t = tourTarget(el); if (tourBox(t)) (t.getClientRects().length ? t : t.firstElementChild).scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  if (s.mode === 'do') {
    const c = TOUR_CONDS[s.until.what]; tour.snap = c.snap ? c.snap() : null;
    if (c.test(s.until, tour.snap)) tour.line = 'already'; // ya cumplido al entrar: se explica, no se pide
  }
  tourRender();
}
function tourAdvance() {
  const ch = tourCh();
  if (tour.si + 1 < ch.steps.length) { tourEnter(tour.si + 1); return; }
  const id = tour.chapters[tour.ci];
  tourProgEdit(p => { ((p.seen = p.seen || {})[id] = p.seen[id] || {})[ch.contentVersion] = tour.route; });
  tourNextChapter();
}
function tourNextChapter() {
  if (tour.ci + 1 < tour.chapters.length) { tour.ci++; tourChapterCard(); return; }
  tourProgEdit(p => { if (p.cursor) delete p.cursor[tour.route]; });
  tour.phase = 'final'; tour.si = -1; tourRender();
}
function tourBack() {
  if (tour.phase === 'step' || tour.phase === 'problem') {
    if (tour.si > 0) tourEnter(tour.si - 1, true); else tourChapterCard();
  } else if (tour.phase === 'chapter') {
    if (tour.ci > 0) { tour.ci--; tourEnter(tourCh().steps.length - 1, true); } else { tour.phase = 'welcome'; tourRender(); }
  }
}
function tourAct(a) {
  const ch = tour.phase === 'welcome' || tour.phase === 'final' ? null : tourCh();
  if (a === 'next') {
    if (tour.phase === 'welcome') tourChapterCard();
    else if (tour.phase === 'chapter') { if (tourMissing(ch).length) tourNextChapter(); else tourEnter(0); }
    else if (tour.phase === 'step' && tourNextOk()) tourAdvance();
  } else if (a === 'back') tourBack();
  else if (a === 'skipch') { const id = tour.chapters[tour.ci]; tourProgEdit(p => { ((p.omit = p.omit || {})[tour.route] = p.omit[tour.route] || {})[id] = ch.contentVersion; }); tourNextChapter(); }
  else if (a === 'skip') tourAdvance();
  else if (a === 'retry') tourEnter(tour.si);
  else if (a === 'exit') { tour.prev = tour.phase; tour.phase = 'confirm'; tourRender(); }
  else if (a === 'keep') { tour.phase = tour.prev; tourRender(); }
  else if (a === 'leave') tourLeave();
  else if (a === 'restart') { tour.ci = 0; tour.phase = 'welcome'; tourRender(); }
}
function tourNextOk() {
  const s = tourStep(); if (!s) return true;
  if (tour.line === 'preparing') return false;
  if (s.mode === 'info' || tour.line === 'already') return true;
  return false; // en un paso de acción, Next nunca la hace (con el control fuera de pantalla queda Skip)
}
// salir: la copia de práctica se descarta y vuelve la app del usuario
function tourLeave() {
  tour.on = false; clearInterval(tour.poll); if (tourDom) tourDom.L.hidden = true;
  if (window.parent !== window) { try { window.parent.postMessage({ bplTour: 'exit' }, location.origin); return; } catch (e) {} }
  location.href = location.pathname;
}
function tourTick() {
  if (!tour.on) return;
  const s = tourStep();
  if (tour.phase === 'step' && s && s.mode === 'do' && !tour.line && tourEl(s.anchor)) {
    if (TOUR_CONDS[s.until.what].test(s.until, tour.snap)) {
      tour.line = 'done'; tourRender();
      setTimeout(() => { if (tour.on && tourStep() === s && tour.line === 'done') tourAdvance(); }, TOUR_DONE_MS);
    } else if (s.timeout_s && Date.now() - tour.t0 > s.timeout_s * 1000) { tour.phase = 'problem'; tour.problem = 'timeout'; tourRender(); }
  }
  tourLayout();
}
function tourRender() {
  const d = tourBuild(), lab = tourLab(), ph = tour.phase, s = tourStep();
  const btn = (act, text, cls = '', dis = false) => `<button class="btn ${cls}" data-act="${act}"${dis ? ' disabled' : ''}>${text}</button>`;
  const keys = (list) => `<div class="tb-keys">${list.map(([k, t]) => `<kbd>${k}</kbd> ${t}`).join('<span>·</span>')}</div>`;
  let h = '', card = false;
  if (ph === 'welcome' || ph === 'final') {
    card = true; const w = tourCat[ph === 'welcome' ? 'welcome' : 'final'];
    h = (ph === 'final' ? '<div class="tb-badge" aria-hidden="true"></div>' : '')
      + `<div class="tb-title">${tourRich(tourT(w.title, tour.lang))}</div><div class="tb-text">${tourRich(tourT(w.text, tour.lang))}</div>`
      + (ph === 'welcome' ? `<div class="tb-foot">${btn('exit', lab.exitTour, 'ghost')}<span class="tb-fill"></span>${btn('next', lab.next, 'primary')}</div>${keys([['Enter', lab.keyNext], ['Esc', lab.keyExit]])}`
        : `<div class="tb-foot">${btn('restart', lab.restart, 'ghost')}<span class="tb-fill"></span>${btn('leave', lab.backToProject, 'primary')}</div>`);
  } else if (ph === 'chapter') {
    card = true; const ch = tourCh(), miss = tourMissing(ch), n = ch.steps.length;
    h = `<div class="tb-top"><span class="tb-step">${tourFmt(lab.chapterOf, tour.ci + 1, tour.chapters.length)}</span><span class="tb-tour">${n === 1 ? lab.step1 : tourFmt(lab.steps, n)} · ${tourFmt(lab.minutes, ch.minutes || 1)}</span></div>`
      + `<div class="tb-title">${tourRich(tourT(ch.title, tour.lang))}</div><div class="tb-text">${tourRich(tourT(ch.summary, tour.lang))}</div>`
      + (miss.length ? `<div class="tb-line" data-k="notice"><i></i><span>${tourRich(tourFmt(lab.unavailable, miss.join(', ')))}</span></div>` : '')
      + `<div class="tb-foot">${btn('exit', lab.exitTour, 'ghost')}<span class="tb-fill"></span>${btn('back', lab.back, '', tour.ci === 0 && !tourCat.welcome)}${miss.length ? '' : btn('skipch', lab.skipChapter)}${btn('next', miss.length ? lab.nextChapter : lab.startChapter, 'primary')}</div>`
      + keys([['Enter', miss.length ? lab.keyNext : lab.keyStart], ['←', lab.keyBack], ['Esc', lab.keyExit]]);
  } else if (ph === 'confirm') {
    h = `<div class="tb-title">${lab.confirmExit}</div><div class="tb-foot"><span class="tb-fill"></span>${btn('keep', lab.keepGoing)}${btn('leave', lab.exit, 'primary')}</div>${keys([['Enter', lab.keyKeep], ['Esc', lab.keyExit]])}`;
  } else if (s) {
    const ch = tourCh(), n = ch.steps.length, vis = tour.lastVis = !!tourHoleRect(), prob = ph === 'problem';
    let line = '';
    if (prob) line = `<div class="tb-line" data-k="notice"><i></i><span>${tour.problem === 'timeout' ? lab.takingLong : lab.couldNot}${tour.problem && tour.problem !== 'timeout' ? ` <span class="tb-dim">(${tourRich(tour.problem)})</span>` : ''}</span></div>`;
    else if (tour.line === 'preparing') line = `<div class="tb-line" data-k="notice"><i></i><span class="tb-dim">${lab.preparing}</span></div>`;
    else if (tour.line === 'done' || tour.line === 'already') line = `<div class="tb-line" data-k="done"><i></i><span>${tour.line === 'done' ? lab.done : lab.alreadyDone}</span></div>`;
    else if (s.anchor && !vis) line = `<div class="tb-line" data-k="notice"><i></i><span>${lab.notOnScreen}</span></div>`;
    else if (s.mode === 'do') line = `<div class="tb-line" data-k="turn"><i></i><span>${lab.yourTurn} ${tourRich(tourT(s.turn, tour.lang))}</span></div>`;
    const segs = Array.from({ length: n }, (_, i) => `<i class="${i < tour.si ? 'd' : i === tour.si ? 'c' : ''}"></i>`).join('');
    const nextOk = !prob && tourNextOk(), skip = prob || (s.mode === 'do' && !tour.line && s.anchor && !vis);
    h = `<div class="tb-top"><span class="tb-step">${tourFmt(lab.stepOf, tour.si + 1, n)}</span><span class="tb-tour">${tourRich(tourT(ch.title, tour.lang))}</span></div>`
      + `<div class="tb-title">${tourRich(tourT(s.title, tour.lang))}</div><div class="tb-text">${tourRich(tourT(s.text, tour.lang))}</div>${line}`
      + `<div class="tb-seg">${segs}</div>`
      + `<div class="tb-foot">${btn('exit', lab.exitTour, 'ghost')}<span class="tb-fill"></span>${btn('back', lab.back)}${skip ? btn('skip', lab.skipStep) : ''}${prob ? btn('retry', lab.tryAgain, 'primary') : btn('next', lab.next, 'primary', !nextOk)}</div>`
      + keys([...(nextOk ? [['Enter', lab.keyNext]] : []), ['←', lab.keyBack], ['Esc', lab.keyExit]]);
  }
  d.bubble.innerHTML = h;
  d.bubble.classList.toggle('card', card);
  d.bubble.dataset.phase = ph;
  d.bubble.dataset.attn = String(ph === 'confirm' || ph === 'problem');
  d.L.dataset.pulse = String(ph === 'step' && !(s && s.mode === 'do' && tour.line === 'done'));
  tourLayout(true);
}
// hueco + aro + globo; se recalcula en cada sondeo (el control puede moverse o cambiar la escala de UI)
// La caja de un ancla. Una con display: contents (la fila de la cámara en una barra angosta) no tiene caja
// propia: se toma la que envuelve a sus hijos visibles.
function tourBox(t) {
  if (getComputedStyle(t).display !== 'contents') return t.getClientRects().length ? t.getBoundingClientRect() : null;
  let b = null;
  for (const c of t.children) {
    const r = tourBox(c); if (!r) continue;
    b = b ? { left: Math.min(b.left, r.left), top: Math.min(b.top, r.top), right: Math.max(b.right, r.right), bottom: Math.max(b.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  return b;
}
function tourHoleRect() {
  if (tour.phase !== 'step' && tour.phase !== 'problem' && !(tour.phase === 'confirm' && tour.prev === 'step')) return null;
  const s = tourStep(); const el = s && tourEl(s.anchor); if (!el) return null;
  const t = tourTarget(el), r = tourBox(t); if (!r) return null;
  let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
  // recortado a lo que se ve de su panel con scroll y a la ventana
  for (let p = t.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll' || o === 'hidden') { const q = p.getBoundingClientRect(); x0 = Math.max(x0, q.left); y0 = Math.max(y0, q.top); x1 = Math.min(x1, q.right); y1 = Math.min(y1, q.bottom); }
  }
  x0 = Math.max(x0, 0); y0 = Math.max(y0, 0); x1 = Math.min(x1, innerWidth); y1 = Math.min(y1, innerHeight);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const pad = 6; return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}
function tourLayout(force) {
  if (!tour.on || !tourDom) return;
  const d = tourDom, H = tourHoleRect();
  // el control apareció o se fue (sección plegada, ventana chica): el globo lo dice
  if (tour.phase === 'step' && tour.lastVis !== !!H) { tourRender(); return; }
  const key = JSON.stringify(H) + innerWidth + 'x' + innerHeight + d.bubble.offsetWidth + 'x' + d.bubble.offsetHeight;
  if (!force && key === tour.layoutKey) return;
  tour.layoutKey = key;
  const W = innerWidth, Hh = innerHeight;
  const hr = H || { x: W / 2, y: Hh / 2, w: 0, h: 0 };
  d.hole.setAttribute('x', hr.x); d.hole.setAttribute('y', hr.y); d.hole.setAttribute('width', hr.w); d.hole.setAttribute('height', hr.h);
  // cuatro bloques alrededor del hueco: el hueco recibe los clicks de verdad
  const [t, b, l, r] = d.blocks;
  Object.assign(t.style, { left: 0, top: 0, width: W + 'px', height: Math.max(0, hr.y) + 'px' });
  Object.assign(b.style, { left: 0, top: hr.y + hr.h + 'px', width: W + 'px', height: Math.max(0, Hh - hr.y - hr.h) + 'px' });
  Object.assign(l.style, { left: 0, top: hr.y + 'px', width: Math.max(0, hr.x) + 'px', height: hr.h + 'px' });
  Object.assign(r.style, { left: hr.x + hr.w + 'px', top: hr.y + 'px', width: Math.max(0, W - hr.x - hr.w) + 'px', height: hr.h + 'px' });
  d.ring.hidden = !H;
  if (H) Object.assign(d.ring.style, { left: H.x + 'px', top: H.y + 'px', width: H.w + 'px', height: H.h + 'px' });
  // globo: al lado pedido si entra sin tapar el hueco; si no, el lado que menos tapa; siempre dentro de la ventana
  const bw = d.bubble.offsetWidth, bh = d.bubble.offsetHeight, m = 8, gap = 14;
  const clampX = x => Math.min(Math.max(x, m), W - bw - m), clampY = y => Math.min(Math.max(y, m), Hh - bh - m);
  let pos;
  if (!H) pos = { x: (W - bw) / 2, y: (Hh - bh) / 2 };
  else {
    const s = tourStep(), cx = H.x + H.w / 2, cy = H.y + H.h / 2;
    const cand = {
      left: { x: H.x - gap - bw, y: clampY(cy - bh / 2) }, right: { x: H.x + H.w + gap, y: clampY(cy - bh / 2) },
      top: { x: clampX(cx - bw / 2), y: H.y - gap - bh }, bottom: { x: clampX(cx - bw / 2), y: H.y + H.h + gap },
    };
    const order = [...new Set([(s && s.place) || 'right', 'right', 'left', 'bottom', 'top'])];
    const over = p => { const ix = Math.max(0, Math.min(p.x + bw, H.x + H.w) - Math.max(p.x, H.x)), iy = Math.max(0, Math.min(p.y + bh, H.y + H.h) - Math.max(p.y, H.y)); return ix * iy; };
    const fits = p => p.x >= m && p.y >= m && p.x + bw <= W - m && p.y + bh <= Hh - m;
    pos = order.map(k => cand[k]).find(p => fits(p) && !over(p));
    if (!pos) pos = order.map(k => ({ x: clampX(cand[k].x), y: clampY(cand[k].y) })).sort((a, b2) => over(a) - over(b2))[0];
  }
  d.bubble.style.left = Math.round(pos.x) + 'px'; d.bubble.style.top = Math.round(pos.y) + 'px';
}
function tourKey(e) {
  if (!tour.on) return;
  const inField = e.target.matches && e.target.matches('textarea, select, input:not([type=checkbox]):not([type=range]):not([type=radio])');
  if (e.key === 'Escape') {
    e.preventDefault();
    if (tour.phase === 'confirm') tourLeave(); else tourAct('exit');
    return;
  }
  if (inField) return;
  if (e.key === 'Enter' || e.key === 'ArrowRight') {
    if (tour.phase === 'confirm') { if (e.key === 'Enter') { e.preventDefault(); tourAct('keep'); } return; }
    if (tour.phase === 'final') return;
    const nb = tourDom.bubble.querySelector('button[data-act="next"]');
    if (nb && !nb.disabled) { e.preventDefault(); tourAct('next'); }
  } else if (e.key === 'ArrowLeft' && ['step', 'problem', 'chapter'].includes(tour.phase)) { e.preventDefault(); tourBack(); }
}

// ---------- Copia de práctica (?tour=<ruta>&ch=<capítulo>&lang=en|es&scale=<escala de UI>) ----------
const tourParams = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
const TOUR_PRACTICE = tourParams && tourParams.get('tour');
if (typeof document !== 'undefined') {
  window.addEventListener('keydown', tourKey);
  window.addEventListener('resize', () => tourLayout(true));
  window.addEventListener('ui-scale', () => setTimeout(() => tourLayout(true), 0));
  $('copy').addEventListener('click', () => tourCopies.camera++);
  if ($('drv-copy')) $('drv-copy').addEventListener('click', () => tourCopies.drive++);
}
if (TOUR_PRACTICE) {
  document.documentElement.classList.add('tour-practice');
  window.addEventListener('load', async () => {
    const sc = +tourParams.get('scale'); if (sc && typeof uiScaleSet === 'function') uiScaleSet(sc, false);
    // con un paquete de plano (tour-pack.js): su catálogo combinado y, salvo que pida la demo, la app vacía
    const pack = tourParams.get('pack') ? tourPackHere() : null;
    resetAll(true); if (!pack || pack.man.start === 'demo') loadDemo();
    let cat = await tourCatReady;
    if (tourParams.get('pack')) {
      if (pack) cat = tourCat = JSON.parse(JSON.stringify(pack.cat));
      else { cat = null; tourCatErr = 'The shot pack is no longer open: choose its folder again in Help › Guided tours.'; }
    }
    if (!cat || !cat.tutorials[TOUR_PRACTICE]) {
      tour.on = true; tourBuild().L.hidden = false; tour.phase = 'confirm';
      tourDom.bubble.innerHTML = `<div class="tb-title">${TOUR_LABELS.en.catalogBad}</div><div class="tb-text tb-dim">${tourRich(tourCatErr || 'unknown tour ' + TOUR_PRACTICE)}</div><div class="tb-foot"><span class="tb-fill"></span><button class="btn primary" data-act="leave">${TOUR_LABELS.en.backToProject}</button></div>`;
      tourLayout(true); return;
    }
    tourStart(TOUR_PRACTICE, tourParams.get('ch') || '', tourParams.get('lang') || tourProg().lang || 'en');
  });
}

// ---------- Lanzador (app del usuario): la práctica va en un iframe encima; al salir vuelve todo ----------
function tourLaunch(route, chapter, lang) {
  if (typeof uiHelpClose === 'function') uiHelpClose();
  document.querySelectorAll('iframe.tour-frame').forEach(f => f.remove());
  const f = document.createElement('iframe'); f.className = 'tour-frame'; f.title = 'Guided tour (practice copy)';
  const q = new URLSearchParams({ tour: route, lang }); if (chapter) q.set('ch', chapter);
  const pk = tourCat.tutorials[route] && tourCat.tutorials[route].group === 'pack' && window.tourPackActive; if (pk) q.set('pack', pk.id);
  if (typeof uiScaleGet === 'function') q.set('scale', uiScaleGet());
  f.src = location.pathname + '?' + q;
  f.addEventListener('load', () => f.contentWindow.focus());
  document.body.appendChild(f);
}
if (typeof document !== 'undefined' && !TOUR_PRACTICE) {
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.bplTour !== 'exit') return;
    document.querySelectorAll('iframe.tour-frame').forEach(f => f.remove());
    tourHelpRender(); window.focus();
  });
  window.addEventListener('storage', e => { if (e.key === TOUR_PROGRESS_KEY) tourHelpRender(); });
  // «New here?» en el visor vacío: abre el Help en los recorridos (F1 hace lo mismo, ver ui-scale.js)
  const box = document.querySelector('#empty > div');
  if (box) {
    const b = document.createElement('button'); b.className = 'btn primary tour-new'; b.dataset.tour = 'empty.tour';
    b.innerHTML = 'New here? Take the guided tour <kbd>F1</kbd>';
    b.addEventListener('click', () => uiHelpOpen('tours'));
    box.append(document.createElement('br'), b);
  }
}
// Import and Measure, con la que abre la app, no muestra el visor: ahí el botón va en el cuadro del plate vacío
// (lo llama js/module-tabs.js al cambiar de pestaña)
function tourNewPlace(imp) {
  const b = document.querySelector('.tour-new'), to = imp ? document.getElementById('imp-plate-e') : document.querySelector('#empty > div');
  if (b && to && b.parentElement !== to) to.append(b);
}

// ---------- Help: lista de recorridos y capítulos (empezar, retomar, ir a un capítulo, saltados, Updated) ----------
const tourHelp = { route: '', sel: '' };
const TOUR_HELP_TX = {
  en: { workflow: 'Complete workflows', topic: 'Single topics', ch: '%1 ch · %2 min', chapters: 'chapters', seen: 'seen',
    sSeen: 'Seen', sUpdated: 'Updated', sSkipped: 'Skipped', sHere: 'You left off here', sNA: 'Not in this version yet',
    resume: 'Resume · ch. %1  %2', start: 'Start the tour', over: 'Start over', go: 'Go to ch. %1',
    note: 'Opens a practice copy of BackplateLab with the demo scene. Nothing you do there touches your project or your settings. Press Esc twice to leave.',
    lang: 'Language only changes the tour. Your progress is kept.' },
  es: { workflow: 'Recorridos completos', topic: 'Temas sueltos', ch: '%1 cap · %2 min', chapters: 'capítulos', seen: 'vistos',
    sSeen: 'Ya visto', sUpdated: 'Actualizado', sSkipped: 'Omitido', sHere: 'Acá quedaste', sNA: 'Todavía no en esta versión',
    resume: 'Seguir · cap. %1  %2', start: 'Empezar el recorrido', over: 'Empezar de cero', go: 'Ir al cap. %1',
    note: 'Se abre una copia de práctica de BackplateLab con la escena demo. Lo que hagas ahí no toca tu proyecto ni tus ajustes. Esc dos veces sale.',
    lang: 'El idioma sólo cambia el recorrido. El progreso se conserva.' },
};
function tourHelpRender() {
  const host = typeof document !== 'undefined' && document.getElementById('help-tours'); if (!host || TOUR_PRACTICE) return;
  const p = tourProg(), lang = p.lang === 'es' ? 'es' : 'en', tx = TOUR_HELP_TX[lang];
  if (!tourCat) { host.innerHTML = `<p class="msg bad">${TOUR_LABELS[lang].catalogBad} ${tourRich(tourCatErr)}</p>`; return; }
  const order = tourCat.order.filter(id => tourCat.tutorials[id]);
  if (!tourCat.tutorials[tourHelp.route]) tourHelp.route = order[0];
  const route = tourHelp.route, chs = tourCat.tutorials[route].chapters;
  const cursor = p.cursor && p.cursor[route];
  const validCursor = chs.includes(cursor) && !tourSeen(p, cursor, tourCat.chapters[cursor].contentVersion);
  if (!chs.includes(tourHelp.sel)) tourHelp.sel = validCursor ? cursor : chs[0];
  const seenN = ids => ids.filter(c => tourSeen(p, c, tourCat.chapters[c].contentVersion)).length;
  const pk = window.tourPackActive;
  const list = tourPackHelpHtml(lang) + ['pack', 'workflow', 'topic'].map(g => {
    const ids = order.filter(id => tourCat.tutorials[id].group === g); if (!ids.length) return '';
    return `<div class="th-group">${g === 'pack' ? `${TOUR_PACK_TX[lang].group} · ${tourRich(pk ? pk.name : '')}` : tx[g]}</div>` + ids.map(id => {
      const t = tourCat.tutorials[id], n = t.chapters.length, sn = seenN(t.chapters);
      return `<button class="th-tour" data-route="${id}" aria-pressed="${id === route}"><b>${tourRich(tourT(t.title, lang))}</b><span class="th-meta">${tourFmt(tx.ch, n, tourMinutes(t.chapters))}<span class="th-bar"><i style="width:${Math.round(sn / n * 100)}%"></i></span>${sn}/${n}</span></button>`;
    }).join('');
  }).join('');
  const rows = chs.map((c, i) => {
    const ch = tourCat.chapters[c], v = ch.contentVersion;
    let state = '', status = '';
    if (tourMissing(ch).length) { state = 'na'; status = tx.sNA; }
    else if (tourSeen(p, c, v)) { state = 'seen'; status = tx.sSeen; }
    else if (tourSeenOlder(p, c, v)) { state = 'updated'; status = tx.sUpdated; }
    else if (tourOmitted(p, route, c, v)) { state = 'skipped'; status = tx.sSkipped; }
    if (validCursor && cursor === c) { state = 'here'; status = tx.sHere; }
    return `<li><button class="th-ch" data-ch="${c}" data-state="${state}" aria-pressed="${c === tourHelp.sel}" title="${tourRich(tourT(ch.summary, lang)).replace(/"/g, '&quot;')}"><span class="th-n">${state === 'seen' ? '✓' : i + 1}</span><span class="th-t">${tourRich(tourT(ch.title, lang))}</span><span class="th-s">${status}</span><span class="th-m">${ch.minutes || 1} min</span></button></li>`;
  }).join('');
  const selN = chs.indexOf(tourHelp.sel) + 1;
  const showGo = !(validCursor && tourHelp.sel === cursor) && !(!validCursor && selN === 1);
  const t = tourCat.tutorials[route];
  const top = ['.th-list', '.th-chs'].map(s => (host.querySelector(s) || {}).scrollTop || 0); // el scroll de cada lista sobrevive al redibujo
  host.innerHTML = `<div class="th">
    <nav class="th-list" aria-label="${lang === 'es' ? 'Recorridos' : 'Tours'}">${list}</nav>
    <div class="th-detail">
      <div class="th-head"><h3>${tourRich(tourT(t.title, lang))}</h3><span class="seg th-lang" role="group" aria-label="${lang === 'es' ? 'Idioma' : 'Language'}" title="${tx.lang}"><button data-lang="en" aria-pressed="${lang === 'en'}">EN</button><button data-lang="es" aria-pressed="${lang === 'es'}">ES</button></span></div>
      <p class="th-sum">${tourRich(tourT(t.summary, lang))}</p>
      <p class="th-facts"><b>${chs.length}</b> ${tx.chapters} &nbsp; <b>${tourMinutes(chs)}</b> min &nbsp; <b>${seenN(chs)}</b> ${tx.seen}</p>
      <ol class="th-chs">${rows}</ol>
      <div class="th-acts">
        ${validCursor ? `<button class="btn primary" data-go="resume">${tourFmt(tx.resume, chs.indexOf(cursor) + 1, tourRich(tourT(tourCat.chapters[cursor].title, lang)))}</button>` : ''}
        <button class="btn ${validCursor ? 'ghost' : 'primary'}" data-go="start">${validCursor ? tx.over : tx.start}</button>
        ${showGo ? `<button class="btn" data-go="chapter">${tourFmt(tx.go, selN)}</button>` : ''}
      </div>
      <p class="note th-note">${t.group === 'pack' ? TOUR_PACK_TX[lang].note : tx.note}</p>
    </div></div>`;
  ['.th-list', '.th-chs'].forEach((s, i) => { if (i === 0 || tourHelp.shown === route) host.querySelector(s).scrollTop = top[i]; });
  tourHelp.shown = route; // otro recorrido arranca su detalle desde arriba
}
if (typeof document !== 'undefined' && !TOUR_PRACTICE) {
  const host = document.getElementById('help-tours');
  if (host) {
    host.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.pack === 'pick') { $('f-pack').click(); return; }
      if (b.dataset.pack === 'close') { tourPackSet(null); tourPackUi.errs = null; }
      else if (b.dataset.route) { tourHelp.route = b.dataset.route; tourHelp.sel = ''; }
      else if (b.dataset.lang) tourProgEdit(p => { p.lang = b.dataset.lang; });
      else if (b.dataset.ch) {
        // doble click = ir a ese capítulo. Se cuenta acá y no con dblclick: el primer click redibuja la
        // lista y Chromium no dispara dblclick si el segundo cae en un botón nuevo
        if (e.detail >= 2) { const p = tourProg(), chs = tourCat.tutorials[tourHelp.route].chapters; tourLaunch(tourHelp.route, b.dataset.ch === chs[0] ? '' : b.dataset.ch, p.lang === 'es' ? 'es' : 'en'); return; }
        tourHelp.sel = b.dataset.ch;
      } else if (b.dataset.go) {
        const p = tourProg(), r = tourHelp.route, chs = tourCat.tutorials[r].chapters;
        const ch = b.dataset.go === 'resume' ? p.cursor[r] : b.dataset.go === 'chapter' ? tourHelp.sel : '';
        tourLaunch(r, ch === chs[0] ? '' : ch, p.lang === 'es' ? 'es' : 'en'); return;
      }
      tourHelpRender();
    });
    // el Help se abre en los recorridos cuando #help-tours tiene contenido (uiHelpOpen): llenarlo ya
    tourCatReady.then(tourHelpRender);
    // el progreso pudo cambiar con el Help cerrado (otra pestaña, la práctica): se relee al mostrarlo
    const reshow = () => { if (tourCat && !$('help-dlg').hidden && !$('help-pane-tours').hidden) tourHelpRender(); };
    ['help-dlg', 'help-pane-tours'].forEach(id => $(id) && new MutationObserver(reshow).observe($(id), { attributes: true, attributeFilter: ['hidden'] }));
  }
}

// ---------- Chequeo automático (qa/tour.mjs): lee el estado y usa la vía privada de las acciones ----------
if (TOUR_PRACTICE) {
  window.tourApi = {
    ready: () => tour.on && !!tourDom,
    state() {
      const s = tourStep(), d = tourDom, br = d.bubble.getBoundingClientRect(), H = tourHoleRect();
      const nb = d.bubble.querySelector('button[data-act="next"]');
      return { phase: tour.phase, chapter: tour.chapters[tour.ci], ci: tour.ci, si: tour.si, step: s && s.id, mode: s && s.mode, anchor: s && s.anchor,
        anchorFound: !!(s && tourEl(s.anchor)), line: tour.line, missing: tour.phase === 'chapter' ? tourMissing(tourCh()) : [],
        doOps: s && s.do ? s.do : [], hole: H, bubble: { x: br.left, y: br.top, w: br.width, h: br.height }, win: { w: innerWidth, h: innerHeight },
        nextEnabled: !!nb && !nb.disabled, problem: tour.problem };
    },
    runDo() { return tourRunOps(tourStep().do); },
    pinPoint: tourPinPoint,
    packPaths: (key) => tourPackList(tourPackNeed().man.files[key]),
  };
}
