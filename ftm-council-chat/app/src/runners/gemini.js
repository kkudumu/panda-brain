'use strict';

const { spawn } = require('child_process');

const TIMEOUT_MS = 300_000; // 300 seconds

/**
 * Strip prompt echo from Gemini output.
 * Gemini consistently echoes the full prompt in its response.
 * Use multiple strategies to find and remove the echo.
 */
function stripPromptEcho(text, prompt) {
  if (!text) return text;

  // Strategy 1: Find the known delimiter and take everything after it
  const delimiter = 'Just write your chat message:';
  const dIdx = text.lastIndexOf(delimiter);
  if (dIdx !== -1) {
    const after = text.slice(dIdx + delimiter.length).trim();
    if (after.length > 0) return after;
  }

  // Strategy 2: If the full prompt text appears, strip it
  if (prompt && text.includes(prompt)) {
    const after = text.slice(text.indexOf(prompt) + prompt.length).trim();
    if (after.length > 0) return after;
  }

  // Strategy 3: Regex patterns for known prompt formats
  const patterns = [
    /^.*?Just write your chat message:\s*/s,
    /^.*?Output ONLY your response\.\s*/s,
    /^<context>[\s\S]*?<\/context>\s*/,
    /^You are Gemini[\s\S]*?(?:message:|response[.:])\s*/,
    /^\[SYSTEM\][\s\S]*?(?:message:|response[.:])\s*/,
  ];

  for (const pat of patterns) {
    const cleaned = text.replace(pat, '').trim();
    if (cleaned.length > 0 && cleaned.length < text.length) {
      return cleaned;
    }
  }

  return text;
}

/**
 * Run a single Gemini CLI turn.
 * Buffers all output, strips prompt echo, emits clean message at end.
 * No token streaming — Gemini's echo problem makes streaming unreliable.
 *
 * @param {string} prompt - Full conversation prompt
 * @param {string} cwd - Working directory for Gemini process
 * @param {function} emitEvent - Socket.IO emit callback
 * @returns {Promise<{ok: boolean, text: string, error?: string}>}
 */
async function runGeminiTurn(prompt, cwd, emitEvent) {
  return new Promise((resolve) => {
    let assembledText = '';
    let timedOut = false;
    let settled = false;

    function finish(ok, text, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, text, error });
    }

    const child = spawn(
      'gemini',
      ['-p', prompt, '-o', 'stream-json', '--yolo'],
      {
        cwd,
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    );
    child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch (_) {}
      finish(false, stripPromptEcho(assembledText, prompt), 'Gemini turn timed out after 300s');
    }, TIMEOUT_MS);

    // Buffer for JSONL line parsing
    let lineBuffer = '';

    child.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop(); // keep incomplete last line

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        let obj;
        try {
          obj = JSON.parse(line);
        } catch (_) {
          continue; // skip unparseable
        }

        const type = obj.type;

        // Only accumulate ASSISTANT messages — user messages echo the prompt
        if (type === 'message' && obj.role === 'assistant') {
          const content = obj.content || obj.text || '';
          if (content) assembledText += content;

        } else if (type === 'tool_use' || obj.tool_name) {
          // Only emit researching events — these are safe
          emitEvent('researching', {
            model: 'gemini',
            tool_name: obj.tool_name || 'reading files',
          });

        } else if (type === 'result') {
          // Final result — prefer this over assembled deltas
          const finalText = obj.content || obj.text || obj.response || '';
          if (finalText) assembledText = finalText;
        }
      }
    });

    child.on('close', (code) => {
      if (timedOut) return;

      // Process remaining buffer
      if (lineBuffer.trim()) {
        try {
          const obj = JSON.parse(lineBuffer.trim());
          if (obj.type === 'result') {
            const finalText = obj.content || obj.text || obj.response || '';
            if (finalText) assembledText = finalText;
          }
        } catch (_) {}
      }

      // Strip the prompt echo — this is the critical step
      assembledText = stripPromptEcho(assembledText, prompt);

      emitEvent('message_complete', { model: 'gemini', full_text: assembledText });

      if (code === 0 || code === null) {
        finish(true, assembledText);
      } else {
        finish(false, assembledText, `Gemini process exited with code ${code}`);
      }
    });

    child.on('error', (err) => {
      if (timedOut) return;
      finish(false, '', `Gemini spawn error: ${err.message}`);
    });
  });
}

module.exports = { runGeminiTurn };
