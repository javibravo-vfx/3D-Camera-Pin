// slate: herramienta Slate solve en el visor (tecla C). Se arrastra una línea de punta a punta de un objeto
// de tamaño conocido parado en el plano de foco (la claqueta, o una persona en un plano general), se tipea
// su tamaño real y el cartel muestra la focal que da la cuenta (SlateMath, js/slate-math.js): lente delgada
// y pinhole, comparadas con la focal de la cámara, la del EXR y la del set report. Use this focal la pone
// en la cámara por el mismo campo que se tipea a mano (#tb-focal).
// Sirve cuando el lente no está en la metadata o la planilla puede tener un error: es un chequeo, la
// medida no se guarda en el proyecto. Los puntos van en px del plate (y hacia abajo), como los pins.
// El foco sale de Lens & focus; con Type se tipea en el cartel (un dato de survey o de la planilla, cuando el EXR
// no lo trae): ése sólo lo usa Slate solve, Lens & focus queda como estaba.
const slate = { a: null, b: null, drag: null, est: null, focusTyped: false };
const SLATE_PERSON_M = 1.75;

function slateOn() { return st.mode === 'slate'; }
function slateClear() { slate.a = slate.b = null; slate.drag = null; slate.est = null; drawOverlay(); }
function slateRealM() { const v = parseFloat($('spop-real').value); return v > 0 ? v : null; }
function slateFocusM() {
  if (slate.focusTyped) { const v = parseFloat($('spop-fin').value); return v > 0 ? v : null; }
  return lensState.focusM > 0 ? lensState.focusM : null;
}

// tomar una punta (a 10 px) o empezar una línea nueva
function slateOnDown(e, x, y) {
  if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey) return false;
  const near = (p) => { if (!p) return false; const q = uvToVp(p[0], p[1]); return Math.hypot(q[0] - x, q[1] - y) < 10; };
  const uv = vpToUv(x, y);
  if (near(slate.b)) slate.drag = 'b';
  else if (near(slate.a)) slate.drag = 'a';
  else { slate.a = uv; slate.b = uv.slice(); slate.drag = 'b'; }
  drawOverlay();
  return true;
}
function slateOnMove(x, y) {
  if (!slate.drag) return false;
  slate[slate.drag] = vpToUv(x, y);
  drawOverlay();
  return true;
}
function slateOnUp() {
  if (!slate.drag) return false;
  slate.drag = null;
  // un click sin arrastrar no es una medida
  const [ax, ay] = uvToVp(...slate.a), [bx, by] = uvToVp(...slate.b);
  if (Math.hypot(bx - ax, by - ay) < 4) { slateClear(); return true; }
  drawOverlay();
  if (!slateRealM()) setTimeout(() => $('spop-real').focus(), 0);
  return true;
}

// la cuenta con lo que hay ahora: largo, sensor, foco y tamaño real
function slateCompute() {
  if (!slate.a || !slate.b) return null;
  const px = SlateMath.segmentPx(slate.b[0] - slate.a[0], slate.b[1] - slate.a[1], par());
  const focusM = slateFocusM(), realSizeM = slateRealM();
  const r = SlateMath.solve({ objectPx: px, realSizeM, focusM, sensorMm: st.sw, platePx: st.plate.W });
  return { px, focusM, realSizeM, r };
}

// diferencia de una focal de referencia contra la estimada: «32.00 mm · −8.6 %»
function slateDiff(ref, est) {
  const p = (ref / est - 1) * 100, s = p > 0.05 ? '+' : p < -0.05 ? '−' : '±';
  const cls = Math.abs(p) < 2 ? 'ok' : Math.abs(p) < 5 ? 'warn' : 'bad';
  return `<b>${fmt(ref, 2)} mm</b> <span class="${cls}">${s}${fmt(Math.abs(p), 1)} %</span>`;
}

function slateDrawOverlay() {
  const svg = $('slate-ov'), pop = $('spop');
  if (!svg || !pop) return;
  const show = slateOn() && slate.a && slate.b && !st.plate.empty;
  if (!show) { svg.innerHTML = ''; pop.hidden = true; slate.est = null; return; }
  const [ax, ay] = uvToVp(...slate.a), [bx, by] = uvToVp(...slate.b);
  const c = slateCompute(), mono = 'font-family="SF Mono, Menlo, Consolas, monospace"';
  let h = `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#0f1216" stroke-width="4"/>`
    + `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#ffb238" stroke-width="2"/>`;
  // puntas en T, perpendiculares a la línea, para apoyarlas justo en el borde del objeto
  const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L * 7, ny = (bx - ax) / L * 7;
  for (const [x, y] of [[ax, ay], [bx, by]]) {
    h += `<line x1="${x - nx}" y1="${y - ny}" x2="${x + nx}" y2="${y + ny}" stroke="#ffb238" stroke-width="2"/>`
      + `<circle cx="${x}" cy="${y}" r="3.5" fill="#ffb238" stroke="#1d1d1d" stroke-width="1.5"/>`;
  }
  if (slate.drag) h += `<text x="${(ax + bx) / 2 + 10}" y="${(ay + by) / 2 - 10}" fill="#ffb238" stroke="#1d1d1d" stroke-width="3" paint-order="stroke" ${mono} font-size="12">${fmt(c.px, 1)} px</text>`;
  svg.innerHTML = h;

  // el cartel
  pop.hidden = !!slate.drag;
  $('spop-px').textContent = `${fmt(c.px, 1)} px`;
  const src = bkSrcOf(lensState.focusSrc), typed = slate.focusTyped;
  $('spop-fman').checked = typed;
  // la app envuelve cada campo numérico en un .num: se esconde la envoltura, si no queda ocupando lugar
  const fin = $('spop-fin'), finBox = fin.closest('.num') || fin;
  finBox.hidden = fin.hidden = $('spop-fin-u').hidden = !typed; $('spop-focus').hidden = typed;
  $('spop-focus').innerHTML = c.focusM ? `${fmt(c.focusM, 2)} m <span class="src${lensState.focusSrc ? '' : ' warn'}">${src[1]}</span>` : '<span class="bad">none</span>';
  $('spop-focus').title = c.focusM ? `Focus distance ${src[0]} (Lens & focus). Tick Type to use another one here.` : 'No focus distance: tick Type to enter it here';
  const r = c.r;
  slate.est = r ? r.focalMm : null;
  let msg = '';
  if (!c.realSizeM) msg = 'Type the real size of what the line spans.';
  else if (!c.focusM) msg = typed ? 'Type the focus distance.' : 'No focus distance: tick Type to enter it here.';
  else if (!typed && !lensState.focusSrc) msg = 'The focus is the default, not from the shot: tick Type to enter the real one.';
  else if (!r) msg = 'Cannot solve with these values.';
  $('spop-msg').textContent = msg; $('spop-msg').hidden = !msg;
  $('spop-res').hidden = !r;
  if (r) {
    $('spop-f').textContent = `${fmt(r.focalMm, 2)} mm`;
    $('spop-ph').innerHTML = `${fmt(r.pinholeMm, 2)} mm <span class="src">+${fmt(r.pinholeExcess * 100, 1)} %</span>`;
    const refs = [['Camera now', focalUsed()], ['EXR', st.metaFocal]];
    const shot = typeof sr !== 'undefined' && sr.report && sr.sel >= 0 ? sr.report.shots[sr.sel] : null;
    refs.push(['Set report', shot && shot.focalMm]);
    $('spop-cmp').innerHTML = refs.map(([k, v]) => `<dt>${k}</dt><dd>${v > 0 ? slateDiff(v, r.focalMm) : '<span class="src">–</span>'}</dd>`).join('');
  }
  $('spop-use').disabled = !r;
  $('spop-use').title = r ? `Set the camera focal to ${fmt(r.focalMm, 2)} mm (thin lens)` : 'Needs a line, the real size and the focus distance';

  // cerca de la línea sin taparla (si tapa una punta no se la puede agarrar) y sin salirse del visor:
  // arriba, abajo, a la derecha o a la izquierda, el primero que entre; si ninguno entra, a la derecha
  const W = vp.clientWidth, H = vp.clientHeight, pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 16, m = 8;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const cx = (x) => Math.min(Math.max(x, m), Math.max(m, W - pw - m)), cy = (y) => Math.min(Math.max(y, m), Math.max(m, H - ph - m));
  const spots = [
    [cx(mx - pw / 2), Math.min(ay, by) - ph - gap],
    [cx(mx - pw / 2), Math.max(ay, by) + gap],
    [Math.max(ax, bx) + gap, cy(my - ph / 2)],
    [Math.min(ax, bx) - pw - gap, cy(my - ph / 2)],
  ];
  const fits = ([x, y]) => x >= m && y >= m && x + pw <= W - m && y + ph <= H - m;
  const [left, topY] = spots.find(fits) || [cx(spots[2][0]), spots[2][1]];
  pop.style.left = left + 'px'; pop.style.top = topY + 'px';
}

function slateUse() {
  if (!(slate.est > 0)) return;
  const el = $('tb-focal');
  el.value = slate.est.toFixed(2);
  el.dispatchEvent(new Event('change', { bubbles: true })); // el mismo manejador que tipear la focal
  refreshAll();
  toast(`Focal ${fmt(slate.est, 2)} mm from Slate solve`);
}

$('m-slate').onclick = () => setMode('slate');
$('spop-real').addEventListener('input', () => { const v = slateRealM(); if (v) lsSet('slateReal', v); drawOverlay(); });
$('spop-real').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); slateClear(); } });
$('spop-person').onclick = () => { $('spop-real').value = SLATE_PERSON_M; lsSet('slateReal', SLATE_PERSON_M); drawOverlay(); };
$('spop-use').onclick = slateUse;
$('spop-fman').addEventListener('change', e => {
  slate.focusTyped = e.target.checked;
  // arranca con el foco que había, para corregirlo en vez de escribirlo de cero
  if (slate.focusTyped && !(parseFloat($('spop-fin').value) > 0) && lensState.focusM > 0) $('spop-fin').value = +lensState.focusM.toFixed(2);
  drawOverlay();
  if (slate.focusTyped) setTimeout(() => { $('spop-fin').focus(); $('spop-fin').select(); }, 0);
});
$('spop-fin').addEventListener('input', () => drawOverlay());
$('spop-fin').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); slateClear(); } });
$('spop-x').onclick = slateClear;
{ const v = lsGet('slateReal', null); if (v > 0) $('spop-real').value = v; }
// las teclas del visor no cuentan mientras se escribe en el cartel
$('spop').addEventListener('pointerdown', e => e.stopPropagation());
