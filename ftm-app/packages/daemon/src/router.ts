import type { FtmConfig, ModelProfile, ModelAdapter } from './shared/types.js';
import { AdapterRegistry } from './adapters/registry.js';
import { FtmEventBus } from './event-bus.js';
import { getConfigPath, loadConfigFile, mergeConfig } from './config.js';

// Default configuration used when no config file is present
const DEFAULT_CONFIG: FtmConfig = {
  profile: 'balanced',
  profiles: {
    quality: { planning: 'claude', execution: 'claude', review: 'claude' },
    balanced: { planning: 'claude', execution: 'codex', review: 'gemini' },
    budget: { planning: 'gemini', execution: 'ollama', review: 'ollama' },
  },
  execution: {
    maxParallelAgents: 5,
    autoAudit: true,
    progressTracking: true,
    approvalMode: 'plan_first',
  },
  daemon: { port: 4040, host: 'localhost' },
};

// Preference order for fallback when the primary model is unavailable
const FALLBACK_ORDER = ['claude', 'codex', 'gemini', 'ollama'] as const;

export class ModelRouter {
  private config: FtmConfig;
  private configPath: string;
  private registry: AdapterRegistry;
  private eventBus: FtmEventBus;

  constructor(
    registry: AdapterRegistry,
    eventBus: FtmEventBus,
    configPath?: string,
  ) {
    this.registry = registry;
    this.eventBus = eventBus;
    this.configPath = configPath ?? getConfigPath();
    this.config = this.loadConfig(this.configPath);
  }

  // ---------------------------------------------------------------------------
  // Config management
  // ---------------------------------------------------------------------------

  /**
   * Load config from the given path, falling back to defaults if the file
   * does not exist or cannot be parsed.
   */
  private loadConfig(configPath: string): FtmConfig {
    const overrides = loadConfigFile(configPath);
    if (!overrides) {
      return { ...DEFAULT_CONFIG };
    }
    return mergeConfig(DEFAULT_CONFIG, overrides);
  }

  /**
   * Returns the currently active FtmConfig.
   */
  getConfig(): FtmConfig {
    return this.config;
  }

  /**
   * Re-reads the config file from disk and updates the in-memory config.
   * Useful for hot-reloading without restarting the daemon.
   */
  reloadConfig(): void {
    this.config = this.loadConfig(this.configPath);
  }

  // ---------------------------------------------------------------------------
  // Profile access
  // ---------------------------------------------------------------------------

  /**
   * Returns the ModelProfile that corresponds to the active profile name.
   * Falls back to the 'balanced' profile if the named profile does not exist.
   */
  getActiveProfile(): ModelProfile {
    const profileName = this.config.profile;
    const profile = this.config.profiles[profileName];
    if (profile) {
      return profile;
    }

    // Fallback to 'balanced' if the named profile is missing
    const balanced = this.config.profiles['balanced'];
    if (balanced) {
      return balanced;
    }

    // Last-resort hard-coded balanced profile
    return { planning: 'claude', execution: 'codex', review: 'gemini' };
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * Route a task role to an adapter.
   *
   * @param role         - 'planning' | 'execution' | 'review'
   * @param overrideModel - Optional model name to use instead of the profile default
   * @returns            The first available ModelAdapter for the role
   * @throws             When no adapter is available at all
   */
  async route(role: keyof ModelProfile, overrideModel?: string): Promise<ModelAdapter> {
    const modelName = overrideModel ?? this.getActiveProfile()[role];

    // Try the primary / requested model first
    if (await this.registry.isAvailable(modelName)) {
      const adapter = this.registry.get(modelName);
      if (adapter) {
        this.eventBus.emitTyped('model_selected', {
          role,
          model: modelName,
          override: !!overrideModel,
        });
        return adapter;
      }
    }

    // Graceful fallback — iterate in preference order, skip the one we already tried
    for (const name of FALLBACK_ORDER) {
      if (name === modelName) continue; // already tried
      if (await this.registry.isAvailable(name)) {
        const adapter = this.registry.get(name);
        if (adapter) {
          this.eventBus.emitTyped('model_selected', {
            role,
            model: name,
            fallback: true,
            originalModel: modelName,
          });
          return adapter;
        }
      }
    }

    throw new Error(
      `No model adapter available for role "${role}". Configured: ${modelName}, none available.`,
    );
  }
}
