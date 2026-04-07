import type { FtmEvent } from '@shared/types.js';
import type { FtmEventBus } from '../event-bus.js';
import type { FtmStore } from '../store.js';

// ---------------------------------------------------------------------------
// Auto-log hook
// ---------------------------------------------------------------------------
//
// Listens to `task_completed` events and `step_completed` events.
// For each, it generates a structured log entry stored as a `daily_log`
// event in the events table. This gives a clean, queryable audit trail
// of all work performed during a session.
// ---------------------------------------------------------------------------

function formatDuration(startMs: number, endMs: number): string {
  const ms = endMs - startMs;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function registerAutoLogHook(eventBus: FtmEventBus, store: FtmStore): void {
  // -------------------------------------------------------------------------
  // task_completed → daily_log entry
  // -------------------------------------------------------------------------
  eventBus.on('task_completed', (event: FtmEvent) => {
    const {
      taskId,
      description,
      outcome,
      startedAt,
      result,
      error,
    } = event.data as {
      taskId?: string;
      description?: string;
      outcome?: string;
      startedAt?: number;
      result?: string;
      error?: string;
    };

    const endedAt = event.timestamp;
    const duration =
      typeof startedAt === 'number'
        ? formatDuration(startedAt, endedAt)
        : 'unknown';

    const logEntry: FtmEvent = {
      type: 'daily_log',
      timestamp: endedAt,
      sessionId: event.sessionId,
      data: {
        category: 'task',
        taskId: taskId ?? null,
        description: description ?? '(no description)',
        outcome: outcome ?? 'completed',
        duration,
        result: result ?? null,
        error: error ?? null,
        loggedAt: new Date(endedAt).toISOString(),
      },
    };

    store.logEvent(logEntry);

    console.log(
      `[AutoLogHook] Task completed — id=${taskId ?? 'unknown'} outcome=${outcome ?? 'completed'} duration=${duration}`
    );
  });

  // -------------------------------------------------------------------------
  // step_completed → granular step tracking stored as daily_log
  // -------------------------------------------------------------------------
  eventBus.on('step_completed', (event: FtmEvent) => {
    const {
      taskId,
      stepIndex,
      description,
      model,
      startedAt,
      result,
    } = event.data as {
      taskId?: string;
      stepIndex?: number;
      description?: string;
      model?: string;
      startedAt?: number;
      result?: string;
    };

    const endedAt = event.timestamp;
    const duration =
      typeof startedAt === 'number'
        ? formatDuration(startedAt, endedAt)
        : 'unknown';

    const logEntry: FtmEvent = {
      type: 'daily_log',
      timestamp: endedAt,
      sessionId: event.sessionId,
      data: {
        category: 'step',
        taskId: taskId ?? null,
        stepIndex: stepIndex ?? null,
        description: description ?? '(no description)',
        model: model ?? null,
        duration,
        result: result ?? null,
        loggedAt: new Date(endedAt).toISOString(),
      },
    };

    store.logEvent(logEntry);
  });
}
