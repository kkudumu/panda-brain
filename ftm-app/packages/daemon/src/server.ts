import { WebSocketServer, WebSocket } from 'ws';
import type { WsMessage, WsResponse, FtmEvent, Task, MachineState } from './shared/types.js';
import { FtmEventBus } from './event-bus.js';
import { OodaLoop } from './ooda.js';
import { FtmStore } from './store.js';
import { Blackboard } from './blackboard.js';
import { synthesizeUserContext } from './profile-context.js';

export class FtmServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private eventBus: FtmEventBus;
  private ooda: OodaLoop;
  private store: FtmStore;
  private blackboard: Blackboard;
  private machineState: MachineState = 'idle';
  private sessionId: string;
  private taskCounter = 0;

  constructor(opts: {
    eventBus: FtmEventBus;
    ooda: OodaLoop;
    store: FtmStore;
    blackboard: Blackboard;
    sessionId?: string;
  }) {
    this.eventBus = opts.eventBus;
    this.ooda = opts.ooda;
    this.store = opts.store;
    this.blackboard = opts.blackboard;
    // Access the sessionId from the eventBus via reflection, or use provided value
    this.sessionId = opts.sessionId ?? (this.eventBus as unknown as { sessionId: string }).sessionId ?? `ftm-${Date.now()}`;
    this.setupEventForwarding();
  }

  // Start the WebSocket server
  start(port: number = 4040, host: string = 'localhost'): Promise<void> {
    return new Promise((resolve) => {
    this.wss = new WebSocketServer({ port, host }, () => resolve());

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      // Send current state on connect
      this.sendTo(ws, {
        type: 'state_snapshot',
        id: 'init',
        success: true,
        payload: this.getStateSnapshot(),
      });

      ws.on('message', (data) => {
        try {
          const msg: WsMessage = JSON.parse(data.toString());
          this.handleMessage(ws, msg);
        } catch (e) {
          this.sendTo(ws, {
            type: 'error',
            id: 'unknown',
            success: false,
            payload: {},
            error: 'Invalid message format',
          });
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });

    console.log(`[FTM Server] WebSocket listening on ${host}:${port}`);
    });
  }

  // Handle incoming WebSocket messages
  private async handleMessage(ws: WebSocket, msg: WsMessage): Promise<void> {
    switch (msg.type) {
      case 'submit_task': {
        const now = Date.now();
        const task: Task = {
          id: `task-${now}-${++this.taskCounter}`,
          description: msg.payload.description as string,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          sessionId: this.sessionId,
        };
        this.store.createTask(task);
        this.eventBus.emitTyped('task_submitted', { task });

        // Process task asynchronously
        this.processTaskAsync(task);

        this.sendTo(ws, {
          type: 'task_submitted',
          id: msg.id,
          success: true,
          payload: { taskId: task.id },
        });
        break;
      }

      case 'approve_plan': {
        const planId = msg.payload.planId as string;
        this.eventBus.emitTyped('plan_approved', { planId });
        this.sendTo(ws, {
          type: 'plan_approved',
          id: msg.id,
          success: true,
          payload: { planId },
        });
        break;
      }

      case 'modify_plan': {
        const planId = msg.payload.planId as string;
        const modifications = msg.payload.modifications as Record<string, unknown>;
        // Apply modifications to plan in store
        const plan = this.store.getPlan(planId);
        if (plan) {
          this.store.updatePlan(planId, modifications as Parameters<typeof this.store.updatePlan>[1]);
        }
        this.eventBus.emitTyped('plan_modified', { planId, modifications });
        this.sendTo(ws, {
          type: 'plan_modified',
          id: msg.id,
          success: true,
          payload: { planId, modifications },
        });
        break;
      }

      case 'cancel_task': {
        const taskId = msg.payload.taskId as string;
        this.store.updateTask(taskId, { status: 'cancelled', updatedAt: Date.now() });
        this.sendTo(ws, {
          type: 'task_cancelled',
          id: msg.id,
          success: true,
          payload: { taskId },
        });
        break;
      }

      case 'get_state': {
        this.sendTo(ws, {
          type: 'state_snapshot',
          id: msg.id,
          success: true,
          payload: this.getStateSnapshot(),
        });
        break;
      }

      case 'get_history': {
        const limit = (msg.payload.limit as number) ?? 20;
        const tasks = this.store.getRecentTasks(limit);
        this.sendTo(ws, {
          type: 'history',
          id: msg.id,
          success: true,
          payload: { tasks },
        });
        break;
      }

      default:
        this.sendTo(ws, {
          type: 'error',
          id: msg.id,
          success: false,
          payload: {},
          error: `Unknown message type: ${(msg as WsMessage).type}`,
        });
    }
  }

  // Process a task through the OODA loop (async, non-blocking)
  private async processTaskAsync(task: Task): Promise<void> {
    this.store.updateTask(task.id, { status: 'in_progress', updatedAt: Date.now() });

    try {
      const result = await this.ooda.processTask(task);

      this.store.updateTask(task.id, {
        status: result.success ? 'completed' : 'failed',
        result: result.output,
        error: result.error,
        updatedAt: Date.now(),
      });
    } catch (error) {
      this.store.updateTask(task.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      });
    }
  }

  // Forward all event bus events to connected WebSocket clients
  private setupEventForwarding(): void {
    this.eventBus.on('*', (event: FtmEvent) => {
      this.broadcast({
        type: 'event',
        id: `evt-${Date.now()}`,
        success: true,
        payload: { event },
      });
    });

    // Track machine state based on OODA phase events
    this.eventBus.on('ooda_phase', (event: FtmEvent) => {
      const phase = event.data.phase as string;
      const stateMap: Record<string, MachineState> = {
        idle: 'idle',
        observe: 'ingesting',
        orient: 'thinking',
        decide: 'thinking',
        act: 'executing',
        complete: 'complete',
        error: 'error',
      };
      this.machineState = stateMap[phase] ?? 'idle';
      this.broadcast({
        type: 'machine_state',
        id: `state-${Date.now()}`,
        success: true,
        payload: { state: this.machineState },
      });
    });
  }

  // Send to single client
  private sendTo(ws: WebSocket, response: WsResponse): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }

  // Broadcast to all connected clients
  broadcast(response: WsResponse): void {
    const data = JSON.stringify(response);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  // Get current daemon state snapshot
  private getStateSnapshot(): Record<string, unknown> {
    const profileContext = synthesizeUserContext(this.blackboard.getUserProfileSnapshot());

    return {
      machineState: this.machineState,
      currentTask: this.ooda.getCurrentTask(),
      currentPlan: this.ooda.getCurrentPlan(),
      phase: this.ooda.getPhase(),
      blackboard: this.blackboard.getContext(),
      profileContext,
      connectedClients: this.clients.size,
    };
  }

  // Graceful shutdown
  stop(): void {
    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }
  }

  getPort(): number | null {
    if (!this.wss) return null;
    const addr = this.wss.address();
    if (typeof addr === 'string') return null;
    if (addr && 'port' in addr) return addr.port;
    return null;
  }

  getMachineState(): MachineState {
    return this.machineState;
  }
}
