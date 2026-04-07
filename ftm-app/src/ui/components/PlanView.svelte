<script lang="ts">
  import { currentPlan, currentTask, approvePlan, modifyPlan, cancelTask } from '../lib/daemon-client.js';
  import type { PlanStep } from '../../shared/types.js';

  // State
  let editMode = $state(false);
  let editedSteps: PlanStep[] = $state([]);
  let flashingStep = $state(-1);
  let prevStatuses: Record<number, string> = {};

  // Model badge colors
  const modelColors: Record<string, string> = {
    'claude': '#8b5cf6',
    'gpt': '#10b981',
    'gemini': '#f59e0b',
    'opus': '#6366f1',
    'sonnet': '#8b5cf6',
    'haiku': '#a78bfa',
    'default': '#555',
  };

  function getModelColor(model: string | undefined): string {
    if (!model) return modelColors.default;
    const lower = model.toLowerCase();
    for (const key of Object.keys(modelColors)) {
      if (lower.includes(key)) return modelColors[key];
    }
    return modelColors.default;
  }

  function getModelShort(model: string | undefined): string {
    if (!model) return '';
    // Shorten common model names
    return model
      .replace('claude-', '')
      .replace('gpt-', 'gpt-')
      .replace('-latest', '')
      .slice(0, 12);
  }

  function statusIcon(status: string): string {
    switch (status) {
      case 'pending': return '○';
      case 'in_progress': return '◐';
      case 'completed': return '●';
      case 'failed': return '✗';
      case 'cancelled': return '⊘';
      default: return '○';
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case 'pending': return 'pending';
      case 'in_progress': return 'in-progress';
      case 'completed': return 'complete';
      case 'failed': return 'failed';
      case 'cancelled': return 'cancelled';
      default: return 'pending';
    }
  }

  // Watch for step completions to trigger flash animation
  $effect(() => {
    const plan = $currentPlan;
    if (!plan) return;

    for (const step of plan.steps) {
      const prev = prevStatuses[step.index];
      if (prev && prev !== 'completed' && step.status === 'completed') {
        flashingStep = step.index;
        setTimeout(() => { flashingStep = -1; }, 600);
      }
      prevStatuses[step.index] = step.status;
    }
  });

  function enterEditMode() {
    const plan = $currentPlan;
    if (!plan) return;
    editedSteps = plan.steps.map(s => ({ ...s }));
    editMode = true;
  }

  function cancelEdit() {
    editMode = false;
    editedSteps = [];
  }

  function addStep() {
    const maxIndex = editedSteps.reduce((m, s) => Math.max(m, s.index), -1);
    editedSteps = [
      ...editedSteps,
      { index: maxIndex + 1, description: '', status: 'pending' }
    ];
  }

  function removeStep(idx: number) {
    editedSteps = editedSteps.filter(s => s.index !== idx);
  }

  async function saveModifications() {
    const plan = $currentPlan;
    if (!plan) return;
    try {
      await modifyPlan(plan.id, { steps: editedSteps });
      editMode = false;
    } catch (err) {
      console.error('[PlanView] modify error:', err);
    }
  }

  async function handleApprove() {
    const plan = $currentPlan;
    if (!plan) return;
    try {
      await approvePlan(plan.id);
    } catch (err) {
      console.error('[PlanView] approve error:', err);
    }
  }

  async function handleCancel() {
    const task = $currentTask;
    if (!task) return;
    try {
      await cancelTask(task.id);
    } catch (err) {
      console.error('[PlanView] cancel error:', err);
    }
  }
</script>

<div class="plan-view">
  {#if !$currentPlan}
    <div class="empty-state">
      <span class="empty-icon">◌</span>
      <span class="empty-label">No active plan</span>
    </div>
  {:else}
    {@const plan = $currentPlan}
    <div class="plan-header">
      <span class="plan-title">PLAN</span>
      <span class="plan-status status-{plan.status}">{plan.status.toUpperCase()}</span>
    </div>

    <ol class="step-list">
      {#each plan.steps as step (step.index)}
        {#if editMode}
          {@const editedStep = editedSteps.find(s => s.index === step.index)}
          <li class="step-item edit">
            <span class="step-num">{step.index + 1}.</span>
            <input
              class="step-input"
              type="text"
              bind:value={editedStep!.description}
              placeholder="Step description..."
            />
            <button class="step-remove" onclick={() => removeStep(step.index)} aria-label="Remove step">✕</button>
          </li>
        {:else}
          <li
            class="step-item"
            class:approval-gate={step.requiresApproval}
            class:flashing={flashingStep === step.index}
          >
            <span class="step-num">{step.index + 1}.</span>
            <span class="step-icon {statusClass(step.status)}">{statusIcon(step.status)}</span>
            <span class="step-desc" class:dim={step.status === 'completed'}>{step.description}</span>
            {#if step.model}
              <span
                class="model-badge"
                style="background: {getModelColor(step.model)}22; color: {getModelColor(step.model)}; border-color: {getModelColor(step.model)}55"
              >
                {getModelShort(step.model)}
              </span>
            {/if}
            {#if step.requiresApproval}
              <span class="approval-tag" title="Requires approval">⚠</span>
            {/if}
          </li>
        {/if}
      {/each}

      {#if editMode}
        <li class="step-item add">
          <button class="add-step-btn" onclick={addStep}>+ Add step</button>
        </li>
      {/if}
    </ol>

    <div class="approval-bar">
      {#if editMode}
        <button class="action-btn save" onclick={saveModifications}>SAVE</button>
        <button class="action-btn neutral" onclick={cancelEdit}>BACK</button>
      {:else}
        <button
          class="action-btn approve"
          disabled={plan.status !== 'pending'}
          onclick={handleApprove}
          title="Let it cook"
        >
          LET IT COOK
        </button>
        <button
          class="action-btn modify"
          disabled={plan.status !== 'pending'}
          onclick={enterEditMode}
        >
          MODIFY
        </button>
        <button
          class="action-btn cancel"
          onclick={handleCancel}
        >
          CANCEL
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .plan-view {
    display: flex;
    flex-direction: column;
    background: #111;
    border: 1px solid #222;
    border-radius: 6px;
    overflow: hidden;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 13px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px 16px;
    color: #333;
  }

  .empty-icon {
    font-size: 28px;
    opacity: 0.4;
  }

  .empty-label {
    font-size: 12px;
    letter-spacing: 0.05em;
  }

  .plan-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid #1a1a1a;
    background: #0f0f0f;
  }

  .plan-title {
    color: #555;
    font-size: 11px;
    letter-spacing: 0.15em;
  }

  .plan-status {
    font-size: 10px;
    letter-spacing: 0.1em;
    padding: 1px 6px;
    border-radius: 3px;
  }

  .status-pending { color: #555; background: #1a1a1a; }
  .status-approved { color: #00ff88; background: #00ff8811; }
  .status-executing { color: #ffaa00; background: #ffaa0011; }
  .status-completed { color: #00ff88; background: #00ff8811; }
  .status-failed { color: #ff4444; background: #ff444411; }

  .step-list {
    list-style: none;
    margin: 0;
    padding: 8px 0;
    overflow-y: auto;
    max-height: 280px;
    flex: 1;
  }

  .step-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    transition: background 150ms ease;
    border-left: 2px solid transparent;
  }

  .step-item:hover {
    background: #161616;
  }

  .step-item.approval-gate {
    border-left-color: #ffaa00;
    background: #ffaa0008;
  }

  .step-item.flashing {
    animation: step-flash 600ms ease forwards;
  }

  @keyframes step-flash {
    0% { background: #00ff8833; }
    100% { background: transparent; }
  }

  .step-num {
    color: #444;
    font-size: 11px;
    min-width: 18px;
    flex-shrink: 0;
  }

  .step-icon {
    font-size: 14px;
    flex-shrink: 0;
    width: 16px;
    text-align: center;
  }

  .step-icon.pending { color: #444; }
  .step-icon.in-progress { color: #ffaa00; }
  .step-icon.complete { color: #00ff88; }
  .step-icon.failed { color: #ff4444; }
  .step-icon.cancelled { color: #666; }

  .step-desc {
    flex: 1;
    color: #c0c0c0;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .step-desc.dim {
    color: #555;
    text-decoration: line-through;
    text-decoration-color: #333;
  }

  .model-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid;
    white-space: nowrap;
    flex-shrink: 0;
    letter-spacing: 0.05em;
  }

  .approval-tag {
    color: #ffaa00;
    font-size: 12px;
    flex-shrink: 0;
  }

  /* Edit mode */
  .step-item.edit {
    gap: 6px;
  }

  .step-input {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 3px;
    color: #e0e0e0;
    font-family: inherit;
    font-size: 12px;
    padding: 3px 6px;
    outline: none;
  }

  .step-input:focus {
    border-color: #555;
  }

  .step-remove {
    background: none;
    border: none;
    color: #444;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
    transition: color 150ms ease;
  }

  .step-remove:hover {
    color: #ff4444;
  }

  .step-item.add {
    padding: 4px 12px;
  }

  .add-step-btn {
    background: none;
    border: 1px dashed #333;
    color: #555;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 3px;
    transition: all 150ms ease;
    width: 100%;
    text-align: left;
  }

  .add-step-btn:hover {
    border-color: #555;
    color: #888;
  }

  /* Approval bar */
  .approval-bar {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid #1a1a1a;
    background: #0f0f0f;
  }

  .action-btn {
    flex: 1;
    padding: 7px 10px;
    border: 1px solid;
    border-radius: 4px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .action-btn.approve {
    background: #00ff8811;
    border-color: #00ff8844;
    color: #00ff88;
  }

  .action-btn.approve:hover:not(:disabled) {
    background: #00ff8822;
    border-color: #00ff88;
  }

  .action-btn.modify {
    background: #ffaa0011;
    border-color: #ffaa0044;
    color: #ffaa00;
  }

  .action-btn.modify:hover:not(:disabled) {
    background: #ffaa0022;
    border-color: #ffaa00;
  }

  .action-btn.cancel {
    background: #ff444411;
    border-color: #ff444444;
    color: #ff4444;
  }

  .action-btn.cancel:hover:not(:disabled) {
    background: #ff444422;
    border-color: #ff4444;
  }

  .action-btn.save {
    background: #00ff8811;
    border-color: #00ff8844;
    color: #00ff88;
  }

  .action-btn.save:hover {
    background: #00ff8822;
    border-color: #00ff88;
  }

  .action-btn.neutral {
    background: transparent;
    border-color: #333;
    color: #666;
  }

  .action-btn.neutral:hover {
    border-color: #555;
    color: #999;
  }
</style>
