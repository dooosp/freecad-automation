import { parseCliArgs } from './args.js';

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
  renderCommandUsage,
  printRuntimeDiagnostics,
  commands = {},
} = {}) {
  const [command, ...args] = argv;

  if (!command || command === 'help' || command === '--help') {
    console.log(usage);
    process.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    const commandUsage = renderCommandUsage(command);
    if (commandUsage) {
      console.log(commandUsage);
      process.exit(0);
    }
  }

  if (command === 'check-runtime') {
    const { positional, options } = parseCliArgs(args);
    if (positional.length > 0) {
      console.error('Error: check-runtime does not accept positional arguments');
      process.exit(1);
    }
    process.exit(printRuntimeDiagnostics({
      format: options.json ? 'json' : 'text',
      redactPaths: Boolean(options['redact-paths']),
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
