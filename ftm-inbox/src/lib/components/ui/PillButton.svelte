<script lang="ts">
	export let variant: 'primary' | 'ghost' | 'danger' = 'primary';
	export let size: 'sm' | 'md' | 'lg' = 'md';
	export let disabled = false;
	export let type: 'button' | 'submit' | 'reset' = 'button';

	const sizeClasses = {
		sm: 'btn-sm',
		md: 'btn-md',
		lg: 'btn-lg'
	};
</script>

<button
	{type}
	{disabled}
	class="pill-btn pill-btn-{variant} {sizeClasses[size]}"
	on:click
	on:mouseenter
	on:mouseleave
>
	{#if $$slots.icon}
		<span class="btn-icon" aria-hidden="true">
			<slot name="icon" />
		</span>
	{/if}
	<slot />
</button>

<style>
	.pill-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 9999px;
		font-family: 'Nunito', sans-serif;
		font-weight: 700;
		cursor: pointer;
		border: none;
		transition:
			transform 0.18s cubic-bezier(0.68, -0.55, 0.265, 1.55),
			box-shadow 0.18s ease,
			background-color 0.18s ease,
			color 0.18s ease,
			border-color 0.18s ease;
		user-select: none;
		white-space: nowrap;
		line-height: 1;
	}

	.pill-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		transform: none !important;
	}

	.pill-btn:not(:disabled):hover {
		transform: scale(1.06) translateY(-1px);
	}

	.pill-btn:not(:disabled):active {
		transform: scale(0.96) translateY(0);
	}

	/* Sizes */
	.btn-sm { padding: 0.35rem 0.9rem; font-size: 0.75rem; }
	.btn-md { padding: 0.5rem 1.25rem; font-size: 0.875rem; }
	.btn-lg { padding: 0.65rem 1.6rem; font-size: 1rem; }

	/* Variants */
	.pill-btn-primary {
		background-color: var(--accent-primary);
		color: #fff;
		box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
	}
	.pill-btn-primary:not(:disabled):hover {
		background-color: var(--accent-hover);
		box-shadow: 0 4px 16px rgba(76, 175, 80, 0.4);
	}

	.pill-btn-ghost {
		background-color: transparent;
		color: var(--text-secondary);
		border: 2px solid var(--border-card);
	}
	.pill-btn-ghost:not(:disabled):hover {
		border-color: var(--accent-primary);
		color: var(--accent-primary);
		background-color: rgba(76, 175, 80, 0.06);
	}

	.pill-btn-danger {
		background-color: #ef5350;
		color: #fff;
		box-shadow: 0 2px 8px rgba(239, 83, 80, 0.25);
	}
	.pill-btn-danger:not(:disabled):hover {
		background-color: #c62828;
		box-shadow: 0 4px 16px rgba(239, 83, 80, 0.35);
	}

	.btn-icon {
		display: flex;
		align-items: center;
	}
</style>
