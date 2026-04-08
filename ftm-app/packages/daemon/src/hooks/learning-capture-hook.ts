import type { FtmEvent } from '../shared/types.js';
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
const MAX_PATTERN_COUNT = 5;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'by', 'do', 'for', 'from', 'hello',
  'how', 'i', 'in', 'is', 'it', 'machine', 'my', 'of', 'on', 'or', 'please',
  'the', 'this', 'to', 'update', 'with', 'write', 'you', 'your'
]);
const FORMAT_WORDS = new Set([
  'markdown', 'json', 'bullet', 'bullets', 'brief', 'concise', 'detailed',
  'verbose', 'short', 'steps'
]);
const PROJECT_QUALIFIERS = new Set([
  'app', 'repo', 'service', 'module', 'project', 'workflow', 'dashboard', 'agent'
]);

function normalizeTaskType(description: string | undefined): string {
  if (!description) return 'unknown';
  // Produce a stable, lowercase token from the first few words
  return description
    .toLowerCase()
    .replace(/\b(?:in|as|with)\s+(markdown|json|bullet|bullets|brief|concise|detailed|verbose|short|steps)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter((word) => !FORMAT_WORDS.has(word))
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

function extractTopics(description: string | undefined): string[] {
  if (!description) return [];

  const tokens = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));

  return Array.from(new Set(tokens)).slice(0, 3);
}

function isDirectResponseTask(description: string | undefined): boolean {
  if (!description) return false;

  const normalized = description.trim().toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);

  return words.length <= 6 || /^(hi|hello|hey|help|thanks|thank you|who are you|what can you do)\b/.test(normalized);
}

function inferPreferredName(description: string | undefined): string | null {
  if (!description) return null;

  const match = description.match(/\b(?:call me|my name is|i am|i'm)\s+([a-z][a-z'-]{1,24})\b/i);
  if (!match?.[1]) return null;

  const token = match[1].toLowerCase();
  if (STOP_WORDS.has(token)) return null;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function extractOutputPreferences(description: string | undefined): string[] {
  if (!description) return [];
  const normalized = description.toLowerCase();
  const preferences: string[] = [];

  if (normalized.includes('markdown') || normalized.includes('.md')) preferences.push('markdown');
  if (normalized.includes('json')) preferences.push('json');
  if (normalized.includes('bullet') || normalized.includes('bullets')) preferences.push('bullets');
  if (normalized.includes('step by step') || normalized.includes('steps')) preferences.push('steps');
  if (normalized.includes('short') || normalized.includes('brief') || normalized.includes('concise')) preferences.push('concise');
  if (normalized.includes('verbose') || normalized.includes('detailed')) preferences.push('detailed');

  return preferences;
}

function extractProjects(description: string | undefined): string[] {
  if (!description) return [];

  const normalized = description.toLowerCase();
  const labels = new Set<string>();

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

function upsertPattern(
  items: Array<{ label: string; count: number; lastSeen: number }>,
  label: string | undefined,
  limit = MAX_PATTERN_COUNT
): void {
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

function refreshApprovalPreference(profile: {
  approvalPreference: 'streamlined' | 'hands_on' | 'mixed';
  approvalHistory: {
    requestedCount: number;
    approvedCount: number;
    modifiedCount: number;
    autoApprovedCount: number;
  };
}): void {
  const { requestedCount, modifiedCount, autoApprovedCount } = profile.approvalHistory;

  if (modifiedCount > 0 && modifiedCount >= autoApprovedCount) {
    profile.approvalPreference = 'hands_on';
    return;
  }

  if (autoApprovedCount >= 2 && modifiedCount === 0) {
    profile.approvalPreference = 'streamlined';
    return;
  }

  if (requestedCount === 0 && autoApprovedCount > 0) {
    profile.approvalPreference = 'streamlined';
    return;
  }

  profile.approvalPreference = 'mixed';
}

export function registerLearningCaptureHook(
  eventBus: FtmEventBus,
  store: FtmStore,
  blackboard: Blackboard
): void {
  eventBus.on('task_submitted', (event: FtmEvent) => {
    const { task } = event.data as {
      task?: { description?: string };
    };

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

    blackboard.updateUserProfile((profile) => {
      if (isDirectResponseTask(description)) {
        profile.responseStyle = 'direct';
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

  // -------------------------------------------------------------------------
  // step_completed → capture workflow habits and model usage
  // -------------------------------------------------------------------------
  eventBus.on('step_completed', (event: FtmEvent) => {
    const {
      description,
      model,
    } = event.data as {
      description?: string;
      model?: string;
    };

    blackboard.updateUserProfile((profile) => {
      upsertPattern(profile.workflowPatterns, normalizeTaskType(description));
      upsertPattern(profile.modelPreferences, model);

      for (const topic of extractTopics(description)) {
        upsertPattern(profile.topicInterests, topic);
      }
    });
  });

  eventBus.on('approval_requested', () => {
    blackboard.updateUserProfile((profile) => {
      profile.approvalHistory.requestedCount += 1;
      refreshApprovalPreference(profile);
    });
  });

  eventBus.on('plan_approved', (event: FtmEvent) => {
    const { autoApproved } = event.data as { autoApproved?: boolean };

    blackboard.updateUserProfile((profile) => {
      profile.approvalHistory.approvedCount += 1;
      if (autoApproved) {
        profile.approvalHistory.autoApprovedCount += 1;
      }
      refreshApprovalPreference(profile);
    });
  });

  eventBus.on('plan_modified', () => {
    blackboard.updateUserProfile((profile) => {
      profile.approvalHistory.modifiedCount += 1;
      refreshApprovalPreference(profile);
    });
  });
}
