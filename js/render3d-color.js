// 3D Render, el manejo de color: se trabaja en ACEScg (lineal, primarios AP1) y cada visor muestra con su Viewer, como
// el de Maya: ACES 1.0 · Rec.709 o sRGB (el ODT), Rec.709 o sRGB sin tone map, o Raw. Es la misma matemática que el
// Viewer del plate (js/exr.js), que parte de Rec.709 lineal; acá se parte de AP1, así que la matriz de entrada del ajuste
// de S. Hill queda en su parte RRT_SAT (la de entrada de allá = RRT_SAT × Rec.709→AP1).
// Lo que entra a ACEScg:
// - colores de pantalla (los del entorno, el sol, el cielo y el suelo, los del editor de materiales): sRGB → lineal
//   Rec.709 → AP1;
// - texturas de color (map, emissiveMap) de las otras pestañas: se leen como sRGB y el shader pasa el texel a AP1; los
//   colores por vértice y por instancia (lineales) también pasan a AP1 en el shader;
// - HDRI: Linear sRGB (Rec.709) → AP1; ACEScg, tal cual.
// - el path tracer (js/render3d-pt.js) trabaja en lineal Rec.709: su imagen pasa a AP1 en el paso final (r3PtViewPixel es
//   la referencia en JS).
// API: R3_709_TO_AP1, R3_AP1_TO_709, R3_VIEWS, r3M3, r3HexToWs, r3WsToHex, r3ColorToWs, r3WsTo709, r3ViewPixel, r3PtViewPixel,
// r3ExpGain, R3_VIEW_GLSL, r3WsPatch.
const R3_709_TO_AP1 = [0.6130973, 0.3395229, 0.0473793, 0.0701942, 0.9163556, 0.0134526, 0.0206156, 0.1095698, 0.8698151];
const R3_AP1_TO_709 = [1.70505099, -0.62179212, -0.08325887, -0.13025642, 1.14080474, -0.01054832, -0.02400336, -0.12896869, 1.15297205];
// los Viewers, en el mismo orden y con los mismos nombres que el del plate
const R3_VIEWS = [['aces709', 'ACES 1.0 · Rec.709'], ['acessrgb', 'ACES 1.0 · sRGB'], ['r709', 'Rec.709 (no tone map)'], ['srgb', 'sRGB (no tone map)'], ['raw', 'Raw']];
const r3M3 = (M, a) => [M[0] * a[0] + M[1] * a[1] + M[2] * a[2], M[3] * a[0] + M[4] * a[1] + M[5] * a[2], M[6] * a[0] + M[7] * a[1] + M[8] * a[2]];
const r3SrgbToLin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const r3LinToSrgb = (c) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
// un color de pantalla (#rrggbb, sRGB) en ACEScg, como [r, g, b]
function r3HexToWs(hex) { const n = parseInt(String(hex).replace('#', ''), 16); return r3M3(R3_709_TO_AP1, [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => r3SrgbToLin(v / 255))); }
// y al revés, para mostrarlo en un selector de color (lo que no entra en Rec.709 se recorta)
function r3WsToHex(a) { return '#' + r3M3(R3_AP1_TO_709, a).map(v => Math.round(255 * r3LinToSrgb(Math.max(0, Math.min(1, v)))).toString(16).padStart(2, '0')).join(''); }
// un THREE.Color lineal Rec.709 pasado a ACEScg (en el lugar) y uno de ACEScg leído como Rec.709 lineal
function r3ColorToWs(c) { const v = r3M3(R3_709_TO_AP1, [c.r, c.g, c.b]); c.setRGB(v[0], v[1], v[2]); return c; }
const r3WsTo709 = (a) => r3M3(R3_AP1_TO_709, a);
// la referencia en JS del shader de abajo (los tests la comparan con el Viewer del plate): de AP1 lineal a lo que va a la
// pantalla, 0..1 (con Raw, el valor tal cual, recortado)
function r3ViewPixel(ap1, view, exposure = 1) {
  const c = ap1.map(v => v * exposure);
  if (view === 'raw') return c.map(v => Math.max(0, Math.min(1, v)));
  let o;
  if (view === 'aces709' || view === 'acessrgb') {
    const S = [0.970889, 0.026963, 0.002148, 0.010889, 0.986963, 0.002148, 0.010889, 0.026963, 0.962148]; // RRT_SAT
    const fit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
    o = r3M3([1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602], r3M3(S, c).map(fit));
  } else o = r3M3(R3_AP1_TO_709, c);
  o = o.map(v => Math.max(0, Math.min(1, v)));
  return view === 'aces709' || view === 'r709' ? o.map(v => Math.pow(v, 1 / 2.4)) : o.map(r3LinToSrgb);
}
// la exposición de la cámara de la toma, en stops (EV): +1 es el doble de luz. La usan los dos motores, antes del Viewer
const r3ExpGain = (ev) => Math.pow(2, Number.isFinite(+ev) ? +ev : 0);
// lo que muestra el Viewer de un pixel del path tracer: lineal Rec.709, premultiplicado por su alfa (a). Es el paso final
// de R3_FINAL_SHADER con in709: se separa el alfa, se pasa a ACEScg y sigue igual que Raster
function r3PtViewPixel(c709, view, ev = 0, a = 1) {
  const c = a > 1e-4 ? c709.map(v => v / a) : c709;
  return r3ViewPixel(r3M3(R3_709_TO_AP1, c), view, r3ExpGain(ev));
}
// el mismo Viewer en GLSL, en dos partes: r3ViewLin (a lineal de pantalla, donde trabaja el post) y r3ViewEnc (la
// codificación de la pantalla). view: 0 ACES · Rec.709, 1 ACES · sRGB, 2 Rec.709, 3 sRGB, 4 Raw
const R3_VIEW_GLSL = `
  vec3 r3Fit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
  vec3 r3ViewLin(vec3 c, int view) {
    if (view == 4) return clamp(c, 0.0, 1.0);
    const mat3 S = mat3(vec3(0.970889, 0.010889, 0.010889), vec3(0.026963, 0.986963, 0.026963), vec3(0.002148, 0.002148, 0.962148));
    const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    const mat3 T = mat3(vec3(1.70505099, -0.13025642, -0.02400336), vec3(-0.62179212, 1.14080474, -0.12896869), vec3(-0.08325887, -0.01054832, 1.15297205));
    return clamp(view <= 1 ? O * r3Fit(S * c) : T * c, 0.0, 1.0);
  }
  vec3 r3ViewEnc(vec3 c, int view) {
    if (view == 4) return c;
    if (view == 0 || view == 2) return pow(c, vec3(1.0 / 2.4));
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }`;
const r3ViewIndex = (v) => Math.max(0, R3_VIEWS.findIndex(x => x[0] === v));
// los materiales de 3D Render: el texel de color (sRGB, ya lineal Rec.709 al leerlo) y los colores por vértice y por
// instancia pasan a AP1 adentro del shader. Se aplica a las copias de la pestaña, nunca a los originales.
const R3_TO_AP1_GLSL = 'const mat3 R3_TO_AP1 = mat3(vec3(0.6130973, 0.0701942, 0.0206156), vec3(0.3395229, 0.9163556, 0.1095698), vec3(0.0473793, 0.0134526, 0.8698151));';
function r3WsPatch(m) {
  m.onBeforeCompile = (sh) => {
    // los chunks de three r187 (map_fragment, color_fragment, emissivemap_fragment) con el paso a AP1 en el medio
    sh.fragmentShader = R3_TO_AP1_GLSL + '\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        #ifdef DECODE_VIDEO_TEXTURE
          sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
        #endif
        sampledDiffuseColor.rgb = R3_TO_AP1 * sampledDiffuseColor.rgb;
        diffuseColor *= sampledDiffuseColor;
      #endif`)
      .replace('#include <color_fragment>', `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
        diffuseColor *= vec4( R3_TO_AP1 * vColor.rgb, vColor.a );
      #endif`)
      .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP
        vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
        #ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
          emissiveColor = sRGBTransferEOTF( emissiveColor );
        #endif
        totalEmissiveRadiance *= R3_TO_AP1 * emissiveColor.rgb;
      #endif`);
  };
  m.customProgramCacheKey = () => 'r3ws';
  m.needsUpdate = true;
  return m;
}
