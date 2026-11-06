// ---------- Project save / load (data only: settings, pins, camera; plate and scan are re-linked) ----------
const PROJECT_VERSION = 1;
function projectState() {
  camera.updateMatrixWorld();
  const v3 = (v) => [v.x, v.y, v.z];
  return {
    app: 'Camera Pin', version: PROJECT_VERSION, saved: new Date().toISOString(),
    demo: !!st.plate.sample,
    plate: st.plate.empty ? null : { name: st.plate.name, W: st.plate.W, H: st.plate.H, exr: !!exrState, cs: $('cs').value, view: $('view').value, ev: +$('ev').value,
      ref: typeof vpl !== 'undefined' && vpl.ref ? vpl.ref.name : undefined }, // hook video-plate: EXR de referencia (de un video, o sólo la metadata de un EXR denoiseado)
    scan: scanObj && !st.sample ? { name: st.scanName } : (st.sample ? { name: 'Sample' } : null),
    lens: { preset: st.preset, sw: st.sw, sh: st.sh, shAuto: st.shAuto, focal: st.focal, fScale: st.fScale, freeF: st.freeF, par: st.par },
    scanXform: { unit: st.unit, up: st.up, userScale: st.userScale, scanY: st.scanY || 0, rot: st.rot || [0, 0, 0], scaleOk: st.scaleOk, display: $('disp').value },
    pins: st.pins.map(p => ({ id: p.id, local: v3(p.local), uv: p.uv, on: p.on, baked: !!p.baked })),
    measure: st.measure.la && st.measure.lb && !measEnv() ? { a: v3(st.measure.la), b: v3(st.measure.lb) } : null,
    camera: { pos: v3(camera.position), quat: camera.quaternion.toArray(), target: v3(nav.target) },
    solved: st.solved, lockTR: !!st.lockTR,
    mask: { v: $('mask').value, c: $('mask-c').value, crop: $('exp-crop').checked },
    export: { target: $('target').value, name: $('camname').value },
    key: { ...key },
    env: { id: env.id, on: env.on, seed: env.seed, vals: env.vals, display: env.display },
    timeline: { start: tl.start, end: tl.end, fps: tl.fps, frame: tl.frame },
    bokeh: typeof bokehProjectState === 'function' ? bokehProjectState() : undefined, // hook bokeh
    scene: { lines: sceneSt.lines, edited: sceneSt.edited, twoVP: sceneSt.twoVP, nvp: sceneSt.nvp, axes: sceneSt.ax, rot90: sceneSt.rot90 || 0, figures: sceneSt.figures }, // hook scene: líneas de fuga y figuras
    drive: typeof drvProjectState === 'function' ? drvProjectState() : undefined, // hook drive-plate
    setreport: typeof srProjectState === 'function' ? srProjectState() : undefined, // hook setreport
    delivery: typeof dlProjectState === 'function' ? dlProjectState() : undefined, // hook delivery: reencuadre del plate en el comp
    ghost: typeof ghProjectState === 'function' ? ghProjectState() : undefined, // hook ghost: la comparación con el 3D
    laneCars: typeof lcProjectState === 'function' ? lcProjectState() : undefined, // hook lane-cars: los autos por carril
    vfx: typeof vfxProjectState === 'function' ? vfxProjectState() : undefined, // hook vfx-sup: los setups de rodaje
    assets3d: typeof a3dProjectState === 'function' ? a3dProjectState() : undefined, // hook assets3d: los assets de cada pieza
    render3d: typeof r3dProjectState === 'function' ? r3dProjectState() : undefined, // hook render3d: HDRI (el nombre), lugar, fecha, rumbo y sol
    shakelab: typeof shkProjectState === 'function' ? shkProjectState() : undefined, // hook shakelab: límites, frenada y tomas del iPhone
    carBox: typeof cbProjectState === 'function' ? cbProjectState() : undefined, // hook car-box: la caja del auto del scan
    measureGrid: typeof mgProjectState === 'function' ? mgProjectState() : undefined, // hook depthlab-box: la grilla de DepthLab
    views: typeof mtabProjectState === 'function' ? mtabProjectState() : undefined, // hook module-tabs: lo que se ve en el visor de cada pestaña
    files: projFiles(), // sólo en la app de escritorio: la ruta de cada archivo
  };
}
// lens + camera only: used as soon as a project opens and after each re-linked file, so the view never jumps
function applyProjectCamera(p) {
  const L = p.lens || {};
  st.preset = L.preset || 'custom'; pre.value = st.preset;
  st.sw = L.sw || st.sw; $('sw').value = st.sw;
  st.shAuto = L.shAuto !== false; $('sh-auto').checked = st.shAuto; $('sh').disabled = st.shAuto;
  if (!st.shAuto && L.sh) { st.sh = L.sh; $('sh').value = L.sh; }
  st.focal = L.focal || st.focal; $('focal').value = st.focal; st.fScale = L.fScale || 1;
  st.freeF = !!L.freeF; $('free').checked = st.freeF;
  st.par = L.par || 1; $('par').value = st.par; setPar(st.par, true);
  if (p.camera) {
    camera.position.fromArray(p.camera.pos); camera.quaternion.fromArray(p.camera.quat); nav.target.fromArray(p.camera.target);
    camera.up.set(0, 1, 0); camera.updateMatrixWorld(true); sceneMarkYaw(); // el yaw del proyecto cuenta como elegido
  }
  st.lockTR = !!p.lockTR; $('lock-tr').checked = st.lockTR;
  applyIntrinsics();
}
function applyProjectState(p) {
  const V = (a) => new THREE.Vector3(...a);
  // lens
  const L = p.lens || {};
  st.preset = L.preset || 'custom'; pre.value = st.preset;
  st.sw = L.sw || st.sw; $('sw').value = st.sw;
  st.shAuto = L.shAuto !== false; $('sh-auto').checked = st.shAuto; $('sh').disabled = st.shAuto;
  if (!st.shAuto && L.sh) { st.sh = L.sh; $('sh').value = L.sh; }
  st.focal = L.focal || st.focal; $('focal').value = st.focal; st.fScale = L.fScale || 1;
  st.freeF = !!L.freeF; $('free').checked = st.freeF;
  st.par = L.par || 1; $('par').value = st.par;
  // plate color
  if (p.plate && exrState && EXR.CS_NAMES[p.plate.cs]) { $('cs').value = p.plate.cs; // un proyecto de un plate PNG re-vinculado a un EXR trae otro espacio: queda el detectado
    exrState.cs = p.plate.cs; exrState.why = 'from project'; $('view').value = p.plate.view; $('ev').value = p.plate.ev || 0; $('ev-v').textContent = ((+$('ev').value) >= 0 ? '+' : '') + (+$('ev').value).toFixed(2) + ' EV'; drawExr(); }
  else if (p.plate && p.plate.view) $('view').value = p.plate.view;
  // scan transform
  const X = p.scanXform || {};
  st.scanY = X.scanY || 0; $('scan-y').value = st.scanY;
  st.rot = X.rot || [0, 0, 0]; ['x', 'y', 'z'].forEach((a, i) => $('rot-' + a).value = st.rot[i]);
  $('unit').value = String(X.unit || 1); $('up').value = X.up || 'y';
  setRootTransform(X.unit || 1, X.userScale || 1, X.up || 'y', false);
  st.scaleOk = !!X.scaleOk;
  if (X.display) { $('disp').value = X.display === 'wire' ? 'flat' : X.display; applyDisplay(); } // proyectos de antes: Wireframe ya no está
  // pins and measure (scan-local)
  st.pins = (p.pins || []).map(q => ({ id: q.id, local: V(q.local), uv: q.uv, on: q.on !== false, baked: !!q.baked, err: 0 }));
  st.nextId = st.pins.reduce((m, q) => Math.max(m, q.id + 1), 1); st.sel = -1;
  st.measure = p.measure ? { la: V(p.measure.a), lb: V(p.measure.b) } : { a: null, b: null };
  measWorld(); updateMeasureGeo();
  // camera
  if (p.camera) {
    camera.position.fromArray(p.camera.pos); camera.quaternion.fromArray(p.camera.quat); nav.target.fromArray(p.camera.target);
    camera.updateMatrixWorld(true); sceneMarkYaw();
  }
  st.solved = p.solved || null; $('back').disabled = !st.solved;
  st.lockTR = !!p.lockTR; $('lock-tr').checked = st.lockTR;
  // view, export, key, environment
  if (p.mask) { $('mask').value = p.mask.v; $('mask-c').value = p.mask.c; $('exp-crop').checked = !!p.mask.crop; maskChanged(); }
  if (p.export) { $('target').value = p.export.target; $('camname').value = p.export.name; }
  if (p.key) setKey({ ...p.key });
  if (p.timeline) { tl.start = p.timeline.start; tl.end = p.timeline.end; tl.fps = p.timeline.fps; tl.frame = p.timeline.frame || tl.start; $('tl-in').value = tl.start; $('tl-out').value = tl.end; $('tl-fps').value = tl.fps; tlSave(); }
  if (p.env) {
    env.seed = p.env.seed || 7; env.display = p.env.display || 'solid'; $('env-disp').value = env.display;
    if (ENV_MODULES[p.env.id]) { lsSet('env.vals.' + p.env.id, p.env.vals); envSharedSave(p.env.vals); /* hook pending: la velocidad del proyecto manda */ envSelect(p.env.id); env.on = !!p.env.on; env.vals.mon = !!(p.env.vals && p.env.vals.mon); envRenderParams(); envSave(); envRebuild(); }
    else envSelect('none');
  }
  setPar(st.par, true);
  applyIntrinsics(); checkAspect();
  if (st.pins.length) {
    const k = K(), pose = { ...poseFromCamera() };
    const ap = activePins(); const errs = Solver.errorsOf(pose, k, ap); ap.forEach((q, i) => q.ref.err = errs[i]);
    st.rms = Solver.rmsOf(pose, k, ap);
  } else st.rms = null;
  refreshAll();
  if (p.bokeh && typeof bokehApplyProject === 'function') bokehApplyProject(p.bokeh); // hook bokeh
  if (typeof drvApplyProject === 'function') drvApplyProject(p.drive); // hook drive-plate
  if (typeof srApplyProject === 'function') srApplyProject(p.setreport); // hook setreport
  if (typeof dlApplyProject === 'function') dlApplyProject(p.delivery); // hook delivery
  if (typeof ghApplyProject === 'function') ghApplyProject(p.ghost); // hook ghost
  if (typeof lcApplyProject === 'function') lcApplyProject(p.laneCars); // hook lane-cars
  if (typeof vfxApplyProject === 'function') vfxApplyProject(p.vfx); // hook vfx-sup
  if (typeof a3dApplyProject === 'function') a3dApplyProject(p.assets3d); // hook assets3d
  if (typeof r3dApplyProject === 'function') r3dApplyProject(p.render3d); // hook render3d
  if (typeof shkApplyProject === 'function') shkApplyProject(p.shakelab); // hook shakelab
  if (typeof mgApplyProject === 'function') mgApplyProject(p.measureGrid); // hook depthlab-box
  if (typeof cbApplyProject === 'function') cbApplyProject(p.carBox); // hook car-box
  if (typeof mtabApplyProject === 'function') mtabApplyProject(p.views); // hook module-tabs
  if (p.scene) { // hook scene
    const S = p.scene; sceneSt.rot90 = [0, 1, 2, 3].includes(S.rot90) ? S.rot90 : 0; if (S.axes && typeof S.axes === 'object') sceneSt.ax = { x: !!S.axes.x, y: !!S.axes.y, z: S.axes.z !== false }; else sceneSt.nvp = [1, 2, 3].includes(S.nvp) ? S.nvp : S.twoVP ? 2 : 1; sceneSt.figures = S.figures || []; sceneSt.sel = 0;
    sceneSt.nextFig = sceneSt.figures.reduce((m, f) => Math.max(m, f.id + 1), 1);
    if (S.lines) { sceneSt.lines = S.lines; sceneSt.edited = !!S.edited; sceneSt.linesFor = st.plate.name + '|' + st.plate.W + '|' + st.plate.H; }
    refreshAll();
  }
}
// relink flow: the project names its plate and scan; once the user loads them the state is applied
const projectDriveFile = (p) => !p.demo && p.drive && p.drive.file || ''; // el driving plate tampoco viaja en el proyecto
function showRelink(p) {
  const need = [];
  const got = p._got || {}, mark = (k) => got[k] ? '<span style="color:var(--ok)">✓</span> ' : '';
  // app de escritorio: lo que no estaba en la ruta guardada (o no se pudo abrir)
  const miss = (k) => !got[k] && p._missing && p._missing[k] ? ` <span style="color:var(--warn);word-break:break-all">· ${esc(p._missing[k])}</span>` : '';
  if (p.plate && !p.demo) need.push(`${mark('plate')}<b>Plate</b>: ${esc(p.plate.name)} (${+p.plate.W} × ${+p.plate.H})${miss('plate')}`);
  if (p.scan && !p.demo) need.push(`${mark('scan')}<b>Scan</b>: ${esc(p.scan.name)}${miss('scan')}`);
  const ref = p.plate && !p.demo && p.plate.ref; // hook video-plate: se carga después del video
  if (ref) need.push(`${mark('ref')}<b>Reference EXR</b>: ${esc(ref)}${miss('ref')}`);
  const drive = projectDriveFile(p);
  if (drive) need.push(`${mark('drive')}<b>Driving plate</b>: ${esc(drive)}${miss('drive')}`);
  $('relink-drive').hidden = !drive || !!got.drive;
  $('relink-ref').hidden = !ref || !!got.ref; $('relink-ref').disabled = !got.plate;
  $('relink-ref').title = got.plate ? 'Load the reference EXR of the video plate' : 'Load the video plate first';
  $('relink-plate').hidden = !p.plate || !!got.plate; $('relink-scan').hidden = !p.scan || !!got.scan;
  $('relink-list').innerHTML = need.map(x => `<li>${x}</li>`).join('');
  $('relink').hidden = !need.length;
}
function projectAfterLoad(kind) {
  const p = st.pendingProject; if (!p) return;
  p._got = p._got || {};
  p._got[kind] = true;
  const ok = (!p.plate || p._got.plate) && (!p.scan || p._got.scan) && (!(p.plate && p.plate.ref) || p._got.ref) && (!projectDriveFile(p) || p._got.drive);
  if (ok) { st.pendingProject = null; p._applied = true; $('relink').hidden = true; applyProjectState(p); projectRestored(p); }
  else { applyProjectCamera(p); refreshAll(); showRelink(p); }
}
// Proyectos de antes de v0.003 guardados con Setup B activo: B movía la cámara, así que lens.focal es la
// de B. Ahora la cámara lleva la focal de A (la del plate, guardada en setups[0]) y B conserva la suya.
// En el formato nuevo setups[0].focal es siempre la focal de la cámara: si difiere, es el viejo.
function projectMigrate(p) {
  const b = p.bokeh, L = p.lens;
  if (!b || !L || b.active !== 1 || !b.setups || !b.setups[0] || !b.setups[1] || !(L.focal > 0)) return;
  const cam = L.focal * (L.freeF ? L.fScale || 1 : 1), a = +b.setups[0].focal;
  if (!(a > 0) || Math.abs(a - cam) < 1e-3) return;
  L.focal = a; L.fScale = 1;
  p._note = `: older project saved with Setup B on, so the camera now takes Setup A's ${fmt(a, 1)} mm and Setup B keeps ${fmt(+b.setups[1].focal, 1)} mm`;
}
const projectRestored = (p) => toast('Project restored' + (p._note || ''));
// file: el .json que eligió o soltó el usuario; en la app de escritorio sus archivos se cargan solos (projAutoLoad)
function openProject(p, file) {
  if (!p || p.app !== 'Camera Pin') { toast('That file is not a BackplateLab project', true); return; }
  closeStart();
  resetAll(true);
  projectMigrate(p);
  if (p.demo) { loadDemo(); applyProjectState(p); projectRestored(p); return; }
  if (!p.plate && !p.scan && !projectDriveFile(p)) { applyProjectState(p); projectRestored(p); return; }
  st.pendingProject = p; showRelink(p);
  applyProjectCamera(p); refreshAll();
  if (file && p.files) projAutoLoad(p, file);
}

// ---------- App de escritorio: rutas en el proyecto y carga sola ----------
// nombre -> ruta absoluta de cada archivo que eligió o soltó el usuario (electron/preload.cjs). La captura va antes
// que los onchange de cada input (que vacían el input). En la web no hay rutas y el proyecto queda como siempre.
const projPaths = {};
const projLeaf = (s) => String(s).split(/[\\/]/).pop();
if (window.bplDesktop && window.bplDesktop.pathOf) {
  const keep = (fs) => { for (const f of fs || []) { const r = window.bplDesktop.pathOf(f); if (r) projPaths[f.name] = r; } };
  document.addEventListener('change', e => { if (e.target && e.target.type === 'file') keep(e.target.files); }, true);
  document.addEventListener('drop', e => keep(e.dataTransfer && e.dataTransfer.files), true);
}
// shortcut: por nombre de archivo; dos archivos con el mismo nombre en carpetas distintas guardan el último elegido
function projFiles() {
  const P = (n) => (n && projPaths[n]) || undefined;
  const plate = st.plate.empty || st.plate.sample ? undefined : P(st.plate.name);
  const ref = typeof vpl !== 'undefined' && vpl.ref ? P(vpl.ref.name) : undefined;
  const scan = scanObj && !st.sample ? [st.scanName, ...(st.scanFmt === 'obj' ? st.scanSide || [] : [])].map(P).filter(Boolean) : [];
  const drive = typeof drv !== 'undefined' ? drv.units.map(u => P(u.name || u.wantName)).filter(Boolean) : [];
  const report = typeof sr !== 'undefined' && sr.report ? P(sr.report.source) : undefined;
  const assets = typeof a3dFiles === 'function' ? a3dFiles().map(P).filter(Boolean) : [];
  const f = { plate, ref, scan: scan.length ? scan : undefined, drive: drive.length ? drive : undefined, report, assets: assets.length ? assets : undefined };
  return Object.values(f).some(Boolean) ? f : undefined;
}
// gen: la suben resetAll (Reset all, abrir otro proyecto, la demo) y cada carga; una carga vieja que vuelve de un
// await con otra generación se corta sin tocar nada (ni busy, que ya es de la nueva)
const projAuto = { busy: false, cancel: false, gen: 0 };
const projStale = (g) => projAuto.gen !== g || projAuto.cancel;
const projSleep = (ms) => new Promise(r => setTimeout(r, ms));
// un archivo del proyecto, de a 32 MB, con el progreso en la píldora de lectura (la del OBJ, con Cancel). Cada
// pedazo pasa enseguida a un Blob: así un OBJ de 600 MB no queda entero en la memoria de la página.
async function projReadFile(path, size, p, g = projAuto.gen) {
  const name = projLeaf(path), CH = 32 << 20, parts = [], mb = (b) => (b / 1e6).toFixed(b < 1e7 ? 1 : 0);
  const pill = $('obj-busy'), bar = $('obj-bar'), txt = $('obj-busy-t');
  pill.hidden = false;
  try {
    for (let o = 0; o < size || (o === 0 && size === 0); o += CH) {
      if (projStale(g) || st.pendingProject !== p && !p._applied) return null;
      bar.style.width = (size ? 100 * o / size : 0).toFixed(1) + '%'; txt.textContent = `Opening ${name} · ${mb(o)} / ${mb(size)} MB`;
      if (!size) break;
      const b = await window.bplDesktop.readProjectFile(path, o, Math.min(CH, size - o));
      if (!(b instanceof Uint8Array)) throw new Error((b && b.error) || 'could not read it');
      parts.push(new Blob([b]));
    }
  } finally { pill.hidden = true; }
  return new File(parts, name);
}
// hasta que el archivo quedó cargado (projectAfterLoad) o la app está quieta un rato (falló: el aviso ya salió)
async function projSettle(p, kind) {
  for (let calm = 0; !(p._got && p._got[kind]) && calm < 8;) { await projSleep(200); calm = objJob || !$('busy').hidden ? 0 : calm + 1; }
}
// Orden: plate, EXR de referencia (necesita el plate), driving de la primera cámara, scan; las otras cámaras del
// array después de restaurar (antes no existen y le pisarían el archivo a la primera). Lo que no está en su ruta
// queda en la tarjeta de re-vincular, nombrado con la ruta guardada.
async function projAutoLoad(p, projFile) {
  if (!window.bplDesktop || !window.bplDesktop.openProject) return;
  const g = ++projAuto.gen;
  const r = await window.bplDesktop.openProject(projFile).catch(e => ({ error: e.message || String(e) }));
  if (st.pendingProject !== p || projAuto.gen !== g) return;
  if (r.error) { toast('Could not open the project files: ' + r.error + '. Load them from the card.', true); return; }
  const F = p.files, has = (s) => typeof s === 'string' && r.files[s] >= 0;
  const why = (s) => s + (r.blocked && r.blocked[s] ? ` (${r.blocked[s]})` : ''); // electron/project-files.mjs: una ruta de red no se abre
  [F.plate, F.ref, ...(F.scan || []), ...(F.drive || []), F.report, ...(F.assets || [])].forEach(s => { if (typeof s === 'string') projPaths[projLeaf(s)] = s; }); // el reporte no se lee, pero su ruta sigue al volver a guardar
  const d0 = projectDriveFile(p), drives = (F.drive || []).filter(s => typeof s === 'string');
  const drive0 = drives.find(s => projLeaf(s) === d0), rest = drives.filter(s => s !== drive0);
  const steps = [
    ['plate', p.plate && F.plate && [F.plate], (fs) => loadPlateFile(fs[0])],
    ['ref', p.plate && p.plate.ref && F.ref && [F.ref], (fs) => vplLoadRef(fs[0])],
    ['drive', d0 && drive0 && [drive0], (fs) => drvLoadFile(fs[0])],
    ['scan', p.scan && F.scan && F.scan.length && F.scan, (fs) => { const f = objTakeFiles(fs)[0]; return f ? loadScanFile(f) : undefined; }],
  ];
  p._missing = {}; projAuto.busy = true; projAuto.cancel = false;
  let lost = 0;
  try {
    for (const [kind, paths, load] of steps) {
      if (!paths || (p._got && p._got[kind])) continue;
      if (st.pendingProject !== p || projStale(g)) return;
      if (kind === 'ref' && !(p._got && p._got.plate)) continue; // sin plate no hay a qué darle la metadata: queda en la tarjeta
      if (!has(paths[0])) { p._missing[kind] = why(paths[0]); lost++; showRelink(p); continue; } // el .mtl o la imagen pueden faltar: sale sin textura
      const files = [];
      for (const s of paths.filter(has)) { const f = await projReadFile(s, r.files[s], p, g); if (!f || projStale(g)) return; files.push(f); }
      await load(files); await projSettle(p, kind);
      if (projStale(g)) return;
      if (!(p._got && p._got[kind])) { p._missing[kind] = paths[0]; lost++; }
    }
    if (projStale(g)) return;
    if (st.pendingProject === p) { showRelink(p); toast(`${lost || 'Some'} project file${lost === 1 ? ' was' : 's were'} not found: load ${lost === 1 ? 'it' : 'them'} from the card`, true); return; }
    if (!p._applied) return;
    const gone = [];
    for (const s of rest) {
      if (projStale(g)) return;
      if (!has(s)) { gone.push(r.blocked && r.blocked[s] ? `${projLeaf(s)} (${r.blocked[s]})` : projLeaf(s)); continue; }
      const f = await projReadFile(s, r.files[s], p, g); if (!f || projStale(g)) return;
      await drvLoadFile(f);
    }
    // los assets de 3D Assets: cada uno vuelve a su pieza con su ajuste guardado
    const goneA = [];
    for (const s of (F.assets || []).filter(s => typeof s === 'string')) {
      if (projStale(g)) return;
      if (!has(s)) { goneA.push(projLeaf(s)); continue; }
      const f = await projReadFile(s, r.files[s], p, g); if (!f || projStale(g)) return;
      if (typeof a3dLoadFile === 'function') await a3dLoadFile(f);
    }
    if (gone.length && !projStale(g)) toast(`Drive camera file${gone.length > 1 ? 's' : ''} not found: ${gone.join(', ')}. Load ${gone.length > 1 ? 'them' : 'it'} with Load drive plate.`, true);
    if (goneA.length && !projStale(g)) toast(`3D asset${goneA.length > 1 ? 's' : ''} not found: ${goneA.join(', ')}. Import ${goneA.length > 1 ? 'them' : 'it'} again in 3D Assets.`, true);
  } catch (e) {
    console.warn('project files', e); if (projAuto.gen !== g) return;
    toast('Could not open the project files: ' + (e.message || e) + '. Load them from the card.', true);
    if (st.pendingProject === p) showRelink(p);
  } finally { if (projAuto.gen === g) projAuto.busy = false; }
}
$('obj-cancel').addEventListener('click', () => { if (projAuto.busy && !objJob) { projAuto.cancel = true; toast('Loading cancelled: load the files from the card'); } });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); // para atributos (title, value) y texto
async function saveProject() {
  const data = JSON.stringify(projectState(), null, 1);
  const base = ((st.plate.empty ? '' : st.plate.name) || 'project').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  const filename = base + '.backplatelab.json';
  if (window.bplDesktop) { const r = await desktopSave(data, filename); toast(r.msg, !!r.error); return; }
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename, data }); toast('Project saved'); return; }
  } catch (e) { if (e && e.code === 'declined') return; }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Project saved');
  } catch (e) { toast('This view cannot save files', true); }
}
// App de escritorio (electron/preload.cjs): el diálogo de guardar de Windows. Devuelve { path } o
// { canceled } o { error }, más el aviso para el usuario en msg.
async function desktopSave(data, filename) {
  let r;
  try { r = await window.bplDesktop.save(filename, data instanceof Blob ? await data.arrayBuffer() : new TextEncoder().encode(data).buffer); }
  catch (e) { r = { error: e.message || String(e) }; }
  r.msg = r.canceled ? 'Save cancelled' : r.error ? 'Could not save: ' + r.error : 'Saved to ' + r.path;
  return r;
}
function toast(msg, bad) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, Math.max(2400, msg.length * 55)); // que los largos se alcancen a leer
}
function closeStart() { $('start').hidden = true; }
$('pj-save').onclick = saveProject;
$('f-proj').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { openProject(JSON.parse(await f.text()), f); } catch (err) { toast('Could not read ' + f.name, true); } };
$('f-proj2').onchange = $('f-proj').onchange;
$('st-demo').onclick = () => { closeStart(); resetAll(true); loadDemo(); };
$('st-empty').onclick = closeStart;
['s2load', 's1load'].forEach(id => $(id).addEventListener('click', e => { e.stopPropagation(); $(id === 's2load' ? 'f-plate' : 'f-scan').click(); }));
// Load demo scene está en Settings: se cierra Settings antes de preguntar
$('pj-demo').onclick = () => {
  if (!$('set-dlg').hidden) setOpen(false);
  const busy = !st.plate.empty || !!scanObj || st.pins.length > 0;
  if (!busy) { resetAll(true); loadDemo(); return; }
  $('demo-ask').hidden = false; setTimeout(() => $('demo-no').focus(), 30);
};
$('demo-no').onclick = () => { $('demo-ask').hidden = true; };
$('demo-yes').onclick = () => { $('demo-ask').hidden = true; resetAll(true); loadDemo(); };
$('demo-save').onclick = () => { $('pj-save').click(); };
$('demo-ask').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); $('demo-ask').hidden = true; } });
$('relink-x').onclick = () => { $('relink').hidden = true; if (st.pendingProject) toast('Still waiting for the project files: load them and it restores itself'); };
$('relink-drop').onclick = () => { st.pendingProject = null; $('relink').hidden = true; };
$('relink-plate').onclick = () => $('f-plate').click();
$('relink-scan').onclick = () => $('f-scan').click();
$('relink-ref').onclick = () => $('f-vplref').click();
{ // botón del driving plate en la tarjeta (el resto del markup está en index.html)
  const b = document.createElement('button'); b.className = 'btn sm'; b.id = 'relink-drive'; b.hidden = true; b.textContent = 'Load driving plate';
  b.onclick = () => $('f-drv').click(); $('relink-ref').after(b);
}
['pointerdown', 'wheel'].forEach(t => $('relink').addEventListener(t, e => e.stopPropagation()));
// la tarjeta está fuera del visor (arriba de todo, en cualquier pestaña): soltar archivos sobre ella también los carga
$('relink').addEventListener('dragover', e => e.preventDefault());
$('relink').addEventListener('drop', e => { e.preventDefault(); dropFiles(e.dataTransfer); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('start').hidden) closeStart(); });

