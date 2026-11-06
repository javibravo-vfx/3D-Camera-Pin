// El BVH del path tracer (js/render3d-pt.js) en otro hilo: armarlo frena la página varios segundos y así el visor
// puede mostrar una barra de progreso. Es un worker de módulo: el import map de index.html no llega a los workers, así
// que three-mesh-bvh se carga con su `from 'three'` apuntando al three.js de vendor/ (el mismo de la app).
// Recibe { base, position, index, options } y devuelve { progress } mientras arma y al final { serialized } (las raíces
// y el buffer indirecto, transferidos), o { error }.
let lib = null;
async function bvhLib(base) {
  if (lib) return lib;
  const three = base + 'vendor/three/build/three.module.js';
  const src = await (await fetch(base + 'vendor/three-mesh-bvh/build/index.module.js')).text();
  const url = URL.createObjectURL(new Blob([src.replace(/from\s*(['"])three\1/g, `from '${three}'`)], { type: 'text/javascript' }));
  const [T, B] = await Promise.all([import(three), import(url)]);
  lib = { T, B };
  return lib;
}
self.onmessage = async (e) => {
  const { base, position, index, options } = e.data;
  try {
    const { T, B } = await bvhLib(base);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(position, 3));
    if (index) g.setIndex(new T.BufferAttribute(index, 1));
    let last = 0;
    const bvh = new B.MeshBVH(g, { ...options, onProgress: (p) => { const t = performance.now(); if (t - last > 60) { last = t; self.postMessage({ progress: p }); } } });
    const s = B.MeshBVH.serialize(bvh, { cloneBuffers: false });
    s.index = null; // el índice no cambia (BVH indirecto): no hace falta devolverlo
    const move = s.roots.slice(); if (s.indirectBuffer) move.push(s.indirectBuffer.buffer);
    self.postMessage({ serialized: s }, move);
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
