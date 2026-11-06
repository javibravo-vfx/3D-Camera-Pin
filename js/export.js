// ---------- Export ----------
// ---------- Mask / safe frame ----------
function maskAspect() {
  const v = $('mask').value;
  if (v === 'custom') { const c = +$('mask-c').value; return c > 0 ? c : 0; }
  return +v || 0;
}
// centered crop of the plate, in plate pixels
function maskRect() {
  const W = st.plate.W, H = st.plate.H, a = maskAspect(), p = par(), pa = W * p / H;
  if (!a || Math.abs(a - pa) < 1e-4) return { x: 0, y: 0, w: W, h: H };
  if (a < pa) { const w = Math.round(H * a / p); return { x: (W - w) / 2, y: 0, w, h: H }; }
  const h = Math.round(W * p / a); return { x: 0, y: (H - h) / 2, w: W, h };
}
function camData() { return withShotCam(camDataNow); } // la cámara de la toma (Store cam / Recall cam), no la vista navegada
function camDataNow() {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const X = [e[0], e[1], e[2]], Y = [e[4], e[5], e[6]], Z = [e[8], e[9], e[10]], C = [e[12], e[13], e[14]];
  const A = (v) => [v[0], -v[2], v[1]]; // Y-up -> Z-up (Max / Blender)
  const eul = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().extractRotation(camera.matrixWorld), 'YXZ');
  const crop = $('exp-crop').checked && maskAspect() ? maskRect() : null;
  const W = crop ? crop.w : st.plate.W, H = crop ? crop.h : st.plate.H;
  // same focal and center; film back shrinks with the crop. Horizontal is exported desqueezed (sensor × pixel aspect)
  const p = par();
  const sw = st.sw * p * W / st.plate.W;
  const sh = shUsed() * H / st.plate.H;
  return { X, Y, Z, C, Xm: A(X), Ym: A(Y), Zm: A(Z), Cm: A(C), eul, f: focalUsed(), sw, sh, W, H, crop, p };
}
const n6 = (v) => (Math.abs(v) < 5e-13 ? 0 : v).toFixed(6);
function updateExport() {
  { const a = maskAspect(), c = maskRect(); $('crop-info').textContent = a ? `(${c.w} × ${c.h})` : '(set a mask in the top bar)'; }
  const t = $('target').value, name = ($('camname').value || 'MatchCam').replace(/[^\w-]/g, '_');
  const d = camData();
  const v3 = (v) => `[${v.map(n6).join(',')}]`;
  const header = `BackplateLab · ${st.plate.sample ? 'sample plate' : st.plate.name} ${d.crop ? `crop ${d.W}x${d.H} of ${st.plate.W}x${st.plate.H} (mask ${maskAspect().toFixed(2)}:1)` : `${d.W}x${d.H}`} · film back ${fmt(d.sw, 3)} × ${fmt(d.sh, 3)} mm${d.p !== 1 ? ` (desqueezed, pixel aspect ${d.p})` : ''} · focal ${fmt(d.f, 3)} mm · RMS ${st.rms != null ? fmt(st.rms, 2) + ' px' : '–'}`;
  const scaleNote = `Scan transform: units x${st.unit} · scale ${fmt(st.userScale, 6)} · up ${st.up} · height offset ${fmt(st.scanY || 0, 4)} m`;
  let out = '';
  if (t === 'max-phys' || t === 'max-free') {
    out = `-- ${header}\n-- ${scaleNote}\n-- Meters, Z up. Paste into the MAXScript Listener or a new script and evaluate (Ctrl+E).\n(\n`
      + `  local k = try (units.decodeValue "1m") catch (1.0)\n`
      + `  local tm = matrix3 ${v3(d.Xm)} ${v3(d.Ym)} ${v3(d.Zm)} (${v3(d.Cm)} * k)\n`;
    if (t === 'max-phys') {
      out += `  local cam = Physical_Camera name:"${name}" targeted:false\n`
        + `  try (cam.specify_fov = false) catch ()\n`
        + `  try (cam.film_width_mm = ${n6(d.sw)}) catch (format "Could not set film_width_mm\\n")\n`
        + `  try (cam.focal_length_mm = ${n6(d.f)}) catch (format "Could not set focal_length_mm\\n")\n`;
    } else {
      const hfov = 2 * Math.atan(d.sw / 2 / d.f) * 180 / Math.PI;
      out += `  setRendApertureWidth ${n6(d.sw)}\n`
        + `  local cam = Freecamera name:"${name}" fovType:1 fov:${n6(hfov)}\n`;
    }
    out += `  cam.transform = tm\n`
      + `  renderWidth = ${d.W}\n  renderHeight = ${d.H}\n`
      + `  try (renderPixelAspect = ${n6(d.p)}) catch ()\n`
      + `  displaySafeFrames = true\n`
      + `  try (viewport.setCamera cam) catch ()\n`
      + `  select cam\n`
      + `  -- Background plate: Alt+B in the camera viewport and pick ${st.plate.sample ? 'your plate' : st.plate.name}\n`
      + `  cam\n)\n`;
  } else if (t === 'nuke') {
    const r2d = 180 / Math.PI;
    out = `# ${header}\n# ${scaleNote}\n# Meters, Y up. Copy and paste into the Node Graph.\nCamera2 {\n`
      + ` translate {${d.C.map(n6).join(' ')}}\n`
      + ` rotate {${[d.eul.x, d.eul.y, d.eul.z].map(a => n6(a * r2d)).join(' ')}}\n`
      + ` rot_order ZXY\n`
      + ` focal ${n6(d.f)}\n haperture ${n6(d.sw)}\n vaperture ${n6(d.sh)}\n`
      + (d.p !== 1 ? ` label "anamorphic ${d.p}: use a format with pixel aspect ${d.p}"\n` : '')
      + ` name ${name}\n}\n`;
  } else if (t === 'maya') {
    // Maya: Y up like the app; xform -matrix is row-vector order (translation in the last row); film back in inches
    const m = [...d.X, 0, ...d.Y, 0, ...d.Z, 0].map(n6).join(', ');
    out = `# ${header}\n# ${scaleNote}\n# Meters, Y up. Paste into the Script Editor (Python tab) and run it.\nimport maya.cmds as cmds\n`
      + `k = {'mm': 1000.0, 'cm': 100.0, 'm': 1.0, 'km': 0.001, 'in': 39.37007874, 'ft': 3.280839895, 'yd': 1.093613298}.get(cmds.currentUnit(q=True, linear=True), 100.0)  # meters -> scene units\n`
      + `cam, shape = cmds.camera(name='${name}')\n`
      + `cmds.setAttr(shape + '.focalLength', ${n6(d.f)})\n`
      + `cmds.setAttr(shape + '.horizontalFilmAperture', ${n6(d.sw / 25.4)})  # ${fmt(d.sw, 3)} mm\n`
      + `cmds.setAttr(shape + '.verticalFilmAperture', ${n6(d.sh / 25.4)})  # ${fmt(d.sh, 3)} mm\n`
      + `cmds.setAttr(shape + '.filmFit', 1)  # horizontal\n`
      + `cmds.setAttr(shape + '.nearClipPlane', 0.01 * k)\ncmds.setAttr(shape + '.farClipPlane', 10000 * k)\n`
      + `cmds.xform(cam, worldSpace=True, matrix=[${m}, ${n6(d.C[0])} * k, ${n6(d.C[1])} * k, ${n6(d.C[2])} * k, 1])\n`
      + `cmds.setAttr('defaultResolution.width', ${d.W})\ncmds.setAttr('defaultResolution.height', ${d.H})\n`
      + `cmds.setAttr('defaultResolution.pixelAspect', ${n6(d.p)})\ncmds.setAttr('defaultResolution.deviceAspectRatio', ${n6(d.W * d.p / d.H)})\n`
      + `cmds.select(cam)\n# Image plane: select the camera > Create > Image Plane, pick ${st.plate.sample ? 'your plate' : st.plate.name}\n`;
  } else if (t === 'houdini') {
    // Houdini: Y up, meters; hou.Matrix4 is row-vector order like Maya; aperture in mm
    const row = (v, w) => `(${v.map(n6).join(', ')}, ${w})`;
    out = `# ${header}\n# ${scaleNote}\n# Meters, Y up. Paste into the Python Shell (Windows > Python Shell) or a shelf tool.\nimport hou\n`
      + `cam = hou.node('/obj').createNode('cam', '${name}')\n`
      + `cam.setWorldTransform(hou.Matrix4((${row(d.X, 0)}, ${row(d.Y, 0)}, ${row(d.Z, 0)}, (${d.C.map(n6).join(', ')}, 1))))\n`
      + `cam.parmTuple('res').set((${d.W}, ${d.H}))\ncam.parm('aspect').set(${n6(d.p)})\n`
      + `cam.parm('focal').set(${n6(d.f)})\ncam.parm('aperture').set(${n6(d.sw)})  # horizontal, mm\n`
      + `try:\n    cam.parm('focalunits').set('mm')\nexcept Exception:\n    pass\n`
      + `cam.setDisplayFlag(True)\ncam.setSelected(True, clear_all_selected=True)\n`
      + `# Plate: on the camera, View tab > Background Image: ${st.plate.sample ? 'your plate' : st.plate.name}\n`;
  } else {
    const rows = [0, 1, 2].map(i => `(${n6(d.Xm[i])}, ${n6(d.Ym[i])}, ${n6(d.Zm[i])}, ${n6(d.Cm[i])})`);
    out = `# ${header}\n# ${scaleNote}\n# Meters, Z up. Paste into Blender's Text Editor and run it.\nimport bpy\nfrom mathutils import Matrix\n`
      + `cd = bpy.data.cameras.new("${name}")\ncd.sensor_fit = 'HORIZONTAL'\ncd.sensor_width = ${n6(d.sw)}\ncd.sensor_height = ${n6(d.sh)}\ncd.lens = ${n6(d.f)}\n`
      + `ob = bpy.data.objects.new("${name}", cd)\nbpy.context.collection.objects.link(ob)\n`
      + `ob.matrix_world = Matrix((\n    ${rows.join(',\n    ')},\n    (0, 0, 0, 1)))\n`
      + `sc = bpy.context.scene\nsc.render.resolution_x = ${d.W}\nsc.render.resolution_y = ${d.H}\nsc.render.resolution_percentage = 100\nsc.render.pixel_aspect_x = ${n6(d.p)}\nsc.render.pixel_aspect_y = 1\nsc.camera = ob\n`;
  }
  $('out').value = out;
  $('s4').dataset.state = st.solved && st.rms != null && st.rms < 3 ? 'ok' : 'warn';
  const sf = st.unit * st.userScale;
  const yo = st.scanY || 0;
  let rotNote = '';
  if (st.rot && st.rot.some(v => Math.abs(v) > 1e-6)) {
    const d2r = Math.PI / 180, R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(st.rot[0] * d2r, st.rot[1] * d2r, st.rot[2] * d2r, 'XYZ'));
    const P = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1); // app Y-up -> Z-up
    const Rz = P.clone().multiply(R).multiply(P.clone().transpose());
    const ez = new THREE.Euler().setFromRotationMatrix(Rz, 'XYZ');
    const f1 = (v) => fmt(v / d2r, 2) + '°';
    rotNote = (t === 'nuke' || t === 'maya' || t === 'houdini' ? `Scan rotation: rotate the scan X ${f1(st.rot[0] * d2r)}, Y ${f1(st.rot[1] * d2r)}, Z ${f1(st.rot[2] * d2r)} (XYZ order). `
      : `Scan rotation: in ${t === 'blender' ? 'Blender' : '3ds Max'} rotate the imported scan X ${f1(ez.x)}, Y ${f1(ez.y)}, Z ${f1(ez.z)} (XYZ, Z up), around the origin. `);
  }
  const viewNote = camSame(shotCamSnap(), camSnap()) ? '' : 'Exports the shot camera (<b>Recall cam</b>), not the view you navigated to: <b>Store cam</b> makes this view the shot camera. ';
  $('export-note').innerHTML = viewNote + rotNote + (Math.abs(yo) > 1e-6 ? `Scan height offset: move the scan <b>${yo > 0 ? 'up' : 'down'} ${fmt(Math.abs(yo), 3)} m</b> in your DCC (after any scale). ` : '') + (Math.abs(sf - 1) > 1e-6 || st.up !== 'y'
    ? `The camera lives in the corrected space (meters${st.up !== 'y' ? ', axis converted' : ''}). Import the scan in your DCC in meters${Math.abs(st.userScale - 1) > 1e-6 ? ` and scale it <b>×${fmt(st.userScale, 4)}</b> from the origin` : ''} so they line up.`
    : 'The camera lives in the same space as the scan, in meters. Import the scan in meters and they line up.');
}

// ---------- Measure ----------
function updateMeasureGeo() {
  const a = st.measure.a, b = st.measure.b;
  const arr = measGeo.attributes.position.array;
  if (a) { arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; }
  if (b) { arr[3] = b.x; arr[4] = b.y; arr[5] = b.z; } else if (a) { arr[3] = a.x; arr[4] = a.y; arr[5] = a.z; }
  measGeo.attributes.position.needsUpdate = true;
  measGeo.computeBoundingSphere();
  measLine.visible = false;
  measPts.visible = false;
  const d = a && b ? a.distanceTo(b) : null;
  $('meas').value = d != null ? d.toFixed(4) + ' m' : a ? 'pick 2nd point' : '–';
  $('apply-scale').disabled = !(d > 0 && +$('real').value > 0) || measEnv();
}
// measure points on the scan are kept in scan-local space so they follow scale changes; points on the environment stay in world space
function measWorld() {
  const W = (l, e) => l ? (e ? l.clone() : scanRoot.localToWorld(l.clone())) : null;
  st.measure.a = W(st.measure.la, st.measure.ea);
  st.measure.b = W(st.measure.lb, st.measure.eb);
}
function measEnv() { return !!(st.measure.ea || st.measure.eb); }

