import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRecordingExpired, RECORDING_RETENTION_MS } from './ArchiveStore.js';

test('expires uncopied recordings after seven days, but not before', () => {
  const createdAt = 1_000_000;
  const recording = { createdAt };

  assert.equal(isRecordingExpired(recording, createdAt + RECORDING_RETENTION_MS - 1), false);
  assert.equal(isRecordingExpired(recording, createdAt + RECORDING_RETENTION_MS), true);
});
