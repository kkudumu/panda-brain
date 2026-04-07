import type { FtmModule, TaskContext, ModuleResult, FtmEvent } from '../shared/types.js';

export interface GuardRule {
  name: string;
  description: string;
  check(context: TaskContext): GuardCheckResult;
}

export interface GuardCheckResult {
  allowed: boolean;
  reason?: string;
  severity: 'info' | 'warning' | 'block';
}

/**
 * GuardModule — pre-flight safety checker that runs on every task.
 *
 * Evaluates a set of registered rules and emits guard_triggered events
 * for blocked or warned tasks. Also tracks failure counts to detect
 * runaway retry loops.
 */
export class GuardModule implements FtmModule {
  name = 'guard';
  private rules: GuardRule[] = [];
  private failureTracker: Map<string, number> = new Map(); // taskId -> failure count

  constructor() {
    this.registerDefaultRules();
  }

  canHandle(_context: TaskContext): boolean {
    // Guard runs on every task as a pre-check
    return true;
  }

  async execute(context: TaskContext, emit: (event: FtmEvent) => void): Promise<ModuleResult> {
    const results = this.rules.map((rule) => ({
      rule: rule.name,
      ...rule.check(context),
    }));

    const blocked = results.filter((r) => !r.allowed && r.severity === 'block');
    const warnings = results.filter((r) => !r.allowed && r.severity === 'warning');

    if (blocked.length > 0) {
      emit({
        type: 'guard_triggered',
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: {
          blocked: blocked.map((b) => ({ rule: b.rule, reason: b.reason })),
        },
      });
      return {
        success: false,
        error: `Blocked by guard: ${blocked.map((b) => b.reason).join('; ')}`,
      };
    }

    if (warnings.length > 0) {
      emit({
        type: 'guard_triggered',
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: {
          warnings: warnings.map((w) => ({ rule: w.rule, reason: w.reason })),
        },
      });
    }

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Rule management
  // ---------------------------------------------------------------------------

  registerRule(rule: GuardRule): void {
    this.rules.push(rule);
  }

  // ---------------------------------------------------------------------------
  // Failure / loop tracking
  // ---------------------------------------------------------------------------

  /**
   * Record a failure for the given task ID.
   * @returns The new failure count after recording.
   */
  recordFailure(taskId: string): number {
    const count = (this.failureTracker.get(taskId) ?? 0) + 1;
    this.failureTracker.set(taskId, count);
    return count;
  }

  /**
   * Returns true when the task has accumulated failures at or above the threshold.
   */
  isLooping(taskId: string, threshold = 3): boolean {
    return (this.failureTracker.get(taskId) ?? 0) >= threshold;
  }

  /**
   * Clears the failure record for a task (e.g. after successful completion).
   */
  clearFailures(taskId: string): void {
    this.failureTracker.delete(taskId);
  }

  // ---------------------------------------------------------------------------
  // Built-in rules
  // ---------------------------------------------------------------------------

  private registerDefaultRules(): void {
    // Rule: detect destructive shell / SQL operations
    this.registerRule({
      name: 'destructive_operation',
      description: 'Blocks potentially destructive operations without explicit confirmation',
      check(context) {
        const desc = context.task.description.toLowerCase();
        const destructivePatterns = [
          'rm -rf',
          'drop table',
          'delete from',
          'git push --force',
          'git reset --hard',
        ];
        const matched = destructivePatterns.find((p) => desc.includes(p));
        if (matched) {
          return {
            allowed: false,
            reason: `Destructive operation detected: "${matched}"`,
            severity: 'block',
          };
        }
        return { allowed: true, severity: 'info' };
      },
    });

    // Rule: warn when the task targets production
    this.registerRule({
      name: 'production_target',
      description: 'Warns when task targets production systems',
      check(context) {
        const desc = context.task.description.toLowerCase();
        if (
          desc.includes('production') ||
          desc.includes(' prod ') ||
          desc.includes('prod.')
        ) {
          return {
            allowed: true,
            reason: 'Task targets production',
            severity: 'warning',
          };
        }
        return { allowed: true, severity: 'info' };
      },
    });

    // Rule: loop detection (uses instance's failureTracker via arrow function)
    this.registerRule({
      name: 'loop_detection',
      description: 'Blocks tasks that have failed 3+ times',
      check: (context) => {
        if (this.isLooping(context.task.id)) {
          return {
            allowed: false,
            reason: `Loop detected: task "${context.task.id}" has failed 3+ times`,
            severity: 'block',
          };
        }
        return { allowed: true, severity: 'info' };
      },
    });
  }
}
