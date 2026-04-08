#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const home = homedir();
const ftmDir = join(home, '.ftm');
const dataDir = join(ftmDir, 'data');
const configPath = join(ftmDir, 'config.yml');

// Create directories
if (!existsSync(ftmDir)) mkdirSync(ftmDir, { recursive: true });
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

// Create default config
if (!existsSync(configPath)) {
  const defaultConfig = `# FTM Configuration
# Edit this file to customize your FTM setup

profile: balanced

profiles:
  quality:
    planning: claude
    execution: claude
    review: claude
  balanced:
    planning: claude
    execution: codex
    review: gemini
  budget:
    planning: gemini
    execution: ollama
    review: ollama

daemon:
  port: 4040
  host: localhost

execution:
  max_parallel_agents: 5
  auto_audit: true
  approval_mode: plan_first
`;
  writeFileSync(configPath, defaultConfig, 'utf-8');
  console.log('Created default config at ~/.ftm/config.yml');
}

console.log(`
╔══════════════════════════════════╗
║   Feed The Machine — Installed   ║
╠══════════════════════════════════╣
║  Run: ftm onboard               ║
║  Or:  ftm "your task here"      ║
╚══════════════════════════════════╝
`);
