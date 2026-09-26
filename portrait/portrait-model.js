let segmenter = null, loading = null;
let depthEstimator = null, depthLoading = null;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const CDNS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs',
  'https://unpkg.com/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs'
];
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

export async function loadPortraitAI(report) {
  if (segmenter) return segmenter;
  if (loading) return loading;
  loading = (async () => {
    let vision = null, last = null;
    for (const url of CDNS) {
      try {
        report('Loading MediaPipe runtime…', null, url);
        vision = await import(url);
        report('MediaPipe runtime loaded ✓', true);
        break;
      } catch (e) {
        last = e;
        report('Runtime attempt failed', false, e?.message || String(e));
      }
    }
    if (!vision) throw last || new Error('No runtime CDN could be loaded');

    const { FilesetResolver, ImageSegmenter } = vision;
    report('Loading MediaPipe WASM…', null, WASM);
    const fs = await FilesetResolver.forVisionTasks(WASM);
    report('MediaPipe WASM loaded ✓', true);
    report('Loading person segmentation model…', null, MODEL);
    const response = await fetch(MODEL, { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
    report('Segmentation model reachable ✓', true, `${Math.round((+response.headers.get('content-length') || 0) / 1024)} KB reported`);

    const options = { baseOptions: { modelAssetPath: MODEL }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: true };
    try {
      report('Initializing CPU ImageSegmenter…');
      segmenter = await ImageSegmenter.createFromOptions(fs, { ...options, baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' } });
      report('CPU ImageSegmenter ready ✓', true);
    } catch (cpuErr) {
      report('CPU ImageSegmenter failed', false, cpuErr?.message || String(cpuErr));
      report('Trying GPU ImageSegmenter…');
      segmenter = await ImageSegmenter.createFromOptions(fs, { ...options, baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' } });
      report('GPU ImageSegmenter ready ✓', true);
    }
    return segmenter;
  })();
  try { return await loading; } catch (e) { loading = null; throw e; }
}

export async function loadDepthAI(report) {
  if (depthEstimator) return depthEstimator;
  if (depthLoading) return depthLoading;
  depthLoading = (async () => {
    report('Loading Depth AI runtime…', null, TRANSFORMERS);
    const mod = await import(TRANSFORMERS);
    report('Depth AI runtime loaded ✓', true);
    report('Loading Depth Anything V2 Small…', null, DEPTH_MODEL);
    depthEstimator = await mod.pipeline('depth-estimation', DEPTH_MODEL, { device: 'wasm', dtype: 'q8' });
    report('Depth AI ready ✓', true, 'Relative depth model cached in browser');
    return depthEstimator;
  })();
  try { return await depthLoading; } catch (e) { depthLoading = null; throw e; }
}

function maskFromConfidence(m, edgeProtection) {
  const v = m.getAsFloat32Array();
  const c = document.createElement('canvas'); c.width = m.width; c.height = m.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  const im = x.createImageData(m.width, m.height);
  const t = Math.max(0.16, 0.50 - edgeProtection * 0.0024);
  for (let i = 0, p = 0; i < v.length; i++, p += 4) {
    const q = Math.max(0, Math.min(1, (v[i] - t) / Math.max(0.10, 1 - t)));
    im.data[p] = im.data[p + 1] = im.data[p + 2] = 255;
    im.data[p + 3] = Math.round(q * 255);
  }
  x.putImageData(im, 0, 0); return c;
}
function maskFromCategory(m) {
  const v = m.getAsUint8Array();
  const c = document.createElement('canvas'); c.width = m.width; c.height = m.height;
  const x = c.getContext('2d'); const im = x.createImageData(m.width, m.height);
  for (let i = 0, p = 0; i < v.length; i++, p += 4) { const a = v[i] > 0 ? 255 : 0; im.data[p] = im.data[p + 1] = im.data[p + 2] = 255; im.data[p + 3] = a; }
  x.putImageData(im, 0, 0); return c;
}
function makeMask(source, edgeProtection) {
  const r = segmenter.segment(source);
  if (r.confidenceMasks?.length) return maskFromConfidence(r.confidenceMasks[0], edgeProtection);
  if (r.categoryMask) return maskFromCategory(r.categoryMask);
  throw Error('No confidence or category mask returned');
}

function blur(s, r) {
  const c = document.createElement('canvas'); c.width = s.width; c.height = s.height;
  const x = c.getContext('2d'); x.filter = `blur(${r}px)`; x.drawImage(s, 0, 0); x.filter = 'none'; return c;
}
function soft(m, e) {
  const c = document.createElement('canvas'); c.width = m.width; c.height = m.height;
  const x = c.getContext('2d'); x.filter = `blur(${Math.max(.3, (100 - e) * .018 + .3)}px)`; x.drawImage(m, 0, 0); x.filter = 'none'; return c;
}

async function getDepthMap(source, report) {
  const estimator = await loadDepthAI(report);
  const output = await estimator(source);
  const t = output?.predicted_depth;
  if (!t?.data || !t?.dims) throw new Error('Depth AI returned no predicted depth map');
  const dims = t.dims;
  const h = dims[dims.length - 2], w = dims[dims.length - 1];
  const vals = t.data;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < vals.length; i++) { const z = vals[i]; if (z < min) min = z; if (z > max) max = z; }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); const im = x.createImageData(w, h);
  const span = Math.max(1e-6, max - min);
  for (let i = 0, p = 0; i < vals.length; i++, p += 4) {
    const near = Math.max(0, Math.min(1, (vals[i] - min) / span));
    const g = Math.round(near * 255); im.data[p] = im.data[p + 1] = im.data[p + 2] = g; im.data[p + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return c;
}

function makeDepthBlurLayers(source, depthMap, strength) {
  // Depth Anything gives relative depth, not meters. We use it only to create a smooth
  // foreground-to-background blur falloff, which is what a portrait camera effect needs.
  const W = source.width, H = source.height;
  const d = document.createElement('canvas'); d.width = W; d.height = H;
  const dx = d.getContext('2d', { willReadFrequently: true }); dx.drawImage(depthMap, 0, 0, W, H);
  const pix = dx.getImageData(0, 0, W, H).data;
  const map = new Float32Array(W * H);
  for (let i = 0; i < map.length; i++) map[i] = pix[i * 4] / 255;

  const maxR = Math.min(22, 2 + strength * 0.22);
  const layers = [0, .30, .58, .82, 1];
  const canvases = layers.map(f => blur(source, maxR * f));
  return { map, canvases, W, H };
}

function compositeDepth(outCtx, depth, mask, layers) {
  const { map, canvases, W, H } = layers;
  // Start with the least blurred layer. Farther pixels receive progressively stronger blur.
  const base = canvases[0]; outCtx.drawImage(base, 0, 0);
  const thresholds = [0.20, 0.40, 0.60, 0.78];
  for (let band = 1; band < canvases.length; band++) {
    const low = band === 1 ? thresholds[0] : thresholds[band - 1];
    const high = band < thresholds.length ? thresholds[band] : 1.0;
    const bandMask = document.createElement('canvas'); bandMask.width = W; bandMask.height = H;
    const bx = bandMask.getContext('2d'); const bi = bx.createImageData(W, H);
    const mp = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    for (let i = 0, p = 0; i < map.length; i++, p += 4) {
      // Depth values near 1 are closer. Blur should increase toward lower values.
      const far = 1 - map[i];
      const a = mp[p + 3] / 255;
      let q = 0;
      if (far > low && far <= high) q = Math.min(1, (far - low) / Math.max(0.05, high - low));
      bi.data[p] = bi.data[p + 1] = bi.data[p + 2] = 255;
      bi.data[p + 3] = Math.round(q * (1 - a) * 255);
    }
    bx.putImageData(bi, 0, 0);
    outCtx.globalCompositeOperation = 'source-over';
    outCtx.drawImage(canvases[band], 0, 0);
    outCtx.globalCompositeOperation = 'destination-out';
    outCtx.drawImage(bandMask, 0, 0);
    outCtx.globalCompositeOperation = 'source-over';
  }
  // The layered approach above is intentionally conservative; final subject composite is done by caller.
}

export async function applyPortraitAI(source, depth, edge, progress, opts = {}) {
  progress('Running person segmentation…');
  const raw = makeMask(source, edge);
  progress('Refining subject edge…');
  const mask = soft(raw, edge);

  let depthMap = null;
  if (opts.useDepth !== false) {
    progress('Estimating relative distance with Depth AI…');
    depthMap = await getDepthMap(source, progress);
    progress('Building natural distance-based blur…');
  } else {
    progress('Creating gentle background blur…');
  }

  const out = document.createElement('canvas'); out.width = source.width; out.height = source.height;
  const o = out.getContext('2d', { willReadFrequently: true });

  if (depthMap) {
    const layers = makeDepthBlurLayers(source, depthMap, depth);
    // Build a depth-weighted background directly with pixel alpha masks.
    const base = layers.canvases[0]; o.drawImage(base, 0, 0);
    const maskPx = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, source.width, source.height).data;
    const dCanvas = document.createElement('canvas'); dCanvas.width = source.width; dCanvas.height = source.height;
    const dc = dCanvas.getContext('2d', { willReadFrequently: true }); dc.drawImage(depthMap, 0, 0, source.width, source.height);
    const dp = dc.getImageData(0, 0, source.width, source.height).data;
    // Four smooth blur bands. The transition is gradual to avoid a cut-out look.
    for (let band = 1; band < layers.canvases.length; band++) {
      const lo = (band - 1) / layers.canvases.length;
      const hi = band / layers.canvases.length + 0.18;
      const bm = document.createElement('canvas'); bm.width = source.width; bm.height = source.height;
      const bx = bm.getContext('2d'); const bi = bx.createImageData(source.width, source.height);
      for (let i = 0, p = 0; i < dp.length; i += 4, p += 4) {
        const near = dp[i] / 255; const far = 1 - near;
        const subjectA = maskPx[p + 3] / 255;
        const w = Math.max(0, Math.min(1, (far - lo) / Math.max(0.12, hi - lo)));
        bi.data[p] = bi.data[p + 1] = bi.data[p + 2] = 255;
        bi.data[p + 3] = Math.round(w * (1 - subjectA) * 210);
      }
      bx.putImageData(bi, 0, 0);
      o.globalCompositeOperation = 'source-over';
      const tmp = document.createElement('canvas'); tmp.width = source.width; tmp.height = source.height;
      const tx = tmp.getContext('2d'); tx.drawImage(layers.canvases[band], 0, 0); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(bm, 0, 0); o.drawImage(tmp, 0, 0);
    }
  } else {
    const bg = blur(source, 1 + depth * 0.10); o.drawImage(bg, 0, 0);
  }

  const subject = document.createElement('canvas'); subject.width = source.width; subject.height = source.height;
  const s = subject.getContext('2d'); s.drawImage(source, 0, 0); s.globalCompositeOperation = 'destination-in'; s.drawImage(mask, 0, 0, source.width, source.height);
  o.drawImage(subject, 0, 0);
  return { canvas: out, mask, depthMap };
}
