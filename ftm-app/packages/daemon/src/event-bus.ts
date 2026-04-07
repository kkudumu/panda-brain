import { EventEmitter } from 'events';
import type { FtmEvent, FtmEventType } from './shared/types.js';

export class FtmEventBus extends EventEmitter {
  private sessionId: string;
  private eventLog: FtmEvent[] = [];

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
    this.setMaxListeners(50);
  }

  emit(type: string, data?: Record<string, unknown>): boolean {
    const event: FtmEvent = {
      type,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      data: data ?? {},
    };
    this.eventLog.push(event);
    return super.emit(type, event);
  }

  // Also emit on wildcard for subscribers that want all events
  emitTyped(type: FtmEventType, data?: Record<string, unknown>): void {
    this.emit(type, data);
    this.emit('*', { ...data, _eventType: type });
  }

  getEventLog(): FtmEvent[] {
    return [...this.eventLog];
  }

  getEventsSince(timestamp: number): FtmEvent[] {
    return this.eventLog.filter(e => e.timestamp >= timestamp);
  }

  clearLog(): void {
    this.eventLog = [];
  }
}
