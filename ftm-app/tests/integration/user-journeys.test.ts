import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WsResponse } from '../../packages/daemon/src/index.js';
import {
  cleanupHarness,
  collectWsMessages,
  connectWs,
  createHarness,
  sendWs,
  type FtmHarness,
} from '../helpers/ftm-harness.js';

function isEventType(msg: WsResponse, targetType: string): boolean {
  if (msg.type !== 'event') return false;

  const event = msg.payload?.event as Record<string, unknown> | undefined;
  const data = event?.data as Record<string, unknown> | undefined;

  return event?.type === targetType || data?._eventType === targetType;
}

describe('FTM daemon user journeys', () => {
  let harness: FtmHarness | undefined;

  afterEach(() => {
    if (harness) {
      cleanupHarness(harness);
      harness = undefined;
    }
    vi.restoreAllMocks();
  });

  it('keeps a guarded production task pending until the user approves it, then records the result in history', async () => {
    harness = await createHarness({ approvalMode: 'plan_first', withHooks: true });
    const { ws } = await connectWs(harness.port);

    const approvalRequested = collectWsMessages(
      ws,
      (msg) => isEventType(msg, 'approval_requested'),
      5_000,
    );

    const submitResponse = await sendWs(ws, {
      type: 'submit_task',
      id: 'journey-submit',
      payload: {
        description: 'Delete stale cache files from the production cluster after verifying the release',
      },
    });

    expect(submitResponse.success).toBe(true);
    const taskId = submitResponse.payload.taskId as string;

    const approvalMessages = await approvalRequested;
    expect(approvalMessages.some((msg) => isEventType(msg, 'approval_requested'))).toBe(true);

    const pendingState = await sendWs(ws, {
      type: 'get_state',
      id: 'journey-state-before-approval',
      payload: {},
    });

    const currentPlan = pendingState.payload.currentPlan as {
      id: string;
      status: string;
      steps: Array<{ description: string; requiresApproval?: boolean }>;
    };

    expect(currentPlan.status).toBe('pending');
    expect(currentPlan.steps).toHaveLength(3);
    expect(currentPlan.steps.filter((step) => step.requiresApproval)).toHaveLength(2);
    expect(currentPlan.steps[2].description).toContain('Delete stale cache files');

    const approveResponse = await sendWs(ws, {
      type: 'approve_plan',
      id: 'journey-approve',
      payload: { planId: currentPlan.id },
    });

    expect(approveResponse.success).toBe(true);

    await vi.waitFor(() => {
      const task = harness!.store.getTask(taskId);
      expect(task?.status).toBe('completed');
      expect(task?.result).toContain('handled the step');
    }, { timeout: 5_000 });

    const historyResponse = await sendWs(ws, {
      type: 'get_history',
      id: 'journey-history',
      payload: { limit: 10 },
    });

    const history = historyResponse.payload.tasks as Array<{ id: string; status: string; description: string }>;
    const task = history.find((entry) => entry.id === taskId);

    expect(task).toBeDefined();
    expect(task?.status).toBe('completed');
    expect(task?.description).toContain('Delete stale cache files');

    ws.close();
  });

  it('writes an audit trail to daily_log entries when a user task completes', async () => {
    harness = await createHarness({ approvalMode: 'auto', withHooks: true });
    const { ws } = await connectWs(harness.port);

    const submitResponse = await sendWs(ws, {
      type: 'submit_task',
      id: 'journey-logs',
      payload: { description: 'Generate a release checklist for the next patch' },
    });

    const taskId = submitResponse.payload.taskId as string;

    await vi.waitFor(() => {
      const task = harness!.store.getTask(taskId);
      expect(task?.status).toBe('completed');
    }, { timeout: 5_000 });

    const logEntries = harness.store.getEventsByType('daily_log', 20);
    const categories = logEntries.map((entry) => entry.data.category);

    expect(categories).toContain('step');
    expect(categories).toContain('task');
    expect(logEntries.some((entry) => entry.data.taskId === taskId)).toBe(true);

    ws.close();
  });

  it('learns from repeated failures and surfaces the recurring problem on the blackboard', async () => {
    harness = await createHarness({
      approvalMode: 'auto',
      withHooks: true,
      adapterSpecs: {
        claude: { error: new Error('Model service unavailable') },
        codex: { error: new Error('Model service unavailable') },
        gemini: { error: new Error('Model service unavailable') },
        ollama: { error: new Error('Model service unavailable') },
      },
    });
    const { ws } = await connectWs(harness.port);

    for (let index = 0; index < 3; index += 1) {
      const response = await sendWs(ws, {
        type: 'submit_task',
        id: `journey-failure-${index}`,
        payload: { description: `Retry the failing sync job attempt ${index}` },
      });

      const taskId = response.payload.taskId as string;
      await vi.waitFor(() => {
        const task = harness!.store.getTask(taskId);
        expect(task?.status).toBe('failed');
      }, { timeout: 5_000 });
    }

    const blackboard = harness.blackboard.getContext();

    expect(blackboard.activeConstraints.some((constraint) => constraint.includes('Recurring error [unknown_error]'))).toBe(true);
    expect(blackboard.recentDecisions.some((decision) => decision.decision.includes('Escalated recurring error'))).toBe(true);

    ws.close();
  });
});
