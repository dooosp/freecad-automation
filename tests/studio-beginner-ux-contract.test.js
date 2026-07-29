import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const html = read('public/studio.html');
const css = read('public/css/studio.css');
const renderers = read('public/js/studio/renderers.js');
const workspaces = read('public/js/studio/workspaces.js');
const modelWorkspace = read('public/js/studio/model-workspace.js');
const aiGuidedFlow = read('public/js/studio/ai-guided-flow.js');
const importGuidedFlow = read('public/js/studio/import-guided-flow.js');
const resultFiles = read('public/js/studio/result-files.js');
const artifactsWorkspace = read('public/js/studio/artifacts-workspace.js');
const shellJobMonitor = read('public/js/studio/studio-shell-job-monitor.js');
const reviewWorkspace = read('public/js/studio/review-workspace.js');
const reviewSummary = read('public/js/studio/review-summary.js');
const shellCore = read('public/js/studio/studio-shell-core.js');
const surfaces = read('public/js/studio/studio-surfaces.js');
const state = read('public/js/studio/studio-state.js');
const shellDom = read('public/js/studio/studio-shell-dom.js');
const en = read('public/js/i18n/en.js');
const ko = read('public/js/i18n/ko.js');
const uatFollowUp = read('docs/design/studio-beginner-uat-follow-up.md');
const uatSessionKit = read('docs/design/studio-beginner-uat-session-kit.md');
const approvedImportStep = read('docs/examples/quality-pass-bracket/cad/quality_pass_bracket.step');

const coreNavRoutes = [...html.matchAll(/data-nav-tier="core"[^>]*data-route="([^"]+)"/g)]
  .map((match) => match[1]);
assert.deepEqual(coreNavRoutes, ['start', 'history', 'artifacts']);
assert.match(html, /<details[^>]+id="advanced-work-navigation"/);
assert.match(html, /id="studio-nav-toggle"/);
assert.match(html, /id="studio-sidebar"/);
assert.match(html, /id="studio-sidebar-scrim"/);
assert.match(html, /id="completion-notice-host"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/s);
assert.doesNotMatch(html, /id="workspace-root"[^>]*aria-live=/s);

[
  'createTaskStepper',
  'createActionSummary',
  'createPrimaryAction',
  'createSecondaryAction',
  'createTertiaryAction',
  'createOverflowMenu',
  'createMenuItem',
  'createInlineStatus',
  'createCostAndSideEffectNotice',
  'createResultCard',
  'createEmptyStateWithNextAction',
].forEach((name) => {
  assert.match(renderers, new RegExp(`export function ${name}\\b`), `${name} must be exported`);
});

assert.match(workspaces, /dataset:\s*\{\s*hook:\s*'home-start-choices'/);
assert.match(workspaces, /goal:\s*'create-model'/);
assert.match(workspaces, /goal:\s*'review-cad'/);
assert.match(workspaces, /goal:\s*'previous-work'/);
assert.match(workspaces, /function createRunHistoryWorkspace\b/);
assert.match(workspaces, /createRunHistoryMenuItems\b/);
assert.match(workspaces, /historyJobId:\s*job\.id/);
assert.match(workspaces, /function createAdvancedConsoleWorkspace\b/);

[
  'collectResultFileGroups',
  'deriveResultFileAction',
  'resultFileLabelKey',
  'selectPrimaryResultArtifact',
].forEach((name) => {
  assert.match(resultFiles, new RegExp(`export function ${name}\\b`), `${name} must be exported`);
});
assert.match(
  shellJobMonitor,
  /import\s*\{\s*selectPrimaryResultArtifact\s*\}\s*from\s*['"]\.\/result-files\.js['"]/,
  'tracked manufacturing jobs must reuse the shared primary-result selector',
);
assert.match(
  shellJobMonitor,
  /summary\.type[\s\S]{0,160}manufacturing-action-dataset[\s\S]{0,220}selectPrimaryResultArtifact\(app\.state\.data\.activeJob\.artifacts,\s*\{\s*jobType:\s*summary\.type\s*\}\)[\s\S]{0,160}findDefaultArtifactForJob/,
  'opening a manufacturing job must select its dataset manifest while preserving the generic fallback',
);
assert.match(
  artifactsWorkspace,
  /const relatedArtifacts = Array\.isArray\(state\.data\.activeJob\.artifacts\)[\s\S]{0,120}\[\.\.\.state\.data\.activeJob\.artifacts\]/,
  'artifact viewers must receive the current tracked result-file set for count interpretation',
);
assert.match(artifactsWorkspace, /hook:\s*'artifacts-result-summary'/);
assert.match(artifactsWorkspace, /hook:\s*'artifacts-result-groups'/);
assert.match(artifactsWorkspace, /hook:\s*'artifacts-advanced-tools'/);
assert.match(artifactsWorkspace, /resultGroup:\s*group\.id/);
assert.match(artifactsWorkspace, /group\.id === 'system'/);
assert.match(artifactsWorkspace, /createResultArtifactCard\(primaryArtifact/);
assert.doesNotMatch(
  artifactsWorkspace,
  /run-artifact-review-context/,
  'Result files must not advertise artifact-ref review-context because that job requires source paths',
);
assert.match(reviewWorkspace, /hook:\s*'review-beginner-summary'/);
assert.match(reviewWorkspace, /hook:\s*'review-current-decision'/);
assert.match(reviewWorkspace, /hook:\s*'review-issues'/);
assert.match(reviewWorkspace, /hook:\s*'review-next-step'/);
assert.match(reviewWorkspace, /hook:\s*'review-supporting-files'/);
assert.match(reviewWorkspace, /hook:\s*'review-advanced-tools'/);
assert.match(reviewSummary, /export function buildReviewSummary\b/);
assert.match(reviewSummary, /export function isAdvancedReviewArtifact\b/);

[
  'select_input',
  'preflight',
  'running',
  'result',
].forEach((step) => {
  assert.match(
    workspaces,
    new RegExp(`guidedModelStepSection\\(['"]${step}['"]`),
    `guided model step ${step} must be rendered`,
  );
});
assert.match(workspaces, /actionId:\s*['"]generate-model['"]/);
assert.match(workspaces, /actionId:\s*['"]run-tracked-model-work['"]/);
assert.match(workspaces, /action:\s*['"]model-guided-continue['"]/);
assert.match(workspaces, /action:\s*['"]model-guided-generate['"]/);
assert.match(workspaces, /action:\s*['"]model-guided-view-result['"]/);
assert.match(
  workspaces,
  /function createGuidedModelExampleSelect\b[\s\S]*?['"]aria-describedby['"]:\s*['"]guided-model-input-hint['"]/,
  'the guided example selector must expose its visible disabled reason',
);
assert.match(workspaces, /value:\s*['"]ai['"]/);
assert.match(workspaces, /actionId:\s*['"]create-ai-draft['"]/);
assert.match(workspaces, /action:\s*['"]model-ai-create-draft['"]/);
assert.match(workspaces, /action:\s*['"]model-ai-validate-draft['"]/);
assert.match(workspaces, /hook:\s*['"]model-advanced-tools['"]/);
assert.match(modelWorkspace, /function syncGuidedWorkflow\b/);
assert.match(modelWorkspace, /guidedContinueButton\?\.addEventListener/);
assert.match(modelWorkspace, /guidedGenerateButton\?\.addEventListener/);
assert.match(modelWorkspace, /guidedViewResultButton\?\.addEventListener/);
assert.match(modelWorkspace, /let guidedStepFocusRequestEpoch\s*=\s*0/);
assert.match(modelWorkspace, /const requestEpoch\s*=\s*\+\+guidedStepFocusRequestEpoch/);
assert.match(modelWorkspace, /requestEpoch\s*!==\s*guidedStepFocusRequestEpoch/);
assert.match(modelWorkspace, /focusTarget\?\.isConnected/);
assert.match(modelWorkspace, /currentFocusTarget\s*!==\s*focusTarget/);
assert.match(modelWorkspace, /activeElement\s*!==\s*requestActiveElement[\s\S]*?activeElement\s*!==\s*focusTarget/);
assert.match(modelWorkspace, /focusCurrentStep\(\);\s*requestAnimationFrame/);
assert.match(modelWorkspace, /destroyed\s*\|\|\s*!guidedResultInspection\?\.isConnected/);
assert.match(modelWorkspace, /function queueGuidedResultInspectionInitialization\b/);
assert.match(
  modelWorkspace,
  /model\.preview\s*&&\s*ensureModelGuidedFlowState\(model\)\.resultExpanded[\s\S]*?queueGuidedResultInspectionInitialization\(\)/,
  'an expanded preview must recreate its viewer after the Model workspace remounts',
);
assert.match(
  modelWorkspace,
  /destroyed\s*\|\|\s*!guidedResultInspection\?\.isConnected\s*\|\|\s*!viewport\?\.isConnected/,
  'remount retries must not initialize a destroyed or detached viewer',
);
assert.match(
  modelWorkspace,
  /\.catch\(\(\)\s*=>\s*\{[\s\S]*?resultInspectionPreview\s*=\s*null/,
  'a transient preview load failure must remain retryable',
);
assert.match(modelWorkspace, /postJson\(['"]\/api\/studio\/design['"]/);
assert.match(modelWorkspace, /aiDraftRequiresReview/);
assert.match(aiGuidedFlow, /export function aiDraftRequiresReview\b/);
assert.match(aiGuidedFlow, /validatedConfigText/);

[
  'select_file',
  'diagnostics',
  'confirm',
  'running',
  'result',
].forEach((step) => {
  assert.match(
    workspaces,
    new RegExp(`guidedImportStepSection\\(['"]${step}['"]`),
    `guided import step ${step} must be rendered`,
  );
  assert.match(importGuidedFlow, new RegExp(`['"]${step}['"]`));
});
assert.match(workspaces, /actionId:\s*['"]check-imported-cad['"]/);
assert.match(workspaces, /actionId:\s*['"]start-imported-cad-review['"]/);
assert.match(workspaces, /action:\s*['"]choose-import-model-file['"]/);
assert.match(workspaces, /action:\s*['"]submit-import-review['"]/);
assert.match(workspaces, /id:\s*['"]guided-import-start-review-status['"]/);
assert.match(workspaces, /['"]aria-describedby['"]:\s*['"]guided-import-start-review-status['"]/);
assert.match(workspaces, /action:\s*['"]import-view-review-result['"]/);
assert.match(workspaces, /hook:\s*['"]import-advanced-tools['"]/);
assert.match(workspaces, /field:\s*['"]import-bom-path['"]/);
assert.match(workspaces, /field:\s*['"]import-inspection-path['"]/);
assert.match(workspaces, /field:\s*['"]import-quality-path['"]/);
assert.match(shellCore, /buildImportBootstrapRequestBody/);
assert.match(shellCore, /buildImportBootstrapOptions/);
assert.match(shellCore, /type:\s*['"]review-context['"]/);
assert.match(shellCore, /contextPath:\s*seed\.context_path/);
assert.match(shellCore, /modelPath:\s*seed\.model_path/);
assert.match(shellCore, /let importStepFocusRequestEpoch\s*=\s*0/);
assert.match(shellCore, /const requestEpoch\s*=\s*\+\+importStepFocusRequestEpoch/);
assert.match(shellCore, /requestEpoch\s*!==\s*importStepFocusRequestEpoch/);
assert.match(shellCore, /focusTarget\?\.isConnected/);
assert.match(shellCore, /currentFocusTarget\s*!==\s*focusTarget/);
assert.match(shellCore, /activeElement\s*!==\s*requestActiveElement[\s\S]*?activeElement\s*!==\s*focusTarget/);
assert.match(shellCore, /focusStep\(\);\s*windowRef\.requestAnimationFrame/);

assert.match(surfaces, /route:\s*'history'/);
assert.match(surfaces, /route:\s*'console'/);
assert.match(state, /STUDIO_SURFACE_ROUTES/);

assert.match(shellDom, /function setSidebar\(open/);
assert.match(shellDom, /function containSidebarFocus\(event\)/);
assert.match(shellDom, /studioMain\.inert\s*=\s*open/);
assert.match(shellCore, /app\.dom\.containSidebarFocus\(event\)/);
assert.match(shellCore, /innerWidth\s*>\s*920[\s\S]*?app\.dom\.setSidebar\(false\)/);
assert.match(shellDom, /advancedWorkNavigation\.open/);
assert.match(html, /id="advanced-mode-toggle"/);
assert.match(state, /STUDIO_EXPERIENCE_MODE_STORAGE_KEY\s*=\s*['"]studio_experience_mode['"]/);
assert.match(shellCore, /writeStudioExperienceMode/);
assert.match(css, /\.home-start-grid\s*\{/);
assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
assert.match(css, /@media \(max-width:\s*920px\)[\s\S]*?\.studio-sidebar[\s\S]*?position:\s*fixed/);
assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
assert.match(uatFollowUp, /Status:\s*`FOLLOW_UP_REQUIRED`/);
assert.match(uatFollowUp, /Human-study state:\s*`NOT_RUN`/);
assert.match(uatFollowUp, /Human-session packet:\s*`READY_FOR_HUMAN_SESSIONS`/);
assert.doesNotMatch(uatFollowUp, /actual browser 200% UI zoom operability remains a human check/i);
assert.match(
  uatFollowUp,
  /Automated proxy: Pass; agent-operated actual Chrome UI: Pass; human-participant diagnostic: `NOT_RUN`/,
);
['UAT-01', 'UAT-02', 'UAT-03'].forEach((criterion) => {
  assert.match(
    uatFollowUp,
    new RegExp('\\| `' + criterion + '` \\|[^\\n]+\\| `NOT_MEASURED`[^\\n]*\\|'),
  );
});
assert.match(uatSessionKit, /Packet state:\s*`READY_FOR_HUMAN_SESSIONS`/);
assert.match(uatSessionKit, /Human evidence state:\s*`NOT_RUN`/);
assert.match(uatSessionKit, /Scored cohort: exactly `P1` through `P5`/);
assert.match(uatSessionKit, /`P0`[^\n]+excluded from every UAT calculation/);
assert.match(uatSessionKit, /Anonymous-note consent is required before timing begins/);
assert.match(uatSessionKit, /withdraw consent at any time/);
assert.match(uatSessionKit, /exclude all of[\s\S]+every numerator and denominator/);
assert.match(uatSessionKit, /delete its raw notes,[\s\S]+recordings,[\s\S]+isolated job store/);
assert.match(uatSessionKit, /OS-private[\s\S]+outside the repository[\s\S]+owner-only access/);
assert.match(uatSessionKit, /```sh\nset -e\nexport UAT_PRIVATE_ROOT=/);
assert.match(uatSessionKit, /umask 077/);
[
  'install -d -m 700 "$UAT_PRIVATE_ROOT"',
  'install -d -m 700 "$UAT_PRIVATE_ROOT/round-1"',
  'install -d -m 700 "$UAT_PRIVATE_ROOT/round-1/P1"',
  'install -d -m 700 "$UAT_PRIVATE_ROOT/round-1/P1/jobs"',
].forEach((command) => {
  assert.ok(uatSessionKit.includes(command), `${command} must enforce owner-only access`);
});
assert.match(uatSessionKit, /process\.getuid/);
assert.match(uatSessionKit, /stat\.uid !== expectedUid/);
assert.match(uatSessionKit, /\(stat\.mode & 0o777\) !== 0o700/);
assert.match(uatSessionKit, /Do not use[\s\S]+`tmp\/codex\/`[\s\S]+`output\/`/);
assert.match(uatSessionKit, /Default to no audio, video, or screen recording/);
assert.match(uatSessionKit, /Record a retention\/deletion date before[\s\S]+the first session/);
[
  'configs/examples/quality_pass_bracket.toml',
  'docs/examples/quality-pass-bracket/cad/quality_pass_bracket.step',
  'configs/examples/ks_bracket.toml',
].forEach((fixture) => {
  assert.match(uatSessionKit, new RegExp(fixture.replaceAll('.', '\\.')));
});
assert.doesNotMatch(uatSessionKit, /tests\/fixtures\/imports\/simple_bracket\.step/);
assert.ok(Buffer.byteLength(approvedImportStep, 'utf8') > 10_000, 'the UAT STEP must contain real geometry data');
assert.match(approvedImportStep, /DATA;\s*#\d+\s*=/, 'the UAT STEP DATA section must contain entities');
assert.match(uatSessionKit, /\['ls-files', '-co', '--exclude-standard', '-z'\]/);
assert.match(uatSessionKit, /candidate_tree_sha256=/);
assert.match(uatSessionKit, /require an exact match before every participant/);
assert.match(uatSessionKit, /180-second report timeout,[\s\S]+60-second DFM budget/);
assert.match(uatSessionKit, /Date\.now\(\) \+ 300_000/);
assert.match(uatSessionKit, /timed out after 300 seconds/);
assert.match(uatSessionKit, /priorWorkJob\.status !== 'succeeded'/);
assert.match(uatSessionKit, /priorWorkJob\.result\?\.path\?\.endsWith\('\.pdf'\)/);
assert.match(uatSessionKit, /needsAttentionSummary\?\.surfaces\?\.dfm\?\.score !== 70/);
assert.match(uatSessionKit, /Task 1 - Create and inspect a model/);
assert.match(uatSessionKit, /Task 3 - Reopen previous work/);
assert.match(uatSessionKit, /Task 4 - Review an existing CAD file/);
assert.match(uatSessionKit, /Using the `quality_pass_bracket` example in Studio/);
assert.match(uatSessionKit, /open a completed `quality_pass_bracket` report/);
assert.match(uatSessionKit, /Task 2 is not a prerequisite for Task 3/);
assert.doesNotMatch(uatSessionKit, /reopen the model report you just created/);
const predictionRows = uatSessionKit.match(/^\| T[134]-A\d /gm) || [];
assert.equal(predictionRows.length, 8, 'the raw record must contain exactly eight canonical UAT-03 rows');
[
  'T1-A1 Continue',
  'T1-A2 Generate model',
  'T1-A3 View 3D model',
  'T3-A1 Open results',
  'T3-A2 View primary result',
  'T4-A1 Check file',
  'T4-A2 Start review',
  'T4-A3 View review result',
].forEach((opportunity) => assert.match(uatSessionKit, new RegExp(opportunity)));
assert.match(uatSessionKit, /denominator is always `8 × 5 = 40`/);
assert.match(uatSessionKit, /`UAT-03 denominator` = exactly `40`/);
assert.match(uatSessionKit, /Pass at `32\/40` or better/);
assert.match(uatSessionKit, /`UNREACHED`[\s\S]+fixed denominator/);
assert.match(uatSessionKit, /Retries, alternate actions, and detours[\s\S]+do not add rows/);
assert.match(uatSessionKit, /`FACILITATOR_MISSED`[\s\S]+invalid-session effect/);
assert.match(uatSessionKit, /arithmetic mean of the two middle values/);
assert.match(uatSessionKit, /Candidate tree SHA-256 matches round baseline/);
assert.match(uatSessionKit, /Prior-work report seed job ID/);
assert.match(uatSessionKit, /move the affected hole at least `5\.5 mm` farther inward[\s\S]+reaches `9\.0 mm`/);
assert.match(uatSessionKit, /execution:\s*`succeeded`/);
assert.match(uatSessionKit, /report quality:\s*`fail`/);
assert.match(uatSessionKit, /DFM:\s*`fail`, score `70`/);
assert.match(uatFollowUp, /32 of the fixed 40 next-action predictions/);
assert.match(uatFollowUp, /empty_import: false/);
assert.match(uatFollowUp, /fail_closed: false/);

[
  'studio.nav.start.label',
  'studio.nav.history.label',
  'studio.nav.artifacts.label',
  'studio.nav.advanced.label',
  'studio.home.title',
  'studio.home.create.title',
  'studio.home.review.title',
  'studio.home.previous.title',
  'studio.model.guided.step.input',
  'studio.model.guided.step.preflight',
  'studio.model.guided.step.running',
  'studio.model.guided.step.result',
  'studio.model.guided.generate.action',
  'studio.model.guided.result.view',
  'studio.model.guided.advanced.tracked-title',
  'studio.model.ai.method.label',
  'studio.model.ai.preflight.provider',
  'studio.model.ai.preflight.submitted',
  'studio.model.ai.preflight.local-files',
  'studio.model.ai.preflight.api-key',
  'studio.model.ai.preflight.cost',
  'studio.model.ai.preflight.result',
  'studio.model.ai.preflight.confirm',
  'studio.model.ai.review.validate',
  'studio.import.guided.step.file',
  'studio.import.guided.step.check',
  'studio.import.guided.step.result',
  'studio.import.guided.file.action',
  'studio.import.guided.confirm.action',
  'studio.import.guided.result.view',
  'studio.import.guided.advanced.summary',
  'studio.history.open-review',
  'studio.history.run-information',
  'studio.artifacts.title',
  'studio.artifacts.summary.execution',
  'studio.artifacts.summary.quality',
  'studio.artifacts.group.immediate',
  'studio.artifacts.group.quality',
  'studio.artifacts.group.technical',
  'studio.artifacts.group.system',
  'studio.artifacts.action.view',
  'studio.artifacts.action.download',
  'studio.artifacts.action.details',
  'studio.artifacts.advanced.summary',
  'studio.review.kicker',
  'studio.review.title',
  'studio.review.current-decision',
  'studio.review.issues',
  'studio.review.next-step',
  'studio.review.supporting-files',
  'studio.review.advanced.summary',
  'studio.nav.advanced.preference.label',
].forEach((key) => {
  const keyPattern = new RegExp(`['"]${key.replaceAll('.', '\\.')}['"]\\s*:`);
  assert.match(en, keyPattern, `${key} must exist in English`);
  assert.match(ko, keyPattern, `${key} must exist in Korean`);
});

console.log('studio-beginner-ux-contract.test.js: ok');
