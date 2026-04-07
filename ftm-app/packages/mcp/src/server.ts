import { FtmStore } from '@ftm/daemon/store';
import { Blackboard } from '@ftm/daemon/blackboard';
import type { BlackboardContext, Experience, Task } from '@ftm/daemon';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export class FtmMcpServer {
  private store: FtmStore;
  private blackboard: Blackboard;
  private tools: Map<string, McpToolDefinition> = new Map();

  constructor(dbPath: string) {
    this.store = new FtmStore(dbPath);
    this.blackboard = new Blackboard(this.store);
    this.registerTools();
  }

  private registerTools(): void {
    // Tool: ftm_get_blackboard
    // Returns current blackboard context (current task, recent decisions, constraints, session metadata)
    this.registerTool({
      name: 'ftm_get_blackboard',
      description: 'Get the current FTM blackboard context including current task, recent decisions, active constraints, and session metadata.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => {
        const context = this.blackboard.getContext();
        return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
      },
    });

    // Tool: ftm_check_playbook
    // Checks if a playbook matches the given trigger
    this.registerTool({
      name: 'ftm_check_playbook',
      description: 'Check if an FTM playbook matches the given trigger text. Returns the playbook steps if found.',
      inputSchema: {
        type: 'object',
        properties: {
          trigger: { type: 'string', description: 'The trigger text to match against playbooks' },
        },
        required: ['trigger'],
      },
      handler: async (args) => {
        const playbook = this.blackboard.checkPlaybook(args.trigger as string);
        if (playbook) {
          return { content: [{ type: 'text', text: JSON.stringify(playbook, null, 2) }] };
        }
        return { content: [{ type: 'text', text: 'No matching playbook found.' }] };
      },
    });

    // Tool: ftm_guard_check
    // Runs guard rules against a task description
    this.registerTool({
      name: 'ftm_guard_check',
      description: 'Run FTM guard safety checks against a task description. Returns any warnings or blocks.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'The task description to check' },
        },
        required: ['description'],
      },
      handler: async (args) => {
        const desc = (args.description as string).toLowerCase();
        const checks: Array<{ rule: string; severity: string; message: string }> = [];

        const destructivePatterns = ['rm -rf', 'drop table', 'delete from', 'git push --force', 'git reset --hard'];
        for (const pattern of destructivePatterns) {
          if (desc.includes(pattern)) {
            checks.push({ rule: 'destructive_operation', severity: 'block', message: `Destructive operation detected: "${pattern}"` });
          }
        }

        if (desc.includes('production') || desc.includes(' prod ')) {
          checks.push({ rule: 'production_target', severity: 'warning', message: 'Task targets production systems' });
        }

        return {
          content: [{
            type: 'text',
            text: checks.length > 0
              ? JSON.stringify({ passed: checks.every(c => c.severity !== 'block'), checks }, null, 2)
              : JSON.stringify({ passed: true, checks: [] }),
          }],
        };
      },
    });

    // Tool: ftm_log_daily
    // Logs an entry to the daily log
    this.registerTool({
      name: 'ftm_log_daily',
      description: 'Log an entry to the FTM daily log. Use this to record what was accomplished, decisions made, or issues encountered.',
      inputSchema: {
        type: 'object',
        properties: {
          entry: { type: 'string', description: 'The log entry text' },
          type: { type: 'string', description: 'Entry type: task, decision, issue, note', enum: ['task', 'decision', 'issue', 'note'] },
        },
        required: ['entry'],
      },
      handler: async (args) => {
        this.store.logEvent({
          type: 'daily_log',
          timestamp: Date.now(),
          sessionId: 'mcp',
          data: { entry: args.entry, entryType: args.type ?? 'note' },
        });
        return { content: [{ type: 'text', text: 'Logged.' }] };
      },
    });

    // Tool: ftm_get_tasks
    // Returns recent tasks from the store
    this.registerTool({
      name: 'ftm_get_tasks',
      description: 'Get recent FTM tasks. Returns task history with status and results.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of tasks to return (default 10)' },
        },
        required: [],
      },
      handler: async (args) => {
        const limit = (args.limit as number) ?? 10;
        const tasks = this.store.getRecentTasks(limit);
        return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
      },
    });

    // Tool: ftm_write_experience
    // Writes an experience to the blackboard
    this.registerTool({
      name: 'ftm_write_experience',
      description: 'Record a learning experience in the FTM blackboard. Use this to capture what worked, what failed, and why.',
      inputSchema: {
        type: 'object',
        properties: {
          taskType: { type: 'string', description: 'Category of the task (e.g., "debugging", "refactoring", "sso-setup")' },
          outcome: { type: 'string', description: 'Outcome: success, failure, or partial', enum: ['success', 'failure', 'partial'] },
          lessons: { type: 'array', items: { type: 'string' }, description: 'List of lessons learned' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for matching future experiences' },
        },
        required: ['taskType', 'outcome', 'lessons'],
      },
      handler: async (args) => {
        this.blackboard.writeExperience({
          taskType: args.taskType as string,
          outcome: args.outcome as 'success' | 'failure' | 'partial',
          lessons: args.lessons as string[],
          tags: (args.tags as string[]) ?? [],
        });
        return { content: [{ type: 'text', text: 'Experience recorded.' }] };
      },
    });

    // Tool: ftm_add_decision
    // Adds a decision to the blackboard
    this.registerTool({
      name: 'ftm_add_decision',
      description: 'Record a decision in the FTM blackboard. Use this to track important decisions and their rationale.',
      inputSchema: {
        type: 'object',
        properties: {
          decision: { type: 'string', description: 'What was decided' },
          reason: { type: 'string', description: 'Why this decision was made' },
        },
        required: ['decision', 'reason'],
      },
      handler: async (args) => {
        this.blackboard.addDecision(args.decision as string, args.reason as string);
        return { content: [{ type: 'text', text: 'Decision recorded.' }] };
      },
    });
  }

  private registerTool(tool: McpToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  // Get all tool definitions (for MCP server registration)
  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  // Handle a tool call
  async handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    try {
      return await tool.handler(args);
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }

  // Close the store
  close(): void {
    this.store.close();
  }
}
