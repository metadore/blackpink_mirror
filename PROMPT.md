# BLACKPINK MIRROR — next build prompt

Paste this into Claude Code from the project root.

## Context
React + Vite project. Already present and NOT to be rewritten:
- `src/tracking/PoseTrackingEngine.js` — MediaPipe Pose Landmarker wrapper (events: loading, ready, pose, lost, found, jump, spin, heart, error).
- MediaPipe Tasks Vision uses local npm/WASM/model assets; don't add runtime CDN downloads.
- `src/effects/filters.js` — the 7 filters (original, venom, shutdown, butterfly, killthislove, howyoulikethat, diamond) and the two theme palettes.
- `src/effects/EffectsRenderer.js` — DONE (pose glow, sparkle and neon trails, butterflies, and gesture bursts).
- `src/pipeline/MirrorPipeline.js` — one render loop on one canvas (mirrored video, filter, effects) plus `Recorder`, which records that canvas.
- `BLACKPINK Mirror — studio design.html` — the approved mirror UI and app entry. Keep its look, both themes, layout and copy.

## Rules
- Camera starts only after the user presses ACTIVATE MIRROR. Nothing records without an explicit action. Nothing is uploaded.
- Load MediaPipe WASM and pose model from local app assets, not a CDN.
- Record the compositing canvas via `captureStream`, never the raw webcam.
- Theme switch must not restart the camera or tracker. Only `pipeline.set({theme})`.
- Keep state out of React for per-frame data. React holds UI state only.
- Stop all camera tracks, call `tracker.dispose()` and cancel loops when leaving the mirror.
- Cap particles (pool of about 500; about 200 in low-performance mode). Respect `prefers-reduced-motion`.
- Do not fake anything. If something cannot be done, say so.

## Milestones (test each before the next)
1. `src/camera/CameraManager.js` is implemented: getUserMedia, start/stop, flip front/rear, resolution, and explicit error states (denied, unavailable, in use). The app/controller must start the pipeline after camera startup to show the mirrored preview on its canvas; verify this integration on a camera.
2. Wire `PoseTrackingEngine` to the video. Show tracking status, loading indicator, the debug skeleton, and the "person left the frame" state.
3. DONE: `src/effects/EffectsRenderer.js` implements pose-following glow, sparkle and neon trails, butterflies, and jump/spin/heart gesture effects. The effects are individually switchable and use the active theme palette.
4. React UI from `design/studio.html`: theme toggle (cyber / luxe, luxe adds roses and butterflies), filter grid with thumbnails, intensity slider, effect toggles, low-performance and debug switches.
5. Recording UI: 3-second countdown, record, pause, resume, stop, preview, retake, download. Pick the codec with `Recorder.mime()` and show a clear message if unsupported.
6. `src/gallery/ArchiveStore.js` (IndexedDB): save, rename, thumbnail (first frame), play, download, delete with confirm, storage estimate via `navigator.storage.estimate()`, quota-error handling. UI copy must not call browser storage permanent.

## Done when
A person can activate the camera, dance, see the body-following effects and filter live, record, preview, download a WebM that contains the filter and effects, and save it to the archive.
