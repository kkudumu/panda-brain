import type {
  FtmModule,
  TaskContext,
  ModuleResult,
  FtmEvent,
  ModelAdapter,
  NormalizedResponse,
} from '../shared/types.js';
import type { ModelRouter } from '../router.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CouncilPosition {
  model: string;
  response: string;
  sessionId: string;
}

export interface CouncilRound {
  round: number;
  positions: CouncilPosition[];
  agreement: 'consensus' | 'majority' | 'split';
  consensusText?: string;
}

/**
 * CouncilModule — multi-model deliberation.
 *
 * Routes the same problem to 2-3 different model adapters in parallel,
 * collects their responses, and synthesises a consensus or trade-off
 * summary depending on how much the models agree.
 *
 * A router instance must be injected at construction time so the module
 * can resolve live adapters without importing the global registry.
 */
export class CouncilModule implements FtmModule {
  name = 'council';

  private readonly router: ModelRouter;
  private readonly maxRounds: number;

  // Names of the three model slots to poll
  private readonly councilModels: string[] = ['claude', 'codex', 'gemini'];

  constructor(router: ModelRouter, opts: { maxRounds?: number } = {}) {
    this.router = router;
    this.maxRounds = opts.maxRounds ?? 3;
  }

  // ---------------------------------------------------------------------------
  // FtmModule interface
  // ---------------------------------------------------------------------------

  canHandle(context: TaskContext): boolean {
    const desc = context.task.description.toLowerCase();
    const triggerKeywords = ['council', 'second opinion', 'debate'];
    if (triggerKeywords.some((kw) => desc.includes(kw))) return true;

    // Also activate for xl complexity tasks
    const words = context.task.description.split(/\s+/).length;
    return words >= 200; // xl threshold mirrors ooda.ts classifyComplexity
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

    const prompt = context.task.description;
    const rounds: CouncilRound[] = [];

    for (let round = 1; round <= this.maxRounds; round++) {
      const positions = await this.pollModels(
        prompt,
        context.task.sessionId,
        context.task.workingDir,
      );

      const councilRound = this.evaluatePositions(round, positions);
      rounds.push(councilRound);

      emit({
        type: 'council_round',
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: {
          round,
          positions: positions.map((p) => ({
            model: p.model,
            excerpt: p.response.substring(0, 200),
          })),
          agreement: councilRound.agreement,
        },
      });

      // Early exit if we reached consensus or majority
      if (
        councilRound.agreement === 'consensus' ||
        councilRound.agreement === 'majority'
      ) {
        break;
      }
    }

    const finalRound = rounds[rounds.length - 1];
    const output = this.synthesisOutput(finalRound, rounds);

    return {
      success: true,
      output,
      artifacts: [
        {
          type: 'council_deliberation',
          path: '',
          content: JSON.stringify({ rounds, taskId: context.task.id }, null, 2),
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Ask each council model the same question in parallel.
   * Models that are unavailable are silently skipped so the council can
   * proceed with whatever subset is reachable.
   */
  private async pollModels(
    prompt: string,
    sessionId: string,
    workingDir?: string,
  ): Promise<CouncilPosition[]> {
    const roleMap: Array<{ model: string; role: 'planning' | 'execution' | 'review' }> = [
      { model: 'claude', role: 'planning' },
      { model: 'codex', role: 'execution' },
      { model: 'gemini', role: 'review' },
    ];

    const attempts = roleMap.map(async ({ model, role }) => {
      try {
        let adapter: ModelAdapter;
        try {
          adapter = await this.router.route(role, model);
        } catch {
          // Model not available — skip
          return null;
        }

        const response: NormalizedResponse = await adapter.startSession(
          `Council deliberation question:\n\n${prompt}\n\nProvide your analysis and recommendation.`,
          {
            systemPrompt:
              'You are participating in a multi-model council. Give your honest, independent assessment.',
            workingDir,
          },
        );

        return {
          model,
          response: response.text,
          sessionId: response.sessionId,
        } satisfies CouncilPosition;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(attempts);
    return results.filter((r): r is CouncilPosition => r !== null);
  }

  /**
   * Compare positions to determine agreement level.
   *
   * Agreement heuristic: we compare normalised text similarity using
   * bigram overlap. A simple approach that avoids external deps.
   */
  private evaluatePositions(round: number, positions: CouncilPosition[]): CouncilRound {
    if (positions.length === 0) {
      return { round, positions, agreement: 'split' };
    }

    if (positions.length === 1) {
      return {
        round,
        positions,
        agreement: 'consensus',
        consensusText: positions[0].response,
      };
    }

    const similarities = this.pairwiseSimilarities(positions);
    const avgSimilarity =
      similarities.reduce((a, b) => a + b, 0) / similarities.length;

    if (avgSimilarity >= 0.6) {
      // High agreement — return the response with most bigram overlap with others
      const bestIdx = this.findMostRepresentative(positions);
      return {
        round,
        positions,
        agreement: 'consensus',
        consensusText: positions[bestIdx].response,
      };
    }

    if (avgSimilarity >= 0.3 && positions.length >= 3) {
      // Majority — find the two most similar and use the better-scored one
      const majorityText = this.synthesizeMajority(positions);
      return {
        round,
        positions,
        agreement: 'majority',
        consensusText: majorityText,
      };
    }

    // All disagree — will be synthesised in synthesisOutput
    return { round, positions, agreement: 'split' };
  }

  private synthesisOutput(finalRound: CouncilRound, allRounds: CouncilRound[]): string {
    const totalRounds = allRounds.length;

    if (
      finalRound.agreement === 'consensus' ||
      finalRound.agreement === 'majority'
    ) {
      const label =
        finalRound.agreement === 'consensus'
          ? 'Council consensus'
          : 'Council majority';
      const models = finalRound.positions.map((p) => p.model).join(', ');
      return [
        `${label} reached after ${totalRounds} round(s) (models: ${models})`,
        '',
        finalRound.consensusText ?? '',
      ].join('\n');
    }

    // Split — synthesise trade-offs
    const lines: string[] = [
      `Council split after ${totalRounds} round(s). Trade-off summary:`,
      '',
    ];
    for (const pos of finalRound.positions) {
      lines.push(`[${pos.model.toUpperCase()}]`);
      lines.push(pos.response.substring(0, 500));
      lines.push('');
    }
    lines.push(
      'Recommendation: review the above positions and select the approach best suited to your constraints.',
    );
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Text similarity utilities
  // ---------------------------------------------------------------------------

  private bigrams(text: string): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);
    const result = new Set<string>();
    for (let i = 0; i < words.length - 1; i++) {
      result.add(`${words[i]} ${words[i + 1]}`);
    }
    return result;
  }

  private jaccardSimilarity(a: string, b: string): number {
    const bigramsA = this.bigrams(a);
    const bigramsB = this.bigrams(b);
    if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
    let intersection = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++;
    }
    const union = bigramsA.size + bigramsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private pairwiseSimilarities(positions: CouncilPosition[]): number[] {
    const sims: number[] = [];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        sims.push(this.jaccardSimilarity(positions[i].response, positions[j].response));
      }
    }
    return sims;
  }

  private findMostRepresentative(positions: CouncilPosition[]): number {
    const scores = positions.map((pos, i) => {
      let total = 0;
      for (let j = 0; j < positions.length; j++) {
        if (i !== j) total += this.jaccardSimilarity(pos.response, positions[j].response);
      }
      return total;
    });
    return scores.indexOf(Math.max(...scores));
  }

  private synthesizeMajority(positions: CouncilPosition[]): string {
    // Find the pair with the highest pairwise similarity
    let bestSim = -1;
    let bestPair: [number, number] = [0, 1];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const sim = this.jaccardSimilarity(positions[i].response, positions[j].response);
        if (sim > bestSim) {
          bestSim = sim;
          bestPair = [i, j];
        }
      }
    }
    // Return the longer of the two majority responses (more detail)
    const [a, b] = bestPair;
    return positions[a].response.length >= positions[b].response.length
      ? positions[a].response
      : positions[b].response;
  }
}
