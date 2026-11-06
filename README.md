# 3D Camera Pin

Camera matching for driving plates and car green-screen shots: read the plate and its metadata, match the perspective with vanishing lines, solve the camera from pins on a scan of the car (OBJ, PLY, GLB, FBX or gaussian splat), and build the street behind it with traffic in motion. It runs in the browser; the plate and the scan are read locally and never uploaded.

**Live:** https://javibravo-vfx.github.io/3D-Camera-Pin/

This is the **3D Camera Pin edition of [BackplateLab](https://github.com/legandrop/BackplateLab)** (Lega Pugliese, Charly Villafañe and Javi Bravo): the same app, with only these tabs:

- **Import and Measure** — the plate, its set report and metadata, and the scan, each in its pane; measure and scale the scan.
- **2D Camera Match** — the perspective from vanishing lines on the plate, like Perspective Match in 3ds Max.
- **3D Camera Pin | Environment** — pins on the scan, the street behind the car and its motion, and the camera export.
- **Path Trace** — a GPU path tracer on that camera, scan and environment (below).

The version is shown in the app (`v1.007`, with the BackplateLab version it comes from in its tooltip); every change goes up by 0.001 and has its line in [ChangeLog.md](ChangeLog.md). The single-file 3D Camera Pin it replaces is the tag [`v1.006-single-file`](https://github.com/javibravo-vfx/3D-Camera-Pin/tree/v1.006-single-file).

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

It copies the files BackplateLab publishes and adds the hooks of `edition/`: `cp-edition.js` keeps only the three tabs (the list is `CP_EDITION.tabs`), `cp-pathtrace.js` is the Path Trace tab and `cp-edition-late.js` puts it in the tab bar with the name and version of the edition. `edition/BACKPLATELAB.txt` says which version and commit it came from. If BackplateLab changed one of the places a hook goes, the sync stops and says which.

## Path Trace

The **Path Trace** tab renders the 3D Camera Pin shot with a GPU path tracer ([three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)), to try it out on the scan and the environment.

- It takes the camera of the 3D Camera Pin | Environment tab as it is (position, rotation, field of view and plate aspect), the scan with its own materials, the environment and the sun. **Update from Camera Pin** copies them again after a change there.
- The camera can be moved in the tab with the Nav preset of the app (orbit, pan, dolly, look; wheel to dolly). While it moves it shows a coarse image and when it stops it fills in up to the samples. **Camera Pin view** puts it back where Camera Pin has it.
- The timeline bar is there too (Space plays): the environment moves with the frame, coarse while it plays, and the frame you stop on fills in. Only the positions change, so a new frame is quick.
- The display materials become physical ones (Lambert: rough, Phong: a bit glossy, Basic: emissive); colors and color textures are read as sRGB. There is no ACES conversion here: the output is sRGB, with an optional tone map (None, ACES Filmic, AgX, Neutral) and an exposure in stops.
- Light: the sky and ground colors (the hemisphere light of Camera Pin) or an HDRI (.hdr / .exr), with intensity and rotation, and the sun with its own multiplier.
- Background: the sky, the plate, or transparent (the PNG keeps the alpha). An optional ground plane at a set height catches the shadows when there is no environment.
- Depth of field with an f-stop and a focus distance (**Focus center** focuses on what is in the middle of the frame); the film back is the one of Camera Pin.
- Samples (it stops there), bounces, resolution, tiles, denoise and a glossy filter. Pause, Restart and Save PNG are in the bar.
- **Playblast** (in the bar of the tab) renders the frame range path traced to an MP4: size 720p, 1080p or the plate, and a quality preset (Draft 16 samples / 3 bounces, Preview 64 / 4, Good 256 / 5, Final 1024 / 8, or what the Render panel has). It uses the Path Trace camera and its light, background (over the plate when it is the plate), denoise and tone map; the dialog shows the time per frame and what is left.
- Resolution: 720p (default) or 1080p, by width (1280 or 1920) with the height from the plate aspect, or the plate size. The render keeps that size and is only scaled to fit the view.
- Gaussian splats and point clouds are not path traced (only meshes are). The library (in `vendor/`) is loaded the first time the tab is opened.

## Credits

BackplateLab: Lega Pugliese, Charly Villafañe and Javi Bravo. 3D Camera Pin and the Path Trace tab: Javi Bravo. Third-party libraries and their licenses: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
