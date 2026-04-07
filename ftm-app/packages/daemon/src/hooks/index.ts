import type { FtmEventBus } from '../event-bus.js';
import type { FtmStore } from '../store.js';
import type { Blackboard } from '../blackboard.js';
import { registerGuardHook } from './guard-hook.js';
import { registerAutoLogHook } from './auto-log-hook.js';
import { registerLearningCaptureHook } from './learning-capture-hook.js';
import { registerSessionEndHook } from './session-end-hook.js';
import { registerPlanGateHook } from './plan-gate-hook.js';

export function registerAllHooks(
  eventBus: FtmEventBus,
  store: FtmStore,
  blackboard: Blackboard
): void {
  registerGuardHook(eventBus, store);
  registerAutoLogHook(eventBus, store);
  registerLearningCaptureHook(eventBus, store, blackboard);
  registerSessionEndHook(eventBus, store, blackboard);
  registerPlanGateHook(eventBus);
}

export { registerGuardHook } from './guard-hook.js';
export { registerAutoLogHook } from './auto-log-hook.js';
export { registerLearningCaptureHook } from './learning-capture-hook.js';
export { registerSessionEndHook, executeSessionEnd } from './session-end-hook.js';
export { registerPlanGateHook } from './plan-gate-hook.js';
export type { SessionSummary } from './session-end-hook.js';
export type { PlanComplexityTier } from './plan-gate-hook.js';
