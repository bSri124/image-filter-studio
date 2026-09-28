# Portrait AI V11 — Natural Portrait

Independent `/portrait/` module for the existing Image Filter Studio repository.

## V11 focus
- Tight subject compositing mask plus a wider protection mask around the subject.
- Protected fringe stays close to the enhanced source instead of receiving background blur.
- Reduces bright/dark halos around hair, dresses, shoes, arms and nearby objects.
- Continuous relative-depth blur when Depth Anything is available.
- Safe local depth fallback when the depth model cannot be fetched.
- iPhone-style enhancement with restrained tone/color finishing.
- Subject-only detail enhancement.
- Original → Enhanced → Portrait comparison remains available.
- All photo processing remains in the browser.

## Recommended starting values
- Depth: 68%
- iPhone-style Enhance: 70%
- Edge protection: 92%

High edge protection now has a real processing effect: it expands a no-blur safety zone around the segmentation mask, rather than only changing a label.

## Install
Copy the contents into the existing repository's `/portrait/` folder. No new repository is required.
