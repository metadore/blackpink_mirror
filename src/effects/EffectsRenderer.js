import { BONES, LM } from '../../PoseLandmarks.js';

const HAND_LANDMARKS = [LM.L_WRIST, LM.R_WRIST];
const TRAIL_LANDMARKS = [LM.L_WRIST, LM.R_WRIST, LM.L_ELBOW, LM.R_ELBOW, LM.L_ANKLE, LM.R_ANKLE];
const EFFECT_KEYS = ['sparkle', 'glow', 'butterfly', 'jump', 'spin', 'heart', 'trails'];

export class EffectsRenderer {
  constructor({ video, maxParticles = 500 } = {}) {
    this.video = video;
    this.maxParticles = maxParticles;
    this.particles = [];
    this.trails = new Map();
    this.time = 0;
    this.lastFrameTime = null;
    this.nextButterflyAt = 0;
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  update(frame, dt, state) {
    const elapsed = Math.min(dt, 50) / 1000;
    this.time += elapsed;
    const particleLimit = state.lowPerf
      ? Math.min(200, this.maxParticles)
      : this.reducedMotion ? Math.min(120, this.maxParticles) : this.maxParticles;

    for (const particle of this.particles) {
      particle.age += elapsed;
      if (particle.type === 'vortex') {
        particle.angle += elapsed * 3;
        const progress = Math.min(1, particle.age / particle.life);
        const radius = particle.radius * (0.25 + progress);
        particle.x = particle.anchor.x + Math.cos(particle.angle) * radius;
        particle.y = particle.anchor.y + Math.sin(particle.angle) * radius;
      } else {
        particle.x += particle.vx * elapsed;
        particle.y += particle.vy * elapsed;
        particle.vy += elapsed * 0.12;
      }
    }
    this.particles = this.particles.filter(particle => particle.age < particle.life);
    for (const [index, trail] of this.trails) {
      const recent = trail.filter(point => this.time - point.time <= 0.65);
      if (recent.length) this.trails.set(index, recent);
      else this.trails.delete(index);
    }

    const hasPose = frame?.landmarks?.length;
    if (!hasPose || frame.t === this.lastFrameTime) return;
    this.lastFrameTime = frame.t;

    if (state.toggles.trails) this.#updateTrails(frame);
    if (state.toggles.sparkle) this.#emitSparkles(frame, state, particleLimit);
    if (state.toggles.butterfly && this.time >= this.nextButterflyAt) {
      this.nextButterflyAt = this.time + (state.lowPerf || this.reducedMotion ? 0.4 : 0.16);
      for (const index of HAND_LANDMARKS) {
        const point = frame.landmarks[index];
        if (point?.visible) {
          const rose = state.theme === 'luxe' && Math.random() < 0.35;
          this.#emit(point.x, point.y, 1, rose ? 'rose' : 'butterfly', particleLimit);
        }
      }
    }
  }

  draw(ctx, width, height, state) {
    if (state.toggles.glow && state.frame?.landmarks) this.#drawGlow(ctx, width, height, state);
    if (state.toggles.trails) this.#drawTrails(ctx, width, height, state);
    this.#drawParticles(ctx, width, height, state);
  }

  trigger(name, data, state) {
    if (!EFFECT_KEYS.includes(name) || !state.toggles[name]) return false;
    const x = Number.isFinite(data?.x) ? data.x : 0.5;
    const y = Number.isFinite(data?.y) ? data.y : 0.5;
    const count = state.lowPerf || this.reducedMotion ? 14 : 32;

    if (name === 'jump') {
      this.#emit(x, y, count, 'star', this.maxParticles, true);
    } else if (name === 'spin') {
      this.#emit(x, y, count, 'vortex', this.maxParticles, true);
    } else if (name === 'heart') {
      this.#emit(x, y, Math.ceil(count / 4), 'heart', this.maxParticles, true);
    }
    return true;
  }

  clear() {
    this.particles.length = 0;
    this.trails.clear();
    this.lastFrameTime = null;
    this.nextButterflyAt = 0;
  }

  #emit(x, y, count, type, limit, radial = false) {
    const available = Math.max(0, Math.min(limit, this.maxParticles) - this.particles.length);
    const quantity = Math.min(count, available);
    for (let i = 0; i < quantity; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = radial ? 0.18 + Math.random() * 0.5 : 0.025 + Math.random() * 0.05;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (type === 'heart' ? 0.06 : 0),
        age: 0,
        life: type === 'butterfly' || type === 'rose' ? 1.8 : 1.1 + Math.random() * 0.5,
        size: type === 'butterfly' || type === 'rose' ? 0.035 : 0.018 + Math.random() * 0.012,
        type,
        angle,
        radius: 0.02 + Math.random() * 0.06,
        anchor: { x, y },
        colorIndex: Math.random(),
      });
    }
  }

  #emitSparkles(frame, state, limit) {
    for (const index of HAND_LANDMARKS) {
      const point = frame.landmarks[index];
      if (!point?.visible) continue;
      const speed = frame.speed?.[index] || 0;
      const count = Math.min(state.lowPerf || this.reducedMotion ? 1 : 5, speed > 0.003 ? 1 + Math.floor(speed * 120) : 0);
      this.#emit(point.x, point.y, count, 'sparkle', limit);
    }
  }

  #updateTrails(frame) {
    for (const index of TRAIL_LANDMARKS) {
      const point = frame.landmarks[index];
      if (!point?.visible) continue;
      const trail = this.trails.get(index) || [];
      trail.push({ x: point.x, y: point.y, time: this.time });
      while (trail.length && this.time - trail[0].time > 0.65) trail.shift();
      this.trails.set(index, trail);
    }
  }

  #drawGlow(ctx, width, height, state) {
    const points = state.frame.landmarks;
    const colors = this.#colors(state.theme);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colors.glow;
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = (state.lowPerf ? 12 : 24) * state.intensity;
    ctx.globalAlpha = 0.8 * state.intensity;
    ctx.lineWidth = (state.lowPerf ? 3 : 5) * state.intensity;
    for (const [from, to] of BONES) {
      if (!points[from]?.visible || !points[to]?.visible) continue;
      const a = this.#toCanvas(points[from], width, height);
      const b = this.#toCanvas(points[to], width, height);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawTrails(ctx, width, height, state) {
    const colors = this.#colors(state.theme);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = colors.a;
    ctx.shadowBlur = (state.lowPerf ? 8 : 16) * state.intensity;
    for (const trail of this.trails.values()) {
      if (trail.length < 2) continue;
      for (let i = 1; i < trail.length; i++) {
        const from = this.#toCanvas(trail[i - 1], width, height);
        const to = this.#toCanvas(trail[i], width, height);
        ctx.globalAlpha = ((i / trail.length) * 0.75) * state.intensity;
        ctx.strokeStyle = colors.a;
        ctx.lineWidth = Math.max(1, (i / trail.length) * 8 * state.intensity);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  #drawParticles(ctx, width, height, state) {
    const colors = this.#colors(state.theme);
    const glyphs = { sparkle: '✦', star: '✦', butterfly: '🦋', rose: '🌹', heart: '♥', vortex: '✧' };
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      const point = this.#toCanvas(particle, width, height);
      const fade = Math.max(0, 1 - particle.age / particle.life);
      ctx.globalAlpha = fade * state.intensity;
      ctx.fillStyle = particle.type === 'heart' ? colors.b : particle.colorIndex > 0.5 ? colors.a : '#fff';
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = (state.lowPerf ? 6 : 12) * state.intensity;
      ctx.font = `${Math.max(10, particle.size * height)}px serif`;
      ctx.fillText(glyphs[particle.type], point.x, point.y);
    }
    ctx.restore();
  }

  #toCanvas(point, width, height) {
    const videoWidth = this.video?.videoWidth;
    const videoHeight = this.video?.videoHeight;
    if (!videoWidth || !videoHeight) return { x: point.x * width, y: point.y * height };
    const scale = Math.max(width / videoWidth, height / videoHeight);
    return {
      x: point.x * videoWidth * scale + (width - videoWidth * scale) / 2,
      y: point.y * videoHeight * scale + (height - videoHeight * scale) / 2,
    };
  }

  #colors(theme) {
    return theme === 'luxe'
      ? { a: '#e8609f', b: '#f5e6ee', glow: '#ff9ccf' }
      : { a: '#ff2d9b', b: '#8a2be2', glow: '#ff2d9b' };
  }
}
