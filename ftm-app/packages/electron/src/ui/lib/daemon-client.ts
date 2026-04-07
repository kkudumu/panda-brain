import { writable, derived, type Writable, type Readable } from 'svelte/store';
import type {
  WsMessage, WsResponse, FtmEvent, MachineState,
  Task, Plan, BlackboardContext
} from '@ftm/daemon';

// Daemon state store
interface DaemonState {
  connected: boolean;
  machineState: MachineState;
  currentTask: Task | null;
  currentPlan: Plan | null;
  phase: string;
  blackboard: BlackboardContext | null;
  events: FtmEvent[];
}

const initialState: DaemonState = {
  connected: false,
  machineState: 'idle',
  currentTask: null,
  currentPlan: null,
  phase: 'idle',
  blackboard: null,
  events: [],
};

export const daemonState: Writable<DaemonState> = writable(initialState);

// Derived stores for specific pieces of state
export const machineState: Readable<MachineState> = derived(
  daemonState, $s => $s.machineState
);
export const currentTask: Readable<Task | null> = derived(
  daemonState, $s => $s.currentTask
);
export const currentPlan: Readable<Plan | null> = derived(
  daemonState, $s => $s.currentPlan
);
export const isConnected: Readable<boolean> = derived(
  daemonState, $s => $s.connected
);
export const recentEvents: Readable<FtmEvent[]> = derived(
  daemonState, $s => $s.events.slice(-50) // Keep last 50 events
);

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let messageId = 0;
const pendingRequests = new Map<string, {
  resolve: (value: WsResponse) => void;
  reject: (reason: Error) => void;
}>();

// Connect to the daemon WebSocket
export async function connect(
  port: number = 4040,
  host: string = 'localhost'
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(`ws://${host}:${port}`);

      ws.onopen = () => {
        daemonState.update(s => ({ ...s, connected: true }));
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsResponse = JSON.parse(event.data as string);
          handleMessage(msg);
        } catch (e) {
          console.error('[DaemonClient] Invalid message:', e);
        }
      };

      ws.onclose = () => {
        daemonState.update(s => ({ ...s, connected: false }));
        ws = null;
        // Auto-reconnect after 3 seconds
        reconnectTimer = setTimeout(() => {
          connect(port, host).catch(() => {});
        }, 3000);
      };

      ws.onerror = (_err) => {
        reject(new Error('WebSocket connection failed'));
      };
    } catch (e) {
      reject(e);
    }
  });
}

// Disconnect from daemon
export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  daemonState.set(initialState);
}

// Send a message and wait for response
export function send(type: string, payload: Record<string, unknown> = {}): Promise<WsResponse> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected to daemon'));
      return;
    }

    const id = `msg-${++messageId}`;
    const msg: WsMessage = {
      type: type as WsMessage['type'],
      id,
      payload,
    };

    pendingRequests.set(id, { resolve, reject });
    ws.send(JSON.stringify(msg));

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out`));
      }
    }, 30000);
  });
}

// Convenience methods
export async function submitTask(description: string): Promise<string> {
  const response = await send('submit_task', { description });
  return response.payload.taskId as string;
}

export async function approvePlan(planId: string): Promise<void> {
  await send('approve_plan', { planId });
}

export async function modifyPlan(
  planId: string,
  modifications: Record<string, unknown>
): Promise<void> {
  await send('modify_plan', { planId, modifications });
}

export async function cancelTask(taskId: string): Promise<void> {
  await send('cancel_task', { taskId });
}

export async function getState(): Promise<DaemonState> {
  const response = await send('get_state');
  return response.payload as unknown as DaemonState;
}

export async function getHistory(limit: number = 20): Promise<Task[]> {
  const response = await send('get_history', { limit });
  return response.payload.tasks as Task[];
}

// Handle incoming messages
function handleMessage(msg: WsResponse): void {
  // Check if it's a response to a pending request
  if (pendingRequests.has(msg.id)) {
    const { resolve, reject } = pendingRequests.get(msg.id)!;
    pendingRequests.delete(msg.id);
    if (msg.success) {
      resolve(msg);
    } else {
      reject(new Error(msg.error ?? 'Request failed'));
    }
    return;
  }

  // Handle broadcast messages
  switch (msg.type) {
    case 'state_snapshot':
      daemonState.update(s => ({
        ...s,
        machineState: (msg.payload.machineState as MachineState) ?? s.machineState,
        currentTask: (msg.payload.currentTask as Task | null) ?? s.currentTask,
        currentPlan: (msg.payload.currentPlan as Plan | null) ?? s.currentPlan,
        phase: (msg.payload.phase as string) ?? s.phase,
        blackboard: (msg.payload.blackboard as BlackboardContext | null) ?? s.blackboard,
      }));
      break;

    case 'machine_state':
      daemonState.update(s => ({
        ...s,
        machineState: msg.payload.state as MachineState,
      }));
      break;

    case 'event': {
      const event = msg.payload.event as FtmEvent;
      daemonState.update(s => ({
        ...s,
        events: [...s.events.slice(-99), event], // Cap at 100
      }));
      break;
    }
  }
}
