// VFX Shooting Sup: hojas para el rodaje de los plates que faltan (fondos o primeros planos filmados con otra
// cámara y otro sensor). Cada setup es una imagen: la posición y la orientación de la cámara de la toma (la
// resuelta), con el cuerpo y el lente que se van a usar y un overscan sobre el cuadro original. Muestra el plate
// en el cuadro original, las 3D Guides del entorno (js/guides.js, sin gente ni autos de arranque), un fondo verde o
// azul, el contorno del cuadro original y una sobreimpresión con los datos para rearmar la cámara en el set.
// Las guías se arman por partes: Buildings (calle, veredas, fachadas: todo lo que no es gente ni autos), People y
// Cars, cada una por su lado; los autos de Cars in lanes no van (son de Compare and Match y DepthLab). Encima, a
// elección: la grilla de medición, el horizonte y el plate.
// Cada setup se exporta como un PNG fijo. Reemplaza al visor como Import (js/import-view.js): vfxShow(on).
// API: vfx, vfxShow, vfxRenderAll, vfxProjectState, vfxApplyProject.
const VFX_BG = { green: '#00b140', blue: '#0047bb', black: '#000000' };
const VFX_LINE = { white: '#ffffff', yellow: '#ffd23f', black: '#111111' };
const VFX_GRID = { cyan: '#3ad8ff', white: '#ffffff', yellow: '#ffd23f', magenta: '#ff4fa3', black: '#111111' };
const VFX_ALIGN = ['left', 'center', 'right'];
const VFX_FIELDS = [['project', 'Project'], ['shot', 'Scene / shot'], ['camera', 'Camera'], ['lens', 'Lenses'], ['focus', 'Focus'], ['pose', 'Height, tilt, roll, yaw']];
const VFX_EXPORT_W = 1920;
// letra de la sobreimpresión, como los monitores de cine (ARRI, SmallHD, Atomos): mayúsculas blancas de trazo
// parejo sobre barra negra. Tamaño: fracción del ancho del cuadro (Large es un poco menos que el de antes, 0.019).
// Monitor: Inter (fonts/) con tracking ancho; Mono: la monoespaciada del sistema, la de los números de la app.
const VFX_TEXT = { small: 0.0125, large: 0.016 };
const VFX_FONT = { monitor: { css: '--f-ui', w: 500, wv: 700, track: 0.07 }, mono: { css: '--f-num', w: 400, wv: 600, track: 0.02 } };
function vfxNew(i) {
  return { name: 'Setup ' + 'ABCDEFGHIJKL'[i % 12], cam: '', over: 10, auto: true, focal: 35, plate: i === 0, key: true, pop: 1, pexp: 0, guides: true, bg: i === 0 ? 'black' : 'green', line: 'white', frame: true, info: true, people: false, cars: false, grid: false, cell: 1, gcol: 'cyan', horizon: false, plateTop: false };
}
function vfxClean(s, i) {
  const d = vfxNew(i), o = Object.assign(d, s && typeof s === 'object' ? s : {});
  o.over = Math.min(100, Math.max(0, Number.isFinite(+o.over) ? +o.over : 10));
  o.focal = Math.min(1000, Math.max(1, Math.round(+o.focal || 35))); // mm enteros, como se filma
  if (!VFX_BG[o.bg]) o.bg = 'green';
  if (!VFX_LINE[o.line]) o.line = 'white';
  if (!VFX_GRID[o.gcol]) o.gcol = 'cyan';
  if (o.cam && typeof camMode === 'function' && !camMode(o.cam)) o.cam = '';
  for (const k of ['auto', 'plate', 'key', 'guides', 'frame', 'info', 'people', 'cars', 'grid', 'horizon', 'plateTop']) o[k] = !!o[k];
  o.pop = Number.isFinite(+o.pop) ? Math.min(1, Math.max(0, +o.pop)) : 1;
  o.pexp = Number.isFinite(+o.pexp) ? Math.min(4, Math.max(-4, +o.pexp)) : 0;
  o.cell = [1, 2, 4].includes(+o.cell) ? +o.cell : 1;
  o.name = String(o.name || d.name).slice(0, 40);
  return o;
}
const vfx = (() => {
  const s = lsGet('vfx', {}) || {}, num = (v, d) => Number.isFinite(+v) && v !== null && v !== '' ? Math.min(1, Math.max(0, +v)) : d;
  const setups = Array.isArray(s.setups) && s.setups.length ? s.setups.map(vfxClean) : [vfxNew(0), vfxNew(1)];
  const fields = {}; VFX_FIELDS.forEach(([k]) => { fields[k] = !s.fields || s.fields[k] !== false; });
  return { on: false, setups, bars: num(s.bars, 0.6), project: String(s.project || ''), shot: String(s.shot || ''), fields, text: VFX_TEXT[s.text] ? s.text : 'small', font: VFX_FONT[s.font] ? s.font : 'monitor', align: VFX_ALIGN.includes(s.align) ? s.align : 'left', talign: s.talign === 'center' ? 'center' : 'left', sameCam: !!s.sameCam, key: '', timer: 0 };
})();
const vfxState = () => ({ setups: vfx.setups, bars: vfx.bars, project: vfx.project, shot: vfx.shot, fields: vfx.fields, text: vfx.text, font: vfx.font, align: vfx.align, talign: vfx.talign, sameCam: vfx.sameCam });
function vfxSave() { lsSet('vfx', vfxState()); }
// Same camera for all setups: todos usan la cámara del primero (el resto no la pregunta)
const vfxCam = (s) => vfx.sameCam ? vfx.setups[0].cam : s.cam;
const vfxEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ---------- Geometría de un setup ----------
// tangentes del medio ángulo del plate original (horizontal y vertical) y las del cuadro nuevo; el lente automático
// es el de mm enteros más largo que, con el sensor de la cámara a usar, cubre el cuadro original más el overscan en
// los dos sentidos (el entero de abajo: un poco más de overscan, nunca menos)
function vfxGeom(s) {
  const W = st.plate.W || 1920, H = st.plate.H || 1080, A = W * par() / H;
  const th = (st.sw / 2) / focalUsed(), tv = th / A;
  const m = vfxCam(s) ? camMode(vfxCam(s)) : null;
  const sw = m ? m.w : st.sw, sh = m ? m.h : st.sw / A;
  const k = 1 + s.over / 100;
  const fAuto = Math.min(sw / 2 / (th * k), sh / 2 / (tv * k));
  const f = s.auto ? Math.max(1, Math.floor(fAuto + 1e-9)) : Math.round(s.focal);
  const nh = sw / 2 / f, nv = sh / 2 / f;
  return { sw, sh, a: sw / sh, f, fAuto, cover: Math.min(nh / th, nv / tv), fr: { w: th / nh, h: tv / nv }, m, nv };
}
function vfxCamName(s) {
  const m = vfxCam(s) ? camMode(vfxCam(s)) : camMode(st.preset);
  return m ? `${camBodyName(m.body)} · ${m.label}` : `Custom ${(+st.sw).toFixed(2)} mm`;
}
const vfxShotCamName = () => { const m = camMode(st.preset); return m ? `${camBodyName(m.body)} · ${m.label}` : `Custom ${(+st.sw).toFixed(2)} mm`; };
// proyecto y escena / toma: lo escrito en el panel o, si no, el proyecto de la metadata del EXR del plate y lo que el
// naming lee del nombre del plate
function vfxShotInfo() {
  let info = {};
  try { info = typeof nmParse === 'function' && st.plate.name ? nmParse(st.plate.name) || {} : {}; } catch (e) { info = {}; }
  const shot = vfx.shot || [info.scene && 'SC ' + info.scene, info.shot && 'SH ' + info.shot].filter(Boolean).join(' / ') || (st.plate.empty ? '' : st.plate.name.replace(/\.[A-Za-z0-9]{2,5}$/, ''));
  return { project: vfx.project || (st.plateMeta && st.plateMeta.project) || info.project || '', shot };
}
// mm de un lente: enteros sin decimales; el de la toma con uno si no es entero (24, 21.8)
const vfxMm = (v) => Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
const vfxNum = (v, d) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);

// ---------- Dibujo de un setup en un canvas de w px de ancho ----------
function vfxCamera(g, w, h) {
  const c = new THREE.PerspectiveCamera(2 * Math.atan(g.nv) * 180 / Math.PI, w / h, GUIDES_NEAR, GUIDES_FAR);
  camera.updateMatrixWorld();
  c.position.copy(camera.position); c.quaternion.copy(camera.quaternion); c.updateMatrixWorld(true);
  return c;
}
function vfxRender(s, cv, w) {
  const g = vfxGeom(s), h = Math.max(2, Math.round(w / g.a));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const x = cv.getContext('2d');
  x.fillStyle = VFX_BG[s.bg]; x.fillRect(0, 0, w, h);
  const fw = g.fr.w * w, fh = g.fr.h * h, fx = (w - fw) / 2, fy = (h - fh) / 2;
  const plate = () => {
    if (!s.plate || st.plate.empty) return;
    const e = s.key ? vfxKeyed() : typeof keyElement === 'function' && (keyElement() || [])[0]; if (!e) return;
    x.save(); x.globalAlpha = s.pop; if (Math.abs(s.pexp) > 1e-3) x.filter = `brightness(${Math.pow(2, s.pexp).toFixed(4)})`;
    x.drawImage(e, fx, fy, fw, fh); x.restore();
  };
  if (!s.plateTop) plate();
  let guides = false;
  // la grilla de medición, debajo de las guías: cada 1 o 2 m sobre el piso y las fachadas (js/guides.js)
  if (s.grid && typeof guidesImage === 'function') {
    const img = guidesImage({ cam: vfxCamera(g, w, h), W: w, H: h, k: 1, grid: s.cell, color: VFX_GRID[s.gcol] });
    if (img) { x.save(); x.globalAlpha = 0.75; x.drawImage(img, 0, 0); x.restore(); }
  }
  // Buildings (todo lo que no es gente ni autos), People y Cars, cada uno por su lado
  if ((s.guides || s.people || s.cars) && typeof guidesImage === 'function') {
    const b = !s.guides, img = guidesImage({ cam: vfxCamera(g, w, h), W: w, H: h, k: 1, skip: { cars: !s.cars, people: !s.people, lcars: true, lanes: b, curbs: b, facades: b, '': b }, color: VFX_LINE[s.line] });
    if (img) { const t = Math.max(1, Math.round(w / 1100)); for (let dx = 0; dx < t; dx++) for (let dy = 0; dy < t; dy++) x.drawImage(img, dx - (t - 1) / 2, dy - (t - 1) / 2); guides = true; }
  }
  // en un cuadro chico la letra tiene un piso, distinto para cada tamaño (si no, Small y Large se verían iguales)
  const base = Math.min(w, h * 1.78), fs = Math.max(vfx.text === 'large' ? 9 : 7, Math.round(base * VFX_TEXT[vfx.text])), ff = Math.max(9, base * 0.019);
  if (s.horizon) vfxHorizon(x, g, w, h, ff, fs);
  if (s.plateTop) plate();
  if (s.frame) {
    x.save(); x.strokeStyle = '#ff4d4d'; x.lineWidth = Math.max(1, ff / 9); x.setLineDash([ff * 0.7, ff * 0.45]);
    x.strokeRect(fx, fy, fw, fh); x.restore();
  }
  if (s.info) vfxDrawInfo(x, s, g, w, h, fs);
  return { g, guides };
}
// el plate con el key de Plate & camera (pantalla, threshold, softness, despill), aunque el key del visor esté
// apagado: la misma cuenta del shader de js/chroma.js, en la CPU, a 1920 px de ancho como mucho, y guardado mientras
// no cambie el plate, el cuadro o el key
const vfxKeyC = { sig: '', cv: null };
function vfxKeyed() {
  const e = typeof keyElement === 'function' ? keyElement() : null; if (!e) return null;
  const [el, W, H] = e, k = Math.min(1, 1920 / W), w = Math.max(2, Math.round(W * k)), h = Math.max(2, Math.round(H * k));
  const sig = [st.plate.name, W, H, key.thr, key.soft, key.despill, key.screen, typeof tl !== 'undefined' ? tl.frame : 0, el.currentTime || 0].join('|');
  if (vfxKeyC.sig === sig && vfxKeyC.cv) return vfxKeyC.cv;
  const cv = vfxKeyC.cv || (vfxKeyC.cv = document.createElement('canvas')); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, w, h); g.drawImage(el, 0, 0, w, h);
  let im; try { im = g.getImageData(0, 0, w, h); } catch (err) { return el; }
  const d = im.data, green = key.screen === 'green', thr = key.thr, soft = Math.max(1 / 255, key.soft);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, scr = green ? gg : b, oth = green ? Math.max(r, b) : Math.max(r, gg), diff = scr - oth;
    const a = Math.min(1, Math.max(0, 1 - (diff - thr) / soft));
    if (key.despill && diff > 0) d[i + (green ? 1 : 2)] = Math.round(oth * 255);
    d[i + 3] = Math.round(a * d[i + 3]);
  }
  g.putImageData(im, 0, 0); vfxKeyC.sig = sig;
  return cv;
}
// el horizonte de la cámara de la toma (a su altura): dos puntos lejanos a la altura de la cámara, de lado a lado
function vfxHorizon(x, g, w, h, ff, fs) {
  const c = vfxCamera(g, w, h), f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion); f.y = 0;
  if (f.lengthSq() < 1e-9) return; f.normalize();
  const side = new THREE.Vector3(-f.z, 0, f.x), P = (k) => c.position.clone().addScaledVector(f, 2000).addScaledVector(side, k * 2000).project(c); // dentro del far de la cámara
  const a = P(-0.5), b = P(0.5); if (!(Math.abs(a.z) < 1 && Math.abs(b.z) < 1)) return;
  const px = (p) => [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h], A = px(a), B = px(b), m = (B[1] - A[1]) / (B[0] - A[0] || 1e-9);
  const y0 = A[1] - m * A[0], y1 = y0 + m * w; if (Math.max(y0, y1) < 0 || Math.min(y0, y1) > h) return;
  x.save(); x.strokeStyle = '#ffb020'; x.lineWidth = Math.max(1, ff / 8); x.setLineDash([ff * 0.9, ff * 0.5]);
  x.beginPath(); x.moveTo(0, y0); x.lineTo(w, y1); x.stroke();
  x.setLineDash([]); x.fillStyle = '#ffb020'; x.font = `600 ${Math.round(fs * 0.9)}px ${getComputedStyle(document.documentElement).getPropertyValue('--f-ui')}`;
  x.textBaseline = 'bottom'; x.textAlign = 'left'; x.fillText('HORIZON', fs, y0 + m * fs - fs * 0.25);
  x.restore();
}
// Sobreimpresión: arriba proyecto, escena / toma y el setup; abajo cámara y lentes, y la posición de la cámara
// con las convenciones de VFX (metros, Y arriba, orden de rotación ZXY de Nuke y Maya, tilt positivo hacia arriba).
// Cada dato es rótulo gris y valor blanco, en mayúsculas, como en los monitores de cine.
function vfxDrawInfo(x, s, g, w, h, fs) {
  const sty = VFX_FONT[vfx.font], fam = getComputedStyle(document.documentElement).getPropertyValue(sty.css);
  const F = vfx.fields, info = vfxShotInfo(), a = camAngles(), pad = fs * 0.9, up = (t) => String(t).toUpperCase();
  const font = (wt, f) => { x.font = `${wt} ${f}px ${fam}`; x.letterSpacing = (sty.track * f).toFixed(2) + 'px'; };
  const rows = [], r1 = [], r2 = [];
  if (F.camera) r1.push(['Camera', vfxCamName(s)]);
  if (F.lens) {
    r1.push(['Lens', g.f + ' mm'], ['Shot', vfxMm(focalUsed()) + ' mm']);
    if (s.auto) r1.push(['Overscan', s.over + '%']);
    else if (g.cover >= 1) r1.push(['Covers', '+' + Math.round((g.cover - 1) * 100) + '%']);
    else r1.push(['', 'Does not cover the shot', '#ff6b6b']);
  }
  if (F.focus) r2.push(['Focus', (+lensState.focusM).toFixed(2) + ' m']);
  if (F.pose) r2.push(['Height', camera.position.y.toFixed(2) + ' m'], ['Tilt', vfxNum(a.tilt, 2) + '°'], ['Roll', vfxNum(a.roll, 2) + '°'], ['Yaw', vfxNum(a.yaw, 2) + '°']);
  if (r1.length) rows.push(r1);
  if (r2.length) rows.push(r2);
  // ancho de una fila de rótulos y valores a la letra f; si no entra, la letra de esa fila se achica
  const gapL = 0.5, gapI = 1.8;
  const rowW = (items, f) => items.reduce((sum, [l, v], i) => {
    font(sty.w, f); const lw = l ? x.measureText(up(l)).width + gapL * f : 0;
    font(sty.wv, f); return sum + lw + x.measureText(up(v)).width + (i ? gapI * f : 0);
  }, 0);
  const fitF = (items, max) => { const ww = rowW(items, fs); return ww > max ? Math.max(6, Math.floor(fs * max / ww)) : fs; };
  const at = (ww) => vfx.align === 'center' ? (w - ww) / 2 : vfx.align === 'right' ? w - pad - ww : pad; // abajo: izquierda, centro o derecha
  const drawRow = (items, y, f) => {
    let cx = at(rowW(items, f)); x.textAlign = 'left';
    items.forEach(([l, v, col], i) => {
      if (i) cx += gapI * f;
      if (l) { font(sty.w, f); x.fillStyle = 'rgba(255,255,255,0.62)'; x.fillText(up(l), cx, y); cx += x.measureText(up(l)).width + gapL * f; }
      font(sty.wv, f); x.fillStyle = col || '#ffffff'; x.fillText(up(v), cx, y); cx += x.measureText(up(v)).width;
    });
  };
  const bar = (y, hh) => { x.fillStyle = `rgba(0,0,0,${vfx.bars})`; x.fillRect(0, y, w, hh); };
  const one = (t, wt, max) => { let f = fs; font(wt, f); while (x.measureText(t).width > max && f > 6) { f -= 1; font(wt, f); } };
  x.save(); x.textBaseline = 'middle';
  // arriba: proyecto · toma a la izquierda, el setup a la derecha
  const top = up([F.project && info.project, F.shot && info.shot].filter(Boolean).join('   ·   '));
  const th = fs * 2.1; bar(0, th);
  // Title align: el proyecto y la toma a la izquierda o centrados en la barra (el setup sigue a la derecha)
  const ctr = vfx.talign === 'center';
  x.fillStyle = '#ffffff'; x.textAlign = ctr ? 'center' : 'left'; one(top, sty.wv, ctr ? w * 0.46 : w * 0.7); x.fillText(top, ctr ? w / 2 : pad, th / 2);
  x.textAlign = 'right'; one(up(s.name), sty.wv, w * 0.26); x.fillText(up(s.name), w - pad, th / 2);
  // abajo
  if (rows.length) {
    const lh = fs * 1.7, note = F.pose ? fs * 1.15 : 0, bh = rows.length * lh + fs * 0.7 + note; bar(h - bh, bh);
    rows.forEach((r, i) => drawRow(r, h - bh + fs * 0.35 + lh * (i + 0.5), fitF(r, w - 2 * pad)));
    if (F.pose) {
      const t = 'Meters, Y up, rotation order ZXY (yaw, then tilt, then roll), tilt positive looking up, from the shot camera';
      let f = fs * 0.7; font(sty.w, f); while (x.measureText(t).width > w - 2 * pad && f > 6) { f -= 0.5; font(sty.w, f); }
      x.fillStyle = 'rgba(255,255,255,0.6)'; x.textAlign = 'left'; x.fillText(t, at(x.measureText(t).width), h - fs * 0.35 - note / 2);
    }
  }
  x.restore();
}

// ---------- Vista: un cuadro por setup en lugar del visor ----------
function vfxBuild() {
  const box = document.createElement('div');
  box.className = 'vfxv'; box.id = 'vfxv'; box.hidden = true; box.dataset.tour = 'vfx.view';
  const vmid = document.querySelector('.viewer > .vmid'); vmid.parentNode.insertBefore(box, vmid.nextSibling);
  box.addEventListener('click', vfxOnClick); box.addEventListener('change', vfxOnChange); box.addEventListener('input', vfxOnChange);
  box.addEventListener('dblclick', e => { const t = e.target; if (t.dataset && t.dataset.k === 'pexp') { t.value = 0; t.dispatchEvent(new Event('input', { bubbles: true })); } });
}
// las opciones de cada cuadro, por grupo: Plate (el plate y cómo se ve), Environment (lo que sale del entorno 3D:
// sin entorno no se puede tildar) y Sheet (lo técnico de la hoja: fondo, horizonte, cuadro de la toma e info)
const VFX_ENV_KEYS = ['guides', 'people', 'cars', 'grid', 'cell', 'gcol', 'line'];
const vfxExpTxt = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
function vfxPanes() {
  const box = $('vfxv'); if (!box) return;
  box.style.setProperty('--vfx-cols', String(Math.min(2, vfx.setups.length)));
  const chk = (i, k, label, tip) => `<label class="row" title="${tip}"><input type="checkbox" data-i="${i}" data-k="${k}"${vfx.setups[i][k] ? ' checked' : ''}> ${label}</label>`;
  const sel = (i, k, label, tip, opts) => `<select data-i="${i}" data-k="${k}" aria-label="${label} of ${vfxEsc(vfx.setups[i].name)}" title="${tip}">${opts.map(([v, n]) => `<option value="${v}"${String(vfx.setups[i][k]) === String(v) ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  const cap = (c) => c[0].toUpperCase() + c.slice(1);
  box.innerHTML = vfx.setups.map((s, i) => `<section class="impp vfxp" data-i="${i}"><header><b>${vfxEsc(s.name)}</b><span class="note" id="vfx-n-${i}"></span>
      <button class="btn sm primary" data-act="png" data-i="${i}" title="Save this setup as a PNG (${VFX_EXPORT_W} px wide) for the shoot">Export PNG</button></header>
    <div class="vfxo">
      <div class="vfxg" role="group" aria-label="Plate"><span class="vfxg-t">Plate</span><span class="vfxg-w">${chk(i, 'plate', 'Show', 'The plate of the shot, in the frame of the shot camera')}<button class="vpchip vfx-key" data-act="key" data-i="${i}" aria-pressed="${s.key}" title="Key: the chroma key of Plate &amp; camera on the plate of this sheet (screen, threshold, softness), even with the key of the viewer off">Key</button><label class="vfx-sl" title="Opacity of the plate">Opacity <input type="range" min="0" max="1" step="0.05" value="${s.pop}" data-i="${i}" data-k="pop" aria-label="Plate opacity"></label><label class="vfx-sl" title="Exposure of the plate, in stops. Double-click to reset.">Exposure <input type="range" min="-4" max="4" step="0.1" value="${s.pexp}" data-i="${i}" data-k="pexp" aria-label="Plate exposure"><b id="vfx-exp-${i}">${vfxExpTxt(s.pexp)}</b></label>${chk(i, 'plateTop', 'On top', 'The plate over everything: the guides, the grid and the horizon only show where the key lets the background through')}</span></div>
      <div class="vfxg vfxg-env" role="group" aria-label="Environment"><span class="vfxg-t">Environment</span><span class="vfxg-w">${chk(i, 'guides', 'Buildings', 'The lines of the 3D environment without people or cars: street, sidewalks, facades (hidden line)')}${chk(i, 'people', 'People', 'The people of the environment, in lines')}${chk(i, 'cars', 'Cars', 'The cars and trains of the environment, in lines (not the Cars in lanes of Compare and Match)')}${sel(i, 'line', 'Line color', 'Color of the guides', Object.keys(VFX_LINE).map(c => [c, cap(c) + ' lines']))}${chk(i, 'grid', '3D Grid', 'A measure grid on the visible ground and the facades of the 3D environment')}${sel(i, 'cell', '3D Grid cell', 'A grid line every 1, 2 or 4 m', [1, 2, 4].map(c => [c, c + ' m']))}${sel(i, 'gcol', '3D Grid color', 'Color of the 3D Grid', Object.keys(VFX_GRID).map(c => [c, cap(c)]))}</span></div>
      <div class="vfxg" role="group" aria-label="Sheet"><span class="vfxg-t">Sheet</span><span class="vfxg-w">${sel(i, 'bg', 'Background', 'Background behind the guides', Object.keys(VFX_BG).map(b => [b, b === 'black' ? 'Black' : b === 'green' ? 'Green screen' : 'Blue screen']))}${chk(i, 'horizon', 'Horizon', 'The horizon at the height of the shot camera (orange, dashed)')}${chk(i, 'frame', 'Shot frame', 'The frame of the shot camera inside this one (red, dashed)')}${chk(i, 'info', 'Info', 'The data to set up the camera on the shoot')}</span></div>
    </div>
    <div class="impb vfxb"><canvas id="vfx-cv-${i}"></canvas></div></section>`).join('');
  vfx.key = ''; vfxEnvUI();
}
// lo del entorno no se tilda sin un entorno elegido
function vfxEnvUI() {
  const has = !!ENV_MODULES[env.id], box = $('vfxv'); if (!box) return;
  box.querySelectorAll('.vfxg-env input, .vfxg-env select').forEach(el => { if (el.disabled === has) el.disabled = !has; });
  box.querySelectorAll('.vfxg-env').forEach(g => { g.title = has ? '' : 'Pick an environment in 3D Camera Pin | Environment › Environment › Module'; g.classList.toggle('off', !has); });
}
function vfxOnClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'png') vfxExport(+b.dataset.i);
  else if (b.dataset.act === 'key') { const s = vfx.setups[+b.dataset.i]; if (!s) return; s.key = !s.key; b.setAttribute('aria-pressed', String(s.key)); vfxSave(); vfxRenderAll(true); }
}
function vfxOnChange(e) {
  const t = e.target, i = +t.dataset.i, k = t.dataset.k; if (!k || !vfx.setups[i]) return;
  const v = t.type === 'checkbox' ? t.checked : k === 'cell' || t.type === 'range' ? +t.value : t.value; if (vfx.setups[i][k] === v) return; // input y change del mismo cambio
  vfx.setups[i][k] = v;
  if (k === 'pexp') $('vfx-exp-' + i).textContent = vfxExpTxt(v);
  vfxSave();
  if (t.type === 'range') vfxSoon(); else vfxRenderAll(true);
}
// el cuadro de cada setup al tamaño de su lugar (con la resolución de la pantalla)
function vfxRenderAll(force) {
  if (!vfx.on) return;
  const key = [force ? Math.random() : '', camera.matrixWorld.elements.map(v => v.toFixed(5)).join(), st.sw, focalUsed(), st.preset, st.plate.name, st.plate.W, st.plate.H, env.id, env.on, env.seed, JSON.stringify(env.vals), envRoot.children.length, typeof tl !== 'undefined' ? tl.frame : 0, lensState.focusM, JSON.stringify(vfxProjectState()), $('vfxv').clientWidth, $('vfxv').clientHeight].join('|');
  if (key === vfx.key) return; vfx.key = key;
  const dpr = window.devicePixelRatio || 1;
  vfx.setups.forEach((s, i) => {
    const cv = $('vfx-cv-' + i); if (!cv) return;
    const host = cv.parentNode, g = vfxGeom(s);
    const w = Math.max(64, Math.min(2400, Math.round(Math.min(host.clientWidth, host.clientHeight * g.a) * dpr)));
    const r = vfxRender(s, cv, w);
    const n = $('vfx-n-' + i);
    const t = `${g.f} mm · ${vfxCam(s) ? vfxCamName(s) : 'shot camera'}${(s.guides || s.people || s.cars) && !r.guides ? ' · no environment: pick one in Environment › Module' : ''}`;
    if (n && n.textContent !== t) n.textContent = t;
  });
}
// redibujar en el próximo cuadro (varios cambios seguidos, un solo dibujo)
let vfxRaf = 0;
function vfxSoon() { if (!vfx.on || vfxRaf) return; vfxRaf = requestAnimationFrame(() => { vfxRaf = 0; vfxRenderAll(true); }); }
function vfxShow(on) {
  if (on === vfx.on) return;
  vfx.on = on; $('vfxv').hidden = !on;
  clearInterval(vfx.timer);
  if (on) { vfxPanes(); vfxPanel(); requestAnimationFrame(() => vfxRenderAll(true)); vfx.timer = setInterval(() => vfxRenderAll(), 700); }
}
window.addEventListener('resize', () => { if (vfx.on) vfxRenderAll(); });
// lo de afuera que se ve en los cuadros: el foco, el entorno rearmado, el plate o la cámara (el sondeo de 700 ms queda de red)
document.addEventListener('lens-changed', () => vfxSoon());
{ const f = envRebuild; envRebuild = function (...a) { const r = f(...a); vfxSoon(); vfxEnvUI(); vfxSimpleUI(); return r; }; }
{ const f = drawOverlay; drawOverlay = function (...a) { const r = f(...a); vfxSoon(); return r; }; }

// ---------- Simple Grid a la medida del entorno ----------
// Pasa el entorno elegido a un Simple Grid (js/environment.js) que respeta la distancia de pared a pared y el ancho
// de la calle: en la avenida, las fachadas y los cordones (con el corrimiento del carril del auto de la toma); en la
// estación, los andenes. Lo demás (lugar, giro, altura del piso y el Motion) queda como estaba. El entorno de antes
// sigue guardado: se vuelve a elegir en Environment › Module.
function vfxSimpleFit() {
  const v = env.vals;
  if (env.id === 'avenue') {
    const L = avenueLayout(v), sx = avenueShift(v);
    return { wallL: -(L.faceX(-1) + sx), wallR: L.faceX(1) + sx, curbL: -(L.edgeX(-1) + sx), curbR: L.edgeX(1) + sx, walls: v.buildings === false ? 'none' : 'both', from: ENV_MODULES.avenue.name };
  }
  if (env.id === 'rail') {
    const sp = v.spacing, xL = -Math.round(v.tracksL) * sp, xR = Math.round(v.tracksR) * sp, plat = v.plat;
    const has = (s) => plat === 'both' || plat === (s < 0 ? 'left' : 'right');
    const edge = (s) => (s < 0 ? xL : xR) + s * v.pEdge;
    return { curbL: has(-1) ? -edge(-1) : -(xL - 2.5), curbR: has(1) ? edge(1) : xR + 2.5, wallL: has(-1) ? -(edge(-1) - v.pD) : -(xL - 6), wallR: has(1) ? edge(1) + v.pD : xR + 6,
      walls: has(-1) && has(1) ? 'both' : has(-1) ? 'left' : has(1) ? 'right' : 'none', from: ENV_MODULES.rail.name };
  }
  return null;
}
function vfxToSimple() {
  const f = vfxSimpleFit(); if (!f) return false;
  const keep = {}; ENV_COMMON.forEach(p => { keep[p.key] = env.vals[p.key]; });
  if (env.id === 'rail') keep.y = (env.vals.y || 0); // el riel arriba está en y = 0 del entorno: el piso queda ahí
  const mon = !!env.vals.mon, r1 = (x) => +Math.max(0, x).toFixed(2), from = f.from;
  envSelect('simple');
  Object.assign(env.vals, keep, { wallL: Math.max(0.5, r1(f.wallL)), wallR: Math.max(0.5, r1(f.wallR)), curbL: r1(f.curbL), curbR: r1(f.curbR), walls: f.walls, mon });
  envRenderParams(); envSave(); envRebuild(); tlUI();
  toast(`Simple Grid fitted to ${from}: walls at ${fmt(env.vals.wallL, 1)} m and ${fmt(env.vals.wallR, 1)} m, curbs at ${fmt(env.vals.curbL, 1)} m and ${fmt(env.vals.curbR, 1)} m from the car`);
  return true;
}
function vfxSimpleUI() {
  const b = $('vfx-simple'); if (!b) return;
  const can = !!vfxSimpleFit();
  b.disabled = !can;
  b.title = env.id === 'simple' ? 'The environment is already a Simple Grid' : can ? `Turn ${ENV_MODULES[env.id].name} into a Simple Grid with the same distance from wall to wall and the same street width (pick it again in Environment › Module to go back)` : 'Pick an environment first (3D Camera Pin | Environment › Environment › Module)';
}

// ---------- Export ----------
function vfxFileName(s) {
  const info = vfxShotInfo(), base = [info.project, info.shot].filter(Boolean).join('_') || 'shot';
  return `${base}_${s.name}_${vfxGeom(s).f.toFixed(0)}mm.png`.replace(/[^\w.\-]+/g, '_');
}
async function vfxExport(i) {
  const s = vfx.setups[i]; if (!s) return;
  try { await document.fonts.ready; } catch (e) { }
  const cv = document.createElement('canvas'); vfxRender(s, cv, VFX_EXPORT_W);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if (!blob) { toast('Could not make the PNG', true); return; }
  const name = vfxFileName(s);
  vfx.lastExport = { name, size: blob.size, w: cv.width, h: cv.height }; // para la prueba
  if (window.bplDesktop) { const r = await desktopSave(blob, name); toast(r.msg, !!r.error); return; }
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename: name, data: blob }); toast('Saved to Downloads'); return; }
  } catch (e) { if (e && e.code === 'declined') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast('Saved ' + name + ' to Downloads');
}

// ---------- Panel (sección VFX Shooting Sup) ----------
function vfxNote(s, g) {
  return `${g.f} mm ${g.cover >= 1 ? `covers the shot with ${Math.round((g.cover - 1) * 100)}% to spare` : `<span class="bad">does not cover the shot (${Math.round(g.cover * 100)}%)</span>`}.`;
}
// mientras se arrastra un número del panel: el lente Auto y la nota, sin rearmar el panel (se perdería el arrastre)
function vfxNotes() {
  vfx.setups.forEach((s, i) => {
    const g = vfxGeom(s), n = $('vfx-note-' + i), f = $('vfx-f-' + i);
    if (n) { const t = vfxNote(s, g); if (n.innerHTML !== t) n.innerHTML = t; }
    if (f && s.auto && document.activeElement !== f) f.value = g.f;
  });
}
let vfxCamOpts = '';
function vfxPanel() {
  const box = $('vfx-setups'); if (!box) return;
  if (!vfxCamOpts) vfxCamOpts = CAM_CATALOG.map(b => `<optgroup label="${vfxEsc(camBodyName(b))}">${camModes(b).map(m => `<option value="${m.key}">${vfxEsc(m.label)} · ${m.w} × ${m.h} mm</option>`).join('')}</optgroup>`).join('');
  const focus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : '';
  box.innerHTML = vfx.setups.map((s, i) => {
    const g = vfxGeom(s);
    return `<div class="vfxs" data-i="${i}">
      <div class="row nowrap"><input id="vfx-name-${i}" data-k="name" data-i="${i}" type="text" value="${vfxEsc(s.name)}" aria-label="Name of the setup"><button class="btn sm ghost" id="vfx-del-${i}" data-act="del" data-i="${i}" title="Remove this setup"${vfx.setups.length < 2 ? ' disabled' : ''}>×</button></div>
      ${vfx.sameCam && i > 0 ? `<p class="note" id="vfx-camsame-${i}">Camera: the one of ${vfxEsc(vfx.setups[0].name)} (${vfxEsc(vfxCam(s) ? vfxCamName(s) : 'same as the shot')}).</p>`
        : `<label class="fld" for="vfx-cam-${i}">Camera<select id="vfx-cam-${i}" data-k="cam" data-i="${i}" title="Camera and recording mode that will shoot this plate"><option value="">Same as the shot (${vfxEsc(vfxShotCamName())})</option>${vfxCamOpts}</select></label>`}
      <div class="knobrow"><label for="vfx-over-${i}" title="How much wider than the shot frame the new plate is (each side, on the tighter axis)">Overscan</label><input id="vfx-over-${i}" data-k="over" data-i="${i}" type="number" min="0" max="100" step="1" data-unit="%" value="${s.over}"></div>
      <div class="knobrow"><span>Lens</span><div class="row nowrap"><label class="row" title="The longest lens that covers the shot frame plus the overscan"><input id="vfx-auto-${i}" data-k="auto" data-i="${i}" type="checkbox"${s.auto ? ' checked' : ''}> Auto</label><input id="vfx-f-${i}" data-k="focal" data-i="${i}" type="number" min="1" max="1000" step="1" data-unit="mm" value="${s.auto ? g.f : s.focal}"${s.auto ? ' disabled' : ''} aria-label="Lens to use"></div></div>
      <p class="note" id="vfx-note-${i}">${vfxNote(s, g)}</p>
    </div>`;
  }).join('');
  vfx.setups.forEach((s, i) => { if ($('vfx-cam-' + i)) $('vfx-cam-' + i).value = s.cam; });
  $('vfx-same').checked = vfx.sameCam;
  enhanceNumbers(box);
  if (focus && $(focus)) $(focus).focus();
  $('vfx-project').placeholder = vfxShotInfo().project || 'Project'; $('vfx-shot').placeholder = (vfx.shot ? '' : vfxShotInfo().shot) || 'Scene / shot';
  if (document.activeElement !== $('vfx-project')) $('vfx-project').value = vfx.project;
  if (document.activeElement !== $('vfx-shot')) $('vfx-shot').value = vfx.shot;
  if (document.activeElement !== $('vfx-bars')) $('vfx-bars').value = vfx.bars;
  VFX_FIELDS.forEach(([k]) => { $('vfx-f-' + k).checked = !!vfx.fields[k]; });
  $('vfx-text').value = vfx.text; $('vfx-font').value = vfx.font; $('vfx-align').value = vfx.align; $('vfx-talign').value = vfx.talign;
  vfxSimpleUI();
  $('vfx-st').textContent = `${vfx.setups.length} setup${vfx.setups.length > 1 ? 's' : ''}`;
}
{
  vfxBuild();
  $('vfx-fields').innerHTML = VFX_FIELDS.map(([k, n]) => `<label class="row"><input type="checkbox" id="vfx-f-${k}"> ${n}</label>`).join('');
  VFX_FIELDS.forEach(([k]) => $('vfx-f-' + k).onchange = (e) => { vfx.fields[k] = e.target.checked; vfxSave(); vfxRenderAll(true); });
  const box = $('vfx-setups');
  box.addEventListener('change', (e) => {
    const t = e.target, i = +t.dataset.i, k = t.dataset.k, s = vfx.setups[i]; if (!k || !s) return;
    if (k === 'name') { s.name = t.value.trim().slice(0, 40) || s.name; vfxSave(); vfxPanes(); vfxPanel(); vfxRenderAll(true); return; }
    if (k === 'auto') { s.auto = t.checked; if (!s.auto) s.focal = vfxGeom(Object.assign({}, s, { auto: true })).f; }
    else if (k === 'cam') s.cam = t.value;
    else if (k === 'over') s.over = Math.min(100, Math.max(0, +t.value || 0));
    else if (k === 'focal') s.focal = Math.min(1000, Math.max(1, Math.round(+t.value || s.focal)));
    vfxSave(); vfxPanel(); vfxRenderAll(true);
  });
  // en el momento: arrastrar o escribir Overscan y Lens redibuja sin esperar a soltar
  box.addEventListener('input', (e) => {
    const t = e.target, i = +t.dataset.i, k = t.dataset.k, s = vfx.setups[i]; if (!s || (k !== 'over' && k !== 'focal') || t.value === '' || !Number.isFinite(+t.value)) return;
    if (k === 'over') s.over = Math.min(100, Math.max(0, +t.value)); else s.focal = Math.min(1000, Math.max(1, Math.round(+t.value)));
    vfxSave(); vfxNotes(); vfxSoon();
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="del"]'); if (!b || vfx.setups.length < 2) return;
    vfx.setups.splice(+b.dataset.i, 1); vfxSave(); vfxPanes(); vfxPanel(); vfxRenderAll(true);
  });
  $('vfx-add').onclick = () => {
    const last = vfx.setups[vfx.setups.length - 1], n = vfxNew(vfx.setups.length);
    vfx.setups.push(Object.assign({}, last, { name: n.name })); vfxSave(); vfxPanes(); vfxPanel(); vfxRenderAll(true);
  };
  for (const ev of ['input', 'change']) {
    $('vfx-project').addEventListener(ev, (e) => { vfx.project = e.target.value.trim().slice(0, 60); vfxSave(); vfxSoon(); });
    $('vfx-shot').addEventListener(ev, (e) => { vfx.shot = e.target.value.trim().slice(0, 60); vfxSave(); vfxSoon(); });
  }
  // Text size y Font, globales, debajo de Info bars (el panel está en index.html; estos dos se arman acá)
  const bars = $('vfx-bars').closest('.knobrow'), sel = (id, label, tip, opts) => `<div class="knobrow"><label for="${id}" title="${tip}">${label}</label><select id="${id}" title="${tip}">${opts.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>`;
  bars.insertAdjacentHTML('afterend', sel('vfx-text', 'Text size', 'Size of the info letters', [['small', 'Small'], ['large', 'Large']]) + sel('vfx-font', 'Font', 'Letters of the info, like a camera monitor: Monitor (wide uppercase) or Mono (monospaced)', [['monitor', 'Monitor'], ['mono', 'Mono']])
    + sel('vfx-align', 'Info align', 'Where the camera data at the bottom sits: left, centered or right', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']])
    + sel('vfx-talign', 'Title align', 'Where the project and the shot sit in the top bar: left or centered (the setup name stays at the right)', [['left', 'Left'], ['center', 'Center']]));
  $('vfx-talign').addEventListener('change', (e) => { vfx.talign = e.target.value === 'center' ? 'center' : 'left'; vfxSave(); vfxRenderAll(true); });
  $('vfx-simple').onclick = () => { if (vfxToSimple()) { vfxPanel(); vfxRenderAll(true); } };
  $('vfx-align').addEventListener('change', (e) => { if (VFX_ALIGN.includes(e.target.value)) vfx.align = e.target.value; vfxSave(); vfxRenderAll(true); });
  // Same camera for all setups: arriba de los setups
  $('vfx-setups').insertAdjacentHTML('beforebegin', '<label class="row" for="vfx-same" title="Every setup shoots with the camera of the first one: the others do not ask for it, and a new setup takes it too"><input id="vfx-same" type="checkbox"> Same camera for all setups</label>');
  $('vfx-same').addEventListener('change', (e) => { vfx.sameCam = e.target.checked; vfxSave(); vfxPanel(); vfxRenderAll(true); });
  $('vfx-text').addEventListener('change', (e) => { if (VFX_TEXT[e.target.value]) vfx.text = e.target.value; vfxSave(); vfxRenderAll(true); });
  $('vfx-font').addEventListener('change', (e) => { if (VFX_FONT[e.target.value]) vfx.font = e.target.value; vfxSave(); vfxRenderAll(true); });
  // Inter puede no estar cargada en el primer dibujo: redibujar cuando llega
  if (document.fonts) document.fonts.ready.then(() => vfxSoon());
  $('vfx-bars').addEventListener('input', (e) => { vfx.bars = Math.min(1, Math.max(0, +e.target.value)); vfxSave(); vfxSoon(); });
  $('vfx-png-all').onclick = async () => { for (let i = 0; i < vfx.setups.length; i++) await vfxExport(i); };
}
// hook project: los setups viajan con el proyecto
function vfxProjectState() { return JSON.parse(JSON.stringify(vfxState())); }
function vfxApplyProject(o) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o.setups) && o.setups.length) vfx.setups = o.setups.map(vfxClean);
  if (Number.isFinite(o.bars)) vfx.bars = Math.min(1, Math.max(0, o.bars));
  vfx.project = String(o.project || ''); vfx.shot = String(o.shot || '');
  if (o.fields) VFX_FIELDS.forEach(([k]) => { vfx.fields[k] = o.fields[k] !== false; });
  if (VFX_TEXT[o.text]) vfx.text = o.text;
  if (VFX_FONT[o.font]) vfx.font = o.font;
  if (VFX_ALIGN.includes(o.align)) vfx.align = o.align;
  vfx.talign = o.talign === 'center' ? 'center' : 'left';
  vfx.sameCam = !!o.sameCam;
  vfxSave();
  if (vfx.on) { vfxPanes(); vfxPanel(); vfxRenderAll(true); } else vfxPanel();
}
