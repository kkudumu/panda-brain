import type { NormalizedResponse, SessionOpts, ToolCall } from '../shared/types.js';
import { BaseAdapter } from './base.js';

interface CodexJsonOutput {
  type?: string;
  response?: string;
  output?: string;
  content?: string;
  text?: string;
  message?: {
    content?: string;
  };
  delta?: string;
  final?: string;
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

    const parsedObjects = this.parseJsonObjects(trimmed);
    if (parsedObjects.length === 0) {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: '',
        tokenUsage: { input: 0, output: 0, cached: 0 },
      };
    }

    const toolCalls: ToolCall[] = [];
    const textParts: string[] = [];
    let lastParsed: CodexJsonOutput | null = null;

    for (const parsed of parsedObjects) {
      lastParsed = parsed;
      const text = this.extractText(parsed);
      if (text) {
        textParts.push(text);
      }

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
    }

    const dedupedText = Array.from(
      new Set(textParts.map((part) => part.trim()).filter(Boolean)),
    ).join('\n');

    return {
      text: dedupedText || trimmed,
      toolCalls,
      sessionId: '',
      tokenUsage: {
        input: lastParsed?.usage?.prompt_tokens ?? 0,
        output: lastParsed?.usage?.completion_tokens ?? 0,
        cached: 0,
      },
    };
  }

  private parseJsonObjects(raw: string): CodexJsonOutput[] {
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    const parsed: CodexJsonOutput[] = [];

    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as CodexJsonOutput);
      } catch {
        // Ignore non-JSON lines from the CLI.
      }
    }

    if (parsed.length > 0) {
      return parsed;
    }

    try {
      return [JSON.parse(raw) as CodexJsonOutput];
    } catch {
      return [];
    }
  }

  private extractText(parsed: CodexJsonOutput): string {
    if (parsed.response) return parsed.response;
    if (parsed.output) return parsed.output;
    if (parsed.content) return parsed.content;
    if (parsed.text) return parsed.text;
    if (parsed.final) return parsed.final;
    if (parsed.message?.content) return parsed.message.content;
    if (parsed.choices && parsed.choices.length > 0) {
      return parsed.choices[0].message?.content ?? '';
    }
    if (parsed.type === 'response.output_text.delta' && parsed.delta) {
      return parsed.delta;
    }
    return '';
  }
}
