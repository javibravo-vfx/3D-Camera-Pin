// ---------- Recorrido con un paquete de plano (shot pack) ----------
// Un paquete es una CARPETA descomprimida que no viaja con la app ni va al repo: el material de un plano (plate,
// EXR de referencia, scan, driving, datos de set) y su guion propio en inglés y castellano. La app no lee el
// paquete entero: guarda los File de la carpeta y el navegador los lee de disco recién cuando un paso los carga.
//
// backplatelab-pack.json (en la raíz de la carpeta):
//   { format: 'backplatelab-pack', version: 1, id: 'abc-001', name: 'Lo que muestra el Help', start: 'empty' | 'demo',
//     files: { clave: 'ruta/relativa' | ['ruta', …] },
//     data: { pins:  { conjunto: [{ scan: [x, y, z] (coordenadas del archivo del scan), plate: [u, v] (px del plate) }, …] },
//             lines: { conjunto: { street: [[x1, y1, x2, y2], …], cross: [[…], …] } } (px del driving) },
//     tour: { welcome?, final?, order?, tutorials: { id: { title, summary, chapters } }, chapters: { id: {…} } } }
// El guion usa el formato de tours/catalog.json (las mismas operaciones y condiciones) más pack_load, pack_pins,
// pack_drive_lines y la condición pack_loaded. Una ruta del paquete puede usar capítulos del catálogo de la app.
// Ids de capítulos y pasos del paquete quedan con el prefijo «pack.<id>.»: el progreso de cada paquete es suyo.
// El recorrido corre en la copia de práctica (iframe ?tour=<ruta>&pack=<id>): los File quedan en la ventana de
// la app (window.tourPackActive) y la práctica los toma de ahí; no se escribe nada en la carpeta del paquete.

const TOUR_PACK_MANIFEST = 'backplatelab-pack.json', TOUR_PACK_FORMAT = 'backplatelab-pack', TOUR_PACK_VERSION = 1;
const tourPackPrefix = (id) => `pack.${id}.`;
const tourPackBase = (p) => String(p).replace(/^.*[\\/]/, '');
const tourPackList = (v) => (Array.isArray(v) ? v : [v]);

// ---------- Validación (pura: también la usan los tests de Node) ----------
// man: el manifiesto ya leído; has(ruta): si la carpeta tiene ese archivo; base: tours/catalog.json.
// Devuelve { errs, cat }: cat es el catálogo de la app con las rutas y capítulos del paquete sumados.
function tourPackCheck(man, has, base) {
  const errs = [], E = (s) => errs.push(s);
  if (!man || typeof man !== 'object') return { errs: ['the manifest is not a JSON object'], cat: null };
  const known = ['format', 'version', 'id', 'name', 'start', 'files', 'data', 'tour'];
  Object.keys(man).forEach(k => { if (!known.includes(k)) E(`manifest: unknown field "${k}"`); });
  if (man.format !== TOUR_PACK_FORMAT) E(`manifest: "format" must be "${TOUR_PACK_FORMAT}"`);
  if (!Number.isInteger(man.version) || man.version < 1) E('manifest: "version" must be a whole number');
  // un formato más nuevo puede cambiar todo lo demás: se avisa sólo eso
  else if (man.version > TOUR_PACK_VERSION) return { errs: [`this pack was made for a newer BackplateLab (pack format ${man.version}, this version reads up to ${TOUR_PACK_VERSION}): update BackplateLab`], cat: null };
  if (typeof man.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(man.id)) E('manifest: "id" must be letters, digits, - or _ (up to 41)');
  if (typeof man.name !== 'string' || !man.name.trim()) E('manifest: "name" is missing');
  if (man.start !== undefined && !['empty', 'demo'].includes(man.start)) E('manifest: "start" must be "empty" or "demo"');
  // archivos: rutas relativas a la carpeta del manifiesto, sin salir de ella
  const files = man.files && typeof man.files === 'object' && !Array.isArray(man.files) ? man.files : null;
  if (!files) E('manifest: "files" must be an object { key: path or [paths] }');
  else for (const [k, v] of Object.entries(files)) {
    const L = tourPackList(v);
    if (!L.length || L.some(p => typeof p !== 'string' || !p)) { E(`files.${k}: a path or a list of paths`); continue; }
    for (const p of L) {
      if (/^([a-z]:|[\\/])|(^|[\\/])\.\.([\\/]|$)/i.test(p)) E(`files.${k}: "${p}" must be a path inside the pack folder`);
      else if (has && !has(p)) E(`files.${k}: "${p}" is not in the pack folder`);
    }
  }
  // datos: pins (scan <-> plate) y líneas de la calle del driving
  const data = man.data || {}, isN = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  if (man.data !== undefined && (typeof man.data !== 'object' || Array.isArray(man.data))) E('manifest: "data" must be an object');
  Object.keys(data).forEach(k => { if (!['pins', 'lines'].includes(k)) E(`data: unknown field "${k}"`); });
  for (const [k, P] of Object.entries(data.pins || {})) {
    if (!Array.isArray(P) || P.length < 4) E(`data.pins.${k}: at least 4 pins`);
    else P.forEach((p, i) => { if (!p || !isN(p.scan, 3) || !isN(p.plate, 2)) E(`data.pins.${k}[${i}]: needs scan [x, y, z] and plate [u, v]`); });
  }
  for (const [k, L] of Object.entries(data.lines || {})) {
    const ok = L && Array.isArray(L.street) && L.street.length >= 2 && L.street.every(l => isN(l, 4)) && (L.cross === undefined || (Array.isArray(L.cross) && L.cross.length >= 2 && L.cross.every(l => isN(l, 4))));
    if (!ok) E(`data.lines.${k}: needs street (2 or more [x1, y1, x2, y2]) and optionally cross (2 or more)`);
  }
  // guion: se suma al catálogo de la app con sus ids prefijados y se valida todo junto
  const T = man.tour;
  if (!T || typeof T !== 'object') { E('manifest: "tour" is missing'); return { errs, cat: null }; }
  Object.keys(T).forEach(k => { if (!['welcome', 'final', 'order', 'tutorials', 'chapters'].includes(k)) E(`tour: unknown field "${k}"`); });
  if (!T.tutorials || !Object.keys(T.tutorials).length) E('tour: no tutorials');
  if (!T.chapters || typeof T.chapters !== 'object') E('tour: no chapters');
  if (errs.length) return { errs, cat: null };
  const cat = tourPackMerge(base, man);
  // las referencias del guion a archivos y datos del paquete
  for (const [cid, ch] of Object.entries(T.chapters)) (ch.steps || []).forEach((s, i) => {
    const w = `chapter ${cid} step ${s.id || i}`;
    [...(s.enter || []), ...(s.do || []), ...(s.until ? [s.until] : [])].forEach(o => {
      if ((o.op === 'pack_load' || o.what === 'pack_loaded') && files && !files[o.file]) E(`${w}: unknown pack file "${o.file}"`);
      if (o.op === 'pack_pins' && !(data.pins || {})[o.set]) E(`${w}: unknown pins "${o.set}"`);
      if (o.op === 'pack_drive_lines' && !(data.lines || {})[o.set]) E(`${w}: unknown lines "${o.set}"`);
    });
  });
  tourValidate(cat).forEach(e => E(e.split(tourPackPrefix(man.id)).join('')));
  return { errs, cat };
}
// catálogo de la app + el del paquete (prefijado). Las rutas del paquete van al grupo «pack» y primero.
function tourPackMerge(base, man) {
  const pre = tourPackPrefix(man.id), T = man.tour, cat = JSON.parse(JSON.stringify(base));
  const ids = Object.keys(T.chapters || {});
  for (const id of ids) {
    const ch = JSON.parse(JSON.stringify(T.chapters[id]));
    (ch.steps || []).forEach(s => { if (s.id) s.id = pre + id + '.' + s.id; }); // un id de paso por capítulo, como en el catálogo
    cat.chapters[pre + id] = ch;
  }
  const routes = [];
  for (const [tid, t] of Object.entries(T.tutorials || {})) {
    const r = JSON.parse(JSON.stringify(t));
    r.group = 'pack';
    r.chapters = (r.chapters || []).map(c => ids.includes(c) ? pre + c : c);
    cat.tutorials[pre + tid] = r; routes.push(pre + tid);
  }
  const order = (T.order || routes.map(r => r.slice(pre.length))).map(r => pre + r);
  cat.order = [...order, ...routes.filter(r => !order.includes(r)), ...(base.order || [])];
  if (T.welcome) cat.welcome = T.welcome;
  if (T.final) cat.final = T.final;
  return cat;
}

// ---------- Elegir la carpeta (app del usuario) ----------
// FileList de <input webkitdirectory> (Electron: diálogo de carpeta del sistema; Chrome: selector de carpeta).
// El manifiesto puede estar en la carpeta elegida o una más adentro (el zip descomprimido con su carpeta).
async function tourPackOpen(fileList) {
  const all = [...fileList], rel = (f) => (f.webkitRelativePath || f.name).replace(/\\/g, '/');
  const mans = all.filter(f => tourPackBase(rel(f)) === TOUR_PACK_MANIFEST).sort((a, b) => rel(a).split('/').length - rel(b).split('/').length);
  if (!mans.length) return { errs: [`${TOUR_PACK_MANIFEST} is not in this folder: pick the unzipped folder of a shot pack`] };
  const root = rel(mans[0]).slice(0, -TOUR_PACK_MANIFEST.length), files = new Map();
  for (const f of all) { const r = rel(f); if (r.startsWith(root)) files.set(r.slice(root.length), f); }
  let man;
  try { man = JSON.parse(await mans[0].text()); } catch (e) { return { errs: [`${TOUR_PACK_MANIFEST} is not valid JSON: ${e.message}`] }; }
  const base = tourCatBase || await tourCatReady;
  if (!base) return { errs: [TOUR_LABELS.en.catalogBad] };
  const { errs, cat } = tourPackCheck(man, p => files.has(p.replace(/\\/g, '/').replace(/^\.\//, '')), base);
  if (errs.length) return { errs, name: man && man.name };
  const bytes = [...files.values()].reduce((s, f) => s + f.size, 0);
  return { pack: { id: man.id, name: man.name.trim(), man, files, cat, folder: root.replace(/\/$/, '') || '', bytes, n: files.size } };
}
// archivos de una clave del manifiesto, como File nuevos de esta ventana (sin copiar: el mismo blob en disco)
function tourPackFiles(pack, key) {
  return tourPackList(pack.man.files[key]).map(p => {
    const f = pack.files.get(p.replace(/\\/g, '/').replace(/^\.\//, ''));
    return new File([f], f.name, { type: f.type, lastModified: f.lastModified });
  });
}

// ---------- En la copia de práctica: operaciones y condición del paquete ----------
// el paquete lo tiene la ventana de la app (mismo origen); si la práctica se recargó sola, ya no está
function tourPackHere() {
  if (typeof window === 'undefined' || !tourParams || !tourParams.get('pack')) return null;
  try { const p = window.parent !== window && window.parent.tourPackActive; return p && p.id === tourParams.get('pack') ? p : null; } catch (e) { return null; }
}
const tourPackNeed = () => { const p = tourPackHere(); if (!p) throw new Error('the shot pack is not open'); return p; };
// lo que dice cada control que el archivo ya está cargado: la nota de su fila, o lo que se indica acá
const TOUR_PACK_SHOWN = { 'drive.ref': () => typeof drvU === 'function' ? drvU().metaNote || '' : '' };
function tourPackShownText(anchor) {
  if (TOUR_PACK_SHOWN[anchor]) return TOUR_PACK_SHOWN[anchor]();
  const el = tourEl(anchor), row = el && el.closest('.row'), note = row && row.querySelector('.note');
  return note ? note.textContent : '';
}
Object.assign(TOUR_OPS, {
  // vía privada del chequeo: lo mismo que elegir esos archivos con el botón (el input recibe los File y su change)
  pack_load: { args: ['file', 'anchor'], run: o => {
    const el = tourNeed(o.anchor), inp = el.matches('input[type=file]') ? el : el.querySelector('input[type=file]');
    if (!inp) throw new Error('no file input in ' + o.anchor);
    const dt = new DataTransfer(); tourPackFiles(tourPackNeed(), o.file).forEach(f => dt.items.add(f));
    inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
  } },
  // los pins del paquete puestos donde corresponden (lo que haría el usuario a mano), sin resolver
  pack_pins: { args: ['set'], run: o => {
    const P = tourPackNeed().man.data.pins[o.set]; if (!scanObj || st.sample) throw new Error('load the scan first');
    scanObj.updateMatrixWorld(true);
    st.pins = P.map(p => ({ id: st.nextId++, local: scanRoot.worldToLocal(scanObj.localToWorld(new THREE.Vector3(...p.scan))), uv: [p.plate[0], p.plate[1]], on: true, err: NaN }));
    st.sel = -1; st.solved = null; st.rms = null; refreshAll();
  } },
  // Measure drive camera con las líneas del paquete sobre la calle del driving (como las pondría el usuario)
  pack_drive_lines: { args: ['set'], run: o => {
    const L = tourPackNeed().man.data.lines[o.set];
    if (!dm.on && !dmOpen()) throw new Error('no drive plate');
    dm.lines = L.street.map(l => l.slice());
    if (L.cross) { dm.cross = L.cross.map(l => l.slice()); dm.twoVP = true; } else dm.twoVP = false;
    dm.sel = null; dmSolve();
  } },
});
Object.assign(TOUR_CONDS, {
  // el archivo (el primero de la clave) está cargado en ese control y la app terminó de leerlo
  pack_loaded: { args: ['file', 'anchor'], test: c => {
    const p = tourPackHere(); if (!p || !p.man.files[c.file]) return false;
    const name = tourPackBase(tourPackList(p.man.files[c.file])[0]), busy = document.getElementById('busy');
    return (!busy || busy.hidden) && tourPackShownText(c.anchor).includes(name);
  } },
});

// ---------- Help: «Practice with a shot pack…» ----------
const TOUR_PACK_TX = {
  en: { pick: 'Practice with a shot pack…', pickTip: 'Pick the unzipped folder of a shot pack: a real shot with its plate, scan, drive plate, set data and its own tour. It is read from disk and never changed.',
    group: 'Shot pack', close: 'Close pack', bad: 'This shot pack cannot be used:', reading: 'Reading the pack…',
    facts: '%1 files · %2 · folder %3', note: 'Opens a practice copy of BackplateLab that loads the files of this shot pack from its folder. Nothing you do there touches your project, your settings or the pack. Press Esc twice to leave.' },
  es: { pick: 'Practicar con un paquete de plano…', pickTip: 'Elegí la carpeta descomprimida de un paquete de plano: un plano real con su plate, scan, driving plate, datos de set y su propio recorrido. Se lee de disco y nunca se modifica.',
    group: 'Paquete de plano', close: 'Cerrar paquete', bad: 'Este paquete de plano no se puede usar:', reading: 'Leyendo el paquete…',
    facts: '%1 archivos · %2 · carpeta %3', note: 'Se abre una copia de práctica de BackplateLab que carga los archivos de este paquete desde su carpeta. Lo que hagas ahí no toca tu proyecto, tus ajustes ni el paquete. Esc dos veces sale.' },
};
const tourPackUi = { errs: null, name: '', busy: false };
let tourCatBase = null; // el catálogo de la app sin paquete (tourCat pasa a ser el combinado mientras hay uno abierto)
const tourPackSize = (b) => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
function tourPackSet(pack) {
  if (!tourCatBase) tourCatBase = tourCat;
  window.tourPackActive = pack || null;
  tourCat = pack ? pack.cat : tourCatBase;
  tourHelp.route = pack ? tourCat.order[0] : ''; tourHelp.sel = '';
}
// lo que el Help agrega arriba de la lista de recorridos (lo dibuja tourHelpRender)
function tourPackHelpHtml(lang) {
  const tx = TOUR_PACK_TX[lang], p = typeof window !== 'undefined' && window.tourPackActive;
  let h = `<div class="th-pack"><button class="btn sm" data-pack="pick" title="${tx.pickTip}"${tourPackUi.busy ? ' disabled' : ''}>${tourPackUi.busy ? tx.reading : tx.pick}</button>`;
  if (p) h += `<div class="th-pack-on"><span class="th-pack-name" title="${tourRich(tourFmt(tx.facts, p.n, tourPackSize(p.bytes), p.folder || '.')).replace(/"/g, '&quot;')}">${tourRich(p.name)}</span><button class="btn ghost sm" data-pack="close">${tx.close}</button></div>`;
  if (tourPackUi.errs) h += `<div class="msg bad th-pack-err"><b>${tx.bad}</b>${tourPackUi.name ? ' ' + tourRich(tourPackUi.name) : ''}<ul>${tourPackUi.errs.slice(0, 12).map(e => `<li>${tourRich(e)}</li>`).join('')}${tourPackUi.errs.length > 12 ? `<li>… (${tourPackUi.errs.length - 12} more)</li>` : ''}</ul></div>`;
  return h + '</div>';
}
if (typeof document !== 'undefined' && !TOUR_PRACTICE) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.id = 'f-pack'; inp.hidden = true; inp.webkitdirectory = true; inp.multiple = true;
  document.body.appendChild(inp);
  inp.addEventListener('change', async () => {
    const list = [...inp.files]; inp.value = '';
    if (!list.length) return;
    tourPackUi.busy = true; tourPackUi.errs = null; tourHelpRender();
    const r = await tourPackOpen(list).catch(e => ({ errs: [e.message || String(e)] }));
    tourPackUi.busy = false;
    if (r.pack) { tourPackUi.errs = null; tourPackUi.name = ''; tourPackSet(r.pack); }
    else { tourPackUi.errs = r.errs; tourPackUi.name = r.name || ''; }
    tourHelpRender();
  });
}
