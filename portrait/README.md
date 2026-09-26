# Portrait AI V5

Adds monocular relative depth using Transformers.js + Depth Anything V2 Small. Person segmentation remains MediaPipe Selfie Segmenter. Processing is local in the browser after model download; models are cached by the browser.

## Test
1. Replace `/portrait/` contents with these files.
2. Choose a photo.
3. Load Portrait AI. First load can take longer because the depth model is downloaded and cached.
4. Keep Natural distance-based depth enabled.
5. Start with Depth strength 60-70% and Edge protection High.
6. Apply Portrait.

The depth model provides relative depth ordering, not physical distance in meters. The blur is intentionally multi-stage and conservative to avoid hard cutout edges.
