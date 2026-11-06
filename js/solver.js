// Camera Pin solver: pose from 2D-3D pins with known intrinsics.
// Camera model: Xc = R (Xw - C), u = fx*Xc.x/Xc.z + cx, v = fy*Xc.y/Xc.z + cy (OpenCV: x right, y down, z forward)
const Solver = (() => {
  function rodrigues(w) {
    const th = Math.hypot(w[0], w[1], w[2]);
    if (th < 1e-12) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1];
    const x = w[0] / th, y = w[1] / th, z = w[2] / th, c = Math.cos(th), s = Math.sin(th), v = 1 - c;
    return [c + x * x * v, x * y * v - z * s, x * z * v + y * s,
            y * x * v + z * s, c + y * y * v, y * z * v - x * s,
            z * x * v - y * s, z * y * v + x * s, c + z * z * v];
  }
  function mul3(A, B) {
    const R = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return R;
  }
  function orthonormalize(R) {
    let a = [R[0], R[1], R[2]], b = [R[3], R[4], R[5]];
    const na = Math.hypot(...a); a = a.map(x => x / na);
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    b = [b[0] - d * a[0], b[1] - d * a[1], b[2] - d * a[2]];
    const nb = Math.hypot(...b); b = b.map(x => x / nb);
    const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    return [...a, ...b, ...c];
  }
  function project(R, C, K, f, P) {
    const dx = P[0] - C[0], dy = P[1] - C[1], dz = P[2] - C[2];
    const x = R[0] * dx + R[1] * dy + R[2] * dz;
    const y = R[3] * dx + R[4] * dy + R[5] * dz;
    const z = R[6] * dx + R[7] * dy + R[8] * dz;
    const fx = K.fx * f, fy = K.fy * f;
    return [fx * x / z + K.cx, fy * y / z + K.cy, z];
  }
  function residuals(R, C, K, f, pins, out) {
    let k = 0;
    for (const p of pins) {
      const q = project(R, C, K, f, p.X);
      if (!(q[2] > 1e-6)) { out[k++] = 1e4; out[k++] = 1e4; continue; }
      out[k++] = q[0] - p.uv[0];
      out[k++] = q[1] - p.uv[1];
    }
    return out;
  }
  function sumsq(r) { let s = 0; for (const v of r) s += v * v; return s; }
  function solveLinear(A, b, n) {
    const M = A.slice(), x = b.slice();
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[piv * n + c])) piv = r;
      if (Math.abs(M[piv * n + c]) < 1e-18) return null;
      if (piv !== c) {
        for (let k = 0; k < n; k++) { const t = M[c * n + k]; M[c * n + k] = M[piv * n + k]; M[piv * n + k] = t; }
        const t = x[c]; x[c] = x[piv]; x[piv] = t;
      }
      for (let r = c + 1; r < n; r++) {
        const f = M[r * n + c] / M[c * n + c];
        if (!f) continue;
        for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
        x[r] -= f * x[c];
      }
    }
    for (let r = n - 1; r >= 0; r--) {
      let s = x[r];
      for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
      x[r] = s / M[r * n + r];
    }
    return x;
  }

  // Levenberg-Marquardt on (rotation, camera center, optional focal scale)
  // mode: 'rot' keeps C fixed, 'full' solves both. Returns new pose + rms.
  function refine(pose, K, pins, opt = {}) {
    const mode = opt.mode || 'full', freeF = !!opt.freeFocal, iters = opt.iters || 30;
    const sc = opt.sceneScale || 1, lockTR = !!opt.lockTR;
    const rc = lockTR ? 1 : 3; // rotation params: yaw only (about world up) or full
    const n = rc + (mode === 'rot' ? 0 : 3) + (freeF ? 1 : 0);
    let R = pose.R.slice(), C = pose.C.slice(), f = pose.f || 1;
    const m = pins.length * 2;
    if (!m) return { R, C, f, rms: 0 };
    const apply = (p) => {
      const R2 = lockTR ? orthonormalize(mul3(R, rodrigues([0, p[0], 0]))) : orthonormalize(mul3(rodrigues([p[0], p[1], p[2]]), R));
      const C2 = mode === 'rot' ? C : [C[0] + p[rc] * sc, C[1] + p[rc + 1] * sc, C[2] + p[rc + 2] * sc];
      const f2 = freeF ? f * Math.exp(p[n - 1]) : f;
      return [R2, C2, f2];
    };
    let r0 = residuals(R, C, K, f, pins, new Array(m));
    let cost = sumsq(r0), lambda = 1e-3;
    const J = new Array(m * n), rp = new Array(m), eps = 1e-6;
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < n; j++) {
        const p = new Array(n).fill(0); p[j] = eps;
        const [R2, C2, f2] = apply(p);
        residuals(R2, C2, K, f2, pins, rp);
        for (let i = 0; i < m; i++) J[i * n + j] = (rp[i] - r0[i]) / eps;
      }
      const H = new Array(n * n).fill(0), g = new Array(n).fill(0);
      for (let i = 0; i < m; i++) for (let a = 0; a < n; a++) {
        const Jia = J[i * n + a];
        g[a] += Jia * r0[i];
        for (let b = 0; b < n; b++) H[a * n + b] += Jia * J[i * n + b];
      }
      let improved = false;
      for (let tries = 0; tries < 10; tries++) {
        const A = H.slice();
        for (let a = 0; a < n; a++) A[a * n + a] += lambda * (H[a * n + a] + 1e-9);
        const d = solveLinear(A, g.map(v => -v), n);
        if (!d) { lambda *= 10; continue; }
        const [R2, C2, f2] = apply(d);
        const r2 = residuals(R2, C2, K, f2, pins, new Array(m));
        const c2 = sumsq(r2);
        if (c2 < cost) {
          R = R2; C = C2; f = f2; r0 = r2;
          const rel = (cost - c2) / (cost + 1e-12);
          cost = c2; lambda = Math.max(lambda / 4, 1e-9); improved = true;
          if (rel < 1e-10) it = iters;
          break;
        }
        lambda *= 6;
      }
      if (!improved || cost < 1e-12) break;
    }
    return { R, C, f, rms: Math.sqrt(cost / pins.length) };
  }

  // Symmetric Jacobi eigen decomposition. A: flat n*n. Returns {vals, vecs} with vecs columns.
  function jacobiEig(A, n) {
    const a = A.slice(), V = new Array(n * n).fill(0);
    for (let i = 0; i < n; i++) V[i * n + i] = 1;
    for (let sweep = 0; sweep < 80; sweep++) {
      let off = 0, diag = 0;
      for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) {
        if (p !== q) off += a[p * n + q] ** 2; else diag += a[p * n + q] ** 2;
      }
      if (off <= 1e-26 * (diag + 1e-300)) break;
      for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p], akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq; a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k], aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk; a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
    const vals = []; for (let i = 0; i < n; i++) vals.push(a[i * n + i]);
    return { vals, vecs: V };
  }

  // DLT with known intrinsics (needs >= 6 non-coplanar pins). Returns {R, C} or null.
  function dlt(K, f, pins) {
    const N = pins.length;
    if (N < 6) return null;
    const c = [0, 0, 0];
    for (const p of pins) for (let i = 0; i < 3; i++) c[i] += p.X[i] / N;
    let s = 0;
    for (const p of pins) s += Math.hypot(p.X[0] - c[0], p.X[1] - c[1], p.X[2] - c[2]) / N;
    s = s || 1;
    const AtA = new Array(144).fill(0);
    const fx = K.fx * f, fy = K.fy * f;
    for (const p of pins) {
      const X = [(p.X[0] - c[0]) / s, (p.X[1] - c[1]) / s, (p.X[2] - c[2]) / s, 1];
      const x = (p.uv[0] - K.cx) / fx, y = (p.uv[1] - K.cy) / fy;
      const r1 = new Array(12).fill(0), r2 = new Array(12).fill(0);
      for (let k = 0; k < 4; k++) {
        r1[k] = X[k]; r1[8 + k] = -x * X[k];
        r2[4 + k] = X[k]; r2[8 + k] = -y * X[k];
      }
      for (const r of [r1, r2]) for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) AtA[i * 12 + j] += r[i] * r[j];
    }
    const { vals, vecs } = jacobiEig(AtA, 12);
    let mi = 0; for (let i = 1; i < 12; i++) if (vals[i] < vals[mi]) mi = i;
    let P = []; for (let i = 0; i < 12; i++) P.push(vecs[i * 12 + mi]);
    let M = [P[0], P[1], P[2], P[4], P[5], P[6], P[8], P[9], P[10]];
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    if (det < 0) { P = P.map(v => -v); M = M.map(v => -v); }
    // polar decomposition M = R S
    const MtM = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) MtM[i * 3 + j] += M[k * 3 + i] * M[k * 3 + j];
    const e = jacobiEig(MtM, 3);
    const sig = e.vals.map(v => Math.sqrt(Math.max(v, 1e-30)));
    // (MtM)^(-1/2) = V diag(1/sig) V^T
    const inv = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++)
      inv[i * 3 + j] += e.vecs[i * 3 + k] * e.vecs[j * 3 + k] / sig[k];
    let R = mul3(M, inv);
    R = orthonormalize(R);
    const scale = (sig[0] + sig[1] + sig[2]) / 3;
    const tn = [P[3] / scale, P[7] / scale, P[11] / scale];
    // In normalized space: Xc = R Xn + tn; Xn = (X - c)/s -> Xc*s = R (X - c) + s*tn
    // camera center in world: X such that Xc=0 -> X = c - s * R^T tn
    const Cw = [0, 0, 0];
    for (let i = 0; i < 3; i++) Cw[i] = c[i] - s * (R[i] * tn[0] + R[3 + i] * tn[1] + R[6 + i] * tn[2]);
    // cheirality check
    let front = 0;
    for (const p of pins) {
      const q = project(R, Cw, K, f, p.X);
      if (q[2] > 0) front++;
    }
    if (front < N / 2) return null;
    return { R, C: Cw };
  }

  function rmsOf(pose, K, pins) {
    if (!pins.length) return 0;
    const r = residuals(pose.R, pose.C, K, pose.f || 1, pins, new Array(pins.length * 2));
    return Math.sqrt(sumsq(r) / pins.length);
  }
  function errorsOf(pose, K, pins) {
    return pins.map(p => {
      const q = project(pose.R, pose.C, K, pose.f || 1, p.X);
      if (!(q[2] > 0)) return Infinity;
      return Math.hypot(q[0] - p.uv[0], q[1] - p.uv[1]);
    });
  }
  return { refine, dlt, project, rodrigues, mul3, rmsOf, errorsOf, orthonormalize };
})();


