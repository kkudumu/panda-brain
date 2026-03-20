<script lang="ts">
	export let open = false;
	export let height = 200;
	export let title = 'Agent Output';

	export let lines: string[] = [];

	function toggle() {
		open = !open;
	}

	let logEl: HTMLDivElement;

	$: if (logEl && lines) {
		// Auto-scroll to bottom when new lines arrive
		setTimeout(() => {
			if (logEl) logEl.scrollTop = logEl.scrollHeight;
		}, 0);
	}
</script>

<div class="stream-drawer" class:open>
	<button class="drawer-toggle" on:click={toggle} aria-expanded={open}>
		<span class="toggle-icon" aria-hidden="true">{open ? '▼' : '▲'}</span>
		<span class="toggle-title">{title}</span>
		{#if lines.length > 0}
			<span class="line-count">{lines.length} lines</span>
		{/if}
	</button>

	{#if open}
		<div class="drawer-body" style="height: {height}px" bind:this={logEl}>
			{#if lines.length === 0}
				<p class="drawer-empty">Waiting for agent output...</p>
			{:else}
				{#each lines as line, i (i)}
					<div class="log-line" class:log-error={line.startsWith('ERROR')} class:log-success={line.startsWith('OK') || line.startsWith('✓')}>
						<span class="log-index">{String(i + 1).padStart(3, '0')}</span>
						<span class="log-text">{line}</span>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.stream-drawer {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--bg-drawer);
		border-top: 2px solid var(--border-accent);
		z-index: 100;
		transition: box-shadow 0.2s ease;
	}

	.stream-drawer.open {
		box-shadow: 0 -4px 24px rgba(76, 175, 80, 0.15);
	}

	.drawer-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 1rem;
		background: none;
		border: none;
		cursor: pointer;
		font-family: 'Nunito', sans-serif;
		font-weight: 700;
		font-size: 0.8rem;
		color: var(--text-secondary);
		transition: color 0.15s ease, background 0.15s ease;
	}

	.drawer-toggle:hover {
		color: var(--accent-primary);
		background: rgba(76, 175, 80, 0.04);
	}

	.toggle-icon {
		font-size: 0.65rem;
	}

	.toggle-title {
		flex: 1;
		text-align: left;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		font-size: 0.7rem;
	}

	.line-count {
		font-size: 0.7rem;
		color: var(--text-muted);
		background: var(--border-card);
		padding: 2px 8px;
		border-radius: 9999px;
	}

	.drawer-body {
		overflow-y: auto;
		font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
		font-size: 0.75rem;
		line-height: 1.6;
		padding: 0.5rem 0;
		scrollbar-width: thin;
	}

	.drawer-empty {
		padding: 0.75rem 1rem;
		color: var(--text-muted);
		font-family: 'Nunito', sans-serif;
		font-style: italic;
		font-size: 0.8rem;
		margin: 0;
	}

	.log-line {
		display: flex;
		gap: 0.75rem;
		padding: 0.1rem 1rem;
		color: var(--text-secondary);
		transition: background 0.1s;
	}

	.log-line:hover {
		background: rgba(76, 175, 80, 0.04);
	}

	.log-index {
		color: var(--text-muted);
		user-select: none;
		min-width: 2rem;
		text-align: right;
	}

	.log-text {
		white-space: pre-wrap;
		word-break: break-word;
		flex: 1;
	}

	.log-error .log-text { color: #ef5350; }
	.log-success .log-text { color: var(--accent-primary); }
</style>
