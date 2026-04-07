<script lang="ts">
  import { onMount } from 'svelte';
  import { daemonState, getHistory } from '../lib/daemon-client.js';
  import type { Task } from '@ftm/daemon';

  // Collapse state for each section
  let contextOpen = $state(false);
  let decisionsOpen = $state(false);
  let constraintsOpen = $state(false);
  let historyOpen = $state(false);

  let taskHistory: Task[] = $state([]);
  let historyError = $state('');

  onMount(async () => {
    try {
      taskHistory = await getHistory(5);
    } catch (err) {
      historyError = 'History unavailable';
    }
  });

  // Re-fetch history when task completes
  $effect(() => {
    const state = $daemonState.machineState;
    if (state === 'idle' || state === 'complete') {
      getHistory(5).then(h => { taskHistory = h; }).catch(() => {});
    }
  });

  function formatRelative(ts: number): string {
    const delta = Date.now() - ts;
    const mins = Math.floor(delta / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'completed': return '#00ff88';
      case 'failed': return '#ff4444';
      case 'cancelled': return '#888';
      case 'in_progress': return '#ffaa00';
      default: return '#555';
    }
  }

  function statusIcon(status: string): string {
    switch (status) {
      case 'completed': return '●';
      case 'failed': return '✗';
      case 'cancelled': return '⊘';
      case 'in_progress': return '◐';
      default: return '○';
    }
  }

  let blackboard = $derived($daemonState.blackboard);
  let hasContext = $derived(!!blackboard);
  let decisions = $derived(blackboard?.recentDecisions ?? []);
  let constraints = $derived(blackboard?.activeConstraints ?? []);
  let skills = $derived(blackboard?.sessionMetadata?.skillsInvoked ?? []);
</script>

<div class="memory-panel">
  <div class="panel-header">
    <span class="panel-title">MEMORY</span>
  </div>

  <!-- Context Summary -->
  <div class="section">
    <button
      class="section-toggle"
      onclick={() => (contextOpen = !contextOpen)}
      aria-expanded={contextOpen}
    >
      <span class="toggle-chevron" class:open={contextOpen}>›</span>
      <span class="section-label">CONTEXT</span>
      {#if !hasContext}
        <span class="badge dim">empty</span>
      {:else if skills.length > 0}
        <span class="badge active">{skills.length} skills</span>
      {/if}
    </button>

    {#if contextOpen}
      <div class="section-body">
        {#if !blackboard}
          <p class="empty-note">No context loaded</p>
        {:else}
          {#if blackboard.currentTask}
            <div class="context-row">
              <span class="context-key">task</span>
              <span class="context-val">{blackboard.currentTask.description.slice(0, 60)}{blackboard.currentTask.description.length > 60 ? '…' : ''}</span>
            </div>
          {/if}
          {#if skills.length > 0}
            <div class="context-row">
              <span class="context-key">skills</span>
              <span class="context-val">{skills.join(', ')}</span>
            </div>
          {/if}
          {#if blackboard.sessionMetadata.startedAt}
            <div class="context-row">
              <span class="context-key">started</span>
              <span class="context-val">{formatRelative(blackboard.sessionMetadata.startedAt)}</span>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Recent Decisions -->
  <div class="section">
    <button
      class="section-toggle"
      onclick={() => (decisionsOpen = !decisionsOpen)}
      aria-expanded={decisionsOpen}
    >
      <span class="toggle-chevron" class:open={decisionsOpen}>›</span>
      <span class="section-label">DECISIONS</span>
      {#if decisions.length > 0}
        <span class="badge active">{decisions.length}</span>
      {/if}
    </button>

    {#if decisionsOpen}
      <div class="section-body">
        {#if decisions.length === 0}
          <p class="empty-note">No decisions recorded</p>
        {:else}
          {#each decisions.slice(0, 5) as dec}
            <div class="decision-item">
              <div class="decision-text">{dec.decision}</div>
              <div class="decision-reason">{dec.reason}</div>
              <div class="decision-time">{formatRelative(dec.timestamp)}</div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Active Constraints -->
  <div class="section">
    <button
      class="section-toggle"
      onclick={() => (constraintsOpen = !constraintsOpen)}
      aria-expanded={constraintsOpen}
    >
      <span class="toggle-chevron" class:open={constraintsOpen}>›</span>
      <span class="section-label">CONSTRAINTS</span>
      {#if constraints.length > 0}
        <span class="badge warn">{constraints.length}</span>
      {/if}
    </button>

    {#if constraintsOpen}
      <div class="section-body">
        {#if constraints.length === 0}
          <p class="empty-note">No active constraints</p>
        {:else}
          <div class="tag-cloud">
            {#each constraints as constraint}
              <span class="constraint-tag">{constraint}</span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Task History -->
  <div class="section">
    <button
      class="section-toggle"
      onclick={() => (historyOpen = !historyOpen)}
      aria-expanded={historyOpen}
    >
      <span class="toggle-chevron" class:open={historyOpen}>›</span>
      <span class="section-label">HISTORY</span>
      {#if taskHistory.length > 0}
        <span class="badge dim">{taskHistory.length}</span>
      {/if}
    </button>

    {#if historyOpen}
      <div class="section-body">
        {#if historyError}
          <p class="empty-note error">{historyError}</p>
        {:else if taskHistory.length === 0}
          <p class="empty-note">No tasks yet</p>
        {:else}
          {#each taskHistory as task}
            <div class="history-item">
              <span
                class="history-icon"
                style="color: {statusColor(task.status)}"
              >
                {statusIcon(task.status)}
              </span>
              <span class="history-desc" title={task.description}>
                {task.description.slice(0, 55)}{task.description.length > 55 ? '…' : ''}
              </span>
              <span class="history-time">{formatRelative(task.createdAt)}</span>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .memory-panel {
    background: #111;
    border: 1px solid #1a1a1a;
    border-radius: 6px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
    overflow: hidden;
  }

  .panel-header {
    padding: 8px 12px;
    border-bottom: 1px solid #1a1a1a;
    background: #0f0f0f;
  }

  .panel-title {
    color: #333;
    font-size: 10px;
    letter-spacing: 0.2em;
  }

  .section {
    border-bottom: 1px solid #141414;
  }

  .section:last-child {
    border-bottom: none;
  }

  .section-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 12px;
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 10px;
    text-align: left;
    transition: background 150ms ease;
  }

  .section-toggle:hover {
    background: #141414;
  }

  .toggle-chevron {
    color: #333;
    font-size: 14px;
    line-height: 1;
    display: inline-block;
    transition: transform 150ms ease;
    width: 10px;
  }

  .toggle-chevron.open {
    transform: rotate(90deg);
  }

  .section-label {
    color: #444;
    letter-spacing: 0.15em;
    flex: 1;
  }

  .badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    font-family: inherit;
  }

  .badge.active {
    background: #00ff8811;
    color: #00ff88;
  }

  .badge.warn {
    background: #ffaa0011;
    color: #ffaa00;
  }

  .badge.dim {
    background: #1a1a1a;
    color: #444;
  }

  .section-body {
    padding: 6px 12px 10px 24px;
    animation: slide-in 150ms ease;
  }

  @keyframes slide-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .empty-note {
    color: #2a2a2a;
    font-size: 11px;
    margin: 0;
    font-style: italic;
  }

  .empty-note.error {
    color: #663333;
  }

  /* Context rows */
  .context-row {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
  }

  .context-key {
    color: #333;
    font-size: 10px;
    min-width: 50px;
    flex-shrink: 0;
  }

  .context-val {
    color: #555;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Decisions */
  .decision-item {
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #141414;
  }

  .decision-item:last-child {
    border-bottom: none;
    margin-bottom: 0;
  }

  .decision-text {
    color: #666;
    font-size: 11px;
    line-height: 1.4;
    margin-bottom: 2px;
  }

  .decision-reason {
    color: #3a3a3a;
    font-size: 10px;
    line-height: 1.4;
    font-style: italic;
  }

  .decision-time {
    color: #2a2a2a;
    font-size: 9px;
    margin-top: 2px;
  }

  /* Constraints */
  .tag-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .constraint-tag {
    background: #ffaa0011;
    border: 1px solid #ffaa0033;
    color: #886600;
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 3px;
  }

  /* History */
  .history-item {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 5px;
    padding: 3px 0;
  }

  .history-icon {
    font-size: 11px;
    flex-shrink: 0;
    width: 12px;
    text-align: center;
  }

  .history-desc {
    flex: 1;
    color: #4a4a4a;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-time {
    color: #2a2a2a;
    font-size: 9px;
    flex-shrink: 0;
  }
</style>
