// street-layout: el trazado de la avenida en metros (coordenadas del entorno: Y arriba, la calle a lo largo de Z,
// el lado derecho +X) y dónde van las referencias de escala de la comparación con el 3D. Sin DOM ni THREE: lo usan
// environment.js (que arma la calle), ghost.js (que la dibuja encima del plate) y los tests de Node. Así las
// líneas del fantasma son las mismas que tiene la calle 3D.
function avenueLayout(p) {
  const lw = p.laneW, med = p.median;
  let rightN = Math.round(p.lanesR ?? 3), leftN = Math.round(p.lanesL ?? 3); // right side (+X) drives toward -Z
  if (!rightN && !leftN) rightN = 1;
  // each side: carriageway from the median edge (inner) to its curb (outer); the road need not be symmetric
  const xR = med / 2 + rightN * lw, xL = -(med / 2 + leftN * lw);
  // road crown: each carriageway falls from the median edge (or centre line) to the curb
  const cr = p.crown || 0, cp = p.crownP || 2;
  const sideD = (x) => Math.max((x >= 0 ? rightN : leftN) * lw, 1e-3);
  const crownY = (x) => { const D = sideD(x), d = Math.min(Math.max(Math.abs(x) - med / 2, 0), D); return -cr * Math.pow(d / D, cp); };
  const crownS = (x) => { const D = sideD(x), d = Math.min(Math.max(Math.abs(x) - med / 2, 0), D); return d <= 0 ? 0 : -Math.sign(x) * cr * cp * Math.pow(d / D, cp - 1) / D; };
  const edgeY = (s) => (s > 0 ? rightN : leftN) ? crownY(s > 0 ? xR : xL) : 0; // height of each curb's foot
  const edgeX = (s) => s > 0 ? xR : xL;
  const oneWay = p.flow === 'one', rev = p.reverse ? -1 : 1;
  // lane x centres
  const lanes = [];
  // el carril de cada lado contra el cordón puede ser de estacionados (park)
  for (let i = 0; i < rightN; i++) lanes.push({ x: med / 2 + lw * (i + 0.5), dir: rev, park: !!p.parkR && i === rightN - 1 });
  for (let i = 0; i < leftN; i++) lanes.push({ x: -(med / 2 + lw * (i + 0.5)), dir: (oneWay ? 1 : -1) * rev, park: !!p.parkL && i === leftN - 1 });
  const dashes = [];
  const sideLines = (n, sign) => { for (let i = 1; i < n; i++) dashes.push(sign * (med / 2 + lw * i)); };
  sideLines(rightN, 1); sideLines(leftN, -1);
  if (oneWay && med < 0.6 && leftN && rightN) dashes.push(0); // one-way: plain lane line in the middle, no double yellow
  // líneas centrales llenas: [x, amarilla]
  const centre = [];
  if (med >= 0.6) { if (rightN) centre.push([med / 2 + 0.25, !oneWay]); if (leftN) centre.push([-med / 2 - 0.25, !oneWay]); }
  else if (leftN && rightN && !oneWay) centre.push([0.1, true], [-0.1, true]);
  // la pared de las fachadas del lado de la calle (el bloque de cada edificio arranca 0.5 m detrás de la vereda)
  const faceX = (s) => edgeX(s) + s * (p.walk || 0) + s * 0.5;
  const walkY = (s) => edgeY(s) + 0.15; // arriba de la vereda (cordón de 15 cm)
  return { lw, med, rightN, leftN, xR, xL, crownY, crownS, edgeY, edgeX, oneWay, rev, lanes, dashes, centre, faceX, walkY };
}
// cuánto se corre la calle (en x del entorno) para que el carril ownLane (contado desde el cordón izquierdo, 1..N)
// quede debajo del auto de la toma; 0 o fuera de rango: nada (la calle va donde dice Offset X)
function avenueShift(p) {
  const k = Math.round(p.ownLane || 0); if (k < 1) return 0;
  const xs = avenueLayout(p).lanes.map(l => l.x).sort((a, b) => a - b);
  return k <= xs.length ? -xs[k - 1] : 0;
}
// puertas de planta baja de un edificio que empieza en z y mide w a lo largo de la calle (sin pasar por el rng:
// sumarlas no cambia el tráfico ni los edificios de un seed)
const DOOR_W = 0.9, DOOR_H = 2.1;
function facadeDoors(z, w) { const n = Math.max(1, Math.floor((w - 0.6) / 7)); return Array.from({ length: n }, (_, k) => z + 0.3 + (w - 0.6) * (k + 0.5) / n); }

// ---------- Referencias de escala de la comparación con el 3D ----------
// Un auto de los 70 (sedán): largo, ancho, alto y la cintura (el borde de abajo de las ventanillas).
const GH_CAR = { L: 4.4, W: 1.7, H: 1.42, waist: 0.92 };
const GH_PERSON_H = 1.75;
// carril de la referencia: own (el del auto de la toma), next (el de al lado, del lado elegido), further (uno más
// allá) u other (el de al lado del otro lado). ownX: la x del auto de la toma en coordenadas de la calle.
// Devuelve la x del centro del carril, o null si ese carril no existe.
function ghostLaneX(L, ownX, side, which) {
  if (!L.lanes.length) return null;
  const own = L.lanes.reduce((b, l) => Math.abs(l.x - ownX) < Math.abs(b.x - ownX) ? l : b);
  if (which === 'own') return own.x;
  const s = which === 'other' ? -side : side;
  const out = L.lanes.filter(l => (l.x - own.x) * s > 1e-6).sort((a, b) => (a.x - own.x) * s - (b.x - own.x) * s);
  const k = which === 'further' ? 1 : 0;
  return out[k] ? out[k].x : null;
}
// dónde se para cada referencia (x y el piso), del lado side (+1 derecha, -1 izquierda)
function ghostRefSpot(L, kind, side, lane, ownX) {
  if (kind === 'car') { const x = ghostLaneX(L, ownX, side, lane); return x === null ? null : { x, y: L.crownY(x) }; }
  // la persona, en la vereda a 1.2 m del cordón (o en el medio si la vereda es angosta)
  if (kind === 'person') { const walk = (L.faceX(side) - L.edgeX(side)) * side - 0.5; return { x: L.edgeX(side) + side * Math.min(1.2, Math.max(0.4, walk / 2)), y: L.walkY(side) }; }
  if (kind === 'door') return { x: L.faceX(side) - side * 0.03, y: L.walkY(side) };
  return null;
}
// la z (a lo largo de la calle) donde un punto queda a una distancia d de la cámara sobre el eje óptico, si la
// distancia cambia de forma lineal con z: depth(z) = a + b z. null si la calle corre casi de costado a la cámara.
function ghostZForDepth(a, b, d) { return Math.abs(b) < 0.05 ? null : (d - a) / b; }
