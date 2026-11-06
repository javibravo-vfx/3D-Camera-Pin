// 3D Render, la imagen del visor RENDER y los renders finales (js/render3d.js arma la escena y la vista).
// Cada muestra se dibuja en lineal (HDR, half float) y se promedia con las anteriores (acumulación progresiva):
// - antialiasing: la cámara se corre una fracción de pixel por muestra (secuencia de Halton);
// - sombras suaves: el sol se mueve dentro de su disco (Sun size) y las sombras quedan con borde de penumbra;
// - motion blur: cada muestra cae en otro momento dentro del obturador (Shutter, en grados como en cine);
// - AO: oclusión ambiental en pantalla (SAOPass de three.js) multiplicada en cada muestra;
// - GI: un rebote difuso, aproximado: el entorno iluminado se fotografía en un cubo desde la toma y sus armónicos
//   esféricos (LightProbe) suman la luz que rebota en la calle y las fachadas.
// Después: bloom, y en el último paso exposición, tone mapping ACES, saturación, contraste, viñeta y grano (Post
// processing), y el Viewer (js/render3d-color.js: el ODT de ACES o los otros, con su codificación). Sin Max quality, una sola muestra por dibujo (interactivo). Sólo el visor RENDER y los
// renders finales pasan por acá: Top y Free se dibujan simple.
// API: r3FxMake, r3FxDispose, r3FxSample, r3FxShow, r3GiUpdate, r3RenderStill, r3RenderSeq.
const R3_GI_K = 0.25; // la escena del cubo del GI se ilumina a un cuarto (el probe lee 8 bits) y el probe multiplica por 4
const R3_ACC_SHADER = {
  uniforms: { tNew: { value: null }, tOld: { value: null }, w: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tNew; uniform sampler2D tOld; uniform float w; varying vec2 vUv; void main() { gl_FragColor = mix(texture2D(tOld, vUv), texture2D(tNew, vUv), w); }',
};
const R3_FINAL_SHADER = {
  uniforms: { tSrc: { value: null }, view: { value: 0 }, exposure: { value: 1 }, post: { value: 0 }, in709: { value: 0 }, alphaMode: { value: 0 }, checker: { value: 0 }, sat: { value: 1 }, con: { value: 1 }, vig: { value: 0 }, grain: { value: 0 }, seed: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tSrc; uniform int view, alphaMode; uniform float exposure, post, sat, con, vig, grain, seed, in709, checker; uniform vec2 res; varying vec2 vUv;
    ${R3_VIEW_GLSL}
    ${R3_TO_AP1_GLSL}
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
    void main() {
      // la imagen está en ACEScg lineal: el Viewer la lleva a la pantalla (lineal), el post trabaja ahí y después se codifica.
      // La del path tracer (in709) llega en lineal Rec.709 y premultiplicada por su alfa: se separa y se pasa a ACEScg
      vec4 s = texture2D(tSrc, vUv); float a = clamp(s.a, 0.0, 1.0); vec3 c0 = s.rgb;
      if (in709 > 0.5) { if (a > 1e-4) c0 /= a; c0 = R3_TO_AP1 * c0; } else a = 1.0;
      vec3 c = r3ViewLin(c0 * exposure, view);
      if (post > 0.5) {
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(mix(vec3(l), c, sat), 0.0);
        c = clamp((c - 0.18) * con + 0.18, 0.0, 1.0);
        vec2 d = (vUv - 0.5) * vec2(res.x / res.y, 1.0); c *= 1.0 - vig * smoothstep(0.35, 1.05, length(d));
      }
      c = r3ViewEnc(clamp(c, 0.0, 1.0), view);
      if (post > 0.5 && grain > 0.0) c += (hash(vUv * res) - 0.5) * grain;
      c = clamp(c, 0.0, 1.0);
      // alphaMode 0: opaco (con checker, sobre un damero: el fondo transparente en el visor); 1: alfa aparte (PNG); 2: premultiplicado (el canvas)
      if (checker > 0.5) { float k = mod(floor(gl_FragCoord.x / 10.0) + floor(gl_FragCoord.y / 10.0), 2.0); c = mix(vec3(k > 0.5 ? 0.30 : 0.22), c, a); }
      gl_FragColor = alphaMode == 1 ? vec4(c, a) : alphaMode == 2 ? vec4(c * a, a) : vec4(c, 1.0);
    }`,
};
const r3Halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
function r3FxMake(W, H) {
  const gl = r3.gl, floatOk = gl.capabilities.isWebGL2 && gl.extensions.has('EXT_color_buffer_float');
  const rt = (type, depth) => { const t = new THREE.WebGLRenderTarget(W, H, { type, depthBuffer: !!depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }); t.texture.colorSpace = THREE.LinearSRGBColorSpace; return t; };
  const fx = { W, H, n: 0, cur: 0, beauty: rt(THREE.HalfFloatType, true), acc: [rt(floatOk ? THREE.FloatType : THREE.HalfFloatType), rt(floatOk ? THREE.FloatType : THREE.HalfFloatType)],
    post: rt(THREE.HalfFloatType), out: rt(THREE.UnsignedByteType),
    qAcc: new THREE.FullScreenQuad(new THREE.ShaderMaterial(R3_ACC_SHADER)), qFinal: new THREE.FullScreenQuad(new THREE.ShaderMaterial(R3_FINAL_SHADER)),
    qCopy: new THREE.FullScreenQuad(new THREE.ShaderMaterial(THREE.CopyShader)), sao: null, bloom: null };
  fx.qAcc.material.depthTest = fx.qFinal.material.depthTest = fx.qCopy.material.depthTest = false;
  return fx;
}
function r3FxDispose(fx) {
  if (!fx) return;
  [fx.beauty, ...fx.acc, fx.post, fx.out].forEach(t => t.dispose());
  [fx.qAcc, fx.qFinal, fx.qCopy].forEach(q => { q.material.dispose(); q.dispose(); });
  if (fx.sao) fx.sao.dispose(); if (fx.bloom) fx.bloom.dispose();
}
function r3FxSao(fx, best) {
  if (!fx.sao) {
    fx.sao = new THREE.SAOPass(r3.scene, camera, new THREE.Vector2(fx.W, fx.H)); // su profundidad ya es de 24 bits: la calle es larga
  }
  // saoScale: el SAO mide distancias divididas por el far de la cámara (aquí kilómetros): far × 0.7 da un alcance de
  // ~1,5 m (rincones, cordones, autos contra el piso); AO distance lo cambia (el alcance va al revés de la escala) y el
  // radio del núcleo, en pixels, sigue al ancho de la imagen y crece con el alcance
  const k = Math.max(0.05, r3.aoDist || 1.5) / 1.5;
  Object.assign(fx.sao.params, { output: 0, saoBias: 0.2, saoIntensity: r3.aoInt * 2 / Math.sqrt(Math.max(1, k)), saoScale: camera.far * 0.7 / k, saoKernelRadius: Math.min(fx.W / 4, Math.max(16, fx.W / 24 * Math.sqrt(k))), saoMinResolution: 0, saoBlur: true, saoBlurRadius: 6, saoBlurStdDev: 3, saoBlurDepthCutoff: 0.01 });
  // calidad: con Max quality y en los renders, AO samples por imagen y el patrón girado en cada muestra (el promedio lo
  // limpia); interactivo, 7 y quieto (no titila)
  const m = fx.sao.saoMaterial, n = best ? r3.aoSamples : 7;
  if (m.defines.NUM_SAMPLES !== n) { m.defines.NUM_SAMPLES = n; m.needsUpdate = true; }
  m.uniforms.randomSeed.value = best ? Math.random() * 10 : 0;
  return fx.sao;
}
// una muestra de la cámara de la toma en fx (el entorno ya está en r3.scene). o: { jitter, soft, mb, frame }
function r3FxSample(fx, o) {
  const gl = r3.gl, P = camera.projectionMatrix, keepP = P.clone(), keepPi = camera.projectionMatrixInverse.clone(), sunPos = r3.sun.position.clone(), i = fx.n + 1;
  if (o.jitter && fx.n > 0) { P.elements[8] += (r3Halton(i, 2) - 0.5) * 2 / fx.W; P.elements[9] += (r3Halton(i, 3) - 0.5) * 2 / fx.H; }
  camera.projectionMatrixInverse.copy(P).invert();
  if (o.soft && fx.n > 0 && r3.sunSize > 0) { // un punto del disco del sol
    const t = r3.sun.target.position, d = sunPos.clone().sub(t), len = d.length(); d.normalize();
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Math.tan(r3.sunSize / 2 * Math.PI / 180);
    const u = new THREE.Vector3(0, 1, 0).cross(d); if (u.lengthSq() < 1e-6) u.set(1, 0, 0); u.normalize(); const v = d.clone().cross(u);
    r3.sun.position.copy(t).addScaledVector(d.addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize(), len); r3.sun.updateMatrixWorld();
  }
  const keepF = tl.frame, tm = gl.toneMapping;
  gl.toneMapping = THREE.NoToneMapping; // la muestra va lineal y el ACES va al final (r187 ya no tonemapea en los render targets; r147 sí)
  if (o.mb && r3.shutter > 0 && fx.n > 0) { tl.frame = o.frame + (r3Halton(i, 5) - 0.5) * r3.shutter / 360; applyMotion(); if (r3.camKeep) r3CamPush(tl.frame); }
  try {
    gl.setRenderTarget(fx.beauty); gl.clear(); gl.render(r3.scene, camera);
    if (r3.ao && r3.aoInt > 0) r3FxSao(fx, !!o.jitter).render(gl, null, fx.beauty);
    const prev = fx.acc[fx.cur], next = fx.acc[1 - fx.cur];
    fx.qAcc.material.uniforms.tNew.value = fx.beauty.texture; fx.qAcc.material.uniforms.tOld.value = prev.texture; fx.qAcc.material.uniforms.w.value = 1 / i;
    gl.setRenderTarget(next); fx.qAcc.render(gl); fx.cur = 1 - fx.cur; fx.n = i;
  } finally {
    P.copy(keepP); camera.projectionMatrixInverse.copy(keepPi);
    if (!r3.sun.position.equals(sunPos)) { r3.sun.position.copy(sunPos); r3.sun.updateMatrixWorld(); }
    if (tl.frame !== keepF) { tl.frame = keepF; applyMotion(); if (r3.camKeep) r3CamPush(keepF); }
    gl.toneMapping = tm; gl.setRenderTarget(null);
  }
}
// lo acumulado, con el post, a la pantalla (target null) o a fx.out
function r3FxShow(fx, target) {
  const gl = r3.gl, P = r3.post; let src = fx.acc[fx.cur];
  if (P.on && P.bloom > 0) {
    fx.qCopy.material.uniforms.tDiffuse.value = src.texture; gl.setRenderTarget(fx.post); fx.qCopy.render(gl);
    if (!fx.bloom) fx.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(fx.W, fx.H), P.bloom, P.bloomR, P.bloomT); // el de r147 (vendor/three-r147)
    Object.assign(fx.bloom, { strength: P.bloom, radius: P.bloomR, threshold: P.bloomT });
    fx.bloom.render(gl, null, fx.post); src = fx.post;
  }
  const u = fx.qFinal.material.uniforms;
  u.tSrc.value = src.texture; u.view.value = r3ViewIndex(r3.views.shot); u.exposure.value = r3ExpGain(r3.exp); u.post.value = P.on ? 1 : 0;
  u.in709.value = fx.in709 ? 1 : 0; u.alphaMode.value = fx.alphaMode || 0; u.checker.value = fx.checker ? 1 : 0; // el path tracer (js/render3d-pt.js)
  u.sat.value = P.sat; u.con.value = P.con; u.vig.value = P.vig; u.grain.value = P.grain; u.seed.value = Math.random() * 100; u.res.value.set(fx.W, fx.H);
  gl.setRenderTarget(target || null); fx.qFinal.render(gl); gl.setRenderTarget(null);
}
// Top y Free: la escena en lineal (ACEScg, con antialiasing) y su Viewer, sin post
function r3PaneDraw(p, k, cam, w, h) {
  const gl = r3.gl;
  if (!p.rt || p.rt.width !== w || p.rt.height !== h) {
    if (p.rt) p.rt.dispose();
    p.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: gl.capabilities.isWebGL2 ? 4 : 0 }); p.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  }
  if (!r3.qView) { r3.qView = new THREE.FullScreenQuad(new THREE.ShaderMaterial(R3_FINAL_SHADER)); r3.qView.material.depthTest = false; }
  // simples: sin el rebote (GI), que es de Render
  const tm = gl.toneMapping, pi = r3.probe ? r3.probe.intensity : 0; gl.toneMapping = THREE.NoToneMapping; if (r3.probe) r3.probe.intensity = 0;
  try { gl.setRenderTarget(p.rt); gl.clear(); gl.render(r3.scene, cam); } finally { gl.toneMapping = tm; gl.setRenderTarget(null); if (r3.probe) r3.probe.intensity = pi; }
  const u = r3.qView.material.uniforms;
  u.tSrc.value = p.rt.texture; u.view.value = r3ViewIndex(r3.views[k]); u.exposure.value = r3ExpGain(r3.exp); u.post.value = 0;
  gl.setRenderTarget(null); r3.qView.render(gl);
}
// los armónicos esféricos de un cubo de 8 bits en lineal, en sh. Es LightProbeGenerator.fromCubeRenderTarget de three
// r187 sin lo asíncrono: allá lee cada cara con readRenderTargetPixelsAsync y el probe llegaría después de las
// muestras de un render; acá se lee en el momento, como en r147
function r3ShFromCube(gl, rt, sh) {
  const w = rt.width, data = new Uint8Array(w * w * 4), px = 2 / w, flip = gl.coordinateSystem === THREE.WebGLCoordinateSystem ? -1 : 1;
  const coord = new THREE.Vector3(), dir = new THREE.Vector3(), basis = new Array(9).fill(0), C = sh.zero().coefficients;
  let total = 0;
  for (let face = 0; face < 6; face++) {
    gl.readRenderTargetPixels(rt, 0, 0, w, w, data, face);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255, k = i / 4;
      const col = (1 - (k % w + 0.5) * px) * flip, row = 1 - (Math.floor(k / w) + 0.5) * px;
      switch (face) {
        case 0: coord.set(-1 * flip, row, col * flip); break;
        case 1: coord.set(1 * flip, row, -col * flip); break;
        case 2: coord.set(col, 1, -row); break;
        case 3: coord.set(col, -1, row); break;
        case 4: coord.set(col, row, 1); break;
        case 5: coord.set(-col, row, -1); break;
      }
      const l2 = coord.lengthSq(), wt = 4 / (Math.sqrt(l2) * l2); total += wt;
      THREE.SphericalHarmonics3.getBasisAt(dir.copy(coord).normalize(), basis);
      for (let j = 0; j < 9; j++) { C[j].x += basis[j] * r * wt; C[j].y += basis[j] * g * wt; C[j].z += basis[j] * b * wt; }
    }
  }
  const norm = 4 * Math.PI / total;
  for (let j = 0; j < 9; j++) C[j].multiplyScalar(norm);
  return sh;
}
// GI: el rebote difuso desde la cámara de la toma (un probe de armónicos esféricos)
function r3GiUpdate() {
  if (!r3.probe) return;
  if (r3.refl) { r3.probe.intensity = 0; r3ReflUpdate(); r3.giT = performance.now(); return; }
  if (r3.scene.environment !== r3.baseEnv) { r3.scene.environment = r3.baseEnv; r3MatsUpdate(); }
  if (!r3.gi || r3.giInt <= 0) { r3.probe.intensity = 0; return; }
  const gl = r3.gl;
  if (!r3.giRT) { r3.giRT = new THREE.WebGLCubeRenderTarget(48, { type: THREE.UnsignedByteType }); r3.giRT.texture.colorSpace = THREE.LinearSRGBColorSpace; r3.giCam = new THREE.CubeCamera(0.3, 2500, r3.giRT); r3.scene.add(r3.giCam); }
  const c = camera.position, keep = { bg: r3.scene.background, sun: r3.sun.intensity, hemi: r3.hemi.intensity, gz: r3.camGizmo.visible, ems: [...r3.mats.values()].map(m => m.envMapIntensity), envI: r3.scene.environmentIntensity };
  r3.giCam.position.set(c.x, Math.max(1.2, c.y), c.z); r3.giCam.updateMatrixWorld();
  r3.scene.background = new THREE.Color(0); r3.probe.intensity = 0; r3.camGizmo.visible = false;
  // el entorno también a un cuarto: en r187 lo que llega por scene.environment se escala con environmentIntensity
  r3.sun.intensity *= R3_GI_K; r3.hemi.intensity *= R3_GI_K; r3.scene.environmentIntensity *= R3_GI_K; for (const m of r3.mats.values()) m.envMapIntensity *= R3_GI_K;
  const tm = gl.toneMapping; gl.toneMapping = THREE.NoToneMapping;
  try {
    r3.giCam.update(gl, r3.scene);
    r3ShFromCube(gl, r3.giRT, r3.probe.sh); r3.probe.intensity = r3.giInt / R3_GI_K;
  } catch (e) { console.warn('GI', e); r3.probe.intensity = 0; }
  finally {
    gl.toneMapping = tm;
    r3.scene.background = keep.bg; r3.sun.intensity = keep.sun; r3.hemi.intensity = keep.hemi; r3.camGizmo.visible = keep.gz;
    [...r3.mats.values()].forEach((m, i) => { m.envMapIntensity = keep.ems[i]; }); r3.scene.environmentIntensity = keep.envI;
  }
  r3.giT = performance.now();
}

// Scene reflections: la escena vista desde la toma en un cubo (con el HDRI o el cielo detrás y la luz de siempre), que
// pasa a ser el entorno: la pintura, el vidrio y el metal reflejan la calle, las fachadas y el tráfico, y su luz difusa
// trae el rebote de la escena (por eso reemplaza al GI). Aproximado: todo se refleja como si estuviera lejos.
function r3ReflUpdate() {
  const gl = r3.gl, H = r3.hdri;
  if (!r3.reflRT) {
    r3.reflRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }); r3.reflRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    r3.reflCam = new THREE.CubeCamera(0.1, 3000, r3.reflRT); r3.scene.add(r3.reflCam);
  }
  const c = camera.position, keep = { bg: r3.scene.background, bgi: r3.scene.backgroundIntensity, gz: r3.camGizmo.visible };
  r3.reflCam.position.set(c.x, Math.max(1.2, c.y), c.z); r3.reflCam.updateMatrixWorld();
  // lo capturado se ilumina con el entorno de base (no con la captura anterior: no se acumula)
  r3.scene.environment = r3.baseEnv; r3MatsUpdate();
  r3.scene.background = H.tex || r3.skyTex || keep.bg; r3.scene.backgroundIntensity = H.tex ? H.int : 1; r3.camGizmo.visible = false;
  const tm = gl.toneMapping; gl.toneMapping = THREE.NoToneMapping;
  try {
    r3.reflCam.update(gl, r3.scene);
    const rt = r3.pmrem.fromCubemap(r3.reflRT.texture);
    if (r3.reflEnvRT) r3.reflEnvRT.dispose();
    r3.reflEnvRT = rt; r3.reflEnv = rt.texture;
  } catch (e) { console.warn('Scene reflections', e); r3.reflEnv = null; }
  finally {
    gl.toneMapping = tm; r3.scene.background = keep.bg; r3.scene.backgroundIntensity = keep.bgi; r3.camGizmo.visible = keep.gz;
    r3.scene.environment = r3.reflEnv || r3.baseEnv; r3MatsUpdate();
  }
}

// ---------- Renders finales: el cuadro del plate (o una fracción), con todas las muestras ----------
function r3OutSize() {
  const s = r3.outScale, W0 = st.plate && !st.plate.empty ? st.plate.W : 1920, H0 = st.plate && !st.plate.empty ? st.plate.H : Math.round(1920 / (camera.aspect || 16 / 9));
  return { W: Math.max(16, Math.round(W0 * s / 2) * 2), H: Math.max(16, Math.round(H0 * s / 2) * 2) };
}
function r3Base() {
  const nmr = typeof nmNames === 'function' ? nmNames() : null;
  return (nmr && nmr.info && nmr.pb ? nmr.pb.replace(/_?playblast/i, '') : ((st.plate && !st.plate.empty ? st.plate.name : '') || 'backplatelab').replace(/\.[^.]+$/, '')).replace(/[^\w.-]+/g, '_') + '_render';
}
// un cuadro como el visor Render: todas las muestras y el post, la cámara de Shakelab si va y el plate encima si va.
// Devuelve un canvas de W × H. o: { N (muestras), noSeek (el video ya está) }
async function r3FrameCanvas(fx, frame, W, H, onSample, o = {}) {
  tl.frame = frame; applyMotion();
  if (!o.noSeek && typeof vplActive === 'function' && vplActive()) await vplSeek(frame);
  let cv = document.createElement('canvas'); cv.width = W; cv.height = H; let g = cv.getContext('2d');
  r3CamPush(frame);
  try {
    if (r3.engine === 'pt') { // Path trace (js/render3d-pt.js): o.N muestras y o.bounces rebotes
      cv = await r3PtFrameCanvas(W, H, Math.max(1, Math.round(o.N)), o.bounces || r3.pt.bounces, onSample); g = cv.getContext('2d');
    } else {
      fx.n = 0; fx.cur = 0;
      r3GiUpdate();
      const N = Math.max(1, Math.round(o.N));
      for (let s = 0; s < N; s++) {
        if (r3.cancel) throw new Error('cancelled');
        r3FxSample(fx, { jitter: N > 1, soft: N > 1, mb: r3.mb && N > 1, frame });
        if (s % 4 === 3) { onSample(s + 1, N); await new Promise(r => setTimeout(r, 0)); }
      }
      r3FxShow(fx, fx.out);
      const px = new Uint8Array(W * H * 4); r3.gl.readRenderTargetPixels(fx.out, 0, 0, W, H, px);
      const img = g.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4); // abajo para arriba
      g.putImageData(img, 0, 0);
    }
  } finally { r3CamPop(); }
  const pe = r3.plate && typeof pbPlateEl === 'function' ? pbPlateEl() : null;
  if (pe) g.drawImage(pe, 0, 0, W, H);
  return cv;
}
async function r3RenderFrame(fx, frame, W, H, onSample) {
  const cv = await r3FrameCanvas(fx, frame, W, H, onSample, { N: r3.engine === 'pt' ? r3.pt.samples : r3.samples });
  return new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer());
}
// el playblast desde 3D Render: cada cuadro como el visor Render (con Max quality, sus muestras; si no, una). Lo llama
// js/playblast.js en lugar de su composición.
async function r3PbFrame(ctx, W, H) {
  if (!r3.on || !r3Init()) { pbComposite(ctx, W, H); return; }
  const pt = r3.engine === 'pt';
  if (!pt && (!r3.pbFx || r3.pbFx.W !== W || r3.pbFx.H !== H)) { r3FxDispose(r3.pbFx); r3.pbFx = r3FxMake(W, H); }
  const par = envRoot.parent, vis = envRoot.visible, gz = r3.camGizmo.visible;
  r3.busy = true; envRoot.visible = true; r3.scene.add(envRoot); r3.camGizmo.visible = false;
  r3ApplyQuality(r3.hq); r3SunApply();
  try {
    let cv;
    if (pt) { // Path trace: la calidad del diálogo; en el título, el tiempo por cuadro y lo que falta
      const q = r3PtPbQuality($('pb-ptq').value), i = tl.frame - tl.start, n = tl.end - tl.start + 1, t0 = performance.now();
      if (i === 0) r3.pbTimes = [];
      const T = r3.pbTimes, avg = T.length ? T.reduce((a, b) => a + b, 0) / T.length : 0, mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
      const head = () => `Path trace · frame ${i + 1} / ${n}${avg ? ` · ${avg.toFixed(1)} s per frame · about ${mmss(avg * (n - i))} left` : ''}`;
      $('pb-t').textContent = head();
      cv = await r3FrameCanvas(null, tl.frame, W, H, (s, N) => { $('pb-t').textContent = `${head()} · sample ${s} / ${N}`; }, { N: q.spp, bounces: q.bounces, noSeek: true });
      T.push((performance.now() - t0) / 1000);
    } else cv = await r3FrameCanvas(r3.pbFx, tl.frame, W, H, () => {}, { N: r3.hq ? r3.samples : 1, noSeek: true });
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); // un MP4 no lleva alfa: lo transparente sale negro
    ctx.drawImage(cv, 0, 0, W, H);
  } finally { par ? par.add(envRoot) : r3.scene.remove(envRoot); envRoot.visible = vis; r3.camGizmo.visible = gz; r3.busy = false; r3ApplyQuality(); }
}
function r3PbDone() { r3FxDispose(r3.pbFx); r3.pbFx = null; r3.pbTimes = []; r3Dirty(); }
async function r3Download(blob, name) {
  if (window.bplDesktop && typeof desktopSave === 'function') { const r = await desktopSave(blob, name); toast(r.msg, !!r.error); return; }
  const a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000); toast(`Saved as ${name} (Downloads)`);
}
async function r3RenderRun(seq) {
  if (r3.busy || !r3.on || !r3Init()) return;
  if (!ENV_MODULES[env.id]) { toast('Pick an environment first: 3D Camera Pin | Environment › Environment › Module', true); return; }
  if (r3.plate && !(typeof pbPlateEl === 'function' && pbPlateEl())) toast('Plate on top: there is no plate to put on top; rendering without it', true);
  else if (r3.plate && !key.on) toast('Plate on top without the Chroma key (K): the plate covers the render. Turn on the key to see the render through the windows.', true);
  tlPlay(false);
  const { W, H } = r3OutSize(), f0 = seq ? tl.start : tl.frame, f1 = seq ? tl.end : tl.frame, keep = tl.frame, n = f1 - f0 + 1;
  r3.busy = true; r3.cancel = false; r3ProgUI(true, 0, 'Starting…');
  const fx = r3.engine === 'pt' ? null : r3FxMake(W, H), par = envRoot.parent, vis = envRoot.visible, gz = r3.camGizmo.visible;
  envRoot.visible = true; r3.scene.add(envRoot); r3.camGizmo.visible = false;
  r3ApplyQuality(true); r3SunApply();
  try {
    const zip = seq ? passZip() : null, base = r3Base();
    let last = null;
    for (let f = f0; f <= f1; f++) {
      const i = f - f0;
      const png = await r3RenderFrame(fx, f, W, H, (s, N) => r3ProgUI(true, (i + s / N) / n, `${seq ? `Frame ${f} (${i + 1} / ${n}) · ` : ''}sample ${s} / ${N}`));
      if (zip) zip.add(`render/${base}.${String(f).padStart(4, '0')}.png`, png, false); else last = png;
      r3ProgUI(true, (i + 1) / n, `${seq ? `Frame ${f} done` : 'Done'}`);
    }
    if (zip) {
      const pt = r3.engine === 'pt', P = r3.pt;
      zip.add('README.txt', new TextEncoder().encode(`BackplateLab ${APP_VERSION} 3D render · frames ${f0}-${f1} at ${tl.fps} fps · ${W} x ${H} px · ` +
        (pt ? `path trace, ${P.samples} samples and ${P.bounces} bounces per frame${P.dn ? ', denoised' : ''}${P.focus !== 'off' ? `, depth of field (${P.focus === 'depthlab' ? 'DepthLab focus' : `focus ${P.focusM} m, f/${P.fstop}`})` : ''}${P.bg === 'alpha' ? ', transparent background (PNG with alpha)' : P.bg === 'plate' ? ', plate behind' : ''}${r3.free ? ', free camera of the viewer' : ''}`
          : `${r3.samples} samples per frame${r3.mb ? ` · motion blur ${r3.shutter}°` : ''}${r3.ao ? ' · AO' : ''}${r3.refl ? ' · scene reflections (a capture from the shot)' : r3.gi ? ' · GI (one diffuse bounce, approximate)' : ''}`) +
        `${r3.post.on ? ' · post processing' : ''}${r3.plate ? ' · plate on top' : ''}\n` +
        `Sun: azimuth ${r3.az.toFixed(1)}, elevation ${r3.el.toFixed(1)} deg (${r3.sunMode === 'auto' ? `${r3.date} ${r3.time} UTC${r3.utc >= 0 ? '+' : ''}${r3.utc}` : 'artistic'}), street heading ${r3.heading.toFixed(1)} deg.\n` +
        `PNG, ${(R3_VIEWS.find(v => v[0] === r3.views.shot) || R3_VIEWS[0])[1]} (the Render viewer, from ACEScg linear).\n`), true);
      await r3Download(zip.end(), `${base}_${f0}-${f1}.zip`);
    } else await r3Download(new Blob([last], { type: 'image/png' }), `${base}.${String(f0).padStart(4, '0')}.png`);
  } catch (e) {
    if (e && e.message === 'cancelled') toast('Render cancelled'); else { console.error(e); toast('Render failed: ' + (e && e.message || e), true); }
  } finally {
    if (fx) r3FxDispose(fx); r3ApplyQuality();
    par ? par.add(envRoot) : r3.scene.remove(envRoot); envRoot.visible = vis; r3.camGizmo.visible = gz;
    r3.busy = false; r3ProgUI(false);
    tl.frame = keep; applyMotion(); tlUI(); if (typeof vplSeek === 'function') vplSeek(keep);
    r3Dirty();
  }
}
const r3RenderStill = () => r3RenderRun(false), r3RenderSeq = () => r3RenderRun(true);
function r3ProgUI(on, k, txt) {
  $('r3-prog').hidden = !on; $('r3-still').disabled = $('r3-seq').disabled = !!on;
  if (!on) return;
  $('r3-bar').style.width = (Math.max(0, Math.min(1, k)) * 100).toFixed(1) + '%'; if (txt) $('r3-prog-t').textContent = txt;
}
