// 3D Camera Pin edition of BackplateLab: the app of BackplateLab (synced with tools/sync_backplatelab.mjs) with only
// five of its tabs: Import and Measure, 2D Camera Match, 3D Camera Pin | Environment, 3D Assets and 3D Render, plus
// Lookdev (edition/lookdev.js), a turntable of a model lit by an HDRI.
// Loaded before js/module-tabs.js: cpEditionTabs() trims its list of tabs.
const CP_EDITION = { name: '3D Camera Pin', version: '1.012', tabs: ['import', 'match', 'camerapin', 'assets', 'render3d'] };
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
