# Portrait AI V12 — Natural Portrait

This is the next refinement of the working V11 portrait module.

## V12 changes
- Soft edge-recovery ring around the segmentation boundary.
- Wider no-blur protection zone remains in place.
- Partial recovery avoids turning the protection ring into a visible cut-out.
- Better coverage around hair, dress/shirt edges, arms, shoes and nearby objects.
- Continuous relative-depth blur is retained when Depth Anything is available.
- Local fallback remains available when the depth model cannot be downloaded.
- Phone-style enhancement and Original → Enhanced → Portrait comparison are retained.
- Processing remains local in the browser.

## Starting values
- Depth: 68%
- iPhone-style Enhance: 70%
- Edge protection: 92%
- Natural distance-based depth: ON

## Important limitation
No browser segmentation model can guarantee 100% edge recovery for every photograph.
Fine hair, motion blur, transparent objects, low contrast and subject/background colors
that are very similar can be genuinely ambiguous. V12 reduces the visible failure area
by combining a tight mask, expanded protection and a soft recovery ring.

## Files
- index.html
- portrait.css
- portrait-upload.js
- portrait-model.js

No `.tmp` files are included.
