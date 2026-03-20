<script lang="ts">
	export type Status =
		| 'pending'
		| 'planning'
		| 'approved'
		| 'executing'
		| 'complete'
		| 'failed';

	export let status: Status = 'pending';
	export let label: string | undefined = undefined;

	const labels: Record<Status, string> = {
		pending:   'Pending',
		planning:  'Planning',
		approved:  'Approved',
		executing: 'Executing',
		complete:  'Complete',
		failed:    'Failed'
	};

	const dots: Record<Status, string> = {
		pending:   '○',
		planning:  '◑',
		approved:  '●',
		executing: '◉',
		complete:  '✓',
		failed:    '✕'
	};

	$: displayLabel = label ?? labels[status];
</script>

<span class="badge badge-{status}" role="status">
	<span class="dot" aria-hidden="true">{dots[status]}</span>
	{displayLabel}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 4px 12px;
		border-radius: 12px;
		font-family: 'Nunito', sans-serif;
		font-weight: 700;
		font-size: 0.75rem;
		letter-spacing: 0.02em;
		white-space: nowrap;
		user-select: none;
	}

	.dot {
		font-size: 0.7rem;
		line-height: 1;
	}

	.badge-pending   { background: #fff9c4; color: #5d4037; }
	.badge-planning  { background: #bbdefb; color: #0d47a1; }
	.badge-approved  { background: #c8e6c9; color: #1b5e20; }
	.badge-executing { background: #ffe0b2; color: #bf360c; }
	.badge-complete  { background: #b2dfdb; color: #004d40; }
	.badge-failed    { background: #ffcdd2; color: #b71c1c; }
</style>
