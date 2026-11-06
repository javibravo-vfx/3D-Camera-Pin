// ---------- Environment modules (independent of the scan, world meters, Y up) ----------
// Each module: { name, params: [{ key, label, type: 'num'|'bool', min, max, step, def, unit }], build(p, rng) -> THREE.Object3D }
// Shared transform params (position, rotation) are added by the host, so modules only describe their own content.
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const ENV_MAT = {
  asphalt: new THREE.MeshLambertMaterial({ color: 0x3b3c3f }),
  paintW: new THREE.MeshBasicMaterial({ color: 0xe9e9e4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  paintY: new THREE.MeshBasicMaterial({ color: 0xe0b437, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  walk: new THREE.MeshLambertMaterial({ color: 0x9a978f }),
  median: new THREE.MeshLambertMaterial({ color: 0x5f6b4e }),
  building: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  car: new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 60, specular: 0x333333 }),
  glass: new THREE.MeshPhongMaterial({ color: 0x151b21, shininess: 90, specular: 0x666666 }),
  tire: new THREE.MeshLambertMaterial({ color: 0x141414 }),
  pole: new THREE.MeshLambertMaterial({ color: 0x55585c }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xfff4dc }),
  window: new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 90, specular: 0x555555 }),
  door: new THREE.MeshLambertMaterial({ color: 0x3a2e26 }),
};
// DepthLab's facade palette (StreetScene.cpp), brick, stone and concrete
const FACADE_COLORS = [0x9a8270, 0xaca295, 0x8a8787, 0xb08a70, 0x939799, 0xbcb19f];
const CAR_COLORS = [0xe8e8e6, 0xe8e8e6, 0xb9bcc0, 0xb9bcc0, 0x2a2c30, 0x1b1c1e, 0x5d6166, 0x8c1c1c, 0x1f3f78, 0x6b7f8c];
function boxAt(w, h, d, x, y, z, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
// one instanced set of cars; cars: [{ x, z, dir(+1 drives toward -Z, -1 toward +Z), len, wid, color }]
// Car body types in meters (real-world sizes). Profile points are [z, y] along the car's length, front at -z.
const CAR_TYPES = {
  sedan: { L: 4.65, W: 1.82, H: 1.45, wheelR: 0.32, wheelbase: 2.75, clear: 0.15, weight: 0.45,
    lower: [[-2.325, 0.22], [-2.325, 0.62], [-2.2, 0.72], [-1.15, 0.86], [-0.75, 0.92], [1.55, 0.92], [2.25, 0.86], [2.325, 0.72], [2.325, 0.25]],
    cabin: [[-0.95, 0.9], [-0.25, 1.42], [0.85, 1.43], [1.55, 0.95]] },
  hatch: { L: 4.1, W: 1.76, H: 1.48, wheelR: 0.31, wheelbase: 2.55, clear: 0.15, weight: 0.3,
    lower: [[-2.05, 0.22], [-2.05, 0.62], [-1.9, 0.72], [-1.0, 0.86], [-0.65, 0.92], [1.85, 0.94], [2.05, 0.9], [2.05, 0.25]],
    cabin: [[-0.82, 0.9], [-0.1, 1.45], [1.55, 1.44], [1.98, 0.95]] },
  suv: { L: 4.7, W: 1.9, H: 1.72, wheelR: 0.36, wheelbase: 2.8, clear: 0.2, weight: 0.25,
    lower: [[-2.35, 0.28], [-2.35, 0.8], [-2.2, 0.92], [-1.25, 1.05], [-0.85, 1.1], [2.15, 1.12], [2.35, 1.0], [2.35, 0.3]],
    cabin: [[-1.05, 1.08], [-0.35, 1.7], [1.85, 1.7], [2.25, 1.12]] },
};
function carGeoms(t) {
  const prof = (pts) => { const sh = new THREE.Shape(); pts.forEach(([z, y], i) => i ? sh.lineTo(z, y) : sh.moveTo(z, y)); sh.closePath(); return sh; };
  const ex = (pts, w, bevel) => {
    const g = new THREE.ExtrudeGeometry(prof(pts), { depth: w - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1 });
    g.translate(0, 0, -(w - 2 * bevel) / 2); // centre the width on z
    g.rotateY(-Math.PI / 2);                 // shape x (length) -> world z, extrusion -> world x
    return g;
  };
  const lowerPts = t.lower.concat([[t.lower[0][0], t.clear + 0.05]]).slice(0, -1);
  const body = ex(lowerPts, t.W, 0.06);
  // cabin: glass greenhouse, narrower; roof slab painted
  const cab = ex(t.cabin, t.W * 0.86, 0.05);
  const rz0 = t.cabin[1][0] + 0.12, rz1 = t.cabin[2][0] - 0.12, ry = t.cabin[1][1];
  const roof = new THREE.BoxGeometry(t.W * 0.8, 0.05, rz1 - rz0).translate(0, ry + 0.02, (rz0 + rz1) / 2);
  const lampF = new THREE.BoxGeometry(0.32, 0.08, 0.04), lampR = new THREE.BoxGeometry(0.34, 0.09, 0.04);
  return { body, cab, roof, lampF, lampR };
}
const CAR_GEO = {};
function buildCars(cars) {
  const g = new THREE.Group(); g.userData.guide = 'cars'; // las 3D Guides los pueden dejar afuera (js/guides.js)
  if (!cars.length) return g;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 18).rotateZ(Math.PI / 2);
  const lampMatF = new THREE.MeshBasicMaterial({ color: 0xf2f0e6 }), lampMatR = new THREE.MeshBasicMaterial({ color: 0x9c1a1a });
  for (const [type, t] of Object.entries(CAR_TYPES)) {
    const list = cars.filter(c => c.type === type); const n = list.length; if (!n) continue;
    const G = CAR_GEO[type] || (CAR_GEO[type] = carGeoms(t));
    const body = new THREE.InstancedMesh(G.body, ENV_MAT.car, n), roof = new THREE.InstancedMesh(G.roof, ENV_MAT.car, n);
    const cab = new THREE.InstancedMesh(G.cab, ENV_MAT.glass, n), wheels = new THREE.InstancedMesh(wheelGeo, ENV_MAT.tire, n * 4);
    const lf = new THREE.InstancedMesh(G.lampF, lampMatF, n * 2), lr = new THREE.InstancedMesh(G.lampR, lampMatR, n * 2);
    const W = new THREE.Matrix4(), L = new THREE.Matrix4();
    list.forEach((c, i) => {
      q.setFromAxisAngle(up, c.dir > 0 ? 0 : Math.PI);
      if (c.roll) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), c.roll));
      W.compose(v.set(c.x, c.y || 0, c.z), q, s.set(c.k, c.k, c.k));
      body.setMatrixAt(i, W); roof.setMatrixAt(i, W); cab.setMatrixAt(i, W);
      body.setColorAt(i, col.setHex(c.color)); roof.setColorAt(i, col.setHex(c.color));
      const hw = t.W / 2 - 0.12, hb = t.wheelbase / 2, zc = (t.lower[0][0] + t.lower[t.lower.length - 1][0]) / 2;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], k) => {
        L.compose(v.set(sx * hw, t.wheelR, zc + sz * hb), new THREE.Quaternion(), s.set(0.23, t.wheelR, t.wheelR));
        wheels.setMatrixAt(i * 4 + k, m.multiplyMatrices(W, L));
      });
      [-1, 1].forEach((sx, k) => {
        L.makeTranslation(sx * (t.W / 2 - 0.3), t.lower[2][1] - 0.06, t.lower[0][0] - 0.01); lf.setMatrixAt(i * 2 + k, m.multiplyMatrices(W, L));
        const last = t.lower[t.lower.length - 2];
        L.makeTranslation(sx * (t.W / 2 - 0.28), last[1] - 0.08, last[0] + 0.01); lr.setMatrixAt(i * 2 + k, m.multiplyMatrices(W, L));
      });
    });
    body.instanceColor.needsUpdate = true; roof.instanceColor.needsUpdate = true;
    [[body, 1], [roof, 1], [cab, 1], [wheels, 4], [lf, 2], [lr, 2]].forEach(([im, per]) => envTagCars(im, list, per));
    g.add(body, roof, cab, wheels, lf, lr);
  }
  return g;
}
// default car pack: "Generic passenger car pack" by Comrade1280 (Sketchfab), CC BY 4.0, converted to cars.glb
// (front at -Z, Y up, metres, ground at y = 0; *_paint parts take the per-car colour)
const PACK = { state: 'idle', cars: {} };
const PACK_WEIGHTS = { sedan: 0.2, hatchback: 0.17, suv: 0.16, compact: 0.12, wagon: 0.08, minivan: 0.08, pickup: 0.09, coupe: 0.05, offroad: 0.05 };
function loadPack() {
  if (PACK.state !== 'idle') return;
  PACK.state = 'loading';
  const mat = (o) => new THREE.MeshPhongMaterial(Object.assign({ color: 0xffffff, vertexColors: true, shininess: 30, specular: 0x222222 }, o));
  const M = { paint: mat({ shininess: 70, specular: 0x444444 }), trim: mat(), wheel: mat({ shininess: 10, specular: 0x111111 }), optics: mat({ shininess: 90, specular: 0x666666 }), glass: ENV_MAT.glass };
  const fail = e => { console.warn('car pack', e); PACK.state = 'fail'; if (env.vals.carsrc === 'pack' || env.vals.carsrc === 'procedural') { toast('Could not load the car pack (cars.js); showing simple boxes', true); envRebuild(); } };
  const parse = () => {
    const bin = atob(window.CARPACK_B64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(u8.buffer, '', onPack, fail);
  };
  if (window.CARPACK_B64) { parse(); return; }
  const sc = document.createElement('script'); sc.src = 'assets/cars.js';
  sc.onload = () => { try { parse(); } catch (e) { fail(e); } }; sc.onerror = fail; document.head.appendChild(sc);
  function onPack(g) {
    g.scene.updateMatrixWorld(true);
    g.scene.children.forEach(car => {
      const parts = []; let L = 0;
      car.traverse(o => {
        if (!o.isMesh) return;
        const kind = o.name.split('_').pop(); o.geometry.computeBoundingBox(); L = Math.max(L, o.geometry.boundingBox.max.z - o.geometry.boundingBox.min.z);
        parts.push({ geometry: o.geometry, material: M[kind] || M.trim, matrix: o.matrixWorld.clone(), paint: kind === 'paint' });
      });
      PACK.cars[car.name] = { name: car.name, parts, L };
    });
    PACK.state = 'ok';
    if (env.vals.carsrc === 'pack' || env.vals.carsrc === 'procedural') envRebuild();
  }
}
function pickPackCar(rng) {
  let r = rng() * Object.values(PACK_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(PACK_WEIGHTS)) { if ((r -= w) < 0 && PACK.cars[k]) return PACK.cars[k]; }
  return Object.values(PACK.cars)[0];
}

// user car models (session only): normalized to Y up, length along Z, front at -Z, bottom at y = 0, centred
const userCars = [];
function addUserCar(obj, name) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj), sz = b.getSize(new THREE.Vector3());
  const norm = new THREE.Matrix4();
  if (sz.x > sz.z) norm.makeRotationY(Math.PI / 2); // longest horizontal side along Z
  const b2 = new THREE.Box3().setFromObject(obj).applyMatrix4(norm), s2 = b2.getSize(new THREE.Vector3());
  const L = s2.z, k = L >= 2.5 && L <= 8 ? 1 : 4.6 / L; // already in meters, or rescale to a 4.6 m car
  const c = b2.getCenter(new THREE.Vector3());
  const N = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, -b2.min.y, -c.z)).multiply(norm);
  const parts = [];
  obj.traverse(o => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, matrix: N.clone().multiply(o.matrixWorld) }); });
  if (parts.length) userCars.push({ name, parts, L: L * k });
}
async function loadCarFiles(files) {
  for (const f of files) {
    const ext = f.name.split('.').pop().toLowerCase(), buf = await f.arrayBuffer();
    try {
      let obj;
      if (ext === 'glb' || ext === 'gltf') obj = await new Promise((res, rej) => makeGLTFLoader().parse(buf, '', g => res(g.scene), rej));
      else if (ext === 'fbx') obj = new THREE.FBXLoader().parse(buf, '');
      else obj = new THREE.OBJLoader().parse(new TextDecoder().decode(buf));
      addUserCar(obj, f.name);
    } catch (e) { console.error(e); toast('Could not read ' + f.name + ': ' + (e && e.message || e), true); }
  }
  $('cars-n').textContent = userCars.length ? userCars.map(c => c.name).join(', ') : 'none';
  if (userCars.length && env.vals.carsrc !== 'custom') envSet('carsrc', 'custom'); else envRebuild();
}
function buildUserCars(cars, flip, models = userCars) {
  const g = new THREE.Group(), col = new THREE.Color(); g.userData.guide = 'cars';
  models.forEach((uc, mi) => {
    const list = cars.filter(c => c.model === mi); if (!list.length) return;
    const W = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();
    uc.parts.forEach(pt => {
      const im = new THREE.InstancedMesh(pt.geometry, pt.material, list.length);
      list.forEach((c, i) => {
        q.setFromAxisAngle(up, (c.dir > 0 ? 0 : Math.PI) + (flip ? Math.PI : 0));
        if (c.roll) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), c.roll));
        W.compose(v.set(c.x, c.y || 0, c.z), q, one);
        im.setMatrixAt(i, m.multiplyMatrices(W, pt.matrix));
        if (pt.paint) im.setColorAt(i, col.setHex(c.color));
      });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      envTagCars(im, list, 1);
      g.add(im);
    });
  });
  return g;
}
// cada instancia de un auto del tráfico sabe de qué auto es (per instancias por auto) y guarda su matriz de
// arranque: así el tráfico puede frenar auto por auto delante de la caja del auto de la toma (js/car-box.js)
function envTagCars(im, list, per) { im.userData.cars = list; im.userData.per = per; im.userData.base = im.instanceMatrix.array.slice(); }
function pickCarType(rng) {
  let r = rng(), acc = 0;
  for (const [k, t] of Object.entries(CAR_TYPES)) { acc += t.weight; if (r < acc) return k; }
  return 'sedan';
}
const ENV_MODULES = {
  avenue: {
    name: 'Avenue / street',
    params: [
      { key: 'flow', label: 'Traffic flow', type: 'select', options: [['one', 'One-way'], ['two', 'Two-way']], def: 'one', tip: 'One-way: every lane drives the same way as the shot\'s car. Two-way: the left lanes are oncoming.' },
      { key: 'lanesR', label: 'Lanes right', type: 'num', min: 0, max: 6, step: 1, def: 3, tip: 'Lanes right of the centre line (+X). With two-way traffic they drive the same way as the shot\'s car (toward −Z).' },
      { key: 'lanesL', label: 'Lanes left', type: 'num', min: 0, max: 6, step: 1, def: 2, tip: 'Lanes left of the centre line (−X). With two-way traffic they are the oncoming lanes.' },
      { key: 'ownLane', label: 'Shot car lane', type: 'num', min: 0, max: 12, step: 1, def: 3, tip: 'Lane of the shot\'s car, counted from the left curb (1 = next to the left curb). The street moves so that lane is under the car. 0: place the street with Offset X.' },
      { key: 'parkL', label: 'Parked lane left', type: 'bool', def: true, tip: 'The lane next to the left curb is for parked cars: still, in a row, with gaps.' },
      { key: 'parkR', label: 'Parked lane right', type: 'bool', def: true, tip: 'The lane next to the right curb is for parked cars: still, in a row, with gaps.' },
      { key: 'parked', label: 'Parked cars', type: 'num', min: 0.05, max: 1, step: 0.05, def: 0.75, tip: 'How full the parked lanes are (1 = no gaps).' },
      { key: 'laneW', label: 'Lane width', type: 'num', min: 2.5, max: 5, step: 0.05, def: 3.2, unit: 'm' },
      { key: 'median', label: 'Median', type: 'num', min: 0, max: 20, step: 0.5, def: 0, unit: 'm' },
      { key: 'walk', label: 'Sidewalk', type: 'num', min: 0, max: 12, step: 0.5, def: 4, unit: 'm' },
      { key: 'crown', label: 'Road crown', type: 'num', min: 0, max: 0.6, step: 0.01, def: 0, unit: 'm', tip: 'How much lower the road is at the curb than at the centre line (0 = flat). Cars sitting on it lean with it.' },
      { key: 'crownP', label: 'Crown curve', type: 'num', min: 1, max: 4, step: 0.1, def: 2, tip: '1 = straight slope; higher = flatter in the middle and curving down harder near the curb.' },
      { key: 'length', label: 'Length', type: 'num', min: 50, max: 1000, step: 10, def: 300, unit: 'm' },
      { key: 'reverse', label: 'Reverse direction', type: 'bool', def: false },
      { key: 'cars', label: 'Cars', type: 'bool', def: true },
      { key: 'carsrc', label: 'Car models', type: 'select', options: [['pack', 'Car pack (9 models)'], ['simple', 'Simple boxes'], ['custom', 'My models']], def: 'pack' },
      { key: 'flipcars', label: 'Flip model front', type: 'bool', def: false },
      { key: 'density', label: 'Traffic', type: 'num', min: 0.05, max: 1, step: 0.05, def: 0.45 },
      { key: 'clear', label: 'Clear zone', type: 'num', min: 0, max: 50, step: 1, def: 10, unit: 'm' },
      { key: 'lights', label: 'Street lights', type: 'bool', def: true },
      { key: 'buildings', label: 'Facades', type: 'bool', def: true, tip: 'Rows of buildings behind the sidewalks, with doors (0.9 × 2.1 m) and shop windows at street level and windows on every floor.' },
      { key: 'people', label: 'Pedestrians', type: 'bool', def: true, tip: 'People 1.6 to 1.85 m tall on the sidewalks, some standing and some walking (they walk on play with Motion on).' },
      { key: 'peds', label: 'Pedestrian density', type: 'num', min: 0.02, max: 1, step: 0.02, def: 0.3 },
      { key: 'walkers', label: 'Walking', type: 'num', min: 0, max: 1, step: 0.05, def: 0.4, tip: 'Share of the pedestrians that walk; the rest stand.' },
    ],
    // valores de una avenida guardada antes de que existieran estos ajustes: queda como era (sin estacionados ni
    // gente, y la calle donde la ponía Offset X)
    legacy: { ownLane: 0, parkL: false, parkR: false, people: false },
    presets: [
      ['One-way, 5 lanes', 'Parked | moving | the shot\'s car | moving | parked, every lane the same way', { flow: 'one', reverse: false, lanesL: 2, lanesR: 3, ownLane: 3, parkL: true, parkR: true, laneW: 3.2, median: 0 }],
      ['Two-way, 3 + 3', 'Three lanes each way with a median; the shot\'s car in the middle lane of its side', { flow: 'two', reverse: false, lanesL: 3, lanesR: 3, ownLane: 5, parkL: false, parkR: false, laneW: 3.5, median: 2 }],
    ],
    build(p, rng, origin) {
      const g = new THREE.Group(), A = avenueLayout(p);
      const lw = p.laneW, med = p.median, len = p.length, cr = p.crown || 0;
      const { rightN, leftN, xR, xL, crownY, crownS, edgeY, edgeX, lanes, dashes } = A, oneWay = A.oneWay;
      const roadGeo = new THREE.PlaneGeometry(xR - xL, len, cr > 0 ? 96 : 1, 1).rotateX(-Math.PI / 2).translate((xR + xL) / 2, 0, 0);
      if (cr > 0) { const pa = roadGeo.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, crownY(pa.getX(i))); pa.needsUpdate = true; roadGeo.computeVertexNormals(); }
      const road = new THREE.Mesh(roadGeo, ENV_MAT.asphalt); g.add(road);
      // markings (lanes and dashes: avenueLayout)
      const dashLen = 3, gap = 9, lineW = 0.12;
      const nD = Math.floor(len / (dashLen + gap));
      if (dashes.length && nD) {
        const dm = new THREE.InstancedMesh(new THREE.PlaneGeometry(lineW, dashLen).rotateX(-Math.PI / 2), ENV_MAT.paintW, dashes.length * nD);
        const m = new THREE.Matrix4(); let k = 0;
        const dq = new THREE.Quaternion(), dv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zA = new THREE.Vector3(0, 0, 1);
        for (const x of dashes) { dq.setFromAxisAngle(zA, Math.atan(crownS(x))); for (let j = 0; j < nD; j++) { m.compose(dv.set(x, crownY(x) + 0.005, -len / 2 + (j + 0.5) * (dashLen + gap)), dq, one); dm.setMatrixAt(k++, m); } }
        g.add(dm);
      }
      const solid = (x, mat) => { const l = new THREE.Mesh(new THREE.PlaneGeometry(lineW * 1.2, len).rotateX(-Math.PI / 2), mat); l.position.set(x, crownY(x) + 0.005, 0); l.rotation.z = Math.atan(crownS(x)); g.add(l); };
      solid(xR - 0.3, ENV_MAT.paintW); solid(xL + 0.3, ENV_MAT.paintW);
      if (med >= 0.6) {
        const md = boxAt(med, 0.18, len, 0, 0.09, 0, ENV_MAT.median); g.add(md);
        const mc = oneWay ? ENV_MAT.paintW : ENV_MAT.paintY;
        if (rightN) solid(med / 2 + 0.25, mc);
        if (leftN) solid(-med / 2 - 0.25, mc);
      } else if (leftN && rightN && !oneWay) { solid(0.1, ENV_MAT.paintY); solid(-0.1, ENV_MAT.paintY); }
      // sidewalks with curb
      if (p.walk > 0) for (const sgn of [1, -1]) g.add(boxAt(p.walk, 0.15, len, edgeX(sgn) + sgn * p.walk / 2, 0.075 + edgeY(sgn), 0, ENV_MAT.walk));
      // street lights: pole, arm and a lit lamp (a point of light for the bokeh / Z defocus)
      if (p.lights) {
        const step = 30, inset = Math.min(p.walk, 1.2) * 0.5 + 0.3;
        for (let z = -len / 2 + 10; z < len / 2; z += step) for (const sgn of [1, -1]) {
          const x = edgeX(sgn) + sgn * inset, y0 = edgeY(sgn) + 0.15;
          g.add(boxAt(0.18, 8, 0.18, x, 4 + y0, z, ENV_MAT.pole));
          g.add(boxAt(2.2, 0.15, 0.25, x - sgn * 1.1, 8 + y0, z, ENV_MAT.pole));
          g.add(boxAt(0.5, 0.08, 0.3, x - sgn * 1.9, 7.89 + y0, z, ENV_MAT.lamp));
        }
      }
      // facades with windows (DepthLab's street): a row of buildings behind each sidewalk
      // lo que necesita la comparación con el 3D (js/ghost.js): el borde de arriba de cada fachada
      const ghost = { roofs: [] }; g.userData.ghost = ghost;
      if (p.buildings) {
        const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ENV_MAT.building, 400);
        const wins = [], doors = [];
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
        let k = 0;
        for (const sgn of [1, -1]) {
          const face = edgeX(sgn) + sgn * p.walk, y0 = edgeY(sgn) + 0.15;
          let z = -len / 2;
          while (z < len / 2 && k < 400) {
            const w = 8 + rng() * 14, d = 12 + rng() * 10, h = 7 + rng() * 26;
            m.compose(v.set(face + sgn * (d / 2 + 0.5), h / 2 + y0, z + w / 2), q, s.set(d, h, w - 0.6));
            bm.setMatrixAt(k, m); bm.setColorAt(k, c.setHex(FACADE_COLORS[Math.floor(rng() * FACADE_COLORS.length)])); k++;
            // windows on the street side, 1.4 × 1.6 m every 2.6 m and 3 m per floor, a little proud of the wall
            const wx = face + sgn * 0.47;
            for (let fy = 3.2; fy + 1.6 < h; fy += 3) for (let fz = z + 1; fz + 1.4 < z + w - 0.8; fz += 2.6) wins.push(wx, fy + 0.8 + y0, fz + 0.7, rng());
            // puertas de planta baja de 0.9 x 2.1 m (la medida de la puerta de referencia del fantasma)
            const dzs = facadeDoors(z, w);
            for (const dz of dzs) doors.push(wx, DOOR_H / 2 + y0, dz);
            // vidrieras de planta baja entre las puertas (sin pasar por el rng)
            for (let fz = z + 1; fz + 1.4 < z + w - 0.8; fz += 2.6) if (dzs.every(dz => Math.abs(fz + 0.7 - dz) > 1.3)) wins.push(wx, 1.7 + y0, fz + 0.7, 0.3);
            ghost.roofs.push([face + sgn * 0.5, h + y0, z + 0.3, z + w - 0.3]);
            z += w;
          }
        }
        bm.count = k; bm.instanceColor.needsUpdate = true; g.add(bm);
        const n = wins.length / 4, wm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.6, 1.4), ENV_MAT.window, n);
        for (let i = 0; i < n; i++) {
          m.makeTranslation(wins[i * 4], wins[i * 4 + 1], wins[i * 4 + 2]); wm.setMatrixAt(i, m);
          const r = wins[i * 4 + 3]; wm.setColorAt(i, c.setHex(r < 0.08 ? 0xe8d9a8 : r < 0.5 ? 0x1a2028 : 0x2c3540)); // a few lit, the rest dark glass
        }
        if (n) { wm.instanceColor.needsUpdate = true; g.add(wm); }
        const nd = doors.length / 3;
        if (nd) {
          const dm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, DOOR_H, DOOR_W), ENV_MAT.door, nd);
          for (let i = 0; i < nd; i++) { m.makeTranslation(doors[i * 3], doors[i * 3 + 1], doors[i * 3 + 2]); dm.setMatrixAt(i, m); }
          g.add(dm);
        }
      }
      // traffic
      if (p.cars && lanes.length) {
        const cars = [];
        const src = p.carsrc === 'procedural' ? 'pack' : p.carsrc; // old saved value
        if (src === 'pack' && PACK.state === 'idle') loadPack();
        const packList = PACK.state === 'ok' ? Object.values(PACK.cars) : null;
        const models = src === 'custom' && userCars.length ? userCars : src === 'pack' ? packList : null;
        for (const ln of lanes) {
          if (ln.park) continue; // los estacionados van aparte, más abajo
          let z = -len / 2 + rng() * 10;
          while (z < len / 2 - 3) {
            const type = pickCarType(rng), k = 0.96 + rng() * 0.08, model = models ? models.indexOf(models === packList ? pickPackCar(rng) : models[Math.floor(rng() * models.length)]) : -1;
            const clen = models ? models[model].L : CAR_TYPES[type].L * k;
            const cz = z + clen / 2, cx = ln.x + (rng() - 0.5) * 0.3;
            if (Math.hypot(cx - origin.x, cz - origin.z) > p.clear + clen / 2) {
              cars.push({ lane: lanes.indexOf(ln), x: cx, y: crownY(cx), roll: Math.atan(crownS(cx)), z: cz, L: clen, dir: ln.dir, type, k, model, color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)] });
            }
            z += clen + 2 + (1 - p.density) * (8 + rng() * 40) + rng() * 4;
          }
        }
        lanes.forEach((ln, li) => { // one group per lane: flow 1 drives toward −Z, −1 toward +Z; vk = this lane's speed difference (−1..1)
          const sub = cars.filter(c => c.lane === li); if (!sub.length) return;
          const cg = models ? buildUserCars(sub, models === packList ? false : p.flipcars, models) : buildCars(sub);
          cg.userData.flow = ln.dir > 0 ? 1 : -1; cg.userData.vk = rng() * 2 - 1; g.add(cg);
        });
        // estacionados: quietos (sin flow: viajan con la calle), contra el cordón, en fila y con huecos
        const parked = [];
        for (const ln of lanes) {
          if (!ln.park) continue;
          const s = Math.sign(ln.x) || 1, x = edgeX(s) - s * 1.15;
          let z = -len / 2 + rng() * 4;
          while (z < len / 2 - 3) {
            const type = pickCarType(rng), k = 0.96 + rng() * 0.08, model = models ? models.indexOf(models === packList ? pickPackCar(rng) : models[Math.floor(rng() * models.length)]) : -1;
            const clen = models ? models[model].L : CAR_TYPES[type].L * k, cz = z + clen / 2;
            const empty = rng() > (p.parked ?? 0.75), cx = x + (rng() - 0.5) * 0.15;
            if (!empty && Math.hypot(cx - origin.x, cz - origin.z) > p.clear + clen / 2)
              parked.push({ x: cx, y: crownY(cx), roll: Math.atan(crownS(cx)), z: cz, dir: ln.dir, type, k, model, color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)] });
            z += clen + 0.8 + rng() * 1.6;
          }
        }
        if (parked.length) { const pg = models ? buildUserCars(parked, models === packList ? false : p.flipcars, models) : buildCars(parked); pg.userData.parked = parked.length; g.add(pg); }
      }
      // gente en las veredas: 1.6 a 1.85 m, quieta o caminando (al reproducir con Motion on), con ropa variada
      if (p.people && p.walk > 0.6) {
        const per = [];
        for (const s of [1, -1]) {
          const x0 = edgeX(s) + s * 0.5, x1 = edgeX(s) + s * (p.walk - 0.4), y0 = edgeY(s) + 0.15;
          const n = Math.round((p.peds ?? 0.3) * len * (p.walk - 0.9) * 0.1);
          for (let i = 0; i < n; i++) {
            const walking = rng() < (p.walkers ?? 0.4), dir = rng() < 0.5 ? 1 : -1;
            per.push({ x: x0 + (x1 - x0) * rng(), y: y0, z: -len / 2 + len * rng(), h: 1.6 + rng() * 0.25, walk: walking ? dir * (rng() < 0.5 ? 1.15 : 1.45) : 0,
              face: walking ? (dir > 0 ? Math.PI : 0) : rng() * Math.PI * 2, c: PEOPLE_COLORS[Math.floor(rng() * PEOPLE_COLORS.length)], legs: rng() < 0.6 ? 0x23262d : 0x3a3f4a, sk: SKIN[Math.floor(rng() * SKIN.length)] });
          }
        }
        // un grupo por paso (los que caminan a la misma velocidad se mueven juntos); los quietos, en otro
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
        for (const sp of [...new Set(per.map(o => o.walk))]) {
          const list = per.filter(o => o.walk === sp), grp = new THREE.Group();
          const body = new THREE.InstancedMesh(PERSON.body, RAIL_MAT.person, list.length), legs = new THREE.InstancedMesh(PERSON.legs, RAIL_MAT.person, list.length), head = new THREE.InstancedMesh(PERSON.head, RAIL_MAT.person, list.length);
          list.forEach((o, i) => {
            const sc = o.h / 1.75; q.setFromAxisAngle(up, o.face); m.compose(v.set(o.x, o.y, o.z), q, s3.set(sc, sc, sc));
            body.setMatrixAt(i, m); legs.setMatrixAt(i, m); head.setMatrixAt(i, m);
            body.setColorAt(i, col.setHex(o.c)); legs.setColorAt(i, col.setHex(o.legs)); head.setColorAt(i, col.setHex(o.sk));
          });
          [body, legs, head].forEach(x => { x.instanceColor.needsUpdate = true; grp.add(x); });
          if (sp) grp.userData.walk = sp; // m/s a lo largo de Z (timeline.js)
          grp.userData.people = list.length; grp.userData.guide = 'people'; g.add(grp);
        }
      }
      return g;
    },
  },
  rail: {
    name: 'Railway / station',
    params: [
      { key: 'floorH', label: 'Car floor height', type: 'num', min: 0.3, max: 1.6, step: 0.01, def: 1.15, unit: 'm', tip: 'Floor of the shot\'s train above the top of the rail. Ground to scan uses it: it puts the rails this far below the lowest point of the scan.' },
      { key: 'gauge', label: 'Track gauge', type: 'select', options: [['1.676', 'Broad 1676 mm (AR)'], ['1.435', 'Standard 1435 mm'], ['1.000', 'Metre 1000 mm']], def: '1.676' },
      { key: 'tracksL', label: 'Tracks left', type: 'num', min: 0, max: 6, step: 1, def: 1, tip: 'Extra tracks on the left of the shot\'s own track (the own track is at the centre, x = 0).' },
      { key: 'tracksR', label: 'Tracks right', type: 'num', min: 0, max: 6, step: 1, def: 0 },
      { key: 'spacing', label: 'Track spacing', type: 'num', min: 3.5, max: 8, step: 0.05, def: 4.2, unit: 'm', tip: 'Centre to centre between tracks.' },
      { key: 'length', label: 'Length', type: 'num', min: 50, max: 1000, step: 10, def: 300, unit: 'm' },
      { key: 'plat', label: 'Platform', type: 'select', options: [['right', 'Right'], ['left', 'Left'], ['both', 'Both sides'], ['none', 'None']], def: 'right' },
      { key: 'pH', label: 'Platform height', type: 'num', min: 0.2, max: 1.5, step: 0.01, def: 1.1, unit: 'm', tip: 'Above the top of the rail. Buenos Aires suburban ~1.1 m, Europe 0.55 / 0.76 m, UK 0.915 m.' },
      { key: 'pD', label: 'Platform depth', type: 'num', min: 1.5, max: 20, step: 0.1, def: 6, unit: 'm' },
      { key: 'pEdge', label: 'Platform edge', type: 'num', min: 1.4, max: 2.5, step: 0.01, def: 1.65, unit: 'm', tip: 'From the centre of the next track to the platform edge.' },
      { key: 'pLen', label: 'Platform length', type: 'num', min: 20, max: 600, step: 5, def: 200, unit: 'm' },
      { key: 'pZ', label: 'Platform position', type: 'num', min: -300, max: 300, step: 1, def: 0, unit: 'm', tip: 'Slides the platform along the track.' },
      { key: 'canopy', label: 'Canopy', type: 'bool', def: true },
      { key: 'wall', label: 'Back wall', type: 'bool', def: false },
      { key: 'people', label: 'People', type: 'bool', def: true },
      { key: 'crowd', label: 'Crowd', type: 'num', min: 0.02, max: 1, step: 0.02, def: 0.25, tip: 'How busy the platform is.' },
      { key: 'trainL', label: 'Train on left track', type: 'bool', def: false },
      { key: 'trainR', label: 'Train on right track', type: 'bool', def: false },
      { key: 'tdir', label: 'Other trains face', type: 'select', options: [['same', 'Same way'], ['opp', 'Opposite way']], def: 'opp' },
      { key: 'cars', label: 'Cars per train', type: 'num', min: 1, max: 12, step: 1, def: 6 },
      { key: 'trainZ', label: 'Train position', type: 'num', min: -300, max: 300, step: 1, def: 0, unit: 'm', tip: 'Slides the other trains along the track.' },
      { key: 'carH', label: 'Train height', type: 'num', min: 3, max: 4.8, step: 0.05, def: 4.1, unit: 'm', tip: 'Roof above the top of the rail.' },
      { key: 'carW', label: 'Train width', type: 'num', min: 2.6, max: 3.4, step: 0.02, def: 3.0, unit: 'm' },
    ],
    // top of rail is y = 0; the shot's own track runs along Z at x = 0
    build(p, rng, origin) {
      const g = new THREE.Group(), len = p.length, gauge = +p.gauge || 1.676, sp = p.spacing;
      const nL = Math.round(p.tracksL), nR = Math.round(p.tracksR);
      const xs = []; for (let i = -nL; i <= nR; i++) xs.push(i * sp);
      const M = RAIL_MAT, m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color();
      // ground and ballast beds
      const xmin = xs[0] - 30, xmax = xs[xs.length - 1] + 30;
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(xmax - xmin, len).rotateX(-Math.PI / 2), M.ground); ground.position.set((xmin + xmax) / 2, -0.62, 0); g.add(ground);
      const bed = new THREE.Shape(); const bw = gauge + 2.2;
      bed.moveTo(-bw / 2 - 0.9, -0.62); bed.lineTo(bw / 2 + 0.9, -0.62); bed.lineTo(bw / 2, -0.18); bed.lineTo(-bw / 2, -0.18); bed.closePath();
      const bedGeo = new THREE.ExtrudeGeometry(bed, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2);
      // rails and sleepers
      const railGeo = new THREE.BoxGeometry(0.075, 0.16, len), sleeperGeo = new THREE.BoxGeometry(gauge + 1.0, 0.2, 0.26);
      const nS = Math.floor(len / 0.6);
      const sl = new THREE.InstancedMesh(sleeperGeo, M.sleeper, nS * xs.length); let k = 0;
      xs.forEach(x => {
        const b = new THREE.Mesh(bedGeo, M.ballast); b.position.x = x; g.add(b);
        for (const sx of [-1, 1]) { const r = new THREE.Mesh(railGeo, M.rail); r.position.set(x + sx * (gauge / 2 + 0.035), -0.08, 0); g.add(r); }
        for (let i = 0; i < nS; i++) { m.makeTranslation(x, -0.26, -len / 2 + (i + 0.5) * 0.6); sl.setMatrixAt(k++, m); }
      });
      g.add(sl);
      // platforms: next to the outermost track on that side
      const sides = p.plat === 'both' ? [-1, 1] : p.plat === 'left' ? [-1] : p.plat === 'right' ? [1] : [];
      const pl = p.pLen, pz = p.pZ, pH = p.pH, pD = p.pD;
      const platforms = [];
      sides.forEach(sg => {
        const edge = (sg < 0 ? xs[0] : xs[xs.length - 1]) + sg * p.pEdge, cx = edge + sg * pD / 2;
        g.add(boxAt(pD, pH + 0.62, pl, cx, (pH - 0.62) / 2, pz, M.platform));
        g.add(boxAt(0.6, 0.012, pl, edge + sg * 0.3, pH + 0.006, pz, M.edge));           // edge strip
        g.add(boxAt(0.12, 0.01, pl, edge + sg * 0.9, pH + 0.006, pz, M.tactile));        // safety line
        platforms.push({ sg, edge, cx });
        if (p.canopy) {
          const ch = 3.6, cols = Math.max(2, Math.floor(pl / 9));
          for (let i = 0; i <= cols; i++) g.add(boxAt(0.2, ch, 0.2, edge + sg * pD * 0.62, pH + ch / 2, pz - pl / 2 + 2 + i * (pl - 4) / cols, M.pole));
          g.add(boxAt(pD * 0.92, 0.18, pl * 0.94, edge + sg * pD * 0.5, pH + ch + 0.09, pz, M.roof));
        }
        if (p.wall) g.add(boxAt(0.25, 2.6, pl, edge + sg * (pD - 0.125), pH + 1.3, pz, M.wall));
      });
      // people on the platforms
      if (p.people && platforms.length) {
        const per = [];
        platforms.forEach(P => {
          const n = Math.round(p.crowd * pl * (pD - 1.4) * 0.45);
          for (let i = 0; i < n; i++) {
            const d = 1.15 + rng() * Math.max(0.2, pD - 1.6), z = pz - pl / 2 + 1 + rng() * (pl - 2);
            per.push({ x: P.edge + P.sg * d, z, h: 1.55 + rng() * 0.35, face: P.sg < 0 ? Math.PI / 2 : -Math.PI / 2, jit: (rng() - 0.5) * 1.6, c: PEOPLE_COLORS[Math.floor(rng() * PEOPLE_COLORS.length)], sk: SKIN[Math.floor(rng() * SKIN.length)] });
          }
        });
        if (per.length) {
          const body = new THREE.InstancedMesh(PERSON.body, M.person, per.length), legs = new THREE.InstancedMesh(PERSON.legs, M.person, per.length), head = new THREE.InstancedMesh(PERSON.head, M.person, per.length);
          per.forEach((o, i) => {
            const sc = o.h / 1.75; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.face + o.jit);
            m.compose(v.set(o.x, pH, o.z), q, s3.set(sc, sc, sc));
            body.setMatrixAt(i, m); legs.setMatrixAt(i, m); head.setMatrixAt(i, m);
            body.setColorAt(i, col.setHex(o.c)); legs.setColorAt(i, col.setHex(rng() < 0.6 ? 0x23262d : 0x3a3f4a)); head.setColorAt(i, col.setHex(o.sk));
          });
          [body, legs, head].forEach(x => { x.instanceColor.needsUpdate = true; x.userData.guide = 'people'; g.add(x); });
        }
      }
      // other trains on the tracks next to the own one
      const trains = [];
      if (p.trainL && nL > 0) trains.push(xs[nL - 1]);
      if (p.trainR && nR > 0) trains.push(xs[nL + 1]);
      if (trains.length) {
        const n = Math.round(p.cars), cl = 20, gap = 0.9, W = p.carW, H = p.carH, floor = 1.15;
        const tot = n * cl + (n - 1) * gap, dir = p.tdir === 'same' ? -1 : 1; // front of the train toward -Z (same way) or +Z
        const T = [];
        trains.forEach(x => { for (let i = 0; i < n; i++) T.push({ x, z: p.trainZ - tot / 2 + cl / 2 + i * (cl + gap), first: dir < 0 ? i === 0 : i === n - 1 }); });
        const tgs = new Map(trains.map(x => { const t = new THREE.Group(); t.userData.guide = 'cars'; t.userData.flow = dir < 0 ? 1 : -1; t.userData.vk = rng() * 2 - 1; g.add(t); return [x, t]; }));
        const parts = [
          [TRAIN.body, M.train], [TRAIN.band, M.window], [TRAIN.stripe, M.stripe], [TRAIN.under, M.under], [TRAIN.doors, M.door], [TRAIN.roof, M.trainRoof],
        ];
        parts.forEach(([geo, mat]) => {
          trains.forEach(x => {
            const TT = T.filter(c => c.x === x), im = new THREE.InstancedMesh(geo, mat, TT.length);
            TT.forEach((c, i) => { m.compose(v.set(c.x, 0, c.z), q.identity(), s3.set(W / 3, H / 4.1, 1)); im.setMatrixAt(i, m); });
            tgs.get(x).add(im);
          });
        });
        // cab windscreen on the leading car
        T.filter(c => c.first).forEach(c => tgs.get(c.x).add(boxAt(W * 0.8, 1.0, 0.05, c.x, (floor + 1.35) * H / 4.1, c.z + dir * (cl / 2 + 0.02), M.window)));
      }
      return g;
    },
  },
};
// railway materials and shared geometry (train car: 20 m long, 3.0 m wide, 4.1 m roof, floor 1.15 m above the rail)
const RAIL_MAT = {
  ground: new THREE.MeshLambertMaterial({ color: 0x5b5a4c }), ballast: new THREE.MeshLambertMaterial({ color: 0x77736a }),
  sleeper: new THREE.MeshLambertMaterial({ color: 0x8d8a84 }), rail: new THREE.MeshPhongMaterial({ color: 0x8a8c90, shininess: 80, specular: 0x777777 }),
  platform: new THREE.MeshLambertMaterial({ color: 0x9c9890 }), edge: new THREE.MeshBasicMaterial({ color: 0xc9c5bb, polygonOffset: true, polygonOffsetFactor: -2 }),
  tactile: new THREE.MeshBasicMaterial({ color: 0xe0b437, polygonOffset: true, polygonOffsetFactor: -2 }),
  pole: new THREE.MeshLambertMaterial({ color: 0x4f5357 }), roof: new THREE.MeshLambertMaterial({ color: 0x6d7074, side: THREE.DoubleSide }), wall: new THREE.MeshLambertMaterial({ color: 0xb7aea0 }),
  person: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  train: new THREE.MeshPhongMaterial({ color: 0xc9ccd0, shininess: 60, specular: 0x444444 }), window: new THREE.MeshPhongMaterial({ color: 0x14191e, shininess: 90, specular: 0x666666 }),
  stripe: new THREE.MeshLambertMaterial({ color: 0x1f4f8c }), under: new THREE.MeshLambertMaterial({ color: 0x1b1c1e }), door: new THREE.MeshLambertMaterial({ color: 0x8f959c }),
  trainRoof: new THREE.MeshLambertMaterial({ color: 0x9a9da1 }),
};
// merge simple geometries (position + normal) into one non-indexed geometry
function mergeGeos(list) {
  const geos = list.map(g => g.index ? g.toNonIndexed() : g);
  const n = geos.reduce((a, g) => a + g.attributes.position.count, 0), P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  let o = 0; geos.forEach(g => { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); return out;
}
const PEOPLE_COLORS = [0x2b2f38, 0x3d4655, 0x6b6f75, 0x8c2f2f, 0x2f5a8c, 0xc9c3b6, 0x4f6b3f, 0x1c1c1e, 0x7d5a3c, 0xb8b8bc];
const SKIN = [0xe2b99a, 0xc89a76, 0x9c6b4c, 0x6e4a33, 0xf0cdb3];
const PERSON = (() => {
  const body = new THREE.CapsuleGeometry(0.19, 0.42, 4, 10).scale(1, 1, 0.62).translate(0, 1.18, 0);
  const legs = mergeGeos([-0.09, 0.09].map(x => new THREE.CapsuleGeometry(0.075, 0.72, 3, 8).translate(x, 0.47, 0)));
  const head = new THREE.SphereGeometry(0.105, 14, 10).scale(1, 1.15, 1).translate(0, 1.63, 0);
  return { body, legs, head };
})();
const TRAIN = (() => {
  const L = 20, W = 3.0, fl = 1.15, top = 4.1, B = (w, h, d, y, x = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, 0);
  const body = B(W, top - fl - 0.25, L, fl + (top - fl - 0.25) / 2);
  const roof = B(W * 0.9, 0.25, L, top - 0.125);
  const band = B(W + 0.02, 0.95, L * 0.9, fl + 1.35);
  const stripe = B(W + 0.025, 0.18, L, fl + 0.55);
  const under = B(W * 0.86, 0.75, L * 0.92, 0.42);
  const doors = mergeGeos([-L * 0.3, L * 0.3].flatMap(z => [-1, 1].map(sx => new THREE.BoxGeometry(0.03, 1.95, 1.3).translate(sx * (W / 2 + 0.01), fl + 0.98, z))));
  return { body, roof, band, stripe, under, doors };
})();
// Simple Grid: piso y paredes modulares en wireframe, con una línea cada 1, 2 o 4 m (Grid). Las paredes van a la
// distancia que se elija del eje del auto de cada lado y los cordones marcan el ancho de la calle; se mueve con el
// Motion como los otros. VFX Shooting Sup arma uno a la medida del entorno elegido (vfxToSimple, js/vfx-sup.js).
const SG_MAT = {
  floor: new THREE.MeshLambertMaterial({ color: 0x2c2f34 }),
  walk: new THREE.MeshLambertMaterial({ color: 0x3d4046, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  wall: new THREE.MeshLambertMaterial({ color: 0x4a4d53, side: THREE.DoubleSide }),
};
const SG_LINE = { white: 0xdfe3e8, cyan: 0x3ad8ff, yellow: 0xffd23f };
ENV_MODULES.simple = {
  name: 'Simple Grid',
  params: [
    { key: 'cell', label: 'Grid', type: 'select', options: [['1', '1 m'], ['2', '2 m'], ['4', '4 m']], def: '2', tip: 'Distance between the lines of the floor and the walls.' },
    { key: 'lcol', label: 'Line color', type: 'select', options: [['white', 'White'], ['cyan', 'Cyan'], ['yellow', 'Yellow']], def: 'white' },
    { key: 'walls', label: 'Walls', type: 'select', options: [['both', 'Both sides'], ['left', 'Left'], ['right', 'Right'], ['none', 'None']], def: 'both' },
    { key: 'wallL', label: 'Left wall', type: 'num', min: 0.5, max: 200, step: 0.1, def: 10, unit: 'm', tip: 'From the axis of the shot\'s car to the left wall.' },
    { key: 'wallR', label: 'Right wall', type: 'num', min: 0.5, max: 200, step: 0.1, def: 10, unit: 'm', tip: 'From the axis of the shot\'s car to the right wall.' },
    { key: 'wallH', label: 'Wall height', type: 'num', min: 1, max: 100, step: 0.5, def: 12, unit: 'm' },
    { key: 'curbL', label: 'Left curb', type: 'num', min: 0, max: 200, step: 0.1, def: 6, unit: 'm', tip: 'From the axis of the shot\'s car to the left edge of the street (0: no curb). Between the curb and the wall goes the sidewalk.' },
    { key: 'curbR', label: 'Right curb', type: 'num', min: 0, max: 200, step: 0.1, def: 6, unit: 'm', tip: 'From the axis of the shot\'s car to the right edge of the street (0: no curb).' },
    { key: 'length', label: 'Length', type: 'num', min: 50, max: 1000, step: 10, def: 300, unit: 'm' },
  ],
  build(p) {
    const g = new THREE.Group(), len = p.length, cell = +p.cell || 2;
    const wl = p.walls === 'both' || p.walls === 'left', wr = p.walls === 'both' || p.walls === 'right';
    const xL = -(wl ? p.wallL : Math.max(p.wallL, 60)), xR = wr ? p.wallR : Math.max(p.wallR, 60);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(xR - xL, len).rotateX(-Math.PI / 2).translate((xL + xR) / 2, 0, 0), SG_MAT.floor); g.add(floor);
    // veredas (entre el cordón y la pared) y el cordón, una franja pintada: el ancho de la calle
    for (const [s, curb] of [[-1, p.curbL], [1, p.curbR]]) {
      if (!(curb > 0)) continue;
      const x0 = s * curb, x1 = s < 0 ? xL : xR;
      if (Math.abs(x1 - x0) > 0.05) { const w = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1 - x0), len).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0.003, 0), SG_MAT.walk); w.userData.guide = 'curbs'; g.add(w); }
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.15, len).rotateX(-Math.PI / 2).translate(x0, 0.006, 0), ENV_MAT.paintW); g.add(c);
    }
    for (const [on, x] of [[wl, xL], [wr, xR]]) if (on) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(len, p.wallH).rotateY(Math.PI / 2).translate(x, p.wallH / 2, 0), SG_MAT.wall); w.userData.guide = 'facades'; g.add(w);
    }
    // las líneas: en el piso a lo largo y a lo ancho, en cada pared horizontales y verticales, cada `cell` m (en
    // múltiplos de cell desde el eje del auto, así una línea pasa por debajo del auto)
    const P = [], z0 = -len / 2, z1 = len / 2, lift = 0.01;
    const steps = (a, b) => { const out = []; for (let v = Math.ceil(a / cell - 1e-6) * cell; v <= b + 1e-6; v += cell) out.push(v); return out; };
    for (const x of steps(xL, xR)) P.push(x, lift, z0, x, lift, z1);
    for (const z of steps(z0, z1)) P.push(xL, lift, z, xR, lift, z);
    for (const [on, x, s] of [[wl, xL, 1], [wr, xR, -1]]) if (on) {
      const xi = x + s * lift;
      for (const y of steps(0, p.wallH)) P.push(xi, y, z0, xi, y, z1);
      for (const z of steps(z0, z1)) P.push(xi, 0, z, xi, p.wallH, z);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: SG_LINE[p.lcol] || SG_LINE.white }));
    lines.userData.guide = 'lanes'; g.add(lines);
    g.userData.simple = { xL, xR, wl, wr, cell };
    return g;
  },
};
const ENV_MOTION = [
  { key: 'mon', label: 'Motion on', type: 'bool', def: false, tip: 'Off: the set stays still on every frame, whatever the speeds.' },
  { key: 'speed', label: 'Speed', type: 'num', min: 0, max: 300, step: 1, def: 40, unit: 'km/h', tip: 'Speed of the shot\'s vehicle. On play the camera stays still and the environment moves past it.' },
  { key: 'mdir', label: 'Travel', type: 'select', options: [['fwd', 'Forward (−Z)'], ['back', 'Backward (+Z)']], def: 'fwd' },
  { key: 'tspeed', label: 'Other vehicles', type: 'num', min: 0, max: 200, step: 1, def: 55, unit: 'km/h', tip: 'Constant speed of the other cars / trains along their own direction (0 = parked).' },
  { key: 'tvar', label: 'Speed variation ±', type: 'num', min: 0, max: 15, step: 0.5, def: 3, unit: 'km/h', tip: 'Each lane (each train) gets its own small random difference around Other vehicles. Cars in the same lane share it, so they never run into each other.' },
  { key: 'mprof', label: 'Speed curve', type: 'select', options: [['const', 'Constant'], ['accel', 'Start from 0 (ease in)'], ['decel', 'Stop to 0 (ease out)'], ['inout', 'From 0 and back to 0']], def: 'const' },
];
const ENV_COMMON = [
  { key: 'x', label: 'Offset X', type: 'num', min: -500, max: 500, step: 0.1, def: 0, unit: 'm' },
  { key: 'z', label: 'Offset Z', type: 'num', min: -500, max: 500, step: 0.1, def: 0, unit: 'm' },
  { key: 'y', label: 'Ground height', type: 'num', min: -100, max: 100, step: 0.01, def: 0, unit: 'm' },
  { key: 'rot', label: 'Rotation', type: 'num', min: -180, max: 180, step: 0.5, def: 0, unit: '°' },
];
const envRoot = new THREE.Group(); envRoot.visible = false; scene.add(envRoot);
