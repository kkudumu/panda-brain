import type { MachineState } from '@ftm/daemon';

export interface RendererConfig {
  mode: 'ascii' | 'canvas' | 'auto';
  fps?: number;
  width?: number;
  height?: number;
}

export interface RenderFrame {
  content: string | HTMLCanvasElement;
  width: number;
  height: number;
}

export abstract class MachineRenderer {
  protected state: MachineState = 'idle';
  protected frame: number = 0;
  protected fps: number;
  protected animationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(protected config: RendererConfig) {
    this.fps = config.fps ?? 4;
  }

  abstract render(): RenderFrame;
  abstract getFrameCount(state: MachineState): number;
  abstract destroy(): void;

  setState(state: MachineState): void {
    if (this.state !== state) {
      this.state = state;
      this.frame = 0;
    }
  }

  advanceFrame(): void {
    const count = this.getFrameCount(this.state);
    this.frame = (this.frame + 1) % count;
  }

  start(onFrame: (frame: RenderFrame) => void): void {
    this.stop();
    this.animationTimer = setInterval(() => {
      this.advanceFrame();
      onFrame(this.render());
    }, 1000 / this.fps);
  }

  stop(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }

  getState(): MachineState { return this.state; }
  getFrame(): number { return this.frame; }
}
