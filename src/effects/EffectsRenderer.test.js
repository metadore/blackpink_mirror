import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectsRenderer } from './EffectsRenderer.js';
import { LM } from '../../PoseLandmarks.js';

function makeFrame(t, positions = {}) {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visible: false }));
  for (const [index, point] of Object.entries(positions)) {
    landmarks[index] = { ...point, visible: true };
  }
  return {
    t,
    landmarks,
    speed: { [LM.L_WRIST]: 0.02, [LM.R_WRIST]: 0.01 },
  };
}

function makeContext() {
  const calls = { fillText: 0, stroke: 0 };
  return {
    calls,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() { calls.stroke++; },
    fillText() { calls.fillText++; },
  };
}

const state = () => ({
  theme: 'cyber',
  intensity: 0.7,
  lowPerf: false,
  toggles: { sparkle: true, glow: true, butterfly: true, jump: true, spin: true, heart: true, trails: true },
});

test('draws pose-following glow, trails, and particles on the compositing context', () => {
  const renderer = new EffectsRenderer({ video: { videoWidth: 1280, videoHeight: 720 } });
  const currentState = state();
  currentState.frame = makeFrame(1, {
    [LM.L_WRIST]: { x: 0.3, y: 0.4 },
    [LM.R_WRIST]: { x: 0.7, y: 0.4 },
    [LM.L_ELBOW]: { x: 0.35, y: 0.3 },
    [LM.R_ELBOW]: { x: 0.65, y: 0.3 },
    [LM.L_SHOULDER]: { x: 0.4, y: 0.25 },
    [LM.R_SHOULDER]: { x: 0.6, y: 0.25 },
  });
  renderer.update(currentState.frame, 16, currentState);
  currentState.frame = makeFrame(2, {
    [LM.L_WRIST]: { x: 0.32, y: 0.4 },
    [LM.R_WRIST]: { x: 0.68, y: 0.4 },
    [LM.L_ELBOW]: { x: 0.36, y: 0.3 },
    [LM.R_ELBOW]: { x: 0.64, y: 0.3 },
    [LM.L_SHOULDER]: { x: 0.4, y: 0.25 },
    [LM.R_SHOULDER]: { x: 0.6, y: 0.25 },
  });
  renderer.update(currentState.frame, 16, currentState);

  const context = makeContext();
  renderer.draw(context, 540, 960, currentState);
  assert.ok(context.calls.stroke > 0);
  assert.ok(context.calls.fillText > 0);
});

test('gesture effects honor their toggles and clear resets trails and particles', () => {
  const renderer = new EffectsRenderer();
  const currentState = state();

  assert.equal(renderer.trigger('jump', { x: 0.5, y: 0.8 }, currentState), true);
  assert.ok(renderer.particles.length > 0);
  currentState.toggles.heart = false;
  assert.equal(renderer.trigger('heart', { x: 0.5, y: 0.3 }, currentState), false);

  renderer.update(makeFrame(1, { [LM.L_WRIST]: { x: 0.3, y: 0.4 } }), 16, currentState);
  assert.ok(renderer.trails.size > 0);
  renderer.clear();
  assert.equal(renderer.particles.length, 0);
  assert.equal(renderer.trails.size, 0);
});

test('particle count stays within the configured performance limit', () => {
  const renderer = new EffectsRenderer({ maxParticles: 5 });
  const currentState = state();
  renderer.update(makeFrame(1, {
    [LM.L_WRIST]: { x: 0.3, y: 0.4 },
    [LM.R_WRIST]: { x: 0.7, y: 0.4 },
  }), 16, currentState);
  renderer.trigger('jump', { x: 0.5, y: 0.8 }, currentState);
  assert.ok(renderer.particles.length <= 5);
});
