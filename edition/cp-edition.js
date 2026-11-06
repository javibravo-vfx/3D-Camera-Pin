// 3D Camera Pin edition of BackplateLab: the app of BackplateLab (synced with tools/sync_backplatelab.mjs) with only
// five of its tabs: Import and Measure, 2D Camera Match, 3D Camera Pin | Environment, 3D Assets and 3D Render.
// Loaded before js/module-tabs.js: cpEditionTabs() trims its list of tabs.
const CP_EDITION = { name: '3D Camera Pin', version: '1.009', tabs: ['import', 'match', 'camerapin', 'assets', 'render3d'] };
function cpEditionTabs(list) {
  const keep = list.filter(m => CP_EDITION.tabs.includes(m.id)), keepSecs = new Set(keep.flatMap(m => m.secs));
  // the sections of the tabs that are not here stay hidden for good (the kept tabs only switch their own ones)
  for (const m of list) if (!CP_EDITION.tabs.includes(m.id)) for (const s of m.secs) if (!keepSecs.has(s)) { const el = document.getElementById(s); if (el) el.classList.add('mt-off', 'cp-off'); }
  list.splice(0, list.length, ...keep);
}
