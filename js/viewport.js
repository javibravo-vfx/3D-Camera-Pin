// ---------- Stage layout / 2D view ----------
function layoutStage(reset) {
  const r = vp.getBoundingClientRect();
  const m = 18, a = st.plate.W * par() / st.plate.H;
  // encajado debajo de la barra de chips: no tapa el borde de arriba del plate ni sus rótulos
  const bar = $('vpbar'), top = Math.max(m, bar.offsetTop + bar.offsetHeight + 6), ah = r.height - top - m;
  let bw = Math.max(50, r.width - m * 2), bh = bw / a;
  if (bh > ah) { bh = Math.max(40, ah); bw = bh * a; }
  const v = st.view;
  v.baseW = bw; v.baseH = bh;
  if (reset) { v.zoom = 1; v.x = (r.width - bw) / 2; v.y = top + (ah - bh) / 2; }
  stage.style.width = bw + 'px'; stage.style.height = bh + 'px';
  applyView();
}
function applyView() {
  const v = st.view;
  stage.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  stage.classList.toggle('pix', v.zoom > 2.5);
  const dpr = window.devicePixelRatio || 1;
  const pr = Math.min(dpr * v.zoom, 4096 / v.baseW, 4096 / v.baseH, 4);
  renderer.setPixelRatio(pr);
  renderer.setSize(v.baseW, v.baseH, false);
  envRenderer.setPixelRatio(pr); envRenderer.setSize(v.baseW, v.baseH, false);
  render(); drawOverlay();
}
// plate pixel <-> viewport css coords
function uvToVp(u, v) { const s = st.view; return [s.x + u / st.plate.W * s.baseW * s.zoom, s.y + v / st.plate.H * s.baseH * s.zoom]; }
function vpToUv(x, y) { const s = st.view; return [(x - s.x) / (s.baseW * s.zoom) * st.plate.W, (y - s.y) / (s.baseH * s.zoom) * st.plate.H]; }
function evVp(e) { const r = vp.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function projectWorld(p) {
  const v = p.clone().project(camera);
  const inFront = new THREE.Vector3().copy(p).applyMatrix4(camera.matrixWorldInverse).z < 0;
  return { u: (v.x + 1) / 2 * st.plate.W, v: (1 - v.y) / 2 * st.plate.H, front: inFront };
}

// ---------- Raycast ----------
const ray = new THREE.Raycaster();
function pick(x, y) {
  if (!scanObj || !scanRoot.visible) return null;
  const [u, v] = vpToUv(x, y);
  const ndc = new THREE.Vector2(u / st.plate.W * 2 - 1, -(v / st.plate.H * 2 - 1));
  camera.updateMatrixWorld();
  ray.setFromCamera(ndc, camera);
  // point threshold: ~5 px in world at hit distance, approximated with scene size
  const ctr = new THREE.Box3().setFromObject(scanRoot).getCenter(new THREE.Vector3());
  const dist = Math.max(camera.position.distanceTo(ctr), 1e-3);
  const pxPlate = 6 / (st.view.baseH * st.view.zoom) * st.plate.H;
  const worldPerPx = 2 * dist * Math.tan(camera.fov * Math.PI / 360) / st.plate.H;
  ray.params.Points.threshold = Math.max(worldPerPx * pxPlate, 1e-5);
  const hits = ray.intersectObject(scanRoot, true).filter(h => (h.object.visible || h.object.userData.pickProxy) && (h.object.isMesh || h.object.isPoints) && !h.object.userData.isSplat);
  if (!hits.length) return null;
  let h = hits[0];
  if (h.object.isPoints) {
    // among close hits prefer the one closest to the ray
    const near = hits.filter(x => x.object.isPoints && x.distance < h.distance * 1.03);
    h = near.reduce((a, b) => (b.distanceToRay < a.distanceToRay ? b : a), h);
  }
  return h.point.clone();
}

function pickEnv(x, y) {
  if (!envRoot.visible || !envRoot.children.length) return null;
  const [u, v] = vpToUv(x, y);
  const ndc = new THREE.Vector2(u / st.plate.W * 2 - 1, -(v / st.plate.H * 2 - 1));
  camera.updateMatrixWorld(); envRoot.updateMatrixWorld(true);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(envRoot, true).filter(h => h.object.isMesh && h.object.visible);
  return hits.length ? hits[0].point.clone() : null;
}
// measure picks the scan or the environment (cars, road), whichever is nearer
function pickMeasure(x, y) {
  const a = pick(x, y), b = pickEnv(x, y);
  if (a && b) return camera.position.distanceTo(a) <= camera.position.distanceTo(b) ? { p: a, env: false } : { p: b, env: true };
  return a ? { p: a, env: false } : b ? { p: b, env: true } : null;
}

// ---------- Pins & solving ----------
function pinWorld(p) { return scanRoot.localToWorld(p.local.clone()); }
function activePins() { return st.pins.filter(p => p.on).map(p => { const w = pinWorld(p); return { X: [w.x, w.y, w.z], uv: p.uv, ref: p }; }); }
function solveLive(full) {
  const pins = activePins();
  if (!pins.length) { st.rms = null; return; }
  let pose = poseFromCamera();
  const k = K();
  const sc = sceneSize() * 0.1;
  const lock = !!st.lockTR;
  const freeF = st.freeF && pins.length >= (lock ? 4 : 6);
  const mode = pins.length >= (lock ? 2 : 3) ? 'full' : 'rot';
  let best = Solver.refine(pose, k, pins, { mode, freeFocal: freeF, lockTR: lock, iters: full ? 200 : 25, sceneScale: sc });
  if (full && !lock && pins.length >= 6) {
    const d = Solver.dlt(k, pose.f, pins);
    if (d) {
      const r2 = Solver.refine({ ...d, f: pose.f }, k, pins, { mode: 'full', freeFocal: freeF, iters: 200, sceneScale: sc });
      if (r2.rms < best.rms) best = r2;
    }
  }
  cameraFromPose(best);
  st.rms = best.rms;
  const errs = Solver.errorsOf(best, k, pins);
  pins.forEach((p, i) => p.ref.err = errs[i]);
  st.pins.filter(p => !p.on).forEach(p => {
    const q = projectWorld(pinWorld(p)); p.err = q.front ? Math.hypot(q.u - p.uv[0], q.v - p.uv[1]) : Infinity;
  });
  if (pins.length >= (lock ? 2 : 3)) { st.solved = { R: best.R, C: best.C, f: best.f }; $('back').disabled = false; }
}
// RMS y error de cada pin con la cámara de AHORA (lo llama drawOverlay): mover la cámara por cualquier lado
// (campos, arrastres, escena, navegación) actualiza la lectura, no queda la del último solve
function pinErrRefresh() {
  const ap = activePins();
  if (ap.length) {
    const pose = poseFromCamera(), k = K(), errs = Solver.errorsOf(pose, k, ap);
    ap.forEach((q, i) => q.ref.err = errs[i]);
    st.rms = Solver.rmsOf(pose, k, ap);
  } else st.rms = null;
  st.pins.filter(p => !p.on).forEach(p => { const q = projectWorld(pinWorld(p)); p.err = q.front ? Math.hypot(q.u - p.uv[0], q.v - p.uv[1]) : Infinity; });
  const on = ap.length;
  $('s3').dataset.state = on >= 4 && st.rms != null && st.rms < 3 ? 'ok' : 'warn';
  $('s3st').textContent = `${on} pin${on === 1 ? '' : 's'}` + (st.rms != null && on ? ` · ${fmt(st.rms, 2)} px` : '');
  document.querySelectorAll('#pinlist li[data-i] .err').forEach(e => { const p = st.pins[+e.parentNode.dataset.i]; if (p) { e.textContent = Number.isFinite(p.err) ? fmt(p.err, 2) + ' px' : '–'; e.className = 'err ' + errClass(p.err); } });
}
// ---------- Pin history (undo / redo) ----------
const hist = { undo: [], redo: [] };
function snapPins() {
  camera.updateMatrixWorld();
  return {
    pins: st.pins.map(p => ({ id: p.id, local: p.local.clone(), uv: p.uv.slice(), on: p.on, baked: !!p.baked, err: p.err })),
    nextId: st.nextId, sel: st.sel, rms: st.rms,
    solved: st.solved ? JSON.parse(JSON.stringify(st.solved)) : null,
    cam: { p: camera.position.clone(), q: camera.quaternion.clone(), t: nav.target.clone(), f: st.fScale },
  };
}
function pushHistory() {
  hist.undo.push(snapPins()); if (hist.undo.length > 80) hist.undo.shift();
  hist.redo.length = 0; histUI();
}
function restorePins(sn) {
  st.pins = sn.pins.map(p => ({ ...p, local: p.local.clone(), uv: p.uv.slice() }));
  st.nextId = sn.nextId; st.sel = sn.sel; st.rms = sn.rms; st.solved = sn.solved;
  camera.position.copy(sn.cam.p); camera.quaternion.copy(sn.cam.q); nav.target.copy(sn.cam.t); camera.updateMatrixWorld(true);
  st.fScale = sn.cam.f; applyIntrinsics();
  $('back').disabled = !st.solved;
  refreshAll(); histUI();
}
// deshacer no fija una cámara nueva de la toma (Recall cam sigue volviendo a la de antes de navegar)
function undo() { if (!hist.undo.length) return; hist.redo.push(snapPins()); restorePins(hist.undo.pop()); shotNav.end = camSnap(); }
function redo() { if (!hist.redo.length) return; hist.undo.push(snapPins()); restorePins(hist.redo.pop()); shotNav.end = camSnap(); }
function histUI() { $('t-undo').disabled = !hist.undo.length; $('t-redo').disabled = !hist.redo.length; }
function bakeToggle() {
  if (!st.pins.length) return;
  pushHistory();
  const anyLoose = st.pins.some(p => !p.baked);
  st.pins.forEach(p => p.baked = anyLoose);
  refreshAll();
}
function errClass(e) { return !Number.isFinite(e) ? 'e-bad' : e < 1 ? 'e-ok' : e < 3 ? 'e-warn' : 'e-bad'; }

// ---------- Overlay ----------
const NS = 'http://www.w3.org/2000/svg';
function drawOverlay() {
  let h = '';
  camera.updateMatrixWorld();
  // measure: rubber band while placing the 2nd point, popup with the real length once both exist
  const pop = $('mpop');
  let showPop = false;
  if (st.mode !== 'pins' && st.measure.a && (typeof mtabCur === 'undefined' || mtabCur !== 'import')) { // Import mide en su cuadro
    const endW = st.measure.b || st.measure.hover;
    if (endW) {
      const a = projectWorld(st.measure.a), b = projectWorld(endW);
      if (a.front && b.front) {
        const [ax, ay] = uvToVp(a.u, a.v), [bx, by] = uvToVp(b.u, b.v);
        const d = st.measure.a.distanceTo(endW);
        h += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#ffb238" stroke-width="2" ${st.measure.b ? '' : 'stroke-dasharray="6 4"'}/>`;
        for (const [x, y] of [[ax, ay], [bx, by]]) h += `<circle cx="${x}" cy="${y}" r="4.5" fill="#ffb238" stroke="#1d1d1d" stroke-width="1.5"/>`;
        if (st.measure.b) {
          showPop = true;
          pop.style.left = (ax + bx) / 2 + 'px'; pop.style.top = (ay + by) / 2 + 'px';
          $('mpop-d').textContent = d.toFixed(3) + ' m';
          pop.classList.toggle('envm', measEnv());
          const real = +$('mpop-real').value;
          pop.classList.toggle('done', real > 0 && Math.abs(d - real) < 5e-4);
        } else {
          const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
          h += `<text x="${mx}" y="${my - 10}" text-anchor="middle" fill="#ffb238" stroke="#1d1d1d" stroke-width="3" paint-order="stroke" font-family="SF Mono, Menlo, Consolas, monospace" font-size="12">${d.toFixed(3)} m</text>`;  // hook style: números con la mono de LGA
        }
      } else if (st.measure.b) showPop = false;
    } else {
      const a = projectWorld(st.measure.a);
      if (a.front) { const [ax, ay] = uvToVp(a.u, a.v); h += `<circle cx="${ax}" cy="${ay}" r="4.5" fill="#ffb238" stroke="#1d1d1d" stroke-width="1.5"/>`; }
    }
  }
  pop.hidden = !showPop;
  // con Compare with the 3D prendido (js/ghost.js) los pins del solve quedan tenues: tapan las líneas del 3D;
  // con la herramienta Pins activa se ven enteros
  const pinsQuiet = typeof gh !== 'undefined' && gh.on && st.mode !== 'pins', pin0 = h.length;
  // los pins se ven sólo en la pestaña 3D Camera Pin (js/module-tabs.js)
  if ((st.mode === 'pins' || st.pins.length) && (typeof mtabCur === 'undefined' || mtabCur === 'camerapin')) {
    st.pins.forEach((p, i) => {
      const q = projectWorld(pinWorld(p));
      const [tx, ty] = uvToVp(p.uv[0], p.uv[1]);
      const sel = i === st.sel;
      const col = !p.on ? '#8a96a6' : p.baked ? '#b3a8ff' : '#ffb238';
      if (q.front) {
        const [px, py] = uvToVp(q.u, q.v);
        h += `<line x1="${tx}" y1="${ty}" x2="${px}" y2="${py}" stroke="#ff6d5f" stroke-width="1.5"/>`;
        h += `<circle cx="${px}" cy="${py}" r="2.6" fill="#5ccfe0"/>`;
      }
      h += `<circle cx="${tx}" cy="${ty}" r="${sel ? 8 : 7}" fill="none" stroke="#0f1216" stroke-width="3.5"/>`;
      h += `<circle cx="${tx}" cy="${ty}" r="${sel ? 8 : 7}" fill="none" stroke="${col}" stroke-width="${sel ? 2.2 : 1.6}"/>`;
      h += `<line x1="${tx - 3}" y1="${ty}" x2="${tx + 3}" y2="${ty}" stroke="${col}"/><line x1="${tx}" y1="${ty - 3}" x2="${tx}" y2="${ty + 3}" stroke="${col}"/>`;
      h += `<text x="${tx + 10}" y="${ty - 8}" fill="${col}" stroke="#0f1216" stroke-width="3" paint-order="stroke" font-family="SF Mono, Menlo, Consolas, monospace" font-size="11.5">${p.id}</text>`;  // hook style: números con la mono de LGA
    });
  }
  if (pinsQuiet && h.length > pin0) h = h.slice(0, pin0) + `<g opacity=".22">${h.slice(pin0)}</g>`;
  const ma = maskAspect();
  if (ma) {
    const c = maskRect();
    const [x0, y0] = uvToVp(0, 0), [x1, y1] = uvToVp(st.plate.W, st.plate.H);
    const [cx0, cy0] = uvToVp(c.x, c.y), [cx1, cy1] = uvToVp(c.x + c.w, c.y + c.h);
    h = `<path d="M${x0} ${y0}H${x1}V${y1}H${x0}Z M${cx0} ${cy0}V${cy1}H${cx1}V${cy0}Z" fill="rgb(0 0 0 / .6)" fill-rule="evenodd"/>`
      + `<rect x="${cx0}" y="${cy0}" width="${cx1 - cx0}" height="${cy1 - cy0}" fill="none" stroke="#e8e8e8" stroke-opacity=".8" stroke-width="1"/>`
      + `<text x="${cx1 - 6}" y="${cy0 + 15}" text-anchor="end" fill="#e8e8e8" fill-opacity=".85" font-family="Inter, sans-serif" font-size="11.5">${ma.toFixed(2)}:1 · ${c.w}×${c.h}</text>` + h;
  }
  ov.innerHTML = h;
  pinErrRefresh();
  if (typeof sceneDrawOverlay === 'function') sceneDrawOverlay(); // escena Car GS (js/scene-lines.js, carga después)
  if (typeof dlDrawOverlay === 'function') dlDrawOverlay(); // reencuadre de entrega (js/delivery.js): el cuadro del comp
  if (typeof ghDraw === 'function') ghDraw(); // comparación con el 3D (js/ghost.js)
  if (typeof slateDrawOverlay === 'function') slateDrawOverlay(); // Slate solve (js/slate.js)
  updateBadge();
  if (typeof bokehOnOverlay === 'function') bokehOnOverlay(); // hook bokeh
}
// move scan and camera together (keeps the match), so the camera height above ground changes
function shiftVertical(d) {
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return;
  st.scanY = (st.scanY || 0) + d;
  scanRoot.position.y += d; scanRoot.updateMatrixWorld(true);
  camera.position.y += d; camera.updateMatrixWorld(true);
  nav.target.y += d;
  if (st.solved) st.solved.C[1] += d;
  lsSet('scanY', st.scanY);
  $('scan-y').value = +st.scanY.toFixed(4);
  measWorld(); updateMeasureGeo(); updateDims();
  refreshAll();
}
function camAngles() {
  camera.updateMatrixWorld();
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const d = 180 / Math.PI;
  return { tilt: e.x * d, yaw: e.y * d, roll: e.z * d };
}
function updateCamInfo() {
  camSyncUI(); // hook camera
  const a = camAngles();
  const setF = (id, v, d) => { const el = $(id); if (document.activeElement !== el && !el.parentNode.classList.contains('scrubbing')) el.value = (+v).toFixed(d); };
  setF('cam-h', camera.position.y, 3);
  setF('ang-tilt', a.tilt, 2); setF('ang-roll', a.roll, 2); setF('ang-yaw', a.yaw, 2);
  // hook camera: los datos de set se tipean aunque estén bloqueados (el candado sólo frena al solve)
  $('ang-tilt').title = $('ang-roll').title = st.lockTR ? 'Locked for the solve: the pins keep it. Drag or type to set it from the set data.' : 'Drag to adjust (Shift: fine) or click to type';
  setF('tb-focal', focalUsed(), 2); $('tb-focal').disabled = false;
  $('tb-focal').title = st.freeF ? 'Focal length: drag or type. The pins refine it once there are enough.' : 'Focal length (lens): drag or type. Locked: the pins keep it fixed.';
  $('tb-apply-f').disabled = !st.metaFocal;
  $('tb-apply-f').title = st.metaFocal ? `Set the focal length from the EXR metadata: ${fmt(st.metaFocal, 2)} mm` : 'No focal length in the plate metadata';
  { const pr = PRESETS.find(p => p[0] === st.preset);
    const name = camLabel(); // hook camera
    const ids = st.metaCamera ? presetsForModel(st.metaCamera) : null;
    const mismatch = !!(st.metaCamera && (!ids || !ids.includes(st.preset)));
    const tc = $('tb-cam');
    tc.textContent = `${name} · ${fmt(st.sw, 2)} × ${fmt(shUsed(), 2)} mm · ${fmt(focalUsed(), 1)} mm`;
    tc.classList.toggle('warn', mismatch || !!st.camChoose);
    tc.title = tc.textContent + '\n' + (st.camChoose ? 'The plate metadata does not say the ' + (st.camChoose === 'mode' ? 'recording mode' : 'camera') + ': choose it in Plate & camera (Import and Measure).' : mismatch ?`The plate metadata says "${st.metaCamera}", which doesn't match this sensor. Check the camera preset.` : (st.metaCamera ? `Matches the plate metadata: ${st.metaCamera}` : 'Camera and lens used for the solve')); } // el texto entero: en barra angosta la ficha va con …
  $('lock-f').checked = !st.freeF;
  const o = st.metaOrient, hasTR = !!(o && (o.tilt || o.roll));
  $('tb-apply-tr').disabled = !hasTR;
  $('tb-apply-tr').title = hasTR ? 'Set tilt and roll from the EXR metadata: ' + $('orient-txt').textContent : 'No tilt/roll in the plate metadata';
}
// set camera orientation (degrees); missing values keep the current ones
function applyOrientation(o) {
  if (!o) return;
  const cur = camAngles(), r = Math.PI / 180;
  const t = o.tilt ? o.tilt.v : cur.tilt, ro = o.roll ? o.roll.v : cur.roll, y = o.yaw ? o.yaw.v : cur.yaw;
  camera.quaternion.setFromEuler(new THREE.Euler(t * r, y * r, ro * r, 'YXZ'));
  camera.updateMatrixWorld(true);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  nav.target.copy(camera.position).addScaledVector(dir, Math.max(camera.position.distanceTo(nav.target), 0.5));
  if (st.pins.length) solveLive(false);
  refreshAll();
}
function updateBadge() {
  const b = $('badge');
  const parts = [];
  if (st.rms != null && st.pins.filter(p => p.on).length) parts.push(`<span class="${errClass(st.rms)}"><small>RMS</small>${fmt(st.rms, 2)} px</span>`);
  if (st.view.zoom !== 1) parts.push(`<span><small>Zoom</small>${fmt(st.view.zoom, 1)}×</span>`);
  b.innerHTML = parts.join('');
  updateCamInfo();
}

// ---------- UI refresh ----------
const HINTS = {
  nav: () => `<b>Navigate</b> · ${NAV[navPreset].hint}`,
  pins: () => '<b>Pins</b> · click the scan to drop a pin, drag it onto the plate · RMB: delete · wheel: zoom · Alt or MMB: pan',
  measure: () => `<b>Measure</b> · click two points on the scan, type the real length, Enter to scale · points on the environment (cars, road) only check sizes · Esc clears · ${NAV[navPreset].hint}`,
  lines: () => '<b>Lines</b> · drag the ends of the blue lines (Z) over edges along the car · drag the VP car marker to turn, the horizon to tilt, the road to set the height · wheel: zoom · Alt or MMB: pan',
  slate: () => '<b>Slate solve</b> · drag from end to end of the slate (or a person) standing at the focus distance, type its real size · drag an end to adjust · Esc clears · wheel: zoom · Alt or MMB: pan',
  depth: () => '<b>Distance to camera</b> · click the scan, the street or the ground to drop a locator with its distance to the camera · drag to move · right click or Delete removes · double-click sets the focus there',
  figure: () => '<b>Figure</b> · click below the horizon to stand a figure on the road · drag to move · Delete removes it · wheel: zoom · Alt or MMB: pan',
};
function refreshAll() {
  // pestañas de módulo (js/module-tabs.js): Import y DepthLab no navegan la vista
  const mt = typeof mtabCur === 'undefined' ? '' : mtabCur;
  $('hint').innerHTML = mt === 'import' ? '<b>Import and Measure</b> · load the plate, the set report and the scan · on the scan: Navigate (N) to orbit, pan and zoom, Measure (M) to measure, F to frame'
    : mt === 'match' && st.mode === 'lines' ? '<b>Lines</b> · drag the ends of the lines over straight edges of the plate (drag a line by its middle to slide it without turning): X red across the car, Y green vertical, Z blue along the car (the axis buttons at the right: XYZ, XY, XZ or YZ) · wheel: zoom · Alt or MMB: pan'
    : (mt === 'depthlab' || mt === 'compare') && st.mode !== 'nav' ? HINTS[st.mode]()
    : mt === 'match' && st.mode !== 'lines' ? HINTS[st.mode]()
    : mt === 'compare' ? '<b>Compare and Match</b> · the view is locked to the shot camera · load the driving plate, turn on the 3D Guides (G) and judge the plate against the 3D · Fit › Corner pin: drag the four corners'
    : mt === 'depthlab' ? '<b>DepthLab</b> · the view and the camera bar are locked to the shot camera (change them in 3D Camera Pin) · set the focus on the focus rail or in Lens & focus'
    : HINTS[st.mode]();
  if (typeof shotUI === 'function') shotUI(); // hook navigation: Recall cam
  ['nav', 'pins', 'measure', 'lines', 'slate', 'figure', 'depth'].forEach(m => $('m-' + m).setAttribute('aria-pressed', String(st.mode === m)));
  // step 1
  $('s1').dataset.state = st.scaleOk ? 'ok' : 'warn';
  { const has = !!scanObj, el = $('s1st');
    $('s1load').hidden = has; el.hidden = !has;
    el.innerHTML = st.scaleOk ? '<svg class="sti" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="m5 8.2 2 2 4-4.3"/></svg>' : '<svg class="sti" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3.2M8 11.6v.1"/></svg>';
    el.title = st.scaleOk ? 'Scan loaded, scale verified' : 'Scan loaded, scale not verified'; }
  // step 2
  const fx = K().fx;
  const hfov = 2 * Math.atan(st.sw * par() / 2 / focalUsed()) * 180 / Math.PI;
  const vfov = 2 * Math.atan(autoSh() / 2 / focalUsed()) * 180 / Math.PI;
  const kv = [['Horizontal FOV', fmt(hfov, 2) + '°'], ['Vertical FOV', fmt(vfov, 2) + '°'], ['Focal in pixels', fmt(fx * (st.freeF ? st.fScale : 1), 1) + ' px']];
  if (st.freeF) kv.push(['Estimated focal', st.pins.filter(p => p.on).length >= 6 ? fmt(focalUsed(), 2) + ' mm' : 'needs 6 pins']);
  $('cam-kv').innerHTML = kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('s2').dataset.state = st.plate.sample ? 'warn' : 'ok';
  { const el = $('s2st');
    $('s2load').hidden = !st.plate.empty; el.hidden = st.plate.empty;
    el.innerHTML = st.plate.sample ? '<svg class="sti" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3.2M8 11.6v.1"/></svg>' : '<svg class="sti" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="m5 8.2 2 2 4-4.3"/></svg>';
    el.title = st.plate.sample ? 'Sample plate (demo)' : 'Plate loaded'; }
  // step 3
  pinErrRefresh();
  const on = st.pins.filter(p => p.on).length;
  { const b = $('tb-bake'), nb = st.pins.filter(p => p.baked).length, loose = st.pins.length - nb;
    b.disabled = !st.pins.length; b.textContent = loose || !nb ? 'Bake pins' : 'Unbake';
    b.title = loose || !nb ? 'Lock the current pins in place: they keep solving but cannot be dragged or deleted by accident. Add more pins on top.' : 'Release the baked pins so they can be moved again'; }
  $('pinlist').innerHTML = st.pins.map((p, i) => {
    const w = pinWorld(p);
    return `<li class="${i === st.sel ? 'sel' : ''}${p.baked ? ' baked' : ''}" data-i="${i}" title="${p.baked ? 'Baked pin' : ''}"><input type="checkbox" ${p.on ? 'checked' : ''} aria-label="Use pin ${p.id}"><span class="id">#${p.id}</span><span class="coord">${fmt(w.x, 2)}, ${fmt(w.y, 2)}, ${fmt(w.z, 2)}</span><span class="err ${errClass(p.err)}">${Number.isFinite(p.err) ? fmt(p.err, 2) + ' px' : '–'}</span><button class="x" aria-label="Delete pin ${p.id}">×</button></li>`;
  }).join('') || '<li class="note" style="display:block">No pins yet.</li>';
  $('solve').disabled = on < 3;
  updateExport();
  render(); drawOverlay();
}

