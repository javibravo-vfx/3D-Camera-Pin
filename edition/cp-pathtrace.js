// 3D Camera Pin edition: the Path Trace tab (three-gpu-pathtracer, from vendor/, loaded only when the tab is opened) on a
// copy of the scene, the environment and the camera of 3D Camera Pin | Environment. It is a tab of the module bar
// (edition/cp-edition.js adds it) with its own page in place of the app: the scene of the app is only read, never changed.
(() => {
const $ = (id) => document.getElementById(id);
// what this tab reads from the app (its globals: js/core.js, js/navigation.js, js/timeline.js, js/exr.js)
const PTB = { scene, camera, scanRoot, envRoot, sun, nav, st, tl, plateImg, NAV, onFrame: null,
  get platecv() { return $('platecv'); }, tlPlay: (...a) => tlPlay(...a), render: () => render(), exr: () => exrState, navPreset: () => navPreset };
// the timeline moves the environment here too (only the positions: the BVH is refit)
{ const f = tlSet; tlSet = function (...a) { const r = f(...a); if (PTB.onFrame) PTB.onFrame(); return r; }; }
document.querySelector('.app').insertAdjacentHTML('afterend', `<div class="ptapp" id="ptapp" hidden>
  <div class="viewer pt-viewer">
    <div class="vbar">
      <div class="vrow pt-bar">
        <button class="btn primary sm" id="pt-update" title="Copy the scan, the environment, the sun and the camera from Camera Pin again">Update from Camera Pin</button>
        <button class="btn sm" id="pt-pause" aria-pressed="false" title="Pause / resume the samples">Pause</button>
        <button class="btn sm" id="pt-restart" title="Throw the samples away and start again">Restart</button>
        <button class="btn sm" id="pt-save" title="Save the current render as a PNG (with alpha when the background is not the sky)">Save PNG</button>
        <button class="btn sm" id="pt-pb" title="Render the frame range path traced to an MP4, with quality presets">Playblast</button>
        <button class="btn ghost sm" id="pt-camreset" title="Put the camera back where Camera Pin has it">Camera Pin view</button>
        <span class="fmt" id="pt-st">–</span>
      </div>
    </div>
    <div class="pt-box" id="pt-box">
      <div class="pt-frame" id="pt-frame">
        <img class="pt-plate" id="pt-plate" alt="" hidden>
        <canvas id="pt-gl"></canvas>
      </div>
      <p class="pt-msg" id="pt-msg" hidden></p>
    </div>
    <div id="pt-tlslot"></div>
    <div class="ibar"><span class="hint" id="pt-hint"></span></div>
  </div>
  <div></div>
  <aside class="props" aria-label="Path trace settings">
    <div class="scroll">
      <section class="step" id="pt-s-render">
        <h2 tabindex="0">Render<span class="st" id="pt-st2"></span></h2>
        <div class="body">
          <label class="fld" for="pt-target">Samples
            <input type="number" id="pt-target" min="1" max="100000" step="1" value="512" title="It stops here">
          </label>
          <label class="fld" for="pt-bounces">Bounces
            <input type="number" id="pt-bounces" min="1" max="30" step="1" value="5">
          </label>
          <label class="fld" for="pt-scale">Resolution
            <select id="pt-scale" title="Size of the render: the width of 720p or 1080p with the height of the plate aspect. On screen it is scaled to fit the view.">
              <option value="720" selected>720p (1280 wide)</option>
              <option value="1080">1080p (1920 wide)</option>
              <option value="plate">Plate size</option>
            </select>
          </label>
          <label class="fld" for="pt-tiles">Tiles
            <select id="pt-tiles" title="More tiles: the page keeps responding with heavy scenes, each sample takes longer to show">
              <option value="1">1 × 1</option>
              <option value="2" selected>2 × 2</option>
              <option value="3">3 × 3</option>
              <option value="4">4 × 4</option>
            </select>
          </label>
          <div class="knobrow"><span>Denoise</span>
            <div class="row nowrap"><input type="checkbox" id="pt-dn" checked><input type="range" id="pt-dn-s" min="1" max="10" step="0.5" value="5" title="Denoise strength"></div>
          </div>
          <label class="fld" for="pt-glossy">Glossy filter
            <input type="number" id="pt-glossy" min="0" max="1" step="0.05" value="0.5" title="Blurs very sharp reflections of small lights: fewer fireflies, a bit less sharp">
          </label>
        </div>
      </section>
      <section class="step" id="pt-s-light">
        <h2 tabindex="0">Light</h2>
        <div class="body">
          <label class="fld" for="pt-env">Environment
            <select id="pt-env"><option value="sky">Sky colors</option><option value="hdri">HDRI</option></select>
          </label>
          <div class="knobrow" id="pt-skyrow"><span>Sky / ground</span>
            <div class="row nowrap"><input type="color" id="pt-sky" value="#dfe8f2"><input type="color" id="pt-gnd" value="#3a3328"></div>
          </div>
          <div class="knobrow" id="pt-hdrirow" hidden><span>HDRI</span>
            <div class="row"><span class="file btn sm">Load .hdr / .exr<input id="pt-f-hdri" type="file" accept=".hdr,.exr"></span><span class="note" id="pt-hdri-n">none</span></div>
          </div>
          <label class="fld" for="pt-envi">Sky intensity
            <input type="number" id="pt-envi" min="0" max="20" step="0.05" value="1">
          </label>
          <label class="fld" for="pt-envr">Sky rotation
            <input type="number" id="pt-envr" min="-180" max="180" step="1" value="0">
          </label>
          <label class="fld" for="pt-suni">Sun intensity
            <input type="number" id="pt-suni" min="0" max="20" step="0.05" value="1" title="× the sun of Camera Pin">
          </label>
          <label class="fld" for="pt-exp">Exposure
            <input type="number" id="pt-exp" min="-10" max="10" step="0.1" value="0" title="Stops">
          </label>
          <label class="fld" for="pt-tm">Tone map
            <select id="pt-tm"><option value="linear">None</option><option value="aces">ACES Filmic</option><option value="agx">AgX</option><option value="neutral">Neutral</option></select>
          </label>
        </div>
      </section>
      <section class="step" id="pt-s-scene">
        <h2 tabindex="0">Scene</h2>
        <div class="body">
          <label class="fld" for="pt-bg">Background
            <select id="pt-bg"><option value="sky">Sky</option><option value="plate">Plate</option><option value="none">Transparent</option></select>
          </label>
          <div class="knobrow"><span>Ground plane</span>
            <div class="row nowrap"><input type="checkbox" id="pt-floor"><input type="number" id="pt-floor-y" step="0.01" value="0" title="Height (m)"></div>
          </div>
          <div class="knobrow"><span>Depth of field</span>
            <div class="row nowrap"><input type="checkbox" id="pt-dof"><input type="number" id="pt-fstop" min="0.5" max="64" step="0.1" value="2.8" title="f-stop"></div>
          </div>
          <label class="fld" for="pt-focus">Focus distance
            <input type="number" id="pt-focus" min="0.01" step="0.01" value="3" title="Meters from the camera">
          </label>
          <div class="row k"><button class="btn sm" id="pt-focus-c" title="Focus on what is under the center of the frame">Focus center</button><button class="btn ghost sm" id="pt-reset">Reset</button></div>
          <p class="note" id="pt-note">The camera, the scan and the environment come from 3D Camera Pin | Environment. The camera can be moved here with the Nav preset of Camera Pin (it renders coarse while it moves and completes when it stops); <b>Camera Pin view</b> puts it back. The timeline moves the environment here too. A change to the scan or the environment in Camera Pin needs <b>Update from Camera Pin</b>.</p>
        </div>
      </section>
    </div>
  </aside>
</div>`);
// ---------- the tab ----------
let ptTab = '', ptTlHome = null;
function ptShow(on) {
  if (on === (ptTab === 'pathtrace')) return;
  ptTab = on ? 'pathtrace' : '';
  document.querySelector('.app').hidden = on; $('ptapp').hidden = !on;
  // the timeline bar goes with the tab in front (the same controls)
  const bar = $('tlbar');
  if (!ptTlHome) { ptTlHome = document.createComment('tlbar'); bar.parentNode.insertBefore(ptTlHome, bar); }
  if (on) { $('pt-tlslot').replaceWith(bar); bar.dataset.inpt = '1'; }
  else if (bar.dataset.inpt) { const slot = document.createElement('div'); slot.id = 'pt-tlslot'; bar.replaceWith(slot); ptTlHome.parentNode.insertBefore(bar, ptTlHome.nextSibling); delete bar.dataset.inpt; }
  if (on) { if (tl.playing) tlPlay(false); ptEnter(); }
  else { ptLeave(); window.dispatchEvent(new Event('resize')); render(); }
}
window.cpPtShow = ptShow;
// the shortcuts of the app (Space, W/A/S/D, F…) do not act while this tab is in front
const ptKeyGuard = (e) => {
  if (ptTab !== 'pathtrace') return;
  if (!$('pt-pbdlg').hidden) return; // the Playblast dialog keeps its keys (Esc)
  const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && !/^(checkbox|range|button)$/.test(t.type));
  if (t && t.closest && t.closest('#mtabs')) return; // the arrows of the tab bar
  e.stopImmediatePropagation();
  // Space: play / pause
  if (e.type === 'keydown' && e.code === 'Space' && !typing && !e.repeat) { e.preventDefault(); tlPlay(); }
};
window.addEventListener('keydown', ptKeyGuard, true); window.addEventListener('keyup', ptKeyGuard, true);

// ---------- state ----------
const PT_DEF = { target: 512, bounces: 5, scale: '720', tiles: '2', dn: true, dnS: 5, glossy: 0.5, env: 'sky', sky: '#dfe8f2', gnd: '#3a3328', envI: 1, envR: 0,
  sunI: 1, exp: 0, tm: 'linear', bg: 'sky', floor: false, floorY: 0, dof: false, fstop: 2.8, focus: 3 };
const pt = Object.assign({}, PT_DEF, { lib: null, links: [], redraw: false, renderer: null, tracer: null, scene: null, cam: null, paused: false, raf: 0, built: false, busy: false,
  hdri: null, hdriName: '', gradient: null, denoise: null, tris: 0, t0: 0, plateURL: '' });
const UI = [['target', 'pt-target', 'n'], ['bounces', 'pt-bounces', 'n'], ['scale', 'pt-scale', 's'], ['tiles', 'pt-tiles', 's'], ['dn', 'pt-dn', 'b'], ['dnS', 'pt-dn-s', 'n'],
  ['glossy', 'pt-glossy', 'n'], ['env', 'pt-env', 's'], ['sky', 'pt-sky', 's'], ['gnd', 'pt-gnd', 's'], ['envI', 'pt-envi', 'n'], ['envR', 'pt-envr', 'n'], ['sunI', 'pt-suni', 'n'],
  ['exp', 'pt-exp', 'n'], ['tm', 'pt-tm', 's'], ['bg', 'pt-bg', 's'], ['floor', 'pt-floor', 'b'], ['floorY', 'pt-floor-y', 'n'], ['dof', 'pt-dof', 'b'], ['fstop', 'pt-fstop', 'n'], ['focus', 'pt-focus', 'n']];
function uiFromState() { for (const [k, id, t] of UI) { const el = $(id); if (t === 'b') el.checked = !!pt[k]; else el.value = pt[k]; } $('pt-skyrow').hidden = pt.env !== 'sky'; $('pt-hdrirow').hidden = pt.env !== 'hdri'; }
// what each control has to redo: 'scene' rebuilds the copy, 'env' the sky, 'light' the lights, 'cam' the camera, 'out' only the final image
const UI_KIND = { target: 'go', bounces: 'mat', scale: 'size', tiles: 'mat', dn: 'out', dnS: 'out', glossy: 'mat', env: 'env', sky: 'env', gnd: 'env', envI: 'env', envR: 'env', sunI: 'light',
  exp: 'out', tm: 'out', bg: 'env', floor: 'scene', floorY: 'scene', dof: 'cam', fstop: 'cam', focus: 'cam' };
for (const [k, id, t] of UI) {
  $(id).addEventListener(t === 'n' ? 'change' : 'input', () => {
    const el = $(id); const v = t === 'b' ? el.checked : t === 'n' ? (Number.isFinite(+el.value) ? +el.value : PT_DEF[k]) : el.value;
    pt[k] = v; uiFromState(); ptApply(UI_KIND[k]);
  });
}
uiFromState();
// the panels of this tab start open (the Camera Pin ones start collapsed)
document.querySelectorAll('#ptapp .step > h2').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('closed')));

const msg = (t, bad) => { const m = $('pt-msg'); m.hidden = !t; m.textContent = t || ''; m.classList.toggle('bad', !!bad); };
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

// ---------- the library, only when needed ----------
async function ptLib() {
  if (pt.lib) return pt.lib;
  msg('Loading the path tracer…');
  const [gpt, pass] = await Promise.all([import('three-gpu-pathtracer'), import('three/addons/postprocessing/Pass.js')]);
  pt.lib = { gpt, FullScreenQuad: pass.FullScreenQuad };
  return pt.lib;
}
function ptInit() {
  const { gpt, FullScreenQuad } = pt.lib;
  const r = new THREE.WebGLRenderer({ canvas: $('pt-gl'), antialias: false, alpha: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace; r.setClearColor(0x000000, 0);
  pt.renderer = r;
  const tr = new gpt.WebGLPathTracer(r);
  // while the camera moves or the timeline plays: a quarter-size image of one sample; when it stops it fills in
  tr.renderDelay = 80; tr.fadeDuration = 200; tr.minSamples = 2; tr.dynamicLowRes = true; tr.lowResScale = 0.25; tr.rasterizeScene = false;
  tr.textureSize.set(2048, 2048);
  pt.denoise = new FullScreenQuad(new gpt.DenoiseMaterial({ map: null, blending: THREE.NoBlending, premultipliedAlpha: r.getContextAttributes().premultipliedAlpha }));
  tr.renderToCanvasCallback = (target, renderer, quad) => {
    const ac = renderer.autoClear; renderer.autoClear = false;
    if (pt.dn) { const m = pt.denoise.material; m.map = target.texture; m.sigma = pt.dnS; m.threshold = 0.03; m.kSigma = 1; m.opacity = quad.material.opacity; pt.denoise.render(renderer); }
    else quad.render(renderer);
    renderer.autoClear = ac;
  };
  // the coarse image while moving also goes through the denoise, so it reads as a soft preview and not as dots
  { const q = tr._quad, qr = q.render.bind(q);
    q.render = (renderer) => {
      if (pt.dn && q.material.map === tr._lowResPathTracer.target.texture) { const m = pt.denoise.material; m.map = q.material.map; m.sigma = pt.dnS; m.opacity = 1; pt.denoise.render(renderer); }
      else qr(renderer);
    }; }
  pt.tracer = tr;
  pt.gradient = new gpt.GradientEquirectTexture(256);
  new ResizeObserver(() => ptFit()).observe($('pt-box'));
}

// ---------- copy of the Camera Pin scene ----------
// materials: the Camera Pin ones are display materials (Lambert / Phong / Basic, colors written as screen values);
// here they become physical ones, with the colors and the color textures read as sRGB
function ptMaterial(m, tint) {
  const o = new THREE.MeshStandardMaterial();
  o.color.copy(m.color || new THREE.Color(1, 1, 1)).convertSRGBToLinear();
  if (tint) o.color.multiply(tint);
  if (m.map) { o.map = m.map.clone(); o.map.colorSpace = THREE.SRGBColorSpace; o.map.needsUpdate = true; }
  if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) { o.emissive.copy(m.emissive).convertSRGBToLinear(); o.emissiveIntensity = m.emissiveIntensity ?? 1; }
  if (m.emissiveMap) { o.emissiveMap = m.emissiveMap.clone(); o.emissiveMap.colorSpace = THREE.SRGBColorSpace; o.emissiveMap.needsUpdate = true; }
  if (m.isMeshStandardMaterial) { o.roughness = m.roughness; o.metalness = m.metalness; o.roughnessMap = m.roughnessMap; o.metalnessMap = m.metalnessMap; o.normalMap = m.normalMap; }
  else if (m.isMeshPhongMaterial) { o.roughness = Math.max(0.15, Math.min(1, Math.sqrt(2 / ((m.shininess || 30) + 2)) * 1.6)); o.metalness = 0; }
  else { o.roughness = 1; o.metalness = 0; }
  if (m.isMeshBasicMaterial) { o.emissive.copy(o.color); o.emissiveMap = o.map; o.color.setRGB(0, 0, 0); } // unlit: it gives its own light
  o.side = m.side; o.vertexColors = !!m.vertexColors;
  o.transparent = !!m.transparent && (m.opacity ?? 1) < 1; o.opacity = m.opacity ?? 1; o.alphaMap = m.alphaMap || null;
  return o;
}
// the geometry with what the path tracer merges: normals and, if the material uses them, the vertex colors as RGBA linear
// (mixing 3- and 4-component colors breaks the merge)
const geoCache = new Map();
function ptGeometry(g, wantColor) {
  const key = g.uuid + (wantColor ? 'c' : '');
  if (geoCache.has(key)) return geoCache.get(key);
  const o = new THREE.BufferGeometry();
  for (const n of ['position', 'normal', 'uv']) if (g.attributes[n]) o.setAttribute(n, g.attributes[n]);
  if (g.index) o.setIndex(g.index);
  o.groups = g.groups.map(x => Object.assign({}, x));
  if (!o.attributes.normal) o.computeVertexNormals();
  const c = g.attributes.color;
  if (wantColor && c) {
    const n = c.count, a = new Float32Array(n * 4), s = c.normalized ? 1 : 1;
    for (let i = 0; i < n; i++) {
      const col = new THREE.Color(c.getX(i) * s, c.getY(i) * s, c.getZ(i) * s).convertSRGBToLinear();
      a[i * 4] = col.r; a[i * 4 + 1] = col.g; a[i * 4 + 2] = col.b; a[i * 4 + 3] = c.itemSize === 4 ? c.getW(i) : 1;
    }
    o.setAttribute('color', new THREE.BufferAttribute(a, 4));
  }
  geoCache.set(key, o);
  return o;
}
const matCache = new Map();
function ptMat(m, tint) {
  const key = m.uuid + (tint ? tint.getHexString() : '');
  if (!matCache.has(key)) matCache.set(key, ptMaterial(m, tint));
  return matCache.get(key);
}
function addCopy(dst, o, matrix, tint) {
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if (mats.some(m => !m || m.isShaderMaterial || m.isRawShaderMaterial || m.isPointsMaterial || m.isLineBasicMaterial || m.wireframe)) return 0;
  const pm = mats.map(m => ptMat(m, tint));
  const mesh = new THREE.Mesh(ptGeometry(o.geometry, mats.some(m => m.vertexColors)), Array.isArray(o.material) ? pm : pm[0]);
  mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix);
  dst.add(mesh);
  if (ptLinks) ptLinks.push([mesh, o, ptInst]);
  const g = o.geometry; return (g.index ? g.index.count : g.attributes.position.count) / 3;
}
function copyRoot(dst, root) {
  let tris = 0;
  if (!root || !root.visible) return 0;
  root.updateMatrixWorld(true);
  const im = new THREE.Matrix4(), mw = new THREE.Matrix4(), ic = new THREE.Color();
  root.traverseVisible(o => {
    if (!o.isMesh || o.isPoints || !o.geometry || !o.geometry.attributes.position) return;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, im); mw.multiplyMatrices(o.matrixWorld, im);
        let tint = null; if (o.instanceColor) { o.getColorAt(i, ic); tint = ic.clone().convertSRGBToLinear(); }
        ptInst = i; tris += addCopy(dst, o, mw, tint);
      }
    } else { ptInst = -1; tris += addCopy(dst, o, o.matrixWorld); }
  });
  return tris;
}
// the environment copies remember their originals, so the timeline only moves them (the BVH is refit, not rebuilt)
let ptLinks = null, ptInst = -1;
function ptFrame() {
  if (!pt.built || !pt.links.length || ptTab !== 'pathtrace' || pt.pbBusy) return;
  ptRefit(); pt.tracer.reset(); ptGo();
}
function ptRefit() {
  if (!pt.links.length) return;
  PTB.envRoot.updateMatrixWorld(true);
  const im = new THREE.Matrix4();
  for (const [mesh, o, i] of pt.links) {
    if (i < 0) mesh.matrix.copy(o.matrixWorld);
    else { o.getMatrixAt(i, im); mesh.matrix.multiplyMatrices(o.matrixWorld, im); }
  }
  pt.scene.updateMatrixWorld(true);
  const tr = pt.tracer, res = tr._generator.generate(), m = tr._pathTracer.material;
  if (res.bvhChanged) {
    const a = res.geometry.attributes;
    m.bvh.updateFrom(res.bvh); m.attributesArray.updateFrom(a.normal, a.tangent, a.uv, a.color);
  }
  if (res.needsMaterialIndexUpdate) m.materialIndexAttribute.updateFrom(res.geometry.attributes.materialIndex);
}
function ptBuildScene() {
  geoCache.clear(); matCache.forEach(m => m.dispose()); matCache.clear();
  const sc = new THREE.Scene();
  let tris = 0;
  // the scan: the meshes with their own materials (not the solid / wire / flat display of Camera Pin)
  const scan = new THREE.Group();
  PTB.scanRoot.updateMatrixWorld(true);
  PTB.scanRoot.traverse(o => { if (o.isMesh && o.userData.orig) { o.userData._ptm = o.material; o.material = o.userData.orig; } });
  tris += copyRoot(scan, PTB.scanRoot);
  PTB.scanRoot.traverse(o => { if (o.userData._ptm) { o.material = o.userData._ptm; delete o.userData._ptm; } });
  sc.add(scan);
  ptLinks = []; tris += copyRoot(sc, PTB.envRoot); pt.links = ptLinks; ptLinks = null;
  if (pt.floor) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: lin('#808080'), roughness: 0.9 }));
    f.position.y = pt.floorY; sc.add(f); tris += 2;
  }
  // the sun of Camera Pin (a directional light pointing at its target)
  const s = PTB.sun; s.updateMatrixWorld(true);
  const sun = new THREE.DirectionalLight(s.color.clone().convertSRGBToLinear(), s.intensity);
  sun.position.copy(s.getWorldPosition(new THREE.Vector3())); sun.target.position.copy(s.target.getWorldPosition(new THREE.Vector3()));
  sun.userData.base = s.intensity;
  sc.add(sun, sun.target);
  pt.sun = sun;
  pt.scene = sc; pt.tris = tris;
}
// the camera: the Camera Pin one as it is (position, rotation, field of view, plate aspect), as a physical camera for the depth of field
function ptCamera(pose) {
  const { gpt } = pt.lib, c = PTB.camera, st = PTB.st;
  if (!pt.cam) { pt.cam = new gpt.PhysicalCamera(); pose = true; }
  const cam = pt.cam;
  if (pose) { cam.position.copy(c.position); cam.quaternion.copy(c.quaternion); ptPivot(); }
  cam.fov = c.fov; cam.aspect = c.aspect; cam.near = Math.max(c.near, 0.01); cam.far = Math.max(c.far, 5000); cam.zoom = 1; cam.clearViewOffset();
  cam.filmGauge = st.sw || 36; cam.setFocalLength(cam.getFocalLength()); // keep the field of view, set the film back for the f-stop
  cam.focusDistance = pt.focus; cam.apertureBlades = 0;
  cam.fStop = pt.dof ? pt.fstop : Infinity; // f-stop: aperture = focal length / f-stop (mm), as in the lens
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  return cam;
}
function ptEnv() {
  const sc = pt.scene, g = pt.gradient;
  let env;
  if (pt.env === 'hdri' && pt.hdri) env = pt.hdri;
  else {
    g.topColor.copy(lin(pt.sky)); g.bottomColor.copy(lin(pt.gnd)); g.exponent = 1; g.update(); env = g;
  }
  // the hemisphere light of Camera Pin as a sky: 0.85 × π of light from the colors gives 0.85 of radiance
  sc.environment = env; sc.environmentIntensity = pt.envI * (pt.env === 'hdri' && pt.hdri ? 1 : 0.85);
  sc.environmentRotation.set(0, pt.envR * Math.PI / 180, 0); sc.backgroundRotation.copy(sc.environmentRotation);
  sc.background = pt.bg === 'sky' ? env : null; sc.backgroundIntensity = sc.environmentIntensity;
  $('pt-frame').classList.toggle('sky', pt.bg === 'sky');
  ptPlate();
}
function ptPlate() {
  const im = $('pt-plate');
  if (pt.bg !== 'plate') { im.hidden = true; return; }
  let src = '';
  const cv = PTB.platecv;
  if (cv && !cv.hidden && cv.width) { try { src = cv.toDataURL('image/png'); } catch (e) { src = ''; } }
  else if (PTB.plateImg.complete && PTB.plateImg.naturalWidth) src = PTB.plateImg.src;
  if (src && im.src !== src) im.src = src;
  im.hidden = !src;
}
function ptOut() {
  const r = pt.renderer;
  r.toneMapping = { linear: THREE.LinearToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping }[pt.tm] || THREE.LinearToneMapping;
  r.toneMappingExposure = Math.pow(2, pt.exp);
  // the output shaders change with the tone map
  pt.denoise.material.needsUpdate = true; pt.tracer._quad.material.needsUpdate = true;
}

// ---------- size: the frame has the plate aspect and fits the viewer ----------
function ptAspect() { return PTB.camera.aspect || 1.5; }
function ptSize() {
  const pl = PTB.st.plate, a = ptAspect();
  const W = pt.scale === 'plate' && pl && pl.W ? Math.round(pl.W * (PTB.st.par > 0 ? PTB.st.par : 1)) : pt.scale === '1080' ? 1920 : 1280;
  return [W, Math.max(2, Math.round(W / a))];
}
function ptFit() {
  if (!pt.renderer || ptTab !== 'pathtrace' || pt.pbBusy) return;
  const box = $('pt-box'), bw = box.clientWidth - 16, bh = box.clientHeight - 16;
  if (bw < 10 || bh < 10) return;
  const a = ptAspect();
  let w = bw, h = bw / a; if (h > bh) { h = bh; w = bh * a; }
  w = Math.floor(w); h = Math.floor(h);
  const fr = $('pt-frame'); fr.style.width = w + 'px'; fr.style.height = h + 'px';
  // the render has a fixed size (720p or 1080p wide, or the plate) and is only scaled on screen
  const [W, H] = ptSize(), r = pt.renderer, cur = r.getSize(new THREE.Vector2());
  pt.tracer.renderScale = 1;
  if (cur.x !== W || cur.y !== H || r.getPixelRatio() !== 1) { r.setPixelRatio(1); r.setSize(W, H, false); pt.tracer.reset(); }
  ptGo();
}

// ---------- apply and loop ----------
function ptApply(kind) {
  if (!pt.built) return;
  const tr = pt.tracer;
  if (kind === 'scene') { ptRebuild(false); return; }
  if (kind === 'mat') { tr.bounces = pt.bounces; tr.filterGlossyFactor = pt.glossy; const n = +pt.tiles || 1; tr.tiles.set(n, n); tr.reset(); }
  if (kind === 'env') { ptEnv(); tr.updateEnvironment(); }
  if (kind === 'light') { pt.sun.intensity = pt.sun.userData.base * pt.sunI; tr.updateLights(); }
  if (kind === 'cam') { ptCamera(); tr.updateCamera(); }
  if (kind === 'out') { ptOut(); }
  if (kind === 'size') { ptFit(); return; }
  if (kind === 'out') pt.redraw = true;
  ptGo();
}
function ptDrawOnce() {
  // draw the samples there are again (tone map, exposure, denoise) without adding one
  const tr = pt.tracer, q = tr._quad;
  if (!tr.samples) return;
  pt.renderer.setRenderTarget(null); pt.renderer.clear();
  q.material.map = tr._pathTracer.target.texture; q.material.opacity = 1;
  tr.renderToCanvasCallback(tr._pathTracer.target, pt.renderer, q);
}
function ptGo() { if (!pt.raf && pt.built && ptTab === 'pathtrace' && !pt.pbBusy) pt.raf = requestAnimationFrame(ptLoop); }
function ptLoop() {
  pt.raf = 0;
  if (ptTab !== 'pathtrace' || !pt.built) return;
  const tr = pt.tracer;
  // it always draws (the coarse image, the fade in, a new tone map); it only adds samples when not paused and not done
  tr.pausePathTracing = pt.paused || tr.samples >= pt.target;
  if (!tr.samples) pt.t0 = performance.now();
  pt.redraw = false;
  try { tr.renderSample(); } catch (e) { msg('Render failed: ' + (e.message || e), true); console.error(e); return; }
  ptStatus();
  if (!pt.paused && (tr.samples < pt.target || tr._quad.material.opacity < 1)) pt.raf = requestAnimationFrame(ptLoop);
}
function ptStatus() {
  const tr = pt.tracer, n = Math.floor(tr.samples), r = pt.renderer, v = new THREE.Vector2(); r.getDrawingBufferSize(v);
  const sz = `${v.x}×${v.y}`;
  const sec = n ? ((performance.now() - pt.t0) / 1000) : 0;
  const state = tr.isCompiling ? 'compiling shaders…' : pt.paused ? 'paused' : n >= pt.target ? 'done' : n < tr.minSamples ? 'preview' : 'rendering';
  $('pt-st').textContent = `${n} / ${pt.target} samples · ${state} · ${sz} · ${pt.tris.toLocaleString('en-US')} tris${n && state === 'done' ? '' : n ? ` · ${sec.toFixed(1)} s` : ''}`;
  $('pt-st2').textContent = state === 'done' ? 'done' : n ? n + ' spp' : '';
}

async function ptRebuild(copyPose = true) {
  if (pt.busy) return;
  pt.busy = true;
  try {
    await ptLib();
    if (!pt.renderer) ptInit();
    msg('Building the scene (BVH)…');
    await new Promise(r => setTimeout(r, 30)); // let the message paint: the build blocks the page
    ptBuildScene();
    if (!pt.tris) { pt.built = false; msg('Nothing to render: load a scan or turn an environment on in Camera Pin.'); $('pt-st').textContent = '–'; return; }
    const cam = ptCamera(copyPose);
    ptEnv(); ptOut();
    pt.sun.intensity = pt.sun.userData.base * pt.sunI;
    const tr = pt.tracer;
    tr.bounces = pt.bounces; tr.filterGlossyFactor = pt.glossy; { const n = +pt.tiles || 1; tr.tiles.set(n, n); }
    tr.setScene(pt.scene, cam);
    pt.built = true; msg('');
    ptFit();
  } catch (e) {
    console.error(e);
    pt.built = false;
    msg(/Failed to fetch|import|module/i.test(String(e && e.message)) ? 'The path tracer could not be loaded (it comes from the internet the first time): ' + e.message : 'Path tracer error: ' + (e.message || e), true);
  } finally { pt.busy = false; }
}
function ptEnter() { ptNavHint(); if (!pt.built) ptRebuild(true); else { ptFrame(); ptFit(); ptGo(); } }
function ptLeave() { cancelAnimationFrame(pt.raf); pt.raf = 0; }

$('pt-update').addEventListener('click', () => ptRebuild(true));
$('pt-camreset').addEventListener('click', () => { if (!pt.built) return; ptCamera(true); pt.tracer.updateCamera(); ptGo(); });

// ---------- moving the camera here: the Nav preset of Camera Pin (orbit / pan / dolly / look), wheel to dolly ----------
const ptNav = { act: null, x: 0, y: 0, target: new THREE.Vector3(), id: -1 };
// the pivot: the Camera Pin one if it is in front of the camera, otherwise a point at the focus distance
function ptPivot() {
  const cam = pt.cam, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), t = PTB.nav.target.clone();
  const d = t.clone().sub(cam.position).dot(fwd);
  ptNav.target.copy(d > 0.05 ? t : cam.position.clone().addScaledVector(fwd, pt.focus || 3));
}
function ptNavHint() { const id = PTB.navPreset(), p = PTB.NAV[id]; $('pt-hint').textContent = !p ? '' : 'Camera: ' + (id === 'game' ? 'RMB: look · MMB: pan · wheel: forward' : p.hint) + ' · Space: play'; }
function ptMoved() { const cam = pt.cam; cam.updateMatrixWorld(true); if (pt.paused) { pt.paused = false; $('pt-pause').setAttribute('aria-pressed', 'false'); $('pt-pause').textContent = 'Pause'; } pt.tracer.updateCamera(); ptGo(); }
function ptRotate(cam, dx, dy, around) {
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const q = new THREE.Quaternion().setFromAxisAngle(up, -dx * 0.005).multiply(new THREE.Quaternion().setFromAxisAngle(right, -dy * 0.005));
  if (around) { cam.position.sub(around).applyQuaternion(q).add(around); }
  else { const off = ptNav.target.clone().sub(cam.position).applyQuaternion(q); ptNav.target.copy(cam.position).add(off); }
  cam.quaternion.premultiply(q);
}
function ptDolly(cam, k) {
  const off = cam.position.clone().sub(ptNav.target), d = off.length();
  const nd = Math.max(0.05, d * k);
  if (nd <= 0.05 && k < 1) { // past the pivot: push it ahead
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(fwd, d * (1 - k)); ptNav.target.addScaledVector(fwd, d * (1 - k)); return;
  }
  cam.position.copy(ptNav.target).addScaledVector(off.normalize(), nd);
}
const ptCv = $('pt-gl');
ptCv.addEventListener('contextmenu', e => e.preventDefault());
ptCv.addEventListener('pointerdown', e => {
  if (!pt.built || ptNav.act) return;
  const p = PTB.NAV[PTB.navPreset()], act = p && p.map(e.button, e);
  if (!act) return;
  e.preventDefault();
  ptNav.act = act; ptNav.x = e.clientX; ptNav.y = e.clientY; ptNav.id = e.pointerId;
  ptCv.setPointerCapture(e.pointerId);
});
ptCv.addEventListener('pointermove', e => {
  if (!ptNav.act || e.pointerId !== ptNav.id) return;
  const dx = e.clientX - ptNav.x, dy = e.clientY - ptNav.y; ptNav.x = e.clientX; ptNav.y = e.clientY;
  if (!dx && !dy) return;
  const cam = pt.cam;
  if (ptNav.act === 'orbit') ptRotate(cam, dx, dy, ptNav.target);
  else if (ptNav.act === 'look') ptRotate(cam, dx, dy, null);
  else if (ptNav.act === 'pan') {
    const d = cam.position.distanceTo(ptNav.target), h = $('pt-frame').clientHeight || 500;
    const k = 2 * d * Math.tan(cam.fov * Math.PI / 360) / h;
    const mv = new THREE.Vector3(-dx * k, dy * k, 0).applyQuaternion(cam.quaternion);
    cam.position.add(mv); ptNav.target.add(mv);
  } else if (ptNav.act === 'dolly') ptDolly(cam, Math.exp((dy - dx) * 0.01));
  ptMoved();
});
const ptNavEnd = (e) => { if (e.pointerId !== ptNav.id) return; ptNav.act = null; ptNav.id = -1; };
ptCv.addEventListener('pointerup', ptNavEnd); ptCv.addEventListener('pointercancel', ptNavEnd); ptCv.addEventListener('lostpointercapture', ptNavEnd);
ptCv.addEventListener('wheel', e => {
  if (!pt.built) return;
  e.preventDefault();
  ptDolly(pt.cam, Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0015)); ptMoved();
}, { passive: false });
PTB.onFrame = ptFrame;
$('pt-restart').addEventListener('click', () => { if (!pt.built) return; pt.tracer.reset(); ptGo(); });
$('pt-pause').addEventListener('click', () => { pt.paused = !pt.paused; $('pt-pause').setAttribute('aria-pressed', String(pt.paused)); $('pt-pause').textContent = pt.paused ? 'Resume' : 'Pause'; if (pt.built) { ptStatus(); ptGo(); } });
$('pt-save').addEventListener('click', () => {
  if (!pt.built || !pt.tracer.samples) return;
  ptDrawOnce();
  const a = document.createElement('a'); a.download = `pathtrace_${Math.floor(pt.tracer.samples)}spp.png`; a.href = $('pt-gl').toDataURL('image/png'); a.click();
});
$('pt-reset').addEventListener('click', () => { Object.assign(pt, PT_DEF); uiFromState(); if (pt.built) ptRebuild(); });
$('pt-focus-c').addEventListener('click', () => {
  if (!pt.built) return;
  const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), pt.cam);
  const hit = rc.intersectObjects(pt.scene.children, true).find(h => h.object.isMesh);
  if (!hit) return;
  pt.focus = +hit.distance.toFixed(3); uiFromState(); ptApply('cam');
});
$('pt-f-hdri').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const url = URL.createObjectURL(f);
    let tex;
    if (/\.exr$/i.test(f.name)) tex = await new THREE.EXRLoader().loadAsync(url);
    else { const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js'); tex = await new HDRLoader().loadAsync(url); }
    URL.revokeObjectURL(url);
    tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.LinearSRGBColorSpace;
    if (pt.hdri) pt.hdri.dispose();
    pt.hdri = tex; pt.hdriName = f.name; $('pt-hdri-n').textContent = f.name;
    pt.env = 'hdri'; uiFromState(); ptApply('env');
  } catch (err) { console.error(err); $('pt-hdri-n').textContent = 'could not read ' + f.name; }
});
// ---------- Playblast of the path trace: Camera Pin's Playblast asks for each frame here ----------
// quality presets: samples per frame and bounces; 'tab' uses what the Render panel has
const PT_PB_Q = { draft: [16, 3], preview: [64, 4], good: [256, 5], final: [1024, 8] };
const PTPB = {
  plate: () => pt.bg === 'plate',
  aspect: ptAspect,
  scale: () => pt.scale,
  quality(q) { const v = PT_PB_Q[q]; return v ? { spp: v[0], bounces: v[1] } : { spp: pt.target, bounces: pt.bounces }; },
  begin(W, H, q) {
    const tr = pt.tracer, r = pt.renderer;
    cancelAnimationFrame(pt.raf); pt.raf = 0; pt.pbBusy = true;
    pt.pbKeep = { delay: tr.renderDelay, fade: tr.fadeDuration, low: tr.dynamicLowRes, min: tr.minSamples };
    r.setPixelRatio(1); r.setSize(W, H, false); tr.renderScale = 1;
    tr.renderDelay = 0; tr.fadeDuration = 0; tr.dynamicLowRes = false; tr.minSamples = 1; tr.pausePathTracing = false;
    tr.bounces = q.bounces;
  },
  // one frame: move the environment to it (Camera Pin already set the frame), sample up to spp, return the canvas
  async frame(spp, cancelled) {
    const tr = pt.tracer;
    ptRefit(); tr.reset();
    let t = performance.now();
    while (tr.samples < spp) {
      if (cancelled()) throw new Error('cancelled');
      tr.renderSample();
      if (performance.now() - t > 40) { await new Promise(r => setTimeout(r, 0)); t = performance.now(); } // let the page breathe
    }
    pt.renderer.getContext().finish();
    return $('pt-gl');
  },
  end() {
    const tr = pt.tracer, k = pt.pbKeep;
    if (k) { tr.renderDelay = k.delay; tr.fadeDuration = k.fade; tr.dynamicLowRes = k.low; tr.minSamples = k.min; }
    tr.bounces = pt.bounces; pt.pbBusy = false; pt.pbKeep = null;
    pt.renderer.setSize(1, 1, false); // ptFit sets it again
    ptRefit(); tr.reset(); ptFit(); ptGo();
  },
};


// ---------- Playblast of the path trace: the frame range, path traced frame by frame, to an MP4 ----------
document.body.insertAdjacentHTML('beforeend', `<div class="start" id="pt-pbdlg" role="dialog" aria-modal="true" aria-labelledby="pt-pb-t" hidden>
  <div class="start-card pt-pbcard">
    <b id="pt-pb-t">Path trace playblast</b>
    <label class="fld" for="pt-pb-size">Size
      <select id="pt-pb-size"><option value="720">720p (1280 wide)</option><option value="1080">1080p (1920 wide)</option><option value="plate">Plate size</option></select></label>
    <label class="fld" for="pt-pb-q">Quality
      <select id="pt-pb-q" title="Samples per frame and bounces">
        <option value="draft">Draft · 16 samples, 3 bounces</option>
        <option value="preview" selected>Preview · 64 samples, 4 bounces</option>
        <option value="good">Good · 256 samples, 5 bounces</option>
        <option value="final">Final · 1024 samples, 8 bounces</option>
        <option value="tab">As in the Render panel</option>
      </select></label>
    <p class="note" id="pt-pb-info"></p>
    <div class="pt-pbbar" id="pt-pb-prog" hidden><i id="pt-pb-bar"></i></div>
    <p class="note" id="pt-pb-st" hidden></p>
    <video id="pt-pb-video" controls muted playsinline hidden></video>
    <div class="start-btns"><button class="btn primary" id="pt-pb-go">Render MP4</button><a class="btn" id="pt-pb-save" hidden>Save MP4</a><button class="btn ghost" id="pt-pb-x">Close</button></div>
  </div></div>`);
const ptpb = { busy: false, cancel: false, url: '' };
function ptPbDims() {
  const v = $('pt-pb-size').value, pl = st.plate, even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const W = v === 'plate' && pl && pl.W ? pl.W * (st.par > 0 ? st.par : 1) : v === '1080' ? 1920 : 1280;
  return { W: even(W), H: even(W / ptAspect()) };
}
function ptPbName() { const n = (st.plate && !st.plate.empty && !st.plate.sample && st.plate.name) || 'shot'; return n.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') + '_pathtrace.mp4'; }
function ptPbInfo() {
  const d = ptPbDims(), n = tl.end - tl.start + 1, q = PTPB.quality($('pt-pb-q').value);
  $('pt-pb-info').textContent = `${ptPbName()} · frames ${tl.start}–${tl.end} (${n}) at ${tl.fps} fps · ${d.W} × ${d.H} · ${q.spp} samples, ${q.bounces} bounces per frame. Each frame is path traced with the camera and the settings of this tab (light, background, denoise, tone map), so it takes a while: the time per frame shows while it renders.`;
}
function ptPbOpen() {
  if (!pt.built) { msg('Open the tab and let the scene build first'); return; }
  $('pt-pb-size').value = pt.scale; ptPbInfo();
  $('pt-pb-prog').hidden = $('pt-pb-st').hidden = $('pt-pb-video').hidden = $('pt-pb-save').hidden = true;
  $('pt-pb-go').hidden = false; $('pt-pb-go').textContent = 'Render MP4'; $('pt-pb-x').textContent = 'Close';
  $('pt-pbdlg').hidden = false; $('pt-pb-go').focus();
}
function ptPbLoadMuxer() {
  if (window.Mp4Muxer) return Promise.resolve();
  return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/mp4-muxer.js'; sc.onload = res; sc.onerror = () => rej(new Error('Could not load the MP4 muxer')); document.head.appendChild(sc); });
}
async function ptPbCodec(W, H, fps, bitrate) {
  const c = [['avc1.640033', 'avc'], ['avc1.4d0033', 'avc'], ['avc1.42003e', 'avc'], ['vp09.00.50.08', 'vp9'], ['av01.0.08M.08', 'av1']];
  for (const [codec, mux] of c) { try { const s = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: fps }); if (s.supported) return { codec, mux }; } catch (e) { /* the next one */ } }
  return null;
}
async function ptPbRun() {
  if (ptpb.busy) return;
  if (typeof VideoEncoder === 'undefined') { $('pt-pb-st').hidden = false; $('pt-pb-st').textContent = 'This browser cannot encode video (WebCodecs): use Chrome or Edge.'; return; }
  ptpb.busy = true; ptpb.cancel = false;
  const { W, H } = ptPbDims(), fps = tl.fps, n = tl.end - tl.start + 1, keep = tl.frame, q = PTPB.quality($('pt-pb-q').value);
  const bitrate = Math.round(W * H * fps * 0.15);
  $('pt-pb-go').hidden = true; $('pt-pb-x').textContent = 'Cancel'; $('pt-pb-prog').hidden = $('pt-pb-st').hidden = false; $('pt-pb-video').hidden = $('pt-pb-save').hidden = true;
  if (ptpb.url) { URL.revokeObjectURL(ptpb.url); ptpb.url = ''; }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
  let encoder = null, err = null;
  if (tl.playing) tlPlay(false);
  PTPB.begin(W, H, q);
  const t0 = performance.now();
  try {
    await ptPbLoadMuxer();
    const cd = await ptPbCodec(W, H, fps, bitrate);
    if (!cd) throw new Error('no video codec for ' + W + ' × ' + H);
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: Object.assign({ codec: cd.mux, width: W, height: H }, Number.isInteger(fps) ? { frameRate: fps } : {}), fastStart: 'in-memory' });
    encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { err = e; } });
    encoder.configure({ codec: cd.codec, width: W, height: H, bitrate, framerate: fps });
    for (let i = 0; i < n; i++) {
      if (ptpb.cancel) throw new Error('cancelled');
      if (err) throw err;
      tl.frame = tl.start + i; applyMotion();
      const src = await PTPB.frame(q.spp, () => ptpb.cancel);
      ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (PTPB.plate()) { const pc = $('platecv'), el = pc && !pc.hidden ? pc : plateImg.complete && plateImg.naturalWidth ? plateImg : null; if (el) ctx.drawImage(el, 0, 0, W, H); }
      ctx.drawImage(src, 0, 0, W, H);
      const fr = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(fr, { keyFrame: i % Math.max(1, Math.round(fps)) === 0 }); fr.close();
      while (encoder.encodeQueueSize > 2) await new Promise(r => setTimeout(r, 5));
      const per = (performance.now() - t0) / 1000 / (i + 1), left = per * (n - i - 1);
      $('pt-pb-bar').style.width = ((i + 1) / n * 100).toFixed(1) + '%';
      $('pt-pb-st').textContent = `Frame ${i + 1} / ${n} · ${per.toFixed(1)} s per frame · ${left >= 90 ? Math.round(left / 60) + ' min' : Math.round(left) + ' s'} left`;
    }
    await encoder.flush(); if (err) throw err;
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    ptpb.url = URL.createObjectURL(blob);
    const a = $('pt-pb-save'); a.href = ptpb.url; a.download = ptPbName(); a.hidden = false; a.click();
    const v = $('pt-pb-video'); v.src = ptpb.url; v.hidden = false;
    $('pt-pb-st').textContent = `${ptPbName()} · ${n} frames · ${(blob.size / 1048576).toFixed(1)} MB · ${cd.mux.toUpperCase()} · ${((performance.now() - t0) / 1000).toFixed(0)} s (saved to Downloads)`;
  } catch (e) {
    $('pt-pb-st').textContent = e.message === 'cancelled' ? 'Cancelled.' : 'The playblast failed: ' + (e.message || e);
    if (e.message !== 'cancelled') console.error(e);
  } finally {
    try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch (e) { /* closed */ }
    ptpb.busy = false;
    $('pt-pb-go').hidden = false; $('pt-pb-go').textContent = 'Render again'; $('pt-pb-x').textContent = 'Close';
    tl.frame = keep; applyMotion(); if (typeof tlUI === 'function') tlUI();
    PTPB.end();
  }
}
$('pt-pb').addEventListener('click', ptPbOpen);
$('pt-pb-size').addEventListener('change', ptPbInfo); $('pt-pb-q').addEventListener('change', ptPbInfo);
$('pt-pb-go').addEventListener('click', ptPbRun);
$('pt-pb-x').addEventListener('click', () => { if (ptpb.busy) ptpb.cancel = true; else $('pt-pbdlg').hidden = true; });
$('pt-pbdlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (ptpb.busy) ptpb.cancel = true; else $('pt-pbdlg').hidden = true; } });
})();
