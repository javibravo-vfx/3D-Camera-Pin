// 3D Guides en hidden line: las líneas del entorno 3D (calle, carriles, veredas, fachadas, puertas, gente, autos,
// vías, andenes, trenes) como en un dibujo de línea oculta: sólo lo que la cámara ve, sin lo que queda detrás.
// Se arma en pantalla, así sirve para cualquier entorno (ENV_MODULES) sin saber cómo está hecho: el entorno se dibuja
// con su propio WebGL en un render target (color y profundidad) y un shader marca los bordes donde la profundidad
// deja de ser un plano (siluetas, aristas) o donde cambia el color (pintura de carriles, ventanas, puertas).
// Las partes se pueden dejar afuera: 'cars', 'people' y 'lcars' (Cars in lanes) se marcan al armar el entorno con
// userData.guide (js/environment.js, js/lane-cars.js), y lo de adentro de esos grupos hereda la marca; 'lanes', 'curbs' y 'facades' salen del material (guidesCat), como los grupos
// Lanes / Curbs / Facades del estilo Lines. En la estación: las vías son Lanes, los andenes Curbs y techos, postes y
// paredes Facades.
// API: guidesImage({ cam, W, H, k, skip, color, grid }) -> canvas transparente con las líneas, de W·k × H·k px, o
// null sin entorno. Con grid (1 o 2), en lugar de las líneas, la grilla de medición de ese paso en metros sobre el piso
// y las fachadas (sin autos ni gente). La usan las 3D Guides (js/ghost.js), la grilla de DepthLab y VFX Shooting Sup.
// El canvas es siempre el mismo: hay que copiarlo antes de volver a llamar.
let guidesGl = null;
function guidesInit() {
  if (guidesGl) return guidesGl;
  const cv = document.createElement('canvas');
  let r;
  try { r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: false, preserveDrawingBuffer: true }); } catch (e) { return null; }
  if (!r.capabilities.isWebGL2) { r.dispose(); return null; } // la profundidad en float es de WebGL2
  r.setPixelRatio(1); r.setClearColor(0x000000, 0); r.autoClear = false; r.outputColorSpace = THREE.LinearSRGBColorSpace; // como el default de r147
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x4a4a4a, 0.85 * Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI); sun.position.set(0.55, 1, 0.3); sc.add(sun);
  const rt = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
  rt.depthTexture = new THREE.DepthTexture(2, 2, THREE.FloatType);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tCol: { value: rt.texture }, tDep: { value: rt.depthTexture }, px: { value: new THREE.Vector2() }, near: { value: 0.2 }, far: { value: 4000 }, col: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tCol, tDep; uniform vec2 px; uniform float near, far; uniform vec3 col; varying vec2 vUv;
      // 1 / distancia: en un plano es lineal en la pantalla, así su laplaciano es 0 y sólo marca aristas y siluetas
      float W(vec2 uv) { float d = texture2D(tDep, uv).x; return d >= 0.999999 ? 0.0 : (far - d * (far - near)) / (near * far); }
      void main() {
        float c = W(vUv), l = W(vUv - vec2(px.x, 0.0)), r = W(vUv + vec2(px.x, 0.0)), u = W(vUv + vec2(0.0, px.y)), b = W(vUv - vec2(0.0, px.y));
        float m = max(max(c, l), max(max(r, u), b));
        if (m <= 0.0) discard;
        float e = max(abs(2.0 * c - l - r), abs(2.0 * c - u - b)) / m;
        // silueta contra el cielo: un lado tiene algo y el otro no
        bool sky = (c > 0.0) && (l <= 0.0 || r <= 0.0 || u <= 0.0 || b <= 0.0);
        vec3 a = texture2D(tCol, vUv).rgb, ar = texture2D(tCol, vUv + vec2(px.x, 0.0)).rgb, ab = texture2D(tCol, vUv - vec2(0.0, px.y)).rgb;
        float dc = max(length(a - ar), length(a - ab));
        if (!(sky || e > 0.04 || (c > 0.0 && dc > 0.11))) discard;
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false, transparent: true,
  });
  const qs = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; qs.add(quad);
  // la grilla de medición: de la profundidad sale el punto del entorno de cada px (en metros, con la calle) y su
  // normal; el piso lleva líneas cada `cell` m en X y Z, las fachadas en Y y Z (o X e Y si miran a la cámara).
  // Lejos, donde las líneas quedarían a menos de ~3 px, se apaga.
  const gmat = new THREE.ShaderMaterial({
    uniforms: { tDep: { value: rt.depthTexture }, px: { value: new THREE.Vector2() }, iP: { value: new THREE.Matrix4() }, toE: { value: new THREE.Matrix4() }, cell: { value: 1 }, col: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDep; uniform vec2 px; uniform mat4 iP, toE; uniform float cell; uniform vec3 col; varying vec2 vUv;
      vec3 P(vec2 uv) { float d = texture2D(tDep, uv).x; vec4 v = iP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w; return (toE * v).xyz; }
      bool sky(vec2 uv) { return texture2D(tDep, uv).x >= 0.999999; }
      void main() {
        vec2 ua = vUv + vec2(px.x, 0.0), ub = vUv + vec2(0.0, px.y);
        if (sky(vUv) || sky(ua) || sky(ub)) discard;
        vec3 p = P(vUv), a = P(ua), b = P(ub), n = abs(normalize(cross(a - p, b - p)));
        vec2 g, ga, gb;
        if (n.y >= n.x && n.y >= n.z) { g = p.xz; ga = a.xz; gb = b.xz; }
        else if (n.x >= n.z) { g = p.zy; ga = a.zy; gb = b.zy; }
        else { g = p.xy; ga = a.xy; gb = b.xy; }
        g /= cell; ga /= cell; gb /= cell;
        vec2 w = max(abs(ga - g), abs(gb - g)); // celdas por px en cada eje
        float al = 0.0;
        for (int k = 0; k < 2; k++) {
          float wk = k == 0 ? w.x : w.y, gk = k == 0 ? g.x : g.y;
          if (wk > 0.33) continue;
          float f = abs(fract(gk + 0.5) - 0.5);
          if (f < max(wk, 1e-4) * 0.75) al = max(al, 1.0 - smoothstep(0.15, 0.33, wk));
        }
        if (al <= 0.0) discard;
        gl_FragColor = vec4(col, al);
      }`,
    depthTest: false, depthWrite: false, transparent: true,
  });
  const gqs = new THREE.Scene(), gquad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gmat); gquad.frustumCulled = false; gqs.add(gquad);
  return guidesGl = { cv, r, sc, rt, mat, qs, gmat, gqs, qc: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}
// la cámara de la vista con near / far propios (la profundidad del render target alcanza para la calle entera); se
// toca la proyección a mano para no perder el desplazamiento del centro óptico de applyIntrinsics
const GUIDES_NEAR = 0.2, GUIDES_FAR = 4000;
let guidesMatCat = null;
function guidesCat(o) {
  if (o.userData.guide) return o.userData.guide;
  if (!guidesMatCat) {
    const E = ENV_MAT, M = RAIL_MAT;
    guidesMatCat = new Map([[E.paintW, 'lanes'], [E.paintY, 'lanes'], [M.rail, 'lanes'], [M.sleeper, 'lanes'], [M.ballast, 'lanes'],
      [E.walk, 'curbs'], [E.median, 'curbs'], [M.platform, 'curbs'], [M.edge, 'curbs'], [M.tactile, 'curbs'],
      [E.building, 'facades'], [E.window, 'facades'], [E.door, 'facades'], [E.pole, 'facades'], [E.lamp, 'facades'], [M.pole, 'facades'], [M.roof, 'facades'], [M.wall, 'facades']]);
  }
  return o.material && !Array.isArray(o.material) ? guidesMatCat.get(o.material) || '' : '';
}
function guidesCam(cam) {
  const c = cam.clone(); c.matrixWorld.copy(cam.matrixWorld); c.matrixWorldInverse.copy(cam.matrixWorldInverse);
  c.matrixAutoUpdate = false; c.projectionMatrix.copy(cam.projectionMatrix);
  const e = c.projectionMatrix.elements, n = GUIDES_NEAR, f = GUIDES_FAR;
  if (Math.abs(e[11] + 1) < 1e-6) { e[10] = -(f + n) / (f - n); e[14] = -2 * f * n / (f - n); } // perspectiva
  c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
  return c;
}
function guidesImage({ cam = camera, W = st.plate.W, H = st.plate.H, k = 1, skip = {}, color = '#ffffff', grid = 0 } = {}) {
  if (!ENV_MODULES[env.id] || !envRoot.children.length) return null;
  const g = guidesInit(); if (!g) return null;
  const w = Math.max(2, Math.round(W * k)), h = Math.max(2, Math.round(H * k));
  if (g.cv.width !== w || g.cv.height !== h) { g.r.setSize(w, h, false); g.rt.setSize(w, h); }
  const c = guidesCam(cam);
  if (grid > 0) { skip = { ...skip, cars: true, lcars: true, people: true }; envRoot.updateMatrixWorld(true); g.gmat.uniforms.toE.value.copy(envRoot.matrixWorld).invert().multiply(c.matrixWorld); }
  // el entorno entero (aunque Env esté apagado), opaco (sin el Env mix) y sin las partes que se saltean
  const par = envRoot.parent, vis = envRoot.visible, hid = [], shown = [], mats = [];
  // la categoría de un objeto: la suya, la de su grupo (gente, autos) o la de su material. '' es lo que no es nada de
  // eso (el piso, otros objetos del entorno): se saltea con skip[''] sólo en lo que se dibuja, no en los grupos
  (function walk(o, inh) {
    const cat = o.userData.guide || inh || guidesCat(o);
    if (o.visible && skip[cat] && (cat || o.material)) { o.visible = false; hid.push(o); }
    else if (!o.visible && o.userData.chipOff && !skip[cat]) { o.visible = true; shown.push(o); } // los autos que apaga el chip Cars del visor: las guías tienen su Cars
    for (const ch of o.children) walk(ch, o.userData.guide || inh);
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.userData.envOp !== undefined && m.opacity !== m.userData.envOp) { mats.push([m, m.opacity, m.transparent]); m.opacity = m.userData.envOp; m.transparent = m.userData.envTr; }
  })(envRoot, '');
  envRoot.visible = true; g.sc.add(envRoot);
  try {
    g.r.setRenderTarget(g.rt); g.r.clear(); g.r.render(g.sc, c);
    g.r.setRenderTarget(null); g.r.clear();
    if (grid > 0) { const u = g.gmat.uniforms; u.px.value.set(1 / w, 1 / h); u.iP.value.copy(c.projectionMatrixInverse); u.cell.value = grid; u.col.value.set(color); g.r.render(g.gqs, g.qc); }
    else { const u = g.mat.uniforms; u.px.value.set(1 / w, 1 / h); u.near.value = GUIDES_NEAR; u.far.value = GUIDES_FAR; u.col.value.set(color); g.r.render(g.qs, g.qc); }
  } finally {
    if (par) par.add(envRoot); else g.sc.remove(envRoot);
    envRoot.visible = vis; hid.forEach(o => { o.visible = true; }); shown.forEach(o => { o.visible = false; });
    mats.forEach(([m, op, tr]) => { m.opacity = op; m.transparent = tr; });
  }
  return g.cv;
}
