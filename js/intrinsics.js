// ---------- Intrinsics / pose conversion ----------
function focalUsed() { return st.focal * (st.freeF ? st.fScale : 1); }
// pixel aspect p: film back width is the physical (squeezed) sensor width; vertical is unsqueezed
function par() { return st.par > 0 ? st.par : 1; }
function autoSh() { return st.sw * st.plate.H / st.plate.W; }
function shUsed() { return st.shAuto ? autoSh() : st.sh; }
function K() {
  const fy = st.focal / st.sw * st.plate.W;
  return { fx: fy / par(), fy, cx: st.plate.W / 2, cy: st.plate.H / 2 };
}
function applyIntrinsics() {
  const f = focalUsed();
  const fy = f / st.sw * st.plate.W;
  camera.fov = 2 * Math.atan((st.plate.H / 2) / fy) * 180 / Math.PI;
  camera.aspect = st.plate.W * par() / st.plate.H;
  camera.updateProjectionMatrix();
}
function poseFromCamera() {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements; // column-major
  const X = [e[0], e[1], e[2]], Y = [e[4], e[5], e[6]], Z = [e[8], e[9], e[10]];
  const R = [X[0], X[1], X[2], -Y[0], -Y[1], -Y[2], -Z[0], -Z[1], -Z[2]];
  return { R: Solver.orthonormalize(R), C: [e[12], e[13], e[14]], f: st.freeF ? st.fScale : 1 };
}
function cameraFromPose(p) {
  const R = p.R;
  const m = new THREE.Matrix4().set(
    R[0], -R[3], -R[6], p.C[0],
    R[1], -R[4], -R[7], p.C[1],
    R[2], -R[5], -R[8], p.C[2],
    0, 0, 0, 1);
  m.decompose(camera.position, camera.quaternion, new THREE.Vector3());
  camera.updateMatrixWorld(true);
  if (st.freeF) st.fScale = p.f;
  applyIntrinsics();
}


// ---------- Cámara y formato: cuerpo, modo y entrega (catálogo en js/camera-catalog.js) ----------
// El select de modo es #preset (su valor es st.preset = 'cuerpo/modo'); panel.js lo maneja como antes.
{
  const groups = {};
  CAM_CATALOG.forEach(b => (groups[b.make] = groups[b.make] || []).push(b));
  $('cam-body').innerHTML = '<option value="">Custom</option>' + Object.entries(groups).map(([mk, bs]) =>
    `<optgroup label="${mk}">${bs.map(b => `<option value="${b.id}">${camBodyName(b)}</option>`).join('')}</optgroup>`).join('');
}
let camModesFor = null; // cuerpo cuyos modos están cargados en #preset (null: hay que cargarlos)
// Extracción del plate en fotositos del modo, o null si es el cuadro completo. Sale del film back actual,
// así un proyecto o un setting guardado (que sólo tienen sw) se leen igual.
function camExtract(m) {
  if (!m || !(m.pw > 0 && m.ph > 0)) return null;
  const e = st.camEx;
  if (e && e.key === m.key && Math.abs(camFilmBack(m, e).w - st.sw) < 0.005) return e;
  if (Math.abs(st.sw - m.w) < 0.005) return null;
  const w = Math.round(st.sw / m.w * m.pw);
  return { key: m.key, w, h: Math.min(m.ph, Math.round(w * st.plate.H / st.plate.W)) };
}
function camSetExtract(ex) {
  const m = camMode(st.preset); if (!m) return;
  const cl = (v, hi) => Math.max(16, Math.min(hi, Math.round(v)));
  st.camEx = ex ? { key: m.key, w: cl(ex.w, m.pw), h: cl(ex.h, m.ph) } : null;
  const fb = camFilmBack(m, st.camEx);
  setSensor(+fb.w.toFixed(4), +fb.h.toFixed(4), true);
}
// Cámara elegida: 'ARRI ALEXA 35 · 4.6K 3:2 Open Gate · extract 4608x2592' (para la barra y los informes)
function camLabel() {
  const m = camMode(st.preset); if (!m) return 'Custom sensor';
  const ex = camExtract(m);
  return camBodyName(m.body) + ' · ' + m.label + (ex ? ` · extract ${ex.w}x${ex.h}` : '');
}
// deja los controles como dice el estado (lo llama updateCamInfo en cada refresco)
function camSyncUI() {
  if (CAM_LEGACY[st.preset]) st.preset = CAM_LEGACY[st.preset];
  const m = camMode(st.preset), bid = m ? m.body.id : '', sel = $('preset');
  if (bid !== camModesFor) {
    camModesFor = bid;
    sel.innerHTML = m ? camModes(m.body).map(x => `<option value="${x.key}" title="${x.w} × ${x.h} mm${x.pw ? ` · ${x.pw} × ${x.ph} photosites` : ''} (${x.conf})">${x.label}</option>`).join('')
      : '<option value="custom">Custom film back</option>';
  }
  $('cam-body').value = bid; sel.value = m ? m.key : 'custom'; sel.disabled = !m;
  const canCrop = !!(m && m.pw > 0 && m.ph > 0), ex = camExtract(m);
  $('cam-full').setAttribute('aria-pressed', String(!ex)); $('cam-crop').setAttribute('aria-pressed', String(!!ex));
  $('cam-full').disabled = !m; $('cam-crop').disabled = !canCrop;
  $('cam-ex-row').hidden = !ex;
  if (ex) ['w', 'h'].forEach(k => { const el = $('cam-ex' + k); if (document.activeElement !== el) el.value = ex[k]; el.max = k === 'w' ? m.pw : m.ph; });
  let src = 'Custom film back: type it below.';
  if (m) {
    src = `${fmt(st.plate.W / st.sw, 1)} px/mm on the plate`;
    const sc = st.plate.W / m.pw;
    if (!ex && m.pw > 0 && Math.abs(sc - 1) > 1e-3) src += `, scaled ${fmt(sc * 100, 1)}% from ${m.pw} × ${m.ph}`;
    src += '.';
    if (m.conf !== 'official') src += ` Mode data is ${m.conf}: verify it.`;
    const fb = camFilmBack(m, ex), pa = st.plate.W / st.plate.H, fa = fb.w / fb.h;
    if (!st.plate.empty && Math.abs(pa / fa - 1) > 0.01) src += ` The plate shape (${fmt(pa, 3)}) does not match the sensor area (${fmt(fa, 3)}): check the mode and the delivery.`;
  }
  $('cam-src').textContent = src;
  // la metadata no alcanzó para saber la cámara o el modo (camApplyPlateMeta): se le pide al usuario, no se adivina
  const ch = $('cam-choose'), said = st.plateMeta && st.plateMeta.camera;
  ch.hidden = !st.camChoose;
  if (st.camChoose === 'mode') ch.textContent = `The file says ${said || 'this camera'} but not the recording mode: choose the Mode, so the film back is right.`;
  else if (st.camChoose === 'camera') ch.textContent = said ? `The file says "${said}", which is not in the camera list: choose the Camera and Mode, or type the film back below.`
    : 'The file does not say which camera shot it: choose the Camera and Mode, or type the film back below.';
}
// elegir la cámara o el modo a mano (o desde el set report) cierra el pedido
['cam-body', 'preset'].forEach(id => $(id).addEventListener('change', () => { st.camChoose = null; }));
$('cam-body').onchange = () => {
  const b = camBody($('cam-body').value);
  if (!b) { st.preset = 'custom'; st.camEx = null; refreshAll(); return; }
  // el modo que dice la metadata si es esta cámara; si no, el de aspecto más parecido al plate
  const md = st.plateMeta, m = (md && camMatchBody(md.camera) === b && camMatchMode(b, md.rw, md.rh)) || camClosestMode(b, st.plate.W, st.plate.H);
  st.preset = m.key; st.camEx = null; setSensor(m.w, m.h, true);
};
$('cam-full').onclick = () => camSetExtract(null);
$('cam-crop').onclick = () => { const m = camMode(st.preset); if (m) camSetExtract(camGuessExtract(m, st.plate.W, st.plate.H) || { w: m.pw, h: m.ph }); };
['w', 'h'].forEach(k => $('cam-ex' + k).addEventListener('change', () => {
  const w = +$('cam-exw').value, h = +$('cam-exh').value; if (w > 0 && h > 0) camSetExtract({ w, h });
}));
// la barra de info muestra la cámara: un clic lleva al selector (una sola forma de elegirla)
$('tb-cam').onclick = () => {
  const sec = $('s2'); if (sec.classList.contains('closed')) sec.querySelector('h2').click();
  $('cam-body').scrollIntoView({ block: 'center' }); $('cam-body').focus();
};
$('tb-cam').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('tb-cam').click(); } });
