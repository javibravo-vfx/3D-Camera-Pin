// ---------- Resizable properties panel ----------
{
  const app = document.querySelector('.app'), sp = $('split');
  const clampW = (w) => Math.round(Math.min(Math.max(w, 320), Math.max(320, app.clientWidth * 0.6)));
  const setW = (w, save) => { w = clampW(w); app.style.setProperty('--side-w', w + 'px'); if (save) lsSet('sideW', w); };
  const saved = lsGet('sideW', null); if (saved) setW(saved, false);
  let sx = null, sw0 = 0;
  sp.addEventListener('pointerdown', e => { sx = e.clientX; sw0 = document.querySelector('aside.props').getBoundingClientRect().width; sp.setPointerCapture(e.pointerId); sp.classList.add('drag'); e.preventDefault(); });
  sp.addEventListener('pointermove', e => { if (sx !== null) setW(sw0 - (e.clientX - sx), false); });
  const end = () => { if (sx === null) return; sx = null; sp.classList.remove('drag'); lsSet('sideW', document.querySelector('aside.props').getBoundingClientRect().width); };
  sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
  sp.addEventListener('dblclick', () => setW(380 * uiScaleGet(), true)); // hook ui-scale
  sp.addEventListener('keydown', e => {
    const cur = document.querySelector('aside.props').getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') { setW(cur + 16, true); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setW(cur - 16, true); e.preventDefault(); }
  });
  window.addEventListener('resize', () => { const v = lsGet('sideW', null); if (v) setW(v, false); });
}
$('env-on').addEventListener('pointerdown', e => e.stopPropagation());
['pointerdown', 'wheel', 'dblclick'].forEach(t => $('vpbar').addEventListener(t, e => e.stopPropagation()));
function maskChanged() {
  $('mask-c').hidden = $('mask').value !== 'custom';
  lsSet('mask', { v: $('mask').value, c: $('mask-c').value });
  const a = maskAspect();
  $('exp-crop').disabled = !a;
  if (!a) $('exp-crop').checked = false;
  drawOverlay(); updateExport();
}
{ const m = lsGet('mask', null); if (m) { $('mask').value = m.v; $('mask-c').value = m.c; if (!$('mask').value) $('mask').value = '0'; } }
$('mask').onchange = maskChanged; $('mask-c').oninput = maskChanged;
$('exp-crop').onchange = updateExport;
$('t-fit').onclick = () => layoutStage(true);
$('t-fit3d').onclick = fit3D;
function fitKeyUI() { const l = FIT_LABEL[navPreset] || 'F'; $('fit3d-k').textContent = l.length > 1 ? '⇱' : l; $('t-fit3d').title = `Frame the scan in 3D (${l}, as in ${$('navp').selectedOptions[0]?.textContent || 'your DCC'})`; }
try { $('scan-more').open = !!lsGet('scanMore', false); } catch (e) {}
$('scan-more').addEventListener('toggle', () => lsSet('scanMore', $('scan-more').open));
navPreset = lsGet('nav', 'maya'); if (!NAV[navPreset]) navPreset = 'maya'; // un 'simple' guardado (ya no existe) vuelve a Maya
$('navp').value = navPreset;
// al elegir, el menú suelta el foco: si no, una letra (la S de volar con Game) elige otra opción del menú
$('navp').onchange = () => { navPreset = $('navp').value; lsSet('nav', navPreset); applyKnobNames(); fitKeyUI(); refreshAll(); $('navp').blur(); };
setTimeout(fitKeyUI, 0);
$('m-nav').onclick = () => setMode('nav');
$('m-pins').onclick = () => setMode('pins');
$('m-measure').onclick = () => setMode('measure');
// el modo de dibujo del scan: Flat (unlit) de arranque; Wireframe salió del menú (con scans de millones de triángulos no se dibujaba)
$('disp').value = lsGet('disp', 'flat'); if (!$('disp').value) $('disp').value = 'flat';
$('disp').onchange = () => { lsSet('disp', $('disp').value); applyDisplay(); };
$('opac').oninput = applyDisplay; $('ptsize').oninput = applyDisplay;
$('grid').onchange = () => { grid.visible = $('grid').checked; render(); };

$('back').onclick = () => shotBack(); // js/navigation.js: Recall cam
$('store-cam').onclick = () => storeCam();
// More, en la barra angosta (css/app.css): Viewer, Mask, los botones de pins y el formato, encima del visor.
// Se cierra con un click afuera o Esc (el Esc no sigue: no desarma también una herramienta del bokeh). Durante un
// recorrido lo abre y lo cierra el recorrido (tourOpenSection, js/tour.js), no los clicks en la capa oscura.
const vbTouring = () => typeof tour !== 'undefined' && tour.on;
function vbMore(on) { document.querySelector('.vbar').classList.toggle('more', on); $('vb-more').setAttribute('aria-expanded', String(on)); }
$('vb-more').onclick = (e) => {
  const on = !document.querySelector('.vbar').classList.contains('more'); vbMore(on);
  if (on && e.detail === 0) { const f = $('vrow2').querySelector('select:not(:disabled), button:not(:disabled)'); if (f) f.focus(); } // con el teclado, el foco entra
};
document.addEventListener('pointerdown', e => { if (!vbTouring() && !e.target.closest('#vrow2, #vb-more')) vbMore(false); }, true);
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !vbTouring() && document.querySelector('.vbar.more')) { e.stopImmediatePropagation(); e.preventDefault(); vbMore(false); $('vb-more').focus(); } }, true);
// al ensanchar la ventana More desaparece: que no reaparezca abierto al volver a achicarla
new ResizeObserver(() => { if (!$('vb-more').offsetParent && document.querySelector('.vbar.more')) vbMore(false); }).observe(document.querySelector('.viewer'));
$('f-scan').onchange = e => { const f = objTakeFiles([...e.target.files])[0]; if (f) loadScanFile(f); e.target.value = ''; }; // hook obj-stream: OBJ con su .mtl e imagen
$('f-plate').onchange = e => { const f = e.target.files[0]; if (f) loadPlateFile(f); e.target.value = ''; };
$('unit').onchange = () => { setRootTransform(+$('unit').value, st.userScale, st.up); st.scaleOk = false; measWorld(); updateMeasureGeo(); refreshAll(); };
$('up').onchange = () => { if (st.scanKind === 'splat') lsSet('upSplat', $('up').value); else if (/\.ply$/i.test(st.scanName)) lsSet('upPly', $('up').value); setRootTransform(st.unit, st.userScale, $('up').value, false); measWorld(); updateMeasureGeo(); refreshAll(); }; // hook splat: eje propio de los splats (upSplat)
$('real').oninput = updateMeasureGeo;
function applyScaleFrom(real) {
  if (!st.measure.a || !st.measure.b || measEnv()) return;
  const d = st.measure.a.distanceTo(st.measure.b);
  if (!(d > 0 && real > 0)) return;
  $('real').value = real; $('mpop-real').value = real;
  setRootTransform(st.unit, st.userScale * real / d, st.up);
  measWorld(); updateMeasureGeo(); st.scaleOk = true; refreshAll();
}
$('apply-scale').onclick = () => applyScaleFrom(+$('real').value);
$('mpop-ok').onclick = () => applyScaleFrom(+$('mpop-real').value);
$('mpop-real').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); applyScaleFrom(+$('mpop-real').value); }
  if (e.key === 'Escape') { e.preventDefault(); clearMeasure(); }
  e.stopPropagation();
});
$('mpop-real').addEventListener('input', () => drawOverlay());
function clearMeasure() { st.measure = { a: null, b: null }; updateMeasureGeo(); drawOverlay(); }
$('mpop-x').onclick = clearMeasure;
['pointerdown', 'wheel'].forEach(t => $('mpop').addEventListener(t, e => e.stopPropagation()));
function setScanRotation(r) {
  st.rot = r.map(v => +(((v % 360) + 540) % 360 - 180).toFixed(3));
  ['x', 'y', 'z'].forEach((a, i) => { if (document.activeElement !== $('rot-' + a)) $('rot-' + a).value = st.rot[i]; });
  setRootTransform(st.unit, st.userScale, st.up, false);
  measWorld(); updateMeasureGeo(); refreshAll();
}
['x', 'y', 'z'].forEach((a, i) => $('rot-' + a).addEventListener('change', () => { const v = +$('rot-' + a).value; if (Number.isFinite(v)) { const r = (st.rot || [0, 0, 0]).slice(); r[i] = v; setScanRotation(r); } }));
$('rot-flip').onclick = () => { const r = (st.rot || [0, 0, 0]).slice(); r[0] += 180; setScanRotation(r); };
$('scale-in').addEventListener('change', () => {
  const v = +$('scale-in').value; if (!(v > 0)) { $('scale-in').value = +st.userScale.toFixed(6); return; }
  setRootTransform(st.unit, v, st.up); measWorld(); updateMeasureGeo(); refreshAll();
});
$('scale-in').addEventListener('keydown', e => { if (e.key === 'Enter') $('scale-in').blur(); });
$('reset-scale').onclick = () => { setRootTransform(st.unit, 1, st.up); measWorld(); updateMeasureGeo(); st.scaleOk = false; refreshAll(); };
$('scale-ok').onclick = () => { st.scaleOk = true; refreshAll(); };
const pre = $('preset');
pre.innerHTML = PRESETS.map(p => `<option value="${p[0]}">${p[1]}${p[2] ? ` (${p[2].toFixed(2)} × ${p[3].toFixed(2)})` : ''}</option>`).join('');
function setSensor(w, h, fromPreset) {
  st.sw = w; $('sw').value = w;
  if (!st.shAuto && h) { st.sh = h; $('sh').value = h; }
  if (!fromPreset) { st.preset = 'custom'; pre.value = 'custom'; }
  lsSet('sensor', { preset: st.preset, sw: w, sh: h });
  applyIntrinsics(); checkAspect(); if (st.pins.length) solveLive(false); refreshAll();
}
pre.onchange = () => { const p = PRESETS.find(x => x[0] === pre.value); st.preset = p[0]; if (p[2]) setSensor(p[2], p[3], true); };
$('sw').onchange = () => { const v = +$('sw').value; if (v > 0) setSensor(v, st.sh, false); };
$('sh').onchange = () => { const v = +$('sh').value; if (v > 0) { st.sh = v; checkAspect(); refreshAll(); } };
$('sh-auto').onchange = () => {
  st.shAuto = $('sh-auto').checked; $('sh').disabled = st.shAuto;
  if (!st.shAuto && !(st.sh > 0)) st.sh = +autoSh().toFixed(3);
  $('sh').value = st.shAuto ? (+autoSh().toFixed(3)) : st.sh;
  checkAspect(); refreshAll();
};
function setPar(v, keepCam) { // keepCam: al abrir un proyecto la cámara guardada manda, no un re-solve
  st.par = v > 0 ? v : 1; $('par').value = st.par;
  $('par-note').textContent = Math.abs(st.par - 1) < 1e-6 ? 'square' : `${(st.plate.W * st.par / st.plate.H).toFixed(2)}:1 desqueezed`;
  $('tag').textContent = st.plate.W + ' × ' + st.plate.H + (st.par !== 1 ? ' · PAR ' + st.par : '');
  applyIntrinsics(); layoutStage(true); if (st.pins.length && !keepCam) solveLive(true); refreshAll();
}
$('par').onchange = () => setPar(+$('par').value);
// knob names follow the chosen DCC
const KNOB_NAMES = {
  max: ['Film width (mm)', 'Film height (mm)', 'Focal length (mm)', 'Pixel aspect'],
  maya: ['H film aperture (mm)', 'V film aperture (mm)', 'Focal length (mm)', 'Pixel aspect ratio'],
  houdini: ['Aperture (mm)', 'Vert. aperture (mm)', 'Focal length (mm)', 'Pixel aspect ratio'],
  blender: ['Sensor width (mm)', 'Sensor height (mm)', 'Focal length (mm)', 'Aspect X'],
  nuke: ['haperture (mm)', 'vaperture (mm)', 'focal (mm)', 'pixel aspect'],
  game: ['Film back width (mm)', 'Film back height (mm)', 'Focal (mm)', 'Pixel aspect'],
};
function applyKnobNames() {
  const n = KNOB_NAMES[navPreset] || KNOB_NAMES.nuke;
  ['lb-sw', 'lb-sh', 'lb-focal', 'lb-par'].forEach((id, i) => $(id).textContent = n[i].replace(/\s*\(mm\)/, ''));
  $('lb-sw').title = navPreset === 'maya' ? 'Maya shows the film aperture in inches: divide by 25.4' : '';
}
$('focal').onchange = () => { const v = +$('focal').value; if (v > 0) { st.focal = v; st.fScale = 1; lsSet('focal', v); applyIntrinsics(); if (st.pins.length) solveLive(true); refreshAll(); } };
$('free').onchange = () => { st.freeF = $('free').checked; st.fScale = 1; applyIntrinsics(); if (st.pins.length) solveLive(true); refreshAll(); };
$('lock-f').onchange = () => { $('free').checked = !$('lock-f').checked; $('free').onchange(); };
$('lock-tr').onchange = () => { st.lockTR = $('lock-tr').checked; lsSet('lockTR', st.lockTR); if (st.pins.length) solveLive(true); refreshAll(); };
$('lock-tr').checked = st.lockTR = !!lsGet('lockTR', false);
function clearPinsKeepCam() { if (st.pins.length) pushHistory(); st.pins = []; st.sel = -1; st.rms = null; refreshAll(); }
$('tb-bake').onclick = bakeToggle;
$('t-undo').onclick = undo; $('t-redo').onclick = redo;
$('tb-clear').onclick = clearPinsKeepCam;
$('solve').onclick = () => { pushHistory(); solveLive(true); refreshAll(); };
$('clear-pins').onclick = () => clearPinsKeepCam();
$('pinlist').addEventListener('click', e => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  const i = +li.dataset.i;
  if (e.target.matches('.x')) { pushHistory(); st.pins.splice(i, 1); st.sel = -1; solveLive(false); }
  else if (e.target.matches('input')) { pushHistory(); st.pins[i].on = e.target.checked; solveLive(true); }
  else st.sel = i;
  refreshAll();
});
$('target').onchange = () => { lsSet('target', $('target').value); updateExport(); };
$('camname').oninput = updateExport;
$('copy').onclick = () => {
  const ta = $('out');
  const done = (ok) => { $('copy-msg').textContent = ok ? 'Copied' : 'Selected: copy it with Ctrl+C'; setTimeout(() => $('copy-msg').textContent = '', 2500); };
  try {
    navigator.clipboard.writeText(ta.value).then(() => done(true), () => { ta.focus(); ta.select(); done(false); });
  } catch (err) { ta.focus(); ta.select(); done(false); }
};

// ---------- Camera height / scan offset / orientation ----------
$('scan-y').addEventListener('change', () => { const v = +$('scan-y').value; if (Number.isFinite(v)) shiftVertical(v - (st.scanY || 0)); });
$('scan-sit').onclick = () => { const f = st.scanKind === 'splat' ? splatFloorY() : st.scanKind === 'mesh' ? scanMeshFloorY() /* hook obj-stream */ : null; if (f != null) return shiftVertical(-f); /* hook splat: la calle del splat */ const b = new THREE.Box3().setFromObject(scanRoot); if (!b.isEmpty()) shiftVertical(-b.min.y); };
$('orient-apply').onclick = () => camRenderMeta(camApplyPlateMeta()); // hook camera
$('meta-kv').addEventListener('click', e => {
  const dd = e.target.closest('dd.pickf'); if (!dd) return;
  const v = +dd.dataset.f; st.focal = v; st.fScale = 1; $('focal').value = v; lsSet('focal', v);
  applyIntrinsics(); if (st.pins.length) solveLive(true); refreshAll();
});
$('orient-auto').checked = lsGet('orientAuto', true);
$('orient-auto').onchange = () => lsSet('orientAuto', $('orient-auto').checked);
// ---------- Number fields: unit suffix + drag to scrub ----------
function enhanceNumbers(root) {
  root.querySelectorAll('input[type=number]:not([data-enh])').forEach(inp => {
    if (inp.closest('.mpop') || inp.id === 'mask-c') return;
    inp.dataset.enh = '1';
    const noScrub = !!inp.dataset.noscrub;
    const w = document.createElement('span'); w.className = 'num';
    inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
    if (inp.dataset.unit) { w.classList.add('has-u'); const u = document.createElement('span'); u.className = 'u'; u.textContent = inp.dataset.unit; w.appendChild(u); }
    let sx = null, start = 0, moved = false;
    const dec = () => { const t = String(inp.step || '0.01'); return t.includes('.') ? t.split('.')[1].length : 0; };
    inp.addEventListener('pointerdown', e => {
      if (noScrub || inp.disabled || document.activeElement === inp || e.button !== 0) return;
      e.preventDefault(); sx = e.clientX; start = parseFloat(inp.value) || 0; moved = false; inp.setPointerCapture(e.pointerId);
    });
    inp.addEventListener('pointermove', e => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true; w.classList.add('scrubbing');
      const stp = parseFloat(inp.step) || 0.01, k = e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1;
      let v = start + dx * stp * k;
      if (inp.min !== '') v = Math.max(+inp.min, v);
      if (inp.max !== '') v = Math.min(+inp.max, v);
      inp.value = +v.toFixed(dec() + (e.shiftKey ? 1 : 0));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const end = () => {
      if (sx === null) return; sx = null; w.classList.remove('scrubbing');
      if (!moved) { inp.focus(); inp.select(); }
    };
    inp.addEventListener('pointerup', end); inp.addEventListener('pointercancel', end);
    // Nuke-style: arrow up/down nudges by one step (Shift x10, Alt x0.1)
    inp.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); e.stopPropagation();
      const stp = (parseFloat(inp.step) || 0.01) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      let v2 = (parseFloat(inp.value) || 0) + (e.key === 'ArrowUp' ? stp : -stp);
      if (inp.min !== '') v2 = Math.max(+inp.min, v2);
      if (inp.max !== '') v2 = Math.min(+inp.max, v2);
      inp.value = +v2.toFixed(dec() + (e.altKey ? 1 : 0));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}
enhanceNumbers(document);
// double-click a slider: back to its default (captured from the markup at load)
document.querySelectorAll('input[type=range]').forEach(r => { if (r.dataset.def === undefined) r.dataset.def = r.getAttribute('value') ?? r.value; });
document.addEventListener('dblclick', e => {
  const r = e.target.closest('input[type=range]'); if (!r) return;
  r.value = r.dataset.def ?? r.getAttribute('value');
  r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
}, true);
// viewer exposure (plate only, display gain in stops)
function setGain() {
  const v = +$('vgain').value;
  $('vgain-v').textContent = (v >= 0 ? '+' : '') + v.toFixed(1);
  $('stage').style.setProperty('--gain', Math.pow(2, v).toFixed(4));
}
$('vgain').oninput = setGain;
// ---------- Apply T/R, angle scrub, reset all ----------
// con pins, el solve manda sobre tilt y roll: primero hay que bakear y limpiar los pins
$('tb-apply-tr').onclick = () => {
  const o = st.metaOrient; if (!o) return;
  if (st.pins.length) { toast('The pins drive tilt and roll: Bake pins and Clear pins first to import the EXR metadata', true); return; }
  applyOrientation({ tilt: o.tilt, roll: o.roll });
};
{
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(refreshAll, 150); };
  ['tilt', 'roll', 'yaw'].forEach(k => $('ang-' + k).addEventListener('change', e => {
    const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return;
    const a = camAngles(); a[k] = v; const r = Math.PI / 180;
    camera.quaternion.setFromEuler(new THREE.Euler(a.tilt * r, a.yaw * r, a.roll * r, 'YXZ'));
    navRetarget(); navChanged(); later();
  }));
  // camera height: moves only the camera (and its orbit target), not the scan
  $('cam-h').addEventListener('change', e => {
    const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return;
    const d = v - camera.position.y; camera.position.y += d; nav.target.y += d;
    navChanged(); later();
  });
  $('tb-focal').addEventListener('change', e => {
    const v = parseFloat(e.target.value); if (!(v > 0)) return;
    st.focal = v; st.fScale = 1; $('focal').value = v; lsSet('focal', v); applyIntrinsics();
    if (st.pins.length) solveLive(true);
    later();
  });
  $('tb-apply-f').onclick = () => {
    if (!st.metaFocal) return;
    st.focal = +st.metaFocal.toFixed(3); st.fScale = 1; $('focal').value = st.focal; applyIntrinsics();
    if (st.pins.length) solveLive(true);
    refreshAll(); toast(`Focal ${fmt(st.focal, 2)} mm from the plate metadata`);
  };
  ['cam-h', 'ang-tilt', 'ang-roll', 'ang-yaw', 'tb-focal'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); e.target.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); refreshAll(); }
    e.stopPropagation();
  }));
}
// Reset all (el botón): todo a como viene, en todas las pestañas: se borra lo que la app guardó en el navegador (ajustes,
// visores, Motion, 3D Render, el tamaño de letra) y se recarga. El progreso de los recorridos no se toca.
function resetAllHard() {
  lsOff = true;
  try { if (lsMem) lsMem.clear(); else for (const k of Object.keys(localStorage)) if (k.startsWith('pinmatch.')) localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ }
  location.reload();
}
function resetAll(keepPrefs) {
  hist.undo.length = 0; hist.redo.length = 0; histUI();
  st.pendingProject = null; $('relink').hidden = true;
  if (typeof projAuto !== 'undefined') { projAuto.gen++; projAuto.busy = false; } // hook project: corta la carga sola de un proyecto anterior
  // pins, measure, solve
  st.pins = []; st.sel = -1; st.rms = null; st.solved = null; st.nextId = 1; shotNav.cam = null; shotNav.end = null; shotNav.stored = false; shotUI();
  st.measure = { a: null, b: null }; updateMeasureGeo();
  // plate
  exrState = null; st.metaOrient = null; st.metaCamera = null; st.metaFocal = null; $('stage').classList.remove('noplate'); $('plate-on').setAttribute('aria-pressed', 'true');
  plateImg.removeAttribute('src'); plateImg.hidden = true; $('platecv').hidden = true;
  vplClear(); // hook video-plate
  setKey({ on: false });
  $('exr-box').hidden = true; $('orient-row').hidden = true; $('orient-auto-row').hidden = true; $('meta-msg').hidden = true; $('aspect-msg').hidden = true;
  $('cs').value = 'disp'; $('cs').disabled = true;
  st.plate = { W: 1920, H: 1080, name: '', sample: false, empty: true };
  // camera defaults
  st.preset = 'alexa-lf-og'; pre.value = st.preset; st.sw = 36.70; st.sh = 25.54; st.shAuto = true; $('sh-auto').checked = true; $('sh').disabled = true;
  $('sw').value = st.sw; st.focal = 35; st.fScale = 1; $('focal').value = 35;
  st.freeF = false; $('free').checked = false; st.lockTR = false; $('lock-tr').checked = false; lsSet('lockTR', false);
  st.par = 1; $('par').value = 1; $('par-note').textContent = 'square';
  if (!keepPrefs) { lsSet('sensor', null); lsSet('focal', null); st._saved = null; }
  // scan
  clearScan(); st.scanName = ''; st.scanFmt = null; st.sample = false;
  st.scanY = 0; $('scan-y').value = 0; st.scaleOk = false; $('real').value = '';
  st.rot = [0, 0, 0]; ['x', 'y', 'z'].forEach(a => $('rot-' + a).value = 0);
  $('unit').value = '1'; $('up').value = 'y'; st.unit = 1; st.userScale = 1; st.up = 'y';
  scanRoot.position.set(0, 0, 0); scanRoot.quaternion.identity(); scanRoot.scale.set(1, 1, 1); scanRoot.updateMatrixWorld(true);
  $('scan-name').textContent = 'No scan'; $('scan-kv').innerHTML = ''; $('unit-msg').hidden = true;
  ['dx', 'dy', 'dz'].forEach(id => $(id).textContent = '–'); $('scan-sum').textContent = 'Size, measure & scale';
  $('tex-name').textContent = 'from file'; $('tex-clear').hidden = true;
  // view
  $('mask').value = '0'; $('exp-crop').checked = false; maskChanged();
  envSelect('none');
  $('plate-name').textContent = 'No plate';
  $('tag').textContent = 'NO PLATE';
  camera.position.set(4, 2.2, 6); camera.lookAt(0, 0.8, 0); nav.target.set(0, 0.8, 0);
  layoutStage(true); applyIntrinsics(); checkAspect();
  $('empty').hidden = false;
  if (!keepPrefs && typeof bokehReset === 'function') bokehReset(); // hook bokeh
  if (typeof sceneSt !== 'undefined') { sceneSt.figures = []; sceneSt.sel = 0; sceneSt.nextFig = 1; } // hook scene: figuras fuera (también al cargar la demo)
  if (typeof drvClear === 'function') drvClear(); // hook drive-plate
  if (typeof dlReset === 'function') dlReset(); // hook delivery: el reencuadre era de la toma anterior
  if (typeof r3dReset === 'function') r3dReset(keepPrefs); // hook render3d: los materiales editados (y, con Reset all, todo 3D Render)
  refreshAll();
}
{
  const b = $('reset-all'); let t = 0;
  b.onclick = () => {
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Click again to clear'; t = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Reset all'; }, 3000); return; }
    clearTimeout(t); b.classList.remove('armed'); b.textContent = 'Reset all'; resetAllHard();
  };
}
