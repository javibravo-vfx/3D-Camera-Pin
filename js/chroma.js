// ---------- Chroma key (color-difference keyer on the displayed plate) ----------
// With the key on: environment renders under the plate (its own canvas), keyed plate in the middle, scan on top.
const envScene = new THREE.Scene();
envScene.add(new THREE.HemisphereLight(0xdfe8f2, 0x3a3328, 0.85 * Math.PI));
{ const l = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI); l.position.set(5, 10, 7); envScene.add(l); }
const envRenderer = new THREE.WebGLRenderer({ canvas: $('glenv'), antialias: true, alpha: true, logarithmicDepthBuffer: true });
envRenderer.setClearColor(0x000000, 0); envRenderer.outputColorSpace = THREE.SRGBColorSpace; glKeep(envRenderer, () => render());
const key = { on: false, screen: 'green', thr: 0.06, soft: 0.18, despill: true, view: 'comp' };
const keySrc = document.createElement('canvas');
function keySource() {
  if (vplShowing()) { // the video frame on screen now
    const v = vpl.el; if (!v.videoWidth) return null;
    if (keySrc.width !== v.videoWidth || keySrc.height !== v.videoHeight) { keySrc.width = v.videoWidth; keySrc.height = v.videoHeight; }
    keySrc.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0); keySrc.dataset.src = '';
    return keySrc;
  }
  if (!$('platecv').hidden || exrState) return $('platecv');
  const img = plateImg;
  if (!img.complete || !img.naturalWidth) return null;
  if (keySrc.dataset.src !== img.src) {
    keySrc.width = img.naturalWidth; keySrc.height = img.naturalHeight;
    keySrc.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0); keySrc.dataset.src = img.src;
  }
  return keySrc;
}
// la imagen que lee el key en GPU, la misma que keySource pero sin pasar por un canvas de CPU
function keyElement() {
  if (vplShowing()) { const v = vpl.el; return v.videoWidth ? [v, v.videoWidth, v.videoHeight] : null; }
  if (!$('platecv').hidden || exrState) { const c = $('platecv'); return [c, c.width, c.height]; }
  return plateImg.complete && plateImg.naturalWidth ? [plateImg, plateImg.naturalWidth, plateImg.naturalHeight] : null;
}
// Key en GPU sobre #platekey: el bucle de CPU tardaba ~90 ms por frame a 4K y en play quedaba atrás del
// video. La cuenta es la misma, en valores de display 0..1 (los bytes / 255); salida sin premultiplicar,
// como la dejaba putImageData.
const keyGl = { gl: null, fail: false, u: null };
function keyGlInit() {
  if (keyGl.gl || keyGl.fail) return keyGl.gl;
  const o = { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, depth: false }; // preserve: el playblast lo copia con drawImage
  const cv = $('platekey'), gl = cv.getContext('webgl2', o) || cv.getContext('webgl', o);
  if (!gl) { keyGl.fail = true; return null; }
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 v; void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, `precision highp float; uniform sampler2D t; uniform vec3 u; uniform bool green, matte; varying vec2 v;
    void main() {
      vec4 s = texture2D(t, v);
      float scr = green ? s.g : s.b, other = green ? max(s.r, s.b) : max(s.r, s.g), diff = scr - other;
      float a = clamp(1.0 - (diff - u.x) / u.y, 0.0, 1.0);
      if (u.z > 0.5 && diff > 0.0) { if (green) s.g = other; else s.b = other; }
      gl_FragColor = matte ? vec4(vec3(a), 1.0) : vec4(s.rgb, a);
    }`));
  gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('key shader:', gl.getProgramInfoLog(p)); keyGl.fail = true; return null; }
  gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  keyGl.u = ['u', 'green', 'matte'].map(n => gl.getUniformLocation(p, n));
  return keyGl.gl = gl;
}
function applyKey() {
  const out = $('platekey');
  placeEnv();
  if (!key.on) { out.hidden = true; plateImg.style.visibility = ''; $('platecv').style.visibility = ''; stage.classList.remove('keyed'); render(); return; }
  const src = keyElement(), gl = src && keyGlInit(); if (!gl) return;
  const [el, W, H] = src;
  if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
  gl.viewport(0, 0, W, H);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
  gl.uniform3f(keyGl.u[0], key.thr, Math.max(1 / 255, key.soft), key.despill ? 1 : 0);
  gl.uniform1i(keyGl.u[1], key.screen === 'green' ? 1 : 0); gl.uniform1i(keyGl.u[2], key.view === 'matte' ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  out.hidden = false;
  plateImg.style.visibility = 'hidden'; $('platecv').style.visibility = 'hidden'; stage.classList.add('keyed'); // .keyed: the video only goes transparent, so it keeps presenting frames
  render();
}
let keyTimer = 0;
function keyLater() { clearTimeout(keyTimer); keyTimer = setTimeout(applyKey, 30); }
function placeEnv() {
  const under = key.on && key.view !== 'matte';
  const parent = under ? envScene : scene;
  if (envRoot.parent !== parent) parent.add(envRoot);
  $('glenv').hidden = !under;
  // sky behind the keyed plate when an environment is on
  envRenderer.setClearColor(0xb4c3cf, envRoot.visible ? 1 : 0);
}

const env = { id: 'none', on: false, seed: 7, vals: {}, display: 'solid' };
function envDefaults(id) { const o = {}; [...ENV_COMMON, ...ENV_MOTION, ...(ENV_MODULES[id]?.params || [])].forEach(p => o[p.key] = p.def); return o; }
