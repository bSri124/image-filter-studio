# Portrait AI V3 — loading diagnostic

Copy the contents into the existing `/portrait/` folder.

## Test
1. Upload a photo.
2. Tap **Load Portrait AI**.
3. Read the **AI diagnostics** box.
4. If all required stages show ✓, tap **Apply Portrait**.

V3 deliberately initializes CPU first and only attempts GPU as a fallback. It also tries jsDelivr and unpkg for the MediaPipe JS runtime. The segmentation model remains the official Google MediaPipe Selfie Segmenter model.

This version is diagnostic: do not integrate it into the main app until one successful run is confirmed.
