# Portrait Mode Draft v3

This version fixes the Android upload path by using a real file input overlay instead of a hidden input/label click pattern.

It also lazy-loads the segmentation models only after a photo is selected, so photo selection is independent of model loading.

## Deployment
Upload the three files to Cloudflare Pages/Workers:
- index.html
- style.css
- app.js

The page intentionally shows **Draft v3** so you can verify that the new deployment is actually live and not a cached older build.

## Test first
Use photos with flyaway hair, spiky hair, spectacles (including side-view arms), earrings/headphones, and objects immediately beside the face.
