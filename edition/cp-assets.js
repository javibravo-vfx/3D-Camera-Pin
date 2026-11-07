// 3D Assets in the 3D Camera Pin edition (over js/assets3d.js of BackplateLab, without changing it):
// · the cars of the environment as pieces: with Car models › Car pack, the 9 cars of the pack (each one its own piece)
//   instead of the three box cars; with Simple boxes or My models, the box cars as before
// · on each viewport: Solid (the piece with its own colors and materials, lit, instead of the translucent violet),
//   Wire (its edges on or off), Move (drag the imported asset on the ground, Shift: up and down, to put it on the
//   pivot) and × (remove the asset: back to the piece of the environment)
// · Use high quality assets: the cars of the original pack (with its textures and materials), from this tab on: 3D
//   Assets and 3D Render use them; the tabs on the left keep the light pack. The original GLB is loaded once and kept
//   in the browser (IndexedDB).
(() => {
  if (typeof a3d === 'undefined' || typeof A3D_PIECES === 'undefined') return;
  const PK = { sedan: 'Sedan', hatchback: 'Hatchback', suv: 'SUV', compact: 'Compact', wagon: 'Wagon', minivan: 'Minivan', pickup: 'Pickup', coupe: 'Coupe', offroad: 'Off-road' };
  const pkId = (k) => 'pk_' + k;
  const HQ = { on: !!lsGet('cpHq', false), cars: null, state: 'none', name: '', err: '' }; // state: none | loading | ok | fail
  const lowOf = {}; // the parts of the light pack, kept to go back
  const SOLID = new THREE.MeshStandardMaterial({ color: 0x8c8c90, roughness: 0.6, metalness: 0 });
  const PAINT = [0x8a1f24, 0x1d3f7a, 0xd8d8d8, 0x2b2b2e, 0x6d7378, 0x8f6d2c, 0x1f5a3a, 0xb8b0a0, 0x5b2a6e];

  // ---------- the cars of the pack as pieces ----------
  const partsOf = (k) => (HQ.on && HQ.cars && HQ.cars[k]) ? HQ.cars[k].parts : (lowOf[k] || (PACK.cars[k] && PACK.cars[k].parts) || []);
  function pkGeos(k) {
    return partsOf(k).map((pt) => {
      const g = pt.geometry.clone().applyMatrix4(pt.matrix);
      g.userData.cpMat = pt.material; g.userData.cpPaint = !!pt.paint; g.userData.cpCar = k;
      return g;
    });
  }
  Object.keys(PK).forEach((k) => {
    A3D_PIECES[pkId(k)] = {
      name: 'Car · ' + PK[k], envs: [], key: 'z', anchor: ['c', 'min', 'c'], at: [null, 0, null],
      get len() { const c = HQ.on && HQ.cars && HQ.cars[k] ? HQ.cars[k] : PACK.cars[k]; return c ? c.L : 4.5; },
      note: 'A car of the pack of the environment: wheels on the ground, centred, front toward −Z.', geos: () => pkGeos(k),
    };
  });
  // the cars first (where the box cars were), then the rest of the pieces
  { const all = Object.entries(A3D_PIECES); for (const [k] of all) delete A3D_PIECES[k];
    for (const [k, v] of [...all.filter(([k]) => k.startsWith('pk_')), ...all.filter(([k]) => !k.startsWith('pk_'))]) A3D_PIECES[k] = v; }
  const BOX = ['sedan', 'hatch', 'suv'];
  const usesPack = () => { const s = env.vals && env.vals.carsrc; return s === 'pack' || s === 'procedural'; };
  // which car pieces the avenue has: the ones of the pack (when it is loaded) or the box cars
  function cpPieces() {
    const pack = usesPack() && PACK.state === 'ok';
    if (usesPack() && PACK.state === 'idle') loadPack();
    for (const k of Object.keys(PK)) A3D_PIECES[pkId(k)].envs = pack && PACK.cars[k] ? ['avenue'] : [];
    for (const k of BOX) A3D_PIECES[k].envs = pack ? [] : ['avenue'];
  }
  // a3d dropped the saved assets of the pieces it did not know yet (the cars of the pack): back, now that they exist
  {
    const s = lsGet('a3d', {}) || {}, items = a3dCleanItems(s.items);
    for (const k of Object.keys(items)) if (k.startsWith('pk_') && !a3d.items[k]) a3d.items[k] = items[k];
    if (Array.isArray(s.views)) s.views.slice(0, 4).forEach((v, i) => { if (String(v).startsWith('pk_') && A3D_PIECES[v]) a3d.views[i] = v; });
  }
  { const f = envRebuild; envRebuild = function (...a) { cpPieces(); return f.apply(this, a); }; }
  { const f = a3dShow; a3dShow = function (on, ...a) { if (on) cpPieces(); return f.call(this, on, ...a); }; }
  // the pack, once it is loaded (it loads with the first build that needs it)
  { const t = setInterval(() => { if (PACK.state === 'ok' || PACK.state === 'fail') { clearInterval(t); for (const k of Object.keys(PACK.cars)) lowOf[k] = PACK.cars[k].parts; if (a3d.on) { cpPieces(); a3dEnvChanged(true); a3dPanel(); } } }, 400); }

  // ---------- Solid, Wire, Move and × on each viewport ----------
  function look(p) {
    if (!p.base) return;
    p.base.traverse((o) => {
      if (o.isLineSegments) o.visible = p.cpWire !== false;
      else if (o.isMesh) {
        if (!o.userData.cpGhost) o.userData.cpGhost = o.material;
        if (!p.cpSolid) { o.material = o.userData.cpGhost; return; }
        const m = o.geometry.userData.cpMat;
        if (m && o.geometry.userData.cpPaint) {
          const i = Object.keys(PK).indexOf(o.geometry.userData.cpCar);
          o.material = o.userData.cpPaintMat || (o.userData.cpPaintMat = Object.assign((Array.isArray(m) ? m[0] : m).clone(), {})); o.material.color.setHex(PAINT[(i + PAINT.length) % PAINT.length]);
        } else o.material = m || SOLID;
      }
    });
  }
  { const f = a3dPaneScene; a3dPaneScene = function (p, ...a) { const r = f.call(this, p, ...a); look(p); return r; }; }
  const box = $('a3v');
  if (box) {
    for (const s of box.querySelectorAll('.a3p')) {
      const i = s.dataset.i, imp = s.querySelector('[data-act="import"]');
      imp.insertAdjacentHTML('beforebegin', `<button class="vpchip" data-cp="solid" data-i="${i}" aria-pressed="false" title="Solid: the piece with its own colors and materials, lit (off: the translucent violet to fit an asset over it)">Solid</button>
        <button class="vpchip" data-cp="wire" data-i="${i}" aria-pressed="true" title="The edges of the piece">Wire</button>
        <button class="vpchip" data-cp="move" data-i="${i}" aria-pressed="false" title="Move: drag the imported asset on the ground to put it on the pivot of the piece (Shift + drag: up and down). Alt + drag still orbits">Move</button>`);
      imp.insertAdjacentHTML('afterend', `<button class="btn sm ghost" data-cp="del" data-i="${i}" title="Remove the asset of this viewport: back to the piece of the environment (the car of the pack, light or high quality)" aria-label="Remove the asset of viewport ${+i + 1}">×</button>`);
    }
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cp]'); if (!b) return;
      const p = a3d.panes[+b.dataset.i]; if (!p) return;
      a3d.cur = p.i;
      if (b.dataset.cp === 'solid') { p.cpSolid = !p.cpSolid; look(p); }
      else if (b.dataset.cp === 'wire') { p.cpWire = p.cpWire === false; look(p); }
      else if (b.dataset.cp === 'move') p.cpMove = !p.cpMove;
      else if (b.dataset.cp === 'del') { const id = a3d.views[p.i]; if (a3d.items[id]) { delete a3d.items[id]; delete a3d.objs[id]; a3dSave(); a3dRefreshPanes([id]); toast(`${A3D_PIECES[id].name}: back to the piece of the environment`); } }
      a3dPanesUI(); a3dPanel(); a3dDirty();
    });
    // Move: the left button drags the asset (before the navigation of the viewport, which does not see it)
    for (const p of a3d.panes) {
      let drag = null;
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
      const at = (e, plane) => { const r = p.cv.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1)); ray.setFromCamera(ndc, p.cam); return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null; };
      p.cv.addEventListener('pointerdown', (e) => {
        const id = a3d.views[p.i], it = a3d.items[id];
        if (!p.cpMove || e.button !== 0 || e.altKey || !it || !p.wrap) return;
        e.preventDefault(); e.stopImmediatePropagation();
        a3d.cur = p.i;
        const t0 = { ...it.t }, o = new THREE.Vector3(t0.x, t0.y, t0.z), n = new THREE.Vector3();
        // on the ground: a horizontal plane through the asset; with Shift, a vertical one facing the camera
        const plane = e.shiftKey ? new THREE.Plane().setFromNormalAndCoplanarPoint(p.cam.getWorldDirection(n).setY(0).normalize().negate(), o) : new THREE.Plane(new THREE.Vector3(0, 1, 0), -o.y);
        const a = at(e, plane); if (!a) return;
        drag = { t0, a, plane, up: e.shiftKey, id: e.pointerId };
        p.cv.setPointerCapture(e.pointerId);
      }, true);
      p.cv.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        e.stopImmediatePropagation();
        const b = at(e, drag.plane); if (!b) return;
        const d = b.sub(drag.a), t = drag.t0;
        a3dSetT(drag.up ? { y: +(t.y + d.y).toFixed(4) } : { x: +(t.x + d.x).toFixed(4), z: +(t.z + d.z).toFixed(4) });
      }, true);
      const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; e.stopImmediatePropagation(); } };
      p.cv.addEventListener('pointerup', end, true); p.cv.addEventListener('pointercancel', end, true);
    }
  }
  {
    const f = a3dPanesUI;
    a3dPanesUI = function (...a) {
      const r = f.apply(this, a);
      for (const p of a3d.panes) {
        const s = $('a3v').querySelector(`.a3p[data-i="${p.i}"]`), id = a3d.views[p.i], it = a3d.items[id], has = !!(it && a3d.objs[id]);
        const set = (k, on, dis) => { const b = s.querySelector(`[data-cp="${k}"]`); if (!b) return; if (on !== null) b.setAttribute('aria-pressed', String(!!on)); b.disabled = !!dis; };
        set('solid', p.cpSolid, !id); set('wire', p.cpWire !== false, !id); set('move', p.cpMove && has, !has); set('del', null, !it);
        s.querySelector('.a3b').classList.toggle('cp-moving', !!(p.cpMove && has));
      }
      return r;
    };
  }

  // ---------- Use high quality assets ----------
  const IDB = { db: null };
  const idb = () => IDB.db ? Promise.resolve(IDB.db) : new Promise((res, rej) => { const q = indexedDB.open('cp-hq', 1); q.onupgradeneeded = () => q.result.createObjectStore('f'); q.onsuccess = () => res(IDB.db = q.result); q.onerror = () => rej(q.error); });
  const idbGet = async (k) => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('f').objectStore('f').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
  const idbPut = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('f', 'readwrite'); t.objectStore('f').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); };
  const idbDel = async (k) => { const db = await idb(); return new Promise((res) => { const t = db.transaction('f', 'readwrite'); t.objectStore('f').delete(k); t.oncomplete = () => res(); t.onerror = () => res(); }); };
  // a few numbers of the shape along the car (front against back): the light pack has the same mesh, so they tell
  // which way the original car looks
  function shapeStats(list) {
    let n = 0, zy = 0, z3 = 0, ym = 0, L = 1;
    const pts = [];
    for (const [g, m] of list) {
      const pos = g.attributes.position, step = Math.max(1, Math.floor(pos.count / 4000)), v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(m); pts.push(v.y, v.z); }
    }
    n = pts.length / 2; if (!n) return [0, 0];
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < n; i++) { ym += pts[i * 2]; zmin = Math.min(zmin, pts[i * 2 + 1]); zmax = Math.max(zmax, pts[i * 2 + 1]); }
    ym /= n; L = Math.max(1e-6, (zmax - zmin) / 2); const zc = (zmax + zmin) / 2;
    for (let i = 0; i < n; i++) { const y = pts[i * 2] - ym, z = (pts[i * 2 + 1] - zc) / L; zy += z * y; z3 += z * z * z; }
    return [zy / n, z3 / n];
  }
  // the original pack ("Generic passenger car pack", Sketchfab): each "<Name> body" with its four "Wheel" nodes, turned
  // and placed like the light pack (tools/convert_cars.py): length along Z, front toward −Z, centred, ground at y = 0
  function hqAlign(scene) {
    scene.updateMatrixWorld(true);
    const bodies = {}, wheels = [];
    scene.traverse((o) => {
      const nm = o.name || '';
      if (/[\s_]body$/i.test(nm)) bodies[nm.split(/[\s_]/)[0].toLowerCase()] = o;
      else if (/^wheel/i.test(nm) && !o.isMesh && !(o.parent && /^wheel/i.test(o.parent.name || ''))) wheels.push(o);
    });
    const P = new THREE.Vector3(), out = {};
    const wheelOf = {}; for (const k of Object.keys(bodies)) wheelOf[k] = [];
    for (const w of wheels) {
      w.getWorldPosition(P); let best = null, bd = Infinity;
      for (const [k, b] of Object.entries(bodies)) { const d = b.getWorldPosition(new THREE.Vector3()).distanceTo(P); if (d < bd) { bd = d; best = k; } }
      if (best) wheelOf[best].push(w);
    }
    for (const [k, body] of Object.entries(bodies)) {
      if (!PACK.cars[k]) continue; // the sports car is not in the pack
      const meshes = [];
      body.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const w of wheelOf[k]) w.traverse((o) => { if (o.isMesh) meshes.push(o); });
      if (!meshes.length) continue;
      // the length: the main axis of the four wheels on the ground (or of the whole car)
      const wc = wheelOf[k].map((w) => w.getWorldPosition(new THREE.Vector3()));
      let yaw = 0;
      if (wc.length >= 3) {
        const mx = wc.reduce((a, v) => a + v.x, 0) / wc.length, mz = wc.reduce((a, v) => a + v.z, 0) / wc.length;
        let a = 0, b = 0, c = 0; for (const v of wc) { const x = v.x - mx, z = v.z - mz; a += x * x; b += x * z; c += z * z; }
        // the main axis is (cos th, sin th) in x, z; the car is turned so that it goes along +Z
        const th = 0.5 * Math.atan2(2 * b, a - c); yaw = Math.atan2(Math.cos(th), Math.sin(th));
      } else {
        const bb = new THREE.Box3(); meshes.forEach((m) => bb.expandByObject(m)); const s = bb.getSize(new THREE.Vector3()); yaw = s.x > s.z ? Math.PI / 2 : 0;
      }
      const bb0 = new THREE.Box3(); meshes.forEach((m) => bb0.expandByObject(m));
      const cen = bb0.getCenter(new THREE.Vector3());
      const M0 = new THREE.Matrix4().makeRotationY(-yaw).multiply(new THREE.Matrix4().makeTranslation(-cen.x, -cen.y, -cen.z));
      const bb1 = new THREE.Box3(); for (const m of meshes) { m.geometry.computeBoundingBox(); bb1.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(M0, m.matrixWorld))); }
      const c1 = bb1.getCenter(new THREE.Vector3());
      const M1 = new THREE.Matrix4().makeTranslation(-c1.x, -bb1.min.y, -c1.z).multiply(M0);
      // which way it looks: the one that has the shape of the light car
      const low = shapeStats((lowOf[k] || PACK.cars[k].parts).map((pt) => [pt.geometry, pt.matrix]));
      const hi = shapeStats(meshes.map((m) => [m.geometry, new THREE.Matrix4().multiplyMatrices(M1, m.matrixWorld)]));
      const dPlus = Math.abs(hi[0] - low[0]) + Math.abs(hi[1] - low[1]), dMinus = Math.abs(-hi[0] - low[0]) + Math.abs(-hi[1] - low[1]);
      const F = dMinus < dPlus ? new THREE.Matrix4().makeRotationY(Math.PI) : new THREE.Matrix4();
      const M = new THREE.Matrix4().multiplyMatrices(F, M1);
      const parts = meshes.map((m) => ({ geometry: m.geometry, material: m.material, matrix: new THREE.Matrix4().multiplyMatrices(M, m.matrixWorld) }));
      const bb2 = new THREE.Box3(); for (const pt of parts) bb2.union(pt.geometry.boundingBox.clone().applyMatrix4(pt.matrix));
      out[k] = { parts, L: bb2.max.z - bb2.min.z };
    }
    return out;
  }
  async function hqParse(buf, name) {
    HQ.state = 'loading'; HQ.err = ''; hqUI();
    try {
      if (PACK.state === 'idle') loadPack();
      for (let i = 0; i < 100 && PACK.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 100));
      if (PACK.state !== 'ok') throw new Error('the light pack (assets/cars.js) did not load: it is needed to place the cars');
      for (const k of Object.keys(PACK.cars)) if (!lowOf[k]) lowOf[k] = PACK.cars[k].parts;
      const g = await new Promise((res, rej) => makeGLTFLoader().parse(buf, '', res, rej));
      const cars = hqAlign(g.scene), n = Object.keys(cars).length;
      if (!n) throw new Error('no cars found: it has to be the original GLB of "Generic passenger car pack" (each car a "<Name> body" with its "Wheel" nodes)');
      HQ.cars = cars; HQ.state = 'ok'; HQ.name = name;
      toast(`High quality cars: ${n} of ${Object.keys(PACK.cars).length} (${name})`);
    } catch (e) { console.error(e); HQ.state = 'fail'; HQ.err = e.message || String(e); HQ.cars = null; toast('High quality assets: ' + HQ.err, true); }
    hqUI(); hqApplied();
  }
  async function hqBoot() {
    if (HQ.cars || HQ.state === 'loading') return;
    try { const f = await idbGet('pack'); if (f && f.buf) { await hqParse(f.buf, f.name); return; } } catch (e) { console.warn('hq idb', e); }
    HQ.state = 'none'; hqUI();
  }
  // where the cars change: the bases of 3D Assets, and the environment of 3D Render while it is open
  function hqApplied() {
    for (const k of Object.keys(PK)) delete a3dBaseBox[pkId(k)];
    if (a3d.on) { a3dEnvChanged(true); a3dPanel(); }
    if (typeof r3 !== 'undefined' && r3.on && hqSwap(true)) envRebuild();
  }
  // the cars of 3D Render: for each car of the pack, the asset imported for it in 3D Assets (with its fit), or else the
  // high quality one (Use high quality assets), or else the light one. The tabs on the left always get the light one.
  let swapped = '';
  function importedCar(k) {
    // the asset of the car of the pack or, imported with Simple boxes, the one of its box car
    const BOXOF = { sedan: 'sedan', hatchback: 'hatch', suv: 'suv' };
    let id = pkId(k); if (!(a3d.items[id] && a3d.objs[id]) && BOXOF[k]) id = BOXOF[k];
    const it = a3d.items[id], obj = a3d.objs[id];
    if (!it || !obj) return null;
    // the same transform as in the viewport of 3D Assets: the fit (t) over the asset centred on its bounding box
    const c = obj.userData.a3dC || [0, 0, 0], g = new THREE.Group(); a3dApplyT(g, it.t);
    const W = new THREE.Matrix4().multiplyMatrices(g.matrixWorld, new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
    obj.updateMatrixWorld(true);
    const parts = [];
    obj.traverse((o) => { if (o.isMesh && o.geometry) parts.push({ geometry: o.geometry, material: o.material, matrix: new THREE.Matrix4().multiplyMatrices(W, o.matrixWorld) }); });
    if (!parts.length) return null;
    const bb = new THREE.Box3(); for (const pt of parts) { if (!pt.geometry.boundingBox) pt.geometry.computeBoundingBox(); bb.union(pt.geometry.boundingBox.clone().applyMatrix4(pt.matrix)); }
    return { parts, L: Math.max(0.5, bb.max.z - bb.min.z), name: it.name + JSON.stringify(it.t) };
  }
  function hqSwap(on) {
    if (PACK.state !== 'ok') return false;
    const pick = {};
    for (const k of Object.keys(PACK.cars)) pick[k] = on ? (importedCar(k) || (HQ.on && HQ.cars && HQ.cars[k]) || null) : null;
    const sig = on ? Object.keys(pick).map((k) => pick[k] ? (pick[k].name ? 'i:' + pick[k].name + pick[k].parts.length + pick[k].L.toFixed(4) : 'hq') : 'low').join('|') : '';
    if (sig === swapped) return false;
    for (const k of Object.keys(PACK.cars)) {
      if (!lowOf[k]) lowOf[k] = PACK.cars[k].parts;
      if (!PACK.cars[k].lowL) PACK.cars[k].lowL = PACK.cars[k].L;
      const h = pick[k];
      PACK.cars[k].parts = h ? h.parts : lowOf[k]; PACK.cars[k].L = h ? h.L : PACK.cars[k].lowL;
    }
    const had = swapped !== '' && !/^(low\|)*low$/.test(swapped);
    swapped = sig;
    return had || (on && !/^(low\|)*low$/.test(sig));
  }
  // the tabs call 3D Render through r3dShow (a copy of r3Show): the cars change after the tab does
  let r3was = false;
  function r3Follow() {
    const on = typeof r3 !== 'undefined' && !!r3.on; if (on === r3was) return; r3was = on;
    if (on) {
      if (PACK.state === 'idle') loadPack();
      if (hqSwap(true)) envRebuild();
      const n = Object.keys(PACK.cars).filter((k) => importedCar(k)).length;
      if (n) toast(`3D Render: ${n} car${n > 1 ? 's' : ''} of the pack with the asset of 3D Assets`);
    } else if (hqSwap(false)) envRebuild();
  }
  if (typeof mtabShow === 'function') { const f = mtabShow; mtabShow = function (...a) { const r = f.apply(this, a); try { r3Follow(); } catch (e) { console.error(e); } return r; }; }
  // the pack loaded while 3D Render is open: its cars, too
  { const t = setInterval(() => { if (PACK.state === 'ok') { clearInterval(t); if (typeof r3 !== 'undefined' && r3.on && hqSwap(true)) envRebuild(); } else if (PACK.state === 'fail') clearInterval(t); }, 500); }
  // the panel of 3D Assets
  const sec = $('a3') && $('a3').querySelector('.body');
  if (sec) {
    sec.insertAdjacentHTML('afterbegin', `<div class="cp-hq" id="cp-hq">
      <label class="fld chk" for="cp-hq-on" title="From this tab on (3D Assets and 3D Render) the cars are the ones of the original pack, with their textures and materials; the tabs on the left keep the light pack"><input id="cp-hq-on" type="checkbox"> Use high quality assets</label>
      <p class="note" id="cp-hq-st"></p>
      <div class="row k"><span class="file btn sm">Load the original pack…<input id="cp-hq-f" type="file" accept=".glb,.gltf"></span><button class="btn sm ghost" id="cp-hq-x" title="Forget the original pack kept in this browser">Forget it</button></div>
    </div>`);
    $('cp-hq-on').checked = HQ.on;
    $('cp-hq-on').onchange = () => { HQ.on = $('cp-hq-on').checked; lsSet('cpHq', HQ.on); if (HQ.on && !HQ.cars) hqBoot(); hqUI(); hqApplied(); };
    $('cp-hq-f').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const buf = await f.arrayBuffer();
      try { await idbPut('pack', { name: f.name, buf }); } catch (err) { console.warn('hq idb', err); toast('Could not keep the pack in the browser: it is used until the page is closed', true); }
      HQ.on = true; lsSet('cpHq', true); $('cp-hq-on').checked = true;
      await hqParse(buf, f.name);
    };
    $('cp-hq-x').onclick = async () => { await idbDel('pack'); HQ.cars = null; HQ.state = 'none'; HQ.name = ''; hqUI(); hqApplied(); };
  }
  function hqUI() {
    const el = $('cp-hq-st'); if (!el) return;
    el.textContent = HQ.state === 'loading' ? 'Loading the original pack…'
      : HQ.state === 'ok' ? `${HQ.on ? 'On' : 'Off'}: ${Object.keys(HQ.cars).length} cars of ${HQ.name}. ${HQ.on ? '3D Assets and 3D Render use them; the tabs on the left keep the light pack.' : ''}`
      : HQ.state === 'fail' ? 'Could not use it: ' + HQ.err
      : 'It needs the original GLB of the car pack, once: "Generic passenger car pack" by Comrade1280 on Sketchfab (CC BY 4.0, the one of the light pack). Download it as glTF Binary (.glb) and load it here; it stays in this browser.';
    $('cp-hq-x').disabled = HQ.state !== 'ok' && HQ.state !== 'fail';
  }
  hqUI();
  if (HQ.on) hqBoot();
  window.CP_HQ = HQ; // for the tests
  window.cpHqAlign = hqAlign; // for the tests
})();
