const HELP_SECTION_ORDER = Object.freeze([
  Object.freeze({ key: 'diagnostics', title: 'Diagnostics' }),
  Object.freeze({ key: 'freecad-backed', title: 'FreeCAD-backed commands' }),
  Object.freeze({ key: 'plain-python-node', title: 'Plain-Python / non-FreeCAD commands' }),
  Object.freeze({ key: 'mixed-conditional', title: 'Mixed / conditional commands' }),
]);

const COMMAND_MANIFEST = Object.freeze([
  Object.freeze({
    name: 'check-runtime',
    helpSection: 'diagnostics',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad check-runtime [--json]',
        summary: 'Show searched paths, selected runtime, detected versions, command coverage, and remediation',
      }),
    ]),
    runtime: Object.freeze({
      classification: 'diagnostics',
      requiresFreecadRuntime: false,
      note: 'Reports runtime discovery, selected executables, and command coverage without launching FreeCAD workflows.',
    }),
  }),
  Object.freeze({
    name: 'create',
    helpSection: 'freecad-backed',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad create <config.toml|json>',
        summary: 'Generate parametric model output',
      }),
    ]),
    runtime: Object.freeze({
      classification: 'freecad-backed',
      requiresFreecadRuntime: true,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: true,
      studioSubmission: 'config',
    }),
  }),
  Object.freeze({
    name: 'draw',
    helpSection: 'freecad-backed',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad draw <config.toml|json>',
        summary: 'Generate TechDraw SVG output',
      }),
    ]),
    runtime: Object.freeze({
      classification: 'freecad-backed',
      requiresFreecadRuntime: true,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: true,
      studioSubmission: 'config',
    }),
  }),
  Object.freeze({
    name: 'inspect',
    helpSection: 'freecad-backed',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad inspect <model.step|fcstd> [--manifest-out <path>]',
        summary: 'Inspect model metadata',
      }),
    ]),
    runtime: Object.freeze({
      classification: 'freecad-backed',
      requiresFreecadRuntime: true,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: true,
      studioSubmission: 'artifact',
    }),
  }),
  Object.freeze({
    name: 'fem',
    helpSection: 'freecad-backed',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad fem <config.toml|json> [--manifest-out <path>]',
        summary: 'Run FEM structural analysis',
      }),
    ]),
    runtime: Object.freeze({
      classification: 'freecad-backed',
      requiresFreecadRuntime: true,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'tolerance',
    helpSection: 'freecad-backed',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad tolerance <config.toml> [--manifest-out <path>]',
        summary: 'Tolerance analysis for assembly configs',
      }),
    ]),
    runtime: Object.freeze({
      classification: 'freecad-backed',
      requiresFreecadRuntime: true,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'report',
    helpSection: 'freecad-backed',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad report <config.toml>',
        summary: 'Generate engineering PDF report',
      }),
    ]),
    runtime: Object.freeze({
      classification: 'freecad-backed',
      requiresFreecadRuntime: true,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: true,
      studioSubmission: 'config-or-artifact',
    }),
  }),
  Object.freeze({
    name: 'dfm',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad dfm <config.toml|json> [--manifest-out <path>]',
        summary: 'Run DFM manufacturability analysis',
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'review',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad review <config.toml|json>', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'process-plan',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad process-plan <config.toml|json> [--review-pack <review_pack.json>]',
        summary: null,
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'line-plan',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad line-plan <config.toml|json>', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'quality-risk',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad quality-risk <config.toml|json> [--review-pack <review_pack.json>]',
        summary: null,
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'investment-review',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad investment-review <config.toml|json>', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'readiness-pack',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad readiness-pack --review-pack <review_pack.json> [--out <readiness_report.json>] [--process-plan <process_plan.json>] [--quality-risk <quality_risk.json>]',
        summary: null,
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: true,
      studioSubmission: 'artifact',
    }),
  }),
  Object.freeze({
    name: 'readiness-report',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad readiness-report --review-pack <review_pack.json> [--out <readiness_report.json>] [--process-plan <process_plan.json>] [--quality-risk <quality_risk.json>]',
        summary: null,
      }),
      Object.freeze({
        usage: 'fcad readiness-report <config.toml|json> [--out <readiness_report.json>]',
        summary: 'legacy compatibility / non-canonical',
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'pack',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad pack --readiness <readiness_report.json> [--docs-manifest <standard_docs_manifest.json>] --out <release_bundle.zip>',
        summary: null,
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: true,
      studioSubmission: 'artifact',
    }),
  }),
  Object.freeze({
    name: 'stabilization-review',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad stabilization-review <config.toml|json> --runtime <runtime.json>',
        summary: null,
      }),
      Object.freeze({
        usage: 'fcad stabilization-review <baseline_readiness_report.json> <candidate_readiness_report.json>',
        summary: null,
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: true,
      studioSubmission: 'artifact-pair',
    }),
  }),
  Object.freeze({
    name: 'generate-standard-docs',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad generate-standard-docs <config.toml|json> --readiness-report <readiness_report.json> [--out-dir <dir>]',
        summary: null,
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: true,
      studioSubmission: 'artifact',
    }),
  }),
  Object.freeze({
    name: 'ingest',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad ingest --model <file> [--bom bom.csv] [--inspection insp.csv] [--quality ncr.csv] --out <context.json>',
        summary: null,
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'quality-link',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad quality-link --context <context.json> --geometry <geometry.json>', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'review-pack',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad review-pack --context <context.json> --geometry <geometry.json>', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'review-context',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({
        usage: 'fcad review-context --model <file> [--bom bom.csv] [--inspection insp.csv] [--quality ncr.csv] --out <review_pack.json> [--compare-to baseline_review_pack.json]',
        summary: null,
      }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: false,
      studioSubmission: 'context-or-model',
    }),
  }),
  Object.freeze({
    name: 'compare-rev',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad compare-rev <baseline.json> <candidate.json>', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
    surfaces: Object.freeze({
      jobExecutor: true,
      localApi: true,
      studio: true,
      studioSubmission: 'artifact-pair',
    }),
  }),
  Object.freeze({
    name: 'validate',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad validate <plan.toml|json>', summary: 'Validate drawing_plan artifacts' }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'validate-config',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad validate-config <config.toml|json>', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'migrate-config',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad migrate-config <config.toml|json> [--out <file>]', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
  }),
  Object.freeze({
    name: 'serve',
    helpSection: 'plain-python-node',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad serve [port] [--jobs-dir <dir>] [--legacy-viewer]', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'plain-python-node',
      requiresFreecadRuntime: false,
      note: null,
    }),
    serve: Object.freeze({
      preferredCli: 'fcad serve',
      preferredPackageScript: 'npm run serve',
      preferredScriptCommand: 'node bin/fcad.js serve',
      legacyCli: 'fcad serve --legacy-viewer',
      legacyPackageScript: 'npm run serve:legacy',
      legacyScriptCommand: 'node bin/serve-legacy.js',
    }),
  }),
  Object.freeze({
    name: 'analyze-part',
    helpSection: 'mixed-conditional',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad analyze-part <context.json|model.step>', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'mixed-conditional',
      requiresFreecadRuntime: null,
      note: 'Runs in plain Python mode when the input context already includes model metadata, uses FreeCAD for live model inspection or STEP feature detection when available, and falls back to bounded metadata-only geometry artifacts when shape inspection is weak or unavailable.',
    }),
  }),
  Object.freeze({
    name: 'design',
    helpSection: 'mixed-conditional',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad design "description"', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'mixed-conditional',
      requiresFreecadRuntime: null,
      note: 'Generates config content first, then calls `create`, so the overall flow still needs FreeCAD for model creation.',
    }),
  }),
  Object.freeze({
    name: 'sweep',
    helpSection: 'mixed-conditional',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad sweep <config.toml|json> --matrix <file> [--out-dir <dir>]', summary: null }),
    ]),
    runtime: Object.freeze({
      classification: 'mixed-conditional',
      requiresFreecadRuntime: null,
      note: 'Follows the matrix-selected service wrappers; cost-only variants can stay plain Python, while create/fem/report variants require FreeCAD.',
    }),
  }),
  Object.freeze({
    name: 'help',
    helpSection: 'mixed-conditional',
    helpEntries: Object.freeze([
      Object.freeze({ usage: 'fcad help', summary: null }),
    ]),
    runtime: null,
  }),
]);

const SHARED_WORKFLOW_OPTIONS = Object.freeze([
  Object.freeze({ flag: '--profile <name>', description: 'Shop profile under configs/profiles' }),
  Object.freeze({ flag: '--runtime <path>', description: 'Runtime JSON for line stabilization / launch review' }),
  Object.freeze({ flag: '--batch <n>', description: 'Batch size assumption for cost/readiness workflow' }),
  Object.freeze({ flag: '--site <name>', description: 'Site label override for summaries' }),
  Object.freeze({ flag: '--process <name>', description: 'Override manufacturing process when supported, including dfm' }),
  Object.freeze({ flag: '--material <name>', description: 'Override material for cost/readiness workflow' }),
  Object.freeze({ flag: '--context <path>', description: 'Engineering context JSON' }),
  Object.freeze({ flag: '--geometry <path>', description: 'Geometry intelligence JSON' }),
  Object.freeze({ flag: '--hotspots <path>', description: 'Manufacturing hotspot JSON' }),
  Object.freeze({ flag: '--out <path>', description: 'Primary output JSON path; sibling artifacts share its stem' }),
  Object.freeze({ flag: '--out-dir <dir>', description: 'Output directory when using default artifact names' }),
  Object.freeze({ flag: '--compare-to <path>', description: 'Baseline review-pack JSON for optional revision comparison with review-context' }),
]);

const WORKFLOW_SPECIFIC_OPTIONS = Object.freeze([
  Object.freeze({ flag: '--matrix <path>', description: 'Sweep definition TOML/JSON for fcad sweep' }),
  Object.freeze({ flag: '--override <path>', description: 'Merge override TOML/JSON on top of base config (with draw)' }),
  Object.freeze({ flag: '--bom', description: 'Export BOM as separate CSV file (with draw)' }),
  Object.freeze({ flag: '--raw', description: 'Skip SVG post-processing (with draw)' }),
  Object.freeze({ flag: '--no-score', description: 'Skip QA scoring (with draw)' }),
  Object.freeze({ flag: '--fail-under N', description: 'Fail if QA score < N (with draw)' }),
  Object.freeze({ flag: '--weights-preset P', description: 'QA weight profile: default|auto|flange|shaft|...' }),
  Object.freeze({ flag: '--strict', description: 'Treat warnings as errors (with validate/dfm)' }),
  Object.freeze({ flag: '--manifest-out <path>', description: 'Write a provenance manifest for stdout-oriented commands such as inspect/fem/tolerance/dfm' }),
  Object.freeze({ flag: '--recommend', description: 'Auto-recommend fit specs (with tolerance)' }),
  Object.freeze({ flag: '--csv', description: 'Export tolerance report as CSV (with tolerance)' }),
  Object.freeze({ flag: '--monte-carlo', description: 'Include Monte Carlo simulation (with tolerance/report)' }),
  Object.freeze({ flag: '--dfm', description: 'Include DFM analysis in report' }),
  Object.freeze({ flag: '--fem', description: 'Include FEM analysis in report' }),
  Object.freeze({ flag: '--no-tolerance', description: 'Skip tolerance analysis in report' }),
  Object.freeze({ flag: '--tolerance', description: 'Include tolerance analysis in report (default)' }),
]);

const CLI_HELP_EXAMPLES = Object.freeze([
  'fcad check-runtime',
  'fcad check-runtime --json',
  'fcad create configs/examples/ks_bracket.toml',
  'fcad draw configs/examples/ks_bracket.toml --bom',
  'fcad inspect output/ks_bracket.step --manifest-out output/ks_bracket_inspect_manifest.json',
  'fcad review configs/examples/infotainment_display_bracket.toml',
  'fcad readiness-pack --review-pack tests/fixtures/d-artifacts/sample_review_pack.canonical.json --out output/sample_readiness_report.json',
  'fcad readiness-report --review-pack tests/fixtures/d-artifacts/sample_review_pack.canonical.json --out output/sample_readiness_report.json',
  'fcad readiness-report configs/examples/pcb_mount_plate.toml --out output/pcb_mount_plate_readiness_report.json',
  'fcad pack --readiness output/sample_readiness_report.json --out output/release_bundle.zip',
  'fcad stabilization-review output/rev_a_readiness_report.json output/rev_b_readiness_report.json --out output/readiness_delta.json',
  'fcad generate-standard-docs configs/examples/controller_housing_eol.toml --readiness-report output/controller_housing_readiness_report.json --out-dir output/controller_housing_standard_docs',
  'fcad review-context --model tests/fixtures/sample_part.step --bom tests/fixtures/sample_bom.csv --inspection tests/fixtures/sample_inspection.csv --quality tests/fixtures/sample_quality.csv --out output/sample_review_pack.json',
  'fcad sweep configs/examples/ks_bracket.toml --matrix configs/examples/sweeps/ks_bracket_geometry_sweep.toml',
]);

const CLI_HELP_NOTES = Object.freeze([
  'check-runtime is the central installation and troubleshooting entrypoint for runtime-backed commands.',
  'analyze-part can run without FreeCAD when the supplied context already includes model metadata, and it now falls back to bounded metadata-only geometry when live shape inspection is weak or unavailable.',
  'readiness-pack is the flagship canonical C entrypoint when review_pack.json already exists.',
  'readiness-report <config> remains a legacy compatibility route; it is not the canonical D-backed readiness path.',
  'generate-standard-docs requires canonical readiness input via --readiness-report and will not synthesize or rebuild readiness downstream.',
  'sweep stays within the existing create/cost/fem/report service wrappers; it does not perform optimization.',
  'report remains FreeCAD-backed today, even when macOS falls back from freecadcmd to the bundled FreeCAD Python.',
  'Windows native, WSL -> Windows FreeCAD, and Linux runtime execution are compatibility paths, not equal-maturity claims.',
]);

const SERVE_USAGE_DETAILS = Object.freeze({
  title: 'fcad serve - local API, studio shell, and legacy compatibility viewer',
  usage: Object.freeze([
    'fcad serve [port] [--jobs-dir <dir>]',
    'fcad serve [port] --legacy-viewer',
    'fcad serve --help',
  ]),
  modes: Object.freeze([
    Object.freeze({
      flag: 'default',
      description: 'Starts the local HTTP API for /health and /jobs and serves the studio shell at / and /studio',
    }),
    Object.freeze({
      flag: '--legacy-viewer',
      description: 'Starts the compatibility-only browser shell from server.js',
    }),
  ]),
  notes: Object.freeze([
    'Browser requests to http://127.0.0.1:<port>/ land in the future-facing studio shell.',
    'Open http://127.0.0.1:<port>/api for the local API info page.',
    'Open http://127.0.0.1:<port>/studio for the direct studio route.',
    'Open http://127.0.0.1:<port>/health to verify the API.',
    'Use fcad serve --legacy-viewer or npm run serve:legacy only when you specifically need the legacy websocket shell.',
    'New browser work should target the default Studio/API path instead of server.js.',
  ]),
});

export const LEGACY_READINESS_REPORT_MESSAGE = 'readiness-report <config> is a legacy compatibility route and does not emit canonical D-backed readiness provenance. Use readiness-pack --review-pack or readiness-report --review-pack for canonical C output.';
export const GENERATE_STANDARD_DOCS_INPUT_MESSAGE = 'generate-standard-docs requires --readiness-report <readiness_report.json>; it will not synthesize canonical readiness from config-only inputs or rebuild readiness from review_pack.json.';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function listCommandEntries() {
  return COMMAND_MANIFEST.map((entry) => ({
    ...entry,
    helpEntries: entry.helpEntries.map((helpEntry) => ({ ...helpEntry })),
    runtime: entry.runtime ? { ...entry.runtime } : null,
    surfaces: entry.surfaces ? { ...entry.surfaces } : null,
    serve: entry.serve ? { ...entry.serve } : null,
  }));
}

function listHelpEntriesBySection(sectionKey) {
  return COMMAND_MANIFEST
    .filter((entry) => entry.helpSection === sectionKey)
    .flatMap((entry) => entry.helpEntries.map((helpEntry) => ({
      command: entry.name,
      usage: helpEntry.usage,
      summary: helpEntry.summary || null,
    })));
}

function renderAlignedHelpLines(entries = []) {
  return entries.map((entry) => (
    entry.summary
      ? `    ${entry.usage}  ${entry.summary}`
      : `    ${entry.usage}`
  ));
}

function renderOptionLines(entries = []) {
  const flagWidth = entries.reduce((width, entry) => Math.max(width, entry.flag.length), 0);
  return entries.map((entry) => `    ${entry.flag.padEnd(flagWidth + 2)}${entry.description}`);
}

function escapeForSentence(value) {
  return String(value || '').trim();
}

export function formatCommandNameList(names = [], { conjunction = 'and', quote = 'none' } = {}) {
  const values = [...new Set(names.map(escapeForSentence).filter(Boolean))];
  const format = (value) => {
    if (quote === 'double') return `"${value}"`;
    if (quote === 'backtick') return `\`${value}\``;
    return value;
  };
  const items = values.map(format);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

export function getCommandManifest() {
  return listCommandEntries();
}

export function getCommandEntry(commandName) {
  const entry = COMMAND_MANIFEST.find((command) => command.name === commandName);
  return entry ? deepClone(entry) : null;
}

export function getServeEntrypointMetadata() {
  return deepClone(COMMAND_MANIFEST.find((entry) => entry.name === 'serve')?.serve || {});
}

function listRuntimeEntries(classification) {
  return COMMAND_MANIFEST.filter((entry) => entry.runtime?.classification === classification);
}

export const DIAGNOSTIC_COMMANDS = Object.freeze(
  listRuntimeEntries('diagnostics').map((entry) => entry.name)
);

export const FREECAD_BACKED_COMMANDS = Object.freeze(
  listRuntimeEntries('freecad-backed').map((entry) => entry.name)
);

export const PLAIN_PYTHON_COMMANDS = Object.freeze(
  listRuntimeEntries('plain-python-node').map((entry) => entry.name)
);

export const CONDITIONAL_COMMANDS = Object.freeze(
  listRuntimeEntries('mixed-conditional').map((entry) => Object.freeze({
    name: entry.name,
    note: entry.runtime.note,
  }))
);

const COMMAND_INDEX = new Map(COMMAND_MANIFEST.map((entry) => [entry.name, entry]));
const JOB_EXECUTOR_COMMAND_ORDER = Object.freeze([
  'create',
  'draw',
  'inspect',
  'report',
  'review-context',
  'compare-rev',
  'readiness-pack',
  'stabilization-review',
  'generate-standard-docs',
  'pack',
]);
const STUDIO_JOB_COMMAND_ORDER = Object.freeze([
  'create',
  'draw',
  'inspect',
  'report',
  'compare-rev',
  'readiness-pack',
  'stabilization-review',
  'generate-standard-docs',
  'pack',
]);
const STUDIO_ARTIFACT_JOB_ORDER = Object.freeze([
  'readiness-pack',
  'generate-standard-docs',
  'pack',
]);
const STUDIO_ARTIFACT_COMPATIBLE_JOB_ORDER = Object.freeze([
  'inspect',
  'report',
  'readiness-pack',
  'generate-standard-docs',
  'pack',
]);
const STUDIO_PAIRED_JOB_ORDER = Object.freeze([
  'compare-rev',
  'stabilization-review',
]);
const LOCAL_API_CONFIG_JOB_ORDER = Object.freeze([
  'create',
  'draw',
  'report',
]);
const LOCAL_API_OTHER_PUBLIC_JOB_ORDER = Object.freeze([
  'review-context',
  'compare-rev',
  'readiness-pack',
  'stabilization-review',
  'generate-standard-docs',
  'pack',
]);

function orderedCommandNames(order = [], predicate = null) {
  return Object.freeze(
    order.filter((name) => {
      const entry = COMMAND_INDEX.get(name);
      return entry && (typeof predicate === 'function' ? predicate(entry) : true);
    })
  );
}

export const JOB_EXECUTOR_COMMANDS = orderedCommandNames(
  JOB_EXECUTOR_COMMAND_ORDER,
  (entry) => entry.surfaces?.jobExecutor === true
);
export const LOCAL_API_JOB_COMMANDS = JOB_EXECUTOR_COMMANDS;
export const STUDIO_JOB_COMMANDS = orderedCommandNames(
  STUDIO_JOB_COMMAND_ORDER,
  (entry) => entry.surfaces?.studio === true
);
export const STUDIO_ARTIFACT_JOB_COMMANDS = orderedCommandNames(
  STUDIO_ARTIFACT_JOB_ORDER,
  (entry) => entry.surfaces?.studioSubmission === 'artifact'
);
export const STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS = orderedCommandNames(
  STUDIO_ARTIFACT_COMPATIBLE_JOB_ORDER,
  (entry) => entry.surfaces?.studioSubmission === 'artifact' || entry.surfaces?.studioSubmission === 'config-or-artifact'
);
export const STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS = orderedCommandNames(
  STUDIO_PAIRED_JOB_ORDER,
  (entry) => entry.surfaces?.studioSubmission === 'artifact-pair'
);
export const LOCAL_API_CONFIG_JOB_COMMANDS = orderedCommandNames(
  LOCAL_API_CONFIG_JOB_ORDER,
  (entry) => entry.surfaces?.localApi === true
);
export const LOCAL_API_OTHER_PUBLIC_JOB_COMMANDS = orderedCommandNames(
  LOCAL_API_OTHER_PUBLIC_JOB_ORDER,
  (entry) => entry.surfaces?.localApi === true
);

export function renderCliUsage() {
  const lines = [
    'fcad | mfg-agent - FreeCAD-backed automation pipeline',
    '',
    'FreeCAD-backed CLI for CAD, TechDraw, inspection, FEM, tolerance, and reporting,',
    'plus a plain-Python/Node manufacturing-review layer.',
    '',
    'Run this first on a new machine or before troubleshooting runtime-backed commands:',
    '  fcad check-runtime',
    '',
    'Usage:',
  ];

  HELP_SECTION_ORDER.forEach((section) => {
    lines.push(`  ${section.title}:`);
    lines.push(...renderAlignedHelpLines(listHelpEntriesBySection(section.key)));
    lines.push('');
  });

  lines.push('Options:');
  lines.push('  Shared workflow options:');
  lines.push(...renderOptionLines(SHARED_WORKFLOW_OPTIONS));
  lines.push('');
  lines.push('  Workflow-specific options:');
  lines.push(...renderOptionLines(WORKFLOW_SPECIFIC_OPTIONS));
  lines.push('');
  lines.push('Examples:');
  CLI_HELP_EXAMPLES.forEach((example) => {
    lines.push(`  ${example}`);
  });
  lines.push('');
  lines.push('  Notes:');
  CLI_HELP_NOTES.forEach((note) => {
    lines.push(`  ${note}`);
  });

  return lines.join('\n').trim();
}

export function renderServeUsage() {
  const modeWidth = SERVE_USAGE_DETAILS.modes.reduce((width, entry) => Math.max(width, entry.flag.length), 0);
  const lines = [
    SERVE_USAGE_DETAILS.title,
    '',
    'Usage:',
    ...SERVE_USAGE_DETAILS.usage.map((entry) => `  ${entry}`),
    '',
    'Modes:',
    ...SERVE_USAGE_DETAILS.modes.map((entry) => `  ${entry.flag.padEnd(modeWidth + 2)}${entry.description}`),
    '',
    'Notes:',
    ...SERVE_USAGE_DETAILS.notes.map((note) => `  ${note}`),
  ];
  return lines.join('\n').trim();
}
