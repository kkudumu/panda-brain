import type { NormalizedResponse, SessionOpts, ToolCall } from '../shared/types.js';
import { BaseAdapter } from './base.js';

interface CodexJsonOutput {
  response?: string;
  output?: string;
  content?: string;
  tool_calls?: Array<{
    name?: string;
    function?: {
      name: string;
      arguments: string | Record<string, unknown>;
    };
    arguments?: Record<string, unknown>;
    result?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
  id?: string;
  // Codex exec output format
  choices?: Array<{
    message?: {
      content?: string;
      role?: string;
      tool_calls?: Array<{
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}

export class CodexAdapter extends BaseAdapter {
  name = 'codex';

  async available(): Promise<boolean> {
    return this.checkBinary('codex');
  }

  async startSession(prompt: string, opts?: SessionOpts): Promise<NormalizedResponse> {
    const args = ['exec', prompt, '--json'];
    if (opts?.model) args.push('-m', opts.model);

    const result = await this.spawnCli('codex', args, { cwd: opts?.workingDir });

    if (result.exitCode !== 0 && result.stdout.trim() === '') {
      const response = this.emptyResponse();
      response.text = result.stderr || `Codex exited with code ${result.exitCode}`;
      return response;
    }

    return this.parseResponse(result.stdout || result.stderr);
  }

  async resumeSession(_sessionId: string, prompt: string): Promise<NormalizedResponse> {
    // Codex doesn't have native session resumption — start a new session with context
    return this.startSession(prompt);
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

    let parsed: CodexJsonOutput;
    try {
      parsed = JSON.parse(jsonMatch[0]) as CodexJsonOutput;
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
    if (parsed.response) {
      text = parsed.response;
    } else if (parsed.output) {
      text = parsed.output;
    } else if (parsed.content) {
      text = parsed.content;
    } else if (parsed.choices && parsed.choices.length > 0) {
      text = parsed.choices[0].message?.content ?? '';
    }

    // Extract tool calls
    const toolCalls: ToolCall[] = [];

    if (parsed.tool_calls) {
      for (const tc of parsed.tool_calls) {
        const name = tc.name ?? tc.function?.name ?? '';
        let args: Record<string, unknown> = tc.arguments ?? {};
        if (tc.function?.arguments && typeof tc.function.arguments === 'string') {
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            args = { raw: tc.function.arguments };
          }
        } else if (tc.function?.arguments && typeof tc.function.arguments === 'object') {
          args = tc.function.arguments as Record<string, unknown>;
        }
        toolCalls.push({ name, arguments: args, result: tc.result });
      }
    }

    // Check choices for tool calls too
    if (parsed.choices && parsed.choices.length > 0) {
      const choiceToolCalls = parsed.choices[0].message?.tool_calls ?? [];
      for (const tc of choiceToolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          args = { raw: tc.function.arguments };
        }
        toolCalls.push({ name: tc.function.name, arguments: args });
      }
    }

    return {
      text,
      toolCalls,
      sessionId: '',
      // Codex may not provide token usage — return zeros
      tokenUsage: {
        input: parsed.usage?.prompt_tokens ?? 0,
        output: parsed.usage?.completion_tokens ?? 0,
        cached: 0,
      },
    };
  }
}
