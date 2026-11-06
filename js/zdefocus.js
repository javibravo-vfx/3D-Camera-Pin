// zdefocus: Z defocus del entorno, en GPU. Con el Key prendido va en el canvas de abajo (#glenv, con cielo);
// con el Key apagado el entorno está en la escena principal (#gl, transparente sobre el plate) y se
// desenfoca ahí: el color va premultiplicado con su cobertura, así el borde de lo desenfocado deja ver el
// plate, y después se dibujan nítidos encima el scan, la grilla y la medición (con la profundidad del
// entorno escrita, para que se tapen bien).
// Igual que DepthLab (StreetRender::applyZDefocus): cada px tiene su círculo de confusión con la
// lente activa (thin lens de bokeh-math vía lensCocPx: DIÁMETRO en px del plate, con la distancia
// sobre el eje óptico) y se desenfoca con un disco de ese tamaño. Acá es un gather sobre un disco
// de Vogel con el mip que corresponde a la separación entre muestras, y el criterio de "scatter
// as gather": una muestra suma si su propio disco llega al px. Las de atrás no pasan del desenfoque
// del px (el fondo no se mete sobre algo nítido de adelante) y las de adelante sí lo cubren: el
// borde desenfocado del primer plano se derrama, semitransparente, sobre lo de atrás.
// Pasadas: escena → RT con depth (log depth de three) · CoC con signo (− cerca, + lejos) con mips
// · máximo de CoC cercano por baldosa de 16 px y su dilatación · gather al canvas.
const zdf = { on: false, ms: 0, gls: new Map(), fail: '' };
const ZDF_TILE = 16, ZDF_SAMPLES = 64;
// CoC con signo en px del plate a la distancia d sobre el eje: K = diámetro al infinito, |c| = K·|d − s| / d
// (BokehMath.cocMm). Lo usa también la vista Depth en modo Lens (js/passes.js).
const ZDF_GLSL_COC = 'float zdfCoc(float d, float K, float focus) { return K * (d - focus) / max(d, 1e-4); }';

// un juego de RT y materiales por renderer (#glenv o #gl): los recursos de GPU son de cada contexto
function zdfInit(r) {
  if (zdf.gls.has(r)) return zdf.gls.get(r);
  if (zdf.fail) return null;
  if (!r.capabilities.isWebGL2) { zdf.fail = 'Z defocus needs WebGL 2'; return null; }
  const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  const mip = { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter };
  const g = {
    scene: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
    coc: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, ...mip }),
    cov: new THREE.WebGLRenderTarget(1, 1, mip), // cobertura del entorno (sólo sin key)
    tile: new THREE.WebGLRenderTarget(1, 1, half), near: new THREE.WebGLRenderTarget(1, 1, half),
    cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), fs: new THREE.Scene(),
  };
  g.scene.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
  g.fs.add(g.quad); g.quad.frustumCulled = false;
  const vert = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const mat = (frag, uniforms, extra) => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
  g.mCoc = mat(`uniform sampler2D tColor, tDepth; uniform float uK, uFocus, uLogFar; varying vec2 vUv; ${ZDF_GLSL_COC}
    void main() {
      vec4 col = texture2D(tColor, vUv); float z = texture2D(tDepth, vUv).r;
      // log depth de three → distancia sobre el eje; el cielo lleva el bokeh del infinito, como DepthLab
      float c = z >= 1.0 ? uK : zdfCoc(exp2(z * uLogFar) - 1.0, uK, uFocus);
      gl_FragColor = vec4(col.rgb, c);
    }`, { tColor: { value: null }, tDepth: { value: null }, uK: { value: 0 }, uFocus: { value: 1 }, uLogFar: { value: 1 } });
  g.mCov = mat('uniform sampler2D tColor; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tColor, vUv).a, 0.0, 0.0, 1.0); }', { tColor: { value: null } });
  g.mTile = mat(`uniform sampler2D tCoc; uniform vec2 uSize; varying vec2 vUv;
    void main() {
      ivec2 o = ivec2(gl_FragCoord.xy) * ${ZDF_TILE}, mx = ivec2(uSize) - 1; float m = 0.0;
      for (int j = 0; j < ${ZDF_TILE}; j++) for (int i = 0; i < ${ZDF_TILE}; i++) m = max(m, -texelFetch(tCoc, min(o + ivec2(i, j), mx), 0).a);
      gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
    }`, { tCoc: { value: null }, uSize: { value: new THREE.Vector2() } });
  // cada baldosa se queda con el CoC cercano más grande cuyo disco la alcanza (hasta 6 baldosas)
  g.mNear = mat(`uniform sampler2D tTile; uniform vec2 uTiles; uniform float uPx; varying vec2 vUv;
    void main() {
      ivec2 c = ivec2(gl_FragCoord.xy), mx = ivec2(uTiles) - 1; float m = 0.0;
      for (int j = -6; j <= 6; j++) for (int i = -6; i <= 6; i++) {
        float v = texelFetch(tTile, clamp(c + ivec2(i, j), ivec2(0), mx), 0).r;
        if (float(max(abs(i), abs(j)) - 1) * ${ZDF_TILE}.0 <= v * 0.5 * uPx) m = max(m, v);
      }
      gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
    }`, { tTile: { value: null }, uTiles: { value: new THREE.Vector2() }, uPx: { value: 1 } });
  // ZDF_ALPHA (sin key): cobertura en tCov, color premultiplicado, y escribe la profundidad nítida del entorno
  const gather = alpha => mat(`${alpha ? '#define ZDF_ALPHA' : ''}
    uniform sampler2D tCoc, tNear, tCov, tDepth; uniform vec2 uPlate; uniform float uPx; varying vec2 vUv;
    float cov(vec2 uv, float lod) {
    #ifdef ZDF_ALPHA
      return textureLod(tCov, uv, lod).r;
    #else
      return 1.0;
    #endif
    }
    vec4 outTexel(vec4 o) {
    #ifdef ZDF_ALPHA
      vec3 rgb = linearToOutputTexel(vec4(o.rgb / max(o.a, 1e-4), 1.0)).rgb; return vec4(rgb * o.a, o.a);
    #else
      return linearToOutputTexel(vec4(o.rgb, 1.0));
    #endif
    }
    void main() {
    #ifdef ZDF_ALPHA
      gl_FragDepth = texture2D(tDepth, vUv).r;
    #endif
      vec4 c = textureLod(tCoc, vUv, 0.0);
      float r0 = abs(c.a) * 0.5, R = max(r0, texelFetch(tNear, ivec2(gl_FragCoord.xy) / ${ZDF_TILE}, 0).r * 0.5); // radios, px del plate
      vec4 acc = vec4(c.rgb, cov(vUv, 0.0));
      if (R * uPx < 0.5) { gl_FragColor = outTexel(acc); return; }
      float N = ${ZDF_SAMPLES}.0, gap = R * 1.77 / sqrt(N);      // separación entre muestras (px del plate)
      float lod = max(0.0, log2(gap * uPx)), soft = max(0.5 / uPx, gap * 0.5), tot = 1.0;
      for (int i = 0; i < ${ZDF_SAMPLES}; i++) {
        float fi = float(i) + 0.5, rr = sqrt(fi / N) * R, th = fi * 2.39996323;
        vec2 uv = vUv + vec2(cos(th), sin(th)) * rr / uPlate;
        vec4 s = textureLod(tCoc, uv, lod);
        float cs = abs(s.a) * 0.5;
        if (s.a > c.a) cs = min(cs, r0);                         // atrás del px: no lo tapa
        acc += mix(acc / tot, vec4(s.rgb, cov(uv, lod)), smoothstep(rr - soft, rr + soft, cs)); tot += 1.0;
      }
      gl_FragColor = outTexel(acc / tot);
    }`, { tCoc: { value: null }, tNear: { value: null }, tCov: { value: null }, tDepth: { value: null }, uPlate: { value: new THREE.Vector2() }, uPx: { value: 1 } },
  alpha ? { depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth } : {});
  g.mGather = gather(false); g.mGatherA = gather(true);
  zdf.gls.set(r, g);
  return g;
}
function zdfPass(r, m, target) { const g = zdf.gls.get(r); g.quad.material = m; r.setRenderTarget(target); r.render(g.fs, g.cam); }
// Dibuja el entorno de la escena sc desenfocado en el canvas de r. main: escena principal (sin key).
// false = no aplica (foco inválido o sin WebGL 2): quien llama hace el render normal.
function zdfDraw(r, sc, main) {
  const K = lensCocPx(Infinity);
  if (!(K >= 0)) return false;
  const g = zdfInit(r); if (!g) return false;
  const t0 = performance.now(), sz = r.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, sz.x), h = Math.max(1, sz.y), tw = Math.ceil(w / ZDF_TILE), th = Math.ceil(h / ZDF_TILE);
  if (g.scene.width !== w || g.scene.height !== h) { g.scene.setSize(w, h); g.coc.setSize(w, h); g.tile.setSize(tw, th); g.near.setSize(tw, th); }
  if (main && (g.cov.width !== w || g.cov.height !== h)) g.cov.setSize(w, h);
  const set = (m, o) => { for (const k in o) m.uniforms[k].value = o[k]; }; // three cachea los objetos uniform: sólo se cambia .value
  let shown = null;
  if (main) { // al RT va sólo el entorno (con sus luces), sobre transparente
    shown = sc.children.filter(c => c !== envRoot && !c.isLight && c.visible); shown.forEach(c => c.visible = false);
    r.setRenderTarget(g.scene); r.render(sc, camera);
  } else { // el cielo es el clear: en el RT lineal va linealizado para que salga igual que sin Z defocus
    const sky = r.getClearColor(new THREE.Color()), skyA = r.getClearAlpha();
    r.setClearColor(sky.clone().convertSRGBToLinear(), skyA);
    r.setRenderTarget(g.scene); r.render(sc, camera);
    r.setClearColor(sky, skyA);
  }
  const px = h / st.plate.H; // px del buffer por px del plate
  set(g.mCoc, { tColor: g.scene.texture, tDepth: g.scene.depthTexture, uK: K, uFocus: lensState.focusM, uLogFar: Math.log2(camera.far + 1) });
  zdfPass(r, g.mCoc, g.coc);
  if (main) { set(g.mCov, { tColor: g.scene.texture }); zdfPass(r, g.mCov, g.cov); }
  set(g.mTile, { tCoc: g.coc.texture }); g.mTile.uniforms.uSize.value.set(w, h);
  zdfPass(r, g.mTile, g.tile);
  set(g.mNear, { tTile: g.tile.texture, uPx: px }); g.mNear.uniforms.uTiles.value.set(tw, th);
  zdfPass(r, g.mNear, g.near);
  const mg = main ? g.mGatherA : g.mGather;
  set(mg, { tCoc: g.coc.texture, tNear: g.near.texture, tCov: g.cov.texture, tDepth: g.scene.depthTexture, uPx: px }); mg.uniforms.uPlate.value.set(st.plate.W, st.plate.H);
  zdfPass(r, mg, null);
  if (main) { // lo demás nítido encima, contra la profundidad del entorno que dejó el gather
    shown.forEach(c => c.visible = true); envRoot.visible = false;
    const ac = r.autoClear; r.autoClear = false; r.render(sc, camera); r.autoClear = ac;
    envRoot.visible = true;
  }
  zdf.ms = performance.now() - t0;
  return true;
}
// canvas del entorno bajo el plate (Key prendido). Con la vista Depth no se dibuja: queda tapado.
function zdfRender() {
  if (typeof dvShown === 'function' && dvShown()) return true;
  if (!zdf.on || !envRoot.visible || envRenderer.getClearAlpha() === 0) return false;
  return zdfDraw(envRenderer, envScene, false);
}
// escena principal (render() y el playblast): vista Depth, o Z defocus con el entorno en la escena (Key
// apagado o en Matte). false: quien llama hace renderer.render(scene, camera).
function zdfMain() {
  if (typeof dvRender === 'function' && dvRender()) return true; // vista Depth (js/passes.js)
  if (!zdf.on || envRoot.parent !== scene || !envRoot.visible) return false;
  return zdfDraw(renderer, scene, true);
}

// ---------- UI (sección Environment) ----------
function zdfUI() {
  $('zdf-on').checked = zdf.on;
  const K = lensCocPx(Infinity);
  $('zdf-note').textContent = !zdf.on ? '' : zdf.fail ? zdf.fail
    : !(K >= 0) ? 'The focus is closer than the focal length: no defocus.'
    : `Lens ${bokehState.active === 0 && typeof lensTStopTag === 'function' ? lensTStopTag(0) : 'T' + fmt(lensState.tStop, 1)} · focus ${fmt(lensState.focusM, 2)} m · sky ${fmt(K, 1)} px`;
}
function setZdf(on) { zdf.on = on; lsSet('zdf', on); zdfUI(); render(); }
zdf.on = !!lsGet('zdf', false);
$('zdf-on').onchange = () => setZdf($('zdf-on').checked);
document.addEventListener('lens-changed', () => { zdfUI(); if (zdf.on) render(); });
window.addEventListener('keydown', e => {
  if ((e.key || '').toLowerCase() !== 'd' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return; // Shift+D: vista Depth
  if (e.target.matches('textarea, select, input:not([type=checkbox]):not([type=range]):not([type=radio]):not([type=file])')) return;
  if (typeof drag !== 'undefined' && drag && drag.action === 'look') return; // WASD de la navegación tipo juego
  setZdf(!zdf.on);
});
zdfUI();
