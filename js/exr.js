// ---------- EXR: header/metadata, decode, color ----------
const EXR = (() => {
  const COMP = ['NONE', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB', 'HTJ2K256', 'HTJ2K32'];
  function parseHeader(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    if (dv.getUint32(0, true) !== 20000630) throw new Error('not an EXR file');
    const ver = dv.getUint32(4, true);
    const flags = { tiled: !!(ver & 0x200), longNames: !!(ver & 0x400), deep: !!(ver & 0x800), multipart: !!(ver & 0x1000) };
    let o = 8;
    // un EXR cortado o roto: sin el 0 final el nombre no termina nunca (la página se colgaba)
    const cstr = () => { let s = ''; while (o < u8.length && u8[o] !== 0) s += String.fromCharCode(u8[o++]); if (o >= u8.length) throw new Error('truncated or damaged EXR header'); o++; return s; };
    const utf8 = (a, b) => { try { return new TextDecoder('utf-8').decode(u8.subarray(a, b)); } catch (e) { return ''; } };
    const attrs = [];
    while (u8[o] !== 0 && o < buf.byteLength) {
      const name = cstr(), type = cstr();
      if (o + 4 > buf.byteLength) throw new Error('truncated or damaged EXR header');
      const size = dv.getInt32(o, true); o += 4;
      if (size < 0 || o + size > buf.byteLength) throw new Error('truncated or damaged EXR header');
      const s = o, e = o + size;
      let v, raw = null;
      const f = (k) => dv.getFloat32(s + 4 * k, true), i = (k) => dv.getInt32(s + 4 * k, true);
      switch (type) {
        case 'string': v = utf8(s, e); break;
        case 'int': v = i(0); break;
        case 'float': v = f(0); break;
        case 'double': v = dv.getFloat64(s, true); break;
        case 'v2i': v = [i(0), i(1)]; break;
        case 'v2f': v = [f(0), f(1)]; break;
        case 'v3i': v = [i(0), i(1), i(2)]; break;
        case 'v3f': v = [f(0), f(1), f(2)]; break;
        case 'box2i': v = { xMin: i(0), yMin: i(1), xMax: i(2), yMax: i(3) }; raw = s; break;
        case 'box2f': v = [f(0), f(1), f(2), f(3)]; break;
        case 'chromaticities': v = [0, 1, 2, 3, 4, 5, 6, 7].map(f); break;
        case 'compression': v = COMP[u8[s]] || ('#' + u8[s]); break;
        case 'lineOrder': v = ['INCREASING_Y', 'DECREASING_Y', 'RANDOM_Y'][u8[s]] || u8[s]; break;
        case 'rational': v = [i(0), dv.getUint32(s + 4, true)]; break;
        case 'm33f': v = [...Array(9)].map((_, k) => f(k)); break;
        case 'm44f': v = [...Array(16)].map((_, k) => f(k)); break;
        case 'timecode': {
          const t = dv.getUint32(s, true), bcd = (x) => ((x >> 4) & 0xf) * 10 + (x & 0xf);
          const pad = (n) => String(n).padStart(2, '0');
          v = `${pad(bcd((t >> 24) & 0x3f))}:${pad(bcd((t >> 16) & 0x7f))}:${pad(bcd((t >> 8) & 0x7f))}:${pad(bcd(t & 0x3f))}`;
          break;
        }
        case 'chlist': {
          const ch = []; let p = s;
          while (p < e && u8[p] !== 0) {
            let nm = ''; while (u8[p] !== 0) nm += String.fromCharCode(u8[p++]); p++;
            ch.push({ name: nm, type: ['uint', 'half', 'float'][dv.getInt32(p, true)] || '?' });
            p += 16;
          }
          v = ch; break;
        }
        case 'stringvector': {
          const out = []; let p = s;
          while (p + 4 <= e) { const n = dv.getInt32(p, true); p += 4; out.push(utf8(p, p + n)); p += n; }
          v = out; break;
        }
        default: v = `(${type}, ${size} bytes)`;
      }
      attrs.push({ name, type, value: v, raw });
      o = e;
    }
    const get = (n) => { const a = attrs.find(x => x.name === n); return a ? a.value : undefined; };
    return { attrs, get, flags, find: (n) => attrs.find(x => x.name === n), end: o + 1 };
  }

  // linear primaries -> linear Rec.709 / sRGB (D65, Bradford where needed)
  const TO709 = {
    ap0: [2.52168619, -1.13413099, -0.38755520, -0.27621507, 1.37271909, -0.09650402, -0.01537792, -0.15297515, 1.16835307],
    ap1: [1.70505099, -0.62179212, -0.08325887, -0.13025642, 1.14080474, -0.01054832, -0.02400336, -0.12896869, 1.15297205],
    awg3: [1.617523, -0.537287, -0.080237, -0.070573, 1.334613, -0.26404, -0.021102, -0.226954, 1.248056],
    rec2020: [1.66049100, -0.58764114, -0.07284986, -0.12455047, 1.13289990, -0.00834942, -0.01815076, -0.10057890, 1.11872966],
    rec709: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
  const CS_NAMES = { ap0: 'ACES2065-1 (AP0)', ap1: 'ACEScg (AP1)', awg3: 'ARRI Wide Gamut 3 (linear)', rec2020: 'Rec.2020 (linear)', rec709: 'Rec.709 / sRGB (linear)' };
  function detectSpace(h) {
    const c = h.get('chromaticities');
    if (c) {
      const near = (x, y, tx, ty) => Math.abs(x - tx) < 0.004 && Math.abs(y - ty) < 0.004;
      if (near(c[0], c[1], 0.7347, 0.2653)) return ['ap0', 'from the header primaries'];
      if (near(c[0], c[1], 0.713, 0.293)) return ['ap1', 'from the header primaries'];
      if (near(c[0], c[1], 0.684, 0.313)) return ['awg3', 'from the header primaries'];
      if (near(c[0], c[1], 0.708, 0.292)) return ['rec2020', 'from the header primaries'];
      if (near(c[0], c[1], 0.64, 0.33)) return ['rec709', 'from the header primaries'];
    }
    if (h.get('acesImageContainerFlag') === 1) return ['ap0', 'ACES container file (ST 2065-4)'];
    const csKey = h.attrs.find(a => /colou?rspace|interchange/i.test(a.name) && typeof a.value === 'string');
    if (csKey) {
      const s = csKey.value.toLowerCase();
      if (/acescg|ap1/.test(s)) return ['ap1', 'from ' + csKey.name];
      if (/aces|ap0|2065/.test(s)) return ['ap0', 'from ' + csKey.name];
      if (/awg|alexa/.test(s)) return ['awg3', 'from ' + csKey.name];
    }
    return ['ap0', 'nothing in the header, assuming ACES2065-1'];
  }

  // camera/lens hints from metadata (OpenEXR 3.2+ standard names first, then vendor keys)
  function lensHints(h) {
    const num = (v) => typeof v === 'number' ? v
      : typeof v === 'string' ? parseFloat(v.replace(',', '.'))
      : Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && v[1] ? v[0] / v[1] : NaN; // rational
    // focal values may come in mm, meters or microns
    const toMM = (v) => !Number.isFinite(v) || v <= 0 ? NaN : v < 0.5 ? (v >= 0.004 ? v * 1000 : NaN) : v > 2000 ? (v / 1000 >= 1 && v / 1000 < 2000 ? v / 1000 : NaN) : v;
    const out = {};
    for (const k of ['pinholeFocalLength', 'effectiveFocalLength', 'nominalFocalLength']) {
      const v = toMM(num(h.get(k))); if (v >= 1 && v < 2000) { out.focal = v; out.focalKey = k; break; }
    }
    if (!out.focal) {
      const a = h.attrs.find(x => /focal|lens.?length/i.test(x.name) && !/hyper|distance|ratio|pixel|px|equiv|35mm|plane/i.test(x.name) && toMM(num(x.value)) >= 1 && toMM(num(x.value)) < 2000);
      if (a) { out.focal = toMM(num(a.value)); out.focalKey = a.name; }
    }
    if (!out.focal) { // "Focal Length: 35 mm" inside a text attribute
      for (const a of h.attrs) {
        if (typeof a.value !== 'string') continue;
        const m = a.value.match(/focal[\s_-]*length[^0-9]{0,20}(\d+(?:[.,]\d+)?)\s*mm/i);
        if (m) { out.focal = parseFloat(m[1].replace(',', '.')); out.focalKey = a.name; break; }
      }
    }
    if (!out.focal) { // lens model like "Signature Prime 32mm" / "Ultra Prime 50"
      const a = h.attrs.find(x => /lens/i.test(x.name) && typeof x.value === 'string' && /(\d{1,3}(?:[.,]\d)?)\s*mm\b|\b(\d{2,3})\s*$/i.test(x.value));
      if (a) { const m = a.value.match(/(\d{1,3}(?:[.,]\d)?)\s*mm\b|\b(\d{2,3})\s*$/i); const v = parseFloat((m[1] || m[2]).replace(',', '.')); if (v >= 4 && v < 1500) { out.focal = v; out.focalKey = a.name + ' (lens name)'; } }
    }
    const rect = h.get('sensorAcquisitionRectangle'), pitch = num(h.get('sensorPhotositePitch'));
    if (rect && pitch > 0) {
      const w = (rect.xMax - rect.xMin + 1) * pitch / 1000, hh = (rect.yMax - rect.yMin + 1) * pitch / 1000;
      if (w > 1 && w < 100) { out.sw = w; out.sh = hh; out.sensorKey = 'sensorAcquisitionRectangle × sensorPhotositePitch'; }
    }
    if (!out.sw) {
      const wA = h.attrs.find(x => /(sensor|film.?back)/i.test(x.name) && /width|horiz/i.test(x.name) && num(x.value) > 1 && num(x.value) < 100);
      const hA = h.attrs.find(x => /(sensor|film.?back)/i.test(x.name) && /height|vert/i.test(x.name) && num(x.value) > 1 && num(x.value) < 100);
      if (wA) { out.sw = num(wA.value); out.sh = hA ? num(hA.value) : null; out.sensorKey = wA.name; }
    }
    let cam = [h.get('cameraMake'), h.get('cameraModel')].filter(Boolean).join(' ');
    if (!cam) { // vendor keys: com.arri.camera.CameraModel, cameraType, Camera Name...
      const a = h.attrs.find(x => typeof x.value === 'string' && x.value.trim() && /camera.?(model|type|name|id)?$|cameramodel|camera_model/i.test(x.name) && !/lens|serial|index|roll|id$/i.test(x.name));
      if (a) cam = a.value.trim();
    }
    if (!cam) { const a = h.attrs.find(x => typeof x.value === 'string' && /\b(alexa|venice|v-?raptor|komodo|monstro|helium|burano|fx[36]|c[37]0{1,2}|pocket|ursa|blackmagic|varicam)\b/i.test(x.value)); if (a) cam = a.value.trim().slice(0, 60); }
    const lens = [h.get('lensMake'), h.get('lensModel')].filter(Boolean).join(' ');
    if (cam) out.camera = cam;
    if (lens) out.lens = lens;
    // camera orientation (degrees) from vendor keys: tilt/pitch, roll, yaw/pan
    const angle = (re, not, lim) => {
      const a = h.attrs.find(x => re.test(x.name) && !(not && not.test(x.name)) && Number.isFinite(num(x.value)) && Math.abs(num(x.value)) <= lim);
      return a ? { v: num(a.value), key: a.name } : null;
    };
    const tilt = angle(/(tilt|pitch)/i, /(shift|lens|sensor)/i, 90);
    const roll = angle(/roll/i, /(rolling|shutter|lens)/i, 180);
    const yaw = angle(/(yaw|(^|[^a-z])pan(angle)?$|camerapan|headingangle)/i, /(panel|pano|pant)/i, 360);
    if (tilt || roll || yaw) out.orient = { tilt, roll, yaw };
    return out;
  }

  let halfLUT = null;
  function half2f(h) {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
    if (e === 31) return m ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + m / 1024);
  }
  // display encodings: sRGB piecewise, Rec.709 display = inverse BT.1886 (gamma 2.4)
  const srgbLUT = new Uint8Array(4097), r709LUT = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i++) {
    const x = i / 4096;
    srgbLUT[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
    r709LUT[i] = Math.round(255 * Math.pow(x, 1 / 2.4));
  }

  // decode pixels with three's EXRLoader; fixes data windows that don't start at 0,0
  function decode(buf, h) {
    if (h.flags.tiled || h.flags.multipart || h.flags.deep) throw new Error('the EXR is ' + (h.flags.multipart ? 'multipart' : h.flags.tiled ? 'tiled' : 'deep') + '; export it as single-part scanline');
    const comp = h.get('compression');
    if (/^B44/.test(comp) || /^HTJ2K/.test(comp)) throw new Error(`${comp} compression is not supported; re-export with PIZ, ZIP or DWAA`);
    const chans = (h.get('channels') || []).map(c => c.name);
    const usable = chans.filter(n => /^(R|G|B|A|Y)$/.test(n));
    if (!usable.length) throw new Error('no R, G, B or Y channels in the first layer (' + chans.slice(0, 6).join(', ') + ')');
    const types = new Set((h.get('channels') || []).map(c => c.type));
    if (types.size > 1) throw new Error('the EXR mixes half and float channels; export RGB(A) as half only');
    const dw = h.get('dataWindow'), dwA = h.find('dataWindow');
    let b = buf;
    if (dw.xMin !== 0 || dw.yMin !== 0) {
      b = buf.slice(0);
      const v = new DataView(b), w = dw.xMax - dw.xMin, hh = dw.yMax - dw.yMin;
      v.setInt32(dwA.raw, 0, true); v.setInt32(dwA.raw + 4, 0, true); v.setInt32(dwA.raw + 8, w, true); v.setInt32(dwA.raw + 12, hh, true);
      // chunk line numbers are absolute: shift them so they start at 0 too
      const LPB = { NONE: 1, RLE: 1, ZIPS: 1, ZIP: 16, PXR24: 16, PIZ: 32, DWAA: 32, DWAB: 256 }[comp] || 16;
      const blocks = Math.ceil((hh + 1) / LPB);
      for (let k = 0; k < blocks; k++) {
        const off = Number(v.getBigUint64(h.end + k * 8, true));
        if (off + 4 <= b.byteLength) v.setInt32(off, v.getInt32(off, true) - dw.yMin, true);
      }
    }
    const L = new THREE.EXRLoader(); L.setDataType(THREE.HalfFloatType);
    const r = L.parse(b);
    const n = r.width * r.height, stride = Math.round(r.data.length / n);
    return { w: r.width, h: r.height, data: r.data, stride, hasRGB: chans.includes('R'), isY: !chans.includes('R') && chans.includes('Y'), dw };
  }

  // render to an 8-bit canvas in display-window space
  function draw(px, h, opt, cv) {
    if (!halfLUT) { halfLUT = new Float32Array(65536); for (let i = 0; i < 65536; i++) halfLUT[i] = half2f(i); }
    const disp = h.get('displayWindow') || px.dw;
    const W = disp.xMax - disp.xMin + 1, H = disp.yMax - disp.yMin + 1;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H), out = img.data;
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    const M = TO709[opt.cs], gain = Math.pow(2, opt.ev);
    const ox = px.dw.xMin - disp.xMin, oy = px.dw.yMin - disp.yMin;
    const d = px.data, st = px.stride, lut = halfLUT, view = opt.view;
    const tone = view === 'aces709' || view === 'acessrgb';
    const enc = view === 'aces709' || view === 'r709' ? r709LUT : srgbLUT;
    for (let y = 0; y < px.h; y++) {
      const ty = y + oy; if (ty < 0 || ty >= H) continue;
      // EXRLoader stores rows bottom-up
      let si = (px.h - 1 - y) * px.w * st;
      let di = (ty * W + ox) * 4;
      for (let x = 0; x < px.w; x++, si += st, di += 4) {
        const tx = x + ox; if (tx < 0 || tx >= W) continue;
        let r, g, bb;
        if (px.isY) { r = g = bb = lut[d[si]]; } else { r = lut[d[si]]; g = lut[d[si + 1]]; bb = lut[d[si + 2]]; }
        r *= gain; g *= gain; bb *= gain;
        let R = M[0] * r + M[1] * g + M[2] * bb, G = M[3] * r + M[4] * g + M[5] * bb, B = M[6] * r + M[7] * g + M[8] * bb;
        if (tone) {
          // ACES 1.0 sRGB output, fitted (S. Hill): sRGB lin -> RRT_SAT/AP1 -> RRT+ODT fit -> sRGB lin
          const a = 0.59719 * R + 0.35458 * G + 0.04823 * B, c = 0.07600 * R + 0.90834 * G + 0.01566 * B, e = 0.02840 * R + 0.13383 * G + 0.83777 * B;
          const fa = (a * (a + 0.0245786) - 0.000090537) / (a * (0.983729 * a + 0.4329510) + 0.238081);
          const fc = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
          const fe = (e * (e + 0.0245786) - 0.000090537) / (e * (0.983729 * e + 0.4329510) + 0.238081);
          R = 1.60475 * fa - 0.53108 * fc - 0.07367 * fe; G = -0.10208 * fa + 1.10813 * fc - 0.00605 * fe; B = -0.00327 * fa - 0.07276 * fc + 1.07602 * fe;
        }
        if (view === 'raw') {
          out[di] = Math.max(0, Math.min(255, r * 255)); out[di + 1] = Math.max(0, Math.min(255, g * 255)); out[di + 2] = Math.max(0, Math.min(255, bb * 255));
        } else {
          out[di] = enc[(Math.max(0, Math.min(1, R)) * 4096) | 0];
          out[di + 1] = enc[(Math.max(0, Math.min(1, G)) * 4096) | 0];
          out[di + 2] = enc[(Math.max(0, Math.min(1, B)) * 4096) | 0];
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return { W, H };
  }

  function fmtVal(a) {
    const v = a.value;
    if (a.type === 'box2i') return `${v.xMin},${v.yMin} → ${v.xMax},${v.yMax} (${v.xMax - v.xMin + 1}×${v.yMax - v.yMin + 1})`;
    if (a.type === 'chlist') return v.map(c => c.name + ':' + c.type).join(' ');
    if (a.type === 'chromaticities') return v.map(x => x.toFixed(4)).join(' ');
    if (a.type === 'rational') return `${v[0]}/${v[1]}${v[1] ? ' (' + (v[0] / v[1]).toFixed(3) + ')' : ''}`;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(5));
    if (Array.isArray(v)) return v.map(x => typeof x === 'number' ? +x.toFixed(4) : x).join(', ');
    return String(v);
  }
  return { parseHeader, decode, draw, detectSpace, lensHints, fmtVal, CS_NAMES };
})();

let exrState = null;
function resetPinsForNewPlate() { st.pins = []; st.sel = -1; st.solved = null; st.rms = null; }
async function loadExrFile(file) {
  setBusy(true, 'Reading ' + file.name + '…');
  await new Promise(r => setTimeout(r, 30));
  try {
    const buf = await file.arrayBuffer();
    const h = EXR.parseHeader(buf);
    const px = EXR.decode(buf, h);
    const [cs, why] = EXR.detectSpace(h);
    exrState = { h, px, name: file.name, cs, why };
    $('cs').value = cs; $('ev').value = 0; $('ev-v').textContent = '+0.00 EV';
    const dims = drawExr();
    setPlate(null, dims.W, dims.H, file.name, false);
    if (key.on) keyLater();
    $('exr-box').hidden = false;
    resetPinsForNewPlate();
    const md = showExrMeta(h);
    // un EXR sin cámara (un render de Nuke: el plate denoiseado) toma la cámara de un EXR de referencia (el de _input)
    if (typeof vplMetaRefRow === 'function') vplMetaRefRow(!md.has);
    refreshAll();
    projectAfterLoad('plate');
  } catch (err) {
    console.warn('plate EXR', err);
    plateFail(`Could not open ${file.name}: ${err.message || err}. ${PLATE_FORMATS}`);
  }
  setBusy(false);
}
function drawExr() {
  const e = exrState;
  const dims = EXR.draw(e.px, e.h, { cs: $('cs').value, view: $('view').value, ev: +$('ev').value }, $('platecv'));
  $('cs-note').innerHTML = `Detected: <b>${EXR.CS_NAMES[e.cs]}</b> · ${e.why}.`;
  return dims;
}
function redrawExr() {
  if (!exrState) return;
  setBusy(true, 'Applying color…');
  setTimeout(() => { drawExr(); if (key.on) applyKey(); setBusy(false); }, 20);
}
// ---------- Metadata de cámara del plate (como DepthLab: PlateMetadata.cpp + BokehState::applyPlateMetadata) ----------
// T-stop de un anillo («2.8 9/10», «2.8+9/10»): la cuenta vive en js/meta-profiles.js (MetaProfiles.tRing).
function camTStopFromRing(v) { return MetaProfiles.tRing(v) || 0; }
// La lectura es por perfiles de fabricante (js/meta-profiles.js, reglas en docs/METADATA.md). Esto la adapta a la
// forma de siempre (md.camera, md.focal, md.orient...), que usan drive-plate, setreport, video-plate y slate; además
// md.sources (la candidata elegida por campo, con su clave), md.cands, md.warnings (fuentes que no coinciden) y
// md.notes (lo descartado).
function camReadMeta(h) {
  const hint = EXR.lensHints(h);
  const r = MetaProfiles.read(h, { hint });
  const F = (k) => r.fields[k] ? r.fields[k].v : undefined, src = (k) => r.fields[k];
  const md = { hint, sources: r.fields, cands: r.cands, warnings: r.warnings, notes: r.notes };
  md.camera = F('camera') || '';
  md.pitch = F('pitchUm') || 0;
  if (F('rasterW') > 0 && F('rasterH') > 0) { md.rw = F('rasterW'); md.rh = F('rasterH'); }
  // film back que declara la cámara (Sony: ancho y alto efectivos del sensor)
  if (F('filmW') > 0) { md.filmW = F('filmW'); md.filmH = F('filmH') || 0; }
  md.lens = F('lens') || '';
  md.focal = F('focalMm') || 0;
  md.focusM = F('focusM') || 0;
  md.tStop = F('tStop') || 0;
  md.squeeze = F('squeeze') || 0;
  // orientación en grados, convención de la app; file: el número del archivo (para la planilla de cámara)
  const ang = (k) => { const c = src(k); return c ? { v: c.v, key: c.key, ...(c.file !== undefined ? { file: c.file } : {}) } : null; };
  const tilt = ang('tiltDeg'), roll = ang('rollDeg'), yaw = ang('yawDeg');
  if (tilt || roll || yaw) md.orient = { tilt, roll, ...(yaw ? { yaw } : {}) };
  md.fps = F('fps') || 0;
  md.clip = F('clip') || '';
  md.project = F('project') || ''; // la producción de la pizarra: VFX Shooting Sup la usa de arranque
  md.shutter = F('shutterS') || 0;
  md.par = F('par') || 1;
  md.has = !!(md.camera || md.focal > 0 || md.rw > 0 || md.filmW > 0 || hint.sw || md.orient);
  return md;
}
// Aplica lo que dice la metadata (st.plateMeta). Devuelve lo aplicado, para el aviso.
function camApplyPlateMeta() {
  const md = st.plateMeta; if (!md || !md.has) return [];
  const out = [], W = st.plate.W, H = st.plate.H;
  // formato: cámara + raster grabado contra el catálogo. Si el raster no está, el modo cuyo film back coincide con el
  // que declara la cámara; si no, fotositos × pitch o el film back declarado. Lo que no se puede saber NO se adivina en
  // silencio: st.camChoose ('camera' o 'mode') deja el aviso de elegirlo en Plate & camera y en la ficha de la cámara.
  st.camChoose = null;
  const b = camMatchBody(md.camera), m = b && camMatchMode(b, md.rw, md.rh);
  const byFilm = b && !m && md.filmW > 0 ? camModes(b).find(x => Math.abs(x.w / md.filmW - 1) < 0.01 && (!(md.filmH > 0) || Math.abs(x.h / md.filmH - 1) < 0.02)) : null;
  if (m || byFilm) {
    const mm = m || byFilm, ex = camGuessExtract(mm, W, H), fb = camFilmBack(mm, ex);
    st.preset = mm.key; st.camEx = ex ? { key: mm.key, ...ex } : null; setSensor(+fb.w.toFixed(4), +fb.h.toFixed(4), true);
    out.push(`${camBodyName(b)} ${mm.label}` + (m ? '' : ' (by the film back in the file)') + (ex ? ` (extraction ${ex.w} × ${ex.h} guessed from the plate shape: check it)` : ''));
    // el film back que declara la cámara contra el del modo del catálogo
    if (m && md.filmW > 0 && Math.abs(m.w / md.filmW - 1) > 0.01) (md.warnings = md.warnings || []).push({ field: 'filmW', text: `film back: the file says ${fmt(md.filmW, 2)} mm wide, the catalog mode ${fmt(m.w, 2)} mm: check the mode` });
  } else if (md.pitch > 0 && md.rw > 0) {
    setSensor(+(md.rw * md.pitch / 1000).toFixed(3), +(md.rh * md.pitch / 1000).toFixed(3), false);
    out.push(`sensor ${fmt(st.sw, 2)} × ${fmt(md.rh * md.pitch / 1000, 2)} mm (photosites × pitch)`);
  } else if (md.filmW > 0) {
    setSensor(+md.filmW.toFixed(3), +(md.filmH > 0 ? md.filmH : md.filmW * H / W).toFixed(3), false);
    out.push(`film back ${fmt(md.filmW, 2)} mm (from ${md.sources.filmW.key})`);
  } else if (b) {
    // sin raster ni film back no se sabe el modo: queda el de aspecto más parecido, pero se le pide al usuario
    const g = camClosestMode(b, W, H);
    st.preset = g.key; st.camEx = null; setSensor(g.w, g.h, true);
    st.camChoose = 'mode';
    out.push(`${camBodyName(b)} (recording mode not in the file: choose it)`);
  } else if (md.hint.sw) {
    setSensor(+md.hint.sw.toFixed(3), +(md.hint.sh || st.sh).toFixed(3), false);
    out.push(`film back ${fmt(md.hint.sw, 2)} mm (from ${md.hint.sensorKey})`);
  } else {
    st.camChoose = 'camera';
    if (md.camera) out.push(`${md.camera}: not in the camera list, choose the camera or type the film back`);
  }
  if (md.focal > 0) {
    st.focal = +md.focal.toFixed(3); st.fScale = 1; $('focal').value = st.focal; lsSet('focal', st.focal); applyIntrinsics();
    out.push(`${fmt(md.focal, 1)} mm`);
  }
  // pixel aspect del archivo; si no, el squeeze del lente (el plate llega sin desqueeze, como en DepthLab)
  const p = Math.abs(md.par - 1) > 1e-3 ? md.par : md.squeeze > 0 ? md.squeeze : 1;
  setPar(p); if (Math.abs(p - 1) > 1e-3) out.push(`pixel aspect ${fmt(p, 3)}`);
  // foco y T-stop van al bokeh. Con lente y sin T-stop, T2.8 provisional y editable (como DepthLab)
  const lens = {};
  // con su fuente (D-05): el T-stop supuesto queda marcado como supuesto en el lente, el desenfoque y Copy Defocus
  if (md.focusM > 0) { lens.focusM = md.focusM; lens.focusSrc = 'exr'; out.push(`focus ${fmt(md.focusM, 2)} m`); }
  if (md.tStop > 0) { lens.tStop = md.tStop; lens.tStopSrc = 'exr'; out.push(`T${+md.tStop.toFixed(2)}`); }
  else if (md.focal > 0) { lens.tStop = 2.8; lens.tStopSrc = 'assumed'; out.push('T2.8 assumed (no T-stop in the file)'); }
  if (Object.keys(lens).length && typeof lensState !== 'undefined') {
    if (typeof lensSet === 'function') lensSet(lens); else { Object.assign(lensState, lens); document.dispatchEvent(new Event('lens-changed')); }
  }
  if (md.orient) {
    applyOrientation(md.orient);
    const o = md.orient; out.push([o.tilt && `tilt ${fmt(o.tilt.v, 1)}°`, o.roll && `roll ${fmt(o.roll.v, 1)}°`, o.yaw && `yaw ${fmt(o.yaw.v, 1)}°`].filter(Boolean).join(' '));
  }
  if (md.fps > 0 && md.fps < 1000) { tl.fps = +md.fps.toFixed(3); $('tl-fps').value = tl.fps; tlSave(); out.push(`${fmt(tl.fps, 3)} fps`); }
  refreshAll();
  return out;
}
function camRenderMeta(applied) {
  const md = st.plateMeta, show = !!md && !st.plate.empty;
  $('orient-row').hidden = !show; if (!show) return;
  const o = md.orient || {}, esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  $('meta-from').textContent = $('meta-from').title = md.file || '';
  $('orient-txt').textContent = [o.tilt && `tilt ${fmt(o.tilt.v, 2)}°`, o.roll && `roll ${fmt(o.roll.v, 2)}°`, o.yaw && `yaw ${fmt(o.yaw.v, 2)}°`].filter(Boolean).join(' · ');
  const rec = md.rw > 0 ? `${md.rw} × ${md.rh}` + (md.pitch > 0 ? ` · ${+md.pitch.toFixed(4)} µm` : '') : '';
  const lens = md.focal > 0 ? `${+md.focal.toFixed(2)} mm` + (md.lens ? ' · ' + md.lens : '') : md.lens;
  const ft = [md.focusM > 0 && `${fmt(md.focusM, 2)} m`, md.tStop > 0 ? `T${+md.tStop.toFixed(2)}` : 'no T-stop'].filter(Boolean).join(' · ');
  const tr = md.orient ? [o.tilt && `${fmt(o.tilt.v, 1)}°`, o.roll && `${fmt(o.roll.v, 1)}°`].filter(Boolean).join(' · ') + (o.yaw ? ` · yaw ${fmt(o.yaw.v, 1)}°` : '') : '';
  const sh = md.shutter > 0 ? `1/${+(1 / md.shutter).toFixed(1)} s` + (md.fps > 0 ? ` · ${Math.round(md.shutter * md.fps * 360)}° at ${+md.fps.toFixed(3)} fps` : '') : '';
  const rows = [['Camera', md.camera], ['Recorded', rec], ['Lens', lens], ['Focus · T-stop', md.has ? ft : ''], ['Tilt · roll', tr], ['Shutter', sh]];
  $('meta-file').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd title="${esc(v || '')}">${esc(v || '–')}</dd>`).join('');
  $('orient-auto-row').hidden = !md.has;
  const m = $('meta-msg');
  if (applied && md.has) { m.hidden = false; m.className = applied.length ? 'msg ok' : 'msg'; m.textContent = applied.length ? 'From file metadata: ' + applied.join(', ') + '.' : 'Nothing to apply.'; }
  else if (!md.has) { m.hidden = false; m.className = 'msg'; m.textContent = 'No camera or lens in the metadata: load a Reference EXR of the same plate, or set them by hand.'; }
  else m.hidden = true;
  // fuentes que no coinciden y controles que no cierran (MetaProfiles.read y camApplyPlateMeta)
  const W = md.warnings || [];
  $('meta-warn').hidden = !W.length;
  $('meta-warn').innerHTML = W.map(w => `<div>${esc(w.text[0].toUpperCase() + w.text.slice(1))}.</div>`).join('');
  $('meta-src').innerHTML = camSourceRows(md, esc);
  $('meta-src-box').hidden = !$('meta-src').innerHTML;
}
// «Read from the file»: el valor usado de cada campo, la clave de donde salió y las otras fuentes del archivo
const CAM_SRC_FIELDS = [
  ['camera', 'Camera'], ['rasterW', 'Recorded'], ['filmW', 'Film back'], ['focalMm', 'Focal'], ['focusM', 'Focus'],
  ['tStop', 'T-stop'], ['fStop', 'f-stop'], ['squeeze', 'Squeeze'], ['tiltDeg', 'Tilt'], ['rollDeg', 'Roll'],
  ['nearM', 'Near focus'], ['farM', 'Far focus'], ['hfovDeg', 'Lens h. FOV'], ['fps', 'Frame rate'], ['shutterS', 'Shutter'], ['clip', 'Clip'],
];
function camSourceVal(f, v, md) {
  if (typeof v !== 'number') return String(v);
  switch (f) {
    case 'rasterW': return `${v} × ${md.sources.rasterH ? md.sources.rasterH.v : '?'}`;
    case 'filmW': return `${fmt(v, 2)} × ${md.sources.filmH ? fmt(md.sources.filmH.v, 2) : '?'} mm`;
    case 'focalMm': return `${fmt(v, 2)} mm`;
    case 'focusM': case 'nearM': case 'farM': return `${fmt(v, 2)} m`;
    case 'tStop': return `T${+v.toFixed(2)}`;
    case 'fStop': return `f/${+v.toFixed(2)}`;
    case 'tiltDeg': case 'rollDeg': case 'hfovDeg': return `${fmt(v, 2)}°`;
    case 'shutterS': return v > 0 && v < 1 ? `1/${+(1 / v).toFixed(1)} s` : `${fmt(v, 3)} s`;
    case 'fps': return `${+v.toFixed(3)} fps`;
    default: return `${+v.toFixed(3)}`;
  }
}
function camSourceRows(md, esc) {
  if (!md.sources) return '';
  const CONF = { declared: '', derived: ' · derived', guessed: ' · guessed from the attribute name' };
  return CAM_SRC_FIELDS.filter(([f]) => md.sources[f]).map(([f, label]) => {
    const c = md.sources[f], others = (md.cands[f] || []).slice(1);
    const alt = others.map(o => `<span class="src alt">also ${esc(camSourceVal(f, o.v, md))} · ${esc(o.key)}</span>`).join('');
    return `<dt>${label}</dt><dd><b>${esc(camSourceVal(f, c.v, md))}</b><span class="src">${esc(c.key || '')}${CONF[c.conf] || ''}</span>${alt}</dd>`;
  }).join('');
}
function camClearMeta() { st.camChoose = null; st.metaAttrs = null; st.plateMeta = null; st.metaOrient = null; $('orient-row').hidden = true; $('meta-msg').hidden = true; if (typeof vplMetaRefRow === 'function') vplMetaRefRow(false); }
// Metadata de un EXR (header de EXR.parseHeader o el ArrayBuffer del archivo), aunque el plate visible sea
// otro (un video). Con "Use on open" la aplica. Va después de setPlate, que la borra.
function camApplyExrMetadata(header, name) {
  const h = header instanceof ArrayBuffer ? EXR.parseHeader(header) : header;
  const md = camReadMeta(h); md.file = name || (exrState && exrState.h === h ? exrState.name : '');
  st.metaAttrs = { file: md.file, list: h.attrs.map(x => ({ k: x.name, v: String(EXR.fmtVal(x)) })) }; // hook import-view: los datos leídos, para asignarlos a mano
  st.plateMeta = md;
  st.metaCamera = md.camera || null; st.metaFocal = md.focal > 0 ? md.focal : null; st.metaOrient = md.orient || null;
  const applied = $('orient-auto').checked && !st.pendingProject ? camApplyPlateMeta() : null;
  camRenderMeta(applied);
  // lista completa de atributos (clic en un número: usarlo como focal)
  const first = ['cameraMake', 'cameraModel', 'lensMake', 'lensModel', 'nominalFocalLength', 'pinholeFocalLength', 'effectiveFocalLength', 'focus', 'aperture', 'tStop', 'sensorAcquisitionRectangle', 'sensorPhotositePitch', 'timeCode', 'framesPerSecond', 'chromaticities', 'acesImageContainerFlag', 'displayWindow', 'dataWindow', 'pixelAspectRatio', 'compression', 'channels'];
  const sorted = [...h.attrs].sort((a, b) => { const ia = first.indexOf(a.name), ib = first.indexOf(b.name); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.name.localeCompare(b.name); });
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  $('meta-kv').innerHTML = sorted.map(a => {
    const n = typeof a.value === 'number' ? a.value : typeof a.value === 'string' ? parseFloat(a.value) : NaN;
    const pick = Number.isFinite(n) && n >= 1 && n < 2000;
    return `<dt>${esc(a.name)}</dt><dd${pick ? ` class="pickf" data-f="${n}" title="Use ${n} mm as the focal length"` : ''}>${esc(EXR.fmtVal(a)).slice(0, 300)}</dd>`;
  }).join('') + '<dt></dt><dd class="note">Click a numeric value to use it as the focal length.</dd>';
  $('meta-sum').textContent = `All attributes (${h.attrs.length})`;
  refreshAll();
  return md;
}
function showExrMeta(h) { return camApplyExrMetadata(h); }
$('cs').onchange = () => { if (exrState) { exrState.cs = $('cs').value; exrState.why = 'set by hand'; } redrawExr(); };
$('view').value = lsGet('view', 'aces709');
if (!$('view').value) $('view').value = 'aces709';
$('view').onchange = () => { lsSet('view', $('view').value); redrawExr(); };
$('ev').oninput = () => { const v = +$('ev').value; $('ev-v').textContent = (v >= 0 ? '+' : '') + v.toFixed(2) + ' EV'; };
$('ev').onchange = redrawExr;

