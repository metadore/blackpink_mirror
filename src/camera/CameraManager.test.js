import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CameraError, CameraManager } from './CameraManager.js';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

class MockTrack extends EventTarget {
  constructor() {
    super();
    this.readyState = 'live';
    this.constraints = null;
    this.stopped = false;
  }
  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
  async applyConstraints(constraints) {
    this.constraints = constraints;
  }
  getSettings() {
    return { width: 1280, height: 720 };
  }
}

class MockStream {
  constructor(track = new MockTrack()) {
    this.track = track;
  }
  getTracks() {
    return [this.track];
  }
  getVideoTracks() {
    return [this.track];
  }
}

function installMediaDevices(getUserMedia) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia } },
  });
}

function makeVideo() {
  return {
    srcObject: null,
    plays: 0,
    pauses: 0,
    async play() {
      this.plays++;
    },
    pause() {
      this.pauses++;
    },
  };
}

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
});

test('starts a stream with requested constraints and releases it on stop', async () => {
  const stream = new MockStream();
  let constraints;
  installMediaDevices(async request => {
    constraints = request;
    return stream;
  });
  const video = makeVideo();
  const manager = new CameraManager({ video });
  const states = [];
  manager.on('state', event => states.push(event.state));

  assert.equal(await manager.start(), stream);
  assert.equal(video.srcObject, stream);
  assert.equal(video.plays, 1);
  assert.deepEqual(constraints, {
    audio: false,
    video: {
      facingMode: { ideal: 'user' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  assert.deepEqual(states, ['requesting', 'ready']);

  await manager.stop();
  assert.equal(video.srcObject, null);
  assert.equal(video.pauses, 1);
  assert.equal(stream.track.stopped, true);
  assert.equal(manager.state, 'idle');
});

test('maps permission failures to an explicit camera error state', async () => {
  installMediaDevices(async () => {
    throw Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
  });
  const manager = new CameraManager({ video: makeVideo() });
  const errors = [];
  manager.on('error', error => errors.push(error));

  await assert.rejects(manager.start(), error => {
    assert.ok(error instanceof CameraError);
    assert.equal(error.code, 'denied');
    return true;
  });
  assert.equal(manager.state, 'error');
  assert.equal(errors[0].code, 'denied');
});

test('flips the active camera and applies a new resolution', async () => {
  const streams = [new MockStream(), new MockStream()];
  const requests = [];
  installMediaDevices(async request => {
    requests.push(request);
    return streams[requests.length - 1];
  });
  const manager = new CameraManager({ video: makeVideo() });

  await manager.start();
  await manager.flip();
  assert.equal(manager.facingMode, 'environment');
  assert.deepEqual(requests[1].video.facingMode, { ideal: 'environment' });
  assert.equal(streams[0].track.stopped, true);

  const settings = await manager.setResolution(640, 480);
  assert.deepEqual(streams[1].track.constraints, {
    width: { ideal: 640 },
    height: { ideal: 480 },
  });
  assert.deepEqual(settings, { width: 1280, height: 720 });
  assert.deepEqual(manager.resolution, { width: 640, height: 480 });
});

test('stops a stream that resolves after startup was cancelled', async () => {
  let resolveRequest;
  installMediaDevices(() => new Promise(resolve => {
    resolveRequest = resolve;
  }));
  const video = makeVideo();
  const manager = new CameraManager({ video });
  const start = manager.start();
  await manager.stop();

  const stream = new MockStream();
  resolveRequest(stream);
  await assert.rejects(start, error => error.code === 'cancelled');
  assert.equal(stream.track.stopped, true);
  assert.equal(video.srcObject, null);
  assert.equal(manager.state, 'idle');
});
