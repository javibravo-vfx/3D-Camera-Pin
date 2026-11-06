// Settings (botón de engranaje junto a Project): lo global de la app. Por ahora, el naming: la info de la toma se
// lee del nombre del archivo del plate y con ella se nombran las salidas (el playblast y la cámara exportada).
// Port del panel Naming de 3D Camera Pin. Los presets son genéricos: ningún nombre de proyecto real va acá.
const NAMING_PRESETS = {
  feature: { in: '{project}_{episode}_{scene}_{shot}_{desc}_{plate}_{version}', pb: '{project}_{episode}_{scene}_{shot}_{desc}_matchmove_{ver}', cam: '{project}_{episode}_{scene}_{shot}_camera_{ver}' },
  short: { in: '{project}_{scene}_{shot}', pb: '{project}_{scene}_{shot}_{desc}_matchmove_{ver}', cam: '{project}_{scene}_{shot}_camera_{ver}' },
};
const NM_LABELS = { project: 'Project', episode: 'Episode / group', seq: 'Sequence', scene: 'Scene', shot: 'Shot', desc: 'Description', plate: 'Plate', version: 'Plate version' };
const nm = Object.assign({ preset: 'feature', ver: 1, pad: 3 }, NAMING_PRESETS.feature, lsGet('naming', {}));
let nmCamAuto = null; // el nombre de cámara que puso la convención (si se tipea otro, queda el tipeado)
const nmEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// XMPL_101_205_010_bg_aPlate_v01.1001.exr → { project: XMPL, episode: 101, scene: 205, shot: 010, desc: bg, … }
function nmParse(file) {
  if (!file || st.plate.sample || st.plate.empty) return null;
  const base = file.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[.#]\d{3,8}$/, '');
  const toks = (nm.in.match(/\{(\w+|\*)\}/g) || []).map(t => t.slice(1, -1));
  let parts = base.split('_').filter(Boolean);
  if (parts.length > toks.length && /^\d{3,8}$/.test(parts[parts.length - 1])) parts = parts.slice(0, -1); // el número de cuadro (_1001)
  if (parts.length < Math.min(2, toks.length)) return null;
  const out = {}, extra = parts.length - toks.length; // las partes de más van a {desc}, si el patrón lo tiene
  let k = 0;
  toks.forEach(t => {
    let v;
    if (t === 'desc' && extra > 0) { v = parts.slice(k, k + extra + 1).join('_'); k += extra + 1; } else v = parts[k++];
    if (t !== '*' && v !== undefined) out[t] = v;
  });
  return out.project ? out : null;
}
function nmVer() { return 'v' + String(Math.max(0, Math.round(nm.ver || 0))).padStart(nm.pad || 3, '0'); }
function nmFill(tpl, info) {
  const s = tpl.replace(/\{(\w+)\}/g, (m, k) => k === 'ver' ? nmVer() : (info[k] || ''));
  return s.replace(/_+/g, '_').replace(/^_|_$/g, '').replace(/[^\w.-]+/g, '_');
}
// info: null si el plate no sigue la convención (el playblast queda con el nombre del plate, como antes)
function nmNames() {
  const info = nmParse(st.plate.name);
  return info ? { info, pb: nmFill(nm.pb, info), cam: nmFill(nm.cam, info) } : { info: null, pb: '', cam: 'MatchCam' };
}
function nmUI() {
  const r = nmNames();
  $('nm-preset').value = nm.preset;
  [['nm-in', nm.in], ['nm-pb', nm.pb], ['nm-cam', nm.cam], ['nm-ver', nm.ver]].forEach(([id, v]) => { if (document.activeElement !== $(id)) $(id).value = v; });
  $('nm-pad').value = String(nm.pad);
  $('nm-kv').innerHTML = r.info ? Object.entries(r.info).map(([k, v]) => `<dt>${NM_LABELS[k] || k}</dt><dd>${nmEsc(v)}</dd>`).join('')
    : `<dt></dt><dd class="note">${st.plate.empty || st.plate.sample ? 'Load a plate to read its shot info.' : 'The plate name does not match this convention: the outputs keep generic names.'}</dd>`;
  $('nm-out').innerHTML = r.info ? `Playblast: <b>${nmEsc(r.pb)}.mp4</b><br>Camera: <b>${nmEsc(r.cam)}</b>` : 'Playblast: named after the plate · Camera: MatchCam';
  // el nombre de la cámara exportada sigue a la convención hasta que se tipea otro
  const cn = $('camname');
  if (nmCamAuto === null || cn.value === nmCamAuto || cn.value === 'MatchCam' || !cn.value) {
    if (cn.value !== r.cam) { cn.value = r.cam; if (typeof updateExport === 'function') updateExport(); }
    nmCamAuto = r.cam;
  }
}
function nmSave() { lsSet('naming', { preset: nm.preset, in: nm.in, pb: nm.pb, cam: nm.cam, ver: nm.ver, pad: nm.pad }); nmUI(); }
function setOpen(on) { $('set-dlg').hidden = !on; if (on) { nmUI(); $('set-close').focus(); } else $('pj-settings').focus(); }
{
  $('pj-settings').onclick = () => setOpen(true);
  $('set-close').onclick = () => setOpen(false);
  $('set-dlg').addEventListener('click', e => { if (e.target === $('set-dlg')) setOpen(false); });
  $('set-dlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } });
  $('nm-preset').onchange = () => { nm.preset = $('nm-preset').value; if (NAMING_PRESETS[nm.preset]) Object.assign(nm, NAMING_PRESETS[nm.preset]); nmSave(); };
  ['in', 'pb', 'cam'].forEach(k => $('nm-' + k).addEventListener('input', () => { nm[k] = $('nm-' + k).value; nm.preset = 'custom'; $('nm-preset').value = 'custom'; nmSave(); }));
  $('nm-ver').addEventListener('change', () => { nm.ver = Math.max(0, Math.round(+$('nm-ver').value || 0)); nmSave(); });
  $('nm-pad').onchange = () => { nm.pad = +$('nm-pad').value; nmSave(); };
  $('nm-reset').onclick = () => { Object.assign(nm, { preset: 'feature', ver: 1, pad: 3 }, NAMING_PRESETS.feature); nmSave(); };
  ['nm-in', 'nm-pb', 'nm-cam', 'nm-ver'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); }));
  // cada plate nuevo vuelve a leer su nombre
  const f = refreshAll; refreshAll = function (...a) { const r = f(...a); if (st.plate.name !== nmUI.last) { nmUI.last = st.plate.name; nmUI(); } return r; };
}
