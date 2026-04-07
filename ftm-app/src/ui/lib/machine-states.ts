import type { MachineState, FtmEventType } from '../../shared/types.js';

export interface MachineAnimState {
  state: MachineState;
  frame: number;
  activeModel: string | null;
  subState: string | null; // e.g. 'memory_retrieval', 'playbook_check'
  fps: number;
}

// Map FtmEventType strings to human-readable sub-state labels
const EVENT_TO_SUBSTATE: Partial<Record<FtmEventType, string>> = {
  task_submitted:    'Receiving task...',
  memory_retrieved:  'Loading memory...',
  playbook_matched:  'Checking playbooks...',
  plan_generated:    'Plan generated',
  approval_requested:'Awaiting your approval',
  plan_approved:     'Plan approved',
  step_started:      'Step in progress...',
  model_selected:    'Selecting model...',
  tool_invoked:      'Invoking tool...',
  step_completed:    'Step complete',
  artifact_created:  'Artifact saved',
  guard_triggered:   'Safety guard triggered',
  loop_detected:     'Loop detected — halting',
  error:             'Error encountered',
  task_completed:    'Task complete!',
  memory_saved:      'Saving to memory...',
};

/**
 * Given a raw event type string, return the human-readable sub-state label,
 * or null if the event type is not mapped.
 */
export function getSubStateFromEvent(eventType: string): string | null {
  return EVENT_TO_SUBSTATE[eventType as FtmEventType] ?? null;
}

/**
 * Returns the animation FPS for each machine state.
 * Idle is slow (1 fps), executing is fast (8 fps).
 */
export function getFpsForState(state: MachineState): number {
  switch (state) {
    case 'idle':       return 1;
    case 'ingesting':  return 4;
    case 'thinking':   return 3;
    case 'executing':  return 8;
    case 'approving':  return 2;
    case 'complete':   return 2;
    case 'error':      return 3;
    default:           return 1;
  }
}

/**
 * Returns the Tailwind-compatible CSS color class name for each machine state.
 * These are used to colour the ASCII art and labels in the Machine component.
 */
export function getColorForState(state: MachineState): string {
  switch (state) {
    case 'idle':       return 'color-idle';
    case 'ingesting':  return 'color-ingesting';
    case 'thinking':   return 'color-thinking';
    case 'executing':  return 'color-executing';
    case 'approving':  return 'color-approving';
    case 'complete':   return 'color-complete';
    case 'error':      return 'color-error';
    default:           return 'color-idle';
  }
}
