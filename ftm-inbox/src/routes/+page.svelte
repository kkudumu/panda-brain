<script lang="ts">
  import { onMount } from 'svelte';

  let healthy = false;
  let loading = true;
  let error = '';

  onMount(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        healthy = true;
      } else {
        error = `Backend returned ${res.status}`;
      }
    } catch (e) {
      error = 'Backend unreachable';
    } finally {
      loading = false;
    }
  });
</script>

<main class="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center p-8">
  <div class="max-w-lg w-full text-center space-y-4">
    <h1 class="text-3xl font-bold tracking-tight">FTM Inbox</h1>
    <p class="text-gray-400 text-sm">Operator Cockpit — scaffold ready</p>

    <div class="mt-8 p-4 rounded-lg border border-gray-800 bg-gray-900 text-sm">
      {#if loading}
        <span class="text-gray-500">Checking backend…</span>
      {:else if healthy}
        <span class="text-green-400">Backend healthy on :8042</span>
      {:else}
        <span class="text-red-400">{error}</span>
      {/if}
    </div>
  </div>
</main>
