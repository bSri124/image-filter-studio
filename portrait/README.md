# Portrait AI V8 — local iPhone-style portrait finishing

This module is designed to live independently under `/portrait/` in the existing repository.

## Features
- Local photo selection and preview.
- MediaPipe person segmentation.
- Fine-edge protection for hair, glasses and nearby objects.
- Depth Anything V2 Small when available, with a safe local fallback when the depth model cannot be fetched.
- Natural distance-based background blur.
- **iPhone-style Enhance**: restrained HDR-style shadow/highlight recovery, midtone contrast, natural vibrance, subtle warmth and gentle detail sharpening.
- Enhancement is applied **before** depth compositing, so the background remains blurred and the subject stays consistent with the scene.
- No image upload to a server by this module.

## Usage
1. Copy the files into the existing repository's `/portrait/` folder.
2. Open `/portrait/`.
3. Choose a photo.
4. Leave `iPhone-style Enhance` around 45–65% for a natural result.
5. Adjust depth strength and edge protection.
6. Apply Portrait.
7. Download the JPEG.

The enhancement is intentionally not an exact copy of Apple's proprietary camera pipeline. It is a local photographic finishing pass designed to give a similar clean, natural phone-camera look without requiring a server.


## V10 changes
- Natural continuous depth blending instead of visible blur bands.
- Stronger but restrained phone-style tonal/color finishing.
- Subject-only detail enhancement; blurred background is not sharpened.
- Compare button cycles Original -> Enhanced -> Portrait Effect.
- Keeps local browser processing and the depth-model fallback.
