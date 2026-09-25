# Portrait extra files

This deliberately separates Portrait Mode from the existing Image Filter Studio.

Files:
- portrait.html — standalone test page
- portrait.css — Portrait UI
- portrait-upload.js — upload/preview only

The next module can be added separately:
- portrait-model.js — MediaPipe segmentation
- portrait-effects.js — edge refinement, depth blur and colour grading

This lets us test one layer at a time instead of having a CDN/model failure break the upload system.

For now, open portrait.html on the deployed site or copy these files into a `/portrait/` folder.
