import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/electron',
      lib: {
        entry: 'src/electron/main.ts',
      },
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
        '@daemon': path.resolve(__dirname, 'src/daemon'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: 'src/electron/preload.ts',
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
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
        '@ui': path.resolve(__dirname, 'src/ui'),
      },
    },
  },
});
