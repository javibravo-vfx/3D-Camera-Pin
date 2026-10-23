# 3D Camera Pin

Single-frame matchmove tool. It solves a plate's camera from pins placed on a scan of the set (photogrammetry, LiDAR or gaussian splat), with the lens fixed.

It is a single HTML file that runs in the browser with nothing to install. Files are read locally: the scan and the plate are never uploaded anywhere.

**Live:** https://javibravo-vfx.github.io/3D-Camera-Pin/

## Workflow

It opens empty. **Demo** (top of the panel) loads the demo scene, which is:
- **Plate**: a hood-mount shot through the windshield of a car on a green screen stage, with a driver and a passenger. Alexa Mini LF Open Gate, 24 mm.
- **Scan**: the matching empty car interior, in meters.

The panel header also has **Open**, **Save**, **Demo** and **Reset all**.


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

## Camera height, scan offset and orientation

- **Ground**: world y = 0, shown by the 1 m grid.
- **Camera height**: the info bar under the viewport shows the camera height above the ground as an editable field. Changing it moves only the camera, for fine adjustment; tilt, roll and yaw sit next to it as fields too.
- **Height offset** (Scan & scale): moves the scan and the camera up or down together, so the match holds and only the distance to the ground changes. **Sit on ground** puts the lowest point of the scan at y = 0. In both cases the 3D camera follows.
  - The environment's **Ground to scan** respects the offset.
  - The export notes tell you how far to move the scan in your DCC.
- **Orientation from EXR metadata**: tilt, roll and yaw are read from vendor attributes such as `CameraTilt`, `CameraRoll` or `Pan`/`Yaw`.
  - They are applied on load (**Apply on load**, on by default). **Apply** sets them again if the camera drifts after adjustments.
  - The camera position is kept, and values missing from the file keep the current ones.

## Camera badge

The top bar always shows the camera in use: sensor preset, film back and focal length. If the plate metadata names a different camera than the current preset, the badge turns amber, and hovering it shows what the file says.

## Layout

- **Top bar, first row**: viewer LUT on the left; centred over the image, **↓ EXR** + FOCAL + lock, then **↓ EXR** + TILT / ROLL + lock, then YAW and HEIGHT; camera badge on the right. **↓ EXR** pulls the value from the plate metadata.
- **Top bar, second row**: mask on the left (under the viewer), the pin actions (Clear / Bake / Solved cam) centred, plate resolution (and RMS while pinning) on the right.
- **Info bar** (under the viewport): cursor x/y on the left, the mode hint, and **Nav** (navigation preset) on the right.
- **Panel**: every section starts collapsed. While no plate or scan is loaded, the Plate and Scan headers show a **Load** button; once loaded they show a green check, or an amber warning for a sample plate or an unverified scale.

## Solve locks

The top bar has two locks for the solve (padlock buttons):
- **Lock focal** (on by default) keeps the focal length fixed; its field shows dashed while locked. Untick it to type or drag the focal right there and let the pins refine it: 6 pins, or 4 with tilt/roll locked.
- **EXR** next to the focal sets it from the EXR metadata.
- **Lock tilt/roll** freezes the camera's current tilt and roll everywhere: the pins only adjust yaw and position (two pins are enough), and navigation only turns in yaw and moves.
- **EXR** next to tilt/roll sets them from the EXR metadata.
- In the top bar, **HEIGHT / TILT / ROLL / YAW** are fields: drag them or click and type. Tilt and roll are disabled while locked.

**Clear pins**, next to **Solved cam**, deletes every pin and leaves the camera where it is.

**Bake pins** locks the current pins in place. They keep taking part in the solve, but they can't be dragged or deleted by accident (they turn violet). You can then add more pins on top to refine. **Unbake** releases them.

**Undo / Redo** (tool rail, `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`) steps back through pin edits: creating, moving, deleting, toggling, clearing, baking and solving. Each step restores the camera as it was.

## Fields and sliders

- One rule everywhere: **a boxed value is editable**, a dashed box is locked, plain text is a readout.
- **Numeric fields** show their unit (mm, m, ×) inside the box.
  - Click and drag left or right to change the value. Hold Shift for fine steps, Ctrl for coarse.
  - A plain click lets you type. With the field selected, the Up/Down arrow keys nudge by one step (Shift ×10, Alt ×0.1), as in Nuke.
- **Sliders**: double-click resets them to their default.
- **Exposure** on the viewport is a viewer gain in stops for the plate only. The mask darkening and the scan overlay are not affected.

## Projects

**Save** writes a small `.camerapin.json` file (a few KB) with everything you set up:
- Lens and film back, pixel aspect, colorspace, viewer and exposure.
- Scan units, axis, scale and height offset.
- Pins, the measurement, the camera and the solved camera.
- Locks, mask, export settings, chroma key and environment.

The plate and the scan are not stored in the file, only their names. When you **Open** a project, a card lists the files it needs. Load them with Load plate and Load scan, or drop them on the viewer, and the project restores itself. Demo projects restore directly. You can also drop a `.json` project on the viewer.

## Reset all

**Demo** asks before replacing a scene that has a plate, scan or pins, with an option to save the project first.


**Reset all**, in the panel header, asks for a second click and then:
- Removes the plate and the scan, including the sample.
- Clears pins, measurements, mask, key and environment.
- Sets the camera values back to their defaults.

Use it to start from an empty project. UI preferences are kept: navigation preset, viewer transform and panel width.

## Scan texture

**Texture → Apply image** (Scan & scale) maps an image onto every mesh of the scan, for scans that came without a texture or whose texture isn't embedded. It uses the mesh UVs and switches the view to **Flat (unlit)**. **Remove** goes back to the file's own materials.

## Chroma key

Turn on **Chroma key** in Plate & camera, or use the **Key** chip or the `K` key, to pull a green or blue screen out of the plate.
- **Controls**: screen color, threshold, softness, despill, and a Comp / Matte view to check the alpha.
- **Background**: with the key on, the environment renders behind the plate, so you see the actors inside the car over the avenue. The scan overlay stays on top.
- **What it keys**: the displayed plate, so EXRs are keyed after the viewer transform. It is a quick color-difference key for checking the match, not a final comp key.

## Environments

Modular 3D set pieces you can turn on behind or around the scan to check a match. They live in world meters, independent of the scan's own transform. Pick one in **Environment → Module**, and toggle it with the **Env** chip on the viewport or the `E` key.

**Avenue / street**
- Number of lanes, lane width, median width (0 gives a painted center line), sidewalk width and length.
- Traffic on/off with real-size sedans, hatchbacks and SUVs (body, glass, roof, wheels and lights), with density and a clear zone around the origin so no car overlaps the hero vehicle. **Shuffle** generates new traffic.
- Street lights and buildings on/off.
- Placement: offset X/Z, ground height and rotation. **Ground to scan** sets the ground to the lowest point of the scan.
- Display as solid or wireframe.
- **Car models**:
  - **Car pack** (default) uses 9 real-size, low-poly models: sedan, hatchback, compact, SUV, wagon, minivan, pickup, coupe and off-roader. They are mixed in realistic proportions (mostly sedans, hatchbacks and SUVs), and each car gets its own paint colour. The pack loads from `cars.glb` (about 2 MB) next to the page.
  - **Simple boxes** gives the procedural sedans, hatchbacks and SUVs. They are also used if `cars.glb` can't be loaded.
  - **My models** uses car files you load (GLB/GLTF, including Draco/meshopt-compressed, FBX, OBJ). Each one is turned so its length runs along the road, sat on the ground, and kept at its own size if it is already 2.5–8 m long; otherwise it is scaled to a 4.6 m car.
  - **Flip model front** turns them around if they drive backwards.
- **Road crown**: how much lower the road is at the curb than at the centre line (0 = flat, as before). **Crown curve** sets the profile: 1 is a straight slope, higher values keep the middle flatter and curve down harder near the curb. With a median, each carriageway falls from the median edge. Lane lines, sidewalks and posts follow it, and the cars sit on it and lean with the slope.
- **Traffic flow**: Two-way, or One-way with every car facing the same way. One-way drops the double yellow centre line for a plain lane line. **Reverse direction** turns the flow around.
- The **Measure** tool also picks the environment (cars, road, posts), so you can compare a traffic car against your scan. A measurement with an end on the environment is a size check only and never rescales the scan.
  - Loaded models last for the session.

New modules plug into `ENV_MODULES` in `index.html`. Each one declares its parameters (numbers and toggles) and a `build(params, rng, origin)` function that returns a three.js group. The panel builds its controls from that list, so adding a module needs no UI work.

## Scan orientation and scale

- **File up axis** says how the file was written: Y up, Z up, or Y down (COLMAP). The app always works Y-up internally, and the export converts to Z-up for 3ds Max and Blender (Nuke stays Y-up), so this setting never changes how you work in Max.
- **Rotation** X / Y / Z (degrees) and **Flip** (180° on X) fix a scan that came in upside down or turned. The export note tells you the matching rotation to apply to the imported scan in your DCC, already converted to Z-up for 3ds Max and Blender.
- **Scale** shows the factor from the last measurement. Click it to type a different factor by hand.

## Gaussian splats

Gaussian-splat PLYs (with `scale_*`, `rot_*`, `f_dc_*` and `opacity`) open in **Splat (gaussians)** mode. They are drawn as real anisotropic splats with depth sorting, not as points. Picking pins and measuring still uses the splat centers. Switch the display menu to see them as points. Very large splats are thinned to 3 million.

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

Choose the 3D navigation preset from the **Nav** menu (Maya by default). Navigation works in Navigate and Measure modes.

The properties panel can be resized by dragging the handle between it and the viewer; double-click the handle to reset its width.

| Preset | Orbit | Pan | Zoom |
|---|---|---|---|
| Maya | Alt+LMB | Alt+MMB | Alt+RMB, wheel |
| 3ds Max | Alt+MMB | MMB | Ctrl+Alt+MMB, wheel |
| Houdini | Space/Alt + LMB | Space/Alt + MMB | Space/Alt + RMB, wheel |
| Blender | MMB | Shift+MMB | Ctrl+MMB, wheel |
| Nuke | Alt+RMB, Ctrl+LMB | Alt+LMB | Alt+MMB, wheel |
| Simple mouse | LMB | RMB | MMB, wheel |
| Game (fly) | Hold RMB and move the mouse to look | MMB | WASD (Q/E down/up, Shift fast) while holding RMB; wheel moves forward |

The **Game** preset is a first-person fly mode: it lets you go inside objects, such as a car's cabin. While RMB is held, the wheel changes the fly speed.

In Pins mode the camera is driven by the pins. The mouse works on the plate instead:
- Wheel zooms.
- Alt + drag, MMB or Space + drag pans.

## Shortcuts

| Key | Action |
|---|---|
| `N` / `P` / `M` | Navigate / Pins / Measure mode |
| `H` | Show / hide the scan |
| `B` | Show / hide the plate |
| `E` | Show / hide the environment |
| `K` | Chroma key on / off |
| `F` | Fit the plate |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo pin edits |
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
- Focal length is read from, in order:
  - `nominalFocalLength`, `pinholeFocalLength` or `effectiveFocalLength`.
  - Any attribute whose name contains `focal` (values in mm, meters or microns, as numbers, strings like "35mm", or rationals).
  - A "Focal length: 35 mm" text inside an attribute.
  - The number in the lens name (e.g. "Signature Prime 47").
- If none is found, click a value in the metadata list to use it as the focal.
- Film back from `sensorAcquisitionRectangle` × `sensorPhotositePitch`.
- Camera model (`cameraModel` or vendor keys such as `com.arri.camera.CameraModel`). It is matched to a sensor preset, picking the mode that fits the plate's aspect.
- Lens make and model.
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
- Google Fonts (Inter, JetBrains Mono).

## Credits

- Default traffic cars: ["Generic passenger car pack"](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5) by Comrade1280, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: converted to `cars.glb` with `tools/convert_cars.py`. Textures were baked into vertex colours and the paint split out so it can be recoloured. Each car is oriented front to −Z on the ground in metres, and the sports car is left out.
