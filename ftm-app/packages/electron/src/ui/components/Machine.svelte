<script lang="ts">
  import { onDestroy } from 'svelte';
  import { daemonState } from '../lib/daemon-client.js';
  import { ASCII_FRAMES } from '../lib/ascii-frames.js';
  import {
    type MachineAnimState,
    getSubStateFromEvent,
    getFpsForState,
    getColorForState,
  } from '../lib/machine-states.js';
  import type { MachineState, FtmEvent } from '@ftm/daemon';

  // ── Known model names displayed in the header strip ──────────────────────
  const MODEL_NAMES = ['Claude', 'Codex', 'Gemini', 'Ollama'] as const;
  type ModelName = typeof MODEL_NAMES[number];

  // ── Svelte 5 rune state ───────────────────────────────────────────────────

  let animState = $state<MachineAnimState>({
    state: 'idle',
    frame: 0,
    activeModel: null,
    subState: null,
    fps: getFpsForState('idle'),
  });

  // True while a state-transition flash is active
  let flashing = $state(false);

  // ── Derived values ────────────────────────────────────────────────────────

  let currentFrame = $derived(
    ASCII_FRAMES[animState.state][
      animState.frame % ASCII_FRAMES[animState.state].length
    ]
  );

  let colorClass = $derived(getColorForState(animState.state));

  // ── Interval management ───────────────────────────────────────────────────

  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  function startInterval(fps: number) {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
    }
    const ms = Math.round(1000 / fps);
    intervalHandle = setInterval(() => {
      animState.frame = (animState.frame + 1) % ASCII_FRAMES[animState.state].length;
    }, ms);
  }

  // ── React to daemon state changes ─────────────────────────────────────────

  $effect(() => {
    const unsubscribe = daemonState.subscribe((ds) => {
      const newMachineState: MachineState = ds.machineState;
      const latestEvent: FtmEvent | undefined = ds.events[ds.events.length - 1];

      // Detect active model from the latest model_selected event
      let activeModel: string | null = animState.activeModel;
      if (latestEvent?.type === 'model_selected') {
        activeModel = (latestEvent.data.model as string) ?? null;
      }

      // Sub-state label from latest event
      const subState = latestEvent ? getSubStateFromEvent(latestEvent.type) : null;

      const stateChanged = newMachineState !== animState.state;

      if (stateChanged) {
        // Brief flash to signal transition
        flashing = true;
        setTimeout(() => { flashing = false; }, 180);

        const fps = getFpsForState(newMachineState);
        animState = {
          state: newMachineState,
          frame: 0,
          activeModel,
          subState,
          fps,
        };
        startInterval(fps);
      } else {
        // Update model and sub-state without resetting animation
        animState.activeModel = activeModel;
        animState.subState = subState;
      }
    });

    return unsubscribe;
  });

  // Kick off the initial interval once
  $effect(() => {
    startInterval(animState.fps);
    return () => {
      if (intervalHandle !== null) {
        clearInterval(intervalHandle);
      }
    };
  });

  // ── Model label helpers ───────────────────────────────────────────────────

  function isActiveModel(name: ModelName): boolean {
    if (!animState.activeModel) return false;
    return animState.activeModel.toLowerCase().includes(name.toLowerCase());
  }
</script>

<!-- ════════════════════════════════════════════════════════════════
     Machine display
     ════════════════════════════════════════════════════════════════ -->
<div class="machine-shell" class:flashing>

  <!-- Model strip ─────────────────────────────────────────────── -->
  <div class="model-strip">
    {#each MODEL_NAMES as name}
      <span class="model-label" class:active={isActiveModel(name)}>
        [{name} {isActiveModel(name) ? '●' : '○'}]
      </span>
    {/each}
  </div>

  <!-- ASCII art frame ──────────────────────────────────────────── -->
  <pre class="ascii-display {colorClass}">{currentFrame}</pre>

  <!-- Sub-state label ──────────────────────────────────────────── -->
  {#if animState.subState}
    <div class="sub-state {colorClass}">
      &rsaquo; {animState.subState}
    </div>
  {/if}

</div>

<style>
  /* ── Shell ──────────────────────────────────────────────────── */
  .machine-shell {
    background: #0a0a0a;
    padding: 12px 16px;
    border-radius: 4px;
    border: 1px solid #1a1a1a;
    display: inline-flex;
    flex-direction: column;
    gap: 8px;
    font-family: 'Courier New', Courier, monospace;
    transition: opacity 0.08s ease;
  }

  .machine-shell.flashing {
    opacity: 0.4;
  }

  /* ── Model strip ────────────────────────────────────────────── */
  .model-strip {
    display: flex;
    gap: 10px;
    font-size: 11px;
    letter-spacing: 0.03em;
  }

  .model-label {
    color: #333;
    white-space: nowrap;
    transition: color 0.2s ease;
  }

  .model-label.active {
    color: #00ff88;
    text-shadow: 0 0 6px rgba(0, 255, 136, 0.5);
  }

  /* ── ASCII frame ────────────────────────────────────────────── */
  .ascii-display {
    margin: 0;
    padding: 0;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre;
    transition: color 0.3s ease, text-shadow 0.3s ease;
  }

  /* ── Sub-state label ────────────────────────────────────────── */
  .sub-state {
    font-size: 11px;
    letter-spacing: 0.04em;
    padding-left: 2px;
    transition: color 0.3s ease;
  }

  /* ── State colour classes ───────────────────────────────────── */
  .color-idle {
    color: #2a5a3a;
    text-shadow: none;
  }

  .color-ingesting {
    color: #00cc66;
    text-shadow: 0 0 4px rgba(0, 204, 102, 0.3);
  }

  .color-thinking {
    color: #00aa88;
    text-shadow: 0 0 6px rgba(0, 170, 136, 0.35);
  }

  .color-executing {
    color: #00ff88;
    text-shadow: 0 0 8px rgba(0, 255, 136, 0.5);
  }

  .color-approving {
    color: #ffaa00;
    text-shadow: 0 0 8px rgba(255, 170, 0, 0.5);
  }

  .color-complete {
    color: #00ff88;
    text-shadow: 0 0 10px rgba(0, 255, 136, 0.6);
  }

  .color-error {
    color: #ff4444;
    text-shadow: 0 0 8px rgba(255, 68, 68, 0.6);
  }
</style>
