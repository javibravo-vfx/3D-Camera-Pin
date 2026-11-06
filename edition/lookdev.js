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
const LK_FILM_W = 36, LK_ASPECT = 16 / 9;
// ColorChecker Classic, sRGB 8 bit (the 24 patches, row by row)
const LK_CHART = [[115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52]];
const LK_PB_Q = { draft: [16, 3], preview: [64, 4], good: [256, 6], final: [1024, 8] };
const LK_FONT = { monitor: { css: '--f-ui', w: 500, wv: 700, track: 0.07 }, mono: { css: '--f-num', w: 400, wv: 600, track: 0.02 } };
const LK_TEXT = { small: 0.0125, large: 0.016 };
const LK_FIELDS = [['project', 'Project'], ['asset', 'Asset'], ['hdri', 'HDRI'], ['lens', 'Lens'], ['frame', 'Frame'], ['date', 'Date'], ['artist', 'Artist']];
const LK_DEF = { hdri: 'studio', rot: 0, ev: 0, show: true, bg: '#3a3a3a', blur: 0, view: 'aces709', up: 'auto', yaw: 0, units: 'auto', clay: false, offX: 0, offY: 0, offZ: 0,
  chrome: true, grey: true, chart: true, shadow: true, dir: 'ccw', lens: 50, elev: 10, fill: 0.8, engine: 'raster', spp: 512, bounces: 6, dn: true,
  burn: true, project: '', artist: '', fields: { project: true, asset: true, hdri: true, lens: true, frame: true, date: true, artist: false },
  text: 'small', font: 'monitor', align: 'left', talign: 'left', bars: 0.6, pbSize: '1080', pbQ: 'preview' };
const lkSaved = (() => { const v = lsGet('lkd', {}); return v && typeof v === 'object' ? v : {}; })();
const lk = Object.assign({}, LK_DEF, lkSaved, { fields: Object.assign({}, LK_DEF.fields, lkSaved.fields || {}) });
if (!R3_VIEWS.some(v => v[0] === lk.view)) lk.view = LK_DEF.view;
// the model formats (the main file of what is dropped) and what the file pickers take
const LK_MODEL_RE = /\.(glb|gltf|usdz|usdc|usda|usd|fbx|obj|ply)$/i;
const LK_ACCEPT = '.glb,.gltf,.bin,.usdz,.usdc,.usda,.usd,.fbx,.obj,.mtl,.ply,.zip,image/*';
const lkSave = () => { const o = {}; for (const k of Object.keys(LK_DEF)) o[k] = lk[k]; lsSet('lkd', o); };
// runtime
const L = { on: false, frame: 1, playing: false, t0: 0, f0: 1, raf: 0, dirty: true, model: null, modelName: '', fileUnit: 1, root: null, pivot: null,
  r: 1, c: new THREE.Vector3(), free: false, freeCam: null, nav: null, measure: false, mA: null, mB: null, hdriTex: null, hdriName: '', pmrem: null, envMap: null,
  userHdri: null, hdriWs: null, rtB: null, rtD: null, qView: null, tracer: null, ptLib: null, ptBuilt: false, ptBusy: false, pbBusy: false, tris: 0, refs: null, shadowR: null, shadowPT: null, clayMat: null, keyT: 0 };

// ---------- page ----------
const lkIcon = (p) => `<svg viewBox="0 0 24 24">${p}</svg>`;
document.querySelector('.app').insertAdjacentHTML('afterend', `
<div class="lkdapp" id="lkdapp" hidden>
  <div class="viewer lkd-viewer">
    <div class="vbar"><div class="lkd-bar">
      <button class="tool" id="lkd-nav" aria-pressed="true" title="Navigate (N): the Nav mouse style of the app (it leaves the turntable camera; Back to camera returns)" aria-label="Navigate">${lkIcon('<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M17.5 6.2 21 8.3l-1.2 3.6"/><circle cx="12" cy="12" r="1.6"/><path d="M12 3v3M12 18v3"/>')}<kbd>N</kbd></button>
      <button class="tool" id="lkd-meas" aria-pressed="false" title="Measure (M): click two points on the model" aria-label="Measure">${lkIcon('<rect x="2.5" y="8" width="19" height="8" rx="1" transform="rotate(-30 12 12)"/><path d="m7.3 13.9-1-1.7M10.3 12.2l-1.5-2.6M13.3 10.4l-1-1.7M16.3 8.7l-1.5-2.6"/>')}<kbd>M</kbd></button>
      <button class="btn sm primary r3back lkd-back" id="lkd-back" hidden title="The view was moved: this is a free camera. Back to the turntable camera (F); the turntable itself never changed"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.2"/></svg>Back to camera</button>
      <span class="sep"></span>
      <button class="vpchip" id="lkd-c-show" aria-pressed="true" title="Show the HDRI behind the model; hidden, it still lights it (the background color is in Light)">${lkIcon('<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>')}HDRI</button>
      <button class="vpchip" id="lkd-c-clay" aria-pressed="false" title="Clay: a grey material on the whole model">${lkIcon('<path d="M12 3c4 0 7 3 7 7 0 5-3 11-7 11S5 15 5 10c0-4 3-7 7-7z"/>')}Clay</button>
      <button class="vpchip" id="lkd-c-refs" aria-pressed="true" title="References: chrome ball, 18% grey ball and ColorChecker (which ones: References)">${lkIcon('<circle cx="8" cy="12" r="4"/><circle cx="17" cy="12" r="3"/>')}Refs</button>
      <button class="vpchip" id="lkd-c-burn" aria-pressed="true" title="Preview the burn-in of the playblast on the viewport (Burn-in)">${lkIcon('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 8.5h18M3 15.5h18"/>')}Burn-in</button>
      <span class="sep"></span>
      <div class="seg" role="group" aria-label="Engine"><button id="lkd-e-raster" aria-pressed="true" title="Raster: fast; the shadow under the model is a contact shadow">Raster</button><button id="lkd-e-pt" aria-pressed="false" title="Path trace: light that really bounces and real shadows (the catcher is an 18% grey floor); it fills in while the view is still">Path trace</button></div>
      <select class="lkd-vt" id="lkd-view" aria-label="Viewer" title="Viewer: how the render goes to the screen, as in 3D Render and the Viewer of the plate (Raster works in ACEScg, Path trace in linear Rec.709). ACES 1.0 · Rec.709 or sRGB: the ACES output transform for that display">${R3_VIEWS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
      <span class="fmt" id="lkd-st">–</span>
    </div>
    <div class="lkd-bar lkd-bar2">
      ${[['lens', 'Lens', 12, 300, 1, 'mm', 'Lens of the turntable camera, full frame (36 mm wide), 16:9 (double click: 50)'],
        ['elev', 'Height', -30, 80, 1, '°', 'Height of the camera: its angle above the centre of the model (double click: 10)'],
        ['fill', 'Framing', 0.3, 1.2, 0.01, '', 'How much of the frame the model takes (double click: 0.8)'],
        ['ev', 'Exp', -6, 6, 0.1, 'EV', 'Exposure, in stops (EV), before the Viewer: both engines (double click: 0)']].map(([k, n, mn, mx, st, u, t]) =>
        `<label class="vpchip lkd-vk" title="${t}">${n} <input id="lkd-v-${k}-r" type="range" min="${mn}" max="${mx}" step="${st}" aria-label="${n}"><input id="lkd-v-${k}" class="lkd-vnum" type="number" min="${mn}" max="${mx}" step="${st}" aria-label="${n}${u ? ' (' + u + ')' : ''}">${u ? `<span class="note">${u}</span>` : ''}</label>`).join('')}
    </div></div>
    <div class="lkd-box" id="lkd-box">
      <div class="lkd-frame" id="lkd-frame">
        <canvas id="lkd-gl"></canvas><canvas id="lkd-burncv"></canvas><svg class="lkd-ov" id="lkd-ov"></svg>
        <div class="lkd-mpop" id="lkd-mpop" hidden><span id="lkd-md">–</span><button class="btn sm ghost" id="lkd-mx" title="Clear (Esc)">×</button></div>
      </div>
      <div class="lkd-empty" id="lkd-empty"><b>Drop a 3D model here</b><span class="note">GLB, GLTF, USDZ / USD, FBX, OBJ with its .mtl and images, PLY. A model with its textures apart: drop its whole folder or the ZIP (like the downloads of Sketchfab), or select the files together</span><span class="file btn primary">Load model<input id="lkd-f" type="file" multiple accept="${LK_ACCEPT}"></span></div>
      <p class="lkd-busy" id="lkd-busy" hidden></p>
      <div class="lkd-drop" id="lkd-drop" hidden>Drop the model, its folder or its ZIP</div>
    </div>
    <div class="lkd-play">
      <button class="btn sm ghost" id="lkd-p-first" title="First frame (Home)" aria-label="First frame">${lkIcon('<path d="M6 5v14M18 6l-9 6 9 6z"/>')}</button>
      <button class="btn sm" id="lkd-p-play" title="Play / pause the turntable (Space)" aria-label="Play">${lkIcon('<path d="M8 5l11 7-11 7z"/>')}</button>
      <input type="range" id="lkd-p-f" min="1" max="${LK_N}" step="1" value="1" aria-label="Frame">
      <span class="lkd-pf"><b id="lkd-p-n">1</b> / ${LK_N}</span>
      <span class="note" id="lkd-p-pass">Model turns · 1–${LK_OBJ}</span>
      <span class="note lkd-pfps">${LK_FPS} fps · ${LK_N / LK_FPS} s</span>
      <button class="btn sm" id="lkd-pb" title="Render the turntable to an MP4, with the burn-in" disabled>Playblast</button>
    </div>
  </div>
  <div></div>
  <aside class="props" aria-label="Lookdev settings"><div class="scroll">
    <section class="step" id="lkd-s-model"><h2 tabindex="0">Model<span class="st" id="lkd-model-st">none</span></h2><div class="body">
      <div class="knobrow"><span>File</span><div class="row"><span class="file btn">Load model<input id="lkd-f2" type="file" multiple accept="${LK_ACCEPT}"></span><span class="note" id="lkd-model-n">none</span></div></div>
      <p class="note" id="lkd-model-msg" hidden></p>
      <label class="fld" for="lkd-up">Up axis<select id="lkd-up"><option value="auto">Auto (from the file)</option><option value="y">Y up</option><option value="z">Z up</option><option value="-z">−Z up</option><option value="x">X up</option></select></label>
      <label class="fld" for="lkd-yaw">Facing<select id="lkd-yaw"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>
      <label class="fld" for="lkd-units">File units<select id="lkd-units"><option value="auto">Auto (by size)</option><option value="1">Meters</option><option value="0.01">Centimeters</option><option value="0.001">Millimeters</option><option value="0.0254">Inches</option></select></label>
      <div class="knobrow"><span>Size</span><span class="note" id="lkd-dims">–</span></div>
      <div class="knobrow" title="Moves the model away from the centre of the turntable, in meters: the camera keeps looking at the centre, so the model turns off-centre"><span>Offset (m)</span><div class="lkd-off">${['X', 'Y', 'Z'].map(a => `<label for="lkd-off${a.toLowerCase()}">${a}<input id="lkd-off${a.toLowerCase()}" type="number" step="0.01"></label>`).join('')}<button class="btn sm ghost" id="lkd-off0" title="No offset">0</button></div></div>
      <div class="row k"><button class="btn sm ghost" id="lkd-remove" disabled>Remove model</button></div>
    </div></section>
    <section class="step" id="lkd-s-light"><h2 tabindex="0">Light<span class="st" id="lkd-light-st"></span></h2><div class="body">
      <label class="fld" for="lkd-hdri">HDRI<select id="lkd-hdri">${LK_HDRIS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}<option value="user" disabled>Your HDRI</option></select></label>
      <div class="knobrow"><span>Your HDRI</span><div class="row"><span class="file btn sm">Load .hdr / .exr<input id="lkd-fh" type="file" accept=".hdr,.exr"></span><span class="note" id="lkd-hdri-n">–</span></div></div>
      <label class="fld" for="lkd-rot">Rotation<input id="lkd-rot" type="number" step="1" min="-180" max="180"></label>
      <label class="fld" for="lkd-ev">Exposure (EV)<input id="lkd-ev" type="number" step="0.1" min="-10" max="10" title="Before the Viewer (the Viewer is on the bar of the view)"></label>
      <div class="knobrow"><label for="lkd-show">Show the HDRI</label><input id="lkd-show" type="checkbox"></div>
      <div class="knobrow"><label for="lkd-bgc">Background</label><div class="row"><input id="lkd-bgc" type="color"><span class="note">when the HDRI is hidden</span></div></div>
      <label class="fld" for="lkd-blur" title="Blur of the HDRI behind the model (Raster)">Blur<input id="lkd-blur" type="number" step="0.05" min="0" max="1"></label>
      <p class="note">Color: the HDRI is linear Rec.709; Raster lights in ACEScg and Path trace in linear Rec.709, and the Viewer on the bar of the view takes it to the screen. HDRIs: a selection of <a href="https://polyhaven.com/hdris" target="_blank" rel="noopener">Poly Haven</a> (CC0), 512 px, for the light. Load one of yours for a sharp background.</p>
    </div></section>
    <section class="step" id="lkd-s-turn"><h2 tabindex="0">Turntable &amp; camera</h2><div class="body">
      <p class="note">Fixed length, always the same: frames 1–${LK_OBJ} the camera and the light orbit the model together (it turns under a fixed light), frames ${LK_OBJ + 1}–${LK_N} the light alone turns 360°, in the same direction. ${LK_FPS} fps, ${LK_N / LK_FPS} s.</p>
      <label class="fld" for="lkd-dir">Direction<select id="lkd-dir"><option value="ccw">Counter-clockwise (seen from above)</option><option value="cw">Clockwise</option></select></label>
      <label class="fld" for="lkd-lens">Lens (mm)<input id="lkd-lens" type="number" step="1" min="12" max="300" title="Full frame, 36 mm wide; 16:9"></label>
      <label class="fld" for="lkd-elev">Camera height (°)<input id="lkd-elev" type="number" step="1" min="-30" max="80" title="Angle of the camera above the model"></label>
      <label class="fld" for="lkd-fill">Framing<input id="lkd-fill" type="number" step="0.05" min="0.3" max="1.2" title="How much of the frame height the model takes"></label>
    </div></section>
    <section class="step" id="lkd-s-refs"><h2 tabindex="0">References</h2><div class="body">
      <div class="knobrow"><label for="lkd-chrome">Chrome ball</label><input id="lkd-chrome" type="checkbox"></div>
      <div class="knobrow"><label for="lkd-grey">18% grey ball</label><input id="lkd-grey" type="checkbox"></div>
      <div class="knobrow"><label for="lkd-chart">ColorChecker</label><input id="lkd-chart" type="checkbox"></div>
      <div class="knobrow"><label for="lkd-shadow">Shadow catcher</label><input id="lkd-shadow" type="checkbox"></div>
      <p class="note">The balls and the chart stay in the lower right corner of the frame. The shadow catcher is a contact shadow in Raster, and in Path trace an 18% grey floor with the real shadows of the HDRI.</p>
    </div></section>
    <section class="step" id="lkd-s-pt"><h2 tabindex="0">Path trace<span class="st" id="lkd-pt-st">off</span></h2><div class="body">
      <label class="fld" for="lkd-spp">Samples<input id="lkd-spp" type="number" step="1" min="1" max="100000" title="On the viewport it stops here"></label>
      <label class="fld" for="lkd-bounces">Bounces<input id="lkd-bounces" type="number" step="1" min="1" max="30"></label>
      <div class="knobrow"><label for="lkd-dn">Denoise</label><input id="lkd-dn" type="checkbox"></div>
    </div></section>
    <section class="step" id="lkd-s-burn"><h2 tabindex="0">Burn-in</h2><div class="body">
      <div class="knobrow"><label for="lkd-burn">Preview on the viewport</label><input id="lkd-burn" type="checkbox"></div>
      <label class="fld" for="lkd-project">Project<input id="lkd-project" type="text" maxlength="60" placeholder="Project"></label>
      <label class="fld" for="lkd-artist">Artist<input id="lkd-artist" type="text" maxlength="60" placeholder="Name"></label>
      <div class="knobrow"><span>Show</span><div class="lkd-fields" id="lkd-fields">${LK_FIELDS.map(([k, n]) => `<label class="row" for="lkd-fd-${k}"><input id="lkd-fd-${k}" type="checkbox" data-k="${k}"> ${n}</label>`).join('')}</div></div>
      <label class="fld" for="lkd-bars">Info bars<input id="lkd-bars" type="number" step="0.05" min="0" max="1" title="Darkness of the bars behind the letters"></label>
      <label class="fld" for="lkd-text">Text size<select id="lkd-text"><option value="small">Small</option><option value="large">Large</option></select></label>
      <label class="fld" for="lkd-font">Font<select id="lkd-font" title="Letters of the info, like a camera monitor"><option value="monitor">Monitor</option><option value="mono">Mono</option></select></label>
      <label class="fld" for="lkd-align">Info align<select id="lkd-align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label class="fld" for="lkd-talign">Title align<select id="lkd-talign"><option value="left">Left</option><option value="center">Center</option></select></label>
    </div></section>
    <section class="step" id="lkd-s-pb"><h2 tabindex="0">Playblast</h2><div class="body">
      <label class="fld" for="lkd-pbsize">Size<select id="lkd-pbsize"><option value="1080">1080p (1920 × 1080)</option><option value="720">720p (1280 × 720)</option></select></label>
      <label class="fld" for="lkd-pbq">Path trace quality<select id="lkd-pbq" title="Samples per frame and bounces, when the engine is Path trace"><option value="draft">Draft · 16 samples, 3 bounces</option><option value="preview">Preview · 64 samples, 4 bounces</option><option value="good">Good · 256 samples, 6 bounces</option><option value="final">Final · 1024 samples, 8 bounces</option><option value="tab">As in Path trace</option></select></label>
      <p class="note">All ${LK_N} frames from the turntable camera, with the engine of the viewport and the burn-in.</p>
      <div class="row k"><button class="btn primary sm" id="lkd-pb2" disabled>Playblast</button></div>
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
function lkView(tex, in709) {
  if (!L.qView) { L.qView = new THREE.FullScreenQuad(new THREE.ShaderMaterial(LK_VIEW_SHADER)); L.qView.material.depthTest = false; }
  const u = L.qView.material.uniforms;
  u.tSrc.value = tex; u.view.value = r3ViewIndex(lk.view); u.exposure.value = r3ExpGain(lk.ev); u.in709.value = in709 ? 1 : 0;
  renderer.setRenderTarget(null); L.qView.render(renderer);
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
const lkVfov = () => 2 * Math.atan((LK_FILM_W / LK_ASPECT) / 2 / lk.lens) * 180 / Math.PI;

// ---------- HDRI ----------
async function lkLoadHdri(name) {
  let tex, label;
  if (name === 'user' && L.userHdri) { tex = L.userHdri.tex; label = L.userHdri.name; }
  else { const ld = new THREE.EXRLoader(); ld.setDataType(THREE.FloatType); tex = await ld.loadAsync(`edition/hdri/${name}.exr`); label = (LK_HDRIS.find(h => h[0] === name) || [name, name])[1]; }
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.LinearSRGBColorSpace;
  if (L.hdriTex && L.hdriTex !== tex && !(L.userHdri && L.hdriTex === L.userHdri.tex)) L.hdriTex.dispose();
  L.hdriTex = tex; L.hdriName = label;
  // Raster: the same HDRI in ACEScg (the path tracer takes it as it is, linear Rec.709)
  if (L.hdriWs) L.hdriWs.dispose();
  L.hdriWs = lkHdriWs(tex);
  if (!L.pmrem) L.pmrem = new THREE.PMREMGenerator(renderer);
  if (L.envMap) L.envMap.dispose();
  L.envMap = L.pmrem.fromEquirectangular(L.hdriWs).texture;
  lkEnv(); if (lk.engine === 'pt' && L.ptBuilt && L.tracer) L.tracer.updateEnvironment(); lkDirty();
}
function lkHdriWs(tex) {
  const im = tex.image, n = im.width * im.height, src = im.data, ch = Math.round(src.length / n), M = R3_709_TO_AP1;
  const half = src instanceof Uint16Array, rd = half ? (i) => THREE.DataUtils.fromHalfFloat(src[i]) : (i) => src[i];
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = rd(i * ch), g = rd(i * ch + 1), b = rd(i * ch + 2), o = i * 4;
    out[o] = M[0] * r + M[1] * g + M[2] * b; out[o + 1] = M[3] * r + M[4] * g + M[5] * b; out[o + 2] = M[6] * r + M[7] * g + M[8] * b; out[o + 3] = 1;
  }
  const t = new THREE.DataTexture(out, im.width, im.height, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace; t.flipY = tex.flipY;
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
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
  $('lkd-light-st').textContent = L.hdriName;
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
  mg.m.onLoad = () => { lkDirty(); if (lk.engine === 'pt') lkPtRebuild(); };
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
  $('lkd-empty').hidden = true; $('lkd-remove').disabled = false; $('lkd-pb').disabled = $('lkd-pb2').disabled = false;
  lkClay(); lkPlace(true);
  if (lk.engine === 'pt') lkPtRebuild();
}
function lkClearModel() {
  if (L.root) { scene.remove(L.root); L.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); }
  L.model = L.root = L.pivot = null; L.tris = 0; L.mA = L.mB = null;
  if (L.shadowR) { scene.remove(L.shadowR); L.shadowR.geometry.dispose(); L.shadowR.material.map && L.shadowR.material.map.dispose(); L.shadowR = null; }
  if (L.shadowPT) { scene.remove(L.shadowPT); L.shadowPT = null; }
  $('lkd-empty').hidden = false; $('lkd-remove').disabled = true; $('lkd-pb').disabled = $('lkd-pb2').disabled = true;
  $('lkd-model-n').textContent = 'none'; $('lkd-model-st').textContent = 'none'; $('lkd-dims').textContent = '–'; $('lkd-model-msg').hidden = true;
  L.ptBuilt = false; lkDirty();
}
function lkApplyImage(file) {
  new THREE.TextureLoader().load(URL.createObjectURL(file), tex => {
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = L.ext !== 'glb' && L.ext !== 'gltf';
    const m = lkWs(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
    L.model.traverse(o => { if (o.isMesh) { o.material = o.userData.lkMat = m; } });
    lkClay(); lkDirty(); if (lk.engine === 'pt') lkPtRebuild();
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
  if (lk.engine === 'pt' && L.ptBuilt) lkPtRebuild();
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
      if (tr.samples < lk.spp) more = true;
      lkStatus();
    } else more = false;
  } else if (L.dirty) {
    lkRasterDraw();
    lkStatus();
  }
  L.dirty = false;
  lkBurnPreview(); lkMeasureDraw();
  if (more) lkGo();
}
function lkStatus() {
  const f = L.frame, pass = f <= LK_OBJ ? 'model turns' : 'light turns';
  let t = L.model ? `${Math.round(L.tris).toLocaleString('en-US')} tris · ${L.hdriName}` : 'no model';
  if (lk.engine === 'pt' && L.tracer && L.ptBuilt) { const n = Math.floor(L.tracer.samples); t += ` · ${n >= lk.spp ? 'done' : n < L.tracer.minSamples ? 'preview' : 'rendering'} ${n} / ${lk.spp}`; }
  if (L.free) t += ' · free camera';
  $('lkd-st').textContent = t;
  $('lkd-p-pass').textContent = f <= LK_OBJ ? `Model turns · 1–${LK_OBJ}` : `Light turns · ${LK_OBJ + 1}–${LK_N}`;
  void pass;
}
function lkSetFrame(f, playing) {
  f = Math.max(1, Math.min(LK_N, Math.round(f)));
  if (f === L.frame && !playing) return;
  L.frame = f; $('lkd-p-f').value = f; $('lkd-p-n').textContent = f;
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
async function lkPtRebuild() {
  if (lk.engine !== 'pt' || !L.model || L.ptBusy) return;
  L.ptBusy = true;
  try {
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
      L.dnQuad = dn; L.tracer = tr;
    }
    lkBusy('Building the scene for the path tracer…');
    await new Promise(r => setTimeout(r, 30));
    lkShadowVis(); lkEnv(); lkFit();
    L.tracer.bounces = lk.bounces;
    L.tracer.setScene(scene, cam);
    L.ptBuilt = true;
  } catch (e) { console.error(e); toast('Path tracer: ' + (e.message || e), true); }
  finally { L.ptBusy = false; lkBusy(''); lkGo(); }
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
  tr.updateCamera(); tr.updateEnvironment(); lkGo();
}
function lkEngine(e) {
  lk.engine = e === 'pt' ? 'pt' : 'raster'; lkSave();
  $('lkd-e-raster').setAttribute('aria-pressed', String(lk.engine === 'raster')); $('lkd-e-pt').setAttribute('aria-pressed', String(lk.engine === 'pt'));
  $('lkd-pt-st').textContent = lk.engine === 'pt' ? 'on' : 'off';
  lkShadowVis(); lkEnv(); lkFit();
  if (lk.engine === 'pt') lkPtRebuild(); else { L.ptBuilt = false; lkDirty(); }
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
canvas.addEventListener('pointerdown', e => {
  if (!L.model || nav.act) return;
  let act = NAV[navPreset] && NAV[navPreset].map ? NAV[navPreset].map(e.button, e) : null;
  if (!act) act = e.button === 1 ? 'pan' : e.button === 2 ? 'dolly' : L.measure ? null : 'orbit';
  nav.x = nav.x0 = e.clientX; nav.y = nav.y0 = e.clientY; nav.b = e.button; nav.id = e.pointerId; nav.act = act || 'click';
  canvas.setPointerCapture(e.pointerId); e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
  if (!nav.act || e.pointerId !== nav.id || nav.act === 'click') return;
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
const navEnd = (e) => {
  if (e.pointerId !== nav.id) return;
  const click = nav.act === 'click' || (nav.b === 0 && L.measure && Math.hypot(e.clientX - nav.x0, e.clientY - nav.y0) < 4);
  nav.act = null; nav.id = -1;
  if (click && L.measure && e.type === 'pointerup') lkMeasureClick(e.clientX, e.clientY);
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
function lkMeasureSet(on = !L.measure) {
  L.measure = !!on && !!L.model;
  $('lkd-meas').setAttribute('aria-pressed', String(L.measure)); $('lkd-nav').setAttribute('aria-pressed', String(!L.measure));
  canvas.classList.toggle('measuring', L.measure);
  if (!L.measure) { L.mA = L.mB = null; }
  lkMeasureDraw();
}
function lkMeasureClick(cx, cy) {
  const p = lkPick(cx, cy); if (!p) { toast('Click on the model'); return; }
  // the points are kept in the model's space: they stay on it whatever the camera does
  const loc = L.root.worldToLocal(p.clone());
  if (!L.mA || L.mB) { L.mA = loc; L.mB = null; } else L.mB = loc;
  lkMeasureDraw();
}
function lkMeasureDraw() {
  const ov = $('lkd-ov'), pop = $('lkd-mpop');
  if (!L.measure || !L.mA || !L.root) { ov.innerHTML = ''; pop.hidden = true; return; }
  const w = $('lkd-frame').clientWidth, h = $('lkd-frame').clientHeight;
  const to = (pl) => { const v = L.root.localToWorld(pl.clone()).project(cam); return v.z < 1 ? [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h] : null; };
  const a = to(L.mA), b = L.mB && to(L.mB);
  let s = '';
  if (a && b) s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  for (const q of [a, b]) if (q) s += `<circle cx="${q[0]}" cy="${q[1]}" r="4.5"/>`;
  ov.innerHTML = s;
  pop.hidden = !(a && b);
  if (a && b) {
    const d = L.root.localToWorld(L.mA.clone()).distanceTo(L.root.localToWorld(L.mB.clone()));
    $('lkd-md').textContent = `${d.toFixed(3)} m · ${(d * 100).toFixed(1)} cm`;
    pop.style.left = Math.min(w - 10, Math.max(10, (a[0] + b[0]) / 2)) + 'px'; pop.style.top = Math.min(h - 10, Math.max(10, (a[1] + b[1]) / 2)) + 'px';
  }
}
$('lkd-mx').onclick = () => { L.mA = L.mB = null; lkMeasureDraw(); };

// ---------- burn-in (the letters of VFX Shooting Sup) ----------
function lkBurnRows(f) {
  const F = lk.fields, up = (t) => String(t).toUpperCase();
  const top = [F.project && lk.project, F.asset && (L.modelName || '').replace(/\.[^.]+$/, '')].filter(Boolean).map(up).join('   ·   ');
  const r1 = [], r2 = [];
  if (F.hdri) r1.push(['HDRI', L.hdriName], ['Rot', `${Math.round(lk.rot)}°`], ['EV', (lk.ev >= 0 ? '+' : '') + (+lk.ev).toFixed(1)]);
  if (F.lens) r1.push(['Lens', `${lk.lens} mm`]);
  r1.push(['View', (R3_VIEWS.find(v => v[0] === lk.view) || ['', ''])[1].replace(' (no tone map)', '')]);
  r1.push(['Engine', lk.engine === 'pt' ? 'Path trace' : 'Raster']);
  if (F.frame) r2.push(['Frame', `${String(f).padStart(4, '0')} / ${LK_N}`], ['', f <= LK_OBJ ? 'Model turns' : 'Light turns']);
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
  const rowW = (items, ff) => items.reduce((sum, [l, v], i) => { font(sty.w, ff); const lw = l ? x.measureText(up(l)).width + gapL * ff : 0; font(sty.wv, ff); return sum + lw + x.measureText(up(v)).width + (i ? gapI * ff : 0); }, 0);
  const fitF = (items, max) => { const ww = rowW(items, fs); return ww > max ? Math.max(6, Math.floor(fs * max / ww)) : fs; };
  const at = (ww) => lk.align === 'center' ? (w - ww) / 2 : lk.align === 'right' ? w - pad - ww : pad;
  const drawRow = (items, y, ff) => {
    let cx = at(rowW(items, ff)); x.textAlign = 'left';
    items.forEach(([l, v], i) => {
      if (i) cx += gapI * ff;
      if (l) { font(sty.w, ff); x.fillStyle = 'rgba(255,255,255,0.62)'; x.fillText(up(l), cx, y); cx += x.measureText(up(l)).width + gapL * ff; }
      font(sty.wv, ff); x.fillStyle = '#ffffff'; x.fillText(up(v), cx, y); cx += x.measureText(up(v)).width;
    });
  };
  const bar = (y, hh) => { x.fillStyle = `rgba(0,0,0,${lk.bars})`; x.fillRect(0, y, w, hh); };
  const one = (t, wt, max) => { let ff = fs; font(wt, ff); while (x.measureText(t).width > max && ff > 6) { ff -= 1; font(wt, ff); } };
  x.save(); x.textBaseline = 'middle';
  const th = fs * 2.1; bar(0, th);
  const ctr = lk.talign === 'center';
  x.fillStyle = '#ffffff'; x.textAlign = ctr ? 'center' : 'left'; one(top, sty.wv, ctr ? w * 0.46 : w * 0.7); x.fillText(top, ctr ? w / 2 : pad, th / 2);
  x.textAlign = 'right'; one('LOOKDEV', sty.wv, w * 0.26); x.fillText('LOOKDEV', w - pad, th / 2);
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
  burnCv.hidden = !(lk.burn && L.model);
  if (lk.burn && L.model) lkBurnDraw(x, burnCv.width, burnCv.height, L.frame);
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
async function lkPlayblast() {
  if (!L.model || L.pbBusy) return;
  if (typeof VideoEncoder === 'undefined') { toast('This browser cannot encode video (needs WebCodecs: Chrome, Edge or Safari 17+)', true); return; }
  const W = lk.pbSize === '720' ? 1280 : 1920, H = lk.pbSize === '720' ? 720 : 1080, pt = lk.engine === 'pt';
  const q = pt ? (LK_PB_Q[lk.pbQ] ? { spp: LK_PB_Q[lk.pbQ][0], bounces: LK_PB_Q[lk.pbQ][1] } : { spp: lk.spp, bounces: lk.bounces }) : null;
  lkPlay(false); L.pbBusy = true; pb.cancel = false;
  if (pb.url) { URL.revokeObjectURL(pb.url); pb.url = ''; }
  $('lkd-pbdlg').hidden = false; $('lkd-pb-save').hidden = $('lkd-pb-saveas').hidden = $('lkd-pb-video').hidden = true; $('lkd-pb-x').textContent = 'Cancel';
  $('lkd-pb-bar').style.width = '0';
  $('lkd-pb-info').textContent = `${lkPbName()} · ${LK_N} frames at ${LK_FPS} fps · ${W} × ${H} · ${pt ? `path trace, ${q.spp} samples, ${q.bounces} bounces per frame` : 'raster'} · ${(R3_VIEWS.find(v => v[0] === lk.view) || ['', ''])[1]}${lk.burn ? ' · burn-in' : ''}`;
  const keep = { frame: L.frame, free: L.free, pos: cam.position.clone(), quat: cam.quaternion.clone() };
  const out = document.createElement('canvas'); out.width = W; out.height = H; const ctx = out.getContext('2d');
  let enc = null; const t0 = performance.now();
  const tr = L.tracer, trKeep = tr && { d: tr.renderDelay, l: tr.dynamicLowRes, m: tr.minSamples, b: tr.bounces };
  try {
    await lkPbLoadMuxer();
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    L.free = false;
    if (pt) { tr.renderDelay = 0; tr.dynamicLowRes = false; tr.minSamples = 1; tr.bounces = q.bounces; tr.reset(); }
    const bitrate = Math.min(60e6, Math.max(4e6, W * H * LK_FPS * 0.12));
    let muxer = null, lastErr = null, used = '';
    for (const [codec, mux] of LK_PB_CANDS) {
      const sup = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: LK_FPS }).catch(() => null);
      if (!sup || !sup.supported) continue;
      if (mux === 'avc' && lastErr && lastErr.fallback === 'vp9') continue;
      try {
        muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: mux, width: W, height: H, frameRate: LK_FPS }, fastStart: 'in-memory' });
        let encErr = null, first = true;
        enc = new VideoEncoder({
          output: (chunk, meta) => {
            if (encErr) return;
            try {
              if (first) {
                first = false; meta = meta || {};
                const dc = meta.decoderConfig;
                if (mux === 'avc' && !(dc && dc.description)) { const e = new Error('H.264 without decoder description'); e.fallback = 'vp9'; throw e; }
                meta = { ...meta, decoderConfig: { codec, codedWidth: W, codedHeight: H, ...(dc || {}), colorSpace: (dc && dc.colorSpace && dc.colorSpace.primaries) ? dc.colorSpace : LK_PB_CS } };
              }
              muxer.addVideoChunk(chunk, meta);
            } catch (e) { encErr = e; }
          },
          error: e => { encErr = encErr || e; },
        });
        enc.configure(Object.assign({ codec, width: W, height: H, bitrate, framerate: LK_FPS }, mux === 'avc' ? { avc: { format: 'avc' } } : {}));
        for (let f = 1; f <= LK_N; f++) {
          if (pb.cancel) throw new Error('cancelled');
          if (encErr) throw encErr;
          L.frame = f; lkCam();
          if (pt) {
            lkPtMoved(true); tr.reset(); tr.pausePathTracing = false;
            let t = performance.now();
            while (tr.samples < q.spp) {
              if (pb.cancel) throw new Error('cancelled');
              lkPtSample();
              if (performance.now() - t > 40) { await new Promise(r => setTimeout(r, 0)); t = performance.now(); }
            }
          } else lkRasterDraw();
          ctx.drawImage(canvas, 0, 0, W, H);
          if (lk.burn) lkBurnDraw(ctx, W, H, f);
          const fr = new VideoFrame(out, { timestamp: Math.round((f - 1) * 1e6 / LK_FPS), duration: Math.round(1e6 / LK_FPS) });
          enc.encode(fr, { keyFrame: (f - 1) % LK_FPS === 0 }); fr.close();
          while (enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 5));
          if (encErr) throw encErr;
          const per = (performance.now() - t0) / 1000 / f, left = per * (LK_N - f);
          $('lkd-pb-bar').style.width = (f / LK_N * 100).toFixed(1) + '%';
          $('lkd-pb-st').textContent = `Frame ${f} / ${LK_N} · ${per.toFixed(2)} s per frame · ${left >= 90 ? Math.round(left / 60) + ' min' : Math.round(left) + ' s'} left`;
          if (!pt && f % 4 === 0) await new Promise(r => setTimeout(r, 0));
        }
        await enc.flush();
        if (encErr) throw encErr;
        muxer.finalize(); used = mux; lastErr = null;
        break;
      } catch (e) {
        try { if (enc && enc.state !== 'closed') enc.close(); } catch (_) { /* closed */ }
        if (e && e.message === 'cancelled') throw e;
        console.warn('lookdev playblast encoder', codec, e); lastErr = e; muxer = null;
      }
    }
    if (!muxer) throw lastErr || new Error(`no video encoder for ${W} × ${H} here: try 720p`);
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    pb.url = URL.createObjectURL(blob); pb.blob = blob;
    const v = $('lkd-pb-video'); v.src = pb.url; v.hidden = false; v.play().catch(() => {});
    $('lkd-pb-save').hidden = false; $('lkd-pb-saveas').hidden = !!window.bplDesktop || !(window.showSaveFilePicker && window.self === window.top);
    const info = `${lkPbName()} · ${(blob.size / 1048576).toFixed(1)} MB · ${used === 'vp9' ? 'VP9 (this browser has no usable H.264: plays in browsers, VLC and Resolve, not QuickTime)' : 'H.264'} · ${((performance.now() - t0) / 1000).toFixed(0)} s`;
    $('lkd-pb-st').textContent = info;
    const where = await lkPbSave(blob, lkPbName());
    $('lkd-pb-st').textContent = `${info} · ${where}`;
  } catch (e) {
    $('lkd-pb-st').textContent = e.message === 'cancelled' ? 'Cancelled.' : 'The playblast failed: ' + (e.message || e);
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
$('lkd-pb-x').onclick = () => { if (L.pbBusy) pb.cancel = true; else $('lkd-pbdlg').hidden = true; };
$('lkd-pbdlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); $('lkd-pb-x').click(); } });

// ---------- controls ----------
function lkBusy(t) { $('lkd-busy').hidden = !t; $('lkd-busy').textContent = t || ''; }
function lkUI() {
  $('lkd-hdri').value = lk.hdri === 'user' && !L.userHdri ? 'studio' : lk.hdri;
  for (const [id, k] of [['lkd-rot', 'rot'], ['lkd-ev', 'ev'], ['lkd-blur', 'blur'], ['lkd-lens', 'lens'], ['lkd-elev', 'elev'], ['lkd-fill', 'fill'], ['lkd-spp', 'spp'], ['lkd-bounces', 'bounces'], ['lkd-bars', 'bars']]) $(id).value = lk[k];
  for (const [id, k] of [['lkd-view', 'view'], ['lkd-up', 'up'], ['lkd-yaw', 'yaw'], ['lkd-units', 'units'], ['lkd-dir', 'dir'], ['lkd-text', 'text'], ['lkd-font', 'font'], ['lkd-align', 'align'], ['lkd-talign', 'talign'], ['lkd-pbsize', 'pbSize'], ['lkd-pbq', 'pbQ']]) $(id).value = String(lk[k]);
  for (const [id, k] of [['lkd-show', 'show'], ['lkd-chrome', 'chrome'], ['lkd-grey', 'grey'], ['lkd-chart', 'chart'], ['lkd-shadow', 'shadow'], ['lkd-dn', 'dn'], ['lkd-burn', 'burn']]) $(id).checked = !!lk[k];
  for (const k of ['lens', 'elev', 'fill', 'ev']) { if (document.activeElement !== $('lkd-v-' + k)) $('lkd-v-' + k).value = lk[k]; $('lkd-v-' + k + '-r').value = lk[k]; }
  for (const a of ['x', 'y', 'z']) $('lkd-off' + a).value = lk['off' + a.toUpperCase()];
  $('lkd-bgc').value = lk.bg; $('lkd-project').value = lk.project; $('lkd-artist').value = lk.artist;
  for (const [k] of LK_FIELDS) $('lkd-fd-' + k).checked = !!lk.fields[k];
  $('lkd-c-show').setAttribute('aria-pressed', String(!!lk.show)); $('lkd-c-clay').setAttribute('aria-pressed', String(!!lk.clay));
  $('lkd-c-burn').setAttribute('aria-pressed', String(!!lk.burn)); $('lkd-c-refs').setAttribute('aria-pressed', String(L.refsOn !== false));
  $('lkd-e-raster').setAttribute('aria-pressed', String(lk.engine === 'raster')); $('lkd-e-pt').setAttribute('aria-pressed', String(lk.engine === 'pt'));
  $('lkd-pt-st').textContent = lk.engine === 'pt' ? 'on' : 'off';
}
// what each setting has to redo
function lkChanged(kind) {
  lkSave(); lkUI();
  if (kind === 'env') { lkEnv(); if (lk.engine === 'pt' && L.ptBuilt) { L.tracer.updateEnvironment(); lkGo(); } else lkDirty(); }
  else if (kind === 'place') lkPlace(false);
  else if (kind === 'cam') { lkCam(); if (lk.engine === 'pt' && L.ptBuilt) lkPtMoved(true); else lkDirty(); }
  else if (kind === 'refs') { lkRefsPlace(); lkShadowVis(); if (lk.engine === 'pt' && L.ptBuilt) lkPtRebuild(); else lkDirty(); }
  else if (kind === 'clay') { lkClay(); if (lk.engine === 'pt' && L.ptBuilt) { L.tracer.updateMaterials(); lkGo(); } else lkDirty(); }
  else if (kind === 'burn') { lkRefsPlace(); if (lk.engine === 'pt' && L.ptBuilt) lkPtMoved(true); else lkDirty(); }
  else if (kind === 'view') lkDirty();
  else if (kind === 'pt') { if (L.tracer) { L.tracer.bounces = lk.bounces; L.tracer.reset(); } lkGo(); }
  else lkDirty();
}
const bindNum = (id, k, kind, min, max) => $(id).addEventListener('change', () => { const v = +$(id).value; lk[k] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : LK_DEF[k]; lkChanged(kind); });
bindNum('lkd-rot', 'rot', 'env', -360, 360); bindNum('lkd-ev', 'ev', 'view', -10, 10); bindNum('lkd-blur', 'blur', 'env', 0, 1);
bindNum('lkd-lens', 'lens', 'cam', 12, 300); bindNum('lkd-elev', 'elev', 'cam', -30, 80); bindNum('lkd-fill', 'fill', 'cam', 0.3, 1.2);
bindNum('lkd-spp', 'spp', 'pt', 1, 100000); bindNum('lkd-bounces', 'bounces', 'pt', 1, 30); bindNum('lkd-bars', 'bars', 'burn', 0, 1);
// on the view: Lens, Height, Framing and Exp, a slider and its number (the same settings as Turntable & camera / Light)
{
  const VK = { lens: ['cam', 12, 300, 50], elev: ['cam', -30, 80, 10], fill: ['cam', 0.3, 1.2, 0.8], ev: ['view', -10, 10, 0] };
  for (const [k, [kind, mn, mx, d]] of Object.entries(VK)) {
    const set = (v) => { v = +v; lk[k] = Number.isFinite(v) ? Math.min(mx, Math.max(mn, k === 'lens' || k === 'elev' ? Math.round(v) : Math.round(v * 100) / 100)) : LK_DEF[k]; lkChanged(kind); };
    $('lkd-v-' + k + '-r').addEventListener('input', e => set(e.target.value));
    $('lkd-v-' + k + '-r').addEventListener('dblclick', () => set(d));
    $('lkd-v-' + k).addEventListener('change', e => set(e.target.value));
  }
}
for (const a of ['x', 'y', 'z']) $('lkd-off' + a).addEventListener('change', e => { const v = +e.target.value; lk['off' + a.toUpperCase()] = Number.isFinite(v) ? Math.max(-1000, Math.min(1000, v)) : 0; lkChanged('place'); });
$('lkd-off0').onclick = () => { lk.offX = lk.offY = lk.offZ = 0; lkChanged('place'); };
const bindSel = (id, k, kind) => $(id).addEventListener('change', () => { lk[k] = $(id).value; lkChanged(kind); });
bindSel('lkd-view', 'view', 'view'); bindSel('lkd-up', 'up', 'place'); bindSel('lkd-yaw', 'yaw', 'place'); bindSel('lkd-units', 'units', 'place'); bindSel('lkd-dir', 'dir', 'cam');
bindSel('lkd-text', 'text', 'burn'); bindSel('lkd-font', 'font', 'burn'); bindSel('lkd-align', 'align', 'burn'); bindSel('lkd-talign', 'talign', 'burn');
bindSel('lkd-pbsize', 'pbSize', 'none'); bindSel('lkd-pbq', 'pbQ', 'none');
const bindChk = (id, k, kind) => $(id).addEventListener('change', () => { lk[k] = $(id).checked; lkChanged(kind); });
bindChk('lkd-show', 'show', 'env'); bindChk('lkd-chrome', 'chrome', 'refs'); bindChk('lkd-grey', 'grey', 'refs'); bindChk('lkd-chart', 'chart', 'refs');
bindChk('lkd-shadow', 'shadow', 'refs'); bindChk('lkd-dn', 'dn', 'pt'); bindChk('lkd-burn', 'burn', 'burn');
$('lkd-bgc').addEventListener('input', () => { lk.bg = $('lkd-bgc').value; lkChanged('env'); });
for (const [id, k] of [['lkd-project', 'project'], ['lkd-artist', 'artist']]) $(id).addEventListener('input', () => { lk[k] = $(id).value.slice(0, 60); lkSave(); lkDirty(); });
$('lkd-fields').addEventListener('change', e => { const k = e.target.dataset.k; if (k) { lk.fields[k] = e.target.checked; lkSave(); lkDirty(); } });
$('lkd-hdri').addEventListener('change', () => { lk.hdri = $('lkd-hdri').value; lkSave(); lkLoadHdri(lk.hdri).catch(e => toast('Could not load the HDRI: ' + e.message, true)); });
$('lkd-fh').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const url = URL.createObjectURL(f);
    const tex = /\.exr$/i.test(f.name) ? await new THREE.EXRLoader().loadAsync(url) : await new THREE.HDRLoader().loadAsync(url);
    URL.revokeObjectURL(url);
    if (L.userHdri) L.userHdri.tex.dispose();
    L.userHdri = { tex, name: f.name.replace(/\.[^.]+$/, '') };
    const o = $('lkd-hdri').querySelector('option[value="user"]'); o.disabled = false; o.textContent = 'Yours: ' + L.userHdri.name;
    $('lkd-hdri-n').textContent = f.name; lk.hdri = 'user'; lkUI(); lkLoadHdri('user');
  } catch (err) { console.error(err); $('lkd-hdri-n').textContent = 'could not read ' + f.name; }
});
const chip = (id, fn) => $(id).addEventListener('click', fn);
chip('lkd-c-show', () => { lk.show = !lk.show; lkChanged('env'); });
chip('lkd-c-clay', () => { lk.clay = !lk.clay; lkChanged('clay'); });
chip('lkd-c-refs', () => { L.refsOn = L.refsOn === false; lkChanged('refs'); });
chip('lkd-c-burn', () => { lk.burn = !lk.burn; lkChanged('burn'); });
$('lkd-e-raster').onclick = () => lkEngine('raster'); $('lkd-e-pt').onclick = () => lkEngine('pt');
$('lkd-nav').onclick = () => lkMeasureSet(false); $('lkd-meas').onclick = () => lkMeasureSet();
$('lkd-back').onclick = lkBack;
$('lkd-remove').onclick = () => { lkPlay(false); lkClearModel(); };
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
  else if (k === 'n' || k === 'N') lkMeasureSet(false);
  else if (k === 'm' || k === 'M') lkMeasureSet();
  else if (k === 'f' || k === 'F') lkBack();
  else if (k === 'Escape') { if (L.measure && L.mA) { L.mA = L.mB = null; lkMeasureDraw(); } else if (L.measure) lkMeasureSet(false); }
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
    if (!lkStarted) { lkStarted = true; lkUI(); lkLoadHdri(lk.hdri === 'user' ? 'studio' : lk.hdri).catch(e => toast('Could not load the HDRI: ' + e.message, true)); }
    if (typeof tlPlay === 'function' && typeof tl !== 'undefined' && tl.playing) tlPlay(false);
    lkFit(); lkDirty();
  } else { lkPlay(false); cancelAnimationFrame(L.raf); L.raf = 0; window.dispatchEvent(new Event('resize')); if (typeof render === 'function') render(); }
}
window.cpLkShow = lkShow;
// for tests
window.LKD = { lk, L, load: lkLoadFiles, dropFiles: lkDropFiles, frame: lkSetFrame, engine: lkEngine, playblast: lkPlayblast };
})();
