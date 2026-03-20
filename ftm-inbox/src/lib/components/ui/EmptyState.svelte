<script lang="ts">
	export let emoji = '🌱';
	export let title = 'Nothing here yet';
	export let message = 'Items will appear here when they arrive.';
</script>

<div class="empty-state">
	<div class="empty-emoji" aria-hidden="true">{emoji}</div>
	<p class="empty-title">{title}</p>
	<p class="empty-message">{message}</p>
	{#if $$slots.action}
		<div class="empty-action">
			<slot name="action" />
		</div>
	{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		text-align: center;
		color: var(--text-muted);
		min-height: 120px;
	}

	.empty-emoji {
		font-size: 2.5rem;
		line-height: 1;
		margin-bottom: 0.25rem;
		filter: saturate(0.7) opacity(0.8);
		animation: gentle-float 3s ease-in-out infinite;
	}

	.empty-title {
		font-family: 'Nunito', sans-serif;
		font-weight: 700;
		font-size: 0.95rem;
		color: var(--text-secondary);
		margin: 0;
	}

	.empty-message {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin: 0;
		max-width: 200px;
		line-height: 1.5;
	}

	.empty-action {
		margin-top: 0.75rem;
	}

	@keyframes gentle-float {
		0%, 100% { transform: translateY(0px); }
		50%       { transform: translateY(-5px); }
	}
</style>
