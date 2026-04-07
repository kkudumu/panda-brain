import { randomUUID } from 'crypto';
import type {
  FtmModule,
  TaskContext,
  ModuleResult,
  FtmEvent,
  Experience,
} from '@shared/types.js';
import type { Blackboard } from '../blackboard.js';
import type { FtmStore } from '../store.js';

// ---------------------------------------------------------------------------
// Memory command types
// ---------------------------------------------------------------------------

type MemoryCommand = 'remember' | 'recall' | 'search' | 'update_constraints' | 'implicit';

interface ParsedMemoryCommand {
  command: MemoryCommand;
  subject: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Trigger signals
// ---------------------------------------------------------------------------

const REMEMBER_SIGNALS = [
  'remember', 'save this', 'note that', 'keep in mind', 'store',
  'log this', 'record that', 'don\'t forget',
];

const RECALL_SIGNALS = [
  'recall', 'what did we', 'do you remember', 'last time', 'previously',
  'history', 'past work', 'earlier', 'show me what', 'retrieve',
];

const SEARCH_SIGNALS = [
  'search memory', 'find in history', 'look up past', 'any experience with',
  'have we done', 'similar to', 'related to',
];

// ---------------------------------------------------------------------------
// MemoryModule
// ---------------------------------------------------------------------------

/**
 * MemoryModule — manages blackboard read/write operations as a first-class module.
 *
 * Handles:
 *   - Explicit "remember this" commands → writes experience to blackboard
 *   - Explicit "recall" commands → retrieves and formats past experiences
 *   - "Search memory" queries → tag-based experience lookup
 *   - Implicit post-completion saves (called externally after task success)
 *   - Constraint updates based on learned context
 */
export class MemoryModule implements FtmModule {
  name = 'memory';

  private blackboard: Blackboard | null = null;
  private store: FtmStore | null = null;

  /**
   * Inject dependencies after construction.
   * The registry wires these up once the store and blackboard are available.
   */
  setBlackboard(blackboard: Blackboard): void {
    this.blackboard = blackboard;
  }

  setStore(store: FtmStore): void {
    this.store = store;
  }

  canHandle(context: TaskContext): boolean {
    const lower = context.task.description.toLowerCase();
    return (
      REMEMBER_SIGNALS.some((s) => lower.includes(s)) ||
      RECALL_SIGNALS.some((s) => lower.includes(s)) ||
      SEARCH_SIGNALS.some((s) => lower.includes(s))
    );
  }

  async execute(context: TaskContext, emit: (event: FtmEvent) => void): Promise<ModuleResult> {
    const { task } = context;

    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: { module: this.name, taskId: task.id },
    });

    const parsed = this.parseMemoryCommand(task.description);

    switch (parsed.command) {
      case 'remember':
        return this.handleRemember(parsed, context, emit);

      case 'recall':
        return this.handleRecall(parsed, context, emit);

      case 'search':
        return this.handleSearch(parsed, context, emit);

      case 'update_constraints':
        return this.handleUpdateConstraints(parsed, context, emit);

      default:
        return this.handleImplicit(parsed, context, emit);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API for external callers (e.g. OODA loop post-completion hook)
  // ---------------------------------------------------------------------------

  /**
   * Save an experience after a task completes.
   * Called externally (e.g. from the OODA loop or daily-log module) when a
   * task concludes with a known outcome.
   */
  saveExperience(
    taskType: string,
    outcome: Experience['outcome'],
    lessons: string[],
    tags: string[],
  ): Experience {
    const exp: Omit<Experience, 'id' | 'timestamp'> = {
      taskType,
      outcome,
      lessons,
      tags,
    };

    if (this.blackboard) {
      this.blackboard.writeExperience(exp);
    } else if (this.store) {
      const full: Experience = {
        ...exp,
        id:        randomUUID(),
        timestamp: Date.now(),
      };
      this.store.writeExperience(full);
      return full;
    }

    return {
      ...exp,
      id:        randomUUID(),
      timestamp: Date.now(),
    };
  }

  /**
   * Retrieve experiences matching a task type and optional tags.
   */
  retrieveExperiences(taskType: string, tags: string[] = []): Experience[] {
    if (this.blackboard) {
      return this.blackboard.findRelevantExperiences(taskType, tags);
    }
    if (this.store) {
      return this.store.matchExperiences(taskType, tags);
    }
    return [];
  }

  /**
   * Update active constraints on the blackboard.
   */
  updateConstraints(constraints: string[]): void {
    if (this.blackboard) {
      this.blackboard.setConstraints(constraints);
    }
  }

  /**
   * Add a single constraint.
   */
  addConstraint(constraint: string): void {
    if (this.blackboard) {
      this.blackboard.addConstraint(constraint);
    }
  }

  // ---------------------------------------------------------------------------
  // Command handlers
  // ---------------------------------------------------------------------------

  private async handleRemember(
    parsed: ParsedMemoryCommand,
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<ModuleResult> {
    const lessons = this.extractLessons(parsed.subject);
    const exp = this.saveExperience(
      'explicit_memory',
      'success',
      lessons,
      parsed.tags,
    );

    emit({
      type: 'memory_saved',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: {
        taskId:       context.task.id,
        experienceId: exp.id,
        taskType:     exp.taskType,
        lessonCount:  exp.lessons.length,
        tags:         exp.tags,
      },
    });

    return {
      success: true,
      output:  `Saved to memory: ${lessons.join('; ')}`,
      artifacts: [
        {
          type:    'memory_entry',
          path:    `memory:${exp.id}`,
          content: JSON.stringify(exp, null, 2),
        },
      ],
    };
  }

  private async handleRecall(
    parsed: ParsedMemoryCommand,
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<ModuleResult> {
    const taskType = parsed.tags[0] ?? 'general';
    const experiences = this.retrieveExperiences(taskType, parsed.tags);

    emit({
      type: 'memory_retrieved',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: {
        taskId:          context.task.id,
        query:           parsed.subject,
        experienceCount: experiences.length,
      },
    });

    if (experiences.length === 0) {
      return {
        success: true,
        output:  `No experiences found matching "${parsed.subject}"`,
      };
    }

    const output = this.formatExperiences(experiences);
    return {
      success: true,
      output,
      artifacts: [
        {
          type:    'memory_recall',
          path:    `recall:${taskType}`,
          content: JSON.stringify(experiences, null, 2),
        },
      ],
    };
  }

  private async handleSearch(
    parsed: ParsedMemoryCommand,
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<ModuleResult> {
    // Search across all experiences using keyword matching
    const allExperiences = this.store
      ? this.store.getExperiences({ limit: 100 })
      : this.blackboard
        ? this.blackboard.findRelevantExperiences('', [])
        : [];

    const keywords = parsed.subject.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const matched = allExperiences.filter((exp) => {
      const haystack = [
        exp.taskType,
        ...exp.lessons,
        ...exp.tags,
      ].join(' ').toLowerCase();
      return keywords.some((kw) => haystack.includes(kw));
    });

    emit({
      type: 'memory_retrieved',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: {
        taskId:          context.task.id,
        searchQuery:     parsed.subject,
        totalScanned:    allExperiences.length,
        matchCount:      matched.length,
      },
    });

    if (matched.length === 0) {
      return {
        success: true,
        output:  `No memory entries found matching "${parsed.subject}" (searched ${allExperiences.length} entries)`,
      };
    }

    return {
      success: true,
      output:  this.formatExperiences(matched.slice(0, 10)),
      artifacts: [
        {
          type:    'search_results',
          path:    'memory:search',
          content: JSON.stringify(matched.slice(0, 10), null, 2),
        },
      ],
    };
  }

  private async handleUpdateConstraints(
    parsed: ParsedMemoryCommand,
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<ModuleResult> {
    const constraints = this.extractLessons(parsed.subject);
    constraints.forEach((c) => this.addConstraint(c));

    emit({
      type: 'memory_saved',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: {
        taskId:          context.task.id,
        constraintsAdded: constraints,
      },
    });

    return {
      success: true,
      output:  `Added ${constraints.length} constraint(s): ${constraints.join('; ')}`,
    };
  }

  private async handleImplicit(
    parsed: ParsedMemoryCommand,
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<ModuleResult> {
    // Implicit: retrieve context relevant to the current task description
    const tags = this.extractTagsFromDescription(context.task.description);
    const taskType = tags[0] ?? 'general';
    const experiences = this.retrieveExperiences(taskType, tags);

    if (experiences.length > 0) {
      emit({
        type: 'memory_retrieved',
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: {
          taskId:          context.task.id,
          experienceCount: experiences.length,
          implicit:        true,
        },
      });

      return {
        success: true,
        output:  `Retrieved ${experiences.length} relevant experience(s):\n\n${this.formatExperiences(experiences.slice(0, 5))}`,
        artifacts: [
          {
            type:    'memory_context',
            path:    'memory:implicit',
            content: JSON.stringify(experiences.slice(0, 5), null, 2),
          },
        ],
      };
    }

    return {
      success: true,
      output:  'No relevant experiences found in memory for this task.',
    };
  }

  // ---------------------------------------------------------------------------
  // Parsing helpers
  // ---------------------------------------------------------------------------

  private parseMemoryCommand(description: string): ParsedMemoryCommand {
    const lower = description.toLowerCase();

    let command: MemoryCommand = 'implicit';

    if (REMEMBER_SIGNALS.some((s) => lower.includes(s))) {
      command = 'remember';
    } else if (RECALL_SIGNALS.some((s) => lower.includes(s))) {
      command = 'recall';
    } else if (SEARCH_SIGNALS.some((s) => lower.includes(s))) {
      command = 'search';
    } else if (lower.includes('constraint') || lower.includes('rule')) {
      command = 'update_constraints';
    }

    const tags = this.extractTagsFromDescription(description);

    return {
      command,
      subject: description,
      tags,
    };
  }

  private extractTagsFromDescription(description: string): string[] {
    const lower = description.toLowerCase();
    const domainTags: string[] = [];

    const domains = ['typescript', 'javascript', 'python', 'react', 'sql',
      'api', 'backend', 'frontend', 'deploy', 'test', 'debug', 'refactor',
      'database', 'authentication', 'performance', 'security'];

    for (const domain of domains) {
      if (lower.includes(domain)) domainTags.push(domain);
    }

    return domainTags.length > 0 ? domainTags : ['general'];
  }

  private extractLessons(subject: string): string[] {
    // Split on sentence boundaries, bullet points, or semicolons
    const lessons = subject
      .split(/[.;]\s+|[-•]\s+|\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    return lessons.length > 0 ? lessons : [subject.trim()];
  }

  private formatExperiences(experiences: Experience[]): string {
    const lines: string[] = [];

    for (const exp of experiences) {
      lines.push(`[${exp.taskType}] ${exp.outcome.toUpperCase()} — ${new Date(exp.timestamp).toISOString()}`);
      if (exp.lessons.length > 0) {
        lines.push('  Lessons:');
        for (const lesson of exp.lessons) {
          lines.push(`    - ${lesson}`);
        }
      }
      if (exp.tags.length > 0) {
        lines.push(`  Tags: ${exp.tags.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }
}
