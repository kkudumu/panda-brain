import type { FtmEvent } from '@shared/types.js';
import type { FtmEventBus } from '../event-bus.js';
import type { FtmStore } from '../store.js';
import type { Blackboard } from '../blackboard.js';

// ---------------------------------------------------------------------------
// Session-end hook
// ---------------------------------------------------------------------------
//
// Listens to `session_end` (custom) and `task_completed` events:
//
// - On `session_end`: generates a full session summary, persists it as an
//   event, updates the session record with end timestamp and status.
//
// The hook also exposes `triggerSessionEnd()` so the daemon shutdown handler
// can explicitly fire session-end logic without needing to emit the event.
// ---------------------------------------------------------------------------

export interface SessionSummary {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  tasksCompleted: number;
  tasksFailed: number;
  stepsCompleted: number;
  experiencesRecorded: number;
  decisionsRecorded: number;
  activeConstraints: string[];
}

function buildSessionSummary(
  sessionId: string,
  store: FtmStore,
  blackboard: Blackboard,
  endedAt: number
): SessionSummary {
  const session = store.getSession(sessionId);
  const startedAt = session?.startedAt ?? endedAt;

  // Count events from this session
  const allEvents = store.getEvents(sessionId, 0);
  const tasksCompleted = allEvents.filter((e) => e.type === 'task_completed').length;
  const tasksFailed = allEvents.filter(
    (e) => e.type === 'error' && (e.data.phase === 'execution' || e.data.phase === 'task')
  ).length;
  const stepsCompleted = allEvents.filter((e) => e.type === 'step_completed').length;

  // Blackboard state
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
    activeConstraints,
  };
}

export function registerSessionEndHook(
  eventBus: FtmEventBus,
  store: FtmStore,
  blackboard: Blackboard
): void {
  // -------------------------------------------------------------------------
  // session_end event listener
  // -------------------------------------------------------------------------
  eventBus.on('session_end', (event: FtmEvent) => {
    const endedAt = event.timestamp;
    const sessionId = event.sessionId;

    executeSessionEnd(sessionId, store, blackboard, endedAt);
  });

  // -------------------------------------------------------------------------
  // Process SIGTERM / SIGINT at process level for graceful shutdown
  // -------------------------------------------------------------------------
  // Note: these are registered once; if the daemon restarts in the same
  // process (tests), the handlers are idempotent due to the guard below.
  let shutdownHandled = false;

  function handleShutdown(signal: string): void {
    if (shutdownHandled) return;
    shutdownHandled = true;

    // The event bus session ID is embedded in events; we need to find the
    // session from the store. Emit session_end which will trigger the listener.
    const endedAt = Date.now();

    // Find the most recently active session
    const recentEvents = eventBus.getEventLog();
    if (recentEvents.length === 0) return;

    const sessionId = recentEvents[0].sessionId;
    console.log(`[SessionEndHook] ${signal} received — saving session state for ${sessionId}`);
    executeSessionEnd(sessionId, store, blackboard, endedAt);
  }

  // Only attach process listeners outside of test environments to avoid
  // listener accumulation during test runs.
  if (process.env.NODE_ENV !== 'test') {
    process.once('SIGTERM', () => handleShutdown('SIGTERM'));
    process.once('SIGINT', () => handleShutdown('SIGINT'));
  }
}

// ---------------------------------------------------------------------------
// Core logic — separated so it can be called directly in tests
// ---------------------------------------------------------------------------

export function executeSessionEnd(
  sessionId: string,
  store: FtmStore,
  blackboard: Blackboard,
  endedAt: number = Date.now()
): SessionSummary {
  const summary = buildSessionSummary(sessionId, store, blackboard, endedAt);

  // Persist session-end event with summary payload
  const endEvent: FtmEvent = {
    type: 'session_end',
    timestamp: endedAt,
    sessionId,
    data: {
      ...(summary as unknown as Record<string, unknown>),
    },
  };
  store.logEvent(endEvent);

  // Update the session record: mark as completed with end timestamp
  store.updateSession(sessionId, {
    status: 'completed',
    lastUpdated: endedAt,
  });

  // Persist final blackboard state — flush any in-flight decisions
  blackboard.updateSessionMetadata({ lastUpdated: endedAt });

  console.log(
    `[SessionEndHook] Session ended — id=${sessionId} tasks=${summary.tasksCompleted} experiences=${summary.experiencesRecorded} duration=${summary.durationMs}ms`
  );

  return summary;
}
