<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { daemonState, connect, disconnect } from './lib/daemon-client.js';
  import Machine from './components/Machine.svelte';
  import InputPanel from './components/InputPanel.svelte';
  import PlanView from './components/PlanView.svelte';
  import ExecutionView from './components/ExecutionView.svelte';
  import TerminalPanel from './components/TerminalPanel.svelte';
  import MemoryPanel from './components/MemoryPanel.svelte';
  import FileBrowser from './components/FileBrowser.svelte';

  type Tab = 'plan' | 'execution' | 'memory';
  let activeTab = $state<Tab>('plan');

  let connected = $derived($daemonState.connected);
  let state = $derived($daemonState.machineState);

  $effect(() => {
    switch (state) {
      case 'approving':
        activeTab = 'plan';
        break;
      case 'executing':
        activeTab = 'execution';
        break;
      default:
        break;
    }
  });

  onMount(async () => {
    try {
      await connect();
    } catch (err) {
      console.error('[App] Failed to connect to daemon:', err);
    }
  });

  onDestroy(() => {
    disconnect();
  });

  function stateLabel(s: string): string {
    return s.toUpperCase();
  }

  function stateClass(s: string): string {
    switch (s) {
      case 'idle': return 'state-idle';
      case 'ingesting': return 'state-ingesting';
      case 'thinking': return 'state-thinking';
      case 'executing': return 'state-executing';
      case 'approving': return 'state-approving';
      case 'complete': return 'state-complete';
      case 'error': return 'state-error';
      default: return 'state-idle';
    }
  }
</script>

<main class="app-shell">
  <div class="titlebar-drag"></div>

  <section class="workspace">
    <div class="main-column">
      <header class="machine-area">
        <Machine />
        <div class="machine-meta">
          <span class="conn-dot" class:online={connected} title={connected ? 'Connected' : 'Disconnected'}></span>
          <span class="conn-label {stateClass(state)}">{connected ? stateLabel(state) : 'OFFLINE'}</span>
        </div>
      </header>

      <section class="input-area" aria-label="Task input">
        <InputPanel />
      </section>

      <section class="panels-area" aria-label="Task panels">
        <div class="tab-nav" role="tablist">
          <button
            class="tab-btn"
            class:active={activeTab === 'plan'}
            role="tab"
            aria-selected={activeTab === 'plan'}
            aria-controls="panel-plan"
            onclick={() => (activeTab = 'plan')}
          >
            PLAN
            {#if state === 'approving'}
              <span class="tab-dot approving"></span>
            {/if}
          </button>
          <button
            class="tab-btn"
            class:active={activeTab === 'execution'}
            role="tab"
            aria-selected={activeTab === 'execution'}
            aria-controls="panel-execution"
            onclick={() => (activeTab = 'execution')}
          >
            EXECUTION
            {#if state === 'executing'}
              <span class="tab-dot executing"></span>
            {/if}
          </button>
          <button
            class="tab-btn"
            class:active={activeTab === 'memory'}
            role="tab"
            aria-selected={activeTab === 'memory'}
            aria-controls="panel-memory"
            onclick={() => (activeTab = 'memory')}
          >
            MEMORY
          </button>
        </div>

        <div class="tab-content">
          <div
            id="panel-plan"
            class="tab-panel"
            class:visible={activeTab === 'plan'}
            role="tabpanel"
            aria-hidden={activeTab !== 'plan'}
          >
            <PlanView />
          </div>

          <div
            id="panel-execution"
            class="tab-panel"
            class:visible={activeTab === 'execution'}
            role="tabpanel"
            aria-hidden={activeTab !== 'execution'}
          >
            <ExecutionView />
          </div>

          <div
            id="panel-memory"
            class="tab-panel"
            class:visible={activeTab === 'memory'}
            role="tabpanel"
            aria-hidden={activeTab !== 'memory'}
          >
            <MemoryPanel />
          </div>
        </div>
      </section>

      <div class="terminal-area">
        <TerminalPanel />
      </div>
    </div>

    <aside class="sidebar" aria-label="Embedded file browser">
      <FileBrowser />
    </aside>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #0a0a0a;
    color: #e0e0e0;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    overflow: hidden;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .titlebar-drag {
    -webkit-app-region: drag;
    height: 32px;
    width: 100%;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 100;
  }

  .app-shell {
    height: 100vh;
    padding: 44px 14px 14px;
    overflow: hidden;
    background:
      radial-gradient(circle at top right, rgba(0, 255, 136, 0.06), transparent 28%),
      linear-gradient(180deg, #0c0c0c 0%, #090909 100%);
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 12px;
    height: 100%;
    min-height: 0;
  }

  .main-column {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    gap: 10px;
    min-height: 0;
    overflow: hidden;
  }

  .sidebar {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .machine-area {
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .machine-meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .conn-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #333;
    transition: background 300ms ease;
  }

  .conn-dot.online {
    background: #00ff88;
    box-shadow: 0 0 6px #00ff8877;
    animation: pulse-dot 2s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { box-shadow: 0 0 4px #00ff8844; }
    50% { box-shadow: 0 0 10px #00ff8888; }
  }

  .conn-label {
    font-size: 11px;
    letter-spacing: 0.15em;
    transition: color 300ms ease;
  }

  .state-idle { color: #333; }
  .state-ingesting { color: #ffaa00; }
  .state-thinking { color: #8b5cf6; }
  .state-executing { color: #ffaa00; animation: blink-label 1s step-end infinite; }
  .state-approving { color: #ffaa00; }
  .state-complete { color: #00ff88; }
  .state-error { color: #ff4444; }

  @keyframes blink-label {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.65; }
  }

  .panels-area {
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 8px;
  }

  .tab-nav {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid #1f1f1f;
    border-radius: 10px;
  }

  .tab-btn {
    position: relative;
    border: 0;
    padding: 9px 14px;
    background: transparent;
    color: #6f6f6f;
    font: inherit;
    font-size: 11px;
    letter-spacing: 0.12em;
    cursor: pointer;
    border-radius: 8px;
    transition: background 150ms ease, color 150ms ease;
  }

  .tab-btn:hover {
    background: rgba(255, 255, 255, 0.04);
    color: #bcbcbc;
  }

  .tab-btn.active {
    background: linear-gradient(180deg, #171717 0%, #121212 100%);
    color: #f1f1f1;
    box-shadow: inset 0 0 0 1px #262626;
  }

  .tab-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 8px;
    border-radius: 999px;
  }

  .tab-dot.approving,
  .tab-dot.executing {
    background: #00ff88;
    box-shadow: 0 0 8px #00ff8877;
  }

  .tab-content {
    min-height: 0;
    position: relative;
    border: 1px solid #1f1f1f;
    border-radius: 10px;
    background: linear-gradient(180deg, #101010 0%, #0d0d0d 100%);
    overflow: hidden;
  }

  .tab-panel {
    position: absolute;
    inset: 0;
    display: none;
    min-height: 0;
  }

  .tab-panel.visible {
    display: block;
  }

  .terminal-area {
    min-height: 0;
  }

  @media (max-width: 760px) {
    .workspace {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) 300px;
    }

    .sidebar {
      order: 2;
    }
  }
</style>
