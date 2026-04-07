import { describe, it, expect, vi } from 'vitest';
import { FtmEventBus } from '../../src/daemon/event-bus.js';

describe('FtmEventBus', () => {
  it('creates an event bus with a session ID', () => {
    const bus = new FtmEventBus('test-session-1');
    expect(bus).toBeDefined();
  });

  it('logs emitted events', () => {
    const bus = new FtmEventBus('test-session-2');
    bus.emit('task_submitted', { taskId: 'abc' });

    const log = bus.getEventLog();
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('task_submitted');
    expect(log[0].sessionId).toBe('test-session-2');
    expect(log[0].data).toEqual({ taskId: 'abc' });
    expect(typeof log[0].timestamp).toBe('number');
  });

  it('returns a copy of the event log (immutable)', () => {
    const bus = new FtmEventBus('test-session-3');
    bus.emit('task_submitted', { taskId: 'abc' });

    const log1 = bus.getEventLog();
    const log2 = bus.getEventLog();
    expect(log1).not.toBe(log2); // different array references
    expect(log1).toEqual(log2);  // same contents
  });

  it('filters events with getEventsSince', async () => {
    const bus = new FtmEventBus('test-session-4');
    const before = Date.now();

    bus.emit('task_submitted', { taskId: 'before' });

    // Small delay to ensure timestamps differ
    await new Promise(resolve => setTimeout(resolve, 5));
    const cutoff = Date.now();
    await new Promise(resolve => setTimeout(resolve, 5));

    bus.emit('step_started', { step: 1 });

    const events = bus.getEventsSince(cutoff);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('step_started');
  });

  it('emits typed events and triggers listeners', () => {
    const bus = new FtmEventBus('test-session-5');
    const received: unknown[] = [];

    bus.on('task_submitted', (event) => {
      received.push(event);
    });

    bus.emitTyped('task_submitted', { description: 'do something' });
    expect(received).toHaveLength(1);
  });

  it('emits wildcard event on emitTyped', () => {
    const bus = new FtmEventBus('test-session-6');
    const wildcardEvents: unknown[] = [];

    bus.on('*', (event) => {
      wildcardEvents.push(event);
    });

    bus.emitTyped('plan_generated', { planId: 'plan-1' });

    // emitTyped calls emit twice: once for the typed event, once for '*'
    // The '*' listener only fires on the wildcard emit
    expect(wildcardEvents).toHaveLength(1);
  });

  it('clears the event log', () => {
    const bus = new FtmEventBus('test-session-7');
    bus.emit('task_submitted');
    bus.emit('step_started');
    expect(bus.getEventLog()).toHaveLength(2);

    bus.clearLog();
    expect(bus.getEventLog()).toHaveLength(0);
  });

  it('uses empty object as default data when no data provided', () => {
    const bus = new FtmEventBus('test-session-8');
    bus.emit('task_completed');

    const log = bus.getEventLog();
    expect(log[0].data).toEqual({});
  });
});
