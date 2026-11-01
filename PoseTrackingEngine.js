// PoseTrackingEngine — wraps MediaPipe Tasks Vision (from github.com/google-ai-edge/mediapipe,
// distributed as the npm package @mediapipe/tasks-vision) behind a small event API.
// Camera-agnostic: you hand it any <video> element that is already playing.
import { BONES, LM } from './PoseLandmarks.js';

const BASE_URL = import.meta.env.BASE_URL;
const MODELS = {
  lite: 'pose_landmarker_lite.task',
  full: 'pose_landmarker_full.task',
  heavy: 'pose_landmarker_heavy.task',
};

export { BONES, LM } from './PoseLandmarks.js';

export class PoseTrackingEngine {
  constructor(opts = {}) {
    this.o = { model: 'lite', numPoses: 1, minConfidence: 0.5, smoothing: 0.5,
      maxFps: 30, mirror: true, lostAfterMs: 400, wasmPath: null, modelAssetPath: null, ...opts };
    this.listeners = {};
    this.landmarker = null; this.video = null; this.running = false;
    this.smooth = null; this.lastTs = -1; this.lastRun = 0; this.lastSeen = 0;
    this.lost = true; this.hipY = []; this.delegate = null; this.g = { jumpAt: 0, spinAt: 0, heartAt: 0 };
  }
  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
  emit(evt, data) { (this.listeners[evt] || []).forEach(f => f(data)); }

  // Loads the WASM + model. Tries GPU, falls back to CPU. Does not block rendering (async).
  async init() {
    try {
      this.emit('loading', { stage: 'import' });
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const base = globalThis.document.baseURI;
      const wasmPath = this.o.wasmPath || new URL(`${BASE_URL}mediapipe/wasm/`, base).href;
      const modelFile = MODELS[this.o.model];
      if (!modelFile) throw new RangeError(`Unknown pose model "${this.o.model}".`);
      const modelAssetPath = this.o.modelAssetPath || new URL(`${BASE_URL}models/${modelFile}`, base).href;
      const fileset = await FilesetResolver.forVisionTasks(wasmPath);
      this.emit('loading', { stage: 'model' });
      const make = delegate => PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO', numPoses: this.o.numPoses,
        minPoseDetectionConfidence: this.o.minConfidence,
        minPosePresenceConfidence: this.o.minConfidence,
        minTrackingConfidence: this.o.minConfidence });
      try { this.landmarker = await make('GPU'); this.delegate = 'GPU'; }
      catch (e) { this.landmarker = await make('CPU'); this.delegate = 'CPU'; }
      this.emit('ready', { delegate: this.delegate });
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  start(video) {
    if (!this.landmarker) throw new Error('Call init() first');
    this.video = video; this.running = true; this.#schedule();
  }
  stop() { this.running = false; }
  // Release everything. Call when leaving the mirror.
  dispose() { this.stop(); this.landmarker?.close(); this.landmarker = null; this.video = null; this.smooth = null; }
  setLowPerformance(on) { this.o.maxFps = on ? 12 : 30; }

  #schedule() {
    if (!this.running) return;
    const v = this.video;
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => this.#tick());
    else requestAnimationFrame(() => this.#tick());
  }

  #tick() {
    if (!this.running) return;
    const now = performance.now(), v = this.video;
    if (v.readyState >= 2 && v.videoWidth && now - this.lastRun >= 1000 / this.o.maxFps) {
      this.lastRun = now;
      const ts = Math.max(now, this.lastTs + 1); this.lastTs = ts;     // timestamps must increase
      let res; try { res = this.landmarker.detectForVideo(v, ts); } catch (e) { this.emit('error', e); }
      if (res) this.#handle(res, now);
    }
    this.#schedule();
  }

  #handle(res, now) {
    const poses = res.landmarks || [];
    if (!poses.length) {
      if (!this.lost && now - this.lastSeen > this.o.lostAfterMs) { this.lost = true; this.smooth = null; this.emit('lost', {}); }
      return;
    }
    this.lastSeen = now;
    if (this.lost) { this.lost = false; this.emit('found', {}); }
    const raw = poses[0], a = this.o.smoothing;
    if (!this.smooth) this.smooth = raw.map(p => ({ ...p }));
    const lm = raw.map((p, i) => {            // exponential smoothing against jitter
      const s = this.smooth[i];
      s.x += (p.x - s.x) * (1 - a); s.y += (p.y - s.y) * (1 - a); s.z += (p.z - s.z) * (1 - a);
      s.visibility = p.visibility;
      return { x: this.o.mirror ? 1 - s.x : s.x, y: s.y, z: s.z, visible: (p.visibility ?? 1) >= this.o.minConfidence };
    });
    const frame = { landmarks: lm, all: poses, t: now,
      fullBody: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_ANKLE, LM.R_ANKLE].every(i => lm[i].visible),
      speed: this.#speeds(lm) };
    this.emit('pose', frame);
    this.#gestures(frame);
  }

  #prev = null;
  #speeds(lm) {   // normalised units / frame for key joints, used to scale particle density
    const keys = [LM.L_WRIST, LM.R_WRIST, LM.L_ANKLE, LM.R_ANKLE], out = {};
    keys.forEach(k => { const p = this.#prev?.[k]; out[k] = p ? Math.hypot(lm[k].x - p.x, lm[k].y - p.y) : 0; });
    this.#prev = lm; return out;
  }

  #gestures(f) {
    const lm = f.landmarks, now = f.t, vis = i => lm[i].visible;
    // JUMP: hips rise quickly relative to torso length
    if (vis(LM.L_HIP) && vis(LM.R_HIP) && vis(LM.L_SHOULDER)) {
      const hy = (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2, torso = Math.abs(lm[LM.L_SHOULDER].y - lm[LM.L_HIP].y) || 0.2;
      this.hipY.push([now, hy]); while (this.hipY.length && now - this.hipY[0][0] > 300) this.hipY.shift();
      const rise = (this.hipY[0][1] - hy) / torso;
      if (rise > 0.22 && now - this.g.jumpAt > 900) {
        this.g.jumpAt = now;
        this.emit('jump', { x: (lm[LM.L_ANKLE].x + lm[LM.R_ANKLE].x) / 2, y: Math.max(lm[LM.L_ANKLE].y, lm[LM.R_ANKLE].y) });
      }
    }
    // SPIN: shoulder-width collapses toward zero as the torso turns edge-on
    if (vis(LM.L_SHOULDER) && vis(LM.R_SHOULDER) && vis(LM.L_HIP) && vis(LM.R_HIP)) {
      const sw = Math.abs(lm[LM.L_SHOULDER].x - lm[LM.R_SHOULDER].x), torso = Math.abs(lm[LM.L_SHOULDER].y - lm[LM.L_HIP].y) || 0.2;
      if (sw / torso < 0.25 && now - this.g.spinAt > 1500) {
        this.g.spinAt = now;
        this.emit('spin', { x: (lm[LM.L_SHOULDER].x + lm[LM.R_SHOULDER].x) / 2, y: (lm[LM.L_SHOULDER].y + lm[LM.L_HIP].y) / 2 });
      }
    }
    // ARM-HEART (configurable): wrists close together, above the nose, elbows wide apart
    if (vis(LM.L_WRIST) && vis(LM.R_WRIST) && vis(LM.NOSE)) {
      const wd = Math.hypot(lm[LM.L_WRIST].x - lm[LM.R_WRIST].x, lm[LM.L_WRIST].y - lm[LM.R_WRIST].y);
      const sw = Math.abs(lm[LM.L_SHOULDER].x - lm[LM.R_SHOULDER].x) || 0.3;
      const above = lm[LM.L_WRIST].y < lm[LM.NOSE].y && lm[LM.R_WRIST].y < lm[LM.NOSE].y;
      const wide = Math.abs(lm[LM.L_ELBOW].x - lm[LM.R_ELBOW].x) > sw * 1.1;
      if (wd < sw * 0.25 && above && wide && now - this.g.heartAt > 1500) {
        this.g.heartAt = now; this.emit('heart', { x: lm[LM.NOSE].x, y: lm[LM.NOSE].y - 0.1 });
      }
    }
  }
}
