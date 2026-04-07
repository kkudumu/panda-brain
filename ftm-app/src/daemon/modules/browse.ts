import type { FtmModule, TaskContext, ModuleResult, FtmEvent } from '@shared/types.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrowseCommand = 'goto' | 'screenshot' | 'snapshot' | 'click' | 'type';

export interface BrowseAction {
  command: BrowseCommand;
  url?: string;
  selector?: string;
  text?: string;
  outputPath?: string;
}

export interface BrowseArtifact {
  type: 'screenshot' | 'snapshot' | 'aria_tree';
  path: string;
  content?: string;
}

/**
 * BrowseModule — headless browser automation.
 *
 * Delegates to the ftm-browse binary when available. Gracefully degrades
 * with a helpful install message when the binary is not found.
 *
 * Binary path: $HOME/.claude/skills/ftm-browse/bin/ftm-browse
 *
 * Supported task keywords: "browse", "screenshot", "visual", "check the app"
 */
export class BrowseModule implements FtmModule {
  name = 'browse';

  private readonly binaryPath: string;

  constructor(opts: { binaryPath?: string } = {}) {
    this.binaryPath =
      opts.binaryPath ??
      join(homedir(), '.claude', 'skills', 'ftm-browse', 'bin', 'ftm-browse');
  }

  // ---------------------------------------------------------------------------
  // FtmModule interface
  // ---------------------------------------------------------------------------

  canHandle(context: TaskContext): boolean {
    const desc = context.task.description.toLowerCase();
    return (
      desc.includes('browse') ||
      desc.includes('screenshot') ||
      desc.includes('visual') ||
      desc.includes('check the app')
    );
  }

  async execute(
    context: TaskContext,
    emit: (event: FtmEvent) => void,
  ): Promise<ModuleResult> {
    emit({
      type: 'module_activated',
      timestamp: Date.now(),
      sessionId: context.task.sessionId,
      data: { module: this.name, taskId: context.task.id },
    });

    // Check binary availability
    const available = await this.isBinaryAvailable();

    if (!available) {
      emit({
        type: 'browse_unavailable',
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: { binaryPath: this.binaryPath },
      });

      return {
        success: false,
        error: this.buildInstallMessage(),
      };
    }

    // Parse the requested actions from the task description
    const actions = this.parseActions(context.task.description);

    if (actions.length === 0) {
      return {
        success: false,
        error: [
          'No browser actions could be parsed from the task description.',
          'Try being more specific, e.g.:',
          '  - "browse to https://example.com and take a screenshot"',
          '  - "take a screenshot of https://myapp.local"',
          '  - "snapshot the ARIA tree of https://myapp.local"',
        ].join('\n'),
      };
    }

    const artifacts: BrowseArtifact[] = [];
    const outputs: string[] = [];

    for (const action of actions) {
      emit({
        type: 'browse_action_started',
        timestamp: Date.now(),
        sessionId: context.task.sessionId,
        data: { command: action.command, url: action.url ?? null },
      });

      try {
        const result = await this.executeAction(action);
        artifacts.push(...result.artifacts);
        outputs.push(result.output);

        emit({
          type: 'browse_action_completed',
          timestamp: Date.now(),
          sessionId: context.task.sessionId,
          data: {
            command: action.command,
            artifactCount: result.artifacts.length,
          },
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        emit({
          type: 'browse_action_failed',
          timestamp: Date.now(),
          sessionId: context.task.sessionId,
          data: { command: action.command, error: errorMsg },
        });
        outputs.push(`Action "${action.command}" failed: ${errorMsg}`);
      }
    }

    return {
      success: true,
      output: outputs.join('\n\n'),
      artifacts: artifacts.map((a) => ({
        type: a.type,
        path: a.path,
        content: a.content,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Binary availability
  // ---------------------------------------------------------------------------

  private async isBinaryAvailable(): Promise<boolean> {
    try {
      await access(this.binaryPath);
      return true;
    } catch {
      return false;
    }
  }

  private buildInstallMessage(): string {
    return [
      'ftm-browse binary not found.',
      '',
      `Expected location: ${this.binaryPath}`,
      '',
      'To install ftm-browse:',
      '  1. Run the ftm-browse skill installer:',
      '       /ftm-browse install',
      '  2. Or manually place the binary at:',
      `       ${this.binaryPath}`,
      '  3. Ensure the binary is executable:',
      `       chmod +x ${this.binaryPath}`,
      '',
      'Once installed, re-run this task to proceed with browser automation.',
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Action parsing
  // ---------------------------------------------------------------------------

  private parseActions(description: string): BrowseAction[] {
    const actions: BrowseAction[] = [];
    const desc = description.toLowerCase();

    // Extract URLs from the description
    const urlMatch = description.match(/https?:\/\/[^\s"']+/g);
    const primaryUrl = urlMatch?.[0];

    if (desc.includes('screenshot')) {
      actions.push({
        command: 'screenshot',
        url: primaryUrl,
        outputPath: this.defaultOutputPath('screenshot', 'png'),
      });
    } else if (desc.includes('snapshot') || desc.includes('aria')) {
      actions.push({
        command: 'snapshot',
        url: primaryUrl,
        outputPath: this.defaultOutputPath('snapshot', 'json'),
      });
    } else if (
      desc.includes('browse') ||
      desc.includes('goto') ||
      desc.includes('navigate') ||
      desc.includes('check the app')
    ) {
      if (primaryUrl) {
        // goto + screenshot is the most useful default
        actions.push({ command: 'goto', url: primaryUrl });
        actions.push({
          command: 'screenshot',
          url: primaryUrl,
          outputPath: this.defaultOutputPath('screenshot', 'png'),
        });
      }
    } else if (desc.includes('visual')) {
      // Generic "visual check" → goto + screenshot + snapshot
      if (primaryUrl) {
        actions.push({ command: 'goto', url: primaryUrl });
        actions.push({
          command: 'screenshot',
          url: primaryUrl,
          outputPath: this.defaultOutputPath('screenshot', 'png'),
        });
        actions.push({
          command: 'snapshot',
          url: primaryUrl,
          outputPath: this.defaultOutputPath('snapshot', 'json'),
        });
      }
    }

    return actions;
  }

  private defaultOutputPath(prefix: string, ext: string): string {
    const ts = Date.now();
    return join(homedir(), '.ftm', 'browse', `${prefix}-${ts}.${ext}`);
  }

  // ---------------------------------------------------------------------------
  // Action execution
  // ---------------------------------------------------------------------------

  private async executeAction(
    action: BrowseAction,
  ): Promise<{ output: string; artifacts: BrowseArtifact[] }> {
    const args = this.buildArgs(action);

    const { stdout, stderr } = await execFileAsync(this.binaryPath, args, {
      timeout: 30_000,
    });

    const output = stdout.trim() || stderr.trim();
    const artifacts: BrowseArtifact[] = [];

    // If an output path was provided, surface it as an artifact
    if (action.outputPath) {
      const artifactType = this.resolveArtifactType(action.command);
      artifacts.push({
        type: artifactType,
        path: action.outputPath,
        // Inline content for snapshots (JSON is usually small enough)
        content: action.command === 'snapshot' ? output : undefined,
      });
    }

    return { output, artifacts };
  }

  private buildArgs(action: BrowseAction): string[] {
    const args: string[] = [action.command];

    if (action.url) args.push('--url', action.url);
    if (action.outputPath) args.push('--output', action.outputPath);
    if (action.selector) args.push('--selector', action.selector);
    if (action.text) args.push('--text', action.text);

    return args;
  }

  private resolveArtifactType(
    command: BrowseCommand,
  ): BrowseArtifact['type'] {
    switch (command) {
      case 'screenshot':
        return 'screenshot';
      case 'snapshot':
        return 'aria_tree';
      default:
        return 'snapshot';
    }
  }
}
