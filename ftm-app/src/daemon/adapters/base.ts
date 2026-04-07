import { spawn } from 'child_process';
import type { ModelAdapter, NormalizedResponse, SessionOpts } from '@shared/types.js';

export abstract class BaseAdapter implements ModelAdapter {
  abstract name: string;

  abstract available(): Promise<boolean>;
  abstract startSession(prompt: string, opts?: SessionOpts): Promise<NormalizedResponse>;
  abstract resumeSession(sessionId: string, prompt: string): Promise<NormalizedResponse>;
  abstract parseResponse(raw: string): NormalizedResponse;

  // Shared utility: check if a CLI binary exists
  protected async checkBinary(binary: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', [binary], { stdio: 'pipe' });
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  // Shared utility: spawn a CLI process and collect output
  protected async spawnCli(
    command: string,
    args: string[],
    opts?: {
      cwd?: string;
      timeout?: number;
      stdin?: string;
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const timeoutMs = opts?.timeout ?? 5 * 60 * 1000; // 5 minutes default

      const proc = spawn(command, args, {
        cwd: opts?.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode });
      };

      const timer = setTimeout(() => {
        if (!settled) {
          proc.kill('SIGTERM');
          // Give it a moment to clean up, then force kill
          setTimeout(() => {
            try {
              proc.kill('SIGKILL');
            } catch {
              // Already dead
            }
          }, 2000);
          finish(124); // 124 is the conventional timeout exit code
        }
      }, timeoutMs);

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        finish(code ?? 1);
      });

      proc.on('error', (err) => {
        stderr += `\nProcess error: ${err.message}`;
        finish(1);
      });

      if (opts?.stdin) {
        proc.stdin.write(opts.stdin);
        proc.stdin.end();
      } else {
        proc.stdin.end();
      }
    });
  }

  // Shared utility: create an empty normalized response
  protected emptyResponse(sessionId: string = ''): NormalizedResponse {
    return {
      text: '',
      toolCalls: [],
      sessionId,
      tokenUsage: { input: 0, output: 0, cached: 0 },
    };
  }
}
