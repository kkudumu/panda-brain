import { randomUUID } from 'crypto';
import type { FtmModule, TaskContext, ModuleResult, FtmEvent, Experience } from '../shared/types.js';

// ---------------------------------------------------------------------------
// Intent classification types
// ---------------------------------------------------------------------------

export type TaskIntent =
  | 'code'
  | 'debug'
  | 'research'
  | 'plan'
  | 'ops'
  | 'memory'
  | 'query'
  | 'freeform';

export interface IntentClassification {
  intent: TaskIntent;
  confidence: number;
  signals: string[];
  suggestedModules: string[];
}

// Keyword maps per intent domain
const INTENT_SIGNALS: Record<TaskIntent, string[]> = {
  code: [
    'implement', 'write', 'create', 'refactor', 'build', 'add function',
    'add method', 'fix bug', 'update code', 'edit file', 'typescript',
    'javascript', 'python', 'class', 'interface', 'module', 'component',
  ],
  debug: [
    'debug', 'error', 'exception', 'failing', 'broken', 'crash', 'issue',
    'problem', 'trace', 'stack trace', 'not working', 'fix', 'investigate',
    'diagnose', 'why is', 'what is causing',
  ],
  research: [
    'research', 'find', 'look up', 'search', 'what is', 'explain',
    'how does', 'summarize', 'compare', 'analyze', 'investigate', 'learn',
    'understand', 'documentation', 'docs',
  ],
  plan: [
    'plan', 'design', 'architect', 'strategy', 'roadmap', 'outline',
    'break down', 'decompose', 'organize', 'structure', 'steps to',
    'how to approach', 'what should i do',
  ],
  ops: [
    'deploy', 'run', 'execute', 'start', 'stop', 'restart', 'install',
    'configure', 'setup', 'migrate', 'backup', 'monitor', 'check status',
    'npm', 'git', 'docker', 'shell', 'script',
  ],
  memory: [
    'remember', 'recall', 'what did we', 'last time', 'previously',
    'save this', 'store', 'note that', 'log this', 'history',
  ],
  query: [
    'show me', 'list', 'get', 'fetch', 'retrieve', 'display', 'status',
    'current', 'recent', 'what are', 'how many',
  ],
  freeform: [],
};

// ---------------------------------------------------------------------------
// MindModule
// ---------------------------------------------------------------------------

/**
 * MindModule — the OODA routing brain and catch-all handler.
 *
 * Responsibilities:
 *   1. Classify incoming task intent from description text
 *   2. Select the ordered list of modules best suited for the task
 *   3. Check the blackboard for relevant experiences and playbooks
 *   4. Handle freeform tasks that don't match any specialized module
 *   5. Maintain a lightweight conversation context per session
 */
export class MindModule implements FtmModule {
  name = 'mind';

  // Session-scoped conversation context: sessionId → recent task descriptions
  private conversationContext: Map<string, string[]> = new Map();

  canHandle(_context: TaskContext): boolean {
    // Mind is the catch-all — it always accepts
    return true;
  }

  async execute(context: TaskContext, emit: (event: FtmEvent) => void): Promise<ModuleResult> {
    const { task, blackboard } = context;

    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: { module: this.name, taskId: task.id },
    });

    // ── 1. Update conversation context ──────────────────────────────────────
    this.pushConversationContext(task.sessionId, task.description);

    // ── 2. Classify intent ───────────────────────────────────────────────────
    const classification = this.classifyIntent(task.description);

    emit({
      type: 'model_selected',
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: {
        taskId: task.id,
        intent: classification.intent,
        confidence: classification.confidence,
        signals: classification.signals,
        suggestedModules: classification.suggestedModules,
      },
    });

    // ── 3. Check blackboard for relevant experiences ─────────────────────────
    const experiences = this.retrieveRelevantExperiences(context, classification);
    if (experiences.length > 0) {
      emit({
        type: 'memory_retrieved',
        timestamp: Date.now(),
        sessionId: task.sessionId,
        data: {
          taskId: task.id,
          experienceCount: experiences.length,
          taskTypes: [...new Set(experiences.map((e) => e.taskType))],
        },
      });
    }

    // ── 4. Check blackboard for matching playbook ────────────────────────────
    const playbook = blackboard.currentTask
      ? null // playbook check already done in OODA observe phase
      : null;

    // ── 5. Build routing decision ─────────────────────────────────────────────
    const routingOutput = this.buildRoutingOutput(
      classification,
      experiences,
      context,
    );

    // ── 6. Emit routing decision ──────────────────────────────────────────────
    emit({
      type: 'plan_generated',
      timestamp: Date.now(),
      sessionId: task.sessionId,
      data: {
        taskId: task.id,
        source: 'mind',
        intent: classification.intent,
        routing: routingOutput,
        playbook,
      },
    });

    return {
      success: true,
      output: routingOutput,
      artifacts: [
        {
          type: 'intent_classification',
          path: '',
          content: JSON.stringify(classification, null, 2),
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Classify the intent of a task description.
   * Returns the most likely intent with confidence and matched signals.
   */
  classifyIntent(description: string): IntentClassification {
    const lower = description.toLowerCase();
    const scores: Record<TaskIntent, number> = {
      code: 0,
      debug: 0,
      research: 0,
      plan: 0,
      ops: 0,
      memory: 0,
      query: 0,
      freeform: 0,
    };

    const matchedSignals: Record<TaskIntent, string[]> = {
      code: [],
      debug: [],
      research: [],
      plan: [],
      ops: [],
      memory: [],
      query: [],
      freeform: [],
    };

    for (const [intent, signals] of Object.entries(INTENT_SIGNALS) as [TaskIntent, string[]][]) {
      for (const signal of signals) {
        if (lower.includes(signal)) {
          scores[intent] += 1;
          matchedSignals[intent].push(signal);
        }
      }
    }

    // Find the highest-scoring intent
    let bestIntent: TaskIntent = 'freeform';
    let bestScore = 0;

    for (const [intent, score] of Object.entries(scores) as [TaskIntent, number][]) {
      if (intent === 'freeform') continue;
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    // Compute a rough confidence: score / number of signals for that domain
    const domainSignalCount = INTENT_SIGNALS[bestIntent].length || 1;
    const confidence = bestScore === 0
      ? 0.1
      : Math.min(0.95, bestScore / domainSignalCount + 0.3);

    return {
      intent: bestIntent,
      confidence: Math.round(confidence * 100) / 100,
      signals: matchedSignals[bestIntent],
      suggestedModules: this.selectModules(bestIntent, confidence),
    };
  }

  /**
   * Select the ordered list of module names to apply for an intent.
   * Guard is always first; Mind is always last.
   */
  selectModules(intent: TaskIntent, confidence = 0.5): string[] {
    const base = ['guard'];

    const intentRoutes: Record<TaskIntent, string[]> = {
      code:     ['planner', 'executor'],
      debug:    ['planner', 'executor'],
      research: ['executor'],
      plan:     ['planner'],
      ops:      ['planner', 'executor'],
      memory:   ['memory'],
      query:    ['memory', 'executor'],
      freeform: ['executor'],
    };

    const middle = intentRoutes[intent] ?? ['executor'];

    // For low-confidence or freeform, fall through to mind for direct handling
    if (confidence < 0.4 || intent === 'freeform') {
      return [...base, ...middle, 'daily-log', 'mind'];
    }

    return [...base, ...middle, 'daily-log', 'mind'];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private pushConversationContext(sessionId: string, description: string): void {
    const history = this.conversationContext.get(sessionId) ?? [];
    history.push(description);
    // Keep at most 10 recent turns per session
    if (history.length > 10) history.shift();
    this.conversationContext.set(sessionId, history);
  }

  private retrieveRelevantExperiences(
    context: TaskContext,
    classification: IntentClassification,
  ): Experience[] {
    try {
      // The blackboard findRelevantExperiences is accessible indirectly through the
      // context object; here we replicate the retrieval using available context data.
      const constraints = context.blackboard.activeConstraints;
      const tags = [classification.intent, ...constraints.slice(0, 3)];
      // Return empty — actual retrieval happens in the OODA observe phase via blackboard.
      // The mind module uses classification signals to advise routing.
      void tags; // used for future tag-based retrieval when blackboard is injectable
      return [];
    } catch {
      return [];
    }
  }

  private buildRoutingOutput(
    classification: IntentClassification,
    experiences: Experience[],
    context: TaskContext,
  ): string {
    const lines: string[] = [
      `Intent: ${classification.intent} (confidence: ${(classification.confidence * 100).toFixed(0)}%)`,
      `Signals matched: ${classification.signals.length > 0 ? classification.signals.join(', ') : 'none'}`,
      `Suggested pipeline: ${classification.suggestedModules.join(' → ')}`,
    ];

    if (experiences.length > 0) {
      lines.push(`Relevant experiences: ${experiences.length} found`);
    }

    const recentDecisions = context.blackboard.recentDecisions;
    if (recentDecisions.length > 0) {
      lines.push(`Recent decisions on blackboard: ${recentDecisions.length}`);
    }

    const sessionHistory = this.conversationContext.get(context.task.sessionId) ?? [];
    if (sessionHistory.length > 1) {
      lines.push(`Conversation turns in session: ${sessionHistory.length}`);
    }

    lines.push('');
    lines.push(`Routing task "${context.task.description.substring(0, 100)}${context.task.description.length > 100 ? '...' : ''}" via mind module.`);

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Conversation context access (for testing / external consumers)
  // ---------------------------------------------------------------------------

  getConversationHistory(sessionId: string): string[] {
    return this.conversationContext.get(sessionId) ?? [];
  }

  clearConversationHistory(sessionId: string): void {
    this.conversationContext.delete(sessionId);
  }
}

// Re-export for convenience
export { randomUUID };
