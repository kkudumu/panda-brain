/**
 * Integration test: Comprehensive User Flow
 * 
 * Simulates a realistic end-to-end user scenario:
 * 1.  Daemon starts (with mocked model adapters).
 * 2.  User submits a complex task that triggers a guard step.
 * 3.  User approves the plan via WebSocket (simulating 'ftm approve').
 * 4.  OODA executes the plan; user watches events (simulating CLI streaming).
 * 5.  User records a follow-up decision via MCP tool based on the result.
 * 6.  User checks history to verify completion.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type TestOptions } from 'vitest';
import { WebSocket } from 'ws';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';

// Core imports using relative paths
import { FtmServer } from '../../packages/daemon/src/server.js';
import { FtmEventBus } from '../../packages/daemon/src/event-bus.js';
import { FtmStore } from '../../packages/daemon/src/store.js';
import { Blackboard } from '../../packages/daemon/src/blackboard.js';
import { OodaLoop } from '../../packages/daemon/src/ooda.js';
import { ModelRouter } from '../../packages/daemon/src/router.js';
import { AdapterRegistry } from '../../packages/daemon/src/adapters/registry.js';
import { FtmMcpServer } from '../../packages/mcp/src/server.js';

import type {
  ModelAdapter,
  NormalizedResponse,
  WsResponse,
  FtmEvent,
  Plan,
  Task,
  BlackboardContext,
} from '../../packages/daemon/src/shared/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(name: string, responseText = 'OK'): ModelAdapter {
  return {
    name,
    available: vi.fn().mockResolvedValue(true),
    startSession: vi.fn().mockResolvedValue({
      text: responseText,
      toolCalls: [],
      sessionId: `sess-${name}-${randomUUID()}`,
      tokenUsage: { input: 10, output: 20, cached: 0 },
    } satisfies NormalizedResponse),
    resumeSession: vi.fn(),
    parseResponse: vi.fn(),
  };
}

let dbPath: string;

function createDbPath(): string {
  return join(tmpdir(), `ftm-flow-${randomUUID()}.db`);
}

function cleanupDb(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
    if (existsSync(path + '-wal')) unlinkSync(path + '-wal');
    if (existsSync(path + '-shm')) unlinkSync(path + '-shm');
  } catch {}
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

// ---------------------------------------------------------------------------
// The Flow
// ---------------------------------------------------------------------------

describe('Comprehensive User Flow: CLI + OODA + MCP', { timeout: 30_000 }, () => {
  let store: FtmStore;
  let daemonServer: FtmServer;
  let mcpServer: FtmMcpServer;
  let eventBus: FtmEventBus;
  let daemonPort: number;
  let sessionId: string;

  beforeEach(async () => {
    dbPath = createDbPath();
    store = new FtmStore(dbPath);
    sessionId = `user-flow-${Date.now()}`;
    store.createSession(sessionId);

    eventBus = new FtmEventBus(sessionId);
    const blackboard = new Blackboard(store);

    const registry = new AdapterRegistry();
    registry.register(makeAdapter('claude', 'Claude: Refactoring plan looks solid.'));
    registry.register(makeAdapter('codex', 'Codex: Successfully refactored the auth module.'));
    registry.register(makeAdapter('gemini', 'Gemini: Code review passed.'));
    registry.register(makeAdapter('ollama', 'Ollama: Looks good.'));

    const router = new ModelRouter(registry, eventBus);
    // Use plan_first to test approval flow
    vi.spyOn(router, 'getConfig').mockReturnValue({
      ...router.getConfig(),
      execution: { ...router.getConfig().execution, approvalMode: 'plan_first' },
    });

    const ooda = new OodaLoop(eventBus, blackboard, router);
    daemonServer = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
    await daemonServer.start(0, '127.0.0.1');
    daemonPort = daemonServer.getPort()!;

    mcpServer = new FtmMcpServer(dbPath);
  });

  afterEach(() => {
    daemonServer.stop();
    mcpServer.close();
    store.close();
    cleanupDb(dbPath);
    vi.restoreAllMocks();
  });

  it('handles a multi-component scenario with safety gates and feedback loops', async () => {
    const { ws } = await connect(daemonPort);

    // Set up event collector BEFORE submitting task to avoid race condition
    let pendingPlan: Plan | null = null;
    const events: string[] = [];

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(raw.toString()) as WsResponse;
      if (msg.type === 'event') {
        const evt = msg.payload.event as FtmEvent;
        const eventType = (evt.data._eventType as string) ?? evt.type;
        events.push(eventType);
        if (eventType === 'approval_requested' && evt.data.plan) {
          pendingPlan = evt.data.plan as Plan;
        }
      }
    });

    // 1. User submits a task that triggers guard (remove + production)
    const submitResp = await send(ws, {
      type: 'submit_task',
      id: 'flow-1',
      payload: { description: 'Remove the legacy production credentials and refactor auth' },
    });
    expect(submitResp.success).toBe(true);
    const taskId = submitResp.payload.taskId as string;

    // 2. Wait for the daemon to request approval
    await vi.waitFor(() => {
      expect(pendingPlan).not.toBeNull();
      expect(events).toContain('approval_requested');
    }, { timeout: 10_000 });

    // Verify guard triggered extra steps
    expect(pendingPlan!.steps.length).toBeGreaterThan(1);
    expect(pendingPlan!.steps.some(s => s.requiresApproval)).toBe(true);

    // 3. User approves the plan (simulating 'ftm approve')
    const approveResp = await send(ws, {
      type: 'approve_plan',
      id: 'flow-2',
      payload: { planId: pendingPlan!.id },
    });
    expect(approveResp.success).toBe(true);

    // 4. Wait for completion
    await vi.waitFor(() => {
      expect(events).toContain('task_completed');
    }, { timeout: 10_000 });

    // Verify task stored as completed
    const task = store.getTask(taskId);
    expect(task!.status).toBe('completed');

    // 5. User records a follow-up decision via MCP tool based on the result
    await mcpServer.handleToolCall('ftm_add_decision', {
      decision: 'Permanently decommissioned production-v1 credentials',
      reason: 'Task completed successfully and refactor verified',
    });

    // 6. User checks blackboard and history via MCP tools
    const bbResult = await mcpServer.handleToolCall('ftm_get_blackboard', {});
    const bbContext = JSON.parse(bbResult.content[0].text) as BlackboardContext;
    expect(bbContext.recentDecisions).toHaveLength(1);
    expect(bbContext.recentDecisions[0].decision).toContain('decommissioned');

    const historyResult = await mcpServer.handleToolCall('ftm_get_tasks', { limit: 5 });
    const tasks = JSON.parse(historyResult.content[0].text) as Task[];
    const completedTask = tasks.find(t => t.id === taskId);
    expect(completedTask).toBeDefined();
    expect(completedTask!.status).toBe('completed');
    expect(completedTask!.description).toContain('production credentials');

    ws.close();
  });
});
