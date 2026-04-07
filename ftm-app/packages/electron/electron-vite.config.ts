import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/electron',
      lib: {
        entry: 'src/main.ts',
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: 'src/preload.ts',
      },
    },
  },
  renderer: {
    root: 'src/ui',
    build: {
      outDir: 'dist/ui',
      rollupOptions: {
        input: 'src/ui/index.html',
      },
    },
    plugins: [svelte()],
  },
});
