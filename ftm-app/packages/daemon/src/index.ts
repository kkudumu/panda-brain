// Barrel export — everything other packages need from @ftm/daemon

// Core daemon entry
export { startDaemon } from './start.js';

// Core classes
export { FtmEventBus } from './event-bus.js';
export { FtmStore } from './store.js';
export { Blackboard } from './blackboard.js';
export { AdapterRegistry } from './adapters/registry.js';
export { ModelRouter } from './router.js';
export { OodaLoop } from './ooda.js';
export { FtmServer } from './server.js';

// Config helpers
export { getConfigPath, getDataDir, getDbPath, ensureDataDir, loadConfigFile, mergeConfig } from './config.js';

// Modules
export { createModuleRegistry } from './modules/index.js';

// Module classes (for direct use in tests)
export { GuardModule, type GuardRule, type GuardCheckResult } from './modules/guard.js';
export { MindModule } from './modules/mind.js';
export { PlannerModule } from './modules/planner.js';
export { ExecutorModule } from './modules/executor.js';
export { MemoryModule } from './modules/memory.js';
export { DailyLogModule } from './modules/daily-log.js';
export { CouncilModule } from './modules/council.js';
export { DebugModule } from './modules/debug.js';
export { BrowseModule } from './modules/browse.js';
export { CaptureModule } from './modules/capture.js';
export { VerifyModule } from './modules/verify.js';

// Hooks
export { registerAllHooks } from './hooks/index.js';

// Types — re-export everything from shared/types
export * from './shared/types.js';
