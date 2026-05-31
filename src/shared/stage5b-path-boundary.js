export const LOCAL_STAGE5B_CANDIDATE_EVIDENCE_INBOX = 'local/stage5b-candidate-evidence-inbox';

export function normalizeRepoRelativePathText(value) {
  return typeof value === 'string'
    ? value.trim().replaceAll('\\', '/').replace(/^\.\//, '')
    : '';
}

export function isLocalStage5bCandidateEvidenceInboxPath(value) {
  const normalized = normalizeRepoRelativePathText(value);
  return normalized === LOCAL_STAGE5B_CANDIDATE_EVIDENCE_INBOX
    || normalized.startsWith(`${LOCAL_STAGE5B_CANDIDATE_EVIDENCE_INBOX}/`);
}
