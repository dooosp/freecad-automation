export async function inspectModel({
  runScript,
  filePath,
}) {
  return runScript('inspect_model.py', { file: filePath }, {
    timeout: 60_000,
  });
}
