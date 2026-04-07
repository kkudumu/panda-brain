import type { NormalizedResponse, SessionOpts } from '@shared/types.js';
import { BaseAdapter } from './base.js';

interface OllamaMessage {
  role: string;
  content: string;
}

interface OllamaChatResponse {
  model?: string;
  created_at?: string;
  message?: OllamaMessage;
  done?: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string; modified_at: string; size: number }>;
}

export class OllamaAdapter extends BaseAdapter {
  name = 'ollama';
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:11434') {
    super();
    this.baseUrl = baseUrl;
  }

  async available(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }

  async startSession(prompt: string, opts?: SessionOpts): Promise<NormalizedResponse> {
    const model = opts?.model ?? 'llama3.1';
    const messages: OllamaMessage[] = [];

    if (opts?.systemPrompt) {
      messages.push({ role: 'system', content: opts.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const body = {
      model,
      messages,
      stream: false,
      ...(opts?.maxTokens ? { options: { num_predict: opts.maxTokens } } : {}),
    };

    try {
      const controller = new AbortController();
      const timeoutMs = 5 * 60 * 1000; // 5 minutes
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        const normalized = this.emptyResponse();
        normalized.text = `Ollama HTTP error ${response.status}: ${errorText}`;
        return normalized;
      }

      const text = await response.text();
      return this.parseResponse(text);
    } catch (err) {
      const normalized = this.emptyResponse();
      normalized.text = err instanceof Error ? err.message : 'Ollama request failed';
      return normalized;
    }
  }

  async resumeSession(_sessionId: string, prompt: string): Promise<NormalizedResponse> {
    // Ollama is stateless — just start a new session
    return this.startSession(prompt);
  }

  parseResponse(raw: string): NormalizedResponse {
    const trimmed = raw.trim();

    if (!trimmed) {
      return this.emptyResponse();
    }

    // Ollama may stream JSON lines — collect the last complete object or
    // the one that has done=true. When stream=false, we get a single object.
    let parsed: OllamaChatResponse | null = null;

    // Try parsing as a single JSON object first (stream: false)
    try {
      parsed = JSON.parse(trimmed) as OllamaChatResponse;
    } catch {
      // May be newline-delimited JSON (streaming) — find the done=true line
      const lines = trimmed.split('\n').filter((l) => l.trim());
      for (const line of lines.reverse()) {
        try {
          const obj = JSON.parse(line) as OllamaChatResponse;
          if (obj.done) {
            parsed = obj;
            break;
          }
          // Use first valid parse as fallback
          if (!parsed) {
            parsed = obj;
          }
        } catch {
          // Skip invalid lines
        }
      }
    }

    if (!parsed) {
      return {
        text: trimmed,
        toolCalls: [],
        sessionId: '',
        tokenUsage: { input: 0, output: 0, cached: 0 },
      };
    }

    return {
      text: parsed.message?.content ?? '',
      toolCalls: [],
      sessionId: '',
      tokenUsage: {
        // Ollama uses eval_count for output tokens and prompt_eval_count for input tokens
        input: parsed.prompt_eval_count ?? 0,
        output: parsed.eval_count ?? 0,
        cached: 0,
      },
    };
  }
}
