'use strict';

const { spawn } = require('child_process');
const readline = require('readline');

const TIMEOUT_MS = 300 * 1000; // 300 seconds

/**
 * Runs a single Codex CLI conversation turn.
 *
 * @param {string} prompt      - Full conversation prompt to send to Codex
 * @param {string} cwd         - Working directory for Codex (user's project)
 * @param {Function} emitEvent - Callback: (eventName, payload) => void
 * @returns {Promise<{ok: boolean, text: string, error?: string}>}
 */
async function runCodexTurn(prompt, cwd, emitEvent) {
  return new Promise((resolve) => {
    let capturedText = '';
    let stderrChunks = [];
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    // Spawn: codex exec --full-auto --json "<prompt>"
    // Use array args to avoid shell injection.
    let child;
    try {
      child = spawn('codex', ['exec', '--full-auto', '--json', prompt], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (spawnErr) {
      return finish({ ok: false, text: '', error: 'Failed to spawn Codex: ' + spawnErr.message });
    }

    // Timeout guard
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish({ ok: false, text: '', error: 'Codex timed out after 300s' });
    }, TIMEOUT_MS);

    // Collect stderr for error reporting
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
    });

    // Parse JSONL stdout line by line
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch (_) {
        // Skip unparseable lines gracefully
        return;
      }

      const type = obj && obj.type;
      if (!type) return;

      switch (type) {
        case 'turn.started':
          emitEvent('typing_start', { model: 'codex' });
          break;

        case 'item.started': {
          const item = obj.item || {};
          const itemType = item.type || '';
          // Emit researching for tool/command use
          if (
            itemType === 'command_execution' ||
            itemType === 'tool_call' ||
            itemType === 'function_call' ||
            itemType === 'tool_use'
          ) {
            emitEvent('researching', {
              model: 'codex',
              tool_name: item.tool_name || item.name || 'reading files',
            });
          }
          break;
        }

        case 'item.completed': {
          const item = obj.item || {};
          if (item.type === 'agent_message' && typeof item.text === 'string') {
            capturedText = item.text;
          }
          break;
        }

        case 'turn.completed':
          // Resolve after the process exits naturally; just note we're done
          break;

        default:
          break;
      }
    });

    child.on('close', (code) => {
      rl.close();

      if (settled) return;

      if (code !== 0 && code !== null) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        return finish({ ok: false, text: '', error: 'Codex error: ' + (stderr || `exit code ${code}`) });
      }

      emitEvent('message_complete', { model: 'codex', full_text: capturedText });
      finish({ ok: true, text: capturedText });
    });

    child.on('error', (err) => {
      if (settled) return;
      finish({ ok: false, text: '', error: 'Codex process error: ' + err.message });
    });
  });
}

module.exports = { runCodexTurn };
