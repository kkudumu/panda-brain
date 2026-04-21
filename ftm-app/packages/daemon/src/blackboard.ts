import { FtmStore } from './store.js';
import type {
  Task,
  Experience,
  Playbook,
  BlackboardContext,
  UserProfile,
  Workspace,
  TaskLane,
  WorkspaceState,
  SummaryRecord,
  ModelSessionHandle,
  RetrievalHit,
  WorkspaceMessage,
} from './shared/types.js';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Internal context keys used in memory_context table
// ---------------------------------------------------------------------------
const KEY_CURRENT_TASK    = 'blackboard:current_task';
const KEY_DECISIONS       = 'blackboard:decisions';
const KEY_CONSTRAINTS     = 'blackboard:constraints';
const KEY_SESSION_META    = 'blackboard:session_metadata';
const KEY_USER_PROFILE    = 'blackboard:user_profile';
const KEY_ACTIVE_WORKSPACE = 'blackboard:active_workspace_id';
const KEY_ACTIVE_LANE      = 'blackboard:active_lane_id';

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
    const currentTask = this.getCurrentTask();
    const workspaceId =
      currentTask?.workspaceId ??
      ((this.store.getContext(KEY_ACTIVE_WORKSPACE) as string | null) ?? null);
    const laneId =
      currentTask?.laneId ??
      ((this.store.getContext(KEY_ACTIVE_LANE) as string | null) ?? null);

    const currentWorkspace = workspaceId ? this.store.getWorkspace(workspaceId) : null;
    const currentLane = laneId ? this.store.getTaskLane(laneId) : null;
    const workspaceState = workspaceId
      ? this.ensureWorkspaceState(workspaceId, currentTask?.id, laneId ?? undefined)
      : null;
    const laneSummary = laneId ? this.store.getLatestLaneSummary(laneId) : null;
    const workspaceSummary = workspaceId ? this.store.getLatestWorkspaceSummary(workspaceId) : null;
    const activeModelSessions = laneId ? this.store.getActiveModelSessionsByLane(laneId) : [];
    const retrievalContext = workspaceId ? this.store.getRetrievalHits(workspaceId, 15) : [];

    return {
      currentTask,
      currentWorkspace,
      currentLane,
      workspaceState,
      laneSummary,
      workspaceSummary,
      activeModelSessions,
      retrievalContext,
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
    if (task.workspaceId) {
      this.store.setContext(KEY_ACTIVE_WORKSPACE, task.workspaceId);
    }
    if (task.laneId) {
      this.store.setContext(KEY_ACTIVE_LANE, task.laneId);
    }
    if (task.workspaceId) {
      const current = this.ensureWorkspaceState(task.workspaceId, task.id, task.laneId);
      this.store.saveWorkspaceState({
        ...current,
        activeTaskId: task.id,
        activeLaneId: task.laneId ?? current.activeLaneId,
        updatedAt: Date.now(),
      });
    }
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
    const record = { decision, reason, timestamp: Date.now() };
    decisions.push(record);
    this.store.setContext(KEY_DECISIONS, decisions);

    const workspaceId = this.getActiveWorkspaceId();
    if (workspaceId) {
      const state = this.ensureWorkspaceState(workspaceId);
      state.decisions = [...state.decisions, record].slice(-50);
      state.updatedAt = Date.now();
      this.store.saveWorkspaceState(state);
    }
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
    this.syncWorkspaceConstraints(constraints);
  }

  addConstraint(constraint: string): void {
    const current = this.getConstraints();
    if (!current.includes(constraint)) {
      current.push(constraint);
      this.store.setContext(KEY_CONSTRAINTS, current);
      this.syncWorkspaceConstraints(current);
    }
  }

  removeConstraint(constraint: string): void {
    const filtered = this.getConstraints().filter((c) => c !== constraint);
    this.store.setContext(KEY_CONSTRAINTS, filtered);
    this.syncWorkspaceConstraints(filtered);
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

  // -------------------------------------------------------------------------
  // Workspace primitives
  // -------------------------------------------------------------------------

  ensureWorkspace(rootPath: string, name?: string): Workspace {
    const existing = this.store.getWorkspaceByRootPath(rootPath);
    const now = Date.now();
    const workspace: Workspace = existing ?? {
      id: randomUUID(),
      rootPath,
      name: name ?? this.deriveWorkspaceName(rootPath),
      createdAt: now,
      lastUpdated: now,
    };

    this.store.saveWorkspace({
      ...workspace,
      name: name ?? workspace.name,
      lastUpdated: now,
    });
    this.store.setContext(KEY_ACTIVE_WORKSPACE, workspace.id);
    return this.store.getWorkspaceByRootPath(rootPath) ?? workspace;
  }

  createTaskLane(workspaceId: string, title: string): TaskLane {
    const now = Date.now();
    const lane: TaskLane = {
      id: randomUUID(),
      workspaceId,
      title,
      status: 'active',
      createdAt: now,
      lastUpdated: now,
    };
    this.store.saveTaskLane(lane);
    this.store.setContext(KEY_ACTIVE_LANE, lane.id);
    return lane;
  }

  ensureWorkspaceState(workspaceId: string, activeTaskId?: string, activeLaneId?: string): WorkspaceState {
    const existing = this.store.getWorkspaceState(workspaceId);
    if (existing) return existing;

    const state: WorkspaceState = {
      workspaceId,
      activeTaskId,
      activeLaneId,
      decisions: [],
      constraints: this.getConstraints(),
      goals: [],
      openQuestions: [],
      handoffNotes: [],
      updatedAt: Date.now(),
    };
    this.store.saveWorkspaceState(state);
    return state;
  }

  recordWorkspaceMessage(message: Omit<WorkspaceMessage, 'id' | 'createdAt'> & { createdAt?: number }): void {
    this.store.appendWorkspaceMessage({
      ...message,
      id: randomUUID(),
      createdAt: message.createdAt ?? Date.now(),
    });
  }

  saveSummary(summary: Omit<SummaryRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: number; updatedAt?: number }): SummaryRecord {
    const record: SummaryRecord = {
      ...summary,
      id: summary.id ?? randomUUID(),
      createdAt: summary.createdAt ?? Date.now(),
      updatedAt: summary.updatedAt ?? Date.now(),
    };
    this.store.saveSummary(record);
    return record;
  }

  saveModelSession(handle: Omit<ModelSessionHandle, 'id' | 'lastUsed'> & { id?: string; lastUsed?: number }): ModelSessionHandle {
    const record: ModelSessionHandle = {
      ...handle,
      id: handle.id ?? randomUUID(),
      lastUsed: handle.lastUsed ?? Date.now(),
    };
    this.store.saveModelSession(record);
    return record;
  }

  getActiveModelSession(laneId: string, modelName: string): ModelSessionHandle | null {
    return (
      this.store
        .getActiveModelSessionsByLane(laneId)
        .find((handle) => handle.modelName === modelName && !handle.archived) ?? null
    );
  }

  saveRetrievalHit(hit: Omit<RetrievalHit, 'createdAt'> & { createdAt?: number }): void {
    this.store.saveRetrievalHit({
      ...hit,
      createdAt: hit.createdAt ?? Date.now(),
    });
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

  private getActiveWorkspaceId(): string | null {
    const currentTask = this.getCurrentTask();
    return currentTask?.workspaceId ?? (this.store.getContext(KEY_ACTIVE_WORKSPACE) as string | null) ?? null;
  }

  private syncWorkspaceConstraints(constraints: string[]): void {
    const workspaceId = this.getActiveWorkspaceId();
    if (!workspaceId) return;
    const state = this.ensureWorkspaceState(workspaceId);
    this.store.saveWorkspaceState({
      ...state,
      constraints,
      updatedAt: Date.now(),
    });
  }

  private deriveWorkspaceName(rootPath: string): string {
    const parts = rootPath.split('/').filter(Boolean);
    return parts.at(-1) ?? rootPath;
  }
}
