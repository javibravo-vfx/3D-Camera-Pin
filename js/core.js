const $ = (id) => document.getElementById(id);
// hook tour: la copia de práctica (?tour=) guarda en memoria: empieza limpia y no pisa lo del usuario
const lsMem = /[?&]tour=/.test(location.search) ? new Map() : null;
let lsOff = false; // Reset all: mientras se borra y se recarga, nada vuelve a guardarse
const lsGet = (k, d) => { try { const v = lsMem ? (lsMem.has(k) ? lsMem.get(k) : null) : localStorage.getItem('pinmatch.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
// app de escritorio (Electron): cada descarga abre el diálogo de guardar (empieza en Descargas)
const IS_DESKTOP = /Electron\//.test(navigator.userAgent);
const lsSet = (k, v) => { if (lsOff) return; try { if (lsMem) lsMem.set(k, JSON.stringify(v)); else localStorage.setItem('pinmatch.' + k, JSON.stringify(v)); } catch (e) {} };

// ---------- Sensor presets: un preset por modo del catálogo de cámaras (js/camera-catalog.js) ----------
// st.preset es la clave 'cuerpo/modo' o 'custom'
const PRESETS = [
  ...CAM_CATALOG.flatMap(b => camModes(b).map(m => [m.key, camBodyName(b) + ' · ' + m.label, m.w, m.h])),
  ['custom', 'Custom', null, null],
];
// claves de los modos del cuerpo que nombra la metadata (null si no está en el catálogo)
function presetsForModel(model) { const b = camMatchBody(model); return b ? camModes(b).map(m => m.key) : null; }

// ---------- State ----------
const st = {
  plate: { W: 1920, H: 1336, name: 'Sample', sample: true },
  sw: 36.70, sh: 25.54, focal: 32, preset: 'arri_alexa_mini_lf/mlf_45k_og', shAuto: true, par: 1, scanY: 0,
  freeF: false, fScale: 1,
  unit: 1, up: 'y', userScale: 1, scaleOk: false,
  scanName: 'Sample', scanKind: 'mesh', rawBox: null, sample: true,
  pins: [], sel: -1, nextId: 1,
  mode: 'nav',
  view: { zoom: 1, x: 0, y: 0, baseW: 1, baseH: 1, left: 0, top: 0 },
  measure: { a: null, b: null },
  solved: null, rms: null,
};

// ---------- Three setup ----------
const vp = $('vp'), stage = $('stage'), canvas = $('gl'), plateImg = $('plate'), ov = $('ov');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, logarithmicDepthBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// si la placa se reinicia (un driver, otro programa o un motor que la tumbó), Chromium pierde los contextos WebGL de la
// página; three (r147) los recupera solo al volver: acá se avisa y se redibuja. Lo usan todos los renderers de la app.
function glKeep(r, redraw) {
  const c = r.domElement;
  c.addEventListener('webglcontextlost', () => { console.warn('BackplateLab: WebGL context lost'); glKeep.lost = true; });
  c.addEventListener('webglcontextrestored', () => {
    setTimeout(() => { try { redraw(); } catch (e) { console.error(e); } }, 0);
    if (glKeep.lost) { glKeep.lost = false; if (typeof toast === 'function') toast('The GPU was reset: the 3D views are drawn again'); }
  });
}
glKeep(renderer, () => render());
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1.5, 0.05, 5000);
scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x3a3328, 0.85 * Math.PI));
const sun = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI); sun.position.set(5, 10, 7); scene.add(sun);
const scanRoot = new THREE.Group(); scene.add(scanRoot);
let scanObj = null;
const grid = new THREE.GridHelper(60, 60, 0x5ccfe0, 0x3b4654);
grid.material.transparent = true; grid.material.opacity = 0.35; grid.material.depthWrite = false;
scene.add(grid);
// measure helpers
const measGeo = new THREE.BufferGeometry(); measGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
const measLine = new THREE.Line(measGeo, new THREE.LineBasicMaterial({ color: 0xffb238, depthTest: false, transparent: true }));
measLine.renderOrder = 999; measLine.visible = false; scene.add(measLine);
const measPts = new THREE.Points(measGeo, new THREE.PointsMaterial({ color: 0xffb238, size: 8, sizeAttenuation: false, depthTest: false, transparent: true }));
measPts.renderOrder = 999; measPts.visible = false; scene.add(measPts);
// Intrinsics / pose conversion: en js/intrinsics.js

