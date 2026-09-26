import { loadPortraitAI, applyPortraitAI } from './portrait-model.js';

const $ = id => document.getElementById(id);
const file = $('portraitFile');
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const status = $('status');
const load = $('load');
const apply = $('apply');
const download = $('download');
const depth = $('depth');
const edge = $('edge');
const showMask = $('showMask');
const diag = $('diag');
const depthAI = $('depthAI');

let source = null;
let result = null;
let mask = null;
let depthMap = null;
let aiReady = false;
let loadingPromise = null;

function setStatus(text) { status.textContent = text; }
function log(text, ok = null) {
  const li = document.createElement('li');
  li.textContent = text;
  if (ok !== null) li.className = ok ? 'ok' : 'fail';
  diag.appendChild(li);
}
function clearLog() { diag.innerHTML = ''; }
function updateValues() {
  $('depthValue').textContent = `${depth.value}%`;
  $('edgeValue').textContent = edge.value >= 75 ? 'High' : edge.value >= 45 ? 'Medium' : 'Low';
}
updateValues();
depth.oninput = updateValues;
edge.oninput = updateValues;

async function ensureAI() {
  if (aiReady) return true;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    load.disabled = true;
    apply.disabled = true;
    clearLog();
    log('Starting Portrait AI…');
    try {
      await loadPortraitAI((stage, ok, detail) => {
        log(`${stage}${detail ? ` — ${detail}` : ''}`, ok);
        setStatus(stage);
      });
      aiReady = true;
      log('Person segmentation ready ✓', true);
      apply.disabled = !source;
      setStatus('PORTRAIT AI READY ✓');
      return true;
    } catch (e) {
      console.error(e);
      log(`FAILED — ${e?.message || String(e)}`, false);
      setStatus('Portrait AI could not load. The page will still work with local fallback.');
      return false;
    } finally {
      load.disabled = false;
    }
  })();
  try { return await loadingPromise; } finally { loadingPromise = null; }
}

file.onchange = async event => {
  const selected = event.target.files?.[0];
  if (!selected) return;

  clearLog();
  log(`Photo selected: ${selected.name}`);
  try {
    setStatus('Opening photo…');
    const url = URL.createObjectURL(selected);
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    URL.revokeObjectURL(url);

    const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    source = document.createElement('canvas');
    source.width = Math.max(1, Math.round(img.naturalWidth * scale));
    source.height = Math.max(1, Math.round(img.naturalHeight * scale));
    source.getContext('2d', { alpha: false }).drawImage(img, 0, 0, source.width, source.height);

    canvas.width = source.width;
    canvas.height = source.height;
    ctx.drawImage(source, 0, 0);
    result = null;
    mask = null;
    depthMap = null;
    apply.disabled = true;
    download.disabled = true;
    load.disabled = false;
    aiReady = false;

    setStatus(`PHOTO LOADED ✓ ${img.naturalWidth} × ${img.naturalHeight}`);
    log(`Preview pipeline OK (${source.width} × ${source.height}).`, true);

    // Automatically prepare AI after the image is visible. If a depth model
    // cannot be fetched, Apply Portrait still has a deterministic fallback.
    await ensureAI();
  } catch (e) {
    console.error(e);
    log(`Image decode failed — ${e?.message || String(e)}`, false);
    setStatus('Could not decode this image.');
  }
};

load.onclick = () => ensureAI();

apply.onclick = async () => {
  if (!source) return;
  if (!aiReady) await ensureAI();
  if (!aiReady) {
    setStatus('Person segmentation is not available. Check the diagnostics.');
    return;
  }

  apply.disabled = true;
  showMask.checked = false;
  try {
    const r = await applyPortraitAI(
      source,
      Number(depth.value),
      Number(edge.value),
      text => setStatus(text),
      {
        useDepth: depthAI.checked,
        onDepthFallback: e => log(`Depth AI fallback activated — ${e?.message || String(e)}`, false)
      }
    );

    result = r.canvas;
    mask = r.mask;
    depthMap = r.depthMap;
    canvas.width = result.width;
    canvas.height = result.height;
    ctx.drawImage(result, 0, 0);
    download.disabled = false;
    log(r.depthMode === 'ai' ? 'Real relative depth applied ✓' : 'Local natural-depth fallback applied ✓', true);
    setStatus(r.depthMode === 'ai' ? 'NATURAL PORTRAIT APPLIED ✓' : 'NATURAL PORTRAIT APPLIED ✓ (local fallback)');
  } catch (e) {
    console.error(e);
    setStatus('Portrait processing failed. See diagnostics.');
    log(`Processing failed — ${e?.message || String(e)}`, false);
  } finally {
    apply.disabled = false;
  }
};

showMask.onchange = () => {
  if (!source || !mask) return;
  if (!showMask.checked) {
    ctx.drawImage(result || source, 0, 0);
    return;
  }

  ctx.drawImage(source, 0, 0);
  const overlay = document.createElement('canvas');
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  const x = overlay.getContext('2d');
  x.drawImage(mask, 0, 0, overlay.width, overlay.height);
  const pixels = x.getImageData(0, 0, overlay.width, overlay.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const a = pixels.data[i + 3];
    pixels.data[i] = 40;
    pixels.data[i + 1] = 220;
    pixels.data[i + 2] = 100;
    pixels.data[i + 3] = Math.round(a * 0.38);
  }
  x.putImageData(pixels, 0, 0);
  ctx.drawImage(overlay, 0, 0);
};

download.onclick = () => {
  if (!result) return;
  result.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'portrait-natural-depth.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }, 'image/jpeg', 0.94);
};
