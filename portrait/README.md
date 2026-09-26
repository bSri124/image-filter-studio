# Portrait AI V4

Fixes the V3 processing failure: the CPU segmenter was created with MediaPipe defaults, which do not request a category mask. V4 explicitly requests both confidence and category masks for CPU/GPU, then prefers the confidence mask for softer portrait edges.

Test:
1. Choose photo
2. Load Portrait AI
3. Apply Portrait
4. Try Depth 70%, Edge Protection High
5. Use Show subject mask only for diagnostics
