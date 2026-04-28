import assert from 'node:assert/strict';

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  formatLocaleCookie,
  normalizeLocale,
  parseLocaleCookie,
  resolveInitialLocale,
} from '#i18n-contract';
import {
  createTranslator,
  translateText,
} from '../public/js/i18n/index.js';

assert.equal(DEFAULT_LOCALE, 'en');
assert.deepEqual(SUPPORTED_LOCALES, ['en', 'ko']);
assert.equal(normalizeLocale('en-US'), 'en');
assert.equal(normalizeLocale('ko-KR'), 'ko');
assert.equal(parseLocaleCookie(`${LOCALE_COOKIE_NAME}=ko; Path=/`), 'ko');
assert.equal(resolveInitialLocale({ browserLanguage: 'ko-KR' }), 'ko');
assert.equal(resolveInitialLocale({ savedLocale: 'en' }), 'en');
assert.equal(resolveInitialLocale({
  savedLocale: 'ko',
  cookieHeader: `${LOCALE_COOKIE_NAME}=en`,
  browserLanguage: 'en-US',
}), 'ko');
assert.equal(formatLocaleCookie('ko-KR'), `${LOCALE_COOKIE_NAME}=ko; Path=/; Max-Age=31536000; SameSite=Lax`);

const ko = createTranslator('ko');
assert.equal(ko.t('locale.label'), '언어');
assert.equal(ko.t('index.title'), 'FreeCAD 클래식 뷰어');
assert.equal(ko.t('index.mode.label'), '클래식 호환 모드');
assert.equal(translateText('Jobs center', 'ko'), '작업 센터');
assert.equal(translateText('Open Jobs center', 'ko'), '작업 센터 열기');
assert.equal(translateText('Retry tracked job', 'ko'), '추적 작업 다시 시도');
assert.equal(translateText('Tracked report completed', 'ko'), '추적 보고서 완료');
assert.equal(translateText('Tracked create failed', 'ko'), '추적 생성 실패');
assert.equal(
  translateText('Open Artifacts to inspect generated files and quality evidence.', 'ko'),
  '생성 파일과 품질 근거를 검토하려면 산출물을 여세요.'
);
assert.equal(
  translateText('2 other active jobs still running.', 'ko'),
  '다른 활성 작업 2개가 아직 실행 중입니다.'
);
assert.equal(translateText('Console', 'ko'), '콘솔');
assert.equal(translateText('Packs', 'ko'), '패키지');
assert.equal(translateText('Preferred browser review console', 'ko'), '기본 브라우저 검토 콘솔');
assert.equal(
  translateText('Review-first launchpad for ingest, packs, compare, and reopen actions.', 'ko'),
  '입력, 패키지, 비교, 재열기 작업을 위한 검토 우선 시작 화면입니다.'
);
assert.equal(
  translateText('Use the Packs workspace to reopen tracked review packs, readiness reports, and release bundles. Local file import is not available on this path yet.', 'ko'),
  '패키지 작업 영역에서 추적된 검토 패키지, 준비 상태 보고서, 릴리스 번들을 다시 열 수 있습니다. 이 경로에서는 아직 로컬 파일 가져오기를 지원하지 않습니다.'
);
assert.equal(translateText('Copy repo path', 'ko'), '저장소 경로 복사');
assert.equal(translateText('Copied', 'ko'), '복사됨');
assert.equal(translateText('Copy failed', 'ko'), '복사 실패');
assert.equal(translateText('Preview', 'ko'), '미리보기');
assert.equal(translateText('Close preview', 'ko'), '미리보기 닫기');
assert.equal(translateText('Preview failed', 'ko'), '미리보기 실패');
assert.equal(translateText('Canonical artifact preview', 'ko'), '표준 산출물 미리보기');
assert.equal(translateText('Preview truncated by server size limit.', 'ko'), '서버 크기 제한으로 미리보기가 잘렸습니다.');
assert.equal(
  translateText('Release bundle presence does not mean production-ready; package remains needs_more_evidence until real inspection_evidence is attached.', 'ko'),
  '릴리스 번들이 있어도 production-ready를 뜻하지 않습니다. 실제 inspection_evidence가 첨부될 때까지 패키지는 needs_more_evidence 상태로 유지됩니다.'
);
assert.equal(translateText('Start with a verified bracket', 'ko'), '검증된 브래킷으로 시작');
assert.equal(translateText('Recommended example: quality_pass_bracket', 'ko'), '권장 예제: quality_pass_bracket');
assert.equal(translateText('Load verified bracket', 'ko'), '검증된 브래킷 불러오기');
assert.equal(translateText('Open Model workspace', 'ko'), '모델 작업 영역 열기');
assert.equal(translateText('Primary tracked path', 'ko'), '기본 추적 경로');
assert.equal(
  translateText('Recommended path: run tracked create first, then tracked report.', 'ko'),
  '권장 경로: 먼저 추적 생성을 실행한 뒤 추적 보고서를 실행하세요.'
);
assert.equal(translateText('Run tracked create first', 'ko'), '먼저 추적 생성 실행');
assert.equal(translateText('Engineering Quality', 'ko'), '엔지니어링 품질');
assert.equal(translateText('Generated geometry', 'ko'), '생성 형상');
assert.equal(translateText('STEP reimport', 'ko'), 'STEP 재가져오기');
assert.equal(translateText('Left hole center', 'ko'), '왼쪽 홀 중심');
assert.equal(translateText('Expected', 'ko'), '예상');
assert.equal(translateText('Actual', 'ko'), '실제');
assert.equal(translateText('Tolerance', 'ko'), '허용오차');
assert.equal(translateText('Source', 'ko'), '소스');
assert.equal(translateText('What to do next', 'ko'), '다음에 할 일');
assert.equal(translateText('Inspect quality evidence', 'ko'), '품질 근거 검토');
assert.equal(translateText('Run tracked create again', 'ko'), '추적 생성 다시 실행');
assert.equal(
  translateText('Left hole center is outside tolerance.', 'ko'),
  '왼쪽 홀 중심이 허용오차를 벗어났습니다.'
);
assert.equal(
  translateText('Run tracked create again after the fix.', 'ko'),
  '수정한 뒤 추적 생성을 다시 실행하세요.'
);
assert.equal(translateText('Open compare workspace', 'ko'), '비교 작업 영역 열기');
assert.equal(translateText('3 recent jobs', 'ko'), '3개의 최근 작업');
assert.equal(translateText('Select example', 'ko'), '예제 선택');
assert.equal(translateText('Recent jobs loading', 'ko'), '최근 작업 불러오는 중');
assert.equal(translateText('Choose your first supported step', 'ko'), '처음 시작할 현재 지원 경로를 선택하세요');
assert.equal(
  translateText('Preview routes stay local to this workspace and do not create tracked `/jobs` history.', 'ko'),
  '미리보기 경로는 현재 작업 영역 안에서만 동작하며 추적 `/jobs` 기록을 만들지 않습니다.'
);
assert.equal(translateText('Classic compatibility route', 'ko'), '클래식 호환 경로');
assert.equal(translateText('Jump between runs', 'ko'), '실행 간 이동');
assert.equal(translateText('Artifact trail and manifests', 'ko'), '산출물 흐름 및 매니페스트');
assert.equal(
  translateText('Tracked outputs need a dedicated surface so job history and artifact provenance do not get buried under entry controls.', 'ko'),
  '추적 산출물은 작업 이력과 산출물 출처 정보가 시작 제어 아래 묻히지 않도록 전용 작업 영역이 필요합니다.'
);
assert.equal(translateText('Manifest-first layout', 'ko'), '매니페스트 우선 레이아웃');
assert.equal(translateText('Active job', 'ko'), '활성 작업');
assert.equal(translateText('Select a recent job', 'ko'), '최근 작업 선택');
assert.equal(
  translateText('The Start workspace recent-jobs list is the intended entry point into artifacts.', 'ko'),
  'Start 작업 영역의 최근 작업 목록은 산출물로 들어가는 기본 진입점입니다.'
);
assert.equal(
  translateText('Drawing plan, SVG canvas, BOM, and dimension loop staging.', 'ko'),
  '도면 계획, SVG 캔버스, BOM, 치수 반복 작업을 다룹니다.'
);
assert.equal(
  translateText('Drawing previews and tracked sheet runs use the same runtime and job model as the rest of Studio.', 'ko'),
  '도면 미리보기와 추적 시트 실행은 Studio의 다른 작업과 같은 런타임 및 작업 모델을 사용합니다.'
);
assert.equal(translateText('Project root unavailable', 'ko'), '프로젝트 루트를 사용할 수 없음');
assert.equal(translateText('Not checked yet', 'ko'), '아직 확인하지 않음');
assert.equal(
  translateText('Generate drawing to open the sheet-first workbench.', 'ko'),
  '시트 중심 작업 영역을 열려면 도면을 생성하세요.'
);
assert.equal(translateText('Local API connected', 'ko'), '로컬 API 연결됨');
assert.equal(translateText('Local API degraded', 'ko'), '로컬 API 성능 저하');
assert.equal(translateText('Legacy shell fallback', 'ko'), '레거시 셸 대체 경로');
assert.equal(translateText('Shell-only mode', 'ko'), '셸 전용 모드');
assert.equal(translateText('Runtime diagnostics available.', 'ko'), '런타임 진단을 확인할 수 있습니다.');
assert.equal(translateText('Runtime check required', 'ko'), '런타임 확인 필요');
assert.equal(translateText('Runtime unavailable on legacy path', 'ko'), '레거시 경로에서는 런타임을 사용할 수 없음');
assert.equal(translateText('Runtime status pending', 'ko'), '런타임 상태 확인 대기 중');
assert.equal(
  translateText('No jobs have been tracked yet on this local API instance.', 'ko'),
  '이 로컬 API 인스턴스에는 아직 추적된 작업이 없습니다.'
);
assert.equal(
  translateText('No tracked job is selected or monitored.', 'ko'),
  '선택되거나 모니터링 중인 추적 작업이 없습니다.'
);
assert.equal(
  translateText('Recent jobs require the local API path from `fcad serve`.', 'ko'),
  '최근 작업을 보려면 로컬 API 경로의 `fcad serve`를 사용해야 합니다.'
);
assert.equal(
  translateText('Recent job history requires the local API path from `fcad serve`.', 'ko'),
  '최근 작업 기록을 보려면 로컬 API 경로의 `fcad serve`를 사용해야 합니다.'
);
assert.equal(translateText('3 recent jobs visible', 'ko'), '최근 작업 3개 표시됨');
assert.equal(translateText('Connection local api', 'ko'), '연결 로컬 API');
assert.equal(translateText('Connection legacy shell', 'ko'), '연결 레거시 셸');
assert.equal(translateText('Connection shell only', 'ko'), '연결 셸 전용');
assert.equal(translateText('Runtime legacy-only', 'ko'), '런타임 레거시 전용');
assert.equal(translateText('Updated Mar 29, 10:10:10', 'ko'), '업데이트 Mar 29, 10:10:10');
assert.equal(
  translateText('Run `fcad serve` to expose `/jobs` and artifact history for the new studio shell.', 'ko'),
  '새 스튜디오 셸에서 `/jobs`와 산출물 이력을 보려면 `fcad serve`를 실행하세요.'
);
assert.equal(
  translateText('Legacy shell detected. Examples still load, but runtime health and tracked jobs require the local API path from `fcad serve`.', 'ko'),
  '레거시 셸이 감지되었습니다. 예제는 계속 불러올 수 있지만 런타임 상태와 추적 작업에는 `fcad serve`의 로컬 API 경로가 필요합니다.'
);
assert.equal(
  translateText('Keep the most recent jobs close so the artifact trail stays fast to navigate.', 'ko'),
  '가장 최근 작업을 가까이에 두어 산출물 흐름을 빠르게 따라갈 수 있게 합니다.'
);
assert.equal(translateText('Recent job shortcuts', 'ko'), '최근 작업 바로가기');
assert.equal(translateText('Tracked outputs', 'ko'), '추적 산출물');
assert.equal(translateText('Why this workspace exists', 'ko'), '이 작업 영역이 필요한 이유');
assert.equal(translateText('No silent downloads', 'ko'), '자동 다운로드 없음');
assert.equal(
  translateText('Use Start to choose a recent job and route here.', 'ko'),
  '시작에서 최근 작업을 선택해 여기로 오세요.'
);
assert.equal(
  translateText('Once jobs exist on the local API path, they will appear here automatically.', 'ko'),
  '로컬 API 경로에 작업이 생기면 여기에 자동으로 나타납니다.'
);
assert.equal(
  translateText('Artifact and manifest views can deepen later without changing how Start routes users back into work.', 'ko'),
  '산출물과 매니페스트 보기는 나중에 더 확장하더라도 Start가 사용자를 작업으로 되돌리는 방식은 바꾸지 않습니다.'
);
assert.equal(translateText('Unknown job', 'ko'), '알 수 없는 작업');
assert.equal(translateText('Unavailable on this serve path', 'ko'), '현재 serve 경로에서는 사용할 수 없음');
assert.equal(
  translateText('1 queued or running job currently monitored from this shell session.', 'ko'),
  '이 셸 세션에서 현재 대기 또는 실행 상태로 모니터링 중인 작업은 1개입니다.'
);
assert.equal(
  translateText('2 queued or running jobs currently monitored from this shell session.', 'ko'),
  '이 셸 세션에서 현재 대기 또는 실행 상태로 모니터링 중인 작업은 2개입니다.'
);
assert.equal(
  translateText('2 queued or running review-console jobs currently monitored from this shell session.', 'ko'),
  '이 셸 세션에서 현재 대기 또는 실행 상태로 모니터링 중인 검토 콘솔 작업은 2개입니다.'
);
assert.equal(
  translateText('Latest tracked job create queued.', 'ko'),
  '최신 추적 작업: 생성 대기 중.'
);
assert.equal(translateText('Tracked idle', 'ko'), '추적 대기');
assert.equal(translateText('1 running', 'ko'), '실행 중 1개');
assert.equal(translateText('1 queued', 'ko'), '대기 중 1개');
assert.equal(translateText('Last poll Mar 29, 10:10:10.', 'ko'), '마지막 확인 Mar 29, 10:10:10.');
assert.equal(translateText('Missing • Unknown size', 'ko'), '누락됨 • 크기 알 수 없음');
assert.equal(translateText('unknown • stable', 'ko'), '알 수 없음 • 안정적');
assert.equal(translateText('Not available', 'ko'), '사용할 수 없음');
assert.equal(translateText('Size unavailable', 'ko'), '크기를 사용할 수 없음');
assert.equal(translateText('Validating', 'ko'), '검증 중');
assert.equal(translateText('Building', 'ko'), '빌드 중');
assert.equal(translateText('Needs attention', 'ko'), '확인 필요');
assert.equal(
  translateText('Build logs will appear here once validation or preview work runs.', 'ko'),
  '검증 또는 미리보기 작업이 실행되면 빌드 로그가 여기에 표시됩니다.'
);
assert.equal(
  translateText('Use the assistant to draft TOML from a prompt without making prompting the center of the workspace.', 'ko'),
  '프롬프트를 작업 영역의 중심으로 만들지 않고도 도우미로 TOML 초안을 만들 수 있습니다.'
);
assert.equal(translateText('QA score', 'ko'), 'QA 점수');
assert.equal(translateText('Weight profile', 'ko'), '가중치 프로필');
assert.equal(translateText('Planned dimensions', 'ko'), '계획된 치수');
assert.equal(translateText('Rendered dimensions', 'ko'), '렌더링된 치수');
assert.equal(translateText('Conflicts', 'ko'), '충돌');
assert.equal(translateText('Unnamed dimension', 'ko'), '이름 없는 치수');
assert.equal(translateText('No feature tag', 'ko'), '피처 태그 없음');
assert.equal(translateText('required', 'ko'), '필수');
assert.equal(
  translateText('Dimension history will appear here after the first change.', 'ko'),
  '첫 변경 이후 치수 이력이 여기에 표시됩니다.'
);
assert.equal(translateText('Baseline', 'ko'), '기준선');
assert.equal(translateText('Added artifact types', 'ko'), '추가된 산출물 유형');
assert.equal(translateText('Missing vs baseline', 'ko'), '기준선 대비 누락');
assert.equal(translateText('Baseline updated', 'ko'), '기준선 업데이트 시각');
assert.equal(translateText('Packs workspace', 'ko'), '패키지 작업 영역');
assert.equal(translateText('Artifact management dashboard', 'ko'), '산출물 관리 대시보드');
assert.equal(translateText('Tracked job selected', 'ko'), '추적 작업 선택됨');
assert.equal(translateText('No active package', 'ko'), '활성 패키지가 없습니다');
assert.equal(translateText('2 recent runs', 'ko'), '최근 실행 2개');
assert.equal(translateText('Manifest-backed download path', 'ko'), '매니페스트 기반 다운로드 경로');
assert.equal(translateText('Review-to-download flow', 'ko'), '검토에서 다운로드까지의 흐름');
assert.equal(translateText('No tracked jobs', 'ko'), '추적된 작업이 없습니다');
assert.equal(translateText('Tracked jobs created by `fcad serve` appear here as an artifact timeline.', 'ko'), '`fcad serve`로 생성한 추적 작업이 여기에 산출물 타임라인으로 표시됩니다.');
assert.equal(translateText('No active artifact set', 'ko'), '활성 산출물 세트 없음');
assert.equal(translateText('No active job', 'ko'), '활성 작업 없음');
assert.equal(translateText('Job', 'ko'), '작업');
assert.equal(translateText('Manifest command', 'ko'), '매니페스트 명령');
assert.equal(translateText('Artifact count', 'ko'), '산출물 수');
assert.equal(translateText('Job storage', 'ko'), '작업 저장소');
assert.equal(translateText('This job exposes no artifacts', 'ko'), '이 작업은 산출물을 제공하지 않습니다');
assert.equal(translateText('Your generated files', 'ko'), '생성된 파일');
assert.equal(
  translateText('Download or inspect the main outputs from this run.', 'ko'),
  '이번 실행의 주요 출력을 다운로드하거나 확인하세요.'
);
assert.equal(translateText('CAD exports', 'ko'), 'CAD 내보내기');
assert.equal(translateText('STEP model', 'ko'), 'STEP 모델');
assert.equal(translateText('STL mesh', 'ko'), 'STL 메시');
assert.equal(translateText('PDF report', 'ko'), 'PDF 보고서');
assert.equal(translateText('Report summary', 'ko'), '보고서 요약');
assert.equal(translateText('Quality evidence', 'ko'), '품질 근거');
assert.equal(translateText('Create quality JSON', 'ko'), '생성 품질 JSON');
assert.equal(translateText('Drawing quality JSON', 'ko'), '도면 품질 JSON');
assert.equal(translateText('All artifacts', 'ko'), '전체 산출물');
assert.equal(translateText('Current job output list', 'ko'), '현재 작업의 출력 목록');
assert.equal(translateText('Structured inspector', 'ko'), '구조화된 인스펙터');
assert.equal(translateText('Package', 'ko'), '패키지');
assert.equal(translateText('Previous', 'ko'), '이전');
assert.equal(translateText('Comparing', 'ko'), '비교 중');
assert.equal(translateText('1/2 indexed', 'ko'), '1/2 인덱싱됨');
assert.equal(translateText('No queued outputs yet', 'ko'), '아직 대기 중인 출력이 없습니다');
assert.equal(
  translateText('The job record exists, but the artifact list is empty. The manifest may still explain why.', 'ko'),
  '작업 기록은 존재하지만 산출물 목록이 비어 있습니다. 이유는 매니페스트에 남아 있을 수 있습니다.'
);
assert.equal(translateText('low', 'ko'), '낮음');
assert.equal(translateText('medium', 'ko'), '보통');
assert.equal(translateText('high', 'ko'), '높음');
assert.equal(translateText('hold', 'ko'), '보류');
assert.equal(translateText('pass', 'ko'), '통과');
assert.equal(translateText('warning', 'ko'), '경고');
assert.equal(translateText('fail', 'ko'), '실패');
assert.equal(translateText('hold_before_line_commitment', 'ko'), '라인 커밋 전 보류');
assert.equal(translateText('Part type', 'ko'), '부품 유형');
assert.equal(translateText('Overall risk', 'ko'), '전체 위험도');
assert.equal(translateText('Risk', 'ko'), '위험도');
assert.equal(translateText('Severity', 'ko'), '심각도');
assert.equal(translateText('Status', 'ko'), '상태');
assert.equal(translateText('Recommendation', 'ko'), '권장 조치');
assert.equal(translateText('Finding', 'ko'), '검토 항목');
assert.equal(translateText('Findings', 'ko'), '검토 항목');
assert.equal(translateText('Evidence', 'ko'), '근거');
assert.equal(translateText('Summary', 'ko'), '요약');
assert.equal(translateText('Source', 'ko'), '소스');
assert.equal(translateText('Category', 'ko'), '분류');
assert.equal(translateText('Item', 'ko'), '항목');
assert.equal(translateText('Value', 'ko'), '값');
assert.equal(translateText('Unknown', 'ko'), '알 수 없음');

console.log('browser-i18n.test.js: ok');
