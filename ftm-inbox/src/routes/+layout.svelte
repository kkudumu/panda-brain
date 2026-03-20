<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { theme } from '$lib/theme';
	import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';

	onMount(() => {
		theme.init();
	});
</script>

<div class="app-shell">
	<!-- Top nav bar -->
	<header class="topnav">
		<div class="topnav-brand">
			<span class="brand-dot" aria-hidden="true">◉</span>
			<span class="brand-name">ftm inbox</span>
		</div>
		<div class="topnav-actions">
			<ThemeToggle />
		</div>
	</header>

	<!-- Page content (three-column layout lives in +page.svelte) -->
	<slot />
</div>

<style>
	.app-shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	/* ─── Top nav ─── */
	.topnav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6rem 1.25rem;
		background: var(--bg-card);
		border-bottom: 2px solid var(--border-card);
		position: sticky;
		top: 0;
		z-index: 50;
		box-shadow: 0 2px 8px rgba(76, 175, 80, 0.07);
	}

	.topnav-brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: 'Nunito', sans-serif;
		font-weight: 800;
		font-size: 1.1rem;
		color: var(--text-primary);
		user-select: none;
	}

	.brand-dot {
		color: var(--accent-primary);
		font-size: 1rem;
		animation: pulse-dot 2.5s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; }
		50%       { opacity: 0.5; }
	}

	.topnav-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
