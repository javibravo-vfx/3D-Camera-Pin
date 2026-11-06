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
