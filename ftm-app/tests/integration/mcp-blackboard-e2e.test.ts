/**
 * Integration test: MCP Tools + Blackboard + Store — Cross-Component E2E
 *
 * Simulates user scenarios where:
 * - MCP tools interact with the blackboard and store
 * - Data written through MCP tools persists and is visible in the blackboard
 * - Guard checks, playbooks, experiences, decisions form a coherent workflow
 * - The daemon WebSocket + MCP tool view the same data
 *
 * Uses temp file-based SQLite so the daemon store and MCP server share the
 * same database (in-memory DBs are isolated per connection in SQLite).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlinkSync, existsSync } from 'fs';
import { WebSocket } from 'ws';
import { FtmStore } from '../../packages/daemon/src/store.js';
import { Blackboard } from '../../packages/daemon/src/blackboard.js';
import { FtmEventBus } from '../../packages/daemon/src/event-bus.js';
import { FtmMcpServer } from '../../packages/mcp/src/server.js';
import { FtmServer } from '../../packages/daemon/src/server.js';
import { OodaLoop } from '../../packages/daemon/src/ooda.js';
import { ModelRouter } from '../../packages/daemon/src/router.js';
import { AdapterRegistry } from '../../packages/daemon/src/adapters/registry.js';
import type {
  ModelAdapter,
  NormalizedResponse,
  WsResponse,
  FtmEvent,
  BlackboardContext,
} from '../../packages/daemon/src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(name: string): ModelAdapter {
  return {
    name,
    available: vi.fn().mockResolvedValue(true),
    startSession: vi.fn().mockResolvedValue({
      text: `${name} completed the task`,
      toolCalls: [],
      sessionId: `sess-${name}`,
      tokenUsage: { input: 5, output: 10, cached: 0 },
    } satisfies NormalizedResponse),
    resumeSession: vi.fn(),
    parseResponse: vi.fn(),
  };
}

let dbPath: string;

function createDbPath(): string {
  return join(tmpdir(), `ftm-e2e-${randomUUID()}.db`);
}

function cleanupDb(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
    if (existsSync(path + '-wal')) unlinkSync(path + '-wal');
    if (existsSync(path + '-shm')) unlinkSync(path + '-shm');
  } catch {}
}

// ---------------------------------------------------------------------------
// Scenario 1: MCP tool workflow — decisions + experiences + blackboard
// ---------------------------------------------------------------------------

describe('When an AI agent uses MCP tools in a typical workflow', () => {
  let mcpServer: FtmMcpServer;
  let store: FtmStore;

  beforeEach(() => {
    dbPath = createDbPath();
    store = new FtmStore(dbPath);
    mcpServer = new FtmMcpServer(dbPath);
  });

  afterEach(() => {
    store.close();
    mcpServer.close();
    cleanupDb(dbPath);
  });

  it('decisions written via ftm_add_decision appear in ftm_get_blackboard', async () => {
    // Step 1: Agent records a decision
    await mcpServer.handleToolCall('ftm_add_decision', {
      decision: 'Use vitest over jest',
      reason: 'Faster execution and native ESM support',
    });

    // Step 2: Agent checks the blackboard
    const bbResult = await mcpServer.handleToolCall('ftm_get_blackboard', {});
    const context = JSON.parse(bbResult.content[0].text) as BlackboardContext;

    expect(context.recentDecisions).toHaveLength(1);
    expect(context.recentDecisions[0].decision).toBe('Use vitest over jest');
    expect(context.recentDecisions[0].reason).toBe('Faster execution and native ESM support');
  });

  it('experiences written via ftm_write_experience persist across calls', async () => {
    // Step 1: Record an experience after completing a task
    await mcpServer.handleToolCall('ftm_write_experience', {
      taskType: 'sso-setup',
      outcome: 'success',
      lessons: ['Always test redirect URIs', 'Check token expiry edge case'],
      tags: ['authentication', 'oauth'],
    });

    // Step 2: Record another experience
    await mcpServer.handleToolCall('ftm_write_experience', {
      taskType: 'sso-setup',
      outcome: 'partial',
      lessons: ['Multi-tenant config is tricky'],
      tags: ['authentication', 'multi-tenant'],
    });

    // Step 3: Verify persistence via the store
    const experiences = store.getExperiences({ taskType: 'sso-setup' });
    expect(experiences).toHaveLength(2);
    expect(experiences.map((e) => e.outcome)).toContain('success');
    expect(experiences.map((e) => e.outcome)).toContain('partial');
  });

  it('ftm_log_daily entries accumulate in the event log', async () => {
    await mcpServer.handleToolCall('ftm_log_daily', {
      entry: 'Started auth module refactor',
      type: 'task',
    });
    await mcpServer.handleToolCall('ftm_log_daily', {
      entry: 'Decided to use passport.js',
      type: 'decision',
    });
    await mcpServer.handleToolCall('ftm_log_daily', {
      entry: 'Found race condition in token refresh',
      type: 'issue',
    });

    const events = store.getEventsByType('daily_log', 100);
    expect(events).toHaveLength(3);

    const types = events.map((e) => e.data.entryType);
    expect(types).toContain('task');
    expect(types).toContain('decision');
    expect(types).toContain('issue');
  });

  it('a full agent workflow: guard check, decide, log, record experience', async () => {
    // Step 1: Agent runs guard check before executing
    const guardResult = await mcpServer.handleToolCall('ftm_guard_check', {
      description: 'Refactor the authentication module',
    });
    const guardBody = JSON.parse(guardResult.content[0].text);
    expect(guardBody.passed).toBe(true);

    // Step 2: Agent records the decision to proceed
    await mcpServer.handleToolCall('ftm_add_decision', {
      decision: 'Proceed with auth refactor',
      reason: 'Guard check passed, no destructive operations',
    });

    // Step 3: Agent logs the work
    await mcpServer.handleToolCall('ftm_log_daily', {
      entry: 'Refactored auth module — extracted token service',
      type: 'task',
    });

    // Step 4: Agent records the experience
    await mcpServer.handleToolCall('ftm_write_experience', {
      taskType: 'refactoring',
      outcome: 'success',
      lessons: ['Extracting services improves testability'],
      tags: ['auth', 'refactoring'],
    });

    // Verify the complete state
    const bb = await mcpServer.handleToolCall('ftm_get_blackboard', {});
    const ctx = JSON.parse(bb.content[0].text) as BlackboardContext;
    expect(ctx.recentDecisions).toHaveLength(1);

    const logs = store.getEventsByType('daily_log', 10);
    expect(logs).toHaveLength(1);

    const exps = store.getExperiences({ taskType: 'refactoring' });
    expect(exps).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Guard checks on dangerous vs safe operations
// ---------------------------------------------------------------------------

describe('When an AI agent uses ftm_guard_check for safety screening', () => {
  let mcpServer: FtmMcpServer;

  beforeEach(() => {
    dbPath = createDbPath();
    mcpServer = new FtmMcpServer(dbPath);
  });

  afterEach(() => {
    mcpServer.close();
    cleanupDb(dbPath);
  });

  it('blocks rm -rf commands', async () => {
    const result = await mcpServer.handleToolCall('ftm_guard_check', {
      description: 'Clean up by running rm -rf /var/log/old',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.passed).toBe(false);
    expect(body.checks.some((c: { rule: string }) => c.rule === 'destructive_operation')).toBe(true);
  });

  it('blocks drop table commands', async () => {
    const result = await mcpServer.handleToolCall('ftm_guard_check', {
      description: 'Run SQL: drop table sessions',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.passed).toBe(false);
  });

  it('blocks delete from commands', async () => {
    const result = await mcpServer.handleToolCall('ftm_guard_check', {
      description: 'Execute delete from users where active = false',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.passed).toBe(false);
  });

  it('blocks git push --force', async () => {
    const result = await mcpServer.handleToolCall('ftm_guard_check', {
      description: 'Fix history with git push --force origin main',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.passed).toBe(false);
  });

  it('blocks git reset --hard', async () => {
    const result = await mcpServer.handleToolCall('ftm_guard_check', {
      description: 'Undo changes via git reset --hard HEAD~10',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.passed).toBe(false);
  });

  it('warns on production targets without blocking', async () => {
    const result = await mcpServer.handleToolCall('ftm_guard_check', {
      description: 'Update the load balancer on the production cluster',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.passed).toBe(true); // warning, not a block
    expect(body.checks.some((c: { rule: string }) => c.rule === 'production_target')).toBe(true);
  });

  it('passes clean tasks with no checks', async () => {
    const result = await mcpServer.handleToolCall('ftm_guard_check', {
      description: 'Add unit tests for the payment service',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.passed).toBe(true);
    expect(body.checks).toHaveLength(0);
  });

  it('combines multiple violations in a single check', async () => {
    const result = await mcpServer.handleToolCall('ftm_guard_check', {
      description: 'Run rm -rf on the production server and delete from logs',
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.passed).toBe(false);
    // Should flag both destructive_operation and production_target
    const rules = body.checks.map((c: { rule: string }) => c.rule);
    expect(rules).toContain('destructive_operation');
    expect(rules).toContain('production_target');
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Playbook matching through MCP
// ---------------------------------------------------------------------------

describe('When an AI agent checks playbooks via MCP', () => {
  let mcpServer: FtmMcpServer;
  let store: FtmStore;

  beforeEach(() => {
    dbPath = createDbPath();
    store = new FtmStore(dbPath);
    mcpServer = new FtmMcpServer(dbPath);

    // Seed playbooks
    store.savePlaybook({
      id: 'pb-deploy',
      name: 'Deploy Pipeline',
      trigger: 'deploy to staging',
      steps: ['run tests', 'build image', 'push to registry', 'deploy'],
      lastUsed: 0,
      useCount: 3,
    });
    store.savePlaybook({
      id: 'pb-hotfix',
      name: 'Hotfix Flow',
      trigger: 'hotfix',
      steps: ['create branch', 'apply fix', 'test', 'merge to main'],
      lastUsed: 0,
      useCount: 1,
    });
  });

  afterEach(() => {
    store.close();
    mcpServer.close();
    cleanupDb(dbPath);
  });

  it('finds a matching playbook for the exact trigger', async () => {
    const result = await mcpServer.handleToolCall('ftm_check_playbook', {
      trigger: 'deploy to staging',
    });
    const playbook = JSON.parse(result.content[0].text);
    expect(playbook.id).toBe('pb-deploy');
    expect(playbook.steps).toHaveLength(4);
  });

  it('finds a matching playbook by partial trigger match', async () => {
    const result = await mcpServer.handleToolCall('ftm_check_playbook', {
      trigger: 'hotfix',
    });
    const playbook = JSON.parse(result.content[0].text);
    expect(playbook.id).toBe('pb-hotfix');
  });

  it('returns no match message for unknown triggers', async () => {
    const result = await mcpServer.handleToolCall('ftm_check_playbook', {
      trigger: 'completely unrelated string xyz123',
    });
    expect(result.content[0].text).toBe('No matching playbook found.');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: ftm_get_tasks reflects daemon-submitted tasks
// ---------------------------------------------------------------------------

describe('When tasks exist from daemon processing', () => {
  let mcpServer: FtmMcpServer;
  let store: FtmStore;

  beforeEach(() => {
    dbPath = createDbPath();
    store = new FtmStore(dbPath);
    mcpServer = new FtmMcpServer(dbPath);
  });

  afterEach(() => {
    store.close();
    mcpServer.close();
    cleanupDb(dbPath);
  });

  it('ftm_get_tasks returns tasks seeded in the shared store', async () => {
    const sessionId = 'session-shared';
    store.createSession(sessionId);
    store.createTask({
      id: 'task-e2e-1',
      sessionId,
      description: 'Implement caching layer',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: 'Caching implemented with Redis',
    });
    store.createTask({
      id: 'task-e2e-2',
      sessionId,
      description: 'Fix login bug',
      status: 'failed',
      createdAt: Date.now() + 1,
      updatedAt: Date.now() + 1,
      error: 'Token validation failed',
    });

    const result = await mcpServer.handleToolCall('ftm_get_tasks', { limit: 10 });
    const tasks = JSON.parse(result.content[0].text);

    expect(tasks).toHaveLength(2);
    const descriptions = tasks.map((t: { description: string }) => t.description);
    expect(descriptions).toContain('Implement caching layer');
    expect(descriptions).toContain('Fix login bug');
  });

  it('ftm_get_tasks respects the limit parameter', async () => {
    const sessionId = 'session-limit';
    store.createSession(sessionId);

    for (let i = 0; i < 10; i++) {
      store.createTask({
        id: `task-limit-${i}`,
        sessionId,
        description: `Task ${i}`,
        status: 'completed',
        createdAt: Date.now() + i,
        updatedAt: Date.now() + i,
      });
    }

    const result = await mcpServer.handleToolCall('ftm_get_tasks', { limit: 3 });
    const tasks = JSON.parse(result.content[0].text);
    expect(tasks).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Unknown tool handling
// ---------------------------------------------------------------------------

describe('When an AI agent calls a non-existent MCP tool', () => {
  let mcpServer: FtmMcpServer;

  beforeEach(() => {
    dbPath = createDbPath();
    mcpServer = new FtmMcpServer(dbPath);
  });

  afterEach(() => {
    mcpServer.close();
    cleanupDb(dbPath);
  });

  it('returns an error result with isError=true', async () => {
    const result = await mcpServer.handleToolCall('ftm_does_not_exist', { foo: 'bar' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Cross-component — daemon WS submit + MCP blackboard read
// ---------------------------------------------------------------------------

describe('When a task is submitted via WebSocket and blackboard is read via MCP (shared DB)', () => {
  let store: FtmStore;
  let mcpServer: FtmMcpServer;
  let daemonServer: FtmServer;
  let eventBus: FtmEventBus;
  let daemonPort: number;

  beforeEach(async () => {
    dbPath = createDbPath();
    store = new FtmStore(dbPath);
    const sessionId = `e2e-cross-${Date.now()}`;
    store.createSession(sessionId);

    eventBus = new FtmEventBus(sessionId);
    const blackboard = new Blackboard(store);

    const registry = new AdapterRegistry();
    for (const name of ['claude', 'codex', 'gemini', 'ollama']) {
      registry.register(makeAdapter(name));
    }

    const router = new ModelRouter(registry, eventBus);
    vi.spyOn(router, 'getConfig').mockReturnValue({
      ...router.getConfig(),
      execution: { ...router.getConfig().execution, approvalMode: 'auto' as const },
    });

    const ooda = new OodaLoop(eventBus, blackboard, router);
    daemonServer = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
    await daemonServer.start(0, '127.0.0.1');
    daemonPort = daemonServer.getPort()!;

    // MCP server uses the SAME db file
    mcpServer = new FtmMcpServer(dbPath);
  });

  afterEach(() => {
    daemonServer.stop();
    mcpServer.close();
    store.close();
    cleanupDb(dbPath);
    vi.restoreAllMocks();
  });

  it('a task submitted via WebSocket appears in ftm_get_tasks from MCP', async () => {
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${daemonPort}`);
      ws.on('error', reject);
      ws.once('message', () => resolve(ws)); // consume init message
    });

    // Submit task via WS
    const submitResp = await new Promise<WsResponse>((resolve) => {
      const id = 'cross-1';
      const handler = (raw: Buffer | ArrayBuffer | Buffer[]) => {
        const parsed = JSON.parse(raw.toString()) as WsResponse;
        if (parsed.id === id) {
          ws.off('message', handler);
          resolve(parsed);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({
        type: 'submit_task',
        id,
        payload: { description: 'Cross-component test task' },
      }));
    });

    expect(submitResp.success).toBe(true);
    const taskId = submitResp.payload.taskId as string;

    // Wait for task to complete in daemon
    await vi.waitFor(() => {
      const task = store.getTask(taskId);
      expect(task!.status).toBe('completed');
    }, { timeout: 5000 });

    // Now read via MCP tools — should see the same task
    const mcpResult = await mcpServer.handleToolCall('ftm_get_tasks', { limit: 10 });
    const tasks = JSON.parse(mcpResult.content[0].text);
    const found = tasks.find((t: { id: string }) => t.id === taskId);
    expect(found).toBeDefined();
    expect(found.description).toBe('Cross-component test task');
    expect(found.status).toBe('completed');

    ws.close();
  });

  it('decisions written via MCP are visible to the daemon blackboard', async () => {
    // Write decision via MCP
    await mcpServer.handleToolCall('ftm_add_decision', {
      decision: 'Use WebSocket for real-time updates',
      reason: 'Lower latency than polling',
    });

    // Read directly from the daemon's blackboard (same DB)
    const bbDirect = new Blackboard(store);
    const ctx = bbDirect.getContext();
    expect(ctx.recentDecisions).toHaveLength(1);
    expect(ctx.recentDecisions[0].decision).toBe('Use WebSocket for real-time updates');
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: MCP tool definitions are complete and well-formed
// ---------------------------------------------------------------------------

describe('When checking the MCP server tool surface', () => {
  let mcpServer: FtmMcpServer;

  beforeEach(() => {
    dbPath = createDbPath();
    mcpServer = new FtmMcpServer(dbPath);
  });

  afterEach(() => {
    mcpServer.close();
    cleanupDb(dbPath);
  });

  it('exposes exactly 7 tools', () => {
    expect(mcpServer.getToolDefinitions()).toHaveLength(7);
  });

  it('all tools have non-empty names and descriptions', () => {
    for (const tool of mcpServer.getToolDefinitions()) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('all tool names follow the ftm_ prefix convention', () => {
    for (const tool of mcpServer.getToolDefinitions()) {
      expect(tool.name).toMatch(/^ftm_/);
    }
  });

  it('all tools have valid JSON Schema inputSchema', () => {
    for (const tool of mcpServer.getToolDefinitions()) {
      expect(tool.inputSchema).toHaveProperty('type', 'object');
      expect(tool.inputSchema).toHaveProperty('properties');
    }
  });
});
