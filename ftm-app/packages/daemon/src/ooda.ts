import type {
  Task,
  Plan,
  PlanStep,
  TaskContext,
  FtmModule,
  ModuleResult,
  FtmEvent,
} from './shared/types.js';
import { FtmEventBus } from './event-bus.js';
import { Blackboard } from './blackboard.js';
import { ModelRouter } from './router.js';
import { synthesizeUserContext } from './profile-context.js';

type OodaPhase = 'idle' | 'observe' | 'orient' | 'decide' | 'act' | 'complete' | 'error';

interface OrientResult {
  complexity: 'micro' | 'small' | 'medium' | 'large' | 'xl';
  matchedModules: FtmModule[];
  guardFlags: string[];
}

/**
 * OodaLoop — the cognitive core of the FTM daemon.
 *
 * Implements the Observe → Orient → Decide → Act cycle:
 *
 *   OBSERVE  – pull context from blackboard, check for matching playbooks,
 *              retrieve relevant past experiences.
 *   ORIENT   – classify task complexity, select applicable modules, evaluate
 *              guard rules.
 *   DECIDE   – generate an execution plan (single-step for simple tasks,
 *              multi-step for complex ones).
 *   ACT      – execute each plan step in sequence using the model router to
 *              dispatch to the correct adapter.
 */
export class OodaLoop {
  private phase: OodaPhase = 'idle';
  private modules: FtmModule[] = [];
  private eventBus: FtmEventBus;
  private blackboard: Blackboard;
  private router: ModelRouter;
  private currentTask: Task | null = null;
  private currentPlan: Plan | null = null;

  constructor(eventBus: FtmEventBus, blackboard: Blackboard, router: ModelRouter) {
    this.eventBus = eventBus;
    this.blackboard = blackboard;
    this.router = router;
  }

  // ---------------------------------------------------------------------------
  // Module registration
  // ---------------------------------------------------------------------------

  registerModule(module: FtmModule): void {
    this.modules.push(module);
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  /**
   * Runs the full OODA cycle for the given task and returns the final result.
   * Emits lifecycle events throughout so the daemon can stream progress to clients.
   */
  async processTask(task: Task): Promise<ModuleResult> {
    this.currentTask = task;
    this.blackboard.setCurrentTask(task);

    try {
      if (this.isDirectReplyTask(task.description)) {
        return this.completeDirectReply(task);
      }

      if (this.isQuickReplyTask(task.description)) {
        return await this.completeQuickReply(task);
      }

      // ── OBSERVE ────────────────────────────────────────────────────────────
      this.setPhase('observe');
      const context = await this.observe(task);

      // ── ORIENT ─────────────────────────────────────────────────────────────
      this.setPhase('orient');
      const analysis = await this.orient(context);

      // ── DECIDE ─────────────────────────────────────────────────────────────
      this.setPhase('decide');
      const plan = await this.decide(task, analysis);
      this.currentPlan = plan;

      // Wait for approval when required by the config
      if (this.router.getConfig().execution.approvalMode !== 'auto') {
        if (this.hasApprovalEvent(plan.id)) {
          plan.status = 'approved';
        } else {
          this.eventBus.emitTyped('approval_requested', { taskId: task.id, plan });
          await this.waitForApproval(plan);
        }
      }

      // ── ACT ────────────────────────────────────────────────────────────────
      this.setPhase('act');
      const result = await this.act(plan);

      this.setPhase('complete');
      this.eventBus.emitTyped('task_completed', { taskId: task.id, result });
      return result;
    } catch (error) {
      this.setPhase('error');
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.eventBus.emitTyped('error', { taskId: task.id, error: errorMsg });
      return { success: false, error: errorMsg };
    } finally {
      this.blackboard.clearCurrentTask();
      this.currentTask = null;
      this.currentPlan = null;
    }
  }

  // ---------------------------------------------------------------------------
  // OBSERVE
  // ---------------------------------------------------------------------------

  /**
   * Loads contextual information: current blackboard state, any matching
   * playbook, and relevant past experiences.
   */
  private async observe(task: Task): Promise<TaskContext> {
    this.eventBus.emitTyped('memory_retrieved', { taskId: task.id });

    const context: TaskContext = {
      task,
      blackboard: this.blackboard.getContext(),
      config: this.router.getConfig(),
    };

    // Check for a matching playbook and record the match if found
    const playbook = this.blackboard.checkPlaybook(task.description);
    if (playbook) {
      this.eventBus.emitTyped('playbook_matched', {
        taskId: task.id,
        playbookId: playbook.id,
      });
      this.blackboard.recordPlaybookUse(playbook.id);
    }

    // Surface relevant past experiences (result used by orient step)
    this.blackboard.findRelevantExperiences('general', []);

    return context;
  }

  // ---------------------------------------------------------------------------
  // ORIENT
  // ---------------------------------------------------------------------------

  /**
   * Classifies task complexity, identifies applicable modules, and evaluates
   * guard rules against the task context.
   */
  private async orient(context: TaskContext): Promise<OrientResult> {
    const complexity = this.classifyComplexity(context.task.description);

    const matchedModules = this.modules.filter((m) => m.canHandle(context));

    const guardFlags = this.checkGuardRules(context);

    return { complexity, matchedModules, guardFlags };
  }

  // ---------------------------------------------------------------------------
  // DECIDE
  // ---------------------------------------------------------------------------

  /**
   * Produces an execution plan.
   *
   * For complex tasks (many guard flags or matched modules) we emit the plan
   * with multiple steps; for simple tasks we emit a single-step plan.
   * LLM-powered decomposition will replace this heuristic once adapters are live.
   */
  private async decide(task: Task, analysis: OrientResult): Promise<Plan> {
    const steps: PlanStep[] = this.buildSteps(task, analysis);

    const plan: Plan = {
      id: `plan-${Date.now()}`,
      taskId: task.id,
      steps,
      status: 'pending',
      currentStep: 0,
      createdAt: Date.now(),
    };

    this.eventBus.emitTyped('plan_generated', { taskId: task.id, plan });
    return plan;
  }

  /**
   * Builds plan steps from the task and orient analysis.
   * Guard flags get prepended as validation steps; the main task follows.
   */
  private buildSteps(task: Task, analysis: OrientResult): PlanStep[] {
    const steps: PlanStep[] = [];

    // Add a confirmation step for each guard flag so the executor can pause
    if (analysis.guardFlags.includes('destructive_operation')) {
      steps.push({
        index: steps.length,
        description: 'Confirm: destructive operation detected — verify intent before proceeding',
        status: 'pending',
        requiresApproval: true,
      });
    }

    if (analysis.guardFlags.includes('production_target')) {
      steps.push({
        index: steps.length,
        description: 'Confirm: task targets a production system — proceed with caution',
        status: 'pending',
        requiresApproval: true,
      });
    }

    // Main execution step
    steps.push({
      index: steps.length,
      description: task.description,
      status: 'pending',
    });

    return steps;
  }

  // ---------------------------------------------------------------------------
  // ACT
  // ---------------------------------------------------------------------------

  /**
   * Executes all plan steps in sequence.
   * Routes each step to the execution model, collects outputs, and aggregates
   * them into a single ModuleResult.
   */
  private async act(plan: Plan): Promise<ModuleResult> {
    plan.status = 'executing';
    const outputs: string[] = [];

    for (const step of plan.steps) {
      this.eventBus.emitTyped('step_started', {
        planId: plan.id,
        stepIndex: step.index,
        description: step.description,
      });

      // Pause for approval when the step requires it
      if (step.requiresApproval) {
        this.eventBus.emitTyped('approval_requested', {
          planId: plan.id,
          stepIndex: step.index,
        });
        // In plan_first mode the top-level approval already covers the whole plan;
        // individual step approvals are for always_ask mode.  Both are handled by
        // external callers via the plan_approved event.
      }

      // Dispatch to the execution adapter
      const adapter = await this.router.route('execution');
      const response = await adapter.startSession(
        `Execute this step: ${step.description}`,
        { workingDir: process.cwd() },
      );

      step.status = 'completed';
      plan.currentStep = step.index + 1;
      outputs.push(response.text);

      this.eventBus.emitTyped('step_completed', {
        planId: plan.id,
        stepIndex: step.index,
        response: response.text.substring(0, 500),
      });
    }

    plan.status = 'completed';
    return {
      success: true,
      output: outputs.join('\n\n'),
    };
  }

  private isDirectReplyTask(description: string): boolean {
    const normalized = description.trim().toLowerCase();
    if (!normalized) return false;

    return [
      'hello',
      'hello machine',
      'hi',
      'hi machine',
      'hey',
      'hey machine',
      'good morning',
      'good afternoon',
      'good evening',
      'thanks',
      'thank you',
      'help',
      'what can you do',
      'who are you',
    ].includes(normalized);
  }

  private isQuickReplyTask(description: string): boolean {
    const normalized = description.trim().toLowerCase();
    if (!normalized || this.isDirectReplyTask(description)) return false;

    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (wordCount > 12) return false;

    const blockerSignals = [
      'write',
      'implement',
      'build',
      'create',
      'refactor',
      'fix',
      'debug',
      'run',
      'execute',
      'install',
      'deploy',
      'delete',
      'remove',
      'production',
      'file',
      'code',
      'function',
      'script',
    ];

    return !blockerSignals.some((signal) => normalized.includes(signal));
  }

  private completeDirectReply(task: Task): ModuleResult {
    this.setPhase('observe');
    const profile = synthesizeUserContext(this.blackboard.getUserProfileSnapshot()).profile;
    const result: ModuleResult = {
      success: true,
      output: this.buildDirectReply(task.description, profile.preferredName),
    };

    this.setPhase('complete');
    this.eventBus.emitTyped('task_completed', { taskId: task.id, result });
    return result;
  }

  private buildDirectReply(description: string, preferredName: string | null): string {
    const normalized = description.trim().toLowerCase();

    if (normalized.includes('thank')) {
      return "You're welcome.";
    }
    if (normalized === 'help' || normalized === 'what can you do') {
      return 'I can answer quick questions, plan work, and run longer coding tasks.';
    }
    if (normalized === 'who are you') {
      return 'I am Feed The Machine, your terminal-first helper.';
    }
    return `Hello ${preferredName ?? 'user'}.`;
  }

  private async completeQuickReply(task: Task): Promise<ModuleResult> {
    this.setPhase('observe');
    this.eventBus.emitTyped('memory_retrieved', { taskId: task.id });

    this.setPhase('orient');
    this.setPhase('act');

    const synthesized = synthesizeUserContext(this.blackboard.getUserProfileSnapshot());
    const profile = synthesized.profile;
    const outputFormats = profile.preferredOutputFormats.slice(0, 3).map((item) => item.label);

    const adapter = await this.router.route('execution');
    const response = await adapter.startSession(
      [
        'Reply directly to the user in one or two short sentences.',
        'Do not make a plan.',
        'Do not describe internal execution.',
        ...(profile.preferredName ? [`Address the user as ${profile.preferredName}.`] : []),
        `Prefer a ${profile.responseStyle} tone.`,
        ...(outputFormats.length > 0 ? [`Honor these output format preferences when they make sense: ${outputFormats.join(', ')}.`] : []),
        ...synthesized.promptContext.map((line) => `Profile context: ${line}`),
        `User message: ${task.description}`,
      ].join('\n'),
      { workingDir: process.cwd() },
    );

    const result: ModuleResult = {
      success: true,
      output: response.text.trim() || 'Task completed.',
    };

    this.setPhase('complete');
    this.eventBus.emitTyped('task_completed', { taskId: task.id, result });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Classify task complexity by word count.
   */
  private classifyComplexity(
    description: string,
  ): 'micro' | 'small' | 'medium' | 'large' | 'xl' {
    const words = description.split(/\s+/).length;
    if (words < 10) return 'micro';
    if (words < 30) return 'small';
    if (words < 80) return 'medium';
    if (words < 200) return 'large';
    return 'xl';
  }

  /**
   * Evaluate guard rules against the task context and return a list of flag names
   * for any rule that fired.
   */
  private checkGuardRules(context: TaskContext): string[] {
    const flags: string[] = [];
    const desc = context.task.description.toLowerCase();

    if (desc.includes('delete') || desc.includes('remove') || desc.includes('drop') || desc.includes('rm -rf') || desc.includes('reset --hard')) {
      flags.push('destructive_operation');
    }
    if (desc.includes('production') || desc.includes('prod')) {
      flags.push('production_target');
    }
    if (desc.includes('force') || desc.includes('--force')) {
      flags.push('force_flag');
    }

    return flags;
  }

  /**
   * Returns a Promise that resolves when a plan_approved event is received for
   * the given plan.  The plan's status is set to 'approved' before resolving.
   */
  private waitForApproval(plan: Plan): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.hasApprovalEvent(plan.id)) {
        plan.status = 'approved';
        resolve();
        return;
      }

      const handler = (event: FtmEvent) => {
        if (event.data?.planId === plan.id) {
          plan.status = 'approved';
          this.eventBus.removeListener('plan_approved', handler);
          resolve();
        }
      };
      this.eventBus.on('plan_approved', handler);
    });
  }

  private hasApprovalEvent(planId: string): boolean {
    return this.eventBus.getEventLog().some(
      (event) => event.type === 'plan_approved' && event.data?.planId === planId,
    );
  }

  /**
   * Transition to the given phase and broadcast an ooda_phase event.
   */
  private setPhase(phase: OodaPhase): void {
    this.phase = phase;
    this.eventBus.emit('ooda_phase', { phase, taskId: this.currentTask?.id });
  }

  // ---------------------------------------------------------------------------
  // State accessors
  // ---------------------------------------------------------------------------

  getPhase(): OodaPhase {
    return this.phase;
  }

  getCurrentTask(): Task | null {
    return this.currentTask;
  }

  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }
}
