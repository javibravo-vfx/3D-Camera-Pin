// ---------- Video plate: MP4 / MOV / WebM as the plate, frame-exact against the timeline ----------
// Frame i of the video is timeline frame vpl.first + i. Paused: seek to the middle of the frame and
// wait for requestVideoFrameCallback (the frame really on screen). Playing: the video plays by itself
// and each presented frame moves the timeline (environment, key) with it.
const VPL_FIRST = 1001;
const VPL_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const vpl = { el: null, url: '', name: '', fps: 24, n: 0, first: VPL_FIRST, t0: 0, tc: null, want: -1, shown: -1, busy: false, cbs: [], showExr: false, ref: null };
function vplActive() { return !!vpl.el; }
function vplShowing() { return !!vpl.el && !vpl.showExr; }
function vplIsVideo(f) { return f.type.startsWith('video/') || VPL_EXT.test(f.name); }

// fps, frame count and start timecode from the MP4 / MOV header (the <video> element does not say)
async function vplMp4Info(file) {
  const rd = async (a, b) => new DataView(await file.slice(a, b).arrayBuffer());
  const kids = (dv, s, e) => { const out = []; while (s + 8 <= e) { let sz = dv.getUint32(s); const t = String.fromCharCode(dv.getUint8(s + 4), dv.getUint8(s + 5), dv.getUint8(s + 6), dv.getUint8(s + 7)); let h = 8; if (sz === 1) { sz = Number(dv.getBigUint64(s + 8)); h = 16; } else if (sz === 0) sz = e - s; if (sz < h) break; out.push({ t, s: s + h, e: Math.min(s + sz, e) }); s += sz; } return out; };
  const kid = (dv, b, t) => b && kids(dv, b.s, b.e).find(k => k.t === t);
  let off = 0, moov = null;
  while (off + 8 <= file.size && !moov) {
    const hd = await rd(off, Math.min(off + 16, file.size)); let sz = hd.getUint32(0);
    if (sz === 1) sz = Number(hd.getBigUint64(8)); else if (sz === 0) sz = file.size - off;
    if (sz < 8) return null;
    if (hd.getUint32(4) === 0x6d6f6f76) moov = await rd(off, off + sz); // 'moov'
    off += sz;
  }
  if (!moov) return null;
  const out = {};
  for (const trak of kids(moov, 8, moov.byteLength).filter(b => b.t === 'trak')) {
    const mdia = kid(moov, trak, 'mdia'), hdlr = kid(moov, mdia, 'hdlr'), mdhd = kid(moov, mdia, 'mdhd');
    const stbl = kid(moov, kid(moov, mdia, 'minf'), 'stbl');
    if (!hdlr || !mdhd || !stbl) continue;
    const ht = moov.getUint32(hdlr.s + 8), ts = moov.getUint32(mdhd.s + (moov.getUint8(mdhd.s) === 1 ? 20 : 12));
    if (ht === 0x76696465 && !out.fps) { // 'vide'
      const stts = kid(moov, stbl, 'stts'); if (!stts) continue;
      let n = 0, dur = 0;
      for (let k = 0, c = moov.getUint32(stts.s + 4); k < c; k++) { const cnt = moov.getUint32(stts.s + 8 + k * 8); n += cnt; dur += cnt * moov.getUint32(stts.s + 12 + k * 8); }
      if (n && dur) { out.n = n; out.fps = n * ts / dur; }
    } else if (ht === 0x746d6364 && !out.tc) { // 'tmcd': start frame count in its first sample
      const stsd = kid(moov, stbl, 'stsd'), stco = kid(moov, stbl, 'stco'), co64 = kid(moov, stbl, 'co64');
      if (!stsd || !(stco || co64)) continue;
      const ent = stsd.s + 8, nominal = moov.getUint8(ent + 32), df = !!(moov.getUint32(ent + 20) & 1); // tmcd flags: bit 0 = drop frame
      const at = stco ? moov.getUint32(stco.s + 8) : Number(moov.getBigUint64(co64.s + 8));
      if (nominal) out.tc = { start: (await rd(at, at + 4)).getUint32(0), rate: nominal, df: df && nominal % 30 === 0 };
    }
  }
  if (out.fps) { // a stored 23.976 is 2402/2403 ticks per frame: snap to the real rate
    const std = vplStdRate(out.fps, 1e-4);
    if (std) out.fps = std;
  }
  return out.fps ? out : null;
}
const VPL_RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60];
function vplStdRate(fps, tol) {
  const best = VPL_RATES.reduce((a, s) => Math.abs(fps / s - 1) < Math.abs(fps / a - 1) ? s : a);
  return Math.abs(fps / best - 1) < tol ? best : null;
}
// WebM / MKV no dicen el fps en ningún lado que el navegador muestre: se reproduce mudo el principio
// y se miden los mediaTime de los frames presentados. Si se saltea alguno, su salto es un múltiplo del
// paso más chico. Los timestamps de WebM vienen en ms: con ~50 frames el error queda bajo 0,05 %, y
// 23.976 y 24 se separan por 0,1 %.
async function vplMeasureFps(el) {
  const ts = [];
  await new Promise(res => {
    let over = false;
    const done = () => { if (over) return; over = true; el.pause(); res(); };
    const cb = (now, m) => { if (over) return; ts.push(m.mediaTime); if (ts.length >= 50) done(); else el.requestVideoFrameCallback(cb); };
    el.requestVideoFrameCallback(cb);
    setTimeout(done, 3000);
    el.addEventListener('ended', done, { once: true });
    el.play().catch(done);
  });
  const d = []; for (let i = 1; i < ts.length; i++) if (ts[i] > ts[i - 1]) d.push(ts[i] - ts[i - 1]);
  if (d.length < 4) return null;
  const step = Math.min(...d); let span = 0, frames = 0;
  for (const x of d) { const k = Math.round(x / step); if (Math.abs(x / step - k) < 0.3) { span += x; frames += k; } }
  const fps = frames / span;
  return { fps: vplStdRate(fps, 0.005) || +fps.toFixed(3) };
}

async function vplLoadFile(file) {
  setBusy(true, 'Reading ' + file.name + '…');
  const info = /\.(mp4|m4v|mov)$/i.test(file.name) ? await vplMp4Info(file).catch(e => { console.warn('video header', e); return null; }) : null;
  const el = document.createElement('video');
  el.id = 'platevid'; el.muted = true; el.playsInline = true; el.preload = 'auto'; el.disablePictureInPicture = true;
  const url = URL.createObjectURL(file);
  try {
    await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(el.error); el.src = url; });
  } catch (e) {
    URL.revokeObjectURL(url); setBusy(false);
    plateFail(`The browser cannot play ${file.name} (ProRes and DNxHR are not supported here). Convert it to H.264 MP4. ${PLATE_FORMATS}`);
    return;
  }
  // where frame 0 really starts (an edit list or a composition offset can shift it): the first frame put on screen says
  const firstAt = new Promise(r => { el.requestVideoFrameCallback((_, m) => r(m.mediaTime)); setTimeout(() => r(null), 1500); });
  if (tl.playing) tlPlay(false);
  setPlate(url, el.videoWidth, el.videoHeight, file.name, false, el);
  // sin fps en el encabezado se mide; si tampoco se puede, queda el FPS de la timeline (se cambia a mano)
  const meas = info ? null : await vplMeasureFps(el).catch(e => { console.warn('video fps', e); return null; });
  // al reproducir, el primer frame que avisa puede no ser el 0: se vuelve al principio y ése dice dónde arranca
  const back = meas ? new Promise(r => { el.requestVideoFrameCallback((_, m) => r(m.mediaTime)); el.currentTime = 0; setTimeout(() => r(null), 1500); }) : null;
  const fps = info ? info.fps : meas ? meas.fps : tl.fps;
  const n = info ? info.n : Math.max(1, Math.round(el.duration * fps));
  Object.assign(vpl, { url, name: file.name, fps, n, first: VPL_FIRST, t0: 0, tc: info && info.tc, want: -1, shown: -1, busy: false });
  st.pins = []; st.sel = -1; st.solved = null; st.rms = null;
  tl.fps = +fps.toFixed(3); tl.start = vpl.first; tl.end = vpl.first + n - 1; tl.frame = tl.start;
  $('tl-in').value = tl.start; $('tl-out').value = tl.end; $('tl-fps').value = tl.fps; tlSave();
  const t0 = meas ? await back : await firstAt;
  if (t0 != null && t0 < 1) vpl.t0 = t0;
  vpl.shown = 0;
  envRebuild(); tlSet(tl.start);
  setBusy(false);
  if (!info) toast(meas ? `${file.name}: ${fmt(fps, 3)} fps measured from its frames` : `No frame rate in ${file.name}: using ${fmt(fps, 3)} fps from the timeline`, !meas);
  refreshAll();
  projectAfterLoad('plate');
}
// called by setPlate: a video plate goes into the stage, any other plate removes it
function vplAttach(el) {
  vplClear();
  vpl.el = el; vpl.showExr = false;
  stage.insertBefore(el, $('platecv'));
  el.addEventListener('ended', () => { if (!tl.playing) return; if (tl.loop) { el.currentTime = vplTime(tl.start); el.play().catch(() => {}); } else tlPlay(false); });
  $('vpl-ref-row').hidden = false; vplRefUI();
}
function vplClear() {
  if (!vpl.el) return;
  vpl.el.pause(); vpl.el.remove(); vpl.el.removeAttribute('src'); vpl.el.load();
  URL.revokeObjectURL(vpl.url);
  vpl.cbs.splice(0).forEach(r => r());
  Object.assign(vpl, { el: null, url: '', name: '', tc: null, ref: null, showExr: false, busy: false, want: -1, shown: -1 });
  $('vpl-ref-row').hidden = true; $('vpl-read').hidden = true;
}
function vplIndex(f) { return Math.min(Math.max(Math.round(f) - vpl.first, 0), vpl.n - 1); }
function vplTime(f) { return vpl.t0 + (vplIndex(f) + 0.5) / vpl.fps; } // middle of the frame: never lands on the neighbour

// paused: show timeline frame f; the promise resolves once that frame is on screen
function vplSeek(f) {
  if (!vpl.el) return Promise.resolve();
  return new Promise(res => {
    vpl.cbs.push(res);
    if (tl.playing) return vplSettle();
    vpl.want = vplIndex(f);
    if (!vpl.busy) vplGo();
  });
}
function vplGo() {
  const el = vpl.el, i = vpl.want;
  if (i === vpl.shown) return vplSettle();
  vpl.busy = true;
  let done = false;
  const fin = () => {
    if (done || el !== vpl.el) return; done = true;
    vpl.busy = false; vpl.shown = i;
    if (vpl.want !== i) return vplGo();
    vplSettle();
  };
  // sólo vale el frame pedido: al pausar, uno que ya venía en camino puede presentarse antes que el del seek
  const onFrame = (now, m) => { if (done || el !== vpl.el) return; if (Math.round((m.mediaTime - vpl.t0) * vpl.fps) !== i) el.requestVideoFrameCallback(onFrame); else fin(); };
  el.requestVideoFrameCallback(onFrame);
  el.addEventListener('seeked', () => setTimeout(fin, 250), { once: true }); // safety net if no new frame gets presented
  el.currentTime = vpl.t0 + (i + 0.5) / vpl.fps;
}
function vplSettle() {
  if (key.on && vplShowing()) applyKey();
  vplUI();
  vpl.cbs.splice(0).forEach(r => r());
}
function vplPlay(on) {
  const el = vpl.el;
  if (!on) { el.pause(); vpl.shown = -1; vplSeek(tl.frame); return; } // pause lands mid-frame: snap to the exact one
  el.playbackRate = tl.fps / vpl.fps;
  el.currentTime = vplTime(tl.frame);
  const tick = (now, m) => {
    if (!tl.playing || vpl.el !== el) return;
    const f = vpl.first + Math.round((m.mediaTime - vpl.t0) * vpl.fps);
    if (f > tl.end || f < tl.start) {
      if (tl.loop) el.currentTime = vplTime(tl.start); else { tlPlay(false); return; }
    } else if (f !== tl.frame) { tlSet(f, true); if (key.on && vplShowing()) applyKey(); }
    el.requestVideoFrameCallback(tick);
  };
  el.requestVideoFrameCallback(tick);
  el.play().catch(e => { console.warn('video play', e); tlPlay(false); });
}

// timecode and video frame for the bar
function vplTcAt(f) {
  let base = null, rate = 0;
  if (vpl.tc) { base = vpl.tc.start + (f - vpl.first); rate = vpl.tc.rate; }
  else if (vpl.ref && vpl.ref.tc != null) { base = vpl.ref.tc + (f - vpl.ref.frame); rate = vpl.ref.rate; }
  if (base == null || !rate || base < 0) return '';
  const df = vpl.tc && vpl.tc.df;
  if (df) { // drop frame (29.97 / 59.94): se saltean los números 0 y 1 (0-3 a 60) de cada minuto salvo cada diez
    const drop = rate / 15, perMin = rate * 60 - drop, per10 = rate * 600 - drop * 9;
    const d10 = Math.floor(base / per10), m = base % per10;
    base += drop * 9 * d10 + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
  }
  const p = (n) => String(n).padStart(2, '0'), s = Math.floor(base / rate);
  return `${p(Math.floor(s / 3600) % 24)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}${df ? ';' : ':'}${p(base % rate)}`;
}
function vplUI() {
  const r = $('vpl-read'); if (!r) return;
  r.hidden = !vpl.el; if (!vpl.el) return;
  const tc = vplTcAt(tl.frame), i = tl.frame - vpl.first;
  const out = i < 0 || i >= vpl.n;
  $('vpl-tc').textContent = tc || '';
  $('vpl-tc').hidden = !tc;
  $('vpl-vf').textContent = out ? `past the clip (${vpl.n} fr)` : `${i + 1} / ${vpl.n}`;
  r.classList.toggle('out', out);
  r.title = `${vpl.name} · ${fmt(vpl.fps, 3)} fps · ${vpl.n} frames` + (tc ? ` · timecode from ${vpl.tc ? 'the video' : 'the reference EXR'}` : '');
}

// ---------- Reference EXR: one frame of the same plate for the camera metadata (and an HDR still) ----------
async function vplLoadRef(file) {
  if (!vpl.el) return exrState ? vplLoadMetaRef(file) : undefined;
  setBusy(true, 'Reading ' + file.name + '…');
  await new Promise(r => setTimeout(r, 30));
  try {
    const buf = await file.arrayBuffer();
    const h = EXR.parseHeader(buf), px = EXR.decode(buf, h);
    const [cs, why] = EXR.detectSpace(h);
    exrState = { h, px, name: file.name, cs, why };
    $('cs').value = cs; $('ev').value = 0; $('ev-v').textContent = '+0.00 EV';
    const d = drawExr();
    const tcs = h.get('timeCode'), fr = h.get('framesPerSecond'), m = file.name.match(/(\d+)\.exr$/i);
    const rate = Math.round(Array.isArray(fr) && fr[1] ? fr[0] / fr[1] : +fr || tl.fps);
    const tc = typeof tcs === 'string' && m ? tcs.split(':').map(Number).reduce((a, x, k) => k < 3 ? a * (k === 0 ? 1 : 60) + x : a * rate + x, 0) : null;
    vpl.ref = { name: file.name, W: d.W, H: d.H, frame: m ? +m[1] : null, tc, rate };
    $('exr-box').hidden = false; $('cs').disabled = false; $('view').disabled = false;
    vplFormat(); // antes de la metadata: el modo de grabación se elige con el formato del plate
    camApplyExrMetadata(h, file.name);
    const v = vpl.el;
    if (Math.abs(d.W / d.H - v.videoWidth / v.videoHeight) > 0.005) toast(`${file.name} is ${d.W} × ${d.H}, not the shape of the video (${v.videoWidth} × ${v.videoHeight})`, true);
    vplRefUI(); refreshAll();
    projectAfterLoad('ref'); // un proyecto que lo nombra espera este EXR
  } catch (err) {
    console.error(err); toast('Could not open ' + file.name + ': ' + (err.message || err), true);
  }
  setBusy(false);
}
// Plate EXR sin cámara en el header (un render de Nuke pierde la metadata ARRI): la fila Reference EXR aparece
// y el EXR elegido sólo aporta la metadata (la imagen sigue siendo la del plate). Con video no se toca.
function vplMetaRefRow(show) {
  if (vpl.el) return;
  vpl.ref = null;
  $('vpl-ref-row').hidden = !show; $('vpl-show').hidden = true;
  $('vpl-ref-name').textContent = $('vpl-ref-name').title = 'no camera in this EXR: load one frame of the same plate with metadata (the one in _input)';
}
async function vplLoadMetaRef(file) {
  setBusy(true, 'Reading ' + file.name + '…');
  try {
    const h = EXR.parseHeader(await file.arrayBuffer()), dw = h.get('dataWindow');
    const W = dw ? dw.xMax - dw.xMin + 1 : 0, H = dw ? dw.yMax - dw.yMin + 1 : 0;
    vpl.ref = { name: file.name, W, H, metaOnly: true };
    camApplyExrMetadata(h, file.name);
    if (W && Math.abs(W / H - st.plate.W / st.plate.H) > 0.005) toast(`${file.name} is ${W} × ${H}, not the shape of the plate (${st.plate.W} × ${st.plate.H})`, true);
    $('vpl-ref-name').textContent = $('vpl-ref-name').title = `${file.name} · camera metadata only (the plate image stays)`;
    refreshAll();
    projectAfterLoad('ref'); // hook project: un proyecto que lo nombra espera este EXR
  } catch (err) {
    console.error(err); toast('Could not open ' + file.name + ': ' + (err.message || err), true);
  }
  setBusy(false);
}
// D-04, el formato del plate: un video a otra resolución que su EXR de referencia (con la misma
// proporción) es sólo la imagen que se muestra, escalada. st.plate.W / H, que usa todo lo que va en px
// del plate (bokeh y Copy Defocus, figuras, CornerPin y análisis del driving, playblast y pases, export),
// pasa a ser el del EXR. Lo ya puesto en px del plate (pins, sondas) se escala con él.
function vplFormat() {
  if (!vpl.el) return;
  const v = vpl.el, r = vpl.ref, vw = v.videoWidth, vh = v.videoHeight;
  const fromRef = !!r && (r.W !== vw || r.H !== vh) && Math.abs(r.W * vh / (r.H * vw) - 1) < 0.005;
  const W = fromRef ? r.W : vw, H = fromRef ? r.H : vh;
  st.plate.fromRef = fromRef;
  if (W !== st.plate.W || H !== st.plate.H) {
    const kx = W / st.plate.W, ky = H / st.plate.H;
    st.pins.forEach(p => { if (p.uv) p.uv = [p.uv[0] * kx, p.uv[1] * ky]; });
    if (typeof bokehState !== 'undefined') bokehState.probes.forEach(p => { p.u *= kx; p.v *= ky; if (p.measuredPx) p.measuredPx *= kx; });
    st.plate.W = W; st.plate.H = H;
    layoutStage(true); applyIntrinsics(); checkAspect();
  }
  $('plate-name').textContent = `${st.plate.name} · ${W} × ${H}` + (fromRef ? ` (format of the reference EXR · video ${vw} × ${vh})` : '');
  $('tag').textContent = W + ' × ' + H + (par() !== 1 ? ' · PAR ' + par() : '');
}
function vplShowRef(on) {
  if (!vpl.el || (on && !exrState)) return;
  vpl.showExr = on; vplRefUI();
  if (key.on) applyKey();
}
function vplRefUI() {
  const has = !!(vpl.ref && exrState);
  $('vpl-ref-name').textContent = has ? `${vpl.ref.name} · ${vpl.ref.W} × ${vpl.ref.H}` + (st.plate.fromRef ? ` · plate format ${st.plate.W} × ${st.plate.H} (from the reference EXR) · video ${vpl.el.videoWidth} × ${vpl.el.videoHeight}` : '') : 'camera metadata from one EXR frame';
  $('vpl-ref-name').title = $('vpl-ref-name').textContent; $('vpl-show').hidden = !has;
  $('vpl-v-video').setAttribute('aria-pressed', String(!vpl.showExr)); $('vpl-v-exr').setAttribute('aria-pressed', String(vpl.showExr));
  if (vpl.el) vpl.el.classList.toggle('off', vpl.showExr);
  $('platecv').hidden = !vpl.showExr;
  vplUI();
}
$('f-vplref').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) vplLoadRef(f); };
$('vpl-v-video').onclick = () => vplShowRef(false);
$('vpl-v-exr').onclick = () => vplShowRef(true);
