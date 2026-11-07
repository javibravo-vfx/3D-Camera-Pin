// 3D Camera Pin edition of BackplateLab: the app of BackplateLab (synced with tools/sync_backplatelab.mjs) with only
// five of its tabs: Import and Measure, 2D Camera Match, 3D Camera Pin | Environment, 3D Assets and 3D Render, plus
// Lookdev (edition/lookdev.js), a turntable of a model lit by an HDRI.
// Loaded before js/module-tabs.js: cpEditionTabs() trims its list of tabs.
const CP_EDITION = { name: '3D Camera Pin', version: '1.020', tabs: ['import', 'match', 'camerapin', 'assets', 'render3d'] };
// the HDRIs that come with the edition (edition/hdri/*.exr, Poly Haven CC0, 512 px, linear Rec.709): Lookdev and 3D Render
const CP_HDRIS = [['studio', 'Studio'], ['apartment', 'Apartment'], ['lobby', 'Lobby'], ['hall', 'Hall'], ['lab', 'Lab'], ['warehouse', 'Warehouse'], ['workshop', 'Workshop'],
  ['city', 'City'], ['bridge', 'Bridge'], ['esplanade', 'Esplanade'], ['venice', 'Venice'], ['park', 'Park'], ['forest', 'Forest'], ['sky', 'Sky'],
  ['dawn', 'Dawn'], ['sunrise', 'Sunrise'], ['sunset', 'Sunset'], ['night', 'Night']];
function cpEditionTabs(list) {
  const keep = list.filter(m => CP_EDITION.tabs.includes(m.id)), keepSecs = new Set(keep.flatMap(m => m.secs));
  // the sections of the tabs that are not here stay hidden for good (the kept tabs only switch their own ones)
  for (const m of list) if (!CP_EDITION.tabs.includes(m.id)) for (const s of m.secs) if (!keepSecs.has(s)) { const el = document.getElementById(s); if (el) el.classList.add('mt-off', 'cp-off'); }
  list.splice(0, list.length, ...keep, { id: 'lookdev', label: 'Lookdev', secs: [], title: 'Drop a 3D model: it is framed, lit by an HDRI and turned on a turntable of fixed length, with references, Raster or Path trace, and a playblast with burn-in' });
}
// FPS of a play bar: a click opens the common frame rates (the number can still be typed), and the number is violet
// when it is the fps of the metadata of the plate (st.plateMeta) and yellow when it is not (no metadata: as always)
const CP_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
function cpFpsMeta(inp) {
  const md = typeof st !== 'undefined' && st.plateMeta, mf = md && md.fps > 0 ? +md.fps : 0, v = +inp.value;
  const same = mf > 0 && Math.abs(v - mf) < 0.0015, warn = mf > 0 && !same;
  inp.classList.toggle('cp-meta', same); inp.classList.toggle('cp-warn', warn);
  const base = (inp.dataset.cpTitle ??= inp.title || '');
  inp.title = base + (same ? `\n· Matches the metadata of the plate (${+mf.toFixed(3)} fps)` : warn ? `\n· The metadata of the plate says ${+mf.toFixed(3)} fps` : '');
}
function cpFpsMenu(inp) {
  if (!inp || inp.dataset.cpFps) return; inp.dataset.cpFps = '1';
  let pop = null;
  const close = () => { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); } };
  const outside = (e) => { if (pop && !pop.contains(e.target) && e.target !== inp) close(); };
  const open = () => {
    if (pop) return;
    const md = typeof st !== 'undefined' && st.plateMeta, mf = md && md.fps > 0 ? +(+md.fps).toFixed(3) : 0;
    const list = [...new Set([...CP_FPS, ...(mf ? [mf] : [])])].sort((a, b) => a - b);
    pop = document.createElement('div'); pop.className = 'cp-fpspop'; pop.setAttribute('role', 'listbox');
    pop.innerHTML = list.map(v => `<button type="button" role="option" data-v="${v}" class="${Math.abs(v - +inp.value) < 0.0015 ? 'on' : ''}${v === mf ? ' meta' : ''}">${v}${v === mf ? '<span>metadata</span>' : ''}</button>`).join('');
    document.body.appendChild(pop);
    const r = inp.getBoundingClientRect(), ph = pop.offsetHeight;
    pop.style.left = Math.max(4, Math.min(innerWidth - pop.offsetWidth - 4, r.left)) + 'px';
    pop.style.top = (r.bottom + ph + 6 > innerHeight ? r.top - ph - 4 : r.bottom + 4) + 'px';
    pop.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; inp.value = b.dataset.v; inp.dispatchEvent(new Event('change', { bubbles: true })); close(); inp.blur(); });
    document.addEventListener('pointerdown', outside, true);
  };
  inp.addEventListener('click', open);
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') close(); else if (e.key !== 'Tab') close(); });
  inp.addEventListener('change', () => cpFpsMeta(inp));
  window.addEventListener('resize', close);
  cpFpsMeta(inp);
}
