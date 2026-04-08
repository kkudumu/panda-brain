import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FtmStore } from '../../packages/daemon/src/store.js';
import { Blackboard } from '../../packages/daemon/src/blackboard.js';
import type { Task, Playbook } from '../../packages/daemon/src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: 'task-bb-1',
    sessionId: 'session-bb-1',
    description: 'Blackboard test task',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    id: 'pb-bb-1',
    name: 'Deploy pipeline',
    trigger: 'deploy to staging',
    steps: ['build', 'test', 'push'],
    lastUsed: 0,
    useCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Blackboard', () => {
  let store: FtmStore;
  let bb: Blackboard;

  beforeEach(() => {
    store = new FtmStore(':memory:');
    bb = new Blackboard(store);
  });

  afterEach(() => {
    store.close();
  });

  // -------------------------------------------------------------------------
  // getContext
  // -------------------------------------------------------------------------

  describe('getContext', () => {
    it('returns a well-formed BlackboardContext with defaults', () => {
      const ctx = bb.getContext();

      expect(ctx.currentTask).toBeNull();
      expect(Array.isArray(ctx.recentDecisions)).toBe(true);
      expect(Array.isArray(ctx.activeConstraints)).toBe(true);
      expect(ctx.recentDecisions).toHaveLength(0);
      expect(ctx.activeConstraints).toHaveLength(0);
      expect(typeof ctx.sessionMetadata.startedAt).toBe('number');
      expect(typeof ctx.sessionMetadata.lastUpdated).toBe('number');
      expect(Array.isArray(ctx.sessionMetadata.skillsInvoked)).toBe(true);
      expect(Array.isArray(ctx.userProfile.preferredOutputFormats)).toBe(true);
      expect(Array.isArray(ctx.userProfile.activeProjects)).toBe(true);
      expect(ctx.userProfile.approvalPreference).toBe('mixed');
      expect(ctx.userProfile.responseStyle).toBe('collaborative');
      expect(ctx.userProfile.commonTaskTypes).toEqual([]);
      expect(ctx.userProfile.workflowPatterns).toEqual([]);
    });

    it('reflects current task after setCurrentTask', () => {
      const task = makeTask();
      bb.setCurrentTask(task);
      const ctx = bb.getContext();
      expect(ctx.currentTask).not.toBeNull();
      expect(ctx.currentTask!.id).toBe('task-bb-1');
    });

    it('reflects null after clearCurrentTask', () => {
      bb.setCurrentTask(makeTask());
      bb.clearCurrentTask();
      const ctx = bb.getContext();
      expect(ctx.currentTask).toBeNull();
    });

    it('reflects decisions in context', () => {
      bb.addDecision('use TypeScript', 'type safety');
      bb.addDecision('use SQLite', 'embedded simplicity');
      const ctx = bb.getContext();
      expect(ctx.recentDecisions).toHaveLength(2);
    });

    it('reflects constraints in context', () => {
      bb.setConstraints(['no external calls', 'max 3 retries']);
      const ctx = bb.getContext();
      expect(ctx.activeConstraints).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Decision tracking
  // -------------------------------------------------------------------------

  describe('decision tracking', () => {
    it('adds and retrieves decisions', () => {
      bb.addDecision('use Redis', 'low-latency caching');
      const decisions = bb.getRecentDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision).toBe('use Redis');
      expect(decisions[0].reason).toBe('low-latency caching');
      expect(typeof decisions[0].timestamp).toBe('number');
    });

    it('maintains insertion order', () => {
      bb.addDecision('first', 'r1');
      bb.addDecision('second', 'r2');
      bb.addDecision('third', 'r3');
      const decisions = bb.getRecentDecisions();
      expect(decisions[0].decision).toBe('first');
      expect(decisions[2].decision).toBe('third');
    });

    it('respects limit — returns most recent N', () => {
      for (let i = 0; i < 15; i++) {
        bb.addDecision(`decision-${i}`, `reason-${i}`);
      }
      const recent = bb.getRecentDecisions(5);
      expect(recent).toHaveLength(5);
      expect(recent[recent.length - 1].decision).toBe('decision-14');
    });

    it('default limit is 10', () => {
      for (let i = 0; i < 20; i++) {
        bb.addDecision(`d-${i}`, 'r');
      }
      expect(bb.getRecentDecisions()).toHaveLength(10);
    });

    it('persists decisions across Blackboard instances', () => {
      bb.addDecision('persistent decision', 'test persistence');

      const bb2 = new Blackboard(store);
      const decisions = bb2.getRecentDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0].decision).toBe('persistent decision');
    });
  });

  // -------------------------------------------------------------------------
  // Constraint management
  // -------------------------------------------------------------------------

  describe('constraint management', () => {
    it('setConstraints replaces all constraints', () => {
      bb.addConstraint('old constraint');
      bb.setConstraints(['new-a', 'new-b']);
      expect(bb.getConstraints()).toEqual(['new-a', 'new-b']);
    });

    it('addConstraint appends a new constraint', () => {
      bb.addConstraint('constraint-1');
      bb.addConstraint('constraint-2');
      const constraints = bb.getConstraints();
      expect(constraints).toContain('constraint-1');
      expect(constraints).toContain('constraint-2');
    });

    it('addConstraint is idempotent (no duplicates)', () => {
      bb.addConstraint('no duplicates');
      bb.addConstraint('no duplicates');
      expect(bb.getConstraints()).toHaveLength(1);
    });

    it('removeConstraint removes a specific constraint', () => {
      bb.setConstraints(['keep-1', 'remove-me', 'keep-2']);
      bb.removeConstraint('remove-me');
      const constraints = bb.getConstraints();
      expect(constraints).toContain('keep-1');
      expect(constraints).toContain('keep-2');
      expect(constraints).not.toContain('remove-me');
    });

    it('removeConstraint is a no-op for nonexistent constraint', () => {
      bb.setConstraints(['only-one']);
      bb.removeConstraint('nonexistent');
      expect(bb.getConstraints()).toHaveLength(1);
    });

    it('getConstraints returns empty array when none set', () => {
      expect(bb.getConstraints()).toEqual([]);
    });

    it('persists constraints across Blackboard instances', () => {
      bb.addConstraint('persistent');
      const bb2 = new Blackboard(store);
      expect(bb2.getConstraints()).toContain('persistent');
    });
  });

  // -------------------------------------------------------------------------
  // Experience matching
  // -------------------------------------------------------------------------

  describe('experience matching', () => {
    it('writes and finds experiences', () => {
      bb.writeExperience({
        taskType: 'code_review',
        outcome: 'success',
        lessons: ['check for null', 'add tests'],
        tags: ['typescript', 'safety'],
      });

      const found = bb.findRelevantExperiences('code_review', ['typescript']);
      expect(found).toHaveLength(1);
      expect(found[0].taskType).toBe('code_review');
      expect(found[0].outcome).toBe('success');
    });

    it('auto-generates id and timestamp', () => {
      bb.writeExperience({
        taskType: 'planning',
        outcome: 'partial',
        lessons: [],
        tags: [],
      });
      const found = bb.findRelevantExperiences('planning', []);
      expect(found[0].id).toBeTruthy();
      expect(typeof found[0].timestamp).toBe('number');
    });

    it('returns empty when no match', () => {
      bb.writeExperience({
        taskType: 'deployment',
        outcome: 'failure',
        lessons: [],
        tags: ['ci'],
      });
      const found = bb.findRelevantExperiences('code_review', ['typescript']);
      expect(found).toHaveLength(0);
    });

    it('multiple experiences can be written and matched', () => {
      bb.writeExperience({ taskType: 'review', outcome: 'success', lessons: [], tags: ['ts'] });
      bb.writeExperience({ taskType: 'review', outcome: 'failure', lessons: [], tags: ['ts'] });
      bb.writeExperience({ taskType: 'deploy', outcome: 'success', lessons: [], tags: ['ts'] });

      const found = bb.findRelevantExperiences('review', ['ts']);
      expect(found).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Playbook operations
  // -------------------------------------------------------------------------

  describe('playbook operations', () => {
    beforeEach(() => {
      store.savePlaybook(makePlaybook());
    });

    it('checkPlaybook returns matching playbook', () => {
      const pb = bb.checkPlaybook('deploy to staging');
      expect(pb).not.toBeNull();
      expect(pb!.id).toBe('pb-bb-1');
    });

    it('checkPlaybook returns null for unknown trigger', () => {
      expect(bb.checkPlaybook('unknown trigger xyz')).toBeNull();
    });

    it('recordPlaybookUse increments use count and updates lastUsed', () => {
      const before = Date.now();
      bb.recordPlaybookUse('pb-bb-1');
      const pb = store.getPlaybook('pb-bb-1');
      expect(pb!.useCount).toBe(1);
      expect(pb!.lastUsed).toBeGreaterThanOrEqual(before);
    });

    it('recordPlaybookUse is cumulative', () => {
      bb.recordPlaybookUse('pb-bb-1');
      bb.recordPlaybookUse('pb-bb-1');
      bb.recordPlaybookUse('pb-bb-1');
      const pb = store.getPlaybook('pb-bb-1');
      expect(pb!.useCount).toBe(3);
    });

    it('recordPlaybookUse is a no-op for unknown id', () => {
      expect(() => bb.recordPlaybookUse('nonexistent')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Session metadata
  // -------------------------------------------------------------------------

  describe('session metadata', () => {
    it('initializes with sensible defaults', () => {
      const ctx = bb.getContext();
      expect(ctx.sessionMetadata.startedAt).toBeGreaterThan(0);
      expect(Array.isArray(ctx.sessionMetadata.skillsInvoked)).toBe(true);
    });

    it('updateSessionMetadata merges with existing values', () => {
      bb.updateSessionMetadata({ skillsInvoked: ['ftm-mind'] });
      bb.updateSessionMetadata({ lastUpdated: Date.now() });

      const ctx = bb.getContext();
      expect(ctx.sessionMetadata.skillsInvoked).toContain('ftm-mind');
      expect(ctx.sessionMetadata.lastUpdated).toBeGreaterThan(0);
    });

    it('persists session metadata across instances', () => {
      bb.updateSessionMetadata({ skillsInvoked: ['ftm-executor', 'ftm-map'] });

      const bb2 = new Blackboard(store);
      const ctx = bb2.getContext();
      expect(ctx.sessionMetadata.skillsInvoked).toContain('ftm-executor');
    });
  });

  // -------------------------------------------------------------------------
  // User profile
  // -------------------------------------------------------------------------

  describe('user profile', () => {
    it('updates learned profile fields', () => {
      bb.updateUserProfile((profile) => {
        profile.preferredName = 'Avery';
        profile.responseStyle = 'direct';
        profile.commonTaskTypes.push({
          label: 'hello_machine',
          count: 2,
          lastSeen: Date.now(),
        });
      });

      const ctx = bb.getContext();
      expect(ctx.userProfile.preferredName).toBe('Avery');
      expect(ctx.userProfile.responseStyle).toBe('direct');
      expect(ctx.userProfile.commonTaskTypes[0].label).toBe('hello_machine');
    });

    it('persists user profile across instances', () => {
      bb.updateUserProfile((profile) => {
        profile.topicInterests.push({
          label: 'testing',
          count: 1,
          lastSeen: Date.now(),
        });
      });

      const bb2 = new Blackboard(store);
      const ctx = bb2.getContext();
      expect(ctx.userProfile.topicInterests[0].label).toBe('testing');
    });
  });
});
