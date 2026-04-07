import type { ModelAdapter } from '../shared/types.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';

export class AdapterRegistry {
  private adapters: Map<string, ModelAdapter> = new Map();
  private healthCache: Map<string, { available: boolean; checkedAt: number }> = new Map();
  private cacheTtl = 60_000; // 1 minute cache

  constructor() {
    // Register default adapters
    this.register(new ClaudeAdapter());
    this.register(new CodexAdapter());
    this.register(new GeminiAdapter());
    this.register(new OllamaAdapter());
  }

  register(adapter: ModelAdapter): void {
    this.adapters.set(adapter.name, adapter);
    // Invalidate cache entry when re-registering
    this.healthCache.delete(adapter.name);
  }

  get(name: string): ModelAdapter | undefined {
    return this.adapters.get(name);
  }

  getAll(): ModelAdapter[] {
    return Array.from(this.adapters.values());
  }

  // Check which adapters are currently available (with caching)
  async checkHealth(): Promise<Map<string, boolean>> {
    const now = Date.now();
    const results = new Map<string, boolean>();

    const checks = Array.from(this.adapters.entries()).map(async ([name, adapter]) => {
      const cached = this.healthCache.get(name);
      if (cached && now - cached.checkedAt < this.cacheTtl) {
        results.set(name, cached.available);
        return;
      }

      let available = false;
      try {
        available = await adapter.available();
      } catch {
        available = false;
      }

      this.healthCache.set(name, { available, checkedAt: Date.now() });
      results.set(name, available);
    });

    await Promise.all(checks);
    return results;
  }

  // Get health status for a specific adapter (with cache)
  async isAvailable(name: string): Promise<boolean> {
    const adapter = this.adapters.get(name);
    if (!adapter) return false;

    const now = Date.now();
    const cached = this.healthCache.get(name);
    if (cached && now - cached.checkedAt < this.cacheTtl) {
      return cached.available;
    }

    let available = false;
    try {
      available = await adapter.available();
    } catch {
      available = false;
    }

    this.healthCache.set(name, { available, checkedAt: Date.now() });
    return available;
  }

  // Get first available adapter from a preference list
  async getFirstAvailable(preferences: string[]): Promise<ModelAdapter | null> {
    for (const name of preferences) {
      const adapter = this.adapters.get(name);
      if (!adapter) continue;

      const available = await this.isAvailable(name);
      if (available) return adapter;
    }
    return null;
  }
}
