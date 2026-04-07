import { describe, it, expect, vi } from 'vitest';
import { GuardModule, type GuardRule, type GuardCheckResult } from '@ftm/daemon';
import type { TaskContext, Task, FtmEvent } from '@ftm/daemon';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(description: string, taskId = 'task-guard-1'): TaskContext {
  const now = Date.now();
  const task: Task = {
    id: taskId,
    sessionId: 'session-guard-1',
    description,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  return {
    task,
    blackboard: {
      currentTask: task,
      recentDecisions: [],
      activeConstraints: [],
      sessionMetadata: {
        startedAt: now,
        lastUpdated: now,
        skillsInvoked: [],
      },
    },
    config: {
      profile: 'balanced',
      profiles: {
        balanced: { planning: 'claude', execution: 'codex', review: 'gemini' },
      },
      execution: {
        maxParallelAgents: 5,
        autoAudit: true,
        progressTracking: true,
        approvalMode: 'plan_first',
      },
      daemon: { port: 4040, host: 'localhost' },
    },
  };
}

function collectEmitted(): { events: FtmEvent[]; emit: (event: FtmEvent) => void } {
  const events: FtmEvent[] = [];
  return {
    events,
    emit: (event: FtmEvent) => events.push(event),
  };
}

// ---------------------------------------------------------------------------
// Destructive operation detection
// ---------------------------------------------------------------------------

describe('GuardModule — destructive_operation rule', () => {
  it('blocks rm -rf', async () => {
    const guard = new GuardModule();
    const { emit } = collectEmitted();

    const result = await guard.execute(makeContext('run rm -rf /tmp/cache directory'), emit);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Destructive operation detected/);
    expect(result.error).toMatch(/rm -rf/);
  });

  it('blocks git push --force', async () => {
    const guard = new GuardModule();
    const { emit } = collectEmitted();

    const result = await guard.execute(makeContext('git push --force origin main'), emit);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/git push --force/);
  });

  it('blocks git reset --hard', async () => {
    const guard = new GuardModule();
    const { emit } = collectEmitted();

    const result = await guard.execute(makeContext('git reset --hard HEAD~3 to undo commits'), emit);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/git reset --hard/);
  });

  it('blocks drop table', async () => {
    const guard = new GuardModule();
    const { emit } = collectEmitted();

    const result = await guard.execute(makeContext('drop table users in the database'), emit);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/drop table/);
  });

  it('blocks delete from', async () => {
    const guard = new GuardModule();
    const { emit } = collectEmitted();

    const result = await guard.execute(makeContext('delete from orders where status = "old"'), emit);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/delete from/);
  });

  it('emits guard_triggered event when blocked', async () => {
    const guard = new GuardModule();
    const { events, emit } = collectEmitted();

    await guard.execute(makeContext('run rm -rf /tmp'), emit);

    const guardEvt = events.find((e) => e.type === 'guard_triggered');
    expect(guardEvt).toBeDefined();
    expect(Array.isArray((guardEvt?.data as Record<string, unknown>).blocked)).toBe(true);
  });

  it('allows safe read-only task', async () => {
    const guard = new GuardModule();
    const { emit } = collectEmitted();

    const result = await guard.execute(makeContext('list all files in the src directory'), emit);

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Production target warning
// ---------------------------------------------------------------------------

describe('GuardModule — production_target rule', () => {
  it('warns when task mentions "production"', async () => {
    const guard = new GuardModule();
    const { events, emit } = collectEmitted();

    const result = await guard.execute(
      makeContext('Deploy the updated service to production environment'),
      emit,
    );

    // Warning does not block — task should succeed
    expect(result.success).toBe(true);

    const guardEvt = events.find((e) => e.type === 'guard_triggered');
    expect(guardEvt).toBeDefined();
    const data = guardEvt?.data as Record<string, unknown>;
    expect(Array.isArray(data.warnings)).toBe(true);
    const warnings = data.warnings as Array<{ rule: string; reason: string }>;
    const prodWarning = warnings.find((w) => w.rule === 'production_target');
    expect(prodWarning).toBeDefined();
    expect(prodWarning?.reason).toMatch(/production/i);
  });

  it('warns when task mentions " prod "', async () => {
    const guard = new GuardModule();
    const { events, emit } = collectEmitted();

    const result = await guard.execute(
      makeContext('restart the server in prod after config change'),
      emit,
    );

    expect(result.success).toBe(true);
    const guardEvt = events.find((e) => e.type === 'guard_triggered');
    expect(guardEvt).toBeDefined();
  });

  it('does not warn for non-production tasks', async () => {
    const guard = new GuardModule();
    const { events, emit } = collectEmitted();

    const result = await guard.execute(
      makeContext('run integration tests in the staging environment'),
      emit,
    );

    expect(result.success).toBe(true);
    const guardEvt = events.find((e) => e.type === 'guard_triggered');
    expect(guardEvt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Loop detection
// ---------------------------------------------------------------------------

describe('GuardModule — loop detection', () => {
  it('allows task on first attempt', async () => {
    const guard = new GuardModule();
    const { emit } = collectEmitted();

    const result = await guard.execute(makeContext('write a unit test', 'looping-task-1'), emit);

    expect(result.success).toBe(true);
  });

  it('records failures and increments count', () => {
    const guard = new GuardModule();

    expect(guard.recordFailure('t-1')).toBe(1);
    expect(guard.recordFailure('t-1')).toBe(2);
    expect(guard.recordFailure('t-1')).toBe(3);
  });

  it('isLooping returns false below threshold', () => {
    const guard = new GuardModule();
    guard.recordFailure('t-2');
    guard.recordFailure('t-2');

    expect(guard.isLooping('t-2')).toBe(false);
  });

  it('isLooping returns true at threshold', () => {
    const guard = new GuardModule();
    guard.recordFailure('t-3');
    guard.recordFailure('t-3');
    guard.recordFailure('t-3');

    expect(guard.isLooping('t-3')).toBe(true);
  });

  it('isLooping returns true above threshold', () => {
    const guard = new GuardModule();
    for (let i = 0; i < 5; i++) guard.recordFailure('t-4');

    expect(guard.isLooping('t-4')).toBe(true);
  });

  it('isLooping respects a custom threshold', () => {
    const guard = new GuardModule();
    guard.recordFailure('t-5');
    guard.recordFailure('t-5');

    expect(guard.isLooping('t-5', 2)).toBe(true);
    expect(guard.isLooping('t-5', 5)).toBe(false);
  });

  it('clearFailures resets the count', () => {
    const guard = new GuardModule();
    guard.recordFailure('t-6');
    guard.recordFailure('t-6');
    guard.recordFailure('t-6');

    expect(guard.isLooping('t-6')).toBe(true);

    guard.clearFailures('t-6');
    expect(guard.isLooping('t-6')).toBe(false);
  });

  it('blocks task via loop_detection rule after 3 failures', async () => {
    const guard = new GuardModule();
    const taskId = 'looping-task-detected';

    guard.recordFailure(taskId);
    guard.recordFailure(taskId);
    guard.recordFailure(taskId);

    const { emit } = collectEmitted();
    const result = await guard.execute(makeContext('some task that keeps failing', taskId), emit);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Loop detected/);
    expect(result.error).toMatch(taskId);
  });
});

// ---------------------------------------------------------------------------
// Custom rule registration
// ---------------------------------------------------------------------------

describe('GuardModule — custom rule registration', () => {
  it('registers and evaluates a custom rule', async () => {
    const guard = new GuardModule();

    const customRule: GuardRule = {
      name: 'no_weekends',
      description: 'Blocks tasks mentioning weekend deploys',
      check(context): GuardCheckResult {
        if (context.task.description.toLowerCase().includes('weekend')) {
          return {
            allowed: false,
            reason: 'No deployments on weekends',
            severity: 'block',
          };
        }
        return { allowed: true, severity: 'info' };
      },
    };

    guard.registerRule(customRule);

    const { emit } = collectEmitted();
    const result = await guard.execute(
      makeContext('deploy new feature over the weekend'),
      emit,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No deployments on weekends/);
  });

  it('custom warning rule does not block the task', async () => {
    const guard = new GuardModule();

    const warnRule: GuardRule = {
      name: 'large_migration',
      description: 'Warns on large database migrations',
      check(context): GuardCheckResult {
        if (context.task.description.toLowerCase().includes('migration')) {
          return {
            allowed: true,
            reason: 'Large migration detected — ensure backup exists',
            severity: 'warning',
          };
        }
        return { allowed: true, severity: 'info' };
      },
    };

    guard.registerRule(warnRule);

    const { events, emit } = collectEmitted();
    const result = await guard.execute(
      makeContext('run the large database migration script'),
      emit,
    );

    expect(result.success).toBe(true);

    const guardEvt = events.find((e) => e.type === 'guard_triggered');
    expect(guardEvt).toBeDefined();
    const warnings = (guardEvt?.data as Record<string, unknown>).warnings as Array<{
      rule: string;
    }>;
    expect(warnings.some((w) => w.rule === 'large_migration')).toBe(true);
  });

  it('multiple custom rules are all evaluated', async () => {
    const guard = new GuardModule();

    const rule1: GuardRule = {
      name: 'rule_one',
      description: 'Blocks keyword alpha',
      check(ctx): GuardCheckResult {
        if (ctx.task.description.includes('alpha')) {
          return { allowed: false, reason: 'alpha not allowed', severity: 'block' };
        }
        return { allowed: true, severity: 'info' };
      },
    };

    const rule2: GuardRule = {
      name: 'rule_two',
      description: 'Blocks keyword beta',
      check(ctx): GuardCheckResult {
        if (ctx.task.description.includes('beta')) {
          return { allowed: false, reason: 'beta not allowed', severity: 'block' };
        }
        return { allowed: true, severity: 'info' };
      },
    };

    guard.registerRule(rule1);
    guard.registerRule(rule2);

    const { emit } = collectEmitted();
    const result = await guard.execute(makeContext('do alpha and beta things'), emit);

    expect(result.success).toBe(false);
    // Both rules fired — both reasons should appear
    expect(result.error).toMatch(/alpha not allowed/);
    expect(result.error).toMatch(/beta not allowed/);
  });

  it('canHandle always returns true for guard module', () => {
    const guard = new GuardModule();
    const ctx = makeContext('anything');
    expect(guard.canHandle(ctx)).toBe(true);
  });
});
