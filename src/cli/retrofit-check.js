import { link, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function writeRetrofitReport(casePath, reportPath, runScript) {
  const exists = await lstat(reportPath).then(() => true, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  if (exists) throw new Error(`Report already exists: ${reportPath}. Choose a new --out path.`);

  const report = await runScript('retrofit_check.py', { case_path: casePath });
  if (report?.success !== true || !Array.isArray(report.candidates)) {
    throw new Error('FreeCAD did not return a complete retrofit report');
  }

  const directory = dirname(reportPath);
  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp(join(directory, '.retrofit-check-'));
  try {
    const staged = join(staging, 'report.json');
    await writeFile(staged, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    // Publish only a complete report and let the filesystem reject concurrent reuse of the path.
    await link(staged, reportPath);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Report already exists: ${reportPath}. Choose a new --out path.`);
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
