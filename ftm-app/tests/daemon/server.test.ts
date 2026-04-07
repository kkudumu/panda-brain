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

function makeAvailableAdapter(name: string, responseText = 'ok'): ModelAdapter {
  return {
    name,
    available: vi.fn().mockResolvedValue(true),
    startSession: vi.fn().mockResolvedValue({
      text: responseText,
      toolCalls: [],
      sessionId: 'sess-x',
      tokenUsage: { input: 10, output: 20, cached: 0 },
    } satisfies NormalizedResponse),
    resumeSession: vi.fn(),
    parseResponse: vi.fn(),
  };
}

interface TestHarness {
  server: FtmServer;
  eventBus: FtmEventBus;
  store: FtmStore;
  blackboard: Blackboard;
  ooda: OodaLoop;
  port: number;
  sessionId: string;
}

async function buildServer(overrides: {
  approvalMode?: 'auto' | 'plan_first' | 'always_ask';
  adapters?: ModelAdapter[];
  oodaOverride?: Partial<OodaLoop>;
} = {}): TestHarness {
  const sessionId = 'test-session';
  const store = new FtmStore(':memory:');
  // Create a session so tasks can reference it via FK
  store.createSession(sessionId);

  const eventBus = new FtmEventBus(sessionId);
  const blackboard = new Blackboard(store);

  const registry = new AdapterRegistry();
  const adapters = overrides.adapters ?? [
    makeAvailableAdapter('claude'),
    makeAvailableAdapter('codex'),
    makeAvailableAdapter('gemini'),
    makeAvailableAdapter('ollama'),
  ];
  for (const a of adapters) {
    registry.register(a);
  }

  const router = new ModelRouter(registry, eventBus);

  if (overrides.approvalMode) {
    vi.spyOn(router, 'getConfig').mockReturnValue({
      ...router.getConfig(),
      execution: {
        ...router.getConfig().execution,
        approvalMode: overrides.approvalMode,
      },
    });
  }

  const ooda = new OodaLoop(eventBus, blackboard, router);

  const server = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
  // Use port 0 so the OS assigns a random free port
  await server.start(0, '127.0.0.1');
  const port = server.getPort()!;

  return { server, eventBus, store, blackboard, ooda, port, sessionId };
}

// Connect a WebSocket client and wait for the initial state_snapshot message
function connectClient(port: number): Promise<{ ws: WebSocket; firstMsg: WsResponse }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('error', reject);
    ws.once('message', (raw) => {
      const firstMsg = JSON.parse(raw.toString()) as WsResponse;
      resolve({ ws, firstMsg });
    });
  });
}

// Send a message and wait for the response with matching id
function sendAndReceive(ws: WebSocket, msg: Record<string, unknown>): Promise<WsResponse> {
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

// Collect N messages from a WebSocket
function collectMessages(ws: WebSocket, count: number): Promise<WsResponse[]> {
  return new Promise((resolve) => {
    const msgs: WsResponse[] = [];
    const handler = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      msgs.push(JSON.parse(raw.toString()) as WsResponse);
      if (msgs.length >= count) {
        ws.off('message', handler);
        resolve(msgs);
      }
    };
    ws.on('message', handler);
  });
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('FtmServer — startup and connection', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('starts on a random port and getPort() returns it', () => {
    expect(harness.port).toBeGreaterThan(0);
  });

  it('sends state_snapshot immediately on connection', async () => {
    const { ws, firstMsg } = await connectClient(harness.port);
    expect(firstMsg.type).toBe('state_snapshot');
    expect(firstMsg.success).toBe(true);
    expect(firstMsg.id).toBe('init');
    expect(firstMsg.payload).toHaveProperty('machineState');
    expect(firstMsg.payload).toHaveProperty('phase');
    ws.close();
  });

  it('initial state snapshot has machineState = idle', async () => {
    const { ws, firstMsg } = await connectClient(harness.port);
    expect(firstMsg.payload.machineState).toBe('idle');
    ws.close();
  });

  it('accepts multiple simultaneous clients', async () => {
    const c1 = await connectClient(harness.port);
    const c2 = await connectClient(harness.port);
    expect(c1.firstMsg.type).toBe('state_snapshot');
    expect(c2.firstMsg.type).toBe('state_snapshot');
    c1.ws.close();
    c2.ws.close();
  });
});

describe('FtmServer — submit_task', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('responds with task_submitted and a taskId', async () => {
    const { ws } = await connectClient(harness.port);

    const response = await sendAndReceive(ws, {
      type: 'submit_task',
      id: 'msg-1',
      payload: { description: 'Write a hello world function' },
    });

    expect(response.type).toBe('task_submitted');
    expect(response.id).toBe('msg-1');
    expect(response.success).toBe(true);
    expect(typeof response.payload.taskId).toBe('string');
    ws.close();
  });

  it('creates the task in the store', async () => {
    const { ws } = await connectClient(harness.port);

    const response = await sendAndReceive(ws, {
      type: 'submit_task',
      id: 'msg-2',
      payload: { description: 'A simple task description' },
    });

    const taskId = response.payload.taskId as string;
    const task = harness.store.getTask(taskId);
    expect(task).not.toBeNull();
    expect(task!.description).toBe('A simple task description');
    ws.close();
  });

  it('emits task_submitted event on the event bus', async () => {
    const { ws } = await connectClient(harness.port);

    const events: FtmEvent[] = [];
    harness.eventBus.on('task_submitted', (evt: FtmEvent) => events.push(evt));

    await sendAndReceive(ws, {
      type: 'submit_task',
      id: 'msg-3',
      payload: { description: 'Emit test task' },
    });

    expect(events.length).toBe(1);
    ws.close();
  });
});

describe('FtmServer — approve_plan', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('responds with plan_approved', async () => {
    const { ws } = await connectClient(harness.port);

    const response = await sendAndReceive(ws, {
      type: 'approve_plan',
      id: 'msg-approve',
      payload: { planId: 'plan-123' },
    });

    expect(response.type).toBe('plan_approved');
    expect(response.id).toBe('msg-approve');
    expect(response.success).toBe(true);
    expect(response.payload.planId).toBe('plan-123');
    ws.close();
  });

  it('emits plan_approved event on the event bus', async () => {
    const { ws } = await connectClient(harness.port);

    const approvedPlans: string[] = [];
    harness.eventBus.on('plan_approved', (evt: FtmEvent) => {
      approvedPlans.push(evt.data.planId as string);
    });

    await sendAndReceive(ws, {
      type: 'approve_plan',
      id: 'msg-approve-2',
      payload: { planId: 'plan-456' },
    });

    expect(approvedPlans).toContain('plan-456');
    ws.close();
  });
});

describe('FtmServer — cancel_task', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('responds with task_cancelled', async () => {
    const { ws } = await connectClient(harness.port);

    // First create a task to cancel
    const submitResp = await sendAndReceive(ws, {
      type: 'submit_task',
      id: 'msg-sub',
      payload: { description: 'Task to cancel' },
    });
    const taskId = submitResp.payload.taskId as string;

    const cancelResp = await sendAndReceive(ws, {
      type: 'cancel_task',
      id: 'msg-cancel',
      payload: { taskId },
    });

    expect(cancelResp.type).toBe('task_cancelled');
    expect(cancelResp.id).toBe('msg-cancel');
    expect(cancelResp.success).toBe(true);
    expect(cancelResp.payload.taskId).toBe(taskId);
    ws.close();
  });

  it('updates task status to cancelled in the store', async () => {
    const { ws } = await connectClient(harness.port);

    const submitResp = await sendAndReceive(ws, {
      type: 'submit_task',
      id: 'msg-sub-2',
      payload: { description: 'Task to cancel from store' },
    });
    const taskId = submitResp.payload.taskId as string;

    await sendAndReceive(ws, {
      type: 'cancel_task',
      id: 'msg-cancel-2',
      payload: { taskId },
    });

    const task = harness.store.getTask(taskId);
    expect(task!.status).toBe('cancelled');
    ws.close();
  });
});

describe('FtmServer — get_state', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('responds with state_snapshot', async () => {
    const { ws } = await connectClient(harness.port);

    const response = await sendAndReceive(ws, {
      type: 'get_state',
      id: 'msg-state',
      payload: {},
    });

    expect(response.type).toBe('state_snapshot');
    expect(response.id).toBe('msg-state');
    expect(response.success).toBe(true);
    expect(response.payload).toHaveProperty('machineState');
    expect(response.payload).toHaveProperty('phase');
    expect(response.payload).toHaveProperty('connectedClients');
    ws.close();
  });

  it('connectedClients reflects open connections', async () => {
    const c1 = await connectClient(harness.port);
    const c2 = await connectClient(harness.port);

    const response = await sendAndReceive(c1.ws, {
      type: 'get_state',
      id: 'msg-clients',
      payload: {},
    });

    expect((response.payload.connectedClients as number)).toBeGreaterThanOrEqual(2);
    c1.ws.close();
    c2.ws.close();
  });
});

describe('FtmServer — get_history', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('responds with history type and tasks array', async () => {
    const { ws } = await connectClient(harness.port);

    const response = await sendAndReceive(ws, {
      type: 'get_history',
      id: 'msg-history',
      payload: { limit: 10 },
    });

    expect(response.type).toBe('history');
    expect(response.id).toBe('msg-history');
    expect(response.success).toBe(true);
    expect(Array.isArray(response.payload.tasks)).toBe(true);
    ws.close();
  });

  it('returns submitted tasks in history', async () => {
    const { ws } = await connectClient(harness.port);

    // Submit a task first
    await sendAndReceive(ws, {
      type: 'submit_task',
      id: 'msg-hist-sub',
      payload: { description: 'A task for history' },
    });

    const response = await sendAndReceive(ws, {
      type: 'get_history',
      id: 'msg-hist',
      payload: { limit: 20 },
    });

    const tasks = response.payload.tasks as Task[];
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((t) => t.description === 'A task for history')).toBe(true);
    ws.close();
  });
});

describe('FtmServer — modify_plan', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('responds with plan_modified', async () => {
    const { ws } = await connectClient(harness.port);

    const response = await sendAndReceive(ws, {
      type: 'modify_plan',
      id: 'msg-modify',
      payload: { planId: 'plan-xyz', modifications: { status: 'approved' } },
    });

    expect(response.type).toBe('plan_modified');
    expect(response.id).toBe('msg-modify');
    expect(response.success).toBe(true);
    expect(response.payload.planId).toBe('plan-xyz');
    ws.close();
  });
});

describe('FtmServer — invalid message handling', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('returns error for malformed JSON', async () => {
    const { ws } = await connectClient(harness.port);

    // Send raw invalid JSON, expect an error response
    const errorMsg = await new Promise<WsResponse>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
      ws.send('this is not json');
    });

    expect(errorMsg.type).toBe('error');
    expect(errorMsg.success).toBe(false);
    expect(errorMsg.error).toMatch(/invalid message format/i);
    ws.close();
  });

  it('returns error for unknown message type', async () => {
    const { ws } = await connectClient(harness.port);

    const response = await sendAndReceive(ws, {
      type: 'unknown_type',
      id: 'msg-unknown',
      payload: {},
    });

    expect(response.type).toBe('error');
    expect(response.success).toBe(false);
    expect(response.id).toBe('msg-unknown');
    expect(response.error).toMatch(/unknown message type/i);
    ws.close();
  });
});

describe('FtmServer — event forwarding', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('broadcasts event bus wildcard events to connected clients', async () => {
    const { ws } = await connectClient(harness.port);

    // Collect next message after manually emitting a wildcard event
    const nextMsg = new Promise<WsResponse>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
    });

    harness.eventBus.emit('*', { _eventType: 'memory_saved', info: 'test' });

    const msg = await nextMsg;
    expect(msg.type).toBe('event');
    expect(msg.success).toBe(true);
    expect(msg.payload).toHaveProperty('event');
    ws.close();
  });

  it('broadcasts event to all connected clients simultaneously', async () => {
    const c1 = await connectClient(harness.port);
    const c2 = await connectClient(harness.port);

    const p1 = new Promise<WsResponse>((resolve) => {
      c1.ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
    });
    const p2 = new Promise<WsResponse>((resolve) => {
      c2.ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
    });

    harness.eventBus.emit('*', { _eventType: 'artifact_created', path: '/tmp/out.txt' });

    const [msg1, msg2] = await Promise.all([p1, p2]);
    expect(msg1.type).toBe('event');
    expect(msg2.type).toBe('event');
    c1.ws.close();
    c2.ws.close();
  });
});

describe('FtmServer — machine state tracking', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildServer({ approvalMode: 'auto' });
  });

  afterEach(() => {
    harness.server.stop();
    vi.restoreAllMocks();
  });

  it('maps ooda_phase observe → ingesting', async () => {
    const { ws } = await connectClient(harness.port);

    const machineStateMsg = new Promise<WsResponse>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
    });

    harness.eventBus.emit('ooda_phase', { phase: 'observe' });

    const msg = await machineStateMsg;
    expect(msg.type).toBe('machine_state');
    expect(msg.payload.state).toBe('ingesting');
    ws.close();
  });

  it('maps ooda_phase orient → thinking', async () => {
    const { ws } = await connectClient(harness.port);

    const machineStateMsg = new Promise<WsResponse>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
    });

    harness.eventBus.emit('ooda_phase', { phase: 'orient' });

    const msg = await machineStateMsg;
    expect(msg.payload.state).toBe('thinking');
    ws.close();
  });

  it('maps ooda_phase decide → thinking', async () => {
    const { ws } = await connectClient(harness.port);

    const machineStateMsg = new Promise<WsResponse>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
    });

    harness.eventBus.emit('ooda_phase', { phase: 'decide' });

    const msg = await machineStateMsg;
    expect(msg.payload.state).toBe('thinking');
    ws.close();
  });

  it('maps ooda_phase act → executing', async () => {
    const { ws } = await connectClient(harness.port);

    const machineStateMsg = new Promise<WsResponse>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
    });

    harness.eventBus.emit('ooda_phase', { phase: 'act' });

    const msg = await machineStateMsg;
    expect(msg.payload.state).toBe('executing');
    ws.close();
  });

  it('maps ooda_phase complete → complete', async () => {
    const { ws } = await connectClient(harness.port);

    const machineStateMsg = new Promise<WsResponse>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
    });

    harness.eventBus.emit('ooda_phase', { phase: 'complete' });

    const msg = await machineStateMsg;
    expect(msg.payload.state).toBe('complete');
    ws.close();
  });

  it('maps ooda_phase error → error', async () => {
    const { ws } = await connectClient(harness.port);

    const machineStateMsg = new Promise<WsResponse>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as WsResponse));
    });

    harness.eventBus.emit('ooda_phase', { phase: 'error' });

    const msg = await machineStateMsg;
    expect(msg.payload.state).toBe('error');
    ws.close();
  });

  it('getMachineState() reflects latest phase', () => {
    harness.eventBus.emit('ooda_phase', { phase: 'act' });
    expect(harness.server.getMachineState()).toBe('executing');
  });
});

describe('FtmServer — stop', () => {
  it('closes all connections on stop()', async () => {
    const harness = await buildServer({ approvalMode: 'auto' });
    const { ws } = await connectClient(harness.port);

    const closedPromise = new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
    });

    harness.server.stop();
    await closedPromise;

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('getPort() returns null after stop', async () => {
    const harness = await buildServer({ approvalMode: 'auto' });
    harness.server.stop();
    expect(harness.server.getPort()).toBeNull();
  });
});
