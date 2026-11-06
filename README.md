# 3D Camera Pin

Camera matching for driving plates and car green-screen shots: read the plate and its metadata, match the perspective with vanishing lines, solve the camera from pins on a scan of the car (OBJ, PLY, GLB, FBX or gaussian splat), and build the street behind it with traffic in motion. It runs in the browser; the plate and the scan are read locally and never uploaded.

**Live:** https://javibravo-vfx.github.io/3D-Camera-Pin/

This is the **3D Camera Pin edition of [BackplateLab](https://github.com/legandrop/BackplateLab)** (Lega Pugliese, Charly Villafañe and Javi Bravo): the same app, with only these tabs:

- **Import and Measure** — the plate, its set report and metadata, and the scan, each in its pane; measure and scale the scan.
- **2D Camera Match** — the perspective from vanishing lines on the plate, like Perspective Match in 3ds Max.
- **3D Camera Pin | Environment** — pins on the scan, the street behind the car and its motion, and the camera export.
- **3D Assets** — four 3D viewports with the pieces of the environment (cars, people, street lights, buildings…), to replace them with imported assets fitted to their pivot.
- **3D Render** — the environment lit by an HDRI and a sun from the place, date and time of the shot, seen from the shot camera, from the top and from a free camera, with the raster and the path trace engines of BackplateLab (the path tracer of 3D Camera Pin lives there now).
- **Lookdev** — this edition's own tab (below): a turntable of a model lit by an HDRI.

The version is shown in the app (`v1.010`, with the BackplateLab version it comes from in its tooltip); every change goes up by 0.001 and has its line in [ChangeLog.md](ChangeLog.md). The single-file 3D Camera Pin it replaces (v1.006) is the branch [`single-file-v1.006`](https://github.com/javibravo-vfx/3D-Camera-Pin/tree/single-file-v1.006).

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

## Lookdev

The **Lookdev** tab is the Lookdev Rig of the 3ds Max toolbar in the browser: drop a model and look at it turning under an HDRI.

- **Model:** drop it on the viewport or **Load model**: GLB / GLTF (textures embedded, or the .gltf with its .bin and images), USDZ / USD, FBX, OBJ with its .mtl and images, PLY — the formats Sketchfab downloads come in. A model with its textures apart: drop its **whole folder** (with `textures/` inside) or its **ZIP** as it was downloaded, or select the files together; the texture paths of another machine are matched by file name. It is set on the ground, centred and framed. **Up axis** (Auto: glTF, USD and FBX are Y up; an OBJ / PLY much taller in Z comes from a Z up program), **Facing** in 90° steps, **File units** (Auto by its size: cm or mm when it is very big) and **Offset** X / Y / Z in meters, to move it off the centre of the turntable (the camera keeps looking at the centre).
- **Light:** an HDRI from the library (18 small HDRIs of [Poly Haven](https://polyhaven.com/hdris), CC0, 512 px, in `edition/hdri/`) or one of yours (.hdr / .exr), with rotation and exposure (EV). The same 18 are in **3D Render** too (HDRI › Library). **HDRI** in the bar hides it behind the model (it keeps lighting it; the background color is in Light).
- **Turntable:** always the same length, so every playblast turns the same way: frames 1–120 the camera and the light orbit the model together (it turns under a fixed light, like the root of the Max rig), frames 121–240 the light alone turns 360°, in the same direction. 24 fps, 10 s. Direction, lens (36 mm wide film, 16:9), camera height and framing; **Lens, Height, Framing** and **Exp** are also on the viewport, a slider and its number each (double click on the slider: its default).
- **References**, like the rig: chrome ball, 18% grey ball and a ColorChecker (unlit, its sRGB values) fixed in the lower right corner of the frame, and a shadow catcher: a contact shadow in Raster; in Path trace an 18% grey floor with the real shadows of the HDRI (the path tracer has no shadow-only material). The references sit above the lower bar of the burn-in when it is on. **Clay** puts a grey material on the whole model.
- **Color**, like 3D Render: Raster lights in ACEScg, Path trace in linear Rec.709, and the **Viewer** on the bar (ACES 1.0 · Rec.709 or sRGB, Rec.709, sRGB, Raw) takes it to the screen and to the playblast.
- **Navigate** (N, the Nav mouse style of the app; wheel to zoom) leaves the turntable camera: **Back to camera** (F) shows up on the bar, highlighted, and the frame gets the accent color until you go back. **Measure** (M): two clicks on the model, in meters and centimeters.
- **Raster** or **Path trace** (three-gpu-pathtracer, from `vendor/`): it renders 1280 × 720 on the viewport, coarse while the view moves and filling in up to the samples when it stops.
- **Playblast:** the 240 frames from the turntable camera to an MP4 (1080p or 720p; H.264, or VP9 when the browser has no usable H.264, the same encoder as the Playblast of the other tabs), with the engine of the viewport (Path trace with a quality preset: Draft 16 samples / 3 bounces, Preview 64 / 4, Good 256 / 6, Final 1024 / 8, or the ones of the panel) and the **burn-in**: the letters of VFX Shooting Sup (Monitor or Mono, small or large, info and title align, bar darkness) with project, asset, HDRI with its rotation and EV, lens, engine, frame and pass, date and artist, each one on or off. **Burn-in** in the bar previews it on the viewport.
- Its settings are remembered in the browser; the model is not (drop it again).

## Credits

BackplateLab: Lega Pugliese, Charly Villafañe and Javi Bravo. 3D Camera Pin: Javi Bravo. Third-party libraries and their licenses: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md); the HDRIs of Lookdev are from [Poly Haven](https://polyhaven.com) (CC0), resized by [pmndrs/assets](https://github.com/pmndrs/assets) (`edition/hdri/LICENSE.txt`).
