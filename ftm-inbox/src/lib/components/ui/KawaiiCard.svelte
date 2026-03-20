<script lang="ts">
	export let accent: 'green' | 'yellow' | 'blue' | 'coral' | 'teal' | 'orange' = 'green';
	export let hoverable = false;
	export let compact = false;

	const accentColors: Record<typeof accent, string> = {
		green:  '#4caf50',
		yellow: '#ffd54f',
		blue:   '#42a5f5',
		coral:  '#ff7043',
		teal:   '#26a69a',
		orange: '#ff9800'
	};

	$: borderColor = accentColors[accent];
</script>

<div
	class="kawaii-card"
	class:hoverable
	class:compact
	style="--card-accent: {borderColor}"
>
	{#if $$slots.header}
		<div class="card-header">
			<slot name="header" />
		</div>
	{/if}

	<div class="card-body">
		<slot />
	</div>

	{#if $$slots.footer}
		<div class="card-footer">
			<slot name="footer" />
		</div>
	{/if}
</div>

<style>
	.kawaii-card {
		background: var(--bg-card);
		border: 2px solid var(--border-card);
		border-left: 4px solid var(--card-accent);
		border-radius: 16px;
		box-shadow: var(--shadow-card);
		transition:
			box-shadow 0.2s ease,
			transform 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55),
			border-color 0.2s ease;
		overflow: hidden;
	}

	.kawaii-card.hoverable:hover {
		box-shadow: var(--shadow-card-hover);
		transform: translateY(-2px);
		border-color: var(--card-accent);
	}

	.kawaii-card.hoverable:active {
		transform: translateY(0);
	}

	.card-header {
		padding: 12px 16px 8px;
		border-bottom: 1px solid var(--border-card);
	}

	.card-body {
		padding: 16px;
	}

	.compact .card-body {
		padding: 10px 14px;
	}

	.compact .card-header {
		padding: 8px 14px 6px;
	}

	.card-footer {
		padding: 8px 16px 12px;
		border-top: 1px solid var(--border-card);
	}
</style>
