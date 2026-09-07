#!/usr/bin/env node
/**
 * design-reviewer.js — optional AI config drafting and advisory review adapter.
 *
 * Mode A: Review existing TOML → issues + corrected TOML + report
 *   node scripts/design-reviewer.js --review <path.toml> [--json]
 *
 * Mode B: Generate TOML from natural language description
 *   node scripts/design-reviewer.js --design "description" [--json]
 *
 * Exit codes: 0=success, 1=critical issues found, 2=API/config error
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateCadToml as validateTomlStructure } from '../lib/cad-config-validation.js';
import {
  createOpenAIResponsesClient,
  DEFAULT_OPENAI_MAX_REQUESTS,
  DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TIMEOUT_MS,
} from '../src/services/design/openai-responses-client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You provide optional draft advice for freecad-automation configs. Preserve explicit user requirements, feature IDs and units. Output only repository-supported config syntax. Do not assign unspecified tolerances, clearances, materials or loads as verified facts. Label any necessary assumptions in comments and the existing report recommendation. AI advice is not measured shape validity, clearance inspection, drawing QA or manufacturing approval. Unknown report values must be null or empty, not invented measurements.

## Output Format
You MUST output exactly three sections in this order:

### ISSUES
\`\`\`json
[
  {"id": 1, "severity": "critical|warning|info", "part": "part_id", "description": "what is wrong", "fix": "how to fix it"}
]
\`\`\`

### CORRECTED TOML
\`\`\`toml
# The full corrected TOML with all fixes applied
# Add inline comments explaining each fix: # FIX: description
\`\`\`

### DESIGN REPORT
\`\`\`json
{
  "mechanism_type": "e.g. spool-cam-pawl retractor",
  "dof": null,
  "motion_chain": ["spool(revolute)", "lock_cam(gear 1:1)", "pawl(cam_follower prismatic)"],
  "materials_assigned": {},
  "clearances_mm": [],
  "total_issues": 8,
  "critical_count": 2,
  "recommendation": "summary"
}
\`\`\``;

const DESIGN_PROMPT = `You provide optional draft advice for freecad-automation configs. Preserve explicit user requirements, feature IDs and units. Output only repository-supported config syntax. Do not assign unspecified tolerances, clearances, materials or loads as verified facts. Label any necessary assumptions in comments and the existing report recommendation. AI advice is not measured shape validity, clearance inspection, drawing QA or manufacturing approval. Unknown report values must be null or empty, not invented measurements.

## TOML Structure
- Prefer **single-part mode** for one static body:
  - \`name = "part_name"\`
  - top-level \`[[shapes]]\`, optional top-level \`[[operations]]\`
- Use **assembly mode** only when there are multiple interacting parts:
  - \`name = "mechanism_name"\`
- \`[export]\` with formats, directory, per_part_stl
- \`[[parts]]\` array, each with id and [[parts.shapes]]
  - Shape types must be one of:
    box, cylinder, sphere, cone, torus, revolution, extrusion, loft, sweep, import
    or these library parts:
    library/spur_gear, library/helical_gear, library/ball_bearing, library/stepped_shaft,
    library/disc_cam, library/pulley, library/coil_spring,
    library/robot_base (diameter, height, bolt_count, bolt_d, cable_hole_d),
    library/robot_link (length, width, taper_ratio, motor_d, wall_thickness, bore_d),
    library/robot_wrist (diameter, length, wall_thickness, bore_d),
    library/tool_flange (diameter, thickness, bolt_count, bolt_circle_d, bolt_d, pilot_d, pin_d)
  - Each shape MUST have an \`id\` field (unique within the part, e.g. "body", "shaft", "flange")
  - Shape \`rotation\` format: \`[axis_x, axis_y, axis_z, angle_degrees]\` (axis-angle, 4 elements)
  - Part operations must use canonical \`op\` key, never \`type\`
  - Single-part \`[[operations]]\` may use: fuse, cut, common, fillet, chamfer, shell, circular_pattern
  - Assembly \`[[parts.operations]]\` may use: fuse, cut, common, fillet, chamfer, circular_pattern
  - Do NOT use \`shell\` inside \`[[parts.operations]]\`; assembly builder does not support it
- \`[assembly]\` with [[assembly.parts]] (ref + position), [[assembly.joints]], [[assembly.couplings]], [assembly.motion]
  - Assembly part \`rotation\` format: \`[axis_x, axis_y, axis_z, angle_degrees]\` (axis-angle, 4 elements)
  - Every \`[[assembly.parts]] ref\` must match a declared \`[[parts]].id\`
  - Do NOT use \`assembly.parts.children\` or any hierarchy-only schema
- Joint types: revolute, prismatic, cylindrical
- Coupling types: gear, belt, cam_follower

## Output Format
Output exactly two sections:

### GENERATED TOML
\`\`\`toml
# Complete TOML config
\`\`\`

### DESIGN REPORT
\`\`\`json
{
  "mechanism_type": "description",
  "dof": 2,
  "motion_chain": ["part(joint_type)"],
  "materials_assigned": {"part_id": "material"},
  "parts_count": 5,
  "joints_count": 3,
  "recommendation": "summary"
}
\`\`\``;

// ---------------------------------------------------------------------------
// OpenAI Responses client
// ---------------------------------------------------------------------------

const OPENAI_ENV_NAMES = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_MAX_OUTPUT_TOKENS',
  'OPENAI_TIMEOUT_MS',
  'OPENAI_ALLOW_LIVE_REQUEST',
  'OPENAI_REQUEST_LIMIT',
  'OPENAI_ALLOW_REPAIR_RETRY',
];

function loadOpenAIEnvFiles() {
  const preserved = new Map(
    OPENAI_ENV_NAMES
      .filter((name) => Object.hasOwn(process.env, name))
      .map((name) => [name, process.env[name]]),
  );
  const root = resolve(import.meta.dirname, '..');

  for (const envPath of [resolve(root, '.env'), resolve(root, '.env.local')]) {
    try { process.loadEnvFile(envPath); } catch { /* optional local env file */ }
  }
  for (const [name, value] of preserved) process.env[name] = value;
}

let sharedOpenAIClient;

function initOpenAI() {
  if (sharedOpenAIClient) return sharedOpenAIClient;
  loadOpenAIEnvFiles();
  sharedOpenAIClient = createOpenAIResponsesClient({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    maxOutputTokens: process.env.OPENAI_MAX_OUTPUT_TOKENS || DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
    timeoutMs: process.env.OPENAI_TIMEOUT_MS || DEFAULT_OPENAI_TIMEOUT_MS,
    allowLiveRequests: process.env.OPENAI_ALLOW_LIVE_REQUEST === '1',
    maxRequests: process.env.OPENAI_REQUEST_LIMIT || DEFAULT_OPENAI_MAX_REQUESTS,
  });
  return sharedOpenAIClient;
}

async function callOpenAIWithRetry(client, request, retries = 0) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await client.complete(request);
    } catch (err) {
      lastError = err;
      if (attempt < retries && err.retryable !== false) {
        const delay = 1000 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }
  throw new Error(`OpenAI API failed after ${retries + 1} attempt(s): ${lastError.message}`);
}

/**
 * Streaming OpenAI call — invokes onChunk(deltaText, totalLength) for each chunk.
 * Returns the full accumulated response text.
 */
async function callOpenAIStreaming(client, request, onChunk) {
  return client.stream({ ...request, onChunk });
}

function repairRetryEnabled(options = {}) {
  if (typeof options.allowRepairRetry === 'boolean') return options.allowRepairRetry;
  return process.env.OPENAI_ALLOW_REPAIR_RETRY === '1';
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractFirstBlock(text, lang) {
  const regex = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```');
  const match = text.match(regex);
  if (!match) return null;
  return match[1].trim();
}

function extractLastBlock(text, lang) {
  const regex = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'g');
  const matches = [...text.matchAll(regex)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

function extractTomlFromResponse(text) {
  // TOML: take the last block (corrected version comes after original)
  return extractLastBlock(text, 'toml');
}

function extractJsonFromResponse(text, section) {
  // Find the FIRST JSON block after a specific section header
  const sectionIdx = text.indexOf(section);
  if (sectionIdx === -1) {
    return extractFirstBlock(text, 'json');
  }
  const after = text.slice(sectionIdx);
  return extractFirstBlock(after, 'json');
}

// ---------------------------------------------------------------------------
// Review mode
// ---------------------------------------------------------------------------

function labelDraftAdvice(report) {
  const advice = report && typeof report === 'object' && !Array.isArray(report) ? report : {};
  return {
    ...advice,
    recommendation: `AI draft advice only; not CAD validation, inspection evidence or manufacturing approval. ${typeof advice.recommendation === 'string' ? advice.recommendation : ''}`.trim(),
  };
}

async function reviewToml(filePath, options = {}) {
  const tomlContent = readFileSync(filePath, 'utf8');

  // Validate input TOML first
  const preCheck = validateTomlStructure(tomlContent);
  if (!preCheck.valid) {
    return {
      issues: preCheck.errors.map((e, i) => ({
        id: i + 1, severity: 'critical', part: 'config', description: e, fix: 'Fix TOML syntax',
      })),
      correctedToml: null,
      report: { total_issues: preCheck.errors.length, critical_count: preCheck.errors.length },
    };
  }

  const client = options.client || initOpenAI();
  const input = `Review this TOML assembly config and provide issues, corrected TOML, and design report:

\`\`\`toml
${tomlContent}
\`\`\``;

  let response = await callOpenAIWithRetry(client, { instructions: SYSTEM_PROMPT, input });

  // Extract corrected TOML and validate it
  let correctedToml = extractTomlFromResponse(response);
  if (correctedToml) {
    const validation = validateTomlStructure(correctedToml);
    if (!validation.valid) {
      if (!repairRetryEnabled(options)) {
        correctedToml = null;
      } else {
        // Optional second API call with validation feedback. Disabled by default for cost control.
        const retryInput = `${input}

Your previous corrected TOML had parse errors:
${validation.errors.join('\n')}

Please fix these errors and output again with the same three sections.`;
        response = await callOpenAIWithRetry(
          client,
          { instructions: SYSTEM_PROMPT, input: retryInput },
        );
        correctedToml = extractTomlFromResponse(response);

        if (correctedToml) {
          const recheck = validateTomlStructure(correctedToml);
          if (!recheck.valid) {
            correctedToml = null; // Give up on corrected TOML
          }
        }
      }
    }
  }

  // Extract issues
  let issues = [];
  const issuesJson = extractJsonFromResponse(response, '### ISSUES');
  if (issuesJson) {
    try {
      const parsed = JSON.parse(issuesJson);
      issues = Array.isArray(parsed) ? parsed : [];
    } catch { /* use empty */ }
  }

  // Extract report
  let report = {};
  const reportJson = extractJsonFromResponse(response, '### DESIGN REPORT');
  if (reportJson) {
    try { report = JSON.parse(reportJson); } catch { /* use empty */ }
  }

  return { issues, correctedToml, report: labelDraftAdvice(report), rawResponse: response };
}

// ---------------------------------------------------------------------------
// Design mode
// ---------------------------------------------------------------------------

async function designFromText(description, options = {}) {
  const client = options.client || initOpenAI();

  const input = `Design a mechanism for: "${description}"

Draft a supported TOML candidate preserving the supplied requirements; explicitly label any assumptions.`;

  let response = await callOpenAIWithRetry(client, { instructions: DESIGN_PROMPT, input });

  let toml = extractTomlFromResponse(response);
  if (toml) {
    const validation = validateTomlStructure(toml);
    if (!validation.valid) {
      if (!repairRetryEnabled(options)) {
        toml = null;
      } else {
        // Optional second API call with validation feedback. Disabled by default for cost control.
        const retryInput = `${input}

Your previous TOML had parse errors:
${validation.errors.join('\n')}

Please fix and regenerate with the same two sections.`;
        response = await callOpenAIWithRetry(
          client,
          { instructions: DESIGN_PROMPT, input: retryInput },
        );
        toml = extractTomlFromResponse(response);
        if (toml && !validateTomlStructure(toml).valid) toml = null;
      }
    }
  }

  let report = {};
  const reportJson = extractJsonFromResponse(response, '### DESIGN REPORT');
  if (reportJson) {
    try { report = JSON.parse(reportJson); } catch { /* use empty */ }
  }

  return { toml, report: labelDraftAdvice(report), rawResponse: response };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const reviewIdx = args.indexOf('--review');
  const designIdx = args.indexOf('--design');

  if (reviewIdx === -1 && designIdx === -1) {
    console.error('Usage:');
    console.error('  node scripts/design-reviewer.js --review <path.toml> [--json]');
    console.error('  node scripts/design-reviewer.js --design "description" [--json]');
    process.exit(2);
  }

  try {
    if (reviewIdx !== -1) {
      // Mode A: Review existing TOML
      const filePath = resolve(args[reviewIdx + 1]);
      if (!filePath || filePath.startsWith('--')) {
        console.error('ERROR: --review requires a TOML file path');
        process.exit(2);
      }

      const result = await reviewToml(filePath);

      if (jsonMode) {
        console.log(JSON.stringify({
          mode: 'review',
          issues: result.issues,
          correctedToml: result.correctedToml,
          report: result.report,
        }, null, 2));
      } else {
        console.log('\n=== DESIGN REVIEW ===\n');
        console.log(`Issues found: ${result.issues.length}`);
        for (const issue of result.issues) {
          const icon = issue.severity === 'critical' ? 'X' : issue.severity === 'warning' ? '!' : 'i';
          console.log(`  [${icon}] #${issue.id} (${issue.severity}) ${issue.part}: ${issue.description}`);
          console.log(`      Fix: ${issue.fix}`);
        }

        if (result.correctedToml) {
          const outPath = filePath.replace('.toml', '.reviewed.toml');
          writeFileSync(outPath, result.correctedToml, 'utf8');
          console.log(`\nCorrected TOML written to: ${outPath}`);
        }

        if (result.report.recommendation) {
          console.log(`\nRecommendation: ${result.report.recommendation}`);
        }
      }

      // Exit 1 if critical issues found
      const criticalCount = result.issues.filter(i => i.severity === 'critical').length;
      process.exit(criticalCount > 0 ? 1 : 0);

    } else {
      // Mode B: Generate from description
      const description = args[designIdx + 1];
      if (!description || description.startsWith('--')) {
        console.error('ERROR: --design requires a description string');
        process.exit(2);
      }

      const result = await designFromText(description);

      if (jsonMode) {
        console.log(JSON.stringify({
          mode: 'design',
          toml: result.toml,
          report: result.report,
        }, null, 2));
      } else {
        console.log('\n=== GENERATED DESIGN ===\n');
        if (result.toml) {
          console.log(result.toml);
          console.log('\n--- Report ---');
          console.log(JSON.stringify(result.report, null, 2));
        } else {
          console.error('Failed to generate valid TOML');
          process.exit(1);
        }
      }

      process.exit(result.toml ? 0 : 1);
    }
  } catch (err) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(`ERROR: ${err.message}`);
    }
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Design mode — streaming
// ---------------------------------------------------------------------------

async function designFromTextStreaming(description, onChunk, options = {}) {
  const client = options.client || initOpenAI();

  const input = `Design a mechanism for: "${description}"

Draft a supported TOML candidate preserving the supplied requirements; explicitly label any assumptions.`;

  let response = await callOpenAIStreaming(
    client,
    { instructions: DESIGN_PROMPT, input },
    onChunk,
  );

  let toml = extractTomlFromResponse(response);
  if (toml) {
    const validation = validateTomlStructure(toml);
    if (!validation.valid) {
      if (!repairRetryEnabled(options)) {
        toml = null;
      } else {
        // Optional second API call with validation feedback. Disabled by default for cost control.
        const retryInput = `${input}

Your previous TOML had parse errors:
${validation.errors.join('\n')}

Please fix and regenerate with the same two sections.`;
        response = await callOpenAIWithRetry(
          client,
          { instructions: DESIGN_PROMPT, input: retryInput },
        );
        toml = extractTomlFromResponse(response);
        if (toml && !validateTomlStructure(toml).valid) toml = null;
      }
    }
  }

  let report = {};
  const reportJson = extractJsonFromResponse(response, '### DESIGN REPORT');
  if (reportJson) {
    try { report = JSON.parse(reportJson); } catch { /* use empty */ }
  }

  return { toml, report: labelDraftAdvice(report), rawResponse: response };
}

// Export for programmatic use
export { reviewToml, designFromText, designFromTextStreaming, validateTomlStructure, extractTomlFromResponse, extractJsonFromResponse };

// Only run CLI when executed directly (not when imported)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
