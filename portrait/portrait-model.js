let segmenter = null, loading = null;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const CDNS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs',
  'https://unpkg.com/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs'
];
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';

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
    report('Segmentation model reachable ✓', true,
      `${Math.round((+response.headers.get('content-length') || 0) / 1024)} KB reported`);

    const options = {
      baseOptions: { modelAssetPath: MODEL },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: true
    };

    try {
      report('Initializing CPU ImageSegmenter…');
      segmenter = await ImageSegmenter.createFromOptions(fs, {
        ...options,
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }
      });
      report('CPU ImageSegmenter ready ✓', true);
    } catch (cpuErr) {
      report('CPU ImageSegmenter failed', false, cpuErr?.message || String(cpuErr));
      report('Trying GPU ImageSegmenter…');
      segmenter = await ImageSegmenter.createFromOptions(fs, {
        ...options,
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }
      });
      report('GPU ImageSegmenter ready ✓', true);
    }
    return segmenter;
  })();

  try { return await loading; }
  catch (e) { loading = null; throw e; }
}

function maskFromConfidence(m, threshold, edgeProtection) {
  const v = m.getAsFloat32Array();
  const c = document.createElement('canvas');
  c.width = m.width; c.height = m.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  const im = x.createImageData(m.width, m.height);

  // Lower threshold with stronger edge protection so fine hair/glasses survive.
  const t = Math.max(0.18, 0.52 - edgeProtection * 0.0022);
  for (let i = 0, p = 0; i < v.length; i++, p += 4) {
    const q = Math.max(0, Math.min(1, (v[i] - t) / Math.max(0.12, 1 - t)));
    im.data[p] = 255;
    im.data[p + 1] = 255;
    im.data[p + 2] = 255;
    im.data[p + 3] = Math.round(q * 255);
  }
  x.putImageData(im, 0, 0);
  return c;
}

function maskFromCategory(m) {
  const v = m.getAsUint8Array();
  const c = document.createElement('canvas');
  c.width = m.width; c.height = m.height;
  const x = c.getContext('2d');
  const im = x.createImageData(m.width, m.height);
  for (let i = 0, p = 0; i < v.length; i++, p += 4) {
    const a = v[i] > 0 ? 255 : 0;
    im.data[p] = im.data[p + 1] = im.data[p + 2] = 255;
    im.data[p + 3] = a;
  }
  x.putImageData(im, 0, 0);
  return c;
}

function makeMask(source, edgeProtection) {
  const r = segmenter.segment(source);
  // Confidence masks provide a soft probability boundary and are preferable for
  // portrait edges. Category mask remains a fallback.
  if (r.confidenceMasks?.length) {
    const m = r.confidenceMasks[0];
    return maskFromConfidence(m, 0.45, edgeProtection);
  }
  if (r.categoryMask) return maskFromCategory(r.categoryMask);
  throw Error('No confidence or category mask returned');
}

function blur(s, r) {
  const c = document.createElement('canvas'); c.width = s.width; c.height = s.height;
  const x = c.getContext('2d'); x.filter = `blur(${r}px)`; x.drawImage(s, 0, 0); x.filter = 'none';
  return c;
}

function soft(m, e) {
  const c = document.createElement('canvas'); c.width = m.width; c.height = m.height;
  const x = c.getContext('2d');
  x.filter = `blur(${Math.max(.35, (100 - e) * .025 + .35)}px)`;
  x.drawImage(m, 0, 0); x.filter = 'none';
  return c;
}

export async function applyPortraitAI(source, depth, edge, progress) {
  progress('Running person segmentation…');
  const raw = makeMask(source, edge);
  progress('Refining subject edge…');
  const mask = soft(raw, edge);
  progress('Creating background blur…');
  const bg = blur(source, 1 + depth * 0.14);

  const out = document.createElement('canvas');
  out.width = source.width; out.height = source.height;
  const o = out.getContext('2d');
  o.drawImage(bg, 0, 0);

  const subject = document.createElement('canvas');
  subject.width = source.width; subject.height = source.height;
  const s = subject.getContext('2d');
  s.drawImage(source, 0, 0);
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(mask, 0, 0, source.width, source.height);
  o.drawImage(subject, 0, 0);

  return { canvas: out, mask };
}
