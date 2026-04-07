#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import type { WsMessage, WsResponse, MachineState } from '@ftm/daemon';

// Helper: connect to daemon
export async function connectToDaemon(port?: number): Promise<WebSocket> {
  const configuredPort = port ?? Number.parseInt(process.env.FTM_DAEMON_PORT ?? '4040', 10);
  const resolvedPort = Number.isFinite(configuredPort) && configuredPort > 0
    ? configuredPort
    : 4040;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${resolvedPort}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}

// Helper: send message and wait for response
export async function sendAndWait(
  ws: WebSocket,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<WsResponse> {
  return new Promise((resolve, reject) => {
    const id = `cli-${Date.now()}`;
    const handler = (data: WebSocket.Data) => {
      try {
        const msg: WsResponse = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off('message', handler);
          resolve(msg);
        }
      } catch {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type, id, payload }));
    setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('Request timeout'));
    }, 30000);
  });
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('ftm')
    .description('Feed The Machine — AI orchestrator CLI')
    .version('0.1.0');

  // ftm "task description" — submit a task
  program
    .argument('[description...]', 'Task description to submit')
    .action(async (descParts: string[]) => {
      if (descParts.length === 0) {
        program.help();
        return;
      }

      const description = descParts.join(' ');
      const spinner = ora('Connecting to daemon...').start();

      try {
        const ws = await connectToDaemon();
        spinner.text = 'Submitting task...';

        const response = await sendAndWait(ws, 'submit_task', { description });

        if (response.success) {
          spinner.succeed(chalk.green(`Task submitted: ${response.payload.taskId}`));

          // Stream events until task completes
          console.log(chalk.dim('Streaming progress...'));

          ws.on('message', (data) => {
            try {
              const msg: WsResponse = JSON.parse(data.toString());

              if (msg.type === 'machine_state') {
                const state = msg.payload.state as MachineState;
                const stateColors: Record<MachineState, (s: string) => string> = {
                  idle: chalk.dim,
                  ingesting: chalk.cyan,
                  thinking: chalk.yellow,
                  executing: chalk.green,
                  approving: chalk.magenta,
                  complete: chalk.green,
                  error: chalk.red,
                };
                const colorFn = stateColors[state] ?? chalk.white;
                console.log(colorFn(`  ◉ ${state}`));
              }

              if (msg.type === 'event') {
                const event = msg.payload.event as any;
                const eventType = event.type === '*' ? event.data?._eventType : event.type;

                if (eventType === 'step_started') {
                  console.log(chalk.cyan(`  → Step ${event.data.stepIndex}: ${event.data.description}`));
                }
                if (eventType === 'step_completed') {
                  console.log(chalk.green(`  ✓ Step ${event.data.stepIndex} complete`));
                }
                if (eventType === 'task_completed') {
                  console.log(chalk.green.bold('\n✓ Task completed'));
                  ws.close();
                  process.exit(0);
                }
                if (eventType === 'error') {
                  console.error(chalk.red(`  ✗ Error: ${event.data.error}`));
                }
                if (eventType === 'guard_triggered') {
                  console.log(chalk.yellow(`  ⚠ Guard: ${JSON.stringify(event.data)}`));
                }
                if (eventType === 'approval_requested') {
                  console.log(chalk.magenta('  ⏳ Approval required — use `ftm approve` to continue'));
                }
              }
            } catch {}
          });
        } else {
          spinner.fail(chalk.red(`Failed: ${response.error}`));
          ws.close();
        }
      } catch {
        spinner.fail(chalk.red('Cannot connect to daemon. Is it running?'));
        console.log(chalk.dim('  Start daemon: ftm daemon'));
        process.exit(1);
      }
    });

  // ftm status — show current machine state
  program
    .command('status')
    .description('Show current daemon state')
    .action(async () => {
      try {
        const ws = await connectToDaemon();
        const response = await sendAndWait(ws, 'get_state');

        if (response.success) {
          const state = response.payload;
          const machineState = state.machineState as MachineState;

          const stateEmoji: Record<MachineState, string> = {
            idle: '○',
            ingesting: '◐',
            thinking: '◑',
            executing: '●',
            approving: '◎',
            complete: '◉',
            error: '✗',
          };

          console.log(chalk.bold('FTM Daemon Status'));
          console.log(`  Machine: ${stateEmoji[machineState]} ${machineState}`);
          console.log(`  Phase:   ${state.phase}`);
          console.log(`  Clients: ${state.connectedClients}`);

          if (state.currentTask) {
            const task = state.currentTask as any;
            console.log(`  Task:    ${task.description}`);
          }

          if (state.currentPlan) {
            const plan = state.currentPlan as any;
            console.log(`  Plan:    Step ${plan.currentStep}/${plan.steps?.length ?? '?'}`);
          }
        }

        ws.close();
      } catch {
        console.log(chalk.red('Daemon not running'));
        process.exit(1);
      }
    });

  // ftm history — show recent tasks
  program
    .command('history')
    .description('Show recent tasks')
    .option('-n, --limit <number>', 'Number of tasks to show', '10')
    .action(async (opts) => {
      try {
        const ws = await connectToDaemon();
        const response = await sendAndWait(ws, 'get_history', { limit: parseInt(opts.limit) });

        if (response.success) {
          const tasks = (response.payload.tasks as any[]) ?? [];

          if (tasks.length === 0) {
            console.log(chalk.dim('No tasks yet.'));
          } else {
            console.log(chalk.bold('Recent Tasks'));
            for (const task of tasks) {
              const statusColor = task.status === 'completed' ? chalk.green
                : task.status === 'failed' ? chalk.red
                : task.status === 'in_progress' ? chalk.yellow
                : chalk.dim;

              const time = new Date(task.createdAt).toLocaleString();
              console.log(`  ${statusColor(task.status.padEnd(12))} ${task.description.substring(0, 60)} ${chalk.dim(time)}`);
            }
          }
        }

        ws.close();
      } catch {
        console.log(chalk.red('Daemon not running'));
        process.exit(1);
      }
    });

  // ftm approve — approve pending plan
  program
    .command('approve')
    .description('Approve the currently pending plan')
    .action(async () => {
      try {
        const ws = await connectToDaemon();
        const stateResponse = await sendAndWait(ws, 'get_state');

        const plan = stateResponse.payload.currentPlan as any;
        if (!plan) {
          console.log(chalk.dim('No pending plan to approve.'));
          ws.close();
          return;
        }

        if (plan.status !== 'pending') {
          console.log(chalk.dim(`Plan status is "${plan.status}", not pending.`));
          ws.close();
          return;
        }

        const response = await sendAndWait(ws, 'approve_plan', { planId: plan.id });

        if (response.success) {
          console.log(chalk.green('Plan approved. Execution starting...'));
        } else {
          console.log(chalk.red(`Failed: ${response.error}`));
        }

        ws.close();
      } catch {
        console.log(chalk.red('Daemon not running'));
        process.exit(1);
      }
    });

  // ftm doctor — health check
  program
    .command('doctor')
    .description('Check system health: daemon, adapters, blackboard')
    .action(async () => {
      console.log(chalk.bold('FTM Doctor\n'));

      // Check daemon
      const daemonSpinner = ora('Checking daemon...').start();
      try {
        const ws = await connectToDaemon();
        daemonSpinner.succeed('Daemon running');
        ws.close();
      } catch {
        daemonSpinner.fail('Daemon not running');
      }

      // Check CLI availability
      const clis = ['claude', 'codex', 'gemini'];
      for (const cli of clis) {
        const cliSpinner = ora(`Checking ${cli}...`).start();
        try {
          const { execSync } = await import('child_process');
          execSync(`which ${cli}`, { stdio: 'pipe' });
          cliSpinner.succeed(`${cli} found`);
        } catch {
          cliSpinner.warn(`${cli} not found in PATH`);
        }
      }

      // Check Ollama
      const ollamaSpinner = ora('Checking Ollama...').start();
      try {
        const res = await fetch('http://localhost:11434/api/tags');
        if (res.ok) {
          ollamaSpinner.succeed('Ollama running');
        } else {
          ollamaSpinner.warn('Ollama not responding');
        }
      } catch {
        ollamaSpinner.warn('Ollama not running');
      }

      // Check data directory
      const { existsSync } = await import('fs');
      const { getDataDir, getDbPath } = await import('@ftm/daemon/config');

      const dataSpinner = ora('Checking data directory...').start();
      if (existsSync(getDataDir())) {
        dataSpinner.succeed(`Data dir: ${getDataDir()}`);
      } else {
        dataSpinner.warn(`Data dir missing: ${getDataDir()}`);
      }

      const dbSpinner = ora('Checking database...').start();
      if (existsSync(getDbPath())) {
        dbSpinner.succeed(`Database: ${getDbPath()}`);
      } else {
        dbSpinner.info(`Database will be created on first run: ${getDbPath()}`);
      }
    });

  // ftm onboard — first-run setup
  program
    .command('onboard')
    .description('Guided first-run setup')
    .action(async () => {
      console.log(chalk.bold.green('\nWelcome to Feed The Machine!\n'));
      console.log('Let me check your setup...\n');

      // Run doctor checks
      const { execSync } = await import('child_process');
      const { existsSync, mkdirSync, writeFileSync } = await import('fs');
      const { getConfigPath, ensureDataDir } = await import('@ftm/daemon/config');

      // Ensure data directory
      ensureDataDir();
      console.log(chalk.green('✓ Data directory ready'));

      // Check for config
      if (!existsSync(getConfigPath())) {
        const defaultConfig = [
          'profile: balanced',
          '',
          'profiles:',
          '  balanced:',
          '    planning: claude',
          '    execution: codex',
          '    review: gemini',
          '',
          'daemon:',
          '  port: 4040',
          '  host: localhost',
        ].join('\n');

        const configDir = getConfigPath().replace(/\/[^/]+$/, '');
        if (!existsSync(configDir)) {
          mkdirSync(configDir, { recursive: true });
        }
        writeFileSync(getConfigPath(), defaultConfig, 'utf-8');
        console.log(chalk.green(`✓ Config created: ${getConfigPath()}`));
      } else {
        console.log(chalk.green(`✓ Config exists: ${getConfigPath()}`));
      }

      // Detect available CLIs
      const available: string[] = [];
      for (const cli of ['claude', 'codex', 'gemini']) {
        try {
          execSync(`which ${cli}`, { stdio: 'pipe' });
          available.push(cli);
          console.log(chalk.green(`✓ ${cli} detected`));
        } catch {
          console.log(chalk.dim(`○ ${cli} not installed`));
        }
      }

      // Check Ollama
      try {
        const res = await fetch('http://localhost:11434/api/tags');
        if (res.ok) {
          available.push('ollama');
          console.log(chalk.green('✓ Ollama detected'));
        }
      } catch {
        console.log(chalk.dim('○ Ollama not running'));
      }

      if (available.length === 0) {
        console.log(chalk.yellow('\n⚠ No AI backends detected.'));
        console.log('Install at least one: claude, codex, gemini, or ollama');
      } else {
        console.log(chalk.green(`\n✓ ${available.length} backend(s) available: ${available.join(', ')}`));
      }

      console.log(chalk.bold('\nSetup complete! Start the daemon:'));
      console.log(chalk.cyan('  ftm daemon\n'));
      console.log('Or submit a task directly:');
      console.log(chalk.cyan('  ftm "analyze this codebase"\n'));
    });

  // ftm daemon — start the daemon (foreground)
  program
    .command('daemon')
    .description('Start the FTM daemon in the foreground')
    .option('-p, --port <number>', 'Port to listen on', '4040')
    .action(async () => {
      console.log(chalk.bold.green('Starting FTM Daemon...\n'));

      try {
        const { startDaemon } = await import('@ftm/daemon');
        await startDaemon();

        // Keep process running
        process.on('SIGINT', () => {
          console.log(chalk.dim('\nShutting down...'));
          process.exit(0);
        });
      } catch (err) {
        console.error(chalk.red('Failed to start daemon:'), err);
        process.exit(1);
      }
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}

const isMain = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;

  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(argv1);
  } catch {
    return false;
  }
})();

if (isMain) {
  await runCli();
}
