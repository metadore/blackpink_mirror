const DEFAULT_RESOLUTION = { width: 1280, height: 720 };

const ERROR_MESSAGES = {
  denied: 'Camera permission was denied. Allow camera access in your browser settings and try again.',
  unavailable: 'No camera was found. Connect a camera and try again.',
  inUse: 'The camera could not be started. It may already be in use by another app.',
  unsupported: 'Camera access is not available in this browser or page context. On a phone, open this app over HTTPS; localhost works only on the device running the app.',
  unsupportedResolution: 'The camera does not support the requested resolution.',
  playback: 'The camera opened, but its preview could not be started.',
  ended: 'The camera stopped unexpectedly. Check the camera connection and try again.',
  unknown: 'The camera could not be started. Try again.',
};

export class CameraError extends Error {
  constructor(code, message = ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CameraError';
    this.code = code;
  }
}

function cameraErrorFrom(error, phase = 'request') {
  if (error instanceof CameraError) return error;

  const name = error?.name;
  let code = 'unknown';
  if (phase === 'preview' && name === 'NotAllowedError') code = 'playback';
  else if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') code = 'denied';
  else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') code = 'unavailable';
  else if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') code = 'inUse';
  else if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') code = 'unsupportedResolution';
  else if (name === 'TypeError') code = 'unsupported';

  return new CameraError(code, undefined, error);
}

export class CameraManager {
  constructor({ video, resolution = DEFAULT_RESOLUTION, facingMode = 'user' } = {}) {
    if (!video) throw new TypeError('CameraManager requires a video element.');
    this.video = video;
    this.resolution = this.#validateResolution(resolution);
    this.facingMode = this.#validateFacingMode(facingMode);
    this.stream = null;
    this.state = 'idle';
    this.listeners = new Map();
    this.generation = 0;
    this.startPromise = null;
    this.trackCleanup = null;
  }

  on(event, listener) {
    if (typeof listener !== 'function') throw new TypeError('Camera event listener must be a function.');
    let listeners = this.listeners.get(event);
    if (!listeners) this.listeners.set(event, (listeners = new Set()));
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async start() {
    if (this.stream?.getVideoTracks().some(track => track.readyState === 'live')) return this.stream;
    if (this.stream) this.#releaseStream(this.stream);
    if (this.startPromise) return this.startPromise;

    const generation = ++this.generation;
    const attempt = this.#start(generation);
    this.startPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.startPromise === attempt) this.startPromise = null;
    }
  }

  async #start(generation) {
    this.#setState('requesting');
    let stream;
    try {
      const mediaDevices = globalThis.navigator?.mediaDevices;
      if (!mediaDevices?.getUserMedia) throw new CameraError('unsupported');

      stream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: this.facingMode },
          width: { ideal: this.resolution.width },
          height: { ideal: this.resolution.height },
        },
      });

      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        throw new CameraError('cancelled', 'Camera start was cancelled.');
      }

      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();

      if (generation !== this.generation) {
        this.#releaseStream(stream);
        throw new CameraError('cancelled', 'Camera start was cancelled.');
      }

      this.#watchTrack(stream, generation);
      this.#setState('ready', { stream });
      return stream;
    } catch (error) {
      if (stream && this.stream === stream) this.#releaseStream(stream);
      else if (stream && generation !== this.generation) stream.getTracks().forEach(track => track.stop());

      if (generation !== this.generation) throw new CameraError('cancelled', 'Camera start was cancelled.', error);

      const cameraError = cameraErrorFrom(error, stream ? 'preview' : 'request');
      this.#setState('error', { error: cameraError });
      this.#emit('error', cameraError);
      throw cameraError;
    }
  }

  async stop() {
    ++this.generation;
    const stream = this.stream;
    if (stream) this.#releaseStream(stream);
    this.#setState('idle');
  }

  async flip() {
    return this.setFacingMode(this.facingMode === 'user' ? 'environment' : 'user');
  }

  async setFacingMode(facingMode) {
    const nextFacingMode = this.#validateFacingMode(facingMode);
    if (nextFacingMode === this.facingMode) return this.stream;

    const pendingStart = this.startPromise;
    const restart = Boolean(this.stream) || this.state === 'requesting';
    await this.stop();
    this.facingMode = nextFacingMode;
    this.#emit('facingmode', { facingMode: this.facingMode });
    if (restart && pendingStart) {
      try {
        await pendingStart;
      } catch (error) {
        if (!(error instanceof CameraError) || error.code !== 'cancelled') throw error;
      }
    }
    return restart ? this.start() : null;
  }

  async setResolution(width, height) {
    const nextResolution = this.#validateResolution({ width, height });
    const track = this.stream?.getVideoTracks()[0];

    if (track) {
      try {
        await track.applyConstraints({
          width: { ideal: nextResolution.width },
          height: { ideal: nextResolution.height },
        });
      } catch (error) {
        const cameraError = cameraErrorFrom(error);
        this.#emit('error', cameraError);
        throw cameraError;
      }
    }

    this.resolution = nextResolution;
    this.#emit('resolution', { ...nextResolution, settings: track?.getSettings?.() || null });
    return track?.getSettings?.() || { ...nextResolution };
  }

  #watchTrack(stream, generation) {
    const track = stream.getVideoTracks()[0];
    if (!track?.addEventListener) return;

    const onEnded = () => {
      if (this.stream !== stream || generation !== this.generation) return;
      this.#releaseStream(stream, false);
      const error = new CameraError('ended');
      this.#setState('error', { error });
      this.#emit('error', error);
    };
    track.addEventListener('ended', onEnded);
    this.trackCleanup = () => track.removeEventListener('ended', onEnded);
  }

  #releaseStream(stream, stopTracks = true) {
    if (this.trackCleanup) this.trackCleanup();
    this.trackCleanup = null;
    if (this.stream === stream) this.stream = null;

    if (this.video.srcObject === stream) {
      this.video.pause?.();
      this.video.srcObject = null;
    }
    if (stopTracks) stream.getTracks().forEach(track => track.stop());
  }

  #setState(state, details = {}) {
    this.state = state;
    this.#emit('state', { state, ...details });
  }

  #emit(event, data) {
    for (const listener of this.listeners.get(event) || []) listener(data);
  }

  #validateFacingMode(facingMode) {
    if (facingMode !== 'user' && facingMode !== 'environment') {
      throw new TypeError('Facing mode must be "user" or "environment".');
    }
    return facingMode;
  }

  #validateResolution(resolution) {
    const { width, height } = resolution || {};
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new TypeError('Camera resolution must use positive integer width and height values.');
    }
    return { width, height };
  }
}
