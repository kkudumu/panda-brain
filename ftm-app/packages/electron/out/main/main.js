import { ipcMain, dialog, app, BrowserWindow, nativeImage, Tray, Menu } from "electron";
import path, { join } from "path";
import fs, { existsSync, mkdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import os, { homedir } from "os";
import { parse } from "yaml";
import { WebSocketServer, WebSocket } from "ws";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
class FtmEventBus extends EventEmitter {
  sessionId;
  eventLog = [];
  constructor(sessionId) {
    super();
    this.sessionId = sessionId;
    this.setMaxListeners(50);
    this.on("error", () => {
    });
  }
  emit(type, data) {
    const event = {
      type,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      data: data ?? {}
    };
    this.eventLog.push(event);
    return super.emit(type, event);
  }
  // Also emit on wildcard for subscribers that want all events
  emitTyped(type, data) {
    this.emit(type, data);
    this.emit("*", { ...data, _eventType: type });
  }
  getEventLog() {
    return [...this.eventLog];
  }
  getEventsSince(timestamp) {
    return this.eventLog.filter((e) => e.timestamp >= timestamp);
  }
  clearLog() {
    this.eventLog = [];
  }
}
class FtmStore {
  db;
  // Prepared statements – initialised once for performance
  stmts;
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
    this.stmts = this.prepareStatements();
  }
  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------
  initialize() {
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
    const taskColumns = this.db.prepare("PRAGMA table_info(tasks)").all();
    if (!taskColumns.some((column) => column.name === "working_dir")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN working_dir TEXT");
    }
  }
  // -------------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------------
  prepareStatements() {
    return {
      // Sessions
      insertSession: this.db.prepare(
        "INSERT INTO sessions (id, started_at, last_updated, status) VALUES (?, ?, ?, ?)"
      ),
      selectSession: this.db.prepare(
        "SELECT * FROM sessions WHERE id = ?"
      ),
      // Tasks
      insertTask: this.db.prepare(
        "INSERT INTO tasks (id, session_id, description, working_dir, status, created_at, updated_at, result, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ),
      selectTask: this.db.prepare(
        "SELECT * FROM tasks WHERE id = ?"
      ),
      selectTasksBySession: this.db.prepare(
        "SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC"
      ),
      selectRecentTasks: this.db.prepare(
        "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?"
      ),
      // Plans
      insertPlan: this.db.prepare(
        "INSERT INTO plans (id, task_id, steps, status, current_step, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ),
      selectPlan: this.db.prepare(
        "SELECT * FROM plans WHERE id = ?"
      ),
      // Events
      insertEvent: this.db.prepare(
        "INSERT INTO events (session_id, type, timestamp, data) VALUES (?, ?, ?, ?)"
      ),
      selectEventsBySession: this.db.prepare(
        "SELECT * FROM events WHERE session_id = ? AND timestamp >= ? ORDER BY timestamp ASC"
      ),
      selectEventsByType: this.db.prepare(
        "SELECT * FROM events WHERE type = ? ORDER BY timestamp DESC LIMIT ?"
      ),
      // Memory / context
      upsertContext: this.db.prepare(
        "INSERT INTO memory_context (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ),
      selectContext: this.db.prepare(
        "SELECT * FROM memory_context WHERE key = ?"
      ),
      selectAllContext: this.db.prepare(
        "SELECT * FROM memory_context"
      ),
      // Experiences
      insertExperience: this.db.prepare(
        "INSERT INTO experiences (id, task_type, outcome, lessons, tags, timestamp) VALUES (?, ?, ?, ?, ?, ?)"
      ),
      selectExperiencesByType: this.db.prepare(
        "SELECT * FROM experiences WHERE task_type = ? ORDER BY timestamp DESC"
      ),
      selectAllExperiences: this.db.prepare(
        "SELECT * FROM experiences ORDER BY timestamp DESC"
      ),
      selectRecentExperiences: this.db.prepare(
        "SELECT * FROM experiences ORDER BY timestamp DESC LIMIT ?"
      ),
      // Playbooks
      insertPlaybook: this.db.prepare(
        "INSERT INTO playbooks (id, name, trigger, steps, last_used, use_count) VALUES (?, ?, ?, ?, ?, ?)"
      ),
      selectPlaybook: this.db.prepare(
        "SELECT * FROM playbooks WHERE id = ?"
      ),
      selectPlaybookByTrigger: this.db.prepare(
        "SELECT * FROM playbooks WHERE trigger = ? OR trigger LIKE ? ORDER BY use_count DESC LIMIT 1"
      ),
      selectAllPlaybooks: this.db.prepare(
        "SELECT * FROM playbooks ORDER BY use_count DESC"
      ),
      // Patterns
      insertPattern: this.db.prepare(
        "INSERT INTO patterns (id, category, pattern, confidence, updated_at) VALUES (?, ?, ?, ?, ?)"
      ),
      selectPatternsByCategory: this.db.prepare(
        "SELECT * FROM patterns WHERE category = ? ORDER BY confidence DESC"
      )
    };
  }
  // -------------------------------------------------------------------------
  // Dynamic update helpers (field names are controlled internally, no injection
  // risk — values are always parameterised)
  // -------------------------------------------------------------------------
  buildUpdate(table, id, updates, columnMap) {
    const sets = [];
    const values = [];
    for (const [key, col] of Object.entries(columnMap)) {
      if (key in updates) {
        sets.push(`${col} = ?`);
        values.push(updates[key]);
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }
  // -------------------------------------------------------------------------
  // Session methods
  // -------------------------------------------------------------------------
  createSession(id) {
    const now = Date.now();
    this.stmts.insertSession.run(id, now, now, "active");
  }
  getSession(id) {
    const row = this.stmts.selectSession.get(id);
    if (!row) return null;
    return this.rowToSession(row);
  }
  updateSession(id, updates) {
    this.buildUpdate("sessions", id, updates, {
      startedAt: "started_at",
      lastUpdated: "last_updated",
      status: "status"
    });
  }
  rowToSession(row) {
    return {
      id: row.id,
      startedAt: row.started_at,
      lastUpdated: row.last_updated,
      status: row.status
    };
  }
  // -------------------------------------------------------------------------
  // Task methods
  // -------------------------------------------------------------------------
  createTask(task) {
    this.stmts.insertTask.run(
      task.id,
      task.sessionId,
      task.description,
      task.workingDir ?? null,
      task.status,
      task.createdAt,
      task.updatedAt,
      task.result ?? null,
      task.error ?? null
    );
  }
  getTask(id) {
    const row = this.stmts.selectTask.get(id);
    if (!row) return null;
    return this.rowToTask(row);
  }
  updateTask(id, updates) {
    this.buildUpdate("tasks", id, updates, {
      description: "description",
      workingDir: "working_dir",
      status: "status",
      updatedAt: "updated_at",
      result: "result",
      error: "error"
    });
  }
  getTasksBySession(sessionId) {
    return this.stmts.selectTasksBySession.all(sessionId).map(this.rowToTask);
  }
  getRecentTasks(limit) {
    return this.stmts.selectRecentTasks.all(limit).map(this.rowToTask);
  }
  rowToTask(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      description: row.description,
      workingDir: row.working_dir ?? void 0,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      result: row.result ?? void 0,
      error: row.error ?? void 0
    };
  }
  // -------------------------------------------------------------------------
  // Plan methods
  // -------------------------------------------------------------------------
  savePlan(plan) {
    this.db.prepare(
      "INSERT INTO plans (id, task_id, steps, status, current_step, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET steps = excluded.steps, status = excluded.status, current_step = excluded.current_step"
    ).run(
      plan.id,
      plan.taskId,
      JSON.stringify(plan.steps),
      plan.status,
      plan.currentStep,
      plan.createdAt
    );
  }
  getPlan(id) {
    const row = this.stmts.selectPlan.get(id);
    if (!row) return null;
    return this.rowToPlan(row);
  }
  updatePlan(id, updates) {
    const { steps, ...rest } = updates;
    if (steps !== void 0) {
      this.db.prepare("UPDATE plans SET steps = ? WHERE id = ?").run(JSON.stringify(steps), id);
    }
    this.buildUpdate("plans", id, rest, {
      taskId: "task_id",
      status: "status",
      currentStep: "current_step",
      createdAt: "created_at"
    });
  }
  rowToPlan(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      steps: JSON.parse(row.steps),
      status: row.status,
      currentStep: row.current_step,
      createdAt: row.created_at
    };
  }
  // -------------------------------------------------------------------------
  // Event methods
  // -------------------------------------------------------------------------
  logEvent(event) {
    this.stmts.insertEvent.run(
      event.sessionId,
      event.type,
      event.timestamp,
      JSON.stringify(event.data ?? {})
    );
  }
  getEvents(sessionId, since = 0) {
    return this.stmts.selectEventsBySession.all(sessionId, since).map(this.rowToEvent);
  }
  getEventsByType(type, limit = 100) {
    return this.stmts.selectEventsByType.all(type, limit).map(this.rowToEvent);
  }
  rowToEvent(row) {
    return {
      sessionId: row.session_id,
      type: row.type,
      timestamp: row.timestamp,
      data: JSON.parse(row.data)
    };
  }
  // -------------------------------------------------------------------------
  // Memory / context methods
  // -------------------------------------------------------------------------
  getContext(key) {
    const row = this.stmts.selectContext.get(key);
    if (!row) return null;
    return JSON.parse(row.value);
  }
  setContext(key, value) {
    this.stmts.upsertContext.run(key, JSON.stringify(value), Date.now());
  }
  getAllContext() {
    const rows = this.stmts.selectAllContext.all();
    const result = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value);
    }
    return result;
  }
  // -------------------------------------------------------------------------
  // Experience methods
  // -------------------------------------------------------------------------
  writeExperience(exp) {
    this.stmts.insertExperience.run(
      exp.id,
      exp.taskType,
      exp.outcome,
      JSON.stringify(exp.lessons),
      JSON.stringify(exp.tags),
      exp.timestamp
    );
  }
  getExperiences(filters = {}) {
    let rows;
    if (filters.taskType) {
      rows = this.stmts.selectExperiencesByType.all(filters.taskType);
    } else if (filters.limit !== void 0) {
      rows = this.stmts.selectRecentExperiences.all(filters.limit);
    } else {
      rows = this.stmts.selectAllExperiences.all();
    }
    let experiences = rows.map(this.rowToExperience);
    if (filters.tags && filters.tags.length > 0) {
      const requiredTags = filters.tags;
      experiences = experiences.filter(
        (exp) => requiredTags.some((tag) => exp.tags.includes(tag))
      );
    }
    if (filters.limit !== void 0) {
      experiences = experiences.slice(0, filters.limit);
    }
    return experiences;
  }
  matchExperiences(taskType, tags) {
    return this.getExperiences({ taskType, tags });
  }
  rowToExperience(row) {
    return {
      id: row.id,
      taskType: row.task_type,
      outcome: row.outcome,
      lessons: JSON.parse(row.lessons),
      tags: JSON.parse(row.tags),
      timestamp: row.timestamp
    };
  }
  // -------------------------------------------------------------------------
  // Playbook methods
  // -------------------------------------------------------------------------
  savePlaybook(playbook) {
    this.db.prepare(
      "INSERT INTO playbooks (id, name, trigger, steps, last_used, use_count) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, trigger = excluded.trigger, steps = excluded.steps, last_used = excluded.last_used, use_count = excluded.use_count"
    ).run(
      playbook.id,
      playbook.name,
      playbook.trigger,
      JSON.stringify(playbook.steps),
      playbook.lastUsed,
      playbook.useCount
    );
  }
  getPlaybook(id) {
    const row = this.stmts.selectPlaybook.get(id);
    if (!row) return null;
    return this.rowToPlaybook(row);
  }
  matchPlaybook(trigger) {
    const row = this.stmts.selectPlaybookByTrigger.get(trigger, `%${trigger}%`);
    if (!row) return null;
    return this.rowToPlaybook(row);
  }
  getAllPlaybooks() {
    return this.stmts.selectAllPlaybooks.all().map(this.rowToPlaybook);
  }
  rowToPlaybook(row) {
    return {
      id: row.id,
      name: row.name,
      trigger: row.trigger,
      steps: JSON.parse(row.steps),
      lastUsed: row.last_used,
      useCount: row.use_count
    };
  }
  // -------------------------------------------------------------------------
  // Pattern methods
  // -------------------------------------------------------------------------
  savePattern(pattern) {
    this.db.prepare(
      "INSERT INTO patterns (id, category, pattern, confidence, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category = excluded.category, pattern = excluded.pattern, confidence = excluded.confidence, updated_at = excluded.updated_at"
    ).run(
      pattern.id,
      pattern.category,
      JSON.stringify(pattern.pattern),
      pattern.confidence,
      pattern.updatedAt
    );
  }
  getPatterns(category) {
    return this.stmts.selectPatternsByCategory.all(category).map(this.rowToPattern);
  }
  rowToPattern(row) {
    return {
      id: row.id,
      category: row.category,
      pattern: JSON.parse(row.pattern),
      confidence: row.confidence,
      updatedAt: row.updated_at
    };
  }
  // -------------------------------------------------------------------------
  close() {
    this.db.close();
  }
}
const KEY_CURRENT_TASK = "blackboard:current_task";
const KEY_DECISIONS = "blackboard:decisions";
const KEY_CONSTRAINTS = "blackboard:constraints";
const KEY_SESSION_META = "blackboard:session_metadata";
const KEY_USER_PROFILE = "blackboard:user_profile";
function inferSystemPreferredName() {
  const raw = process.env.FTM_USER_NAME ?? process.env.USER ?? process.env.USERNAME;
  if (!raw) return null;
  const token = raw.split(/[.@_\s-]+/).map((part) => part.trim()).find(Boolean);
  if (!token) return null;
  return token.charAt(0).toUpperCase() + token.slice(1);
}
class Blackboard {
  constructor(store) {
    this.store = store;
  }
  // -------------------------------------------------------------------------
  // Full context assembly
  // -------------------------------------------------------------------------
  /**
   * Assemble a complete BlackboardContext snapshot from the various
   * persisted sub-keys and recent store queries.
   */
  getContext() {
    return {
      currentTask: this.getCurrentTask(),
      recentDecisions: this.getRecentDecisions(),
      activeConstraints: this.getConstraints(),
      sessionMetadata: this.getSessionMetadata(),
      userProfile: this.getUserProfile()
    };
  }
  // -------------------------------------------------------------------------
  // Current task
  // -------------------------------------------------------------------------
  setCurrentTask(task) {
    this.store.setContext(KEY_CURRENT_TASK, task);
  }
  clearCurrentTask() {
    this.store.setContext(KEY_CURRENT_TASK, null);
  }
  getCurrentTask() {
    return this.store.getContext(KEY_CURRENT_TASK) ?? null;
  }
  // -------------------------------------------------------------------------
  // Decision tracking
  // -------------------------------------------------------------------------
  addDecision(decision, reason) {
    const decisions = this.loadDecisions();
    decisions.push({ decision, reason, timestamp: Date.now() });
    this.store.setContext(KEY_DECISIONS, decisions);
  }
  getRecentDecisions(limit = 10) {
    const decisions = this.loadDecisions();
    return decisions.slice(-limit);
  }
  loadDecisions() {
    return this.store.getContext(KEY_DECISIONS) ?? [];
  }
  // -------------------------------------------------------------------------
  // Constraint management
  // -------------------------------------------------------------------------
  setConstraints(constraints) {
    this.store.setContext(KEY_CONSTRAINTS, constraints);
  }
  addConstraint(constraint) {
    const current = this.getConstraints();
    if (!current.includes(constraint)) {
      current.push(constraint);
      this.store.setContext(KEY_CONSTRAINTS, current);
    }
  }
  removeConstraint(constraint) {
    const filtered = this.getConstraints().filter((c) => c !== constraint);
    this.store.setContext(KEY_CONSTRAINTS, filtered);
  }
  getConstraints() {
    return this.store.getContext(KEY_CONSTRAINTS) ?? [];
  }
  // -------------------------------------------------------------------------
  // Experience matching (delegates to store with convenience wrapper)
  // -------------------------------------------------------------------------
  writeExperience(exp) {
    const full = {
      ...exp,
      id: randomUUID(),
      timestamp: Date.now()
    };
    this.store.writeExperience(full);
  }
  findRelevantExperiences(taskType, tags) {
    return this.store.matchExperiences(taskType, tags);
  }
  // -------------------------------------------------------------------------
  // Playbook operations
  // -------------------------------------------------------------------------
  checkPlaybook(trigger) {
    return this.store.matchPlaybook(trigger);
  }
  recordPlaybookUse(id) {
    const playbook = this.store.getPlaybook(id);
    if (!playbook) return;
    this.store.savePlaybook({
      ...playbook,
      lastUsed: Date.now(),
      useCount: playbook.useCount + 1
    });
  }
  // -------------------------------------------------------------------------
  // Session metadata
  // -------------------------------------------------------------------------
  updateSessionMetadata(updates) {
    const current = this.getSessionMetadata();
    this.store.setContext(KEY_SESSION_META, { ...current, ...updates });
  }
  getSessionMetadata() {
    const stored = this.store.getContext(KEY_SESSION_META);
    if (stored) return stored;
    const defaults = {
      startedAt: Date.now(),
      lastUpdated: Date.now(),
      skillsInvoked: []
    };
    this.store.setContext(KEY_SESSION_META, defaults);
    return defaults;
  }
  // -------------------------------------------------------------------------
  // User profile
  // -------------------------------------------------------------------------
  updateUserProfile(mutator) {
    const profile = this.getUserProfile();
    const next = JSON.parse(JSON.stringify(profile));
    mutator(next);
    next.lastUpdated = Date.now();
    this.store.setContext(KEY_USER_PROFILE, next);
    return next;
  }
  getUserProfileSnapshot() {
    return this.getUserProfile();
  }
  getUserProfile() {
    const stored = this.store.getContext(KEY_USER_PROFILE);
    if (stored) return stored;
    const defaults = {
      lastUpdated: Date.now(),
      preferredName: inferSystemPreferredName(),
      responseStyle: "collaborative",
      preferredOutputFormats: [],
      activeProjects: [],
      approvalPreference: "mixed",
      approvalHistory: {
        requestedCount: 0,
        approvedCount: 0,
        modifiedCount: 0,
        autoApprovedCount: 0
      },
      commonTaskTypes: [],
      workflowPatterns: [],
      topicInterests: [],
      modelPreferences: []
    };
    this.store.setContext(KEY_USER_PROFILE, defaults);
    return defaults;
  }
}
class BaseAdapter {
  // Shared utility: check if a CLI binary exists
  async checkBinary(binary) {
    return new Promise((resolve) => {
      const proc = spawn("which", [binary], { stdio: "pipe" });
      proc.on("close", (code) => {
        resolve(code === 0);
      });
      proc.on("error", () => {
        resolve(false);
      });
    });
  }
  // Shared utility: spawn a CLI process and collect output
  async spawnCli(command, args, opts) {
    return new Promise((resolve) => {
      const timeoutMs = opts?.timeout ?? 5 * 60 * 1e3;
      const proc = spawn(command, args, {
        cwd: opts?.cwd,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode });
      };
      const timer = setTimeout(() => {
        if (!settled) {
          proc.kill("SIGTERM");
          setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch {
            }
          }, 2e3);
          finish(124);
        }
      }, timeoutMs);
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("close", (code) => {
        finish(code ?? 1);
      });
      proc.on("error", (err) => {
        stderr += `
Process error: ${err.message}`;
        finish(1);
      });
      if (opts?.stdin) {
        proc.stdin.write(opts.stdin);
        proc.stdin.end();
      } else {
        proc.stdin.end();
      }
    });
  }
  // Shared utility: create an empty normalized response
  emptyResponse(sessionId = "") {
    return {
      text: "",
      toolCalls: [],
      sessionId,
      tokenUsage: { input: 0, output: 0, cached: 0 }
    };
  }
}
class ClaudeAdapter extends BaseAdapter {
  name = "claude";
  async available() {
    return this.checkBinary("claude");
  }
  async startSession(prompt, opts) {
    const args = ["-p", prompt, "--output-format", "json"];
    if (opts?.model) args.push("--model", opts.model);
    if (opts?.maxTokens) args.push("--max-tokens", String(opts.maxTokens));
    if (opts?.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
    const result = await this.spawnCli("claude", args, { cwd: opts?.workingDir });
    if (result.exitCode !== 0 && result.stdout.trim() === "") {
      const response = this.emptyResponse();
      response.text = result.stderr || `Claude exited with code ${result.exitCode}`;
      return response;
    }
    return this.parseResponse(result.stdout || result.stderr);
  }
  async resumeSession(sessionId, prompt) {
    const args = ["-p", prompt, "--output-format", "json", "--resume", sessionId];
    const result = await this.spawnCli("claude", args);
    if (result.exitCode !== 0 && result.stdout.trim() === "") {
      const response = this.emptyResponse(sessionId);
      response.text = result.stderr || `Claude exited with code ${result.exitCode}`;
      return response;
    }
    return this.parseResponse(result.stdout || result.stderr);
  }
  parseResponse(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
      return this.emptyResponse();
    }
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: "",
        tokenUsage: { input: 0, output: 0, cached: 0 }
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: "",
        tokenUsage: { input: 0, output: 0, cached: 0 }
      };
    }
    const toolCalls = (parsed.tool_uses ?? []).map((tu) => ({
      name: tu.name,
      arguments: tu.input,
      result: tu.result
    }));
    return {
      text: parsed.result ?? "",
      toolCalls,
      sessionId: parsed.session_id ?? "",
      tokenUsage: {
        input: parsed.usage?.input_tokens ?? 0,
        output: parsed.usage?.output_tokens ?? 0,
        cached: parsed.usage?.cache_read_input_tokens ?? 0
      },
      cost: parsed.cost_usd ?? parsed.total_cost_usd
    };
  }
}
class CodexAdapter extends BaseAdapter {
  name = "codex";
  async available() {
    return this.checkBinary("codex");
  }
  async startSession(prompt, opts) {
    const args = ["exec", prompt, "--json"];
    if (opts?.model) args.push("-m", opts.model);
    const result = await this.spawnCli("codex", args, { cwd: opts?.workingDir });
    if (result.exitCode !== 0 && result.stdout.trim() === "") {
      const response = this.emptyResponse();
      response.text = result.stderr || `Codex exited with code ${result.exitCode}`;
      return response;
    }
    return this.parseResponse(result.stdout || result.stderr);
  }
  async resumeSession(_sessionId, prompt) {
    return this.startSession(prompt);
  }
  parseResponse(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
      return this.emptyResponse();
    }
    const parsedObjects = this.parseJsonObjects(trimmed);
    if (parsedObjects.length === 0) {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: "",
        tokenUsage: { input: 0, output: 0, cached: 0 }
      };
    }
    const toolCalls = [];
    const textParts = [];
    let lastParsed = null;
    for (const parsed of parsedObjects) {
      lastParsed = parsed;
      const text = this.extractText(parsed);
      if (text) {
        textParts.push(text);
      }
      if (parsed.tool_calls) {
        for (const tc of parsed.tool_calls) {
          const name = tc.name ?? tc.function?.name ?? "";
          let args = tc.arguments ?? {};
          if (tc.function?.arguments && typeof tc.function.arguments === "string") {
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = { raw: tc.function.arguments };
            }
          } else if (tc.function?.arguments && typeof tc.function.arguments === "object") {
            args = tc.function.arguments;
          }
          toolCalls.push({ name, arguments: args, result: tc.result });
        }
      }
      if (parsed.choices && parsed.choices.length > 0) {
        const choiceToolCalls = parsed.choices[0].message?.tool_calls ?? [];
        for (const tc of choiceToolCalls) {
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = { raw: tc.function.arguments };
          }
          toolCalls.push({ name: tc.function.name, arguments: args });
        }
      }
    }
    const dedupedText = Array.from(
      new Set(textParts.map((part) => part.trim()).filter(Boolean))
    ).join("\n");
    const turnCompleted = parsedObjects.find((p) => p.type === "turn.completed");
    const usage = turnCompleted?.usage ?? lastParsed?.usage;
    return {
      // Only fall back to raw trimmed if we genuinely got nothing — never dump JSON
      text: dedupedText || "",
      toolCalls,
      sessionId: "",
      tokenUsage: {
        input: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
        output: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
        cached: 0
      }
    };
  }
  parseJsonObjects(raw) {
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    const parsed = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
      }
    }
    if (parsed.length > 0) {
      return parsed;
    }
    try {
      return [JSON.parse(raw)];
    } catch {
      return [];
    }
  }
  extractText(parsed) {
    if (parsed.type === "item.completed" && parsed.item?.type === "agent_message") {
      return parsed.item.text ?? parsed.item.message ?? "";
    }
    if (parsed.response) return parsed.response;
    if (parsed.output) return parsed.output;
    if (parsed.content) return parsed.content;
    if (parsed.text) return parsed.text;
    if (parsed.final) return parsed.final;
    if (parsed.message?.content) return parsed.message.content;
    if (parsed.choices && parsed.choices.length > 0) {
      return parsed.choices[0].message?.content ?? "";
    }
    if (parsed.type === "response.output_text.delta" && parsed.delta) {
      return parsed.delta;
    }
    return "";
  }
}
class GeminiAdapter extends BaseAdapter {
  name = "gemini";
  async available() {
    return this.checkBinary("gemini");
  }
  async startSession(prompt, opts) {
    const args = ["-p", prompt, "--output-format", "json"];
    if (opts?.model) args.push("--model", opts.model);
    const result = await this.spawnCli("gemini", args, { cwd: opts?.workingDir });
    if (result.exitCode !== 0 && result.stdout.trim() === "") {
      const response = this.emptyResponse();
      response.text = result.stderr || `Gemini exited with code ${result.exitCode}`;
      return response;
    }
    return this.parseResponse(result.stdout || result.stderr);
  }
  async resumeSession(sessionId, prompt) {
    const args = ["-p", prompt, "--output-format", "json", "--resume", sessionId];
    const result = await this.spawnCli("gemini", args);
    if (result.exitCode !== 0 && result.stdout.trim() === "") {
      const response = this.emptyResponse(sessionId);
      response.text = result.stderr || `Gemini exited with code ${result.exitCode}`;
      return response;
    }
    return this.parseResponse(result.stdout || result.stderr);
  }
  parseResponse(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
      return this.emptyResponse();
    }
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: "",
        tokenUsage: { input: 0, output: 0, cached: 0 }
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: "",
        tokenUsage: { input: 0, output: 0, cached: 0 }
      };
    }
    let text = "";
    if (parsed.result) {
      text = parsed.result;
    } else if (parsed.response) {
      text = parsed.response;
    } else if (parsed.text) {
      text = parsed.text;
    } else if (parsed.content) {
      text = parsed.content;
    } else if (parsed.candidates && parsed.candidates.length > 0) {
      const parts = parsed.candidates[0].content?.parts ?? [];
      text = parts.map((p) => p.text ?? "").join("");
    }
    const sessionId = parsed.session_id ?? parsed.sessionId ?? "";
    const usage = parsed.usage ?? {};
    const inputTokens = usage.input_tokens ?? usage.prompt_token_count ?? 0;
    const outputTokens = usage.output_tokens ?? usage.candidates_token_count ?? 0;
    const cachedTokens = usage.cache_read_input_tokens ?? usage.cached_content_token_count ?? 0;
    const toolCalls = [];
    if (parsed.tool_calls) {
      for (const tc of parsed.tool_calls) {
        toolCalls.push({
          name: tc.name,
          arguments: tc.arguments,
          result: tc.result
        });
      }
    }
    if (parsed.functionCalls) {
      for (const fc of parsed.functionCalls) {
        toolCalls.push({
          name: fc.name,
          arguments: fc.args
        });
      }
    }
    return {
      text,
      toolCalls,
      sessionId,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        cached: cachedTokens
      }
    };
  }
}
class OllamaAdapter extends BaseAdapter {
  name = "ollama";
  baseUrl;
  constructor(baseUrl = "http://localhost:11434") {
    super();
    this.baseUrl = baseUrl;
  }
  async available() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5e3);
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }
  async startSession(prompt, opts) {
    const model = opts?.model ?? "llama3.1";
    const messages = [];
    if (opts?.systemPrompt) {
      messages.push({ role: "system", content: opts.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    const body = {
      model,
      messages,
      stream: false,
      ...opts?.maxTokens ? { options: { num_predict: opts.maxTokens } } : {}
    };
    try {
      const controller = new AbortController();
      const timeoutMs = 5 * 60 * 1e3;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        const normalized = this.emptyResponse();
        normalized.text = `Ollama HTTP error ${response.status}: ${errorText}`;
        return normalized;
      }
      const text = await response.text();
      return this.parseResponse(text);
    } catch (err) {
      const normalized = this.emptyResponse();
      normalized.text = err instanceof Error ? err.message : "Ollama request failed";
      return normalized;
    }
  }
  async resumeSession(_sessionId, prompt) {
    return this.startSession(prompt);
  }
  parseResponse(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
      return this.emptyResponse();
    }
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const lines = trimmed.split("\n").filter((l) => l.trim());
      for (const line of lines.reverse()) {
        try {
          const obj = JSON.parse(line);
          if (obj.done) {
            parsed = obj;
            break;
          }
          if (!parsed) {
            parsed = obj;
          }
        } catch {
        }
      }
    }
    if (!parsed) {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: "",
        tokenUsage: { input: 0, output: 0, cached: 0 }
      };
    }
    return {
      text: parsed.message?.content ?? "",
      toolCalls: [],
      sessionId: "",
      tokenUsage: {
        // Ollama uses eval_count for output tokens and prompt_eval_count for input tokens
        input: parsed.prompt_eval_count ?? 0,
        output: parsed.eval_count ?? 0,
        cached: 0
      }
    };
  }
}
class AdapterRegistry {
  adapters = /* @__PURE__ */ new Map();
  healthCache = /* @__PURE__ */ new Map();
  cacheTtl = 6e4;
  // 1 minute cache
  constructor() {
    this.register(new ClaudeAdapter());
    this.register(new CodexAdapter());
    this.register(new GeminiAdapter());
    this.register(new OllamaAdapter());
  }
  register(adapter) {
    this.adapters.set(adapter.name, adapter);
    this.healthCache.delete(adapter.name);
  }
  get(name) {
    return this.adapters.get(name);
  }
  getAll() {
    return Array.from(this.adapters.values());
  }
  // Check which adapters are currently available (with caching)
  async checkHealth() {
    const now = Date.now();
    const results = /* @__PURE__ */ new Map();
    const checks = Array.from(this.adapters.entries()).map(async ([name, adapter]) => {
      const cached = this.healthCache.get(name);
      if (cached && now - cached.checkedAt < this.cacheTtl) {
        results.set(name, cached.available);
        return;
      }
      let available = false;
      try {
        available = await adapter.available();
      } catch {
        available = false;
      }
      this.healthCache.set(name, { available, checkedAt: Date.now() });
      results.set(name, available);
    });
    await Promise.all(checks);
    return results;
  }
  // Get health status for a specific adapter (with cache)
  async isAvailable(name) {
    const adapter = this.adapters.get(name);
    if (!adapter) return false;
    const now = Date.now();
    const cached = this.healthCache.get(name);
    if (cached && now - cached.checkedAt < this.cacheTtl) {
      return cached.available;
    }
    let available = false;
    try {
      available = await adapter.available();
    } catch {
      available = false;
    }
    this.healthCache.set(name, { available, checkedAt: Date.now() });
    return available;
  }
  // Get first available adapter from a preference list
  async getFirstAvailable(preferences) {
    for (const name of preferences) {
      const adapter = this.adapters.get(name);
      if (!adapter) continue;
      const available = await this.isAvailable(name);
      if (available) return adapter;
    }
    return null;
  }
}
function getConfigPath() {
  return join(homedir(), ".ftm", "config.yml");
}
function getDataDir() {
  return join(homedir(), ".ftm", "data");
}
function getDbPath() {
  return join(getDataDir(), "ftm.db");
}
function ensureDataDir() {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
function loadConfigFile(path2) {
  if (!existsSync(path2)) {
    return null;
  }
  try {
    const raw = readFileSync(path2, "utf8");
    const parsed = parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
function mergeConfig(defaults, overrides) {
  const merged = {
    ...defaults,
    ...overrides,
    profiles: {
      ...defaults.profiles,
      ...overrides.profiles ?? {}
    },
    execution: {
      ...defaults.execution,
      ...overrides.execution ?? {}
    },
    daemon: {
      ...defaults.daemon,
      ...overrides.daemon ?? {}
    }
  };
  return merged;
}
const DEFAULT_CONFIG = {
  profile: "balanced",
  profiles: {
    quality: { planning: "claude", execution: "claude", review: "claude" },
    balanced: { planning: "claude", execution: "codex", review: "gemini" },
    budget: { planning: "gemini", execution: "ollama", review: "ollama" }
  },
  execution: {
    maxParallelAgents: 5,
    autoAudit: true,
    progressTracking: true,
    approvalMode: "plan_first"
  },
  daemon: { port: 4040, host: "localhost" }
};
const FALLBACK_ORDER = ["claude", "codex", "gemini", "ollama"];
class ModelRouter {
  config;
  configPath;
  registry;
  eventBus;
  constructor(registry, eventBus, configPath) {
    this.registry = registry;
    this.eventBus = eventBus;
    this.configPath = configPath ?? getConfigPath();
    this.config = this.loadConfig(this.configPath);
  }
  // ---------------------------------------------------------------------------
  // Config management
  // ---------------------------------------------------------------------------
  /**
   * Load config from the given path, falling back to defaults if the file
   * does not exist or cannot be parsed.
   */
  loadConfig(configPath) {
    const overrides = loadConfigFile(configPath);
    if (!overrides) {
      return { ...DEFAULT_CONFIG };
    }
    return mergeConfig(DEFAULT_CONFIG, overrides);
  }
  /**
   * Returns the currently active FtmConfig.
   */
  getConfig() {
    return this.config;
  }
  /**
   * Re-reads the config file from disk and updates the in-memory config.
   * Useful for hot-reloading without restarting the daemon.
   */
  reloadConfig() {
    this.config = this.loadConfig(this.configPath);
  }
  // ---------------------------------------------------------------------------
  // Profile access
  // ---------------------------------------------------------------------------
  /**
   * Returns the ModelProfile that corresponds to the active profile name.
   * Falls back to the 'balanced' profile if the named profile does not exist.
   */
  getActiveProfile() {
    const profileName = this.config.profile;
    const profile = this.config.profiles[profileName];
    if (profile) {
      return profile;
    }
    const balanced = this.config.profiles["balanced"];
    if (balanced) {
      return balanced;
    }
    return { planning: "claude", execution: "codex", review: "gemini" };
  }
  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------
  /**
   * Route a task role to an adapter.
   *
   * @param role         - 'planning' | 'execution' | 'review'
   * @param overrideModel - Optional model name to use instead of the profile default
   * @returns            The first available ModelAdapter for the role
   * @throws             When no adapter is available at all
   */
  async route(role, overrideModel) {
    const modelName = overrideModel ?? this.getActiveProfile()[role];
    if (await this.registry.isAvailable(modelName)) {
      const adapter = this.registry.get(modelName);
      if (adapter) {
        this.eventBus.emitTyped("model_selected", {
          role,
          model: modelName,
          override: !!overrideModel
        });
        return adapter;
      }
    }
    for (const name of FALLBACK_ORDER) {
      if (name === modelName) continue;
      if (await this.registry.isAvailable(name)) {
        const adapter = this.registry.get(name);
        if (adapter) {
          this.eventBus.emitTyped("model_selected", {
            role,
            model: name,
            fallback: true,
            originalModel: modelName
          });
          return adapter;
        }
      }
    }
    throw new Error(
      `No model adapter available for role "${role}". Configured: ${modelName}, none available.`
    );
  }
}
const EXTERNAL_PROFILE_CACHE_TTL_MS = 3e4;
let cachedExternalSignals = null;
function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
function safeReadJson(filePath) {
  const text = safeReadText(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function walkMarkdownFiles(rootDir, maxDepth = 4) {
  const results = [];
  function visit(currentDir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".git")) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      results.push(fullPath);
    }
  }
  visit(rootDir, 0);
  return results;
}
function parseTopLevelYamlValue(content, key) {
  const match = content.match(new RegExp(`^${key}:\\s*([^#\\n]+)`, "m"));
  return match?.[1]?.trim() ?? null;
}
function titleCaseFirstToken(raw) {
  if (!raw) return null;
  const token = raw.split(/[.@_\s-]+/).map((part) => part.trim()).find(Boolean);
  if (!token) return null;
  return token.charAt(0).toUpperCase() + token.slice(1);
}
function mergePatterns(primary, secondary) {
  const merged = /* @__PURE__ */ new Map();
  for (const item of [...primary, ...secondary]) {
    const key = item.label.trim().toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item });
      continue;
    }
    existing.count += item.count;
    existing.lastSeen = Math.max(existing.lastSeen, item.lastSeen);
  }
  return Array.from(merged.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return right.lastSeen - left.lastSeen;
  }).slice(0, 8);
}
function extractMarkdownBullet(content, needle) {
  const line = content.split("\n").map((value) => value.trim()).find((value) => value.startsWith("-") && value.toLowerCase().includes(needle.toLowerCase()));
  return line ? line.replace(/^-+\s*/, "").trim() : null;
}
function collectSessionMetaProjects(homeDir) {
  const sessionMetaDir = path.join(homeDir, ".claude", "usage-data", "session-meta");
  let entries = [];
  try {
    entries = fs.readdirSync(sessionMetaDir).filter((fileName) => fileName.endsWith(".json")).slice(-400);
  } catch {
    return [];
  }
  const counts = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const filePath = path.join(sessionMetaDir, entry);
    const payload = safeReadJson(filePath);
    const projectPath = payload?.project_path;
    if (!projectPath || projectPath === "/" || projectPath.startsWith(path.join(homeDir, ".claude"))) {
      continue;
    }
    const label = path.basename(projectPath) || projectPath;
    const existing = counts.get(label.toLowerCase());
    if (existing) {
      existing.count += 1;
      existing.lastSeen = Date.now();
      continue;
    }
    counts.set(label.toLowerCase(), {
      label,
      count: 1,
      lastSeen: Date.now()
    });
  }
  return Array.from(counts.values()).filter((item) => item.count >= 2).sort((left, right) => right.count - left.count).slice(0, 5);
}
function discoverProfileMarkdownFiles(claudeRoot) {
  return walkMarkdownFiles(claudeRoot, 4).filter((filePath) => {
    const normalized = filePath.toLowerCase();
    return normalized.includes("profile") || normalized.includes("preferences") || normalized.includes("communication-style") || normalized.includes("voice") || normalized.includes("work-style");
  }).slice(0, 40);
}
function loadExternalProfileSignals() {
  const now = Date.now();
  if (cachedExternalSignals && now - cachedExternalSignals.loadedAt < EXTERNAL_PROFILE_CACHE_TTL_MS) {
    return cachedExternalSignals.value;
  }
  const homeDir = os.homedir();
  const sourcePaths = /* @__PURE__ */ new Set();
  const communicationStyle = /* @__PURE__ */ new Set();
  const approvalGuidance = /* @__PURE__ */ new Set();
  const workStyleNotes = /* @__PURE__ */ new Set();
  let preferredName = null;
  let modelProfile = null;
  let approvalMode = null;
  const claudeBlackboardPath = path.join(homeDir, ".claude", "ftm-state", "blackboard", "context.json");
  const claudeBlackboard = safeReadJson(claudeBlackboardPath);
  if (claudeBlackboard) {
    sourcePaths.add(claudeBlackboardPath);
    const prefs = claudeBlackboard.user_preferences;
    if (prefs?.communication_style) {
      communicationStyle.add(prefs.communication_style);
    }
    if (prefs?.approval_gates) {
      approvalGuidance.add(prefs.approval_gates);
    }
    if (prefs?.default_model_profile) {
      modelProfile = prefs.default_model_profile;
    }
  }
  const claudeConfigPath = path.join(homeDir, ".claude", "ftm-config.yml");
  const claudeConfig = safeReadText(claudeConfigPath);
  if (claudeConfig) {
    sourcePaths.add(claudeConfigPath);
    modelProfile = modelProfile ?? parseTopLevelYamlValue(claudeConfig, "profile");
    const parsedApprovalMode = parseTopLevelYamlValue(claudeConfig, "approval_mode");
    if (parsedApprovalMode === "auto" || parsedApprovalMode === "plan_first" || parsedApprovalMode === "always_ask") {
      approvalMode = parsedApprovalMode;
      approvalGuidance.add(`Claude execution approval mode is ${parsedApprovalMode}.`);
    }
  }
  const claudeRoot = path.join(homeDir, ".claude");
  for (const markdownPath of discoverProfileMarkdownFiles(claudeRoot)) {
    const content = safeReadText(markdownPath);
    if (!content) continue;
    sourcePaths.add(markdownPath);
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
    preferredName = preferredName ?? titleCaseFirstToken(heading);
    const communicationNeedles = [
      "concise",
      "technical",
      "direct",
      "professional",
      "confident",
      "natural",
      "emoji",
      "hedging"
    ];
    for (const needle of communicationNeedles) {
      const match = extractMarkdownBullet(content, needle);
      if (match) {
        communicationStyle.add(match);
      }
    }
    const workStyleNeedles = [
      "direct, concrete guidance",
      "deep debugging",
      "building and creation",
      "context switching",
      "fast executor",
      "quick wins",
      "sauce",
      "respond well"
    ];
    for (const needle of workStyleNeedles) {
      const match = extractMarkdownBullet(content, needle);
      if (match) {
        workStyleNotes.add(match);
      }
    }
  }
  const recurringProjects = collectSessionMetaProjects(homeDir);
  if (recurringProjects.length > 0) {
    sourcePaths.add(path.join(homeDir, ".claude", "usage-data", "session-meta"));
  }
  const value = {
    preferredName,
    communicationStyle: Array.from(communicationStyle),
    approvalGuidance: Array.from(approvalGuidance),
    modelProfile,
    approvalMode,
    recurringProjects,
    workStyleNotes: Array.from(workStyleNotes),
    sourcePaths: Array.from(sourcePaths)
  };
  cachedExternalSignals = { loadedAt: now, value };
  return value;
}
function inferResponseStyle(profile, external) {
  if (profile.responseStyle === "direct") {
    return "direct";
  }
  const joined = external.communicationStyle.join(" ").toLowerCase();
  if (joined.includes("concise") || joined.includes("direct") || joined.includes("technical") || joined.includes("confident")) {
    return "direct";
  }
  return profile.responseStyle;
}
function inferApprovalPreference(profile, external) {
  if (profile.approvalPreference !== "mixed") {
    return profile.approvalPreference;
  }
  if (external.approvalMode === "always_ask") {
    return "hands_on";
  }
  if (external.approvalMode === "auto") {
    return "streamlined";
  }
  return profile.approvalPreference;
}
function synthesizeUserContext(profile) {
  const externalSignals = loadExternalProfileSignals();
  const mergedProfile = {
    ...profile,
    preferredName: profile.preferredName ?? externalSignals.preferredName,
    responseStyle: inferResponseStyle(profile, externalSignals),
    approvalPreference: inferApprovalPreference(profile, externalSignals),
    activeProjects: mergePatterns(profile.activeProjects, externalSignals.recurringProjects)
  };
  const promptContext = [];
  if (mergedProfile.preferredName) {
    promptContext.push(`Preferred name: ${mergedProfile.preferredName}`);
  }
  promptContext.push(`Preferred response style: ${mergedProfile.responseStyle}`);
  promptContext.push(`Approval preference: ${mergedProfile.approvalPreference}`);
  if (externalSignals.modelProfile) {
    promptContext.push(`Claude profile in use elsewhere: ${externalSignals.modelProfile}`);
  }
  if (externalSignals.approvalMode) {
    promptContext.push(`Claude-side approval mode: ${externalSignals.approvalMode}`);
  }
  if (mergedProfile.activeProjects.length > 0) {
    promptContext.push(`Recurring projects: ${mergedProfile.activeProjects.slice(0, 5).map((item) => item.label).join(", ")}`);
  }
  if (externalSignals.communicationStyle.length > 0) {
    promptContext.push(`External communication signals: ${externalSignals.communicationStyle.slice(0, 3).join(" | ")}`);
  }
  if (externalSignals.workStyleNotes.length > 0) {
    promptContext.push(`External work-style notes: ${externalSignals.workStyleNotes.slice(0, 3).join(" | ")}`);
  }
  if (externalSignals.approvalGuidance.length > 0) {
    promptContext.push(`Approval guidance: ${externalSignals.approvalGuidance.slice(0, 2).join(" | ")}`);
  }
  return {
    profile: mergedProfile,
    externalSignals,
    promptContext
  };
}
class OodaLoop {
  phase = "idle";
  modules = [];
  eventBus;
  blackboard;
  router;
  currentTask = null;
  currentPlan = null;
  constructor(eventBus, blackboard, router) {
    this.eventBus = eventBus;
    this.blackboard = blackboard;
    this.router = router;
  }
  // ---------------------------------------------------------------------------
  // Module registration
  // ---------------------------------------------------------------------------
  registerModule(module) {
    this.modules.push(module);
  }
  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------
  /**
   * Runs the full OODA cycle for the given task and returns the final result.
   * Emits lifecycle events throughout so the daemon can stream progress to clients.
   */
  async processTask(task) {
    this.currentTask = task;
    this.blackboard.setCurrentTask(task);
    try {
      if (this.isDirectReplyTask(task.description)) {
        return this.completeDirectReply(task);
      }
      if (this.isQuickReplyTask(task.description)) {
        return await this.completeQuickReply(task);
      }
      this.setPhase("observe");
      const context = await this.observe(task);
      this.setPhase("orient");
      const analysis = await this.orient(context);
      this.setPhase("decide");
      const plan = await this.decide(task, analysis);
      this.currentPlan = plan;
      if (this.router.getConfig().execution.approvalMode !== "auto") {
        if (this.hasApprovalEvent(plan.id)) {
          plan.status = "approved";
        } else {
          this.eventBus.emitTyped("approval_requested", { taskId: task.id, plan });
          await this.waitForApproval(plan);
        }
      }
      this.setPhase("act");
      const result = await this.act(plan);
      this.setPhase("complete");
      this.eventBus.emitTyped("task_completed", { taskId: task.id, result });
      return result;
    } catch (error) {
      this.setPhase("error");
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.eventBus.emitTyped("error", { taskId: task.id, error: errorMsg });
      return { success: false, error: errorMsg };
    } finally {
      this.blackboard.clearCurrentTask();
      this.currentTask = null;
      this.currentPlan = null;
    }
  }
  getTaskWorkingDir(task) {
    return task.workingDir ?? process.cwd();
  }
  // ---------------------------------------------------------------------------
  // OBSERVE
  // ---------------------------------------------------------------------------
  /**
   * Loads contextual information: current blackboard state, any matching
   * playbook, and relevant past experiences.
   */
  async observe(task) {
    this.eventBus.emitTyped("memory_retrieved", { taskId: task.id });
    const context = {
      task,
      blackboard: this.blackboard.getContext(),
      config: this.router.getConfig()
    };
    const playbook = this.blackboard.checkPlaybook(task.description);
    if (playbook) {
      this.eventBus.emitTyped("playbook_matched", {
        taskId: task.id,
        playbookId: playbook.id
      });
      this.blackboard.recordPlaybookUse(playbook.id);
    }
    this.blackboard.findRelevantExperiences("general", []);
    return context;
  }
  // ---------------------------------------------------------------------------
  // ORIENT
  // ---------------------------------------------------------------------------
  /**
   * Classifies task complexity, identifies applicable modules, and evaluates
   * guard rules against the task context.
   */
  async orient(context) {
    const complexity = this.classifyComplexity(context.task.description);
    const matchedModules = this.modules.filter((m) => m.canHandle(context));
    const guardFlags = this.checkGuardRules(context);
    return { complexity, matchedModules, guardFlags };
  }
  // ---------------------------------------------------------------------------
  // DECIDE
  // ---------------------------------------------------------------------------
  /**
   * Produces an execution plan.
   *
   * For complex tasks (many guard flags or matched modules) we emit the plan
   * with multiple steps; for simple tasks we emit a single-step plan.
   * LLM-powered decomposition will replace this heuristic once adapters are live.
   */
  async decide(task, analysis) {
    const steps = this.buildSteps(task, analysis);
    const plan = {
      id: `plan-${Date.now()}`,
      taskId: task.id,
      steps,
      status: "pending",
      currentStep: 0,
      createdAt: Date.now()
    };
    this.eventBus.emitTyped("plan_generated", { taskId: task.id, plan });
    return plan;
  }
  /**
   * Builds plan steps from the task and orient analysis.
   * Guard flags get prepended as validation steps; the main task follows.
   */
  buildSteps(task, analysis) {
    const steps = [];
    if (analysis.guardFlags.includes("destructive_operation")) {
      steps.push({
        index: steps.length,
        description: "Confirm: destructive operation detected — verify intent before proceeding",
        status: "pending",
        requiresApproval: true
      });
    }
    if (analysis.guardFlags.includes("production_target")) {
      steps.push({
        index: steps.length,
        description: "Confirm: task targets a production system — proceed with caution",
        status: "pending",
        requiresApproval: true
      });
    }
    steps.push({
      index: steps.length,
      description: task.description,
      status: "pending"
    });
    return steps;
  }
  // ---------------------------------------------------------------------------
  // ACT
  // ---------------------------------------------------------------------------
  /**
   * Executes all plan steps in sequence.
   * Routes each step to the execution model, collects outputs, and aggregates
   * them into a single ModuleResult.
   */
  async act(plan) {
    plan.status = "executing";
    const outputs = [];
    const workingDir = this.currentTask ? this.getTaskWorkingDir(this.currentTask) : process.cwd();
    for (const step of plan.steps) {
      this.eventBus.emitTyped("step_started", {
        planId: plan.id,
        stepIndex: step.index,
        description: step.description
      });
      if (step.requiresApproval) {
        this.eventBus.emitTyped("approval_requested", {
          planId: plan.id,
          stepIndex: step.index
        });
      }
      const adapter = await this.router.route("execution");
      const response = await adapter.startSession(
        `Execute this step: ${step.description}`,
        { workingDir }
      );
      step.status = "completed";
      plan.currentStep = step.index + 1;
      outputs.push(response.text);
      this.eventBus.emitTyped("step_completed", {
        planId: plan.id,
        stepIndex: step.index,
        response: response.text.substring(0, 500)
      });
    }
    plan.status = "completed";
    return {
      success: true,
      output: outputs.join("\n\n")
    };
  }
  isDirectReplyTask(description) {
    const normalized = description.trim().toLowerCase();
    if (!normalized) return false;
    return [
      "hello",
      "hello machine",
      "hi",
      "hi machine",
      "hey",
      "hey machine",
      "good morning",
      "good afternoon",
      "good evening",
      "thanks",
      "thank you",
      "help",
      "what can you do",
      "who are you"
    ].includes(normalized);
  }
  isQuickReplyTask(description) {
    const normalized = description.trim().toLowerCase();
    if (!normalized || this.isDirectReplyTask(description)) return false;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (wordCount > 12) return false;
    const blockerSignals = [
      "write",
      "implement",
      "build",
      "create",
      "refactor",
      "fix",
      "debug",
      "run",
      "execute",
      "install",
      "deploy",
      "delete",
      "remove",
      "production",
      "file",
      "code",
      "function",
      "script"
    ];
    return !blockerSignals.some((signal) => normalized.includes(signal));
  }
  completeDirectReply(task) {
    this.setPhase("observe");
    const profile = synthesizeUserContext(this.blackboard.getUserProfileSnapshot()).profile;
    const result = {
      success: true,
      output: this.buildDirectReply(task.description, profile.preferredName)
    };
    this.setPhase("complete");
    this.eventBus.emitTyped("task_completed", { taskId: task.id, result });
    return result;
  }
  buildDirectReply(description, preferredName) {
    const normalized = description.trim().toLowerCase();
    if (normalized.includes("thank")) {
      return "You're welcome.";
    }
    if (normalized === "help" || normalized === "what can you do") {
      return "I can answer quick questions, plan work, and run longer coding tasks.";
    }
    if (normalized === "who are you") {
      return "I am Feed The Machine, your terminal-first helper.";
    }
    return `Hello ${preferredName ?? "user"}.`;
  }
  async completeQuickReply(task) {
    this.setPhase("observe");
    this.eventBus.emitTyped("memory_retrieved", { taskId: task.id });
    this.setPhase("orient");
    this.setPhase("act");
    const synthesized = synthesizeUserContext(this.blackboard.getUserProfileSnapshot());
    const profile = synthesized.profile;
    const outputFormats = profile.preferredOutputFormats.slice(0, 3).map((item) => item.label);
    const adapter = await this.router.route("execution");
    const response = await adapter.startSession(
      [
        "Reply directly to the user in one or two short sentences.",
        "Do not make a plan.",
        "Do not describe internal execution.",
        ...profile.preferredName ? [`Address the user as ${profile.preferredName}.`] : [],
        `Prefer a ${profile.responseStyle} tone.`,
        ...outputFormats.length > 0 ? [`Honor these output format preferences when they make sense: ${outputFormats.join(", ")}.`] : [],
        ...synthesized.promptContext.map((line) => `Profile context: ${line}`),
        `User message: ${task.description}`
      ].join("\n"),
      { workingDir: this.getTaskWorkingDir(task) }
    );
    const result = {
      success: true,
      output: response.text.trim() || "Task completed."
    };
    this.setPhase("complete");
    this.eventBus.emitTyped("task_completed", { taskId: task.id, result });
    return result;
  }
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  /**
   * Classify task complexity by word count.
   */
  classifyComplexity(description) {
    const words = description.split(/\s+/).length;
    if (words < 10) return "micro";
    if (words < 30) return "small";
    if (words < 80) return "medium";
    if (words < 200) return "large";
    return "xl";
  }
  /**
   * Evaluate guard rules against the task context and return a list of flag names
   * for any rule that fired.
   */
  checkGuardRules(context) {
    const flags = [];
    const desc = context.task.description.toLowerCase();
    if (desc.includes("delete") || desc.includes("remove") || desc.includes("drop") || desc.includes("rm -rf") || desc.includes("reset --hard")) {
      flags.push("destructive_operation");
    }
    if (desc.includes("production") || desc.includes("prod")) {
      flags.push("production_target");
    }
    if (desc.includes("force") || desc.includes("--force")) {
      flags.push("force_flag");
    }
    return flags;
  }
  /**
   * Returns a Promise that resolves when a plan_approved event is received for
   * the given plan.  The plan's status is set to 'approved' before resolving.
   */
  waitForApproval(plan) {
    return new Promise((resolve) => {
      if (this.hasApprovalEvent(plan.id)) {
        plan.status = "approved";
        resolve();
        return;
      }
      const handler = (event) => {
        if (event.data?.planId === plan.id) {
          plan.status = "approved";
          this.eventBus.removeListener("plan_approved", handler);
          resolve();
        }
      };
      this.eventBus.on("plan_approved", handler);
    });
  }
  hasApprovalEvent(planId) {
    return this.eventBus.getEventLog().some(
      (event) => event.type === "plan_approved" && event.data?.planId === planId
    );
  }
  /**
   * Transition to the given phase and broadcast an ooda_phase event.
   */
  setPhase(phase) {
    this.phase = phase;
    this.eventBus.emit("ooda_phase", { phase, taskId: this.currentTask?.id });
  }
  // ---------------------------------------------------------------------------
  // State accessors
  // ---------------------------------------------------------------------------
  getPhase() {
    return this.phase;
  }
  getCurrentTask() {
    return this.currentTask;
  }
  getCurrentPlan() {
    return this.currentPlan;
  }
}
class FtmServer {
  wss = null;
  clients = /* @__PURE__ */ new Set();
  eventBus;
  ooda;
  store;
  blackboard;
  machineState = "idle";
  sessionId;
  taskCounter = 0;
  constructor(opts) {
    this.eventBus = opts.eventBus;
    this.ooda = opts.ooda;
    this.store = opts.store;
    this.blackboard = opts.blackboard;
    this.sessionId = opts.sessionId ?? this.eventBus.sessionId ?? `ftm-${Date.now()}`;
    this.setupEventForwarding();
  }
  // Start the WebSocket server
  start(port = 4040, host = "localhost") {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port, host }, () => resolve());
      this.wss.on("connection", (ws) => {
        this.clients.add(ws);
        this.sendTo(ws, {
          type: "state_snapshot",
          id: "init",
          success: true,
          payload: this.getStateSnapshot()
        });
        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this.handleMessage(ws, msg);
          } catch (e) {
            this.sendTo(ws, {
              type: "error",
              id: "unknown",
              success: false,
              payload: {},
              error: "Invalid message format"
            });
          }
        });
        ws.on("close", () => {
          this.clients.delete(ws);
        });
      });
      console.log(`[FTM Server] WebSocket listening on ${host}:${port}`);
    });
  }
  // Handle incoming WebSocket messages
  async handleMessage(ws, msg) {
    switch (msg.type) {
      case "submit_task": {
        const now = Date.now();
        const task = {
          id: `task-${now}-${++this.taskCounter}`,
          description: msg.payload.description,
          workingDir: typeof msg.payload.workingDir === "string" ? msg.payload.workingDir : void 0,
          status: "pending",
          createdAt: now,
          updatedAt: now,
          sessionId: this.sessionId
        };
        this.store.createTask(task);
        this.eventBus.emitTyped("task_submitted", { task });
        this.processTaskAsync(task);
        this.sendTo(ws, {
          type: "task_submitted",
          id: msg.id,
          success: true,
          payload: { taskId: task.id }
        });
        break;
      }
      case "approve_plan": {
        const planId = msg.payload.planId;
        this.eventBus.emitTyped("plan_approved", { planId });
        this.sendTo(ws, {
          type: "plan_approved",
          id: msg.id,
          success: true,
          payload: { planId }
        });
        break;
      }
      case "modify_plan": {
        const planId = msg.payload.planId;
        const modifications = msg.payload.modifications;
        const plan = this.store.getPlan(planId);
        if (plan) {
          this.store.updatePlan(planId, modifications);
        }
        this.eventBus.emitTyped("plan_modified", { planId, modifications });
        this.sendTo(ws, {
          type: "plan_modified",
          id: msg.id,
          success: true,
          payload: { planId, modifications }
        });
        break;
      }
      case "cancel_task": {
        const taskId = msg.payload.taskId;
        this.store.updateTask(taskId, { status: "cancelled", updatedAt: Date.now() });
        this.sendTo(ws, {
          type: "task_cancelled",
          id: msg.id,
          success: true,
          payload: { taskId }
        });
        break;
      }
      case "get_state": {
        this.sendTo(ws, {
          type: "state_snapshot",
          id: msg.id,
          success: true,
          payload: this.getStateSnapshot()
        });
        break;
      }
      case "get_history": {
        const limit = msg.payload.limit ?? 20;
        const tasks = this.store.getRecentTasks(limit);
        this.sendTo(ws, {
          type: "history",
          id: msg.id,
          success: true,
          payload: { tasks }
        });
        break;
      }
      default:
        this.sendTo(ws, {
          type: "error",
          id: msg.id,
          success: false,
          payload: {},
          error: `Unknown message type: ${msg.type}`
        });
    }
  }
  // Process a task through the OODA loop (async, non-blocking)
  async processTaskAsync(task) {
    this.store.updateTask(task.id, { status: "in_progress", updatedAt: Date.now() });
    try {
      const result = await this.ooda.processTask(task);
      this.store.updateTask(task.id, {
        status: result.success ? "completed" : "failed",
        result: result.output,
        error: result.error,
        updatedAt: Date.now()
      });
    } catch (error) {
      this.store.updateTask(task.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now()
      });
    }
  }
  // Forward all event bus events to connected WebSocket clients
  setupEventForwarding() {
    this.eventBus.on("*", (event) => {
      this.broadcast({
        type: "event",
        id: `evt-${Date.now()}`,
        success: true,
        payload: { event }
      });
    });
    this.eventBus.on("ooda_phase", (event) => {
      const phase = event.data.phase;
      const stateMap = {
        idle: "idle",
        observe: "ingesting",
        orient: "thinking",
        decide: "thinking",
        act: "executing",
        complete: "complete",
        error: "error"
      };
      this.machineState = stateMap[phase] ?? "idle";
      this.broadcast({
        type: "machine_state",
        id: `state-${Date.now()}`,
        success: true,
        payload: { state: this.machineState }
      });
    });
  }
  // Send to single client
  sendTo(ws, response) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }
  // Broadcast to all connected clients
  broadcast(response) {
    const data = JSON.stringify(response);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
  // Get current daemon state snapshot
  getStateSnapshot() {
    const profileContext = synthesizeUserContext(this.blackboard.getUserProfileSnapshot());
    return {
      machineState: this.machineState,
      currentTask: this.ooda.getCurrentTask(),
      currentPlan: this.ooda.getCurrentPlan(),
      phase: this.ooda.getPhase(),
      blackboard: this.blackboard.getContext(),
      profileContext,
      connectedClients: this.clients.size
    };
  }
  // Graceful shutdown
  stop() {
    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }
  }
  getPort() {
    if (!this.wss) return null;
    const addr = this.wss.address();
    if (typeof addr === "string") return null;
    if (addr && "port" in addr) return addr.port;
    return null;
  }
  getMachineState() {
    return this.machineState;
  }
}
const INTENT_SIGNALS = {
  code: [
    "implement",
    "write",
    "create",
    "refactor",
    "build",
    "add function",
    "add method",
    "fix bug",
    "update code",
    "edit file",
    "typescript",
    "javascript",
    "python",
    "class",
    "interface",
    "module",
    "component"
  ],
  debug: [
    "debug",
    "error",
    "exception",
    "failing",
    "broken",
    "crash",
    "issue",
    "problem",
    "trace",
    "stack trace",
    "not working",
    "fix",
    "investigate",
    "diagnose",
    "why is",
    "what is causing"
  ],
  research: [
    "research",
    "find",
    "look up",
    "search",
    "what is",
    "explain",
    "how does",
    "summarize",
    "compare",
    "analyze",
    "investigate",
    "learn",
    "understand",
    "documentation",
    "docs"
  ],
  plan: [
    "plan",
    "design",
    "architect",
    "strategy",
    "roadmap",
    "outline",
    "break down",
    "decompose",
    "organize",
    "structure",
    "steps to",
    "how to approach",
    "what should i do"
  ],
  ops: [
    "deploy",
    "run",
    "execute",
    "start",
    "stop",
    "restart",
    "install",
    "configure",
    "setup",
    "migrate",
    "backup",
    "monitor",
    "check status",
    "npm",
    "git",
    "docker",
    "shell",
    "script"
  ],
  memory: [
    "remember",
    "recall",
    "what did we",
    "last time",
    "previously",
    "save this",
    "store",
    "note that",
    "log this",
    "history"
  ],
  query: [
    "show me",
    "list",
    "get",
    "fetch",
    "retrieve",
    "display",
    "status",
    "current",
    "recent",
    "what are",
    "how many"
  ],
  freeform: []
};
class MindModule {
  name = "mind";
  // Session-scoped conversation context: sessionId → recent task descriptions
  conversationContext = /* @__PURE__ */ new Map();
  canHandle(_context) {
    return true;
  }
  async execute(context, emit) {
    const { task, blackboard } = context;
    emit({
      type: "module_activated",
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: { module: this.name, taskId: task.id }
    });
    this.pushConversationContext(task.sessionId, task.description);
    const classification = this.classifyIntent(task.description);
    emit({
      type: "model_selected",
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: {
        taskId: task.id,
        intent: classification.intent,
        confidence: classification.confidence,
        signals: classification.signals,
        suggestedModules: classification.suggestedModules
      }
    });
    const experiences = this.retrieveRelevantExperiences(context, classification);
    if (experiences.length > 0) {
      emit({
        type: "memory_retrieved",
        timestamp: Date.now(),
        sessionId: task.sessionId,
        data: {
          taskId: task.id,
          experienceCount: experiences.length,
          taskTypes: [...new Set(experiences.map((e) => e.taskType))]
        }
      });
    }
    const playbook = blackboard.currentTask ? null : null;
    const routingOutput = this.buildRoutingOutput(
      classification,
      experiences,
      context
    );
    emit({
      type: "plan_generated",
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: {
        taskId: task.id,
        source: "mind",
        intent: classification.intent,
        routing: routingOutput,
        playbook
      }
    });
    return {
      success: true,
      output: routingOutput,
      artifacts: [
        {
          type: "intent_classification",
          path: "",
          content: JSON.stringify(classification, null, 2)
        }
      ]
    };
  }
  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  /**
   * Classify the intent of a task description.
   * Returns the most likely intent with confidence and matched signals.
   */
  classifyIntent(description) {
    const lower = description.toLowerCase();
    const scores = {
      code: 0,
      debug: 0,
      research: 0,
      plan: 0,
      ops: 0,
      memory: 0,
      query: 0,
      freeform: 0
    };
    const matchedSignals = {
      code: [],
      debug: [],
      research: [],
      plan: [],
      ops: [],
      memory: [],
      query: [],
      freeform: []
    };
    for (const [intent, signals] of Object.entries(INTENT_SIGNALS)) {
      for (const signal of signals) {
        if (lower.includes(signal)) {
          scores[intent] += 1;
          matchedSignals[intent].push(signal);
        }
      }
    }
    let bestIntent = "freeform";
    let bestScore = 0;
    for (const [intent, score] of Object.entries(scores)) {
      if (intent === "freeform") continue;
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }
    const domainSignalCount = INTENT_SIGNALS[bestIntent].length || 1;
    const confidence = bestScore === 0 ? 0.1 : Math.min(0.95, bestScore / domainSignalCount + 0.3);
    return {
      intent: bestIntent,
      confidence: Math.round(confidence * 100) / 100,
      signals: matchedSignals[bestIntent],
      suggestedModules: this.selectModules(bestIntent, confidence)
    };
  }
  /**
   * Select the ordered list of module names to apply for an intent.
   * Guard is always first; Mind is always last.
   */
  selectModules(intent, confidence = 0.5) {
    const base = ["guard"];
    const intentRoutes = {
      code: ["planner", "executor"],
      debug: ["planner", "executor"],
      research: ["executor"],
      plan: ["planner"],
      ops: ["planner", "executor"],
      memory: ["memory"],
      query: ["memory", "executor"],
      freeform: ["executor"]
    };
    const middle = intentRoutes[intent] ?? ["executor"];
    if (confidence < 0.4 || intent === "freeform") {
      return [...base, ...middle, "daily-log", "mind"];
    }
    return [...base, ...middle, "daily-log", "mind"];
  }
  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  pushConversationContext(sessionId, description) {
    const history = this.conversationContext.get(sessionId) ?? [];
    history.push(description);
    if (history.length > 10) history.shift();
    this.conversationContext.set(sessionId, history);
  }
  retrieveRelevantExperiences(context, classification) {
    try {
      const constraints = context.blackboard.activeConstraints;
      const tags = [classification.intent, ...constraints.slice(0, 3)];
      return [];
    } catch {
      return [];
    }
  }
  buildRoutingOutput(classification, experiences, context) {
    const lines = [
      `Intent: ${classification.intent} (confidence: ${(classification.confidence * 100).toFixed(0)}%)`,
      `Signals matched: ${classification.signals.length > 0 ? classification.signals.join(", ") : "none"}`,
      `Suggested pipeline: ${classification.suggestedModules.join(" → ")}`
    ];
    if (experiences.length > 0) {
      lines.push(`Relevant experiences: ${experiences.length} found`);
    }
    const recentDecisions = context.blackboard.recentDecisions;
    if (recentDecisions.length > 0) {
      lines.push(`Recent decisions on blackboard: ${recentDecisions.length}`);
    }
    const sessionHistory = this.conversationContext.get(context.task.sessionId) ?? [];
    if (sessionHistory.length > 1) {
      lines.push(`Conversation turns in session: ${sessionHistory.length}`);
    }
    lines.push("");
    lines.push(`Routing task "${context.task.description.substring(0, 100)}${context.task.description.length > 100 ? "..." : ""}" via mind module.`);
    return lines.join("\n");
  }
  // ---------------------------------------------------------------------------
  // Conversation context access (for testing / external consumers)
  // ---------------------------------------------------------------------------
  getConversationHistory(sessionId) {
    return this.conversationContext.get(sessionId) ?? [];
  }
  clearConversationHistory(sessionId) {
    this.conversationContext.delete(sessionId);
  }
}
class GuardModule {
  name = "guard";
  rules = [];
  failureTracker = /* @__PURE__ */ new Map();
  // taskId -> failure count
  constructor() {
    this.registerDefaultRules();
  }
  canHandle(_context) {
    return true;
  }
  async execute(context, emit) {
    const results = this.rules.map((rule) => ({
      rule: rule.name,
      ...rule.check(context)
    }));
    const blocked = results.filter((r) => !r.allowed && r.severity === "block");
    const warnings = results.filter((r) => !r.allowed && r.severity === "warning");
    if (blocked.length > 0) {
      emit({
        type: "guard_triggered",
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: {
          blocked: blocked.map((b) => ({ rule: b.rule, reason: b.reason }))
        }
      });
      return {
        success: false,
        error: `Blocked by guard: ${blocked.map((b) => b.reason).join("; ")}`
      };
    }
    if (warnings.length > 0) {
      emit({
        type: "guard_triggered",
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: {
          warnings: warnings.map((w) => ({ rule: w.rule, reason: w.reason }))
        }
      });
    }
    return { success: true };
  }
  // ---------------------------------------------------------------------------
  // Rule management
  // ---------------------------------------------------------------------------
  registerRule(rule) {
    this.rules.push(rule);
  }
  // ---------------------------------------------------------------------------
  // Failure / loop tracking
  // ---------------------------------------------------------------------------
  /**
   * Record a failure for the given task ID.
   * @returns The new failure count after recording.
   */
  recordFailure(taskId) {
    const count = (this.failureTracker.get(taskId) ?? 0) + 1;
    this.failureTracker.set(taskId, count);
    return count;
  }
  /**
   * Returns true when the task has accumulated failures at or above the threshold.
   */
  isLooping(taskId, threshold = 3) {
    return (this.failureTracker.get(taskId) ?? 0) >= threshold;
  }
  /**
   * Clears the failure record for a task (e.g. after successful completion).
   */
  clearFailures(taskId) {
    this.failureTracker.delete(taskId);
  }
  // ---------------------------------------------------------------------------
  // Built-in rules
  // ---------------------------------------------------------------------------
  registerDefaultRules() {
    this.registerRule({
      name: "destructive_operation",
      description: "Blocks potentially destructive operations without explicit confirmation",
      check(context) {
        const desc = context.task.description.toLowerCase();
        const destructivePatterns = [
          "rm -rf",
          "drop table",
          "delete from",
          "git push --force",
          "git reset --hard"
        ];
        const matched = destructivePatterns.find((p) => desc.includes(p));
        if (matched) {
          return {
            allowed: false,
            reason: `Destructive operation detected: "${matched}"`,
            severity: "block"
          };
        }
        return { allowed: true, severity: "info" };
      }
    });
    this.registerRule({
      name: "production_target",
      description: "Warns when task targets production systems",
      check(context) {
        const desc = context.task.description.toLowerCase();
        if (desc.includes("production") || desc.includes(" prod ") || desc.includes("prod.")) {
          return {
            allowed: false,
            reason: "Task targets production",
            severity: "warning"
          };
        }
        return { allowed: true, severity: "info" };
      }
    });
    this.registerRule({
      name: "loop_detection",
      description: "Blocks tasks that have failed 3+ times",
      check: (context) => {
        if (this.isLooping(context.task.id)) {
          return {
            allowed: false,
            reason: `Loop detected: task "${context.task.id}" has failed 3+ times`,
            severity: "block"
          };
        }
        return { allowed: true, severity: "info" };
      }
    });
  }
}
const APPROVAL_SIGNALS = [
  "delete",
  "remove",
  "drop",
  "destroy",
  "truncate",
  "production",
  "prod",
  "deploy",
  "release",
  "publish",
  "force",
  "--force",
  "overwrite",
  "migrate database",
  "credentials",
  "secret",
  "api key"
];
const DOMAIN_SIGNALS = {
  analysis: ["analyze", "research", "investigate", "understand", "review", "check", "audit"],
  code: ["implement", "write", "create", "refactor", "build", "add", "update code", "edit"],
  ops: ["run", "execute", "deploy", "install", "migrate", "configure", "start", "stop"],
  review: ["test", "verify", "validate", "ensure", "confirm", "check output", "review result"],
  approval: ["approve", "confirm", "authorize", "permission"]
};
const DOMAIN_MODELS = {
  analysis: "planning",
  code: "execution",
  ops: "execution",
  review: "review",
  approval: "planning"
};
class PlannerModule {
  name = "planner";
  canHandle(context) {
    const words = context.task.description.split(/\s+/).length;
    const lower = context.task.description.toLowerCase();
    const hasPlanningSignal = ["plan", "steps", "implement", "build", "create", "design", "refactor"].some((s) => lower.includes(s));
    return words > 15 || hasPlanningSignal;
  }
  async execute(context, emit) {
    const { task } = context;
    emit({
      type: "module_activated",
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: { module: this.name, taskId: task.id }
    });
    const decomposed = this.decompose(task.description, task.id);
    emit({
      type: "plan_generated",
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: {
        taskId: task.id,
        planId: decomposed.plan.id,
        stepCount: decomposed.plan.steps.length,
        estimatedComplexity: decomposed.estimatedTotalComplexity,
        steps: decomposed.richSteps.map((s) => ({
          index: s.index,
          description: s.description,
          domain: s.domain,
          model: s.model,
          requiresApproval: s.requiresApproval,
          estimatedComplexity: s.estimatedComplexity,
          dependsOn: s.dependsOn,
          acceptanceCriteria: s.acceptanceCriteria
        }))
      }
    });
    const planJson = JSON.stringify(decomposed.plan, null, 2);
    return {
      success: true,
      output: this.formatPlanSummary(decomposed),
      artifacts: [
        { type: "plan", path: "", content: planJson },
        {
          type: "rich_plan",
          path: "",
          content: JSON.stringify(decomposed.richSteps, null, 2)
        }
      ]
    };
  }
  // ---------------------------------------------------------------------------
  // Public decomposition API
  // ---------------------------------------------------------------------------
  /**
   * Decompose a task description into an ordered set of rich plan steps.
   */
  decompose(description, taskId) {
    const rawSteps = this.extractSteps(description);
    const richSteps = this.enrichSteps(rawSteps);
    const totalComplexity = this.estimateTotalComplexity(richSteps);
    const planSteps = richSteps.map((s) => ({
      index: s.index,
      description: s.description,
      status: "pending",
      model: s.model,
      requiresApproval: s.requiresApproval,
      files: []
    }));
    const plan = {
      id: `plan-${randomUUID().substring(0, 8)}`,
      taskId,
      steps: planSteps,
      status: "pending",
      currentStep: 0,
      createdAt: Date.now()
    };
    return { plan, richSteps, estimatedTotalComplexity: totalComplexity };
  }
  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  /**
   * Extract a list of step descriptions from the task.
   *
   * Strategy (in order of preference):
   *  1. Explicit numbered list (1. ... 2. ...)
   *  2. Sentence-by-sentence split for medium+ tasks
   *  3. Single step for short tasks
   */
  extractSteps(description) {
    const numberedMatch = description.match(/\d+\.\s+[^\n]+/g);
    if (numberedMatch && numberedMatch.length > 1) {
      return numberedMatch.map((s) => s.replace(/^\d+\.\s+/, "").trim());
    }
    const bulletMatch = description.match(/[-•]\s+[^\n]+/g);
    if (bulletMatch && bulletMatch.length > 1) {
      return bulletMatch.map((s) => s.replace(/^[-•]\s+/, "").trim());
    }
    const sentences = description.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 5);
    if (sentences.length > 1) {
      const grouped = [];
      let current = "";
      for (const sentence of sentences) {
        current += (current ? " " : "") + sentence;
        if (current.split(/\s+/).length >= 8) {
          grouped.push(current);
          current = "";
        }
      }
      if (current) grouped.push(current);
      if (grouped.length > 1) return grouped;
    }
    return [description.trim()];
  }
  enrichSteps(rawSteps) {
    const steps = rawSteps.map((desc, index) => {
      const domain = this.classifyDomain(desc);
      const requiresApproval2 = this.needsApproval(desc);
      const estimatedComplexity = this.estimateStepComplexity(desc);
      const dependsOn = index > 0 ? [index - 1] : [];
      return {
        index,
        description: desc,
        status: "pending",
        domain,
        model: DOMAIN_MODELS[domain],
        requiresApproval: requiresApproval2,
        files: [],
        acceptanceCriteria: this.generateAcceptanceCriteria(desc, domain),
        estimatedComplexity,
        dependsOn
      };
    });
    if (steps.length > 2) {
      const analysisStep = {
        index: 0,
        description: `Analyze requirements and context for: "${rawSteps[0]?.substring(0, 80) ?? "task"}"`,
        status: "pending",
        domain: "analysis",
        model: "planning",
        requiresApproval: false,
        files: [],
        acceptanceCriteria: ["Requirements clearly understood", "Context and constraints identified"],
        estimatedComplexity: "low",
        dependsOn: []
      };
      const reindexed = steps.map((s) => ({
        ...s,
        index: s.index + 1,
        dependsOn: s.dependsOn.map((d) => d + 1)
      }));
      reindexed[0].dependsOn = [0];
      const reviewStep = {
        index: reindexed.length + 1,
        description: "Review outputs, verify acceptance criteria, and confirm task completion",
        status: "pending",
        domain: "review",
        model: "review",
        requiresApproval: false,
        files: [],
        acceptanceCriteria: ["All prior steps verified", "Output matches original intent"],
        estimatedComplexity: "low",
        dependsOn: [reindexed.length]
      };
      return [analysisStep, ...reindexed, reviewStep];
    }
    return steps;
  }
  classifyDomain(description) {
    const lower = description.toLowerCase();
    let best = "code";
    let bestScore = 0;
    for (const [domain, signals] of Object.entries(DOMAIN_SIGNALS)) {
      const score = signals.filter((s) => lower.includes(s)).length;
      if (score > bestScore) {
        bestScore = score;
        best = domain;
      }
    }
    return best;
  }
  needsApproval(description) {
    const lower = description.toLowerCase();
    return APPROVAL_SIGNALS.some((signal) => lower.includes(signal));
  }
  estimateStepComplexity(description) {
    const words = description.split(/\s+/).length;
    if (words < 8) return "trivial";
    if (words < 20) return "low";
    if (words < 50) return "medium";
    return "high";
  }
  estimateTotalComplexity(steps) {
    const weights = { trivial: 0, low: 1, medium: 2, high: 4 };
    const total = steps.reduce((sum, s) => sum + weights[s.estimatedComplexity], 0);
    if (total <= 1) return "trivial";
    if (total <= 4) return "low";
    if (total <= 10) return "medium";
    return "high";
  }
  generateAcceptanceCriteria(description, domain) {
    const criteria = [];
    const lower = description.toLowerCase();
    switch (domain) {
      case "code":
        criteria.push("Code is syntactically valid and type-checked");
        if (lower.includes("test")) criteria.push("Tests pass");
        if (lower.includes("function") || lower.includes("method")) {
          criteria.push("Function behaves as specified");
        }
        break;
      case "ops":
        criteria.push("Command exits with code 0");
        criteria.push("Expected side effects confirmed");
        break;
      case "analysis":
        criteria.push("Analysis documented with key findings");
        criteria.push("Constraints and dependencies identified");
        break;
      case "review":
        criteria.push("Output reviewed against original requirements");
        criteria.push("Edge cases considered");
        break;
      case "approval":
        criteria.push("Human approval obtained before proceeding");
        break;
    }
    criteria.push("Step output is non-empty and coherent");
    return criteria;
  }
  formatPlanSummary(decomposed) {
    const { plan, richSteps, estimatedTotalComplexity } = decomposed;
    const lines = [
      `Plan ${plan.id} — ${richSteps.length} steps (estimated complexity: ${estimatedTotalComplexity})`,
      ""
    ];
    for (const step of richSteps) {
      const approval = step.requiresApproval ? " [APPROVAL REQUIRED]" : "";
      lines.push(`  ${step.index + 1}. [${step.domain}/${step.model}]${approval}`);
      lines.push(`     ${step.description.substring(0, 120)}`);
      if (step.dependsOn.length > 0) {
        lines.push(`     Depends on: step(s) ${step.dependsOn.map((d) => d + 1).join(", ")}`);
      }
    }
    return lines.join("\n");
  }
}
const DANGEROUS_TOOL_NAMES = [
  "bash",
  "shell",
  "exec",
  "execute",
  "run_command",
  "system",
  "eval",
  "subprocess",
  "spawn",
  "popen"
];
const DESTRUCTIVE_ARG_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brmdir\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\bformat\b.*\b(disk|drive|volume)\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  />\s*\/dev\/(sda|hda|vda|nvme)/i,
  /\bchmod\s+777\b/i,
  /\bchown\s+-R\s+/i,
  /\bkill\s+-9\s+-1\b/i,
  /\bsudo\s+rm\b/i,
  /\bsudo\s+dd\b/i
];
const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*\S+/i,
  /(?:token|auth[_-]?token|access[_-]?token)\s*[:=]\s*\S+/i,
  /(?:private[_-]?key|priv[_-]?key)\s*[:=]\s*\S+/i,
  /(?:aws[_-]?secret|aws[_-]?access)\s*[:=]\s*\S+/i,
  /(?:AKIA[0-9A-Z]{16})/,
  // AWS access key ID pattern
  /(?:ghp_[a-zA-Z0-9]{36})/,
  // GitHub personal access token
  /(?:sk-[a-zA-Z0-9]{48})/,
  // OpenAI API key
  /(?:xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24})/,
  // Slack bot token
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/
];
function isToolNameDangerous(toolName) {
  const lower = toolName.toLowerCase();
  return DANGEROUS_TOOL_NAMES.some((name) => lower.includes(name));
}
function containsDestructivePattern(text) {
  for (const pattern of DESTRUCTIVE_ARG_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.toString();
    }
  }
  return null;
}
function containsSecretPattern(text) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.toString();
    }
  }
  return null;
}
function argsToString(args) {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}
function registerGuardHook(eventBus, store) {
  eventBus.on("tool_invoked", (event) => {
    const toolName = event.data.toolName ?? event.data.name ?? "";
    const toolArgs = event.data.arguments ?? event.data.args ?? {};
    const argsStr = argsToString(toolArgs);
    const violations = [];
    if (isToolNameDangerous(toolName)) {
      violations.push(`Dangerous tool name detected: "${toolName}"`);
    }
    const destructiveMatch = containsDestructivePattern(argsStr);
    if (destructiveMatch) {
      violations.push(`Destructive operation pattern detected in arguments`);
    }
    const secretMatch = containsSecretPattern(argsStr);
    if (secretMatch) {
      violations.push(`Potential secret or credential detected in tool arguments`);
    }
    if (violations.length === 0) return;
    const guardEvent = {
      type: "guard_triggered",
      timestamp: Date.now(),
      sessionId: event.sessionId,
      data: {
        toolName,
        violations,
        blockedEventTimestamp: event.timestamp
      }
    };
    store.logEvent(guardEvent);
    eventBus.emit("guard_triggered", {
      toolName,
      violations,
      blockedEventTimestamp: event.timestamp
    });
    console.warn(
      `[GuardHook] Blocked tool "${toolName}": ${violations.join("; ")}`
    );
  });
}
function formatDuration(startMs, endMs) {
  const ms = endMs - startMs;
  if (ms < 1e3) return `${ms}ms`;
  if (ms < 6e4) return `${(ms / 1e3).toFixed(1)}s`;
  return `${Math.floor(ms / 6e4)}m ${Math.floor(ms % 6e4 / 1e3)}s`;
}
function registerAutoLogHook(eventBus, store) {
  eventBus.on("task_completed", (event) => {
    const {
      taskId,
      description,
      outcome,
      startedAt,
      result,
      error
    } = event.data;
    const endedAt = event.timestamp;
    const duration = typeof startedAt === "number" ? formatDuration(startedAt, endedAt) : "unknown";
    const logEntry = {
      type: "daily_log",
      timestamp: endedAt,
      sessionId: event.sessionId,
      data: {
        category: "task",
        taskId: taskId ?? null,
        description: description ?? "(no description)",
        outcome: outcome ?? "completed",
        duration,
        result: result ?? null,
        error: error ?? null,
        loggedAt: new Date(endedAt).toISOString()
      }
    };
    store.logEvent(logEntry);
    console.log(
      `[AutoLogHook] Task completed — id=${taskId ?? "unknown"} outcome=${outcome ?? "completed"} duration=${duration}`
    );
  });
  eventBus.on("step_completed", (event) => {
    const {
      taskId,
      stepIndex,
      description,
      model,
      startedAt,
      result
    } = event.data;
    const endedAt = event.timestamp;
    const duration = typeof startedAt === "number" ? formatDuration(startedAt, endedAt) : "unknown";
    const logEntry = {
      type: "daily_log",
      timestamp: endedAt,
      sessionId: event.sessionId,
      data: {
        category: "step",
        taskId: taskId ?? null,
        stepIndex: stepIndex ?? null,
        description: description ?? "(no description)",
        model: model ?? null,
        duration,
        result: result ?? null,
        loggedAt: new Date(endedAt).toISOString()
      }
    };
    store.logEvent(logEntry);
  });
}
const ERROR_ESCALATION_THRESHOLD = 3;
const MAX_PATTERN_COUNT = 5;
const STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "hello",
  "how",
  "i",
  "in",
  "is",
  "it",
  "machine",
  "my",
  "of",
  "on",
  "or",
  "please",
  "the",
  "this",
  "to",
  "update",
  "with",
  "write",
  "you",
  "your"
]);
const FORMAT_WORDS = /* @__PURE__ */ new Set([
  "markdown",
  "json",
  "bullet",
  "bullets",
  "brief",
  "concise",
  "detailed",
  "verbose",
  "short",
  "steps"
]);
const PROJECT_QUALIFIERS = /* @__PURE__ */ new Set([
  "app",
  "repo",
  "service",
  "module",
  "project",
  "workflow",
  "dashboard",
  "agent"
]);
function normalizeTaskType(description) {
  if (!description) return "unknown";
  return description.toLowerCase().replace(/\b(?:in|as|with)\s+(markdown|json|bullet|bullets|brief|concise|detailed|verbose|short|steps)\b/g, " ").replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).filter((word) => !FORMAT_WORDS.has(word)).slice(0, 4).join("_");
}
function normalizeErrorType(message) {
  if (!message) return "unknown_error";
  return message.toLowerCase().replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, "<uuid>").replace(/\/[^\s]+/g, "<path>").replace(/\d+/g, "<n>").replace(/[^a-z\s<>_]/g, "").trim().split(/\s+/).slice(0, 6).join("_");
}
function extractTopics(description) {
  if (!description) return [];
  const tokens = description.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  return Array.from(new Set(tokens)).slice(0, 3);
}
function isDirectResponseTask(description) {
  if (!description) return false;
  const normalized = description.trim().toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 6 || /^(hi|hello|hey|help|thanks|thank you|who are you|what can you do)\b/.test(normalized);
}
function inferPreferredName(description) {
  if (!description) return null;
  const match = description.match(/\b(?:call me|my name is|i am|i'm)\s+([a-z][a-z'-]{1,24})\b/i);
  if (!match?.[1]) return null;
  const token = match[1].toLowerCase();
  if (STOP_WORDS.has(token)) return null;
  return token.charAt(0).toUpperCase() + token.slice(1);
}
function extractOutputPreferences(description) {
  if (!description) return [];
  const normalized = description.toLowerCase();
  const preferences = [];
  if (normalized.includes("markdown") || normalized.includes(".md")) preferences.push("markdown");
  if (normalized.includes("json")) preferences.push("json");
  if (normalized.includes("bullet") || normalized.includes("bullets")) preferences.push("bullets");
  if (normalized.includes("step by step") || normalized.includes("steps")) preferences.push("steps");
  if (normalized.includes("short") || normalized.includes("brief") || normalized.includes("concise")) preferences.push("concise");
  if (normalized.includes("verbose") || normalized.includes("detailed")) preferences.push("detailed");
  return preferences;
}
function extractProjects(description) {
  if (!description) return [];
  const normalized = description.toLowerCase();
  const labels = /* @__PURE__ */ new Set();
  for (const match of normalized.matchAll(/\b([a-z0-9_-]{3,})\s+(app|repo|service|module|project|workflow|dashboard|agent)\b/g)) {
    const [, name, qualifier] = match;
    if (name && qualifier && !STOP_WORDS.has(name) && PROJECT_QUALIFIERS.has(qualifier)) {
      labels.add(`${name} ${qualifier}`);
    }
  }
  for (const match of normalized.matchAll(/\b(app|repo|service|module|project|workflow|dashboard|agent)\s+([a-z0-9_-]{3,})\b/g)) {
    const [, qualifier, name] = match;
    if (name && qualifier && !STOP_WORDS.has(name) && PROJECT_QUALIFIERS.has(qualifier)) {
      labels.add(`${name} ${qualifier}`);
    }
  }
  return Array.from(labels).slice(0, 3);
}
function upsertPattern(items, label, limit = MAX_PATTERN_COUNT) {
  if (!label) return;
  const existing = items.find((item) => item.label === label);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = Date.now();
  } else {
    items.push({ label, count: 1, lastSeen: Date.now() });
  }
  items.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeen - a.lastSeen;
  });
  if (items.length > limit) items.splice(limit);
}
function refreshApprovalPreference(profile) {
  const { requestedCount, modifiedCount, autoApprovedCount } = profile.approvalHistory;
  if (modifiedCount > 0 && modifiedCount >= autoApprovedCount) {
    profile.approvalPreference = "hands_on";
    return;
  }
  if (autoApprovedCount >= 2 && modifiedCount === 0) {
    profile.approvalPreference = "streamlined";
    return;
  }
  if (requestedCount === 0 && autoApprovedCount > 0) {
    profile.approvalPreference = "streamlined";
    return;
  }
  profile.approvalPreference = "mixed";
}
function registerLearningCaptureHook(eventBus, store, blackboard) {
  eventBus.on("task_submitted", (event) => {
    const { task } = event.data;
    const description = task?.description;
    blackboard.updateUserProfile((profile) => {
      const preferredName = inferPreferredName(description);
      if (preferredName) {
        profile.preferredName = preferredName;
      }
      for (const format of extractOutputPreferences(description)) {
        upsertPattern(profile.preferredOutputFormats, format);
      }
      for (const project of extractProjects(description)) {
        upsertPattern(profile.activeProjects, project);
      }
    });
  });
  eventBus.on("error", (event) => {
    const {
      taskId,
      taskDescription,
      message,
      code,
      phase
    } = event.data;
    const taskType = normalizeTaskType(taskDescription);
    const errorType = normalizeErrorType(message);
    const lesson = message ? `Error in ${phase ?? "unknown phase"}: ${message}` : "An unspecified error occurred";
    blackboard.writeExperience({
      taskType,
      outcome: "failure",
      lessons: [lesson],
      tags: [
        "error",
        errorType,
        ...phase ? [phase] : [],
        ...code != null ? [`code_${code}`] : []
      ]
    });
    const allFailures = store.getExperiences({ taskType });
    const matchingFailures = allFailures.filter(
      (exp) => exp.outcome === "failure" && exp.tags.includes(errorType)
    );
    if (matchingFailures.length >= ERROR_ESCALATION_THRESHOLD) {
      const constraint = `Recurring error [${errorType}] — ${matchingFailures.length} occurrences. Review handling for task type: ${taskType}`;
      blackboard.addConstraint(constraint);
      blackboard.addDecision(
        `Escalated recurring error to constraint`,
        `Error type "${errorType}" occurred ${matchingFailures.length} times in task type "${taskType}"`
      );
      console.warn(
        `[LearningCaptureHook] Escalated error pattern to constraint: ${errorType} (${matchingFailures.length} occurrences)`
      );
    }
    console.log(
      `[LearningCaptureHook] Recorded failure experience — taskId=${taskId ?? "unknown"} errorType=${errorType}`
    );
  });
  eventBus.on("task_completed", (event) => {
    const {
      taskId,
      description,
      outcome,
      tags: rawTags
    } = event.data;
    if (outcome && outcome !== "success" && outcome !== "completed") return;
    const taskType = normalizeTaskType(description);
    const existing = store.getExperiences({ taskType });
    if (existing.length === 0) {
      const lesson = description ? `Successfully completed: ${description}` : "Task completed successfully";
      blackboard.writeExperience({
        taskType,
        outcome: "success",
        lessons: [lesson],
        tags: [
          "novel_task",
          ...Array.isArray(rawTags) ? rawTags : []
        ]
      });
      blackboard.addDecision(
        `Recorded novel task type: ${taskType}`,
        `First successful completion of this task category — captured as learning experience`
      );
      console.log(
        `[LearningCaptureHook] Novel task type captured — taskId=${taskId ?? "unknown"} taskType=${taskType}`
      );
    }
    blackboard.updateUserProfile((profile) => {
      if (isDirectResponseTask(description)) {
        profile.responseStyle = "direct";
      }
      const preferredName = inferPreferredName(description);
      if (preferredName) {
        profile.preferredName = preferredName;
      }
      upsertPattern(profile.commonTaskTypes, taskType);
      for (const topic of extractTopics(description)) {
        upsertPattern(profile.topicInterests, topic);
      }
      for (const format of extractOutputPreferences(description)) {
        upsertPattern(profile.preferredOutputFormats, format);
      }
      for (const project of extractProjects(description)) {
        upsertPattern(profile.activeProjects, project);
      }
    });
  });
  eventBus.on("step_completed", (event) => {
    const {
      description,
      model
    } = event.data;
    blackboard.updateUserProfile((profile) => {
      upsertPattern(profile.workflowPatterns, normalizeTaskType(description));
      upsertPattern(profile.modelPreferences, model);
      for (const topic of extractTopics(description)) {
        upsertPattern(profile.topicInterests, topic);
      }
    });
  });
  eventBus.on("approval_requested", () => {
    blackboard.updateUserProfile((profile) => {
      profile.approvalHistory.requestedCount += 1;
      refreshApprovalPreference(profile);
    });
  });
  eventBus.on("plan_approved", (event) => {
    const { autoApproved } = event.data;
    blackboard.updateUserProfile((profile) => {
      profile.approvalHistory.approvedCount += 1;
      if (autoApproved) {
        profile.approvalHistory.autoApprovedCount += 1;
      }
      refreshApprovalPreference(profile);
    });
  });
  eventBus.on("plan_modified", () => {
    blackboard.updateUserProfile((profile) => {
      profile.approvalHistory.modifiedCount += 1;
      refreshApprovalPreference(profile);
    });
  });
}
function buildSessionSummary(sessionId, store, blackboard, endedAt) {
  const session = store.getSession(sessionId);
  const startedAt = session?.startedAt ?? endedAt;
  const allEvents = store.getEvents(sessionId, 0);
  const tasksCompleted = allEvents.filter((e) => e.type === "task_completed").length;
  const tasksFailed = allEvents.filter(
    (e) => e.type === "error" && (e.data.phase === "execution" || e.data.phase === "task")
  ).length;
  const stepsCompleted = allEvents.filter((e) => e.type === "step_completed").length;
  const ctx = blackboard.getContext();
  const experiencesRecorded = store.getExperiences({ limit: 9999 }).length;
  const decisionsRecorded = ctx.recentDecisions.length;
  const activeConstraints = ctx.activeConstraints;
  return {
    sessionId,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    tasksCompleted,
    tasksFailed,
    stepsCompleted,
    experiencesRecorded,
    decisionsRecorded,
    activeConstraints
  };
}
function registerSessionEndHook(eventBus, store, blackboard) {
  eventBus.on("session_end", (event) => {
    const endedAt = event.timestamp;
    const sessionId = event.sessionId;
    executeSessionEnd(sessionId, store, blackboard, endedAt);
  });
  let shutdownHandled = false;
  function handleShutdown(signal) {
    if (shutdownHandled) return;
    shutdownHandled = true;
    const endedAt = Date.now();
    const recentEvents = eventBus.getEventLog();
    if (recentEvents.length === 0) return;
    const sessionId = recentEvents[0].sessionId;
    console.log(`[SessionEndHook] ${signal} received — saving session state for ${sessionId}`);
    executeSessionEnd(sessionId, store, blackboard, endedAt);
  }
  if (process.env.NODE_ENV !== "test") {
    process.once("SIGTERM", () => handleShutdown("SIGTERM"));
    process.once("SIGINT", () => handleShutdown("SIGINT"));
  }
}
function executeSessionEnd(sessionId, store, blackboard, endedAt = Date.now()) {
  const summary = buildSessionSummary(sessionId, store, blackboard, endedAt);
  const endEvent = {
    type: "session_end",
    timestamp: endedAt,
    sessionId,
    data: {
      ...summary
    }
  };
  store.logEvent(endEvent);
  store.updateSession(sessionId, {
    status: "completed",
    lastUpdated: endedAt
  });
  blackboard.updateSessionMetadata({ lastUpdated: endedAt });
  console.log(
    `[SessionEndHook] Session ended — id=${sessionId} tasks=${summary.tasksCompleted} experiences=${summary.experiencesRecorded} duration=${summary.durationMs}ms`
  );
  return summary;
}
const AUTO_APPROVE_MAX_STEPS = 2;
const AUTO_APPROVE_MAX_DESCRIPTION_WORDS = 50;
function validatePlan(plan) {
  const errors = [];
  if (!plan.steps || !Array.isArray(plan.steps)) {
    errors.push("Plan has no steps array");
    return { valid: false, errors };
  }
  if (plan.steps.length === 0) {
    errors.push("Plan has zero steps");
  }
  plan.steps.forEach((step, idx) => {
    if (!step.description || step.description.trim().length === 0) {
      errors.push(`Step ${idx} has an empty description`);
    }
  });
  return { valid: errors.length === 0, errors };
}
function classifyComplexity(plan) {
  const stepCount = plan.steps?.length ?? 0;
  if (stepCount <= 1) return "micro";
  if (stepCount <= 2) return "small";
  if (stepCount <= 5) return "medium";
  if (stepCount <= 10) return "large";
  return "epic";
}
function totalDescriptionWords(plan) {
  return (plan.steps ?? []).reduce((acc, step) => {
    const words = (step.description ?? "").trim().split(/\s+/).filter(Boolean).length;
    return acc + words;
  }, 0);
}
function requiresApproval(plan) {
  return (plan.steps ?? []).some((step) => step.requiresApproval === true);
}
function registerPlanGateHook(eventBus) {
  eventBus.on("plan_generated", (event) => {
    const plan = event.data.plan;
    if (!plan) {
      console.warn("[PlanGateHook] plan_generated event received with no plan payload");
      return;
    }
    const validation = validatePlan(plan);
    if (!validation.valid) {
      console.warn(
        `[PlanGateHook] Invalid plan "${plan.id}": ${validation.errors.join("; ")}`
      );
      eventBus.emit("guard_triggered", {
        context: "plan_gate",
        planId: plan.id,
        violations: validation.errors
      });
      return;
    }
    const complexity = classifyComplexity(plan);
    const wordCount = totalDescriptionWords(plan);
    const stepCount = plan.steps.length;
    const hasExplicitApprovalStep = requiresApproval(plan);
    const canAutoApprove = (complexity === "micro" || complexity === "small") && stepCount <= AUTO_APPROVE_MAX_STEPS && wordCount <= AUTO_APPROVE_MAX_DESCRIPTION_WORDS && !hasExplicitApprovalStep;
    if (canAutoApprove) {
      console.log(
        `[PlanGateHook] Auto-approving plan "${plan.id}" — ${stepCount} step(s), complexity=${complexity}`
      );
      eventBus.emit("plan_approved", {
        planId: plan.id,
        taskId: plan.taskId,
        autoApproved: true,
        complexity,
        stepCount
      });
    } else {
      console.log(
        `[PlanGateHook] Plan "${plan.id}" requires manual approval — complexity=${complexity} steps=${stepCount} hasApprovalStep=${hasExplicitApprovalStep}`
      );
      eventBus.emit("approval_requested", {
        planId: plan.id,
        taskId: plan.taskId,
        complexity,
        stepCount,
        reason: hasExplicitApprovalStep ? "Plan contains steps that require explicit approval" : `Plan complexity is "${complexity}" (${stepCount} steps) — manual review required`
      });
    }
  });
}
function registerAllHooks(eventBus, store, blackboard) {
  registerGuardHook(eventBus, store);
  registerAutoLogHook(eventBus, store);
  registerLearningCaptureHook(eventBus, store, blackboard);
  registerSessionEndHook(eventBus, store, blackboard);
  registerPlanGateHook(eventBus);
}
async function startDaemon() {
  const sessionId = `ftm-${Date.now()}`;
  console.log(`[FTM Daemon] Starting... session=${sessionId}`);
  ensureDataDir();
  const eventBus = new FtmEventBus(sessionId);
  const store = new FtmStore(getDbPath());
  const blackboard = new Blackboard(store);
  const registry = new AdapterRegistry();
  const router = new ModelRouter(registry, eventBus, getConfigPath());
  const health = await registry.checkHealth();
  console.log("[FTM Daemon] Adapter health:", Object.fromEntries(health));
  registerAllHooks(eventBus, store, blackboard);
  const ooda = new OodaLoop(eventBus, blackboard, router);
  ooda.registerModule(new GuardModule());
  ooda.registerModule(new PlannerModule());
  ooda.registerModule(new MindModule());
  const config = router.getConfig();
  const server = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
  await server.start(config.daemon.port, config.daemon.host);
  store.createSession(sessionId);
  console.log(`[FTM Daemon] Ready. Session=${sessionId}`);
  return { server, eventBus, store };
}
const isMain = process.argv[1]?.endsWith("start.ts") || process.argv[1]?.endsWith("start.js");
if (isMain) {
  startDaemon().catch((err) => {
    console.error("[FTM Daemon] Fatal:", err);
    process.exit(1);
  });
}
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
let mainWindow = null;
let tray = null;
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 500,
    title: "Feed The Machine",
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname$1, "../ui/index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: "Show FTM", click: () => mainWindow?.show() },
    { label: "Status: Idle", enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]);
  tray.setToolTip("Feed The Machine");
  tray.setContextMenu(contextMenu);
}
ipcMain.handle("open-folder", async () => {
  console.log("[Electron:file-browser] open-folder dialog requested");
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Choose working directory"
  });
  const chosen = result.canceled ? null : result.filePaths[0] ?? null;
  console.log("[Electron:file-browser] open-folder result", {
    canceled: result.canceled,
    chosen
  });
  return chosen;
});
ipcMain.handle("list-directory", async (_event, dirPath) => {
  const startedAt = Date.now();
  console.log("[Electron:file-browser] list-directory start", { dirPath });
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  console.log("[Electron:file-browser] list-directory read complete", {
    dirPath,
    count: entries.length,
    ms: Date.now() - startedAt
  });
  const payload = entries.map((entry) => ({
    name: entry.name,
    path: path.join(dirPath, entry.name),
    kind: entry.isDirectory() ? "directory" : "file"
  })).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  console.log("[Electron:file-browser] list-directory payload ready", {
    dirPath,
    count: payload.length,
    ms: Date.now() - startedAt
  });
  return payload;
});
ipcMain.handle("read-text-file", async (_event, filePath) => {
  const startedAt = Date.now();
  console.log("[Electron:file-browser] read-text-file start", { filePath });
  const stat = fs.statSync(filePath);
  const maxBytes = 2e5;
  if (stat.size > maxBytes) {
    console.log("[Electron:file-browser] read-text-file too-large", {
      filePath,
      size: stat.size,
      ms: Date.now() - startedAt
    });
    return {
      kind: "too_large",
      content: "",
      size: stat.size
    };
  }
  const buffer = fs.readFileSync(filePath);
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  const isBinary = sample.includes(0);
  if (isBinary) {
    console.log("[Electron:file-browser] read-text-file binary", {
      filePath,
      size: stat.size,
      ms: Date.now() - startedAt
    });
    return {
      kind: "binary",
      content: "",
      size: stat.size
    };
  }
  const payload = {
    kind: "text",
    content: buffer.toString("utf8"),
    size: stat.size
  };
  console.log("[Electron:file-browser] read-text-file text", {
    filePath,
    size: stat.size,
    ms: Date.now() - startedAt
  });
  return payload;
});
app.whenReady().then(async () => {
  try {
    await startDaemon();
    console.log("[Electron] Daemon started");
  } catch (err) {
    console.error("[Electron] Failed to start daemon:", err);
  }
  await createWindow();
  try {
    createTray();
  } catch {
    console.log("[Electron] Tray icon skipped (dev mode)");
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
