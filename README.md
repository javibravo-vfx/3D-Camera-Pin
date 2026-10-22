# 3D Camera Pin

Single-frame matchmove tool. It solves a plate's camera from pins placed on a scan of the set (photogrammetry, LiDAR or gaussian splat), with the lens fixed.

It is a single HTML file that runs in the browser with nothing to install. Files are read locally: the scan and the plate are never uploaded anywhere.

**Live:** https://javibravo-vfx.github.io/3D-Camera-Pin/

## Workflow

1. **Plate & camera**: load the plate (EXR, JPG, PNG). For EXR, choose the input colorspace (ACES2065-1, ACEScg, ARRI Wide Gamut 3, Rec.2020, Rec.709) and the viewer transform (ACES 1.0 Rec.709 by default). Pick the sensor and the focal length. If the EXR carries camera and lens metadata, those fields fill in automatically.
2. **Scan & scale**: load the scan (OBJ, PLY, GLB/GLTF, FBX) and check the units and up axis. To set the scale:
   - In **Measure** mode, draw a line between two points of the scan on something of known size (a door, a curb).
   - Type its real length in meters and press Enter. The scan is scaled so that line matches.
   - Everything works in meters.
3. **Pins**: in Pins mode, click the scan to drop a pin, then drag it to its spot on the plate. The pose solves live. 4 to 6 pins spread in depth are enough.
4. **Export**: copy the camera script for 3ds Max (Physical or Free Camera), Nuke (Camera2) or Blender (Python).
   - By default the camera uses the plate format.
   - With **Use mask format** checked, it uses the mask crop instead. The crop is centered, the focal stays the same, and the film back and resolution are reduced to the crop.

## Film back, pixel aspect and knob names

- **Film back height** is computed from the width and the plate proportions by default. Untick **auto** to type it in; the solve keeps using the width as the reference, and the manual height goes into the export.
- **Pixel aspect** defaults to 1. Set it to the squeeze for anamorphic plates (1.3, 1.5, 1.8, 2, …), or let it come from the EXR's `pixelAspectRatio`.
  - The viewer shows the plate desqueezed, and the solve accounts for the squeeze.
  - The film width is the physical, squeezed sensor width. The export writes the desqueezed width (sensor × pixel aspect) plus the pixel aspect: `renderPixelAspect` in Max and `pixel_aspect_x` in Blender. In Nuke, set the format's pixel aspect.
- **Knob names** follow the **Nav** preset, so the film back reads as Film width (3ds Max), H film aperture (Maya), Aperture (Houdini), Sensor width (Blender) or haperture (Nuke). Maya shows the aperture in inches, so divide by 25.4.

## Scan display

| Mode | What it shows |
|---|---|
| Wireframe | Edges only, over the plate. |
| Solid | Gray shaded surface. |
| Flat (unlit) | Self-illuminated: textures and vertex colors at full value, with no shading. Best for photogrammetry and LiDAR scans whose geometry is too noisy to read once lit. |
| Original (lit) | The file's own materials with scene lighting. |

## Mask / safe frame

Pick an aspect ratio in **Mask** (top bar), or enter a custom one, to frame a plate shot wider or taller than the delivery format. Outside the frame is darkened, and the crop size in pixels is shown in the corner.

## Navigation

The tools (Navigate, Pins, Measure, Fit) sit in the vertical toolbar on the left of the viewer. The navigation preset, viewer transform and mask are in the top bar. The scan display controls (on/off, display mode, mix, point size, grid) sit at the top of the viewport itself.

Choose the 3D navigation preset from the **Nav** menu. Navigation works in Navigate and Measure modes.

| Preset | Orbit | Pan | Zoom |
|---|---|---|---|
| 3ds Max | Alt+MMB | MMB | Ctrl+Alt+MMB, wheel |
| Maya | Alt+LMB | Alt+MMB | Alt+RMB, wheel |
| Houdini | Space/Alt + LMB | Space/Alt + MMB | Space/Alt + RMB, wheel |
| Blender | MMB | Shift+MMB | Ctrl+MMB, wheel |
| Nuke | Alt+RMB, Ctrl+LMB | Alt+LMB | Alt+MMB, wheel |
| Simple mouse | LMB | RMB | MMB, wheel |

In Pins mode the camera is driven by the pins. The mouse works on the plate instead:
- Wheel zooms.
- Alt + drag, MMB or Space + drag pans.

## Shortcuts

| Key | Action |
|---|---|
| `N` / `P` / `M` | Navigate / Pins / Measure mode |
| `H` | Show / hide the scan |
| `F` | Fit the plate |
| `Esc` (Measure) | Clear the measurement |
| `Delete` | Delete the selected pin |
| RMB on a pin | Delete that pin |

## Formats

**Scan**
- OBJ, GLB/GLTF, FBX and PLY (mesh or point cloud).
- Gaussian-splat PLYs are read as their centers, with color from `f_dc_*`. Near-transparent splats are dropped.

**Plate**
- EXR: scanline, half or float, with NONE, RLE, ZIP, ZIPS, PIZ, PXR24, DWAA or DWAB compression. Overscan (data window) is supported.
- JPG and PNG.

**EXR metadata**
- Focal length from `nominalFocalLength`, `pinholeFocalLength` or `effectiveFocalLength`.
- Film back from `sensorAcquisitionRectangle` × `sensorPhotositePitch`.
- Camera and lens make/model.
- Vendor keys containing `focal` or `sensor`.

## How it solves

Perspective-n-Point with known intrinsics (film back and focal):
- With 1 or 2 pins it only adjusts rotation.
- From 3 pins it solves rotation and position with Levenberg-Marquardt.
- From 6 pins it adds a DLT initialization and can optionally estimate the focal length.

Each pin shows its reprojection error in pixels.

## Limitations

- No lens distortion correction: undistort wide-angle plates first.
- EXR with B44/HTJ2K compression, tiled, multipart or layered channels is not supported.
- The ACES view is a fitted approximation of the RRT+ODT: good for placing pins, but not a match for OCIO.

## Dependencies

Loaded from CDNs, so the first load needs a connection:
- [three.js](https://threejs.org) r147, for the viewer and the loaders.
- Google Fonts.
