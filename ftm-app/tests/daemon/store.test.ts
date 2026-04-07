import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FtmStore } from '../../src/daemon/store.js';
import type { Task, Plan, PlanStep, FtmEvent, Experience, Playbook, Pattern } from '../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: 'task-1',
    sessionId: 'session-1',
    description: 'Test task',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePlanStep(index: number): PlanStep {
  return {
    index,
    description: `Step ${index}`,
    status: 'pending',
    requiresApproval: false,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    taskId: 'task-1',
    steps: [makePlanStep(0), makePlanStep(1)],
    status: 'pending',
    currentStep: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FtmEvent> = {}): FtmEvent {
  return {
    sessionId: 'session-1',
    type: 'task_submitted',
    timestamp: Date.now(),
    data: { foo: 'bar' },
    ...overrides,
  };
}

function makeExperience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: 'exp-1',
    taskType: 'code_review',
    outcome: 'success',
    lessons: ['Always check types', 'Write tests first'],
    tags: ['typescript', 'testing'],
    timestamp: Date.now(),
    ...overrides,
  };
}

function makePlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    id: 'pb-1',
    name: 'Review PR',
    trigger: 'review pull request',
    steps: ['fetch diff', 'analyze', 'comment'],
    lastUsed: 0,
    useCount: 0,
    ...overrides,
  };
}

function makePattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: 'pat-1',
    category: 'error_handling',
    pattern: { type: 'retry', maxAttempts: 3 },
    confidence: 0.85,
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('FtmStore', () => {
  let store: FtmStore;

  beforeEach(() => {
    // Use in-memory database for isolation
    store = new FtmStore(':memory:');
    // Seed a session that tasks/plans/events reference via FK
    store.createSession('session-1');
  });

  afterEach(() => {
    store.close();
  });

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  describe('initialization', () => {
    it('creates a store without throwing', () => {
      expect(() => new FtmStore(':memory:')).not.toThrow();
    });

    it('stores are independent (no shared state between instances)', () => {
      const store2 = new FtmStore(':memory:');
      store2.createSession('session-x');
      const task = makeTask({ sessionId: 'session-x' });
      store2.createTask(task);

      // Original store should not see this task
      expect(store.getTask('task-1')).toBeNull();
      store2.close();
    });
  });

  // -------------------------------------------------------------------------
  // Session CRUD
  // -------------------------------------------------------------------------

  describe('sessions', () => {
    it('creates and retrieves a session', () => {
      const session = store.getSession('session-1');
      expect(session).not.toBeNull();
      expect(session!.id).toBe('session-1');
      expect(session!.status).toBe('active');
      expect(typeof session!.startedAt).toBe('number');
      expect(typeof session!.lastUpdated).toBe('number');
    });

    it('returns null for a missing session', () => {
      expect(store.getSession('nonexistent')).toBeNull();
    });

    it('updates session fields', () => {
      store.updateSession('session-1', { status: 'completed' });
      const updated = store.getSession('session-1');
      expect(updated!.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // Task CRUD
  // -------------------------------------------------------------------------

  describe('tasks', () => {
    it('creates and retrieves a task', () => {
      store.createTask(makeTask());
      const task = store.getTask('task-1');
      expect(task).not.toBeNull();
      expect(task!.id).toBe('task-1');
      expect(task!.description).toBe('Test task');
      expect(task!.status).toBe('pending');
      expect(task!.sessionId).toBe('session-1');
    });

    it('returns null for a missing task', () => {
      expect(store.getTask('nonexistent')).toBeNull();
    });

    it('updates task status', () => {
      store.createTask(makeTask());
      store.updateTask('task-1', { status: 'in_progress', updatedAt: Date.now() });
      const updated = store.getTask('task-1');
      expect(updated!.status).toBe('in_progress');
    });

    it('updates task result and error', () => {
      store.createTask(makeTask());
      store.updateTask('task-1', {
        status: 'completed',
        result: 'all done',
        updatedAt: Date.now(),
      });
      const updated = store.getTask('task-1');
      expect(updated!.result).toBe('all done');
      expect(updated!.status).toBe('completed');
    });

    it('lists tasks by session', () => {
      store.createSession('session-2');
      store.createTask(makeTask({ id: 'task-1', sessionId: 'session-1' }));
      store.createTask(makeTask({ id: 'task-2', sessionId: 'session-1' }));
      store.createTask(makeTask({ id: 'task-3', sessionId: 'session-2' }));

      const s1Tasks = store.getTasksBySession('session-1');
      expect(s1Tasks).toHaveLength(2);
      expect(s1Tasks.every((t) => t.sessionId === 'session-1')).toBe(true);
    });

    it('getRecentTasks returns tasks ordered by createdAt DESC', () => {
      const now = Date.now();
      store.createTask(makeTask({ id: 'task-a', createdAt: now - 2000, updatedAt: now - 2000 }));
      store.createTask(makeTask({ id: 'task-b', createdAt: now - 1000, updatedAt: now - 1000 }));
      store.createTask(makeTask({ id: 'task-c', createdAt: now,        updatedAt: now }));

      const recent = store.getRecentTasks(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].id).toBe('task-c');
      expect(recent[1].id).toBe('task-b');
    });

    it('tasks have optional result and error as undefined when not set', () => {
      store.createTask(makeTask());
      const task = store.getTask('task-1');
      expect(task!.result).toBeUndefined();
      expect(task!.error).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Plan CRUD
  // -------------------------------------------------------------------------

  describe('plans', () => {
    beforeEach(() => {
      store.createTask(makeTask());
    });

    it('saves and retrieves a plan', () => {
      store.savePlan(makePlan());
      const plan = store.getPlan('plan-1');
      expect(plan).not.toBeNull();
      expect(plan!.id).toBe('plan-1');
      expect(plan!.taskId).toBe('task-1');
      expect(plan!.steps).toHaveLength(2);
      expect(plan!.currentStep).toBe(0);
      expect(plan!.status).toBe('pending');
    });

    it('returns null for a missing plan', () => {
      expect(store.getPlan('nonexistent')).toBeNull();
    });

    it('updates plan status and current step', () => {
      store.savePlan(makePlan());
      store.updatePlan('plan-1', { status: 'executing', currentStep: 1 });
      const updated = store.getPlan('plan-1');
      expect(updated!.status).toBe('executing');
      expect(updated!.currentStep).toBe(1);
    });

    it('updates plan steps (JSON roundtrip)', () => {
      store.savePlan(makePlan());
      const newSteps: PlanStep[] = [makePlanStep(0)];
      store.updatePlan('plan-1', { steps: newSteps });
      const updated = store.getPlan('plan-1');
      expect(updated!.steps).toHaveLength(1);
      expect(updated!.steps[0].index).toBe(0);
    });

    it('savePlan is idempotent (upsert behavior)', () => {
      store.savePlan(makePlan());
      store.savePlan(makePlan({ status: 'approved' }));
      const plan = store.getPlan('plan-1');
      expect(plan!.status).toBe('approved');
    });
  });

  // -------------------------------------------------------------------------
  // Event logging
  // -------------------------------------------------------------------------

  describe('events', () => {
    it('logs and retrieves events by session', () => {
      store.logEvent(makeEvent({ type: 'task_submitted', data: { id: '1' } }));
      store.logEvent(makeEvent({ type: 'step_started', data: { step: 0 } }));

      const events = store.getEvents('session-1');
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('task_submitted');
      expect(events[1].type).toBe('step_started');
    });

    it('filters events by since timestamp', async () => {
      store.logEvent(makeEvent({ timestamp: Date.now() - 2000 }));
      const cutoff = Date.now() - 1000;
      store.logEvent(makeEvent({ timestamp: Date.now(), type: 'step_completed' }));

      const events = store.getEvents('session-1', cutoff);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('step_completed');
    });

    it('returns empty array for unknown session', () => {
      expect(store.getEvents('no-such-session')).toHaveLength(0);
    });

    it('retrieves events by type with limit', () => {
      for (let i = 0; i < 5; i++) {
        store.logEvent(makeEvent({ type: 'step_started', data: { step: i } }));
      }
      store.logEvent(makeEvent({ type: 'task_completed', data: {} }));

      const stepEvents = store.getEventsByType('step_started', 3);
      expect(stepEvents).toHaveLength(3);
      stepEvents.forEach((e) => expect(e.type).toBe('step_started'));
    });

    it('preserves event data as JSON', () => {
      const data = { nested: { value: 42 }, arr: [1, 2, 3] };
      store.logEvent(makeEvent({ data }));
      const events = store.getEvents('session-1');
      expect(events[0].data).toEqual(data);
    });
  });

  // -------------------------------------------------------------------------
  // Memory / context
  // -------------------------------------------------------------------------

  describe('memory context', () => {
    it('sets and gets a context value', () => {
      store.setContext('foo', { bar: 123 });
      const value = store.getContext('foo');
      expect(value).toEqual({ bar: 123 });
    });

    it('returns null for missing key', () => {
      expect(store.getContext('missing')).toBeNull();
    });

    it('overwrites existing context value (upsert)', () => {
      store.setContext('key', 'first');
      store.setContext('key', 'second');
      expect(store.getContext('key')).toBe('second');
    });

    it('gets all context as a record', () => {
      store.setContext('a', 1);
      store.setContext('b', 'hello');
      store.setContext('c', [true, false]);

      const all = store.getAllContext();
      expect(all['a']).toBe(1);
      expect(all['b']).toBe('hello');
      expect(all['c']).toEqual([true, false]);
    });

    it('stores null as a context value', () => {
      store.setContext('nullable', null);
      expect(store.getContext('nullable')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Experiences
  // -------------------------------------------------------------------------

  describe('experiences', () => {
    it('writes and retrieves all experiences', () => {
      store.writeExperience(makeExperience());
      const experiences = store.getExperiences();
      expect(experiences).toHaveLength(1);
      expect(experiences[0].id).toBe('exp-1');
      expect(experiences[0].taskType).toBe('code_review');
      expect(experiences[0].outcome).toBe('success');
      expect(experiences[0].lessons).toEqual(['Always check types', 'Write tests first']);
      expect(experiences[0].tags).toEqual(['typescript', 'testing']);
    });

    it('filters by taskType', () => {
      store.writeExperience(makeExperience({ id: 'exp-1', taskType: 'code_review' }));
      store.writeExperience(makeExperience({ id: 'exp-2', taskType: 'deployment' }));

      const codeReviews = store.getExperiences({ taskType: 'code_review' });
      expect(codeReviews).toHaveLength(1);
      expect(codeReviews[0].taskType).toBe('code_review');
    });

    it('filters by tags (any match)', () => {
      store.writeExperience(makeExperience({ id: 'exp-1', tags: ['typescript', 'testing'] }));
      store.writeExperience(makeExperience({ id: 'exp-2', tags: ['python', 'ci'] }));

      const matched = store.getExperiences({ tags: ['typescript'] });
      expect(matched).toHaveLength(1);
      expect(matched[0].id).toBe('exp-1');
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        store.writeExperience(makeExperience({ id: `exp-${i}` }));
      }
      const limited = store.getExperiences({ limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it('matchExperiences combines taskType and tags', () => {
      store.writeExperience(makeExperience({
        id: 'exp-a',
        taskType: 'code_review',
        tags: ['typescript'],
      }));
      store.writeExperience(makeExperience({
        id: 'exp-b',
        taskType: 'code_review',
        tags: ['python'],
      }));
      store.writeExperience(makeExperience({
        id: 'exp-c',
        taskType: 'deployment',
        tags: ['typescript'],
      }));

      // Should match exp-a only (correct type AND typescript tag)
      const matches = store.matchExperiences('code_review', ['typescript']);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('exp-a');
    });
  });

  // -------------------------------------------------------------------------
  // Playbooks
  // -------------------------------------------------------------------------

  describe('playbooks', () => {
    it('saves and retrieves a playbook', () => {
      store.savePlaybook(makePlaybook());
      const pb = store.getPlaybook('pb-1');
      expect(pb).not.toBeNull();
      expect(pb!.name).toBe('Review PR');
      expect(pb!.trigger).toBe('review pull request');
      expect(pb!.steps).toEqual(['fetch diff', 'analyze', 'comment']);
      expect(pb!.useCount).toBe(0);
    });

    it('returns null for missing playbook', () => {
      expect(store.getPlaybook('nonexistent')).toBeNull();
    });

    it('savePlaybook is idempotent (upsert)', () => {
      store.savePlaybook(makePlaybook());
      store.savePlaybook(makePlaybook({ useCount: 5 }));
      const pb = store.getPlaybook('pb-1');
      expect(pb!.useCount).toBe(5);
    });

    it('matchPlaybook by exact trigger', () => {
      store.savePlaybook(makePlaybook());
      const matched = store.matchPlaybook('review pull request');
      expect(matched).not.toBeNull();
      expect(matched!.id).toBe('pb-1');
    });

    it('matchPlaybook returns null for unknown trigger', () => {
      store.savePlaybook(makePlaybook());
      expect(store.matchPlaybook('deploy to production')).toBeNull();
    });

    it('getAllPlaybooks returns all saved playbooks', () => {
      store.savePlaybook(makePlaybook({ id: 'pb-1' }));
      store.savePlaybook(makePlaybook({ id: 'pb-2', name: 'Deploy', trigger: 'deploy now' }));
      const all = store.getAllPlaybooks();
      expect(all).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Patterns
  // -------------------------------------------------------------------------

  describe('patterns', () => {
    it('saves and retrieves patterns by category', () => {
      store.savePattern(makePattern());
      const patterns = store.getPatterns('error_handling');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].id).toBe('pat-1');
      expect(patterns[0].confidence).toBe(0.85);
      expect(patterns[0].pattern).toEqual({ type: 'retry', maxAttempts: 3 });
    });

    it('returns empty array for unknown category', () => {
      expect(store.getPatterns('nonexistent')).toHaveLength(0);
    });

    it('savePattern is idempotent (upsert)', () => {
      store.savePattern(makePattern());
      store.savePattern(makePattern({ confidence: 0.95 }));
      const patterns = store.getPatterns('error_handling');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].confidence).toBe(0.95);
    });

    it('orders patterns by confidence DESC', () => {
      store.savePattern(makePattern({ id: 'pat-low', confidence: 0.3 }));
      store.savePattern(makePattern({ id: 'pat-high', confidence: 0.9 }));
      store.savePattern(makePattern({ id: 'pat-mid', confidence: 0.6 }));

      const patterns = store.getPatterns('error_handling');
      expect(patterns[0].confidence).toBeGreaterThanOrEqual(patterns[1].confidence);
      expect(patterns[1].confidence).toBeGreaterThanOrEqual(patterns[2].confidence);
    });
  });
});
