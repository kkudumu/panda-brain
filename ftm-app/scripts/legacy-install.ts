#!/usr/bin/env node
import { existsSync, mkdirSync, cpSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const home = homedir();
const skillsDir = join(home, '.claude', 'skills');

// The skill pack is in the parent directory of ftm-app
const repoRoot = join(dirname(dirname(import.meta.url.replace('file://', ''))));

console.log('Installing FTM as Claude Code skill pack...');
console.log(`Source: ${repoRoot}`);
console.log(`Target: ${skillsDir}`);

// Copy skill directories
const skillDirs = [
  'ftm', 'ftm-mind', 'ftm-executor', 'ftm-brainstorm', 'ftm-debug',
  'ftm-council', 'ftm-council-chat', 'ftm-audit', 'ftm-browse',
  'ftm-capture', 'ftm-config', 'ftm-dashboard', 'ftm-diagram',
  'ftm-git', 'ftm-intent', 'ftm-map', 'ftm-ops', 'ftm-pause',
  'ftm-researcher', 'ftm-resume', 'ftm-retro', 'ftm-routine',
  'ftm-upgrade', 'ftm-verify', 'ftm-codex-gate',
];

// Copy .yml files and skill directories
for (const skill of skillDirs) {
  const srcDir = join(repoRoot, skill);
  const srcYml = join(repoRoot, `${skill}.yml`);

  if (existsSync(srcDir)) {
    const targetDir = join(skillsDir, skill);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    cpSync(srcDir, targetDir, { recursive: true });
  }

  if (existsSync(srcYml)) {
    cpSync(srcYml, join(skillsDir, `${skill}.yml`));
  }
}

console.log(`\nInstalled ${skillDirs.length} skills to ${skillsDir}`);
console.log('Restart Claude Code to use the skills.');
