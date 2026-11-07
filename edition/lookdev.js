// 3D Camera Pin edition: the Lookdev tab, the turntable of the Lookdev Rig of the 3ds Max toolbar in the browser.
// Drop a model (GLB, GLTF, USDZ / USD, FBX, OBJ with its .mtl and images, PLY; a whole folder or a ZIP as Sketchfab gives
// them): it is set on the ground,
// centred and framed by a camera; an HDRI lights it (a library of small HDRIs from Poly Haven in edition/hdri/, or one
// of yours). Play runs the turntable, always the same length: first the camera and the light orbit the model together
// (the model turns under a fixed light, like the root of the Max rig), then the light alone turns 360°, in the same
// direction. References like the rig: chrome ball, 18% grey ball and a ColorChecker in a corner of the frame, fixed on
// screen, and a shadow catcher under the model. Raster or Path trace (three-gpu-pathtracer, from vendor/), a measuring
// tool, free navigation with Back to camera, and a playblast to MP4 with a burn-in like the one of VFX Shooting Sup
// (previewed on the viewport). Color like 3D Render: Raster works in ACEScg, the path tracer in linear Rec.709, and
// the Viewer (js/render3d-color.js: ACES 1.0 · Rec.709 / sRGB, Rec.709, sRGB, Raw) takes the image to the screen.
// It is a tab of the module bar (edition/cp-edition.js adds it) with its own page in place of the app: it has its own
// scene and renderer and does not touch the rest of the app.
(() => {
const $ = (id) => document.getElementById(id);
// ---------- constants ----------
// the turntable: fixed, so every playblast turns the same way and at the same speed
const LK_FPS = 24, LK_OBJ = 120, LK_LIGHT = 120, LK_N = LK_OBJ + LK_LIGHT; // frames 1–120: model; 121–240: light
const LK_HDRIS = CP_HDRIS; // edition/cp-edition.js (the 3D Render tab has them too)
const LK_ASPECT = 16 / 9;
// film backs (width, mm) for Film: a lens of a given camera frames as it does on that sensor
const LK_FILMS = [[36, 'Full frame · 36 mm'], [36.7, 'ARRI ALEXA Mini LF · 36.70'], [27.99, 'ARRI ALEXA 35 · 27.99'], [28.25, 'ARRI ALEXA Mini · 28.25 (Open Gate)'], [24.89, 'Super 35 · 24.89'], [23.5, 'APS-C · 23.5'], [17.3, 'Micro Four Thirds · 17.3'], [9.6, 'iPhone main · 9.6']];
// ColorChecker Classic, sRGB 8 bit (the 24 patches, row by row)
const LK_CHART = [[115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52]];
const LK_PB_Q = { draft: [16, 3], preview: [64, 4], good: [256, 6], final: [1024, 8] };
const LK_FONT = { monitor: { css: '--f-ui', w: 500, wv: 700, track: 0.07 }, mono: { css: '--f-num', w: 400, wv: 600, track: 0.02 } };
const LK_TEXT = { small: 0.0125, large: 0.016 };
const LK_FIELDS = [['project', 'Project'], ['asset', 'Asset'], ['tag', 'LOOKDEV'], ['hdri', 'HDRI / sky'], ['rot', 'Rotation'], ['ev', 'Exposure'], ['lens', 'Lens'], ['film', 'Film'],
  ['view', 'Viewer'], ['engine', 'Engine'], ['frame', 'Frame'], ['pass', 'Pass'], ['date', 'Date'], ['artist', 'Artist']];
const LK_DEF = { env: 'hdri', hdri: 'studio', cs: 'lin', int: 1, rot: 0, ev: 0, show: true, bg: '#3a3a3a', blur: 0, view: 'aces709',
  film: 36, start: 1001, aa: 16, lmode: 'hl', logo: true, hq: true,
  skyCol: '#bfd4ff', gndCol: '#4a4238', skyInt: 1, sunAz: 135, sunEl: 40, skyT: 3, skyAlb: 0.1, sunInt: 2.4, lights: [], pxSpace: 'acescg', up: 'auto', yaw: 0, units: 'auto', clay: false, offX: 0, offY: 0, offZ: 0,
  chrome: true, grey: true, chart: true, shadow: true, dir: 'ccw', lens: 50, elev: 10, fill: 0.8, engine: 'raster', spp: 512, bounces: 6, dn: true,
  burn: true, project: '', artist: '', fields: { project: true, asset: true, tag: true, hdri: true, rot: true, ev: true, lens: true, film: true, view: true, engine: true, frame: true, pass: true, date: true, artist: false },
  text: 'small', font: 'monitor', align: 'left', talign: 'left', bars: 0.6, pbSize: '1080', pbQ: 'preview' };
const lkClone = (v) => JSON.parse(JSON.stringify(v));
const lkSaved = (() => { const v = lsGet('lkd', {}); return v && typeof v === 'object' ? v : {}; })();
const lk = Object.assign({}, LK_DEF, lkSaved, { fields: Object.assign({}, LK_DEF.fields, lkSaved.fields || {}) });
if (!R3_VIEWS.some(v => v[0] === lk.view)) lk.view = LK_DEF.view;
lk.lights = Array.isArray(lk.lights) ? lkClone(lk.lights) : []; // a copy: never the array of LK_DEF
lk.fill = Math.min(2, Math.max(0.3, +lk.fill || LK_DEF.fill));
// the model formats (the main file of what is dropped) and what the file pickers take
const LK_MODEL_RE = /\.(glb|gltf|usdz|usdc|usda|usd|fbx|obj|ply)$/i;
const LK_ACCEPT = '.glb,.gltf,.bin,.usdz,.usdc,.usda,.usd,.fbx,.obj,.mtl,.ply,.zip,image/*';
const lkSave = () => { const o = {}; for (const k of Object.keys(LK_DEF)) o[k] = lk[k]; lsSet('lkd', o); };
// what each Reset section puts back (the model, the HDRI file and the burn-in texts stay)
const LK_RESET = {
  model: ['up', 'yaw', 'units', 'offX', 'offY', 'offZ'],
  env: ['env', 'cs', 'int', 'rot', 'show', 'bg', 'blur', 'skyCol', 'gndCol', 'skyInt', 'sunAz', 'sunEl', 'skyT', 'skyAlb', 'sunInt'],
  lights: ['lights'],
  turn: ['dir', 'lens', 'film', 'elev', 'fill'],
  refs: ['chrome', 'grey', 'chart', 'shadow', 'clay'],
  pt: ['spp', 'bounces', 'dn'],
  burn: ['burn', 'fields', 'text', 'font', 'align', 'talign', 'bars'],
  pb: ['pbSize', 'pbQ', 'aa', 'start', 'logo'],
};

// runtime
const L = { on: false, frame: 1, playing: false, t0: 0, f0: 1, raf: 0, dirty: true, model: null, modelName: '', fileUnit: 1, root: null, pivot: null,
  r: 1, c: new THREE.Vector3(), free: false, freeCam: null, nav: null, measure: false, mA: null, mB: null, hdriTex: null, hdriName: '', pmrem: null, envMap: null,
  userHdri: null, hdriWs: null, rtB: null, rtD: null, qView: null, tracer: null, ptLib: null, ptBuilt: false, ptBusy: false, pbBusy: false, tris: 0, refs: null, shadowR: null, shadowPT: null, clayMat: null, keyT: 0,
  tool: 'nav', accN: 0, hdriRaw: null, sun: null, lights: [], lsel: -1, lshadow: null, areaOk: false, px: null, pxT: 0 };

// ---------- page ----------
const lkIcon = (p) => `<svg viewBox="0 0 24 24">${p}</svg>`;
document.querySelector('.app').insertAdjacentHTML('afterend', `
<div class="lkdapp" id="lkdapp" hidden>
  <div class="viewer lkd-viewer">
    <div class="vbar"><div class="lkd-bar">
      <button class="btn sm primary r3back lkd-back" id="lkd-back" hidden title="The view was moved: this is a free camera. Back to the turntable camera (F); the turntable itself never changed"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.2"/></svg>Back to camera</button>
      <span class="sep"></span>
      <button class="vpchip" id="lkd-c-show" aria-pressed="true" title="Show the environment (HDRI or sky) behind the model; hidden, it still lights it (the background color is in Environment)">${lkIcon('<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>')}HDRI</button>
      <button class="vpchip" id="lkd-c-clay" aria-pressed="false" title="Clay: a grey material on the whole model">${lkIcon('<path d="M12 3c4 0 7 3 7 7 0 5-3 11-7 11S5 15 5 10c0-4 3-7 7-7z"/>')}Clay</button>
      <button class="vpchip" id="lkd-c-refs" aria-pressed="true" title="References: chrome ball, 18% grey ball and ColorChecker (which ones: References)">${lkIcon('<circle cx="8" cy="12" r="4"/><circle cx="17" cy="12" r="3"/>')}Refs</button>
      <button class="vpchip" id="lkd-c-burn" aria-pressed="true" title="Preview the burn-in of the playblast on the viewport (Burn-in)">${lkIcon('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 8.5h18M3 15.5h18"/>')}Burn-in</button>
      <span class="sep"></span>
      <div class="seg" role="group" aria-label="Engine"><button id="lkd-e-raster" aria-pressed="true" title="Raster: fast; the shadow under the model is a contact shadow">Raster</button><button id="lkd-e-pt" aria-pressed="false" title="Path trace: light that really bounces and real shadows (the catcher is an 18% grey floor); it fills in while the view is still">Path trace</button></div>
      <button class="tool sm lkd-gpux" id="lkd-gpux" disabled aria-label="Clear GPU cache">${lkIcon('<rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>')}</button>
      <button class="vpchip" id="lkd-c-hq" aria-pressed="true" title="Max quality (Raster), like 3D Render: while the view is still, it renders again and again with the camera moved less than a pixel and averages them (as many as Playblast › Raster quality, 8 at least): clean edges, textures and shadows. Off: always the interactive one">${lkIcon('<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>')}Max quality</button>
      <select class="lkd-vt" id="lkd-view" aria-label="Viewer" title="Viewer: how the render goes to the screen, as in 3D Render and the Viewer of the plate (Raster works in ACEScg, Path trace in linear Rec.709). ACES 1.0 · Rec.709 or sRGB: the ACES output transform for that display">${R3_VIEWS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
      <span class="fmt" id="lkd-st">–</span>
    </div>
    <div class="lkd-bar lkd-bar2"><span class="camrow lkd-camrow">
      <label class="camh" title="Lens of the turntable camera, on the film back of FILM; 16:9. Drag it sideways or type">LENS <input id="lkd-v-lens" class="mini" type="number" step="1" min="4" max="600" data-unit="mm" aria-label="Lens"></label>
      <label class="camh" title="Width of the film back (sensor), in mm: with the lens of a given camera, set its sensor here (the presets are in Turntable &amp; camera). Drag it sideways or type">FILM <input id="lkd-v-film" class="mini" type="number" step="0.1" min="4" max="80" data-unit="mm" aria-label="Film back width"></label>
      <span class="sep"></span>
      <label class="camh" title="Height of the camera: its angle above the centre of the model. Drag it sideways or type">HEIGHT <input id="lkd-v-elev" class="mini" type="number" step="0.5" min="-30" max="80" data-unit="°" aria-label="Camera height"></label>
      <span class="sep"></span>
      <label class="camh" title="Zoom: how much of the frame the model takes; 1 fills it, 2 is twice as close. Drag it sideways or type">ZOOM <input id="lkd-v-fill" class="mini" type="number" step="0.01" min="0.3" max="2" aria-label="Zoom"></label>
      </span>
      <span class="sep"></span>
      <label class="vpchip" for="lkd-v-ev-r" title="Exposure, in stops (EV), before the Viewer: both engines. Double-click the slider to reset">Exposure <input id="lkd-v-ev-r" type="range" min="-6" max="6" step="0.1" value="0"><b id="lkd-v-ev-n">+0.0</b></label>
    </div></div>
    <div class="lkd-mid">
    <nav class="tools lkd-tools" aria-label="Lookdev tools">
      <button class="tool" id="lkd-nav" aria-pressed="true" title="Navigate (N): the Nav mouse style of the app (it leaves the turntable camera; Back to camera returns)" aria-label="Navigate">${lkIcon('<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M17.5 6.2 21 8.3l-1.2 3.6"/><circle cx="12" cy="12" r="1.6"/><path d="M12 3v3M12 18v3"/>')}<kbd>N</kbd></button>
      <button class="tool" id="lkd-meas" aria-pressed="false" title="Measure (M): click two points on the model" aria-label="Measure">${lkIcon('<rect x="2.5" y="8" width="19" height="8" rx="1" transform="rotate(-30 12 12)"/><path d="m7.3 13.9-1-1.7M10.3 12.2l-1.5-2.6M13.3 10.4l-1-1.7M16.3 8.7l-1.5-2.6"/>')}<kbd>M</kbd></button>
      <button class="tool" id="lkd-light" aria-pressed="false" title="Light (L): click (or drag) on the model where the highlight should be, and the selected light goes there (with no light, an area light is added). Shift + click adds a new one. The lights are in Lights" aria-label="Light">${lkIcon('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>')}<kbd>L</kbd></button>
      <div class="lkd-fly" id="lkd-fly" hidden role="group" aria-label="Lights">
        <button class="tool" id="lkd-lm-hl" aria-pressed="true" title="Place by highlight: click (or drag) on the model where the highlight should be; the selected light goes there" aria-label="Place by highlight">${lkIcon('<circle cx="12" cy="13" r="6.5"/><circle cx="9.6" cy="10.6" r="1.6" fill="currentColor"/><path d="M17 3l1 2.2L20.2 6 18 7l-1 2.2L16 7l-2.2-1L16 5z"/>')}</button>
        <button class="tool" id="lkd-lm-orb" aria-pressed="false" title="Move: drag anywhere to turn the selected light around the model (sideways: direction, up and down: height); Shift + drag: distance. Dragging a light on the view moves it in any mode" aria-label="Move the light">${lkIcon('<ellipse cx="12" cy="13" rx="9" ry="4"/><circle cx="18.5" cy="10.5" r="2.2" fill="currentColor"/><path d="M12 3v6M9.5 5.5 12 3l2.5 2.5"/>')}</button>
        <span class="tsep"></span>
        <button class="tool" data-lkadd="area" title="Add an area light: a soft square panel (the key light of a studio)" aria-label="Add an area light">${lkIcon('<rect x="5" y="4" width="14" height="10" rx="1"/><path d="M8 17l-1 3M12 17v3M16 17l1 3"/>')}</button>
        <button class="tool" data-lkadd="spot" title="Add a spot light: a cone, with its penumbra" aria-label="Add a spot light">${lkIcon('<path d="M9 3h6l-1 5h-4z"/><path d="M10 8 5 21h14L14 8"/>')}</button>
        <button class="tool" data-lkadd="point" title="Add a point light: it lights all around (its size makes it soft)" aria-label="Add a point light">${lkIcon('<circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>')}</button>
        <button class="tool" data-lkadd="dir" title="Add a directional light: parallel rays from far away, like the sun" aria-label="Add a directional light">${lkIcon('<circle cx="7" cy="7" r="3"/><path d="M10 10l9 9M13 7l7 7M7 13l7 7"/>')}</button>
      </div>
      <button class="tool" id="lkd-pix" aria-pressed="false" title="Pixel analyzer (I), like the one of Nuke: hover to read a pixel, drag a box for its average, minimum and maximum; R, G, B and luminance, in ACEScg, linear Rec.709 or as on the screen. Esc clears the box" aria-label="Pixel analyzer">${lkIcon('<path d="M4 20V10M9 20V4M14 20v-7M19 20v-11"/><path d="M2.5 20.5h19"/>')}<kbd>I</kbd></button>
      <span class="tsep"></span>
      <button class="tool" id="lkd-reset-view" title="Reset the view: back to the turntable camera with the default lens, height and framing" aria-label="Reset the view">${lkIcon('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><path d="M9.5 13.5a2.5 2.5 0 1 0 .8-1.8"/><path d="M9.6 10.6v1.6h1.6"/>')}</button>
    </nav>
    <div class="lkd-box" id="lkd-box">
      <div class="lkd-frame" id="lkd-frame">
        <canvas id="lkd-gl"></canvas><canvas id="lkd-burncv"></canvas><svg class="lkd-ov" id="lkd-ov"></svg>
        <div class="lkd-mpop" id="lkd-mpop" hidden><span id="lkd-md">–</span><button class="btn sm ghost" id="lkd-mx" title="Clear (Esc)">×</button></div>
      </div>
      <div class="lkd-empty" id="lkd-empty"><b>Drop a 3D model here</b><span class="note">GLB, GLTF, USDZ / USD, FBX, OBJ with its .mtl and images, PLY. A model with its textures apart: drop its whole folder or the ZIP (like the downloads of Sketchfab), or select the files together</span><span class="file btn primary">Load model<input id="lkd-f" type="file" multiple accept="${LK_ACCEPT}"></span></div>
      <p class="lkd-busy" id="lkd-busy" hidden></p>
      <div class="r3ptprog" id="lkd-prog" hidden role="progressbar" aria-label="Building the path trace scene"><span id="lkd-prog-t"></span><div class="r3-bar"><i id="lkd-prog-b"></i></div></div>
      <div class="lkd-drop" id="lkd-drop" hidden>Drop the model, its folder or its ZIP</div>
      <div class="lkd-pxa" id="lkd-pxa" hidden>
        <div class="lkd-pxh"><b>Pixel analyzer</b><select id="lkd-px-sp" aria-label="Values in"><option value="acescg">ACEScg</option><option value="lin709">Linear Rec.709</option><option value="disp">Display (0–255)</option></select><button class="btn sm ghost" id="lkd-px-x" title="Clear the box (Esc)">×</button></div>
        <table><thead><tr><th></th><th></th><th>R</th><th>G</th><th>B</th><th>L</th></tr></thead><tbody id="lkd-px-t"></tbody></table>
        <p class="note" id="lkd-px-n">Hover the view; drag a box</p>
      </div>
    </div>
    </div>
    <div class="lkd-play">
      <button class="btn sm ghost" id="lkd-p-first" title="First frame (Home)" aria-label="First frame">${lkIcon('<path d="M6 5v14M18 6l-9 6 9 6z"/>')}</button>
      <button class="btn sm" id="lkd-p-play" title="Play / pause the turntable (Space)" aria-label="Play">${lkIcon('<path d="M8 5l11 7-11 7z"/>')}</button>
      <input type="range" id="lkd-p-f" min="1" max="${LK_N}" step="1" value="1" aria-label="Frame">
      <span class="lkd-pf"><b id="lkd-p-n">1001</b> / <span id="lkd-p-end">1240</span></span>
      <span class="note" id="lkd-p-pass">Model turns</span>
      <span class="note lkd-pfps">${LK_FPS} fps · ${LK_N / LK_FPS} s</span>
      <button class="btn sm" id="lkd-still" title="Save this frame as a PNG, at the size of the playblast, with its quality and the burn-in (from the view as it is, also a free camera)" disabled>Still PNG</button>
      <button class="btn sm" id="lkd-pb" title="Render the turntable to an MP4, with the burn-in" disabled>Playblast</button>
    </div>
    <div class="ibar lkd-ibar">
      <span class="xy" title="Position on the frame, in pixels of the playblast">x <b id="lkd-cx">–</b> y <b id="lkd-cy">–</b></span>
      <span class="hint" id="lkd-hint"></span>
      <span class="navz"><label for="lkd-navp">Nav <select id="lkd-navp" style="width:auto" title="The mouse style of the app (the same as Nav in the other tabs)"></select></label></span>
    </div>
  </div>
  <div></div>
  <aside class="props" aria-label="Lookdev settings"><div class="scroll">
    <section class="step" id="lkd-s-model"><h2 tabindex="0">Model<span class="st" id="lkd-model-st">none</span><button class="btn sm hload" id="lkd-remove2" title="Remove the model from the view (the lights and the settings stay)" hidden>Remove</button></h2><div class="body">
      <div class="knobrow"><span>File</span><div class="row"><span class="file btn">Load model<input id="lkd-f2" type="file" multiple accept="${LK_ACCEPT}"></span><span class="note" id="lkd-model-n">none</span></div></div>
      <p class="note" id="lkd-model-msg" hidden></p>
      <label class="fld" for="lkd-up">Up axis<select id="lkd-up"><option value="auto">Auto (from the file)</option><option value="y">Y up</option><option value="z">Z up</option><option value="-z">−Z up</option><option value="x">X up</option></select></label>
      <label class="fld" for="lkd-yaw">Facing<select id="lkd-yaw"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>
      <label class="fld" for="lkd-units">File units<select id="lkd-units"><option value="auto">Auto (by size)</option><option value="1">Meters</option><option value="0.01">Centimeters</option><option value="0.001">Millimeters</option><option value="0.0254">Inches</option></select></label>
      <div class="knobrow"><span>Size</span><span class="note" id="lkd-dims">–</span></div>
      <div class="knobrow" title="Moves the model away from the centre of the turntable, in meters: the camera keeps looking at the centre, so the model turns off-centre"><span>Offset (m)</span><div class="lkd-off">${['X', 'Y', 'Z'].map(a => `<label for="lkd-off${a.toLowerCase()}">${a}<input id="lkd-off${a.toLowerCase()}" type="number" step="0.01"></label>`).join('')}<button class="btn sm ghost" id="lkd-off0" title="No offset">0</button></div></div>
      <div class="row k"><button class="btn sm ghost" id="lkd-remove" disabled>Remove model</button></div>
      <div class="row k lkd-sreset"><button class="btn sm ghost" data-lkreset="model" title="Up axis, facing, units and offset back to their defaults (the model stays)">Reset section</button></div>
    </div></section>
    <section class="step" id="lkd-s-light"><h2 tabindex="0">Environment<span class="st" id="lkd-light-st"></span></h2><div class="body">
      <div class="seg lkd-envseg" role="group" aria-label="Environment"><button id="lkd-env-hdri" aria-pressed="true" title="An HDRI: the library of the edition or one of yours">HDRI</button><button id="lkd-env-colors" aria-pressed="false" title="A plain sky light from two colors: the sky above and the ground below (like Sky colors of 3D Render)">Sky colors</button><button id="lkd-env-phys" aria-pressed="false" title="A physical sky (Preetham, the daylight model of render engines) with its sun, like Physical sky of 3D Render">Physical sky</button></div>
      <div id="lkd-envr-hdri">
        <label class="fld" for="lkd-hdri">HDRI<select id="lkd-hdri">${LK_HDRIS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}<option value="user" disabled>Your HDRI</option></select></label>
        <div class="knobrow"><span>Your HDRI</span><div class="row"><span class="file btn sm">Load .hdr / .exr<input id="lkd-fh" type="file" accept=".hdr,.exr"></span><span class="note" id="lkd-hdri-n">–</span></div></div>
        <label class="fld" for="lkd-cs" title="Most HDRIs are linear sRGB (Rec.709 primaries). ACEScg ones are converted to it (the same as in 3D Render)">Color space<select id="lkd-cs"><option value="lin">Linear sRGB (Rec.709)</option><option value="acescg">ACEScg (AP1)</option></select></label>
        <div class="knobrow"><label for="lkd-int" title="How much the HDRI lights the model (and how bright it is behind it)">Intensity</label><input id="lkd-int" type="number" step="0.05" min="0" max="20"></div>
      </div>
      <div id="lkd-envr-sky">
        <div class="knobrow"><label for="lkd-skyint" title="How much the sky lights the model">Sky light</label><input id="lkd-skyint" type="number" step="0.05" min="0" max="20"></div>
        <div class="row k" id="lkd-envr-colors"><label class="fld" for="lkd-skycol" title="The color of the sky: it lights from above and is the background">Sky color <input id="lkd-skycol" type="color"></label><label class="fld" for="lkd-gndcol" title="The color of the light bounced from the ground, from below">Ground color <input id="lkd-gndcol" type="color"></label></div>
        <div id="lkd-envr-phys">
          <div class="knobrow"><label for="lkd-sunaz" title="Where the sun is, around the model: 0° is behind the camera at frame 1">Sun direction</label><input id="lkd-sunaz" type="number" step="1" min="-360" max="360" data-unit="°"></div>
          <div class="knobrow"><label for="lkd-sunel" title="Height of the sun above the horizon">Sun height</label><input id="lkd-sunel" type="number" step="0.5" min="-10" max="90" data-unit="°"></div>
          <div class="knobrow"><label for="lkd-sunint" title="Intensity of the sun (a directional light, with its shadow)">Sun intensity</label><input id="lkd-sunint" type="number" step="0.1" min="0" max="20"></div>
          <div class="knobrow"><label for="lkd-skyt" title="Haze in the air: 2 is a very clear day, 3 a clear one, 6 to 10 a hazy one">Turbidity</label><input id="lkd-skyt" type="number" step="0.1" min="1.7" max="10"></div>
          <div class="knobrow"><label for="lkd-skyalb" title="How much light the ground below the horizon gives back">Ground albedo</label><input id="lkd-skyalb" type="number" step="0.01" min="0" max="1"></div>
        </div>
      </div>
      <div class="knobrow"><label for="lkd-rot" title="Turns the environment (and the sun) around the model">Rotation</label><input id="lkd-rot" type="number" step="1" min="-360" max="360" data-unit="°"></div>
      <div class="knobrow"><label for="lkd-show">Show it as background</label><input id="lkd-show" type="checkbox"></div>
      <div class="knobrow"><label for="lkd-bgc">Background</label><div class="row"><input id="lkd-bgc" type="color"><span class="note">when it is hidden</span></div></div>
      <div class="knobrow"><label for="lkd-blur" title="Blur of the environment behind the model (Raster)">Blur</label><input id="lkd-blur" type="number" step="0.05" min="0" max="1"></div>
      <div class="knobrow"><label for="lkd-ev" title="Before the Viewer (the Viewer is on the bar of the view)">Exposure</label><input id="lkd-ev" type="number" step="0.1" min="-10" max="10" data-unit="EV"></div>
      <p class="note">Color: Raster lights in ACEScg and Path trace in linear Rec.709, and the Viewer on the bar of the view takes it to the screen. HDRIs: a selection of <a href="https://polyhaven.com/hdris" target="_blank" rel="noopener">Poly Haven</a> (CC0), 512 px, for the light; load one of yours for a sharp background.</p>
      <div class="row k lkd-sreset"><button class="btn sm ghost" data-lkreset="env" title="The environment back to its defaults (HDRI, color space, intensity, rotation, background, skies and sun); the HDRI file of yours stays loaded">Reset section</button></div>
    </div></section>
    <section class="step" id="lkd-s-lights"><h2 tabindex="0">Lights<span class="st" id="lkd-lights-st">none</span></h2><div class="body">
      <div class="lkd-llist" id="lkd-llist"></div>
      <div id="lkd-lprops" hidden>
        <label class="fld" for="lkd-l-type">Type<select id="lkd-l-type"><option value="area">Area</option><option value="spot">Spot</option><option value="point">Point</option><option value="dir">Directional</option></select></label>
        <div class="knobrow"><label for="lkd-l-col">Color</label><input id="lkd-l-col" type="color"></div>
        <div class="knobrow"><label for="lkd-l-int" title="How much it lights the centre of the model, whatever its distance or size (1: as much as a white sky of intensity 1)">Intensity</label><input id="lkd-l-int" type="number" step="0.05" min="0" max="1000"></div>
        <div class="knobrow"><label for="lkd-l-ev" title="Exposure of the light, in stops: +1 is twice the light">Exposure</label><input id="lkd-l-ev" type="number" step="0.1" min="-10" max="10" data-unit="EV"></div>
        <div class="knobrow"><label for="lkd-l-az" title="Around the model: 0° is the camera side at frame 1. It turns with the light of the turntable">Direction</label><input id="lkd-l-az" type="number" step="1" min="-360" max="360" data-unit="°"></div>
        <div class="knobrow"><label for="lkd-l-el" title="Height above the centre of the model">Height</label><input id="lkd-l-el" type="number" step="0.5" min="-90" max="90" data-unit="°"></div>
        <div class="knobrow" id="lkd-l-dist-r"><label for="lkd-l-dist" title="Distance to the centre of the model">Distance</label><input id="lkd-l-dist" type="number" step="0.01" min="0.01" max="1000" data-unit="m"></div>
        <div class="knobrow" id="lkd-l-size-r"><label for="lkd-l-size" title="Size of the light: an area light is a square of this side; a point or a spot, a sphere of this diameter. Bigger is softer">Size</label><input id="lkd-l-size" type="number" step="0.01" min="0" max="100" data-unit="m"></div>
        <div class="knobrow" id="lkd-l-ang-r"><label for="lkd-l-ang" title="Cone of the spot">Cone</label><input id="lkd-l-ang" type="number" step="1" min="1" max="170" data-unit="°"></div>
        <div class="knobrow" id="lkd-l-pen-r"><label for="lkd-l-pen" title="Soft edge of the cone">Penumbra</label><input id="lkd-l-pen" type="number" step="0.01" min="0" max="1"></div>
        <div class="knobrow" id="lkd-l-sh-r"><label for="lkd-l-sh" title="Raster: a shadow map (an area light has none in Raster). Path trace always has its real shadows">Shadows (Raster)</label><input id="lkd-l-sh" type="checkbox"></div>
      </div>
      <p class="note">The Light tool (L, on the left of the view) adds them (Area, Spot, Point, Directional) and places them: by highlight (click on the model where the highlight should be) or Move (drag to turn the light around the model; Shift: distance). The lights turn with the light of the turntable, like the HDRI.</p>
      <div class="row k lkd-sreset"><button class="btn sm ghost" data-lkreset="lights" title="Removes all the lights">Reset section</button></div>
    </div></section>
    <section class="step" id="lkd-s-turn"><h2 tabindex="0">Turntable &amp; camera</h2><div class="body">
      <p class="note">Fixed length, always the same: frames 1–${LK_OBJ} the camera and the light orbit the model together (it turns under a fixed light), frames ${LK_OBJ + 1}–${LK_N} the light alone turns 360°, in the same direction. ${LK_FPS} fps, ${LK_N / LK_FPS} s.</p>
      <label class="fld" for="lkd-dir">Direction<select id="lkd-dir"><option value="ccw">Counter-clockwise (seen from above)</option><option value="cw">Clockwise</option></select></label>
      <div class="knobrow"><label for="lkd-lens" title="On the film back below; 16:9">Lens</label><input id="lkd-lens" type="number" step="1" min="4" max="600" data-unit="mm"></div>
      <label class="fld" for="lkd-filmp" title="The sensor of a camera: its width is the film back">Film back<select id="lkd-filmp">${LK_FILMS.map(([w, n]) => `<option value="${w}">${n}</option>`).join('')}<option value="custom">Custom</option></select></label>
      <div class="knobrow"><label for="lkd-film" title="Width of the film back (the frame is 16:9)">Film width</label><input id="lkd-film" type="number" step="0.01" min="4" max="80" data-unit="mm"></div>
      <div class="knobrow"><label for="lkd-elev" title="Angle of the camera above the model">Camera height</label><input id="lkd-elev" type="number" step="0.5" min="-30" max="80" data-unit="°"></div>
      <div class="knobrow"><label for="lkd-fill" title="How much of the frame the model takes: 1 fills it, 2 is twice as close">Zoom</label><input id="lkd-fill" type="number" step="0.01" min="0.3" max="2"></div>
      <div class="row k lkd-sreset"><button class="btn sm ghost" data-lkreset="turn" title="Direction, lens, film back, height and zoom back to their defaults">Reset section</button></div>
    </div></section>
    <section class="step" id="lkd-s-refs"><h2 tabindex="0">References</h2><div class="body">
      <div class="knobrow"><label for="lkd-chrome">Chrome ball</label><input id="lkd-chrome" type="checkbox"></div>
      <div class="knobrow"><label for="lkd-grey">18% grey ball</label><input id="lkd-grey" type="checkbox"></div>
      <div class="knobrow"><label for="lkd-chart">ColorChecker</label><input id="lkd-chart" type="checkbox"></div>
      <div class="knobrow"><label for="lkd-shadow">Shadow catcher</label><input id="lkd-shadow" type="checkbox"></div>
      <p class="note">The balls and the chart stay in the lower right corner of the frame. The shadow catcher is a contact shadow in Raster (plus the shadows of the lights), and in Path trace an 18% grey floor with the real shadows.</p>
      <div class="row k lkd-sreset"><button class="btn sm ghost" data-lkreset="refs" title="References, shadow catcher and clay back to their defaults">Reset section</button></div>
    </div></section>
    <section class="step" id="lkd-s-pt"><h2 tabindex="0">Path trace<span class="st" id="lkd-pt-st">off</span></h2><div class="body">
      <div class="knobrow"><label for="lkd-spp" title="On the viewport it stops here">Samples</label><input id="lkd-spp" type="number" step="1" min="1" max="100000"></div>
      <div class="knobrow"><label for="lkd-bounces">Bounces</label><input id="lkd-bounces" type="number" step="1" min="1" max="30"></div>
      <div class="knobrow"><label for="lkd-dn">Denoise</label><input id="lkd-dn" type="checkbox"></div>
      <div class="row k lkd-sreset"><button class="btn sm ghost" data-lkreset="pt" title="Samples, bounces and denoise back to their defaults">Reset section</button></div>
    </div></section>
    <section class="step" id="lkd-s-burn"><h2 tabindex="0">Burn-in</h2><div class="body">
      <div class="knobrow"><label for="lkd-burn">Preview on the viewport</label><input id="lkd-burn" type="checkbox"></div>
      <label class="fld" for="lkd-project">Project<input id="lkd-project" type="text" maxlength="60" placeholder="Project"></label>
      <label class="fld" for="lkd-artist">Artist<input id="lkd-artist" type="text" maxlength="60" placeholder="Name"></label>
      <div class="knobrow"><span>Show</span><div class="lkd-fields" id="lkd-fields">${LK_FIELDS.map(([k, n]) => `<label class="row" for="lkd-fd-${k}"><input id="lkd-fd-${k}" type="checkbox" data-k="${k}"> ${n}</label>`).join('')}</div></div>
      <div class="knobrow"><label for="lkd-bars" title="Darkness of the bars behind the letters">Info bars</label><input id="lkd-bars" type="number" step="0.05" min="0" max="1"></div>
      <label class="fld" for="lkd-text">Text size<select id="lkd-text"><option value="small">Small</option><option value="large">Large</option></select></label>
      <label class="fld" for="lkd-font">Font<select id="lkd-font" title="Letters of the info, like a camera monitor"><option value="monitor">Monitor</option><option value="mono">Mono</option></select></label>
      <label class="fld" for="lkd-align">Info align<select id="lkd-align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label class="fld" for="lkd-talign">Title align<select id="lkd-talign"><option value="left">Left</option><option value="center">Center</option></select></label>
      <div class="row k lkd-sreset"><button class="btn sm ghost" data-lkreset="burn" title="The look and the fields of the burn-in back to their defaults (the project and the artist stay)">Reset section</button></div>
    </div></section>
    <section class="step" id="lkd-s-pb"><h2 tabindex="0">Playblast</h2><div class="body">
      <label class="fld" for="lkd-pbsize">Size<select id="lkd-pbsize"><option value="1080">1080p (1920 × 1080)</option><option value="2160">UHD (3840 × 2160)</option><option value="720">720p (1280 × 720)</option></select></label>
      <label class="fld" for="lkd-pbq">Path trace quality<select id="lkd-pbq" title="Samples per frame and bounces, when the engine is Path trace"><option value="draft">Draft · 16 samples, 3 bounces</option><option value="preview">Preview · 64 samples, 4 bounces</option><option value="good">Good · 256 samples, 6 bounces</option><option value="final">Final · 1024 samples, 8 bounces</option><option value="tab">As in Path trace</option></select></label>
      <label class="fld" for="lkd-aa" title="Raster: each frame is rendered this many times, with the camera moved less than a pixel, and averaged: clean edges, textures and shadows (like Max quality of 3D Render)">Raster quality<select id="lkd-aa"><option value="1">Interactive · 1 sample</option><option value="8">Max quality · 8 samples</option><option value="16">Max quality · 16 samples</option><option value="32">Max quality · 32 samples</option></select></label>
      <div class="knobrow"><label for="lkd-logo" title="The logo of Settings (Logo) on this playblast and its stills">Logo</label><div class="row"><input id="lkd-logo" type="checkbox"><span class="note" id="lkd-logo-n"></span></div></div>
      <div class="knobrow"><label for="lkd-start" title="The number of the first frame (burn-in, play bar, PNG names)">First frame</label><input id="lkd-start" type="number" step="1" min="0" max="999999" data-noscrub="1"></div>
      <p class="note">All ${LK_N} frames from the turntable camera, with the engine of the viewport and the burn-in. Still PNG saves the frame on the view, with the same size and quality.</p>
      <div class="row k"><button class="btn primary sm" id="lkd-pb2" disabled>Playblast</button><button class="btn sm" id="lkd-still2" disabled>Still PNG</button></div>
      <div class="row k lkd-sreset"><button class="btn sm ghost" data-lkreset="pb" title="Size, quality and first frame back to their defaults">Reset section</button></div>
    </div></section>
  </div></aside>
</div>
<div class="start" id="lkd-pbdlg" role="dialog" aria-modal="true" aria-labelledby="lkd-pb-t" hidden>
  <div class="start-card lkd-pbcard">
    <b id="lkd-pb-t">Lookdev playblast</b>
    <p class="note" id="lkd-pb-info"></p>
    <div class="lkd-pbbar"><i id="lkd-pb-bar"></i></div>
    <p class="note" id="lkd-pb-st"></p>
    <video id="lkd-pb-video" controls muted playsinline hidden></video>
    <div class="start-btns"><button class="btn" id="lkd-pb-save" hidden title="Save it again (Downloads; the desktop app asks where)">Save MP4</button><button class="btn" id="lkd-pb-saveas" hidden title="Pick the folder">Save as…</button><button class="btn ghost" id="lkd-pb-x">Cancel</button></div>
  </div>
</div>`);
document.querySelectorAll('#lkdapp .step > h2').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('closed')));
// the burn-in and the playblast start closed
['lkd-s-burn', 'lkd-s-pb', 'lkd-s-pt'].forEach(id => $(id).classList.add('closed'));
// the numbers drag sideways like everywhere in the app (js/panel.js), with their units
enhanceNumbers($('lkdapp'));

// ---------- renderer and scene ----------
const canvas = $('lkd-gl'), burnCv = $('lkd-burncv');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.NoToneMapping; // the Viewer does the tone mapping (lkView)
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(30, LK_ASPECT, 0.01, 1000);
scene.add(cam);
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
// ---------- color: Raster in ACEScg, Path trace in linear Rec.709; the Viewer of 3D Render to the screen ----------
// the materials of the model and of the references: color, textures, vertex colors and emissive to AP1 in the shader
// (Raster only: the path tracer reads the same materials in Rec.709)
function lkWs(m) {
  if (!m || m.userData.lkWs || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return m;
  m.userData.lkWs = true;
  r3WsPatch(m);
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( R3_TO_AP1 * diffuse, opacity );')
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = R3_TO_AP1 * emissive;');
  };
  m.customProgramCacheKey = () => 'lkws';
  m.needsUpdate = true;
  return m;
}
const LK_VIEW_SHADER = {
  uniforms: { tSrc: { value: null }, view: { value: 0 }, exposure: { value: 1 }, in709: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tSrc; uniform int view; uniform float exposure, in709; varying vec2 vUv;
    ${R3_VIEW_GLSL}
    ${R3_TO_AP1_GLSL}
    void main() {
      vec4 s = texture2D(tSrc, vUv); vec3 c = s.rgb;
      // the path tracer: linear Rec.709, premultiplied by its alpha
      if (in709 > 0.5) { if (s.a > 1e-4) c /= s.a; c = R3_TO_AP1 * c; }
      gl_FragColor = vec4(r3ViewEnc(r3ViewLin(max(c, 0.0) * exposure, view), view), 1.0);
    }`,
};
// a float target the size of the canvas (the image before the Viewer)
function lkRT(key, samples) {
  const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
  let t = L[key];
  if (!t || t.width !== sz.x || t.height !== sz.y) {
    if (t) t.dispose();
    t = L[key] = new THREE.WebGLRenderTarget(sz.x, sz.y, { type: THREE.HalfFloatType, samples: samples || 0, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    t.texture.colorSpace = THREE.LinearSRGBColorSpace;
  }
  return t;
}
function lkView(tex, in709, scale = 1) {
  if (!L.qView) { L.qView = new THREE.FullScreenQuad(new THREE.ShaderMaterial(LK_VIEW_SHADER)); L.qView.material.depthTest = false; }
  const u = L.qView.material.uniforms;
  u.tSrc.value = tex; u.view.value = r3ViewIndex(lk.view); u.exposure.value = r3ExpGain(lk.ev) * scale; u.in709.value = in709 ? 1 : 0;
  renderer.setRenderTarget(null); L.qView.render(renderer);
}
// Max quality: n renders with the camera moved less than a pixel (Halton), averaged in a float target
const LK_ACC_SHADER = {
  uniforms: { t: { value: null }, w: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D t; uniform float w; varying vec2 vUv; void main() { gl_FragColor = texture2D(t, vUv) * w; }',
};
// Max quality on the view (like 3D Render): while the view is still, one more jittered render per draw is added to
// the sum (rtA) until there are lkHqN(); anything that changes starts it again from the interactive one
const lkHqN = () => Math.max(8, +lk.aa || 16);
function lkAccMat() {
  if (!L.qAcc) {
    const m = new THREE.ShaderMaterial(LK_ACC_SHADER);
    m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneFactor; m.depthTest = false; m.depthWrite = false; m.transparent = true;
    L.qAcc = new THREE.FullScreenQuad(m);
  }
  return L.qAcc;
}
function lkHqStep() {
  const t = lkRT('rtB', 4), acc = lkRT('rtA', 0), W = t.width, H = t.height, i = L.accN, q = lkAccMat();
  if (i === 0) { const kc = renderer.getClearColor(new THREE.Color()), ka = renderer.getClearAlpha(); renderer.setRenderTarget(acc); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.setClearColor(kc, ka); }
  cam.setViewOffset(W, H, r3Halton(i + 1, 2) - 0.5, r3Halton(i + 1, 3) - 0.5, W, H); cam.updateProjectionMatrix();
  renderer.setRenderTarget(t); renderer.render(scene, cam);
  cam.clearViewOffset(); cam.updateProjectionMatrix();
  q.material.uniforms.t.value = t.texture; q.material.uniforms.w.value = 1;
  renderer.setRenderTarget(acc); renderer.autoClear = false; q.render(renderer); renderer.autoClear = true;
  L.accN = i + 1;
  lkView(acc.texture, false, 1 / L.accN);
}
function lkRasterDrawHQ(n) {
  if (!(n > 1)) { lkRasterDraw(); return; }
  const t = lkRT('rtB', 4), acc = lkRT('rtA', 0), W = t.width, H = t.height;
  if (!L.qAcc) {
    const m = new THREE.ShaderMaterial(LK_ACC_SHADER);
    m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneFactor; m.depthTest = false; m.depthWrite = false; m.transparent = true;
    L.qAcc = new THREE.FullScreenQuad(m);
  }
  const keepC = renderer.getClearColor(new THREE.Color()), keepA = renderer.getClearAlpha();
  renderer.setRenderTarget(acc); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.setClearColor(keepC, keepA);
  for (let i = 0; i < n; i++) {
    const jx = (r3Halton(i + 1, 2) - 0.5), jy = (r3Halton(i + 1, 3) - 0.5);
    cam.setViewOffset(W, H, jx, jy, W, H); cam.updateProjectionMatrix();
    renderer.setRenderTarget(t); renderer.render(scene, cam);
    L.qAcc.material.uniforms.t.value = t.texture; L.qAcc.material.uniforms.w.value = 1 / n;
    renderer.setRenderTarget(acc); renderer.autoClear = false; L.qAcc.render(renderer); renderer.autoClear = true;
  }
  cam.clearViewOffset(); cam.updateProjectionMatrix();
  renderer.setRenderTarget(null);
  L.accN = 0; // rtA now holds an average, not a sum: the view's Max quality starts over
  lkView(acc.texture, false);
}
function lkRasterDraw() {
  const t = lkRT('rtB', 4);
  renderer.setRenderTarget(t); renderer.render(scene, cam); renderer.setRenderTarget(null);
  lkView(t.texture, false);
}
// one sample of the path tracer, into a float target, and the Viewer
function lkPtSample() {
  const t = lkRT('rtP', 0);
  renderer.setRenderTarget(t);
  try { L.tracer.renderSample(); } finally { renderer.setRenderTarget(null); }
  lkView(t.texture, true);
}
const lkVfov = () => 2 * Math.atan(((+lk.film || 36) / LK_ASPECT) / 2 / lk.lens) * 180 / Math.PI;
// the frame number as it is shown (the first one is Start, 1001 by default)
// the logo of Settings (edition/cp-edition-late.js), when this playblast uses it
const lkLogoOn = () => !!lk.logo && typeof cpLogoReady === 'function' && cpLogoReady();
const lkFno = (f) => (+lk.start || 0) + f - 1;

// ---------- environment: an HDRI, Sky colors or Physical sky (like the HDRI section of 3D Render) ----------
// Everything ends in one equirectangular in linear Rec.709 (L.hdriTex: the path tracer) and its copy in ACEScg
// (L.hdriWs, and L.envMap its PMREM: Raster). The HDRI keeps its file (L.hdriRaw) to change its color space.
const lkF32 = (tex) => {
  const im = tex.image, n = im.width * im.height, src = im.data, ch = Math.round(src.length / n);
  const half = src instanceof Uint16Array, rd = half ? (i) => THREE.DataUtils.fromHalfFloat(src[i]) : (i) => src[i];
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const o = i * 4; out[o] = rd(i * ch); out[o + 1] = rd(i * ch + 1); out[o + 2] = rd(i * ch + 2); out[o + 3] = 1; }
  return { w: im.width, h: im.height, data: out, flipY: !!tex.flipY };
};
async function lkLoadHdri(name) {
  if (name === 'user' && L.userHdri) { L.hdriRaw = L.userHdri.raw; L.hdriName = L.userHdri.name; }
  else {
    const ld = new THREE.EXRLoader(); ld.setDataType(THREE.FloatType);
    const tex = await ld.loadAsync(`edition/hdri/${name}.exr`);
    L.hdriRaw = lkF32(tex); tex.dispose();
    L.hdriName = (LK_HDRIS.find(h => h[0] === name) || [name, name])[1];
  }
  lkEnvBuild();
}
const lkM3 = (M, d, o, i) => { const r = d[i], g = d[i + 1], b = d[i + 2]; o[i] = M[0] * r + M[1] * g + M[2] * b; o[i + 1] = M[3] * r + M[4] * g + M[5] * b; o[i + 2] = M[6] * r + M[7] * g + M[8] * b; o[i + 3] = 1; };
const lkTex = (w, h, data, flipY) => {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace; t.flipY = !!flipY;
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
};
// the sun of the physical sky, in the frame of the environment (Rotation and the turntable turn it with the sky)
const lkSunDir = () => sunWorldDir(lk.sunAz, lk.sunEl, 0);
// the environment in linear Rec.709: { w, h, data, flipY }
function lkEnvData() {
  if (lk.env === 'colors') {
    const w = 64, h = 32, d = new Float32Array(w * h * 4), c3 = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => r3SrgbToLin(v / 255)); };
    const top = c3(lk.skyCol), bot = c3(lk.gndCol), k = lk.skyInt;
    for (let y = 0; y < h; y++) {
      const s = Math.sin(((y + 0.5) / h - 0.5) * Math.PI), t = Math.max(0, Math.min(1, (s + 0.04) / 0.12)), f = t * t * (3 - 2 * t); // row 0 below
      for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; for (let c = 0; c < 3; c++) d[o + c] = k * (bot[c] + (top[c] - bot[c]) * f); d[o + 3] = 1; }
    }
    return { w, h, data: d, flipY: false };
  }
  if (lk.env === 'phys') {
    const w = 256, h = 128, dir = lkSunDir(), el = lk.sunEl;
    const sunE = el > -1 ? lk.sunInt * Math.PI * Math.min(1, (el + 1) / 4) * Math.max(0, Math.sin(el * Math.PI / 180)) : 0;
    return { w, h, data: skyBake(w, h, dir, { turbidity: lk.skyT, albedo: lk.skyAlb, k: SKY_K * lk.skyInt / 0.6, sunE }), flipY: false };
  }
  const r = L.hdriRaw; if (!r) return null;
  if (lk.cs !== 'acescg') return r;
  const out = new Float32Array(r.data.length); for (let i = 0; i < out.length; i += 4) lkM3(R3_AP1_TO_709, r.data, out, i);
  return { w: r.w, h: r.h, data: out, flipY: r.flipY };
}
function lkEnvBuild() {
  const d = lkEnvData(); if (!d) return;
  if (L.hdriTex) L.hdriTex.dispose(); if (L.hdriWs) L.hdriWs.dispose(); if (L.envMap) L.envMap.dispose();
  const ws = new Float32Array(d.data.length); for (let i = 0; i < ws.length; i += 4) lkM3(R3_709_TO_AP1, d.data, ws, i);
  L.hdriTex = lkTex(d.w, d.h, d.data, d.flipY); L.hdriWs = lkTex(d.w, d.h, ws, d.flipY);
  if (!L.pmrem) L.pmrem = new THREE.PMREMGenerator(renderer);
  L.envMap = L.pmrem.fromEquirectangular(L.hdriWs).texture;
  L.envName = lk.env === 'colors' ? 'Sky colors' : lk.env === 'phys' ? 'Physical sky' : L.hdriName;
  lkEnv(); if (lk.engine === 'pt' && L.ptBuilt && L.tracer) { L.tracer.updateEnvironment(); L.tracer.updateLights(); } lkDirty();
}
// the light of the turntable: the HDRI rotation plus the orbit of the rig (and the light pass)
function lkAngles(f = L.frame) {
  const s = lk.dir === 'cw' ? -1 : 1;
  const orbit = f <= LK_OBJ ? s * 360 * (f - 1) / LK_OBJ : 0;
  const light = f > LK_OBJ ? s * 360 * (f - 1 - LK_OBJ) / LK_LIGHT : 0;
  return { orbit, light: orbit + light };
}
function lkEnv() {
  const a = lkAngles(), ry = (lk.rot + a.light) * Math.PI / 180;
  const pt = lk.engine === 'pt';
  scene.environment = pt ? L.hdriTex : L.envMap;
  scene.environmentRotation.set(0, ry, 0); scene.backgroundRotation.set(0, ry, 0);
  // the background color: a screen color, to linear Rec.709 (Path trace) or ACEScg (Raster)
  scene.background = lk.show ? (pt ? L.hdriTex : lk.blur > 0 ? L.envMap : L.hdriWs) : pt ? lin(lk.bg) : new THREE.Color(...r3HexToWs(lk.bg));
  scene.backgroundBlurriness = pt ? 0 : lk.blur;
  // the intensity of an HDRI (the skies have theirs baked in): on the light and on the background
  scene.environmentIntensity = scene.backgroundIntensity = lk.env === 'hdri' ? lk.int : 1;
  $('lkd-light-st').textContent = L.envName || '';
  lkSunUpdate(ry); lkLightsUpdate();
}

// ---------- the sun of the physical sky and the 3D lights ----------
// A light is kept by where it is around the model (direction and height, in the frame of the turntable light, like the
// HDRI: it turns with it) and its distance; its intensity is how much it lights the centre of the model, whatever its
// distance and size (π × intensity of irradiance there: 1 lights a white surface like a white sky of intensity 1).
// Raster takes the colors in ACEScg, the path tracer in linear Rec.709.
const lkHex709 = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => r3SrgbToLin(v / 255)); };
const lkLightColor = (obj, hex) => { const c = lkHex709(hex), v = lk.engine === 'pt' ? c : r3M3(R3_709_TO_AP1, c); obj.color.setRGB(v[0], v[1], v[2]); };
const lkYRot = (v, a) => new THREE.Vector3(v[0], v[1], v[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
function lkShadowOf(obj) {
  obj.castShadow = true; obj.shadow.mapSize.set(2048, 2048); obj.shadow.bias = -0.0004; obj.shadow.normalBias = 0.01 * L.r;
  if (obj.isDirectionalLight) { const c = obj.shadow.camera, R = L.r * 1.6; c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 0.01; c.far = L.r * 8; c.updateProjectionMatrix(); }
  else { obj.shadow.camera.near = Math.max(0.01, L.r * 0.05); obj.shadow.camera.far = L.r * 50; obj.shadow.camera.updateProjectionMatrix(); }
}
function lkSunUpdate(ry) {
  const on = lk.env === 'phys' && lk.sunEl > -2 && lk.sunInt > 0;
  if (!on) { if (L.sun) { scene.remove(L.sun, L.sun.target); L.sun.dispose(); L.sun = null; lkShadowCatch(); } return; }
  if (!L.sun) { L.sun = new THREE.DirectionalLight(0xffffff, 1); L.sun.name = 'sun'; scene.add(L.sun, L.sun.target); }
  const d = lkYRot(lkSunDir(), ry), D = L.r * 4;
  L.sun.position.copy(L.c).addScaledVector(d, D); L.sun.target.position.copy(L.c); L.sun.target.updateMatrixWorld();
  L.sun.intensity = lk.sunInt * Math.PI * Math.min(1, (lk.sunEl + 2) / 4);
  lkLightColor(L.sun, '#fff4e5'); lkShadowOf(L.sun); L.sun.shadow.camera.far = D + L.r * 4;
  lkShadowCatch();
}
const LK_LDEF = { type: 'area', col: '#ffffff', int: 1, ev: 0, az: 45, el: 35, d: 2.5, size: 0.5, ang: 40, pen: 0.3, sh: true };
const lkLName = (t) => ({ area: 'Area', spot: 'Spot', point: 'Point', dir: 'Directional' })[t] || t;
async function lkAreaInit() {
  if (L.areaOk) return;
  const { RectAreaLightUniformsLib } = await import('./vendor/RectAreaLightUniformsLib.js') /* edition/vendor/ */;
  RectAreaLightUniformsLib.init(); L.areaOk = true;
}
function lkLightMake(li) {
  let o;
  if (li.type === 'area') { o = new THREE.RectAreaLight(0xffffff, 1, 1, 1); }
  else if (li.type === 'spot') { o = new THREE.SpotLight(0xffffff, 1); o.decay = 2; o.distance = 0; }
  else if (li.type === 'point') { o = new THREE.PointLight(0xffffff, 1); o.decay = 2; o.distance = 0; }
  else o = new THREE.DirectionalLight(0xffffff, 1);
  o.name = 'lkd-light'; scene.add(o); if (o.target) scene.add(o.target);
  return o;
}
async function lkLightsBuild() {
  if (lk.lights.some(li => li.type === 'area')) { try { await lkAreaInit(); } catch (e) { console.error(e); } }
  for (const x of L.lights) { scene.remove(x.obj); if (x.obj.target) scene.remove(x.obj.target); x.obj.dispose && x.obj.dispose(); }
  L.lights = lk.lights.map(li => ({ li, obj: lkLightMake(li) }));
  if (L.lsel >= L.lights.length) L.lsel = L.lights.length - 1;
  lkLightsUpdate(); lkLightsUI();
  lkPtRebuild(); lkDirty();
}
// where each light is on this frame, its intensity and color
function lkLightsUpdate() {
  if (!L.lights.length) { lkShadowCatch(); return; }
  const a = lkAngles(), turn = a.light * Math.PI / 180, D0 = Math.max(L.r, 0.01);
  for (const { li, obj } of L.lights) {
    const az = li.az * Math.PI / 180 + turn, el = li.el * Math.PI / 180, D = li.type === 'dir' ? D0 * 6 : Math.max(0.01, li.d * D0);
    obj.position.set(L.c.x + D * Math.cos(el) * Math.sin(az), L.c.y + D * Math.sin(el), L.c.z + D * Math.cos(el) * Math.cos(az));
    const k = Math.PI * Math.max(0, li.int) * Math.pow(2, li.ev || 0), sz = Math.max(0.001, li.size);
    if (obj.isRectAreaLight) { obj.width = obj.height = sz; obj.intensity = k * D * D / (sz * sz); obj.lookAt(L.c); }
    else if (obj.isDirectionalLight) obj.intensity = k;
    else { obj.intensity = k * D * D; obj.radius = sz / 2; }
    if (obj.isSpotLight) { obj.angle = Math.min(85, Math.max(0.5, li.ang / 2)) * Math.PI / 180; obj.penumbra = Math.min(1, Math.max(0, li.pen)); }
    // the path tracer puts the disk of a spot at its apex minus radius / tan(cone): back by that, the light lands the same
    if (obj.isSpotLight && lk.engine === 'pt' && obj.radius > 0) { const back = obj.radius / Math.max(Math.tan(obj.angle), 1e-3), dir = obj.position.clone().sub(L.c).normalize(); obj.position.addScaledVector(dir, back); }
    if (obj.target) { obj.target.position.copy(L.c); obj.target.updateMatrixWorld(); }
    lkLightColor(obj, li.col);
    if (!obj.isRectAreaLight) { if (li.sh) lkShadowOf(obj); else obj.castShadow = false; }
    obj.updateMatrixWorld(true);
  }
  lkShadowCatch();
}
// Raster: the shadows of the lights (and of the sun) on an invisible floor, over the contact shadow
function lkShadowCatch() {
  const any = (L.sun && L.sun.castShadow) || L.lights.some(x => x.obj.castShadow);
  renderer.shadowMap.enabled = !!any; renderer.shadowMap.type = THREE.PCFShadowMap;
  if (L.model) L.model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = !!any; } });
  if (any && !L.lshadow && L.model) {
    L.lshadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.55, depthWrite: false }));
    L.lshadow.rotation.x = -Math.PI / 2; L.lshadow.receiveShadow = true; L.lshadow.renderOrder = -1; L.lshadow.name = 'lkd-lshadow'; scene.add(L.lshadow);
  }
  if (L.lshadow) {
    L.lshadow.scale.setScalar(L.r * 30); L.lshadow.position.set(L.c.x, 0.001 * L.r, L.c.z);
    L.lshadow.visible = !!any && lk.shadow && lk.engine !== 'pt' && !!L.model;
  }
}
function lkLightAdd(type, at) {
  const li = Object.assign(lkClone(LK_LDEF), { type }, at || {});
  if (type === 'dir') li.int = 1;
  lk.lights.push(li); L.lsel = lk.lights.length - 1; lkSave(); return lkLightsBuild();
}
function lkLightsUI() {
  const n = lk.lights.length;
  $('lkd-lights-st').textContent = n ? `${n} light${n > 1 ? 's' : ''}` : 'none';
  $('lkd-llist').innerHTML = lk.lights.map((li, i) => `<div class="lkd-li${i === L.lsel ? ' on' : ''}" data-i="${i}"><i style="background:${li.col}"></i><b>${i + 1} · ${lkLName(li.type)}</b><span class="note">${(+li.int).toFixed(2)}${li.ev ? ` ${li.ev > 0 ? '+' : ''}${(+li.ev).toFixed(1)} EV` : ''} · ${Math.round(li.az)}° / ${Math.round(li.el)}°</span><button class="btn sm ghost" data-ldel="${i}" title="Remove this light" aria-label="Remove light ${i + 1}">×</button></div>`).join('');
  const li = lk.lights[L.lsel]; $('lkd-lprops').hidden = !li;
  if (!li) return;
  const set = (id, v) => { const el = $(id); if (document.activeElement !== el && !(el.parentNode && el.parentNode.classList.contains('scrubbing'))) el.value = v; };
  set('lkd-l-type', li.type); $('lkd-l-col').value = li.col; set('lkd-l-int', li.int); set('lkd-l-ev', li.ev); set('lkd-l-az', Math.round(li.az * 10) / 10); set('lkd-l-el', Math.round(li.el * 10) / 10);
  set('lkd-l-dist', +(li.d * L.r).toFixed(3)); set('lkd-l-size', li.size); set('lkd-l-ang', li.ang); set('lkd-l-pen', li.pen); $('lkd-l-sh').checked = !!li.sh;
  $('lkd-l-dist-r').hidden = li.type === 'dir'; $('lkd-l-size-r').hidden = li.type === 'dir';
  $('lkd-l-ang-r').hidden = $('lkd-l-pen-r').hidden = li.type !== 'spot'; $('lkd-l-sh-r').hidden = li.type === 'area';
}
// a light changed: move it (and the path tracer's copy) without making it again
function lkLightsMoved() {
  lkLightsUpdate(); lkSave(); lkLightsUI();
  if (lk.engine === 'pt' && L.ptBuilt && L.tracer) { L.tracer.updateLights(); lkGo(); } else lkDirty();
}
// the Light tool: the selected light goes where its highlight lands on the clicked point (the view reflected on the surface)
function lkLightAt(cx, cy, add) {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height * 2 - 1)), cam);
  const h = L.model ? ray.intersectObject(L.model, true).find(x => x.object.isMesh && x.face) : null;
  if (!h) return false;
  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize(), v = ray.ray.direction.clone();
  if (n.dot(v) > 0) n.negate();
  const refl = v.clone().sub(n.clone().multiplyScalar(2 * v.dot(n))).normalize();
  if ((add || !lk.lights.length) && !L.lightAdding) { L.lightAdding = true; lkLightAdd('area').then(() => { L.lightAdding = false; lkLightAt(cx, cy, false); }); return true; }
  const li = lk.lights[L.lsel]; if (!li) return true;
  let dir;
  if (li.type === 'dir') dir = refl;
  else { const D = Math.max(0.01, li.d * L.r), pos = h.point.clone().addScaledVector(refl, D); dir = pos.sub(L.c); li.d = Math.max(0.05, dir.length() / L.r); dir.normalize(); }
  const turn = lkAngles().light;
  li.el = Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180 / Math.PI;
  li.az = ((Math.atan2(dir.x, dir.z) * 180 / Math.PI - turn) % 360 + 540) % 360 - 180;
  lkLightsMoved();
  return true;
}
// the lights on the view while the Light tool is on: where each one is (the selected one, with a line to the model)
function lkLightsOverlay(w, h) {
  if (L.tool !== 'light' || !L.lights.length) return '';
  let s = '';
  const c = L.c.clone().project(cam), cc = [(c.x + 1) / 2 * w, (1 - c.y) / 2 * h];
  L.lights.forEach(({ obj }, i) => {
    const v = obj.position.clone().project(cam); if (v.z > 1 || v.z < -1) return;
    const p = [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
    if (i === L.lsel) s += `<line class="lkl" x1="${p[0]}" y1="${p[1]}" x2="${cc[0]}" y2="${cc[1]}"/>`;
    s += `<g class="lkl${i === L.lsel ? ' on' : ''}" data-li="${i}"><circle cx="${p[0]}" cy="${p[1]}" r="9"/><text x="${p[0]}" y="${p[1] + 4}">${i + 1}</text></g>`;
  });
  return s;
}

// ---------- model ----------
const lkBase = (p) => String(p).split(/[\\/]/).pop().trim().toLowerCase();
const lkStem = (p) => lkBase(p).replace(/\.[^.]+$/, '');
const lkIsImg = (f) => !/\.(exr|hdr)$/i.test(f.name) && (f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif|tga)$/i.test(f.name));
// the dropped files by name: a texture or a .bin asked by the model with a path of another machine is found by its name
function lkManager(files, name) {
  const urls = new Map(), used = new Set(), missing = new Set();
  const urlOf = (f) => { if (!urls.has(f)) urls.set(f, URL.createObjectURL(f)); return urls.get(f); };
  const imgs = files.filter(lkIsImg), others = files.filter(f => !lkIsImg(f));
  const m = new THREE.LoadingManager();
  m.setURLModifier(url => {
    if (/^(blob|data):/.test(url)) return url;
    const u = decodeURIComponent(url), b = lkBase(u);
    let f = files.find(x => lkBase(x.name) === b) || others.find(x => lkStem(x.name) === lkStem(u)) || imgs.find(x => lkStem(x.name) === lkStem(u));
    if (!f && imgs.length === 1 && lkIsImg({ name: u, type: '' })) f = imgs[0];
    if (!f && lkIsImg({ name: u, type: '' })) f = imgs.find(x => lkStem(x.name) === lkStem(name));
    if (f) { used.add(f.name); return urlOf(f); }
    missing.add(b);
    return lkIsImg({ name: u, type: '' }) ? 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' : url;
  });
  return { m, used, missing, urls };
}
// a ZIP (a download of Sketchfab, a model with its textures): its files, as if they were dropped
async function lkUnzip(files) {
  const out = [];
  for (const f of files) {
    if (!/\.zip$/i.test(f.name)) { out.push(f); continue; }
    try {
      const z = fflate.unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [path, bytes] of Object.entries(z)) {
        if (path.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(path) || !bytes.length) continue;
        const nf = new File([bytes], path.split('/').pop(), { type: lkIsImg({ name: path, type: '' }) ? 'image/' + path.split('.').pop().toLowerCase().replace('jpg', 'jpeg') : '' });
        nf.lkPath = path; nf.lkFrom = f.name.replace(/\.zip$/i, ''); out.push(nf);
      }
    } catch (e) { console.error(e); toast('Could not open ' + f.name + ': ' + (e.message || e), true); }
  }
  return out;
}
// a dropped folder: all the files inside it (and its subfolders, like textures/)
async function lkDropFiles(dt) {
  const entries = [...(dt.items || [])].map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (!entries.some(en => en.isDirectory)) return [...dt.files];
  const out = [];
  const walk = async (en, path) => {
    if (en.isFile) { const f = await new Promise((res, rej) => en.file(res, rej)); f.lkPath = path + f.name; out.push(f); return; }
    const rd = en.createReader();
    for (;;) { const batch = await new Promise((res, rej) => rd.readEntries(res, rej)); if (!batch.length) break; for (const c of batch) await walk(c, path + en.name + '/'); }
  };
  for (const en of entries) await walk(en, '');
  return out;
}
// the main file when there are several models (a ZIP of Sketchfab can bring the glTF and the original): glTF first
const LK_ORDER = ['glb', 'gltf', 'usdz', 'usdc', 'usda', 'usd', 'fbx', 'obj', 'ply'];
async function lkLoadFiles(files) {
  files = await lkUnzip([...files]);
  const main = files.filter(f => LK_MODEL_RE.test(f.name)).sort((a, b) => LK_ORDER.indexOf(a.name.split('.').pop().toLowerCase()) - LK_ORDER.indexOf(b.name.split('.').pop().toLowerCase()))[0];
  if (!main) {
    const img = files.find(lkIsImg);
    if (img && L.model) { lkApplyImage(img); return; }
    toast(files.some(f => /\.mtl$/i.test(f.name)) ? 'A .mtl needs its OBJ: drop them together' : 'No 3D model in those files', true); return;
  }
  const ext = main.name.split('.').pop().toLowerCase();
  lkBusy('Loading ' + main.name + '…');
  await new Promise(r => setTimeout(r, 30));
  const mg = lkManager(files, main.name);
  let obj = null, srgbColors = false;
  try {
    if (ext === 'glb' || ext === 'gltf') {
      const gl = new THREE.GLTFLoader(mg.m);
      const draco = new THREE.DRACOLoader(); draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/'); gl.setDRACOLoader(draco);
      if (window.MeshoptDecoder) gl.setMeshoptDecoder(window.MeshoptDecoder);
      const buf = await main.arrayBuffer();
      obj = await new Promise((res, rej) => gl.parse(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, '', g => res(g.scene), rej));
    } else if (ext === 'obj') {
      const text = await main.text(), want = (text.match(/^\s*mtllib\s+(.+?)\s*$/m) || [])[1];
      const mtls = files.filter(f => /\.mtl$/i.test(f.name)), mtl = mtls.find(f => want && lkBase(f.name) === lkBase(want)) || mtls[0];
      const ol = new THREE.OBJLoader();
      if (mtl) {
        const { MTLLoader } = await import('./vendor/MTLLoader.js') /* relative to this script: edition/vendor/ */;
        const mats = new MTLLoader(mg.m).parse(await mtl.text(), ''); mats.preload(); ol.setMaterials(mats);
      }
      obj = ol.parse(text); srgbColors = true;
    } else if (/^usd[zca]?$/.test(ext)) {
      const { USDLoader } = await import('./vendor/USDLoader.js') /* relative to this script: edition/vendor/ */;
      const buf = await main.arrayBuffer();
      obj = await new Promise((res, rej) => { try { const g = new USDLoader(mg.m).parse(ext === 'usda' ? new TextDecoder().decode(buf) : buf, '', res, rej); if (g && !g.then) res(g); } catch (e) { rej(e); } });
    } else if (ext === 'fbx') {
      obj = new THREE.FBXLoader(mg.m).parse(await main.arrayBuffer(), ''); srgbColors = true;
    } else if (ext === 'ply') {
      const g = new THREE.PLYLoader().parse(await main.arrayBuffer());
      if (!g.index && !g.attributes.normal && g.attributes.position.count && !g.getIndex()) { /* points */ }
      if (!g.attributes.normal) g.computeVertexNormals();
      obj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: !!g.attributes.color, roughness: 0.6 }));
    }
  } catch (e) {
    console.error(e); lkBusy(''); toast('Could not read ' + main.name + ': ' + (e.message || e), true); return;
  }
  // textures that come after the model: draw again when they are in
  mg.m.onLoad = () => { lkDirty(); lkPtRebuild(); };
  const imgs = files.filter(lkIsImg);
  // the name of the asset (burn-in, playblast): the one of the ZIP or the folder, not scene.gltf
  const from = main.lkFrom || (main.lkPath && main.lkPath.includes('/') ? main.lkPath.split('/')[0] : '');
  lkSetModel(obj, from ? `${from}.${ext}` : main.name, srgbColors);
  const missing = [...mg.missing].filter(x => lkIsImg({ name: x, type: '' }));
  let note = '';
  if (mg.used.size) note = 'Textures: ' + [...mg.used].filter(n => lkIsImg({ name: n, type: '' })).join(', ');
  if (missing.length) note += (note ? ' · ' : '') + 'not found: ' + missing.join(', ') + ' (drop it with the model)';
  // a model without materials of its own and an image: the image goes on it
  if (!mg.used.size && imgs.length && !(ext === 'glb')) { lkApplyImage(imgs[0]); note = 'Texture: ' + imgs[0].name; }
  $('lkd-model-msg').hidden = !note; $('lkd-model-msg').textContent = note; $('lkd-model-msg').classList.toggle('bad', !!missing.length);
  lkBusy('');
}
// display materials of other programs to physical ones (the HDRI lights them); colors written as screen values pass
// to linear (the app keeps the hex colors as they are)
function lkPbr(m, srgb) {
  if (!m) return new THREE.MeshStandardMaterial({ color: 0xbfbfbf });
  if (m.isMeshStandardMaterial) return m;
  const o = new THREE.MeshStandardMaterial();
  if (m.color) { o.color.copy(m.color); if (srgb) o.color.convertSRGBToLinear(); }
  for (const k of ['map', 'normalMap', 'alphaMap', 'aoMap', 'emissiveMap', 'bumpMap']) if (m[k]) o[k] = m[k];
  if (o.map) o.map.colorSpace = THREE.SRGBColorSpace;
  if (o.emissiveMap) o.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  if (m.emissive) { o.emissive.copy(m.emissive); if (srgb) o.emissive.convertSRGBToLinear(); }
  if (m.bumpScale != null) o.bumpScale = m.bumpScale;
  o.roughness = m.isMeshPhongMaterial ? Math.max(0.15, Math.min(1, Math.sqrt(2 / ((m.shininess || 30) + 2)) * 1.6)) : 0.8;
  o.metalness = 0; o.side = m.side; o.vertexColors = !!m.vertexColors;
  o.transparent = !!m.transparent && (m.opacity ?? 1) < 1; o.opacity = m.opacity ?? 1;
  o.name = m.name || '';
  return o;
}
function lkSetModel(obj, name, srgb) {
  lkClearModel();
  let tris = 0, meshes = 0;
  obj.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    o.material = Array.isArray(o.material) ? o.material.map(m => lkWs(lkPbr(m, srgb))) : lkWs(lkPbr(o.material, srgb));
    o.userData.lkMat = o.material;
    const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  if (!meshes) { toast('No meshes in ' + name + ' (a point cloud): load a mesh', true); return; }
  L.model = obj; L.modelName = name; L.tris = tris;
  // pivot (orientation and units) inside root (on the ground, centred)
  L.pivot = new THREE.Group(); L.pivot.add(obj);
  L.root = new THREE.Group(); L.root.add(L.pivot); scene.add(L.root);
  L.ext = name.split('.').pop().toLowerCase();
  $('lkd-model-n').textContent = name; $('lkd-model-st').textContent = `${Math.round(tris).toLocaleString('en-US')} tris`;
  $('lkd-empty').hidden = true; $('lkd-remove').disabled = false; $('lkd-remove2').hidden = false; $('lkd-pb').disabled = $('lkd-pb2').disabled = $('lkd-still').disabled = $('lkd-still2').disabled = false;
  lkClay(); lkPlace(true); lkHint();
  lkPtRebuild();
}
function lkClearModel() {
  if (L.root) { scene.remove(L.root); L.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); }
  L.model = L.root = L.pivot = null; L.tris = 0; L.mA = L.mB = null;
  if (L.shadowR) { scene.remove(L.shadowR); L.shadowR.geometry.dispose(); L.shadowR.material.map && L.shadowR.material.map.dispose(); L.shadowR = null; }
  if (L.shadowPT) { scene.remove(L.shadowPT); L.shadowPT = null; }
  $('lkd-empty').hidden = false; $('lkd-remove').disabled = true; $('lkd-remove2').hidden = true; $('lkd-pb').disabled = $('lkd-pb2').disabled = $('lkd-still').disabled = $('lkd-still2').disabled = true;
  $('lkd-model-n').textContent = 'none'; $('lkd-model-st').textContent = 'none'; $('lkd-dims').textContent = '–'; $('lkd-model-msg').hidden = true;
  L.ptBuilt = false; L.ptStale = false; lkShadowCatch(); lkGpuUI(); lkDirty();
}
function lkApplyImage(file) {
  new THREE.TextureLoader().load(URL.createObjectURL(file), tex => {
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = L.ext !== 'glb' && L.ext !== 'gltf';
    const m = lkWs(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
    L.model.traverse(o => { if (o.isMesh) { o.material = o.userData.lkMat = m; } });
    lkClay(); lkDirty(); lkPtRebuild();
  });
}
// orientation: the up axis of the file (glTF is always Y up; Max and some OBJ / FBX are Z up), the units, on the
// ground and centred, and the framing of the camera
function lkUpAuto() {
  if (L.ext === 'glb' || L.ext === 'gltf' || L.ext === 'fbx' || /^usd/.test(L.ext)) return 'y'; // USD: the loader turns a Z up stage to Y up // glTF is Y up; the FBX loader turns Z up files to Y up
  // OBJ / PLY: a model much taller in Z than in Y, and flat in Y, comes from a Z up program
  const b = new THREE.Box3().setFromObject(L.model), s = b.getSize(new THREE.Vector3());
  return s.z > s.y * 1.3 && s.y < Math.max(s.x, s.z) * 0.9 && Math.abs(b.min.z) < s.z * 0.15 ? 'z' : 'y';
}
function lkPlace(reframe) {
  if (!L.model) return;
  const up = lk.up === 'auto' ? lkUpAuto() : lk.up, p = L.pivot;
  p.rotation.set(0, 0, 0); p.scale.setScalar(1); p.position.set(0, 0, 0);
  if (up === 'z') p.rotation.x = -Math.PI / 2; else if (up === '-z') p.rotation.x = Math.PI / 2; else if (up === 'x') p.rotation.z = Math.PI / 2;
  L.pivot.rotation.order = 'YXZ'; L.root.rotation.set(0, (+lk.yaw || 0) * Math.PI / 180, 0);
  L.root.position.set(0, 0, 0); L.root.updateMatrixWorld(true);
  // units: auto by the size (a car of 450 is in cm, of 4500 in mm)
  let k = +lk.units;
  if (!(k > 0)) { const s0 = new THREE.Box3().setFromObject(L.root).getSize(new THREE.Vector3()), m = Math.max(s0.x, s0.y, s0.z); k = m > 2000 ? 0.001 : m > 50 ? 0.01 : 1; }
  L.fileUnit = k; p.scale.setScalar(k); L.root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(L.root), c = b.getCenter(new THREE.Vector3());
  L.root.position.set(-c.x, -b.min.y, -c.z); L.root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(L.root), s = bb.getSize(new THREE.Vector3());
  L.c.copy(bb.getCenter(new THREE.Vector3())); L.r = Math.max(s.length() / 2, 0.01); L.size = s;
  // the offset: the model moves off the centre of the turntable; the camera keeps looking at the centre (L.c)
  L.off = new THREE.Vector3(+lk.offX || 0, +lk.offY || 0, +lk.offZ || 0);
  L.root.position.add(L.off); L.root.updateMatrixWorld(true);
  L.mc = L.c.clone().add(L.off); // the centre of the model itself (its shadow)
  $('lkd-dims').textContent = `${s.x.toFixed(3)} × ${s.y.toFixed(3)} × ${s.z.toFixed(3)} m` + (lk.up === 'auto' ? ` · ${up.toUpperCase()} up` : '') + (+lk.units > 0 ? '' : ` · ${({ 1: 'm', 0.01: 'cm', 0.001: 'mm' })[k] || k}`);
  lkShadow(); lkRefs();
  if (reframe) { L.free = false; lkBackUI(); }
  lkCam(); lkDirty();
  if (L.ptBuilt) lkPtRebuild();
}
function lkClay() {
  if (!L.model) return;
  if (!L.clayMat) L.clayMat = lkWs(new THREE.MeshStandardMaterial({ color: lin('#8c8c8c'), roughness: 0.65, metalness: 0 }));
  L.model.traverse(o => { if (o.isMesh) o.material = lk.clay ? L.clayMat : o.userData.lkMat; });
}

// ---------- camera: the turntable rig ----------
function lkRigCam(f = L.frame, c = cam) {
  const a = lkAngles(f), vf = lkVfov() * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * LK_ASPECT);
  // the model fills `fill` of the narrow side of the frame: its sphere at that distance
  const d = L.r / Math.tan(Math.min(vf, hf) / 2) / Math.max(0.3, lk.fill);
  const e = lk.elev * Math.PI / 180, th = a.orbit * Math.PI / 180;
  c.fov = lkVfov(); c.aspect = LK_ASPECT; c.near = Math.max(d / 500, 0.001); c.far = d * 200;
  c.position.set(L.c.x + d * Math.cos(e) * Math.sin(th), L.c.y + d * Math.sin(e), L.c.z + d * Math.cos(e) * Math.cos(th));
  c.up.set(0, 1, 0); c.lookAt(L.c); c.updateProjectionMatrix(); c.updateMatrixWorld(true);
  return d;
}
function lkCam() {
  if (!L.model) return;
  if (!L.free) lkRigCam();
  else { cam.fov = lkVfov(); cam.updateProjectionMatrix(); }
  lkRefsPlace(); lkEnv();
}
// ---------- references: chrome ball, 18% grey ball, ColorChecker (children of the camera, fixed on screen) ----------
function lkRefs() {
  if (L.refs) { cam.remove(L.refs); L.refs.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); }
  const g = new THREE.Group(); g.name = 'refs';
  const sph = new THREE.SphereGeometry(0.5, 64, 32);
  const chrome = new THREE.Mesh(sph, lkWs(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0 }))); chrome.name = 'chrome';
  const grey = new THREE.Mesh(sph.clone(), lkWs(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.18, 0.18, 0.18), metalness: 0, roughness: 0.85 }))); grey.name = 'grey';
  // the chart: self-lit patches with their sRGB values (what the colors should read, whatever the light)
  const chart = new THREE.Group(); chart.name = 'chart';
  const patch = (c) => lkWs(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 1, roughness: 1, metalness: 0 }));
  const pw = 1, gap = 0.12, back = new THREE.Mesh(new THREE.PlaneGeometry(6 * pw + 7 * gap, 4 * pw + 5 * gap), patch(new THREE.Color(0.012, 0.012, 0.012)));
  chart.add(back);
  LK_CHART.forEach(([r, gg, b], i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw), patch(new THREE.Color(r / 255, gg / 255, b / 255).convertSRGBToLinear()));
    m.position.set((i % 6 - 2.5) * (pw + gap), (1.5 - Math.floor(i / 6)) * (pw + gap), 0.001); chart.add(m);
  });
  g.add(chrome, grey, chart);
  L.refs = g; cam.add(g);
  lkRefsPlace();
}
function lkRefsPlace() {
  if (!L.refs) return;
  const D = Math.max(cam.near * 4, 0.05) * 8; // close to the lens, in front of the model
  const hh = D * Math.tan(cam.fov * Math.PI / 360), hw = hh * LK_ASPECT, u = hh * 2; // frame height at D
  const ball = u * 0.11, m = u * 0.035, lift = lkBurnBottom() * u; // above the lower bar of the burn-in
  const [chrome, grey, chart] = L.refs.children;
  chrome.scale.setScalar(ball); grey.scale.setScalar(ball);
  chart.scale.setScalar(u * 0.032);
  const cw = (6 + 7 * 0.12) * u * 0.032, ch = (4 + 5 * 0.12) * u * 0.032;
  chart.position.set(hw - m - cw / 2, -hh + lift + m + ch / 2, -D);
  grey.position.set(hw - m - cw - m - ball / 2, -hh + lift + m + ball / 2, -D);
  chrome.position.set(hw - m - cw - m - ball - m * 0.6 - ball / 2, -hh + lift + m + ball / 2, -D);
  chrome.visible = lk.chrome && L.refsOn !== false; grey.visible = lk.grey && L.refsOn !== false; chart.visible = lk.chart && L.refsOn !== false;
  L.refs.updateMatrixWorld(true);
}
// ---------- shadow catcher ----------
// Raster: a contact shadow, the silhouette of the model seen from above, blurred, on a plane at the ground.
// Path trace: an 18% grey floor with the real shadows of the HDRI.
function lkShadow() {
  if (L.shadowR) { scene.remove(L.shadowR); L.shadowR.material.map && L.shadowR.material.map.dispose(); L.shadowR = null; }
  if (L.shadowPT) { scene.remove(L.shadowPT); L.shadowPT = null; }
  if (!L.model) return;
  const s = L.size, R = Math.max(s.x, s.z) * 0.75 + L.r * 0.3, N = 256;
  const oc = new THREE.OrthographicCamera(-R, R, R, -R, 0.001, s.y * 4 + 1 + Math.abs(+lk.offY || 0));
  const mc = L.mc || L.c, y0 = mc.y - s.y / 2; // the ground under the model (with Offset Y, it floats over its shadow)
  oc.position.set(mc.x, y0 + s.y * 2 + 0.5, mc.z); oc.up.set(0, 0, -1); oc.lookAt(mc.x, y0, mc.z);
  const rt = new THREE.WebGLRenderTarget(N, N);
  const keep = { bg: scene.background, env: scene.environment, ov: scene.overrideMaterial, refs: L.refs && L.refs.visible };
  scene.background = new THREE.Color(1, 1, 1); scene.environment = null; scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
  if (L.refs) L.refs.visible = false;
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, oc); renderer.setRenderTarget(null);
  scene.background = keep.bg; scene.environment = keep.env; scene.overrideMaterial.dispose(); scene.overrideMaterial = keep.ov; if (L.refs) L.refs.visible = keep.refs;
  const px = new Uint8Array(N * N * 4); renderer.readRenderTargetPixels(rt, 0, 0, N, N, px); rt.dispose();
  const c0 = document.createElement('canvas'); c0.width = c0.height = N; const x0 = c0.getContext('2d'), id = x0.createImageData(N, N);
  for (let i = 0; i < N * N; i++) { const v = 255 - px[i * 4]; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 0; id.data[i * 4 + 3] = v; }
  x0.putImageData(id, 0, 0);
  const c1 = document.createElement('canvas'); c1.width = c1.height = N; const x1 = c1.getContext('2d');
  x1.filter = `blur(${Math.round(N * 0.025)}px)`; x1.globalAlpha = 0.75; x1.drawImage(c0, 0, 0);
  x1.filter = `blur(${Math.round(N * 0.008)}px)`; x1.globalAlpha = 0.5; x1.drawImage(c0, 0, 0);
  const tex = new THREE.CanvasTexture(c1); tex.flipY = true;
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  pl.rotation.x = -Math.PI / 2; pl.position.set(mc.x, 0.0005 * L.r, mc.z); pl.renderOrder = -1;
  L.shadowR = pl; scene.add(pl);
  // Path trace: its "matte" material only cuts the object out, it takes no shadows; so the catcher there is a floor
  // of 18% grey that takes the real shadows (and bounces a little light, like a studio floor)
  const big = L.r * 60;
  const pt = new THREE.Mesh(new THREE.PlaneGeometry(big, big), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.18, 0.18, 0.18), roughness: 0.9, metalness: 0 }));
  pt.rotation.x = -Math.PI / 2; pt.position.set(L.c.x, 0, L.c.z);
  L.shadowPT = pt;
  lkShadowVis();
}
function lkShadowVis() {
  if (L.shadowR) L.shadowR.visible = lk.shadow && lk.engine !== 'pt';
  if (L.shadowPT) { const on = lk.shadow && lk.engine === 'pt'; if (on && !L.shadowPT.parent) scene.add(L.shadowPT); if (!on && L.shadowPT.parent) scene.remove(L.shadowPT); }
}

// ---------- size of the frame: 16:9, fit in the view ----------
function lkFit() {
  if (!L.on) return;
  const box = $('lkd-box'), bw = box.clientWidth - 20, bh = box.clientHeight - 20;
  if (bw < 10 || bh < 10) return;
  let w = bw, h = bw / LK_ASPECT; if (h > bh) { h = bh; w = bh * LK_ASPECT; }
  w = Math.floor(w); h = Math.floor(h);
  const fr = $('lkd-frame'); fr.style.width = w + 'px'; fr.style.height = h + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (lk.engine === 'pt') { // the path tracer renders a fixed 1280 × 720 (scaled on screen)
    const cur = renderer.getSize(new THREE.Vector2());
    if (cur.x !== 1280 || cur.y !== 720 || renderer.getPixelRatio() !== 1) { renderer.setPixelRatio(1); renderer.setSize(1280, 720, false); if (L.tracer) L.tracer.reset(); }
  } else { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); }
  burnCv.width = Math.round(w * dpr); burnCv.height = Math.round(h * dpr);
  $('lkd-ov').setAttribute('viewBox', `0 0 ${w} ${h}`);
  lkDirty();
}
new ResizeObserver(() => lkFit()).observe($('lkd-box'));

// ---------- draw loop ----------
function lkDirty() { L.dirty = true; lkGo(); }
function lkGo() { if (!L.raf && L.on) L.raf = requestAnimationFrame(lkLoop); }
function lkLoop() {
  L.raf = 0;
  if (!L.on || L.pbBusy) return;
  let more = false;
  if (L.playing) {
    const f = Math.floor(L.f0 + (performance.now() - L.t0) / 1000 * LK_FPS);
    lkSetFrame(((f - 1) % LK_N) + 1, true); more = true;
  }
  if (lk.engine === 'pt' && L.model) {
    if (L.ptBuilt && L.tracer) {
      const tr = L.tracer;
      tr.pausePathTracing = tr.samples >= lk.spp;
      try { lkPtSample(); } catch (e) { console.error(e); }
      if (!$('lkd-prog').hidden && !tr.isCompiling) lkProg(null);
      if (tr.samples < lk.spp) more = true;
      lkStatus();
    } else more = false;
  } else if (L.dirty) {
    L.accN = 0; lkRasterDraw(); lkStatus();
    if (lk.hq && L.model && !L.playing) more = true;
  } else if (lk.hq && L.model && !L.playing && L.accN < lkHqN()) {
    lkHqStep(); lkStatus();
    if (L.accN < lkHqN()) more = true;
  }
  L.dirty = false;
  lkBurnPreview(); lkOverlay();
  if (L.tool === 'pixel' && L.px) { const now = performance.now(); if (now - L.pxT > 200) { L.pxT = now; lkPxUI(); } }
  if (more) lkGo();
}
function lkStatus() {
  const f = L.frame, pass = f <= LK_OBJ ? 'model turns' : 'light turns';
  let t = L.model ? `${Math.round(L.tris).toLocaleString('en-US')} tris · ${L.envName || ''}` : 'no model';
  if (lk.engine === 'pt' && L.tracer && L.ptBuilt) { const n = Math.floor(L.tracer.samples); t += ` · ${n >= lk.spp ? 'done' : n < L.tracer.minSamples ? 'preview' : 'rendering'} ${n} / ${lk.spp}`; }
  if (lk.engine !== 'pt' && lk.hq && L.model) t += L.playing ? ' · Max quality (when still)' : ` · Max quality ${L.accN >= lkHqN() ? 'done' : L.accN} / ${lkHqN()}`;
  if (L.free) t += ' · free camera';
  $('lkd-st').textContent = t;
  $('lkd-p-pass').textContent = f <= LK_OBJ ? `Model turns · ${lkFno(1)}–${lkFno(LK_OBJ)}` : `Light turns · ${lkFno(LK_OBJ + 1)}–${lkFno(LK_N)}`;
  $('lkd-p-n').textContent = lkFno(f); $('lkd-p-end').textContent = lkFno(LK_N);
  void pass;
}
function lkSetFrame(f, playing) {
  f = Math.max(1, Math.min(LK_N, Math.round(f)));
  if (f === L.frame && !playing) return;
  L.frame = f; $('lkd-p-f').value = f; $('lkd-p-n').textContent = lkFno(f);
  lkCam();
  if (lk.engine === 'pt' && L.ptBuilt) lkPtMoved(true); else lkDirty();
}
function lkPlay(on = !L.playing) {
  L.playing = !!on && !!L.model;
  if (L.playing) { if (L.frame >= LK_N) L.frame = 1; L.f0 = L.frame; L.t0 = performance.now(); }
  $('lkd-p-play').innerHTML = L.playing ? lkIcon('<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>') : lkIcon('<path d="M8 5l11 7-11 7z"/>');
  $('lkd-p-play').setAttribute('aria-label', L.playing ? 'Pause' : 'Play');
  lkGo();
}

// ---------- path tracer ----------
async function lkPtLib() {
  if (!L.ptLib) { const [gpt, bvh] = await Promise.all([import('three-gpu-pathtracer'), import('three-mesh-bvh')]); L.ptLib = { gpt, bvh }; }
  return L.ptLib;
}
// the progress of the build, over the view (like 3D Render): { f: 0 to 1, t: the step } or null
function lkProg(p) {
  const el = $('lkd-prog'); el.hidden = !p; if (!p) return;
  $('lkd-prog-t').textContent = p.t; $('lkd-prog-b').style.width = (Math.max(0, Math.min(1, p.f)) * 100).toFixed(1) + '%';
}
const lkPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
// The scene of the path tracer stays on the GPU while you go to Raster and back (the GPU cache): coming back only
// updates what changed. What needs a new build in Raster (another model, references) marks it stale; Clear GPU cache
// frees it all.
async function lkPtRebuild() {
  if (lk.engine !== 'pt') { if (L.ptBuilt) L.ptStale = true; return; }
  if (!L.model || L.ptBusy) return;
  L.ptBusy = true; L.ptStale = false;
  try {
    lkProg({ f: 0.02, t: 'Loading the path tracer…' }); await lkPaint();
    const { gpt } = await lkPtLib();
    if (!L.tracer) {
      const tr = new gpt.WebGLPathTracer(renderer);
      tr.renderDelay = 80; tr.fadeDuration = 0; tr.minSamples = 2; tr.dynamicLowRes = true; tr.lowResScale = 0.25; tr.rasterizeScene = false;
      tr.textureSize.set(2048, 2048); tr.tiles.set(2, 2);
      const dn = new THREE.FullScreenQuad(new gpt.DenoiseMaterial({ map: null, blending: THREE.NoBlending, premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha }));
      // it draws into the float target of lkPtSample (linear Rec.709); the Viewer takes it to the screen after
      tr.renderToCanvasCallback = (target, r, quad) => {
        const ac = r.autoClear; r.autoClear = false;
        if (lk.dn) { const m = dn.material; m.map = target.texture; m.sigma = 5; m.threshold = 0.03; m.kSigma = 1; m.opacity = quad.material.opacity; dn.render(r); } else quad.render(r);
        r.autoClear = ac;
      };
      // the BVH in another thread, with its progress (the worker of 3D Render, js/render3d-pt.js)
      try { if (typeof r3PtLib === 'function' && typeof r3PtBvhWorker !== 'undefined') { await r3PtLib(); tr.setBVHWorker(r3PtBvhWorker); L.ptWorker = true; } } catch (e) { console.warn('BVH worker', e); }
      L.dnQuad = dn; L.tracer = tr;
    }
    lkShadowVis(); lkEnv(); lkFit();
    let tris = 0; scene.traverseVisible(o => { if (o.isMesh && o.geometry) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    lkProg({ f: 0.1, t: `Joining ${Math.round(tris).toLocaleString('en-US')} triangles…` }); await lkPaint();
    L.tracer.bounces = lk.bounces;
    let async = !!L.ptWorker;
    if (async) {
      try { await L.tracer.setSceneAsync(scene, cam, { onProgress: (p) => lkProg({ f: 0.15 + 0.8 * p, t: `Building the BVH… ${Math.round(p * 100)} %` }) }); }
      catch (e) { console.warn('BVH worker', e); async = false; }
    }
    if (!async) { lkProg({ f: 0.5, t: 'Building the BVH (the page stops for a moment)…' }); await lkPaint(); L.tracer.setScene(scene, cam); }
    lkProg({ f: 0.97, t: 'Compiling the shaders…' });
    L.ptBuilt = true; L.ptMats = false;
  } catch (e) { console.error(e); toast('Path tracer: ' + (e.message || e), true); lkProg(null); }
  finally { L.ptBusy = false; if (!L.ptBuilt) lkProg(null); lkGpuUI(); lkGo(); }
}
// Clear GPU cache: the scene of the path tracer and its textures off the GPU; Path trace builds it again
function lkGpuClear() {
  if (L.ptBusy) { toast('Wait until the build ends', true); return; }
  if (L.tracer) { try { L.tracer.dispose(); } catch (e) { console.warn('path tracer dispose', e); } }
  if (L.dnQuad) { L.dnQuad.material.dispose(); L.dnQuad.dispose(); L.dnQuad = null; }
  if (L.rtP) { L.rtP.dispose(); L.rtP = null; }
  L.tracer = null; L.ptWorker = false; L.ptBuilt = false; L.ptStale = false; lkProg(null);
  toast(lk.engine === 'pt' ? 'GPU cache cleared: building the path tracer again' : 'GPU cache cleared: Path trace builds it again');
  lkGpuUI();
  if (lk.engine === 'pt') lkPtRebuild(); else lkDirty();
}
function lkGpuUI() {
  const b = $('lkd-gpux'); if (!b) return;
  b.disabled = !L.tracer && !L.ptBuilt;
  b.title = `Clear GPU cache: frees the scene of the path tracer from the GPU (it stays there while you go to Raster and back, so it is not built again)${L.ptBuilt ? ` · now: built${L.ptStale ? ', it will be built again (something changed)' : ''}` : ' · now: empty'}`;
}
// the camera, the light and the references moved: the refs ride on the camera, so their place in the BVH is refit
function lkPtMoved(refit) {
  if (!L.tracer || !L.ptBuilt) return;
  const tr = L.tracer;
  if (refit && L.refs) {
    scene.updateMatrixWorld(true);
    try {
      const res = tr._generator.generate(), m = tr._pathTracer.material;
      if (res.bvhChanged) { const a = res.geometry.attributes; m.bvh.updateFrom(res.bvh); m.attributesArray.updateFrom(a.normal, a.tangent, a.uv, a.color); }
      if (res.needsMaterialIndexUpdate) m.materialIndexAttribute.updateFrom(res.geometry.attributes.materialIndex);
    } catch (e) { console.error(e); }
  }
  tr.updateCamera(); tr.updateEnvironment(); if (L.lights.length || L.sun) tr.updateLights(); lkGo();
}
function lkEngine(e) {
  lk.engine = e === 'pt' ? 'pt' : 'raster'; lkSave();
  $('lkd-e-raster').setAttribute('aria-pressed', String(lk.engine === 'raster')); $('lkd-e-pt').setAttribute('aria-pressed', String(lk.engine === 'pt'));
  $('lkd-pt-st').textContent = lk.engine === 'pt' ? 'on' : 'off'; $('lkd-c-hq').hidden = lk.engine === 'pt'; L.accN = 0;
  lkShadowVis(); lkEnv(); lkFit();
  if (lk.engine === 'pt') {
    // back from Raster with the scene on the GPU: only what changed meanwhile
    if (L.ptBuilt && L.tracer && !L.ptStale && !L.ptBusy) {
      const tr = L.tracer; tr.bounces = lk.bounces;
      try { if (L.ptMats) { tr.updateMaterials(); L.ptMats = false; } tr.updateLights(); lkPtMoved(true); tr.reset(); } catch (e) { console.error(e); L.ptBuilt = false; lkPtRebuild(); }
      lkGo();
    } else { L.ptBuilt = false; lkPtRebuild(); }
  } else { lkProg(null); lkDirty(); }
  lkGpuUI();
}

// ---------- navigation (free camera) and measure ----------
const nav = { act: null, x: 0, y: 0, id: -1, tgt: new THREE.Vector3(), x0: 0, y0: 0, b: 0 };
// moved off the turntable camera: Back to camera stands out on the bar and the frame gets the accent color (like 3D Render)
function lkBackUI() { $('lkd-back').hidden = !L.free; $('lkd-frame').classList.toggle('free', !!L.free); }
function lkFree() { if (!L.free) { L.free = true; nav.tgt.copy(L.c); lkBackUI(); } }
function lkBack() { if (!L.free) return; L.free = false; lkBackUI(); lkCam(); if (lk.engine === 'pt' && L.ptBuilt) lkPtMoved(true); else lkDirty(); }
function lkRotate(dx, dy, around) {
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const q = new THREE.Quaternion().setFromAxisAngle(up, -dx * 0.005).multiply(new THREE.Quaternion().setFromAxisAngle(right, -dy * 0.005));
  if (around) cam.position.sub(around).applyQuaternion(q).add(around);
  else { const off = nav.tgt.clone().sub(cam.position).applyQuaternion(q); nav.tgt.copy(cam.position).add(off); }
  cam.quaternion.premultiply(q);
}
function lkDolly(k) {
  const off = cam.position.clone().sub(nav.tgt), d = off.length(), nd = Math.max(L.r * 0.02, d * k);
  cam.position.copy(nav.tgt).addScaledVector(off.normalize(), nd);
}
function lkMoved() { cam.updateMatrixWorld(true); lkRefsPlace(); if (lk.engine === 'pt' && L.ptBuilt) { clearTimeout(L.keyT); lkPtMoved(false); L.keyT = setTimeout(() => lkPtMoved(true), 120); } else lkDirty(); lkStatus(); }
canvas.addEventListener('contextmenu', e => e.preventDefault());
// the tools on the left: Navigate, Measure, Light, Pixel analyzer. With Measure, Light and the analyzer the left button is
// theirs; the other buttons (and the Nav mouse style with Alt) still navigate
const lkFramePt = (e) => { const r = $('lkd-frame').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
canvas.addEventListener('pointerdown', e => {
  if (!L.model || nav.act) return;
  let act = null;
  if (e.button === 0 && !e.altKey && L.tool === 'light') {
    const hit = lkLightHit(e); if (hit >= 0) { L.lsel = hit; lkLightsUI(); }
    act = hit >= 0 || lk.lmode === 'orb' ? 'lorbit' : 'light';
  }
  else if (e.button === 0 && !e.altKey && L.tool === 'pixel') act = 'pixel';
  if (!act) act = NAV[navPreset] && NAV[navPreset].map ? NAV[navPreset].map(e.button, e) : null;
  if (!act) act = e.button === 1 ? 'pan' : e.button === 2 ? 'dolly' : L.tool === 'measure' ? null : 'orbit';
  nav.x = nav.x0 = e.clientX; nav.y = nav.y0 = e.clientY; nav.b = e.button; nav.id = e.pointerId; nav.act = act || 'click';
  canvas.setPointerCapture(e.pointerId); e.preventDefault();
  if (act === 'light') { if (L.playing) lkPlay(false); if (!lkLightAt(e.clientX, e.clientY, e.shiftKey)) toast('Click on the model where the highlight should be'); }
  if (act === 'lorbit') { if (L.playing) lkPlay(false); if (!lk.lights.length) { lkLightAdd('area'); } lkOverlay(); }
  if (act === 'pixel') { const p = lkFramePt(e); L.px = Object.assign(L.px || {}, { a: p, b: p, cur: p }); lkPxUI(); lkOverlay(); }
});
canvas.addEventListener('pointermove', e => {
  if (L.tool === 'pixel' && (!nav.act || nav.act === 'pixel')) {
    const p = lkFramePt(e); L.px = L.px || {}; L.px.cur = p; if (nav.act === 'pixel') L.px.b = p;
    const now = performance.now(); if (now - L.pxT > 30) { L.pxT = now; lkPxUI(); } lkOverlay();
    if (nav.act === 'pixel') return;
  }
  if (!nav.act || e.pointerId !== nav.id || nav.act === 'click') return;
  if (nav.act === 'light') { lkLightAt(e.clientX, e.clientY, false); return; }
  if (nav.act === 'lorbit') {
    const dx = e.clientX - nav.x, dy = e.clientY - nav.y; nav.x = e.clientX; nav.y = e.clientY;
    const li = lk.lights[L.lsel]; if (!li || (!dx && !dy)) return;
    if (e.shiftKey) { if (li.type !== 'dir') li.d = Math.max(0.05, Math.min(500, li.d * Math.exp(dy * 0.01))); }
    else { li.az = ((li.az - dx * 0.4) % 360 + 540) % 360 - 180; li.el = Math.max(-89, Math.min(89, li.el - dy * 0.3)); }
    lkLightsMoved(); return;
  }
  const dx = e.clientX - nav.x, dy = e.clientY - nav.y; nav.x = e.clientX; nav.y = e.clientY;
  if (!dx && !dy) return;
  if (L.playing) lkPlay(false);
  lkFree();
  if (nav.act === 'orbit') lkRotate(dx, dy, nav.tgt);
  else if (nav.act === 'look') lkRotate(dx, dy, null);
  else if (nav.act === 'pan') {
    const d = cam.position.distanceTo(nav.tgt), k = 2 * d * Math.tan(cam.fov * Math.PI / 360) / ($('lkd-frame').clientHeight || 500);
    const mv = new THREE.Vector3(-dx * k, dy * k, 0).applyQuaternion(cam.quaternion); cam.position.add(mv); nav.tgt.add(mv);
  } else if (nav.act === 'dolly') lkDolly(Math.exp((dy - dx) * 0.01));
  lkMoved();
});
canvas.addEventListener('pointermove', e => {
  const [px, py] = lkFramePt(e), fr = $('lkd-frame'), W = lkPbWH()[0];
  $('lkd-cx').textContent = Math.round(px / fr.clientWidth * W); $('lkd-cy').textContent = Math.round(py / fr.clientHeight * W / LK_ASPECT);
});
canvas.addEventListener('pointerleave', () => { $('lkd-cx').textContent = $('lkd-cy').textContent = '–'; });
canvas.addEventListener('pointerleave', () => { if (L.px && !nav.act) { L.px.cur = null; lkPxUI(); } });
const navEnd = (e) => {
  if (e.pointerId !== nav.id) return;
  const click = nav.act === 'click' || (nav.b === 0 && L.tool === 'measure' && Math.hypot(e.clientX - nav.x0, e.clientY - nav.y0) < 4);
  const was = nav.act;
  nav.act = null; nav.id = -1;
  if (click && L.tool === 'measure' && e.type === 'pointerup') lkMeasureClick(e.clientX, e.clientY);
  if (was === 'pixel') lkPxUI();
};
canvas.addEventListener('pointerup', navEnd); canvas.addEventListener('pointercancel', navEnd);
canvas.addEventListener('wheel', e => { if (!L.model) return; e.preventDefault(); lkFree(); lkDolly(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0015)); lkMoved(); }, { passive: false });
const ray = new THREE.Raycaster();
function lkPick(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height * 2 - 1)), cam);
  const h = L.model ? ray.intersectObject(L.model, true).find(x => x.object.isMesh) : null;
  return h ? h.point.clone() : null;
}
// the light under the mouse on the view (Light tool), or -1
function lkLightHit(e) {
  const [px, py] = lkFramePt(e), w = $('lkd-frame').clientWidth, h = $('lkd-frame').clientHeight;
  let best = -1, bd = 14;
  L.lights.forEach(({ obj }, i) => { const v = obj.position.clone().project(cam); if (v.z > 1 || v.z < -1) return; const d = Math.hypot((v.x + 1) / 2 * w - px, (1 - v.y) / 2 * h - py); if (d < bd) { bd = d; best = i; } });
  return best;
}
const LK_HINTS = {
  nav: 'Navigate: the Nav mouse style below · wheel: zoom · F: back to the turntable camera',
  measure: 'Measure: click two points on the model · Esc clears',
  light: 'Light: click on the model where the highlight should be (Shift: a new light) · drag a light on the view to move it · Move: drag to turn it, Shift + drag: distance',
  pixel: 'Pixel analyzer: hover to read a pixel · drag a box for its average, min and max · Esc clears',
};
function lkHint() {
  let t = LK_HINTS[L.tool] || '';
  if (L.tool === 'light') t = lk.lmode === 'orb' ? 'Move: drag to turn the selected light around the model (sideways: direction, up and down: height) · Shift + drag: distance' : LK_HINTS.light;
  $('lkd-hint').textContent = L.model ? t : 'Drop a model on the view';
}
function lkTool(t) {
  L.tool = L.model || t === 'nav' ? t : 'nav';
  L.measure = L.tool === 'measure';
  for (const [id, k] of [['lkd-nav', 'nav'], ['lkd-meas', 'measure'], ['lkd-light', 'light'], ['lkd-pix', 'pixel']]) $(id).setAttribute('aria-pressed', String(L.tool === k));
  canvas.classList.toggle('measuring', L.tool !== 'nav');
  if (!L.measure) { L.mA = L.mB = null; }
  if (L.tool !== 'pixel') L.px = null;
  $('lkd-fly').hidden = L.tool !== 'light';
  lkPxUI(); lkOverlay(); lkHint();
}
function lkMeasureSet(on = !L.measure) { lkTool(on ? 'measure' : 'nav'); }
function lkMeasureClick(cx, cy) {
  const p = lkPick(cx, cy); if (!p) { toast('Click on the model'); return; }
  // the points are kept in the model's space: they stay on it whatever the camera does
  const loc = L.root.worldToLocal(p.clone());
  if (!L.mA || L.mB) { L.mA = loc; L.mB = null; } else L.mB = loc;
  lkOverlay();
}
// what is drawn over the view: the measure, the lights (Light tool) and the box of the analyzer
function lkOverlay() {
  const ov = $('lkd-ov'), pop = $('lkd-mpop');
  const w = $('lkd-frame').clientWidth, h = $('lkd-frame').clientHeight;
  let s = '';
  pop.hidden = true;
  if (L.measure && L.mA && L.root) {
    const to = (pl) => { const v = L.root.localToWorld(pl.clone()).project(cam); return v.z < 1 ? [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h] : null; };
    const a = to(L.mA), b = L.mB && to(L.mB);
    if (a && b) s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
    for (const q of [a, b]) if (q) s += `<circle cx="${q[0]}" cy="${q[1]}" r="4.5"/>`;
    pop.hidden = !(a && b);
    if (a && b) {
      const d = L.root.localToWorld(L.mA.clone()).distanceTo(L.root.localToWorld(L.mB.clone()));
      $('lkd-md').textContent = `${d.toFixed(3)} m · ${(d * 100).toFixed(1)} cm`;
      pop.style.left = Math.min(w - 10, Math.max(10, (a[0] + b[0]) / 2)) + 'px'; pop.style.top = Math.min(h - 10, Math.max(10, (a[1] + b[1]) / 2)) + 'px';
    }
  }
  if (L.model) s += lkLightsOverlay(w, h);
  const P = L.px;
  if (L.tool === 'pixel' && P && P.a && P.b && (Math.abs(P.a[0] - P.b[0]) > 1 || Math.abs(P.a[1] - P.b[1]) > 1)) {
    s += `<rect class="lkpx" x="${Math.min(P.a[0], P.b[0])}" y="${Math.min(P.a[1], P.b[1])}" width="${Math.abs(P.a[0] - P.b[0])}" height="${Math.abs(P.a[1] - P.b[1])}"/>`;
  }
  ov.innerHTML = s;
}
const lkMeasureDraw = lkOverlay;
$('lkd-mx').onclick = () => { L.mA = L.mB = null; lkOverlay(); };
$('lkd-px-x').onclick = () => { if (L.px) { L.px.a = L.px.b = null; } lkPxUI(); lkOverlay(); };
$('lkd-px-sp').addEventListener('change', e => { lk.pxSpace = e.target.value; lkSave(); lkPxUI(); });

// ---------- pixel analyzer (like the one of Nuke) ----------
// It reads the image before the Viewer (Raster: ACEScg; Path trace: linear Rec.709, to ACEScg), with the exposure, and
// shows it in ACEScg, in linear Rec.709 or as it goes to the screen (0–255 after the Viewer): the pixel under the mouse,
// and the average, minimum and maximum of a box. L.px: { cur: [x, y], a: [x, y], b: [x, y] } in px of the frame.
const LK_LUM_AP1 = [0.2722287, 0.6740818, 0.0536895];
function lkPxRead(x0, y0, x1, y1) {
  const avg = lk.engine !== 'pt' && L.accN > 0 && L.rtA, t = lk.engine === 'pt' ? L.rtP : avg ? L.rtA : L.rtB; if (!t) return null;
  const fr = $('lkd-frame'), sx = t.width / fr.clientWidth, sy = t.height / fr.clientHeight;
  let ax = Math.floor(Math.min(x0, x1) * sx), bx = Math.ceil(Math.max(x0, x1) * sx), ay = Math.floor(Math.min(y0, y1) * sy), by = Math.ceil(Math.max(y0, y1) * sy);
  ax = Math.max(0, Math.min(t.width - 1, ax)); bx = Math.max(ax + 1, Math.min(t.width, bx)); ay = Math.max(0, Math.min(t.height - 1, ay)); by = Math.max(ay + 1, Math.min(t.height, by));
  const w = bx - ax, h = by - ay, buf = new Uint16Array(w * h * 4);
  try { renderer.readRenderTargetPixels(t, ax, t.height - by, w, h, buf); } catch (e) { console.error(e); return null; }
  const g = r3ExpGain(lk.ev) * (avg ? 1 / L.accN : 1), pt = lk.engine === 'pt', out = [], f = THREE.DataUtils.fromHalfFloat;
  for (let i = 0; i < w * h; i++) {
    let c = [f(buf[i * 4]), f(buf[i * 4 + 1]), f(buf[i * 4 + 2])];
    if (pt) { const a = f(buf[i * 4 + 3]); if (a > 1e-4) c = c.map(v => v / a); c = r3M3(R3_709_TO_AP1, c); }
    out.push(c.map(v => v * g));
  }
  return out; // ACEScg × exposure
}
// one value in the space shown
function lkPxIn(ap1) {
  if (lk.pxSpace === 'lin709') return r3M3(R3_AP1_TO_709, ap1);
  if (lk.pxSpace === 'disp') return r3ViewPixel(ap1, lk.view, 1).map(v => v * 255);
  return ap1;
}
const lkPxLum = (ap1) => LK_LUM_AP1[0] * ap1[0] + LK_LUM_AP1[1] * ap1[1] + LK_LUM_AP1[2] * ap1[2];
function lkPxRows() {
  const P = L.px; if (!P || L.tool !== 'pixel') return null;
  const rows = [];
  const row = (name, ap1, sw) => { const v = lkPxIn(ap1), l = lk.pxSpace === 'disp' ? 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] : lk.pxSpace === 'lin709' ? 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] : lkPxLum(ap1); rows.push([name, [...v, l], sw || ap1]); };
  if (P.cur) { const p = lkPxRead(P.cur[0], P.cur[1], P.cur[0] + 0.5, P.cur[1] + 0.5); if (p && p.length) row('Current', p[0]); }
  if (P.a && P.b && (Math.abs(P.a[0] - P.b[0]) > 1 || Math.abs(P.a[1] - P.b[1]) > 1)) {
    const px = lkPxRead(P.a[0], P.a[1], P.b[0], P.b[1]);
    if (px && px.length) {
      const avg = [0, 0, 0], mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      let lmin = null, lmax = null;
      for (const c of px) { for (let k = 0; k < 3; k++) { avg[k] += c[k]; mn[k] = Math.min(mn[k], c[k]); mx[k] = Math.max(mx[k], c[k]); } const l = lkPxLum(c); if (!lmin || l < lmin[0]) lmin = [l, c]; if (!lmax || l > lmax[0]) lmax = [l, c]; }
      row('Average', avg.map(v => v / px.length)); row('Min', mn, lmin[1]); row('Max', mx, lmax[1]);
      P.n = px.length;
    }
  } else P.n = 0;
  return rows;
}
function lkPxUI() {
  const box = $('lkd-pxa'); box.hidden = L.tool !== 'pixel';
  if (box.hidden) return;
  const rows = lkPxRows() || [], d = lk.pxSpace === 'disp' ? 0 : 4;
  $('lkd-px-t').innerHTML = rows.map(([n, v, sw]) => { const s = r3ViewPixel(sw, lk.view, 1).map(x => Math.round(x * 255)); return `<tr><th>${n}</th><td><i style="background:rgb(${s.join(',')})"></i></td>${v.map((x, k) => `<td class="c${k}">${Number.isFinite(x) ? x.toFixed(d) : '–'}</td>`).join('')}</tr>`; }).join('');
  $('lkd-px-n').textContent = L.px && L.px.n ? `Box: ${L.px.n.toLocaleString('en-US')} px · values ${lk.pxSpace === 'disp' ? 'after the Viewer (8 bit)' : 'scene linear, with the exposure'}` : 'Hover the view; drag a box for its average, min and max';
}

// ---------- burn-in (the letters of VFX Shooting Sup) ----------
function lkBurnRows(f) {
  const F = lk.fields, up = (t) => String(t).toUpperCase();
  const top = [F.project && lk.project, F.asset && (L.modelName || '').replace(/\.[^.]+$/, '')].filter(Boolean).map(up).join('   ·   ');
  const r1 = [], r2 = [];
  if (F.hdri) r1.push([lk.env === 'hdri' ? 'HDRI' : 'Sky', lk.env === 'hdri' ? L.hdriName : L.envName]);
  if (F.rot) r1.push(['Rot', `${Math.round(lk.rot)}°`]);
  if (F.ev) r1.push(['EV', (lk.ev >= 0 ? '+' : '') + (+lk.ev).toFixed(1)]);
  if (F.lens) r1.push(['Lens', `${lk.lens} mm`]);
  if (F.film) r1.push(['Film', `${+lk.film} mm`]);
  if (F.view) r1.push(['View', (R3_VIEWS.find(v => v[0] === lk.view) || ['', ''])[1].replace(' (no tone map)', '')]);
  if (F.engine) r1.push(['Engine', lk.engine === 'pt' ? 'Path trace' : 'Raster']);
  if (F.frame) r2.push(['Frame', `${String(lkFno(f)).padStart(4, '0')} / ${String(lkFno(LK_N)).padStart(4, '0')}`]);
  if (F.pass) r2.push(['', f <= LK_OBJ ? 'Model turns' : 'Light turns']);
  if (F.date) r2.push(['Date', new Date().toISOString().slice(0, 10)]);
  if (F.artist && lk.artist) r2.push(['Artist', lk.artist]);
  return { top, rows: [r1, r2].filter(r => r.length) };
}
function lkBurnDraw(x, w, h, f) {
  const sty = LK_FONT[lk.font] || LK_FONT.monitor, fam = getComputedStyle(document.documentElement).getPropertyValue(sty.css) || 'sans-serif';
  const fs = Math.max(8, Math.round(w * (LK_TEXT[lk.text] || LK_TEXT.small))), pad = fs * 0.9, up = (t) => String(t).toUpperCase();
  const font = (wt, ff) => { x.font = `${wt} ${ff}px ${fam}`; x.letterSpacing = (sty.track * ff).toFixed(2) + 'px'; };
  const { top, rows } = lkBurnRows(f);
  const gapL = 0.5, gapI = 1.8;
  // the digits go in cells of the same width (the widest one): a frame number that changes does not move the letters
  const dW = () => Math.max(...'0123456789'.split('').map(d => x.measureText(d).width));
  const tw = (t) => { const dw = dW(); let ww = 0; for (const run of String(t).match(/\d+|\D+/g) || []) ww += /\d/.test(run[0]) ? dw * run.length : x.measureText(run).width; return ww; };
  const td = (t, cx, y) => {
    const dw = dW(), al = x.textAlign; x.textAlign = 'left';
    for (const run of String(t).match(/\d+|\D+/g) || []) {
      if (/\d/.test(run[0])) for (const d of run) { x.fillText(d, cx + (dw - x.measureText(d).width) / 2, y); cx += dw; }
      else { x.fillText(run, cx, y); cx += x.measureText(run).width; }
    }
    x.textAlign = al; return cx;
  };
  const rowW = (items, ff) => items.reduce((sum, [l, v], i) => { font(sty.w, ff); const lw = l ? x.measureText(up(l)).width + gapL * ff : 0; font(sty.wv, ff); return sum + lw + tw(up(v)) + (i ? gapI * ff : 0); }, 0);
  const fitF = (items, max) => { const ww = rowW(items, fs); return ww > max ? Math.max(6, Math.floor(fs * max / ww)) : fs; };
  const at = (ww) => lk.align === 'center' ? (w - ww) / 2 : lk.align === 'right' ? w - pad - ww : pad;
  const drawRow = (items, y, ff) => {
    let cx = at(rowW(items, ff)); x.textAlign = 'left';
    items.forEach(([l, v], i) => {
      if (i) cx += gapI * ff;
      if (l) { font(sty.w, ff); x.fillStyle = 'rgba(255,255,255,0.62)'; x.fillText(up(l), cx, y); cx += x.measureText(up(l)).width + gapL * ff; }
      font(sty.wv, ff); x.fillStyle = '#ffffff'; cx = td(up(v), cx, y);
    });
  };
  const bar = (y, hh) => { x.fillStyle = `rgba(0,0,0,${lk.bars})`; x.fillRect(0, y, w, hh); };
  const one = (t, wt, max) => { let ff = fs; font(wt, ff); while (x.measureText(t).width > max && ff > 6) { ff -= 1; font(wt, ff); } };
  x.save(); x.textBaseline = 'middle';
  // with a logo the top bar is as tall as it; the title and LOOKDEV move away from it
  const lg = lkLogoOn() ? cpLogoBox(w, h) : null, th = Math.max(fs * 2.1, lg ? lg.h + fs * 0.6 : 0); bar(0, th);
  if (lg) cpLogoDraw(x, w, h, { y: (th - lg.h) / 2 });
  const ctr = lk.talign === 'center', lw = lg ? lg.w + fs : 0;
  const tx = ctr ? (lg && lg.pos === 'center' ? null : w / 2) : pad + (lg && lg.pos === 'left' ? lw : 0);
  x.fillStyle = '#ffffff';
  if (top && tx !== null) { x.textAlign = ctr ? 'center' : 'left'; one(top, sty.wv, ctr ? w * 0.46 : w * 0.7 - lw); x.fillText(top, tx, th / 2); }
  else if (top) { x.textAlign = 'left'; one(top, sty.wv, w * 0.4); x.fillText(top, pad, th / 2); }
  if (lk.fields.tag) { x.textAlign = 'right'; one('LOOKDEV', sty.wv, w * 0.26); x.fillText('LOOKDEV', w - pad - (lg && lg.pos === 'right' ? lw : 0), th / 2); }
  if (rows.length) {
    const lh = fs * 1.7, bh = rows.length * lh + fs * 0.7; bar(h - bh, bh);
    rows.forEach((r, i) => drawRow(r, h - bh + fs * 0.35 + lh * (i + 0.5), fitF(r, w - 2 * pad)));
  }
  x.restore();
}
// the height of the lower bar of the burn-in, as a fraction of the frame height (the references sit above it)
function lkBurnBottom() {
  if (!lk.burn) return 0;
  const n = lkBurnRows(L.frame).rows.length; if (!n) return 0;
  const fs = (LK_TEXT[lk.text] || LK_TEXT.small) * LK_ASPECT; // the letter, as a fraction of the height
  return (n * 1.7 + 0.7) * fs;
}
function lkBurnPreview() {
  const x = burnCv.getContext('2d'); x.clearRect(0, 0, burnCv.width, burnCv.height);
  const logo = lkLogoOn();
  burnCv.hidden = !((lk.burn || logo) && L.model);
  if (!L.model) return;
  if (lk.burn) lkBurnDraw(x, burnCv.width, burnCv.height, L.frame); else if (logo) cpLogoDraw(x, burnCv.width, burnCv.height);
}

// ---------- playblast ----------
const pb = { cancel: false, url: '', blob: null };
function lkPbLoadMuxer() {
  if (window.Mp4Muxer) return Promise.resolve();
  return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/mp4-muxer.js'; sc.onload = res; sc.onerror = () => rej(new Error('Could not load the MP4 muxer')); document.head.appendChild(sc); });
}
// the encoder like the Playblast of the app (js/playblast.js): H.264 first, VP9 in the same MP4 if this browser has no
// usable H.264; the first chunk always goes to the muxer with a whole decoder config (some browsers give none, or one
// without colorSpace: "track.info.decoderConfig is null"), and an H.264 without its avcC goes on to VP9
const LK_PB_CANDS = [['avc1.640034', 'avc'], ['avc1.640033', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.42003e', 'avc'], ['vp09.00.50.08', 'vp9'], ['vp09.00.41.08', 'vp9']];
const LK_PB_CS = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
const lkPbName = () => ((L.modelName || 'model').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_')) + '_lookdev.mp4';
// save: the desktop app asks where; the browser, to Downloads
async function lkPbSave(blob, name) {
  try {
    if (window.bplDesktop && typeof desktopSave === 'function') { const r = await desktopSave(blob, name); toast(r.msg, !!r.error); return r.canceled ? 'not saved' : r.error ? 'not saved' : 'saved to ' + r.path; }
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (dl) { await dl.save({ filename: name, data: blob }); return 'saved to Downloads'; }
  } catch (e) { if (e && e.code === 'declined') return 'not saved'; }
  const a = document.createElement('a'); a.href = pb.url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  return 'saved to Downloads';
}
// the size of the playblast and of the stills
const lkPbWH = () => lk.pbSize === '2160' ? [3840, 2160] : lk.pbSize === '720' ? [1280, 720] : [1920, 1080];
// the codec is chosen before rendering, with one test frame: a codec that fails (no H.264 here, an H.264 without its
// avcC) is known before the first real frame, so the frames are rendered once (a path traced frame is never redone)
async function lkPbProbe(W, H, bitrate) {
  // a few test frames: the codec has to give every frame, in order, from 0 (an H.264 with B-frames gives them out of
  // order and the MP4 cannot take them; 'realtime' turns them off). H.264 first, in quality and then realtime mode; VP9 after
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d');
  const N = 6, dur = Math.round(1e6 / LK_FPS);
  const tries = [];
  for (const [codec, mux] of LK_PB_CANDS) for (const lat of mux === 'avc' ? ['quality', 'realtime'] : ['quality']) tries.push([codec, mux, lat]);
  for (const [codec, mux, lat] of tries) {
    const cfg = Object.assign({ codec, width: W, height: H, bitrate, framerate: LK_FPS, latencyMode: lat }, mux === 'avc' ? { avc: { format: 'avc' } } : {});
    const sup = await VideoEncoder.isConfigSupported(cfg).catch(() => null);
    if (!sup || !sup.supported) continue;
    const ts = []; let meta0 = null, err = null;
    const enc = new VideoEncoder({ output: (c, m) => { if (!ts.length) meta0 = m || {}; ts.push(c.timestamp); }, error: e => { err = e; } });
    try {
      enc.configure(cfg);
      for (let i = 0; i < N; i++) {
        cx.fillStyle = `rgb(${i * 40},${100 + i * 20},${200 - i * 30})`; cx.fillRect(0, 0, W, H); cx.fillStyle = '#fff'; cx.fillRect(i * W / N, 0, W / N, H);
        const fr = new VideoFrame(cv, { timestamp: i * dur, duration: dur }); enc.encode(fr, { keyFrame: i === 0 }); fr.close();
      }
      await enc.flush();
    } catch (e) { err = err || e; }
    try { if (enc.state !== 'closed') enc.close(); } catch (e) { /* closed */ }
    const inOrder = ts.length === N && ts.every((t, i) => t === i * dur);
    if (err || !inOrder) { console.warn('lookdev playblast: codec', codec, lat, err || `frames ${ts.join(', ')}`); continue; }
    if (mux === 'avc' && !(meta0.decoderConfig && meta0.decoderConfig.description)) { console.warn('lookdev playblast: H.264 without avcC', codec, lat); continue; }
    return { codec, mux, lat };
  }
  return null;
}
async function lkPlayblast() {
  if (!L.model || L.pbBusy) return;
  if (typeof VideoEncoder === 'undefined') { toast('This browser cannot encode video (needs WebCodecs: Chrome, Edge or Safari 17+)', true); return; }
  const [W, H] = lkPbWH(), pt = lk.engine === 'pt';
  const q = pt ? (LK_PB_Q[lk.pbQ] ? { spp: LK_PB_Q[lk.pbQ][0], bounces: LK_PB_Q[lk.pbQ][1] } : { spp: lk.spp, bounces: lk.bounces }) : null;
  lkPlay(false); L.pbBusy = true; pb.cancel = false;
  if (pb.url) { URL.revokeObjectURL(pb.url); pb.url = ''; }
  $('lkd-pbdlg').hidden = false; $('lkd-pb-save').hidden = $('lkd-pb-saveas').hidden = $('lkd-pb-video').hidden = true; $('lkd-pb-x').textContent = 'Cancel';
  $('lkd-pb-bar').style.width = '0'; $('lkd-pb-st').textContent = 'Starting…';
  $('lkd-pb-info').textContent = `${lkPbName()} · frames ${lkFno(1)}–${lkFno(LK_N)} at ${LK_FPS} fps · ${W} × ${H} · ${pt ? `path trace, ${q.spp} samples, ${q.bounces} bounces per frame` : (+lk.aa > 1 ? `raster, Max quality ${lk.aa} samples` : 'raster, interactive')} · ${(R3_VIEWS.find(v => v[0] === lk.view) || ['', ''])[1]}${lk.burn ? ' · burn-in' : ''}${lkLogoOn() ? ' · logo' : ''}`;
  const keep = { frame: L.frame, free: L.free, pos: cam.position.clone(), quat: cam.quaternion.clone() };
  const out = document.createElement('canvas'); out.width = W; out.height = H; const ctx = out.getContext('2d');
  let enc = null, done = 0, cancelled = false; const t0 = performance.now();
  const tr = L.tracer, trKeep = tr && { d: tr.renderDelay, l: tr.dynamicLowRes, m: tr.minSamples, b: tr.bounces };
  try {
    await lkPbLoadMuxer();
    const bitrate = Math.min(80e6, Math.max(4e6, W * H * LK_FPS * 0.12));
    const cd = await lkPbProbe(W, H, bitrate);
    if (!cd) throw new Error(`no video encoder for ${W} × ${H} here${W > 1920 ? ': try 1080p' : ''}`);
    const { codec, mux, lat } = cd;
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: mux, width: W, height: H, frameRate: LK_FPS }, fastStart: 'in-memory',
      // the first frame is at 0 (the probe checks it); offset, in case an encoder starts it a little late
      firstTimestampBehavior: 'offset' });
    let encErr = null, first = true;
    enc = new VideoEncoder({
      output: (chunk, meta) => {
        if (encErr) return;
        try {
          if (first) {
            first = false; meta = meta || {};
            const dc = meta.decoderConfig;
            meta = { ...meta, decoderConfig: { codec, codedWidth: W, codedHeight: H, ...(dc || {}), colorSpace: (dc && dc.colorSpace && dc.colorSpace.primaries) ? dc.colorSpace : LK_PB_CS } };
          }
          if (chunk.timestamp <= lastTs) throw new Error(`the ${mux === 'avc' ? 'H.264' : 'VP9'} encoder gave frames out of order (${lastTs} then ${chunk.timestamp} µs)`);
          lastTs = chunk.timestamp;
          muxer.addVideoChunk(chunk, meta);
        } catch (e) { encErr = e; }
      },
      error: e => { encErr = encErr || e; },
    });
    enc.configure(Object.assign({ codec, width: W, height: H, bitrate, framerate: LK_FPS, latencyMode: lat }, mux === 'avc' ? { avc: { format: 'avc' } } : {}));
    // the chunks go in in order of time; one that comes out of order (or late) stops it with a clear message
    let lastTs = -1;
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    L.free = false;
    if (pt) { tr.renderDelay = 0; tr.dynamicLowRes = false; tr.minSamples = 1; tr.bounces = q.bounces; tr.reset(); }
    frames: for (let f = 1; f <= LK_N; f++) {
      if (pb.cancel) { cancelled = true; break; }
      if (encErr) throw encErr;
      L.frame = f; lkCam();
      if (pt) {
        lkPtMoved(true); tr.reset(); tr.pausePathTracing = false;
        let t = performance.now();
        while (tr.samples < q.spp) {
          if (pb.cancel) { cancelled = true; break frames; }
          lkPtSample();
          if (performance.now() - t > 40) { await new Promise(r => setTimeout(r, 0)); t = performance.now(); }
        }
      } else lkRasterDrawHQ(+lk.aa || 1);
      ctx.drawImage(canvas, 0, 0, W, H);
      if (lk.burn) lkBurnDraw(ctx, W, H, f); else if (lkLogoOn()) cpLogoDraw(ctx, W, H);
      const fr = new VideoFrame(out, { timestamp: Math.round((f - 1) * 1e6 / LK_FPS), duration: Math.round(1e6 / LK_FPS) });
      enc.encode(fr, { keyFrame: (f - 1) % LK_FPS === 0 }); fr.close(); done = f;
      while (enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 5));
      if (encErr) throw encErr;
      const per = (performance.now() - t0) / 1000 / f, left = per * (LK_N - f);
      $('lkd-pb-bar').style.width = (f / LK_N * 100).toFixed(1) + '%';
      $('lkd-pb-st').textContent = `Frame ${lkFno(f)} (${f} / ${LK_N}) · ${per.toFixed(2)} s per frame · ${left >= 90 ? Math.round(left / 60) + ' min' : Math.round(left) + ' s'} left`;
      if (!pt && f % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
    if (!done) throw new Error('cancelled');
    await enc.flush(); if (encErr) throw encErr;
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    pb.url = URL.createObjectURL(blob); pb.blob = blob;
    const v = $('lkd-pb-video'); v.src = pb.url; v.hidden = false; v.play().catch(() => {});
    $('lkd-pb-save').hidden = false; $('lkd-pb-saveas').hidden = !!window.bplDesktop || !(window.showSaveFilePicker && window.self === window.top);
    const info = `${lkPbName()} · ${cancelled ? `cancelled: frames ${lkFno(1)}–${lkFno(done)} (${done} of ${LK_N})` : `${LK_N} frames`} · ${(blob.size / 1048576).toFixed(1)} MB · ${mux === 'vp9' ? 'VP9 (this browser has no usable H.264: plays in browsers, VLC and Resolve, not QuickTime)' : 'H.264'} · ${((performance.now() - t0) / 1000).toFixed(0)} s`;
    $('lkd-pb-st').textContent = info;
    // a cancelled one is only shown (Save MP4 keeps it); a whole one is saved
    if (!cancelled) { const where = await lkPbSave(blob, lkPbName()); $('lkd-pb-st').textContent = `${info} · ${where}`; }
  } catch (e) {
    $('lkd-pb-st').textContent = e.message === 'cancelled' ? 'Cancelled before the first frame.' : 'The playblast failed: ' + (e.message || e);
    if (e.message !== 'cancelled') console.error(e);
  } finally {
    try { if (enc && enc.state !== 'closed') enc.close(); } catch (e) { /* closed */ }
    if (tr && trKeep) { tr.renderDelay = trKeep.d; tr.dynamicLowRes = trKeep.l; tr.minSamples = trKeep.m; tr.bounces = trKeep.b; }
    L.pbBusy = false; $('lkd-pb-x').textContent = 'Close';
    L.frame = keep.frame; L.free = keep.free; lkBackUI();
    if (keep.free) { cam.position.copy(keep.pos); cam.quaternion.copy(keep.quat); cam.updateMatrixWorld(true); }
    lkCam(); lkFit(); if (pt) { lkPtMoved(true); tr.reset(); } lkDirty();
  }
}
$('lkd-pb-save').onclick = async () => { if (pb.blob) $('lkd-pb-st').textContent = `${lkPbName()} · ${await lkPbSave(pb.blob, lkPbName())}`; };
$('lkd-pb-saveas').onclick = async () => {
  if (!pb.blob) return;
  try {
    const h = await window.showSaveFilePicker({ suggestedName: lkPbName(), startIn: 'desktop', types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
    const w = await h.createWritable(); await w.write(pb.blob); await w.close();
    $('lkd-pb-st').textContent = `Saved as ${h.name} in the folder you picked`;
  } catch (e) { if (!e || e.name !== 'AbortError') $('lkd-pb-st').textContent = 'Could not save there: ' + (e && e.message || e); }
};
async function lkStill() {
  if (!L.model || L.pbBusy) return;
  const [W, H] = lkPbWH(), pt = lk.engine === 'pt';
  const q = pt ? (LK_PB_Q[lk.pbQ] ? { spp: LK_PB_Q[lk.pbQ][0], bounces: LK_PB_Q[lk.pbQ][1] } : { spp: lk.spp, bounces: lk.bounces }) : null;
  lkPlay(false); L.pbBusy = true; lkBusy(`Still ${lkFno(L.frame)} · ${W} × ${H}${pt ? ` · ${q.spp} samples` : +lk.aa > 1 ? ` · Max quality ${lk.aa} samples` : ''}…`);
  await new Promise(r => setTimeout(r, 30));
  const tr = L.tracer, trKeep = tr && { d: tr.renderDelay, l: tr.dynamicLowRes, m: tr.minSamples, b: tr.bounces };
  try {
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    if (pt) {
      tr.renderDelay = 0; tr.dynamicLowRes = false; tr.minSamples = 1; tr.bounces = q.bounces; lkPtMoved(true); tr.reset(); tr.pausePathTracing = false;
      let t = performance.now();
      while (tr.samples < q.spp) { lkPtSample(); if (performance.now() - t > 40) { await new Promise(r => setTimeout(r, 0)); t = performance.now(); } }
    } else lkRasterDrawHQ(+lk.aa || 1);
    const out = document.createElement('canvas'); out.width = W; out.height = H; const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0, W, H); if (lk.burn) lkBurnDraw(ctx, W, H, L.frame); else if (lkLogoOn()) cpLogoDraw(ctx, W, H);
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    const name = ((L.modelName || 'model').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_')) + `_lookdev_${lkFno(L.frame)}.png`;
    pb.url && URL.revokeObjectURL(pb.url); pb.url = URL.createObjectURL(blob);
    if (window.bplDesktop && typeof desktopSave === 'function') { const r = await desktopSave(blob, name); toast(r.msg, !!r.error); }
    else { const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null; if (dl) await dl.save({ filename: name, data: blob }); else { const a = document.createElement('a'); a.href = pb.url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); } toast(`${name} · ${W} × ${H} (saved to Downloads)`); }
  } catch (e) { console.error(e); toast('Could not save the still: ' + (e.message || e), true); }
  finally {
    if (tr && trKeep) { tr.renderDelay = trKeep.d; tr.dynamicLowRes = trKeep.l; tr.minSamples = trKeep.m; tr.bounces = trKeep.b; }
    L.pbBusy = false; lkBusy(''); lkFit(); if (pt && tr) { lkPtMoved(true); tr.reset(); } lkDirty();
  }
}
$('lkd-still').onclick = $('lkd-still2').onclick = () => lkStill();
$('lkd-pb-x').onclick = () => { if (L.pbBusy) pb.cancel = true; else $('lkd-pbdlg').hidden = true; };
$('lkd-pbdlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); $('lkd-pb-x').click(); } });

// ---------- controls ----------
function lkBusy(t) { $('lkd-busy').hidden = !t; $('lkd-busy').textContent = t || ''; }
function lkUI() {
  $('lkd-hdri').value = lk.hdri === 'user' && !L.userHdri ? 'studio' : lk.hdri;
  const nv = (id, v) => { const el = $(id); if (document.activeElement !== el && !(el.parentNode && el.parentNode.classList.contains('scrubbing'))) el.value = v; };
  for (const [id, k] of [['lkd-rot', 'rot'], ['lkd-ev', 'ev'], ['lkd-blur', 'blur'], ['lkd-lens', 'lens'], ['lkd-elev', 'elev'], ['lkd-fill', 'fill'], ['lkd-spp', 'spp'], ['lkd-bounces', 'bounces'], ['lkd-bars', 'bars'],
    ['lkd-int', 'int'], ['lkd-skyint', 'skyInt'], ['lkd-sunaz', 'sunAz'], ['lkd-sunel', 'sunEl'], ['lkd-sunint', 'sunInt'], ['lkd-skyt', 'skyT'], ['lkd-skyalb', 'skyAlb'],
    ['lkd-v-lens', 'lens'], ['lkd-v-elev', 'elev'], ['lkd-v-fill', 'fill'], ['lkd-v-film', 'film'], ['lkd-film', 'film'], ['lkd-start', 'start']]) nv(id, lk[k]);
  $('lkd-logo').checked = !!lk.logo; $('lkd-logo-n').textContent = typeof cpLogoReady === 'function' && cpLogoReady() ? 'from Settings' : 'none yet: Settings › Logo';
  $('lkd-filmp').value = LK_FILMS.some(f => f[0] === +lk.film) ? String(+lk.film) : 'custom'; $('lkd-aa').value = String(lk.aa);
  $('lkd-lm-hl').setAttribute('aria-pressed', String(lk.lmode !== 'orb')); $('lkd-lm-orb').setAttribute('aria-pressed', String(lk.lmode === 'orb'));
  $('lkd-p-n').textContent = lkFno(L.frame); $('lkd-p-end').textContent = lkFno(LK_N);
  $('lkd-v-ev-r').value = lk.ev; $('lkd-v-ev-n').textContent = (lk.ev >= 0 ? '+' : '') + (+lk.ev).toFixed(1);
  $('lkd-skycol').value = lk.skyCol; $('lkd-gndcol').value = lk.gndCol; $('lkd-cs').value = lk.cs; $('lkd-px-sp').value = lk.pxSpace;
  for (const e of ['hdri', 'colors', 'phys']) $('lkd-env-' + e).setAttribute('aria-pressed', String(lk.env === e));
  $('lkd-envr-hdri').hidden = lk.env !== 'hdri'; $('lkd-envr-sky').hidden = lk.env === 'hdri'; $('lkd-envr-colors').hidden = lk.env !== 'colors'; $('lkd-envr-phys').hidden = lk.env !== 'phys';
  $('lkd-c-show').lastChild.textContent = lk.env === 'hdri' ? 'HDRI' : 'Sky';
  for (const [id, k] of [['lkd-view', 'view'], ['lkd-up', 'up'], ['lkd-yaw', 'yaw'], ['lkd-units', 'units'], ['lkd-dir', 'dir'], ['lkd-text', 'text'], ['lkd-font', 'font'], ['lkd-align', 'align'], ['lkd-talign', 'talign'], ['lkd-pbsize', 'pbSize'], ['lkd-pbq', 'pbQ']]) $(id).value = String(lk[k]);
  for (const [id, k] of [['lkd-show', 'show'], ['lkd-chrome', 'chrome'], ['lkd-grey', 'grey'], ['lkd-chart', 'chart'], ['lkd-shadow', 'shadow'], ['lkd-dn', 'dn'], ['lkd-burn', 'burn']]) $(id).checked = !!lk[k];
  for (const a of ['x', 'y', 'z']) $('lkd-off' + a).value = lk['off' + a.toUpperCase()];
  $('lkd-bgc').value = lk.bg; $('lkd-project').value = lk.project; $('lkd-artist').value = lk.artist;
  for (const [k] of LK_FIELDS) $('lkd-fd-' + k).checked = !!lk.fields[k];
  $('lkd-c-show').setAttribute('aria-pressed', String(!!lk.show)); $('lkd-c-clay').setAttribute('aria-pressed', String(!!lk.clay));
  $('lkd-c-burn').setAttribute('aria-pressed', String(!!lk.burn)); $('lkd-c-refs').setAttribute('aria-pressed', String(L.refsOn !== false));
  $('lkd-e-raster').setAttribute('aria-pressed', String(lk.engine === 'raster')); $('lkd-e-pt').setAttribute('aria-pressed', String(lk.engine === 'pt'));
  $('lkd-pt-st').textContent = lk.engine === 'pt' ? 'on' : 'off';
  $('lkd-c-hq').setAttribute('aria-pressed', String(!!lk.hq)); $('lkd-c-hq').hidden = lk.engine === 'pt';
  lkLightsUI();
}
// what each setting has to redo
function lkChanged(kind) {
  lkSave(); lkUI();
  if (kind === 'env') { lkEnv(); if (lk.engine === 'pt' && L.ptBuilt) { L.tracer.updateEnvironment(); if (L.sun || L.lights.length) L.tracer.updateLights(); lkGo(); } else lkDirty(); }
  else if (kind === 'envbuild') lkEnvBuild();
  else if (kind === 'place') lkPlace(false);
  else if (kind === 'cam') { lkCam(); if (lk.engine === 'pt' && L.ptBuilt) lkPtMoved(true); else lkDirty(); }
  else if (kind === 'refs') { lkRefsPlace(); lkShadowVis(); if (L.ptBuilt) lkPtRebuild(); lkDirty(); }
  else if (kind === 'clay') { lkClay(); if (lk.engine === 'pt' && L.ptBuilt) { L.tracer.updateMaterials(); lkGo(); } else { if (L.ptBuilt) L.ptMats = true; lkDirty(); } }
  else if (kind === 'burn') { lkRefsPlace(); if (lk.engine === 'pt' && L.ptBuilt) lkPtMoved(true); else lkDirty(); }
  else if (kind === 'view') lkDirty();
  else if (kind === 'pt') { if (L.tracer) { L.tracer.bounces = lk.bounces; L.tracer.reset(); } lkGo(); }
  else lkDirty();
}
const bindNum = (id, k, kind, min, max) => $(id).addEventListener('change', () => { const v = +$(id).value; lk[k] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : LK_DEF[k]; lkChanged(kind); });
bindNum('lkd-rot', 'rot', 'env', -360, 360); bindNum('lkd-ev', 'ev', 'view', -10, 10); bindNum('lkd-blur', 'blur', 'env', 0, 1);
bindNum('lkd-lens', 'lens', 'cam', 4, 600); bindNum('lkd-elev', 'elev', 'cam', -30, 80); bindNum('lkd-fill', 'fill', 'cam', 0.3, 2);
bindNum('lkd-v-lens', 'lens', 'cam', 4, 600); bindNum('lkd-v-elev', 'elev', 'cam', -30, 80); bindNum('lkd-v-fill', 'fill', 'cam', 0.3, 2);
bindNum('lkd-v-film', 'film', 'cam', 4, 80); bindNum('lkd-film', 'film', 'cam', 4, 80);
$('lkd-start').addEventListener('change', () => { const v = Math.round(+$('lkd-start').value); lk.start = Number.isFinite(v) ? Math.max(0, Math.min(999999, v)) : LK_DEF.start; lkChanged('burn'); lkStatus(); });
bindNum('lkd-int', 'int', 'env', 0, 20); bindNum('lkd-skyint', 'skyInt', 'envbuild', 0, 20); bindNum('lkd-sunaz', 'sunAz', 'envbuild', -360, 360); bindNum('lkd-sunel', 'sunEl', 'envbuild', -10, 90);
bindNum('lkd-sunint', 'sunInt', 'envbuild', 0, 20); bindNum('lkd-skyt', 'skyT', 'envbuild', 1.7, 10); bindNum('lkd-skyalb', 'skyAlb', 'envbuild', 0, 1);
bindNum('lkd-spp', 'spp', 'pt', 1, 100000); bindNum('lkd-bounces', 'bounces', 'pt', 1, 30); bindNum('lkd-bars', 'bars', 'burn', 0, 1);
// Exposure on the view: a slider (double click: 0, js/panel.js)
$('lkd-v-ev-r').addEventListener('input', e => { lk.ev = Math.round(+e.target.value * 10) / 10; lkChanged('view'); });
for (const a of ['x', 'y', 'z']) $('lkd-off' + a).addEventListener('change', e => { const v = +e.target.value; lk['off' + a.toUpperCase()] = Number.isFinite(v) ? Math.max(-1000, Math.min(1000, v)) : 0; lkChanged('place'); });
$('lkd-off0').onclick = () => { lk.offX = lk.offY = lk.offZ = 0; lkChanged('place'); };
const bindSel = (id, k, kind) => $(id).addEventListener('change', () => { lk[k] = $(id).value; lkChanged(kind); });
bindSel('lkd-view', 'view', 'view'); bindSel('lkd-up', 'up', 'place'); bindSel('lkd-yaw', 'yaw', 'place'); bindSel('lkd-units', 'units', 'place'); bindSel('lkd-dir', 'dir', 'cam');
bindSel('lkd-text', 'text', 'burn'); bindSel('lkd-font', 'font', 'burn'); bindSel('lkd-align', 'align', 'burn'); bindSel('lkd-talign', 'talign', 'burn');
bindSel('lkd-pbsize', 'pbSize', 'none'); $('lkd-logo').addEventListener('change', () => { lk.logo = $('lkd-logo').checked; lkChanged('burn'); }); bindSel('lkd-pbq', 'pbQ', 'none');
$('lkd-aa').addEventListener('change', () => { lk.aa = +$('lkd-aa').value || 1; lkSave(); });
$('lkd-filmp').addEventListener('change', () => { if ($('lkd-filmp').value !== 'custom') { lk.film = +$('lkd-filmp').value; lkChanged('cam'); } });
$('lkd-lm-hl').onclick = () => { lk.lmode = 'hl'; lkSave(); lkUI(); lkHint(); };
$('lkd-lm-orb').onclick = () => { lk.lmode = 'orb'; lkSave(); lkUI(); lkHint(); };
// Nav: the mouse style of the app, the same select as in the other tabs (js/panel.js keeps it)
{
  const sel = $('lkd-navp'), app = $('navp');
  sel.innerHTML = app ? app.innerHTML : '<option value="maya">Maya</option>';
  sel.value = typeof navPreset !== 'undefined' ? navPreset : 'maya';
  sel.onchange = () => { if (app) { app.value = sel.value; app.dispatchEvent(new Event('change')); } sel.blur(); lkHint(); };
  if (app) app.addEventListener('change', () => { sel.value = app.value; });
}
const bindChk = (id, k, kind) => $(id).addEventListener('change', () => { lk[k] = $(id).checked; lkChanged(kind); });
bindChk('lkd-show', 'show', 'env'); bindChk('lkd-chrome', 'chrome', 'refs'); bindChk('lkd-grey', 'grey', 'refs'); bindChk('lkd-chart', 'chart', 'refs');
bindChk('lkd-shadow', 'shadow', 'refs'); bindChk('lkd-dn', 'dn', 'pt'); bindChk('lkd-burn', 'burn', 'burn');
$('lkd-bgc').addEventListener('input', () => { lk.bg = $('lkd-bgc').value; lkChanged('env'); });
for (const [id, k] of [['lkd-skycol', 'skyCol'], ['lkd-gndcol', 'gndCol']]) $(id).addEventListener('input', () => { lk[k] = $(id).value; lkChanged('envbuild'); });
bindSel('lkd-cs', 'cs', 'envbuild');
for (const e of ['hdri', 'colors', 'phys']) $('lkd-env-' + e).onclick = () => { lk.env = e; lkChanged('envbuild'); };
for (const [id, k] of [['lkd-project', 'project'], ['lkd-artist', 'artist']]) $(id).addEventListener('input', () => { lk[k] = $(id).value.slice(0, 60); lkSave(); lkDirty(); });
$('lkd-fields').addEventListener('change', e => { const k = e.target.dataset.k; if (k) { lk.fields[k] = e.target.checked; lkSave(); lkDirty(); } });
$('lkd-hdri').addEventListener('change', () => { lk.hdri = $('lkd-hdri').value; lk.env = 'hdri'; lkSave(); lkUI(); lkLoadHdri(lk.hdri).catch(e => toast('Could not load the HDRI: ' + e.message, true)); });
$('lkd-fh').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const url = URL.createObjectURL(f), ld = /\.exr$/i.test(f.name) ? new THREE.EXRLoader() : new THREE.HDRLoader();
    ld.setDataType(THREE.FloatType);
    const tex = await ld.loadAsync(url);
    URL.revokeObjectURL(url);
    L.userHdri = { raw: lkF32(tex), name: f.name.replace(/\.[^.]+$/, '') }; tex.dispose();
    lk.env = 'hdri';
    const o = $('lkd-hdri').querySelector('option[value="user"]'); o.disabled = false; o.textContent = 'Yours: ' + L.userHdri.name;
    $('lkd-hdri-n').textContent = f.name; lk.hdri = 'user'; lkUI(); lkLoadHdri('user');
  } catch (err) { console.error(err); $('lkd-hdri-n').textContent = 'could not read ' + f.name; }
});
const chip = (id, fn) => $(id).addEventListener('click', fn);
chip('lkd-c-show', () => { lk.show = !lk.show; lkChanged('env'); });
chip('lkd-c-clay', () => { lk.clay = !lk.clay; lkChanged('clay'); });
chip('lkd-c-refs', () => { L.refsOn = L.refsOn === false; lkChanged('refs'); });
chip('lkd-c-burn', () => { lk.burn = !lk.burn; lkChanged('burn'); });
chip('lkd-c-hq', () => { lk.hq = !lk.hq; lkSave(); lkUI(); lkDirty(); });
$('lkd-e-raster').onclick = () => lkEngine('raster'); $('lkd-e-pt').onclick = () => lkEngine('pt');
$('lkd-gpux').onclick = lkGpuClear; lkGpuUI();
$('lkd-nav').onclick = () => lkTool('nav'); $('lkd-meas').onclick = () => lkTool(L.tool === 'measure' ? 'nav' : 'measure');
$('lkd-light').onclick = () => lkTool(L.tool === 'light' ? 'nav' : 'light'); $('lkd-pix').onclick = () => lkTool(L.tool === 'pixel' ? 'nav' : 'pixel');
// Reset view: the turntable camera with the default lens, height and framing
function lkResetView() { for (const k of ['lens', 'elev', 'fill']) lk[k] = LK_DEF[k]; L.free = false; lkBackUI(); lkChanged('cam'); }
$('lkd-reset-view').onclick = lkResetView;
// Reset section: the settings of that section back to their defaults
function lkResetPart(part) {
  for (const k of LK_RESET[part] || []) lk[k] = lkClone(LK_DEF[k]);
  if (part === 'lights') L.lsel = -1;
  lkSave(); lkUI();
  if (part === 'env') lkEnvBuild();
  else if (part === 'lights') lkLightsBuild();
  else if (part === 'model') lkPlace(false);
  else if (part === 'turn') lkChanged('cam');
  else if (part === 'pb') lkStatus();
  else if (part === 'refs') { lkClay(); lkChanged('refs'); }
  else if (part === 'pt') lkChanged('pt');
  else lkChanged('burn');
  toast(`${({ model: 'Model', env: 'Environment', lights: 'Lights', turn: 'Turntable & camera', refs: 'References', pt: 'Path trace', burn: 'Burn-in', pb: 'Playblast' })[part]} back to its defaults`);
}
document.querySelectorAll('#lkdapp [data-lkreset]').forEach(b => { b.onclick = () => lkResetPart(b.dataset.lkreset); });
// the lights: add, select, remove, and the settings of the selected one
document.querySelectorAll('#lkdapp [data-lkadd]').forEach(b => { b.onclick = () => { if (!L.model) { toast('Load a model first'); return; } lkLightAdd(b.dataset.lkadd); }; });
$('lkd-llist').addEventListener('click', e => {
  const del = e.target.closest('[data-ldel]');
  if (del) { lk.lights.splice(+del.dataset.ldel, 1); L.lsel = Math.min(L.lsel, lk.lights.length - 1); lkSave(); lkLightsBuild(); return; }
  const it = e.target.closest('[data-i]'); if (it) { L.lsel = +it.dataset.i; lkLightsUI(); lkOverlay(); }
});
{
  const cur = () => lk.lights[L.lsel];
  const num = (id, k, mn, mx, f = (v) => v) => $(id).addEventListener('change', () => { const li = cur(); if (!li) return; const v = +$(id).value; if (Number.isFinite(v)) li[k] = f(Math.min(mx, Math.max(mn, v))); lkLightsMoved(); });
  num('lkd-l-int', 'int', 0, 1000); num('lkd-l-ev', 'ev', -10, 10); num('lkd-l-az', 'az', -360, 360); num('lkd-l-el', 'el', -90, 90);
  num('lkd-l-dist', 'd', 0.01, 1000, (v) => v / Math.max(L.r, 0.01)); num('lkd-l-size', 'size', 0, 100); num('lkd-l-ang', 'ang', 1, 170); num('lkd-l-pen', 'pen', 0, 1);
  $('lkd-l-col').addEventListener('input', () => { const li = cur(); if (li) { li.col = $('lkd-l-col').value; lkLightsMoved(); } });
  $('lkd-l-sh').addEventListener('change', () => { const li = cur(); if (li) { li.sh = $('lkd-l-sh').checked; lkLightsMoved(); } });
  $('lkd-l-type').addEventListener('change', () => { const li = cur(); if (li) { li.type = $('lkd-l-type').value; lkSave(); lkLightsBuild(); } });
}
$('lkd-back').onclick = lkBack;
$('lkd-remove').onclick = $('lkd-remove2').onclick = (e) => { e.stopPropagation(); lkPlay(false); lkClearModel(); };
for (const id of ['lkd-f', 'lkd-f2']) $(id).addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) lkLoadFiles(fs); });
$('lkd-p-play').onclick = () => lkPlay();
$('lkd-p-first').onclick = () => { lkPlay(false); lkSetFrame(1); };
$('lkd-p-f').addEventListener('input', () => { lkPlay(false); lkSetFrame(+$('lkd-p-f').value); });
$('lkd-pb').onclick = $('lkd-pb2').onclick = () => lkPlayblast();
// drop
{
  const box = $('lkd-box'); let depth = 0;
  box.addEventListener('dragenter', e => { e.preventDefault(); depth++; $('lkd-drop').hidden = false; });
  box.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('lkd-drop').hidden = true; } });
  box.addEventListener('dragover', e => e.preventDefault());
  box.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; $('lkd-drop').hidden = true;
    const files = await lkDropFiles(e.dataTransfer);
    if (files.length) lkLoadFiles(files);
  });
}
// the keys of this tab while it is in front (the ones of the app don't act): Space, N, M, F, Esc, Home, arrows
const lkKeys = (e) => {
  if (!L.on) return;
  if (!$('lkd-pbdlg').hidden) return;
  const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && !/^(checkbox|range|button|color|file|radio)$/.test(t.type));
  if (t && t.closest && t.closest('#mtabs')) return;
  if (typing) return;
  e.stopImmediatePropagation();
  if (e.type !== 'keydown' || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); if (!e.repeat) lkPlay(); }
  else if (k === 'n' || k === 'N') lkTool('nav');
  else if (k === 'm' || k === 'M') lkTool(L.tool === 'measure' ? 'nav' : 'measure');
  else if (k === 'l' || k === 'L') lkTool(L.tool === 'light' ? 'nav' : 'light');
  else if (k === 'i' || k === 'I') lkTool(L.tool === 'pixel' ? 'nav' : 'pixel');
  else if ((k === 'Delete' || k === 'Backspace') && L.tool === 'light' && lk.lights[L.lsel]) { lk.lights.splice(L.lsel, 1); L.lsel = lk.lights.length - 1; lkSave(); lkLightsBuild(); }
  else if (k === 'f' || k === 'F') lkBack();
  else if (k === 'Escape') { if (L.measure && L.mA) { L.mA = L.mB = null; lkOverlay(); } else if (L.tool === 'pixel' && L.px && L.px.a) $('lkd-px-x').click(); else if (L.tool !== 'nav') lkTool('nav'); }
  else if (k === 'Home') { lkPlay(false); lkSetFrame(1); }
  else if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); lkPlay(false); lkSetFrame(L.frame + (k === 'ArrowRight' ? 1 : -1)); }
};
window.addEventListener('keydown', lkKeys, true); window.addEventListener('keyup', lkKeys, true);

// ---------- the tab ----------
let lkStarted = false;
function lkShow(on) {
  if (on === L.on) return;
  L.on = on;
  document.querySelector('.app').hidden = on; $('lkdapp').hidden = !on;
  if (on) {
    if (!lkStarted) {
      lkStarted = true; if (lk.hdri === 'user') lk.hdri = 'studio'; lkUI();
      lkLoadHdri(lk.hdri).catch(e => toast('Could not load the HDRI: ' + e.message, true));
      lkLightsBuild();
    }
    $('lkd-navp').value = typeof navPreset !== 'undefined' ? navPreset : 'maya'; lkHint(); lkStatus();
    if (typeof tlPlay === 'function' && typeof tl !== 'undefined' && tl.playing) tlPlay(false);
    lkFit(); lkDirty();
  } else { lkPlay(false); cancelAnimationFrame(L.raf); L.raf = 0; window.dispatchEvent(new Event('resize')); if (typeof render === 'function') render(); }
}
window.cpLkShow = lkShow;
window.addEventListener('cp-logo', () => { if (lkStarted) { lkUI(); lkDirty(); } });
// for tests
window.LKD = { lk, L, load: lkLoadFiles, dropFiles: lkDropFiles, tool: lkTool, lightAt: lkLightAt, addLight: lkLightAdd, px: lkPxRows, reset: lkResetPart, resetView: lkResetView, frame: lkSetFrame, engine: lkEngine, playblast: lkPlayblast };
})();
