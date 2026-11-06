// scene-math: cámara virtual Car GS, puntos de fuga y bordes de ventanas. Port de
// src/core/SceneCamera.*, VanishingSolver.* y WindowEdges.* de DepthLab (sin DOM ni THREE: lo
// usan la página, el worker de Auto from windows y los tests de Node).
// Mundo en metros: Y arriba, piso y = 0, eje del auto Z con el frente mirando a -Z (lo mismo que
// los autos de environment.js). Rotación R = Ry(yaw) Rx(tilt) Rz(roll), que es el Euler 'YXZ' de
// three.js con el que la app de Javi lee tilt / yaw / roll (camAngles).
// intr = { focalMm, filmWidthMm, squeeze, plateW, plateH }; el squeeze es el pixel aspect de la app.
// pose = { tiltDeg, rollDeg, yawDeg, heightM, xM, zM }. Puntos del plate [x, y] en px, líneas
// [x1, y1, x2, y2], vectores 3D [x, y, z].
var SceneMath = (() => {
  const DEG = Math.PI / 180, NEAR = 0.05;
  const mul = (a, b) => a.map((r, i) => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
  const rotX = (t) => { const c = Math.cos(t), s = Math.sin(t); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
  const rotY = (t) => { const c = Math.cos(t), s = Math.sin(t); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
  const rotZ = (t) => { const c = Math.cos(t), s = Math.sin(t); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? v.map(x => x / l) : v; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len2 = (l) => Math.hypot(l[2] - l[0], l[3] - l[1]);
  const pointAt = (l, t) => [l[0] + (l[2] - l[0]) * t, l[1] + (l[3] - l[1]) * t];
  // diferencia angular en (-180, 180]
  const angleDelta = (a, b) => { let d = (a - b) % 360; if (d > 180) d -= 360; else if (d <= -180) d += 360; return d; };
  const wrapDeg = (a) => angleDelta(a, 0);

  function camera(intr, pose) {
    const sq = intr.squeeze > 0 ? intr.squeeze : 1, f = intr.focalMm, W = intr.plateW, H = intr.plateH;
    const k = intr.filmWidthMm > 0 ? W / intr.filmWidthMm : 1;
    const R = mul(rotY(pose.yawDeg * DEG), mul(rotX(pose.tiltDeg * DEG), rotZ(pose.rollDeg * DEG))); // cámara -> mundo
    const pos = [pose.xM || 0, pose.heightM, pose.zM || 0];
    const toCamDir = (d) => [0, 1, 2].map(j => R[0][j] * d[0] + R[1][j] * d[1] + R[2][j] * d[2]);
    const toWorldDir = (d) => R.map(r => r[0] * d[0] + r[1] * d[1] + r[2] * d[2]);
    const toCam = (w) => toCamDir([w[0] - pos[0], w[1] - pos[1], w[2] - pos[2]]);
    const projCam = (c) => [W / 2 + f * c[0] / -c[2] / sq * k, H / 2 - f * c[1] / -c[2] * k];
    const ray = (px) => [(px[0] - W / 2) / k * sq / f, (H / 2 - px[1]) / k / f, -1];
    return {
      intr, pose, position: pos, pxPerMm: k, toCam, toCamDir, toWorldDir,
      depth: (w) => -toCam(w)[2], // distancia sobre el eje óptico (la de la lente delgada)
      project(w) { const c = toCam(w); return c[2] > -NEAR ? null : projCam(c); },
      vanishingPoint(d) { const c = toCamDir(d); return c[2] >= -1e-12 ? null : projCam(c); },
      projectSegment(a, b) {
        let ca = toCam(a), cb = toCam(b);
        if (ca[2] > -NEAR && cb[2] > -NEAR) return null;
        // recorte contra el plano cercano: se mueve el extremo que queda detrás
        if (ca[2] > -NEAR || cb[2] > -NEAR) {
          const t = (-NEAR - ca[2]) / (cb[2] - ca[2]);
          const cut = [0, 1, 2].map(i => ca[i] + (cb[i] - ca[i]) * t);
          if (ca[2] > -NEAR) ca = cut; else cb = cut;
        }
        return [...projCam(ca), ...projCam(cb)];
      },
      // un px está en el horizonte si su rayo es horizontal: una recta en el sensor
      horizon() {
        const up = toCamDir([0, 1, 0]);
        if (Math.abs(up[1]) < 1e-9) return null;
        const yAt = (x) => { const xs = (x - W / 2) / k; return H / 2 - (up[2] - up[0] * xs * sq / f) * f / up[1] * k; };
        return [0, yAt(0), W, yAt(W)];
      },
      groundPoint(px) {
        const d = toWorldDir(ray(px));
        if (d[1] >= -1e-9 || pose.heightM <= 0) return null;
        const t = -pose.heightM / d[1];
        return [pos[0] + d[0] * t, 0, pos[2] + d[2] * t];
      },
    };
  }

  // intersección de las rectas de dos segmentos; null si son (casi) paralelas (< ~0.01°)
  function intersectLines(a, b) {
    const d1x = a[2] - a[0], d1y = a[3] - a[1], d2x = b[2] - b[0], d2y = b[3] - b[1];
    const den = d1x * d2y - d1y * d2x, scale = Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y);
    if (scale <= 0 || Math.abs(den) / scale < 2e-4) return null;
    return pointAt(a, ((b[0] - a[0]) * d2y - (b[1] - a[1]) * d2x) / den);
  }
  // como QLineF::intersects sin acotar: sólo falla si son exactamente paralelas
  function meet(a, b) {
    const d1x = a[2] - a[0], d1y = a[3] - a[1], d2x = b[2] - b[0], d2y = b[3] - b[1];
    const den = d1x * d2y - d1y * d2x;
    return den === 0 ? null : pointAt(a, ((b[0] - a[0]) * d2y - (b[1] - a[1]) * d2x) / den);
  }

  const validIntr = (i, f) => i.plateW > 0 && i.plateH > 0 && i.filmWidthMm > 0 && (i.squeeze || 1) > 0 && f > 0;
  // rayo de un px en ejes de cámara, en mm de sensor con el squeeze deshecho, z = -f
  function sensorDir(i, px, f) {
    const k = i.plateW / i.filmWidthMm;
    return [(px[0] - i.plateW / 2) / k * (i.squeeze || 1), (i.plateH / 2 - px[1]) / k, -f];
  }

  // 1 VP (eje del auto) + focal + roll: tilt y yaw; con keepTilt sólo el yaw. De las dos soluciones
  // de yaw (frente / atrás) queda la más cercana a la actual.
  function solveOneVP(intr, pose, vp, keepTilt) {
    const out = { ok: false, error: '', pose: { ...pose }, focalMm: intr.focalMm };
    if (!validIntr(intr, intr.focalMm)) { out.error = 'Camera data is missing (focal, sensor or plate size)'; return out; }
    const d = norm(sensorDir(intr, vp, intr.focalMm));
    const cr = Math.cos(pose.rollDeg * DEG), sr = Math.sin(pose.rollDeg * DEG);
    const v = [cr * d[0] - sr * d[1], sr * d[0] + cr * d[1], d[2]]; // roll deshecho
    let tilt = pose.tiltDeg * DEG;
    if (!keepTilt) {
      tilt = Math.atan2(-v[1], -v[2]);
      if (Math.abs(tilt) > Math.PI / 2) { out.error = 'The lines meet behind the camera'; return out; }
    }
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const w = [v[0], ct * v[1] - st * v[2], st * v[1] + ct * v[2]];
    const y0 = Math.atan2(w[0], -w[2]) / DEG;
    const c = [wrapDeg(y0), wrapDeg(y0 + 180)];
    out.pose.tiltDeg = tilt / DEG;
    out.pose.yawDeg = Math.abs(angleDelta(c[0], pose.yawDeg)) <= Math.abs(angleDelta(c[1], pose.yawDeg)) ? c[0] : c[1];
    out.ok = true;
    return out;
  }

  // 2 VP (eje del auto + transversal): focal, tilt, roll y yaw. Con fixedFocalMm (Lock focal de la
  // app) la focal no se toca y el eje transversal se ortogonaliza contra el del auto.
  function solveTwoVP(intr, pose, vpA, vpB, fixedFocalMm) {
    const out = { ok: false, error: '', pose: { ...pose }, focalMm: 0 };
    if (!validIntr(intr, 1)) { out.error = 'Camera data is missing (sensor or plate size)'; return out; }
    const a = sensorDir(intr, vpA, 0), b = sensorDir(intr, vpB, 0);
    let f;
    if (fixedFocalMm > 0) f = fixedFocalMm;
    else {
      const f2 = -(a[0] * b[0] + a[1] * b[1]); // direcciones perpendiculares: d1 . d2 = 0
      if (f2 <= 0) { out.error = 'The two vanishing points do not give a valid focal length: move the lines'; return out; }
      f = Math.sqrt(f2);
    }
    const dz = norm([a[0], a[1], -f]);
    let dx = norm([b[0], b[1], -f]);
    const p = dot(dx, dz); dx = norm(dx.map((x, i) => x - dz[i] * p));
    let best = 1e9, found = false;
    for (const sz of [1, -1]) for (const sx of [1, -1]) {
      const zc = dz.map(x => x * sz), xc = dx.map(x => x * sx), yc = cross(zc, xc);
      if (yc[1] <= 0) continue; // no se filma cabeza abajo
      const tilt = Math.asin(Math.min(1, Math.max(-1, -yc[2]))), roll = Math.atan2(yc[0], yc[1]), yaw = Math.atan2(xc[2], zc[2]);
      const delta = Math.abs(angleDelta(yaw / DEG, pose.yawDeg));
      if (delta < best) { best = delta; found = true; Object.assign(out.pose, { tiltDeg: tilt / DEG, rollDeg: roll / DEG, yawDeg: wrapDeg(yaw / DEG) }); }
    }
    if (!found) { out.error = 'Could not orient the camera from these lines'; return out; }
    out.focalMm = f; out.ok = true;
    return out;
  }

  // 3 VP (eje del auto Z, transversal X y vertical Y), como fSpy con los tres ejes: focal (el promedio de
  // los pares que la dan, o fixedFocalMm), tilt, roll y yaw. La vertical manda en tilt y roll, el eje del
  // auto en el yaw; X queda como control (out.checkDeg: cuánto se aparta de ser perpendicular a los otros dos).
  // Sin vpX (null): sólo el eje del auto y la vertical (Z + Y), la focal sale de ese par.
  function solveThreeVP(intr, pose, vpZ, vpX, vpY, fixedFocalMm) {
    const out = { ok: false, error: '', pose: { ...pose }, focalMm: 0, checkDeg: 0 };
    if (!validIntr(intr, 1)) { out.error = 'Camera data is missing (sensor or plate size)'; return out; }
    const z = sensorDir(intr, vpZ, 0), x = vpX ? sensorDir(intr, vpX, 0) : null, y = sensorDir(intr, vpY, 0);
    let f;
    if (fixedFocalMm > 0) f = fixedFocalMm;
    else {
      const f2 = (x ? [[z, x], [z, y], [x, y]] : [[z, y]]).map(([a, b]) => -(a[0] * b[0] + a[1] * b[1])).filter(v => v > 0);
      if (f2.length < (x ? 2 : 1)) { out.error = x ? 'The three vanishing points do not give a valid focal length: move the lines' : 'The car axis and the vertical lines do not give a valid focal length: move the lines'; return out; }
      f = Math.sqrt(f2.reduce((s, v) => s + v, 0) / f2.length);
    }
    const dz = norm([z[0], z[1], -f]), dx = x ? norm([x[0], x[1], -f]) : null;
    let dy = norm([y[0], y[1], -f]);
    // la vertical: hacia arriba de la imagen (no se filma cabeza abajo)
    if (dy[1] < 0) dy = dy.map(v => -v);
    let best = 1e9, found = false;
    for (const sz of [1, -1]) {
      const yc = dy, zp = dz.map(v => v * sz), p = dot(zp, yc);
      const zc = norm(zp.map((v, i) => v - yc[i] * p)), xc = cross(yc, zc);
      if (yc[1] <= 0) continue;
      const tilt = Math.asin(Math.min(1, Math.max(-1, -yc[2]))), roll = Math.atan2(yc[0], yc[1]), yaw = Math.atan2(xc[2], zc[2]);
      const delta = Math.abs(angleDelta(yaw / DEG, pose.yawDeg));
      if (delta < best) { best = delta; found = true; Object.assign(out.pose, { tiltDeg: tilt / DEG, rollDeg: roll / DEG, yawDeg: wrapDeg(yaw / DEG) }); out.checkDeg = dx ? Math.asin(Math.min(1, Math.hypot(dot(dx, yc), dot(dx, zc)))) / DEG : 0; }
    }
    if (!found) { out.error = 'Could not orient the camera from these lines'; return out; }
    out.focalMm = f; out.ok = true;
    return out;
  }

  // Sólo verticales (Y): tilt y roll con la focal que hay; el yaw queda (una vertical no dice hacia dónde se mira)
  function solveVerticalVP(intr, pose, vpY) {
    const out = { ok: false, error: '', pose: { ...pose }, focalMm: intr.focalMm };
    if (!validIntr(intr, intr.focalMm)) { out.error = 'Camera data is missing (focal, sensor or plate size)'; return out; }
    let y = norm(sensorDir(intr, vpY, intr.focalMm));
    if (y[1] < 0) y = y.map(v => -v); // hacia arriba de la imagen
    if (y[1] <= 1e-9) { out.error = 'The vertical lines meet on the horizon: they are not vertical'; return out; }
    out.pose.tiltDeg = Math.asin(Math.min(1, Math.max(-1, -y[2]))) / DEG;
    out.pose.rollDeg = Math.atan2(y[0], y[1]) / DEG;
    out.ok = true;
    return out;
  }

  // tilt con el que el horizonte pasa por ese px (roll y yaw de la pose); null fuera de -80..80
  function tiltForHorizonThrough(intr, pose, px) {
    const yAt = (t) => {
      const l = camera(intr, { ...pose, tiltDeg: t }).horizon();
      if (!l || Math.abs(l[2] - l[0]) < 1e-9) return null;
      return l[1] + (px[0] - l[0]) / (l[2] - l[0]) * (l[3] - l[1]);
    };
    let lo = -80, hi = 80;
    const yLo = yAt(lo), yHi = yAt(hi);
    if (yLo === null || yHi === null || px[1] < Math.min(yLo, yHi) || px[1] > Math.max(yLo, yHi)) return null;
    const rising = yHi > yLo;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2, y = yAt(mid);
      if (y === null) return null;
      if ((y < px[1]) === rising) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // altura de cámara con la que el punto de piso agarrado queda bajo ese px (sólo cambia la altura)
  function heightKeepingGroundPoint(intr, pose, g, px) {
    const hit = camera(intr, { ...pose, heightM: 1 }).groundPoint(px);
    if (!hit) return null;
    const x0 = pose.xM || 0, z0 = pose.zM || 0;
    const r1 = Math.hypot(hit[0] - x0, hit[2] - z0), target = Math.hypot(g[0] - x0, g[2] - z0);
    if (r1 < 1e-9) return null;
    const h = target / r1;
    return h < 0.05 || h > 20 ? null : h;
  }

  // --- Figuras de escala: tarjetas de tamaño real paradas en el piso, mirando a la cámara. Contorno
  // normalizado (u 0..1 izquierda a derecha, v 0..1 abajo hacia arriba).
  const FIGURES = [
    { key: 'person', label: 'Person', name: 'Person 1.75 m', w: 0.50, h: 1.75,
      outline: [[0.30, 0.0], [0.36, 0.45], [0.22, 0.48], [0.20, 0.80], [0.32, 0.84], [0.40, 0.86], [0.38, 0.92], [0.42, 0.99], [0.50, 1.0], [0.58, 0.99], [0.62, 0.92], [0.60, 0.86], [0.68, 0.84], [0.80, 0.80], [0.78, 0.48], [0.64, 0.45], [0.70, 0.0], [0.54, 0.0], [0.50, 0.40], [0.46, 0.0]] },
    { key: 'door', label: 'Door', name: 'Door 0.9 x 2.1 m', w: 0.90, h: 2.10, outline: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { key: 'car', label: 'Car', name: 'Sedan 1.8 x 1.45 m', w: 1.80, h: 1.45,
      outline: [[0.04, 0.10], [0.04, 0.0], [0.18, 0.0], [0.18, 0.08], [0.82, 0.08], [0.82, 0.0], [0.96, 0.0], [0.96, 0.10], [1.0, 0.45], [0.94, 0.62], [0.80, 0.97], [0.20, 0.97], [0.06, 0.62], [0.0, 0.45]] },
    { key: 'bus', label: 'Bus', name: 'Bus 2.6 x 3.1 m', w: 2.60, h: 3.10,
      outline: [[0.02, 0.06], [0.02, 0.0], [0.16, 0.0], [0.16, 0.04], [0.84, 0.04], [0.84, 0.0], [0.98, 0.0], [0.98, 0.06], [1.0, 0.94], [0.94, 1.0], [0.06, 1.0], [0.0, 0.94]] },
  ];
  const figureSpec = (kind) => FIGURES.find(f => f.key === kind) || FIGURES[0];
  // esquinas (abajo-izq, abajo-der, arriba-der, arriba-izq) en px; null si alguna queda detrás
  function figureQuad(cam, fig) {
    const s = figureSpec(fig.kind), base = [fig.xM, 0, fig.zM];
    const tx = base[0] - cam.position[0], tz = base[2] - cam.position[2], l = Math.hypot(tx, tz);
    if (l < 1e-6) return null;
    const hx = -tz / l * s.w / 2, hz = tx / l * s.w / 2;
    const out = [];
    for (const c of [[base[0] - hx, 0, base[2] - hz], [base[0] + hx, 0, base[2] + hz], [base[0] + hx, s.h, base[2] + hz], [base[0] - hx, s.h, base[2] - hz]]) {
      const p = cam.project(c); if (!p) return null; out.push(p);
    }
    return out;
  }
  function bilinear(q, u, v) {
    const b = [q[0][0] + (q[1][0] - q[0][0]) * u, q[0][1] + (q[1][1] - q[0][1]) * u];
    const t = [q[3][0] + (q[2][0] - q[3][0]) * u, q[3][1] + (q[2][1] - q[3][1]) * u];
    return [b[0] + (t[0] - b[0]) * v, b[1] + (t[1] - b[1]) * v];
  }

  // --- Auto from windows. En un plate de croma de auto el verde está en las ventanas: el borde de
  // esa máscara son los marcos, y los que corren a lo largo del auto fugan al VP de su eje.
  // Máscara reducida: 1 = agujero (verde o alpha transparente). isHole(x, y) en px del plate.
  function holeMask(W, H, isHole, maxWidth = 960) {
    const step = Math.max(1, Math.ceil(W / Math.max(16, maxWidth)));
    const w = Math.floor(W / step), h = Math.floor(H / step), sub = step >= 4 ? 2 : 1;
    const data = new Uint8Array(w * h);
    for (let my = 0; my < h; my++) for (let mx = 0; mx < w; mx++) {
      let votes = 0, total = 0;
      for (let y = my * step; y < (my + 1) * step; y += sub) for (let x = mx * step; x < (mx + 1) * step; x += sub) { votes += isHole(x, y) ? 1 : 0; total++; }
      data[my * w + mx] = votes * 2 > total ? 1 : 0;
    }
    // mayoría 3x3: saca puntos sueltos (reflejos, ruido del verde) sin mover los bordes
    const clean = data.slice();
    for (let y = 1; y + 1 < h; y++) for (let x = 1; x + 1 < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += data[(y + dy) * w + x + dx];
      clean[y * w + x] = n >= 5 ? 1 : 0;
    }
    return { width: w, height: h, scale: step, data: clean };
  }

  const orientationDiff = (a, b) => { let d = Math.abs(a - b) % Math.PI; return d > Math.PI / 2 ? Math.PI - d : d; };

  // segmentos rectos del borde de la máscara (px del plate), con el agujero a la izquierda del
  // sentido p1 -> p2 en pantalla: el borde de abajo de una ventana (zócalo) va de izquierda a derecha
  function maskEdgeSegments(mask) {
    const out = [], w = mask.width, h = mask.height, M = mask.data;
    if (w < 8 || h < 8) return out;
    // campo suave (dos cajas 3x3) para que el gradiente siga a la recta y no a la escalera de px
    let field = Float32Array.from(M), tmp = new Float32Array(w * h);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += field[yy * w + xx]; n++; }
        }
        tmp[y * w + x] = s / n;
      }
      [field, tmp] = [tmp, field];
    }
    const angle = new Float32Array(w * h).fill(-1), gradX = new Float32Array(w * h), gradY = new Float32Array(w * h), edges = [];
    const F = (x, y) => field[y * w + x];
    for (let y = 1; y + 1 < h; y++) for (let x = 1; x + 1 < w; x++) {
      const i = y * w + x;
      if (!M[i] || (M[i - 1] && M[i + 1] && M[i - w] && M[i + w])) continue;
      const gx = (F(x + 1, y - 1) + 2 * F(x + 1, y) + F(x + 1, y + 1)) - (F(x - 1, y - 1) + 2 * F(x - 1, y) + F(x - 1, y + 1));
      const gy = (F(x - 1, y + 1) + 2 * F(x, y + 1) + F(x + 1, y + 1)) - (F(x - 1, y - 1) + 2 * F(x, y - 1) + F(x + 1, y - 1));
      if (Math.hypot(gx, gy) < 0.05) continue;
      angle[i] = ((Math.atan2(gy, gx) + Math.PI / 2) + 2 * Math.PI) % Math.PI; // la recta es perpendicular al gradiente
      gradX[i] = gx; gradY[i] = gy; edges.push(i);
    }
    // crecimiento de regiones: px de borde conectados con orientación parecida (como LSD)
    const tol = 15 * DEG, used = new Uint8Array(w * h);
    for (const seed of edges) {
      if (used[seed]) continue;
      const region = [], stack = [seed]; used[seed] = 1;
      let sumC = Math.cos(2 * angle[seed]), sumS = Math.sin(2 * angle[seed]);
      while (stack.length) {
        const idx = stack.pop(); region.push(idx);
        const ra = 0.5 * Math.atan2(sumS, sumC), x = idx % w, y = (idx / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const n = yy * w + xx;
          if (used[n] || angle[n] < 0 || orientationDiff(angle[n], ra) > tol) continue;
          used[n] = 1; sumC += Math.cos(2 * angle[n]); sumS += Math.sin(2 * angle[n]); stack.push(n);
        }
      }
      if (region.length < 12) continue;
      let cx = 0, cy = 0;
      for (const i of region) { cx += i % w; cy += (i / w) | 0; }
      cx /= region.length; cy /= region.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const i of region) { const dx = i % w - cx, dy = ((i / w) | 0) - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
      let tMin = 1e9, tMax = -1e9, nMin = 1e9, nMax = -1e9, hx = 0, hy = 0;
      for (const i of region) {
        hx += gradX[i]; hy += gradY[i];
        const dx = i % w - cx, dy = ((i / w) | 0) - cy, t = dx * ux + dy * uy, n = -dx * uy + dy * ux;
        tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); nMin = Math.min(nMin, n); nMax = Math.max(nMax, n);
      }
      const length = tMax - tMin;
      if (length < 25 || nMax - nMin > Math.max(3, 0.08 * length)) continue;
      // detrás del borde tiene que haber hueco de ventana (1.2% del alto): una tira fina del alpha (entre el
      // tapizado y el vidrio) no es un marco, y con peso entero empataba al zócalo y el roll decidía (pasó con un plate real)
      const hl = Math.hypot(hx, hy), deep = Math.ceil(0.012 * h);
      let thin = false;
      for (let k = 1; k <= deep && !thin; k++) { const xx = Math.round(cx + hx / hl * k), yy = Math.round(cy + hy / hl * k); thin = xx < 0 || yy < 0 || xx >= w || yy >= h || !M[yy * w + xx]; }
      if (thin) continue;
      const s = mask.scale, P = (x, y) => [(x + 0.5) * s, (y + 0.5) * s];
      const a = P(cx + ux * tMin, cy + uy * tMin), b = P(cx + ux * tMax, cy + uy * tMax);
      out.push(ux * hy - uy * hx > 0 ? [...b, ...a] : [...a, ...b]);
    }
    return out;
  }

  // VP del eje del auto más apoyado dentro del cuadro agrandado un 25%. Con horizonte (inclinómetro)
  // se busca sobre él y alcanza un borde preciso (la otra línea es el horizonte); sin horizonte hacen
  // falta tres bordes de acuerdo. prior: el VP según el yaw actual (a menos de 0.4 anchos de plate).
  function findAxisVanishingPoint(segments, plateW, plateH, horizon, prior) {
    const TOL_DEG = 1.5, tol = TOL_DEG * DEG;
    const res = { ok: false, error: '', vp: null, lines: [null, null], segmentCount: segments.length, inlierCount: 0, rmsAngleDeg: 0, horizonLine: false, segments, inlier: segments.map(() => false) };
    const onH = !!horizon && len2(horizon) > 0;
    let h0 = [0, 0], hd = [1, 0];
    if (onH) { const L = len2(horizon); h0 = [horizon[0], horizon[1]]; hd = [(horizon[2] - horizon[0]) / L, (horizon[3] - horizon[1]) / L]; }
    const distH = (p) => Math.abs((p[0] - h0[0]) * hd[1] - (p[1] - h0[1]) * hd[0]);
    const segs = segments.map(l => {
      const length = len2(l), s = { line: l, length, mid: pointAt(l, 0.5), dir: [1, 0], weight: 1 };
      if (length > 0) s.dir = [(l[2] - l[0]) / length, (l[3] - l[1]) / length];
      return s;
    });
    const cand = [];
    segs.forEach((s, i) => {
      if (s.length <= 0) return;
      const segAngle = Math.atan2(s.dir[1], s.dir[0]);
      if (onH) {
        // sirven los casi horizontales salvo los paralelos o pegados al horizonte y los empinados
        const crossing = orientationDiff(segAngle, Math.atan2(hd[1], hd[0])), band = 0.006 * plateH;
        const onLine = distH([s.line[0], s.line[1]]) < band && distH([s.line[2], s.line[3]]) < band;
        if (crossing > 1 * DEG && crossing < 60 * DEG && !onLine) {
          // peso por precisión: un borde rasante (la luneta curva) apoya miles de px de horizonte
          const sinC = Math.sin(crossing), spread = distH(s.mid) * TOL_DEG * DEG / (sinC * sinC);
          s.weight = Math.min(1, 0.05 * plateW / Math.max(1, spread));
          // agujero abajo = techo de la ventana (sigue la caída del techo); gana el zócalo
          s.weight *= 1 - 0.65 * (s.dir[0] < 0 ? 1 : 0);
          cand.push(i);
        }
      } else {
        const a = Math.abs(segAngle) / DEG, fromH = Math.min(a, 180 - a);
        if (fromH > 8 && fromH < 82) cand.push(i);
      }
    });
    const minC = onH ? 1 : 2;
    if (cand.length < minC) { res.error = `Not enough window edges along the car: found ${cand.length}, need ${minC}`; return res; }
    cand.sort((a, b) => segs[b].length - segs[a].length);
    const inRegion = (p) => p[0] >= -0.25 * plateW && p[0] < 1.25 * plateW && p[1] >= -0.25 * plateH && p[1] < 1.25 * plateH && (!prior || Math.abs(p[0] - prior[0]) < 0.4 * plateW);
    const support = (p, mark) => {
      let score = 0;
      for (const i of cand) {
        const s = segs[i], tx = p[0] - s.mid[0], ty = p[1] - s.mid[1], dist = Math.hypot(tx, ty);
        if (dist < 0.5 * s.length) continue;
        if (Math.acos(Math.min(1, Math.abs(tx * s.dir[0] + ty * s.dir[1]) / dist)) < tol) { score += s.length * s.weight; if (mark) mark[i] = true; }
      }
      return score;
    };
    const hyp = [];
    if (onH) {
      const hl = [h0[0], h0[1], h0[0] + hd[0], h0[1] + hd[1]];
      for (const i of cand) { const p = meet(segs[i].line, hl); if (p && inRegion(p)) hyp.push(p); }
    } else {
      const top = Math.min(cand.length, 40);
      for (let a = 0; a < top; a++) for (let b = a + 1; b < top; b++) { const p = meet(segs[cand[a]].line, segs[cand[b]].line); if (p && inRegion(p)) hyp.push(p); }
    }
    let bestScore = 0, best = null;
    for (const p of hyp) { const sc = support(p, null); if (sc > bestScore) { bestScore = sc; best = p; } }
    if (bestScore <= 0) { res.error = 'The window edges do not meet at a vanishing point inside the frame'; return res; }
    // ajuste fino por mínimos cuadrados, libre en 2D o a lo largo del horizonte
    let mark = new Array(segs.length).fill(false);
    for (let it = 0; it < 3; it++) {
      mark.fill(false); support(best, mark);
      let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, num = 0, den = 0;
      for (const i of cand) {
        if (!mark[i]) continue;
        const s = segs[i], wt = s.length * s.weight, nx = -s.dir[1], ny = s.dir[0], c = nx * s.mid[0] + ny * s.mid[1];
        a11 += wt * nx * nx; a12 += wt * nx * ny; a22 += wt * ny * ny; b1 += wt * nx * c; b2 += wt * ny * c;
        const nd = nx * hd[0] + ny * hd[1];
        num += wt * (c - (nx * h0[0] + ny * h0[1])) * nd; den += wt * nd * nd;
      }
      if (onH) { if (den < 1e-12) break; best = [h0[0] + hd[0] * num / den, h0[1] + hd[1] * num / den]; }
      else { const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-9) break; best = [(a22 * b1 - a12 * b2) / det, (a11 * b2 - a12 * b1) / det]; }
    }
    mark.fill(false); support(best, mark);
    let first = -1, sumSq = 0, sumW = 0;
    for (const i of cand) {
      if (!mark[i]) continue;
      const s = segs[i]; res.inlierCount++;
      const tx = best[0] - s.mid[0], ty = best[1] - s.mid[1];
      const ang = Math.acos(Math.min(1, Math.abs(tx * s.dir[0] + ty * s.dir[1]) / Math.hypot(tx, ty))) / DEG, wt = s.length * s.weight;
      sumSq += wt * ang * ang; sumW += wt;
      if (first < 0 || segs[first].length * segs[first].weight < wt) first = i;
    }
    res.inlier = mark.slice(); // también si se niega: el overlay muestra qué encontró
    if (onH) {
      if (first < 0 || segs[first].weight < 0.5 || sumW < 0.06 * plateW) {
        res.error = 'No window edge along the car crosses the horizon clearly; place the lines by hand';
        // por qué, para el aviso: bordes largos casi paralelos al horizonte (vista de costado: ahí el VP
        // se va al infinito y un décimo de grado del borde mueve mucho el yaw) o bordes que apuntan a
        // VPs distintos (de 3/4: los marcos de las ventanas no corren paralelos al auto)
        const hAng = Math.atan2(hd[1], hd[0]);
        res.sideLen = segs.reduce((a, s) => a + (s.length > 0.03 * plateW && orientationDiff(Math.atan2(s.dir[1], s.dir[0]), hAng) < 1 * DEG && distH(s.mid) > 0.006 * plateH ? s.length : 0), 0);
        const xs = cand.filter(i => segs[i].length > 0.03 * plateW).map(i => meet(segs[i].line, [h0[0], h0[1], h0[0] + hd[0], h0[1] + hd[1]])).filter(Boolean);
        if (xs.length >= 2) res.vpSpread = [xs.reduce((a, p) => p[0] < a[0] ? p : a), xs.reduce((a, p) => p[0] > a[0] ? p : a)];
        return res;
      }
    } else if (res.inlierCount < 3) { res.error = `Only ${res.inlierCount} window edges point at a common vanishing point; place the lines by hand`; return res; }
    const farEnd = (i) => { const l = segs[i].line; return Math.hypot(l[0] - best[0], l[1] - best[1]) >= Math.hypot(l[2] - best[0], l[3] - best[1]) ? [l[0], l[1]] : [l[2], l[3]]; };
    const arrival = (i) => { const a = farEnd(i); return Math.atan2(best[1] - a[1], best[0] - a[0]); };
    let second = -1;
    for (const i of cand) {
      if (mark[i] && i !== first && segs[i].weight >= 0.5 && orientationDiff(arrival(i), arrival(first)) > 3 * DEG && (second < 0 || segs[i].length > segs[second].length)) second = i;
    }
    if (second < 0 && !onH) { res.error = 'The window edges that point at the vanishing point are almost parallel'; return res; }
    // cada línea sale del extremo lejano con su largo, apuntando exacto al VP ajustado
    const aimed = (i) => { const a = farEnd(i), t = Math.min(1, segs[i].length / Math.max(1e-9, Math.hypot(best[0] - a[0], best[1] - a[1]))); return [...a, ...pointAt([...a, ...best], t)]; };
    res.lines[0] = aimed(first);
    if (second >= 0) res.lines[1] = aimed(second);
    else {
      const toC = best[0] > 0.5 * plateW ? -1 : 1; // un solo borde: la otra es el horizonte, del lado del centro
      res.lines[1] = [best[0] + hd[0] * toC * 0.3 * plateW, best[1] + hd[1] * toC * 0.3 * plateW, best[0], best[1]];
      res.horizonLine = true;
    }
    if (res.lines[0][0] > res.lines[1][0]) res.lines.reverse(); // la 0 a la izquierda
    res.vp = best;
    res.rmsAngleDeg = sumW > 0 ? Math.sqrt(sumSq / sumW) : 0;
    res.ok = true;
    return res;
  }

  // Roll del inclinómetro ARRI (arriraw/roll) -> roll de la app. SMPTE RDD 55:2022 (metadata ARRI): crece con
  // el giro horario del cuerpo visto desde atrás; acá roll > 0 es antihorario (Rz, como el rotate.z de Nuke).
  // El tilt ARRI crece mirando hacia arriba, igual que acá: no cambia. Medido en plates reales: tests/test_arriroll.mjs.
  const rollFromArri = (deg) => -deg;

  return { DEG, camera, intersectLines, solveOneVP, solveTwoVP, solveThreeVP, solveVerticalVP, tiltForHorizonThrough, heightKeepingGroundPoint, angleDelta, rollFromArri,
    FIGURES, figureSpec, figureQuad, bilinear, holeMask, maskEdgeSegments, findAxisVanishingPoint };
})();
globalThis.SceneMath = SceneMath; // en Node (tests) y en el worker
