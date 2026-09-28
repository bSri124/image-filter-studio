# Portrait AI V13 — Natural Portrait

V13 is the next iteration of the browser-only portrait filter.

## V13 changes
- Adaptive edge recovery around the segmentation boundary.
- Wider no-blur protection zone to reduce halo bleed.
- Conservative recovery of thin hair, clothing, shoes and narrow subject edges.
- Continuous relative-depth blur when Depth Anything is available.
- Safe deterministic local depth fallback when the remote depth model cannot be fetched.
- iPhone-style finishing explicitly covers:
  - controlled saturation
  - vibrance
  - highlight roll-off/recovery
  - shadow lift
  - richer deep blacks
  - gentle mid-tone contrast
  - tiny warm bias
  - subject-only detail enhancement
- Original → Enhancement Only → Portrait Effect comparison.
- Local browser processing; photos are not uploaded by this module.

## Recommended starting values
- Depth: 68%
- iPhone-style Enhance: 70%
- Edge protection: 95%

## Important
100% edge accuracy cannot be guaranteed by a browser segmentation model. V13 is deliberately conservative: it tries to recover missed edge pixels without creating a visible background halo.

## Install
Copy the contents into the existing repository's `/portrait/` folder.
