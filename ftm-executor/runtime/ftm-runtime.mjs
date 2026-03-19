#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { homedir } from 'os';

const STATE_DIR = resolve(homedir(), '.claude', 'ftm-state');
const STATE_FILE = resolve(STATE_DIR, 'runtime-state.json');

// --- Parsing ---

export function parsePlan(markdown) {
  const tasks = [];
  const blocks = markdown.split(/(?=^### Task \d+:)/m).filter(b => b.trim());

  for (const block of blocks) {
    const idMatch = block.match(/^### Task (\d+):\s*(.+)/m);
    if (!idMatch) continue;

    const id = parseInt(idMatch[1], 10);
    const title = idMatch[2].trim();

    const get = (field) => {
      const m = block.match(new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`));
      return m ? m[1].trim() : '';
    };
    const splitList = (raw) => (!raw || raw.toLowerCase() === 'none')
      ? [] : raw.split(',').map(s => s.trim()).filter(Boolean);

    const rawDeps = get('Dependencies');
    const dependencies = splitList(rawDeps).map(d => {
      const m = d.match(/Task\s+(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    }).filter(Boolean);

    const files = splitList(get('Files'));

    const criteriaMatches = [...block.matchAll(/^-\s*\[[ x]\]\s*(.+)/gm)];
    const acceptance_criteria = criteriaMatches.map(m => m[1].trim());

    tasks.push({
      id,
      title,
      description: get('Description'),
      files,
      dependencies,
      agent_type: get('Agent type'),
      acceptance_criteria,
    });
  }

  tasks.sort((a, b) => a.id - b.id);
  return tasks;
}

// --- Wave grouping ---

export function computeWaves(tasks) {
  const allIds = new Set(tasks.map(t => t.id));

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!allIds.has(dep)) {
        throw new Error(`Task ${task.id} references unknown dependency Task ${dep}`);
      }
    }
  }

  const remaining = new Set(tasks.map(t => t.id));
  const completed = new Set();
  const waves = [];
  const taskMap = Object.fromEntries(tasks.map(t => [t.id, t]));

  while (remaining.size > 0) {
    const wave = [...remaining].filter(id =>
      taskMap[id].dependencies.every(dep => completed.has(dep))
    );

    if (wave.length === 0) {
      const cycle = [...remaining].join(', ');
      throw new Error(`Circular dependency detected among tasks: ${cycle}`);
    }

    waves.push(wave.sort((a, b) => a - b));
    for (const id of wave) {
      completed.add(id);
      remaining.delete(id);
    }
  }

  return waves;
}

// --- State I/O ---

function readState() {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function requireState() {
  const s = readState();
  if (!s) { console.error('Error: No active plan. Run plan-index first.'); process.exit(1); }
  return s;
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  state.updated_at = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

// --- Commands ---

function cmdPlanIndex(planPath) {
  const absPath = resolve(planPath);
  if (!existsSync(absPath)) {
    console.error(`Error: Plan file not found: ${absPath}`);
    process.exit(1);
  }

  const content = readFileSync(absPath, 'utf8');
  const tasks = parsePlan(content);
  const waves = computeWaves(tasks);

  const taskState = {};
  for (const task of tasks) {
    taskState[task.id] = { ...task, status: 'pending', completed_at: null };
  }

  const state = {
    plan_path: absPath,
    plan_hash: hashContent(content),
    tasks: taskState,
    waves,
    current_wave: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  writeState(state);

  console.log(JSON.stringify({
    tasks,
    waves,
    total_tasks: tasks.length,
    total_waves: waves.length,
  }, null, 2));
}

function cmdNextWave() {
  const state = requireState();
  const done = { wave_number: null, tasks: [], remaining_waves: 0, complete: true };

  for (let i = 0; i < state.waves.length; i++) {
    const pending = state.waves[i].filter(id => state.tasks[id]?.status !== 'completed');
    if (pending.length > 0) {
      const remaining_waves = state.waves.slice(i + 1)
        .filter(w => w.some(id => state.tasks[id]?.status !== 'completed')).length;
      console.log(JSON.stringify({ wave_number: i + 1, tasks: pending.map(id => state.tasks[id]), remaining_waves }, null, 2));
      return;
    }
  }
  console.log(JSON.stringify(done, null, 2));
}

function cmdMarkComplete(taskIdArg) {
  const taskId = parseInt(taskIdArg, 10);
  if (isNaN(taskId)) { console.error(`Error: Invalid task ID: ${taskIdArg}`); process.exit(1); }

  const state = requireState();
  if (!state.tasks[taskId]) {
    console.error(`Error: Task ${taskId} not found in current plan.`); process.exit(1);
  }

  state.tasks[taskId].status = 'completed';
  state.tasks[taskId].completed_at = new Date().toISOString();

  const waveIdx = state.waves.findIndex(w => w.includes(taskId));
  const wave = waveIdx >= 0 ? state.waves[waveIdx] : [];
  const waveCompleted = wave.filter(id => state.tasks[id]?.status === 'completed').length;
  const totalCompleted = Object.values(state.tasks).filter(t => t.status === 'completed').length;

  writeState(state);

  console.log(JSON.stringify({
    task_id: taskId,
    status: 'completed',
    wave_progress: `${waveCompleted}/${wave.length}`,
    plan_progress: `${totalCompleted}/${Object.keys(state.tasks).length}`,
  }, null, 2));
}

function cmdStatus() {
  const state = requireState();

  const tasks = Object.values(state.tasks);
  const completed = tasks.filter(t => t.status === 'completed').length;
  const pending = tasks.filter(t => t.status === 'pending').length;

  let current_wave = null;
  let waves_remaining = 0;

  for (let i = 0; i < state.waves.length; i++) {
    const wave = state.waves[i];
    const hasPending = wave.some(id => state.tasks[id]?.status !== 'completed');
    if (hasPending) {
      current_wave = i + 1;
      waves_remaining = state.waves.slice(i).filter(w =>
        w.some(id => state.tasks[id]?.status !== 'completed')
      ).length;
      break;
    }
  }

  console.log(JSON.stringify({
    total_tasks: tasks.length,
    completed_tasks: completed,
    current_wave,
    waves_remaining,
    tasks_by_status: { pending, completed },
  }, null, 2));
}

// --- Entry point ---

const [,, command, ...args] = process.argv;

switch (command) {
  case 'plan-index':
    if (!args[0]) { console.error('Usage: ftm-runtime plan-index <plan-path>'); process.exit(1); }
    cmdPlanIndex(args[0]);
    break;
  case 'next-wave':
    cmdNextWave();
    break;
  case 'mark-complete':
    if (!args[0]) { console.error('Usage: ftm-runtime mark-complete <task-id>'); process.exit(1); }
    cmdMarkComplete(args[0]);
    break;
  case 'status':
    cmdStatus();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Commands: plan-index, next-wave, mark-complete, status');
    process.exit(1);
}
