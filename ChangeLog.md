# ChangeLog

One line per change, newest first. The version is in the app, next to its name at the top left (the BackplateLab version
it comes from is in its tooltip); it goes up by 0.001 with every change.

v1.009: The Path Trace tab is out: the path tracer is now the Path trace engine of 3D Render, the same as in BackplateLab. [ Edition - Path Trace out ]
v1.008: The 3D Assets and 3D Render tabs of BackplateLab are in too, the same as there. [ Edition - 3D Assets and 3D Render ]
v1.007: 3D Camera Pin is now the 3D Camera Pin edition of BackplateLab: its tabs Import and Measure, 2D Camera Match and 3D Camera Pin | Environment, the same as there, replace the Camera Pin and Import tabs; Path Trace stays, on that camera, scan and environment, with its playblast in its own bar. Updated from BackplateLab with tools/sync_backplatelab.mjs. [ Edition - BackplateLab tabs ]
v1.006: An OBJ loads with its texture: select or drop the .obj, its .mtl and the image together (also on the Import tab); the MTL path from another machine is matched by file name, and the note says which image was used or is missing. [ Scan - OBJ with its .mtl and texture ]
v1.005: New Import tab (Import and Measure): the plate, its metadata and the scan in four panes, with drag and drop of the metadata onto the camera fields, an orbit view of the scan with Measure and Scale, Frame, grid, Maximize and Remove. [ Import - Import and Measure ]
v1.004: Path Trace: Playblast renders the frame range path traced to an MP4, at 720p, 1080p or plate size, with quality presets (Draft, Preview, Good, Final or the Render panel settings) and the time left while it renders. [ Path Trace - Playblast ]
v1.003: Path Trace: the render is 720p or 1080p wide (or the plate size) and scales to the view; the camera moves in the tab with a coarse preview that fills in when it stops; the timeline bar is in the tab and moves the environment. [ Path Trace - Resolution, camera and timeline ]
v1.002: New Path Trace tab: renders the Camera Pin camera, scan, environment and sun with a GPU path tracer, with samples, bounces, denoise, sky or HDRI, plate or transparent background, depth of field and Save PNG. [ Path Trace - New tab ]
v1.001: The app shows its version number at the right of the tab bar and on the start screen, and saved projects keep it, so a build can be traced. [ App - Version number ]
v1.000: three.js updated from r147 to r187 (0.187.0), loaded as ES modules through an import map, with the same look as before. [ three.js r187 ]
