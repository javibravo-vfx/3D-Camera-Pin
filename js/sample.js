// ---------- Sample scene (real scale, meters, Y up) ----------
// Sample: compact sedan interior, real scale in meters, Y up, car facing -Z, left-hand drive.
// Origin on the ground under the middle of the front seats. The scan has no people; the plate does.
function sampleGeometry(colored, people) {
  const g = new THREE.Group();
  const cache = {};
  const mat = (c) => { const k = colored ? c : 'scan'; return cache[k] || (cache[k] = new THREE.MeshLambertMaterial({ color: colored ? c : 0xb9c3cd, side: THREE.DoubleSide })); };
  const box = (w, h, d, x, y, z, c, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, Math.max(1, Math.ceil(w * 3)), Math.max(1, Math.ceil(h * 3)), Math.max(1, Math.ceil(d * 3))), mat(c));
    m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
  };
  // rod / limb between two points
  const seg = (a, b, r, c) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12, 2), mat(c));
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    g.add(m);
    for (const P of [A, B]) { const j = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat(c)); j.position.copy(P); g.add(j); }
    return m;
  };
  const BODY = 0x8e9aa3, TRIM = 0x2b2d31, SEAT = 0x3a3c40, DASH = 0x232427, TIRE = 0x161616;
  // ---- body shell ----
  box(1.78, 0.5, 1.12, 0, 0.62, -1.42, BODY);                    // engine bay / nose
  box(1.78, 0.5, 1.05, 0, 0.62, 2.05, BODY);                     // trunk
  box(1.72, 0.06, 1.18, 0, 0.9, -1.4, BODY, 0.08);               // hood
  box(1.6, 0.05, 0.9, 0, 0.9, 2.05, BODY);                       // trunk lid
  for (const sx of [-1, 1]) box(0.08, 0.46, 2.32, sx * 0.85, 0.6, 0.31, BODY); // doors / sills
  box(1.78, 0.3, 0.22, 0, 0.48, -1.98, TRIM);                    // front bumper
  box(1.62, 0.05, 1.75, 0, 1.44, 0.55, BODY);                    // roof
  box(1.55, 0.06, 0.08, 0, 1.40, -0.32, BODY);                   // windshield header
  box(1.55, 0.06, 0.08, 0, 0.94, -0.88, BODY);                   // cowl / windshield base
  for (const sx of [-1, 1]) {
    seg([sx * 0.76, 0.94, -0.9], [sx * 0.70, 1.42, -0.32], 0.035, BODY);   // A pillars
    seg([sx * 0.76, 0.78, 0.58], [sx * 0.70, 1.42, 0.58], 0.04, BODY);      // B pillars
    seg([sx * 0.76, 0.78, 1.42], [sx * 0.70, 1.42, 1.38], 0.05, BODY);      // C pillars
    box(0.06, 0.26, 2.5, sx * 0.78, 0.88, 0.3, BODY);                       // door tops / belt line
    seg([sx * 0.80, 1.06, -0.62], [sx * 0.84, 1.08, -0.72], 0.05, TRIM);    // side mirrors
    box(0.14, 0.1, 0.18, sx * 0.9, 1.06, -0.7, TRIM);
    for (const z of [-1.33, 1.37]) {                                         // wheels
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.22, 20).rotateZ(Math.PI / 2), mat(TIRE));
      w.position.set(sx * 0.8, 0.31, z); g.add(w);
    }
  }
  // ---- cabin ----
  box(1.44, 0.04, 2.6, 0, 0.36, 0.45, TRIM);                     // floor
  box(1.48, 0.3, 0.46, 0, 0.8, -0.66, DASH);                    // dashboard
  box(1.4, 0.06, 0.3, 0, 0.96, -0.74, DASH, -0.3);               // dash top
  box(0.24, 0.32, 0.72, 0, 0.55, -0.12, DASH);                   // center console
  box(0.26, 0.07, 0.03, 0, 1.31, -0.36, TRIM);                   // rear-view mirror
  seg([0, 1.40, -0.33], [0, 1.34, -0.36], 0.012, TRIM);
  // steering wheel (driver on the left, -X)
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.018, 10, 36), mat(TRIM));
  wheel.position.set(-0.37, 0.93, -0.44); wheel.rotation.x = -0.45; g.add(wheel);
  seg([-0.37, 0.93, -0.44], [-0.37, 0.86, -0.62], 0.03, TRIM);
  // seats
  for (const sx of [-0.37, 0.37]) {
    box(0.5, 0.12, 0.5, sx, 0.52, 0.18, SEAT);                   // cushion
    box(0.5, 0.66, 0.12, sx, 0.88, 0.48, SEAT, 0.2);             // backrest, reclined
    box(0.26, 0.2, 0.1, sx, 1.3, 0.56, SEAT, 0.12);              // headrest
  }
  box(1.36, 0.12, 0.5, 0, 0.52, 1.18, SEAT);                     // rear bench
  box(1.36, 0.6, 0.12, 0, 0.86, 1.48, SEAT, 0.22);
  // ---- people (plate only) ----
  if (people) {
    const figure = (cx, shirt, hair, driving) => {
      const SKIN = 0xc79a7c, PANTS = 0x2c3442;
      const hipY = 0.62, hipZ = 0.26, neck = [cx, 1.1, 0.4];
      seg([cx, hipY, hipZ], neck, 0.15, shirt);                 // torso
      seg(neck, [cx, 1.17, 0.39], 0.05, SKIN);                   // neck
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), mat(SKIN)); head.position.set(cx, 1.265, 0.37); head.scale.set(1, 1.18, 1.08); g.add(head);
      const hr = new THREE.Mesh(new THREE.SphereGeometry(0.112, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hair)); hr.position.set(cx, 1.28, 0.385); hr.scale.set(1, 1.15, 1.1); g.add(hr);
      for (const s of [-1, 1]) {
        const sh = [cx + s * 0.19, 1.04, 0.38];
        const elbow = driving ? [cx + s * 0.24, 0.9, 0.08] : [cx + s * 0.23, 0.84, 0.2];
        const hand = driving ? [cx + s * 0.16, 0.95, -0.39] : [cx + s * 0.1, 0.68, -0.02];
        seg(sh, elbow, 0.045, shirt); seg(elbow, hand, 0.038, SKIN);
        const hip = [cx + s * 0.1, hipY - 0.02, hipZ], knee = [cx + s * 0.12, 0.66, -0.22], foot = [cx + s * 0.13, 0.42, -0.42];
        seg(hip, knee, 0.07, PANTS); seg(knee, foot, 0.055, PANTS);
      }
    };
    figure(-0.37, 0x6f8fb8, 0x2a1d16, true);    // driver
    figure(0.37, 0xb5544a, 0x5a3a22, false);    // passenger
  }
  return g;
}
function buildSample() {
  // plate rendered from a hidden "real" camera on a hood mount: Alexa Mini LF Open Gate, 24 mm, looking back through the windshield
  const W = 1920, H = 1336, f = 24, sw = 36.70;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(W, H, false); r.setPixelRatio(1); r.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x1fa64a); // green screen behind the car
  sc.add(new THREE.HemisphereLight(0xeef3f8, 0x55504a, 0.8 * Math.PI));
  const s2 = new THREE.DirectionalLight(0xfff1dc, 0.85 * Math.PI); s2.position.set(-6, 10, -8); sc.add(s2);
  sc.add(sampleGeometry(true, true));
  // green stage floor
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1fa64a })); sc.add(ground);
  const cam = new THREE.PerspectiveCamera(2 * Math.atan((H / 2) / (f / sw * W)) * 180 / Math.PI, W / H, 0.02, 500);
  cam.position.set(0.08, 1.36, -1.62); cam.lookAt(-0.02, 1.04, 0.4); cam.rotateZ(-0.012);
  r.render(sc, cam);
  const url = r.domElement.toDataURL('image/png');
  r.dispose();
  return { url, W, H, f };
}

