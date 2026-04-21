import type {
  Task,
  Plan,
  PlanStep,
  TaskContext,
  FtmModule,
  ModuleResult,
  FtmEvent,
} from './shared/types.js';
import { FtmEventBus } from './event-bus.js';
import { Blackboard } from './blackboard.js';
import { ModelRouter } from './router.js';
import { synthesizeUserContext } from './profile-context.js';
import { PlannerModule } from './modules/planner.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ModelAdapter, NormalizedResponse, SessionOpts } from './shared/types.js';

type OodaPhase = 'idle' | 'observe' | 'orient' | 'decide' | 'act' | 'complete' | 'error';

interface OrientResult {
  complexity: 'micro' | 'small' | 'medium' | 'large' | 'xl';
  matchedModules: FtmModule[];
  guardFlags: string[];
}

interface ParsedIssueContext {
  issueKey?: string;
  title?: string;
  description?: string;
  acceptanceCriteria: string[];
}

interface AgenticPlanPayload {
  selected_skill?: string;
  requires_approval?: boolean;
  steps?: Array<{
    description?: string;
    requiresApproval?: boolean;
    requires_approval?: boolean;
    skill?: string;
  }>;
}

/**
 * OodaLoop — the cognitive core of the FTM daemon.
 *
 * Implements the Observe → Orient → Decide → Act cycle:
 *
 *   OBSERVE  – pull context from blackboard, check for matching playbooks,
 *              retrieve relevant past experiences.
 *   ORIENT   – classify task complexity, select applicable modules, evaluate
 *              guard rules.
 *   DECIDE   – generate an execution plan (single-step for simple tasks,
 *              multi-step for complex ones).
 *   ACT      – execute each plan step in sequence using the model router to
 *              dispatch to the correct adapter.
 */
export class OodaLoop {
  private phase: OodaPhase = 'idle';
  private modules: FtmModule[] = [];
  private eventBus: FtmEventBus;
  private blackboard: Blackboard;
  private router: ModelRouter;
  private currentTask: Task | null = null;
  private currentPlan: Plan | null = null;

  constructor(eventBus: FtmEventBus, blackboard: Blackboard, router: ModelRouter) {
    this.eventBus = eventBus;
    this.blackboard = blackboard;
    this.router = router;
  }

  // ---------------------------------------------------------------------------
  // Module registration
  // ---------------------------------------------------------------------------

  registerModule(module: FtmModule): void {
    this.modules.push(module);
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  /**
   * Runs the full OODA cycle for the given task and returns the final result.
   * Emits lifecycle events throughout so the daemon can stream progress to clients.
   */
  async processTask(task: Task): Promise<ModuleResult> {
    this.currentTask = task;
    this.blackboard.setCurrentTask(task);

    try {
      // ── OBSERVE ────────────────────────────────────────────────────────────
      this.setPhase('observe');
      const context = await this.observe(task);

      // ── ORIENT ─────────────────────────────────────────────────────────────
      this.setPhase('orient');
      const analysis = await this.orient(context);

      // ── DECIDE ─────────────────────────────────────────────────────────────
      this.setPhase('decide');
      const plan = await this.decide(task, analysis);
      this.currentPlan = plan;

      // Wait for approval when required by the config
      if (this.router.getConfig().execution.approvalMode !== 'auto') {
        if (this.hasApprovalEvent(plan.id)) {
          plan.status = 'approved';
        } else {
          this.eventBus.emitTyped('approval_requested', { taskId: task.id, plan });
          await this.waitForApproval(plan);
        }
      }

      // ── ACT ────────────────────────────────────────────────────────────────
      this.setPhase('act');
      const result = await this.act(plan);

      this.setPhase('complete');
      this.eventBus.emitTyped('task_completed', { taskId: task.id, result });
      return result;
    } catch (error) {
      this.setPhase('error');
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.eventBus.emitTyped('error', { taskId: task.id, error: errorMsg });
      return { success: false, error: errorMsg };
    } finally {
      this.blackboard.clearCurrentTask();
      this.currentTask = null;
      this.currentPlan = null;
    }
  }

  private getTaskWorkingDir(task: Task): string {
    return task.workingDir ?? process.cwd();
  }

  // ---------------------------------------------------------------------------
  // OBSERVE
  // ---------------------------------------------------------------------------

  /**
   * Loads contextual information: current blackboard state, any matching
   * playbook, and relevant past experiences.
   */
  private async observe(task: Task): Promise<TaskContext> {
    this.eventBus.emitTyped('memory_retrieved', { taskId: task.id });

    const context: TaskContext = {
      task,
      blackboard: this.blackboard.getContext(),
      config: this.router.getConfig(),
    };

    // Check for a matching playbook and record the match if found
    const playbook = this.blackboard.checkPlaybook(task.description);
    if (playbook) {
      this.eventBus.emitTyped('playbook_matched', {
        taskId: task.id,
        playbookId: playbook.id,
      });
      this.blackboard.recordPlaybookUse(playbook.id);
    }

    // Surface relevant past experiences (result used by orient step)
    this.blackboard.findRelevantExperiences('general', []);

    return context;
  }

  // ---------------------------------------------------------------------------
  // ORIENT
  // ---------------------------------------------------------------------------

  /**
   * Classifies task complexity, identifies applicable modules, and evaluates
   * guard rules against the task context.
   */
  private async orient(context: TaskContext): Promise<OrientResult> {
    const complexity = this.classifyComplexity(context.task.description);

    const matchedModules = this.modules.filter((m) => m.canHandle(context));

    const guardFlags = this.checkGuardRules(context);

    return { complexity, matchedModules, guardFlags };
  }

  // ---------------------------------------------------------------------------
  // DECIDE
  // ---------------------------------------------------------------------------

  /**
   * Produces an execution plan.
   *
   * For complex tasks (many guard flags or matched modules) we emit the plan
   * with multiple steps; for simple tasks we emit a single-step plan.
   * LLM-powered decomposition will replace this heuristic once adapters are live.
   */
  private async decide(task: Task, analysis: OrientResult): Promise<Plan> {
    const planner = this.getPlannerModule(analysis);
    const basePlan =
      (await this.buildModelFirstPlan(task, analysis)) ??
      (planner
        ? planner.decompose(task.description, task.id).plan
        : this.buildFallbackPlan(task.id, this.normalizeTaskDescription(task.description)));

    const steps: PlanStep[] = this.prependGuardSteps(basePlan.steps, analysis.guardFlags);

    const plan: Plan = {
      ...basePlan,
      taskId: task.id,
      laneId: task.laneId ?? basePlan.laneId,
      steps,
      status: 'pending',
      currentStep: 0,
    };

    this.eventBus.emitTyped('plan_generated', { taskId: task.id, plan });
    return plan;
  }

  private async buildModelFirstPlan(task: Task, analysis: OrientResult): Promise<Plan | null> {
    try {
      const adapter = await this.router.route('planning');
      const response = await this.runWithPersistentSession(
        adapter,
        this.buildPlanningPrompt(task.description, analysis),
        {
          workingDir: this.getTaskWorkingDir(task),
          systemPrompt: [
            'You are the planning layer for Feed The Machine.',
            'Read the raw user input directly and infer intent from it.',
            'Ignore page chrome, accessibility navigation, and repeated UI labels when they are not relevant to the actual task.',
            'Return only valid JSON.',
          ].join(' '),
          temperature: 0.2,
        },
      );

      return this.parseModelPlan(task.id, response.text);
    } catch {
      return null;
    }
  }

  /**
   * Builds plan steps from the task and orient analysis.
   * Guard flags get prepended as validation steps; the main task follows.
   */
  private prependGuardSteps(steps: PlanStep[], guardFlags: string[]): PlanStep[] {
    const guardedSteps: PlanStep[] = [];

    const pushGuardStep = (description: string) => {
      guardedSteps.push({
        index: guardedSteps.length,
        description,
        status: 'pending',
        requiresApproval: true,
      });
    };

    // Add a confirmation step for each guard flag so the executor can pause
    if (guardFlags.includes('destructive_operation')) {
      pushGuardStep('Confirm: destructive operation detected — verify intent before proceeding');
    }

    if (guardFlags.includes('production_target')) {
      pushGuardStep('Confirm: task targets a production system — proceed with caution');
    }

    return [
      ...guardedSteps,
      ...steps.map((step, index) => ({
        ...step,
        index: guardedSteps.length + index,
      })),
    ];
  }

  private buildFallbackPlan(taskId: string, description: string): Plan {
    return {
      id: `plan-${Date.now()}`,
      taskId,
      laneId: this.currentTask?.laneId,
      steps: [
        {
          index: 0,
          description,
          status: 'pending',
        },
      ],
      status: 'pending',
      currentStep: 0,
      createdAt: Date.now(),
    };
  }

  private getPlannerModule(analysis: OrientResult): PlannerModule | null {
    return (
      analysis.matchedModules.find(
        (module): module is PlannerModule => module instanceof PlannerModule,
      ) ?? null
    );
  }

  private buildPlanningPrompt(description: string, _analysis: OrientResult): string {
    const skillBundle = this.loadPlanningSkillBundle();
    const availableSkills = this.loadAvailableSkillNames();

    return [
      'You are running the standalone FTM app.',
      'Your job is to behave like the checked-in ftm router + ftm-mind skill system, but inside this standalone host.',
      'Do not invent your own routing framework. Follow the skill corpus below.',
      'Choose the smallest correct next move.',
      'If a specialized ftm skill is the right route, set selected_skill to that exact name. Otherwise selected_skill should be "ftm-mind".',
      'Return only valid JSON.',
      'JSON shape:',
      '{"selected_skill":"ftm-mind","requires_approval":false,"steps":[{"description":"...","requires_approval":false,"skill":"ftm-mind"}]}',
      'Rules:',
      '- Use 1-8 steps.',
      '- Each step must be a concrete action sentence.',
      '- Preserve user intent from raw pasted content.',
      '- Ignore page chrome, accessibility nav text, repeated UI labels, and boilerplate when they are not the task.',
      '- If the task is just a direct answer, return one step with the answer-oriented action and use ftm-mind.',
      `Available skills: ${availableSkills.join(', ')}`,
      '',
      'Canonical skill corpus:',
      skillBundle,
      '',
      'Raw user task:',
      description,
    ].join('\n');
  }

  private parseModelPlan(taskId: string, raw: string): Plan | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[0]) as AgenticPlanPayload;
      const selectedSkill = this.normalizeSkillName(parsed.selected_skill);

      const steps = (parsed.steps ?? [])
        .map((step) => ({
          description: step.description?.trim() ?? '',
          requiresApproval:
            step.requiresApproval === true || step.requires_approval === true,
          skill: this.normalizeSkillName(step.skill) ?? selectedSkill,
        }))
        .filter((step) => step.description.length > 0)
        .slice(0, 8)
        .map((step, index): PlanStep => ({
          index,
          description: step.description,
          status: 'pending',
          requiresApproval: step.requiresApproval,
          skill: step.skill ?? undefined,
        }));

      if (steps.length === 0) return null;

      return {
        id: `plan-${Date.now()}`,
        taskId,
        laneId: this.currentTask?.laneId,
        steps,
        status: 'pending',
        currentStep: 0,
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  private normalizeTaskDescription(description: string): string {
    const trimmed = description.trim();
    if (!trimmed.includes('\n')) {
      return trimmed;
    }

    const parsed = this.parseIssueContext(trimmed);
    if (parsed.title || parsed.acceptanceCriteria.length > 0) {
      const lines: string[] = [];
      const title = parsed.issueKey && parsed.title
        ? `${parsed.issueKey}: ${parsed.title}`
        : parsed.title ?? parsed.issueKey ?? 'Work item';

      lines.push(`Plan and execute this work item: ${title}`);

      if (parsed.description) {
        lines.push(`Context: ${parsed.description}`);
      }

      const numberedSteps = [
        `Review the current implementation and locate the files or form logic affected by ${parsed.title ?? 'this work item'}.`,
        ...parsed.acceptanceCriteria,
        'Verify the final behavior, including validation and edge cases, before finishing.',
      ];

      numberedSteps.forEach((step, index) => {
        lines.push(`${index + 1}. ${step}`);
      });

      return lines.join('\n');
    }

    return this.stripChromeLines(trimmed);
  }

  private buildExecutionPrompt(plan: Plan, step: PlanStep): string {
    const taskDescription = this.currentTask?.description ?? '';
    const priorSteps = plan.steps
      .filter((candidate) => candidate.index < step.index)
      .map((candidate) => `- ${candidate.description}`)
      .join('\n');

    return [
      'You are executing one step inside the standalone FTM app.',
      `Selected skill context: ${step.skill ?? 'ftm-mind'}`,
      '',
      'Full user task:',
      taskDescription,
      '',
      'Current step:',
      step.description,
      '',
      ...(priorSteps ? ['Previously completed steps:', priorSteps, ''] : []),
      'Carry out the step in the spirit of the selected ftm skill.',
      'Be agentic and use tools as needed.',
    ].join('\n');
  }

  private buildSkillExecutionPrompt(skillName: string, plan: Plan, step: PlanStep): string {
    const skillBundle = this.loadSkillExecutionBundle(skillName);
    const approvalMode = this.router.getConfig().execution.approvalMode;

    return [
      `You are executing as ${skillName} inside the standalone FTM app.`,
      'Mirror the checked-in skill behavior as closely as possible.',
      'The standalone daemon/UI is only the host. The skill corpus is the authority.',
      `Current approval mode: ${approvalMode}`,
      `Plan step ${step.index + 1} of ${plan.steps.length}: ${step.description}`,
      '',
      'Skill corpus:',
      skillBundle,
    ].join('\n');
  }

  private normalizeSkillName(skillName?: string | null): string | null {
    if (!skillName) return null;
    const normalized = skillName.trim();
    if (!normalized) return null;
    return normalized.startsWith('ftm-') || normalized === 'ftm'
      ? normalized
      : `ftm-${normalized}`;
  }

  private loadPlanningSkillBundle(): string {
    const parts = [
      this.readRepoFile('ftm/SKILL.md'),
      this.readRepoFile('ftm-mind/SKILL.md'),
      this.readRepoFile('ftm-mind/references/orient-protocol.md'),
      this.readRepoFile('ftm-mind/references/decide-act-protocol.md'),
      this.readRepoFile('ftm-mind/references/complexity-sizing.md'),
      this.readRepoFile('ftm-mind/references/direct-execution.md'),
    ].filter(Boolean);

    return parts.join('\n\n');
  }

  private loadSkillExecutionBundle(skillName: string): string {
    const normalized = this.normalizeSkillName(skillName) ?? 'ftm-mind';
    const skillDir = normalized === 'ftm' ? 'ftm' : normalized;
    const skillDoc = this.readRepoFile(path.join(skillDir, 'SKILL.md'));

    if (normalized === 'ftm-mind') {
      return [
        skillDoc,
        this.readRepoFile('ftm-mind/references/orient-protocol.md'),
        this.readRepoFile('ftm-mind/references/decide-act-protocol.md'),
        this.readRepoFile('ftm-mind/references/direct-execution.md'),
      ].filter(Boolean).join('\n\n');
    }

    return skillDoc || this.readRepoFile('ftm-mind/SKILL.md');
  }

  private loadAvailableSkillNames(): string[] {
    try {
      const manifest = this.readRepoFile('ftm-manifest.json');
      if (!manifest) return ['ftm', 'ftm-mind'];
      const parsed = JSON.parse(manifest) as { skills?: Array<{ name?: string; enabled?: boolean }> };
      const names = (parsed.skills ?? [])
        .filter((skill) => skill.enabled !== false && typeof skill.name === 'string')
        .map((skill) => skill.name!.trim())
        .filter(Boolean);
      return names.length > 0 ? names : ['ftm', 'ftm-mind'];
    } catch {
      return ['ftm', 'ftm-mind'];
    }
  }

  private readRepoFile(relativePath: string): string {
    const absolutePath = path.resolve(process.cwd(), relativePath);
    if (!existsSync(absolutePath)) {
      return '';
    }

    try {
      return readFileSync(absolutePath, 'utf8');
    } catch {
      return '';
    }
  }

  private parseIssueContext(description: string): ParsedIssueContext {
    const lines = description
      .split('\n')
      .map((line) => line.replace(/\t/g, ' ').trim())
      .filter(Boolean);

    const cleaned = this.stripKnownUiChrome(lines);
    const issueIndex = cleaned.findIndex((line) => /^[A-Z][A-Z0-9]+-\d+$/.test(line));
    const issueKey = issueIndex >= 0 ? cleaned[issueIndex] : undefined;

    let title: string | undefined;
    if (issueIndex >= 0) {
      title = cleaned.slice(issueIndex + 1).find((line) => this.isLikelyIssueTitle(line));
    }

    const descriptionLines = this.collectSection(cleaned, 'Description');
    const acceptanceLines = this.collectSection(cleaned, 'Acceptance Criteria');
    const acceptanceCriteria = this.normalizeAcceptanceCriteria(acceptanceLines);

    return {
      issueKey,
      title,
      description: this.compactSection(descriptionLines),
      acceptanceCriteria,
    };
  }

  private stripChromeLines(description: string): string {
    const lines = description
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    return this.stripKnownUiChrome(lines).join('\n').trim();
  }

  private stripKnownUiChrome(lines: string[]): string[] {
    const chromeLines = new Set([
      'Skip to:',
      'Top Bar',
      'Main Content',
      'Sidebar',
      'Jira homepage',
      'Search',
      'Create',
      'Ask Rovo',
      'Recent',
      'Recommended',
      'Spaces',
      'General',
      'Test Plan',
      'Key details',
      'Subtasks',
      'Add subtask',
      'Linked work items',
      'Add linked work item',
      'Activity',
      'All',
      'Comments',
      'History',
      'Work log',
      'Approvals',
      'Add a comment…',
      'Status update...',
      'Thanks...',
      'Agree...',
      'To Do',
      'Improve Story',
      'Details',
      'Start date',
      'Due date',
      'Sprint',
      'Assignee',
      'Reporter',
      'Story Points',
      'Priority',
      'Labels',
      'GTS Team',
      'OKR',
      'Capacity',
      'Dependency',
      'Health Indicator',
      'Size',
      'Parent',
      'Development',
      'Automation',
      'Rule executions',
      'Configure',
      'Open Change Request Salesforce',
      'Netwrix Salesforce',
      'None',
      'Add option',
    ]);

    return lines.filter((line) => {
      if (chromeLines.has(line)) return false;
      if (/^\d+\+$/.test(line)) return false;
      if (/^Created\s/i.test(line)) return false;
      if (/^Updated\s/i.test(line)) return false;
      if (/^Pro tip:/i.test(line)) return false;
      if (/^press\s+[A-Z]\s+to comment$/i.test(line)) return false;
      if (/^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s*$/.test(line) && chromeLines.has(line)) return false;
      return true;
    });
  }

  private collectSection(lines: string[], sectionName: string): string[] {
    const start = lines.findIndex((line) => this.normalizeSectionHeading(line) === this.normalizeSectionHeading(sectionName));
    if (start < 0) return [];

    const collected: string[] = [];
    for (let index = start + 1; index < lines.length; index++) {
      const line = lines[index];
      if (this.isSectionBoundary(line)) {
        break;
      }
      collected.push(line);
    }

    return collected;
  }

  private isSectionBoundary(line: string): boolean {
    return [
      'Subtasks',
      'Acceptance Criteria',
      'Linked work items',
      'Activity',
      'Details',
      'Approvals',
      'Development',
      'Automation',
      'Configure',
      'Comments',
      'History',
      'Work log',
    ].some((section) => this.normalizeSectionHeading(line) === this.normalizeSectionHeading(section));
  }

  private normalizeSectionHeading(line: string): string {
    return line.replace(/[:\s]+$/g, '').trim().toLowerCase();
  }

  private normalizeAcceptanceCriteria(lines: string[]): string[] {
    const cleaned = lines
      .map((line) => line.replace(/^\[\s?[xX ]?\]\s*/, '').trim())
      .filter(Boolean);

    if (cleaned.length > 0) {
      return cleaned.map((line) => this.toImperativeStep(line));
    }

    return [];
  }

  private toImperativeStep(line: string): string {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized) return normalized;

    if (/^(form|internal app path|standard sso path|form validation)\b/i.test(normalized)) {
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private compactSection(lines: string[]): string | undefined {
    const cleaned = lines
      .filter((line) => !/^Description$/i.test(line))
      .map((line) => line.replace(/^[-•]\s+/, '').trim())
      .filter(Boolean);

    if (cleaned.length === 0) return undefined;
    return cleaned.join(' ');
  }

  private isLikelyIssueTitle(line: string): boolean {
    if (!line) return false;
    if (/^[A-Z][A-Z0-9]+-\d+$/.test(line)) return false;
    if (line.length < 12) return false;
    if (/^(Description|Acceptance Criteria|Subtasks|Activity|Details)$/i.test(line)) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // ACT
  // ---------------------------------------------------------------------------

  /**
   * Executes all plan steps in sequence.
   * Routes each step to the execution model, collects outputs, and aggregates
   * them into a single ModuleResult.
   */
  private async act(plan: Plan): Promise<ModuleResult> {
    plan.status = 'executing';
    const outputs: string[] = [];
    const workingDir = this.currentTask
      ? this.getTaskWorkingDir(this.currentTask)
      : process.cwd();

    for (const step of plan.steps) {
      this.eventBus.emitTyped('step_started', {
        planId: plan.id,
        stepIndex: step.index,
        description: step.description,
      });

      // Pause for approval when the step requires it
      if (step.requiresApproval) {
        this.eventBus.emitTyped('approval_requested', {
          planId: plan.id,
          stepIndex: step.index,
        });
        // In plan_first mode the top-level approval already covers the whole plan;
        // individual step approvals are for always_ask mode.  Both are handled by
        // external callers via the plan_approved event.
      }

      // Dispatch to the execution adapter
      const adapter = await this.router.route('execution');
      const sessionOpts = step.skill
        ? {
            workingDir,
            systemPrompt: this.buildSkillExecutionPrompt(step.skill, plan, step),
          }
        : { workingDir };
      const response = await this.runWithPersistentSession(
        adapter,
        this.buildExecutionPrompt(plan, step),
        sessionOpts,
      );

      step.status = 'completed';
      plan.currentStep = step.index + 1;
      outputs.push(response.text);

      this.eventBus.emitTyped('step_completed', {
        planId: plan.id,
        stepIndex: step.index,
        response: response.text.substring(0, 500),
      });
    }

    plan.status = 'completed';
    return {
      success: true,
      output: outputs.join('\n\n'),
    };
  }

  private isDirectReplyTask(description: string): boolean {
    const normalized = description.trim().toLowerCase();
    if (!normalized) return false;

    return [
      'hello',
      'hello machine',
      'hi',
      'hi machine',
      'hey',
      'hey machine',
      'good morning',
      'good afternoon',
      'good evening',
      'thanks',
      'thank you',
      'help',
      'what can you do',
      'who are you',
    ].includes(normalized);
  }

  private isQuickReplyTask(description: string): boolean {
    const normalized = description.trim().toLowerCase();
    if (!normalized || this.isDirectReplyTask(description)) return false;

    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (wordCount > 12) return false;

    const blockerSignals = [
      'write',
      'implement',
      'build',
      'create',
      'refactor',
      'fix',
      'debug',
      'run',
      'execute',
      'install',
      'deploy',
      'delete',
      'remove',
      'production',
      'file',
      'code',
      'function',
      'script',
    ];

    return !blockerSignals.some((signal) => normalized.includes(signal));
  }

  private completeDirectReply(task: Task): ModuleResult {
    this.setPhase('observe');
    const profile = synthesizeUserContext(this.blackboard.getUserProfileSnapshot()).profile;
    const result: ModuleResult = {
      success: true,
      output: this.buildDirectReply(task.description, profile.preferredName),
    };

    this.setPhase('complete');
    this.eventBus.emitTyped('task_completed', { taskId: task.id, result });
    return result;
  }

  private buildDirectReply(description: string, preferredName: string | null): string {
    const normalized = description.trim().toLowerCase();

    if (normalized.includes('thank')) {
      return "You're welcome.";
    }
    if (normalized === 'help' || normalized === 'what can you do') {
      return 'I can answer quick questions, plan work, and run longer coding tasks.';
    }
    if (normalized === 'who are you') {
      return 'I am Feed The Machine, your terminal-first helper.';
    }
    return `Hello ${preferredName ?? 'user'}.`;
  }

  private async completeQuickReply(task: Task): Promise<ModuleResult> {
    this.setPhase('observe');
    this.eventBus.emitTyped('memory_retrieved', { taskId: task.id });

    this.setPhase('orient');
    this.setPhase('act');

    const synthesized = synthesizeUserContext(this.blackboard.getUserProfileSnapshot());
    const profile = synthesized.profile;
    const outputFormats = profile.preferredOutputFormats.slice(0, 3).map((item) => item.label);

    const adapter = await this.router.route('execution');
    const response = await this.runWithPersistentSession(
      adapter,
      [
        'Reply directly to the user in one or two short sentences.',
        'Do not make a plan.',
        'Do not describe internal execution.',
        ...(profile.preferredName ? [`Address the user as ${profile.preferredName}.`] : []),
        `Prefer a ${profile.responseStyle} tone.`,
        ...(outputFormats.length > 0 ? [`Honor these output format preferences when they make sense: ${outputFormats.join(', ')}.`] : []),
        ...synthesized.promptContext.map((line) => `Profile context: ${line}`),
        `User message: ${task.description}`,
      ].join('\n'),
      { workingDir: this.getTaskWorkingDir(task) },
    );

    const result: ModuleResult = {
      success: true,
      output: response.text.trim() || 'Task completed.',
    };

    this.setPhase('complete');
    this.eventBus.emitTyped('task_completed', { taskId: task.id, result });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Classify task complexity by word count.
   */
  private classifyComplexity(
    description: string,
  ): 'micro' | 'small' | 'medium' | 'large' | 'xl' {
    const words = description.split(/\s+/).length;
    if (words < 10) return 'micro';
    if (words < 30) return 'small';
    if (words < 80) return 'medium';
    if (words < 200) return 'large';
    return 'xl';
  }

  /**
   * Evaluate guard rules against the task context and return a list of flag names
   * for any rule that fired.
   */
  private checkGuardRules(context: TaskContext): string[] {
    const flags: string[] = [];
    const desc = context.task.description.toLowerCase();

    if (desc.includes('delete') || desc.includes('remove') || desc.includes('drop') || desc.includes('rm -rf') || desc.includes('reset --hard')) {
      flags.push('destructive_operation');
    }
    if (desc.includes('production') || desc.includes('prod')) {
      flags.push('production_target');
    }
    if (desc.includes('force') || desc.includes('--force')) {
      flags.push('force_flag');
    }

    return flags;
  }

  /**
   * Returns a Promise that resolves when a plan_approved event is received for
   * the given plan.  The plan's status is set to 'approved' before resolving.
   */
  private waitForApproval(plan: Plan): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.hasApprovalEvent(plan.id)) {
        plan.status = 'approved';
        resolve();
        return;
      }

      const handler = (event: FtmEvent) => {
        if (event.data?.planId === plan.id) {
          plan.status = 'approved';
          this.eventBus.removeListener('plan_approved', handler);
          resolve();
        }
      };
      this.eventBus.on('plan_approved', handler);
    });
  }

  private hasApprovalEvent(planId: string): boolean {
    return this.eventBus.getEventLog().some(
      (event) => event.type === 'plan_approved' && event.data?.planId === planId,
    );
  }

  private async runWithPersistentSession(
    adapter: ModelAdapter,
    prompt: string,
    opts?: SessionOpts,
  ): Promise<NormalizedResponse> {
    const laneId = this.currentTask?.laneId;
    const workspaceId = this.currentTask?.workspaceId;

    const existingSession =
      laneId ? this.blackboard.getActiveModelSession(laneId, adapter.name) : null;

    const response = existingSession
      ? await adapter.resumeSession(existingSession.sessionId, prompt)
      : await adapter.startSession(prompt, opts);

    if (workspaceId && response.sessionId) {
      this.blackboard.saveModelSession({
        id: existingSession?.id,
        workspaceId,
        laneId,
        modelName: adapter.name,
        sessionId: response.sessionId,
        archived: false,
      });
    }

    return response;
  }

  /**
   * Transition to the given phase and broadcast an ooda_phase event.
   */
  private setPhase(phase: OodaPhase): void {
    this.phase = phase;
    this.eventBus.emit('ooda_phase', { phase, taskId: this.currentTask?.id });
  }

  // ---------------------------------------------------------------------------
  // State accessors
  // ---------------------------------------------------------------------------

  getPhase(): OodaPhase {
    return this.phase;
  }

  getCurrentTask(): Task | null {
    return this.currentTask;
  }

  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }
}
