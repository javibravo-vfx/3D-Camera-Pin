// Shakelab (pestaña): el movimiento de un iPhone en la mano, grabado como movimiento sobre la cámara de la toma.
// El teléfono abre en Safari la página phone/ (con el motor de seguimiento de 8th Wall; gratis, D-07) y manda su pose:
//  - Con internet, en la web y en la app de escritorio (D-08): la página viene de la web publicada con la sala en el
//    link (shk.room, la misma siempre en esta compu) y se conecta directo a esta pestaña por WebRTC, por la red;
//    la web (worker/index.js) sólo los presenta. Acá se escucha en la sala (shkRtc*), se manda la oferta y llegan
//    las poses y las órdenes por un canal de datos.
//  - Sin internet, sólo la app de escritorio: la página la sirve la app por HTTPS en la red local; ZIG SIM Pro (paga,
//    por UDP) también entra, en el mismo puerto. electron/main.js escucha y lo pasa por window.bplDesktop.shake.
// Zero y Rec también se tocan en el teléfono, y la página se entera de si se está grabando (shkTell).
// Los seis ejes salen de js/shake-math.js contra la pose de cero (Zero, y Rec arranca con un cero). Cada eje tiene
// su límite (±) y una sola frenada para todos (Brake): la toma se guarda cruda y los límites se aplican al verla y al
// exportarla, así se pueden cambiar después de grabar.
// El visor es el de la app, quieto en la cámara de la toma (shotCamSnap) con el movimiento encima: render() pone esa
// cámara un momento para cada dibujo y deja la vista como estaba. Rec reproduce la línea de tiempo desde su inicio y
// graba hasta su final (o Stop); con una toma elegida, la línea de tiempo la reproduce con el tráfico.
// API: shk, shkShow, shkOnPose, shkProjectState, shkApplyProject.
const shk = (() => {
  const s = lsGet('shk', {}) || {}, num = (v, d) => Number.isFinite(+v) && v !== null && v !== '' ? +v : d;
  return {
    on: false, port: Math.round(num(s.port, 50000)), lims: SHK_AXES.map((a, i) => Math.max(0, num((s.lims || [])[i], a.lim))),
    brake: Math.max(0, Math.min(1, num(s.brake, 0.3))), room: /^[A-Za-z0-9_-]{22}$/.test(s.room) ? s.room : shkRoomNew(), lag: SHK_LAG.some(l => l.k === s.lag) ? s.lag : 'balanced',
    listening: false, addrs: [], urls: [], local: '', err: '', from: '', src: '', none: 0, track: null, pose: null, arrived: 0, times: [], zero: null, live: [0, 0, 0, 0, 0, 0],
    rec: null, takes: [], sel: -1, raf: 0, uiRaf: 0, tick: 0, buf: shkBufNew(), samp: [], loop: 0,
  };
})();
function shkSave() { lsSet('shk', { port: shk.port, lims: shk.lims, brake: shk.brake, lag: shk.lag, room: shk.room }); }
// la sala: 16 bytes al azar (base64url, 22 caracteres); sólo quien tiene el link entra
function shkRoomNew() { const b = crypto.getRandomValues(new Uint8Array(16)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const shkDesk = () => !!(window.bplDesktop && window.bplDesktop.shake);
const shkFmt = (v, a) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(a.unit === 'm' ? 3 : 2) + (a.unit === 'm' ? ' m' : '°');

// ---------- Lo que se ve ----------
// el movimiento crudo de ahora: el iPhone en vivo (o mientras graba) o la toma elegida en el cuadro de la línea de tiempo
function shkRaw() {
  if (shk.rec || shk.sel < 0) return shk.live;
  return shkSample(shk.takes[shk.sel], (tl.frame - tl.start) / tl.fps);
}
const shkCam = () => shkLimit(shkRaw(), shk.lims, shk.brake);
// la cámara de la toma con el movimiento (posición en metros y Euler 'YXZ' en radianes)
function shkCamAt(v) {
  const b = shotCamSnap(), e = new THREE.Euler().setFromQuaternion(b.q, 'YXZ');
  return shkApply({ p: [b.p.x, b.p.y, b.p.z], e: { x: e.x, y: e.y, z: e.z } }, v);
}
{ const f = render; render = function (...a) {
  if (mtabCur !== 'shakelab') return f(...a);
  const r = shkCamAt(shkCam()), kp = camera.position.clone(), kq = camera.quaternion.clone();
  camera.position.fromArray(r.p); camera.quaternion.setFromEuler(new THREE.Euler(r.e.x, r.e.y, r.e.z, 'YXZ')); camera.updateMatrixWorld(true);
  try { return f(...a); } finally {
    camera.position.copy(kp); camera.quaternion.copy(kq); camera.updateMatrixWorld(true);
    if (!shk.uiRaf) shk.uiRaf = requestAnimationFrame(() => { shk.uiRaf = 0; shkLiveUI(); }); // los números siguen a la toma en la línea de tiempo
  }
}; }
// el vivo: un dibujo por cuadro de pantalla mientras llegan poses, con el colchón (shkBufTime, Live) en la hora del
// teléfono; si la pose siguiente todavía no llegó, la última
function shkLiveAt() {
  const S = shk.samp, tp = shkBufTime(shk.buf, performance.now(), SHK_LAG.find(l => l.k === shk.lag) || SHK_LAG[1]);
  if (!S.length || !shk.zero || tp === null) return shk.live;
  let i = S.length - 1; while (i > 0 && S[i - 1].t > tp) i--;
  const b = S[i], a = S[Math.max(0, i - 1)];
  return shkSample({ s: [{ t: a.t, v: shkDelta(shk.zero, a) }, { t: b.t, v: shkDelta(shk.zero, b) }] }, tp);
}
function shkLoop() {
  if (shk.loop) return;
  shk.loop = requestAnimationFrame(() => {
    shk.loop = 0; if (!shk.on || !shkFresh()) return;
    shk.live = shkLiveAt(); if (!tl.playing) render(); shkLiveUI(); shkLoop();
  });
}
// un dibujo por cuadro de pantalla, aunque lleguen más poses
function shkDirty() {
  if (shk.raf) return;
  shk.raf = requestAnimationFrame(() => { shk.raf = 0; if (!shk.on) return; if (!tl.playing) render(); shkLiveUI(); });
}
function shkShow(on) {
  if (on === shk.on) return;
  shk.on = on;
  clearInterval(shk.tick); shk.tick = on ? setInterval(shkLiveUI, 500) : 0; // "no llega nada" también se tiene que ver
  if (on) {
    if ($('shk').classList.contains('closed')) $('shk').querySelector('h2').click(); // la única sección de la pestaña
    shkPanel(); render();
  }
}

// ---------- El iPhone ----------
function shkOnPose(m) {
  if (!m) return;
  if (m.error) { shk.err = m.error; shkLiveUI(); return; }
  if (typeof m.from === 'string') shk.from = m.from;
  if (m.none) { shk.none = m.t; shkLiveUI(); return; }
  if (m.cmd) { if (m.cmd === 'zero') shkZeroNow(); else if (m.cmd === 'rec') { if (shk.rec) shkRecStop(); else shkRecStart(); } return; }
  if (typeof m.track === 'string') { const was = shk.track; shk.track = { st: m.track, reason: m.reason || '', at: performance.now() }; if (!was || was.st !== m.track || was.reason !== shk.track.reason) shkLiveUI(); return; }
  if (!Array.isArray(m.p) || !Array.isArray(m.q)) return;
  shk.none = 0; shk.err = ''; shk.arrived = performance.now(); shk.src = m.src || '';
  const S = shk.samp, last = S[S.length - 1];
  if (last && m.t < last.t - 1000) { S.length = 0; shk.buf = shkBufNew(); shk.times = []; } // otro reloj: el teléfono recargó la página
  // las tandas pueden llegar desordenadas: en orden por la hora del teléfono, dos segundos
  let i = S.length; while (i > 0 && S[i - 1].t > m.t) i--;
  if (S[i - 1] && S[i - 1].t === m.t) return;
  S.splice(i, 0, m); while (S.length > 2 && S[S.length - 1].t - S[0].t > 2000) S.shift();
  shk.pose = S[S.length - 1]; shkBufPush(shk.buf, m.t, shk.arrived);
  shk.times.push(m.t); while (shk.times.length && shk.pose.t - shk.times[0] > 1000) shk.times.shift();
  if (!shk.zero) shk.zero = shkZero(m);
  if (shk.rec) {
    const t = (m.t - shk.rec.t0) / 1000;
    if (t > 0) shk.rec.s.push({ t, v: shkDelta(shk.zero, m) });
    if (t >= shk.rec.len) { shkRecStop(); return; }
  }
  shkLoop();
}
// ---------- Con internet: WebRTC (D-08) ----------
const SHK_CLOUD = 'https://backplatelab.lega.com.ar';
const SHK_ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
// la web publicada presenta al teléfono: desde la web, la misma dirección; desde la app de escritorio, la publicada
// (lsGet('shk-cloud') la cambia, para probar con el Worker en esta compu: wrangler dev)
const shkCloud = () => String(lsGet('shk-cloud', '') || (shkDesk() || !/^https?:$/.test(location.protocol) ? SHK_CLOUD : location.origin)).replace(/\/+$/, '');
const shkPhoneUrl = () => `${shkCloud()}/phone/#${shk.room}`;
const shkRtc = { ws: null, pc: null, dc: null, phone: '', st: 'off', tries: 0, retry: 0, beat: 0, chain: Promise.resolve() };
const shkRtcOpen = () => !!(shkRtc.dc && shkRtc.dc.readyState === 'open');
function shkRtcSend(m) { if (shkRtc.ws && shkRtc.ws.readyState === 1) shkRtc.ws.send(JSON.stringify(m)); }
function shkRtcDrop() { try { shkRtc.pc && shkRtc.pc.close(); } catch (e) {} shkRtc.pc = null; shkRtc.dc = null; shkRtc.phone = ''; }
function shkRtcStop() {
  clearTimeout(shkRtc.retry); clearInterval(shkRtc.beat); shkRtc.beat = 0;
  const ws = shkRtc.ws; shkRtc.ws = null; try { ws && ws.close(); } catch (e) {}
  shkRtcDrop(); shkRtc.st = 'off';
}
// la sala; si se corta, vuelve a entrar (la conexión con el teléfono, si está, sigue)
function shkRtcRoom() {
  let ws;
  try { ws = new WebSocket(`${shkCloud().replace(/^http/, 'ws')}/api/shake/${shk.room}?role=desk`); } catch (e) { shkRtc.st = 'offline'; shkLiveUI(); return; }
  shkRtc.ws = ws; if (shkRtc.st !== 'room') shkRtc.st = 'connecting';
  ws.onopen = () => { shkRtc.tries = 0; shkRtc.st = 'room'; shkLiveUI(); };
  ws.onmessage = (e) => {
    let m = null; try { m = JSON.parse(e.data); } catch (x) { return; }
    shkRtc.chain = shkRtc.chain.then(() => shkRtcSignal(m)).catch(x => { shk.err = 'phone link: ' + (x && x.message ? x.message : x); shkLiveUI(); });
  };
  ws.onclose = (e) => {
    if (shkRtc.ws !== ws) return;
    shkRtc.ws = null; shkRtc.st = e.code === 4000 ? 'taken' : 'offline'; shkLiveUI();
    if (e.code !== 4000) shkRtc.retry = setTimeout(() => { if (shk.listening && !shkRtc.ws) shkRtcRoom(); }, Math.min(5000, 500 * ++shkRtc.tries));
  };
}
async function shkRtcSignal(m) {
  if (m.type === 'hello' && typeof m.id === 'string') {
    // el mismo teléfono (saluda al entrar y cuando llega la compu; también si la sala se reconectó): la conexión que
    // ya está o se está armando sigue
    const pc0 = shkRtc.pc, dc0 = shkRtc.dc;
    if (m.id === shkRtc.phone && pc0 && !/failed|closed/.test(pc0.connectionState) && dc0 && /connecting|open/.test(dc0.readyState)) return;
    shkRtcDrop(); shkRtc.phone = m.id;
    const pc = shkRtc.pc = new RTCPeerConnection({ iceServers: SHK_ICE });
    // sin orden: una pose que llega tarde no frena a las siguientes; acá se ordenan por la hora del teléfono
    const dc = shkRtc.dc = pc.createDataChannel('shake', { ordered: false });
    pc.onicecandidate = (e) => { if (e.candidate) shkRtcSend({ type: 'ice', c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (shkRtc.pc === pc) shkLiveUI(); };
    dc.onopen = () => { shkTell('Connected to BackplateLab.'); shkLiveUI(); };
    dc.onclose = () => { if (shkRtc.dc === dc) shkLiveUI(); };
    dc.onmessage = (e) => { let j = null; try { j = JSON.parse(e.data); } catch (x) { return; } shkFromPhone(j); };
    await pc.setLocalDescription(await pc.createOffer());
    shkRtcSend({ type: 'offer', sdp: pc.localDescription.toJSON() });
  } else if (m.type === 'answer' && shkRtc.pc && shkRtc.pc.signalingState === 'have-local-offer') await shkRtc.pc.setRemoteDescription(m.sdp);
  else if (m.type === 'ice' && shkRtc.pc) await shkRtc.pc.addIceCandidate(m.c).catch(() => {});
  else if (m.type === 'peer') shkLiveUI();
}
// lo que manda la página por el canal: lo mismo que por POST /pose y /cmd (electron/main.js hace esto allá)
function shkFromPhone(j) {
  if (!j || typeof j !== 'object') return;
  if (j.cmd === 'zero' || j.cmd === 'rec') { shkOnPose({ cmd: j.cmd, from: '' }); return; }
  if (!Array.isArray(j.s)) return;
  const st = String(j.st || '');
  shkOnPose({ track: st, reason: String(j.reason || ''), from: '' });
  if (st === 'NORMAL') for (const x of j.s) if (Array.isArray(x) && x.length === 8 && x.every(Number.isFinite)) shkOnPose({ p: x.slice(1, 4), q: x.slice(4, 8), t: x[0], from: '', src: 'rtc' });
}

async function shkListen(on = !shk.listening) {
  if (!on) {
    if (shk.rec) shkRecStop();
    shkRtcStop();
    if (shkDesk()) await window.bplDesktop.shake.stop();
    shk.listening = false; shk.local = ''; shk.pose = null; shk.track = null; shk.times = []; shk.samp = []; shk.buf = shkBufNew(); shkPanel(); return;
  }
  shk.listening = true; shk.err = ''; shk.local = ''; shk.zero = null; shk.pose = null; shk.track = null; shk.times = []; shk.samp = []; shk.buf = shkBufNew(); shk.urls = [];
  shkRtcRoom();
  shkRtc.beat = setInterval(() => { if (shkRtcOpen()) shkRtc.dc.send(JSON.stringify({ rec: !!shk.rec, msg: '' })); }, 500); // que el teléfono sepa que sigue
  // sin internet: la página desde esta compu, y ZIG SIM
  if (shkDesk()) {
    const r = await window.bplDesktop.shake.listen(Math.round(+$('shk-port').value));
    if (!shk.listening) { window.bplDesktop.shake.stop(); return; }
    if (r.error) shk.local = r.error;
    else { shk.port = r.port; shk.addrs = r.addrs || []; shk.urls = r.urls || []; }
  }
  shkSave(); shkPanel();
}
const shkFresh = () => !!(shk.pose && performance.now() - shk.arrived < 1000);
// la página del teléfono pregunta seguido: se le contesta si se graba y qué pasó
function shkTell(msg) {
  if (shkDesk() && window.bplDesktop.shake.state) window.bplDesktop.shake.state({ rec: !!shk.rec, msg: msg || '' });
  if (shkRtcOpen()) shkRtc.dc.send(JSON.stringify({ rec: !!shk.rec, msg: msg || '' }));
}
function shkZeroNow() {
  if (!shk.pose) { toast('Shakelab: no pose from the phone yet', true); return; }
  shk.zero = shkZero(shk.pose); shk.live = [0, 0, 0, 0, 0, 0]; shkTell('Zero: the phone as it is now is the centre.');
  if (shk.sel >= 0 && !shk.rec) { shk.sel = -1; shkTakesUI(); }
  shkDirty();
}

// ---------- Tomas ----------
function shkRecStart() {
  if (!shkFresh()) { const m = shk.listening ? 'No pose from the phone yet: open the link on the phone, tap Start and wait for Tracking.' : 'Listen first'; toast('Shakelab: ' + m, true); shkTell(m); return; }
  shk.zero = shkZero(shk.pose); shk.live = [0, 0, 0, 0, 0, 0];
  shk.rec = { t0: shk.pose.t, len: Math.max(1, tl.end - tl.start) / tl.fps, s: [{ t: 0, v: [0, 0, 0, 0, 0, 0] }] };
  shk.sel = -1;
  tlPlay(false); tlSet(tl.start); tlPlay(true);
  shkTell(`Recording ${shk.rec.len.toFixed(1)} s, the length of the timeline.`); shkPanel();
}
function shkRecStop() {
  const r = shk.rec; if (!r) return;
  shk.rec = null; tlPlay(false);
  r.s.sort((a, b) => a.t - b.t);
  if (r.s.length < 2) { toast('Shakelab: nothing recorded', true); shkTell('Nothing recorded.'); shkPanel(); return; }
  const n = shk.takes.reduce((m, t) => Math.max(m, +(/(\d+)$/.exec(t.name) || [0, 0])[1]), 0) + 1;
  shk.takes.push({ name: `Take ${n}`, s: r.s, len: r.s[r.s.length - 1].t });
  shk.sel = shk.takes.length - 1;
  tlSet(tl.start);
  toast(`Shakelab: Take ${n} recorded (${shk.takes[shk.sel].len.toFixed(1)} s). Play the timeline to see it.`);
  shkTell(`Take ${n} recorded (${shk.takes[shk.sel].len.toFixed(1)} s).`);
  shkPanel();
}
function shkTakesUI() {
  const sel = $('shk-take');
  sel.innerHTML = ['<option value="-1">Live phone</option>', ...shk.takes.map((t, i) => `<option value="${i}">${t.name} · ${t.len.toFixed(1)} s</option>`)].join('');
  sel.value = String(shk.sel); sel.disabled = !!shk.rec;
  $('shk-del').disabled = shk.sel < 0 || !!shk.rec;
  $('shk-chan').disabled = shk.sel < 0 || !!shk.rec;
}
// la cámara de la toma con la toma elegida y sus límites, cuadro por cuadro, como .chan de Nuke
// (frame, translate x y z, rotate x y z en grados; rot_order ZXY, el de la cámara de Nuke)
function shkChanText() {
  const take = shk.takes[shk.sel], r2d = 180 / Math.PI, n = (v) => (Math.abs(v) < 5e-13 ? 0 : v).toFixed(6), out = [];
  for (let f = tl.start; f <= tl.end; f++) {
    const c = shkCamAt(shkLimit(shkSample(take, (f - tl.start) / tl.fps), shk.lims, shk.brake));
    out.push([f, ...c.p.map(n), ...[c.e.x, c.e.y, c.e.z].map(a => n(a * r2d))].join(' '));
  }
  return out.join('\n') + '\n';
}
async function shkChan() {
  const take = shk.takes[shk.sel]; if (!take) return;
  const name = `${($('camname').value || 'MatchCam').replace(/[^\w-]/g, '_')}_${take.name.replace(/\s+/g, '')}.chan`, text = shkChanText();
  if (window.bplDesktop && typeof desktopSave === 'function') { const r = await desktopSave(text, name); toast(r.msg, !!r.error); return; }
  const a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000); toast(`Saved as ${name} (Downloads)`);
}

// ---------- Panel ----------
function shkLiveUI() {
  if (!shk.on) return;
  const fresh = shkFresh(), rate = fresh ? shk.times.length : 0;
  let badge = 'off', live = '';
  const trk = shk.track && performance.now() - shk.track.at < 2000 ? shk.track : null;
  const ph = shk.from ? `The phone ${shk.from}` : 'The phone', pc = shkRtc.pc && shkRtc.pc.connectionState;
  if (shk.err) live = 'Error: ' + shk.err;
  else if (shk.listening) {
    badge = shk.rec ? 'REC' : fresh ? `${rate}/s` : 'listening';
    if (fresh) live = `Receiving ${shk.src === 'rtc' ? 'straight from the phone' : `from ${shk.from}${shk.src === 'zigsim' ? ' (ZIG SIM)' : ''}`} · ${rate} poses/s · delay ${Math.round(shk.buf.delay)} ms${shk.rec ? ` · recording ${((shk.pose.t - shk.rec.t0) / 1000).toFixed(1)} of ${shk.rec.len.toFixed(1)} s` : ''}`;
    else if (trk && !trk.st) live = `${ph} has the page open: tap Start on the phone.`;
    else if (trk) live = `${ph} is starting to track (${(trk.reason || trk.st).toLowerCase().replace(/_/g, ' ')}): move it slowly side to side.`;
    else if (shk.none && performance.now() - shk.none < 3000) live = `ZIG SIM is sending from ${shk.from}, but without the ARKit pose: turn on ARKit with Tracking type DEVICE.`;
    else if (pc === 'failed') live = `The phone could not connect straight to this computer: this network may block it. Put both on the same Wi-Fi${shk.urls.length ? ', or open the link Without internet' : ''}.`;
    else if (shkRtc.phone && !shkRtcOpen()) live = 'The phone is connecting…';
    else if (shk.pose) live = 'No pose from the phone for a while: is the page still open and in front?';
    else if (shkRtc.st === 'connecting') live = 'Opening the phone link…';
    else if (shkRtc.st === 'taken') live = 'The phone link was opened in another window of BackplateLab: this one stopped. Listen again to take it back.';
    else if (shkRtc.st === 'offline') live = `Cannot reach ${shkCloud().replace(/^https?:\/\//, '')}: the phone link needs internet${shk.urls.length ? '. Without internet, use the link below' : ''}.`;
    else live = 'Waiting for the phone: open the link on it.';
    if (shk.local) live += ` · Without internet: ${shk.local}`;
  }
  $('shk-st').textContent = badge; $('shk').dataset.state = shk.rec ? 'warn' : fresh ? 'ok' : '';
  $('shk-live').textContent = live;
  const raw = shkRaw(), cam = shkLimit(raw, shk.lims, shk.brake);
  SHK_AXES.forEach((a, i) => {
    const L = shk.lims[i], pos = (v) => `${50 + 50 * Math.max(-1, Math.min(1, L > 0 ? v / (L * 1.5) : 0))}%`;
    $('shk-r-' + a.k).textContent = shkFmt(raw[i], a); $('shk-c-' + a.k).textContent = shkFmt(cam[i], a);
    $('shk-bi-' + a.k).style.left = pos(raw[i]); $('shk-bc-' + a.k).style.left = pos(cam[i]);
  });
  $('shk-rec').disabled = !shk.listening;
  $('shk-zero').disabled = !fresh || !!shk.rec;
  shkCurve(raw);
}
function shkPanel() {
  $('shk-port').value = shk.port; $('shk-port').disabled = shk.listening || !shkDesk();
  const b = $('shk-listen'); b.setAttribute('aria-pressed', String(shk.listening)); b.textContent = shk.listening ? 'Stop listening' : 'Listen';
  $('shk-rec').textContent = shk.rec ? 'Stop' : 'Rec';
  $('shk-brake').value = Math.round(shk.brake * 100); $('shk-lag').value = shk.lag;
  SHK_AXES.forEach((a, i) => { const el = $('shk-l-' + a.k); if (document.activeElement !== el) el.value = shk.lims[i]; });
  const url = shk.listening ? shkPhoneUrl() : '';
  $('shk-how').innerHTML = url ? `On the phone, on the same Wi-Fi as this computer, open <b>${url}</b> in Safari (or scan the code with the camera). Tap <b>Start</b>, allow the camera and motion, and move the phone slowly side to side until it says Tracking. Zero and Rec work from the phone too. The link is always the same on this computer: it can stay in the phone's favourites.`
    : '<b>Listen</b>, then open the link that shows here on the phone, in Safari. Free: no app to install. The phone and this computer connect straight over the network: the motion does not go through the internet.';
  $('shk-urls').textContent = shk.listening && shk.urls.length ? `Without internet: on the same Wi-Fi, open ${shk.urls[0]} instead (served by this computer; the first time Safari warns that the connection is not private: Show Details › visit this website)${shk.urls.length > 1 ? `. Other addresses of this computer: ${shk.urls.slice(1).join(' · ')}` : ''}.` : '';
  $('shk-qr').innerHTML = url && typeof qrcode === 'function' ? (() => { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code: ' + url }); })() : '';
  $('shk-qr').hidden = !url;
  $('shk-zig').textContent = shkDesk() ? `ZIG SIM Pro (paid) also works: ARKit on, Tracking type DEVICE, Protocol UDP, IP ${shk.addrs[0] || 'of this computer'}, Port ${shk.port}.` : '';
  $('shk-note').textContent = shk.sel >= 0 ? 'The timeline plays the take with the traffic. Changing a limit or Brake changes the take too: it is stored raw.' : '';
  shkTakesUI(); shkLiveUI();
}
// la curva de frenada: el iPhone (horizontal) contra la cámara (vertical), en partes del límite, y cada eje ahora
function shkCurve(raw) {
  const cv = $('shk-curve'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'), css = getComputedStyle(document.documentElement), col = (k) => css.getPropertyValue(k).trim();
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const R = 2, pad = 6, sx = (x) => pad + (x + R) / (2 * R) * (W - 2 * pad), sy = (y) => H / 2 - y / 1.25 * (H / 2 - pad);
  g.lineWidth = 1; g.strokeStyle = col('--line'); g.setLineDash([3, 3]);
  g.beginPath(); for (const y of [-1, 1]) { g.moveTo(sx(-R), sy(y)); g.lineTo(sx(R), sy(y)); } g.moveTo(sx(-1.25), sy(-1.25)); g.lineTo(sx(1.25), sy(1.25)); g.stroke();
  g.setLineDash([]); g.strokeStyle = col('--faint'); g.beginPath(); g.moveTo(sx(-R), sy(0)); g.lineTo(sx(R), sy(0)); g.moveTo(sx(0), 0); g.lineTo(sx(0), H); g.stroke();
  g.strokeStyle = col('--accent-hi') || col('--accent'); g.lineWidth = 2; g.beginPath();
  for (let i = 0; i <= 200; i++) { const x = -R + 2 * R * i / 200, y = shkSoft(x, 1, shk.brake); i ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y)); }
  g.stroke();
  g.font = `600 ${Math.round(parseFloat(css.fontSize) * 0.9)}px ${col('--f-ui') || 'sans-serif'}`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  SHK_AXES.forEach((a, i) => {
    const L = shk.lims[i]; if (!(L > 0)) return;
    const x = Math.max(-R, Math.min(R, raw[i] / L)), y = shkSoft(x, 1, shk.brake);
    g.fillStyle = col('--text'); g.beginPath(); g.arc(sx(x), sy(y), 3, 0, 2 * Math.PI); g.fill();
    if (Math.abs(raw[i]) > L * 0.05) g.fillText(a.label[0], sx(x), sy(y) - 4);
  });
}
{
  $('shk-axes').innerHTML = '<span class="h">Axis</span><span class="h">Phone</span><span class="h">Camera</span><span class="h">Limit ±</span>'
    + SHK_AXES.map(a => `<span class="ax">${a.label}</span><output id="shk-r-${a.k}"></output><output id="shk-c-${a.k}"></output>`
      + `<input id="shk-l-${a.k}" class="mini" type="number" min="0" step="${a.step}" data-unit="${a.unit}" aria-label="${a.label} limit" title="${a.label}: how far the camera can go each way (${a.unit === 'm' ? 'metres' : 'degrees'}). 0 locks it.">`
      + `<span class="shk-bar" title="Phone (thin) and camera (thick), up to 1.5 times the limit each way"><i class="lim l"></i><i class="lim r"></i><i class="in" id="shk-bi-${a.k}"></i><i class="cam" id="shk-bc-${a.k}"></i></span>`).join('');
  SHK_AXES.forEach((a, i) => $('shk-l-' + a.k).addEventListener('change', e => {
    const v = +e.target.value; shk.lims[i] = Number.isFinite(v) && v >= 0 ? v : a.lim; e.target.value = shk.lims[i];
    shkSave(); shkLiveUI(); render();
  }));
  $('shk-brake').addEventListener('change', e => {
    const v = +e.target.value; shk.brake = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 0.3;
    shkSave(); shkPanel(); render();
  });
  $('shk-lag').innerHTML = SHK_LAG.map(l => `<option value="${l.k}">${l.label}</option>`).join('');
  $('shk-lag').addEventListener('change', e => { shk.lag = e.target.value; shkSave(); });
  $('shk-port').addEventListener('change', e => { const v = Math.round(+e.target.value); if (v >= 1024 && v <= 65535) { shk.port = v; shkSave(); } shkPanel(); });
  $('shk-listen').onclick = () => shkListen();
  $('shk-zero').onclick = shkZeroNow;
  $('shk-rec').onclick = () => (shk.rec ? shkRecStop() : shkRecStart());
  $('shk-take').addEventListener('change', e => { shk.sel = Math.min(shk.takes.length - 1, +e.target.value); shkPanel(); render(); });
  $('shk-del').onclick = () => {
    const t = shk.takes[shk.sel]; if (!t) return;
    shk.takes.splice(shk.sel, 1); shk.sel = Math.min(shk.sel, shk.takes.length - 1);
    toast(`Shakelab: ${t.name} deleted`); shkPanel(); render();
  };
  $('shk-chan').onclick = shkChan;
  if (shkDesk()) window.bplDesktop.shake.onPose(shkOnPose);
  shkPanel();
}

// ---------- Proyecto ----------
// las tomas viajan en el proyecto (crudas, redondeadas a la décima de milímetro y de grado de milésima)
function shkProjectState() {
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return { lims: shk.lims.slice(), brake: shk.brake, sel: shk.sel,
    takes: shk.takes.map(t => ({ name: t.name, len: r(t.len), s: t.s.map(x => [r(x.t), ...x.v.map(r)]) })) };
}
function shkApplyProject(p) {
  if (!p || typeof p !== 'object') return;
  if (Array.isArray(p.lims) && p.lims.length === SHK_AXES.length && p.lims.every(v => Number.isFinite(v) && v >= 0)) shk.lims = p.lims.slice();
  if (Number.isFinite(p.brake)) shk.brake = Math.max(0, Math.min(1, p.brake));
  shk.takes = (Array.isArray(p.takes) ? p.takes : []).filter(t => t && Array.isArray(t.s) && t.s.length > 1)
    .map((t, i) => ({ name: String(t.name || `Take ${i + 1}`), len: +t.len || 0, s: t.s.filter(x => Array.isArray(x) && x.length === 7 && x.every(Number.isFinite)).map(x => ({ t: x[0], v: x.slice(1) })) }))
    .filter(t => t.s.length > 1);
  shk.takes.forEach(t => { t.len = t.s[t.s.length - 1].t; });
  shk.sel = Number.isInteger(p.sel) && p.sel < shk.takes.length ? Math.max(-1, p.sel) : -1;
  shkSave(); shkPanel(); if (shk.on) render();
}
