# Portrait Mode AI V1
Standalone portrait test module. Put these files in `/portrait/`; open `/portrait/`.

Flow: choose photo -> Load Portrait AI -> Apply Portrait.

Uses MediaPipe Tasks Vision ImageSegmenter and the Selfie Segmenter model. Runtime/model load only after the button is pressed. GPU is attempted first, then CPU fallback.

V1 is segmentation-based background blur, not a true depth map. Hair strands, glasses and tiny accessories are not guaranteed perfect yet and are the next refinement targets.
