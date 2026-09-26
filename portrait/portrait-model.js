// Portrait AI V7
// - MediaPipe Selfie Segmenter for the subject mask.
// - Depth Anything V2 Small (when available) for monocular relative depth.
// - A deterministic local fallback keeps the portrait effect usable when the
//   depth model cannot be downloaded or initialized.
// - All actual image processing happens in the browser; uploaded photos are
//   never sent to a server by this module.

let segmenter = null;
let segmenterLoading = null;
let depthEstimator = null;
let depthLoading = null;

const SEGMENTATION_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const MEDIAPIPE_CDNS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs',
  'https://unpkg.com/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs'
];
const MEDIAPIPE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

// V2 is the preferred model. V1 small is a smaller fallback. The q4/q4f16
// variants are substantially lighter for phones than the full model.
const DEPTH_MODELS = [
  { id: 'onnx-community/depth-anything-v2-small', dtype: 'q4f16' },
  { id: 'onnx-community/depth-anything-v2-small', dtype: 'q4' },
  { id: 'Xenova/depth-anything-small-hf', dtype: 'q8' }
];

function clamp(v, a = 0, b = 1) {
  return Math.max(a, Math.min(b, v));
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
}

export async function loadPortraitAI(report) {
  if (segmenter) return segmenter;
  if (segmenterLoading) return segmenterLoading;

  segmenterLoading = (async () => {
    let vision = null;
    let lastError = null;

    for (const url of MEDIAPIPE_CDNS) {
      try {
        report('Loading MediaPipe runtime…', null, url);
        vision = await import(url);
        report('MediaPipe runtime loaded ✓', true);
        break;
      } catch (e) {
        lastError = e;
        report('MediaPipe runtime attempt failed', false, e?.message || String(e));
      }
    }

    if (!vision) throw lastError || new Error('MediaPipe runtime could not be loaded');

    const { FilesetResolver, ImageSegmenter } = vision;
    report('Loading MediaPipe WASM…', null, MEDIAPIPE_WASM);
    const fs = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    report('MediaPipe WASM loaded ✓', true);

    report('Loading person segmentation model…', null, SEGMENTATION_MODEL);
    const response = await fetch(SEGMENTATION_MODEL, { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) throw new Error(`Segmentation model HTTP ${response.status}`);
    report('Segmentation model reachable ✓', true);

    const common = {
      baseOptions: { modelAssetPath: SEGMENTATION_MODEL },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: true
    };

    try {
      report('Initializing CPU ImageSegmenter…');
      segmenter = await ImageSegmenter.createFromOptions(fs, {
        ...common,
        baseOptions: { modelAssetPath: SEGMENTATION_MODEL, delegate: 'CPU' }
      });
      report('CPU ImageSegmenter ready ✓', true);
    } catch (cpuError) {
      report('CPU ImageSegmenter failed', false, cpuError?.message || String(cpuError));
      report('Trying GPU ImageSegmenter…');
      segmenter = await ImageSegmenter.createFromOptions(fs, {
        ...common,
        baseOptions: { modelAssetPath: SEGMENTATION_MODEL, delegate: 'GPU' }
      });
      report('GPU ImageSegmenter ready ✓', true);
    }

    return segmenter;
  })();

  try {
    return await segmenterLoading;
  } catch (e) {
    segmenterLoading = null;
    throw e;
  }
}

export async function loadDepthAI(report) {
  if (depthEstimator) return depthEstimator;
  if (depthLoading) return depthLoading;

  depthLoading = (async () => {
    report('Loading Depth AI runtime…', null, TRANSFORMERS_URL);
    const mod = await import(TRANSFORMERS_URL);
    const { pipeline, env } = mod;

    // Explicitly keep the browser cache enabled. Once a model is cached,
    // subsequent edits do not download the weights again.
    if (env) {
      env.allowRemoteModels = true;
      env.useBrowserCache = true;
      env.useWasmCache = true;
    }
    report('Depth AI runtime loaded ✓', true);

    let lastError = null;
    for (const candidate of DEPTH_MODELS) {
      try {
        report('Loading depth model…', null, `${candidate.id} (${candidate.dtype})`);
        const options = {
          device: 'wasm',
          dtype: candidate.dtype
        };
        depthEstimator = await pipeline('depth-estimation', candidate.id, options);
        report('Depth AI ready ✓', true, `${candidate.id} / ${candidate.dtype}`);
        return depthEstimator;
      } catch (e) {
        lastError = e;
        report('Depth model unavailable — continuing safely', false, `${candidate.id}: ${e?.message || String(e)}`);
      }
    }

    throw lastError || new Error('No browser-compatible depth model could be loaded');
  })();

  try {
    return await depthLoading;
  } catch (e) {
    depthLoading = null;
    throw e;
  }
}

function confidenceMaskToCanvas(mask, edgeProtection) {
  const values = mask.getAsFloat32Array();
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  const image = x.createImageData(mask.width, mask.height);

  // High edge protection deliberately keeps the uncertain fringe instead of
  // hard-thresholding hair/glasses/handheld objects away.
  const threshold = 0.48 - edgeProtection * 0.0022;
  const softness = 0.16 + edgeProtection * 0.0012;

  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    const a = smoothstep(threshold - softness, threshold + softness, values[i]);
    image.data[p] = 255;
    image.data[p + 1] = 255;
    image.data[p + 2] = 255;
    image.data[p + 3] = Math.round(a * 255);
  }

  x.putImageData(image, 0, 0);
  return c;
}

function categoryMaskToCanvas(mask) {
  const values = mask.getAsUint8Array();
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const x = c.getContext('2d');
  const image = x.createImageData(mask.width, mask.height);
  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    const a = values[i] > 0 ? 255 : 0;
    image.data[p] = image.data[p + 1] = image.data[p + 2] = 255;
    image.data[p + 3] = a;
  }
  x.putImageData(image, 0, 0);
  return c;
}

function makeMask(source, edgeProtection) {
  const result = segmenter.segment(source);
  if (result.confidenceMasks?.length) return confidenceMaskToCanvas(result.confidenceMasks[0], edgeProtection);
  if (result.categoryMask) return categoryMaskToCanvas(result.categoryMask);
  throw new Error('No segmentation mask returned');
}

function featherMask(mask, edgeProtection) {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const x = c.getContext('2d');
  const radius = 0.45 + (100 - edgeProtection) * 0.012;
  x.filter = `blur(${radius}px)`;
  x.drawImage(mask, 0, 0);
  x.filter = 'none';
  return c;
}

function blur(source, radius) {
  if (radius <= 0.01) return source;
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const x = c.getContext('2d');
  x.filter = `blur(${radius.toFixed(2)}px)`;
  x.drawImage(source, 0, 0);
  x.filter = 'none';
  return c;
}

async function getDepthMap(source, report) {
  const estimator = await loadDepthAI(report);
  // Transformers.js explicitly supports HTMLCanvasElement as ImageInput.
  const output = await estimator(source);
  const tensor = output?.predicted_depth;
  if (!tensor?.data || !tensor?.dims) throw new Error('Depth AI returned no predicted depth map');

  const dims = tensor.dims;
  const h = dims[dims.length - 2];
  const w = dims[dims.length - 1];
  const values = tensor.data;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const z = Number(values[i]);
    if (Number.isFinite(z)) {
      min = Math.min(min, z);
      max = Math.max(max, z);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new Error('Depth AI returned an invalid depth range');
  }

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  const image = x.createImageData(w, h);
  const span = max - min;
  for (let i = 0, p = 0; i < values.length; i++, p += 4) {
    const near = clamp((Number(values[i]) - min) / span);
    const g = Math.round(near * 255);
    image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
    image.data[p + 3] = 255;
  }
  x.putImageData(image, 0, 0);
  return c;
}

function makeHeuristicDepth(source, mask) {
  // Safe fallback: this is not AI depth. It uses the subject silhouette and
  // image geometry to create a restrained near/far gradient, avoiding the
  // harsh cut-out look when a remote depth model is unavailable.
  const W = source.width;
  const H = source.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  const image = x.createImageData(W, H);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const mx = maskCanvas.getContext('2d', { willReadFrequently: true });
  mx.drawImage(mask, 0, 0, W, H);
  const mp = mx.getImageData(0, 0, W, H).data;

  // Estimate subject bounds from the mask. The lower part of a portrait is
  // generally nearer than the distant upper background, but the effect is
  // deliberately weak and is never allowed to create a hard depth boundary.
  let minY = H, maxY = -1;
  for (let y = 0; y < H; y += 3) {
    for (let xPos = 0; xPos < W; xPos += 3) {
      if (mp[(y * W + xPos) * 4 + 3] > 150) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxY < 0) { minY = H * 0.2; maxY = H * 0.8; }
  const subjectHeight = Math.max(1, maxY - minY);

  for (let y = 0; y < H; y++) {
    const verticalFar = clamp((y - minY) / subjectHeight);
    const upperFar = clamp((minY - y) / H);
    const near = clamp(0.72 - upperFar * 0.55 + verticalFar * 0.18);
    const g = Math.round(near * 255);
    for (let xPos = 0; xPos < W; xPos++) {
      const p = (y * W + xPos) * 4;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = g;
      image.data[p + 3] = 255;
    }
  }
  x.putImageData(image, 0, 0);
  return c;
}

function buildDepthBlur(source, depthMap, subjectMask, strength) {
  const W = source.width;
  const H = source.height;
  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = W;
  depthCanvas.height = H;
  const dx = depthCanvas.getContext('2d', { willReadFrequently: true });
  dx.drawImage(depthMap, 0, 0, W, H);
  const depthPixels = dx.getImageData(0, 0, W, H).data;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const mx = maskCanvas.getContext('2d', { willReadFrequently: true });
  mx.drawImage(subjectMask, 0, 0, W, H);
  const maskPixels = mx.getImageData(0, 0, W, H).data;

  // Five levels give a smooth transition without expensive per-pixel blur.
  const maxRadius = Math.min(26, 2 + strength * 0.24);
  const radii = [0, maxRadius * 0.16, maxRadius * 0.34, maxRadius * 0.62, maxRadius];
  const layers = radii.map(r => blur(source, r));

  const output = document.createElement('canvas');
  output.width = W;
  output.height = H;
  const out = output.getContext('2d');
  out.drawImage(layers[layers.length - 1], 0, 0); // far background first

  // Overlay progressively sharper layers according to relative depth.
  // Depth Anything's normalized high values are treated as nearer.
  for (let layer = layers.length - 2; layer >= 0; layer--) {
    const lo = layer / (layers.length - 1);
    const hi = (layer + 1) / (layers.length - 1);
    const band = document.createElement('canvas');
    band.width = W;
    band.height = H;
    const bx = band.getContext('2d');
    const bi = bx.createImageData(W, H);

    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const subjectA = maskPixels[p + 3] / 255;
      const near = depthPixels[p] / 255;
      const far = 1 - near;
      const center = (lo + hi) * 0.5;
      const half = (hi - lo) * 0.5;
      const weight = 1 - smoothstep(center - half, center + half, far);
      // Never let background pixels overwrite the subject. The final subject
      // composite below also provides a second line of defence.
      const alpha = Math.round(weight * (1 - subjectA) * 255);
      bi.data[p] = bi.data[p + 1] = bi.data[p + 2] = 255;
      bi.data[p + 3] = alpha;
    }
    bx.putImageData(bi, 0, 0);
    out.globalCompositeOperation = 'source-over';
    const maskedLayer = document.createElement('canvas');
    maskedLayer.width = W;
    maskedLayer.height = H;
    const lx = maskedLayer.getContext('2d');
    lx.drawImage(layers[layer], 0, 0);
    lx.globalCompositeOperation = 'destination-in';
    lx.drawImage(band, 0, 0);
    out.drawImage(maskedLayer, 0, 0);
  }

  out.globalCompositeOperation = 'source-over';
  return output;
}

function buildSimpleBlur(source, subjectMask, strength) {
  const bg = blur(source, Math.min(18, 1.5 + strength * 0.16));
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const o = out.getContext('2d');
  o.drawImage(bg, 0, 0);
  const bgMask = document.createElement('canvas');
  bgMask.width = source.width;
  bgMask.height = source.height;
  const b = bgMask.getContext('2d');
  b.fillStyle = '#fff';
  b.fillRect(0, 0, out.width, out.height);
  b.globalCompositeOperation = 'destination-out';
  b.drawImage(subjectMask, 0, 0, out.width, out.height);
  const layer = document.createElement('canvas');
  layer.width = out.width;
  layer.height = out.height;
  const l = layer.getContext('2d');
  l.drawImage(bg, 0, 0);
  l.globalCompositeOperation = 'destination-in';
  l.drawImage(bgMask, 0, 0);
  o.clearRect(0, 0, out.width, out.height);
  o.drawImage(layer, 0, 0);
  return out;
}

export async function applyPortraitAI(source, depthStrength, edgeProtection, progress, opts = {}) {
  progress('Running person segmentation…');
  const rawMask = makeMask(source, edgeProtection);
  progress('Protecting fine hair, glasses and nearby edges…');
  const subjectMask = featherMask(rawMask, edgeProtection);

  let depthMap = null;
  let depthMode = 'fallback';

  if (opts.useDepth !== false) {
    progress('Estimating natural distance…');
    try {
      depthMap = await getDepthMap(source, progress);
      depthMode = 'ai';
      progress('Building natural distance-based blur…');
    } catch (e) {
      progress('Depth AI unavailable — using safe local distance fallback…');
      if (typeof opts.onDepthFallback === 'function') {
        opts.onDepthFallback(e);
      }
      depthMap = makeHeuristicDepth(source, subjectMask);
      depthMode = 'fallback';
    }
  }

  let background;
  if (depthMap) {
    background = buildDepthBlur(source, depthMap, subjectMask, depthStrength);
  } else {
    background = buildSimpleBlur(source, subjectMask, depthStrength);
  }

  // Final subject composite: the original image always wins inside the mask.
  // This is the key protection against halos around hair, glasses and objects
  // touching the face/body.
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const o = out.getContext('2d');
  o.drawImage(background, 0, 0);

  const subject = document.createElement('canvas');
  subject.width = source.width;
  subject.height = source.height;
  const s = subject.getContext('2d');
  s.drawImage(source, 0, 0);
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(subjectMask, 0, 0, source.width, source.height);
  o.drawImage(subject, 0, 0);

  return { canvas: out, mask: subjectMask, depthMap, depthMode };
}
