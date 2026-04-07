import type { FtmEvent, Plan, PlanStep } from '@shared/types.js';
import type { FtmEventBus } from '../event-bus.js';

// ---------------------------------------------------------------------------
// Plan gate hook
// ---------------------------------------------------------------------------
//
// Listens to `plan_generated` events and:
//   1. Validates plan structure (non-empty steps, each step has a description).
//   2. Determines plan complexity tier.
//   3. Auto-approves micro/small plans (≤2 steps, low token complexity).
//   4. Emits `plan_approved` for auto-approved plans.
//   5. Leaves complex plans with status `pending` — awaiting user approval.
// ---------------------------------------------------------------------------

export type PlanComplexityTier = 'micro' | 'small' | 'medium' | 'large' | 'epic';

interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

const AUTO_APPROVE_MAX_STEPS = 2;
const AUTO_APPROVE_MAX_DESCRIPTION_WORDS = 50;

function validatePlan(plan: Plan): PlanValidationResult {
  const errors: string[] = [];

  if (!plan.steps || !Array.isArray(plan.steps)) {
    errors.push('Plan has no steps array');
    return { valid: false, errors };
  }

  if (plan.steps.length === 0) {
    errors.push('Plan has zero steps');
  }

  plan.steps.forEach((step: PlanStep, idx: number) => {
    if (!step.description || step.description.trim().length === 0) {
      errors.push(`Step ${idx} has an empty description`);
    }
  });

  return { valid: errors.length === 0, errors };
}

function classifyComplexity(plan: Plan): PlanComplexityTier {
  const stepCount = plan.steps?.length ?? 0;

  if (stepCount <= 1) return 'micro';
  if (stepCount <= 2) return 'small';
  if (stepCount <= 5) return 'medium';
  if (stepCount <= 10) return 'large';
  return 'epic';
}

function totalDescriptionWords(plan: Plan): number {
  return (plan.steps ?? []).reduce((acc: number, step: PlanStep) => {
    const words = (step.description ?? '').trim().split(/\s+/).filter(Boolean).length;
    return acc + words;
  }, 0);
}

function requiresApproval(plan: Plan): boolean {
  return (plan.steps ?? []).some((step: PlanStep) => step.requiresApproval === true);
}

export function registerPlanGateHook(eventBus: FtmEventBus): void {
  eventBus.on('plan_generated', (event: FtmEvent) => {
    const plan = event.data.plan as Plan | undefined;

    if (!plan) {
      console.warn('[PlanGateHook] plan_generated event received with no plan payload');
      return;
    }

    // Step 1: Validate structure
    const validation = validatePlan(plan);
    if (!validation.valid) {
      console.warn(
        `[PlanGateHook] Invalid plan "${plan.id}": ${validation.errors.join('; ')}`
      );
      eventBus.emit('guard_triggered', {
        context: 'plan_gate',
        planId: plan.id,
        violations: validation.errors,
      });
      return;
    }

    // Step 2: Classify complexity
    const complexity = classifyComplexity(plan);
    const wordCount = totalDescriptionWords(plan);
    const stepCount = plan.steps.length;
    const hasExplicitApprovalStep = requiresApproval(plan);

    // Step 3: Decide auto-approval
    const canAutoApprove =
      (complexity === 'micro' || complexity === 'small') &&
      stepCount <= AUTO_APPROVE_MAX_STEPS &&
      wordCount <= AUTO_APPROVE_MAX_DESCRIPTION_WORDS &&
      !hasExplicitApprovalStep;

    if (canAutoApprove) {
      console.log(
        `[PlanGateHook] Auto-approving plan "${plan.id}" — ${stepCount} step(s), complexity=${complexity}`
      );
      eventBus.emit('plan_approved', {
        planId: plan.id,
        taskId: plan.taskId,
        autoApproved: true,
        complexity,
        stepCount,
      });
    } else {
      console.log(
        `[PlanGateHook] Plan "${plan.id}" requires manual approval — complexity=${complexity} steps=${stepCount} hasApprovalStep=${hasExplicitApprovalStep}`
      );
      // Do not emit plan_approved; leave the plan in pending state.
      // The server/OODA loop will surface this to the user for approval.
      eventBus.emit('approval_requested', {
        planId: plan.id,
        taskId: plan.taskId,
        complexity,
        stepCount,
        reason: hasExplicitApprovalStep
          ? 'Plan contains steps that require explicit approval'
          : `Plan complexity is "${complexity}" (${stepCount} steps) — manual review required`,
      });
    }
  });
}
