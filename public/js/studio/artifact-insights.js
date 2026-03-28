const TEXT_CONTENT_TYPES = [
  'application/json',
  'application/toml',
  'application/xml',
  'application/yaml',
  'image/svg+xml',
  'text/',
];

function includesAny(haystack, needles = []) {
  return needles.some((needle) => haystack.includes(needle));
}

function toSearchString(artifact = {}) {
  return [
    artifact.type,
    artifact.key,
    artifact.file_name,
    artifact.path,
    artifact.extension,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function shortJobId(id = '') {
  return id.length > 8 ? id.slice(0, 8) : id || 'unknown';
}

export function formatDateTime(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatJobStatus(status) {
  return String(status || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return 'Unknown size';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function classifyArtifact(artifact = {}) {
  const search = toSearchString(artifact);
  const extension = String(artifact.extension || '').toLowerCase();

  if (includesAny(search, ['readiness'])) return { badge: 'readiness', tone: 'ok' };
  if (includesAny(search, ['review-pack', 'product_review', 'quality_risk', 'investment_review', 'process_plan', 'line_plan'])) {
    return { badge: 'report', tone: 'warn' };
  }
  if (extension === '.svg') return { badge: 'svg', tone: 'info' };
  if (extension === '.csv') return { badge: 'csv', tone: 'info' };
  if (extension === '.dxf') return { badge: 'dxf', tone: 'warn' };
  if (extension === '.pdf') return { badge: 'pdf', tone: 'info' };
  if (extension === '.json') return { badge: 'json', tone: 'info' };
  if (extension === '.md' || extension === '.markdown') return { badge: 'markdown', tone: 'info' };
  if (includesAny(search, ['report'])) return { badge: 'report', tone: 'info' };
  if (includesAny(search, ['model', '.step', '.stl', '.obj', '.fcstd'])) return { badge: 'model', tone: 'warn' };
  return { badge: extension.replace(/^\./, '') || 'artifact', tone: 'info' };
}

export function canPreviewAsText(artifact = {}) {
  const contentType = String(artifact.content_type || '').toLowerCase();
  if (!artifact.capabilities?.can_open) return false;
  if (contentType === 'application/pdf' || contentType === 'application/octet-stream') return false;
  return TEXT_CONTENT_TYPES.some((entry) => contentType.startsWith(entry));
}

export async function fetchArtifactText(artifact, maxChars = 16000) {
  if (!artifact?.links?.open || !canPreviewAsText(artifact)) {
    return null;
  }
  const response = await fetch(artifact.links.open, {
    headers: {
      accept: 'text/plain, application/json, text/markdown, text/csv, image/svg+xml',
    },
  });
  if (!response.ok) {
    throw new Error(`${artifact.file_name || artifact.key} returned ${response.status}`);
  }
  const text = await response.text();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n…truncated for the studio preview…` : text;
}

export function parseArtifactPayload(artifact, rawText) {
  if (!rawText) return null;
  const contentType = String(artifact?.content_type || '').toLowerCase();
  const extension = String(artifact?.extension || '').toLowerCase();

  if (contentType.includes('json') || extension === '.json') {
    return JSON.parse(rawText);
  }

  return rawText;
}

export function findArtifact(artifacts = [], matchers = []) {
  return artifacts.find((artifact) => {
    const search = toSearchString(artifact);
    return matchers.some((matcher) => search.includes(String(matcher).toLowerCase()));
  }) || null;
}

function scoreTone(score, { good = 80, warn = 60 } = {}) {
  if (!Number.isFinite(score)) return 'info';
  if (score >= good) return 'ok';
  if (score >= warn) return 'warn';
  return 'bad';
}

function levelTone(level = '') {
  const normalized = String(level).toLowerCase();
  if (normalized === 'low' || normalized === 'ready' || normalized === 'go') return 'ok';
  if (normalized === 'medium' || normalized === 'warning' || normalized === 'candidate_for_pilot_line_review') return 'warn';
  if (normalized === 'high' || normalized === 'hold' || normalized === 'hold_before_line_commitment') return 'bad';
  return 'info';
}

function summarizeList(items = [], fallback = 'No key points were captured in this output.') {
  return Array.isArray(items) && items.length > 0 ? items.slice(0, 3).join(' • ') : fallback;
}

function manifestNotes(manifest = null, artifact = null) {
  if (!manifest) return [];
  const notes = [];
  if (manifest.command) notes.push(`Command: ${manifest.command}`);
  if (manifest.git_commit) notes.push(`Git commit: ${String(manifest.git_commit).slice(0, 12)}`);
  if (manifest.config_path) notes.push(`Config: ${manifest.config_path}`);
  if (Array.isArray(manifest.warnings) && manifest.warnings.length > 0) {
    notes.push(`Warnings: ${manifest.warnings.slice(0, 2).join(' | ')}`);
  }
  if (Array.isArray(manifest.deprecations) && manifest.deprecations.length > 0) {
    notes.push(`Deprecations: ${manifest.deprecations.slice(0, 2).join(' | ')}`);
  }
  if (artifact?.scope) notes.push(`Scope: ${artifact.scope}`);
  if (artifact?.stability) notes.push(`Stability: ${artifact.stability}`);
  return notes;
}

function buildCard({
  id,
  title,
  tone = 'info',
  score = null,
  status = 'Not available',
  summary,
  artifact = null,
  normalized = [],
  raw = null,
  empty = false,
  provenance = [],
}) {
  return {
    id,
    title,
    tone,
    score,
    status,
    summary,
    artifact,
    normalized,
    raw,
    empty,
    provenance,
  };
}

export function buildReviewCards({ activeJob, artifacts = [], sourceMap = {} }) {
  const manifest = activeJob?.manifest || null;
  const readinessArtifact = findArtifact(artifacts, ['readiness']);
  const readiness = sourceMap.readiness;
  const productReviewArtifact = readinessArtifact || findArtifact(artifacts, ['product_review', 'review.product']);
  const qualityArtifact = readinessArtifact || findArtifact(artifacts, ['quality_risk', 'review.quality-risk']);
  const investmentArtifact = readinessArtifact || findArtifact(artifacts, ['investment_review', 'review.investment-review']);
  const standardDocsArtifact = findArtifact(artifacts, ['standard_docs_manifest', 'standard-docs.summary']);
  const reviewPackArtifact = findArtifact(artifacts, ['review-pack', 'process_plan', 'line_plan', 'drawing.qa-report']);

  const productReview = readiness?.product_review || sourceMap.productReview;
  const qualityRisk = readiness?.quality_risk || sourceMap.qualityRisk;
  const investmentReview = readiness?.investment_review || sourceMap.investmentReview;
  const standardDocs = sourceMap.standardDocs;
  const reviewPack = sourceMap.reviewPack;

  const cards = [
    productReview
      ? buildCard({
          id: 'dfm',
          title: 'DFM risk',
          tone: scoreTone(productReview.summary?.dfm_score, { good: 82, warn: 68 }),
          score: productReview.summary?.dfm_score ?? null,
          status: productReview.summary?.overall_risk_level || 'Heuristic review available',
          summary: summarizeList(productReview.summary?.top_issues || productReview.summary?.primary_risks),
          artifact: productReviewArtifact,
          normalized: [
            ['Part type', productReview.summary?.part_type || 'Unknown'],
            ['Overall risk', productReview.summary?.overall_risk_level || 'Unknown'],
            ['Recommended action', (productReview.summary?.recommended_actions || [])[0] || 'No explicit action listed'],
          ],
          raw: sourceMap.productReviewRaw || sourceMap.readinessRaw,
          provenance: manifestNotes(manifest, productReviewArtifact),
        })
      : buildCard({
          id: 'dfm',
          title: 'DFM risk',
          tone: 'info',
          status: 'Missing',
          summary: 'No manufacturability review artifact is attached to the selected job yet.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    qualityRisk
      ? buildCard({
          id: 'quality',
          title: 'Quality risk',
          tone: levelTone(qualityRisk.summary?.overall_risk_level),
          score: Array.isArray(qualityRisk.critical_dimensions) ? qualityRisk.critical_dimensions.length : null,
          status: qualityRisk.summary?.overall_risk_level || 'Quality review available',
          summary: summarizeList(qualityRisk.summary?.top_issues),
          artifact: qualityArtifact,
          normalized: [
            ['Critical dimensions', String((qualityRisk.critical_dimensions || []).length)],
            ['Quality gates', String((qualityRisk.quality_gates || []).length)],
            ['Traceability focus', summarizeList(qualityRisk.summary?.traceability_focus, 'Not provided')],
          ],
          raw: sourceMap.qualityRiskRaw || sourceMap.readinessRaw,
          provenance: manifestNotes(manifest, qualityArtifact),
        })
      : buildCard({
          id: 'quality',
          title: 'Quality risk',
          tone: 'info',
          status: 'Missing',
          summary: 'No quality-risk or traceability output is available for this job.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    investmentReview
      ? buildCard({
          id: 'investment',
          title: 'Investment / cost review',
          tone: levelTone(investmentReview.summary?.investment_pressure),
          score: investmentReview.cost_breakdown?.unit_cost ?? null,
          status: investmentReview.summary?.investment_pressure || 'Cost screen available',
          summary: summarizeList(investmentReview.summary?.top_cost_drivers),
          artifact: investmentArtifact,
          normalized: [
            ['Unit cost', investmentReview.cost_breakdown?.unit_cost ?? 'n/a'],
            ['Total cost', investmentReview.cost_breakdown?.total_cost ?? 'n/a'],
            ['Pressure', investmentReview.summary?.investment_pressure || 'Unknown'],
          ],
          raw: sourceMap.investmentReviewRaw || sourceMap.readinessRaw,
          provenance: manifestNotes(manifest, investmentArtifact),
        })
      : buildCard({
          id: 'investment',
          title: 'Investment / cost review',
          tone: 'info',
          status: 'Missing',
          summary: 'No investment or cost review artifact is attached to this job.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    readiness
      ? buildCard({
          id: 'readiness',
          title: 'Readiness summary',
          tone: scoreTone(readiness.readiness_summary?.score, { good: 78, warn: 65 }),
          score: readiness.readiness_summary?.score ?? null,
          status: readiness.readiness_summary?.status || readiness.readiness_summary?.gate_decision || 'Readiness available',
          summary: summarizeList(readiness.summary?.recommended_actions || readiness.decision_summary?.next_actions),
          artifact: readinessArtifact,
          normalized: [
            ['Gate', readiness.readiness_summary?.gate_decision || 'Unknown'],
            ['Risk level', readiness.summary?.overall_risk_level || 'Unknown'],
            ['Hold points', String((readiness.decision_summary?.hold_points || []).length)],
          ],
          raw: sourceMap.readinessRaw || sourceMap.readinessMarkdownRaw,
          provenance: manifestNotes(manifest, readinessArtifact),
        })
      : buildCard({
          id: 'readiness',
          title: 'Readiness summary',
          tone: 'info',
          status: 'Missing',
          summary: 'No readiness report is attached to the selected job yet.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    standardDocs
      ? buildCard({
          id: 'standard-docs',
          title: 'Standard docs status',
          tone: (standardDocs.documents || []).length >= 4 ? 'ok' : 'warn',
          score: (standardDocs.documents || []).length,
          status: `${(standardDocs.documents || []).length} docs found`,
          summary: summarizeList((standardDocs.documents || []).map((doc) => doc.filename)),
          artifact: standardDocsArtifact,
          normalized: [
            ['Generated at', standardDocs.generated_at || 'Unknown'],
            ['Draft notice', standardDocs.draft_notice || 'Not provided'],
            ['Docs', String((standardDocs.documents || []).length)],
          ],
          raw: sourceMap.standardDocsRaw,
          provenance: manifestNotes(manifest, standardDocsArtifact),
        })
      : buildCard({
          id: 'standard-docs',
          title: 'Standard docs status',
          tone: 'info',
          status: 'Missing',
          summary: 'No standard-doc manifest or draft document set is available for this job.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
    reviewPack || reviewPackArtifact
      ? buildCard({
          id: 'review-outputs',
          title: 'Design review outputs',
          tone: 'warn',
          status: reviewPack ? 'Review pack available' : 'Artifact set available',
          summary: reviewPack
            ? summarizeList(reviewPack.summary?.top_issues || reviewPack.executive_summary?.top_issues)
            : 'Supplemental review artifacts are attached and ready to inspect.',
          artifact: reviewPackArtifact,
          normalized: reviewPack
            ? [
                ['Summary', reviewPack.summary?.overall_risk_level || 'Available'],
                ['Open items', String((reviewPack.issues || []).length)],
                ['Recommendation', (reviewPack.summary?.recommended_actions || [])[0] || 'No explicit recommendation listed'],
              ]
            : [
                ['Artifact', reviewPackArtifact.file_name || reviewPackArtifact.key],
                ['Type', reviewPackArtifact.type || 'review output'],
                ['Status', reviewPackArtifact.exists ? 'Available' : 'Missing'],
              ],
          raw: sourceMap.reviewPackRaw || null,
          provenance: manifestNotes(manifest, reviewPackArtifact),
        })
      : buildCard({
          id: 'review-outputs',
          title: 'Design review outputs',
          tone: 'info',
          status: 'Missing',
          summary: 'No review-pack, process-plan, line-plan, or design-review sidecar is available yet.',
          empty: true,
          provenance: manifestNotes(manifest),
        }),
  ];

  return cards;
}
