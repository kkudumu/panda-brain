import type { NormalizedResponse, SessionOpts, ToolCall } from '@shared/types.js';
import { BaseAdapter } from './base.js';

interface ClaudeJsonOutput {
  type?: string;
  subtype?: string;
  result?: string;
  session_id?: string;
  cost_usd?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  is_error?: boolean;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  // Claude may also include tool use in the result
  tool_uses?: Array<{
    name: string;
    input: Record<string, unknown>;
    result?: string;
  }>;
}

export class ClaudeAdapter extends BaseAdapter {
  name = 'claude';

  async available(): Promise<boolean> {
    return this.checkBinary('claude');
  }

  async startSession(prompt: string, opts?: SessionOpts): Promise<NormalizedResponse> {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (opts?.model) args.push('--model', opts.model);
    if (opts?.maxTokens) args.push('--max-tokens', String(opts.maxTokens));
    if (opts?.systemPrompt) args.push('--system-prompt', opts.systemPrompt);

    const result = await this.spawnCli('claude', args, { cwd: opts?.workingDir });

    if (result.exitCode !== 0 && result.stdout.trim() === '') {
      const response = this.emptyResponse();
      response.text = result.stderr || `Claude exited with code ${result.exitCode}`;
      return response;
    }

    return this.parseResponse(result.stdout || result.stderr);
  }

  async resumeSession(sessionId: string, prompt: string): Promise<NormalizedResponse> {
    const args = ['-p', prompt, '--output-format', 'json', '--resume', sessionId];
    const result = await this.spawnCli('claude', args);

    if (result.exitCode !== 0 && result.stdout.trim() === '') {
      const response = this.emptyResponse(sessionId);
      response.text = result.stderr || `Claude exited with code ${result.exitCode}`;
      return response;
    }

    return this.parseResponse(result.stdout || result.stderr);
  }

  parseResponse(raw: string): NormalizedResponse {
    const trimmed = raw.trim();

    if (!trimmed) {
      return this.emptyResponse();
    }

    // Try to find a JSON object — Claude sometimes prefixes stdout with status lines
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Non-JSON output — treat raw text as the response
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: '',
        tokenUsage: { input: 0, output: 0, cached: 0 },
      };
    }

    let parsed: ClaudeJsonOutput;
    try {
      parsed = JSON.parse(jsonMatch[0]) as ClaudeJsonOutput;
    } catch {
      // Malformed JSON — return raw as text
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: '',
        tokenUsage: { input: 0, output: 0, cached: 0 },
      };
    }

    const toolCalls: ToolCall[] = (parsed.tool_uses ?? []).map((tu) => ({
      name: tu.name,
      arguments: tu.input,
      result: tu.result,
    }));

    return {
      text: parsed.result ?? '',
      toolCalls,
      sessionId: parsed.session_id ?? '',
      tokenUsage: {
        input: parsed.usage?.input_tokens ?? 0,
        output: parsed.usage?.output_tokens ?? 0,
        cached: parsed.usage?.cache_read_input_tokens ?? 0,
      },
      cost: parsed.cost_usd ?? parsed.total_cost_usd,
    };
  }
}
