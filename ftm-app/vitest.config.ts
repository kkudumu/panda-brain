import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      // @ftm/daemon top-level (barrel)
      '@ftm/daemon': path.resolve(__dirname, 'packages/daemon/src/index.ts'),

      // @ftm/daemon subpath exports
      '@ftm/daemon/store': path.resolve(__dirname, 'packages/daemon/src/store.ts'),
      '@ftm/daemon/blackboard': path.resolve(__dirname, 'packages/daemon/src/blackboard.ts'),
      '@ftm/daemon/config': path.resolve(__dirname, 'packages/daemon/src/config.ts'),
      '@ftm/daemon/types': path.resolve(__dirname, 'packages/daemon/src/shared/types.ts'),
      '@ftm/daemon/adapters': path.resolve(__dirname, 'packages/daemon/src/adapters/registry.ts'),
      '@ftm/daemon/router': path.resolve(__dirname, 'packages/daemon/src/router.ts'),
      '@ftm/daemon/ooda': path.resolve(__dirname, 'packages/daemon/src/ooda.ts'),
      '@ftm/daemon/event-bus': path.resolve(__dirname, 'packages/daemon/src/event-bus.ts'),
      '@ftm/daemon/modules': path.resolve(__dirname, 'packages/daemon/src/modules/index.ts'),
      '@ftm/daemon/hooks': path.resolve(__dirname, 'packages/daemon/src/hooks/index.ts'),
      '@ftm/daemon/server': path.resolve(__dirname, 'packages/daemon/src/server.ts'),

      // Individual adapter files (used in adapter tests)
      '@ftm/daemon/adapters/base': path.resolve(__dirname, 'packages/daemon/src/adapters/base.ts'),
      '@ftm/daemon/adapters/claude': path.resolve(__dirname, 'packages/daemon/src/adapters/claude.ts'),
      '@ftm/daemon/adapters/codex': path.resolve(__dirname, 'packages/daemon/src/adapters/codex.ts'),
      '@ftm/daemon/adapters/gemini': path.resolve(__dirname, 'packages/daemon/src/adapters/gemini.ts'),
      '@ftm/daemon/adapters/ollama': path.resolve(__dirname, 'packages/daemon/src/adapters/ollama.ts'),

      // Individual module files (used in ooda/guard tests)
      '@ftm/daemon/modules/mind': path.resolve(__dirname, 'packages/daemon/src/modules/mind.ts'),
      '@ftm/daemon/modules/guard': path.resolve(__dirname, 'packages/daemon/src/modules/guard.ts'),

      // @ftm/mcp
      '@ftm/mcp/server': path.resolve(__dirname, 'packages/mcp/src/server.ts'),
    },
  },
});
