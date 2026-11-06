// drive-tools: medir la cámara del driving en su propia imagen (Measure drive camera) y comparar varios
// driving plates candidatos contra la toma (Compare drive plates…). Los driving reales llegan muchas veces
// sin metadata (proxies de video): la calle misma da el punto de fuga, el horizonte y, con 2 VP, la focal.
// Usa drv, drvCams, drvIntr/drvPose, drvRemember y drvCamFromMeta de js/drive-plate.js, y
// DriveMath.measure / fitVP / windowStats / analyze (js/drive-math.js, sobre SceneMath).
// API: dm, dmOpen, dmClose, dmSolve, dmAddLine, dmRemoveLine, dc, dcOpen, dcClose, dcAddFiles, dcRows, dcLoad.

// ---------- Medir la cámara del driving ----------
// lines: las de la calle (2 o más); cross: las transversales (2 VP, 2 o más); sel: { g: 'lines' | 'cross', i }
const dm = { on: false, lines: null, cross: null, sel: null, twoVP: false, freeF: true, res: null, drag: null, hover: '', saved: null, fit: null, applied: 0 };
const DM_GROUPS = [['lines', 'ax'], ['cross', 'cr']];
// líneas de arranque en px del driving: dos a lo largo de la calle (convergen al centro) y dos transversales
const dmDefaultLines = (W, H) => ({ lines: [[0.15 * W, 0.92 * H, 0.42 * W, 0.58 * H], [0.85 * W, 0.92 * H, 0.58 * W, 0.58 * H]],
  cross: [[0.30 * W, 0.30 * H, 0.70 * W, 0.31 * H], [0.25 * W, 0.80 * H, 0.75 * W, 0.78 * H]] });
// una línea que no va al punto común a más de esto (px del driving) se marca
const dmTol = () => Math.max(2, 0.0015 * drv.W);
const dmGroups = () => DM_GROUPS.slice(0, dm.twoVP ? 2 : 1);
function dmOpen() {
  if (!drv.src) { toast('Load a drive plate first', true); return false; }
  const c = drv.cam, d = dmDefaultLines(drv.W, drv.H), cp = (a) => a.map(l => l.slice());
  // con keyframes: arranca de la cámara que se ve en este cuadro, y si este cuadro ya se midió, con sus líneas
  const u = drvU(), now = drvKeysAt(u), key = u.kind === 'video' ? drvKeys(u).find(k => k.frame === drvFrameIndex(u)) : null;
  dm.saved = { ...c }; dm.on = true; dm.res = null; dm.drag = null; dm.sel = null;
  if (now) Object.assign(c, { tiltDeg: now.tiltDeg, rollDeg: now.rollDeg, yawDeg: now.yawDeg });
  const L = key && key.lines ? key : c;
  // proyectos de antes de N líneas: lines = [calle, calle, transversal, transversal]
  const old = L.lines && L.lines.length === 4 && !L.cross;
  dm.lines = L.lines && L.lines.length >= 2 ? cp(old ? L.lines.slice(0, 2) : L.lines) : d.lines;
  dm.cross = old ? cp(L.lines.slice(2)) : L.cross && L.cross.length >= 2 ? cp(L.cross) : d.cross;
  dm.twoVP = !!L.twoVP;
  $('dm').hidden = false;
  dmDraw();
  return true;
}
function dmClose(apply) {
  if (!dm.on) return;
  dm.on = false; dm.drag = null; $('dm').hidden = true;
  if (apply) {
    const r2 = (a) => a.map(l => l.map(v => +v.toFixed(2)));
    drv.cam.lines = r2(dm.lines); drv.cam.cross = r2(dm.cross); drv.cam.twoVP = dm.twoVP;
    // la nota dice dónde se midió y, al lado, lo que había (lo planeado del reporte, el EXR, lo tipeado) (D-05)
    const c = drv.cam, u = drvU(), was = dm.saved, tr = drvTrackNow(u), f1 = (v) => fmt(v, 1), i = drvFrameIndex(u);
    const at = u.kind !== 'video' ? 'the picture' : tr ? `EXR frame ${tr.frame}` : `frame ${i + 1}` + (u.tc ? ` (${drvTcText(u, i)})` : '');
    const prev = { measured: 'measured before', report: was.planned ? 'planned' : 'set report', exr: 'file', typed: 'typed' }[was.src];
    // con dos líneas por dirección el punto común es su cruce: no hay con qué controlar la medición
    const chk = dmCheckText(), weak = /unchecked/.test(chk);
    u.metaNote = `Measured on ${at} · tilt ${f1(c.tiltDeg)} / yaw ${f1(c.yawDeg)}` + (Math.abs(c.focal - was.focal) > 1e-3 ? ` · ${f1(c.focal)} mm` : '')
      + (prev ? ` — ${prev} ${f1(was.tiltDeg)} / ${f1(was.yawDeg)}` + (Math.abs(c.focal - was.focal) > 1e-3 ? ` · ${f1(was.focal)} mm` : '') : '') + `. ${chk}`;
    c.check = { street: dm.lines.length, cross: dm.twoVP ? dm.cross.length : 0, rms: dm.res && dm.res.fit ? +dm.res.fit.rms.toFixed(2) : null };
    // en un video, cada cuadro medido es un keyframe: con dos o más la cámara se interpola entre ellos
    if (u.kind === 'video') {
      const k = { frame: i, tiltDeg: c.tiltDeg, rollDeg: c.rollDeg, yawDeg: c.yawDeg, lines: c.lines, cross: c.cross, twoVP: c.twoVP, check: c.check };
      c.keys = (was.keys || []).filter(x => x.frame !== i).concat([k]).sort((a, b) => a.frame - b.frame);
    }
    drvRemember('measured'); dm.applied++;
    const kn = c.keys ? c.keys.length : 0;
    toast(`Drive camera measured: yaw ${fmt(c.yawDeg, 1)}°, tilt ${fmt(c.tiltDeg, 1)}°, roll ${fmt(c.rollDeg, 1)}°, ${fmt(c.focal, 1)} mm` + (kn >= 2 ? ` · ${kn} keyframes` : '') + (weak ? ' · only 2 lines: unchecked' : ''));
  } else drv.cam = dm.saved;
  drvUI(); render();
}
// resuelve con las líneas y lo pone en la cámara del driving (en vivo; Cancel vuelve a la de antes)
function dmSolve() {
  if (!dm.on) return null;
  const c = drv.cam, r = DriveMath.measure(drvIntr(), drvPose(), { street: dm.lines, cross: dm.cross }, { twoVP: dm.twoVP, fixedFocalMm: dm.freeF ? 0 : c.focal });
  dm.res = r;
  if (r.ok) {
    c.tiltDeg = +r.pose.tiltDeg.toFixed(3); c.yawDeg = +r.pose.yawDeg.toFixed(3); c.rollDeg = +r.pose.rollDeg.toFixed(3);
    if (r.mode === '2vp' && dm.freeF && r.focalMm > 0) c.focal = +r.focalMm.toFixed(3);
  }
  drvUI(); render(); dmDraw();
  return r;
}
// una línea más en el grupo (calle o transversal): va hacia el punto de fuga que ya dan las otras
function dmAddLine(g = 'lines') {
  if (!dm.on) return;
  const L = dm[g], W = drv.W, H = drv.H, f = DriveMath.fitVP(L), k = L.length;
  const x0 = [0.5, 0.3, 0.7, 0.4, 0.6][k % 5] * W, y0 = (g === 'lines' ? 0.86 : 0.55) * H;
  let l = g === 'lines' ? [x0, y0, x0, y0 - 0.3 * H] : [0.3 * W, y0, 0.7 * W, y0];
  if (f && f.vp) { const d = [f.vp[0] - x0, f.vp[1] - y0], n = Math.hypot(...d), s = Math.min(0.35 * Math.hypot(W, H), 0.6 * n) / n; l = [x0, y0, x0 + d[0] * s, y0 + d[1] * s]; }
  else if (f) { const d = [f.h[0], f.h[1]], n = Math.hypot(...d) || 1; l = [x0, y0, x0 + d[0] / n * 0.3 * W, y0 + d[1] / n * 0.3 * W]; }
  L.push(l); dm.sel = { g, i: L.length - 1 };
  dmSolve();
}
// saca la línea elegida (quedan al menos dos por grupo)
function dmRemoveLine() {
  const s = dm.sel; if (!dm.on || !s || dm[s.g].length <= 2) return;
  dm[s.g].splice(s.i, 1); dm.sel = null; dmSolve();
}
// px del driving <-> px del cuadro de medición (el driving entero, encajado debajo de la barra)
function dmFit() {
  const box = $('dm'), top = $('dm-bar').offsetHeight + 16, bot = $('dm-msg').offsetHeight + 16;
  const cw = box.clientWidth, ch = Math.max(40, box.clientHeight - top - bot), s = Math.min((cw - 24) / drv.W, ch / drv.H);
  return dm.fit = { s, x: (cw - drv.W * s) / 2, y: top + (ch - drv.H * s) / 2, cw, chh: box.clientHeight };
}
const dmTo = (p) => [dm.fit.x + p[0] * dm.fit.s, dm.fit.y + p[1] * dm.fit.s];
const dmFrom = (x, y) => [(x - dm.fit.x) / dm.fit.s, (y - dm.fit.y) / dm.fit.s];
function dmDraw() {
  if (!dm.on || !drv.src) return;
  const f = dmFit(), cv = $('dm-cv'), dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(f.cw * dpr) || cv.height !== Math.round(f.chh * dpr)) { cv.width = Math.round(f.cw * dpr); cv.height = Math.round(f.chh * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, f.cw, f.chh);
  try { g.drawImage(drv.src, f.x, f.y, drv.W * f.s, drv.H * f.s); } catch (e) { /* un video que todavía no tiene cuadro */ }
  const out = [], R = [f.x, f.y, f.x + drv.W * f.s, f.y + drv.H * f.s], tol = dmTol();
  // horizonte de la cámara medida
  const h = SceneMath.camera(drvIntr(), { ...drvPose(), xM: 0, zM: 0 }).horizon(), hl = h && scClip([...dmTo([h[0], h[1]]), ...dmTo([h[2], h[3]])], R);
  if (hl) {
    const hot = dm.hover === 'horizon' || (dm.drag && dm.drag.type === 'horizon');
    out.push(`<path class="sc-halo" d="${scM(hl)}"/><path class="sc-hz${hot ? ' hot' : ''}" d="${scM(hl)}"/>`);
    out.push(scTag(hl[0] + 10, hl[1] - 8, 'HORIZON · drag it to set the tilt', 'hz'));
  }
  const vps = [];
  dmGroups().forEach(([gk, cls], gi) => {
    const L = dm[gk], fit = DriveMath.fitVP(L), v = fit && fit.vp; vps.push(v);
    L.forEach((l, i) => {
      const a = dmTo([l[0], l[1]]), b = dmTo([l[2], l[3]]), sel = dm.sel && dm.sel.g === gk && dm.sel.i === i, off = L.length > 2 && fit && fit.res[i] > tol;
      if (v) { const q = dmTo(v), near = Math.hypot(a[0] - q[0], a[1] - q[1]) < Math.hypot(b[0] - q[0], b[1] - q[1]) ? a : b; const e = scClip([...near, ...q], [-4000, -4000, f.cw + 4000, f.chh + 4000]); if (e) out.push(`<path class="sc-ext ${cls}" d="${scM(e)}"/>`); }
      out.push(`<path class="sc-halo" d="${scM([...a, ...b])}"/><path class="sc-ln ${cls}${sel ? ' sel' : ''}${off ? ' off' : ''}" d="${scM([...a, ...b])}"/>`);
      [a, b].forEach((p, e) => { const hot = dm.hover === `${gk}${i}-${e}`; out.push(`<circle class="sc-hd ${cls}${hot ? ' hot' : ''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${hot ? 7 : 5.5}"/>`); });
      // con 3 o más líneas, cuánto se aparta cada una del punto común (px del driving)
      if (L.length > 2 && fit) out.push(scTag((a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2 - 6, `${gi ? 'C' : 'L'}${i + 1} · ${fmt(fit.res[i], 1)} px`, off ? 'err' : 'sub'));
    });
  });
  vps.forEach((p, k) => {
    if (!p) return; const q = dmTo(p); if (q[0] < 0 || q[1] < 0 || q[0] > f.cw || q[1] > f.chh) return;
    out.push(`<path class="sc-halo" d="M${q[0] - 9} ${q[1] - 9}l18 18M${q[0] - 9} ${q[1] + 9}l18 -18"/><path class="sc-x ${k ? 'cr' : 'ax'}" d="M${q[0] - 9} ${q[1] - 9}l18 18M${q[0] - 9} ${q[1] + 9}l18 -18"/>`);
    out.push(scTag(q[0] + 12, q[1] + 20, k ? 'cross VP' : 'street VP', 'vg'));
  });
  $('dm-ov').innerHTML = out.join('');
  dmUI();
}
// cuánto se controló la medición, para la nota de la cámara: con 2 líneas por dirección, nada
function dmCheckText() {
  const r = dm.res, side = r && r.mode === 'side', n = dm.lines.length, nx = dm.twoVP ? dm.cross.length : 3;
  if (side) return '';
  if (n < 3 || nx < 3) return `Only 2 ${n < 3 ? 'street' : 'cross'} lines: unchecked (add a third).`;
  return r && r.fit ? `${n} street lines within ${fmt(r.fit.rms, 1)} px.` : '';
}
// cómo cuadran las líneas de un grupo: el residuo de cada una al punto común
function dmFitText(name, fit, n, tag) {
  if (!fit) return '';
  // dos líneas siempre se cortan en un punto: residuo 0 no dice que la medición sea buena
  if (n < 3) return `Only 2 ${name} lines: two lines always meet, so nothing checks this measurement (a residual of 0 means nothing). Add a third with + ${name === 'street' ? 'Street' : 'Cross'} line. `;
  const tol = dmTol();
  if (fit.worst > tol) return `${tag}${fit.worstIdx + 1} is ${fmt(fit.worst, 1)} px off the point the other ${name} lines meet: it does not run the same way (a curve, lens distortion near the edge, a car body). Move it or remove it. `;
  return `${n} ${name} lines meet within ${fmt(fit.rms, 1)} px (worst ${fmt(fit.worst, 1)} px). `;
}
function dmUI() {
  $('dm-1vp').setAttribute('aria-pressed', String(!dm.twoVP)); $('dm-2vp').setAttribute('aria-pressed', String(dm.twoVP));
  $('dm-ff-row').hidden = !dm.twoVP; $('dm-ff').checked = dm.freeF;
  $('dm-addx').hidden = !dm.twoVP;
  const s = dm.sel; $('dm-del').disabled = !(s && dm[s.g] && dm[s.g].length > 2);
  const r = dm.res, c = drv.cam, side = (y) => { const k = SC_LOOKS.reduce((b, l) => Math.abs(SceneMath.angleDelta(y, l[1])) < Math.abs(SceneMath.angleDelta(y, b[1])) ? l : b); return k[2]; };
  let t, cls = '';
  if (!r) t = 'Drag the red lines over edges that run along the street (curbs, lane lines, cornices); add more with + Street line. Where they meet is the street vanishing point: with the focal it gives the tilt and the yaw. 2 VP adds green lines across the street and estimates the focal too.';
  else if (!r.ok) { t = r.error; cls = 'bad'; }
  else {
    const fz = dmFitText('street', r.fit, dm.lines.length, 'L'), fx = r.mode === '2vp' ? dmFitText('cross', r.fitX, dm.cross.length, 'C') : '';
    const off = (r.fit && dm.lines.length > 2 && r.fit.worst > dmTol()) || (r.mode === '2vp' && r.fitX && dm.cross.length > 2 && r.fitX.worst > dmTol())
      || (r.mode !== 'side' && (dm.lines.length < 3 || (r.mode === '2vp' && dm.cross.length < 3))); // sin control: aviso, no «ok»
    if (r.mode === 'side') t = `Side view: the street lines barely meet, so they only set the roll (${fmt(c.rollDeg, 1)}°). Drag the horizon to the eye level of things far away (camera height) to set the tilt; Looks to sets the yaw (now ${side(c.yawDeg)}).`;
    else {
      t = fz + fx + `Street vanishing point: yaw ${fmt(c.yawDeg, 1)}°, tilt ${fmt(c.tiltDeg, 1)}°` + (r.mode === '2vp' ? `, roll ${fmt(c.rollDeg, 1)}°, focal ${fmt(c.focal, 1)} mm on ${fmt(c.sw, 2)} mm film` + (dm.freeF ? ' (estimated)' : ' (kept)') : ` with ${fmt(c.focal, 1)} mm on ${fmt(c.sw, 2)} mm film`) + '. ';
      t += `The same point fits looking the opposite way: Looks to picks the side, and the solve keeps it (now ${side(c.yawDeg)}).`;
    }
    cls = off ? 'warn' : r.mode === 'side' ? '' : 'ok';
  }
  const m = $('dm-msg'); if (m.textContent !== t) m.textContent = t; m.className = 'msg dm-msg' + (cls ? ' ' + cls : '');
}
function dmHit(x, y) {
  let best = null, bd = 11;
  for (const [gk] of dmGroups()) dm[gk].forEach((l, i) => { for (let e = 0; e < 2; e++) { const q = dmTo([l[e * 2], l[e * 2 + 1]]), d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = { type: 'handle', g: gk, i, e }; } } });
  if (best) return best;
  // el cuerpo de una línea la elige (para sacarla)
  let ln = null, ld = 7;
  for (const [gk] of dmGroups()) dm[gk].forEach((l, i) => {
    const a = dmTo([l[0], l[1]]), b = dmTo([l[2], l[3]]), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (!(L2 > 1)) return;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)), d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
    if (d < ld) { ld = d; ln = { type: 'line', g: gk, i }; }
  });
  if (ln) return ln;
  const h = SceneMath.camera(drvIntr(), { ...drvPose(), xM: 0, zM: 0 }).horizon();
  if (h) { const a = dmTo([h[0], h[1]]), b = dmTo([h[2], h[3]]), L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > 1 && Math.abs(((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / L) < 7) return { type: 'horizon' }; }
  return null;
}
{
  const ov = $('dm-ov'), xy = (e) => { const r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  ov.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = xy(e), hit = dmHit(x, y); if (!hit) { if (dm.sel) { dm.sel = null; dmDraw(); } return; }
    if (hit.type !== 'horizon') { dm.sel = { g: hit.g, i: hit.i }; dmDraw(); }
    if (hit.type === 'line') return;
    dm.drag = hit; ov.setPointerCapture(e.pointerId); e.preventDefault();
  });
  ov.addEventListener('pointermove', (e) => {
    const [x, y] = xy(e), d = dm.drag;
    if (!d) { const h = dmHit(x, y), k = !h ? '' : h.type === 'handle' ? `${h.g}${h.i}-${h.e}` : h.type === 'line' ? '' : h.type; ov.style.cursor = !h ? '' : h.type === 'horizon' ? 'ns-resize' : h.type === 'line' ? 'pointer' : 'move'; if (k !== dm.hover) { dm.hover = k; dmDraw(); } return; }
    const p = dmFrom(x, y);
    if (d.type === 'handle') {
      const l = dm[d.g][d.i].slice(); l[d.e * 2] = p[0]; l[d.e * 2 + 1] = p[1];
      if (Math.hypot(l[2] - l[0], l[3] - l[1]) > 1) { dm[d.g][d.i] = l; dmSolve(); }
    } else if (d.type === 'horizon') {
      const t = DriveMath.tiltThrough(drvIntr(), drvPose(), p);
      if (t !== null) { drv.cam.tiltDeg = +t.toFixed(3); drvUI(); render(); dmDraw(); }
    }
  });
  // el visor de abajo (interaction.js) no recibe nada mientras se mide
  ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick', 'contextmenu'].forEach(t => $('dm').addEventListener(t, e => { e.stopPropagation(); if (t === 'contextmenu') e.preventDefault(); }));
  const up = () => { if (dm.drag) { dm.drag = null; dmDraw(); } };
  ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
  $('drv-measure').onclick = () => dmOpen();
  $('dm-apply').onclick = () => dmClose(true);
  $('dm-cancel').onclick = () => dmClose(false);
  $('dm-reset').onclick = () => { Object.assign(dm, dmDefaultLines(drv.W, drv.H)); dm.res = null; dm.sel = null; dmDraw(); };
  $('dm-1vp').onclick = () => { dm.twoVP = false; if (dm.sel && dm.sel.g === 'cross') dm.sel = null; dmSolve(); };
  $('dm-2vp').onclick = () => { dm.twoVP = true; dmSolve(); };
  $('dm-ff').onchange = () => { dm.freeF = $('dm-ff').checked; dmSolve(); };
  $('dm-add').onclick = () => dmAddLine('lines');
  $('dm-addx').onclick = () => dmAddLine('cross');
  $('dm-del').onclick = () => dmRemoveLine();
  // Looks to elige el lado: con las líneas puestas se vuelve a resolver hacia ese lado
  SC_LOOKS.forEach(([n]) => $('drv-look-' + n.toLowerCase()).addEventListener('click', () => { if (dm.on && dm.res) dmSolve(); else if (dm.on) dmDraw(); }));
  ['drv-focal', 'drv-sw', 'drv-roll'].forEach(id => $(id).addEventListener('change', () => { if (dm.on && dm.res) dmSolve(); else if (dm.on) dmDraw(); }));
  window.addEventListener('resize', () => { if (dm.on) dmDraw(); });
  document.addEventListener('keydown', (e) => {
    if (!dm.on || document.querySelector('.tour-bubble')) return;
    if (e.key === 'Escape') { e.stopPropagation(); dmClose(false); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && dm.sel && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { e.stopPropagation(); e.preventDefault(); dmRemoveLine(); }
  }, true);
}


// ---------- Comparar driving plates candidatos ----------
const dc = { cands: [], busy: false };
const DC_EXT = /\.(exr|mp4|mov|m4v|webm|jpe?g|png)$/i;
// EXR de una secuencia: sólo el primer cuadro de cada una (una carpeta de _input trae miles)
function dcSeqKey(f) { const p = (f.webkitRelativePath || f.name).replace(/\\/g, '/'); return /\.exr$/i.test(p) ? p.replace(/[._]?\d+\.exr$/i, '') : p; }
async function dcAddFiles(list) {
  const files = [...list].filter(f => DC_EXT.test(f.name)).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
  const seen = new Set(dc.cands.map(c => c.key)), add = [];
  for (const f of files) { const k = dcSeqKey(f); if (seen.has(k)) continue; seen.add(k); add.push([k, f]); }
  if (!add.length) { dcRender(); return 0; }
  dc.busy = true; dcRender();
  for (let i = 0; i < add.length; i++) {
    $('dc-info').textContent = `Reading ${i + 1} of ${add.length}: ${add[i][1].name}…`;
    dc.cands.push(await dcProbe(add[i][1], add[i][0]));
  }
  dc.busy = false; dcRender();
  return add.length;
}
// un cuadro por candidato: el header y la imagen del EXR, o el primer cuadro y la duración del video
async function dcProbe(file, key) {
  const c = { file, key: key || file.name, name: file.name, kind: '', W: 0, H: 0, n: 1, fps: 0, dur: 0, thumb: '', meta: null, err: '' };
  const thumbOf = (src, W, H) => { const cv = document.createElement('canvas'), w = 192; cv.width = w; cv.height = Math.max(1, Math.round(w * H / W)); cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height); return cv.toDataURL('image/jpeg', 0.8); };
  try {
    if (/\.exr$/i.test(file.name)) {
      c.kind = 'exr';
      let h; try { h = EXR.parseHeader(await file.slice(0, 1 << 21).arrayBuffer()); } catch (e) { h = null; }
      const buf = file.size < 120e6 ? await file.arrayBuffer() : null;
      if (!h) h = EXR.parseHeader(buf);
      const dw = h.get('dataWindow'); c.W = dw.xMax - dw.xMin + 1; c.H = dw.yMax - dw.yMin + 1;
      let bands = null;
      if (buf) try { const cv = document.createElement('canvas'); EXR.draw(EXR.decode(buf, h), h, { cs: EXR.detectSpace(h)[0], view: $('view').value || 'aces709', ev: 0 }, cv); c.thumb = thumbOf(cv, cv.width, cv.height); bands = drvBands(cv, c.W, c.H); } catch (e) { console.warn('compare thumb', e); }
      const r = drvCamFromMeta(camReadMeta(h), c.W, c.H, DRV_CAM_DEF, bands); if (r) { c.meta = r.cam; c.metaNote = r.out.join(', '); }
    } else if (vplIsVideo(file)) {
      c.kind = 'video';
      const info = /\.(mp4|m4v|mov)$/i.test(file.name) ? await vplMp4Info(file).catch(() => null) : null;
      const el = document.createElement('video'), url = URL.createObjectURL(file); el.muted = true; el.preload = 'auto';
      try {
        await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('the browser cannot play it')); el.src = url; });
        c.W = el.videoWidth; c.H = el.videoHeight; c.dur = el.duration; c.fps = info ? info.fps : 0; c.n = info ? info.n : Math.round(el.duration * (tl.fps || 24));
        // un clip de cámara arranca muchas veces con la claqueta: la miniatura sale de un cuarto del clip
        if (el.duration > 4) await new Promise((res) => { const t = setTimeout(res, 4000); el.onseeked = () => { clearTimeout(t); res(); }; el.currentTime = el.duration * 0.25; });
        c.thumb = thumbOf(el, c.W, c.H);
      } finally { el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); }
    } else {
      c.kind = 'image';
      const url = URL.createObjectURL(file), im = new Image();
      try { await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('the browser cannot open it')); im.src = url; }); c.W = im.naturalWidth; c.H = im.naturalHeight; c.thumb = thumbOf(im, c.W, c.H); }
      finally { URL.revokeObjectURL(url); }
    }
  } catch (e) { c.err = e.message || String(e); }
  return c;
}
// la cámara de un candidato: la medida o tipeada (proyecto), la del driving cargado, o la del archivo.
// La metadata no dice hacia dónde miraba: se supone el mismo lado que la toma, y se avisa.
// el mismo archivo elegido otra vez (por Driving plate o por la tabla) es otro File: se compara nombre y tamaño
const dcIsLoaded = (c) => !!(drv.src && drv.file && c.file && c.name === drv.name && c.file.size === drv.file.size);
const dcLooks = (yaw) => SC_LOOKS.reduce((b, l) => Math.abs(SceneMath.angleDelta(yaw, l[1])) < Math.abs(SceneMath.angleDelta(yaw, b[1])) ? l : b);
function dcCam(c) {
  const k = drvCams[c.name]; if (k) return { cam: { ...DRV_CAM_DEF, ...k }, how: k.src === 'exr' ? 'file' : k.src || 'typed' };
  if (dcIsLoaded(c)) return { cam: { ...drv.cam }, how: 'loaded' };
  if (c.meta) return { cam: { ...c.meta, yawDeg: dcLooks(scenePose().yawDeg)[1], heightM: scenePose().heightM }, how: 'file', assumed: true };
  return null;
}
// px de las ventanillas: lo que el key (o el alpha) saca de la toma; sin key, el cuadro entero
function dcWindowPoints() {
  const W = st.plate.W, H = st.plate.H, nx = 96, ny = Math.max(2, Math.round(nx * H / W)), all = [], hole = [];
  let s = null; try { s = typeof sceneHoleSampler === 'function' ? sceneHoleSampler() : null; } catch (e) { s = null; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const p = [(i + 0.5) * W / nx, (j + 0.5) * H / ny]; all.push(p); if (s && s.isHole(p[0], p[1])) hole.push(p); }
  return hole.length >= 4 ? { pts: hole, share: hole.length / all.length, frame: false } : { pts: all, share: 1, frame: true };
}
function dcRows() {
  if (st.plate.empty) return { rows: [], win: null };
  const iS = sceneIntr(), pS = scenePose(), win = dcWindowPoints(), fpxS = DriveMath.fpx(iS);
  const rows = dc.cands.map(c => {
    const k = c.err ? null : dcCam(c), r = { c, cam: k && k.cam, how: k && k.how, assumed: !!(k && k.assumed) };
    if (!k || !(c.W > 0)) return r;
    const iD = { focalMm: k.cam.focal, filmWidthMm: k.cam.sw, squeeze: k.cam.par || 1, plateW: c.W, plateH: c.H }, pD = { tiltDeg: k.cam.tiltDeg, rollDeg: k.cam.rollDeg, yawDeg: k.cam.yawDeg, heightM: k.cam.heightM };
    const a = DriveMath.analyze(iS, pS, iD, pD); if (!a) return r;
    const w = DriveMath.windowStats(a.sd, win.pts, iD);
    Object.assign(r, { win: w.coverage, frame: a.coverage, upC: a.centerIn ? a.upscale : NaN, upW: w.worst, dTilt: pS.tiltDeg - k.cam.tiltDeg, dYaw: SceneMath.angleDelta(pS.yawDeg, k.cam.yawDeg), par10: DriveMath.parallaxPx(fpxS, pS.heightM - k.cam.heightM, 10) });
    return r;
  });
  // por cobertura de las ventanillas y después por el peor upscale; sin cámara, al final
  const key = (r) => r.win === undefined ? -1 : r.win;
  rows.sort((a, b) => key(b) - key(a) || ((Number.isFinite(a.upW) ? a.upW : 1e9) - (Number.isFinite(b.upW) ? b.upW : 1e9)));
  return { rows, win };
}
function dcRender() {
  const tab = $('dc-tab'); if (!tab) return;
  const { rows, win } = dcRows(), esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  if (!dc.busy) $('dc-info').textContent = st.plate.empty ? 'Open the shot first: the comparison is against its camera and its windows.'
    : !dc.cands.length ? 'Add drive plates (files or a folder). Each one is read from a single frame.'
      : `Against ${st.plate.name || 'the shot'} · ` + (win.frame ? 'no keyed area found (turn the key on): coverage is of the whole frame' : `windows = the keyed area (${fmt(win.share * 100, 0)}% of the frame)`) + '. Click a row to load it as the drive plate.';
  const pct = (v) => v === undefined ? '–' : `${fmt(v * 100, v > 0.995 || v < 0.005 ? 0 : 1)}%`, x = (v) => Number.isFinite(v) ? fmt(v, 2) + '×' : '–', sg = (v) => (v >= 0 ? '+' : '') + fmt(v, 1);
  const head = '<thead><tr><th></th><th>Drive plate</th><th>Camera</th><th title="Share of the keyed area (what the windows show) that the drive plate covers">Windows</th><th title="Scale-up at the centre of the shot / worst in the windows (above 1× softer than the shot)">Upscale</th><th title="Shot minus drive plate">Δ tilt · yaw</th><th title="How far the street 10 m away is off from the camera height difference">Parallax 10 m</th></tr></thead>';
  const body = rows.map((r, i) => {
    const c = r.c, info = [c.W ? `${c.W} × ${c.H}` : '', c.kind === 'video' ? `${c.n} fr · ${fmt(c.dur, 1)} s` : c.kind.toUpperCase()].filter(Boolean).join(' · ');
    const cam = c.err ? `<span class="bad">${esc(c.err)}</span>` : !r.cam ? `<span class="dc-q">camera ?</span> <button class="btn sm" data-dc-measure="${i}" title="Load it and measure its camera on the street">Measure</button>`
      : `${fmt(r.cam.focal, 1)} mm · ${fmt(r.cam.sw, 2)} mm film<br><span class="note">${dcLooks(r.cam.yawDeg)[2]} (yaw ${fmt(r.cam.yawDeg, 1)}°${r.assumed ? ', assumed' : ''}) · tilt ${fmt(r.cam.tiltDeg, 1)}° · ${{ file: 'from the file', report: r.cam.planned ? 'planned' : 'set report' }[r.how] || r.how}</span>`;
    const bad = r.win !== undefined && r.win < 0.005;
    return `<tr data-dc-row="${i}" tabindex="0" title="Load ${esc(c.name)} as the drive plate"><td>${c.thumb ? `<img src="${c.thumb}" alt="">` : ''}</td><td><b>${esc(c.name)}</b><br><span class="note">${esc(info)}</span></td><td>${cam}</td>`
      + `<td class="dc-n${bad ? ' bad' : ''}">${pct(r.win)}</td><td class="dc-n">${x(r.upC)} / ${x(r.upW)}</td><td class="dc-n">${r.dTilt === undefined ? '–' : `${sg(r.dTilt)}° · ${sg(r.dYaw)}°`}</td><td class="dc-n">${r.par10 === undefined ? '–' : Math.round(r.par10) + ' px'}</td></tr>`;
  }).join('');
  tab.innerHTML = head + '<tbody>' + body + '</tbody>';
  tab._rows = rows;
}
async function dcLoad(r) {
  dcClose();
  const k = dcCam(r.c);
  await drvLoadFile(r.c.file);
  // la cámara del archivo no dice hacia dónde miraba: el mismo lado que supuso la tabla
  if (k && k.how === 'file' && !drvCams[r.c.name]) { drv.cam.yawDeg = k.cam.yawDeg; drvUI(); render(); }
}
function dcOpen() {
  // el driving cargado entra solo a la lista (es un candidato más)
  if (drv.src && drv.file && !dc.cands.some(dcIsLoaded)) {
    dc.cands.push({ file: drv.file, key: drv.file.name, name: drv.name, kind: drv.kind === 'video' ? 'video' : /\.exr$/i.test(drv.name) ? 'exr' : 'image', W: drv.W, H: drv.H, n: drv.n, dur: drv.n / (drv.fps || 24), thumb: dcThumbLoaded(), meta: null, err: '' });
  }
  $('dc-dlg').hidden = false; dcRender();
}
function dcThumbLoaded() { try { const cv = document.createElement('canvas'); cv.width = 192; cv.height = Math.max(1, Math.round(192 * drv.H / drv.W)); cv.getContext('2d').drawImage(drv.src, 0, 0, cv.width, cv.height); return cv.toDataURL('image/jpeg', 0.8); } catch (e) { return ''; } }
function dcClose() { $('dc-dlg').hidden = true; }
{
  $('drv-compare').onclick = () => dcOpen();
  $('dc-close').onclick = () => dcClose();
  $('dc-clear').onclick = () => { dc.cands = []; dcRender(); };
  $('f-dc').onchange = (e) => { const f = e.target.files; dcAddFiles(f).finally(() => { e.target.value = ''; }); };
  $('f-dcdir').onchange = (e) => { const f = e.target.files; dcAddFiles(f).finally(() => { e.target.value = ''; }); };
  $('dc-tab').addEventListener('click', (e) => {
    const rows = $('dc-tab')._rows || [], m = e.target.closest('[data-dc-measure]');
    if (m) { const r = rows[+m.dataset.dcMeasure]; if (r) dcLoad(r).then(() => dmOpen()); return; }
    const tr = e.target.closest('[data-dc-row]'); if (tr && rows[+tr.dataset.dcRow]) dcLoad(rows[+tr.dataset.dcRow]);
  });
  $('dc-tab').addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; const tr = e.target.closest('[data-dc-row]'), rows = $('dc-tab')._rows || []; if (tr && rows[+tr.dataset.dcRow]) dcLoad(rows[+tr.dataset.dcRow]); });
  $('dc-dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); dcClose(); } });
}

