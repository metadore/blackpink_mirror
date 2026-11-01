import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  server: {
    watch: {
      ignored: ['**/public/models/*.task'],
    },
  },
  build: {
    rollupOptions: {
      input: [
        resolve(projectRoot, 'index.html'),
        resolve(projectRoot, 'BLACKPINK Mirror — studio design.html'),
        resolve(projectRoot, 'BLACKPINK.exe — the internet is pink.html'),
      ],
    },
  },
});
