// ---------- Playblast: render the viewport over the frame range and encode an MP4 (WebCodecs + mp4-muxer) ----------
const pb = { busy: false, cancel: false };
function pbDims() {
  const k = +$('pb-size').value || 1;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { W: even(st.plate.W * par() * k), H: even(st.plate.H * k) }; // anamorphic plates come out desqueezed
}
function pbInfo() {
  const d = pbDims(), n = tl.end - tl.start + 1;
  const p = pbPasses();
  const nmr = typeof nmNames === 'function' ? nmNames() : null;
  $('pb-info').textContent = (nmr && nmr.info ? `${nmr.pb}.mp4 · ` : '') + `Frames ${tl.start}–${tl.end} (${n}) at ${fmt(tl.fps, 3)} fps · ${d.W} × ${d.H} · H.264 MP4. What is shown in the viewport (plate, key, scan, environment, Mix) goes into the file.` +
    (p ? ' With passes, the MP4 and the passes come out together in one ZIP, with a README that says what each one is.' : '') +
    (typeof mtabCur !== 'undefined' && mtabCur === 'render3d' && typeof r3 !== 'undefined' // hook render3d: el motor del visor Render
      ? (r3.engine === 'pt' ? ` From 3D Render with Path trace: each frame path traced (${(() => { const q = r3PtPbQuality($('pb-ptq').value); return `${q.spp} samples, ${q.bounces} bounces`; })()}), with the camera, focus, background and exposure of the Render view; it takes a while, the time per frame shows in the title.${r3.pt.bg === 'alpha' ? ' An MP4 has no alpha: the transparent background comes out black (Render sequence in the Path trace section keeps it, as PNG).' : ''}`
        : ` From 3D Render: each frame as the Render view, ${r3.hq ? `${r3.samples} samples (Max quality)` : 'one sample (interactive)'}.`) : '');
  { const on = typeof mtabCur !== 'undefined' && mtabCur === 'render3d' && typeof r3 !== 'undefined' && r3.engine === 'pt'; $('pb-ptq-f').hidden = !on; }
  $('pb-go').textContent = p ? 'Render MP4 + passes' : 'Render MP4';
}
// passes for AI tools and Nuke (js/passes.js), or null
function pbPasses() { const o = { depth: $('pb-depth').checked, masks: $('pb-masks').checked, cam: $('pb-cam').checked }; return o.depth || o.masks || o.cam ? o : null; }
function loadMuxer() {
  if (window.Mp4Muxer) return Promise.resolve();
  return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/mp4-muxer.js'; sc.onload = res; sc.onerror = () => rej(new Error('Could not load the MP4 muxer')); document.head.appendChild(sc); });
}
// the plate as shown: the keyed one, the video frame, the EXR or the image
function pbPlateEl() { return !$('platekey').hidden ? $('platekey') : vplShowing() ? vpl.el : !$('platecv').hidden ? $('platecv') : !plateImg.hidden && plateImg.complete && plateImg.naturalWidth ? plateImg : null; }
// the driving plate (js/drive-plate.js) on the frame of the timeline: a video one seeks first
async function pbDriveReady() {
  if (typeof drvRender !== 'function') return;
  drvRender();
  for (let t = 0; drv.pending >= 0 && t < 300; t++) await new Promise(r => setTimeout(r, 10));
}
// one composited frame, like the viewport stack: environment (keyed) < driving plate < plate < scan/environment (Mix).
// Always the beauty: the Depth view is held off meanwhile.
function pbComposite(ctx, W, H) {
  dv.hold = true;
  ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (!$('glenv').hidden) { envRenderer.setPixelRatio(1); envRenderer.setSize(W, H, false); if (!zdfRender()) envRenderer.render(envScene, camera); /* hook zdefocus */ ctx.drawImage($('glenv'), 0, 0, W, H); }
  if (typeof drv !== 'undefined' && drv.gl && !$('drv-gl').hidden) { drvRender(); drv.gl.setPixelRatio(1); drv.gl.setSize(W, H, false); drv.gl.render(drv.scene, drv.cam3); ctx.drawImage($('drv-gl'), 0, 0, W, H); }
  if (!stage.classList.contains('noplate')) {
    const el = pbPlateEl();
    if (el) { const g = parseFloat(getComputedStyle(stage).getPropertyValue('--gain')) || 1; if (g !== 1) ctx.filter = `brightness(${g})`; ctx.drawImage(el, 0, 0, W, H); ctx.filter = 'none'; }
  }
  renderer.setPixelRatio(1); renderer.setSize(W, H, false); if (!zdfMain()) renderer.render(scene, camera);
  dv.hold = false;
  ctx.globalAlpha = parseFloat(canvas.style.opacity || '1'); ctx.drawImage(canvas, 0, 0, W, H); ctx.globalAlpha = 1;
  if ($('pb-mask').checked && maskAspect()) {
    const c = maskRect(), sx = W / st.plate.W, sy = H / st.plate.H;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(c.x * sx, c.y * sy, c.w * sx, c.h * sy); ctx.fill('evenodd');
  }
  if ($('pb-burn').checked) {
    const fs = Math.max(11, Math.round(H / 45)), pad = Math.round(fs * 0.8), m = motionAt(tlU());
    const left = `${st.plate.name || 'Camera Pin'}  ·  ${tl.frame}`;
    const right = `${fmt(focalUsed(), 1)} mm` + (ENV_MODULES[env.id] && env.vals.mon ? `  ·  ${((env.vals.speed || 0) * m.k).toFixed(1)} km/h` : '');
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, H - fs - pad * 2, W, fs + pad * 2);
    ctx.fillStyle = '#e8e8e8'; ctx.textAlign = 'left'; ctx.fillText(left, pad, H - pad); ctx.textAlign = 'right'; ctx.fillText(right, W - pad, H - pad);
  }
}
// download like Save project does: the viewer's downloads (claude.ai) or a normal browser download (Downloads folder)
async function pbDownload(blob, filename) {
  if (window.bplDesktop) { // app de escritorio: diálogo de Windows, y se sabe dónde quedó
    const r = await desktopSave(blob, filename);
    if (r.error) pbError(r.msg);
    else $('pb-file').innerHTML = r.canceled ? `<b>${esc(filename)}</b> · not saved (cancelled): <b>Save…</b> asks again` : `Saved to <b>${esc(r.path)}</b>`;
    toast(r.msg, !!r.error); return;
  }
  const where = `Saved as <b>${esc(filename)}</b> in your <b>Downloads</b> folder (or wherever your browser saves downloads).`;
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename, data: blob }); $('pb-file').innerHTML = where; toast('Saved to Downloads'); return; }
  } catch (e) { if (e && e.code === 'declined') { $('pb-file').innerHTML = `<b>${esc(filename)}</b> · not saved`; return; } if (e && e.code === 'too_large') { pbError('Too large to save from this view: try Half size'); return; } }
  const a = document.createElement('a'); a.href = blob === pb.blob && pb.url ? pb.url : URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  $('pb-file').innerHTML = where; toast('Saved to Downloads');
}
// pick the folder (Chrome / Edge, page opened directly, e.g. GitHub Pages)
async function pbSaveAs(blob, filename) {
  try {
    const h = await window.showSaveFilePicker({ suggestedName: filename, startIn: 'desktop', types: [/.zip$/.test(filename) ? { description: 'ZIP with the passes', accept: { 'application/zip': ['.zip'] } } : { description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
    const w = await h.createWritable(); await w.write(blob); await w.close();
    $('pb-file').innerHTML = `Saved as <b>${esc(h.name)}</b> in the folder you picked.`; toast('Playblast saved');
  } catch (e) { if (!e || e.name !== 'AbortError') pbError('Could not save there: ' + (e && e.message || e)); }
}
function pbError(m) { $('pb-err').textContent = m; $('pb-err').hidden = false; }
function pbMode(done) {
  $('pb-done').hidden = !done; $('pb-save').hidden = !done; $('pb-again').hidden = !done; $('pb-go').hidden = done;
  $('pb-saveas').hidden = !done || !!window.bplDesktop || !(window.showSaveFilePicker && window.self === window.top);
  $('pb-save').textContent = window.bplDesktop ? 'Save…' : 'Download again'; // en escritorio ya pregunta dónde
  if (!done) $('pb-err').hidden = true;
  ['pb-size', 'pb-burn', 'pb-mask', 'pb-depth'].forEach(id => $(id).closest('.fld').hidden = done); $('pb-info').hidden = done;
  if (done) $('pb-ptq-f').hidden = true;
  $('pb-cancel').textContent = done ? 'Close' : 'Cancel';
}
async function playblast() {
  if (pb.busy) return;
  if (typeof VideoEncoder === 'undefined') { toast('This browser cannot encode video (needs WebCodecs: Chrome, Edge or Safari 17+)', true); return; }
  pb.busy = true; pb.cancel = false; tlPlay(false);
  const { W, H } = pbDims(), fps = tl.fps, n = tl.end - tl.start + 1, keep = tl.frame, want = pbPasses();
  $('pb-go').disabled = true; $('pb-prog').hidden = false; $('pb-bar').style.width = '0';
  let encoder = null;
  try {
    await loadMuxer();
    // H.264 first; if this browser has no usable H.264 encoder, VP9 in the same MP4 container (plays in browsers, VLC, Resolve; not QuickTime).
    // Some browsers (Firefox) hand back chunks without a decoder config: VP9 then gets one built here; H.264 without its avcC falls back to VP9.
    const CANDS = [['avc1.640034', 'avc'], ['avc1.640033', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.42003e', 'avc'], ['vp09.00.50.08', 'vp9'], ['vp09.00.41.08', 'vp9']];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    const CS = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
    let muxer = null, lastErr = null, usedVp9 = false, zip = null, cams = [];
    for (const [codec, mux] of CANDS) {
      const sup = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 8e6, framerate: fps }).catch(() => null);
      if (!sup || !sup.supported) continue;
      if (mux === 'avc' && lastErr && lastErr.fallback === 'vp9') continue; // this browser's H.264 gave no avcC: go straight to VP9
      try {
        muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: Object.assign({ codec: mux, width: W, height: H }, Number.isInteger(fps) ? { frameRate: fps } : {}), fastStart: 'in-memory' });
        let encErr = null, first = true;
        zip = want ? passZip() : null; cams = []; // a codec that fails midway starts the passes over too
        encoder = new VideoEncoder({
          output: (chunk, meta) => {
            if (encErr) return;
            try {
              if (first) {
                first = false; meta = meta || {};
                const dc = meta.decoderConfig;
                if (mux === 'avc' && !(dc && dc.description)) { const e = new Error('H.264 without decoder description'); e.fallback = 'vp9'; throw e; }
                meta = { ...meta, decoderConfig: { codec, codedWidth: W, codedHeight: H, ...(dc || {}), colorSpace: (dc && dc.colorSpace && dc.colorSpace.primaries) ? dc.colorSpace : CS } };
              }
              muxer.addVideoChunk(chunk, meta);
            } catch (e) { encErr = e; }
          },
          error: e => { encErr = encErr || e; },
        });
        encoder.configure(Object.assign({ codec, width: W, height: H, bitrate: Math.min(60e6, Math.max(4e6, W * H * fps * 0.12)), framerate: fps }, mux === 'avc' ? { avc: { format: 'avc' } } : {}));
        for (let i = 0; i < n; i++) {
          if (pb.cancel) throw new Error('cancelled');
          if (encErr) throw encErr;
          tl.frame = tl.start + i; applyMotion();
          if (vplActive()) await vplSeek(tl.frame); // the video frame (and its key) on screen before compositing
          await pbDriveReady();
          // hook render3d: desde 3D Render, el cuadro sale del visor Render como el visor Render
          if (typeof r3PbFrame === 'function' && typeof mtabCur !== 'undefined' && mtabCur === 'render3d') await r3PbFrame(ctx, W, H); else pbComposite(ctx, W, H);
          if (zip && i === 0 && want.depth && dv.auto) dvAutoRange(); // el rango del PNG de profundidad: el de la escena en el primer frame
          if (zip) cams.push(await passFrame(zip, W, H, want, pbPlateEl()));
          const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
          encoder.encode(vf, { keyFrame: i % Math.max(1, Math.round(fps)) === 0 }); vf.close();
          while (encoder.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 5));
          if (encErr) throw encErr;
          $('pb-bar').style.width = ((i + 1) / n * 100).toFixed(1) + '%'; $('pb-t').textContent = `Playblast ${i + 1} / ${n}`;
          if (i % 4 === 3) await new Promise(r => setTimeout(r, 0)); // let the progress paint
        }
        await encoder.flush();
        if (encErr) throw encErr;
        muxer.finalize();
        usedVp9 = mux === 'vp9'; lastErr = null;
        break;
      } catch (e) {
        try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch (_) {}
        if (e && e.message === 'cancelled') throw e;
        console.warn('playblast encoder', codec, e); lastErr = e; muxer = null;
      }
    }
    if (!muxer) throw lastErr || new Error(`no video encoder for ${W} × ${H} here: try Half size`);
    if (usedVp9) toast('This browser has no usable H.264 encoder: the MP4 uses VP9 (plays in browsers, VLC and Resolve, not QuickTime)');
    const nmr = typeof nmNames === 'function' ? nmNames() : null; // hook settings: el nombre de la convención (Settings › Naming)
    const base = nmr && nmr.info ? nmr.pb : ((st.plate.empty ? '' : st.plate.name) || 'backplatelab').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
    // keep the result: preview it right here, save it where you want
    if (pb.url) URL.revokeObjectURL(pb.url);
    const mp4 = new Blob([muxer.target.buffer], { type: 'video/mp4' }), mp4Name = nmr && nmr.info ? `${base}.mp4` : `${base}_playblast_${tl.start}-${tl.end}.mp4`;
    if (pb.vurl) URL.revokeObjectURL(pb.vurl);
    pb.vurl = URL.createObjectURL(mp4); pb.blob = mp4; pb.name = mp4Name;
    if (zip) {
      const o = { plate: st.plate.empty ? '' : st.plate.name, start: tl.start, end: tl.end, fps, W, H, want, mp4: mp4Name, near: +dv.near.toFixed(3), far: +dv.far.toFixed(3), sky: camera.far };
      zip.add(mp4Name, new Uint8Array(muxer.target.buffer), false);
      if (want.cam) zip.add('camera.json', new TextEncoder().encode(passCameraJson(o, cams)), true);
      zip.add('README.txt', new TextEncoder().encode(passReadme(o)), true);
      pb.blob = zip.end(); pb.name = `${base}_passes_${tl.start}-${tl.end}.zip`;
    }
    pb.url = pb.blob === mp4 ? pb.vurl : URL.createObjectURL(pb.blob);
    $('pb-video').src = pb.vurl; $('pb-file').innerHTML = `<b>${esc(pb.name)}</b> · ${(pb.blob.size / 1048576).toFixed(1)} MB · not saved yet`;
    pbMode(true); $('pb-video').play().catch(() => {});
    await pbDownload(pb.blob, pb.name);
  } catch (e) {
    if (e && e.message !== 'cancelled') { console.error(e); pbError('Playblast failed: ' + (e.message || e)); }
  } finally {
    try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch (e) {}
    if (dv.rt && want) { dv.rt.dispose(); dv.rt = null; } // el RT float de los pases, a 4K son 160 MB de GPU
    if (typeof r3PbDone === 'function' && typeof mtabCur !== 'undefined' && mtabCur === 'render3d') r3PbDone();
    pb.busy = false; $('pb-go').disabled = false; $('pb-prog').hidden = true; $('pb-t').textContent = 'Playblast and passes';
    tl.frame = keep; applyMotion(); applyView(); tlUI(); vplSeek(keep);
  }
}
$('pb-open').onclick = () => { pbInfo(); pbMode(false); $('pb-dlg').hidden = false; };
$('pb-save').onclick = () => { if (pb.blob) pbDownload(pb.blob, pb.name); };
$('pb-saveas').onclick = () => { if (pb.blob) pbSaveAs(pb.blob, pb.name); };
$('pb-again').onclick = () => { $('pb-video').pause(); pbInfo(); pbMode(false); };
$('pb-size').onchange = pbInfo; $('pb-ptq').onchange = pbInfo;
['pb-depth', 'pb-masks', 'pb-cam'].forEach(id => $(id).onchange = pbInfo);
$('pb-go').onclick = playblast;
$('pb-cancel').onclick = () => { if (pb.busy) pb.cancel = true; else { $('pb-video').pause(); $('pb-dlg').hidden = true; } };
$('pb-dlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); $('pb-cancel').click(); } });
$('f-cars').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) loadCarFiles(fs); };
$('env-shuffle').onclick = () => { env.seed = (env.seed * 9301 + 49297) % 233280 + 1; envSave(); envRebuild(); };
$('env-ground').onclick = () => {
  const b = new THREE.Box3().setFromObject(scanRoot);
  if (!b.isEmpty()) { envSet('y', +(b.min.y - (env.id === 'rail' ? env.vals.floorH || 0 : 0)).toFixed(3)); lsSet('env.vals.' + env.id, env.vals); }
};
$('mo-reset').onclick = () => {
  if (!ENV_MODULES[env.id]) return;
  ENV_MOTION.forEach(p => { if (p.key !== 'mon') env.vals[p.key] = p.def; }); // keeps Motion on as it is
  lsSet('env.vals.' + env.id, env.vals); envRenderParams(); envSave(); envRebuild(); tlUI();
};
$('env-reset').onclick = () => { env.vals = envDefaults(env.id); lsSet('env.vals.' + env.id, null); envRenderParams(); envSave(); envRebuild(); };
{
  const s = lsGet('env', null);
  if (s && ENV_MODULES[s.id]) {
    env.seed = s.seed || 7; env.display = s.display || 'solid'; $('env-disp').value = env.display;
    envSelect(s.id); env.on = !!s.on; envSave(); envRebuild();
  } else { $('env-mod').value = 'none'; envRebuild(); }
}

