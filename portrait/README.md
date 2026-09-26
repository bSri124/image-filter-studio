# Portrait Mode AI V7

A browser-local portrait effect designed for mobile use.

## What changed

- Photo upload is independent from AI initialization and works before AI loads.
- AI preparation starts automatically after the photo is visible.
- MediaPipe Selfie Segmenter is used for the person mask.
- Fine-edge protection is biased toward preserving hair, spectacles and nearby objects.
- Depth Anything V2 Small is attempted first using a lightweight browser model.
- A smaller Depth Anything fallback is attempted if V2 cannot load.
- If all depth-model downloads fail, the portrait effect **does not fail**. It uses a conservative local distance heuristic and still produces a usable blur.
- Transformers.js browser caching is enabled, so successful model downloads can be reused by the browser.
- The original subject is composited over the blurred background as the final step to reduce halos around the subject.

## Important limitation

The real depth model provides **relative monocular depth**, not exact physical distance in metres. The local fallback is only a visual approximation and is intentionally conservative.

## Test

1. Replace the contents of `/portrait/` in the same Git repository with these files.
2. Open `/portrait/`.
3. Choose a photo.
4. Wait for the automatic AI preparation. The photo should remain visible during loading.
5. Tap **Apply Portrait**.
6. If Depth AI is unavailable, diagnostics will say that the local fallback was used; the effect should still complete.
7. Start with Depth 60–70% and Edge Protection High.

## Model/network note

The first successful depth-model load can download tens of MB and can take time on mobile. Browser caching prevents repeated downloads on the same browser/origin when the cache is retained.
