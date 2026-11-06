// Shakelab: la página del teléfono. El motor de 8th Wall (vendor/8thwall) sigue la cámara del teléfono con la imagen
// y los sensores (SLAM), con escala absoluta: metros. En cada cuadro guarda la pose de la cámara (posición y
// cuaternión, con la convención de three.js: mira a −Z, Y arriba) y la manda a BackplateLab apenas está. La hora es la
// del teléfono, así la toma no depende de cómo llegan los paquetes por el Wi-Fi. Zero y Rec mandan la orden, y
// BackplateLab le cuenta a la página si está grabando ({ rec, msg }).
// Dos caminos, según cómo se abrió la página (D-08):
//  - Desde la web publicada, con la sala en el # (el link del QR): por WebRTC, directo a la compu por la red. La web
//    (worker/index.js, /api/shake/<sala>) sólo los presenta: la compu manda la oferta, la página contesta, y las poses
//    y las órdenes van por un canal de datos sin orden ({ s, st, reason } y { cmd }).
//  - Desde la app de escritorio, sin internet (electron/shake-phone.mjs): POST /pose y POST /cmd, y la respuesta
//    trae el estado.
const $ = (id) => document.getElementById(id);
const pg = { last: 0, queue: [], st: '', reason: '', started: false, halt: false, busy: 0, ok: 0, fail: 0, rec: false, msg: '', sent: [] };
const TRACK_TEXT = { INITIALIZING: 'move the phone slowly side to side', EXCESSIVE_MOTION: 'too fast: move slower', INSUFFICIENT_FEATURES: 'point at something with detail', NORMAL: '' };
const ROOM = (/^#([A-Za-z0-9_-]{22,64})$/.exec(location.hash) || [])[1] || '';

function ui() {
  const live = pg.st === 'NORMAL', reach = pg.ok && performance.now() - pg.ok < 2000;
  const s = $('state');
  if (!pg.started) { s.textContent = 'Not started'; s.className = ''; }
  else if (!reach && (pg.fail || ROOM)) { s.textContent = ROOM ? 'Not connected to BackplateLab' : 'Cannot reach BackplateLab'; s.className = 'bad'; }
  else if (pg.halt) { s.textContent = 'Stopped: see below'; s.className = 'bad'; }
  else if (live) { const r = pg.sent.length; s.textContent = `Tracking · ${r}/s${pg.rec ? ' · REC' : ''}`; s.className = 'ok'; }
  else { s.textContent = pg.st ? `Starting: ${TRACK_TEXT[pg.reason] || TRACK_TEXT[pg.st] || (pg.reason || pg.st).toLowerCase()}` : 'Starting the camera…'; s.className = ''; }
  $('zero').disabled = !live || !reach || pg.rec;
  $('rec').disabled = !reach || (!live && !pg.rec);
  $('rec').textContent = pg.rec ? 'Stop' : 'Rec'; $('rec').classList.toggle('on', pg.rec);
  if (pg.msg) $('msg').textContent = pg.msg;
}
function err(text) { pg.msg = text; $('msg').textContent = text; }
function halt(text) { pg.halt = true; err(text); ui(); }
// lo que cuenta BackplateLab
function heard(j) { pg.ok = performance.now(); pg.fail = 0; pg.rec = !!j.rec; if (j.msg) pg.msg = j.msg; }

// ---------- Sin internet: POST a la app de escritorio ----------
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(); heard(j);
  return j;
}

// ---------- Por la web: WebRTC ----------
const rtc = { ws: null, pc: null, dc: null, desk: false, tries: 0, chain: Promise.resolve(), id: Math.random().toString(36).slice(2) };
const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const rtcOpen = () => !!(rtc.dc && rtc.dc.readyState === 'open');
function wsSend(m) { if (rtc.ws && rtc.ws.readyState === 1) rtc.ws.send(JSON.stringify(m)); }
function rtcDrop() { try { rtc.pc && rtc.pc.close(); } catch (e) {} rtc.pc = null; rtc.dc = null; }
async function rtcSignal(m) {
  if (m.type === 'peer' && m.role === 'desk') {
    rtc.desk = m.on;
    if (m.on) wsSend({ type: 'hello', id: rtc.id }); // la compu llegó: que conecte
    else if (!rtcOpen()) err('Waiting for BackplateLab: tap Listen in Shakelab on the computer.');
  } else if (m.type === 'offer') {
    rtcDrop();
    const pc = rtc.pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onicecandidate = (e) => { if (e.candidate) wsSend({ type: 'ice', c: e.candidate.toJSON() }); };
    pc.ondatachannel = (e) => {
      const dc = rtc.dc = e.channel;
      dc.onopen = () => { err('Connected to BackplateLab.'); ui(); };
      dc.onmessage = (ev) => { try { heard(JSON.parse(ev.data)); } catch (x) {} ui(); };
      dc.onclose = () => { if (rtc.dc === dc) err('The connection to BackplateLab closed.'); ui(); };
    };
    pc.onconnectionstatechange = () => {
      if (rtc.pc === pc && pc.connectionState === 'failed') err('Could not connect straight to the computer: this network may block it. Use the same Wi-Fi as the computer, or the link "Without internet" in BackplateLab.');
    };
    await pc.setRemoteDescription(m.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    wsSend({ type: 'answer', sdp: pc.localDescription.toJSON() });
  } else if (m.type === 'ice' && rtc.pc) await rtc.pc.addIceCandidate(m.c).catch(() => {});
}
function rtcConnect() {
  const ws = rtc.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/shake/${ROOM}?role=phone`);
  ws.onopen = () => { rtc.tries = 0; wsSend({ type: 'hello', id: rtc.id }); if (!rtcOpen()) err('Waiting for BackplateLab: tap Listen in Shakelab on the computer.'); };
  // en orden: un candidato no puede entrar antes que la oferta
  ws.onmessage = (e) => { let m = null; try { m = JSON.parse(e.data); } catch (x) { return; } rtc.chain = rtc.chain.then(() => rtcSignal(m)).catch(x => err('Connection error: ' + (x && x.message ? x.message : x))); };
  ws.onclose = (e) => {
    if (rtc.ws !== ws) return;
    if (e.code === 4000) { err('This link was opened on another phone or tab: this one stopped.'); rtcDrop(); ui(); return; }
    setTimeout(rtcConnect, Math.min(5000, 500 * ++rtc.tries));
  };
}

// ---------- Mandar ----------
// cada pose sale apenas está (flush, desde onUpdate), y cada 33 ms el estado del seguimiento aunque no haya poses.
// Sin internet: hasta tres envíos en camino (el Wi-Fi del teléfono a veces tarda, y esperar a cada respuesta junta las
// poses en tandas grandes); lo que no sale queda en la cola para el próximo. Si llegan desordenadas no importa: cada
// pose trae su hora y BackplateLab las ordena.
async function flush() {
  if (!pg.started) return;
  if (ROOM) {
    if (!rtcOpen() || rtc.dc.bufferedAmount > 256 * 1024) return;
  } else if (pg.busy >= 3) return;
  const s = pg.queue; pg.queue = [];
  const now = performance.now(); pg.last = now; pg.sent = pg.sent.filter(t => now - t < 1000); s.forEach(x => pg.sent.push(x[0]));
  const body = { s, st: pg.st, reason: pg.reason };
  if (ROOM) { rtc.dc.send(JSON.stringify(body)); return; }
  pg.busy++;
  try { await post('/pose', body); } catch (e) { pg.fail++; } finally { pg.busy--; ui(); }
}
setInterval(() => { if (!(performance.now() - pg.last < 33)) flush(); }, 33);
setInterval(ui, 250); // por WebRTC el estado llega solo: que se vea también cuando deja de llegar
function cmd(c) {
  if (!ROOM) { post('/cmd', { cmd: c }).then(ui, () => { pg.fail++; ui(); }); return; }
  if (rtcOpen()) rtc.dc.send(JSON.stringify({ cmd: c }));
}

// ---------- Seguimiento ----------
const poseModule = {
  name: 'bpl-pose',
  onUpdate: ({ processCpuResult }) => {
    const r = processCpuResult && processCpuResult.reality; if (!r || !r.position || !r.rotation) return;
    const p = r.position, q = r.rotation;
    pg.queue.push([performance.now(), p.x, p.y, p.z, q.x, q.y, q.z, q.w]);
    if (pg.queue.length > 240) pg.queue.shift(); // sin conexión no se junta para siempre
    flush();
  },
  onCameraStatusChange: ({ status }) => {
    if (status === 'failed') halt('The camera did not start. Allow the camera for this page (Safari: aA › Website Settings › Camera) and reload.');
  },
  onException: (e) => {
    if (e && e.type === 'permission') halt(e.permission === 'camera' ? 'The camera was not allowed. Allow it for this page (Safari: aA › Website Settings › Camera) and reload.'
      : 'Motion and orientation were not allowed: tracking needs them. Close this tab, open the link again and allow them when Start asks.');
    else err('Tracking error: ' + (e && e.message ? e.message : typeof e === 'object' ? JSON.stringify(e) : e));
  },
  listeners: [{ event: 'reality.trackingstatus', process: ({ detail }) => { pg.st = detail.status || ''; pg.reason = detail.reason || ''; ui(); } }],
};
const xrReady = new Promise((ok) => { if (window.XR8) ok(); else window.addEventListener('xrloaded', ok, { once: true }); });

$('start').onclick = () => {
  if (pg.started) return;
  // iOS: el permiso de los sensores se pide dentro del toque, antes de cualquier espera
  const perms = [window.DeviceMotionEvent, window.DeviceOrientationEvent].filter(E => E && typeof E.requestPermission === 'function').map(E => E.requestPermission().catch(() => 'denied'));
  pg.started = true; $('intro').hidden = true; ui();
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); // que la pantalla no se apague
  Promise.all(perms).then(async (r) => {
    if (r.includes('denied')) err('Motion access was not allowed: tracking needs it. Reload the page and allow it.');
    await xrReady;
    if (XR8.loadChunk) await XR8.loadChunk('slam');
    XR8.XrController.configure({ scale: 'absolute', disableWorldTracking: false });
    XR8.addCameraPipelineModules([XR8.GlTextureRenderer.pipelineModule(), XR8.XrController.pipelineModule(), poseModule]);
    XR8.run({ canvas: $('cam'), allowedDevices: XR8.XrConfig.device().MOBILE, cameraConfig: { direction: XR8.XrConfig.camera().BACK } });
  }).catch(e => err('Could not start: ' + (e && e.message ? e.message : e)));
};
for (const c of ['zero', 'rec']) $(c).onclick = () => cmd(c);
document.addEventListener('visibilitychange', () => { if (document.hidden && pg.started) err('Keep this page in front while you record.'); });
// antes de Start: ¿llega a BackplateLab?
if (ROOM) rtcConnect();
else post('/pose', { s: [], st: '', reason: '' }).then(() => err('Connected to BackplateLab.'), () => err('Cannot reach BackplateLab: is Shakelab listening?'));
