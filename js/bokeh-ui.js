// bokeh-ui: lente y foco de DepthLab (src/ui/SidePanel, FocusRail, OverlayPainter) sobre la cámara
// de la app. La focal, el sensor y el plate NO se duplican: salen de st (focalUsed(), st.sw,
// st.plate.W, par()). Todos los tamaños son DIÁMETROS en px del plate; el Defocus de Nuke recibe
// el RADIO. API pública: lensState, lensCocPx, lensSet, lensChanged, evento 'lens-changed'.

// Estado del lente activo. Lo leen otros módulos (Z defocus); para cambiarlo, lensSet(patch).
// focusSrc: de dónde sale el foco (BK_SRC); el del T-stop va en cada setup (setups[i].tSrc), D-05.
const lensState = { tStop: 4.5, focusM: 2.05, fgM: 1.27, bgM: 3.30, focusSrc: '' };

// Diámetro del bokeh en px del plate para un objeto a distanceM (Infinity = infinito), con la
// cámara actual de la app. NaN si el foco no es válido (más cerca que la focal).
function lensCocPx(distanceM) { return BokehMath.cocPx(bkLens(bokehState.active), bkCam(), lensState.focusM, distanceM); }
// lo mismo con la lente de la toma (Setup A) aunque Setup B esté activo: lo que usa el driving plate
function lensCocShotPx(distanceM) { return BokehMath.cocPx(bkLens(0), bkCam(), lensState.focusM, distanceM); }
function lensChanged() { document.dispatchEvent(new Event('lens-changed')); }
// patch.tStopSrc / patch.focusSrc (BK_SRC): el valor viene de la metadata, de un reporte o es supuesto. Con
// tStopSrc el T-stop es el de la lente de la toma (Setup A), esté activo el setup que esté.
function lensSet(patch) {
  bkSet(() => {
    const { tStopSrc, ...p } = patch;
    if (tStopSrc !== undefined) {
      const a = bokehState.setups[0];
      if (Number.isFinite(p.tStop)) a.tStop = p.tStop;
      a.tSrc = tStopSrc; delete p.tStop;
      lensState.tStop = bokehState.setups[bokehState.active].tStop;
    }
    Object.assign(lensState, p);
  });
}
// de dónde sale cada valor del lente (D-05): metadata, planilla, reporte, tipeado, supuesto o el de arranque
const BK_SRC = { exr: ['from the EXR metadata', 'EXR'], camrep: ['from the camera report', 'camera report'], report: ['from the set report', 'set report'],
  typed: ['typed', 'typed'], assumed: ['assumed: the file has no T-stop', 'assumed'], '': ['default, not from the shot', 'default'] };
const bkSrcOf = (k) => BK_SRC[k] || BK_SRC[''];
// «T2.8 (assumed)»: el T-stop de un setup con su fuente, para rótulos y nodos de Nuke
function lensTStopTag(i = 0) { const s = bokehState.setups[i]; return `T${+(+s.tStop).toFixed(2)} (${bkSrcOf(i === 0 ? s.tSrc : 'typed')[1]})`; }
// el T-stop de la toma no es confiable: supuesto o el de arranque
const lensTStopShaky = () => { const k = bokehState.setups[0].tSrc || ''; return k === 'assumed' || k === ''; };
// px del plate -> lo que se muestra (plate o comp, js/delivery.js)
const bkK = () => (typeof dlK === 'function' ? dlK() : 1);
const bkUnit = () => (typeof dlUnit === 'function' ? dlUnit() : 'plate px');

// Resto del estado (Setup A/B, ejes, sondas). Las distancias van siempre en metros: la unidad
// sólo cambia cómo se muestran.
const BK_DEFAULTS = {
  setups: [{ focal: 132, tStop: 4.5, tSrc: '' }, { focal: 85, tStop: 2.8, tSrc: 'typed' }], active: 0, ghost: true,
  maxCoc: 2, axis: 2, axisMax: 11, axisNear: 0.55, gridStep: 0.8,
  showFocus: false, showRow: true, showProbes: true, showHud: true, rowOpacity: 0.4, unit: 'm', copyTarget: 'BG',
};
const bokehState = Object.assign(JSON.parse(JSON.stringify(BK_DEFAULTS)), { probes: [], nextProbe: 1, sel: 0, tool: null, copies: 0 });
const BK_MIN_M = 0.01, BK_MAX_M = 10000, BK_ROW_L = 0.025, BK_ROW_R = 0.03;
const BK_UNITS = { m: [1, 'm'], cm: [0.01, 'cm'], ft: [0.3048, 'ft'], in: [0.0254, 'in'] };

// Setup A es la cámara de la app (la focal del plate). Setup B es otra lente para comparar el bokeh:
// tiene su propia focal y nunca toca la cámara del match (decisión de Lega).
function bkLens(i) {
  const s = bokehState.setups[i];
  return { focalMm: i === 0 ? focalUsed() : s.focal, fNumber: s.tStop };
}
function bkCam() { return { sensorWidthMm: st.sw, squeeze: par(), plateWidthPx: st.plate.W }; }
const bkClampDist = m => Number.isFinite(m) ? Math.min(BK_MAX_M, Math.max(BK_MIN_M, m)) : BK_MAX_M;
const bkToDisp = m => m / BK_UNITS[bokehState.unit][0];
const bkFromDisp = v => v * BK_UNITS[bokehState.unit][0];
function bkFmt(m, dec = 2) {
  if (!Number.isFinite(m) || m >= BK_MAX_M) return '∞';
  if (bokehState.unit === 'cm') dec = Math.max(0, dec - 2);
  return `${bkToDisp(m).toFixed(dec)} ${BK_UNITS[bokehState.unit][1]}`;
}
const bkPx = d => Number.isFinite(d) ? `${Math.round(d)} px` : '-';
const bkLensText = l => `${+l.focalMm.toFixed(1)} mm · T${+l.fNumber.toFixed(2)}`;

// --- Eje de la fila de discos y del riel (BokehState::rowDistances / distanceToPlateX) ---
function bkRange() { return { minM: bokehState.axisNear, maxM: bokehState.axisMax }; }
function bkRowDistances() {
  const s = bokehState, out = [];
  if (s.axis === 0) {
    const n = Math.min(400, Math.floor(s.axisMax / s.gridStep + 1e-9));
    for (let i = 1; i <= n; i++) out.push(i * s.gridStep);
    return out;
  }
  for (const d of [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 15, 20, 30, 50, 100, 200, 500]) {
    if (d < s.axisNear * 1.05) continue;
    if (s.axis === 1 && d > s.axisMax * 1.0001) continue;
    if (s.axis === 2 && s.axisNear / d < 0.03) continue;  // en 1/d los lejanos se amontonan contra el infinito
    out.push(d);
  }
  if (s.axis === 2) out.push(Infinity);
  return out;
}
function bkDistToX(d) {
  const t = BokehMath.axisToNorm(bokehState.axis, bkRange(), d);
  return bokehState.axis === 0 ? t : BK_ROW_L + (1 - BK_ROW_L - BK_ROW_R) * t;
}
function bkXToDist(x) {
  let t = bokehState.axis === 0 ? x : (x - BK_ROW_L) / (1 - BK_ROW_L - BK_ROW_R);
  if (bokehState.axis === 2 && t >= 0.999) return BK_MAX_M;  // hasta el borde: lo más lejos que se tipea
  t = Math.min(1, Math.max(0, t));
  return bkClampDist(BokehMath.normToAxis(bokehState.axis, bkRange(), t));
}

// --- Sondas ---
const bkProbe = id => bokehState.probes.find(p => p.id === id) || null;
function bkProbeDist(p) {
  return p.measured ? BokehMath.solveDistanceM(bkLens(bokehState.active), bkCam(), lensState.focusM, p.measuredPx, p.behind) : p.distanceM;
}
const bkProbeDiam = p => p.measured ? p.measuredPx : lensCocPx(p.distanceM);
function bkAddProbe(u, v, measured, px) {
  const s = bokehState, id = s.nextProbe++;
  const p = { id, u, v, measured, distanceM: lensState.bgM, measuredPx: 0, behind: true, name: `${measured ? 'Measured' : 'Probe'} ${id}` };
  if (measured) {
    p.measuredPx = Math.max(0, px);
    // detrás del foco por defecto (lo habitual en un plate); si ahí no hay solución, delante
    p.behind = BokehMath.solveDistanceM(bkLens(s.active), bkCam(), lensState.focusM, p.measuredPx, true) !== null;
  }
  s.probes.push(p); s.sel = id;
  return p;
}

// --- Cambios, guardado y avisos ---
const BK_SAVED = ['setups', 'active', 'ghost', 'maxCoc', 'axis', 'axisMax', 'axisNear', 'gridStep', 'showFocus', 'showRow', 'showProbes', 'showHud', 'rowOpacity', 'unit', 'copyTarget'];
function bkSettings() {
  const o = { lens: { ...lensState } };
  for (const k of BK_SAVED) o[k] = bokehState[k];
  o.setups = bokehState.setups.map((s, i) => ({ focal: i === 0 ? focalUsed() : s.focal, tStop: s.tStop, tSrc: s.tSrc || '' }));
  return JSON.parse(JSON.stringify(o));
}
function bkApplySettings(o) {
  if (!o) return;
  const s = bokehState;
  for (const k of BK_SAVED) if (o[k] !== undefined) s[k] = JSON.parse(JSON.stringify(o[k]));
  if (o.lens) for (const k of ['tStop', 'focusM', 'fgM', 'bgM']) if (Number.isFinite(o.lens[k])) lensState[k] = o.lens[k];
  if (o.lens) lensState.focusSrc = typeof o.lens.focusSrc === 'string' ? o.lens.focusSrc : '';
  // proyectos de antes: sin fuente del T-stop no se sabe de dónde salió (se muestra «default»)
  if (o.setups) bokehState.setups.forEach((x, i) => { if (typeof x.tSrc !== 'string') x.tSrc = i === 0 ? '' : 'typed'; });
}
function bkClean() {
  const s = bokehState;
  s.active = s.active === 1 ? 1 : 0;
  s.setups.forEach(x => { x.tStop = Math.min(64, Math.max(0.5, +x.tStop || 2.8)); x.focal = Math.min(2000, Math.max(1, +x.focal || 50)); });
  lensState.tStop = s.setups[s.active].tStop;
  for (const k of ['focusM', 'fgM', 'bgM']) lensState[k] = bkClampDist(lensState[k]);
  s.maxCoc = Math.min(100, Math.max(0.1, s.maxCoc));
  s.axisMax = Math.min(1000, Math.max(0.5, s.axisMax));
  s.axisNear = Math.min(Math.max(0.06, s.axisMax * 0.5), Math.max(0.05, s.axisNear));
  s.gridStep = Math.min(100, Math.max(0.01, s.gridStep));
  s.rowOpacity = Math.min(1, Math.max(0, s.rowOpacity));
  if (!BK_UNITS[s.unit]) s.unit = 'm';
}
// Todo cambio pasa por acá: limpia, guarda, refresca panel, overlay y riel, y avisa.
function bkSet(fn) {
  const tBefore = lensState.tStop;
  if (fn) fn(bokehState);
  // si alguien escribió lensState.tStop directo, va al setup activo
  if (lensState.tStop !== tBefore) bokehState.setups[bokehState.active].tStop = lensState.tStop;
  bkClean();
  lsSet('bokeh', bkSettings());
  bkRefreshPanel();
  bkDrawNow();
  lensChanged();
}
function bkActivate(i) {
  if (i !== bokehState.active) bkSet(s => { s.active = i; });
}

// Plate nuevo: las sondas eran del anterior. El foco y el T-stop de la metadata los aplica exr.js
// (lensSet), igual que DepthLab con "Use on open".
function bkOnNewPlate() { bokehState.probes = []; bokehState.sel = 0; }

// --- Enganche con el overlay de la app (drawOverlay llama acá: pan/zoom, focal, plate) ---
let bkCamSig = '', bkViewSig = '', bkRaf = 0;
function bokehOnOverlay() {
  const camSig = [focalUsed(), st.sw, st.plate.W, st.plate.H, par()].join('|');
  const plateSig = st.plate.name + '|' + st.plate.W + '|' + st.plate.H + '|' + !!st.plate.empty;
  const v = st.view, viewSig = [v.x, v.y, v.zoom, v.baseW, v.baseH].join('|');
  if (plateSig !== bkOnOverlay.plate) {
    const first = bkOnOverlay.plate === undefined;
    bkOnOverlay.plate = plateSig;
    if (!first) { bkOnNewPlate(); bkCamSig = ''; }
  }
  if (camSig !== bkCamSig) { bkCamSig = camSig; bkViewSig = viewSig; bkSet(); return; }
  if (viewSig !== bkViewSig) { bkViewSig = viewSig; bkScheduleDraw(); }
}
const bkOnOverlay = {};
function bkScheduleDraw() { if (!bkRaf) bkRaf = requestAnimationFrame(() => { bkRaf = 0; bkDrawNow(); }); }
function bkDrawNow() { bkDrawLayer(); bkDrawRail(); }

// ============ Capa sobre el plate (OverlayPainter.cpp) ============
const bkSvg = $('bk-ov');
const bkMeasureCtx = document.createElement('canvas').getContext('2d');
let bkLive = null;  // interacción en curso: { kind: 'measure'|'move'|'edge', ... }
const bkCss = n => `var(--${n})`;
const bkMix = (n, pct) => `color-mix(in srgb, var(--${n}) ${pct}%, transparent)`;
function bkTextW(s, px) { bkMeasureCtx.font = `600 ${px}px ${getComputedStyle(document.documentElement).getPropertyValue('--f-ui')}`; return bkMeasureCtx.measureText(s).width; }
function bkMap() {
  const v = st.view;
  return { kx: v.baseW * v.zoom / st.plate.W, ky: v.baseH * v.zoom / st.plate.H };
}
function bkEllipse(u, v, diam, fill, stroke, sw, dash) {
  const m = bkMap(), r = Math.max(0.5, diam / 2), [x, y] = uvToVp(u, v);
  return `<ellipse cx="${x}" cy="${y}" rx="${r / par() * m.kx}" ry="${r * m.ky}" style="fill:${fill};stroke:${stroke};stroke-width:${sw}${dash ? ';stroke-dasharray:4 3' : ''}"/>`;
}
function bkHalo(x1, y1, x2, y2, color, w) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${bkMix('bg', 55)};stroke-width:${w + 2.4}"/>` +
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${color};stroke-width:${w}"/>`;
}
// Etiqueta con fondo oscuro. align -1: x es el borde izquierdo, 0 centrada, +1 borde derecho.
function bkTag(out, x, y, text, color, align = -1, scale = 0.85) {
  const fs = parseFloat(getComputedStyle(bkSvg).fontSize) * scale;
  const w = bkTextW(text, fs) + 12, h = fs + 9;
  const left = align === 0 ? x - w / 2 : align > 0 ? x - w : x;
  out.push(`<rect x="${left}" y="${y}" width="${w}" height="${h}" rx="3" style="fill:${bkMix('bg', 82)}"/>` +
    `<text x="${left + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" style="fill:${color};font-size:${fs}px">${esc(text)}</text>`);
  return { x: left, y, w, h };
}
const bkOverlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function bkDrawLayer() {
  if (!bkSvg) return;
  const s = bokehState, out = [];
  if (st.plate.empty) { bkSvg.innerHTML = ''; return; }
  bkSvg.classList.toggle('gh-quiet', typeof gh !== 'undefined' && gh.on && !s.tool && !s.showFocus); // con el fantasma prendido (js/ghost.js); el chip Focus manda
  const W = st.plate.W, H = st.plate.H;
  const [x0, y0] = uvToVp(0, 0), [x1, y1] = uvToVp(W, H);
  const lens = bkLens(s.active), focus = lensState.focusM;
  out.push(`<defs><clipPath id="bk-clip"><rect x="${x0 - 1}" y="${y0 - 1}" width="${x1 - x0 + 2}" height="${y1 - y0 + 2}"/></clipPath></defs><g clip-path="url(#bk-clip)">`);
  // con una herramienta armada, toda la imagen recibe el mouse
  if (s.tool) out.push(`<rect class="bk-catch" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>`);
  if (!BokehMath.focusIsValid(lens, focus)) {
    bkTag(out, (x0 + x1) / 2, y0 + 14, 'Focus distance is closer than the focal length', bkCss('ov-fg'), 0, 0.92);
    bkSvg.innerHTML = out.join('') + '</g>'; return;
  }
  const cy = H / 2, [, ycv] = uvToVp(0, cy), m = bkMap();
  const xFor = d => x0 + bkDistToX(d) * (x1 - x0);
  // el rail sobre el plate (FG / FOCUS / BG a toda altura, la fila de discos y sus rótulos): con el chip Focus de la
  // caja de DepthLab o con Probe / Blur armados. Las sondas se ven siempre.
  if (bkRailShown()) {
    if (s.showRow) {
      const marks = bkRowDistances(), op = s.rowOpacity;
      for (const d of marks) { const x = xFor(d); out.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" style="stroke:${bkMix('fg', 16)};stroke-width:1"/>`); }
      out.push(`<line x1="${x0}" y1="${ycv}" x2="${x1}" y2="${ycv}" style="stroke:${bkMix('fg', 43)};stroke-width:1"/>`);
      for (const d of marks) {
        const diam = lensCocPx(d); if (!Number.isFinite(diam)) continue;
        out.push(bkEllipse(bkDistToX(d) * W, cy, diam, bkMix('fg', Math.round(op * 42)), bkMix('fg', Math.round(Math.min(1, op * 1.6) * 100)), 1));
      }
    }
    const targets = [[lensState.fgM, 'ov-fg', 'FG'], [focus, 'ov-focus', 'FOCUS'], [lensState.bgM, 'ov-bg', 'BG']];
    for (const [d, c, name] of targets) {
      if (name === 'FOCUS') continue;
      const diam = lensCocPx(d);
      if (Number.isFinite(diam)) out.push(bkEllipse(bkDistToX(d) * W, cy, diam, bkMix(c, 30), bkCss(c), 1.6));
    }
    for (const [d, c, name] of targets) { const x = xFor(d); out.push(bkHalo(x, y0, x, y1, bkCss(c), name === 'FOCUS' ? 2.2 : 1.6)); }
    if (s.showHud) {
      const placed = [];
      for (const [d, c, name] of targets) {
        const x = xFor(d), text = `${name} ${bkFmt(d)}`, flip = x + 130 > x1;
        const fs = parseFloat(getComputedStyle(bkSvg).fontSize) * 0.85, w = bkTextW(text, fs) + 12;
        let y = y0 + 10;
        for (let i = 0; i < 4; i++) {
          const r = { x: flip ? x - 6 - w : x + 6, y, w, h: 20 };
          if (!placed.some(p => bkOverlaps(p, r))) break;
          y += 24;
        }
        placed.push(bkTag(out, flip ? x - 6 : x + 6, y, text, bkCss(c), flip ? 1 : -1));
      }
      for (const [d, c] of [targets[0], targets[2]]) {
        const diam = lensCocPx(d); if (!Number.isFinite(diam)) continue;
        const x = xFor(d), y = ycv + Math.max(0.5, diam / 2) * m.ky + 8, flip = x + 70 > x1;
        bkTag(out, flip ? x - 6 : x + 6, y, bkPx(diam), bkCss(c), flip ? 1 : -1);
      }
      const legend = s.axis === 0 ? `MAX ${bkFmt(s.axisMax, 1)}   STEP ${bkFmt(s.gridStep, 2)}`
        : s.axis === 1 ? `AXIS LOG   ${bkFmt(s.axisNear, 2)} to ${bkFmt(s.axisMax, 1)}` : `AXIS 1/d   ${bkFmt(s.axisNear, 2)} to ∞`;
      bkTag(out, x1 - 10, y1 - 30, legend, bkCss('fg'), 1);
    }
  }
  if (s.showProbes) for (const p of s.probes) bkDrawProbe(out, p, p.id === s.sel);
  if (bkLive && bkLive.kind === 'measure' && bkLive.r > 0) {
    const r = bkLive.r, diam = r * 2, [cx, cyy] = uvToVp(bkLive.u, bkLive.v);
    out.push(bkEllipse(bkLive.u, bkLive.v, diam, bkMix('ov-measured', 10), bkCss('ov-measured'), 1.8, true));
    const behind = BokehMath.solveDistanceM(lens, bkCam(), focus, diam, true), front = BokehMath.solveDistanceM(lens, bkCam(), focus, diam, false);
    let text = bkPx(diam);
    if (behind !== null) text += `  → ${bkFmt(behind)} behind`;
    if (front !== null) text += ` / ${bkFmt(front)} in front`;
    bkTag(out, cx + r / par() * m.kx + 8, cyy - 10, text, bkCss('ov-measured'));
  }
  bkSvg.innerHTML = out.join('') + '</g>';
  // el rótulo del horizonte (escena) se corre si alguno de estos lo pisa
  if (typeof sceneHzBox !== 'undefined' && sceneHzBox && [...bkSvg.querySelectorAll('rect[rx="3"]')].some(e => bkOverlaps(sceneHzBox, { x: +e.getAttribute('x'), y: +e.getAttribute('y'), w: +e.getAttribute('width'), h: +e.getAttribute('height') }))) { sceneDrawOverlay(); if (typeof ghDraw === 'function') ghDraw(); } // el fantasma esquiva el rótulo en su lugar nuevo
}
const BK_RAIL_SECS = ['bk-lens', 'bk-out'];
const bkRailShown = () => !!bokehState.tool || !!bokehState.showFocus;
{
  const mo = new MutationObserver(() => bkScheduleDraw());
  BK_RAIL_SECS.forEach(id => $(id) && mo.observe($(id), { attributes: true, attributeFilter: ['class'] }));
}
function bkDrawProbe(out, p, sel) {
  const dist = bkProbeDist(p), diam = bkProbeDiam(p), m = bkMap();
  const c = p.measured ? 'ov-measured' : dist !== null && dist < lensState.focusM ? 'ov-fg' : 'ov-bg';
  const [x, y] = uvToVp(p.u, p.v), r = Math.max(0.5, diam / 2), rx = r / par() * m.kx;
  const lw = sel ? 2.4 : 1.7;
  if (Number.isFinite(rx)) {
    out.push(bkEllipse(p.u, p.v, diam, 'none', bkMix('bg', 50), lw + 2));
    out.push(bkEllipse(p.u, p.v, diam, bkMix(c, p.measured ? 10 : 20), bkCss(c), lw, p.measured));
  }
  out.push(bkHalo(x - 5, y, x + 5, y, bkCss(c), 1.2), bkHalo(x, y - 5, x, y + 5, bkCss(c), 1.2));
  // manija del centro (mover) y, en una medida seleccionada, la del borde (cambia el tamaño)
  out.push(`<circle class="bk-grab" data-probe="${p.id}" data-part="move" cx="${x}" cy="${y}" r="9"/>`);
  if (sel && p.measured && Number.isFinite(rx))
    out.push(`<rect class="bk-grab bk-edge" data-probe="${p.id}" data-part="edge" x="${x + rx - 4}" y="${y - 4}" width="8" height="8" style="stroke:${bkCss(c)}"/>`);
  if (!bokehState.showHud) return;
  let l1, l2;
  if (p.measured) {
    l1 = `${p.name}  ${bkPx(diam)}`;
    l2 = dist !== null ? `→ ${bkFmt(dist)} ${p.behind ? 'behind' : 'in front of'} focus` : 'No solution behind focus';
  } else { l1 = `${p.name}  ${bkFmt(p.distanceM)}`; l2 = `${bkPx(diam)} blur`; }
  const ext = Number.isFinite(rx) ? rx : 6, [, xr] = uvToVp(st.plate.W, 0), flip = x + ext + 190 > xr;
  const tx = flip ? x - ext - 8 : x + ext + 8;
  bkTag(out, tx, y - 21, l1, bkCss(c), flip ? 1 : -1);
  bkTag(out, tx, y + 1, l2, bkCss('fg'), flip ? 1 : -1);
}

// Mouse sobre la capa: herramientas Probe / Measure blur y arrastre de sondas.
if (bkSvg) {
  bkSvg.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.altKey || spaceDown) return;  // pan y navegación siguen al visor
    const grab = e.target.closest('.bk-grab'), catchAll = e.target.classList.contains('bk-catch');
    if (!grab && !catchAll) return;
    e.stopPropagation(); e.preventDefault();
    const [x, y] = evVp(e), [u, v] = vpToUv(x, y);
    if (grab) {
      const p = bkProbe(+grab.dataset.probe);
      bokehState.sel = p.id;
      bkLive = grab.dataset.part === 'edge' ? { kind: 'edge', id: p.id } : { kind: 'move', id: p.id, du: p.u - u, dv: p.v - v };
    } else if (bokehState.tool === 'probe') {
      bkAddProbe(u, v, false); bkLive = null;
    } else bkLive = { kind: 'measure', u, v, r: 0 };
    bkSvg.setPointerCapture(e.pointerId);
    bkSet();
  });
  bkSvg.addEventListener('pointermove', e => {
    if (!bkLive) return;
    const [x, y] = evVp(e), [u, v] = vpToUv(x, y), m = bkMap();
    if (bkLive.kind === 'measure') {
      const [cx, cy] = uvToVp(bkLive.u, bkLive.v);
      bkLive.r = Math.hypot(x - cx, y - cy) / m.ky;  // radio en px del plate (el vertical no lleva squeeze)
      bkDrawLayer(); return;
    }
    const p = bkProbe(bkLive.id); if (!p) return;
    if (bkLive.kind === 'move') { p.u = u + bkLive.du; p.v = v + bkLive.dv; }
    else { const [cx] = uvToVp(p.u, p.v); p.measuredPx = Math.max(0, 2 * Math.abs(x - cx) / m.kx * par()); }
    bkSet();
  });
  const end = () => {
    if (!bkLive) return;
    const l = bkLive; bkLive = null;
    if (l.kind === 'measure' && l.r * 2 >= 2) bkAddProbe(l.u, l.v, true, l.r * 2);
    bkSet();
  };
  bkSvg.addEventListener('pointerup', end); bkSvg.addEventListener('pointercancel', end);
}
window.addEventListener('keydown', e => {
  if (e.target.matches('textarea, select, input:not([type=checkbox]):not([type=range])')) return;
  if (e.key === 'Escape' && bokehState.tool) bkSet(s => { s.tool = null; });
  else if ((e.key === 'Delete' || e.key === 'Backspace') && bokehState.sel && st.sel < 0)
    bkSet(s => { s.probes = s.probes.filter(p => p.id !== s.sel); s.sel = 0; });
});

// ============ Riel de foco (FocusRail.cpp) ============
const bkRail = document.createElement('div');
bkRail.className = 'bk-rail'; bkRail.dataset.tour = 'focus-rail';
bkRail.innerHTML = `<div class="bk-rail-h"><button class="bk-rail-t" id="bk-rail-t" aria-expanded="true" aria-controls="bk-rail-cv" title="Fold or unfold the focus rail">Focus rail</button>
  <span class="seg" role="group" aria-label="Distance axis" data-tour="rail.axis">
    <button data-axis="0" title="Linear distance axis, like the Nuke gizmo (0 to max)">Linear</button><button data-axis="1" title="Logarithmic distance axis">Log</button><button data-axis="2" title="1/d axis: bokeh grows in a straight line away from focus, infinity fits on screen">1/d</button>
  </span><span class="bk-rail-hint">Drag FG, Focus and BG</span><span class="bk-rail-leg" id="bk-leg"></span></div>
  <canvas id="bk-rail-cv" data-tour="rail.handles"></canvas>`;
document.querySelector('.viewer').insertBefore(bkRail, $('tlbar'));
const bkRailCv = $('bk-rail-cv');
// plegable y recordado: en ventanas bajas deja el alto al visor
function bkRailCollapse(on) {
  bkRail.classList.toggle('collapsed', on); $('bk-rail-t').setAttribute('aria-expanded', String(!on)); lsSet('bokeh.railCollapsed', on);
  if (!on) bkScheduleDraw();
}
$('bk-rail-t').onclick = () => bkRailCollapse(!bkRail.classList.contains('collapsed'));
if (lsGet('bokeh.railCollapsed', false)) bkRailCollapse(true);
let bkRailDrag = null, bkRailHover = null;
bkRail.querySelectorAll('[data-axis]').forEach(b => b.onclick = () => bkSet(s => { s.axis = +b.dataset.axis; }));
// Tramo horizontal del riel que corresponde al plate: alineado con la fila de discos mientras el
// plate entero está en pantalla; con zoom o pan que lo sacan, el riel usa su propio ancho.
function bkRailSpan() {
  const w = bkRailCv.clientWidth;
  if (!st.plate.empty) {
    const off = vp.getBoundingClientRect().left - bkRailCv.getBoundingClientRect().left;
    const [xa] = uvToVp(0, 0), [xb] = uvToVp(st.plate.W, 0);
    const l = off + xa, r = off + xb;
    if (l >= -2 && r <= w + 2) return [l, r];
  }
  return [16, w - 16];
}
function bokehRailXForDistance(d) { const [l, r] = bkRailSpan(); return l + bkDistToX(d) * (r - l); }
function bkRailDistForX(x) { const [l, r] = bkRailSpan(); return r - l < 1 ? lensState.focusM : bkXToDist((x - l) / (r - l)); }
function bkNiceCeil(v) {
  if (!(v > 0)) return 10;
  const b = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * b >= v) return k * b;
  return 10 * b;
}
function bkRailMarkerAt(x) {
  let best = null, bd = 7;
  for (const [k, d] of [['focus', lensState.focusM], ['fg', lensState.fgM], ['bg', lensState.bgM]]) {
    const dd = Math.abs(bokehRailXForDistance(d) - x); if (dd <= bd) { best = k; bd = dd; }
  }
  return best;
}
function bkDrawRail() {
  const s = bokehState, cv = bkRailCv, dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, Hc = cv.clientHeight;
  const a = s.active === 0 ? 'A' : 'B', b = s.active === 0 ? 'B' : 'A';
  $('bk-leg').innerHTML = `<span>— ${a} ${esc(bkLensText(bkLens(s.active)))}</span>` + (s.ghost ? `<span class="bk-ghost">- - ${b} compare ${esc(bkLensText(bkLens(1 - s.active)))}</span>` : '');
  bkRail.querySelectorAll('[data-axis]').forEach(bt => bt.setAttribute('aria-pressed', String(+bt.dataset.axis === s.axis)));
  if (!W || !Hc) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hc * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hc * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hc);
  const css = getComputedStyle(document.documentElement), C = n => css.getPropertyValue('--' + n).trim();
  const fs = parseFloat(getComputedStyle(bkRail).fontSize), font = w => `${w} ${(fs * 0.77).toFixed(1)}px ${C('f-ui')}`;
  if (Hc < fs * 3.5) return; // aplastado por el visor (ventana baja): sin lugar para la curva
  const top = 6, base = Hc - Math.round(fs * 1.85), ph = base - top;
  const [left, right] = bkRailSpan();
  const lens = bkLens(s.active), cam = bkCam(), focus = lensState.focusM;
  if (!BokehMath.focusIsValid(lens, focus)) {
    g.fillStyle = C('ov-fg'); g.font = font(500); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Focus distance is closer than the focal length', W / 2, Hc / 2); return;
  }
  const ref = Math.max(lensCocPx(lensState.fgM), lensCocPx(lensState.bgM), lensCocPx(Infinity), s.maxCoc * 4, 10);
  const ymax = bkNiceCeil(ref * 1.25), yFor = px => base - Math.min(px, ymax * 1.08) / ymax * ph;
  // grilla horizontal en px
  g.font = font(500); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const step = bkNiceCeil(ymax / 3);
  for (let v = step; v <= ymax + 1e-9; v += step) {
    const y = yFor(v);
    g.strokeStyle = C('line'); g.lineWidth = 1; g.beginPath(); g.moveTo(left, y); g.lineTo(right, y); g.stroke();
    if (y - 3 - fs * 0.77 >= 0) g.fillStyle = C('muted'), g.fillText(`${+v.toPrecision(4)} px`, left + 4, y - 3);
  }
  // zona nítida
  const lim = BokehMath.dofLimits(lens, cam, focus, s.maxCoc);
  const sl = bokehRailXForDistance(lim.nearM), sr = bokehRailXForDistance(Number.isFinite(lim.farM) ? lim.farM : 1e9);
  g.fillStyle = C('ov-focus'); g.globalAlpha = 0.16; g.fillRect(sl, top, Math.max(2, sr - sl), ph); g.globalAlpha = 1;
  const curve = l => {
    const pts = [], n = Math.min(2000, Math.max(80, Math.round(right - left)));
    for (let i = 0; i <= n; i++) {
      const x = left + (right - left) * i / n, v = BokehMath.cocPx(l, cam, focus, bkRailDistForX(x));
      if (Number.isFinite(v)) pts.push([x, yFor(v)]);
    }
    return pts;
  };
  const path = pts => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); };
  g.save(); g.beginPath(); g.rect(0, top - 4, W, ph + 4); g.clip();
  const ca = curve(lens);
  if (ca.length) { path(ca); g.lineTo(right, base); g.lineTo(left, base); g.closePath(); g.fillStyle = C('fg'); g.globalAlpha = 0.05; g.fill(); g.globalAlpha = 1; }
  const gl = bkLens(1 - s.active);
  if (s.ghost && BokehMath.focusIsValid(gl, focus)) { path(curve(gl)); g.setLineDash([4, 3]); g.strokeStyle = C('ov-ghost'); g.lineWidth = 1.6; g.stroke(); g.setLineDash([]); }
  path(ca); g.strokeStyle = C('fg'); g.lineWidth = 1.6; g.stroke();
  g.restore();
  // eje de distancias
  g.strokeStyle = C('line'); g.lineWidth = 1; g.beginPath(); g.moveTo(left, base); g.lineTo(right, base); g.stroke();
  let ticks = [];
  if (s.axis === 0) { const st0 = bkNiceCeil(s.axisMax / 8); for (let d = st0; d <= s.axisMax + 1e-9; d += st0) ticks.push(d); }
  else { ticks = [0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 20, 50, 100]; if (s.axis === 2) ticks.push(Infinity); }
  g.textAlign = 'center'; g.textBaseline = 'top';
  let lastX = 1e9;
  for (const d of ticks.reverse()) {  // de derecha a izquierda: el último (∞) siempre lleva rótulo
    const x = bokehRailXForDistance(d);
    if (!Number.isFinite(x) || x < left - 1 || x > right + 1) continue;
    g.strokeStyle = C('muted'); g.beginPath(); g.moveTo(x, base); g.lineTo(x, base + 4); g.stroke();
    if (lastX - x < 40) continue;
    lastX = x;
    g.fillStyle = C('muted'); g.fillText(Number.isFinite(d) ? bkFmt(d, d < 1 ? 2 : d < 10 ? 1 : 0) : '∞', x, base + 6);
  }
  // sondas: punto sobre la curva (las medidas, en su px medido)
  for (const p of s.probes) {
    const d = bkProbeDist(p); if (d === null) continue;
    g.fillStyle = C(p.measured ? 'ov-measured' : d < focus ? 'ov-fg' : 'ov-bg');
    g.beginPath(); g.arc(bokehRailXForDistance(d), yFor(bkProbeDiam(p)), 3.2, 0, 7); g.fill();
  }
  const tag = (x, y, text, color) => {
    g.font = font(600); const w = g.measureText(text).width + 10, h = fs * 1.3;
    g.fillStyle = C('bg'); g.globalAlpha = 0.85; g.beginPath(); g.roundRect(x, y, w, h, 3); g.fill(); g.globalAlpha = 1;
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x + w / 2, y + h / 2);
  };
  for (const [k, d, c] of [['fg', lensState.fgM, 'ov-fg'], ['focus', focus, 'ov-focus'], ['bg', lensState.bgM, 'ov-bg']]) {
    const x = bokehRailXForDistance(d), hot = k === bkRailHover || k === bkRailDrag, w = k === 'focus' ? 2 : 1.5;
    g.strokeStyle = C('bg'); g.globalAlpha = 0.55; g.lineWidth = w + 2.2; g.beginPath(); g.moveTo(x, top); g.lineTo(x, base); g.stroke(); g.globalAlpha = 1;
    g.strokeStyle = C(c); g.lineWidth = w + (hot ? 0.8 : 0); g.beginPath(); g.moveTo(x, top); g.lineTo(x, base); g.stroke();
    const sz = hot ? 7.5 : 6;
    g.fillStyle = C(c); g.beginPath(); g.moveTo(x, base - 1); g.lineTo(x - sz, base + sz + 2); g.lineTo(x + sz, base + sz + 2); g.closePath(); g.fill();
    if (k !== 'focus') {
      const v = lensCocPx(d), y = yFor(v);
      g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
      tag(x + 7, Math.max(top, y - fs * 1.55), bkPx(v), C(c));
    }
  }
  const fx = bokehRailXForDistance(focus);
  tag(fx + 7, top + 1, `sharp ${bkFmt(lim.nearM)} to ${Number.isFinite(lim.farM) ? bkFmt(lim.farM) : '∞'}`, C('ov-focus'));
  const act = bkRailDrag || bkRailHover;
  if (act) { const d = { focus, fg: lensState.fgM, bg: lensState.bgM }[act]; tag(bokehRailXForDistance(d) + 7, base - fs * 1.55, bkFmt(d), C('fg')); }
}
bkRailCv.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const x = e.offsetX, k = bkRailMarkerAt(x);
  if (!k) return;
  bkRailDrag = k; bkRailCv.setPointerCapture(e.pointerId); e.preventDefault(); bkDrawRail();
});
bkRailCv.addEventListener('pointermove', e => {
  const x = e.offsetX;
  if (bkRailDrag) {
    const d = bkRailDistForX(x), key = { focus: 'focusM', fg: 'fgM', bg: 'bgM' }[bkRailDrag];
    bkSet(() => { lensState[key] = d; if (key === 'focusM') lensState.focusSrc = 'typed'; }); return;
  }
  const h = bkRailMarkerAt(x);
  if (h !== bkRailHover) { bkRailHover = h; bkRailCv.style.cursor = h ? 'ew-resize' : ''; bkDrawRail(); }
});
const bkRailEnd = () => { if (bkRailDrag) { bkRailDrag = null; bkDrawRail(); } };
bkRailCv.addEventListener('pointerup', bkRailEnd); bkRailCv.addEventListener('pointercancel', bkRailEnd);
bkRailCv.addEventListener('pointerleave', () => { if (bkRailHover && !bkRailDrag) { bkRailHover = null; bkRailCv.style.cursor = ''; bkDrawRail(); } });
new ResizeObserver(() => bkScheduleDraw()).observe(bkRail);

// ============ Panel (SidePanel.cpp) ============
const bkNum = (id, get, set) => {
  const el = $(id);
  el.addEventListener('change', () => { const v = parseFloat(el.value); if (Number.isFinite(v)) bkSet(() => set(v)); });
  return { el, get };
};
const bkFields = [
  bkNum('bk-tstop', () => lensState.tStop, v => { lensState.tStop = v; bokehState.setups[bokehState.active].tSrc = 'typed'; }),
  bkNum('bk-bfocal', () => bokehState.setups[1].focal, v => { bokehState.setups[1].focal = v; }),
  bkNum('bk-focus', () => bkToDisp(lensState.focusM), v => { lensState.focusM = bkFromDisp(v); lensState.focusSrc = 'typed'; }),
  bkNum('bk-fg', () => bkToDisp(lensState.fgM), v => { lensState.fgM = bkFromDisp(v); }),
  bkNum('bk-bg', () => bkToDisp(lensState.bgM), v => { lensState.bgM = bkFromDisp(v); }),
  bkNum('bk-maxcoc', () => bokehState.maxCoc, v => { bokehState.maxCoc = v; }),
  bkNum('bk-axmax', () => bkToDisp(bokehState.axisMax), v => { bokehState.axisMax = bkFromDisp(v); }),
  bkNum('bk-step', () => bkToDisp(bokehState.gridStep), v => { bokehState.gridStep = bkFromDisp(v); }),
  bkNum('bk-near', () => bkToDisp(bokehState.axisNear), v => { bokehState.axisNear = bkFromDisp(v); }),
  bkNum('bk-opac', () => bokehState.rowOpacity * 100, v => { bokehState.rowOpacity = v / 100; }),
];
const bkDistIds = ['bk-focus', 'bk-fg', 'bk-bg', 'bk-axmax', 'bk-step', 'bk-near'];
const bkBusy = el => document.activeElement === el || (el.parentNode && el.parentNode.classList.contains('scrubbing'));
[0, 1].forEach(i => {
  $('bk-setup-' + i).addEventListener('click', () => bkActivate(i));
});
document.querySelectorAll('.bk-eye').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); bkSet(s => { s.ghost = !s.ghost; }); }));
$('bk-units').querySelectorAll('button').forEach(b => b.onclick = () => bkSet(s => { s.unit = b.dataset.u; }));
[['bk-show-row', 'showRow'], ['bk-show-probes', 'showProbes'], ['bk-show-hud', 'showHud']].forEach(([id, k]) => { $(id).onchange = () => bkSet(s => { s[k] = $(id).checked; }); });
['probe', 'blur'].forEach(t => { $('bk-t-' + t).onclick = () => bkSet(s => { s.tool = s.tool === t ? null : t; }); });
$('bk-copy').onclick = () => bokehCopyDefocus();
$('bk-copy-t').onchange = () => bkSet(s => { s.copyTarget = $('bk-copy-t').value; });

let bkListSig = '';
function bkRefreshPanel() {
  const s = bokehState, lens = bkLens(s.active), cam = bkCam(), focus = lensState.focusM;
  [0, 1].forEach(i => {
    const card = $('bk-setup-' + i);
    card.setAttribute('aria-pressed', String(i === s.active));
    card.querySelector('small').textContent = `Setup ${'AB'[i]}${i === s.active ? '' : ' · compare'}`;
    card.querySelector('b').textContent = bkLensText(bkLens(i));
    card.parentNode.querySelector('.bk-eye').hidden = i === s.active;
    card.parentNode.querySelector('.bk-eye').setAttribute('aria-pressed', String(s.ghost));
  });
  $('bk-lens-st').textContent = `Setup ${'AB'[s.active]}`;
  $('bk-focal').textContent = `${fmt(focalUsed(), 1)} mm · ${fmt(st.sw, 2)} mm · ${st.plate.W} px`;
  $('bk-bfocal-row').hidden = s.active !== 1;
  const unit = BK_UNITS[s.unit][1], cm = s.unit === 'cm';
  $('bk-units').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.u === s.unit)));
  for (const id of bkDistIds) {
    const el = $(id), u = el.parentNode.querySelector('.u');
    if (u) u.textContent = unit;
    el.step = cm ? 1 : 0.01;
  }
  for (const f of bkFields) if (!bkBusy(f.el)) f.el.value = f.get().toFixed({ 'bk-opac': 0, 'bk-tstop': 1, 'bk-maxcoc': 1, 'bk-bfocal': 1 }[f.el.id] ?? (cm ? 0 : 2));
  if (BokehMath.focusIsValid(lens, focus)) {
    const lim = BokehMath.dofLimits(lens, cam, focus, s.maxCoc);
    $('bk-sharp').textContent = `${bkFmt(lim.nearM)} to ${Number.isFinite(lim.farM) ? bkFmt(lim.farM) : '∞'}`;
    $('bk-hyper').textContent = bkFmt(BokehMath.hyperfocalM(lens, cam, s.maxCoc), 1);
  } else { $('bk-sharp').textContent = 'focus closer than focal length'; $('bk-hyper').textContent = '-'; }
  const K = bkK();
  [['fg', lensCocPx(lensState.fgM)], ['bg', lensCocPx(lensState.bgM)], ['inf', lensCocPx(Infinity)]].forEach(([k, v]) => {
    const ok = Number.isFinite(v);
    $('bk-r-' + k).innerHTML = ok ? `${Math.round(v * K)}<small> px</small>` : '-';
    $('bk-rr-' + k).textContent = ok ? `radius ${(v * K / 2).toFixed(1)}` : '';
  });
  // de qué px son los números y de qué T-stop salen (D-05)
  $('bk-out-st').textContent = `diameter · ${bkUnit()}`;
  const tA = bokehState.setups[0], shaky = s.active === 0 && lensTStopShaky();
  $('bk-out-t').textContent = s.active === 0 ? `With ${lensTStopTag(0)}, focus ${bkFmt(focus)} (${bkSrcOf(lensState.focusSrc)[1]}).` : `With Setup B (comparison lens), ${bkLensText(lens)}.`;
  $('bk-out-t').className = 'note' + (shaky ? ' warn' : '');
  const ts = s.active === 0 ? bkSrcOf(tA.tSrc)[0] : 'of Setup B, a lens to compare with';
  $('bk-tsrc').textContent = `T-stop ${ts}${s.active === 0 && tA.tSrc === 'assumed' ? ': type the real one (camera report) if you have it' : ''}. Focus ${bkSrcOf(lensState.focusSrc)[0]}.`;
  $('bk-tsrc').className = 'note' + (shaky ? ' warn' : '');
  $('bk-copy-t').value = s.copyTarget;
  $('bk-show-row').checked = s.showRow; $('bk-show-probes').checked = s.showProbes; $('bk-show-hud').checked = s.showHud;
  ['probe', 'blur'].forEach(t => $('bk-t-' + t).setAttribute('aria-pressed', String(s.tool === t)));
  bkSvg.classList.toggle('armed', !!s.tool);
  $('bk-probes-st').textContent = s.probes.length ? String(s.probes.length) : '';
  $('bk-probe-hint').hidden = s.probes.length > 0 && !s.tool;
  $('bk-probe-hint').textContent = s.tool === 'probe' ? 'Click the plate to drop a disc at a distance. Esc or Probe again to stop.'
    : s.tool === 'blur' ? 'Drag from the center of an out-of-focus highlight to its edge to solve its distance. Esc to stop.'
    : 'Probe: click the plate to drop a disc at a distance. Measure blur: drag from the center of an out-of-focus highlight to its edge to solve its distance.';
  bkRefreshProbes();
}
function bkRefreshProbes() {
  const s = bokehState, list = $('bk-probe-list');
  const sig = s.probes.map(p => p.id + (p.measured ? 'm' : 'f')).join(',') + '|' + s.sel + '|' + s.unit;
  if (sig !== bkListSig && !list.contains(document.activeElement)) {
    bkListSig = sig;
    list.innerHTML = s.probes.map(p => `<li class="bk-probe${p.id === s.sel ? ' sel' : ''}" data-id="${p.id}">
      <div class="bk-pline"><i class="bk-ring${p.measured ? ' m' : ''}"></i><input type="text" class="bk-pname" value="${esc(p.name).replace(/"/g, '&quot;')}" aria-label="Probe name" title="Probe name (used in the Nuke node name)">
      <input type="number" class="bk-pdist" step="${s.unit === 'cm' ? 1 : 0.01}" min="0" data-unit="${BK_UNITS[s.unit][1]}" aria-label="Probe distance"${p.measured ? ' disabled title="Solved from the measured blur"' : ' title="Distance from camera. Drag or click to type."'}>
      <span class="bk-ppx"></span><button class="x" aria-label="Delete probe" title="Delete probe (Delete)">×</button></div>
      ${p.id === s.sel ? `<div class="bk-pdet"><p class="note bk-ptext"></p><div class="row">${p.measured ? '<span class="seg"><button data-side="1">Behind</button><button data-side="0">In front</button></span>' : ''}<span class="bk-sp"></span><button class="btn sm" data-as="fg">Set as FG</button><button class="btn sm" data-as="bg">Set as BG</button></div></div>` : ''}</li>`).join('');
    enhanceNumbers(list);
  }
  for (const li of list.querySelectorAll('.bk-probe')) {
    const p = bkProbe(+li.dataset.id); if (!p) continue;
    const d = bkProbeDist(p), diam = bkProbeDiam(p);
    li.querySelector('.bk-ring').style.setProperty('--c', bkCss(p.measured ? 'ov-measured' : d !== null && d < lensState.focusM ? 'ov-fg' : 'ov-bg'));
    const dist = li.querySelector('.bk-pdist');
    if (!bkBusy(dist)) dist.value = d === null ? '' : bkToDisp(d).toFixed(s.unit === 'cm' ? 0 : 2);
    if (d === null) dist.placeholder = '-';
    const name = li.querySelector('.bk-pname'); if (!bkBusy(name)) name.value = p.name;
    li.querySelector('.bk-ppx').textContent = bkPx(diam);
    const t = li.querySelector('.bk-ptext');
    if (t) {
      if (p.measured) {
        const lens = bkLens(s.active), b = BokehMath.solveDistanceM(lens, bkCam(), lensState.focusM, p.measuredPx, true), f = BokehMath.solveDistanceM(lens, bkCam(), lensState.focusM, p.measuredPx, false);
        t.innerHTML = `Measured ${Math.round(p.measuredPx)} px. Behind focus <b>${b !== null ? bkFmt(b) : 'no solution'}</b>, in front <b>${f !== null ? bkFmt(f) : '-'}</b>.`;
        const bb = li.querySelector('[data-side="1"]'), fb = li.querySelector('[data-side="0"]');
        bb.setAttribute('aria-pressed', String(p.behind)); fb.setAttribute('aria-pressed', String(!p.behind)); bb.disabled = b === null;
      } else t.textContent = 'Drag the probe on the plate to compare its disc with the image.';
    }
  }
}
// eventos de la lista (delegados: la lista se rearma)
$('bk-probe-list').addEventListener('click', e => {
  const li = e.target.closest('.bk-probe'); if (!li) return;
  const id = +li.dataset.id, p = bkProbe(id);
  if (e.target.closest('.x')) { bkSet(s => { s.probes = s.probes.filter(q => q.id !== id); if (s.sel === id) s.sel = 0; }); return; }
  const side = e.target.closest('[data-side]');
  if (side) { bkSet(() => { p.behind = side.dataset.side === '1'; }); return; }
  const as = e.target.closest('[data-as]');
  if (as) { const d = bkProbeDist(p); if (d !== null) bkSet(() => { lensState[as.dataset.as === 'fg' ? 'fgM' : 'bgM'] = d; }); return; }
  if (bokehState.sel !== id && !e.target.matches('input')) bkSet(s => { s.sel = id; });
});
$('bk-probe-list').addEventListener('focusin', e => { const li = e.target.closest('.bk-probe'); if (li && bokehState.sel !== +li.dataset.id) { bokehState.sel = +li.dataset.id; bkDrawLayer(); } });
$('bk-probe-list').addEventListener('change', e => {
  const li = e.target.closest('.bk-probe'), p = li && bkProbe(+li.dataset.id); if (!p) return;
  if (e.target.matches('.bk-pname')) { const n = e.target.value.trim(); if (n) bkSet(() => { p.name = n; }); }
  else if (e.target.matches('.bk-pdist') && !p.measured) { const v = parseFloat(e.target.value); if (Number.isFinite(v)) bkSet(() => { p.distanceM = bkClampDist(bkFromDisp(v)); }); }
});
$('bk-probe-list').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.bk-pname')) e.target.blur(); e.stopPropagation(); });

// --- Copy Defocus (SidePanel::copyDefocus): nodo Defocus de Nuke con el RADIO ---
let bokehLastCopy = '';
function bokehCopyDefocus(requested) {
  const s = bokehState, target = requested || s.copyTarget, lens = bkLens(s.active), focus = lensState.focusM;
  let diam = NaN, name = target, what;
  if (target === 'FG') { diam = lensCocPx(lensState.fgM); what = `FG ${bkFmt(lensState.fgM)}`; }
  else if (target === 'BG') { diam = lensCocPx(lensState.bgM); what = `BG ${bkFmt(lensState.bgM)}`; }
  else if (target === 'Infinity') { diam = lensCocPx(Infinity); what = 'Infinity'; }
  else {
    const p = bkProbe(s.sel);
    if (!p) { toast('Select a probe first', true); return ''; }
    const d = bkProbeDist(p);
    diam = bkProbeDiam(p); name = p.name; what = `${p.name} ${d !== null ? bkFmt(d) : '-'}`;
  }
  if (!Number.isFinite(diam)) { toast('Nothing to copy: the focus is closer than the focal length', true); return ''; }
  const r = bokehDefocusText(diam, name, what, s.active);
  bokehLastCopy = r.text; s.copies++;
  const done = ok => { $('bk-copy-msg').textContent = ok ? r.msg : 'The browser blocked the clipboard: copy it from the box below.'; $('bk-copy-out').hidden = ok; $('bk-copy-out').value = r.text; if (ok) toast(r.msg); };
  try { navigator.clipboard.writeText(r.text).then(() => done(true), () => done(false)); } catch (e) { done(false); }
  return r.text;
}
// Nodo Defocus de Nuke para un diámetro en px del plate: el RADIO en la unidad elegida (plate o comp), y en el
// label de dónde sale (lente, T-stop con su fuente, foco, unidad). setup: 0 = la lente de la toma.
function bokehDefocusText(diamPlate, name, what, setup = 0) {
  const lens = bkLens(setup), K = bkK(), radius = diamPlate * K / 2, unit = bkUnit();
  const t = setup === 0 ? lensTStopTag(0) : `T${+lens.fNumber.toFixed(2)} (Setup B)`;
  const text = BokehMath.defocusNodeText(radius, name, `${what}\n${+lens.focalMm.toFixed(1)} mm ${t}, focus ${bkFmt(lensState.focusM)}\nradius in ${unit}`);
  const warn = setup === 0 && lensTStopShaky() ? ` T-stop ${bkSrcOf(bokehState.setups[0].tSrc)[1]}.` : '';
  return { text, radius, msg: `Copied Defocus ${BokehMath.nukeSafeName(name)}: radius ${radius.toFixed(1)} ${unit}.${warn} Paste it in Nuke.` };
}

// --- Proyecto y Reset all (enganches en js/project.js y js/panel.js) ---
function bokehProjectState() {
  const o = bkSettings();
  o.probes = bokehState.probes.map(p => ({ ...p }));
  return o;
}
function bokehApplyProject(o) {
  if (!o) return;
  bkSet(s => {
    bkApplySettings(o);
    s.probes = (o.probes || []).map(p => ({ ...p }));
    s.nextProbe = s.probes.reduce((m, p) => Math.max(m, p.id + 1), 1); s.sel = 0;
    // la focal del activo es la de la cámara del proyecto, que ya se aplicó
  });
}
function bokehReset() {
  bkSet(s => {
    bkApplySettings(JSON.parse(JSON.stringify(BK_DEFAULTS)));
    Object.assign(lensState, { tStop: 4.5, focusM: 2.05, fgM: 1.27, bgM: 3.30, focusSrc: '' });
    s.probes = []; s.sel = 0; s.tool = null;
  });
}

// Arranque: lo último que usó el usuario.
bkApplySettings(lsGet('bokeh', null));
bkClean();
