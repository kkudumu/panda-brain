<script lang="ts">
	import KawaiiCard from '$lib/components/ui/KawaiiCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import PillButton from '$lib/components/ui/PillButton.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StreamDrawer from '$lib/components/ui/StreamDrawer.svelte';
	import type { Status } from '$lib/components/ui/StatusBadge.svelte';

	// Sample task data for layout preview
	const sampleTasks = [
		{
			id: 'TASK-001',
			title: 'Review security alert from Jira',
			source: 'jira',
			status: 'pending' as Status,
			age: '2m ago'
		},
		{
			id: 'TASK-002',
			title: 'Freshservice ticket: DB migration approval',
			source: 'freshservice',
			status: 'planning' as Status,
			age: '15m ago'
		},
		{
			id: 'TASK-003',
			title: 'Slack: deploy to staging requested',
			source: 'slack',
			status: 'approved' as Status,
			age: '1h ago'
		},
		{
			id: 'TASK-004',
			title: 'Gmail: onboarding email follow-up',
			source: 'gmail',
			status: 'executing' as Status,
			age: '2h ago'
		}
	];

	const auditEntries = [
		{ time: '13:08:01', level: 'info',    msg: 'Poller connected: jira' },
		{ time: '13:08:02', level: 'info',    msg: 'Poller connected: freshservice' },
		{ time: '13:10:44', level: 'info',    msg: 'Task TASK-001 ingested' },
		{ time: '13:11:02', level: 'info',    msg: 'Plan generated for TASK-001' },
		{ time: '13:11:05', level: 'warn',    msg: 'Approval gate: awaiting human' },
		{ time: '13:25:18', level: 'success', msg: 'Task TASK-003 approved, executing' }
	];

	const sourceAccent: Record<string, 'blue' | 'green' | 'yellow' | 'coral'> = {
		jira:          'blue',
		freshservice:  'green',
		slack:         'yellow',
		gmail:         'coral'
	};

	let selectedTask = sampleTasks[0];
	let drawerOpen = false;

	const drawerLines = [
		'[13:25:18] Agent started: task-executor',
		'[13:25:19] Fetching Jira context for TASK-001...',
		'[13:25:20] Context fetched: 3 linked issues found',
		'[13:25:21] Analyzing security impact...',
		'[13:25:23] OK Draft remediation plan generated',
		'[13:25:24] Awaiting approval gate...'
	];

	const planSteps = [
		{ step: 1, label: 'Fetch context from Jira',   done: true  },
		{ step: 2, label: 'Analyze security impact',   done: true  },
		{ step: 3, label: 'Draft remediation plan',    done: false },
		{ step: 4, label: 'Await human approval',      done: false },
		{ step: 5, label: 'Execute approved actions',  done: false }
	];
</script>

<!-- Three-column layout + bottom drawer -->
<div class="layout-grid">
	<!-- Left: Task Inbox -->
	<aside class="sidebar sidebar-left" aria-label="Task inbox">
		<div class="sidebar-header">
			<h2 class="sidebar-title">Inbox</h2>
			<span class="sidebar-count">{sampleTasks.length}</span>
		</div>
		<div class="sidebar-body">
			{#if sampleTasks.length === 0}
				<EmptyState
					emoji="📭"
					title="Inbox is clear"
					message="No pending tasks right now."
				/>
			{:else}
				<div class="task-list">
					{#each sampleTasks as task (task.id)}
						<button
							class="task-item"
							class:selected={selectedTask?.id === task.id}
							on:click={() => (selectedTask = task)}
						>
							<div class="task-item-top">
								<span class="task-source badge-source-{task.source}">{task.source}</span>
								<span class="task-age">{task.age}</span>
							</div>
							<p class="task-title">{task.title}</p>
							<div class="task-item-bottom">
								<StatusBadge status={task.status} />
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</aside>

	<!-- Center: Plan Viewer -->
	<section class="center-panel" aria-label="Plan viewer">
		{#if selectedTask}
			<div class="plan-viewer">
				<div class="plan-header">
					<div class="plan-header-top">
						<span class="plan-id">{selectedTask.id}</span>
						<StatusBadge status={selectedTask.status} />
					</div>
					<h1 class="plan-title">{selectedTask.title}</h1>
				</div>

				<KawaiiCard accent={sourceAccent[selectedTask.source] ?? 'green'}>
					<span slot="header" class="card-label">Execution Plan</span>

					<ol class="plan-steps">
						{#each planSteps as s (s.step)}
							<li class="plan-step" class:done={s.done}>
								<span class="step-num">{s.step}</span>
								<span class="step-label">{s.label}</span>
								{#if s.done}
									<span class="step-check" aria-label="complete">✓</span>
								{/if}
							</li>
						{/each}
					</ol>

					<div slot="footer" class="plan-actions">
						<PillButton variant="primary" size="sm">Approve</PillButton>
						<PillButton variant="ghost" size="sm">Reject</PillButton>
						<PillButton variant="ghost" size="sm">View Details</PillButton>
					</div>
				</KawaiiCard>
			</div>
		{:else}
			<EmptyState
				emoji="🗂️"
				title="Select a task"
				message="Choose a task from the inbox to view its plan."
			/>
		{/if}
	</section>

	<!-- Right: Audit Log -->
	<aside class="sidebar sidebar-right" aria-label="Audit log">
		<div class="sidebar-header">
			<h2 class="sidebar-title">Audit Log</h2>
		</div>
		<div class="sidebar-body">
			{#if auditEntries.length === 0}
				<EmptyState
					emoji="📋"
					title="No events yet"
					message="Audit events will appear here."
				/>
			{:else}
				<div class="audit-list">
					{#each auditEntries as entry, i (i)}
						<div class="audit-entry audit-{entry.level}">
							<span class="audit-time">{entry.time}</span>
							<span class="audit-msg">{entry.msg}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</aside>
</div>

<!-- Bottom drawer for streaming agent output -->
<StreamDrawer bind:open={drawerOpen} lines={drawerLines} />

<style>
	/* ─── Three-column layout ─── */
	.layout-grid {
		display: flex;
		flex: 1;
		height: calc(100vh - 57px - 36px); /* minus nav height minus drawer handle */
		overflow: hidden;
	}

	.sidebar {
		display: flex;
		flex-direction: column;
		background: var(--bg-sidebar);
		overflow: hidden;
		flex-shrink: 0;
	}

	.sidebar-left {
		width: 280px;
		border-right: 1px solid var(--border-card);
	}

	.sidebar-right {
		width: 320px;
		border-left: 1px solid var(--border-card);
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem 0.5rem;
		border-bottom: 1px solid var(--border-card);
		background: var(--bg-card);
		flex-shrink: 0;
	}

	.sidebar-title {
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0;
	}

	.sidebar-count {
		font-size: 0.68rem;
		font-weight: 800;
		background: var(--border-card);
		color: var(--text-muted);
		padding: 2px 7px;
		border-radius: 9999px;
	}

	.sidebar-body {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
	}

	.center-panel {
		flex: 1;
		overflow-y: auto;
		padding: 1.25rem;
		min-width: 0;
	}

	/* ─── Task inbox list ─── */
	.task-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.task-item {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--bg-card);
		border: 2px solid var(--border-card);
		border-radius: 12px;
		padding: 0.65rem 0.75rem;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease,
			transform 0.15s cubic-bezier(0.68, -0.55, 0.265, 1.55);
		font-family: 'Nunito', sans-serif;
	}

	.task-item:hover {
		border-color: var(--accent-primary);
		transform: translateX(2px);
	}

	.task-item.selected {
		border-color: var(--accent-primary);
		box-shadow: var(--shadow-card-hover);
		background: var(--bg-secondary);
	}

	.task-item-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.3rem;
	}

	.task-source {
		font-size: 0.65rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 2px 8px;
		border-radius: 9999px;
	}

	.badge-source-jira         { background: #bbdefb; color: #0d47a1; }
	.badge-source-freshservice { background: #c8e6c9; color: #1b5e20; }
	.badge-source-slack        { background: #fff9c4; color: #5d4037; }
	.badge-source-gmail        { background: #ffccbc; color: #bf360c; }

	.task-age {
		font-size: 0.68rem;
		color: var(--text-muted);
	}

	.task-title {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 0.4rem;
		line-height: 1.35;
	}

	.task-item-bottom {
		display: flex;
		align-items: center;
	}

	/* ─── Plan viewer ─── */
	.plan-viewer {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 680px;
		margin: 0 auto;
		animation: fadeUp 0.3s ease-out both;
	}

	@keyframes fadeUp {
		from { opacity: 0; transform: translateY(8px); }
		to   { opacity: 1; transform: translateY(0); }
	}

	.plan-header {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.plan-header-top {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.plan-id {
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		font-family: 'Menlo', monospace;
	}

	.plan-title {
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--text-primary);
		line-height: 1.3;
	}

	.card-label {
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	.plan-steps {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.plan-step {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		background: var(--bg-secondary);
		font-size: 0.875rem;
		color: var(--text-secondary);
		transition: background 0.15s;
	}

	.plan-step.done {
		color: var(--text-muted);
		text-decoration: line-through;
		background: transparent;
	}

	.step-num {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 9999px;
		background: var(--border-card);
		font-size: 0.7rem;
		font-weight: 800;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.plan-step.done .step-num {
		background: #c8e6c9;
		color: #1b5e20;
	}

	.step-label {
		flex: 1;
		font-weight: 600;
	}

	.step-check {
		color: #4caf50;
		font-weight: 800;
		font-size: 0.85rem;
	}

	.plan-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	/* ─── Audit log ─── */
	.audit-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.audit-entry {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.4rem 0.5rem;
		border-radius: 8px;
		font-size: 0.72rem;
		border-left: 3px solid transparent;
		transition: background 0.1s;
	}

	.audit-entry:hover { background: rgba(76, 175, 80, 0.04); }

	.audit-info    { border-left-color: #66bb6a; }
	.audit-warn    { border-left-color: #ffd54f; background: rgba(255, 213, 79, 0.06); }
	.audit-success { border-left-color: #4caf50; background: rgba(76, 175, 80, 0.06); }
	.audit-error   { border-left-color: #ef5350; background: rgba(239, 83, 80, 0.06); }

	.audit-time {
		font-family: 'Menlo', monospace;
		font-size: 0.65rem;
		color: var(--text-muted);
	}

	.audit-msg {
		color: var(--text-secondary);
		font-weight: 600;
		line-height: 1.4;
	}

	/* ─── Mobile responsive ─── */
	@media (max-width: 768px) {
		.layout-grid {
			flex-direction: column;
			height: auto;
			overflow: visible;
		}

		.sidebar-left,
		.sidebar-right {
			width: 100%;
			border-right: none;
			border-left: none;
			border-bottom: 1px solid var(--border-card);
			max-height: 40vh;
		}
	}
</style>
