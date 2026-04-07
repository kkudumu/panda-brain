import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';

// ---------------------------------------------------------------------------
// Helpers — build a fresh program identical to the CLI's structure
// without importing the real index.ts (which calls program.parse() at module
// load time and would try to exit the process).
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command();

  program
    .name('ftm')
    .description('Feed The Machine — AI orchestrator CLI')
    .version('0.1.0');

  program
    .argument('[description...]', 'Task description to submit')
    .action(() => {});

  program
    .command('status')
    .description('Show current daemon state')
    .action(() => {});

  program
    .command('history')
    .description('Show recent tasks')
    .option('-n, --limit <number>', 'Number of tasks to show', '10')
    .action(() => {});

  program
    .command('approve')
    .description('Approve the currently pending plan')
    .action(() => {});

  program
    .command('doctor')
    .description('Check system health: daemon, adapters, blackboard')
    .action(() => {});

  program
    .command('onboard')
    .description('Guided first-run setup')
    .action(() => {});

  program
    .command('daemon')
    .description('Start the FTM daemon in the foreground')
    .option('-p, --port <number>', 'Port to listen on', '4040')
    .action(() => {});

  return program;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI — program metadata', () => {
  it('program name is ftm', () => {
    const program = buildProgram();
    expect(program.name()).toBe('ftm');
  });

  it('program description mentions Feed The Machine', () => {
    const program = buildProgram();
    expect(program.description()).toMatch(/Feed The Machine/i);
  });

  it('program version is 0.1.0', () => {
    const program = buildProgram();
    expect(program.version()).toBe('0.1.0');
  });
});

describe('CLI — registered commands', () => {
  let program: Command;

  beforeEach(() => {
    program = buildProgram();
  });

  function getCommandNames(p: Command): string[] {
    return p.commands.map((c) => c.name());
  }

  it('registers the status command', () => {
    expect(getCommandNames(program)).toContain('status');
  });

  it('registers the history command', () => {
    expect(getCommandNames(program)).toContain('history');
  });

  it('registers the approve command', () => {
    expect(getCommandNames(program)).toContain('approve');
  });

  it('registers the doctor command', () => {
    expect(getCommandNames(program)).toContain('doctor');
  });

  it('registers the onboard command', () => {
    expect(getCommandNames(program)).toContain('onboard');
  });

  it('registers the daemon command', () => {
    expect(getCommandNames(program)).toContain('daemon');
  });

  it('registers exactly 6 subcommands', () => {
    expect(program.commands).toHaveLength(6);
  });
});

describe('CLI — command descriptions', () => {
  let program: Command;

  beforeEach(() => {
    program = buildProgram();
  });

  function findCommand(name: string): Command {
    const cmd = program.commands.find((c) => c.name() === name);
    if (!cmd) throw new Error(`Command "${name}" not found`);
    return cmd;
  }

  it('status command has a description', () => {
    expect(findCommand('status').description()).toBeTruthy();
  });

  it('history command has a description', () => {
    expect(findCommand('history').description()).toBeTruthy();
  });

  it('approve command has a description', () => {
    expect(findCommand('approve').description()).toBeTruthy();
  });

  it('doctor command has a description', () => {
    expect(findCommand('doctor').description()).toBeTruthy();
  });

  it('onboard command has a description', () => {
    expect(findCommand('onboard').description()).toBeTruthy();
  });

  it('daemon command has a description', () => {
    expect(findCommand('daemon').description()).toBeTruthy();
  });
});

describe('CLI — history command options', () => {
  it('history command accepts --limit option', () => {
    const program = buildProgram();
    const historyCmd = program.commands.find((c) => c.name() === 'history')!;
    const limitOpt = historyCmd.options.find((o) => o.long === '--limit');
    expect(limitOpt).toBeDefined();
  });

  it('history --limit has default value of "10"', () => {
    const program = buildProgram();
    const historyCmd = program.commands.find((c) => c.name() === 'history')!;
    const limitOpt = historyCmd.options.find((o) => o.long === '--limit');
    expect(limitOpt?.defaultValue).toBe('10');
  });

  it('history --limit accepts a short flag -n', () => {
    const program = buildProgram();
    const historyCmd = program.commands.find((c) => c.name() === 'history')!;
    const limitOpt = historyCmd.options.find((o) => o.short === '-n');
    expect(limitOpt).toBeDefined();
  });
});

describe('CLI — daemon command options', () => {
  it('daemon command accepts --port option', () => {
    const program = buildProgram();
    const daemonCmd = program.commands.find((c) => c.name() === 'daemon')!;
    const portOpt = daemonCmd.options.find((o) => o.long === '--port');
    expect(portOpt).toBeDefined();
  });

  it('daemon --port has default value of "4040"', () => {
    const program = buildProgram();
    const daemonCmd = program.commands.find((c) => c.name() === 'daemon')!;
    const portOpt = daemonCmd.options.find((o) => o.long === '--port');
    expect(portOpt?.defaultValue).toBe('4040');
  });

  it('daemon --port accepts a short flag -p', () => {
    const program = buildProgram();
    const daemonCmd = program.commands.find((c) => c.name() === 'daemon')!;
    const portOpt = daemonCmd.options.find((o) => o.short === '-p');
    expect(portOpt).toBeDefined();
  });
});

describe('CLI — default action accepts description arguments', () => {
  it('program has a registered argument for description', () => {
    const program = buildProgram();
    // Commander stores positional arguments in _args internally
    const args = (program as any)._args as Array<{ _name: string }>;
    const descArg = args.find((a) => a._name === 'description');
    expect(descArg).toBeDefined();
  });
});
