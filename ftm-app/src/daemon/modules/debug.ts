import type {
  FtmModule,
  TaskContext,
  ModuleResult,
  FtmEvent,
  Experience,
} from '@shared/types.js';
import type { ModelRouter } from '../router.js';
import type { Blackboard } from '../blackboard.js';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Hypothesis {
  id: string;
  description: string;
  likelihood: ConfidenceLevel;
  investigationSteps: string[];
}

export interface InvestigationStep {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  findings?: string;
}

export interface DebugTimeline {
  startedAt: number;
  hypothesesGeneratedAt?: number;
  investigationStartedAt?: number;
  diagnosisReadyAt?: number;
  completedAt?: number;
}

export interface DiagnosisResult {
  rootCause: string;
  confidence: ConfidenceLevel;
  proposedFix: string;
  timeline: DebugTimeline;
  hypotheses: Hypothesis[];
  investigationSteps: InvestigationStep[];
}

/**
 * DebugModule — deep multi-vector debugging.
 *
 * Workflow:
 *  1. Parse the error/bug description from the task
 *  2. Ask the planning model to generate root-cause hypotheses
 *  3. Build investigation steps for each hypothesis
 *  4. Execute each investigation step through the execution model
 *  5. Ask the review model to synthesise a diagnosis + fix
 *  6. Record the debugging approach as an Experience in the blackboard
 */
export class DebugModule implements FtmModule {
  name = 'debug';

  private readonly router: ModelRouter;
  private readonly blackboard: Blackboard;

  constructor(router: ModelRouter, blackboard: Blackboard) {
    this.router = router;
    this.blackboard = blackboard;
  }

  // ---------------------------------------------------------------------------
  // FtmModule interface
  // ---------------------------------------------------------------------------

  canHandle(context: TaskContext): boolean {
    const desc = context.task.description.toLowerCase();
    return (
      desc.includes('debug') ||
      desc.includes('fix') ||
      desc.includes('error') ||
      desc.includes('bug') ||
      desc.includes('failing')
    );
  }

  async execute(
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<ModuleResult> {
    const timeline: DebugTimeline = { startedAt: Date.now() };

    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { module: this.name, taskId: context.task.id },
    });

    // ── Step 1: generate hypotheses ─────────────────────────────────────────
    emit({
      type: 'debug_phase',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { phase: 'hypothesising', taskId: context.task.id },
    });

    const hypotheses = await this.generateHypotheses(context.task.description);
    timeline.hypothesesGeneratedAt = Date.now();

    emit({
      type: 'debug_hypotheses',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: {
        hypotheses: hypotheses.map((h) => ({
          id: h.id,
          description: h.description,
          likelihood: h.likelihood,
        })),
      },
    });

    // ── Step 2: build investigation steps ───────────────────────────────────
    const steps = this.buildInvestigationSteps(hypotheses);
    timeline.investigationStartedAt = Date.now();

    emit({
      type: 'debug_phase',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { phase: 'investigating', taskId: context.task.id, stepCount: steps.length },
    });

    // ── Step 3: execute investigation steps ─────────────────────────────────
    await this.executeInvestigationSteps(steps, context, emit);

    // ── Step 4: synthesise diagnosis ─────────────────────────────────────────
    timeline.diagnosisReadyAt = Date.now();

    emit({
      type: 'debug_phase',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { phase: 'diagnosing', taskId: context.task.id },
    });

    const diagnosis = await this.synthesiseDiagnosis(
      context.task.description,
      hypotheses,
      steps,
    );

    timeline.completedAt = Date.now();

    // ── Step 5: record experience ────────────────────────────────────────────
    const experience: Omit<Experience, 'id' | 'timestamp'> = {
      taskType: 'debug',
      outcome: diagnosis.confidence !== 'low' ? 'success' : 'partial',
      lessons: [
        `Root cause identified as: ${diagnosis.rootCause}`,
        `Confidence: ${diagnosis.confidence}`,
        `Hypotheses explored: ${hypotheses.length}`,
      ],
      tags: ['debug', 'error-resolution'],
    };
    this.blackboard.writeExperience(experience);

    const result: DiagnosisResult = {
      rootCause: diagnosis.rootCause,
      confidence: diagnosis.confidence,
      proposedFix: diagnosis.proposedFix,
      timeline,
      hypotheses,
      investigationSteps: steps,
    };

    emit({
      type: 'debug_complete',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: {
        rootCause: result.rootCause,
        confidence: result.confidence,
        durationMs: timeline.completedAt - timeline.startedAt,
      },
    });

    return {
      success: true,
      output: this.formatDiagnosisOutput(result),
      artifacts: [
        {
          type: 'debug_diagnosis',
          path: '',
          content: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Hypothesis generation
  // ---------------------------------------------------------------------------

  private async generateHypotheses(errorDescription: string): Promise<Hypothesis[]> {
    try {
      const adapter = await this.router.route('planning');
      const response = await adapter.startSession(
        [
          'You are an expert debugger. Given the following error or bug description, generate 3-5 hypotheses about the root cause.',
          'For each hypothesis, provide:',
          '  - A clear description of what might be wrong',
          '  - Likelihood (high/medium/low)',
          '  - 2-3 concrete investigation steps',
          '',
          'Format your response as JSON array with shape:',
          '[{ "description": "...", "likelihood": "high|medium|low", "investigationSteps": ["step1", "step2"] }]',
          '',
          'Bug description:',
          errorDescription,
        ].join('\n'),
        {
          systemPrompt:
            'You are an expert software debugger. Always respond with valid JSON.',
          temperature: 0.3,
        },
      );

      return this.parseHypotheses(response.text);
    } catch {
      // Fallback: generate heuristic hypotheses from keywords
      return this.heuristicHypotheses(errorDescription);
    }
  }

  private parseHypotheses(raw: string): Hypothesis[] {
    try {
      // Extract JSON array from response text
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array found');

      const parsed = JSON.parse(match[0]) as Array<{
        description: string;
        likelihood: string;
        investigationSteps: string[];
      }>;

      return parsed.slice(0, 5).map((h) => ({
        id: randomUUID(),
        description: h.description,
        likelihood: (['high', 'medium', 'low'].includes(h.likelihood)
          ? h.likelihood
          : 'medium') as ConfidenceLevel,
        investigationSteps: Array.isArray(h.investigationSteps)
          ? h.investigationSteps
          : [],
      }));
    } catch {
      return this.heuristicHypotheses('');
    }
  }

  private heuristicHypotheses(errorDescription: string): Hypothesis[] {
    const desc = errorDescription.toLowerCase();
    const hypotheses: Hypothesis[] = [];

    if (desc.includes('null') || desc.includes('undefined') || desc.includes('cannot read')) {
      hypotheses.push({
        id: randomUUID(),
        description: 'Null or undefined reference — object accessed before initialisation',
        likelihood: 'high',
        investigationSteps: [
          'Check object initialisation order and constructor logic',
          'Add null checks around the failing access',
          'Inspect the call stack to find where the null is introduced',
        ],
      });
    }

    if (desc.includes('type') || desc.includes('cannot assign') || desc.includes('is not a function')) {
      hypotheses.push({
        id: randomUUID(),
        description: 'Type mismatch — wrong data type passed to or returned from a function',
        likelihood: 'high',
        investigationSteps: [
          'Check type annotations and runtime values at the error site',
          'Look for recent refactors that changed function signatures',
          'Run the TypeScript compiler and review all type errors',
        ],
      });
    }

    if (desc.includes('import') || desc.includes('module') || desc.includes('require')) {
      hypotheses.push({
        id: randomUUID(),
        description: 'Import or module resolution failure',
        likelihood: 'medium',
        investigationSteps: [
          'Verify the import path and file name casing',
          'Check package.json exports and tsconfig paths',
          'Confirm the dependency is installed in node_modules',
        ],
      });
    }

    // Always add a generic fallback
    hypotheses.push({
      id: randomUUID(),
      description: 'Logic error in recent code change',
      likelihood: 'medium',
      investigationSteps: [
        'Review git diff to identify recent changes near the error',
        'Add logging before and after the failing operation',
        'Write a minimal reproduction test case',
      ],
    });

    hypotheses.push({
      id: randomUUID(),
      description: 'Environment or configuration mismatch',
      likelihood: 'low',
      investigationSteps: [
        'Compare environment variables between working and failing environments',
        'Check for missing config files or wrong values',
        'Verify all required services are running and reachable',
      ],
    });

    return hypotheses;
  }

  // ---------------------------------------------------------------------------
  // Investigation steps
  // ---------------------------------------------------------------------------

  private buildInvestigationSteps(hypotheses: Hypothesis[]): InvestigationStep[] {
    const steps: InvestigationStep[] = [];

    // Lead with high-likelihood hypotheses
    const sorted = [...hypotheses].sort((a, b) => {
      const order: Record<ConfidenceLevel, number> = { high: 0, medium: 1, low: 2 };
      return order[a.likelihood] - order[b.likelihood];
    });

    for (const hypothesis of sorted) {
      for (const desc of hypothesis.investigationSteps) {
        steps.push({
          id: randomUUID(),
          description: `[${hypothesis.likelihood.toUpperCase()}] ${desc}`,
          status: 'pending',
        });
      }
    }

    return steps;
  }

  private async executeInvestigationSteps(
    steps: InvestigationStep[],
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<void> {
    // We execute each investigation step via the execution model.
    // Steps are run sequentially so findings from earlier steps can
    // inform later ones.
    let priorFindings = '';

    for (const step of steps) {
      step.status = 'running';
      step.startedAt = Date.now();

      emit({
        type: 'debug_step_started',
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: { stepId: step.id, description: step.description },
      });

      try {
        const adapter = await this.router.route('execution');
        const prompt = [
          `You are investigating a bug. Current investigation step:`,
          step.description,
          '',
          `Original bug description: ${context.task.description}`,
          priorFindings ? `\nFindings so far:\n${priorFindings}` : '',
          '',
          'Describe what you find and whether this step confirms or rules out the hypothesis.',
          'Be concise — 2-4 sentences.',
        ]
          .filter(Boolean)
          .join('\n');

        const response = await adapter.startSession(prompt, { temperature: 0.2 });

        step.findings = response.text;
        priorFindings += `\n- ${step.description}: ${response.text.substring(0, 200)}`;
      } catch {
        step.findings = 'Investigation step could not be executed (model unavailable).';
      }

      step.status = 'done';
      step.completedAt = Date.now();

      emit({
        type: 'debug_step_completed',
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: {
          stepId: step.id,
          findings: step.findings?.substring(0, 200),
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Diagnosis synthesis
  // ---------------------------------------------------------------------------

  private async synthesiseDiagnosis(
    errorDescription: string,
    hypotheses: Hypothesis[],
    steps: InvestigationStep[],
  ): Promise<{ rootCause: string; confidence: ConfidenceLevel; proposedFix: string }> {
    const investigationSummary = steps
      .map((s) => `- ${s.description}: ${s.findings ?? 'no findings'}`)
      .join('\n');

    try {
      const adapter = await this.router.route('review');
      const prompt = [
        'You are a senior engineer reviewing a debugging investigation.',
        'Based on the hypotheses and investigation findings below, provide:',
        '1. The most likely root cause (1-2 sentences)',
        '2. Your confidence level: high / medium / low',
        '3. A proposed fix (3-5 concrete steps)',
        '',
        'Format your response as JSON:',
        '{ "rootCause": "...", "confidence": "high|medium|low", "proposedFix": "..." }',
        '',
        `Bug description: ${errorDescription}`,
        '',
        'Hypotheses explored:',
        hypotheses.map((h) => `- [${h.likelihood}] ${h.description}`).join('\n'),
        '',
        'Investigation findings:',
        investigationSummary,
      ].join('\n');

      const response = await adapter.startSession(prompt, {
        systemPrompt:
          'You are a senior software engineer. Respond with valid JSON only.',
        temperature: 0.2,
      });

      return this.parseDiagnosis(response.text);
    } catch {
      return this.heuristicDiagnosis(hypotheses, steps);
    }
  }

  private parseDiagnosis(raw: string): {
    rootCause: string;
    confidence: ConfidenceLevel;
    proposedFix: string;
  } {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON object found');

      const parsed = JSON.parse(match[0]) as {
        rootCause: string;
        confidence: string;
        proposedFix: string;
      };

      return {
        rootCause: parsed.rootCause || 'Unknown root cause',
        confidence: (['high', 'medium', 'low'].includes(parsed.confidence)
          ? parsed.confidence
          : 'medium') as ConfidenceLevel,
        proposedFix: parsed.proposedFix || 'Review the investigation findings manually.',
      };
    } catch {
      return {
        rootCause: 'Could not parse model diagnosis',
        confidence: 'low',
        proposedFix: 'Review the investigation findings manually.',
      };
    }
  }

  private heuristicDiagnosis(
    hypotheses: Hypothesis[],
    steps: InvestigationStep[],
  ): { rootCause: string; confidence: ConfidenceLevel; proposedFix: string } {
    const topHypothesis = hypotheses.find((h) => h.likelihood === 'high') ?? hypotheses[0];
    const findingsWithContent = steps.filter((s) => s.findings && s.findings.length > 0);

    return {
      rootCause: topHypothesis
        ? `Most likely: ${topHypothesis.description}`
        : 'Root cause could not be determined without model access',
      confidence: 'low',
      proposedFix: findingsWithContent.length > 0
        ? `Review investigation findings: ${findingsWithContent
            .slice(0, 3)
            .map((s) => s.findings!.substring(0, 100))
            .join(' | ')}`
        : 'Run the investigation steps manually to gather findings.',
    };
  }

  // ---------------------------------------------------------------------------
  // Output formatting
  // ---------------------------------------------------------------------------

  private formatDiagnosisOutput(result: DiagnosisResult): string {
    const durationMs =
      (result.timeline.completedAt ?? Date.now()) - result.timeline.startedAt;
    const lines: string[] = [
      `=== Debug Diagnosis (${durationMs}ms) ===`,
      '',
      `Root Cause [${result.confidence.toUpperCase()} confidence]:`,
      result.rootCause,
      '',
      'Proposed Fix:',
      result.proposedFix,
      '',
      `Hypotheses explored: ${result.hypotheses.length}`,
      `Investigation steps executed: ${result.investigationSteps.filter((s) => s.status === 'done').length}`,
    ];
    return lines.join('\n');
  }
}
