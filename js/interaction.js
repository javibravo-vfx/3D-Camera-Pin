// ---------- Interaction ----------
let drag = null;
function setMode(m) {
  st.mode = m;
  if (m !== 'pins') {
    // orbit around a point in front of the camera, at the scan's distance, so the view doesn't jump
    const ctr = new THREE.Box3().setFromObject(scanRoot).getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).addScaledVector(dir, Math.max(camera.position.distanceTo(ctr), 0.1));
  }
  updateMeasureGeo();
  refreshAll();
}
function plateMode() { return st.mode === 'pins' || st.mode === 'lines' || st.mode === 'figure' || st.mode === 'slate'; }
vp.addEventListener('contextmenu', e => e.preventDefault());
vp.addEventListener('pointerdown', e => {
  if (spaceDown && spaceTap) { spaceTap = 0; tlPlay(); } // Space is being held to navigate: undo the play/pause it toggled
  const [x, y] = evVp(e);
  { const ae = document.activeElement; if (ae && ae !== document.body && ae.matches('input, select, textarea, button')) ae.blur(); }
  const panBtn = e.button === 1 || (e.button === 0 && (spaceDown || e.altKey));
  // Pins, Lines y Figure trabajan sobre el plate: zoom y paneo 2D, no se navega en 3D
  if (plateMode() && panBtn) { drag = { type: 'pan', x, y, vx: st.view.x, vy: st.view.y }; vp.setPointerCapture(e.pointerId); e.preventDefault(); return; }
  if (st.mode === 'slate') { if (slateOnDown(e, x, y)) { vp.setPointerCapture(e.pointerId); e.preventDefault(); } return; } // Slate solve (js/slate.js)
  if (typeof ghOnDown === 'function' && ghOnDown(e, x, y)) { vp.setPointerCapture(e.pointerId); e.preventDefault(); return; } // una referencia del fantasma (js/ghost.js)
  if (sceneOnDown(e, x, y)) { vp.setPointerCapture(e.pointerId); e.preventDefault(); return; }
  if (st.mode === 'lines' || st.mode === 'figure') return;
  if (st.mode === 'pins') {
    // nearest pin handle
    let bi = -1, bd = 14;
    st.pins.forEach((p, i) => { const [tx, ty] = uvToVp(p.uv[0], p.uv[1]); const d = Math.hypot(tx - x, ty - y); if (d < bd) { bd = d; bi = i; } });
    if (e.button === 2) {
      if (bi >= 0 && !st.pins[bi].baked) { pushHistory(); st.pins.splice(bi, 1); st.sel = -1; solveLive(false); refreshAll(); }
      return;
    }
    if (e.button !== 0) return;
    if (bi >= 0 && st.pins[bi].baked) { st.sel = bi; refreshAll(); return; }
    if (bi >= 0) {
      pushHistory();
      st.sel = bi; const [u, v] = vpToUv(x, y); const p = st.pins[bi];
      drag = { type: 'pin', i: bi, du: p.uv[0] - u, dv: p.uv[1] - v };
    } else {
      const hit = pick(x, y);
      if (!hit) return;
      pushHistory();
      const local = scanRoot.worldToLocal(hit.clone());
      const q = projectWorld(hit);
      st.pins.push({ id: st.nextId++, local, uv: [q.u, q.v], on: true, err: 0 });
      st.sel = st.pins.length - 1;
      const [u, v] = vpToUv(x, y);
      drag = { type: 'pin', i: st.sel, du: q.u - u, dv: q.v - v };
    }
    vp.setPointerCapture(e.pointerId);
    refreshAll();
    e.preventDefault();
  } else {
    const action = NAV[navPreset].map(e.button, e);
    const plain = e.button === 0 && !e.altKey && !e.ctrlKey && !e.shiftKey && !spaceDown;
    if (action) {
      drag = { type: 'nav', action, x, y, lx: x, ly: y, click: st.mode === 'measure' && plain }; navBegin();
      if (action === 'look' && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      vp.setPointerCapture(e.pointerId); e.preventDefault();
    } else if (st.mode === 'measure' && plain) drag = { type: 'click', x, y };
    if (e.button === 1) e.preventDefault();
  }
});
let hoverRAF = 0;
vp.addEventListener('pointermove', e => {
  { const [mx, my] = evVp(e); const [u, v] = vpToUv(mx, my); $('cx').textContent = Math.floor(u); $('cy').textContent = Math.floor(st.plate.H - v); }
  if (st.mode === 'measure' && st.measure.a && !st.measure.b && !drag && !hoverRAF) {
    const [mx, my] = evVp(e);
    hoverRAF = requestAnimationFrame(() => { hoverRAF = 0; const m = pickMeasure(mx, my); st.measure.hover = m ? m.p : null; drawOverlay(); });
  }
  if (slate.drag) { const [x, y] = evVp(e); slateOnMove(x, y); return; }
  if (typeof gh !== 'undefined' && gh.drag) { const [x, y] = evVp(e); ghOnMove(x, y); return; }
  if (sceneSt.drag) { const [x, y] = evVp(e); sceneOnMove(x, y); return; }
  if (drag && !e.buttons && (drag.type === 'nav' || drag.type === 'pin' || drag.type === 'pan')) { vpDragEnd(); return; } // se soltó afuera
  if (!drag) { if (!hoverRAF) { const [mx, my] = evVp(e); hoverRAF = requestAnimationFrame(() => { hoverRAF = 0; sceneHover(mx, my); }); } return; }
  const [x, y] = evVp(e);
  if (drag.type === 'pan') { st.view.x = drag.vx + (x - drag.x); st.view.y = drag.vy + (y - drag.y); applyView(); }
  else if (drag.type === 'nav') {
    const dx = x - drag.lx, dy = y - drag.ly; drag.lx = x; drag.ly = y;
    if (drag.click && Math.hypot(x - drag.x, y - drag.y) < 4) return;
    if (drag.action === 'look') navLook(dx, dy);
    else if (drag.action === 'orbit') navOrbit(dx, dy);
    else if (drag.action === 'pan') navPan(dx, dy);
    else navDolly(Math.exp((dy - dx) * 0.004));
  }
  else if (drag.type === 'pin') {
    const [u, v] = vpToUv(x, y);
    const p = st.pins[drag.i]; p.uv = [u + drag.du, v + drag.dv];
    solveLive(false);
    render(); drawOverlay();
  }
});
vp.addEventListener('pointerup', e => {
  if (slateOnUp()) return;
  if (typeof ghOnUp === 'function' && ghOnUp()) return;
  if (sceneSt.drag) { sceneOnUp(); return; }
  if (!drag) return;
  const [x, y] = evVp(e);
  if (drag.type === 'pin') { solveLive(false); refreshAll(); }
  if ((drag.type === 'click' || (drag.type === 'nav' && drag.click)) && Math.hypot(x - drag.x, y - drag.y) < 4) {
    const m = pickMeasure(x, y);
    if (m) {
      const loc = m.env ? m.p.clone() : scanRoot.worldToLocal(m.p.clone());
      if (!st.measure.la || st.measure.lb) { st.measure.la = loc; st.measure.ea = m.env; st.measure.lb = null; st.measure.eb = false; $('mpop-real').value = ''; }
      else { st.measure.lb = loc; st.measure.eb = m.env; }
      st.measure.hover = null;
      measWorld(); updateMeasureGeo(); render(); drawOverlay();
      if (st.measure.lb && !measEnv()) setTimeout(() => $('mpop-real').focus(), 0);
    }
  }
  if (drag.type === 'nav') navEnd();
  drag = null;
});
// si el navegador corta el arrastre (otra ventana, el menú del sistema, el foco), el gesto termina: no queda trabado
// mirando o girando hasta el próximo click
function vpDragEnd() { if (!drag) return; if (drag.type === 'nav') navEnd(); else if (drag.type === 'pin') { solveLive(false); refreshAll(); } drag = null; }
vp.addEventListener('pointercancel', vpDragEnd);
// Firefox suelta la captura con el botón derecho todavía apretado (el menú contextual): se vuelve a tomar y el gesto sigue
vp.addEventListener('lostpointercapture', e => { if (!drag) return; if (e.buttons) { try { vp.setPointerCapture(e.pointerId); return; } catch (err) { /* ya no está */ } } vpDragEnd(); });
vp.addEventListener('wheel', e => {
  e.preventDefault();
  if (!plateMode()) {
    if (drag && drag.action === 'look') { game.speed = Math.min(50, Math.max(0.1, game.speed * Math.exp(-e.deltaY * 0.002))); setBusy(true, `Fly speed ${game.speed.toFixed(2)} m/s`); clearTimeout(game.t); game.t = setTimeout(() => setBusy(false), 700); return; }
    navBegin();
    navDolly(Math.exp(e.deltaY * 0.0012)); navEnd(); return;
  }
  const [x, y] = evVp(e);
  const v = st.view, z0 = v.zoom;
  const z = Math.min(32, Math.max(0.25, z0 * Math.exp(-e.deltaY * 0.0015)));
  v.x = x - (x - v.x) * z / z0; v.y = y - (y - v.y) * z / z0; v.zoom = z;
  applyView();
}, { passive: false });
window.addEventListener('keydown', e => {
  game.keys.add(e.code);
  if (drag && drag.action === 'look') { e.preventDefault(); return; }
  if (e.target.matches('textarea, select, input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=file])')) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (e.code === 'Space') { const onCtl = !!e.target.closest('button, label'); if (!spaceDown && !e.repeat) { spaceDown = true; if (!onCtl) { spaceTap = 1; tlPlay(); } } if (!onCtl) e.preventDefault(); }
  if ((e.key === ',' || e.key === '<') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); tlPlay(false); tlSet(e.shiftKey ? tl.start : tl.frame - 1); return; }
  if ((e.key === '.' || e.key === '>') && e.code !== 'NumpadDecimal' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); tlPlay(false); tlSet(e.shiftKey ? tl.end : tl.frame + 1); return; }
  if (e.key === 'Alt') e.preventDefault();
  const k = e.key.toLowerCase();
  if (k === 'n') setMode('nav'); else if (k === 'p') setMode('pins'); else if (k === 'm') setMode('measure');
  else if (k === 'o' && !e.ctrlKey && !e.metaKey) setMode('depth'); // hook depth-locators (D es Z defocus, Shift+D la vista Depth)
  else if (k === 'l' && !e.ctrlKey && !e.metaKey) setMode('lines'); else if (k === 's' && !e.ctrlKey && !e.metaKey) setMode('figure');
  else if (k === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) setMode('slate');
  else if (e.shiftKey && k === 'f') layoutStage(true);
  else if ((FIT_KEYS[navPreset] || ['f']).some(x => x === k || x === e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); fit3D(); }
  else if (k === 'h') toggleScan();
  else if (k === 'b') togglePlate();
  else if (k === 'e') toggleEnv();
  else if (k === 'k') toggleKey();
  else if (k === 'escape' && st.mode === 'measure') clearMeasure();
  else if (k === 'escape' && st.mode === 'slate') slateClear();
  else if ((k === 'delete' || k === 'backspace') && st.mode !== 'pins' && sceneDeleteSel()) e.preventDefault();
  else if ((k === 'delete' || k === 'backspace') && st.sel >= 0 && st.pins[st.sel] && !st.pins[st.sel].baked) { pushHistory(); st.pins.splice(st.sel, 1); st.sel = -1; solveLive(false); refreshAll(); }
});
window.addEventListener('keyup', e => {
  game.keys.delete(e.code); if (e.code === 'Space') { spaceDown = false; spaceTap = 0; } if (e.key === 'Alt') e.preventDefault(); });
window.addEventListener('blur', () => { spaceDown = false; game.keys.clear(); });
vp.addEventListener('auxclick', e => e.preventDefault());
{ const ro = new ResizeObserver(() => layoutStage(st.view.zoom === 1)); ro.observe(vp); ro.observe($('vpbar')); } // la barra de chips cambia de alto con la escala

// drag & drop files
let dragDepth = 0;
vp.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
vp.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
vp.addEventListener('dragover', e => e.preventDefault());
vp.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; dropFiles(e.dataTransfer); });
// lo soltado en el visor o en la vista de Import (js/import-view.js)
function dropFiles(dt) {
  for (const f of objTakeFiles(srTakeDrop(dt))) { // hook obj-stream: el OBJ se lleva su .mtl y sus imágenes; hook setreport: grillas, plantas, JSON de rig y carpetas de arrays
    if (/\.json$/i.test(f.name)) { f.text().then(t => { try { openProject(JSON.parse(t), f); } catch (e) { toast('Could not read ' + f.name, true); } }); } // hook project: f, para cargar sus archivos en la app de escritorio
    else if (/\.(obj|ply|splat|spz|ksplat|glb|gltf|fbx)$/i.test(f.name)) loadScanFile(f); // hook splat: .splat, .spz, .ksplat
    else if (/\.exr$/i.test(f.name) && (vplActive() || (exrState && st.pendingProject && (st.pendingProject._got || {}).plate)) && st.pendingProject && st.pendingProject.plate && st.pendingProject.plate.ref) vplLoadRef(f); // hook video-plate / project: re-link del EXR de referencia (también el de un EXR sin cámara)
    else if (f.type.startsWith('image/') || /\.exr$/i.test(f.name) || vplIsVideo(f)) loadPlateFile(f); // hook video-plate
  }
}

// ---------- Collapsible knob groups ----------
document.querySelectorAll('.step h2').forEach(h => {
  const sec = h.parentElement, key = 'closed.' + sec.id;
  sec.classList.add('closed'); // every panel starts collapsed
  h.setAttribute('aria-expanded', String(!sec.classList.contains('closed')));
  const toggle = () => { sec.classList.toggle('closed'); const c = sec.classList.contains('closed'); h.setAttribute('aria-expanded', String(!c)); lsSet(key, c); };
  h.addEventListener('click', toggle);
  h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
});
// ---------- Controls wiring ----------
function toggleScan() {
  scanRoot.visible = !scanRoot.visible;
  $('scan-on').setAttribute('aria-pressed', String(scanRoot.visible));
  render(); drawOverlay();
}
$('scan-on').onclick = toggleScan;
function togglePlate() {
  const off = !$('stage').classList.toggle('noplate') ? false : true;
  $('plate-on').setAttribute('aria-pressed', String(!off));
}
$('plate-on').onclick = togglePlate;
$('plate-on').addEventListener('pointerdown', e => e.stopPropagation());
