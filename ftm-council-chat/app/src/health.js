'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Run a command with a timeout and return success/failure.
 * @param {string} cmd - executable path
 * @param {string[]} args - arguments
 * @param {number} timeoutMs - timeout in milliseconds
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function runWithTimeout(cmd, args, timeoutMs) {
  try {
    await execFileAsync(cmd, args, { timeout: timeoutMs });
    return { ok: true };
  } catch (err) {
    return { ok: false, _err: err };
  }
}

/**
 * Check a single CLI: `which <name>` then `<name> --version`.
 */
async function checkCli({ name, notFoundMsg, notRespondingMsg, skipVersionCheck }) {
  // Step 1: which
  const whichResult = await runWithTimeout('which', [name], 5000);
  if (!whichResult.ok) {
    return { ok: false, error: notFoundMsg };
  }

  // Step 2: version check (skip for claude — already running)
  if (skipVersionCheck) {
    return { ok: true };
  }

  const versionResult = await runWithTimeout(name, ['--version'], 5000);
  if (!versionResult.ok) {
    return { ok: false, error: notRespondingMsg };
  }

  return { ok: true };
}

/**
 * Check if all 3 CLIs are installed and functional.
 * @returns {Promise<{ codex: object, gemini: object, claude: object }>}
 */
async function checkHealth() {
  const [codex, gemini, claude] = await Promise.all([
    checkCli({
      name: 'codex',
      notFoundMsg: 'Codex CLI not found. Install: npm install -g @openai/codex',
      notRespondingMsg: 'Codex CLI not responding. Try: codex login',
      skipVersionCheck: false,
    }),
    checkCli({
      name: 'gemini',
      notFoundMsg: 'Gemini CLI not found. Install: npm install -g @anthropic-ai/gemini-cli',
      notRespondingMsg: 'Gemini CLI not responding. Try: gemini auth',
      skipVersionCheck: false,
    }),
    checkCli({
      name: 'claude',
      notFoundMsg: 'Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code',
      notRespondingMsg: null,
      skipVersionCheck: true, // Claude Code is running if we got here
    }),
  ]);

  // Strip internal _err field before returning
  return {
    codex: codex.ok ? { ok: true } : { ok: false, error: codex.error },
    gemini: gemini.ok ? { ok: true } : { ok: false, error: gemini.error },
    claude: claude.ok ? { ok: true } : { ok: false, error: claude.error },
  };
}

module.exports = { checkHealth };
