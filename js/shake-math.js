// Shakelab: la matemática del movimiento del iPhone como movimiento de cámara (sin THREE, para la pestaña,
// js/shakelab.js, y para tests/test_shake.mjs).
// La pose llega de ARKit (por ZIG SIM Pro): posición en metros con Y arriba y un cuaternión [x, y, z, w]; la cámara
// mira a su −Z, como en three.js. Los seis ejes de la toma se cuentan desde la pose de cero (Zero) en un marco que
// sólo tiene el rumbo del iPhone en ese momento: dolly va hacia donde miraba (en horizontal), truck a su derecha y
// pedestal por la vertical del mundo. Pan, tilt y roll son el Euler 'YXZ' (el de la app, rot_order ZXY de Nuke).
// Signos: pan a la derecha +, tilt hacia arriba +, roll como el Euler de three.js; dolly hacia adelante +, truck a la
// derecha +, pedestal arriba +. Grados y metros.
const SHK_AXES = [
  { k: 'pan', label: 'Pan', unit: '°', lim: 5, step: 0.5 },
  { k: 'tilt', label: 'Tilt', unit: '°', lim: 5, step: 0.5 },
  { k: 'roll', label: 'Roll', unit: '°', lim: 3, step: 0.5 },
  { k: 'dolly', label: 'Dolly', unit: 'm', lim: 0.5, step: 0.05 },
  { k: 'truck', label: 'Truck', unit: 'm', lim: 0.5, step: 0.05 },
  { k: 'ped', label: 'Pedestal', unit: 'm', lim: 0.3, step: 0.05 },
];
const SHK_D2R = Math.PI / 180;
const shkWrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const shkQMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const shkQRotZ = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
// Euler 'YXZ' (R = Ry Rx Rz) de un cuaternión, igual que THREE.Euler.setFromQuaternion(q, 'YXZ')
function shkEuler(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1, x = q[0] / n, y = q[1] / n, z = q[2] / n, w = q[3] / n;
  const m11 = 1 - 2 * (y * y + z * z), m13 = 2 * (x * z + w * y), m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x), m31 = 2 * (x * z - w * y), m33 = 1 - 2 * (x * x + y * y);
  const ex = Math.asin(-Math.max(-1, Math.min(1, m23)));
  if (Math.abs(m23) < 0.9999999) return { x: ex, y: Math.atan2(m13, m33), z: Math.atan2(m21, m22) };
  return { x: ex, y: Math.atan2(-m31, m11), z: 0 };
}
// La pose de cero. El iPhone puede estar acostado (como una cámara) o parado: el giro sobre su eje de visión se
// redondea al cuarto de vuelta más cercano y se descuenta siempre igual, así parado o acostado da lo mismo.
function shkZero(pose) {
  const snap = Math.round(shkEuler(pose.q).z / (Math.PI / 2)) * (Math.PI / 2);
  const q = shkQMul(pose.q, shkQRotZ(-snap));
  return { p: pose.p.slice(0, 3), snap, e: shkEuler(q) };
}
// los seis ejes de una pose contra la de cero: [pan, tilt, roll, dolly, truck, pedestal]
function shkDelta(z, pose) {
  const e = shkEuler(shkQMul(pose.q, shkQRotZ(-z.snap)));
  const dx = pose.p[0] - z.p[0], dy = pose.p[1] - z.p[1], dz = pose.p[2] - z.p[2];
  const c = Math.cos(z.e.y), s = Math.sin(z.e.y);
  // al marco del cero (sólo el rumbo): Ry(−yaw0)
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return [-shkWrapPi(e.y - z.e.y) / SHK_D2R, (e.x - z.e.x) / SHK_D2R, shkWrapPi(e.z - z.e.z) / SHK_D2R, -lz, lx, dy];
}
// Límite con frenada en curva. Hasta (1 − brake) del límite pasa tal cual; después frena con desaceleración pareja
// (una parábola que sale con la misma pendiente) y llega al límite con pendiente cero, donde se queda.
// brake 0: corta en seco; brake 1: frena desde el centro. Un límite 0 traba el eje.
function shkSoft(x, lim, brake) {
  if (!(lim > 0)) return 0;
  const b = Math.max(0, Math.min(1, +brake || 0)), s = lim * (1 - b), w = lim - s, a = Math.abs(x), sg = x < 0 ? -1 : 1;
  if (a <= s) return x;
  if (w <= 0 || a >= s + 2 * w) return sg * lim;
  const d = a - s;
  return sg * (s + d - d * d / (4 * w));
}
const shkLimit = (v, lims, brake) => v.map((x, i) => shkSoft(x, lims[i], brake));
// el valor de una toma en t segundos: interpolación lineal entre las muestras ({ t, v }); fuera de la toma, el borde
function shkSample(take, t) {
  const S = take && take.s; if (!S || !S.length) return [0, 0, 0, 0, 0, 0];
  if (t <= S[0].t) return S[0].v.slice();
  const L = S[S.length - 1]; if (t >= L.t) return L.v.slice();
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].t <= t) lo = m; else hi = m; }
  const a = S[lo], b = S[hi], u = (t - a.t) / ((b.t - a.t) || 1);
  return a.v.map((x, i) => x + (b.v[i] - x) * u);
}
// la cámara de la toma con el movimiento encima: base { p: [x, y, z], e: { x, y, z } } (Euler 'YXZ', radianes)
function shkApply(base, v) {
  const yaw = base.e.y, c = Math.cos(yaw), s = Math.sin(yaw);
  const tx = v[4], ty = v[5], tz = -v[3]; // en el marco de la cámara con sólo su rumbo: Ry(yaw)
  return {
    p: [base.p[0] + tx * c + tz * s, base.p[1] + ty, base.p[2] - tx * s + tz * c],
    e: { x: base.e.x + v[1] * SHK_D2R, y: yaw - v[0] * SHK_D2R, z: base.e.z + v[2] * SHK_D2R },
  };
}
// El colchón del vivo: por Wi-Fi las poses llegan en tandas, con huecos, pero cada una trae la hora del teléfono (t,
// en ms). Mostrarlas al llegar mueve la cámara a saltos; el colchón las muestra parejas, un poco atrasadas, en la
// hora del teléfono. Cada llegada (at: reloj de acá) anota cuánto tardó; la más rápida de los últimos segundos es la
// referencia. El atraso (Live, SHK_LAG) es lo que tardaron las llegadas del último segundo hasta una proporción (q:
// todas, la mitad o ninguna), más el hueco más largo entre dos poses seguidas (gap: para tener siempre la siguiente
// con la que interpolar) y un margen: más atraso, más parejo y más lag. Si la siguiente pose todavía no llegó, se
// queda en la última (no se adivina: al frenar el teléfono en seco, la cámara se pasaría y volvería). La diferencia
// entre los dos relojes (la referencia más el atraso) cambia de a poco: la hora mostrada nunca vuelve atrás ni salta;
// cuando sube, el tiempo anda más lento un momento, y cuando baja, un 5 % más rápido.
const SHK_BUF = { keep: 3000, win: 1000, margin: 5, max: 300 };
const SHK_LAG = [
  { k: 'smooth', label: 'Smooth', q: 1, gap: true },
  { k: 'balanced', label: 'Balanced', q: 0.5, gap: true },
  { k: 'least', label: 'Least lag', q: 0, gap: false },
];
const shkBufNew = () => ({ arr: [], delay: 0, off: 0, now: 0, shown: -Infinity, lastT: -Infinity });
function shkBufPush(b, t, at) {
  b.arr.push([at, at - t, t > b.lastT && b.lastT > -Infinity ? Math.min(200, t - b.lastT) : 0]);
  b.lastT = t < b.lastT - 1000 ? t : Math.max(b.lastT, t);
  while (b.arr.length && at - b.arr[0][0] > SHK_BUF.keep) b.arr.shift();
}
// la hora del teléfono a mostrar ahora (null sin llegadas); lag: un modo de SHK_LAG
function shkBufTime(b, now, lag = SHK_LAG[1]) {
  if (!b.arr.length) return null;
  let oMin = Infinity, gap = 0; const late = [];
  for (const [, o] of b.arr) oMin = Math.min(oMin, o);
  for (const [at, o, g] of b.arr) if (now - at <= SHK_BUF.win) { late.push(o - oMin); gap = Math.max(gap, g); }
  late.sort((x, y) => x - y);
  const lq = late.length && lag.q > 0 ? late[Math.min(late.length - 1, Math.floor(lag.q * late.length))] : 0;
  const want = oMin + Math.min(SHK_BUF.max, lq + (lag.gap ? gap : 0) + SHK_BUF.margin), dt = b.now ? Math.max(0, Math.min(100, now - b.now)) : 0;
  // otro reloj (el teléfono recargó la página): se salta de una
  b.off = !b.now || Math.abs(want - b.off) > 1000 ? want : b.off + Math.max(-0.05 * dt, Math.min(0.5 * dt, want - b.off));
  b.now = now; b.delay = b.off - oMin;
  const v = now - b.off; b.shown = v < b.shown - 1000 ? v : Math.max(b.shown, v);
  return b.shown;
}
