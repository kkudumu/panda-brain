import type { FtmEvent } from '@shared/types.js';
import type { FtmEventBus } from '../event-bus.js';
import type { FtmStore } from '../store.js';
import type { Blackboard } from '../blackboard.js';

// ---------------------------------------------------------------------------
// Learning capture hook
// ---------------------------------------------------------------------------
//
// Listens to `error` and `task_completed` events.
//
// On error:
//   - Records a failure experience with the error message as a lesson.
//   - Checks if the same error type has occurred 3+ times; if so, escalates
//     to an active constraint on the blackboard.
//
// On task_completed (success):
//   - Checks if this task type has ever been seen before (novel task).
//   - If novel, records a success experience.
//
// All experiences are written through Blackboard.writeExperience() so they
// go through the correct persistence layer.
// ---------------------------------------------------------------------------

const ERROR_ESCALATION_THRESHOLD = 3;

function normalizeTaskType(description: string | undefined): string {
  if (!description) return 'unknown';
  // Produce a stable, lowercase token from the first few words
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('_');
}

function normalizeErrorType(message: string | undefined): string {
  if (!message) return 'unknown_error';
  // Strip dynamic parts (numbers, paths, UUIDs) to produce a stable key
  return message
    .toLowerCase()
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '<uuid>')
    .replace(/\/[^\s]+/g, '<path>')
    .replace(/\d+/g, '<n>')
    .replace(/[^a-z\s<>_]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('_');
}

export function registerLearningCaptureHook(
  eventBus: FtmEventBus,
  store: FtmStore,
  blackboard: Blackboard
): void {
  // -------------------------------------------------------------------------
  // error → failure experience + optional constraint escalation
  // -------------------------------------------------------------------------
  eventBus.on('error', (event: FtmEvent) => {
    const {
      taskId,
      taskDescription,
      message,
      code,
      phase,
    } = event.data as {
      taskId?: string;
      taskDescription?: string;
      message?: string;
      code?: string | number;
      phase?: string;
    };

    const taskType = normalizeTaskType(taskDescription);
    const errorType = normalizeErrorType(message);
    const lesson = message
      ? `Error in ${phase ?? 'unknown phase'}: ${message}`
      : 'An unspecified error occurred';

    blackboard.writeExperience({
      taskType,
      outcome: 'failure',
      lessons: [lesson],
      tags: [
        'error',
        errorType,
        ...(phase ? [phase] : []),
        ...(code != null ? [`code_${code}`] : []),
      ],
    });

    // Check escalation: count failures for this error type across all experiences
    const allFailures = store.getExperiences({ taskType });
    const matchingFailures = allFailures.filter(
      (exp) => exp.outcome === 'failure' && exp.tags.includes(errorType)
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
      `[LearningCaptureHook] Recorded failure experience — taskId=${taskId ?? 'unknown'} errorType=${errorType}`
    );
  });

  // -------------------------------------------------------------------------
  // task_completed → success experience if novel task type
  // -------------------------------------------------------------------------
  eventBus.on('task_completed', (event: FtmEvent) => {
    const {
      taskId,
      description,
      outcome,
      tags: rawTags,
    } = event.data as {
      taskId?: string;
      description?: string;
      outcome?: string;
      tags?: string[];
    };

    // Only capture successful completions here
    if (outcome && outcome !== 'success' && outcome !== 'completed') return;

    const taskType = normalizeTaskType(description);

    // Check for existing experiences of this task type
    const existing = store.getExperiences({ taskType });

    if (existing.length === 0) {
      // Novel task type — record this as our first successful experience
      const lesson = description
        ? `Successfully completed: ${description}`
        : 'Task completed successfully';

      blackboard.writeExperience({
        taskType,
        outcome: 'success',
        lessons: [lesson],
        tags: [
          'novel_task',
          ...(Array.isArray(rawTags) ? rawTags : []),
        ],
      });

      blackboard.addDecision(
        `Recorded novel task type: ${taskType}`,
        `First successful completion of this task category — captured as learning experience`
      );

      console.log(
        `[LearningCaptureHook] Novel task type captured — taskId=${taskId ?? 'unknown'} taskType=${taskType}`
      );
    }
  });
}
