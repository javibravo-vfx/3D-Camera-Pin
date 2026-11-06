// DepthLab: distancia a la cámara (herramienta O). Un click sobre el scan, el entorno o el piso deja un locator con
// la distancia de ese punto a la cámara, medida sobre el eje óptico (la distancia de foco, la misma del riel) y, más
// chica, la distancia en línea recta. Se arrastra para moverlo, click derecho o Delete lo borra, doble click pone
// el foco ahí. Los locators son puntos del mundo: siguen al punto si la cámara cambia.
const dpSt = { list: [], next: 1, sel: 0, drag: null, show: true };
const dpOn = () => typeof mtabCur !== 'undefined' && mtabCur === 'depthlab';
// el punto del mundo bajo el cursor: el scan o el entorno (como Measure) y, si no hay, el piso
function dpPick(x, y) {
  const m = pickMeasure(x, y); if (m) return m.p.clone();
  if (st.plate.empty) return null;
  const g = sceneCam().groundPoint(vpToUv(x, y));
  return g ? new THREE.Vector3(g[0], 0, g[2]) : null;
}
function dpDist(w) {
  camera.updateMatrixWorld();
  const c = w.clone().applyMatrix4(camera.matrixWorldInverse);
  return { axis: -c.z, straight: w.distanceTo(camera.position) };
}
function dpHit(x, y) {
  let best = null, bd = 12;
  for (const l of dpSt.list) {
    const q = projectWorld(l.w); if (!q.front) continue;
    const [px, py] = uvToVp(q.u, q.v), d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}
function dpDraw() {
  const svg = $('dp-ov'); if (!svg) return;
  const show = dpOn() && !st.plate.empty && dpSt.show;
  let h = '';
  if (show) for (const l of dpSt.list) {
    const q = projectWorld(l.w); if (!q.front) continue;
    const [x, y] = uvToVp(q.u, q.v), d = dpDist(l.w), sel = l.id === dpSt.sel;
    const cross = `M${x - 9} ${y}h6M${x + 3} ${y}h6M${x} ${y - 9}v6M${x} ${y + 3}v6`;
    h += `<path class="dp-halo" d="${cross}"/><circle class="dp-halo" cx="${x}" cy="${y}" r="5"/><path class="dp-x${sel ? ' sel' : ''}" d="${cross}"/><circle class="dp-x${sel ? ' sel' : ''}" cx="${x}" cy="${y}" r="5"/>`
      + `<text x="${x + 10}" y="${y - 8}">${fmt(d.axis, 2)} m</text><text class="sub" x="${x + 10}" y="${y + 16}">${fmt(d.straight, 2)} m straight</text>`;
  }
  if (svg.innerHTML !== h) svg.innerHTML = h;
  const b = $('m-depth'); if (b) b.setAttribute('aria-pressed', String(st.mode === 'depth'));
}
{
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'dp-ov'; svg.setAttribute('class', 'dp-ov'); svg.setAttribute('aria-hidden', 'true');
  vp.appendChild(svg);
  $('m-depth').onclick = () => setMode('depth');
  // sólo sobre la imagen: no los botones, chips y cajas que flotan sobre el visor, ni fuera del plate
  const onPlate = (e) => {
    if (e.target.closest('button, input, select, label, .vpbar, .scv-box, .cmv, .mpop, .vp-load, .relink')) return false;
    const [x, y] = evVp(e), [u, v] = vpToUv(x, y);
    return u >= 0 && v >= 0 && u <= st.plate.W && v <= st.plate.H;
  };
  const active = (e) => dpOn() && st.mode === 'depth' && !e.altKey && !e.ctrlKey && !e.metaKey && !spaceDown && onPlate(e);
  // antes que interaction.js (captura): la herramienta se queda con el click
  vp.addEventListener('pointerdown', e => {
    if (!active(e) || (e.button !== 0 && e.button !== 2)) return;
    const [x, y] = evVp(e), hit = dpHit(x, y);
    e.stopPropagation(); e.preventDefault();
    if (e.button === 2) { if (hit) { dpSt.list = dpSt.list.filter(l => l !== hit); dpSt.sel = 0; drawOverlay(); } return; }
    if (hit) { dpSt.sel = hit.id; dpSt.drag = hit; vp.setPointerCapture(e.pointerId); drawOverlay(); return; }
    const w = dpPick(x, y);
    if (!w) { toast('Click on the scan, the street or the ground below the horizon'); return; }
    const l = { id: dpSt.next++, w }; dpSt.list.push(l); dpSt.sel = l.id; dpSt.drag = l; vp.setPointerCapture(e.pointerId);
    drawOverlay();
  }, true);
  vp.addEventListener('pointermove', e => {
    if (!dpSt.drag) return;
    e.stopPropagation();
    const [x, y] = evVp(e), w = dpPick(x, y);
    if (w) { dpSt.drag.w = w; drawOverlay(); }
  }, true);
  vp.addEventListener('pointerup', e => { if (dpSt.drag) { e.stopPropagation(); dpSt.drag = null; drawOverlay(); } }, true);
  vp.addEventListener('dblclick', e => {
    if (!active(e)) return;
    const [x, y] = evVp(e), hit = dpHit(x, y); if (!hit) return;
    e.stopPropagation();
    const d = dpDist(hit.w).axis;
    if (d > 0) { lensSet({ focusM: d, focusSrc: 'typed' }); toast(`Focus at ${fmt(d, 2)} m (the locator's distance to the camera)`); }
  }, true);
  window.addEventListener('keydown', e => {
    if (!dpOn() || st.mode !== 'depth' || !dpSt.sel) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { dpSt.list = dpSt.list.filter(l => l.id !== dpSt.sel); dpSt.sel = 0; drawOverlay(); e.preventDefault(); }
    else if (e.key === 'Escape') { dpSt.sel = 0; drawOverlay(); }
  });
  const f = drawOverlay; drawOverlay = function (...a) { const r = f(...a); dpDraw(); return r; };
}
