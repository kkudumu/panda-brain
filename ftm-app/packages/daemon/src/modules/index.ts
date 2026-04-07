/**
 * Module Registry — central instantiation and registration point for all
 * FTM daemon modules.
 *
 * The registry wires together all modules in the correct execution order
 * and injects shared infrastructure (store, blackboard, router) into the
 * modules that need them.
 *
 * Execution order:
 *   1. GuardModule    — safety pre-flight checks, always first
 *   2. PlannerModule  — task decomposition for complex work
 *   3. ExecutorModule — step-by-step plan execution
 *   4. MemoryModule   — explicit memory read/write commands
 *   5. DailyLogModule — activity logging and daily summaries
 *   6. CouncilModule  — multi-model deliberation (stretch, v1)
 *   7. DebugModule    — deep multi-vector debugging (stretch, v1)
 *   8. BrowseModule   — headless browser automation (stretch, v1)
 *   9. CaptureModule  — playbook capture from task history (stretch, v1)
 *  10. VerifyModule   — post-execution verification (stretch, v1)
 *  11. MindModule     — intent classification + catch-all, always last
 */

import type { FtmModule } from '../shared/types.js';
import type { Blackboard } from '../blackboard.js';
import type { FtmStore } from '../store.js';
import type { ModelRouter } from '../router.js';

import { GuardModule }    from './guard.js';
import { PlannerModule }  from './planner.js';
import { ExecutorModule } from './executor.js';
import { MemoryModule }   from './memory.js';
import { DailyLogModule } from './daily-log.js';
import { CouncilModule }  from './council.js';
import { DebugModule }    from './debug.js';
import { BrowseModule }   from './browse.js';
import { CaptureModule }  from './capture.js';
import { VerifyModule }   from './verify.js';
import { MindModule }     from './mind.js';

// ---------------------------------------------------------------------------
// Registry options
// ---------------------------------------------------------------------------

export interface ModuleRegistryOptions {
  /** ModelRouter for dispatching steps to adapters (ExecutorModule, CouncilModule, DebugModule, VerifyModule) */
  router?: ModelRouter;
  /** Blackboard for memory operations (MemoryModule, DebugModule) */
  blackboard?: Blackboard;
  /** FtmStore for persistence (MemoryModule, DailyLogModule, CaptureModule) */
  store?: FtmStore;
  /** Maximum deliberation rounds for CouncilModule (default 3) */
  councilMaxRounds?: number;
  /** History window size for CaptureModule (default 10) */
  captureHistoryWindow?: number;
  /** Minimum pattern repetitions for CaptureModule (default 2) */
  captureMinPatternCount?: number;
  /** Override path for the ftm-browse binary */
  browseBinaryPath?: string;
}

// ---------------------------------------------------------------------------
// Instantiated registry
// ---------------------------------------------------------------------------

export interface ModuleRegistry {
  modules:  FtmModule[];
  guard:    GuardModule;
  planner:  PlannerModule;
  executor: ExecutorModule;
  memory:   MemoryModule;
  dailyLog: DailyLogModule;
  council:  CouncilModule;
  debug:    DebugModule;
  browse:   BrowseModule;
  capture:  CaptureModule;
  verify:   VerifyModule;
  mind:     MindModule;
}

/**
 * Create and wire all FTM daemon modules in the correct order.
 *
 * Pass optional infrastructure dependencies via options; modules degrade
 * gracefully when dependencies are not yet available (e.g. during tests).
 *
 * @example
 * ```ts
 * const registry = createModuleRegistry({ router, blackboard, store });
 * for (const module of registry.modules) {
 *   ooda.registerModule(module);
 * }
 * ```
 */
export function createModuleRegistry(opts: ModuleRegistryOptions = {}): ModuleRegistry {
  const guard    = new GuardModule();
  const planner  = new PlannerModule();
  const executor = new ExecutorModule();
  const memory   = new MemoryModule();
  const dailyLog = new DailyLogModule();
  const mind     = new MindModule();

  // Stretch modules (v1) — require router/blackboard/store; each falls back
  // gracefully when its dependency is absent by accepting optional args.
  const council = opts.router
    ? new CouncilModule(opts.router, { maxRounds: opts.councilMaxRounds })
    : new CouncilModule(undefined as unknown as ModelRouter); // stub — canHandle always false

  const debug = opts.router && opts.blackboard
    ? new DebugModule(opts.router, opts.blackboard)
    : new DebugModule(
        undefined as unknown as ModelRouter,
        undefined as unknown as Blackboard,
      );

  const browse = new BrowseModule(
    opts.browseBinaryPath ? { binaryPath: opts.browseBinaryPath } : {},
  );

  const capture = opts.store
    ? new CaptureModule(opts.store, {
        historyWindow: opts.captureHistoryWindow,
        minPatternCount: opts.captureMinPatternCount,
      })
    : new CaptureModule(undefined as unknown as FtmStore);

  const verify = opts.router
    ? new VerifyModule(opts.router)
    : new VerifyModule(undefined as unknown as ModelRouter);

  // ── Dependency injection (core modules) ───────────────────────────────────

  if (opts.router) {
    executor.setRouter(opts.router);
  }

  if (opts.blackboard) {
    memory.setBlackboard(opts.blackboard);
  }

  if (opts.store) {
    memory.setStore(opts.store);
    dailyLog.setStore(opts.store);
  }

  // ── Ordered list for the OODA loop ─────────────────────────────────────────
  // Guard is always first (safety pre-flight).
  // Mind is always last (catch-all intent routing).
  const modules: FtmModule[] = [
    guard,
    planner,
    executor,
    memory,
    dailyLog,
    council,
    debug,
    browse,
    capture,
    verify,
    mind,
  ];

  return {
    modules,
    guard, planner, executor, memory, dailyLog,
    council, debug, browse, capture, verify,
    mind,
  };
}

// ---------------------------------------------------------------------------
// Re-exports — makes individual module classes importable from the barrel
// ---------------------------------------------------------------------------

export { GuardModule }    from './guard.js';
export { PlannerModule }  from './planner.js';
export { ExecutorModule } from './executor.js';
export { MemoryModule }   from './memory.js';
export { DailyLogModule } from './daily-log.js';
export { CouncilModule }  from './council.js';
export { DebugModule }    from './debug.js';
export { BrowseModule }   from './browse.js';
export { CaptureModule }  from './capture.js';
export { VerifyModule }   from './verify.js';
export { MindModule }     from './mind.js';
export type { GuardRule, GuardCheckResult }                        from './guard.js';
export type { RichPlanStep, DecomposedPlan, StepDomain }           from './planner.js';
export type { ExecutorOptions }                                    from './executor.js';
export type { DailyLogEntry, DailySummary }                        from './daily-log.js';
export type { CouncilPosition, CouncilRound }                      from './council.js';
export type { Hypothesis, InvestigationStep, DiagnosisResult }     from './debug.js';
export type { BrowseCommand, BrowseAction, BrowseArtifact }        from './browse.js';
export type { PatternGroup, ExtractedPlaybook }                    from './capture.js';
export type { CheckStatus, VerificationCheck, VerificationReport } from './verify.js';
export type { TaskIntent, IntentClassification }                   from './mind.js';
