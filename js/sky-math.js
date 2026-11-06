// Cielo físico de 3D Render: el modelo analítico de Preetham, Shirley y Smits («A Practical Analytic Model for
// Daylight», SIGGRAPH 1999), el de los motores de render: la distribución de Perez para la luminancia Y y la
// cromaticidad x, y (CIE), según la turbidez y la altura del sol, pasada de CIE XYZ a lineal Rec.709 (D65). Sin el disco
// del sol: el sol es la luz direccional de la pestaña. Se hornea a un equirectangular que usan los dos motores: el raster
// lo pasa a ACEScg y por PMREM, el path tracer lo toma como entorno tal cual. Abajo del horizonte, el suelo:
// Ground albedo × la luz que le llega (cielo + sol) / π.
// (El Sky.js de three, que usa Rayleigh y Mie, da un cielo unas seis veces más azul que rojo: como luz tiñe toda la
// escena de azul. Preetham da el color de un cielo real.) Puro (sin THREE): lo usan los tests.
// API: SKY_DEF, SKY_K, skyRadiance, skyBake, skyIrradiance, skyPerez, skyZenith.
const SKY_DEF = { turbidity: 3, albedo: 0.1 };
// la escala: con los valores de SKY_DEF y el sol a 45°, el cielo ilumina el piso como el cielo de colores de arranque
// (Sky light 0,6 con #bfd4ff). Sky light la multiplica (0,6 = × 1). Calculada con skyIrradiance (tests/test_sky.mjs)
const SKY_K = 0.0426;
// los coeficientes de Perez (A..E) de Y, x e y para la turbidez T (tabla del apéndice del paper)
function skyPerez(T) {
  return {
    Y: [0.1787 * T - 1.4630, -0.3554 * T + 0.4275, -0.0227 * T + 5.3251, 0.1206 * T - 2.5771, -0.0670 * T + 0.3703],
    x: [-0.0193 * T - 0.2592, -0.0665 * T + 0.0008, -0.0004 * T + 0.2125, -0.0641 * T - 0.8989, -0.0033 * T + 0.0452],
    y: [-0.0167 * T - 0.2608, -0.0950 * T + 0.0092, -0.0079 * T + 0.2102, -0.0441 * T - 1.6537, -0.0109 * T + 0.0529],
  };
}
// el cenit: luminancia (kcd/m²) y cromaticidad, con ts el ángulo del sol desde el cenit (radianes)
function skyZenith(T, ts) {
  const chi = (4 / 9 - T / 120) * (Math.PI - 2 * ts), t2 = ts * ts, t3 = t2 * ts, T2 = T * T;
  return {
    Y: (4.0453 * T - 4.9710) * Math.tan(chi) - 0.2155 * T + 2.4192,
    x: T2 * (0.00166 * t3 - 0.00375 * t2 + 0.00209 * ts) + T * (-0.02903 * t3 + 0.06377 * t2 - 0.03202 * ts + 0.00394) + (0.11693 * t3 - 0.21196 * t2 + 0.06052 * ts + 0.25886),
    y: T2 * (0.00275 * t3 - 0.00610 * t2 + 0.00317 * ts) + T * (-0.04214 * t3 + 0.08970 * t2 - 0.04153 * ts + 0.00516) + (0.15346 * t3 - 0.26756 * t2 + 0.06670 * ts + 0.26688),
  };
}
const skyF = (c, th, g) => (1 + c[0] * Math.exp(c[1] / Math.max(Math.cos(th), 0.01))) * (1 + c[2] * Math.exp(c[3] * g) + c[4] * Math.cos(g) ** 2);
// radiancia del cielo en la dirección d (unitaria, Y arriba) con el sol en s (unitaria), sin escalar (kcd/m²), lineal
// Rec.709. o: { turbidity }. El sol abajo del horizonte cuenta como en el horizonte (Preetham no vale ahí); abajo del
// horizonte da la del horizonte
function skyRadiance(d, s, o) {
  const T = o.turbidity, P = skyPerez(T), ts = Math.acos(Math.max(0, Math.min(1, s[1]))) * 0.9999;
  const dy = Math.max(0.001, Math.min(1, d[1])), th = Math.acos(dy);
  const g = Math.acos(Math.max(-1, Math.min(1, d[0] * s[0] + dy * s[1] + d[2] * s[2])));
  const Z = skyZenith(T, ts);
  const Y = Z.Y * skyF(P.Y, th, g) / skyF(P.Y, 0, ts), x = Z.x * skyF(P.x, th, g) / skyF(P.x, 0, ts), y = Z.y * skyF(P.y, th, g) / skyF(P.y, 0, ts);
  const X = x / y * Y, Zc = (1 - x - y) / y * Y;
  // CIE XYZ → lineal Rec.709 (D65)
  return [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Zc, -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Zc, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Zc].map(v => Math.max(0, v));
}
// la irradiancia del cielo sobre un piso horizontal (∫ L cos θ dω en el hemisferio de arriba), sin escalar
function skyIrradiance(s, o, n = 48) {
  const E = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const th = (i + 0.5) / n * Math.PI / 2, st = Math.sin(th), ct = Math.cos(th);
    for (let j = 0; j < 2 * n; j++) {
      const ph = (j + 0.5) / (2 * n) * 2 * Math.PI, L = skyRadiance([st * Math.cos(ph), ct, st * Math.sin(ph)], s, o);
      const w = ct * st * (Math.PI / 2 / n) * (2 * Math.PI / (2 * n));
      for (let c = 0; c < 3; c++) E[c] += L[c] * w;
    }
  }
  return E;
}
// el equirectangular de w × h (fila 0 abajo, como las texturas de 3D Render: flipY false), RGBA float, lineal Rec.709.
// sun: dirección del sol en el mundo de la app; o: SKY_DEF más k (la escala: SKY_K × Sky light / 0,6) y sunE (la
// irradiancia del sol sobre el piso, para el suelo)
function skyBake(w, h, sun, o) {
  const d = new Float32Array(w * h * 4), E = skyIrradiance(sun, o, 16);
  // de noche (el sol más de 6° abajo del horizonte) el cielo se apaga
  const k = o.k * Math.max(0, Math.min(1, (sun[1] + 0.1) / 0.1));
  const gnd = [0, 1, 2].map(c => o.albedo * (E[c] * k + (o.sunE || 0)) / Math.PI);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h, el = (v - 0.5) * Math.PI, cy = Math.sin(el), ce = Math.cos(el);
    // el horizonte, suave: medio grado de transición al suelo
    const t = Math.max(0, Math.min(1, (cy + 0.012) / 0.024)), f = t * t * (3 - 2 * t);
    for (let x = 0; x < w; x++) {
      const phi = ((x + 0.5) / w - 0.5) * 2 * Math.PI, dir = [ce * Math.cos(phi), cy, ce * Math.sin(phi)]; // u = atan(z, x) / 2π + 0,5
      const L = skyRadiance(dir, sun, o), i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = gnd[c] + (L[c] * k - gnd[c]) * f;
      d[i + 3] = 1;
    }
  }
  return d;
}
