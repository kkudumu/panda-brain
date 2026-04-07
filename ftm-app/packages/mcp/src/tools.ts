// Generate MCP server configuration for different AI CLIs
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function generateClaudeConfig(dbPath: string): McpServerConfig {
  return {
    name: 'ftm',
    command: 'node',
    args: [getEntryPath(), '--db', dbPath],
  };
}

export function generateCodexConfig(dbPath: string): McpServerConfig {
  return {
    name: 'ftm',
    command: 'node',
    args: [getEntryPath(), '--db', dbPath],
  };
}

export function generateGeminiConfig(dbPath: string): McpServerConfig {
  return {
    name: 'ftm',
    command: 'node',
    args: [getEntryPath(), '--db', dbPath],
  };
}

// Generate the JSON config snippet to add to each CLI's MCP config file
export function generateSetupInstructions(target: 'claude' | 'codex' | 'gemini'): string {
  const config = {
    claude: {
      configFile: '~/.claude/settings.json',
      section: 'mcpServers',
    },
    codex: {
      configFile: '~/.codex/config.json',
      section: 'mcpServers',
    },
    gemini: {
      configFile: '~/.gemini/settings.json',
      section: 'mcpServers',
    },
  };

  const targetConfig = config[target];
  const serverConfig = generateClaudeConfig(getDefaultDbPath());

  return [
    `Add the following to your ${targetConfig.configFile}:`,
    '',
    `"${targetConfig.section}": {`,
    `  "ftm": {`,
    `    "command": "${serverConfig.command}",`,
    `    "args": ${JSON.stringify(serverConfig.args)}`,
    `  }`,
    `}`,
  ].join('\n');
}

function getEntryPath(): string {
  // Try require.resolve first (works in CJS contexts or when dist is built)
  try {
    const require = createRequire(import.meta.url);
    return require.resolve('../../dist/mcp/entry.js');
  } catch {
    // Fallback: compute path relative to this source file's location
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return resolve(__dirname, '../../dist/mcp/entry.js');
  }
}

export function getDefaultDbPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return `${home}/.ftm/data/ftm.db`;
}
