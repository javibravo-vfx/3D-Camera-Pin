// Lector de OBJ por streaming. Corre en un worker (js/obj-stream.js lo lanza) y también se importa en Node para los
// tests (expone ObjStream en globalThis). Un OBJ de scan pasa fácil los 512 M caracteres que V8 deja en un string
// (un scan real de cientos de MB: Chrome devuelve "" sin error): el archivo se lee en pedazos y se parsea
// byte a byte, armando la malla indexada directo en typed arrays, sin strings ni arrays de objetos.
// Igual que el OBJLoader de three: polígonos en abanico, índices negativos, o/g abren objeto, usemtl abre grupo,
// colores por vértice (v x y z r g b, de sRGB a lineal) y nube de puntos si no hay caras.
// shortcut: no lee 'l' ni 'p' (líneas y puntos sueltos) ni la continuación con '\'; agregarlos si aparece un scan así.
(function () {
  'use strict';
  class Grow {
    constructor(T, n) { this.T = T; this.a = new T(n); this.n = 0; }
    need(k) { if (this.n + k > this.a.length) { const b = new this.T(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
    out() { return this.a.slice(0, this.n); }
  }
  const s2l = (c) => c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
  const POW = []; for (let i = 0; i <= 22; i++) POW.push(Math.pow(10, i)); // hasta 1e22 son exactos: m / 10^k redondea bien

  function createParser() {
    const V = new Grow(Float32Array, 1 << 16), T = new Grow(Float32Array, 1 << 15), N = new Grow(Float32Array, 1 << 15);
    let C = null, nv = 0, nt = 0, nn = 0, faces = 0;
    const objects = [], mtllibs = [];
    let obj = null, curMat = '';
    let b = null, p = 0, F = new Int32Array(3 * 64);
    const dec = new TextDecoder();

    function newObject(name) {
      obj = { name, pos: new Grow(Float32Array, 1 << 12), uv: new Grow(Float32Array, 1 << 11), nrm: new Grow(Float32Array, 1 << 12), col: null,
        keys: new Grow(Int32Array, 1 << 12), idx: new Grow(Uint32Array, 1 << 12), table: new Int32Array(1 << 12).fill(-1), count: 0,
        hasUV: false, hasN: false, groups: [{ start: 0, mat: curMat }] };
      objects.push(obj);
    }
    // o/g: como el OBJLoader, un objeto que todavía no tiene caras se reusa (sólo cambia de nombre)
    function startObject(name) { if (obj && obj.idx.n === 0) obj.name = name; else newObject(name); }
    function useMtl(name) {
      if (!obj) newObject('');
      const g = obj.groups[obj.groups.length - 1];
      if (g.mat === name) { curMat = name; return; }
      if (obj.idx.n === g.start) g.mat = name; else obj.groups.push({ start: obj.idx.n, mat: name });
      curMat = name;
    }
    function rehash(o) {
      const cap = o.table.length * 2, mask = cap - 1, t = new Int32Array(cap).fill(-1), K = o.keys.a;
      for (let e = 0; e < o.count; e++) {
        let h = (Math.imul(K[e * 2], 73856093) ^ Math.imul(K[e * 2 + 1], 19349663)) & mask;
        while (t[h] >= 0) h = (h + 1) & mask;
        t[h] = e;
      }
      o.table = t;
    }
    // una esquina (v, vt) -> vértice de salida; el mismo par se reusa (malla indexada). La normal no entra en la
    // clave: se promedia por vértice. 3ds Max escribe una normal por cara (f 1/1/1 2/2/1 3/3/1) y con ella en la
    // clave un scan real tenía 15 M de vértices (uno por esquina) en vez de 2,7 M. Una arista viva se ve suavizada.
    function corner(vi, ti, ni) {
      const o = obj, mask = o.table.length - 1, K = o.keys.a;
      let h = (Math.imul(vi, 73856093) ^ Math.imul(ti, 19349663)) & mask, e;
      while ((e = o.table[h]) >= 0) {
        if (K[e * 2] === vi && K[e * 2 + 1] === ti) {
          if (ni >= 0) { const Nn = o.nrm.a; Nn[e * 3] += N.a[ni * 3]; Nn[e * 3 + 1] += N.a[ni * 3 + 1]; Nn[e * 3 + 2] += N.a[ni * 3 + 2]; o.hasN = true; }
          return e;
        }
        h = (h + 1) & mask;
      }
      e = o.count++; o.table[h] = e;
      o.keys.need(2); const k = o.keys.a; k[o.keys.n++] = vi; k[o.keys.n++] = ti;
      o.pos.need(3); const P = o.pos.a, Va = V.a; P[o.pos.n++] = Va[vi * 3]; P[o.pos.n++] = Va[vi * 3 + 1]; P[o.pos.n++] = Va[vi * 3 + 2];
      o.uv.need(2); const U = o.uv.a; if (ti >= 0) { U[o.uv.n++] = T.a[ti * 2]; U[o.uv.n++] = T.a[ti * 2 + 1]; o.hasUV = true; } else { U[o.uv.n++] = 0; U[o.uv.n++] = 0; }
      o.nrm.need(3); const Nn = o.nrm.a; if (ni >= 0) { Nn[o.nrm.n++] = N.a[ni * 3]; Nn[o.nrm.n++] = N.a[ni * 3 + 1]; Nn[o.nrm.n++] = N.a[ni * 3 + 2]; o.hasN = true; } else { Nn[o.nrm.n++] = 0; Nn[o.nrm.n++] = 0; Nn[o.nrm.n++] = 0; }
      if (C) { if (!o.col) { o.col = new Grow(Float32Array, o.pos.a.length); o.col.n = (o.count - 1) * 3; o.col.a.fill(1, 0, o.col.n); } o.col.need(3); const Q = o.col.a; Q[o.col.n++] = C.a[vi * 3]; Q[o.col.n++] = C.a[vi * 3 + 1]; Q[o.col.n++] = C.a[vi * 3 + 2]; }
      if (o.count * 2 > o.table.length) rehash(o);
      return e;
    }

    const isNumStart = (c) => (c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46;
    function skipSp() { let c = b[p]; while (c === 32 || c === 9 || c === 13) c = b[++p]; return c; }
    function num() {
      let c = skipSp(), neg = false;
      if (c === 45) { neg = true; c = b[++p]; } else if (c === 43) c = b[++p];
      let m = 0, e = 0, d;
      while ((d = c - 48) >= 0 && d <= 9) { m = m * 10 + d; c = b[++p]; }
      if (c === 46) { c = b[++p]; while ((d = c - 48) >= 0 && d <= 9) { m = m * 10 + d; e--; c = b[++p]; } }
      if (c === 101 || c === 69) {
        c = b[++p]; let es = 1, x = 0;
        if (c === 45) { es = -1; c = b[++p]; } else if (c === 43) c = b[++p];
        while ((d = c - 48) >= 0 && d <= 9) { x = x * 10 + d; c = b[++p]; }
        e += es * x;
      }
      const v = e === 0 ? m : e < 0 ? (e >= -22 ? m / POW[-e] : m / Math.pow(10, -e)) : m * Math.pow(10, e);
      return neg ? -v : v;
    }
    function int() {
      let c = b[p], neg = false, m = 0, d;
      if (c === 45) { neg = true; c = b[++p]; } else if (c === 43) c = b[++p];
      while ((d = c - 48) >= 0 && d <= 9) { m = m * 10 + d; c = b[++p]; }
      return neg ? -m : m;
    }
    function skipLine(end) { while (p < end && b[p] !== 10) p++; p++; }
    function rest(end) { const a = p; while (p < end && b[p] !== 10) p++; const s = dec.decode(b.subarray(a, p)).trim(); p++; return s; }
    const word = (w) => { for (let i = 0; i < w.length; i++) if (b[p + i] !== w.charCodeAt(i)) return false; const c = b[p + w.length]; return c === 32 || c === 9; };
    const bad = (what, i, n) => { throw new Error(`a face uses ${what} ${i}, but the file only has ${n} before it`); };

    function face(end) {
      let n = 0;
      for (;;) {
        const c = skipSp();
        if (!((c >= 48 && c <= 57) || c === 45 || c === 43)) break;
        let vi = int(), ti = 0, ni = 0;
        if (b[p] === 47) { p++; if (b[p] !== 47) ti = int(); if (b[p] === 47) { p++; ni = int(); } }
        vi = vi > 0 ? vi - 1 : vi < 0 ? nv + vi : -1;
        ti = ti > 0 ? ti - 1 : ti < 0 ? nt + ti : -1;
        ni = ni > 0 ? ni - 1 : ni < 0 ? nn + ni : -1;
        if (vi < 0 || vi >= nv) bad('vertex', vi + 1, nv);
        if (ti >= nt) bad('texture coordinate', ti + 1, nt);
        if (ni >= nn) bad('normal', ni + 1, nn);
        if (n * 3 + 3 > F.length) { const G = new Int32Array(F.length * 2); G.set(F); F = G; }
        F[n * 3] = vi; F[n * 3 + 1] = ti; F[n * 3 + 2] = ni; n++;
      }
      skipLine(end);
      if (n < 3) return;
      if (!obj) newObject('');
      faces++;
      const a = corner(F[0], F[1], F[2]);
      for (let j = 1; j < n - 1; j++) {
        const q = corner(F[j * 3], F[j * 3 + 1], F[j * 3 + 2]), r = corner(F[j * 3 + 3], F[j * 3 + 4], F[j * 3 + 5]);
        obj.idx.need(3); const I = obj.idx.a; I[obj.idx.n++] = a; I[obj.idx.n++] = q; I[obj.idx.n++] = r;
      }
    }
    function vertex(end) {
      const x = num(), y = num(), z = num();
      V.need(3); V.a[V.n++] = x; V.a[V.n++] = y; V.a[V.n++] = z;
      let k = 0; const extra = [0, 0, 0];
      while (k < 3 && isNumStart(skipSp())) extra[k++] = num();
      if (k === 3) {
        if (!C) { C = new Grow(Float32Array, V.a.length); C.n = nv * 3; C.a.fill(1, 0, C.n); }
        C.need(3); C.a[C.n++] = s2l(extra[0]); C.a[C.n++] = s2l(extra[1]); C.a[C.n++] = s2l(extra[2]);
      } else if (C) { C.need(3); C.a[C.n++] = 1; C.a[C.n++] = 1; C.a[C.n++] = 1; }
      nv++;
      skipLine(end);
    }

    // parsea las líneas completas de buf[start, end); end tiene que caer justo después de un '\n'
    function feed(buf, start, end) {
      b = buf; p = start;
      while (p < end) {
        const c = skipSp();
        if (c === 10) { p++; continue; }
        const d = b[p + 1];
        if (c === 118) { // v
          if (d === 32 || d === 9) { p += 2; vertex(end); }
          else if (d === 116 && (b[p + 2] === 32 || b[p + 2] === 9)) { p += 3; const u = num(), v = num(); T.need(2); T.a[T.n++] = u; T.a[T.n++] = v; nt++; skipLine(end); }
          else if (d === 110 && (b[p + 2] === 32 || b[p + 2] === 9)) { p += 3; const x = num(), y = num(), z = num(); N.need(3); N.a[N.n++] = x; N.a[N.n++] = y; N.a[N.n++] = z; nn++; skipLine(end); }
          else skipLine(end);
        } else if (c === 102 && (d === 32 || d === 9)) { p += 2; face(end); }
        else if ((c === 111 || c === 103) && (d === 32 || d === 9 || d === 10 || d === 13)) { p++; startObject(rest(end)); }
        else if (c === 117 && word('usemtl')) { p += 6; useMtl(rest(end)); }
        else if (c === 109 && word('mtllib')) { p += 6; mtllibs.push(rest(end)); }
        else skipLine(end);
      }
    }

    function finish() {
      const out = [];
      for (const o of objects) {
        if (!o.idx.n) continue;
        if (o.hasN) { const Nn = o.nrm.a; for (let i = 0; i < o.nrm.n; i += 3) { const l = Math.hypot(Nn[i], Nn[i + 1], Nn[i + 2]); if (l > 0) { Nn[i] /= l; Nn[i + 1] /= l; Nn[i + 2] /= l; } } }
        const groups = [];
        o.groups.forEach((g, i) => { const e = i + 1 < o.groups.length ? o.groups[i + 1].start : o.idx.n; if (e > g.start) groups.push({ start: g.start, count: e - g.start, material: g.mat }); });
        out.push({ name: o.name, position: o.pos.out(), uv: o.hasUV ? o.uv.out() : null, normal: o.hasN ? o.nrm.out() : null,
          color: o.col ? o.col.out() : null, index: o.idx.out(), groups });
      }
      // sin caras: nube de puntos con todos los vértices
      const points = !out.length && nv ? { position: V.out(), color: C ? C.out() : null } : null;
      return { objects: out, points, mtllibs, counts: { v: nv, vt: nt, vn: nn, f: faces } };
    }
    return { feed, finish };
  }

  // BVH para el pick: caja por nodo (min xyz, max xyz) y, por nodo, [hijo derecho, 0] o [inicio, cantidad] en tri
  // (los triángulos de la hoja). El hijo izquierdo es el nodo siguiente. Corte al medio del eje más largo de los
  // centros; el índice de la malla no se reordena (los grupos de material siguen sirviendo).
  function buildBvh(P, I, leaf = 8) {
    const n = I.length / 3, tri = new Uint32Array(n), cen = new Float32Array(n * 3);
    for (let t = 0; t < n; t++) {
      tri[t] = t; const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      for (let k = 0; k < 3; k++) cen[t * 3 + k] = (P[a + k] + P[b + k] + P[c + k]) / 3;
    }
    let box = new Float32Array(6 * 1024), node = new Uint32Array(2 * 1024), count = 0;
    function build(lo, hi, depth) {
      const i = count++;
      if (count > node.length / 2) { const nb = new Float32Array(box.length * 2); nb.set(box); box = nb; const nn = new Uint32Array(node.length * 2); nn.set(node); node = nn; }
      if (hi - lo > leaf && depth < 60) {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (let j = lo; j < hi; j++) { const c = tri[j] * 3, x = cen[c], y = cen[c + 1], z = cen[c + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0, ax = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2, ext = [ex, ey, ez][ax];
        if (ext > 0) {
          const mid = [x0, y0, z0][ax] + ext / 2;
          let l = lo, r = hi - 1;
          while (l <= r) { if (cen[tri[l] * 3 + ax] < mid) l++; else { const t = tri[l]; tri[l] = tri[r]; tri[r] = t; r--; } }
          if (l === lo || l === hi) l = (lo + hi) >> 1;
          build(lo, l, depth + 1); const right = build(l, hi, depth + 1);
          node[i * 2] = right; node[i * 2 + 1] = 0;
          for (let k = 0; k < 3; k++) { box[i * 6 + k] = Math.min(box[(i + 1) * 6 + k], box[right * 6 + k]); box[i * 6 + 3 + k] = Math.max(box[(i + 1) * 6 + 3 + k], box[right * 6 + 3 + k]); }
          return i;
        }
      }
      node[i * 2] = lo; node[i * 2 + 1] = hi - lo;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let j = lo; j < hi; j++) for (let v = 0; v < 3; v++) {
        const q = I[tri[j] * 3 + v] * 3, x = P[q], y = P[q + 1], z = P[q + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      box[i * 6] = x0; box[i * 6 + 1] = y0; box[i * 6 + 2] = z0; box[i * 6 + 3] = x1; box[i * 6 + 4] = y1; box[i * 6 + 5] = z1;
      return i;
    }
    if (n) build(0, n, 0);
    return { box: box.slice(0, count * 6), node: node.slice(0, count * 2), tri };
  }

  // Rayo (origen o, dirección d, en el espacio de la malla) contra el BVH: el triángulo más cercano, doble cara
  // (Möller-Trumbore), o null. La usa el pick de js/obj-stream.js; acá para poder probarla en Node.
  function rayHit(P, I, B, ox, oy, oz, dx, dy, dz) {
    const box = B.box, node = B.node, tri = B.tri, ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let best = Infinity, bt = -1;
    const stack = [0];
    while (stack.length) {
      const i = stack.pop(), b = i * 6;
      let t0 = (box[b] - ox) * ix, t1 = (box[b + 3] - ox) * ix; if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
      let u0 = (box[b + 1] - oy) * iy, u1 = (box[b + 4] - oy) * iy; if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
      if (u0 > t0) t0 = u0; if (u1 < t1) t1 = u1;
      let w0 = (box[b + 2] - oz) * iz, w1 = (box[b + 5] - oz) * iz; if (w0 > w1) { const t = w0; w0 = w1; w1 = t; }
      if (w0 > t0) t0 = w0; if (w1 < t1) t1 = w1;
      if (!(t1 >= Math.max(t0, 0)) || t0 > best) continue; // NaN (rayo justo sobre una cara de la caja) también descarta
      const cnt = node[i * 2 + 1];
      if (!cnt) { stack.push(node[i * 2], i + 1); continue; }
      for (let j = node[i * 2], e = j + cnt; j < e; j++) {
        const t = tri[j], a = I[t * 3] * 3, q = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const e1x = P[q] - P[a], e1y = P[q + 1] - P[a + 1], e1z = P[q + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det, sx = ox - P[a], sy = oy - P[a + 1], sz = oz - P[a + 2], u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > 0 && tt < best) { best = tt; bt = t; }
      }
    }
    return bt < 0 ? null : { t: best, tri: bt };
  }

  // Lee el File en pedazos; lo que queda después del último '\n' pasa al pedazo siguiente
  async function parseFile(file, onProgress, chunk = 32 << 20) {
    const ps = createParser();
    let carry = new Uint8Array(0);
    for (let off = 0; off < file.size; off += chunk) {
      const piece = new Uint8Array(await file.slice(off, Math.min(file.size, off + chunk)).arrayBuffer());
      const last = off + chunk >= file.size;
      let buf = piece;
      if (carry.length) { buf = new Uint8Array(carry.length + piece.length); buf.set(carry); buf.set(piece, carry.length); }
      if (last) { const z = new Uint8Array(buf.length + 1); z.set(buf); z[buf.length] = 10; ps.feed(z, 0, z.length); carry = new Uint8Array(0); }
      else {
        let e = buf.lastIndexOf(10) + 1;
        ps.feed(buf, 0, e); carry = buf.slice(e);
      }
      if (onProgress) onProgress(Math.min(file.size, off + chunk), file.size);
    }
    return ps.finish();
  }

  const api = { createParser, buildBvh, rayHit, parseFile };
  globalThis.ObjStream = api;

  if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
    onmessage = async (e) => {
      const { file } = e.data;
      try {
        const t0 = performance.now();
        const r = await parseFile(file, (done, total) => postMessage({ type: 'progress', done, total }));
        const t1 = performance.now();
        postMessage({ type: 'phase', text: 'Building the pick index' });
        const transfer = [];
        for (const o of r.objects) {
          o.bvh = buildBvh(o.position, o.index);
          for (const a of [o.position, o.uv, o.normal, o.color, o.index, o.bvh.box, o.bvh.node, o.bvh.tri]) if (a) transfer.push(a.buffer);
        }
        if (r.points) for (const a of [r.points.position, r.points.color]) if (a) transfer.push(a.buffer);
        r.ms = { parse: Math.round(t1 - t0), bvh: Math.round(performance.now() - t1) };
        postMessage({ type: 'done', result: r }, transfer);
      } catch (err) { postMessage({ type: 'error', message: err.message || String(err) }); }
    };
  }
})();
