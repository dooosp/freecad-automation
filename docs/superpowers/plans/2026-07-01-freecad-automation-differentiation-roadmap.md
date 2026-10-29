# FreeCAD Automation Differentiation Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the project's current differentiators into stronger product features: standards-adjacent inspection intake, evidence graphs, richer drawing semantics, Studio decision guidance, and runtime reproducibility.

**Architecture:** Keep FreeCAD as the runtime CAD kernel and keep JSON artifacts as the source of truth. Add features through additive schemas, services, CLI commands, tracked job artifacts, and Studio views without weakening existing readiness gates or treating generated artifacts as inspection evidence.

**Tech Stack:** Node.js ESM CLI/services, Python 3 adapters, FreeCAD runtime-backed commands, JSON Schema draft 2020-12, browser Studio JavaScript, existing `node --test` style test files, existing Python pytest lane.

---

## Baseline And Branch Safety

Preflight evidence recorded when this plan was drafted, from the `freecad-automation` repository root (`.`):

- Repo root: `freecad-automation` (`.`)
- Branch: `codex/mega-studio-api-contract-fuzz-audit`
- HEAD: `2b9c4215eceb23a9d013f48e5e47e8676fbef8ee`
- Default branch: `origin/master`
- Worktree status: clean, but upstream tracking branch is gone after PR #169 cleanup

Implementation should start from a fresh worktree based on `origin/master`, because the current checkout is a merged feature branch with a stale upstream.

Run the following from the repository root; the new worktree location is relative to that root.

```bash
git fetch origin
git worktree add ../freecad-automation-worktrees/differentiation-roadmap/freecad-automation -b codex/freecad-differentiation-roadmap origin/master
cd ../freecad-automation-worktrees/differentiation-roadmap/freecad-automation
npm ci
npm test
```

Expected baseline: `npm test` passes before any implementation begins.

## Differentiator Analysis

### 1. CAD-as-code tools create geometry; this repo packages engineering review evidence

CadQuery, build123d, and OpenSCAD are strongest at creating parametric geometry. `freecad-automation` is different because its public value is not only "make a part"; it is "make a part, draw it, inspect it, run DFM/FEM/tolerance/reporting, package artifacts, and keep readiness honest."

Technical implication: strengthen artifact linkage and product evidence graphs instead of adding another modeling DSL.

### 2. FreeCAD-Make exports FreeCAD artifacts; this repo judges and traces them

FreeCAD-Make is close in the export automation space: STEP and TechDraw export from FreeCAD projects. This repo already goes further with output manifests, drawing quality, create quality, readiness reports, and Studio.

Technical implication: improve reproducibility metadata and artifact graph navigation.

### 3. QIF and digital thread literature emphasize traceable inspection data; this repo already has conservative evidence gates

The Stage 5B chain is a major differentiator. It refuses generated artifacts, fixtures, release bundles, CI metadata, and docs as inspection evidence.

Technical implication: add a standards-adjacent adapter for inspection sources while preserving fail-closed readiness behavior.

### 4. Commercial CAD automation often targets sales/CPQ; this repo targets engineering review and readiness

Tacton-style CAD automation focuses on configured products and quote/sales speed. This repo should avoid CPQ imitation and instead become a trustworthy review cockpit for engineers and maintainers.

Technical implication: Studio should show "why held", "what evidence is trusted", "what exact safe command comes next", and "what would mutate canonical artifacts" without offering unsafe shortcuts.

### 5. MBD/digital thread systems need authoritative data; this repo has JSON contracts but needs a graph view

The repo has many useful JSON artifacts, but users need one graph that answers: which source produced which model/drawing/report/readiness result, what evidence class each artifact belongs to, and whether any artifact can change readiness.

Technical implication: add a read-only evidence graph artifact generated from existing manifests, review packs, readiness reports, and Stage 5B outputs.

## File Structure Map

Create:

- `schemas/qif-lite-inspection-adapter-report.schema.json`: contract for XML-to-inspection-evidence adapter output.
- `scripts/adapters/load_qif_lite_inspection.py`: Python XML adapter using `xml.etree.ElementTree`.
- `src/services/inspection-evidence-intake/qif-lite-adapter-service.js`: Node wrapper for the Python adapter.
- `tests/test_qif_lite_inspection_adapter.py`: Python unit tests for XML parsing.
- `tests/qif-lite-inspection-adapter.test.js`: Node service and schema tests.
- `schemas/evidence-graph.schema.json`: canonical graph contract for reviewable artifact provenance.
- `src/services/evidence-graph/evidence-graph-service.js`: graph builder from package artifacts and manifests.
- `tests/evidence-graph.test.js`: graph contract tests.
- `public/js/studio/evidence-graph-panel.js`: Studio renderer for graph summaries.
- `tests/studio-evidence-graph-panel.test.js`: browserless renderer tests.
- `schemas/runtime-fingerprint.schema.json`: machine/environment reproducibility contract.
- `src/services/runtime/runtime-fingerprint-service.js`: runtime fingerprint builder.
- `tests/runtime-fingerprint.test.js`: fingerprint contract tests.

Modify:

- `bin/fcad.js`: add `qif-lite-inspection-adapter`, `evidence-graph`, and optional `check-runtime --fingerprint-out`.
- `src/shared/command-manifest.js`: expose new command help and runtime classification.
- `src/services/inspection-evidence-intake/inspection-evidence-intake-service.js`: allow local `.xml` QIF-lite candidates through the adapter only when explicitly requested or when under allowed evidence paths.
- `src/services/jobs/execution/stage5b-handlers.js`: register graph/fingerprint artifacts only as review/control artifacts.
- `src/services/jobs/execution/handler-registry.js`: keep registry in sync with command manifest.
- `src/server/local-api-server.js`: expose evidence graph preview through existing safe tracked/canonical artifact routes, not arbitrary file paths.
- `public/js/studio/review-workspace.js`: include the evidence graph panel.
- `tests/lane-manifest.js`: add tests to the hosted-safe contract lane.
- `docs/inspection-evidence-contract.md`: document QIF-lite import boundaries.
- `docs/studio-first-user-walkthrough.md`: document evidence graph review behavior.

## Task 1: QIF-Lite Inspection XML Adapter

**Files:**

- Create: `schemas/qif-lite-inspection-adapter-report.schema.json`
- Create: `scripts/adapters/load_qif_lite_inspection.py`
- Create: `src/services/inspection-evidence-intake/qif-lite-adapter-service.js`
- Create: `tests/test_qif_lite_inspection_adapter.py`
- Create: `tests/qif-lite-inspection-adapter.test.js`
- Modify: `src/services/inspection-evidence-intake/inspection-evidence-intake-service.js`
- Modify: `tests/lane-manifest.js`

- [ ] **Step 1: Write the Python adapter test**

```python
# tests/test_qif_lite_inspection_adapter.py
from pathlib import Path
from scripts.adapters.load_qif_lite_inspection import parse_qif_lite_xml


def test_parse_qif_lite_xml_maps_measured_features(tmp_path):
    xml_path = tmp_path / "supplier-qif-lite.xml"
    xml_path.write_text(
        """<?xml version="1.0"?>
<QIFDocument>
  <Inspection>
    <PackageId>quality-pass-bracket</PackageId>
    <InspectedPart>quality_pass_bracket_rev_a</InspectedPart>
    <InspectedAt>2026-07-01T09:00:00Z</InspectedAt>
    <SourceType>supplier_inspection_report</SourceType>
    <OverallResult>pass</OverallResult>
    <Inspector>Supplier QA</Inspector>
    <ReviewedBy>Incoming QA</ReviewedBy>
    <PartRevision>A</PartRevision>
    <Units>mm</Units>
    <Feature>
      <FeatureId>MOUNTING_HOLE_DIA</FeatureId>
      <NominalValue>6.0</NominalValue>
      <MeasuredValue>6.01</MeasuredValue>
      <ToleranceLower>-0.05</ToleranceLower>
      <ToleranceUpper>0.05</ToleranceUpper>
      <Result>pass</Result>
      <MeasurementMethod>CMM</MeasurementMethod>
    </Feature>
  </Inspection>
</QIFDocument>
""",
        encoding="utf-8",
    )

    report = parse_qif_lite_xml(xml_path, source_ref="docs/examples/quality-pass-bracket/inspection/supplier-qif-lite.xml")

    assert report["schema_version"] == "1.0"
    assert report["adapter"] == "qif-lite"
    assert report["inspection_evidence"]["evidence_type"] == "inspection_evidence"
    assert report["inspection_evidence"]["package_id"] == "quality-pass-bracket"
    assert report["inspection_evidence"]["overall_result"] == "pass"
    assert report["inspection_evidence"]["measured_features"][0]["feature_id"] == "MOUNTING_HOLE_DIA"
    assert report["classification"]["attachment_ready_candidate"] is True
```

- [ ] **Step 2: Implement the Python adapter**

```python
# scripts/adapters/load_qif_lite_inspection.py
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def _text(parent: ET.Element, tag: str, default: str | None = None) -> str | None:
    node = parent.find(f".//{tag}")
    if node is None or node.text is None:
        return default
    value = node.text.strip()
    return value if value else default


def _number(value: str | None):
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return value


def parse_qif_lite_xml(path: Path, source_ref: str) -> dict:
    root = ET.parse(path).getroot()
    inspection = root.find(".//Inspection")
    if inspection is None:
        return {
            "schema_version": "1.0",
            "adapter": "qif-lite",
            "source_ref": source_ref,
            "classification": {
                "attachment_ready_candidate": False,
                "rejection_reasons": ["missing_inspection_node"],
            },
            "inspection_evidence": None,
        }

    features = []
    for feature in inspection.findall(".//Feature"):
        features.append({
            "feature_id": _text(feature, "FeatureId", "unknown_feature"),
            "nominal_value": _number(_text(feature, "NominalValue")),
            "measured_value": _number(_text(feature, "MeasuredValue")),
            "tolerance_lower": _number(_text(feature, "ToleranceLower")),
            "tolerance_upper": _number(_text(feature, "ToleranceUpper")),
            "result": (_text(feature, "Result", "unknown") or "unknown").lower(),
            "measurement_method": _text(feature, "MeasurementMethod", "unknown"),
        })

    evidence = {
        "schema_version": "1.0",
        "evidence_type": "inspection_evidence",
        "source_type": _text(inspection, "SourceType", "other_inspection_source"),
        "package_id": _text(inspection, "PackageId"),
        "inspected_part": _text(inspection, "InspectedPart"),
        "inspected_at": _text(inspection, "InspectedAt"),
        "inspector": _text(inspection, "Inspector"),
        "reviewed_by": _text(inspection, "ReviewedBy"),
        "part_revision": _text(inspection, "PartRevision"),
        "units": _text(inspection, "Units", "unknown"),
        "measurement_system": "metric" if _text(inspection, "Units", "").lower() == "mm" else "unknown",
        "overall_result": (_text(inspection, "OverallResult", "unknown") or "unknown").lower(),
        "source_ref": source_ref,
        "measured_features": features,
    }
    rejection_reasons = []
    if not features:
        rejection_reasons.append("missing_measured_features")
    if evidence["overall_result"] not in {"pass", "fail", "partial"}:
        rejection_reasons.append("overall_result_not_final")
    return {
        "schema_version": "1.0",
        "adapter": "qif-lite",
        "source_ref": source_ref,
        "classification": {
            "attachment_ready_candidate": len(rejection_reasons) == 0,
            "rejection_reasons": rejection_reasons,
        },
        "inspection_evidence": evidence,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--source-ref", required=True)
    args = parser.parse_args(argv)
    report = parse_qif_lite_xml(Path(args.input), args.source_ref)
    json.dump(report, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Add the Node wrapper test**

```js
// tests/qif-lite-inspection-adapter.test.js
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { adaptQifLiteInspectionXml } from '../src/services/inspection-evidence-intake/qif-lite-adapter-service.js';

test('adaptQifLiteInspectionXml returns inspection evidence shaped payload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fcad-qif-lite-'));
  const input = join(dir, 'supplier.xml');
  await writeFile(input, '<QIFDocument><Inspection><PackageId>quality-pass-bracket</PackageId><InspectedPart>part-a</InspectedPart><InspectedAt>2026-07-01T09:00:00Z</InspectedAt><SourceType>supplier_inspection_report</SourceType><OverallResult>pass</OverallResult><Units>mm</Units><Feature><FeatureId>HOLE_DIA</FeatureId><MeasuredValue>6.01</MeasuredValue><Result>pass</Result><MeasurementMethod>CMM</MeasurementMethod></Feature></Inspection></QIFDocument>');

  const report = await adaptQifLiteInspectionXml({
    inputPath: input,
    sourceRef: 'docs/examples/quality-pass-bracket/inspection/supplier.xml',
  });

  assert.equal(report.adapter, 'qif-lite');
  assert.equal(report.inspection_evidence.package_id, 'quality-pass-bracket');
  assert.equal(report.classification.attachment_ready_candidate, true);
});
```

- [ ] **Step 4: Implement the Node wrapper**

```js
// src/services/inspection-evidence-intake/qif-lite-adapter-service.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function adaptQifLiteInspectionXml({ inputPath, sourceRef, python = 'python3' } = {}) {
  if (!inputPath) throw new Error('inputPath is required');
  if (!sourceRef) throw new Error('sourceRef is required');
  const { stdout } = await execFileAsync(python, [
    'scripts/adapters/load_qif_lite_inspection.py',
    '--input',
    inputPath,
    '--source-ref',
    sourceRef,
  ], {
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}
```

- [ ] **Step 5: Run focused tests**

```bash
node scripts/run-pytest.js -q tests/test_qif_lite_inspection_adapter.py
node --test tests/qif-lite-inspection-adapter.test.js
```

Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add schemas/qif-lite-inspection-adapter-report.schema.json scripts/adapters/load_qif_lite_inspection.py src/services/inspection-evidence-intake/qif-lite-adapter-service.js tests/test_qif_lite_inspection_adapter.py tests/qif-lite-inspection-adapter.test.js tests/lane-manifest.js
git commit -m "feat: add qif-lite inspection adapter"
```

## Task 2: Evidence Graph Artifact

**Files:**

- Create: `schemas/evidence-graph.schema.json`
- Create: `src/services/evidence-graph/evidence-graph-service.js`
- Create: `tests/evidence-graph.test.js`
- Modify: `bin/fcad.js`
- Modify: `src/shared/command-manifest.js`
- Modify: `tests/command-manifest.test.js`
- Modify: `tests/lane-manifest.js`

- [ ] **Step 1: Write the graph test**

```js
// tests/evidence-graph.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEvidenceGraph } from '../src/services/evidence-graph/evidence-graph-service.js';

test('buildEvidenceGraph keeps inspection evidence distinct from review artifacts', () => {
  const graph = buildEvidenceGraph({
    packageId: 'quality-pass-bracket',
    reviewPack: {
      evidence_ledger: {
        records: [
          { evidence_id: 'q1', type: 'drawing_quality_report', source_ref: 'docs/examples/quality-pass-bracket/quality/drawing_quality.json', inspection_evidence: false },
          { evidence_id: 'i1', type: 'inspection_evidence', artifact_type: 'inspection_evidence', category: 'inspection_evidence', classifications: ['inspection_evidence'], source_ref: 'docs/examples/quality-pass-bracket/inspection/inspection_evidence.json', sha256: 'a'.repeat(64), inspection_evidence: true },
        ],
      },
      source_artifact_refs: [
        { artifact_type: 'inspection_evidence', role: 'evidence', path: 'docs/examples/quality-pass-bracket/inspection/inspection_evidence.json' },
      ],
    },
    readinessReport: {
      status: 'needs_more_evidence',
      gate_decision: 'hold_for_evidence_completion',
      missing_inputs: ['inspection_evidence'],
    },
  });

  assert.equal(graph.schema_version, '1.0');
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.summary.inspection_evidence_record_count, 1);
  assert.equal(graph.summary.generated_artifact_count, 1);
  assert.equal(graph.summary.readiness_gate_decision, 'hold_for_evidence_completion');
});
```

- [ ] **Step 2: Implement the graph builder**

```js
// src/services/evidence-graph/evidence-graph-service.js
function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function node(id, kind, label, metadata = {}) {
  return { id, kind, label, metadata };
}

export function buildEvidenceGraph({ packageId, reviewPack = {}, readinessReport = {} } = {}) {
  const records = safeList(reviewPack?.evidence_ledger?.records);
  const nodes = [
    node(`package:${packageId}`, 'package', packageId, { package_id: packageId }),
  ];
  const edges = [];

  for (const record of records) {
    const isInspection = record?.inspection_evidence === true && record?.type === 'inspection_evidence';
    const id = `artifact:${record.evidence_id || record.source_ref || nodes.length}`;
    nodes.push(node(id, isInspection ? 'inspection_evidence' : 'review_artifact', record.type || 'artifact', {
      source_ref: record.source_ref || null,
      artifact_type: record.artifact_type || record.type || null,
      inspection_evidence: isInspection,
    }));
    edges.push({
      from: `package:${packageId}`,
      to: id,
      relation: isInspection ? 'has_authorized_inspection_evidence' : 'has_review_artifact',
    });
  }

  nodes.push(node(`readiness:${packageId}`, 'readiness_report', readinessReport.status || 'unknown', {
    status: readinessReport.status || null,
    gate_decision: readinessReport.gate_decision || null,
    missing_inputs: safeList(readinessReport.missing_inputs),
  }));
  edges.push({ from: `package:${packageId}`, to: `readiness:${packageId}`, relation: 'has_readiness_report' });

  return {
    schema_version: '1.0',
    package_id: packageId,
    summary: {
      node_count: nodes.length,
      edge_count: edges.length,
      inspection_evidence_record_count: nodes.filter((entry) => entry.kind === 'inspection_evidence').length,
      generated_artifact_count: nodes.filter((entry) => entry.kind === 'review_artifact').length,
      readiness_gate_decision: readinessReport.gate_decision || null,
      readiness_status: readinessReport.status || null,
    },
    nodes,
    edges,
  };
}
```

- [ ] **Step 3: Add CLI command**

Add `evidence-graph` to `src/shared/command-manifest.js` as a plain Node command:

```js
Object.freeze({
  name: 'evidence-graph',
  helpSection: 'plain-python-node',
  helpEntries: Object.freeze([
    Object.freeze({
      usage: 'fcad evidence-graph --package <slug> --review-pack <review_pack.json> --readiness <readiness_report.json> --out <evidence_graph.json>',
      summary: 'Build a read-only artifact/evidence/readiness graph for a package',
    }),
  ]),
  runtime: Object.freeze({
    classification: 'plain-python-node',
    requiresFreecadRuntime: false,
    note: 'Builds a graph from existing JSON artifacts; does not attach evidence or change readiness.',
  }),
})
```

- [ ] **Step 4: Run focused tests**

```bash
node --test tests/evidence-graph.test.js tests/command-manifest.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add schemas/evidence-graph.schema.json src/services/evidence-graph/evidence-graph-service.js tests/evidence-graph.test.js bin/fcad.js src/shared/command-manifest.js tests/command-manifest.test.js tests/lane-manifest.js
git commit -m "feat: add evidence graph artifact"
```

## Task 3: Drawing Semantics V2 Alias Catalog

**Files:**

- Create: `lib/drawing-semantic-aliases.js`
- Modify: `src/services/drawing/extracted-drawing-semantics.js`
- Modify: `src/services/drawing/drawing-quality-summary.js`
- Modify: `tests/extracted-drawing-semantics.test.js`
- Modify: `tests/drawing-semantic-regression.test.js`

- [ ] **Step 1: Add alias catalog tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { aliasesForSemanticId, normalizeSemanticToken } from '../lib/drawing-semantic-aliases.js';

test('drawing semantic aliases normalize hole diameter variants', () => {
  assert.equal(normalizeSemanticToken('HOLE DIA'), 'holedia');
  assert.ok(aliasesForSemanticId('HOLE_DIA').includes('holedia'));
  assert.ok(aliasesForSemanticId('HOLE_DIA').includes('diameter'));
});
```

- [ ] **Step 2: Implement alias catalog**

```js
// lib/drawing-semantic-aliases.js
const ALIASES = Object.freeze({
  HOLE_DIA: Object.freeze(['hole dia', 'hole diameter', 'diameter', 'dia', 'ø']),
  MOUNTING_HOLE_DIA: Object.freeze(['mounting hole dia', 'mounting hole diameter', 'hole dia', 'ø']),
  BASE_PLATE_ENVELOPE: Object.freeze(['base plate envelope', 'overall size', 'length width', 'l x w']),
  MATERIAL: Object.freeze(['material', 'matl']),
  GENERAL_TOLERANCE: Object.freeze(['general tolerance', 'tolerance', 'tol']),
});

export function normalizeSemanticToken(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9ø]+/g, '');
}

export function aliasesForSemanticId(id = '') {
  const explicit = ALIASES[id] || [];
  return [...new Set([id, ...explicit].map(normalizeSemanticToken).filter(Boolean))];
}
```

- [ ] **Step 3: Wire aliases into extracted semantics matching**

In `src/services/drawing/extracted-drawing-semantics.js`, import the helpers and use them inside requirement matching so explicit aliases can increase confidence without creating confirmed evidence from unsupported text.

```js
import { aliasesForSemanticId, normalizeSemanticToken } from '../../../lib/drawing-semantic-aliases.js';

function semanticTextMatchesRequirement(text, requirement = {}) {
  const normalizedText = normalizeSemanticToken(text);
  const aliases = aliasesForSemanticId(requirement.id || requirement.label || requirement.text);
  return aliases.some((alias) => alias && normalizedText.includes(alias));
}
```

Call `semanticTextMatchesRequirement` only in existing matching branches that already require SVG text evidence.

- [ ] **Step 4: Run focused tests**

```bash
node --test tests/extracted-drawing-semantics.test.js tests/drawing-semantic-regression.test.js tests/drawing-quality-summary.test.js
```

Expected: pass. Existing unknown/unsupported fixture behavior must remain conservative.

- [ ] **Step 5: Commit**

```bash
git add lib/drawing-semantic-aliases.js src/services/drawing/extracted-drawing-semantics.js src/services/drawing/drawing-quality-summary.js tests/extracted-drawing-semantics.test.js tests/drawing-semantic-regression.test.js
git commit -m "feat: add deterministic drawing semantic aliases"
```

## Task 4: Studio Evidence Decision Panel

**Files:**

- Create: `public/js/studio/evidence-graph-panel.js`
- Create: `tests/studio-evidence-graph-panel.test.js`
- Modify: `public/js/studio/review-workspace.js`
- Modify: `public/js/studio/artifact-insights.js`
- Modify: `tests/studio-inspection-evidence-intake-ux.test.js`
- Modify: `tests/studio-shell-browser-smoke.test.js`

- [ ] **Step 1: Write renderer test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderEvidenceGraphSummary } from '../public/js/studio/evidence-graph-panel.js';

test('renderEvidenceGraphSummary shows readiness hold and exact evidence count', () => {
  const html = renderEvidenceGraphSummary({
    summary: {
      inspection_evidence_record_count: 0,
      generated_artifact_count: 5,
      readiness_gate_decision: 'hold_for_evidence_completion',
      readiness_status: 'needs_more_evidence',
    },
  });
  assert.match(html, /needs_more_evidence/);
  assert.match(html, /hold_for_evidence_completion/);
  assert.match(html, /Inspection evidence records: 0/);
});
```

- [ ] **Step 2: Implement renderer**

```js
// public/js/studio/evidence-graph-panel.js
function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderEvidenceGraphSummary(graph = {}) {
  const summary = graph.summary || {};
  return `
    <section class="studio-panel evidence-graph-panel" data-testid="evidence-graph-panel">
      <h2>Evidence graph</h2>
      <dl>
        <dt>Readiness</dt><dd>${escapeHtml(summary.readiness_status || 'unknown')}</dd>
        <dt>Gate</dt><dd>${escapeHtml(summary.readiness_gate_decision || 'unknown')}</dd>
        <dt>Inspection evidence records</dt><dd>${Number(summary.inspection_evidence_record_count || 0)}</dd>
        <dt>Review artifacts</dt><dd>${Number(summary.generated_artifact_count || 0)}</dd>
      </dl>
    </section>
  `;
}
```

- [ ] **Step 3: Run Studio tests**

```bash
node --test tests/studio-evidence-graph-panel.test.js tests/studio-inspection-evidence-intake-ux.test.js
npm run test:studio-browser-smoke
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add public/js/studio/evidence-graph-panel.js tests/studio-evidence-graph-panel.test.js public/js/studio/review-workspace.js public/js/studio/artifact-insights.js tests/studio-inspection-evidence-intake-ux.test.js tests/studio-shell-browser-smoke.test.js
git commit -m "feat: surface evidence graph in Studio"
```

## Task 5: Runtime Fingerprint

**Files:**

- Create: `schemas/runtime-fingerprint.schema.json`
- Create: `src/services/runtime/runtime-fingerprint-service.js`
- Create: `tests/runtime-fingerprint.test.js`
- Modify: `scripts/check-runtime.js`
- Modify: `src/shared/command-manifest.js`
- Modify: `docs/support-matrix.md`

- [ ] **Step 1: Write fingerprint test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuntimeFingerprint } from '../src/services/runtime/runtime-fingerprint-service.js';

test('buildRuntimeFingerprint records repo and runtime identity without production claims', () => {
  const fingerprint = buildRuntimeFingerprint({
    repo: { branch: 'master', head_sha: '8d2cd8d4186686bfa5ce0a78b909fc5852db22a3', dirty_at_start: false },
    runtime: { freecad_status: 'ready', freecad_version: '1.1.1', platform: 'darwin' },
    commands: ['create', 'draw', 'inspect'],
  });
  assert.equal(fingerprint.schema_version, '1.0');
  assert.equal(fingerprint.production_readiness_claim, false);
  assert.equal(fingerprint.runtime.freecad_version, '1.1.1');
});
```

- [ ] **Step 2: Implement fingerprint service**

```js
// src/services/runtime/runtime-fingerprint-service.js
export function buildRuntimeFingerprint({ repo = {}, runtime = {}, commands = [], generatedAt = new Date().toISOString() } = {}) {
  return {
    schema_version: '1.0',
    generated_at: generatedAt,
    repo: {
      branch: repo.branch || null,
      head_sha: repo.head_sha || null,
      dirty_at_start: repo.dirty_at_start === true,
    },
    runtime: {
      platform: runtime.platform || process.platform,
      freecad_status: runtime.freecad_status || null,
      freecad_version: runtime.freecad_version || null,
      freecad_executable_detected: runtime.freecad_executable_detected ?? null,
    },
    command_coverage: commands.map((name) => ({ command: name, covered: true })),
    production_readiness_claim: false,
    evidence_boundary: 'Runtime fingerprint proves local execution context only; it is not physical inspection evidence or production readiness proof.',
  };
}
```

- [ ] **Step 3: Add `check-runtime --fingerprint-out`**

In `scripts/check-runtime.js`, after diagnostics are built, write the fingerprint JSON only when the explicit option is present.

```js
if (options['fingerprint-out']) {
  const fingerprint = buildRuntimeFingerprint({
    repo: diagnostics.repo || {},
    runtime: diagnostics.runtime || diagnostics,
    commands: diagnostics.command_coverage?.map((entry) => entry.command) || [],
  });
  await writeFile(resolve(options['fingerprint-out']), `${JSON.stringify(fingerprint, null, 2)}\n`);
}
```

- [ ] **Step 4: Run focused tests**

```bash
node --test tests/runtime-fingerprint.test.js tests/check-runtime.test.js tests/command-manifest.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add schemas/runtime-fingerprint.schema.json src/services/runtime/runtime-fingerprint-service.js tests/runtime-fingerprint.test.js scripts/check-runtime.js src/shared/command-manifest.js docs/support-matrix.md
git commit -m "feat: add runtime fingerprint artifact"
```

## Task 6: Documentation, Lanes, And Final Verification

**Files:**

- Modify: `README.md`
- Modify: `docs/inspection-evidence-contract.md`
- Modify: `docs/studio-first-user-walkthrough.md`
- Modify: `docs/output-manifest.md`
- Modify: `docs/support-matrix.md`
- Modify: `tests/first-user-docs-smoke.test.js`
- Modify: `tests/source-of-truth-drift.test.js`

- [ ] **Step 1: Add documentation smoke assertions**

Update `tests/first-user-docs-smoke.test.js` to assert the docs contain:

```js
[
  'QIF-lite',
  'evidence graph',
  'Runtime fingerprint',
  'not inspection evidence',
  'does not clear production readiness',
]
```

- [ ] **Step 2: Update docs with exact boundaries**

Add these claims exactly once across the docs:

```markdown
QIF-lite import is a narrow adapter for inspection-shaped XML supplied by a real physical, supplier, lab, or QA inspection source. It is not a complete QIF implementation and does not make an XML file attachment-ready by itself.

The evidence graph is a read-only review artifact. It links package, review, generated quality, inspection, and readiness artifacts, but it does not attach evidence, regenerate readiness, or mutate canonical package files.

The runtime fingerprint records local execution context and FreeCAD/runtime capability. It is reproducibility evidence only; it is not physical inspection evidence and does not clear production readiness.
```

- [ ] **Step 3: Run hosted-safe verification**

```bash
npm run check:source-hygiene
npm run test:node:contract
npm run test:node:integration
npm run test:snapshots
npm run test:studio-browser-smoke
npm run test:py
git diff --check
```

Expected: all pass.

- [ ] **Step 4: Run runtime verification when FreeCAD is available**

```bash
node bin/fcad.js check-runtime
npm run test:runtime-smoke
```

Expected: pass only on a machine with a valid FreeCAD runtime. If unavailable, record "not run: FreeCAD runtime unavailable" and do not claim runtime validation.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/inspection-evidence-contract.md docs/studio-first-user-walkthrough.md docs/output-manifest.md docs/support-matrix.md tests/first-user-docs-smoke.test.js tests/source-of-truth-drift.test.js
git commit -m "docs: document differentiation roadmap features"
```

## Execution Order

Recommended order:

1. Task 1: QIF-lite inspection adapter
2. Task 2: Evidence graph artifact
3. Task 4: Studio evidence decision panel
4. Task 3: Drawing semantics aliases
5. Task 5: Runtime fingerprint
6. Task 6: Docs and final verification

Reason: Tasks 1 and 2 strengthen the strongest differentiator first: conservative evidence and digital-thread-style traceability. Studio then gets something useful to show. Drawing aliases and runtime fingerprint improve depth without changing the readiness policy.

## Validation Matrix

Always run after each task:

```bash
node --test <focused-test-files>
git diff --check
```

Run before PR:

```bash
npm run check:source-hygiene
npm test
npm run test:studio-browser-smoke
npm run test:py
```

Run only when a real FreeCAD runtime is available:

```bash
npm run test:runtime-smoke
```

## Self-Review Checklist

- Spec coverage: all differentiators map to at least one task.
- Placeholder scan: no unresolved placeholder markers, no vague "add validation" step without code, no unsafe production-readiness claim.
- Type consistency: graph uses `schema_version`, `summary`, `nodes`, `edges`; QIF-lite report uses `schema_version`, `adapter`, `source_ref`, `classification`, `inspection_evidence`; runtime fingerprint uses `schema_version`, `repo`, `runtime`, `command_coverage`, `production_readiness_claim`.
- Readiness boundary: no task clears `needs_more_evidence` or `hold_for_evidence_completion`; only genuine authorized inspection evidence can do that in a separate explicit task.
