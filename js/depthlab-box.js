// DepthLab: las capas que son sólo de DepthLab, prendidas y apagadas desde la caja de la derecha del visor (como los
// ejes de 2D Camera Match): Z defocus (D); las marcas FG / Focus / BG de Lens & focus (Focus), la fila de bokeh, las
// probes y la vista Depth (Shift+D); las 3D Guides (G) con su Mix, Cars in lanes (js/lane-cars.js) y los locators de
// distancia. Fuera de DepthLab no se ven (js/module-tabs.js y css/app.css).
function dlBoxUI() {
  const set = (id, on) => { const el = $(id); if (el && el.getAttribute('aria-pressed') !== String(!!on)) el.setAttribute('aria-pressed', String(!!on)); };
  set('zdf-chip', zdf.on);
  set('bkfoc-chip', bokehState.showFocus);
  set('bkrow-chip', $('bk-show-row').checked);
  set('bkpr-chip', $('bk-show-probes').checked);
  set('dp-chip', dpSt.show);
  { const live = typeof drvLive === 'function' && drvLive().length > 0, b = $('drv-chip'); set('drv-chip', live && drv.on); if (b.disabled === live) b.disabled = !live; }
  const bar = $('vpbar'), box = $('dl-box');
  // con el visor bajo (o la letra grande) la caja no se pasa del visor: se recorre con la rueda
  if (bar && box) { const t = bar.offsetTop + bar.offsetHeight + 8 + 'px'; if (box.style.top !== t) { box.style.top = t; box.style.maxHeight = `calc(100% - ${t} - 0.8rem)`; } }
}
{
  $('zdf-chip').onclick = () => setZdf(!zdf.on);
  $('drv-chip').onclick = () => { drvShow(); dlBoxUI(); };
  const viaBox = (id) => { const c = $(id); c.checked = !c.checked; c.dispatchEvent(new Event('change', { bubbles: true })); dlBoxUI(); };
  $('bkfoc-chip').onclick = () => { bkSet(s => { s.showFocus = !s.showFocus; }); dlBoxUI(); };
  $('bkrow-chip').onclick = () => viaBox('bk-show-row');
  $('bkpr-chip').onclick = () => viaBox('bk-show-probes');
  $('dp-chip').onclick = () => { dpSt.show = !dpSt.show; drawOverlay(); };
  ['pointerdown', 'wheel', 'dblclick'].forEach(t => $('dl-box').addEventListener(t, e => e.stopPropagation()));
  const f = drawOverlay; drawOverlay = function (...a) { const r = f(...a); dlBoxUI(); return r; };
  const z = setZdf; setZdf = function (...a) { const r = z(...a); dlBoxUI(); return r; };
}
// 3D Grid: la grilla de medición (js/guides.js) sobre el piso y las fachadas del entorno, cada 1, 2 o 4 m (la Home
// Grid es otra: la de la barra del visor, en el origen). Como las 3D
// Guides: con el key, una copia debajo del plate (entera por las ventanillas) y otra encima, tenue sobre el FG con
// el Over the FG de las 3D Guides (Compare with the 3D). Color: cian, blanco o negro.
// VFX Shooting Sup tiene la suya en cada setup (js/vfx-sup.js).
const MG_CELLS = [1, 2, 4];
const MG_COL = { cyan: '#3ad8ff', white: '#ffffff', black: '#111111' };
const mg = (() => { const s = lsGet('dl.grid', {}) || {}; return { on: !!s.on, cell: MG_CELLS.includes(s.cell) ? s.cell : 1, col: MG_COL[s.col] ? s.col : 'cyan', mix: mgMixOf(s.mix) }; })();
function mgMixOf(v) { return Number.isFinite(+v) && v !== null ? Math.min(1, Math.max(0.1, +v)) : 0.85; }
const mgSaveLs = () => lsSet('dl.grid', { on: mg.on, cell: mg.cell, col: mg.col, mix: mg.mix });
const mgCv = document.createElement('canvas'), mgCvUn = document.createElement('canvas');
mgCv.id = 'mg-cv'; mgCvUn.id = 'mg-cv-un'; mgCv.className = mgCvUn.className = 'gh-hl mg-cv'; mgCv.style.display = mgCvUn.style.display = 'none';
stage.appendChild(mgCv); stage.insertBefore(mgCvUn, plateImg);
function mgDraw() {
  const k = Math.min(1, st.view.baseW * st.view.zoom * (window.devicePixelRatio || 1) / Math.max(1, st.plate.W));
  const img = mg.on && !st.plate.empty && typeof mtabCur !== 'undefined' && (mtabCur === 'depthlab' || mtabCur === 'compare') ? guidesImage({ k, grid: mg.cell, color: MG_COL[mg.col] }) : null;
  const holes = typeof ghKeyHoles === 'function' && ghKeyHoles();
  // Mix de la caja: la opacidad de la grilla (sobre el FG, con el key, la fracción Over the FG de las 3D Guides)
  for (const [cv, op] of [[mgCv, holes ? mg.mix * gh.fg : mg.mix * 0.82], [mgCvUn, holes ? mg.mix : 0]]) {
    if (!img || op <= 0) { if (cv.style.display !== 'none') cv.style.display = 'none'; continue; }
    if (cv.width !== img.width || cv.height !== img.height) { cv.width = img.width; cv.height = img.height; }
    const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0);
    cv.style.opacity = String(op); cv.style.display = '';
  }
  const set = (id, on) => { const el = $(id); if (el.getAttribute('aria-pressed') !== String(on)) el.setAttribute('aria-pressed', String(on)); };
  set('mg-chip', mg.on); MG_CELLS.forEach(c => set('mg-' + c, mg.cell === c));
  if ($('mg-col').value !== mg.col) $('mg-col').value = mg.col;
  if (document.activeElement !== $('mg-mix') && +$('mg-mix').value !== mg.mix) $('mg-mix').value = mg.mix;
}
function mgSet(p) {
  Object.assign(mg, p); mgSaveLs(); mgDraw();
  if (mg.on && !(ENV_MODULES[env.id] && envRoot.children.length)) toast('3D Grid: pick an environment in Environment › Module (it does not need to show)', true);
}
{
  $('mg-chip').onclick = () => mgSet({ on: !mg.on });
  MG_CELLS.forEach(c => { $('mg-' + c).onclick = () => mgSet({ cell: c }); });
  $('mg-col').onchange = (e) => { if (MG_COL[e.target.value]) mgSet({ col: e.target.value }); };
  $('mg-mix').oninput = (e) => { mg.mix = mgMixOf(e.target.value); mgSaveLs(); mgDraw(); };
  $('mg-mix').ondblclick = () => { mg.mix = 0.85; mgSaveLs(); mgDraw(); };
  const f = drawOverlay; drawOverlay = function (...a) { const r = f(...a); mgDraw(); return r; };
}
// hook project: la grilla viaja con el proyecto
function mgProjectState() { return { on: mg.on, cell: mg.cell, col: mg.col, mix: mg.mix }; }
function mgApplyProject(o) { if (o && typeof o === 'object') { mg.on = !!o.on; mg.cell = MG_CELLS.includes(o.cell) ? o.cell : 1; mg.col = MG_COL[o.col] ? o.col : 'cyan'; mg.mix = mgMixOf(o.mix); mgSaveLs(); mgDraw(); } }
