import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FtmEventBus } from '../../packages/daemon/src/event-bus.js';
import { FtmStore } from '../../packages/daemon/src/store.js';
import { Blackboard } from '../../packages/daemon/src/blackboard.js';
import {
  registerAllHooks,
  registerGuardHook,
  registerAutoLogHook,
  registerLearningCaptureHook,
  registerPlanGateHook,
  registerSessionEndHook,
  executeSessionEnd,
} from '../../packages/daemon/src/hooks/index.js';
import type { Plan, Task } from '../../packages/daemon/src/index.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeBus(sessionId = 'test-session'): FtmEventBus {
  return new FtmEventBus(sessionId);
}

function makeStore(): FtmStore {
  return new FtmStore(':memory:');
}

function makeBlackboard(store: FtmStore): Blackboard {
  return new Blackboard(store);
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: 'task-1',
    sessionId: 'test-session',
    description: 'Write unit tests for the authentication module',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    taskId: 'task-1',
    steps: [
      { index: 0, description: 'Read existing tests', status: 'pending' },
      { index: 1, description: 'Write new test cases', status: 'pending' },
    ],
    status: 'pending',
    currentStep: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Guard hook
// ---------------------------------------------------------------------------

describe('Guard hook', () => {
  let bus: FtmEventBus;
  let store: FtmStore;

  beforeEach(() => {
    bus = makeBus();
    store = makeStore();
    store.createSession('test-session');
    registerGuardHook(bus, store);
  });

  afterEach(() => {
    store.close();
  });

  it('does not emit guard_triggered for safe tool invocations', () => {
    const triggered: unknown[] = [];
    bus.on('guard_triggered', (e) => triggered.push(e));

    bus.emit('tool_invoked', { toolName: 'read_file', arguments: { path: '/src/index.ts' } });

    expect(triggered).toHaveLength(0);
  });

  it('blocks dangerous tool names (bash)', () => {
    const triggered: unknown[] = [];
    bus.on('guard_triggered', (e) => triggered.push(e));

    bus.emit('tool_invoked', { toolName: 'bash', arguments: { command: 'ls -la' } });

    expect(triggered).toHaveLength(1);
  });

  it('blocks shell tool invocations', () => {
    const triggered: unknown[] = [];
    bus.on('guard_triggered', (e) => triggered.push(e));

    bus.emit('tool_invoked', { toolName: 'shell', arguments: { cmd: 'echo hello' } });

    expect(triggered).toHaveLength(1);
  });

  it('blocks arguments containing rm -rf pattern', () => {
    const triggered: unknown[] = [];
    bus.on('guard_triggered', (e) => triggered.push(e));

    bus.emit('tool_invoked', {
      toolName: 'execute',
      arguments: { command: 'rm -rf /tmp/build' },
    });

    expect(triggered).toHaveLength(1);
  });

  it('blocks arguments containing DROP TABLE', () => {
    const triggered: unknown[] = [];
    bus.on('guard_triggered', (e) => triggered.push(e));

    bus.emit('tool_invoked', {
      toolName: 'query_db',
      arguments: { sql: 'DROP TABLE users' },
    });

    expect(triggered).toHaveLength(1);
  });

  it('blocks arguments containing embedded API keys', () => {
    const triggered: unknown[] = [];
    bus.on('guard_triggered', (e) => triggered.push(e));

    bus.emit('tool_invoked', {
      toolName: 'http_request',
      arguments: { headers: { Authorization: 'api_key: sk-abc1234567890123456789012345678901234567890123456' } },
    });

    expect(triggered).toHaveLength(1);
  });

  it('blocks arguments containing GitHub PAT pattern', () => {
    const triggered: unknown[] = [];
    bus.on('guard_triggered', (e) => triggered.push(e));

    bus.emit('tool_invoked', {
      toolName: 'git_push',
      arguments: { token: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });

    expect(triggered).toHaveLength(1);
  });

  it('persists guard_triggered events to the store', () => {
    bus.emit('tool_invoked', { toolName: 'bash', arguments: { cmd: 'whoami' } });

    const events = store.getEventsByType('guard_triggered', 10);
    expect(events).toHaveLength(1);
    expect(events[0].data.toolName).toBe('bash');
  });

  it('includes violations list in the guard event data', () => {
    const received: unknown[] = [];
    bus.on('guard_triggered', (e) => received.push(e));

    bus.emit('tool_invoked', { toolName: 'bash', arguments: {} });

    const event = received[0] as { data: { violations: string[] } };
    expect(Array.isArray(event.data.violations)).toBe(true);
    expect(event.data.violations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Auto-log hook
// ---------------------------------------------------------------------------

describe('Auto-log hook', () => {
  let bus: FtmEventBus;
  let store: FtmStore;

  beforeEach(() => {
    bus = makeBus();
    store = makeStore();
    store.createSession('test-session');
    registerAutoLogHook(bus, store);
  });

  afterEach(() => {
    store.close();
  });

  it('creates a daily_log entry on task_completed', () => {
    bus.emit('task_completed', {
      taskId: 'task-1',
      description: 'Build authentication module',
      outcome: 'success',
      startedAt: Date.now() - 5000,
    });

    const logs = store.getEventsByType('daily_log', 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].data.category).toBe('task');
    expect(logs[0].data.taskId).toBe('task-1');
  });

  it('includes duration in the log entry', () => {
    const startedAt = Date.now() - 3000;
    bus.emit('task_completed', {
      taskId: 'task-2',
      description: 'Deploy service',
      outcome: 'success',
      startedAt,
    });

    const logs = store.getEventsByType('daily_log', 10);
    expect(logs[0].data.duration).toBeTruthy();
    expect(typeof logs[0].data.duration).toBe('string');
  });

  it('handles task_completed without startedAt gracefully', () => {
    bus.emit('task_completed', {
      taskId: 'task-3',
      description: 'Quick task',
      outcome: 'completed',
    });

    const logs = store.getEventsByType('daily_log', 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].data.duration).toBe('unknown');
  });

  it('creates a daily_log entry on step_completed', () => {
    bus.emit('step_completed', {
      taskId: 'task-1',
      stepIndex: 0,
      description: 'Read source files',
      model: 'claude-3-5-sonnet',
      startedAt: Date.now() - 1000,
    });

    const logs = store.getEventsByType('daily_log', 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].data.category).toBe('step');
    expect(logs[0].data.stepIndex).toBe(0);
  });

  it('accumulates multiple log entries', () => {
    bus.emit('step_completed', { taskId: 'task-1', stepIndex: 0 });
    bus.emit('step_completed', { taskId: 'task-1', stepIndex: 1 });
    bus.emit('task_completed', { taskId: 'task-1', outcome: 'success' });

    const logs = store.getEventsByType('daily_log', 10);
    expect(logs).toHaveLength(3);
  });

  it('records the loggedAt ISO timestamp', () => {
    bus.emit('task_completed', { taskId: 'task-5', outcome: 'success' });

    const logs = store.getEventsByType('daily_log', 10);
    expect(typeof logs[0].data.loggedAt).toBe('string');
    expect(() => new Date(logs[0].data.loggedAt as string)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Learning capture hook
// ---------------------------------------------------------------------------

describe('Learning capture hook', () => {
  let bus: FtmEventBus;
  let store: FtmStore;
  let blackboard: Blackboard;

  beforeEach(() => {
    bus = makeBus();
    store = makeStore();
    store.createSession('test-session');
    blackboard = makeBlackboard(store);
    registerLearningCaptureHook(bus, store, blackboard);
  });

  afterEach(() => {
    store.close();
  });

  it('records a failure experience on error event', () => {
    bus.emit('error', {
      taskId: 'task-1',
      taskDescription: 'Deploy to production',
      message: 'Connection refused to database',
      phase: 'execution',
    });

    const experiences = store.getExperiences({});
    expect(experiences).toHaveLength(1);
    expect(experiences[0].outcome).toBe('failure');
    expect(experiences[0].tags).toContain('error');
  });

  it('includes the error message as a lesson', () => {
    bus.emit('error', {
      taskDescription: 'Run migrations',
      message: 'Table already exists',
      phase: 'setup',
    });

    const experiences = store.getExperiences({});
    expect(experiences[0].lessons[0]).toContain('Table already exists');
  });

  it('records a novel task experience on first task_completed', () => {
    bus.emit('task_completed', {
      taskId: 'task-1',
      description: 'Generate API documentation',
      outcome: 'success',
    });

    const experiences = store.getExperiences({});
    expect(experiences).toHaveLength(1);
    expect(experiences[0].outcome).toBe('success');
    expect(experiences[0].tags).toContain('novel_task');
  });

  it('does not record duplicate experience for repeated task types', () => {
    bus.emit('task_completed', {
      taskId: 'task-1',
      description: 'Write unit tests for module',
      outcome: 'success',
    });
    bus.emit('task_completed', {
      taskId: 'task-2',
      description: 'Write unit tests for component',
      outcome: 'success',
    });

    // Both normalize to the same first-4-word key "write_unit_tests_for"
    const experiences = store.getExperiences({});
    expect(experiences).toHaveLength(1);
  });

  it('escalates recurring errors to a constraint after 3 occurrences', () => {
    const errorData = {
      taskDescription: 'Connect to redis cache',
      message: 'Connection refused to redis',
      phase: 'execution',
    };

    bus.emit('error', { ...errorData });
    bus.emit('error', { ...errorData });
    bus.emit('error', { ...errorData });

    const constraints = blackboard.getConstraints();
    expect(constraints.length).toBeGreaterThan(0);
    // At least one constraint should mention the error type
    expect(constraints.some((c) => c.toLowerCase().includes('connect') || c.toLowerCase().includes('recurr'))).toBe(true);
  });

  it('does not escalate errors below threshold', () => {
    bus.emit('error', {
      taskDescription: 'Fetch remote config',
      message: 'Timeout waiting for response',
      phase: 'network',
    });
    bus.emit('error', {
      taskDescription: 'Fetch remote config',
      message: 'Timeout waiting for response',
      phase: 'network',
    });

    const constraints = blackboard.getConstraints();
    expect(constraints).toHaveLength(0);
  });

  it('adds a decision when escalating', () => {
    const errorData = {
      taskDescription: 'Parse json payload',
      message: 'Unexpected token in JSON',
      phase: 'parse',
    };
    bus.emit('error', { ...errorData });
    bus.emit('error', { ...errorData });
    bus.emit('error', { ...errorData });

    const decisions = blackboard.getRecentDecisions();
    expect(decisions.length).toBeGreaterThan(0);
  });

  it('ignores task_completed events with non-success outcomes', () => {
    bus.emit('task_completed', {
      taskId: 'task-1',
      description: 'Attempt database migration',
      outcome: 'failure',
    });

    const experiences = store.getExperiences({});
    expect(experiences).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Plan gate hook
// ---------------------------------------------------------------------------

describe('Plan gate hook', () => {
  let bus: FtmEventBus;

  beforeEach(() => {
    bus = makeBus();
    registerPlanGateHook(bus);
  });

  it('auto-approves a 1-step micro plan', () => {
    const approved: unknown[] = [];
    bus.on('plan_approved', (e) => approved.push(e));

    const plan = makePlan({
      steps: [{ index: 0, description: 'Run tests', status: 'pending' }],
    });
    bus.emit('plan_generated', { plan });

    expect(approved).toHaveLength(1);
  });

  it('auto-approves a 2-step small plan', () => {
    const approved: unknown[] = [];
    bus.on('plan_approved', (e) => approved.push(e));

    const plan = makePlan({
      steps: [
        { index: 0, description: 'Read config file', status: 'pending' },
        { index: 1, description: 'Write updated config', status: 'pending' },
      ],
    });
    bus.emit('plan_generated', { plan });

    expect(approved).toHaveLength(1);
  });

  it('includes autoApproved=true in the plan_approved payload', () => {
    const approved: { data: Record<string, unknown> }[] = [];
    bus.on('plan_approved', (e) => approved.push(e as { data: Record<string, unknown> }));

    const plan = makePlan({
      steps: [{ index: 0, description: 'Quick check', status: 'pending' }],
    });
    bus.emit('plan_generated', { plan });

    expect(approved[0].data.autoApproved).toBe(true);
    expect(approved[0].data.planId).toBe('plan-1');
  });

  it('does not auto-approve a 3-step medium plan', () => {
    const approved: unknown[] = [];
    const approvalRequested: unknown[] = [];
    bus.on('plan_approved', (e) => approved.push(e));
    bus.on('approval_requested', (e) => approvalRequested.push(e));

    const plan = makePlan({
      steps: [
        { index: 0, description: 'Analyze codebase', status: 'pending' },
        { index: 1, description: 'Refactor auth module', status: 'pending' },
        { index: 2, description: 'Run integration tests', status: 'pending' },
      ],
    });
    bus.emit('plan_generated', { plan });

    expect(approved).toHaveLength(0);
    expect(approvalRequested).toHaveLength(1);
  });

  it('does not auto-approve a plan with requiresApproval step', () => {
    const approved: unknown[] = [];
    const approvalRequested: unknown[] = [];
    bus.on('plan_approved', (e) => approved.push(e));
    bus.on('approval_requested', (e) => approvalRequested.push(e));

    const plan = makePlan({
      steps: [
        { index: 0, description: 'Deploy to production', status: 'pending', requiresApproval: true },
      ],
    });
    bus.emit('plan_generated', { plan });

    expect(approved).toHaveLength(0);
    expect(approvalRequested).toHaveLength(1);
  });

  it('emits guard_triggered for a plan with empty step descriptions', () => {
    const guardEvents: unknown[] = [];
    bus.on('guard_triggered', (e) => guardEvents.push(e));

    const plan = makePlan({
      steps: [
        { index: 0, description: '', status: 'pending' },
      ],
    });
    bus.emit('plan_generated', { plan });

    expect(guardEvents).toHaveLength(1);
  });

  it('emits guard_triggered for a plan with no steps', () => {
    const guardEvents: unknown[] = [];
    bus.on('guard_triggered', (e) => guardEvents.push(e));

    const plan = makePlan({ steps: [] });
    bus.emit('plan_generated', { plan });

    expect(guardEvents).toHaveLength(1);
  });

  it('handles plan_generated event with no plan payload gracefully', () => {
    expect(() => {
      bus.emit('plan_generated', {});
    }).not.toThrow();
  });

  it('emits approval_requested with complexity tier for large plans', () => {
    const approvalRequested: { data: Record<string, unknown> }[] = [];
    bus.on('approval_requested', (e) =>
      approvalRequested.push(e as { data: Record<string, unknown> })
    );

    const plan = makePlan({
      steps: Array.from({ length: 8 }, (_, i) => ({
        index: i,
        description: `Step ${i + 1}: do something meaningful`,
        status: 'pending' as const,
      })),
    });
    bus.emit('plan_generated', { plan });

    expect(approvalRequested).toHaveLength(1);
    expect(approvalRequested[0].data.complexity).toBe('large');
    expect(approvalRequested[0].data.stepCount).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Session end hook
// ---------------------------------------------------------------------------

describe('Session end hook', () => {
  let bus: FtmEventBus;
  let store: FtmStore;
  let blackboard: Blackboard;

  beforeEach(() => {
    bus = makeBus('sess-end');
    store = makeStore();
    store.createSession('sess-end');
    blackboard = makeBlackboard(store);
    registerSessionEndHook(bus, store, blackboard);
  });

  afterEach(() => {
    store.close();
  });

  it('executes session end and persists a session_end event', () => {
    executeSessionEnd('sess-end', store, blackboard);

    const events = store.getEventsByType('session_end', 10);
    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe('sess-end');
  });

  it('marks the session as completed', () => {
    executeSessionEnd('sess-end', store, blackboard);

    const session = store.getSession('sess-end');
    expect(session?.status).toBe('completed');
  });

  it('includes summary data in the session_end event', () => {
    executeSessionEnd('sess-end', store, blackboard);

    const events = store.getEventsByType('session_end', 10);
    const data = events[0].data;
    expect(typeof data.tasksCompleted).toBe('number');
    expect(typeof data.durationMs).toBe('number');
    expect(Array.isArray(data.activeConstraints)).toBe(true);
  });

  it('counts completed tasks in the summary', () => {
    store.logEvent({
      type: 'task_completed',
      timestamp: Date.now(),
      sessionId: 'sess-end',
      data: { taskId: 't1' },
    });
    store.logEvent({
      type: 'task_completed',
      timestamp: Date.now(),
      sessionId: 'sess-end',
      data: { taskId: 't2' },
    });

    const summary = executeSessionEnd('sess-end', store, blackboard);
    expect(summary.tasksCompleted).toBe(2);
  });

  it('counts completed steps in the summary', () => {
    store.logEvent({
      type: 'step_completed',
      timestamp: Date.now(),
      sessionId: 'sess-end',
      data: { stepIndex: 0 },
    });

    const summary = executeSessionEnd('sess-end', store, blackboard);
    expect(summary.stepsCompleted).toBe(1);
  });

  it('fires session_end logic when the session_end event is emitted on the bus', () => {
    bus.emit('session_end', {});

    const events = store.getEventsByType('session_end', 10);
    // One from the bus listener
    expect(events.length).toBeGreaterThanOrEqual(1);

    const session = store.getSession('sess-end');
    expect(session?.status).toBe('completed');
  });

  it('updates blackboard session metadata on end', () => {
    const beforeEnd = Date.now();
    executeSessionEnd('sess-end', store, blackboard);

    const ctx = blackboard.getContext();
    expect(ctx.sessionMetadata.lastUpdated).toBeGreaterThanOrEqual(beforeEnd);
  });

  it('returns a SessionSummary with correct sessionId', () => {
    const summary = executeSessionEnd('sess-end', store, blackboard);
    expect(summary.sessionId).toBe('sess-end');
  });
});

// ---------------------------------------------------------------------------
// registerAllHooks integration smoke test
// ---------------------------------------------------------------------------

describe('registerAllHooks integration', () => {
  it('registers all hooks without throwing', () => {
    const bus = makeBus('integration');
    const store = makeStore();
    store.createSession('integration');
    const blackboard = makeBlackboard(store);

    expect(() => registerAllHooks(bus, store, blackboard)).not.toThrow();

    store.close();
  });

  it('hooks respond to events after full registration', () => {
    const bus = makeBus('integration-2');
    const store = makeStore();
    store.createSession('integration-2');
    const blackboard = makeBlackboard(store);

    registerAllHooks(bus, store, blackboard);

    const guarded: unknown[] = [];
    bus.on('guard_triggered', (e) => guarded.push(e));

    // Trigger guard via dangerous tool
    bus.emit('tool_invoked', { toolName: 'exec', arguments: { cmd: 'rm -rf /' } });
    expect(guarded.length).toBeGreaterThan(0);

    // Trigger auto-log
    bus.emit('task_completed', { taskId: 'int-task-1', description: 'Integration test', outcome: 'success' });
    const logs = store.getEventsByType('daily_log', 10);
    expect(logs.length).toBeGreaterThan(0);

    store.close();
  });
});
