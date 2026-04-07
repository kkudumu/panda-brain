import { FtmEventBus } from './event-bus.js';
import { FtmStore } from './store.js';
import { Blackboard } from './blackboard.js';
import { AdapterRegistry } from './adapters/registry.js';
import { ModelRouter } from './router.js';
import { OodaLoop } from './ooda.js';
import { FtmServer } from './server.js';
import { MindModule } from './modules/mind.js';
import { GuardModule } from './modules/guard.js';
import { PlannerModule } from './modules/planner.js';
import { ensureDataDir, getDbPath, getConfigPath } from './config.js';
import { registerAllHooks } from './hooks/index.js';

export async function startDaemon(): Promise<{
  server: FtmServer;
  eventBus: FtmEventBus;
  store: FtmStore;
}> {
  const sessionId = `ftm-${Date.now()}`;
  console.log(`[FTM Daemon] Starting... session=${sessionId}`);

  // Ensure data directory exists
  ensureDataDir();

  // Initialize core components
  const eventBus = new FtmEventBus(sessionId);
  const store = new FtmStore(getDbPath());
  const blackboard = new Blackboard(store);
  const registry = new AdapterRegistry();
  const router = new ModelRouter(registry, eventBus, getConfigPath());

  // Check available adapters
  const health = await registry.checkHealth();
  console.log('[FTM Daemon] Adapter health:', Object.fromEntries(health));

  // Register event-driven hooks (pre-execution gates, logging, learning)
  registerAllHooks(eventBus, store, blackboard);

  // Initialize OODA loop with modules
  const ooda = new OodaLoop(eventBus, blackboard, router);
  ooda.registerModule(new GuardModule());
  ooda.registerModule(new PlannerModule());
  ooda.registerModule(new MindModule()); // Default catch-all, registered last

  // Create and start server
  const config = router.getConfig();
  const server = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
  await server.start(config.daemon.port, config.daemon.host);

  // Create session record
  store.createSession(sessionId);

  console.log(`[FTM Daemon] Ready. Session=${sessionId}`);

  return { server, eventBus, store };
}

// Auto-start if run directly
const isMain = process.argv[1]?.endsWith('start.ts') || process.argv[1]?.endsWith('start.js');
if (isMain) {
  startDaemon().catch(err => {
    console.error('[FTM Daemon] Fatal:', err);
    process.exit(1);
  });
}
