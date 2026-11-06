// ---------- Display ----------
// unlit copy of a material: texture / vertex colors shown at full value, no lighting
function flatOf(m) {
  if (Array.isArray(m)) return m.map(flatOf);
  if (!m) return MAT.solid;
  const f = new THREE.MeshBasicMaterial({
    map: m.map || null,
    color: m.map ? 0xffffff : (m.color ? m.color.clone() : 0xffffff),
    vertexColors: !!m.vertexColors,
    side: THREE.DoubleSide,
    transparent: !!m.transparent, opacity: m.opacity ?? 1, alphaTest: m.alphaTest || 0,
  });
  return f;
}
function applyDisplay() {
  const mode = $('disp').value, op = +$('opac').value, ps = +$('ptsize').value;
  canvas.style.opacity = op;
  MAT.wire.opacity = 0.9; MAT.solid.opacity = 1;
  PTS.mono.size = ps;
  if (!scanObj) return render();
  let hasSplat = false; scanObj.traverse(o => { if (o.userData.isSplat) hasSplat = true; });
  scanObj.traverse(o => {
    if (o.userData.isSplat) { o.visible = mode === 'splat'; return; }
    if (o.isPoints && hasSplat) o.visible = mode !== 'splat';
    if (o.isMesh) {
      if (mode === 'flat' && !o.userData.flat) o.userData.flat = flatOf(o.userData.orig);
      o.material = mode === 'wire' ? MAT.wire : mode === 'solid' ? MAT.solid : mode === 'flat' ? o.userData.flat : o.userData.orig; // 'splat' on a mesh: its own materials
    }
    if (o.isPoints) {
      if ((mode === 'orig' || mode === 'flat' || mode === 'splat') && o.geometry.attributes.color) {
        if (!o.userData.colMat) o.userData.colMat = new THREE.PointsMaterial({ size: ps, sizeAttenuation: false, vertexColors: true });
        o.userData.colMat.size = ps; o.material = o.userData.colMat;
      } else o.material = PTS.mono;
    }
  });
  render(); drawOverlay();
}


// ---------- Plate ----------
// video: the <video> element of a video plate (video-plate.js); url is then the video's
function setPlate(url, W, H, name, sample, video) {
  st.plate = { W, H, name, sample };
  $('empty').hidden = true;
  if (video) { vplAttach(video); plateImg.removeAttribute('src'); plateImg.hidden = true; $('platecv').hidden = true; }
  else {
    vplClear();
    if (url) { plateImg.onload = () => { if (key.on) keyLater(); }; plateImg.src = url; plateImg.hidden = false; $('platecv').hidden = true; }
    else { plateImg.hidden = true; $('platecv').hidden = false; }
  }
  if (url) {
    $('exr-box').hidden = true; exrState = null; st.metaCamera = null; st.metaFocal = null;
    camClearMeta(); // hook camera
    $('cs').value = 'disp'; $('cs').disabled = true; $('view').disabled = true;
  } else { $('cs').disabled = false; $('view').disabled = false; }
  $('plate-name').textContent = (sample ? 'Sample' : name) + ' · ' + W + ' × ' + H;
  $('tag').textContent = W + ' × ' + H + (par() !== 1 ? ' · PAR ' + par() : '');
  layoutStage(true);
  applyIntrinsics();
  checkAspect();
  if ($('par-note')) $('par-note').textContent = Math.abs(par() - 1) < 1e-6 ? 'square' : `${(W * par() / H).toFixed(2)}:1 desqueezed`;
  refreshAll();
}
// un plate que no se puede abrir lo dice en un cartel (la sección del plate puede estar cerrada), con qué se espera
const PLATE_FORMATS = 'A plate is an EXR, JPG or PNG still, or an H.264 MP4 / MOV clip.';
function plateFail(msg) { showMsg('aspect-msg', msg, 'msg bad'); toast(msg, true); }
function loadPlateFile(file) {
  if (/\.exr$/i.test(file.name)) return loadExrFile(file);
  if (vplIsVideo(file)) return vplLoadFile(file);
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = () => {
    setPlate(url, im.naturalWidth, im.naturalHeight, file.name, false);
    st.pins.forEach(p => { p.uv = null; });
    st.pins = []; st.solved = null; st.rms = null;
    refreshAll();
    projectAfterLoad('plate');
  };
  im.onerror = () => { URL.revokeObjectURL(url); plateFail(`Could not open ${file.name} as a plate. ${PLATE_FORMATS} (DPX is not supported.)`); };
  im.src = url;
}
function checkAspect() {
  if (st.shAuto) { st.sh = +autoSh().toFixed(3); $('sh').value = st.sh; }
  const a1 = st.plate.W / st.plate.H, a2 = st.sw / shUsed();
  const d = Math.abs(a1 / a2 - 1);
  const m = $('aspect-msg');
  if (d > 0.01) {
    m.hidden = false; m.className = 'msg';
    m.textContent = `The plate is ${a1.toFixed(3)}:1 in pixels and the film back ${a2.toFixed(3)}:1. The solve uses the film width as the reference; the manual height only goes into the export. If the plate is cropped or reframed, enter the film back of the area it actually shows.`;
  } else m.hidden = true;
}

