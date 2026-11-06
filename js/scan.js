// ---------- Scan loading ----------
function sceneSize() {
  const b = new THREE.Box3().setFromObject(scanRoot);
  return b.isEmpty() ? 10 : b.getSize(new THREE.Vector3()).length();
}
function rootMatrixFor(unit, userScale, up) {
  const m = new THREE.Matrix4();
  const r = new THREE.Euler(up === 'z' ? -Math.PI / 2 : up === '-y' ? Math.PI : 0, 0, 0);
  const rot = st.rot || [0, 0, 0], d2r = Math.PI / 180;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * d2r, rot[1] * d2r, rot[2] * d2r, 'XYZ')).multiply(new THREE.Quaternion().setFromEuler(r));
  m.compose(new THREE.Vector3(0, st.scanY || 0, 0), q, new THREE.Vector3().setScalar(unit * userScale));
  return m;
}
// oldM: la matriz de antes, cuando el que llama ya cambió st.rot o st.scanY (Level to ground)
function setRootTransform(unit, userScale, up, keepView = true, oldM = rootMatrixFor(st.unit, st.userScale, st.up)) {
  const newM = rootMatrixFor(unit, userScale, up);
  st.unit = unit; st.userScale = userScale; st.up = up;
  newM.decompose(scanRoot.position, scanRoot.quaternion, scanRoot.scale);
  scanRoot.updateMatrixWorld(true);
  if (keepView) {
    const D = newM.clone().multiply(oldM.clone().invert());
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    D.decompose(pos, q, s);
    camera.position.applyMatrix4(D);
    camera.quaternion.premultiply(q);
    camera.updateMatrixWorld(true);
    if (st.solved) {
      const p = st.solved; const Cv = new THREE.Vector3(...p.C).applyMatrix4(D);
      const Rm = new THREE.Matrix4().makeRotationFromQuaternion(q);
      const qe = Rm.elements; // world rotation; R' = R * Q^T
      const Q = [qe[0], qe[4], qe[8], qe[1], qe[5], qe[9], qe[2], qe[6], qe[10]];
      const QT = [Q[0], Q[3], Q[6], Q[1], Q[4], Q[7], Q[2], Q[5], Q[8]];
      st.solved = { R: Solver.mul3(p.R, QT), C: [Cv.x, Cv.y, Cv.z], f: p.f };
    }
  }
  updateGrid(); updateDims(); updateMeasureGeo();
}
function updateGrid() {
  const b = new THREE.Box3().setFromObject(scanRoot);
  grid.position.y = 0; // ground
}
function fmt(n, d = 3) { return Number.isFinite(n) ? n.toFixed(d) : '–'; }
function updateDims() {
  const b = new THREE.Box3().setFromObject(scanRoot);
  if (b.isEmpty()) return;
  const s = b.getSize(new THREE.Vector3());
  $('dx').textContent = fmt(s.x, 2) + ' m'; $('dy').textContent = fmt(s.y, 2) + ' m'; $('dz').textContent = fmt(s.z, 2) + ' m';
  if (document.activeElement !== $('scale-in')) $('scale-in').value = +st.userScale.toFixed(6);
  $('scan-sum').textContent = `${fmt(s.x, 1)} × ${fmt(s.y, 1)} × ${fmt(s.z, 1)} m · scale ×${fmt(st.userScale, 3)}`;
  const msg = $('unit-msg');
  const big = Math.max(s.x, s.y, s.z);
  let txt = '', cls = 'msg';
  if (big > 2000) { txt = `The longest side is ${fmt(big, 0)} m: the units are almost certainly wrong (mm or cm?).`; cls = 'msg bad'; }
  else if (big < 0.05) { txt = `The scan is only ${fmt(big * 100, 1)} cm on its longest side: is it in meters but exported too small?`; cls = 'msg bad'; }
  else if (st.guessText && st.guess === String(st.unit)) { txt = st.guessText; }
  msg.hidden = !txt; msg.className = cls; msg.textContent = txt;
}

function clearScan() {
  if (scanObj) {
    scanRoot.remove(scanObj);
    scanObj.traverse(o => { if (o.geometry) o.geometry.dispose(); const w = o.userData.sort && o.userData.sort.worker; if (w) { w.terminate(); URL.revokeObjectURL(w.url); } });
  }
  scanObj = null;
  $('splat-sh-row').hidden = true; $('scan-level-msg').hidden = true;
}
function finishScan(obj, name, kind, fileType) {
  clearScan();
  $('empty').hidden = true; st.sample = false;
  st.scanFmt = fileType; $('tex-name').textContent = 'from file'; $('tex-clear').hidden = true;
  // compute raw bbox with identity root
  scanRoot.position.set(0, 0, 0); scanRoot.quaternion.identity(); scanRoot.scale.set(1, 1, 1); scanRoot.updateMatrixWorld(true);
  scanRoot.add(obj); scanObj = obj;
  obj.traverse(o => {
    if (o.isMesh && !o.userData.isSplat) {
      o.userData.orig = o.material;
      if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    }
  });
  const raw = new THREE.Box3().setFromObject(scanRoot);
  const size = raw.getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  st.rawBox = raw; st.scanName = name; st.scanKind = kind; st.sample = false;
  // guess units and up axis
  let unit = 1;
  if (fileType !== 'glb' && fileType !== 'gltf') unit = big > 2500 ? 0.001 : big > 250 ? 0.01 : 1;
  st.guess = String(unit);
  st.guessText = unit === 1 ? '' : `Longest side: ${fmt(big, 1)} units. It looks like ${unit === 0.01 ? 'centimeters' : 'millimeters'}, so units were set to that. Check it.`;
  // los splats salen de COLMAP con Y para abajo: así vinieron el truck de Inria, un .splat y uno de Brush (que
  // escribe "Vertical axis: y" sin signo y también es Y abajo). Lo que elija el usuario se recuerda aparte.
  let up = kind === 'splat' ? (obj.userData.up || lsGet('upSplat', '-y')) /* .spz v4: RUB */ : fileType === 'ply' ? lsGet('upPly', 'y') : 'y';
  // OBJ: 3ds Max escribe Y arriba con "Flip YZ" (el default) y Z arriba sin. Un auto es más bajo que ancho y largo
  // (un sedán: ~1,45 x 1,7 x 4,5 m), y con calle alrededor mucho más: si lo más bajo es Z por lejos, Z arriba
  if (fileType === 'obj') {
    const lowZ = size.z < 0.9 * Math.min(size.x, size.y), lowY = size.y <= Math.min(size.x, size.z);
    if (lowZ) { up = 'z'; st.guessText = (st.guessText ? st.guessText + ' ' : '') + 'It is lowest along Z, so File up axis was set to Z up. Check it.'; }
    else if (!lowY) st.guessText = (st.guessText ? st.guessText + ' ' : '') + `Its height (Y) is not its smallest side (${fmt(size.x, 2)} × ${fmt(size.y, 2)} × ${fmt(size.z, 2)} units): check File up axis.`;
  }
  st.unit = unit; st.up = up; st.userScale = 1; st.scaleOk = false;
  $('unit').value = String(unit); $('up').value = up;
  st.scanY = 0; $('scan-y').value = 0; st.rot = [0, 0, 0]; ['x', 'y', 'z'].forEach(a => $('rot-' + a).value = 0);
  setRootTransform(unit, 1, up, false);
  st.pins = []; st.sel = -1; st.solved = null; st.rms = null;
  st.measure = { a: null, b: null }; updateMeasureGeo();
  // todo scan nuevo entra en Flat (unlit): se ve en cualquier tamaño y con sus colores; un splat, con sus gaussianas
  if (kind !== 'splat') { $('disp').value = 'flat'; lsSet('disp', 'flat'); }
  if (typeof mtabViewForget === 'function') mtabViewForget('disp'); // también en las otras pestañas (js/module-tabs.js)
  applyDisplay();
  if (st.pendingProject && st.pendingProject.camera) { // keep the project's camera; only fit the clip planes
    const s = new THREE.Box3().setFromObject(scanRoot).getSize(new THREE.Vector3()).length();
    camera.near = Math.max(s / 5000, 0.01); camera.far = Math.max(s * 50, envRoot.visible ? 3000 : 0); applyIntrinsics();
  } else if (!st.plate.empty && !st.plate.sample) frameScanKeepPose();
  else frameScan();
  $('scan-name').textContent = name;
  $('tag').textContent = st.plate.W + ' × ' + st.plate.H;
  const kv = [];
  let verts = 0, tris = 0;
  obj.traverse(o => {
    if (o.geometry && o.geometry.attributes.position && !o.userData.isSplat) { // el splat es un quad instanciado: cuentan los centros del proxy
      verts += o.geometry.attributes.position.count;
      if (o.isMesh) tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    }
  });
  kv.push(['Type', kind === 'splat' ? 'Gaussian splat' : kind === 'points' ? 'Point cloud' : 'Mesh']);
  kv.push([kind === 'mesh' ? 'Triangles' : kind === 'splat' ? 'Splats' : 'Points', (kind === 'mesh' ? Math.round(tris) : verts).toLocaleString('en-US')]);
  if (st.plyInfo) kv.push(['Filtered', st.plyInfo]);
  const shDeg = kind === 'splat' ? Math.max(0, ...obj.children.map(o => o.userData.shDeg || 0)) : 0;
  if (shDeg) kv.push(['View color', 'SH degree ' + shDeg]);
  $('splat-sh-row').hidden = !shDeg; $('splat-sh').checked = splatShOn;
  $('scan-kv').innerHTML = kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  refreshAll();
  setBusy(false);
  projectAfterLoad('scan');
}
function frameScan() {
  const b = new THREE.Box3().setFromObject(scanRoot);
  const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length();
  camera.position.set(c.x + s * 0.55, c.y + s * 0.3, c.z + s * 0.75);
  camera.up.set(0, 1, 0);
  camera.lookAt(c);
  controls.target.copy(c);
  camera.near = Math.max(s / 5000, 0.01); camera.far = Math.max(s * 50, envRoot.visible ? 3000 : 0);
  applyIntrinsics();
}
// Con un plate real la cámara ya trae la data de set o la metadata (tilt, roll, yaw, altura): se conserva y
// la cámara sólo se corre en el piso, sobre su propio rumbo, hasta ver el scan entero.
function frameScanKeepPose() {
  const b = new THREE.Box3().setFromObject(scanRoot), c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
  camera.updateMatrixWorld();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); dir.y = 0;
  if (dir.lengthSq() < 1e-6) { frameScan(); return; } // mira derecho para abajo: sin rumbo
  dir.normalize();
  const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const d = r / Math.sin(Math.min(vf, hf) / 2) * 1.05;
  camera.position.set(c.x - dir.x * d, camera.position.y, c.z - dir.z * d);
  nav.target.copy(camera.position).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), d);
  camera.near = Math.max(r / 2500, 0.01); camera.far = Math.max(d + r * 50, envRoot.visible ? 3000 : 0);
  applyIntrinsics();
}

// glTF loader with Draco and meshopt support (Draco decoder from vendor/, works offline)
let _draco = null;
function makeGLTFLoader() {
  const l = new THREE.GLTFLoader();
  try {
    if (!_draco && THREE.DRACOLoader) { _draco = new THREE.DRACOLoader(); _draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/'); _draco.setDecoderConfig({ type: 'js' }); }
    if (_draco) l.setDRACOLoader(_draco);
    if (typeof MeshoptDecoder !== 'undefined') l.setMeshoptDecoder(MeshoptDecoder);
  } catch (e) {}
  return l;
}

// ---------- Level to ground ----------
// Piso del scan como plano, en mundo: el plano más bajo de los grandes. Puntos: los centros de los splats opacos, o
// los vértices de una malla. RANSAC busca planos casi horizontales (hasta 25°) con muchos puntos a menos de 0,3 % del
// tamaño del scan; de esos se queda con el que tenga más puntos dejando abajo menos de 10 % del scan (si no hay,
// 20 %, después un tercio): abajo de la calle sólo hay reflejos y restos. Sin ese límite gana un plano que cruza
// cordón y vereda: en el Clio, 4,6° con más puntos que el asfalto (1,6°, 8 % abajo; el cordón de 30 cm deja 15 %).
// Un techo o un capó dejan el auto entero abajo. Después, mínimos cuadrados sobre los puntos del plano, tres vueltas.
// null si no hay calle.
function scanFloorPlane() {
  if (!scanObj) return null;
  scanRoot.updateMatrixWorld(true);
  const P = [], v = new THREE.Vector3(), cos25 = Math.cos(25 * Math.PI / 180);
  const sm = scanObj.children && scanObj.children.find(o => o.userData.isSplat);
  if (sm) {
    const cen = sm.material.uniforms.tCenter.value.image.data, n = sm.userData.sort.n, every = Math.max(1, Math.floor(n / 150000));
    for (let i = 0; i < n; i += every) if (cen[i * 4 + 3] >= 0.5) { v.set(cen[i * 4], cen[i * 4 + 1], cen[i * 4 + 2]).applyMatrix4(sm.matrixWorld); P.push(v.x, v.y, v.z); }
  } else {
    let total = 0; const geos = [];
    scanObj.traverse(o => { const a = o.geometry && o.geometry.attributes.position; if (a) { geos.push(o); total += a.count; } });
    const every = Math.max(1, Math.floor(total / 100000));
    for (const o of geos) { const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i += every) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); P.push(v.x, v.y, v.z); } }
  }
  const m = P.length / 3;
  if (m < 50) return null;
  const size = new THREE.Box3().setFromObject(scanRoot).getSize(new THREE.Vector3()).length(), thr = 0.003 * size;
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const dist = (i, n, d) => n[0] * P[i * 3] + n[1] * P[i * 3 + 1] + n[2] * P[i * 3 + 2] - d;
  const sp = Math.max(1, Math.floor(m / 30000)), tiers = [0.1, 0.2, 1 / 3], best = tiers.map(() => null);
  for (let it = 0; it < 800; it++) {
    const a = Math.floor(rnd() * m) * 3, b = Math.floor(rnd() * m) * 3, c = Math.floor(rnd() * m) * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    let n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; const l = Math.hypot(...n);
    if (!(l > 0)) continue; n = n.map(x => x / l); if (n[1] < 0) n = n.map(x => -x);
    if (n[1] < cos25) continue;
    const d = n[0] * P[a] + n[1] * P[a + 1] + n[2] * P[a + 2];
    let inl = 0, below = 0, cnt = 0;
    for (let i = 0; i < m; i += sp, cnt++) { const e = dist(i, n, d); if (Math.abs(e) < thr) inl++; else if (e < 0) below++; }
    tiers.forEach((t, k) => { if (below <= cnt * t && (!best[k] || inl > best[k].inl)) best[k] = { n, d, inl }; });
  }
  const pick = best.find(b => b && b.inl * sp >= 30);
  if (!pick) return null;
  const n = new THREE.Vector3(...pick.n), c = new THREE.Vector3(), Mi = new THREE.Matrix3();
  let d = pick.d, idx = [];
  for (let r = 0; r < 3; r++) { // mínimos cuadrados: autovector menor de la covarianza de los centros (iteración inversa)
    const na = n.toArray(); idx = []; for (let i = 0; i < m; i++) if (Math.abs(dist(i, na, d)) < thr) idx.push(i);
    c.set(0, 0, 0); for (const i of idx) c.x += P[i * 3], c.y += P[i * 3 + 1], c.z += P[i * 3 + 2]; c.multiplyScalar(1 / idx.length);
    const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const i of idx) { const q = [P[i * 3] - c.x, P[i * 3 + 1] - c.y, P[i * 3 + 2] - c.z]; for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[j * 3 + k] += q[j] * q[k]; }
    const tr = (C[0] + C[4] + C[8]) * 1e-9; C[0] += tr; C[4] += tr; C[8] += tr;
    Mi.set(...C).invert(); for (let k = 0; k < 30; k++) n.applyMatrix3(Mi).normalize();
    if (n.y < 0) n.negate(); d = n.dot(c);
  }
  // extensión: percentiles 5-95 en x y z de los puntos del plano contra los de todo el scan
  const ext = (list) => [0, 2].map(k => { const v = list.map(i => P[i * 3 + k]).sort((x, y) => x - y); return v[Math.floor(v.length * 0.95)] - v[Math.floor(v.length * 0.05)]; });
  const all = []; for (let i = 0; i < m; i += sp) all.push(i);
  const ei = ext(idx), ea = ext(all), area = (ei[0] * ei[1]) / Math.max(1e-12, ea[0] * ea[1]);
  return { n, c, tilt: Math.acos(Math.min(1, n.y)) * 180 / Math.PI, count: idx.length, area };
}
// Sit on ground de una malla que trae la calle alrededor: la altura de la calle, o null (se usa el punto más bajo).
// El punto más bajo no sirve: en un scan real quedaban restos 12 cm debajo del asfalto. Sin calle
// (un auto recortado) el plano más bajo es chico o torcido y se descarta.
function scanMeshFloorY() {
  const f = scanFloorPlane();
  return f && f.tilt < 3 && f.area > 0.3 ? f.c.y : null;
}
// Gira el scan para que el piso quede horizontal y lo apoya en y = 0. Con pins (sin tilt/roll bloqueados) la cámara
// gira con el scan y los pins siguen calzando; con tilt/roll bloqueados (data de set) la cámara se queda y se vuelve a
// resolver. Sin pins, la cámara no se mueve (puede traer la altura y el tilt de la data de set).
function scanLevelToGround() {
  const msg = $('scan-level-msg'), say = (t, cls) => { msg.hidden = false; msg.className = cls || 'msg'; msg.textContent = t; };
  const f = scanFloorPlane();
  if (!f) return say('No ground found under the scan (it needs some street around the car). Level it with Rotation.');
  // COLMAP deja el arriba a pocos grados (el truck de Inria, 10°): un piso más torcido suele ser otra cosa (el fondo
  // de un auto recortado, el eje de arriba equivocado)
  if (f.tilt > 20) return say(`The lowest flat surface is ${fmt(f.tilt, 1)}° off level, so it is probably not the street. Check File up axis or Flip, or level it with Rotation.`);
  const d2r = Math.PI / 180, r0 = st.rot || [0, 0, 0];
  const q = new THREE.Quaternion().setFromUnitVectors(f.n, new THREE.Vector3(0, 1, 0));
  const e = new THREE.Euler().setFromQuaternion(q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(r0[0] * d2r, r0[1] * d2r, r0[2] * d2r, 'XYZ'))), 'XYZ');
  const oldM = rootMatrixFor(st.unit, st.userScale, st.up), on = st.pins.filter(p => p.on).length, carry = on > 0 && !st.lockTR;
  // giro alrededor del origen del scan (0, scanY, 0): la altura nueva deja el centro del piso en y = 0
  st.scanY = -f.c.clone().sub(new THREE.Vector3(0, st.scanY || 0, 0)).applyQuaternion(q).y;
  st.rot = [e.x, e.y, e.z].map(v => +(((v / d2r % 360) + 540) % 360 - 180).toFixed(3));
  ['x', 'y', 'z'].forEach((a, i) => $('rot-' + a).value = +st.rot[i].toFixed(1)); // el campo es angosto; st.rot queda exacto
  $('scan-y').value = +st.scanY.toFixed(4); lsSet('scanY', st.scanY);
  setRootTransform(st.unit, st.userScale, st.up, carry, oldM);
  if (on && !carry) solveLive(true);
  measWorld(); updateMeasureGeo(); refreshAll();
  const g = scanFloorPlane();
  say(`Leveled: the ground was ${fmt(f.tilt, 1)}° off level${g ? `, now ${fmt(g.tilt, 1)}°` : ''}, and it sits at height 0.` +
    (carry ? ' The camera turned with the scan, so the pins still match.' : on ? ` Tilt and roll are locked, so the pins were solved again (${fmt(st.rms, 2)} px).` : '') +
    (f.tilt > 5 ? ' That is a big turn: check that the grid lies on the street.' : ''), 'msg ok');
  return { before: f.tilt, after: g ? g.tilt : null };
}
$('scan-level').onclick = () => scanLevelToGround();
$('splat-sh').onchange = () => splatSetSH($('splat-sh').checked);
