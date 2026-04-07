import type {
  FtmModule,
  TaskContext,
  ModuleResult,
  FtmEvent,
  PlanStep,
} from '../shared/types.js';
import type { ModelRouter } from '../router.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface VerificationCheck {
  name: string;
  description: string;
  status: CheckStatus;
  details?: string;
  suggestion?: string;
}

export interface VerificationReport {
  taskId: string;
  overallStatus: 'pass' | 'fail' | 'warn';
  checks: VerificationCheck[];
  summary: string;
  generatedAt: number;
}

/**
 * VerifyModule — post-execution verification and validation.
 *
 * Workflow:
 *  1. Review the execution results stored in the blackboard/plan
 *  2. Run any verification commands embedded in the plan steps
 *  3. Check for common issues (missing imports, type errors, test failures)
 *  4. Ask the review model to produce a verification report
 *  5. Return pass/fail/warning status with actionable suggestions
 */
export class VerifyModule implements FtmModule {
  name = 'verify';

  private readonly router: ModelRouter;

  constructor(router: ModelRouter) {
    this.router = router;
  }

  // ---------------------------------------------------------------------------
  // FtmModule interface
  // ---------------------------------------------------------------------------

  canHandle(context: TaskContext): boolean {
    const desc = context.task.description.toLowerCase();
    return (
      desc.includes('verify') ||
      desc.includes('validate') ||
      desc.includes('check')
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

    const checks: VerificationCheck[] = [];

    // ── Step 1: review blackboard execution results ──────────────────────────
    const blackboardCheck = this.reviewBlackboard(context);
    checks.push(blackboardCheck);

    emit({
      type: 'verify_phase',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { phase: 'blackboard_review', status: blackboardCheck.status },
    });

    // ── Step 2: run verification commands from plan steps ───────────────────
    const planCommandChecks = await this.runPlanCommands(context, emit);
    checks.push(...planCommandChecks);

    // ── Step 3: run static / common issue checks ─────────────────────────────
    const staticChecks = await this.runStaticChecks(context, emit);
    checks.push(...staticChecks);

    // ── Step 4: model-assisted synthesis (if model is available) ─────────────
    emit({
      type: 'verify_phase',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { phase: 'synthesising' },
    });

    const modelSynthesisCheck = await this.runModelSynthesis(context, checks);
    if (modelSynthesisCheck) {
      checks.push(modelSynthesisCheck);
    }

    // ── Step 5: build report ─────────────────────────────────────────────────
    const report = this.buildReport(context.task.id, checks);

    emit({
      type: 'verify_complete',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: {
        taskId: context.task.id,
        overallStatus: report.overallStatus,
        passCount: checks.filter((c) => c.status === 'pass').length,
        failCount: checks.filter((c) => c.status === 'fail').length,
        warnCount: checks.filter((c) => c.status === 'warn').length,
      },
    });

    return {
      success: report.overallStatus !== 'fail',
      output: this.formatReport(report),
      artifacts: [
        {
          type: 'verification_report',
          path: '',
          content: JSON.stringify(report, null, 2),
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Check 1: blackboard review
  // ---------------------------------------------------------------------------

  private reviewBlackboard(context: TaskContext): VerificationCheck {
    const bb = context.blackboard;

    // Check whether there is a completed task in the blackboard
    if (!bb.currentTask) {
      // No active task — this is a standalone verify call
      return {
        name: 'blackboard_state',
        description: 'Review blackboard for active task state',
        status: 'warn',
        details: 'No active task found in blackboard. Running verification in standalone mode.',
        suggestion: 'Ensure verify is called after task execution to review results.',
      };
    }

    const task = bb.currentTask;

    if (task.status === 'completed' && task.result) {
      return {
        name: 'blackboard_state',
        description: 'Review blackboard for active task state',
        status: 'pass',
        details: `Task "${task.id}" completed with result: ${task.result.substring(0, 200)}`,
      };
    }

    if (task.status === 'failed' || task.error) {
      return {
        name: 'blackboard_state',
        description: 'Review blackboard for active task state',
        status: 'fail',
        details: `Task "${task.id}" failed: ${task.error ?? 'unknown error'}`,
        suggestion: 'Review the error details and re-run the task with corrections.',
      };
    }

    return {
      name: 'blackboard_state',
      description: 'Review blackboard for active task state',
      status: 'warn',
      details: `Task "${task.id}" status: ${task.status}`,
      suggestion: 'Task may still be in progress. Verify again after completion.',
    };
  }

  // ---------------------------------------------------------------------------
  // Check 2: plan verification commands
  // ---------------------------------------------------------------------------

  private async runPlanCommands(
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<VerificationCheck[]> {
    const plan = context.plan;
    if (!plan) return [];

    const verifySteps = plan.steps.filter(
      (s) =>
        s.description.toLowerCase().includes('verify') ||
        s.description.toLowerCase().includes('test') ||
        s.description.toLowerCase().includes('check') ||
        s.description.toLowerCase().includes('validate'),
    );

    if (verifySteps.length === 0) return [];

    const checks: VerificationCheck[] = [];

    for (const step of verifySteps) {
      const cmd = this.extractCommand(step);
      if (!cmd) continue;

      emit({
        type: 'verify_command_running',
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: { command: cmd, stepIndex: step.index },
      });

      const check = await this.runShellCheck(
        `plan_step_${step.index}`,
        `Plan step: ${step.description}`,
        cmd,
      );
      checks.push(check);
    }

    return checks;
  }

  /**
   * Attempt to extract a shell command from a plan step description.
   * Looks for backtick-delimited or common shell command prefixes.
   */
  private extractCommand(step: PlanStep): string | null {
    // Backtick-quoted command
    const backtick = step.description.match(/`([^`]+)`/);
    if (backtick) return backtick[1];

    // Inline $ prompt notation
    const dollar = step.description.match(/\$\s+([\w].*)/);
    if (dollar) return dollar[1];

    // Common known commands
    const knownPrefixes = ['npm ', 'yarn ', 'pnpm ', 'npx ', 'tsc', 'eslint', 'jest ', 'vitest'];
    for (const prefix of knownPrefixes) {
      const match = step.description.match(
        new RegExp(`(${prefix.replace(' ', '\\s')}[^.!?]*)`, 'i'),
      );
      if (match) return match[1].trim();
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Check 3: static / common issue checks
  // ---------------------------------------------------------------------------

  private async runStaticChecks(
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<VerificationCheck[]> {
    const checks: VerificationCheck[] = [];

    emit({
      type: 'verify_phase',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { phase: 'static_checks' },
    });

    // TypeScript compile check
    const tsCheck = await this.runTypeScriptCheck();
    checks.push(tsCheck);

    // Test suite check (npm test / vitest)
    const testCheck = await this.runTestCheck();
    checks.push(testCheck);

    // Lint check
    const lintCheck = await this.runLintCheck();
    checks.push(lintCheck);

    return checks;
  }

  private async runTypeScriptCheck(): Promise<VerificationCheck> {
    return this.runShellCheck(
      'typescript',
      'TypeScript compilation check',
      'npx tsc --noEmit 2>&1 | head -50',
      { successOnEmpty: true, timeout: 30_000 },
    );
  }

  private async runTestCheck(): Promise<VerificationCheck> {
    // Detect test runner
    const testCmd = await this.detectTestCommand();

    if (!testCmd) {
      return {
        name: 'tests',
        description: 'Test suite',
        status: 'skip',
        details: 'No test runner detected (tried npm test, vitest, jest).',
        suggestion: 'Add a "test" script to package.json.',
      };
    }

    return this.runShellCheck('tests', 'Test suite', testCmd, {
      timeout: 120_000,
    });
  }

  private async runLintCheck(): Promise<VerificationCheck> {
    return this.runShellCheck(
      'lint',
      'Lint check',
      'npx eslint . --max-warnings 0 2>&1 | head -50',
      { successOnEmpty: true, timeout: 30_000 },
    );
  }

  private async detectTestCommand(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('cat package.json 2>/dev/null');
      const pkg = JSON.parse(stdout) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test && !pkg.scripts.test.includes('echo')) {
        return 'npm test -- --passWithNoTests 2>&1 | tail -30';
      }
    } catch {
      // ignore
    }

    // Check for vitest config
    try {
      await execAsync('test -f vitest.config.ts || test -f vitest.config.js');
      return 'npx vitest run --passWithNoTests 2>&1 | tail -30';
    } catch {
      // ignore
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Check 4: model-assisted synthesis
  // ---------------------------------------------------------------------------

  private async runModelSynthesis(
    context: TaskContext,
    checks: VerificationCheck[],
  ): Promise<VerificationCheck | null> {
    const hasFailures = checks.some((c) => c.status === 'fail');
    const hasWarnings = checks.some((c) => c.status === 'warn');

    if (!hasFailures && !hasWarnings) {
      // All checks passed — no need to call the model
      return null;
    }

    try {
      const adapter = await this.router.route('review');

      const checksSummary = checks
        .filter((c) => c.status !== 'skip')
        .map(
          (c) =>
            `[${c.status.toUpperCase()}] ${c.name}: ${c.details ?? 'no details'}`,
        )
        .join('\n');

      const prompt = [
        'You are reviewing the results of a post-execution verification.',
        'Based on the check results below, provide:',
        '1. A concise summary of what needs to be fixed',
        '2. Prioritised action items (most important first)',
        'Keep your response to 5-8 lines.',
        '',
        `Task: ${context.task.description}`,
        '',
        'Check results:',
        checksSummary,
      ].join('\n');

      const response = await adapter.startSession(prompt, {
        systemPrompt:
          'You are a QA engineer. Be direct and actionable. Do not repeat the check results verbatim.',
        temperature: 0.2,
      });

      return {
        name: 'model_synthesis',
        description: 'AI-assisted issue synthesis',
        status: hasFailures ? 'fail' : 'warn',
        details: response.text,
        suggestion: 'Address the items listed above before marking the task complete.',
      };
    } catch {
      // Model unavailable — skip synthesis check silently
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Shell command runner
  // ---------------------------------------------------------------------------

  private async runShellCheck(
    name: string,
    description: string,
    command: string,
    opts: { successOnEmpty?: boolean; timeout?: number } = {},
  ): Promise<VerificationCheck> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: opts.timeout ?? 15_000,
        // Run in current working directory
        cwd: process.cwd(),
        env: process.env,
      });

      const output = (stdout + stderr).trim();

      if (opts.successOnEmpty && output.length === 0) {
        return {
          name,
          description,
          status: 'pass',
          details: 'No issues found.',
        };
      }

      // Classify based on output patterns
      const lower = output.toLowerCase();
      const hasFatalError =
        lower.includes('error:') ||
        lower.includes('failed') ||
        lower.includes('✕') ||
        lower.includes('× ');
      const hasWarning =
        lower.includes('warning:') ||
        lower.includes('warn ') ||
        lower.includes('⚠');

      if (hasFatalError) {
        return {
          name,
          description,
          status: 'fail',
          details: output.substring(0, 500),
          suggestion: `Fix the errors reported by: ${command}`,
        };
      }

      if (hasWarning) {
        return {
          name,
          description,
          status: 'warn',
          details: output.substring(0, 500),
          suggestion: `Review and resolve the warnings reported by: ${command}`,
        };
      }

      return {
        name,
        description,
        status: 'pass',
        details: output.length > 0 ? output.substring(0, 200) : 'Completed successfully.',
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Exit code !== 0 is a failure, timeout is also failure
      return {
        name,
        description,
        status: 'fail',
        details: errorMsg.substring(0, 400),
        suggestion: `Review the output of: ${command}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Report assembly
  // ---------------------------------------------------------------------------

  private buildReport(taskId: string, checks: VerificationCheck[]): VerificationReport {
    const activeChecks = checks.filter((c) => c.status !== 'skip');
    const failCount = activeChecks.filter((c) => c.status === 'fail').length;
    const warnCount = activeChecks.filter((c) => c.status === 'warn').length;

    let overallStatus: VerificationReport['overallStatus'];
    if (failCount > 0) {
      overallStatus = 'fail';
    } else if (warnCount > 0) {
      overallStatus = 'warn';
    } else {
      overallStatus = 'pass';
    }

    const summary =
      overallStatus === 'pass'
        ? `All ${activeChecks.length} check(s) passed.`
        : `${failCount} failure(s) and ${warnCount} warning(s) across ${activeChecks.length} check(s).`;

    return {
      taskId,
      overallStatus,
      checks,
      summary,
      generatedAt: Date.now(),
    };
  }

  private formatReport(report: VerificationReport): string {
    const statusIcon = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' };
    const lines: string[] = [
      `=== Verification Report [${statusIcon[report.overallStatus]}] ===`,
      report.summary,
      '',
    ];

    for (const check of report.checks) {
      const icon = { pass: '+', fail: 'x', warn: '!', skip: '-' }[check.status];
      lines.push(`[${icon}] ${check.name}: ${check.description}`);
      if (check.details && check.status !== 'pass') {
        lines.push(`    ${check.details.substring(0, 200).replace(/\n/g, '\n    ')}`);
      }
      if (check.suggestion && (check.status === 'fail' || check.status === 'warn')) {
        lines.push(`    Suggestion: ${check.suggestion}`);
      }
    }

    return lines.join('\n');
  }
}
