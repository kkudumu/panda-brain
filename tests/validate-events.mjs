#!/usr/bin/env node
// validate-events.mjs — Cross-reference SKILL.md event declarations against the event registry

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(filePath) {
  return readFileSync(filePath, 'utf8');
}

/**
 * Parse event names from the event-registry.md.
 * Events are declared as level-3 headings (`### event_name`) within the
 * "## Full Event Vocabulary" section only, to avoid picking up the template
 * example (`### event_name`) in the "How to Add an Event Declaration" section.
 *
 * @returns {Set<string>}
 */
function parseRegistry(registryPath) {
  const text = readFile(registryPath);
  const events = new Set();

  const lines = text.split('\n');
  let inVocabulary = false;

  for (const line of lines) {
    // Enter the authoritative section
    if (/^##\s+Full Event Vocabulary/.test(line)) {
      inVocabulary = true;
      continue;
    }
    // Any other level-2 heading exits the section
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      inVocabulary = false;
      continue;
    }

    if (!inVocabulary) continue;

    const m = line.match(/^###\s+([a-z][a-z0-9_]*)$/);
    if (m) {
      events.add(m[1]);
    }
  }

  return events;
}

/**
 * Parse `### Emits` and `### Listens To` sections from a single SKILL.md.
 * Returns { emits: Set<string>, listensTo: Set<string> }.
 *
 * Format expected:
 *   ### Emits
 *   - `event_name` — description
 *
 *   ### Listens To
 *   - `event_name` — description
 */
function parseSkillEvents(filePath) {
  const text = readFile(filePath);
  const lines = text.split('\n');

  const emits = new Set();
  const listensTo = new Set();

  let mode = null; // 'emits' | 'listens' | null

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '### Emits') {
      mode = 'emits';
      continue;
    }
    if (trimmed === '### Listens To') {
      mode = 'listens';
      continue;
    }
    // Any other heading resets mode
    if (/^#+\s/.test(trimmed) && trimmed !== '### Emits' && trimmed !== '### Listens To') {
      mode = null;
      continue;
    }

    if (!mode) continue;

    // Match bullet lines like: - `event_name` — ...
    const m = trimmed.match(/^-\s+`([a-z][a-z0-9_]*)`/);
    if (m) {
      if (mode === 'emits') emits.add(m[1]);
      if (mode === 'listens') listensTo.add(m[1]);
    }
  }

  return { emits, listensTo };
}

/**
 * Find all SKILL.md files to scan.
 * Includes ftm-[*]/SKILL.md and ftm/SKILL.md. Skips ftm-state/.
 *
 * @returns {Array<{ skillName: string, filePath: string }>}
 */
function findSkillFiles() {
  const skills = [];

  const entries = readdirSync(REPO);
  for (const entry of entries) {
    const fullPath = join(REPO, entry);
    if (!statSync(fullPath).isDirectory()) continue;
    if (entry === 'ftm-state') continue;

    const isFtmDir =
      entry === 'ftm' || (entry.startsWith('ftm-') && entry !== 'ftm-state');
    if (!isFtmDir) continue;

    const skillMd = join(fullPath, 'SKILL.md');
    if (existsSync(skillMd)) {
      skills.push({ skillName: entry, filePath: skillMd });
    }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const REGISTRY_PATH = join(REPO, 'ftm-mind', 'references', 'event-registry.md');

if (!existsSync(REGISTRY_PATH)) {
  console.error(`ERROR: Event registry not found at ${REGISTRY_PATH}`);
  process.exit(1);
}

const registryEvents = parseRegistry(REGISTRY_PATH);
const skillFiles = findSkillFiles();

// Aggregate across all skills
const allEmittedEvents = new Map(); // event -> [skillName, ...]
const allListenedEvents = new Map(); // event -> [skillName, ...]

for (const { skillName, filePath } of skillFiles) {
  const { emits, listensTo } = parseSkillEvents(filePath);

  for (const evt of emits) {
    if (!allEmittedEvents.has(evt)) allEmittedEvents.set(evt, []);
    allEmittedEvents.get(evt).push(skillName);
  }

  for (const evt of listensTo) {
    if (!allListenedEvents.has(evt)) allListenedEvents.set(evt, []);
    allListenedEvents.get(evt).push(skillName);
  }
}

// All events declared in any SKILL.md
const allDeclaredEvents = new Set([
  ...allEmittedEvents.keys(),
  ...allListenedEvents.keys(),
]);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const errors = [];
const warnings = [];

// 1. Events declared in SKILL.md but missing from registry
for (const evt of allDeclaredEvents) {
  if (!registryEvents.has(evt)) {
    const emitters = allEmittedEvents.get(evt) || [];
    const listeners = allListenedEvents.get(evt) || [];
    const skills = [...new Set([...emitters, ...listeners])].join(', ');
    errors.push(
      `Event "${evt}" declared in SKILL.md (${skills}) but not found in event-registry.md`,
    );
  }
}

// 2. Events in registry but not declared in any SKILL.md
for (const evt of registryEvents) {
  if (!allDeclaredEvents.has(evt)) {
    errors.push(
      `Event "${evt}" is in event-registry.md but not declared in any SKILL.md`,
    );
  }
}

// 3. Events listened to but never emitted by any skill
for (const [evt, listeners] of allListenedEvents) {
  if (!allEmittedEvents.has(evt)) {
    errors.push(
      `Event "${evt}" is listened to by [${listeners.join(', ')}] but never emitted by any skill`,
    );
  }
}

// 4. Events emitted but never listened to (warning only)
for (const [evt, emitters] of allEmittedEvents) {
  if (!allListenedEvents.has(evt)) {
    warnings.push(
      `Event "${evt}" is emitted by [${emitters.join(', ')}] but not listened to by any skill`,
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('');
console.log('Event Registry Validation');
console.log('=========================');
console.log(`  Registry events:  ${registryEvents.size}`);
console.log(`  Skills scanned:   ${skillFiles.length}`);
console.log(`  Events emitted:   ${allEmittedEvents.size}`);
console.log(`  Events listened:  ${allListenedEvents.size}`);

if (warnings.length > 0) {
  console.log('');
  console.log('Warnings:');
  for (const w of warnings) {
    console.log(`  WARN  ${w}`);
  }
}

if (errors.length > 0) {
  console.log('');
  console.log('Errors:');
  for (const e of errors) {
    console.log(`  FAIL  ${e}`);
  }
  console.log('');
  console.log(`Result: FAIL (${errors.length} error(s), ${warnings.length} warning(s))`);
  process.exit(1);
}

console.log('');
console.log(`Result: PASS (0 errors, ${warnings.length} warning(s))`);
process.exit(0);
