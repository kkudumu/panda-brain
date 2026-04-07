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

// Hooks
export { registerAllHooks } from './hooks/index.js';

// Types — re-export everything from shared/types
export * from './shared/types.js';
