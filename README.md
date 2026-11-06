# 3D Camera Pin

Camera matching for driving plates and car green-screen shots: read the plate and its metadata, match the perspective with vanishing lines, solve the camera from pins on a scan of the car (OBJ, PLY, GLB, FBX or gaussian splat), and build the street behind it with traffic in motion. It runs in the browser; the plate and the scan are read locally and never uploaded.

**Live:** https://javibravo-vfx.github.io/3D-Camera-Pin/

This is the **3D Camera Pin edition of [BackplateLab](https://github.com/legandrop/BackplateLab)** (Lega Pugliese, Charly Villafañe and Javi Bravo): the same app, with only these tabs:

- **Import and Measure** — the plate, its set report and metadata, and the scan, each in its pane; measure and scale the scan.
- **2D Camera Match** — the perspective from vanishing lines on the plate, like Perspective Match in 3ds Max.
- **3D Camera Pin | Environment** — pins on the scan, the street behind the car and its motion, and the camera export.
- **3D Assets** — four 3D viewports with the pieces of the environment (cars, people, street lights, buildings…), to replace them with imported assets fitted to their pivot.
- **3D Render** — the environment lit by an HDRI and a sun from the place, date and time of the shot, seen from the shot camera, from the top and from a free camera, with the raster and the path trace engines of BackplateLab (the path tracer of 3D Camera Pin lives there now).

The version is shown in the app (`v1.009`, with the BackplateLab version it comes from in its tooltip); every change goes up by 0.001 and has its line in [ChangeLog.md](ChangeLog.md). The single-file 3D Camera Pin it replaces (v1.006) is the branch [`single-file-v1.006`](https://github.com/javibravo-vfx/3D-Camera-Pin/tree/single-file-v1.006).

## Running it

It needs to be served over http (it loads its guided tours, licenses and workers with `fetch`); opening `index.html` from the disk does not work.

- **GitHub Pages:** the live link above.
- **On Windows, without installing anything:** `CameraPin_web.bat` serves this folder with PowerShell and opens the browser (`--port <n>`, `--no-open`; `--tailscale` also serves it on the Tailscale address for the phone).
- **With Python or Node:** `python -m http.server 8642` or `npx serve` in this folder, then http://127.0.0.1:8642/.

Everything it uses is in the repo (three.js r187, the path tracer, fonts): it works offline.

## Updating from BackplateLab

The app files (`index.html`, `js/`, `css/`, `fonts/`, `vendor/`, `tours/`, `assets/`, `phone/`) come from BackplateLab and are replaced on every update; what belongs to this edition lives in `edition/` and is never touched:

```
node tools/sync_backplatelab.mjs <folder of the BackplateLab clone>
```

It copies the files BackplateLab publishes and adds the hooks of `edition/`: `cp-edition.js` keeps only those tabs (the list is `CP_EDITION.tabs`) and `cp-edition-late.js` puts the name and version of the edition. `edition/BACKPLATELAB.txt` says which version and commit it came from. If BackplateLab changed one of the places a hook goes, the sync stops and says which.

## Credits

BackplateLab: Lega Pugliese, Charly Villafañe and Javi Bravo. 3D Camera Pin: Javi Bravo. Third-party libraries and their licenses: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
