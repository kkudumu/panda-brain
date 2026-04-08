import { randomUUID } from 'crypto';
import type {
  FtmModule,
  TaskContext,
  ModuleResult,
  FtmEvent,
  Plan,
  PlanStep,
} from '../shared/types.js';

// ---------------------------------------------------------------------------
// Planner internals
// ---------------------------------------------------------------------------

export type StepDomain = 'analysis' | 'code' | 'ops' | 'review' | 'approval';

export interface RichPlanStep extends PlanStep {
  domain: StepDomain;
  acceptanceCriteria: string[];
  estimatedComplexity: 'trivial' | 'low' | 'medium' | 'high';
  dependsOn: number[]; // indices of prerequisite steps
}

export interface DecomposedPlan {
  plan: Plan;
  richSteps: RichPlanStep[];
  estimatedTotalComplexity: 'trivial' | 'low' | 'medium' | 'high';
}

// Signals that indicate a step needs human approval
const APPROVAL_SIGNALS = [
  'delete', 'remove', 'drop', 'destroy', 'truncate',
  'production', 'prod', 'deploy', 'release', 'publish',
  'force', '--force', 'overwrite', 'migrate database',
  'credentials', 'secret', 'api key',
];

// Domain classification signals
const DOMAIN_SIGNALS: Record<StepDomain, string[]> = {
  analysis:  ['analyze', 'research', 'investigate', 'understand', 'review', 'check', 'audit'],
  code:      ['implement', 'write', 'create', 'refactor', 'build', 'add', 'update code', 'edit'],
  ops:       ['run', 'execute', 'deploy', 'install', 'migrate', 'configure', 'start', 'stop'],
  review:    ['test', 'verify', 'validate', 'ensure', 'confirm', 'check output', 'review result'],
  approval:  ['approve', 'confirm', 'authorize', 'permission'],
};

// Model selection per domain
const DOMAIN_MODELS: Record<StepDomain, 'planning' | 'execution' | 'review'> = {
  analysis: 'planning',
  code:     'execution',
  ops:      'execution',
  review:   'review',
  approval: 'planning',
};

// ---------------------------------------------------------------------------
// PlannerModule
// ---------------------------------------------------------------------------

/**
 * PlannerModule — generates rich multi-step plans for complex tasks.
 *
 * For each plan step the planner:
 *   - Assigns a domain (analysis | code | ops | review | approval)
 *   - Selects the appropriate model tier (planning / execution / review)
 *   - Generates acceptance criteria
 *   - Marks steps that require human approval
 *   - Estimates per-step complexity
 *   - Records inter-step dependencies
 */
export class PlannerModule implements FtmModule {
  name = 'planner';

  canHandle(context: TaskContext): boolean {
    const words = context.task.description.split(/\s+/).length;
    // Plan for tasks that are non-trivial (>15 words) or explicitly call for planning
    const lower = context.task.description.toLowerCase();
    const hasPlanningSignal = ['plan', 'steps', 'implement', 'build', 'create', 'design', 'refactor']
      .some((s) => lower.includes(s));
    return words > 15 || hasPlanningSignal;
  }

  async execute(context: TaskContext, emit: (event: FtmEvent) => void): Promise<ModuleResult> {
    const { task } = context;

    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: { module: this.name, taskId: task.id },
    });

    // Decompose into rich steps
    const decomposed = this.decompose(task.description, task.id);

    // Emit plan_generated with full step details
    emit({
      type: 'plan_generated',
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: {
        taskId: task.id,
        planId: decomposed.plan.id,
        stepCount: decomposed.plan.steps.length,
        estimatedComplexity: decomposed.estimatedTotalComplexity,
        steps: decomposed.richSteps.map((s) => ({
          index: s.index,
          description: s.description,
          domain: s.domain,
          model: s.model,
          requiresApproval: s.requiresApproval,
          estimatedComplexity: s.estimatedComplexity,
          dependsOn: s.dependsOn,
          acceptanceCriteria: s.acceptanceCriteria,
        })),
      },
    });

    const planJson = JSON.stringify(decomposed.plan, null, 2);

    return {
      success: true,
      output: this.formatPlanSummary(decomposed),
      artifacts: [
        { type: 'plan', path: '', content: planJson },
        {
          type: 'rich_plan',
          path: '',
          content: JSON.stringify(decomposed.richSteps, null, 2),
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Public decomposition API
  // ---------------------------------------------------------------------------

  /**
   * Decompose a task description into an ordered set of rich plan steps.
   */
  decompose(description: string, taskId: string): DecomposedPlan {
    const rawSteps = this.extractSteps(description);
    const richSteps = this.enrichSteps(rawSteps);
    const totalComplexity = this.estimateTotalComplexity(richSteps);

    const planSteps: PlanStep[] = richSteps.map((s) => ({
      index:           s.index,
      description:     s.description,
      status:          'pending',
      model:           s.model,
      requiresApproval: s.requiresApproval,
      files:           [],
    }));

    const plan: Plan = {
      id:          `plan-${randomUUID().substring(0, 8)}`,
      taskId,
      steps:       planSteps,
      status:      'pending',
      currentStep: 0,
      createdAt:   Date.now(),
    };

    return { plan, richSteps, estimatedTotalComplexity: totalComplexity };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract a list of step descriptions from the task.
   *
   * Strategy (in order of preference):
   *  1. Explicit numbered list (1. ... 2. ...)
   *  2. Sentence-by-sentence split for medium+ tasks
   *  3. Single step for short tasks
   */
  private extractSteps(description: string): string[] {
    // Check for explicit numbered list
    const numberedMatch = description.match(/\d+\.\s+[^\n]+/g);
    if (numberedMatch && numberedMatch.length > 1) {
      return numberedMatch.map((s) => s.replace(/^\d+\.\s+/, '').trim());
    }

    // Check for bullet list
    const bulletMatch = description.match(/[-•]\s+[^\n]+/g);
    if (bulletMatch && bulletMatch.length > 1) {
      return bulletMatch.map((s) => s.replace(/^[-•]\s+/, '').trim());
    }

    // Sentence split for multi-sentence tasks
    const sentences = description
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);

    if (sentences.length > 1) {
      // Group short sentences with the previous one to avoid micro-steps
      const grouped: string[] = [];
      let current = '';
      for (const sentence of sentences) {
        current += (current ? ' ' : '') + sentence;
        if (current.split(/\s+/).length >= 8) {
          grouped.push(current);
          current = '';
        }
      }
      if (current) grouped.push(current);
      if (grouped.length > 1) return grouped;
    }

    // Fallback — single step wrapping the whole description
    return [description.trim()];
  }

  private enrichSteps(rawSteps: string[]): RichPlanStep[] {
    const steps: RichPlanStep[] = rawSteps.map((desc, index) => {
      const domain = this.classifyDomain(desc);
      const requiresApproval = this.needsApproval(desc);
      const estimatedComplexity = this.estimateStepComplexity(desc);

      // Sequential dependency: each step depends on the one before it
      const dependsOn: number[] = index > 0 ? [index - 1] : [];

      return {
        index,
        description: desc,
        status:      'pending',
        domain,
        model:            DOMAIN_MODELS[domain],
        requiresApproval,
        files:            [],
        acceptanceCriteria: this.generateAcceptanceCriteria(desc, domain),
        estimatedComplexity,
        dependsOn,
      };
    });

    // Prepend analysis step for multi-step plans
    if (steps.length > 2) {
      const analysisStep: RichPlanStep = {
        index:               0,
        description:         `Analyze requirements and context for: "${rawSteps[0]?.substring(0, 80) ?? 'task'}"`,
        status:              'pending',
        domain:              'analysis',
        model:               'planning',
        requiresApproval:    false,
        files:               [],
        acceptanceCriteria:  ['Requirements clearly understood', 'Context and constraints identified'],
        estimatedComplexity: 'low',
        dependsOn:           [],
      };

      // Re-index and shift dependencies
      const reindexed = steps.map((s) => ({
        ...s,
        index:     s.index + 1,
        dependsOn: s.dependsOn.map((d) => d + 1),
      }));
      reindexed[0].dependsOn = [0]; // first real step depends on analysis

      // Append a final review step
      const reviewStep: RichPlanStep = {
        index:               reindexed.length + 1,
        description:         'Review outputs, verify acceptance criteria, and confirm task completion',
        status:              'pending',
        domain:              'review',
        model:               'review',
        requiresApproval:    false,
        files:               [],
        acceptanceCriteria:  ['All prior steps verified', 'Output matches original intent'],
        estimatedComplexity: 'low',
        dependsOn:           [reindexed.length],
      };

      return [analysisStep, ...reindexed, reviewStep];
    }

    return steps;
  }

  private classifyDomain(description: string): StepDomain {
    const lower = description.toLowerCase();
    let best: StepDomain = 'code';
    let bestScore = 0;

    for (const [domain, signals] of Object.entries(DOMAIN_SIGNALS) as [StepDomain, string[]][]) {
      const score = signals.filter((s) => lower.includes(s)).length;
      if (score > bestScore) {
        bestScore = score;
        best = domain;
      }
    }

    return best;
  }

  private needsApproval(description: string): boolean {
    const lower = description.toLowerCase();
    return APPROVAL_SIGNALS.some((signal) => lower.includes(signal));
  }

  private estimateStepComplexity(
    description: string,
  ): 'trivial' | 'low' | 'medium' | 'high' {
    const words = description.split(/\s+/).length;
    if (words < 8)  return 'trivial';
    if (words < 20) return 'low';
    if (words < 50) return 'medium';
    return 'high';
  }

  private estimateTotalComplexity(
    steps: RichPlanStep[],
  ): 'trivial' | 'low' | 'medium' | 'high' {
    const weights = { trivial: 0, low: 1, medium: 2, high: 4 };
    const total = steps.reduce((sum, s) => sum + weights[s.estimatedComplexity], 0);
    if (total <= 1) return 'trivial';
    if (total <= 4) return 'low';
    if (total <= 10) return 'medium';
    return 'high';
  }

  private generateAcceptanceCriteria(description: string, domain: StepDomain): string[] {
    const criteria: string[] = [];
    const lower = description.toLowerCase();

    switch (domain) {
      case 'code':
        criteria.push('Code is syntactically valid and type-checked');
        if (lower.includes('test')) criteria.push('Tests pass');
        if (lower.includes('function') || lower.includes('method')) {
          criteria.push('Function behaves as specified');
        }
        break;
      case 'ops':
        criteria.push('Command exits with code 0');
        criteria.push('Expected side effects confirmed');
        break;
      case 'analysis':
        criteria.push('Analysis documented with key findings');
        criteria.push('Constraints and dependencies identified');
        break;
      case 'review':
        criteria.push('Output reviewed against original requirements');
        criteria.push('Edge cases considered');
        break;
      case 'approval':
        criteria.push('Human approval obtained before proceeding');
        break;
    }

    criteria.push('Step output is non-empty and coherent');
    return criteria;
  }

  private formatPlanSummary(decomposed: DecomposedPlan): string {
    const { plan, richSteps, estimatedTotalComplexity } = decomposed;
    const lines: string[] = [
      `Plan ${plan.id} — ${richSteps.length} steps (estimated complexity: ${estimatedTotalComplexity})`,
      '',
    ];

    for (const step of richSteps) {
      const approval = step.requiresApproval ? ' [APPROVAL REQUIRED]' : '';
      lines.push(`  ${step.index + 1}. [${step.domain}/${step.model}]${approval}`);
      lines.push(`     ${step.description.substring(0, 120)}`);
      if (step.dependsOn.length > 0) {
        lines.push(`     Depends on: step(s) ${step.dependsOn.map((d) => d + 1).join(', ')}`);
      }
    }

    return lines.join('\n');
  }
}
