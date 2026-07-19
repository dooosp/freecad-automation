const BEGINNER_REVIEW_CARD_IDS = new Set([
  'dfm',
  'quality',
  'investment',
]);

const ADVANCED_ARTIFACT_PATTERN = /(?:stage\s*5b|stage5b|readiness|evidence|inspection|manifest|runtime[._ -]fingerprint)/i;
const ATTENTION_TONES = new Set(['warn', 'bad', 'error']);

function preserveInitialCase(source, replacement) {
  if (!source || source[0] !== source[0].toUpperCase()) return replacement;
  return `${replacement[0].toUpperCase()}${replacement.slice(1)}`;
}

function replaceTerm(value, pattern, replacement) {
  return value.replace(pattern, (match) => preserveInitialCase(match, replacement));
}

export function sanitizeReviewSummaryText(value = '') {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  text = replaceTerm(text, /\bstage\s*5b\b/gi, 'detailed inspection');
  text = replaceTerm(text, /\btracked\b/gi, 'recorded');
  text = replaceTerm(text, /\bartifacts\b/gi, 'result files');
  text = replaceTerm(text, /\bartifact\b/gi, 'result file');
  text = replaceTerm(text, /\bmanifests\b/gi, 'file information');
  text = replaceTerm(text, /\bmanifest\b/gi, 'file information');
  text = replaceTerm(text, /\breadiness\b/gi, 'preparation');
  text = replaceTerm(text, /\bevidence\b/gi, 'inspection information');
  text = replaceTerm(text, /\bgates\b/gi, 'checks');
  text = replaceTerm(text, /\bgate\b/gi, 'check');
  return text;
}

export function isAdvancedReviewArtifact(artifact = {}) {
  const search = [
    artifact.type,
    artifact.key,
    artifact.label,
    artifact.file_name,
  ].filter(Boolean).join(' ');
  return ADVANCED_ARTIFACT_PATTERN.test(search);
}

function hasAttention(card = {}) {
  return !card.empty && ATTENTION_TONES.has(String(card.tone || '').toLowerCase());
}

function findRecommendedAction(cards = []) {
  for (const card of cards) {
    const field = (card.normalized || []).find(([label]) => /recommended action|recommendation/i.test(String(label || '')));
    if (field?.[1]) return sanitizeReviewSummaryText(field[1]);
  }
  return '';
}

function collectSupportingFiles(artifacts = []) {
  return artifacts
    .filter((artifact) => artifact?.exists !== false && !isAdvancedReviewArtifact(artifact))
    .map((artifact) => {
      const canOpen = Boolean(artifact.capabilities?.can_open && artifact.links?.open);
      const canDownload = Boolean(artifact.capabilities?.can_download && artifact.links?.download);
      const href = canOpen ? artifact.links.open : (canDownload ? artifact.links.download : '');
      if (!href) return null;
      return {
        id: String(artifact.id || artifact.key || artifact.file_name || ''),
        label: sanitizeReviewSummaryText(artifact.label || artifact.file_name || 'Supporting result file'),
        href,
        opensInNewWindow: canOpen,
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

export function buildReviewSummary({
  activeJob = null,
  reviewStatus = 'idle',
  cards = [],
} = {}) {
  if (!activeJob?.summary) {
    return {
      decision: 'choose_run',
      tone: 'info',
      issues: [],
      hasAdvancedIssues: false,
      nextStep: '',
      supportingFiles: [],
    };
  }

  const normalizedStatus = activeJob.status === 'loading'
    ? 'loading'
    : String(reviewStatus || 'idle').toLowerCase();
  if (normalizedStatus === 'loading' || normalizedStatus === 'idle' || normalizedStatus === 'error') {
    return {
      decision: normalizedStatus === 'error' ? 'unavailable' : 'preparing',
      tone: normalizedStatus === 'error' ? 'bad' : 'info',
      issues: [],
      hasAdvancedIssues: false,
      nextStep: '',
      supportingFiles: collectSupportingFiles(activeJob.artifacts || []),
    };
  }

  const populatedCards = cards.filter((card) => !card?.empty);
  const attentionCards = populatedCards.filter(hasAttention);
  const beginnerCards = populatedCards.filter((card) => BEGINNER_REVIEW_CARD_IDS.has(card.id));
  const beginnerAttentionCards = beginnerCards.filter(hasAttention);

  let decision = 'more_information';
  let tone = 'info';
  if (attentionCards.length > 0) {
    decision = 'needs_attention';
    tone = 'warn';
  } else if (populatedCards.length > 0) {
    decision = 'ready_for_review';
    tone = 'ok';
  }

  return {
    decision,
    tone,
    issues: beginnerAttentionCards
      .map((card) => sanitizeReviewSummaryText(card.summary))
      .filter(Boolean)
      .slice(0, 3),
    hasAdvancedIssues: attentionCards.some((card) => !BEGINNER_REVIEW_CARD_IDS.has(card.id)),
    nextStep: findRecommendedAction(beginnerAttentionCards),
    supportingFiles: collectSupportingFiles(activeJob.artifacts || []),
  };
}
