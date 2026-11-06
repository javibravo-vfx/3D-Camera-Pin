// slate-math: Slate solve. Estima la focal de una toma a partir de un objeto de tamaño conocido
// parado en el plano de foco (la claqueta antes de la acción, o una persona en un plano general) y de
// la distancia de foco grabada en el metadata.
//
// Tres pasos, siempre en el mismo eje (ancho con ancho, alto con alto):
//   h_sensor = objeto_px * sensor_mm / plate_px     tamaño del objeto en el sensor (mm)
//   m        = h_sensor / tamaño_real                magnificación
//   f        = m * d / (1 + m)^2                     lente delgada, d = foco medido desde el sensor
//
// Las dos versiones simples, para comparar (la diferencia crece en los close ups):
//   pinhole  f = m * d            focal efectiva a ese foco (la de una Camera de Nuke, gizmo
//                                 FindYourCamAOVandFocal); da de más: 7,7 % con 35 mm a 1 m
//   nodal    f = m * d / (1 + m)  cuando d se mide desde el punto nodal del lente
//
// La inversa (con la focal conocida) da la distancia de un objeto de tamaño conocido, o cuántos px
// tendría que ocupar en el plate: sirve de chequeo cruzado.
//
// Unidades: tamaño real y distancias en metros, sensor y focal en mm, objeto y plate en px.
// Todo lo que no se puede calcular devuelve null (nunca NaN suelto).
var SlateMath = (() => {
  const pos = v => typeof v === 'number' && Number.isFinite(v) && v > 0;

  // tamaño del objeto en el sensor (mm)
  const sensorSizeMm = (objectPx, sensorMm, platePx) =>
    pos(objectPx) && pos(sensorMm) && pos(platePx) ? objectPx * sensorMm / platePx : null;

  // magnificación: tamaño en el sensor / tamaño real (los dos en mm)
  const magnification = (sizeOnSensorMm, realSizeM) =>
    pos(sizeOnSensorMm) && pos(realSizeM) ? sizeOnSensorMm / (realSizeM * 1000) : null;

  const focalThinLensMm = (m, focusM) => pos(m) && pos(focusM) ? m * focusM * 1000 / ((1 + m) * (1 + m)) : null;
  const focalPinholeMm = (m, focusM) => pos(m) && pos(focusM) ? m * focusM * 1000 : null;
  const focalNodalMm = (m, focusM) => pos(m) && pos(focusM) ? m * focusM * 1000 / (1 + m) : null;

  // Largo de un segmento dibujado sobre el plate, en px del eje vertical, para una línea en cualquier
  // ángulo (la claqueta casi nunca está derecha). En anamórfico lo horizontal viene apretado: se
  // desaprieta con el pixel aspect (par). Va con sensorMm = ancho del film back y platePx = ancho del
  // plate, que tienen la misma escala mm/px que el eje vertical (como K() en js/intrinsics.js).
  const segmentPx = (dxPx, dyPx, par = 1) =>
    Number.isFinite(dxPx) && Number.isFinite(dyPx) && pos(par) && (dxPx || dyPx) ? Math.hypot(dxPx * par, dyPx) : null;

  // Todo junto. p = { objectPx, realSizeM, focusM, sensorMm, platePx }
  // (sensorMm y platePx del mismo eje que objectPx). Devuelve null si falta algo.
  function solve(p) {
    const h = sensorSizeMm(p.objectPx, p.sensorMm, p.platePx);
    const m = magnification(h, p.realSizeM);
    if (m === null || !pos(p.focusM)) return null;
    const focalMm = focalThinLensMm(m, p.focusM), pinholeMm = focalPinholeMm(m, p.focusM);
    return {
      sensorSizeMm: h,
      magnification: m,
      focalMm,                                 // la que se propone (lente delgada)
      pinholeMm,
      nodalMm: focalNodalMm(m, p.focusM),
      pinholeExcess: pinholeMm / focalMm - 1,  // cuánto da de más la pinhole (0.077 = 7,7 %)
    };
  }

  // Inversa de la lente delgada: magnificación de un objeto en foco a focusM con la focal focalMm.
  // f = m d / (1 + m)^2  ->  f m^2 + (2f - d) m + f = 0; la raíz chica es la del objeto delante del lente.
  // Sin solución si el foco está a menos de 4 focales (ahí no hay imagen real a esa distancia).
  function magnificationFromFocal(focalMm, focusM) {
    if (!pos(focalMm) || !pos(focusM)) return null;
    const d = focusM * 1000, b = d - 2 * focalMm, disc = b * b - 4 * focalMm * focalMm;
    if (b <= 0 || disc < 0) return null;
    return (b - Math.sqrt(disc)) / (2 * focalMm);
  }

  // Cuántos px del plate tendría que ocupar un objeto de realSizeM en foco a focusM con esa focal.
  function expectedObjectPx(focalMm, focusM, realSizeM, sensorMm, platePx) {
    const m = magnificationFromFocal(focalMm, focusM);
    return m !== null && pos(realSizeM) && pos(sensorMm) && pos(platePx)
      ? m * realSizeM * 1000 * platePx / sensorMm : null;
  }

  // Distancia (m, desde el sensor) de un objeto de tamaño conocido, con la focal conocida:
  // d = f (1 + m)^2 / m.
  function distanceM(focalMm, realSizeM, objectPx, sensorMm, platePx) {
    const m = magnification(sensorSizeMm(objectPx, sensorMm, platePx), realSizeM);
    return m !== null && pos(focalMm) ? focalMm * (1 + m) * (1 + m) / m / 1000 : null;
  }

  return {
    segmentPx, sensorSizeMm, magnification, focalThinLensMm, focalPinholeMm, focalNodalMm,
    solve, magnificationFromFocal, expectedObjectPx, distanceM,
  };
})();
globalThis.SlateMath = SlateMath;
