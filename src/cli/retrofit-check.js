import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

async function requireNewPath(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Output already exists: ${path}. Choose a new --out path.`);
}

async function publish(staged, destination) {
  try {
    await link(staged, destination);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output already exists: ${destination}. Choose a new --out path.`);
    throw error;
  }
}

export async function writeRetrofitReport(casePath, reportPath, runScript, candidateId) {
  await requireNewPath(reportPath);
  const directory = dirname(reportPath);
  const name = basename(reportPath, extname(reportPath));
  const stepPath = join(directory, `${name}.adapter.step`);
  if (candidateId !== undefined) await requireNewPath(stepPath);

  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp(join(directory, '.retrofit-check-'));
  const stagedStep = join(staging, 'adapter.step');
  let stepPublished = false;
  try {
    const input = { case_path: casePath };
    if (candidateId !== undefined) {
      input.adapter_candidate_id = candidateId;
      input.adapter_step_path = stagedStep;
    }
    const report = await runScript('retrofit_check.py', input);
    if (report?.success !== true || !Array.isArray(report.candidates)) {
      throw new Error('FreeCAD did not return a complete retrofit report');
    }
    if (candidateId !== undefined) {
      const candidate = report.candidates.find((item) => item.id === candidateId);
      if (candidate?.status !== 'adapter_candidate' || !candidate.adapter) {
        throw new Error('Only a measured adapter_candidate has a review STEP');
      }
      const bytes = await readFile(stagedStep);
      if (!bytes.length) throw new Error('FreeCAD exported an empty adapter STEP');
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== report.verified_step_sha256
          || !bytes.subarray(-128).toString('ascii').trimEnd().endsWith('END-ISO-10303-21;')) {
        throw new Error('Adapter STEP is incomplete or differs from the FreeCAD-verified export');
      }
      candidate.adapter.review_step = { file: basename(stepPath), sha256: digest };
      delete report.verified_step_sha256;
    }
    const stagedReport = join(staging, 'report.json');
    await writeFile(stagedReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (candidateId !== undefined) {
      await publish(stagedStep, stepPath);
      stepPublished = true;
    }
    // Readers use the report as the completion marker for the requested outputs.
    await publish(stagedReport, reportPath);
  } catch (error) {
    if (stepPublished) await rm(stepPath);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
