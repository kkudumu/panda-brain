/**
 * Integration test: OODA Guard Rules & Approval Flow
 *
 * Simulates user scenarios involving:
 * - Destructive operations triggering guard steps
 * - Production-targeting tasks getting safety gates
 * - Approval flow in plan_first mode
 * - Auto-mode bypassing approval
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { FtmServer } from '../../packages/daemon/src/server.js';
import { FtmEventBus } from '../../packages/daemon/src/event-bus.js';
import { FtmStore } from '../../packages/daemon/src/store.js';
import { Blackboard } from '../../packages/daemon/src/blackboard.js';
import { OodaLoop } from '../../packages/daemon/src/ooda.js';
import { ModelRouter } from '../../packages/daemon/src/router.js';
import { AdapterRegistry } from '../../packages/daemon/src/adapters/registry.js';
import type {
  ModelAdapter,
  NormalizedResponse,
  WsResponse,
  FtmEvent,
  Plan,
} from '../../packages/daemon/src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(name: string, responseText = 'executed'): ModelAdapter {
  return {
    name,
    available: vi.fn().mockResolvedValue(true),
    startSession: vi.fn().mockResolvedValue({
      text: responseText,
      toolCalls: [],
      sessionId: `sess-${name}`,
      tokenUsage: { input: 10, output: 20, cached: 0 },
    } satisfies NormalizedResponse),
    resumeSession: vi.fn(),
    parseResponse: vi.fn(),
  };
}

interface Harness {
  server: FtmServer;
  eventBus: FtmEventBus;
  store: FtmStore;
  blackboard: Blackboard;
  ooda: OodaLoop;
  router: ModelRouter;
  port: number;
  sessionId: string;
}

async function buildHarness(approvalMode: 'auto' | 'plan_first' | 'always_ask'): Promise<Harness> {
  const sessionId = `test-guard-${Date.now()}`;
  const store = new FtmStore(':memory:');
  store.createSession(sessionId);

  const eventBus = new FtmEventBus(sessionId);
  const blackboard = new Blackboard(store);

  const registry = new AdapterRegistry();
  for (const name of ['claude', 'codex', 'gemini', 'ollama']) {
    registry.register(makeAdapter(name));
  }

  const router = new ModelRouter(registry, eventBus);
  vi.spyOn(router, 'getConfig').mockReturnValue({
    ...router.getConfig(),
    execution: { ...router.getConfig().execution, approvalMode },
  });

  const ooda = new OodaLoop(eventBus, blackboard, router);
  const server = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
  await server.start(0, '127.0.0.1');
  const port = server.getPort()!;

  return { server, eventBus, store, blackboard, ooda, router, port, sessionId };
}

function connect(port: number): Promise<{ ws: WebSocket; initMsg: WsResponse }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('error', reject);
    ws.once('message', (raw) => {
      resolve({ ws, initMsg: JSON.parse(raw.toString()) as WsResponse });
    });
  });
}

function send(ws: WebSocket, msg: Record<string, unknown>): Promise<WsResponse> {
  return new Promise((resolve) => {
    const id = msg.id as string;
    const handler = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const parsed = JSON.parse(raw.toString()) as WsResponse;
      if (parsed.id === id) {
        ws.off('message', handler);
        resolve(parsed);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

// ---------------------------------------------------------------------------
// Scenario 1: Guard rules detect destructive operations
// ---------------------------------------------------------------------------

describe('When a user submits a task with destructive keywords', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness('auto');
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('the plan includes a requiresApproval confirmation step for "delete" keywords', async () => {
    const planEvents: FtmEvent[] = [];
    h.eventBus.on('plan_generated', (evt: FtmEvent) => planEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'guard-delete',
      payload: { description: 'Delete all old migration files from the repo' },
    });

    await vi.waitFor(() => {
      expect(planEvents.length).toBe(1);
    }, { timeout: 3000 });

    const plan = planEvents[0].data.plan as Plan;
    const approvalStep = plan.steps.find((s) => s.requiresApproval === true);
    expect(approvalStep).toBeDefined();
    expect(approvalStep!.description).toMatch(/destructive/i);
    ws.close();
  });

  it('the plan includes a requiresApproval step for "rm -rf" patterns', async () => {
    const planEvents: FtmEvent[] = [];
    h.eventBus.on('plan_generated', (evt: FtmEvent) => planEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'guard-rmrf',
      payload: { description: 'Clean up temp directory by running rm -rf /tmp/build-cache' },
    });

    await vi.waitFor(() => {
      expect(planEvents.length).toBe(1);
    }, { timeout: 3000 });

    const plan = planEvents[0].data.plan as Plan;
    expect(plan.steps.some((s) => s.requiresApproval === true)).toBe(true);
    ws.close();
  });

  it('the plan includes a requiresApproval step for "reset --hard"', async () => {
    const planEvents: FtmEvent[] = [];
    h.eventBus.on('plan_generated', (evt: FtmEvent) => planEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'guard-reset',
      payload: { description: 'Fix the mess by running git reset --hard HEAD~5' },
    });

    await vi.waitFor(() => {
      expect(planEvents.length).toBe(1);
    }, { timeout: 3000 });

    const plan = planEvents[0].data.plan as Plan;
    expect(plan.steps.some((s) => s.requiresApproval)).toBe(true);
    ws.close();
  });

  it('safe tasks have no requiresApproval guard steps', async () => {
    const planEvents: FtmEvent[] = [];
    h.eventBus.on('plan_generated', (evt: FtmEvent) => planEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'guard-safe',
      payload: { description: 'Add TypeScript strict mode to the project config' },
    });

    await vi.waitFor(() => {
      expect(planEvents.length).toBe(1);
    }, { timeout: 3000 });

    const plan = planEvents[0].data.plan as Plan;
    const approvalSteps = plan.steps.filter((s) => s.requiresApproval === true);
    expect(approvalSteps).toHaveLength(0);
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Production targeting adds a guard step
// ---------------------------------------------------------------------------

describe('When a user submits a task targeting production', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness('auto');
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('the plan includes a production guard step', async () => {
    const planEvents: FtmEvent[] = [];
    h.eventBus.on('plan_generated', (evt: FtmEvent) => planEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'guard-prod',
      payload: { description: 'Deploy the hotfix to production servers' },
    });

    await vi.waitFor(() => {
      expect(planEvents.length).toBe(1);
    }, { timeout: 3000 });

    const plan = planEvents[0].data.plan as Plan;
    const guardStep = plan.steps.find((s) => s.requiresApproval);
    expect(guardStep).toBeDefined();
    expect(guardStep!.description).toMatch(/production/i);
    ws.close();
  });

  it('both destructive and production guards fire simultaneously', async () => {
    const planEvents: FtmEvent[] = [];
    h.eventBus.on('plan_generated', (evt: FtmEvent) => planEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'guard-both',
      payload: { description: 'Drop the legacy users table from the production database' },
    });

    await vi.waitFor(() => {
      expect(planEvents.length).toBe(1);
    }, { timeout: 3000 });

    const plan = planEvents[0].data.plan as Plan;
    const approvalSteps = plan.steps.filter((s) => s.requiresApproval === true);
    // Should have at least 2 guard steps: destructive + production
    expect(approvalSteps.length).toBeGreaterThanOrEqual(2);
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: plan_first approval mode requires explicit approval
// ---------------------------------------------------------------------------

describe('When approvalMode is plan_first', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness('plan_first');
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('the OODA loop emits approval_requested and waits for approval', async () => {
    const approvalEvents: FtmEvent[] = [];
    h.eventBus.on('approval_requested', (evt: FtmEvent) => {
      if ('taskId' in evt.data) approvalEvents.push(evt);
    });

    // Auto-approve after a short delay so the test doesn't hang
    h.eventBus.on('plan_generated', (evt: FtmEvent) => {
      const plan = evt.data.plan as Plan;
      setTimeout(() => {
        h.eventBus.emit('plan_approved', { planId: plan.id });
      }, 50);
    });

    const { ws } = await connect(h.port);
    const resp = await send(ws, {
      type: 'submit_task',
      id: 'approval-1',
      payload: { description: 'Migrate database schema to v2' },
    });

    const taskId = resp.payload.taskId as string;

    await vi.waitFor(() => {
      const task = h.store.getTask(taskId);
      expect(task!.status).toBe('completed');
    }, { timeout: 5000 });

    expect(approvalEvents.length).toBeGreaterThanOrEqual(1);
    ws.close();
  });

  it('the user can approve a plan via the approve_plan WebSocket message', async () => {
    let pendingPlanId: string | null = null;

    h.eventBus.on('plan_generated', (evt: FtmEvent) => {
      pendingPlanId = (evt.data.plan as Plan).id;
    });

    const { ws } = await connect(h.port);

    const submitResp = await send(ws, {
      type: 'submit_task',
      id: 'approval-ws-1',
      payload: { description: 'Update caching layer for better performance' },
    });
    const taskId = submitResp.payload.taskId as string;

    // Wait for the plan to be generated
    await vi.waitFor(() => {
      expect(pendingPlanId).not.toBeNull();
    }, { timeout: 3000 });

    // Approve via WebSocket (same way the CLI approve command works)
    const approveResp = await send(ws, {
      type: 'approve_plan',
      id: 'approval-ws-2',
      payload: { planId: pendingPlanId },
    });

    expect(approveResp.type).toBe('plan_approved');
    expect(approveResp.success).toBe(true);

    // Task should complete after approval
    await vi.waitFor(() => {
      const task = h.store.getTask(taskId);
      expect(task!.status).toBe('completed');
    }, { timeout: 5000 });

    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: auto mode skips approval entirely
// ---------------------------------------------------------------------------

describe('When approvalMode is auto', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness('auto');
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('the task completes without any approval_requested event for the top-level plan', async () => {
    const topLevelApprovals: FtmEvent[] = [];
    h.eventBus.on('approval_requested', (evt: FtmEvent) => {
      if ('taskId' in evt.data) topLevelApprovals.push(evt);
    });

    const { ws } = await connect(h.port);
    const resp = await send(ws, {
      type: 'submit_task',
      id: 'auto-1',
      payload: { description: 'Lint and format all source files' },
    });

    const taskId = resp.payload.taskId as string;

    await vi.waitFor(() => {
      const task = h.store.getTask(taskId);
      expect(task!.status).toBe('completed');
    }, { timeout: 3000 });

    expect(topLevelApprovals).toHaveLength(0);
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Task complexity classification affects the plan
// ---------------------------------------------------------------------------

describe('When tasks of different complexity are submitted', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness('auto');
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('a micro task (few words) produces a single-step plan', async () => {
    const planEvents: FtmEvent[] = [];
    h.eventBus.on('plan_generated', (evt: FtmEvent) => planEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'micro-1',
      payload: { description: 'Fix typo' },
    });

    await vi.waitFor(() => {
      expect(planEvents.length).toBe(1);
    }, { timeout: 3000 });

    const plan = planEvents[0].data.plan as Plan;
    // Micro task with no guard flags = just 1 step (the task itself)
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].description).toBe('Fix typo');
    ws.close();
  });

  it('a task with guard triggers gets extra steps prepended', async () => {
    const planEvents: FtmEvent[] = [];
    h.eventBus.on('plan_generated', (evt: FtmEvent) => planEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'guarded-1',
      payload: { description: 'Remove the deprecated endpoint from production' },
    });

    await vi.waitFor(() => {
      expect(planEvents.length).toBe(1);
    }, { timeout: 3000 });

    const plan = planEvents[0].data.plan as Plan;
    // Should have guard steps + the main task step
    expect(plan.steps.length).toBeGreaterThan(1);
    // Last step should be the actual task
    expect(plan.steps[plan.steps.length - 1].description).toBe(
      'Remove the deprecated endpoint from production',
    );
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Playbook matching during observe phase
// ---------------------------------------------------------------------------

describe('When a task matches a saved playbook', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness('auto');
    // Seed a playbook
    h.store.savePlaybook({
      id: 'pb-review',
      name: 'Code Review',
      trigger: 'review pull request',
      steps: ['fetch diff', 'analyze changes', 'write comments'],
      lastUsed: 0,
      useCount: 0,
    });
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('the playbook_matched event fires during observe phase', async () => {
    const matchEvents: FtmEvent[] = [];
    h.eventBus.on('playbook_matched', (evt: FtmEvent) => matchEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'pb-match',
      payload: { description: 'review pull request' },
    });

    await vi.waitFor(() => {
      expect(matchEvents.length).toBe(1);
    }, { timeout: 3000 });

    expect(matchEvents[0].data.playbookId).toBe('pb-review');
    ws.close();
  });

  it('the playbook use count is incremented', async () => {
    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'pb-count',
      payload: { description: 'review pull request' },
    });

    await vi.waitFor(() => {
      const pb = h.store.getPlaybook('pb-review');
      expect(pb!.useCount).toBe(1);
    }, { timeout: 3000 });

    ws.close();
  });

  it('no playbook_matched event fires for unrelated tasks', async () => {
    const matchEvents: FtmEvent[] = [];
    h.eventBus.on('playbook_matched', (evt: FtmEvent) => matchEvents.push(evt));

    const { ws } = await connect(h.port);
    await send(ws, {
      type: 'submit_task',
      id: 'pb-nomatch',
      payload: { description: 'Build a new API endpoint' },
    });

    await vi.waitFor(() => {
      const task = h.store.getRecentTasks(1);
      expect(task.length).toBeGreaterThan(0);
      expect(['completed', 'failed']).toContain(task[0].status);
    }, { timeout: 3000 });

    expect(matchEvents).toHaveLength(0);
    ws.close();
  });
});
