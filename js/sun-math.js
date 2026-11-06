// Posición del sol (3D Render), como las calculadoras de sol (suncalc.org): con la latitud, la longitud y el
// momento en UTC da la altura sobre el horizonte y el azimut (desde el norte, en el sentido de las agujas del reloj).
// Fórmulas de posición solar de baja precisión de "Astronomy Answers" (las mismas que usa la librería suncalc);
// alcanzan de sobra para una luz de render (error del orden de 0,1°). Sin refracción atmosférica.
// También: pasar del azimut del sol a la dirección en el mundo de la app, que no tiene norte: el usuario dice hacia
// qué rumbo apunta la calle (el −Z del mundo, hacia donde va el auto de la toma).
// Script clásico: sus funciones quedan en el ámbito global (y tests/test_sun.mjs las lee con vm).
const SUN_RAD = Math.PI / 180, SUN_DAY_MS = 86400000, SUN_J1970 = 2440588, SUN_J2000 = 2451545, SUN_E = SUN_RAD * 23.4397;
const sunDays = (ms) => ms / SUN_DAY_MS - 0.5 + SUN_J1970 - SUN_J2000;
function sunCoords(d) {
  const M = SUN_RAD * (357.5291 + 0.98560028 * d);
  const C = SUN_RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + SUN_RAD * 102.9372 + Math.PI; // longitud eclíptica
  return { dec: Math.asin(Math.sin(SUN_E) * Math.sin(L)), ra: Math.atan2(Math.sin(L) * Math.cos(SUN_E), Math.cos(L)) };
}
// ms: momento en UTC (Date.getTime()). Devuelve grados: el (altura, negativa bajo el horizonte) y az (0 = norte, 90 = este)
function sunPosition(ms, lat, lon) {
  const d = sunDays(ms), c = sunCoords(d), phi = SUN_RAD * lat;
  const H = SUN_RAD * (280.16 + 360.9856235 * d) + SUN_RAD * lon - c.ra; // ángulo horario
  const el = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi)); // desde el sur, hacia el oeste
  return { el: el / SUN_RAD, az: ((azS / SUN_RAD + 180) % 360 + 360) % 360 };
}
// fecha 'YYYY-MM-DD', hora 'HH:MM' locales y el desfasaje con UTC en horas (Argentina: −3) → ms en UTC
function sunUTC(date, time, utcOff) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || ''), t = /^(\d{1,2}):(\d{2})/.exec(time || '');
  if (!m || !t) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) - (+utcOff || 0) * 3600000;
}
// dirección hacia el sol en el mundo de la app (Y arriba): heading es el rumbo (0 = norte, 90 = este) hacia donde
// apunta el −Z del mundo; un rumbo a la derecha de ése (en sentido horario, visto desde arriba) cae hacia +X
function sunWorldDir(az, el, heading) {
  const d = (az - heading) * SUN_RAD, e = el * SUN_RAD;
  return [Math.cos(e) * Math.sin(d), Math.sin(e), -Math.cos(e) * Math.cos(d)];
}
// al revés: de una dirección en el mundo al azimut y la altura (para las herramientas que mueven el sol a mano)
function sunFromWorld(x, y, z, heading) {
  const h = Math.hypot(x, z), el = Math.atan2(y, h) / SUN_RAD;
  const az = ((Math.atan2(x, -z) / SUN_RAD + heading) % 360 + 360) % 360;
  return { az, el };
}
// El sol en un HDRI equirectangular (3D Render): u de 0 a 1 de izquierda a derecha en la imagen del archivo, el (altura)
// en grados (la fila del medio es el horizonte). La app lo gira corriendo columnas: con un giro rot (grados), la
// columna u del archivo cae en la u − rot/360 de la textura, y three.js lee una textura equirectangular con
// u = atan2(z, x) / 2π + 0,5 (con rot 0 el centro de la imagen es el +X del mundo).
// del punto del HDRI al sol (azimut y altura), con el giro del HDRI y el rumbo de la calle
function sunFromHdri(u, el, rot, heading) {
  const phi = (u - rot / 360 - 0.5) * 2 * Math.PI, e = el * SUN_RAD;
  return sunFromWorld(Math.cos(e) * Math.cos(phi), Math.sin(e), Math.cos(e) * Math.sin(phi), heading);
}
// al revés: dónde cae el sol en la imagen del HDRI (u de 0 a 1, el en grados)
function sunToHdri(az, el, rot, heading) {
  const d = sunWorldDir(az, el, heading), ut = Math.atan2(d[2], d[0]) / (2 * Math.PI) + 0.5;
  return { u: (((ut + rot / 360) % 1) + 1) % 1, el };
}
// el giro del HDRI (de −180 a 180) que pone su punto u en el azimut az: el sol trabado al HDRI que se mueve a mano
function sunHdriRot(u, az, heading) {
  const d = sunWorldDir(az, 0, heading), ut = Math.atan2(d[2], d[0]) / (2 * Math.PI) + 0.5;
  const r = (((u - ut) * 360 % 360) + 540) % 360 - 180;
  return r === -180 ? 180 : r;
}
// un link de Google Maps (o "lat, lon" escrito) → { lat, lon } o null
function sunParseLocation(s) {
  s = String(s || '').trim(); if (!s) return null;
  const ok = (a, b) => { const lat = +a, lon = +b; return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null; };
  const num = '(-?\\d+(?:\\.\\d+)?)';
  const pats = [new RegExp('!3d' + num + '!4d' + num), new RegExp('@' + num + ',' + num), new RegExp('[?&](?:q|ll|query|center|destination)=' + num + '(?:,|%2C)\\s*' + num, 'i'),
    new RegExp('^' + num + '\\s*[,; ]\\s*' + num + '$')];
  for (const p of pats) { const m = p.exec(s); if (m) { const r = ok(m[1], m[2]); if (r) return r; } }
  return null;
}
