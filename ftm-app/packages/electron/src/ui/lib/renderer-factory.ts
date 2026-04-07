import type { RendererConfig } from './renderer-base.js';
import { AsciiRenderer } from './ascii-renderer.js';
import { CanvasRenderer } from './canvas-renderer.js';
import type { MachineRenderer } from './renderer-base.js';

export function createRenderer(config: RendererConfig): MachineRenderer {
  switch (config.mode) {
    case 'ascii':
      return new AsciiRenderer(config);
    case 'canvas':
      return new CanvasRenderer(config);
    case 'auto':
      // Auto-detect: use canvas if we're in a browser with canvas support
      if (typeof document !== 'undefined' && document.createElement('canvas').getContext) {
        return new CanvasRenderer(config);
      }
      return new AsciiRenderer(config);
    default:
      return new AsciiRenderer(config);
  }
}
