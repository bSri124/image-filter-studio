# Portrait Mode Draft v5

This version deliberately separates the two problems:
1. Mobile image upload/preview.
2. Portrait AI loading.

The main page uses a classic JavaScript file with no module dependency, so selecting a photo must work even if the MediaPipe CDN is unavailable.

After the photo is visible, tap **Load Portrait AI**. Only then does the browser import MediaPipe.

MediaPipe Tasks Vision supports on-device image segmentation; the official package documentation describes Image Segmenter and states that input processing occurs on device. See:
https://www.npmjs.com/package/@mediapipe/tasks-vision

Test order:
1. Upload photo.
2. Confirm the photo appears and PHOTO LOADED is shown.
3. Tap Load Portrait AI.
4. Tap Apply Portrait.
5. Enable Show subject mask and inspect hair/glasses edges.
