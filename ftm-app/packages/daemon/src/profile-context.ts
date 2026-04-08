import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LearnedPattern, UserProfile } from './shared/types.js';

export interface ExternalProfileSignals {
  preferredName: string | null;
  communicationStyle: string[];
  approvalGuidance: string[];
  modelProfile: string | null;
  approvalMode: 'auto' | 'plan_first' | 'always_ask' | null;
  recurringProjects: LearnedPattern[];
  workStyleNotes: string[];
  sourcePaths: string[];
}

export interface SynthesizedUserContext {
  profile: UserProfile;
  externalSignals: ExternalProfileSignals;
  promptContext: string[];
}

const EXTERNAL_PROFILE_CACHE_TTL_MS = 30_000;

let cachedExternalSignals: { loadedAt: number; value: ExternalProfileSignals } | null = null;

function safeReadText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function safeReadJson<T>(filePath: string): T | null {
  const text = safeReadText(filePath);
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function walkMarkdownFiles(rootDir: string, maxDepth = 4): string[] {
  const results: string[] = [];

  function visit(currentDir: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.git')) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      results.push(fullPath);
    }
  }

  visit(rootDir, 0);
  return results;
}

function parseTopLevelYamlValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}:\\s*([^#\\n]+)`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function titleCaseFirstToken(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const token = raw
    .split(/[.@_\s-]+/)
    .map((part) => part.trim())
    .find(Boolean);

  if (!token) return null;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function mergePatterns(primary: LearnedPattern[], secondary: LearnedPattern[]): LearnedPattern[] {
  const merged = new Map<string, LearnedPattern>();

  for (const item of [...primary, ...secondary]) {
    const key = item.label.trim().toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item });
      continue;
    }

    existing.count += item.count;
    existing.lastSeen = Math.max(existing.lastSeen, item.lastSeen);
  }

  return Array.from(merged.values())
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return right.lastSeen - left.lastSeen;
    })
    .slice(0, 8);
}

function extractMarkdownBullet(content: string, needle: string): string | null {
  const line = content
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.startsWith('-') && value.toLowerCase().includes(needle.toLowerCase()));

  return line ? line.replace(/^-+\s*/, '').trim() : null;
}

function collectSessionMetaProjects(homeDir: string): LearnedPattern[] {
  const sessionMetaDir = path.join(homeDir, '.claude', 'usage-data', 'session-meta');
  let entries: string[] = [];

  try {
    entries = fs.readdirSync(sessionMetaDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .slice(-400);
  } catch {
    return [];
  }

  const counts = new Map<string, LearnedPattern>();

  for (const entry of entries) {
    const filePath = path.join(sessionMetaDir, entry);
    const payload = safeReadJson<{ project_path?: string }>(filePath);
    const projectPath = payload?.project_path;
    if (!projectPath || projectPath === '/' || projectPath.startsWith(path.join(homeDir, '.claude'))) {
      continue;
    }

    const label = path.basename(projectPath) || projectPath;
    const existing = counts.get(label.toLowerCase());
    if (existing) {
      existing.count += 1;
      existing.lastSeen = Date.now();
      continue;
    }

    counts.set(label.toLowerCase(), {
      label,
      count: 1,
      lastSeen: Date.now(),
    });
  }

  return Array.from(counts.values())
    .filter((item) => item.count >= 2)
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
}

function discoverProfileMarkdownFiles(claudeRoot: string): string[] {
  return walkMarkdownFiles(claudeRoot, 4)
    .filter((filePath) => {
      const normalized = filePath.toLowerCase();
      return normalized.includes('profile')
        || normalized.includes('preferences')
        || normalized.includes('communication-style')
        || normalized.includes('voice')
        || normalized.includes('work-style');
    })
    .slice(0, 40);
}

function loadExternalProfileSignals(): ExternalProfileSignals {
  const now = Date.now();
  if (cachedExternalSignals && now - cachedExternalSignals.loadedAt < EXTERNAL_PROFILE_CACHE_TTL_MS) {
    return cachedExternalSignals.value;
  }

  const homeDir = os.homedir();
  const sourcePaths = new Set<string>();
  const communicationStyle = new Set<string>();
  const approvalGuidance = new Set<string>();
  const workStyleNotes = new Set<string>();

  let preferredName: string | null = null;
  let modelProfile: string | null = null;
  let approvalMode: ExternalProfileSignals['approvalMode'] = null;

  const claudeBlackboardPath = path.join(homeDir, '.claude', 'ftm-state', 'blackboard', 'context.json');
  const claudeBlackboard = safeReadJson<{
    user_preferences?: {
      communication_style?: string;
      approval_gates?: string;
      default_model_profile?: string | null;
    };
  }>(claudeBlackboardPath);

  if (claudeBlackboard) {
    sourcePaths.add(claudeBlackboardPath);
    const prefs = claudeBlackboard.user_preferences;
    if (prefs?.communication_style) {
      communicationStyle.add(prefs.communication_style);
    }
    if (prefs?.approval_gates) {
      approvalGuidance.add(prefs.approval_gates);
    }
    if (prefs?.default_model_profile) {
      modelProfile = prefs.default_model_profile;
    }
  }

  const claudeConfigPath = path.join(homeDir, '.claude', 'ftm-config.yml');
  const claudeConfig = safeReadText(claudeConfigPath);
  if (claudeConfig) {
    sourcePaths.add(claudeConfigPath);
    modelProfile = modelProfile ?? parseTopLevelYamlValue(claudeConfig, 'profile');
    const parsedApprovalMode = parseTopLevelYamlValue(claudeConfig, 'approval_mode');
    if (parsedApprovalMode === 'auto' || parsedApprovalMode === 'plan_first' || parsedApprovalMode === 'always_ask') {
      approvalMode = parsedApprovalMode;
      approvalGuidance.add(`Claude execution approval mode is ${parsedApprovalMode}.`);
    }
  }

  const claudeRoot = path.join(homeDir, '.claude');
  for (const markdownPath of discoverProfileMarkdownFiles(claudeRoot)) {
    const content = safeReadText(markdownPath);
    if (!content) continue;

    sourcePaths.add(markdownPath);

    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
    preferredName = preferredName ?? titleCaseFirstToken(heading);

    const communicationNeedles = [
      'concise',
      'technical',
      'direct',
      'professional',
      'confident',
      'natural',
      'emoji',
      'hedging',
    ];

    for (const needle of communicationNeedles) {
      const match = extractMarkdownBullet(content, needle);
      if (match) {
        communicationStyle.add(match);
      }
    }

    const workStyleNeedles = [
      'direct, concrete guidance',
      'deep debugging',
      'building and creation',
      'context switching',
      'fast executor',
      'quick wins',
      'sauce',
      'respond well',
    ];

    for (const needle of workStyleNeedles) {
      const match = extractMarkdownBullet(content, needle);
      if (match) {
        workStyleNotes.add(match);
      }
    }
  }

  const recurringProjects = collectSessionMetaProjects(homeDir);
  if (recurringProjects.length > 0) {
    sourcePaths.add(path.join(homeDir, '.claude', 'usage-data', 'session-meta'));
  }

  const value: ExternalProfileSignals = {
    preferredName,
    communicationStyle: Array.from(communicationStyle),
    approvalGuidance: Array.from(approvalGuidance),
    modelProfile,
    approvalMode,
    recurringProjects,
    workStyleNotes: Array.from(workStyleNotes),
    sourcePaths: Array.from(sourcePaths),
  };

  cachedExternalSignals = { loadedAt: now, value };
  return value;
}

function inferResponseStyle(profile: UserProfile, external: ExternalProfileSignals): UserProfile['responseStyle'] {
  if (profile.responseStyle === 'direct') {
    return 'direct';
  }

  const joined = external.communicationStyle.join(' ').toLowerCase();
  if (
    joined.includes('concise')
    || joined.includes('direct')
    || joined.includes('technical')
    || joined.includes('confident')
  ) {
    return 'direct';
  }

  return profile.responseStyle;
}

function inferApprovalPreference(profile: UserProfile, external: ExternalProfileSignals): UserProfile['approvalPreference'] {
  if (profile.approvalPreference !== 'mixed') {
    return profile.approvalPreference;
  }

  if (external.approvalMode === 'always_ask') {
    return 'hands_on';
  }
  if (external.approvalMode === 'auto') {
    return 'streamlined';
  }

  return profile.approvalPreference;
}

export function synthesizeUserContext(profile: UserProfile): SynthesizedUserContext {
  const externalSignals = loadExternalProfileSignals();
  const mergedProfile: UserProfile = {
    ...profile,
    preferredName: profile.preferredName ?? externalSignals.preferredName,
    responseStyle: inferResponseStyle(profile, externalSignals),
    approvalPreference: inferApprovalPreference(profile, externalSignals),
    activeProjects: mergePatterns(profile.activeProjects, externalSignals.recurringProjects),
  };

  const promptContext: string[] = [];

  if (mergedProfile.preferredName) {
    promptContext.push(`Preferred name: ${mergedProfile.preferredName}`);
  }

  promptContext.push(`Preferred response style: ${mergedProfile.responseStyle}`);
  promptContext.push(`Approval preference: ${mergedProfile.approvalPreference}`);

  if (externalSignals.modelProfile) {
    promptContext.push(`Claude profile in use elsewhere: ${externalSignals.modelProfile}`);
  }

  if (externalSignals.approvalMode) {
    promptContext.push(`Claude-side approval mode: ${externalSignals.approvalMode}`);
  }

  if (mergedProfile.activeProjects.length > 0) {
    promptContext.push(`Recurring projects: ${mergedProfile.activeProjects.slice(0, 5).map((item) => item.label).join(', ')}`);
  }

  if (externalSignals.communicationStyle.length > 0) {
    promptContext.push(`External communication signals: ${externalSignals.communicationStyle.slice(0, 3).join(' | ')}`);
  }

  if (externalSignals.workStyleNotes.length > 0) {
    promptContext.push(`External work-style notes: ${externalSignals.workStyleNotes.slice(0, 3).join(' | ')}`);
  }

  if (externalSignals.approvalGuidance.length > 0) {
    promptContext.push(`Approval guidance: ${externalSignals.approvalGuidance.slice(0, 2).join(' | ')}`);
  }

  return {
    profile: mergedProfile,
    externalSignals,
    promptContext,
  };
}
