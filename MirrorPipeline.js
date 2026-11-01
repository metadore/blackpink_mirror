// MirrorPipeline: the single render loop. Everything the user sees AND everything that is recorded
// is drawn on ONE canvas, in this order:  mirrored video -> filter -> AR effects.
// Camera and tracking are injected, so you can plug in your own camera code later.
import { FILTERS, THEMES } from './filters.js';

export class MirrorPipeline {
  /**
   * @param {{video:HTMLVideoElement, canvas:HTMLCanvasElement, tracker:PoseTrackingEngine, effects?:{update(frame,dt,state),draw(ctx,w,h,state),clear()}}} deps
   */
  constructor({ video, canvas, tracker, effects = null }) {
    this.video = video; this.cv = canvas; this.x = canvas.getContext('2d');
    this.tracker = tracker; this.effects = effects;
    // state is the ONLY thing the UI changes. Theme switch never touches camera or tracker.
    this.state = { theme: 'cyber', filter: 'original', intensity: 0.7, effectsOn: true, debug: false, lowPerf: false,
      toggles: { sparkle: true, glow: true, butterfly: true, jump: true, spin: true, heart: true, trails: true } };
    this.frame = null; this.running = false; this.last = performance.now();
    tracker?.on('pose', f => (this.frame = f)).on('lost', () => (this.frame = null));
    tracker?.on('jump', e => this.effects?.trigger?.('jump', e, this.state));
    tracker?.on('spin', e => this.effects?.trigger?.('spin', e, this.state));
    tracker?.on('heart', e => this.effects?.trigger?.('heart', e, this.state));
  }
  set(patch) { Object.assign(this.state, patch); if (patch.lowPerf !== undefined) this.tracker?.setLowPerformance(patch.lowPerf); }
  toggle(name, on) { this.state.toggles[name] = on; }

  start() { if (this.running) return; this.running = true; this.last = performance.now(); this.#loop(); }
  stop() { this.running = false; this.effects?.clear?.(); }

  #loop = () => {
    if (!this.running) return;
    const v = this.video, s = this.state, x = this.x, W = this.cv.width, H = this.cv.height, now = performance.now(), dt = Math.min(50, now - this.last); this.last = now;
    if (v.videoWidth) {   // never draw (or record) before the camera has frames
      const sc = Math.max(W / v.videoWidth, H / v.videoHeight), dw = v.videoWidth * sc, dh = v.videoHeight * sc, f = FILTERS[s.filter];
      x.save(); x.translate(W, 0); x.scale(-1, 1); x.filter = f.css; x.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh); x.restore(); x.filter = 'none';
      if (s.filter !== 'original') f.draw(x, W, H, s.intensity, now, THEMES[s.theme], this.cv);
      if (this.effects) {
        s.frame = this.frame;
        this.effects.update(this.frame, dt, s);
        if (s.effectsOn) this.effects.draw(x, W, H, s);
      }
      if (s.debug && this.frame) this.#skeleton(x, W, H);
    }
    requestAnimationFrame(this.#loop);
  };
  #skeleton(x, W, H) {   // landmarks are normalised to the video; cover-fit mapping
    const v = this.video, sc = Math.max(W / v.videoWidth, H / v.videoHeight), ox = (W - v.videoWidth * sc) / 2, oy = (H - v.videoHeight * sc) / 2;
    x.fillStyle = '#fff'; this.frame.landmarks.forEach(p => { if (p.visible) { x.beginPath(); x.arc(p.x * v.videoWidth * sc + ox, p.y * v.videoHeight * sc + oy, 4, 0, 6.28); x.fill(); } });
  }
}

// Records the compositing canvas (NOT the raw webcam), so filters + effects are baked in.
export class Recorder {
  constructor(canvas) { this.cv = canvas; this.rec = null; this.chunks = []; this.blob = null; }
  static mime() {
    const mediaRecorder = globalThis.MediaRecorder || globalThis.window?.MediaRecorder;
    if (!mediaRecorder?.isTypeSupported) return undefined;
    const video = globalThis.document?.createElement?.('video');
    return ['video/mp4', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
      .find(type => mediaRecorder.isTypeSupported(type)
        && (!video?.canPlayType || video.canPlayType(type) !== ''));
  }
  async countdown(seconds = 3, onTick = () => {}) { for (let i = seconds; i > 0; i--) { onTick(i); await new Promise(r => setTimeout(r, 1000)); } onTick(0); }
  start() {
    const type = Recorder.mime(); if (!type) throw new Error('MediaRecorder / WebM not supported in this browser');
    this.chunks = []; this.rec = new MediaRecorder(this.cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 4e6 });
    this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.done = new Promise((resolve, reject) => {
      this.rec.onstop = () => {
        if (!this.chunks.length) {
          reject(new Error('The recording contains no video data. Record for a little longer and try again.'));
          return;
        }
        this.blob = new Blob(this.chunks, { type: this.rec.mimeType || type });
        resolve(this.blob);
      };
      this.rec.onerror = event => reject(event.error || new Error('The browser could not finish recording.'));
    });
    this.rec.start(250);
  }
  pause() { this.rec?.state === 'recording' && this.rec.pause(); }
  resume() { this.rec?.state === 'paused' && this.rec.resume(); }
  async stop() {
    if (!this.rec || !this.done) throw new Error('Recording has not started.');
    if (this.rec.state !== 'inactive') this.rec.stop();
    return this.done;
  }
}
