<script lang="ts">
  import { submitTask, isConnected } from '../lib/daemon-client.js';
  import {
    workingDirectory,
    setWorkingDirectory,
  } from '../lib/working-directory.js';

  // State
  let value = $state('');
  let history: string[] = $state([]);
  let historyIndex = $state(-1);
  let isDragging = $state(false);
  let isSubmitting = $state(false);
  let statusMsg = $state('');
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let textarea: HTMLTextAreaElement | null = $state(null);
  // Derived short label for the cwd pill
  let cwdLabel = $derived(
    $workingDirectory
      ? $workingDirectory.split('/').filter(Boolean).slice(-2).join('/')
      : null
  );

  async function pickFolder() {
    const ftm = (
      window as unknown as {
        ftm?: { openFolder?: () => Promise<string | null> };
      }
    ).ftm;
    if (!ftm?.openFolder) return;
    const chosen = await ftm.openFolder();
    if (chosen) setWorkingDirectory(chosen);
  }

  function clearDir() {
    setWorkingDirectory(null);
  }

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
    if (!text || !$isConnected || isSubmitting) return;

    isSubmitting = true;

    try {
      await submitTask(text, $workingDirectory ?? undefined);
      history = [text, ...history.slice(0, 49)];
      historyIndex = -1;
      value = '';
      resize();
      showStatus('Task submitted.', 1200);
    } catch (err) {
      console.error('[InputPanel] submit error:', err);
      const message = err instanceof Error ? err.message : 'Submit failed';
      showStatus(message, 3000);
    } finally {
      isSubmitting = false;
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
      disabled={!$isConnected || isSubmitting}
      rows={1}
      spellcheck={false}
      onkeydown={handleKeydown}
      oninput={handleInput}
      onpaste={handlePaste}
      aria-label="Task input"
    ></textarea>

    <button
      class="folder-btn"
      onclick={pickFolder}
      title="Choose working directory"
      aria-label="Choose working directory"
    >
      <span class="folder-icon">⌂</span>
      <span class="folder-label">Browse</span>
    </button>

    <button
      class="submit-btn"
      disabled={!$isConnected || !value.trim() || isSubmitting}
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
      <div class="meta-row">
        <span class="hint">Enter to submit · Shift+Enter for newline · ↑↓ for history</span>
        {#if cwdLabel}
          <button class="cwd-pill" onclick={clearDir} title="Clear working directory: {$workingDirectory}">
            <span class="cwd-icon">⌂</span>
            <span class="cwd-text">{cwdLabel}</span>
            <span class="cwd-clear">×</span>
          </button>
        {/if}
      </div>
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

  .folder-btn {
    flex-shrink: 0;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 4px;
    min-width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease;
    padding: 0 8px;
  }

  .folder-btn:hover {
    background: #222;
    border-color: #444;
  }

  .folder-icon {
    color: #666;
    font-size: 14px;
    line-height: 1;
  }

  .folder-label {
    color: #777;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .folder-btn:hover .folder-icon {
    color: #aaa;
  }

  .folder-btn:hover .folder-label {
    color: #bbb;
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

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .hint {
    color: #333;
    font-size: 11px;
    user-select: none;
  }

  .cwd-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 4px;
    padding: 2px 7px 2px 6px;
    cursor: pointer;
    transition: border-color 150ms ease, background 150ms ease;
    max-width: 220px;
    overflow: hidden;
  }

  .cwd-pill:hover {
    border-color: #ff444466;
    background: #1e1414;
  }

  .cwd-icon {
    color: #00ff8888;
    font-size: 11px;
    flex-shrink: 0;
  }

  .cwd-text {
    color: #00ff88aa;
    font-size: 10px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.03em;
  }

  .cwd-clear {
    color: #444;
    font-size: 12px;
    flex-shrink: 0;
    line-height: 1;
  }

  .cwd-pill:hover .cwd-clear {
    color: #ff4444;
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

  @media (max-width: 640px) {
    .folder-label {
      display: none;
    }
  }
</style>
