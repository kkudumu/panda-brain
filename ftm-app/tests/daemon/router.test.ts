import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ModelRouter } from '@ftm/daemon/router';
import { AdapterRegistry } from '@ftm/daemon/adapters';
import { FtmEventBus } from '@ftm/daemon/event-bus';
import type { ModelAdapter, NormalizedResponse } from '@ftm/daemon';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(name: string, available: boolean): ModelAdapter {
  return {
    name,
    available: vi.fn().mockResolvedValue(available),
    startSession: vi.fn().mockResolvedValue({
      text: `response from ${name}`,
      toolCalls: [],
      sessionId: 'sess-1',
      tokenUsage: { input: 0, output: 0, cached: 0 },
    } satisfies NormalizedResponse),
    resumeSession: vi.fn(),
    parseResponse: vi.fn(),
  };
}

function writeYaml(dir: string, filename: string, content: string): string {
  const path = join(dir, filename);
  writeFileSync(path, content, 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

describe('ModelRouter — config loading', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ftm-router-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses defaults when config file does not exist', () => {
    const registry = new AdapterRegistry();
    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus, join(tmpDir, 'nonexistent.yml'));

    const config = router.getConfig();
    expect(config.profile).toBe('balanced');
    expect(config.execution.maxParallelAgents).toBe(5);
    expect(config.daemon.port).toBe(4040);
  });

  it('merges user config over defaults', () => {
    const configPath = writeYaml(
      tmpDir,
      'config.yml',
      `
profile: quality
daemon:
  port: 9090
`,
    );

    const registry = new AdapterRegistry();
    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus, configPath);

    const config = router.getConfig();
    expect(config.profile).toBe('quality');
    expect(config.daemon.port).toBe(9090);
    // Defaults preserved for keys not overridden
    expect(config.execution.maxParallelAgents).toBe(5);
  });

  it('preserves built-in profiles when none specified in file', () => {
    const configPath = writeYaml(tmpDir, 'config.yml', 'profile: budget\n');

    const registry = new AdapterRegistry();
    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus, configPath);

    expect(router.getActiveProfile().planning).toBe('gemini');
  });

  it('reloadConfig re-reads the file from disk', () => {
    const configPath = writeYaml(tmpDir, 'config.yml', 'profile: balanced\n');

    const registry = new AdapterRegistry();
    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus, configPath);

    expect(router.getConfig().profile).toBe('balanced');

    // Update the file on disk
    writeFileSync(configPath, 'profile: quality\n', 'utf8');
    router.reloadConfig();

    expect(router.getConfig().profile).toBe('quality');
  });
});

// ---------------------------------------------------------------------------
// getActiveProfile
// ---------------------------------------------------------------------------

describe('ModelRouter — getActiveProfile', () => {
  it('returns the correct profile for the active profile name', () => {
    const tmpDir2 = join(tmpdir(), `ftm-profile-test-${Date.now()}`);
    mkdirSync(tmpDir2, { recursive: true });
    const configPath = writeYaml(tmpDir2, 'config.yml', 'profile: quality\n');

    const registry = new AdapterRegistry();
    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus, configPath);

    const profile = router.getActiveProfile();
    expect(profile.planning).toBe('claude');
    expect(profile.execution).toBe('claude');
    expect(profile.review).toBe('claude');

    rmSync(tmpDir2, { recursive: true, force: true });
  });

  it('falls back to balanced when the profile name is unknown', () => {
    const tmpDir3 = join(tmpdir(), `ftm-fallback-test-${Date.now()}`);
    mkdirSync(tmpDir3, { recursive: true });
    const configPath = writeYaml(tmpDir3, 'config.yml', 'profile: nonexistent\n');

    const registry = new AdapterRegistry();
    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus, configPath);

    const profile = router.getActiveProfile();
    // Falls back to balanced defaults
    expect(['claude', 'codex', 'gemini', 'ollama']).toContain(profile.planning);

    rmSync(tmpDir3, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// route()
// ---------------------------------------------------------------------------

describe('ModelRouter — route()', () => {
  it('returns the correct adapter for execution role in balanced profile', async () => {
    const claudeAdapter = makeAdapter('claude', true);
    const codexAdapter = makeAdapter('codex', true);
    const geminiAdapter = makeAdapter('gemini', true);
    const ollamaAdapter = makeAdapter('ollama', false);

    const registry = new AdapterRegistry();
    registry.register(claudeAdapter);
    registry.register(codexAdapter);
    registry.register(geminiAdapter);
    registry.register(ollamaAdapter);

    const bus = new FtmEventBus('test');
    // balanced profile: execution → codex
    const router = new ModelRouter(registry, bus);

    const adapter = await router.route('execution');
    expect(adapter.name).toBe('codex');
  });

  it('returns the correct adapter for planning role in quality profile', async () => {
    const tmpDir4 = join(tmpdir(), `ftm-quality-test-${Date.now()}`);
    mkdirSync(tmpDir4, { recursive: true });
    const configPath = writeYaml(tmpDir4, 'config.yml', 'profile: quality\n');

    const claudeAdapter = makeAdapter('claude', true);
    const registry = new AdapterRegistry();
    registry.register(claudeAdapter);

    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus, configPath);

    const adapter = await router.route('planning');
    expect(adapter.name).toBe('claude');

    rmSync(tmpDir4, { recursive: true, force: true });
  });

  it('falls back to next available adapter when primary is unavailable', async () => {
    // balanced: execution → codex, but codex is unavailable → should fall back
    const claudeAdapter = makeAdapter('claude', true);
    const codexAdapter = makeAdapter('codex', false); // unavailable
    const geminiAdapter = makeAdapter('gemini', true);
    const ollamaAdapter = makeAdapter('ollama', false);

    const registry = new AdapterRegistry();
    registry.register(claudeAdapter);
    registry.register(codexAdapter);
    registry.register(geminiAdapter);
    registry.register(ollamaAdapter);

    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus);

    const adapter = await router.route('execution');
    // Falls back to claude (first in fallback order that isn't codex)
    expect(adapter.name).toBe('claude');
  });

  it('throws when no adapter is available for the role', async () => {
    const claudeAdapter = makeAdapter('claude', false);
    const codexAdapter = makeAdapter('codex', false);
    const geminiAdapter = makeAdapter('gemini', false);
    const ollamaAdapter = makeAdapter('ollama', false);

    const registry = new AdapterRegistry();
    registry.register(claudeAdapter);
    registry.register(codexAdapter);
    registry.register(geminiAdapter);
    registry.register(ollamaAdapter);

    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus);

    await expect(router.route('execution')).rejects.toThrow(
      /No model adapter available for role "execution"/,
    );
  });

  it('uses the override model when provided', async () => {
    const claudeAdapter = makeAdapter('claude', true);
    const ollamaAdapter = makeAdapter('ollama', true);

    const registry = new AdapterRegistry();
    registry.register(claudeAdapter);
    registry.register(ollamaAdapter);

    const bus = new FtmEventBus('test');
    const router = new ModelRouter(registry, bus);

    // Normally balanced execution → codex; override to ollama
    const adapter = await router.route('execution', 'ollama');
    expect(adapter.name).toBe('ollama');
  });

  it('emits model_selected event with correct payload', async () => {
    const claudeAdapter = makeAdapter('claude', true);
    const codexAdapter = makeAdapter('codex', true);
    const geminiAdapter = makeAdapter('gemini', true);
    const ollamaAdapter = makeAdapter('ollama', false);

    const registry = new AdapterRegistry();
    registry.register(claudeAdapter);
    registry.register(codexAdapter);
    registry.register(geminiAdapter);
    registry.register(ollamaAdapter);

    const bus = new FtmEventBus('test');
    const events: Array<Record<string, unknown>> = [];
    bus.on('model_selected', (evt) => events.push(evt.data));

    const router = new ModelRouter(registry, bus);
    await router.route('planning'); // balanced: planning → claude

    expect(events.length).toBeGreaterThanOrEqual(1);
    const evt = events[events.length - 1];
    expect(evt.role).toBe('planning');
    expect(evt.model).toBe('claude');
  });

  it('emits model_selected with fallback=true when falling back', async () => {
    const claudeAdapter = makeAdapter('claude', true);
    const codexAdapter = makeAdapter('codex', false); // unavailable
    const geminiAdapter = makeAdapter('gemini', false);
    const ollamaAdapter = makeAdapter('ollama', false);

    const registry = new AdapterRegistry();
    registry.register(claudeAdapter);
    registry.register(codexAdapter);
    registry.register(geminiAdapter);
    registry.register(ollamaAdapter);

    const bus = new FtmEventBus('test');
    const events: Array<Record<string, unknown>> = [];
    bus.on('model_selected', (evt) => events.push(evt.data));

    const router = new ModelRouter(registry, bus);
    // execution in balanced = codex (unavailable), so falls back to claude
    await router.route('execution');

    const evt = events[events.length - 1];
    expect(evt.fallback).toBe(true);
    expect(evt.originalModel).toBe('codex');
  });
});
