<script lang="ts">
  import { daemonState } from '../lib/daemon-client.js';
  import type { FtmEvent } from '../../shared/types.js';

  const MAX_LINES = 200;

  let visible = $state(false);
  let logContainer: HTMLElement | null = $state(null);
  let lines: Array<{ time: string; type: string; data: string; category: 'success' | 'error' | 'normal' }> = $state([]);
  let autoScroll = $state(true);

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function formatData(data: Record<string, unknown>): string {
    try {
      const str = JSON.stringify(data);
      return str.length > 120 ? str.slice(0, 120) + '…' : str;
    } catch {
      return String(data);
    }
  }

  function getCategory(type: string): 'success' | 'error' | 'normal' {
    if (type.includes('completed') || type.includes('approved') || type === 'task_completed') {
      return 'success';
    }
    if (type.includes('error') || type.includes('failed') || type === 'guard_triggered') {
      return 'error';
    }
    return 'normal';
  }

  // Watch events and build lines (FIFO, max 200)
  $effect(() => {
    const events = $daemonState.events;
    if (events.length === 0) return;

    const last = events[events.length - 1];
    const newLine = {
      time: formatTime(last.timestamp),
      type: last.type,
      data: formatData(last.data),
      category: getCategory(last.type),
    };

    lines = [...lines, newLine].slice(-MAX_LINES);
  });

  // Auto-scroll to bottom when new lines arrive
  $effect(() => {
    if (lines.length && autoScroll && logContainer && visible) {
      // nextTick equivalent
      setTimeout(() => {
        if (logContainer) {
          logContainer.scrollTop = logContainer.scrollHeight;
        }
      }, 0);
    }
  });

  function handleScroll() {
    if (!logContainer) return;
    const atBottom =
      logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < 20;
    autoScroll = atBottom;
  }

  function scrollToBottom() {
    if (!logContainer) return;
    logContainer.scrollTop = logContainer.scrollHeight;
    autoScroll = true;
  }

  function toggle() {
    visible = !visible;
  }

  function clearLog() {
    lines = [];
  }
</script>

<div class="terminal-panel" class:expanded={visible}>
  <!-- Toggle bar -->
  <div class="terminal-bar" onclick={toggle} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && toggle()} aria-expanded={visible} aria-label="Toggle terminal panel">
    <span class="bar-label">TERMINAL</span>
    <div class="bar-right">
      {#if lines.length > 0}
        <span class="line-count">{lines.length} events</span>
      {/if}
      <span class="chevron" class:rotated={visible}>▲</span>
    </div>
  </div>

  {#if visible}
    <!-- Log area -->
    <div
      class="log-area"
      bind:this={logContainer}
      onscroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Event log"
    >
      {#if lines.length === 0}
        <div class="empty-log">No events yet...</div>
      {:else}
        {#each lines as line}
          <div class="log-line {line.category}">
            <span class="log-time">[{line.time}]</span>
            <span class="log-type">[{line.type}]</span>
            <span class="log-data">{line.data}</span>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Footer controls -->
    <div class="terminal-footer">
      <button class="term-btn" onclick={clearLog}>clear</button>
      {#if !autoScroll}
        <button class="term-btn scroll-btn" onclick={scrollToBottom}>↓ scroll to bottom</button>
      {/if}
      <span class="scroll-indicator">{autoScroll ? 'auto-scroll on' : 'auto-scroll off'}</span>
    </div>
  {/if}
</div>

<style>
  .terminal-panel {
    background: #0a0a0a;
    border: 1px solid #1a1a1a;
    border-radius: 6px;
    overflow: hidden;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    transition: all 150ms ease;
  }

  .terminal-panel.expanded {
    border-color: #222;
  }

  .terminal-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    cursor: pointer;
    user-select: none;
    background: #0f0f0f;
    transition: background 150ms ease;
  }

  .terminal-bar:hover {
    background: #141414;
  }

  .bar-label {
    color: #333;
    font-size: 10px;
    letter-spacing: 0.2em;
  }

  .bar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .line-count {
    color: #333;
    font-size: 10px;
  }

  .chevron {
    color: #333;
    font-size: 10px;
    transition: transform 150ms ease;
    display: inline-block;
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  .log-area {
    height: 200px;
    overflow-y: auto;
    padding: 8px 0;
    scrollbar-width: thin;
    scrollbar-color: #222 #0a0a0a;
  }

  .log-area::-webkit-scrollbar {
    width: 4px;
  }

  .log-area::-webkit-scrollbar-track {
    background: #0a0a0a;
  }

  .log-area::-webkit-scrollbar-thumb {
    background: #222;
    border-radius: 2px;
  }

  .empty-log {
    color: #2a2a2a;
    font-size: 11px;
    padding: 8px 12px;
    font-style: italic;
  }

  .log-line {
    display: flex;
    gap: 8px;
    padding: 2px 12px;
    font-size: 11px;
    line-height: 1.6;
    transition: background 100ms ease;
  }

  .log-line:hover {
    background: #111;
  }

  .log-line.normal {
    color: #444;
  }

  .log-line.success {
    color: #2a6644;
  }

  .log-line.success .log-type {
    color: #00ff88;
  }

  .log-line.error {
    color: #6a2a2a;
  }

  .log-line.error .log-type {
    color: #ff4444;
  }

  .log-time {
    color: #2a2a2a;
    flex-shrink: 0;
  }

  .log-type {
    flex-shrink: 0;
    color: #3a3a3a;
  }

  .log-line.normal .log-type {
    color: #3a3a3a;
  }

  .log-data {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .terminal-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border-top: 1px solid #111;
    background: #0f0f0f;
  }

  .term-btn {
    background: none;
    border: none;
    color: #333;
    font-family: inherit;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    transition: color 150ms ease;
  }

  .term-btn:hover {
    color: #666;
  }

  .term-btn.scroll-btn {
    color: #ffaa00;
  }

  .scroll-indicator {
    margin-left: auto;
    color: #222;
    font-size: 10px;
  }
</style>
