// ---------- 3D navigation with DCC presets ----------
const nav = { target: new THREE.Vector3() };
const controls = nav; // pivot shared with the rest of the code
let spaceDown = false, spaceTap = 0; // Space toggles play/pause; if it is held for a drag (navigation), the toggle is undone
const NAV = {
  max: { hint: 'MMB: pan · Alt+MMB: orbit · Ctrl+Alt+MMB or wheel: zoom',
    map: (b, e) => b !== 1 ? null : e.ctrlKey && e.altKey ? 'dolly' : e.altKey ? 'orbit' : 'pan' },
  maya: { hint: 'Alt+LMB: tumble · Alt+MMB: track · Alt+RMB or wheel: dolly',
    map: (b, e) => !e.altKey ? null : b === 0 ? 'orbit' : b === 1 ? 'pan' : b === 2 ? 'dolly' : null },
  houdini: { hint: 'Space/Alt + LMB: tumble · + MMB: track · + RMB or wheel: dolly',
    map: (b, e) => !(e.altKey || spaceDown) ? null : b === 0 ? 'orbit' : b === 1 ? 'pan' : b === 2 ? 'dolly' : null },
  blender: { hint: 'MMB: orbit · Shift+MMB: pan · Ctrl+MMB or wheel: zoom',
    map: (b, e) => b !== 1 ? null : e.shiftKey ? 'pan' : e.ctrlKey ? 'dolly' : 'orbit' },
  nuke: { hint: 'Alt+LMB: pan · Alt+MMB: zoom · Alt+RMB or Ctrl+LMB: orbit',
    map: (b, e) => (b === 0 && e.ctrlKey && !e.altKey) ? 'orbit' : !e.altKey ? null : b === 0 ? 'pan' : b === 1 ? 'dolly' : b === 2 ? 'orbit' : null },
  // Game: igual en todos los visores 3D (como en Import): WASD sin botón, izquierdo gira, medio desplaza, derecho mira
  game: { hint: 'WASD: move (no button needed), Q/E down/up, Shift fast · LMB: orbit · MMB: pan · hold RMB: look (wheel: speed) · wheel: zoom',
    map: (b) => b === 0 ? 'orbit' : b === 2 ? 'look' : b === 1 ? 'pan' : null },
};
let navPreset = 'maya';
// "frame / zoom extents" key of each DCC (Max: Z, Blender: Home or numpad period, the rest: F)
const FIT_KEYS = { maya: ['f'], max: ['z'], houdini: ['f'], blender: ['home', 'NumpadDecimal'], nuke: ['f'], game: ['f'] };
const FIT_LABEL = { maya: 'F', max: 'Z', houdini: 'F', blender: 'Home', nuke: 'F', game: 'F' };
// frame the scan (or the environment) keeping the current view direction, like Maya's F / Max's Z
function fit3D() {
  const box = new THREE.Box3();
  if (scanObj && scanRoot.visible) box.setFromObject(scanRoot);
  if (box.isEmpty() && envRoot.visible) box.setFromObject(envRoot);
  if (box.isEmpty()) { toast('Nothing to frame: load a scan first'); return; }
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  camera.updateMatrixWorld();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const d = r / Math.sin(Math.min(vf, hf) / 2) * 1.05;
  navBegin();
  camera.position.copy(c).addScaledVector(dir, -d); nav.target.copy(c);
  camera.near = Math.max(r / 2500, 0.01); camera.far = Math.max(d + r * 50, envRoot.visible ? 3000 : 0);
  applyIntrinsics(); navChanged(); refreshAll(); navEnd();
  toast('Framed the scan · Recall cam (or Ctrl+Z) brings the shot camera back');
}
// ---------- Shot cam: la cámara de la toma no se pierde por navegar ----------
// La cámara de la toma es la última fijada a propósito (datos de set, líneas de fuga, EXR, pins, proyecto, a mano):
// al empezar a navegar, si la cámara cambió por otra vía desde el último gesto, ésa se guarda como la de la toma.
// Store cam la fija a mano (la vista actual pasa a ser la de la toma), Recall cam la trae de vuelta y cada gesto de navegación (la rueda seguida cuenta como uno) se deshace con Ctrl+Z.
const shotNav = { cam: null, end: null, t: 0 };
const camSnap = () => ({ p: camera.position.clone(), q: camera.quaternion.clone(), t: nav.target.clone(), f: st.fScale });
const camSame = (a, b) => !!(a && b) && a.p.distanceTo(b.p) < 1e-6 && Math.abs(a.q.dot(b.q)) > 1 - 1e-9 && a.f === b.f;
function navBegin() {
  const now = camSnap(), t = performance.now();
  if (!camSame(now, shotNav.end)) shotNav.cam = now;
  if (t - shotNav.t > 700) pushHistory();
  shotNav.t = t; shotUI();
}
function navEnd() {
  camera.updateMatrixWorld(); shotNav.end = camSnap(); shotNav.t = performance.now(); shotUI();
  if (camera.position.y < 0) toast(`Camera ${fmt(-camera.position.y, 2)} m below the ground: Recall cam (or Ctrl+Z) brings the shot camera back`, true);
}
function shotUI() {
  const b = $('back'); b.disabled = !(shotNav.cam || st.solved);
  if (typeof updateExport === 'function') updateExport(); // la nota de Export camera dice si se exporta la guardada
  b.title = shotNav.cam ? 'Recall cam: back to the shot camera, the one stored with Store cam or set from set data, lines, EXR or pins, before you looked around (Ctrl+Z also undoes each move)' : 'Recall cam: back to the solved camera';
}
// Recall cam
function shotBack() {
  if (!shotNav.cam) { if (st.solved) { cameraFromPose(st.solved); solveLive(false); refreshAll(); } return; }
  pushHistory();
  const c = shotNav.cam; camera.position.copy(c.p); camera.quaternion.copy(c.q); nav.target.copy(c.t); st.fScale = c.f;
  camera.updateMatrixWorld(true); applyIntrinsics(); shotNav.end = camSnap(); navChanged(); refreshAll();
}
// Store cam: la vista actual pasa a ser la cámara de la toma (la que vuelve con Recall cam, la que exporta Export
// camera y la que usa DepthLab), aunque se haya llegado navegando
// si ya se guardó una con Store cam, pregunta en una ventana en el medio de la pantalla: no se pisa sin querer
function storeCam() {
  if (shotNav.stored) { scDlg(true); return; }
  storeCamNow();
}
function storeCamNow() {
  shotNav.stored = true;
  pushHistory();
  shotNav.cam = camSnap(); shotNav.end = camSnap(); shotNav.t = performance.now();
  shotUI(); refreshAll();
  toast('Camera stored: Recall cam comes back here, and Export camera and DepthLab use it');
}
function scDlg(on) { $('sc-dlg').hidden = !on; (on ? $('sc-dlg-no') : $('store-cam')).focus({ focusVisible: false }); }
{
  $('sc-dlg-ok').onclick = () => { scDlg(false); storeCamNow(); };
  $('sc-dlg-no').onclick = () => scDlg(false);
  $('sc-dlg').addEventListener('click', e => { if (e.target === $('sc-dlg')) scDlg(false); });
  // las teclas no llegan a los atajos de la app mientras está abierta (Enter / Espacio sí apretan el botón)
  $('sc-dlg').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') scDlg(false); });
}
// la cámara de la toma ahora: la guardada si la vista actual es sólo navegación desde ella; si no, la actual
function shotCamSnap() {
  const now = camSnap();
  return shotNav.cam && camSame(now, shotNav.end) ? shotNav.cam : now;
}
// corre fn con la cámara de la toma puesta (sin dibujar) y deja la vista como estaba
function withShotCam(fn) {
  const s = shotCamSnap(), now = camSnap();
  if (camSame(s, now)) return fn();
  camera.position.copy(s.p); camera.quaternion.copy(s.q); st.fScale = s.f; camera.updateMatrixWorld(true);
  try { return fn(); } finally { camera.position.copy(now.p); camera.quaternion.copy(now.q); st.fScale = now.f; camera.updateMatrixWorld(true); }
}
function navChanged() { camera.updateMatrixWorld(); render(); drawOverlay(); }
function navOrbit(dx, dy) {
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.005);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(right, st.lockTR ? 0 : -dy * 0.005); // locked tilt/roll: yaw only
  const q = qYaw.multiply(qPitch);
  const off = camera.position.clone().sub(nav.target).applyQuaternion(q);
  camera.position.copy(nav.target).add(off);
  camera.quaternion.premultiply(q);
  navChanged();
}
// keep the orbit pivot in front of the camera
function navRetarget() {
  const dist = Math.max(camera.position.distanceTo(nav.target), 0.5);
  nav.target.copy(camera.position).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), dist);
}
// first-person look: yaw about world up, pitch about the camera's own X (pitch off when tilt/roll is locked)
function navLook(dx, dy) {
  camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.0035));
  if (!st.lockTR) {
    const q2 = camera.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * 0.0035));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q2);
    if (Math.abs(fwd.y) < 0.995) camera.quaternion.copy(q2);
  }
  navRetarget(); navChanged();
}
function navPan(dx, dy) {
  const dist = camera.position.distanceTo(nav.target);
  const k = 2 * dist * Math.tan(camera.fov * Math.PI / 360) / (st.view.baseH * st.view.zoom);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const d = right.multiplyScalar(-dx * k).add(up.multiplyScalar(dy * k));
  camera.position.add(d); nav.target.add(d);
  navChanged();
}
function navDolly(f) {
  const off = camera.position.clone().sub(nav.target);
  camera.position.copy(nav.target).add(off.setLength(Math.max(off.length() * f, 1e-3)));
  navChanged();
}

const MAT = {
  wire: new THREE.MeshBasicMaterial({ color: 0x5ccfe0, wireframe: true, transparent: true, opacity: 0.9 }),
  solid: new THREE.MeshLambertMaterial({ color: 0xb9c3cd, transparent: true, opacity: 1, side: THREE.DoubleSide }),
};
const PTS = { mono: new THREE.PointsMaterial({ color: 0x5ccfe0, size: 2, sizeAttenuation: false }), color: null };

// ---------- Los otros visores 3D (3D Assets, Free de 3D Render): el mismo Nav que el visor principal ----------
// Cámaras de órbita (yaw, pitch y distancia alrededor de un punto t, en grados): el estilo elegido en Nav (Maya, Max,
// Houdini, Blender, Nuke, Simple, Game) mueve igual que en 3D Camera Pin. Lo que el estilo no usa sigue andando sin
// modificador: izquierdo gira, medio desplaza, derecho acerca. Game: derecho mantenido mira (y WASD vuela, Q/E baja y
// sube, Shift rápido, la rueda cambia la velocidad), la rueda sola avanza.
// o: { el, cam, orbit: () => {yaw, pitch, dist, t}, change: () => {}, pitchMin, pitchMax, minDist }
let navLookOn = null, navHover = null, navFlyLast = null; // el visor de órbita que está mirando con Game; el visor 3D bajo el mouse
const NAV_FLY_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
function orbNav(o) {
  const el = o.el, lim = (v) => Math.max(o.pitchMin ?? -89, Math.min(o.pitchMax ?? 89, v));
  const dirOf = (O) => { const y = O.yaw * Math.PI / 180, p = O.pitch * Math.PI / 180; return new THREE.Vector3(Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)); }; // de t a la cámara
  let drag = null;
  const end = () => { if (!drag) return; if (navLookOn === o) navLookOn = null; drag = null; };
  el.addEventListener('contextmenu', e => e.preventDefault());
  navNoAutoscroll(el);
  el.addEventListener('pointerenter', () => { navHover = o; });
  el.addEventListener('pointerleave', () => { if (navHover === o) navHover = null; });
  el.addEventListener('pointerdown', e => {
    if (o.enabled && !o.enabled()) return;
    let action = NAV[navPreset].map(e.button, e);
    if (!action) action = e.button === 0 ? (e.shiftKey ? 'pan' : 'orbit') : e.button === 1 ? 'pan' : e.button === 2 ? 'dolly' : null;
    if (!action) return;
    drag = { x: e.clientX, y: e.clientY, action };
    el.setPointerCapture(e.pointerId); e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    navFlyLast = o.fly;
    if (action === 'look') navLookOn = o;
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!e.buttons) { end(); return; } // se soltó afuera, sin pointerup
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    const O = o.orbit();
    if (drag.action === 'orbit') { O.yaw -= dx * 0.4; O.pitch = lim(O.pitch + dy * 0.4); }
    else if (drag.action === 'look') { // mirar desde donde está: la cámara queda y el punto t gira alrededor de ella
      const P = O.t.clone().addScaledVector(dirOf(O), O.dist);
      O.yaw -= dx * 0.25; O.pitch = Math.max(-89, Math.min(89, O.pitch + dy * 0.25));
      O.t.copy(P).addScaledVector(dirOf(O), -O.dist);
    } else if (drag.action === 'pan') {
      o.cam.updateMatrixWorld();
      const k = O.dist * 2 * Math.tan(o.cam.fov * Math.PI / 360) / Math.max(1, el.clientHeight);
      const r = new THREE.Vector3().setFromMatrixColumn(o.cam.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(o.cam.matrixWorld, 1);
      O.t.addScaledVector(r, -dx * k).addScaledVector(u, dy * k);
    } else O.dist = Math.max(o.minDist || 0.05, O.dist * Math.exp((dy - dx) * 0.005));
    o.change();
  });
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  // Firefox suelta la captura con el derecho apretado (el menú contextual): se vuelve a tomar y el gesto sigue
  el.addEventListener('lostpointercapture', e => { if (drag && e.buttons) { try { el.setPointerCapture(e.pointerId); return; } catch (err) { /* ya no está */ } } end(); });
  el.addEventListener('wheel', e => {
    if (o.enabled && !o.enabled()) return;
    e.preventDefault();
    const O = o.orbit();
    if (drag && drag.action === 'look') { game.speed = Math.min(50, Math.max(0.1, game.speed * Math.exp(-e.deltaY * 0.002))); toast(`Fly speed ${game.speed.toFixed(2)}×`); return; }
    O.dist = Math.max(o.minDist || 0.05, O.dist * Math.exp(e.deltaY * 0.0015)); o.change();
  }, { passive: false });
  // WASD (con Game, sin botón): se mueve el punto t por los ejes de la cámara; la velocidad sigue a la distancia de la
  // órbita (igual en una pieza que en una calle)
  o.fly = {
    ok: () => el.getClientRects().length > 0 && (!o.enabled || o.enabled()),
    basis: () => { const O = o.orbit(), fwd = dirOf(O).negate(); return { fwd, right: new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize() }; },
    speed: () => Math.max(0.2, o.orbit().dist / 4),
    move: (v) => { o.orbit().t.add(v); o.change(); },
  };
  navFlyReg(el, o.fly);
}
// ---------- Game: WASD sin botón ----------
// W A S D (Q / E baja y sube, Shift rápido) mueven el visor 3D que está bajo el mouse (o el último que se usó), sin
// mantener ningún botón, como en un juego; el derecho mantenido sólo agrega mirar con el mouse. Con Game esas teclas
// son de navegar: nunca disparan los atajos de la app (S: Figure, E: entorno, D: Z defocus…), salvo escribiendo en un
// campo de texto.
const game = { keys: new Set(), speed: 1.5, raf: 0, last: 0, main: false };
// el visor principal (3D Camera Pin): se mueve la cámara (y su pivote) por sus propios ejes
const navMainFly = {
  ok: () => vp.getClientRects().length > 0 && !plateMode(),
  basis: () => ({ fwd: new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion) }),
  speed: () => Math.max(0.2, camera.position.distanceTo(nav.target) / 4), // como en Import: sigue a la distancia al pivote
  move: (v) => { camera.position.add(v); nav.target.add(v); navChanged(); },
};
const navFlyHeld = () => NAV_FLY_KEYS.some(k => game.keys.has(k));
// los visores que vuelan, y dónde está el mouse (aunque no se haya movido desde que se cambió de pestaña)
const navFlyEls = [];
function navFlyReg(el, fly) { navFlyEls.push({ el, fly }); }
const navMouse = { x: -1, y: -1 };
window.addEventListener('pointermove', e => { navMouse.x = e.clientX; navMouse.y = e.clientY; }, { passive: true, capture: true });
function navFlyTarget() {
  const at = navMouse.x >= 0 ? document.elementFromPoint(navMouse.x, navMouse.y) : null;
  const r = at && navFlyEls.find(r => r.el.contains(at) && r.fly.ok());
  if (r) return r.fly;
  return navFlyLast && navFlyLast.ok() ? navFlyLast : null;
}
function navFlyLoop(t) {
  if (!navFlyHeld() || navPreset !== 'game') { game.raf = 0; if (game.main) { game.main = false; navEnd(); } return; }
  const dt = Math.min(0.1, (t - (game.last || t)) / 1000); game.last = t;
  const T = navFlyTarget();
  if (T) {
    if (T === navMainFly && !game.main) { game.main = true; navBegin(); }
    const k = game.keys, { fwd, right } = T.basis(), v = new THREE.Vector3();
    if (k.has('KeyW')) v.add(fwd); if (k.has('KeyS')) v.sub(fwd); if (k.has('KeyD')) v.add(right); if (k.has('KeyA')) v.sub(right);
    const up = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (v.lengthSq() || up) {
      const sp = game.speed * T.speed() * (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1) * dt;
      if (v.lengthSq()) v.normalize().multiplyScalar(sp);
      v.y += up * sp; T.move(v);
    }
  }
  game.raf = requestAnimationFrame(navFlyLoop);
}
window.addEventListener('keydown', e => {
  if (e.target.matches && e.target.matches('textarea, input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=button])')) return;
  const looking = navLookOn || (typeof drag !== 'undefined' && drag && drag.action === 'look');
  const fly = navPreset === 'game' && NAV_FLY_KEYS.includes(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (!fly && !looking) return;
  game.keys.add(e.code); e.preventDefault(); e.stopImmediatePropagation();
  if (fly && !game.raf) { game.last = 0; game.raf = requestAnimationFrame(navFlyLoop); }
}, true);
// el botón del medio: sin esto Firefox (y Chrome en Windows) arranca el auto-scroll y el arrastre no llega
function navNoAutoscroll(el) { el.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }); }
navNoAutoscroll(vp);
let vpHover = false;
vp.addEventListener('pointerenter', () => { vpHover = true; }); vp.addEventListener('pointerleave', () => { vpHover = false; });
vp.addEventListener('pointerdown', () => { navFlyLast = navMainFly; });
navFlyReg(vp, navMainFly);
