<script lang="ts">
  import { submitTask, isConnected } from '../lib/daemon-client.js';

  // State
  let value = $state('');
  let history: string[] = $state([]);
  let historyIndex = $state(-1);
  let isDragging = $state(false);
  let statusMsg = $state('');
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let textarea: HTMLTextAreaElement | null = $state(null);

  // Auto-resize textarea
  function resize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const lineHeight = 22;
    const maxHeight = lineHeight * 5 + 24; // 5 lines + padding
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
  }

  function showStatus(msg: string, duration = 2000) {
    if (statusTimer) clearTimeout(statusTimer);
    statusMsg = msg;
    statusTimer = setTimeout(() => {
      statusMsg = '';
      statusTimer = null;
    }, duration);
  }

  async function handleSubmit() {
    const text = value.trim();
    if (!text || !$isConnected) return;

    history = [text, ...history.slice(0, 49)];
    historyIndex = -1;
    value = '';
    resize();

    try {
      await submitTask(text);
    } catch (err) {
      console.error('[InputPanel] submit error:', err);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = Math.min(historyIndex + 1, history.length - 1);
      historyIndex = next;
      value = history[next];
      setTimeout(resize, 0);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex <= 0) {
        historyIndex = -1;
        value = '';
        setTimeout(resize, 0);
        return;
      }
      const next = historyIndex - 1;
      historyIndex = next;
      value = history[next];
      setTimeout(resize, 0);
      return;
    }
  }

  function handleInput() {
    resize();
  }

  function handlePaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (pasted.length > 100) {
      showStatus('Ingesting content...');
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

    const typeMap: Record<string, string> = {
      pdf: 'PDF',
      png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', webp: 'Image',
      mp4: 'Video', mov: 'Video', avi: 'Video',
      mp3: 'Audio', wav: 'Audio',
      txt: 'Text', md: 'Markdown', csv: 'CSV',
      js: 'Code', ts: 'Code', py: 'Code', json: 'JSON',
      zip: 'Archive', tar: 'Archive',
    };

    const detected = typeMap[ext] ?? 'File';
    showStatus(`Ingesting ${detected}...`, 2500);

    // Populate textarea with drop info
    value = `[File: ${file.name}]\n`;
    setTimeout(resize, 0);
  }

  $effect(() => {
    // Initial resize
    if (textarea) resize();
  });
</script>

<div
  class="input-panel"
  class:dragging={isDragging}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  role="region"
  aria-label="Task input"
>
  {#if isDragging}
    <div class="drag-overlay" aria-hidden="true">
      <span class="drag-label">Drop to ingest</span>
    </div>
  {/if}

  <div class="input-row">
    <textarea
      bind:this={textarea}
      bind:value
      class="task-textarea"
      placeholder="Feed the machine..."
      disabled={!$isConnected}
      rows={1}
      spellcheck={false}
      onkeydown={handleKeydown}
      oninput={handleInput}
      onpaste={handlePaste}
      aria-label="Task input"
    ></textarea>

    <button
      class="submit-btn"
      disabled={!$isConnected || !value.trim()}
      onclick={handleSubmit}
      aria-label="Submit task"
      title="Submit (Enter)"
    >
      <span class="submit-arrow">↵</span>
    </button>
  </div>

  <div class="input-meta">
    {#if statusMsg}
      <span class="status-msg ingesting">{statusMsg}</span>
    {:else if !$isConnected}
      <span class="status-msg disconnected">Daemon offline</span>
    {:else}
      <span class="hint">Enter to submit · Shift+Enter for newline · ↑↓ for history</span>
    {/if}
  </div>
</div>

<style>
  .input-panel {
    position: relative;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 10px 12px 8px;
    transition: border-color 150ms ease;
  }

  .input-panel:focus-within {
    border-color: #00ff88;
    box-shadow: 0 0 0 1px #00ff8833;
  }

  .input-panel.dragging {
    border-color: #ffaa00;
    box-shadow: 0 0 0 1px #ffaa0033;
  }

  .drag-overlay {
    position: absolute;
    inset: 0;
    background: rgba(255, 170, 0, 0.1);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    pointer-events: none;
  }

  .drag-label {
    color: #ffaa00;
    font-size: 14px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    letter-spacing: 0.1em;
  }

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .task-textarea {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    color: #e0e0e0;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 14px;
    line-height: 22px;
    min-height: 22px;
    max-height: 110px; /* 5 lines * 22px */
    overflow-y: auto;
    scrollbar-width: none;
    padding: 0;
  }

  .task-textarea::-webkit-scrollbar {
    display: none;
  }

  .task-textarea::placeholder {
    color: #444;
  }

  .task-textarea:disabled {
    color: #444;
    cursor: not-allowed;
  }

  .submit-btn {
    flex-shrink: 0;
    background: #00ff88;
    border: none;
    border-radius: 4px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 150ms ease, opacity 150ms ease;
    padding: 0;
  }

  .submit-btn:hover:not(:disabled) {
    background: #00cc6a;
  }

  .submit-btn:disabled {
    background: #2a2a2a;
    cursor: not-allowed;
  }

  .submit-arrow {
    color: #0a0a0a;
    font-size: 16px;
    font-weight: bold;
    line-height: 1;
  }

  .submit-btn:disabled .submit-arrow {
    color: #555;
  }

  .input-meta {
    margin-top: 6px;
    min-height: 16px;
  }

  .hint {
    color: #333;
    font-size: 11px;
    user-select: none;
  }

  .status-msg {
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }

  .status-msg.ingesting {
    color: #ffaa00;
    animation: blink 0.8s step-end infinite;
  }

  .status-msg.disconnected {
    color: #ff4444;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
