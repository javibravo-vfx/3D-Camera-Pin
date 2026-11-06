// ---------- Timeline + speed simulation: the camera stays, the environment slides along its own Z ----------
const tl = { start: 1001, end: 1100, fps: 24, frame: 1001, playing: false, loop: true, raf: 0, t0: 0, f0: 0 };
const smooth = (u) => u * u * (3 - 2 * u);
// speed factor (0..1) and distance in metres at timeline position u (0..1 over the range)
function motionAt(u) {
  if (!env.vals.mon) return { k: 0, d: 0 };
  const V = (env.vals.speed || 0) / 3.6, T = Math.max(tl.end - tl.start, 1) / tl.fps, prof = env.vals.mprof || 'const';
  u = Math.min(Math.max(u, 0), 1);
  if (prof === 'accel') return { k: smooth(u), d: V * T * (u ** 3 - u ** 4 / 2) };
  if (prof === 'decel') return { k: 1 - smooth(u), d: V * T * (u - (u ** 3 - u ** 4 / 2)) };
  if (prof === 'inout') { // up over the first half, down over the second
    const h = (x) => x ** 3 - x ** 4 / 2, Th = T / 2;
    if (u <= 0.5) { const a = u * 2; return { k: smooth(a), d: V * Th * h(a) }; }
    const b = (u - 0.5) * 2; return { k: 1 - smooth(b), d: V * Th * 0.5 + V * Th * (b - h(b)) };
  }
  return { k: 1, d: V * T * u };
}
function motionDist(u) { return motionAt(u).d; }
function tlU() { return (tl.frame - tl.start) / Math.max(tl.end - tl.start, 1); }
// dónde queda el origen del entorno sin movimiento: Offset X / Z, más el corrimiento que pone el carril del auto
// de la toma debajo del auto (avenida, Shot car lane), girado con el entorno
function envBase() {
  const v = env.vals, r = (v.rot || 0) * Math.PI / 180, sx = env.id === 'avenue' && typeof avenueShift === 'function' ? avenueShift(v) : 0;
  return { x: (v.x || 0) + Math.cos(r) * sx, y: v.y || 0, z: (v.z || 0) - Math.sin(r) * sx, rot: r };
}
function applyMotion() {
  if (!ENV_MODULES[env.id]) return;
  const v = env.vals, d = motionDist(tlU()) * (v.mdir === 'back' ? -1 : 1), b = envBase();
  // travelling forward (toward the env's −Z) = the world slides toward +Z
  const r = b.rot;
  envRoot.position.set(b.x + Math.sin(r) * d, b.y, b.z + Math.cos(r) * d);
  const t = v.mon ? (tl.frame - tl.start) / tl.fps : 0; // other vehicles along their own direction, each lane/train with its small difference
  envRoot.traverse(o => {
    if (o.userData.flow) o.position.z = -o.userData.flow * Math.max(0, (v.tspeed || 0) + (o.userData.vk || 0) * (v.tvar || 0)) / 3.6 * t;
    else if (o.userData.walk) o.position.z = o.userData.walk * t; // gente caminando por la vereda, a su paso
    else if (o.userData.fixed) o.position.z = -d; // Cars in lanes a la par de la cámara: no viajan con la calle (js/lane-cars.js)
  });
  envRoot.updateMatrixWorld(true);
}
function tlUI() {
  $('tl-f').value = tl.frame; $('tl-s').min = tl.start; $('tl-s').max = tl.end; $('tl-s').value = tl.frame;
  { const b = $('tl-play'), st_ = String(tl.playing);
    if (b.getAttribute('aria-pressed') !== st_ || !b.firstChild) { b.setAttribute('aria-pressed', st_); b.innerHTML = tl.playing ? TL_ICON.pause : TL_ICON.play; b.title = tl.playing ? 'Pause (Space)' : 'Play (Space)'; } }
  const m = motionAt(tlU()), on = !!ENV_MODULES[env.id];
  const mo = on && !!env.vals.mon;
  $('tl-kmh').textContent = !on ? 'no environment' : mo ? `${((env.vals.speed || 0) * m.k).toFixed(1)} km/h` : 'motion off';
  $('tl-dist').textContent = mo ? `${m.d.toFixed(1)} m` : '';
  $('tl-time').textContent = `${((tl.frame - tl.start) / tl.fps).toFixed(2)} s`;
  if (typeof vplUI === 'function') vplUI(); // video-plate.js carga después y un timer de arranque puede llegar antes
  $('mo-st').textContent = mo ? `${env.vals.speed || 0} km/h` : on ? 'off' : '–';
  $('s6').dataset.state = mo ? 'ok' : '';
  $('motion-params').querySelectorAll('[data-k]').forEach(el => { if (el.dataset.k !== 'mon') { const r = el.closest('.knobrow, .fld'); if (r) r.classList.toggle('dim', !mo); } });
}
// fromVideo: the frame comes from the playing video plate, which already shows it
function tlSet(f, fromVideo) {
  tl.frame = Math.round(Math.min(Math.max(f, tl.start), tl.end));
  applyMotion(); tlUI(); render(); drawOverlay();
  if (!fromVideo && typeof vplSeek === 'function') vplSeek(tl.frame);
}
function tlTick(now) {
  if (!tl.playing) return;
  let f = tl.f0 + (now - tl.t0) / 1000 * tl.fps;
  if (f > tl.end) { if (tl.loop) { tl.t0 = now; tl.f0 = tl.start; f = tl.start; } else { f = tl.end; tl.playing = false; } }
  if (Math.round(f) !== tl.frame) tlSet(f); else tlUI();
  if (tl.playing) tl.raf = requestAnimationFrame(tlTick);
}
function tlPlay(on = !tl.playing) {
  tl.playing = on; cancelAnimationFrame(tl.raf);
  if (typeof vplActive === 'function' && vplActive()) { if (on && tl.frame >= tl.end) tl.frame = tl.start; vplPlay(on); tlUI(); return; } // the video's own clock drives the timeline
  if (on) { if (tl.frame >= tl.end) tlSet(tl.start); tl.t0 = performance.now(); tl.f0 = tl.frame; tl.raf = requestAnimationFrame(tlTick); }
  tlUI();
}
function tlSave() { lsSet('tl', { start: tl.start, end: tl.end, fps: tl.fps, loop: tl.loop }); }
// El movimiento del vehículo de la toma es uno solo para todos los entornos (60 km/h en la avenida
// siguen siendo 60 en el tren). Los otros vehículos (tspeed, tvar) quedan por módulo: autos y trenes
// andan a velocidades distintas.
const ENV_SHARED_MOTION = ['speed', 'mdir', 'mprof'];
function envSharedSave(vals) {
  const o = lsGet('env.motion', {}) || {};
  for (const k of ENV_SHARED_MOTION) if (vals && vals[k] !== undefined) o[k] = vals[k];
  lsSet('env.motion', o);
}
function envSave() { lsSet('env', { id: env.id, on: env.on, seed: env.seed, vals: env.vals, display: env.display }); envSharedSave(env.vals); }
function envRebuild() {
  envRoot.children.slice().forEach(c => { envRoot.remove(c); c.traverse(o => { if (o.geometry) o.geometry.dispose(); }); });
  const mod = ENV_MODULES[env.id];
  if (mod) {
    const v = env.vals;
    const b = envBase(); envRoot.position.set(b.x, b.y, b.z); envRoot.rotation.set(0, b.rot, 0); envRoot.updateMatrixWorld(true);
    const origin = envRoot.worldToLocal(new THREE.Vector3(0, 0, 0));
    const need = v.mon ? 2 * (Math.abs(motionDist(1)) + ((v.tspeed || 0) + (v.tvar || 0)) / 3.6 * (tl.end - tl.start) / tl.fps + 150) : 0; // long enough to drive the whole range without running off
    const obj = mod.build(need > v.length ? Object.assign({}, v, { length: Math.min(need, 6000) }) : v, mulberry32(env.seed), origin);
    if (env.display === 'wire') obj.traverse(o => { if (o.isMesh) { o.material = MAT.wire; } });
    envRoot.add(obj);
    if (typeof lcBuild === 'function') { const lcg = lcBuild(); if (lcg) envRoot.add(lcg); } // Cars in lanes
  }
  envRoot.visible = !!mod && env.on;
  applyMotion();
  if (typeof placeEnv === 'function') placeEnv();
  if (envRoot.visible && camera.far < 3000) { camera.far = 3000; camera.updateProjectionMatrix(); }
  const chip = $('env-on');
  chip.disabled = !mod; chip.setAttribute('aria-pressed', String(!!mod && env.on));
  $('env-st').textContent = mod ? (env.on ? mod.name : 'off') : 'none';
  $('s5').dataset.state = mod && env.on ? 'ok' : '';
  envMixApply(false);
  render(); drawOverlay();
}
// Env mix (barra del visor, de cada pestaña): funde el entorno sobre el plate. Va en la opacidad de sus materiales,
// que son sólo del entorno (los del scan, MAT, no se tocan); a 1 vuelven a ser opacos.
function envMixApply(draw = true) {
  if (typeof MAT === 'undefined') return; // js/plate.js todavía no cargó
  const k = Math.min(1, Math.max(0, +$('envmix').value));
  envRoot.traverse(o => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || m === MAT.wire || m === MAT.solid) continue;
      const u = m.userData; if (u.envOp === undefined) { u.envOp = m.opacity; u.envTr = m.transparent; }
      const tr = k < 1 || u.envTr; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = u.envOp * k;
    }
  });
  if (draw) render();
}
function envRenderParams() {
  const mod = ENV_MODULES[env.id], box = $('env-params');
  if (!mod) { box.innerHTML = ''; $('env-extra').hidden = true; $('motion-params').innerHTML = '<p class="note">Pick an environment first.</p>'; return; }
  $('env-extra').hidden = false;
  $('env-carfiles').hidden = $('env-credit').hidden = env.id !== 'avenue';
  const row = (p) => {
    if (env.vals[p.key] === undefined) env.vals[p.key] = p.def;
    const id = 'envp-' + p.key, v = env.vals[p.key];
    if (p.type === 'bool') return `<label class="fld" for="${id}">${p.label}<span class="row"><input id="${id}" type="checkbox" data-k="${p.key}" ${v ? 'checked' : ''}></span></label>`;
    if (p.type === 'select') return `<label class="fld" for="${id}">${p.label}<select id="${id}" data-k="${p.key}">${p.options.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
    return `<div class="knobrow"><label for="${id}"${p.tip ? ` title="${p.tip}"` : ''}>${p.label}</label><div class="erow"><input type="range" data-k="${p.key}" data-def="${p.def}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" aria-label="${p.label}"><input id="${id}" type="number" data-k="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}"${p.unit ? ` data-unit="${p.unit}"` : ''}></div></div>`;
  };
  const presets = mod.presets ? '<div class="row env-presets" data-tour="env.presets">' + mod.presets.map(([n, tip], i) => `<button class="btn sm" data-preset="${i}" title="${tip}">${n}</button>`).join('') + '</div>' : '';
  box.innerHTML = presets + mod.params.map(row).join('') + '<div class="sub">Placement</div>' + ENV_COMMON.map(row).join('');
  box.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => envPreset(mod.presets[+b.dataset.preset][2]));
  $('motion-params').innerHTML = ENV_MOTION.map(row).join('');
  enhanceNumbers($('motion-params'));
  enhanceNumbers(box);
}
// un juego de valores de una vez (los presets de la avenida): un solo rebuild
function envPreset(vals) {
  Object.assign(env.vals, vals);
  envRenderParams(); envSave(); envRebuild(); tlUI();
}
function envSet(k, val) {
  env.vals[k] = val;
  if (k === 'mon') ENV_SESSION_MON[env.id] = !!val;
  if (typeof tlUI === 'function') setTimeout(tlUI, 0);
  document.querySelectorAll(`#env-params [data-k="${k}"], #motion-params [data-k="${k}"]`).forEach(el => { if (el.type === 'checkbox') el.checked = !!val; else if (document.activeElement !== el) el.value = val; });
  envSave(); envRebuild();
}
// Motion on de cada entorno mientras dura la sesión: al abrir la app arranca apagado, al ir y volver de un entorno queda como estaba
const ENV_SESSION_MON = {};
function envSelect(id) {
  if (env.vals && env.id) ENV_SESSION_MON[env.id] = !!env.vals.mon;
  env.id = ENV_MODULES[id] ? id : 'none';
  const saved = lsGet('env.vals.' + env.id, null);
  env.vals = Object.assign(envDefaults(env.id), saved || {}, lsGet('env.motion', null) || {});
  // proyectos y settings de antes de Lanes right/left: el total se reparte como lo hacía la avenida vieja
  if (saved && saved.lanes !== undefined && saved.lanesR === undefined && saved.lanesL === undefined) {
    const n = Math.min(12, Math.max(1, Math.round(saved.lanes)));
    env.vals.lanesR = Math.ceil(n / 2); env.vals.lanesL = Math.floor(n / 2);
  }
  delete env.vals.lanes;
  // una avenida guardada antes de los estacionados, la gente y el carril del auto queda como era
  const legacy = ENV_MODULES[env.id] && ENV_MODULES[env.id].legacy;
  if (saved && legacy) for (const [k, v] of Object.entries(legacy)) if (saved[k] === undefined) env.vals[k] = v;
  env.vals.mon = !!ENV_SESSION_MON[env.id]; // motion starts off with the app; switching environments keeps each one's; a project brings its own
  if (env.id !== 'none') env.on = true;
  $('env-mod').value = env.id;
  envRenderParams(); envSave(); envRebuild(); tlUI(); // la lectura de km/h de la barra sigue al entorno nuevo
}
function toggleEnv() { if (!ENV_MODULES[env.id]) return; env.on = !env.on; envSave(); envRebuild(); }

function render() {
  if (!(typeof zdfMain === 'function' && zdfMain())) renderer.render(scene, camera); // hook render: vista Depth / Z defocus sin key
  if (!$('glenv').hidden && !(typeof zdfRender === 'function' && zdfRender())) envRenderer.render(envScene, camera); // hook zdefocus
  if (typeof drvRender === 'function') drvRender(); // hook drive-plate
}

