import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdtemp, open, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { runPythonJsonScript } from '../../../lib/context-loader.js';
import { getFreeCADRuntime } from '../../../lib/paths.js';

const MAX_SVG_BYTES = 16 * 1024 * 1024;
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameSnapshot = (left, right) => sameFile(left, right)
  && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
  && left.nlink === right.nlink;

async function readDetachedFile(path, maximum) {
  const initial = await lstat(path, { bigint: true });
  if (!initial.isFile() || initial.nlink !== 1n) throw new Error('Drawing PDF source and staging files must be regular files without hard links.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n || !sameSnapshot(initial, info)) throw new Error('Drawing PDF file changed before reading.');
    if (info.size < 1n || info.size > BigInt(maximum)) throw new Error('Drawing PDF file size is outside the supported limit.');
    // Read at most the permitted size even if another process grows the file.
    const bytes = Buffer.alloc(Number(info.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    const finalPath = await lstat(path, { bigint: true });
    if (BigInt(size) !== info.size || !sameSnapshot(info, after) || !sameSnapshot(info, finalPath) || !finalPath.isFile()) {
      throw new Error('Drawing PDF file changed while reading.');
    }
    return { bytes: bytes.subarray(0, size), info };
  } finally {
    await file.close();
  }
}

function validMeasurements(result) {
  return result?.success === true
    && Number.isFinite(result.physical_width_mm) && result.physical_width_mm > 0
    && Number.isFinite(result.physical_height_mm) && result.physical_height_mm > 0
    && result.page_box_tolerance_mm === 0.2;
}

/** Export a tracked drawing only; ordinary CLI drawing remains independent of Qt PDF support. */
export function createDrawingPdfService({
  runPythonJsonScriptFn = runPythonJsonScript,
  getFreeCADRuntimeFn = getFreeCADRuntime,
} = {}) {
  return async function exportDrawingPdf({ projectRoot, outputDir, drawingResult }) {
    const runtime = getFreeCADRuntimeFn();
    if (!runtime?.pythonExecutable) throw new Error('Print-scale drawing PDF requires FreeCAD Python with QtSvg support.');
    const svgPath = drawingResult?.drawing_paths?.find((entry) => entry?.format === 'svg')?.path
      || drawingResult?.svg_path || drawingResult?.drawing_path;
    if (drawingResult?.success !== true || typeof svgPath !== 'string' || extname(svgPath).toLowerCase() !== '.svg') {
      throw new Error('Print-scale drawing PDF requires a successfully generated SVG.');
    }
    const root = await realpath(outputDir);
    const rootInfo = await stat(root, { bigint: true });
    const source = await realpath(svgPath);
    if (!rootInfo.isDirectory() || dirname(source) !== root || (await lstat(svgPath)).isSymbolicLink()) {
      throw new Error('Drawing PDF source must be inside its tracked artifact directory.');
    }
    const snapshot = await readDetachedFile(source, MAX_SVG_BYTES);
    const svg = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes);
    const sourceHash = digest(snapshot.bytes);
    const target = join(root, basename(source).replace(/\.svg$/i, '.pdf'));
    // Stage beside the artifact directory so replacing that directory cannot strand partial files in it.
    const staging = await mkdtemp(join(dirname(root), '.drawing-pdf-'));
    const stagedPdf = join(staging, 'drawing.pdf');
    const assertUnchangedRoot = async () => {
      if (await realpath(outputDir) !== root || !sameFile(rootInfo, await stat(root, { bigint: true }))) {
        throw new Error('Drawing PDF artifact directory changed during export.');
      }
    };
    try {
      const result = await runPythonJsonScriptFn(projectRoot, 'scripts/drawing_pdf.py', {
        svg,
        output_path: typeof runtime.toRuntimePath === 'function' ? runtime.toRuntimePath(stagedPdf) : stagedPdf,
      }, { pythonCommand: runtime.pythonExecutable, timeout: 60_000 });
      if (!validMeasurements(result)) throw new Error('Drawing PDF renderer did not return valid physical page measurements.');
      const pdf = await readDetachedFile(stagedPdf, MAX_PDF_BYTES);
      if (!pdf.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !pdf.bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) {
        throw new Error('Drawing PDF renderer did not create a complete PDF.');
      }
      await assertUnchangedRoot();
      const currentSource = await readDetachedFile(source, MAX_SVG_BYTES);
      if (digest(currentSource.bytes) !== sourceHash) throw new Error('Drawing SVG changed during PDF export.');
      await assertUnchangedRoot();
      // A hard link publishes the closed, complete file atomically and refuses an existing destination.
      // Removing the private staging directory below leaves the final PDF with one link.
      await link(stagedPdf, target);
      return {
        path: target,
        physical_width_mm: result.physical_width_mm,
        physical_height_mm: result.physical_height_mm,
        page_box_tolerance_mm: result.page_box_tolerance_mm,
        source_svg_sha256: sourceHash,
      };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  };
}
