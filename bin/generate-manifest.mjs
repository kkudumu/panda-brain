#!/usr/bin/env node
/**
 * generate-manifest.mjs
 *
 * Scans all ftm skill SKILL.md files and produces ftm-manifest.json
 * at the project root with structured metadata for each skill.
 *
 * Usage: node bin/generate-manifest.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Discovery — collect all SKILL.md paths
// ---------------------------------------------------------------------------

/**
 * Returns an array of { skillFile, skillDir, triggerFile } objects.
 * Handles both ftm-X/SKILL.md pattern and the special ftm/SKILL.md root skill.
 */
function discoverSkillFiles() {
  const entries = fs.readdirSync(ROOT, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirName = entry.name;

    // Root ftm skill
    if (dirName === 'ftm') {
      const skillFile = path.join(ROOT, 'ftm', 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        skills.push({
          skillFile,
          skillDir: 'ftm/',
          triggerFile: 'ftm.yml',
        });
      }
      continue;
    }

    // ftm-* skill directories
    if (dirName.startsWith('ftm-')) {
      const skillFile = path.join(ROOT, dirName, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        skills.push({
          skillFile,
          skillDir: `${dirName}/`,
          triggerFile: `${dirName}.yml`,
        });
      }
    }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Splits markdown content into a map of { sectionHeading -> lines[] }.
 * Tracks both ## and ### headings.
 */
function parseSections(content) {
  const lines = content.split('\n');
  const sections = {};
  let currentHeading = null;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/);
    const h3Match = line.match(/^###\s+(.+)/);

    if (h2Match) {
      currentHeading = h2Match[1].trim();
      sections[currentHeading] = [];
    } else if (h3Match) {
      currentHeading = h3Match[1].trim();
      sections[currentHeading] = [];
    } else if (currentHeading !== null) {
      sections[currentHeading].push(line);
    }
  }

  return sections;
}

/**
 * Extracts event names from lines under an Emits or Listens To section.
 * Format: - `event_name` — description
 */
function extractEventNames(lines) {
  const events = [];
  const eventRegex = /^-\s*`([^`]+)`/;

  for (const line of lines) {
    const match = line.match(eventRegex);
    if (match) {
      events.push(match[1]);
    }
  }

  return events;
}

/**
 * Extracts ~/.claude/ftm-state/... paths from blackboard section lines.
 */
function extractBlackboardPaths(lines) {
  const paths = [];
  // Match backtick-quoted paths containing ftm-state
  const pathRegex = /`(~\/.claude\/ftm-state\/[^`]+)`/g;

  for (const line of lines) {
    let match;
    while ((match = pathRegex.exec(line)) !== null) {
      if (!paths.includes(match[1])) {
        paths.push(match[1]);
      }
    }
  }

  return paths;
}

// ---------------------------------------------------------------------------
// New section parsers for the 6 structured YAML contracts
// ---------------------------------------------------------------------------

/**
 * Parses the ## Requirements section.
 * Format: - type: `name` | required|optional | description
 * Returns: Array of { type, name, required, description }
 */
function parseRequirements(lines) {
  const requirements = [];
  // Match lines like: - tool: `knip` | required | static analysis engine
  // or: - config: `knip.config.ts` | optional | custom knip config
  const reqRegex = /^-\s+(tool|config|reference|env):\s+`([^`]+)`\s*\|\s*(required|optional)\s*\|\s*(.+)/;

  for (const line of lines) {
    const match = line.match(reqRegex);
    if (match) {
      requirements.push({
        type: match[1],
        name: match[2],
        required: match[3] === 'required',
        description: match[4].trim(),
      });
    }
  }

  return requirements;
}

/**
 * Parses the ## Risk section.
 * Format:
 *   - level: read_only | low_write | medium_write | high_write | destructive
 *   - scope: description
 *   - rollback: description
 * Returns: { level, scope, rollback }
 */
function parseRisk(lines) {
  let level = null;
  let scope = null;
  let rollback = null;

  for (const line of lines) {
    const levelMatch = line.match(/^-\s+level:\s+(.+)/);
    const scopeMatch = line.match(/^-\s+scope:\s+(.+)/);
    const rollbackMatch = line.match(/^-\s+rollback:\s+(.+)/);

    if (levelMatch) level = levelMatch[1].trim();
    if (scopeMatch) scope = scopeMatch[1].trim();
    if (rollbackMatch) rollback = rollbackMatch[1].trim();
  }

  return { level, scope, rollback };
}

/**
 * Parses the ## Approval Gates section.
 * Format:
 *   - trigger: condition | action: what happens
 *   - complexity_routing: micro → auto | small → auto | ...
 * Returns: { gates: Array<{ trigger, action }>, complexity_routing: object }
 */
function parseApprovalGates(lines) {
  const gates = [];
  let complexity_routing = null;

  for (const line of lines) {
    // complexity_routing line
    const crMatch = line.match(/^-\s+complexity_routing:\s+(.+)/);
    if (crMatch) {
      // Parse: micro → auto | small → auto | medium → plan_first | ...
      const routing = {};
      const parts = crMatch[1].split('|').map(s => s.trim());
      for (const part of parts) {
        const arrowMatch = part.match(/^(\w+)\s+[→>-]+\s+(.+)/);
        if (arrowMatch) {
          routing[arrowMatch[1].trim()] = arrowMatch[2].trim();
        }
      }
      complexity_routing = routing;
      continue;
    }

    // trigger/action line
    const triggerMatch = line.match(/^-\s+trigger:\s+(.+?)\s*\|\s*action:\s+(.+)/);
    if (triggerMatch) {
      gates.push({
        trigger: triggerMatch[1].trim(),
        action: triggerMatch[2].trim(),
      });
    }
  }

  return { gates, complexity_routing };
}

/**
 * Parses the ## Fallbacks section.
 * Format: - condition: description | action: what happens
 * Returns: Array of { condition, action }
 */
function parseFallbacks(lines) {
  const fallbacks = [];
  const fallbackRegex = /^-\s+condition:\s+(.+?)\s*\|\s*action:\s+(.+)/;

  for (const line of lines) {
    const match = line.match(fallbackRegex);
    if (match) {
      fallbacks.push({
        condition: match[1].trim(),
        action: match[2].trim(),
      });
    }
  }

  return fallbacks;
}

/**
 * Parses the ## Capabilities section.
 * Format: - mcp|cli|env: `name` | required|optional | description
 * Returns: Array of { type, name, required, description }
 */
function parseCapabilities(lines) {
  const capabilities = [];
  const capRegex = /^-\s+(mcp|cli|env):\s+`([^`]+)`\s*\|\s*(required|optional)\s*\|\s*(.+)/;

  for (const line of lines) {
    const match = line.match(capRegex);
    if (match) {
      capabilities.push({
        type: match[1],
        name: match[2],
        required: match[3] === 'required',
        description: match[4].trim(),
      });
    }
  }

  return capabilities;
}

/**
 * Parses the ## Event Payloads section.
 * Format:
 *   ### event_name
 *   - field: type — description
 * Returns: object mapping event_name -> Array<{ field, type, description }>
 */
function parseEventPayloads(content) {
  const payloads = {};

  // We need to parse ### sub-sections within ## Event Payloads.
  // Find the section start, then extract up to the next ## heading or end of string.
  // Using manual indexing is more reliable than regex for the "last section" case.
  const sectionStart = content.indexOf('\n## Event Payloads\n');
  if (sectionStart < 0) return payloads;

  const afterHeading = content.substring(sectionStart + '\n## Event Payloads\n'.length);
  const nextH2 = afterHeading.indexOf('\n## ');
  const sectionContent = nextH2 >= 0 ? afterHeading.substring(0, nextH2) : afterHeading;
  const lines = sectionContent.split('\n');

  let currentEvent = null;

  for (const line of lines) {
    // ### event_name header
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      currentEvent = h3Match[1].trim();
      payloads[currentEvent] = [];
      continue;
    }

    if (!currentEvent) continue;

    // - field: type — description
    const fieldMatch = line.match(/^-\s+(\w+):\s+([\w\[\]|]+)\s+[—-]+\s+(.+)/);
    if (fieldMatch) {
      payloads[currentEvent].push({
        field: fieldMatch[1],
        type: fieldMatch[2],
        description: fieldMatch[3].trim(),
      });
    }
  }

  return payloads;
}

// ---------------------------------------------------------------------------
// Per-skill metadata extraction
// ---------------------------------------------------------------------------

/**
 * Required sections for the structured YAML contract.
 * Used to generate warnings when sections are missing.
 */
const REQUIRED_CONTRACT_SECTIONS = [
  'Requirements',
  'Risk',
  'Approval Gates',
  'Fallbacks',
  'Capabilities',
  'Event Payloads',
];

function processSkill({ skillFile, skillDir, triggerFile }) {
  const raw = fs.readFileSync(skillFile, 'utf8');
  const stat = fs.statSync(skillFile);
  const parsed = matter(raw);

  const { name, description } = parsed.data;
  const sections = parseSections(parsed.content);

  // Events
  const eventsEmits = extractEventNames(sections['Emits'] || []);
  const eventsListens = extractEventNames(sections['Listens To'] || []);

  // Blackboard paths
  const blackboardReads = extractBlackboardPaths(sections['Blackboard Read'] || []);
  const blackboardWrites = extractBlackboardPaths(sections['Blackboard Write'] || []);

  // New structured contract sections
  const requirements = parseRequirements(sections['Requirements'] || []);
  const risk = parseRisk(sections['Risk'] || []);
  const { gates: approval_gates, complexity_routing } = parseApprovalGates(
    sections['Approval Gates'] || []
  );
  const fallbacks = parseFallbacks(sections['Fallbacks'] || []);
  const capabilities = parseCapabilities(sections['Capabilities'] || []);
  const event_payloads = parseEventPayloads(parsed.content);

  // Warnings — flag any missing required contract sections
  const warnings = [];
  for (const section of REQUIRED_CONTRACT_SECTIONS) {
    if (!sections[section]) {
      warnings.push(`Missing required section: ## ${section}`);
    }
  }

  // References directory
  const referencesDir = path.join(ROOT, skillDir, 'references');
  let references = [];
  if (fs.existsSync(referencesDir)) {
    try {
      references = fs.readdirSync(referencesDir).filter(f => {
        const fullPath = path.join(referencesDir, f);
        return fs.statSync(fullPath).isFile();
      });
    } catch {
      references = [];
    }
  }

  // Evals directory
  const evalsDir = path.join(ROOT, skillDir, 'evals');
  const hasEvals = fs.existsSync(evalsDir) && fs.statSync(evalsDir).isDirectory();

  return {
    name: name || path.basename(skillDir, '/'),
    description: description || '',
    trigger_file: triggerFile,
    skill_directory: skillDir,
    events_emits: eventsEmits,
    events_listens: eventsListens,
    blackboard_reads: blackboardReads,
    blackboard_writes: blackboardWrites,
    requirements,
    risk,
    approval_gates,
    complexity_routing,
    fallbacks,
    capabilities,
    event_payloads,
    references,
    has_evals: hasEvals,
    warnings,
    size_bytes: stat.size,
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const skillEntries = discoverSkillFiles();
  const skills = skillEntries.map(processSkill);

  // Sort alphabetically by name
  skills.sort((a, b) => a.name.localeCompare(b.name));

  // Collect manifest-level warnings for skills with missing sections
  const manifestWarnings = [];
  for (const skill of skills) {
    if (skill.warnings && skill.warnings.length > 0) {
      manifestWarnings.push({
        skill: skill.name,
        warnings: skill.warnings,
      });
    }
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    skills,
    warnings: manifestWarnings,
  };

  const outputPath = path.join(ROOT, 'ftm-manifest.json');
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  process.stderr.write(`Generated manifest for ${skills.length} skills\n`);

  if (manifestWarnings.length > 0) {
    process.stderr.write(
      `Warnings: ${manifestWarnings.length} skill(s) missing required contract sections\n`
    );
    for (const w of manifestWarnings) {
      process.stderr.write(`  ${w.skill}: ${w.warnings.join(', ')}\n`);
    }
  } else {
    process.stderr.write(`All ${skills.length} skills have complete contract sections\n`);
  }
}

main();
