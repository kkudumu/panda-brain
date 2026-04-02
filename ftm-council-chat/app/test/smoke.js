'use strict';

/**
 * Smoke test for ftm-council-chat server.
 * Usage: node test/smoke.js
 *
 * Launches the server, connects a Socket.IO client, verifies basic
 * session lifecycle events, sends a user message, and shuts down.
 */

const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

// ── helpers ────────────────────────────────────────────────────────────────

function wait(emitter, event, timeoutMs, description) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for "${event}" (${description}) after ${timeoutMs}ms`));
    }, timeoutMs);

    emitter.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitForLine(readable, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for pattern ${pattern} in stdout after ${timeoutMs}ms`));
    }, timeoutMs);

    readable.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(pattern);
      if (match) {
        clearTimeout(timer);
        resolve(match);
      }
    });
  });
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  let serverProcess = null;
  let client = null;
  let exitCode = 0;

  // Always clean up on exit
  function cleanup() {
    if (client) {
      try { client.disconnect(); } catch (_) {}
      client = null;
    }
    if (serverProcess) {
      try { serverProcess.kill('SIGTERM'); } catch (_) {}
      serverProcess = null;
    }
  }

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });

  try {
    // ── Step 1: Spawn server ──────────────────────────────────────────────
    const serverPath = path.join(__dirname, '..', 'server.js');
    console.log('[smoke] Spawning server:', serverPath);

    serverProcess = spawn(process.execPath, [serverPath, '--topic', 'smoke test'], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stderr.on('data', (d) => process.stderr.write(`[server stderr] ${d}`));

    // ── Step 2: Wait for server to print its URL ──────────────────────────
    const urlMatch = await waitForLine(
      serverProcess.stdout,
      /http:\/\/localhost:(\d+)/,
      5000
    );
    const port = urlMatch[1];
    const serverUrl = `http://localhost:${port}`;
    console.log(`[smoke] Server ready at ${serverUrl}`);

    // ── Step 3: Connect Socket.IO client ─────────────────────────────────
    client = io(serverUrl, { transports: ['websocket'] });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket.IO connect timed out')), 5000);
      client.once('connect', () => { clearTimeout(timer); resolve(); });
      client.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
    console.log('[smoke] Socket.IO connected');

    // ── Step 4: Wait for session_start ───────────────────────────────────
    const sessionData = await wait(client, 'session_start', 2000, 'session_start after connect');
    console.log('[smoke] session_start received:', JSON.stringify(sessionData).slice(0, 120));

    if (!sessionData || typeof sessionData.screennames === 'undefined') {
      throw new Error('session_start missing "screennames" field');
    }
    if (typeof sessionData.topic === 'undefined') {
      throw new Error('session_start missing "topic" field');
    }
    console.log('[smoke] PASS: session_start has screennames and topic');

    // ── Step 5: Wait for model_joined ─────────────────────────────────────
    const joinData = await wait(client, 'model_joined', 3000, 'model_joined');
    console.log('[smoke] model_joined received:', JSON.stringify(joinData).slice(0, 120));

    if (!joinData || typeof joinData.model === 'undefined') {
      throw new Error('model_joined missing "model" field');
    }
    if (typeof joinData.screenname === 'undefined') {
      throw new Error('model_joined missing "screenname" field');
    }
    console.log('[smoke] PASS: model_joined has model and screenname');

    // ── Step 6: Send user_message ─────────────────────────────────────────
    client.emit('user_message', { text: 'test message' });
    console.log('[smoke] Sent user_message');

    // ── Step 7: Wait up to 30s for message_complete ───────────────────────
    try {
      const msgData = await wait(client, 'message_complete', 30000, 'message_complete');
      console.log('[smoke] message_complete received:', JSON.stringify(msgData).slice(0, 120));
      console.log('[smoke] PASS: received model response');
    } catch (err) {
      console.warn('[smoke] WARNING: No message_complete within 30s — model CLIs may not be available.');
      console.warn('[smoke] (This is not a test failure — CLI availability is checked by health.js)');
    }

    console.log('[smoke] ALL CHECKS PASSED');

  } catch (err) {
    console.error('[smoke] FAIL:', err.message);
    exitCode = 1;
  } finally {
    cleanup();
  }

  process.exit(exitCode);
}

main();
