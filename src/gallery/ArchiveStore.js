export const RECORDING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function isRecordingExpired(recording, now = Date.now()) {
  return now - recording.createdAt >= RECORDING_RETENTION_MS;
}

export class ArchiveStore {
  constructor({ indexedDB = globalThis.indexedDB } = {}) {
    if (!indexedDB) throw new Error('This browser does not support local video storage.');
    this.indexedDB = indexedDB;
    this.databasePromise = null;
  }

  async save(blob, title = 'Untitled dance') {
    if (!(blob instanceof Blob) || !blob.size) {
      throw new TypeError('Cannot cache an empty video recording.');
    }
    const now = Date.now();
    const recording = {
      id: globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`,
      title,
      blob,
      createdAt: now,
      expiresAt: now + RECORDING_RETENTION_MS,
    };
    await this.#request('readwrite', store => store.put(recording));
    return recording;
  }

  async list() {
    const recordings = await this.#request('readonly', store => store.getAll());
    return recordings.sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id) {
    return this.#request('readonly', store => store.get(id));
  }

  async rename(id, title) {
    const nextTitle = title.trim();
    if (!nextTitle) throw new TypeError('A recording title cannot be empty.');
    const recording = await this.get(id);
    if (!recording) return false;
    await this.#request('readwrite', store => store.put({ ...recording, title: nextTitle }));
    return true;
  }

  async delete(id) {
    await this.#request('readwrite', store => store.delete(id));
  }

  async purgeExpired(now = Date.now()) {
    const recordings = await this.list();
    const expired = recordings.filter(recording => isRecordingExpired(recording, now));
    await Promise.all(expired.map(recording => this.delete(recording.id)));
    return expired.length;
  }

  async close() {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }

  #open() {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open('blackpink-mirror-archive', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('recordings', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error || new Error('Could not open the local video archive.'));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error('The local video archive is busy in another tab. Close other mirror tabs and try again.'));
      };
    });
    return this.databasePromise;
  }

  async #request(mode, makeRequest) {
    const database = await this.#open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('recordings', mode);
      let request;
      try {
        request = makeRequest(transaction.objectStore('recordings'));
      } catch (error) {
        reject(error);
        return;
      }

      let result;
      if (request) {
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error || new Error('Local video archive operation failed.'));
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Local video archive transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Local video archive transaction was cancelled.'));
    });
  }
}
