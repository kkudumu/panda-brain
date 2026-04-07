import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@daemon': path.resolve(__dirname, 'src/daemon'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
});
