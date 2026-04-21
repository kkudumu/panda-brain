import { WebSocketServer, WebSocket } from 'ws';
import type { WsMessage, WsResponse, FtmEvent, Task, MachineState, Plan } from './shared/types.js';
import { FtmEventBus } from './event-bus.js';
import { OodaLoop } from './ooda.js';
import { FtmStore } from './store.js';
import { Blackboard } from './blackboard.js';
import { synthesizeUserContext } from './profile-context.js';
import path from 'node:path';

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
        const workingDir =
          typeof msg.payload.workingDir === 'string'
            ? msg.payload.workingDir
            : process.cwd();
        const workspace = this.blackboard.ensureWorkspace(
          workingDir,
          path.basename(workingDir) || 'workspace',
        );
        const lane = this.blackboard.createTaskLane(
          workspace.id,
          this.deriveLaneTitle(msg.payload.description as string),
        );
        const task: Task = {
          id: `task-${now}-${++this.taskCounter}`,
          description: msg.payload.description as string,
          workingDir,
          workspaceId: workspace.id,
          laneId: lane.id,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          sessionId: this.sessionId,
        };
        this.store.createTask(task);
        this.blackboard.recordWorkspaceMessage({
          workspaceId: workspace.id,
          laneId: lane.id,
          sessionId: this.sessionId,
          role: 'user',
          kind: 'task_submission',
          content: task.description,
          metadata: { taskId: task.id },
        });
        this.blackboard.saveRetrievalHit({
          sourceType: 'message',
          sourceId: task.id,
          workspaceId: workspace.id,
          laneId: lane.id,
          text: task.description,
          tags: ['task', 'user'],
          filePaths: [workingDir],
          issueKeys: this.extractIssueKeys(task.description),
          importance: 1,
        });
        this.eventBus.emitTyped('task_submitted', { task });

        // Process task asynchronously
        this.processTaskAsync(task);

        this.sendTo(ws, {
          type: 'task_submitted',
          id: msg.id,
          success: true,
          payload: { taskId: task.id, workspaceId: workspace.id, laneId: lane.id },
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
      const normalizedEvent = this.normalizeEvent(event);
      if (normalizedEvent.type === 'plan_generated' && normalizedEvent.data.plan) {
        this.store.savePlan(normalizedEvent.data.plan as Plan);
      }
      if (normalizedEvent.type === 'plan_approved' && typeof normalizedEvent.data.planId === 'string') {
        this.store.updatePlan(normalizedEvent.data.planId as string, { status: 'approved' });
      }
      this.store.logEvent(normalizedEvent);
      this.captureWorkspaceEvent(normalizedEvent);
      this.broadcast({
        type: 'event',
        id: `evt-${Date.now()}`,
        success: true,
        payload: { event: normalizedEvent },
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
      recentWorkspaces: this.store.getRecentWorkspaces(10),
      profileContext,
      connectedClients: this.clients.size,
    };
  }

  private deriveLaneTitle(description: string): string {
    const normalized = description.replace(/\s+/g, ' ').trim();
    if (!normalized) return 'Untitled task lane';
    return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
  }

  private extractIssueKeys(text: string): string[] {
    return Array.from(new Set(text.match(/[A-Z][A-Z0-9]+-\d+/g) ?? []));
  }

  private normalizeEvent(event: FtmEvent): FtmEvent {
    const typedEvent = event.data._eventType;
    if (typeof typedEvent !== 'string' || typedEvent.length === 0) {
      return event;
    }

    const { _eventType: _ignored, ...data } = event.data;
    return {
      ...event,
      type: typedEvent,
      data,
    };
  }

  private captureWorkspaceEvent(event: FtmEvent): void {
    const taskId = typeof event.data.taskId === 'string' ? event.data.taskId : undefined;
    const task = taskId ? this.store.getTask(taskId) : this.ooda.getCurrentTask();
    const workspaceId = task?.workspaceId;
    const laneId = task?.laneId;
    if (!workspaceId) return;

    const content = JSON.stringify({ type: event.type, data: event.data });
    this.blackboard.recordWorkspaceMessage({
      workspaceId,
      laneId,
      sessionId: event.sessionId,
      role: event.type === 'error' ? 'system' : 'assistant',
      kind: event.type,
      content,
      metadata: event.data,
      createdAt: event.timestamp,
    });

    if (event.type === 'task_completed') {
      const output =
        typeof event.data.result === 'string'
          ? event.data.result
          : typeof (event.data.result as { output?: string } | undefined)?.output === 'string'
            ? ((event.data.result as { output?: string }).output ?? '')
            : '';
      this.blackboard.saveSummary({
        workspaceId,
        laneId,
        kind: 'task',
        content: output || 'Task completed.',
        sourceMessageCount: 1,
      });
    }
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
