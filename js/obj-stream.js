// ---------- OBJ: lectura en un worker, material y textura, pick con BVH ----------
// Todo OBJ entra por acá (js/obj-worker.js lo parsea por streaming): el OBJLoader de three lee el archivo entero
// como string y con un scan real de cientos de MB Chrome devolvía "" sin error y quedaba una nube vacía.
// Uno solo para chicos y grandes: no traba la ventana, tiene progreso y cancelación, y la malla sale indexada
// (en un scan real, 2,7 M de vértices contra 15 M sin índice). tests/test_objstream.mjs lo compara con el OBJLoader.
let objJob = null; // { worker, name }

// Los archivos que vinieron juntos (selección múltiple o soltados): si hay un .obj se carga con su .mtl y sus
// imágenes, y devuelve el resto (un EXR o un proyecto siguen su camino de siempre)
function objTakeFiles(files) {
  const obj = files.find(f => /\.obj$/i.test(f.name));
  if (!obj) return files;
  const side = files.filter(f => f !== obj && (/\.mtl$/i.test(f.name) || objIsImage(f)));
  objLoadScan(obj, side);
  return files.filter(f => f !== obj && !side.includes(f));
}
function objIsImage(f) { return !/\.exr$/i.test(f.name) && (/^image\//.test(f.type) || /\.(png|jpe?g|tiff?|webp|bmp)$/i.test(f.name)); }
function objSay(txt, cls) { const m = $('obj-msg'); m.hidden = !txt; m.className = cls || 'msg'; m.textContent = txt || ''; }

function objCancel() {
  if (!objJob) return;
  objJob.worker.terminate(); objJob = null;
  $('obj-busy').hidden = true; setBusy(false);
  toast('Loading cancelled');
}
$('obj-cancel').onclick = objCancel;

function objLoadScan(file, side = []) {
  objCancel();
  st.scanSide = side.map(f => f.name); // hook project: el .mtl y la imagen también guardan su ruta
  objSay('');
  const pill = $('obj-busy'), bar = $('obj-bar'), txt = $('obj-busy-t'), mb = (b) => (b / 1e6).toFixed(0);
  txt.textContent = 'Reading ' + file.name + '…'; bar.style.width = '0%'; pill.hidden = false;
  const job = { worker: null, name: file.name, t0: performance.now(), got: false };
  objJob = job;
  const onMsg = async (m) => {
    if (objJob !== job) return;
    job.got = true;
    if (m.type === 'progress') { bar.style.width = (100 * m.done / m.total).toFixed(1) + '%'; txt.textContent = `Reading ${file.name} · ${mb(m.done)} / ${mb(m.total)} MB`; }
    else if (m.type === 'phase') { bar.style.width = '100%'; txt.textContent = m.text + '…'; }
    else if (m.type === 'error') { objFail(file, m.message); }
    else if (m.type === 'done') {
      job.worker.terminate(); objJob = null; pill.hidden = true;
      try { await objFinish(file, side, m.result, performance.now() - job.t0); } catch (err) { objFail(file, err.message || String(err)); console.error(err); }
    }
  };
  // Sin worker (la página abierta como archivo, file://, donde Chrome no deja crear workers; o el worker que no
  // arranca) se lee igual en la página, con el mismo lector (js/obj-worker.js también se carga como script)
  const inline = () => { job.worker = { terminate() { job.dead = true; } }; objParseInline(file, job, onMsg); };
  let worker = null;
  try { worker = new Worker('js/obj-worker.js'); } catch (e) { worker = null; }
  if (!worker) return inline();
  job.worker = worker;
  worker.onmessage = (e) => onMsg(e.data);
  worker.onerror = (e) => {
    if (objJob !== job) return;
    if (!job.got) { worker.terminate(); inline(); return; } // no llegó a arrancar: en la página
    objFail(file, e.message || 'the reader stopped');
  };
  worker.postMessage({ file });
}
// lo mismo que el worker, en la página: el archivo se lee en pedazos (no traba entre pedazos) y el índice de pick al final
async function objParseInline(file, job, onMsg) {
  try {
    const t0 = performance.now();
    const r = await ObjStream.parseFile(file, (done, total) => { if (!job.dead) onMsg({ type: 'progress', done, total }); });
    if (job.dead) return;
    const t1 = performance.now();
    onMsg({ type: 'phase', text: 'Building the pick index' });
    await new Promise(res => setTimeout(res, 30)); // que se vea el aviso antes del cálculo
    for (const o of r.objects) o.bvh = ObjStream.buildBvh(o.position, o.index);
    if (job.dead) return;
    r.ms = { parse: Math.round(t1 - t0), bvh: Math.round(performance.now() - t1) };
    onMsg({ type: 'done', result: r });
  } catch (err) { if (!job.dead) onMsg({ type: 'error', message: err.message || String(err) }); }
}
function objFail(file, msg) {
  if (objJob) { objJob.worker.terminate(); objJob = null; }
  $('obj-busy').hidden = true; setBusy(false);
  showMsg('unit-msg', 'Could not read ' + file.name + ': ' + msg + '. Try exporting it as GLB, OBJ or binary PLY.', 'msg bad');
}

// .mtl mínimo: color (Kd) y textura (map_Kd, sin las opciones -bm, -s, etc.)
function objParseMtl(text) {
  const mats = {}; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim(), k = l.split(/\s+/)[0];
    if (k === 'newmtl') { cur = mats[l.slice(6).trim()] = { kd: null, map: '' }; }
    else if (cur && k === 'Kd') cur.kd = l.split(/\s+/).slice(1, 4).map(Number);
    else if (cur && k === 'map_Kd') cur.map = l.slice(6).trim().replace(/^(-\w+\s+\S+\s+)+/, '');
  }
  return mats;
}

async function objFinish(file, side, r, ms) {
  const mtlFile = side.find(f => /\.mtl$/i.test(f.name) && r.mtllibs.some(n => n.split(/[\\/]/).pop().toLowerCase() === f.name.toLowerCase()))
    || (side.filter(f => /\.mtl$/i.test(f.name)).length === 1 ? side.find(f => /\.mtl$/i.test(f.name)) : null);
  const mats = mtlFile ? objParseMtl(await mtlFile.text()) : {};
  const made = {}; // un material por nombre, compartido entre objetos
  const matFor = (name, vc) => {
    const key = name + (vc ? '|vc' : '');
    if (!made[key]) { const d = mats[name]; made[key] = new THREE.MeshLambertMaterial({ color: d && d.kd ? new THREE.Color().setRGB(...d.kd) : 0xb9c3cd, vertexColors: vc, side: THREE.DoubleSide }); made[key].name = name; }
    return made[key];
  };
  let root, kind = 'mesh';
  if (r.points) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.points.position, 3));
    if (r.points.color) g.setAttribute('color', new THREE.BufferAttribute(r.points.color, 3));
    root = new THREE.Points(g, PTS.mono); kind = 'points';
  } else {
    root = new THREE.Group();
    for (const o of r.objects) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
      if (o.normal) g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
      if (o.uv) g.setAttribute('uv', new THREE.BufferAttribute(o.uv, 2));
      if (o.color) g.setAttribute('color', new THREE.BufferAttribute(o.color, 3));
      g.setIndex(new THREE.BufferAttribute(o.index, 1));
      g.userData.bvh = o.bvh;
      g.computeBoundingBox(); g.computeBoundingSphere();
      let mat;
      const names = [...new Set(o.groups.map(x => x.material))];
      if (names.length > 1) { mat = names.map(n => matFor(n, !!o.color)); o.groups.forEach(x => g.addGroup(x.start, x.count, names.indexOf(x.material))); }
      else mat = matFor(names[0] || '', !!o.color);
      const mesh = new THREE.Mesh(g, mat); mesh.name = o.name; mesh.raycast = objBvhRaycast;
      root.add(mesh);
    }
  }
  st.objInfo = { ms: Math.round(ms), parse: r.ms, counts: r.counts };
  finishScan(root, file.name, kind, 'obj');
  if (kind === 'mesh') await objTexture(file, side, r, mats, mtlFile, Object.values(made));
}

// Textura: el map_Kd casi siempre es una ruta de otra máquina (X:\... de 3ds Max). Desde el navegador sólo se ven
// los archivos que vinieron con el OBJ: para cada material, la imagen con el nombre del map_Kd; si el MTL pide una
// sola, también la única imagen o la que se llame como el OBJ o el MTL. Sin MTL, la imagen va a toda la malla.
// Si no aparece, se avisa y queda Apply image.
async function objTexture(file, side, r, mats, mtlFile, materials) {
  const imgs = side.filter(objIsImage), leaf = (s) => s.split(/[\\/]/).pop(), base = (s) => leaf(s).toLowerCase(), stem = (s) => base(s).replace(/\.[^.]+$/, '');
  const wanted = [...new Set(Object.values(mats).map(m => m.map).filter(Boolean))];
  if (!imgs.length) {
    if (!mtlFile && r.mtllibs.length) objSay(`This OBJ uses ${r.mtllibs.join(', ')} for its color. To get the texture, load the OBJ together with its .mtl and image (select them all, or drop them together), or use Apply image.`);
    else if (wanted.length) objSay(`The material uses ${wanted.map(leaf).join(', ')}, which did not come with the OBJ: load it with the OBJ (select or drop them together), or use Apply image.`);
    return;
  }
  const pickFor = (want) => (want && imgs.find(f => f.name.toLowerCase() === base(want))) ||
    (wanted.length <= 1 ? (imgs.length === 1 ? imgs[0] : imgs.find(f => stem(f.name) === stem(file.name) || (mtlFile && stem(f.name) === stem(mtlFile.name)))) : null);
  const targets = mtlFile ? materials.filter(m => mats[m.name] && mats[m.name].map) : materials, got = new Map(), missing = new Set();
  for (const m of targets) {
    const want = mtlFile ? mats[m.name].map : '', img = pickFor(want);
    if (img) { if (!got.has(img)) got.set(img, []); got.get(img).push(m); } else missing.add(leaf(want));
  }
  if (!got.size) { objSay(`The material uses ${[...missing].join(', ') || 'a texture'}; none of the images that came with it has that name. Use Apply image.`); return; }
  const notes = [];
  let bad = missing.size > 0;
  for (const [img, ms] of got) {
    let tex;
    try { tex = await objLoadTexture(img); } catch (e) { notes.push(`Could not read ${img.name} as an image.`); bad = true; continue; }
    for (const m of ms) { m.map = tex.texture; m.color.set(0xffffff); m.needsUpdate = true; }
    const want = mtlFile ? mats[ms[0].name].map : '';
    notes.push(`Texture: ${img.name}` + (want && base(want) !== img.name.toLowerCase() ? ` (the MTL asks for ${leaf(want)}, which did not come with it)` : '') + '.' + (tex.note ? ' ' + tex.note : ''));
    if (tex.note) bad = true;
  }
  if (missing.size) notes.push(`Not found: ${[...missing].join(', ')}.`);
  scanObj && scanObj.traverse(o => { if (o.isMesh) o.userData.flat = null; });
  $('tex-name').textContent = [...got.keys()].map(f => f.name).join(', ');
  objSay(notes.join(' '), bad ? 'msg bad' : 'msg');
  applyDisplay();
}
// La GPU tiene un lado máximo de textura (MAX_TEXTURE_SIZE: 16384 en una RTX 4090, 4096 u 8192 en otras): más
// grande se achica acá, con buena calidad, y se avisa
async function objLoadTexture(file) {
  const max = renderer.capabilities.maxTextureSize, o = { imageOrientation: 'flipY' };
  let bmp = await createImageBitmap(file, o), note = '';
  if (bmp.width > max || bmp.height > max) {
    const s = max / Math.max(bmp.width, bmp.height), w = Math.max(1, Math.floor(bmp.width * s)), h = Math.max(1, Math.floor(bmp.height * s));
    note = `It is ${bmp.width} × ${bmp.height} and this GPU takes up to ${max}, so it was reduced to ${w} × ${h}.`;
    bmp.close(); bmp = await createImageBitmap(file, { ...o, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  }
  const texture = new THREE.Texture(bmp);
  texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); texture.needsUpdate = true;
  return { texture, note };
}

// ---------- Pick con BVH ----------
// Con 5 M de triángulos el raycast de three los prueba todos (~180 ms por click en un scan real); con el BVH del worker
// (ObjStream.rayHit) es menos de un milisegundo. Devuelve lo mismo que Mesh.raycast (distance, point, face).
const _objInv = new THREE.Matrix4(), _objRay = new THREE.Ray();
function objBvhRaycast(raycaster, intersects) {
  const g = this.geometry, B = g.userData.bvh;
  if (!B || !B.node.length) return THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
  _objInv.copy(this.matrixWorld).invert(); _objRay.copy(raycaster.ray).applyMatrix4(_objInv);
  const P = g.attributes.position.array, I = g.index.array, o = _objRay.origin, d = _objRay.direction;
  const h = ObjStream.rayHit(P, I, B, o.x, o.y, o.z, d.x, d.y, d.z);
  if (!h) return;
  const point = _objRay.at(h.t, new THREE.Vector3()).applyMatrix4(this.matrixWorld), distance = raycaster.ray.origin.distanceTo(point);
  if (distance < raycaster.near || distance > raycaster.far) return;
  const a = I[h.tri * 3], b = I[h.tri * 3 + 1], c = I[h.tri * 3 + 2], v = (k) => new THREE.Vector3().fromArray(P, k * 3);
  intersects.push({ distance, point, object: this, faceIndex: h.tri, face: { a, b, c, normal: THREE.Triangle.getNormal(v(a), v(b), v(c), new THREE.Vector3()), materialIndex: 0 } });
}
