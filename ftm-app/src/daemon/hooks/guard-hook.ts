import type { FtmEvent } from '@shared/types.js';
import type { FtmEventBus } from '../event-bus.js';
import type { FtmStore } from '../store.js';

// ---------------------------------------------------------------------------
// Dangerous pattern detection
// ---------------------------------------------------------------------------

const DANGEROUS_TOOL_NAMES = [
  'bash',
  'shell',
  'exec',
  'execute',
  'run_command',
  'system',
  'eval',
  'subprocess',
  'spawn',
  'popen',
];

const DESTRUCTIVE_ARG_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brmdir\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i,
  /\bformat\b.*\b(disk|drive|volume)\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  />\s*\/dev\/(sda|hda|vda|nvme)/i,
  /\bchmod\s+777\b/i,
  /\bchown\s+-R\s+/i,
  /\bkill\s+-9\s+-1\b/i,
  /\bsudo\s+rm\b/i,
  /\bsudo\s+dd\b/i,
];

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*\S+/i,
  /(?:token|auth[_-]?token|access[_-]?token)\s*[:=]\s*\S+/i,
  /(?:private[_-]?key|priv[_-]?key)\s*[:=]\s*\S+/i,
  /(?:aws[_-]?secret|aws[_-]?access)\s*[:=]\s*\S+/i,
  /(?:AKIA[0-9A-Z]{16})/,           // AWS access key ID pattern
  /(?:ghp_[a-zA-Z0-9]{36})/,        // GitHub personal access token
  /(?:sk-[a-zA-Z0-9]{48})/,         // OpenAI API key
  /(?:xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24})/, // Slack bot token
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
];

// ---------------------------------------------------------------------------
// Guard hook
// ---------------------------------------------------------------------------

function isToolNameDangerous(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return DANGEROUS_TOOL_NAMES.some((name) => lower.includes(name));
}

function containsDestructivePattern(text: string): string | null {
  for (const pattern of DESTRUCTIVE_ARG_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.toString();
    }
  }
  return null;
}

function containsSecretPattern(text: string): string | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return pattern.toString();
    }
  }
  return null;
}

function argsToString(args: unknown): string {
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

export function registerGuardHook(eventBus: FtmEventBus, store: FtmStore): void {
  eventBus.on('tool_invoked', (event: FtmEvent) => {
    const toolName = (event.data.toolName ?? event.data.name ?? '') as string;
    const toolArgs = event.data.arguments ?? event.data.args ?? {};
    const argsStr = argsToString(toolArgs);

    const violations: string[] = [];

    // Check tool name against dangerous list
    if (isToolNameDangerous(toolName)) {
      violations.push(`Dangerous tool name detected: "${toolName}"`);
    }

    // Check arguments for destructive shell patterns
    const destructiveMatch = containsDestructivePattern(argsStr);
    if (destructiveMatch) {
      violations.push(`Destructive operation pattern detected in arguments`);
    }

    // Check arguments for embedded secrets / credentials
    const secretMatch = containsSecretPattern(argsStr);
    if (secretMatch) {
      violations.push(`Potential secret or credential detected in tool arguments`);
    }

    if (violations.length === 0) return;

    // Persist the guard event so it appears in the event log
    const guardEvent: FtmEvent = {
      type: 'guard_triggered',
      timestamp: Date.now(),
      sessionId: event.sessionId,
      data: {
        toolName,
        violations,
        blockedEventTimestamp: event.timestamp,
      },
    };
    store.logEvent(guardEvent);

    // Broadcast on the bus so listeners (e.g. OodaLoop, server) can react
    eventBus.emit('guard_triggered', {
      toolName,
      violations,
      blockedEventTimestamp: event.timestamp,
    });

    console.warn(
      `[GuardHook] Blocked tool "${toolName}": ${violations.join('; ')}`
    );
  });
}
