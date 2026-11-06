// Mover la cámara sin cambiar la perspectiva (2D Camera Match, como el Perspective Match de 3ds Max) y la
// posición de la cámara en el mundo (Camera world transform, en 2D Camera Match y 3D Camera Pin).
// Horizontal, Vertical y Distance trasladan la cámara en su marco horizontal (la derecha y el frente de la vista,
// aplanados sobre el piso, y la vertical del mundo): la rotación y la focal no cambian, así que los puntos de fuga
// quedan donde están. Rotation gira la cámara 90° alrededor del eje vertical del origen, sin tocar tilt ni roll, y
// le suma esos 90° al yaw que dan las líneas de fuga (sceneSt.rot90 en js/scene-lines.js).
const CMV_UP = new THREE.Vector3(0, 1, 0);
// la derecha y el frente de la vista, sobre el piso (con la cámara mirando derecho abajo, el frente sale del "arriba")
function cmvBasis() {
  camera.updateMatrixWorld();
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); f.y = 0;
  if (f.lengthSq() < 1e-8) { f.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)); f.y = 0; }
  f.normalize();
  const r = new THREE.Vector3().crossVectors(f, CMV_UP).normalize();
  return { r, f };
}
// Horizontal: sobre la derecha de la vista; Vertical: la altura; Distance: hacia atrás de la vista, desde el origen
function cmvRead() {
  const { r, f } = cmvBasis(), c = camera.position;
  return { h: c.dot(r), v: c.y, d: -c.dot(f) };
}
function cmvMoveTo(p) {
  const { r, f } = cmvBasis();
  const c = new THREE.Vector3().addScaledVector(r, p.h).addScaledVector(CMV_UP, p.v).addScaledVector(f, -p.d);
  cmvSetPos(c);
}
function cmvSetPos(c) {
  if (![c.x, c.y, c.z].every(Number.isFinite)) return;
  pushHistory();
  const d = c.clone().sub(camera.position);
  camera.position.copy(c); nav.target.add(d);
  camera.updateMatrixWorld(true); navChanged(); refreshAll();
}
// 90° alrededor del eje vertical del origen: la vista gira con la cámara, tilt y roll quedan
function cmvRotate(sign) {
  pushHistory();
  const q = new THREE.Quaternion().setFromAxisAngle(CMV_UP, sign * Math.PI / 2);
  camera.position.applyQuaternion(q); nav.target.applyQuaternion(q); camera.quaternion.premultiply(q);
  camera.updateMatrixWorld(true);
  sceneSt.rot90 = (((sceneSt.rot90 || 0) + sign) % 4 + 4) % 4;
  // el solve de las líneas sigue valiendo: es la misma perspectiva con los ejes girados
  if (sceneSt.solve && sceneSt.solve.ok && sceneSt.solve.after) sceneSt.solve.after = { ...scenePose(), focal: focalUsed() };
  sceneMarkYaw(); navChanged(); refreshAll();
  toast(`Camera turned 90° ${sign > 0 ? 'left' : 'right'} around the world origin (yaw ${fmt(camAngles().yaw, 1)}°)`);
}
// el eje del mundo, abajo a la izquierda, como en los programas 3D: X rojo, Y verde, Z azul, girado como la cámara
const AXGZ = [['X', [1, 0, 0], '#ff5252'], ['Y', [0, 1, 0], '#69f0ae'], ['Z', [0, 0, 1], '#64b5f6']];
function axGizmo(svg, cam) {
  if (!svg) return;
  const R = 22, c = 30, qi = cam.quaternion.clone().invert();
  const axes = AXGZ.map(([n, d, col]) => { const v = new THREE.Vector3(...d).applyQuaternion(qi); return { n, col, x: c + v.x * R, y: c - v.y * R, z: v.z }; })
    .sort((a, b) => a.z - b.z); // los que van hacia atrás primero
  const h = axes.map(a => `<line x1="${c}" y1="${c}" x2="${a.x.toFixed(1)}" y2="${a.y.toFixed(1)}" stroke="${a.col}" stroke-opacity="${a.z > 0.2 ? 0.45 : 1}"/>`
    + `<circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="6.5" fill="${a.col}" fill-opacity="${a.z > 0.2 ? 0.45 : 1}"/><text x="${a.x.toFixed(1)}" y="${(a.y + 3.4).toFixed(1)}">${a.n}</text>`).join('');
  svg.setAttribute('viewBox', '0 0 60 60');
  if (svg.innerHTML !== h) svg.innerHTML = h;
}
// la vista con la que abrió la app (Reset view de 2D Camera Match)
let cmvHome = null;
window.addEventListener('load', () => { cmvHome = camSnap(); });
function cmvReset() {
  if (!cmvHome) return;
  pushHistory();
  camera.position.copy(cmvHome.p); camera.quaternion.copy(cmvHome.q); nav.target.copy(cmvHome.t); st.fScale = cmvHome.f;
  camera.updateMatrixWorld(true); applyIntrinsics(); sceneSt.rot90 = 0; sceneMarkYaw(); navChanged(); refreshAll();
  toast('Camera back to the view the app opened with');
}
// el pie del panel empieza a la altura de la barra de la línea de tiempo y llega abajo, como esa barra y la de estado
function cmvFoot() {
  const foot = $('props-foot'), tb = $('tlbar'), vw = document.querySelector('.viewer');
  if (!foot || !tb || !vw || !tb.offsetParent) return;
  const hpx = Math.max(0, Math.round(vw.getBoundingClientRect().bottom - tb.getBoundingClientRect().top)) + 'px';
  if (foot.style.height !== hpx) foot.style.height = hpx;
}
function cmvUI() {
  const setF = (id, v) => { const el = $(id); if (el && document.activeElement !== el && !el.parentNode.classList.contains('scrubbing')) el.value = (+v).toFixed(3); };
  const m = cmvRead(), c = camera.position;
  setF('cmv-h', m.h); setF('cmv-v', m.v); setF('cmv-d', m.d);
  setF('cxf-x', c.x); setF('cxf-y', c.y); setF('cxf-z', c.z);
  // los ejes de 2D Camera Match: arriba a la derecha de la imagen, debajo de la barra del visor
  const bar = $('vpbar'), box = $('scv-box');
  if (bar && box) { const t = bar.offsetTop + bar.offsetHeight + 8 + 'px'; if (box.style.top !== t) box.style.top = t; }
  axGizmo($('axgz'), camera);
  cmvFoot();
}
{
  // Horizontal, Vertical, Distance
  ['h', 'v', 'd'].forEach(k => $('cmv-' + k).addEventListener('change', e => {
    const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return;
    cmvMoveTo({ ...cmvRead(), [k]: v });
  }));
  // X, Y, Z del mundo
  ['x', 'y', 'z'].forEach(k => $('cxf-' + k).addEventListener('change', e => {
    const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return;
    const c = camera.position.clone(); c[k] = v; cmvSetPos(c);
  }));
  ['cmv-h', 'cmv-v', 'cmv-d', 'cxf-x', 'cxf-y', 'cxf-z'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); e.target.blur(); }
  }));
  $('cmv-rl').onclick = () => cmvRotate(1);
  $('cmv-rr').onclick = () => cmvRotate(-1);
  $('vp-load-b').onclick = () => $('f-plate').click();
  $('scv-reset').onclick = cmvReset;
  $('out-toggle').onclick = () => { const o = $('out').classList.toggle('open'); $('out-toggle').textContent = o ? 'Fold code' : 'Show code'; };
  $('cxf-t').onclick = () => {
    const open = $('cxf-b').hidden; $('cxf-b').hidden = !open; $('cxf-t').setAttribute('aria-expanded', String(open));
    $('cxf-t').textContent = open ? 'Camera world transform' : 'Show camera world transform'; lsSet('cxf.open', open); cmvUI();
  };
  if (lsGet('cxf.open', false)) $('cxf-t').click();
  new ResizeObserver(cmvFoot).observe(document.querySelector('.viewer'));
  // lo que flota sobre el visor no navega ni dibuja líneas
  ['scv-box', 'cmv', 'vp-load'].forEach(id => ['pointerdown', 'wheel', 'dblclick'].forEach(t => $(id).addEventListener(t, e => e.stopPropagation())));
  // cada vez que se dibuja el overlay (navegar, arrastrar, tipear), los números siguen a la cámara
  const f = drawOverlay; drawOverlay = function (...a) { const r = f(...a); cmvUI(); return r; };
}
