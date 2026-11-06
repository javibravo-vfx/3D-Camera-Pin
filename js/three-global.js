// three.js como el THREE global que usan los scripts de la app. Es el único módulo: desde r148 los addons (loaders,
// pases) sólo vienen como módulos ES. index.html lo carga con su import map ('three' y 'three/addons/' van a vendor/,
// nada desde CDN) y los scripts de la app van con defer: los módulos y los defer corren en el orden del documento,
// así que cuando corre js/version.js el THREE global ya está. La copia de vendor/ la arma tools/vendor_three.mjs.
import * as THREE_NS from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as fflate from 'three/addons/libs/fflate.module.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
// El bloom (THREE.UnrealBloomPass) es el de r147, que corre igual sobre r187: vendor/three-r147/, script clásico que
// index.html carga después de este módulo. El de r187 es otro (kernels, mezcla y precisión) y cambiaba el look.

// El color se maneja como en r147: los colores hex y los de los materiales van tal cual, sin pasar de sRGB a lineal (la
// app los convierte donde hace falta, como 3D Render). Las texturas sRGB y la salida a pantalla siguen en sRGB.
THREE_NS.ColorManagement.enabled = false;
// En r147 el OBJLoader y el PLYLoader pasaban siempre los colores por vértice de sRGB a lineal (igual que
// js/obj-worker.js); en r187 lo hacen sólo con el manejo de color prendido: se prende mientras leen.
const srgbVertexColors = (L) => class extends L {
  parse(...a) {
    const cm = THREE_NS.ColorManagement, keep = cm.enabled; cm.enabled = true;
    try { return super.parse(...a); } finally { cm.enabled = keep; }
  }
};

window.THREE = Object.assign({}, THREE_NS, {
  OBJLoader: srgbVertexColors(OBJLoader), PLYLoader: srgbVertexColors(PLYLoader), GLTFLoader, DRACOLoader, FBXLoader,
  EXRLoader, HDRLoader, Pass, FullScreenQuad, SAOPass, CopyShader,
});
window.MeshoptDecoder = MeshoptDecoder;
window.fflate = fflate;
