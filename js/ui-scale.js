// ---------- App bar, Help y escala de interfaz ----------
// La escala cambia --ui-scale en <html>; app.css define 1rem = 10px * --ui-scale y todo tamaño de
// interfaz va en rem. Se eligió rem y no `zoom`: con `zoom` en un ancestro del visor,
// getBoundingClientRect/clientX quedan en otra escala que los px del stage y los clics del plate
// (pins, measure, raycast) se corren; con rem el visor no cambia de sistema de coordenadas.
const UI_SCALE_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];
let uiScaleCur = 1;
function uiScaleGet() { return uiScaleCur; }
function uiScaleSet(s, save = true) {
  s = Math.min(1.6, Math.max(0.8, Math.round((+s || 1) * 100) / 100));
  const prev = uiScaleCur; uiScaleCur = s;
  document.documentElement.style.setProperty('--ui-scale', s);
  // el ancho del panel arrastrado a mano está en px: que acompañe a la letra
  const app = document.querySelector('.app'), w = parseFloat(app.style.getPropertyValue('--side-w'));
  if (w && prev !== s) { const nw = Math.round(w * s / prev); app.style.setProperty('--side-w', nw + 'px'); lsSet('sideW', nw); }
  if (save) lsSet('uiScale', s);
  const pct = Math.round(s * 100) + '%';
  $('ui-scale-v').textContent = pct;
  $('ui-scale-down').disabled = s <= UI_SCALE_STEPS[0];
  $('ui-scale-up').disabled = s >= UI_SCALE_STEPS[UI_SCALE_STEPS.length - 1];
  document.querySelectorAll('#help-size button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.s === s)));
  if (prev !== s) window.dispatchEvent(new CustomEvent('ui-scale', { detail: s }));
}
function uiScaleStep(dir) {
  const cur = uiScaleCur;
  const next = dir > 0 ? UI_SCALE_STEPS.find(v => v > cur + 1e-6) : [...UI_SCALE_STEPS].reverse().find(v => v < cur - 1e-6);
  if (next) uiScaleSet(next);
}
UI_SCALE_STEPS.forEach(v => {
  const b = document.createElement('button'); b.dataset.s = v; b.textContent = Math.round(v * 100) + '%';
  b.addEventListener('click', () => uiScaleSet(v)); $('help-size').appendChild(b);
});
$('ui-scale-down').addEventListener('click', () => uiScaleStep(-1));
$('ui-scale-up').addEventListener('click', () => uiScaleStep(1));
$('ui-scale-v').addEventListener('click', () => uiScaleSet(1));
uiScaleCur = Math.min(1.6, Math.max(0.8, +lsGet('uiScale', 1) || 1)); // sin reescalar el panel: ya se guardó a esta escala
uiScaleSet(uiScaleCur, false);

// ---------- App bar ----------
$('ab-ver').textContent = 'v' + APP_VERSION;
$('help-ver').textContent = 'Version ' + APP_VERSION;
{
  const src = $('plate-name'), t = $('ab-title');
  const upd = () => {
    const n = src.textContent.trim();
    t.innerHTML = '';
    if (!n) { t.textContent = 'Open a plate to start'; return; }
    const dot = document.createElement('span'); dot.className = 'dot';
    const b = document.createElement('b'); b.textContent = n;
    t.append(dot, b); t.title = n;
  };
  new MutationObserver(upd).observe(src, { childList: true, characterData: true, subtree: true });
  upd();
}
function uiPanelShow(on, save = true) {
  document.querySelector('.app').classList.toggle('noside', !on);
  $('ab-panel').setAttribute('aria-pressed', String(on));
  if (save) lsSet('panelOn', on);
}
$('ab-panel').addEventListener('click', () => uiPanelShow(document.querySelector('.app').classList.contains('noside')));
uiPanelShow(lsGet('panelOn', true), false);

// ---------- Help ----------
let uiHelpReturn = null;
const UI_HELP_SECTIONS = ['tours', 'about', 'licenses'];
function uiHelpSection(sec) {
  UI_HELP_SECTIONS.forEach(k => {
    const on = k === sec;
    $('help-tab-' + k).setAttribute('aria-selected', String(on));
    $('help-tab-' + k).tabIndex = on ? 0 : -1;
    $('help-pane-' + k).hidden = !on;
  });
  if (sec === 'licenses') uiHelpLicenses();
}
// section: 'tours' | 'about' | 'licenses'; sin sección, los recorridos si ya hay algo en #help-tours
function uiHelpOpen(section) {
  if (!UI_HELP_SECTIONS.includes(section)) section = $('help-tours').children.length ? 'tours' : 'about';
  const d = $('help-dlg');
  if (d.hidden) uiHelpReturn = document.activeElement;
  d.hidden = false;
  uiHelpSection(section);
  $('help-tab-' + section).focus();
}
function uiHelpClose() {
  $('help-dlg').hidden = true;
  if (uiHelpReturn && uiHelpReturn.focus) uiHelpReturn.focus();
  uiHelpReturn = null;
}
UI_HELP_SECTIONS.forEach((k, i) => {
  const tab = $('help-tab-' + k);
  tab.addEventListener('click', () => uiHelpSection(k));
  tab.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = UI_HELP_SECTIONS[(i + (e.key === 'ArrowRight' ? 1 : UI_HELP_SECTIONS.length - 1)) % UI_HELP_SECTIONS.length];
    uiHelpSection(n); $('help-tab-' + n).focus(); e.preventDefault();
  });
});
$('ab-help').addEventListener('click', () => uiHelpOpen());
$('help-close').addEventListener('click', uiHelpClose);
$('help-dlg').addEventListener('pointerdown', e => { if (e.target === $('help-dlg')) uiHelpClose(); });
$('help-dlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); uiHelpClose(); } });
// la tabla sale de THIRD_PARTY_LICENSES.md (una sola fuente); si no se puede leer queda el aviso del html
let uiHelpLicLoaded = false;
function uiHelpLicenses() {
  if (uiHelpLicLoaded) return; uiHelpLicLoaded = true;
  fetch('THIRD_PARTY_LICENSES.md').then(r => r.ok ? r.text() : Promise.reject()).then(md => {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cell = s => esc(s.trim()).replace(/`([^`]+)`/g, '<code>$1</code>');
    const rows = md.split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]+\|\s*$/.test(l))
      .map(l => l.trim().replace(/^\||\|$/g, '').split('|'));
    if (rows.length < 2) return;
    const [head, ...body] = rows;
    $('help-lic').innerHTML = `<table class="help-lic"><thead><tr>${head.map(h => `<th>${cell(h)}</th>`).join('')}</tr></thead><tbody>`
      + body.map(r => `<tr>${r.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
  }).catch(() => { uiHelpLicLoaded = false; });
}

// ---------- Atajos: F1 y escala (en captura, para ganarle al zoom del navegador) ----------
window.addEventListener('keydown', e => {
  if (e.key === 'F1') { e.preventDefault(); uiHelpOpen(); return; }
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') { e.preventDefault(); e.stopPropagation(); uiScaleStep(1); }
  else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') { e.preventDefault(); e.stopPropagation(); uiScaleStep(-1); }
  else if (e.key === '0' || e.code === 'Numpad0') { e.preventDefault(); e.stopPropagation(); uiScaleSet(1); }
}, true);

// la barra de chips del visor es una fila con scroll horizontal: la rueda vertical la desplaza
$('vpbar').addEventListener('wheel', e => { const b = $('vpbar'); if (b.scrollWidth > b.clientWidth && !e.deltaX) { b.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
