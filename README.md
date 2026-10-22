# 3D Camera Pin

Herramienta de matchmove para un solo frame: resuelve la cámara de un plate usando pines sobre un scan del set (fotogrametría, LiDAR o gaussian splat), con la lente fija.

Es un único archivo HTML. Corre en el navegador, sin instalar nada, y los archivos se leen en local: el scan y el plate no se suben a ningún lado.

## Uso

1. Abrí `index.html` en Chrome, Edge o Firefox. También se puede publicar con GitHub Pages.
2. **Scan y escala**: cargá el scan (OBJ, PLY, GLB/GLTF, FBX). Revisá las unidades y el eje vertical, y verificá la escala con **Medir** sobre algo de medida conocida (una puerta, un cordón). Todo se trabaja en metros.
3. **Plate y cámara**: cargá el plate (EXR, JPG, PNG), elegí el sensor y la lente. Si el EXR trae metadata de cámara y lente, se completan solos.
4. **Pines**: en modo Pines, hacé click sobre el scan para crear un pin y arrastralo a su lugar en el plate. La pose se resuelve en vivo. Con 4 a 6 pines repartidos en profundidad alcanza.
5. **Exportar**: copiá el script de la cámara para 3ds Max (Physical o Free Camera), Nuke (Camera2) o Blender (Python).

## Atajos

| Tecla / gesto | Acción |
|---|---|
| `N` / `P` / `M` | Modo Navegar / Pines / Medir |
| `F` | Encuadrar el plate |
| Rueda (modo Pines) | Zoom 2D sobre el plate |
| `Alt` + arrastrar, botón medio o `Espacio` + arrastrar | Paneo del plate |
| Botón derecho sobre un pin | Borrar pin |
| `Supr` | Borrar el pin seleccionado |

## Formatos

**Scan**
- OBJ, GLB/GLTF, FBX y PLY (malla o nube de puntos).
- En los PLY de gaussian splat usa los centros, toma el color de `f_dc_*` y descarta los splats casi transparentes.

**Plate**
- EXR scanline en half o float, con compresión NONE, RLE, ZIP, ZIPS, PIZ, PXR24, DWAA o DWAB, overscan incluido.
- JPG y PNG.

**Color del EXR**
- Detecta el colorspace por los primarios del header: ACES2065-1, ACEScg, ARRI Wide Gamut 3, Rec.2020 o Rec.709.
- La vista por defecto es ACES 1.0 a Rec.709, con una aproximación del RRT+ODT. También hay vista sRGB, sin tone map y sin transformar.
- Tiene control de exposición.

**Metadata del EXR**
- Lee `nominalFocalLength`, `pinholeFocalLength` y `effectiveFocalLength`.
- Calcula el film back con `sensorAcquisitionRectangle` × `sensorPhotositePitch`.
- También lee cámara y óptica, y busca claves de otros fabricantes que contengan `focal` o `sensor`.

## Cómo resuelve

Usa Perspective-n-Point con los intrínsecos conocidos (film back y focal):
- Con 1 o 2 pines solo ajusta la rotación.
- Desde 3 pines resuelve rotación y posición con Levenberg-Marquardt.
- Desde 6 pines agrega una inicialización por DLT y, si querés, puede estimar la focal.

Muestra el error de reproyección de cada pin en píxeles.

## Limitaciones

- No corrige distorsión de lente: con angulares, desdistorsioná el plate antes.
- Asume píxeles cuadrados, así que no sirve para anamórfico.
- No lee EXR con compresión B44 o HTJ2K, ni tileados, multipart o con canales en capas.
- El tone map de ACES es una aproximación: sirve para ubicar pines, pero no es la transformación exacta de OCIO.

## Dependencias

Las carga desde CDN, así que la primera vez necesita conexión:
- [three.js](https://threejs.org) r147: visor y loaders.
- Fuentes de Google Fonts.
