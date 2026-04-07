<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { daemonState, connect, disconnect, machineState } from './lib/daemon-client.js';
  import Machine from './components/Machine.svelte';
  import InputPanel from './components/InputPanel.svelte';
  import PlanView from './components/PlanView.svelte';
  import ExecutionView from './components/ExecutionView.svelte';
  import TerminalPanel from './components/TerminalPanel.svelte';
  import MemoryPanel from './components/MemoryPanel.svelte';

  // Tab state
  type Tab = 'plan' | 'execution' | 'memory';
  let activeTab = $state<Tab>('plan');

  // Connection state derived from store
  let connected = $derived($daemonState.connected);
  let state = $derived($daemonState.machineState);

  // Auto-switch tab based on machine state
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

<main class="app">
  <!-- Machine header -->
  <header class="machine-area">
    <Machine />
    <div class="machine-meta">
      <span class="conn-dot" class:online={connected} title={connected ? 'Connected' : 'Disconnected'}></span>
      <span class="conn-label {stateClass(state)}">{connected ? stateLabel(state) : 'OFFLINE'}</span>
    </div>
  </header>

  <!-- Input panel -->
  <section class="input-area" aria-label="Task input">
    <InputPanel />
  </section>

  <!-- Tabbed panel area -->
  <section class="panels-area" aria-label="Task panels">
    <nav class="tab-nav" role="tablist">
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
    </nav>

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

  <!-- Terminal slides up from bottom -->
  <div class="terminal-area">
    <TerminalPanel />
  </div>
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

  .app {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    height: 100vh;
    padding: 12px 14px;
    gap: 10px;
    min-height: 0;
    overflow: hidden;
  }

  /* Machine header */
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
    50% { opacity: 0.5; }
  }

  /* Input area */
  .input-area {
    min-height: 0;
  }

  /* Panels area */
  .panels-area {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .tab-nav {
    display: flex;
    gap: 2px;
    padding: 0 0 0 1px;
    margin-bottom: -1px;
    position: relative;
    z-index: 1;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    background: #0f0f0f;
    border: 1px solid #1a1a1a;
    border-bottom: 1px solid #0f0f0f;
    border-radius: 4px 4px 0 0;
    color: #444;
    font-family: inherit;
    font-size: 10px;
    letter-spacing: 0.15em;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .tab-btn:hover {
    color: #666;
    background: #131313;
  }

  .tab-btn.active {
    background: #111;
    border-color: #222;
    border-bottom-color: #111;
    color: #e0e0e0;
  }

  .tab-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }

  .tab-dot.approving {
    background: #ffaa00;
    animation: pulse-tab 1s ease-in-out infinite;
  }

  .tab-dot.executing {
    background: #00ff88;
    animation: pulse-tab 0.8s ease-in-out infinite;
  }

  @keyframes pulse-tab {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .tab-content {
    flex: 1;
    background: #111;
    border: 1px solid #222;
    border-radius: 0 4px 4px 4px;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .tab-panel {
    display: none;
    height: 100%;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #222 #111;
  }

  .tab-panel::-webkit-scrollbar {
    width: 4px;
  }

  .tab-panel::-webkit-scrollbar-track {
    background: #111;
  }

  .tab-panel::-webkit-scrollbar-thumb {
    background: #222;
    border-radius: 2px;
  }

  .tab-panel.visible {
    display: block;
    animation: fade-in 150ms ease;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Terminal area at bottom */
  .terminal-area {
    min-height: 0;
  }
</style>
