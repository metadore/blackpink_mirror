import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Recorder } from '../../MirrorPipeline.js';
import { recordingFilename, saveRecording } from './saveRecording.js';

test('chooses a matching filename for each supported recording format', () => {
  assert.equal(recordingFilename(new Blob([], { type: 'video/webm' })), 'blackpink-mirror.webm');
  assert.equal(recordingFilename(new Blob([], { type: 'video/mp4' })), 'blackpink-mirror.mp4');
});

test('writes the recording through the browser save picker', async () => {
  const blob = new Blob(['video'], { type: 'video/webm' });
  let pickerOptions;
  let written;
  let closed = false;
  const result = await saveRecording(blob, {
    environment: {
      async showSaveFilePicker(options) {
        pickerOptions = options;
        return {
          async createWritable() {
            return {
              async write(value) { written = value; },
              async close() { closed = true; },
            };
          },
        };
      },
    },
  });

  assert.equal(result.status, 'saved');
  assert.equal(pickerOptions.suggestedName, 'blackpink-mirror.webm');
  assert.equal(written, blob);
  assert.equal(closed, true);
});

test('treats save-picker cancellation as a user decision', async () => {
  const result = await saveRecording(new Blob([], { type: 'video/mp4' }), {
    environment: {
      async showSaveFilePicker() {
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      },
    },
  });
  assert.equal(result.status, 'cancelled');
});

test('uses a browser download when no save picker is available', async () => {
  const actions = [];
  const link = {
    click() { actions.push('click'); },
    remove() { actions.push('remove'); },
  };
  const environment = {
    document: {
      body: { append() { actions.push('append'); } },
      createElement(tag) {
        assert.equal(tag, 'a');
        return link;
      },
    },
  };
  const result = await saveRecording(new Blob([], { type: 'video/webm' }), {
    environment,
    objectUrl: 'blob:recording',
  });

  assert.equal(link.href, 'blob:recording');
  assert.equal(link.download, 'blackpink-mirror.webm');
  assert.deepEqual(actions, ['append', 'click', 'remove']);
  assert.equal(result.status, 'downloaded');
});

test('prefers a codec the browser can both record and play', () => {
  const originals = {
    mediaRecorder: Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
  };
  class MockMediaRecorder {
    static isTypeSupported(type) { return type.startsWith('video/webm'); }
  }
  globalThis.MediaRecorder = MockMediaRecorder;
  globalThis.document = {
    createElement() {
      return { canPlayType: type => type.includes('vp8') ? 'probably' : '' };
    },
  };

  try {
    assert.equal(Recorder.mime(), 'video/webm;codecs=vp8');
  } finally {
    if (originals.mediaRecorder) Object.defineProperty(globalThis, 'MediaRecorder', originals.mediaRecorder);
    else delete globalThis.MediaRecorder;
    if (originals.document) Object.defineProperty(globalThis, 'document', originals.document);
    else delete globalThis.document;
  }
});

test('prefers playable MP4 for video-library compatibility', () => {
  const originals = {
    mediaRecorder: Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
  };
  class MockMediaRecorder {
    static isTypeSupported() { return true; }
  }
  globalThis.MediaRecorder = MockMediaRecorder;
  globalThis.document = {
    createElement() {
      return { canPlayType: type => type.includes('mp4') || type.includes('vp8') ? 'maybe' : '' };
    },
  };

  try {
    assert.equal(Recorder.mime(), 'video/mp4');
  } finally {
    if (originals.mediaRecorder) Object.defineProperty(globalThis, 'MediaRecorder', originals.mediaRecorder);
    else delete globalThis.MediaRecorder;
    if (originals.document) Object.defineProperty(globalThis, 'document', originals.document);
    else delete globalThis.document;
  }
});

test('finalizes recorder output with its playback codec and reports empty recordings', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  class MockMediaRecorder {
    static isTypeSupported(type) { return type.startsWith('video/webm'); }
    constructor() {
      this.state = 'inactive';
      this.mimeType = 'video/webm;codecs=vp8';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.ondataavailable({ data: new Blob(['frame'], { type: this.mimeType }) });
      this.state = 'inactive';
      this.onstop();
    }
  }
  globalThis.MediaRecorder = MockMediaRecorder;

  try {
    const recorder = new Recorder({ captureStream: () => ({}) });
    recorder.start();
    const blob = await recorder.stop();
    assert.equal(blob.type, 'video/webm;codecs=vp8');
    assert.equal(await blob.text(), 'frame');

    const emptyRecorder = new Recorder({ captureStream: () => ({}) });
    emptyRecorder.start();
    emptyRecorder.rec.chunks = [];
    emptyRecorder.chunks = [];
    emptyRecorder.rec.ondataavailable = () => {};
    await assert.rejects(emptyRecorder.stop(), /no video data/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'MediaRecorder', original);
    else delete globalThis.MediaRecorder;
  }
});
