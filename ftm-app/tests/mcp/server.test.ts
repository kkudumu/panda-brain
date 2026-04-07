import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FtmStore } from '../../src/daemon/store.js';
import { FtmMcpServer } from '../../src/mcp/server.js';
import type { Task, Playbook } from '../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: 'task-mcp-1',
    sessionId: 'session-mcp-1',
    description: 'MCP test task',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    id: 'pb-mcp-1',
    name: 'Deploy pipeline',
    trigger: 'deploy to staging',
    steps: ['build image', 'run tests', 'push to registry', 'deploy'],
    lastUsed: 0,
    useCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('FtmMcpServer', () => {
  let store: FtmStore;
  let mcpServer: FtmMcpServer;

  beforeEach(() => {
    // FtmMcpServer creates its own FtmStore internally, but we also need a
    // direct store handle to pre-populate data (tasks, playbooks, sessions).
    // We work around this by constructing FtmMcpServer with :memory: and
    // providing fixtures via handleToolCall where possible, or by pre-seeding
    // a separate store that shares the same :memory: path.
    //
    // Because each :memory: connection is isolated in SQLite, we cannot share
    // the same in-memory DB across two FtmStore instances.  Instead we expose
    // a helper that creates the server, seeds it through its own tool API, and
    // uses a standalone store only for pre-population fixtures that require
    // direct DB access (e.g. creating a session+task row for ftm_get_tasks).
    //
    // For the task-seeding tests we use the direct store handle passed as the
    // internal store via a thin subclass.  The simplest approach is to create
    // the server with :memory: and accept that ftm_get_tasks returns results
    // from whatever is in that private store — we seed via the store.createTask
    // path exposed through a shared FtmStore at the same :memory: path.
    //
    // Simplest working approach: use a named temp file so both references share
    // the same DB.  But we want in-memory.  The real solution: expose the store
    // for test injection OR accept that we can only pre-populate via the tool
    // interface itself.
    //
    // We choose the latter for pure tools (experience, decision) and use a
    // named in-memory DB via the URI ":memory:" path for both to share.
    // SQLite only isolates :memory: per connection, so we use a temp file
    // path within the OS temp directory.
    const { tmpdir } = require('os');
    const { join } = require('path');
    const { randomUUID } = require('crypto');
    const dbPath = join(tmpdir(), `ftm-test-${randomUUID()}.db`);

    store = new FtmStore(dbPath);
    mcpServer = new FtmMcpServer(dbPath);
  });

  afterEach(() => {
    store.close();
    mcpServer.close();
  });

  // -------------------------------------------------------------------------
  // getToolDefinitions
  // -------------------------------------------------------------------------

  describe('getToolDefinitions', () => {
    it('returns all 7 tools', () => {
      const tools = mcpServer.getToolDefinitions();
      expect(tools).toHaveLength(7);

      const names = tools.map(t => t.name);
      expect(names).toContain('ftm_get_blackboard');
      expect(names).toContain('ftm_check_playbook');
      expect(names).toContain('ftm_guard_check');
      expect(names).toContain('ftm_log_daily');
      expect(names).toContain('ftm_get_tasks');
      expect(names).toContain('ftm_write_experience');
      expect(names).toContain('ftm_add_decision');
    });

    it('each tool has name, description, and inputSchema', () => {
      const tools = mcpServer.getToolDefinitions();
      for (const tool of tools) {
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.inputSchema).toBe('object');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Unknown tool
  // -------------------------------------------------------------------------

  describe('unknown tool', () => {
    it('returns isError for unknown tool name', async () => {
      const result = await mcpServer.handleToolCall('ftm_nonexistent', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });
  });

  // -------------------------------------------------------------------------
  // ftm_get_blackboard
  // -------------------------------------------------------------------------

  describe('ftm_get_blackboard', () => {
    it('returns valid BlackboardContext JSON', async () => {
      const result = await mcpServer.handleToolCall('ftm_get_blackboard', {});

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const context = JSON.parse(result.content[0].text);
      expect(context).toHaveProperty('currentTask');
      expect(context).toHaveProperty('recentDecisions');
      expect(context).toHaveProperty('activeConstraints');
      expect(context).toHaveProperty('sessionMetadata');
      expect(context.currentTask).toBeNull();
      expect(Array.isArray(context.recentDecisions)).toBe(true);
      expect(Array.isArray(context.activeConstraints)).toBe(true);
      expect(typeof context.sessionMetadata.startedAt).toBe('number');
    });

    it('reflects decisions added via ftm_add_decision', async () => {
      await mcpServer.handleToolCall('ftm_add_decision', {
        decision: 'use TypeScript',
        reason: 'type safety',
      });

      const result = await mcpServer.handleToolCall('ftm_get_blackboard', {});
      const context = JSON.parse(result.content[0].text);
      expect(context.recentDecisions).toHaveLength(1);
      expect(context.recentDecisions[0].decision).toBe('use TypeScript');
    });
  });

  // -------------------------------------------------------------------------
  // ftm_check_playbook
  // -------------------------------------------------------------------------

  describe('ftm_check_playbook', () => {
    it('returns "No matching playbook found." when no match', async () => {
      const result = await mcpServer.handleToolCall('ftm_check_playbook', {
        trigger: 'completely unrelated trigger xyz',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe('No matching playbook found.');
    });

    it('returns playbook JSON when trigger matches', async () => {
      // Seed the playbook into the shared store (same DB file as the server)
      store.savePlaybook(makePlaybook());

      const result = await mcpServer.handleToolCall('ftm_check_playbook', {
        trigger: 'deploy to staging',
      });

      expect(result.isError).toBeUndefined();
      const playbook = JSON.parse(result.content[0].text);
      expect(playbook.id).toBe('pb-mcp-1');
      expect(Array.isArray(playbook.steps)).toBe(true);
      expect(playbook.steps.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // ftm_guard_check
  // -------------------------------------------------------------------------

  describe('ftm_guard_check', () => {
    it('passes clean task descriptions with no checks', async () => {
      const result = await mcpServer.handleToolCall('ftm_guard_check', {
        description: 'Refactor the authentication module for better readability',
      });

      const body = JSON.parse(result.content[0].text);
      expect(body.passed).toBe(true);
      expect(body.checks).toHaveLength(0);
    });

    it('blocks on rm -rf', async () => {
      const result = await mcpServer.handleToolCall('ftm_guard_check', {
        description: 'Run rm -rf /tmp/old-builds to clean up',
      });

      const body = JSON.parse(result.content[0].text);
      expect(body.passed).toBe(false);
      const blockChecks = body.checks.filter((c: { severity: string }) => c.severity === 'block');
      expect(blockChecks.length).toBeGreaterThan(0);
      expect(blockChecks[0].rule).toBe('destructive_operation');
    });

    it('blocks on drop table', async () => {
      const result = await mcpServer.handleToolCall('ftm_guard_check', {
        description: 'Drop table users from the staging database',
      });

      const body = JSON.parse(result.content[0].text);
      expect(body.passed).toBe(false);
    });

    it('blocks on git push --force', async () => {
      const result = await mcpServer.handleToolCall('ftm_guard_check', {
        description: 'git push --force origin main',
      });

      const body = JSON.parse(result.content[0].text);
      expect(body.passed).toBe(false);
    });

    it('blocks on git reset --hard', async () => {
      const result = await mcpServer.handleToolCall('ftm_guard_check', {
        description: 'Run git reset --hard HEAD~3 to undo commits',
      });

      const body = JSON.parse(result.content[0].text);
      expect(body.passed).toBe(false);
    });

    it('warns on production target without blocking', async () => {
      const result = await mcpServer.handleToolCall('ftm_guard_check', {
        description: 'Update the nginx config on the production server',
      });

      const body = JSON.parse(result.content[0].text);
      // Should pass (no block) but have a warning
      expect(body.passed).toBe(true);
      const warnings = body.checks.filter((c: { severity: string }) => c.severity === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].rule).toBe('production_target');
    });

    it('combines block and warning when both apply', async () => {
      const result = await mcpServer.handleToolCall('ftm_guard_check', {
        description: 'Run rm -rf /var/www on the production server',
      });

      const body = JSON.parse(result.content[0].text);
      expect(body.passed).toBe(false);
      const rules = body.checks.map((c: { rule: string }) => c.rule);
      expect(rules).toContain('destructive_operation');
      expect(rules).toContain('production_target');
    });
  });

  // -------------------------------------------------------------------------
  // ftm_log_daily
  // -------------------------------------------------------------------------

  describe('ftm_log_daily', () => {
    it('creates an event in the store', async () => {
      const result = await mcpServer.handleToolCall('ftm_log_daily', {
        entry: 'Completed authentication module refactor',
        type: 'task',
      });

      expect(result.content[0].text).toBe('Logged.');

      // Verify event was persisted in the shared DB
      const events = store.getEventsByType('daily_log', 10);
      expect(events).toHaveLength(1);
      expect(events[0].data.entry).toBe('Completed authentication module refactor');
      expect(events[0].data.entryType).toBe('task');
    });

    it('defaults entryType to note when type omitted', async () => {
      await mcpServer.handleToolCall('ftm_log_daily', {
        entry: 'A note without a type',
      });

      const events = store.getEventsByType('daily_log', 10);
      expect(events[0].data.entryType).toBe('note');
    });

    it('sets sessionId to mcp', async () => {
      await mcpServer.handleToolCall('ftm_log_daily', { entry: 'test' });

      const events = store.getEventsByType('daily_log', 10);
      expect(events[0].sessionId).toBe('mcp');
    });
  });

  // -------------------------------------------------------------------------
  // ftm_get_tasks
  // -------------------------------------------------------------------------

  describe('ftm_get_tasks', () => {
    it('returns empty array when no tasks exist', async () => {
      const result = await mcpServer.handleToolCall('ftm_get_tasks', {});
      const tasks = JSON.parse(result.content[0].text);
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(0);
    });

    it('returns recent tasks', async () => {
      // Pre-seed via the shared store (same DB file)
      const sessionId = 'session-mcp-test';
      store.createSession(sessionId);

      const task = makeTask({ id: 'task-seed-1', sessionId });
      store.createTask(task);

      const result = await mcpServer.handleToolCall('ftm_get_tasks', {});
      const tasks = JSON.parse(result.content[0].text);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task-seed-1');
    });

    it('respects the limit parameter', async () => {
      const sessionId = 'session-mcp-limit';
      store.createSession(sessionId);

      for (let i = 0; i < 5; i++) {
        store.createTask(makeTask({ id: `task-limit-${i}`, sessionId }));
      }

      const result = await mcpServer.handleToolCall('ftm_get_tasks', { limit: 3 });
      const tasks = JSON.parse(result.content[0].text);
      expect(tasks).toHaveLength(3);
    });

    it('defaults to limit 10', async () => {
      const sessionId = 'session-mcp-default';
      store.createSession(sessionId);

      for (let i = 0; i < 15; i++) {
        store.createTask(makeTask({ id: `task-default-${i}`, sessionId }));
      }

      const result = await mcpServer.handleToolCall('ftm_get_tasks', {});
      const tasks = JSON.parse(result.content[0].text);
      expect(tasks).toHaveLength(10);
    });
  });

  // -------------------------------------------------------------------------
  // ftm_write_experience
  // -------------------------------------------------------------------------

  describe('ftm_write_experience', () => {
    it('records experience and can be retrieved', async () => {
      const result = await mcpServer.handleToolCall('ftm_write_experience', {
        taskType: 'debugging',
        outcome: 'success',
        lessons: ['add logging early', 'isolate components first'],
        tags: ['typescript', 'async'],
      });

      expect(result.content[0].text).toBe('Experience recorded.');

      const experiences = store.getExperiences({ taskType: 'debugging' });
      expect(experiences).toHaveLength(1);
      expect(experiences[0].taskType).toBe('debugging');
      expect(experiences[0].outcome).toBe('success');
      expect(experiences[0].lessons).toContain('add logging early');
      expect(experiences[0].tags).toContain('typescript');
    });

    it('defaults tags to empty array when omitted', async () => {
      await mcpServer.handleToolCall('ftm_write_experience', {
        taskType: 'refactoring',
        outcome: 'partial',
        lessons: ['break into smaller PRs'],
      });

      const experiences = store.getExperiences({ taskType: 'refactoring' });
      expect(experiences[0].tags).toEqual([]);
    });

    it('auto-generates id and timestamp', async () => {
      await mcpServer.handleToolCall('ftm_write_experience', {
        taskType: 'testing',
        outcome: 'success',
        lessons: [],
      });

      const experiences = store.getExperiences({ taskType: 'testing' });
      expect(experiences[0].id).toBeTruthy();
      expect(typeof experiences[0].timestamp).toBe('number');
      expect(experiences[0].timestamp).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // ftm_add_decision
  // -------------------------------------------------------------------------

  describe('ftm_add_decision', () => {
    it('records decision and appears in blackboard context', async () => {
      const decisionResult = await mcpServer.handleToolCall('ftm_add_decision', {
        decision: 'use PostgreSQL over MongoDB',
        reason: 'relational data model fits better',
      });

      expect(decisionResult.content[0].text).toBe('Decision recorded.');

      const bbResult = await mcpServer.handleToolCall('ftm_get_blackboard', {});
      const context = JSON.parse(bbResult.content[0].text);

      expect(context.recentDecisions).toHaveLength(1);
      expect(context.recentDecisions[0].decision).toBe('use PostgreSQL over MongoDB');
      expect(context.recentDecisions[0].reason).toBe('relational data model fits better');
      expect(typeof context.recentDecisions[0].timestamp).toBe('number');
    });

    it('accumulates multiple decisions', async () => {
      await mcpServer.handleToolCall('ftm_add_decision', { decision: 'decision-1', reason: 'reason-1' });
      await mcpServer.handleToolCall('ftm_add_decision', { decision: 'decision-2', reason: 'reason-2' });
      await mcpServer.handleToolCall('ftm_add_decision', { decision: 'decision-3', reason: 'reason-3' });

      const bbResult = await mcpServer.handleToolCall('ftm_get_blackboard', {});
      const context = JSON.parse(bbResult.content[0].text);

      expect(context.recentDecisions).toHaveLength(3);
    });
  });
});
