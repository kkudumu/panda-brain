import type { FtmModule, TaskContext, ModuleResult, FtmEvent } from '@shared/types.js';

/**
 * MindModule — the default catch-all module.
 *
 * Its role is to acknowledge the task and serve as the integration point
 * for routing to more specialised modules. When a full LLM pipeline is
 * wired in, this is where the reasoning loop will live.
 */
export class MindModule implements FtmModule {
  name = 'mind';

  canHandle(_context: TaskContext): boolean {
    // Mind module is the default — it can handle anything
    return true;
  }

  async execute(context: TaskContext, emit: (event: FtmEvent) => void): Promise<ModuleResult> {
    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { module: this.name, taskId: context.task.id },
    });

    return {
      success: true,
      output: `Task "${context.task.description}" processed by mind module`,
    };
  }
}
