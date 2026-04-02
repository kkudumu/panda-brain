'use strict';

const { spawn } = require('child_process');

const TIMEOUT_MS = 300_000; // 300 seconds

/**
 * Run a single Claude CLI turn.
 *
 * @param {string} prompt - Full conversation prompt (includes system prompt with Skeptic persona)
 * @param {string} cwd - Working directory for Claude to run in
 * @param {Function} emitEvent - Socket.IO emit callback: emitEvent(eventName, payload)
 * @returns {Promise<{ok: boolean, text: string, error?: string}>}
 */
async function runClaudeTurn(prompt, cwd, emitEvent) {
  // Absorb startup latency immediately — Claude goes first in round-robin
  emitEvent('typing_start', { model: 'claude' });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(
      'claude',
      ['-p', prompt, '--allowedTools', 'Read,Grep,Glob,Bash', '--output-format', 'text'],
      { cwd }
    );

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      resolve({ ok: false, text: '', error: 'Claude error: timed out after 300 seconds' });
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return; // already resolved

      if (code === 0) {
        const text = stdout.trim();
        emitEvent('message_complete', { model: 'claude', full_text: text });
        resolve({ ok: true, text });
      } else {
        resolve({ ok: false, text: '', error: 'Claude error: ' + stderr });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (timedOut) return;
      resolve({ ok: false, text: '', error: 'Claude error: ' + err.message });
    });
  });
}

module.exports = { runClaudeTurn };
