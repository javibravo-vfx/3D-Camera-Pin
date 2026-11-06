// delivery: el reencuadre de entrega de la toma (Plate & camera › Delivery reformat). El comp muchas veces no
// usa el plate 1:1 (otro formato, agrandado, girado, corrido); acá se carga ese reencuadre, se ve como guía sobre
// el plate y los números que da la app en px (desenfoque, Copy Defocus, análisis del driving, Copy CornerPin,
// horizonte) se leen en px del plate o del comp, diciendo siempre en cuál. La matemática está en
// js/delivery-math.js (como el Transform de Nuke).
// API: dl, dlOn, dlComp, dlK, dlUnit, dlToComp, dlUI, dlDrawOverlay, dlCopyText, dlProjectState, dlApplyProject, dlReset.
const dl = { ...DeliveryMath.DEF, show: true };
const dlOn = () => !!dl.on && !st.plate.empty;
// los números van en px del comp
const dlComp = () => dlOn() && dl.units === 'comp';
// factor de px del plate a lo que se muestra, y su nombre
const dlK = () => (dlComp() ? DeliveryMath.size(dl, 1) : 1);
const dlUnit = () => (dlComp() ? 'comp px' : 'plate px');
const dlFmt = () => DeliveryMath.fmtOf(dl, st.plate.W, st.plate.H);
const dlToComp = (p) => DeliveryMath.toComp(dl, st.plate.W, st.plate.H, p);
// el horizonte de la toma en el comp: su y a la izquierda, al centro y a la derecha (null sin reencuadre)
function dlHorizon(seg) {
  if (!dlOn() || !seg) return null;
  const o = dlFmt(), ys = DeliveryMath.yAt(dl, st.plate.W, st.plate.H, seg, [0, o.W / 2, o.W]);
  return ys.some(v => v === null) ? null : { ys, W: o.W, H: o.H };
}
const dlNum = (v, d) => +(+v).toFixed(d);
function dlChanged() {
  dlUI(); drawOverlay(); render();
  if (typeof bkSet === 'function') bkSet(); // los números del desenfoque cambian de unidad
  if (typeof drv !== 'undefined') { drv.info = ''; drvAnalysisUI(); }
}
function dlUI() {
  const on = !!dl.on, o = dlFmt();
  $('dl-on').checked = on; $('dl-ui').hidden = !on;
  const set = (id, v, d) => { const el = $(id); if (document.activeElement !== el && !el.parentNode.classList.contains('scrubbing')) el.value = dlNum(v, d); };
  set('dl-w', o.W, 0); set('dl-h', o.H, 0); set('dl-s', dl.scale * 100, 3); set('dl-r', dl.rotDeg, 3); set('dl-x', dl.tx, 2); set('dl-y', dl.ty, 2);
  $('dl-u-plate').setAttribute('aria-pressed', String(dl.units !== 'comp')); $('dl-u-comp').setAttribute('aria-pressed', String(dl.units === 'comp'));
  $('dl-show').checked = dl.show !== false;
  const same = DeliveryMath.isIdentity(dl, st.plate.W, st.plate.H);
  $('dl-note').textContent = !on ? '' : same ? 'Same as the plate: type the comp format and the Transform of the plate in the comp (scale, rotate, translate as in Nuke).'
    : `Comp ${o.W} × ${o.H}: the plate scaled ${dlNum(dl.scale * 100, 2)}%, rotated ${dlNum(dl.rotDeg, 2)}° and moved ${dlNum(dl.tx, 1)}, ${dlNum(dl.ty, 1)} px. `
      + (dl.units === 'comp' ? 'Blur, Copy Defocus, the drive analysis and Copy CornerPin are in comp px.' : 'Blur, Copy Defocus, the drive analysis and Copy CornerPin are in plate px (put this reformat after the Merge).');
}
// guía en el visor: el cuadro del comp sobre el plate, con lo que queda afuera oscurecido
function dlDrawOverlay() {
  const el = $('dl-ov'); if (!el) return;
  if (!dlOn() || dl.show === false || DeliveryMath.isIdentity(dl, st.plate.W, st.plate.H)) { if (el.innerHTML) el.innerHTML = ''; return; }
  const W = st.plate.W, H = st.plate.H, o = dlFmt();
  const fr = DeliveryMath.frameInPlate(dl, W, H).map(p => uvToVp(p[0], p[1]));
  const pl = [[0, 0], [W, 0], [W, H], [0, H]].map(p => uvToVp(p[0], p[1]));
  const poly = (a) => 'M' + a.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L') + 'Z';
  const t = `COMP ${o.W} × ${o.H} · ${dlNum(dl.scale * 100, 1)}%` + (dl.rotDeg ? ` · ${dlNum(dl.rotDeg, 2)}°` : '');
  // el rótulo, adentro del cuadro del comp en su esquina de arriba a la izquierda (sin salir del visor)
  const x = Math.max(8, Math.min(fr[0][0] + 10, vp.clientWidth - 280)), y = Math.max(20, Math.min(fr[0][1] + 22, vp.clientHeight - 10));
  el.innerHTML = `<path class="dl-out" fill-rule="evenodd" d="${poly(pl)}${poly(fr)}"/><path class="dl-frame" d="${poly(fr)}"/>` + scTag(x, y, t, 'dl');
}
function dlCopyText() {
  if (!dlOn()) { toast('Turn the delivery reformat on first', true); return ''; }
  return DeliveryMath.nukeText(dl, st.plate.W, st.plate.H, `delivery of ${st.plate.name || 'the shot'}`);
}
function dlSet(patch) { Object.assign(dl, patch); dlChanged(); }
{
  $('dl-on').onchange = () => {
    dl.on = $('dl-on').checked;
    if (dl.on && !(dl.outW > 0)) { dl.outW = st.plate.W; dl.outH = st.plate.H; }
    dlChanged();
  };
  const num = (id, fn) => $(id).addEventListener('change', () => { const v = parseFloat($(id).value); if (Number.isFinite(v)) { fn(v); dlChanged(); } else dlUI(); });
  num('dl-w', v => { if (v >= 16) dl.outW = Math.round(v); });
  num('dl-h', v => { if (v >= 16) dl.outH = Math.round(v); });
  num('dl-s', v => { if (v > 0) dl.scale = v / 100; });
  num('dl-r', v => { dl.rotDeg = v; });
  num('dl-x', v => { dl.tx = v; });
  num('dl-y', v => { dl.ty = v; });
  $('dl-u-plate').onclick = () => dlSet({ units: 'plate' });
  $('dl-u-comp').onclick = () => dlSet({ units: 'comp' });
  $('dl-show').onchange = () => dlSet({ show: $('dl-show').checked });
  $('dl-copy').onclick = () => {
    const text = dlCopyText(); if (!text) return;
    const msg = 'Reformat + Transform copied: in Nuke it goes after the Merge of the background under the plate (or under the plate Read, with Copy CornerPin in comp px).';
    const done = (ok) => { $('dl-copy-msg').textContent = ok ? msg : 'The browser blocked the clipboard: copy it from the box below.'; $('dl-copy-out').hidden = ok; $('dl-copy-out').value = text; if (ok) toast(msg); };
    try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch (e) { done(false); }
  };
}
// ---------- Proyecto y Reset all (enganches en js/project.js y js/panel.js) ----------
function dlProjectState() { return dl.on || dl.outW > 0 ? { on: !!dl.on, scale: dl.scale, rotDeg: dl.rotDeg, tx: dl.tx, ty: dl.ty, outW: dl.outW, outH: dl.outH, units: dl.units, show: dl.show !== false } : undefined; }
function dlApplyProject(o) {
  Object.assign(dl, DeliveryMath.DEF, { show: true });
  if (o) for (const k of ['on', 'scale', 'rotDeg', 'tx', 'ty', 'outW', 'outH', 'units', 'show']) if (o[k] !== undefined) dl[k] = o[k];
  if (!(dl.scale > 0)) dl.scale = 1;
  if (dl.units !== 'comp') dl.units = 'plate';
  dlChanged();
}
function dlReset() { Object.assign(dl, DeliveryMath.DEF, { show: true }); $('dl-copy-out').hidden = true; $('dl-copy-msg').textContent = ''; dlUI(); dlDrawOverlay(); }
dlUI();
