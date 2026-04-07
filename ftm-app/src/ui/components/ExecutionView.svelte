<script lang="ts">
  import { currentPlan, currentTask, daemonState, machineState, cancelTask } from '../lib/daemon-client.js';
  import type { FtmEvent } from '../../shared/types.js';

  // Derived execution state
  let artifacts = $state<Array<{ type: string; path: string; content?: string }>>([]);
  let stepStartTimes = $state<Record<number, number>>({});
  let stepElapsed = $state<Record<number, number>>({});
  let ticker: ReturnType<typeof setInterval> | null = null;

  // Track artifacts and step timing from events
  $effect(() => {
    const events = $daemonState.events;
    const newArtifacts: typeof artifacts = [];

    for (const event of events) {
      if (event.type === 'artifact_created') {
        const art = event.data as { type: string; path: string; content?: string };
        if (art && art.path && !newArtifacts.find(a => a.path === art.path)) {
          newArtifacts.push(art);
        }
      }
      if (event.type === 'step_started') {
        const idx = event.data.stepIndex as number;
        if (idx !== undefined && !stepStartTimes[idx]) {
          stepStartTimes = { ...stepStartTimes, [idx]: event.timestamp };
        }
      }
    }

    if (newArtifacts.length > artifacts.length) {
      artifacts = newArtifacts;
    }
  });

  // Elapsed time ticker
  $effect(() => {
    const state = $machineState;
    if (state === 'executing') {
      if (!ticker) {
        ticker = setInterval(() => {
          const plan = $currentPlan;
          if (!plan) return;
          const idx = plan.currentStep;
          const start = stepStartTimes[idx];
          if (start) {
            stepElapsed = { ...stepElapsed, [idx]: Math.floor((Date.now() - start) / 1000) };
          }
        }, 1000);
      }
    } else {
      if (ticker) {
        clearInterval(ticker);
        ticker = null;
      }
    }
    return () => {
      if (ticker) {
        clearInterval(ticker);
        ticker = null;
      }
    };
  });

  function formatElapsed(secs: number): string {
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  }

  function artifactIcon(type: string): string {
    switch (type.toLowerCase()) {
      case 'file': return '📄';
      case 'screenshot': return '🖼';
      case 'image': return '🖼';
      case 'code': return '⌨';
      case 'data': return '◈';
      default: return '◆';
    }
  }

  function artifactLabel(type: string): string {
    const icons: Record<string, string> = {
      file: 'File', screenshot: 'Screenshot', image: 'Image',
      code: 'Code', data: 'Data',
    };
    return icons[type.toLowerCase()] ?? type;
  }

  async function handleCancel() {
    const task = $currentTask;
    if (!task) return;
    try {
      await cancelTask(task.id);
    } catch (err) {
      console.error('[ExecutionView] cancel error:', err);
    }
  }

  // Computed values
  let totalSteps = $derived($currentPlan?.steps.length ?? 0);
  let currentStep = $derived($currentPlan?.currentStep ?? 0);
  let progress = $derived(totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0);
  let currentStepObj = $derived(
    $currentPlan?.steps.find(s => s.index === currentStep) ?? null
  );
  let isIdle = $derived($machineState === 'idle');
  let isError = $derived($machineState === 'error' || $currentTask?.status === 'failed');
  let errorMsg = $derived($currentTask?.error ?? 'An error occurred');
  let elapsedForCurrent = $derived(stepElapsed[currentStep] ?? 0);
</script>

<div class="execution-view" class:idle={isIdle} class:error={isError}>
  {#if isIdle && !$currentTask}
    <div class="idle-state">
      <span class="idle-dot"></span>
      <span class="idle-label">Idle</span>
    </div>
  {:else if isError}
    <div class="error-state">
      <div class="error-header">
        <span class="error-icon">✗</span>
        <span class="error-title">EXECUTION FAILED</span>
      </div>
      <p class="error-msg">{errorMsg}</p>
      <div class="error-actions">
        <button class="err-btn retry" onclick={() => window.location.reload()}>Retry</button>
        <button class="err-btn cancel" onclick={handleCancel}>Cancel</button>
      </div>
    </div>
  {:else}
    <!-- Progress bar -->
    <div class="progress-section">
      <div class="progress-meta">
        <span class="step-counter">Step {currentStep + 1} of {totalSteps}</span>
        {#if elapsedForCurrent > 0}
          <span class="elapsed">{formatElapsed(elapsedForCurrent)}</span>
        {/if}
      </div>
      <div class="progress-track">
        <div
          class="progress-fill"
          style="width: {progress}%"
          class:complete={progress >= 100}
        ></div>
      </div>
    </div>

    <!-- Current step description -->
    {#if currentStepObj}
      <div class="current-step">
        <span class="current-label">RUNNING</span>
        <p class="current-desc">{currentStepObj.description}</p>
        {#if currentStepObj.model}
          <span class="current-model">via {currentStepObj.model}</span>
        {/if}
      </div>
    {/if}

    <!-- Artifacts -->
    {#if artifacts.length > 0}
      <div class="artifacts-section">
        <span class="artifacts-label">ARTIFACTS ({artifacts.length})</span>
        <ul class="artifacts-list">
          {#each artifacts as artifact}
            <li class="artifact-item">
              <span class="artifact-icon">{artifactIcon(artifact.type)}</span>
              <span class="artifact-type">{artifactLabel(artifact.type)}</span>
              <span class="artifact-path" title={artifact.path}>{artifact.path}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</div>

<style>
  .execution-view {
    background: #111;
    border: 1px solid #222;
    border-radius: 6px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 13px;
    overflow: hidden;
    transition: border-color 150ms ease;
  }

  .execution-view.error {
    border-color: #ff444444;
  }

  /* Idle */
  .idle-state {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    color: #333;
  }

  .idle-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #2a2a2a;
  }

  .idle-label {
    font-size: 12px;
    letter-spacing: 0.1em;
  }

  /* Error state */
  .error-state {
    padding: 16px;
    background: #ff44441a;
  }

  .error-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .error-icon {
    color: #ff4444;
    font-size: 16px;
  }

  .error-title {
    color: #ff4444;
    font-size: 11px;
    letter-spacing: 0.15em;
  }

  .error-msg {
    color: #cc6666;
    font-size: 12px;
    margin: 0 0 12px;
    line-height: 1.5;
  }

  .error-actions {
    display: flex;
    gap: 6px;
  }

  .err-btn {
    padding: 5px 12px;
    border: 1px solid;
    border-radius: 4px;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .err-btn.retry {
    background: #ffaa0011;
    border-color: #ffaa0044;
    color: #ffaa00;
  }

  .err-btn.retry:hover {
    background: #ffaa0022;
  }

  .err-btn.cancel {
    background: #ff444411;
    border-color: #ff444444;
    color: #ff4444;
  }

  .err-btn.cancel:hover {
    background: #ff444422;
  }

  /* Progress */
  .progress-section {
    padding: 12px 14px 8px;
    border-bottom: 1px solid #1a1a1a;
  }

  .progress-meta {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .step-counter {
    color: #555;
    font-size: 11px;
    letter-spacing: 0.05em;
  }

  .elapsed {
    color: #444;
    font-size: 11px;
  }

  .progress-track {
    height: 3px;
    background: #1a1a1a;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #ffaa00;
    border-radius: 2px;
    transition: width 400ms ease;
  }

  .progress-fill.complete {
    background: #00ff88;
  }

  /* Current step */
  .current-step {
    padding: 12px 14px;
    border-bottom: 1px solid #1a1a1a;
  }

  .current-label {
    display: block;
    color: #ffaa00;
    font-size: 10px;
    letter-spacing: 0.2em;
    margin-bottom: 6px;
  }

  .current-desc {
    color: #d0d0d0;
    font-size: 13px;
    margin: 0 0 6px;
    line-height: 1.5;
  }

  .current-model {
    color: #444;
    font-size: 10px;
  }

  /* Artifacts */
  .artifacts-section {
    padding: 10px 14px;
  }

  .artifacts-label {
    display: block;
    color: #444;
    font-size: 10px;
    letter-spacing: 0.15em;
    margin-bottom: 8px;
  }

  .artifacts-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .artifact-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    background: #161616;
    border-radius: 3px;
  }

  .artifact-icon {
    font-size: 12px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .artifact-type {
    color: #555;
    font-size: 10px;
    flex-shrink: 0;
    min-width: 60px;
  }

  .artifact-path {
    color: #00ff8888;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
