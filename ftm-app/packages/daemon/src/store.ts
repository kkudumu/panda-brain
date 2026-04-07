import Database from 'better-sqlite3';
import type {
  Session,
  Task,
  Plan,
  FtmEvent,
  Experience,
  Playbook,
  Pattern,
} from '../shared/types.js';

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
  status: string;
  created_at: number;
  updated_at: number;
  result: string | null;
  error: string | null;
}

interface PlanRow {
  id: string;
  task_id: string;
  steps: string;
  status: string;
  current_step: number;
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
        steps        TEXT    NOT NULL DEFAULT '[]',
        status       TEXT    NOT NULL DEFAULT 'pending',
        current_step INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plans_task_id ON plans(task_id);

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

      // Tasks
      insertTask: this.db.prepare<[string, string, string, string, number, number, string | null, string | null]>(
        'INSERT INTO tasks (id, session_id, description, status, created_at, updated_at, result, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
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
      insertPlan: this.db.prepare<[string, string, string, string, number, number]>(
        'INSERT INTO plans (id, task_id, steps, status, current_step, created_at) VALUES (?, ?, ?, ?, ?, ?)'
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
      selectPlaybookByTrigger: this.db.prepare<[string], PlaybookRow>(
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
      .run(...(values as Database.BindParameters[]));
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
    this.buildUpdate(id, id, updates as Record<string, unknown>, {
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
  // Task methods
  // -------------------------------------------------------------------------

  createTask(task: Task): void {
    this.stmts.insertTask.run(
      task.id,
      task.sessionId,
      task.description,
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
    this.buildUpdate(id, id, updates as Record<string, unknown>, {
      description: 'description',
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

    this.buildUpdate(id, id, rest as Record<string, unknown>, {
      taskId: 'task_id',
      status: 'status',
      currentStep: 'current_step',
      createdAt: 'created_at',
    });
  }

  private rowToPlan(row: PlanRow): Plan {
    return {
      id: row.id,
      taskId: row.task_id,
      steps: JSON.parse(row.steps),
      status: row.status as Plan['status'],
      currentStep: row.current_step,
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
