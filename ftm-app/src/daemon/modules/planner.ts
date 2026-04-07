import type { FtmModule, TaskContext, ModuleResult, FtmEvent, Plan, PlanStep } from '@shared/types.js';

/**
 * PlannerModule — generates multi-step plans for non-trivial tasks.
 *
 * Currently uses a heuristic sentence-splitting approach. Once model
 * adapters are wired in end-to-end, the decompose() method will be
 * replaced by an LLM-powered call to the planning model.
 */
export class PlannerModule implements FtmModule {
  name = 'planner';

  canHandle(context: TaskContext): boolean {
    // Planner handles tasks that need multi-step plans
    const words = context.task.description.split(/\s+/).length;
    return words > 20; // Only plan for non-trivial tasks
  }

  async execute(context: TaskContext, emit: (event: FtmEvent) => void): Promise<ModuleResult> {
    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { module: this.name },
    });

    // Generate a plan.  For now, single step or heuristic decomposition.
    // When model adapters are wired in, this will use the planning model
    // to decompose the task.
    const plan: Plan = {
      id: `plan-${Date.now()}`,
      taskId: context.task.id,
      steps: this.decompose(context.task.description),
      status: 'pending',
      currentStep: 0,
      createdAt: Date.now(),
    };

    return {
      success: true,
      output: JSON.stringify(plan),
      artifacts: [{ type: 'plan', path: '', content: JSON.stringify(plan) }],
    };
  }

  // ---------------------------------------------------------------------------
  // Decomposition helpers
  // ---------------------------------------------------------------------------

  /**
   * Basic decomposition — splits on sentence boundaries.
   * Will be replaced by LLM-powered decomposition once adapters are live.
   */
  private decompose(description: string): PlanStep[] {
    const sentences = description
      .split(/\.\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (sentences.length <= 1) {
      return [{ index: 0, description: description.trim(), status: 'pending' }];
    }

    return sentences.map((s, i) => ({
      index: i,
      description: s,
      status: 'pending' as const,
    }));
  }
}
