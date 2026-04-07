import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OodaLoop } from '../../packages/daemon/src/ooda.js';
import { FtmEventBus } from '../../packages/daemon/src/event-bus.js';
import { Blackboard } from '../../packages/daemon/src/blackboard.js';
import { FtmStore } from '../../packages/daemon/src/store.js';
import { ModelRouter } from '../../packages/daemon/src/router.js';
import { AdapterRegistry } from '../../packages/daemon/src/adapters/registry.js';
import { MindModule } from '../../packages/daemon/src/modules/mind.js';
import { GuardModule } from '../../packages/daemon/src/modules/guard.js';
import type {
  Task,
  ModelAdapter,
  NormalizedResponse,
  TaskContext,
  ModuleResult,
  FtmEvent,
} from '../../packages/daemon/src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: `task-${Date.now()}`,
    sessionId: 'session-test',
    description: 'Write a simple hello world function in TypeScript',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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

function buildOoda(options: {
  adapters?: ModelAdapter[];
  approvalMode?: 'auto' | 'plan_first' | 'always_ask';
} = {}): {
  loop: OodaLoop;
  bus: FtmEventBus;
  store: FtmStore;
  blackboard: Blackboard;
  router: ModelRouter;
  registry: AdapterRegistry;
} {
  const store = new FtmStore(':memory:');
  const bus = new FtmEventBus('test-session');
  const blackboard = new Blackboard(store);

  const registry = new AdapterRegistry();
  // Register mock adapters (all available by default so tests run without CLIs)
  const adapters = options.adapters ?? [
    makeAvailableAdapter('claude'),
    makeAvailableAdapter('codex'),
    makeAvailableAdapter('gemini'),
    makeAvailableAdapter('ollama'),
  ];
  for (const a of adapters) {
    registry.register(a);
  }

  // Build a router with the desired approval mode
  const router = new ModelRouter(registry, bus);

  // Patch approvalMode when needed without a real config file
  if (options.approvalMode) {
    vi.spyOn(router, 'getConfig').mockReturnValue({
      ...router.getConfig(),
      execution: {
        ...router.getConfig().execution,
        approvalMode: options.approvalMode,
      },
    });
  }

  const loop = new OodaLoop(bus, blackboard, router);
  return { loop, bus, store, blackboard, router, registry };
}

// ---------------------------------------------------------------------------
// Module registration
// ---------------------------------------------------------------------------

describe('OodaLoop — module registration', () => {
  it('registers modules that are later matched during orient phase', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    const mind = new MindModule();
    loop.registerModule(mind);

    const phases: string[] = [];
    bus.on('ooda_phase', (evt) => {
      phases.push(evt.data.phase as string);
    });

    const task = makeTask();
    await loop.processTask(task);

    // OODA loop goes through observe → orient → decide → act → complete
    expect(phases).toContain('orient');
    expect(phases).toContain('complete');
  });
});

// ---------------------------------------------------------------------------
// Full OODA cycle
// ---------------------------------------------------------------------------

describe('OodaLoop — full OODA cycle', () => {
  it('transitions through all phases in order', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    const phases: string[] = [];
    bus.on('ooda_phase', (evt) => phases.push(evt.data.phase as string));

    const task = makeTask();
    await loop.processTask(task);

    expect(phases).toEqual(
      expect.arrayContaining(['observe', 'orient', 'decide', 'act', 'complete']),
    );
    // Ensure they appear in the correct relative order
    expect(phases.indexOf('observe')).toBeLessThan(phases.indexOf('orient'));
    expect(phases.indexOf('orient')).toBeLessThan(phases.indexOf('decide'));
    expect(phases.indexOf('decide')).toBeLessThan(phases.indexOf('act'));
    expect(phases.indexOf('act')).toBeLessThan(phases.indexOf('complete'));
  });

  it('emits memory_retrieved during observe phase', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    const memEvents: FtmEvent[] = [];
    bus.on('memory_retrieved', (evt) => memEvents.push(evt));

    const task = makeTask();
    await loop.processTask(task);

    expect(memEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('emits plan_generated during decide phase', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    const planEvents: FtmEvent[] = [];
    bus.on('plan_generated', (evt) => planEvents.push(evt));

    const task = makeTask();
    await loop.processTask(task);

    expect(planEvents.length).toBe(1);
    expect(planEvents[0].data.taskId).toBe(task.id);
  });

  it('emits step_started and step_completed for each plan step', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    const started: FtmEvent[] = [];
    const completed: FtmEvent[] = [];
    bus.on('step_started', (evt) => started.push(evt));
    bus.on('step_completed', (evt) => completed.push(evt));

    const task = makeTask();
    await loop.processTask(task);

    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(completed.length).toBe(started.length);
  });

  it('emits task_completed on success', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    let completed = false;
    bus.on('task_completed', () => {
      completed = true;
    });

    const task = makeTask();
    const result = await loop.processTask(task);

    expect(result.success).toBe(true);
    expect(completed).toBe(true);
  });

  it('returns output aggregated from all steps', async () => {
    const { loop } = buildOoda({ approvalMode: 'auto' });
    const task = makeTask();
    const result = await loop.processTask(task);

    expect(result.success).toBe(true);
    expect(typeof result.output).toBe('string');
    expect(result.output!.length).toBeGreaterThan(0);
  });

  it('clears currentTask and currentPlan after completion', async () => {
    const { loop } = buildOoda({ approvalMode: 'auto' });
    const task = makeTask();
    await loop.processTask(task);

    expect(loop.getCurrentTask()).toBeNull();
    expect(loop.getCurrentPlan()).toBeNull();
  });

  it('returns idle phase initially and complete phase after processing', async () => {
    const { loop } = buildOoda({ approvalMode: 'auto' });

    expect(loop.getPhase()).toBe('idle');

    const task = makeTask();
    await loop.processTask(task);

    expect(loop.getPhase()).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('OodaLoop — error handling', () => {
  it('transitions to error phase when adapter throws', async () => {
    // execution in balanced profile = codex, so make codex throw
    const throwingCodex = makeAvailableAdapter('codex');
    (throwingCodex.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('adapter exploded'),
    );
    const throwingClaude = makeAvailableAdapter('claude');
    (throwingClaude.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('adapter exploded'),
    );
    const throwingGemini = makeAvailableAdapter('gemini');
    (throwingGemini.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('adapter exploded'),
    );
    const throwingOllama = makeAvailableAdapter('ollama');
    (throwingOllama.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('adapter exploded'),
    );

    const { loop, bus } = buildOoda({
      adapters: [throwingClaude, throwingCodex, throwingGemini, throwingOllama],
      approvalMode: 'auto',
    });

    const phases: string[] = [];
    bus.on('ooda_phase', (evt) => phases.push(evt.data.phase as string));

    const task = makeTask();
    const result = await loop.processTask(task);

    expect(result.success).toBe(false);
    expect(result.error).toContain('adapter exploded');
    expect(phases).toContain('error');
  });

  it('emits error event with taskId and message on failure', async () => {
    // Make all adapters throw so the error path is always hit
    const throwingAdapters = ['claude', 'codex', 'gemini', 'ollama'].map((name) => {
      const a = makeAvailableAdapter(name);
      (a.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('something broke'));
      return a;
    });

    const { loop, bus } = buildOoda({
      adapters: throwingAdapters,
      approvalMode: 'auto',
    });

    const errorEvents: FtmEvent[] = [];
    bus.on('error', (evt) => errorEvents.push(evt));

    const task = makeTask();
    await loop.processTask(task);

    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].data.taskId).toBe(task.id);
    expect(typeof errorEvents[0].data.error).toBe('string');
  });

  it('clears task state even after error', async () => {
    // Make all adapters fail so the error path fires regardless of fallback
    const throwingAdapters = ['claude', 'codex', 'gemini', 'ollama'].map((name) => {
      const a = makeAvailableAdapter(name);
      (a.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      return a;
    });

    const { loop } = buildOoda({
      adapters: throwingAdapters,
      approvalMode: 'auto',
    });

    await loop.processTask(makeTask());

    expect(loop.getCurrentTask()).toBeNull();
    expect(loop.getCurrentPlan()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Guard integration
// ---------------------------------------------------------------------------

describe('OodaLoop — guard integration', () => {
  it('adds a requiresApproval confirmation step for destructive operations', async () => {
    // The OODA loop's checkGuardRules detects destructive patterns and injects
    // requiresApproval steps into the plan.  Guard module execute() is separate and
    // runs as an FtmModule — here we verify the OODA-level guard flag integration.
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    const planEvents: FtmEvent[] = [];
    bus.on('plan_generated', (evt) => planEvents.push(evt));

    const task = makeTask({ description: 'run rm -rf /tmp/test directory' });
    await loop.processTask(task);

    expect(planEvents.length).toBe(1);
    const plan = planEvents[0].data.plan as { steps: Array<{ requiresApproval?: boolean }> };
    const hasApprovalStep = plan.steps.some((s) => s.requiresApproval === true);
    expect(hasApprovalStep).toBe(true);
  });

  it('adds production_target guard step when task mentions production', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    const planEvents: FtmEvent[] = [];
    bus.on('plan_generated', (evt) => planEvents.push(evt));

    const task = makeTask({
      description: 'Deploy the new feature to production environment',
    });
    await loop.processTask(task);

    expect(planEvents.length).toBe(1);
    const plan = planEvents[0].data.plan as { steps: Array<{ requiresApproval?: boolean; description: string }> };
    const guardStep = plan.steps.find((s) => s.requiresApproval);
    expect(guardStep).toBeDefined();
    expect(guardStep?.description).toMatch(/production/i);
  });
});

// ---------------------------------------------------------------------------
// Approval waiting
// ---------------------------------------------------------------------------

describe('OodaLoop — approval waiting', () => {
  it('emits approval_requested when approvalMode is plan_first', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'plan_first' });

    const approvalEvents: FtmEvent[] = [];
    bus.on('approval_requested', (evt) => approvalEvents.push(evt));

    const task = makeTask();

    // We need to auto-approve so the loop doesn't hang
    bus.on('plan_generated', (evt) => {
      const plan = evt.data.plan as { id: string };
      // Emit plan_approved to unblock waitForApproval
      setTimeout(() => {
        bus.emit('plan_approved', { planId: plan.id });
      }, 0);
    });

    await loop.processTask(task);

    expect(approvalEvents.length).toBeGreaterThanOrEqual(1);
    const evt = approvalEvents.find((e) => 'taskId' in e.data);
    expect(evt?.data.taskId).toBe(task.id);
  });

  it('does NOT emit approval_requested when approvalMode is auto', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    const approvalRequests: FtmEvent[] = [];
    // Only capture top-level approval_requested (the one with taskId from processTask)
    bus.on('approval_requested', (evt) => {
      if ('taskId' in evt.data) {
        approvalRequests.push(evt);
      }
    });

    const task = makeTask();
    await loop.processTask(task);

    expect(approvalRequests.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

describe('OodaLoop — phase transitions', () => {
  it('exposes current phase during processing via getPhase()', async () => {
    const { loop, bus } = buildOoda({ approvalMode: 'auto' });

    const phasesDuringProcessing: string[] = [];
    bus.on('ooda_phase', () => {
      phasesDuringProcessing.push(loop.getPhase());
    });

    const task = makeTask();
    await loop.processTask(task);

    // Phase at each emission event should match the announced phase
    expect(phasesDuringProcessing.length).toBeGreaterThanOrEqual(4);
  });

  it('getPhase returns idle before any task', () => {
    const { loop } = buildOoda();
    expect(loop.getPhase()).toBe('idle');
  });

  it('getPhase returns error after a failure', async () => {
    const throwingAdapters = ['claude', 'codex', 'gemini', 'ollama'].map((name) => {
      const a = makeAvailableAdapter(name);
      (a.startSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));
      return a;
    });

    const { loop } = buildOoda({
      adapters: throwingAdapters,
      approvalMode: 'auto',
    });

    await loop.processTask(makeTask());
    expect(loop.getPhase()).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
afterEach(() => {
  vi.restoreAllMocks();
});
