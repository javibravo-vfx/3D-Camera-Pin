// setreport: reportes de set de LGA Shot Docs (el ZIP de Export o el .md de una página) -> planos con su
// cámara (cuerpo, modo, lente, altura, tilt, roll, foco, T-stop) y cámaras de los arrays de BG (lente,
// altura, ángulo respecto del auto). El formato sale del código de Shot Docs (C:\PORTABLE\LGA_ShotDocs):
// - src/export/archiveHtml.ts (pageMarkdown): cada página es `# título` + blocksToMarkdownLossy de
//   BlockNote (remark-gfm): tablas GFM con la PRIMERA FILA COMO ENCABEZADO aunque sea una ficha de dos
//   columnas, viñetas "* ", casillas "* [x] ", cada "_" del texto escapado como "\_".
// - src/templates/builtin.en.ts / builtin.es.ts: On-Set Report (Camera package, Setups & takes con
//   columnas combinadas "Height · Tilt", Measurements "What | Value | Notes"), Shot Breakdown (ficha).
// - Docs/Doc_Exportar.md 2.3: una carpeta por página con su .md, más _shotdocs/manifest.json.
// No hay plantilla de arrays en Shot Docs: un array se reconoce por una columna o un renglón de ángulo.
// Parte pura (SetReport, sin DOM: la usan los tests de Node) y panel (sr*, sólo en la página).
var SetReport = (() => {
  // ---------- texto ----------
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', apos: "'" };
  function clean(s) {
    return String(s || '')
      .replace(/[​﻿]/g, '').replace(/\\\s*$/, '') // espacios de ancho cero y el salto de renglón "\" de BlockNote
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // fotos
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links: el texto
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&(amp|lt|gt|quot|nbsp|apos);/g, (_, k) => ENT[k])
      .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\s)\*(\S.*?)\*/g, '$1$2')
      .replace(/\\([\\`*_{}[\]()#+\-.!|~<>"'])/g, '$1')
      .replace(/\s+/g, ' ').trim();
  }
  // partes de una celda o valor combinado ("1.20 m · -4°", "T2.8 / 2.4 m", "40mm<br>ND.6")
  const parts = (s) => String(s).split(/\s*(?:·|•|\||;|<br\s*\/?>|\s\/\s)\s*/i).map(x => x.trim()).filter(Boolean);

  // ---------- qué es cada rótulo (inglés y castellano, sin tildes) ----------
  const ROLES = {
    slate: ['slate', 'claqueta', 'sc shot setup', 'esc plano setup'],
    scene: ['scene', 'sc', 'escena', 'esc', 'scn'],
    shot: ['shot', 'plano', 'shot id', 'vfx shot', 'plano vfx', 'shot name', 'shot code', 'sht'],
    desc: ['descripcion del plano', 'descripcion', 'description', 'shot description'],
    setup: ['setup', 'set up'],
    cam: ['cam', 'camera', 'camara', 'cam id', 'name', 'nombre', 'array cam', 'camera position', 'position', 'posicion', 'rig'],
    body: ['body', 'cuerpo', 'camera body', 'cuerpo de camara', 'model', 'modelo', 'camera model'],
    mode: ['sensor mode', 'modo de sensor', 'mode', 'modo', 'resolution', 'resolucion', 'format', 'formato', 'recording format'],
    lens: ['lens', 'lente', 'lens mm', 'focal', 'focal length', 'distancia focal', 'objetivo', 'optica', 'lens focal'],
    lensSet: ['lens set', 'juego de lentes', 'lens series', 'serie de lentes'],
    filters: ['filters', 'filtros', 'filter', 'filtro'],
    tstop: ['t stop', 'tstop', 'stop', 't', 'iris', 'diafragma', 'aperture', 'apertura', 'f stop'],
    focus: ['focus', 'foco', 'focus distance', 'distancia de foco', 'distancia foco'],
    subject: ['camera to subject', 'cam to subject', 'distance to subject', 'subject distance', 'distance', 'distancia',
      'distancia al sujeto', 'camara a sujeto', 'distancia a sujeto', 'camera to car', 'distancia al auto', 'distance to car'],
    height: ['height', 'altura', 'lens height', 'altura de lente', 'altura del lente', 'camera height', 'altura de camara',
      'cam height', 'altura camara', 'alto'],
    tilt: ['tilt', 'inclinacion', 'pitch', 'tilt angle', 'angulo vertical', 'cabeceo'],
    roll: ['roll', 'dutch', 'rolido', 'alabeo', 'roll angle'],
    // "Pan" no dice desde dónde se mide (en algunos reportes es "Pan a caja"): se guarda aparte y no se aplica
    pan: ['pan', 'pan a caja', 'paneo'],
    yaw: ['yaw', 'angle', 'angulo', 'mount angle', 'angulo de montaje', 'montaje', 'orientation', 'orientacion',
      'heading', 'direccion', 'looks to', 'mira hacia', 'mira a', 'facing', 'camera angle', 'angulo de camara'],
    fps: ['fps', 'frame rate'],
    shutter: ['shutter', 'shutter angle', 'obturador', 'angulo de obturacion'],
    notes: ['notes', 'notas', 'nota', 'note', 'observaciones', 'comments', 'comentarios'],
  };
  const SYN = new Map(); for (const [r, l] of Object.entries(ROLES)) for (const s of l) SYN.set(s, r);
  const BY_LEN = [...SYN.keys()].filter(s => s.length >= 4).sort((a, b) => b.length - a.length);
  // rol de un rótulo: exacto; si no, el sinónimo más largo que aparece como palabras enteras (rótulos cortos)
  function roleOf(label) {
    const n = norm(label); if (!n) return null;
    if (SYN.has(n)) return SYN.get(n);
    if (/^(camara|cam) [a-z]$/.test(n)) return null; // "Cámara A: 32mm grip capot": renglón de plano (planoGroups)
    if (n.split(' ').length > 4) return null;
    const s = BY_LEN.find(x => (' ' + n + ' ').includes(' ' + x + ' '));
    return s ? SYN.get(s) : null;
  }
  // un encabezado puede llevar varios datos ("Height · Tilt") y la unidad entre paréntesis ("Height (cm)")
  function headerRoles(h) {
    const unit = (/\((mm|cm|m|ft|in)\)/i.exec(h) || [])[1];
    const roles = parts(String(h).replace(/\([^)]*\)/g, ' ')).map(roleOf);
    return { roles, unit: unit ? unit.toLowerCase() : null };
  }
  const CAMERA_ROLES = ['lens', 'height', 'tilt', 'roll', 'focus', 'tstop', 'subject', 'body'];

  // ---------- valores escritos a mano ----------
  const NUM = /[-+−]?\d+(?:[.,]\d+)?|[-+−]?[.,]\d+/;
  const toNum = (t) => parseFloat(t.replace('−', '-').replace(',', '.'));
  function num(s) { const m = NUM.exec(String(s || '')); return m ? toNum(m[0]) : null; }
  const LEN_UNITS = { mm: 0.001, cm: 0.01, m: 1, mt: 1, mts: 1, metro: 1, metros: 1, meter: 1, meters: 1, metre: 1, metres: 1 };
  // metros; "1,20 m", "120 cm", "4' 6\"", "12 ft", "48 in". Sin unidad: hint, o m (más de 20, cm)
  function lengthM(s, hint) {
    const t = String(s || '').replace(/[’′]/g, "'").replace(/[”″]|''/g, '"');
    let m = /(\d+(?:[.,]\d+)?)\s*(?:'|ft\b|feet\b|foot\b|pies?\b)\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|in\b|inch(?:es)?\b|pulgadas?\b)?)?/i.exec(t);
    if (m) return toNum(m[1]) * 0.3048 + (m[2] ? toNum(m[2]) * 0.0254 : 0);
    m = /(\d+(?:[.,]\d+)?)\s*(?:"|in\b|inch(?:es)?\b|pulgadas?\b)/i.exec(t);
    if (m) return toNum(m[1]) * 0.0254;
    m = /(\d+(?:[.,]\d+)?)\s*(mm|cm|mts?|metros?|meters?|metres?|m)\b/i.exec(t);
    if (m) return toNum(m[1]) * LEN_UNITS[m[2].toLowerCase()];
    const v = num(t); if (v == null) return null;
    if (hint) return v * (hint === 'ft' ? 0.3048 : hint === 'in' ? 0.0254 : LEN_UNITS[hint] || 1);
    return v > 20 ? v / 100 : v;
  }
  const hasLenUnit = (s) => /\d\s*(?:mm|cm|m|mts?|metros?|meters?|metres?|ft|feet|foot|pies?|in|inch(?:es)?|pulgadas?)\b|\d\s*['’′"”″]/i.test(String(s || ''));
  // grados; "-5°", "5° abajo" (negativo: mira para abajo), "tilt -2,5"
  function angleDeg(s) {
    const t = String(s || ''), v = num(t); if (v == null) return null;
    const n = norm(t);
    if (/\b(down|abajo|picado|hacia abajo)\b/.test(n)) return -Math.abs(v);
    if (/\b(up|arriba|contrapicado|hacia arriba)\b/.test(n)) return Math.abs(v);
    return v;
  }
  const wrap = (a) => { const r = ((a + 180) % 360 + 360) % 360 - 180; return r === -180 ? 180 : r; };
  const sideOf = (n) => /\b(izq\w*|left|l)\b/.test(n) ? 1 : /\b(der|derech\w*|right|r)\b/.test(n) ? -1 : 0;
  const nameSide = (name) => { const n = norm(name).replace(/\s/g, ''); return /(izq|izquierd|left)$/.test(n) || /^(izq|left)/.test(n) ? 1 : /(der|derech\w*|right)$/.test(n) ? -1 : 0; };
  // yaw de una cámara respecto del auto, con la convención del driving plate: 0 frente, 90 izquierda,
  // 180 atrás, -90 derecha. "90° der" -> -90; "135° left" -> 135; "frente"; "3/4 rear left" -> 135.
  // Un número sin signo ni lado toma el lado del nombre (ArrayDer + "90" -> -90).
  function yawDeg(s, name) {
    const t = String(s || ''), n = norm(t);
    const v = /3\s*\/\s*4/.test(t) ? null : num(t);
    let side = sideOf(n);
    if (v != null) {
      if ((/([-+−]?)\d/.exec(t) || [])[1]) return wrap(v); // con signo manda el número
      if (!side) side = nameSide(name);
      return wrap(side ? side * Math.abs(v) : v);
    }
    const front = /\b(front|frente|frontal|adelante|delantera?|forward)\b/.test(n), rear = /\b(rear|back|atras|trasera?|detras|behind)\b/.test(n);
    if (!side && !front && !rear) return null;
    if (!side) return front ? 0 : 180;
    return side * (front ? 45 : rear ? 135 : 90);
  }
  // lente en mm; "50mm", "Zeiss SP 50mm T1.5", "Zoom 24-290 @ 35mm", "lente 85". Un zoom sin @ no se sabe.
  function focalMm(s) {
    const t = String(s || '');
    let m = /@\s*(\d+(?:[.,]\d+)?)/.exec(t);
    if (!m) { const mm = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-\s*\d+(?:[.,]\d+)?\s*)?mm\b/gi)].find(x => !/-/.test(x[0])); m = mm || null; }
    if (!m && !/\d\s*-\s*\d/.test(t)) m = NUM.exec(t.replace(/\b[tf]\s*\/?\s*\d+(?:[.,]\d+)?/gi, ' '));
    const v = m ? toNum(m[1] || m[0]) : null;
    return v >= 4 && v <= 2000 ? v : null;
  }
  // T-stop; "T2.8", "T 2,8", "f/4", "2.8"
  function tStop(s) {
    const t = String(s || ''), m = /\b[tf]\s*\/?\s*(\d+(?:[.,]\d+)?)/i.exec(t);
    const v = m ? toNum(m[1]) : num(t);
    return v >= 0.5 && v <= 64 ? v : null;
  }
  // escena y plano de un nombre: los dos últimos grupos de 2 a 4 dígitos seguidos (XMPL_000_305_010 -> 305, 010)
  function shotKey(s) {
    const tok = String(s || '').replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\d{1,2}:\d{2}(:\d{2})*/g, ' ').split(/[^0-9a-z]+/i);
    const ok = (x) => /^\d{2,4}[a-z]?$/i.test(x);
    for (let i = tok.length - 2; i >= 0; i--) if (ok(tok[i]) && ok(tok[i + 1])) return { scene: tok[i].toUpperCase(), shot: tok[i + 1].toUpperCase() };
    return null;
  }
  // claqueta "305 · 010 · A", "Esc 310 / Pl 010 / A", o un id entero
  function slate(s) {
    const p = parts(s);
    if (p.length >= 2 && /\d/.test(p[0]) && /\d/.test(p[1])) {
      const d = (x) => (/\d+[a-z]?\b/i.exec(x) || [''])[0].toUpperCase();
      const k = shotKey(s);
      return { scene: d(p[0]), shot: d(p[1]), setup: p[2] ? p[2].replace(/^(setup|set up)\s*/i, '') : '', ...(k && p[0].includes('_') ? k : {}) };
    }
    const k = shotKey(s); if (k) return { ...k, setup: '' };
    const n = /(\d{2,4}[a-z]?)\b/i.exec(s); return n ? { shot: n[1].toUpperCase() } : null;
  }
  const sameNum = (a, b) => { const x = /^0*(\d+)([a-z]?)$/i.exec(a || ''), y = /^0*(\d+)([a-z]?)$/i.exec(b || ''); return !!x && !!y && +x[1] === +y[1] && x[2].toLowerCase() === y[2].toLowerCase(); };
  // los planos cuyo número aparece en un nombre de archivo (XMPL_000_305_030_aPlate_v01.1001.exr -> 305_030)
  function matchName(name, shots) {
    const tok = String(name || '').split(/[^0-9a-z]+/i);
    return shots.filter(r => r.scene && r.shot && tok.some((t, i) => sameNum(t, r.scene) && sameNum(tok[i + 1], r.shot)));
  }
  const BODY_RE = /alexa|amira|venice|burano|\bfx\d|\bf5[45]\b|\bf65\b|\bred\b|komodo|raptor|monstro|helium|canon|\bc70\b|c[35]00|blackmagic|bmpcc|ursa|pocket|iphone|panavision|dxl|varicam|\barri\b/i;

  // ---------- Markdown de Shot Docs -> páginas con tablas y renglones "Rótulo: valor" ----------
  const isSep = (l) => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/(?<!\\)\|\s*$/, '').split(/(?<!\\)\|/).map(clean);
  function parseMd(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const page = { title: '', sections: [] };
    let sec = { heading: '', level: 0, kv: [], tables: [], lines: [] }; page.sections.push(sec);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const h = /^(#{1,6})\s+(.*)$/.exec(l);
      if (h) {
        if (h[1].length === 1 && !page.title) { page.title = clean(h[2]); continue; }
        sec = { heading: clean(h[2]), level: h[1].length, kv: [], tables: [], lines: [] }; page.sections.push(sec); continue;
      }
      if (/^\s*\|/.test(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const rows = [cells(l)]; i += 1;
        while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) rows.push(cells(lines[++i]));
        sec.tables.push(rows); continue;
      }
      if (/^\s*>/.test(l)) continue; // notas del export y comentarios
      const t = clean(l.replace(/^\s*(?:[*+-]|\d+\.)\s+(?:\[[ xX]\]\s*)?/, ''));
      if (t && !/^[-*_\s]+$/.test(t)) sec.lines.push(t);
      const m = /^([^:=]{1,40}?)\s*[:=]\s*(.+)$/.exec(t);
      if (m && m[1].split(/\s+/).length <= 5) sec.kv.push([m[1], m[2]]);
    }
    return page;
  }
  const GENERIC = new Set(['what', 'que', 'item', 'field', 'campo', 'dato', 'medida', 'measure', 'measurement', 'label', 'rotulo']);
  // asigna un valor (quizás combinado) a sus roles: primero las partes con rótulo propio ("tilt -6°"), después en orden
  function assign(roles, value, out, unit) {
    const v = String(value || '').trim(); if (!v) return;
    const rs = roles.filter(Boolean); if (!rs.length) return;
    const put = (r, x) => { if (r && x && out[r] == null) { out[r] = x; if (unit && !out._unit) out._unit = {}; if (unit) out._unit[r] = unit; } };
    if (new Set(rs).size === 1 && rs.length === roles.length) return put(rs[0], v); // "Sensor mode · Resolution": un solo dato
    const rest = [];
    for (const p of parts(v)) {
      const k = /^([a-z\u00c0-\u024f][a-z\u00c0-\u024f .-]*?)\s*[:=]?\s*([-+−]?\d.*)$/i.exec(p), r = k && roleOf(k[1]);
      if (r && r !== 'slate' && out[r] == null) put(r, k[2]); else rest.push(p);
    }
    // el resto por posición de columna; un rol ya puesto por su rótulo no consume parte
    let j = 0; for (const r of roles) if (!(r && out[r] != null)) put(r, rest[j++]);
  }
  // un renglón (de tabla o de "Rótulo: valor") -> objeto { rol: texto }
  function kvObject(pairs) {
    const o = {};
    for (const [label, value] of pairs) { const { roles, unit } = headerRoles(label); assign(roles, value, o, unit); }
    return o;
  }
  function tableKind(rows) {
    const H = rows[0].map(headerRoles), has = (r) => H.some(h => h.roles.includes(r));
    const nc = rows[0].length;
    if (nc === 2 && !roleOf(rows[0][1])) return { kind: 'kv', body: rows };
    if (nc >= 2 && nc <= 3 && GENERIC.has(norm(rows[0][0]))) return { kind: 'kv', body: rows.slice(1) };
    // con PAN en vez de ángulo: es de array si alguna fila nombra un array (la planilla de cámara de los BG)
    if (has('yaw') || (has('pan') && rows.slice(1).some(r => /\barray/i.test(r.join(' '))))) return { kind: 'array', H };
    if ((has('slate') || has('shot') || has('scene')) && CAMERA_ROLES.some(has)) return { kind: 'shot', H };
    if (has('cam') && (has('body') || has('mode'))) return { kind: 'package', H };
    return { kind: 'other' };
  }
  const rowObject = (H, row) => { const o = {}; H.forEach((h, i) => assign(h.roles, row[i], o, h.unit)); return o; };

  // ---------- registros ----------
  function record(o, ctx, warn, isArray) {
    const u = o._unit || {}, label = ctx.label;
    const r = { page: ctx.page, raw: {} };
    for (const k of Object.keys(o)) if (k !== '_unit') r.raw[k] = o[k];
    const len = (k) => {
      if (o[k] == null) return null;
      const v = lengthM(o[k], u[k]);
      if (v == null) warn(`${label}: ${k} "${o[k]}" not understood`);
      else if (!u[k] && !hasLenUnit(o[k])) warn(`${label}: ${k} "${o[k]}" has no unit, read as ${v === num(o[k]) ? 'm' : 'cm'}`);
      return v == null ? null : +v.toFixed(4);
    };
    const val = (k, f) => { if (o[k] == null) return null; const v = f(o[k]); if (v == null) warn(`${label}: ${k} "${o[k]}" not understood`); return v; };
    let cam = o.cam || '', body = o.body || '';
    if (cam && !body && BODY_RE.test(cam)) { body = cam; cam = ''; }
    Object.assign(r, {
      cam, body, mode: o.mode || '', lens: o.lens || '',
      focalMm: val('lens', focalMm), tStop: val('tstop', tStop), focusM: len('focus'), subjectM: len('subject'),
      heightM: len('height'), tiltDeg: val('tilt', angleDeg), rollDeg: val('roll', angleDeg), fps: o.fps != null ? num(o.fps) : null,
      notes: [o.notes, o.filters && 'filters ' + o.filters].filter(Boolean).join(' · '), desc: o.desc || '',
      panDeg: val('pan', angleDeg),
    });
    if (isArray) r.yawDeg = val('yaw', (s) => yawDeg(s, cam || ctx.name));
    else r.yawDeg = o.yaw != null ? val('yaw', angleDeg) : null;
    if (isArray && r.yawDeg == null && r.panDeg != null) {
      // el PAN de la planilla de cámara de los arrays (grillas como XMPL_000_305_ArrayDer_Toma2: el PAN con el diagrama
      // del rig): 0 = mirando para atrás del auto, + = paneo a la derecha (horario visto de arriba). En la
      // convención del driving (0 frente, 90 izquierda): yaw = 180 - pan.
      r.yawDeg = wrap(180 - r.panDeg);
      warn(`${label}: pan ${r.panDeg}° read as the camera sheet's (0 = looking back, + = pan right): yaw ${+r.yawDeg.toFixed(2)}°, check it`);
    } else if (r.panDeg != null) warn(`${label}: pan ${r.panDeg}° does not say from where it is measured: set Looks to / yaw by hand`);
    return r;
  }
  // ---------- reportes del día como los escribe Lega: títulos de escena y plano, renglones a mano ----------
  //   # Escena 205                        ## 205 plano 3_32               * **Cámara A:** 32mm grip capot auto
  //   # Escena 205 Array Derecha          ## 205 planos 1, 2 y 3          Toma 2 / Con burbuja / … [+X 1m]
  //   # Escena 205 | INT/EXT Día | …      ### Plano 02 | PP 3/4 frontal acompañante:   * Opción A | 32mm | alt 1.25m
  // La altura, el pan y el tilt de cada toma van "En planilla de cámara" (una hoja de Google aparte), no acá.
  const PLANO_H = /^0*(\d{1,4}[a-z]*)\s+planos?\s+(.+)$/i, PLAN_H = /^plano\s+0*(\d+[a-z]?)\s*\|\s*(.*?)\s*:?$/i;
  const CAM_LINE = /^(?:c[aá]mara|cam)\s+([a-z])\b\s*:?\s*(.*)$/i;
  // lente de un renglón: los "NNmm" que no son el destino ("para 50mm", "resize a 50mm") ni el de antes ("viene de 28mm")
  function lensOf(text) {
    const all = [];
    for (const m of String(text).matchAll(/(\d+(?:[.,]\d+)?)\s*(-\s*\d+(?:[.,]\d+)?\s*)?mm\b/gi)) {
      if (m[2]) continue; // zoom sin la focal usada
      if (/(?:para|resize a|viene de|\bde|from|for)\s*$/i.test(String(text).slice(Math.max(0, m.index - 16), m.index))) continue;
      all.push(toNum(m[1]));
    }
    return { focal: all.length ? all[all.length - 1] : null, all };
  }
  const sideName = (s) => { const n = norm(s); return /^(der|derech|right)/.test(n) ? 'ArrayDer' : /^(izq|izquierd|left)/.test(n) ? 'ArrayIzq' : 'Array' + String(s).charAt(0).toUpperCase() + String(s).slice(1); };
  function planoGroups(pg, title, warn) {
    const out = { shots: [], arrays: [], plans: [] };
    let scene = '', side = '', grp = null; const groups = [];
    for (const sec of pg.sections) {
      const e = /\bescena\s+0*(\d+[a-z]*)/i.exec(sec.heading);
      if (e && (!grp || sec.level <= grp.level)) { scene = e[1]; const a = /\barray\s+(\S+)/i.exec(sec.heading); side = a ? sideName(a[1]) : ''; }
      const m = sec.level >= 2 && PLANO_H.exec(sec.heading), p = !m && sec.level >= 2 && PLAN_H.exec(sec.heading);
      // "## 05B plano 2" bajo "# Escena 305B": un dígito comido al tipear; vale la escena del título
      let gs = m ? m[1] : scene;
      if (m && scene && norm(gs) !== norm(scene) && norm(scene).endsWith(norm(gs))) { warn(`"${sec.heading}" is under "Escena ${scene}": read as ${scene} plano ${m[2]}`); gs = scene; }
      if (m || p) { grp = { scene: gs, side, id: m ? m[2] : p[1], title: p ? p[2] : '', level: sec.level, secs: [sec] }; groups.push(grp); sec.inGroup = true; continue; }
      if (grp && sec.level > grp.level) { grp.secs.push(sec); sec.inGroup = true; } else grp = null;
    }
    let sheet = false;
    for (const g of groups) {
      const lines = g.secs.flatMap(s => s.lines), key = `${g.scene} plano ${g.id}`;
      const d = lines.map(t => /^descripci[oó]n del plano\s*:\s*(.+)$/i.exec(t)).find(Boolean);
      const desc = g.title || (d ? d[1].replace(/^descripci[oó]n del plano\s*:\s*/i, '') : '');
      if (lines.some(t => /planilla de c[aá]mara/i.test(t))) sheet = true;
      const tomas = [];
      for (const s of g.secs) { let cur = null; for (const t of s.lines) { const k = /^toma\s*(\d+)\b\s*(.*)$/i.exec(t); if (k) { cur = { n: +k[1], note: k[2] }; tomas.push(cur); } else if (cur && !/:$/.test(t)) cur.note = [cur.note, t].filter(Boolean).join(' · '); } }
      const options = lines.filter(t => /\d\s*mm\b/i.test(t) && /\balt(ura)?\b/i.test(t)).map(t => {
        const ps = parts(t), f = ps.find(x => /\d\s*mm\b/i.test(x)), h = ps.find(x => /^alt/i.test(x)), o = /opci[oó]n\s+(\w+)/i.exec(t);
        return { label: o ? o[1] : '', focalMm: f ? focalMm(f) : null, heightM: h ? lengthM(h.replace(/^alt(ura)?\.?\s*/i, '')) : null };
      });
      if (g.side) {
        // un array filma varios planos a la vez: una cámara por plano (el reporte nombra los planos, no las cámaras)
        for (const n of g.id.split(/\s*(?:,|\by\b|\band\b|&)\s*/i).map(x => x.trim()).filter(Boolean)) {
          out.arrays.push({ name: `${g.side} · plano ${n}`, side: g.side, plano: n, scene: g.scene, group: `${g.side} (${title})`, desc, tomas, page: title, raw: {},
            cam: '', body: '', mode: '', lens: '', focalMm: null, tStop: null, focusM: null, subjectM: null, heightM: null, tiltDeg: null, rollDeg: null, yawDeg: null, panDeg: null, fps: null, notes: '', shots: [] });
          warn(`${g.side} · plano ${n} (${title}): lens, height and mount angle are not in the report (camera sheet)`);
        }
        continue;
      }
      const cams = lines.map(t => CAM_LINE.exec(t)).filter(c => c && c[2].trim());
      if (!cams.length) { if (options.length) out.plans.push({ scene: g.scene, plano: g.id, desc, options, page: title }); continue; }
      for (const c of cams) {
        const L = lensOf(c[2]), letter = c[1].toUpperCase(), label = key + (cams.length > 1 ? ' ' + letter : '');
        if (L.focal == null) warn(`${label}: lens not written ("${c[2]}")`);
        else if (L.all.length > 1) warn(`${label}: several lenses in "${c[2]}", using ${L.focal} mm`);
        out.shots.push({ key, scene: g.scene, shot: g.id, setup: cams.length > 1 ? letter : '', plano: true, page: title, raw: { camera: c[0] },
          cam: letter, body: '', mode: '', lens: c[2], focalMm: L.focal, tStop: null, focusM: null, subjectM: null,
          heightM: null, tiltDeg: null, rollDeg: null, yawDeg: null, panDeg: null, fps: null, notes: c[2], desc, arrays: [] });
      }
    }
    if (sheet) warn(`${title}: height, pan and tilt of each take are in the camera sheet (planilla de cámara), not in Shot Docs`);
    return out;
  }
  function parsePage(text, file, warn) {
    const pg = parseMd(text), title = pg.title || String(file || '').replace(/^.*\//, '').replace(/\.md$/i, '');
    const pl = planoGroups(pg, title, warn);
    const out = { title, shots: pl.shots, arrays: pl.arrays, plans: pl.plans, pkgs: {} }, loose = [];
    const titleKey = shotKey(title), titleScene = (/\b(?:escena|scene|sc)\s*(\d+[a-z]?)/i.exec(title) || /^(\d{2,4}[a-z]?)\b/.exec(title) || [])[1];
    const idOf = (o, heading) => {
      const s = (o.slate && slate(o.slate)) || (o.shot && slate(o.shot)) || shotKey(heading) || titleKey || {};
      const scene = s.scene || (o.scene && (/\d+[a-z]?/i.exec(o.scene) || [''])[0].toUpperCase()) || titleScene || '';
      return { scene, shot: s.shot || '', setup: (o.setup || s.setup || '').trim() };
    };
    const addShot = (o, heading, n) => {
      const id = idOf(o, heading), key = id.scene && id.shot ? `${id.scene}_${id.shot}` : id.shot || id.scene || title;
      const label = key + (id.setup ? ' ' + id.setup : '') + (n ? ` (row ${n})` : '');
      out.shots.push({ key, ...id, ...record(o, { page: title, label }, warn) });
    };
    const addArray = (o, heading) => {
      const name = o.cam && !BODY_RE.test(o.cam) ? o.cam : heading || o.cam || 'Camera';
      const group = heading && heading !== name ? `${title} · ${heading}` : title;
      out.arrays.push({ name, group, scene: titleKey ? titleKey.scene : titleScene || '', ...record(o, { page: title, label: `${group} ${name}`, name }, warn, true) });
    };
    for (const sec of pg.sections) {
      if (sec.inGroup) continue;
      const kvPairs = sec.kv.slice();
      for (const rows of sec.tables) {
        const t = tableKind(rows);
        if (t.kind === 'kv') { for (const r of t.body) if (r[0] && r[1]) kvPairs.push([r[0], r[1]]); continue; }
        if (t.kind === 'other') continue;
        rows.slice(1).forEach((row, i) => {
          if (!row.some(Boolean)) return;
          const o = rowObject(t.H, row);
          if (t.kind === 'package') { const c = norm(o.cam); if (c && (o.body || o.mode)) out.pkgs[c] = { body: o.body || '', mode: o.mode || '' }; }
          else if (t.kind === 'array') addArray(o, sec.heading);
          else if (CAMERA_ROLES.some(k => o[k] != null)) addShot(o, sec.heading, i + 1);
        });
      }
      if (!kvPairs.length) continue;
      const o = kvObject(kvPairs);
      if ((o.yaw != null || (o.pan != null && /\barray/i.test((sec.heading || '') + ' ' + (o.cam || '')))) && (o.lens != null || o.height != null)) addArray(o, sec.heading);
      else if (CAMERA_ROLES.some(k => o[k] != null)) {
        if (o.slate || o.shot || shotKey(sec.heading)) addShot(o, sec.heading);
        else loose.push([o, sec.heading]); // medidas sin plano: valen sólo si la página tiene uno
      }
    }
    for (const [o, heading] of loose) {
      if (!out.shots.length) addShot(o, heading);
      else if (out.shots.length === 1) { const r = record(o, { page: title, label: out.shots[0].key }, warn); for (const k of Object.keys(r)) if (out.shots[0][k] == null || out.shots[0][k] === '') out.shots[0][k] = r[k]; Object.assign(out.shots[0].raw, r.raw, out.shots[0].raw); }
      else warn(`${title}: ${heading || 'page'} values are not tied to one shot (${out.shots.length} on the page), not used`);
    }
    return out;
  }
  // archivos (.md) -> { shots, arrays, warnings }. El cuerpo y el modo de "Cam A" salen del Camera package.
  function parseFiles(files) {
    const warnings = [], warn = (w) => { if (!warnings.includes(w)) warnings.push(w); };
    const pages = files.filter(f => /\.(md|markdown)$/i.test(f.name) && !/(^|\/)_shotdocs\//.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name)).map(f => parsePage(f.text, f.name, warn));
    const all = {}; pages.forEach(p => Object.entries(p.pkgs).forEach(([k, v]) => { if (!all[k]) all[k] = v; }));
    const shots = [], arrays = [];
    for (const p of pages) {
      for (const s of p.shots) {
        const c = norm(parts(s.cam)[0] || s.cam), pk = c && (p.pkgs[c] || all[c]);
        if (pk) { if (!s.body) s.body = pk.body; if (!s.mode) s.mode = pk.mode; }
        shots.push(s);
      }
      arrays.push(...p.arrays);
    }
    // planos de un reporte del día <-> plan (opciones de lente y altura) y cámaras del array, por escena y número de plano
    const plans = pages.flatMap(p => p.plans || []), base = (id) => (/^\d+/.exec(id) || [''])[0];
    const sameScene = (a, b) => sameNum(a, b) || norm(a) === norm(b);
    for (const s of shots.filter(x => x.plano)) {
      const n = base(s.shot), pl = n && plans.find(x => sameScene(x.scene, s.scene) && sameNum(x.plano, n));
      if (pl) {
        s.plan = `${pl.page}: plano ${pl.plano}${pl.desc ? ' · ' + pl.desc : ''} · ` + pl.options.map(o => [o.label, o.focalMm && o.focalMm + ' mm', o.heightM && o.heightM + ' m'].filter(Boolean).join(' ')).join(' / ');
        const hs = [...new Set(pl.options.map(o => o.heightM).filter(v => v != null))];
        const o = pl.options.find(x => x.focalMm != null && x.focalMm === s.focalMm && x.heightM != null);
        const h = o ? o.heightM : hs.length === 1 ? hs[0] : null;
        if (h != null) {
          s.heightM = h; s.heightSrc = 'plan';
          warn(`${s.key}${s.setup ? ' ' + s.setup : ''}: height ${h} m is the planned one (${pl.page}, plano ${pl.plano}${o ? ', option ' + (o.label || o.focalMm + ' mm') : ', lens ' + (s.focalMm || '?') + ' mm not in the plan'}), not measured`);
        }
      }
      for (const a of arrays) if (a.plano && sameScene(a.scene, s.scene) && sameNum(a.plano, n)) { s.arrays.push(a.name); if (!a.shots.includes(s.key)) a.shots.push(s.key); }
    }
    // el plan da el lente y la altura del plano de croma, no los de la cámara del array (ArrayDer plano 2: plan 32 mm
    // a 1.25 m, grilla del array 21 mm a 1.20 m): se muestra, no se usa
    for (const a of arrays.filter(x => x.plano)) {
      const pl = plans.find(x => sameScene(x.scene, a.scene) && sameNum(x.plano, a.plano)); if (!pl) continue;
      if (pl.desc) a.desc = pl.desc + (a.desc ? ' · ' + a.desc : '');
      a.plan = `${pl.page}: FG ` + pl.options.map(o => [o.label, o.focalMm && o.focalMm + ' mm', o.heightM && o.heightM + ' m'].filter(Boolean).join(' ')).join(' / ');
    }
    return { shots, arrays, warnings, pages: pages.map(p => p.title) };
  }

  // ---------- ZIP (sin comprimir o deflate, con Zip64: el de Shot Docs y uno rearmado con el Explorador) ----------
  // Se lee por partes (read(desde, hasta) -> Promise<Uint8Array>): el export de una escena con sus fotos pesa cientos de MB
  // y sólo hacen falta el índice del final y los .md.
  async function readZip(size, read) {
    const tailAt = Math.max(0, size - 65557 - 20), tail = await read(tailAt, size), tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not a ZIP file');
    let count = tv.getUint16(e + 10, true), cdSize = tv.getUint32(e + 12, true), cd = tv.getUint32(e + 16, true);
    if ((cd === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) && e >= 20 && tv.getUint32(e - 20, true) === 0x07064b50) {
      const z = Number(tv.getBigUint64(e - 12, true)), zb = await read(z, z + 56), zv = new DataView(zb.buffer, zb.byteOffset, zb.byteLength);
      count = Number(zv.getBigUint64(32, true)); cdSize = Number(zv.getBigUint64(40, true)); cd = Number(zv.getBigUint64(48, true));
    }
    const u8 = await read(cd, cd + cdSize), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const td = new TextDecoder(), out = [];
    for (let k = 0, p = 0; k < count && p + 46 <= u8.length && dv.getUint32(p, true) === 0x02014b50; k++) {
      const method = dv.getUint16(p + 10, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      let csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true), off = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      for (let x = p + 46 + nlen, xe = x + xlen; x + 4 <= xe; x += 4 + dv.getUint16(x + 2, true)) {
        if (dv.getUint16(x, true) !== 1) continue;
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (off === 0xffffffff) off = Number(dv.getBigUint64(q, true));
      }
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      out.push({ name, method, read: async () => {
        const h = await read(off, off + 30), hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
        const start = off + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
        return read(start, start + csize);
      } });
    }
    return out;
  }
  // un .zip o un .md -> { shots, arrays, warnings, pages }. read: ver readZip; inflateRaw para un zip con deflate.
  async function parseFile(name, size, read, inflateRaw) {
    const td = new TextDecoder(), head = await read(0, Math.min(size, 4));
    if (head[0] === 0x50 && head[1] === 0x4b) {
      const files = [], zip = await readZip(size, read);
      // un .xlsx es un ZIP con XML: la planilla de cámara (Camera report)
      if (zip.some(f => f.name === 'xl/workbook.xml')) {
        const x = {};
        for (const f of zip.filter(f => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name))) {
          const raw = await f.read(), d = f.method === 0 ? raw : f.method === 8 && inflateRaw ? inflateRaw(raw) : null;
          if (d) x[f.name] = td.decode(d);
        }
        const r = parseCameraReport(readXlsx(x));
        // otra planilla (el ensayo de cámara de las puestas con el auto): se avisa, no es un error
        if (!r.takes.length) throw Object.assign(new Error('not a camera report sheet (no ESC, PLANO, TOMA, REEL, CLIP columns), not used'), { soft: true });
        return { shots: [], arrays: [], pages: [], ...r };
      }
      for (const f of zip.filter(f => /\.(md|markdown)$/i.test(f.name) && !/(^|\/)_shotdocs\//.test(f.name))) {
        const raw = await f.read(), d = f.method === 0 ? raw : f.method === 8 && inflateRaw ? inflateRaw(raw) : null;
        if (d) files.push({ name: f.name, text: td.decode(d) });
      }
      if (!files.length) throw new Error('no Markdown pages inside (export the ZIP from Shot Docs)');
      return parseFiles(files);
    }
    return parseFiles([{ name: /\.(md|markdown)$/i.test(name) ? name : name + '.md', text: td.decode(await read(0, size)) }]);
  }
  // lo mismo con todo el archivo en memoria (tests, fixtures)
  const parseBytes = (name, bytes, inflateRaw) => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return parseFile(name, u8.length, async (a, b) => u8.subarray(a, b), inflateRaw);
  };
  // Sin número de plano en el nombre del plate: el plano cuya descripción se parece al nombre (XMPL_000_205_020_PPAcompanante34
  // -> "PP 3/4 perfil Acompañante"). Misma escena, gana por palabras en común; empate o nada en común: null. Es una sugerencia.
  const SIZE_SYN = { pc: 'conjunto', twoshot: 'conjunto', two: 'conjunto', ps: 'conjunto' };
  function suggestByName(name, shots) {
    const words = String(name || '').replace(/\.[a-z0-9]+$/i, '').split(/[^0-9a-z]+/i)
      .flatMap(t => t.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+/g) || []).map(t => t.toLowerCase());
    const joined = words.join(' ').replace(/\btwo shot\b/g, 'twoshot').split(' ');
    const want = new Set(joined.map(t => SIZE_SYN[t] || t)
      .filter(t => t.length >= 2 && (!/^\d+$/.test(t) || t === '34') && !/^(v\d*|a?plate|bplate|denoised|alpha|exr|comp|input|editref)$/.test(t)));
    let best = null, top = 0, tie = false;
    for (const s of shots) {
      if (!s.scene || !words.some(t => sameNum(t, s.scene))) continue;
      const d = norm((s.desc || '') + ' ' + (s.notes || '')).replace(/\b3 4\b/g, '34').split(' ');
      const score = [...want].filter(t => d.includes(t) || (t.length >= 3 && d.some(w => w.length >= 4 && w.startsWith(t)))).length;
      if (score > top) { best = s; top = score; tie = false; } else if (score === top && score > 0 && best && best.key !== s.key) tie = true;
    }
    return top > 0 && !tie ? best : null;
  }
  // ---------- grillas de planeamiento del array (en el _input del plano VFX) ----------
  // XMPL_000_205_ArrayDer_Toma2_AcoFrontal_21mmf_from_32mm_Grilla.png -> escena 205, ArrayDer, toma 2, "AcoFrontal",
  // lente del array 21 mm, plate de croma 32 mm. La altura, el pan y el tilt están dibujados en la imagen, no en el nombre.
  function gridName(name) {
    const b = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '');
    const a = /(?:^|_)array([a-z]+)_toma\s*(\d+)(?:_(.*))?$/i.exec(b); if (!a) return null;
    const sc = /(?:^|_)0*(\d{2,4}[a-z]?)_array/i.exec(b), rest = a[3] || '';
    // "from_32mm" y también "from_28" (las del array izquierdo no llevan mm)
    const f = /(?:^|_)(\d+(?:[.,]\d+)?)\s*mm\s*f?(?=_|$)/i.exec(rest), fg = /from_(\d+(?:[.,]\d+)?)\s*(?:mm)?(?=_|$)/i.exec(rest);
    const desc = rest.split('_').filter(t => t && !/\d\s*mm/i.test(t) && !/^\d+$/.test(t) && !/^(from|fg|grilla|grid|plate|v\d+)$/i.test(t)).join(' ');
    return { file: b, scene: sc ? sc[1].toUpperCase() : '', side: sideName(a[1]), toma: +a[2], desc, focalMm: f ? toNum(f[1]) : null, fgFocalMm: fg ? toNum(fg[1]) : null };
  }
  // las grillas en el reporte: cada una a su cámara de array (lado, escena y el plano de croma con el lente del "from",
  // o la descripción), con su lente y su toma. Devuelve cuántas se usaron; lo que no se decide va a warnings.
  function applyGrids(R, names) {
    let used = 0; const warn = (w) => { if (!R.warnings.includes(w)) R.warnings.push(w); };
    for (const n of names) {
      const g = gridName(n); if (!g) continue;
      const cands = R.arrays.filter(a => a.side === g.side && (!g.scene || !a.scene || sameNum(a.scene, g.scene)));
      const fgOf = (a) => R.shots.filter(s => (a.shots || []).includes(s.key) && g.fgFocalMm != null && s.focalMm === g.fgFocalMm);
      let hit = cands.filter(a => fgOf(a).length);
      if (hit.length !== 1) {
        const toks = (g.desc.match(/[A-Z]?[a-z]+|\d+/g) || []).map(t => t.toLowerCase()).filter(t => t.length >= 3);
        const sc = (a) => toks.filter(t => norm(a.desc || '').split(' ').some(w => w.startsWith(t))).length;
        const top = Math.max(0, ...cands.map(sc)); hit = top ? cands.filter(a => sc(a) === top) : cands.length === 1 ? cands : [];
      }
      if (hit.length !== 1) { warn(`${g.file}: no single ${g.side} camera of scene ${g.scene || '?'} for this grid (${hit.length || cands.length} possible)`); continue; }
      const a = hit[0], fgs = fgOf(a); used++;
      if (g.focalMm != null && a.focalMm == null) { a.focalMm = g.focalMm; a.lens = `${g.focalMm}mm (grid)`; }
      a.toma = g.toma; a.grid = g.file;
      // todos los planos de croma de esa cámara del array (un plano puede filmarse en 40 mm aunque la grilla se armó con el de 32)
      for (const s of R.shots.filter(x => (a.shots || []).includes(x.key))) s.grid = `${a.name}, take ${g.toma}: ${g.file}`;
      warn(`${a.name}: lens ${g.focalMm ?? '?'} mm and take ${g.toma} from the grid ${g.file}${fgs.length ? ' (FG ' + fgs.map(s => s.key).join(', ') + ')' : ''}; height, pan and tilt are drawn on the grid: type them by hand`);
    }
    return used;
  }
  // ---------- arrays de BG: grillas, plantas y JSON de rig (lo PLANEADO; D-05: nunca es la verdad) ----------
  // Lo que arma Javi para un rodaje de plates (una carpeta de grillas y cálculos por escena):
  //   grillas:  XMPL_000_205_ArrayDer_Toma2_AcoFrontal_21mmf_from_32mm_Grilla.png | _FG.png   (gridName)
  //   cálculos: XMPL_ARRAY_DER_205_02_18mm_v01_grilla[_fix].png | _recorte | _cajas, XMPL_ARRAY_DER_205_04b_21mm_v01_recorte.png
  //   plantas:  ARRAY_DER_cam_28a18mm_205_002_v001.jpg (ensayo 28 mm -> array 18 mm, plano 2), ARRAY_DER_top_v001.jpg,
  //             XMPL_ESC_205_ARRAY_DER_grip_datos_v01.jpg, XMPL_ESC_205_ARRAY_DER_setup_planta_v01.jpg, ESC_205_SETUP_v01.jpg
  // Una cámara del array se reconoce por lado + escena + lente del array (18/21/25 mm: uno por cámara). La altura, el
  // PAN y el tilt están DIBUJADOS en las imágenes (no se leen: sin OCR); vienen del JSON de rig (docs/MANUAL.md).
  const arrSide = (s) => { const t = String(s || '').replace(/^array[\s_]*/i, ''); return /^(der|derech|right)/i.test(t) ? 'ArrayDer' : /^(izq|izquierd|left)/i.test(t) ? 'ArrayIzq' : sideName(t); };
  function arrayFile(path) {
    const p = String(path || ''), base = p.replace(/^.*[\\/]/, ''), b = base.replace(/\.[a-z0-9]+$/i, '');
    const dirScene = ((/(?:^|[\\/_])(?:esc|escena)_?0*(\d{2,4}[a-z]?)(?=[\\/_]|$)/i.exec(p) || [])[1] || '').toUpperCase();
    const out = (o) => ({ file: base, scene: dirScene, plano: '', toma: null, name: '', focalMm: null, fromMm: null, fix: false, ...o });
    const g = gridName(b);
    if (g) return out({ kind: /_fg$/i.test(b) ? 'fg' : /_(grilla|grid)$/i.test(b) ? 'grid' : 'other', side: g.side, scene: g.scene || dirScene, toma: g.toma, name: g.desc.replace(/\s+/g, ''), focalMm: g.focalMm, fromMm: g.fgFocalMm });
    let m = /(?:^|_)array_([a-z]+)_0*(\d{2,4})_0*(\d+[a-z]?)_(\d+(?:[.,]\d+)?)mm(?:_v\d+)?_(grilla|recorte|cajas)(_fix)?$/i.exec(b);
    if (m) return out({ kind: { grilla: 'calc-grid', recorte: 'calc-cut', cajas: 'calc-boxes' }[m[5].toLowerCase()], side: arrSide(m[1]), scene: m[2], plano: m[3].toLowerCase(), focalMm: toNum(m[4]), fix: !!m[6] });
    m = /(?:^|_)array_([a-z]+)_cam_(\d+)a(\d+)mm_0*(\d{2,4})_0*(\d+[a-z]?)(?=_|$)/i.exec(b);
    if (m) return out({ kind: 'view', side: arrSide(m[1]), fromMm: +m[2], focalMm: +m[3], scene: m[4], plano: m[5].toLowerCase() });
    m = /(?:^|_)array_([a-z]+)_(top|grip_datos|setup_planta|checking)(?=_|$)/i.exec(b);
    if (m) { const sc = /(?:^|_)esc_0*(\d{2,4})(?=_)/i.exec(b); return out({ kind: { top: 'top', grip_datos: 'grip', setup_planta: 'plan', checking: 'check' }[m[2].toLowerCase()], side: arrSide(m[1]), scene: sc ? sc[1] : dirScene }); }
    m = /(?:^|_)esc_0*(\d{2,4})_setup(?=_|$)/i.exec(b);
    if (m) return out({ kind: 'setup', side: '', scene: m[1] });
    return null;
  }
  // PAN del dibujo de Javi: cada cámara se mide desde su línea punteada (atrás, derecha, izquierda o adelante del auto),
  // + = paneo a la derecha (horario visto de arriba). Rumbo (horario desde el frente) = cero + PAN; en la convención
  // del driving (0 frente, 90 izquierda): yaw = -(cero + PAN). Confirmado con las grillas de un rodaje real (cálculo del VP).
  const PAN_ZERO = { back: 180, rear: 180, atras: 180, right: 90, derecha: 90, der: 90, left: -90, izquierda: -90, izq: -90, front: 0, frente: 0, adelante: 0 };
  const panZeroDeg = (z) => PAN_ZERO[norm(z || 'back')];
  const yawFromPan = (pan, zero) => { const z = panZeroDeg(zero); return Number.isFinite(pan) && z != null ? wrap(-(z + pan)) : null; };
  // JSON de rig: { scene, rigs: [{ side, body, mode, panZero, source, cameras: [{ name, plano, lens, from, height, pan, panZero,
  // tilt, yaw, offset: { x, y, z }, aka }] }] }; también un solo rig ({ side, cameras }) o una lista de rigs.
  function parseRig(obj, file, warn = () => {}) {
    const rigs = Array.isArray(obj) ? obj : Array.isArray(obj && obj.rigs) ? obj.rigs : obj && Array.isArray(obj.cameras) ? [obj] : null;
    if (!rigs) return null;
    const out = [], n = (v) => v == null || v === '' ? null : Number.isFinite(+v) ? +v : NaN;
    for (const r of rigs) {
      const side = arrSide(r.side || r.rig || r.name || ''), scene = String(r.scene ?? obj.scene ?? '').toUpperCase();
      for (const c of r.cameras || []) {
        const label = `${file}: ${side} ${c.name || '?'}`, v = {};
        for (const [k, key] of [['lens', 'focalMm'], ['from', 'fromMm'], ['height', 'heightM'], ['pan', 'panDeg'], ['tilt', 'tiltDeg'], ['yaw', 'yawDeg'], ['roll', 'rollDeg']]) {
          v[key] = n(c[k]); if (Number.isNaN(v[key])) { warn(`${label}: ${k} "${c[k]}" is not a number, not used`); v[key] = null; }
        }
        const zero = c.panZero || r.panZero;
        if (v.yawDeg == null && v.panDeg != null) {
          if (!zero) warn(`${label}: PAN ${v.panDeg}° without panZero: read from the rear of the car (+ = pan right); check the dotted line on its grid`);
          v.yawDeg = yawFromPan(v.panDeg, zero);
          if (v.yawDeg == null) warn(`${label}: panZero "${zero}" not understood (back, right, left or front)`);
        }
        const o = c.offset || {}, off = ['x', 'y', 'z'].map(k => n(o[k])).map(x => Number.isFinite(x) ? x : null);
        out.push({ side, scene, name: String(c.name || '').trim(), plano: String(c.plano ?? '').toLowerCase(), aka: [].concat(c.aka || []), panZero: zero || (v.panDeg != null ? 'back' : ''),
          offsetM: off.some(x => x != null) ? { x: off[0], y: off[1], z: off[2] } : null, body: c.body || r.body || '', mode: c.mode || r.mode || '', source: r.source || obj.source || file, note: c.note || '', file, ...v });
      }
    }
    return out;
  }
  // archivos de los arrays (rutas o nombres) + JSON de rig ya leídos -> cámaras planeadas (formato de R.arrays)
  function buildRigs(paths, rigs = [], warn = () => {}) {
    const F = paths.map(arrayFile).filter(Boolean), cams = new Map(), sheets = {};
    const key = (side, scene, f) => `${side}|${norm(scene)}|${typeof f === 'number' ? +f : f}`;
    const get = (side, scene, f) => { const k = key(side, scene, f); if (!cams.has(k)) cams.set(k, { side, scene, focalMm: f, names: [], tomas: [], files: [], plano: '', fromMm: null, fix: '', rig: null }); return cams.get(k); };
    for (const f of F) {
      if (f.focalMm == null) { (sheets[f.side || 'all'] = sheets[f.side || 'all'] || []).push(f); continue; }
      const c = get(f.side, f.scene, f.focalMm); c.files.push(f.file);
      if (f.name && !c.names.some(x => norm(x) === norm(f.name))) c.names.push(f.name);
      if (f.toma != null && !c.tomas.includes(f.toma)) c.tomas.push(f.toma);
      if (f.plano && (!c.plano || /[a-z]$/.test(c.plano))) c.plano = f.plano; // "04b" es una variante del 04
      if (f.fromMm != null && c.fromMm == null) c.fromMm = f.fromMm;
      if (f.fix) c.fix = f.file;
    }
    for (const r of rigs) {
      const near = (x) => x.side === r.side && (!r.scene || !x.scene || sameNum(x.scene, r.scene));
      let c = r.focalMm != null && [...cams.values()].find(x => near(x) && x.focalMm === r.focalMm);
      if (!c) c = [...cams.values()].find(x => near(x) && x.names.concat(r.aka).some(n => norm(n) === norm(r.name)));
      if (!c) c = get(r.side, r.scene, r.focalMm ?? 'name:' + norm(r.name));
      c.rig = r; if (r.focalMm != null) c.focalMm = r.focalMm; if (r.fromMm != null && c.fromMm == null) c.fromMm = r.fromMm;
      if (r.plano && !c.plano) c.plano = r.plano;
      else if (r.plano && c.plano && !sameNum((/^\d+/.exec(c.plano) || [''])[0], (/^\d+/.exec(r.plano) || [''])[0])) warn(`${r.side} ${r.name}: the rig JSON says plano ${r.plano}, the file names plano ${c.plano}`);
      if (c.fromMm != null && r.fromMm != null && c.fromMm !== r.fromMm) warn(`${r.side} ${r.name}: the rig JSON says from ${r.fromMm} mm, the file names ${c.fromMm} mm`);
    }
    const out = [];
    for (const c of cams.values()) {
      const r = c.rig || {}, name = r.name || c.names[0] || `${c.side} · plano ${c.plano || '?'}`;
      const aka = [...new Set(c.names.concat(r.aka || []).filter(x => norm(x) !== norm(name)))];
      const group = `${c.side} ${c.scene || ''} · planned`.replace(/\s+/g, ' ');
      const src = [r.file && `${r.file} (${r.source})`, c.files.length && `${c.files.length} grid/plan files`].filter(Boolean).join(' + ');
      if (aka.length) warn(`${name} (${c.side}) is also named ${aka.join(', ')} in the file names: same camera (same lens)`);
      if (c.fix) warn(`${name} (${c.side}): ${c.fix} is a later fix of the grid (_fix wins over the plain one)`);
      if (!c.rig && c.focalMm != null) warn(`${name} (${c.side}): height, PAN and tilt are drawn on the grids, not in the names: type them in a rig JSON (manual)`);
      out.push({ name, group, side: c.side, scene: c.scene, plano: c.plano, desc: '', aka, tomas: c.tomas.sort((a, b) => a - b).map(n => ({ n, note: 'grid' })), shots: [], page: src, raw: {},
        cam: '', body: r.body || '', mode: r.mode || '', lens: c.focalMm != null ? `${c.focalMm}mm` + (c.fromMm != null ? ` (from ${c.fromMm}mm)` : '') : '',
        focalMm: Number.isFinite(c.focalMm) ? c.focalMm : null, fromMm: c.fromMm, tStop: null, focusM: null, subjectM: null, heightM: r.heightM ?? null, tiltDeg: r.tiltDeg ?? null, rollDeg: r.rollDeg ?? null,
        yawDeg: r.yawDeg ?? null, panDeg: r.panDeg ?? null, panZero: r.panZero || '', offsetM: r.offsetM || null, fps: null, notes: r.note || '', planned: true, src, files: c.files });
    }
    for (const s of Object.keys(sheets)) {
      const k = sheets[s].map(f => f.kind);
      if (k.includes('grip') && !rigs.some(r => s === 'all' || r.side === s)) warn(`${s}: the grip data (${sheets[s].find(f => f.kind === 'grip').file}) is a picture: type its numbers in a rig JSON (manual)`);
    }
    const sides = [...new Set(out.map(a => a.side))];
    if (sides.length) warn(`${sides.join(', ')}: planned values (grids and rig, from the calculations), not what the camera rig really shot: measure each clip on its plate (Measure drive camera)`);
    return { arrays: out, files: F.length };
  }
  // las cámaras planeadas en el reporte: cada una reemplaza a la de Shot Docs de su plano (que no trae valores) y se
  // queda con su descripción, sus tomas y sus planos de croma; una ya importada se actualiza
  function mergeRigs(R, built) {
    const base = (id) => (/^\d+/.exec(id || '') || [''])[0];
    const sameScene = (a, b) => !a || !b || sameNum(a, b) || norm(a) === norm(b);
    for (const b of built) {
      let i = R.arrays.findIndex(a => a.planned && a.side === b.side && sameScene(a.scene, b.scene) && (a.focalMm === b.focalMm || norm(a.name) === norm(b.name)));
      if (i < 0) i = R.arrays.findIndex(a => !a.planned && a.side === b.side && a.plano && b.plano && sameScene(a.scene, b.scene) && sameNum(base(a.plano), base(b.plano)));
      if (i < 0) { R.arrays.push(b); continue; }
      const a = R.arrays[i];
      if (a.planned) {
        // otra tanda de la misma cámara planeada (una grilla suelta, el JSON después de las grillas): suma tomas, archivos
        // y nombres; lo que la tanda nueva no trae (altura, PAN, planos de croma) queda como estaba
        const name = b.yawDeg != null || b.heightM != null ? b.name : a.name;
        for (const k of Object.keys(a)) if (b[k] == null || b[k] === '') b[k] = a[k];
        b.tomas = a.tomas.concat(b.tomas.filter(t => !a.tomas.some(o => o.n === t.n))).sort((x, y) => x.n - y.n);
        b.files = [...new Set([...(a.files || []), ...(b.files || [])])];
        b.aka = [...new Set([...(a.aka || []), ...b.aka, a.name, b.name])].filter(n => norm(n) !== norm(name));
        b.name = name; b.shots = a.shots || [];
      } else {
        b.desc = [a.desc, b.desc].filter(Boolean).join(' · '); b.plan = a.plan; b.shots = a.shots || [];
        if (a.tomas && a.tomas.length) b.tomas = a.tomas.map(t => ({ ...t, note: [t.note, b.tomas.some(g => g.n === t.n) && 'grid'].filter(Boolean).join(' · ') }));
      }
      for (const s of R.shots) if (s.arrays) s.arrays = s.arrays.map(n => n === a.name ? b.name : n);
      R.arrays[i] = b;
    }
    return R;
  }
  // ---------- planilla de cámara (Camera report): .xlsx con una pestaña por día y unidad ----------
  // Cabecera: CAM ID, JORNADA, FECHA (número de serie de Excel) y LOCACIÓN (una escena por renglón). Columnas:
  // ESC, PLANO, TOMA, REEL, CLIP, Lens Type, Focal Distance, F-Stop, Filter, Resolution, FPS, Sonido M.O.S, VFX,
  // H / Cam, Distancia Obj., Go PRO (XYZ), Notas ("ROLL: +0.5 TILT: -6", el inclinómetro). La pestaña SERIAL
  // dice el cuerpo de cada cámara ("ARRI ALEXA 35" | "CAM B"). REEL + CLIP es el clip ARRI (A042 C007 = A_0042C007_…).
  const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const xmlText = (t) => String(t).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : +e.slice(1)) : XML_ENT[e] ?? m);
  const xmlAttrs = (t) => { const o = {}; for (const m of String(t).matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = xmlText(m[2]); return o; };
  const xmlRuns = (t) => [...String(t).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => xmlText(m[1])).join('');
  const colIdx = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+/g, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  // { 'xl/workbook.xml': texto, … } -> [{ name, rows: [[texto]] }] (valores, con los textos compartidos; sin librería)
  function readXlsx(x) {
    const ss = [...(x['xl/sharedStrings.xml'] || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => xmlRuns(m[1]));
    const rels = {}; for (const m of (x['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b([^>]*)>/g)) { const a = xmlAttrs(m[1]); rels[a.Id] = a.Target || ''; }
    const out = [];
    for (const m of (x['xl/workbook.xml'] || '').matchAll(/<sheet\b([^>]*)>/g)) {
      const a = xmlAttrs(m[1]), t = rels[a['r:id']] || '', xml = x[t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '')];
      if (xml == null) continue;
      const rows = [];
      for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const ri = (+xmlAttrs(r[1]).r || rows.length + 1) - 1, row = []; let k = 0;
        for (const c of (r[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ca = xmlAttrs(c[1]), body = c[2] || ''; if (ca.r) k = colIdx(ca.r);
          const v = /<v>([\s\S]*?)<\/v>/.exec(body);
          let val = ca.t === 'inlineStr' ? xmlRuns(body) : v ? xmlText(v[1]) : '';
          if (ca.t === 's') val = ss[+val] ?? '';
          row[k++] = val.replace(/\r?\n/g, ' / ');
        }
        rows[ri] = Array.from(row, v => v ?? '');
      }
      out.push({ name: a.name || '', rows: Array.from(rows, v => v || []) });
    }
    return out;
  }
  const cellNum = (t) => /^-?\d+\.0+$/.test(t) ? t.replace(/\.0+$/, '') : t;
  const NONE = /^[\s\-—–?.]*$|^(no|falso|false|n\/?a)$/i;
  // T-stop de la planilla: "2.8 2/3" = 2/3 de paso más cerrado que T2.8; cada paso es ×√2 (2.8 2/3 -> T3.56)
  function stopT(t) {
    const m = /^\s*[tf]?\s*\/?\s*(\d+(?:[.,]\d)?)(?:\s*(\d)\s*\/\s*(\d))?\s*$/i.exec(String(t || '')); if (!m) return null; // "41/3" = 4 1/3
    const b = toNum(m[1]); if (!m[2]) return b;
    const k = 2 * Math.log2(b), kr = Math.round(k), full = Math.abs(k - kr) < 0.15 ? Math.pow(2, kr / 2) : b;
    return +(full * Math.pow(2, m[2] / m[3] / 2)).toFixed(2);
  }
  // altura y distancia como se anotan: "1.27m", "1.26", "70cm", "4 ft", "6 1/2 ft"; "0.76m-1.40m" o "1.10m/1.30m" es un rango
  function sheetLen(t) {
    let x = String(t || '').trim(); if (NONE.test(x)) return { m: null };
    if (/^inf/i.test(x)) return { m: null, inf: true };
    x = x.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (_, a, b, c) => String(+a + b / c));
    if (/\d\s*(?:mm|cm|m|ft|')?\s*(?:-|–|\/|\ba\b)\s*\d/i.test(x)) return { m: null, range: true };
    const n = num(x); if (n == null) return { m: null, bad: /\d|inf/i.test(x) };
    const u = ((/\d\s*(cm|mm|m|ft|feet|pies?|')/i.exec(x) || [])[1] || '').toLowerCase();
    // sin unidad, como lengthM: más de 20 son cm (127 -> 1.27 m), nadie anota una altura de cámara de 127 m
    return { m: +(u === 'cm' ? n / 100 : u === 'mm' ? n / 1000 : u && u !== 'm' ? n * 0.3048 : !u && n > 20 ? n / 100 : n).toFixed(4) };
  }
  const incl = (t, k) => { const m = new RegExp(k + '\\s*:?\\s*([+\\-−]?\\d+(?:[.,]\\d+)?)', 'i').exec(t); return m ? toNum(m[1]) : null; };
  // A042 + C007, "A_0042C007_251120_120000_h1XMP" (clipName de ARRI), "A042C007" -> "A42C7"
  function clipId(t) { const m = /(?:^|[^a-z0-9])([a-z])_?0*(\d{1,4})c0*(\d{1,4})(?!\d)/i.exec(String(t || '')); return m ? `${m[1].toUpperCase()}${+m[2]}C${+m[3]}` : null; }
  const HEAD = { esc: 'scene', escena: 'scene', plano: 'plano', toma: 'toma', reel: 'reel', clip: 'clip', 'lens type': 'lensType', lente: 'lensType',
    'focal distance': 'focal', focal: 'focal', 'f stop': 'stop', 't stop': 'stop', diafragma: 'stop', filter: 'filter', filtro: 'filter',
    resolution: 'res', resolucion: 'res', fps: 'fps', vfx: 'vfx', 'h cam': 'h', altura: 'h', 'distancia obj': 'dist', distancia: 'dist',
    'go pro xyz': 'gopro', notas: 'notes', notes: 'notes' };
  const excelDate = (v) => { const n = +v; return n > 20000 && n < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10) : ''; };
  // pestañas -> { takes, bodies, warnings, sheets }: una toma por fila con REEL o CLIP
  function parseCameraReport(sheets) {
    const bodies = {}, takes = [], warnings = [];
    for (const sh of sheets.filter(x => /serial/i.test(x.name))) for (const r of sh.rows) r.forEach((c, i) => {
      const m = /^cam\s*([a-z])$/i.exec(String(c).trim()), b = m && r.slice(0, i).reverse().find(v => String(v).trim());
      if (b) bodies[m[1].toUpperCase()] = String(b).trim();
    });
    let used = 0;
    for (const sh of sheets) {
      const R = sh.rows, hi = R.findIndex(r => { const n = r.map(norm); return n.includes('reel') && n.includes('clip') && (n.includes('esc') || n.includes('escena')); });
      if (hi < 0) continue;
      const cols = R[hi].map(c => HEAD[norm(c)] || ''), nCol = cols.indexOf('notes'), info = { cam: '', day: '', date: '', locs: [] };
      for (let i = 0; i < hi; i++) (R[i] || []).forEach((c, j) => {
        const n = norm(c), below = String((R[i + 1] || [])[j] ?? '').trim();
        if (n === 'cam id') info.cam = String(R[i][j + 1] ?? '').trim().toUpperCase();
        else if (n === 'jornada') info.day = below;
        else if (n === 'fecha') info.date = excelDate(below);
        else if (n === 'locacion') for (let k = i + 1; k < hi; k++) { const v = String((R[k] || [])[j] ?? '').trim(); if (v) info.locs.push(v); }
      });
      const n0 = takes.length;
      for (let i = hi + 1; i < R.length; i++) {
        const r = R[i] || [], g = (k) => { const j = cols.indexOf(k); return j < 0 ? '' : cellNum(String(r[j] ?? '').trim()); };
        const reel = g('reel'), clip = g('clip'); if (NONE.test(reel) && NONE.test(clip)) continue;
        const notes = [g('notes'), ...(nCol >= 0 ? r.slice(nCol + 1) : [])].map(v => String(v ?? '').trim()).filter(Boolean).join(' · ');
        const id = (k) => { const v = g(k); return NONE.test(v) ? '' : v; };
        const lens = g('focal'), stop = g('stop'), h = sheetLen(g('h')), d = sheetLen(g('dist')), check = [];
        if (h.range || h.bad) check.push(`height "${g('h')}" not used`);
        if (d.range) check.push(`distance "${g('dist')}" is a range (focus pull): not used as focus`); else if (d.inf) check.push(`distance "${g('dist')}": focus at infinity, not used`); else if (d.bad) check.push(`distance "${g('dist')}" not understood`);
        if (!NONE.test(stop) && stopT(stop) == null) check.push(/\d\s*(-|–|\/)\s*\d/.test(stop.replace(/(\d)\s*(\d)\s*\/\s*(\d)/g, '$1')) ?`stop "${stop}" is a range (iris pull): not used` : `stop "${stop}" not understood`);
        const cam = info.cam || ((/^[a-z]/i.exec(reel) || [''])[0]).toUpperCase();
        takes.push({ sheet: sh.name, cam, body: bodies[cam] || '', day: info.day, date: info.date, loc: info.locs.join(' / '),
          scene: id('scene').replace(/\s+/g, '').toUpperCase(), plano: id('plano'), toma: id('toma'), reel, clip, id: clipId(reel + clip),
          lensType: g('lensType'), lens, focalMm: focalMm(lens), stop, tStop: NONE.test(stop) ? null : stopT(stop),
          filter: g('filter'), res: g('res'), fps: num(g('fps')), vfx: g('vfx') === '1', h: g('h'), heightM: h.m, dist: g('dist'), distM: d.m,
          rollDeg: incl(notes, 'roll'), tiltDeg: incl(notes, 'tilt'), gopro: NONE.test(g('gopro')) ? '' : g('gopro'), notes, check });
      }
      if (takes.length > n0) used++;
    }
    const dup = {}; takes.forEach(t => { if (t.id) dup[t.id] = (dup[t.id] || 0) + 1; });
    const twice = Object.keys(dup).filter(k => dup[k] > 1);
    if (twice.length) warnings.push(`camera report: ${twice.length} clips appear twice (${twice.slice(0, 6).join(', ')}${twice.length > 6 ? '…' : ''}): the plate takes the first`);
    return { takes, bodies, warnings, sheets: used };
  }
  const planoKey = (t) => norm(t).replace(/\s+/g, '');
  // las tomas de la planilla de un plano de Shot Docs: "4_40" <-> "4-40"; "3_40 - 3_35" <-> "3-40" y "3-35"
  function takesOf(shot, takes) {
    if (!shot || !takes) return [];
    const alts = String(shot.shot || '').split(/\s+-\s+/).map(planoKey).filter(Boolean);
    return takes.filter(t => t.scene && (sameNum(t.scene, shot.scene) || norm(t.scene) === norm(shot.scene)) && alts.includes(planoKey(t.plano)));
  }
  // la toma de un plate por su clip (nombre del archivo o clipName de la metadata)
  const takeByClip = (text, takes) => { const id = clipId(text); return id ? (takes || []).find(t => t.id === id) || null : null; };
  return { readXlsx, parseCameraReport, stopT, sheetLen, clipId, takesOf, takeByClip, parseFile, parseBytes, parseFiles, parseMd, readZip, roleOf, lengthM, angleDeg, yawDeg, focalMm, tStop, shotKey, slate, matchName, suggestByName, gridName, applyGrids, arrayFile, parseRig, buildRigs, mergeRigs, yawFromPan, num };
})();
globalThis.SetReport = SetReport; // en Node (tests) el archivo se importa como módulo

// ---------- Panel (sólo en la página) ----------
// API: sr (estado), srImportFile, srApplyShot, srApplyArray, srProjectState, srApplyProject.
const sr = { report: null, sel: -1, auto: '', how: '', tsel: -1, tscene: '', tauto: '' }; // tsel: toma de la planilla
function srFmtM(m) { return Number.isFinite(m) ? `${(+m).toFixed(2)} m` : ''; }
function srFmtDeg(d) { return Number.isFinite(d) ? `${(+d).toFixed(1)}°` : ''; }
function srShotLabel(s) {
  return [s.key + (s.setup ? ' ' + s.setup : ''), s.cam && 'cam ' + s.cam, Number.isFinite(s.focalMm) && `${+s.focalMm.toFixed(1)} mm`, srFmtM(s.heightM)].filter(Boolean).join(' · ');
}
// lo que trae un plano o una cámara, como filas de la tabla del panel
function srRows(s) {
  return [
    ['Camera', [s.body, s.mode].filter(Boolean).join(' · ') + (s.cam ? ` (cam ${s.cam})` : '')],
    ['Lens', Number.isFinite(s.focalMm) ? `${+s.focalMm.toFixed(2)} mm` : s.lens],
    ['Shot', s.desc], ['Height', srFmtM(s.heightM) + (s.heightSrc === 'plan' && s.heightM != null ? ' (planned)' : '')], ['Tilt', srFmtDeg(s.tiltDeg)], ['Roll', srFmtDeg(s.rollDeg)],
    ['Yaw', srFmtDeg(s.yawDeg)], ['Focus', srFmtM(s.focusM)], ['To subject', srFmtM(s.subjectM)],
    ['T-stop', Number.isFinite(s.tStop) ? 'T' + +s.tStop.toFixed(2) : ''], ['Notes', s.notes], ['Plan', s.plan], ['Arrays', (s.arrays || []).join(', ')], ['Grid', s.grid], ['Page', s.page],
  ].filter(r => r[1]);
}
// lo que trae una cámara de array, en un renglón (sin valores: el plano, las tomas y los planos de croma que la usan)
const srArrayHas = (a) => [a.focalMm, a.heightM, a.yawDeg, a.tiltDeg].some(Number.isFinite);
function srArrayText(a) {
  const pan = Number.isFinite(a.panDeg) && a.planned ? ` (PAN ${srFmtDeg(a.panDeg)} from the ${a.panZero || 'back'})` : '';
  const v = [a.body, Number.isFinite(a.focalMm) && `${+a.focalMm.toFixed(1)} mm` + (Number.isFinite(a.fromMm) ? ` (for ${a.fromMm} mm)` : ''), srFmtM(a.heightM), Number.isFinite(a.yawDeg) && 'yaw ' + srFmtDeg(a.yawDeg) + pan, Number.isFinite(a.tiltDeg) && 'tilt ' + srFmtDeg(a.tiltDeg)].filter(Boolean);
  if (a.offsetM) v.push('offset ' + ['x', 'y', 'z'].filter(k => Number.isFinite(a.offsetM[k])).map(k => `${k} ${a.offsetM[k]} m`).join(' '));
  if (a.plano && a.planned) v.push('plano ' + a.plano);
  if (a.aka && a.aka.length) v.push('also ' + a.aka.join(', '));
  if (a.desc) v.push(a.desc);
  if (a.toma) v.push(`take ${a.toma} (grid)`);
  if (a.plan) v.push(a.plan);
  if (a.shots && a.shots.length) v.push('FG: ' + a.shots.join(', '));
  if (a.tomas && a.tomas.length) v.push('takes: ' + a.tomas.map(t => t.n + (t.note ? ' ' + t.note : '')).join(' / '));
  if (!srArrayHas(a)) v.push('no lens, height or angle in the report');
  return v.join(' · ');
}
const srEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// el modo del catálogo que nombra el reporte: por el raster ("4608 x 3164") o por el rótulo ("4.6K 3:2 OG")
function srMatchMode(b, text) {
  if (!b || !text) return null;
  const r = /(\d{3,5})\s*[x×]\s*(\d{3,5})/i.exec(text), byRaster = r && camMatchMode(b, +r[1], +r[2]);
  if (byRaster) return byRaster;
  const n = (s) => ' ' + String(s).toLowerCase().replace(/\bog\b/g, 'open gate').replace(/[^a-z0-9.:]+/g, ' ').trim() + ' ';
  const want = n(text);
  let best = null, score = 0;
  for (const m of camModes(b)) {
    const toks = n(m.label).trim().split(' '), hit = toks.filter(t => want.includes(' ' + t + ' ')).length;
    if (want.includes(' ' + toks[0] + ' ') && hit > score) { best = m; score = hit; }
  }
  return best;
}
// como tipearlo: el valor en el campo y su evento change (los mismos manejadores que usa la mano)
function srType(id, v, d) {
  if (!Number.isFinite(v)) return false;
  const el = $(id); el.value = (+v).toFixed(d); el.dispatchEvent(new Event('change', { bubbles: true })); return true;
}
function srApplyShot(s) {
  if (!s) return;
  const done = [];
  if (s.body) {
    const b = camMatchBody(s.body);
    if (b) {
      // la misma cámara (y modo) que ya está: no se toca, así no se pierde la extracción ni lo de la metadata
      const m = srMatchMode(b, s.mode), cur = camMode(st.preset);
      if (!(cur && cur.body === b && (!m || m.key === cur.key))) {
        $('cam-body').value = b.id; $('cam-body').dispatchEvent(new Event('change'));
        if (m && m.key !== st.preset) { $('preset').value = m.key; $('preset').dispatchEvent(new Event('change')); }
      }
      done.push(camBodyName(b) + (m ? ' ' + m.label : ''));
    } else toast(`${s.body}: not in the camera list, the film back stays`, true);
  }
  if (srType('tb-focal', s.focalMm, 2)) done.push(`${+s.focalMm.toFixed(1)} mm`);
  if (srType('ang-tilt', s.tiltDeg, 2)) done.push(`tilt ${+s.tiltDeg.toFixed(1)}°`);
  if (srType('ang-roll', s.rollDeg, 2)) done.push(`roll ${+s.rollDeg.toFixed(1)}°`);
  if (srType('ang-yaw', s.yawDeg, 2)) done.push(`yaw ${+s.yawDeg.toFixed(1)}°`);
  if (srType('cam-h', s.heightM, 3)) done.push(`height ${s.heightM.toFixed(2)} m`);
  // foco y T-stop van al bokeh, como la metadata del EXR; sin foco, la distancia al sujeto
  const lens = {}, f = Number.isFinite(s.focusM) ? s.focusM : s.subjectM;
  // fuente (D-05): la toma de la planilla de cámara (s.fromTake) o el plano de Shot Docs
  const from = (k) => s.fromTake && s.fromTake[k] ? 'camrep' : 'report';
  if (Number.isFinite(f)) { lens.focusM = f; lens.focusSrc = from('focus'); done.push(`focus ${f.toFixed(2)} m` + (Number.isFinite(s.focusM) ? '' : ' (distance to subject)')); }
  if (Number.isFinite(s.tStop)) { lens.tStop = s.tStop; lens.tStopSrc = from('tStop'); done.push('T' + +s.tStop.toFixed(2)); }
  if (Object.keys(lens).length) lensSet(lens);
  refreshAll();
  toast(done.length ? `Set report ${s.key}: ${done.join(', ')}` : `Set report ${s.key}: no camera values to apply`, !done.length);
}
function srApplyArray(a) {
  if (!a) return;
  if (!drv.src) { toast('Load the drive plate first, then use its array camera', true); return; }
  if (drv.cam.src === 'measured' && !confirm(`The drive camera was measured on the plate. Replace it with ${a.name} from the set report?`)) return;
  // hook drive-plate: la cámara elegida del driving (drvSetCamera de js/drive-plate.js), con el nombre del reporte
  const done = srDriveCam(a, drv.sel) || [];
  drvUI(); render();
  toast(`Drive camera from ${a.name}${a.planned ? ' (planned, not measured)' : ''}: ${done.join(', ') || 'no values'}`);
}
// una cámara del reporte en una cámara del driving (index) o en la que se llama como ella (si no hay, una nueva);
// devuelve lo aplicado, o null si ya no entra otra cámara
function srDriveCam(a, index) {
  const done = [], ok = (v) => Number.isFinite(v);
  // D-05: lo planeado se dice planeado en la cámara del driving, con su origen
  const note = a.planned ? `Planned camera of ${a.name} (${a.src || a.group}), not measured: the rig may have moved. Measure it on this plate (Measure drive camera).` : `From the set report: ${a.name} (${a.group}).`;
  const i = drvSetCamera({ index, name: a.name, focal: a.focalMm, yaw: a.yawDeg, tilt: a.tiltDeg, roll: a.rollDeg, height: a.heightM, planned: a.planned, note });
  if (i < 0) return null;
  const b = a.body && camMatchBody(a.body);
  if (b) { drvSetMode(srMatchMode(b, a.mode) || camClosestMode(b, drv.W || 1920, drv.H || 1080), null); done.push(camBodyName(b)); }
  drvRemember('report', drv.units[i]); // con el modo de la cámara
  if (ok(a.focalMm)) done.push(`${+(+a.focalMm).toFixed(1)} mm`); if (ok(a.yawDeg)) done.push(`yaw ${srFmtDeg(a.yawDeg)}`);
  if (ok(a.tiltDeg)) done.push(`tilt ${srFmtDeg(a.tiltDeg)}`); if (ok(a.rollDeg)) done.push(`roll ${srFmtDeg(a.rollDeg)}`); if (ok(a.heightM)) done.push(`height ${srFmtM(a.heightM)}`);
  return done;
}
// el array entero del reporte como array del driving, en un paso: una cámara por cada una (por nombre), cada
// una espera su archivo (Load drive plate lo lleva a la que se llama como él)
function srApplyArrayGroup(group) {
  const list = sr.report ? sr.report.arrays.filter(a => a.group === group) : [];
  if (!list.length) return;
  const sel = drv.sel, names = [];
  for (const a of list) {
    if (!srDriveCam(a)) break; // no entra otra cámara
    names.push(a.name);
  }
  if (!names.length) drv.sel = sel;
  drvUI(); render();
  const miss = list.length - names.length;
  toast(`Drive array from ${group}${list.some(a => a.planned) ? " (planned values: measure each plate)" : ""}: ${names.join(', ')}` + (miss ? ` (${miss} left out: up to ${DRV_MAX} cameras)` : '') + '. Load each file with Load drive plate: it goes to the camera with its name.', !!miss);
}
// ---------- tomas de la planilla de cámara (Camera report .xlsx) ----------
const srTakeName = (t) => `${t.scene || '?'} ${t.plano || '?'} take ${t.toma || '?'}`;
function srTakeLabel(t) {
  return [`${t.plano || '?'} T${t.toma || '?'}`, t.reel + t.clip, t.lens, Number.isFinite(t.heightM) && srFmtM(t.heightM), t.date].filter(Boolean).join(' · ');
}
// lo que trae la toma; el inclinómetro y la distancia, al lado de lo que dice la metadata del plate
function srTakeRows(t) {
  const md = st.plateMeta, mo = md && md.orient, n1 = (v) => (v >= 0 ? '+' : '') + (+v).toFixed(1) + '°';
  const inc = [Number.isFinite(t.rollDeg) && 'roll ' + n1(t.rollDeg), Number.isFinite(t.tiltDeg) && 'tilt ' + n1(t.tiltDeg)].filter(Boolean).join(', ');
  // la planilla anota el inclinómetro como lo muestra la cámara: se compara con el número del archivo, no con el de la app
  const vsMeta = mo && inc ? ` · plate metadata: roll ${n1(mo.roll.file ?? mo.roll.v)}, tilt ${n1(mo.tilt.v)}` : '';
  const focus = md && md.focusM > 0 ? ` · plate metadata focus ${srFmtM(md.focusM)}` : '';
  return [
    ['Take', `${srTakeName(t)} · ${t.reel} ${t.clip}`], ['Day', [t.day, t.date, t.loc].filter(Boolean).join(' · ')],
    ['Camera', [t.body, t.res].filter(Boolean).join(' · ') + (t.cam ? ` (cam ${t.cam})` : '')], ['Lens', [t.lensType, t.lens].filter(Boolean).join(' ')],
    ['T-stop', Number.isFinite(t.tStop) ? `T${t.tStop}` + (t.stop && String(t.tStop) !== t.stop ? ` (${t.stop})` : '') : t.stop],
    ['Height', Number.isFinite(t.heightM) ? srFmtM(t.heightM) + ' (H / Cam)' : t.h],
    ['Distance', (Number.isFinite(t.distM) ? srFmtM(t.distM) : t.dist) + (t.dist ? focus : '')],
    ['Inclinometer', inc ? inc + vsMeta + (Number.isFinite(t.rollDeg) ? ' (shown, not applied; roll as the camera shows it: the app roll has the opposite sign)' : ' (shown, not applied)') : ''],
    ['Filter', t.filter], ['FPS', t.fps ? String(t.fps) : ''], ['GoPro', t.gopro], ['Notes', t.notes], ['To check', (t.check || []).join('; ')], ['Sheet', t.sheet],
  ].filter(r => r[1]);
}
// Apply to camera: el plano de Shot Docs y, con una toma de la planilla, lo medido (cuerpo, modo, lente, altura,
// T-stop, distancia como foco). El tilt y el roll del inclinómetro no: se muestran contra la metadata.
function srApply() {
  const R = sr.report, t = R && R.takes && R.takes[sr.tsel];
  let s = R && R.shots[sr.sel];
  if (!t) return srApplyShot(s);
  if (s && !SetReport.takesOf(s, [t]).length) s = null; // un plano de otra escena u otro número no se mezcla con la toma
  const pick = (a, b) => a != null && a !== '' ? a : b;
  srApplyShot({ ...(s || {}), key: (s ? s.key + ' / ' : '') + srTakeName(t), body: pick(t.body, s && s.body), mode: pick(t.res, s && s.mode),
    focalMm: pick(t.focalMm, s && s.focalMm), heightM: pick(t.heightM, s && s.heightM), tStop: pick(t.tStop, s && s.tStop),
    focusM: pick(t.distM, s && s.focusM), subjectM: null, tiltDeg: s ? s.tiltDeg : null, rollDeg: s ? s.rollDeg : null, yawDeg: s ? s.yawDeg : null,
    fromTake: { tStop: t.tStop != null && t.tStop !== '', focus: t.distM != null && t.distM !== '' } });
}
// la primera toma de la planilla de ese plano de Shot Docs (sugerida: el plate no dice cuál)
function srTakeForShot(s) {
  const T = sr.report && sr.report.takes; if (!T) return;
  const t = s ? SetReport.takesOf(s, T)[0] : null;
  sr.tsel = t ? T.indexOf(t) : -1; sr.tauto = ''; if (t) sr.tscene = t.scene || '—';
}
function srUI() {
  const R = sr.report, has = !!R, T = (R && R.takes) || [];
  $('sr-ui').hidden = !has; $('sr-hint').hidden = has;
  $('sr-st').textContent = !has ? 'none' : !R.shots.length && !T.length && R.arrays.length ? `${R.arrays.length} array cameras` : R.shots.length || !T.length ? `${R.shots.length} shot${R.shots.length === 1 ? '' : 's'}` : `${T.length} takes`;
  $('sr').dataset.state = has ? 'ok' : '';
  $('sr-name').textContent = has ? [R.source, R.shots.length + ' shots', R.arrays.length + ' array cameras', T.length && `${T.length} takes (${R.takesSource})`].filter(Boolean).join(' · ') : 'none';
  $('sr-name').title = $('sr-name').textContent;
  if (!has) return;
  $('sr-shot').innerHTML = R.shots.length ? R.shots.map((s, i) => `<option value="${i}">${srEsc(srShotLabel(s))}</option>`).join('') : '<option value="-1">No shots in the report</option>';
  $('sr-shot').value = String(sr.sel); $('sr-shot').disabled = !R.shots.length;
  $('sr-shot').closest('label').hidden = !R.shots.length;
  $('sr-apply').closest('.row').hidden = !R.shots.length && !T.length; // sólo arrays: nada que aplicar a la cámara de la toma
  const s = R.shots[sr.sel], t = T[sr.tsel];
  // la toma: escena y, en esa escena, plano + toma + clip
  $('sr-take-row').hidden = !T.length;
  if (T.length) {
    const scenes = [...new Set(T.map(x => x.scene || '—'))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!scenes.includes(sr.tscene)) sr.tscene = t ? t.scene || '—' : s && scenes.includes(s.scene) ? s.scene : scenes[0];
    $('sr-tscene').innerHTML = scenes.map(x => `<option>${srEsc(x)}</option>`).join(''); $('sr-tscene').value = sr.tscene;
    const list = T.map((x, i) => [x, i]).filter(([x]) => (x.scene || '—') === sr.tscene);
    $('sr-take').innerHTML = '<option value="-1">No take</option>' + list.map(([x, i]) => `<option value="${i}">${srEsc(srTakeLabel(x))}</option>`).join('');
    $('sr-take').value = String(list.some(([, i]) => i === sr.tsel) ? sr.tsel : -1);
  }
  const rows = (s ? srRows(s) : []).map(([k, v]) => `<dt>${k}</dt><dd>${srEsc(v)}</dd>`);
  if (t) rows.push('<dt class="sr-sep">Camera report</dt><dd></dd>', ...srTakeRows(t).map(([k, v]) => `<dt>${k}</dt><dd>${srEsc(v)}</dd>`));
  $('sr-kv').innerHTML = rows.join('');
  $('sr-apply').disabled = !s && !t;
  const m = [s && sr.auto === s.key ? (sr.how === 'desc' ? 'Suggested from the plate name: check it' : sr.how === 'take' ? 'Shot of the take' : 'Matched the plate name') : '',
    t && sr.tauto === t.id ? `Take matched by the plate's clip (${t.reel}${t.clip})` : t && s && SetReport.takesOf(s, [t]).length ? 'Take: first of this shot, check it' : ''];
  $('sr-match').textContent = m.filter(Boolean).join(' · ');
  $('sr-arrays-box').hidden = !R.arrays.length;
  $('sr-arrays').innerHTML = R.arrays.map((a, i) => `<li${a.planned ? ' class="planned"' : ''}><div><b>${srEsc(a.name)}</b>${a.planned ? ` <span class="sr-planned" title="${srEsc('Planned, not measured: ' + (a.src || 'array grids')).replace(/"/g, '&quot;')}">planned</span>` : ''} <span class="note">${srEsc(a.group)}</span><br><span class="note">${srEsc(srArrayText(a))}</span></div><button class="btn sm" id="sr-use-${i}" data-i="${i}"${srArrayHas(a) ? ' title="Use this array camera as the camera of the loaded drive plate (focal, film, Looks to / yaw, tilt, roll, height)"' : ' disabled title="Lens, height and angle of this camera are not in the report (camera sheet)"'}>Use for drive plate</button></li>`).join('');
  // hook drive-plate: un botón por array del reporte para armarlo entero como array del driving
  const gs = [...new Set(R.arrays.map(a => a.group))];
  const box = $('sr-arrays-all') || (() => { const d = document.createElement('div'); d.id = 'sr-arrays-all'; d.className = 'row'; d.dataset.tour = 'setreport.array'; d.onclick = (e) => { const b = e.target.closest('button[data-gi]'); if (b) srApplyArrayGroup(d._gs[+b.dataset.gi]); }; $('sr-arrays').after(d); return d; })();
  box._gs = gs;
  box.innerHTML = gs.map((g, i) => { const n = R.arrays.filter(a => a.group === g).length; return `<button class="btn sm" data-gi="${i}" title="Make the drive plate an array with these ${n} cameras (lens, height, mounting yaw, tilt), up to ${DRV_MAX}. Each waits for its file: Load drive plate gives it to the camera whose name is in the file name.">Drive array: ${srEsc(g)} (${n})</button>`; }).join('');
  $('sr-warn-box').hidden = !R.warnings.length;
  $('sr-warn-sum').textContent = `${R.warnings.length} value${R.warnings.length === 1 ? '' : 's'} to check`;
  $('sr-warn').innerHTML = R.warnings.map(w => `<li>${srEsc(w)}</li>`).join('');
}
// elige solo la toma y el plano del plate (no los aplica: eso es un click). La toma, por el clip (A042C007) del nombre
// del archivo o de la metadata; el plano, por el número (205_020), la toma o la descripción (PPAcompanante34).
function srAutoPick() {
  const R = sr.report; if (!R || st.plate.empty || st.plate.sample) return;
  const T = R.takes || [], md = st.plateMeta;
  sr.auto = ''; sr.tauto = ''; // lo elegido para otro plate ya no es «del nombre»
  const t = T.length ? SetReport.takeByClip(st.plate.name, T) || (md && md.clip ? SetReport.takeByClip(md.clip, T) : null) : null;
  if (t) { sr.tsel = T.indexOf(t); sr.tscene = t.scene || '—'; sr.tauto = t.id; }
  const m = SetReport.matchName(st.plate.name, R.shots)[0], k = !m && t && R.shots.find(s => SetReport.takesOf(s, [t]).length);
  const g = !m && !k && SetReport.suggestByName(st.plate.name, R.shots), s = m || k || g;
  if (s) { sr.sel = R.shots.indexOf(s); sr.auto = s.key; sr.how = m ? 'name' : k ? 'take' : 'desc'; if (!t) srTakeForShot(s); }
  srUI();
}
// varias a la vez: el reporte (.zip / .md), la planilla de cámara (.xlsx) y las grillas del array
// (XMPL_…_ArrayDer_Toma2_…png); la planilla y las grillas se suman al reporte
// También la carpeta de los cálculos de arrays (grillas, plantas y vistas por cámara: sólo se lee el nombre) y el JSON
// de rig con los números de la grip_datos: arman cada array con sus cámaras, como valores PLANEADOS (D-05).
const srPath = (f) => f.relPath || f.webkitRelativePath || f.name;
async function srImportFiles(files) {
  files = [...files];
  const isImg = (f) => /\.(png|jpe?g|tiff?|exr)$/i.test(f.name), isMd = (f) => /\.(md|markdown)$/i.test(f.name), inDir = (f) => /\//.test(srPath(f));
  // de una carpeta, un .md es del reporte sólo si es de un export de Shot Docs descomprimido (su carpeta trae _shotdocs/);
  // otro (el LEEME de la carpeta de cálculos) se avisa y no se usa: no reemplaza el reporte cargado
  const roots = [...new Set(files.map(f => /^(.*\/)?_shotdocs\//.exec(srPath(f))).filter(Boolean).map(m => m[1] || ''))];
  const sd = (f) => /(^|\/)_shotdocs\//.test(srPath(f)), inExport = (f) => roots.some(r => srPath(f).startsWith(r));
  const mdExp = files.filter(f => isMd(f) && inDir(f) && inExport(f) && !sd(f)), mdLoose = files.filter(f => isMd(f) && inDir(f) && !inExport(f));
  let arr = files.filter(f => isImg(f) && SetReport.arrayFile(srPath(f))); const rigF = files.filter(f => /\.json$/i.test(f.name) && !sd(f));
  const docs = files.filter(f => /\.(zip|xlsx)$/i.test(f.name) || (isMd(f) && !inDir(f)));
  const skipped = files.filter(f => ![arr, rigF, docs, mdExp, mdLoose].some(l => l.includes(f)) && !sd(f));
  docs.sort((a, b) => /\.xlsx$/i.test(a.name) - /\.xlsx$/i.test(b.name)); // la planilla después del reporte
  // soft: avisos que no son errores (un .md que no es del reporte, una planilla que no es de cámara)
  const soft = mdLoose.map(f => `${srPath(f)}: not part of a Shot Docs export, not used`);
  if (mdExp.length) await srImportExport(mdExp, (roots[0] || '').replace(/\/$/, '').split('/').pop() || 'Shot Docs export');
  for (const f of docs) await srImportFile(f, soft);
  const rigs = [], rw = [];
  for (const f of rigF) {
    try { const r = SetReport.parseRig(JSON.parse(await f.text()), f.name, (w) => rw.push(w)); if (r) rigs.push(...r); else rw.push(`${f.name}: not a rig JSON (no "rigs" or "cameras"), not used`); }
    catch (e) { rw.push(`${f.name}: could not read it (${e.message})`); }
  }
  if (!arr.length && !rigs.length) {
    if (sr.report && soft.length) { soft.forEach(w => { if (!sr.report.warnings.includes(w)) sr.report.warnings.push(w); }); srUI(); }
    const all = soft.concat(rw, skipped.length ? [`${skipped.length} files not used`] : []); if (all.length) toast(all.join(' · '), rw.length + skipped.length > 0);
    return;
  }
  // grillas sueltas (XMPL_…_ArrayDer_Toma2_…) sobre un reporte de Shot Docs: a su cámara del array, con lente y toma, como
  // antes; las que no encuentran cámara siguen abajo como arrays planeados
  if (!rigs.length && sr.report && sr.report.shots.length && arr.every(f => SetReport.gridName(f.name))) {
    const n = arr.length;
    arr = arr.filter(f => !SetReport.applyGrids(sr.report, [f.name]));
    srUI();
    if (!arr.length) { toast(`Array grids: ${n} of ${n} matched to an array camera`); return; }
  }
  // sin reporte de Shot Docs: los arrays solos también son un reporte
  const R = sr.report || (sr.report = { source: arr.length ? 'array grids' : rigF[0].name, imported: new Date().toISOString(), shots: [], arrays: [], warnings: [], pages: [] });
  const warn = (w) => { if (!R.warnings.includes(w)) R.warnings.push(w); };
  soft.concat(rw).forEach(warn);
  const B = SetReport.buildRigs(arr.map(srPath), rigs, warn);
  SetReport.mergeRigs(R, B.arrays);
  if (skipped.length) warn(`${skipped.length} files are not array grids, plans or rig JSON: not used (${skipped.slice(0, 3).map(f => f.name).join(', ')}${skipped.length > 3 ? '…' : ''})`);
  srUI();
  const vals = B.arrays.filter(a => Number.isFinite(a.yawDeg)).length;
  toast(`Arrays (planned): ${B.arrays.length} cameras from ${arr.length} files${rigs.length ? ' and the rig JSON' : ''}` + (vals < B.arrays.length ? `, ${B.arrays.length - vals} without height, PAN and tilt (rig JSON)` : '')
    + (soft.length ? ` · ${soft.length} file${soft.length > 1 ? 's' : ''} not used (Values to check)` : ''), vals < B.arrays.length);
}
// carpetas soltadas (en el panel o en el visor): todos los archivos de adentro, con su ruta (la escena está en la carpeta)
async function srWalk(entry, out, path = '') {
  if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); f.relPath = path + f.name; out.push(f); return; }
  const rd = entry.createReader();
  for (;;) { const es = await new Promise((res, rej) => rd.readEntries(res, rej)); if (!es.length) break; for (const e of es) await srWalk(e, out, path + entry.name + '/'); }
}
// del drop del visor (js/interaction.js): se queda con las carpetas y con los archivos de arrays y de rig; devuelve el resto
function srTakeDrop(dt) {
  const files = [...dt.files], dirs = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(e => e && e.isDirectory);
  const mine = files.filter(f => (/\.(png|jpe?g)$/i.test(f.name) && SetReport.arrayFile(f.name)) || /(^|[_\-. ])rig[_\-. ].*\.json$|^rig.*\.json$/i.test(f.name));
  if (dirs.length || mine.length) (async () => {
    const all = [...mine]; for (const d of dirs) await srWalk(d, all);
    // una carpeta que no trae nada de esto (otra cosa soltada en el visor) no se toca
    const use = all.filter(f => mine.includes(f) || SetReport.arrayFile(srPath(f)) || /\.(json|zip|md|xlsx)$/i.test(f.name));
    if (use.length) srImportFiles(use);
  })();
  return files.filter(f => !mine.includes(f) && !(dirs.length && !f.type && !f.size));
}
// soft: donde van los avisos que no son errores (una planilla que no es de cámara); sin soft, un toast
async function srImportFile(file, soft) {
  setBusy(true, 'Reading ' + file.name + '…');
  try {
    // por partes: el ZIP de una escena con fotos pesa cientos de MB y sólo se leen el índice y los .md (o el XML del .xlsx)
    srTakeParsed(await SetReport.parseFile(file.name, file.size, async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer()), (d) => fflate.inflateSync(d)), file.name);
  } catch (err) {
    if (err.soft) { const w = `${file.name}: ${err.message}`; if (soft) soft.push(w); else toast(w); }
    else { console.warn('set report', err); toast('Could not read ' + file.name + ': ' + (err.message || err), true); }
  }
  setBusy(false);
}
// un export de Shot Docs descomprimido (sus .md, soltado como carpeta): todas las páginas juntas, como el ZIP
async function srImportExport(files, name) {
  setBusy(true, 'Reading ' + name + '…');
  try { srTakeParsed(SetReport.parseFiles(await Promise.all(files.map(async f => ({ name: srPath(f), text: await f.text() })))), name); }
  catch (err) { console.warn('set report', err); toast('Could not read ' + name + ': ' + (err.message || err), true); }
  setBusy(false);
}
// lo leído de un archivo (source) al reporte: la planilla se suma; un reporte de Shot Docs lo reemplaza
function srTakeParsed(r, source) {
  if (r.takes) {
    // la planilla de cámara: se suma al reporte que haya (o es el reporte)
    const R = sr.report || { source, imported: new Date().toISOString(), shots: [], arrays: [], warnings: [], pages: [] };
    R.takes = r.takes; R.takesSource = source; R.takesWarnings = r.warnings;
    R.warnings = R.warnings.filter(w => !/^camera report:/.test(w)).concat(r.warnings);
    sr.report = R; sr.tsel = -1; sr.tscene = ''; sr.tauto = '';
    srTakeForShot(R.shots[sr.sel]);
    srUI(); srAutoPick();
    toast(`Camera report: ${r.takes.length} takes from ${r.sheets} sheets`);
  } else {
    if (!r.shots.length && !r.arrays.length) throw new Error('no shots or camera arrays found');
    // un .md suelto (una página) no reemplaza sin preguntar un reporte con planos o arrays del reporte
    const R0 = sr.report;
    if (/\.(md|markdown)$/i.test(source) && R0 && (R0.shots.length || R0.arrays.some(a => !a.planned))
      && !confirm(`Replace the set report ${R0.source} (${R0.shots.length} shots) with the page ${source} (${r.shots.length} shot${r.shots.length === 1 ? '' : 's'})?`)) {
      toast(`${source} not used: the set report ${R0.source} stays`); return;
    }
    const keep = sr.report && sr.report.takes ? { takes: sr.report.takes, takesSource: sr.report.takesSource, takesWarnings: sr.report.takesWarnings } : {};
    const planned = sr.report ? sr.report.arrays.filter(a => a.planned) : []; // los arrays de las grillas siguen
    sr.report = { source, imported: new Date().toISOString(), ...r, ...keep };
    if (planned.length) SetReport.mergeRigs(sr.report, planned);
    if (keep.takes) sr.report.warnings = sr.report.warnings.concat(sr.report.takesWarnings = keep.takesWarnings || []);
    sr.sel = r.shots.length ? 0 : -1; sr.auto = '';
    srTakeForShot(sr.report.shots[sr.sel]);
    srUI(); srAutoPick();
    toast(`Set report: ${r.shots.length} shots, ${r.arrays.length} array cameras` + (r.warnings.length ? `, ${r.warnings.length} values to check` : ''));
  }
}
// proyecto (enganches en js/project.js): el reporte ya leído (con las tomas de la planilla), no el archivo
function srProjectState() { return sr.report ? { report: sr.report, sel: sr.sel, tsel: sr.tsel } : undefined; }
function srApplyProject(o) {
  sr.report = (o && o.report) || null; sr.sel = o && o.report ? o.sel ?? 0 : -1; sr.tsel = o && o.report ? o.tsel ?? -1 : -1;
  sr.auto = ''; sr.tauto = ''; sr.tscene = ''; srUI();
}
if (typeof document !== 'undefined' && document.getElementById('sr')) {
  $('f-sr').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) srImportFiles(fs); };
  // soltar en el panel: archivos y carpetas enteras (la de los cálculos de arrays), todo junto
  $('sr').addEventListener('dragover', e => e.preventDefault());
  $('sr').addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation();
    const dt = e.dataTransfer, dirs = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(x => x && x.isDirectory);
    const all = [...dt.files].filter(f => !(dirs.length && !f.type && !f.size));
    for (const d of dirs) await srWalk(d, all);
    if (all.length) srImportFiles(all);
  });
  $('sr-shot').onchange = () => { sr.sel = +$('sr-shot').value; sr.tsel = -1; srTakeForShot(sr.report.shots[sr.sel]); srUI(); };
  $('sr-tscene').onchange = () => { sr.tscene = $('sr-tscene').value; sr.tsel = -1; srUI(); };
  $('sr-take').onchange = () => { sr.tsel = +$('sr-take').value; srUI(); };
  $('sr-apply').onclick = () => srApply();
  $('sr-arrays').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) srApplyArray(sr.report.arrays[+b.dataset.i]); });
  $('sr-clear').onclick = () => { sr.report = null; sr.sel = -1; sr.tsel = -1; sr.auto = ''; sr.tauto = ''; srUI(); };
  // al abrir un plate, elegir solo su plano y su toma (setPlate es de js/plate.js; boot.js lo envuelve igual); la
  // metadata del EXR (o la del Reference EXR) llega después: con su clip se vuelve a buscar la toma
  const _srSetPlate = setPlate;
  setPlate = function (...a) { _srSetPlate(...a); srAutoPick(); };
  const _srMeta = camApplyExrMetadata;
  camApplyExrMetadata = function (...a) { const md = _srMeta(...a); srAutoPick(); return md; };
  srUI();
}
