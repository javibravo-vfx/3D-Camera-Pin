// bokeh-math: única fuente de la fórmula de bokeh. Port 1:1 de src/core/BokehMath.* y
// src/core/NukeClipboard.* de DepthLab (gizmo Refs/bokeh_visualizer_v01.nk, lente delgada):
//   M = f / (s - f)   A = f / N   blur_mm = M * A * |d - s| / d   blur_px = blur_mm * plateW / sensorW
// Distancias de escena en metros, lente y sensor en mm. Todos los tamaños son DIÁMETROS en px del
// plate; el Defocus de Nuke recibe el RADIO (diámetro / 2).
// lens = { focalMm, fNumber }   camera = { sensorWidthMm, squeeze, plateWidthPx }
var BokehMath = (() => {
  const MIN_DISTANCE_M = 0.0001;  // el max(0.1 mm, ...) del gizmo

  const pixelsPerMm = cam => cam.sensorWidthMm > 0 ? cam.plateWidthPx / cam.sensorWidthMm : NaN;
  const focusIsValid = (lens, focusM) => lens.focalMm > 0 && lens.fNumber > 0 && focusM * 1000 > lens.focalMm;

  function cocMm(lens, focusM, distM) {
    if (!focusIsValid(lens, focusM)) return NaN;
    const s = focusM * 1000, f = lens.focalMm;
    const ma = f / (s - f) * (f / lens.fNumber);
    if (distM === Infinity) return ma;
    const d = Math.max(MIN_DISTANCE_M, distM) * 1000;
    return ma * Math.abs(d - s) / d;
  }
  const cocPx = (lens, cam, focusM, distM) => cocMm(lens, focusM, distM) * pixelsPerMm(cam);
  const infinityCocPx = (lens, cam, focusM) => cocPx(lens, cam, focusM, Infinity);

  const angleOfViewDeg = (lens, cam) =>
    lens.focalMm > 0 ? 2 * Math.atan(cam.sensorWidthMm / (2 * lens.focalMm)) * 180 / Math.PI : NaN;
  const verticalAngleOfViewDeg = (lens, sensorHeightMm) =>
    lens.focalMm > 0 && sensorHeightMm > 0 ? 2 * Math.atan(sensorHeightMm / (2 * lens.focalMm)) * 180 / Math.PI : NaN;

  function kFactor(lens, cam, focusM, cocPxValue) {
    const c = cocPxValue / pixelsPerMm(cam), s = focusM * 1000, f = lens.focalMm;
    return c * lens.fNumber * (s - f) / (f * f);
  }

  // Zona nítida: donde el bokeh queda por debajo de maxCocPx (px del plate). farM puede ser Infinity.
  function dofLimits(lens, cam, focusM, maxCocPx) {
    if (!focusIsValid(lens, focusM) || !(maxCocPx > 0)) return { nearM: NaN, farM: NaN };
    const k = kFactor(lens, cam, focusM, maxCocPx);
    return { nearM: focusM / (1 + k), farM: k < 1 ? focusM / (1 - k) : Infinity };
  }

  function hyperfocalM(lens, cam, maxCocPx) {
    const c = maxCocPx / pixelsPerMm(cam);
    if (!(c > 0) || lens.fNumber <= 0) return NaN;
    return (lens.focalMm * lens.focalMm / (lens.fNumber * c) + lens.focalMm) / 1000;
  }

  // Inversa: distancia de un objeto cuyo bokeh mide cocPx (diámetro). null si no hay solución
  // (detrás del foco no la hay si el bokeh es mayor que el del infinito).
  function solveDistanceM(lens, cam, focusM, cocPxValue, behindFocus) {
    if (!focusIsValid(lens, focusM) || !(cocPxValue >= 0)) return null;
    const k = kFactor(lens, cam, focusM, cocPxValue);
    if (!Number.isFinite(k)) return null;
    if (behindFocus) return k >= 1 ? null : focusM / (1 - k);
    return focusM / (1 + k);
  }

  // Eje de distancia del overlay y del riel. range = { minM, maxM }.
  const AxisMode = { Linear: 0, Log: 1, Diopter: 2 };
  function axisToNorm(mode, range, distM) {
    const lo = Math.max(1e-6, range.minM);
    if (mode === AxisMode.Linear) return distM === Infinity ? Infinity : distM / Math.max(1e-9, range.maxM);
    if (mode === AxisMode.Log) {
      if (distM === Infinity) return Infinity;
      const hi = Math.max(lo * 1.0001, range.maxM);
      return Math.log(Math.max(1e-9, distM) / lo) / Math.log(hi / lo);
    }
    if (mode === AxisMode.Diopter) {
      const inv = distM === Infinity ? 0 : 1 / Math.max(1e-9, distM);
      return (1 / lo - inv) * lo;
    }
    return NaN;
  }
  function normToAxis(mode, range, t) {
    const lo = Math.max(1e-6, range.minM);
    if (mode === AxisMode.Linear) return t * range.maxM;
    if (mode === AxisMode.Log) return lo * Math.pow(Math.max(lo * 1.0001, range.maxM) / lo, t);
    if (mode === AxisMode.Diopter) return t >= 1 ? Infinity : 1 / ((1 - t) / lo);
    return NaN;
  }

  // --- Portapapeles de Nuke (NukeClipboard.cpp) ---
  function nukeSafeName(text) {
    let out = String(text).trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!out) out = 'probe';
    if (/^[0-9]/.test(out)) out = '_' + out;
    return out;
  }
  // Nodo Defocus para pegar con Ctrl+V. radiusPx es RADIO (quien llama pasa diámetro / 2).
  function defocusNodeText(radiusPx, nameSuffix, label) {
    // Nuke evalúa TCL dentro de las comillas: [ ] y $ van escapados para que salgan literales.
    const esc = String(label).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]').replace(/\$/g, '\\$').replace(/\n/g, '\\n');
    // "version 14.0 v1" a propósito: un header más viejo pega igual en versiones nuevas.
    return 'set cut_paste_input [stack 0]\nversion 14.0 v1\npush $cut_paste_input\nDefocus {\n' +
      ` defocus ${radiusPx.toFixed(2)}\n name Defocus_${nukeSafeName(nameSuffix)}\n label "${esc}"\n selected true\n}\n`;
  }

  return {
    MIN_DISTANCE_M, AxisMode, pixelsPerMm, focusIsValid, cocMm, cocPx, infinityCocPx, angleOfViewDeg,
    verticalAngleOfViewDeg, dofLimits, hyperfocalM, solveDistanceM, axisToNorm, normToAxis,
    nukeSafeName, defocusNodeText,
  };
})();
globalThis.BokehMath = BokehMath;  // en Node (tests) el archivo se importa como módulo
