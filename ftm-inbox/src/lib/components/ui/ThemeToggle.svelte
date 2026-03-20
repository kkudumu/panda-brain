<script lang="ts">
	import { theme } from '$lib/theme';

	let rotating = false;

	function handleToggle() {
		rotating = true;
		theme.toggle();
		setTimeout(() => (rotating = false), 400);
	}
</script>

<button
	class="theme-toggle"
	class:rotating
	on:click={handleToggle}
	aria-label={$theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
	title={$theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
>
	{#if $theme === 'light'}
		<!-- Moon icon -->
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	{:else}
		<!-- Sun icon -->
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="5" />
			<line x1="12" y1="1" x2="12" y2="3" />
			<line x1="12" y1="21" x2="12" y2="23" />
			<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
			<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
			<line x1="1" y1="12" x2="3" y2="12" />
			<line x1="21" y1="12" x2="23" y2="12" />
			<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
			<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
		</svg>
	{/if}
</button>

<style>
	.theme-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 9999px;
		border: 2px solid var(--border-card);
		background: var(--bg-card);
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			background 0.2s ease,
			border-color 0.2s ease,
			color 0.2s ease,
			transform 0.18s cubic-bezier(0.68, -0.55, 0.265, 1.55),
			box-shadow 0.18s ease;
	}

	.theme-toggle:hover {
		border-color: var(--accent-primary);
		color: var(--accent-primary);
		transform: scale(1.08);
		box-shadow: 0 2px 12px rgba(76, 175, 80, 0.2);
	}

	.theme-toggle:active {
		transform: scale(0.95);
	}

	.theme-toggle.rotating svg {
		animation: spin-once 0.4s ease-in-out;
	}

	@keyframes spin-once {
		from { transform: rotate(0deg); }
		to   { transform: rotate(360deg); }
	}
</style>
