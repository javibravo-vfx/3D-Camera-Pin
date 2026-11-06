// Car box (3D Camera Pin | Environment, a la derecha del visor): una caja amarilla en wireframe que se ajusta sobre el
// auto del scan. Con Motion on, los autos del tráfico que vienen por los carriles que la cruzan bajan la velocidad
// suavemente y frenan a Min distance de ella, sin atravesarla; los que vienen detrás hacen fila. La cámara 3D es
// otro obstáculo, siempre: ningún auto pasa por encima de ella.
// Es un cálculo por cuadro (se puede ir y volver por la línea de tiempo): cada auto tiene su lugar libre (el de su
// carril a su velocidad) y se lo acerca al límite con una curva exponencial, así la velocidad baja sin saltos.
// El lado de cada auto (detrás o delante del obstáculo) es el del primer cuadro del rango.
// API: cbox, cbAvoid (enganche en applyMotion), cbProjectState, cbApplyProject.
const CB_GAP = 1.5;  // entre autos que hacen fila, en m
const CB_EASE = 8;   // cuántos metros antes del límite empiezan a frenar
const CB_CAM = 0.4;  // medio ancho de la cámara como obstáculo, en m
const CB_HALF_W = 0.95; // medio ancho de un auto del tráfico
const cbox = (() => {
  const s = lsGet('carbox', {}) || {}, n = (v, d) => Number.isFinite(+v) && v !== null ? +v : d;
  return { on: !!s.on, x: n(s.x, 0), z: n(s.z, 0), y: n(s.y, 0), w: n(s.w, 1.85), l: n(s.l, 4.7), h: n(s.h, 1.5), min: n(s.min, 2), fitted: !!s.fitted };
})();
const cbState = () => ({ on: cbox.on, x: cbox.x, y: cbox.y, z: cbox.z, w: cbox.w, l: cbox.l, h: cbox.h, min: cbox.min, fitted: cbox.fitted });
const cbSave = () => lsSet('carbox', cbState());
const cbLine = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true }));
cbLine.renderOrder = 999; cbLine.visible = false; scene.add(cbLine);
function cbDraw() {
  cbLine.position.set(cbox.x, cbox.y + cbox.h / 2, cbox.z); cbLine.scale.set(cbox.w, cbox.h, cbox.l); cbLine.updateMatrixWorld(true);
  cbLine.visible = cbox.on && typeof mtabCur !== 'undefined' && mtabCur === 'camerapin';
}
// la caja del scan, en el mundo (Y arriba, el auto a lo largo de Z)
function cbFit() {
  const b = typeof scanRoot !== 'undefined' && scanRoot.children.length ? new THREE.Box3().setFromObject(scanRoot) : null;
  if (!b || b.isEmpty()) { toast('Car box: no scan to fit; set its size by hand', true); return false; }
  const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  Object.assign(cbox, { x: +c.x.toFixed(3), z: +c.z.toFixed(3), y: +b.min.y.toFixed(3), w: +s.x.toFixed(3), l: +s.z.toFixed(3), h: +s.y.toFixed(3), fitted: true });
  return true;
}

// ---------- El tráfico frena ----------
// suave: hasta lim - D va libre, después se acerca al límite sin pasarlo (misma velocidad al empezar a frenar)
const cbSoftMin = (u, lim) => u <= lim - CB_EASE ? u : lim - CB_EASE * Math.exp(-(u - (lim - CB_EASE)) / CB_EASE);
const cbSoftMax = (u, lim) => u >= lim + CB_EASE ? u : lim + CB_EASE * Math.exp((u - (lim + CB_EASE)) / CB_EASE);
// los obstáculos en coordenadas del entorno, ahora (d: lo que viajó el auto de la toma, a lo largo de Z del entorno)
function cbObstacles() {
  const out = [], P = new THREE.Vector3();
  const local = (x, y, z) => envRoot.worldToLocal(P.set(x, y, z)).clone();
  if (cbox.on) {
    const cs = [];
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) cs.push(local(cbox.x + sx * cbox.w, cbox.y, cbox.z + sz * cbox.l));
    out.push({ x0: Math.min(...cs.map(p => p.x)), x1: Math.max(...cs.map(p => p.x)), z0: Math.min(...cs.map(p => p.z)), z1: Math.max(...cs.map(p => p.z)), min: cbox.min });
  }
  camera.updateMatrixWorld();
  const c = local(camera.position.x, camera.position.y, camera.position.z);
  out.push({ x0: c.x - CB_CAM, x1: c.x + CB_CAM, z0: c.z - CB_CAM, z1: c.z + CB_CAM, min: Math.max(1, cbox.min) });
  return out;
}
// enganche en applyMotion (js/timeline.js): con los carriles ya en su lugar, cada auto que se acerca a un obstáculo
// de su carril frena; las instancias de cada auto se corren a lo largo de su carril
function cbAvoid() {
  const groups = [];
  envRoot.traverse(o => { if (o.userData.flow && o.children.some(c => c.userData && c.userData.cars)) groups.push(o); });
  if (!groups.length) return;
  const on = ENV_MODULES[env.id] && env.vals.mon, d = on ? motionDist(tlU()) * (env.vals.mdir === 'back' ? -1 : 1) : 0;
  const obs = on ? cbObstacles() : [];
  for (const g of groups) {
    const ims = g.children.filter(c => c.userData && c.userData.cars);
    const flow = g.userData.flow, off = g.position.z;
    // los autos de este carril (distintos tipos de modelo pueden repartirse en varias InstancedMesh)
    const cars = [...new Set(ims.flatMap(im => im.userData.cars))];
    const dz = new Map();
    if (obs.length && cars.length) {
      const x = cars[0].x;
      // u: a lo largo del viaje del carril (flow 1 va hacia −Z)
      const U = (z) => -flow * z;
      for (const ob of obs) {
        if (x < ob.x0 - CB_HALF_W || x > ob.x1 + CB_HALF_W) continue;
        // el obstáculo ahora y en el primer cuadro (el entorno viajó d a lo largo de su Z)
        const ua = Math.min(U(ob.z0), U(ob.z1)), ub = Math.max(U(ob.z0), U(ob.z1)), u0 = U((ob.z0 + ob.z1) / 2 + d);
        const L = (c) => c.L || (CAR_TYPES[c.type] ? CAR_TYPES[c.type].L * (c.k || 1) : 4.6);
        const now = cars.map(c => ({ c, u: U(c.z + off) + (dz.has(c) ? U(dz.get(c)) : 0), first: U(c.z) }));
        const behind = now.filter(o => o.first < u0).sort((a, b) => b.u - a.u), ahead = now.filter(o => o.first >= u0).sort((a, b) => a.u - b.u);
        let prev = null;
        for (const o of behind) {
          let lim = ua - ob.min - L(o.c) / 2;
          if (prev) lim = Math.min(lim, prev.s - L(prev.c) / 2 - CB_GAP - L(o.c) / 2);
          const s = cbSoftMin(o.u, lim); prev = { s, c: o.c };
          if (s !== o.u) dz.set(o.c, (dz.get(o.c) || 0) - flow * (s - o.u));
        }
        prev = null;
        for (const o of ahead) {
          let lim = ub + ob.min + L(o.c) / 2;
          if (prev) lim = Math.max(lim, prev.s + L(prev.c) / 2 + CB_GAP + L(o.c) / 2);
          const s = cbSoftMax(o.u, lim); prev = { s, c: o.c };
          if (s !== o.u) dz.set(o.c, (dz.get(o.c) || 0) - flow * (s - o.u));
        }
      }
    }
    // las instancias: la matriz de arranque, corrida dz a lo largo de Z del carril
    for (const im of ims) {
      const { cars: list, per, base } = im.userData, a = im.instanceMatrix.array;
      if (!dz.size && !im.userData.moved) continue;
      a.set(base);
      if (dz.size) list.forEach((c, i) => { const v = dz.get(c); if (v) for (let k = 0; k < per; k++) a[(i * per + k) * 16 + 14] += v; });
      im.userData.moved = dz.size > 0;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere(); // r187 recorta por la esfera de todas las instancias: se rehace al correrlas
    }
  }
  envRoot.updateMatrixWorld(true);
}
{ const f = applyMotion; applyMotion = function (...a) { const r = f(...a); cbAvoid(); return r; }; }

// ---------- Caja a la derecha del visor ----------
function cbUI() {
  const set = (id, v, dd = 2) => { const el = $(id); if (el && document.activeElement !== el && !el.parentNode.classList.contains('scrubbing')) el.value = (+v).toFixed(dd); };
  const b = $('cb-chip'); if (b.getAttribute('aria-pressed') !== String(cbox.on)) b.setAttribute('aria-pressed', String(cbox.on));
  $('cb-opts').hidden = !cbox.on;
  set('cb-l', cbox.l); set('cb-w', cbox.w); set('cb-h', cbox.h); set('cb-x', cbox.x); set('cb-z', cbox.z); set('cb-min', cbox.min, 1);
  cbDraw();
}
function cbChanged() { cbSave(); cbUI(); applyMotion(); render(); }
function cbSet(on) {
  cbox.on = !!on;
  if (cbox.on && !cbox.fitted) cbFit();
  cbChanged();
  if (cbox.on && !(ENV_MODULES[env.id] && env.vals.mon)) toast('Car box: the traffic slows down for it with Motion on (3 Play › Motion)');
}
{
  $('cb-chip').onclick = () => cbSet(!cbox.on);
  $('cb-fit').onclick = () => { if (cbFit()) cbChanged(); };
  [['cb-l', 'l', 0.2], ['cb-w', 'w', 0.2], ['cb-h', 'h', 0.2], ['cb-x', 'x'], ['cb-z', 'z'], ['cb-min', 'min', 0]].forEach(([id, k, lo]) => {
    $(id).addEventListener('input', () => { const v = parseFloat($(id).value); if (Number.isFinite(v) && !(lo !== undefined && v < lo)) { cbox[k] = v; if (k !== 'min') cbox.fitted = true; cbSave(); cbDraw(); applyMotion(); render(); } });
    $(id).addEventListener('change', cbUI);
  });
  ['pointerdown', 'wheel', 'dblclick'].forEach(t => $('cb-box').addEventListener(t, e => e.stopPropagation()));
  enhanceNumbers($('cb-box'));
  { const f = mtabShow; mtabShow = function (...a) { const r = f(...a); cbDraw(); return r; }; }
  cbUI();
}
// hook project: la caja viaja con el proyecto
function cbProjectState() { return cbState(); }
function cbApplyProject(o) {
  if (!o || typeof o !== 'object') return;
  for (const k of ['x', 'y', 'z', 'w', 'l', 'h', 'min']) if (Number.isFinite(o[k])) cbox[k] = o[k];
  cbox.on = !!o.on; cbox.fitted = !!o.fitted || cbox.on;
  cbSave(); cbUI(); applyMotion();
}
