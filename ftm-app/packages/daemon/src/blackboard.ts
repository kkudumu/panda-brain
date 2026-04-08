import { FtmStore } from './store.js';
import type { Task, Experience, Playbook, BlackboardContext, UserProfile } from '../shared/types.js';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Internal context keys used in memory_context table
// ---------------------------------------------------------------------------
const KEY_CURRENT_TASK    = 'blackboard:current_task';
const KEY_DECISIONS       = 'blackboard:decisions';
const KEY_CONSTRAINTS     = 'blackboard:constraints';
const KEY_SESSION_META    = 'blackboard:session_metadata';
const KEY_USER_PROFILE    = 'blackboard:user_profile';

type Decision = { decision: string; reason: string; timestamp: number };
type SessionMetadata = BlackboardContext['sessionMetadata'];
type BlackboardUserProfile = BlackboardContext['userProfile'];

function inferSystemPreferredName(): string | null {
  const raw = process.env.FTM_USER_NAME ?? process.env.USER ?? process.env.USERNAME;
  if (!raw) return null;

  const token = raw
    .split(/[.@_\s-]+/)
    .map((part) => part.trim())
    .find(Boolean);

  if (!token) return null;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

// ---------------------------------------------------------------------------
// Blackboard
// ---------------------------------------------------------------------------

/**
 * Higher-level API on top of FtmStore that provides a unified blackboard
 * interface for the OODA loop and task orchestration layers. All state is
 * persisted through the store so it survives daemon restarts.
 */
export class Blackboard {
  constructor(private store: FtmStore) {}

  // -------------------------------------------------------------------------
  // Full context assembly
  // -------------------------------------------------------------------------

  /**
   * Assemble a complete BlackboardContext snapshot from the various
   * persisted sub-keys and recent store queries.
   */
  getContext(): BlackboardContext {
    return {
      currentTask: this.getCurrentTask(),
      recentDecisions: this.getRecentDecisions(),
      activeConstraints: this.getConstraints(),
      sessionMetadata: this.getSessionMetadata(),
      userProfile: this.getUserProfile(),
    };
  }

  // -------------------------------------------------------------------------
  // Current task
  // -------------------------------------------------------------------------

  setCurrentTask(task: Task): void {
    this.store.setContext(KEY_CURRENT_TASK, task);
  }

  clearCurrentTask(): void {
    this.store.setContext(KEY_CURRENT_TASK, null);
  }

  private getCurrentTask(): Task | null {
    return (this.store.getContext(KEY_CURRENT_TASK) as Task | null) ?? null;
  }

  // -------------------------------------------------------------------------
  // Decision tracking
  // -------------------------------------------------------------------------

  addDecision(decision: string, reason: string): void {
    const decisions = this.loadDecisions();
    decisions.push({ decision, reason, timestamp: Date.now() });
    this.store.setContext(KEY_DECISIONS, decisions);
  }

  getRecentDecisions(limit = 10): Decision[] {
    const decisions = this.loadDecisions();
    return decisions.slice(-limit);
  }

  private loadDecisions(): Decision[] {
    return (this.store.getContext(KEY_DECISIONS) as Decision[] | null) ?? [];
  }

  // -------------------------------------------------------------------------
  // Constraint management
  // -------------------------------------------------------------------------

  setConstraints(constraints: string[]): void {
    this.store.setContext(KEY_CONSTRAINTS, constraints);
  }

  addConstraint(constraint: string): void {
    const current = this.getConstraints();
    if (!current.includes(constraint)) {
      current.push(constraint);
      this.store.setContext(KEY_CONSTRAINTS, current);
    }
  }

  removeConstraint(constraint: string): void {
    const filtered = this.getConstraints().filter((c) => c !== constraint);
    this.store.setContext(KEY_CONSTRAINTS, filtered);
  }

  getConstraints(): string[] {
    return (this.store.getContext(KEY_CONSTRAINTS) as string[] | null) ?? [];
  }

  // -------------------------------------------------------------------------
  // Experience matching (delegates to store with convenience wrapper)
  // -------------------------------------------------------------------------

  writeExperience(exp: Omit<Experience, 'id' | 'timestamp'>): void {
    const full: Experience = {
      ...exp,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    this.store.writeExperience(full);
  }

  findRelevantExperiences(taskType: string, tags: string[]): Experience[] {
    return this.store.matchExperiences(taskType, tags);
  }

  // -------------------------------------------------------------------------
  // Playbook operations
  // -------------------------------------------------------------------------

  checkPlaybook(trigger: string): Playbook | null {
    return this.store.matchPlaybook(trigger);
  }

  recordPlaybookUse(id: string): void {
    const playbook = this.store.getPlaybook(id);
    if (!playbook) return;

    this.store.savePlaybook({
      ...playbook,
      lastUsed: Date.now(),
      useCount: playbook.useCount + 1,
    });
  }

  // -------------------------------------------------------------------------
  // Session metadata
  // -------------------------------------------------------------------------

  updateSessionMetadata(updates: Partial<SessionMetadata>): void {
    const current = this.getSessionMetadata();
    this.store.setContext(KEY_SESSION_META, { ...current, ...updates });
  }

  private getSessionMetadata(): SessionMetadata {
    const stored = this.store.getContext(KEY_SESSION_META) as SessionMetadata | null;
    if (stored) return stored;

    // Default — first time accessed
    const defaults: SessionMetadata = {
      startedAt: Date.now(),
      lastUpdated: Date.now(),
      skillsInvoked: [],
    };
    this.store.setContext(KEY_SESSION_META, defaults);
    return defaults;
  }

  // -------------------------------------------------------------------------
  // User profile
  // -------------------------------------------------------------------------

  updateUserProfile(mutator: (profile: UserProfile) => void): UserProfile {
    const profile = this.getUserProfile();
    const next = JSON.parse(JSON.stringify(profile)) as UserProfile;
    mutator(next);
    next.lastUpdated = Date.now();
    this.store.setContext(KEY_USER_PROFILE, next);
    return next;
  }

  getUserProfileSnapshot(): UserProfile {
    return this.getUserProfile();
  }

  private getUserProfile(): BlackboardUserProfile {
    const stored = this.store.getContext(KEY_USER_PROFILE) as BlackboardUserProfile | null;
    if (stored) return stored;

    const defaults: BlackboardUserProfile = {
      lastUpdated: Date.now(),
      preferredName: inferSystemPreferredName(),
      responseStyle: 'collaborative',
      preferredOutputFormats: [],
      activeProjects: [],
      approvalPreference: 'mixed',
      approvalHistory: {
        requestedCount: 0,
        approvedCount: 0,
        modifiedCount: 0,
        autoApprovedCount: 0,
      },
      commonTaskTypes: [],
      workflowPatterns: [],
      topicInterests: [],
      modelPreferences: [],
    };
    this.store.setContext(KEY_USER_PROFILE, defaults);
    return defaults;
  }
}
