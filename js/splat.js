// ---------- Gaussian splat renderer (EWA splatting, CPU depth sort) ----------
const SPLAT_TW = 2048;
let SPLAT_MIN_OP = 0.12; // opacidad mínima al cargar (QA la baja a 0 para medir un splat entero)
let splatShOn = lsGet('splatSH', true); // color según el ángulo de vista (armónicos esféricos), si el archivo los trae
// Armónicos de grado 1 a 3 en el vertex shader, como el 3DGS de Inria: dirección cámara → centro en el marco del
// archivo (los SH se entrenaron ahí). 48 bytes por splat en 3 texels RGBA32UI: byte j = coeficiente j/3, canal j%3,
// valor (b - 128) / 128, como .spz.
const SPLAT_SH_GLSL = `
  uniform highp usampler2D tSH; uniform int shDeg; uniform vec3 camObj;
  vec4 shU(uint w) { return (vec4(uvec4(w, w >> 8u, w >> 16u, w >> 24u) & 255u) - 128.0) / 128.0; }
  uvec4 shT(int b) { return texelFetch(tSH, ivec2(b % ${SPLAT_TW}, b / ${SPLAT_TW}), 0); }
  vec3 shColor(int i, vec3 p) {
    vec3 d = normalize(p - camObj); float x = d.x, y = d.y, z = d.z;
    uvec4 t = shT(i * 3); vec4 a0 = shU(t.x), a1 = shU(t.y), a2 = shU(t.z), a3 = shU(t.w);
    vec3 r = 0.4886025119029199 * (-y * a0.xyz + z * vec3(a0.w, a1.xy) - x * vec3(a1.zw, a2.x));
    if (shDeg < 2) return r;
    t = shT(i * 3 + 1); vec4 a4 = shU(t.x), a5 = shU(t.y), a6 = shU(t.z), a7 = shU(t.w);
    float xx = x * x, yy = y * y, zz = z * z;
    r += 1.0925484305920792 * x * y * a2.yzw - 1.0925484305920792 * y * z * a3.xyz + 0.31539156525252005 * (2.0 * zz - xx - yy) * vec3(a3.w, a4.xy)
       - 1.0925484305920792 * x * z * vec3(a4.zw, a5.x) + 0.5462742152960396 * (xx - yy) * a5.yzw;
    if (shDeg < 3) return r;
    t = shT(i * 3 + 2); vec4 a8 = shU(t.x), a9 = shU(t.y), a10 = shU(t.z);
    r += -0.5900435899266435 * y * (3.0 * xx - yy) * a6.xyz + 2.890611442640554 * x * y * z * vec3(a6.w, a7.xy)
       - 0.4570457994644658 * y * (4.0 * zz - xx - yy) * vec3(a7.zw, a8.x) + 0.3731763325901154 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * a8.yzw
       - 0.4570457994644658 * x * (4.0 * zz - xx - yy) * a9.xyz + 1.445305721320277 * z * (xx - yy) * vec3(a9.w, a10.xy)
       - 0.5900435899266435 * x * (xx - 3.0 * yy) * vec3(a10.zw, shU(t.w).x);
    return r;
  }`;
function makeSplatMesh(d) {
  const n = d.n, TH = Math.max(1, Math.ceil(n / SPLAT_TW)), sz = SPLAT_TW * TH * 4;
  const cen = new Float32Array(sz), ca = new Float32Array(sz), cb = new Float32Array(sz), col = new Uint8Array(sz);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const x = d.pos[i * 3], y = d.pos[i * 3 + 1], z = d.pos[i * 3 + 2];
    cen[i * 4] = x; cen[i * 4 + 1] = y; cen[i * 4 + 2] = z; cen[i * 4 + 3] = d.op[i];
    for (let c = 0; c < 3; c++) { const v = d.pos[i * 3 + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
    let qw = d.rot[i * 4], qx = d.rot[i * 4 + 1], qy = d.rot[i * 4 + 2], qz = d.rot[i * 4 + 3];
    const ql = Math.hypot(qw, qx, qy, qz) || 1; qw /= ql; qx /= ql; qy /= ql; qz /= ql;
    const sx = d.scl[i * 3], sy = d.scl[i * 3 + 1], sz2 = d.scl[i * 3 + 2];
    // M = R * S
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    const m00 = r00 * sx, m01 = r01 * sy, m02 = r02 * sz2, m10 = r10 * sx, m11 = r11 * sy, m12 = r12 * sz2, m20 = r20 * sx, m21 = r21 * sy, m22 = r22 * sz2;
    ca[i * 4] = m00 * m00 + m01 * m01 + m02 * m02;     // xx
    ca[i * 4 + 1] = m00 * m10 + m01 * m11 + m02 * m12; // xy
    ca[i * 4 + 2] = m00 * m20 + m01 * m21 + m02 * m22; // xz
    ca[i * 4 + 3] = m10 * m10 + m11 * m11 + m12 * m12; // yy
    cb[i * 4] = m10 * m20 + m11 * m21 + m12 * m22;     // yz
    cb[i * 4 + 1] = m20 * m20 + m21 * m21 + m22 * m22; // zz
    if (d.col) { col[i * 4] = d.col[i * 3] * 255; col[i * 4 + 1] = d.col[i * 3 + 1] * 255; col[i * 4 + 2] = d.col[i * 3 + 2] * 255; }
    else { col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 200; }
    col[i * 4 + 3] = 255;
  }
  const tex = (arr, type) => { const t = new THREE.DataTexture(arr, SPLAT_TW, TH, THREE.RGBAFormat, type); t.needsUpdate = true; return t; };
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const order = new Float32Array(n); for (let i = 0; i < n; i++) order[i] = i;
  const ia = new THREE.InstancedBufferAttribute(order, 1); ia.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('splatIndex', ia);
  geo.instanceCount = n;
  const box = new THREE.Box3(new THREE.Vector3(...lo), new THREE.Vector3(...hi));
  geo.boundingBox = box; geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  const shDeg = d.sh ? d.shDeg : 0;
  let tSH = null;
  if (shDeg) {
    const TH3 = Math.ceil(n * 3 / SPLAT_TW), a = new Uint32Array(SPLAT_TW * TH3 * 4);
    a.set(new Uint32Array(d.sh.buffer, d.sh.byteOffset, n * 12));
    tSH = new THREE.DataTexture(a, SPLAT_TW, TH3, THREE.RGBAIntegerFormat, THREE.UnsignedIntType); tSH.internalFormat = 'RGBA32UI'; tSH.needsUpdate = true;
  }
  const mat = new THREE.ShaderMaterial({
    defines: shDeg ? { SPLAT_SH: 1 } : {},
    uniforms: {
      tSH: { value: tSH }, shDeg: { value: splatShOn ? shDeg : 0 }, camObj: { value: new THREE.Vector3() },
      tCenter: { value: tex(cen, THREE.FloatType) }, tCovA: { value: tex(ca, THREE.FloatType) }, tCovB: { value: tex(cb, THREE.FloatType) },
      tCol: { value: tex(col, THREE.UnsignedByteType) }, viewport: { value: new THREE.Vector2(1, 1) }, focal: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: `
      precision highp float; precision highp int;
      uniform highp sampler2D tCenter, tCovA, tCovB; uniform highp sampler2D tCol;
      uniform vec2 viewport, focal;
      attribute float splatIndex;
      #ifdef SPLAT_SH
      ${SPLAT_SH_GLSL}
      #endif
      varying vec4 vColor; varying vec2 vPos;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        int i = int(splatIndex);
        ivec2 uv = ivec2(i % ${SPLAT_TW}, i / ${SPLAT_TW});
        vec4 c = texelFetch(tCenter, uv, 0);
        vec4 ca = texelFetch(tCovA, uv, 0), cb = texelFetch(tCovB, uv, 0);
        vec4 cam = modelViewMatrix * vec4(c.xyz, 1.0);
        vec4 p2 = projectionMatrix * cam;
        float clip = 1.2 * p2.w;
        if (cam.z > -0.01 || p2.x < -clip || p2.x > clip || p2.y < -clip || p2.y > clip) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        mat3 V = mat3(ca.x, ca.y, ca.z, ca.y, ca.w, cb.x, ca.z, cb.x, cb.y);
        float z = -cam.z;
        mat3 J = mat3(focal.x / z, 0.0, focal.x * cam.x / (z * z),
                      0.0, focal.y / z, focal.y * cam.y / (z * z),
                      0.0, 0.0, 0.0);
        mat3 T = transpose(mat3(modelViewMatrix)) * J;
        mat3 c2 = transpose(T) * V * T;
        c2[0][0] += 0.3; c2[1][1] += 0.3;
        float mid = 0.5 * (c2[0][0] + c2[1][1]);
        float rad = length(vec2(0.5 * (c2[0][0] - c2[1][1]), c2[0][1]));
        float l1 = mid + rad, l2 = mid - rad;
        if (l2 < 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        float da = c2[0][0] - c2[1][1], db = 2.0 * c2[0][1];
        float th = (abs(da) + abs(db) < 1e-6) ? 0.0 : 0.5 * atan(db, da);
        vec2 dv = vec2(cos(th), sin(th));
        vec2 major = min(sqrt(2.0 * l1), 1024.0) * dv;
        vec2 minor = min(sqrt(2.0 * l2), 1024.0) * vec2(dv.y, -dv.x);
        vec4 col = texelFetch(tCol, uv, 0);
        vec3 rgb = col.rgb;
        #ifdef SPLAT_SH
          if (shDeg > 0) rgb = clamp(rgb + shColor(i, c.xyz), 0.0, 1.0);
        #endif
        vColor = vec4(rgb, c.w);
        vPos = position.xy;
        vec2 ctr = p2.xy / p2.w;
        gl_Position = vec4(ctr + position.x * major / viewport + position.y * minor / viewport, p2.z / p2.w, 1.0);
        #ifdef USE_LOGDEPTHBUF
          #ifdef USE_LOGDEPTHBUF_EXT
            vFragDepth = 1.0 + p2.w; vIsPerspective = 1.0;
          #endif
        #endif
      }`,
    fragmentShader: `
      precision highp float;
      varying vec4 vColor; varying vec2 vPos;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        float A = -dot(vPos, vPos);
        if (A < -4.0) discard;
        float B = exp(A) * vColor.a;
        if (B < 1.0 / 255.0) discard;
        gl_FragColor = vec4(B * vColor.rgb, B);
        #include <logdepthbuf_fragment>
      }`,
    // los quads salen siempre en sentido horario (major, minor = major girado -90°): BackSide. Con DoubleSide y
    // transparent, three r147 dibuja dos pasadas y el vertex shader corre dos veces (1.6 ms contra 1.0 en el Clio)
    transparent: true, depthWrite: false, depthTest: true, side: THREE.BackSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.raycast = () => {};
  mesh.userData.isSplat = true; mesh.userData.shDeg = shDeg;
  mesh.userData.sort = { n, cen: d.pos, lo, hi, depth: new Uint16Array(n), counts: new Uint32Array(65536), starts: new Uint32Array(65536), last: null, t: 0 };
  mesh.renderOrder = 10;
  mesh.onBeforeRender = (r, sc, cam) => {
    if (shDeg) mat.uniforms.camObj.value.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    mat.uniforms.viewport.value.copy(size);
    const pm = cam.projectionMatrix.elements;
    mat.uniforms.focal.value.set(pm[0] * size.x / 2, pm[5] * size.y / 2);
  };
  return mesh;
}
// El orden se arma en el onBeforeRender de la escena: three sube los atributos al armar la lista de lo que dibuja,
// antes del onBeforeRender de cada objeto, y ordenado ahí el orden nuevo llegaba un cuadro tarde (se dibujaba con el
// de la cámara anterior; un render suelto, como el de un playblast o el QA, quedaba con el orden viejo).
{ const prev = scene.onBeforeRender; scene.onBeforeRender = function (r, s, cam, rt) { prev.call(this, r, s, cam, rt); if (scanObj && scanRoot.visible) scanObj.traverse(o => { if (o.userData.isSplat && o.visible) sortSplats(o, cam); }); }; }
// Orden de atrás hacia adelante por conteo: la profundidad en 65536 escalones entre las esquinas de la caja de los
// centros (sin buscar mínimo y máximo: dos pasadas en vez de tres), y cada splat a su lugar. La cámara de three mira
// a -z: primero el z más negativo. Es la misma función en el hilo principal y en el worker (va como texto).
function splatOrder(cen, n, key, lo, hi, depth, counts, starts, out) {
  let zmin = Infinity, zmax = -Infinity;
  for (let c = 0; c < 8; c++) { const z = key[0] * (c & 1 ? hi[0] : lo[0]) + key[1] * (c & 2 ? hi[1] : lo[1]) + key[2] * (c & 4 ? hi[2] : lo[2]) + key[3]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  const sc = 65535 / Math.max(1e-12, zmax - zmin), k0 = key[0] * sc, k1 = key[1] * sc, k2 = key[2] * sc, k3 = (key[3] - zmin) * sc;
  counts.fill(0);
  for (let i = 0; i < n; i++) { const b = (k0 * cen[i * 3] + k1 * cen[i * 3 + 1] + k2 * cen[i * 3 + 2] + k3) | 0; depth[i] = b; counts[b]++; }
  starts[0] = 0; for (let i = 1; i < 65536; i++) starts[i] = starts[i - 1] + counts[i - 1];
  for (let i = 0; i < n; i++) out[starts[depth[i]]++] = i;
}
// Splats grandes (desde 400 mil): mientras la cámara se mueve (otro cambio hace menos de 150 ms) el orden se arma
// en un worker y se dibuja con el anterior hasta que llega; al llegar se vuelve a dibujar. Un render suelto (después
// de una pausa, un playblast o sync) ordena acá mismo y sale exacto. El pick no usa el orden.
let SPLAT_WORKER_MIN = 4e5; // let: el QA lo sube para medir el orden en el hilo principal
function splatSortWorker(S) {
  try {
    const url = URL.createObjectURL(new Blob([splatOrder.toString() + `
      let c, n, lo, hi, depth, counts = new Uint32Array(65536), starts = new Uint32Array(65536);
      onmessage = (e) => { const d = e.data; if (d.cen) { ({ cen: c, n, lo, hi } = d); depth = new Uint16Array(n); return; } splatOrder(c, n, d.key, lo, hi, depth, counts, starts, d.out); postMessage(d, [d.out.buffer]); };`], { type: 'text/javascript' }));
    const w = new Worker(url); w.url = url; S.spare = new Float32Array(S.n);
    const cen = S.cen.slice(); w.postMessage({ cen, n: S.n, lo: S.lo, hi: S.hi }, [cen.buffer]);
    return w;
  } catch (e) { return null; }
}
function sortSplats(mesh, cam = camera, sync = false) {
  const S = mesh.userData.sort, mv = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, mesh.matrixWorld).elements;
  const key = [mv[2], mv[6], mv[10], mv[14]], attr = mesh.geometry.attributes.splatIndex;
  if (!sync && S.last && Math.abs(S.last[0] - key[0]) + Math.abs(S.last[1] - key[1]) + Math.abs(S.last[2] - key[2]) < 1e-3 && Math.abs(S.last[3] - key[3]) < 1e-3) return;
  const now = performance.now(), live = now - S.t < 150; S.t = now;
  if (!sync && live && S.n >= SPLAT_WORKER_MIN && !(typeof pb !== 'undefined' && pb.busy)) {
    if (S.worker === undefined) {
      S.worker = splatSortWorker(S);
      if (S.worker) S.worker.onmessage = (e) => {
        if (!scanObj || mesh.parent !== scanObj) return; // el scan ya se cambió
        const drop = S.drop; S.drop = false; S.busy = false;
        if (drop) S.spare = e.data.out; // ya se ordenó acá con una cámara más nueva: se descarta
        else { S.spare = attr.array; attr.array = e.data.out; attr.needsUpdate = true; S.last = e.data.key; }
        if (S.want) { const k = S.want; S.want = null; S.busy = true; S.worker.postMessage({ key: k, out: S.spare }, [S.spare.buffer]); }
        if (!drop && !S.raf) S.raf = requestAnimationFrame(() => { S.raf = 0; render(); }); // dibuja con el orden nuevo (uno por cuadro)
      };
      if (S.worker) S.worker.onerror = () => { S.worker.terminate(); S.worker = null; S.busy = false; S.want = null; S.spare = null; S.last = null; render(); }; // sin worker: en el hilo principal
    }
    if (S.worker) {
      if (S.busy) S.want = key;
      else { S.busy = true; S.want = null; S.worker.postMessage({ key, out: S.spare }, [S.spare.buffer]); }
      return;
    }
  }
  if (S.busy) { S.want = null; S.drop = true; } // el que viene del worker es más viejo que éste
  S.last = key;
  splatOrder(S.cen, S.n, key, S.lo, S.hi, S.depth, S.counts, S.starts, attr.array);
  attr.needsUpdate = true;
}
// Pick sobre un splat. Se acumula la opacidad a lo largo del rayo como en el render: cada gaussiana (su
// covarianza, no sólo el centro) aporta su alfa máximo sobre el rayo, ordenadas por profundidad, hasta que lo
// de adelante tapa la mitad. Tomar el centro más adelantado cerca del rayo caía en "floaters" sueltos:
// medido con un splat real, hasta 1.8 m delante del piso a 5 m. Sin una superficie que tape (zona rala), vale
// el centro más cercano al rayo de la capa de adelante, como antes. Supone splats chatos sobre la superficie,
// como los de un 3DGS entrenado: con esferas, en una superficie rasante las colas de las vecinas tapan la mitad
// antes de llegar (esferas de 2.2 cm vistas a ~10°: 3 cm por encima, hasta 19 cm antes sobre el rayo).
function splatProxyRaycast(raycaster, intersects) {
  const pos = this.geometry.attributes.position.array, n = pos.length / 3;
  const mesh = this.parent && this.parent.children.find(o => o.userData.isSplat), U = mesh && mesh.material.uniforms;
  const cen = U && U.tCenter.value.image.data, ca = U && U.tCovA.value.image.data, cb = U && U.tCovB.value.image.data;
  const inv = new THREE.Matrix4().copy(this.matrixWorld).invert(), r = new THREE.Ray().copy(raycaster.ray).applyMatrix4(inv);
  const k = new THREE.Vector3().setFromMatrixScale(this.matrixWorld).x || 1, thr = raycaster.params.Points.threshold / k, thr2 = thr * thr;
  const o = r.origin, d = r.direction, near = [], hit = [], e2 = thr2 * 0.01; // e2: piso de varianza (~0.6 px), como el filtro de 0.3 px del shader
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3] - o.x, y = pos[i * 3 + 1] - o.y, z = pos[i * 3 + 2] - o.z, t = x * d.x + y * d.y + z * d.z;
    if (t <= 0) continue;
    const p2 = x * x + y * y + z * z - t * t;
    if (p2 <= thr2) near.push(t, p2, i);
    if (!cen) continue;
    const j = i * 4, tr = ca[j] + ca[j + 3] + cb[j + 1]; // traza: cota de la varianza mayor
    if (p2 > 9 * tr + e2) continue;
    // Σ⁻¹ (simétrica) y el mínimo de (w + s·d)ᵀ Σ⁻¹ (w + s·d) sobre el rayo, w = o - centro
    const a = ca[j] + e2, b = ca[j + 1], c = ca[j + 2], dd = ca[j + 3] + e2, ee = cb[j], f = cb[j + 1] + e2;
    const A = dd * f - ee * ee, B = c * ee - b * f, C = b * ee - c * dd, det = a * A + b * B + c * C;
    if (!(det > 0)) continue;
    const D = (a * f - c * c) / det, E = (b * c - a * ee) / det, F = (a * dd - b * b) / det, Ai = A / det, Bi = B / det, Ci = C / det;
    const Pw = [-(Ai * x + Bi * y + Ci * z), -(Bi * x + D * y + E * z), -(Ci * x + E * y + F * z)];
    const Pd = [Ai * d.x + Bi * d.y + Ci * d.z, Bi * d.x + D * d.y + E * d.z, Ci * d.x + E * d.y + F * d.z];
    const wPw = -(x * Pw[0] + y * Pw[1] + z * Pw[2]), dPw = d.x * Pw[0] + d.y * Pw[1] + d.z * Pw[2], dPd = d.x * Pd[0] + d.y * Pd[1] + d.z * Pd[2];
    const al = Math.min(0.99, cen[j + 3] * Math.exp(-0.5 * Math.max(0, wPw - dPw * dPw / dPd)));
    if (al > 1 / 255) hit.push(-dPw / dPd, al);
  }
  // profundidad donde lo de adelante ya tapa la mitad: la superficie que se ve
  let bt = -1, bp = 0, bi = -1;
  if (hit.length) {
    const ord = []; for (let c = 0; c < hit.length; c += 2) ord.push(c);
    ord.sort((p, q) => hit[p] - hit[q]);
    let T = 1; for (const c of ord) { T *= 1 - hit[c + 1]; if (T < 0.5) { bt = hit[c]; break; } }
  }
  if (bt < 0) { // zona rala: el centro más cercano al rayo en la capa de adelante
    if (!near.length) return;
    let front = Infinity; for (let c = 0; c < near.length; c += 3) front = Math.min(front, near[c]);
    bp = Infinity;
    for (let c = 0; c < near.length; c += 3) if (near[c] <= front + 6 * thr && near[c + 1] < bp) { bt = near[c]; bp = near[c + 1]; bi = near[c + 2]; }
  }
  const pt = r.at(bt, new THREE.Vector3()).applyMatrix4(this.matrixWorld);
  intersects.push({ distance: raycaster.ray.origin.distanceTo(pt), distanceToRay: Math.sqrt(bp) * k, point: pt, index: bi, face: null, object: this });
}
function parsePLYPoints(buf) {
  const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 200000)));
  const hi = head.indexOf('end_header');
  if (hi < 0) throw new Error('PLY has no header');
  let start = hi + 10; if (head[start] === '\r') start++; start++;
  const lines = head.slice(0, hi).split(/\r?\n/);
  let format = 'ascii', elems = [], cur = null;
  for (const ln of lines) {
    const t = ln.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') { cur = { name: t[1], count: +t[2], props: [] }; elems.push(cur); }
    else if (t[0] === 'property' && cur) {
      if (t[1] === 'list') cur.props.push({ list: true, ct: t[2], it: t[3], name: t[4] });
      else cur.props.push({ type: t[1], name: t[2] });
    }
  }
  const faces = elems.find(e => e.name === 'face');
  if (faces && faces.count > 0) return null;
  const ve = elems.find(e => e.name === 'vertex');
  if (!ve) throw new Error('PLY has no vertices');
  const SZ = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const idx = {}; ve.props.forEach((p, i) => idx[p.name] = i);
  const hasRGB = 'red' in idx, hasDC = 'f_dc_0' in idx, hasOp = 'opacity' in idx;
  const isSplat = hasDC && hasOp && 'scale_0' in idx && 'rot_0' in idx;
  const N = ve.count;
  const maxPts = isSplat ? 3e6 : 6e6, step = Math.max(1, Math.ceil(N / maxPts));
  const cap = Math.ceil(N / step);
  // f_rest_*: los coeficientes de cada canal seguidos (R, después G, después B); acá van coeficiente por coeficiente
  const per = ve.props.filter(p => /^f_rest_\d+$/.test(p.name)).length / 3, shDeg = isSplat ? (per >= 15 ? 3 : per >= 8 ? 2 : per >= 3 ? 1 : 0) : 0, shIdx = [];
  for (let k = 0; k < (shDeg + 1) ** 2 - 1; k++) for (let c = 0; c < 3; c++) shIdx.push(idx['f_rest_' + (c * per + k)]);
  const spl = isSplat ? { scl: new Float32Array(cap * 3), rot: new Float32Array(cap * 4), op: new Float32Array(cap), sh: shDeg ? new Uint8Array(cap * 48).fill(128) : null } : null;
  const minOp = SPLAT_MIN_OP;
  const pos = new Float32Array(Math.ceil(N / step) * 3), col = (hasRGB || hasDC) ? new Float32Array(Math.ceil(N / step) * 3) : null;
  let k = 0, dropped = 0;
  const vals = new Float64Array(ve.props.length);
  const take = (v) => {
    const opv = hasOp ? 1 / (1 + Math.exp(-v[idx.opacity])) : 1;
    if (hasOp && opv < minOp) { dropped++; return; }
    pos[k * 3] = v[idx.x]; pos[k * 3 + 1] = v[idx.y]; pos[k * 3 + 2] = v[idx.z];
    if (spl) {
      spl.op[k] = opv;
      for (let c = 0; c < 3; c++) spl.scl[k * 3 + c] = Math.exp(v[idx['scale_' + c]]);
      for (let c = 0; c < 4; c++) spl.rot[k * 4 + c] = v[idx['rot_' + c]];
      if (spl.sh) for (let j = 0; j < shIdx.length; j++) spl.sh[k * 48 + j] = splatShByte(v[shIdx[j]]);
    }
    if (col) {
      if (hasDC) for (let c = 0; c < 3; c++) col[k * 3 + c] = Math.min(1, Math.max(0, 0.5 + 0.28209479 * v[idx['f_dc_' + c]]));
      else {
        const isF = ve.props[idx.red].type.startsWith('float');
        for (const [c, nm] of [[0, 'red'], [1, 'green'], [2, 'blue']]) col[k * 3 + c] = isF ? v[idx[nm]] : v[idx[nm]] / 255;
      }
    }
    k++;
  };
  if (format === 'ascii') {
    const body = new TextDecoder('latin1').decode(new Uint8Array(buf, start)).split(/\r?\n/);
    let li = 0;
    for (let i = 0; i < N; i++) {
      while (li < body.length && !body[li].trim()) li++;
      const t = body[li++].trim().split(/\s+/);
      if (i % step) continue;
      for (let j = 0; j < vals.length; j++) vals[j] = +t[j];
      take(vals);
    }
  } else {
    const le = format === 'binary_little_endian';
    const dv = new DataView(buf, start);
    if (ve.props.some(p => p.list)) throw new Error('PLY with list properties on vertices is not supported');
    const offs = []; let stride = 0;
    for (const p of ve.props) { offs.push(stride); stride += SZ[p.type]; }
    const rd = ve.props.map(p => {
      switch (p.type) {
        case 'char': case 'int8': return (o) => dv.getInt8(o);
        case 'uchar': case 'uint8': return (o) => dv.getUint8(o);
        case 'short': case 'int16': return (o) => dv.getInt16(o, le);
        case 'ushort': case 'uint16': return (o) => dv.getUint16(o, le);
        case 'int': case 'int32': return (o) => dv.getInt32(o, le);
        case 'uint': case 'uint32': return (o) => dv.getUint32(o, le);
        case 'double': case 'float64': return (o) => dv.getFloat64(o, le);
        default: return (o) => dv.getFloat32(o, le);
      }
    });
    // read only needed props for speed
    const need = new Set(['x', 'y', 'z', 'red', 'green', 'blue', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'].filter(n => n in idx).map(n => idx[n]).concat(shIdx));
    for (let i = 0; i < N; i += step) {
      const base = i * stride;
      for (const j of need) vals[j] = rd[j](base + offs[j]);
      take(vals);
    }
  }
  // slice y no subarray: pos y col quedan vivos (proxy y sort) y un subarray retendría el búfer de los N splats del archivo
  const out = { pos: pos.slice(0, k * 3), col: col ? col.slice(0, k * 3) : null, info: splatInfo(step, dropped) };
  if (spl) out.splat = { n: k, pos: out.pos, col: out.col, op: spl.op.subarray(0, k), scl: spl.scl.subarray(0, k * 3), rot: spl.rot.subarray(0, k * 4), sh: spl.sh && spl.sh.subarray(0, k * 48), shDeg };
  return out;
}
function splatInfo(step, dropped) {
  const info = [];
  if (step > 1) info.push(`1 in ${step}`);
  if (dropped) info.push(`${dropped.toLocaleString('en-US')} near-transparent splats removed`);
  return info.join(' · ');
}
// .splat (formato del visor antimatter15/splat): 32 bytes por splat, posición y escala en float32 (escala ya
// lineal), color RGBA en bytes (A = opacidad) y rotación w,x,y,z en bytes ((q + 1) * 128). Sin armónicos.
function parseSplatFile(buf) {
  const N = Math.floor(buf.byteLength / 32);
  if (!N || buf.byteLength % 32) throw new Error('not a .splat file (size is not a multiple of 32 bytes)');
  const step = Math.max(1, Math.ceil(N / 3e6)), cap = Math.ceil(N / step), minOp = SPLAT_MIN_OP;
  const f = new Float32Array(buf, 0, N * 8), u = new Uint8Array(buf);
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), scl = new Float32Array(cap * 3), rot = new Float32Array(cap * 4), op = new Float32Array(cap);
  let k = 0, dropped = 0;
  for (let i = 0; i < N; i += step) {
    const b = i * 32, a = u[b + 27] / 255;
    if (a < minOp) { dropped++; continue; }
    for (let c = 0; c < 3; c++) { pos[k * 3 + c] = f[i * 8 + c]; scl[k * 3 + c] = f[i * 8 + 3 + c]; col[k * 3 + c] = u[b + 24 + c] / 255; }
    for (let c = 0; c < 4; c++) rot[k * 4 + c] = (u[b + 28 + c] - 128) / 128;
    op[k] = a; k++;
  }
  const out = { pos: pos.slice(0, k * 3), col: col.slice(0, k * 3), info: splatInfo(step, dropped) };
  out.splat = { n: k, pos: out.pos, col: out.col, op: op.subarray(0, k), scl: scl.subarray(0, k * 3), rot: rot.subarray(0, k * 4) };
  return out;
}
const splatShByte = v => Math.max(0, Math.min(255, Math.round(128 + 128 * v)));
// Salida común de .spz y .ksplat: read(i, o) llena o (p posición, c color de base 0..1, s escala lineal, q rotación
// w x y z, a opacidad, sh 48 bytes como splatShByte). Descarta los casi transparentes y raletea más de 3 millones.
function splatCollect(N, shDeg, read) {
  const step = Math.max(1, Math.ceil(N / 3e6)), cap = Math.ceil(N / step);
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), scl = new Float32Array(cap * 3), rot = new Float32Array(cap * 4), op = new Float32Array(cap);
  const sh = shDeg ? new Uint8Array(cap * 48) : null, o = { p: [0, 0, 0], c: [0, 0, 0], s: [0, 0, 0], q: [1, 0, 0, 0], a: 0, sh: new Uint8Array(48).fill(128) };
  let k = 0, dropped = 0;
  for (let i = 0; i < N; i += step) {
    read(i, o);
    if (!(o.a >= SPLAT_MIN_OP)) { dropped++; continue; }
    for (let c = 0; c < 3; c++) { pos[k * 3 + c] = o.p[c]; col[k * 3 + c] = Math.min(1, Math.max(0, o.c[c])); scl[k * 3 + c] = o.s[c]; }
    for (let c = 0; c < 4; c++) rot[k * 4 + c] = o.q[c];
    op[k] = o.a; if (sh) sh.set(o.sh, k * 48); k++;
  }
  const out = { pos: pos.slice(0, k * 3), col: col.slice(0, k * 3), info: splatInfo(step, dropped) };
  out.splat = { n: k, pos: out.pos, col: out.col, op: op.subarray(0, k), scl: scl.subarray(0, k * 3), rot: rot.subarray(0, k * 4), sh: sh && sh.subarray(0, k * 48), shDeg };
  return out;
}
// .spz (Niantic, github.com/nianticlabs/spz): v2-3 es todo gzip con una cabecera de 16 bytes; v4, cabecera de 32
// bytes, una tabla y un stream zstd por atributo. Atributos en bloques: posición (3 x 24 bits en punto fijo), alfa,
// color (f_dc cuantizado con escala 0.15), escala (log, b / 16 - 10), rotación (v2: x y z en 8 bits; v3+: las tres
// menores en 10 bits y el índice de la mayor) y armónicos en 8 bits, ya en el orden y la escala de splatShByte.
// La v4 guarda en RUB (Y arriba); los gzip que hay dando vueltas (Babylon, el capybara de octoview) traen los ejes del
// PLY de origen, como un .splat.
async function parseSpzFile(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf), MAGIC = 0x5053474e;
  let ver, N, deg, fb, P, A, C, S, R, H;
  if (u.length >= 32 && dv.getUint32(0, true) === MAGIC) {
    ver = dv.getUint32(4, true); N = dv.getUint32(8, true); deg = u[12]; fb = u[13];
    const ns = u[15], toc = dv.getUint32(16, true);
    if (ver !== 4) throw new Error('.spz version ' + ver + ' is not supported');
    await splatLoadZstd();
    const parts = []; let o = toc + ns * 16;
    for (let s = 0; s < ns; s++) {
      const cs = Number(dv.getBigUint64(toc + s * 16, true)), us = Number(dv.getBigUint64(toc + s * 16 + 8, true));
      parts.push(fzstd.decompress(u.subarray(o, o + cs), new Uint8Array(us))); o += cs;
    }
    [P, A, C, S, R, H] = parts;
  } else if (u[0] === 0x1f && u[1] === 0x8b) {
    const raw = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const h = new DataView(raw.buffer);
    if (raw.length < 16 || h.getUint32(0, true) !== MAGIC) throw new Error('not a .spz file');
    ver = h.getUint32(4, true); N = h.getUint32(8, true); deg = raw[12]; fb = raw[13];
    if (ver < 2 || ver > 3) throw new Error('.spz version ' + ver + ' is not supported');
    let o = 16; const take = (len) => raw.subarray(o, o += len);
    P = take(N * 9); A = take(N); C = take(N * 3); S = take(N * 3); R = take(N * (ver >= 3 ? 4 : 3)); H = take(N * 3 * [0, 3, 8, 15, 24][deg]);
  } else throw new Error('not a .spz file');
  const dim = [0, 3, 8, 15, 24][deg] * 3, used = Math.min(dim, 45), smallest = ver >= 3;
  if (!P || P.length < N * 9 || !R || R.length < N * (smallest ? 4 : 3) || (dim && (!H || H.length < N * dim))) throw new Error('the .spz file is truncated');
  const fx = 1 / (1 << fb), q = [0, 0, 0, 0];
  const out = splatCollect(N, Math.min(deg, 3), (i, o) => {
    for (let c = 0; c < 3; c++) {
      const b = i * 9 + c * 3; let v = P[b] | (P[b + 1] << 8) | (P[b + 2] << 16); if (v & 0x800000) v |= ~0xffffff;
      o.p[c] = v * fx; o.c[c] = 0.5 + 0.28209479 * ((C[i * 3 + c] / 255 - 0.5) / 0.15); o.s[c] = Math.exp(S[i * 3 + c] / 16 - 10);
    }
    if (smallest) {
      let w = R[i * 4] | (R[i * 4 + 1] << 8) | (R[i * 4 + 2] << 16) | (R[i * 4 + 3] << 24);
      const big = w >>> 30; let ss = 0;
      for (let j = 3; j >= 0; j--) if (j !== big) { const m = w & 511, neg = (w >>> 9) & 1; w >>>= 10; q[j] = 0.7071067811865476 * m / 511 * (neg ? -1 : 1); ss += q[j] * q[j]; }
      q[big] = Math.sqrt(Math.max(0, 1 - ss));
    } else { for (let j = 0; j < 3; j++) q[j] = R[i * 3 + j] / 127.5 - 1; q[3] = Math.sqrt(Math.max(0, 1 - q[0] * q[0] - q[1] * q[1] - q[2] * q[2])); }
    o.q[0] = q[3]; o.q[1] = q[0]; o.q[2] = q[1]; o.q[3] = q[2]; // x y z w -> w x y z
    o.a = A[i] / 255;
    if (used) o.sh.set(H.subarray(i * dim, i * dim + used));
  });
  if (ver === 4) out.up = 'y';
  return out;
}
// fzstd (vendor/, MIT) sólo para .spz v4: el navegador no trae zstd. Se carga la primera vez que hace falta.
function splatLoadZstd() {
  if (typeof fzstd !== 'undefined') return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/fzstd.js'; s.onload = res; s.onerror = () => rej(new Error('vendor/fzstd.js is missing')); document.head.appendChild(s); });
}
// .ksplat (GaussianSplats3D de mkkellogg, src/loaders/SplatBuffer.js): cabecera de 4096 bytes, secciones con una
// cabecera de 1024 cada una y, por sección, los centros de los "buckets" y los splats. Nivel 0: todo float32; 1 y 2:
// centro en uint16 relativo a su bucket, escala (lineal) y rotación (w x y z) en float16, color RGBA en bytes y
// armónicos (grado ≤ 2, cada canal seguido como en el PLY) en float16 (nivel 1) o en bytes entre un mínimo y un
// máximo de la cabecera (nivel 2). Mismos ejes que el PLY de origen (COLMAP).
let splatHalf = null;
function parseKsplatFile(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf);
  if (u.length < 4096 || u[0] !== 0 || u[1] < 1) throw new Error('not a .ksplat file');
  const maxSec = dv.getUint32(4, true), lvl = dv.getUint16(20, true), shMin = dv.getFloat32(36, true) || -1.5, shMax = dv.getFloat32(40, true) || 1.5;
  if (lvl > 2) throw new Error('.ksplat compression level ' + lvl + ' is not supported');
  if (lvl && !splatHalf) { splatHalf = new Float32Array(65536); for (let h = 0; h < 65536; h++) { const e = (h >> 10) & 31, m = h & 1023, sg = h & 0x8000 ? -1 : 1; splatHalf[h] = e === 0 ? sg * m * 2 ** -24 : e === 31 ? (m ? NaN : sg * Infinity) : sg * (1 + m / 1024) * 2 ** (e - 15); } }
  const secs = []; let base = 4096 + maxSec * 1024, N = 0, deg = 2;
  for (let s = 0; s < maxSec; s++) {
    const h = 4096 + s * 1024, n = dv.getUint32(h, true), maxN = dv.getUint32(h + 4, true), bSize = dv.getUint32(h + 8, true), bCount = dv.getUint32(h + 12, true);
    const block = dv.getFloat32(h + 16, true), bBytes = dv.getUint16(h + 20, true), range = dv.getUint32(h + 24, true) || (lvl ? 32767 : 1);
    const full = dv.getUint32(h + 32, true), partial = dv.getUint32(h + 36, true), sd = dv.getUint16(h + 40, true);
    const bps = (lvl ? 24 : 44) + [0, 9, 24][sd] * [4, 2, 1][lvl], meta = partial * 4, bucketsBytes = bBytes * bCount + meta;
    const sec = { n, start: N, bps, dataBase: base + bucketsBytes, bucketsBase: base + meta, sf: block / 2 / range, range, bucket: null };
    if (lvl && n) { // bucket de cada splat: primero los llenos, después los parciales con su largo
      sec.bucket = new Uint32Array(n); let j = 0, b = 0;
      for (; b < full && j < n; b++) for (let k = 0; k < bSize && j < n; k++) sec.bucket[j++] = b;
      for (let p = 0; p < partial && j < n; p++, b++) for (let k = 0, len = dv.getUint32(base + p * 4, true); k < len && j < n; k++) sec.bucket[j++] = b;
    }
    if (n && sec.dataBase + bps * maxN > u.length) throw new Error('the .ksplat file is truncated');
    if (n) { secs.push(sec); deg = Math.min(deg, sd); }
    N += n; base += bps * maxN + bucketsBytes;
  }
  if (!N) throw new Error('the .ksplat file has no splats');
  let sec = secs[0], si = 0;
  const flt = (o, k) => lvl ? splatHalf[dv.getUint16(o + k * 2, true)] : dv.getFloat32(o + k * 4, true);
  const shv = (o, k) => lvl === 0 ? dv.getFloat32(o + k * 4, true) : lvl === 1 ? splatHalf[dv.getUint16(o + k * 2, true)] : shMin + u[o + k] / 255 * (shMax - shMin);
  return splatCollect(N, deg, (i, o) => {
    while (i >= sec.start + sec.n) sec = secs[++si];
    const j = i - sec.start, b = sec.dataBase + j * sec.bps, so = b + (lvl ? 6 : 12), co = so + (lvl ? 14 : 28);
    for (let c = 0; c < 3; c++) {
      o.p[c] = lvl ? (dv.getUint16(b + c * 2, true) - sec.range) * sec.sf + dv.getFloat32(sec.bucketsBase + sec.bucket[j] * 12 + c * 4, true) : dv.getFloat32(b + c * 4, true);
      o.s[c] = flt(so, c); o.c[c] = u[co + c] / 255;
    }
    for (let c = 0; c < 4; c++) o.q[c] = flt(so, 3 + c);
    o.a = u[co + 3] / 255;
    if (deg) { // de canal por canal (3 de grado 1 y después 5 de grado 2) a coeficiente por coeficiente
      const ho = co + 4;
      for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) o.sh[k * 3 + c] = splatShByte(shv(ho, c * 3 + k));
      if (deg > 1) for (let k = 0; k < 5; k++) for (let c = 0; c < 3; c++) o.sh[9 + k * 3 + c] = splatShByte(shv(ho, 9 + c * 5 + k));
    }
  });
}
// Color según el ángulo de vista prendido o apagado (lo apaga el usuario si el visor se pone lento)
function splatSetSH(on) {
  splatShOn = !!on; lsSet('splatSH', splatShOn);
  if (scanObj) scanObj.traverse(o => { if (o.userData.isSplat) o.material.uniforms.shDeg.value = splatShOn ? o.userData.shDeg : 0; });
  render();
}
// Caja del splat sin los "floaters" sueltos que deja el entrenamiento (a veces a cientos de metros): del
// percentil 1 al 99 de los centros en cada eje, más un 5 % de margen, sin pasarse de la caja real. Con esa
// caja se encuadra, se adivinan las unidades, se miden las dimensiones y se apoya en el piso.
function splatRobustBox(pos) {
  const n = pos.length / 3, every = Math.max(1, Math.floor(n / 200000)), lo = [], hi = [];
  for (let c = 0; c < 3; c++) {
    const a = []; for (let i = 0; i < n; i += every) a.push(pos[i * 3 + c]);
    a.sort((x, y) => x - y);
    const p1 = a[Math.floor((a.length - 1) * 0.01)], p99 = a[Math.floor((a.length - 1) * 0.99)], m = (p99 - p1) * 0.05;
    lo.push(Math.max(a[0], p1 - m)); hi.push(Math.min(a[a.length - 1], p99 + m));
  }
  return new THREE.Box3(new THREE.Vector3(...lo), new THREE.Vector3(...hi));
}
// Altura (mundo) del piso de un splat, o null si no tiene. Un auto escaneado en la calle trae la calle: es la capa
// horizontal más densa de la parte de abajo. El punto más bajo no sirve: debajo de la calle quedan reflejos y
// floaters (medido en un splat real: el mínimo robusto caía 93 cm debajo de la calle). Sin una capa así (un auto
// recortado, sin piso) devuelve null y se usa el punto más bajo.
function splatFloorY() {
  const pr = scanObj && scanObj.children && scanObj.children.find(o => o.userData.pickProxy);
  if (!pr) return null;
  const pos = pr.geometry.attributes.position.array, n = pos.length / 3, every = Math.max(1, Math.floor(n / 300000)), ys = [];
  pr.updateMatrixWorld(true); const m = pr.matrixWorld.elements;
  for (let i = 0; i < n; i += every) ys.push(m[1] * pos[i * 3] + m[5] * pos[i * 3 + 1] + m[9] * pos[i * 3 + 2] + m[13]);
  const s = ys.slice().sort((a, b) => a - b), lo = s[Math.floor(s.length * 0.01)], hi = s[Math.floor(s.length * 0.99)], B = 100, h = new Array(B).fill(0);
  if (!(hi > lo)) return null;
  for (const y of ys) { const b = Math.floor((y - lo) / (hi - lo) * B); if (b >= 0 && b < B) h[b]++; }
  let pk = 0; for (let b = 1; b < B * 0.4; b++) if (h[b] > h[pk]) pk = b;
  const med = h.slice().sort((a, b) => a - b)[B >> 1];
  if (h[pk] < 4 * med) return null; // sin capa marcada: en un auto limpio el pico no pasa de 2x
  const band = s.filter(y => y >= lo + (pk - 1) / B * (hi - lo) && y < lo + (pk + 2) / B * (hi - lo));
  return band[band.length >> 1];
}

async function loadScanFile(file) {
  setBusy(true, 'Loading ' + file.name + '…');
  const ext = file.name.split('.').pop().toLowerCase();
  st.plyInfo = '';
  try {
    const buf = await file.arrayBuffer();
    let obj, kind = 'mesh';
    if (ext === 'obj') {
      obj = new THREE.OBJLoader().parse(new TextDecoder().decode(buf));
      let anyMesh = false; obj.traverse(o => { if (o.isMesh) anyMesh = true; });
      if (!anyMesh) kind = 'points';
    } else if (ext === 'ply' || ext === 'splat' || ext === 'spz' || ext === 'ksplat') {
      const pts = ext === 'splat' ? parseSplatFile(buf) : ext === 'spz' ? await parseSpzFile(buf) : ext === 'ksplat' ? parseKsplatFile(buf) : parsePLYPoints(buf);
      if (pts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pts.pos, 3));
        if (pts.col) g.setAttribute('color', new THREE.BufferAttribute(pts.col, 3));
        const ptsObj = new THREE.Points(g, PTS.mono); ptsObj.userData.hasColor = !!pts.col;
        kind = 'points'; st.plyInfo = pts.info;
        if (pts.splat && pts.splat.n) {
          obj = new THREE.Group(); obj.add(ptsObj); ptsObj.userData.pickProxy = true; ptsObj.raycast = splatProxyRaycast;
          const mesh = makeSplatMesh(pts.splat), box = splatRobustBox(pts.pos);
          g.boundingBox = box; g.boundingSphere = box.getBoundingSphere(new THREE.Sphere()); ptsObj.frustumCulled = false;
          mesh.geometry.boundingBox = box; mesh.geometry.boundingSphere = g.boundingSphere;
          obj.add(mesh); kind = 'splat'; obj.userData.up = pts.up;
          if ($('disp').value !== 'splat') { $('disp').value = 'splat'; }
        } else obj = ptsObj;
      } else {
        const g = new THREE.PLYLoader().parse(buf);
        g.computeVertexNormals();
        const m = new THREE.MeshLambertMaterial({ color: 0xb9c3cd, vertexColors: !!g.attributes.color, side: THREE.DoubleSide });
        obj = new THREE.Mesh(g, m);
      }
    } else if (ext === 'glb' || ext === 'gltf') {
      obj = await new Promise((res, rej) => makeGLTFLoader().parse(buf, '', g => res(g.scene), rej));
    } else if (ext === 'fbx') {
      obj = new THREE.FBXLoader().parse(buf, '');
    } else throw new Error('unsupported format: .' + ext);
    finishScan(obj, file.name, kind, ext);
  } catch (err) {
    setBusy(false);
    showMsg('unit-msg', 'Could not read ' + file.name + ': ' + (err.message || err) + '. Try exporting it as GLB, OBJ or binary PLY.', 'msg bad');
    console.error(err);
  }
}
function showMsg(id, txt, cls) { const m = $(id); m.hidden = false; m.className = cls; m.textContent = txt; }
function setBusy(on, txt) { $('busy').hidden = !on; if (txt) $('busy').textContent = txt; }

