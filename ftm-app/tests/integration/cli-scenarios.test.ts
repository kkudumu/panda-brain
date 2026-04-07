/**
 * Integration test: CLI Scenarios
 * 
 * Simulates user interaction with the FTM CLI:
 * - 'ftm status'
 * - 'ftm history'
 * - 'ftm "task description"' (submit task)
 * - 'ftm approve'
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FtmServer } from '../../packages/daemon/src/server.js';
import { FtmEventBus } from '../../packages/daemon/src/event-bus.js';
import { FtmStore } from '../../packages/daemon/src/store.js';
import { Blackboard } from '../../packages/daemon/src/blackboard.js';
import { OodaLoop } from '../../packages/daemon/src/ooda.js';
import { ModelRouter } from '../../packages/daemon/src/router.js';
import { AdapterRegistry } from '../../packages/daemon/src/adapters/registry.js';
import { createProgram } from '../../packages/cli/src/index.js';
import type { ModelAdapter, NormalizedResponse } from '../../packages/daemon/src/shared/types.js';

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

describe('CLI User Scenarios', { timeout: 30_000 }, () => {
  let store: FtmStore;
  let daemonServer: FtmServer;
  let daemonPort: number;

  beforeEach(async () => {
    store = new FtmStore(':memory:');
    const sessionId = 'cli-test-session';
    store.createSession(sessionId);

    const eventBus = new FtmEventBus(sessionId);
    const blackboard = new Blackboard(store);
    const registry = new AdapterRegistry();
    registry.register(makeAdapter('claude'));
    const router = new ModelRouter(registry, eventBus);
    
    vi.spyOn(router, 'getConfig').mockReturnValue({
      ...router.getConfig(),
      execution: { ...router.getConfig().execution, approvalMode: 'auto' },
    });

    const ooda = new OodaLoop(eventBus, blackboard, router);
    daemonServer = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
    await daemonServer.start(0, '127.0.0.1');
    daemonPort = daemonServer.getPort()!;

    // Point CLI to the test daemon
    process.env.FTM_DAEMON_PORT = daemonPort.toString();
    
    // Silence ora and chalk for cleaner test output
    vi.mock('ora', () => ({
      default: vi.fn().mockReturnValue({
        start: vi.fn().mockReturnThis(),
        stop: vi.fn().mockReturnThis(),
        succeed: vi.fn().mockReturnThis(),
        fail: vi.fn().mockReturnThis(),
        text: '',
      }),
    }));
  });

  afterEach(() => {
    daemonServer.stop();
    vi.restoreAllMocks();
  });

  it('ftm status — shows the daemon state', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = createProgram();
    
    await program.parseAsync(['node', 'ftm', 'status']);

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/FTM Daemon Status/i));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Machine: ○ idle/i));
  });

  it('ftm history — shows recent tasks', async () => {
    // Seed a task
    store.createTask({
      id: 't1',
      description: 'Test Task',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: 'cli-test-session',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = createProgram();
    
    await program.parseAsync(['node', 'ftm', 'history']);

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Recent Tasks/i));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/completed/i));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Test Task/i));
  });

  it('ftm "task" — submits a task and waits for completion', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = createProgram();

    // Mock process.exit to prevent test from exiting
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    
    await program.parseAsync(['node', 'ftm', 'Integrate CLI tests']);

    // Should show progress events
    await vi.waitFor(() => {
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Task completed/i));
    }, { timeout: 5000 });

    const tasks = store.getRecentTasks(1);
    expect(tasks[0].description).toBe('Integrate CLI tests');
    expect(tasks[0].status).toBe('completed');
    
    exitSpy.mockRestore();
  });
});
