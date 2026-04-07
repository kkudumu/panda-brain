/**
 * Integration test: CLI Scenarios
 *
 * Simulates user interactions equivalent to CLI commands by using
 * the same WebSocket protocol the CLI uses. This avoids the complexity
 * of mocking chalk/ora/process.exit while testing the same user flows.
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
  MachineState,
} from '../../packages/daemon/src/shared/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(name: string): ModelAdapter {
  return {
    name,
    available: vi.fn().mockResolvedValue(true),
    startSession: vi.fn().mockResolvedValue({
      text: `${name} result`,
      toolCalls: [],
      sessionId: `sess-${name}`,
      tokenUsage: { input: 1, output: 1, cached: 0 },
    } satisfies NormalizedResponse),
    resumeSession: vi.fn(),
    parseResponse: vi.fn(),
  };
}

async function connect(port: number): Promise<{ ws: WebSocket; initMsg: WsResponse }> {
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

function collectEvents(ws: WebSocket): string[] {
  const events: string[] = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as WsResponse;
    if (msg.type === 'event') {
      const evt = msg.payload.event as FtmEvent;
      const eventType = (evt.data._eventType as string) ?? evt.type;
      events.push(eventType);
    }
  });
  return events;
}

describe('CLI User Scenarios (WebSocket equivalent)', { timeout: 30_000 }, () => {
  let store: FtmStore;
  let server: FtmServer;
  let port: number;

  beforeEach(async () => {
    store = new FtmStore(':memory:');
    const sessionId = 'cli-test';
    store.createSession(sessionId);

    const eventBus = new FtmEventBus(sessionId);
    const blackboard = new Blackboard(store);
    const registry = new AdapterRegistry();
    registry.register(makeAdapter('claude'));
    registry.register(makeAdapter('codex'));
    registry.register(makeAdapter('gemini'));
    registry.register(makeAdapter('ollama'));
    const router = new ModelRouter(registry, eventBus);
    vi.spyOn(router, 'getConfig').mockReturnValue({
      ...router.getConfig(),
      execution: { ...router.getConfig().execution, approvalMode: 'auto' },
    });

    const ooda = new OodaLoop(eventBus, blackboard, router);
    server = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
    await server.start(0, '127.0.0.1');
    port = server.getPort()!;
  });

  afterEach(() => {
    server.stop();
    vi.restoreAllMocks();
  });

  // Equivalent to: ftm status
  it('ftm status — shows daemon state as idle with no active task', async () => {
    const { ws } = await connect(port);
    const resp = await send(ws, { type: 'get_state', id: 'status-1', payload: {} });

    expect(resp.success).toBe(true);
    expect(resp.payload.machineState).toBe('idle');
    expect(resp.payload.currentTask).toBeNull();
    expect(resp.payload.phase).toBe('idle');
    ws.close();
  });

  // Equivalent to: ftm history (empty)
  it('ftm history — returns empty when no tasks exist', async () => {
    const { ws } = await connect(port);
    const resp = await send(ws, { type: 'get_history', id: 'hist-1', payload: { limit: 10 } });

    expect(resp.success).toBe(true);
    expect(resp.payload.tasks).toEqual([]);
    ws.close();
  });

  // Equivalent to: ftm history (with tasks)
  it('ftm history — shows completed tasks', async () => {
    store.createTask({
      id: 't1',
      description: 'Fix the login bug',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: 'cli-test',
    });

    const { ws } = await connect(port);
    const resp = await send(ws, { type: 'get_history', id: 'hist-2', payload: { limit: 10 } });

    expect(resp.success).toBe(true);
    const tasks = resp.payload.tasks as Array<{ id: string; description: string; status: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe('Fix the login bug');
    expect(tasks[0].status).toBe('completed');
    ws.close();
  });

  // Equivalent to: ftm "analyze this codebase"
  it('ftm <task> — submits task and receives completion events', async () => {
    const { ws } = await connect(port);
    const events = collectEvents(ws);

    const resp = await send(ws, {
      type: 'submit_task',
      id: 'sub-1',
      payload: { description: 'Analyze this codebase' },
    });
    expect(resp.success).toBe(true);
    const taskId = resp.payload.taskId as string;

    // Wait for task_completed event (OODA processes in background)
    await vi.waitFor(() => {
      expect(events).toContain('task_completed');
    }, { timeout: 10_000 });

    // Verify task in store
    const task = store.getTask(taskId);
    expect(task!.status).toBe('completed');
    ws.close();
  });

  // Equivalent to: ftm status (while task is being processed)
  it('ftm status during execution — shows machine state changes', async () => {
    const { ws } = await connect(port);
    const machineStates: MachineState[] = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as WsResponse;
      if (msg.type === 'machine_state') {
        machineStates.push(msg.payload.state as MachineState);
      }
    });

    await send(ws, {
      type: 'submit_task',
      id: 'sub-2',
      payload: { description: 'Quick task' },
    });

    await vi.waitFor(() => {
      expect(machineStates).toContain('complete');
    }, { timeout: 10_000 });

    // Should have transitioned through ingesting → thinking → executing → complete
    expect(machineStates.length).toBeGreaterThanOrEqual(2);
    ws.close();
  });

  // Equivalent to: ftm "task" then ftm history
  it('submitted task appears in history after completion', async () => {
    const { ws } = await connect(port);
    const events = collectEvents(ws);

    await send(ws, {
      type: 'submit_task',
      id: 'sub-3',
      payload: { description: 'Refactor the auth module' },
    });

    await vi.waitFor(() => {
      expect(events).toContain('task_completed');
    }, { timeout: 10_000 });

    const histResp = await send(ws, { type: 'get_history', id: 'hist-3', payload: { limit: 10 } });
    const tasks = histResp.payload.tasks as Array<{ description: string; status: string }>;
    expect(tasks.some(t => t.description === 'Refactor the auth module' && t.status === 'completed')).toBe(true);
    ws.close();
  });
});
