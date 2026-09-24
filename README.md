# Image Filter Studio

A lightweight, mobile-first image filter web app. Users upload a source image, choose a filter, adjust intensity, and download the result.

## Included filters

- Original
- Enhance
- Bloom
- Grey
- Black & White
- 1980's
- Pixels
- Vintage
- Sepia
- Warm
- Cool
- Dramatic

## Architecture

This is intentionally a **static client-side app**:

- No backend
- No database
- No image upload to a server
- Images stay in the user's browser
- Canvas API performs the processing
- Works well with Cloudflare Pages

## Run locally

Open `index.html` directly, or use any static server:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Git

```bash
git init
git add .
git commit -m "Initial image filter studio"
git branch -M main
git remote add origin <YOUR_GIT_REPO_URL>
git push -u origin main
```

## Cloudflare Pages

Create a Pages project from the Git repository.

Build settings:

- Framework preset: None
- Build command: leave empty
- Build output directory: `/` (repository root)

Every push to the selected branch can then trigger a new deployment.

## Next upgrades

Potential additions:

1. Before/after comparison slider
2. Crop and rotate
3. Brightness / contrast / saturation controls
4. More cinematic presets
5. Custom filter creator
6. PWA install support
7. Optional ad slots above and below the editor
8. Share/export buttons
