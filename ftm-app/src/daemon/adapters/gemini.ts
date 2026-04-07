import type { NormalizedResponse, SessionOpts, ToolCall } from '@shared/types.js';
import { BaseAdapter } from './base.js';

interface GeminiJsonOutput {
  // Gemini CLI --output-format json top-level fields
  result?: string;
  response?: string;
  text?: string;
  content?: string;
  session_id?: string;
  sessionId?: string;
  is_error?: boolean;
  error?: string;
  // Token usage — Gemini may use different field names than Claude
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_token_count?: number;
    candidates_token_count?: number;
    cached_content_token_count?: number;
    cache_read_input_tokens?: number;
  };
  // Some Gemini CLI versions nest under candidates
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
      role?: string;
    };
    finishReason?: string;
  }>;
  tool_calls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: string;
  }>;
  functionCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

export class GeminiAdapter extends BaseAdapter {
  name = 'gemini';

  async available(): Promise<boolean> {
    return this.checkBinary('gemini');
  }

  async startSession(prompt: string, opts?: SessionOpts): Promise<NormalizedResponse> {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (opts?.model) args.push('--model', opts.model);

    const result = await this.spawnCli('gemini', args, { cwd: opts?.workingDir });

    if (result.exitCode !== 0 && result.stdout.trim() === '') {
      const response = this.emptyResponse();
      response.text = result.stderr || `Gemini exited with code ${result.exitCode}`;
      return response;
    }

    return this.parseResponse(result.stdout || result.stderr);
  }

  async resumeSession(sessionId: string, prompt: string): Promise<NormalizedResponse> {
    // Gemini uses --resume with an index or session identifier
    const args = ['-p', prompt, '--output-format', 'json', '--resume', sessionId];
    const result = await this.spawnCli('gemini', args);

    if (result.exitCode !== 0 && result.stdout.trim() === '') {
      const response = this.emptyResponse(sessionId);
      response.text = result.stderr || `Gemini exited with code ${result.exitCode}`;
      return response;
    }

    return this.parseResponse(result.stdout || result.stderr);
  }

  parseResponse(raw: string): NormalizedResponse {
    const trimmed = raw.trim();

    if (!trimmed) {
      return this.emptyResponse();
    }

    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: '',
        tokenUsage: { input: 0, output: 0, cached: 0 },
      };
    }

    let parsed: GeminiJsonOutput;
    try {
      parsed = JSON.parse(jsonMatch[0]) as GeminiJsonOutput;
    } catch {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: '',
        tokenUsage: { input: 0, output: 0, cached: 0 },
      };
    }

    // Extract text from various possible fields
    let text = '';
    if (parsed.result) {
      text = parsed.result;
    } else if (parsed.response) {
      text = parsed.response;
    } else if (parsed.text) {
      text = parsed.text;
    } else if (parsed.content) {
      text = parsed.content;
    } else if (parsed.candidates && parsed.candidates.length > 0) {
      const parts = parsed.candidates[0].content?.parts ?? [];
      text = parts.map((p) => p.text ?? '').join('');
    }

    // Extract session ID
    const sessionId = parsed.session_id ?? parsed.sessionId ?? '';

    // Extract token usage — handle both naming conventions
    const usage = parsed.usage ?? {};
    const inputTokens =
      usage.input_tokens ?? usage.prompt_token_count ?? 0;
    const outputTokens =
      usage.output_tokens ?? usage.candidates_token_count ?? 0;
    const cachedTokens =
      usage.cache_read_input_tokens ?? usage.cached_content_token_count ?? 0;

    // Extract tool calls
    const toolCalls: ToolCall[] = [];

    if (parsed.tool_calls) {
      for (const tc of parsed.tool_calls) {
        toolCalls.push({
          name: tc.name,
          arguments: tc.arguments,
          result: tc.result,
        });
      }
    }

    if (parsed.functionCalls) {
      for (const fc of parsed.functionCalls) {
        toolCalls.push({
          name: fc.name,
          arguments: fc.args,
        });
      }
    }

    return {
      text,
      toolCalls,
      sessionId,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        cached: cachedTokens,
      },
    };
  }
}
