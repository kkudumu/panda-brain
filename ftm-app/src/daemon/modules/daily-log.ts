import type {
  FtmModule,
  TaskContext,
  ModuleResult,
  FtmEvent,
} from '@shared/types.js';
import type { FtmStore } from '../store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyLogEntry {
  timestamp: number;
  taskId: string;
  sessionId: string;
  description: string;
  outcome: 'success' | 'failure' | 'partial';
  durationMs: number;
  summary: string;
}

export interface DailySummary {
  date: string;          // YYYY-MM-DD
  totalTasks: number;
  successCount: number;
  failureCount: number;
  partialCount: number;
  totalDurationMs: number;
  entries: DailyLogEntry[];
  highlights: string[];
}

// ---------------------------------------------------------------------------
// Trigger signals
// ---------------------------------------------------------------------------

const LOG_QUERY_SIGNALS = [
  'what did i do today', 'today\'s log', 'daily summary', 'show log',
  'what happened', 'activity today', 'session summary', 'end of day',
  'daily report', 'show history', 'what tasks',
];

// ---------------------------------------------------------------------------
// DailyLogModule
// ---------------------------------------------------------------------------

/**
 * DailyLogModule — automatic daily logging of task activity.
 *
 * Responsibilities:
 *   - Accumulate log entries in-memory from task_completed events
 *   - Persist entries to the SQLite store as 'daily_log' events
 *   - Respond to explicit log/summary queries
 *   - Generate end-of-day summaries with highlights
 *   - Provide getLog(date) and getSummary(date) for external consumers
 */
export class DailyLogModule implements FtmModule {
  name = 'daily-log';

  private store: FtmStore | null = null;

  // In-memory accumulator for the current process lifetime
  // Key: YYYY-MM-DD → log entries
  private inMemoryLog: Map<string, DailyLogEntry[]> = new Map();

  // Track task start times: taskId → startedAt ms
  private taskStartTimes: Map<string, number> = new Map();

  /**
   * Inject the store after construction.
   */
  setStore(store: FtmStore): void {
    this.store = store;
  }

  canHandle(context: TaskContext): boolean {
    const lower = context.task.description.toLowerCase();
    return LOG_QUERY_SIGNALS.some((s) => lower.includes(s));
  }

  async execute(context: TaskContext, emit: (event: FtmEvent) => void): Promise<ModuleResult> {
    const { task } = context;

    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: { module: this.name, taskId: task.id },
    });

    const lower = task.description.toLowerCase();

    // Determine the date to query (today by default)
    const dateStr = this.extractDateFromQuery(lower) ?? this.todayStr();

    if (lower.includes('summary') || lower.includes('end of day')) {
      const summary = this.getSummary(dateStr);
      const output = this.formatSummary(summary);
      return { success: true, output };
    }

    // Default: return the raw log for the date
    const entries = this.getLog(dateStr);
    const output = this.formatLog(dateStr, entries);
    return { success: true, output };
  }

  // ---------------------------------------------------------------------------
  // Event listener — called by the daemon or OODA loop on task lifecycle events
  // ---------------------------------------------------------------------------

  /**
   * Record the start time for a task.
   * Should be called when a task transitions to in_progress.
   */
  onTaskStarted(taskId: string): void {
    this.taskStartTimes.set(taskId, Date.now());
  }

  /**
   * Log a completed task.
   * Should be called by the OODA loop or event bus after task_completed fires.
   */
  onTaskCompleted(
    taskId: string,
    sessionId: string,
    description: string,
    outcome: DailyLogEntry['outcome'],
    overrideStartedAt?: number,
  ): void {
    const now = Date.now();
    const startedAt = overrideStartedAt ?? this.taskStartTimes.get(taskId) ?? now;
    const durationMs = now - startedAt;
    this.taskStartTimes.delete(taskId);

    const entry: DailyLogEntry = {
      timestamp:   now,
      taskId,
      sessionId,
      description,
      outcome,
      durationMs,
      summary:     this.generateEntrySummary(description, outcome, durationMs),
    };

    const dateStr = this.dateStr(now);
    const entries = this.inMemoryLog.get(dateStr) ?? [];
    entries.push(entry);
    this.inMemoryLog.set(dateStr, entries);

    // Persist to store
    this.persistEntry(entry);
  }

  // ---------------------------------------------------------------------------
  // Public query API
  // ---------------------------------------------------------------------------

  /**
   * Get all log entries for a given date (YYYY-MM-DD).
   */
  getLog(date: string): DailyLogEntry[] {
    // Merge in-memory entries with persisted entries (deduplicate by taskId)
    const inMem = this.inMemoryLog.get(date) ?? [];

    if (!this.store) return inMem;

    const persisted = this.loadPersistedEntries(date);
    const seen = new Set(inMem.map((e) => e.taskId));
    const merged = [...inMem];

    for (const entry of persisted) {
      if (!seen.has(entry.taskId)) {
        merged.push(entry);
        seen.add(entry.taskId);
      }
    }

    return merged.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Generate a DailySummary for a given date.
   */
  getSummary(date: string): DailySummary {
    const entries = this.getLog(date);

    const successCount = entries.filter((e) => e.outcome === 'success').length;
    const failureCount = entries.filter((e) => e.outcome === 'failure').length;
    const partialCount = entries.filter((e) => e.outcome === 'partial').length;
    const totalDurationMs = entries.reduce((sum, e) => sum + e.durationMs, 0);

    const highlights = this.generateHighlights(entries);

    return {
      date,
      totalTasks: entries.length,
      successCount,
      failureCount,
      partialCount,
      totalDurationMs,
      entries,
      highlights,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private persistEntry(entry: DailyLogEntry): void {
    if (!this.store) return;

    try {
      this.store.logEvent({
        type:      'daily_log',
        timestamp: entry.timestamp,
        sessionId: entry.sessionId,
        data: {
          taskId:      entry.taskId,
          description: entry.description,
          outcome:     entry.outcome,
          durationMs:  entry.durationMs,
          summary:     entry.summary,
          date:        this.dateStr(entry.timestamp),
        },
      });
    } catch {
      // Non-fatal — logging failures should not disrupt task execution
    }
  }

  private loadPersistedEntries(date: string): DailyLogEntry[] {
    if (!this.store) return [];

    try {
      const startOfDay = new Date(date).getTime();
      const endOfDay   = startOfDay + 86_400_000; // +24h

      // Get all daily_log events; filter by date range
      const events = this.store.getEventsByType('daily_log', 1000);

      return events
        .filter((e) => e.timestamp >= startOfDay && e.timestamp < endOfDay)
        .map((e) => ({
          timestamp:   e.timestamp,
          taskId:      String(e.data.taskId ?? ''),
          sessionId:   e.sessionId,
          description: String(e.data.description ?? ''),
          outcome:     (e.data.outcome as DailyLogEntry['outcome']) ?? 'success',
          durationMs:  Number(e.data.durationMs ?? 0),
          summary:     String(e.data.summary ?? ''),
        }));
    } catch {
      return [];
    }
  }

  private generateEntrySummary(
    description: string,
    outcome: DailyLogEntry['outcome'],
    durationMs: number,
  ): string {
    const durationStr = this.formatDuration(durationMs);
    const outcomeStr  = outcome === 'success' ? 'completed' : outcome === 'failure' ? 'failed' : 'partially completed';
    const shortDesc   = description.length > 80
      ? description.substring(0, 77) + '...'
      : description;

    return `${shortDesc} — ${outcomeStr} in ${durationStr}`;
  }

  private generateHighlights(entries: DailyLogEntry[]): string[] {
    const highlights: string[] = [];

    if (entries.length === 0) {
      return ['No tasks recorded today.'];
    }

    highlights.push(`${entries.length} task(s) processed today`);

    const failures = entries.filter((e) => e.outcome === 'failure');
    if (failures.length > 0) {
      highlights.push(`${failures.length} task(s) failed — review needed`);
    }

    const totalMs = entries.reduce((sum, e) => sum + e.durationMs, 0);
    if (totalMs > 0) {
      highlights.push(`Total active time: ${this.formatDuration(totalMs)}`);
    }

    // Find the longest-running task
    const longest = entries.reduce((max, e) => e.durationMs > max.durationMs ? e : max, entries[0]);
    if (longest && longest.durationMs > 5000) {
      highlights.push(`Longest task: "${longest.description.substring(0, 60)}" (${this.formatDuration(longest.durationMs)})`);
    }

    return highlights;
  }

  private formatLog(date: string, entries: DailyLogEntry[]): string {
    if (entries.length === 0) {
      return `No activity logged for ${date}.`;
    }

    const lines: string[] = [`Activity log for ${date} (${entries.length} task(s))`, ''];

    for (const entry of entries) {
      const time = new Date(entry.timestamp).toTimeString().substring(0, 8);
      const icon = entry.outcome === 'success' ? '+' : entry.outcome === 'failure' ? 'x' : '~';
      lines.push(`  [${time}] [${icon}] ${entry.summary}`);
    }

    return lines.join('\n');
  }

  private formatSummary(summary: DailySummary): string {
    const lines: string[] = [
      `Daily Summary — ${summary.date}`,
      '─'.repeat(40),
      `Tasks:    ${summary.totalTasks} total  |  ${summary.successCount} succeeded  |  ${summary.failureCount} failed  |  ${summary.partialCount} partial`,
      `Duration: ${this.formatDuration(summary.totalDurationMs)} total`,
      '',
      'Highlights:',
    ];

    for (const h of summary.highlights) {
      lines.push(`  • ${h}`);
    }

    if (summary.entries.length > 0) {
      lines.push('');
      lines.push('Task Log:');
      for (const entry of summary.entries) {
        const time = new Date(entry.timestamp).toTimeString().substring(0, 8);
        lines.push(`  ${time}  ${entry.summary}`);
      }
    }

    return lines.join('\n');
  }

  private extractDateFromQuery(lower: string): string | null {
    // Match explicit YYYY-MM-DD dates
    const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) return isoMatch[1];

    // Natural language: "yesterday"
    if (lower.includes('yesterday')) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return this.dateStr(d.getTime());
    }

    return null;
  }

  private todayStr(): string {
    return this.dateStr(Date.now());
  }

  private dateStr(ts: number): string {
    return new Date(ts).toISOString().substring(0, 10);
  }

  private formatDuration(ms: number): string {
    if (ms < 1000)   return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}
