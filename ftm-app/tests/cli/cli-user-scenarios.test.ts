import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../packages/cli/src/index.js';
import {
  cleanupHarness,
  connectWs,
  createHarness,
  sendWs,
  type FtmHarness,
} from '../helpers/ftm-harness.js';

class ProcessExitError extends Error {
  constructor(public readonly code?: number) {
    super(`process.exit(${code ?? 'undefined'})`);
  }
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  return {
    logs,
    errors,
    restore() {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

async function runCli(argv: string[]) {
  const program = createProgram();
  await program.parseAsync(argv);
}

describe('FTM CLI user scenarios', () => {
  let harness: FtmHarness | undefined;
  let originalPort: string | undefined;

  beforeEach(() => {
    originalPort = process.env.FTM_DAEMON_PORT;
  });

  afterEach(() => {
    if (harness) {
      cleanupHarness(harness);
      harness = undefined;
    }

    if (originalPort === undefined) {
      delete process.env.FTM_DAEMON_PORT;
    } else {
      process.env.FTM_DAEMON_PORT = originalPort;
    }

    vi.restoreAllMocks();
  });

  it('shows the live daemon state, including the pending task and plan, through `ftm status`', async () => {
    harness = await createHarness({ approvalMode: 'plan_first', withHooks: true });
    process.env.FTM_DAEMON_PORT = String(harness.port);
    harness.blackboard.updateUserProfile((profile) => {
      profile.preferredName = 'Avery';
      profile.responseStyle = 'direct';
      profile.approvalPreference = 'streamlined';
      profile.activeProjects.push({ label: 'ftm-app', count: 3, lastSeen: Date.now() });
    });

    const { ws } = await connectWs(harness.port);
    await sendWs(ws, {
      type: 'submit_task',
      id: 'cli-status-submit',
      payload: {
        description: 'Delete stale cache files from the production cluster after verifying the release',
      },
    });

    await vi.waitFor(() => {
      const currentPlan = harness!.ooda.getCurrentPlan();
      expect(currentPlan?.status).toBe('pending');
    }, { timeout: 5_000 });

    const consoleCapture = captureConsole();
    await runCli(['node', 'ftm', 'status']);
    consoleCapture.restore();

    const output = consoleCapture.logs.join('\n');
    expect(output).toContain('FTM Daemon Status');
    expect(output).toContain('Machine:');
    expect(output).toContain('Task:    Delete stale cache files from the production cluster');
    expect(output).toContain('Plan:    Step 0/3');
    expect(output).toContain('User:    Avery · direct');
    expect(output).toContain('ftm-app');

    ws.close();
  });

  it('approves the pending plan through `ftm approve` and unblocks execution', async () => {
    harness = await createHarness({ approvalMode: 'plan_first', withHooks: true });
    process.env.FTM_DAEMON_PORT = String(harness.port);

    const { ws } = await connectWs(harness.port);
    const submitResponse = await sendWs(ws, {
      type: 'submit_task',
      id: 'cli-approve-submit',
      payload: { description: 'Delete the deprecated production job after archiving its output' },
    });
    const taskId = submitResponse.payload.taskId as string;

    await vi.waitFor(() => {
      expect(harness!.ooda.getCurrentPlan()?.status).toBe('pending');
    }, { timeout: 5_000 });

    const consoleCapture = captureConsole();
    await runCli(['node', 'ftm', 'approve']);
    consoleCapture.restore();

    expect(consoleCapture.logs.join('\n')).toContain('Plan approved. Execution starting...');

    await vi.waitFor(() => {
      expect(harness!.store.getTask(taskId)?.status).toBe('completed');
    }, { timeout: 5_000 });

    ws.close();
  });

  it('lists completed tasks through `ftm history` using the daemon history endpoint', async () => {
    harness = await createHarness({ approvalMode: 'auto', withHooks: true });
    process.env.FTM_DAEMON_PORT = String(harness.port);

    const { ws } = await connectWs(harness.port);
    const descriptions = [
      'Write release notes for version 1.2.3',
      'Review the monitoring dashboard for API latency regressions',
    ];

    for (const [index, description] of descriptions.entries()) {
      const submitResponse = await sendWs(ws, {
        type: 'submit_task',
        id: `cli-history-submit-${index}`,
        payload: { description },
      });
      const taskId = submitResponse.payload.taskId as string;

      await vi.waitFor(() => {
        expect(harness!.store.getTask(taskId)?.status).toBe('completed');
      }, { timeout: 5_000 });
    }

    const consoleCapture = captureConsole();
    await runCli(['node', 'ftm', 'history', '--limit', '5']);
    consoleCapture.restore();

    const output = consoleCapture.logs.join('\n');
    expect(output).toContain('Recent Tasks');
    expect(output).toContain(descriptions[0]);
    expect(output).toContain(descriptions[1]);
    expect(output).toContain('completed');

    ws.close();
  });

  it('prints a friendly error when `ftm status` cannot reach the daemon', async () => {
    process.env.FTM_DAEMON_PORT = '6553';
    const consoleCapture = captureConsole();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new ProcessExitError(typeof code === 'number' ? code : undefined);
    }) as unknown as ReturnType<typeof vi.spyOn>;

    await expect(runCli(['node', 'ftm', 'status'])).rejects.toMatchObject({
      code: 1,
    });

    consoleCapture.restore();
    exitSpy.mockRestore();

    expect(consoleCapture.logs.join('\n')).toContain('Daemon not running');
  });
});
