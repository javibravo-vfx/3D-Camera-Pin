// meta-profiles: lectura de la metadata de cámara y lente de un header EXR por PERFILES de fabricante.
// Cada perfil dice, campo por campo, qué clave lee, en qué unidad viene (la que declara la spec) y cómo se
// decodifica. Nada se adivina por el tamaño del número. Las reglas y las fuentes están en docs/METADATA.md.
//
// Resultado de MetaProfiles.read(h):
//   fields[campo] = la candidata elegida { v, key, profile, conf, rank, ... }
//   cands[campo]  = todas las candidatas, ordenadas por precedencia (rank chico primero)
//   warnings      = fuentes que no coinciden y controles cruzados que no cierran (para mostrar)
//   notes         = candidatas descartadas y por qué
// conf: 'declared' (clave y unidad de la spec), 'derived' (calculada de otras: encoder, film back) o
// 'guessed' (heurística de nombres, EXR.lensHints): siempre la última.
//
// Campos y unidades de salida: camera (texto del modelo), lens (texto), rasterW/rasterH (fotositos),
// filmW/filmH (mm), pitchUm (µm), focalMm, focusM (desde el plano de imagen), tStop, fStop, squeeze,
// tiltDeg, rollDeg (convención de la app), fps, shutterS, clip, project (la producción de la pizarra), par, nearM,
// farM, hyperM, hfovDeg.
var MetaProfiles = (() => {
  // ---------------- valores ----------------
  // número de un valor del header: número, texto («3,5», «24 / 1») o racional [a, b]; null si no hay
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && v[1]) return v[0] / v[1];
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(',', '.');
    const r = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (r) return +r[2] ? r[1] / r[2] : null;
    return /^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(s) ? +s : null;
  }
  const text = (v) => typeof v === 'string' && v.trim() ? v.trim() : null;
  const scale = (k) => (v) => { const n = num(v); return n === null ? null : n * k; };

  // T-stop de un anillo con el paso entero y décimas de paso: «2.8 9/10», «2.8+9/10», «T2.8». Las décimas son de
  // PASO (escala logarítmica: cada paso es √2 en T); si el número escrito es un paso nominal (2.8 = 2^1.5) se
  // parte del valor exacto: «2.8 9/10» = 2^((3 + 0.9) / 2) = 3.864. Un número solo vale tal cual. null si no se lee.
  function tRing(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
    const m = typeof v === 'string' && v.trim().replace(',', '.').match(/^T?\s*(\d+(?:\.\d+)?)(?:\s*[+\s]\s*(\d+)\s*\/\s*(\d+))?$/i);
    if (!m) return null;
    const base = +m[1], frac = m[2] !== undefined && +m[3] > 0 ? m[2] / m[3] : 0;
    if (!(base > 0) || frac < 0 || frac >= 1) return null;
    if (!frac) return base;
    const n = 2 * Math.log2(base), full = Math.round(n);
    return Math.pow(2, ((Math.abs(n - full) < 0.1 ? full : n) + frac) / 2);
  }
  // iris de Sony (SMPTE RDD 18): código de 16 bits, T (o f) = 2^(8·(1 − v/65536)). 0x0000–0x6000 es cerrado.
  function sonyIris(v) {
    const n = num(v);
    if (n === null || !Number.isInteger(n) || n <= 0x6000 || n > 0xffff) return null;
    return Math.pow(2, 8 * (1 - n / 65536));
  }
  // raster «5434x3056» dentro de un texto (Baselight: temp_format_5434x3056)
  function rasterText(v) {
    const m = typeof v === 'string' && v.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i);
    return m ? [+m[1], +m[2]] : null;
  }
  // un Box2i (sensorAcquisitionRectangle): ancho y alto en fotositos
  function boxSize(v) {
    return v && typeof v === 'object' && Number.isFinite(v.xMax) && v.xMax > v.xMin ? [v.xMax - v.xMin + 1, v.yMax - v.yMin + 1] : null;
  }

  // ---------------- claves ----------------
  // Nuke agrega exr/, input/ o nuke/ al leer y al escribir: no son parte del nombre
  const strip = (name) => String(name).replace(/^(?:(?:exr|input|nuke)\/)+/i, '');
  // índice: nombre sin prefijo, en minúsculas → atributo
  function index(attrs) {
    return (attrs || []).map(a => ({ name: a.name, low: strip(a.name).toLowerCase(), value: a.value }));
  }
  // la clave tal cual (sin prefijo) o, si la clave trae namespace, terminada en ella («sony/lens/x» acepta «foo/sony/lens/x»)
  function lookup(ix, key) {
    const k = key.toLowerCase();
    return ix.find(a => a.low === k) || (k.includes('/') ? ix.find(a => a.low.endsWith('/' + k)) : null) || null;
  }
  // anyNs: además, la última parte de la clave en cualquier namespace (ARRI cambió la ruta entre versiones de ART)
  function lookupAny(ix, key) {
    const leaf = key.toLowerCase().split('/').pop();
    return lookup(ix, key) || ix.find(a => a.low.endsWith('/' + leaf)) || null;
  }

  // ---------------- perfiles ----------------
  // rank: precedencia (chico gana). 10 encoder del lente, 20 lente según la cámara, 30 estándar OpenEXR,
  // 40 herramientas de color (Baselight), 90 heurística. Cada campo: [campo, clave, decodificador, extra].
  const mmFromUm = scale(1 / 1000), mmFromM = scale(1000), mFromMm = scale(1 / 1000), mFromDmm = scale(1 / 10000);
  const PROFILES = [
    { id: 'cooke', name: 'Cooke /i', rank: 10, fields: [
      ['focalMm', 'cooke/zoom', num],
      ['tStop', 'cooke/aperture_value', num],
      ['tStop', 'cooke/aperture_ring_t_stop', tRing, { rank: 11 }],
      ['hfovDeg', 'cooke/horizontal_field_of_view', num],
      // foco e hiperfocal: la unidad se comprueba con el cerca y el lejos (cookeDistances), no se supone
    ] },
    { id: 'arri', name: 'ARRI', rank: 20, fields: [
      ['camera', 'arriraw/cameraDevice/cameraModel', text],
      ['lens', 'arriraw/lensDevice/lensModel', text],
      ['pitchUm', 'arriraw/sensorPixelPitch', num],
      // focal en µm (SDI Metadata White Paper, LDI04); versiones viejas de ART la escribían en mm: variante conocida
      ['focalMm', 'arriraw/axialNominalFocalLength', (v) => { const n = num(v); return n === null ? null : n > 1000 ? n / 1000 : n; }, { anyNs: true }],
      ['focusM', 'arriraw/focusDistanceMetric', mFromMm, { anyNs: true }],
      // iris: se lee como T × 1000 (lo que la app hacía); la spec (LDI06) dice T = 2^((v/1000 − 1)/2): sin
      // contrastar con un plate ARRI real con iris, queda como estaba (docs/ROADMAP.md)
      ['tStop', 'linearIris', (v) => { const n = num(v); return n === null || n <= 0 ? null : n > 100 ? n / 1000 : n; }, { anyNs: true }],
      ['squeeze', 'arriraw/lensDevice/lensSqueezeFactor', num, { anyNs: true }],
      ['tiltDeg', 'arriraw/tilt', num],
      // el roll de ARRI va al revés que el de la app (SceneMath.rollFromArri, contrastado con plates reales)
      ['rollDeg', 'arriraw/roll', (v) => { const n = num(v); return n === null ? null : -n; }, { file: true }],
      ['clip', 'arriraw/slateInfo/clipName', text, { anyNs: true }],
      // la producción de la pizarra de cámara: VFX Shooting Sup la usa de arranque
      ['project', 'arriraw/slateInfo/productionName', text, { anyNs: true }],
      ['project', 'arriraw/slateInfo/projectName', text, { anyNs: true, rank: 21 }],
      ['shutterS', 'arriraw/exposureTime', num],
    ] },
    { id: 'sony', name: 'Sony', rank: 20, fields: [
      // «MPC-3628 0010104 Version4.00»: el modelo es la primera palabra
      ['camera', 'sony/camera/CameraAttributes', (v) => { const s = text(v); return s ? 'Sony ' + s.split(/\s+/)[0] : null; }],
      ['filmW', 'sony/camera/ImageSensorEffectiveWidth', mmFromUm],
      ['filmH', 'sony/camera/ImageSensorEffectiveHeight', mmFromUm],
      ['focalMm', 'sony/lens/LensZoomActualFocalLength', mmFromM],
      ['focusM', 'sony/lens/FocusPositionFromImagePlane', num],
      ['tStop', 'sony/lens/IrisInTNumber', sonyIris],
      ['fStop', 'sony/lens/IrisInFNumber', sonyIris],
      // inclinómetro: décimas de arcosegundo (1/36000 de grado); el signo, tal cual el archivo (sin confirmar)
      ['tiltDeg', 'sony/posture/CameraTiltAngle', scale(1 / 36000), { file: true }],
      ['rollDeg', 'sony/posture/CameraRollAngle', scale(1 / 36000), { file: true }],
      ['fps', 'sony/camera/CaptureFrameRate', num],
      ['shutterS', 'sony/camera/ShutterSpeedTime', num],
      ['par', 'sony/raw/PixelAspectRatio', num],
    ] },
    { id: 'red', name: 'RED', rank: 20, fields: [
      ['camera', 'r3d/camera_model', (v) => { const s = text(v); return s ? (/^red\b/i.test(s) ? s : 'RED ' + s) : null; }],
    ] },
    { id: 'openexr', name: 'OpenEXR', rank: 30, fields: [
      ['camera', 'cameraModel', null, { camera: true, anyNs: true }],
      ['lens', 'lensModel', null, { lens: true }],
      ['focalMm', 'nominalFocalLength', num],
      ['focalMm', 'effectiveFocalLength', num, { rank: 31 }],
      ['focalMm', 'focalLength', num, { rank: 32 }],
      ['focusM', 'focus', num],
      ['tStop', 'tStop', num],
      ['fStop', 'aperture', num],
      ['pitchUm', 'sensorPhotositePitch', num],
      ['raster', 'sensorAcquisitionRectangle', boxSize, { anyNs: true }],
      ['squeeze', 'lensSqueezeFactor', num, { anyNs: true, rank: 31 }],
      ['fps', 'framesPerSecond', num],
      ['shutterS', 'expTime', num],
      ['clip', 'reelName', text],
      // no son del estándar: los nombres con que otras herramientas escriben la producción
      ['project', 'productionName', text, { anyNs: true, rank: 33 }],
      ['project', 'projectName', text, { anyNs: true, rank: 34 }],
      ['project', 'project', text, { rank: 35 }],
      ['par', 'pixelAspectRatio', num],
    ] },
    { id: 'filmlight', name: 'Baselight', rank: 40, fields: [
      ['raster', 'uk.ltd.filmlight.InputFormat', rasterText],
      ['clip', 'uk.ltd.filmlight.Clip', text],
    ] },
  ];

  // rango plausible después de decodificar: lo que cae afuera se descarta (con nota), nunca se reescala
  const RANGE = {
    focalMm: [4, 1500], focusM: [0.2, 1000], tStop: [0.7, 64], fStop: [0.5, 64], squeeze: [1, 3], pitchUm: [0.5, 20],
    filmW: [1, 80], filmH: [1, 80], tiltDeg: [-90, 90], rollDeg: [-180, 180], fps: [1, 1000], shutterS: [1e-5, 2],
    par: [0.25, 4], nearM: [0.01, 1e5], farM: [0.01, 1e6], hyperM: [0.1, 1e6], hfovDeg: [0.5, 180],
  };
  // cuánto pueden diferir dos fuentes del mismo campo antes de avisar (relativo, o absoluto en grados)
  const TOL = { focalMm: 0.03, focusM: 0.1, tStop: 0.06, fStop: 0.06, filmW: 0.01, tiltDeg: 0.5, rollDeg: 0.5 };

  const fmt = (n, d = 2) => Number.isFinite(n) ? (+n.toFixed(d)).toString() : '–';
  const UNIT = { focalMm: ' mm', focusM: ' m', filmW: ' mm', filmH: ' mm', tiltDeg: '°', rollDeg: '°', nearM: ' m', farM: ' m' };
  const LABEL = { focalMm: 'focal', focusM: 'focus', tStop: 'T-stop', fStop: 'f-stop', tiltDeg: 'tilt', rollDeg: 'roll', filmW: 'film back width' };
  const show = (f, v) => (f === 'tStop' ? 'T' : f === 'fStop' ? 'f/' : '') + fmt(v, f === 'tiltDeg' || f === 'rollDeg' ? 2 : 2) + (UNIT[f] || '');

  // Cooke /i: las distancias se llaman todas *_mm pero no vienen todas en mm. Visto: foco e hiperfocal (enteros) en
  // mm y cerca / lejos (decimales) en cm. Con sólo el cerca y el lejos hay dos lecturas que cierran (todo ×10 o ÷10),
  // así que la unidad se elige por la ÚNICA combinación que cumple las dos cosas:
  //   1. el foco cae entre el cerca y el lejos (son la profundidad de campo alrededor de él);
  //   2. la hiperfocal da un círculo de confusión de lente real: c = f² / (N · H) entre 0,004 y 0,05 mm
  //      (con la focal y el T del mismo lente).
  // Si no hay con qué comprobar, o cierra más de una o ninguna, el foco de Cooke no se usa (queda la nota).
  const COOKE_UNITS = [ // [foco e hiperfocal, cerca y lejos] en metros por unidad
    [1e-3, 1e-2, 'mm / cm'], [1e-3, 1e-3, 'mm'], [1e-4, 1e-3, '1/10 mm / mm'], [1e-4, 1e-4, '1/10 mm'],
  ];
  function cookeDistances(ix, focalMm, tStop, notes) {
    const g = (k) => { const a = lookup(ix, k); return a ? { a, v: num(a.value) } : null; };
    const f = g('cooke/focus_distance_mm'), h = g('cooke/hyperfocal_setting_mm'), n = g('cooke/near_focus_distance_mm'), fa = g('cooke/far_focus_distance_mm');
    if (!f || !(f.v > 0)) return [];
    if (!(n && fa && n.v > 0 && fa.v > n.v)) { notes.push(`${f.a.name}: not used, no near / far depth of field in the file to check its unit`); return []; }
    const coc = (k) => h && h.v > 0 && focalMm > 0 && tStop > 0 ? focalMm * focalMm / (tStop * h.v * k * 1000) : null;
    const fits = COOKE_UNITS.filter(([kf, kn]) => {
      const s = f.v * kf;
      if (!(s >= n.v * kn * 0.98 && s <= fa.v * kn * 1.02)) return false;
      const c = coc(kf);
      return c !== null && c >= 0.004 && c <= 0.05;
    });
    if (fits.length !== 1) {
      notes.push(`${f.a.name}: not used, ` + (!coc(1) ? 'no hyperfocal, focal and T-stop to check its unit' : fits.length ? 'more than one unit fits the depth of field' : 'no unit fits the near / far focus and the hyperfocal'));
      return [];
    }
    const [kf, kn, unit] = fits[0], c = { profile: 'cooke', conf: 'derived', rank: 10, unit };
    const out = [{ ...c, field: 'focusM', v: f.v * kf, key: f.a.name }, { ...c, field: 'nearM', v: n.v * kn, key: n.a.name }, { ...c, field: 'farM', v: fa.v * kn, key: fa.a.name }];
    if (h && h.v > 0) out.push({ ...c, field: 'hyperM', v: h.v * kf, key: h.a.name });
    return out;
  }

  // ---------------- encoders ----------------
  // Interpolación de la posición cruda de un anillo con los extremos DECLARADOS en la metadata. Escala del anillo:
  // 'stops' (iris: lineal en pasos, log2 de T), 'diopter' (foco: lineal en 1/distancia, infinito = 0) o 'linear'
  // (zoom sin tabla: lo menos fiable). Con una tabla de calibración [[posición, valor], ...] se interpola por tramos.
  // null si falta un extremo o la posición se sale de ellos.
  function interpolate(pos, lo, hi, vLo, vHi, ring = 'linear') {
    if (![pos, lo, hi].every(Number.isFinite) || hi === lo) return null;
    const t = (pos - lo) / (hi - lo);
    if (t < -1e-9 || t > 1 + 1e-9) return null;
    if (ring === 'stops') return vLo > 0 && vHi > 0 ? Math.pow(2, Math.log2(vLo) + t * (Math.log2(vHi) - Math.log2(vLo))) : null;
    if (ring === 'diopter') {
      const d = (v) => v === Infinity ? 0 : v > 0 ? 1 / v : NaN, dl = d(vLo), dh = d(vHi), x = dl + t * (dh - dl);
      return Number.isFinite(x) ? (x > 0 ? 1 / x : Infinity) : null;
    }
    return Number.isFinite(vLo) && Number.isFinite(vHi) ? vLo + t * (vHi - vLo) : null;
  }
  function interpolateTable(pos, table) {
    if (!Number.isFinite(pos) || !Array.isArray(table) || table.length < 2) return null;
    const p = table.slice().sort((a, b) => a[0] - b[0]);
    if (pos < p[0][0] || pos > p[p.length - 1][0]) return null;
    for (let i = 1; i < p.length; i++) if (pos <= p[i][0]) return p[i - 1][1] + (pos - p[i - 1][0]) / (p[i][0] - p[i - 1][0]) * (p[i][1] - p[i - 1][1]);
    return null;
  }
  // Encoders declarados por sistema: { field, profile, pos, lo, hi, vLo, vHi, ring } con las claves de cada uno.
  // Vacío hasta tener un header real de cada sistema de motores (tools/exr-meta.mjs); los extremos nunca se suponen.
  const ENCODERS = [];
  function encoderCands(ix, encoders) {
    const out = [];
    for (const e of encoders) {
      const g = (k) => { if (typeof k === 'number') return k; const a = k && lookup(ix, k); return a ? num(a.value) : null; };
      const pos = g(e.pos), v = e.table ? interpolateTable(pos, e.table) : interpolate(pos, g(e.lo), g(e.hi), g(e.vLo), g(e.vHi), e.ring);
      // rank 85: después de todo valor directo (sólo se usa si no hay uno) y antes de la heurística de nombres
      if (v !== null && Number.isFinite(v)) out.push({ field: e.field, v, key: e.pos, profile: e.profile, conf: 'derived', rank: e.rank || 85, encoder: true });
    }
    return out;
  }

  // ---------------- lectura ----------------
  function read(h, opts = {}) {
    const ix = index(h && h.attrs), cands = {}, notes = [], warnings = [];
    const add = (c) => {
      const r = RANGE[c.field];
      if (r && typeof c.v === 'number' && !(c.v >= r[0] && c.v <= r[1])) { notes.push(`${c.key}: ${fmt(c.v, 4)} is out of range for ${LABEL[c.field] || c.field}, not used`); return; }
      const list = cands[c.field] = cands[c.field] || [];
      if (list.some(o => o.key === c.key)) return; // la heurística a veces encuentra la misma clave que un perfil
      if (c.conf === 'guessed' && list.some(o => o.v === c.v)) return; // o el mismo valor por otro camino: no suma nada
      list.push(c);
    };
    for (const p of PROFILES) for (const [field, key, dec, x = {}] of p.fields) {
      const a = x.anyNs ? lookupAny(ix, key) : lookup(ix, key);
      if (!a) continue;
      const base = { key: a.name, profile: p.id, conf: 'declared', rank: x.rank || p.rank };
      if (x.camera) { // OpenEXR: cameraMake + cameraModel
        const model = text(a.value), make = text((lookup(ix, 'cameraMake') || {}).value);
        if (model) add({ ...base, field, v: make && !model.toLowerCase().startsWith(make.toLowerCase()) ? make + ' ' + model : model });
        continue;
      }
      if (x.lens) { const s = [text((lookup(ix, 'lensMake') || {}).value), text(a.value)].filter(Boolean).join(' '); if (s) add({ ...base, field, v: s }); continue; }
      const v = dec(a.value);
      if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) continue;
      if (field === 'raster') { add({ ...base, field: 'rasterW', v: v[0] }); add({ ...base, field: 'rasterH', v: v[1] }); continue; }
      add({ ...base, field, v, ...(x.file ? { file: num(a.value) } : {}) });
    }
    // la focal y el T del lente (ya leídos) sirven para comprobar la unidad de las distancias de Cooke
    const best = (k) => (cands[k] || []).slice().sort((x, y) => x.rank - y.rank)[0];
    for (const c of cookeDistances(ix, best('focalMm') && best('focalMm').v, best('tStop') && best('tStop').v, notes)) add(c);
    const near = (cands.nearM || [])[0], far = (cands.farM || [])[0];
    for (const c of encoderCands(ix, opts.encoders || ENCODERS)) add(c);
    // heurística de nombres (EXR.lensHints): siempre la última
    const hint = opts.hint || {};
    if (hint.focal) add({ field: 'focalMm', v: hint.focal, key: hint.focalKey, profile: 'hint', conf: 'guessed', rank: 90 });
    if (hint.camera) add({ field: 'camera', v: hint.camera, key: 'camera name', profile: 'hint', conf: 'guessed', rank: 90 });
    if (hint.lens) add({ field: 'lens', v: hint.lens, key: 'lensMake / lensModel', profile: 'hint', conf: 'guessed', rank: 90 });
    if (hint.orient) for (const [k, f] of [['tilt', 'tiltDeg'], ['roll', 'rollDeg']]) if (hint.orient[k]) add({ field: f, v: hint.orient[k].v, key: hint.orient[k].key, profile: 'hint', conf: 'guessed', rank: 90 });
    if (hint.orient && hint.orient.yaw) add({ field: 'yawDeg', v: hint.orient.yaw.v, key: hint.orient.yaw.key, profile: 'hint', conf: 'guessed', rank: 90 });

    const fields = {};
    for (const f of Object.keys(cands)) { cands[f].sort((a, b) => a.rank - b.rank); fields[f] = cands[f][0]; }

    // fuentes que no coinciden: se usa la de mayor precedencia y se avisa con las dos
    for (const [f, tol] of Object.entries(TOL)) {
      const cs = cands[f]; if (!cs || cs.length < 2) continue;
      const use = cs[0];
      for (const o of cs.slice(1)) {
        if (o.conf === 'guessed') continue;
        const abs = f === 'tiltDeg' || f === 'rollDeg', d = abs ? o.v - use.v : o.v / use.v - 1;
        if (Math.abs(d) > tol) warnings.push({ field: f, text: `${LABEL[f] || f}: ${show(f, use.v)} from ${use.key}, but ${show(f, o.v)} from ${o.key} (${abs ? (d > 0 ? '+' : '') + fmt(d, 2) + '°' : (d > 0 ? '+' : '') + fmt(d * 100, 1) + ' %'})`, use, other: o });
      }
    }
    // controles cruzados
    const F = (k) => fields[k] && fields[k].v;
    if (F('tStop') > 0 && F('fStop') > 0 && F('tStop') < F('fStop') * 0.98)
      warnings.push({ field: 'tStop', text: `T-stop T${fmt(F('tStop'))} is lower than the f-stop f/${fmt(F('fStop'))}: one of them is wrong` });
    // focal contra el campo visual que informa el lente, sobre el ancho del film back de la metadata
    if (F('hfovDeg') > 0 && F('filmW') > 0 && F('focalMm') > 0) {
      const fov = F('filmW') / (2 * Math.tan(F('hfovDeg') * Math.PI / 360)), d = F('focalMm') / fov - 1;
      if (Math.abs(d) > 0.05) warnings.push({ field: 'focalMm', text: `focal ${fmt(F('focalMm'))} mm does not match the lens field of view (${fmt(F('hfovDeg'), 1)}° on ${fmt(F('filmW'))} mm gives ${fmt(fov, 1)} mm, ${d > 0 ? '+' : ''}${fmt(d * 100, 1)} %)` });
    }
    // foco fuera de la profundidad de campo que informa el lente
    if (F('focusM') > 0 && near && far && fields.focusM.profile !== 'cooke' && (F('focusM') < near.v * 0.98 || F('focusM') > far.v * 1.02))
      warnings.push({ field: 'focusM', text: `focus ${fmt(F('focusM'))} m is outside the lens depth of field (${fmt(near.v)} to ${fmt(far.v)} m)` });
    return { fields, cands, warnings, notes };
  }

  // claves que se leen fuera de la tabla de perfiles (cookeDistances), para tools/exr-meta.mjs
  const SPECIAL = ['cooke/focus_distance_mm', 'cooke/hyperfocal_setting_mm', 'cooke/near_focus_distance_mm', 'cooke/far_focus_distance_mm', 'cameraMake', 'lensMake'];
  return { read, num, tRing, sonyIris, rasterText, strip, interpolate, interpolateTable, PROFILES, SPECIAL, RANGE, TOL, ENCODERS };
})();
globalThis.MetaProfiles = MetaProfiles;
