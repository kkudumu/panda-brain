import type {
  FtmModule,
  TaskContext,
  ModuleResult,
  FtmEvent,
  PlanStep,
  NormalizedResponse,
} from '@shared/types.js';
import type { ModelRouter } from '../router.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutorOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

interface StepAttempt {
  attempt: number;
  startedAt: number;
  finishedAt: number;
  response: NormalizedResponse | null;
  error?: string;
}

interface StepExecutionResult {
  step: PlanStep;
  attempts: StepAttempt[];
  finalResponse: NormalizedResponse | null;
  success: boolean;
  durationMs: number;
  artifacts: Array<{ type: string; path: string; content?: string }>;
}

// ---------------------------------------------------------------------------
// ExecutorModule
// ---------------------------------------------------------------------------

/**
 * ExecutorModule — executes individual plan steps.
 *
 * For each PlanStep it:
 *   1. Routes to the appropriate model tier via the ModelRouter
 *   2. Parses the model response and extracts any artifacts
 *   3. Tracks timing and resource usage per step
 *   4. Retries on transient failures (max 3 attempts with backoff)
 *   5. Aggregates results into a single ModuleResult
 *
 * The ModelRouter is injected at construction so the executor can dispatch
 * to the correct adapter (planning / execution / review) per step domain.
 */
export class ExecutorModule implements FtmModule {
  name = 'executor';

  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private router: ModelRouter | null = null;

  constructor(options: ExecutorOptions = {}) {
    this.maxRetries  = options.maxRetries  ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  /**
   * Inject a ModelRouter after construction.
   * Called by the module registry once the router is available.
   */
  setRouter(router: ModelRouter): void {
    this.router = router;
  }

  canHandle(context: TaskContext): boolean {
    // Executor handles tasks that have an existing plan, or any task with no
    // specialised module handler
    return !!context.plan || context.task.description.length > 0;
  }

  async execute(context: TaskContext, emit: (event: FtmEvent) => void): Promise<ModuleResult> {
    const { task, plan } = context;

    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: { module: this.name, taskId: task.id },
    });

    // If there is a plan, execute its steps; otherwise run the task as a single step
    const steps: PlanStep[] = plan?.steps ?? [
      { index: 0, description: task.description, status: 'pending' },
    ];

    const results: StepExecutionResult[] = [];
    const allArtifacts: Array<{ type: string; path: string; content?: string }> = [];
    let anyFailure = false;

    for (const step of steps) {
      // Skip already-completed steps (e.g. plan resumed after approval)
      if (step.status === 'completed') {
        continue;
      }

      emit({
        type: 'step_started',
        timestamp: Date.now(),
        sessionId: task.sessionId,
        data: {
          taskId:      task.id,
          planId:      plan?.id,
          stepIndex:   step.index,
          description: step.description,
          model:       step.model ?? 'execution',
        },
      });

      const stepResult = await this.executeStep(step, context, emit);
      results.push(stepResult);

      if (stepResult.success) {
        step.status = 'completed';
        if (plan) plan.currentStep = step.index + 1;

        allArtifacts.push(...stepResult.artifacts);

        emit({
          type: 'step_completed',
          timestamp: Date.now(),
          sessionId: task.sessionId,
          data: {
            taskId:      task.id,
            planId:      plan?.id,
            stepIndex:   step.index,
            durationMs:  stepResult.durationMs,
            tokenUsage:  stepResult.finalResponse?.tokenUsage,
            cost:        stepResult.finalResponse?.cost,
            outputLen:   stepResult.finalResponse?.text?.length ?? 0,
          },
        });
      } else {
        step.status = 'failed';
        anyFailure = true;

        emit({
          type: 'error',
          timestamp: Date.now(),
          sessionId: task.sessionId,
          data: {
            taskId:    task.id,
            stepIndex: step.index,
            error:     stepResult.attempts.at(-1)?.error ?? 'unknown error',
            attempts:  stepResult.attempts.length,
          },
        });

        // Stop executing further steps after a failure
        break;
      }
    }

    if (plan) {
      plan.status = anyFailure ? 'failed' : 'completed';
    }

    const outputs = results
      .filter((r) => r.success && r.finalResponse)
      .map((r) => r.finalResponse!.text);

    if (anyFailure) {
      const lastFailure = results.find((r) => !r.success);
      return {
        success: false,
        error:   lastFailure?.attempts.at(-1)?.error ?? 'Step execution failed',
        output:  outputs.join('\n\n'),
        artifacts: allArtifacts,
      };
    }

    return {
      success:   true,
      output:    outputs.join('\n\n'),
      artifacts: allArtifacts,
    };
  }

  // ---------------------------------------------------------------------------
  // Step execution with retry logic
  // ---------------------------------------------------------------------------

  private async executeStep(
    step: PlanStep,
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<StepExecutionResult> {
    const startedAt = Date.now();
    const attempts: StepAttempt[] = [];

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const attemptStart = Date.now();

      try {
        const response = await this.dispatchStep(step, context);
        const artifacts = this.extractArtifacts(response.text, step);

        attempts.push({
          attempt,
          startedAt:  attemptStart,
          finishedAt: Date.now(),
          response,
        });

        return {
          step,
          attempts,
          finalResponse: response,
          success:       true,
          durationMs:    Date.now() - startedAt,
          artifacts,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        attempts.push({
          attempt,
          startedAt:  attemptStart,
          finishedAt: Date.now(),
          response:   null,
          error:      errorMsg,
        });

        if (attempt < this.maxRetries) {
          emit({
            type: 'error',
            timestamp: Date.now(),
            sessionId: context.task.sessionId,
            data: {
              taskId:    context.task.id,
              stepIndex: step.index,
              attempt,
              error:     errorMsg,
              retrying:  true,
            },
          });

          await this.sleep(this.retryDelayMs * attempt); // exponential-ish backoff
        }
      }
    }

    return {
      step,
      attempts,
      finalResponse: null,
      success:       false,
      durationMs:    Date.now() - startedAt,
      artifacts:     [],
    };
  }

  /**
   * Dispatch a single step to the model adapter.
   * Uses the step's model tier if provided; falls back to 'execution'.
   */
  private async dispatchStep(
    step: PlanStep,
    context: TaskContext,
  ): Promise<NormalizedResponse> {
    if (!this.router) {
      // Router not injected — return a synthetic response for testing
      return {
        text:       `[executor] Step ${step.index}: ${step.description}`,
        toolCalls:  [],
        sessionId:  context.task.sessionId,
        tokenUsage: { input: 0, output: 0, cached: 0 },
        cost:       0,
      };
    }

    const tier = (step.model as 'planning' | 'execution' | 'review') ?? 'execution';
    const adapter = await this.router.route(tier);

    const prompt = this.buildStepPrompt(step, context);
    return adapter.startSession(prompt, { workingDir: process.cwd() });
  }

  private buildStepPrompt(step: PlanStep, context: TaskContext): string {
    const lines: string[] = [
      `You are executing step ${step.index + 1} of a multi-step task.`,
      '',
      `Original task: ${context.task.description}`,
      '',
      `Current step: ${step.description}`,
    ];

    if (context.blackboard.recentDecisions.length > 0) {
      lines.push('');
      lines.push('Recent decisions:');
      for (const d of context.blackboard.recentDecisions.slice(-3)) {
        lines.push(`  - ${d.decision}: ${d.reason}`);
      }
    }

    if (context.blackboard.activeConstraints.length > 0) {
      lines.push('');
      lines.push('Active constraints:');
      for (const c of context.blackboard.activeConstraints) {
        lines.push(`  - ${c}`);
      }
    }

    lines.push('');
    lines.push('Please execute this step and provide a clear, actionable output.');

    return lines.join('\n');
  }

  /**
   * Extract artifact references from model output text.
   * Looks for file paths and code blocks.
   */
  private extractArtifacts(
    text: string,
    step: PlanStep,
  ): Array<{ type: string; path: string; content?: string }> {
    const artifacts: Array<{ type: string; path: string; content?: string }> = [];

    // Extract fenced code blocks with filenames
    const codeBlockRegex = /```(?:typescript|javascript|python|bash|sh|json|yaml|ts|js|py)?\s+(?:\/\/\s*)?([^\n]+\.[\w]+)\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const [, filePath, content] = match;
      if (filePath && content) {
        artifacts.push({
          type:    this.inferArtifactType(filePath),
          path:    filePath.trim(),
          content: content.trim(),
        });
      }
    }

    // Extract plain file path references (e.g. "Created src/foo.ts")
    const fileRefRegex = /(?:created|updated|modified|wrote)\s+[`']?([\w./\-]+\.[\w]+)[`']?/gi;
    while ((match = fileRefRegex.exec(text)) !== null) {
      const [, filePath] = match;
      if (filePath && !artifacts.some((a) => a.path === filePath)) {
        artifacts.push({ type: this.inferArtifactType(filePath), path: filePath });
      }
    }

    // Always include a step output artifact
    if (text.length > 0) {
      artifacts.push({
        type:    'step_output',
        path:    `step-${step.index}-output`,
        content: text.substring(0, 2000),
      });
    }

    return artifacts;
  }

  private inferArtifactType(filePath: string): string {
    const ext = filePath.split('.').at(-1)?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      ts:   'typescript',
      tsx:  'typescript',
      js:   'javascript',
      jsx:  'javascript',
      py:   'python',
      sh:   'shell',
      bash: 'shell',
      json: 'json',
      yaml: 'yaml',
      yml:  'yaml',
      md:   'markdown',
      sql:  'sql',
    };
    return map[ext] ?? 'file';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
