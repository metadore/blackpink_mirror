# BLACKPINK Mirror

```
blackpink-mirror/
├─ PROMPT.md                         build prompt for the next stage
├─ package.json                      React + Vite + @mediapipe/tasks-vision
├─ scripts/copy-mediapipe-assets.js  copies the installed MediaPipe WASM files into public/
├─ BLACKPINK Mirror — studio design.html  mirror UI and app entry (both themes)
├─ public/models/                    self-hosted pose_landmarker_lite.task
├─ public/mediapipe/wasm/            generated local MediaPipe WASM assets
└─ src/
   ├─ camera/CameraManager.js        Camera access, flip, stop, resolution and status events
   ├─ tracking/PoseTrackingEngine.js DONE  (MediaPipe wrapper, gestures, smoothing)
   ├─ effects/filters.js             DONE  (7 filters, 2 theme palettes)
   ├─ effects/EffectsRenderer.js     pose-following glow, trails, butterflies and gestures
   ├─ pipeline/MirrorPipeline.js     DONE  (render loop + Recorder)
   ├─ gallery/ArchiveStore.js        IndexedDB cache with 7-day expiry for unsaved recordings
   └─ ui/                            TODO milestone 4-5 (React components)
```

Data flow: CameraManager -> video -> PoseTrackingEngine -> EffectsRenderer -> MirrorPipeline
(video, filter and effects on ONE canvas) -> Recorder (captureStream) -> ArchiveStore.

Run `npm install` once with network access to install the pinned MediaPipe package.
The official Pose Landmarker Lite model is included at
`public/models/pose_landmarker_lite.task`. `npm run dev` and `npm run build` copy the
package's WASM files into `public/mediapipe/wasm/`; inference loads the WASM and model
from the app itself, without runtime CDN requests. The camera needs localhost or HTTPS.
Saving a finished video always asks for confirmation in the page. Browsers with the File
System Access API then open their native save picker; other browsers use the normal
download flow. Android browsers may save to Downloads rather than placing a file
directly in Gallery. Open the site over HTTPS on a phone to allow camera access;
localhost is only trusted on the device running the development server. The recorder
prefers playable MP4 for compatibility with phone
galleries and laptop video players, then falls back to a format the browser can play.
Undownloaded videos are cached locally in IndexedDB for up to seven days and are
deleted from that cache after a successful save/download. A downloaded file is outside
the website's control and is never deleted by the app.

The studio design HTML is the mirror app. The main BLACKPINK experience's **MIRROR**
navigation opens the studio, and the studio header links back to the main experience.
Open the Vite root URL to reach the studio; its camera starts only after pressing
**ACTIVATE MIRROR**; it begins the first recording after the 3-second countdown. Once
the camera is active, **RECORD** starts additional clips.

`CameraManager` accepts the preview `<video>` element. Call `start()` only after the user
activates the mirror; use `flip()`, `setFacingMode('user' | 'environment')`,
`setResolution(width, height)` and `stop()` to control it. Subscribe with `on('state', fn)`
for `idle`, `requesting`, `ready` and `error` states, and `on('error', fn)` for a
`CameraError` with a stable `code`. The camera manager only supplies the video stream;
the pipeline remains responsible for drawing the mirrored preview and recording canvas.
