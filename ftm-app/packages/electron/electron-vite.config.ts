import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: path.join(root, 'src/main.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: path.join(root, 'src/preload.ts'),
      },
    },
  },
  renderer: {
    root: path.join(root, 'src/ui'),
    build: {
      rollupOptions: {
        input: path.join(root, 'src/ui/index.html'),
      },
    },
    plugins: [svelte()],
    resolve: {
      alias: {
        '@ftm/daemon': path.join(root, '../daemon/src/shared/types.ts'),
      },
    },
  },
});
