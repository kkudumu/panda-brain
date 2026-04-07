import { MachineRenderer, type RenderFrame, type RendererConfig } from './renderer-base.js';
import { ASCII_FRAMES } from './ascii-frames.js';
import type { MachineState } from '@ftm/daemon';

export class AsciiRenderer extends MachineRenderer {
  constructor(config?: Partial<RendererConfig>) {
    super({ mode: 'ascii', ...config });
  }

  render(): RenderFrame {
    const frames = ASCII_FRAMES[this.state] ?? ASCII_FRAMES.idle;
    const content = frames[this.frame % frames.length];
    // Calculate width from longest line
    const lines = content.split('\n');
    const width = Math.max(...lines.map(l => l.length));
    return { content, width, height: lines.length };
  }

  getFrameCount(state: MachineState): number {
    return (ASCII_FRAMES[state] ?? ASCII_FRAMES.idle).length;
  }

  destroy(): void {
    this.stop();
  }
}
