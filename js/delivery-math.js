// delivery-math: el reencuadre de entrega de la toma (sin DOM ni THREE: lo usan la página y los tests de Node).
// En el comp el plate muchas veces no va 1:1: se lo lleva a otro formato y se lo agranda, gira o corre. Acá se
// modela como en Nuke: Reformat al formato del comp (resize none, centrado) y después un Transform con
// translate (x, y hacia ARRIBA, px del comp), rotate (grados, positivo = antihorario, como Nuke), scale y el
// centro en el medio del formato del comp. Los px del plate van con y hacia abajo (como en toda la app).
// d = { scale, rotDeg, tx, ty, outW, outH } (outW / outH 0: el formato del plate).
var DeliveryMath = (() => {
  const DEG = Math.PI / 180;
  const DEF = { on: false, scale: 1, rotDeg: 0, tx: 0, ty: 0, outW: 0, outH: 0, units: 'plate' };
  const fmtOf = (d, W, H) => ({ W: d && d.outW > 0 ? d.outW : W, H: d && d.outH > 0 ? d.outH : H });
  const sc = (d) => (d && d.scale > 0 ? d.scale : 1);
  // El Reformat de Nuke (resize none, center) corre el plate un número ENTERO de px: (comp - plate) / 2 truncado
  // hacia cero, medido desde abajo a la izquierda (verificado en Nuke 15.1). Con una diferencia impar el centro
  // del plate queda medio px antes del centro del comp: off = lo que se aparta del centrado exacto (0 o ±0.5).
  const off = (o, W, H) => [Math.trunc((o.W - W) / 2) - (o.W - W) / 2, Math.trunc((o.H - H) / 2) - (o.H - H) / 2];
  // px del plate -> px del comp
  function toComp(d, W, H, p) {
    const o = fmtOf(d, W, H), s = sc(d), a = (d.rotDeg || 0) * DEG, c = Math.cos(a), n = Math.sin(a), [ex, ey] = off(o, W, H);
    const x = p[0] - W / 2 + ex, y = H / 2 - p[1] + ey; // desde el centro del comp, y arriba
    const X = s * (c * x - n * y) + (d.tx || 0), Y = s * (n * x + c * y) + (d.ty || 0);
    return [o.W / 2 + X, o.H / 2 - Y];
  }
  // px del comp -> px del plate
  function toPlate(d, W, H, q) {
    const o = fmtOf(d, W, H), s = sc(d), a = (d.rotDeg || 0) * DEG, c = Math.cos(a), n = Math.sin(a), [ex, ey] = off(o, W, H);
    const X = (q[0] - o.W / 2 - (d.tx || 0)) / s, Y = (o.H / 2 - q[1] - (d.ty || 0)) / s;
    return [W / 2 + (c * X + n * Y) - ex, H / 2 - (-n * X + c * Y) + ey];
  }
  // sin cambio: mismo formato, escala 1, sin giro ni corrimiento
  const isIdentity = (d, W, H) => { const o = fmtOf(d, W, H); return !d || (o.W === W && o.H === H && Math.abs(sc(d) - 1) < 1e-9 && !d.rotDeg && !d.tx && !d.ty); };
  // un tamaño (diámetro de desenfoque, desplazamiento) de px del plate a px del comp: la escala, el giro no lo cambia
  const size = (d, v) => v * sc(d);
  // la recta que pasa por dos px del plate, llevada al comp: su y en cada x de xs (null si queda vertical)
  function yAt(d, W, H, seg, xs) {
    const a = toComp(d, W, H, [seg[0], seg[1]]), b = toComp(d, W, H, [seg[2], seg[3]]), dx = b[0] - a[0];
    return xs.map(x => Math.abs(dx) < 1e-9 ? null : a[1] + (b[1] - a[1]) * (x - a[0]) / dx);
  }
  // las cuatro esquinas del formato del comp en px del plate (arriba-izq, arriba-der, abajo-der, abajo-izq): la guía
  function frameInPlate(d, W, H) { const o = fmtOf(d, W, H); return [[0, 0], [o.W, 0], [o.W, o.H], [0, o.H]].map(q => toPlate(d, W, H, q)); }
  // Reformat + Transform para pegar en Nuke después del Merge del fondo bajo el plate (o bajo el Read del plate)
  function nukeText(d, W, H, label) {
    const o = fmtOf(d, W, H), n = (v) => String(+(+v).toFixed(4));
    const lab = String(label || '').replace(/[\\"[\]${}]/g, '_').replace(/\n/g, '\\n');
    return 'set cut_paste_input [stack 0]\nversion 14.0 v1\npush $cut_paste_input\nReformat {\n' +
      ` format "${o.W} ${o.H} 0 0 ${o.W} ${o.H} 1 BackplateLab_comp_${o.W}x${o.H}"\n resize none\n center true\n black_outside true\n name Reformat_Delivery\n selected true\n}\n` +
      `Transform {\n translate {${n(d.tx || 0)} ${n(d.ty || 0)}}\n rotate ${n(d.rotDeg || 0)}\n scale ${n(sc(d))}\n center {${n(o.W / 2)} ${n(o.H / 2)}}\n black_outside true\n name Transform_Delivery\n` +
      (lab ? ` label "${lab}"\n` : '') + ' selected true\n}\n';
  }
  return { DEF, fmtOf, toComp, toPlate, isIdentity, size, yAt, frameInPlate, nukeText };
})();
globalThis.DeliveryMath = DeliveryMath; // en Node (tests) el archivo se importa como módulo
