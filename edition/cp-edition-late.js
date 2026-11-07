// 3D Camera Pin edition, after the modules of the app (before js/boot.js): the Lookdev tab in the module bar and the
// name and version of the edition.
{
  const f = mtabShow;
  mtabShow = function (id, save = true) { f(id, save); if (typeof cpLkShow === 'function') cpLkShow(mtabCur === 'lookdev'); };
  if (mtabCur === 'lookdev' && typeof cpLkShow === 'function') cpLkShow(true);
}
document.title = `${CP_EDITION.name} v${CP_EDITION.version}`;
{
  for (const el of document.querySelectorAll('#start-t, .ab-name')) el.textContent = CP_EDITION.name;
  // the version of the edition next to the one of BackplateLab it comes from (what the project files say)
  const tip = `${CP_EDITION.name} v${CP_EDITION.version} · BackplateLab v${APP_VERSION} (edition/BACKPLATELAB.txt)`;
  const v = document.getElementById('ab-ver'); if (v) { v.textContent = 'v' + CP_EDITION.version; v.title = tip; }
  const h = document.getElementById('help-ver'); if (h) h.textContent = `Version ${CP_EDITION.version} (BackplateLab ${APP_VERSION})`;
}
// 3D Render: the HDRIs of the edition (the ones of Lookdev) next to Load HDRI…, without looking for a file. They go in as
// a file named lookdev_<name>.exr (linear Rec.709); a project saved with one loads it again by itself.
{
  const row = document.getElementById('f-r3-hdri') && document.getElementById('f-r3-hdri').closest('.row');
  if (row && typeof r3LoadHdri === 'function' && typeof CP_HDRIS !== 'undefined') {
    row.insertAdjacentHTML('afterend', `<label class="fld" for="cp-r3-lib" title="The HDRIs that come with 3D Camera Pin (the ones of Lookdev): Poly Haven, CC0, 512 px. Light for the scene; for a sharp background load one of yours">Library<select id="cp-r3-lib"><option value="">–</option>${CP_HDRIS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>`);
    const sel = document.getElementById('cp-r3-lib');
    const nameOf = (v) => `lookdev_${v}.exr`;
    const fromName = (n) => { const m = /^lookdev_([a-z]+)\.exr$/.exec(n || ''); return m && CP_HDRIS.some(h => h[0] === m[1]) ? m[1] : ''; };
    const load = async (v) => {
      try {
        const r = await fetch(`edition/hdri/${v}.exr`); if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
        r3.hdri.cs = 'lin';
        await r3LoadHdri(new File([await r.blob()], nameOf(v)));
      } catch (e) { console.error(e); toast('Could not load the HDRI: ' + (e.message || e), true); }
    };
    sel.onchange = () => { if (sel.value) load(sel.value); };
    // the select follows what is loaded (a file of yours puts it back to –)
    const sync = () => { const v = fromName(r3.hdri.name); if (sel.value !== v && document.activeElement !== sel) sel.value = v; };
    if (typeof r3Panel === 'function') { const f = r3Panel; r3Panel = function (...a) { const out = f.apply(this, a); try { sync(); } catch (e) { /* the panel is not up yet */ } return out; }; }
    // a project or a session with a library HDRI: it comes back by itself (a file of yours has to be loaded again)
    const v0 = fromName(r3.hdri.name); if (v0 && !r3.hdri.src) load(v0); else sync();
  }
}
// The logo of the playblasts (Settings › Logo): an image (with its alpha, or none), cut to a circle or as it is, on
// the left, centred or on the right at the top of the frame. Lookdev puts it in the top bar of its burn-in; the
// Playblast of the other tabs, at the top of each frame. Each playblast turns it on or off (Logo).
// It is kept in the browser (localStorage), at 512 px at most.
const CP_LOGO_DEF = { src: '', circle: true, pos: 'left', size: 7 };
const cpLogo = Object.assign({}, CP_LOGO_DEF, lsGet('cpLogo', {}) || {});
let cpLogoImg = null;
function cpLogoLoad() {
  cpLogoImg = null;
  if (!cpLogo.src) return;
  const im = new Image(); im.onload = () => { cpLogoImg = im; window.dispatchEvent(new Event('cp-logo')); }; im.src = cpLogo.src;
}
const cpLogoReady = () => !!(cpLogoImg && cpLogoImg.naturalWidth);
// where it goes on a frame of w × h: its box and its side
function cpLogoBox(w, h) {
  if (!cpLogoReady()) return null;
  const hh = Math.max(8, Math.round(h * Math.min(30, Math.max(2, +cpLogo.size || 7)) / 100));
  const ww = cpLogo.circle ? hh : Math.round(hh * cpLogoImg.naturalWidth / cpLogoImg.naturalHeight);
  const m = Math.round(h * 0.025);
  const x = cpLogo.pos === 'center' ? (w - ww) / 2 : cpLogo.pos === 'right' ? w - m - ww : m;
  return { x, y: m, w: ww, h: hh, pos: cpLogo.pos };
}
function cpLogoDraw(ctx, w, h, o = {}) {
  const b = cpLogoBox(w, h); if (!b) return;
  const y = o.y != null ? o.y : b.y, im = cpLogoImg;
  ctx.save();
  if (cpLogo.circle) {
    // the circle, and the image covering it (its middle)
    ctx.beginPath(); ctx.arc(b.x + b.w / 2, y + b.h / 2, b.w / 2, 0, Math.PI * 2); ctx.clip();
    const s = Math.max(b.w / im.naturalWidth, b.h / im.naturalHeight), iw = im.naturalWidth * s, ih = im.naturalHeight * s;
    ctx.drawImage(im, b.x + (b.w - iw) / 2, y + (b.h - ih) / 2, iw, ih);
  } else ctx.drawImage(im, b.x, y, b.w, b.h);
  ctx.restore();
}
cpLogoLoad();
{
  // Settings › Logo
  const demo = document.querySelector('#set-dlg [data-tour="settings.demo"]');
  if (demo) {
    demo.insertAdjacentHTML('beforebegin', `<section class="set-sec" id="cp-logo-sec">
      <h3>Logo</h3>
      <p class="note">An image (PNG with alpha, JPG, SVG) for the playblasts: Lookdev (in its burn-in) and the Playblast of the other tabs. Each playblast turns it on or off (Logo).</p>
      <div class="row k cp-logo-row"><span class="cp-logo-pv" id="cp-logo-pv"></span><span class="file btn sm">Load image…<input id="cp-logo-f" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></span><button class="btn sm ghost" id="cp-logo-x">Remove</button></div>
      <label class="fld chk" for="cp-logo-c" title="Cut the logo with a circle (its middle)"><input id="cp-logo-c" type="checkbox"> Circle mask</label>
      <label class="fld" for="cp-logo-p">Position<select id="cp-logo-p"><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
      <div class="knobrow"><label for="cp-logo-s" title="Height of the logo, in % of the height of the frame">Size</label><input id="cp-logo-s" type="number" min="2" max="30" step="0.5" data-unit="%"></div>
    </section>`);
    if (typeof enhanceNumbers === 'function') enhanceNumbers(document.getElementById('cp-logo-sec'));
    const $l = (id) => document.getElementById(id);
    const ui = () => {
      $l('cp-logo-c').checked = !!cpLogo.circle; $l('cp-logo-p').value = cpLogo.pos; $l('cp-logo-s').value = cpLogo.size;
      const pv = $l('cp-logo-pv'); pv.classList.toggle('circle', !!cpLogo.circle);
      pv.style.backgroundImage = cpLogo.src ? `url("${cpLogo.src}")` : ''; pv.textContent = cpLogo.src ? '' : 'none';
      $l('cp-logo-x').disabled = !cpLogo.src;
    };
    const save = () => { try { lsSet('cpLogo', cpLogo); } catch (e) { toast('The logo is too big to keep: use a smaller image', true); } ui(); window.dispatchEvent(new Event('cp-logo')); };
    $l('cp-logo-f').onchange = (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const url = URL.createObjectURL(f), im = new Image();
      im.onload = () => {
        // at most 512 px, as PNG (the alpha stays)
        const k = Math.min(1, 512 / Math.max(im.naturalWidth || 512, im.naturalHeight || 512)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((im.naturalWidth || 512) * k)); c.height = Math.max(1, Math.round((im.naturalHeight || 512) * k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        cpLogo.src = c.toDataURL('image/png'); save(); cpLogoLoad();
      };
      im.onerror = () => { URL.revokeObjectURL(url); toast('Could not read ' + f.name, true); };
      im.src = url;
    };
    $l('cp-logo-x').onclick = () => { cpLogo.src = ''; save(); cpLogoLoad(); };
    $l('cp-logo-c').onchange = (e) => { cpLogo.circle = e.target.checked; save(); };
    $l('cp-logo-p').onchange = (e) => { cpLogo.pos = e.target.value; save(); };
    $l('cp-logo-s').onchange = (e) => { const v = +e.target.value; cpLogo.size = Number.isFinite(v) ? Math.min(30, Math.max(2, v)) : 7; save(); };
    ui();
  }
  // the Playblast of the other tabs: Logo on or off, and drawn on each frame
  const burn = document.getElementById('pb-burn'), row = burn && burn.closest('label');
  if (row) {
    row.insertAdjacentHTML('afterend', `<label class="fld" for="pb-logo"><span>Logo</span><span class="row"><input id="pb-logo" type="checkbox" checked> <span id="pb-logo-n">From Settings › Logo</span></span></label>`);
    const on = () => document.getElementById('pb-logo').checked && cpLogoReady();
    const lbl = () => { document.getElementById('pb-logo-n').textContent = cpLogoReady() ? 'From Settings › Logo' : 'None yet (Settings › Logo)'; };
    window.addEventListener('cp-logo', lbl); lbl();
    if (typeof pbComposite === 'function') { const f = pbComposite; pbComposite = function (ctx, W, H, ...a) { const r = f.call(this, ctx, W, H, ...a); if (on()) cpLogoDraw(ctx, W, H); return r; }; }
    if (typeof r3PbFrame === 'function') { const f = r3PbFrame; r3PbFrame = async function (ctx, W, H, ...a) { const r = await f.call(this, ctx, W, H, ...a); if (on()) cpLogoDraw(ctx, W, H); return r; }; }
  }
}
