// drive-math: reproyección de un driving plate a la cámara de la toma (sin DOM ni THREE: lo usan la
// página y los tests de Node). Para lo lejano, cambiar de cámara sin mover el centro es una
// homografía de rotación:  shot <- drive = K_s · R_sᵀ · R_d · K_d⁻¹  (R = cámara -> mundo).
// Mismas convenciones que SceneMath (js/scene-math.js): intr = { focalMm, filmWidthMm, squeeze,
// plateW, plateH }, pose = { tiltDeg, rollDeg, yawDeg, heightM }, px con y hacia abajo, cámara
// mirando a -Z con Y arriba, R = Ry(yaw) Rx(tilt) Rz(roll). Matrices 3x3 como [[a,b,c],[d,e,f],[g,h,i]].
var DriveMath = (() => {
  const DEG = Math.PI / 180;
  const mul = (a, b) => a.map(r => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
  const T = (a) => [0, 1, 2].map(i => [a[0][i], a[1][i], a[2][i]]);
  function inv(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-300) return null;
    return [[A / det, (c * h - b * i) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
      [C / det, (b * g - a * h) / det, (a * e - b * d) / det]];
  }
  const rotX = (t) => { const c = Math.cos(t), s = Math.sin(t); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
  const rotY = (t) => { const c = Math.cos(t), s = Math.sin(t); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
  const rotZ = (t) => { const c = Math.cos(t), s = Math.sin(t); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };

  const fpx = (i) => i.focalMm * i.plateW / i.filmWidthMm; // focal en px horizontales del plate
  // c (ejes de cámara) -> px homogéneo; w = -z es la profundidad (w <= 0: detrás de la cámara)
  function K(i) { const f = fpx(i), sq = i.squeeze > 0 ? i.squeeze : 1; return [[f / sq, 0, -i.plateW / 2], [0, -f, -i.plateH / 2], [0, 0, -1]]; }
  const R = (p) => mul(rotY(p.yawDeg * DEG), mul(rotX(p.tiltDeg * DEG), rotZ(p.rollDeg * DEG)));
  const valid = (i) => i && i.focalMm > 0 && i.filmWidthMm > 0 && i.plateW > 0 && i.plateH > 0;

  // sd: px de la toma -> px del driving (para leer la textura); ds: al revés (esquinas del CornerPin)
  function homography(intrS, poseS, intrD, poseD) {
    if (!valid(intrS) || !valid(intrD)) return null;
    const ds = mul(K(intrS), mul(T(R(poseS)), mul(R(poseD), inv(K(intrD)))));
    const sd = inv(ds);
    return sd ? { sd, ds } : null;
  }
  // null si el punto cae detrás de la cámara de destino
  function apply(h, p) {
    const x = h[0][0] * p[0] + h[0][1] * p[1] + h[0][2], y = h[1][0] * p[0] + h[1][1] * p[1] + h[1][2], w = h[2][0] * p[0] + h[2][1] * p[1] + h[2][2];
    return w > 1e-12 ? [x / w, y / w] : null;
  }
  // px del driving por px de la toma alrededor de p (raíz del determinante del jacobiano: escala de área)
  function scaleAt(sd, p) {
    const e = 0.5, a = apply(sd, [p[0] - e, p[1]]), b = apply(sd, [p[0] + e, p[1]]), c = apply(sd, [p[0], p[1] - e]), d = apply(sd, [p[0], p[1] + e]);
    if (!a || !b || !c || !d) return NaN;
    const jx = [(b[0] - a[0]) / (2 * e), (b[1] - a[1]) / (2 * e)], jy = [(d[0] - c[0]) / (2 * e), (d[1] - c[1]) / (2 * e)];
    return Math.sqrt(Math.abs(jx[0] * jy[1] - jx[1] * jy[0]));
  }
  // fracción de la toma que cae dentro del driving plate (muestreo en grilla de n columnas)
  function coverage(sd, intrS, intrD, n = 48) {
    const W = intrS.plateW, H = intrS.plateH, m = Math.max(2, Math.round(n * H / W));
    let inside = 0;
    for (let j = 0; j < m; j++) for (let k = 0; k < n; k++) {
      const q = apply(sd, [(k + 0.5) * W / n, (j + 0.5) * H / m]);
      if (q && q[0] >= 0 && q[0] <= intrD.plateW && q[1] >= 0 && q[1] <= intrD.plateH) inside++;
    }
    return inside / (n * m);
  }
  // fila del horizonte en la columna del centro (px desde arriba); null si la cámara no lo ve
  function horizonY(intr, pose) {
    const r = R(pose), up = [r[1][0], r[1][1], r[1][2]]; // Y del mundo en ejes de cámara (fila 1 de R)
    if (Math.abs(up[1]) < 1e-9) return null;
    // rayo del centro de columna: (0, v, -1) con v = (H/2 - y)/f ; horizontal si up·rayo = 0
    const v = up[2] / up[1];
    return intr.plateH / 2 - v * fpx(intr);
  }

  // el horizonte de una cámara en su imagen: la recta [a, b, c] (a·x + b·y + c = 0, px con y hacia abajo) donde caen
  // las direcciones horizontales del mundo: l = K⁻ᵀ · (Y del mundo en ejes de cámara)
  function horizonLine(intr, pose) {
    if (!valid(intr)) return null;
    const r = R(pose), up = [r[1][0], r[1][1], r[1][2]], Ki = inv(K(intr)); if (!Ki) return null;
    return [0, 1, 2].map(j => Ki[0][j] * up[0] + Ki[1][j] * up[1] + Ki[2][j] * up[2]);
  }
  // una recta llevada por una homografía de puntos h (p' = h·p): l' = h⁻ᵀ·l
  function mapLine(h, l) {
    const hi = h && l && inv(h); if (!hi) return null;
    return [0, 1, 2].map(j => hi[0][j] * l[0] + hi[1][j] * l[1] + hi[2][j] * l[2]);
  }

  function analyze(intrS, poseS, intrD, poseD) {
    const h = homography(intrS, poseS, intrD, poseD); if (!h) return null;
    const W = intrS.plateW, H = intrS.plateH, Wd = intrD.plateW, Hd = intrD.plateH;
    const inD = (q) => q && q[0] >= 0 && q[0] <= Wd && q[1] >= 0 && q[1] <= Hd;
    const c = [W / 2, H / 2], cq = apply(h.sd, c);
    const scale = scaleAt(h.sd, c);
    let worst = inD(cq) ? 1 / scale : NaN;
    // grilla 13 x 9 (incluye centro, esquinas y medios): un tele corrido cubre una franja que esos 9 no tocan
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 8; j++) {
      const p = [i / 12 * W, j / 8 * H], q = apply(h.sd, p);
      if (inD(q)) { const u = 1 / scaleAt(h.sd, p); if (!(u <= worst)) worst = u; }
    }
    const corners = [[0, 0], [Wd, 0], [Wd, Hd], [0, Hd]].map(p => apply(h.ds, p));
    return {
      ...h, scale, upscale: 1 / scale, worstUpscale: worst, centerIn: inD(cq),
      coverage: coverage(h.sd, intrS, intrD), corners,
      horizonShot: horizonY(intrS, poseS), horizonDrive: horizonY(intrD, poseD),
      dh: poseS.heightM - poseD.heightM, fpxShot: fpx(intrS),
    };
  }
  // homografía que lleva los 4 puntos a[i] a b[i] (como un CornerPin2D: from -> to), por eliminación de Gauss
  // con h22 = 1. null si tres puntos están alineados.
  function quad(a, b) {
    const M = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = a[i], [u, v] = b[i];
      M.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 8; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 9; k++) M[r][k] -= f * M[c][k]; }
    }
    const h = M.map((r, i) => r[8] / r[i]);
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  }
  // correr el lado i (de la esquina i a la i+1; esquinas arriba-izq, arriba-der, abajo-der, abajo-izq) de un cuadrilátero
  // P para que pase por q, manteniendo la perspectiva: el lado nuevo apunta al mismo punto de fuga que el lado y su
  // opuesto (paralelo si lo son) y sus esquinas corren sobre los dos lados vecinos. null si queda degenerado.
  function edgeMove(P, i, q) {
    const hx = (p) => [p[0], p[1], 1], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const A = P[i], B = P[(i + 1) % 4], C = P[(i + 2) % 4], D = P[(i + 3) % 4];
    const vp = cr(cr(hx(A), hx(B)), cr(hx(D), hx(C))); // punto de fuga del lado y su opuesto (w = 0: paralelos)
    const edge = cr(hx(q), Math.hypot(vp[0], vp[1], vp[2]) < 1e-12 ? [B[0] - A[0], B[1] - A[1], 0] : vp);
    const pt = (l) => { const x = cr(edge, l); return Math.abs(x[2]) < 1e-12 ? null : [x[0] / x[2], x[1] / x[2]]; };
    const a = pt(cr(hx(A), hx(D))), b = pt(cr(hx(B), hx(C)));
    return a && b ? [a, b] : null;
  }
  // desplazamiento vertical en px de la toma de un objeto a distM por la diferencia de altura dh
  const parallaxPx = (fpxShot, dh, distM) => fpxShot * Math.abs(dh) / distM;

  // cobertura de un conjunto de px de la toma (las ventanillas: el área keyeada) y el peor upscale ahí
  function windowStats(sd, pts, intrD) {
    let inside = 0, worst = NaN;
    for (const p of pts) {
      const q = apply(sd, p);
      if (!q || q[0] < 0 || q[1] < 0 || q[0] > intrD.plateW || q[1] > intrD.plateH) continue;
      inside++;
      // un punto de cada 4 alcanza para el peor upscale (el jacobiano cambia suave)
      if (inside % 4 === 1) { const u = 1 / scaleAt(sd, p); if (!(u <= worst)) worst = u; }
    }
    return { coverage: pts.length ? inside / pts.length : 0, worst };
  }

  // autovector del menor autovalor de una matriz simétrica 3x3 (Jacobi)
  function minEigvec(A) {
    const a = A.map(r => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 60; sweep++) {
      const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]), diag = Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]);
      if (off <= 1e-15 * diag || off < 1e-300) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
        for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
        for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
      }
    }
    let i = 0; for (let k = 1; k < 3; k++) if (a[k][k] < a[i][i]) i = k;
    return [V[0][i], V[1][i], V[2][i]];
  }
  // Punto de fuga de N segmentos [x1,y1,x2,y2] (px) por mínimos cuadrados: minimiza la distancia en px de las
  // puntas de cada segmento a la recta que va de su medio al punto (un segmento largo pesa más). Con dos
  // líneas da su cruce exacto. Homogéneo: un punto en el infinito (líneas paralelas) también se resuelve.
  // Devuelve { vp: [x, y] o null si queda en el infinito, h: [X, Y, W] en px, res: px por línea, rms, worst, worstIdx }.
  function fitVP(segs) {
    const n = segs ? segs.length : 0; if (n < 2) return null;
    let cx = 0, cy = 0, s = 0;
    for (const l of segs) { cx += l[0] + l[2]; cy += l[1] + l[3]; }
    cx /= 2 * n; cy /= 2 * n;
    for (const l of segs) s += Math.hypot(l[0] - cx, l[1] - cy) + Math.hypot(l[2] - cx, l[3] - cy);
    s = s / (2 * n) || 1; // coordenadas condicionadas: centro y escala de las puntas
    const L = [];
    for (const l of segs) {
      const a = [(l[0] - cx) / s, (l[1] - cy) / s, 1], b = [(l[2] - cx) / s, (l[3] - cy) / s, 1];
      const h = [a[1] - b[1], b[0] - a[0], a[0] * b[1] - a[1] * b[0]], k = Math.hypot(h[0], h[1]);
      if (!(k > 1e-12)) return null; // segmento de largo cero
      L.push({ h: h.map(x => x / k), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len: k });
    }
    // pesos: residuo de la punta = (largo / 2) · seno del ángulo = largo · dist(VP, recta) / dist(VP, medio)
    let w = L.map(x => x.len), v = null;
    for (let it = 0; it < 8; it++) {
      const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      L.forEach((x, i) => { for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r][c] += w[i] * x.h[r] * x.h[c]; });
      v = minEigvec(M);
      w = L.map(x => { const d2 = (x.m[0] * v[2] - v[0]) ** 2 + (x.m[1] * v[2] - v[1]) ** 2; return x.len * x.len / Math.max(d2, 1e-18); });
    }
    const H = [v[0] * s + cx * v[2], v[1] * s + cy * v[2], v[2]]; // a px
    const far = Math.abs(H[2]) * 5000 * s < Math.hypot(H[0], H[1]); // más de ~5000 veces el tamaño de las líneas
    const vp = far ? null : [H[0] / H[2], H[1] / H[2]];
    const res = segs.map(l => {
      const m = [(l[0] + l[2]) / 2, (l[1] + l[3]) / 2];
      let dx = H[0] - m[0] * H[2], dy = H[1] - m[1] * H[2]; const k = Math.hypot(dx, dy);
      if (!(k > 0)) return 0;
      dx /= k; dy /= k;
      return Math.abs(dx * (l[3] - m[1]) - dy * (l[2] - m[0]));
    });
    let worstIdx = 0; res.forEach((r, i) => { if (r > res[worstIdx]) worstIdx = i; });
    const rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / n);
    return { vp, h: H, res, rms, worst: res[worstIdx], worstIdx };
  }

  // Cámara del driving medida en su propia imagen (los driving reales llegan sin metadata). Usa el solver
  // de la escena (SceneMath, js/scene-math.js): la calle es el "eje del auto" del auto de cámara.
  // lines: { street: [segmentos a lo largo de la calle], cross: [a lo ancho] } en px del driving, 2 o más
  // por dirección (el punto de fuga sale de fitVP); también el formato viejo [calle, calle, transv., transv.].
  // o = { twoVP, fixedFocalMm }. 1 VP: tilt y yaw con la focal; el yaw opuesto da el mismo punto: queda el
  // lado de pose.yawDeg (Looks to). 2 VP: además roll y, sin fixedFocalMm, la focal. De costado (el VP de la
  // calle a más de SIDE° del eje) las líneas casi no se cortan: sólo dan el roll; el tilt sale del horizonte.
  const SIDE = 70;
  function measure(intr, pose, lines, o = {}) {
    const g = Array.isArray(lines) ? { street: lines.slice(0, 2), cross: lines.slice(2, 4) } : lines;
    const out = { ok: false, error: '', mode: '', pose: { ...pose }, focalMm: intr.focalMm, vp: null, vpX: null, fit: null, fitX: null };
    const SM = globalThis.SceneMath, fz = fitVP(g.street), vpZ = fz && fz.vp; out.vp = vpZ; out.fit = fz;
    if (o.twoVP) {
      const fx = fitVP(g.cross), vpX = fx && fx.vp; out.vpX = vpX; out.fitX = fx; out.mode = '2vp';
      if (!vpZ) { out.error = 'The street lines are parallel: put them on two edges that meet far away'; return out; }
      if (!vpX) { out.error = 'The cross lines are parallel: they need a vanishing point'; return out; }
      const s = SM.solveTwoVP(intr, pose, vpZ, vpX, o.fixedFocalMm || 0);
      return { ...out, ok: s.ok, error: s.error, pose: { ...pose, ...s.pose }, focalMm: s.ok ? s.focalMm : intr.focalMm };
    }
    const off = vpZ && valid(intr) ? (() => { const f = fpx(intr), sq = intr.squeeze > 0 ? intr.squeeze : 1, x = (vpZ[0] - intr.plateW / 2) * sq, y = vpZ[1] - intr.plateH / 2; return Math.atan(Math.hypot(x, y) / f) / DEG; })() : 90;
    if (off < SIDE) {
      const s = SM.solveOneVP(intr, pose, vpZ, false); out.mode = '1vp';
      return { ...out, ok: s.ok, error: s.error, pose: { ...pose, ...s.pose } };
    }
    // de costado: las líneas de la calle corren paralelas al horizonte; su ángulo es el roll
    out.mode = 'side';
    const ang = (l) => { let a = Math.atan2(l[3] - l[1], l[2] - l[0]); if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI; return a; };
    const len = (l) => Math.hypot(l[2] - l[0], l[3] - l[1]), sl = g.street.reduce((s, l) => s + len(l), 0);
    const a = g.street.reduce((s, l) => s + ang(l) * len(l), 0) / (sl || 1) / DEG; // promedio por largo
    // signo del roll en la imagen, medido con la misma cámara (no se adivina la convención)
    const hz = (r) => { const h = SM.camera(intr, { ...pose, rollDeg: r, xM: 0, zM: 0 }).horizon(); return h ? Math.atan2(h[3] - h[1], h[2] - h[0]) / DEG : 0; };
    const k = hz(1) - hz(0);
    if (!valid(intr) || Math.abs(k) < 1e-6) { out.error = 'Camera data is missing (focal or film width)'; return out; }
    out.pose.rollDeg = a / k;
    out.ok = true;
    return out;
  }
  // tilt con el que el horizonte del driving pasa por ese px (arrastre del horizonte)
  const tiltThrough = (intr, pose, px) => globalThis.SceneMath.tiltForHorizonThrough(intr, { ...pose, xM: 0, zM: 0 }, px);

  // ---------- Array de cámaras ----------
  // qué tan adentro del driving cae un px de la toma: distancia al borde más cercano, en fracción del cuadro
  // (0 en el borde, 0.5 en el centro); -1 si no cae. La cámara con más margen es la que mejor lo cubre; el
  // shader de js/drive-plate.js mezcla con un borde suave alrededor de donde dos márgenes se igualan.
  function edgeDepth(sd, intrD, p) {
    const q = apply(sd, p); if (!q) return -1;
    const u = q[0] / intrD.plateW, v = q[1] / intrD.plateH;
    return u < 0 || v < 0 || u > 1 || v > 1 ? -1 : Math.min(u, 1 - u, v, 1 - v);
  }
  // cams: [{ sd, intr }]; para cada px de pts, el índice de la cámara que mejor lo cubre (-1: ninguna)
  function owners(cams, pts) {
    return pts.map(p => { let best = -1, e = -1; cams.forEach((c, i) => { const d = c ? edgeDepth(c.sd, c.intr, p) : -1; if (d > e + 1e-9) { e = d; best = i; } }); return best; });
  }
  // tilt / roll por cuadro leídos de los headers de una secuencia EXR: track = { first, tilt: [], roll: [] }
  // (null donde falta un cuadro). Fuera del rango queda el extremo; un hueco toma el cuadro más cercano.
  function trackAt(track, frame) {
    const n = track && track.tilt ? track.tilt.length : 0; if (!n) return null;
    const i0 = Math.min(n - 1, Math.max(0, Math.round(frame - track.first)));
    for (let d = 0; d < n; d++) for (const i of [i0 - d, i0 + d]) if (i >= 0 && i < n && track.tilt[i] != null) return { tilt: track.tilt[i], roll: track.roll[i] ?? 0, frame: track.first + i };
    return null;
  }

  // Cámara del driving medida en varios cuadros (keyframes de Measure drive camera): keys = [{ frame, tiltDeg,
  // rollDeg, yawDeg }] con frame = índice del cuadro del driving (desde 0). Entre dos keys, lineal; el yaw por el
  // lado corto (de 179° a -179° pasa por 180°); antes de la primera y después de la última, la del extremo.
  const wrap = (a) => ((a + 180) % 360 + 360) % 360 - 180;
  function keysAt(keys, frame) {
    const k = (keys || []).filter(x => x && Number.isFinite(x.frame)).slice().sort((p, q) => p.frame - q.frame);
    if (!k.length) return null;
    const pick = (x) => ({ tiltDeg: x.tiltDeg, rollDeg: x.rollDeg, yawDeg: x.yawDeg, frame: x.frame, key: true });
    if (frame <= k[0].frame) return pick(k[0]);
    if (frame >= k[k.length - 1].frame) return pick(k[k.length - 1]);
    let i = 0; while (k[i + 1].frame < frame) i++;
    const A = k[i], B = k[i + 1], t = (frame - A.frame) / (B.frame - A.frame);
    if (t === 0) return pick(A);
    return { tiltDeg: A.tiltDeg + (B.tiltDeg - A.tiltDeg) * t, rollDeg: A.rollDeg + (B.rollDeg - A.rollDeg) * t,
      yawDeg: (() => { const y = A.yawDeg + wrap(B.yawDeg - A.yawDeg) * t; return y > 180 ? y - 360 : y < -180 ? y + 360 : y; })(), frame, key: false, between: [A.frame, B.frame] };
  }

  // Reformat al formato de la toma + CornerPin2D (from = esquinas del driving, to = reproyectadas).
  // Nuke mide desde abajo a la izquierda con y hacia arriba; esquinas 1..4 = abajo-izq, abajo-der,
  // arriba-der, arriba-izq. to = esquinas del driving en px de la toma (y abajo) en el orden
  // [arriba-izq, arriba-der, abajo-der, abajo-izq], como las devuelve analyze().corners.
  // Con o.anim = { first, to: [to de cada cuadro] } (cámara que cambia por cuadro) cada to va animado: una curva
  // por coordenada desde el cuadro first, un valor por cuadro.
  function cornerPinText(o) {
    const n = (v) => String(+v.toFixed(3));
    const lab = String(o.label || '').replace(/[\\"[\]${}]/g, '_').replace(/\n/g, '\\n');
    const fy = (p) => [p[0], o.shotH - p[1]];
    const order = (c) => [c[3], c[2], c[1], c[0]].map(fy);
    const to = o.anim ? null : order(o.to), seq = o.anim ? o.anim.to.map(order) : null;
    const toLine = (i) => seq
      ? ` to${i + 1} {{curve x${o.anim.first} ${seq.map(c => n(c[i][0])).join(' ')}} {curve x${o.anim.first} ${seq.map(c => n(c[i][1])).join(' ')}}}\n`
      : ` to${i + 1} {${n(to[i][0])} ${n(to[i][1])}}\n`;
    const from = [[0, 0], [o.drvW, 0], [o.drvW, o.drvH], [0, o.drvH]];
    const pa = o.shotPar > 0 ? o.shotPar : 1, sfx = String(o.suffix || '').replace(/\W/g, '');
    return 'set cut_paste_input [stack 0]\nversion 14.0 v1\npush $cut_paste_input\nReformat {\n' +
      ` format "${o.shotW} ${o.shotH} 0 0 ${o.shotW} ${o.shotH} ${n(pa)} BackplateLab_shot_${o.shotW}x${o.shotH}"\n` +
      ` resize none\n center false\n black_outside true\n name Reformat_DrivePlate${sfx}\n selected true\n}\nCornerPin2D {\n` +
      [0, 1, 2, 3].map(toLine).join('') +
      from.map((p, i) => ` from${i + 1} {${n(p[0])} ${n(p[1])}}\n`).join('') +
      ` name CornerPin_DrivePlate${sfx}\n label "${lab}"\n selected true\n}\n`;
  }

  return { K, R, mul, inv, fpx, homography, apply, quad, edgeMove, scaleAt, coverage, horizonY, horizonLine, mapLine, analyze, parallaxPx, cornerPinText, windowStats, measure, tiltThrough, SIDE, fitVP, edgeDepth, owners, trackAt, keysAt };
})();
globalThis.DriveMath = DriveMath; // en Node (tests) el archivo se importa como módulo
