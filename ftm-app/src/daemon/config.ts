import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import type { FtmConfig } from '@shared/types.js';

/**
 * Returns the path to the FTM config file: ~/.ftm/config.yml
 */
export function getConfigPath(): string {
  return join(homedir(), '.ftm', 'config.yml');
}

/**
 * Returns the path to the FTM data directory: ~/.ftm/data/
 */
export function getDataDir(): string {
  return join(homedir(), '.ftm', 'data');
}

/**
 * Returns the path to the FTM SQLite database: ~/.ftm/data/ftm.db
 */
export function getDbPath(): string {
  return join(getDataDir(), 'ftm.db');
}

/**
 * Creates ~/.ftm/data/ if it does not already exist (recursively).
 */
export function ensureDataDir(): void {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Attempts to read and parse a YAML config file from the given path.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function loadConfigFile(path: string): Partial<FtmConfig> | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Partial<FtmConfig>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Deep-merges user-provided overrides on top of the defaults.
 * Nested objects (profiles, execution, daemon) are merged at one level of depth.
 * Arrays are replaced wholesale (not concatenated).
 */
export function mergeConfig(defaults: FtmConfig, overrides: Partial<FtmConfig>): FtmConfig {
  const merged: FtmConfig = {
    ...defaults,
    ...overrides,
    profiles: {
      ...defaults.profiles,
      ...(overrides.profiles ?? {}),
    },
    execution: {
      ...defaults.execution,
      ...(overrides.execution ?? {}),
    },
    daemon: {
      ...defaults.daemon,
      ...(overrides.daemon ?? {}),
    },
  };

  return merged;
}
