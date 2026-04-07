import type {
  FtmModule,
  TaskContext,
  ModuleResult,
  FtmEvent,
  Playbook,
  Task,
} from '../shared/types.js';
import type { FtmStore } from '../store.js';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternGroup {
  taskType: string;
  count: number;
  tasks: Task[];
  commonKeywords: string[];
}

export interface ExtractedPlaybook {
  playbook: Playbook;
  patternGroup: PatternGroup;
  confidence: number;
}

/**
 * CaptureModule — playbook capture from completed task history.
 *
 * Analyses the last N completed tasks, detects repeatable patterns, and
 * extracts generalised playbooks that can be triggered in the future.
 *
 * The store is injected at construction time so recent tasks and playbooks
 * can be read and written without coupling to the blackboard.
 */
export class CaptureModule implements FtmModule {
  name = 'capture';

  private readonly store: FtmStore;
  private readonly historyWindow: number;
  private readonly minPatternCount: number;

  constructor(
    store: FtmStore,
    opts: { historyWindow?: number; minPatternCount?: number } = {},
  ) {
    this.store = store;
    this.historyWindow = opts.historyWindow ?? 10;
    this.minPatternCount = opts.minPatternCount ?? 2;
  }

  // ---------------------------------------------------------------------------
  // FtmModule interface
  // ---------------------------------------------------------------------------

  canHandle(context: TaskContext): boolean {
    const desc = context.task.description.toLowerCase();
    return (
      desc.includes('capture') ||
      desc.includes('save as playbook') ||
      desc.includes('extract routine')
    );
  }

  async execute(
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<ModuleResult> {
    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { module: this.name, taskId: context.task.id },
    });

    // ── Step 1: load recent completed tasks ─────────────────────────────────
    const recentTasks = this.loadRecentCompletedTasks();

    if (recentTasks.length === 0) {
      return {
        success: false,
        error: 'No completed tasks found in history. Execute some tasks first before capturing playbooks.',
      };
    }

    emit({
      type: 'capture_analysing',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { taskCount: recentTasks.length },
    });

    // ── Step 2: detect repeatable patterns ──────────────────────────────────
    const groups = this.detectPatterns(recentTasks);

    const capturable = groups.filter(
      (g) => g.count >= this.minPatternCount,
    );

    if (capturable.length === 0) {
      return {
        success: true,
        output: [
          `Analysed ${recentTasks.length} recent tasks.`,
          `No repeatable patterns found (minimum ${this.minPatternCount} similar tasks required).`,
          'Continue executing tasks and try again once more repetitions accumulate.',
        ].join('\n'),
      };
    }

    // ── Step 3: extract and save playbooks ──────────────────────────────────
    const extracted: ExtractedPlaybook[] = [];

    for (const group of capturable) {
      const result = this.extractPlaybook(group);
      if (result) {
        this.store.savePlaybook(result.playbook);
        extracted.push(result);

        emit({
          type: 'playbook_captured',
          timestamp: Date.now(),
          sessionId: context.task.sessionId,
          data: {
            playbookId: result.playbook.id,
            playbookName: result.playbook.name,
            trigger: result.playbook.trigger,
            stepCount: result.playbook.steps.length,
            confidence: result.confidence,
          },
        });
      }
    }

    // ── Step 4: return summary ───────────────────────────────────────────────
    const output = this.formatOutput(recentTasks.length, extracted);

    return {
      success: true,
      output,
      artifacts: extracted.map(({ playbook }) => ({
        type: 'playbook',
        path: '',
        content: JSON.stringify(playbook, null, 2),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  private loadRecentCompletedTasks(): Task[] {
    const recent = this.store.getRecentTasks(this.historyWindow * 2);
    return recent
      .filter((t) => t.status === 'completed')
      .slice(0, this.historyWindow);
  }

  // ---------------------------------------------------------------------------
  // Pattern detection
  // ---------------------------------------------------------------------------

  /**
   * Groups tasks by their detected "task type" using keyword extraction.
   * Two tasks belong to the same group when they share >= 2 keywords from
   * the same domain cluster.
   */
  private detectPatterns(tasks: Task[]): PatternGroup[] {
    const groups = new Map<string, Task[]>();

    for (const task of tasks) {
      const taskType = this.classifyTaskType(task.description);
      const existing = groups.get(taskType) ?? [];
      existing.push(task);
      groups.set(taskType, existing);
    }

    return Array.from(groups.entries()).map(([taskType, groupTasks]) => ({
      taskType,
      count: groupTasks.length,
      tasks: groupTasks,
      commonKeywords: this.extractCommonKeywords(groupTasks),
    }));
  }

  private classifyTaskType(description: string): string {
    const desc = description.toLowerCase();

    const DOMAINS: Array<[string, string[]]> = [
      ['deploy', ['deploy', 'release', 'publish', 'push to']],
      ['test', ['test', 'spec', 'jest', 'vitest', 'playwright']],
      ['debug', ['debug', 'fix', 'error', 'bug', 'failing']],
      ['refactor', ['refactor', 'clean up', 'reorganise', 'reorganize', 'extract']],
      ['review', ['review', 'audit', 'check', 'validate', 'verify']],
      ['document', ['document', 'docs', 'readme', 'write docs']],
      ['build', ['build', 'compile', 'bundle', 'webpack', 'vite']],
      ['database', ['migrate', 'schema', 'sql', 'database', 'db']],
      ['api', ['api', 'endpoint', 'route', 'rest', 'graphql']],
      ['ui', ['component', 'ui', 'frontend', 'css', 'style']],
    ];

    for (const [type, keywords] of DOMAINS) {
      if (keywords.some((kw) => desc.includes(kw))) {
        return type;
      }
    }

    // Fall back to first significant noun phrase
    const words = desc.split(/\s+/).filter((w) => w.length > 4);
    return words[0] ?? 'general';
  }

  private extractCommonKeywords(tasks: Task[]): string[] {
    if (tasks.length === 0) return [];

    // Tokenise each task description
    const tokenised = tasks.map((t) =>
      new Set(
        t.description
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter((w) => w.length > 3),
      ),
    );

    // Find words present in at least half of the tasks
    const threshold = Math.ceil(tasks.length / 2);
    const allWords = new Set(tokenised.flatMap((s) => Array.from(s)));
    const common: string[] = [];

    for (const word of allWords) {
      const occurrences = tokenised.filter((s) => s.has(word)).length;
      if (occurrences >= threshold) {
        common.push(word);
      }
    }

    return common.slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Playbook extraction
  // ---------------------------------------------------------------------------

  private extractPlaybook(group: PatternGroup): ExtractedPlaybook | null {
    if (group.tasks.length === 0) return null;

    // Build generalised steps from the most common task in the group
    // (the one whose description is most representative)
    const representative = this.findRepresentativeTask(group.tasks);

    const steps = this.buildGeneralisedSteps(group.tasks);

    if (steps.length === 0) return null;

    // Trigger is derived from the most common keywords
    const triggerKeywords = group.commonKeywords.slice(0, 3);
    const trigger =
      triggerKeywords.length > 0
        ? triggerKeywords.join(' ')
        : group.taskType;

    // Confidence is based on how many tasks matched and how similar they are
    const confidence = Math.min(
      1,
      (group.count / this.historyWindow) * 0.6 +
        (triggerKeywords.length / 5) * 0.4,
    );

    const playbook: Playbook = {
      id: randomUUID(),
      name: `Auto-captured: ${group.taskType} routine`,
      trigger,
      steps,
      lastUsed: 0,
      useCount: 0,
    };

    return { playbook, patternGroup: group, confidence };
  }

  private findRepresentativeTask(tasks: Task[]): Task {
    // The task closest to the average description length
    const avgLen =
      tasks.reduce((sum, t) => sum + t.description.length, 0) / tasks.length;
    return tasks.reduce((best, t) =>
      Math.abs(t.description.length - avgLen) <
      Math.abs(best.description.length - avgLen)
        ? t
        : best,
    );
  }

  private buildGeneralisedSteps(tasks: Task[]): string[] {
    // Extract meaningful phrases from all tasks in the group, then deduplicate
    const phrases = new Map<string, number>();

    for (const task of tasks) {
      const sentences = task.description
        .split(/[.!?]\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 10 && s.length < 200);

      for (const sentence of sentences) {
        const normalised = sentence.toLowerCase();
        phrases.set(normalised, (phrases.get(normalised) ?? 0) + 1);
      }
    }

    // Keep phrases that appear in more than one task
    const commonPhrases = Array.from(phrases.entries())
      .filter(([, count]) => count > 1)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([phrase]) => this.capitalise(phrase));

    if (commonPhrases.length > 0) return commonPhrases;

    // Fallback: use sentences from the most complete task (by description length)
    const longest = tasks.reduce((a, b) =>
      a.description.length > b.description.length ? a : b,
    );

    return longest.description
      .split(/[.!?]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10)
      .slice(0, 6);
  }

  private capitalise(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ---------------------------------------------------------------------------
  // Output formatting
  // ---------------------------------------------------------------------------

  private formatOutput(
    analysedCount: number,
    extracted: ExtractedPlaybook[],
  ): string {
    const lines: string[] = [
      `=== Playbook Capture Summary ===`,
      `Analysed ${analysedCount} recent completed tasks.`,
      `Captured ${extracted.length} playbook(s).`,
      '',
    ];

    for (const { playbook, patternGroup, confidence } of extracted) {
      lines.push(`Playbook: "${playbook.name}"`);
      lines.push(`  Trigger: "${playbook.trigger}"`);
      lines.push(`  Based on: ${patternGroup.count} similar task(s)`);
      lines.push(`  Confidence: ${(confidence * 100).toFixed(0)}%`);
      lines.push(`  Steps (${playbook.steps.length}):`);
      for (const step of playbook.steps) {
        lines.push(`    - ${step}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
