# three.js r147: el bloom

`UnrealBloomPass.js` y `LuminosityHighPassShader.js` son los de three.js r147 (`examples/js/`), sin cambios. La app
corre sobre three.js r187 (`vendor/three`), pero el `UnrealBloomPass` de r187 es otro algoritmo (kernels más anchos,
mezcla con alfa premultiplicado y un ×3, render targets en half float) y con los mismos valores de Post processing
daba un bloom mucho más fuerte en 3D Render. Estos dos corren igual sobre r187: son scripts clásicos que
`index.html` carga después de `js/three-global.js` y dejan `THREE.UnrealBloomPass` y
`THREE.LuminosityHighPassShader` en el `THREE` global.

Licencia: MIT (`LICENSE`, la de three.js r147).
