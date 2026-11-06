# Third-party components

| Component | Where | License |
|---|---|---|
| three.js 0.187.0 (r187: core, loaders, SAO post-processing pass with its shaders, fflate, meshopt decoder, Draco decoder; copied from npm by `tools/vendor_three.mjs`) | `vendor/three` | MIT (`vendor/three/LICENSE`); Draco: Apache 2.0 |
| three-gpu-pathtracer 0.0.28 (Garrett Johnson; `build/index.module.js` from npm, unmodified; loaded only when the Path trace engine of 3D Render is chosen) | `vendor/three-gpu-pathtracer` | MIT (`vendor/three-gpu-pathtracer/LICENSE`) |
| three-mesh-bvh 0.9.18 (Garrett Johnson; `build/index.module.js` from npm, unmodified; used by three-gpu-pathtracer) | `vendor/three-mesh-bvh` | MIT (`vendor/three-mesh-bvh/LICENSE`) |
| three.js r147 Unreal bloom pass and its luminosity high-pass shader (`examples/js`, unmodified) | `vendor/three-r147` | MIT (`vendor/three-r147/LICENSE`) |
| mp4-muxer 5.1.5 | `vendor/mp4-muxer.js` | MIT |
| 8th Wall Engine binary 1.0.0 (Niantic Spatial, Inc.; `@8thwall/engine-binary` from npm, only `xr.js`, `xr-slam.js`, `resources/media-worker.js` and `resources/powered-by.svg`, unmodified) — world tracking of the Shakelab phone page, served by the desktop app to the phone | `vendor/8thwall` | XR Engine License Agreement (`vendor/8thwall/LICENSE`): © 2026 Niantic Spatial, Inc., all rights reserved; binary only, provided as is, without warranties; not for a paid product whose value comes substantially from it. The phone page shows this notice. |
| qrcode-generator 2.0.4 (Kazuhiko Arase; `dist/qrcode.js` from npm) — the QR code of the Shakelab phone link | `vendor/qrcode/qrcode.js` | MIT (`vendor/qrcode/LICENSE`) |
| fzstd 0.1.1 (Arjun Barrett; zstd decoder for `.spz` v4, `umd/index.js` from npm) | `vendor/fzstd.js` | MIT (`vendor/fzstd.LICENSE`) |
| Inter (font) | `fonts/Inter-*.ttf` | SIL Open Font License 1.1 |
| OpenStreetMap map tiles (3D Render map; loaded from `tile.openstreetmap.org` when online, not shipped) | — | Data © OpenStreetMap contributors, ODbL; attribution shown on the map |
| Generic passenger car pack by Comrade1280 (Sketchfab), converted | `assets/cars.glb`, `assets/cars.js` | CC BY 4.0 |
| Electron 44.7.0 (Chromium, Node.js, V8, FFmpeg build of Chromium) — desktop app only | `BackplateLab.exe` and its folder, built by `instalador.bat` (not in the repository) | MIT (`LICENSE.electron.txt` next to the exe); Chromium and its components: BSD 3-Clause and others, listed in `LICENSES.chromium.html` next to the exe |
| electron-builder 26.17.0, NSIS — build tools only, used to make the installer | `node_modules/` (not in the repository) | MIT; NSIS: zlib/libpng |
