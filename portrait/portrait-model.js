// Portrait AI V10
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
  // Keep the segmentation edge itself relatively tight. A separate expanded
  // protection mask is used later to stop blurred background pixels bleeding
  // back into hair/clothing edges.
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const x = c.getContext('2d');
  const radius = 0.25 + Math.max(0, 100 - edgeProtection) * 0.006;
  if (radius > 0.3) x.filter = `blur(${radius.toFixed(2)}px)`;
  x.drawImage(mask, 0, 0);
  x.filter = 'none';
  return c;
}

function maxFilterAlpha(alpha, W, H, radius) {
  if (radius <= 0) return alpha;
  // Fast separable max filter. This dilates the subject mask without the
  // expensive radius^2 operation of a naive morphological filter.
  const tmp = new Uint8ClampedArray(alpha.length);
  const out = new Uint8ClampedArray(alpha.length);
  const r = Math.round(radius);

  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let m = 0;
      const a = Math.max(0, x - r), b = Math.min(W - 1, x + r);
      for (let xx = a; xx <= b; xx++) m = Math.max(m, alpha[row + xx]);
      tmp[row + x] = m;
    }
  }
  for (let y = 0; y < H; y++) {
    const a = Math.max(0, y - r), b = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let yy = a; yy <= b; yy++) m = Math.max(m, tmp[yy * W + x]);
      out[y * W + x] = m;
    }
  }
  return out;
}

function buildEdgeSafeMasks(subjectMask, edgeProtection) {
  const W = subjectMask.width, H = subjectMask.height;
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const sx = src.getContext('2d', { willReadFrequently: true });
  sx.drawImage(subjectMask, 0, 0);
  const alpha = sx.getImageData(0, 0, W, H).data;
  const a = new Uint8ClampedArray(W * H);
  for (let i = 0, p = 0; i < a.length; i++, p += 4) a[i] = alpha[p + 3];

  // High protection reserves a slightly wider no-blur safety zone around the
  // subject. Hair and narrow objects therefore don't get a dark/bright halo.
  const radius = 2 + Math.round(edgeProtection * 0.055); // ~2–7 px
  const dilated = maxFilterAlpha(a, W, H, radius);

  const protect = document.createElement('canvas');
  protect.width = W; protect.height = H;
  const px = protect.getContext('2d');
  const pi = px.createImageData(W, H);
  for (let i = 0, p = 0; i < dilated.length; i++, p += 4) {
    pi.data[p] = pi.data[p + 1] = pi.data[p + 2] = 255;
    pi.data[p + 3] = dilated[i];
  }
  px.putImageData(pi, 0, 0);

  return { subjectMask, protectMask: protect };
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

function buildDepthBlur(source, depthMap, subjectMask, protectMask, strength) {
  const W = source.width, H = source.height;
  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = W; depthCanvas.height = H;
  const dx = depthCanvas.getContext('2d', { willReadFrequently: true });
  dx.drawImage(depthMap, 0, 0, W, H);
  const dp = dx.getImageData(0, 0, W, H).data;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W; maskCanvas.height = H;
  const mx = maskCanvas.getContext('2d', { willReadFrequently: true });
  mx.drawImage(protectMask || subjectMask, 0, 0, W, H);
  const mp = mx.getImageData(0, 0, W, H).data;

  // More natural than discrete cut-out bands: several blur layers are blended
  // continuously according to relative distance. Subject pixels are excluded.
  const maxRadius = Math.min(24, 1.5 + strength * 0.23);
  const radii = [0, maxRadius * 0.18, maxRadius * 0.38, maxRadius * 0.62, maxRadius];
  const layers = radii.map(r => blur(source, r));
  const layerPixels = layers.map(c => c.getContext('2d', {willReadFrequently:true}).getImageData(0,0,W,H).data);
  const sourcePixels = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;

  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const od = out.getContext('2d');
  const oi = od.createImageData(W, H);
  const d = oi.data;

  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const subjectA = mp[p + 3] / 255;
    const near = dp[p] / 255;
    const far = 1 - near;
    // Gentle near-side bias: objects farther away get progressively more blur.
    const t = clamp(far * 1.08);
    const pos = t * (layers.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(layers.length - 1, lo + 1);
    const w = pos - lo;
    const blurWeight = 1 - subjectA;
    const r0 = layerPixels[lo][p], g0 = layerPixels[lo][p+1], b0 = layerPixels[lo][p+2];
    const r1 = layerPixels[hi][p], g1 = layerPixels[hi][p+1], b1 = layerPixels[hi][p+2];
    const br = r0 + (r1-r0)*w;
    const bg = g0 + (g1-g0)*w;
    const bb = b0 + (b1-b0)*w;
    const sr = sourcePixels[p], sg = sourcePixels[p+1], sb = sourcePixels[p+2];
    // Keep the protected fringe close to the original image. This prevents
    // blur kernels from pulling bright shirts/skin into the background and
    // creating a visible halo around hair and clothing.
    d[p] = Math.round(sr * (1 - blurWeight) + br * blurWeight);
    d[p+1] = Math.round(sg * (1 - blurWeight) + bg * blurWeight);
    d[p+2] = Math.round(sb * (1 - blurWeight) + bb * blurWeight);
    d[p+3] = 255;
  }
  od.putImageData(oi, 0, 0);

  // The transparent subject area is filled later by the sharp subject layer.
  const final = document.createElement('canvas');
  final.width = W; final.height = H;
  const f = final.getContext('2d');
  f.drawImage(out, 0, 0);
  return final;
}

function enhancePhoto(source, amount) {
  // V10 global finishing pass. Color/tonal work is intentionally separated
  // from subject detail so the background does not become crunchy.
  if (!amount || amount <= 0) return source;

  const a = clamp(amount / 100);
  const W = source.width, H = source.height;
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const bx = base.getContext('2d', { willReadFrequently: true });
  bx.drawImage(source, 0, 0);
  const src = bx.getImageData(0, 0, W, H);
  const d = src.data;

  // Slightly stronger than V9, but still restrained enough for white clothes.
  const contrast = 1 + 0.095 * a;
  const exposure = 0.014 * a;
  const shadowLift = 0.095 * a;
  const highlightRoll = 0.125 * a;
  const saturationBoost = 0.045 * a;
  const vibrance = 0.17 * a;
  const warm = 1.15 * a;

  for (let p = 0; p < d.length; p += 4) {
    let r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const shadow = Math.pow(1 - y, 2.1);
    const highlight = Math.pow(y, 2.25);

    r += exposure + shadow * shadowLift - highlight * highlightRoll;
    g += exposure + shadow * shadowLift - highlight * highlightRoll;
    b += exposure + shadow * shadowLift - highlight * highlightRoll;

    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;
    r = clamp(r); g = clamp(g); b = clamp(b);

    const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
    const chroma = maxC - minC;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = maxC > 0 ? chroma / maxC : 0;
    const satFactor = 1 + saturationBoost + vibrance * (1 - sat);
    r = luma + (r - luma) * satFactor;
    g = luma + (g - luma) * satFactor;
    b = luma + (b - luma) * satFactor;

    // Tiny warm bias, avoiding orange skin.
    r += warm / 255;
    b -= (warm * 0.32) / 255;

    d[p] = Math.round(clamp(r) * 255);
    d[p + 1] = Math.round(clamp(g) * 255);
    d[p + 2] = Math.round(clamp(b) * 255);
  }
  bx.putImageData(src, 0, 0);
  return base;
}

function applySubjectDetail(canvas, subjectMask, amount) {
  if (!amount || amount <= 0) return canvas;
  const a = clamp(amount / 100);
  const W = canvas.width, H = canvas.height;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const o = out.getContext('2d', { willReadFrequently: true });
  o.drawImage(canvas, 0, 0);

  const soft = document.createElement('canvas');
  soft.width = W; soft.height = H;
  const sx = soft.getContext('2d');
  sx.filter = `blur(${(0.65 + a * 0.35).toFixed(2)}px)`;
  sx.drawImage(canvas, 0, 0);
  sx.filter = 'none';

  const img = o.getImageData(0, 0, W, H);
  const bp = sx.getImageData(0, 0, W, H).data;
  const m = document.createElement('canvas');
  m.width = W; m.height = H;
  const mx = m.getContext('2d', { willReadFrequently: true });
  mx.drawImage(subjectMask, 0, 0, W, H);
  const mp = mx.getImageData(0, 0, W, H).data;
  const d = img.data;

  // Detail is deliberately weaker on soft/flat skin than on textured edges.
  // A local contrast gate reduces the chance of emphasizing compression noise.
  const strength = 0.20 * a;
  for (let p = 0; p < d.length; p += 4) {
    const ma = mp[p + 3] / 255;
    if (ma <= 0.01) continue;
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const br = bp[p], bg = bp[p + 1], bb = bp[p + 2];
    const edge = Math.min(1, (Math.abs(r-br) + Math.abs(g-bg) + Math.abs(b-bb)) / 72);
    const k = strength * ma * (0.35 + 0.65 * edge);
    d[p] = Math.round(clamp((r + (r - br) * k) / 255) * 255);
    d[p + 1] = Math.round(clamp((g + (g - bg) * k) / 255) * 255);
    d[p + 2] = Math.round(clamp((b + (b - bb) * k) / 255) * 255);
  }
  o.putImageData(img, 0, 0);
  return out;
}

function buildSimpleBlur(source, protectMask, strength) {
  const bg = blur(source, Math.min(18, 1.5 + strength * 0.16));
  const W = source.width, H = source.height;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const o = out.getContext('2d', { willReadFrequently: true });
  const src = o.createImageData(W, H);

  const sx = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const bx = bg.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const pmc = document.createElement('canvas');
  pmc.width = W; pmc.height = H;
  const px = pmc.getContext('2d', { willReadFrequently: true });
  px.drawImage(protectMask, 0, 0, W, H);
  const pm = px.getImageData(0, 0, W, H).data;

  for (let p = 0; p < src.data.length; p += 4) {
    const w = 1 - pm[p + 3] / 255;
    src.data[p] = Math.round(sx[p] * (1 - w) + bx[p] * w);
    src.data[p + 1] = Math.round(sx[p + 1] * (1 - w) + bx[p + 1] * w);
    src.data[p + 2] = Math.round(sx[p + 2] * (1 - w) + bx[p + 2] * w);
    src.data[p + 3] = 255;
  }
  o.putImageData(src, 0, 0);
  return out;
}

export async function applyPortraitAI(source, depthStrength, edgeProtection, progress, opts = {}) {
  progress('Running person segmentation…');
  const rawMask = makeMask(source, edgeProtection);
  progress('Refining subject edges and building halo protection…');
  const subjectMask = featherMask(rawMask, edgeProtection);
  const masks = buildEdgeSafeMasks(subjectMask, edgeProtection);
  const protectMask = masks.protectMask;

  // Finish the source before depth compositing. This keeps the subject and
  // blurred background color-consistent and avoids sharpening the final blur.
  const enhancedSource = enhancePhoto(source, Number(opts.enhance || 0));
  if (Number(opts.enhance || 0) > 0) progress('Applying natural phone-style color and tone…');

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
    background = buildDepthBlur(enhancedSource, depthMap, subjectMask, protectMask, depthStrength);
  } else {
    background = buildSimpleBlur(enhancedSource, protectMask, depthStrength);
  }

  // Final subject composite uses the tight segmentation mask. The wider
  // protection mask has already prevented blurred pixels from bleeding into
  // the fine edge region.
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const o = out.getContext('2d');
  o.drawImage(background, 0, 0);

  const subject = document.createElement('canvas');
  subject.width = source.width;
  subject.height = source.height;
  const s = subject.getContext('2d');
  s.drawImage(enhancedSource, 0, 0);
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(subjectMask, 0, 0, source.width, source.height);
  o.drawImage(subject, 0, 0);

  // V10: detail is applied only where the subject mask says it is safe.
  // This keeps hair/clothing crisp without sharpening the blurred background.
  const detailed = applySubjectDetail(out, subjectMask, Number(opts.enhance || 0));

  return { canvas: detailed, mask: subjectMask, depthMap, depthMode, enhancedCanvas: enhancedSource };
}
