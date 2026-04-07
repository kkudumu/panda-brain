import { MachineRenderer, type RenderFrame, type RendererConfig } from './renderer-base.js';
import type { MachineState } from '../../shared/types.js';

// Sprite sheet atlas definition
export interface SpriteAtlas {
  image: HTMLImageElement;
  frameWidth: number;
  frameHeight: number;
  states: Record<MachineState, {
    row: number;       // Which row in the atlas
    frameCount: number; // Number of frames for this state
  }>;
}

// Organ definitions for the machine's visual identity
export interface MachineOrgan {
  name: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  activeGlow: string;
}

export const MACHINE_ORGANS: MachineOrgan[] = [
  { name: 'intake', label: 'Intake Maw', x: 50, y: 20, width: 200, height: 60, color: '#1a3a1a', activeGlow: '#00ff88' },
  { name: 'memory', label: 'Memory Furnace', x: 20, y: 100, width: 120, height: 80, color: '#3a1a1a', activeGlow: '#ff8800' },
  { name: 'planner', label: 'Planner Chamber', x: 160, y: 100, width: 120, height: 80, color: '#1a1a3a', activeGlow: '#8888ff' },
  { name: 'executor', label: 'Execution Arms', x: 20, y: 200, width: 260, height: 60, color: '#1a3a3a', activeGlow: '#00ffff' },
  { name: 'output', label: 'Output Forge', x: 50, y: 280, width: 200, height: 60, color: '#3a3a1a', activeGlow: '#ffff00' },
];

export class CanvasRenderer extends MachineRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private atlas: SpriteAtlas | null = null;
  private activeOrgans: Set<string> = new Set();
  private width: number;
  private height: number;

  constructor(config?: Partial<RendererConfig>) {
    super({ mode: 'canvas', ...config });
    this.width = config?.width ?? 300;
    this.height = config?.height ?? 360;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d')!;
  }

  async loadAtlas(src: string, frameWidth: number, frameHeight: number, states: SpriteAtlas['states']): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.atlas = { image: img, frameWidth, frameHeight, states };
        resolve();
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  render(): RenderFrame {
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (this.atlas) {
      this.renderSpriteFrame();
    } else {
      this.renderFallback();
    }

    return {
      content: this.canvas,
      width: this.width,
      height: this.height,
    };
  }

  private renderSpriteFrame(): void {
    if (!this.atlas) return;
    const stateConfig = this.atlas.states[this.state];
    if (!stateConfig) return;

    const sx = this.frame * this.atlas.frameWidth;
    const sy = stateConfig.row * this.atlas.frameHeight;

    this.ctx.drawImage(
      this.atlas.image,
      sx, sy, this.atlas.frameWidth, this.atlas.frameHeight,
      0, 0, this.width, this.height
    );
  }

  private renderFallback(): void {
    // Draw machine structure without sprite sheet
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Draw organs
    for (const organ of MACHINE_ORGANS) {
      const isActive = this.activeOrgans.has(organ.name);

      // Organ body
      this.ctx.fillStyle = isActive ? organ.activeGlow + '33' : organ.color;
      this.ctx.fillRect(organ.x, organ.y, organ.width, organ.height);

      // Organ border
      this.ctx.strokeStyle = isActive ? organ.activeGlow : '#333';
      this.ctx.lineWidth = isActive ? 2 : 1;
      this.ctx.strokeRect(organ.x, organ.y, organ.width, organ.height);

      // Organ label
      this.ctx.fillStyle = isActive ? organ.activeGlow : '#666';
      this.ctx.font = '10px monospace';
      this.ctx.fillText(organ.label, organ.x + 4, organ.y + organ.height - 4);

      // Active glow animation
      if (isActive) {
        const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
        this.ctx.strokeStyle = organ.activeGlow + Math.floor(pulse * 255).toString(16).padStart(2, '0');
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(organ.x - 2, organ.y - 2, organ.width + 4, organ.height + 4);
      }
    }

    // State label
    this.ctx.fillStyle = '#00ff88';
    this.ctx.font = 'bold 14px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(this.state.toUpperCase(), this.width / 2, this.height - 10);
    this.ctx.textAlign = 'start';
  }

  setActiveOrgan(name: string, active: boolean): void {
    if (active) {
      this.activeOrgans.add(name);
    } else {
      this.activeOrgans.delete(name);
    }
  }

  // Map machine state to active organs
  setState(state: MachineState): void {
    super.setState(state);
    this.activeOrgans.clear();

    switch (state) {
      case 'ingesting': this.setActiveOrgan('intake', true); break;
      case 'thinking':
        this.setActiveOrgan('memory', true);
        this.setActiveOrgan('planner', true);
        break;
      case 'executing':
        this.setActiveOrgan('executor', true);
        this.setActiveOrgan('output', true);
        break;
      case 'approving':
        this.setActiveOrgan('planner', true);
        break;
      case 'complete':
        this.setActiveOrgan('output', true);
        break;
      case 'error':
        MACHINE_ORGANS.forEach(o => this.setActiveOrgan(o.name, true));
        break;
    }
  }

  getFrameCount(state: MachineState): number {
    if (this.atlas && this.atlas.states[state]) {
      return this.atlas.states[state].frameCount;
    }
    return 4; // Default frame count for fallback rendering
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  destroy(): void {
    this.stop();
    this.atlas = null;
  }
}
