#!/usr/bin/env node
/**
 * design-reviewer.js — Gemini-powered kinematics design reviewer.
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
import { parse as parseTOML } from 'smol-toml';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior mechanical engineer specializing in kinematic mechanism design for simulation (MuJoCo MJCF format). You review TOML assembly configs for a parametric CAD system.

## Your Expertise
1. **Mechanism analysis**: Identify parts, DOF, motion chains, and coupling types.
2. **Dimensional design**:
   - Shaft sizing: τ = F × r, minimum 3mm radius for any rotating shaft
   - Shaft-bore fit: H7/g6 tolerance → clearance 0.01–0.05mm (bore_radius - shaft_radius)
   - Cam pressure angle must be < 30°
   - Gear module × teeth / 2 = pitch radius
3. **Layout / interference**:
   - Every pair of adjacent bodies must have >= 0.5mm clearance between bounding geometries
   - Zero overlap/intersection between any two placed parts
   - Joint anchors must lie within the part's bounding volume
4. **Material properties** (add \`material\` field to each shape):
   - steel: density 7850 kg/m³, friction [0.6, 0.005, 0.0001]
   - aluminum: density 2700 kg/m³, friction [0.4, 0.003, 0.0001]
   - brass: density 8500 kg/m³, friction [0.35, 0.003, 0.0001]
   - plastic: density 1200 kg/m³, friction [0.3, 0.002, 0.00005]
   - rubber: density 1100 kg/m³, friction [0.9, 0.01, 0.0005]
5. **Checklist** (always verify):
   - Shaft OD vs bore ID clearance (0.01–0.05mm)
   - Cam base_radius + max_lift vs follower reach
   - Gear ratio consistency (teeth count vs declared ratio)
   - No part-part interference at any assembly position
   - Joint anchors within part bounds
   - Spring coil_d fits inside housing

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
# Add material field to every first shape in each part
# Add inline comments explaining each fix: # FIX: description
\`\`\`

### DESIGN REPORT
\`\`\`json
{
  "mechanism_type": "e.g. spool-cam-pawl retractor",
  "dof": 3,
  "motion_chain": ["spool(revolute)", "lock_cam(gear 1:1)", "pawl(cam_follower prismatic)"],
  "materials_assigned": {"part_id": "material_name"},
  "clearances_mm": [{"pair": ["part_a", "part_b"], "min_clearance": 1.5}],
  "total_issues": 8,
  "critical_count": 2,
  "recommendation": "summary"
}
\`\`\``;

const DESIGN_PROMPT = `You are a senior mechanical engineer. Given a natural language description of a mechanism, generate a complete TOML assembly config for the FreeCAD parametric CAD system.

## TOML Structure
- \`name = "mechanism_name"\`
- \`[export]\` with formats, directory, per_part_stl
- \`[[parts]]\` array, each with id and [[parts.shapes]]
  - Shape types: box, cylinder, or library parts:
    library/spur_gear, library/helical_gear, library/ball_bearing, library/stepped_shaft,
    library/disc_cam, library/pulley, library/coil_spring,
    library/robot_base (diameter, height, bolt_count, bolt_d, cable_hole_d),
    library/robot_link (length, width, taper_ratio, motor_d, wall_thickness, bore_d),
    library/robot_wrist (diameter, length, wall_thickness, bore_d),
    library/tool_flange (diameter, thickness, bolt_count, bolt_circle_d, bolt_d, pilot_d, pin_d)
  - Each shape MUST have an \`id\` field (unique within the part, e.g. "body", "shaft", "flange")
  - Each shape MUST have a \`material\` field (steel/aluminum/brass/plastic/rubber)
  - Shape \`rotation\` format: \`[axis_x, axis_y, axis_z, angle_degrees]\` (axis-angle, 4 elements)
- \`[assembly]\` with [[assembly.parts]] (ref + position), [[assembly.joints]], [[assembly.couplings]], [assembly.motion]
  - Assembly part \`rotation\` format: \`[axis_x, axis_y, axis_z, angle_degrees]\` (axis-angle, 4 elements)
- Joint types: revolute, prismatic, cylindrical
- Coupling types: gear, belt, cam_follower

## Design Rules
- Shaft-bore clearance: 0.01–0.05mm (H7/g6 fit)
- Adjacent parts: >= 0.5mm clearance
- Cam pressure angle < 30°
- All dimensions in mm
- Joint anchors within part bounding volumes
- Realistic material assignments

## Example TOML (6-axis robot arm)
\`\`\`toml
name = "6axis_robot_arm"

[export]
formats = ["step", "stl"]
directory = "./output"
per_part_stl = true

# ── Part Definitions ────────────────────────────
[[parts]]
id = "base"
  [[parts.shapes]]
  id = "pedestal"
  type = "library/robot_base"
  diameter = 200
  height = 50
  bolt_count = 8
  bolt_d = 10
  cable_hole_d = 50
  material = "steel"

[[parts]]
id = "shoulder"
  [[parts.shapes]]
  id = "link"
  type = "library/robot_link"
  length = 300
  width = 100
  taper_ratio = 0.8
  motor_d = 95
  wall_thickness = 6
  bore_d = 20
  material = "aluminum"

[[parts]]
id = "upper_arm"
  [[parts.shapes]]
  id = "link"
  type = "library/robot_link"
  length = 400
  width = 80
  taper_ratio = 0.75
  wall_thickness = 5
  bore_d = 15
  material = "aluminum"

[[parts]]
id = "forearm"
  [[parts.shapes]]
  id = "link"
  type = "library/robot_link"
  length = 350
  width = 60
  taper_ratio = 0.7
  wall_thickness = 4
  bore_d = 12
  material = "aluminum"

[[parts]]
id = "wrist_pitch"
  [[parts.shapes]]
  id = "housing"
  type = "library/robot_wrist"
  diameter = 50
  length = 80
  wall_thickness = 4
  bore_d = 10
  material = "steel"

[[parts]]
id = "wrist_roll"
  [[parts.shapes]]
  id = "housing"
  type = "library/robot_wrist"
  diameter = 40
  length = 60
  wall_thickness = 3
  bore_d = 8
  material = "steel"

[[parts]]
id = "tool_flange"
  [[parts.shapes]]
  id = "flange"
  type = "library/tool_flange"
  diameter = 63
  thickness = 12
  bolt_count = 4
  bolt_d = 6
  pilot_d = 31.5
  material = "steel"

# ── Assembly ────────────────────────────────────
[assembly]

[[assembly.parts]]
ref = "base"
position = [0, 0, 0]

[[assembly.parts]]
ref = "shoulder"
position = [0, 0, 50]
rotation = [1, 0, 0, 90]

[[assembly.parts]]
ref = "upper_arm"
position = [0, 0, 350]

[[assembly.parts]]
ref = "forearm"
position = [0, 0, 750]

[[assembly.parts]]
ref = "wrist_pitch"
position = [0, 0, 1100]

[[assembly.parts]]
ref = "wrist_roll"
position = [0, 0, 1180]

[[assembly.parts]]
ref = "tool_flange"
position = [0, 0, 1240]

# ── Joints ──────────────────────────────────────
[[assembly.joints]]
id = "j1_base"
type = "revolute"
part = "shoulder"
axis = [0, 0, 1]
anchor = [0, 0, 50]

[[assembly.joints]]
id = "j2_shoulder"
type = "revolute"
part = "upper_arm"
axis = [0, 1, 0]
anchor = [0, 0, 350]

[[assembly.joints]]
id = "j3_elbow"
type = "revolute"
part = "forearm"
axis = [0, 1, 0]
anchor = [0, 0, 750]

# ── Motion ──────────────────────────────────────
[assembly.motion]
driver = "j1_base"
range = [0, 180]
duration = 3.0
steps = 90
loop = true
\`\`\`

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
// Gemini client
// ---------------------------------------------------------------------------

function initGemini() {
  // Node v24: process.loadEnvFile() loads .env from cwd
  try { process.loadEnvFile(); } catch { /* no .env file, ignore */ }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY environment variable is required.');
    console.error('Set it in .env or export GEMINI_API_KEY=...');
    process.exit(2);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

async function callGeminiWithRetry(model, prompt, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = 1000 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`Gemini API failed after ${retries + 1} attempts: ${lastError.message}`);
}

/**
 * Streaming Gemini call — invokes onChunk(deltaText, totalLength) for each chunk.
 * Returns the full accumulated response text.
 */
async function callGeminiStreaming(model, prompt, onChunk) {
  const result = await model.generateContentStream(prompt);
  let fullText = '';
  for await (const chunk of result.stream) {
    const delta = chunk.text();
    fullText += delta;
    if (onChunk) onChunk(delta, fullText.length);
  }
  return fullText;
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
// TOML validation
// ---------------------------------------------------------------------------

function validateTomlStructure(tomlStr) {
  const errors = [];

  let config;
  try {
    config = parseTOML(tomlStr);
  } catch (err) {
    return { valid: false, errors: [`TOML parse error: ${err.message}`], config: null };
  }

  if (!config.name) errors.push('Missing top-level "name" field');

  const parts = config.parts || [];
  if (parts.length === 0) errors.push('No parts defined');

  for (const p of parts) {
    if (!p.id) errors.push('Part missing "id" field');
    if (!p.shapes || p.shapes.length === 0) {
      errors.push(`Part "${p.id}" has no shapes`);
    }
  }

  const assembly = config.assembly;
  if (assembly) {
    const asmParts = assembly.parts || [];
    if (asmParts.length === 0) errors.push('Assembly has no parts');
    for (const ap of asmParts) {
      if (!ap.ref) errors.push('Assembly part missing "ref"');
    }
  }

  return { valid: errors.length === 0, errors, config };
}

// ---------------------------------------------------------------------------
// Review mode
// ---------------------------------------------------------------------------

async function reviewToml(filePath) {
  const model = initGemini();
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

  const prompt = `${SYSTEM_PROMPT}

Review this TOML assembly config and provide issues, corrected TOML, and design report:

\`\`\`toml
${tomlContent}
\`\`\``;

  let response = await callGeminiWithRetry(model, prompt);

  // Extract corrected TOML and validate it
  let correctedToml = extractTomlFromResponse(response);
  if (correctedToml) {
    const validation = validateTomlStructure(correctedToml);
    if (!validation.valid) {
      // Retry with error feedback
      const retryPrompt = `${prompt}

Your previous corrected TOML had parse errors:
${validation.errors.join('\n')}

Please fix these errors and output again with the same three sections.`;
      response = await callGeminiWithRetry(model, retryPrompt, 1);
      correctedToml = extractTomlFromResponse(response);

      if (correctedToml) {
        const recheck = validateTomlStructure(correctedToml);
        if (!recheck.valid) {
          correctedToml = null; // Give up on corrected TOML
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

  return { issues, correctedToml, report, rawResponse: response };
}

// ---------------------------------------------------------------------------
// Design mode
// ---------------------------------------------------------------------------

async function designFromText(description) {
  const model = initGemini();

  const prompt = `${DESIGN_PROMPT}

Design a mechanism for: "${description}"

Generate a complete, valid TOML config with realistic dimensions, proper clearances, and material assignments.`;

  let response = await callGeminiWithRetry(model, prompt);

  let toml = extractTomlFromResponse(response);
  if (toml) {
    const validation = validateTomlStructure(toml);
    if (!validation.valid) {
      // Retry with error feedback
      const retryPrompt = `${prompt}

Your previous TOML had parse errors:
${validation.errors.join('\n')}

Please fix and regenerate with the same two sections.`;
      response = await callGeminiWithRetry(model, retryPrompt, 1);
      toml = extractTomlFromResponse(response);
    }
  }

  let report = {};
  const reportJson = extractJsonFromResponse(response, '### DESIGN REPORT');
  if (reportJson) {
    try { report = JSON.parse(reportJson); } catch { /* use empty */ }
  }

  return { toml, report, rawResponse: response };
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

async function designFromTextStreaming(description, onChunk) {
  const model = initGemini();

  const prompt = `${DESIGN_PROMPT}

Design a mechanism for: "${description}"

Generate a complete, valid TOML config with realistic dimensions, proper clearances, and material assignments.`;

  let response = await callGeminiStreaming(model, prompt, onChunk);

  let toml = extractTomlFromResponse(response);
  if (toml) {
    const validation = validateTomlStructure(toml);
    if (!validation.valid) {
      // Retry with error feedback (non-streaming — retry is fast)
      const retryPrompt = `${prompt}

Your previous TOML had parse errors:
${validation.errors.join('\n')}

Please fix and regenerate with the same two sections.`;
      response = await callGeminiWithRetry(model, retryPrompt, 1);
      toml = extractTomlFromResponse(response);
    }
  }

  let report = {};
  const reportJson = extractJsonFromResponse(response, '### DESIGN REPORT');
  if (reportJson) {
    try { report = JSON.parse(reportJson); } catch { /* use empty */ }
  }

  return { toml, report, rawResponse: response };
}

// Export for programmatic use
export { reviewToml, designFromText, designFromTextStreaming, validateTomlStructure, extractTomlFromResponse, extractJsonFromResponse };

// Only run CLI when executed directly (not when imported)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
