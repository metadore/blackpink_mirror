import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(projectRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const destination = resolve(projectRoot, 'public', 'mediapipe', 'wasm');

if (!existsSync(source)) {
  throw new Error('MediaPipe WASM files are missing. Run npm install before starting or building the app.');
}

mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true, force: true });
console.log('Copied MediaPipe WASM assets to public/mediapipe/wasm/.');
