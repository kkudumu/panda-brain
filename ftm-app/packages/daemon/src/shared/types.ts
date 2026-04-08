// Session
export type SessionStatus = 'active' | 'completed' | 'error';

export interface Session {
  id: string;
  startedAt: number;
  lastUpdated: number;
  status: SessionStatus;
}

// Playbook — reusable automation recipe triggered by keyword/pattern
export interface Playbook {
  id: string;
  name: string;
  trigger: string;
  steps: string[];
  lastUsed: number;
  useCount: number;
}

// Pattern — learned behavioral pattern with confidence score
export interface Pattern {
  id: string;
  category: string;
  pattern: Record<string, unknown>;
  confidence: number;
  updatedAt: number;
}

// Machine states
export type MachineState =
  | 'idle'
  | 'ingesting'
  | 'thinking'
  | 'executing'
  | 'approving'
  | 'complete'
  | 'error';

// Events
export interface FtmEvent {
  type: string;
  timestamp: number;
  sessionId: string;
  data: Record<string, unknown>;
}

export type FtmEventType =
  | 'task_submitted'
  | 'memory_retrieved'
  | 'playbook_matched'
  | 'plan_generated'
  | 'approval_requested'
  | 'plan_approved'
  | 'plan_modified'
  | 'step_started'
  | 'model_selected'
  | 'tool_invoked'
  | 'step_completed'
  | 'artifact_created'
  | 'guard_triggered'
  | 'loop_detected'
  | 'error'
  | 'task_completed'
  | 'memory_saved';

// Model adapters
export interface SessionOpts {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  workingDir?: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

export interface NormalizedResponse {
  text: string;
  toolCalls: ToolCall[];
  sessionId: string;
  tokenUsage: { input: number; output: number; cached: number };
  cost?: number;
}

export interface ModelAdapter {
  name: string;
  available(): Promise<boolean>;
  startSession(prompt: string, opts?: SessionOpts): Promise<NormalizedResponse>;
  resumeSession(sessionId: string, prompt: string): Promise<NormalizedResponse>;
  parseResponse(raw: string): NormalizedResponse;
}

// Tasks and plans
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  sessionId: string;
  result?: string;
  error?: string;
}

export interface PlanStep {
  index: number;
  description: string;
  status: TaskStatus;
  model?: string;
  requiresApproval?: boolean;
  files?: string[];
}

export interface Plan {
  id: string;
  taskId: string;
  steps: PlanStep[];
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed';
  currentStep: number;
  createdAt: number;
}

// Blackboard
export interface LearnedPattern {
  label: string;
  count: number;
  lastSeen: number;
}

export interface UserProfile {
  lastUpdated: number;
  preferredName: string | null;
  responseStyle: 'direct' | 'collaborative';
  preferredOutputFormats: LearnedPattern[];
  activeProjects: LearnedPattern[];
  approvalPreference: 'streamlined' | 'hands_on' | 'mixed';
  approvalHistory: {
    requestedCount: number;
    approvedCount: number;
    modifiedCount: number;
    autoApprovedCount: number;
  };
  commonTaskTypes: LearnedPattern[];
  workflowPatterns: LearnedPattern[];
  topicInterests: LearnedPattern[];
  modelPreferences: LearnedPattern[];
}

export interface BlackboardContext {
  currentTask: Task | null;
  recentDecisions: Array<{ decision: string; reason: string; timestamp: number }>;
  activeConstraints: string[];
  sessionMetadata: {
    startedAt: number;
    lastUpdated: number;
    skillsInvoked: string[];
  };
  userProfile: UserProfile;
}

export interface Experience {
  id: string;
  taskType: string;
  outcome: 'success' | 'failure' | 'partial';
  lessons: string[];
  tags: string[];
  timestamp: number;
}

// WebSocket API messages
export type WsMessageType =
  | 'submit_task'
  | 'approve_plan'
  | 'modify_plan'
  | 'cancel_task'
  | 'get_state'
  | 'get_history';

export interface WsMessage {
  type: WsMessageType;
  id: string;
  payload: Record<string, unknown>;
}

export interface WsResponse {
  type: string;
  id: string;
  success: boolean;
  payload: Record<string, unknown>;
  error?: string;
}

// Config
export interface FtmConfig {
  profile: string;
  profiles: Record<string, ModelProfile>;
  execution: {
    maxParallelAgents: number;
    autoAudit: boolean;
    progressTracking: boolean;
    approvalMode: 'auto' | 'plan_first' | 'always_ask';
  };
  daemon: {
    port: number;
    host: string;
  };
}

export interface ModelProfile {
  planning: string;
  execution: string;
  review: string;
}

// Module interface
export interface TaskContext {
  task: Task;
  plan?: Plan;
  blackboard: BlackboardContext;
  config: FtmConfig;
}

export interface ModuleResult {
  success: boolean;
  output?: string;
  artifacts?: Array<{ type: string; path: string; content?: string }>;
  error?: string;
}

export interface FtmModule {
  name: string;
  canHandle(task: TaskContext): boolean;
  execute(task: TaskContext, emit: (event: FtmEvent) => void): Promise<ModuleResult>;
}
