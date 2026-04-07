<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { daemonState, connect, disconnect } from './lib/daemon-client';
  import type { MachineState } from '../shared/types';

  let connected = $state(false);

  onMount(async () => {
    try {
      await connect();
      connected = true;
    } catch (err) {
      console.error('Failed to connect to daemon:', err);
    }
  });

  onDestroy(() => {
    disconnect();
  });
</script>

<main class="app">
  <div class="machine-area">
    {#if !connected}
      <div class="connecting">Connecting to daemon...</div>
    {:else}
      <div class="machine-placeholder">
        <!-- Machine component will go here (Task 8) -->
        <pre class="ascii-machine">
╔══════════════════════════════╗
║     ░░░ F T M ░░░           ║
║        ·  ·  ·              ║
║     ◊  STANDING BY  ◊       ║
║        ·  ·  ·              ║
╚══════════════════════════════╝
        </pre>
        <div class="status">
          State: {$daemonState.machineState ?? 'idle'}
        </div>
      </div>
    {/if}
  </div>

  <div class="input-area">
    <!-- InputPanel component will go here (Task 9) -->
    <div class="input-placeholder">
      <input type="text" placeholder="Feed the machine..." class="task-input" />
    </div>
  </div>

  <div class="panels-area">
    <!-- Plan/Execution/Memory panels will go here (Tasks 10-12) -->
    <div class="panels-placeholder">
      <span class="panel-label">Ready</span>
    </div>
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

  .app {
    display: grid;
    grid-template-rows: 1fr auto auto;
    height: 100vh;
    padding: 16px;
    gap: 12px;
    box-sizing: border-box;
  }

  .machine-area {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
  }

  .connecting {
    color: #666;
    font-size: 14px;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  .ascii-machine {
    color: #00ff88;
    font-size: 16px;
    line-height: 1.4;
    text-align: center;
  }

  .status {
    text-align: center;
    color: #666;
    font-size: 12px;
    margin-top: 8px;
  }

  .input-area {
    padding: 8px 0;
  }

  .task-input {
    width: 100%;
    padding: 12px 16px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    color: #e0e0e0;
    font-family: inherit;
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
  }

  .task-input:focus {
    border-color: #00ff88;
    box-shadow: 0 0 0 1px #00ff8833;
  }

  .task-input::placeholder {
    color: #555;
  }

  .panels-area {
    padding: 8px 0;
    border-top: 1px solid #1a1a1a;
  }

  .panel-label {
    color: #444;
    font-size: 12px;
  }
</style>
