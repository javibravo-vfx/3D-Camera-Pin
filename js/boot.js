// ---------- Boot ----------
function loadDemo() {
  // the demo uses its own known camera
  st.sw = 36.70; st.sh = 25.54; st.focal = 24; st.preset = 'alexa-lf-og'; st.shAuto = true; st.par = 1;
  pre.value = st.preset; $('sw').value = st.sw; $('sh').value = st.sh; $('focal').value = st.focal;
  const s = buildSample();
  clearScan();
  scanObj = sampleGeometry(false, false); scanRoot.add(scanObj); st.sample = true; st.scanName = 'Sample';
  scanObj.traverse(o => { if (o.isMesh) o.userData.orig = o.material; });
  st.rawBox = new THREE.Box3().setFromObject(scanRoot);
  setRootTransform(1, 1, 'y', false);
  $('scan-name').textContent = 'Sample';
  $('scan-kv').innerHTML = '<dt>Type</dt><dd>Sample car interior</dd><dt>Reference</dt><dd>wheelbase 2.70 m · roof 1.45 m</dd>';
  applyDisplay();
  setPlate(s.url, s.W, s.H, 'Sample', true);
  camera.position.set(1.9, 2.0, -3.6); camera.lookAt(0, 0.9, 0.3); controls.target.set(0, 0.9, 0.3);
  camera.near = 0.02; camera.far = 1000;
  applyIntrinsics();
  refreshAll();
}
(function boot() {
  const tgt = lsGet('target', null); if (tgt) $('target').value = tgt;
  applyKnobNames();
  resetAll(true);
  st._saved = lsGet('sensor', null);
  maskChanged();
})();
// when the first real plate arrives, restore the last sensor/focal the user used
const _setPlate = setPlate;
setPlate = function (...a) {
  _setPlate(...a);
  if (!a[4] && st._saved) {
    const sv = st._saved; st._saved = null;
    st.preset = sv.preset; pre.value = sv.preset;
    setSensor(sv.sw, sv.sh, sv.preset !== 'custom');
    const fl = lsGet('focal', null); if (fl) { st.focal = fl; $('focal').value = fl; applyIntrinsics(); refreshAll(); }
  }
};
