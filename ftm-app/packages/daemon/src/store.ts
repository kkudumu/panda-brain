import Database from 'better-sqlite3';
import type {
  Session,
  Workspace,
  TaskLane,
  WorkspaceMessage,
  WorkspaceArtifact,
  WorkspaceState,
  SummaryRecord,
  ModelSessionHandle,
  RetrievalHit,
  Task,
  Plan,
  FtmEvent,
  Experience,
  Playbook,
  Pattern,
} from './shared/types.js';

// ---------------------------------------------------------------------------
// Raw DB row shapes (all values come back as primitives from SQLite)
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  started_at: number;
  last_updated: number;
  status: string;
}

interface TaskRow {
  id: string;
  session_id: string;
  description: string;
  working_dir: string | null;
  workspace_id: string | null;
  lane_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  result: string | null;
  error: string | null;
}

interface PlanRow {
  id: string;
  task_id: string;
  lane_id: string | null;
  steps: string;
  status: string;
  current_step: number;
  created_at: number;
}

interface WorkspaceRow {
  id: string;
  root_path: string;
  name: string;
  created_at: number;
  last_updated: number;
}

interface TaskLaneRow {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  created_at: number;
  last_updated: number;
  active_summary_id: string | null;
}

interface WorkspaceMessageRow {
  id: string;
  workspace_id: string;
  lane_id: string | null;
  session_id: string;
  role: string;
  kind: string;
  content: string;
  metadata: string;
  created_at: number;
  summary_id: string | null;
}

interface WorkspaceArtifactRow {
  id: string;
  workspace_id: string;
  lane_id: string | null;
  message_id: string | null;
  type: string;
  title: string | null;
  path: string | null;
  content: string | null;
  metadata: string;
  created_at: number;
}

interface WorkspaceStateRow {
  workspace_id: string;
  active_task_id: string | null;
  active_lane_id: string | null;
  decisions: string;
  constraints: string;
  goals: string;
  open_questions: string;
  handoff_notes: string;
  updated_at: number;
}

interface SummaryRow {
  id: string;
  workspace_id: string;
  lane_id: string | null;
  model_session_id: string | null;
  kind: string;
  content: string;
  source_message_count: number;
  created_at: number;
  updated_at: number;
}

interface ModelSessionRow {
  id: string;
  workspace_id: string;
  lane_id: string | null;
  model_name: string;
  session_id: string;
  last_used: number;
  archived: number;
}

interface RetrievalHitRow {
  id: number;
  source_type: string;
  source_id: string;
  workspace_id: string;
  lane_id: string | null;
  text: string;
  tags: string;
  file_paths: string;
  issue_keys: string;
  importance: number;
  created_at: number;
}

interface EventRow {
  id: number;
  session_id: string;
  type: string;
  timestamp: number;
  data: string;
}

interface ContextRow {
  key: string;
  value: string;
  updated_at: number;
}

interface ExperienceRow {
  id: string;
  task_type: string;
  outcome: string;
  lessons: string;
  tags: string;
  timestamp: number;
}

interface PlaybookRow {
  id: string;
  name: string;
  trigger: string;
  steps: string;
  last_used: number;
  use_count: number;
}

interface PatternRow {
  id: string;
  category: string;
  pattern: string;
  confidence: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// FtmStore
// ---------------------------------------------------------------------------

export class FtmStore {
  private db: Database.Database;

  // Prepared statements – initialised once for performance
  private stmts!: ReturnType<typeof this.prepareStatements>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
    this.stmts = this.prepareStatements();
  }

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id           TEXT    PRIMARY KEY,
        started_at   INTEGER NOT NULL,
        last_updated INTEGER NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id          TEXT    PRIMARY KEY,
        session_id  TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        description TEXT    NOT NULL,
        working_dir TEXT,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        lane_id      TEXT REFERENCES task_lanes(id) ON DELETE SET NULL,
        status      TEXT    NOT NULL DEFAULT 'pending',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        result      TEXT,
        error       TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

      CREATE TABLE IF NOT EXISTS plans (
        id           TEXT    PRIMARY KEY,
        task_id      TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        lane_id      TEXT REFERENCES task_lanes(id) ON DELETE SET NULL,
        steps        TEXT    NOT NULL DEFAULT '[]',
        status       TEXT    NOT NULL DEFAULT 'pending',
        current_step INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plans_task_id ON plans(task_id);

      CREATE TABLE IF NOT EXISTS workspaces (
        id           TEXT    PRIMARY KEY,
        root_path    TEXT    NOT NULL UNIQUE,
        name         TEXT    NOT NULL,
        created_at   INTEGER NOT NULL,
        last_updated INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_lanes (
        id                TEXT    PRIMARY KEY,
        workspace_id      TEXT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title             TEXT    NOT NULL,
        status            TEXT    NOT NULL DEFAULT 'active',
        created_at        INTEGER NOT NULL,
        last_updated      INTEGER NOT NULL,
        active_summary_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_task_lanes_workspace_id ON task_lanes(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_task_lanes_status ON task_lanes(status);

      CREATE TABLE IF NOT EXISTS workspace_messages (
        id           TEXT    PRIMARY KEY,
        workspace_id TEXT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        lane_id      TEXT REFERENCES task_lanes(id) ON DELETE CASCADE,
        session_id   TEXT    NOT NULL,
        role         TEXT    NOT NULL,
        kind         TEXT    NOT NULL,
        content      TEXT    NOT NULL,
        metadata     TEXT    NOT NULL DEFAULT '{}',
        created_at   INTEGER NOT NULL,
        summary_id   TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_messages_workspace_id ON workspace_messages(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_messages_lane_id ON workspace_messages(lane_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_messages_created_at ON workspace_messages(created_at DESC);

      CREATE TABLE IF NOT EXISTS workspace_artifacts (
        id           TEXT    PRIMARY KEY,
        workspace_id TEXT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        lane_id      TEXT REFERENCES task_lanes(id) ON DELETE CASCADE,
        message_id   TEXT,
        type         TEXT    NOT NULL,
        title        TEXT,
        path         TEXT,
        content      TEXT,
        metadata     TEXT    NOT NULL DEFAULT '{}',
        created_at   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_workspace_id ON workspace_artifacts(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_lane_id ON workspace_artifacts(lane_id);

      CREATE TABLE IF NOT EXISTS workspace_state (
        workspace_id   TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        active_task_id TEXT,
        active_lane_id TEXT,
        decisions      TEXT NOT NULL DEFAULT '[]',
        constraints    TEXT NOT NULL DEFAULT '[]',
        goals          TEXT NOT NULL DEFAULT '[]',
        open_questions TEXT NOT NULL DEFAULT '[]',
        handoff_notes  TEXT NOT NULL DEFAULT '[]',
        updated_at     INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id                   TEXT    PRIMARY KEY,
        workspace_id         TEXT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        lane_id              TEXT REFERENCES task_lanes(id) ON DELETE CASCADE,
        model_session_id     TEXT,
        kind                 TEXT    NOT NULL,
        content              TEXT    NOT NULL,
        source_message_count INTEGER NOT NULL DEFAULT 0,
        created_at           INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_summaries_workspace_id ON summaries(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_lane_id ON summaries(lane_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_kind ON summaries(kind);

      CREATE TABLE IF NOT EXISTS model_sessions (
        id           TEXT    PRIMARY KEY,
        workspace_id TEXT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        lane_id      TEXT REFERENCES task_lanes(id) ON DELETE CASCADE,
        model_name   TEXT    NOT NULL,
        session_id   TEXT    NOT NULL,
        last_used    INTEGER NOT NULL,
        archived     INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_model_sessions_workspace_id ON model_sessions(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_model_sessions_lane_id ON model_sessions(lane_id);
      CREATE INDEX IF NOT EXISTS idx_model_sessions_model_name ON model_sessions(model_name);

      CREATE TABLE IF NOT EXISTS retrieval_index (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type  TEXT    NOT NULL,
        source_id    TEXT    NOT NULL,
        workspace_id TEXT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        lane_id      TEXT REFERENCES task_lanes(id) ON DELETE CASCADE,
        text         TEXT    NOT NULL,
        tags         TEXT    NOT NULL DEFAULT '[]',
        file_paths   TEXT    NOT NULL DEFAULT '[]',
        issue_keys   TEXT    NOT NULL DEFAULT '[]',
        importance   REAL    NOT NULL DEFAULT 0.0,
        created_at   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_retrieval_index_workspace_id ON retrieval_index(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_retrieval_index_lane_id ON retrieval_index(lane_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS workspace_messages_fts USING fts5(
        content,
        content='workspace_messages',
        content_rowid='rowid'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS workspace_artifacts_fts USING fts5(
        content,
        content='workspace_artifacts',
        content_rowid='rowid'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
        content,
        content='summaries',
        content_rowid='rowid'
      );

      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT    NOT NULL,
        type       TEXT    NOT NULL,
        timestamp  INTEGER NOT NULL,
        data       TEXT    NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp  ON events(timestamp);

      CREATE TABLE IF NOT EXISTS memory_context (
        key        TEXT    PRIMARY KEY,
        value      TEXT    NOT NULL DEFAULT 'null',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS experiences (
        id        TEXT    PRIMARY KEY,
        task_type TEXT    NOT NULL,
        outcome   TEXT    NOT NULL,
        lessons   TEXT    NOT NULL DEFAULT '[]',
        tags      TEXT    NOT NULL DEFAULT '[]',
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_experiences_task_type ON experiences(task_type);
      CREATE INDEX IF NOT EXISTS idx_experiences_timestamp ON experiences(timestamp DESC);

      CREATE TABLE IF NOT EXISTS playbooks (
        id        TEXT    PRIMARY KEY,
        name      TEXT    NOT NULL,
        trigger   TEXT    NOT NULL,
        steps     TEXT    NOT NULL DEFAULT '[]',
        last_used INTEGER NOT NULL DEFAULT 0,
        use_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS patterns (
        id         TEXT    PRIMARY KEY,
        category   TEXT    NOT NULL,
        pattern    TEXT    NOT NULL DEFAULT '{}',
        confidence REAL    NOT NULL DEFAULT 0.0,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns(category);
    `);

    const taskColumns = this.db
      .prepare("PRAGMA table_info(tasks)")
      .all() as Array<{ name: string }>;
    if (!taskColumns.some((column) => column.name === 'working_dir')) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN working_dir TEXT');
    }
    if (!taskColumns.some((column) => column.name === 'workspace_id')) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN workspace_id TEXT');
    }
    if (!taskColumns.some((column) => column.name === 'lane_id')) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN lane_id TEXT');
    }

    const planColumns = this.db
      .prepare("PRAGMA table_info(plans)")
      .all() as Array<{ name: string }>;
    if (!planColumns.some((column) => column.name === 'lane_id')) {
      this.db.exec('ALTER TABLE plans ADD COLUMN lane_id TEXT');
    }
  }

  // -------------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------------

  private prepareStatements() {
    return {
      // Sessions
      insertSession: this.db.prepare<[string, number, number, string]>(
        'INSERT INTO sessions (id, started_at, last_updated, status) VALUES (?, ?, ?, ?)'
      ),
      selectSession: this.db.prepare<[string], SessionRow>(
        'SELECT * FROM sessions WHERE id = ?'
      ),

      // Workspaces
      upsertWorkspace: this.db.prepare<[string, string, string, number, number]>(
        'INSERT INTO workspaces (id, root_path, name, created_at, last_updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(root_path) DO UPDATE SET name = excluded.name, last_updated = excluded.last_updated'
      ),
      selectWorkspace: this.db.prepare<[string], WorkspaceRow>(
        'SELECT * FROM workspaces WHERE id = ?'
      ),
      selectWorkspaceByRootPath: this.db.prepare<[string], WorkspaceRow>(
        'SELECT * FROM workspaces WHERE root_path = ?'
      ),
      selectRecentWorkspaces: this.db.prepare<[number], WorkspaceRow>(
        'SELECT * FROM workspaces ORDER BY last_updated DESC LIMIT ?'
      ),

      // Task lanes
      upsertTaskLane: this.db.prepare<[string, string, string, string, number, number, string | null]>(
        'INSERT INTO task_lanes (id, workspace_id, title, status, created_at, last_updated, active_summary_id) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, status = excluded.status, last_updated = excluded.last_updated, active_summary_id = excluded.active_summary_id'
      ),
      selectTaskLane: this.db.prepare<[string], TaskLaneRow>(
        'SELECT * FROM task_lanes WHERE id = ?'
      ),
      selectTaskLanesByWorkspace: this.db.prepare<[string, number], TaskLaneRow>(
        'SELECT * FROM task_lanes WHERE workspace_id = ? ORDER BY last_updated DESC LIMIT ?'
      ),

      // Tasks
      insertTask: this.db.prepare<[string, string, string, string | null, string | null, string | null, string, number, number, string | null, string | null]>(
        'INSERT INTO tasks (id, session_id, description, working_dir, workspace_id, lane_id, status, created_at, updated_at, result, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      selectTask: this.db.prepare<[string], TaskRow>(
        'SELECT * FROM tasks WHERE id = ?'
      ),
      selectTasksBySession: this.db.prepare<[string], TaskRow>(
        'SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC'
      ),
      selectRecentTasks: this.db.prepare<[number], TaskRow>(
        'SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?'
      ),

      // Plans
      insertPlan: this.db.prepare<[string, string, string | null, string, string, number, number]>(
        'INSERT INTO plans (id, task_id, lane_id, steps, status, current_step, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ),
      selectPlan: this.db.prepare<[string], PlanRow>(
        'SELECT * FROM plans WHERE id = ?'
      ),

      // Events
      insertEvent: this.db.prepare<[string, string, number, string]>(
        'INSERT INTO events (session_id, type, timestamp, data) VALUES (?, ?, ?, ?)'
      ),
      selectEventsBySession: this.db.prepare<[string, number], EventRow>(
        'SELECT * FROM events WHERE session_id = ? AND timestamp >= ? ORDER BY timestamp ASC'
      ),
      selectEventsByType: this.db.prepare<[string, number], EventRow>(
        'SELECT * FROM events WHERE type = ? ORDER BY timestamp DESC LIMIT ?'
      ),

      // Memory / context
      upsertContext: this.db.prepare<[string, string, number]>(
        'INSERT INTO memory_context (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ),
      selectContext: this.db.prepare<[string], ContextRow>(
        'SELECT * FROM memory_context WHERE key = ?'
      ),
      selectAllContext: this.db.prepare<[], ContextRow>(
        'SELECT * FROM memory_context'
      ),

      // Workspace messages
      insertWorkspaceMessage: this.db.prepare<[string, string, string | null, string, string, string, string, string, number, string | null]>(
        'INSERT INTO workspace_messages (id, workspace_id, lane_id, session_id, role, kind, content, metadata, created_at, summary_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      selectWorkspaceMessagesByLane: this.db.prepare<[string, number], WorkspaceMessageRow>(
        'SELECT * FROM workspace_messages WHERE lane_id = ? ORDER BY created_at DESC LIMIT ?'
      ),

      // Workspace artifacts
      insertWorkspaceArtifact: this.db.prepare<[string, string, string | null, string | null, string, string | null, string | null, string | null, string, number]>(
        'INSERT INTO workspace_artifacts (id, workspace_id, lane_id, message_id, type, title, path, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      selectWorkspaceArtifactsByLane: this.db.prepare<[string, number], WorkspaceArtifactRow>(
        'SELECT * FROM workspace_artifacts WHERE lane_id = ? ORDER BY created_at DESC LIMIT ?'
      ),

      // Workspace state
      upsertWorkspaceState: this.db.prepare<[string, string | null, string | null, string, string, string, string, string, number]>(
        'INSERT INTO workspace_state (workspace_id, active_task_id, active_lane_id, decisions, constraints, goals, open_questions, handoff_notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET active_task_id = excluded.active_task_id, active_lane_id = excluded.active_lane_id, decisions = excluded.decisions, constraints = excluded.constraints, goals = excluded.goals, open_questions = excluded.open_questions, handoff_notes = excluded.handoff_notes, updated_at = excluded.updated_at'
      ),
      selectWorkspaceState: this.db.prepare<[string], WorkspaceStateRow>(
        'SELECT * FROM workspace_state WHERE workspace_id = ?'
      ),

      // Summaries
      upsertSummary: this.db.prepare<[string, string, string | null, string | null, string, string, number, number, number]>(
        'INSERT INTO summaries (id, workspace_id, lane_id, model_session_id, kind, content, source_message_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, source_message_count = excluded.source_message_count, updated_at = excluded.updated_at'
      ),
      selectLatestSummaryByLane: this.db.prepare<[string, string], SummaryRow>(
        'SELECT * FROM summaries WHERE lane_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1'
      ),
      selectLatestWorkspaceSummary: this.db.prepare<[string, string], SummaryRow>(
        'SELECT * FROM summaries WHERE workspace_id = ? AND lane_id IS NULL AND kind = ? ORDER BY updated_at DESC LIMIT 1'
      ),

      // Model sessions
      upsertModelSession: this.db.prepare<[string, string, string | null, string, string, number, number]>(
        'INSERT INTO model_sessions (id, workspace_id, lane_id, model_name, session_id, last_used, archived) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, last_used = excluded.last_used, archived = excluded.archived'
      ),
      selectModelSessionsByLane: this.db.prepare<[string], ModelSessionRow>(
        'SELECT * FROM model_sessions WHERE lane_id = ? AND archived = 0 ORDER BY last_used DESC'
      ),

      // Retrieval index
      insertRetrievalHit: this.db.prepare<[string, string, string, string | null, string, string, string, string, number, number]>(
        'INSERT INTO retrieval_index (source_type, source_id, workspace_id, lane_id, text, tags, file_paths, issue_keys, importance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      selectRetrievalHitsByWorkspace: this.db.prepare<[string, number], RetrievalHitRow>(
        'SELECT * FROM retrieval_index WHERE workspace_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?'
      ),

      // Experiences
      insertExperience: this.db.prepare<[string, string, string, string, string, number]>(
        'INSERT INTO experiences (id, task_type, outcome, lessons, tags, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
      ),
      selectExperiencesByType: this.db.prepare<[string], ExperienceRow>(
        'SELECT * FROM experiences WHERE task_type = ? ORDER BY timestamp DESC'
      ),
      selectAllExperiences: this.db.prepare<[], ExperienceRow>(
        'SELECT * FROM experiences ORDER BY timestamp DESC'
      ),
      selectRecentExperiences: this.db.prepare<[number], ExperienceRow>(
        'SELECT * FROM experiences ORDER BY timestamp DESC LIMIT ?'
      ),

      // Playbooks
      insertPlaybook: this.db.prepare<[string, string, string, string, number, number]>(
        'INSERT INTO playbooks (id, name, trigger, steps, last_used, use_count) VALUES (?, ?, ?, ?, ?, ?)'
      ),
      selectPlaybook: this.db.prepare<[string], PlaybookRow>(
        'SELECT * FROM playbooks WHERE id = ?'
      ),
      selectPlaybookByTrigger: this.db.prepare<[string, string], PlaybookRow>(
        "SELECT * FROM playbooks WHERE trigger = ? OR trigger LIKE ? ORDER BY use_count DESC LIMIT 1"
      ),
      selectAllPlaybooks: this.db.prepare<[], PlaybookRow>(
        'SELECT * FROM playbooks ORDER BY use_count DESC'
      ),

      // Patterns
      insertPattern: this.db.prepare<[string, string, string, number, number]>(
        'INSERT INTO patterns (id, category, pattern, confidence, updated_at) VALUES (?, ?, ?, ?, ?)'
      ),
      selectPatternsByCategory: this.db.prepare<[string], PatternRow>(
        'SELECT * FROM patterns WHERE category = ? ORDER BY confidence DESC'
      ),
    } as const;
  }

  // -------------------------------------------------------------------------
  // Dynamic update helpers (field names are controlled internally, no injection
  // risk — values are always parameterised)
  // -------------------------------------------------------------------------

  private buildUpdate(
    table: string,
    id: string,
    updates: Record<string, unknown>,
    columnMap: Record<string, string>
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, col] of Object.entries(columnMap)) {
      if (key in updates) {
        sets.push(`${col} = ?`);
        values.push(updates[key]);
      }
    }

    if (sets.length === 0) return;

    values.push(id);
    this.db
      .prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  // -------------------------------------------------------------------------
  // Session methods
  // -------------------------------------------------------------------------

  createSession(id: string): void {
    const now = Date.now();
    this.stmts.insertSession.run(id, now, now, 'active');
  }

  getSession(id: string): Session | null {
    const row = this.stmts.selectSession.get(id);
    if (!row) return null;
    return this.rowToSession(row);
  }

  updateSession(id: string, updates: Partial<Session>): void {
    this.buildUpdate('sessions', id, updates as Record<string, unknown>, {
      startedAt: 'started_at',
      lastUpdated: 'last_updated',
      status: 'status',
    });
  }

  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      startedAt: row.started_at,
      lastUpdated: row.last_updated,
      status: row.status as Session['status'],
    };
  }

  // -------------------------------------------------------------------------
  // Workspace methods
  // -------------------------------------------------------------------------

  saveWorkspace(workspace: Workspace): void {
    this.stmts.upsertWorkspace.run(
      workspace.id,
      workspace.rootPath,
      workspace.name,
      workspace.createdAt,
      workspace.lastUpdated
    );
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.stmts.selectWorkspace.get(id);
    if (!row) return null;
    return this.rowToWorkspace(row);
  }

  getWorkspaceByRootPath(rootPath: string): Workspace | null {
    const row = this.stmts.selectWorkspaceByRootPath.get(rootPath);
    if (!row) return null;
    return this.rowToWorkspace(row);
  }

  getRecentWorkspaces(limit: number): Workspace[] {
    return this.stmts.selectRecentWorkspaces.all(limit).map(this.rowToWorkspace);
  }

  private rowToWorkspace(row: WorkspaceRow): Workspace {
    return {
      id: row.id,
      rootPath: row.root_path,
      name: row.name,
      createdAt: row.created_at,
      lastUpdated: row.last_updated,
    };
  }

  // -------------------------------------------------------------------------
  // Task lane methods
  // -------------------------------------------------------------------------

  saveTaskLane(lane: TaskLane): void {
    this.stmts.upsertTaskLane.run(
      lane.id,
      lane.workspaceId,
      lane.title,
      lane.status,
      lane.createdAt,
      lane.lastUpdated,
      lane.activeSummaryId ?? null
    );
  }

  getTaskLane(id: string): TaskLane | null {
    const row = this.stmts.selectTaskLane.get(id);
    if (!row) return null;
    return this.rowToTaskLane(row);
  }

  getTaskLanesByWorkspace(workspaceId: string, limit = 20): TaskLane[] {
    return this.stmts.selectTaskLanesByWorkspace.all(workspaceId, limit).map(this.rowToTaskLane);
  }

  private rowToTaskLane(row: TaskLaneRow): TaskLane {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      status: row.status as TaskLane['status'],
      createdAt: row.created_at,
      lastUpdated: row.last_updated,
      activeSummaryId: row.active_summary_id ?? undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Task methods
  // -------------------------------------------------------------------------

  createTask(task: Task): void {
    this.stmts.insertTask.run(
      task.id,
      task.sessionId,
      task.description,
      task.workingDir ?? null,
      task.workspaceId ?? null,
      task.laneId ?? null,
      task.status,
      task.createdAt,
      task.updatedAt,
      task.result ?? null,
      task.error ?? null
    );
  }

  getTask(id: string): Task | null {
    const row = this.stmts.selectTask.get(id);
    if (!row) return null;
    return this.rowToTask(row);
  }

  updateTask(id: string, updates: Partial<Task>): void {
    this.buildUpdate('tasks', id, updates as Record<string, unknown>, {
      description: 'description',
      workingDir: 'working_dir',
      workspaceId: 'workspace_id',
      laneId: 'lane_id',
      status: 'status',
      updatedAt: 'updated_at',
      result: 'result',
      error: 'error',
    });
  }

  getTasksBySession(sessionId: string): Task[] {
    return this.stmts.selectTasksBySession
      .all(sessionId)
      .map(this.rowToTask);
  }

  getRecentTasks(limit: number): Task[] {
    return this.stmts.selectRecentTasks.all(limit).map(this.rowToTask);
  }

  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      sessionId: row.session_id,
      description: row.description,
      workingDir: row.working_dir ?? undefined,
      workspaceId: row.workspace_id ?? undefined,
      laneId: row.lane_id ?? undefined,
      status: row.status as Task['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Plan methods
  // -------------------------------------------------------------------------

  savePlan(plan: Plan): void {
    // Upsert — replace on conflict so callers can save the same plan id again
    this.db
      .prepare(
        'INSERT INTO plans (id, task_id, steps, status, current_step, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET steps = excluded.steps, status = excluded.status, current_step = excluded.current_step'
      )
      .run(
        plan.id,
        plan.taskId,
        plan.laneId ?? null,
        JSON.stringify(plan.steps),
        plan.status,
        plan.currentStep,
        plan.createdAt
      );
  }

  getPlan(id: string): Plan | null {
    const row = this.stmts.selectPlan.get(id);
    if (!row) return null;
    return this.rowToPlan(row);
  }

  updatePlan(id: string, updates: Partial<Plan>): void {
    // steps needs JSON serialization, handle separately
    const { steps, ...rest } = updates as Partial<Plan> & { steps?: Plan['steps'] };

    if (steps !== undefined) {
      this.db
        .prepare('UPDATE plans SET steps = ? WHERE id = ?')
        .run(JSON.stringify(steps), id);
    }

    this.buildUpdate('plans', id, rest as Record<string, unknown>, {
      taskId: 'task_id',
      laneId: 'lane_id',
      status: 'status',
      currentStep: 'current_step',
      createdAt: 'created_at',
    });
  }

  private rowToPlan(row: PlanRow): Plan {
    return {
      id: row.id,
      taskId: row.task_id,
      laneId: row.lane_id ?? undefined,
      steps: JSON.parse(row.steps),
      status: row.status as Plan['status'],
      currentStep: row.current_step,
      createdAt: row.created_at,
    };
  }

  // -------------------------------------------------------------------------
  // Workspace memory methods
  // -------------------------------------------------------------------------

  appendWorkspaceMessage(message: WorkspaceMessage): void {
    this.stmts.insertWorkspaceMessage.run(
      message.id,
      message.workspaceId,
      message.laneId ?? null,
      message.sessionId,
      message.role,
      message.kind,
      message.content,
      JSON.stringify(message.metadata ?? {}),
      message.createdAt,
      message.summaryId ?? null
    );
  }

  getWorkspaceMessagesByLane(laneId: string, limit = 100): WorkspaceMessage[] {
    return this.stmts.selectWorkspaceMessagesByLane.all(laneId, limit).map(this.rowToWorkspaceMessage);
  }

  private rowToWorkspaceMessage(row: WorkspaceMessageRow): WorkspaceMessage {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      laneId: row.lane_id ?? undefined,
      sessionId: row.session_id,
      role: row.role as WorkspaceMessage['role'],
      kind: row.kind,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      summaryId: row.summary_id ?? undefined,
    };
  }

  saveWorkspaceArtifact(artifact: WorkspaceArtifact): void {
    this.stmts.insertWorkspaceArtifact.run(
      artifact.id,
      artifact.workspaceId,
      artifact.laneId ?? null,
      artifact.messageId ?? null,
      artifact.type,
      artifact.title ?? null,
      artifact.path ?? null,
      artifact.content ?? null,
      JSON.stringify(artifact.metadata ?? {}),
      artifact.createdAt
    );
  }

  getWorkspaceArtifactsByLane(laneId: string, limit = 100): WorkspaceArtifact[] {
    return this.stmts.selectWorkspaceArtifactsByLane.all(laneId, limit).map(this.rowToWorkspaceArtifact);
  }

  private rowToWorkspaceArtifact(row: WorkspaceArtifactRow): WorkspaceArtifact {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      laneId: row.lane_id ?? undefined,
      messageId: row.message_id ?? undefined,
      type: row.type,
      title: row.title ?? undefined,
      path: row.path ?? undefined,
      content: row.content ?? undefined,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
    };
  }

  saveWorkspaceState(state: WorkspaceState): void {
    this.stmts.upsertWorkspaceState.run(
      state.workspaceId,
      state.activeTaskId ?? null,
      state.activeLaneId ?? null,
      JSON.stringify(state.decisions),
      JSON.stringify(state.constraints),
      JSON.stringify(state.goals),
      JSON.stringify(state.openQuestions),
      JSON.stringify(state.handoffNotes),
      state.updatedAt
    );
  }

  getWorkspaceState(workspaceId: string): WorkspaceState | null {
    const row = this.stmts.selectWorkspaceState.get(workspaceId);
    if (!row) return null;
    return this.rowToWorkspaceState(row);
  }

  private rowToWorkspaceState(row: WorkspaceStateRow): WorkspaceState {
    return {
      workspaceId: row.workspace_id,
      activeTaskId: row.active_task_id ?? undefined,
      activeLaneId: row.active_lane_id ?? undefined,
      decisions: JSON.parse(row.decisions),
      constraints: JSON.parse(row.constraints),
      goals: JSON.parse(row.goals),
      openQuestions: JSON.parse(row.open_questions),
      handoffNotes: JSON.parse(row.handoff_notes),
      updatedAt: row.updated_at,
    };
  }

  saveSummary(summary: SummaryRecord): void {
    this.stmts.upsertSummary.run(
      summary.id,
      summary.workspaceId,
      summary.laneId ?? null,
      summary.modelSessionId ?? null,
      summary.kind,
      summary.content,
      summary.sourceMessageCount,
      summary.createdAt,
      summary.updatedAt
    );
  }

  getLatestLaneSummary(laneId: string, kind: SummaryRecord['kind'] = 'lane'): SummaryRecord | null {
    const row = this.stmts.selectLatestSummaryByLane.get(laneId, kind);
    if (!row) return null;
    return this.rowToSummary(row);
  }

  getLatestWorkspaceSummary(workspaceId: string, kind: SummaryRecord['kind'] = 'workspace'): SummaryRecord | null {
    const row = this.stmts.selectLatestWorkspaceSummary.get(workspaceId, kind);
    if (!row) return null;
    return this.rowToSummary(row);
  }

  private rowToSummary(row: SummaryRow): SummaryRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      laneId: row.lane_id ?? undefined,
      modelSessionId: row.model_session_id ?? undefined,
      kind: row.kind as SummaryRecord['kind'],
      content: row.content,
      sourceMessageCount: row.source_message_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  saveModelSession(handle: ModelSessionHandle): void {
    this.stmts.upsertModelSession.run(
      handle.id,
      handle.workspaceId,
      handle.laneId ?? null,
      handle.modelName,
      handle.sessionId,
      handle.lastUsed,
      handle.archived ? 1 : 0
    );
  }

  getActiveModelSessionsByLane(laneId: string): ModelSessionHandle[] {
    return this.stmts.selectModelSessionsByLane.all(laneId).map(this.rowToModelSession);
  }

  private rowToModelSession(row: ModelSessionRow): ModelSessionHandle {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      laneId: row.lane_id ?? undefined,
      modelName: row.model_name,
      sessionId: row.session_id,
      lastUsed: row.last_used,
      archived: row.archived === 1,
    };
  }

  saveRetrievalHit(hit: RetrievalHit): void {
    this.stmts.insertRetrievalHit.run(
      hit.sourceType,
      hit.sourceId,
      hit.workspaceId,
      hit.laneId ?? null,
      hit.text,
      JSON.stringify(hit.tags),
      JSON.stringify(hit.filePaths),
      JSON.stringify(hit.issueKeys),
      hit.importance,
      hit.createdAt
    );
  }

  getRetrievalHits(workspaceId: string, limit = 25): RetrievalHit[] {
    return this.stmts.selectRetrievalHitsByWorkspace.all(workspaceId, limit).map(this.rowToRetrievalHit);
  }

  private rowToRetrievalHit(row: RetrievalHitRow): RetrievalHit {
    return {
      sourceType: row.source_type as RetrievalHit['sourceType'],
      sourceId: row.source_id,
      workspaceId: row.workspace_id,
      laneId: row.lane_id ?? undefined,
      text: row.text,
      tags: JSON.parse(row.tags),
      filePaths: JSON.parse(row.file_paths),
      issueKeys: JSON.parse(row.issue_keys),
      importance: row.importance,
      createdAt: row.created_at,
    };
  }

  // -------------------------------------------------------------------------
  // Event methods
  // -------------------------------------------------------------------------

  logEvent(event: FtmEvent): void {
    this.stmts.insertEvent.run(
      event.sessionId,
      event.type,
      event.timestamp,
      JSON.stringify(event.data ?? {})
    );
  }

  getEvents(sessionId: string, since = 0): FtmEvent[] {
    return this.stmts.selectEventsBySession
      .all(sessionId, since)
      .map(this.rowToEvent);
  }

  getEventsByType(type: string, limit = 100): FtmEvent[] {
    return this.stmts.selectEventsByType
      .all(type, limit)
      .map(this.rowToEvent);
  }

  private rowToEvent(row: EventRow): FtmEvent {
    return {
      sessionId: row.session_id,
      type: row.type,
      timestamp: row.timestamp,
      data: JSON.parse(row.data),
    };
  }

  // -------------------------------------------------------------------------
  // Memory / context methods
  // -------------------------------------------------------------------------

  getContext(key: string): unknown | null {
    const row = this.stmts.selectContext.get(key);
    if (!row) return null;
    return JSON.parse(row.value);
  }

  setContext(key: string, value: unknown): void {
    this.stmts.upsertContext.run(key, JSON.stringify(value), Date.now());
  }

  getAllContext(): Record<string, unknown> {
    const rows = this.stmts.selectAllContext.all();
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Experience methods
  // -------------------------------------------------------------------------

  writeExperience(exp: Experience): void {
    this.stmts.insertExperience.run(
      exp.id,
      exp.taskType,
      exp.outcome,
      JSON.stringify(exp.lessons),
      JSON.stringify(exp.tags),
      exp.timestamp
    );
  }

  getExperiences(
    filters: { taskType?: string; tags?: string[]; limit?: number } = {}
  ): Experience[] {
    let rows: ExperienceRow[];

    if (filters.taskType) {
      rows = this.stmts.selectExperiencesByType.all(filters.taskType);
    } else if (filters.limit !== undefined) {
      rows = this.stmts.selectRecentExperiences.all(filters.limit);
    } else {
      rows = this.stmts.selectAllExperiences.all();
    }

    let experiences = rows.map(this.rowToExperience);

    // Post-filter by tags if requested (SQLite JSON_EACH requires extension; easier in JS for portability)
    if (filters.tags && filters.tags.length > 0) {
      const requiredTags = filters.tags;
      experiences = experiences.filter((exp) =>
        requiredTags.some((tag) => exp.tags.includes(tag))
      );
    }

    if (filters.limit !== undefined) {
      experiences = experiences.slice(0, filters.limit);
    }

    return experiences;
  }

  matchExperiences(taskType: string, tags: string[]): Experience[] {
    return this.getExperiences({ taskType, tags });
  }

  private rowToExperience(row: ExperienceRow): Experience {
    return {
      id: row.id,
      taskType: row.task_type,
      outcome: row.outcome as Experience['outcome'],
      lessons: JSON.parse(row.lessons),
      tags: JSON.parse(row.tags),
      timestamp: row.timestamp,
    };
  }

  // -------------------------------------------------------------------------
  // Playbook methods
  // -------------------------------------------------------------------------

  savePlaybook(playbook: Playbook): void {
    this.db
      .prepare(
        'INSERT INTO playbooks (id, name, trigger, steps, last_used, use_count) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, trigger = excluded.trigger, steps = excluded.steps, last_used = excluded.last_used, use_count = excluded.use_count'
      )
      .run(
        playbook.id,
        playbook.name,
        playbook.trigger,
        JSON.stringify(playbook.steps),
        playbook.lastUsed,
        playbook.useCount
      );
  }

  getPlaybook(id: string): Playbook | null {
    const row = this.stmts.selectPlaybook.get(id);
    if (!row) return null;
    return this.rowToPlaybook(row);
  }

  matchPlaybook(trigger: string): Playbook | null {
    const row = this.stmts.selectPlaybookByTrigger.get(trigger, `%${trigger}%`);
    if (!row) return null;
    return this.rowToPlaybook(row);
  }

  getAllPlaybooks(): Playbook[] {
    return this.stmts.selectAllPlaybooks.all().map(this.rowToPlaybook);
  }

  private rowToPlaybook(row: PlaybookRow): Playbook {
    return {
      id: row.id,
      name: row.name,
      trigger: row.trigger,
      steps: JSON.parse(row.steps),
      lastUsed: row.last_used,
      useCount: row.use_count,
    };
  }

  // -------------------------------------------------------------------------
  // Pattern methods
  // -------------------------------------------------------------------------

  savePattern(pattern: Pattern): void {
    this.db
      .prepare(
        'INSERT INTO patterns (id, category, pattern, confidence, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category = excluded.category, pattern = excluded.pattern, confidence = excluded.confidence, updated_at = excluded.updated_at'
      )
      .run(
        pattern.id,
        pattern.category,
        JSON.stringify(pattern.pattern),
        pattern.confidence,
        pattern.updatedAt
      );
  }

  getPatterns(category: string): Pattern[] {
    return this.stmts.selectPatternsByCategory
      .all(category)
      .map(this.rowToPattern);
  }

  private rowToPattern(row: PatternRow): Pattern {
    return {
      id: row.id,
      category: row.category,
      pattern: JSON.parse(row.pattern),
      confidence: row.confidence,
      updatedAt: row.updated_at,
    };
  }

  // -------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
