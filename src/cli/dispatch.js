import { parseCheckRuntimeOptions } from './check-runtime-options.js';

export const BUILT_IN_CLI_COMMANDS = Object.freeze(['check-runtime', 'help']);

export function listDispatchableCliCommandNames(commands = {}) {
  return Object.freeze([
    ...BUILT_IN_CLI_COMMANDS,
    ...Object.keys(commands),
  ]);
}

export async function dispatchCliCommand({
  argv = process.argv.slice(2),
  usage,
  allUsage = usage,
  renderCommandUsage,
  printRuntimeDiagnostics,
  commands = {},
  projectRoot = process.cwd(),
} = {}) {
  const [command, ...args] = argv;

  if (!command || command === '--help') {
    console.log(usage);
    process.exit(0);
  }

  if (command === 'help') {
    if (args.length === 0) {
      console.log(usage);
      process.exit(0);
    }
    if (args.length === 1 && args[0] === '--all') {
      console.log(allUsage);
      process.exit(0);
    }
    if (args.length === 1) {
      const commandUsage = renderCommandUsage(args[0]);
      if (commandUsage) {
        console.log(commandUsage);
        process.exit(0);
      }
    }
    console.error(`Unknown help target: ${args.join(' ')}`);
    console.log('Use `fcad help --all` to list every command.');
    process.exit(1);
  }

  if (args.includes('--help') || args.includes('-h')) {
    const commandUsage = renderCommandUsage(command);
    if (commandUsage) {
      console.log(commandUsage);
      process.exit(0);
    }
  }

  if (command === 'check-runtime') {
    const parsed = parseCheckRuntimeOptions(args, { projectRoot });
    if (parsed.positional.length > 0) {
      console.error('Error: check-runtime does not accept positional arguments');
      process.exit(1);
    }
    process.exit(printRuntimeDiagnostics({
      format: parsed.useJson ? 'json' : 'text',
      redactPaths: parsed.redactPaths,
      fingerprintOut: parsed.fingerprintOut,
      projectRoot,
    }));
  }

  if (Object.hasOwn(commands, command)) {
    await commands[command](args);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.log(usage);
  process.exit(1);
}
