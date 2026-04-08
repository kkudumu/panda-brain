# Machine Animation System

## State Machine

States and their visual meaning:

| State | Visual | Color | FPS | Active Organs |
|-------|--------|-------|-----|---------------|
| idle | Subtle breathing, dots cycling | Dim green (#00ff8844) | 1 | None |
| ingesting | Content flowing into intake maw | Cyan (#00ffff) | 4 | Intake Maw |
| thinking | Gears turning in planner + memory | Yellow (#ffaa00) | 3 | Memory Furnace, Planner Chamber |
| executing | Pistons moving, progress bars | Bright green (#00ff88) | 8 | Execution Arms, Output Forge |
| approving | Pulsing alert, waiting | Magenta (#ff44ff) | 2 | Planner Chamber |
| complete | Celebration, checkmark | Green (#00ff88) | 2 | Output Forge |
| error | Red alert, warning symbols | Red (#ff4444) | 6 | All organs (alarm state) |

## Event-to-State Mapping

| Daemon Event | Machine State |
|-------------|---------------|
| task_submitted | ingesting |
| memory_retrieved | thinking |
| playbook_matched | thinking |
| plan_generated | approving (if needs approval) / thinking (if auto-approved) |
| plan_approved | executing |
| step_started | executing |
| step_completed | executing |
| tool_invoked | executing |
| guard_triggered | error (brief flash, then previous state) |
| task_completed | complete |
| error | error |
| (no active task) | idle |

## Renderer Architecture

Two renderers share the same state interface:

### AsciiRenderer (v1)
- Uses pre-defined ASCII art frame arrays from `ascii-frames.ts`
- Renders as `<pre>` elements with CSS color classes
- 2-4 frames per state, cycled at state-specific FPS
- Zero dependencies, works in any environment

### CanvasRenderer (v2)
- Supports PNG sprite sheet atlases OR procedural fallback
- Sprite atlas format: single PNG with states in rows, frames in columns
- Each frame is `frameWidth x frameHeight` pixels
- Machine has 5 "organs" that light up based on state
- Procedural fallback draws labeled organ boxes with glow effects

### Shared Interface

Both renderers extend `MachineRenderer` from `renderer-base.ts`:

```typescript
abstract class MachineRenderer {
  setState(state: MachineState): void
  advanceFrame(): void
  start(onFrame: (frame: RenderFrame) => void): void
  stop(): void
  abstract render(): RenderFrame
  abstract getFrameCount(state: MachineState): number
  abstract destroy(): void
}
```

Use `createRenderer(config)` from `renderer-factory.ts` to instantiate the right renderer based on config.

## Sprite Sheet Specification

For artists creating sprite sheets:

### Atlas Layout

```
Row 0: idle      (4 frames)
Row 1: ingesting (6 frames)
Row 2: thinking  (4 frames)
Row 3: executing (8 frames)
Row 4: approving (3 frames)
Row 5: complete  (4 frames)
Row 6: error     (4 frames)
```

### Frame Size

Default: 300x360 pixels per frame

### Machine Organs (visual elements)

1. **Intake Maw** (top, y=20) — where tasks flow in
2. **Memory Furnace** (left-middle, y=100) — where experiences burn
3. **Planner Chamber** (right-middle, y=100) — where plans crystallize
4. **Execution Arms** (center-bottom, y=200) — where work happens
5. **Output Forge** (bottom, y=280) — where results emerge

### Color Palette

- Background: #0a0a0a
- Inactive organ: dim respective color
- Active organ: bright color with glow effect
- Text: #e0e0e0
- Accent: #00ff88

### Organ Active Colors by State

| State | Active Organs | Glow Color |
|-------|--------------|------------|
| ingesting | Intake Maw | #00ff88 |
| thinking | Memory Furnace | #ff8800 |
| thinking | Planner Chamber | #8888ff |
| executing | Execution Arms | #00ffff |
| executing | Output Forge | #ffff00 |
| approving | Planner Chamber | #8888ff |
| complete | Output Forge | #ffff00 |
| error | All organs | respective colors (alarm) |

## Config Toggle

In `~/.ftm/config.yml`:

```yaml
ui:
  rendering: ascii    # 'ascii' | 'canvas' | 'auto'
  sprite_sheet: null  # path to custom PNG atlas
```

## Usage Example

```typescript
import { createRenderer } from './lib/renderer-factory.js';

// ASCII mode (default, no dependencies)
const renderer = createRenderer({ mode: 'ascii', fps: 4 });

// Canvas mode with procedural fallback
const renderer = createRenderer({ mode: 'canvas', width: 300, height: 360 });

// Canvas mode with custom sprite sheet
const canvasRenderer = createRenderer({ mode: 'canvas' }) as CanvasRenderer;
await canvasRenderer.loadAtlas('/assets/machine-atlas.png', 300, 360, {
  idle:      { row: 0, frameCount: 4 },
  ingesting: { row: 1, frameCount: 6 },
  thinking:  { row: 2, frameCount: 4 },
  executing: { row: 3, frameCount: 8 },
  approving: { row: 4, frameCount: 3 },
  complete:  { row: 5, frameCount: 4 },
  error:     { row: 6, frameCount: 4 },
});

// Auto-detect (canvas in browser, ascii in terminal)
const renderer = createRenderer({ mode: 'auto' });

renderer.setState('executing');
renderer.start((frame) => {
  // frame.content is string (ascii) or HTMLCanvasElement (canvas)
  updateDisplay(frame);
});
```
