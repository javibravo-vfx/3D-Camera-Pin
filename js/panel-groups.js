// El panel en los pasos del trabajo (D-06): 1 Align · 2 Build 3D · 3 Play · 4 Judge background · Deliver.
// Cada grupo muestra su estado a la derecha del título, y arriba de todo una línea «Next:» dice el primer paso que
// falta (con un plate cargado: la demo cuenta) y lo abre al hacerle click. Todo se lee del estado de la app: este
// archivo no cambia nada fuera del panel. Se recalcula cuando cambia el estado de alguna sección (su .st o su
// data-state), que es lo que actualizan los módulos.
const PG = {
  align: { first: 's3' },
  build: { first: 's5' },
  play: { first: 's6' },
  judge: { first: 'drv' },
  deliver: { first: 'bk-out' },
};
function pgState() {
  const pins = st.pins.filter(p => p.on).length;
  const linesOk = typeof sceneSt !== 'undefined' && sceneSt.solve && sceneSt.solve.ok;
  const aligned = !!st.solved && pins > 0 && st.rms != null;
  const mod = typeof ENV_MODULES !== 'undefined' && ENV_MODULES[env.id], built = !!mod && env.on;
  const playing = built && !!env.vals.mon;
  const live = typeof drvLive === 'function' ? drvLive().length : 0, driving = live > 0 && drv.on;
  const comparing = typeof gh !== 'undefined' && gh.on;
  return {
    align: { ok: aligned || !!linesOk, st: aligned ? `${pins} pin${pins === 1 ? '' : 's'} · ${fmt(st.rms, 2)} px` : linesOk ? 'lines' : st.plate.empty ? '' : 'not aligned' },
    build: { ok: built, st: built ? mod.name : mod ? 'off' : 'no street' },
    play: { ok: playing, st: playing ? `${env.vals.speed || 0} km/h` : built ? 'motion off' : '' },
    judge: { ok: driving || comparing, st: [driving && 'driving plate', comparing && 'compare'].filter(Boolean).join(' · ') || 'nothing yet' },
    deliver: { ok: false, st: '' },
  };
}
const PG_NEXT = {
  align: 'match the camera: pins on the scan (P) or the vanishing lines (L)',
  build: 'Environment › Module › Avenue / street',
  play: 'Motion: set the speed and press play',
  judge: 'load the driving plate and compare it with the 3D (G)',
  deliver: 'Copy Defocus and Export camera',
};
let pgNextKey = '';
function pgUI() {
  const s = pgState();
  for (const k of Object.keys(PG)) {
    const el = $('pg-' + k + '-st'); if (!el) continue;
    if (el.textContent !== s[k].st) el.textContent = s[k].st;
    $('pg-' + k).dataset.state = s[k].ok ? 'ok' : '';
  }
  // el primer paso sin hacer; con todo hecho, entregar
  pgNextKey = st.plate.empty ? '' : ['align', 'build', 'play', 'judge'].find(k => !s[k].ok) || 'deliver';
  const n = $('pg-next'); n.hidden = !pgNextKey;
  if (pgNextKey) {
    const name = $('pg-' + pgNextKey).querySelector('.pg-t').textContent, num = $('pg-' + pgNextKey).querySelector('.pg-n');
    const html = `<b>Next:</b> ${num ? num.textContent + ' ' : ''}${name} · ${PG_NEXT[pgNextKey]}`;
    if (n.innerHTML !== html) n.innerHTML = html;
  }
}
// click en Next o en el título de un grupo: abre su primera sección y la trae a la vista
function pgOpen(k) {
  const sec = $(PG[k].first); if (!sec) return;
  if (typeof mtabReveal === 'function') mtabReveal(sec); // pasa a la pestaña de módulo de esa sección
  if (sec.classList.contains('closed')) sec.querySelector('h2').click();
  sec.scrollIntoView({ block: 'nearest' });
}
$('pg-next').addEventListener('click', () => pgNextKey && pgOpen(pgNextKey));
for (const k of Object.keys(PG)) $('pg-' + k).addEventListener('click', () => pgOpen(k));
{
  let queued = false;
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; pgUI(); }); } };
  const mo = new MutationObserver(later);
  document.querySelectorAll('.props .step').forEach(sec => mo.observe(sec, { attributes: true, attributeFilter: ['data-state'] }));
  document.querySelectorAll('.props .step h2 .st').forEach(el => mo.observe(el, { childList: true, characterData: true, subtree: true }));
  // el plate (empty / demo) y el fantasma no siempre tocan un .st: también al cambiar el título del plate
  mo.observe($('plate-name'), { childList: true, characterData: true, subtree: true });
  later();
}
