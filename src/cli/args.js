export function parseCliArgs(rawArgs = []) {
  const positional = [];
  const options = {};

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    if (withoutPrefix.includes('=')) {
      const [key, value] = withoutPrefix.split(/=(.*)/s, 2);
      options[key] = value;
      continue;
    }

    const nextArg = rawArgs[i + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      options[withoutPrefix] = nextArg;
      i += 1;
    } else {
      options[withoutPrefix] = true;
    }
  }

  return { positional, options };
}
