#!/usr/bin/env node
// tests/runtime/test-ftm-runtime.mjs
// Unit tests for the ftm-runtime.mjs module.
// Exercises: plan-index, next-wave, mark-complete, status, circular dependency detection.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNTIME = join(__dirname, '../../ftm-executor/runtime/ftm-runtime.mjs');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ ${message}`);
    failed++;
    failures.push(message);
  }
}

function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ ${message}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
    failures.push(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function section(title) {
  console.log(`\n${title}:`);
}

// ---------------------------------------------------------------------------
// Check the runtime module exists before continuing
// ---------------------------------------------------------------------------

if (!existsSync(RUNTIME)) {
  console.error(`\nFATAL: ftm-runtime.mjs not found at ${RUNTIME}`);
  console.error('Cannot run runtime unit tests without the runtime module.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// State isolation — use a temp STATE_DIR so tests don't touch real ~/.claude
// ---------------------------------------------------------------------------

const TEMP_STATE_DIR = join('/tmp', `ftm-test-state-${Date.now()}`);
mkdirSync(TEMP_STATE_DIR, { recursive: true });

// Patch env for child processes so the runtime writes to our temp dir
const runtimeEnv = {
  ...process.env,
  HOME: '/tmp/ftm-test-home',
};

// Pre-create the fake HOME structure so the runtime can init STATE_DIR
mkdirSync(join('/tmp/ftm-test-home', '.claude', 'ftm-state'), { recursive: true });

function run(cmd) {
  try {
    const output = execSync(`node ${RUNTIME} ${cmd}`, {
      encoding: 'utf-8',
      env: runtimeEnv,
      timeout: 10000,
    });
    return JSON.parse(output);
  } catch (e) {
    const raw = (e.stdout || '') + (e.stderr || '') + (e.message || '');
    // Try to parse stdout even on non-zero exit
    try {
      return JSON.parse(e.stdout || '{}');
    } catch {
      return { error: raw };
    }
  }
}

function runRaw(cmd) {
  try {
    return execSync(`node ${RUNTIME} ${cmd}`, {
      encoding: 'utf-8',
      env: runtimeEnv,
      timeout: 10000,
    });
  } catch (e) {
    return { exitCode: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

// ---------------------------------------------------------------------------
// Plan fixtures
// ---------------------------------------------------------------------------

const FOUR_TASK_PLAN = `# Test Plan

## Tasks

### Task 1: First task
**Description:** Do the first thing
**Files:** a.ts, b.ts
**Dependencies:** none
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] First thing done

### Task 2: Second task
**Description:** Do the second thing
**Files:** c.ts
**Dependencies:** Task 1
**Agent type:** backend-architect
**Acceptance criteria:**
- [ ] Second thing done

### Task 3: Third task
**Description:** Do the third thing
**Files:** d.ts
**Dependencies:** none
**Agent type:** frontend-developer
**Acceptance criteria:**
- [ ] Third thing done

### Task 4: Fourth task
**Description:** Do the fourth thing
**Files:** e.ts
**Dependencies:** Task 2, Task 3
**Agent type:** test-writer-fixer
**Acceptance criteria:**
- [ ] Fourth thing done
`;

const SINGLE_TASK_PLAN = `# Single Task Plan

## Tasks

### Task 1: Only task
**Description:** The one and only task
**Files:** main.ts
**Dependencies:** none
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] Done
`;

const LINEAR_CHAIN_PLAN = `# Linear Chain Plan

## Tasks

### Task 1: Step A
**Description:** First step
**Files:** a.ts
**Dependencies:** none
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] Step A done

### Task 2: Step B
**Description:** Second step
**Files:** b.ts
**Dependencies:** Task 1
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] Step B done

### Task 3: Step C
**Description:** Third step
**Files:** c.ts
**Dependencies:** Task 2
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] Step C done
`;

const CIRCULAR_PLAN = `# Circular Plan

## Tasks

### Task 1: A
**Description:** A depends on B
**Files:** a.ts
**Dependencies:** Task 2
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] done

### Task 2: B
**Description:** B depends on A
**Files:** b.ts
**Dependencies:** Task 1
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] done
`;

const DIAMOND_PLAN = `# Diamond Dependency Plan

## Tasks

### Task 1: Root
**Description:** Root task
**Files:** root.ts
**Dependencies:** none
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] Root done

### Task 2: Left branch
**Description:** Left branch
**Files:** left.ts
**Dependencies:** Task 1
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] Left done

### Task 3: Right branch
**Description:** Right branch
**Files:** right.ts
**Dependencies:** Task 1
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] Right done

### Task 4: Merge
**Description:** Merge both branches
**Files:** merge.ts
**Dependencies:** Task 2, Task 3
**Agent type:** general-purpose
**Acceptance criteria:**
- [ ] Merge done
`;

// Write test plan files
const PLAN_PATH = '/tmp/ftm-test-plan.md';
const SINGLE_PLAN_PATH = '/tmp/ftm-test-single-plan.md';
const LINEAR_PLAN_PATH = '/tmp/ftm-test-linear-plan.md';
const CIRCULAR_PLAN_PATH = '/tmp/ftm-circular-plan.md';
const DIAMOND_PLAN_PATH = '/tmp/ftm-diamond-plan.md';

writeFileSync(PLAN_PATH, FOUR_TASK_PLAN);
writeFileSync(SINGLE_PLAN_PATH, SINGLE_TASK_PLAN);
writeFileSync(LINEAR_PLAN_PATH, LINEAR_CHAIN_PLAN);
writeFileSync(CIRCULAR_PLAN_PATH, CIRCULAR_PLAN);
writeFileSync(DIAMOND_PLAN_PATH, DIAMOND_PLAN);

// ---------------------------------------------------------------------------
// Tests: plan-index — four-task plan
// ---------------------------------------------------------------------------

section('plan-index (four-task plan)');

const index = run(`plan-index ${PLAN_PATH}`);
assert(!index.error, 'plan-index succeeds without error');
assert(typeof index.total_tasks === 'number', 'returns total_tasks');
assertEqual(index.total_tasks, 4, 'parses 4 tasks');
assert(Array.isArray(index.waves), 'returns waves array');
assertEqual(index.waves.length, 3, 'computes 3 waves');
assert(Array.isArray(index.waves[0]), 'wave 1 is an array');
assertEqual(index.waves[0].length, 2, 'wave 1 has 2 tasks (1 and 3, both have no deps)');
assert(
  index.waves[0].includes(1) && index.waves[0].includes(3),
  'wave 1 contains tasks 1 and 3',
);
assertEqual(index.waves[1].length, 1, 'wave 2 has 1 task (2, depends on 1)');
assertEqual(index.waves[1][0], 2, 'wave 2 task is task 2');
assertEqual(index.waves[2].length, 1, 'wave 3 has 1 task (4, depends on 2 and 3)');
assertEqual(index.waves[2][0], 4, 'wave 3 task is task 4');
assert(Array.isArray(index.tasks), 'returns tasks array');
assertEqual(index.tasks.length, 4, 'tasks array has 4 entries');

// Validate task structure
const task1 = index.tasks.find(t => t.id === 1);
assert(task1 !== undefined, 'task 1 found in tasks array');
assert(task1.title !== undefined, 'task has title field');
assert(task1.description !== undefined, 'task has description field');
assert(Array.isArray(task1.files), 'task has files array');
assert(Array.isArray(task1.dependencies), 'task has dependencies array');
assert(Array.isArray(task1.acceptance_criteria), 'task has acceptance_criteria array');
assert(task1.agent_type !== undefined, 'task has agent_type field');

// ---------------------------------------------------------------------------
// Tests: next-wave — initial state
// ---------------------------------------------------------------------------

section('next-wave (wave 1)');

const next1 = run('next-wave');
assert(!next1.error, 'next-wave succeeds');
assert(typeof next1.wave_number === 'number', 'returns wave_number');
assertEqual(next1.wave_number, 1, 'first wave is wave 1');
assert(Array.isArray(next1.tasks), 'returns tasks array');
assertEqual(next1.tasks.length, 2, 'wave 1 has 2 tasks');
assert(
  next1.tasks.some(t => t.id === 1) && next1.tasks.some(t => t.id === 3),
  'wave 1 tasks are task 1 and task 3',
);
assert(typeof next1.remaining_waves === 'number', 'returns remaining_waves count');
assert(next1.remaining_waves >= 2, 'at least 2 more waves remain after wave 1');

// ---------------------------------------------------------------------------
// Tests: mark-complete — complete wave 1
// ---------------------------------------------------------------------------

section('mark-complete (tasks 1 and 3)');

const mark1 = run('mark-complete 1');
assert(!mark1.error, 'mark-complete 1 succeeds');
assertEqual(mark1.task_id, 1, 'mark-complete returns correct task_id');
assertEqual(mark1.status, 'completed', 'mark-complete returns status: completed');
assert(typeof mark1.wave_progress === 'string', 'returns wave_progress string');
assert(typeof mark1.plan_progress === 'string', 'returns plan_progress string');

const mark3 = run('mark-complete 3');
assert(!mark3.error, 'mark-complete 3 succeeds');
assertEqual(mark3.task_id, 3, 'mark-complete returns correct task_id for task 3');

// ---------------------------------------------------------------------------
// Tests: next-wave — after wave 1 complete
// ---------------------------------------------------------------------------

section('next-wave (wave 2 after completing wave 1)');

const next2 = run('next-wave');
assert(!next2.error, 'next-wave succeeds after completing wave 1');
assertEqual(next2.wave_number, 2, 'after wave 1, next wave is 2');
assertEqual(next2.tasks.length, 1, 'wave 2 has 1 task');
assertEqual(next2.tasks[0].id, 2, 'wave 2 task is task 2');

// ---------------------------------------------------------------------------
// Tests: status — mid-execution
// ---------------------------------------------------------------------------

section('status (mid-execution)');

const statusMid = run('status');
assert(!statusMid.error, 'status succeeds mid-execution');
assert(typeof statusMid.total_tasks === 'number', 'status has total_tasks');
assert(typeof statusMid.completed_tasks === 'number', 'status has completed_tasks');
assertEqual(statusMid.total_tasks, 4, 'total_tasks is 4');
assertEqual(statusMid.completed_tasks, 2, '2 tasks completed after wave 1');
assert(statusMid.current_wave !== null, 'current_wave is set');
assertEqual(statusMid.current_wave, 2, 'current_wave is 2');
assert(statusMid.tasks_by_status !== undefined, 'status has tasks_by_status');
assertEqual(statusMid.tasks_by_status.completed, 2, 'tasks_by_status.completed is 2');
assertEqual(statusMid.tasks_by_status.pending, 2, 'tasks_by_status.pending is 2');

// ---------------------------------------------------------------------------
// Tests: complete wave 2, then wave 3
// ---------------------------------------------------------------------------

section('mark-complete (tasks 2 and 4 — waves 2 and 3)');

const mark2 = run('mark-complete 2');
assert(!mark2.error, 'mark-complete 2 succeeds');

// After completing task 2, wave 3 (task 4) should be next
const next3 = run('next-wave');
assert(!next3.error, 'next-wave returns wave 3 after completing wave 2');
assertEqual(next3.wave_number, 3, 'wave 3 is the next wave');
assertEqual(next3.tasks[0].id, 4, 'wave 3 task is task 4');
assertEqual(next3.remaining_waves, 0, 'no more waves after wave 3');

const mark4 = run('mark-complete 4');
assert(!mark4.error, 'mark-complete 4 succeeds');

// All done
const finalNext = run('next-wave');
assert(!finalNext.error, 'next-wave succeeds when all tasks complete');
assertEqual(finalNext.complete, true, 'complete is true when all tasks done');

// ---------------------------------------------------------------------------
// Tests: final status
// ---------------------------------------------------------------------------

section('status (all tasks complete)');

const statusFinal = run('status');
assert(!statusFinal.error, 'final status succeeds');
assertEqual(statusFinal.total_tasks, 4, 'total_tasks is 4');
assertEqual(statusFinal.completed_tasks, 4, '4 tasks completed');
assertEqual(statusFinal.current_wave, null, 'current_wave is null when complete');

// ---------------------------------------------------------------------------
// Tests: single-task plan
// ---------------------------------------------------------------------------

section('plan-index (single-task plan)');

const singleIndex = run(`plan-index ${SINGLE_PLAN_PATH}`);
assert(!singleIndex.error, 'single-task plan-index succeeds');
assertEqual(singleIndex.total_tasks, 1, 'single plan has 1 task');
assertEqual(singleIndex.waves.length, 1, 'single plan has 1 wave');
assertEqual(singleIndex.waves[0].length, 1, 'wave 1 has 1 task');

const singleNext = run('next-wave');
assert(!singleNext.error, 'next-wave succeeds for single-task plan');
assertEqual(singleNext.wave_number, 1, 'wave number is 1');

run('mark-complete 1');
const singleFinal = run('next-wave');
assertEqual(singleFinal.complete, true, 'single task plan complete after marking done');

// ---------------------------------------------------------------------------
// Tests: linear chain plan (A → B → C)
// ---------------------------------------------------------------------------

section('plan-index (linear chain: A→B→C)');

const linearIndex = run(`plan-index ${LINEAR_PLAN_PATH}`);
assert(!linearIndex.error, 'linear chain plan-index succeeds');
assertEqual(linearIndex.total_tasks, 3, 'linear chain has 3 tasks');
assertEqual(linearIndex.waves.length, 3, 'linear chain has 3 waves (one per task)');
assertEqual(linearIndex.waves[0], [1], 'wave 1 is task 1');
assertEqual(linearIndex.waves[1], [2], 'wave 2 is task 2');
assertEqual(linearIndex.waves[2], [3], 'wave 3 is task 3');

// Each wave should only unlock after previous complete
run('mark-complete 1');
const linearNext2 = run('next-wave');
assertEqual(linearNext2.wave_number, 2, 'completing task 1 unlocks wave 2');

run('mark-complete 2');
const linearNext3 = run('next-wave');
assertEqual(linearNext3.wave_number, 3, 'completing task 2 unlocks wave 3');

run('mark-complete 3');
const linearDone = run('next-wave');
assertEqual(linearDone.complete, true, 'linear chain complete after all tasks done');

// ---------------------------------------------------------------------------
// Tests: diamond dependency plan
// ---------------------------------------------------------------------------

section('plan-index (diamond: 1→2,3→4)');

const diamondIndex = run(`plan-index ${DIAMOND_PLAN_PATH}`);
assert(!diamondIndex.error, 'diamond plan-index succeeds');
assertEqual(diamondIndex.total_tasks, 4, 'diamond has 4 tasks');
assertEqual(diamondIndex.waves.length, 3, 'diamond has 3 waves');
assertEqual(diamondIndex.waves[0], [1], 'wave 1 is root task');
assertEqual(diamondIndex.waves[1].length, 2, 'wave 2 has 2 parallel tasks (2 and 3)');
assert(
  diamondIndex.waves[1].includes(2) && diamondIndex.waves[1].includes(3),
  'wave 2 contains both branch tasks',
);
assertEqual(diamondIndex.waves[2], [4], 'wave 3 is merge task');

run('mark-complete 1');
const diamondW2 = run('next-wave');
assertEqual(diamondW2.wave_number, 2, 'completing root unlocks both branches in wave 2');
assertEqual(diamondW2.tasks.length, 2, 'both branch tasks available in wave 2');

run('mark-complete 2');
// wave 3 should NOT be available yet because task 3 still pending
const diamondStillW2 = run('next-wave');
assertEqual(diamondStillW2.wave_number, 2, 'wave 2 still active after completing only one branch');
assertEqual(diamondStillW2.tasks.length, 1, 'only one branch task remains in wave 2');
assertEqual(diamondStillW2.tasks[0].id, 3, 'remaining wave 2 task is task 3');

run('mark-complete 3');
const diamondW3 = run('next-wave');
assertEqual(diamondW3.wave_number, 3, 'completing both branches unlocks merge task');

run('mark-complete 4');
const diamondDone = run('next-wave');
assertEqual(diamondDone.complete, true, 'diamond plan complete');

// ---------------------------------------------------------------------------
// Tests: circular dependency detection
// ---------------------------------------------------------------------------

section('circular dependency detection');

// Reset state to the four-task plan first so we have a clean starting state
run(`plan-index ${PLAN_PATH}`);

// Now try the circular plan — runtime throws and exits non-zero
const circularRaw = runRaw(`plan-index ${CIRCULAR_PLAN_PATH}`);
const isCircularDetected =
  (typeof circularRaw === 'object' && circularRaw.exitCode !== 0) ||
  (typeof circularRaw === 'object' &&
    (circularRaw.stderr || '').toLowerCase().includes('circular'));

assert(isCircularDetected, 'circular dependency detected and reported (non-zero exit or circular error in stderr)');

// ---------------------------------------------------------------------------
// Tests: error handling — invalid plan path
// ---------------------------------------------------------------------------

section('error handling');

const missingPlan = run('plan-index /tmp/definitely-does-not-exist-ftm-plan.md');
assert(missingPlan.error !== undefined || typeof missingPlan !== 'object' || Object.keys(missingPlan).length === 0,
  'plan-index with missing file returns error');

// Invalid task ID for mark-complete
const invalidMark = runRaw('mark-complete not-a-number');
assert(
  typeof invalidMark === 'object' && invalidMark.exitCode !== 0,
  'mark-complete with invalid task ID exits non-zero',
);

// Unknown command
const unknownCmd = runRaw('frobnicate');
assert(
  typeof unknownCmd === 'object' && unknownCmd.exitCode !== 0,
  'unknown command exits non-zero',
);

// ---------------------------------------------------------------------------
// Tests: plan-index idempotency — calling twice uses latest plan
// ---------------------------------------------------------------------------

section('plan-index idempotency');

run(`plan-index ${PLAN_PATH}`);
const idx1 = run(`plan-index ${PLAN_PATH}`);
assert(!idx1.error, 're-indexing same plan succeeds');
assertEqual(idx1.total_tasks, 4, 're-indexed plan still has 4 tasks');

// After re-index, state should be fresh (no completed tasks)
const freshStatus = run('status');
assertEqual(freshStatus.completed_tasks, 0, 'status resets after re-indexing');

// ---------------------------------------------------------------------------
// Tests: mark-complete is idempotent
// ---------------------------------------------------------------------------

section('mark-complete idempotency');

run(`plan-index ${PLAN_PATH}`);
run('mark-complete 1');
const dupeMark = run('mark-complete 1');
// Marking the same task twice should not throw — just report completed again
assert(!dupeMark.error || dupeMark.status === 'completed',
  'marking already-completed task does not throw fatal error');

const afterDupe = run('status');
assertEqual(afterDupe.completed_tasks, 1, 'duplicate mark-complete does not double-count');

// ---------------------------------------------------------------------------
// Tests: wave_number field in next-wave response
// ---------------------------------------------------------------------------

section('wave_number correctness throughout execution');

run(`plan-index ${PLAN_PATH}`);

// Wave 1
const wv1 = run('next-wave');
assertEqual(wv1.wave_number, 1, 'fresh plan starts at wave 1');

run('mark-complete 1');
run('mark-complete 3');
const wv2 = run('next-wave');
assertEqual(wv2.wave_number, 2, 'after completing wave 1, wave_number is 2');

run('mark-complete 2');
const wv3 = run('next-wave');
assertEqual(wv3.wave_number, 3, 'after completing wave 2, wave_number is 3');

run('mark-complete 4');
const wvDone = run('next-wave');
assert(wvDone.complete === true, 'complete flag set when all waves done');
assert(wvDone.wave_number === null || wvDone.wave_number === undefined,
  'wave_number is absent or null when complete');

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

try {
  rmSync(TEMP_STATE_DIR, { recursive: true, force: true });
} catch {
  // ignore
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailed assertions:');
  failures.forEach(f => console.log(`  - ${f}`));
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
