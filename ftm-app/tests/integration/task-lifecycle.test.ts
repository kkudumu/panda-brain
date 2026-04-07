/**
 * Integration test: Task Lifecycle — End-to-End
 *
 * Simulates a real user submitting tasks via WebSocket (as the CLI and UI do),
 * watching them flow through the OODA loop, and receiving results/events.
 *
 * All model adapters are mocked so no real CLIs are called.
 * SQLite is in-memory.
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
  Task,
  ModelAdapter,
  NormalizedResponse,
  WsResponse,
  FtmEvent,
} from '../../packages/daemon/src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(name: string, responseText = 'done'): ModelAdapter {
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
  registry: AdapterRegistry;
  port: number;
  sessionId: string;
  adapters: ModelAdapter[];
}

async function buildHarness(opts: {
  approvalMode?: 'auto' | 'plan_first' | 'always_ask';
  adapterResponse?: string;
} = {}): Promise<Harness> {
  const sessionId = `test-${Date.now()}`;
  const store = new FtmStore(':memory:');
  store.createSession(sessionId);

  const eventBus = new FtmEventBus(sessionId);
  const blackboard = new Blackboard(store);

  const registry = new AdapterRegistry();
  const adapters = [
    makeAdapter('claude', opts.adapterResponse ?? 'Claude response'),
    makeAdapter('codex', opts.adapterResponse ?? 'Codex response'),
    makeAdapter('gemini', opts.adapterResponse ?? 'Gemini response'),
    makeAdapter('ollama', opts.adapterResponse ?? 'Ollama response'),
  ];
  for (const a of adapters) registry.register(a);

  const router = new ModelRouter(registry, eventBus);

  if (opts.approvalMode) {
    vi.spyOn(router, 'getConfig').mockReturnValue({
      ...router.getConfig(),
      execution: { ...router.getConfig().execution, approvalMode: opts.approvalMode },
    });
  }

  const ooda = new OodaLoop(eventBus, blackboard, router);
  const server = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
  await server.start(0, '127.0.0.1');
  const port = server.getPort()!;

  return { server, eventBus, store, blackboard, ooda, router, registry, port, sessionId, adapters };
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

function collectUntil(
  ws: WebSocket,
  predicate: (msg: WsResponse) => boolean,
  timeoutMs = 5000,
): Promise<WsResponse[]> {
  return new Promise((resolve, reject) => {
    const msgs: WsResponse[] = [];
    const timeout = setTimeout(() => {
      ws.off('message', handler);
      resolve(msgs); // resolve with what we have rather than rejecting
    }, timeoutMs);

    const handler = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(raw.toString()) as WsResponse;
      msgs.push(msg);
      if (predicate(msg)) {
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(msgs);
      }
    };
    ws.on('message', handler);
  });
}

// ---------------------------------------------------------------------------
// Scenario 1: Happy path — submit task, OODA processes, task completes
// ---------------------------------------------------------------------------

describe('When a user submits a task via WebSocket', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness({ approvalMode: 'auto' });
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('the daemon acknowledges submission immediately with a taskId', async () => {
    const { ws } = await connect(h.port);

    const resp = await send(ws, {
      type: 'submit_task',
      id: 'sub-1',
      payload: { description: 'Refactor the auth module for readability' },
    });

    expect(resp.success).toBe(true);
    expect(resp.type).toBe('task_submitted');
    expect(typeof resp.payload.taskId).toBe('string');
    ws.close();
  });

  it('the task is persisted in the store with status in_progress or completed', async () => {
    const { ws } = await connect(h.port);

    const resp = await send(ws, {
      type: 'submit_task',
      id: 'sub-2',
      payload: { description: 'Add input validation to the login form' },
    });

    const taskId = resp.payload.taskId as string;

    // Wait for OODA to finish (adapter is mocked so this is near-instant)
    await vi.waitFor(() => {
      const task = h.store.getTask(taskId);
      expect(task).not.toBeNull();
      expect(['in_progress', 'completed']).toContain(task!.status);
    }, { timeout: 3000 });

    ws.close();
  });

  it('the OODA loop transitions through observe, orient, decide, act, complete', async () => {
    const { ws } = await connect(h.port);

    const phases: string[] = [];
    h.eventBus.on('ooda_phase', (evt: FtmEvent) => {
      phases.push(evt.data.phase as string);
    });

    await send(ws, {
      type: 'submit_task',
      id: 'sub-3',
      payload: { description: 'Write unit tests for the user service' },
    });

    await vi.waitFor(() => {
      expect(phases).toContain('complete');
    }, { timeout: 3000 });

    expect(phases.indexOf('observe')).toBeLessThan(phases.indexOf('orient'));
    expect(phases.indexOf('orient')).toBeLessThan(phases.indexOf('decide'));
    expect(phases.indexOf('decide')).toBeLessThan(phases.indexOf('act'));
    expect(phases.indexOf('act')).toBeLessThan(phases.indexOf('complete'));
    ws.close();
  });

  it('the client receives machine_state broadcasts as OODA progresses', async () => {
    const { ws } = await connect(h.port);

    const stateChanges = collectUntil(ws, (msg) => msg.payload?.state === 'complete');

    await send(ws, {
      type: 'submit_task',
      id: 'sub-4',
      payload: { description: 'Optimize database queries' },
    });

    const msgs = await stateChanges;
    const states = msgs
      .filter((m) => m.type === 'machine_state')
      .map((m) => m.payload.state);

    // We should see ingesting, thinking, executing, complete in some order
    expect(states).toContain('ingesting');
    expect(states).toContain('complete');
    ws.close();
  });

  it('the client receives event broadcasts for step_started and step_completed', async () => {
    const { ws } = await connect(h.port);

    // The wildcard forwarding means event.type is '*' and the real type
    // is in event.data._eventType. Check both fields.
    const isEventType = (msg: WsResponse, targetType: string): boolean => {
      if (msg.type !== 'event') return false;
      const evt = msg.payload?.event as Record<string, unknown> | undefined;
      return evt?.type === targetType || evt?.data?._eventType === targetType ||
             (evt?.data as Record<string, unknown>)?._eventType === targetType;
    };

    // Set up collector BEFORE sending so we don't miss fast events
    const allMsgs = collectUntil(ws, (msg) => isEventType(msg, 'task_completed'), 10000);

    // Fire-and-forget the submit
    ws.send(JSON.stringify({
      type: 'submit_task',
      id: 'sub-5',
      payload: { description: 'Create API endpoint for user profiles' },
    }));

    const msgs = await allMsgs;

    // Extract event types from both direct type and wildcard _eventType
    const eventTypes = new Set<string>();
    for (const m of msgs) {
      if (m.type === 'event') {
        const evt = m.payload?.event as Record<string, unknown>;
        if (evt?.type && evt.type !== '*') eventTypes.add(evt.type as string);
        const data = evt?.data as Record<string, unknown> | undefined;
        if (data?._eventType) eventTypes.add(data._eventType as string);
      }
    }

    expect(eventTypes.has('step_started')).toBe(true);
    expect(eventTypes.has('step_completed')).toBe(true);
    expect(eventTypes.has('task_completed')).toBe(true);
    ws.close();
  }, 15000);

  it('the store records the task result after successful completion', async () => {
    const { ws } = await connect(h.port);

    const resp = await send(ws, {
      type: 'submit_task',
      id: 'sub-6',
      payload: { description: 'Generate API documentation' },
    });

    const taskId = resp.payload.taskId as string;

    await vi.waitFor(() => {
      const task = h.store.getTask(taskId);
      expect(task!.status).toBe('completed');
    }, { timeout: 3000 });

    const task = h.store.getTask(taskId);
    expect(task!.result).toBeTruthy();
    expect(task!.error).toBeUndefined();
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Task failure path
// ---------------------------------------------------------------------------

describe('When the model adapter fails during task execution', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness({ approvalMode: 'auto' });
    // Make ALL adapters fail so fallback also fails
    for (const a of h.adapters) {
      (a.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Model service unavailable'),
      );
    }
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('the task status transitions to failed in the store', async () => {
    const { ws } = await connect(h.port);

    const resp = await send(ws, {
      type: 'submit_task',
      id: 'fail-1',
      payload: { description: 'Analyze log patterns' },
    });

    const taskId = resp.payload.taskId as string;

    await vi.waitFor(() => {
      const task = h.store.getTask(taskId);
      expect(task!.status).toBe('failed');
    }, { timeout: 3000 });

    const task = h.store.getTask(taskId);
    expect(task!.error).toContain('Model service unavailable');
    ws.close();
  });

  it('the OODA loop transitions to error phase', async () => {
    const { ws } = await connect(h.port);

    const phases: string[] = [];
    h.eventBus.on('ooda_phase', (evt: FtmEvent) => {
      phases.push(evt.data.phase as string);
    });

    await send(ws, {
      type: 'submit_task',
      id: 'fail-2',
      payload: { description: 'Run performance benchmark' },
    });

    await vi.waitFor(() => {
      expect(phases).toContain('error');
    }, { timeout: 3000 });

    ws.close();
  });

  it('the client receives an error event broadcast', async () => {
    const { ws } = await connect(h.port);

    const isErrorEvent = (msg: WsResponse): boolean => {
      if (msg.type !== 'event') return false;
      const evt = msg.payload?.event as Record<string, unknown> | undefined;
      const data = evt?.data as Record<string, unknown> | undefined;
      return evt?.type === 'error' || data?._eventType === 'error';
    };

    // Set up collector BEFORE sending to catch fast events
    const msgs = collectUntil(ws, isErrorEvent, 10000);

    ws.send(JSON.stringify({
      type: 'submit_task',
      id: 'fail-3',
      payload: { description: 'Process data pipeline' },
    }));

    const all = await msgs;
    const errorEvents = all.filter(isErrorEvent);
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    ws.close();
  }, 15000);
});

// ---------------------------------------------------------------------------
// Scenario 3: Task cancellation
// ---------------------------------------------------------------------------

describe('When a user cancels a task', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness({ approvalMode: 'auto' });
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('the task status changes to cancelled in the store', async () => {
    const { ws } = await connect(h.port);

    const subResp = await send(ws, {
      type: 'submit_task',
      id: 'cancel-sub',
      payload: { description: 'Long running analysis task' },
    });
    const taskId = subResp.payload.taskId as string;

    const cancelResp = await send(ws, {
      type: 'cancel_task',
      id: 'cancel-1',
      payload: { taskId },
    });

    expect(cancelResp.type).toBe('task_cancelled');
    expect(cancelResp.success).toBe(true);

    const task = h.store.getTask(taskId);
    expect(task!.status).toBe('cancelled');
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Multiple sequential tasks
// ---------------------------------------------------------------------------

describe('When a user submits multiple tasks in sequence', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness({ approvalMode: 'auto' });
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('all tasks appear in the history with their correct descriptions', async () => {
    const { ws } = await connect(h.port);

    const descriptions = [
      'Add user authentication',
      'Set up CI/CD pipeline',
      'Write integration tests',
    ];

    // Submit tasks sequentially, waiting for each to complete before the next
    // and adding a small delay to avoid Date.now() collisions in task IDs
    for (let i = 0; i < descriptions.length; i++) {
      // Ensure unique Date.now()-based task IDs by waiting at least 1ms
      await new Promise((r) => setTimeout(r, 5));

      const resp = await send(ws, {
        type: 'submit_task',
        id: `seq-${Date.now()}-${i}`,
        payload: { description: descriptions[i] },
      });
      const taskId = resp.payload.taskId as string;

      // Wait for this task to finish before submitting the next
      await vi.waitFor(() => {
        const task = h.store.getTask(taskId);
        expect(['completed', 'failed', 'cancelled']).toContain(task!.status);
      }, { timeout: 5000 });
    }

    // Retrieve history
    const histResp = await send(ws, {
      type: 'get_history',
      id: 'hist-seq',
      payload: { limit: 20 },
    });

    const tasks = histResp.payload.tasks as Task[];
    for (const desc of descriptions) {
      expect(tasks.some((t) => t.description === desc)).toBe(true);
    }
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Concurrent client observers
// ---------------------------------------------------------------------------

describe('When multiple clients are connected simultaneously', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness({ approvalMode: 'auto' });
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('all clients receive event broadcasts when a task is submitted', async () => {
    const c1 = await connect(h.port);
    const c2 = await connect(h.port);

    const hasTaskCompleted = (msg: WsResponse): boolean => {
      if (msg.type !== 'event') return false;
      const evt = msg.payload?.event as Record<string, unknown> | undefined;
      const data = evt?.data as Record<string, unknown> | undefined;
      return evt?.type === 'task_completed' || data?._eventType === 'task_completed';
    };

    // Set up collectors BEFORE sending to catch fast events
    const c1Events = collectUntil(c1.ws, hasTaskCompleted, 10000);
    const c2Events = collectUntil(c2.ws, hasTaskCompleted, 10000);

    // Fire-and-forget the submit
    c1.ws.send(JSON.stringify({
      type: 'submit_task',
      id: 'multi-sub',
      payload: { description: 'Build deployment script' },
    }));

    const [msgs1, msgs2] = await Promise.all([c1Events, c2Events]);

    // Both clients should have received at least some event broadcasts
    const events1 = msgs1.filter((m) => m.type === 'event');
    const events2 = msgs2.filter((m) => m.type === 'event');

    expect(events1.length).toBeGreaterThan(0);
    expect(events2.length).toBeGreaterThan(0);

    // At least one of the events should contain task_completed
    expect(events1.some(hasTaskCompleted)).toBe(true);
    expect(events2.some(hasTaskCompleted)).toBe(true);
    c1.ws.close();
    c2.ws.close();
  }, 15000);

  it('connectedClients count reflects both connections', async () => {
    const c1 = await connect(h.port);
    const c2 = await connect(h.port);

    const stateResp = await send(c1.ws, {
      type: 'get_state',
      id: 'state-multi',
      payload: {},
    });

    expect((stateResp.payload.connectedClients as number)).toBeGreaterThanOrEqual(2);
    c1.ws.close();
    c2.ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: State snapshot on connect
// ---------------------------------------------------------------------------

describe('When a user connects to the daemon', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness({ approvalMode: 'auto' });
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('the first message received is a complete state snapshot', async () => {
    const { ws, initMsg } = await connect(h.port);

    expect(initMsg.type).toBe('state_snapshot');
    expect(initMsg.success).toBe(true);
    expect(initMsg.payload).toHaveProperty('machineState');
    expect(initMsg.payload).toHaveProperty('phase');
    expect(initMsg.payload).toHaveProperty('blackboard');
    expect(initMsg.payload).toHaveProperty('connectedClients');
    expect(initMsg.payload.machineState).toBe('idle');
    expect(initMsg.payload.phase).toBe('idle');
    ws.close();
  });

  it('the blackboard context in the snapshot starts empty', async () => {
    const { ws, initMsg } = await connect(h.port);

    const bb = initMsg.payload.blackboard as Record<string, unknown>;
    expect(bb.currentTask).toBeNull();
    expect(Array.isArray(bb.recentDecisions)).toBe(true);
    expect((bb.recentDecisions as unknown[]).length).toBe(0);
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: Invalid messages from the client
// ---------------------------------------------------------------------------

describe('When a client sends invalid messages', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness({ approvalMode: 'auto' });
  });

  afterEach(() => {
    h.server.stop();
    vi.restoreAllMocks();
  });

  it('malformed JSON returns an error response', async () => {
    const { ws } = await connect(h.port);

    const errMsg = await new Promise<WsResponse>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
      ws.send('NOT VALID JSON {{{');
    });

    expect(errMsg.type).toBe('error');
    expect(errMsg.success).toBe(false);
    ws.close();
  });

  it('unknown message type returns an error with the type name', async () => {
    const { ws } = await connect(h.port);

    const resp = await send(ws, {
      type: 'this_does_not_exist',
      id: 'bad-type',
      payload: {},
    });

    expect(resp.type).toBe('error');
    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/unknown message type/i);
    ws.close();
  });
});
