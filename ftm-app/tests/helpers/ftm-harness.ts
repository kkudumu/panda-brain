import { WebSocket } from 'ws';
import { vi } from 'vitest';
import { FtmServer } from '../../packages/daemon/src/server.js';
import { FtmEventBus } from '../../packages/daemon/src/event-bus.js';
import { FtmStore } from '../../packages/daemon/src/store.js';
import { Blackboard } from '../../packages/daemon/src/blackboard.js';
import { OodaLoop } from '../../packages/daemon/src/ooda.js';
import { ModelRouter } from '../../packages/daemon/src/router.js';
import { AdapterRegistry } from '../../packages/daemon/src/adapters/registry.js';
import { registerAllHooks } from '../../packages/daemon/src/hooks/index.js';
import type {
  ModelAdapter,
  NormalizedResponse,
  WsResponse,
} from '../../packages/daemon/src/index.js';

type ApprovalMode = 'auto' | 'plan_first' | 'always_ask';

export interface MockAdapterSpec {
  responseText?: string;
  error?: Error;
  delayMs?: number;
}

export interface FtmHarness {
  server: FtmServer;
  eventBus: FtmEventBus;
  store: FtmStore;
  blackboard: Blackboard;
  ooda: OodaLoop;
  router: ModelRouter;
  registry: AdapterRegistry;
  adapters: ModelAdapter[];
  port: number;
  sessionId: string;
}

export function makeAdapter(name: string, spec: MockAdapterSpec = {}): ModelAdapter {
  return {
    name,
    available: vi.fn().mockResolvedValue(true),
    startSession: vi.fn().mockImplementation(async () => {
      if (spec.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
      }

      if (spec.error) {
        throw spec.error;
      }

      return {
        text: spec.responseText ?? `${name} handled the step`,
        toolCalls: [],
        sessionId: `sess-${name}`,
        tokenUsage: { input: 10, output: 20, cached: 0 },
      } satisfies NormalizedResponse;
    }),
    resumeSession: vi.fn(),
    parseResponse: vi.fn(),
  };
}

export async function createHarness(opts: {
  approvalMode?: ApprovalMode;
  withHooks?: boolean;
  adapterSpecs?: Partial<Record<string, MockAdapterSpec>>;
} = {}): Promise<FtmHarness> {
  const sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const store = new FtmStore(':memory:');
  store.createSession(sessionId);

  const eventBus = new FtmEventBus(sessionId);
  const blackboard = new Blackboard(store);
  const registry = new AdapterRegistry();
  const adapterNames = ['claude', 'codex', 'gemini', 'ollama'];
  const adapters = adapterNames.map((name) => makeAdapter(name, opts.adapterSpecs?.[name]));

  for (const adapter of adapters) {
    registry.register(adapter);
  }

  const router = new ModelRouter(registry, eventBus);
  vi.spyOn(router, 'getConfig').mockReturnValue({
    ...router.getConfig(),
    execution: {
      ...router.getConfig().execution,
      approvalMode: opts.approvalMode ?? 'auto',
    },
  });

  const ooda = new OodaLoop(eventBus, blackboard, router);

  if (opts.withHooks ?? true) {
    registerAllHooks(eventBus, store, blackboard);
  }

  const server = new FtmServer({ eventBus, ooda, store, blackboard, sessionId });
  await server.start(0, '127.0.0.1');

  return {
    server,
    eventBus,
    store,
    blackboard,
    ooda,
    router,
    registry,
    adapters,
    port: server.getPort()!,
    sessionId,
  };
}

export async function connectWs(port: number): Promise<{ ws: WebSocket; initMsg: WsResponse }> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('error', reject);
    ws.once('message', (raw) => {
      resolve({ ws, initMsg: JSON.parse(raw.toString()) as WsResponse });
    });
  });
}

export async function sendWs(
  ws: WebSocket,
  msg: Record<string, unknown>,
): Promise<WsResponse> {
  return await new Promise((resolve) => {
    const id = msg.id as string;
    const handler = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const parsed = JSON.parse(raw.toString()) as WsResponse;
      if (parsed.id === id) {
        ws.off('message', handler);
        resolve(parsed);
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

export async function collectWsMessages(
  ws: WebSocket,
  predicate: (msg: WsResponse) => boolean,
  timeoutMs = 5_000,
): Promise<WsResponse[]> {
  return await new Promise((resolve) => {
    const messages: WsResponse[] = [];
    const timeout = setTimeout(() => {
      ws.off('message', handler);
      resolve(messages);
    }, timeoutMs);

    const handler = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const parsed = JSON.parse(raw.toString()) as WsResponse;
      messages.push(parsed);

      if (predicate(parsed)) {
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(messages);
      }
    };

    ws.on('message', handler);
  });
}

export function cleanupHarness(harness: FtmHarness): void {
  harness.server.stop();
  harness.store.close();
}
