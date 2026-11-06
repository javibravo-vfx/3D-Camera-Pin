// scene-worker: Auto from windows fuera del hilo de la UI (bordes de la máscara + punto de fuga).
importScripts('scene-math.js');
onmessage = (e) => {
  const { mask, W, H, horizon, prior } = e.data;
  postMessage(SceneMath.findAxisVanishingPoint(SceneMath.maskEdgeSegments(mask), W, H, horizon, prior));
};
