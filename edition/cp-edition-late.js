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
