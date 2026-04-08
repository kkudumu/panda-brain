import { describe, expect, it } from 'vitest';

import { reduceEvent } from '../../packages/electron/src/ui/lib/daemon-client.ts';

import type { FtmEvent } from '@ftm/daemon';

const initialState = {
  connected: true,
  machineState: 'idle',
  currentTask: null,
  currentPlan: null,
  phase: 'idle',
  blackboard: null,
  events: [],
} as const;

function makeEvent(type: string, data: Record<string, unknown> = {}): FtmEvent {
  return {
    type,
    timestamp: Date.now(),
    sessionId: 'test-session',
    data,
  };
}

describe('daemon-client event reduction', () => {
  it('normalizes wildcard events into typed UI events', () => {
    const state = reduceEvent(
      initialState,
      makeEvent('*', {
        _eventType: 'plan_generated',
        plan: {
          id: 'plan-1',
          taskId: 'task-1',
          status: 'pending',
          currentStep: 0,
          createdAt: Date.now(),
          steps: [{ index: 0, description: 'Say hello', status: 'pending' }],
        },
      }),
    );

    expect(state.events).toHaveLength(1);
    expect(state.events[0].type).toBe('plan_generated');
    expect(state.currentPlan?.id).toBe('plan-1');
  });

  it('moves the machine into approving when approval is requested', () => {
    const state = reduceEvent(
      initialState,
      makeEvent('*', {
        _eventType: 'approval_requested',
        reason: 'Manual review required',
      }),
    );

    expect(state.machineState).toBe('approving');
  });

  it('updates plan step status from execution events', () => {
    const withPlan = {
      ...initialState,
      currentPlan: {
        id: 'plan-1',
        taskId: 'task-1',
        status: 'approved',
        currentStep: 0,
        createdAt: Date.now(),
        steps: [
          { index: 0, description: 'Step 1', status: 'pending' },
          { index: 1, description: 'Step 2', status: 'pending' },
        ],
      },
    };

    const started = reduceEvent(
      withPlan,
      makeEvent('*', { _eventType: 'step_started', stepIndex: 0 }),
    );
    expect(started.machineState).toBe('executing');
    expect(started.currentPlan?.steps[0].status).toBe('in_progress');

    const completed = reduceEvent(
      started,
      makeEvent('*', { _eventType: 'step_completed', stepIndex: 0 }),
    );
    expect(completed.currentPlan?.steps[0].status).toBe('completed');
    expect(completed.currentPlan?.currentStep).toBe(1);
  });
});
