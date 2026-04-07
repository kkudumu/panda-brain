import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseAdapter } from '../../packages/daemon/src/adapters/base.js';
import { ClaudeAdapter } from '../../packages/daemon/src/adapters/claude.js';
import { CodexAdapter } from '../../packages/daemon/src/adapters/codex.js';
import { GeminiAdapter } from '../../packages/daemon/src/adapters/gemini.js';
import { OllamaAdapter } from '../../packages/daemon/src/adapters/ollama.js';
import { AdapterRegistry } from '../../packages/daemon/src/adapters/registry.js';
import type { NormalizedResponse, SessionOpts, ModelAdapter } from '../../packages/daemon/src/index.js';

// ---------------------------------------------------------------------------
// Concrete implementation of BaseAdapter for testing abstract methods
// ---------------------------------------------------------------------------
class TestAdapter extends BaseAdapter {
  name = 'test';

  async available(): Promise<boolean> {
    return true;
  }

  async startSession(_prompt: string, _opts?: SessionOpts): Promise<NormalizedResponse> {
    return this.emptyResponse('test-session');
  }

  async resumeSession(_sessionId: string, _prompt: string): Promise<NormalizedResponse> {
    return this.emptyResponse('test-session');
  }

  parseResponse(_raw: string): NormalizedResponse {
    return this.emptyResponse();
  }

  // Expose protected methods for testing
  public exposedCheckBinary(binary: string): Promise<boolean> {
    return this.checkBinary(binary);
  }

  public exposedSpawnCli(
    command: string,
    args: string[],
    opts?: { cwd?: string; timeout?: number; stdin?: string },
  ) {
    return this.spawnCli(command, args, opts);
  }

  public exposedEmptyResponse(sessionId?: string): NormalizedResponse {
    return this.emptyResponse(sessionId);
  }
}

// ---------------------------------------------------------------------------
// BaseAdapter: checkBinary
// ---------------------------------------------------------------------------
describe('BaseAdapter.checkBinary', () => {
  it('returns true when binary exists in PATH', async () => {
    const adapter = new TestAdapter();
    // 'node' is always in PATH in a Node environment
    const result = await adapter.exposedCheckBinary('node');
    expect(result).toBe(true);
  });

  it('returns false when binary is not found', async () => {
    const adapter = new TestAdapter();
    const result = await adapter.exposedCheckBinary('__definitely_not_a_real_binary_xyz__');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BaseAdapter: spawnCli
// ---------------------------------------------------------------------------
describe('BaseAdapter.spawnCli', () => {
  it('collects stdout from a process', async () => {
    const adapter = new TestAdapter();
    const result = await adapter.exposedSpawnCli('node', ['-e', "process.stdout.write('hello')"], {});
    expect(result.stdout).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('collects stderr from a process', async () => {
    const adapter = new TestAdapter();
    const result = await adapter.exposedSpawnCli('node', [
      '-e',
      "process.stderr.write('err-output')",
    ], {});
    expect(result.stderr).toBe('err-output');
    expect(result.exitCode).toBe(0);
  });

  it('returns non-zero exit code on failure', async () => {
    const adapter = new TestAdapter();
    const result = await adapter.exposedSpawnCli('node', ['-e', 'process.exit(1)'], {});
    expect(result.exitCode).toBe(1);
  });

  it('passes stdin to the process', async () => {
    const adapter = new TestAdapter();
    // Read stdin and echo it back on stdout
    const result = await adapter.exposedSpawnCli(
      'node',
      ['-e', "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>process.stdout.write(d));"],
      { stdin: 'ping' },
    );
    expect(result.stdout).toBe('ping');
  });

  it('handles process that does not exist gracefully', async () => {
    const adapter = new TestAdapter();
    const result = await adapter.exposedSpawnCli('__not_a_binary__', [], {});
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Process error');
  });

  it('times out if process hangs', async () => {
    const adapter = new TestAdapter();
    const result = await adapter.exposedSpawnCli(
      'node',
      ['-e', 'setTimeout(()=>{},60000)'],
      { timeout: 100 },
    );
    // Should exit with 124 (timeout exit code)
    expect(result.exitCode).toBe(124);
  }, 5000);
});

// ---------------------------------------------------------------------------
// BaseAdapter: emptyResponse
// ---------------------------------------------------------------------------
describe('BaseAdapter.emptyResponse', () => {
  it('returns a valid empty NormalizedResponse', () => {
    const adapter = new TestAdapter();
    const response = adapter.exposedEmptyResponse();
    expect(response.text).toBe('');
    expect(response.toolCalls).toEqual([]);
    expect(response.sessionId).toBe('');
    expect(response.tokenUsage).toEqual({ input: 0, output: 0, cached: 0 });
  });

  it('uses the provided sessionId', () => {
    const adapter = new TestAdapter();
    const response = adapter.exposedEmptyResponse('my-session');
    expect(response.sessionId).toBe('my-session');
  });
});

// ---------------------------------------------------------------------------
// ClaudeAdapter: parseResponse
// ---------------------------------------------------------------------------
describe('ClaudeAdapter.parseResponse', () => {
  const adapter = new ClaudeAdapter();

  const sampleOutput = JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: 'Here is the answer...',
    session_id: 'abc123',
    cost_usd: 0.003,
    total_cost_usd: 0.003,
    duration_ms: 1500,
    duration_api_ms: 1200,
    num_turns: 1,
    is_error: false,
    usage: {
      input_tokens: 120,
      output_tokens: 85,
      cache_read_input_tokens: 30,
    },
  });

  it('parses a valid Claude JSON response', () => {
    const response = adapter.parseResponse(sampleOutput);
    expect(response.text).toBe('Here is the answer...');
    expect(response.sessionId).toBe('abc123');
    expect(response.tokenUsage.input).toBe(120);
    expect(response.tokenUsage.output).toBe(85);
    expect(response.tokenUsage.cached).toBe(30);
    expect(response.cost).toBe(0.003);
    expect(response.toolCalls).toEqual([]);
  });

  it('handles non-JSON output gracefully', () => {
    const response = adapter.parseResponse('Just some plain text output');
    expect(response.text).toBe('Just some plain text output');
    expect(response.toolCalls).toEqual([]);
    expect(response.sessionId).toBe('');
    expect(response.tokenUsage).toEqual({ input: 0, output: 0, cached: 0 });
  });

  it('handles empty string gracefully', () => {
    const response = adapter.parseResponse('');
    expect(response.text).toBe('');
    expect(response.sessionId).toBe('');
  });

  it('handles malformed JSON gracefully', () => {
    const response = adapter.parseResponse('{broken json: yes}');
    expect(response.text).toBeDefined();
    expect(response.toolCalls).toEqual([]);
  });

  it('extracts tool calls when present', () => {
    const withTools = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Done',
      session_id: 'sess-1',
      tool_uses: [
        {
          name: 'read_file',
          input: { path: '/tmp/test.txt' },
          result: 'file contents here',
        },
      ],
    });

    const response = adapter.parseResponse(withTools);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('read_file');
    expect(response.toolCalls[0].arguments).toEqual({ path: '/tmp/test.txt' });
    expect(response.toolCalls[0].result).toBe('file contents here');
  });

  it('uses total_cost_usd as fallback when cost_usd missing', () => {
    const output = JSON.stringify({
      type: 'result',
      result: 'ok',
      session_id: 'sess-2',
      total_cost_usd: 0.007,
    });
    const response = adapter.parseResponse(output);
    expect(response.cost).toBe(0.007);
  });
});

// ---------------------------------------------------------------------------
// CodexAdapter: parseResponse
// ---------------------------------------------------------------------------
describe('CodexAdapter.parseResponse', () => {
  const adapter = new CodexAdapter();

  it('parses a standard Codex JSON response', () => {
    const output = JSON.stringify({
      response: 'The function you need is...',
      usage: {
        prompt_tokens: 50,
        completion_tokens: 120,
      },
    });
    const response = adapter.parseResponse(output);
    expect(response.text).toBe('The function you need is...');
    expect(response.tokenUsage.input).toBe(50);
    expect(response.tokenUsage.output).toBe(120);
    expect(response.tokenUsage.cached).toBe(0);
  });

  it('parses OpenAI-style choices format', () => {
    const output = JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Here is the response via choices',
          },
        },
      ],
    });
    const response = adapter.parseResponse(output);
    expect(response.text).toBe('Here is the response via choices');
  });

  it('extracts tool calls from codex response', () => {
    const output = JSON.stringify({
      response: 'Using a tool',
      tool_calls: [
        {
          name: 'execute_code',
          arguments: { code: 'print("hello")', language: 'python' },
          result: 'hello\n',
        },
      ],
    });
    const response = adapter.parseResponse(output);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('execute_code');
    expect(response.toolCalls[0].arguments.code).toBe('print("hello")');
  });

  it('handles non-JSON output gracefully', () => {
    const response = adapter.parseResponse('raw text from codex');
    expect(response.text).toBe('raw text from codex');
    expect(response.tokenUsage).toEqual({ input: 0, output: 0, cached: 0 });
  });

  it('handles empty response gracefully', () => {
    const response = adapter.parseResponse('');
    expect(response.text).toBe('');
  });

  it('returns zeros for token usage when not provided', () => {
    const output = JSON.stringify({ response: 'minimal response' });
    const response = adapter.parseResponse(output);
    expect(response.tokenUsage).toEqual({ input: 0, output: 0, cached: 0 });
  });
});

// ---------------------------------------------------------------------------
// GeminiAdapter: parseResponse
// ---------------------------------------------------------------------------
describe('GeminiAdapter.parseResponse', () => {
  const adapter = new GeminiAdapter();

  it('parses a standard Gemini JSON response (result field)', () => {
    const output = JSON.stringify({
      result: 'Gemini says hello',
      session_id: 'gem-session-42',
      usage: {
        input_tokens: 60,
        output_tokens: 90,
        cache_read_input_tokens: 10,
      },
    });
    const response = adapter.parseResponse(output);
    expect(response.text).toBe('Gemini says hello');
    expect(response.sessionId).toBe('gem-session-42');
    expect(response.tokenUsage.input).toBe(60);
    expect(response.tokenUsage.output).toBe(90);
    expect(response.tokenUsage.cached).toBe(10);
  });

  it('parses candidates format', () => {
    const output = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: 'Part one. ' }, { text: 'Part two.' }],
            role: 'model',
          },
          finishReason: 'STOP',
        },
      ],
      usage: {
        prompt_token_count: 25,
        candidates_token_count: 40,
      },
    });
    const response = adapter.parseResponse(output);
    expect(response.text).toBe('Part one. Part two.');
    expect(response.tokenUsage.input).toBe(25);
    expect(response.tokenUsage.output).toBe(40);
  });

  it('handles alternative session_id field name sessionId', () => {
    const output = JSON.stringify({
      result: 'test',
      sessionId: 'alt-id-99',
    });
    const response = adapter.parseResponse(output);
    expect(response.sessionId).toBe('alt-id-99');
  });

  it('handles non-JSON output gracefully', () => {
    const response = adapter.parseResponse('Gemini plain text');
    expect(response.text).toBe('Gemini plain text');
    expect(response.toolCalls).toEqual([]);
  });

  it('handles empty response gracefully', () => {
    const response = adapter.parseResponse('');
    expect(response.text).toBe('');
  });

  it('extracts function calls from functionCalls field', () => {
    const output = JSON.stringify({
      result: 'called a function',
      functionCalls: [
        {
          name: 'search_web',
          args: { query: 'vitest mocking' },
        },
      ],
    });
    const response = adapter.parseResponse(output);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('search_web');
    expect(response.toolCalls[0].arguments).toEqual({ query: 'vitest mocking' });
  });
});

// ---------------------------------------------------------------------------
// OllamaAdapter: parseResponse
// ---------------------------------------------------------------------------
describe('OllamaAdapter.parseResponse', () => {
  const adapter = new OllamaAdapter();

  it('parses a standard Ollama chat response', () => {
    const output = JSON.stringify({
      model: 'llama3.1',
      created_at: '2024-01-01T00:00:00Z',
      message: {
        role: 'assistant',
        content: 'Hello from Ollama!',
      },
      done: true,
      done_reason: 'stop',
      total_duration: 5000000,
      prompt_eval_count: 45,
      eval_count: 80,
    });
    const response = adapter.parseResponse(output);
    expect(response.text).toBe('Hello from Ollama!');
    expect(response.tokenUsage.input).toBe(45);
    expect(response.tokenUsage.output).toBe(80);
    expect(response.tokenUsage.cached).toBe(0);
    expect(response.sessionId).toBe('');
  });

  it('parses streaming newline-delimited JSON (picks done=true line)', () => {
    const lines = [
      JSON.stringify({ model: 'llama3.1', message: { role: 'assistant', content: 'He' }, done: false }),
      JSON.stringify({ model: 'llama3.1', message: { role: 'assistant', content: 'llo' }, done: false }),
      JSON.stringify({
        model: 'llama3.1',
        message: { role: 'assistant', content: 'Hello final' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    ].join('\n');

    const response = adapter.parseResponse(lines);
    expect(response.text).toBe('Hello final');
    expect(response.tokenUsage.input).toBe(10);
    expect(response.tokenUsage.output).toBe(5);
  });

  it('handles empty response gracefully', () => {
    const response = adapter.parseResponse('');
    expect(response.text).toBe('');
  });

  it('handles non-JSON output gracefully', () => {
    const response = adapter.parseResponse('plain text from ollama');
    expect(response.text).toBe('plain text from ollama');
  });

  it('returns zero token counts when not provided', () => {
    const output = JSON.stringify({
      message: { role: 'assistant', content: 'minimal' },
      done: true,
    });
    const response = adapter.parseResponse(output);
    expect(response.tokenUsage).toEqual({ input: 0, output: 0, cached: 0 });
  });
});

// ---------------------------------------------------------------------------
// OllamaAdapter: available (mocked fetch)
// ---------------------------------------------------------------------------
describe('OllamaAdapter.available', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when Ollama API responds OK', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    } as Response);

    const adapter = new OllamaAdapter();
    const result = await adapter.available();
    expect(result).toBe(true);
  });

  it('returns false when Ollama API returns non-OK', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);

    const adapter = new OllamaAdapter();
    const result = await adapter.available();
    expect(result).toBe(false);
  });

  it('returns false when fetch throws (Ollama not running)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const adapter = new OllamaAdapter();
    const result = await adapter.available();
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AdapterRegistry: register and get
// ---------------------------------------------------------------------------
describe('AdapterRegistry.register and get', () => {
  it('registers default adapters in constructor', () => {
    const registry = new AdapterRegistry();
    expect(registry.get('claude')).toBeDefined();
    expect(registry.get('codex')).toBeDefined();
    expect(registry.get('gemini')).toBeDefined();
    expect(registry.get('ollama')).toBeDefined();
  });

  it('returns undefined for unknown adapter', () => {
    const registry = new AdapterRegistry();
    expect(registry.get('unknown-model')).toBeUndefined();
  });

  it('allows registering a custom adapter', () => {
    const registry = new AdapterRegistry();
    const custom = new TestAdapter();
    registry.register(custom);
    expect(registry.get('test')).toBe(custom);
  });

  it('getAll returns all registered adapters', () => {
    const registry = new AdapterRegistry();
    const all = registry.getAll();
    expect(all.length).toBeGreaterThanOrEqual(4);
    const names = all.map((a) => a.name);
    expect(names).toContain('claude');
    expect(names).toContain('codex');
    expect(names).toContain('gemini');
    expect(names).toContain('ollama');
  });

  it('replaces an existing adapter when registered again', () => {
    const registry = new AdapterRegistry();
    const adapter1 = new ClaudeAdapter();
    const adapter2 = new ClaudeAdapter();
    registry.register(adapter1);
    registry.register(adapter2);
    expect(registry.get('claude')).toBe(adapter2);
  });
});

// ---------------------------------------------------------------------------
// AdapterRegistry: checkHealth
// ---------------------------------------------------------------------------
describe('AdapterRegistry.checkHealth', () => {
  it('returns availability map for all adapters', async () => {
    const registry = new AdapterRegistry();

    // Replace adapters with mock versions
    const mockAvailable: ModelAdapter = {
      name: 'available-mock',
      available: vi.fn().mockResolvedValue(true),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    const mockUnavailable: ModelAdapter = {
      name: 'unavailable-mock',
      available: vi.fn().mockResolvedValue(false),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    // Create a fresh registry with only our mocks
    const freshRegistry = new AdapterRegistry();
    // Override the default adapters with our mocks
    freshRegistry.register(mockAvailable);
    freshRegistry.register(mockUnavailable);

    const health = await freshRegistry.checkHealth();
    expect(health.get('available-mock')).toBe(true);
    expect(health.get('unavailable-mock')).toBe(false);
  });

  it('caches health results to avoid repeated checks', async () => {
    const registry = new AdapterRegistry();

    const availableFn = vi.fn().mockResolvedValue(true);
    const mockAdapter: ModelAdapter = {
      name: 'cache-test',
      available: availableFn,
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    registry.register(mockAdapter);

    // Call twice
    await registry.checkHealth();
    await registry.checkHealth();

    // Should only have called available() once due to caching
    expect(availableFn).toHaveBeenCalledTimes(1);
  });

  it('handles adapters that throw in available()', async () => {
    const registry = new AdapterRegistry();

    const throwingAdapter: ModelAdapter = {
      name: 'throwing-mock',
      available: vi.fn().mockRejectedValue(new Error('binary not found')),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    registry.register(throwingAdapter);
    const health = await registry.checkHealth();
    expect(health.get('throwing-mock')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AdapterRegistry: getFirstAvailable
// ---------------------------------------------------------------------------
describe('AdapterRegistry.getFirstAvailable', () => {
  it('returns the first available adapter from preferences', async () => {
    const registry = new AdapterRegistry();

    const unavailable: ModelAdapter = {
      name: 'pref-unavailable',
      available: vi.fn().mockResolvedValue(false),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    const available: ModelAdapter = {
      name: 'pref-available',
      available: vi.fn().mockResolvedValue(true),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    registry.register(unavailable);
    registry.register(available);

    const result = await registry.getFirstAvailable(['pref-unavailable', 'pref-available']);
    expect(result?.name).toBe('pref-available');
  });

  it('returns null when none of the preferences are available', async () => {
    const registry = new AdapterRegistry();

    const unavailable1: ModelAdapter = {
      name: 'none-1',
      available: vi.fn().mockResolvedValue(false),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    const unavailable2: ModelAdapter = {
      name: 'none-2',
      available: vi.fn().mockResolvedValue(false),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    registry.register(unavailable1);
    registry.register(unavailable2);

    const result = await registry.getFirstAvailable(['none-1', 'none-2']);
    expect(result).toBeNull();
  });

  it('returns null for empty preferences list', async () => {
    const registry = new AdapterRegistry();
    const result = await registry.getFirstAvailable([]);
    expect(result).toBeNull();
  });

  it('skips adapters not in registry', async () => {
    const registry = new AdapterRegistry();

    const available: ModelAdapter = {
      name: 'skip-test-available',
      available: vi.fn().mockResolvedValue(true),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    registry.register(available);

    const result = await registry.getFirstAvailable(['does-not-exist', 'skip-test-available']);
    expect(result?.name).toBe('skip-test-available');
  });

  it('respects preference order and picks first available', async () => {
    const registry = new AdapterRegistry();

    const first: ModelAdapter = {
      name: 'order-first',
      available: vi.fn().mockResolvedValue(true),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    const second: ModelAdapter = {
      name: 'order-second',
      available: vi.fn().mockResolvedValue(true),
      startSession: vi.fn(),
      resumeSession: vi.fn(),
      parseResponse: vi.fn(),
    };

    registry.register(first);
    registry.register(second);

    const result = await registry.getFirstAvailable(['order-first', 'order-second']);
    expect(result?.name).toBe('order-first');
  });
});
