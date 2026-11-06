// ---------- Scan texture from an image ----------
function applyTextureFile(file) {
  if (!scanObj) return;
  const url = URL.createObjectURL(file);
  new THREE.TextureLoader().load(url, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = !(st.scanFmt === 'glb' || st.scanFmt === 'gltf');
    let meshes = 0, withUV = 0;
    scanObj.traverse(o => {
      if (!o.isMesh || o.userData.isSplat) return;
      meshes++; if (o.geometry.attributes.uv) withUV++;
      if (!o.userData.origBackup) o.userData.origBackup = o.userData.orig;
      o.userData.orig = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
      o.userData.flat = null;
    });
    $('tex-name').textContent = file.name; $('tex-clear').hidden = false;
    if (!meshes) showMsg('unit-msg', 'Textures only apply to meshes; this scan is a point cloud.', 'msg');
    else if (withUV < meshes) showMsg('unit-msg', `${meshes - withUV} of ${meshes} meshes have no UVs, so the image cannot map onto them.`, 'msg bad');
    if ($('disp').value === 'solid') { $('disp').value = 'flat'; lsSet('disp', 'flat'); }
    applyDisplay();
  }, undefined, () => showMsg('unit-msg', 'Could not read ' + file.name + ' as an image.', 'msg bad'));
}
$('f-tex').onchange = e => { const f = e.target.files[0]; if (f) applyTextureFile(f); e.target.value = ''; };
$('tex-clear').onclick = () => {
  scanObj && scanObj.traverse(o => { if (o.isMesh && o.userData.origBackup) { o.userData.orig = o.userData.origBackup; o.userData.origBackup = null; o.userData.flat = null; } });
  $('tex-name').textContent = 'from file'; $('tex-clear').hidden = true; applyDisplay();
};
// ---------- Chroma key UI ----------
function keyUI() {
  $('key-on').checked = key.on; $('key-opts').hidden = !key.on;
  $('key-chip').setAttribute('aria-pressed', String(key.on));
  $('key-g').setAttribute('aria-pressed', String(key.screen === 'green')); $('key-b').setAttribute('aria-pressed', String(key.screen === 'blue'));
  $('key-comp').setAttribute('aria-pressed', String(key.view === 'comp')); $('key-matte').setAttribute('aria-pressed', String(key.view === 'matte'));
  for (const k of ['thr', 'soft']) { $('key-' + k).value = key[k]; $('key-' + k + '-r').value = key[k]; }
  $('key-despill').checked = key.despill;
  lsSet('key', { screen: key.screen, thr: key.thr, soft: key.soft, despill: key.despill });
}
function setKey(patch) { Object.assign(key, patch); keyUI(); keyLater(); }
function toggleKey() { setKey({ on: !key.on }); }
{ const k = lsGet('key', null); if (k) Object.assign(key, k); keyUI(); }
$('key-on').onchange = () => setKey({ on: $('key-on').checked });
$('key-chip').onclick = toggleKey;
$('key-chip').addEventListener('pointerdown', e => e.stopPropagation());
$('key-g').onclick = () => setKey({ screen: 'green' });
$('key-b').onclick = () => setKey({ screen: 'blue' });
$('key-comp').onclick = () => setKey({ view: 'comp' });
$('key-matte').onclick = () => setKey({ view: 'matte' });
$('key-despill').onchange = () => setKey({ despill: $('key-despill').checked });
for (const k of ['thr', 'soft']) {
  $('key-' + k).oninput = () => { const v = +$('key-' + k).value; if (Number.isFinite(v)) setKey({ [k]: v }); };
  $('key-' + k + '-r').oninput = () => setKey({ [k]: +$('key-' + k + '-r').value });
}
// ---------- Environment UI ----------
$('env-mod').innerHTML = '<option value="none">None</option>' + Object.entries(ENV_MODULES).map(([k, m]) => `<option value="${k}">${m.name}</option>`).join('');
$('env-mod').onchange = () => envSelect($('env-mod').value);
$('env-on').onclick = toggleEnv;
$('envmix').addEventListener('input', () => envMixApply());
$('envmix').addEventListener('dblclick', () => { $('envmix').value = 1; envMixApply(); });
$('env-disp').onchange = () => { env.display = $('env-disp').value; envSave(); envRebuild(); };
['env-params', 'motion-params'].forEach(id => $(id).addEventListener('input', e => {
  const k = e.target.dataset.k; if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.tagName === 'SELECT' ? e.target.value : +e.target.value;
  if (e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT' && !Number.isFinite(v)) return;
  envSet(k, v);
  lsSet('env.vals.' + env.id, env.vals);
}));
const TL_ICON = {
  first: '<svg viewBox="0 0 24 24"><path d="M6 5v14M18 5 9 12l9 7z"/></svg>', prev: '<svg viewBox="0 0 24 24"><path d="M16 5 8 12l8 7z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="m8 5 8 7-8 7z"/></svg>', last: '<svg viewBox="0 0 24 24"><path d="M18 5v14M6 5l9 7-9 7z"/></svg>',
};
['first', 'prev', 'next', 'last'].forEach(k => $('tl-' + k).innerHTML = TL_ICON[k]);
{ const s0 = lsGet('tl', null); if (s0) { tl.start = s0.start; tl.end = s0.end; tl.fps = s0.fps; tl.loop = s0.loop !== false; } tl.frame = tl.start;
  $('tl-in').value = tl.start; $('tl-out').value = tl.end; $('tl-fps').value = tl.fps; $('tl-loop').checked = tl.loop; }
$('tl-first').onclick = () => { tlPlay(false); tlSet(tl.start); };
$('tl-last').onclick = () => { tlPlay(false); tlSet(tl.end); };
$('tl-prev').onclick = () => { tlPlay(false); tlSet(tl.frame - 1); };
$('tl-next').onclick = () => { tlPlay(false); tlSet(tl.frame + 1); };
$('tl-play').onclick = () => tlPlay();
$('tl-loop').onchange = () => { tl.loop = $('tl-loop').checked; tlSave(); };
$('tl-s').addEventListener('input', () => { const f = +$('tl-s').value; tlPlay(false); tlSet(f); }); // el valor antes de pausar: tlPlay(false) redibuja la barra y lo pisaba
$('tl-f').addEventListener('change', () => tlSet(+$('tl-f').value));
const tlRange = () => {
  let a = Math.round(+$('tl-in').value), b = Math.round(+$('tl-out').value), f = +$('tl-fps').value;
  if (!(b > a)) b = a + 1; if (!(f > 0)) f = 24;
  tl.start = a; tl.end = b; tl.fps = f; $('tl-in').value = a; $('tl-out').value = b; $('tl-fps').value = f;
  tlSave(); envRebuild(); tlSet(tl.frame);
};
['tl-in', 'tl-out', 'tl-fps'].forEach(id => $(id).addEventListener('change', tlRange));
['tl-f', 'tl-in', 'tl-out', 'tl-fps'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); e.target.blur(); } e.stopPropagation(); }));
setTimeout(() => tlSet(tl.start), 0);

