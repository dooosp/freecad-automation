export function createHarness() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      passed += 1;
      console.log(`  PASS: ${message}`);
      return;
    }

    failed += 1;
    console.error(`  FAIL: ${message}`);
  }

  async function runCase(name, fn) {
    try {
      await fn();
    } catch (error) {
      failed += 1;
      console.error(`\nFATAL [${name}]: ${error.message}`);
      if (error.stack) console.error(error.stack);
    }
  }

  function getResults() {
    return { passed, failed };
  }

  return {
    assert,
    runCase,
    getResults,
  };
}
