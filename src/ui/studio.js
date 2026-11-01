import { CameraError, CameraManager } from '../camera/CameraManager.js';
import { PoseTrackingEngine } from '../../PoseTrackingEngine.js';
import { EffectsRenderer } from '../effects/EffectsRenderer.js';
import { ArchiveStore } from '../gallery/ArchiveStore.js';
import { FILTERS } from '../../filters.js';
import { MirrorPipeline, Recorder } from '../../MirrorPipeline.js';
import { saveRecording } from './saveRecording.js';

const $ = selector => document.querySelector(selector);
const root = document.documentElement;
const canvas = $('#stage');
const video = $('#source');
const slot = $('#slot');
const saveStatus = $('#saveStatus');
const cards = $('#cards');
const errorMessage = $('#cameraError') || (() => {
  const element = document.createElement('p');
  element.id = 'cameraError';
  element.className = 'fine';
  element.setAttribute('role', 'status');
  element.hidden = true;
  slot.append(element);
  return element;
})();
const camera = new CameraManager({ video });
const archive = new ArchiveStore();

let tracker = null;
let pipeline = null;
let recorder = null;
let recordingUrl = null;
let recordingBlob = null;
let currentArchiveId = null;
let currentArchivePromise = null;
let saveTarget = null;
let archiveExpiryTimer = null;
const archiveUrls = new Map();
let countdownActive = false;
let countdownGeneration = 0;
let elapsedTimer = null;
let recordingStartedAt = 0;
let elapsedBeforePause = 0;

const filterButtons = Object.entries(FILTERS).map(([key, filter], index) => {
  const button = document.createElement('button');
  button.className = `th t-${key}${index === 0 ? ' on' : ''}`;
  button.dataset.filter = key;
  button.innerHTML = `<s>${filter.glyph || '○'}</s><b>${filter.label}</b>`;
  $('#filters').append(button);
  return button;
});

for (const button of filterButtons) {
  button.addEventListener('click', () => {
    filterButtons.forEach(item => item.classList.toggle('on', item === button));
    pipeline?.set({ filter: button.dataset.filter });
    $('#cFilter').lastChild.textContent = `filter: ${FILTERS[button.dataset.filter].label.toLowerCase()}`;
  });
}

const effectOptions = [
  ['sparkle', 'Sparkle trails'],
  ['glow', 'Full-body glow'],
  ['butterfly', 'Butterflies from hands'],
  ['jump', 'Jump starburst'],
  ['spin', 'Spin vortex'],
  ['heart', 'Heart gesture'],
  ['trails', 'Neon motion trails'],
];
const effectInputs = effectOptions.map(([key, label]) => {
  const row = document.createElement('label');
  row.className = 'row';
  row.innerHTML = `<span>${label}</span><input class="sw fxs" type="checkbox" checked aria-label="${label}">`;
  const input = row.querySelector('input');
  input.addEventListener('change', () => {
    pipeline?.toggle(key, input.checked);
    updateEffectsControl();
  });
  $('#fxList').append(row);
  return input;
});
const allEffectsInput = $('#all');
allEffectsInput.addEventListener('change', () => {
  const enabled = allEffectsInput.checked;
  effectInputs.forEach(input => {
    input.checked = enabled;
  });
  effectOptions.forEach(([key]) => pipeline?.toggle(key, enabled));
  updateEffectsControl();
});
setChip('#cFx', 'effects: on', 'ok');
setChip('#hRec', '00:00');

if (matchMedia('(max-width:899px)').matches) {
  document.querySelectorAll('aside details').forEach((details, index) => {
    if (index) details.removeAttribute('open');
  });
}

function setChip(id, label, status = '') {
  const chip = $(id);
  chip.lastChild.textContent = label;
  chip.classList.toggle('ok', status === 'ok');
  chip.classList.toggle('live', status === 'live');
}

function updateEffectsControl() {
  const enabled = effectInputs.filter(input => input.checked).length;
  allEffectsInput.checked = enabled === effectInputs.length;
  allEffectsInput.indeterminate = enabled > 0 && enabled < effectInputs.length;
  pipeline?.set({ effectsOn: enabled > 0 });
  setChip('#cFx', enabled ? `effects: ${enabled}/7` : 'effects: off', enabled ? 'ok' : '');
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function updateArchiveUsage() {
  if (!navigator.storage?.estimate) {
    $('#usage').textContent = 'Browser storage estimate is not available.';
    return;
  }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const used = Number.isFinite(usage) ? formatBytes(usage) : 'unknown';
    const available = Number.isFinite(quota) ? formatBytes(quota) : 'unknown';
    $('#usage').textContent = `Browser storage used: ${used} of about ${available}`;
  } catch (error) {
    $('#usage').textContent = `Could not estimate browser storage: ${error.message}`;
  }
}

function revokeArchiveUrls() {
  for (const url of archiveUrls.values()) URL.revokeObjectURL(url);
  archiveUrls.clear();
}

function scheduleArchiveExpiry(recordings) {
  clearTimeout(archiveExpiryTimer);
  if (!recordings.length) return;
  const nextExpiry = Math.min(...recordings.map(recording => recording.expiresAt));
  archiveExpiryTimer = setTimeout(async () => {
    try {
      const removed = await archive.purgeExpired();
      if (removed) showSaveStatus(`${removed} expired cached video${removed === 1 ? '' : 's'} deleted.`);
      await refreshArchive();
    } catch (error) {
      showSaveStatus(`Could not clean up expired cached videos: ${error.message}`);
    }
  }, Math.max(0, nextExpiry - Date.now()));
}

async function refreshArchive() {
  const recordings = await archive.list();
  scheduleArchiveExpiry(recordings);
  revokeArchiveUrls();
  cards.replaceChildren();
  if (!recordings.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.gridColumn = '1/-1';
    empty.textContent = 'No cached recordings. New recordings stay here for up to 7 days unless you save them first.';
    cards.append(empty);
    await updateArchiveUsage();
    return;
  }

  for (const recording of recordings) {
    const card = document.createElement('article');
    card.className = 'card';
    const preview = document.createElement('video');
    preview.className = 'v';
    preview.controls = true;
    preview.playsInline = true;
    const url = URL.createObjectURL(recording.blob);
    archiveUrls.set(recording.id, url);
    preview.src = url;

    const metadata = document.createElement('div');
    metadata.className = 'm';
    const title = document.createElement('input');
    title.value = recording.title;
    title.setAttribute('aria-label', 'Recording title');
    title.addEventListener('change', async () => {
      try {
        await archive.rename(recording.id, title.value);
        title.value = title.value.trim();
      } catch (error) {
        showSaveStatus(`Could not rename the cached video: ${error.message}`);
        title.value = recording.title;
      }
    });

    const info = document.createElement('span');
    const created = new Date(recording.createdAt).toLocaleString();
    info.textContent = `${created} · ${formatBytes(recording.blob.size)} · expires ${new Date(recording.expiresAt).toLocaleString()}`;
    const actions = document.createElement('div');
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = 'SAVE VIDEO';
    saveButton.addEventListener('click', () => requestSave(recording.blob, url, recording.id));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'DELETE';
    deleteButton.addEventListener('click', async () => {
      try {
        await archive.delete(recording.id);
        await refreshArchive();
      } catch (error) {
        showSaveStatus(`Could not delete the cached video: ${error.message}`);
      }
    });
    actions.append(saveButton, document.createTextNode(' '), deleteButton);
    metadata.append(title, info, actions);
    card.append(preview, metadata);
    cards.append(card);
  }
  await updateArchiveUsage();
}

function showSaveStatus(message) {
  saveStatus.textContent = message;
  saveStatus.hidden = false;
}

async function cacheRecording(blob) {
  try {
    const recording = await archive.save(blob);
    currentArchiveId = recording.id;
    await refreshArchive();
    showSaveStatus('A temporary copy is cached in this browser for up to 7 days. Save it before then to keep a separate file.');
  } catch (error) {
    currentArchiveId = null;
    showSaveStatus(`Could not cache this video in the browser: ${error.message} It is available only until you leave this page, so save it now.`);
  } finally {
    currentArchivePromise = null;
  }
}

void (async () => {
  try {
    await archive.purgeExpired();
    await refreshArchive();
  } catch (error) {
    $('#usage').textContent = `Could not load the temporary video archive: ${error.message}`;
    showSaveStatus(`Temporary video caching is unavailable: ${error.message}`);
  }
})();

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function updateRecordingTime() {
  setChip('#hRec', formatTime(elapsedBeforePause + performance.now() - recordingStartedAt), 'live');
}

camera.on('state', ({ state }) => {
  const labels = { idle: 'camera: off', requesting: 'camera: requesting', ready: 'camera: on', error: 'camera: error' };
  setChip('#cCam', labels[state] || `camera: ${state}`, state === 'ready' ? 'ok' : '');
  $('#hCam').textContent = state === 'ready' ? 'CAMERA ON' : state === 'requesting' ? 'CAMERA STARTING' : 'CAMERA OFF';
  if (state === 'ready') slot.hidden = true;
  if (state === 'idle' || state === 'error') slot.hidden = false;
});

camera.on('error', error => showError(error.message));

$('#theme').addEventListener('click', event => {
  const theme = root.dataset.theme === 'cyber' ? 'luxe' : 'cyber';
  root.dataset.theme = theme;
  pipeline?.set({ theme });
  event.currentTarget.textContent = `THEME: PINK ${theme.toUpperCase()}`;
  setChip('#cTheme', `theme: pink ${theme}`);
});

$('#int').addEventListener('input', event => {
  const intensity = Number(event.currentTarget.value) / 100;
  $('#intO').textContent = event.currentTarget.value;
  pipeline?.set({ intensity });
});

$('#skeletonDebug').addEventListener('change', event => pipeline?.set({ debug: event.currentTarget.checked }));
$('#low').addEventListener('change', event => pipeline?.set({ lowPerf: event.currentTarget.checked }));

$('#act').addEventListener('click', async () => {
  $('#act').disabled = true;
  errorMessage.hidden = true;
  try {
    await camera.start();
    tracker = new PoseTrackingEngine();
    tracker.on('loading', ({ stage }) => {
      $('#status').textContent = `Tracking: loading ${stage}`;
      setChip('#cTrack', `tracking: loading ${stage}`);
    });
    tracker.on('ready', ({ delegate }) => {
      $('#status').textContent = `Tracking: ready (${delegate})`;
      setChip('#cTrack', 'tracking: ready', 'ok');
    });
    tracker.on('found', () => {
      $('#status').textContent = 'Tracking: person found';
      setChip('#cTrack', 'tracking: person found', 'ok');
    });
    tracker.on('lost', () => {
      $('#status').textContent = 'Tracking: person left the frame';
      setChip('#cTrack', 'tracking: person left frame');
    });
    tracker.on('error', error => {
      $('#status').textContent = 'Tracking: unavailable';
      setChip('#cTrack', 'tracking: unavailable');
      showError(`Camera is active, but pose tracking could not start: ${error.message} Add the local pose model at public/models/pose_landmarker_lite.task and reload.`);
    });

    const effects = new EffectsRenderer({ video });
    pipeline = new MirrorPipeline({ video, canvas, tracker, effects });
    effectOptions.forEach(([key], index) => pipeline.toggle(key, effectInputs[index].checked));
    pipeline.start();
    $('#recordStatus').textContent = 'Camera is on. Starting your recording after the 3-second countdown.';
    await startRecording();
    if (!pipeline?.running) return;
    try {
      await tracker.init();
      tracker.start(video);
    } catch (error) {
      $('#status').textContent = 'Tracking: unavailable';
      setChip('#cTrack', 'tracking: unavailable');
    }
  } catch (error) {
    showError(error instanceof CameraError ? error.message : `Could not activate the mirror: ${error.message}`);
    $('#act').disabled = false;
  }
});

async function stopCamera() {
  ++countdownGeneration;
  countdownActive = false;
  $('#cd').classList.remove('show');
  $('#rec').disabled = false;
  if (!recorder || recorder.rec?.state === 'inactive') {
    $('#recordStatus').textContent = 'Camera and recording are off.';
  }
  if (recorder?.rec?.state !== 'inactive' && recorder?.rec) {
    clearInterval(elapsedTimer);
    try {
      const blob = await recorder.stop();
      if (blob?.size) showRecording(blob);
    } catch (error) {
      showError(`Could not finish recording: ${error.message}`);
    }
  }
  pipeline?.stop();
  pipeline = null;
  tracker?.dispose();
  tracker = null;
  await camera.stop();
  $('#status').textContent = 'Tracking: idle';
  setChip('#cTrack', 'tracking: idle');
  $('#act').disabled = false;
}

$('#stopcam').addEventListener('click', stopCamera);
$('#flip').addEventListener('click', async () => {
  try {
    await camera.flip();
  } catch (error) {
    showError(error.message);
  }
});

$('#res').innerHTML = '<option value="1280x720">720p</option><option value="1920x1080">1080p</option><option value="640x480">480p</option>';
$('#res').addEventListener('change', async event => {
  const [width, height] = event.currentTarget.value.split('x').map(Number);
  try {
    await camera.setResolution(width, height);
  } catch (error) {
    showError(error.message);
  }
});

$('#full').addEventListener('click', async () => {
  try {
    await $('.frame').requestFullscreen();
  } catch (error) {
    showError(`Could not enter fullscreen: ${error.message}`);
  }
});

function clearRecordingPreview() {
  $('#preview').pause();
  $('#preview').removeAttribute('src');
  $('#preview').hidden = true;
  saveStatus.textContent = '';
  saveStatus.hidden = true;
  $('#dl').disabled = true;
  $('#retake').disabled = true;
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = null;
  recordingBlob = null;
  currentArchiveId = null;
  currentArchivePromise = null;
}

async function startRecording() {
  if (!pipeline?.running || countdownActive || ['recording', 'paused'].includes(recorder?.rec?.state)) return;
  const mimeType = Recorder.mime();
  if (!mimeType) {
    showError('Recording is not supported in this browser (no compatible MediaRecorder codec).');
    return false;
  }
  clearRecordingPreview();
  const generation = ++countdownGeneration;
  countdownActive = true;
  $('#rec').disabled = true;
  $('#recordStatus').textContent = 'Recording will start after the countdown.';
  try {
    await new Recorder(canvas).countdown(3, value => {
      const countdown = $('#cd');
      countdown.textContent = value || '';
      countdown.classList.toggle('show', value > 0);
    });
    if (generation !== countdownGeneration || !pipeline?.running) return;
    recorder = new Recorder(canvas);
    recorder.start();
    recordingStartedAt = performance.now();
    $('#recordStatus').textContent = 'Recording is on. Press STOP RECORDING to finish.';
    $('#pause').disabled = false;
    $('#stop').disabled = false;
    elapsedBeforePause = 0;
    setChip('#hRec', '00:00', 'live');
    elapsedTimer = setInterval(updateRecordingTime, 250);
    return true;
  } catch (error) {
    if (generation === countdownGeneration) {
      showError(`Could not start recording: ${error.message}`);
      $('#recordStatus').textContent = 'Recording did not start. Press RECORD to try again.';
      $('#rec').disabled = false;
    }
    return false;
  } finally {
    if (generation === countdownGeneration) {
      $('#cd').classList.remove('show');
      countdownActive = false;
    }
  }
}

$('#rec').addEventListener('click', startRecording);

$('#pause').addEventListener('click', () => {
  if (!recorder?.rec) return;
  if (recorder.rec.state === 'recording') {
    recorder.pause();
    $('#pause').textContent = 'RESUME';
    elapsedBeforePause += performance.now() - recordingStartedAt;
    clearInterval(elapsedTimer);
  } else if (recorder.rec.state === 'paused') {
    recorder.resume();
    $('#pause').textContent = 'PAUSE';
    recordingStartedAt = performance.now();
    elapsedTimer = setInterval(updateRecordingTime, 250);
  }
});

function showRecording(blob) {
  if (!blob?.size) throw new Error('The recording is empty.');
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingBlob = blob;
  recordingUrl = URL.createObjectURL(blob);
  $('#preview').src = recordingUrl;
  $('#preview').load();
  $('#preview').hidden = false;
  $('#dl').disabled = false;
  $('#retake').disabled = false;
  $('#rec').disabled = false;
  $('#pause').disabled = true;
  $('#stop').disabled = true;
  $('#pause').textContent = 'PAUSE';
  $('#recordStatus').textContent = 'Recording stopped. Preview it, then choose SAVE VIDEO if you want to keep a separate file.';
  setChip('#hRec', 'REVIEW', '');
  currentArchivePromise = cacheRecording(blob);
}

$('#stop').addEventListener('click', async () => {
  if (!recorder) return;
  clearInterval(elapsedTimer);
  try {
    const blob = await recorder.stop();
    showRecording(blob);
  } catch (error) {
    showError(`Could not finish recording: ${error.message}`);
    $('#recordStatus').textContent = 'Could not finish recording. Press RECORD to try again.';
  }
});

$('#dl').addEventListener('click', async () => {
  if (!recordingBlob || !recordingUrl) return;
  if (currentArchivePromise) await currentArchivePromise;
  saveStatus.hidden = true;
  requestSave(recordingBlob, recordingUrl, currentArchiveId);
});

function requestSave(blob, objectUrl, archiveId) {
  saveTarget = { blob, objectUrl, archiveId };
  $('#saveDialog').showModal();
}

$('#cancelSave').addEventListener('click', () => $('#saveDialog').close());

$('#confirmSave').addEventListener('click', async () => {
  const target = saveTarget;
  saveTarget = null;
  if (!target) {
    $('#saveDialog').close();
    return;
  }
  $('#saveDialog').close();
  $('#dl').disabled = true;
  try {
    const result = await saveRecording(target.blob, { objectUrl: target.objectUrl });
    if (result.status === 'downloaded') {
      saveStatus.textContent = 'The video was sent to your browser downloads. Check its download prompt or Downloads folder; adding it to Gallery depends on your device.';
      saveStatus.hidden = false;
    } else if (result.status === 'saved') {
      saveStatus.textContent = 'Video saved to the location you selected.';
      saveStatus.hidden = false;
    }
    if (result.status === 'saved' || result.status === 'downloaded') {
      try {
        if (target.archiveId) await archive.delete(target.archiveId);
        if (target.archiveId === currentArchiveId) currentArchiveId = null;
        await refreshArchive();
      } catch (error) {
        showSaveStatus(`Video saved, but its temporary browser copy could not be removed yet: ${error.message} It will expire automatically after 7 days.`);
      }
    } else {
      showSaveStatus('Save was cancelled. The temporary copy remains in this browser until it expires in 7 days.');
    }
  } catch (error) {
    saveStatus.textContent = `Could not save the video: ${error.message}`;
    saveStatus.hidden = false;
  } finally {
    $('#dl').disabled = false;
  }
});

$('#preview').addEventListener('error', () => {
  const mediaError = $('#preview').error;
  saveStatus.textContent = `This browser could not open the recorded video${mediaError?.message ? `: ${mediaError.message}` : '.'} Try recording again.`;
  saveStatus.hidden = false;
});

$('#retake').addEventListener('click', () => {
  clearRecordingPreview();
  recorder = null;
  $('#rec').disabled = false;
  $('#pause').textContent = 'PAUSE';
  elapsedBeforePause = 0;
  $('#recordStatus').textContent = pipeline?.running
    ? 'Recording is off. Press RECORD when you are ready.'
    : 'Press ACTIVATE MIRROR to start the mirror and first recording.';
  setChip('#hRec', '00:00');
});

window.addEventListener('pagehide', () => {
  clearInterval(elapsedTimer);
  clearTimeout(archiveExpiryTimer);
  pipeline?.stop();
  tracker?.dispose();
  void camera.stop();
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  revokeArchiveUrls();
  void archive.close();
});
